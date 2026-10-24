import { describe, expect, it } from 'vitest';
import { Reality } from '../src/sim/reality';
import { AGENTS } from '../src/sim/population';
import { LOCATIONS } from '../src/sim/city';
import { AgentMotion, isIndoorVisit, newPose } from '../src/render/motion';

// Rendering layer only: the smoothed motion reads the trace, never changes it.
const reality = new Reality({ id: 'A', name: 'A', seed: 51, interventions: [] }).generate();
const KIND = new Map(LOCATIONS.map((l) => [l.id, l.kind]));

describe('Mouvement affiché (src/render/motion.ts)', () => {
  it('ne modifie pas la trace de la simulation', () => {
    const before = JSON.stringify(reality.trace);
    const pose = newPose();
    for (const a of AGENTS) {
      const m = new AgentMotion(a.id);
      for (let t = 360; t <= 1440; t += 0.37) m.resolve(reality, t, pose);
    }
    expect(JSON.stringify(reality.trace)).toBe(before);
  });

  it('les trajets sont continus (pas de saut) hors bus', () => {
    const pose = newPose();
    for (const a of AGENTS.slice(0, 5)) {
      const m = new AgentMotion(a.id);
      let px = NaN;
      let pz = NaN;
      for (let t = 400; t <= 1400; t += 0.02) {
        const f0 = reality.frameAt(Math.floor(t))!.agents[a.id];
        const f1 = reality.frameAt(Math.floor(t) + 1)!.agents[a.id];
        const fp = reality.frameAt(Math.floor(t) - 1)!.agents[a.id];
        m.resolve(reality, t, pose);
        const special = f0.riding || f1.riding || fp.riding || Math.hypot(f1.x - f0.x, f1.y - f0.y) > 250 || Math.hypot(f0.x - fp.x, f0.y - fp.y) > 250;
        if (!special && !Number.isNaN(px)) expect(Math.hypot(pose.x - px, pose.z - pz)).toBeLessThan(3);
        px = pose.x;
        pz = pose.z;
      }
    }
  });

  it('à l’intérieur d’un bâtiment hors des allers-retours à la porte, dehors au parc et aux arrêts', () => {
    const pose = newPose();
    let inside = 0;
    let outside = 0;
    for (const a of AGENTS) {
      const m = new AgentMotion(a.id);
      for (let t = 361; t < 1439; t += 7) {
        const f = reality.frameAt(t)!.agents[a.id];
        const prev = reality.frameAt(t - 1)!.agents[a.id];
        const next = reality.frameAt(t + 1)!.agents[a.id];
        m.resolve(reality, t + 0.5, pose);
        const kind = f.loc ? KIND.get(f.loc) : undefined;
        if (!f.loc || f.riding) continue;
        if (kind === 'park' || kind === 'bus_stop') {
          expect(pose.inside).toBe(false);
          outside++;
        } else if (kind !== 'cafe' && prev.loc === f.loc && next.loc === f.loc && prev.x === f.x && next.x === f.x) {
          // Settled in a building (not on its door leg): drawn as an indicator at the door.
          expect(pose.inside).toBe(true);
          expect(pose.door?.locId).toBe(f.loc);
          inside++;
        }
      }
    }
    expect(inside).toBeGreaterThan(100);
    expect(outside).toBeGreaterThan(10);
  });

  it('le café garde une partie des clients en terrasse, le personnel à l’intérieur', () => {
    const terrace = AGENTS.filter((a) => a.workplaceId !== 'cafe').flatMap((a) => [400, 500, 600, 700, 800].map((t) => isIndoorVisit(a.id, 'cafe', t)));
    const share = terrace.filter((x) => !x).length / terrace.length;
    expect(share).toBeGreaterThan(0.4);
    expect(share).toBeLessThan(0.8);
    for (const a of AGENTS.filter((x) => x.workplaceId === 'cafe')) expect(isIndoorVisit(a.id, 'cafe', 500)).toBe(true);
    expect(isIndoorVisit('alice', 'park', 500)).toBe(false);
    expect(isIndoorVisit('alice', 'library', 500)).toBe(true);
  });
});
