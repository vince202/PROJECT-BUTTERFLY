/**
 * « Minuit : bilan de boucle » — shown when the loop closes (`game.phase`
 * 'ended' or 'won'): summary lines (`loopSummary`), the destinies that changed
 * in this loop, the gestures used, then « Rejouer la journée » (the clock
 * spins back to 06:00 over the city, then `restartLoop`) or « Changer de
 * personnage ». A won loop gets a brighter, light-only variant.
 */

import { useEffect, useMemo } from 'react';
import { useGameUi } from '../../store/gameUi';
import { useSimStore } from '../../store/useSimStore';
import { loopSummary, type GameState } from '../../sim/game';
import { fmtTime } from '../../sim/time';
import { DAY_END, DAY_START } from '../../sim/types';
import { t } from '../../i18n';
import { useLocale } from '../hooks';
import { prefersReducedMotion } from '../mode';
import { OUTCOME_MARKS } from './gestures';

/** Duration of the rewind (ms). */
const REWIND_MS = 1600;
const REWIND_FRAMES = 24;

export function LoopOverlay({ game }: { game: GameState }) {
  useLocale();
  const hidden = useGameUi((s) => s.bilanHidden);
  const rewinding = useGameUi((s) => s.rewinding);
  if (rewinding) return <Rewind />;
  if (game.phase === 'playing' || hidden) return null;
  return <Bilan game={game} />;
}

/** Spin the clock (and the city) back to 06:00, then start the next loop. */
export function rewindAndRestart() {
  const ui = useGameUi.getState();
  if (ui.rewinding) return;
  const finish = () => {
    useSimStore.getState().restartLoop();
    useGameUi.setState({ rewinding: false, bilanHidden: false, composerOpen: false, notebookOpen: false });
  };
  useGameUi.setState({ rewinding: true, alerts: [] });
  if (prefersReducedMotion()) return finish();
  const from = Math.max(DAY_START, Math.min(DAY_END, useSimStore.getState().time));
  const t0 = performance.now();
  let frames = 0;
  const step = (now: number) => {
    // At least REWIND_FRAMES frames, so that the spin stays visible on a slow machine.
    const k = Math.min(1, (now - t0) / REWIND_MS, ++frames / REWIND_FRAMES);
    const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
    // The loop is closed: seeking backwards is allowed until the next loop starts.
    useSimStore.getState().seek(from - (from - DAY_START) * e);
    if (k < 1) requestAnimationFrame(step);
    else finish();
  };
  useSimStore.getState().pause();
  requestAnimationFrame(step);
}

function Rewind() {
  useLocale();
  const time = useSimStore((s) => s.time);
  const turns = (DAY_END - time) / 60;
  return (
    <div className="rewind" role="status" aria-label={t('ui.loop_rewind_aria')}>
      <div className="rewind-dial" aria-hidden>
        <span className="rewind-hand" style={{ transform: `rotate(${-turns * 360}deg)` }} />
        <span className="rewind-hand short" style={{ transform: `rotate(${-turns * 30}deg)` }} />
      </div>
      <div className="rewind-time mono">{fmtTime(Math.floor(time))}</div>
      <div className="rewind-text">{t('ui.loop_rewind_text')}</div>
    </div>
  );
}

function Bilan({ game }: { game: GameState }) {
  useLocale();
  const realityA = useSimStore((s) => s.realityA);
  const realityB = useSimStore((s) => s.realityB);
  const played = realityB ?? realityA;
  const summary = useMemo(() => loopSummary(game, played), [game, played]);
  const record = game.loops[game.loops.length - 1];
  const won = game.phase === 'won';
  const mark = OUTCOME_MARKS[record?.outcome ?? 'unfinished'];
  const destinies = record?.destinies ?? [];
  const gestures = record?.interventions ?? played.def.interventions;
  const change = () => {
    useGameUi.setState({ pickerDismissed: false, bilanHidden: false });
    useSimStore.getState().abandonGame();
  };
  useEffect(() => {
    useGameUi.setState({ composerOpen: false });
  }, []);
  return (
    <div className={`bilan-scrim ${won ? 'won' : ''}`}>
      <section
        className={`bilan glass ${won ? 'won' : ''} tone-${mark.tone}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="bilan-title"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            useGameUi.getState().setBilanHidden(true);
          }
        }}
      >
        <div className="bilan-kicker">
          {t(won ? 'ui.loop_kicker_won' : 'ui.loop_kicker', { time: fmtTime(record?.endedAt ?? DAY_END) })}
        </div>
        <h2 id="bilan-title" className="bilan-title">
          <span className={`bilan-mark tone-${mark.tone}`} aria-hidden>
            {mark.sym}
          </span>
          {summary.title}
        </h2>
        <ul className="bilan-lines">
          {summary.lines.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
        <div className="bilan-cols">
          <div>
            <h3 className="bilan-h">{t('ui.loop_gestures')}</h3>
            {gestures.length ? (
              <ul className="bilan-list">
                {gestures.map((iv) => (
                  <li key={iv.id}>
                    <span className="mono">{fmtTime(iv.t)}</span> — {iv.description}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="bilan-empty">{t('ui.loop_gestures_none')}</p>
            )}
          </div>
          <div>
            <h3 className="bilan-h">{t('ui.loop_destinies')}</h3>
            {destinies.length ? (
              <ul className="bilan-list">
                {destinies.map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
            ) : (
              <p className="bilan-empty">{t('ui.loop_destinies_none')}</p>
            )}
          </div>
        </div>
        <p className="bilan-note">{t('ui.loop_note')}</p>
        <div className="bilan-actions">
          <button className="spec-chip accent" onClick={rewindAndRestart} autoFocus>
            {won ? t('ui.loop_replay_won') : t('ui.loop_replay')}
          </button>
          <button className="spec-chip" onClick={change}>
            {won ? t('ui.loop_choose_other') : t('ui.notebook_change')}
          </button>
          <button className="spec-chip ghost" onClick={() => useGameUi.getState().setBilanHidden(true)} title={t('ui.loop_close_title')}>
            {t('ui.inspector_close')}
          </button>
        </div>
      </section>
    </div>
  );
}
