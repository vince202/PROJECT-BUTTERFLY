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
| (ajout) Dramaturgie | `src/sim/drama.ts` : désirs, secrets, points de bascule, jours enchaînés (voir plus bas) |

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

`dayReport()` construit, à partir des événements : vue chronologique, rencontres, occasions manquées, événements inattendus, évolution des relations, décisions importantes, situations non résolues, chaînes causales les plus influentes, les arcs du jour (« ce que chacun voulait »), les confidences, rumeurs et dilemmes, et un résumé par habitant. `answerQuestion()` répond à « Qu'est-il arrivé à Alice ? », « Qui a rencontré qui ? », « Quel événement a eu le plus d'impact ? », « Qu'est-ce qui a changé entre les deux réalités ? ». Avec une clé API, l'adaptateur peut réécrire ces faits en prose ; sans clé, le résumé factuel est affiché et la narration IA est signalée comme désactivée.

## Conseiller de décision (`src/sim/advisor.ts`)

`AdvisedPolicy` implémente `DecisionPolicy` au-dessus de la politique utilitaire. Pour chaque décision, elle calcule les candidats et leurs contraintes comme d'habitude ; si au moins deux options valides ont des scores proches (écart ≤ 0,25), qu'aucune intervention ni aucun engagement dû n'impose le choix, et qu'il ne s'agit pas d'une simple réévaluation périodique, la décision est « ouverte ». Le moteur étant synchrone et déterministe, l'avis externe passe par un **cache oracle** : `generateWithAdvisor()` simule la journée, collecte les décisions ouvertes sans réponse (clé = habitant + tranche de 10 minutes + ensemble d'options), interroge le conseiller par lots, met les réponses en cache et rejoue, jusqu'à convergence ou épuisement du budget de passes. Une réponse qui ne désigne pas une option proposée est ignorée. La relecture finale avec le cache complet est strictement déterministe, et la réalité B partage le même cache que A.

Conseillers fournis : `MockAdvisor` (déterministe, fondé sur la personnalité ; sert aux tests et au mode hors ligne), `HttpAdvisor` (navigateur → `/api/ai/decide`), `AnthropicAdvisor` (serveur, sortie JSON contrainte par schéma, par lots de 25) et `JevAdvisor` (serveur, `server/jev.ts` : une requête `POST /v1/systemone` par décision, question de type `choice` dont les critères sont les options validées ; réponse acceptée seulement si le choix existe et si la confiance dépasse un seuil ; appels parallèles bornés, nouvel essai sur 429). Le serveur choisit le conseiller dans `createAdvisor()` : `BUTTERFLY_ADVISOR` s'il est défini, sinon Jev si `TYPESAFE_API_KEY` est présent, sinon Anthropic, sinon aucun (le navigateur retombe sur `MockAdvisor`). Un modèle appris s'ajoute en implémentant `DecisionAdvisor.advise()`.

## Journées enchaînées

`Engine.nextDayState(prev)` construit l'état initial du jour suivant : état frais (positions, besoins, engagements du jour, flux aléatoires du jour via `daySeed`), puis report des relations (légèrement relâchées vers leur niveau de base), des souvenirs importants (préfixés « Hier »), de l'argent, d'une humeur amortie et des portefeuilles perdus. `nextDayReality()` enchaîne les réalités ; le store conserve la branche retenue de chaque journée pour reconstruire le jour courant au rechargement.

## Dramaturgie (`src/sim/drama.ts`)

Chaque habitant porte une histoire du jour (un *arc*) : un désir, un secret facultatif, une tension, une échéance et des enjeux. La couche dramatique transforme des événements ordinaires en **temps forts** et **points de bascule**, sans jamais écrire hors du journal causal.

**Données et mécanique séparées.**

- `ArcSeed` (`types.ts`, données statiques dans `ARC_SEEDS`) : au moins deux graines par habitant, dans l'ordre des jours ; un `ArcGoal` typé (`talk_to`, `avoid`, `commitment`, `on_time`, `be_at`, `keep_wallet`, `sell_out`, `conversations`, `money_floor`, `bus_on_time`) dit à quels événements l'histoire est sensible.
- `ArcState` vit dans `WorldState.arcs` (avec `lastLeft`, dernier lieu public quitté par chacun, pour les occasions manquées de peu). Comme tout le reste de l'état, il est clonable : instantanés, `stateAt`, `Engine.fromState` et le branchement A/B fonctionnent sans code particulier.
- Fonctions pures : `evaluateBeat(arc, event, world, profiles)` renvoie le temps fort que l'événement représente pour l'arc (progression, issue éventuelle `fulfilled | failed | twisted`, phrase française, mécanisme, importance) ; `deadlineOutcome` donne l'issue par défaut quand l'échéance passe (`avoid`, `keep_wallet`, `money_floor`, `bus_on_time` sont accomplis par défaut, les autres échouent). Aucune ne modifie l'état ni ne tire au hasard.

**Branchement dans le moteur.**

| Point d'accroche | Rôle |
|---|---|
| `Engine.processDrama` (fin de chaque `step`) | évalue les événements de la minute contre chaque arc ouvert, émet `arc_beat` ou `arc_resolved`, applique les échéances |
| `Engine.shareSecrets` (appelé par `converse`, hors disputes) | confidence du propriétaire à un proche (`revelation`), puis rumeur des détenteurs (`gossip`) ; une rumeur qui atteint `secretAbout` bouleverse l'arc du propriétaire |
| `applyDecision` + `detectDilemma` | émet `dilemma` quand le choix retenu et son dauphin (écart ≤ 0,3) opposent le désir à un engagement |
| `buildCandidates` → `applyDesire` | ajoute la composante « Désir du jour : … » aux candidats qui servent (ou trahissent) le but, puis recalcule leur score |
| `startTravel` | met à jour `lastLeft` |

**Déterminisme.** Le seul aléa de la couche dramatique passe par `rng.chance` avec des clés sémantiques : `reveal:<arc>:<auditeur>:<minute>` et `gossip:<arc>:<détenteur>:<auditeur>:<minute>`. Les probabilités (`revealChance`, `gossipChance`) dépendent de la relation, de la sociabilité, de la curiosité et de l'honnêteté ; une confidence n'est possible qu'entre amis, partenaires, famille ou béguin avec une affinité d'au moins 0,5. Une intervention ne déplace donc aucun tirage dramatique d'habitants dont la situation n'a pas changé, et les tirages sont enregistrés dans `randomDraws`.

**Attribution causale.** Un temps fort cite l'événement qui le déclenche (`causes = [événement]`). Une confidence cite la conversation ; une rumeur cite la conversation et la confidence ou rumeur dont elle découle ; un dilemme cite la décision. Un échec à l'échéance cite le dernier temps fort de l'arc, la dernière décision et la dernière arrivée de l'habitant. Les `arc_resolved` ont toujours des causes non vides, ce qui permet à `compareRealities` de dire si un destin modifié (`ArcChange`, ligne « Destins modifiés ») descend de l'intervention. Une rumeur qui atteint la personne visée alors que l'arc est déjà résolu ne le rouvre pas : le moteur émet un temps fort « Contrecoup » (`arc_beat` avec `data.aftershock`, citant la rumeur et la résolution), si bien que chaque arc n'a qu'un seul `arc_resolved`.

**Journées enchaînées.** `Engine.nextDayState` appelle `nextDayArcs(prev)` : un arc accompli ou bouleversé laisse place à la graine suivante de l'habitant (rotation circulaire) ; un arc échoué est retenté (`attempt + 1`, jusqu'à trois essais, puis rotation) avec des enjeux relevés (`effectiveStakes = stakes + 0,15 × (attempt − 1)`, plafonné à 1) et conserve `knownBy`. L'issue de la veille est ajoutée aux souvenirs de l'habitant.

**Ajouter un type de but.**

1. Étendre l'union `ArcGoal` dans `types.ts`.
2. Ajouter le cas dans `evaluateBeat` (quels événements font avancer ou résolvent l'arc) et dans `deadlineOutcome` (issue à l'échéance) ; TypeScript signale les `switch` incomplets.
3. Facultatif : ajouter le cas dans `applyDesire` pour que le but infléchisse les décisions.
4. Ajouter une graine dans `ARC_SEEDS`, puis lancer `tests/drama.test.ts`, qui vérifie les références (engagements, habitants, lieux) et les invariants (arcs résolus, causes existantes, déterminisme, relecture).

## Mémoire par similarité (`src/sim/recall.ts`)

Le rappel de souvenirs suit la recette des agents génératifs : score = 0,55 × similarité + 0,20 × récence + 0,25 × importance. La similarité est fournie par un `Embedder` : `LexicalEmbedder` (sac de mots haché signé, 256 dimensions, déterministe, synchrone, utilisable dans l'interface et les tests) ou, côté serveur, `OllamaEmbedder` (`server/embed.ts`, `POST /api/ai/embed`, modèle local `embeddinggemma` par défaut) atteint depuis le navigateur par `HttpEmbedder`, qui retombe sur l'embedder lexical en cas d'échec. `CachedEmbedder` mémorise les vecteurs par texte. Le rappel est branché dans `generateWithAdvisor()` (`attachRelevantMemories`) : chaque demande au conseiller porte une `situation` (lieu, personnes présentes, prochain engagement, désir du jour) et un vivier de souvenirs ; le vivier est remplacé par les souvenirs les plus pertinents avant l'envoi. Le moteur n'utilise jamais le rappel directement : la journée reste déterministe et rejouable, et les conseillers reçoivent simplement un meilleur contexte. Les souvenirs importants traversent les jours (`nextDayState`), si bien que le rappel est naturellement inter-journées.

## Conseillers et enjeux

Les demandes au conseiller (`AdviceRequest`) comportent aussi `stakes` : titre, désir, tension, état et échéance de l'arc du jour, ainsi que le secret et le nombre de personnes qui le connaissent. Jev le reçoit dans `state.enjeu_du_jour`, le conseiller Anthropic dans une ligne « Enjeu du jour ».

## Toile de connaissance (`src/sim/knowledge.ts`, `server/brain.ts`)

`extractGrains(A, B?, comparison?)` produit des `KnowledgeGrain` purs : `signature` stable (les mêmes situations se reconnaissent d'une graine à l'autre), `situation`, `cause`, `effects`, `text` (pour l'embedding), acteurs, graine, jour, poids dramatique et étiquettes. Les extracteurs (`arcGrains`, `secretGrains`, `chainGrains`, `encounterGrains`, `interventionGrains`) ne lisent que le journal d'événements, le graphe causal et la comparaison : aucun fait inventé. Côté serveur, `Brain` fusionne les grains par signature (compteur d'observations, graines vues), les vectorise avec l'embedder courant (lexical, puis Ollama dès qu'il est détecté, avec recalcul paresseux), persiste dans un JSON local et répond aux requêtes par 0,7 × similarité + 0,15 × fréquence + 0,15 × poids, avec filtres par famille, acteurs et étiquettes. Le script `scripts/brain-learn.ts` apprend en jouant des graines successives. Règle d'architecture : le cerveau est en aval du moteur (ingestion après génération) et en amont des seuls modules consultatifs (éditeur d'interventions, conseillers, narrateur).

## Coups du sort, gravité et jeu

**Coups du sort (`FateSpec`).** Chaque graine d'arc peut porter des obstacles : des interventions sans observateur, planifiées à la création de l'état (`WorldState.incidents`, construites par `fateOf(arcs)`) et appliquées par `applyIncidents()` juste avant `applyInterventions()`, via la mécanique commune `applyEffect()`. Leur événement racine est de type `incident` (jamais `intervention`), ils n'entrent pas dans `interventionEventIds`, si bien que `compareRealities` ne les attribue jamais au joueur. `requires: 'home' | 'public'` conditionne un coup du sort à la position de l'habitant (un geste peut le faire esquiver ; l'esquive est tracée par un événement `incident` de gravité 0). Un retard imposé (`agent_delay`) est désormais un vrai blocage : `heldUntil` empêche de partir, de changer de plan ou d'être chassé par la fermeture d'un lieu ; en déplacement, il devient une pause (`pausedUntil`). Les courses solitaires dont la fenêtre est passée sont déclarées manquées (`meeting_missed`), ce qui permet aux arcs d'échouer sur un événement et non seulement à l'échéance.

**Gravité.** Tout `SimEvent` porte `gravity` (0 anecdote, 1 notable, 2 grave, 3 vital), par défaut selon le type, surchargée pour les résolutions d'arc (vital si bouleversé ou enjeu ≥ 0,7) et les rumeurs qui atteignent leur cible. `questAlerts()` (`src/sim/quest.ts`) filtre la journée pour un habitant suivi : gravité ≥ 1 quand l'événement est lié à la quête (soi, histoire, cible, lieu), ≥ 2 sinon.

**Jeu (`src/sim/game.ts`).** `questCards(A)` dérive une quête par habitant avec une difficulté 1–5 (type de but et enjeu) et un budget de gestes ; `canApplyGesture()` encode les règles (budget, pas de retour en arrière, pas de doublon) ; `closeLoop()` enregistre la boucle, alimente le carnet (clé stable par type, cible et quart d'heure) et décide la phase ; `nextLoop()` relance. Le magasin applique ces règles (`applyGesture`, `endLoop`, `restartLoop`), borne `seek` vers l'avant pendant une boucle et ferme la boucle à minuit. Invariant testé : avec la graine de démonstration, aucun arc n'est accompli en A, et le geste du tutoriel (Léa part au lycée à 07:46) fait réussir son arc en B de façon causalement vérifiée.

## Corrections issues du document de dramaturgie

Le relevé de `docs/DRAMATURGIE.md` a conduit à ces règles : une **vraie conversation** est possible entre les participants d'un même rendez-vous (ils sont ensemble exprès) et, hors du lieu de travail, entre un patron et son employé ; elle reste impossible au comptoir. Une affinité supérieure à 0,35 suffit désormais à une vraie conversation (plus rare qu'au-dessus de 0,6). **L'aveu** : le propriétaire d'un secret peut le dire lui-même à la personne concernée, uniquement au cours d'une vraie conversation (`revelation` avec `data.confession`, gravité 2, libellé « avoue à »). Les **confidents** incluent collègues, voisins et connaissances appréciés (affinité ≥ 0,4) en vraie conversation, jamais un rival, un ex, un patron ou un employé. Les buts « conversations » comptent des **personnes différentes** (`ArcState.partners`). Les **salaires** sont versés à la fin de la journée de travail (9 € de l'heure), ce qui évite les habitants sans un sou le soir. Une attente sur le lieu d'un rendez-vous est close par `handleMeetings`, si bien que le mécanisme d'un rendez-vous manqué ne dit plus « encore en chemin » de quelqu'un qui attendait sur place.

## Évolutions prévues

- **Échelle** : la ville et la population sont des données ; ajouter des habitants, des lieux ou une seconde ligne de bus ne touche pas le moteur. Pour plusieurs centaines d'habitants, déplacer le moteur dans un Web Worker (il n'a aucune dépendance au DOM).
- **Décision** : brancher un modèle appris ou un LLM via `DecisionPolicy` ; les candidats et contraintes restent calculés par le moteur, qui garantit la validité.
- **Fournisseurs IA** : implémenter `AiProvider` dans `server/index.ts` pour un autre fournisseur ou un modèle spécialisé.
- **Journées multiples** : implémentées (voir ci-dessus) ; prochaine étape, des engagements qui naissent d'une journée pour la suivante (une invitation lancée aujourd'hui devient un rendez-vous demain).
