/**
 * BUTTERFLY application shell.
 *
 * Layout: top bar (clock, playback), left (inhabitants), centre (3D city +
 * panel overlays), right (inspector), bottom (timeline).
 */

import { useEffect } from 'react';
import { useSimStore } from './store/useSimStore';
import { CityScene } from './render/CityScene';
import { TopBar } from './ui/TopBar';
import { InhabitantList } from './ui/InhabitantList';
import { Inspector } from './ui/Inspector';
import { Timeline } from './ui/Timeline';
import { PanelHost } from './ui/PanelHost';
import { checkAiStatus } from './ai/client';

/** Drives the display clock from real time (×1 = one simulated minute per real second). */
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
  const setAi = useSimStore((s) => s.setAi);
  useEffect(() => {
    checkAiStatus().then(setAi);
  }, [setAi]);
  return (
    <div className="app">
      <TopBar />
      <div className="app-body">
        <aside className="app-left">
          <InhabitantList />
        </aside>
        <main className="app-center">
          <CityScene />
          <PanelHost />
        </main>
        <aside className="app-right">
          <Inspector />
        </aside>
      </div>
      <footer className="app-bottom">
        <Timeline />
      </footer>
    </div>
  );
}
