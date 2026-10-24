/**
 * Spectator mode: the city fills the viewport; only a few glass overlays
 * float above it (clock, playback pill, mode / reality switch, context card of
 * the hovered or selected inhabitant, event toast, first-run hint).
 *
 * The overlay root is `pointer-events: none`; only the pills and cards accept
 * the pointer, so the city can be orbited everywhere else.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useSimStore } from '../store/useSimStore';
import { useGameUi } from '../store/gameUi';
import { SPEEDS, speedTitle } from '../store/speed';
import { questCards } from '../sim/game';
import { AGENTS } from '../sim/population';
import { QUEST_LINK_LABELS, questAlerts } from '../sim/quest';
import { fmtTime, periodOfDay } from '../sim/time';
import { DAY_END, DAY_LENGTH, DAY_START, GRAVITY_LABELS, type AgentId, type Gravity, type SimEvent } from '../sim/types';
import { arcStatusAt, dramaSubject, isDramaHighlight, truncate } from './drama';
import { eventFamily, eventTypeLabel, fold, locName, moodColor, moodWord, weatherLabel } from './format';
import { useActiveReality, useMinute } from './hooks';
import { usePresence } from './mode';
import { AlertBubbles, AlertDriver, GameAlertFeed } from './game/Alerts';
import { GameHud } from './game/GameHud';
import { GestureComposer } from './game/GestureComposer';
import { LoopOverlay } from './game/LoopOverlay';
import { Notebook } from './game/Notebook';
import { QuestPicker } from './game/QuestPicker';
import './game/game.css';

const HINT_KEY = 'butterfly:spectator-hint-dismissed';
const GAME_HINT_KEY = 'butterfly:game-hint-dismissed';

export function SpectatorOverlay({ leaving = false }: { leaving?: boolean }) {
  const game = useSimStore((s) => s.game);
  const pickerDismissed = useGameUi((s) => s.pickerDismissed);
  const picking = !game && !pickerDismissed;
  return (
    <div className={`spectator-ui ${leaving ? 'leaving' : ''} ${game ? 'playing-game' : ''}`}>
      {game && <AlertDriver agentId={game.agentId} />}
      {game && <AlertBubbles />}
      {game ? <GameHud game={game} /> : <SpecClock />}
      <SpecCorner />
      <EventToast />
      <ContextCards />
      <PlaybackPill />
      {game && <GestureComposer game={game} />}
      {game && <Notebook game={game} />}
      {game && <LoopOverlay game={game} />}
      {picking && <QuestPicker />}
      {!picking && <FirstRunHint game={!!game} />}
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
  const inGame = useSimStore((s) => !!s.game);
  const pickerDismissed = useGameUi((s) => s.pickerDismissed);
  const { switchReality, setUiMode } = useSimStore.getState();
  return (
    <div className="spec-corner">
      {!inGame && pickerDismissed && (
        <button className="spec-round glass" onClick={() => useGameUi.getState().setPickerDismissed(false)} title="Choisir un habitant à suivre et jouer la boucle" aria-label="Jouer">
          <span aria-hidden>⟲</span>
          <span className="spec-round-label">Jouer — choisir qui suivre</span>
        </button>
      )}
      {inGame && (
        <button className="spec-round glass" onClick={() => useGameUi.getState().setNotebookOpen(!useGameUi.getState().notebookOpen)} title="Carnet des gestes (N)" aria-label="Carnet">
          <span aria-hidden>📓</span>
          <span className="spec-round-label">Carnet</span>
        </button>
      )}
      {hasB && !inGame && (
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
  const inGame = useSimStore((s) => !!s.game);
  const { restart, togglePlay, setSpeed } = useSimStore.getState();
  return (
    <div className={`spec-pill glass ${inGame ? 'game' : ''}`} role="group" aria-label="Lecture">
      <Scrub />
      <div className="spec-pill-row">
        {!inGame && (
          <button className="spec-btn" onClick={restart} title="Revenir à 06:00" aria-label="Revenir à 06:00">
            ⏮
          </button>
        )}
        <button className={`spec-btn play ${playing ? 'on' : ''}`} onClick={togglePlay} title={playing ? 'Pause (Espace)' : 'Lecture (Espace)'} aria-label={playing ? 'Pause' : 'Lecture'}>
          {playing ? '⏸' : '▶'}
        </button>
        <div className="spec-speed" role="group" aria-label="Vitesse" title="×1 = temps réel · touches + / −">
          {SPEEDS.map((s) => (
            <button key={s} className={speed === s ? 'active' : ''} onClick={() => setSpeed(s)} title={speedTitle(s)} aria-pressed={speed === s}>
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
        <ScrubMarkers time={time} />
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

/**
 * Player mode: the day as it repeats (reality A) drawn on the scrub bar — its
 * grave and vital events and the quest's deadline. Hovering shows the label;
 * clicking never seeks (no going back inside a loop), it pins the label with
 * « déjà passé » or « à venir ».
 */
function ScrubMarkers({ time }: { time: number }) {
  const game = useSimStore((s) => s.game);
  const realityA = useSimStore((s) => s.realityA);
  const generation = useSimStore((s) => s.generation);
  const [tip, setTip] = useState<{ key: string; pinned: boolean } | null>(null);
  const markers = useMemo(() => {
    if (!game) return [];
    const out: { key: string; t: number; gravity: Gravity | 'deadline'; label: string; linked: boolean }[] = questAlerts(realityA, game.agentId, { minGravity: 2 }).map((a) => ({
      key: a.event.id,
      t: a.event.t,
      gravity: a.gravity,
      label: `${eventTypeLabel(a.event.type)} (${GRAVITY_LABELS[a.gravity]}) — ${a.event.label}${a.link !== 'none' ? ` · lié à votre quête : ${QUEST_LINK_LABELS[a.link]}` : ''}`,
      linked: a.link !== 'none',
    }));
    const card = questCards(realityA).find((c) => c.agentId === game.agentId);
    if (card) out.push({ key: 'deadline', t: card.deadline, gravity: 'deadline', label: `Échéance de la quête — ${card.title}`, linked: true });
    return out;
  }, [game?.agentId, realityA, generation]);
  if (!game || !markers.length) return null;
  const shown = tip ? markers.find((m) => m.key === tip.key) : undefined;
  const when = (t: number) => (t <= Math.floor(time) ? 'déjà passé' : 'à venir');
  return (
    <>
      {markers.map((m) => (
        <span
          key={m.key}
          className={`scrub-marker ${m.gravity === 'deadline' ? 'deadline' : `g${m.gravity}`} ${m.linked ? 'linked' : ''} ${m.t <= time ? 'past' : ''}`}
          style={{ left: `${pos(m.t)}%` }}
          onPointerDown={(e) => e.stopPropagation()}
          onPointerEnter={() => setTip((x) => (x?.pinned ? x : { key: m.key, pinned: false }))}
          onPointerLeave={() => setTip((x) => (x?.pinned ? x : null))}
          onClick={(e) => {
            e.stopPropagation();
            setTip((x) => (x?.key === m.key && x.pinned ? null : { key: m.key, pinned: true }));
          }}
          role="button"
          aria-label={`${fmtTime(m.t)} — ${m.label} (${when(m.t)})`}
        />
      ))}
      {shown && (
        <span className={`scrub-marker-tip ${tip?.pinned ? 'pinned' : ''}`} style={{ left: `${Math.max(12, Math.min(88, pos(shown.t)))}%` }}>
          <span className="mono">{fmtTime(shown.t)}</span> {truncate(shown.label, 110)} <span className={`scrub-when ${shown.t <= Math.floor(time) ? 'past' : 'future'}`}>{when(shown.t)}</span>
        </span>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Bottom-left: context cards (hovered preview + selected inhabitant)
// ---------------------------------------------------------------------------

function ContextCards() {
  const selectedId = useSimStore((s) => s.selectedAgentId);
  const hoveredId = useSimStore((s) => s.hoveredAgentId);
  const inGame = useSimStore((s) => !!s.game);
  const sel = usePresence<AgentId>(selectedId);
  const hov = usePresence<AgentId>(hoveredId && hoveredId !== selectedId ? hoveredId : null, 160);
  return (
    <div className="spec-cards">
      {inGame ? <GameAlertFeed /> : <DramaFeed />}
      {hov.value && hov.value !== sel.value && <AgentContextCard key={`h-${hov.value}`} id={hov.value} leaving={hov.leaving} />}
      {sel.value && <AgentContextCard key={`s-${sel.value}`} id={sel.value} selected leaving={sel.leaving} />}
    </div>
  );
}

function AgentContextCard({ id, selected = false, leaving }: { id: AgentId; selected?: boolean; leaving: boolean }) {
  const reality = useActiveReality();
  const minute = useMinute();
  const followed = useSimStore((s) => s.followAgentId === id);
  const generation = useSimStore((s) => s.generation);
  const arcAt = useMemo(() => arcStatusAt(reality, id, minute), [reality, id, minute, generation]);
  const { followAgent, selectAgent, selectEvent, setUiMode, hoverAgent } = useSimStore.getState();
  const profile = AGENTS.find((a) => a.id === id);
  if (!profile) return null;
  const tr = reality.frameAt(minute)?.agents[id];
  const where = tr ? (tr.riding ? 'Dans le bus' : locName(tr.loc)) : '—';
  const mood = tr?.mood ?? 0;
  const act = tr?.act ?? '—';
  // Activity labels often already name the place ("Travaille — Agence Horizon", "En chemin").
  const showWhere = !!tr && !fold(act).includes(fold(where));
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
        <span className="spec-card-act">{act}</span>
        {showWhere && <span className="spec-card-loc"> · {where}</span>}
      </div>
      <div className="spec-card-mood" style={{ color: moodColor(mood) }}>
        <span className="mood-dot" style={{ background: moodColor(mood) }} aria-hidden />
        {moodWord(mood)}
      </div>
      {arcAt && (
        <div className={`spec-card-arc st-${arcAt.status}`} title={arcAt.seed.desire}>
          <span className="fam-dot fam-drama" aria-hidden />
          <span className="spec-card-arc-text">
            Aujourd’hui : <strong>{arcAt.seed.title}</strong> — {arcAt.statusLabel}
          </span>
        </div>
      )}
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
// Bottom-left, above the cards: « fil dramatique » (turning points as they pass)
// ---------------------------------------------------------------------------

/** How long a drama toast stays (real time, ms); hovering the feed holds it. */
const DRAMA_TOAST_MS = 6000;
/** Exit animation of a toast (ms). Must match `.drama-toast.leaving` in styles.css. */
const DRAMA_TOAST_OUT_MS = 300;
/** A jump of more than this many simulated minutes in one update is a seek, not playback. */
const MAX_PLAY_STEP = 3;

interface DramaToast {
  e: SimEvent;
  until: number;
  leaving?: boolean;
}

/**
 * Shows each new drama highlight (turning point, confidence, rumour reaching
 * its target, dilemma) as the playhead passes it during playback. Listens to
 * the store outside React and only sets state when a highlight is crossed, so
 * nothing runs per frame in React. Seeking (backwards, or a forward jump) is
 * ignored. Hovering the feed holds the toasts.
 */
function DramaFeed() {
  const reality = useActiveReality();
  const generation = useSimStore((s) => s.generation);
  const [toasts, setToasts] = useState<DramaToast[]>([]);
  const [held, setHeld] = useState(false);
  const highlights = useMemo(() => reality.events.filter(isDramaHighlight), [reality, generation]);

  useEffect(() => {
    let last = Math.floor(useSimStore.getState().time);
    setToasts([]);
    return useSimStore.subscribe((s) => {
      const cur = Math.floor(s.time);
      if (cur === last) return;
      const prev = last;
      last = cur;
      if (!s.playing || cur < prev || cur - prev > MAX_PLAY_STEP) return;
      const fresh = highlights.filter((e) => e.t > prev && e.t <= cur);
      if (!fresh.length) return;
      const until = performance.now() + DRAMA_TOAST_MS;
      setToasts((ts) => [...ts.filter((x) => !fresh.includes(x.e)), ...fresh.map((e) => ({ e, until }))].slice(-2));
    });
  }, [highlights]);

  // Expiry: a toast first plays its exit animation, then is removed.
  useEffect(() => {
    if (held || !toasts.length) return;
    const next = Math.min(...toasts.map((x) => x.until));
    const timer = window.setTimeout(() => {
      const now = performance.now();
      setToasts((ts) => ts.flatMap((x) => (x.until > now + 20 ? [x] : x.leaving ? [] : [{ ...x, leaving: true, until: now + DRAMA_TOAST_OUT_MS }])));
    }, Math.max(0, next - performance.now()));
    return () => window.clearTimeout(timer);
  }, [toasts, held]);

  if (!toasts.length) return null;
  const { selectAgent } = useSimStore.getState();
  return (
    <div
      className="drama-feed"
      role="log"
      aria-label="Fil dramatique"
      aria-live="polite"
      onMouseEnter={() => {
        setHeld(true);
        setToasts((ts) => ts.map((x) => ({ ...x, leaving: false })));
      }}
      onMouseLeave={() => {
        setHeld(false);
        const until = performance.now() + 2500;
        setToasts((ts) => ts.map((x) => ({ ...x, leaving: false, until: Math.max(x.until, until) })));
      }}
    >
      {toasts.map(({ e, leaving }) => {
        const who = dramaSubject(e);
        return (
          <button key={e.id} className={`drama-toast glass ${leaving ? 'leaving' : ''}`} onClick={() => who && selectAgent(who)} title={`${eventTypeLabel(e.type)} — ${e.label}`}>
            <span className={`fam-dot fam-${eventFamily(e.type)}`} aria-hidden />
            <span className="drama-toast-time mono">{fmtTime(e.t)}</span>
            <span className="drama-toast-kind">{eventTypeLabel(e.type)}</span>
            <span className="drama-toast-text">{truncate(e.label, 90)}</span>
          </button>
        );
      })}
    </div>
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

function readHintDismissed(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function FirstRunHint({ game }: { game: boolean }) {
  const key = game ? GAME_HINT_KEY : HINT_KEY;
  const [hidden, setHidden] = useState(true);
  useEffect(() => setHidden(readHintDismissed(key)), [key]);
  if (hidden) return null;
  const dismiss = () => {
    setHidden(true);
    try {
      localStorage.setItem(key, '1');
    } catch {
      /* storage unavailable */
    }
  };
  return (
    <div className="spec-hint glass" role="note">
      {game ? (
        <span>
          <kbd>Espace</kbd> lecture · <kbd>G</kbd> faire un geste · <kbd>N</kbd> carnet · <kbd>Échap</kbd> fermer · <kbd>Tab</kbd> laboratoire
        </span>
      ) : (
        <span>
          Survolez un habitant · Molette pour zoomer · <kbd>Tab</kbd> pour le laboratoire
        </span>
      )}
      <button className="spec-x" onClick={dismiss} title="Masquer cette aide" aria-label="Masquer cette aide">
        ✕
      </button>
    </div>
  );
}
