/**
 * Quest alerts as the day unfolds (player mode).
 *
 * <AlertDriver/> computes the quest alerts of the displayed reality once per
 * generation (`questAlerts`), then listens to the clock outside React and
 * advances a cursor: each alert crossed during playback becomes a « live
 * alert » in the game UI store. Two views read that same list, so they always
 * agree: speech bubbles above the inhabitants (<AlertBubbles/>, positioned
 * every frame by render/Bubbles.tsx) and the bottom-left feed
 * (<GameAlertFeed/>). Alerts last ~6 s, at most four at a time; hovering the
 * feed holds them.
 */

import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { bubbleAnchors } from '../../render/Bubbles';
import { useGameUi, type LiveAlert } from '../../store/gameUi';
import { useSimStore } from '../../store/useSimStore';
import { QUEST_LINK_LABELS, questAlerts, type QuestAlert } from '../../sim/quest';
import { fmtTime } from '../../sim/time';
import { GRAVITY_LABELS, type AgentId } from '../../sim/types';
import { truncate } from '../drama';
import { eventTypeLabel, firstName } from '../format';
import { useActiveReality } from '../hooks';
import { advanceAlerts, alertAnchors, alertIndexAt } from './gestures';

/** How long an alert stays (real time, ms). */
export const ALERT_MS = 6000;
/** Exit animation (ms); must match `.quest-bubble.leaving` / `.drama-toast.leaving`. */
const ALERT_OUT_MS = 300;
/** Bubbles (and feed lines) on screen at once. */
export const MAX_ALERTS = 4;

let order = 0;

/** Quest alerts of the displayed reality, sorted by time (recomputed once per generation). */
export function useQuestAlertList(agentId: AgentId): QuestAlert[] {
  const reality = useActiveReality();
  const generation = useSimStore((s) => s.generation);
  return useMemo(() => [...questAlerts(reality, agentId)].sort((a, b) => a.event.t - b.event.t), [reality, agentId, generation]);
}

export function AlertDriver({ agentId }: { agentId: AgentId }) {
  const list = useQuestAlertList(agentId);
  const alerts = useGameUi((s) => s.alerts);
  const held = useGameUi((s) => s.held);

  useEffect(() => {
    useGameUi.getState().setAlerts(() => []);
    let last = Math.floor(useSimStore.getState().time);
    let idx = alertIndexAt(list, last);
    return useSimStore.subscribe((s, prev) => {
      const cur = Math.floor(s.time);
      if (cur === last) return;
      // The last tick of the day stops playback in the same update: count it as playback.
      const r = advanceAlerts(list, idx, last, cur, s.playing || prev.playing);
      last = cur;
      idx = r.idx;
      if (!r.fresh.length) return;
      const until = performance.now() + ALERT_MS;
      const fresh: LiveAlert[] = r.fresh.map((alert) => ({ key: alert.event.id, alert, until, order: ++order }));
      useGameUi.getState().setAlerts((as) => [...as.filter((x) => !fresh.some((f) => f.key === x.key)), ...fresh].slice(-MAX_ALERTS));
    });
  }, [list]);

  // Expiry: an alert first plays its exit animation, then is removed.
  useEffect(() => {
    if (held || !alerts.length) return;
    const next = Math.min(...alerts.map((x) => x.until));
    const timer = window.setTimeout(() => {
      const now = performance.now();
      useGameUi.getState().setAlerts((as) => as.flatMap((x) => (x.until > now + 20 ? [x] : x.leaving ? [] : [{ ...x, leaving: true, until: now + ALERT_OUT_MS }])));
    }, Math.max(0, next - performance.now()));
    return () => window.clearTimeout(timer);
  }, [alerts, held]);

  // Leaving the game (or the spectator) clears the bubbles.
  useEffect(() => () => useGameUi.getState().setAlerts(() => []), []);
  return null;
}

/** French tooltip of an alert: kind, gravity and link to the quest. */
function alertTitle(a: QuestAlert): string {
  const link = a.link !== 'none' ? ` · lié à votre quête : ${QUEST_LINK_LABELS[a.link]}` : '';
  return `${fmtTime(a.event.t)} — ${eventTypeLabel(a.event.type)} (${GRAVITY_LABELS[a.gravity]})${link}\n${a.event.label}`;
}

export function AlertBubbles() {
  const alerts = useGameUi((s) => s.alerts);
  return (
    <div className="bubble-layer">
      {alerts.map((a) => (
        <Bubble key={a.key} live={a} />
      ))}
    </div>
  );
}

function Bubble({ live }: { live: LiveAlert }) {
  const ref = useRef<HTMLDivElement>(null);
  const { alert } = live;
  const e = alert.event;
  const anchors = alertAnchors(e);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !anchors.length) return;
    const entry = { el, agents: anchors, order: live.order, h: (el.firstElementChild as HTMLElement | null)?.offsetHeight ?? 40 };
    bubbleAnchors.set(live.key, entry);
    return () => {
      if (bubbleAnchors.get(live.key) === entry) bubbleAnchors.delete(live.key);
    };
    // The anchors of an event never change: the key is enough.
  }, [live.key, live.order]);
  if (!anchors.length) return null;
  const select = () => useSimStore.getState().selectAgent(anchors[0]);
  return (
    <div ref={ref} className="quest-bubble-anchor" style={{ zIndex: live.order % 1000 }}>
      <button className={`quest-bubble g${alert.gravity} ${alert.link !== 'none' ? 'linked' : ''} ${live.leaving ? 'leaving' : ''}`} onClick={select} title={alertTitle(alert)}>
        <span className="quest-bubble-head">
          <span className="quest-bubble-time mono">{fmtTime(e.t)}</span>
          <span className="quest-bubble-who">{anchors.map(firstName).join(' & ')}</span>
        </span>
        <span className="quest-bubble-text">{truncate(e.label, 84)}</span>
        {alert.link !== 'none' && <span className="quest-bubble-link">lié à votre quête · {QUEST_LINK_LABELS[alert.link]}</span>}
      </button>
    </div>
  );
}

/** Bottom-left feed in player mode: the same live alerts as the bubbles. */
export function GameAlertFeed() {
  const alerts = useGameUi((s) => s.alerts);
  if (!alerts.length) return null;
  const { setHeld, setAlerts } = useGameUi.getState();
  const { selectAgent } = useSimStore.getState();
  return (
    <div
      className="drama-feed"
      role="log"
      aria-label="Alertes de votre quête"
      aria-live="polite"
      onMouseEnter={() => {
        setHeld(true);
        setAlerts((as) => as.map((x) => ({ ...x, leaving: false })));
      }}
      onMouseLeave={() => {
        setHeld(false);
        const until = performance.now() + 2500;
        setAlerts((as) => as.map((x) => ({ ...x, leaving: false, until: Math.max(x.until, until) })));
      }}
    >
      {alerts.slice(-3).map(({ key, alert, leaving }) => {
        const e = alert.event;
        const who = e.actors[0];
        return (
          <button key={key} className={`drama-toast glass quest-toast g${alert.gravity} ${alert.link !== 'none' ? 'linked' : ''} ${leaving ? 'leaving' : ''}`} onClick={() => who && selectAgent(who)} title={alertTitle(alert)}>
            <span className="quest-dot" aria-hidden />
            <span className="drama-toast-time mono">{fmtTime(e.t)}</span>
            <span className="drama-toast-kind">{eventTypeLabel(e.type)}</span>
            <span className="drama-toast-text">{truncate(e.label, 90)}</span>
          </button>
        );
      })}
    </div>
  );
}
