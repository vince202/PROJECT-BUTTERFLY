/**
 * BUTTERFLY application shell.
 *
 * Two UI modes (store `uiMode`, class on `.app`):
 * - `lab`: top bar, left (inhabitants), centre (3D city + panel overlays),
 *   right (inspector), bottom (timeline);
 * - `spectator`: the centre grows to the whole viewport and only floating
 *   glass overlays remain (see ui/Spectator.tsx).
 * `CityScene` keeps the same position in the tree in both modes so the WebGL
 * context survives mode switches. While the outgoing mode plays its exit
 * animation the root also carries `.leaving`.
 */

import { useEffect } from 'react';
import { useSimStore } from './store/useSimStore';
import { CityScene } from './render/CityScene';
import { TopBar } from './ui/TopBar';
import { InhabitantList } from './ui/InhabitantList';
import { Inspector } from './ui/Inspector';
import { Timeline } from './ui/Timeline';
import { PanelHost } from './ui/PanelHost';
import { SpectatorOverlay } from './ui/Spectator';
import { useGlobalShortcuts, useModeTransition } from './ui/mode';
import { checkAiStatus } from './ai/client';

/** Drives the display clock from real time (×1 = real time: one simulated minute per 60 s, see store/speed.ts). */
function useClock() {
  const tick = useSimStore((s) => s.tick);
  useEffect(() => {
    let last = performance.now();
    let raf = 0;
    const loop = (now: number) => {
      const dt = Math.min(0.25, (now - last) / 1000);
      last = now;
      tick(dt);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [tick]);
}

export function App() {
  useClock();
  useGlobalShortcuts();
  const { mode, leaving } = useModeTransition();
  const setAi = useSimStore((s) => s.setAi);
  useEffect(() => {
    checkAiStatus().then(setAi);
  }, [setAi]);
  const lab = mode === 'lab';
  return (
    <div className={`app ${mode}${leaving ? ' leaving' : ''}`}>
      {lab && <TopBar />}
      <div className="app-body">
        {lab && (
          <aside className="app-left">
            <InhabitantList />
          </aside>
        )}
        <main className="app-center">
          <CityScene />
          {lab && <PanelHost />}
          {!lab && <SpectatorOverlay leaving={leaving} />}
        </main>
        {lab && (
          <aside className="app-right">
            <Inspector />
          </aside>
        )}
      </div>
      {lab && (
        <footer className="app-bottom">
          <Timeline />
        </footer>
      )}
    </div>
  );
}
