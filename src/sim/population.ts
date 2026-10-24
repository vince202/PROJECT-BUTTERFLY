/**
 * The twenty inhabitants of BUTTERFLY.
 *
 * Profiles are static data: personality traits, routines, preferences and the
 * initial social graph. Dynamic state (needs, moods, memories, relationships)
 * lives in the world state and evolves through events.
 */

import { getLocale, t, type Locale } from '../i18n';
import type { AgentId, AgentProfile, Commitment, Minute, Relationship, Traits } from './types';

/**
 * Translate `key` with a fallback on the French literal kept in the data files.
 * (`t` renders a missing key as the key itself, which is how we detect it.)
 */
export function tOr(key: string, literal: string, params?: Record<string, string | number | boolean | undefined>): string {
  const v = t(key, params);
  return v === key ? literal : v;
}

/**
 * A label table whose values are read through `t('story.<prefix>.<id>')` at access time,
 * with the French literals as fallback. Behaves like a plain `Record` (indexing, `Object.keys`, spread).
 */
export function labelTable<K extends string | number>(prefix: string, literals: Record<K, string>): Record<K, string> {
  const out = {} as Record<K, string>;
  for (const k of Object.keys(literals) as unknown as K[]) {
    Object.defineProperty(out, k, { enumerable: true, get: () => tOr(`story.${prefix}.${k}`, literals[k]) });
  }
  return out;
}

const h = (hh: number, mm = 0): Minute => hh * 60 + mm;

function traits(p: Partial<Traits>): Traits {
  return {
    punctuality: 0.5,
    sociability: 0.5,
    impulsivity: 0.5,
    curiosity: 0.5,
    ambition: 0.5,
    patience: 0.5,
    honesty: 0.8,
    frugality: 0.5,
    vitality: 0.5,
    ...p,
  };
}

function rel(to: AgentId, kind: Relationship['kind'], affinity: number): Relationship {
  return { to, kind, affinity };
}

export const AGENTS: AgentProfile[] = [
  {
    id: 'alice',
    name: 'Alice Moreau',
    firstName: 'Alice',
    gender: 'f',
    age: 29,
    occupation: 'Graphiste à l’Agence Horizon',
    homeId: 'res_lilas',
    workplaceId: 'office',
    color: '#ff6b9d',
    traits: traits({ punctuality: 0.7, sociability: 0.7, impulsivity: 0.4, curiosity: 0.7, ambition: 0.6, patience: 0.5, honesty: 0.8, frugality: 0.4, vitality: 0.5 }),
    goals: ['Décrocher le projet de la nouvelle campagne', 'Voir Sophie plus souvent', 'Trouver un meilleur équilibre'],
    bio: 'Graphiste créative, Alice habite à l’ouest de la ville et traverse chaque matin la ville en bus pour rejoindre l’agence. Elle aime les cafés, les discussions longues et déteste être en retard devant son directeur.',
    routine: { wake: h(7), bedtime: h(23), workStart: h(9), workEnd: h(18), lunch: h(12, 30) },
    preferences: { favoriteFood: 'cafe', favoritePlace: 'cafe', busAffinity: 0.85, distraction: 0.3 },
    relationships: [rel('sophie', 'friend', 0.7), rel('martin', 'colleague', 0.4), rel('thomas', 'boss', 0.2), rel('julien', 'acquaintance', 0.2), rel('elodie', 'neighbor', 0.3), rel('mireille', 'neighbor', 0.2)],
    money: 60,
  },
  {
    id: 'martin',
    name: 'Martin Lefèvre',
    firstName: 'Martin',
    gender: 'm',
    age: 34,
    occupation: 'Comptable à l’Agence Horizon',
    homeId: 'imm_haussmann',
    workplaceId: 'office',
    color: '#4ecdc4',
    traits: traits({ punctuality: 0.95, sociability: 0.35, impulsivity: 0.15, curiosity: 0.3, ambition: 0.5, patience: 0.7, honesty: 0.9, frugality: 0.7, vitality: 0.6 }),
    goals: ['Boucler le bilan trimestriel', 'Oser sortir de la routine', 'Arriver le premier au bureau'],
    bio: 'Comptable méthodique, Martin vit au rythme de ses listes. Il part toujours avec dix minutes d’avance et considère le café comme une distraction coûteuse… qu’il s’autorise rarement.',
    routine: { wake: h(6, 30), bedtime: h(22, 30), workStart: h(8, 30), workEnd: h(17, 30), lunch: h(12, 15) },
    preferences: { favoriteFood: 'home', favoritePlace: 'library', busAffinity: 0.3, distraction: 0.1 },
    relationships: [rel('alice', 'colleague', 0.4), rel('thomas', 'boss', 0.5), rel('gerard', 'neighbor', 0.3), rel('noe', 'neighbor', 0.2), rel('lucie', 'acquaintance', 0.2)],
    money: 90,
  },
  {
    id: 'sophie',
    name: 'Sophie Bernard',
    firstName: 'Sophie',
    gender: 'f',
    age: 31,
    occupation: 'Bibliothécaire',
    homeId: 'maison_canal',
    workplaceId: 'library',
    color: '#a29bfe',
    traits: traits({ punctuality: 0.6, sociability: 0.55, impulsivity: 0.35, curiosity: 0.85, ambition: 0.4, patience: 0.8, honesty: 0.85, frugality: 0.5, vitality: 0.45 }),
    goals: ['Tourner la page avec Julien', 'Préparer le club de lecture', 'Prendre l’air au parc'],
    bio: 'Bibliothécaire curieuse et rêveuse, Sophie a quitté Julien il y a un an sans vraiment cesser d’y penser. Elle commence tard, finit tard, et aime déjeuner avec Alice.',
    routine: { wake: h(7, 15), bedtime: h(23, 30), workStart: h(10), workEnd: h(19), lunch: h(12, 30) },
    preferences: { favoriteFood: 'restaurant', favoritePlace: 'park', busAffinity: 0.5, distraction: 0.5 },
    relationships: [rel('alice', 'friend', 0.7), rel('julien', 'ex', 0.1), rel('ines', 'acquaintance', 0.3), rel('nadia', 'friend', 0.4), rel('paul', 'neighbor', 0.3), rel('elodie', 'acquaintance', 0.2)],
    money: 70,
  },
  {
    id: 'julien',
    name: 'Julien Roux',
    firstName: 'Julien',
    gender: 'm',
    age: 33,
    occupation: 'Journaliste indépendant',
    homeId: 'loft_gare',
    color: '#ffa502',
    traits: traits({ punctuality: 0.3, sociability: 0.75, impulsivity: 0.85, curiosity: 0.9, ambition: 0.6, patience: 0.3, honesty: 0.6, frugality: 0.3, vitality: 0.5 }),
    goals: ['Finir l’article sur la ligne de bus', 'Revoir Sophie sans se l’avouer', 'Ne pas rater le café du matin'],
    bio: 'Journaliste indépendant, Julien travaille là où il y a du café et des gens. Impulsif et curieux, il change d’avis dix fois par jour. Il enquête en ce moment sur la ligne de bus de la ville.',
    routine: { wake: h(8), bedtime: h(24), lunch: h(13) },
    preferences: { favoriteFood: 'cafe', favoritePlace: 'cafe', busAffinity: 0.4, distraction: 0.6 },
    relationships: [rel('sophie', 'ex', 0.2), rel('hugo', 'friend', 0.6), rel('alice', 'acquaintance', 0.2), rel('mireille', 'acquaintance', 0.1), rel('karim', 'friend', 0.4), rel('thomas', 'rival', -0.2), rel('antoine', 'acquaintance', 0.1)],
    money: 45,
  },
  {
    id: 'camille',
    name: 'Camille Dubois',
    firstName: 'Camille',
    gender: 'f',
    age: 42,
    occupation: 'Boulangère',
    homeId: 'imm_voltaire',
    workplaceId: 'bakery',
    startLocationId: 'bakery',
    color: '#f7b731',
    traits: traits({ punctuality: 0.9, sociability: 0.6, impulsivity: 0.2, curiosity: 0.4, ambition: 0.7, patience: 0.6, honesty: 0.9, frugality: 0.6, vitality: 0.9 }),
    goals: ['Vendre toute la fournée', 'Prendre une vraie pause', 'Convaincre Lucie de commander chaque jour'],
    bio: 'Debout avant l’aube, Camille tient la boulangerie Au Levain d’Or. Elle connaît les habitudes de tout le quartier et ferme boutique dès que la dernière baguette est partie.',
    routine: { wake: h(5), bedtime: h(21, 30), workStart: h(6, 30), workEnd: h(14), lunch: h(14, 15) },
    preferences: { favoriteFood: 'home', favoritePlace: 'park', busAffinity: 0.1, distraction: 0.2 },
    relationships: [rel('gerard', 'acquaintance', 0.5), rel('mireille', 'acquaintance', 0.4), rel('hugo', 'acquaintance', 0.3), rel('lucie', 'friend', 0.5), rel('paul', 'friend', 0.4)],
    money: 120,
  },
  {
    id: 'hugo',
    name: 'Hugo Petit',
    firstName: 'Hugo',
    gender: 'm',
    age: 26,
    occupation: 'Barista au Café Le Papillon',
    homeId: 'res_parc',
    workplaceId: 'cafe',
    color: '#26de81',
    traits: traits({ punctuality: 0.5, sociability: 0.9, impulsivity: 0.7, curiosity: 0.6, ambition: 0.4, patience: 0.5, honesty: 0.7, frugality: 0.2, vitality: 0.7 }),
    goals: ['Faire le meilleur café de la ville', 'Aller à la salle avec Karim', 'Comprendre pourquoi Inès vient tous les jours'],
    bio: 'Barista bavard et généreux, Hugo est le cœur social du café. Il remarque tout le monde… sauf la façon dont Inès le regarde.',
    routine: { wake: h(6, 15), bedtime: h(24), workStart: h(7), workEnd: h(15), lunch: h(15, 15) },
    preferences: { favoriteFood: 'restaurant', favoritePlace: 'gym', busAffinity: 0.3, distraction: 0.4 },
    relationships: [rel('julien', 'friend', 0.6), rel('karim', 'friend', 0.7), rel('ines', 'neighbor', 0.4), rel('camille', 'acquaintance', 0.3), rel('lea', 'acquaintance', 0.1)],
    money: 40,
  },
  {
    id: 'lea',
    name: 'Léa Fontaine',
    firstName: 'Léa',
    gender: 'f',
    age: 17,
    occupation: 'Lycéenne',
    homeId: 'maison_bleue',
    workplaceId: 'school',
    color: '#fd79a8',
    traits: traits({ punctuality: 0.35, sociability: 0.8, impulsivity: 0.85, curiosity: 0.7, ambition: 0.5, patience: 0.3, honesty: 0.6, frugality: 0.3, vitality: 0.6 }),
    goals: ['Ne pas arriver en retard (encore)', 'Retrouver Noé au parc', 'Économiser pour un vélo'],
    bio: 'Lycéenne vive et distraite, Léa part toujours au dernier moment et compte sur le bus pour rattraper le temps perdu. Noé est son meilleur ami, même si elle ne le dit pas.',
    routine: { wake: h(7, 20), bedtime: h(23), workStart: h(8, 30), workEnd: h(16, 30), lunch: h(12) },
    preferences: { favoriteFood: 'bakery', favoritePlace: 'park', busAffinity: 0.8, distraction: 0.7 },
    relationships: [rel('nadia', 'family', 0.7), rel('noe', 'friend', 0.8), rel('yasmine', 'teacher', 0.4), rel('elodie', 'acquaintance', 0.2), rel('hugo', 'crush', 0.3)],
    money: 15,
  },
  {
    id: 'nadia',
    name: 'Nadia Fontaine',
    firstName: 'Nadia',
    gender: 'f',
    age: 45,
    occupation: 'Médecin généraliste',
    homeId: 'maison_bleue',
    workplaceId: 'clinic',
    color: '#00b894',
    traits: traits({ punctuality: 0.85, sociability: 0.5, impulsivity: 0.2, curiosity: 0.5, ambition: 0.7, patience: 0.6, honesty: 0.9, frugality: 0.5, vitality: 0.6 }),
    goals: ['Finir les consultations à l’heure', 'Passer du temps avec Léa', 'Un café avec Yasmine'],
    bio: 'Médecin dévouée et un peu épuisée, Nadia enchaîne les consultations. Elle s’inquiète des retards de sa fille Léa et compte sur sa soirée avec Yasmine pour respirer.',
    routine: { wake: h(6, 30), bedtime: h(23), workStart: h(8), workEnd: h(19), lunch: h(13) },
    preferences: { favoriteFood: 'home', favoritePlace: 'library', busAffinity: 0.2, distraction: 0.2 },
    relationships: [rel('lea', 'family', 0.8), rel('yasmine', 'friend', 0.7), rel('gerard', 'doctor', 0.4), rel('sophie', 'friend', 0.4), rel('thomas', 'acquaintance', 0.1)],
    money: 200,
  },
  {
    id: 'noe',
    name: 'Noé Garnier',
    firstName: 'Noé',
    gender: 'm',
    age: 17,
    occupation: 'Lycéen',
    homeId: 'imm_haussmann',
    workplaceId: 'school',
    color: '#74b9ff',
    traits: traits({ punctuality: 0.6, sociability: 0.35, impulsivity: 0.3, curiosity: 0.8, ambition: 0.6, patience: 0.7, honesty: 0.8, frugality: 0.6, vitality: 0.5 }),
    goals: ['Réussir le contrôle de maths', 'Oser parler à Léa de ses projets', 'Emprunter le livre d’astronomie'],
    bio: 'Lycéen réservé passionné d’astronomie, Noé vit avec son grand-père Gérard. Il préfère la bibliothèque aux foules, sauf quand Léa l’entraîne au parc.',
    routine: { wake: h(7), bedtime: h(22, 30), workStart: h(8, 30), workEnd: h(16, 30), lunch: h(12) },
    preferences: { favoriteFood: 'home', favoritePlace: 'library', busAffinity: 0.5, distraction: 0.3 },
    relationships: [rel('gerard', 'family', 0.8), rel('lea', 'friend', 0.8), rel('yasmine', 'teacher', 0.5), rel('ines', 'acquaintance', 0.2), rel('martin', 'neighbor', 0.2)],
    money: 20,
  },
  {
    id: 'gerard',
    name: 'Gérard Garnier',
    firstName: 'Gérard',
    gender: 'm',
    age: 72,
    occupation: 'Retraité (ancien cheminot)',
    homeId: 'imm_haussmann',
    color: '#b2bec3',
    traits: traits({ punctuality: 0.85, sociability: 0.65, impulsivity: 0.2, curiosity: 0.5, ambition: 0.2, patience: 0.8, honesty: 0.9, frugality: 0.8, vitality: 0.55 }),
    goals: ['Ne pas rater le rendez-vous chez le médecin', 'La partie de pétanque avec Paul', 'Rapporter du pain frais pour Noé'],
    bio: 'Ancien cheminot, Gérard aime les horaires et le pain chaud. Il prend le bus par habitude, discute avec tout le monde et veille sur son petit-fils Noé.',
    routine: { wake: h(6, 30), bedtime: h(22), lunch: h(12) },
    preferences: { favoriteFood: 'bakery', favoritePlace: 'park', busAffinity: 0.7, distraction: 0.5 },
    relationships: [rel('noe', 'family', 0.9), rel('paul', 'friend', 0.8), rel('camille', 'acquaintance', 0.5), rel('nadia', 'patient', 0.4), rel('mireille', 'friend', 0.5), rel('martin', 'neighbor', 0.3), rel('antoine', 'acquaintance', 0.4)],
    money: 80,
  },
  {
    id: 'yasmine',
    name: 'Yasmine Khelifi',
    firstName: 'Yasmine',
    gender: 'f',
    age: 38,
    occupation: 'Institutrice à l’école Jules Ferry',
    homeId: 'villa_rosa',
    workplaceId: 'school',
    color: '#e17055',
    traits: traits({ punctuality: 0.9, sociability: 0.7, impulsivity: 0.3, curiosity: 0.7, ambition: 0.5, patience: 0.9, honesty: 0.9, frugality: 0.5, vitality: 0.7 }),
    goals: ['Préparer la sortie scolaire', 'Décompresser avec Nadia', 'Acheter des fleurs pour la classe'],
    bio: 'Institutrice patiente et chaleureuse, Yasmine arrive toujours la première à l’école. Elle partage la Villa Rosa avec Chloé et Antoine et retrouve Nadia pour un café le soir.',
    routine: { wake: h(6, 45), bedtime: h(22, 30), workStart: h(8), workEnd: h(17), lunch: h(12) },
    preferences: { favoriteFood: 'home', favoritePlace: 'cafe', busAffinity: 0.4, distraction: 0.2 },
    relationships: [rel('nadia', 'friend', 0.7), rel('lea', 'student', 0.4), rel('noe', 'student', 0.5), rel('chloe', 'friend', 0.5), rel('antoine', 'neighbor', 0.4), rel('karim', 'acquaintance', 0.2)],
    money: 110,
  },
  {
    id: 'thomas',
    name: 'Thomas Marchand',
    firstName: 'Thomas',
    gender: 'm',
    age: 51,
    occupation: 'Directeur de l’Agence Horizon',
    homeId: 'loft_gare',
    workplaceId: 'office',
    color: '#636e72',
    traits: traits({ punctuality: 0.8, sociability: 0.5, impulsivity: 0.5, curiosity: 0.4, ambition: 0.95, patience: 0.2, honesty: 0.6, frugality: 0.3, vitality: 0.6 }),
    goals: ['Décrocher le contrat Horizon', 'Que l’équipe soit à l’heure', 'Déjeuner chez Lucie'],
    bio: 'Directeur ambitieux et impatient, Thomas surveille l’heure d’arrivée de ses employés comme ses chiffres. Il déjeune chez Lucie et garde une dent contre le journaliste Julien.',
    routine: { wake: h(6, 15), bedtime: h(23), workStart: h(8), workEnd: h(19), lunch: h(12, 45) },
    preferences: { favoriteFood: 'restaurant', favoritePlace: 'restaurant', busAffinity: 0.1, distraction: 0.3 },
    relationships: [rel('alice', 'employee', 0.3), rel('martin', 'employee', 0.5), rel('lucie', 'friend', 0.4), rel('julien', 'rival', -0.3), rel('nadia', 'acquaintance', 0.1)],
    money: 400,
  },
  {
    id: 'ines',
    name: 'Inès Carvalho',
    firstName: 'Inès',
    gender: 'f',
    age: 24,
    occupation: 'Étudiante en histoire',
    homeId: 'res_parc',
    color: '#fdcb6e',
    traits: traits({ punctuality: 0.5, sociability: 0.5, impulsivity: 0.5, curiosity: 0.9, ambition: 0.7, patience: 0.6, honesty: 0.8, frugality: 0.9, vitality: 0.5 }),
    goals: ['Avancer le mémoire', 'Oser parler à Hugo', 'Tenir le budget jusqu’à la fin du mois'],
    bio: 'Étudiante fauchée et passionnée, Inès passe ses journées à la bibliothèque et ses pauses au café, officiellement pour le wifi, officieusement pour Hugo.',
    routine: { wake: h(7, 45), bedtime: h(23, 30), lunch: h(13) },
    preferences: { favoriteFood: 'bakery', favoritePlace: 'library', busAffinity: 0.3, distraction: 0.4 },
    relationships: [rel('hugo', 'crush', 0.5), rel('sophie', 'acquaintance', 0.3), rel('noe', 'acquaintance', 0.2), rel('karim', 'neighbor', 0.2)],
    money: 25,
  },
  {
    id: 'paul',
    name: 'Paul Dupré',
    firstName: 'Paul',
    gender: 'm',
    age: 58,
    occupation: 'Menuisier',
    homeId: 'maison_canal',
    workplaceId: 'workshop',
    color: '#8d6e63',
    traits: traits({ punctuality: 0.8, sociability: 0.3, impulsivity: 0.15, curiosity: 0.4, ambition: 0.3, patience: 0.9, honesty: 0.95, frugality: 0.7, vitality: 0.6 }),
    goals: ['Finir la commode de Mme Lambert', 'La partie de pétanque', 'Parler moins, écouter plus'],
    bio: 'Menuisier taciturne et honnête, Paul travaille le bois depuis quarante ans. Son seul rendez-vous fixe : la pétanque avec Gérard.',
    routine: { wake: h(6), bedtime: h(22), workStart: h(7), workEnd: h(17), lunch: h(12) },
    preferences: { favoriteFood: 'home', favoritePlace: 'park', busAffinity: 0.2, distraction: 0.2 },
    relationships: [rel('gerard', 'friend', 0.8), rel('camille', 'friend', 0.4), rel('sophie', 'neighbor', 0.3), rel('chloe', 'acquaintance', 0.3), rel('mireille', 'acquaintance', 0.3), rel('lucie', 'acquaintance', 0.2)],
    money: 150,
  },
  {
    id: 'chloe',
    name: 'Chloé Martin',
    firstName: 'Chloé',
    gender: 'f',
    age: 36,
    occupation: 'Fleuriste',
    homeId: 'villa_rosa',
    workplaceId: 'florist',
    color: '#e84393',
    traits: traits({ punctuality: 0.6, sociability: 0.85, impulsivity: 0.5, curiosity: 0.6, ambition: 0.6, patience: 0.5, honesty: 0.8, frugality: 0.4, vitality: 0.7 }),
    goals: ['Livrer les bouquets de la mairie', 'Dîner avec Antoine', 'Convaincre Antoine de prendre des vacances'],
    bio: 'Fleuriste solaire, Chloé parle à ses clients comme à ses plantes. Elle attend chaque soir Antoine, chauffeur de bus, qui rentre rarement à l’heure qu’il annonce.',
    routine: { wake: h(7), bedtime: h(23), workStart: h(9), workEnd: h(19), lunch: h(13) },
    preferences: { favoriteFood: 'cafe', favoritePlace: 'cafe', busAffinity: 0.3, distraction: 0.5 },
    relationships: [rel('antoine', 'partner', 0.85), rel('yasmine', 'friend', 0.5), rel('paul', 'acquaintance', 0.3), rel('mireille', 'acquaintance', 0.3), rel('lucie', 'friend', 0.4)],
    money: 95,
  },
  {
    id: 'antoine',
    name: 'Antoine Rey',
    firstName: 'Antoine',
    gender: 'm',
    age: 39,
    occupation: 'Chauffeur de bus (Ligne 1)',
    homeId: 'villa_rosa',
    workplaceId: 'station',
    startLocationId: 'station',
    color: '#0984e3',
    traits: traits({ punctuality: 0.9, sociability: 0.6, impulsivity: 0.25, curiosity: 0.4, ambition: 0.3, patience: 0.8, honesty: 0.9, frugality: 0.6, vitality: 0.7 }),
    goals: ['Tenir l’horaire malgré tout', 'Dîner avec Chloé', 'Répondre aux questions du journaliste sans se faire piéger'],
    bio: 'Chauffeur de la Ligne 1 le matin, Antoine connaît chaque passager habituel. Un journaliste veut l’interroger sur les retards ; il préférerait parler de Chloé.',
    routine: { wake: h(5), bedtime: h(22), workStart: h(6, 10), workEnd: h(14), lunch: h(14, 15) },
    preferences: { favoriteFood: 'home', favoritePlace: 'park', busAffinity: 1, distraction: 0.2 },
    relationships: [rel('chloe', 'partner', 0.85), rel('gerard', 'acquaintance', 0.4), rel('mireille', 'acquaintance', 0.3), rel('julien', 'acquaintance', 0.1), rel('karim', 'friend', 0.4), rel('yasmine', 'neighbor', 0.4)],
    money: 85,
  },
  {
    id: 'mireille',
    name: 'Mireille Lambert',
    firstName: 'Mireille',
    gender: 'f',
    age: 68,
    occupation: 'Retraitée (mémoire vivante du quartier)',
    homeId: 'res_lilas',
    color: '#d980fa',
    traits: traits({ punctuality: 0.5, sociability: 0.95, impulsivity: 0.5, curiosity: 0.95, ambition: 0.2, patience: 0.4, honesty: 0.5, frugality: 0.8, vitality: 0.6 }),
    goals: ['Savoir tout ce qui se passe', 'Récupérer la commode chez Paul', 'Prendre le bus avec Antoine'],
    bio: 'Mireille sait tout sur tout le monde, souvent avant les intéressés. Elle prend le bus pour bavarder, achète son pain pour les nouvelles et attend sa commode depuis trois semaines.',
    routine: { wake: h(6, 45), bedtime: h(22, 30), lunch: h(12, 30) },
    preferences: { favoriteFood: 'bakery', favoritePlace: 'cafe', busAffinity: 0.9, distraction: 0.4 },
    relationships: [rel('gerard', 'friend', 0.5), rel('camille', 'acquaintance', 0.4), rel('alice', 'neighbor', 0.2), rel('elodie', 'neighbor', 0.3), rel('chloe', 'acquaintance', 0.3), rel('antoine', 'acquaintance', 0.3), rel('julien', 'acquaintance', 0.1), rel('paul', 'acquaintance', 0.4), rel('lucie', 'acquaintance', 0.2)],
    money: 60,
  },
  {
    id: 'karim',
    name: 'Karim Benali',
    firstName: 'Karim',
    gender: 'm',
    age: 30,
    occupation: 'Coach sportif au Gymnase Central',
    homeId: 'res_parc',
    workplaceId: 'gym',
    color: '#00cec9',
    traits: traits({ punctuality: 0.55, sociability: 0.8, impulsivity: 0.7, curiosity: 0.5, ambition: 0.7, patience: 0.4, honesty: 0.7, frugality: 0.3, vitality: 0.95 }),
    goals: ['Remplir le cours de 18 h', 'Entraîner Hugo', 'Courir au parc le matin'],
    bio: 'Coach énergique, Karim court au parc avant d’ouvrir la salle. Il entraîne son ami Hugo et rêve d’un cours complet à 18 heures.',
    routine: { wake: h(6), bedtime: h(23), workStart: h(10), workEnd: h(19), lunch: h(13, 30) },
    preferences: { favoriteFood: 'restaurant', favoritePlace: 'gym', busAffinity: 0.2, distraction: 0.3 },
    relationships: [rel('hugo', 'friend', 0.7), rel('julien', 'friend', 0.4), rel('antoine', 'friend', 0.4), rel('ines', 'neighbor', 0.2), rel('yasmine', 'acquaintance', 0.2)],
    money: 70,
  },
  {
    id: 'elodie',
    name: 'Élodie Vasseur',
    firstName: 'Élodie',
    gender: 'f',
    age: 27,
    occupation: 'Caissière au Marché Plus',
    homeId: 'res_lilas',
    workplaceId: 'supermarket',
    color: '#55efc4',
    traits: traits({ punctuality: 0.7, sociability: 0.3, impulsivity: 0.3, curiosity: 0.6, ambition: 0.5, patience: 0.7, honesty: 0.95, frugality: 0.8, vitality: 0.5 }),
    goals: ['Reprendre des études', 'Ne rien perdre aujourd’hui', 'Trouver le courage de parler à Alice'],
    bio: 'Caissière discrète et distraite, Élodie perd régulièrement ses affaires. Elle admire sa voisine Alice de loin et rêve de reprendre des études à la bibliothèque.',
    routine: { wake: h(7, 15), bedtime: h(22, 30), workStart: h(8, 30), workEnd: h(16, 30), lunch: h(12, 30) },
    preferences: { favoriteFood: 'home', favoritePlace: 'library', busAffinity: 0.5, distraction: 0.85 },
    relationships: [rel('alice', 'neighbor', 0.3), rel('mireille', 'neighbor', 0.3), rel('lea', 'acquaintance', 0.2), rel('sophie', 'acquaintance', 0.2)],
    money: 35,
  },
  {
    id: 'lucie',
    name: 'Lucie Perrin',
    firstName: 'Lucie',
    gender: 'f',
    age: 47,
    occupation: 'Restauratrice (Chez Lucie)',
    homeId: 'loft_gare',
    workplaceId: 'restaurant',
    color: '#ff7675',
    traits: traits({ punctuality: 0.75, sociability: 0.8, impulsivity: 0.4, curiosity: 0.5, ambition: 0.85, patience: 0.5, honesty: 0.8, frugality: 0.4, vitality: 0.8 }),
    goals: ['Servir quarante couverts', 'Acheter le pain chez Camille', 'Une pause au parc'],
    bio: 'Restauratrice au grand cœur et à l’ambition tenace, Lucie passe chaque matin chercher le pain chez Camille avant un service qui s’étire jusqu’à la nuit.',
    routine: { wake: h(7, 30), bedtime: h(24), workStart: h(10, 30), workEnd: h(23), lunch: h(15) },
    preferences: { favoriteFood: 'home', favoritePlace: 'restaurant', busAffinity: 0.1, distraction: 0.3 },
    relationships: [rel('thomas', 'friend', 0.4), rel('camille', 'friend', 0.5), rel('chloe', 'friend', 0.4), rel('martin', 'acquaintance', 0.2), rel('mireille', 'acquaintance', 0.2), rel('julien', 'acquaintance', 0.2)],
    money: 300,
  },
];

export const AGENT_IDS: AgentId[] = AGENTS.map((a) => a.id);

/** French past-participle / adjective agreement: agree('lea', 'arrivé') → 'arrivée', agree('paul', 'promu') → 'promu'. */
export function agree(id: AgentId, word: string): string {
  const p = AGENTS.find((a) => a.id === id);
  if (!p || p.gender !== 'f') return word;
  if (word.endsWith('e')) return word;
  return `${word}e`;
}

const localizedProfiles = new Map<Locale, Map<AgentId, AgentProfile>>();

/** Profile with its texts read through `story.agent.<id>.occupation|bio|goal.<i>` (French literals as fallback). */
function localizeProfile(p: AgentProfile): AgentProfile {
  const k = `story.agent.${p.id}`;
  return { ...p, occupation: tOr(`${k}.occupation`, p.occupation), bio: tOr(`${k}.bio`, p.bio), goals: p.goals.map((g, i) => tOr(`${k}.goal.${i}`, g)) };
}

function profilesFor(locale: Locale): Map<AgentId, AgentProfile> {
  let m = localizedProfiles.get(locale);
  if (!m) {
    m = new Map(AGENTS.map((a) => [a.id, localizeProfile(a)]));
    localizedProfiles.set(locale, m);
  }
  return m;
}

/** The twenty profiles with texts in the active language (cached per language; `AGENTS` stays the French source). */
export function localizedAgents(): AgentProfile[] {
  const m = profilesFor(getLocale());
  return AGENTS.map((a) => m.get(a.id)!);
}

/** Profile of an inhabitant with texts in the active language. */
export function profileOf(id: AgentId): AgentProfile {
  const p = profilesFor(getLocale()).get(id);
  if (!p) throw new Error(`Unknown agent ${id}`);
  return p;
}

/** Bus driver assignment: agent id -> bus id and shift. */
export const BUS_DRIVERS: { agentId: AgentId; busId: string; shiftStart: Minute; shiftEnd: Minute }[] = [
  { agentId: 'antoine', busId: 'L1-1', shiftStart: h(6, 10), shiftEnd: h(14) },
];

/**
 * Daily commitments. Work shifts are derived from routines; meetings, appointments
 * and errands are listed here. Each entry is turned into a Commitment per participant.
 */
export interface CommitmentSeed {
  id: string;
  kind: Commitment['kind'];
  label: string;
  locationId: string;
  start: Minute;
  end: Minute;
  participants: AgentId[];
  tolerance: Minute;
}

/** French source of the commitments; read them through `commitmentSeeds()` to get the active language. */
export const COMMITMENT_SEEDS: CommitmentSeed[] = [
  { id: 'c_martin_thomas', kind: 'meeting', label: 'Réunion bilan avec Thomas', locationId: 'office', start: h(9), end: h(9, 30), participants: ['martin', 'thomas'], tolerance: 10 },
  { id: 'c_gerard_doc', kind: 'appointment', label: 'Rendez-vous médical', locationId: 'clinic', start: h(9), end: h(9, 20), participants: ['gerard', 'nadia'], tolerance: 15 },
  { id: 'c_lucie_bread', kind: 'errand', label: 'Acheter le pain du restaurant', locationId: 'bakery', start: h(9, 30), end: h(9, 45), participants: ['lucie'], tolerance: 90 },
  { id: 'c_mireille_dresser', kind: 'appointment', label: 'Récupérer la commode chez Paul', locationId: 'workshop', start: h(10, 30), end: h(10, 50), participants: ['mireille', 'paul'], tolerance: 60 },
  { id: 'c_alice_sophie_lunch', kind: 'meeting', label: 'Déjeuner Alice & Sophie', locationId: 'restaurant', start: h(12, 30), end: h(13, 20), participants: ['alice', 'sophie'], tolerance: 15 },
  { id: 'c_thomas_lunch', kind: 'errand', label: 'Déjeuner chez Lucie', locationId: 'restaurant', start: h(12, 45), end: h(13, 30), participants: ['thomas'], tolerance: 30 },
  { id: 'c_julien_antoine', kind: 'meeting', label: 'Interview d’Antoine sur la ligne de bus', locationId: 'station', start: h(14, 30), end: h(15), participants: ['julien', 'antoine'], tolerance: 15 },
  { id: 'c_petanque', kind: 'meeting', label: 'Partie de pétanque', locationId: 'park', start: h(15), end: h(16, 15), participants: ['gerard', 'paul'], tolerance: 30 },
  { id: 'c_lea_noe_park', kind: 'meeting', label: 'Retrouvailles au parc après les cours', locationId: 'park', start: h(16, 45), end: h(17, 30), participants: ['lea', 'noe'], tolerance: 20 },
  { id: 'c_hugo_karim_gym', kind: 'meeting', label: 'Séance de sport avec Karim', locationId: 'gym', start: h(17, 30), end: h(18, 30), participants: ['hugo', 'karim'], tolerance: 20 },
  { id: 'c_nadia_yasmine_cafe', kind: 'meeting', label: 'Café entre amies', locationId: 'cafe', start: h(19, 30), end: h(20, 30), participants: ['nadia', 'yasmine'], tolerance: 15 },
  { id: 'c_chloe_antoine_dinner', kind: 'meeting', label: 'Dîner à la maison', locationId: 'villa_rosa', start: h(20), end: h(21), participants: ['chloe', 'antoine'], tolerance: 30 },
  // Tight-margin commitments: small delays can make them fail.
  { id: 'c_hugo_pastries', kind: 'errand', label: 'Chercher les viennoiseries pour le café', locationId: 'bakery', start: h(6, 45), end: h(6, 55), participants: ['hugo'], tolerance: 10 },
  { id: 'c_ines_sophie_club', kind: 'meeting', label: 'Préparer le club de lecture', locationId: 'library', start: h(10, 15), end: h(10, 45), participants: ['ines', 'sophie'], tolerance: 6 },
  { id: 'c_yasmine_flowers', kind: 'appointment', label: 'Fleurs pour la classe', locationId: 'florist', start: h(12, 10), end: h(12, 25), participants: ['yasmine', 'chloe'], tolerance: 8 },
  { id: 'c_martin_townhall', kind: 'errand', label: 'Déposer un dossier à la mairie', locationId: 'townhall', start: h(16, 40), end: h(16, 55), participants: ['martin'], tolerance: 10 },
  { id: 'c_mireille_elodie_cafe', kind: 'meeting', label: 'Thé avec Élodie', locationId: 'cafe', start: h(16, 45), end: h(17, 15), participants: ['mireille', 'elodie'], tolerance: 8 },
  { id: 'c_noe_book', kind: 'errand', label: 'Emprunter le livre d’astronomie', locationId: 'library', start: h(17, 40), end: h(17, 55), participants: ['noe'], tolerance: 10 },
];

const localizedCommitments = new Map<Locale, CommitmentSeed[]>();

/** Commitment seeds with `label` read through `story.commitment.<id>` (French literal as fallback). */
export function commitmentSeeds(): CommitmentSeed[] {
  const locale = getLocale();
  let list = localizedCommitments.get(locale);
  if (!list) {
    list = COMMITMENT_SEEDS.map((c) => ({ ...c, label: tOr(`story.commitment.${c.id}`, c.label) }));
    localizedCommitments.set(locale, list);
  }
  return list;
}
