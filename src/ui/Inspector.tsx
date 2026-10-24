/**
 * Right column: event card, character panel ("Pourquoi fait-il cela ?") or a
 * welcome card explaining the laboratory.
 */

import { useDeferredValue, useMemo, useState } from 'react';
import { useSimStore } from '../store/useSimStore';
import { profileOf } from '../sim/population';
import { agentSummary, arcSummary } from '../sim/narrative';
import { ARC_STATUS_LABELS, arcOf, arcSeed } from '../sim/drama';
import { LexicalEmbedder, presentNames, recallMemoriesSync, situationQuery } from '../sim/recall';
import { aiNarrate } from '../ai/client';
import { busDelayFor, validateIntervention } from '../sim/interventions';
import { fmtTime } from '../sim/time';
import type { AgentId, AgentState, Candidate, SimEvent, TraitName, WorldState } from '../sim/types';
import type { Reality } from '../sim/reality';
import { AgentChip, AiButton, Badge, Bar, Empty, EventRow, KV, NarrationBox, Section, SignedBar } from './common';
import { ARC_STATUS_TONE, DIALOGUE_TYPES, PROFILES, STAKES_WORDS, attemptLabel, dialogueFacts, stakesLevel } from './drama';
import {
  COMMITMENT_STATUS,
  NEED_LABELS,
  RELATIONSHIP_LABELS,
  TRAIT_LABELS,
  TRAVEL_STAGE_LABELS,
  eventFamily,
  eventTypeLabel,
  firstName,
  locName,
  moodColor,
  moodWord,
  signed,
  stressWord,
} from './format';
import { cachedStateAt, useActiveReality, useGoToEvent, useMinute, useWorldState } from './hooks';

/** Offline embedder for the « Souvenirs liés à la situation » preview (vectors cached by text). */
const LEXICAL = new LexicalEmbedder();

export function Inspector() {
  const selectedEventId = useSimStore((s) => s.selectedEventId);
  const selectedAgentId = useSimStore((s) => s.selectedAgentId);
  return (
    <div className="inspector">
      {selectedEventId ? <EventCard key={selectedEventId} id={selectedEventId} /> : selectedAgentId ? <CharacterPanel key={selectedAgentId} id={selectedAgentId} /> : <Welcome />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Event card
// ---------------------------------------------------------------------------

function EventCard({ id }: { id: string }) {
  const reality = useActiveReality();
  const generation = useSimStore((s) => s.generation);
  const selectedAgentId = useSimStore((s) => s.selectedAgentId);
  const panel = useSimStore((s) => s.panel);
  const ai = useSimStore((s) => s.ai);
  const { selectEvent, seek, setPanel, createRealityB } = useSimStore.getState();
  const [error, setError] = useState<string | null>(null);
  const [scene, setScene] = useState<{ busy: boolean; text?: string; error?: string }>({ busy: false });
  const e = reality.eventById(id);
  const graph = reality.causal;
  const causes = useMemo(() => (e ? graph.directCauses(e.id) : []), [graph, e, generation]);
  const effects = useMemo(() => (e ? graph.directEffects(e.id).sort((a, b) => a.t - b.t) : []), [graph, e, generation]);

  if (!e) {
    return (
      <div className="card">
        <Empty>Cet événement n’existe pas dans {reality.def.name}.</Empty>
        <button className="btn sm" onClick={() => selectEvent(null)}>
          Fermer
        </button>
      </div>
    );
  }

  const stageDialogue = async () => {
    setScene({ busy: true });
    try {
      const res = await aiNarrate(dialogueFacts(e, cachedStateAt(reality, e.t)), 'dialogue');
      setScene(res.ok && res.text ? { busy: false, text: res.text } : { busy: false, error: 'Le modèle n’a pas pu écrire la scène.' });
    } catch {
      setScene({ busy: false, error: 'Service IA injoignable.' });
    }
  };
  const canStage = DIALOGUE_TYPES.has(e.type) && e.actors.length >= 2;

  const delayBus = () => {
    const iv = busDelayFor(e, 3);
    const errs = validateIntervention(iv);
    if (errs.length) return setError(errs.join(' '));
    setError(null);
    createRealityB(iv);
  };

  return (
    <div className="card event-card">
      <div className="card-nav">
        {selectedAgentId ? (
          <button className="link" onClick={() => selectEvent(null)} title="Revenir à la fiche de l’habitant">
            ← {firstName(selectedAgentId)}
          </button>
        ) : (
          <span className="muted small">Événement</span>
        )}
        <button className="icon-btn sm" onClick={() => selectEvent(null)} title="Fermer l’événement">
          ✕
        </button>
      </div>
      <div className="event-head">
        <span className={`fam-pill fam-${eventFamily(e.type)}`}>{eventTypeLabel(e.type)}</span>
        <span className="event-time mono">{fmtTime(e.t)}</span>
        {e.interventionId && <Badge tone="white">intervention</Badge>}
      </div>
      <h2 className="event-title">{e.label}</h2>
      {e.description && <p className="event-desc">{e.description}</p>}

      <div className="kv-grid">
        {e.actors.length > 0 && (
          <KV k="Acteurs">
            <span className="chips">
              {e.actors.map((a) => (
                <AgentChip key={a} id={a} />
              ))}
            </span>
          </KV>
        )}
        {e.locationId && <KV k="Lieu">{locName(e.locationId)}</KV>}
        {e.busId && <KV k="Bus">{e.busId}</KV>}
        {e.mechanism && <KV k="Mécanisme">{e.mechanism}</KV>}
        <KV k="Importance">
          <Bar value={e.importance} tone="accent" right={e.importance.toFixed(2)} />
        </KV>
      </div>

      <div className="btn-col">
        <button
          className="btn primary"
          onClick={() => {
            if (panel !== 'causal') setPanel('causal');
          }}
          title="Ouvrir l’explorateur causal sur cet événement"
        >
          ⛓ Pourquoi cet événement s’est-il produit ?
        </button>
        <div className="row gap">
          <button className="btn sm" onClick={() => seek(e.t)} title="Placer l’horloge à l’heure de l’événement">
            ⏱ Aller à cet instant
          </button>
          {e.type === 'bus_arrive' && e.busId && (
            <button className="btn sm accent" onClick={delayBus} title="Créer une réalité B où ce bus arrive avec 3 minutes de retard">
              🦋 Retarder ce bus de 3 min
            </button>
          )}
        </div>
        {canStage && (
          <div className="row gap wrap">
            <AiButton
              enabled={ai.enabled}
              busy={scene.busy}
              onClick={stageDialogue}
              title="Scène dialoguée imaginée par le modèle, limitée aux faits enregistrés (événement, relation, désirs du jour, souvenirs de chacun)"
              disabledTitle={`Narration IA indisponible${ai.message ? ` — ${ai.message}` : ''}`}
            >
              🎭 {scene.busy ? 'Mise en scène…' : 'Mettre en scène (dialogue)'}
            </AiButton>
          </div>
        )}
        {error && <div className="error">{error}</div>}
      </div>
      <NarrationBox label="Scène dialoguée" {...scene} />

      <Section title="Causes directes" count={causes.length}>
        {causes.length ? causes.map((c) => <EventRow key={c.id} e={c} onClick={() => selectEvent(c.id)} sub={c.mechanism} />) : <Empty>Aucune cause enregistrée : événement racine (routine, horaire ou hasard).</Empty>}
      </Section>
      <Section title="Effets directs" count={effects.length}>
        {effects.length ? effects.slice(0, 30).map((c) => <EventRow key={c.id} e={c} onClick={() => selectEvent(c.id)} sub={c.mechanism} />) : <Empty>Aucun effet direct enregistré.</Empty>}
        {effects.length > 30 && <div className="muted small">… et {effects.length - 30} autres</div>}
      </Section>
      {e.randomDraws && e.randomDraws.length > 0 && (
        <Section title="Tirages aléatoires (graine)" count={e.randomDraws.length} defaultOpen={false}>
          {e.randomDraws.map((d) => (
            <KV key={d.key} k={<span className="mono small">{d.key}</span>}>
              <span className="mono">{d.value.toFixed(3)}</span>
            </KV>
          ))}
        </Section>
      )}
      {e.effects.length > 0 && (
        <Section title="Changements d’état" count={e.effects.length} defaultOpen={false}>
          <ul className="plain small">
            {e.effects.map((f, i) => (
              <li key={i}>
                <span className="muted">{f.kind}</span> {f.agentId && firstName(f.agentId)}
                {f.otherId && ` → ${firstName(f.otherId)}`} {f.field && <span className="mono">{f.field}</span>}{' '}
                {f.delta !== undefined && <span className={f.delta >= 0 ? 'pos' : 'neg'}>{signed(f.delta)}</span>} {f.value !== undefined && <span className="mono">{String(f.value)}</span>}
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Character panel
// ---------------------------------------------------------------------------

function CharacterPanel({ id }: { id: string }) {
  const reality = useActiveReality();
  const liveMinute = useMinute();
  const minute = useDeferredValue(liveMinute);
  const state = useWorldState(reality, minute);
  const followId = useSimStore((s) => s.followAgentId);
  const generation = useSimStore((s) => s.generation);
  const lab = useSimStore((s) => s.uiMode === 'lab');
  const { selectAgent, followAgent, selectEvent } = useSimStore.getState();
  const [showSummary, setShowSummary] = useState(false);
  const [allRels, setAllRels] = useState(false);
  const p = profileOf(id);
  const a = state.agents[id];

  const agentEvents = useMemo(() => reality.eventsOf(id), [reality, id, generation]);
  const decisions = useMemo(() => agentEvents.filter((e) => (e.type === 'decision' || e.type === 'plan_change') && e.t <= minute).slice(-6).reverse(), [agentEvents, minute]);
  const summary = useMemo(() => (showSummary ? agentSummary(reality, id) : null), [showSummary, reality, id, generation]);

  if (!a) return <Empty>Habitant introuvable.</Empty>;

  const topTraits = (Object.entries(p.traits) as [TraitName, number][]).sort((x, y) => y[1] - x[1]).slice(0, 4);
  const rels = Object.values(a.relationships).sort((x, y) => Math.abs(y.affinity) - Math.abs(x.affinity));
  const memories = a.memories.filter((m) => m.t <= minute).slice(-8).reverse();
  const followed = followId === id;

  return (
    <div className="card character" style={{ ['--agent' as string]: p.color }}>
      <div className="char-head">
        <span className="avatar" style={{ background: p.color }} aria-hidden>
          {p.firstName[0]}
        </span>
        <div className="char-id">
          <h2>{p.name}</h2>
          <div className="muted">
            {p.age} ans · {p.occupation}
          </div>
        </div>
        <div className="char-actions">
          <button className={`icon-btn sm ${followed ? 'on' : ''}`} onClick={() => followAgent(followed ? null : id)} title={followed ? 'Ne plus suivre' : 'Suivre avec la caméra'} aria-pressed={followed}>
            👁
          </button>
          <button className="icon-btn sm" onClick={() => selectAgent(null)} title="Fermer la fiche">
            ✕
          </button>
        </div>
      </div>
      <p className="bio">{p.bio}</p>

      <NowBlock a={a} minute={minute} />

      <ArcSection reality={reality} state={state} id={id} minute={minute} lab={lab} />

      <WhyBlock a={a} reality={reality} />

      <div className="row gap wrap">
        <button className="btn sm" onClick={() => setShowSummary(!showSummary)} title="Résumé factuel de toute la journée de cet habitant">
          📜 {showSummary ? 'Masquer le résumé' : 'Résumé de la journée'}
        </button>
      </div>
      {summary && (
        <div className="summary-box">
          <div className="summary-headline">{summary.headline}</div>
          <p>{summary.paragraph}</p>
        </div>
      )}

      <Section title="Besoins">
        {(Object.keys(NEED_LABELS) as (keyof typeof NEED_LABELS)[]).map((k) => {
          const v = a.needs[k] / 100;
          return <Bar key={k} label={NEED_LABELS[k]} value={v} tone={v > 0.7 ? 'danger' : v > 0.45 ? 'warn' : 'ok'} right={Math.round(a.needs[k])} />;
        })}
      </Section>

      <Section title="Traits dominants">
        <div className="chips">
          {topTraits.map(([k, v]) => (
            <span key={k} className="pill" title={`${TRAIT_LABELS[k]} : ${Math.round(v * 100)} / 100`}>
              {TRAIT_LABELS[k]} <span className="mono muted">{Math.round(v * 100)}</span>
            </span>
          ))}
        </div>
      </Section>

      <Section title="Programme du jour" count={a.commitments.length}>
        {a.commitments.length ? (
          <ul className="schedule">
            {[...a.commitments]
              .sort((x, y) => x.start - y.start)
              .map((c) => {
                const st = COMMITMENT_STATUS[c.status];
                return (
                  <li key={c.id} className={`sched-item st-${c.status}`}>
                    <span className="mono t">
                      {fmtTime(c.start)}–{fmtTime(c.end)}
                    </span>
                    <span className="sched-label">
                      {c.label}
                      <span className="muted small">
                        {' '}
                        · {locName(c.locationId)}
                        {c.with.length ? ` · avec ${c.with.map(firstName).join(', ')}` : ''}
                        {c.lateBy ? ` · ${c.lateBy} min de retard` : ''}
                      </span>
                    </span>
                    <Badge tone={st.tone}>{st.label}</Badge>
                  </li>
                );
              })}
          </ul>
        ) : (
          <Empty>Aucun engagement aujourd’hui.</Empty>
        )}
      </Section>

      <Section title="Relations" count={rels.length}>
        {rels.slice(0, allRels ? rels.length : 8).map((r) => (
          <div key={r.to} className="rel-row">
            <AgentChip id={r.to} />
            <span className="rel-kind muted small">{RELATIONSHIP_LABELS[r.kind] ?? r.kind}</span>
            <SignedBar value={r.affinity} right={signed(r.affinity)} />
          </div>
        ))}
        {rels.length > 8 && (
          <button className="link small" onClick={() => setAllRels(!allRels)}>
            {allRels ? 'Réduire' : `Voir les ${rels.length} relations`}
          </button>
        )}
      </Section>

      <Section title="Souvenirs récents" count={memories.length}>
        {memories.length ? (
          <ul className="memories">
            {memories.map((m, i) => (
              <li key={`${m.eventId}-${i}`}>
                <button className="memory" onClick={() => selectEvent(m.eventId)} title="Voir l’événement à l’origine de ce souvenir">
                  <span className="mono t">{fmtTime(m.t)}</span>
                  <span className="valence" style={{ background: m.valence > 0.1 ? 'var(--ok)' : m.valence < -0.1 ? 'var(--danger)' : 'var(--muted)', opacity: 0.4 + m.importance * 0.6 }} />
                  <span>{m.text}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>Pas encore de souvenir marquant.</Empty>
        )}
      </Section>

      {lab && (
        <Section title="Souvenirs liés à la situation" className="recall">
          <SituationRecall a={a} state={state} minute={minute} />
        </Section>
      )}

      <Section title="Décisions récentes" count={decisions.length}>
        {decisions.length ? decisions.map((e) => <EventRow key={e.id} e={e} onClick={() => selectEvent(e.id)} sub={e.type === 'plan_change' ? e.mechanism : undefined} />) : <Empty>Aucune décision encore.</Empty>}
      </Section>

      <Section title="Objectifs de vie" count={p.goals.length} defaultOpen={false}>
        <ul className="plain">
          {p.goals.map((g) => (
            <li key={g}>◇ {g}</li>
          ))}
        </ul>
        <div className="muted small">Objectifs accomplis aujourd’hui : {a.objectivesDone}</div>
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// « Son histoire aujourd’hui » — the arc of the day at the displayed minute
// ---------------------------------------------------------------------------

const BAR_TONE: Record<string, string> = { muted: 'accent', accent: 'accent', ok: 'ok', danger: 'danger', warn: 'warn' };

function ArcSection({ reality, state, id, minute, lab }: { reality: Reality; state: WorldState; id: AgentId; minute: number; lab: boolean }) {
  const generation = useSimStore((s) => s.generation);
  const go = useGoToEvent();
  // Static facts (title, desire, tension, secret…) come from the day's summary;
  // status, progress and knowledge come from the world state at the displayed minute.
  const summary = useMemo(() => arcSummary(reality, id), [reality, id, generation]);
  const arc = arcOf(state, id);
  const beats = useMemo(() => (arc ? arc.beats.map((b) => reality.eventById(b)).filter((e): e is SimEvent => !!e && e.t <= minute) : []), [arc, reality, minute]);
  if (!summary || !arc) return null;
  const tone = ARC_STATUS_TONE[arc.status];
  const flames = stakesLevel(summary.stakes);
  const attempt = attemptLabel(arc.attempt);
  const late = minute >= summary.deadline && (arc.status === 'open' || arc.status === 'advancing');
  const secretAbout = summary.secret ? arcSeed(arc.seedId).secretAbout : undefined;
  return (
    <Section title="Son histoire aujourd’hui" className="arc-section" right={<Badge tone={tone}>{ARC_STATUS_LABELS[arc.status]}</Badge>}>
      <div className={`arc-card st-${arc.status}`}>
        <div className="arc-head">
          <span className="fam-pill fam-drama">{summary.kind}</span>
          {attempt && <Badge tone="warn" title="L’histoire a échoué la veille : elle est retentée, avec des enjeux plus élevés">{attempt}</Badge>}
          <span className="arc-stakes" title={`Enjeu ${STAKES_WORDS[flames]} (${Math.round(summary.stakes * 100)} / 100)`} aria-label={`Enjeu ${STAKES_WORDS[flames]}`}>
            {[1, 2, 3].map((i) => (
              <span key={i} className={`flame ${i <= flames ? 'on' : ''}`} aria-hidden>
                🔥
              </span>
            ))}
          </span>
        </div>
        <div className="arc-title">{summary.title}</div>
        <p className="arc-desire">{summary.desire}</p>
        <p className="arc-tension">
          <span className="arc-k">Tension</span> {summary.tension}
        </p>
        <div className="arc-meta">
          <span className={late ? 'neg' : ''} title="Heure à laquelle l’histoire se règle d’elle-même">
            Échéance <span className="mono">{fmtTime(summary.deadline)}</span>
          </span>
          <Bar value={arc.progress} tone={BAR_TONE[tone]} right={`${Math.round(arc.progress * 100)} %`} />
        </div>
        {lab && summary.secret && (
          <div className="arc-secret">
            <div className="arc-k">Secret (laboratoire)</div>
            <div>{summary.secret}</div>
            <div className="muted small">
              {secretAbout ? `caché à ${firstName(secretAbout)} · ` : ''}connu de : {arc.knownBy.length ? arc.knownBy.map(firstName).join(', ') : 'personne pour l’instant'}
            </div>
          </div>
        )}
      </div>
      {beats.length > 0 ? (
        <div className="arc-beats">
          <div className="sub-title">Temps forts jusqu’à {fmtTime(minute)}</div>
          {beats.map((e) => (
            <EventRow key={e.id} e={e} onClick={() => go(e, { seek: true })} active={e.id === arc.resolutionEventId} />
          ))}
        </div>
      ) : (
        <div className="muted small">Aucun temps fort pour l’instant.</div>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// « Souvenirs liés à la situation » — similarity recall (laboratory)
// ---------------------------------------------------------------------------

function SituationRecall({ a, state, minute }: { a: AgentState; state: WorldState; minute: number }) {
  const embedModel = useSimStore((s) => s.ai.embedModel);
  const { selectEvent } = useSimStore.getState();
  const { query, items } = useMemo(() => {
    const p = profileOf(a.id);
    const next = [...a.commitments].filter((c) => c.status === 'pending' && c.end >= minute).sort((x, y) => x.start - y.start)[0];
    const arc = arcOf(state, a.id);
    const q = situationQuery(a, p, {
      t: minute,
      locationName: a.locationId ? locName(a.locationId) : a.travel?.stage === 'riding' ? 'dans le bus' : 'en chemin',
      present: presentNames(a, state.agents, PROFILES),
      nextCommitment: next?.label,
      desire: arc ? arcSeed(arc.seedId).desire : undefined,
    });
    return { query: q, items: recallMemoriesSync(a.memories.filter((m) => m.t <= minute), q, LEXICAL, minute, 5) };
  }, [a, state, minute]);
  return (
    <>
      <div className="recall-query muted small" title="Requête de rappel construite à partir de la situation">
        Situation : {query}
      </div>
      {items.length ? (
        <ul className="memories">
          {items.map((r, i) => (
            <li key={`${r.memory.eventId}-${i}`}>
              <button
                className="memory recall-item"
                onClick={() => selectEvent(r.memory.eventId)}
                title={`Score ${r.score.toFixed(2)} = similarité ${r.similarity.toFixed(2)} · récence ${r.recency.toFixed(2)} · importance ${r.memory.importance.toFixed(2)} — voir l’événement d’origine`}
              >
                <span className="mono t">{fmtTime(r.memory.t)}</span>
                <span className="recall-rel" aria-label={`Similarité ${Math.round(r.similarity * 100)} %`}>
                  <span style={{ width: `${Math.max(4, Math.min(100, r.similarity * 100))}%` }} />
                </span>
                <span>{r.memory.text}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <Empty>Aucun souvenir à rappeler pour l’instant.</Empty>
      )}
      <div className="muted small recall-caption" title={embedModel ? `Dans l’interface, la similarité est calculée hors ligne (lexique) ; les conseillers utilisent ${embedModel}.` : 'Similarité lexicale déterministe, calculée hors ligne.'}>
        Rappel par similarité + récence + importance (embeddings locaux : {embedModel ?? 'lexique hors ligne'})
      </div>
    </>
  );
}

function currentActivity(a: AgentState): string {
  if (a.asleep) return 'Dort';
  if (a.travel) {
    const stage = TRAVEL_STAGE_LABELS[a.travel.stage];
    if (a.activity?.action === 'drive_bus') return 'Conduit le bus';
    return `${stage} → ${locName(a.travel.destinationId)}`;
  }
  return a.activity?.label ?? 'Réfléchit à la suite';
}

function NowBlock({ a, minute }: { a: AgentState; minute: number }) {
  const next = [...a.commitments].filter((c) => c.status === 'ongoing' || (c.status === 'pending' && c.end >= minute)).sort((x, y) => x.start - y.start)[0];
  const objective = a.plan?.label ?? (next ? `${next.label} (${fmtTime(next.start)})` : '—');
  return (
    <div className="now">
      <div className="now-title">
        Maintenant <span className="mono muted">{fmtTime(minute)}</span>
      </div>
      <div className="now-grid">
        <KV k="Lieu">{a.locationId ? locName(a.locationId) : a.travel?.stage === 'riding' ? `Dans le bus ${a.travel.busId ?? ''}` : 'En chemin'}</KV>
        <KV k="Activité">{currentActivity(a)}</KV>
        <KV k="Objectif">{objective}</KV>
        {next && a.plan && <KV k="Prochain engagement">{`${next.label} · ${fmtTime(next.start)}`}</KV>}
      </div>
      <div className="emo">
        <div className="emo-row">
          <span className="emo-label">Humeur</span>
          <span className="mood-gauge" title={`${a.emotions.mood.toFixed(2)} sur une échelle de −1 à +1`}>
            <span className="mood-track" />
            <span className="mood-knob" style={{ left: `${((a.emotions.mood + 1) / 2) * 100}%`, background: moodColor(a.emotions.mood) }} />
          </span>
          <span className="emo-word" style={{ color: moodColor(a.emotions.mood) }}>
            {moodWord(a.emotions.mood)}
          </span>
        </div>
        <div className="emo-row">
          <span className="emo-label">Stress</span>
          <span className="bar">
            <span className={`bar-fill ${a.emotions.stress > 0.6 ? 'tone-danger' : a.emotions.stress > 0.3 ? 'tone-warn' : 'tone-ok'}`} style={{ width: `${a.emotions.stress * 100}%` }} />
          </span>
          <span className="emo-word muted">{stressWord(a.emotions.stress)}</span>
        </div>
      </div>
    </div>
  );
}

function WhyBlock({ a, reality }: { a: AgentState; reality: Reality }) {
  const { selectEvent } = useSimStore.getState();
  const d = a.lastDecision;
  const driving = a.activity?.action === 'drive_bus';
  const others = useMemo(() => (d ? d.candidates.filter((c) => c !== d.chosen && !(c.action === d.chosen.action && c.locationId === d.chosen.locationId && c.label === d.chosen.label)).sort((x, y) => y.score - x.score).slice(0, 7) : []), [d]);
  // Reasons that merely restate a score component are already shown in the chart.
  const reasons = useMemo(() => (d ? d.reasons.filter((r) => !d.chosen.components.some((c) => r.startsWith(c.label))) : []), [d]);
  const influences = useMemo(() => (d ? d.influences.map((id) => reality.eventById(id)).filter((x): x is SimEvent => !!x) : []), [d, reality]);

  return (
    <Section title={<>Pourquoi fait-il cela&nbsp;?</>} className="why">
      {a.asleep && <div className="note">💤 {firstName(a.id)} dort : aucune décision n’est prise pendant le sommeil. Ci-dessous, la dernière décision avant de s’endormir.</div>}
      {driving && <div className="note">🚌 {firstName(a.id)} conduit le bus : le service impose l’itinéraire et les horaires.</div>}
      {!d ? (
        <Empty>Aucune décision enregistrée pour l’instant.</Empty>
      ) : (
        <>
          <div className="why-chosen">
            <div className="why-chosen-head">
              <span className="muted small">Choix retenu à {fmtTime(d.t)}</span>
              <button className="link small" onClick={() => selectEvent(d.eventId)} title="Voir l’événement de décision">
                détails
              </button>
            </div>
            <div className="why-chosen-label">
              {d.chosen.label} <span className="muted">· {locName(d.chosen.locationId)}</span>
              <span className="score mono">{d.chosen.score.toFixed(2)}</span>
            </div>
            <ComponentChart c={d.chosen} />
          </div>
          {reasons.length > 0 && (
            <ul className="reasons">
              {reasons.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          )}
          {others.length > 0 && (
            <div className="candidates">
              <div className="sub-title">Autres options envisagées</div>
              {others.map((c, i) => (
                <div key={i} className={`cand ${c.rejected ? 'rejected' : ''}`} title={c.components.map((x) => `${x.label} ${signed(x.value)}`).join('\n')}>
                  <span className="cand-rank mono">{i + 2}</span>
                  <span className="cand-label">
                    {c.label}
                    <span className="muted small"> · {locName(c.locationId)}</span>
                    {c.rejected && <span className="cand-rej">✕ {c.rejected}</span>}
                  </span>
                  <span className="score mono">{c.score.toFixed(2)}</span>
                </div>
              ))}
            </div>
          )}
          {influences.length > 0 && (
            <div className="influences">
              <div className="sub-title">Événements qui ont pesé sur la décision</div>
              {influences.map((e) => (
                <EventRow key={e.id} e={e} onClick={() => selectEvent(e.id)} />
              ))}
            </div>
          )}
        </>
      )}
    </Section>
  );
}

function ComponentChart({ c }: { c: Candidate }) {
  const max = Math.max(0.05, ...c.components.map((x) => Math.abs(x.value)));
  const comps = [...c.components].sort((x, y) => Math.abs(y.value) - Math.abs(x.value));
  if (!comps.length) return null;
  return (
    <div className="comp-chart">
      {comps.map((x, i) => (
        <SignedBar key={i} label={x.label} value={x.value} max={max} right={signed(x.value)} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Welcome
// ---------------------------------------------------------------------------

function Welcome() {
  const { setPanel, togglePlay, selectAgent } = useSimStore.getState();
  const hasB = useSimStore((s) => !!s.realityB);
  return (
    <div className="card welcome">
      <div className="welcome-mark" aria-hidden>
        🦋
      </div>
      <h2>Bienvenue au laboratoire</h2>
      <p>
        Vingt habitants vivent une journée entière, de 06:00 à minuit. Chaque geste, chaque rencontre, chaque retard est enregistré avec ses <strong>causes</strong>. Changez un détail, et observez l’effet papillon.
      </p>
      <ol className="steps">
        <li>
          <strong>Observez.</strong> Lancez la lecture <kbd>Espace</kbd> et choisissez une vitesse (×1 = temps réel, ×60 = une minute simulée par seconde).
        </li>
        <li>
          <strong>Choisissez un habitant</strong> dans la liste ou dans la ville pour comprendre ce qu’il fait, et surtout <em>pourquoi</em>.
        </li>
        <li>
          <strong>Cliquez un repère</strong> de la chronologie pour inspecter un événement et remonter ses causes.
        </li>
        <li>
          <strong>Et si… ?</strong> Créez une réalité B en modifiant un détail : un bus en retard, une boulangerie qui ferme, une rencontre imprévue.
        </li>
        <li>
          <strong>Comparez</strong> les deux journées : seules les différences reliées causalement à votre intervention sont déclarées « vérifiées ».
        </li>
      </ol>
      <div className="row gap wrap">
        <button className="btn primary" onClick={togglePlay} title="Lancer / mettre en pause la simulation">
          ▶ Lancer la journée
        </button>
        <button className="btn accent" onClick={() => setPanel('butterfly')} title="Ouvrir l’éditeur d’interventions">
          🦋 Et si…
        </button>
        <button className="btn ghost" onClick={() => selectAgent('alice')} title="Ouvrir la fiche d’Alice">
          Découvrir Alice
        </button>
        {hasB && (
          <button className="btn ghost" onClick={() => setPanel('compare')}>
            ⇄ Comparer A et B
          </button>
        )}
      </div>
    </div>
  );
}
