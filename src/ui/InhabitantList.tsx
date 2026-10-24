/**
 * Left column: the twenty inhabitants with their live activity.
 */

import { memo, useEffect, useMemo, useState } from 'react';
import { useSimStore } from '../store/useSimStore';
import { AGENTS } from '../sim/population';
import type { AgentProfile, TraceAgent } from '../sim/types';
import { fold, locName, moodColor, moodWord } from './format';
import { useActiveReality, useLocale, useMinute } from './hooks';
import { t } from '../i18n';

export function InhabitantList() {
  useLocale();
  const reality = useActiveReality();
  const minute = useMinute();
  const selectedId = useSimStore((s) => s.selectedAgentId);
  const followId = useSimStore((s) => s.followAgentId);
  const hoveredId = useSimStore((s) => s.hoveredAgentId);
  const isB = useSimStore((s) => s.activeRealityId === 'B' && !!s.realityB);
  const [q, setQ] = useState('');
  // Never leave a stale hover behind when the list goes away (e.g. switching to spectator mode).
  useEffect(() => () => useSimStore.getState().hoverAgent(null), []);

  const frame = reality.frameAt(minute);
  const list = useMemo(() => {
    const f = fold(q.trim());
    if (!f) return AGENTS;
    return AGENTS.filter((a) => fold(`${a.name} ${a.occupation}`).includes(f));
  }, [q]);

  return (
    <div className="inhabitants">
      <div className="col-head">
        <div className="col-title">
          {t('ui.list_title')} <span className="count">{list.length === AGENTS.length ? AGENTS.length : `${list.length}/${AGENTS.length}`}</span>
        </div>
        <div className={`reality-tag ${isB ? 'b' : ''}`} title={reality.def.name}>
          {isB ? t('ui.reality_b_short') : t('ui.reality_a_short')}
        </div>
      </div>
      <div className="search">
        <span aria-hidden>⌕</span>
        <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('ui.list_search_placeholder')} aria-label={t('ui.list_search_aria')} />
        {q && (
          <button className="link" onClick={() => setQ('')} title={t('ui.list_search_clear')}>
            ✕
          </button>
        )}
      </div>
      <ul className="agent-list" onMouseLeave={() => useSimStore.getState().hoverAgent(null)}>
        {list.map((a) => (
          <AgentCard key={a.id} a={a} tr={frame?.agents[a.id]} selected={selectedId === a.id} followed={followId === a.id} hovered={hoveredId === a.id} />
        ))}
        {!list.length && <li className="empty">{t('ui.list_none')}</li>}
      </ul>
    </div>
  );
}

const AgentCard = memo(function AgentCard({ a, tr, selected, followed, hovered }: { a: AgentProfile; tr?: TraceAgent; selected: boolean; followed: boolean; hovered: boolean }) {
  useLocale();
  const { selectAgent, followAgent, hoverAgent } = useSimStore.getState();
  const where = tr ? (tr.riding ? t('ui.format_travel_riding') : locName(tr.loc)) : '—';
  const mood = tr?.mood ?? 0;
  // Activity labels often already name the place ("Travaille — Agence Horizon", "En chemin").
  const showWhere = !!tr && !fold(tr.act).includes(fold(where));
  return (
    <li
      className={`agent-card ${selected ? 'selected' : ''} ${hovered ? 'hovered' : ''} ${tr?.asleep ? 'asleep' : ''}`}
      onMouseEnter={() => hoverAgent(a.id)}
      onMouseLeave={() => useSimStore.getState().hoveredAgentId === a.id && hoverAgent(null)}
      onFocus={() => hoverAgent(a.id)}
      onBlur={() => useSimStore.getState().hoveredAgentId === a.id && hoverAgent(null)}
      style={{ ['--agent' as string]: a.color }}
    >
      <button className="agent-card-main" onClick={() => selectAgent(selected ? null : a.id)} title={t('ui.list_card_title', { name: a.name, occupation: a.occupation })}>
        <span className="agent-dot lg" style={{ background: a.color }} aria-hidden />
        <span className="agent-card-body">
          <span className="agent-card-line">
            <span className="agent-name">{a.firstName}</span>
            <span className="agent-age">{t('ui.list_age', { age: a.age })}</span>
            <span className="mood-dot" style={{ background: moodColor(mood) }} title={t('ui.list_mood_title', { mood: moodWord(mood), value: mood.toFixed(2) })} />
          </span>
          <span className="agent-occ">{a.occupation}</span>
          <span className="agent-now">
            <span className="agent-act">{tr?.act ?? '—'}</span>
            {showWhere && <span className="agent-loc"> · {where}</span>}
          </span>
        </span>
      </button>
      <button
        className={`follow-btn ${followed ? 'on' : ''}`}
        onClick={() => followAgent(followed ? null : a.id)}
        title={followed ? t('ui.list_follow_stop', { name: a.firstName }) : t('ui.list_follow', { name: a.firstName })}
        aria-pressed={followed}
      >
        👁
      </button>
    </li>
  );
});
