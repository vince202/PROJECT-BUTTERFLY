# Architecture de BUTTERFLY

> Twenty Lives. One Day. Infinite Possibilities.

BUTTERFLY est un prototype expérimental : une ville miniature de vingt habitants autonomes, simulée minute par minute de 06:00 à 24:00, dont on peut modifier un détail pour observer comment vingt vies divergent. Ce document décrit l'architecture logicielle et les choix de conception.

## Vue d'ensemble

```
┌──────────────────────────────────────────────────────────────────────┐
│  Navigateur (React 19 + Vite)                                        │
│                                                                      │
│  src/render  ── Ville 3D (React Three Fiber) ── lit les traces       │
│  src/ui      ── Panneaux (inspecteur, papillon, causalité,           │
│                 comparaison, rapport) ── lisent événements et états  │
│  src/store   ── État applicatif (Zustand) : réalités A/B, horloge,   │
│                 lecture, sélection                                    │
│  src/sim     ── MOTEUR DE SIMULATION (TypeScript pur, sans DOM)       │
│  src/ai      ── client HTTP de l'adaptateur IA (optionnel)           │
└──────────────────────────────────────────────────────────────────────┘
                                   │ /api/ai (proxy Vite)
┌──────────────────────────────────▼───────────────────────────────────┐
│  server/index.ts — adaptateur LLM optionnel (Node, clé côté serveur) │
│  interprétation « Et si… » → intervention structurée validée         │
│  narration : réécriture de faits enregistrés, jamais d'invention     │
└──────────────────────────────────────────────────────────────────────┘
```

Le moteur (`src/sim`) ne dépend ni de React ni de Three.js : il tourne tel quel dans Node (`npm run cli`, tests Vitest). Le rendu lit des données produites par le moteur ; il ne les modifie jamais et sa cadence d'affichage n'influence pas le résultat.

## Les treize modules conceptuels

| Module demandé | Implémentation |
|---|---|
| 1. Modèle du monde | `src/sim/city.ts` : grille de rues (720 × 480 m, nœuds tous les 60 m), 22 lieux + 6 arrêts, graphe et Dijkstra avec cache, ligne de bus |
| 2. Modèle des personnages | `src/sim/population.ts` (profils statiques) + `AgentState` dans `types.ts` (besoins, émotions, relations, souvenirs, engagements, plan, trajet) |
| 3. Horloge | `types.ts` (`DAY_START`, `DAY_END`), `time.ts` ; un pas = une minute simulée ; `Engine.step()` |
| 4. Moteur de décision | `src/sim/decision.ts` : IA utilitaire derrière l'interface `DecisionPolicy` |
| 5. Ordonnanceur d'événements | `Engine.step()` : interventions → météo → bus → habitants → rendez-vous → rencontres → lieux → besoins |
| 6. Système causal | `SimEvent.causes` + `mechanism` remplis par le moteur ; `src/sim/causal.ts` (graphe, ancêtres, descendants, chaînes, impact) |
| 7. Branchement temporel | `src/sim/reality.ts` (`forkReality`) : même graine, même état initial, interventions supplémentaires |
| 8. Instantanés et relecture | `Reality.snapshots` (toutes les 15 min) + `Reality.stateAt(t)` (relecture déterministe) + `Reality.trace` (positions par minute) |
| 9. Interprète d'interventions | `src/sim/interventions.ts` : analyse de phrases françaises par règles, validation ; `server/index.ts` : variante LLM |
| 10. Adaptateur IA | `server/index.ts` (`AiProvider`, implémentation Anthropic) + `src/ai/client.ts` |
| 11. Rendu et animation | `src/render/*` (React Three Fiber, géométrie procédurale) |
| 12. Interface | `src/ui/*` (français) |
| 13. Rapport narratif | `src/sim/narrative.ts` : résumés factuels, par habitant, questions-réponses |

## Déterminisme et aléa stable

Tout l'aléa provient de `src/sim/rng.ts` : au lieu d'un générateur séquentiel, chaque tirage est une fonction de hachage de **(graine, clé sémantique)**, par exemple `encounter:alice:hugo:512` (une rencontre possible entre Alice et Hugo à 08:32). Conséquences :

- la même graine reproduit exactement la même journée ;
- une intervention à 09:24 ne change **aucun** tirage antérieur ni aucun tirage d'habitants dont la situation n'a pas changé : une divergence n'apparaît que lorsque la situation elle-même diffère (autre lieu, autre heure, autre interlocuteur). C'est ce qui évite la « divergence artificielle » due à la simple consommation de nombres aléatoires ;
- chaque événement enregistre ses tirages (`randomDraws`) pour inspection.

L'état du monde (`WorldState`) est une structure de données simple, clonable par `structuredClone`. `Engine.fromState(snapshot)` permet de reprendre la simulation depuis n'importe quel instantané : la relecture produit les mêmes événements avec les mêmes identifiants (les tests le vérifient).

## Le pas de simulation

Pour chaque minute `t` :

1. **Interventions** dont l'heure est `t` : événement racine `intervention`, puis effet (bus retenu, habitant confiné, action imposée, lieu fermé, météo, rendez-vous abandonné, rencontre provoquée).
2. **Météo** planifiée (graine) ou imposée.
3. **Bus** : immobilisation, arrêt (descentes, montées, incident aléatoire), déplacement. Le retard est mesuré par rapport à un horaire théorique calculé depuis la géométrie de la ligne ; un bus en retard raccourcit son battement au terminus.
4. **Habitants** (ordre fixe) : réveil, trajet (marche, attente, bus), activité en cours (effets sur les besoins, fin, réévaluation périodique des activités interruptibles, pause déjeuner, rendez-vous imminent) ou décision.
5. **Rendez-vous** : démarrage quand tous les participants sont présents, attente, délai de tolérance, rendez-vous manqué avec causes explicites.
6. **Rencontres** : pour chaque lieu (et chaque bus), tirage par paire, pondéré par la sociabilité, la relation existante et la nature du lieu ; issue selon la relation (ex, rival, coup de cœur, patron…) ; invitation spontanée possible.
7. **Lieux** : ventes de fond de la boulangerie (fermeture quand tout est vendu), fermetures programmées.
8. **Besoins** : faim, fatigue, solitude, ennui augmentent ; humeur et stress se relâchent lentement.

## Décision (IA utilitaire)

`buildCandidates()` génère, pour un habitant libre, toutes les actions envisageables : engagements (travail, cours, rendez-vous, courses), repas (maison, boulangerie, café, restaurant), café, courses, parc, bibliothèque, sport, repos, visite à un proche, sommeil, attente. Chaque candidat porte :

- des **composantes de score** lisibles (`Faim`, `Trajet (5 min, bus)`, `Envie de voir la personne`, `Vient de le faire`, `Humeur du moment`…) ;
- des **contraintes dures** (lieu fermé, complet, pas assez d'argent, portefeuille perdu, pas le temps avant le prochain engagement, confinement) qui rejettent le candidat avec une raison ;
- une durée, un lieu, un mode de transport (marche ou bus, choisi d'après l'horaire et l'affinité pour le bus).

La politique `UtilityPolicy` choisit le meilleur score (avec un bruit stable et une inertie pour l'activité en cours). Le `DecisionRecord` conservé sur l'habitant alimente la section « Pourquoi fait-il cela ? » de l'interface : ce sont les vrais scores, pas une explication reconstruite.

Pour brancher un modèle appris ou un LLM de décision, implémentez `DecisionPolicy.decide()` et passez-le à `new Engine(seed, interventions, { policy })`.

## Événements et causalité

Un `SimEvent` contient : identifiant, minute, type, acteurs, lieu/bus, libellé et description en français, `causes` (identifiants d'événements), `mechanism` (comment les causes ont produit l'événement), `effects` (changements d'état), `randomDraws`, importance, identifiant d'intervention et une `signature` (type + acteurs + lieu + discriminant) utilisée pour apparier les événements entre réalités.

Règle : une cause n'est enregistrée que lorsqu'un mécanisme la justifie — une arrivée dépend du départ et des retards subis ; une montée dans le bus dépend de l'arrivée du bus et du départ de l'habitant ; un rendez-vous manqué cite l'attente de l'un et la situation réelle de l'autre (en chemin et retardé, autre choix, confiné). Un départ de terminus à l'heure est un événement **racine** (dicté par l'horaire) : le retard d'un bus ne contamine donc pas toute la journée de la ligne.

Le graphe causal (`CausalGraph`) distingue effets **directs** (profondeur 1) et **indirects** (profondeur ≥ 2), calcule les racines, les chaînes les plus courtes et un score d'impact (somme des importances des descendants).

## Réalités et comparaison

Une `Reality` = graine + interventions → événements, instantanés, trace. La réalité B est un **fork** : même graine, mêmes conditions initiales, une intervention de plus. L'historique avant l'intervention est identique par construction (le moteur est déterministe), ce qui est vérifié par les tests.

`compareRealities(A, B)` apparie les événements par signature et rang, puis classe : identiques, décalés, seulement A, seulement B. Un événement B est une **conséquence vérifiée** s'il diffère de A **et** descend de l'intervention dans le graphe causal. Un événement A absent de B est vérifié si l'une de ses causes directes a elle-même été altérée. Les autres différences sont présentées comme « observées, lien non prouvé » (probable si l'acteur avait déjà été touché, sinon indéterminé). L'interface n'attribue donc jamais une différence à l'intervention sans appui causal.

## Interventions

Format interne (union discriminée dans `types.ts`) : `bus_delay`, `stay_home`, `force_action`, `agent_delay`, `location_hours`, `weather`, `cancel_commitment`, `encounter`. Trois chemins mènent à ce format :

1. l'interprète par règles (`interpretFrench`) — fonctionne sans aucune clé API ;
2. le formulaire structuré de l'éditeur « Et si… » ;
3. l'adaptateur LLM (sortie JSON contrainte par schéma, puis `validateIntervention`).

Dans tous les cas, c'est le moteur qui exécute l'intervention et calcule les conséquences ; aucun texte produit par un modèle n'écrit directement dans l'état du monde.

## Rapport narratif

`dayReport()` construit, à partir des événements : vue chronologique, rencontres, occasions manquées, événements inattendus, évolution des relations, décisions importantes, situations non résolues, chaînes causales les plus influentes, et un résumé par habitant. `answerQuestion()` répond à « Qu'est-il arrivé à Alice ? », « Qui a rencontré qui ? », « Quel événement a eu le plus d'impact ? », « Qu'est-ce qui a changé entre les deux réalités ? ». Avec une clé API, l'adaptateur peut réécrire ces faits en prose ; sans clé, le résumé factuel est affiché et la narration IA est signalée comme désactivée.

## Évolutions prévues

- **Échelle** : la ville et la population sont des données ; ajouter des habitants, des lieux ou une seconde ligne de bus ne touche pas le moteur. Pour plusieurs centaines d'habitants, déplacer le moteur dans un Web Worker (il n'a aucune dépendance au DOM).
- **Décision** : brancher un modèle appris ou un LLM via `DecisionPolicy` ; les candidats et contraintes restent calculés par le moteur, qui garantit la validité.
- **Fournisseurs IA** : implémenter `AiProvider` dans `server/index.ts` pour un autre fournisseur ou un modèle spécialisé.
- **Journées multiples** : les relations et souvenirs persistent dans `AgentState` ; un état de fin de journée peut servir d'état initial au lendemain.
