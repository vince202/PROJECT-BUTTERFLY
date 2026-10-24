/**
 * Player-mode HUD (top-left, in place of the spectator clock): loop number and
 * clock, the objective card of the followed inhabitant at the displayed
 * minute, the gesture budget, « Faire un geste » and the switch to view the
 * day as it repeats (reality A).
 */

import { useMemo } from 'react';
import { useGameUi } from '../../store/gameUi';
import { useSimStore } from '../../store/useSimStore';
import { ARC_STATUS_LABELS, arcOf } from '../../sim/drama';
import { questCards, type GameState } from '../../sim/game';
import { profileOf } from '../../sim/population';
import { fmtTime, periodOfDay } from '../../sim/time';
import { DAY_END } from '../../sim/types';
import { ARC_STATUS_TONE, arcStatusAt } from '../drama';
import { weatherLabel } from '../format';
import { cachedStateAt, useActiveReality, useMinute } from '../hooks';

/** The objective's progress is read from the world state every 15 simulated minutes. */
const PROGRESS_BUCKET = 15;

export function GameHud({ game }: { game: GameState }) {
  return (
    <div className="game-hud">
      <LoopClock game={game} />
      <ObjectiveCard game={game} />
    </div>
  );
}

function LoopClock({ game }: { game: GameState }) {
  const minute = useMinute();
  const reality = useActiveReality();
  const viewingA = useSimStore((s) => s.activeRealityId === 'A');
  const hasB = useSimStore((s) => !!s.realityB);
  const pulse = useGameUi((s) => s.pulse);
  const weather = weatherLabel(reality.frameAt(Math.min(minute, DAY_END - 1))?.weather);
  return (
    <div className="spec-clock game-clock glass" title={reality.def.name}>
      <span className="spec-brand">
        <span aria-hidden>⟲</span> BOUCLE {game.loop}
      </span>
      <span className="spec-clock-row">
        <span className="spec-time mono">{fmtTime(minute)}</span>
        <span className="spec-meta">
          <span className="spec-period">{periodOfDay(minute)}</span>
          <span className="spec-weather" title={`Météo : ${weather.text}`} aria-label={`Météo : ${weather.text}`}>
            {weather.icon}
          </span>
        </span>
      </span>
      {hasB && !viewingA && (
        <span key={pulse} className={`game-b-badge ${pulse ? 'pulse' : ''}`} title="La journée que vous êtes en train de modifier">
          Réalité B — votre boucle
        </span>
      )}
      {viewingA && hasB && (
        <span className="game-a-badge" title="Vous regardez la journée telle qu’elle se répète, sans vos gestes">
          Réalité A — la journée telle qu’elle se répète
        </span>
      )}
    </div>
  );
}

function ObjectiveCard({ game }: { game: GameState }) {
  const minute = useMinute();
  const reality = useActiveReality();
  const realityA = useSimStore((s) => s.realityA);
  const realityB = useSimStore((s) => s.realityB);
  const viewingA = useSimStore((s) => s.activeRealityId === 'A');
  const generation = useSimStore((s) => s.generation);
  const rewinding = useGameUi((s) => s.rewinding);
  const card = useMemo(() => questCards(realityA).find((c) => c.agentId === game.agentId), [realityA, game.agentId, generation]);
  const bucket = Math.floor(minute / PROGRESS_BUCKET) * PROGRESS_BUCKET;
  const arcAt = useMemo(() => arcStatusAt(reality, game.agentId, minute), [reality, game.agentId, minute, generation]);
  const bucketProgress = useMemo(() => (rewinding ? 0 : (arcOf(cachedStateAt(reality, bucket), game.agentId)?.progress ?? 0)), [reality, bucket, game.agentId, generation, rewinding]);
  if (!card || !arcAt) return null;
  const status = arcAt.status;
  const final = status === 'fulfilled' || status === 'failed' || status === 'twisted';
  const progress = final ? (arcOf(reality.engine.state, game.agentId)?.progress ?? bucketProgress) : bucketProgress;
  const tone = ARC_STATUS_TONE[status];
  const left = card.deadline - minute;
  const deadlineText = final ? `réglé à ${fmtTime(arcAt.arc.resolvedAt ?? card.deadline)}` : left > 0 ? `dans ${left >= 60 ? `${Math.floor(left / 60)} h ${String(left % 60).padStart(2, '0')}` : `${left} min`}` : 'échéance passée';
  const used = realityB?.def.interventions.length ?? 0;
  const remaining = Math.max(0, game.budget - used);
  const playing = game.phase === 'playing';
  const gestureBlock = !playing ? 'La journée est terminée : relancez la boucle.' : remaining === 0 ? `Budget de gestes épuisé (${game.budget} par boucle).` : null;
  const p = profileOf(game.agentId);
  const { setComposerOpen, setNotebookOpen, setBilanHidden } = useGameUi.getState();
  const { switchReality } = useSimStore.getState();
  return (
    <section className={`objective glass st-${status}`} style={{ ['--agent' as string]: p.color }} aria-label="Objectif de la boucle">
      <header className="objective-head">
        <span className="agent-dot lg" style={{ background: p.color }} aria-hidden />
        <span className="objective-who">
          <span className="objective-kicker">Objectif de {p.firstName}</span>
          <span className="objective-title">{card.title}</span>
        </span>
        <span className={`badge tone-${tone}`}>{ARC_STATUS_LABELS[status]}</span>
      </header>
      <p className="objective-desire">{card.desire}</p>
      <div className="objective-progress" title={`Progression : ${Math.round(progress * 100)} %`}>
        <span className="objective-bar" aria-hidden>
          <span className={`objective-fill tone-${tone}`} style={{ width: `${Math.round(progress * 100)}%` }} />
        </span>
        <span className="objective-deadline mono">
          ⏳ {fmtTime(card.deadline)} <span className="muted">· {deadlineText}</span>
        </span>
      </div>
      <div className="objective-row">
        <span className="gesture-budget" title={`${used} geste${used > 1 ? 's' : ''} utilisé${used > 1 ? 's' : ''} sur ${game.budget} dans cette boucle`} aria-label={`${remaining} geste${remaining > 1 ? 's' : ''} restant${remaining > 1 ? 's' : ''} sur ${game.budget}`}>
          {Array.from({ length: game.budget }, (_, i) => (
            <span key={i} className={`gesture-pip ${i < remaining ? 'on' : ''}`} aria-hidden />
          ))}
          <span className="gesture-budget-text">
            {remaining} / {game.budget} geste{game.budget > 1 ? 's' : ''}
          </span>
        </span>
        {playing ? (
          <button className="spec-chip accent" onClick={() => setComposerOpen(true)} disabled={!!gestureBlock} title={gestureBlock ?? 'Intervenir dans la journée (G)'}>
            ✦ Faire un geste
          </button>
        ) : (
          <button className="spec-chip accent" onClick={() => setBilanHidden(false)} title="Revoir le bilan de la boucle">
            Bilan de la boucle
          </button>
        )}
        <button className="spec-chip" onClick={() => setNotebookOpen(true)} title="Carnet des gestes (N)">
          📓 <span className="mono">{game.notebook.length}</span>
        </button>
      </div>
      <label className={`objective-toggle ${realityB ? '' : 'disabled'}`} title={realityB ? 'Basculer sur la réalité A pour planifier, puis revenir à votre boucle' : 'Aucun geste encore : vous regardez déjà la journée telle qu’elle se répète'}>
        <input type="checkbox" checked={viewingA && !!realityB} disabled={!realityB} onChange={(e) => switchReality(e.target.checked ? 'A' : 'B')} />
        <span className="objective-switch" aria-hidden />
        Voir la journée telle qu’elle se répète
      </label>
    </section>
  );
}
