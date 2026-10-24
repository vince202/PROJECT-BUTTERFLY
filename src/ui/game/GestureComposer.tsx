/**
 * « Faire un geste » — compact composer of the player mode: a French sentence
 * (local interpreter, `interpretFrench` at the current minute) or one of the
 * quick gestures relevant to the quest, with times that can only be in the
 * future. Refusals of `applyGesture` are shown inline. Playback pauses while
 * the composer is open and resumes when it closes.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useGameUi } from '../../store/gameUi';
import { useSimStore } from '../../store/useSimStore';
import { canApplyGesture, type GameState } from '../../sim/game';
import { interpretFrench, validateIntervention, type InterpretResult } from '../../sim/interventions';
import { AGENTS } from '../../sim/population';
import { fmtTime } from '../../sim/time';
import { DAY_END, type ActionType, type Intervention } from '../../sim/types';
import { actionLabel, locName, parseClock } from '../format';
import { useMinute } from '../hooks';
import { interventionFields } from '../panels/ButterflyPanel';
import { GAME_ACTIONS, GAME_PLACES, QUICK_LABELS, buildGesture, busOptions, quickGestures, type GestureDraft, type QuickKind } from './gestures';

export function GestureComposer({ game }: { game: GameState }) {
  const open = useGameUi((s) => s.composerOpen);
  if (!open) return null;
  return <ComposerPanel game={game} />;
}

function ComposerPanel({ game }: { game: GameState }) {
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
    if (!r.ok) return setRefusal(r.reason ?? 'Geste refusé.');
    setRefusal(null);
    useGameUi.getState().bumpPulse();
    useGameUi.getState().setNotice(`Geste appliqué : ${iv.description}. La journée se rejoue avec ce changement à partir de ${fmtTime(iv.t)}.`);
    close();
  };

  const understand = () => {
    if (!text.trim()) return;
    setDraft(null);
    setRefusal(null);
    setInterp(interpretFrench(text, { t: minute, events: played.events }));
  };

  const built = draft ? buildGesture(draft, played, minute) : null;
  const candidate = interp?.intervention ?? (built && typeof built !== 'string' ? built : null);
  const pre = candidate ? canApplyGesture(game, current, candidate, minute) : null;
  const used = current.length;

  return (
    <section
      className="composer glass"
      role="dialog"
      aria-label="Faire un geste"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          close();
        }
      }}
    >
      <header className="composer-head">
        <span className="composer-title">✦ Faire un geste</span>
        <span className="composer-sub">
          à partir de <span className="mono strong">{fmtTime(minute)}</span> · {game.budget - used} restant{game.budget - used > 1 ? 's' : ''}
        </span>
        <button className="spec-x" onClick={close} title="Fermer (Échap)" aria-label="Fermer">
          ✕
        </button>
      </header>

      <div className="composer-free">
        <input
          className="input composer-input"
          autoFocus
          value={text}
          placeholder="Et si le bus avait trois minutes de retard ?"
          onChange={(e) => (setText(e.target.value), setInterp(null))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') understand();
          }}
          aria-label="Décrire le geste en français"
        />
        <button className="spec-chip" onClick={understand} disabled={!text.trim()} title="Traduire la phrase en geste (Entrée)">
          Comprendre
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

      <div className="composer-quick" role="radiogroup" aria-label="Gestes rapides">
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
          <div className="composer-desc">« {candidate.description} »</div>
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
        <button className="spec-chip accent" disabled={!candidate || (pre !== null && !pre.ok)} onClick={() => candidate && apply(candidate)} title="Ce geste modifie votre boucle (réalité B)">
          Appliquer ce geste
        </button>
        <span className="muted small">Le geste s’ajoute à votre boucle ; la journée se rejoue à l’identique, sauf ce que vous changez.</span>
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
  return (
    <label className="composer-field">
      <span>Lieu</span>
      <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
        {habitual && <option value="">Lieu habituel</option>}
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
            <span>Passage</span>
            <select className="input" value={d.arrivalId} onChange={(e) => set('arrivalId', e.target.value)}>
              {buses.map(({ event: e, mine }) => (
                <option key={e.id} value={e.id}>
                  {fmtTime(e.t)} · {e.busId} · {locName(e.locationId)}
                  {mine ? ' ★ votre personnage y monte' : ''}
                </option>
              ))}
            </select>
          </label>
          <label className="composer-field">
            <span>Retard (min)</span>
            <input className="input mono" type="number" min={1} max={30} value={d.minutes} onChange={(e) => set('minutes', Math.max(1, Math.min(30, Number(e.target.value) || 1)))} />
          </label>
        </>
      )}
      {(kind === 'stay_home' || kind === 'force_action') && <AgentField label="Habitant" value={d.agentId} onChange={(v) => set('agentId', v)} />}
      {kind === 'encounter' && (
        <>
          <AgentField label="Habitant 1" value={d.agentId} onChange={(v) => set('agentId', v)} />
          <AgentField label="Habitant 2" value={d.agentB} onChange={(v) => set('agentB', v)} exclude={d.agentId} />
          <PlaceField value={d.locationId} onChange={(v) => set('locationId', v)} />
        </>
      )}
      {kind === 'force_action' && (
        <label className="composer-field">
          <span>Action</span>
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
          <span>Météo</span>
          <div className="seg">
            <button className={d.condition === 'rain' ? 'active' : ''} onClick={() => set('condition', 'rain')}>
              🌧 Pluie
            </button>
            <button className={d.condition === 'clear' ? 'active' : ''} onClick={() => set('condition', 'clear')}>
              ☀ Dégagé
            </button>
          </div>
        </div>
      )}
      {kind === 'location_hours' ? (
        <TimeField label="Ferme à" value={d.closes} min={minute} onChange={(t) => onChange({ ...d, closes: t, t: Math.min(Math.max(Math.ceil(minute), d.t), t) })} />
      ) : (
        kind !== 'bus_delay' && <TimeField label={kind === 'encounter' ? 'À partir de' : 'À'} value={d.t} min={minute} onChange={(t) => onChange({ ...d, t, until: Math.max(d.until, t + 15) })} />
      )}
      {(kind === 'stay_home' || (kind === 'weather' && d.condition === 'rain')) && <TimeField label="Jusqu’à" value={d.until} min={Math.max(minute, d.t + 1)} onChange={(t) => set('until', t)} />}
    </div>
  );
}
