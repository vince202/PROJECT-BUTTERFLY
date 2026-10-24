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
import { busDelayFor, INTERVENTION_TEMPLATES, interpretFrench, newInterventionId, validateIntervention } from '../../sim/interventions';
import { AGENTS, profileOf } from '../../sim/population';
import { fmtTime } from '../../sim/time';
import { DAY_END, DAY_START, type ActionType, type Intervention, type InterventionKind, type Weather } from '../../sim/types';
import { Badge, Empty, KV, Section } from '../common';
import { INTERVENTION_KIND_LABELS, actionLabel, firstName, locName, parseClock } from '../format';
import { useActiveReality, useMinute } from '../hooks';

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
  const f: [string, string][] = [['Type', INTERVENTION_KIND_LABELS[iv.kind]], ['À partir de', fmtTime(iv.t)]];
  switch (iv.kind) {
    case 'bus_delay':
      f.push(['Bus', iv.busId], ['Retard', `${iv.minutes} min`]);
      break;
    case 'stay_home':
      f.push(['Habitant', firstName(iv.agentId)], ['Jusqu’à', fmtTime(iv.until)]);
      break;
    case 'force_action':
      f.push(['Habitant', firstName(iv.agentId)], ['Action', actionLabel(iv.action)]);
      if (iv.locationId) f.push(['Lieu', locName(iv.locationId)]);
      break;
    case 'agent_delay':
      f.push(['Habitant', firstName(iv.agentId)], ['Retard', `${iv.minutes} min`]);
      break;
    case 'location_hours':
      f.push(['Lieu', locName(iv.locationId)]);
      if (iv.closes !== undefined) f.push(['Fermeture', fmtTime(iv.closes)]);
      if (iv.opens !== undefined) f.push(['Ouverture', fmtTime(iv.opens)]);
      break;
    case 'weather':
      f.push(['Météo', iv.condition === 'rain' ? 'Pluie' : 'Ciel dégagé']);
      if (iv.until !== undefined) f.push(['Jusqu’à', fmtTime(iv.until)]);
      break;
    case 'cancel_commitment':
      f.push(['Habitant', firstName(iv.agentId)], ['Engagement', iv.commitmentId ?? 'le prochain']);
      break;
    case 'encounter':
      f.push(['Personnes', `${firstName(iv.agentA)} & ${firstName(iv.agentB)}`], ['Lieu', locName(iv.locationId)]);
      break;
  }
  return f;
}

export function ButterflyPanel() {
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
      const r = interpretFrench(text, { t, selectedEvent, events: realityA.events });
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
          setInterp({ ...local(), note: 'L’IA n’a pas produit d’intervention valide : interprétation locale utilisée.' });
          return;
        } catch {
          setInterp({ ...local(), note: 'Service IA injoignable : interprétation locale utilisée.' });
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
      <p className="lead">
        Changez un seul détail de la journée. Le moteur rejoue tout avec la <strong>même graine</strong> : chaque différence observée découle de votre intervention… ou du hasard qu’elle a déplacé.
      </p>
      <div className="row gap center">
        <span className="muted">Heure courante</span>
        <span className="mono strong">{fmtTime(minute)}</span>
        {realityB && <Badge tone="b">s’ajoutera à la réalité B</Badge>}
      </div>

      {selectedEvent?.type === 'bus_arrive' && selectedEvent.busId && (
        <div className="shortcut">
          <div>
            <div className="strong">Raccourci</div>
            <div className="muted small">{selectedEvent.label}</div>
          </div>
          <div className="row gap center">
            Retarder ce bus de
            <input className="input mono num" type="number" min={1} max={60} value={busMinutes} onChange={(e) => setBusMinutes(Math.max(1, Math.min(60, Number(e.target.value) || 1)))} aria-label="Minutes de retard" />
            min
            <button className="btn accent sm" onClick={() => create(busDelayFor(selectedEvent, busMinutes))} title="Créer la réalité B avec ce retard">
              Créer
            </button>
          </div>
        </div>
      )}

      <Section title="Décrire en français">
        <textarea
          className="input textarea"
          rows={3}
          value={text}
          placeholder={INTERVENTION_TEMPLATES.slice(0, 3)
            .map((x) => x.example)
            .join('\n')}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) interpret();
          }}
          aria-label="Intervention en langage naturel"
        />
        <div className="chips examples">
          {INTERVENTION_TEMPLATES.map((x) => (
            <button key={x.id} className="chip" onClick={() => (setText(x.example), setInterp(null))} title={x.example}>
              {x.label}
            </button>
          ))}
        </div>
        <div className="row gap center">
          <button className="btn primary" onClick={interpret} disabled={!text.trim() || busy} title="Traduire la phrase en intervention structurée (Ctrl+Entrée)">
            {busy ? 'Interprétation…' : 'Interpréter'}
          </button>
          <span className="muted small">{ai.enabled ? `Interprétation par l’IA (${ai.model ?? 'modèle'}) avec repli local` : 'Interprétation locale (sans IA)'}</span>
        </div>

        {interp && (
          <div className={`interp ${interp.ok && !validation.length ? 'ok' : 'bad'}`}>
            <div className="row gap center">
              <Badge tone={interp.source === 'ia' ? 'b' : 'muted'}>{interp.source === 'ia' ? 'IA' : 'local'}</Badge>
              {interp.confidence !== undefined && (
                <span className="muted small" title="Confiance de l’interprétation">
                  confiance {Math.round(interp.confidence * 100)} %
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
                  <div className="iv-desc">« {interp.intervention.description} »</div>
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
                  <button className="btn accent" disabled={validation.length > 0} onClick={() => create(interp.intervention!)} title="Simuler la journée modifiée">
                    🦋 Créer la réalité B
                  </button>
                  <button className="link small" onClick={() => setShowJson(!showJson)}>
                    {showJson ? 'Masquer' : 'Détails'} JSON
                  </button>
                </div>
                {showJson && <pre className="json">{JSON.stringify(interp.intervention, null, 2)}</pre>}
              </>
            )}
          </div>
        )}
      </Section>

      <Section title="Formulaire structuré" defaultOpen={!ai.enabled}>
        <StructuredForm t={t} onCreate={create} />
      </Section>

      {error && <div className="error">{error}</div>}

      {realityB && (
        <Section title="Réalité B" count={realityB.def.interventions.length}>
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
          <p className="muted small">Toute nouvelle intervention créée ici s’ajoute à la réalité B (les interventions s’empilent).</p>
          <div className="row gap wrap">
            <button className="btn sm" onClick={() => switchReality('B')}>
              Voir la réalité B
            </button>
            <button
              className="btn sm danger"
              onClick={() => {
                if (window.confirm('Abandonner la réalité B et toutes ses interventions ?')) discardRealityB();
              }}
            >
              Abandonner la réalité B
            </button>
          </div>
        </Section>
      )}
    </div>
  );
}

function StructuredForm({ t, onCreate }: { t: number; onCreate: (iv: Intervention) => void }) {
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
    if (startT === null || startT < DAY_START || startT >= DAY_END) return 'Heure de début invalide (HH:MM entre 06:00 et 23:59).';
    const id = newInterventionId();
    const name = firstName(agentId);
    const city = getCity();
    switch (kind) {
      case 'bus_delay': {
        const arr = arrivals.find((e) => e.id === busArrivalId) ?? arrivals[0];
        if (!arr) return 'Aucun passage de bus après cette heure.';
        return busDelayFor(arr, minutes);
      }
      case 'stay_home': {
        const u = parseClock(until);
        if (u === null) return 'Heure de fin invalide.';
        return { id, kind, agentId, t: startT, until: u, description: `${name} reste à la maison de ${fmtTime(startT)} à ${fmtTime(u)}` };
      }
      case 'force_action': {
        const loc = locationId || defaultLocationFor(action, profileOf(agentId), city);
        return { id, kind, agentId, t: startT, action, locationId: loc, description: `${name} décide : ${actionLabel(action).toLowerCase()} (${locName(loc)}) à ${fmtTime(startT)}` };
      }
      case 'agent_delay':
        return { id, kind, agentId, t: startT, minutes, description: `${name} s’attarde ${minutes} min à partir de ${fmtTime(startT)}` };
      case 'location_hours': {
        const c = parseClock(closes);
        if (c === null) return 'Heure de fermeture invalide.';
        return { id, kind, locationId, t: Math.min(startT, c), closes: c, description: `${locName(locationId)} ferme à ${fmtTime(c)}` };
      }
      case 'weather': {
        const u = until ? parseClock(until) : null;
        return {
          id,
          kind,
          t: startT,
          condition,
          until: condition === 'rain' && u !== null && u > startT ? u : undefined,
          description: condition === 'rain' ? `La pluie commence à ${fmtTime(startT)}${u !== null && u > startT ? ` jusqu’à ${fmtTime(u)}` : ''}` : `Le ciel se dégage à ${fmtTime(startT)}`,
        };
      }
      case 'cancel_commitment': {
        const c = commitments.find((x) => x.id === commitmentId);
        return { id, kind, agentId, t: startT, commitmentId: c?.id, description: c ? `${name} ne se rend pas à « ${c.label} » (${fmtTime(c.start)})` : `${name} ne se rend pas à son prochain rendez-vous` };
      }
      case 'encounter':
        return { id, kind, agentA: agentId, agentB, locationId, t: startT, description: `${name} et ${firstName(agentB)} se retrouvent à ${locName(locationId)} à partir de ${fmtTime(startT)}` };
      case 'lose_item':
        return { id, kind, agentId, t: startT, item: 'wallet', description: `${name} oublie son portefeuille à ${fmtTime(startT)} (s’il est dans un lieu public)` };
      case 'theft':
        return { id, kind, agentId, t: startT, description: `${name} se fait voler son portefeuille à ${fmtTime(startT)}` };
      case 'accident':
        return { id, kind, agentId, t: startT, minutes: Math.max(10, minutes * 10), description: `${name} a un accident à ${fmtTime(startT)} (${Math.max(10, minutes * 10)} min à la clinique)` };
      case 'fire':
        return { id, kind, locationId, t: startT, description: `Un incendie se déclare à ${locName(locationId)} à ${fmtTime(startT)}` };
      case 'breakup':
        return { id, kind, agentA: agentId, agentB, t: startT, description: `${name} et ${firstName(agentB)} se séparent à ${fmtTime(startT)}` };
      case 'dismissal':
        return { id, kind, agentId, t: startT, description: `${name} est renvoyé à ${fmtTime(startT)}` };
      case 'promotion':
        return { id, kind, agentId, t: startT, description: `${name} est promu à ${fmtTime(startT)}` };
      case 'illness':
        return { id, kind, agentId, t: startT, minutes: Math.max(10, minutes * 10), description: `${name} fait un malaise à ${fmtTime(startT)} et se repose ${Math.max(10, minutes * 10)} min` };
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
      <div className="kind-grid" role="radiogroup" aria-label="Type d’intervention">
        {INTERVENTION_TEMPLATES.map((x) => (
          <button key={x.id} className={`kind ${kind === x.kind ? 'active' : ''}`} onClick={() => (setKind(x.kind), setError(null))} role="radio" aria-checked={kind === x.kind} title={x.example}>
            {x.label}
          </button>
        ))}
      </div>
      <div className="form-grid">
        <label>
          <span>Heure de début</span>
          <input className="input mono" value={time} placeholder={fmtTime(t)} onChange={(e) => setTime(e.target.value)} />
        </label>
        {needsAgent && (
          <label>
            <span>{kind === 'encounter' ? 'Habitant 1' : 'Habitant'}</span>
            <select className="input" value={agentId} onChange={(e) => setAgentId(e.target.value)}>
              {AGENTS.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.firstName} — {a.occupation}
                </option>
              ))}
            </select>
          </label>
        )}
        {kind === 'encounter' && (
          <label>
            <span>Habitant 2</span>
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
            <span>Action</span>
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
            <span>Lieu</span>
            <select className="input" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
              {kind === 'force_action' && <option value="">Lieu habituel</option>}
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
            <span>Passage de bus</span>
            <select className="input" value={busArrivalId} onChange={(e) => setBusArrivalId(e.target.value)}>
              {arrivals.map((e) => (
                <option key={e.id} value={e.id}>
                  {fmtTime(e.t)} · {e.busId} · {locName(e.locationId)}
                </option>
              ))}
            </select>
          </label>
        )}
        {needsMinutes && (
          <label>
            <span>Minutes</span>
            <input className="input mono" type="number" min={1} max={60} value={minutes} onChange={(e) => setMinutes(Math.max(1, Math.min(60, Number(e.target.value) || 1)))} />
          </label>
        )}
        {(kind === 'stay_home' || (kind === 'weather' && condition === 'rain')) && (
          <label>
            <span>Jusqu’à</span>
            <input className="input mono" value={until} placeholder="HH:MM" onChange={(e) => setUntil(e.target.value)} />
          </label>
        )}
        {kind === 'location_hours' && (
          <label>
            <span>Ferme à</span>
            <input className="input mono" value={closes} placeholder="HH:MM" onChange={(e) => setCloses(e.target.value)} />
          </label>
        )}
        {kind === 'weather' && (
          <label>
            <span>Condition</span>
            <select className="input" value={condition} onChange={(e) => setCondition(e.target.value as Weather)}>
              <option value="rain">Pluie</option>
              <option value="clear">Ciel dégagé</option>
            </select>
          </label>
        )}
        {kind === 'cancel_commitment' && (
          <label className="wide">
            <span>Engagement</span>
            <select className="input" value={commitmentId} onChange={(e) => setCommitmentId(e.target.value)}>
              <option value="">Le prochain rendez-vous</option>
              {commitments.map((c) => (
                <option key={c.id} value={c.id}>
                  {fmtTime(c.start)} · {c.label}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {typeof preview !== 'string' ? <div className="iv-desc">« {preview.description} »</div> : <Empty>{preview}</Empty>}
      {error && <div className="error">{error}</div>}
      <button className="btn accent" onClick={submit} disabled={typeof preview === 'string'} title="Simuler la journée avec cette intervention">
        🦋 Créer la réalité B
      </button>
    </div>
  );
}
