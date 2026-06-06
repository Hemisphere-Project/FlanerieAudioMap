# Avant VILLEURBANNE — État de l'application et procédure de test

**Date :** 2026-05-27
**Précédente sortie terrain :** GIVORS, 2026-05-20 (≈ 45 visiteurs, 16 marches propres, 21 marches complétées avec friction, 6 incomplètes)
**Public :** équipe Flânerie, direction

---

## 1. Synthèse

Depuis GIVORS, sept séances de développement ont produit trois nouvelles versions des plugins natifs (audio, géoloc, économie d'énergie) et une vingtaine de correctifs côté application. La quasi-totalité des problèmes que GIVORS a permis d'identifier a été reprise au moins partiellement : sortie de balade propre, audio qui ne « bloque » plus au démarrage Android, télémétrie beaucoup plus parlante, gestion d'iOS 26.3 sur les téléphones de prêt.

Deux travaux restent ouverts et ont besoin d'une sortie terrain pour être calibrés : la sonnette d'alarme « GPS gelé » et le filtrage des chevauchements de zone GPS. Le troisième chantier identifié à GIVORS — renforcement Android pour les marques restrictives (Samsung, Xiaomi) — a été livré dans la dernière version du plugin GPS (v2.9.0, Architecture D : source GPS de secours via Google Play Services qui prend le relais automatiquement) ; VILLEURBANNE servira de validation terrain.

**Recommandation :** la sortie VILLEURBANNE peut se faire avec la version actuelle. Elle doit servir à valider les correctifs livrés depuis GIVORS et à collecter la donnée qui débloquera les trois derniers chantiers.

---

## 2. Problèmes identifiés à GIVORS — état au 27 mai

| Problème observé à GIVORS | Cause | Correctif livré | Encore à valider en terrain |
|---|---|---|---|
| **iOS 26.3.1 — coupures GPS de 8 à 14 min** sur 3 visiteurs (`51nv, ibk6, mq3z`) | Régression Apple iOS 26.3.x en arrière-plan | Avertissement à l'onboarding sur les iPhone en 26.3.x ; nouvelle action native `forceReacquire` qui redémarre la localisation après 60 s sans position réelle | Tester sur un iPhone en 26.3.x si possible |
| **iOS 26.4.2 — coupures GPS courtes (2 à 5 min)** ; deux visiteurs (`19dh, rumx`) bloqués à l'étape 15 | Suspension iOS en arrière-plan plus aggressive | Même `forceReacquire` ; diagnostic complet de l'état GPS toutes les 30 s | Confirmer que le redémarrage automatique récupère bien la position |
| **Échecs de lecture audio** sur 5 visiteurs — 14 fichiers différents touchés (`vigi, wjfo, rumx, mq3z, 0vvc`) | Plusieurs mécanismes mélangés : erreurs de chargement, échecs de décodage, time-out | Trois choses : (1) erreurs audio désormais classifiées par type dans la télémétrie, (2) vérification automatique de tous les fichiers média à l'entrée de la balade, (3) nouvelle tentative + reset audio sur première erreur de lecture | Les fichiers concernés (notamment BLOC_15 / BLOC_16) doivent passer sans erreur |
| **Démarrage Android — silence de 70 s** au premier lancement (téléphone non-prêt) sur ~4 visiteurs (`5eb0/9qf4, 4ha8/aibf, 85iu/2tqf, ygi1/0vvc`). Conséquence : le visiteur abandonnait et redémarrait l'application. | Course entre Howler (moteur audio Android) qui charge le premier fichier et la zone GPS qui se déclenche pendant le chargement | Deux choses : (1) la lecture est désormais déclenchée *quand le fichier est prêt* et non avant, (2) le premier fichier audio (BLOC_01) commence à être chargé dès l'écran SAS (le visiteur tape 4321 — pendant ce temps Howler charge tranquillement) | Démarrage doit être instantané sur Android non-prêt |
| **Étapes répétées / audio qui « rembobine »** sur 12 visiteurs au total. Cas extrême : `yapj` (John) — 4 répétitions au passage des zones BLOC_10 à BLOC_14 | Récupération GPS qui re-déclenche l'étape en cours alors que la position vient à peine de revenir | Travail engagé mais non finalisé : il faut une donnée terrain pour calibrer les seuils de précision (gate de « 2 échantillons consécutifs » + précision ≤ rayon de la zone). Ce sera fait après VILLEURBANNE. | À mesurer : nouveau champ télémétrique `accuracy_near_border` |
| **Re-armement de téléphone de prêt — silence audio** sur ~4-5 cas par jour (Justine, opérateur tente) | État audio « pollué » par le visiteur précédent | Le bouton « Re-armer » : (1) demande confirmation, (2) coupe proprement audio + GPS + télémétrie de la session précédente, (3) ré-initialise le moteur audio, (4) repart sur le menu d'accueil pour le visiteur suivant | Tester ce flow sur un téléphone de prêt |
| **Position audio « mal placée » après crash iOS** — `rumx` reprenait l'audio à 4 min 39 s à chaque crash, indépendamment de l'étape | Position de reprise écrite par une étape, restaurée sur l'étape suivante | La position est désormais remise à zéro à chaque changement d'étape ; la position n'est enregistrée que si l'audio joue depuis au moins 3 secondes | Tester en tuant volontairement l'app au milieu d'une étape |
| **Kills Android** (OEM-kill) — 20 sessions avec au moins un redémarrage de l'app pendant la balade, dont `f743` (Samsung A15) avec 7 redémarrages | Politiques agressives Samsung / Xiaomi / Motorola | Travail Android natif : (1) AlarmManager qui réveille le service GPS toutes les 30 s, (2) suivi du « pourquoi est-ce que l'OS a tué l'application » (API Android 11+), (3) libération automatique de la mémoire des étapes passées | Sur Samsung / Xiaomi : la balade doit aller jusqu'au bout sans intervention |
| **Téléphones de prêt indistinguables** dans la télémétrie | Pas d'identifiant durable côté appareil | Chaque téléphone reçoit un UUID persistant + un drapeau « téléphone de prêt » réglable depuis le mode opérateur ; un nouveau registre serveur (`/devices`) liste les appareils | À régler en mode opérateur sur chaque téléphone de prêt avant la sortie |
| **Cache d'application périmé** — 2 visiteurs (`892p, c7qo`) tournaient sur une vieille version du parcours (18 étapes au lieu de 17) | Le cache du navigateur (PWA) ne se mettait pas à jour automatiquement | Vérification automatique à l'entrée du parcours : si le fichier serveur est plus récent, l'application propose une mise à jour | Vérifier que les téléphones tournent bien sur la dernière version |

---

## 3. Améliorations générales (hors GIVORS)

Travaux effectués sur les plugins natifs eux-mêmes et déposés sur GitHub. Toutes ces versions sont déjà intégrées au build actuel.

- **`cordova-plugin-audiofocus` v1.6.0** — Service Android passé en « média » avec icône d'application, récupération automatique si Android tue le service, détection des branchements/débranchements casque (Bluetooth, jack), détection passage en mode économie d'énergie, nouvelle remontée de l'état complet de la session audio iOS.
- **`cordova-plugin-power-optimization` v0.3.1** — Le plugin remonte désormais : raisons des derniers crashes de l'application (API Android 11+), pression mémoire en temps réel, « catégorie » Android de l'application (Active / Working set / Frequent / Rare / Restricted), intent d'autostart Xiaomi MIUI (manquait), correction d'un bug LeTV, et désormais (v0.3.1) la détection « hibernation Android 11+ » qui révoque silencieusement les permissions des applis peu utilisées.
- **`cordova-background-geolocation-plugin` v2.9.0** — Cinq nouvelles versions cumulées depuis GIVORS : v2.5.0 (diagnostic complet état GPS iOS), v2.6.0 (forceReacquire iOS + AlarmManager Android Doze + détection automatique de gel via les changements de localisation significatifs iOS), v2.7.0 (transmission immédiate des changements d'autorisation iOS + identifiant de tâche background dans les keepalive — ne sont plus comptés comme positions GPS réelles, ce qui débloque la sonnette d'alarme « GPS gelé »), v2.8.0 (compteur Doze Android exposé en temps réel : permet de détecter à VILLEURBANNE si le réveil Android passe mais que JavaScript reste figé), et **v2.9.0 (Android : deuxième source GPS de secours via Google Play Services qui prend le relais automatiquement si la source principale est bloquée par Doze / Samsung / Xiaomi ; la source principale reprend dès qu'elle redevient disponible — l'application voit un flux continu de positions étiquetées par origine pour analyse a posteriori)**.
- **Outillage de télémétrie** — Le script d'analyse (`telemetry/scripts/analyze.mjs`) supporte de nouveaux filtres : `--include-loan-only`, `--exclude-loan`, `--device-uuid`, et reconnaît automatiquement les nouveaux événements (cl_state, audio_route_changed, real_callback_freshness, accuracy_near_border, etc.).
- **Fin de balade — message générique** : le texte de fin a été réécrit pour fonctionner aussi bien sur les téléphones de prêt que sur les téléphones personnels (« La balade est terminée. Tu peux ranger le téléphone. La suite t'attend. »). L'écran ne se referme plus seul.

---

## 4. Points d'attention pour VILLEURBANNE

Ces points sont connus et **par construction non bloquants**. Ils ont besoin de données réelles pour être calibrés.

1. **Sonnette d'alarme « GPS gelé » (`gps_frozen` / freeze-band)** — Le code détecte déjà une absence de position réelle (≥ 60 s) ; un message visible à l'écran est prêt mais désactivé tant que le seuil n'est pas calibré sur des données réelles. **VILLEURBANNE remontera ces données.**
2. **Filtrage des chevauchements de zone GPS** — La logique « avancer à l'étape suivante » est encore trop sensible aux petits débordements. Le nouveau champ télémétrique `accuracy_near_border` est en place. **VILLEURBANNE remontera la distribution réelle des marges GPS.**
3. **Renforcement Android pour OEMs restrictifs** — Une couche supplémentaire (FusedLocationProvider Google) est prête à être activée si on observe deux ou plus de coupures Android ≥ 5 min sur Samsung/Xiaomi/Motorola pendant VILLEURBANNE.
4. **Caveat technique** — La fin de balade (page « end ») permet par construction un redémarrage par 5-taps (utilisé pour les téléphones de prêt). Si un visiteur tape inopinément 5 fois pendant les 300 ms requises, l'application recharge l'écran d'accueil ; la balade reste comptée comme terminée. Pour effectuer un vrai re-armement il faut ensuite faire 5-taps en bas de l'écran d'accueil. Ce comportement est intentionnel — il ne représente pas une perte de données.
5. **Détection silence audio** — Spec initiale (`F-A4`) abandonnée : la détection est déjà couverte par d'autres mécanismes (`voice_snapshot`).
6. **Diagnostic Doze Android (Fix 1e)** — La version v2.8.0 du plugin GPS expose un compteur de réveils Doze. Toutes les 30 s, l'application enregistre ce compteur. Si à VILLEURBANNE on observe que ce compteur monte mais que les positions GPS ne remontent pas, cela confirmera que le WebView est suspendu malgré le service natif vivant.
7. **GPS de secours Android (Architecture D, plugin v2.9.0)** — Sur Android, le plugin GPS gère désormais deux sources en parallèle : la source principale (GPS brut, identique à GIVORS) reste prioritaire pour la précision et la cadence ; la source de secours (Google Play Services) prend le relais automatiquement dès que la source principale s'arrête de remonter des positions (typiquement : Doze profond, Samsung One UI qui suspend l'app). La bascule est invisible côté visiteur. À VILLEURBANNE, la télémétrie comptabilisera combien de fois la source de secours est intervenue par balade — un chiffre élevé sur Samsung / Xiaomi confirmera que la couche apporte de la valeur ; un chiffre nul confirmera que la source principale suffit. Risque inexistant : si Google Play Services manque (cas marginal sur quelques téléphones dégooglisés), le plugin tourne comme avant.

---

## 5. Tests terrain à conduire — VILLEURBANNE

Chaque test correspond à un correctif livré depuis GIVORS ou à un paramètre qui doit être calibré sur des données réelles. Pour chaque test : conditions d'exécution, ce qu'on observe sur le terrain, et champ télémétrique à vérifier après.

---

### T-1 — Démarrage audio immédiat sur Android (premier lancement et après re-armement)

**Contexte :** GIVORS — ~4 visiteurs Android ont attendu ~70 s en silence avant que l'audio démarre, aussi bien au premier lancement que sur des téléphones personnels en cours de session. Le bug était une course entre le chargement Howler et le déclenchement de la première zone GPS ; il n'était pas propre aux téléphones de prêt.

**Comment conduire le test — cas A (Android non prêt, premier lancement) :**
1. Prendre un Android dont le cache a été vidé ou qui n'a jamais lancé ce parcours.
2. Code « 4321 » → chronomètre déclenché au tap sur la zone de départ.
3. Noter le délai avant le début effectif de l'audio BLOC_01.

**Comment conduire le test — cas B (Android après re-armement téléphone de prêt) :**
1. Faire faire une balade jusqu'à l'étape 3 minimum sur un téléphone de prêt Android.
2. Re-armer (T-7). Brancher un casque → code « 4321 » → entrer dans la zone BLOC_01.
3. Même mesure de délai.

**Résultat attendu :** audio dans les **5 secondes** dans les deux cas.

**Résultat à signaler :** tout délai > 10 s, ou absence d'audio.

**Télémétrie après :** `audio_load_duration` pour BLOC_01 — valeur cible < 3 000 ms. Vérifier l'absence d'`audio_error` dans les 30 premières secondes.

---

### T-2 — Récupération GPS automatique sur iOS (forceReacquire)

**Contexte :** GIVORS — coupures GPS de 2 à 14 min sur plusieurs iPhone (iOS 26.3.x et 26.4.2). Le mécanisme `forceReacquire` redémarre la localisation après 60 s sans position réelle.

**Comment conduire le test :**
- **Cible privilégiée :** un iPhone en iOS 26.3.x ou 26.4.2 si disponible.
- **Cible alternative :** tout iPhone sur une balade longue (> 8 étapes).
- Observer si l'application passe les étapes normalement même si l'icône GPS clignote brièvement.
- Si l'application affiche « GPS non disponible » plus de 90 s sans récupération, noter l'heure et l'étape.

**Résultat attendu :** après une suspension iOS, la position revient automatiquement dans les 90 s sans intervention du visiteur.

**Résultat à signaler :** suspension > 90 s, ou visiteur bloqué à une étape sans récupération.

**Télémétrie après :** chercher les événements `force_reacquire` dans la session iOS ; chaque `force_reacquire` doit être suivi d'un `gps_position` réel dans les 90 s. Distribution `real_callback_freshness` cible : 95 % des échantillons < 60 s.

---

### T-3 — Étapes répétées / audio qui rembobine (calibrage seuils GPS)

**Contexte :** GIVORS — 12 visiteurs touchés, cas extrême `yapj` (4 répétitions BLOC_10–BLOC_14). Correctif de seuil en attente de données réelles ; le champ `accuracy_near_border` est instrumenté.

**Comment conduire le test :**
- Pas d'action particulière sur les balades normales : observer et recueillir les retours.
- **Test actif recommandé (1 opérateur ou testeur) :** longer délibérément les bords des zones GPS pendant 30–60 s — passer lentement la frontière dans un sens, reculer, re-passer. Ce comportement exagère les conditions qui déclenchaient les répétitions à GIVORS et produit un échantillon `accuracy_near_border` dense, utile pour le calibrage.
- En retour de balade, demander à chaque visiteur : « Est-ce qu'un même passage audio s'est répété ? »
- Si répétition signalée : noter **l'étape** et **l'heure approximative**.

**Résultat attendu :** zéro répétition non voulue sur les balades normales. Le test de bordure peut en provoquer — c'est attendu et documenté comme tel.

**Résultat à signaler :** répétition sur balade normale (sans borderriding intentionnel).

**Télémétrie après :** relever `accuracy_near_border` autour des timestamps concernés. La distribution de ces valeurs calibrera le seuil de filtrage post-VILLEURBANNE.

---

### T-4 — Lecture audio sur BLOC_15 et BLOC_16 (fichiers problématiques à GIVORS)

**Contexte :** GIVORS — 14 fichiers touchés par des erreurs de lecture, dont BLOC_15 et BLOC_16 sur plusieurs visiteurs. Trois correctifs déployés : classification d'erreur, vérification à l'entrée du parcours, nouvelle tentative + reset sur première erreur.

**Comment conduire le test :**
- Pour chaque visiteur en retour : a-t-il entendu l'audio de chaque étape ? Insister sur les étapes 15 et 16.
- En cas d'anomalie : muet, son tronqué, ou son qui recommence depuis le début ?

**Résultat attendu :** BLOC_15 et BLOC_16 lisibles sans intervention.

**Résultat à signaler :** muet, erreur de chargement, ou reprise depuis le début sur ces étapes.

**Télémétrie après :** filtrer sur `audio_error` et `audio_retry` ; vérifier que les erreurs résiduelles ont un `error_type` renseigné.

---

### T-5 — Résistance aux kills OEM sur Samsung / Xiaomi / Motorola

**Contexte :** GIVORS — 20 sessions avec au moins un redémarrage forcé par l'OS, dont `f743` (Samsung A15) avec 7 redémarrages.

**Comment conduire le test :**
- Identifier les téléphones de prêt Samsung, Xiaomi ou Motorola dans le lot ; les affecter en priorité à des balades complètes.
- En retour : « L'application s'est-elle jamais fermée seule ? »

**Résultat attendu :** aucune interruption visible pour le visiteur (l'application se relance en arrière-plan sans intervention).

**Résultat à signaler :** application fermée et non relancée automatiquement, ou visiteur ayant dû rouvrir lui-même.

**Télémétrie après :** chercher `app_restart_reason` dans les sessions Android. Deux coupures GPS Android >= 5 min sur ces modèles déclenchent l'activation de Fused Location Provider.

---

### T-6 — Reprise audio à la bonne position après kill de l'application iOS

**Contexte :** GIVORS — `rumx` reprenait l'audio au même offset (4 min 39 s) **quelle que soit l'étape courante**, parce que la position de reprise écrite par une étape était restaurée sur l'étape suivante. Le correctif : la position n'est enregistrée que si l'audio joue depuis au moins 3 s, et elle est remise à zéro à chaque changement d'étape.

**Comportement attendu (à valider) :**
- Kill au milieu d'une étape → rouvrir → l'audio reprend **à l'offset sauvegardé** dans cette étape (non à zéro, non au début du fichier).
- Entrer dans l'étape suivante → l'audio de la nouvelle étape commence **depuis le début** (offset remis à zéro).

**Comment conduire le test (test actif sur téléphone dédié) :**
1. Lancer une balade iOS. Laisser l'audio de BLOC_03 jouer pendant au moins 30 s.
2. Tuer l'app depuis le sélecteur de tâches iOS (swipe up). Attendre 5 s.
3. Rouvrir l'app : l'audio doit reprendre à ~30 s dans BLOC_03 (pas depuis le début, pas depuis un offset d'une autre étape).
4. Marcher jusqu'à la zone BLOC_04 : l'audio doit démarrer depuis le début de BLOC_04 (offset = 0).

**Résultat attendu :** reprise à un offset non nul dans l'étape où l'app a été tuée ; offset = 0 à l'entrée de l'étape suivante.

**Résultat à signaler :** reprise depuis le début du fichier après kill (offset ignoré), ou offset résiduel d'une étape précédente qui se propage sur l'étape suivante.

**Télémétrie après :** `audio_resume_offset` dans la session iOS — valeur > 0 après kill dans la même étape, valeur = 0 à l'entrée d'une nouvelle étape.

---

### T-7 — Vérification des identifiants téléphones de prêt et re-armement

**Contexte :** GIVORS — téléphones de prêt indistinguables dans la télémétrie. Correctif : UUID persistant + drapeau LOAN + bouton « Re-armer » refactorisé pour un reset propre de l'état audio entre deux visiteurs.

**Comment conduire le test — UUID/LOAN (avant la sortie, sur chaque téléphone de prêt) :**
1. Mode opérateur (5 taps) → bascule **« Téléphone de prêt »** activée.
2. Badge **LOAN** visible dans l'interface.
3. UUID affiché différent d'un téléphone à l'autre (pas de doublon).

**Comment conduire le test — re-armement (à chaque rotation de visiteur) :**
1. Visiteur rend le téléphone. Mode opérateur → **« Re-armer »** → confirmer le pop-up.
2. L'app revient à l'écran d'accueil sans redémarrage manuel.
3. Brancher un casque → code « 4321 » → zone BLOC_01 : audio démarre proprement (voir T-1 cas B).

**Résultat attendu :** badge LOAN présent, UUID unique par appareil, re-armement sans résidu audio.

**Résultat à signaler :** UUID en doublon, badge absent, ou audio corrompu après re-armement.

**Télémétrie après :** `analyze.mjs --include-loan-only` — toutes les sessions de prêt doivent apparaître. La nouvelle session post-re-armement doit commencer par un événement `audio_engine_reset`.

---

### Récapitulatif des observations à noter sur le terrain

| Test | Ce qu'on note | Quand |
|---|---|---|
| T-1 | Délai audio au démarrage Android (secondes) | Au lancement de chaque Android non prêt ; après re-armement |
| T-2 | Coupures GPS iOS : heure, durée, reprise auto OUI/NON | Pour chaque iPhone, en retour de balade |
| T-3 | Répétitions d'étape : étape + heure approx. | En retour de balade, pour tout visiteur |
| T-4 | Audio BLOC_15 / BLOC_16 : OK / muet / tronqué | En retour de balade, pour tout visiteur |
| T-5 | Samsung/Xiaomi — app fermée seule OUI/NON | En retour de balade, cibler ces modèles |
| T-6 | Test kill iOS : reprise à l'offset OUI/NON, offset = 0 à étape suivante OUI/NON | Test actif sur téléphone dédié |
| T-7 | Badge LOAN présent, UUID unique, re-armement propre OUI/NON | Avant la sortie + à chaque rotation de visiteur |


