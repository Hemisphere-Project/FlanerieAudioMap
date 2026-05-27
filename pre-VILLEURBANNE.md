# Avant VILLEURBANNE — État de l'application et procédure de test

**Date :** 2026-05-27
**Précédente sortie terrain :** GIVORS, 2026-05-20 (≈ 45 visiteurs, 16 marches propres, 21 marches complétées avec friction, 6 incomplètes)
**Public :** équipe Flânerie, direction

---

## 1. Synthèse

Depuis GIVORS, sept séances de développement ont produit trois nouvelles versions des plugins natifs (audio, géoloc, économie d'énergie) et une vingtaine de correctifs côté application. La quasi-totalité des problèmes que GIVORS a permis d'identifier a été reprise au moins partiellement : sortie de balade propre, audio qui ne « bloque » plus au démarrage Android, télémétrie beaucoup plus parlante, gestion d'iOS 26.3 sur les téléphones de prêt.

Trois travaux restent ouverts et ont besoin d'une sortie terrain pour être calibrés : la sonnette d'alarme « GPS gelé », le filtrage des chevauchements de zone GPS, et un éventuel renforcement Android pour les marques restrictives (Samsung, Xiaomi). Ces trois points sont **diagnostiqués** côté code — il faut maintenant des données réelles pour fixer les seuils.

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
- **`cordova-background-geolocation-plugin` v2.8.0** — Quatre nouvelles versions cumulées depuis GIVORS : v2.5.0 (diagnostic complet état GPS iOS), v2.6.0 (forceReacquire iOS + AlarmManager Android Doze + détection automatique de gel via les changements de localisation significatifs iOS), v2.7.0 (transmission immédiate des changements d'autorisation iOS + identifiant de tâche background dans les keepalive — ne sont plus comptés comme positions GPS réelles, ce qui débloque la sonnette d'alarme « GPS gelé »), v2.8.0 (compteur Doze Android exposé en temps réel : permet de détecter à VILLEURBANNE si le réveil Android passe mais que JavaScript reste figé — diagnostic préalable à une éventuelle couche supplémentaire de robustesse Doze).
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
6. **Diagnostic Doze Android (Fix 1e)** — La nouvelle version v2.8.0 du plugin GPS expose un compteur de réveils Doze. Toutes les 30 s, l'application enregistre ce compteur. Si à VILLEURBANNE on observe que ce compteur monte mais que les positions GPS ne remontent pas, cela confirmera que le WebView est suspendu malgré le service natif vivant — et débloquera une couche de robustesse supplémentaire dans la version suivante du plugin.

---

## 5. Procédure de test terrain — VILLEURBANNE

### 5.1 Préparation (la veille)

| Étape | Action | Vérification |
|---|---|---|
| 1 | **Mettre à jour les téléphones de prêt** depuis le PC opérateur (build APK le plus récent, version webapp à jour) | Sur chaque téléphone, ouvrir l'app et vérifier en bas de l'écran d'accueil que la version affichée est la plus récente |
| 2 | **Sur chaque téléphone de prêt** : entrer en mode opérateur (5 taps en haut de l'écran d'accueil), puis activer la bascule **« Téléphone de prêt »**. Sortir du mode opérateur. | Le badge « LOAN » doit apparaître discrètement dans la barre de statut |
| 3 | **Charger les téléphones à 100 %** | Tous les téléphones de prêt connectés à un hub la veille au soir |
| 4 | **Vérifier le parcours VILLEURBANNE côté serveur** | Le fichier `flanerie_villeurbanne_*.json` est bien présent et lisible (page `/list` accessible) |
| 5 | **Vérifier l'accessibilité du serveur télémétrie** depuis le lieu | Ouvrir un téléphone, faire un démarrage de balade fictif, voir la session apparaître côté serveur dans la minute |
| 6 | **Pré-télécharger le parcours sur chaque téléphone de prêt** (étape d'onboarding « préload ») | L'écran doit indiquer « tous les médias chargés », sans erreur |

### 5.2 Sur place — préparation tente opérateur

| Étape | Action |
|---|---|
| 1 | Disposer les téléphones de prêt par lots (5 par 5 par exemple) |
| 2 | Vérifier la connectivité 4G sur le lieu de la tente |
| 3 | Avoir une fiche papier prête (cf. § 5.4 ci-dessous) pour noter les observations |
| 4 | Avoir le numéro de téléphone d'astreinte technique à portée |

### 5.3 Pendant la sortie — pour chaque visiteur

**Cas A — téléphone personnel du visiteur**

1. Le visiteur a installé l'app et téléchargé le parcours en amont (instructions mail).
2. À la tente : confirmer l'onboarding (GPS toujours / notif / fond / batterie), tester audio, lui demander de mettre le téléphone en silencieux total (pas vibreur), confirmer batterie ≥ 50 %.
3. Code SAS « 4321 » → lancement.
4. Le visiteur part. **L'opérateur note l'heure de départ.**

**Cas B — téléphone de prêt**

1. Vérifier sur le téléphone : marqueur « LOAN » visible, batterie ≥ 60 %, parcours à jour.
2. Si un visiteur précédent vient de rendre le téléphone : **bouton « Re-armer »** dans le menu opérateur → confirmer le pop-up → l'application repart automatiquement sur l'écran d'accueil. Vérifier que l'audio fonctionne (étape de test casque).
3. Onboarding visiteur (notifications, GPS toujours, etc. — la plupart des étapes sont déjà validées).
4. Code SAS « 4321 » → lancement.
5. **L'opérateur note l'heure de départ + ID téléphone.**

### 5.4 Fiche d'observation par visiteur (à imprimer)

```
Heure de départ : __________   ID téléphone (loan) : __________
iOS / Android :  __________   Modèle approximatif : __________
Audio démarre immédiatement ?         OUI / NON  → si NON, attendre combien : ___ s
Coupures GPS pendant la marche ?      OUI / NON  → combien de fois, durée approx : _____
Audio se répète / rembobine ?         OUI / NON  → à quelle étape : _____
Application qui semble plantée ?      OUI / NON  → action prise : _____
Heure de retour à la tente :          __________
Le visiteur a-t-il rapporté un souci ? _________________________________________
```

### 5.5 Cas particuliers — ce qu'il faut faire

| Situation | Action immédiate |
|---|---|
| Visiteur dit « pas d'audio depuis 30 s » | Lui dire de tapoter 5 fois en bas de l'écran d'accueil après retour à l'écran de démarrage (rare — uniquement si vraiment bloqué) |
| Visiteur dit « je suis perdu, plus rien à entendre » | Vérifier sur place qu'il a bien la carte affichée ; lui demander de rejoindre la prochaine zone visible ; l'application doit reprendre seule en 60 s max |
| Application complètement figée | Sortir de l'application (bouton home), revenir dedans ; si toujours figée, redémarrage complet du téléphone et reprise depuis l'écran d'accueil (les données du parcours seront conservées) |
| Téléphone de prêt rendu en cours de balade | **Ne pas** re-armer immédiatement ; vérifier d'abord que le visiteur précédent est bien parti (P4 GIVORS — cas `oupu`). Confirmer la pop-up de re-armement uniquement après. |
| iPhone affiche un avertissement orange à l'onboarding | Lui demander de mettre iOS à jour, ou lui proposer un téléphone de prêt. Il peut tout de même passer outre si nécessaire. |

### 5.6 Après la sortie

1. **Rendre les téléphones de prêt à la tente** ; rester en route télémétrie connectée tant que tous les retours ne sont pas faits (les sessions restent ouvertes sinon).
2. **Remettre les téléphones en charge.**
3. **Envoyer la fiche d'observation papier** au technicien.
4. Le lendemain, l'analyse télémétrie automatique (`analyze.mjs`) produira un rapport similaire à celui de GIVORS, avec en particulier :
   - distribution `accuracy_near_border` → calibrage du filtrage de zone
   - distribution `real_callback_freshness` → calibrage de l'alarme « GPS gelé »
   - répartition `audio_load_duration` → identification des téléphones lents
   - éventuelles coupures Android Doze ≥ 5 min → décision d'activer Fused Location Provider

---

## 6. Annexe — où trouver l'information

- **Code applicatif** : `/home/mgr/Bakery/Flanerie/FlanerieAudioMap/`
- **Application Cordova** (build APK / iOS) : `/home/mgr/Bakery/Flanerie/FlanerieCordova/`
- **Plugins natifs** : `cordova-plugin-audiofocus`, `cordova-plugin-power-optimization`, `cordova-background-geolocation-plugin` (hébergés sur GitHub, forkés Flânerie)
- **Rapport GIVORS détaillé** : `20260520-GIVORS-report.md`
- **Plan technique global** : `mobile-audit.md`
- **Télémétrie serveur** : `flanerie.bloffique-theatre.com/telemetry/` (sessions JSON par jour)
