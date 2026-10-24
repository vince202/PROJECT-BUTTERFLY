# BUTTERFLY — Dramaturgie : objectifs, interactions et causalités

*Document de conception pour Vincent. Toutes les affirmations « en A » sont tirées d'une exécution de la réalité A (graine 51, `DEMO_SEED`, jour 1, sans intervention) ; les graines 7, 29 et 42 servent de contrôle de variété. Tout ce qui concerne la réalité B est une **idée**, signalée comme telle, jamais un fait observé.*

**Comment lire ce document**

- Les heures sont celles de la simulation (06:00–24:00). « Gravité » reprend `SimEvent.gravity` (0 anecdote, 1 notable, 2 grave, 3 vital).
- « Rencontre » = un événement `encounter`, `conversation`, `argument` ou `meeting_start` (même définition que `whoMetWhom`). « Même lieu » = les deux habitants sont éveillés dans le même lieu nommé (relevé minute par minute dans la trace), qu'ils se parlent ou non.
- Les noms de mécanismes (`agent_delay`, `breakup`, `encounter`…) sont ceux de `Intervention` dans `src/sim/types.ts`. Quand une idée demande un mécanisme qui n'existe pas encore, c'est écrit **(à créer)**.
- La matrice complète est aussi fournie en CSV : [`interactions-A.csv`](interactions-A.csv) (UTF-8 avec BOM, lignes × colonnes = prénoms).

**Ce que la journée A dit d'elle-même, en dix lignes** (détails en §5)

1. **3 293 événements, mais 49 paires sur 190 seulement se rencontrent** ; 58 paires ne sont même jamais au même endroit en même temps.
2. **Le couple Chloé–Antoine ne passe pas une minute ensemble de la journée**, ni en graine 51, ni en 7, 29 ou 42. Nadia et Yasmine (amies 0,7) non plus en 51.
3. **Le creux de 9 h à 13 h 30** : 3 à 4 événements sociaux par heure, chacun à son poste ; **le nœud naturel est le Parc des Tilleuls entre 18 h et 20 h 30** (jusqu'à 7 habitants présents à la fois à 18:00 et 19:00, 12 à 15 événements sociaux par heure entre 18 h et 21 h).
4. **Les 20 arcs échouent en 51**, mais six se règlent avant 13 h (Léa 08:41, Lucie 09:46, Sophie 10:27, Paul 11:39, Yasmine 12:27, Élodie 12:35) : pour ces personnages, le reste de la journée ne compte plus.
5. **Inès ose enfin sa vraie conversation avec Hugo à 22:13, treize minutes après l'échéance de 22:00** (et Hugo échoue le même arc à 22:00).
6. **Certains objectifs sont impossibles avec le moteur actuel** : un patron et son employé ne font que « parler boulot » (Alice ne peut pas avoir de vraie conversation avec Thomas, même quand on les force à se retrouver au café) ; on ne parle jamais « vraiment » au comptoir (Sophie à la bibliothèque, Camille à la boulangerie, Hugo au café, Lucie au restaurant) ; on ne parle jamais « vraiment » pendant un rendez-vous (Léa et Noé au parc).
7. **Six secrets ne peuvent pas circuler au départ** : Martin, Thomas et Élodie n'ont aucun confident possible ; Camille, Inès et Karim n'en ont qu'un, et c'est justement la personne à qui le secret est caché.
8. **Aucune rumeur n'atteint sa cible en 51** (3 rumeurs, 5 confidences, 0 coup de théâtre). En graine 29, le secret de Léa atteint huit personnes entre 12:03 et 20:33, sans jamais atteindre Hugo.
9. **Trois coups du sort racontent autre chose que ce qui se passe** : Hugo « rappelé au café » reste chez lui (Résidence du Parc) ; Antoine « s'attarde à la salle avec Karim » alors que Karim a quitté la salle à 19:00, vingt minutes avant son arrivée ; Yasmine est « encore en chemin » alors qu'elle attend Chloé chez le fleuriste depuis 11:59.
10. **Le pain ne relie personne** : un seul habitant achète à la boulangerie (Hugo, 06:43) ; l'arc de Camille se règle à 14:00 (« Camille ferme avec 12 pains invendus »), puis à 16:24 la boulangerie « ferme plus tôt : tout est vendu » (un client de passage). Le restaurant de Lucie sert trois repas de la journée, tous entre 19:02 et 19:04.

---

## 1. Matrice des interactions (20 × 20)

**Lecture d'une case (ligne X, colonne Y).** D'abord la relation **de X envers Y** au réveil (type, affinité), suivie de « → valeur » si l'affinité a bougé d'au moins 0,05 dans la journée ; puis ce qui se passe entre eux en A (lieu, heure, nature). « — » : ils ne se rencontrent jamais. « — (même lieu 243′, biblio) » : ils ne se parlent pas, mais passent ce temps au même endroit (signalé à partir de 30 minutes). Les relations sont asymétriques (Hugo voit Inès comme une voisine, Inès a un béguin pour Hugo) : lire la ligne de la personne qui regarde. « nouv. » : relation créée dans la journée (fait connaissance).

Abréviations de lieux : *agence* (Agence Horizon), *biblio* (Bibliothèque), *cabinet* (cabinet médical), *Chez Lucie* (restaurant), *Haussmann*, *Lilas*, *Rés. Parc*, *Villa Rosa*, *Maison Bleue*, *Loft Gare* (domiciles), *gare* (gare routière), *bus* (dans le bus L1-1). Natures : *discute*, *bavardage* (affinité > 0,6), *boulot* (patron/employé), *sourire* (béguin, quelques mots), *gêne* (ex), *dispute*, *ignorés* (rivaux), *fait connaissance*, **VRAIE CONVERSATION**, *confidence X→Y*, *rumeur X→Y (secret de Z)*, *rdv …*, *rdv manqué (…)*.

|  | Alice | Martin | Sophie | Julien | Camille | Hugo | Léa | Nadia | Noé | Gérard | Yasmine | Thomas | Inès | Paul | Chloé | Antoine | Mireille | Karim | Élodie | Lucie |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **Alice** | ■ | collègue 0,4→0,58 · café 07:53 discute · agence 10:38 discute · agence 13:44 discute | amie 0,7→0,88 · café 07:45 bavardage + confidence Alice→Sophie · Chez Lucie 12:25 rdv déjeuner | connaiss. 0,2→0,27 · café 18:10 discute | — | — (même lieu 65′, parc) | — | — | — | — (même lieu 40′, parc) | — | son patron 0,2→0,29 · agence 11:48 boulot · agence 13:32 boulot · agence 15:50 boulot | — (même lieu 40′, parc) | — | — | — | voisine 0,2→0,42 · café 07:30 discute · parc 19:08 discute + rumeur Mireille→Alice (secret de Gérard) · Lilas 22:00 discute | — | voisine 0,3→0,42 · Lilas 19:35 discute · Lilas 21:13 discute | — (même lieu 59′, Chez Lucie) |
| **Martin** | collègue 0,4→0,58 · café 07:53 discute · agence 10:38 discute · agence 13:44 discute | ■ | — (même lieu 42′, parc) | — | — (même lieu 48′, parc) | — (même lieu 35′, café) | — | — | voisin 0,2→0,36 · Haussmann 07:25 discute · Haussmann 18:27 discute · Haussmann 20:41 discute | voisin 0,3→0,42 · Haussmann 17:25 discute · Haussmann 19:42 discute + rumeur Gérard→Martin (secret de Paul) | — (même lieu 54′, parc) | son patron 0,5→0,59 · agence 08:55 rdv réunion bilan · agence 14:12 boulot | — | — (même lieu 35′, parc) | — | — (même lieu 33′, parc) | — | — (même lieu 40′, café) | nouv. 0,15 · parc 18:09 fait connaissance · parc 20:27 discute | connaiss. 0,2 · — |
| **Sophie** | amie 0,7→0,9 · café 07:45 bavardage + confidence Alice→Sophie · Chez Lucie 12:25 rdv déjeuner | — (même lieu 42′, parc) | ■ | ex 0,1→-0,14 · biblio 10:27 gêne · biblio 13:27 dispute · biblio 15:18 gêne · biblio 16:52 dispute | — | — | — | amie 0,4→0,46 · parc 21:54 discute + rumeur Sophie→Nadia (secret de Alice) | — | — (même lieu 71′, biblio) | — (même lieu 39′, parc) | — (même lieu 62′, Chez Lucie) | connaiss. 0,3→0,54 · biblio 10:09 discute · biblio 10:10 rdv club de lecture · biblio 11:54 discute · biblio 14:22 discute | voisin 0,3→0,36 · parc 20:09 discute | — | — | — (même lieu 36′, parc) | — (même lieu 103′, Chez Lucie) | connaiss. 0,2 · — (même lieu 75′, parc) | — (même lieu 109′, Chez Lucie) |
| **Julien** | connaiss. 0,2→0,27 · café 18:10 discute | — | ex 0,2→-0,04 · biblio 10:27 gêne · biblio 13:27 dispute · biblio 15:18 gêne · biblio 16:52 dispute | ■ | — | ami 0,6→0,67 · café 08:33 discute | — | — | — | — (même lieu 60′, biblio) | — | rival -0,2 · Loft Gare 20:48 ignorés · Loft Gare 22:27 ignorés | — (même lieu 243′, biblio) | — | — | connaiss. 0,1→0,16 · gare 14:25 rdv interview | connaiss. 0,1→0,17 · parc 21:43 discute | ami 0,4→0,47 · parc 20:12 discute | — (même lieu 50′, parc) | — (même lieu 75′, Loft Gare) |
| **Camille** | — | — (même lieu 48′, parc) | — | — | ■ | connaiss. 0,3→0,44 · café 14:47 discute · parc 18:05 discute | nouv. 0,1 · parc 17:34 fait connaissance | — | — | connaiss. 0,5→0,63 · parc 17:51 discute · parc 19:22 discute | nouv. 0,1 · parc 18:16 fait connaissance | — | — | ami 0,4→0,46 · parc 19:56 discute | — | — (même lieu 40′, parc) | connaiss. 0,4→0,47 · café 14:34 discute | — | — (même lieu 49′, parc) | amie 0,5 · — |
| **Hugo** | — (même lieu 65′, parc) | — (même lieu 35′, café) | — | ami 0,6→0,67 · café 08:33 discute | connaiss. 0,3→0,44 · café 14:47 discute · parc 18:05 discute | ■ | connaiss. 0,1 · — | — | — (même lieu 40′, parc) | — (même lieu 90′, parc) | — (même lieu 59′, parc) | — | voisine 0,4→0,79 · café 08:15 sourire · café 09:52 sourire · Rés. Parc 15:43 sourire · Rés. Parc 17:13 sourire · parc 19:07 sourire · Rés. Parc 20:43 sourire · Rés. Parc 22:13 VRAIE CONVERSATION | — (même lieu 40′, parc) | — | — | — (même lieu 100′, café) | ami 0,7→0,96 · café 07:48 bavardage · gym 17:54 rdv manqué (séance de sport) · Rés. Parc 20:31 bavardage · Rés. Parc 22:04 VRAIE CONVERSATION | — | — (même lieu 113′, café) |
| **Léa** | — | — | — | — | nouv. 0,1 · parc 17:34 fait connaissance | béguin 0,3 · — | ■ | famille 0,7→0,88 · Maison Bleue 20:09 bavardage + confidence Léa→Nadia · Maison Bleue 22:17 bavardage | ami 0,8→0,99 · école 14:20 bavardage · parc 16:36 bavardage · parc 16:40 rdv retrouvailles | — | sa prof 0,4→0,61 · école 08:41 remarque le retard · école 11:04 discute · école 12:51 discute · école 15:34 discute | — | — | — | — | — | — | — | connaiss. 0,2 · — | — |
| **Nadia** | — | — | amie 0,4→0,46 · parc 21:54 discute + rumeur Sophie→Nadia (secret de Alice) | — | — | — | famille 0,8→1 · Maison Bleue 20:09 bavardage + confidence Léa→Nadia · Maison Bleue 22:17 bavardage | ■ | — | son médecin 0,4→0,59 · cabinet 08:48 discute · cabinet 08:55 rdv consultation · parc 21:34 discute | amie 0,7 · café 19:54 rdv manqué (café entre amies) · jamais au même endroit | connaiss. 0,1 · — | — | — | — | — | — | — | — | — |
| **Noé** | — | voisin 0,2→0,36 · Haussmann 07:25 discute · Haussmann 18:27 discute · Haussmann 20:41 discute | — | — | — | — (même lieu 40′, parc) | amie 0,8→0,99 · école 14:20 bavardage · parc 16:36 bavardage · parc 16:40 rdv retrouvailles | — | ■ | famille 0,8→0,98 · Haussmann 07:42 bavardage · parc 18:40 bavardage · Haussmann 20:10 bavardage | sa prof 0,5→0,62 · école 12:32 discute · école 15:06 discute | — | connaiss. 0,2→0,26 · parc 18:48 discute | — (même lieu 32′, parc) | — (même lieu 31′, parc) | — | — (même lieu 53′, parc) | — | — | — |
| **Gérard** | — (même lieu 40′, parc) | voisin 0,3→0,42 · Haussmann 17:25 discute · Haussmann 19:42 discute + rumeur Gérard→Martin (secret de Paul) | — (même lieu 71′, biblio) | — (même lieu 60′, biblio) | connaiss. 0,5→0,63 · parc 17:51 discute · parc 19:22 discute | — (même lieu 90′, parc) | — | patient 0,4→0,59 · cabinet 08:48 discute · cabinet 08:55 rdv consultation · parc 21:34 discute | famille 0,9→1 · Haussmann 07:42 bavardage · parc 18:40 bavardage · Haussmann 20:10 bavardage | ■ | — (même lieu 40′, parc) | — (même lieu 37′, parc) | — (même lieu 80′, parc) | ami 0,8 · parc 15:38 rdv manqué (pétanque) · parc 18:25 bavardage + confidence Paul→Gérard | — | connaiss. 0,4→0,53 · bus 09:26 discute · parc 17:41 discute | amie 0,5→0,77 · parc 12:21 discute · parc 18:52 discute + confidence Gérard→Mireille · parc 21:16 bavardage | nouv. 0,1 · parc 07:14 fait connaissance | — (même lieu 60′, parc) | — |
| **Yasmine** | — | — (même lieu 54′, parc) | — (même lieu 39′, parc) | — | nouv. 0,1 · parc 18:16 fait connaissance | — (même lieu 59′, parc) | élève 0,4→0,54 · école 08:41 remarque le retard · école 11:04 discute · école 12:51 discute · école 15:34 discute | amie 0,7→0,54 · café 19:54 rdv manqué (café entre amies) · jamais au même endroit | élève 0,5→0,62 · école 12:32 discute · école 15:06 discute | — (même lieu 40′, parc) | ■ | — | — | nouv. 0,1 · parc 20:19 fait connaissance | amie 0,5→0,83 · café 07:30 discute · fleuriste 12:27 rdv manqué (fleurs) · rue 19:01 discute · Villa Rosa 21:53 VRAIE CONVERSATION + confidence Chloé→Yasmine | voisin 0,4→0,53 · Villa Rosa 17:26 discute · Villa Rosa 20:55 discute | — | connaiss. 0,2→0,34 · café 07:38 discute · parc 20:00 discute | nouv. 0,1 · parc 20:11 fait connaissance | — |
| **Thomas** | employée 0,3→0,39 · agence 11:48 boulot · agence 13:32 boulot · agence 15:50 boulot | employé 0,5→0,59 · agence 08:55 rdv réunion bilan · agence 14:12 boulot | — (même lieu 62′, Chez Lucie) | rival -0,3 · Loft Gare 20:48 ignorés · Loft Gare 22:27 ignorés | — | — | — | connaiss. 0,1 · — | — | — (même lieu 37′, parc) | — | ■ | — | — | — | — | — (même lieu 33′, parc) | — (même lieu 48′, Chez Lucie) | — | amie 0,4→0,47 · Chez Lucie 19:13 discute |
| **Inès** | — (même lieu 40′, parc) | — | connaiss. 0,3→0,54 · biblio 10:09 discute · biblio 10:10 rdv club de lecture · biblio 11:54 discute · biblio 14:22 discute | — (même lieu 243′, biblio) | — | béguin 0,5→0,89 · café 08:15 sourire · café 09:52 sourire · Rés. Parc 15:43 sourire · Rés. Parc 17:13 sourire · parc 19:07 sourire · Rés. Parc 20:43 sourire · Rés. Parc 22:13 VRAIE CONVERSATION | — | — | connaiss. 0,2→0,26 · parc 18:48 discute | — (même lieu 80′, parc) | — | — | ■ | — (même lieu 40′, parc) | — | — | — (même lieu 51′, parc) | voisin 0,2→0,4 · Rés. Parc 09:11 discute · Rés. Parc 20:22 discute · Rés. Parc 21:55 discute | — (même lieu 30′, supermarché) | — |
| **Paul** | — | — (même lieu 35′, parc) | voisine 0,3→0,36 · parc 20:09 discute | — | amie 0,4→0,46 · parc 19:56 discute | — (même lieu 40′, parc) | — | — | — (même lieu 32′, parc) | ami 0,8→0,91 · parc 15:38 rdv manqué (pétanque) · parc 18:25 bavardage + confidence Paul→Gérard | nouv. 0,1 · parc 20:19 fait connaissance | — | — (même lieu 40′, parc) | ■ | connaiss. 0,3 · — | — | connaiss. 0,3→0,2 · atelier 11:39 rdv manqué (commode) · parc 18:43 discute | — | — (même lieu 35′, parc) | connaiss. 0,2 · — |
| **Chloé** | — | — | — | — | — | — | — | — | — (même lieu 31′, parc) | — | amie 0,5→0,8 · café 07:30 discute · fleuriste 12:27 rdv manqué (fleurs) · rue 19:01 discute · Villa Rosa 21:53 VRAIE CONVERSATION + confidence Chloé→Yasmine | — | — | connaiss. 0,3 · — | ■ | couple 0,85→0,65 · Villa Rosa 20:35 rdv manqué (dîner) · jamais au même endroit | connaiss. 0,3→0,38 · café 07:38 discute | — | — | amie 0,4 · — |
| **Antoine** | — | — (même lieu 33′, parc) | — | connaiss. 0,1→0,16 · gare 14:25 rdv interview | — (même lieu 40′, parc) | — | — | — | — | connaiss. 0,4→0,53 · bus 09:26 discute · parc 17:41 discute | voisine 0,4→0,53 · Villa Rosa 17:26 discute · Villa Rosa 20:55 discute | — | — | — | couple 0,85 · Villa Rosa 20:35 rdv manqué (dîner) · jamais au même endroit | ■ | connaiss. 0,3 · — | ami 0,4 · — | — (même lieu 39′, parc) | — |
| **Mireille** | voisine 0,2→0,42 · café 07:30 discute · parc 19:08 discute + rumeur Mireille→Alice (secret de Gérard) · Lilas 22:00 discute | — | — (même lieu 36′, parc) | connaiss. 0,1→0,17 · parc 21:43 discute | connaiss. 0,4→0,47 · café 14:34 discute | — (même lieu 100′, café) | — | — | — (même lieu 53′, parc) | ami 0,5→0,8 · parc 12:21 discute · parc 18:52 discute + confidence Gérard→Mireille · parc 21:16 bavardage | — | — (même lieu 33′, parc) | — (même lieu 51′, parc) | connaiss. 0,4→0,47 · atelier 11:39 rdv manqué (commode) · parc 18:43 discute | connaiss. 0,3→0,38 · café 07:38 discute | connaiss. 0,3 · — | ■ | — | voisine 0,3→0,43 · café 17:00 rdv manqué (thé) · Lilas 17:04 discute · Lilas 19:26 discute | connaiss. 0,2 · — |
| **Karim** | — | — (même lieu 40′, café) | — (même lieu 103′, Chez Lucie) | ami 0,4→0,47 · parc 20:12 discute | — | ami 0,7→0,75 · café 07:48 bavardage · gym 17:54 rdv manqué (séance de sport) · Rés. Parc 20:31 bavardage · Rés. Parc 22:04 VRAIE CONVERSATION | — | — | — | nouv. 0,1 · parc 07:14 fait connaissance | connaiss. 0,2→0,34 · café 07:38 discute · parc 20:00 discute | — (même lieu 48′, Chez Lucie) | voisine 0,2→0,4 · Rés. Parc 09:11 discute · Rés. Parc 20:22 discute · Rés. Parc 21:55 discute | — | — | ami 0,4 · — | — | ■ | — | nouv. 0,1 · Chez Lucie 19:26 fait connaissance |
| **Élodie** | voisine 0,3→0,42 · Lilas 19:35 discute · Lilas 21:13 discute | nouv. 0,15 · parc 18:09 fait connaissance · parc 20:27 discute | connaiss. 0,2 · — (même lieu 75′, parc) | — (même lieu 50′, parc) | — (même lieu 49′, parc) | — | connaiss. 0,2 · — | — | — | — (même lieu 60′, parc) | nouv. 0,1 · parc 20:11 fait connaissance | — | — (même lieu 30′, supermarché) | — (même lieu 35′, parc) | — | — (même lieu 39′, parc) | voisine 0,3 · café 17:00 rdv manqué (thé) · Lilas 17:04 discute · Lilas 19:26 discute | — | ■ | — |
| **Lucie** | — (même lieu 59′, Chez Lucie) | connaiss. 0,2 · — | — (même lieu 109′, Chez Lucie) | connaiss. 0,2 · — (même lieu 75′, Loft Gare) | amie 0,5 · — | — (même lieu 113′, café) | — | — | — | — | — | ami 0,4→0,47 · Chez Lucie 19:13 discute | — | — | amie 0,4 · — | — | connaiss. 0,2 · — | nouv. 0,1 · Chez Lucie 19:26 fait connaissance | — | ■ |

### Paires qui ne se rencontrent jamais en A

Sur 190 paires, **141 ne se rencontrent jamais** dans la journée de la graine 51 (aucun `encounter`, `conversation`, `argument` ni rendez-vous commun) et 58 ne sont même jamais au même endroit en même temps.

**Par habitant** (nombre de personnes jamais rencontrées) :

- **Alice** (13) : Camille, Hugo, Léa, Nadia, Noé, Gérard, Yasmine, Inès, Paul, Chloé, Antoine, Karim, Lucie
- **Martin** (14) : Sophie, Julien, Camille, Hugo, Léa, Nadia, Yasmine, Inès, Paul, Chloé, Antoine, Mireille, Karim, Lucie
- **Sophie** (14) : Martin, Camille, Hugo, Léa, Noé, Gérard, Yasmine, Thomas, Chloé, Antoine, Mireille, Karim, Élodie, Lucie
- **Julien** (12) : Martin, Camille, Léa, Nadia, Noé, Gérard, Yasmine, Inès, Paul, Chloé, Élodie, Lucie
- **Camille** (13) : Alice, Martin, Sophie, Julien, Nadia, Noé, Thomas, Inès, Chloé, Antoine, Karim, Élodie, Lucie
- **Hugo** (15) : Alice, Martin, Sophie, Léa, Nadia, Noé, Gérard, Yasmine, Thomas, Paul, Chloé, Antoine, Mireille, Élodie, Lucie
- **Léa** (15) : Alice, Martin, Sophie, Julien, Hugo, Gérard, Thomas, Inès, Paul, Chloé, Antoine, Mireille, Karim, Élodie, Lucie
- **Nadia** (16) : Alice, Martin, Julien, Camille, Hugo, Noé, Yasmine, Thomas, Inès, Paul, Chloé, Antoine, Mireille, Karim, Élodie, Lucie
- **Noé** (14) : Alice, Sophie, Julien, Camille, Hugo, Nadia, Thomas, Paul, Chloé, Antoine, Mireille, Karim, Élodie, Lucie
- **Gérard** (11) : Alice, Sophie, Julien, Hugo, Léa, Yasmine, Thomas, Inès, Chloé, Élodie, Lucie
- **Yasmine** (11) : Alice, Martin, Sophie, Julien, Hugo, Nadia, Gérard, Thomas, Inès, Mireille, Lucie
- **Thomas** (15) : Sophie, Camille, Hugo, Léa, Nadia, Noé, Gérard, Yasmine, Inès, Paul, Chloé, Antoine, Mireille, Karim, Élodie
- **Inès** (15) : Alice, Martin, Julien, Camille, Léa, Nadia, Gérard, Yasmine, Thomas, Paul, Chloé, Antoine, Mireille, Élodie, Lucie
- **Paul** (14) : Alice, Martin, Julien, Hugo, Léa, Nadia, Noé, Thomas, Inès, Chloé, Antoine, Karim, Élodie, Lucie
- **Chloé** (17) : Alice, Martin, Sophie, Julien, Camille, Hugo, Léa, Nadia, Noé, Gérard, Thomas, Inès, Paul, Antoine, Karim, Élodie, Lucie
- **Antoine** (16) : Alice, Martin, Sophie, Camille, Hugo, Léa, Nadia, Noé, Thomas, Inès, Paul, Chloé, Mireille, Karim, Élodie, Lucie
- **Mireille** (12) : Martin, Sophie, Hugo, Léa, Nadia, Noé, Yasmine, Thomas, Inès, Antoine, Karim, Lucie
- **Karim** (13) : Alice, Martin, Sophie, Camille, Léa, Nadia, Noé, Thomas, Paul, Chloé, Antoine, Mireille, Élodie
- **Élodie** (15) : Sophie, Julien, Camille, Hugo, Léa, Nadia, Noé, Gérard, Thomas, Inès, Paul, Chloé, Antoine, Karim, Lucie
- **Lucie** (17) : Alice, Martin, Sophie, Julien, Camille, Hugo, Léa, Nadia, Noé, Gérard, Yasmine, Inès, Paul, Chloé, Antoine, Mireille, Élodie

**Paires qui ont une relation dans les profils mais ne se rencontrent pas en A** (contrôle sur les graines 7, 29, 42) :

| Paire | Relation (X→Y / Y→X) | Même lieu en A | Dans les autres graines |
|---|---|---|---|
| Martin – Lucie | connaiss. 0,2 / connaiss. 0,2 | 0 min | jamais (51, 7, 29, 42) |
| Sophie – Élodie | connaiss. 0,2 / connaiss. 0,2 | 75 min | se rencontrent en graine 42 |
| Julien – Lucie | — / connaiss. 0,2 | 75 min | se rencontrent en graine 29 |
| Camille – Lucie | amie 0,5 / amie 0,5 | 0 min | se rencontrent en graine 29 |
| Hugo – Léa | connaiss. 0,1 / béguin 0,3 | 0 min | jamais (51, 7, 29, 42) |
| Léa – Élodie | connaiss. 0,2 / connaiss. 0,2 | 0 min | jamais (51, 7, 29, 42) |
| Nadia – Yasmine | amie 0,7 / amie 0,7 | 0 min ; seul lien en A : café 19:54 rdv manqué (café entre amies) | se rencontrent en graine 7 |
| Nadia – Thomas | connaiss. 0,1 / connaiss. 0,1 | 13 min | jamais (51, 7, 29, 42) |
| Paul – Chloé | connaiss. 0,3 / connaiss. 0,3 | 0 min | jamais (51, 7, 29, 42) |
| Paul – Lucie | connaiss. 0,2 / — | 0 min | jamais (51, 7, 29, 42) |
| Chloé – Antoine | couple 0,85 / couple 0,85 | 0 min ; seul lien en A : Villa Rosa 20:35 rdv manqué (dîner) | jamais (51, 7, 29, 42) |
| Chloé – Lucie | amie 0,4 / amie 0,4 | 0 min | se rencontrent en graine 29 |
| Antoine – Mireille | connaiss. 0,3 / connaiss. 0,3 | 0 min | se rencontrent en graine 29 et 42 |
| Antoine – Karim | ami 0,4 / ami 0,4 | 0 min | jamais (51, 7, 29, 42) |
| Mireille – Lucie | connaiss. 0,2 / connaiss. 0,2 | 0 min | jamais (51, 7, 29, 42) |

**Côte à côte sans un mot** (au moins 50 minutes au même endroit, aucune rencontre) : Julien – Inès (243 min, biblio 230, café 13) · Hugo – Lucie (113 min, café 113) · Sophie – Lucie (109 min, Chez Lucie 109) · Sophie – Karim (103 min, Chez Lucie 50, parc 43, café 10) · Hugo – Mireille (100 min, café 60, parc 40) · Hugo – Gérard (90 min, parc 90) · Gérard – Inès (80 min, parc 80) · Sophie – Élodie (75 min, parc 38, biblio 37) · Julien – Lucie (75 min, Loft Gare 55, café 20) · Sophie – Gérard (71 min, biblio 60, parc 11) · Alice – Hugo (65 min, parc 40, café 25) · Sophie – Thomas (62 min, Chez Lucie 48, parc 14) · Julien – Gérard (60 min, biblio 60) · Gérard – Élodie (60 min, parc 40, supermarché 20) · Alice – Lucie (59 min, Chez Lucie 59) · Hugo – Yasmine (59 min, parc 34, café 25) · Martin – Yasmine (54 min, parc 54) · Noé – Mireille (53 min, parc 53) · Inès – Mireille (51 min, parc 40, biblio 11) · Julien – Élodie (50 min, parc 30, supermarché 20). Ces paires sont des occasions déjà présentes dans la chorégraphie : il suffit d'un prétexte pour les faire se parler.

### Paires les plus fréquentes

| Paire | Rencontres | Même lieu | Ce qui se passe en A |
|---|---|---|---|
| Hugo – Inès | 7 | 438 min | café 08:15 sourire · café 09:52 sourire · Rés. Parc 15:43 sourire · Rés. Parc 17:13 sourire · parc 19:07 sourire · Rés. Parc 20:43 sourire · Rés. Parc 22:13 VRAIE CONVERSATION |
| Sophie – Julien | 4 | 392 min | biblio 10:27 gêne · biblio 13:27 dispute · biblio 15:18 gêne · biblio 16:52 dispute |
| Sophie – Inès | 4 | 233 min | biblio 10:09 discute · biblio 10:10 rdv club de lecture · biblio 11:54 discute · biblio 14:22 discute |
| Léa – Noé | 3 | 527 min | école 14:20 bavardage · parc 16:36 bavardage · parc 16:40 rdv retrouvailles |
| Alice – Thomas | 3 | 506 min | agence 11:48 boulot · agence 13:32 boulot · agence 15:50 boulot |
| Léa – Yasmine | 3 | 439 min | école 08:41 remarque le retard · école 11:04 discute · école 12:51 discute · école 15:34 discute |
| Alice – Martin | 3 | 422 min | café 07:53 discute · agence 10:38 discute · agence 13:44 discute |
| Hugo – Karim | 3 | 165 min | café 07:48 bavardage · gym 17:54 rdv manqué (séance de sport) · Rés. Parc 20:31 bavardage · Rés. Parc 22:04 VRAIE CONVERSATION |
| Noé – Gérard | 3 | 145 min | Haussmann 07:42 bavardage · parc 18:40 bavardage · Haussmann 20:10 bavardage |
| Inès – Karim | 3 | 140 min | Rés. Parc 09:11 discute · Rés. Parc 20:22 discute · Rés. Parc 21:55 discute |
| Alice – Mireille | 3 | 139 min | café 07:30 discute · parc 19:08 discute + rumeur Mireille→Alice (secret de Gérard) · Lilas 22:00 discute |
| Martin – Noé | 3 | 128 min | Haussmann 07:25 discute · Haussmann 18:27 discute · Haussmann 20:41 discute |
| Gérard – Mireille | 3 | 105 min | parc 12:21 discute · parc 18:52 discute + confidence Gérard→Mireille · parc 21:16 bavardage |
| Yasmine – Chloé | 3 | 69 min | café 07:30 discute · fleuriste 12:27 rdv manqué (fleurs) · rue 19:01 discute · Villa Rosa 21:53 VRAIE CONVERSATION + confidence Chloé→Yasmine |
| Nadia – Gérard | 3 | 61 min | cabinet 08:48 discute · cabinet 08:55 rdv consultation · parc 21:34 discute |

À noter : la paire la plus fréquente (Hugo–Inès, 7 échanges, 438 minutes au même endroit) n'arrive à sa vraie conversation qu'à 22:13, et Alice–Thomas (506 minutes ensemble à l'agence) ne peut structurellement pas dépasser « parler boulot ». La fréquence ne fait pas la dramaturgie : il faut des **prétextes** (un objet à remettre, une nouvelle à annoncer, un service à demander) qui transforment la coprésence en scène.

### Idées d'interactions pour B (25 paires prometteuses)

*Tout ce tableau est fait d'idées. La colonne « En A » est factuelle (graine 51).*

| # | Paire | En A (51) | Ce qui pourrait les réunir (geste ou mécanisme) | Pourquoi (raisons, non exhaustif) | Ce que ça pourrait changer |
|---|---|---|---|---|---|
| 1 | Chloé – Antoine | Couple 0,85 ; **0 minute ensemble** (4 graines sur 4) ; dîner manqué 20:35, affinité de Chloé 0,85 → 0,65 | `cancel_commitment` sur la salle de sport ; `encounter` à la gare à 14:05 (fin de service) ; Chloé déjeune à la gare **(à créer : déjeuner improvisé)** | Elle prépare des vacances surprise (secret), lui a postulé pour le car régional (son secret du jour 2) ; c'est le seul couple de la ville ; la fin de service d'Antoine (14:00) tombe pendant la journée de Chloé | Le dîner a lieu → les deux secrets se croisent à table : coup de théâtre double ou réconciliation ; Antoine rentre et ne voit pas Karim |
| 2 | Nadia – Yasmine | Amies 0,7 ; jamais au même endroit ; Yasmine attend 24 min au café (19:30–19:54) | Esquiver l'urgence de 18:45 (aujourd'hui sans condition) **(à créer : coup du sort conditionnel)** ; Yasmine passe au cabinet vers 17:15 (`force_action`) | Deux secrets de carrière en miroir (direction de l'école / poste à la grande ville) ; Nadia est la seule à pouvoir « soigner » la fatigue de Yasmine ; elles ont 30 min ensemble en graine 7 | Échange des deux secrets ; Yasmine devient l'alliée qui pousse Nadia à parler à Léa |
| 3 | Camille – Lucie | Amies 0,5 ; **jamais au même endroit** (sauf graine 29) ; Lucie rate le pain 09:46 | Hugo livre le pain au restaurant **(à créer : course pour un tiers)** ; `location_hours` : la boulangerie ouvre plus tard ; Lucie passe après le service | Camille songe à vendre (secret caché à Lucie) ; Lucie perd de l'argent (secret) : chacune est la « bonne nouvelle » de l'autre ; en 29, Lucie se confie à Camille à 09:57 | Pacte : Lucie rachète ou commande chaque jour → l'arc « fournée » réussit, la vente est évitée ; ou la rumeur atteint Lucie |
| 4 | Alice – Thomas | Patron ; 3 « boulot » à l'agence (11:48, 13:32, 15:50) ; 506 min ensemble | Rencontre **hors travail** au café après 18:00 (Alice y est à 18:07) ; mais il faut que le moteur permette une vraie conversation patron/employé hors du lieu de travail **(à créer)** | Secrets en miroir : elle a une offre concurrente, il a perdu son plus gros client ; il a besoin d'elle, elle ne le sait pas | Alice reste (et décroche la campagne) ou part ; si Thomas apprend l'offre par Sophie/Nadia d'abord : coup de théâtre |
| 5 | Thomas – Lucie | Amis 0,4 ; un échange au comptoir à 19:13 ; déjeuner manqué 13:31 | Déjeuner tardif à 14:00 ; Lucie sort de la cuisine **(à créer : « table » ≠ comptoir)** ; `cancel_commitment` de la réunion qui s'éternise | Partenariat voulu par Thomas ; les deux cachent une entreprise fragile ; Thomas dîne chez elle à 19:02 en A | Partenariat signé entre deux bateaux qui coulent : comédie ; ou aveu mutuel |
| 6 | Julien – Martin | Jamais ; 20 min au parc (20:11) | `encounter` au café à 07:45 (Martin y est, Julien arrive à 08:32) ; Martin oublie son carnet **(à créer : objet perdu autre que portefeuille)** | Le carnet de Martin (vingt ans d'horaires réels) est la seule preuve qui puisse confirmer ou démentir l'article ; Martin cache le carnet à Julien | L'article devient vrai (ou faux) ; l'interview de 14:30 change de ton ; Antoine est blanchi |
| 7 | Julien – Mireille | Une discussion au parc à 21:43 | `encounter` au café le matin (Mireille y est 07:14–07:54, Julien arrive 08:32) | Mireille est l'auteure anonyme de la lettre au journal : elle est la source de Julien sans qu'il le sache ; elle adore parler | Julien découvre sa source → l'article tient ; ou Mireille se trahit devant Antoine |
| 8 | Julien – Antoine | Interview tenue 14:25–15:00 à la gare | Interview avancée/retardée (`agent_delay` sur Julien) ; Martin présent à l'interview | Julien cache que l'article accuse la Ligne 1 sans preuve ; Antoine veut « ne pas se faire piéger » | Antoine apprend le contenu → humiliation, file à la salle (cause réelle de la soirée manquée) |
| 9 | Mireille – Antoine | Jamais en 51 ; Mireille prend le bus L1-2 (08:49, 12:11), jamais celui d'Antoine (L1-1) | `bus_delay` sur L1-2 pour qu'elle prenne L1-1 ; `agent_delay` de 5 min | Son objectif de profil « prendre le bus avec Antoine » ; sa lettre anonyme vise Antoine | Mireille se confie ou se trahit ; Antoine retarde son bus pour bavarder (arc « horaire ») |
| 10 | Antoine – Karim | Amis 0,4 ; **jamais, dans aucune graine** ; Karim quitte la salle à 19:00, Antoine y arrive à 19:20 | Lier le coup du sort à la présence réelle de Karim **(à créer : condition de coup du sort)** | Le coup du sort prétend qu'ils sont ensemble ; Karim cherche du monde pour son cours de 18 h | Antoine au cours de 18 h → rentre à 19 h 15 pour le dîner ; le cours de Karim se remplit |
| 11 | Hugo – Karim | Bavardage 07:48 ; séance manquée 17:54 ; vraie conversation 22:04 | Hugo envoyé à la salle avant d'être retenu (`force_action` gym à 16:25, avant le coup du sort de 16:30) | Secrets croisés : Hugo a raté le concours, la salle de Karim risque de fermer ; chacun ménage l'autre | La séance a lieu, les deux secrets se disent ou s'aggravent |
| 12 | Hugo – Léa | Béguin de Léa (0,3) ; **jamais** (4 graines) | Léa passe au café avant le lycée (`force_action` coffee à 07:30) | Léa a un faible pour Hugo (secret caché à Hugo) ; Hugo est au comptoir de 07:00 à 15:00 | Triangle Inès / Hugo / Léa ; Inès voit la scène et renonce ou ose |
| 13 | Inès – Mireille | Jamais ; 51 min au même endroit (parc, biblio) | `encounter` au café à 14:18 (Mireille y est) ; Inès l'interviewe **(à créer : « interroger »)** | Le mémoire d'Inès porte sur l'histoire du Café Le Papillon ; Mireille est « la mémoire vivante du quartier » | Inès a une source ; Mireille répète le sujet du mémoire à Hugo → coup de théâtre pour Inès |
| 14 | Hugo – Inès | 7 échanges (sourires), vraie conversation à **22:13** | Rapprocher l'échéance ou la rencontre : `stay_home` d'Inès écourté ; `encounter` au parc à 19:07 | Ils sont voisins (Résidence du Parc), se croisent sans cesse ; seule la chance décide (réussite en 7 et 42) | Arc réussi avant 22:00 ; Hugo apprend le sujet du mémoire |
| 15 | Noé – Léa | Bavardage école 14:20, parc 16:36, rdv 16:40–17:30 | Permettre la vraie conversation pendant le rendez-vous **(à créer)** ; ou rencontre à 18:00 hors rendez-vous | Noé part étudier loin (secret caché à Léa) ; Nadia aussi envisage de partir : Léa est la cible de deux départs | Léa apprend tout le même soir : double coup de théâtre (Noé et Nadia) |
| 16 | Nadia – Léa | Bavardage 20:09 + confidence de Léa (béguin) ; 22:17 | Nadia rentre plus tôt (urgence annulée) ; dîner mère-fille **(à créer : repas partagé)** | Nadia veut du temps avec Léa (arc 2) et cache un déménagement possible | Nadia annonce le poste → Léa bouleversée ; ou Nadia refuse le poste |
| 17 | Gérard – Noé | 3 bavardages (07:42, 18:40, 20:10) | `illness` de Gérard dans le bus (il le prend seul à 08:25 et 09:25) | Le médecin lui a interdit le bus seul (secret caché à Noé) | Noé l'apprend → reste avec son grand-père → manque Léa |
| 18 | Paul – Camille | Amis 0,4 ; une discussion de 3 min au parc (19:56) | Paul passe à la boulangerie après la commode ; Camille passe à l'atelier **(à créer : remise d'objet)** | Paul a sculpté un cadeau pour elle ; elle songe à vendre et partir | Cadeau remis → Camille renonce à vendre ; ou la rumeur (Gérard → Martin en A) lui parvient d'abord |
| 19 | Paul – Mireille | Rdv commode manqué (Paul attend 69 min) ; discussion au parc 18:43 | Faire partir Mireille avant le coup du sort de 10:15 (`force_action` vers l'atelier à 10:05) | Mireille raconte tout ; à l'atelier elle verrait le cadeau sculpté | La commode est livrée… et le secret de Paul part en ville |
| 20 | Élodie – Alice | Voisines 0,3 ; 2 discussions aux Lilas (19:35, 21:13) | `encounter` au café le matin (Alice y est 07:29) ; la lettre tombe du portefeuille **(à créer)** | Lettre jamais envoyée (secret d'Élodie) ; Alice est entourée, Élodie isolée | Élodie remet la lettre → Alice gagne une alliée (et un regard sur elle-même) |
| 21 | Sophie – Julien | 4 échanges à la bibliothèque (10:27 gêne, 13:27 dispute, 15:18 gêne, 16:52 dispute) | Sortir du comptoir : rencontre au parc (ils y sont tous deux vers 21:43) ; `fire` à la bibliothèque | Les lettres gardées dans le tiroir ; Julien l'aime encore ; en graine 29 ils ont une vraie conversation au parc à 09:27 | Retrouvailles (Julien réussit, Sophie « bouleversée ») ou rupture définitive |
| 22 | Julien – Inès | **243 minutes ensemble à la bibliothèque sans un mot** | `encounter` à la bibliothèque à 11:00 ; ils partagent une table **(à créer)** | Historienne du café / journaliste de la ligne de bus : deux enquêteurs ; Inès connaît Hugo, ami de Julien | Inès devient informatrice ; Julien distrait de Sophie (aide pour l'arc de Sophie) |
| 23 | Hugo – Lucie | 113 min ensemble au café (08:47–10:40) sans un mot | Hugo lui parle de son retard ; il a acheté à 06:43 un lot étiqueté « pain pour le restaurant (12 pièces) » | Lucie attend une livraison qui n'arrive pas ; Hugo est bavard et généreux | Hugo dépanne Lucie en pain → l'arc de Lucie réussit sans passer par la boulangerie (et Camille perd une vente) |
| 24 | Thomas – Julien | Rivaux, même domicile (Loft de la Gare) ; « s'ignorent poliment » 20:48, 22:27 | Petit-déjeuner commun au loft **(à créer : scène de domicile)** ; `encounter` au café | Rivalité ancienne ; l'article de Julien peut toucher l'agence (client perdu) | Dispute (déjà 1 accrochage en 7, 29, 42) ou alliance contre la rumeur |
| 25 | Élodie – Martin | Font connaissance au parc à 18:09 ; discussion 20:27 | Martin trouve le portefeuille d'Élodie (c'est ce qui arrive en graine 29 à 18:10, rendu à 19:00) | Deux solitaires méthodiques ; tous deux veulent « sortir de la routine » | Le portefeuille rendu crée un lien ; Martin l'accompagne au café (son propre arc) |

---

## 2. Objectifs par personnage

Pour chaque habitant : la fiche des deux arcs (le premier est celui du jour 1, le second n'est joué que le lendemain d'une réussite ; en A tout échoue, donc **le second arc n'apparaît jamais tant que le joueur ne gagne pas**), les objectifs du profil, les engagements du jour et leur statut en A, puis une **proposition**. La difficulté est celle de `questDifficulty` (1 entraînement … 5 très difficile).

> **Repère exploratoire.** En simulant la graine 51 avec les *seconds* arcs à la place des premiers (même état initial, coups du sort des seconds arcs), 11 sur 20 réussissent sans aucun geste : Martin (dossier de la mairie, 16:55), Sophie (club de lecture, 10:45), Julien (interview, 15:00), Camille (pause, 14:36), Hugo (séance, 18:30), Léa (Noé, 17:30), Noé (livre, 17:55), Yasmine (Nadia, 20:30), Antoine (horaire, 14:00), Mireille (commode, 10:50), Karim (courir au parc, **06:04**). Ces seconds arcs sont donc d'excellentes **sous-intrigues** (faciles, déjà dans la chorégraphie) mais de mauvais arcs principaux. Ce test n'est pas la réalité A : c'est une variante faite pour mesurer la difficulté.

Le principe proposé pour toutes les fiches : **une sous-intrigue réussie donne un atout à l'arc principal**. Quatre familles d'atouts :

- **Aide** : un habitant gagné à la cause modifie sa journée pour aider (il accompagne, il retient quelqu'un, il garde la boutique).
- **Indice** : une information (souvent un secret) apparaît dans le carnet et rend visible une fenêtre de la frise A.
- **Geste débloqué** : un geste supplémentaire, ou un geste nouveau (« faire passer un mot », « remettre un objet »).
- **Personne gagnée** : affinité relevée au-dessus d'un seuil (0,5 pour les confidences, 0,6 pour les vraies conversations), ce qui ouvre des mécanismes aujourd'hui fermés.

### 2.1 Alice — graphiste, 29 ans

| | Arc principal (jour 1) | Second arc (jour suivant) |
|---|---|---|
| Titre | **Parler à Thomas de la campagne** (Ambition) | Une vraie soirée avec Sophie (Attachement) |
| Désir | Trouver le moment de parler à Thomas du projet de la nouvelle campagne. | Retrouver Sophie au café après le travail, sans parler boulot. |
| Tension | Si Thomas apprend l’offre avant qu’elle lui parle, il la croira déjà partie. | Entre les horaires de l’agence et ceux de la bibliothèque, les soirées communes sont rares. |
| Secret | Alice a reçu une offre d’une agence concurrente et n’a rien dit. → caché à **Thomas** | — |
| But vérifié | vraie conversation avec Thomas (profonde) | être à Café Le Papillon avec Sophie après 18:00 |
| Échéance · enjeu | 19:00 · 0,7 | 23:00 · 0,5 |
| Difficulté | 5 — Très difficile | 2 — Facile |
| Coups du sort | aucun | aucun |
| Issue en A (51) | **échoué** à 19:00 — Alice a croisé Thomas sans oser aller plus loin *(Échéance dépassée sans la conversation espérée)* | (non joué en A) |
| Autres graines | 7 : échoué 19:00, 29 : échoué 19:00, 42 : échoué 19:00 | |

*Objectifs du profil :* Décrocher le projet de la nouvelle campagne · Voir Sophie plus souvent · Trouver un meilleur équilibre.  
*Engagements du jour (statut en A) :* Travail — Agence Horizon (Agence Horizon, 09:00) — tenu ; Déjeuner Alice & Sophie (Chez Lucie, 12:30) — tenu.  
*Journée en A :* 13 échanges avec 6 personnes (Mireille, Sophie, Martin, Thomas, Julien, Élodie) ; humeur 0,26 → 0,09 ; argent 60 → 48 €.

**Diagnostic.** C'est l'arc le plus intéressant sur le papier (secret en miroir avec celui de Thomas) et **le seul arc principal impossible à gagner** (Thomas a le même problème avec son second arc, « Parler à Martin ») : entre un patron et son employée, `converse()` ne produit que « parlent boulot » (`encounter`), jamais `conversation`. Vérifié en B : une rencontre forcée au café à 18:00 ou au parc à 17:40 donne encore « Alice et Thomas parlent boulot ». La difficulté 5 affichée est en réalité infinie.

**Sous-intrigues qui aident l'arc principal (idées)**

- *La soirée avec Sophie (arc 2) comme aide.* Alice est au café à 18:07 en A, Sophie dîne Chez Lucie à 19:04. Si elles se retrouvent au café, Sophie (qui connaît le secret depuis 07:45) **pousse Alice** : bonus de courage (« Désir du jour » renforcé) et Alice va voir Thomas avant 19:00. Atout : *aide*.
- *Le secret de Thomas comme indice.* Si Alice apprend que l'agence a perdu son plus gros client (il faudrait que Thomas ait un confident, ou que Martin l'ait deviné), elle sait qu'elle est en position de force. Atout : *indice* + geste « négocier » **(à créer)**.
- *Élodie gagnée.* La voisine qui l'admire en silence (lettre jamais envoyée) pourrait lui rapporter ce qu'elle entend à la caisse du Marché Plus ou couvrir un retard. Atout : *personne gagnée*.

**Objectif principal proposé.** « **Annoncer à Thomas l'offre concurrente avant qu'il ne l'apprenne par la rumeur** » : but `talk_to` Thomas *hors de l'agence* (café, parc, bus) avant 19:00, avec coup de théâtre si la rumeur (Alice → Sophie à 07:45 → Nadia à 21:54 en A) atteint Thomas d'abord. Il faut au moteur une règle « patron/employé hors du lieu de travail = relation ordinaire ». Pourquoi : l'arc devient gagnable, et sa tension est déjà dans les données (le secret circule réellement en A).

### 2.2 Martin — comptable, 34 ans

| | Arc principal (jour 1) | Second arc (jour suivant) |
|---|---|---|
| Titre | **Sortir de la routine** (Courage) | Le dossier de la mairie (Devoir) |
| Désir | S’autoriser, pour une fois, un café au Papillon au lieu de la bibliothèque. | Déposer le dossier à la mairie avant la fermeture du guichet. |
| Tension | Le dossier de la mairie et le bilan trimestriel lui laissent peu de marge. | Le guichet ferme tôt et le bureau ne le libère jamais à l’heure. |
| Secret | Martin note depuis vingt ans les horaires réels du bus dans un carnet. → caché à **Julien** | — |
| But vérifié | être à Café Le Papillon après 12:00 | tenir l’engagement « Déposer un dossier à la mairie » |
| Échéance · enjeu | 22:00 · 0,45 | 17:10 · 0,6 |
| Difficulté | 2 — Facile | 2 — Facile |
| Coups du sort | aucun | aucun |
| Issue en A (51) | **échoué** à 22:00 — Martin n’a pas trouvé le temps *(Échéance dépassée)* | (non joué en A) |
| Autres graines | 7 : échoué 22:00, 29 : échoué 22:00, 42 : échoué 22:00 | |

*Objectifs du profil :* Boucler le bilan trimestriel · Oser sortir de la routine · Arriver le premier au bureau.  
*Engagements du jour (statut en A) :* Travail — Agence Horizon (Agence Horizon, 08:30) — en cours (non clos) ; Réunion bilan avec Thomas (Agence Horizon, 09:00) — tenu ; Déposer un dossier à la mairie (Hôtel de Ville, 16:40) — tenu.  
*Journée en A :* 11 échanges avec 5 personnes (Noé, Alice, Thomas, Gérard, Élodie) ; humeur 0,14 → 0,02 ; argent 90 → 87 €.

**Diagnostic.** Arc faible : aucun coup du sort, aucun antagoniste, l'échec vient seulement de ce que son score utilitaire ne choisit jamais le café après midi (il y est à 07:45, ce qui ne compte pas). Son secret (le carnet des horaires du bus) est **incommunicable** : Martin n'a ni ami, ni famille, ni couple. Pourtant Martin est au centre de deux fils sans le savoir : il reçoit à 19:42 le secret de Paul (par Gérard), et son carnet est la seule preuve possible dans l'affaire de la Ligne 1.

**Sous-intrigues (idées)**

- *Le dossier de la mairie (arc 2, tenu en A à 16:55)* libère Martin à 17:00 à deux pas du café : en faire la condition d'un « quartier libre ». Atout : *geste débloqué* (« Martin prend un café avec quelqu'un »).
- *Élodie*, rencontrée au parc à 18:09 : en graine 29 c'est Martin qui trouve et rend son portefeuille (18:10 → 19:00). Le portefeuille rendu = une invitation au café. Atout : *aide*.
- *Thomas (arc 2 de Thomas : « Parler à Martin »)* : si Thomas lui parle autrement que de chiffres, Martin ose. Atout : *personne gagnée*.

**Objectif principal proposé.** « **Remettre le carnet à Julien (ou le lui refuser)** avant l'interview de 14:30 » — un vrai choix moral : le carnet démontre peut-être que la Ligne 1 est à l'heure (Antoine blanchi, article de Julien ruiné) ou qu'elle ne l'est pas (Mireille avait raison). Pourquoi : Martin passe d'un arc de confort à un rôle de pivot entre Julien, Antoine et Mireille. Mécanique : remise d'objet **(à créer)**.

### 2.3 Sophie — bibliothécaire, 31 ans

| | Arc principal (jour 1) | Second arc (jour suivant) |
|---|---|---|
| Titre | **Tourner la page** (Réconciliation) | Le club de lecture (Devoir) |
| Désir | Passer la journée sans croiser Julien — ou le croiser sans se laisser troubler. | Préparer le club de lecture avec Inès sans se faire attendre. |
| Tension | Julien traîne au café et à la gare, deux endroits sur son chemin. | Inès est ponctuelle, pas Sophie. |
| Secret | Sophie garde encore toutes les lettres de Julien dans le tiroir du bureau. → caché à **Julien** | — |
| But vérifié | éviter Julien toute la journée | tenir l’engagement « Préparer le club de lecture » |
| Échéance · enjeu | fin de journée · 0,65 | 11:30 · 0,5 |
| Difficulté | 3 — Moyen | 2 — Facile |
| Coups du sort | 14:00 Julien vient faire des recherches à la bibliothèque où travaille Sophie (`force_action`) | aucun |
| Issue en A (51) | **échoué** à 10:27 — Sophie a croisé Julien malgré tout et n’a pas su quoi dire *(Présents au même endroit au même moment)* | (non joué en A) |
| Autres graines | 7 : échoué 09:26, 29 : bouleversé 09:27, 42 : échoué 10:03 | |

*Objectifs du profil :* Tourner la page avec Julien · Préparer le club de lecture · Prendre l’air au parc.  
*Engagements du jour (statut en A) :* Travail — Bibliothèque Municipale (Bibliothèque, 10:00) — tenu ; Déjeuner Alice & Sophie (Chez Lucie, 12:30) — tenu ; Préparer le club de lecture (Bibliothèque, 10:15) — tenu.  
*Journée en A :* 10 échanges avec 5 personnes (Alice, Inès, Julien, Paul, Nadia) ; humeur 0,24 → 0,16 ; argent 70 → 50 €.

**Diagnostic.** L'arc se règle **à 10:27** : Julien entre à la bibliothèque à 10:01 de lui-même, bien avant le coup du sort de 14:00 (qui n'apporte rien), et la première rencontre ferme l'histoire. Les deux disputes (13:27, 16:52) tombent sur un arc déjà clos. Même chose dans les autres graines (09:26, 09:27, 10:03). « Éviter » est un but passif qui se perd dès la première minute de coprésence.

**Sous-intrigues (idées)**

- *Le club de lecture avec Inès (arc 2, tenu en A à 10:10)* : Inès, gagnée, peut **retenir Julien** (ils passent 243 minutes ensemble à la bibliothèque sans un mot en A) ou le détourner vers une autre table. Atout : *aide*.
- *Le déjeuner avec Alice (tenu en A à 12:25)* : Alice, qui connaît Julien, peut le convaincre de ne pas revenir l'après-midi. Atout : *aide*.
- *Nadia*, amie 0,4, rencontrée au parc à 21:54 : une soirée avec elle plus tôt = un lieu sûr où Julien ne va pas. Atout : *indice* (où sera Julien).

**Objectif principal proposé.** « **Rendre les lettres à Julien** » (ou les brûler) : un but actif, `talk_to` Julien *hors du comptoir* avec un objet à remettre, échéance 19:00 (fin de service). Variante plus douce : garder « éviter » mais ne compter que les vraies conversations et les disputes, et poser une échéance (19:00). Pourquoi : la relation Sophie–Julien est la plus fréquente de la ville après Hugo–Inès ; en faire une confrontation choisie plutôt qu'un évitement raté.

### 2.4 Julien — journaliste, 33 ans

| | Arc principal (jour 1) | Second arc (jour suivant) |
|---|---|---|
| Titre | **Revoir Sophie** (Cœur) | L’interview d’Antoine (Ambition) |
| Désir | Croiser Sophie « par hasard » et lui parler vraiment. | Obtenir enfin l’interview du chauffeur de la Ligne 1. |
| Tension | Sophie l’évite, et Antoine, qu’il doit interviewer, ne doit rien savoir de l’article. | Antoine se méfie des journalistes et Julien n’est jamais à l’heure. |
| Secret | L’article de Julien accuse la Ligne 1 de retards chroniques sans aucune preuve. → caché à **Antoine** | — |
| But vérifié | vraie conversation avec Sophie (profonde) | tenir l’engagement « Interview d’Antoine sur la ligne de bus » |
| Échéance · enjeu | 22:00 · 0,7 | 15:30 · 0,6 |
| Difficulté | 5 — Très difficile | 2 — Facile |
| Coups du sort | aucun | aucun |
| Issue en A (51) | **échoué** à 22:00 — Julien a croisé Sophie sans oser aller plus loin *(Échéance dépassée sans la conversation espérée)* | (non joué en A) |
| Autres graines | 7 : échoué 22:00, 29 : accompli 09:27, 42 : échoué 22:00 | |

*Objectifs du profil :* Finir l’article sur la ligne de bus · Revoir Sophie sans se l’avouer · Ne pas rater le café du matin.  
*Engagements du jour (statut en A) :* Interview d’Antoine sur la ligne de bus (Gare routière, 14:30) — tenu.  
*Journée en A :* 10 échanges avec 7 personnes (Hugo, Sophie, Antoine, Alice, Karim, Thomas, Mireille) ; humeur 0,24 → -0,09 ; argent 45 → 15 €.

**Diagnostic.** Quatre échanges avec Sophie, deux disputes, mais **tous au comptoir de la bibliothèque**, où aucune vraie conversation n'est possible. Le seul moment hors comptoir est le parc vers 21:43–22:00, d'où l'échec à l'échéance. En graine 29, une rencontre au parc à 09:27 suffit à réussir : l'issue dépend du lieu, pas du personnage.

**Sous-intrigues (idées)**

- *L'interview d'Antoine (arc 2, tenue en A 14:25–15:00)* : réussie, elle donne à Julien de quoi impressionner Sophie (« je n'ai rien publié sans preuve »). Atout : *personne gagnée* (Sophie moins hostile : affinité ex remontée).
- *Hugo*, son ami (confident en graines 7 et 29) : Hugo peut faire passer un message à Sophie au café. Atout : *geste débloqué* (« faire passer un mot ») **(à créer)**.
- *Le carnet de Martin* : une preuve. Atout : *indice* qui change l'arc de Julien de « romance » à « rédemption ».

**Objectif principal proposé.** Garder « Revoir Sophie » mais l'adosser à l'article : « **Publier un article vrai** » (obtenir avant 18:00 le carnet de Martin ou le témoignage de Mireille). La tension avec Sophie devient l'enjeu secondaire. Pourquoi : Julien a quatre liens avec l'affaire de la Ligne 1 (Antoine, Martin, Mireille, Thomas) et un seul avec Sophie.

### 2.5 Camille — boulangère, 42 ans

| | Arc principal (jour 1) | Second arc (jour suivant) |
|---|---|---|
| Titre | **Vendre toute la fournée** (Fierté) | Une vraie pause (Attachement) |
| Désir | Fermer boutique avec les étagères vides avant quatorze heures. | S’asseoir au parc une fois la boutique fermée. |
| Tension | Si Lucie, sa meilleure cliente, l’apprend par la rumeur, elle se sentira trahie. | Il y a toujours une raison de rester au four. |
| Secret | Camille songe à vendre la boulangerie et n’en a parlé à personne. → caché à **Lucie** | — |
| But vérifié | boulangerie vide à la fermeture | être à Parc des Tilleuls après 14:00 |
| Échéance · enjeu | 14:00 · 0,55 | 19:00 · 0,4 |
| Difficulté | 2 — Facile | 2 — Facile |
| Coups du sort | aucun | aucun |
| Issue en A (51) | **échoué** à 14:00 — Camille ferme avec 12 pains invendus *(Stock restant à la fermeture)* | (non joué en A) |
| Autres graines | 7 : échoué 14:00, 29 : accompli 14:00, 42 : échoué 14:00 | |

*Objectifs du profil :* Vendre toute la fournée · Prendre une vraie pause · Convaincre Lucie de commander chaque jour.  
*Engagements du jour (statut en A) :* Travail — Boulangerie Au Levain d’Or (Boulangerie, 06:30) — tenu.  
*Journée en A :* 8 échanges avec 6 personnes (Mireille, Hugo, Léa, Gérard, Yasmine, Paul) ; humeur -0,05 → 0,22 ; argent 120 → 114 €.

**Diagnostic.** Arc sans antagoniste et presque sans clients : un seul habitant achète du pain avant 14:00 (Hugo, 06:43). L'échec est constaté à 14:00 (« 12 pains invendus »), mais la boulangerie reste ouverte et « ferme plus tôt : tout est vendu » à 16:24 — l'arc est jugé avant la fin réelle de la vente. Son secret (vendre la boulangerie) est bloqué : sa seule confidente possible est Lucie, celle à qui il est caché.

**Sous-intrigues (idées)**

- *Lucie et son pain* : si Lucie vient (son coup du sort l'en empêche à 09:00), elle achète pour le restaurant. Atout : *aide* (une grosse vente).
- *Gérard et le pain frais pour Noé (arc 2 de Gérard)* : un client fidèle de plus, et Gérard bavarde. Atout : *personne gagnée*.
- *Paul et son cadeau* : s'il ose passer, Camille hésite à vendre. Atout : *indice* (« quelqu'un tient à cette boutique »).

**Objectif principal proposé.** « **Décider de vendre ou non** » : fidéliser au moins quatre habitués (Lucie, Gérard, Mireille, Paul) avant 14:00 — sinon elle signe avec un repreneur (le 21ᵉ habitant, voir §5). Pourquoi : transforme une jauge de stock en choix de vie, relie la boulangerie à quatre arcs, et donne un antagoniste (le repreneur).

### 2.6 Hugo — barista, 26 ans

| | Arc principal (jour 1) | Second arc (jour suivant) |
|---|---|---|
| Titre | **Comprendre Inès** (Curiosité) | La séance avec Karim (Devoir) |
| Désir | Comprendre pourquoi Inès vient tous les jours au café. | Ne pas poser un lapin à Karim à la salle. |
| Tension | Karim croit qu’il a réussi ; la vérité finira par circuler. | Après le service, la fatigue gagne souvent. |
| Secret | Hugo a raté le concours de barista et l’a caché à Karim. → caché à **Karim** | — |
| But vérifié | vraie conversation avec Inès (profonde) après 15:00 | tenir l’engagement « Séance de sport avec Karim » |
| Échéance · enjeu | 22:00 · 0,6 | 19:00 · 0,5 |
| Difficulté | 4 — Difficile | 2 — Facile |
| Coups du sort | aucun | aucun |
| Issue en A (51) | **échoué** à 22:00 — Hugo a croisé Inès sans oser aller plus loin *(Échéance dépassée sans la conversation espérée)* | (non joué en A) |
| Autres graines | 7 : accompli 15:42, 29 : échoué 22:00, 42 : accompli 18:47 | |

*Objectifs du profil :* Faire le meilleur café de la ville · Aller à la salle avec Karim · Comprendre pourquoi Inès vient tous les jours.  
*Engagements du jour (statut en A) :* Travail — Café Le Papillon (Café Le Papillon, 07:00) — tenu ; Séance de sport avec Karim (Gymnase Central, 17:30) — manqué ; Chercher les viennoiseries pour le café (Boulangerie, 06:45) — tenu.  
*Journée en A :* 13 échanges avec 4 personnes (Karim, Inès, Julien, Camille) ; humeur 0,36 → 0,28 ; argent 40 → 1 €.

**Diagnostic.** Arc honnête mais **réglé par le hasard** : réussi en graines 7 (15:42) et 42 (18:47), échoué en 51 et 29 ; en 51 la vraie conversation arrive à 22:13, après l'échéance. Le matin, toutes les rencontres avec Inès se font au comptoir du café (impossible d'aller plus loin). Le coup du sort de Karim (« rappelé au café ») ne l'envoie pas au café : il reste chez lui, à côté d'Inès. Son argent tombe de 40 à 1 €.

**Sous-intrigues (idées)**

- *La séance avec Karim (arc 2)* : la tenir, c'est avouer (ou non) le concours raté. Atout : *personne gagnée* (Karim, qui peut à son tour lui conseiller d'aller parler à Inès).
- *Le mémoire d'Inès* (son secret) : si Hugo l'apprend (via Mireille), il comprend « pourquoi Inès vient tous les jours » — l'arc est accompli par l'indice. Atout : *indice*.
- *Léa* (béguin caché) : une rencontre au café rend la scène triangulaire. Atout : *dilemme*.

**Objectif principal proposé.** « **Avouer à Karim le concours raté avant la séance de 17:30** » (le secret devient l'objectif, la conversation avec Inès devient la sous-intrigue). Pourquoi : l'arc actuel est passif et aléatoire ; l'aveu est un acte, daté, avec un risque (Julien sait, la rumeur peut le devancer).

### 2.7 Léa — lycéenne, 17 ans (tutoriel)

| | Arc principal (jour 1) | Second arc (jour suivant) |
|---|---|---|
| Titre | **À l’heure au lycée** (Courage) | Retrouver Noé (Attachement) |
| Désir | Arriver à l’heure au lycée, pour une fois. | Retrouver Noé au parc après les cours. |
| Tension | Le bus de 8 h 10 n’attend personne, et Léa part toujours au dernier moment. | Noé a quelque chose à lui dire et elle le sent. |
| Secret | Léa a un faible pour Hugo, le barista. → caché à **Hugo** | — |
| But vérifié | arriver à l’heure (≤ 5 min) au lycée | tenir l’engagement « Retrouvailles au parc après les cours » |
| Échéance · enjeu | 09:00 · 0,6 | 18:00 · 0,55 |
| Difficulté | 1 — Entraînement | 2 — Facile |
| Coups du sort | 07:50 Léa ne retrouve pas son sac de cours et rate le bus (`agent_delay` 45 min, seulement si chez soi) | aucun |
| Issue en A (51) | **échoué** à 08:41 — Léa est encore en retard (11 min) *(Arrivée après l’heure de début de l’engagement)* | (non joué en A) |
| Autres graines | 7 : échoué 08:41, 29 : accompli 08:11, 42 : échoué 08:41 | |

*Objectifs du profil :* Ne pas arriver en retard (encore) · Retrouver Noé au parc · Économiser pour un vélo.  
*Engagements du jour (statut en A) :* Cours au lycée (École Jules Ferry, 08:30) — tenu, 11 min de retard ; Retrouvailles au parc après les cours (Parc des Tilleuls, 16:45) — tenu.  
*Journée en A :* 8 échanges avec 4 personnes (Yasmine, Noé, Camille, Nadia) ; humeur 0,17 → 0,28 ; argent 15 → 15 €.

**Diagnostic.** Bon tutoriel (un geste suffit) mais **la journée de Léa s'arrête à 08:41**. Elle ne prend jamais le bus en A (affinité bus 0,8 pourtant). Elle est la cible de **deux** secrets de départ (Noé admis loin, Nadia tentée par un poste à la grande ville), ce qui en fait potentiellement le personnage le plus dramatique de la ville.

**Sous-intrigues (idées)**

- *Retrouver Noé (arc 2, tenu en A 16:40–17:30)* : déjà réussi ; le prolonger après 17:30 permet la vraie conversation que Noé n'arrive pas à avoir. Atout : *aide* pour l'arc de Noé.
- *Yasmine (prof)* remarque son retard à 08:41 ; à l'heure, Yasmine la félicite → l'information remonte à Nadia. Atout : *personne gagnée*.
- *Hugo* : passer au café avant le lycée (le béguin) est la tentation qui la met en retard. Atout : *dilemme*.

**Objectif principal proposé.** Garder « À l'heure au lycée » comme boucle 1, puis un arc de boucle 2 : « **Apprendre ce qu'on lui cache** » (l'un des deux départs) avant 21:00. Pourquoi : capitalise sur la structure des secrets (Léa est une cible double) et donne une suite naturelle au tutoriel. Lien causal à créer : la privation de sortie de 17:40 devrait **découler** du retard du matin (aujourd'hui c'est un coup du sort de l'arc de Noé, sans cause).

### 2.8 Nadia — médecin, 45 ans

| | Arc principal (jour 1) | Second arc (jour suivant) |
|---|---|---|
| Titre | **Le café avec Yasmine** (Attachement) | Du temps avec Léa (Attachement) |
| Désir | Finir les consultations à l’heure pour retrouver Yasmine. | Passer un moment avec Léa, hors des reproches sur les retards. |
| Tension | Léa ne sait pas qu’un déménagement se discute. | Les horaires du cabinet et du lycée se croisent rarement. |
| Secret | Nadia a reçu une proposition de poste à l’hôpital de la grande ville. → caché à **Léa** | — |
| But vérifié | tenir l’engagement « Café entre amies » | vraie conversation avec Léa (profonde) après 17:00 |
| Échéance · enjeu | 20:30 · 0,65 | 23:00 · 0,5 |
| Difficulté | 2 — Facile | 4 — Difficile |
| Coups du sort | 18:45 Une urgence retient Nadia au cabinet (`agent_delay` 75 min) | aucun |
| Issue en A (51) | **échoué** à 19:54 — Nadia n’y est pas arrivée *(Nadia a choisi « Travail — Cabinet médical du Dr Fontaine » (Cabinet médical du Dr Fontaine))* | (non joué en A) |
| Autres graines | 7 : échoué 19:54, 29 : échoué 19:54, 42 : échoué 19:54 | |

*Objectifs du profil :* Finir les consultations à l’heure · Passer du temps avec Léa · Un café avec Yasmine.  
*Engagements du jour (statut en A) :* Travail — Cabinet médical du Dr Fontaine (Cabinet médical, 08:00) — tenu ; Rendez-vous médical (Cabinet médical, 09:00) — tenu ; Café entre amies (Café Le Papillon, 19:30) — manqué.  
*Journée en A :* 5 échanges avec 3 personnes (Gérard, Léa, Sophie) ; humeur 0,27 → 0,19 ; argent 200 → 200 €.

**Diagnostic.** Arc d'agenda pur (un rendez-vous et un coup du sort de gravité 2). Nadia passe 07:34–20:09 au cabinet, cinq échanges dans la journée ; Nadia et Yasmine ne sont **jamais au même endroit**. Son secret (proposition de poste) est fort mais ne vit pas : ses confidentes possibles sont Léa (la cible) et Yasmine (qu'elle ne voit pas).

**Sous-intrigues (idées)**

- *Gérard, son patient de 09:00* : il sait (son secret) qu'on lui a déconseillé le bus ; s'il fait un malaise, c'est l'« urgence » de 18:45 qui prend une cause. Atout : *indice* (on sait d'où vient l'urgence, on peut l'éviter).
- *Du temps avec Léa (arc 2)* : elles bavardent à 20:09 et 22:17 en A ; une vraie conversation ouvre l'aveu du poste. Atout : *aide*.
- *Sophie*, amie 0,4, croisée à 21:54 : lui apporte la rumeur sur Alice — Nadia est déjà un relais de rumeurs. Atout : *indice*.

**Objectif principal proposé.** « **Dire à Léa, avant minuit, qu'un départ se discute — ou refuser le poste** » : deux issues accomplies possibles (aveu / renoncement), un coup de théâtre si Léa l'apprend par d'autres. Le café avec Yasmine devient l'étape qui donne le courage (sous-intrigue). Pourquoi : le secret le plus lourd de la ville est aujourd'hui décoratif.

### 2.9 Noé — lycéen, 17 ans

| | Arc principal (jour 1) | Second arc (jour suivant) |
|---|---|---|
| Titre | **Parler à Léa de ses projets** (Courage) | Le livre d’astronomie (Curiosité) |
| Désir | Oser dire à Léa qu’il veut partir étudier l’astronomie. | Emprunter le livre d’astronomie avant la fermeture. |
| Tension | Si Léa l’apprend par quelqu’un d’autre, elle ne lui pardonnera pas. | La bibliothèque ferme et le contrôle de maths approche. |
| Secret | Noé a été admis à l’école d’astronomie, loin d’ici, pour l’an prochain. → caché à **Léa** | — |
| But vérifié | vraie conversation avec Léa (profonde) après 16:30 | tenir l’engagement « Emprunter le livre d’astronomie » |
| Échéance · enjeu | 21:00 · 0,75 | 18:10 · 0,45 |
| Difficulté | 5 — Très difficile | 2 — Facile |
| Coups du sort | 17:40 Léa est privée de sortie ce soir (`stay_home` jusqu’à 24:00) | aucun |
| Issue en A (51) | **échoué** à 21:00 — Noé a croisé Léa sans oser aller plus loin *(Échéance dépassée sans la conversation espérée)* | (non joué en A) |
| Autres graines | 7 : échoué 21:00, 29 : échoué 21:00, 42 : échoué 21:00 | |

*Objectifs du profil :* Réussir le contrôle de maths · Oser parler à Léa de ses projets · Emprunter le livre d’astronomie.  
*Engagements du jour (statut en A) :* Cours au lycée (École Jules Ferry, 08:30) — tenu ; Retrouvailles au parc après les cours (Parc des Tilleuls, 16:45) — tenu ; Emprunter le livre d’astronomie (Bibliothèque, 17:40) — tenu.  
*Journée en A :* 11 échanges avec 5 personnes (Martin, Gérard, Yasmine, Léa, Inès) ; humeur 0 → 0,16 ; argent 20 → 20 €.

**Diagnostic.** Noé et Léa passent 527 minutes au même endroit (record de la ville) et ont un rendez-vous tenu, mais **le rendez-vous empêche la vraie conversation** (une activité d'engagement rend « occupé », donc pas de conversation profonde). Le coup du sort de 17:40 (Léa privée de sortie) ferme la fenêtre restante.

**Sous-intrigues (idées)**

- *Le livre d'astronomie (arc 2, emprunté en A à 17:33–17:55)* : en faire un objet à montrer à Léa — le livre ouvre la conversation. Atout : *geste débloqué* (« remettre un objet »).
- *Gérard* (famille 0,8, confident possible) : si Noé se confie à lui le matin (bavardage 07:42 en A), Gérard peut couvrir Léa auprès de Nadia, ou… répéter à Mireille (risque). Atout : *aide* / risque.
- *Yasmine* (prof) : une lettre de recommandation, un mot à Léa. Atout : *aide*.

**Objectif principal proposé.** Garder l'objectif (il est fort) mais **corriger la mécanique** : autoriser la vraie conversation pendant un rendez-vous entre proches, et rendre le coup du sort de 17:40 conditionnel (voir Léa). Pourquoi : aujourd'hui la scène est écrite mais le moteur l'interdit.

### 2.10 Gérard — retraité, 72 ans

| | Arc principal (jour 1) | Second arc (jour suivant) |
|---|---|---|
| Titre | **La pétanque avec Paul** (Attachement) | Du pain frais pour Noé (Attachement) |
| Désir | Être au parc à quinze heures pour la partie avec Paul. | Rapporter du pain chaud à la maison. |
| Tension | Noé s’inquiéterait ; Gérard préfère se taire. | Camille ferme dès la dernière baguette vendue. |
| Secret | Le médecin a conseillé à Gérard de ne plus prendre le bus seul. → caché à **Noé** | — |
| But vérifié | tenir l’engagement « Partie de pétanque » | être à Boulangerie |
| Échéance · enjeu | 16:30 · 0,6 | 14:00 · 0,4 |
| Difficulté | 2 — Facile | 2 — Facile |
| Coups du sort | 14:35 Une commande urgente retient Paul à l’atelier (`agent_delay` 65 min) | aucun |
| Issue en A (51) | **échoué** à 15:38 — Gérard n’y est pas arrivé *(Paul a choisi « Travail — Atelier Dupré » (Atelier Dupré))* | (non joué en A) |
| Autres graines | 7 : échoué 15:38, 29 : échoué 15:38, 42 : échoué 15:38 | |

*Objectifs du profil :* Ne pas rater le rendez-vous chez le médecin · La partie de pétanque avec Paul · Rapporter du pain frais pour Noé.  
*Engagements du jour (statut en A) :* Rendez-vous médical (Cabinet médical, 09:00) — tenu ; Partie de pétanque (Parc des Tilleuls, 15:00) — manqué.  
*Journée en A :* 16 échanges avec 8 personnes (Karim, Noé, Nadia, Antoine, Mireille, Martin, Camille, Paul) ; humeur 0,39 → 0,59 ; argent 80 → 62 €.

**Diagnostic.** Le personnage le plus social de la ville (16 échanges, 8 interlocuteurs, 6 passages au parc) et un **relais de secrets** (reçoit celui de Paul à 18:25, confie le sien à Mireille à 18:52, répète celui de Paul à Martin à 19:42). Son arc (pétanque) est un rendez-vous que le coup du sort sur Paul rend impossible. Ironie déjà présente en A : il prend le bus **seul** à 08:25 et 09:25, exactement ce que le médecin lui a déconseillé.

**Sous-intrigues (idées)**

- *Le pain frais pour Noé (arc 2)* : passer à la boulangerie, c'est croiser Camille (qui connaît Paul) ; Camille peut aller chercher Paul à l'atelier. Atout : *aide*.
- *Mireille*, amie : à qui il confie son secret à 18:52 ; si elle l'accompagne dans le bus, le secret est tenu (il n'est plus « seul »). Atout : *aide*.
- *Antoine*, rencontré dans le bus à 09:26 : le chauffeur qui veille sur lui. Atout : *personne gagnée*.

**Objectif principal proposé.** « **Tenir sa journée sans que Noé apprenne l'avis du médecin** » (pétanque comprise) : chaque trajet en bus seul est un risque (malaise possible), chaque confidence une fuite. Pourquoi : Gérard est le carrefour de la ville ; un arc de discrétion exploite sa sociabilité comme une menace.

### 2.11 Yasmine — institutrice, 38 ans

| | Arc principal (jour 1) | Second arc (jour suivant) |
|---|---|---|
| Titre | **Des fleurs pour la classe** (Devoir) | Décompresser avec Nadia (Attachement) |
| Désir | Passer chez Chloé à midi pour les fleurs de la sortie scolaire. | Retrouver Nadia au café le soir. |
| Tension | La pause de midi est courte et Chloé déborde toujours. | Nadia finit toujours tard. |
| Secret | Yasmine a été approchée pour diriger l’école. → caché à **Nadia** | — |
| But vérifié | tenir l’engagement « Fleurs pour la classe » | tenir l’engagement « Café entre amies » |
| Échéance · enjeu | 13:00 · 0,55 | 21:00 · 0,5 |
| Difficulté | 2 — Facile | 2 — Facile |
| Coups du sort | 11:45 Chloé part livrer des bouquets à la mairie (`force_action`) ; 11:58 La livraison de Chloé s’éternise à la mairie (`agent_delay` 40 min) | aucun |
| Issue en A (51) | **échoué** à 12:27 — Yasmine n’y est pas arrivée *(Yasmine est encore en chemin (parti à 12:27) ; Chloé a choisi « Se promener (Hôtel de Ville) » (Hôtel de Ville))* | (non joué en A) |
| Autres graines | 7 : échoué 12:27, 29 : échoué 12:27, 42 : échoué 12:27 | |

*Objectifs du profil :* Préparer la sortie scolaire · Décompresser avec Nadia · Acheter des fleurs pour la classe.  
*Engagements du jour (statut en A) :* Travail — École Jules Ferry (École Jules Ferry, 08:00) — tenu ; Café entre amies (Café Le Papillon, 19:30) — manqué ; Fleurs pour la classe (Fleurs & Sens, 12:10) — manqué.  
*Journée en A :* 15 échanges avec 8 personnes (Chloé, Karim, Léa, Noé, Antoine, Camille, Élodie, Paul) ; humeur 0,25 → 0,26 ; argent 110 → 107 €.

**Diagnostic.** Arc d'agenda : deux coups du sort sur Chloé (livraison à la mairie) suffisent. Yasmine attend chez le fleuriste de 11:59 à 12:27 ; le récit de l'échec dit pourtant « Yasmine est encore en chemin ». Le soir, elle attend Nadia au café (19:03–19:54) en même temps que Chloé (café 19:03–19:43) : la confidence de Chloé n'arrive qu'à 21:53.

**Sous-intrigues (idées)**

- *Décompresser avec Nadia (arc 2)* : réussi, le café permet l'échange des deux secrets de carrière. Atout : *indice*.
- *Chloé* (amie, voisine) : si les fleurs ont lieu, Chloé lui confie la surprise à midi au lieu de 21:53 → Yasmine peut aider le dîner. Atout : *aide* pour l'arc de Chloé.
- *Léa et Noé* (élèves) : la sortie scolaire comme scène commune. Atout : *personne gagnée*.

**Objectif principal proposé.** « **Accepter ou refuser la direction de l'école** » : en parler à Nadia avant 21:00 (aide) ; les fleurs de midi deviennent la sous-intrigue qui libère du temps. Pourquoi : un secret de carrière en miroir avec Nadia, deux amies qui ne se voient jamais.

### 2.12 Thomas — directeur d'agence, 51 ans

| | Arc principal (jour 1) | Second arc (jour suivant) |
|---|---|---|
| Titre | **Déjeuner chez Lucie** (Ambition) | Parler à Martin (Fierté) |
| Désir | Déjeuner chez Lucie et lui proposer un partenariat pour l’agence. | Prendre le temps de parler à Martin autrement que par des chiffres. |
| Tension | Si l’équipe l’apprend par la rumeur, le moral s’effondre. | Thomas ne sait parler que de résultats. |
| Secret | L’Agence Horizon a perdu son plus gros client la semaine dernière. → caché à **Alice** | — |
| But vérifié | tenir l’engagement « Déjeuner chez Lucie » | vraie conversation avec Martin (profonde) |
| Échéance · enjeu | 14:00 · 0,6 | 19:00 · 0,45 |
| Difficulté | 2 — Facile | 4 — Difficile |
| Coups du sort | 12:10 Une réunion s’éternise pour Thomas (`agent_delay` 85 min) | aucun |
| Issue en A (51) | **échoué** à 13:31 — Thomas n’y est pas arrivé *(Rendez-vous manqué)* | (non joué en A) |
| Autres graines | 7 : échoué 13:31, 29 : échoué 13:31, 42 : échoué 13:31 | |

*Objectifs du profil :* Décrocher le contrat Horizon · Que l’équipe soit à l’heure · Déjeuner chez Lucie.  
*Engagements du jour (statut en A) :* Travail — Agence Horizon (Agence Horizon, 08:00) — tenu ; Réunion bilan avec Thomas (Agence Horizon, 09:00) — tenu ; Déjeuner chez Lucie (Chez Lucie, 12:45) — manqué.  
*Journée en A :* 7 échanges avec 4 personnes (Martin, Alice, Lucie, Julien) ; humeur 0,34 → 0,13 ; argent 400 → 380 €.

**Diagnostic.** Thomas passe 07:29–19:00 à l'agence sans déjeuner (coup du sort de 12:10), puis dîne Chez Lucie à 19:02 : il va bien chez Lucie, mais trop tard pour l'arc. Sept échanges, aucun profond (patron, comptoir). Son secret (client perdu) est **bloqué** : aucun confident (Lucie 0,4 < 0,5). Avec Lucie, deux entreprises fragiles s'apprêtent à s'associer en se cachant leur faiblesse.

**Sous-intrigues (idées)**

- *Parler à Martin (arc 2)* : Martin, qui tient les chiffres, devient l'allié qui sait que l'agence va mal. Atout : *aide*.
- *Lucie* : un échange vrai (pas au comptoir) avant le déjeuner. Atout : *personne gagnée*.
- *Alice* : la garder. Atout : *indice* (l'offre concurrente).

**Objectif principal proposé.** « **Sauver l'agence en gardant Alice** » ou « **signer le partenariat avec Lucie sans révéler le client perdu** ». Pourquoi : le déjeuner est un simple rendez-vous ; l'enjeu réel (agence en danger) est dans le secret et touche Alice, Martin, Lucie et Julien.

### 2.13 Inès — étudiante, 24 ans

| | Arc principal (jour 1) | Second arc (jour suivant) |
|---|---|---|
| Titre | **Oser parler à Hugo** (Cœur) | Tenir le budget (Devoir) |
| Désir | Avoir, enfin, une vraie conversation avec Hugo. | Finir la journée avec au moins 15 € en poche. |
| Tension | Le café est plein, Hugo est pris, et le budget d’Inès ne permet pas dix cafés. | Chaque café est un choix. |
| Secret | Le mémoire d’Inès porte sur l’histoire du Café Le Papillon. → caché à **Hugo** | — |
| But vérifié | vraie conversation avec Hugo (profonde) après 15:00 | garder au moins 15 € |
| Échéance · enjeu | 22:00 · 0,75 | fin de journée · 0,5 |
| Difficulté | 5 — Très difficile | 2 — Facile |
| Coups du sort | 15:00 Inès doit rendre un chapitre de mémoire avant 18 h (`stay_home` jusqu’à 18:00) | aucun |
| Issue en A (51) | **échoué** à 22:00 — Inès a croisé Hugo sans oser aller plus loin *(Échéance dépassée sans la conversation espérée)* | (non joué en A) |
| Autres graines | 7 : accompli 15:42, 29 : échoué 22:00, 42 : accompli 18:47 | |

*Objectifs du profil :* Avancer le mémoire · Oser parler à Hugo · Tenir le budget jusqu’à la fin du mois.  
*Engagements du jour (statut en A) :* Préparer le club de lecture (Bibliothèque, 10:15) — tenu.  
*Journée en A :* 14 échanges avec 4 personnes (Hugo, Karim, Sophie, Noé) ; humeur 0,25 → 0,13 ; argent 25 → 1 €.

**Diagnostic.** Comme Hugo : réussite par chance (7, 42), échec à 13 minutes près en 51. Son secret (mémoire sur le café) est bloqué (seul confident : Hugo, la cible). Son budget (arc 2) est déjà perdu en A : 25 → 1 €. Elle passe 243 minutes à la bibliothèque à côté de Julien sans un mot.

**Sous-intrigues (idées)**

- *Mireille, source du mémoire* : une rencontre au café (14:18) lui donne un chapitre — et le coup du sort de 15:00 (« rendre un chapitre avant 18 h ») est levé plus tôt. Atout : *geste débloqué* (sortie avant 18:00).
- *Le club de lecture avec Sophie (tenu 10:10)* : Sophie lui prête un livre sur le Papillon, prétexte pour aller voir Hugo. Atout : *indice*.
- *Tenir le budget (arc 2)* : chaque café non acheté rend la visite au comptoir moins « justifiée » ; un café offert par Hugo devient un signe. Atout : *personne gagnée*.

**Objectif principal proposé.** Garder « Oser parler à Hugo » mais lui donner un objet : « **Montrer à Hugo le chapitre sur l'histoire du Papillon** ». Pourquoi : l'objet crée le prétexte de conversation hors comptoir et transforme le secret en cadeau (ou en gêne).

### 2.14 Paul — menuisier, 58 ans

| | Arc principal (jour 1) | Second arc (jour suivant) |
|---|---|---|
| Titre | **Livrer la commode** (Fierté) | Parler à Camille (Courage) |
| Désir | Remettre enfin sa commode à Mireille. | Passer à la boulangerie et parler à Camille d’autre chose que de pain. |
| Tension | Mireille raconte tout ; un secret confié à l’atelier fait le tour du quartier. | Paul parle peu, et Camille est toujours occupée. |
| Secret | Paul a sculpté un cadeau pour Camille qu’il n’ose pas lui donner. → caché à **Camille** | — |
| But vérifié | tenir l’engagement « Récupérer la commode chez Paul » | vraie conversation avec Camille (profonde) |
| Échéance · enjeu | 12:00 · 0,55 | 14:00 · 0,5 |
| Difficulté | 2 — Facile | 4 — Difficile |
| Coups du sort | 10:15 Mireille s’attarde à bavarder et oublie l’heure (`agent_delay` 100 min) | aucun |
| Issue en A (51) | **échoué** à 11:39 — Paul n’y est pas arrivé *(Mireille est encore en chemin (parti à 10:10, retardé))* | (non joué en A) |
| Autres graines | 7 : échoué 11:39, 29 : accompli 10:50, 42 : échoué 11:39 | |

*Objectifs du profil :* Finir la commode de Mme Lambert · La partie de pétanque · Parler moins, écouter plus.  
*Engagements du jour (statut en A) :* Travail — Atelier Dupré (Atelier Dupré, 07:00) — tenu ; Récupérer la commode chez Paul (Atelier Dupré, 10:30) — manqué ; Partie de pétanque (Parc des Tilleuls, 15:00) — manqué.  
*Journée en A :* 5 échanges avec 5 personnes (Gérard, Mireille, Camille, Sophie, Yasmine) ; humeur -0,06 → 0,25 ; argent 150 → 150 €.

**Diagnostic.** Deux coups du sort lui font manquer **deux** rendez-vous (commode 11:39, pétanque 15:38) : Paul subit. Son second arc (« Parler à Camille » avant 14:00) est structurellement impossible : avant 14:00, Camille est au comptoir de la boulangerie. Le secret du cadeau circule en A (Paul → Gérard 18:25 → Martin 19:42) mais pas vers Camille, alors que Gérard et Camille discutent encore au parc à 19:22, une heure après la confidence.

**Sous-intrigues (idées)**

- *La commode livrée à Mireille* : la commode est le prétexte d'une sortie ; mais Mireille à l'atelier verrait le cadeau sculpté → rumeur. Atout : *risque calculé*.
- *La pétanque avec Gérard* : Gérard, confident, peut porter le cadeau à Camille (il la voit au parc en A). Atout : *aide*.
- *Sophie*, voisine (Maison du Canal) : le conseil d'une lectrice. Atout : *personne gagnée*.

**Objectif principal proposé.** « **Offrir le cadeau à Camille avant qu'elle ne vende** » (après 14:00, hors comptoir). Pourquoi : relie Paul à Camille (secret de vente), Mireille (rumeur), Gérard (messager) ; la commode devient l'obstacle d'agenda.

### 2.15 Chloé — fleuriste, 36 ans

| | Arc principal (jour 1) | Second arc (jour suivant) |
|---|---|---|
| Titre | **Le dîner avec Antoine** (Cœur) | Les bouquets de la mairie (Devoir) |
| Désir | Dîner avec Antoine à l’heure, pour une fois. | Livrer les bouquets à la mairie dans l’après-midi. |
| Tension | Antoine rentre rarement à l’heure annoncée et Mireille adore les surprises… des autres. | La boutique ne se garde pas toute seule. |
| Secret | Chloé a réservé des vacances surprise pour Antoine. → caché à **Antoine** | — |
| But vérifié | tenir l’engagement « Dîner à la maison » | être à Hôtel de Ville |
| Échéance · enjeu | 21:30 · 0,65 | 18:00 · 0,45 |
| Difficulté | 2 — Facile | 2 — Facile |
| Coups du sort | 19:10 Antoine file à la salle retrouver Karim (`force_action`) ; 19:25 Antoine s’attarde à la salle avec Karim (`agent_delay` 80 min) | aucun |
| Issue en A (51) | **échoué** à 20:35 — Chloé n’y est pas arrivée *(Antoine a choisi « Faire du sport (Gymnase Central) » (Gymnase Central))* | (non joué en A) |
| Autres graines | 7 : échoué 20:35, 29 : échoué 20:35, 42 : échoué 20:35 | |

*Objectifs du profil :* Livrer les bouquets de la mairie · Dîner avec Antoine · Convaincre Antoine de prendre des vacances.  
*Engagements du jour (statut en A) :* Travail — Fleurs & Sens (Fleurs & Sens, 09:00) — tenu ; Dîner à la maison (Villa Rosa, 20:00) — manqué ; Fleurs pour la classe (Fleurs & Sens, 12:10) — manqué.  
*Journée en A :* 4 échanges avec 2 personnes (Yasmine, Mireille) ; humeur 0,2 → -0,05 ; argent 95 → 65 €.

**Diagnostic.** L'arc est bon, l'exécution est vide : Chloé et Antoine ne sont jamais au même endroit de la journée (0 minute, 4 graines sur 4). Le coup du sort de l'arc de Yasmine l'envoie à la mairie à 11:45 — ce qui réalise d'ailleurs son second arc (« livrer les bouquets de la mairie »). Elle se confie à Yasmine à 21:53, trop tard pour que cela change quoi que ce soit.

**Sous-intrigues (idées)**

- *Les bouquets de la mairie (arc 2)* : livrer tôt (avant midi) libère sa soirée et évite la livraison qui s'éternise (coup du sort de Yasmine). Atout : *aide* pour Yasmine aussi.
- *Yasmine* : si la confidence arrive à 19:10 au café (elles y sont toutes deux), Yasmine peut aller chercher Antoine à la salle. Atout : *aide*.
- *Mireille* (« adore les surprises… des autres ») : la tenir éloignée, ou s'en servir pour faire savoir à Antoine qu'on l'attend. Atout : *risque calculé*.

**Objectif principal proposé.** « **Annoncer les vacances à Antoine au dîner** » (le dîner + l'aveu). Pourquoi : le secret d'Antoine (candidature au car régional) est son exact miroir ; le dîner devient la scène où deux projets d'avenir se percutent.

### 2.16 Antoine — chauffeur de bus, 39 ans

| | Arc principal (jour 1) | Second arc (jour suivant) |
|---|---|---|
| Titre | **Rentrer pour le dîner** (Cœur) | Tenir l’horaire (Fierté) |
| Désir | Être à la Villa Rosa à vingt heures pour Chloé. | Finir le service sans retard de plus de deux minutes. |
| Tension | Entre l’interview et la salle de sport, la soirée file. | Un journaliste guette les retards et Chloé ignore la candidature. |
| Secret | — | Antoine a postulé pour conduire le car régional, loin de la ville. → caché à **Chloé** |
| But vérifié | tenir l’engagement « Dîner à la maison » | bus L1-1 jamais à ≥ 3 min de retard |
| Échéance · enjeu | 21:30 · 0,55 | 14:00 · 0,6 |
| Difficulté | 2 — Facile | 4 — Difficile |
| Coups du sort | aucun | aucun |
| Issue en A (51) | **échoué** à 20:35 — Antoine n’y est pas arrivé *(Antoine a choisi « Faire du sport (Gymnase Central) » (Gymnase Central))* | (non joué en A) |
| Autres graines | 7 : échoué 20:35, 29 : échoué 20:35, 42 : échoué 20:35 | |

*Objectifs du profil :* Tenir l’horaire malgré tout · Dîner avec Chloé · Répondre aux questions du journaliste sans se faire piéger.  
*Engagements du jour (statut en A) :* Interview d’Antoine sur la ligne de bus (Gare routière, 14:30) — tenu ; Dîner à la maison (Villa Rosa, 20:00) — manqué.  
*Journée en A :* 4 échanges avec 3 personnes (Gérard, Julien, Yasmine) ; humeur 0,38 → 0,09 ; argent 85 → 80 €.

**Diagnostic.** Quatre échanges dans la journée (Gérard dans le bus 09:26, Julien à l'interview, Gérard au parc 17:41, Yasmine à 20:55). Son arc du jour 1 n'a **pas de secret** (le sien est dans l'arc 2). Le coup du sort qui le retient « avec Karim » est faux dans les faits : Karim a quitté la salle à 19:00. Son second arc (« Tenir l'horaire ») réussirait en A : le bus L1-1 n'a jamais plus d'une minute de retard.

**Sous-intrigues (idées)**

- *L'interview de Julien* : bien passée, elle le rassure ; mal passée (il apprend l'article), elle explique la salle de sport du soir. Atout : *indice*.
- *Mireille dans son bus* (objectif de Mireille) : elle bavarde, retarde le bus… et laisse échapper sa lettre. Atout : *indice* / risque.
- *Karim, ami* : le cours de 18 h de Karim au lieu de 19:10 → il rentre à l'heure. Atout : *aide*.

**Objectif principal proposé.** Fusionner les deux arcs : « **Tenir l'horaire malgré le journaliste, puis rentrer dîner** », avec le secret de candidature dès le jour 1. Pourquoi : l'arc horaire est trivial seul, le dîner est vide seul ; ensemble, la journée d'Antoine a une matinée (la ligne) et une soirée (Chloé), et son secret existe.

### 2.17 Mireille — retraitée, 68 ans

| | Arc principal (jour 1) | Second arc (jour suivant) |
|---|---|---|
| Titre | **Tout savoir** (Curiosité) | Récupérer la commode (Fierté) |
| Désir | Parler à au moins cinq personnes différentes avant le soir. | Rapporter enfin la commode promise depuis trois semaines. |
| Tension | Si Antoine l’apprend, il ne lui adressera plus la parole dans le bus. | Paul n’est pas pressé et Mireille s’arrête pour parler à tout le monde. |
| Secret | Mireille a écrit anonymement au journal au sujet des retards du bus. → caché à **Antoine** | — |
| But vérifié | 10 conversations dans la journée | tenir l’engagement « Récupérer la commode chez Paul » |
| Échéance · enjeu | 20:00 · 0,5 | 12:00 · 0,5 |
| Difficulté | 3 — Moyen | 2 — Facile |
| Coups du sort | 15:00 Mireille attend le plombier tout l’après-midi (`stay_home` jusqu’à 18:30) ; 14:00 Une averse vide le parc et les terrasses (`weather` jusqu’à 17:30) | aucun |
| Issue en A (51) | **échoué** à 20:00 — Mireille n’a parlé qu’à 9 personnes sur 10 *(Échéance dépassée)* | (non joué en A) |
| Autres graines | 7 : échoué 20:00, 29 : accompli 19:20, 42 : échoué 20:00 | |

*Objectifs du profil :* Savoir tout ce qui se passe · Récupérer la commode chez Paul · Prendre le bus avec Antoine.  
*Engagements du jour (statut en A) :* Récupérer la commode chez Paul (Atelier Dupré, 10:30) — manqué ; Thé avec Élodie (Café Le Papillon, 16:45) — manqué.  
*Journée en A :* 12 échanges avec 7 personnes (Alice, Chloé, Gérard, Camille, Élodie, Paul, Julien) ; humeur 0,19 → 0,27 ; argent 60 → 46 €.

**Diagnostic.** Échoue à une conversation près (9/10). Le désir dit « au moins cinq personnes différentes » mais le but compte **dix conversations** (pas des personnes) : le texte et la règle divergent. Elle manque ses deux engagements (commode à cause du coup du sort de l'arc de Paul, thé avec Élodie à cause de son propre coup du sort « plombier »). Elle ne prend jamais le bus d'Antoine (L1-2 à 08:49, 12:11, 18:32 ; L1-1 seulement à 21:51, après son service). Elle est, sans que personne le sache, la source de l'article de Julien.

**Sous-intrigues (idées)**

- *Récupérer la commode (arc 2, réussi à 10:50 dans la variante)* : à l'atelier elle découvre le cadeau de Paul — un scoop. Atout : *indice*.
- *Le thé avec Élodie* : Élodie lui montre (ou perd) la lettre pour Alice. Atout : *indice*.
- *Le bus avec Antoine* : elle y apprend la candidature d'Antoine — ou s'y trahit. Atout : *indice* / risque.

**Objectif principal proposé.** « **Apprendre un secret précis avant 20:00** » (par exemple celui de Paul) au lieu d'un compteur. Variante : « **rester anonyme** » (si Antoine apprend la lettre, coup de théâtre). Pourquoi : Mireille est le meilleur moteur de rumeurs de la ville (probabilité de base de répéter un secret 0,22, loin devant Julien, 0,17) ; lui donner une cible, c'est diriger toute la circulation des secrets.

### 2.18 Karim — coach sportif, 30 ans

| | Arc principal (jour 1) | Second arc (jour suivant) |
|---|---|---|
| Titre | **Entraîner Hugo** (Attachement) | Courir au parc (Fierté) |
| Désir | Tenir la séance avec Hugo à la salle. | Courir au parc avant d’ouvrir la salle. |
| Tension | Hugo ne doit pas s’inquiéter avant le concours. | Le réveil est dur quand la salle ferme tard. |
| Secret | Le Gymnase Central risque de fermer faute d’abonnés. → caché à **Hugo** | — |
| But vérifié | tenir l’engagement « Séance de sport avec Karim » | être à Parc des Tilleuls |
| Échéance · enjeu | 19:00 · 0,55 | 10:00 · 0,4 |
| Difficulté | 2 — Facile | 2 — Facile |
| Coups du sort | 16:20 Hugo est rappelé au café : un collègue manque (`force_action`) ; 16:30 Hugo doit tenir le comptoir jusqu’au soir (`agent_delay` 85 min) | aucun |
| Issue en A (51) | **échoué** à 17:54 — Karim n’y est pas arrivé *(Hugo a choisi « Se reposer à la maison » (Résidence du Parc))* | (non joué en A) |
| Autres graines | 7 : échoué 17:54, 29 : échoué 17:54, 42 : échoué 17:54 | |

*Objectifs du profil :* Remplir le cours de 18 h · Entraîner Hugo · Courir au parc le matin.  
*Engagements du jour (statut en A) :* Travail — Gymnase Central (Gymnase Central, 10:00) — tenu ; Séance de sport avec Karim (Gymnase Central, 17:30) — manqué.  
*Journée en A :* 11 échanges avec 6 personnes (Gérard, Yasmine, Hugo, Inès, Lucie, Julien) ; humeur 0,19 → 0,28 ; argent 70 → 41 €.

**Diagnostic.** Arc d'agenda (rendez-vous avec Hugo), défait par le coup du sort sur Hugo. Son second arc (courir au parc avant 10:00) est accompli dès 06:04 dans la variante : sans intérêt comme arc principal. Son secret (la salle risque de fermer) est bloqué : son seul confident possible est Hugo, la cible. Son objectif de profil le plus fort, « remplir le cours de 18 h », n'est pas modélisé.

**Sous-intrigues (idées)**

- *Antoine*, ami jamais croisé : le recruter pour le cours. Atout : *aide*.
- *Inès*, voisine (3 discussions à la Résidence du Parc) : l'inviter. Atout : *personne gagnée*.
- *Hugo* : la séance tenue = Hugo apprend (ou non) la menace sur la salle. Atout : *indice*.

**Objectif principal proposé.** « **Remplir le cours de 18 h** » (au moins quatre habitants au Gymnase entre 18:00 et 19:00), sinon la salle ferme (le secret devient enjeu, `dismissal` possible le lendemain). Pourquoi : premier arc **collectif**, qui recrute dans le nœud du soir et croise Hugo, Antoine, Julien, Inès, Yasmine.

### 2.19 Élodie — caissière, 27 ans

| | Arc principal (jour 1) | Second arc (jour suivant) |
|---|---|---|
| Titre | **Ne rien perdre aujourd’hui** (Courage) | Parler à Alice (Courage) |
| Désir | Rentrer le soir avec son portefeuille. | Trouver le courage de parler à sa voisine Alice. |
| Tension | La distraction d’Élodie est légendaire au Marché Plus. | Alice est toujours pressée, Élodie toujours timide. |
| Secret | Élodie a écrit à Alice une lettre qu’elle n’a jamais envoyée. → caché à **Alice** | — |
| But vérifié | ne pas perdre son portefeuille | vraie conversation avec Alice (profonde) |
| Échéance · enjeu | fin de journée · 0,5 | 23:00 · 0,6 |
| Difficulté | 1 — Entraînement | 4 — Difficile |
| Coups du sort | 12:35 Élodie pose son portefeuille sur le comptoir et l’oublie (`lose_item`) | aucun |
| Issue en A (51) | **échoué** à 12:35 — Élodie a encore perdu son portefeuille *(Moment de distraction)* | (non joué en A) |
| Autres graines | 7 : échoué 12:35, 29 : échoué 12:35, 42 : échoué 12:35 | |

*Objectifs du profil :* Reprendre des études · Ne rien perdre aujourd’hui · Trouver le courage de parler à Alice.  
*Engagements du jour (statut en A) :* Travail — Supermarché Marché Plus (Marché Plus, 08:30) — tenu ; Thé avec Élodie (Café Le Papillon, 16:45) — manqué ; Retourner chercher le portefeuille (Supermarché Marché Plus) (Marché Plus, 12:35) — manqué.  
*Journée en A :* 7 échanges avec 4 personnes (Mireille, Martin, Alice, Yasmine) ; humeur 0,15 → 0,19 ; argent 35 → 35 € ; **portefeuille perdu**.

**Diagnostic.** L'arc se joue sur un seul coup du sort (12:35) : si on l'esquive, c'est gagné ; sinon c'est perdu, et la journée d'Élodie est finie à 12:35. Absurdité visible en A : elle travaille au Marché Plus jusqu'à 16:30, dans le lieu même où est son portefeuille, et manque à 14:06 l'engagement « retourner chercher le portefeuille ». Son secret (la lettre à Alice) est bloqué : aucun confident. Deux rencontres avec Alice (19:35, 21:13), jamais profondes (voisines 0,3).

**Sous-intrigues (idées)**

- *Le thé avec Mireille (16:45)* : Mireille l'encourage à parler à Alice — ou le raconte. Atout : *aide* / risque.
- *Le trouveur du portefeuille* (Martin en 29, Noé en 42) : un nouveau lien. Atout : *personne gagnée*.
- *Reprendre des études* (profil) : un passage à la bibliothèque (elle y est à 18:23 en A) chez Sophie. Atout : *indice*.

**Objectif principal proposé.** « **Remettre la lettre à Alice** » (avant 23:00), la lettre étant dans le portefeuille : le perdre, c'est risquer que quelqu'un la lise. Pourquoi : fusionne les deux arcs et donne un vrai enjeu à la perte du portefeuille (aujourd'hui une simple case).

### 2.20 Lucie — restauratrice, 47 ans

| | Arc principal (jour 1) | Second arc (jour suivant) |
|---|---|---|
| Titre | **Le pain du restaurant** (Devoir) | Une pause au parc (Attachement) |
| Désir | Passer chez Camille chercher le pain avant le service. | S’offrir une pause au parc entre deux services. |
| Tension | Thomas veut parler partenariat ; il ne doit pas croire le restaurant fragile. | Le restaurant ne laisse jamais de répit. |
| Secret | Chez Lucie perd de l’argent depuis trois mois. → caché à **Thomas** | — |
| But vérifié | tenir l’engagement « Acheter le pain du restaurant » | être à Parc des Tilleuls après 14:00 |
| Échéance · enjeu | 11:30 · 0,55 | 18:00 · 0,4 |
| Difficulté | 2 — Facile | 2 — Facile |
| Coups du sort | 09:00 Lucie attend une livraison qui n’arrive pas (`agent_delay` 100 min, seulement si dans un lieu public) | aucun |
| Issue en A (51) | **échoué** à 09:46 — Lucie n’y est pas arrivée *(Rendez-vous manqué)* | (non joué en A) |
| Autres graines | 7 : échoué 09:46, 29 : échoué 11:30, 42 : échoué 09:46 | |

*Objectifs du profil :* Servir quarante couverts · Acheter le pain chez Camille · Une pause au parc.  
*Engagements du jour (statut en A) :* Travail — Restaurant Chez Lucie (Chez Lucie, 10:30) — tenu, 17 min de retard ; Acheter le pain du restaurant (Boulangerie, 09:30) — manqué.  
*Journée en A :* 2 échanges avec 2 personnes (Thomas, Karim) ; humeur -0,06 → 0,02 ; argent 300 → 297 €.

**Diagnostic.** **La journée la plus vide de la ville** : deux échanges (Thomas 19:13, Karim 19:26), tous deux au comptoir. Lucie reste au café de 08:47 à 10:40 (coup du sort), arrive au restaurant à 10:47 avec 17 minutes de retard et n'en ressort qu'à 23:00. Le restaurant sert trois repas (19:02–19:04). Le déjeuner Alice–Sophie a pourtant lieu chez elle à 12:25.

**Sous-intrigues (idées)**

- *Une pause au parc (arc 2)* : elle n'y va jamais en A ; la pause = la rencontre avec Camille (amie jamais croisée). Atout : *personne gagnée*.
- *Hugo* : 113 minutes ensemble au café le matin ; il peut la dépanner en pain. Atout : *aide*.
- *Thomas* : le partenariat comme horizon. Atout : *indice*.

**Objectif principal proposé.** « **Servir quarante couverts** » (objectif du profil, compté sur les achats au restaurant) ou « **obtenir le partenariat de Thomas sans avouer les pertes** ». Pourquoi : le pain du matin est une course ; ses enjeux réels (restaurant en perte, ami qui veut s'associer) sont dans le secret.

---

## 3. Événements marquants par personnage en A

Pour chacun : les événements dramatiquement forts **observés en A (graine 51)**, dans l'ordre chronologique — gravité ≥ 2 (marqués « grave »), issues d'arc, confidences et rumeurs, coups du sort, rendez-vous manqués, disputes, vraies conversations, dilemmes, objets perdus, retards — puis les nouvelles connaissances et le parcours de lieux. Les petits incidents de bus (37 retards d'une minute, gravité 1) sont omis. Un coup du sort sans lieu (« — ») s'applique là où se trouve l'habitant.

Ensuite, **« Ce qui pourrait être déclenché en B »** : des idées d'événements, chacune avec plusieurs causes possibles (non exhaustives) et la chaîne qu'elle pourrait lancer. La colonne « Mécanisme » nomme le type d'`Intervention` existant ou ce qu'il faudrait créer.

### 3.1 Alice

| Heure | Lieu | Événement (en A, graine 51) |
|---|---|---|
| 07:45 | café | Alice se confie à Sophie : Alice a reçu une offre d’une agence concurrente et n’a rien dit. |
| 11:48 | agence | Alice a croisé Thomas et échangé quelques mots, sans aller plus loin |
| 12:19 | agence | Alice hésite entre son envie (« Retourner au travail ») et « Déjeuner Alice & Sophie » — et fait passer l’engagement d’abord |
| 19:00 | parc | Échec — Parler à Thomas de la campagne : Alice a croisé Thomas sans oser aller plus loin — *Échéance dépassée sans la conversation espérée* **(grave)** |
| 19:08 | parc | Mireille rapporte à Alice le secret de Gérard : Le médecin a conseillé à Gérard de ne plus prendre le bus seul. |

*Lieux en A :* 07:29 Café Le Papillon → 07:58 Résidence des Lilas → 08:31 Agence Horizon → 12:21 Chez Lucie → 13:22 Agence Horizon → 18:07 Café Le Papillon → 18:45 Parc des Tilleuls → 19:31 Résidence des Lilas.

**Ce qui pourrait être déclenché en B (idées)**

| Événement | Causes possibles | Chaîne possible | Touche | Mécanisme |
|---|---|---|---|---|
| Promotion d'Alice | Thomas veut la retenir (il sait qu'elle a une offre) ; la campagne est acceptée ; Martin plaide pour elle | Alice renonce à l'offre → l'arc « campagne » se règle par la bande ; Sophie (qui sait) se tait | Thomas, Martin, Sophie | `promotion` |
| Renvoi d'Alice | Thomas apprend l'offre par la rumeur ; il doit réduire l'équipe (client perdu) | Alice au café dès 15:00 → croise Julien, Mireille → la rumeur sur l'agence sort | Thomas, Martin, Julien | `dismissal` |
| La rumeur atteint Thomas avant 19:00 | Sophie la répète à Nadia (21:54 en A) : la faire circuler plus tôt (Sophie–Thomas sont 48 min ensemble Chez Lucie à 19:04) | Coup de théâtre pour Alice ; Thomas froid avec Martin | Sophie, Nadia, Thomas | existant (rumeur) + `encounter` |
| Vol du portefeuille dans le bus | Elle prend le L1-1 à 08:19 et 19:27 ; foule du matin | Démarche à la mairie (créneau 16:40 de Martin) → rencontre Martin hors de l'agence | Martin, Antoine | `theft` |
| Un recruteur de l'agence concurrente descend du bus | Il vient chercher sa réponse (21ᵉ habitant) | Thomas le voit au café avec Alice → soupçon | Thomas, Julien | **(à créer : étranger)** |

### 3.2 Martin

| Heure | Lieu | Événement (en A, graine 51) |
|---|---|---|
| 19:42 | Haussmann | Gérard rapporte à Martin le secret de Paul : Paul a sculpté un cadeau pour Camille qu’il n’ose pas lui donner. |
| 22:00 | Haussmann | Échec — Sortir de la routine : Martin n’a pas trouvé le temps — *Échéance dépassée* |

*Nouvelles connaissances en A :* Élodie (parc 18:09).

*Lieux en A :* 07:45 Café Le Papillon → 08:12 Agence Horizon → 16:30 Hôtel de Ville → 17:01 Immeuble Haussmann → 17:34 Parc des Tilleuls → 18:17 Immeuble Haussmann → 19:50 Parc des Tilleuls → 20:33 Immeuble Haussmann.

**Ce qui pourrait être déclenché en B (idées)**

| Événement | Causes possibles | Chaîne possible | Touche | Mécanisme |
|---|---|---|---|---|
| Martin perd son carnet | Distraction au café de 07:45 ; il le pose à la mairie à 16:30 | Julien (ou Mireille) le trouve → l'article a sa preuve → l'interview de 14:30 tourne mal pour Antoine | Julien, Mireille, Antoine | **(à créer : objets autres que le portefeuille)** |
| Martin trouve le portefeuille d'Élodie | Il passe au Marché Plus (c'est ce qui arrive en graine 29 à 18:10) | Il le rend à 19:00 → café ensemble → son arc « sortir de la routine » réussit | Élodie, Mireille | existant (`find_item`/`return_item`) + `lose_item` d'Élodie plus tôt |
| Martin renvoyé ou promu | Le bilan de 09:00 révèle la perte du client ; Thomas cherche un coupable / un appui | Renvoi : Martin libre à 10:00, au café → rencontre Julien ; promotion : Martin apprend le secret de Thomas | Thomas, Alice | `dismissal` / `promotion` |
| Malaise de Gérard dans l'escalier | Le voisin âgé qu'il croise trois fois (17:25, 19:42) | Martin l'accompagne au cabinet → manque la mairie (16:40) ou rencontre Nadia | Gérard, Noé, Nadia | `illness` + **(à créer : accompagner)** |

### 3.3 Sophie

| Heure | Lieu | Événement (en A, graine 51) |
|---|---|---|
| 07:45 | café | Alice se confie à Sophie : Alice a reçu une offre d’une agence concurrente et n’a rien dit. |
| 10:27 | biblio | Échec — Tourner la page : Sophie a croisé Julien malgré tout et n’a pas su quoi dire — *Présents au même endroit au même moment* |
| 13:27 | biblio | Julien et Sophie se disputent au comptoir de Bibliothèque Municipale **(grave)** |
| 16:52 | biblio | Julien et Sophie se disputent au comptoir de Bibliothèque Municipale **(grave)** |
| 21:54 | parc | Sophie rapporte à Nadia le secret de Alice : Alice a reçu une offre d’une agence concurrente et n’a rien dit. |

*Lieux en A :* 07:45 Café Le Papillon → 07:58 Parc des Tilleuls → 08:41 Maison du Canal → 09:28 Bibliothèque → 12:21 Chez Lucie → 13:24 Bibliothèque → 19:04 Chez Lucie → 19:58 Parc des Tilleuls → 20:41 Maison du Canal → 21:29 Parc des Tilleuls → 22:12 Maison du Canal.

**Ce qui pourrait être déclenché en B (idées)**

| Événement | Causes possibles | Chaîne possible | Touche | Mécanisme |
|---|---|---|---|---|
| Incendie à la bibliothèque | Court-circuit ; Julien fume dehors ; vieux chauffage | Lieu fermé : Julien n'y entre pas (arc « éviter » sauvé) ; Inès et Noé privés de bibliothèque (livre d'astronomie manqué) | Julien, Inès, Noé | `fire` |
| Les lettres sortent du tiroir | Julien vient au comptoir (13:27) ; une collègue les trouve | Julien les voit → retrouvailles ou dispute définitive | Julien, Alice | **(à créer : objet / indice visible)** |
| Malaise de Sophie | Fatigue (vitalité 0,45), deux disputes en après-midi | Retour forcé à la Maison du Canal → croise Paul (voisin) | Paul, Inès (club) | `illness` |
| Sophie apprend le secret de Julien | Hugo (confident de Julien en 7 et 29) le répète ; Inès l'entend | Sophie méprise l'article → dispute ; ou le prévient (réconciliation) | Julien, Hugo, Antoine | existant (rumeur) |

### 3.4 Julien

| Heure | Lieu | Événement (en A, graine 51) |
|---|---|---|
| 10:27 | biblio | Julien a croisé Sophie et échangé quelques mots, sans aller plus loin |
| 13:27 | biblio | Julien et Sophie se disputent au comptoir de Bibliothèque Municipale **(grave)** |
| 13:27 | biblio | Julien a parlé à Sophie, mais sur le ton de la dispute |
| 14:00 | biblio | Coup du sort : Julien vient faire des recherches à la bibliothèque où travaille Sophie |
| 14:12 | biblio | Julien hésite entre son envie (« Rester sur place ») et « Interview d’Antoine sur la ligne de bus » — et fait passer l’engagement d’abord |
| 16:52 | biblio | Julien et Sophie se disputent au comptoir de Bibliothèque Municipale **(grave)** |
| 16:52 | biblio | Julien a parlé à Sophie, mais sur le ton de la dispute |
| 22:00 | parc | Échec — Revoir Sophie : Julien a croisé Sophie sans oser aller plus loin — *Échéance dépassée sans la conversation espérée* **(grave)** |

*Lieux en A :* 08:32 Café Le Papillon → 09:00 Marché Plus → 09:23 Parc des Tilleuls → 09:46 Café Le Papillon → 10:01 Bibliothèque → 13:43 Loft de la Gare → 14:02 Bibliothèque → 14:16 Gare routière → 15:04 Bibliothèque → 18:09 Café Le Papillon → 18:51 Loft de la Gare → 20:10 Parc des Tilleuls → 20:44 Loft de la Gare → 21:43 Parc des Tilleuls → 22:07 Loft de la Gare.

**Ce qui pourrait être déclenché en B (idées)**

| Événement | Causes possibles | Chaîne possible | Touche | Mécanisme |
|---|---|---|---|---|
| L'article est publié à 18:00 | Délai de bouclage ; Julien envoie trop tôt ; Mireille relance le journal | Antoine humilié → salle de sport (cause réelle du dîner manqué) ; Thomas jubile ; Martin sort son carnet | Antoine, Chloé, Martin, Thomas | **(à créer : événement public / rumeur générale)** |
| Accident de Julien (vélo, rue) | Impulsif (0,85), en retard, il court vers l'interview de 14:30 | Interview manquée → Antoine libre l'après-midi → retrouve Chloé plus tôt | Antoine, Chloé, Hugo (ami) | `accident` |
| Julien et Thomas se disputent au loft | Rivaux sous le même toit (ignorés 20:48, 22:27 ; accrochage en 7, 29, 42) | Thomas l'accuse de nuire à l'agence ; Julien apprend le client perdu → nouvel article | Thomas, Alice | existant (dispute) + **(à créer : scène de domicile)** |
| Vol dans le loft | Porte mal fermée par Julien | Thomas et Lucie (même immeuble) le soupçonnent | Thomas, Lucie | `theft` |

### 3.5 Camille

| Heure | Lieu | Événement (en A, graine 51) |
|---|---|---|
| 14:00 | — | Échec — Vendre toute la fournée : Camille ferme avec 12 pains invendus — *Stock restant à la fermeture* |

*Nouvelles connaissances en A :* Léa (parc 17:34), Yasmine (parc 18:16).

*Lieux en A :* 14:02 Immeuble Voltaire → 14:34 Café Le Papillon → 15:01 Immeuble Voltaire → 16:18 Café Le Papillon → 16:45 Immeuble Voltaire → 17:34 Parc des Tilleuls → 18:28 Immeuble Voltaire → 19:18 Parc des Tilleuls → 20:03 Immeuble Voltaire.

**Ce qui pourrait être déclenché en B (idées)**

| Événement | Causes possibles | Chaîne possible | Touche | Mécanisme |
|---|---|---|---|---|
| Incendie du four | Four ancien, Camille debout depuis 05:00 ; fournée oubliée | Boulangerie fermée : Hugo sans viennoiseries (06:45), Lucie sans pain ; Camille libre toute la journée → Paul, parc | Hugo, Lucie, Gérard, Paul | `fire` |
| Le repreneur arrive par le bus de 10:00 | Camille a rendez-vous en secret | Mireille le voit entrer → rumeur → Lucie l'apprend (coup de théâtre) | Mireille, Lucie | **(à créer : étranger)** |
| Grosse commande | Lucie (si elle vient) ; mariage à la mairie (Chloé y livre) | Fournée vendue avant 14:00 (arc réussi) | Lucie, Chloé | `force_action` (achat) |
| Malaise de Camille au parc | Épuisement (réveil 05:00, vitalité 0,9 pourtant) | Paul, Gérard présents (parc 17:51–19:56) → Paul ose enfin | Paul, Gérard | `illness` |

### 3.6 Hugo

| Heure | Lieu | Événement (en A, graine 51) |
|---|---|---|
| 15:43 | Rés. Parc | Hugo a croisé Inès et échangé quelques mots, sans aller plus loin |
| 16:20 | café | Coup du sort : Hugo est rappelé au café : un collègue manque |
| 16:30 | — | Coup du sort : Hugo doit tenir le comptoir jusqu’au soir |
| 17:54 | gym | Hugo manque « Séance de sport avec Karim » : Karim a attendu 24 min — *Hugo a choisi « Se reposer à la maison » (Résidence du Parc)* **(grave)** |
| 22:00 | Rés. Parc | Échec — Comprendre Inès : Hugo a croisé Inès sans oser aller plus loin — *Échéance dépassée sans la conversation espérée* |
| 22:04 | Rés. Parc | Hugo et Karim ont une vraie conversation à Résidence du Parc |
| 22:13 | Rés. Parc | Inès ose enfin une vraie conversation avec Hugo à Résidence du Parc |

*Lieux en A :* 06:43 Boulangerie → 06:58 Café Le Papillon → 15:41 Résidence du Parc → 17:59 Parc des Tilleuls → 19:33 Résidence du Parc.

**Ce qui pourrait être déclenché en B (idées)**

| Événement | Causes possibles | Chaîne possible | Touche | Mécanisme |
|---|---|---|---|---|
| Hugo renvoyé du café | Le concours raté se sait ; il offre trop de cafés ; caisse à 1 € | Hugo libre à midi → salle avec Karim tenue ; Inès ne le trouve plus au comptoir | Karim, Inès, Julien | `dismissal` |
| Promotion (chef barista) | Le patron apprécie qu'il ait tenu le comptoir | Hugo ose parler à Inès (moral) ; avoue le concours | Inès, Karim | `promotion` |
| Le secret du concours atteint Karim | Julien (confident en 7 et 29) le répète ; Inès l'entend | Coup de théâtre ; la séance devient explication | Karim, Julien | existant (rumeur) |
| Léa au comptoir à 07:30 | Elle veut le voir avant le lycée (son béguin) | Léa en retard (tutoriel inversé) ; Inès voit la scène | Léa, Inès | `force_action` |

### 3.7 Léa

| Heure | Lieu | Événement (en A, graine 51) |
|---|---|---|
| 07:50 | — | Coup du sort : Léa ne retrouve pas son sac de cours et rate le bus |
| 08:41 | école | Léa est en retard de 11 min au lycée |
| 08:41 | école | Yasmine remarque le retard de Léa |
| 08:41 | école | Échec — À l’heure au lycée : Léa est encore en retard (11 min) — *Arrivée après l’heure de début de l’engagement* |
| 17:40 | — | Coup du sort : Léa est privée de sortie ce soir |
| 20:09 | Maison Bleue | Léa se confie à Nadia : Léa a un faible pour Hugo, le barista. |

*Nouvelles connaissances en A :* Camille (parc 17:34).

*Lieux en A :* 08:41 École Jules Ferry → 16:32 Parc des Tilleuls → 17:46 Maison Bleue.

**Ce qui pourrait être déclenché en B (idées)**

| Événement | Causes possibles | Chaîne possible | Touche | Mécanisme |
|---|---|---|---|---|
| Léa apprend que Noé part | Gérard le répète (si Noé lui confie) ; Yasmine laisse échapper la lettre d'admission | Coup de théâtre pour Noé ; Léa se confie à Nadia… qui cache elle aussi un départ | Noé, Gérard, Yasmine, Nadia | existant (rumeur) |
| Léa apprend le poste de Nadia | Yasmine (si Nadia lui a confié) ; Sophie (amie de Nadia) | Dispute mère-fille ; Léa fugue au parc | Nadia, Yasmine, Sophie | existant (rumeur) + **(à créer : dispute familiale)** |
| Accident de Léa en courant après le bus | Retard (07:50), impulsivité 0,85 | Nadia appelée au cabinet → consultation de Gérard décalée | Nadia, Gérard, Noé | `accident` |
| Privation de sortie annulée | Elle est arrivée à l'heure (cause) ; Yasmine la défend | Léa reste au parc après 17:30 → Noé lui parle | Noé, Nadia | **(à créer : coup du sort conditionnel)** |

### 3.8 Nadia

| Heure | Lieu | Événement (en A, graine 51) |
|---|---|---|
| 18:45 | — | Coup du sort : Une urgence retient Nadia au cabinet **(grave)** |
| 19:54 | café | Nadia manque « Café entre amies » : Yasmine a attendu 24 min — *Nadia a choisi « Travail — Cabinet médical du Dr Fontaine » (Cabinet médical du Dr Fontaine)* **(grave)** |
| 19:54 | café | Échec — Le café avec Yasmine : Nadia n’y est pas arrivée — *Nadia a choisi « Travail — Cabinet médical du Dr Fontaine » (Cabinet médical du Dr Fontaine)* |
| 20:09 | Maison Bleue | Léa se confie à Nadia : Léa a un faible pour Hugo, le barista. |
| 21:54 | parc | Sophie rapporte à Nadia le secret de Alice : Alice a reçu une offre d’une agence concurrente et n’a rien dit. |

*Lieux en A :* 07:34 Cabinet médical → 20:09 Maison Bleue → 21:30 Parc des Tilleuls → 22:16 Maison Bleue.

**Ce qui pourrait être déclenché en B (idées)**

| Événement | Causes possibles | Chaîne possible | Touche | Mécanisme |
|---|---|---|---|---|
| L'urgence de 18:45 prend un visage | Malaise de Gérard ; accident de Paul à l'atelier ; Léa blessée | Le joueur peut l'empêcher en amont (éviter le malaise) → café avec Yasmine tenu | Gérard, Paul, Léa, Yasmine | `illness`/`accident` + **(à créer : coup du sort causé)** |
| Malaise de Nadia | Plus de douze heures au cabinet (arrivée 07:34, retour chez elle 20:09) | Clinique fermée → les patients (Gérard) attendent ; Léa la soigne | Léa, Gérard | `illness` |
| L'hôpital appelle : réponse avant ce soir | Délai imposé ; l'émissaire arrive par le bus | Nadia doit en parler à Léa le jour même | Léa, Yasmine | **(à créer : échéance externe)** |
| Rencontre Nadia–Thomas au parc (21:31, 13 min ensemble en A) | Elle a reçu la rumeur sur Alice à 21:54 | Elle la répète à Thomas → contrecoup pour Alice | Thomas, Alice | `encounter` |

### 3.9 Noé

| Heure | Lieu | Événement (en A, graine 51) |
|---|---|---|
| 16:36 | parc | Noé a croisé Léa et échangé quelques mots, sans aller plus loin |
| 21:00 | parc | Échec — Parler à Léa de ses projets : Noé a croisé Léa sans oser aller plus loin — *Échéance dépassée sans la conversation espérée* **(grave)** |

*Lieux en A :* 07:59 École Jules Ferry → 16:32 Parc des Tilleuls → 17:33 Bibliothèque → 17:59 Immeuble Haussmann → 18:32 Parc des Tilleuls → 19:15 Immeuble Haussmann → 20:48 Parc des Tilleuls → 21:31 Immeuble Haussmann.

**Ce qui pourrait être déclenché en B (idées)**

| Événement | Causes possibles | Chaîne possible | Touche | Mécanisme |
|---|---|---|---|---|
| Noé se confie à Gérard au petit-déjeuner | Bavardage de 07:42 ; Gérard est son seul confident possible (hors Léa) | Gérard le répète à Mireille (12:21 au parc en A) → la rumeur court vers Léa | Gérard, Mireille, Léa | existant (révélation) |
| Gérard fait un malaise | Bus pris seul (08:25, 09:25) | Noé quitte le lycée → rate Léa et le livre | Gérard, Nadia, Léa | `illness` + **(à créer : prévenir/se déplacer)** |
| Le livre d'astronomie est déjà emprunté | Julien le prend pour un article ; Inès pour son mémoire | Noé cherche le livre → croise Julien/Inès | Julien, Inès | **(à créer : stock d'objets)** |
| Contrôle de maths raté / réussi | Annoncé par Yasmine | Humeur → courage (ou non) pour parler à Léa | Yasmine, Léa | **(à créer : résultat scolaire)** |

### 3.10 Gérard

| Heure | Lieu | Événement (en A, graine 51) |
|---|---|---|
| 15:38 | parc | Paul manque « Partie de pétanque » : Gérard a attendu 38 min — *Paul a choisi « Travail — Atelier Dupré » (Atelier Dupré)* **(grave)** |
| 15:38 | parc | Échec — La pétanque avec Paul : Gérard n’y est pas arrivé — *Paul a choisi « Travail — Atelier Dupré » (Atelier Dupré)* |
| 18:25 | parc | Paul se confie à Gérard : Paul a sculpté un cadeau pour Camille qu’il n’ose pas lui donner. |
| 18:52 | parc | Gérard se confie à Mireille : Le médecin a conseillé à Gérard de ne plus prendre le bus seul. |
| 19:42 | Haussmann | Gérard rapporte à Martin le secret de Paul : Paul a sculpté un cadeau pour Camille qu’il n’ose pas lui donner. |

*Nouvelles connaissances en A :* Karim (parc 07:14).

*Lieux en A :* 06:58 Parc des Tilleuls → 07:41 Immeuble Haussmann → 08:29 Cabinet médical → 09:29 Marché Plus → 09:52 Parc des Tilleuls → 11:15 Immeuble Haussmann → 12:18 Parc des Tilleuls → 13:41 Immeuble Haussmann → 14:29 Parc des Tilleuls → 15:41 Café Le Papillon → 16:12 Bibliothèque → 17:16 Immeuble Haussmann → 17:39 Parc des Tilleuls → 19:42 Immeuble Haussmann → 21:00 Parc des Tilleuls → 21:43 Immeuble Haussmann.

**Ce qui pourrait être déclenché en B (idées)**

| Événement | Causes possibles | Chaîne possible | Touche | Mécanisme |
|---|---|---|---|---|
| Malaise dans le bus L1-1 à 09:26 | Il le prend seul (avis du médecin) ; il venait de la consultation | Antoine arrête le bus (horaire perdu), Nadia appelée, Noé prévenu → le secret éclate | Antoine, Nadia, Noé | `illness` + `bus_delay` |
| Accident au parc (pétanque) | Il attend Paul 38 min sous la pluie (14:00–17:30) | Paul culpabilise → livre le cadeau à Camille ? | Paul, Camille, Nadia | `accident` + `weather` |
| Gérard ne rentre pas | Il oublie l'heure au parc | Noé le cherche à 21:00 → ne voit pas Léa | Noé, Martin (voisin) | `agent_delay` |
| Le secret de Paul atteint Camille | Gérard et Camille discutent au parc à 19:22 en A | Coup de théâtre (contrecoup : l'arc de Paul est clos à 11:39) | Paul, Camille | existant (rumeur) |

### 3.11 Yasmine

| Heure | Lieu | Événement (en A, graine 51) |
|---|---|---|
| 08:41 | école | Yasmine remarque le retard de Léa |
| 11:58 | école | Yasmine hésite entre « Retourner au travail » et son envie (« Fleurs pour la classe ») — et suit son envie |
| 12:27 | fleuriste | « Fleurs pour la classe » n’a pas lieu : Yasmine et Chloé ne sont pas venus — *Yasmine est encore en chemin (parti à 12:27) ; Chloé a choisi « Se promener (Hôtel de Ville) » (Hôtel de Ville)* **(grave)** |
| 12:27 | fleuriste | Échec — Des fleurs pour la classe : Yasmine n’y est pas arrivée — *Yasmine est encore en chemin (parti à 12:27) ; Chloé a choisi « Se promener (Hôtel de Ville) » (Hôtel de Ville)* |
| 19:54 | café | Nadia manque « Café entre amies » : Yasmine a attendu 24 min — *Nadia a choisi « Travail — Cabinet médical du Dr Fontaine » (Cabinet médical du Dr Fontaine)* **(grave)** |
| 21:53 | Villa Rosa | Chloé et Yasmine ont une vraie conversation à Villa Rosa |
| 21:53 | Villa Rosa | Chloé se confie à Yasmine : Chloé a réservé des vacances surprise pour Antoine. |

*Nouvelles connaissances en A :* Camille (parc 18:16), Paul (parc 20:19), Élodie (parc 20:11).

*Lieux en A :* 07:15 Café Le Papillon → 07:41 École Jules Ferry → 11:59 Fleurs & Sens → 12:28 École Jules Ferry → 17:19 Villa Rosa → 17:53 Parc des Tilleuls → 18:37 Villa Rosa → 19:03 Café Le Papillon → 19:57 Parc des Tilleuls → 20:41 Villa Rosa.

**Ce qui pourrait être déclenché en B (idées)**

| Événement | Causes possibles | Chaîne possible | Touche | Mécanisme |
|---|---|---|---|---|
| Promotion : direction de l'école | Annonce officielle à 17:00 (l'inspecteur arrive par le bus) | Elle doit le dire à Nadia ce soir ; Léa et Noé l'apprennent avant | Nadia, Léa, Noé | `promotion` + **(à créer : étranger)** |
| Accident en sortie scolaire | Les fleurs manquées, elle court | Elle manque le café de Nadia → l'arc de Nadia gagne du temps ? | Nadia, Léa, Noé | `accident` |
| Chloé lui confie la surprise à 19:10 | Elles sont au café en même temps (19:03–19:43) | Yasmine prévient Antoine à 20:55 (ils se croisent à la Villa Rosa) | Chloé, Antoine | existant (révélation) + `encounter` |
| Fleuriste fermé (incendie) | Seau d'eau sur la prise | Yasmine achète des fleurs au marché → croise Élodie | Chloé, Élodie | `fire` |

### 3.12 Thomas

| Heure | Lieu | Événement (en A, graine 51) |
|---|---|---|
| 12:10 | — | Coup du sort : Une réunion s’éternise pour Thomas |
| 13:31 | Chez Lucie | « Déjeuner chez Lucie » n’a pas lieu : Thomas n’a pas trouvé le temps **(grave)** |
| 13:31 | Chez Lucie | Échec — Déjeuner chez Lucie : Thomas n’y est pas arrivé — *Rendez-vous manqué* |

*Lieux en A :* 07:29 Agence Horizon → 19:02 Chez Lucie → 19:54 Loft de la Gare → 21:03 Parc des Tilleuls → 21:47 Loft de la Gare.

**Ce qui pourrait être déclenché en B (idées)**

| Événement | Causes possibles | Chaîne possible | Touche | Mécanisme |
|---|---|---|---|---|
| Le client perdu revient (ou un nouveau) | Alice a parlé de la campagne ; la réunion qui s'éternise aboutit | Thomas promeut Alice ; partenariat avec Lucie possible | Alice, Martin, Lucie | `promotion` (Alice) **(à créer : bonne nouvelle d'agence)** |
| Thomas renvoie Martin | Le bilan est mauvais (réunion de 09:00) | Martin au café à 10:00 → rencontre Julien et sort son carnet | Martin, Julien | `dismissal` |
| Malaise de Thomas | Onze heures et demie à l’agence sans déjeuner (07:29–19:00), patience 0,2 | Lucie l'apprend (amie) → passe le voir ; Alice prend la réunion | Lucie, Alice, Martin | `illness` |
| Thomas apprend l'offre d'Alice | La rumeur Sophie → Nadia (21:54 en A) ; Sophie dîne près de lui à 19:04 | Coup de théâtre pour Alice | Alice, Sophie, Nadia | existant (rumeur) |

### 3.13 Inès

| Heure | Lieu | Événement (en A, graine 51) |
|---|---|---|
| 15:00 | — | Coup du sort : Inès doit rendre un chapitre de mémoire avant 18 h |
| 15:43 | Rés. Parc | Inès a croisé Hugo et échangé quelques mots, sans aller plus loin |
| 22:00 | Rés. Parc | Échec — Oser parler à Hugo : Inès a croisé Hugo sans oser aller plus loin — *Échéance dépassée sans la conversation espérée* **(grave)** |
| 22:13 | Rés. Parc | Inès ose enfin une vraie conversation avec Hugo à Résidence du Parc |

*Lieux en A :* 08:15 Café Le Papillon → 08:38 Marché Plus → 09:01 Résidence du Parc → 09:46 Café Le Papillon → 10:01 Bibliothèque → 15:06 Résidence du Parc → 18:10 Parc des Tilleuls → 19:34 Résidence du Parc → 22:44 Café Le Papillon → 22:59 Résidence du Parc.

**Ce qui pourrait être déclenché en B (idées)**

| Événement | Causes possibles | Chaîne possible | Touche | Mécanisme |
|---|---|---|---|---|
| Vol de son ordinateur (mémoire) à la bibliothèque | Elle s'absente au café (09:46) ; Julien fouine | Panique, chapitre perdu → le coup du sort de 15:00 devient tragédie ; Julien soupçonné | Julien, Sophie | `theft` **(à créer : objet autre que portefeuille)** |
| Hugo apprend le sujet du mémoire | Mireille (si Inès l'a interrogée) ; Sophie (club de lecture) | Coup de théâtre : flatté ou gêné | Hugo, Mireille, Sophie | existant (rumeur) |
| Un café offert | Hugo généreux (frugalité 0,2) ; Inès à 1 € | Budget tenu (arc 2) et signe pour Hugo | Hugo | **(à créer : don)** |
| Rencontre avec Léa au café | Léa vient voir Hugo (son béguin) | Inès comprend qu'elle a une rivale → ose | Léa, Hugo | `encounter` |

### 3.14 Paul

| Heure | Lieu | Événement (en A, graine 51) |
|---|---|---|
| 11:39 | atelier | Mireille manque « Récupérer la commode chez Paul » : Paul a attendu 69 min — *Mireille est encore en chemin (parti à 10:10, retardé)* **(grave)** |
| 11:39 | atelier | Échec — Livrer la commode : Paul n’y est pas arrivé — *Mireille est encore en chemin (parti à 10:10, retardé)* |
| 14:35 | — | Coup du sort : Une commande urgente retient Paul à l’atelier |
| 15:38 | parc | Paul manque « Partie de pétanque » : Gérard a attendu 38 min — *Paul a choisi « Travail — Atelier Dupré » (Atelier Dupré)* **(grave)** |
| 18:25 | parc | Paul se confie à Gérard : Paul a sculpté un cadeau pour Camille qu’il n’ose pas lui donner. |

*Nouvelles connaissances en A :* Yasmine (parc 20:19).

*Lieux en A :* 06:35 Atelier Dupré → 17:06 Maison du Canal → 18:24 Parc des Tilleuls → 19:07 Maison du Canal → 19:55 Parc des Tilleuls → 20:38 Maison du Canal.

**Ce qui pourrait être déclenché en B (idées)**

| Événement | Causes possibles | Chaîne possible | Touche | Mécanisme |
|---|---|---|---|---|
| Accident à l'atelier | Commande urgente de 14:35 faite trop vite | Gérard l'apprend (ami 0,8) → la pétanque devient visite à la clinique → Nadia retenue (l'« urgence ») | Gérard, Nadia, Camille | `accident` |
| Incendie de l'atelier | Sciure, vernis | Commode détruite (arc perdu) mais Paul libre → boulangerie, Camille | Mireille, Camille | `fire` |
| Le cadeau découvert | Mireille entre à l'atelier (commode) ; Sophie (voisine) le voit | Rumeur → Camille ; coup de théâtre | Mireille, Camille, Sophie | **(à créer : objet visible)** |
| Paul renonce à la commande urgente | Gérard vient le chercher à l'atelier à 14:50 | Pétanque tenue → confidence à 15:30 au lieu de 18:25 | Gérard | `cancel_commitment` / `encounter` |

### 3.15 Chloé

| Heure | Lieu | Événement (en A, graine 51) |
|---|---|---|
| 11:45 | mairie | Coup du sort : Chloé part livrer des bouquets à la mairie |
| 11:58 | — | Coup du sort : La livraison de Chloé s’éternise à la mairie |
| 12:27 | fleuriste | « Fleurs pour la classe » n’a pas lieu : Yasmine et Chloé ne sont pas venus — *Yasmine est encore en chemin (parti à 12:27) ; Chloé a choisi « Se promener (Hôtel de Ville) » (Hôtel de Ville)* **(grave)** |
| 20:35 | Villa Rosa | Antoine manque « Dîner à la maison » : Chloé a attendu 35 min — *Antoine a choisi « Faire du sport (Gymnase Central) » (Gymnase Central)* **(grave)** |
| 20:35 | Villa Rosa | Échec — Le dîner avec Antoine : Chloé n’y est pas arrivée — *Antoine a choisi « Faire du sport (Gymnase Central) » (Gymnase Central)* |
| 21:53 | Villa Rosa | Chloé et Yasmine ont une vraie conversation à Villa Rosa |
| 21:53 | Villa Rosa | Chloé se confie à Yasmine : Chloé a réservé des vacances surprise pour Antoine. |

*Lieux en A :* 07:30 Café Le Papillon → 08:00 Villa Rosa → 08:32 Marché Plus → 08:57 Fleurs & Sens → 11:49 Hôtel de Ville → 12:42 Fleurs & Sens → 19:03 Café Le Papillon → 19:43 Villa Rosa → 20:39 Parc des Tilleuls → 21:22 Café Le Papillon → 21:52 Villa Rosa.

**Ce qui pourrait être déclenché en B (idées)**

| Événement | Causes possibles | Chaîne possible | Touche | Mécanisme |
|---|---|---|---|---|
| Rupture Chloé–Antoine | Elle apprend sa candidature ; le dîner manqué de trop (affinité 0,85 → 0,65 en A) | Antoine dort chez Karim ? Yasmine (voisine) au milieu ; les vacances annulées | Antoine, Yasmine, Karim | `breakup` |
| Antoine apprend la surprise trop tôt | Mireille (« adore les surprises des autres ») ; Yasmine (confidente à 21:53) | Coup de théâtre ; il retire sa candidature… ou non | Antoine, Mireille, Yasmine | existant (rumeur) |
| Vol à la boutique | Chloé partie à la mairie (11:45–12:42), boutique sans personne | Déclaration à la mairie (Martin y est à 16:30) | Martin, Yasmine | `theft` |
| Incendie à la Villa Rosa | Bougies du dîner qui attend | Chloé, Yasmine, Antoine à la rue ; la soirée se joue au café | Yasmine, Antoine | `fire` |

### 3.16 Antoine

| Heure | Lieu | Événement (en A, graine 51) |
|---|---|---|
| 19:10 | gym | Coup du sort : Antoine file à la salle retrouver Karim |
| 19:25 | — | Coup du sort : Antoine s’attarde à la salle avec Karim |
| 20:35 | Villa Rosa | Antoine manque « Dîner à la maison » : Chloé a attendu 35 min — *Antoine a choisi « Faire du sport (Gymnase Central) » (Gymnase Central)* **(grave)** |
| 20:35 | Villa Rosa | Échec — Rentrer pour le dîner : Antoine n’y est pas arrivé — *Antoine a choisi « Faire du sport (Gymnase Central) » (Gymnase Central)* |

*Lieux en A :* 14:08 Gare routière → 15:12 Villa Rosa → 17:41 Parc des Tilleuls → 18:25 Villa Rosa → 19:20 Gymnase Central → 20:55 Villa Rosa.

**Ce qui pourrait être déclenché en B (idées)**

| Événement | Causes possibles | Chaîne possible | Touche | Mécanisme |
|---|---|---|---|---|
| Panne du bus L1-1 | Vieux bus ; Antoine distrait par Gérard (09:26) | Horaire perdu (arc 2) ; Alice et Gérard en retard ; Julien a ses « preuves » | Alice, Gérard, Julien, Martin | `bus_delay` (long) |
| Promotion : le car régional accepté | Lettre de la régie ; l'inspecteur (étranger) le lui annonce | Il doit le dire à Chloé ce soir (miroir des vacances) | Chloé, Karim | `promotion` |
| Renvoi d'Antoine | L'article de Julien ; la lettre de Mireille | Antoine libre et humilié → dîner à l'heure… ou salle de sport | Chloé, Julien, Mireille | `dismissal` |
| Il apprend que Mireille a écrit au journal | Gérard (confident de Mireille en graine 29) le lui répète au parc (ils discutent à 17:41 en A) | Coup de théâtre pour Mireille ; Antoine ne lui parle plus | Mireille, Gérard | existant (rumeur) |

### 3.17 Mireille

| Heure | Lieu | Événement (en A, graine 51) |
|---|---|---|
| 07:30→19:26 | divers | 9 conversations comptées pour « Tout savoir » (objectif : 10) |
| 10:15 | — | Coup du sort : Mireille s’attarde à bavarder et oublie l’heure |
| 11:39 | atelier | Mireille manque « Récupérer la commode chez Paul » : Paul a attendu 69 min — *Mireille est encore en chemin (parti à 10:10, retardé)* **(grave)** |
| 15:00 | — | Coup du sort : Mireille attend le plombier tout l’après-midi |
| 17:00 | café | Mireille manque « Thé avec Élodie » : Élodie a attendu 15 min — *Mireille a choisi « Se reposer à la maison » (Résidence des Lilas) ; Mireille est resté chez lui* **(grave)** |
| 18:52 | parc | Gérard se confie à Mireille : Le médecin a conseillé à Gérard de ne plus prendre le bus seul. |
| 19:08 | parc | Mireille rapporte à Alice le secret de Gérard : Le médecin a conseillé à Gérard de ne plus prendre le bus seul. |
| 20:00 | Lilas | Échec — Tout savoir : Mireille n’a parlé qu’à 9 personnes sur 10 — *Échéance dépassée* |

*Lieux en A :* 07:14 Café Le Papillon → 07:54 Gymnase Central → 08:55 Résidence des Lilas → 11:55 Atelier Dupré → 12:13 Parc des Tilleuls → 12:59 Résidence des Lilas → 14:18 Café Le Papillon → 14:49 Bibliothèque → 15:11 Résidence des Lilas → 18:37 Parc des Tilleuls → 19:23 Résidence des Lilas → 20:42 Café Le Papillon → 21:10 Parc des Tilleuls → 21:55 Résidence des Lilas.

**Ce qui pourrait être déclenché en B (idées)**

| Événement | Causes possibles | Chaîne possible | Touche | Mécanisme |
|---|---|---|---|---|
| Mireille dans le bus d'Antoine | Elle rate le L1-2 de 08:49 ; le plombier appelle | Bavardage → elle apprend la candidature d'Antoine → la ville le sait à midi | Antoine, Chloé | `agent_delay` / `bus_delay` |
| Le plombier ne vient pas | Le coup du sort de 15:00 est esquivé (elle sort avant) | Thé avec Élodie tenu (16:45) → 10ᵉ conversation → arc réussi | Élodie | `force_action` avant 15:00 |
| Accident de Mireille dans la rue | Distraite à bavarder (coup du sort de 10:15) | Paul attend la commode → part plus tôt à la pétanque | Paul, Gérard | `accident` |
| Mireille démasquée | Julien cite « une lectrice des Lilas » ; Martin compare l'écriture | Antoine coupe les ponts ; Mireille perd sa place dans le bus | Julien, Antoine, Martin | **(à créer : révélation publique)** |

### 3.18 Karim

| Heure | Lieu | Événement (en A, graine 51) |
|---|---|---|
| 17:54 | gym | Hugo manque « Séance de sport avec Karim » : Karim a attendu 24 min — *Hugo a choisi « Se reposer à la maison » (Résidence du Parc)* **(grave)** |
| 17:54 | gym | Échec — Entraîner Hugo : Karim n’y est pas arrivé — *Hugo a choisi « Se reposer à la maison » (Résidence du Parc)* |
| 22:04 | Rés. Parc | Hugo et Karim ont une vraie conversation à Résidence du Parc |

*Nouvelles connaissances en A :* Gérard (parc 07:14), Lucie (Chez Lucie 19:26).

*Lieux en A :* 06:04 Parc des Tilleuls → 07:37 Café Le Papillon → 08:15 Parc des Tilleuls → 09:09 Résidence du Parc → 09:29 Gymnase Central → 19:04 Chez Lucie → 19:58 Parc des Tilleuls → 20:22 Résidence du Parc.

**Ce qui pourrait être déclenché en B (idées)**

| Événement | Causes possibles | Chaîne possible | Touche | Mécanisme |
|---|---|---|---|---|
| La salle ferme (annonce à 18:00) | Cours de 18 h vide ; la mairie notifie | Karim « renvoyé » ; Hugo apprend le secret ; Antoine n'a plus où aller à 19:10 → dîner tenu | Hugo, Antoine, Chloé | `fire`/`location_hours` + `dismissal` |
| Accident pendant le footing (06:04) | Trop tôt, rue mouillée | Salle fermée le matin ; Gérard (qui le rencontre à 07:14 en A) l'aide | Gérard, Hugo | `accident` |
| Karim au comptoir de Lucie (19:04) | Il dîne chez elle en A | Il lui propose des cours pour ses clients → partenariat rival de Thomas | Lucie, Thomas | existant |
| Hugo lui avoue le concours | Vraie conversation à 22:04 en A ; la séance tenue | Karim lui avoue la salle : pacte d'amis | Hugo | **(à créer : aveu)** |

### 3.19 Élodie

| Heure | Lieu | Événement (en A, graine 51) |
|---|---|---|
| 12:35 | — | Coup du sort : Élodie pose son portefeuille sur le comptoir et l’oublie |
| 12:35 | supermarché | Élodie oublie son portefeuille à Supermarché Marché Plus |
| 12:35 | supermarché | Échec — Ne rien perdre aujourd’hui : Élodie a encore perdu son portefeuille — *Moment de distraction* |
| 14:06 | supermarché | « Retourner chercher le portefeuille (Supermarché Marché Plus) » n’a pas lieu : Élodie n’a pas trouvé le temps **(grave)** |
| 17:00 | café | Mireille manque « Thé avec Élodie » : Élodie a attendu 15 min — *Mireille a choisi « Se reposer à la maison » (Résidence des Lilas) ; Mireille est resté chez lui* **(grave)** |

*Nouvelles connaissances en A :* Martin (parc 18:09), Yasmine (parc 20:11).

*Lieux en A :* 08:04 Marché Plus → 16:34 Café Le Papillon → 17:04 Résidence des Lilas → 17:40 Parc des Tilleuls → 18:23 Bibliothèque → 19:09 Résidence des Lilas → 20:00 Parc des Tilleuls → 20:46 Résidence des Lilas.

**Ce qui pourrait être déclenché en B (idées)**

| Événement | Causes possibles | Chaîne possible | Touche | Mécanisme |
|---|---|---|---|---|
| Quelqu'un lit la lettre dans le portefeuille | Martin (graine 29) ou Noé (graine 42) le trouvent | La rumeur atteint Alice → coup de théâtre (doux) | Martin, Noé, Alice, Mireille | **(à créer : objet dans l'objet)** |
| Vol plutôt que perte | Comptoir sans surveillance à 12:35 | Déclaration à la mairie → croise Martin (16:30) | Martin | `theft` |
| Élodie promue | Elle n'a rien perdu (si le coup du sort est esquivé) | Moral → courage pour Alice | Alice | `promotion` |
| Elle reprend ses études | Passage à la bibliothèque (18:23 en A) | Sophie lui parle ; Inès l'encourage | Sophie, Inès | **(à créer : inscription)** |

### 3.20 Lucie

| Heure | Lieu | Événement (en A, graine 51) |
|---|---|---|
| 09:00 | — | Coup du sort : Lucie attend une livraison qui n’arrive pas |
| 09:46 | boulangerie | « Acheter le pain du restaurant » n’a pas lieu : Lucie n’a pas trouvé le temps **(grave)** |
| 09:46 | boulangerie | Échec — Le pain du restaurant : Lucie n’y est pas arrivée — *Rendez-vous manqué* |
| 10:47 | Chez Lucie | Lucie est en retard de 17 min au travail |

*Nouvelles connaissances en A :* Karim (Chez Lucie 19:26).

*Lieux en A :* 08:47 Café Le Papillon → 10:47 Chez Lucie → 23:02 Loft de la Gare.

**Ce qui pourrait être déclenché en B (idées)**

| Événement | Causes possibles | Chaîne possible | Touche | Mécanisme |
|---|---|---|---|---|
| Le livreur arrive enfin… avec le pain | Le coup du sort devient un étranger (21ᵉ habitant) | Lucie libérée à 09:15 → boulangerie → Camille | Camille, Hugo | **(à créer : étranger)** |
| Incendie en cuisine | Service seule jusqu'à 23:00 | Thomas et Karim dînent ailleurs (café) ; Thomas sans partenariat | Thomas, Karim, Sophie | `fire` |
| Lucie se confie à Camille | Rencontre à la boulangerie (graine 29 : 09:57) | Camille → Mireille → … (en 29 la rumeur passe par Mireille, Paul, Karim, Inès) ; si elle atteint Thomas : coup de théâtre | Camille, Mireille, Thomas | existant |
| Quarante couverts : la mairie réserve | Chloé livre la mairie (11:45) ; banquet | Restaurant plein → Lucie gagne ; Thomas impressionné | Chloé, Thomas | **(à créer : groupe de clients)** |

---

## 4. Bases de causalité plus fortes

Aujourd'hui, la journée A tient surtout par des **coups du sort indépendants** (18 en 51, chacun attaché à un arc) : ils ne se causent pas entre eux, et plusieurs n'ont pas de cause visible (« une urgence », « une commande urgente », « privée de sortie »). Les chaînes ci-dessous proposent des liens **entre personnages**. Pour chacune : le point d'appui observé en A, puis la chaîne (idée), puis la mécanique — existante (**existe** : nom du mécanisme) ou à créer (**à créer** :).

| # | Chaîne (cause → effet → effet) | Point d'appui en A (51) | Mécanique |
|---|---|---|---|
| C1 | **Léa en retard** → Nadia la prive de sortie à 17:40 → Léa absente du parc après 17:30 → Noé ne lui parle pas avant 21:00 | Retard de 11 min à 08:41 ; privation 17:40 (coup du sort de l'arc de Noé, sans lien avec le retard) | **existe** : `stay_home` ; **à créer** : coup du sort **conditionnel** (`requires: { event: 'late', agent: 'lea' }`) : à l'heure, pas de privation |
| C2 | **Noé se confie à Gérard au petit-déjeuner** → Gérard le répète à Mireille au parc → Mireille le répète à Nadia ou à Camille → la rumeur atteint Léa → coup de théâtre pour Noé | Bavardage Gérard–Noé 07:42 ; Gérard–Mireille 12:21 et 18:52 au parc ; Gérard répète réellement un secret (Paul → Martin) à 19:42 | **existe** : révélation + rumeur (probabilités) ; **à créer** : une rencontre Mireille–Léa ou Nadia–Mireille (20 min au parc à 21:31 en A) |
| C3 | **Gérard prend le bus seul** → malaise à bord du L1-1 de 08:25 → Antoine immobilise le bus → horaire perdu (arc d'Antoine), Alice (montée à 08:19) en retard à l'agence, Gérard manque sa consultation de 09:00 → Nadia l'apprend → Noé prévenu, le secret de Gérard éclate | Gérard monte seul à 08:25 et 09:25 ; discute avec Antoine à 09:26 ; Alice monte dans le L1-1 aux Lilas à 08:19 | **existe** : `illness`, `bus_delay` ; **à créer** : malaise **probabiliste** lié au secret (risque si seul dans le bus) ; **à créer** : « les proches se déplacent » (aujourd'hui `notifyClose` ne change que l'humeur) |
| C4 | **Mireille se confie à Gérard** (sa lettre au journal) → Gérard le répète à Antoine au parc → coup de théâtre pour Mireille → Antoine refuse de la prendre dans son bus | En graine 29, Mireille se confie à Gérard à 12:28 ; en 51 Gérard et Antoine discutent au parc à 17:41 | **existe** : tout existe (révélation, rumeur, `reachesTarget`) : seule la probabilité décide ; **à créer** : effet durable « ne se parlent plus » |
| C5 | **Martin perd son carnet au café (07:45)** → Julien le trouve → l'interview de 14:30 devient une accusation chiffrée → Antoine humilié file à la salle → dîner manqué (cause réelle) | Martin au café à 07:45 ; interview Julien–Antoine 14:25–15:00 ; Antoine à la salle 19:20 (coup du sort sans cause) | **à créer** : objets perdus autres que le portefeuille ; **à créer** : « contenu » d'une rencontre (l'interview change de ton selon un objet détenu) |
| C6 | **Paul se confie à Gérard (18:25)** → Gérard le répète à Camille au parc (19:22) → Camille l'apprend → coup de théâtre (contrecoup) pour Paul… et Camille renonce à vendre | Confidence 18:25 ; Gérard–Camille discutent à 19:22 ; Gérard répète déjà à Martin à 19:42 | **existe** : tout existe ; **à créer** : effet du secret sur le **destinataire** (Camille change d'arc : « ne pas vendre ») |
| C7 | **Alice se confie à Sophie (07:45)** → Sophie dîne près de Thomas Chez Lucie (19:04) et le lui répète → Thomas apprend l'offre → il renvoie ou promeut Alice | Confidence 07:45 ; Sophie–Thomas 48 min au restaurant ; Sophie répète en A à Nadia à 21:54 | **existe** : rumeur ; **existe** : `dismissal` / `promotion` ; **à créer** : réaction du destinataire (aujourd'hui seulement humeur −0,15 et affinité −0,12) |
| C8 | **Lucie se confie à Camille** → Camille le répète à Mireille → Mireille le répète à tout le parc → Thomas l'apprend → pas de partenariat → l'agence (qui comptait sur Lucie) va plus mal → Alice accepte l'offre | Graine 29 : Lucie → Camille 09:57, Camille → Mireille 19:20, Mireille → Paul, Karim, Karim → Inès (déjà quatre maillons) | **existe** : rumeur ; **à créer** : conséquence d'agence (état « santé de l'entreprise ») |
| C9 | **Hugo envoyé à la salle avant 16:30** → séance tenue avec Karim → Karim reste à la salle après 19:00 → Antoine l'y retrouve vraiment → ils parlent du car régional → Antoine rentre en retard (ou à l'heure, réconforté) | Coup du sort Hugo 16:20/16:30 ; Karim quitte la salle à 19:00 ; Antoine y arrive à 19:20 | **existe** : `force_action` ; **à créer** : coup du sort « avec Karim » **conditionné à la présence de Karim** |
| C10 | **Élodie perd son portefeuille (12:35)** → Martin (ou Noé) le trouve → il y lit la lettre pour Alice → la rumeur atteint Alice → Élodie et Alice ont enfin la conversation | Perte 12:35 ; trouvé par Martin à 18:10 (graine 29) ou Noé à 18:32 (graine 42) | **existe** : `lose_item`, `find_item`, `return_item` ; **à créer** : objet dans l'objet (la lettre) |
| C11 | **Inès interroge Mireille pour son mémoire** → Mireille raconte à Hugo qu'une étudiante écrit l'histoire du Papillon → Hugo comprend « pourquoi Inès vient tous les jours » → arc d'Hugo accompli par l'indice, celui d'Inès bouleversé | Inès–Mireille : 51 min au même endroit sans un mot ; Hugo–Mireille : 100 min (café, parc) | **à créer** : action « interroger » ; **à créer** : relation Inès–Mireille (aujourd'hui le secret d'Inès est bloqué : seul confident, Hugo) |
| C12 | **La pluie de 14:00** (coup du sort de l'arc de Mireille) → le parc se vide → Gérard attend Paul seul sous la pluie (15:00–15:38) → refroidissement → malaise le soir → l'« urgence » de Nadia à 18:45 a une cause | Averse 14:00–17:30 ; Gérard au parc 14:29–15:41 | **existe** : `weather`, `illness` ; **à créer** : effet de la météo sur la santé |
| C13 | **Chloé livre la mairie tôt (avant 11:45)** → elle est à la boutique à 12:10 → fleurs de Yasmine tenues → Yasmine heureuse, elles se parlent à midi → Chloé confie la surprise → Yasmine prévient Antoine le soir (Villa Rosa 20:55) | Coup du sort Chloé 11:45/11:58 ; Yasmine attend au fleuriste 11:59–12:27 ; confidence Chloé → Yasmine à 21:53 ; Yasmine–Antoine à 20:55 | **existe** : `force_action`, révélation ; **à créer** : action « transmettre un message » (prévenir quelqu'un qu'on l'attend) |
| C14 | **L'article de Julien paraît à 18:00** → tout le parc en parle (nœud du soir) → Antoine l'apprend → Mireille se sent coupable → Martin sort son carnet → Thomas savoure (rival) | Nœud du parc 18:00–20:30 (jusqu’à 7 personnes à la fois) ; Julien au parc 20:10 et 21:43 | **à créer** : **événement public** (une nouvelle que tous ceux qui sont présents apprennent d'un coup) |
| C15 | **Le 21ᵉ habitant descend du bus à 10:00** (repreneur de la boulangerie) → Mireille le voit entrer chez Camille → la rumeur atteint Lucie → Lucie se confie à Thomas pour la première fois → … | Mireille au parc et au café toute la journée ; Lucie–Camille jamais au même endroit | **à créer** : étranger temporaire (profil, routine minimale, arrivée par le bus) |

---

## 5. Synthèse : ce que Vincent pourrait décider

### 5.1 Les 5 objectifs à réécrire d'abord

| Priorité | Habitant | Problème mesuré en A | Réécriture proposée |
|---|---|---|---|
| 1 | **Alice** | Impossible : patron/employée ne produisent jamais de vraie conversation (vérifié en B, même rencontre forcée hors agence) | « Annoncer à Thomas l'offre concurrente avant la rumeur » + règle « hors du lieu de travail, patron = relation ordinaire » |
| 2 | **Sophie** | Réglé à 10:27 (et 09:26, 09:27, 10:03 dans les autres graines) ; le coup du sort de 14:00 ne sert à rien | « Rendre les lettres à Julien » (but actif, hors comptoir, avant 19:00) |
| 3 | **Élodie** | Un seul coup du sort décide tout à 12:35 ; secret sans confident ; elle rate son portefeuille en travaillant à côté | « Remettre la lettre à Alice » (la lettre est dans le portefeuille) |
| 4 | **Camille** | Un seul client avant 14:00 ; arc jugé à 14:00 alors que la boutique est « vendue » à 16:24 ; secret bloqué | « Décider de vendre ou non » (fidéliser quatre habitués avant 14:00, sinon le repreneur) |
| 5 | **Martin** | Aucun coup du sort ni antagoniste ; secret incommunicable | « Remettre le carnet à Julien (ou le lui refuser) avant 14:30 » |

À suivre de près : **Mireille** (le désir dit « cinq personnes », la règle compte dix conversations ; échec à une près), **Antoine** (arc du jour 1 sans secret, second arc trivial : le bus n'a jamais plus d'une minute de retard), **Lucie** (deux échanges dans la journée), **Karim** (objectif « cours de 18 h » non modélisé), **Hugo/Inès** (issue décidée par la chance : réussite en 7 et 42, échec à 13 minutes près en 51).

### 5.2 Les 5 types d'événements qui manquent

1. **L'aveu** : le propriétaire d'un secret le dit lui-même à la personne concernée (aujourd'hui `shareSecrets` l'interdit explicitement). C'est la résolution « courageuse » qui manque à huit arcs (Alice, Noé, Nadia, Yasmine, Hugo, Chloé, Paul, Élodie).
2. **La remise d'objet** : lettre, cadeau sculpté, carnet, livre, pain, commode. Les objets sont partout dans les secrets et les désirs, mais l'inventaire ne connaît que le portefeuille.
3. **La réaction des proches** : quand un habitant a un accident ou un malaise, ses proches l'apprennent (`notifyClose`) mais ne bougent pas. Une visite au chevet ou un détour crée des chaînes entre arcs (Noé pour Gérard, Lucie pour Thomas, Nadia pour Léa).
4. **L'événement public** : une nouvelle apprise par tous ceux qui sont présents (article publié, annonce de fermeture de la salle, vente de la boulangerie), qui transforme le nœud du soir en scène collective.
5. **L'arrivée d'un étranger** : un 21ᵉ habitant temporaire, qui descend du bus à une heure donnée, avec un but et un secret, et qui sert de cause à plusieurs coups du sort.

Deux corrections de moteur valent autant qu'un nouveau type : **autoriser la vraie conversation pendant un rendez-vous entre proches** (Léa–Noé) et **hors du lieu de travail entre collègues** (Alice–Thomas, Thomas–Martin) ; et **rendre les coups du sort conditionnels et véridiques** (Hugo « rappelé au café » reste chez lui ; Antoine « avec Karim » est seul ; Yasmine « encore en chemin » attend sur place depuis 11:59 ; la pluie de l'arc de Mireille noie la pétanque de Gérard sans que personne ne le sache).

### 5.3 Les 3 idées de structure

**A. Les sous-intrigues comme aides.** Le second arc de chaque habitant existe déjà et réussit souvent seul (11 sur 20 dans la variante). Au lieu d'attendre le lendemain, le jouer **le même jour comme sous-intrigue** : sa réussite donne un atout au principal (aide, indice, geste débloqué, personne gagnée — voir §2). Exemples : le dossier de Martin tenu à 16:55 libère son « quartier libre » au café ; le livre de Noé devient l'objet qui ouvre la conversation avec Léa ; les bouquets de Chloé livrés tôt sauvent les fleurs de Yasmine. Le carnet du joueur pourrait afficher « atouts gagnés dans cette boucle ».

**B. L'étranger du bus.** Un seul 21ᵉ personnage, qui change d'identité selon l'habitant suivi ou selon la boucle, mais qui descend toujours du L1-1 à la même heure (par exemple 10:00, arrêt Place du Marché) : *l'inspecteur de la régie* (Antoine, Julien, Martin, Mireille), *le repreneur de la boulangerie* (Camille, Lucie, Paul), *le recruteur de l'agence concurrente* (Alice, Thomas), *l'émissaire de l'hôpital* (Nadia, Léa). Il donne une cause aux coups du sort (« la livraison qui n'arrive pas », « la réunion qui s'éternise ») et un visage à la menace.

**C. Le nœud de la journée à 18 h 30, au Parc des Tilleuls.** Les données désignent ce lieu et cette heure : 7 habitants présents à 18:00 et à 19:00, 12 à 15 événements sociaux par heure entre 18 h et 21 h, contre 3 ou 4 entre 9 h et 13 h. Y placer un rendez-vous collectif (fête de quartier au kiosque, concert, publication de l'article, annonce de la fermeture de la salle) qui rassemble les fils : là où les rumeurs voyagent, là où les secrets se croisent. Le matin servirait à préparer le nœud, l'après-midi à le rater ou à le réussir.

---

## Annexe — Méthode

- Réalité A : `runDay(seed)` de `tests/helpers.ts` (graine 51 = `DEMO_SEED`, puis 7, 29, 42), jour 1, aucune intervention.
- Rencontres : événements `encounter`, `conversation`, `argument`, `meeting_start` (définition de `whoMetWhom`) ; confidences et rumeurs : `revelation`, `gossip` ; rendez-vous manqués : `meeting_missed`.
- Coprésence : trace minute par minute (`reality.trace`), deux habitants éveillés dans le même lieu nommé (les trajets et le bus ne comptent pas).
- Arcs : `reality.engine.state.arcs`, `arcSeed`, `questDifficulty` ; relations au réveil : instantané de 06:00 (`reality.snapshots.get(360)`), relations finales : `reality.engine.state`.
- Vérifications en B (forks) : rencontre forcée Alice–Thomas au café à 18:00 et au parc à 17:40 (toujours « parlent boulot ») ; Chloé–Antoine à la Villa Rosa à 18:30 (« bavardent joyeusement », dîner toujours manqué).
- Variante « seconds arcs » : même état initial que A (graine 51), arcs remplacés par les seconds arcs et leurs coups du sort (`fateOf`). C'est un test de difficulté, pas la réalité A.
- Les scripts d'extraction sont des scripts jetables (hors dépôt) ; tous les chiffres « en A » de ce document en proviennent. La matrice est aussi dans [`interactions-A.csv`](interactions-A.csv).
