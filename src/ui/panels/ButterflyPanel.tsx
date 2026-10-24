/**
 * "Et si…" — intervention editor. Natural-language interpretation (optional
 * LLM, always with the local rule-based fallback) plus a structured form that
 * works fully offline.
 */

import { useMemo, useState } from 'react';
import { useSimStore } from '../../store/useSimStore';
import { aiInterpret } from '../../ai/client';
import { getCity, LOCATIONS } from '../../sim/city';
import { defaultLocationFor } from '../../sim/decision';
import { t as tr } from '../../i18n';
import { busDelayFor, newInterventionId, validateIntervention } from '../../sim/interventions';
import { interpretText, interventionTemplates } from '../interpret';
import { AGENTS, profileOf } from '../../sim/population';
import { fmtTime } from '../../sim/time';
import { DAY_END, DAY_START, type ActionType, type Intervention, type InterventionKind, type Weather } from '../../sim/types';
import { Badge, Empty, KV, Section, fill, rich } from '../common';
import { INTERVENTION_KIND_LABELS, actionLabel, firstName, locName, parseClock } from '../format';
import { useActiveReality, useLocale, useMinute } from '../hooks';

const FORCE_ACTIONS: ActionType[] = ['coffee', 'eat_bakery', 'eat_cafe', 'eat_restaurant', 'shop_groceries', 'relax_park', 'read_library', 'workout', 'stroll', 'rest_home', 'stay_home'];
const PLACES = LOCATIONS.filter((l) => l.kind !== 'bus_stop');

interface Interpretation {
  source: 'ia' | 'local';
  ok: boolean;
  intervention?: Intervention;
  explanation: string;
  issues: string[];
  confidence?: number;
  note?: string;
}

/** Human-readable fields of an intervention. */
export function interventionFields(iv: Intervention): [string, string][] {
  const f: [string, string][] = [[tr('ui.field_type'), INTERVENTION_KIND_LABELS[iv.kind]], [tr('ui.field_from'), fmtTime(iv.t)]];
  switch (iv.kind) {
    case 'bus_delay':
      f.push([tr('ui.field_bus'), iv.busId], [tr('ui.field_delay'), tr('common.minutes', { n: iv.minutes })]);
      break;
    case 'stay_home':
      f.push([tr('ui.field_agent'), firstName(iv.agentId)], [tr('ui.field_until'), fmtTime(iv.until)]);
      break;
    case 'force_action':
      f.push([tr('ui.field_agent'), firstName(iv.agentId)], [tr('ui.field_action'), actionLabel(iv.action)]);
      if (iv.locationId) f.push([tr('ui.field_place'), locName(iv.locationId)]);
      break;
    case 'agent_delay':
      f.push([tr('ui.field_agent'), firstName(iv.agentId)], [tr('ui.field_delay'), tr('common.minutes', { n: iv.minutes })]);
      break;
    case 'location_hours':
      f.push([tr('ui.field_place'), locName(iv.locationId)]);
      if (iv.closes !== undefined) f.push([tr('ui.field_closing'), fmtTime(iv.closes)]);
      if (iv.opens !== undefined) f.push([tr('ui.field_opening'), fmtTime(iv.opens)]);
      break;
    case 'weather':
      f.push([tr('ui.field_weather'), iv.condition === 'rain' ? tr('ui.field_weather_rain') : tr('ui.field_weather_clear')]);
      if (iv.until !== undefined) f.push([tr('ui.field_until'), fmtTime(iv.until)]);
      break;
    case 'cancel_commitment':
      f.push([tr('ui.field_agent'), firstName(iv.agentId)], [tr('ui.field_commitment'), iv.commitmentId ?? tr('ui.field_next_one')]);
      break;
    case 'encounter':
      f.push([tr('ui.field_people'), tr('ui.field_pair', { a: firstName(iv.agentA), b: firstName(iv.agentB) })], [tr('ui.field_place'), locName(iv.locationId)]);
      break;
  }
  return f;
}

export function ButterflyPanel() {
  useLocale();
  const templates = interventionTemplates();
  const minute = useMinute();
  const reality = useActiveReality();
  const realityA = useSimStore((s) => s.realityA);
  const realityB = useSimStore((s) => s.realityB);
  const ai = useSimStore((s) => s.ai);
  const selectedEventId = useSimStore((s) => s.selectedEventId);
  const { createRealityB, discardRealityB, switchReality } = useSimStore.getState();
  const selectedEvent = selectedEventId ? (reality.eventById(selectedEventId) ?? null) : null;

  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [interp, setInterp] = useState<Interpretation | null>(null);
  const [showJson, setShowJson] = useState(false);
  const [busMinutes, setBusMinutes] = useState(3);
  const [error, setError] = useState<string | null>(null);

  const t = Math.min(DAY_END - 1, Math.max(DAY_START, minute));
  const validation = interp?.intervention ? validateIntervention(interp.intervention) : [];

  const interpret = async () => {
    if (!text.trim()) return;
    setBusy(true);
    setError(null);
    const local = () => {
      const r = interpretText(text, { t, selectedEvent, events: realityA.events });
      return { source: 'local' as const, ...r };
    };
    try {
      if (ai.enabled) {
        try {
          const recentEvents = realityA.eventsBetween(t - 60, t + 180).filter((e) => e.importance >= 0.3 || e.type === 'bus_arrive').slice(0, 120);
          const res = await aiInterpret(text, { t, selectedEvent, recentEvents });
          if (res.ok && res.intervention) {
            const iv = { ...res.intervention, id: res.intervention.id || newInterventionId() } as Intervention;
            if (!validateIntervention(iv).length) {
              setInterp({ source: 'ia', ok: true, intervention: iv, explanation: res.explanation, issues: res.issues ?? [] });
              return;
            }
          }
          setInterp({ ...local(), note: tr('ui.butterfly_note_invalid') });
          return;
        } catch {
          setInterp({ ...local(), note: tr('ui.butterfly_note_unreachable') });
          return;
        }
      }
      setInterp(local());
    } finally {
      setBusy(false);
    }
  };

  const create = (iv: Intervention) => {
    const errs = validateIntervention(iv);
    if (errs.length) {
      setError(errs.join(' '));
      return;
    }
    setError(null);
    createRealityB(iv);
  };

  return (
    <div className="butterfly">
      <p className="lead">{rich(tr('ui.butterfly_lead'))}</p>
      <div className="row gap center">
        <span className="muted">{tr('ui.butterfly_current_time')}</span>
        <span className="mono strong">{fmtTime(minute)}</span>
        {realityB && <Badge tone="b">{tr('ui.butterfly_adds_to_b')}</Badge>}
      </div>

      {selectedEvent?.type === 'bus_arrive' && selectedEvent.busId && (
        <div className="shortcut">
          <div>
            <div className="strong">{tr('ui.butterfly_shortcut')}</div>
            <div className="muted small">{selectedEvent.label}</div>
          </div>
          <div className="row gap center">
            {fill(tr('ui.butterfly_shortcut_delay'), {
              input: <input className="input mono num" type="number" min={1} max={60} value={busMinutes} onChange={(e) => setBusMinutes(Math.max(1, Math.min(60, Number(e.target.value) || 1)))} aria-label={tr('ui.butterfly_delay_aria')} />,
            })}
            <button className="btn accent sm" onClick={() => create(busDelayFor(selectedEvent, busMinutes))} title={tr('ui.butterfly_shortcut_create_title')}>
              {tr('ui.butterfly_shortcut_create')}
            </button>
          </div>
        </div>
      )}

      <Section title={tr('ui.butterfly_describe')}>
        <textarea
          className="input textarea"
          rows={3}
          value={text}
          placeholder={templates.slice(0, 3)
            .map((x) => x.example)
            .join('\n')}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) interpret();
          }}
          aria-label={tr('ui.butterfly_text_aria')}
        />
        <div className="chips examples">
          {templates.map((x) => (
            <button key={x.id} className="chip" onClick={() => (setText(x.example), setInterp(null))} title={x.example}>
              {x.label}
            </button>
          ))}
        </div>
        <div className="row gap center">
          <button className="btn primary" onClick={interpret} disabled={!text.trim() || busy} title={tr('ui.butterfly_interpret_title')}>
            {busy ? tr('ui.butterfly_interpreting') : tr('ui.butterfly_interpret')}
          </button>
          <span className="muted small">{ai.enabled ? tr('ui.butterfly_interp_ai', { model: ai.model ?? tr('ui.butterfly_model_default') }) : tr('ui.butterfly_interp_local')}</span>
        </div>

        {interp && (
          <div className={`interp ${interp.ok && !validation.length ? 'ok' : 'bad'}`}>
            <div className="row gap center">
              <Badge tone={interp.source === 'ia' ? 'b' : 'muted'}>{interp.source === 'ia' ? tr('ui.common_ai_badge') : tr('ui.butterfly_source_local')}</Badge>
              {interp.confidence !== undefined && (
                <span className="muted small" title={tr('ui.butterfly_confidence_title')}>
                  {tr('ui.butterfly_confidence', { n: Math.round(interp.confidence * 100) })}
                </span>
              )}
            </div>
            {interp.note && <div className="note small">{interp.note}</div>}
            <p className="interp-expl">{interp.explanation}</p>
            {interp.issues.length > 0 && (
              <ul className="issues">
                {interp.issues.map((x, i) => (
                  <li key={i}>{x}</li>
                ))}
              </ul>
            )}
            {interp.intervention && (
              <>
                <div className="iv-summary">
                  <div className="iv-desc">{tr('ui.quote', { text: interp.intervention.description })}</div>
                  <div className="kv-grid">
                    {interventionFields(interp.intervention).map(([k, v]) => (
                      <KV key={k} k={k}>
                        {v}
                      </KV>
                    ))}
                  </div>
                </div>
                {validation.length > 0 && <div className="error">{validation.join(' ')}</div>}
                <div className="row gap center">
                  <button className="btn accent" disabled={validation.length > 0} onClick={() => create(interp.intervention!)} title={tr('ui.butterfly_create_title')}>
                    {tr('ui.butterfly_create_b')}
                  </button>
                  <button className="link small" onClick={() => setShowJson(!showJson)}>
                    {showJson ? tr('ui.butterfly_json_hide') : tr('ui.butterfly_json_show')}
                  </button>
                </div>
                {showJson && <pre className="json">{JSON.stringify(interp.intervention, null, 2)}</pre>}
              </>
            )}
          </div>
        )}
      </Section>

      <Section title={tr('ui.butterfly_form')} defaultOpen={!ai.enabled}>
        <StructuredForm t={t} onCreate={create} />
      </Section>

      {error && <div className="error">{error}</div>}

      {realityB && (
        <Section title={tr('ui.butterfly_reality_b')} count={realityB.def.interventions.length}>
          <ul className="iv-list">
            {realityB.def.interventions.map((iv, i) => (
              <li key={iv.id}>
                <span className="iv-n mono">{i + 1}</span>
                <span>
                  <span className="strong">{INTERVENTION_KIND_LABELS[iv.kind]}</span> · {fmtTime(iv.t)}
                  <div className="muted small">{iv.description}</div>
                </span>
              </li>
            ))}
          </ul>
          <p className="muted small">{tr('ui.butterfly_stacking')}</p>
          <div className="row gap wrap">
            <button className="btn sm" onClick={() => switchReality('B')}>
              {tr('ui.butterfly_view_b')}
            </button>
            <button
              className="btn sm danger"
              onClick={() => {
                if (window.confirm(tr('ui.butterfly_discard_confirm'))) discardRealityB();
              }}
            >
              {tr('ui.butterfly_discard_b')}
            </button>
          </div>
        </Section>
      )}
    </div>
  );
}

function StructuredForm({ t, onCreate }: { t: number; onCreate: (iv: Intervention) => void }) {
  useLocale();
  const templates = interventionTemplates();
  const realityA = useSimStore((s) => s.realityA);
  const realityB = useSimStore((s) => s.realityB);
  const base = realityB ?? realityA;
  const [kind, setKind] = useState<InterventionKind>('bus_delay');
  const [agentId, setAgentId] = useState(AGENTS[0].id);
  const [agentB, setAgentB] = useState(AGENTS[1].id);
  const [locationId, setLocationId] = useState('cafe');
  const [time, setTime] = useState('');
  const [minutes, setMinutes] = useState(3);
  const [until, setUntil] = useState('12:00');
  const [closes, setCloses] = useState('12:00');
  const [condition, setCondition] = useState<Weather>('rain');
  const [action, setAction] = useState<ActionType>('coffee');
  const [busArrivalId, setBusArrivalId] = useState('');
  const [commitmentId, setCommitmentId] = useState('');
  const [error, setError] = useState<string | null>(null);

  const startT = time ? parseClock(time) : t;
  const arrivals = useMemo(() => base.events.filter((e) => e.type === 'bus_arrive' && e.busId && e.t >= (startT ?? t)).slice(0, 40), [base, startT, t]);
  const commitments = useMemo(() => (base.engine.state.agents[agentId]?.commitments ?? []).filter((c) => c.end >= (startT ?? t)).sort((x, y) => x.start - y.start), [base, agentId, startT, t]);

  const build = (): Intervention | string => {
    if (startT === null || startT < DAY_START || startT >= DAY_END) return tr('ui.form_err_start');
    const id = newInterventionId();
    const name = firstName(agentId);
    const city = getCity();
    switch (kind) {
      case 'bus_delay': {
        const arr = arrivals.find((e) => e.id === busArrivalId) ?? arrivals[0];
        if (!arr) return tr('ui.form_err_no_bus');
        return busDelayFor(arr, minutes);
      }
      case 'stay_home': {
        const u = parseClock(until);
        if (u === null) return tr('ui.form_err_end');
        return { id, kind, agentId, t: startT, until: u, description: tr('ui.iv_stay_home', { name, from: fmtTime(startT), until: fmtTime(u) }) };
      }
      case 'force_action': {
        const loc = locationId || defaultLocationFor(action, profileOf(agentId), city);
        return { id, kind, agentId, t: startT, action, locationId: loc, description: tr('ui.iv_force_action', { name, action: actionLabel(action).toLowerCase(), place: locName(loc), time: fmtTime(startT) }) };
      }
      case 'agent_delay':
        return { id, kind, agentId, t: startT, minutes, description: tr('ui.iv_agent_delay', { name, n: minutes, time: fmtTime(startT) }) };
      case 'location_hours': {
        const c = parseClock(closes);
        if (c === null) return tr('ui.form_err_close');
        return { id, kind, locationId, t: Math.min(startT, c), closes: c, description: tr('ui.iv_location_closes', { place: locName(locationId), time: fmtTime(c) }) };
      }
      case 'weather': {
        const u = until ? parseClock(until) : null;
        return {
          id,
          kind,
          t: startT,
          condition,
          until: condition === 'rain' && u !== null && u > startT ? u : undefined,
          description: condition === 'rain' ? (u !== null && u > startT ? tr('ui.iv_rain_until', { time: fmtTime(startT), until: fmtTime(u) }) : tr('ui.iv_rain', { time: fmtTime(startT) })) : tr('ui.iv_clear', { time: fmtTime(startT) }),
        };
      }
      case 'cancel_commitment': {
        const c = commitments.find((x) => x.id === commitmentId);
        return { id, kind, agentId, t: startT, commitmentId: c?.id, description: c ? tr('ui.iv_cancel_named', { name, label: c.label, time: fmtTime(c.start) }) : tr('ui.iv_cancel_next', { name }) };
      }
      case 'encounter':
        return { id, kind, agentA: agentId, agentB, locationId, t: startT, description: tr('ui.iv_encounter', { name, other: firstName(agentB), place: locName(locationId), time: fmtTime(startT) }) };
      case 'lose_item':
        return { id, kind, agentId, t: startT, item: 'wallet', description: tr('ui.iv_lose_item', { name, time: fmtTime(startT) }) };
      case 'theft':
        return { id, kind, agentId, t: startT, description: tr('ui.iv_theft', { name, time: fmtTime(startT) }) };
      case 'accident':
        return { id, kind, agentId, t: startT, minutes: Math.max(10, minutes * 10), description: tr('ui.iv_accident', { name, time: fmtTime(startT), n: Math.max(10, minutes * 10) }) };
      case 'fire':
        return { id, kind, locationId, t: startT, description: tr('ui.iv_fire', { place: locName(locationId), time: fmtTime(startT) }) };
      case 'breakup':
        return { id, kind, agentA: agentId, agentB, t: startT, description: tr('ui.iv_breakup', { name, other: firstName(agentB), time: fmtTime(startT) }) };
      case 'dismissal':
        return { id, kind, agentId, t: startT, description: tr('ui.iv_dismissal', { name, time: fmtTime(startT) }) };
      case 'promotion':
        return { id, kind, agentId, t: startT, description: tr('ui.iv_promotion', { name, time: fmtTime(startT) }) };
      case 'illness':
        return { id, kind, agentId, t: startT, minutes: Math.max(10, minutes * 10), description: tr('ui.iv_illness', { name, time: fmtTime(startT), n: Math.max(10, minutes * 10) }) };
    }
  };

  const submit = () => {
    const r = build();
    if (typeof r === 'string') return setError(r);
    const errs = validateIntervention(r);
    if (errs.length) return setError(errs.join(' '));
    setError(null);
    onCreate(r);
  };

  const preview = build();
  const needsAgent = kind === 'stay_home' || kind === 'force_action' || kind === 'agent_delay' || kind === 'cancel_commitment' || kind === 'encounter';
  const needsLocation = kind === 'force_action' || kind === 'location_hours' || kind === 'encounter';
  const needsMinutes = kind === 'bus_delay' || kind === 'agent_delay';

  return (
    <div className="form">
      <div className="kind-grid" role="radiogroup" aria-label={tr('ui.form_kind_aria')}>
        {templates.map((x) => (
          <button key={x.id} className={`kind ${kind === x.kind ? 'active' : ''}`} onClick={() => (setKind(x.kind), setError(null))} role="radio" aria-checked={kind === x.kind} title={x.example}>
            {x.label}
          </button>
        ))}
      </div>
      <div className="form-grid">
        <label>
          <span>{tr('ui.form_start_time')}</span>
          <input className="input mono" value={time} placeholder={fmtTime(t)} onChange={(e) => setTime(e.target.value)} />
        </label>
        {needsAgent && (
          <label>
            <span>{kind === 'encounter' ? tr('ui.form_agent_1') : tr('ui.form_agent')}</span>
            <select className="input" value={agentId} onChange={(e) => setAgentId(e.target.value)}>
              {AGENTS.map((a) => (
                <option key={a.id} value={a.id}>
                  {tr('ui.form_agent_option', { name: a.firstName, occupation: a.occupation })}
                </option>
              ))}
            </select>
          </label>
        )}
        {kind === 'encounter' && (
          <label>
            <span>{tr('ui.form_agent_2')}</span>
            <select className="input" value={agentB} onChange={(e) => setAgentB(e.target.value)}>
              {AGENTS.filter((a) => a.id !== agentId).map((a) => (
                <option key={a.id} value={a.id}>
                  {a.firstName}
                </option>
              ))}
            </select>
          </label>
        )}
        {kind === 'force_action' && (
          <label>
            <span>{tr('ui.form_action')}</span>
            <select className="input" value={action} onChange={(e) => setAction(e.target.value as ActionType)}>
              {FORCE_ACTIONS.map((a) => (
                <option key={a} value={a}>
                  {actionLabel(a)}
                </option>
              ))}
            </select>
          </label>
        )}
        {needsLocation && (
          <label>
            <span>{tr('ui.form_place')}</span>
            <select className="input" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
              {kind === 'force_action' && <option value="">{tr('ui.form_usual_place')}</option>}
              {PLACES.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {kind === 'bus_delay' && (
          <label className="wide">
            <span>{tr('ui.form_bus_pass')}</span>
            <select className="input" value={busArrivalId} onChange={(e) => setBusArrivalId(e.target.value)}>
              {arrivals.map((e) => (
                <option key={e.id} value={e.id}>
                  {tr('ui.form_bus_option', { time: fmtTime(e.t), bus: e.busId ?? '', place: locName(e.locationId) })}
                </option>
              ))}
            </select>
          </label>
        )}
        {needsMinutes && (
          <label>
            <span>{tr('ui.form_minutes')}</span>
            <input className="input mono" type="number" min={1} max={60} value={minutes} onChange={(e) => setMinutes(Math.max(1, Math.min(60, Number(e.target.value) || 1)))} />
          </label>
        )}
        {(kind === 'stay_home' || (kind === 'weather' && condition === 'rain')) && (
          <label>
            <span>{tr('ui.form_until')}</span>
            <input className="input mono" value={until} placeholder="HH:MM" onChange={(e) => setUntil(e.target.value)} />
          </label>
        )}
        {kind === 'location_hours' && (
          <label>
            <span>{tr('ui.form_closes_at')}</span>
            <input className="input mono" value={closes} placeholder="HH:MM" onChange={(e) => setCloses(e.target.value)} />
          </label>
        )}
        {kind === 'weather' && (
          <label>
            <span>{tr('ui.form_condition')}</span>
            <select className="input" value={condition} onChange={(e) => setCondition(e.target.value as Weather)}>
              <option value="rain">{tr('ui.field_weather_rain')}</option>
              <option value="clear">{tr('ui.field_weather_clear')}</option>
            </select>
          </label>
        )}
        {kind === 'cancel_commitment' && (
          <label className="wide">
            <span>{tr('ui.form_commitment')}</span>
            <select className="input" value={commitmentId} onChange={(e) => setCommitmentId(e.target.value)}>
              <option value="">{tr('ui.form_next_meeting')}</option>
              {commitments.map((c) => (
                <option key={c.id} value={c.id}>
                  {tr('ui.form_commitment_option', { time: fmtTime(c.start), label: c.label })}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {typeof preview !== 'string' ? <div className="iv-desc">{tr('ui.quote', { text: preview.description })}</div> : <Empty>{preview}</Empty>}
      {error && <div className="error">{error}</div>}
      <button className="btn accent" onClick={submit} disabled={typeof preview === 'string'} title={tr('ui.form_create_title')}>
        {tr('ui.butterfly_create_b')}
      </button>
    </div>
  );
}
