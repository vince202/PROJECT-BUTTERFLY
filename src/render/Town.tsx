/**
 * <Town/>: the rebuilt town (imported Quaternius / Kenney models + the
 * procedural kit, one palette). Phase 1 covers the café block: the café, the
 * bakery, the florist and Place du Marché, their blocks of houses, and the
 * north edge of the park. Everything static is merged per material or
 * instanced; per-frame work is limited to window lighting uniforms.
 */

import { Suspense, useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { LOCATIONS } from '../sim/city';
import { AGENTS } from '../sim/population';
import type { LocationDef } from '../sim/types';
import { useSimStore } from '../store/useSimStore';
import { CURB_H, blocks, heroDist } from './layout';
import { litUniform, makeBillboards } from './materials';
import { type ModelName, instancedModel, instancedTextured, useProtos, useTexturedProps } from './models';
import { activeRealityOf, env } from './shared';
import { LampGlow } from './Streets';
import { focusBoxes } from './focus';
import { PlaceLabels } from './PlaceLabels';
import { Life } from './Life';
import { buildCafeBlockLots, buildOtherLots, buildPark, canalDressing, countryside, fillBlock, gardenBlock, newTownOut, parkChairs, parkNorthEdge } from './town';

/** Locations built with the detailed café-block builder. */
export const TOWN_LOTS = new Set(['cafe', 'bakery', 'florist']);

export function Town() {
  return (
    <Suspense fallback={null}>
      <TownInner />
    </Suspense>
  );
}

const residents = new Map<string, number>();
for (const a of AGENTS) residents.set(a.homeId, (residents.get(a.homeId) ?? 0) + 1);

/** Fraction of lit windows for a location at minute t. */
function activityOf(loc: LocationDef | undefined, t: number, awake: number): number {
  if (!loc || loc.kind === 'home') {
    let base = t < 7.5 * 60 ? 0.3 : t < 22 * 60 ? 0.42 : t < 23 * 60 ? 0.28 : 0.1;
    if (awake > 0) base += 0.3;
    return Math.min(0.9, base);
  }
  const open = loc.opens === undefined || loc.closes === undefined || (t >= loc.opens && t < loc.closes);
  if (open) return 0.85;
  return awake > 0 ? 0.25 : 0.04;
}

const WARM = [new THREE.Color('#ffcf7a'), new THREE.Color('#ffe0a6'), new THREE.Color('#ffb765'), new THREE.Color('#ffc46e')].map((c, i) => c.multiplyScalar([1.7, 1.3, 1.5, 0.9][i]));
/** Cool flicker of a television in a few windows. */
const TV = new THREE.Color('#8fb0ff').multiplyScalar(0.95);
const BLACK = new THREE.Color(0, 0, 0);
const SMOKE_DAY = new THREE.Color('#eeeae4');
const SMOKE_NIGHT = new THREE.Color('#3a3f52');
const tmpC = new THREE.Color();

function TownInner() {
  const protos = useProtos();
  const tprops = useTexturedProps();

  const built = useMemo(() => {
    const out = newTownOut();
    const keep = buildCafeBlockLots(out, protos, tprops);
    keep.push(...buildOtherLots(out, protos, TOWN_LOTS));
    parkNorthEdge(out, protos);
    parkChairs(out);
    canalDressing(out, protos);
    countryside(out);
    const park = buildPark(out, protos);
    for (const blk of blocks()) {
      if (blk.kind !== 'normal') continue;
      const cx = (blk.x0 + blk.x1) / 2;
      const cz = (blk.z0 + blk.z1) / 2;
      const detail: 0 | 1 | 2 = blk.hero ? 2 : heroDist(cx, cz) < 1.25 ? 1 : 0;
      const placed = fillBlock(out, protos, blk, keep, detail, blk.x0 * 7 + blk.z0);
      gardenBlock(out, blk, [...placed, ...keep], blk.x0 + 3 * blk.z0, detail === 2 ? 11 : 8);
    }
    const meshes: THREE.Object3D[] = [...out.b.build()];
    for (const lb of out.lotBatches.values()) meshes.push(...lb.build());
    const win = out.ctx.win.build();
    meshes.push(...win.meshes, ...win.glass);
    const signs = out.ctx.signs.build();
    if (signs) meshes.push(signs);
    for (const [name, items] of out.instances) meshes.push(...instancedModel(protos[name], items));
    for (const [name, items] of out.textured) meshes.push(...instancedTextured(tprops[name], items));
    // Trees: instanced per species, swaying leaves.
    const bySpecies = new Map<ModelName, { x: number; z: number; y: number; rotY: number; scale: number; tint: THREE.Color }[]>();
    let k = 0;
    for (const t of out.trees) {
      const p = protos[t.kind];
      if (!bySpecies.has(t.kind)) bySpecies.set(t.kind, []);
      const tint = new THREE.Color().setHSL(0.25 + ((k * 0.37) % 1) * 0.06, 0.25, 0.82 + ((k * 0.61) % 1) * 0.3);
      bySpecies.get(t.kind)!.push({ x: t.x, z: t.z, y: CURB_H, rotY: (k * 2.39) % 6.28, scale: t.h / p.size.y, tint });
      k++;
    }
    for (const [name, items] of bySpecies) meshes.push(...instancedModel(protos[name], items, { sway: 0.01 }));
    // Countryside trees: same species, separate instances without shadows.
    const far = new Map<ModelName, { x: number; z: number; y: number; rotY: number; scale: number; tint: THREE.Color }[]>();
    out.farTrees.forEach((t, i) => {
      if (!far.has(t.kind)) far.set(t.kind, []);
      far.get(t.kind)!.push({ x: t.x, z: t.z, y: -0.08, rotY: i * 2.1, scale: t.h / protos[t.kind].size.y, tint: new THREE.Color().setHSL(0.24, 0.18, 0.7 + ((i * 0.37) % 1) * 0.2) });
    });
    for (const [name, items] of far) meshes.push(...instancedModel(protos[name], items, { sway: 0.006, castShadow: false }));
    const bushItems = out.bushes.map((b, i) => ({ x: b.x, z: b.z, y: CURB_H, rotY: i * 1.7, scale: b.s / protos.bush.size.y }));
    meshes.push(...instancedModel(protos.bush, bushItems, { sway: 0.004 }));
    // Chimney smoke (four puffs per chimney, GPU animated)
    const puffs = out.ctx.emit.smoke.flatMap((p, i) => [0, 0.25, 0.5, 0.75].map((ph) => ({ x: p.x, y: p.y, z: p.z, size: 1.6, phase: (ph + i * 0.13) % 1 })));
    const smoke = puffs.length ? makeBillboards(puffs, 'smoke', '#eeeae4') : null;
    if (smoke) meshes.push(smoke);
    const lanterns = [...out.lanterns, ...out.ctx.emit.lamps];
    const parkLamps = park.lamps;
    for (const p of out.pick) focusBoxes.set(p.id, p.box);
    return { meshes, glass: win.glass, glassOwner: win.glassOwner, glassSeed: win.glassSeed, owners: out.ctx.win.owners, smoke, lanterns, parkLamps, pick: out.pick };
  }, [protos, tprops]);

  useEffect(() => () => {
    for (const m of built.meshes) (m as THREE.Mesh).geometry?.dispose();
  }, [built]);

  const locById = useMemo(() => new Map(LOCATIONS.map((l) => [l.id, l])), []);
  const awake = useMemo(() => new Map<string, number>(), []);
  const ownerAct = useMemo(() => new Float32Array(built.owners.length), [built]);

  useFrame(() => {
    const s = useSimStore.getState();
    const t = s.time;
    const night = env.night;
    const frame = activeRealityOf(s).frameAt(Math.floor(t));
    awake.clear();
    if (frame) for (const id in frame.agents) {
      const a = frame.agents[id];
      if (a.loc && !a.asleep) awake.set(a.loc, (awake.get(a.loc) ?? 0) + 1);
    }
    const glowK = THREE.MathUtils.smoothstep(night, 0.1, 0.65);
    const perf = performance.now() / 1000;
    for (const id of TOWN_LOTS) litUniform(id).value = activityOf(locById.get(id), t, awake.get(id) ?? 0) * glowK;
    litUniform('homes').value = activityOf(undefined, t, 0) * glowK;
    built.owners.forEach((o, i) => {
      ownerAct[i] = activityOf(locById.get(o.id), t, awake.get(o.id) ?? 0);
    });
    // Procedural kit windows: per-instance emissive.
    built.glass.forEach((gm, gi) => {
      const own = built.glassOwner[gi];
      const seeds = built.glassSeed[gi];
      for (let i = 0; i < own.length; i++) {
        const lit = seeds[i] < ownerAct[own[i]] && glowK > 0;
        if (lit) {
          const v = Math.floor(seeds[i] * 1000);
          const tv = v % 13 === 0 && t > 19 * 60;
          gm.setColorAt(i, tv ? tmpC.copy(TV).multiplyScalar(glowK * (0.85 + 0.15 * Math.sin(perf * 6 + v))) : tmpC.copy(WARM[v % 4]).multiplyScalar(glowK));
        }
        else gm.setColorAt(i, BLACK);
      }
      if (gm.instanceColor) gm.instanceColor.needsUpdate = true;
    });
    if (built.smoke) {
      const sm = built.smoke.material as THREE.ShaderMaterial;
      sm.uniforms.uOpacity.value = 0.5 * (1 - env.rain * 0.5) * (1 - night * 0.55);
      sm.uniforms.uTint.value.copy(SMOKE_DAY).lerp(SMOKE_NIGHT, night);
    }
  });

  return (
    <group>
      {built.meshes.map((m, i) => (
        <primitive key={i} object={m} />
      ))}
      <LampGlow bulbs={built.lanterns} pool={false} size={2.2} />
      <LampGlow bulbs={built.parkLamps} size={4} />
      <PlaceLabels picks={built.pick} />
      <Life />
    </group>
  );
}
