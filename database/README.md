# Goma Security - Base de Données

## 📋 Description

Ce dossier contient les scripts d'initialisation et de gestion de la base de données SQLite pour l'application Goma Security.

## 📁 Structure

```
database/
├── init.sql          # Script SQL complet d'initialisation
├── setup.js          # Script Node.js pour exécuter le SQL
└── README.md         # Ce fichier
```

## 🚀 Installation Rapide

### Option 1: Utiliser le script Node.js (Recommandé)

```bash
# Depuis le dossier gomasecure_backend
node database/setup.js
```

### Option 2: Utiliser SQLite directement

```bash
# Depuis le dossier gomasecure_backend
sqlite3 goma_security.db < database/init.sql
```

### Option 3: Via npm (si configuré)

```bash
npm run db:setup
```

## 📊 Tables Créées

| Table | Description |
|-------|-------------|
| `users` | Utilisateurs de l'application (citoyens, agents, admins) |
| `emergency_types` | Types d'urgences disponibles (agression, accident, etc.) |
| `alerts` | Alertes d'urgence signalées par les utilisateurs |
| `chat_messages` | Messages de chat entre utilisateurs |
| `notifications` | Notifications push envoyées |
| `zones` | Zones géographiques de Goma |
| `alert_zones` | Relation alertes-zones |
| `statistics` | Statistiques quotidiennes |

## 👁️ Vues Créées

| Vue | Description |
|-----|-------------|
| `v_active_alerts` | Alertes actives avec détails utilisateurs et types |
| `v_alerts_by_quartier` | Statistiques par quartier |
| `v_alerts_by_type` | Statistiques par type d'urgence |
| `v_active_users` | Liste des utilisateurs actifs |

## 📇 Index Créés

Les index sont créés pour optimiser les performances sur les colonnes fréquemment utilisées :
- Utilisateurs: téléphone, email, rôle, quartier, localisation
- Alertes: user_id, type_id, status, priorité, date, localisation, quartier
- Chat: sender_id, receiver_id, date, is_read
- Notifications: user_id, is_read, date

## 🔐 Comptes par Défaut

| Rôle | Téléphone | Mot de passe |
|------|-----------|--------------|
| Admin | +243000000000 | admin123 |
| Agent | +243111111111 | admin123 |
| Citoyen | +243222222222 | admin123 |

⚠️ **IMPORTANT**: Changez ces mots de passe en production!

## 🗺️ Zones de Goma Incluses

Le script inclut les zones suivantes :
- Centre-ville
- Birere
- Mabanga Nord
- Mabanga Sud
- Katoyi
- Majengo
- Kyeshero
- Les Volcans
- Mugunga
- Lac Vert

## 🚨 Types d'Urgence Inclus

| Type | Priorité | Couleur |
|------|----------|---------|
| Agression | 1 (Haute) | Rouge |
| Accident | 1 (Haute) | Orange |
| Incendie | 1 (Haute) | Jaune |
| Urgence Médicale | 2 | Violet |
| Violence | 1 (Haute) | Rouge foncé |
| Activité Suspecte | 3 | Gris |
| Manifestation | 4 | Bleu |
| Catastrophe Naturelle | 1 (Haute) | Turquoise |
| Vol | 2 | Rouge |
| Bruit | 5 (Basse) | Gris clair |

## 🔧 Utilisation Avancée

### Réinitialiser la base de données

```bash
# Supprimer l'ancienne base
rm goma_security.db

# Recréer la base
node database/setup.js
```

### Sauvegarder la base de données

```bash
sqlite3 goma_security.db ".backup backup_$(date +%Y%m%d).db"
```

### Restaurer une sauvegarde

```bash
cp backup_20260330.db goma_security.db
```

### Vérifier l'intégrité

```bash
sqlite3 goma_security.db "PRAGMA integrity_check;"
```

## 📝 Requêtes Utiles

### Voir toutes les alertes actives

```sql
SELECT * FROM v_active_alerts;
```

### Statistiques par quartier

```sql
SELECT * FROM v_alerts_by_quartier;
```

### Alertes des dernières 24 heures

```sql
SELECT * FROM alerts 
WHERE created_at >= datetime('now', '-1 day')
ORDER BY created_at DESC;
```

### Utilisateurs par rôle

```sql
SELECT role, COUNT(*) as count 
FROM users 
GROUP BY role;
```

## 🐛 Dépannage

### Erreur: "database is locked"

```bash
# Vérifier les processus utilisant la base
lsof goma_security.db

# Tuer le processus si nécessaire
kill -9 <PID>
```

### Erreur: "no such table"

```bash
# Réinitialiser la base
rm goma_security.db
node database/setup.js
```

## 📞 Support

Pour toute question ou problème, contactez l'équipe de développement.

---

**Goma Security** - Application de sécurité urbaine pour Goma, RDC 🇨🇩
