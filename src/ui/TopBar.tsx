/**
 * Top bar: brand, clock, playback, reality switch, panel toggles, AI status.
 */

import { useEffect, useRef, useState } from 'react';
import { useSimStore, type PanelId, type Speed } from '../store/useSimStore';
import { fmtTime, periodOfDay } from '../sim/time';
import { DAY_END, DAY_START } from '../sim/types';
import { parseClock, weatherLabel } from './format';
import { useActiveReality, useMinute } from './hooks';

const SPEEDS: Speed[] = [1, 2, 10, 60];

const PANELS: { id: Exclude<PanelId, null>; label: string; icon: string; title: string }[] = [
  { id: 'butterfly', label: 'Et si…', icon: '🦋', title: 'Éditeur d’interventions : modifier un détail et créer une réalité B' },
  { id: 'causal', label: 'Causalité', icon: '⛓', title: 'Explorer les causes et conséquences d’un événement' },
  { id: 'compare', label: 'Comparer', icon: '⇄', title: 'Comparer la réalité A et la réalité B' },
  { id: 'report', label: 'Rapport', icon: '📜', title: 'Rapport narratif de la journée' },
];

function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

export function TopBar() {
  const minute = useMinute();
  const reality = useActiveReality();
  const playing = useSimStore((s) => s.playing);
  const speed = useSimStore((s) => s.speed);
  const seed = useSimStore((s) => s.seed);
  const realityB = useSimStore((s) => s.realityB);
  const activeId = useSimStore((s) => s.activeRealityId);
  const panel = useSimStore((s) => s.panel);
  const ai = useSimStore((s) => s.ai);
  const { restart, togglePlay, setSpeed, seek, generateAll, setSeed, switchReality, setPanel } = useSimStore.getState();

  const frame = reality.frameAt(minute);
  const weather = weatherLabel(frame?.weather);

  // Keyboard shortcuts: space = play/pause, Escape = close panel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      const s = useSimStore.getState();
      if (e.code === 'Space') {
        e.preventDefault();
        s.togglePlay();
      } else if (e.key === 'Escape') {
        if (s.panel) s.setPanel(s.panel);
        else if (s.selectedEventId) s.selectEvent(null);
      } else if (e.key === 'ArrowRight' && e.shiftKey) {
        s.seek(Math.floor(s.time) + 10);
      } else if (e.key === 'ArrowLeft' && e.shiftKey) {
        s.seek(Math.floor(s.time) - 10);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <header className="topbar">
      <div className="brand" title="BUTTERFLY — laboratoire de simulation causale">
        <span className="brand-mark" aria-hidden>
          🦋
        </span>
        <span className="brand-text">
          <span className="brand-name">BUTTERFLY</span>
          <span className="brand-sub">Twenty Lives. One Day. Infinite Possibilities.</span>
        </span>
      </div>

      <div className="clock" title={`Heure simulée — ${reality.def.name}`}>
        <span className="clock-time mono">{fmtTime(minute)}</span>
        <span className="clock-meta">
          <span className="clock-period">{periodOfDay(minute)}</span>
          <span className="clock-weather" title={`Météo : ${weather.text}`}>
            {weather.icon} {weather.text}
          </span>
        </span>
      </div>

      <div className="tb-group playback" role="group" aria-label="Lecture">
        <button className="icon-btn" onClick={restart} title="Revenir à 06:00">
          ⏮
        </button>
        <button className={`icon-btn play ${playing ? 'on' : ''}`} onClick={togglePlay} title={playing ? 'Pause (Espace)' : 'Lecture (Espace)'}>
          {playing ? '⏸' : '▶'}
        </button>
        <div className="seg speed" role="group" aria-label="Vitesse" title="×1 = 1 minute simulée par seconde réelle">
          {SPEEDS.map((s) => (
            <button key={s} className={speed === s ? 'active' : ''} onClick={() => setSpeed(s)} title={`×${s} = ${s} minute${s > 1 ? 's' : ''} simulée${s > 1 ? 's' : ''} par seconde réelle`}>
              ×{s}
            </button>
          ))}
        </div>
        <button className="btn ghost sm" onClick={generateAll} title="Voir la journée entière : aller directement à 24:00">
          Journée complète
        </button>
        <GoTo onGo={seek} />
      </div>

      <div className="tb-spacer" />

      <SeedControl seed={seed} hasB={!!realityB} onSet={setSeed} />
      <DayControl />

      <div className="seg reality" role="group" aria-label="Réalité affichée">
        <button className={activeId === 'A' ? 'active' : ''} onClick={() => switchReality('A')} title="Réalité A — la journée originale">
          Réalité A
        </button>
        <button
          className={`b ${activeId === 'B' ? 'active' : ''}`}
          onClick={() => switchReality('B')}
          disabled={!realityB}
          title={realityB ? 'Réalité B — la journée modifiée par votre intervention' : 'Pas encore de réalité B : utilisez « Et si… » pour en créer une'}
        >
          Réalité B
        </button>
      </div>

      <nav className="tb-group panels" aria-label="Panneaux">
        {PANELS.map((p) => {
          const disabled = p.id === 'compare' && !realityB;
          return (
            <button
              key={p.id}
              className={`panel-btn ${panel === p.id ? 'active' : ''} ${p.id === 'butterfly' ? 'hero' : ''}`}
              onClick={() => setPanel(p.id)}
              disabled={disabled}
              title={disabled ? 'Créez d’abord une réalité B avec « Et si… »' : p.title}
            >
              <span aria-hidden>{p.icon}</span>
              <span className="panel-btn-label">{p.label}</span>
            </button>
          );
        })}
      </nav>

      <span className={`ai-badge ${ai.enabled ? 'on' : ''}`} title={ai.message ?? (ai.checked ? '' : 'Vérification du service IA…')}>
        <span className="ai-dot" aria-hidden />
        <span className="ai-text">{!ai.checked ? 'Narration IA : …' : ai.enabled ? `Narration IA : activée${ai.model ? ` · ${ai.model}` : ''}` : 'Narration IA : désactivée'}</span>
      </span>
    </header>
  );
}

function GoTo({ onGo }: { onGo: (t: number) => void }) {
  const [v, setV] = useState('');
  const [err, setErr] = useState(false);
  const submit = () => {
    const t = parseClock(v);
    if (t === null || t < DAY_START || t > DAY_END) {
      setErr(true);
      return;
    }
    setErr(false);
    onGo(t);
    setV('');
  };
  return (
    <form
      className={`goto ${err ? 'err' : ''}`}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      title="Aller à une heure précise (06:00 – 24:00)"
    >
      <label htmlFor="goto-input">Aller à</label>
      <input id="goto-input" className="input mono" value={v} placeholder="HH:MM" onChange={(e) => (setV(e.target.value), setErr(false))} maxLength={5} />
    </form>
  );
}

function SeedControl({ seed, hasB, onSet }: { seed: number; hasB: boolean; onSet: (s: number) => void }) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState(String(seed));
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => setV(String(seed)), [seed]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);
  const apply = (n: number) => {
    if (!Number.isFinite(n)) return;
    if (hasB && !window.confirm('Une nouvelle journée effacera la réalité B et ses interventions. Continuer ?')) return;
    onSet(Math.floor(n));
    setOpen(false);
  };
  return (
    <div className="seed" ref={ref}>
      <button className="btn ghost sm" onClick={() => setOpen(!open)} title="Graine aléatoire de la journée : même graine = même journée" aria-expanded={open}>
        🎲 Graine <span className="mono">{seed}</span>
      </button>
      {open && (
        <div className="popover">
          <div className="popover-title">Nouvelle journée</div>
          <p className="muted small">La graine détermine tous les aléas. Une même graine produit exactement la même journée.</p>
          <form
            className="row gap"
            onSubmit={(e) => {
              e.preventDefault();
              apply(Number(v));
            }}
          >
            <input className="input mono" type="number" value={v} onChange={(e) => setV(e.target.value)} aria-label="Graine" />
            <button className="btn primary sm" type="submit" title="Générer une nouvelle journée avec cette graine">
              Nouvelle journée
            </button>
          </form>
          <button className="link small" onClick={() => apply(Math.floor(Math.random() * 100000))} title="Tirer une graine au hasard">
            Graine au hasard
          </button>
        </div>
      )}
    </div>
  );
}


/** Day counter and "next day" button: the next day starts from the end of the displayed reality. */
function DayControl() {
  const day = useSimStore((s) => s.day);
  const activeId = useSimStore((s) => s.activeRealityId);
  const hasB = useSimStore((s) => !!s.realityB);
  const nextDay = useSimStore((s) => s.nextDay);
  const onNext = () => {
    const from = activeId === 'B' && hasB ? 'la réalité B' : 'la réalité A';
    if (window.confirm(`Passer au jour ${day + 1} à partir de la fin de ${from} ? Les relations, souvenirs importants et portefeuilles perdus sont conservés ; la réalité B est abandonnée.`)) nextDay();
  };
  return (
    <div className="seed" title="Les journées s'enchaînent : chaque matin reprend les relations et souvenirs de la veille">
      <button className="btn ghost sm" onClick={onNext} aria-label="Passer au jour suivant">
        📅 Jour <span className="mono">{day}</span> · suivant ›
      </button>
    </div>
  );
}
