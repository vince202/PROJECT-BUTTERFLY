/**
 * Comparison of reality A (original) and reality B (modified).
 */

import { useMemo, useState } from 'react';
import { useSimStore } from '../../store/useSimStore';
import { agentPositionsAt, type ArcChange, type EventMatch } from '../../sim/compare';
import { ARC_STATUS_LABELS } from '../../sim/drama';
import { profileOf } from '../../sim/population';
import { fmtTime } from '../../sim/time';
import type { SimEvent } from '../../sim/types';
import { t } from '../../i18n';
import { AgentDot, Badge, Empty, FamilyDot, Section, fill } from '../common';
import { firstName, locName, moodColor, signed } from '../format';
import { ARC_STATUS_TONE } from '../drama';
import { useGoToEvent, useLocale, useMinute } from '../hooks';

export function ComparePanel() {
  useLocale();
  const comparison = useSimStore((s) => s.comparison);
  const realityA = useSimStore((s) => s.realityA);
  const realityB = useSimStore((s) => s.realityB);
  const activeId = useSimStore((s) => s.activeRealityId);
  const minute = useMinute();
  const { selectAgent, switchReality, setPanel } = useSimStore.getState();
  const go = useGoToEvent();
  const [onlyAffected, setOnlyAffected] = useState(false);

  const positions = useMemo(() => (realityB ? agentPositionsAt(realityA, realityB, minute).filter((p) => p.differs) : []), [realityA, realityB, minute]);
  const unverified = useMemo(() => (comparison ? comparison.matches.filter((m) => m.status !== 'same' && m.causal !== 'verified' && !['decision', 'bus_depart', 'bus_arrive', 'activity_start', 'activity_end', 'depart', 'arrive', 'wake', 'purchase'].includes((m.a ?? m.b)!.type)) : []), [comparison]);

  if (!comparison || !realityB) {
    return (
      <Empty>
        {t('ui.compare_none')}{' '}
        <button className="link" onClick={() => setPanel('butterfly')}>
          {t('ui.compare_create_iv')}
        </button>
      </Empty>
    );
  }

  const openMatch = (m: EventMatch) => {
    if (m.b) go(m.b, { reality: 'B', seek: true });
    else if (m.a) go(m.a, { reality: 'A', seek: true });
  };
  const affected = new Set(comparison.affectedAgents);
  const diffs = onlyAffected ? comparison.agentDiffs.filter((d) => affected.has(d.agentId)) : comparison.agentDiffs;

  return (
    <div className="compare">
      <div className="iv-head">
        {realityB.def.interventions.map((iv, i) => (
          <div key={iv.id} className="iv-card">
            <span className="iv-n mono">{i + 1}</span>
            <span>
              <span className="mono muted small">{fmtTime(iv.t)}</span> {iv.description}
            </span>
          </div>
        ))}
      </div>

      <ul className="summary">
        {comparison.summary.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ul>

      <div className="stats compare-stats">
        <Stat v={comparison.same} k={t('ui.compare_stat_same')} />
        <Stat v={comparison.shifted.length} k={t('ui.compare_stat_shifted')} tone="accent" />
        <Stat v={comparison.onlyA.length} k={t('ui.compare_stat_only_a')} tone="a" />
        <Stat v={comparison.onlyB.length} k={t('ui.compare_stat_only_b')} tone="b" />
        <Stat v={comparison.consequences.length} k={t('ui.compare_stat_consequences')} tone="ok" />
        <Stat v={comparison.affectedAgents.length} k={t('ui.compare_stat_affected')} tone="danger" />
        <Stat v={comparison.arcChanges.length} k={t('ui.compare_stat_destinies')} tone="warn" />
      </div>

      <div className="two-cards">
        <MatchCard title={t('ui.compare_first_divergence')} m={comparison.firstDivergence} onOpen={openMatch} tone="div" />
        <MatchCard title={t('ui.compare_first_consequence')} m={comparison.firstConsequence} onOpen={openMatch} tone="ok" />
      </div>

      <Section title={t('ui.compare_destinies')} count={comparison.arcChanges.length} className="destinies">
        {comparison.arcChanges.length ? (
          <ul className="destiny-list">
            {comparison.arcChanges.map((c) => (
              <DestinyRow key={c.arcId} c={c} onOpen={() => (c.eventB ? go(c.eventB, { reality: 'B', seek: true }) : c.eventA ? go(c.eventA, { reality: 'A', seek: true }) : selectAgent(c.agentId))} />
            ))}
          </ul>
        ) : (
          <Empty>{t('ui.compare_destinies_none')}</Empty>
        )}
      </Section>

      <Section title={t('ui.compare_divergence')} count={comparison.consequences.length}>
        {comparison.consequences.length ? (
          <ol className="divergence">
            {comparison.consequences.map((m, i) => (
              <MatchRow key={i} m={m} onOpen={openMatch} />
            ))}
          </ol>
        ) : (
          <Empty>{t('ui.compare_divergence_none')}</Empty>
        )}
      </Section>

      <Section title={t('ui.compare_unverified')} count={unverified.length} defaultOpen={false}>
        <p className="muted small">{t('ui.compare_unverified_note')}</p>
        {unverified.length ? (
          <ol className="divergence">
            {unverified.slice(0, 80).map((m, i) => (
              <MatchRow key={i} m={m} onOpen={openMatch} />
            ))}
          </ol>
        ) : (
          <Empty>{t('ui.compare_unverified_none')}</Empty>
        )}
      </Section>

      <Section
        title={t('ui.compare_now')}
        count={positions.length}
        right={
          <button className="btn xs" onClick={() => switchReality(activeId === 'A' ? 'B' : 'A')} title={t('ui.compare_switch_title')}>
            {activeId === 'A' ? t('ui.compare_view_b') : t('ui.compare_view_a')}
          </button>
        }
      >
        <div className="muted small">
          {fill(t('ui.compare_now_differs'), { time: <span className="mono">{fmtTime(minute)}</span> })}
        </div>
        {positions.length ? (
          <table className="table">
            <thead>
              <tr>
                <th>{t('ui.compare_col_agent')}</th>
                <th className="col-a">{t('ui.reality_a_short')}</th>
                <th className="col-b">{t('ui.reality_b_short')}</th>
              </tr>
            </thead>
            <tbody>
              {positions.map((p) => (
                <tr key={p.agentId} onClick={() => selectAgent(p.agentId)} className="clickable">
                  <td>
                    <AgentDot id={p.agentId} /> {firstName(p.agentId)}
                  </td>
                  <td>
                    {p.actA}
                    <div className="muted small">{locName(p.locA)}</div>
                  </td>
                  <td>
                    {p.actB}
                    <div className="muted small">{locName(p.locB)}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Empty>{t('ui.compare_positions_none')}</Empty>
        )}
      </Section>

      <Section
        title={t('ui.compare_summary')}
        count={diffs.length}
        right={
          <label className="check small">
            <input type="checkbox" checked={onlyAffected} onChange={(e) => setOnlyAffected(e.target.checked)} /> {t('ui.compare_only_affected')}
          </label>
        }
      >
        <div className="table-wrap">
          <table className="table agents-table">
            <thead>
              <tr>
                <th>{t('ui.compare_col_agent')}</th>
                <th>{t('ui.compare_col_place')}</th>
                <th>{t('ui.compare_col_activity')}</th>
                <th>{t('ui.compare_col_mood')}</th>
                <th title={t('ui.compare_col_goals_title')}>{t('ui.compare_col_goals')}</th>
                <th title={t('ui.compare_col_rels_title')}>{t('ui.compare_col_rels')}</th>
                <th title={t('ui.compare_col_affected_title')}>{t('ui.compare_col_affected')}</th>
              </tr>
            </thead>
            <tbody>
              {diffs.map((d) => {
                const isAff = affected.has(d.agentId);
                const locDiff = d.locationA !== d.locationB;
                const actDiff = d.activityA !== d.activityB;
                return (
                  <tr key={d.agentId} className={`clickable ${isAff ? 'affected' : ''}`} onClick={() => selectAgent(d.agentId)} title={t('ui.compare_row_title', { name: profileOf(d.agentId).name })}>
                    <td>
                      <AgentDot id={d.agentId} /> {firstName(d.agentId)}
                    </td>
                    <td className={locDiff ? 'diff' : ''}>
                      {locName(d.locationA)}
                      {locDiff && <div className="b-val">{locName(d.locationB)}</div>}
                    </td>
                    <td className={actDiff ? 'diff' : ''}>
                      {d.activityA}
                      {actDiff && <div className="b-val">{d.activityB}</div>}
                    </td>
                    <td className="mono nowrap">
                      <span style={{ color: moodColor(d.moodA) }}>{d.moodA.toFixed(2)}</span>
                      {Math.abs(d.moodA - d.moodB) >= 0.01 && (
                        <>
                          {' → '}
                          <span style={{ color: moodColor(d.moodB) }}>{d.moodB.toFixed(2)}</span>
                        </>
                      )}
                    </td>
                    <td className={`mono ${d.objectivesA !== d.objectivesB ? 'diff' : ''}`}>
                      {d.objectivesA}/{d.objectivesB}
                    </td>
                    <td className="mono" title={d.relationshipChanges.map((r) => t('ui.compare_rel_change', { name: firstName(r.other), a: signed(r.a), b: signed(r.b) })).join('\n')}>
                      {d.relationshipChanges.length || '—'}
                    </td>
                    <td className="mono">{d.affectedEvents ? <Badge tone="danger">{d.affectedEvents}</Badge> : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}

function Stat({ v, k, tone }: { v: number; k: string; tone?: string }) {
  return (
    <div className={`stat ${tone ? `tone-${tone}` : ''}`}>
      <span className="stat-v">{v}</span>
      <span className="stat-k">{k}</span>
    </div>
  );
}

function DestinyRow({ c, onOpen }: { c: ArcChange; onOpen: () => void }) {
  useLocale();
  const e = c.eventB ?? c.eventA;
  const where = c.eventB ? 'B' : c.eventA ? 'A' : null;
  return (
    <li className="destiny">
      <button className="destiny-main" onClick={onOpen} title={where ? (e ? t('ui.compare_destiny_view_at', { reality: where, time: fmtTime(e.t) }) : t('ui.compare_destiny_view', { reality: where })) : t('ui.compare_destiny_open', { name: firstName(c.agentId) })}>
        <AgentDot id={c.agentId} />
        <span className="destiny-text">
          <span>
            <span className="strong">{firstName(c.agentId)}</span> <span className="muted">— {t('ui.quote', { text: c.title })}</span>
          </span>
          {e && <span className="destiny-sub">{fmtTime(e.t)} · {e.label}</span>}
        </span>
      </button>
      <span className="destiny-badges">
        <Badge tone={ARC_STATUS_TONE[c.statusA]} title={t('ui.compare_outcome_a_title')}>{t('ui.compare_outcome_a', { status: ARC_STATUS_LABELS[c.statusA] })}</Badge>
        <span className="muted" aria-hidden>→</span>
        <Badge tone={ARC_STATUS_TONE[c.statusB]} title={t('ui.compare_outcome_b_title')}>{t('ui.compare_outcome_b', { status: ARC_STATUS_LABELS[c.statusB] })}</Badge>
        {c.verified ? (
          <Badge tone="ok" title={t('ui.compare_verified_title')}>{t('ui.compare_verified')}</Badge>
        ) : (
          <Badge tone="muted" title={t('ui.compare_unproven_title')}>{t('ui.compare_unproven')}</Badge>
        )}
      </span>
    </li>
  );
}

function statusBadge(m: EventMatch) {
  if (m.status === 'only_b') return <Badge tone="b">{t('ui.compare_b_only')}</Badge>;
  if (m.status === 'only_a') return <Badge tone="a">{t('ui.compare_a_only')}</Badge>;
  if (m.status === 'shifted') return m.dt ? <Badge tone="accent">{t('ui.compare_shifted', { dt: `${m.dt > 0 ? '+' : ''}${m.dt}` })}</Badge> : <Badge tone="accent">{t('ui.compare_modified')}</Badge>;
  return <Badge>{t('ui.compare_same')}</Badge>;
}

function causalBadge(m: EventMatch) {
  if (m.causal === 'verified') return <Badge tone="ok">{t('ui.compare_verified')}</Badge>;
  if (m.causal === 'probable') return <Badge tone="warn">{t('ui.compare_probable')}</Badge>;
  return <Badge tone="muted">{t('ui.compare_unproven')}</Badge>;
}

function MatchRow({ m, onOpen }: { m: EventMatch; onOpen: (m: EventMatch) => void }) {
  useLocale();
  const e = (m.b ?? m.a)! as SimEvent;
  return (
    <li className={`match ${m.status}`}>
      <button className="match-main" onClick={() => onOpen(m)} title={t('ui.compare_match_title')}>
        <span className="mono t">
          {fmtTime(e.t)}
          {m.status === 'shifted' && m.a && <span className="t-was">({fmtTime(m.a.t)})</span>}
        </span>
        <FamilyDot e={e} />
        <span className={`match-label ${m.status === 'only_a' ? 'struck' : ''}`}>{e.label}</span>
      </button>
      <span className="match-badges">
        {statusBadge(m)}
        {causalBadge(m)}
      </span>
    </li>
  );
}

function MatchCard({ title, m, onOpen, tone }: { title: string; m: EventMatch | null; onOpen: (m: EventMatch) => void; tone: string }) {
  useLocale();
  const e = m ? (m.b ?? m.a)! : null;
  return (
    <div className={`match-card tone-${tone}`}>
      <div className="match-card-title">{title}</div>
      {m && e ? (
        <button className="match-card-body" onClick={() => onOpen(m)} title={t('ui.compare_match_card_title')}>
          <span className="mono strong">{fmtTime(e.t)}</span>
          <span>{e.label}</span>
          <span className="match-badges">{statusBadge(m)}</span>
        </button>
      ) : (
        <div className="muted small">{t('ui.compare_no_match')}</div>
      )}
    </div>
  );
}
