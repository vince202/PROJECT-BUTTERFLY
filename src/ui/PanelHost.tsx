/**
 * Overlay drawer hosting the active panel above the 3D city.
 */

import { useSimStore, type PanelId } from '../store/useSimStore';
import { t } from '../i18n';
import { useLocale } from './hooks';
import { ButterflyPanel } from './panels/ButterflyPanel';
import { CausalExplorer } from './panels/CausalExplorer';
import { ComparePanel } from './panels/ComparePanel';
import { ReportPanel } from './panels/ReportPanel';

/** Icons of the panels; titles are `ui.topbar_panel_<id>` and subtitles `ui.panel_sub_<id>`. */
const ICONS: Record<Exclude<PanelId, null>, string> = { butterfly: '🦋', causal: '⛓', compare: '⇄', report: '📜' };

export function PanelHost() {
  useLocale();
  const panel = useSimStore((s) => s.panel);
  const setPanel = useSimStore((s) => s.setPanel);
  if (!panel) return null;
  const meta = { icon: ICONS[panel], title: t(`ui.topbar_panel_${panel}`), sub: t(`ui.panel_sub_${panel}`) };
  return (
    <aside className={`drawer drawer-${panel}`} role="dialog" aria-label={meta.title}>
      <header className="drawer-head">
        <span className="drawer-icon" aria-hidden>
          {meta.icon}
        </span>
        <div className="drawer-titles">
          <h2>{meta.title}</h2>
          <div className="drawer-sub">{meta.sub}</div>
        </div>
        <button className="icon-btn" onClick={() => setPanel(panel)} title={t('ui.panel_close')}>
          ✕
        </button>
      </header>
      <div className="drawer-body">
        {panel === 'butterfly' && <ButterflyPanel />}
        {panel === 'causal' && <CausalExplorer />}
        {panel === 'compare' && <ComparePanel />}
        {panel === 'report' && <ReportPanel />}
      </div>
    </aside>
  );
}
