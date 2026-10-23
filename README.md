# 🦋 BUTTERFLY

**Twenty Lives. One Day. Infinite Possibilities.**
*Ville vivante autonome & moteur de simulation causale — prototype expérimental.*

Vingt habitants, une ville miniature, une journée de 06:00 à minuit. Chacun se réveille, part travailler, mange, fait ses courses, retrouve des amis, rate un bus, oublie un portefeuille, rentre dormir. Tout est simulé par un moteur déterministe : la même graine produit toujours la même journée.

Puis vous intervenez : **« Et si le bus avait trois minutes de retard ? »** BUTTERFLY crée une seconde réalité, recalcule la journée, et vous montre ce qui a changé — en distinguant les conséquences causalement prouvées des simples coïncidences.

Parfois rien d'important ne change. Parfois deux personnes ne se rencontrent pas. Parfois un portefeuille change de mains et un dîner n'a pas lieu.

---

## Lancer l'application

Prérequis : Node.js ≥ 20.

```bash
npm install
npm run dev
```

Ouvrez http://localhost:5173. Aucune clé API n'est nécessaire : tout le cœur de l'application (simulation, interventions, comparaison, rapports) fonctionne hors ligne.

### Narration IA (optionnelle)

L'adaptateur LLM tourne côté serveur pour que la clé ne quitte jamais votre machine.

```bash
cp .env.example .env        # puis renseignez ANTHROPIC_API_KEY
npm run server              # port 8787, proxyfié par Vite sous /api
```

Sans clé, le serveur (ou son absence) répond « narration IA désactivée » et l'application utilise ses replis déterministes. Avec une clé, le modèle (par défaut `claude-opus-5-5`, configurable via `ANTHROPIC_MODEL`) interprète vos demandes « Et si… » et peut réécrire les rapports en prose. Le repli serveur (`fallbacks: "default"`) est activé par défaut en cas de refus du modèle ; désactivez-le avec `ANTHROPIC_FALLBACKS=off`. Le LLM ne modifie jamais l'état simulé : il produit une intervention structurée validée, ou reformule des faits enregistrés.

### Autres commandes

```bash
npm test                 # suite Vitest
npm run typecheck        # TypeScript strict
npm run build            # bundle de production (dist/)
npm run cli -- --seed 42 # simule une journée en ligne de commande
npm run cli -- --seed 150 --bus-delay 3 --at 09:25 --agent gerard --verbose
```

---

## Prise en main

| Zone | Contenu |
|---|---|
| Haut | Horloge, période du jour, météo, lecture (▶, ×1 ×2 ×10 ×60, journée complète, aller à…), graine, bascule Réalité A / Réalité B, panneaux |
| Gauche | Les vingt habitants, recherche, sélection, suivi caméra |
| Centre | La ville 3D (orbite, zoom, clic sur un habitant) et les panneaux « Et si… », Causalité, Comparer, Rapport |
| Droite | Inspecteur : fiche de l'habitant sélectionné (besoins, émotions, relations, souvenirs, agenda, **Pourquoi fait-il cela ?**) ou fiche de l'événement sélectionné |
| Bas | Chronologie 06:00–24:00 avec marqueurs d'événements et de divergence |

**Vitesse ×1** = une minute simulée par seconde réelle (la journée dure 18 minutes). ×60 = une heure simulée par seconde.

La journée entière est calculée instantanément (quelques centaines de millisecondes) dès l'ouverture ; la lecture est une relecture. Vous pouvez donc sauter à n'importe quelle heure : positions, activités, relations et historiques correspondent à l'état réellement simulé.

## Scénario de démonstration

La graine par défaut (`DEMO_SEED` dans `src/store/useSimStore.ts`) est choisie pour qu'un retard de bus de trois minutes produise une conséquence réelle. Déroulé :

1. Lancez l'application : la ville et ses vingt habitants apparaissent, il est 06:00.
2. Appuyez sur ▶ (×10 est confortable) et observez les trajets, le bus, les rencontres.
3. Cliquez « Journée complète » pour aller à minuit, puis ouvrez « Rapport » : la journée de chaque habitant y est résumée.
4. Dans la chronologie, cliquez un marqueur de bus (ou sélectionnez un habitant qui prend le bus et remontez à son événement « monte dans le bus »), puis dans l'inspecteur : **« Retarder ce bus de 3 min »**. Vous pouvez aussi taper « Et si le bus avait trois minutes de retard ? » dans le panneau « Et si… ».
5. La réalité B est calculée et le panneau « Comparer » s'ouvre : première divergence, conséquences vérifiées, différences observées, habitants touchés, tableau par habitant.
6. Cliquez une conséquence puis « Pourquoi cet événement s'est-il produit ? » : l'explorateur causal remonte la chaîne jusqu'à l'intervention (maillons directs et indirects).
7. Basculez Réalité A / Réalité B à la même heure pour voir où chacun se trouve, et relisez l'une ou l'autre.

Le moteur causal fonctionne pour toutes les graines et toutes les interventions ; le scénario n'est pas scripté. Voir « Graine de démonstration » plus bas pour le détail de la chaîne obtenue.

## Interventions comprises sans LLM

L'interprète par règles reconnaît notamment :

- « Et si le bus avait trois minutes de retard ? » (cible le bus sélectionné ou le prochain passage)
- « Et si Alice ne quittait pas son appartement ce matin ? »
- « Et si Martin décidait de prendre un café plutôt que d'aller travailler ? »
- « Et si la boulangerie fermait à midi ? »
- « Et si Sophie retrouvait son ancien amoureux au parc ? »
- « Et si la pluie commençait à 14 h ? »
- « Et si Gérard oubliait son rendez-vous ? », « Et si Léa partait dix minutes plus tard ? »

Un formulaire structuré permet de composer n'importe quelle intervention sans phrase.

## Architecture

Voir [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). En résumé :

- `src/sim/` — moteur de simulation pur TypeScript (ville, population, décision utilitaire, événements causaux, bus, réalités, instantanés, comparaison, interprète d'interventions, récit). Aucune dépendance au navigateur.
- `src/render/` — ville 3D en React Three Fiber (géométrie procédurale, cycle jour/nuit, pluie, caméra de suivi).
- `src/ui/` — interface en français.
- `src/store/` — état applicatif (Zustand).
- `server/` — adaptateur LLM optionnel.
- `tests/` — suite Vitest (reproductibilité, horloge, déplacements, exclusivité, chronologie causale, branchement, relecture, divergence, interprète, récit).

## Limites connues

- Une seule ligne de bus (deux véhicules) et une ville de 22 lieux : l'échelle est volontairement petite pour rester lisible.
- Le modèle de décision est utilitaire et réglé à la main ; il est conçu pour être remplacé (interface `DecisionPolicy`).
- Les rencontres entre habitants ont lieu dans les lieux et les bus, pas dans la rue.
- Les habitants n'ont pas de téléphone : un rendez-vous abandonné n'est pas annoncé à l'autre partie (c'est un choix de conception pour l'effet papillon).
- La narration IA dépend d'une clé API ; sans clé, les rapports sont factuels et non narrés.
