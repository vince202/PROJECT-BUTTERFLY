/**
 * Small presentational building blocks shared by the inspector and panels.
 */

import { useState, type ReactNode } from 'react';
import { useSimStore } from '../store/useSimStore';
import { fmtTime } from '../sim/time';
import type { AgentId, SimEvent } from '../sim/types';
import { agentColor, eventFamily, eventTypeLabel, firstName } from './format';

export function Section({
  title,
  children,
  defaultOpen = true,
  count,
  right,
  className,
}: {
  title: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  count?: number;
  right?: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={`section ${open ? 'open' : ''} ${className ?? ''}`}>
      <header className="section-head">
        <button className="section-toggle" onClick={() => setOpen(!open)} aria-expanded={open} title={open ? 'Replier' : 'Déplier'}>
          <span className="chev" aria-hidden>
            ▸
          </span>
          <span className="section-title">{title}</span>
          {count !== undefined && <span className="count">{count}</span>}
        </button>
        {right}
      </header>
      {open && <div className="section-body">{children}</div>}
    </section>
  );
}

export function AgentDot({ id, size = 10 }: { id: AgentId; size?: number }) {
  return <span className="agent-dot" style={{ background: agentColor(id), width: size, height: size }} aria-hidden />;
}

export function AgentChip({ id, suffix }: { id: AgentId; suffix?: ReactNode }) {
  const selectAgent = useSimStore((s) => s.selectAgent);
  return (
    <button className="chip agent-chip" onClick={() => selectAgent(id)} title={`Voir la fiche de ${firstName(id)}`}>
      <AgentDot id={id} size={8} />
      {firstName(id)}
      {suffix}
    </button>
  );
}

export function FamilyDot({ e }: { e: SimEvent }) {
  return <span className={`fam-dot fam-${eventFamily(e.type)}`} aria-hidden />;
}

/** A clickable event line: time · family dot · label (+ optional extras). */
export function EventRow({
  e,
  onClick,
  extra,
  sub,
  active,
  title,
}: {
  e: SimEvent;
  onClick?: () => void;
  extra?: ReactNode;
  sub?: ReactNode;
  active?: boolean;
  title?: string;
}) {
  return (
    <div className={`event-row ${active ? 'active' : ''} ${onClick ? 'clickable' : ''}`}>
      <button className="event-row-main" onClick={onClick} disabled={!onClick} title={title ?? `${eventTypeLabel(e.type)} — ${e.label}`}>
        <span className="t mono">{fmtTime(e.t)}</span>
        <FamilyDot e={e} />
        <span className="event-row-text">
          <span className="event-row-label">{e.label}</span>
          {sub && <span className="event-row-sub">{sub}</span>}
        </span>
      </button>
      {extra && <span className="event-row-extra">{extra}</span>}
    </div>
  );
}

/** Horizontal bar 0..1. */
export function Bar({ value, tone = 'accent', label, right }: { value: number; tone?: string; label?: ReactNode; right?: ReactNode }) {
  const v = Math.max(0, Math.min(1, value));
  return (
    <div className="bar-row">
      {label && <span className="bar-label">{label}</span>}
      <span className="bar">
        <span className={`bar-fill tone-${tone}`} style={{ width: `${v * 100}%` }} />
      </span>
      {right !== undefined && <span className="bar-right mono">{right}</span>}
    </div>
  );
}

/** Centred bar for signed values -1..1. */
export function SignedBar({ value, max = 1, label, right }: { value: number; max?: number; label?: ReactNode; right?: ReactNode }) {
  const v = Math.max(-1, Math.min(1, max ? value / max : 0));
  return (
    <div className="bar-row">
      {label && <span className="bar-label">{label}</span>}
      <span className="bar signed">
        <span className="bar-axis" />
        <span
          className={`bar-fill ${v >= 0 ? 'tone-accent' : 'tone-danger'}`}
          style={v >= 0 ? { left: '50%', width: `${v * 50}%` } : { left: `${50 + v * 50}%`, width: `${-v * 50}%` }}
        />
      </span>
      {right !== undefined && <span className="bar-right mono">{right}</span>}
    </div>
  );
}

export function Badge({ tone = 'muted', children, title }: { tone?: string; children: ReactNode; title?: string }) {
  return (
    <span className={`badge tone-${tone}`} title={title}>
      {children}
    </span>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function KV({ k, children }: { k: ReactNode; children: ReactNode }) {
  return (
    <div className="kv">
      <span className="kv-k">{k}</span>
      <span className="kv-v">{children}</span>
    </div>
  );
}
