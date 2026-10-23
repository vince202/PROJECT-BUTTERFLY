/**
 * The twenty inhabitants, rendered as little "meeples".
 *
 * Meshes are created imperatively once (shared geometries, per-agent
 * materials) and animated from a single useFrame: interpolated positions
 * from the trace, heading, sidewalk offset while walking, a small walk cycle,
 * sleep dimming, hover / selection feedback and name labels. Nothing here
 * triggers React re-renders while the clock runs.
 */

import { useEffect, useMemo, useRef } from 'react';
import { type ThreeEvent, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { LOCATIONS } from '../sim/city';
import { AGENTS } from '../sim/population';
import type { AgentProfile } from '../sim/types';
import { useSimStore } from '../store/useSimStore';
import { type StreetSample, activeRealityOf, agentWorld, angleDelta, damp, env, hashString, labelMaterial, makeLabel, radialTexture, sampleFrames, sizeLabel, streetLerp } from './shared';

/** Overall meeple scale (meeples are deliberately oversized for readability). */
const AGENT_SCALE = 0.95;
/** Below this camera distance every name is shown. */
const ALL_NAMES_DISTANCE = 380;
/** Lateral offset applied while walking so that people use the sidewalks (metres). */
const SIDEWALK_OFFSET = 8.5;

/** Locations whose interior hides the people inside (everything but the park and bus stops). */
const INDOOR = new Set(LOCATIONS.filter((l) => l.kind !== 'park' && l.kind !== 'bus_stop').map((l) => l.id));

const SKIN = ['#f1c7a5', '#e5b48e', '#c98e66', '#8d5a3b', '#f4d2b8'];
const HAIR = ['#3b2a20', '#5a3b26', '#1f1a17', '#a8743f', '#d9b56c', '#7a3f22'];

// Shared geometries --------------------------------------------------------

function makeGeometries() {
  const leg = new THREE.CapsuleGeometry(0.42, 1.3, 4, 8);
  leg.translate(0, -1.07, 0); // pivot at the hip
  const arm = new THREE.CapsuleGeometry(0.3, 1.3, 4, 8);
  arm.translate(0, -0.85, 0); // pivot at the shoulder
  const body = new THREE.CapsuleGeometry(1.05, 1.6, 6, 14);
  const head = new THREE.SphereGeometry(0.95, 18, 14);
  const hair = new THREE.SphereGeometry(1.02, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.55);
  const eye = new THREE.SphereGeometry(0.13, 8, 6);
  const hit = new THREE.CylinderGeometry(3.4, 3.4, 9.5, 8);
  hit.translate(0, 4.75, 0);
  return { leg, arm, body, head, hair, eye, hit };
}

interface Meeple {
  id: string;
  root: THREE.Group;
  inner: THREE.Group;
  legL: THREE.Mesh;
  legR: THREE.Mesh;
  armL: THREE.Mesh;
  armR: THREE.Mesh;
  eyes: THREE.Mesh[];
  hit: THREE.Mesh;
  label: THREE.Sprite;
  labelAspect: number;
  zz: THREE.Sprite;
  mats: { body: THREE.MeshStandardMaterial; skin: THREE.MeshStandardMaterial; legs: THREE.MeshStandardMaterial; hair: THREE.MeshStandardMaterial };
  bodyColor: THREE.Color;
  // Animation state
  heading: number;
  phase: number;
  moveK: number;
  hoverK: number;
  offset: THREE.Vector3;
  last: THREE.Vector3;
  asleep: boolean;
  initialised: boolean;
}

const noRaycast = () => {};

function makeMeeple(p: AgentProfile, geo: ReturnType<typeof makeGeometries>, eyeMat: THREE.Material, hitMat: THREE.Material, zzMat: THREE.SpriteMaterial): Meeple {
  const h = hashString(p.id);
  const bodyColor = new THREE.Color(p.color);
  const mats = {
    body: new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.55 }),
    skin: new THREE.MeshStandardMaterial({ color: SKIN[h % SKIN.length], roughness: 0.6 }),
    legs: new THREE.MeshStandardMaterial({ color: new THREE.Color(p.color).multiplyScalar(0.35).lerp(new THREE.Color('#2d3440'), 0.6), roughness: 0.7 }),
    hair: new THREE.MeshStandardMaterial({ color: p.age >= 62 ? '#d8d6d0' : HAIR[(h >>> 3) % HAIR.length], roughness: 0.8 }),
  };

  const root = new THREE.Group();
  root.name = `agent:${p.id}`;
  const inner = new THREE.Group();
  inner.scale.setScalar(AGENT_SCALE);
  root.add(inner);

  const mk = (g: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(g, m);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.raycast = noRaycast;
    inner.add(mesh);
    return mesh;
  };
  const legL = mk(geo.leg, mats.legs, -0.5, 2.2, 0);
  const legR = mk(geo.leg, mats.legs, 0.5, 2.2, 0);
  mk(geo.body, mats.body, 0, 3.8, 0);
  const armL = mk(geo.arm, mats.body, -1.3, 5.0, 0);
  const armR = mk(geo.arm, mats.body, 1.3, 5.0, 0);
  armL.rotation.z = -0.12;
  armR.rotation.z = 0.12;
  mk(geo.head, mats.skin, 0, 6.55, 0);
  const hair = mk(geo.hair, mats.hair, 0, 6.62, -0.08);
  hair.rotation.x = -0.35;
  const eyes = [mk(geo.eye, eyeMat, -0.34, 6.7, 0.84), mk(geo.eye, eyeMat, 0.34, 6.7, 0.84)];
  for (const e of eyes) e.castShadow = false;

  // Invisible, generous pick target.
  const hit = new THREE.Mesh(geo.hit, hitMat);
  hit.userData.agentId = p.id;
  root.add(hit);

  const lab = makeLabel({ text: p.firstName, dot: p.color, fontSize: 30 });
  const label = new THREE.Sprite(labelMaterial(lab, false));
  label.center.set(0.5, 0);
  label.position.y = 7.4;
  label.renderOrder = 10;
  label.visible = false;
  root.add(label);

  const zz = new THREE.Sprite(zzMat);
  zz.center.set(0, 0);
  zz.position.set(1.0, 6.4, 0);
  zz.visible = false;
  zz.renderOrder = 9;
  root.add(zz);

  return {
    id: p.id,
    root,
    inner,
    legL,
    legR,
    armL,
    armR,
    eyes,
    hit,
    label,
    labelAspect: lab.aspect,
    zz,
    mats,
    bodyColor,
    heading: 0,
    phase: 0,
    moveK: 0,
    hoverK: 0,
    offset: new THREE.Vector3(),
    last: new THREE.Vector3(),
    asleep: false,
    initialised: false,
  };
}

function setDimmed(m: Meeple, dim: boolean) {
  for (const mat of Object.values(m.mats)) {
    mat.transparent = dim;
    mat.opacity = dim ? 0.32 : 1;
    mat.depthWrite = !dim;
    mat.needsUpdate = true;
  }
  for (const e of m.eyes) e.visible = !dim;
  m.root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && o !== m.hit) o.castShadow = !dim;
  });
}

const tmpTarget = new THREE.Vector3();
const sample: StreetSample = { x: 0, y: 0, dx: 0, dy: 0 };
const tmpEmissive = new THREE.Color();

export function Agents() {
  const gl = useThree((s) => s.gl);
  const selectAgent = useSimStore((s) => s.selectAgent);
  const hoverAgent = useSimStore((s) => s.hoverAgent);

  const { meeples, dispose } = useMemo(() => {
    const geo = makeGeometries();
    const eyeMat = new THREE.MeshBasicMaterial({ color: '#1d1a17' });
    const hitMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, transparent: true, opacity: 0 });
    const zzLabel = makeLabel({ text: 'z z z', fontSize: 26, background: 'rgba(40,52,90,0.78)', color: '#e8ecff', bold: true });
    const zzMat = labelMaterial(zzLabel);
    const meeples = AGENTS.map((p) => makeMeeple(p, geo, eyeMat, hitMat, zzMat));
    const zzAspect = zzLabel.aspect;
    for (const m of meeples) m.zz.userData.aspect = zzAspect;
    const dispose = () => {
      Object.values(geo).forEach((g) => g.dispose());
      eyeMat.dispose();
      hitMat.dispose();
      zzLabel.texture.dispose();
      zzMat.dispose();
      for (const m of meeples) {
        Object.values(m.mats).forEach((mt) => mt.dispose());
        (m.label.material as THREE.SpriteMaterial).map?.dispose();
        m.label.material.dispose();
      }
    };
    return { meeples, dispose };
  }, []);

  useEffect(() => dispose, [dispose]);

  // Restore the cursor if the scene unmounts while hovering.
  useEffect(
    () => () => {
      gl.domElement.style.cursor = '';
    },
    [gl],
  );

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    const s = useSimStore.getState();
    const pair = sampleFrames(activeRealityOf(s), s.time);
    const showAll = env.camDistance < ALL_NAMES_DISTANCE;
    const t = performance.now() / 1000;

    for (const m of meeples) {
      const a0 = pair?.f0.agents[m.id];
      const a1 = pair?.f1.agents[m.id] ?? a0;
      if (!pair || !a0 || !a1) {
        m.root.visible = false;
        m.hit.raycast = noRaycast;
        agentWorld.set(m.id, { pos: m.root.position, visible: false });
        continue;
      }
      const k = pair.k;
      let x: number;
      let z: number;
      const jump = Math.hypot(a1.x - a0.x, a1.y - a0.y);
      if (jump > 250) {
        // Teleport (should not happen within one minute): snap.
        x = k < 0.5 ? a0.x : a1.x;
        z = k < 0.5 ? a0.y : a1.y;
      } else {
        streetLerp(a0.x, a0.y, a1.x, a1.y, k, sample);
        x = sample.x;
        z = sample.y;
      }
      const riding = k < 0.5 ? a0.riding : a1.riding;
      const asleep = a0.asleep;
      const travelling = (a0.loc === '' || a1.loc === '') && !riding;

      // Movement direction from the trace (stable even when paused).
      const moving = jump > 2 && jump <= 250 && !riding;
      if (moving) {
        const target = Math.atan2(sample.dx, sample.dy);
        m.heading += angleDelta(m.heading, target) * damp(10, dt);
      }
      // Right-hand sidewalk offset while walking along streets.
      if (moving && travelling) {
        tmpTarget.set(-sample.dy * SIDEWALK_OFFSET, 0, sample.dx * SIDEWALK_OFFSET);
      } else tmpTarget.set(0, 0, 0);
      if (!m.initialised) m.offset.copy(tmpTarget);
      else m.offset.lerp(tmpTarget, damp(4, dt));

      m.root.position.set(x + m.offset.x, 0, z + m.offset.z);
      m.root.rotation.y = m.heading;

      // Walk cycle driven by the distance actually covered on screen (capped).
      const moved = m.initialised ? m.last.distanceTo(m.root.position) : 0;
      m.last.copy(m.root.position);
      m.initialised = true;
      m.moveK += ((moving ? 1 : 0) - m.moveK) * damp(8, dt);
      m.phase += Math.min(moved, dt * 16) * 0.9;
      const swing = Math.sin(m.phase) * 0.65 * m.moveK;
      m.legL.rotation.x = swing;
      m.legR.rotation.x = -swing;
      m.armL.rotation.x = -swing * 0.8;
      m.armR.rotation.x = swing * 0.8;
      m.inner.position.y = Math.abs(Math.sin(m.phase)) * 0.35 * m.moveK;

      // Visibility, sleep and hover / selection feedback.
      const visible = !riding;
      m.root.visible = visible;
      m.hit.raycast = visible ? THREE.Mesh.prototype.raycast : noRaycast;
      if (asleep !== m.asleep) {
        m.asleep = asleep;
        setDimmed(m, asleep);
      }
      m.zz.visible = asleep && visible;
      if (m.zz.visible) {
        sizeLabel(m.zz, m.zz.userData.aspect as number, 15);
        m.zz.position.y = 6.6 + Math.sin(t * 1.5 + m.phase) * 0.4;
      }

      const hovered = s.hoveredAgentId === m.id;
      const selected = s.selectedAgentId === m.id;
      m.hoverK += ((hovered || selected ? 1 : 0) - m.hoverK) * damp(10, dt);
      m.inner.scale.setScalar(AGENT_SCALE * (1 + m.hoverK * 0.14));
      tmpEmissive.copy(m.bodyColor).multiplyScalar(m.hoverK * 0.45);
      m.mats.body.emissive.copy(tmpEmissive);

      // When zoomed in, show everybody's name, except people hidden inside a building.
      const indoors = a0.loc !== '' && INDOOR.has(a0.loc);
      const showLabel = visible && (hovered || selected || (showAll && !indoors));
      m.label.visible = showLabel;
      if (showLabel) {
        sizeLabel(m.label, m.labelAspect, selected || hovered ? 22 : 18);
        (m.label.material as THREE.SpriteMaterial).opacity = asleep ? 0.6 : 1;
      }

      agentWorld.set(m.id, { pos: m.root.position, visible });
    }
  });

  const onOver = (e: ThreeEvent<PointerEvent>) => {
    const id = e.object.userData.agentId as string | undefined;
    if (!id) return;
    e.stopPropagation();
    hoverAgent(id);
    gl.domElement.style.cursor = 'pointer';
  };
  const onOut = (e: ThreeEvent<PointerEvent>) => {
    const id = e.object.userData.agentId as string | undefined;
    if (useSimStore.getState().hoveredAgentId === id) hoverAgent(null);
    gl.domElement.style.cursor = '';
  };
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    const id = e.object.userData.agentId as string | undefined;
    if (!id) return;
    e.stopPropagation();
    selectAgent(id);
  };

  return (
    <group>
      {meeples.map((m) => (
        <primitive key={m.id} object={m.root} onPointerOver={onOver} onPointerOut={onOut} onClick={onClick} />
      ))}
      <SelectionFx />
    </group>
  );
}

// ---------------------------------------------------------------------------
// Selection ring, soft spotlight, floating marker and hover ring
// ---------------------------------------------------------------------------

/** Height of each location's roof, used to lift the marker above buildings. */
const ROOF_HEIGHT = new Map(LOCATIONS.map((l) => [l.id, l.kind === 'park' || l.kind === 'bus_stop' ? 0 : l.height]));

function SelectionFx() {
  const ring = useRef<THREE.Mesh>(null);
  const glow = useRef<THREE.Mesh>(null);
  const hoverRing = useRef<THREE.Mesh>(null);
  const marker = useRef<THREE.Mesh>(null);
  const spot = useRef<THREE.SpotLight>(null);
  const scene = useThree((s) => s.scene);

  const mats = useMemo(
    () => ({
      ring: new THREE.MeshBasicMaterial({ color: '#ffd166', transparent: true, opacity: 0.95, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }),
      glow: new THREE.MeshBasicMaterial({ map: radialTexture(), color: '#ffd166', transparent: true, opacity: 0.6, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending }),
      hover: new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.7, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }),
      marker: new THREE.MeshStandardMaterial({ color: '#ffd166', emissive: '#ffb703', emissiveIntensity: 0.6, roughness: 0.4 }),
    }),
    [],
  );
  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats]);

  // The spotlight needs its target in the scene graph.
  useEffect(() => {
    const l = spot.current;
    if (!l) return;
    scene.add(l.target);
    return () => {
      scene.remove(l.target);
    };
  }, [scene]);

  useFrame((_, dt) => {
    const s = useSimStore.getState();
    const t = performance.now() / 1000;
    const sel = s.selectedAgentId ? agentWorld.get(s.selectedAgentId) : undefined;
    const showSel = !!sel;
    if (ring.current && glow.current && marker.current) {
      ring.current.visible = showSel && sel!.visible;
      glow.current.visible = ring.current.visible;
      marker.current.visible = showSel;
      if (sel) {
        const p = sel.pos;
        const pulse = 1 + Math.sin(t * 3) * 0.08;
        ring.current.position.set(p.x, 0.75, p.z);
        ring.current.scale.setScalar(pulse);
        glow.current.position.set(p.x, 0.7, p.z);
        // Floating marker, lifted above the roof if the person is indoors.
        const frame = activeRealityOf(s).frameAt(Math.floor(s.time));
        const loc = frame?.agents[s.selectedAgentId!]?.loc ?? '';
        const roof = loc ? ROOF_HEIGHT.get(loc) ?? 0 : 0;
        const base = roof > 0 ? roof + 12 : 15;
        marker.current.position.set(p.x, base + Math.sin(t * 2.2) * 0.8, p.z);
        marker.current.rotation.y += dt * 1.5;
      }
    }
    if (spot.current) {
      const l = spot.current;
      if (sel && sel.visible) {
        l.position.set(sel.pos.x, 55, sel.pos.z + 12);
        l.target.position.set(sel.pos.x, 0, sel.pos.z);
        l.intensity += (3200 * (0.55 + env.night * 0.8) - l.intensity) * damp(6, dt);
      } else l.intensity += (0 - l.intensity) * damp(6, dt);
    }
    if (hoverRing.current) {
      const hov = s.hoveredAgentId && s.hoveredAgentId !== s.selectedAgentId ? agentWorld.get(s.hoveredAgentId) : undefined;
      hoverRing.current.visible = !!hov && hov.visible;
      if (hov) hoverRing.current.position.set(hov.pos.x, 0.72, hov.pos.z);
    }
  });

  return (
    <group>
      <mesh ref={ring} rotation-x={-Math.PI / 2} material={mats.ring} visible={false} renderOrder={3}>
        <ringGeometry args={[4.3, 5.4, 48]} />
      </mesh>
      <mesh ref={glow} rotation-x={-Math.PI / 2} material={mats.glow} visible={false} renderOrder={2}>
        <planeGeometry args={[18, 18]} />
      </mesh>
      <mesh ref={hoverRing} rotation-x={-Math.PI / 2} material={mats.hover} visible={false} renderOrder={3}>
        <ringGeometry args={[4.0, 4.7, 40]} />
      </mesh>
      <mesh ref={marker} material={mats.marker} visible={false} rotation-x={Math.PI}>
        <coneGeometry args={[1.8, 3.6, 4]} />
      </mesh>
      <spotLight ref={spot} intensity={0} angle={0.2} penumbra={0.85} decay={2} distance={0} color="#fff1cc" />
    </group>
  );
}
