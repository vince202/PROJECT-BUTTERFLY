/**
 * Causal explorer: why did an event happen (recursive causes), what did it
 * lead to (direct vs indirect effects), and — in reality B — the verified
 * chain from the intervention.
 */

import { useMemo, useState } from 'react';
import { useSimStore } from '../../store/useSimStore';
import { AGENTS } from '../../sim/population';
import type { CausalGraph } from '../../sim/causal';
import { fmtTime } from '../../sim/time';
import type { SimEvent } from '../../sim/types';
import { t } from '../../i18n';
import { AgentChip, Badge, Empty, EventRow, FamilyDot, Section } from '../common';
import { eventFamily, eventTypeLabel, locName } from '../format';
import { useActiveReality, useLocale } from '../hooks';

const MAX_INDIRECT = 40;

export function CausalExplorer() {
  useLocale();
  const selectedEventId = useSimStore((s) => s.selectedEventId);
  const reality = useActiveReality();
  const e = selectedEventId ? reality.eventById(selectedEventId) : undefined;
  return e ? <EventCausality e={e} /> : <EventPicker />;
}

function EventPicker() {
  useLocale();
  const reality = useActiveReality();
  const generation = useSimStore((s) => s.generation);
  const selectedAgentId = useSimStore((s) => s.selectedAgentId);
  const [agent, setAgent] = useState<string>(selectedAgentId ?? '');
  const { selectEvent } = useSimStore.getState();
  const markers = useMemo(() => reality.markers(0.5), [reality, generation]);
  const top = useMemo(() => reality.causal.mostImpactful(6, (e) => e.importance >= 0.3 && !['decision', 'activity_start', 'wake', 'depart'].includes(e.type)), [reality, generation]);
  const list = agent ? markers.filter((e) => e.actors.includes(agent)) : markers;
  return (
    <div className="causal">
      <p className="lead">{t('ui.causal_pick_lead')}</p>
      <Section title={t('ui.causal_top')} count={top.length}>
        {top.map(({ event, descendants }) => (
          <EventRow key={event.id} e={event} onClick={() => selectEvent(event.id)} extra={<Badge tone="accent">{t('ui.causal_downstream', { n: descendants })}</Badge>} />
        ))}
      </Section>
      <Section
        title={t('ui.causal_markers')}
        count={list.length}
        right={
          <select className="input sm" value={agent} onChange={(e) => setAgent(e.target.value)} aria-label={t('ui.causal_filter_aria')}>
            <option value="">{t('ui.causal_all_agents')}</option>
            {AGENTS.map((a) => (
              <option key={a.id} value={a.id}>
                {a.firstName}
              </option>
            ))}
          </select>
        }
      >
        {list.length ? list.map((e) => <EventRow key={e.id} e={e} onClick={() => selectEvent(e.id)} />) : <Empty>{t('ui.causal_markers_none')}</Empty>}
      </Section>
    </div>
  );
}

function EventCausality({ e }: { e: SimEvent }) {
  useLocale();
  const reality = useActiveReality();
  const realityB = useSimStore((s) => s.realityB);
  const generation = useSimStore((s) => s.generation);
  const { selectEvent, seek } = useSimStore.getState();
  const [withDecisions, setWithDecisions] = useState(false);
  const graph = reality.causal;
  const isB = !!realityB && reality === realityB;

  const data = useMemo(() => {
    const causes = graph.directCauses(e.id);
    const roots = graph.roots(e.id);
    const desc = graph.descendants(e.id);
    const direct = graph.directEffects(e.id).sort((a, b) => a.t - b.t);
    let impact = 0;
    const byDepth = new Map<number, SimEvent[]>();
    for (const [id, d] of desc) {
      const ev = graph.get(id);
      if (!ev) continue;
      impact += ev.importance;
      if (d < 2) continue;
      if (!byDepth.has(d)) byDepth.set(d, []);
      byDepth.get(d)!.push(ev);
    }
    return { causes, roots, direct, byDepth, total: desc.size, impact };
  }, [graph, e, generation]);

  const intervention = useMemo(() => {
    if (!isB || !realityB) return null;
    const ivIds = Object.values(realityB.engine.state.interventionEventIds);
    if (!graph.descendsFromIntervention(e.id, new Set(ivIds))) return null;
    for (const iv of ivIds) {
      const chain = graph.chain(iv, e.id);
      if (chain) return { chain };
    }
    return { chain: null as SimEvent[] | null };
  }, [isB, realityB, graph, e, generation]);

  const indirect = useMemo(() => {
    const groups: { depth: number; events: SimEvent[] }[] = [];
    let n = 0;
    for (const d of [...data.byDepth.keys()].sort((a, b) => a - b)) {
      if (n >= MAX_INDIRECT) break;
      const evs = data.byDepth
        .get(d)!
        .filter((x) => withDecisions || x.type !== 'decision')
        .sort((a, b) => a.t - b.t)
        .slice(0, MAX_INDIRECT - n);
      if (!evs.length) continue;
      n += evs.length;
      groups.push({ depth: d, events: evs });
    }
    return { groups, shown: n };
  }, [data, withDecisions]);

  return (
    <div className="causal">
      <div className="causal-head">
        <div className="row gap center">
          <span className={`fam-pill fam-${eventFamily(e.type)}`}>{eventTypeLabel(e.type)}</span>
          <span className="mono strong">{fmtTime(e.t)}</span>
          {e.locationId && <span className="muted small">· {locName(e.locationId)}</span>}
          <span className="grow" />
          <button className="link small" onClick={() => selectEvent(null)} title={t('ui.causal_other_event_title')}>
            {t('ui.causal_other_event')}
          </button>
        </div>
        <h3>{e.label}</h3>
        {e.mechanism && <div className="muted">{e.mechanism}</div>}
        <div className="chips">
          {e.actors.map((a) => (
            <AgentChip key={a} id={a} />
          ))}
        </div>
        <div className="stats mini">
          <div className="stat">
            <span className="stat-v">{data.causes.length}</span>
            <span className="stat-k">{t('ui.causal_stat_causes')}</span>
          </div>
          <div className="stat">
            <span className="stat-v">{data.direct.length}</span>
            <span className="stat-k">{t('ui.causal_stat_effects')}</span>
          </div>
          <div className="stat">
            <span className="stat-v">{data.total}</span>
            <span className="stat-k">{t('ui.causal_stat_downstream')}</span>
          </div>
          <div className="stat">
            <span className="stat-v">{data.impact.toFixed(1)}</span>
            <span className="stat-k">{t('ui.causal_stat_impact')}</span>
          </div>
        </div>
        <div className="row gap">
          <button className="btn sm" onClick={() => seek(e.t)}>
            {t('ui.causal_seek')}
          </button>
        </div>
        {e.randomDraws && e.randomDraws.length > 0 && (
          <div className="note small">
            {t('ui.causal_draws', { draws: e.randomDraws.map((d) => `${d.key} = ${d.value.toFixed(3)}`).join(' · ') })}
          </div>
        )}
      </div>

      {intervention && (
        <div className="verified">
          <Badge tone="ok">{t('ui.causal_verified')}</Badge>
          {intervention.chain ? (
            <ol className="stepper">
              {intervention.chain.map((x, i) => (
                <li key={x.id} className={x.id === e.id ? 'current' : ''}>
                  <span className="step-dot" />
                  <button className="step-body" onClick={() => selectEvent(x.id)} title={t('ui.causal_step_title')}>
                    <span className="mono t">{fmtTime(x.t)}</span>
                    <span className="step-label">{x.label}</span>
                    {x.mechanism && i > 0 && <span className="step-mech">{x.mechanism}</span>}
                  </button>
                </li>
              ))}
            </ol>
          ) : (
            <div className="muted small">{t('ui.causal_chain_ancestors')}</div>
          )}
        </div>
      )}
      {realityB && !isB && <div className="note small">{t('ui.causal_switch_to_b')}</div>}

      <Section title={t('ui.causal_why')} count={data.causes.length}>
        {data.causes.length ? (
          <ul className="tree">
            {data.causes.map((c) => (
              <CauseNode key={c.id} e={c} graph={graph} depth={1} />
            ))}
          </ul>
        ) : (
          <Empty>{t('ui.causal_root_event')}</Empty>
        )}
        {data.roots.length > 0 && (
          <div className="roots">
            <div className="sub-title">{t('ui.causal_roots')}</div>
            {data.roots.slice(0, 12).map((r) => (
              <EventRow key={r.id} e={r} onClick={() => selectEvent(r.id)} extra={r.randomDraws?.length ? <Badge tone="muted">{t('ui.causal_random')}</Badge> : undefined} />
            ))}
          </div>
        )}
      </Section>

      <Section title={t('ui.causal_consequences')} count={data.total}>
        <div className="sub-title">{t('ui.causal_direct')}</div>
        {data.direct.length ? data.direct.map((x) => <EventRow key={x.id} e={x} onClick={() => selectEvent(x.id)} sub={x.mechanism} extra={<SeekBtn at={x.t} />} />) : <Empty>{t('ui.causal_direct_none')}</Empty>}
        <div className="row gap center sub-title-row">
          <div className="sub-title">{t('ui.causal_indirect')}</div>
          <label className="check small">
            <input type="checkbox" checked={withDecisions} onChange={(ev) => setWithDecisions(ev.target.checked)} /> {t('ui.causal_include_decisions')}
          </label>
        </div>
        {indirect.groups.length ? (
          indirect.groups.map((g) => (
            <div key={g.depth} className="depth-group">
              <div className="depth-label">
                <Badge tone="b">{t('ui.causal_depth', { n: g.depth })}</Badge>
              </div>
              {g.events.map((x) => (
                <EventRow key={x.id} e={x} onClick={() => selectEvent(x.id)} extra={<SeekBtn at={x.t} />} />
              ))}
            </div>
          ))
        ) : (
          <Empty>{t('ui.causal_indirect_none')}</Empty>
        )}
        {data.total - data.direct.length > indirect.shown && <div className="muted small">{t('ui.causal_limit', { n: MAX_INDIRECT })}</div>}
      </Section>
    </div>
  );
}

function SeekBtn({ at }: { at: number }) {
  useLocale();
  return (
    <button className="icon-btn xs" onClick={() => useSimStore.getState().seek(at)} title={t('ui.causal_seek_at_title', { time: fmtTime(at) })}>
      ⏱
    </button>
  );
}

function CauseNode({ e, graph, depth }: { e: SimEvent; graph: CausalGraph; depth: number }) {
  useLocale();
  const [open, setOpen] = useState(false);
  const { selectEvent } = useSimStore.getState();
  const children = open ? graph.directCauses(e.id) : [];
  const hasChildren = e.causes.length > 0;
  return (
    <li className="tree-node">
      <div className="tree-row">
        <button className={`tree-toggle ${hasChildren ? '' : 'leaf'}`} onClick={() => hasChildren && setOpen(!open)} disabled={!hasChildren} aria-expanded={open} title={hasChildren ? (open ? t('ui.common_collapse') : t('ui.causal_expand_causes')) : t('ui.causal_root_cause')}>
          {hasChildren ? (open ? '▾' : '▸') : '•'}
        </button>
        <button className="tree-main" onClick={() => selectEvent(e.id)} title={t('ui.causal_inspect_event')}>
          <span className="mono t">{fmtTime(e.t)}</span>
          <FamilyDot e={e} />
          <span className="tree-text">
            <span>{e.label}</span>
            {e.mechanism && <span className="tree-mech">{e.mechanism}</span>}
          </span>
        </button>
        <span className="tree-badges">
          {e.randomDraws?.length ? (
            <Badge tone="muted" title={e.randomDraws.map((d) => `${d.key} = ${d.value.toFixed(3)}`).join('\n')}>
              {t('ui.causal_random_badge')}
            </Badge>
          ) : null}
          <Badge tone="b">d{depth}</Badge>
        </span>
      </div>
      {open && children.length > 0 && (
        <ul className="tree">
          {children.map((c) => (
            <CauseNode key={c.id} e={c} graph={graph} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}
