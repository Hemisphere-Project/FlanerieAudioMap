# Flânerie — Week-end public des 19 et 20 juin : compte-rendu pour l'équipe

*Un résumé simple de ce qui s'est passé pendant les deux journées, et de comment le lire dans l'interface télémétrie (la carte avec les traces et les zones d'étapes). Pas de technique — juste de quoi comprendre ce que vous avez vécu.*

---

## En un mot : deux très bonnes journées

Sur les deux jours, **environ 120 personnes sont parties marcher, et une centaine ont fait le parcours complet** (jusqu'à l'étape 20). Le reste, ce sont surtout des gens qui se sont arrêtés en route par choix, le téléphone de Baptiste qui surveille, ou des marches bien terminées mais dont la trace GPS n'est pas remontée (voir plus bas).

**Une seule vraie panne technique sur tout le week-end**, et **un seul cas** où un marcheur a raté un bout de narration. Aucun téléphone « tué » par la batterie, aucun problème de son généralisé. L'appli a tenu la charge d'un vrai public.

| | Vendredi 19 | Samedi 20 |
|---|---|---|
| Personnes parties marcher | ~76 | ~48 |
| Parcours menés jusqu'au bout | 66 | 34 |
| Vraie panne technique | 1 (le Samsung A54) | 0 |
| Son de narration raté | 0 | 1 (un iPhone + casque Bluetooth) |

---

## Comment lire l'interface télémétrie (ce que vous voyez ≠ ce qui s'est passé)

C'est le point le plus important, parce que **plusieurs choses ont l'air d'un problème sur l'écran alors que la marche s'est très bien passée.**

### 🟢 « Un parcours sans trace, avec des étapes grises »
**Ce n'est pas une marche ratée.** La personne a bien marché tout le parcours et a tout entendu. Ce sont surtout les **téléphones prêtés** (sans carte SIM / sans données mobiles) : le téléphone guide la marche parfaitement, mais **il n'arrive pas à envoyer sa trace GPS au serveur** en direct, alors la carte reste vide et les zones restent grises. La marche est réelle, c'est juste la trace qui manque à l'écran.

👉 **Réflexe à avoir :** ne jugez pas « est-ce qu'il a marché ? » sur la trace de la carte. Une carte grise ≠ un problème. On sait qu'ils ont marché parce que les étapes se sont bien déclenchées les unes après les autres, à l'heure.

### 🟢 « La marche a l'air figée un long moment, puis rattrape d'un coup »
**Même explication.** Ce n'est pas un vrai gel du téléphone — c'est juste un **trou dans l'enregistrement** de la trace (souvent les vieux téléphones prêtés, type Xiaomi Redmi). Le son et le déclenchement des étapes ont continué normalement pendant ce temps. Le marcheur n'a entendu aucun silence.

### 🟢 « Beaucoup de courtes marches sur le HTC U11 »
C'est **le téléphone de Baptiste** qui se déplace sur le parcours pour vérifier que tout va bien. Ces sessions courtes et incomplètes sont **normales**, ce ne sont pas des visiteurs bloqués.

### 🟢 « Des parcours très courts, arrêtés au milieu »
Ce sont généralement des **gens qui ont choisi de s'arrêter** (fatigue, temps, envie). Sur un événement public gratuit, c'est normal et attendu. Le GPS et le son de ces marches étaient bons jusqu'au moment de l'arrêt.

### 🟢 « Des petits sons manquants / des messages "afterplay" »
Ce sont les **sons d'ambiance de remplissage pas encore produits** — c'est prévu, sans impact pour le marcheur.

---

## Les vrais soucis (peu nombreux)

### 🔴 1 personne réellement bloquée — un Samsung Galaxy A54 (vendredi)
Ce téléphone **redémarrait tout seul en boucle dès le début** du parcours : il n'a jamais réussi à démarrer la marche. C'est un problème du téléphone lui-même (un modèle Android connu pour couper agressivement les applis), pas de notre appli. **C'est le seul visiteur qui n'a pas eu l'expérience** sur les deux jours. On surveille ce modèle.

### 🟠 1 personne a raté **un seul bout** de narration — un iPhone avec un casque Bluetooth (samedi)
En cours de route, le **casque Bluetooth** de la personne a basculé en mode « téléphone/mains-libres » (comme quand on prend un appel). Ce basculement a coupé la narration d'une étape ; l'appli a essayé de la relancer mais n'y est pas arrivée à temps, donc **le marcheur a entendu l'ambiance à la place de la voix de cette étape**, puis la marche a repris normalement jusqu'au bout. Gênant mais pas grave : une étape sur vingt, et la marche s'est terminée. **C'est le point qu'on va corriger en priorité** côté appli (mieux gérer les casques Bluetooth).

### 🟠 1 iPhone bloqué à l'installation — permission « Motion & Fitness » refusée (vendredi)
Sur cet iPhone, l'autorisation « Motion & Fitness » (les mouvements) avait été **refusée dans les réglages**, et une fois refusée, iOS ne la redemande plus. L'appli est restée coincée à l'accueil sans message clair expliquant quoi faire. **Récupéré sur le moment en donnant un téléphone prêté.** On va ajouter un message clair du type « allez dans Réglages pour réactiver Motion & Fitness » pour ces cas-là.

---

## À savoir : deux versions de l'appli vendredi

Vendredi, une **nouvelle version de l'appli a été déployée en cours de journée (vers 17h)**. C'était **voulu et nécessaire.** Concrètement : les marches commencées avant 17h tournaient sur l'ancienne version, celles d'après sur la nouvelle. Samedi, tout le monde était sur la nouvelle. Aucun impact pour les marcheurs — c'est juste bon à savoir si on compare des marches d'avant et d'après 17h vendredi. On essaiera d'éviter les déploiements en plein événement à l'avenir.

---

## Ce qu'on retient / ce qu'on améliore

**Ce qui a très bien marché :**
- La continuité GPS et le son en poche/écran verrouillé ont tenu, sur des dizaines de modèles Android et iPhone.
- Aucun téléphone coupé par les économies de batterie, aucun souci de son généralisé.
- L'onboarding (les autorisations au démarrage) a bien fonctionné.

**Les 3 améliorations côté appli qui ressortent :**
1. **Casques Bluetooth** — éviter qu'un changement de mode du casque ne coupe la narration (le cas iPhone de samedi). *Priorité.*
2. **Téléphones prêtés sans données** — faire remonter quand même leur trace GPS, pour ne plus voir de cartes grises alors que la marche a bien eu lieu.
3. **iPhone / Motion refusé** — afficher un message clair pour renvoyer la personne vers les Réglages.

Rien de tout ça ne remet en cause le week-end, qui a été un vrai succès à l'échelle du public.

---

*Questions ou un cas précis que vous avez vu à l'écran et que vous voulez comprendre ? On peut le regarder ensemble.*
