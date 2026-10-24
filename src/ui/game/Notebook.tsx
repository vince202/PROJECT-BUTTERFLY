/**
 * « Carnet » — drawer of the player mode: every gesture ever tried with this
 * inhabitant (it survives the loops), the loops it was part of and their
 * outcomes, a « Réutiliser » button (disabled with the reason when the gesture
 * cannot be applied now), and the history of the loops.
 */

import { useGameUi } from '../../store/gameUi';
import { useSimStore } from '../../store/useSimStore';
import { canApplyGesture, gestureKey, gestureLabel, type GameState } from '../../sim/game';
import { profileOf } from '../../sim/population';
import { fmtTime } from '../../sim/time';
import { t } from '../../i18n';
import { useLocale, useMinute } from '../hooks';
import { OUTCOME_MARKS, reuseIntervention } from './gestures';

export function Notebook({ game }: { game: GameState }) {
  const open = useGameUi((s) => s.notebookOpen);
  if (!open) return null;
  return <NotebookDrawer game={game} />;
}

function NotebookDrawer({ game }: { game: GameState }) {
  useLocale();
  const minute = useMinute();
  const realityB = useSimStore((s) => s.realityB);
  const current = realityB?.def.interventions ?? [];
  const inPlace = new Set(current.map(gestureKey));
  const p = profileOf(game.agentId);
  const close = () => useGameUi.getState().setNotebookOpen(false);
  const reuse = (iv: (typeof game.notebook)[number]['intervention']) => {
    const r = useSimStore.getState().applyGesture(reuseIntervention(iv));
    if (r.ok) useGameUi.getState().bumpPulse();
  };
  const changeCharacter = () => {
    close();
    useGameUi.setState({ pickerDismissed: false, bilanHidden: false });
    useSimStore.getState().abandonGame();
  };
  const notebook = [...game.notebook].sort((a, b) => a.intervention.t - b.intervention.t);
  return (
    <aside
      className="notebook glass"
      role="dialog"
      aria-label={t('ui.spectator_notebook')}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          close();
        }
      }}
    >
      <header className="notebook-head">
        <span className="notebook-title">📓 {t('ui.spectator_notebook')}</span>
        <span className="notebook-sub">
          {t('ui.notebook_sub', { name: p.firstName, loop: game.loop })}
        </span>
        <button className="spec-x" onClick={close} title={t('ui.spectator_toast_close_title')} aria-label={t('ui.inspector_close')}>
          ✕
        </button>
      </header>
      <p className="notebook-lead">{t('ui.notebook_lead')}</p>

      <h3 className="notebook-h">{t('ui.notebook_gestures')}</h3>
      {notebook.length === 0 ? (
        <p className="notebook-empty">{t('ui.notebook_gestures_none')}</p>
      ) : (
        <ul className="notebook-list">
          {notebook.map((g) => {
            const here = inPlace.has(g.key);
            const check = here ? { ok: false, reason: t('ui.notebook_already') } : canApplyGesture(game, current, g.intervention, minute);
            return (
              <li key={g.key} className={`notebook-item ${here ? 'here' : ''}`}>
                <div className="notebook-line">
                  <span className="notebook-label">{gestureLabel(g)}</span>
                </div>
                <div className="notebook-meta">
                  {g.loops.map((loop, i) => {
                    const m = OUTCOME_MARKS[g.outcomes[i] ?? 'unfinished'];
                    return (
                      <span key={loop} className={`notebook-outcome tone-${m.tone}`} title={t('ui.notebook_outcome_title', { loop, label: m.label })}>
                        B{loop} {m.sym}
                      </span>
                    );
                  })}
                  <button className="spec-chip notebook-reuse" disabled={!check.ok} onClick={() => reuse(g.intervention)} title={check.ok ? t('ui.notebook_reuse_title', { loop: game.loop }) : check.reason}>
                    {here ? t('ui.notebook_in_place') : t('ui.notebook_reuse')}
                  </button>
                </div>
                {!check.ok && !here && <div className="notebook-why">{check.reason}</div>}
              </li>
            );
          })}
        </ul>
      )}

      <h3 className="notebook-h">{t('ui.notebook_loops')}</h3>
      {game.loops.length === 0 ? (
        <p className="notebook-empty">{t('ui.notebook_loops_none')}</p>
      ) : (
        <ul className="notebook-loops">
          {game.loops.map((l) => {
            const m = OUTCOME_MARKS[l.outcome];
            return (
              <li key={l.loop} className={`tone-${m.tone}`} title={l.resolution ?? t('ui.notebook_loop_quest_title', { label: m.label })}>
                <span className="notebook-loop-n">{t('ui.notebook_loop_n', { n: l.loop })}</span>
                <span className={`notebook-outcome tone-${m.tone}`}>
                  {m.sym} {m.label}
                </span>
                <span className="muted">
                  {t('ui.notebook_loop_meta', { n: l.interventions.length, pct: Math.round(l.progress * 100), time: fmtTime(l.endedAt) })}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <div className="notebook-foot">
        <button className="spec-chip" onClick={changeCharacter} title={t('ui.notebook_change_title')}>
          {t('ui.notebook_change')}
        </button>
      </div>
    </aside>
  );
}
