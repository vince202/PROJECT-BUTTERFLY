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
import { HttpAdvisor, createEmbedder } from '../ai/client';
import { DAY_END, DAY_START, type AgentId, type EventId, type Intervention, type Minute } from '../sim/types';
import { normalizeSpeed, simMinutes, type Speed } from './speed';
import { canApplyGesture, closeLoop, newGame, nextLoop, type GameState } from '../sim/game';
import { getLocale, setLocale as setI18nLocale, t, tIn, type Locale } from '../i18n';

export type { Speed } from './speed';
export type RealityId = 'A' | 'B';
export type PanelId = 'butterfly' | 'causal' | 'compare' | 'report' | null;

/** Seed used by the demonstration scenario (see README). */
export const DEMO_SEED = 51;
const STORAGE_KEY = 'butterfly:v1';
const GAME_KEY = 'butterfly:game';
const LOCALE_KEY = 'butterfly:locale';

/** Saved language, else the browser language (anything starting with 'en' → English), else French. */
function detectLocale(): Locale {
  try {
    const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(LOCALE_KEY) : null;
    if (saved === 'fr' || saved === 'en') return saved;
  } catch {
    /* storage unavailable */
  }
  const nav = typeof window !== 'undefined' && typeof navigator !== 'undefined' ? navigator.language : '';
  return nav && nav.toLowerCase().startsWith('en') ? 'en' : 'fr';
}

function persistLocale(locale: Locale) {
  try {
    localStorage.setItem(LOCALE_KEY, locale);
  } catch {
    /* storage unavailable */
  }
}

interface Persisted {
  seed: number;
  interventionsB: Intervention[];
  time: number;
  selectedAgentId: AgentId | null;
  /** Interventions of the branch kept for each past day (to rebuild the current day). */
  history?: Intervention[][];
  /** Playback speed preset (×1 = real time). Older or unknown values fall back to ×20. */
  speed?: number;
}

function loadPersisted(): Persisted | null {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    return raw ? (JSON.parse(raw) as Persisted) : null;
  } catch {
    return null;
  }
}

function loadGame(): GameState | null {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(GAME_KEY) : null;
    return raw ? (JSON.parse(raw) as GameState) : null;
  } catch {
    return null;
  }
}

function persistGame(game: GameState | null) {
  try {
    if (game) localStorage.setItem(GAME_KEY, JSON.stringify(game));
    else localStorage.removeItem(GAME_KEY);
  } catch {
    /* storage unavailable */
  }
}

/** Last persisted speed, merged into every write (callers only pass the simulation fields). */
let persistedSpeed: Speed | undefined;

function persist(p: Persisted) {
  if (p.speed !== undefined) persistedSpeed = normalizeSpeed(p.speed);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...p, speed: persistedSpeed }));
  } catch {
    /* storage unavailable */
  }
}

export interface AiStatus {
  checked: boolean;
  /** Narration / interpretation model available. */
  enabled: boolean;
  model?: string;
  message?: string;
  /** Server-side decision advisor ('jev', 'anthropic') when configured. */
  advisor?: string;
  advisorModel?: string;
  embedder?: string;
  embedModel?: string;
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
  /** Interface language; realities are generated in it (changing it regenerates them). */
  locale: Locale;

  activeReality: () => Reality;
  setSeed: (seed: number) => void;
  restart: () => void;
  play: () => void;
  pause: () => void;
  togglePlay: () => void;
  setSpeed: (s: Speed) => void;
  seek: (t: Minute) => void;
  /** Advance the display clock by `dtSeconds` of real time (×1 = real time: one simulated minute per 60 s). */
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
  /** Switch language: updates i18n, regenerates realities A / B / comparison and bumps `generation`. */
  setLocale: (locale: Locale) => void;
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

  // --- Time-loop game (the player follows one inhabitant) ---
  /** Current game, or null when the app is used as a free laboratory. */
  game: GameState | null;
  /** Start a game: follow `agentId`, loop 1, reality B starts as a copy of A, clock at 06:00. */
  startGame: (agentId: AgentId) => void;
  /** Leave the game (keeps the realities as they are). */
  abandonGame: () => void;
  /** Spend a gesture: apply an intervention to reality B (forward only, within budget). */
  applyGesture: (iv: Intervention) => { ok: boolean; reason?: string };
  /** Close the loop at the current time (midnight by default): record outcome and gestures. */
  endLoop: () => void;
  /** Start the next loop of the same quest: fresh reality B, clock at 06:00. */
  restartLoop: () => void;
}

export type PolicyMode = 'utility' | 'advised';
/** Spectator: immersive city with minimal overlays. Laboratory: full analytical interface. */
export type UiMode = 'spectator' | 'lab';

function buildA(seed: number): Reality {
  return new Reality({ id: 'A', name: t('common.reality_a'), seed, interventions: [] }).generate();
}

/** Rebuild day N by replaying the kept branch of every previous day. */
function rebuildDays(seed: number, history: Intervention[][]): Reality {
  let r = buildA(seed);
  for (const interventions of history) {
    const kept = interventions.length ? buildB(r, interventions) : r;
    r = nextDayReality(kept, 'A', t('common.reality_a')).generate();
  }
  return r;
}

function buildB(a: Reality, interventions: Intervention[], name = t('common.reality_b')): Reality {
  let r: Reality | null = null;
  for (const iv of interventions) r = r ? forkReality(r, iv, 'B', name) : forkReality(a, iv, 'B', name);
  return (r ?? forkReality(a, interventions[0], 'B', name)).generate();
}

// The language must be active before the first reality is generated (its labels are produced in it).
const initialLocale = detectLocale();
setI18nLocale(initialLocale);
const persisted = loadPersisted();
const initialSeed = persisted?.seed ?? DEMO_SEED;
const initialHistory = persisted?.history ?? [];
const initialA = initialHistory.length ? rebuildDays(initialSeed, initialHistory) : buildA(initialSeed);
const initialB = persisted?.interventionsB?.length ? buildB(initialA, persisted.interventionsB) : null;
const initialSpeed = normalizeSpeed(persisted?.speed);
persistedSpeed = initialSpeed;

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
  speed: initialSpeed,
  selectedAgentId: persisted?.selectedAgentId ?? null,
  followAgentId: null,
  selectedEventId: null,
  hoveredAgentId: null,
  panel: null,
  ai: { checked: false, enabled: false },
  generation: 1,
  locale: initialLocale,

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
  play: () => set((s) => ({ playing: true, time: s.time >= DAY_END ? (s.game && s.game.phase !== 'playing' ? DAY_END : DAY_START) : s.time })),
  pause: () => set({ playing: false }),
  togglePlay: () => (get().playing ? get().pause() : get().play()),
  setSpeed: (speed) => {
    const s = get();
    set({ speed });
    persist({ seed: s.seed, interventionsB: s.realityB?.def.interventions ?? [], time: s.time, selectedAgentId: s.selectedAgentId, history: s.history, speed });
  },
  seek: (t) => {
    const s0 = get();
    // In a game, time only flows forward: no rewinding inside a loop.
    const floor = s0.game && s0.game.phase === 'playing' ? Math.floor(s0.time) : DAY_START;
    const time = Math.max(floor, Math.min(DAY_END, t));
    set({ time });
    persist({ seed: get().seed, interventionsB: get().realityB?.def.interventions ?? [], time, selectedAgentId: get().selectedAgentId, history: get().history });
  },
  tick: (dtSeconds) => {
    const s = get();
    if (!s.playing) return;
    const next = s.time + simMinutes(dtSeconds, s.speed);
    if (next >= DAY_END) {
      set({ time: DAY_END, playing: false });
      if (s.game && s.game.phase === 'playing') get().endLoop();
    } else set({ time: next });
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
    const realityB = forkReality(base, intervention, 'B', t('common.reality_b')).generate();
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
  setLocale: (locale) => {
    const s = get();
    if (locale === s.locale && locale === getLocale()) return;
    // Is the displayed reality B the game's loop (named differently)?
    const wasLoop = !!s.realityB && s.realityB.def.name === tIn(s.locale, 'common.reality_b_loop');
    setI18nLocale(locale);
    persistLocale(locale);
    const realityA = s.history.length ? rebuildDays(s.seed, s.history) : buildA(s.seed);
    const interventions = s.realityB?.def.interventions ?? [];
    const realityB = interventions.length ? buildB(realityA, interventions, wasLoop ? t('common.reality_b_loop') : undefined) : null;
    set((st) => ({
      locale,
      realityA,
      realityB,
      comparison: realityB ? compareRealities(realityA, realityB) : null,
      activeRealityId: realityB ? st.activeRealityId : 'A',
      advisorInfo: null,
      generation: st.generation + 1,
    }));
    if (s.policyMode === 'advised') void get().refineAdvised();
  },
  nextDay: () => {
    const s = get();
    const kept = s.activeRealityId === 'B' && s.realityB ? s.realityB : s.realityA;
    const realityA = nextDayReality(kept, 'A', t('common.reality_a')).generate();
    const history = [...s.history, kept.def.interventions];
    set((st) => ({ realityA, realityB: null, comparison: null, activeRealityId: 'A', day: st.day + 1, history, time: DAY_START, playing: false, selectedEventId: null, panel: null, generation: st.generation + 1 }));
    persist({ seed: s.seed, interventionsB: [], time: DAY_START, selectedAgentId: s.selectedAgentId, history });
    if (s.policyMode === 'advised') void get().refineAdvised();
  },
  game: loadGame(),
  startGame: (agentId) => {
    const s = get();
    const game = newGame(s.realityA, agentId);
    persistGame(game);
    set((st) => ({ game, realityB: null, comparison: null, activeRealityId: 'A', time: DAY_START, playing: false, selectedAgentId: agentId, followAgentId: agentId, selectedEventId: null, panel: null, uiMode: 'spectator', generation: st.generation + 1 }));
    persist({ seed: s.seed, interventionsB: [], time: DAY_START, selectedAgentId: agentId, history: s.history });
  },
  abandonGame: () => {
    persistGame(null);
    set({ game: null, followAgentId: null });
  },
  applyGesture: (iv) => {
    const s = get();
    if (!s.game) return { ok: false, reason: t('ui.store_no_game') };
    const current = s.realityB?.def.interventions ?? [];
    // Interventions fire on exact minutes: never let a fractional display time slip through.
    iv = { ...iv, t: Math.round(iv.t) };
    const check = canApplyGesture(s.game, current, iv, s.time);
    if (!check.ok) return check;
    const base = s.realityB ?? s.realityA;
    const realityB = forkReality(base, iv, 'B', t('common.reality_b_loop')).generate();
    const comparison = compareRealities(s.realityA, realityB);
    set((st) => ({ realityB, comparison, activeRealityId: 'B', generation: st.generation + 1 }));
    persist({ seed: s.seed, interventionsB: realityB.def.interventions, time: s.time, selectedAgentId: s.selectedAgentId, history: s.history });
    return { ok: true };
  },
  endLoop: () => {
    const s = get();
    if (!s.game || s.game.phase !== 'playing') return;
    const played = s.realityB ?? s.realityA;
    const destinies = s.comparison?.arcChanges.map((c) => c.text) ?? [];
    const game = closeLoop(s.game, played, destinies, Math.min(DAY_END, Math.floor(s.time)));
    persistGame(game);
    set({ game, playing: false, time: DAY_END });
  },
  restartLoop: () => {
    const s = get();
    if (!s.game) return;
    const game = nextLoop(s.game);
    persistGame(game);
    set((st) => ({ game, realityB: null, comparison: null, activeRealityId: 'A', time: DAY_START, playing: false, selectedEventId: null, followAgentId: game.agentId, selectedAgentId: game.agentId, generation: st.generation + 1 }));
    persist({ seed: s.seed, interventionsB: [], time: DAY_START, selectedAgentId: game.agentId, history: s.history });
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
    set({ policyMode: 'advised', advising: true, advisorInfo: t('ui.store_advisor_consulting') });
    await get().refineAdvised();
  },
  refineAdvised: async () => {
    const s = get();
    const advisor: DecisionAdvisor = s.ai.advisor ? new HttpAdvisor() : new MockAdvisor();
    const online = advisor.name === 'http';
    const advisorLabel = online ? t(s.ai.advisor === 'jev' ? 'ui.store_advisor_jev' : 'ui.store_advisor_ai') : t('ui.store_advisor_mock');
    const policy = s.realityA.def.policy instanceof AdvisedPolicy ? s.realityA.def.policy : new AdvisedPolicy();
    set({ advising: true, advisorInfo: t('ui.store_advisor_working', { advisor: advisorLabel }) });
    try {
      const opts = { policy, maxPasses: online ? 4 : 6, maxRequestsPerPass: online ? 40 : 150, embedder: createEmbedder(!!s.ai.embedder) };
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
      set((st) => ({ realityA, realityB, comparison: realityB ? compareRealities(realityA, realityB) : null, advising: false, advisorInfo: t('ui.store_advisor_done', { advisor: advisorLabel, n: applied }), generation: st.generation + 1 }));
    } catch (err) {
      set({ advising: false, advisorInfo: t('ui.store_advisor_unavailable', { reason: err instanceof Error ? err.message : String(err) }) });
    }
  },
}));

/** Convenience selector: the reality currently displayed. */
export function useActiveReality(): Reality {
  return useSimStore((s) => (s.activeRealityId === 'B' && s.realityB ? s.realityB : s.realityA));
}
