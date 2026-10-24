/**
 * Day report: factual narrative sections, per-inhabitant summaries, Q&A,
 * plain-text export and optional AI rephrasing (facts only).
 */

import { useMemo, useState } from 'react';
import { useSimStore } from '../../store/useSimStore';
import { aiNarrate, type NarrationStyle } from '../../ai/client';
import { answerQuestion, dayReport, reportToText } from '../../sim/narrative';
import { fmtTime } from '../../sim/time';
import { AgentDot, AiButton, Empty, NarrationBox, Section } from '../common';
import { counterfactualFacts, morningFacts } from '../drama';
import { moodColor } from '../format';
import { useActiveReality } from '../hooks';

const QUESTIONS = ['Qu’est-il arrivé à Alice ?', 'Qui a rencontré qui ?', 'Quel événement a eu le plus d’impact ?', 'Qu’est-ce qui a changé entre les deux réalités ?', 'Quelle était l’histoire de Noé ?'];

const NARRATION_LABELS: Partial<Record<NarrationStyle, string>> = {
  day: 'Récit du jour',
  morning: 'Ce matin, dans la ville',
  counterfactual: 'Ce qui aurait pu arriver',
};

export function ReportPanel() {
  const reality = useActiveReality();
  const comparison = useSimStore((s) => s.comparison);
  const realityB = useSimStore((s) => s.realityB);
  const generation = useSimStore((s) => s.generation);
  const ai = useSimStore((s) => s.ai);
  const lab = useSimStore((s) => s.uiMode === 'lab');
  const { selectEvent, seek, selectAgent, switchReality } = useSimStore.getState();
  /** Report items may cite events of the other reality (comparison section): switch to it first. */
  const openItem = (id: string, t?: number) => {
    if (!reality.eventById(id)) {
      const s = useSimStore.getState();
      if (s.realityB?.eventById(id) && s.activeRealityId !== 'B') switchReality('B');
      else if (s.realityA.eventById(id) && s.activeRealityId !== 'A') switchReality('A');
    }
    selectEvent(id);
    if (t !== undefined) seek(t);
  };
  const cmp = realityB ? comparison : null;
  const report = useMemo(() => dayReport(reality, cmp), [reality, cmp, generation]);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<string | null>(null);
  const [narr, setNarr] = useState<{ style?: NarrationStyle; busy: boolean; text?: string; error?: string }>({ busy: false });

  const ask = (q: string) => {
    if (!q.trim()) return;
    setQuestion(q);
    setAnswer(answerQuestion(q, reality, cmp));
  };

  const exportTxt = () => {
    const blob = new Blob([reportToText(report)], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `butterfly-rapport-graine-${reality.seed}-${reality.def.id}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const narrate = async (style: NarrationStyle) => {
    const facts = style === 'morning' ? morningFacts(report, reality, lab) : style === 'counterfactual' && cmp && realityB ? counterfactualFacts(cmp, realityB) : reportToText(report);
    setNarr({ style, busy: true });
    try {
      const res = await aiNarrate(facts, style);
      setNarr(res.ok && res.text ? { style, busy: false, text: res.text } : { style, busy: false, error: 'L’IA n’a pas pu produire de récit.' });
    } catch {
      setNarr({ style, busy: false, error: 'Service IA injoignable.' });
    }
  };
  const off = `Narration IA indisponible${ai.message ? ` — ${ai.message}` : ''}`;

  return (
    <div className="report">
      <h3 className="report-title">{report.title}</h3>
      <p className="lead">{report.intro}</p>
      <div className="row gap wrap">
        <button className="btn sm" onClick={exportTxt} title="Télécharger le rapport au format texte">
          ⬇ Exporter (.txt)
        </button>
      </div>
      <div className="narr-group" role="group" aria-label="Narration par le modèle">
        <span className="narr-group-k">✒ Narration</span>
        <AiButton enabled={ai.enabled} busy={narr.busy} onClick={() => narrate('day')} tone={narr.style === 'day' ? 'on' : ''} title="Récit de la journée en prose, à partir du rapport factuel" disabledTitle={off}>
          {narr.busy && narr.style === 'day' ? 'Écriture…' : 'Récit du jour'}
        </AiButton>
        <AiButton enabled={ai.enabled} busy={narr.busy} onClick={() => narrate('morning')} tone={narr.style === 'morning' ? 'on' : ''} title="Qui veut quoi, qui cache quoi, avant que la journée n’ait lieu (aucune issue n’est transmise)" disabledTitle={off}>
          {narr.busy && narr.style === 'morning' ? 'Écriture…' : 'Ce matin, dans la ville'}
        </AiButton>
        <AiButton
          enabled={ai.enabled && !!cmp}
          busy={narr.busy}
          onClick={() => narrate('counterfactual')}
          tone={narr.style === 'counterfactual' ? 'on' : ''}
          title="Raconter la réalité A puis la réalité B, et ce qui a basculé"
          disabledTitle={!ai.enabled ? off : 'Créez d’abord une réalité B (🦋 Et si…) pour comparer'}
        >
          {narr.busy && narr.style === 'counterfactual' ? 'Écriture…' : 'Ce qui aurait pu arriver'}
        </AiButton>
      </div>
      {!ai.enabled && <p className="muted small">Narration IA désactivée — le rapport ci-dessous reste entièrement factuel.</p>}
      <p className="muted small">Le rapport couvre la journée entière (06:00 – 24:00), indépendamment de l’heure affichée.</p>
      <NarrationBox label={NARRATION_LABELS[narr.style ?? 'day'] ?? 'Narration'} busy={narr.busy} text={narr.text} error={narr.error} />

      <Section title="Posez une question">
        <form
          className="row gap"
          onSubmit={(e) => {
            e.preventDefault();
            ask(question);
          }}
        >
          <input className="input grow" value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Ex. Qu’est-il arrivé à Alice ? Qui a rencontré qui ?" aria-label="Question sur la journée" />
          <button className="btn primary sm" type="submit" disabled={!question.trim()}>
            Demander
          </button>
        </form>
        <div className="chips examples">
          {QUESTIONS.map((q) => (
            <button key={q} className="chip" onClick={() => ask(q)}>
              {q}
            </button>
          ))}
        </div>
        {answer && <div className="answer prose">{answer}</div>}
      </Section>

      {report.sections.map((s) =>
        s.items.length ? (
          <Section key={s.title} title={s.title} count={s.items.filter((i) => i.t !== undefined || !i.text.startsWith('—')).length} defaultOpen={s.title === 'Vue chronologique' || s.title.startsWith('Arcs du jour') || s.title.startsWith('Ce qui a changé')}>
            <ul className="report-items">
              {s.items.map((it, i) => {
                const heading = it.t === undefined && it.text.startsWith('—');
                if (heading) return <li key={i} className="report-period">{it.text.replace(/^—\s*/, '')}</li>;
                const clickable = !!it.eventId;
                return (
                  <li key={i} className={clickable ? 'clickable' : ''}>
                    <button
                      className="report-item"
                      disabled={!clickable}
                      onClick={() => {
                        if (it.eventId) openItem(it.eventId, it.t);
                      }}
                      title={clickable ? 'Voir cet événement' : undefined}
                    >
                      <span className="mono t">{it.t !== undefined ? fmtTime(it.t) : ''}</span>
                      <span>{it.text}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </Section>
        ) : null,
      )}

      <Section title="Habitants" count={report.perAgent.length} defaultOpen={false}>
        {report.perAgent.length ? (
          <div className="accordion">
            {report.perAgent.map((a) => (
              <details key={a.agentId} className="acc-item">
                <summary>
                  <AgentDot id={a.agentId} />
                  <span className="strong">{a.name}</span>
                  <span className="muted small grow">{a.headline}</span>
                  <span className="mono small" title="Humeur début → fin">
                    <span style={{ color: moodColor(a.moodStart) }}>{a.moodStart.toFixed(2)}</span> → <span style={{ color: moodColor(a.moodEnd) }}>{a.moodEnd.toFixed(2)}</span>
                  </span>
                </summary>
                <div className="acc-body">
                  <p>{a.paragraph}</p>
                  {a.objectives.length > 0 && (
                    <>
                      <div className="sub-title">Objectifs</div>
                      <ul className="plain small">
                        {a.objectives.map((o, i) => (
                          <li key={i}>
                            {o.label} — <span className={o.status === 'accompli' ? 'pos' : o.status === 'manqué' ? 'neg' : 'muted'}>{o.status}</span>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                  {a.unresolved.length > 0 && (
                    <>
                      <div className="sub-title">Non résolu</div>
                      <ul className="plain small">
                        {a.unresolved.map((u, i) => (
                          <li key={i}>{u}</li>
                        ))}
                      </ul>
                    </>
                  )}
                  <button className="link small" onClick={() => selectAgent(a.agentId)}>
                    Ouvrir la fiche
                  </button>
                </div>
              </details>
            ))}
          </div>
        ) : (
          <Empty>Aucun habitant.</Empty>
        )}
      </Section>
    </div>
  );
}
