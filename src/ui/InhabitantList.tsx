/**
 * Left column: the twenty inhabitants with their live activity.
 */

import { memo, useEffect, useMemo, useState } from 'react';
import { useSimStore } from '../store/useSimStore';
import { AGENTS } from '../sim/population';
import type { AgentProfile, TraceAgent } from '../sim/types';
import { fold, locName, moodColor, moodWord } from './format';
import { useActiveReality, useMinute } from './hooks';

export function InhabitantList() {
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
          Habitants <span className="count">{list.length === AGENTS.length ? AGENTS.length : `${list.length}/${AGENTS.length}`}</span>
        </div>
        <div className={`reality-tag ${isB ? 'b' : ''}`} title={reality.def.name}>
          {isB ? 'Réalité B' : 'Réalité A'}
        </div>
      </div>
      <div className="search">
        <span aria-hidden>⌕</span>
        <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher un nom, un métier…" aria-label="Rechercher un habitant" />
        {q && (
          <button className="link" onClick={() => setQ('')} title="Effacer la recherche">
            ✕
          </button>
        )}
      </div>
      <ul className="agent-list" onMouseLeave={() => useSimStore.getState().hoverAgent(null)}>
        {list.map((a) => (
          <AgentCard key={a.id} a={a} tr={frame?.agents[a.id]} selected={selectedId === a.id} followed={followId === a.id} hovered={hoveredId === a.id} />
        ))}
        {!list.length && <li className="empty">Aucun habitant ne correspond.</li>}
      </ul>
    </div>
  );
}

const AgentCard = memo(function AgentCard({ a, tr, selected, followed, hovered }: { a: AgentProfile; tr?: TraceAgent; selected: boolean; followed: boolean; hovered: boolean }) {
  const { selectAgent, followAgent, hoverAgent } = useSimStore.getState();
  const where = tr ? (tr.riding ? 'Dans le bus' : locName(tr.loc)) : '—';
  const mood = tr?.mood ?? 0;
  return (
    <li
      className={`agent-card ${selected ? 'selected' : ''} ${hovered ? 'hovered' : ''} ${tr?.asleep ? 'asleep' : ''}`}
      onMouseEnter={() => hoverAgent(a.id)}
      onMouseLeave={() => useSimStore.getState().hoveredAgentId === a.id && hoverAgent(null)}
      onFocus={() => hoverAgent(a.id)}
      onBlur={() => useSimStore.getState().hoveredAgentId === a.id && hoverAgent(null)}
      style={{ ['--agent' as string]: a.color }}
    >
      <button className="agent-card-main" onClick={() => selectAgent(selected ? null : a.id)} title={`${a.name} — ${a.occupation}`}>
        <span className="agent-dot lg" style={{ background: a.color }} aria-hidden />
        <span className="agent-card-body">
          <span className="agent-card-line">
            <span className="agent-name">{a.firstName}</span>
            <span className="agent-age">{a.age} ans</span>
            <span className="mood-dot" style={{ background: moodColor(mood) }} title={`Humeur : ${moodWord(mood)} (${mood.toFixed(2)})`} />
          </span>
          <span className="agent-occ">{a.occupation}</span>
          <span className="agent-now">
            <span className="agent-act">{tr?.act ?? '—'}</span>
            <span className="agent-loc">· {where}</span>
          </span>
        </span>
      </button>
      <button
        className={`follow-btn ${followed ? 'on' : ''}`}
        onClick={() => followAgent(followed ? null : a.id)}
        title={followed ? `Ne plus suivre ${a.firstName}` : `Suivre ${a.firstName} avec la caméra`}
        aria-pressed={followed}
      >
        👁
      </button>
    </li>
  );
});
