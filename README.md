🇫🇷 Français · [🇬🇧 English](README.en.md)

# BUTTERFLY

**Vingt habitants, une journée qui se répète. Suivez l'un d'eux, et dépensez quelques gestes pour que sa journée enfin réussisse.**

BUTTERFLY est une simulation déterministe d'une petite ville française : vingt habitants, de 06:00 à minuit, minute par minute, où chaque événement a des causes enregistrées. On peut créer une seconde réalité, la réalité B, en y modifiant un détail (« Et si le bus avait trois minutes de retard ? ») et voir précisément ce qui change. Ce moteur est devenu un **jeu de boucle temporelle** : la journée se répète, personne n'atteint son but par la faute de coups du sort, et vous avez quelques gestes pour y remédier. Prototype expérimental.

<table>
  <tr>
    <td width="33%"><img src="docs/screenshots/start.png" alt="Écran « Choisir qui suivre » : vingt quêtes classées par difficulté"></td>
    <td width="33%"><img src="docs/screenshots/bubbles.png" alt="La ville à 09:46 : bulles d'alerte, fil dramatique, objectif de Léa"></td>
    <td width="33%"><img src="docs/screenshots/cafe.png" alt="La terrasse du Café Le Papillon à 07:40"></td>
  </tr>
  <tr>
    <td align="center"><sub>Choisir qui suivre : vingt quêtes, de 1 à 5</sub></td>
    <td align="center"><sub>La boucle en cours : bulles, fil dramatique, objectif</sub></td>
    <td align="center"><sub>Le café le matin (ville 3D, modèles CC0)</sub></td>
  </tr>
</table>

---

## Le jeu en deux minutes

**La boucle.** La réalité A est la journée telle qu'elle se répète : une chorégraphie où, par construction, aucun des vingt habitants n'atteint son objectif. Chaque histoire du jour porte ses **coups du sort** : Léa ne retrouve pas son sac et rate le bus, une urgence retient Nadia au cabinet, Élodie oublie son portefeuille au comptoir. Ce sont des événements visibles (« Coup du sort : … »), produits par les mêmes mécaniques que vos interventions, mais sans observateur. Certains ne frappent que si l'habitant est au bon endroit : on peut donc les esquiver.

**La partie.**

1. On choisit un habitant sur l'écran « Choisir qui suivre ». Les quêtes sont classées de 1 (tutoriel) à 5 (très difficile) ; Léa, « À l'heure au lycée », sert d'entraînement.
2. On regarde la journée se dérouler **vers l'avant seulement**, dans une réalité B, avec un petit budget de **gestes** par boucle (deux à quatre selon la difficulté). On ne peut pas revenir en arrière dans la boucle.
3. À minuit, la boucle se ferme. Le bilan donne l'issue de l'objectif (réussi, échoué, coup de théâtre ou inachevé), les destins modifiés chez les autres habitants et les gestes utilisés. On peut rejouer la journée ou changer de personnage.
4. Le **carnet** garde tous les gestes déjà essayés avec ce personnage, avec leurs issues, et les rejoue en un clic (« Réutiliser ») dans la boucle suivante.

**Ce que le joueur voit.**

- Des **bulles** au-dessus des personnages et un **fil dramatique** (en bas à gauche) qui ne montrent que ce qui compte : événements notables ou graves, marqués « lié à votre quête » quand ils touchent votre personnage, la personne visée, le lieu de l'objectif ou votre histoire.
- La carte d'**objectif** : titre de la quête, échéance, jauge de gestes restants, bouton « Faire un geste », carnet.
- La **planification A/B** : l'interrupteur « Voir la journée telle qu'elle se répète » bascule sur la réalité A, toujours consultable, pour repérer l'endroit où l'histoire déraille, puis revient à votre boucle.
- Un **geste** se formule en texte libre en français ou en gestes rapides (retarder un bus, retenir chez soi, faire se croiser, imposer une décision, fermer un lieu plus tôt, changer la météo). Il porte toujours sur le futur.

**Clavier.**

| Touche | Action |
|---|---|
| <kbd>Espace</kbd> | lecture / pause |
| <kbd>G</kbd> | faire un geste |
| <kbd>N</kbd> | ouvrir le carnet |
| <kbd>Échap</kbd> | fermer la fenêtre ouverte |
| <kbd>Tab</kbd> | basculer entre le jeu (mode spectateur) et le laboratoire |
| <kbd>+</kbd> / <kbd>−</kbd> | changer de vitesse (×1, ×5, ×20, ×60) |

**Le tutoriel.** Léa arrive en retard au lycée dans la réalité A. Un seul geste suffit : tapez **« Et si Léa partait au lycée à 7 h 30 ? »** (touche <kbd>G</kbd>). Le test `tests/drama.test.ts` vérifie qu'aucun arc n'est accompli en A et que ce geste fait réussir Léa.

### Le laboratoire

Le mode **laboratoire** (<kbd>Tab</kbd>) garde toute l'analyse : liste des habitants, inspecteur (« Pourquoi fait-il cela ? »), chronologie 06:00–24:00 avec marqueurs d'événements et de divergence, panneaux « Et si… », Causalité, Comparer, Rapport. La barre du haut regroupe l'horloge, la météo, la lecture (▶, ×1 ×5 ×20 ×60, « Journée complète », aller à une heure), la bascule Réalité A / Réalité B et un menu « ⋯ Plus » (graine, jour suivant, politique de décision, état de l'IA).

La journée entière est calculée en quelques centaines de millisecondes à l'ouverture ; la lecture est une relecture, on peut donc sauter à n'importe quelle heure et retrouver des positions, activités et relations réellement simulées. La vitesse ×1 est le temps réel (une minute simulée dure 60 secondes) ; à ×60, la journée dure 18 minutes.

| Inspecteur | Comparaison des réalités | Explorateur causal |
|---|---|---|
| ![Inspecteur](docs/screenshots/inspecteur.png) | ![Comparaison](docs/screenshots/comparaison.png) | ![Causalité](docs/screenshots/causalite.png) |

---

## Lancer

Prérequis : **Node.js 20 ou plus**.

```bash
npm install --legacy-peer-deps
npm run dev                  # http://localhost:5173
```

Aucune clé n'est nécessaire. Tout le cœur de l'application (simulation, gestes, comparaison, rapports, jeu) fonctionne **hors ligne**, avec des replis déterministes. L'IA est un supplément optionnel : les clés restent sur votre machine (lues par `server/index.ts` depuis `.env`) et ne sont envoyées qu'au fournisseur que vous avez choisi. Le LLM ne modifie jamais l'état simulé : il produit une intervention structurée que le moteur valide, ou il reformule des faits enregistrés.

### Adaptateurs IA (optionnels)

```bash
cp .env.example .env         # puis renseignez ce que vous voulez utiliser
npm run server               # port 8787, proxifié par Vite sous /api
```

| Variable | Rôle |
|---|---|
| `ANTHROPIC_API_KEY` | narration et interprétation des « Et si… » par un modèle Anthropic |
| `ANTHROPIC_MODEL` | `claude-haiku-5-5` par défaut (rapide, économique) ; `claude-sonnet-5-5` ou `claude-opus-5-5` pour une prose plus riche |
| `TYPESAFE_API_KEY`, `TYPESAFE_MODEL` | Jev (TypeSafe System One) comme conseiller de décision rapide ; `jev-latest` par défaut |
| `BUTTERFLY_ADVISOR` | force le conseiller : `jev`, `anthropic` ou `none` |
| `OLLAMA_URL`, `OLLAMA_EMBED_MODEL` | embeddings locaux pour la mémoire par similarité (`http://localhost:11434`, `embeddinggemma`) ; `BUTTERFLY_EMBED=off` désactive la détection d'Ollama |
| `BUTTERFLY_AI_PORT` | port du serveur (8787) |
| `ANTHROPIC_FALLBACKS` | les replis serveur en cas de refus du modèle sont actifs par défaut ; `off` les désactive |

Sans clé, l'état de l'IA est affiché comme « désactivée » et l'application utilise ses replis : interprète de phrases par règles, conseiller simulé, rappel lexical, rapports factuels non narrés.

### Commandes

```bash
npm test                     # suite Vitest (515 tests)
npm run typecheck            # TypeScript strict
npm run build                # typecheck puis bundle de production (dist/)
npm run cli -- --seed 51 --bus-delay 3 --at 09:25     # simule une journée en ligne de commande
npm run cli -- --seed 51 --bus-delay 3 --at 09:25 --agent gerard
npm run cli:advised -- --seed 51 --advisor mock       # journée avec conseiller (mock | anthropic | jev)
npm run brain:learn -- --from 1 --to 30               # alimente le cerveau persistant (data/brain.json)
npx tsx scripts/demo.ts 51                            # scénario de démonstration (voir plus bas)
node scripts/screenshot.mjs [--game | --drama]        # parcours visuel dans Chromium
node scripts/render-check.mjs                         # contrôle du rendu 3D (vues scriptées)
npm run i18n:check                                    # couverture du catalogue anglais
npm run i18n:translate                                # traduction du catalogue par Haiku (ANTHROPIC_API_KEY)
```

Options de `cli:advised` : `--advisor mock|anthropic|jev` (les deux derniers lisent `.env`) et `--embed lexical|ollama|none` pour le rappel de souvenirs. `brain:learn` accepte `--file` et `--embed lexical|ollama`.

---

## Langues

L'application existe en **français** et en **anglais**. Un bouton **FR | EN** change la langue : dans la barre du haut en mode laboratoire, dans un bouton de coin en mode spectateur (le jeu). Les réalités sont régénérées dans la langue choisie, car les textes du moteur (libellés d'événements, mécanismes, souvenirs) sont produits à la génération. Un interprète par règles en anglais comprend aussi les gestes (« What if the bus were three minutes late? »).

Toutes les chaînes passent par `t(clé, paramètres)` ; le français est la langue de référence et une clé absente en anglais retombe sur le français. Deux scripts entretiennent le catalogue anglais :

```bash
npm run i18n:check           # couverture du catalogue anglais par rapport au français
npm run i18n:translate       # Haiku traduit les catalogues français (ANTHROPIC_API_KEY ; modèle via I18N_MODEL, claude-haiku-5-5 par défaut)
```

Les conventions (clés, espaces de noms, genre et nombre, glossaire) sont dans [docs/I18N.md](docs/I18N.md).

---

## Ce qui se passe sous le capot

Détails complets dans [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

**Déterminisme et graine.** Tout l'aléa est une fonction de hachage de (graine, clé sémantique), par exemple `encounter:alice:hugo:512`, et non un générateur séquentiel. La même graine reproduit exactement la même journée, et une intervention ne change aucun tirage dont la situation n'a pas changé : une divergence n'apparaît que si la situation elle-même diffère. Le moteur (`src/sim/`) est du TypeScript pur, sans DOM ; le rendu ne fait que le lire.

**Événements causaux et comparaison A/B.** Chaque événement enregistre ses causes, son mécanisme, ses effets et ses tirages. La réalité B est un fork : même graine, mêmes conditions initiales, une intervention de plus. `compareRealities` classe les événements en identiques, décalés, seulement A, seulement B. Une différence est une **conséquence vérifiée** si elle descend de l'intervention dans le graphe causal ; sinon elle est présentée comme « observée, lien non prouvé » (probable si l'habitant avait déjà été touché, sinon indéterminé), jamais attribuée à l'intervention sans appui causal. L'explorateur causal remonte la chaîne, avec ses maillons directs et indirects.

**Dramaturgie.** Chaque habitant vit chaque jour une histoire : un désir (« Oser parler à Hugo »), parfois un secret, une tension, une échéance. À la fin, elle est accomplie, échouée ou bouleversée. Les événements ordinaires deviennent des temps forts et des points de bascule ; les secrets sont confiés à des proches, répétés en rumeurs, et un secret qui atteint la personne dont il était caché provoque un coup de théâtre ; les **aveux** et les **dilemmes** sont notés. Les **coups du sort** sont des interventions sans observateur, planifiées à la création de l'état. Tout événement porte une **gravité** (0 anecdote, 1 notable, 2 grave, 3 vital) qui alimente les alertes du joueur. Après « Jour suivant », l'histoire accomplie laisse place à la suivante ; l'histoire échouée est retentée avec des enjeux plus élevés (jusqu'à trois tentatives). Conception : [docs/DRAMATURGIE.md](docs/DRAMATURGIE.md).

**Incidents du monde.** Sept incidents ont de vraies mécaniques, utilisables comme gestes ou comme coups du sort : accident (clinique), incendie (lieu évacué et fermé), vol (portefeuille, déclaration à la mairie), rupture (les partenaires deviennent des ex), renvoi, promotion, malaise. Chacun est un événement causal de gravité 2 ou 3. L'interprète par règles les comprend (« Et si Paul avait un accident à 10 h ? », « Et si un incendie se déclarait à la boulangerie à 11 h ? », « Et si Chloé et Antoine se séparaient ? », « Et si Alice était renvoyée ? »), de même que « Et si Alice ne quittait pas son appartement ce matin ? », « Et si la boulangerie fermait à midi ? », « Et si la pluie commençait à 14 h ? » ou « Et si Léa partait dix minutes plus tard ? ».

**Décision.** Les habitants choisissent par une IA utilitaire (`DecisionPolicy`, `src/sim/decision.ts`) dont les scores sont lisibles dans l'inspecteur, désir du jour compris. En mode « conseiller », les choix réellement ouverts (deux options de scores proches, hors engagements dus et interventions) sont arbitrés par un conseiller : **Jev** (TypeSafe System One, réponse en quelques dizaines de millisecondes, facturation à l'entrée seulement ; `server/jev.ts`), **Anthropic**, ou un conseiller simulé déterministe. Le moteur reste souverain : il construit les options, applique les contraintes, valide la réponse et garde le choix utilitaire en cas de réponse invalide ou peu sûre. Les réponses sont mises en cache pour préserver le déterminisme et la comparaison A/B. Les demandes au conseiller portent aussi les enjeux de l'histoire du jour, et un second rôle, le **dramaturge** (`antagonist`, `src/sim/advisor.ts`), choisit parmi les options plausibles celle qui sert le moins le désir de l'habitant, pour garder les histoires non résolues ; ce rôle existe côté conseiller mais n'est pas encore branché dans l'interface.

**Mémoire par similarité et cerveau persistant.** Quand un conseiller est consulté, BUTTERFLY rappelle les souvenirs pertinents (similarité 0,55, récence 0,20, importance 0,25 ; `src/sim/recall.ts`). La similarité vient d'embeddings locaux et gratuits via [Ollama](https://ollama.com), ou d'un embedder lexical déterministe hors ligne. En plus, des **grains de connaissance** (situation, cause, effets) sont extraits des journées et des comparaisons (`src/sim/knowledge.ts`) et rangés dans un **cerveau local** (`data/brain.json`, ignoré par git, jamais envoyé ailleurs ; `server/brain.ts`). Il est interrogeable par similarité et nourrit l'imagination, les conseillers et la narration. Il informe sans jamais piloter : le moteur reste déterministe et la comparaison A/B exacte.

**Narration.** Le serveur propose des gabarits (`day`, `agent`, `causal`, `compare`, `morning`, `dialogue`, `counterfactual`) dont la consigne interdit d'inventer un événement, un lieu ou une motivation absents des faits enregistrés ; les répliques de dialogue, seules imaginées, sont signalées comme telles. Sans clé, les rapports sont factuels et non narrés.

**Journées enchaînées et rencontres de rue.** « Jour suivant » démarre du lendemain à partir de l'état final de la réalité affichée (relations, souvenirs importants, argent, humeur amortie, portefeuilles perdus). Deux piétons qui se croisent peuvent s'arrêter bavarder deux minutes, et six engagements à marge serrée rendent la journée sensible aux petits retards.

**Rendu 3D et assets CC0.** La ville est en React Three Fiber (`src/render/`) : maisons à colombages, café et terrasse, place du marché, parc, canal, bus et vingt personnages animés, dont les trajets suivent les positions simulées. Les modèles viennent de Quaternius, Kenney et Poly Haven, tous sous licence CC0 : voir [docs/CREDITS.md](docs/CREDITS.md). La caméra zoome de la vue d'ensemble jusqu'à la rue, avec suivi d'un habitant.

**Plan du dépôt.** `src/sim/` moteur pur · `src/render/` ville 3D · `src/ui/` interface (jeu dans `src/ui/game/`) · `src/store/` état Zustand · `src/i18n/` catalogues FR / EN · `server/` adaptateurs IA, cerveau, embeddings · `public/models/` modèles 3D · `scripts/` outils · `tests/` suite Vitest.

---

## Scénario de démonstration

La graine par défaut (`DEMO_SEED = 51` dans `src/store/useSimStore.ts`) est choisie pour qu'un retard de bus de trois minutes produise une conséquence réelle. Le moteur causal fonctionne pour toutes les graines et toutes les interventions ; le scénario n'est pas scripté. Dans le laboratoire :

1. Lancez l'application (<kbd>Tab</kbd> pour passer au laboratoire) : il est 06:00.
2. Appuyez sur ▶ et observez les trajets, le bus, les rencontres, ou cliquez « Journée complète » puis ouvrez « Rapport ».
3. Dans la chronologie, cliquez un marqueur de bus, puis dans l'inspecteur : « Retarder ce bus de 3 min ». Vous pouvez aussi taper « Et si le bus avait trois minutes de retard ? » dans le panneau « Et si… ».
4. La réalité B est calculée et le panneau « Comparer » s'ouvre : première divergence, conséquences vérifiées, destins modifiés, tableau par habitant.
5. Cliquez une conséquence puis « Pourquoi cet événement s'est-il produit ? » pour remonter la chaîne causale jusqu'à l'intervention.

Résultat reproductible avec `npx tsx scripts/demo.ts 51` (la même intervention que `npm run cli -- --seed 51 --bus-delay 3 --at 09:25`, avec le détail des conséquences) :

**Graine 51** — événement : « Le bus L1-1 arrive à Arrêt Place du Marché » (09:25, Arrêt Place du Marché), retard imposé : 3 minutes.

- 3130 événements identiques, 6 décalés dans le temps, 8 présents seulement dans A, 14 seulement dans B.
- 18 conséquences causalement vérifiées de l’intervention, touchant 7 habitants.
- Première conséquence : 09:28 — Gérard monte dans le bus L1-1 à Arrêt Place du Marché.
- Conséquences majeures : 19:42 « Gérard rapporte à Martin le secret de Paul : Paul a sculpté un cadeau pour Camille qu’il n’ose pas lui donner. » n’a pas eu lieu ; 20:54 Gérard rapporte à Chloé le secret de Paul : Paul a sculpté un cadeau pour Camille qu’il n’ose pas lui donner..

Conséquences vérifiées :

- 09:28 — Gérard monte dans le bus L1-1 à Arrêt Place du Marché *(décalé de +3 min)*
- 09:26 — Antoine et Gérard discutent dans le bus L1-1 *(n’a pas eu lieu dans B)*
- 09:32 — Gérard descend du bus à Arrêt Supermarché *(décalé de +3 min)*
- 09:52 — Gérard oublie son portefeuille à Supermarché Marché Plus *(seulement dans B)*
- 12:15 — Gérard abandonne « Se reposer à la maison » pour « Se détendre au parc » *(n’a pas eu lieu dans B)*
- 14:12 — Gérard abandonne « Se détendre au parc » pour « Se reposer à la maison » *(seulement dans B)*
- 14:38 — Gérard attend Paul (Partie de pétanque) *(décalé de +9 min)*
- 14:35 — Gérard abandonne « Se reposer à la maison » pour « Partie de pétanque » *(seulement dans B)*
- 17:05 — Gérard et Martin discutent à Immeuble Haussmann *(décalé de -20 min)*
- 17:36 — Gérard abandonne « Se reposer à la maison » pour « Se détendre au parc » *(n’a pas eu lieu dans B)*
- 17:37 — Antoine abandonne « Se reposer à la maison » pour « Se détendre au parc » *(n’a pas eu lieu dans B)*
- 19:38 — Gérard et Martin discutent à Immeuble Haussmann *(décalé de -4 min)*
- 19:42 — Gérard rapporte à Martin le secret de Paul : Paul a sculpté un cadeau pour Camille qu’il n’ose pas lui donner. *(n’a pas eu lieu dans B)*
- 20:54 — Chloé fait la connaissance de Gérard à Parc des Tilleuls *(seulement dans B)*
- 20:54 — Gérard rapporte à Chloé le secret de Paul : Paul a sculpté un cadeau pour Camille qu’il n’ose pas lui donner. *(seulement dans B)*
- 20:55 — Antoine et Yasmine discutent à Villa Rosa *(seulement dans B)*
- 21:35 — Nadia et Thomas discutent à Parc des Tilleuls *(seulement dans B)*
- 21:37 — Gérard va dormir *(décalé de -6 min)*

Dans la réalité A, Gérard bavarde avec Antoine dans le bus avant de faire ses courses sans incident. Dans la réalité B, il monte trois minutes plus tard, arrive au supermarché à un autre moment de distraction et oublie son portefeuille à 09:52. Sa journée se réorganise, il croise d'autres personnes, et le secret que Paul lui a confié (une chaîne de 56 maillons depuis l'intervention) ne circule plus vers Martin mais vers Chloé, rencontrée au parc à 20:54. Sept habitants sont touchés ; les treize autres vivent exactement la même journée. Comme la journée est une chorégraphie verrouillée, aucun des vingt habitants n'atteint son objectif en A : le panneau « Comparer » et le rapport listent les destins modifiés dès qu'un geste en fait réussir un.

Chaque maillon est inspectable dans l'explorateur causal, et le tirage responsable de l'oubli (`lose:gerard:…`) est affiché avec sa valeur : la différence vient d'un autre instant, pas d'une autre « chance ».

---

## Documents

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) : architecture, pas de simulation, causalité, dramaturgie, conseillers, mémoire, cerveau, jeu.
- [docs/DRAMATURGIE.md](docs/DRAMATURGIE.md) : document de conception de la dramaturgie, avec la matrice des interactions de la réalité A ([docs/interactions-A.csv](docs/interactions-A.csv)).
- [docs/I18N.md](docs/I18N.md) : conventions d'internationalisation FR / EN.
- [docs/CREDITS.md](docs/CREDITS.md) : crédits et licences des modèles 3D.

## Limites connues

- Les chemins IA (narration, interprétation, conseillers Anthropic et Jev) n'ont pas pu être exercés dans l'environnement de développement faute de clé : ils sont construits et testés avec des simulacres et des replis. Le conseiller simulé, lui, est exercé par les tests.
- Les performances 3D n'ont été mesurées qu'en rendu logiciel (sans GPU) : 180 à 400 appels de dessin et 1,4 à 2 millions de triangles par image selon la distance. À vérifier sur une machine réelle.
- Le jeu est réglé pour la graine 51 (les quêtes, les coups du sort et le tutoriel de Léa y sont vérifiés) ; les autres graines fonctionnent, sans cet équilibrage.
- Le catalogue anglais est généré (Haiku) puis relu progressivement : des textes peuvent encore être traduits de façon approximative ou retomber sur le français ([docs/I18N.md](docs/I18N.md)).
- Une seule ligne de bus (deux véhicules) et 22 lieux : l'échelle est volontairement petite pour rester lisible.
- Le modèle de décision est utilitaire et réglé à la main ; il est conçu pour être remplacé (interface `DecisionPolicy`).
- Les habitants n'ont pas de téléphone : un rendez-vous abandonné n'est pas annoncé à l'autre partie, par choix de conception pour l'effet papillon.

## Licence

Aucun fichier `LICENSE` n'est présent : la licence du code n'est pas encore fixée, ce qui signifie que tous les droits restent réservés à l'auteur en attendant. Les modèles 3D et l'environnement HDRI sont sous licence CC0 (Quaternius, Kenney, Poly Haven), comme détaillé dans [docs/CREDITS.md](docs/CREDITS.md).
