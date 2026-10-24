/**
 * Day report: factual narrative sections, per-inhabitant summaries, Q&A,
 * plain-text export and optional AI rephrasing (facts only).
 */

import { useMemo, useState } from 'react';
import { useSimStore } from '../../store/useSimStore';
import { aiNarrate, type NarrationStyle } from '../../ai/client';
import { answerQuestion, dayReport, reportToText } from '../../sim/narrative';
import { fmtTime } from '../../sim/time';
import { t } from '../../i18n';
import { AgentDot, AiButton, Empty, NarrationBox, Section, aiUnavailableTitle } from '../common';
import { counterfactualFacts, morningFacts } from '../drama';
import { moodColor } from '../format';
import { useActiveReality, useLocale } from '../hooks';

const QUESTION_KEYS = ['ui.report_q_alice', 'ui.report_q_who_met', 'ui.report_q_impact', 'ui.report_q_changed', 'ui.report_q_noe'];

const NARRATION_LABEL_KEYS: Partial<Record<NarrationStyle, string>> = {
  day: 'ui.report_narr_day',
  morning: 'ui.report_narr_morning',
  counterfactual: 'ui.report_narr_counterfactual',
};

/**
 * Sections open by default, by position in `dayReport(...).sections` (titles are
 * translated by the engine, so they cannot be matched by text): the arcs of the
 * day (0), the chronological overview (1) and, last, « what changed between the
 * two realities » (10, only when a reality B exists).
 */
const OPEN_SECTIONS = new Set([0, 1, 10]);

export function ReportPanel() {
  useLocale();
  const reality = useActiveReality();
  const comparison = useSimStore((s) => s.comparison);
  const realityB = useSimStore((s) => s.realityB);
  const generation = useSimStore((s) => s.generation);
  const ai = useSimStore((s) => s.ai);
  const lab = useSimStore((s) => s.uiMode === 'lab');
  const { selectEvent, seek, selectAgent, switchReality } = useSimStore.getState();
  /** Report items may cite events of the other reality (comparison section): switch to it first. */
  const openItem = (id: string, at?: number) => {
    if (!reality.eventById(id)) {
      const s = useSimStore.getState();
      if (s.realityB?.eventById(id) && s.activeRealityId !== 'B') switchReality('B');
      else if (s.realityA.eventById(id) && s.activeRealityId !== 'A') switchReality('A');
    }
    selectEvent(id);
    if (at !== undefined) seek(at);
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
    a.download = t('ui.report_filename', { seed: reality.seed, id: reality.def.id });
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
      setNarr(res.ok && res.text ? { style, busy: false, text: res.text } : { style, busy: false, error: t('ui.report_narr_failed') });
    } catch {
      setNarr({ style, busy: false, error: t('ui.ai_unreachable') });
    }
  };
  const off = aiUnavailableTitle(ai.message);

  return (
    <div className="report">
      <h3 className="report-title">{report.title}</h3>
      <p className="lead">{report.intro}</p>
      <div className="row gap wrap">
        <button className="btn sm" onClick={exportTxt} title={t('ui.report_export_title')}>
          {t('ui.report_export')}
        </button>
      </div>
      <div className="narr-group" role="group" aria-label={t('ui.report_narr_group')}>
        <span className="narr-group-k">{t('ui.report_narration')}</span>
        <AiButton enabled={ai.enabled} busy={narr.busy} onClick={() => narrate('day')} tone={narr.style === 'day' ? 'on' : ''} title={t('ui.report_day_title')} disabledTitle={off}>
          {narr.busy && narr.style === 'day' ? t('ui.report_writing') : t('ui.report_narr_day')}
        </AiButton>
        <AiButton enabled={ai.enabled} busy={narr.busy} onClick={() => narrate('morning')} tone={narr.style === 'morning' ? 'on' : ''} title={t('ui.report_morning_title')} disabledTitle={off}>
          {narr.busy && narr.style === 'morning' ? t('ui.report_writing') : t('ui.report_narr_morning')}
        </AiButton>
        <AiButton
          enabled={ai.enabled && !!cmp}
          busy={narr.busy}
          onClick={() => narrate('counterfactual')}
          tone={narr.style === 'counterfactual' ? 'on' : ''}
          title={t('ui.report_counterfactual_title')}
          disabledTitle={!ai.enabled ? off : t('ui.report_counterfactual_disabled')}
        >
          {narr.busy && narr.style === 'counterfactual' ? t('ui.report_writing') : t('ui.report_narr_counterfactual')}
        </AiButton>
      </div>
      {!ai.enabled && <p className="muted small">{t('ui.report_ai_off')}</p>}
      <p className="muted small">{t('ui.report_scope')}</p>
      <NarrationBox label={NARRATION_LABEL_KEYS[narr.style ?? 'day'] ? t(NARRATION_LABEL_KEYS[narr.style ?? 'day']!) : t('ui.report_narr_default')} busy={narr.busy} text={narr.text} error={narr.error} />

      <Section title={t('ui.report_ask')}>
        <form
          className="row gap"
          onSubmit={(e) => {
            e.preventDefault();
            ask(question);
          }}
        >
          <input className="input grow" value={question} onChange={(e) => setQuestion(e.target.value)} placeholder={t('ui.report_ask_placeholder')} aria-label={t('ui.report_ask_aria')} />
          <button className="btn primary sm" type="submit" disabled={!question.trim()}>
            {t('ui.report_ask_button')}
          </button>
        </form>
        <div className="chips examples">
          {QUESTION_KEYS.map((k) => (
            <button key={k} className="chip" onClick={() => ask(t(k))}>
              {t(k)}
            </button>
          ))}
        </div>
        {answer && <div className="answer prose">{answer}</div>}
      </Section>

      {report.sections.map((s, si) =>
        s.items.length ? (
          <Section key={s.title} title={s.title} count={s.items.filter((i) => i.t !== undefined || !i.text.startsWith('—')).length} defaultOpen={OPEN_SECTIONS.has(si)}>
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
                      title={clickable ? t('ui.report_item_title') : undefined}
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

      <Section title={t('ui.report_agents')} count={report.perAgent.length} defaultOpen={false}>
        {report.perAgent.length ? (
          <div className="accordion">
            {report.perAgent.map((a) => (
              <details key={a.agentId} className="acc-item">
                <summary>
                  <AgentDot id={a.agentId} />
                  <span className="strong">{a.name}</span>
                  <span className="muted small grow">{a.headline}</span>
                  <span className="mono small" title={t('ui.report_mood_title')}>
                    <span style={{ color: moodColor(a.moodStart) }}>{a.moodStart.toFixed(2)}</span> → <span style={{ color: moodColor(a.moodEnd) }}>{a.moodEnd.toFixed(2)}</span>
                  </span>
                </summary>
                <div className="acc-body">
                  <p>{a.paragraph}</p>
                  {a.objectives.length > 0 && (
                    <>
                      <div className="sub-title">{t('ui.report_objectives')}</div>
                      <ul className="plain small">
                        {a.objectives.map((o, i) => (
                          <li key={i}>
                            {o.label} — <span className={o.state === 'done' ? 'pos' : o.state === 'missed' ? 'neg' : 'muted'}>{o.status}</span>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                  {a.unresolved.length > 0 && (
                    <>
                      <div className="sub-title">{t('ui.report_unresolved')}</div>
                      <ul className="plain small">
                        {a.unresolved.map((u, i) => (
                          <li key={i}>{u}</li>
                        ))}
                      </ul>
                    </>
                  )}
                  <button className="link small" onClick={() => selectAgent(a.agentId)}>
                    {t('ui.report_open_sheet')}
                  </button>
                </div>
              </details>
            ))}
          </div>
        ) : (
          <Empty>{t('ui.report_no_agents')}</Empty>
        )}
      </Section>
    </div>
  );
}
