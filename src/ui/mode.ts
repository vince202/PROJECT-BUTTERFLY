/**
 * UI-mode helpers: the animated spectator / laboratory switch, media queries,
 * exit-animation presence and global keyboard shortcuts.
 */

import { useEffect, useRef, useState } from 'react';
import { useSimStore, type UiMode } from '../store/useSimStore';

/** Duration of the exit animation of the outgoing mode (ms). Must match `--mode-out` in styles.css. */
export const MODE_OUT_MS = 200;

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

/** Live `matchMedia` result (false during server rendering). */
export function useMediaQuery(query: string): boolean {
  const get = () => typeof window !== 'undefined' && !!window.matchMedia?.(query).matches;
  const [matches, setMatches] = useState(get);
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return;
    const on = () => setMatches(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return matches;
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
 * Space = play/pause · Shift+←/→ = ±10 min · Tab = switch mode ·
 * Escape = lab: close the panel, then the event · spectator: clear the
 * selection, then (second press) back to the laboratory.
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
      } else if (e.key === 'Escape') {
        if (s.uiMode === 'spectator') {
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
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
