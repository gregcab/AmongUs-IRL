# Among Us IRL

Arbitre numérique pour jouer à Among Us en vrai, dans une maison ou un jardin. Chaque joueur utilise son smartphone comme terminal, directement dans le navigateur, sans rien installer. Le serveur tourne sur un mini-PC ou un Raspberry Pi, sur un Wi-Fi local sans accès à internet.

- **Joueurs** : `/` sur le téléphone (lobby, rôle secret, « Je suis mort », corps en QR code, réunions, vote).
- **Écran partagé** : `/tv` sur une TV ou un vidéoprojecteur.
- **Maître du jeu** : `/admin` sur un ordinateur ou une tablette, protégé par un code. Le MJ voit tous les rôles et ne joue pas.

La référence complète des règles et du fonctionnement est dans [SPEC.md](SPEC.md).

## Aperçu

### Sur le téléphone

| Rejoindre | Lobby et consignes | Rôle secret (maintenir) |
|:-:|:-:|:-:|
| <img src="docs/screenshots/phone-join.png" width="240"> | <img src="docs/screenshots/phone-lobby.png" width="240"> | <img src="docs/screenshots/phone-role-impostor.png" width="240"> |

| En jeu | Mort : le téléphone devient le corps | Corps signalé |
|:-:|:-:|:-:|
| <img src="docs/screenshots/phone-playing.png" width="240"> | <img src="docs/screenshots/phone-body.png" width="240"> | <img src="docs/screenshots/phone-alarm.png" width="240"> |

| Rassemblement | Vote | Résultat |
|:-:|:-:|:-:|
| <img src="docs/screenshots/phone-gathering.png" width="240"> | <img src="docs/screenshots/phone-vote.png" width="240"> | <img src="docs/screenshots/phone-result.png" width="240"> |

<p align="center"><img src="docs/screenshots/phone-victory.png" width="240"></p>

### Sur la TV

| Lobby | Révélation des rôles |
|:-:|:-:|
| <img src="docs/screenshots/tv-lobby.png" width="420"> | <img src="docs/screenshots/tv-reveal.png" width="420"> |

| Alarme | Discussion |
|:-:|:-:|
| <img src="docs/screenshots/tv-alarm.png" width="420"> | <img src="docs/screenshots/tv-discussion.png" width="420"> |

| Vote | Éjection |
|:-:|:-:|
| <img src="docs/screenshots/tv-vote.png" width="420"> | <img src="docs/screenshots/tv-result.png" width="420"> |

<p align="center"><img src="docs/screenshots/tv-victory.png" width="640"></p>

### Console du maître du jeu

<p align="center"><img src="docs/screenshots/admin.png" width="760"></p>

## Préparer la soirée

### Matériel

- Un Raspberry Pi 5 ou un mini-PC avec Docker, branché sur le routeur Wi-Fi de la soirée.
- Un routeur Wi-Fi local. Internet n'est pas nécessaire pendant la partie.
- Une TV ou un vidéoprojecteur relié à un navigateur (ordinateur, clé HDMI…).
- Une imprimante pour le QR code de la station d'urgence.
- Un téléphone chargé par joueur, avec un navigateur récent.

### Installation (à faire chez soi, avec internet)

La première construction de l'image télécharge Node.js et les dépendances.

1. Récupérez le dépôt sur le Pi.
2. Copiez le fichier d'environnement :

   ```bash
   cp .env.example .env
   ```

3. Éditez `.env` :
   - `PUBLIC_URL` : l'adresse du Pi sur le Wi-Fi de la soirée, par exemple `http://192.168.1.10:8080`. Tous les QR codes pointent vers cette adresse : réservez une IP fixe au Pi dans le routeur.
   - `ADMIN_PIN` : le code de la console MJ.
4. Construisez et démarrez :

   ```bash
   docker compose up -d --build
   ```

5. Vérifiez que le serveur répond :

   ```bash
   curl http://localhost:8080/api/health
   ```

La partie est enregistrée dans `./data` (SQLite). Si le Pi redémarre, la partie reprend où elle en était, et les joueurs sont reconnectés automatiquement.

### Le jour J

1. Ouvrez `/tv` sur l'écran partagé et cliquez une fois pour activer le son.
2. Ouvrez `/admin` et entrez le code. Réglez les paramètres (durées, nombre d'imposteurs, mode des fantômes…).
3. Cliquez sur **QR d'urgence (imprimer)** et imprimez la page. Collez-la à l'endroit de la station d'urgence. Elle n'est valable que pour la partie en cours : réimprimez-la après chaque « Rejouer ».
4. Les joueurs scannent le QR code de la TV, choisissent un pseudo et une couleur, puis touchent **Je suis prêt**. Ce bouton active le son, teste la vibration et garde l'écran allumé.
5. Lancez la partie depuis la console.

### Rappel des règles physiques

- **Tuer** : l'imposteur pose deux doigts sur l'épaule de la victime en chuchotant « tu es mort ». Il ne touche jamais son téléphone à ce moment-là.
- **Mourir** : la victime maintient **Je suis mort** 1,5 s. Après un court délai, son téléphone affiche un QR code : c'est son corps. Elle reste sur place, écran visible, sans parler.
- **Signaler** : un joueur vivant scanne le corps avec l'**appareil photo** de son téléphone. Il faut ouvrir le lien dans le navigateur qui a servi à rejoindre la partie. Si l'appareil photo ouvre un autre navigateur, le joueur touche **Code d'un corps** dans le jeu et tape les 4 chiffres affichés sous le QR du corps (le code change avec le QR ; 5 erreurs bloquent 30 s).
- **Réunion d'urgence** : scanner le QR code imprimé de la station.
- **Fantômes** : ils ne parlent jamais aux vivants.

### Conseils

- Luminosité au maximum et verrouillage automatique désactivé sur tous les téléphones.
- Rejoignez la partie avec le navigateur par défaut du téléphone (Safari sur iPhone) : c'est lui qu'ouvre l'appareil photo. N'ajoutez pas le jeu à l'écran d'accueil, la session n'y serait pas partagée.
- Sur iPhone, la vibration n'existe pas dans le navigateur : l'écran affiche toujours un signal visuel.
- Si un téléphone s'éteint ou se recharge, il suffit de rouvrir la page : la session est conservée. Un bandeau demande de toucher l'écran pour réactiver le son et l'écran allumé.
- En cas de problème, le MJ peut tout rattraper depuis la console : signaler un corps à la place d'un joueur, tuer ou réanimer, passer à la phase suivante, terminer la partie ou l'annuler pour revenir au lobby.
- Les joueurs hors ligne sont signalés sur la TV et dans les listes : un téléphone éteint bloque le rassemblement jusqu'au délai maximum, le MJ peut passer à la suite.

## Développement

Prérequis : Node.js 22 ou plus récent, et pnpm (`corepack enable pnpm`).

```bash
pnpm install
pnpm dev          # serveur (port 8080) + Vite (port 5173) avec rechargement à chaud
pnpm test         # tests Vitest (moteur, jetons, intégration réseau, redémarrage)
pnpm typecheck
pnpm build        # build de production (web + serveur)
pnpm start        # lance le build de production
```

Tester sans téléphones :

```bash
pnpm simulate --players 8              # des bots jouent une partie complète
pnpm simulate --players 4 --passive    # des bots attendent ; vous pilotez depuis /admin
```

- Ajoutez `?dev=1` à l'URL joueur pour ouvrir plusieurs joueurs dans les onglets d'un même navigateur.
- `TIME_SCALE=0.2` accélère toutes les durées (développement uniquement).
- `pnpm screenshots` régénère les captures de ce README. Il faut d'abord lancer `pnpm build`, et Google Chrome doit être installé.

La CI GitHub (`.github/workflows/ci.yml`) vérifie les types, les tests, le build, et construit l'image Docker pour amd64 et arm64 (Raspberry Pi).

L'architecture (moteur de jeu pur, minuteurs dérivés de l'état, vues filtrées par client) est décrite dans [CLAUDE.md](CLAUDE.md).

### Variables d'environnement

| Variable | Rôle | Défaut |
|---|---|---|
| `PORT` | Port HTTP | `8080` |
| `PUBLIC_URL` | URL encodée dans les QR codes | obligatoire en production |
| `ADMIN_PIN` | Code de la console MJ | obligatoire en production (`1234` en dev) |
| `HMAC_SECRET` | Secret de signature des QR codes | généré dans `DATA_DIR` |
| `DATA_DIR` | Répertoire de la base SQLite | `/app/data` (Docker), `./data` (dev) |
| `TIME_SCALE` | Accélérateur de durées, dev uniquement | `1` |
