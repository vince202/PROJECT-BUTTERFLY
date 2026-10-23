/**
 * Day report: factual narrative sections, per-inhabitant summaries, Q&A,
 * plain-text export and optional AI rephrasing (facts only).
 */

import { useMemo, useState } from 'react';
import { useSimStore } from '../../store/useSimStore';
import { aiNarrate } from '../../ai/client';
import { answerQuestion, dayReport, reportToText } from '../../sim/narrative';
import { fmtTime } from '../../sim/time';
import { AgentDot, Badge, Empty, Section } from '../common';
import { moodColor } from '../format';
import { useActiveReality } from '../hooks';

const QUESTIONS = ['Qu’est-il arrivé à Alice ?', 'Qui a rencontré qui ?', 'Quel événement a eu le plus d’impact ?', 'Qu’est-ce qui a changé entre les deux réalités ?'];

export function ReportPanel() {
  const reality = useActiveReality();
  const comparison = useSimStore((s) => s.comparison);
  const realityB = useSimStore((s) => s.realityB);
  const generation = useSimStore((s) => s.generation);
  const ai = useSimStore((s) => s.ai);
  const { selectEvent, seek, selectAgent } = useSimStore.getState();
  const cmp = realityB ? comparison : null;
  const report = useMemo(() => dayReport(reality, cmp), [reality, cmp, generation]);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<string | null>(null);
  const [narr, setNarr] = useState<{ busy: boolean; text?: string; error?: string }>({ busy: false });

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

  const narrate = async () => {
    setNarr({ busy: true });
    try {
      const res = await aiNarrate(reportToText(report), 'day');
      setNarr(res.ok ? { busy: false, text: res.text } : { busy: false, error: 'L’IA n’a pas pu produire de récit.' });
    } catch {
      setNarr({ busy: false, error: 'Service IA injoignable.' });
    }
  };

  return (
    <div className="report">
      <h3 className="report-title">{report.title}</h3>
      <p className="lead">{report.intro}</p>
      <div className="row gap wrap">
        <button className="btn sm" onClick={exportTxt} title="Télécharger le rapport au format texte">
          ⬇ Exporter (.txt)
        </button>
        {ai.enabled ? (
          <button className="btn sm accent" onClick={narrate} disabled={narr.busy} title="Réécrire le rapport en prose (l’IA reformule uniquement les faits enregistrés)">
            {narr.busy ? 'Narration en cours…' : '✒ Version narrée par l’IA'}
          </button>
        ) : (
          <span className="muted small">Narration IA désactivée (aucune clé API) — résumé factuel</span>
        )}
      </div>
      <p className="muted small">Le rapport couvre la journée entière (06:00 – 24:00), indépendamment de l’heure affichée.</p>
      {(narr.text || narr.error) && (
        <div className="narration">
          <div className="row gap center">
            <Badge tone="b">IA</Badge>
            <span className="muted small">L’IA reformule seulement les faits enregistrés ; elle n’invente aucun événement.</span>
          </div>
          {narr.error ? <div className="error">{narr.error}</div> : <div className="prose">{narr.text}</div>}
        </div>
      )}

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
          <Section key={s.title} title={s.title} count={s.items.filter((i) => i.t !== undefined || !i.text.startsWith('—')).length} defaultOpen={s.title === 'Vue chronologique' || s.title.startsWith('Ce qui a changé')}>
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
                        if (!it.eventId) return;
                        selectEvent(it.eventId);
                        if (it.t !== undefined) seek(it.t);
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
