/**
 * Overlay drawer hosting the active panel above the 3D city.
 */

import { useSimStore, type PanelId } from '../store/useSimStore';
import { ButterflyPanel } from './panels/ButterflyPanel';
import { CausalExplorer } from './panels/CausalExplorer';
import { ComparePanel } from './panels/ComparePanel';
import { ReportPanel } from './panels/ReportPanel';

const TITLES: Record<Exclude<PanelId, null>, { icon: string; title: string; sub: string }> = {
  butterfly: { icon: '🦋', title: 'Et si…', sub: 'Éditeur d’interventions' },
  causal: { icon: '⛓', title: 'Causalité', sub: 'Pourquoi, et avec quelles conséquences' },
  compare: { icon: '⇄', title: 'Comparer', sub: 'Réalité A face à réalité B' },
  report: { icon: '📜', title: 'Rapport', sub: 'Récit factuel de la journée' },
};

export function PanelHost() {
  const panel = useSimStore((s) => s.panel);
  const setPanel = useSimStore((s) => s.setPanel);
  if (!panel) return null;
  const meta = TITLES[panel];
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
        <button className="icon-btn" onClick={() => setPanel(panel)} title="Fermer le panneau (Échap)">
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
