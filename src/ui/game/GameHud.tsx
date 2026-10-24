/**
 * Player-mode HUD (top-left, in place of the spectator clock): loop number and
 * clock, the objective card of the followed inhabitant at the displayed
 * minute, the gesture budget, « Faire un geste » and the switch to view the
 * day as it repeats (reality A).
 */

import { useMemo, useEffect } from 'react';
import { useGameUi } from '../../store/gameUi';
import { useSimStore } from '../../store/useSimStore';
import { ARC_STATUS_LABELS, arcOf } from '../../sim/drama';
import { questCards, type GameState } from '../../sim/game';
import { profileOf } from '../../sim/population';
import { fmtTime, periodKey, periodLabel } from '../../sim/time';
import { DAY_END } from '../../sim/types';
import { ARC_STATUS_TONE, arcStatusAt } from '../drama';
import { weatherLabel } from '../format';
import { t } from '../../i18n';
import { cachedStateAt, useActiveReality, useLocale, useMinute } from '../hooks';

/** The objective's progress is read from the world state every 15 simulated minutes. */
const PROGRESS_BUCKET = 15;

export function GameHud({ game }: { game: GameState }) {
  useLocale();
  return (
    <div className="game-hud">
      <LoopClock game={game} />
      <ObjectiveCard game={game} />
    </div>
  );
}

function LoopClock({ game }: { game: GameState }) {
  useLocale();
  const minute = useMinute();
  const reality = useActiveReality();
  const viewingA = useSimStore((s) => s.activeRealityId === 'A');
  const hasB = useSimStore((s) => !!s.realityB);
  const pulse = useGameUi((s) => s.pulse);
  const notice = useGameUi((s) => s.notice);
  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => useGameUi.getState().setNotice(null), 7000);
    return () => clearTimeout(id);
  }, [notice]);
  const weather = weatherLabel(reality.frameAt(Math.min(minute, DAY_END - 1))?.weather);
  return (
    <div className="spec-clock game-clock glass" title={reality.def.name}>
      <span className="spec-brand">
        <span aria-hidden>⟲</span> {t('ui.hud_loop', { n: game.loop })}
      </span>
      <span className="spec-clock-row">
        <span className="spec-time mono">{fmtTime(minute)}</span>
        <span className="spec-meta">
          <span className="spec-period">{periodLabel(periodKey(minute))}</span>
          <span className="spec-weather" title={t('ui.topbar_weather_title', { weather: weather.text })} aria-label={t('ui.topbar_weather_title', { weather: weather.text })}>
            {weather.icon}
          </span>
        </span>
      </span>
      {hasB && !viewingA && (
        <span key={pulse} className={`game-b-badge ${pulse ? 'pulse' : ''}`} title={t('ui.hud_b_badge_title')}>
          {t('common.reality_b_loop')}
        </span>
      )}
      {notice && (
        <div className="game-notice" role="status">
          ✓ {notice.text}
        </div>
      )}
      {viewingA && hasB && (
        <span className="game-a-badge" title={t('ui.hud_a_badge_title')}>
          {t('ui.hud_a_badge')}
        </span>
      )}
    </div>
  );
}

function ObjectiveCard({ game }: { game: GameState }) {
  useLocale();
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
  const deadlineText = final ? t('ui.hud_deadline_settled', { time: fmtTime(arcAt.arc.resolvedAt ?? card.deadline) }) : left > 0 ? t('ui.hud_deadline_in', { dur: left >= 60 ? t('ui.hud_duration_hm', { h: Math.floor(left / 60), m: String(left % 60).padStart(2, '0') }) : t('common.minutes', { n: left }) }) : t('ui.hud_deadline_passed');
  const used = realityB?.def.interventions.length ?? 0;
  const remaining = Math.max(0, game.budget - used);
  const playing = game.phase === 'playing';
  const gestureBlock = !playing ? t('ui.hud_block_over') : remaining === 0 ? t('ui.hud_block_budget', { n: game.budget }) : null;
  const p = profileOf(game.agentId);
  const { setComposerOpen, setNotebookOpen, setBilanHidden } = useGameUi.getState();
  const { switchReality } = useSimStore.getState();
  return (
    <section className={`objective glass st-${status}`} style={{ ['--agent' as string]: p.color }} aria-label={t('ui.hud_objective_aria')}>
      <header className="objective-head">
        <span className="agent-dot lg" style={{ background: p.color }} aria-hidden />
        <span className="objective-who">
          <span className="objective-kicker">{t('ui.hud_objective_of', { name: p.firstName })}</span>
          <span className="objective-title">{card.title}</span>
        </span>
        <span className={`badge tone-${tone}`}>{ARC_STATUS_LABELS[status]}</span>
      </header>
      <p className="objective-desire">{card.desire}</p>
      <div className="objective-progress" title={t('ui.hud_progress_title', { n: Math.round(progress * 100) })}>
        <span className="objective-bar" aria-hidden>
          <span className={`objective-fill tone-${tone}`} style={{ width: `${Math.round(progress * 100)}%` }} />
        </span>
        <span className="objective-deadline mono">
          ⏳ {fmtTime(card.deadline)} <span className="muted">· {deadlineText}</span>
        </span>
      </div>
      <div className="objective-row">
        <span className="gesture-budget" title={t('ui.hud_budget_used', { used, total: game.budget })} aria-label={t('ui.hud_budget_left', { left: remaining, total: game.budget })}>
          {Array.from({ length: game.budget }, (_, i) => (
            <span key={i} className={`gesture-pip ${i < remaining ? 'on' : ''}`} aria-hidden />
          ))}
          <span className="gesture-budget-text mono">
            {remaining}/{game.budget}
          </span>
        </span>
        {playing ? (
          <button className="spec-chip accent" onClick={() => setComposerOpen(true)} disabled={!!gestureBlock} title={gestureBlock ?? t('ui.hud_make_gesture_title')}>
            {t('ui.hud_make_gesture')}
          </button>
        ) : (
          <button className="spec-chip accent" onClick={() => setBilanHidden(false)} title={t('ui.hud_review_title')}>
            {t('ui.hud_review')}
          </button>
        )}
        <button className="spec-chip" onClick={() => setNotebookOpen(true)} title={t('ui.spectator_notebook_title')}>
          📓 <span className="mono">{game.notebook.length}</span>
        </button>
      </div>
      <label className={`objective-toggle ${realityB ? '' : 'disabled'}`} title={realityB ? t('ui.hud_toggle_title_b') : t('ui.hud_toggle_title_none')}>
        <input type="checkbox" checked={viewingA && !!realityB} disabled={!realityB} onChange={(e) => switchReality(e.target.checked ? 'A' : 'B')} />
        <span className="objective-switch" aria-hidden />
        {t('ui.hud_toggle')}
      </label>
    </section>
  );
}
