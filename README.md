# Bot de Surveillance de Portefeuille Solana pour Telegram

Ce bot Telegram surveille les transactions des portefeuilles Solana en temps réel en utilisant l'API Helius et des webhooks. Il permet aux utilisateurs d'ajouter des adresses de portefeuilles à surveiller et de recevoir des notifications instantanées pour chaque transaction.

## Fonctionnalités

- 🔍 **Surveillance en temps réel** : Notifications instantanées pour toutes les transactions
- 💰 **Détails complets** : Informations sur les transferts SOL et tokens
- 🔗 **Liens explorer** : Accès direct vers Solscan pour plus de détails
- 📱 **Interface Telegram** : Commandes simples et interface conviviale
- 🔐 **Stockage sécurisé** : Utilise Cloudflare KV pour stocker les données utilisateur
- ⚡ **Performance** : Hébergé sur Cloudflare Workers pour une réponse rapide

## Commandes disponibles

- `/start` ou `/help` - Afficher le message d'aide
- `/addwallet <address>` - Ajouter une adresse de portefeuille à surveiller
- `/removewallet <address>` - Supprimer une adresse de portefeuille
- `/mywallets` - Lister tous les portefeuilles surveillés

## Configuration

### 1. Prérequis

- Compte Cloudflare avec accès aux Workers
- Token de bot Telegram (via @BotFather)
- Clé API Helius (inscription gratuite sur helius.xyz)
- CLI Wrangler installé (`npm install -g wrangler`)

### 2. Configuration des variables d'environnement

Configurez les secrets suivants avec Wrangler :

```bash
# Token du bot Telegram
wrangler secret put TELEGRAM_BOT_TOKEN

# Clé API Helius
wrangler secret put HELIUS_API_KEY

# Domaine de votre worker (ex: mon-bot.mon-compte.workers.dev)
wrangler secret put WORKER_DOMAIN
```

### 3. Configuration du stockage KV

Créez les espaces de noms KV nécessaires :

```bash
# Pour le développement
wrangler kv:namespace create "WALLET_STORAGE"

# Pour la production
wrangler kv:namespace create "WALLET_STORAGE" --env production
```

Mettez à jour les IDs dans `wrangler.toml` avec les valeurs retournées.

### 4. Déploiement

```bash
# Déploiement en développement
wrangler deploy

# Déploiement en production
wrangler deploy --env production
```

### 5. Configuration du webhook Telegram

Après le déploiement, configurez le webhook Telegram :

```bash
curl "https://votre-worker-domain.workers.dev/setwebhook"
```

## Structure du projet

```
telegram-bot/
├── worker.js          # Code principal du bot
├── wrangler.toml      # Configuration Cloudflare Workers
├── package.json       # Configuration npm
└── README.md          # Cette documentation
```

## Utilisation

1. **Démarrer une conversation** avec votre bot sur Telegram
2. **Utiliser `/start`** pour voir les commandes disponibles
3. **Ajouter un portefeuille** : `/addwallet 9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM`
4. **Recevoir des notifications** automatiques pour chaque transaction

## Format des notifications

Les notifications incluent :

- ✅/❌ **Statut** de la transaction (succès/échec)
- 🔗 **Signature** de la transaction
- ⏰ **Horodatage** et numéro de slot
- 💰 **Transferts SOL** avec montants et adresses
- 🪙 **Transferts de tokens** avec détails des mints
- 💸 **Frais** de transaction
- 🔍 **Lien Solscan** pour explorer la transaction

## Limitations

- Maximum 10 portefeuilles par utilisateur
- Les webhooks Helius ont des limites de taux selon votre plan
- Le stockage KV de Cloudflare a des limites selon votre plan

## Architecture technique

### Composants principaux

1. **Cloudflare Worker** : Héberge la logique du bot
2. **Helius API** : Fournit les webhooks pour les transactions Solana
3. **Telegram Bot API** : Interface utilisateur
4. **Cloudflare KV** : Stockage des données utilisateur

### Flux de données

1. L'utilisateur ajoute un portefeuille via Telegram
2. Le bot crée un webhook Helius pour ce portefeuille
3. Helius envoie les notifications de transaction au worker
4. Le worker formate et envoie la notification à l'utilisateur Telegram

## Sécurité

- Les tokens et clés API sont stockés comme secrets Cloudflare
- Validation des adresses Solana avant création de webhook
- Limitation du nombre de portefeuilles par utilisateur
- Gestion d'erreur robuste pour éviter les fuites d'information

## Dépannage

### Le bot ne répond pas
- Vérifiez que le webhook Telegram est configuré
- Consultez les logs Cloudflare Workers

### Les notifications ne fonctionnent pas
- Vérifiez la clé API Helius
- Assurez-vous que le domaine WORKER_DOMAIN est correct
- Consultez les logs des webhooks Helius

### Erreurs de stockage
- Vérifiez la configuration des espaces de noms KV
- Assurez-vous que les IDs dans wrangler.toml sont corrects

## Développement

Pour développer localement :

```bash
# Installer les dépendances
npm install

# Développement local
wrangler dev

# Tester les webhooks localement
wrangler dev --local-protocol https
```

## Contribution

Les contributions sont les bienvenues ! Veuillez :

1. Fork le projet
2. Créer une branche pour votre fonctionnalité
3. Committer vos changements
4. Pousser vers la branche
5. Ouvrir une Pull Request

## Licence

Ce projet est sous licence MIT. Voir le fichier LICENSE pour plus de détails.

## Support

Pour obtenir de l'aide :
- Ouvrir une issue sur GitHub
- Consulter la documentation Helius : https://docs.helius.xyz
- Consulter la documentation Cloudflare Workers : https://developers.cloudflare.com/workers
