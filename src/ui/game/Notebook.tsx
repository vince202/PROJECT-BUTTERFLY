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
import { useMinute } from '../hooks';
import { OUTCOME_MARKS, reuseIntervention } from './gestures';

export function Notebook({ game }: { game: GameState }) {
  const open = useGameUi((s) => s.notebookOpen);
  if (!open) return null;
  return <NotebookDrawer game={game} />;
}

function NotebookDrawer({ game }: { game: GameState }) {
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
      aria-label="Carnet"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          close();
        }
      }}
    >
      <header className="notebook-head">
        <span className="notebook-title">📓 Carnet</span>
        <span className="notebook-sub">
          {p.firstName} · boucle {game.loop}
        </span>
        <button className="spec-x" onClick={close} title="Fermer (Échap)" aria-label="Fermer">
          ✕
        </button>
      </header>
      <p className="notebook-lead">Ce que vous avez déjà tenté. La ville oublie à chaque boucle ; ce carnet, non.</p>

      <h3 className="notebook-h">Gestes</h3>
      {notebook.length === 0 ? (
        <p className="notebook-empty">Aucun geste encore. Ils s’inscrivent ici à minuit, à la fin de chaque boucle.</p>
      ) : (
        <ul className="notebook-list">
          {notebook.map((g) => {
            const here = inPlace.has(g.key);
            const check = here ? { ok: false, reason: 'Déjà en place dans cette boucle.' } : canApplyGesture(game, current, g.intervention, minute);
            return (
              <li key={g.key} className={`notebook-item ${here ? 'here' : ''}`}>
                <div className="notebook-line">
                  <span className="notebook-label">{gestureLabel(g)}</span>
                </div>
                <div className="notebook-meta">
                  {g.loops.map((loop, i) => {
                    const m = OUTCOME_MARKS[g.outcomes[i] ?? 'unfinished'];
                    return (
                      <span key={loop} className={`notebook-outcome tone-${m.tone}`} title={`Boucle ${loop} : quête ${m.label}`}>
                        B{loop} {m.sym}
                      </span>
                    );
                  })}
                  <button className="spec-chip notebook-reuse" disabled={!check.ok} onClick={() => reuse(g.intervention)} title={check.ok ? `Rejouer ce geste dans la boucle ${game.loop}` : check.reason}>
                    {here ? 'En place' : 'Réutiliser'}
                  </button>
                </div>
                {!check.ok && !here && <div className="notebook-why">{check.reason}</div>}
              </li>
            );
          })}
        </ul>
      )}

      <h3 className="notebook-h">Boucles</h3>
      {game.loops.length === 0 ? (
        <p className="notebook-empty">Première boucle en cours, jusqu’à minuit.</p>
      ) : (
        <ul className="notebook-loops">
          {game.loops.map((l) => {
            const m = OUTCOME_MARKS[l.outcome];
            return (
              <li key={l.loop} className={`tone-${m.tone}`} title={l.resolution ?? `Quête ${m.label}`}>
                <span className="notebook-loop-n">Boucle {l.loop}</span>
                <span className={`notebook-outcome tone-${m.tone}`}>
                  {m.sym} {m.label}
                </span>
                <span className="muted">
                  {l.interventions.length} geste{l.interventions.length > 1 ? 's' : ''} · {Math.round(l.progress * 100)} % · {fmtTime(l.endedAt)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <div className="notebook-foot">
        <button className="spec-chip" onClick={changeCharacter} title="Abandonner cette quête et choisir un autre habitant">
          Changer de personnage
        </button>
      </div>
    </aside>
  );
}
