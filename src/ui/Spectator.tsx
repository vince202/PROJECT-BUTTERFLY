/**
 * Spectator mode: the city fills the viewport; only a few glass overlays
 * float above it (clock, playback pill, mode / reality switch, context card of
 * the hovered or selected inhabitant, event toast, first-run hint).
 *
 * The overlay root is `pointer-events: none`; only the pills and cards accept
 * the pointer, so the city can be orbited everywhere else.
 */

import { useEffect, useRef, useState } from 'react';
import { useSimStore, type Speed } from '../store/useSimStore';
import { AGENTS } from '../sim/population';
import { fmtTime, periodOfDay } from '../sim/time';
import { DAY_END, DAY_LENGTH, DAY_START, type AgentId } from '../sim/types';
import { eventFamily, eventTypeLabel, locName, moodColor, moodWord, weatherLabel } from './format';
import { useActiveReality, useMinute } from './hooks';
import { usePresence } from './mode';

const SPEEDS: Speed[] = [1, 2, 10, 60];
const HINT_KEY = 'butterfly:spectator-hint-dismissed';

export function SpectatorOverlay({ leaving = false }: { leaving?: boolean }) {
  return (
    <div className={`spectator-ui ${leaving ? 'leaving' : ''}`}>
      <SpecClock />
      <SpecCorner />
      <EventToast />
      <ContextCards />
      <PlaybackPill />
      <FirstRunHint />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Top-left: brand + clock
// ---------------------------------------------------------------------------

function SpecClock() {
  const minute = useMinute();
  const reality = useActiveReality();
  const day = useSimStore((s) => s.day);
  const isB = useSimStore((s) => s.activeRealityId === 'B' && !!s.realityB);
  const weather = weatherLabel(reality.frameAt(minute)?.weather);
  return (
    <div className="spec-clock glass" title={`${reality.def.name} · Jour ${day}`}>
      <span className="spec-brand">
        <span aria-hidden>🦋</span> BUTTERFLY
      </span>
      <span className="spec-clock-row">
        <span className="spec-time mono">{fmtTime(minute)}</span>
        <span className="spec-meta">
          <span className="spec-period">{periodOfDay(minute)}</span>
          <span className="spec-weather" title={`Météo : ${weather.text}`} aria-label={`Météo : ${weather.text}`}>
            {weather.icon}
          </span>
          {isB && <span className="spec-b">B</span>}
        </span>
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Top-right: reality switch + back to the laboratory
// ---------------------------------------------------------------------------

function SpecCorner() {
  const hasB = useSimStore((s) => !!s.realityB);
  const activeId = useSimStore((s) => s.activeRealityId);
  const { switchReality, setUiMode } = useSimStore.getState();
  return (
    <div className="spec-corner">
      {hasB && (
        <div className="seg reality spec-reality glass" role="group" aria-label="Réalité affichée">
          <button className={activeId === 'A' ? 'active' : ''} onClick={() => switchReality('A')} title="Réalité A — la journée originale">
            A
          </button>
          <button className={`b ${activeId === 'B' ? 'active' : ''}`} onClick={() => switchReality('B')} title="Réalité B — la journée modifiée">
            B
          </button>
        </div>
      )}
      <button className="spec-round glass" onClick={() => setUiMode('lab')} title="Mode laboratoire (Tab)" aria-label="Mode laboratoire">
        <span aria-hidden>🧪</span>
        <span className="spec-round-label">Mode laboratoire</span>
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bottom-centre: playback pill with hover scrub bar
// ---------------------------------------------------------------------------

const pos = (t: number) => ((Math.max(DAY_START, Math.min(DAY_END, t)) - DAY_START) / DAY_LENGTH) * 100;

function PlaybackPill() {
  const playing = useSimStore((s) => s.playing);
  const speed = useSimStore((s) => s.speed);
  const { restart, togglePlay, setSpeed } = useSimStore.getState();
  return (
    <div className="spec-pill glass" role="group" aria-label="Lecture">
      <Scrub />
      <div className="spec-pill-row">
        <button className="spec-btn" onClick={restart} title="Revenir à 06:00" aria-label="Revenir à 06:00">
          ⏮
        </button>
        <button className={`spec-btn play ${playing ? 'on' : ''}`} onClick={togglePlay} title={playing ? 'Pause (Espace)' : 'Lecture (Espace)'} aria-label={playing ? 'Pause' : 'Lecture'}>
          {playing ? '⏸' : '▶'}
        </button>
        <div className="spec-speed" role="group" aria-label="Vitesse">
          {SPEEDS.map((s) => (
            <button key={s} className={speed === s ? 'active' : ''} onClick={() => setSpeed(s)} title={`×${s} = ${s} minute${s > 1 ? 's' : ''} simulée${s > 1 ? 's' : ''} par seconde`} aria-pressed={speed === s}>
              ×{s}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function Scrub() {
  const time = useSimStore((s) => s.time);
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const [hover, setHover] = useState<number | null>(null);

  const timeAt = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    const k = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    return Math.round(DAY_START + k * DAY_LENGTH);
  };
  const onDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    dragging.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    useSimStore.getState().seek(timeAt(e.clientX));
  };
  const onMove = (e: React.PointerEvent) => {
    const t = timeAt(e.clientX);
    setHover(t);
    if (dragging.current) useSimStore.getState().seek(t);
  };
  const onUp = (e: React.PointerEvent) => {
    dragging.current = false;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  };
  const onKey = (e: React.KeyboardEvent) => {
    const s = useSimStore.getState();
    const step = e.shiftKey ? 30 : 5;
    if (e.key === 'ArrowRight') (e.preventDefault(), s.seek(Math.floor(s.time) + step));
    else if (e.key === 'ArrowLeft') (e.preventDefault(), s.seek(Math.floor(s.time) - step));
    else if (e.key === 'Home') (e.preventDefault(), s.seek(DAY_START));
    else if (e.key === 'End') (e.preventDefault(), s.seek(DAY_END));
  };

  return (
    <div className="spec-scrub">
      <span className="spec-scrub-end mono">06:00</span>
      <div
        className="spec-scrub-track"
        ref={ref}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onPointerLeave={() => setHover(null)}
        onKeyDown={onKey}
        tabIndex={0}
        role="slider"
        aria-label="Heure de la journée"
        aria-valuemin={DAY_START}
        aria-valuemax={DAY_END}
        aria-valuenow={Math.floor(time)}
        aria-valuetext={fmtTime(Math.floor(time))}
      >
        <span className="spec-scrub-rail" aria-hidden>
          <span className="spec-scrub-fill" style={{ width: `${pos(time)}%` }} />
        </span>
        <span className="spec-scrub-knob" style={{ left: `${pos(time)}%` }} aria-hidden />
        {hover !== null && (
          <span className="spec-scrub-tip mono" style={{ left: `${pos(hover)}%` }} aria-hidden>
            {fmtTime(hover)}
          </span>
        )}
      </div>
      <span className="spec-scrub-end mono">24:00</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bottom-left: context cards (hovered preview + selected inhabitant)
// ---------------------------------------------------------------------------

function ContextCards() {
  const selectedId = useSimStore((s) => s.selectedAgentId);
  const hoveredId = useSimStore((s) => s.hoveredAgentId);
  const sel = usePresence<AgentId>(selectedId);
  const hov = usePresence<AgentId>(hoveredId && hoveredId !== selectedId ? hoveredId : null, 160);
  return (
    <div className="spec-cards">
      {hov.value && hov.value !== sel.value && <AgentContextCard key={`h-${hov.value}`} id={hov.value} leaving={hov.leaving} />}
      {sel.value && <AgentContextCard key={`s-${sel.value}`} id={sel.value} selected leaving={sel.leaving} />}
    </div>
  );
}

function AgentContextCard({ id, selected = false, leaving }: { id: AgentId; selected?: boolean; leaving: boolean }) {
  const reality = useActiveReality();
  const minute = useMinute();
  const followed = useSimStore((s) => s.followAgentId === id);
  const { followAgent, selectAgent, selectEvent, setUiMode, hoverAgent } = useSimStore.getState();
  const profile = AGENTS.find((a) => a.id === id);
  if (!profile) return null;
  const tr = reality.frameAt(minute)?.agents[id];
  const where = tr ? (tr.riding ? 'Dans le bus' : locName(tr.loc)) : '—';
  const mood = tr?.mood ?? 0;
  const why = () => {
    selectEvent(null);
    if (useSimStore.getState().selectedAgentId !== id) selectAgent(id);
    hoverAgent(null);
    setUiMode('lab');
  };
  return (
    <section
      className={`spec-card glass ${selected ? 'selected' : 'preview'} ${leaving ? 'leaving' : ''} ${tr?.asleep ? 'asleep' : ''}`}
      style={{ ['--agent' as string]: profile.color }}
      aria-label={`${profile.name}${selected ? ' (sélectionné·e)' : ''}`}
    >
      <header className="spec-card-head">
        <span className="agent-dot lg" style={{ background: profile.color }} aria-hidden />
        <span className="spec-card-id">
          <span className="spec-card-name">{profile.name}</span>
          <span className="spec-card-sub">
            {profile.age} ans · {profile.occupation}
          </span>
        </span>
        {selected && (
          <button className="spec-x" onClick={() => selectAgent(null)} title="Désélectionner (Échap)" aria-label="Désélectionner">
            ✕
          </button>
        )}
      </header>
      <div className="spec-card-now">
        <span className="spec-card-act">{tr?.act ?? '—'}</span>
        <span className="spec-card-loc">· {where}</span>
      </div>
      <div className="spec-card-mood" style={{ color: moodColor(mood) }}>
        <span className="mood-dot" style={{ background: moodColor(mood) }} aria-hidden />
        {moodWord(mood)}
      </div>
      {selected && (
        <div className="spec-card-actions">
          <button className={`spec-chip ${followed ? 'on' : ''}`} onClick={() => followAgent(followed ? null : id)} aria-pressed={followed} title={followed ? `Ne plus suivre ${profile.firstName}` : `Suivre ${profile.firstName} avec la caméra`}>
            👁 {followed ? 'Suivi·e' : 'Suivre'}
          </button>
          <button className="spec-chip accent" onClick={why} title={`Ouvrir le laboratoire sur la fiche de ${profile.firstName}`}>
            Pourquoi ?
          </button>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Top-centre: selected event toast
// ---------------------------------------------------------------------------

function EventToast() {
  const selectedEventId = useSimStore((s) => s.selectedEventId);
  const reality = useActiveReality();
  const shown = usePresence<string>(selectedEventId);
  const e = shown.value ? reality.eventById(shown.value) : undefined;
  if (!e) return null;
  const { selectEvent, setUiMode } = useSimStore.getState();
  return (
    <div className={`spec-toast glass ${shown.leaving ? 'leaving' : ''}`} role="status">
      <span className={`fam-dot fam-${eventFamily(e.type)}`} aria-hidden />
      <span className="spec-toast-time mono">{fmtTime(e.t)}</span>
      <span className="spec-toast-text" title={`${eventTypeLabel(e.type)} — ${e.label}`}>
        {e.label}
      </span>
      <button className="spec-chip accent" onClick={() => setUiMode('lab')} title="Voir les causes et conséquences dans le laboratoire">
        Détails
      </button>
      <button className="spec-x" onClick={() => selectEvent(null)} title="Fermer (Échap)" aria-label="Fermer">
        ✕
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// First-run hint
// ---------------------------------------------------------------------------

function readHintDismissed(): boolean {
  try {
    return localStorage.getItem(HINT_KEY) === '1';
  } catch {
    return false;
  }
}

function FirstRunHint() {
  const [hidden, setHidden] = useState(true);
  useEffect(() => setHidden(readHintDismissed()), []);
  if (hidden) return null;
  const dismiss = () => {
    setHidden(true);
    try {
      localStorage.setItem(HINT_KEY, '1');
    } catch {
      /* storage unavailable */
    }
  };
  return (
    <div className="spec-hint glass" role="note">
      <span>
        Survolez un habitant · Molette pour zoomer · <kbd>Tab</kbd> pour le laboratoire
      </span>
      <button className="spec-x" onClick={dismiss} title="Masquer cette aide" aria-label="Masquer cette aide">
        ✕
      </button>
    </div>
  );
}
