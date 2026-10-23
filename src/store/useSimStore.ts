/**
 * Global application state (Zustand).
 *
 * The store owns the two realities (A = original, B = modified), the display
 * clock, playback, selection and panel visibility. Simulation data is produced
 * by the engine (src/sim) and read here; rendering never mutates it.
 */

import { create } from 'zustand';
import { compareRealities, type Comparison } from '../sim/compare';
import { Reality, forkReality, nextDayReality } from '../sim/reality';
import { AdvisedPolicy, MockAdvisor, generateWithAdvisor, type DecisionAdvisor } from '../sim/advisor';
import { HttpAdvisor } from '../ai/client';
import { DAY_END, DAY_START, type AgentId, type EventId, type Intervention, type Minute } from '../sim/types';

export type Speed = 1 | 2 | 10 | 60;
export type RealityId = 'A' | 'B';
export type PanelId = 'butterfly' | 'causal' | 'compare' | 'report' | null;

/** Seed used by the demonstration scenario (see README). */
export const DEMO_SEED = 51;
const STORAGE_KEY = 'butterfly:v1';

interface Persisted {
  seed: number;
  interventionsB: Intervention[];
  time: number;
  selectedAgentId: AgentId | null;
  /** Interventions of the branch kept for each past day (to rebuild the current day). */
  history?: Intervention[][];
}

function loadPersisted(): Persisted | null {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    return raw ? (JSON.parse(raw) as Persisted) : null;
  } catch {
    return null;
  }
}

function persist(p: Persisted) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable */
  }
}

export interface AiStatus {
  checked: boolean;
  enabled: boolean;
  model?: string;
  message?: string;
}

export interface SimStore {
  seed: number;
  /** Current day index (1 = first day). */
  day: number;
  /** Kept branch (interventions) of each previous day. */
  history: Intervention[][];
  realityA: Reality;
  realityB: Reality | null;
  comparison: Comparison | null;
  activeRealityId: RealityId;
  /** Display time in minutes since midnight (float, 360..1440). */
  time: number;
  playing: boolean;
  speed: Speed;
  selectedAgentId: AgentId | null;
  followAgentId: AgentId | null;
  selectedEventId: EventId | null;
  hoveredAgentId: AgentId | null;
  panel: PanelId;
  ai: AiStatus;
  /** Bumps whenever a reality is (re)generated so views can refresh. */
  generation: number;

  activeReality: () => Reality;
  setSeed: (seed: number) => void;
  restart: () => void;
  play: () => void;
  pause: () => void;
  togglePlay: () => void;
  setSpeed: (s: Speed) => void;
  seek: (t: Minute) => void;
  /** Advance the display clock by `dtSeconds` of real time (×1 = one simulated minute per second). */
  tick: (dtSeconds: number) => void;
  generateAll: () => void;
  selectAgent: (id: AgentId | null) => void;
  followAgent: (id: AgentId | null) => void;
  selectEvent: (id: EventId | null) => void;
  hoverAgent: (id: AgentId | null) => void;
  setPanel: (p: PanelId) => void;
  createRealityB: (intervention: Intervention) => void;
  discardRealityB: () => void;
  switchReality: (id: RealityId) => void;
  setAi: (ai: AiStatus) => void;
  /** Start the next day from the end of the currently displayed reality (A or B). */
  nextDay: () => void;
  /** Decision policy: pure utility scores, or open choices arbitrated by an advisor (LLM when available, deterministic mock otherwise). */
  policyMode: PolicyMode;
  advising: boolean;
  advisorInfo: string | null;
  uiMode: UiMode;
  setUiMode: (m: UiMode) => void;
  toggleUiMode: () => void;
  setPolicyMode: (mode: PolicyMode) => Promise<void>;
  /** Ask the advisor about the open choices of the current realities (advised mode only). */
  refineAdvised: () => Promise<void>;
}

export type PolicyMode = 'utility' | 'advised';
/** Spectator: immersive city with minimal overlays. Laboratory: full analytical interface. */
export type UiMode = 'spectator' | 'lab';

function buildA(seed: number): Reality {
  return new Reality({ id: 'A', name: 'Réalité A — originale', seed, interventions: [] }).generate();
}

/** Rebuild day N by replaying the kept branch of every previous day. */
function rebuildDays(seed: number, history: Intervention[][]): Reality {
  let r = buildA(seed);
  for (const interventions of history) {
    const kept = interventions.length ? buildB(r, interventions) : r;
    r = nextDayReality(kept).generate();
  }
  return r;
}

function buildB(a: Reality, interventions: Intervention[]): Reality {
  let r: Reality | null = null;
  for (const iv of interventions) r = r ? forkReality(r, iv, 'B', 'Réalité B — modifiée') : forkReality(a, iv, 'B', 'Réalité B — modifiée');
  return (r ?? forkReality(a, interventions[0], 'B', 'Réalité B — modifiée')).generate();
}

const persisted = loadPersisted();
const initialSeed = persisted?.seed ?? DEMO_SEED;
const initialHistory = persisted?.history ?? [];
const initialA = initialHistory.length ? rebuildDays(initialSeed, initialHistory) : buildA(initialSeed);
const initialB = persisted?.interventionsB?.length ? buildB(initialA, persisted.interventionsB) : null;

export const useSimStore = create<SimStore>((set, get) => ({
  policyMode: 'utility',
  advising: false,
  advisorInfo: null,
  uiMode: 'lab',
  setUiMode: (uiMode) => set({ uiMode }),
  toggleUiMode: () => set((s) => ({ uiMode: s.uiMode === 'lab' ? 'spectator' : 'lab' })),
  seed: initialSeed,
  day: initialHistory.length + 1,
  history: initialHistory,
  realityA: initialA,
  realityB: initialB,
  comparison: initialB ? compareRealities(initialA, initialB) : null,
  activeRealityId: 'A',
  time: Math.max(DAY_START, Math.min(DAY_END, persisted?.time ?? DAY_START)),
  playing: false,
  speed: 10,
  selectedAgentId: persisted?.selectedAgentId ?? null,
  followAgentId: null,
  selectedEventId: null,
  hoveredAgentId: null,
  panel: null,
  ai: { checked: false, enabled: false },
  generation: 1,

  activeReality: () => (get().activeRealityId === 'B' && get().realityB ? get().realityB! : get().realityA),

  setSeed: (seed) => {
    const realityA = buildA(seed);
    set((s) => ({ seed, day: 1, history: [], realityA, realityB: null, comparison: null, activeRealityId: 'A', time: DAY_START, playing: false, selectedEventId: null, generation: s.generation + 1 }));
    persist({ seed, interventionsB: [], time: DAY_START, selectedAgentId: get().selectedAgentId, history: [] });
  },
  restart: () => {
    set({ time: DAY_START, playing: false });
    persist({ seed: get().seed, interventionsB: get().realityB?.def.interventions ?? [], time: DAY_START, selectedAgentId: get().selectedAgentId, history: get().history });
  },
  play: () => set((s) => ({ playing: true, time: s.time >= DAY_END ? DAY_START : s.time })),
  pause: () => set({ playing: false }),
  togglePlay: () => (get().playing ? get().pause() : get().play()),
  setSpeed: (speed) => set({ speed }),
  seek: (t) => {
    const time = Math.max(DAY_START, Math.min(DAY_END, t));
    set({ time });
    persist({ seed: get().seed, interventionsB: get().realityB?.def.interventions ?? [], time, selectedAgentId: get().selectedAgentId, history: get().history });
  },
  tick: (dtSeconds) => {
    const s = get();
    if (!s.playing) return;
    const next = s.time + dtSeconds * s.speed;
    if (next >= DAY_END) set({ time: DAY_END, playing: false });
    else set({ time: next });
  },
  generateAll: () => {
    get().realityA.generate();
    get().realityB?.generate();
    set((s) => ({ time: DAY_END, playing: false, generation: s.generation + 1 }));
  },
  selectAgent: (id) => {
    set({ selectedAgentId: id, selectedEventId: null, followAgentId: id ? get().followAgentId : null });
    persist({ seed: get().seed, interventionsB: get().realityB?.def.interventions ?? [], time: get().time, selectedAgentId: id, history: get().history });
  },
  followAgent: (id) => set({ followAgentId: id, selectedAgentId: id ?? get().selectedAgentId }),
  selectEvent: (id) => set({ selectedEventId: id }),
  hoverAgent: (id) => set({ hoveredAgentId: id }),
  setPanel: (panel) => set((s) => ({ panel: s.panel === panel ? null : panel })),
  createRealityB: (intervention) => {
    const s = get();
    const base = s.realityB ?? s.realityA;
    const realityB = forkReality(base, intervention, 'B', 'Réalité B — modifiée').generate();
    const comparison = compareRealities(s.realityA, realityB);
    set((st) => ({ realityB, comparison, activeRealityId: 'B', generation: st.generation + 1, panel: 'compare' }));
    persist({ seed: s.seed, interventionsB: realityB.def.interventions, time: s.time, selectedAgentId: s.selectedAgentId, history: s.history });
    if (s.policyMode === 'advised') void get().refineAdvised();
  },
  discardRealityB: () => {
    set((s) => ({ realityB: null, comparison: null, activeRealityId: 'A', generation: s.generation + 1 }));
    persist({ seed: get().seed, interventionsB: [], time: get().time, selectedAgentId: get().selectedAgentId, history: get().history });
  },
  switchReality: (id) => set({ activeRealityId: id === 'B' && !get().realityB ? 'A' : id }),
  setAi: (ai) => set({ ai }),
  nextDay: () => {
    const s = get();
    const kept = s.activeRealityId === 'B' && s.realityB ? s.realityB : s.realityA;
    const realityA = nextDayReality(kept).generate();
    const history = [...s.history, kept.def.interventions];
    set((st) => ({ realityA, realityB: null, comparison: null, activeRealityId: 'A', day: st.day + 1, history, time: DAY_START, playing: false, selectedEventId: null, panel: null, generation: st.generation + 1 }));
    persist({ seed: s.seed, interventionsB: [], time: DAY_START, selectedAgentId: s.selectedAgentId, history });
    if (s.policyMode === 'advised') void get().refineAdvised();
  },
  setPolicyMode: async (mode) => {
    const s = get();
    if (s.advising || mode === s.policyMode) return;
    if (mode === 'utility') {
      const realityA = new Reality({ ...s.realityA.def, policy: undefined }).generate();
      const realityB = s.realityB ? new Reality({ ...s.realityB.def, policy: undefined }).generate() : null;
      set((st) => ({ policyMode: 'utility', realityA, realityB, comparison: realityB ? compareRealities(realityA, realityB) : null, advisorInfo: null, generation: st.generation + 1 }));
      return;
    }
    set({ policyMode: 'advised', advising: true, advisorInfo: 'Consultation du conseiller…' });
    await get().refineAdvised();
  },
  refineAdvised: async () => {
    const s = get();
    const advisor: DecisionAdvisor = s.ai.enabled ? new HttpAdvisor() : new MockAdvisor();
    const online = advisor.name === 'http';
    const policy = s.realityA.def.policy instanceof AdvisedPolicy ? s.realityA.def.policy : new AdvisedPolicy();
    set({ advising: true, advisorInfo: online ? 'Le conseiller IA arbitre les choix ouverts…' : 'Le conseiller simulé arbitre les choix ouverts…' });
    try {
      const opts = { policy, maxPasses: online ? 4 : 6, maxRequestsPerPass: online ? 40 : 150 };
      const { policy: _ignoredA, ...defA } = s.realityA.def;
      void _ignoredA;
      const resA = await generateWithAdvisor(defA, advisor, opts);
      let realityA = resA.reality;
      let realityB: Reality | null = null;
      let applied = resA.applied;
      if (s.realityB) {
        const { policy: _ignoredB, ...defB } = s.realityB.def;
        void _ignoredB;
        const resB = await generateWithAdvisor(defB, advisor, opts);
        realityB = resB.reality;
        applied += resB.applied;
        // Keep A consistent with the final shared cache.
        realityA = new Reality({ ...defA, policy }).generate();
      }
      set((st) => ({ realityA, realityB, comparison: realityB ? compareRealities(realityA, realityB) : null, advising: false, advisorInfo: `${online ? 'Conseiller IA' : 'Conseiller simulé (sans clé API)'} : ${applied} décisions arbitrées`, generation: st.generation + 1 }));
    } catch (err) {
      set({ advising: false, advisorInfo: `Conseiller indisponible (${err instanceof Error ? err.message : String(err)}) — scores utilitaires conservés` });
    }
  },
}));

/** Convenience selector: the reality currently displayed. */
export function useActiveReality(): Reality {
  return useSimStore((s) => (s.activeRealityId === 'B' && s.realityB ? s.realityB : s.realityA));
}
