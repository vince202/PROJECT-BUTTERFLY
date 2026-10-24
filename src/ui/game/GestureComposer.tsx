/**
 * « Faire un geste » — compact composer of the player mode: a sentence in the
 * interface language (local interpreter, see `interpretText`, at the current minute) or one of the
 * quick gestures relevant to the quest, with times that can only be in the
 * future. Refusals of `applyGesture` are shown inline. Playback pauses while
 * the composer is open and resumes when it closes.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useGameUi } from '../../store/gameUi';
import { useSimStore } from '../../store/useSimStore';
import { canApplyGesture, type GameState } from '../../sim/game';
import { validateIntervention, type InterpretResult } from '../../sim/interventions';
import { t } from '../../i18n';
import { AGENTS } from '../../sim/population';
import { fmtTime } from '../../sim/time';
import { DAY_END, type ActionType, type Intervention } from '../../sim/types';
import { actionLabel, locName, parseClock } from '../format';
import { fill } from '../common';
import { useLocale, useMinute } from '../hooks';
import { interpretText } from '../interpret';
import { interventionFields } from '../panels/ButterflyPanel';
import { GAME_ACTIONS, GAME_PLACES, QUICK_LABELS, buildGesture, busOptions, quickGestures, type GestureDraft, type QuickKind } from './gestures';

export function GestureComposer({ game }: { game: GameState }) {
  const open = useGameUi((s) => s.composerOpen);
  if (!open) return null;
  return <ComposerPanel game={game} />;
}

function ComposerPanel({ game }: { game: GameState }) {
  useLocale();
  const minute = useMinute();
  const realityA = useSimStore((s) => s.realityA);
  const realityB = useSimStore((s) => s.realityB);
  const played = realityB ?? realityA;
  const current = realityB?.def.interventions ?? [];
  const [text, setText] = useState('');
  const [interp, setInterp] = useState<InterpretResult | null>(null);
  const [draft, setDraft] = useState<GestureDraft | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const wasPlaying = useRef(false);
  const close = () => useGameUi.getState().setComposerOpen(false);

  // Time stands still while the player thinks.
  useEffect(() => {
    const s = useSimStore.getState();
    wasPlaying.current = s.playing;
    if (s.playing) s.pause();
    return () => {
      const st = useSimStore.getState();
      if (wasPlaying.current && st.game?.phase === 'playing') st.play();
    };
  }, []);

  const quick = useMemo(() => quickGestures(played, game.agentId, minute), [played, game.agentId, minute]);

  const apply = (iv: Intervention) => {
    const errs = validateIntervention(iv);
    if (errs.length) return setRefusal(errs.join(' '));
    const r = useSimStore.getState().applyGesture(iv);
    if (!r.ok) return setRefusal(r.reason ?? t('ui.composer_refused'));
    setRefusal(null);
    useGameUi.getState().bumpPulse();
    useGameUi.getState().setNotice(t('ui.composer_applied', { description: iv.description, time: fmtTime(iv.t) }));
    close();
  };

  const understand = () => {
    if (!text.trim()) return;
    setDraft(null);
    setRefusal(null);
    setInterp(interpretText(text, { t: minute, events: played.events }));
  };

  const built = draft ? buildGesture(draft, played, minute) : null;
  const candidate = interp?.intervention ?? (built && typeof built !== 'string' ? built : null);
  const pre = candidate ? canApplyGesture(game, current, candidate, minute) : null;
  const used = current.length;

  return (
    <section
      className="composer glass"
      role="dialog"
      aria-label={t('ui.composer_aria')}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          close();
        }
      }}
    >
      <header className="composer-head">
        <span className="composer-title">{t('ui.composer_title')}</span>
        <span className="composer-sub">
          {fill(t('ui.composer_sub', { left: game.budget - used }), { time: <span className="mono strong">{fmtTime(minute)}</span> })}
        </span>
        <button className="spec-x" onClick={close} title={t('ui.spectator_toast_close_title')} aria-label={t('ui.inspector_close')}>
          ✕
        </button>
      </header>

      <div className="composer-free">
        <input
          className="input composer-input"
          autoFocus
          value={text}
          placeholder={t('ui.composer_placeholder')}
          onChange={(e) => (setText(e.target.value), setInterp(null))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') understand();
          }}
          aria-label={t('ui.composer_input_aria')}
        />
        <button className="spec-chip" onClick={understand} disabled={!text.trim()} title={t('ui.composer_understand_title')}>
          {t('ui.composer_understand')}
        </button>
      </div>
      {interp && (
        <div className={`composer-interp ${interp.ok ? 'ok' : 'bad'}`}>
          <p>{interp.explanation}</p>
          {interp.issues.length > 0 && (
            <ul>
              {interp.issues.map((x, i) => (
                <li key={i}>{x}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="composer-quick" role="radiogroup" aria-label={t('ui.composer_quick_aria')}>
        {quick.kinds.map((k) => (
          <button
            key={k}
            role="radio"
            aria-checked={draft?.kind === k}
            className={`composer-kind ${draft?.kind === k ? 'active' : ''}`}
            onClick={() => {
              setInterp(null);
              setRefusal(null);
              setDraft(draft?.kind === k ? null : quick.draft(k));
            }}
          >
            <span aria-hidden>{QUICK_LABELS[k].icon}</span> {QUICK_LABELS[k].label}
          </button>
        ))}
      </div>

      {draft && <DraftFields draft={draft} onChange={(d) => (setDraft(d), setRefusal(null))} game={game} minute={minute} />}

      {candidate && (
        <div className="composer-preview">
          <div className="composer-desc">{t('ui.quote', { text: candidate.description })}</div>
          <div className="composer-fields">
            {interventionFields(candidate).map(([k, v]) => (
              <span key={k}>
                <span className="muted">{k}</span> {v}
              </span>
            ))}
          </div>
        </div>
      )}
      {built && typeof built === 'string' && <div className="composer-refusal">{built}</div>}
      {(refusal || (pre && !pre.ok)) && <div className="composer-refusal">{refusal ?? pre?.reason}</div>}
      <div className="composer-actions">
        <button className="spec-chip accent" disabled={!candidate || (pre !== null && !pre.ok)} onClick={() => candidate && apply(candidate)} title={t('ui.composer_apply_title')}>
          {t('ui.composer_apply')}
        </button>
        <span className="muted small">{t('ui.composer_apply_note')}</span>
      </div>
    </section>
  );
}

/** Time input limited to the future (HH:MM, from the current minute to 23:59). */
function TimeField({ label, value, min, onChange }: { label: string; value: number; min: number; onChange: (t: number) => void }) {
  return (
    <label className="composer-field">
      <span>{label}</span>
      <input
        className="input mono"
        type="time"
        step={60}
        min={fmtTime(Math.min(DAY_END - 1, Math.floor(min)))}
        max="23:59"
        value={fmtTime(Math.min(DAY_END - 1, value))}
        onChange={(e) => {
          const t = parseClock(e.target.value);
          if (t !== null) onChange(t);
        }}
      />
    </label>
  );
}

function AgentField({ label, value, onChange, exclude }: { label: string; value: string; onChange: (id: string) => void; exclude?: string }) {
  return (
    <label className="composer-field">
      <span>{label}</span>
      <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
        {AGENTS.filter((a) => a.id !== exclude).map((a) => (
          <option key={a.id} value={a.id}>
            {a.firstName}
          </option>
        ))}
      </select>
    </label>
  );
}

function PlaceField({ value, onChange, habitual = false }: { value: string; onChange: (id: string) => void; habitual?: boolean }) {
  useLocale();
  return (
    <label className="composer-field">
      <span>{t('ui.form_place')}</span>
      <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
        {habitual && <option value="">{t('ui.form_usual_place')}</option>}
        {GAME_PLACES.map((l) => (
          <option key={l.id} value={l.id}>
            {l.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function DraftFields({ draft: d, onChange, game, minute }: { draft: GestureDraft; onChange: (d: GestureDraft) => void; game: GameState; minute: number }) {
  useLocale();
  const realityA = useSimStore((s) => s.realityA);
  const realityB = useSimStore((s) => s.realityB);
  const played = realityB ?? realityA;
  const set = <K extends keyof GestureDraft>(k: K, v: GestureDraft[K]) => onChange({ ...d, [k]: v });
  const buses = useMemo(() => (d.kind === 'bus_delay' ? busOptions(played, game.agentId, minute) : []), [d.kind, played, game.agentId, minute]);
  const kind: QuickKind = d.kind;
  return (
    <div className="composer-form">
      {kind === 'bus_delay' && (
        <>
          <label className="composer-field wide">
            <span>{t('ui.composer_bus_pass')}</span>
            <select className="input" value={d.arrivalId} onChange={(e) => set('arrivalId', e.target.value)}>
              {buses.map(({ event: e, mine }) => (
                <option key={e.id} value={e.id}>
                  {t(mine ? 'ui.composer_bus_option_mine' : 'ui.composer_bus_option', { time: fmtTime(e.t), bus: e.busId ?? '', place: locName(e.locationId) })}
                </option>
              ))}
            </select>
          </label>
          <label className="composer-field">
            <span>{t('ui.composer_delay')}</span>
            <input className="input mono" type="number" min={1} max={30} value={d.minutes} onChange={(e) => set('minutes', Math.max(1, Math.min(30, Number(e.target.value) || 1)))} />
          </label>
        </>
      )}
      {(kind === 'stay_home' || kind === 'force_action') && <AgentField label={t('ui.form_agent')} value={d.agentId} onChange={(v) => set('agentId', v)} />}
      {kind === 'encounter' && (
        <>
          <AgentField label={t('ui.form_agent_1')} value={d.agentId} onChange={(v) => set('agentId', v)} />
          <AgentField label={t('ui.form_agent_2')} value={d.agentB} onChange={(v) => set('agentB', v)} exclude={d.agentId} />
          <PlaceField value={d.locationId} onChange={(v) => set('locationId', v)} />
        </>
      )}
      {kind === 'force_action' && (
        <label className="composer-field">
          <span>{t('ui.form_action')}</span>
          <select className="input" value={d.action} onChange={(e) => onChange({ ...d, action: e.target.value as ActionType, locationId: '' })}>
            {GAME_ACTIONS.map((a) => (
              <option key={a} value={a}>
                {actionLabel(a)}
              </option>
            ))}
          </select>
        </label>
      )}
      {kind === 'force_action' && <PlaceField value={d.locationId} onChange={(v) => set('locationId', v)} habitual />}
      {kind === 'location_hours' && <PlaceField value={d.locationId} onChange={(v) => set('locationId', v)} />}
      {kind === 'weather' && (
        <div className="composer-field">
          <span>{t('ui.field_weather')}</span>
          <div className="seg">
            <button className={d.condition === 'rain' ? 'active' : ''} onClick={() => set('condition', 'rain')}>
              {t('ui.composer_rain')}
            </button>
            <button className={d.condition === 'clear' ? 'active' : ''} onClick={() => set('condition', 'clear')}>
              {t('ui.composer_clear')}
            </button>
          </div>
        </div>
      )}
      {kind === 'location_hours' ? (
        <TimeField label={t('ui.form_closes_at')} value={d.closes} min={minute} onChange={(t) => onChange({ ...d, closes: t, t: Math.min(Math.max(Math.ceil(minute), d.t), t) })} />
      ) : (
        kind !== 'bus_delay' && <TimeField label={kind === 'encounter' ? t('ui.field_from') : t('ui.composer_at')} value={d.t} min={minute} onChange={(t) => onChange({ ...d, t, until: Math.max(d.until, t + 15) })} />
      )}
      {(kind === 'stay_home' || (kind === 'weather' && d.condition === 'rain')) && <TimeField label={t('ui.form_until')} value={d.until} min={Math.max(minute, d.t + 1)} onChange={(t) => set('until', t)} />}
    </div>
  );
}
