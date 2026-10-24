/**
 * Interface state of the player mode (time-loop game), kept apart from the
 * simulation store: which overlays are open, the quest alerts currently shown
 * as bubbles / feed toasts, and small animation counters. Nothing here is
 * persisted or read by the simulation.
 */

import { create } from 'zustand';
import type { QuestAlert } from '../sim/quest';

/** An alert on screen (bubble above the inhabitant and line in the feed). */
export interface LiveAlert {
  key: string;
  alert: QuestAlert;
  /** performance.now() at which it starts leaving. */
  until: number;
  leaving?: boolean;
  /** Monotonic order (newest = highest). */
  order: number;
}

export interface GameUi {
  /** The « Choisir qui suivre » screen was dismissed (plain spectator). */
  pickerDismissed: boolean;
  composerOpen: boolean;
  notebookOpen: boolean;
  /** The end-of-loop overlay was closed to look at the city (reopened from the HUD). */
  bilanHidden: boolean;
  /** The clock is spinning back to 06:00 before the next loop. */
  rewinding: boolean;
  /** Bumps when a gesture is applied (pulse of the « Réalité B » badge). */
  pulse: number;
  alerts: LiveAlert[];
  /** Hovering the feed holds the alerts. */
  held: boolean;

  setPickerDismissed: (v: boolean) => void;
  setComposerOpen: (v: boolean) => void;
  setNotebookOpen: (v: boolean) => void;
  setBilanHidden: (v: boolean) => void;
  setRewinding: (v: boolean) => void;
  bumpPulse: () => void;
  setAlerts: (fn: (a: LiveAlert[]) => LiveAlert[]) => void;
  setHeld: (v: boolean) => void;
  /** Close the topmost overlay; returns false when none was open. */
  closeTop: () => boolean;
}

export const useGameUi = create<GameUi>((set, get) => ({
  pickerDismissed: false,
  composerOpen: false,
  notebookOpen: false,
  bilanHidden: false,
  rewinding: false,
  pulse: 0,
  alerts: [],
  held: false,
  setPickerDismissed: (pickerDismissed) => set({ pickerDismissed }),
  setComposerOpen: (composerOpen) => set({ composerOpen }),
  setNotebookOpen: (notebookOpen) => set({ notebookOpen }),
  setBilanHidden: (bilanHidden) => set({ bilanHidden }),
  setRewinding: (rewinding) => set({ rewinding }),
  bumpPulse: () => set((s) => ({ pulse: s.pulse + 1 })),
  setAlerts: (fn) => set((s) => ({ alerts: fn(s.alerts) })),
  setHeld: (held) => set({ held }),
  closeTop: () => {
    const s = get();
    if (s.composerOpen) return set({ composerOpen: false }), true;
    if (s.notebookOpen) return set({ notebookOpen: false }), true;
    return false;
  },
}));

// Exposed for debugging and for the visual smoke test (scripts/screenshot.mjs --game).
declare global {
  interface Window {
    __butterflyGameUi?: typeof useGameUi;
  }
}
if (typeof window !== 'undefined') window.__butterflyGameUi = useGameUi;
