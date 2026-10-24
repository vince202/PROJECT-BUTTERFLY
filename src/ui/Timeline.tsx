/**
 * Bottom timeline: 06:00–24:00 track, draggable playhead, event markers by
 * family lane, divergence / consequence markers when a reality B exists.
 */

import { memo, useMemo, useRef, useState } from 'react';
import { useSimStore } from '../store/useSimStore';
import type { Comparison } from '../sim/compare';
import type { Reality } from '../sim/reality';
import { fmtTime } from '../sim/time';
import { DAY_END, DAY_LENGTH, DAY_START, type SimEvent } from '../sim/types';
import { eventFamily, eventTypeLabel, type EventFamily } from './format';
import { useActiveReality } from './hooks';

const pos = (t: number) => ((Math.max(DAY_START, Math.min(DAY_END, t)) - DAY_START) / DAY_LENGTH) * 100;

const LANES: EventFamily[] = ['drama', 'social', 'trouble', 'bus', 'world', 'decision'];
const laneOf = (f: EventFamily) => {
  const i = LANES.indexOf(f === 'routine' ? 'decision' : f);
  return i < 0 ? LANES.length - 1 : i;
};

interface Tip {
  x: number;
  title: string;
  text: string;
  tone?: string;
}

export function Timeline() {
  const reality = useActiveReality();
  const comparison = useSimStore((s) => s.comparison);
  const activeId = useSimStore((s) => s.activeRealityId);
  const generation = useSimStore((s) => s.generation);
  const selectedEventId = useSimStore((s) => s.selectedEventId);
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const [tip, setTip] = useState<Tip | null>(null);

  const timeFromX = (clientX: number) => {
    const r = trackRef.current!.getBoundingClientRect();
    const k = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    return DAY_START + k * DAY_LENGTH;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    dragging.current = true;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    useSimStore.getState().seek(Math.round(timeFromX(e.clientX)));
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging.current) return;
    useSimStore.getState().seek(Math.round(timeFromX(e.clientX)));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    dragging.current = false;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    const s = useSimStore.getState();
    const step = e.shiftKey ? 30 : 5;
    if (e.key === 'ArrowRight') (e.preventDefault(), s.seek(Math.floor(s.time) + step));
    else if (e.key === 'ArrowLeft') (e.preventDefault(), s.seek(Math.floor(s.time) - step));
    else if (e.key === 'Home') (e.preventDefault(), s.seek(DAY_START));
    else if (e.key === 'End') (e.preventDefault(), s.seek(DAY_END));
  };


  return (
    <div className="timeline">
      <div className="tl-head">
        <TimeLabel name={reality.def.name} isB={activeId === 'B'} />
        <Legend hasComparison={!!comparison} />
      </div>
      <div
        className="tl-track"
        ref={trackRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
        tabIndex={0}
        role="slider"
        aria-label="Chronologie de la journée"
        aria-valuemin={DAY_START}
        aria-valuemax={DAY_END}
        title="Cliquez ou glissez pour vous déplacer dans la journée (← → au clavier)"
      >
        <div className="tl-band" aria-hidden>
          <div className="tl-day" style={{ left: 0, width: `${pos(20 * 60)}%` }} />
          <div className="tl-dusk" style={{ left: `${pos(19 * 60)}%`, width: `${pos(21 * 60) - pos(19 * 60)}%` }} />
          <div className="tl-night" style={{ left: `${pos(21 * 60)}%`, right: 0 }} />
        </div>
        <Ticks />
        <Markers reality={reality} generation={generation} selectedEventId={selectedEventId} onTip={setTip} />
        {comparison && <ComparisonMarkers comparison={comparison} onTip={setTip} />}
        <Playhead />
        {tip && (
          <div className={`tl-tip ${tip.tone ?? ''}`} style={{ left: `clamp(80px, ${tip.x}%, calc(100% - 80px))` }}>
            <div className="tl-tip-title">{tip.title}</div>
            <div className="tl-tip-text">{tip.text}</div>
          </div>
        )}
      </div>
      <HourLabels />
    </div>
  );
}

function TimeLabel({ name, isB }: { name: string; isB: boolean }) {
  const time = useSimStore((s) => s.time);
  return (
    <div className="tl-now">
      <span className="mono tl-now-time">{fmtTime(Math.floor(time))}</span>
      <span className={`reality-tag ${isB ? 'b' : ''}`}>{name}</span>
    </div>
  );
}

function Legend({ hasComparison }: { hasComparison: boolean }) {
  return (
    <div className="tl-legend" aria-label="Légende">
      <span title="Temps forts, points de bascule, confidences, rumeurs et dilemmes">
        <i className="fam-dot fam-drama" /> Drame
      </span>
      <span>
        <i className="fam-dot fam-social" /> Rencontres
      </span>
      <span>
        <i className="fam-dot fam-trouble" /> Contretemps
      </span>
      <span>
        <i className="fam-dot fam-bus" /> Bus
      </span>
      <span>
        <i className="fam-dot fam-world" /> Objets · météo · commerces
      </span>
      <span>
        <i className="fam-dot fam-decision" /> Décisions
      </span>
      <span>
        <i className="diamond" /> Intervention
      </span>
      {hasComparison && (
        <>
          <span>
            <i className="div-mark" /> 1re divergence
          </span>
          <span>
            <i className="cons-mark" /> Conséquence vérifiée
          </span>
        </>
      )}
    </div>
  );
}

const Ticks = memo(function Ticks() {
  const ticks = [];
  for (let h = 6; h <= 24; h++) ticks.push(<span key={h} className={`tl-tick ${h % 2 === 0 ? 'major' : ''}`} style={{ left: `${pos(h * 60)}%` }} />);
  return <>{ticks}</>;
});

const HourLabels = memo(function HourLabels() {
  const labels = [];
  for (let h = 6; h <= 24; h += 2)
    labels.push(
      <span key={h} className="tl-hour" style={{ left: `${pos(h * 60)}%` }}>
        {String(h).padStart(2, '0')}h
      </span>,
    );
  return <div className="tl-hours">{labels}</div>;
});

function Playhead() {
  const time = useSimStore((s) => s.time);
  return (
    <div className="tl-playhead" style={{ left: `${pos(time)}%` }} aria-hidden>
      <span className="tl-playhead-knob" />
    </div>
  );
}

function selectMarker(e: SimEvent) {
  const s = useSimStore.getState();
  s.selectEvent(e.id);
  s.seek(e.t);
}

const Markers = memo(function Markers({ reality, generation, selectedEventId, onTip }: { reality: Reality; generation: number; selectedEventId: string | null; onTip: (t: Tip | null) => void }) {
  const markers = useMemo(() => reality.markers(0.5), [reality, generation]);
  return (
    <div className="tl-markers">
      {markers.map((e) => {
        const fam = eventFamily(e.type);
        const x = pos(e.t);
        return (
          <button
            key={e.id}
            className={`tl-marker fam-${fam} lane-${fam === 'intervention' ? 'all' : laneOf(fam)} ${selectedEventId === e.id ? 'selected' : ''}`}
            style={{ left: `${x}%` }}
            onPointerDown={(ev) => ev.stopPropagation()}
            onClick={(ev) => {
              ev.stopPropagation();
              selectMarker(e);
            }}
            onMouseEnter={() => onTip({ x, title: `${fmtTime(e.t)} · ${eventTypeLabel(e.type)}`, text: e.label })}
            onMouseLeave={() => onTip(null)}
            onFocus={() => onTip({ x, title: `${fmtTime(e.t)} · ${eventTypeLabel(e.type)}`, text: e.label })}
            onBlur={() => onTip(null)}
            aria-label={`${fmtTime(e.t)} ${e.label}`}
          />
        );
      })}
    </div>
  );
});

const ComparisonMarkers = memo(function ComparisonMarkers({ comparison, onTip }: { comparison: Comparison; onTip: (t: Tip | null) => void }) {
  const go = (e: SimEvent, reality: 'A' | 'B') => {
    const s = useSimStore.getState();
    if (s.activeRealityId !== reality) s.switchReality(reality);
    s.selectEvent(e.id);
    s.seek(e.t);
  };
  const first = comparison.firstDivergence;
  const firstEv = first ? (first.b ?? first.a)! : null;
  const firstReality: 'A' | 'B' = first?.b ? 'B' : 'A';
  return (
    <div className="tl-compare">
      {comparison.consequences.slice(0, 200).map((m, i) => {
        const e = (m.b ?? m.a)!;
        const x = pos(e.t);
        const text = m.status === 'only_a' ? `N’a pas eu lieu dans B : ${e.label}` : m.status === 'shifted' ? `Décalé de ${m.dt! > 0 ? '+' : ''}${m.dt} min : ${e.label}` : `Seulement dans B : ${e.label}`;
        return (
          <button
            key={`${e.id}-${i}`}
            className={`tl-cons ${m.status}`}
            style={{ left: `${x}%` }}
            onPointerDown={(ev) => ev.stopPropagation()}
            onClick={(ev) => (ev.stopPropagation(), go(e, m.b ? 'B' : 'A'))}
            onMouseEnter={() => onTip({ x, title: `${fmtTime(e.t)} · Conséquence vérifiée`, text, tone: 'cons' })}
            onMouseLeave={() => onTip(null)}
            aria-label={`${fmtTime(e.t)} conséquence : ${text}`}
          />
        );
      })}
      {firstEv && (
        <button
          className="tl-div"
          style={{ left: `${pos(firstEv.t)}%` }}
          onPointerDown={(ev) => ev.stopPropagation()}
          onClick={(ev) => (ev.stopPropagation(), go(firstEv, firstReality))}
          onMouseEnter={() => onTip({ x: pos(firstEv.t), title: `${fmtTime(firstEv.t)} · Première divergence`, text: firstEv.label, tone: 'div' })}
          onMouseLeave={() => onTip(null)}
          aria-label={`Première divergence à ${fmtTime(firstEv.t)}`}
        />
      )}
    </div>
  );
});
