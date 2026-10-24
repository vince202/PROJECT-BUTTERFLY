/**
 * UI-mode helpers: the animated spectator / laboratory switch, exit-animation
 * presence and global keyboard shortcuts.
 */

import { useEffect, useRef, useState } from 'react';
import { useSimStore, type UiMode } from '../store/useSimStore';
import { useGameUi } from '../store/gameUi';
import { stepSpeed } from '../store/speed';

/** Duration of the exit animation of the outgoing mode (ms). Must match `--mode-out` in styles.css. */
export const MODE_OUT_MS = 200;

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

/**
 * The mode actually laid out, lagging the store's `uiMode` by the exit
 * animation: when the mode changes, the outgoing regions play their exit
 * animation (`leaving`), then the layout switches once and the incoming
 * regions play their entry animation. The 3D canvas is resized only once.
 */
export function useModeTransition(): { mode: UiMode; leaving: boolean } {
  const uiMode = useSimStore((s) => s.uiMode);
  const [mode, setMode] = useState<UiMode>(uiMode);
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    if (uiMode === mode) {
      setLeaving(false);
      return;
    }
    if (prefersReducedMotion()) {
      setMode(uiMode);
      setLeaving(false);
      return;
    }
    setLeaving(true);
    const t = window.setTimeout(() => {
      setMode(uiMode);
      setLeaving(false);
    }, MODE_OUT_MS);
    return () => window.clearTimeout(t);
  }, [uiMode, mode]);
  return { mode, leaving };
}

/**
 * Keeps the last non-null value for `ms` after it becomes null so that it can
 * play an exit animation (`leaving` is true meanwhile).
 */
export function usePresence<T>(value: T | null, ms = 220): { value: T | null; leaving: boolean } {
  const [kept, setKept] = useState<T | null>(value);
  const [leaving, setLeaving] = useState(false);
  const last = useRef<T | null>(value);
  useEffect(() => {
    if (value !== null) {
      last.current = value;
      setKept(value);
      setLeaving(false);
      return;
    }
    if (last.current === null) return;
    if (prefersReducedMotion()) {
      last.current = null;
      setKept(null);
      setLeaving(false);
      return;
    }
    setLeaving(true);
    const t = window.setTimeout(() => {
      last.current = null;
      setKept(null);
      setLeaving(false);
    }, ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return { value: value ?? kept, leaving: value === null && kept !== null && leaving };
}

export function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

/**
 * Global keyboard shortcuts (both modes):
 * Space = play/pause · Shift+←/→ = ±10 min (forward only inside a loop) ·
 * + / − = next / previous speed preset (×1 ×5 ×20 ×60) · Tab = switch mode ·
 * Escape = lab: close the panel, then the event · spectator: clear the
 * selection, then (second press) back to the laboratory.
 * Player mode (spectator with a game): G = « Faire un geste » · N = carnet ·
 * Escape = close the composer / the carnet / the end-of-loop summary, then the
 * event, then back to the followed inhabitant (never leaves the game).
 * On the « Choisir qui suivre » screen, Escape shows the plain city.
 */
export function useGlobalShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      const s = useSimStore.getState();
      if (e.key === 'Tab' && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        s.toggleUiMode();
      } else if (e.code === 'Space') {
        e.preventDefault();
        s.togglePlay();
      } else if (s.uiMode === 'spectator' && s.game && !e.ctrlKey && !e.metaKey && !e.altKey && (e.key === 'g' || e.key === 'G')) {
        e.preventDefault();
        const ui = useGameUi.getState();
        if (s.game.phase === 'playing' && !ui.rewinding) ui.setComposerOpen(!ui.composerOpen);
      } else if (s.uiMode === 'spectator' && s.game && !e.ctrlKey && !e.metaKey && !e.altKey && (e.key === 'n' || e.key === 'N')) {
        e.preventDefault();
        const ui = useGameUi.getState();
        ui.setNotebookOpen(!ui.notebookOpen);
      } else if (e.key === 'Escape') {
        const ui = useGameUi.getState();
        if (s.uiMode === 'spectator' && s.game) {
          if (ui.closeTop()) return;
          if (s.game.phase !== 'playing' && !ui.bilanHidden && !ui.rewinding) ui.setBilanHidden(true);
          else if (s.selectedEventId) s.selectEvent(null);
          else if (s.selectedAgentId !== s.game.agentId || s.followAgentId !== s.game.agentId) s.followAgent(s.game.agentId);
        } else if (s.uiMode === 'spectator' && !s.game && !ui.pickerDismissed) {
          ui.setPickerDismissed(true);
        } else if (s.uiMode === 'spectator') {
          if (s.selectedEventId || s.selectedAgentId || s.followAgentId) {
            if (s.selectedEventId) s.selectEvent(null);
            if (s.selectedAgentId || s.followAgentId) s.selectAgent(null);
          } else s.setUiMode('lab');
        } else if (s.panel) s.setPanel(s.panel);
        else if (s.selectedEventId) s.selectEvent(null);
      } else if (e.key === 'ArrowRight' && e.shiftKey) {
        s.seek(Math.floor(s.time) + 10);
      } else if (e.key === 'ArrowLeft' && e.shiftKey) {
        s.seek(Math.floor(s.time) - 10);
      } else if ((e.key === '+' || e.key === '=') && !e.ctrlKey && !e.metaKey && !e.altKey) {
        s.setSpeed(stepSpeed(s.speed, 1));
      } else if ((e.key === '-' || e.key === '_') && !e.ctrlKey && !e.metaKey && !e.altKey) {
        s.setSpeed(stepSpeed(s.speed, -1));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
