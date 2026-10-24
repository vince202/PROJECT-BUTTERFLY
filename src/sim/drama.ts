/**
 * Dramaturgy layer: every inhabitant carries a daily arc — a desire, a secret, a
 * tension and a deadline. The engine turns ordinary events into *beats* and
 * *turning points* (fulfilled / failed / twisted arcs, revelations, gossip,
 * dilemmas), each recorded as a causal event. Arcs also bend decisions a little
 * (« Désir du jour » score component) so that stakes change behaviour, and they
 * chain across days: a fulfilled arc gives way to the next one, a failed arc is
 * attempted again with higher stakes.
 *
 * Everything here is data + pure functions; the engine owns the state and emits
 * the events. No randomness happens in this module except through the `chance`
 * callback handed in by the engine (seeded, keyed streams).
 */

import type {
  AgentId,
  AgentProfile,
  AgentState,
  ArcSeed,
  ArcState,
  Candidate,
  Intervention,
  Minute,
  ScoreComponent,
  SimEvent,
  WorldState,
} from './types';
import { DAY_END } from './types';
import { agree } from './population';

const h = (hh: number, mm = 0): Minute => hh * 60 + mm;

// ---------------------------------------------------------------------------
// Arc seeds: ordered per inhabitant (day 1 first, then the following days)
// ---------------------------------------------------------------------------

export const ARC_SEEDS: ArcSeed[] = [
  // Alice
  { id: 'arc_alice_campagne', agentId: 'alice', kind: 'ambition', title: 'Parler à Thomas de la campagne', desire: 'Trouver le moment de parler à Thomas du projet de la nouvelle campagne.', secret: 'Alice a reçu une offre d’une agence concurrente et n’a rien dit.', secretAbout: 'thomas', tension: 'Si Thomas apprend l’offre avant qu’elle lui parle, il la croira déjà partie.', deadline: h(19), stakes: 0.7, goal: { type: 'talk_to', target: 'thomas', deep: true }, fate: [] },
  { id: 'arc_alice_sophie', agentId: 'alice', kind: 'care', title: 'Une vraie soirée avec Sophie', desire: 'Retrouver Sophie au café après le travail, sans parler boulot.', tension: 'Entre les horaires de l’agence et ceux de la bibliothèque, les soirées communes sont rares.', deadline: h(23), stakes: 0.5, goal: { type: 'be_at', locationId: 'cafe', withAgent: 'sophie', after: h(18) } },
  // Martin
  { id: 'arc_martin_cafe', agentId: 'martin', kind: 'courage', title: 'Sortir de la routine', desire: 'S’autoriser, pour une fois, un café au Papillon au lieu de la bibliothèque.', secret: 'Martin note depuis vingt ans les horaires réels du bus dans un carnet.', secretAbout: 'julien', tension: 'Le dossier de la mairie et le bilan trimestriel lui laissent peu de marge.', deadline: h(22), stakes: 0.45, goal: { type: 'be_at', locationId: 'cafe', after: h(12) } },
  { id: 'arc_martin_mairie', agentId: 'martin', kind: 'duty', title: 'Le dossier de la mairie', desire: 'Déposer le dossier à la mairie avant la fermeture du guichet.', tension: 'Le guichet ferme tôt et le bureau ne le libère jamais à l’heure.', deadline: h(17, 10), stakes: 0.6, goal: { type: 'commitment', commitmentId: 'c_martin_townhall' } },
  // Sophie
  { id: 'arc_sophie_page', agentId: 'sophie', kind: 'reconciliation', title: 'Tourner la page', desire: 'Passer la journée sans croiser Julien — ou le croiser sans se laisser troubler.', secret: 'Sophie garde encore toutes les lettres de Julien dans le tiroir du bureau.', secretAbout: 'julien', tension: 'Julien traîne au café et à la gare, deux endroits sur son chemin.', stakes: 0.65, goal: { type: 'avoid', target: 'julien' }, fate: [{ kind: 'force_action', agentId: 'julien', t: h(14), action: 'read_library', locationId: 'library', description: 'Julien vient faire des recherches à la bibliothèque où travaille Sophie', gravity: 1 }] },
  { id: 'arc_sophie_club', agentId: 'sophie', kind: 'duty', title: 'Le club de lecture', desire: 'Préparer le club de lecture avec Inès sans se faire attendre.', tension: 'Inès est ponctuelle, pas Sophie.', deadline: h(11, 30), stakes: 0.5, goal: { type: 'commitment', commitmentId: 'c_ines_sophie_club' } },
  // Julien
  { id: 'arc_julien_sophie', agentId: 'julien', kind: 'romance', title: 'Revoir Sophie', desire: 'Croiser Sophie « par hasard » et lui parler vraiment.', secret: 'L’article de Julien accuse la Ligne 1 de retards chroniques sans aucune preuve.', secretAbout: 'antoine', tension: 'Sophie l’évite, et Antoine, qu’il doit interviewer, ne doit rien savoir de l’article.', deadline: h(22), stakes: 0.7, goal: { type: 'talk_to', target: 'sophie', deep: true } },
  { id: 'arc_julien_interview', agentId: 'julien', kind: 'ambition', title: 'L’interview d’Antoine', desire: 'Obtenir enfin l’interview du chauffeur de la Ligne 1.', tension: 'Antoine se méfie des journalistes et Julien n’est jamais à l’heure.', deadline: h(15, 30), stakes: 0.6, goal: { type: 'commitment', commitmentId: 'c_julien_antoine' } },
  // Camille
  { id: 'arc_camille_fournee', agentId: 'camille', kind: 'pride', title: 'Vendre toute la fournée', desire: 'Fermer boutique avec les étagères vides avant quatorze heures.', secret: 'Camille songe à vendre la boulangerie et n’en a parlé à personne.', secretAbout: 'lucie', tension: 'Si Lucie, sa meilleure cliente, l’apprend par la rumeur, elle se sentira trahie.', deadline: h(14), stakes: 0.55, goal: { type: 'sell_out', locationId: 'bakery' } },
  { id: 'arc_camille_pause', agentId: 'camille', kind: 'care', title: 'Une vraie pause', desire: 'S’asseoir au parc une fois la boutique fermée.', tension: 'Il y a toujours une raison de rester au four.', deadline: h(19), stakes: 0.4, goal: { type: 'be_at', locationId: 'park', after: h(14) } },
  // Hugo
  { id: 'arc_hugo_ines', agentId: 'hugo', kind: 'curiosity', title: 'Comprendre Inès', desire: 'Comprendre pourquoi Inès vient tous les jours au café.', secret: 'Hugo a raté le concours de barista et l’a caché à Karim.', secretAbout: 'karim', tension: 'Karim croit qu’il a réussi ; la vérité finira par circuler.', deadline: h(22), stakes: 0.6, goal: { type: 'talk_to', target: 'ines', deep: true, after: h(15) } },
  { id: 'arc_hugo_sport', agentId: 'hugo', kind: 'duty', title: 'La séance avec Karim', desire: 'Ne pas poser un lapin à Karim à la salle.', tension: 'Après le service, la fatigue gagne souvent.', deadline: h(19), stakes: 0.5, goal: { type: 'commitment', commitmentId: 'c_hugo_karim_gym' } },
  // Léa
  { id: 'arc_lea_heure', agentId: 'lea', kind: 'courage', title: 'À l’heure au lycée', desire: 'Arriver à l’heure au lycée, pour une fois.', secret: 'Léa a un faible pour Hugo, le barista.', secretAbout: 'hugo', tension: 'Le bus de 8 h 10 n’attend personne, et Léa part toujours au dernier moment.', deadline: h(9), stakes: 0.6, goal: { type: 'on_time', commitmentId: 'w_lea' }, fate: [{ kind: 'agent_delay', agentId: 'lea', t: h(7, 50), minutes: 45, description: 'Léa ne retrouve pas son sac de cours et rate le bus', gravity: 1, requires: 'home' }] },
  { id: 'arc_lea_noe', agentId: 'lea', kind: 'care', title: 'Retrouver Noé', desire: 'Retrouver Noé au parc après les cours.', tension: 'Noé a quelque chose à lui dire et elle le sent.', deadline: h(18), stakes: 0.55, goal: { type: 'commitment', commitmentId: 'c_lea_noe_park' } },
  // Nadia
  { id: 'arc_nadia_yasmine', agentId: 'nadia', kind: 'care', title: 'Le café avec Yasmine', desire: 'Finir les consultations à l’heure pour retrouver Yasmine.', secret: 'Nadia a reçu une proposition de poste à l’hôpital de la grande ville.', secretAbout: 'lea', tension: 'Léa ne sait pas qu’un déménagement se discute.', deadline: h(20, 30), stakes: 0.65, goal: { type: 'commitment', commitmentId: 'c_nadia_yasmine_cafe' }, fate: [{ kind: 'agent_delay', agentId: 'nadia', t: h(18, 45), minutes: 75, description: 'Une urgence retient Nadia au cabinet', gravity: 2 }] },
  { id: 'arc_nadia_lea', agentId: 'nadia', kind: 'care', title: 'Du temps avec Léa', desire: 'Passer un moment avec Léa, hors des reproches sur les retards.', tension: 'Les horaires du cabinet et du lycée se croisent rarement.', deadline: h(23), stakes: 0.5, goal: { type: 'talk_to', target: 'lea', deep: true, after: h(17) } },
  // Noé
  { id: 'arc_noe_lea', agentId: 'noe', kind: 'courage', title: 'Parler à Léa de ses projets', desire: 'Oser dire à Léa qu’il veut partir étudier l’astronomie.', secret: 'Noé a été admis à l’école d’astronomie, loin d’ici, pour l’an prochain.', secretAbout: 'lea', tension: 'Si Léa l’apprend par quelqu’un d’autre, elle ne lui pardonnera pas.', deadline: h(21), stakes: 0.75, goal: { type: 'talk_to', target: 'lea', deep: true, after: h(16, 30) }, fate: [{ kind: 'stay_home', agentId: 'lea', t: h(17, 40), until: DAY_END, description: 'Léa est privée de sortie ce soir', gravity: 1 }] },
  { id: 'arc_noe_livre', agentId: 'noe', kind: 'curiosity', title: 'Le livre d’astronomie', desire: 'Emprunter le livre d’astronomie avant la fermeture.', tension: 'La bibliothèque ferme et le contrôle de maths approche.', deadline: h(18, 10), stakes: 0.45, goal: { type: 'commitment', commitmentId: 'c_noe_book' } },
  // Gérard
  { id: 'arc_gerard_petanque', agentId: 'gerard', kind: 'care', title: 'La pétanque avec Paul', desire: 'Être au parc à quinze heures pour la partie avec Paul.', secret: 'Le médecin a conseillé à Gérard de ne plus prendre le bus seul.', secretAbout: 'noe', tension: 'Noé s’inquiéterait ; Gérard préfère se taire.', deadline: h(16, 30), stakes: 0.6, goal: { type: 'commitment', commitmentId: 'c_petanque' }, fate: [{ kind: 'agent_delay', agentId: 'paul', t: h(14, 35), minutes: 65, description: 'Une commande urgente retient Paul à l’atelier', gravity: 1 }] },
  { id: 'arc_gerard_pain', agentId: 'gerard', kind: 'care', title: 'Du pain frais pour Noé', desire: 'Rapporter du pain chaud à la maison.', tension: 'Camille ferme dès la dernière baguette vendue.', deadline: h(14), stakes: 0.4, goal: { type: 'be_at', locationId: 'bakery' } },
  // Yasmine
  { id: 'arc_yasmine_fleurs', agentId: 'yasmine', kind: 'duty', title: 'Des fleurs pour la classe', desire: 'Passer chez Chloé à midi pour les fleurs de la sortie scolaire.', secret: 'Yasmine a été approchée pour diriger l’école.', secretAbout: 'nadia', tension: 'La pause de midi est courte et Chloé déborde toujours.', deadline: h(13), stakes: 0.55, goal: { type: 'commitment', commitmentId: 'c_yasmine_flowers' }, fate: [{ kind: 'force_action', agentId: 'chloe', t: h(11, 45), action: 'stroll', locationId: 'townhall', description: 'Chloé part livrer des bouquets à la mairie', gravity: 1 }, { kind: 'agent_delay', agentId: 'chloe', t: h(11, 58), minutes: 40, description: 'La livraison de Chloé s’éternise à la mairie', gravity: 1 }] },
  { id: 'arc_yasmine_nadia', agentId: 'yasmine', kind: 'care', title: 'Décompresser avec Nadia', desire: 'Retrouver Nadia au café le soir.', tension: 'Nadia finit toujours tard.', deadline: h(21), stakes: 0.5, goal: { type: 'commitment', commitmentId: 'c_nadia_yasmine_cafe' } },
  // Thomas
  { id: 'arc_thomas_lucie', agentId: 'thomas', kind: 'ambition', title: 'Déjeuner chez Lucie', desire: 'Déjeuner chez Lucie et lui proposer un partenariat pour l’agence.', secret: 'L’Agence Horizon a perdu son plus gros client la semaine dernière.', secretAbout: 'alice', tension: 'Si l’équipe l’apprend par la rumeur, le moral s’effondre.', deadline: h(14), stakes: 0.6, goal: { type: 'commitment', commitmentId: 'c_thomas_lunch' }, fate: [{ kind: 'agent_delay', agentId: 'thomas', t: h(12, 10), minutes: 85, description: 'Une réunion s’éternise pour Thomas', gravity: 1 }] },
  { id: 'arc_thomas_equipe', agentId: 'thomas', kind: 'pride', title: 'Parler à Martin', desire: 'Prendre le temps de parler à Martin autrement que par des chiffres.', tension: 'Thomas ne sait parler que de résultats.', deadline: h(19), stakes: 0.45, goal: { type: 'talk_to', target: 'martin', deep: true } },
  // Inès
  { id: 'arc_ines_hugo', agentId: 'ines', kind: 'romance', title: 'Oser parler à Hugo', desire: 'Avoir, enfin, une vraie conversation avec Hugo.', secret: 'Le mémoire d’Inès porte sur l’histoire du Café Le Papillon.', secretAbout: 'hugo', tension: 'Le café est plein, Hugo est pris, et le budget d’Inès ne permet pas dix cafés.', deadline: h(22), stakes: 0.75, goal: { type: 'talk_to', target: 'hugo', deep: true, after: h(15) }, fate: [{ kind: 'stay_home', agentId: 'ines', t: h(15), until: h(18), description: 'Inès doit rendre un chapitre de mémoire avant 18 h', gravity: 1 }] },
  { id: 'arc_ines_budget', agentId: 'ines', kind: 'duty', title: 'Tenir le budget', desire: 'Finir la journée avec au moins 15 € en poche.', tension: 'Chaque café est un choix.', stakes: 0.5, goal: { type: 'money_floor', min: 15 } },
  // Paul
  { id: 'arc_paul_commode', agentId: 'paul', kind: 'pride', title: 'Livrer la commode', desire: 'Remettre enfin sa commode à Mireille.', secret: 'Paul a sculpté un cadeau pour Camille qu’il n’ose pas lui donner.', secretAbout: 'camille', tension: 'Mireille raconte tout ; un secret confié à l’atelier fait le tour du quartier.', deadline: h(12), stakes: 0.55, goal: { type: 'commitment', commitmentId: 'c_mireille_dresser' }, fate: [{ kind: 'agent_delay', agentId: 'mireille', t: h(10, 15), minutes: 100, description: 'Mireille s’attarde à bavarder et oublie l’heure', gravity: 1 }] },
  { id: 'arc_paul_camille', agentId: 'paul', kind: 'courage', title: 'Parler à Camille', desire: 'Passer à la boulangerie et parler à Camille d’autre chose que de pain.', tension: 'Paul parle peu, et Camille est toujours occupée.', deadline: h(14), stakes: 0.5, goal: { type: 'talk_to', target: 'camille', deep: true } },
  // Chloé
  { id: 'arc_chloe_diner', agentId: 'chloe', kind: 'romance', title: 'Le dîner avec Antoine', desire: 'Dîner avec Antoine à l’heure, pour une fois.', secret: 'Chloé a réservé des vacances surprise pour Antoine.', secretAbout: 'antoine', tension: 'Antoine rentre rarement à l’heure annoncée et Mireille adore les surprises… des autres.', deadline: h(21, 30), stakes: 0.65, goal: { type: 'commitment', commitmentId: 'c_chloe_antoine_dinner' }, fate: [{ kind: 'force_action', agentId: 'antoine', t: h(19, 10), action: 'workout', locationId: 'gym', description: 'Antoine file à la salle retrouver Karim', gravity: 1 }, { kind: 'agent_delay', agentId: 'antoine', t: h(19, 25), minutes: 80, description: 'Antoine s’attarde à la salle avec Karim', gravity: 1 }] },
  { id: 'arc_chloe_mairie', agentId: 'chloe', kind: 'duty', title: 'Les bouquets de la mairie', desire: 'Livrer les bouquets à la mairie dans l’après-midi.', tension: 'La boutique ne se garde pas toute seule.', deadline: h(18), stakes: 0.45, goal: { type: 'be_at', locationId: 'townhall' } },
  // Antoine
  { id: 'arc_antoine_diner', agentId: 'antoine', kind: 'romance', title: 'Rentrer pour le dîner', desire: 'Être à la Villa Rosa à vingt heures pour Chloé.', tension: 'Entre l’interview et la salle de sport, la soirée file.', deadline: h(21, 30), stakes: 0.55, goal: { type: 'commitment', commitmentId: 'c_chloe_antoine_dinner' } },
  { id: 'arc_antoine_horaire', agentId: 'antoine', kind: 'pride', title: 'Tenir l’horaire', desire: 'Finir le service sans retard de plus de deux minutes.', secret: 'Antoine a postulé pour conduire le car régional, loin de la ville.', secretAbout: 'chloe', tension: 'Un journaliste guette les retards et Chloé ignore la candidature.', deadline: h(14), stakes: 0.6, goal: { type: 'bus_on_time', busId: 'L1-1', maxDelay: 3 } },
  // Mireille
  { id: 'arc_mireille_nouvelles', agentId: 'mireille', kind: 'curiosity', title: 'Tout savoir', desire: 'Parler à au moins cinq personnes différentes avant le soir.', secret: 'Mireille a écrit anonymement au journal au sujet des retards du bus.', secretAbout: 'antoine', tension: 'Si Antoine l’apprend, il ne lui adressera plus la parole dans le bus.', deadline: h(20), stakes: 0.5, goal: { type: 'conversations', min: 10 }, fate: [{ kind: 'stay_home', agentId: 'mireille', t: h(15), until: h(18, 30), description: 'Mireille attend le plombier tout l’après-midi', gravity: 1 }, { kind: 'weather', t: h(14), condition: 'rain', until: h(17, 30), description: 'Une averse vide le parc et les terrasses', gravity: 1 }] },
  { id: 'arc_mireille_commode', agentId: 'mireille', kind: 'pride', title: 'Récupérer la commode', desire: 'Rapporter enfin la commode promise depuis trois semaines.', tension: 'Paul n’est pas pressé et Mireille s’arrête pour parler à tout le monde.', deadline: h(12), stakes: 0.5, goal: { type: 'commitment', commitmentId: 'c_mireille_dresser' } },
  // Karim
  { id: 'arc_karim_hugo', agentId: 'karim', kind: 'care', title: 'Entraîner Hugo', desire: 'Tenir la séance avec Hugo à la salle.', secret: 'Le Gymnase Central risque de fermer faute d’abonnés.', secretAbout: 'hugo', tension: 'Hugo ne doit pas s’inquiéter avant le concours.', deadline: h(19), stakes: 0.55, goal: { type: 'commitment', commitmentId: 'c_hugo_karim_gym' }, fate: [{ kind: 'force_action', agentId: 'hugo', t: h(16, 20), action: 'coffee', locationId: 'cafe', description: 'Hugo est rappelé au café : un collègue manque', gravity: 0 }, { kind: 'agent_delay', agentId: 'hugo', t: h(16, 30), minutes: 85, description: 'Hugo doit tenir le comptoir jusqu’au soir', gravity: 1 }] },
  { id: 'arc_karim_parc', agentId: 'karim', kind: 'pride', title: 'Courir au parc', desire: 'Courir au parc avant d’ouvrir la salle.', tension: 'Le réveil est dur quand la salle ferme tard.', deadline: h(10), stakes: 0.4, goal: { type: 'be_at', locationId: 'park' } },
  // Élodie
  { id: 'arc_elodie_rien_perdre', agentId: 'elodie', kind: 'courage', title: 'Ne rien perdre aujourd’hui', desire: 'Rentrer le soir avec son portefeuille.', secret: 'Élodie a écrit à Alice une lettre qu’elle n’a jamais envoyée.', secretAbout: 'alice', tension: 'La distraction d’Élodie est légendaire au Marché Plus.', stakes: 0.5, goal: { type: 'keep_wallet' }, fate: [{ kind: 'lose_item', agentId: 'elodie', t: h(12, 35), item: 'wallet', description: 'Élodie pose son portefeuille sur le comptoir et l’oublie', gravity: 1 }] },
  { id: 'arc_elodie_alice', agentId: 'elodie', kind: 'courage', title: 'Parler à Alice', desire: 'Trouver le courage de parler à sa voisine Alice.', tension: 'Alice est toujours pressée, Élodie toujours timide.', deadline: h(23), stakes: 0.6, goal: { type: 'talk_to', target: 'alice', deep: true } },
  // Lucie
  { id: 'arc_lucie_pain', agentId: 'lucie', kind: 'duty', title: 'Le pain du restaurant', desire: 'Passer chez Camille chercher le pain avant le service.', secret: 'Chez Lucie perd de l’argent depuis trois mois.', secretAbout: 'thomas', tension: 'Thomas veut parler partenariat ; il ne doit pas croire le restaurant fragile.', deadline: h(11, 30), stakes: 0.55, goal: { type: 'commitment', commitmentId: 'c_lucie_bread' }, fate: [{ kind: 'agent_delay', agentId: 'lucie', t: h(9), minutes: 100, description: 'Lucie attend une livraison qui n’arrive pas', gravity: 1, requires: 'public' }] },
  { id: 'arc_lucie_parc', agentId: 'lucie', kind: 'care', title: 'Une pause au parc', desire: 'S’offrir une pause au parc entre deux services.', tension: 'Le restaurant ne laisse jamais de répit.', deadline: h(18), stakes: 0.4, goal: { type: 'be_at', locationId: 'park', after: h(14) } },
];

export function arcSeedsOf(agentId: AgentId): ArcSeed[] {
  return ARC_SEEDS.filter((s) => s.agentId === agentId);
}

export function arcSeed(seedId: string): ArcSeed {
  const s = ARC_SEEDS.find((x) => x.id === seedId);
  if (!s) throw new Error(`Unknown arc seed ${seedId}`);
  return s;
}

export const ARC_KIND_LABELS: Record<ArcSeed['kind'], string> = {
  romance: 'Cœur',
  ambition: 'Ambition',
  reconciliation: 'Réconciliation',
  duty: 'Devoir',
  curiosity: 'Curiosité',
  courage: 'Courage',
  care: 'Attachement',
  pride: 'Fierté',
};

export const ARC_STATUS_LABELS: Record<ArcState['status'], string> = {
  open: 'en suspens',
  advancing: 'en marche',
  fulfilled: 'accompli',
  failed: 'échoué',
  twisted: 'bouleversé',
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

function newArcState(seed: ArcSeed, attempt = 1): ArcState {
  return { id: seed.id, agentId: seed.agentId, seedId: seed.id, status: 'open', progress: 0, beats: [], knownBy: [], count: 0, attempt };
}

/** Arcs of day 1: the first seed of every inhabitant. */
export function initialArcs(): Record<string, ArcState> {
  const out: Record<string, ArcState> = {};
  const seen = new Set<AgentId>();
  for (const s of ARC_SEEDS) {
    if (seen.has(s.agentId)) continue;
    seen.add(s.agentId);
    out[s.id] = newArcState(s);
  }
  return out;
}

/**
 * Arcs of the next day: a fulfilled or twisted arc gives way to the inhabitant's
 * next seed (cycling); a failed arc is attempted again with the attempt counter
 * raised (stakes grow). Knowledge of secrets persists.
 */
export function nextDayArcs(prev: Record<string, ArcState>): Record<string, ArcState> {
  const out: Record<string, ArcState> = {};
  for (const arc of Object.values(prev)) {
    const seeds = arcSeedsOf(arc.agentId);
    if (!seeds.length) continue;
    const idx = seeds.findIndex((s) => s.id === arc.seedId);
    if (arc.status === 'failed' && arc.attempt < 3) {
      out[arc.id] = { ...newArcState(seeds[idx], arc.attempt + 1), knownBy: [...arc.knownBy] };
    } else {
      const next = seeds[(idx + 1) % seeds.length];
      out[next.id] = { ...newArcState(next), knownBy: next.id === arc.seedId ? [...arc.knownBy] : [] };
    }
  }
  return out;
}

/** The day's coups du sort: the fate of every arc in play, as scheduled interventions without observer. */
export function fateOf(arcs: Record<string, ArcState>): Intervention[] {
  const out: Intervention[] = [];
  for (const arc of Object.values(arcs)) {
    const seed = arcSeed(arc.seedId);
    (seed.fate ?? []).forEach((f, i) => out.push({ ...f, id: `fate_${seed.id}_${i}` } as Intervention));
  }
  return out.sort((a, b) => a.t - b.t || a.id.localeCompare(b.id));
}

export function arcOf(world: WorldState, agentId: AgentId): ArcState | undefined {
  return Object.values(world.arcs ?? {}).find((a) => a.agentId === agentId);
}

export function effectiveStakes(arc: ArcState): number {
  return Math.min(1, arcSeed(arc.seedId).stakes + 0.15 * (arc.attempt - 1));
}

export function arcDeadline(arc: ArcState): Minute {
  return arcSeed(arc.seedId).deadline ?? DAY_END - 1;
}

function isOpen(arc: ArcState): boolean {
  return arc.status === 'open' || arc.status === 'advancing';
}

// ---------------------------------------------------------------------------
// Beats: what an event means for an arc
// ---------------------------------------------------------------------------

export type BeatOutcome = 'fulfilled' | 'failed' | 'twisted';

export interface Beat {
  arc: ArcState;
  /** Progress reached (0..1). */
  progress: number;
  /** Set when the beat resolves the arc. */
  outcome?: BeatOutcome;
  /** French sentence describing the beat. */
  text: string;
  /** How the event produced the beat. */
  mechanism: string;
  /** Importance for the emitted event. */
  importance: number;
}

function firstName(profiles: Map<AgentId, AgentProfile>, id: AgentId): string {
  return profiles.get(id)?.firstName ?? id;
}

/**
 * Evaluate an event against an open arc. Returns a beat when the event moves
 * the arc, or null. Pure: does not mutate the arc.
 */
export function evaluateBeat(arc: ArcState, ev: SimEvent, world: WorldState, profiles: Map<AgentId, AgentProfile>): Beat | null {
  if (!isOpen(arc)) return null;
  if (ev.type === 'arc_beat' || ev.type === 'arc_resolved' || ev.type === 'dilemma') return null;
  const seed = arcSeed(arc.seedId);
  const g = seed.goal;
  const me = arc.agentId;
  const name = firstName(profiles, me);
  const involved = ev.actors.includes(me);
  const social = ev.type === 'encounter' || ev.type === 'conversation' || ev.type === 'argument';

  switch (g.type) {
    case 'talk_to': {
      if (!involved || !social || !ev.actors.includes(g.target)) return null;
      if (g.after !== undefined && ev.t < g.after) return null;
      const other = firstName(profiles, g.target);
      if (ev.type === 'argument') return { arc, progress: 0.4, text: `${name} a parlé à ${other}, mais sur le ton de la dispute`, mechanism: 'La rencontre a tourné à l’accrochage', importance: 0.6 };
      if (!g.deep || ev.type === 'conversation') return { arc, progress: 1, outcome: 'fulfilled', text: `${name} a enfin ${g.deep ? 'eu une vraie conversation avec' : 'parlé à'} ${other}`, mechanism: g.deep ? 'Une conversation profonde a eu lieu' : 'Les deux se sont parlé', importance: 0.85 };
      if (arc.progress >= 0.5) return null;
      return { arc, progress: 0.5, text: `${name} a croisé ${other} et échangé quelques mots, sans aller plus loin`, mechanism: 'Simple échange : le vrai sujet n’a pas été abordé', importance: 0.55 };
    }
    case 'avoid': {
      if (!involved || !social || !ev.actors.includes(g.target)) return null;
      const other = firstName(profiles, g.target);
      if (ev.type === 'conversation') return { arc, progress: 1, outcome: 'twisted', text: `${name} voulait éviter ${other}… et ils se sont parlé longuement`, mechanism: 'La rencontre évitée a eu lieu et a tout changé', importance: 0.95 };
      if (ev.type === 'argument') return { arc, progress: 1, outcome: 'failed', text: `${name} n’a pas pu éviter ${other} : la rencontre a tourné à la dispute`, mechanism: 'Rencontre non souhaitée, conflictuelle', importance: 0.9 };
      return { arc, progress: 0.6, outcome: 'failed', text: `${name} a croisé ${other} malgré tout et n’a pas su quoi dire`, mechanism: 'Présents au même endroit au même moment', importance: 0.7 };
    }
    case 'commitment': {
      if (ev.data?.commitmentId !== g.commitmentId) return null;
      if (ev.type === 'meeting_start' && involved) return { arc, progress: 0.7, text: `${name} est au rendez-vous`, mechanism: 'Le rendez-vous commence', importance: 0.5 };
      if (ev.type === 'meeting_end' && involved) return { arc, progress: 1, outcome: 'fulfilled', text: `${name} a tenu parole`, mechanism: 'L’engagement a été honoré jusqu’au bout', importance: 0.8 };
      if (ev.type === 'meeting_missed') return { arc, progress: arc.progress, outcome: 'failed', text: `${name} n’y est pas ${agree(me, 'arrivé')}`, mechanism: ev.mechanism ?? 'Rendez-vous manqué', importance: 0.85 };
      if (ev.type === 'commitment_cancelled' && involved) return { arc, progress: arc.progress, outcome: 'failed', text: `${name} a renoncé`, mechanism: 'Engagement annulé', importance: 0.8 };
      return null;
    }
    case 'on_time': {
      if (!involved || ev.data?.commitmentId !== g.commitmentId) return null;
      if (ev.type === 'late') return { arc, progress: 0, outcome: 'failed', text: `${name} est encore en retard (${ev.data?.lateBy} min)`, mechanism: ev.mechanism ?? 'Arrivée après l’heure', importance: 0.8 };
      if (ev.type === 'work_start' && !ev.data?.resuming) {
        const lateBy = Number(ev.data?.lateBy ?? 0);
        if (lateBy <= 5) return { arc, progress: 1, outcome: 'fulfilled', text: `${name} est ${agree(me, 'arrivé')} à l’heure${lateBy < 0 ? `, ${-lateBy} min en avance` : ''}`, mechanism: 'Arrivée avant l’heure de début', importance: 0.8 };
      }
      return null;
    }
    case 'be_at': {
      if (!involved || ev.type !== 'arrive' || ev.locationId !== g.locationId) return null;
      if (g.after !== undefined && ev.t < g.after) return null;
      const locName = ev.label.split('arrive à ')[1]?.split(' (')[0] ?? g.locationId;
      if (g.withAgent) {
        const other = world.agents[g.withAgent];
        const otherName = firstName(profiles, g.withAgent);
        if (other?.locationId === g.locationId && !other.asleep) return { arc, progress: 1, outcome: 'fulfilled', text: `${name} retrouve ${otherName} à ${locName}`, mechanism: 'Arrivée au lieu voulu pendant que l’autre y était', importance: 0.85 };
        const left = world.lastLeft?.[g.withAgent];
        if (left && left.locationId === g.locationId && ev.t - left.t <= 15) return { arc, progress: Math.max(arc.progress, 0.5), text: `${name} arrive à ${locName}… ${otherName} vient de partir (il y a ${ev.t - left.t} min)`, mechanism: 'Occasion manquée de peu', importance: 0.7 };
        if (arc.progress >= 0.3) return null;
        return { arc, progress: 0.3, text: `${name} est à ${locName}, mais ${otherName} n’y est pas`, mechanism: 'Arrivée sans la personne espérée', importance: 0.45 };
      }
      return { arc, progress: 1, outcome: 'fulfilled', text: `${name} s’est offert ce moment`, mechanism: 'Arrivée au lieu désiré', importance: 0.7 };
    }
    case 'keep_wallet': {
      if (!involved) return null;
      if (ev.type === 'lose_item') return { arc, progress: 0, outcome: 'failed', text: `${name} a encore perdu son portefeuille`, mechanism: ev.mechanism ?? 'Objet perdu', importance: 0.8 };
      if (ev.type === 'return_item' && ev.actors[1] === me) return { arc, progress: arc.progress, text: `On a rendu son portefeuille à ${name}`, mechanism: 'Le trouveur et le propriétaire se sont rencontrés', importance: 0.6 };
      return null;
    }
    case 'sell_out': {
      if (ev.locationId !== g.locationId) return null;
      if (ev.type === 'shop_closed' && /vendu|dernière/i.test(ev.label + (ev.mechanism ?? ''))) return { arc, progress: 1, outcome: 'fulfilled', text: `${name} a tout vendu`, mechanism: 'Stock épuisé avant la fermeture', importance: 0.8 };
      if (ev.type === 'purchase') {
        const left = Number(ev.data?.stockLeft ?? NaN);
        if (!Number.isNaN(left) && left <= 5 && arc.progress < 0.6) return { arc, progress: 0.6, text: `Il ne reste que ${left} pains à la boulangerie`, mechanism: 'Les ventes avancent', importance: 0.4 };
      }
      return null;
    }
    case 'conversations': {
      if (!involved || !social) return null;
      const count = arc.count + 1;
      const progress = Math.min(1, count / g.min);
      if (count >= g.min) return { arc, progress: 1, outcome: 'fulfilled', text: `${name} a parlé à ${g.min} personnes : rien ne lui échappe aujourd’hui`, mechanism: `${g.min} conversations dans la journée`, importance: 0.7 };
      return { arc, progress, text: `${name} glane des nouvelles (${count}/${g.min})`, mechanism: 'Une conversation de plus', importance: 0.3 };
    }
    case 'money_floor': {
      if (!involved || ev.type !== 'purchase') return null;
      const money = world.agents[me]?.money ?? 0;
      if (money < g.min) return { arc, progress: 0, outcome: 'failed', text: `${name} a entamé sa réserve : il ne reste que ${Math.round(money)} €`, mechanism: 'Dépense sous le seuil fixé', importance: 0.7 };
      return null;
    }
    case 'bus_on_time': {
      if (ev.busId !== g.busId || !['bus_delay', 'bus_depart', 'bus_arrive'].includes(ev.type)) return null;
      const bus = world.buses[g.busId];
      if (!bus) return null;
      const imposed = ev.type === 'bus_delay' ? Number(ev.data?.minutes ?? 0) : 0;
      const delay = Math.max(bus.delay, imposed);
      if (delay >= g.maxDelay) return { arc, progress: 0, outcome: 'failed', text: `${name} ne tiendra pas l’horaire : le bus ${g.busId} a ${delay} min de retard`, mechanism: ev.mechanism ?? 'Retard constaté sur la ligne', importance: 0.8 };
      if (delay >= 1 && arc.progress < 0.5) return { arc, progress: 0.5, text: `Le bus ${g.busId} prend ${delay} min de retard : ${name} serre les dents`, mechanism: ev.mechanism ?? 'Retard sur la ligne', importance: 0.4 };
      return null;
    }
  }
}

/** What happens when the deadline passes with the arc still open. */
export function deadlineOutcome(arc: ArcState, world: WorldState, profiles: Map<AgentId, AgentProfile>): { outcome: BeatOutcome; text: string; mechanism: string } | null {
  if (!isOpen(arc)) return null;
  const seed = arcSeed(arc.seedId);
  const name = firstName(profiles, arc.agentId);
  const g = seed.goal;
  switch (g.type) {
    case 'avoid':
      return { outcome: 'fulfilled', text: `${name} a passé la journée sans croiser ${firstName(profiles, g.target)}`, mechanism: 'Aucune rencontre avant l’échéance' };
    case 'keep_wallet':
      return { outcome: 'fulfilled', text: `${name} rentre avec son portefeuille : rien de perdu aujourd’hui`, mechanism: 'Aucun objet perdu avant l’échéance' };
    case 'money_floor':
      return { outcome: 'fulfilled', text: `${name} a tenu son budget (${Math.round(world.agents[arc.agentId]?.money ?? 0)} €)`, mechanism: 'Solde au-dessus du seuil à l’échéance' };
    case 'bus_on_time':
      return { outcome: 'fulfilled', text: `${name} a tenu l’horaire jusqu’à la fin du service`, mechanism: 'Aucun retard notable avant la fin du service' };
    case 'sell_out': {
      const stock = world.locations[g.locationId]?.stock ?? 0;
      return { outcome: 'failed', text: `${name} ferme avec ${stock} pains invendus`, mechanism: 'Stock restant à la fermeture' };
    }
    case 'talk_to':
      return { outcome: 'failed', text: arc.progress > 0 ? `${name} a croisé ${firstName(profiles, g.target)} sans oser aller plus loin` : `${name} n’a pas trouvé l’occasion de parler à ${firstName(profiles, g.target)}`, mechanism: 'Échéance dépassée sans la conversation espérée' };
    case 'be_at':
      return { outcome: 'failed', text: g.withAgent ? `${name} n’a pas réussi à retrouver ${firstName(profiles, g.withAgent)}` : `${name} n’a pas trouvé le temps`, mechanism: 'Échéance dépassée' };
    case 'conversations':
      return { outcome: 'failed', text: `${name} n’a parlé qu’à ${arc.count} personne${arc.count > 1 ? 's' : ''} sur ${g.min}`, mechanism: 'Échéance dépassée' };
    case 'commitment':
    case 'on_time':
      return { outcome: 'failed', text: `${name} n’a pas atteint son but`, mechanism: 'Échéance dépassée' };
  }
}

// ---------------------------------------------------------------------------
// Decisions: the desire of the day bends the utility scores
// ---------------------------------------------------------------------------

export const DESIRE_LABEL = 'Désir du jour';

function urgency(arc: ArcState, t: Minute): number {
  const deadline = arcDeadline(arc);
  const window = 240;
  return 0.5 + 0.5 * Math.max(0, Math.min(1, (t - (deadline - window)) / window));
}

/**
 * Add a « Désir du jour » component to candidates that serve (or betray) the
 * inhabitant's arc. Scores of non-rejected candidates are recomputed.
 */
export function applyDesire(candidates: Candidate[], agent: AgentState, world: WorldState, profiles: Map<AgentId, AgentProfile>, t: Minute): void {
  const arc = arcOf(world, agent.id);
  if (!arc || !isOpen(arc)) return;
  const seed = arcSeed(arc.seedId);
  const g = seed.goal;
  if (t > arcDeadline(arc)) return;
  const stakes = effectiveStakes(arc);
  const u = urgency(arc, t);
  const push = (c: Candidate, value: number, why: string) => {
    if (Math.abs(value) < 0.005) return;
    const comp: ScoreComponent = { label: `${DESIRE_LABEL} : ${why}`, value: Number(value.toFixed(3)) };
    c.components.push(comp);
    if (!c.rejected) c.score = c.components.reduce((s, x) => s + x.value, 0);
  };
  for (const c of candidates) {
    switch (g.type) {
      case 'talk_to': {
        if (g.after !== undefined && t < g.after - 30) break;
        const target = world.agents[g.target];
        const there = target && !target.asleep && target.locationId && target.locationId === c.locationId;
        if (c.withAgent === g.target || there) push(c, 0.1 + 0.3 * stakes * u, `revoir ${firstName(profiles, g.target)}`);
        break;
      }
      case 'avoid': {
        const target = world.agents[g.target];
        if (target && !target.asleep && target.locationId && target.locationId === c.locationId && !c.commitmentId) push(c, -0.25 * stakes, `éviter ${firstName(profiles, g.target)}`);
        break;
      }
      case 'commitment':
      case 'on_time':
        if (c.commitmentId === g.commitmentId) push(c, 0.12 * stakes + 0.1 * (arc.attempt - 1), seed.title.toLowerCase());
        break;
      case 'be_at': {
        if (c.locationId !== g.locationId || c.commitmentId) break;
        if (g.after !== undefined && t < g.after - 30) break;
        const other = g.withAgent ? world.agents[g.withAgent] : undefined;
        const bonus = g.withAgent ? (other && other.locationId === g.locationId && !other.asleep ? 0.12 + 0.3 * stakes * u : 0.05 * stakes) : 0.08 + 0.25 * stakes * u;
        push(c, bonus, seed.title.toLowerCase());
        break;
      }
      case 'conversations':
        if (['coffee', 'eat_cafe', 'relax_park', 'visit', 'eat_bakery', 'shop_groceries'].includes(c.action)) push(c, 0.1 * stakes * (1 - arc.progress) * u, 'glaner des nouvelles');
        break;
      case 'money_floor':
        if (c.components.some((x) => x.label.startsWith('Coût'))) push(c, -0.12 * stakes, 'tenir le budget');
        break;
      case 'keep_wallet':
      case 'sell_out':
      case 'bus_on_time':
        break;
    }
  }
}

/**
 * Detect a dilemma in a decision: the chosen option serves the desire while a
 * close runner-up was a commitment (or the reverse). Returns a French sentence.
 */
export function detectDilemma(chosen: Candidate, candidates: Candidate[], arc: ArcState | undefined, t: Minute): { text: string; other: Candidate } | null {
  if (!arc || !isOpen(arc)) return null;
  if (arc.lastDilemma !== undefined && t - arc.lastDilemma < 90) return null;
  const serves = (c: Candidate) => c.components.some((x) => x.label.startsWith(DESIRE_LABEL) && x.value > 0);
  const valid = candidates.filter((c) => !c.rejected && c !== chosen).sort((a, b) => b.score - a.score);
  const runner = valid[0];
  if (!runner || chosen.score - runner.score > 0.3) return null;
  const chosenDesire = serves(chosen);
  const runnerDesire = serves(runner);
  if (chosenDesire && runner.commitmentId && !runner.components.some((x) => x.label.startsWith(DESIRE_LABEL))) return { text: `hésite entre « ${runner.label} » et son envie (« ${chosen.label} ») — et suit son envie`, other: runner };
  if (runnerDesire && chosen.commitmentId && !chosenDesire) return { text: `hésite entre son envie (« ${runner.label} ») et « ${chosen.label} » — et fait passer l’engagement d’abord`, other: runner };
  return null;
}

// ---------------------------------------------------------------------------
// Secrets
// ---------------------------------------------------------------------------

/** Probability that the owner confides the secret during this conversation. */
export function revealChance(owner: AgentState, ownerProfile: AgentProfile, listener: AgentId, deep: boolean): number {
  const rel = owner.relationships[listener];
  const aff = rel?.affinity ?? 0;
  if (!rel || aff < 0.5) return 0;
  if (!['friend', 'partner', 'family', 'crush'].includes(rel.kind)) return 0;
  const base = deep ? 0.25 : 0.04;
  return Math.min(0.6, base + 0.25 * (aff - 0.5) + 0.08 * ownerProfile.traits.sociability);
}

/** Probability that a holder passes a secret on to someone else. */
export function gossipChance(holderProfile: AgentProfile, listener: AgentState, holderId: AgentId): number {
  const aff = listener.relationships[holderId]?.affinity ?? 0;
  const base = 0.03 + 0.4 * holderProfile.traits.curiosity * (1 - holderProfile.traits.honesty);
  return Math.min(0.5, base + 0.05 * Math.max(0, aff));
}

/** Arcs whose secret `holder` knows (not the owner's own), excluding those `listener` already knows. */
export function secretsToSpread(world: WorldState, holder: AgentId, listener: AgentId): ArcState[] {
  return Object.values(world.arcs ?? {}).filter((arc) => {
    const seed = arcSeed(arc.seedId);
    if (!seed.secret) return false;
    if (arc.agentId === holder || arc.agentId === listener) return false;
    if (!arc.knownBy.includes(holder)) return false;
    if (arc.knownBy.includes(listener)) return false;
    return true;
  });
}
