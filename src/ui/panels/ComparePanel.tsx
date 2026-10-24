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
import { AgentDot, Badge, Empty, FamilyDot, Section } from '../common';
import { firstName, locName, moodColor, signed } from '../format';
import { ARC_STATUS_TONE } from '../drama';
import { useGoToEvent, useMinute } from '../hooks';

export function ComparePanel() {
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
        Aucune réalité B pour l’instant.{' '}
        <button className="link" onClick={() => setPanel('butterfly')}>
          Créer une intervention
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
        <Stat v={comparison.same} k="identiques" />
        <Stat v={comparison.shifted.length} k="décalés" tone="accent" />
        <Stat v={comparison.onlyA.length} k="seulement A" tone="a" />
        <Stat v={comparison.onlyB.length} k="seulement B" tone="b" />
        <Stat v={comparison.consequences.length} k="conséquences vérifiées" tone="ok" />
        <Stat v={comparison.affectedAgents.length} k="habitants touchés" tone="danger" />
        <Stat v={comparison.arcChanges.length} k="destins modifiés" tone="warn" />
      </div>

      <div className="two-cards">
        <MatchCard title="Première divergence" m={comparison.firstDivergence} onOpen={openMatch} tone="div" />
        <MatchCard title="Première conséquence" m={comparison.firstConsequence} onOpen={openMatch} tone="ok" />
      </div>

      <Section title="Destins modifiés" count={comparison.arcChanges.length} className="destinies">
        {comparison.arcChanges.length ? (
          <ul className="destiny-list">
            {comparison.arcChanges.map((c) => (
              <DestinyRow key={c.arcId} c={c} onOpen={() => (c.eventB ? go(c.eventB, { reality: 'B', seek: true }) : c.eventA ? go(c.eventA, { reality: 'A', seek: true }) : selectAgent(c.agentId))} />
            ))}
          </ul>
        ) : (
          <Empty>Aucun destin modifié : chaque histoire du jour a la même issue dans les deux réalités.</Empty>
        )}
      </Section>

      <Section title="Chronologie de la divergence" count={comparison.consequences.length}>
        {comparison.consequences.length ? (
          <ol className="divergence">
            {comparison.consequences.map((m, i) => (
              <MatchRow key={i} m={m} onOpen={openMatch} />
            ))}
          </ol>
        ) : (
          <Empty>Aucune conséquence vérifiée : l’intervention n’a pas modifié le cours de la journée.</Empty>
        )}
      </Section>

      <Section title="Différences observées sans lien causal prouvé" count={unverified.length} defaultOpen={false}>
        <p className="muted small">Ces écarts existent entre A et B mais le graphe causal ne les relie pas à l’intervention. « Probable » : un acteur avait déjà été touché auparavant.</p>
        {unverified.length ? (
          <ol className="divergence">
            {unverified.slice(0, 80).map((m, i) => (
              <MatchRow key={i} m={m} onOpen={openMatch} />
            ))}
          </ol>
        ) : (
          <Empty>Aucune.</Empty>
        )}
      </Section>

      <Section
        title="À cet instant"
        count={positions.length}
        right={
          <button className="btn xs" onClick={() => switchReality(activeId === 'A' ? 'B' : 'A')} title="Changer de réalité en gardant la même heure">
            Voir la réalité {activeId === 'A' ? 'B' : 'A'}
          </button>
        }
      >
        <div className="muted small">
          À <span className="mono">{fmtTime(minute)}</span>, habitants dont le lieu ou l’activité diffère :
        </div>
        {positions.length ? (
          <table className="table">
            <thead>
              <tr>
                <th>Habitant</th>
                <th className="col-a">Réalité A</th>
                <th className="col-b">Réalité B</th>
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
          <Empty>À cette heure, tout le monde est au même endroit dans les deux réalités.</Empty>
        )}
      </Section>

      <Section
        title="Bilan par habitant (fin de journée)"
        count={diffs.length}
        right={
          <label className="check small">
            <input type="checkbox" checked={onlyAffected} onChange={(e) => setOnlyAffected(e.target.checked)} /> touchés seulement
          </label>
        }
      >
        <div className="table-wrap">
          <table className="table agents-table">
            <thead>
              <tr>
                <th>Habitant</th>
                <th>Lieu A / B</th>
                <th>Activité A / B</th>
                <th>Humeur</th>
                <th title="Objectifs accomplis">Obj.</th>
                <th title="Relations modifiées">Rel.</th>
                <th title="Événements touchés de façon vérifiée">Touchés</th>
              </tr>
            </thead>
            <tbody>
              {diffs.map((d) => {
                const isAff = affected.has(d.agentId);
                const locDiff = d.locationA !== d.locationB;
                const actDiff = d.activityA !== d.activityB;
                return (
                  <tr key={d.agentId} className={`clickable ${isAff ? 'affected' : ''}`} onClick={() => selectAgent(d.agentId)} title={`${profileOf(d.agentId).name} — cliquer pour ouvrir la fiche`}>
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
                    <td className="mono" title={d.relationshipChanges.map((r) => `${firstName(r.other)} : ${signed(r.a)} → ${signed(r.b)}`).join('\n')}>
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
  const e = c.eventB ?? c.eventA;
  const where = c.eventB ? 'B' : c.eventA ? 'A' : null;
  return (
    <li className="destiny">
      <button className="destiny-main" onClick={onOpen} title={where ? `Voir le point de bascule dans la réalité ${where}${e ? ` (${fmtTime(e.t)})` : ''}` : `Ouvrir la fiche de ${firstName(c.agentId)}`}>
        <AgentDot id={c.agentId} />
        <span className="destiny-text">
          <span>
            <span className="strong">{firstName(c.agentId)}</span> <span className="muted">— « {c.title} »</span>
          </span>
          {e && <span className="destiny-sub">{fmtTime(e.t)} · {e.label}</span>}
        </span>
      </button>
      <span className="destiny-badges">
        <Badge tone={ARC_STATUS_TONE[c.statusA]} title="Issue dans la réalité A">A · {ARC_STATUS_LABELS[c.statusA]}</Badge>
        <span className="muted" aria-hidden>→</span>
        <Badge tone={ARC_STATUS_TONE[c.statusB]} title="Issue dans la réalité B">B · {ARC_STATUS_LABELS[c.statusB]}</Badge>
        {c.verified ? (
          <Badge tone="ok" title="Le point de bascule en B descend causalement de l’intervention">vérifié</Badge>
        ) : (
          <Badge tone="muted" title="Issue différente, mais le graphe causal ne la relie pas à l’intervention">sans lien prouvé</Badge>
        )}
      </span>
    </li>
  );
}

function statusBadge(m: EventMatch) {
  if (m.status === 'only_b') return <Badge tone="b">B seulement</Badge>;
  if (m.status === 'only_a') return <Badge tone="a">n’a pas eu lieu (A seulement)</Badge>;
  if (m.status === 'shifted') return m.dt ? <Badge tone="accent">décalé {m.dt > 0 ? '+' : ''}{m.dt} min</Badge> : <Badge tone="accent">modifié</Badge>;
  return <Badge>identique</Badge>;
}

function causalBadge(m: EventMatch) {
  if (m.causal === 'verified') return <Badge tone="ok">vérifié</Badge>;
  if (m.causal === 'probable') return <Badge tone="warn">probable</Badge>;
  return <Badge tone="muted">sans lien prouvé</Badge>;
}

function MatchRow({ m, onOpen }: { m: EventMatch; onOpen: (m: EventMatch) => void }) {
  const e = (m.b ?? m.a)! as SimEvent;
  return (
    <li className={`match ${m.status}`}>
      <button className="match-main" onClick={() => onOpen(m)} title="Voir cet événement (bascule vers la bonne réalité)">
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
  const e = m ? (m.b ?? m.a)! : null;
  return (
    <div className={`match-card tone-${tone}`}>
      <div className="match-card-title">{title}</div>
      {m && e ? (
        <button className="match-card-body" onClick={() => onOpen(m)} title="Voir cet événement">
          <span className="mono strong">{fmtTime(e.t)}</span>
          <span>{e.label}</span>
          <span className="match-badges">{statusBadge(m)}</span>
        </button>
      ) : (
        <div className="muted small">Aucune</div>
      )}
    </div>
  );
}
