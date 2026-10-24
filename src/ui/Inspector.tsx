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
import { t } from '../i18n';
import { AgentChip, AiButton, Badge, Bar, Empty, EventRow, KV, NarrationBox, Section, SignedBar, aiUnavailableTitle, rich } from './common';
import { ARC_STATUS_TONE, DIALOGUE_TYPES, PROFILES, attemptLabel, dialogueFacts, stakesLevel, stakesWord } from './drama';
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
import { cachedStateAt, useActiveReality, useGoToEvent, useLocale, useMinute, useWorldState } from './hooks';

/** Offline embedder for the « Souvenirs liés à la situation » preview (vectors cached by text). */
const LEXICAL = new LexicalEmbedder();

export function Inspector() {
  useLocale();
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
  useLocale();
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
        <Empty>{t('ui.inspector_event_missing', { name: reality.def.name })}</Empty>
        <button className="btn sm" onClick={() => selectEvent(null)}>
          {t('ui.inspector_close')}
        </button>
      </div>
    );
  }

  const stageDialogue = async () => {
    setScene({ busy: true });
    try {
      const res = await aiNarrate(dialogueFacts(e, cachedStateAt(reality, e.t)), 'dialogue');
      setScene(res.ok && res.text ? { busy: false, text: res.text } : { busy: false, error: t('ui.inspector_scene_failed') });
    } catch {
      setScene({ busy: false, error: t('ui.ai_unreachable') });
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
          <button className="link" onClick={() => selectEvent(null)} title={t('ui.inspector_back_to_agent_title')}>
            {t('ui.inspector_back_to_agent', { name: firstName(selectedAgentId) })}
          </button>
        ) : (
          <span className="muted small">{t('ui.inspector_event_kind')}</span>
        )}
        <button className="icon-btn sm" onClick={() => selectEvent(null)} title={t('ui.inspector_event_close')}>
          ✕
        </button>
      </div>
      <div className="event-head">
        <span className={`fam-pill fam-${eventFamily(e.type)}`}>{eventTypeLabel(e.type)}</span>
        <span className="event-time mono">{fmtTime(e.t)}</span>
        {e.interventionId && <Badge tone="white">{t('ui.inspector_badge_intervention')}</Badge>}
      </div>
      <h2 className="event-title">{e.label}</h2>
      {e.description && <p className="event-desc">{e.description}</p>}

      <div className="kv-grid">
        {e.actors.length > 0 && (
          <KV k={t('ui.inspector_kv_actors')}>
            <span className="chips">
              {e.actors.map((a) => (
                <AgentChip key={a} id={a} />
              ))}
            </span>
          </KV>
        )}
        {e.locationId && <KV k={t('ui.inspector_kv_place')}>{locName(e.locationId)}</KV>}
        {e.busId && <KV k={t('ui.inspector_kv_bus')}>{e.busId}</KV>}
        {e.mechanism && <KV k={t('ui.inspector_kv_mechanism')}>{e.mechanism}</KV>}
        <KV k={t('ui.inspector_kv_importance')}>
          <Bar value={e.importance} tone="accent" right={e.importance.toFixed(2)} />
        </KV>
      </div>

      <div className="btn-col">
        <button
          className="btn primary"
          onClick={() => {
            if (panel !== 'causal') setPanel('causal');
          }}
          title={t('ui.inspector_why_event_title')}
        >
          {t('ui.inspector_why_event')}
        </button>
        <div className="row gap">
          <button className="btn sm" onClick={() => seek(e.t)} title={t('ui.inspector_goto_time_title')}>
            {t('ui.inspector_goto_time')}
          </button>
          {e.type === 'bus_arrive' && e.busId && (
            <button className="btn sm accent" onClick={delayBus} title={t('ui.inspector_delay_bus_title')}>
              {t('ui.inspector_delay_bus')}
            </button>
          )}
        </div>
        {canStage && (
          <div className="row gap wrap">
            <AiButton
              enabled={ai.enabled}
              busy={scene.busy}
              onClick={stageDialogue}
              title={t('ui.inspector_stage_title')}
              disabledTitle={aiUnavailableTitle(ai.message)}
            >
              {scene.busy ? t('ui.inspector_stage_busy') : t('ui.inspector_stage')}
            </AiButton>
          </div>
        )}
        {error && <div className="error">{error}</div>}
      </div>
      <NarrationBox label={t('ui.inspector_scene_label')} {...scene} />

      <Section title={t('ui.inspector_causes')} count={causes.length}>
        {causes.length ? causes.map((c) => <EventRow key={c.id} e={c} onClick={() => selectEvent(c.id)} sub={c.mechanism} />) : <Empty>{t('ui.inspector_causes_none')}</Empty>}
      </Section>
      <Section title={t('ui.inspector_effects')} count={effects.length}>
        {effects.length ? effects.slice(0, 30).map((c) => <EventRow key={c.id} e={c} onClick={() => selectEvent(c.id)} sub={c.mechanism} />) : <Empty>{t('ui.inspector_effects_none')}</Empty>}
        {effects.length > 30 && <div className="muted small">{t('ui.inspector_effects_more', { n: effects.length - 30 })}</div>}
      </Section>
      {e.randomDraws && e.randomDraws.length > 0 && (
        <Section title={t('ui.inspector_draws')} count={e.randomDraws.length} defaultOpen={false}>
          {e.randomDraws.map((d) => (
            <KV key={d.key} k={<span className="mono small">{d.key}</span>}>
              <span className="mono">{d.value.toFixed(3)}</span>
            </KV>
          ))}
        </Section>
      )}
      {e.effects.length > 0 && (
        <Section title={t('ui.inspector_state_changes')} count={e.effects.length} defaultOpen={false}>
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
  useLocale();
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

  if (!a) return <Empty>{t('ui.inspector_agent_missing')}</Empty>;

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
            {t('ui.inspector_age_occupation', { age: p.age, occupation: p.occupation })}
          </div>
        </div>
        <div className="char-actions">
          <button className={`icon-btn sm ${followed ? 'on' : ''}`} onClick={() => followAgent(followed ? null : id)} title={followed ? t('ui.inspector_follow_stop') : t('ui.inspector_follow')} aria-pressed={followed}>
            👁
          </button>
          <button className="icon-btn sm" onClick={() => selectAgent(null)} title={t('ui.inspector_card_close')}>
            ✕
          </button>
        </div>
      </div>
      <p className="bio">{p.bio}</p>

      <NowBlock a={a} minute={minute} />

      <ArcSection reality={reality} state={state} id={id} minute={minute} lab={lab} />

      <WhyBlock a={a} reality={reality} />

      <div className="row gap wrap">
        <button className="btn sm" onClick={() => setShowSummary(!showSummary)} title={t('ui.inspector_summary_title')}>
          📜 {showSummary ? t('ui.inspector_summary_hide') : t('ui.inspector_summary_show')}
        </button>
      </div>
      {summary && (
        <div className="summary-box">
          <div className="summary-headline">{summary.headline}</div>
          <p>{summary.paragraph}</p>
        </div>
      )}

      <Section title={t('ui.inspector_needs')}>
        {(Object.keys(NEED_LABELS) as (keyof typeof NEED_LABELS)[]).map((k) => {
          const v = a.needs[k] / 100;
          return <Bar key={k} label={NEED_LABELS[k]} value={v} tone={v > 0.7 ? 'danger' : v > 0.45 ? 'warn' : 'ok'} right={Math.round(a.needs[k])} />;
        })}
      </Section>

      <Section title={t('ui.inspector_traits')}>
        <div className="chips">
          {topTraits.map(([k, v]) => (
            <span key={k} className="pill" title={t('ui.inspector_trait_title', { trait: TRAIT_LABELS[k], value: Math.round(v * 100) })}>
              {TRAIT_LABELS[k]} <span className="mono muted">{Math.round(v * 100)}</span>
            </span>
          ))}
        </div>
      </Section>

      <Section title={t('ui.inspector_schedule')} count={a.commitments.length}>
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
                        {c.with.length ? t('ui.inspector_sched_with', { names: c.with.map(firstName).join(', ') }) : ''}
                        {c.lateBy ? t('ui.inspector_sched_late', { n: c.lateBy }) : ''}
                      </span>
                    </span>
                    <Badge tone={st.tone}>{st.label}</Badge>
                  </li>
                );
              })}
          </ul>
        ) : (
          <Empty>{t('ui.inspector_schedule_none')}</Empty>
        )}
      </Section>

      <Section title={t('ui.inspector_relations')} count={rels.length}>
        {rels.slice(0, allRels ? rels.length : 8).map((r) => (
          <div key={r.to} className="rel-row">
            <AgentChip id={r.to} />
            <span className="rel-kind muted small">{RELATIONSHIP_LABELS[r.kind] ?? r.kind}</span>
            <SignedBar value={r.affinity} right={signed(r.affinity)} />
          </div>
        ))}
        {rels.length > 8 && (
          <button className="link small" onClick={() => setAllRels(!allRels)}>
            {allRels ? t('ui.inspector_rels_less') : t('ui.inspector_rels_all', { n: rels.length })}
          </button>
        )}
      </Section>

      <Section title={t('ui.inspector_memories')} count={memories.length}>
        {memories.length ? (
          <ul className="memories">
            {memories.map((m, i) => (
              <li key={`${m.eventId}-${i}`}>
                <button className="memory" onClick={() => selectEvent(m.eventId)} title={t('ui.inspector_memory_title')}>
                  <span className="mono t">{fmtTime(m.t)}</span>
                  <span className="valence" style={{ background: m.valence > 0.1 ? 'var(--ok)' : m.valence < -0.1 ? 'var(--danger)' : 'var(--muted)', opacity: 0.4 + m.importance * 0.6 }} />
                  <span>{m.text}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>{t('ui.inspector_memories_none')}</Empty>
        )}
      </Section>

      {lab && (
        <Section title={t('ui.inspector_recall')} className="recall">
          <SituationRecall a={a} state={state} minute={minute} />
        </Section>
      )}

      <Section title={t('ui.inspector_decisions')} count={decisions.length}>
        {decisions.length ? decisions.map((e) => <EventRow key={e.id} e={e} onClick={() => selectEvent(e.id)} sub={e.type === 'plan_change' ? e.mechanism : undefined} />) : <Empty>{t('ui.inspector_decisions_none')}</Empty>}
      </Section>

      <Section title={t('ui.inspector_goals')} count={p.goals.length} defaultOpen={false}>
        <ul className="plain">
          {p.goals.map((g) => (
            <li key={g}>◇ {g}</li>
          ))}
        </ul>
        <div className="muted small">{t('ui.inspector_goals_done', { n: a.objectivesDone })}</div>
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// « Son histoire aujourd’hui » — the arc of the day at the displayed minute
// ---------------------------------------------------------------------------

const BAR_TONE: Record<string, string> = { muted: 'accent', accent: 'accent', ok: 'ok', danger: 'danger', warn: 'warn' };

function ArcSection({ reality, state, id, minute, lab }: { reality: Reality; state: WorldState; id: AgentId; minute: number; lab: boolean }) {
  useLocale();
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
  const known = arc.knownBy.length ? arc.knownBy.map(firstName).join(', ') : t('ui.inspector_secret_nobody');
  return (
    <Section title={t('ui.inspector_arc')} className="arc-section" right={<Badge tone={tone}>{ARC_STATUS_LABELS[arc.status]}</Badge>}>
      <div className={`arc-card st-${arc.status}`}>
        <div className="arc-head">
          <span className="fam-pill fam-drama">{summary.kind}</span>
          {attempt && <Badge tone="warn" title={t('ui.inspector_arc_retry_title')}>{attempt}</Badge>}
          <span className="arc-stakes" title={t('ui.inspector_stakes_title', { word: stakesWord(flames), n: Math.round(summary.stakes * 100) })} aria-label={t('ui.inspector_stakes_aria', { word: stakesWord(flames) })}>
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
          <span className="arc-k">{t('ui.inspector_arc_tension')}</span> {summary.tension}
        </p>
        <div className="arc-meta">
          <span className={late ? 'neg' : ''} title={t('ui.inspector_arc_deadline_title')}>
            {t('ui.inspector_arc_deadline')} <span className="mono">{fmtTime(summary.deadline)}</span>
          </span>
          <Bar value={arc.progress} tone={BAR_TONE[tone]} right={`${Math.round(arc.progress * 100)} %`} />
        </div>
        {lab && summary.secret && (
          <div className="arc-secret">
            <div className="arc-k">{t('ui.inspector_arc_secret')}</div>
            <div>{summary.secret}</div>
            <div className="muted small">
              {secretAbout ? t('ui.inspector_secret_hidden_known', { name: firstName(secretAbout), known }) : t('ui.inspector_secret_known', { known })}
            </div>
          </div>
        )}
      </div>
      {beats.length > 0 ? (
        <div className="arc-beats">
          <div className="sub-title">{t('ui.inspector_beats_until', { time: fmtTime(minute) })}</div>
          {beats.map((e) => (
            <EventRow key={e.id} e={e} onClick={() => go(e, { seek: true })} active={e.id === arc.resolutionEventId} />
          ))}
        </div>
      ) : (
        <div className="muted small">{t('ui.inspector_beats_none')}</div>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// « Souvenirs liés à la situation » — similarity recall (laboratory)
// ---------------------------------------------------------------------------

function SituationRecall({ a, state, minute }: { a: AgentState; state: WorldState; minute: number }) {
  useLocale();
  const locale = useSimStore((s) => s.locale);
  const embedModel = useSimStore((s) => s.ai.embedModel);
  const { selectEvent } = useSimStore.getState();
  const { query, items } = useMemo(() => {
    const p = profileOf(a.id);
    const next = [...a.commitments].filter((c) => c.status === 'pending' && c.end >= minute).sort((x, y) => x.start - y.start)[0];
    const arc = arcOf(state, a.id);
    const q = situationQuery(a, p, {
      t: minute,
      locationName: a.locationId ? locName(a.locationId) : a.travel?.stage === 'riding' ? t('ui.inspector_situation_in_bus') : t('ui.inspector_situation_en_route'),
      present: presentNames(a, state.agents, PROFILES),
      nextCommitment: next?.label,
      desire: arc ? arcSeed(arc.seedId).desire : undefined,
    });
    return { query: q, items: recallMemoriesSync(a.memories.filter((m) => m.t <= minute), q, LEXICAL, minute, 5) };
  }, [a, state, minute, locale]);
  return (
    <>
      <div className="recall-query muted small" title={t('ui.inspector_recall_query_title')}>
        {t('ui.inspector_recall_query', { query })}
      </div>
      {items.length ? (
        <ul className="memories">
          {items.map((r, i) => (
            <li key={`${r.memory.eventId}-${i}`}>
              <button
                className="memory recall-item"
                onClick={() => selectEvent(r.memory.eventId)}
                title={t('ui.inspector_recall_item_title', { score: r.score.toFixed(2), sim: r.similarity.toFixed(2), rec: r.recency.toFixed(2), imp: r.memory.importance.toFixed(2) })}
              >
                <span className="mono t">{fmtTime(r.memory.t)}</span>
                <span className="recall-rel" aria-label={t('ui.inspector_recall_sim_aria', { n: Math.round(r.similarity * 100) })}>
                  <span style={{ width: `${Math.max(4, Math.min(100, r.similarity * 100))}%` }} />
                </span>
                <span>{r.memory.text}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <Empty>{t('ui.inspector_recall_none')}</Empty>
      )}
      <div className="muted small recall-caption" title={embedModel ? t('ui.inspector_recall_caption_model_title', { model: embedModel }) : t('ui.inspector_recall_caption_offline_title')}>
        {t('ui.inspector_recall_caption', { model: embedModel ?? t('ui.inspector_recall_offline') })}
      </div>
    </>
  );
}

function currentActivity(a: AgentState): string {
  if (a.asleep) return t('ui.inspector_act_sleeping');
  if (a.travel) {
    const stage = TRAVEL_STAGE_LABELS[a.travel.stage];
    if (a.activity?.action === 'drive_bus') return t('ui.inspector_act_driving');
    return t('ui.inspector_act_travel', { stage, place: locName(a.travel.destinationId) });
  }
  return a.activity?.label ?? t('ui.inspector_act_thinking');
}

function NowBlock({ a, minute }: { a: AgentState; minute: number }) {
  useLocale();
  const next = [...a.commitments].filter((c) => c.status === 'ongoing' || (c.status === 'pending' && c.end >= minute)).sort((x, y) => x.start - y.start)[0];
  const objective = a.plan?.label ?? (next ? t('ui.inspector_objective_next', { label: next.label, time: fmtTime(next.start) }) : '—');
  return (
    <div className="now">
      <div className="now-title">
        {t('ui.inspector_now')} <span className="mono muted">{fmtTime(minute)}</span>
      </div>
      <div className="now-grid">
        <KV k={t('ui.inspector_kv_place')}>{a.locationId ? locName(a.locationId) : a.travel?.stage === 'riding' ? t('ui.inspector_in_bus_n', { bus: a.travel.busId ?? '' }) : t('ui.format_en_route')}</KV>
        <KV k={t('ui.inspector_kv_activity')}>{currentActivity(a)}</KV>
        <KV k={t('ui.inspector_kv_objective')}>{objective}</KV>
        {next && a.plan && <KV k={t('ui.inspector_kv_next')}>{t('ui.inspector_next_commitment', { label: next.label, time: fmtTime(next.start) })}</KV>}
      </div>
      <div className="emo">
        <div className="emo-row">
          <span className="emo-label">{t('ui.inspector_mood')}</span>
          <span className="mood-gauge" title={t('ui.inspector_mood_gauge_title', { value: a.emotions.mood.toFixed(2) })}>
            <span className="mood-track" />
            <span className="mood-knob" style={{ left: `${((a.emotions.mood + 1) / 2) * 100}%`, background: moodColor(a.emotions.mood) }} />
          </span>
          <span className="emo-word" style={{ color: moodColor(a.emotions.mood) }}>
            {moodWord(a.emotions.mood)}
          </span>
        </div>
        <div className="emo-row">
          <span className="emo-label">{t('ui.inspector_stress')}</span>
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
  useLocale();
  const { selectEvent } = useSimStore.getState();
  const d = a.lastDecision;
  const driving = a.activity?.action === 'drive_bus';
  const others = useMemo(() => (d ? d.candidates.filter((c) => c !== d.chosen && !(c.action === d.chosen.action && c.locationId === d.chosen.locationId && c.label === d.chosen.label)).sort((x, y) => y.score - x.score).slice(0, 7) : []), [d]);
  // Reasons that merely restate a score component are already shown in the chart.
  const reasons = useMemo(() => (d ? d.reasons.filter((r) => !d.chosen.components.some((c) => r.startsWith(c.label))) : []), [d]);
  const influences = useMemo(() => (d ? d.influences.map((id) => reality.eventById(id)).filter((x): x is SimEvent => !!x) : []), [d, reality]);

  return (
    <Section title={t('ui.inspector_why')} className="why">
      {a.asleep && <div className="note">💤 {t('ui.inspector_why_asleep', { name: firstName(a.id) })}</div>}
      {driving && <div className="note">🚌 {t('ui.inspector_why_driving', { name: firstName(a.id) })}</div>}
      {!d ? (
        <Empty>{t('ui.inspector_why_none')}</Empty>
      ) : (
        <>
          <div className="why-chosen">
            <div className="why-chosen-head">
              <span className="muted small">{t('ui.inspector_why_chosen_at', { time: fmtTime(d.t) })}</span>
              <button className="link small" onClick={() => selectEvent(d.eventId)} title={t('ui.inspector_why_details_title')}>
                {t('ui.inspector_why_details')}
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
              <div className="sub-title">{t('ui.inspector_why_others')}</div>
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
              <div className="sub-title">{t('ui.inspector_why_influences')}</div>
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
  useLocale();
  const { setPanel, togglePlay, selectAgent } = useSimStore.getState();
  const hasB = useSimStore((s) => !!s.realityB);
  return (
    <div className="card welcome">
      <div className="welcome-mark" aria-hidden>
        🦋
      </div>
      <h2>{t('ui.inspector_welcome_title')}</h2>
      <p>{rich(t('ui.inspector_welcome_intro'))}</p>
      <ol className="steps">
        <li>{rich(t('ui.inspector_welcome_step1'))}</li>
        <li>{rich(t('ui.inspector_welcome_step2'))}</li>
        <li>{rich(t('ui.inspector_welcome_step3'))}</li>
        <li>{rich(t('ui.inspector_welcome_step4'))}</li>
        <li>{rich(t('ui.inspector_welcome_step5'))}</li>
      </ol>
      <div className="row gap wrap">
        <button className="btn primary" onClick={togglePlay} title={t('ui.inspector_welcome_play_title')}>
          {t('ui.inspector_welcome_play')}
        </button>
        <button className="btn accent" onClick={() => setPanel('butterfly')} title={t('ui.inspector_welcome_whatif_title')}>
          {t('ui.inspector_welcome_whatif')}
        </button>
        <button className="btn ghost" onClick={() => selectAgent('alice')} title={t('ui.inspector_welcome_alice_title')}>
          {t('ui.inspector_welcome_alice')}
        </button>
        {hasB && (
          <button className="btn ghost" onClick={() => setPanel('compare')}>
            {t('ui.inspector_welcome_compare')}
          </button>
        )}
      </div>
    </div>
  );
}
