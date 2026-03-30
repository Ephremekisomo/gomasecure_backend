# 📦 Goma Security - Scripts de Base de Données

## 📋 Résumé

Ce dossier contient tous les scripts nécessaires pour gérer la base de données SQLite de l'application Goma Security.

## 📁 Fichiers Créés

| Fichier | Description | Taille |
|---------|-------------|--------|
| [`init.sql`](./init.sql) | Script SQL complet d'initialisation | ~15 KB |
| [`setup.js`](./setup.js) | Script Node.js pour initialiser la base | ~8 KB |
| [`backup.js`](./backup.js) | Script de sauvegarde de la base | ~6 KB |
| [`restore.js`](./restore.js) | Script de restauration de la base | ~7 KB |
| [`README.md`](./README.md) | Documentation complète | ~5 KB |
| [`QUICKSTART.md`](./QUICKSTART.md) | Guide de démarrage rapide | ~3 KB |
| [`SUMMARY.md`](./SUMMARY.md) | Ce fichier | ~2 KB |

## 🚀 Commandes Disponibles

### Initialisation

```bash
# Initialiser la base de données
npm run db:setup

# Réinitialiser complètement la base
npm run db:reset
```

### Sauvegarde et Restauration

```bash
# Créer une sauvegarde
npm run db:backup

# Restaurer une sauvegarde
npm run db:restore
```

### Serveur

```bash
# Démarrer le serveur
npm start

# Démarrer en mode développement
npm run dev
```

## 📊 Structure de la Base de Données

### Tables Principales

1. **users** - Utilisateurs de l'application
   - Citoyens, agents, administrateurs
   - Informations de profil et localisation
   - Authentification 2FA

2. **emergency_types** - Types d'urgences
   - 10 types prédéfinis
   - Priorités et couleurs

3. **alerts** - Alertes d'urgence
   - Signalements des utilisateurs
   - Géolocalisation
   - Statuts et priorités

4. **chat_messages** - Messages de chat
   - Communication entre utilisateurs
   - Support audio

5. **notifications** - Notifications push
   - Alertes en temps réel

6. **zones** - Zones géographiques
   - 10 zones de Goma

7. **alert_zones** - Relation alertes-zones
   - Association many-to-many

8. **statistics** - Statistiques quotidiennes
   - Métriques d'utilisation

### Vues

1. **v_active_alerts** - Alertes actives avec détails
2. **v_alerts_by_quartier** - Statistiques par quartier
3. **v_alerts_by_type** - Statistiques par type d'urgence
4. **v_active_users** - Liste des utilisateurs actifs

### Index

- 25 index pour optimiser les performances
- Sur les colonnes fréquemment utilisées

### Triggers

- Mise à jour automatique des timestamps
- Gestion des statuts d'alertes

## 🔐 Sécurité

### Comptes par Défaut

| Rôle | Téléphone | Mot de passe |
|------|-----------|--------------|
| Admin | +243000000000 | admin123 |
| Agent | +243111111111 | admin123 |
| Citoyen | +243222222222 | admin123 |

⚠️ **IMPORTANT**: Changez ces mots de passe en production!

### Bonnes Pratiques

1. **Sauvegardes régulières**
   ```bash
   # Sauvegarde quotidienne recommandée
   npm run db:backup
   ```

2. **Vérification d'intégrité**
   ```bash
   sqlite3 goma_security.db "PRAGMA integrity_check;"
   ```

3. **Chiffrement** (optionnel)
   ```bash
   # Utiliser SQLCipher pour chiffrer la base
   npm install better-sqlcipher
   ```

## 📈 Performance

### Optimisations Incluses

- **Index** sur les colonnes critiques
- **Vues** pour les requêtes fréquentes
- **Triggers** pour la maintenance automatique
- **Foreign keys** pour l'intégrité référentielle

### Recommandations

1. **Taille de la base**
   - Surveiller la croissance
   - Archiver les anciennes alertes

2. **Performances**
   - Exécuter `VACUUM` périodiquement
   - Analyser les requêtes lentes

3. **Monitoring**
   - Logger les erreurs
   - Surveiller les temps de réponse

## 🔧 Maintenance

### Quotidienne

```bash
# Sauvegarde
npm run db:backup

# Vérification des logs
tail -f logs/app.log
```

### Hebdomadaire

```bash
# Vérification d'intégrité
sqlite3 goma_security.db "PRAGMA integrity_check;"

# Optimisation
sqlite3 goma_security.db "VACUUM;"
```

### Mensuelle

```bash
# Nettoyage des anciennes données
sqlite3 goma_security.db "DELETE FROM alerts WHERE created_at < date('now', '-90 days');"

# Archivage
npm run db:backup
```

## 🐛 Dépannage

### Problèmes Courants

1. **Base verrouillée**
   ```bash
   # Trouver le processus
   lsof goma_security.db
   # Tuer le processus
   kill -9 <PID>
   ```

2. **Corruption de la base**
   ```bash
   # Restaurer depuis une sauvegarde
   npm run db:restore
   ```

3. **Espace disque**
   ```bash
   # Vérifier l'espace
   df -h
   # Nettoyer les anciennes sauvegardes
   rm backups/*.db
   ```

## 📚 Documentation

- [`README.md`](./README.md) - Documentation complète
- [`QUICKSTART.md`](./QUICKSTART.md) - Guide de démarrage rapide
- [`init.sql`](./init.sql) - Script SQL commenté

## 🆘 Support

En cas de problème:

1. Consulter la documentation
2. Vérifier les logs
3. Contacter l'équipe de développement

## 📝 Notes

- **Base de données**: SQLite 3
- **Encodage**: UTF-8
- **Taille maximale**: 281 TB (théorique)
- **Taille recommandée**: < 10 GB

---

**Goma Security** 🇨🇩  
Application de sécurité urbaine pour Goma, RDC
