/**
 * « Choisir qui suivre » — start screen of the player mode, over the city.
 * One card per inhabitant (questCards of reality A), easiest first, Léa's
 * tutorial highlighted. Dismissible to the plain spectator mode.
 */

import { useMemo } from 'react';
import { useGameUi } from '../../store/gameUi';
import { useSimStore } from '../../store/useSimStore';
import { questCards, type QuestCard } from '../../sim/game';
import { fmtTime } from '../../sim/time';

/** The tutorial quest, always shown first. */
export const TRAINING_AGENT = 'lea';

export function QuestPicker({ leaving = false }: { leaving?: boolean }) {
  const realityA = useSimStore((s) => s.realityA);
  const generation = useSimStore((s) => s.generation);
  const cards = useMemo(() => {
    const all = questCards(realityA);
    const training = all.filter((c) => c.agentId === TRAINING_AGENT);
    return [...training, ...all.filter((c) => c.agentId !== TRAINING_AGENT)];
  }, [realityA, generation]);
  const dismiss = () => useGameUi.getState().setPickerDismissed(true);
  const start = (id: string) => {
    useGameUi.setState({ pickerDismissed: false, bilanHidden: false, composerOpen: false, notebookOpen: false });
    useSimStore.getState().startGame(id);
  };
  return (
    <div className={`quest-picker ${leaving ? 'leaving' : ''}`} role="dialog" aria-modal="false" aria-labelledby="quest-picker-title">
      <div className="quest-picker-panel glass">
        <header className="quest-picker-head">
          <div>
            <div className="quest-picker-kicker">
              <span aria-hidden>🦋</span> Une journée qui se répète
            </div>
            <h2 id="quest-picker-title">Choisir qui suivre</h2>
            <p className="quest-picker-lead">
              Chaque jour recommence à 06:00. Suivez un habitant, offrez-lui quelques <strong>gestes</strong> pour infléchir sa journée, regardez-la se dérouler — sans retour en arrière. À minuit, la boucle se referme et tout recommence ; votre carnet, lui, se souvient.
            </p>
          </div>
          <button className="spec-chip" onClick={dismiss} title="Regarder la ville sans jouer (Échap)">
            Simplement regarder la ville
          </button>
        </header>
        <ul className="quest-grid">
          {cards.map((c) => (
            <li key={c.agentId} className={c.agentId === TRAINING_AGENT ? 'training' : undefined}>
              <QuestCardView card={c} training={c.agentId === TRAINING_AGENT} onPick={() => start(c.agentId)} />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function QuestCardView({ card: c, training, onPick }: { card: QuestCard; training: boolean; onPick: () => void }) {
  const dim = c.trivialInA && !training;
  return (
    <button
      className={`quest-card ${training ? 'training' : ''} ${dim ? 'dim' : ''}`}
      style={{ ['--agent' as string]: c.color }}
      onClick={onPick}
      title={`Suivre ${c.firstName} — ${c.title}\n${c.desire}\nTension : ${c.tension}\nÉchéance : ${fmtTime(c.deadline)}`}
    >
      {training && <span className="quest-ribbon">★ Commencez ici</span>}
      <span className="quest-card-head">
        <span className="agent-dot lg" style={{ background: c.color }} aria-hidden />
        <span className="quest-card-name">{c.firstName}</span>
        <span className="quest-card-job">{c.occupation}</span>
      </span>
      <span className="quest-card-title">{c.title}</span>
      <span className="quest-card-desire">{c.desire}</span>
      <span className="quest-card-foot">
        <span className={`quest-diff d${c.difficulty}`} aria-label={`Difficulté : ${c.difficultyLabel}`}>
          <span className="quest-pips" aria-hidden>
            {[1, 2, 3, 4, 5].map((i) => (
              <span key={i} className={i <= c.difficulty ? 'on' : ''} />
            ))}
          </span>
          {c.difficultyLabel}
        </span>
        <span className="quest-budget">
          {c.budget} gestes · ⏳ {fmtTime(c.deadline)}
        </span>
      </span>
      {c.trivialInA && <span className="quest-trivial">déjà réussi dans la journée telle qu’elle se répète</span>}
    </button>
  );
}
