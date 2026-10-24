/**
 * Top bar (laboratory mode): brand, clock, playback, reality switch, panel
 * toggles, switch to spectator mode. Secondary controls (seed, day, decision
 * policy, AI status) are folded into a "⋯ Plus" popover on narrower screens.
 * Keyboard shortcuts live in ui/mode.ts (useGlobalShortcuts).
 */

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useSimStore, type PanelId } from '../store/useSimStore';
import { SPEEDS, speedTitle } from '../store/speed';
import { fmtTime, periodKey, periodLabel } from '../sim/time';
import { DAY_END, DAY_START } from '../sim/types';
import { parseClock, weatherLabel } from './format';
import { useActiveReality, useLocale, useMinute } from './hooks';
import { LangToggle } from './LangToggle';
import { t } from '../i18n';

const PANEL_DEFS: { id: Exclude<PanelId, null>; icon: string }[] = [
  { id: 'butterfly', icon: '🦋' },
  { id: 'causal', icon: '⛓' },
  { id: 'compare', icon: '⇄' },
  { id: 'report', icon: '📜' },
];

/** Panel buttons in the active language (resolved at render). */
function panelButtons(): { id: Exclude<PanelId, null>; label: string; icon: string; title: string }[] {
  return PANEL_DEFS.map((p) => ({ ...p, label: t(`ui.topbar_panel_${p.id}`), title: t(`ui.topbar_panel_${p.id}_title`) }));
}

/**
 * True when the full top bar does not fit: the secondary controls are then
 * folded into the « ⋯ Plus » popover. Measured (not a fixed breakpoint) so the
 * bar never wraps nor overflows whatever the labels and fonts.
 */
function useFitsOrCompact(ref: RefObject<HTMLElement | null>): boolean {
  const [compact, setCompact] = useState(false);
  const state = useRef({ compact: false, fullWidth: 0 });
  const check = useRef(() => {
    const el = ref.current;
    if (!el) return;
    const st = state.current;
    if (!st.compact) {
      if (el.scrollWidth > el.clientWidth + 1) {
        st.fullWidth = el.scrollWidth;
        st.compact = true;
        setCompact(true);
      }
    } else if (el.clientWidth >= st.fullWidth) {
      st.compact = false;
      setCompact(false);
    }
  }).current;
  // Content can change width too (AI status, reality B…): re-check after every render.
  useLayoutEffect(check);
  useLayoutEffect(() => {
    if (!ref.current || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(check);
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, [ref, check]);
  return compact;
}

export function TopBar() {
  useLocale();
  const minute = useMinute();
  const reality = useActiveReality();
  const playing = useSimStore((s) => s.playing);
  const speed = useSimStore((s) => s.speed);
  const seed = useSimStore((s) => s.seed);
  const realityB = useSimStore((s) => s.realityB);
  const activeId = useSimStore((s) => s.activeRealityId);
  const panel = useSimStore((s) => s.panel);
  const { restart, togglePlay, setSpeed, seek, generateAll, setSeed, switchReality, setPanel } = useSimStore.getState();

  const frame = reality.frameAt(minute);
  const weather = weatherLabel(frame?.weather);

  const barRef = useRef<HTMLElement>(null);
  const compact = useFitsOrCompact(barRef);
  const setUiMode = useSimStore((s) => s.setUiMode);

  return (
    <header className={`topbar ${compact ? 'compact' : ''}`} ref={barRef}>
      <div className="brand" title={t('ui.topbar_brand_title')}>
        <span className="brand-mark" aria-hidden>
          🦋
        </span>
        <span className="brand-text">
          <span className="brand-name">BUTTERFLY</span>
          <span className="brand-sub">{t('common.tagline')}</span>
        </span>
      </div>

      <div className="clock" title={t('ui.topbar_clock_title', { name: reality.def.name })}>
        <span className="clock-time mono">{fmtTime(minute)}</span>
        <span className="clock-meta">
          <span className="clock-period">{periodLabel(periodKey(minute))}</span>
          <span className="clock-weather" title={t('ui.topbar_weather_title', { weather: weather.text })}>
            {weather.icon} <span className="clock-weather-text">{weather.text}</span>
          </span>
        </span>
      </div>

      <div className="tb-group playback" role="group" aria-label={t('ui.topbar_playback_group')}>
        <button className="icon-btn" onClick={restart} title={t('ui.topbar_back_to_start')}>
          ⏮
        </button>
        <button className={`icon-btn play ${playing ? 'on' : ''}`} onClick={togglePlay} title={playing ? t('ui.topbar_pause_title') : t('ui.topbar_play_title')}>
          {playing ? '⏸' : '▶'}
        </button>
        <div className="seg speed" role="group" aria-label={t('ui.topbar_speed_group')} title={t('ui.topbar_speed_hint')}>
          {SPEEDS.map((s) => (
            <button key={s} className={speed === s ? 'active' : ''} onClick={() => setSpeed(s)} title={speedTitle(s)} aria-pressed={speed === s}>
              ×{s}
            </button>
          ))}
        </div>
        <button className="btn ghost sm full-day" onClick={generateAll} title={t('ui.topbar_full_day_title')} aria-label={t('ui.topbar_full_day')}>
          <span className="full-day-icon" aria-hidden>
            ⏭
          </span>
          <span className="tb-label">{t('ui.topbar_full_day')}</span>
        </button>
        <GoTo onGo={seek} />
      </div>

      <div className="tb-spacer" />

      {!compact && (
        <>
          <SeedControl seed={seed} hasB={!!realityB} onSet={setSeed} />
          <DayControl />
          <PolicyControl />
        </>
      )}

      <div className="seg reality" role="group" aria-label={t('ui.topbar_reality_group')}>
        <button className={activeId === 'A' ? 'active' : ''} onClick={() => switchReality('A')} title={t('ui.topbar_reality_a_title')}>
          {t('ui.reality_a_short')}
        </button>
        <button
          className={`b ${activeId === 'B' ? 'active' : ''}`}
          onClick={() => switchReality('B')}
          disabled={!realityB}
          title={realityB ? t('ui.topbar_reality_b_title') : t('ui.topbar_reality_b_missing')}
        >
          {t('ui.reality_b_short')}
        </button>
      </div>

      <nav className="tb-group panels" aria-label={t('ui.topbar_panels_group')}>
        {panelButtons().map((p) => {
          const disabled = p.id === 'compare' && !realityB;
          return (
            <button
              key={p.id}
              className={`panel-btn ${panel === p.id ? 'active' : ''} ${p.id === 'butterfly' ? 'hero' : ''}`}
              onClick={() => setPanel(p.id)}
              disabled={disabled}
              title={disabled ? t('ui.topbar_panel_compare_disabled') : p.title}
            >
              <span aria-hidden>{p.icon}</span>
              <span className="panel-btn-label">{p.label}</span>
            </button>
          );
        })}
      </nav>

      {compact ? (
        <MoreMenu>
          <SeedControl seed={seed} hasB={!!realityB} onSet={setSeed} inline />
          <DayControl />
          <PolicyControl />
          <AiBadge full />
        </MoreMenu>
      ) : (
        <AiBadge />
      )}

      <LangToggle />

      <button className="btn sm spectator-btn" onClick={() => setUiMode('spectator')} title={t('ui.topbar_spectator_title')}>
        <span aria-hidden>👁</span> {t('ui.topbar_spectator')}
      </button>
    </header>
  );
}

function AiBadge({ full = false }: { full?: boolean }) {
  const ai = useSimStore((s) => s.ai);
  return (
    <span className={`ai-badge ${ai.enabled ? 'on' : ''} ${full ? 'full' : ''}`} title={ai.message ?? (ai.checked ? '' : t('ui.topbar_ai_checking'))}>
      <span className="ai-dot" aria-hidden />
      <span className="ai-text">{!ai.checked ? t('ui.topbar_ai_pending') : ai.enabled ? t('ui.topbar_ai_on', { model: ai.model }) : t('ui.topbar_ai_off')}</span>
    </span>
  );
}

/** « ⋯ Plus » button + popover holding the secondary controls. */
function MoreMenu({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', esc);
    };
  }, [open]);
  return (
    <div className="seed more" ref={ref}>
      <button className={`btn ghost sm ${open ? 'active' : ''}`} onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="true" title={t('ui.topbar_more_title')}>
        {t('ui.topbar_more')}
      </button>
      {open && (
        <div className="popover more-pop" role="menu">
          {children}
        </div>
      )}
    </div>
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
      title={t('ui.topbar_goto_title')}
    >
      <label htmlFor="goto-input">{t('ui.topbar_goto_label')}</label>
      <input id="goto-input" className="input mono" value={v} placeholder="HH:MM" onChange={(e) => (setV(e.target.value), setErr(false))} maxLength={5} />
    </form>
  );
}

function SeedControl({ seed, hasB, onSet, inline = false }: { seed: number; hasB: boolean; onSet: (s: number) => void; inline?: boolean }) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState(String(seed));
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => setV(String(seed)), [seed]);
  useEffect(() => {
    if (!open || inline) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open, inline]);
  const apply = (n: number) => {
    if (!Number.isFinite(n)) return;
    if (hasB && !window.confirm(t('ui.topbar_seed_confirm'))) return;
    onSet(Math.floor(n));
    setOpen(false);
  };
  return (
    <div className="seed" ref={ref}>
      <button className="btn ghost sm" onClick={() => setOpen(!open)} title={t('ui.topbar_seed_title')} aria-expanded={open}>
        🎲 {t('ui.topbar_seed_label')} <span className="mono">{seed}</span>
      </button>
      {open && (
        <div className={`popover ${inline ? 'inline' : ''}`}>
          <div className="popover-title">{t('ui.topbar_seed_popover_title')}</div>
          <p className="muted small">{t('ui.topbar_seed_explain')}</p>
          <form
            className="row gap"
            onSubmit={(e) => {
              e.preventDefault();
              apply(Number(v));
            }}
          >
            <input className="input mono" type="number" value={v} onChange={(e) => setV(e.target.value)} aria-label={t('ui.topbar_seed_label')} />
            <button className="btn primary sm" type="submit" title={t('ui.topbar_seed_generate_title')}>
              {t('ui.topbar_seed_popover_title')}
            </button>
          </form>
          <button className="link small" onClick={() => apply(Math.floor(Math.random() * 100000))} title={t('ui.topbar_seed_random_title')}>
            {t('ui.topbar_seed_random')}
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
    const key = activeId === 'B' && hasB ? 'ui.topbar_next_day_confirm_b' : 'ui.topbar_next_day_confirm_a';
    if (window.confirm(t(key, { day: day + 1 }))) nextDay();
  };
  return (
    <div className="seed" title={t('ui.topbar_day_title')}>
      <button className="btn ghost sm" onClick={onNext} aria-label={t('ui.topbar_day_next_aria')}>
        {t('ui.topbar_day_next', { day })}
      </button>
    </div>
  );
}


/** Decision policy switch: utility scores alone, or an advisor (LLM when available, deterministic mock otherwise). */
function PolicyControl() {
  const mode = useSimStore((s) => s.policyMode);
  const advising = useSimStore((s) => s.advising);
  const info = useSimStore((s) => s.advisorInfo);
  const advisor = useSimStore((s) => s.ai.advisor);
  const aiEnabled = !!advisor;
  const setPolicyMode = useSimStore((s) => s.setPolicyMode);
  const title = t(advisor === 'jev' ? 'ui.topbar_policy_title_jev' : advisor ? 'ui.topbar_policy_title_ai' : 'ui.topbar_policy_title_mock', { info: info ?? '' });
  const advisedLabel = t(advisor === 'jev' ? 'ui.topbar_policy_advised_jev' : aiEnabled ? 'ui.topbar_policy_advised_ai' : 'ui.topbar_policy_advised_mock');
  return (
    <div className="seed" title={title}>
      <button className={`btn ghost sm${advising ? ' busy' : ''}`} onClick={() => void setPolicyMode(mode === 'utility' ? 'advised' : 'utility')} disabled={advising} aria-label={t('ui.topbar_policy_aria')}>
        {advising ? t('ui.topbar_policy_busy') : mode === 'utility' ? t('ui.topbar_policy_utility') : advisedLabel}
      </button>
    </div>
  );
}
