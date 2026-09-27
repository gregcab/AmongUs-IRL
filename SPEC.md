# Among Us IRL : spécification du MVP

Ce document est la référence d'implémentation du MVP. Il reprend les décisions du dossier de conception (version 0.5 du 27/09/2026). Le code, les identifiants et les noms d'événements sont en anglais ; les textes affichés aux joueurs sont en français.

## 1. Contexte

Application web locale, lancée avec Docker sur un mini-PC ou un Raspberry Pi 5, qui arbitre une partie d'Among Us jouée en vrai. Chaque joueur utilise son smartphone comme terminal, via le navigateur, sans installation. Le réseau est un Wi-Fi local sans accès internet.

Trois vues :

- **Joueur** (`/`) : smartphone, portrait.
- **Écran partagé** (`/tv`) : TV ou vidéoprojecteur, paysage, sans interaction.
- **Console du maître du jeu** (`/admin`) : ordinateur ou tablette, protégée par un code.

Le maître du jeu (MJ) **ne joue pas** : il voit tous les rôles et arbitre.

## 2. Périmètre

### Dans le MVP

- Lobby, choix du pseudo et de la couleur, état « prêt », lancement, révélation des rôles.
- Kill par contact physique avec déclaration de la victime.
- Téléphone de la victime affichant un QR code tournant (le « corps »), signalement par scan.
- Réunion d'urgence par scan d'un QR code imprimé.
- Réunion complète : rassemblement, discussion, vote, résultat, reprise.
- Fantômes, avec deux modes paramétrables en réunion.
- Conditions de victoire hors tâches.
- Console MJ et écran partagé.
- Persistance et reprise après redémarrage du serveur.

### Hors MVP

- **Tâches** (conception reportée). Prévoir les points d'extension (voir §15) mais ne rien implémenter.
- Sabotages, mini-jeux, tâches visuelles.
- Matériel ESP32 / MQTT.
- Désignation du tueur par la victime.
- Pause de partie, statistiques multi-parties.

## 3. Glossaire

| Terme | Définition |
|---|---|
| Équipier (`crew`) | Joueur non imposteur |
| Imposteur (`impostor`) | Joueur qui tue par contact physique |
| Corps (`BODY`) | Joueur mort dont le téléphone affiche le QR code de son corps |
| Fantôme (`GHOST`) | Joueur mort après passage d'une réunion, ou éjecté |
| Station d'urgence | QR code imprimé qui déclenche une réunion d'urgence |
| Point de rassemblement | Lieu physique des réunions |
| Cimetière | Lieu physique où attendent les fantômes pendant les réunions (mode `cemetery`) |

## 4. Stack et architecture

Choix retenus pour le MVP :

- **Monorepo** pnpm workspaces, TypeScript strict partout, Node 22.
- **`packages/shared`** : types, paramètres, noms et charges utiles des événements, partagés entre serveur et client.
- **`apps/server`** : Fastify + Socket.IO. Sert aussi le build statique du frontend.
- **`apps/web`** : Vite + React. Une seule application, trois routes (`/`, `/tv`, `/admin`). Pas de framework CSS lourd.
- **Persistance** : SQLite via `better-sqlite3`, fichier dans un volume Docker.
- **QR codes** : bibliothèque `qrcode` côté client pour l'affichage, et côté serveur pour les pages imprimables.
- **Tests** : Vitest.

L'état de jeu vit **en mémoire dans un seul processus serveur**, avec journal d'événements et instantané en SQLite. Pas de Redis au MVP : un seul nœud, aucun besoin de pub/sub. Pas de reverse proxy au MVP : le serveur expose directement le port HTTP.

### Docker

- `Dockerfile` multi-étapes : build du workspace, image finale Node minimale.
- `docker-compose.yml` avec un seul service `app`, un volume `./data:/app/data`, le port `8080`.
- Variables d'environnement :

| Variable | Rôle | Défaut |
|---|---|---|
| `PORT` | Port HTTP | `8080` |
| `PUBLIC_URL` | URL encodée dans tous les QR codes, ex. `http://192.168.1.10:8080` | obligatoire |
| `ADMIN_PIN` | Code d'accès à la console MJ | obligatoire |
| `HMAC_SECRET` | Secret de signature des jetons | généré au premier démarrage et stocké dans `data/` |
| `DATA_DIR` | Répertoire SQLite | `/app/data` |

### Structure du dépôt

```
among-us-irl/
├── docker-compose.yml
├── Dockerfile
├── package.json / pnpm-workspace.yaml
├── packages/shared/src/
│   ├── types.ts          # Game, Player, Meeting, Vote, KillEvent…
│   ├── params.ts         # GameParams + valeurs par défaut + validation
│   └── events.ts         # noms d'événements et charges utiles typées
├── apps/server/src/
│   ├── engine/           # cœur de jeu pur (voir §6)
│   ├── scheduler.ts      # timers → commandes "tick"
│   ├── transport/        # Socket.IO, routes REST, rooms
│   ├── auth.ts           # sessions joueurs, code admin
│   ├── tokens.ts         # HMAC, QR tournants
│   ├── persistence.ts    # SQLite : journal + instantané
│   └── index.ts
└── apps/web/src/
    ├── player/  tv/  admin/
    └── lib/              # socket, session, wakeLock, audio, vibration
```

## 5. États

### Phases de partie

```
LOBBY → ROLE_REVEAL → PLAYING ⇄ MEETING → … → GAME_OVER → (LOBBY via "rejouer")
MEETING = GATHERING → DISCUSSION → VOTING → RESULT
```

| Transition | Condition |
|---|---|
| `LOBBY → ROLE_REVEAL` | `admin:start` accepté (voir §7.1) |
| `ROLE_REVEAL → PLAYING` | fin de `roleRevealSeconds` |
| `PLAYING → MEETING/GATHERING` | signalement de corps, réunion d'urgence ou `admin:callMeeting` |
| `GATHERING → DISCUSSION` | tous les vivants arrivés, ou `gatheringTimeoutSeconds` écoulé, ou `admin:advancePhase` |
| `DISCUSSION → VOTING` | fin de `discussionSeconds` ou `admin:advancePhase` |
| `VOTING → RESULT` | tous les vivants ont voté, ou fin de `votingSeconds`, ou `admin:advancePhase` |
| `RESULT → PLAYING` | fin de `resumeCountdownSeconds`, si aucune victoire |
| `RESULT → GAME_OVER` | condition de victoire remplie |
| `PLAYING → GAME_OVER` | condition de victoire remplie, ou `admin:endGame` |
| `GAME_OVER → LOBBY` | `admin:backToLobby` |

Toute commande reçue hors de sa phase est refusée avec une erreur typée, sans effet.

### Statuts de joueur

```
ALIVE → DYING → BODY → GHOST
ALIVE → GHOST            (éjection)
```

| Statut | Signification |
|---|---|
| `ALIVE` | Vivant |
| `DYING` | A déclaré sa mort, compte à rebours en cours ; se comporte comme vivant pour tous les autres |
| `BODY` | Mort effective ; son téléphone affiche le QR code du corps |
| `GHOST` | Fantôme : ne vote pas, ne signale pas, n'appelle pas de réunion |

## 6. Moteur de jeu

Le cœur est une **fonction pure et déterministe**, testable sans réseau ni horloge :

```ts
reduce(state: GameState, command: Command, now: number, rng: Rng)
  → { state: GameState; events: OutboundEvent[]; timers: TimerRequest[] }
```

- `command` vient d'un client (`player:*`, `admin:*`) ou du scheduler (`tick:*`).
- `events` indique pour chaque événement son destinataire : un joueur, un groupe (imposteurs, fantômes, vivants), la TV, l'admin ou tous.
- `timers` demande au scheduler de rappeler le moteur à une échéance donnée (`tick:deathEffective`, `tick:phaseEnd`, `tick:killReady`…). Chaque timer porte un identifiant pour pouvoir être annulé ou ignoré s'il est devenu obsolète.
- `rng` est injecté pour rendre le tirage des rôles reproductible en test ; en production, générateur cryptographique (`crypto.randomInt`).

Chaque commande acceptée est ajoutée au journal SQLite, et l'état complet est sauvegardé en instantané JSON. Au redémarrage, le serveur recharge le dernier instantané et replanifie les timers à partir des échéances stockées dans l'état.

## 7. Fonctionnalités

### 7.1 Lobby

1. Le MJ ouvre `/admin`, saisit le code, configure les paramètres (§10). La partie est en `LOBBY`.
2. `/tv` affiche un grand QR code vers `PUBLIC_URL/`, la liste des joueurs (pseudo, couleur, coche « prêt »).
3. Le joueur ouvre `/`, saisit un pseudo (1 à 16 caractères, unique, sans tenir compte de la casse) et choisit une couleur libre parmi une palette de 15 couleurs nettement distinctes. Les couleurs prises sont grisées. Il peut changer de couleur tant qu'il est en lobby.
4. Le serveur crée une session et renvoie un jeton, stocké en `localStorage` et en cookie. À chaque connexion, le client présente son jeton et reçoit l'état complet qui le concerne.
5. Bouton **« Je suis prêt »** : débloque l'audio (lecture d'un son court), teste la vibration quand elle existe, active le maintien de l'écran allumé (§12), affiche les consignes (luminosité au maximum, ne pas verrouiller, les fantômes ne parlent jamais aux vivants). Le joueur passe `ready`.
6. Le MJ peut exclure ou renommer un joueur.
7. `admin:start` est accepté si : phase `LOBBY`, au moins `minPlayers` joueurs, et `impostorCount` valide. Les joueurs non prêts bloquent le lancement sauf si le MJ force (`{ force: true }`).
8. Nombre d'imposteurs : si `impostorCount = "auto"`, 1 pour 4 à 6 joueurs, 2 pour 7 à 9, 3 au-delà. Refuser toute configuration où `impostors * 2 >= joueurs`.
9. Aucune arrivée après le lancement ; seules les reconnexions de sessions existantes sont acceptées.

### 7.2 Révélation des rôles

- Tirage côté serveur. Chaque joueur reçoit **uniquement** son rôle, et les imposteurs la liste de leurs complices (pseudo et couleur).
- Écran **« Maintenir pour révéler »** : le rôle s'affiche tant que le doigt reste appuyé (pointer events, gérer l'annulation) et se masque au relâchement. Le joueur peut le revoir à tout moment pendant la partie par le même geste.
- `/tv` affiche un compte à rebours de `roleRevealSeconds`.
- Au passage en `PLAYING` : démarrer le cooldown de kill d'équipe (`killCooldownSeconds`) et le cooldown d'urgence (`emergencyCooldownSeconds`).

### 7.3 Écran de jeu du joueur

- **Identique pour équipiers et imposteurs** : même mise en page, mêmes éléments, mêmes temps de réponse. Aucun bouton « Tuer ».
- Un petit indicateur d'état est présent pour tous. Pour un imposteur, il signale discrètement la disponibilité du kill (§7.4) ; pour un équipier, il reste neutre. Son apparence ne doit pas permettre de distinguer les deux rôles de loin.
- Bouton **« Je suis mort »**, par appui maintenu de 1,5 seconde avec jauge de progression, pour éviter les déclenchements accidentels.
- Rappel du rôle par appui maintenu.

### 7.4 Kill

Règles physiques (affichées dans les consignes) : l'imposteur touche la victime (deux doigts sur l'épaule) en chuchotant « tu es mort ». L'imposteur ne touche jamais son téléphone.

1. La victime maintient « Je suis mort ». Commande `player:declareDeath {}`.
2. Refusée si la phase n'est pas `PLAYING` ou si le joueur n'est pas `ALIVE`.
3. **Irréversible** : le joueur passe `DYING`, `effectiveAt = now + deathDelaySeconds`. Son écran affiche un compte à rebours discret ; il continue à jouer normalement pendant ce temps.
4. À l'échéance : statut `BODY`, écran du corps (§7.5), démarrage du **cooldown de kill d'équipe**, évaluation des victoires.
5. Le cooldown est commun à tous les imposteurs vivants : `kill:cooldownStarted { endsAt }` puis, à l'échéance, `kill:ready`. Un nouveau décès pendant un cooldown en cours le redémarre à zéro.
6. `kill:ready` déclenche chez les imposteurs une double vibration courte (si disponible) et le changement de l'indicateur discret. **Aucun son.**
7. Aucun événement n'est envoyé aux autres joueurs. La TV n'affiche rien.
8. Le MJ reçoit `admin:deathLogged`.

Il n'existe pas de désignation du tueur. Le cooldown ne peut donc pas être individuel.

### 7.5 Le téléphone comme corps

- En statut `BODY`, le téléphone affiche un **QR code plein écran**, noir sur blanc quel que soit le thème, dans un cadre épais de la couleur du joueur, avec son pseudo.
- Le QR encode `PUBLIC_URL/r/<token>`. Le jeton est renouvelé toutes les `bodyQrRotationSeconds` : le serveur pousse `body:qr { token, expiresAt }` au téléphone du corps.
- Jeton : `base64url(gameId | playerId | slot) + "." + HMAC`, avec `slot = floor(now / rotation)`. Le serveur accepte le slot courant et le précédent.
- Maintien de l'écran allumé obligatoire (§12).
- Au déclenchement de toute réunion, tous les `BODY` passent `GHOST` et le téléphone quitte l'écran QR.

### 7.6 Signalement de corps

- Le joueur vivant scanne l'écran du corps avec l'**appareil photo natif** de son téléphone. Son navigateur ouvre `/r/<token>`.
- Cette page récupère la session locale et appelle `POST /api/report { token }`. Sans session sur ce navigateur, afficher : « Ouvrez ce lien dans le navigateur avec lequel vous avez rejoint la partie », avec un bouton pour copier le lien.
- Accepté si : phase `PLAYING`, signaleur `ALIVE` ou `DYING`, jeton valide et récent, joueur ciblé en `BODY`.
- Effet : réunion de type `body` avec `reporterId` et `bodyOfId`.
- Le MJ peut signaler à la place d'un joueur (`admin:callMeeting { bodyOfId }`) si le téléphone d'un corps est en panne.

### 7.7 Réunion d'urgence

- QR code **statique** imprimé, encodant `PUBLIC_URL/e/<stationToken>` (jeton signé, lié à la partie en cours et régénéré à chaque nouvelle partie). La console MJ propose une page imprimable.
- Accepté si : phase `PLAYING`, joueur `ALIVE` ou `DYING`, quota `emergencyMeetingsPerPlayer` non épuisé, cooldown d'urgence écoulé.
- Refus : message clair sur le téléphone du joueur (« Plus de réunion d'urgence disponible », « Bouton disponible dans 12 s »).

### 7.8 Déclenchement d'une réunion

Dans l'ordre, de façon atomique :

1. Tous les joueurs `DYING` passent immédiatement en mort effective (`BODY`, sans attendre leur compte à rebours).
2. Tous les `BODY` passent `GHOST`.
3. Le cooldown de kill est gelé (temps restant conservé, sans importance puisqu'il sera réinitialisé à la reprise).
4. Événement `meeting:called { type, reporterId, bodyOfId?, ghostMode }` à tous, fantômes compris.
5. Alarme : son fort et vibration longue sur tous les téléphones, animation sur la TV (« Corps signalé par X : Y » ou « Réunion d'urgence appelée par X »).
6. Évaluation des victoires (les morts effectives de l'étape 1 peuvent donner la victoire aux imposteurs, auquel cas on passe directement en `GAME_OVER`).
7. Phase `GATHERING`.

Pendant toute la phase `MEETING`, `player:declareDeath` est refusé (bouton désactivé).

### 7.9 Rassemblement (`GATHERING`)

- Vivants : écran « Rendez-vous au point de rassemblement » et bouton **« Je suis arrivé »** (`player:arrived {}`).
- Fantômes : selon `ghostMeetingMode` (§7.13).
- TV : liste des vivants avec coche des arrivés.
- Passage en `DISCUSSION` quand tous les vivants sont arrivés, ou à `gatheringTimeoutSeconds`, ou sur `admin:advancePhase`.

### 7.10 Discussion (`DISCUSSION`)

- TV : minuteur, motif de la réunion, liste de tous les joueurs avec les morts barrés, **y compris les morts dont le corps n'a pas été signalé**.
- Téléphones des vivants : même liste, minuteur.

### 7.11 Vote (`VOTING`)

- Vivants : liste des joueurs vivants et option « Passer ». Un seul vote, **définitif** (confirmation avant envoi). `player:vote { targetId | "skip" }`.
- Refusé si le votant n'est pas vivant, a déjà voté, ou si la cible n'est pas vivante.
- TV : minuteur et coche « a voté » à côté de chaque votant, sans la cible (`meeting:voteCast { voterId }`).
- Fin anticipée quand tous les vivants ont voté.
- Absence de vote à l'échéance : compté comme aucun vote (ni pour un joueur, ni « passer »).

### 7.12 Résultat (`RESULT`)

- Majorité relative. Égalité en tête, ou « passer » en tête : personne n'est éjecté.
- L'éjecté passe directement `GHOST`.
- `meeting:result { ejectedId | null, role?, tally? }` :
  - `role` présent si `confirmEjects = true` ;
  - `tally` (qui a voté pour qui) présent si `anonymousVotes = false`.
- TV : animation d'éjection, rôle éventuel, détail éventuel des votes.
- Évaluation des victoires. Sinon, compte à rebours `resumeCountdownSeconds` (« Dispersez-vous »), puis `PLAYING` avec :
  - cooldown de kill d'équipe **redémarré à sa valeur complète** ;
  - cooldown d'urgence redémarré.

### 7.13 Fantômes

- Écran fantôme : « Tu es un fantôme », rappel de la règle « tu ne parles jamais aux vivants ». Plus de bouton « Je suis mort ».
- Paramètre `ghostMeetingMode` :
  - `cemetery` (défaut) : à l'alarme, « Rejoignez le cimetière ». L'écran suit ensuite la phase, le minuteur et affiche le résultat, pour que le fantôme sache quand le jeu reprend.
  - `spectator` : à l'alarme, « Rejoignez le point de rassemblement ». Vue spectateur (phase, minuteur, liste). Pas de bouton « Je suis arrivé ».
- Dans les deux modes, les fantômes ne comptent pas dans les arrivées et ne votent pas.
- Réservé aux tâches, hors MVP : les fantômes feront leurs tâches à partir de la réunion qui suit leur mort, et toutes les tâches seront gelées pendant `MEETING` (`freezeTasksDuringMeeting`).

### 7.14 Conditions de victoire

Évaluées après chaque mort effective, chaque déclenchement de réunion et chaque résultat de vote.

- **Imposteurs** : nombre d'imposteurs vivants ≥ nombre d'équipiers vivants. Les joueurs `DYING` comptent encore comme vivants ; seuls `BODY` et `GHOST` comptent comme morts.
- **Équipiers** : plus aucun imposteur vivant.
- **MJ** : `admin:endGame { winner }`.

`GAME_OVER` : la TV et tous les téléphones affichent l'équipe gagnante, la liste des rôles, et la chronologie des morts et des éjections (heure, joueur ; pas de tueur puisqu'il n'est pas connu).

### 7.15 Console MJ (`/admin`)

- Accès par `ADMIN_PIN`, session admin distincte.
- **Lobby** : configuration des paramètres, liste des joueurs (exclure, renommer), lancer (normal ou forcé), page imprimable du QR d'urgence.
- **En jeu** : tableau de tous les joueurs (couleur, pseudo, rôle, statut, échéance de mort), cooldowns en cours, quotas d'urgence, phase et minuteur, journal d'événements en direct.
- **Actions** : `admin:callMeeting { bodyOfId? }`, `admin:advancePhase`, `admin:declareDeath { playerId }` (mort effective immédiate), `admin:revive { playerId }` (retour à `ALIVE`, uniquement depuis `DYING`, `BODY` ou `GHOST` non éjecté), `admin:endGame { winner }`, `admin:backToLobby`.
- Toute action MJ est journalisée comme les autres.

### 7.16 Écran partagé (`/tv`)

| Phase | Affichage |
|---|---|
| `LOBBY` | QR d'accueil, joueurs et état « prêt » |
| `ROLE_REVEAL` | « Découvrez votre rôle », compte à rebours |
| `PLAYING` | Écran calme « Partie en cours » ; aucune information sur les morts |
| `MEETING` | Motif, arrivées, discussion, votes, résultat (voir §7.9 à §7.12) |
| `GAME_OVER` | Vainqueurs, rôles, chronologie |

La TV n'est jamais authentifiée comme joueur et ne reçoit jamais d'information de rôle avant `GAME_OVER` (sauf rôle de l'éjecté si `confirmEjects`).

## 8. Contrat temps réel

### Rooms Socket.IO

`player:<id>` (un joueur), `alive`, `impostors`, `ghosts`, `tv`, `admin`. **Les rôles ne transitent que par `player:<id>`, `impostors` et `admin`.** Les rooms sont recalculées à chaque changement de statut.

### Client → serveur

```
lobby:join          { name, color }
lobby:changeColor   { color }
lobby:ready         {}
player:declareDeath {}
player:arrived      {}
player:vote         { targetId | "skip" }

admin:auth          { pin }
admin:updateParams  { params }
admin:kick          { playerId }
admin:rename        { playerId, name }
admin:start         { force?: boolean }
admin:callMeeting   { bodyOfId? }
admin:advancePhase  {}
admin:declareDeath  { playerId }
admin:revive        { playerId }
admin:endGame       { winner: "crew" | "impostors" }
admin:backToLobby   {}
```

### REST (pages ouvertes par l'appareil photo natif)

```
GET  /r/:token          page de signalement de corps
POST /api/report        { token }          en-tête de session requis
GET  /e/:token          page de réunion d'urgence
POST /api/emergency     { token }          en-tête de session requis
GET  /api/print/emergency                  page imprimable (admin)
```

### Serveur → clients

```
player:session        { token }                              → joueur
state:sync            { vue complète filtrée pour ce client }  → à chaque (re)connexion
lobby:state           { players[{ id, name, color, ready }], params }
game:role             { role, allies[] }                     → joueur
game:phase            { phase, subPhase?, endsAt? }          → tous
death:countdown       { endsAt }                             → victime
death:confirmed       {}                                     → victime
body:qr               { token, expiresAt }                   → corps
kill:cooldownStarted  { endsAt }                             → impostors
kill:ready            {}                                     → impostors
meeting:called        { type, reporterId, bodyOfId?, ghostMode }
meeting:roster        { alive[], dead[], arrived[] }
meeting:voteCast      { voterId }
meeting:result        { ejectedId | null, role?, tally? }
game:over             { winner, roles[], timeline[] }
error                 { code, message }                      → émetteur
admin:*               journal, alertes, état complet         → admin
```

`state:sync` est la source de vérité côté client : chaque vue doit pouvoir se reconstruire entièrement à partir de lui, quel que soit le moment de la reconnexion.

## 9. Modèle de données

```ts
type Role = "crew" | "impostor";
type PlayerStatus = "ALIVE" | "DYING" | "BODY" | "GHOST";
type Phase = "LOBBY" | "ROLE_REVEAL" | "PLAYING" | "MEETING" | "GAME_OVER";
type MeetingSubPhase = "GATHERING" | "DISCUSSION" | "VOTING" | "RESULT";

interface Player {
  id: string; name: string; color: string;
  sessionToken: string; ready: boolean; connected: boolean;
  role?: Role; status: PlayerStatus;
  dyingEffectiveAt?: number;
  emergencyUsed: number;
  ejected: boolean;
}

interface Meeting {
  id: string; type: "body" | "emergency" | "admin";
  reporterId?: string; bodyOfId?: string;
  subPhase: MeetingSubPhase; endsAt?: number;
  arrived: string[]; votes: Record<string, string | "skip">;
  result?: { ejectedId: string | null };
}

interface KillEvent { victimId: string; declaredAt: number; effectiveAt: number; }

interface GameState {
  gameId: string; phase: Phase; params: GameParams;
  players: Record<string, Player>;
  meeting?: Meeting; meetingHistory: Meeting[];
  kills: KillEvent[];
  killCooldownEndsAt?: number; emergencyCooldownEndsAt?: number;
  phaseEndsAt?: number;
  winner?: "crew" | "impostors";
}
```

## 10. Paramètres de partie

| Paramètre | Défaut | Description |
|---|---|---|
| `minPlayers` | 4 | Joueurs minimum pour lancer |
| `impostorCount` | `"auto"` | Nombre d'imposteurs ou calcul automatique |
| `roleRevealSeconds` | 15 | Durée de la révélation des rôles |
| `deathDelaySeconds` | 10 | Délai entre déclaration et mort effective |
| `killCooldownSeconds` | 45 | Cooldown de kill d'équipe |
| `bodyQrRotationSeconds` | 10 | Rotation du QR du corps |
| `emergencyMeetingsPerPlayer` | 1 | Quota de réunions d'urgence |
| `emergencyCooldownSeconds` | 30 | Délai après le lancement et après chaque réunion |
| `gatheringTimeoutSeconds` | 120 | Durée maximale du rassemblement |
| `discussionSeconds` | 90 | Durée de la discussion |
| `votingSeconds` | 60 | Durée du vote |
| `resumeCountdownSeconds` | 10 | Dispersion avant la reprise |
| `ghostMeetingMode` | `"cemetery"` | `"cemetery"` ou `"spectator"` |
| `confirmEjects` | `true` | Révéler le rôle de l'éjecté |
| `anonymousVotes` | `false` | Masquer le détail des votes |
| `freezeTasksDuringMeeting` | `true` | Réservé aux tâches (hors MVP) |

Valider les paramètres côté serveur (bornes raisonnables) et les figer au lancement de la partie.

## 11. Sécurité et anti-triche

- Serveur autoritaire : le client n'est jamais cru sur l'état, seulement sur ses intentions.
- Aucune information de rôle ou de statut d'autrui n'est envoyée à un joueur, hormis la liste des complices pour un imposteur et ce qui est public en réunion.
- Réponses et délais identiques pour équipiers et imposteurs sur toutes les actions communes.
- Jetons QR signés HMAC-SHA256, comparaison en temps constant.
- Aucun son sur le téléphone de la victime au moment du kill ni sur celui de l'imposteur au `kill:ready`.
- Code admin requis pour toute commande `admin:*` ; limiter les tentatives.

## 12. Contraintes des navigateurs mobiles

Le serveur est en **HTTP simple** sur le réseau local : aucune installation de certificat chez les invités. Conséquences à gérer :

- **Maintien de l'écran allumé** : l'API Wake Lock n'est disponible qu'en contexte sécurisé (HTTPS ou localhost). Utiliser Wake Lock quand elle existe, sinon le repli par **vidéo muette en boucle** (technique de NoSleep.js), activé au clic « Je suis prêt ». Réactiver à chaque retour de visibilité de la page. Critique pour l'écran du corps.
- **Vibration** : l'API n'existe pas sur iOS Safari. Toujours doubler une vibration par un signal visuel ; pour `kill:ready`, l'indicateur discret suffit.
- **Audio** : débloqué uniquement après une interaction ; le bouton « Je suis prêt » joue un son court. Précharger le son d'alarme.
- **Pas de `crypto.randomUUID` ni de `crypto.subtle` côté client** (contexte non sécurisé) : identifiants et signatures générés côté serveur.
- **Session** : l'appareil photo natif peut ouvrir un autre navigateur que celui du joueur. Gérer ce cas sur `/r/:token` et `/e/:token` (§7.6).
- **Reconnexion** : reconnexion automatique Socket.IO, `state:sync` complet à chaque reconnexion et à chaque retour au premier plan.
- Interface mobile d'abord, grands boutons, lisible en plein jour, pas de zoom accidentel.

## 13. Mode développement

- Paramètre d'URL `?dev=1` : la session est stockée en `sessionStorage` au lieu de `localStorage`, ce qui permet d'ouvrir plusieurs joueurs dans plusieurs onglets du même navigateur.
- Script `pnpm simulate --players 8` : clients Socket.IO automatisés qui rejoignent, se mettent prêts et exécutent un scénario (kill, signalement, vote) pour tester sans téléphones.
- Accélérateur de temps optionnel en dev (multiplicateur des durées).

## 14. Tests attendus

Tests unitaires Vitest sur le moteur pur, au minimum :

- Lobby : unicité pseudo et couleur, contrôle du lancement, calcul auto des imposteurs.
- Rôles : répartition correcte, aucune fuite de rôle dans les événements destinés aux autres joueurs.
- Kill : refus hors `PLAYING`, irréversibilité, passage `DYING → BODY` à l'échéance, cooldown d'équipe et redémarrage.
- Corps : jeton valide, expiré, falsifié, joueur non `BODY`.
- Réunion : `DYING` finalisés et `BODY → GHOST` au déclenchement, rassemblement, vote (égalité, « passer » en tête, absence de vote, fin anticipée), réinitialisation des cooldowns à la reprise.
- Victoires : après mort effective, après déclenchement de réunion, après éjection.
- Persistance : reconstruction de l'état après redémarrage, timers replanifiés.

## 15. Points d'extension pour les tâches

Ne rien implémenter, mais prévoir :

- une entité `Station` et un préfixe d'URL `/s/:token` réservé ;
- un emplacement dans `state:sync` et dans l'écran joueur pour la liste des tâches ;
- une condition de victoire « tâches » branchable dans l'évaluateur de victoires ;
- le paramètre `freezeTasksDuringMeeting` déjà présent.

## 16. Plan d'implémentation

Procéder par étapes, chacune laissant le projet fonctionnel et testé :

1. **Squelette** : monorepo, `shared`, serveur Fastify qui sert le frontend, Dockerfile, compose, route de santé.
2. **Moteur** : types, paramètres, `reduce`, scheduler, tests unitaires du §14 (hors persistance).
3. **Transport** : Socket.IO, rooms, sessions, auth admin, routes REST QR, `state:sync`.
4. **Persistance** : journal et instantané SQLite, reprise au redémarrage.
5. **Vue joueur** : lobby, prêt, rôle, jeu, mort, corps, fantôme, réunion, fin.
6. **Vue TV**.
7. **Console MJ**, page imprimable du QR d'urgence.
8. **Contraintes mobiles** (§12) et script de simulation.

Après chaque étape : lancer les tests et vérifier le build Docker.
