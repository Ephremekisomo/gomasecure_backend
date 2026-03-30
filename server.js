/**
 * Goma Security - Main Server
 * Application de securite urbaine pour la ville de Goma, RDC
 */

require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

// Security middleware
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const bodyParser = require('body-parser');
const compression = require('compression');

// Authentication
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');

// File uploads
const multer = require('multer');

// Initialize Express
const app = express();
const server = http.createServer(app);

// Initialize Socket.IO
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// =====================
// DATABASE SETUP
// =====================

const dbPath = process.env.DB_PATH || './goma_security.db';
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Erreur de connexion a la base de donnees:', err.message);
    } else {
        console.log('Connecte a la base de donnees SQLite');
    }
});

// Initialize database tables
db.serialize(() => {
    // Users table
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nom TEXT NOT NULL,
        prenom TEXT NOT NULL,
        telephone TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT DEFAULT 'citoyen',
        quartier TEXT,
        avenue TEXT,
        photo_profil TEXT,
        latitude REAL,
        longitude REAL,
        accuracy REAL,
        two_fa_enabled INTEGER DEFAULT 0,
        two_fa_secret TEXT,
        push_subscription TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Emergency types table
    db.run(`CREATE TABLE IF NOT EXISTS emergency_types (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nom TEXT UNIQUE NOT NULL,
        icone TEXT NOT NULL,
        couleur TEXT NOT NULL,
        priorite INTEGER NOT NULL DEFAULT 3
    )`);

    // Alerts table
    db.run(`CREATE TABLE IF NOT EXISTS alerts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        type_id INTEGER,
        description TEXT,
        latitude REAL,
        longitude REAL,
        accuracy REAL,
        address TEXT,
        quartier TEXT,
        avenue TEXT,
        photo TEXT,
        voice_message TEXT,
        status TEXT DEFAULT 'active',
        priority INTEGER DEFAULT 3,
        assigned_to INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (type_id) REFERENCES emergency_types(id),
        FOREIGN KEY (assigned_to) REFERENCES users(id)
    )`);

    // Chat messages table
    db.run(`CREATE TABLE IF NOT EXISTS chat_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sender_id INTEGER NOT NULL,
        receiver_id INTEGER,
        message TEXT NOT NULL,
        is_from_admin INTEGER DEFAULT 0,
        audio_path TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (sender_id) REFERENCES users(id),
        FOREIGN KEY (receiver_id) REFERENCES users(id)
    )`, (err) => {
        if (!err) {
            // Add audio_path column if it doesn't exist
            db.run('ALTER TABLE chat_messages ADD COLUMN audio_path TEXT', (e) => {
                if (!e) console.log('Added audio_path column');
            });
        }
    });
    
    // Create uploads directories if they don't exist
    const uploadsDir = path.join(__dirname, 'uploads');
    const voicesDir = path.join(__dirname, 'uploads', 'voices');
    const profilesDir = path.join(__dirname, 'uploads', 'profiles');
    
    if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
    }
    if (!fs.existsSync(voicesDir)) {
        fs.mkdirSync(voicesDir, { recursive: true });
    }
    if (!fs.existsSync(profilesDir)) {
        fs.mkdirSync(profilesDir, { recursive: true });
    }

    // Insert default emergency types if not exist
    const emergencyTypes = [
        { nom: 'Agression', icone: 'fa-user-graduate', couleur: '#e74c3c', priorite: 1 },
        { nom: 'Accident', icone: 'fa-car-crash', couleur: '#e67e22', priorite: 1 },
        { nom: 'Incendie', icone: 'fa-fire', couleur: '#f39c12', priorite: 1 },
        { nom: 'Urgence Medicale', icone: 'fa-heartbeat', couleur: '#9b59b6', priorite: 2 },
        { nom: 'Violence', icone: 'fa-fist-raised', couleur: '#c0392b', priorite: 1 },
        { nom: 'Activite Suspecte', icone: 'fa-user-secret', couleur: '#7f8c8d', priorite: 3 },
        { nom: 'Manifestation', icone: 'fa-users', couleur: '#3498db', priorite: 4 },
        { nom: 'Catastrophe Naturelle', icone: 'fa-hurricane', couleur: '#1abc9c', priorite: 1 }
    ];

    const stmt = db.prepare('INSERT OR IGNORE INTO emergency_types (nom, icone, couleur, priorite) VALUES (?, ?, ?, ?)');
    emergencyTypes.forEach(type => {
        stmt.run(type.nom, type.icone, type.couleur, type.priorite);
    });
    stmt.finalize();
    
    // Remove duplicate emergency types (keep the first occurrence)
    db.run(`DELETE FROM emergency_types WHERE id NOT IN (
        SELECT MIN(id) FROM emergency_types GROUP BY nom
    )`);

    // Create admin user if not exist
    const adminPassword = bcrypt.hashSync('admin111', 10);
    db.run(`INSERT OR IGNORE INTO users (nom, prenom, telephone, email, password_hash, role, quartier) 
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ['Admin', 'Goma', '+243000000001', 'admin@gomasecurity.cd', adminPassword, 'admin', 'Goma']);
    
    // Create security center user if not exist
    const securityCenterPassword = bcrypt.hashSync('admin222', 10);
    db.run(`INSERT OR IGNORE INTO users (nom, prenom, telephone, email, password_hash, role, quartier) 
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ['Security', 'Center', '+243000000002', 'security@gomasecurity.cd', securityCenterPassword, 'security_center', 'Goma']);
});

// =====================
// MIDDLEWARE
// =====================

app.use(helmet({
    contentSecurityPolicy: false
}));
app.use(cors());
app.use(compression());
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// Rate limiting
const limiter = rateLimit({
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
    max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 1000,
    message: { error: 'Trop de requetes, veuillez reessayer plus tard.' }
});
app.use(limiter);

// Static files
// app.use(express.static(path.join(__dirname, '..', 'frontend', 'public')));

// Serve uploaded files
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// File upload configuration
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        let uploadPath = process.env.UPLOAD_PATH || './uploads';
        if (file.fieldname === 'photo') {
            uploadPath = path.join(uploadPath, 'profiles');
        } else if (file.fieldname === 'voice') {
            uploadPath = path.join(uploadPath, 'voices');
        }
        
        if (!fs.existsSync(uploadPath)) {
            fs.mkdirSync(uploadPath, { recursive: true });
        }
        cb(null, uploadPath);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: parseInt(process.env.MAX_FILE_SIZE) || 10 * 1024 * 1024 }
});

// Voice upload configuration
const voiceStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadPath = path.join(__dirname, 'uploads', 'voices');
        if (!fs.existsSync(uploadPath)) {
            fs.mkdirSync(uploadPath, { recursive: true });
        }
        cb(null, uploadPath);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'voice-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const uploadVoice = multer({
    storage: voiceStorage,
    limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit for voice
});

// =====================
// CONSTANTS
// =====================

const VALID_ROLES = ['citoyen', 'admin', 'security_center', 'poste'];

// =====================
// AUTHENTICATION MIDDLEWARE
// =====================

const authenticateToken = (req, res, next) => {
    const token = req.cookies.token || req.headers['authorization']?.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ error: 'Authentification requise' });
    }

    jwt.verify(token, process.env.JWT_SECRET || 'default_secret', (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Token invalide' });
        }
        req.user = user;
        next();
    });
};

const requireAdmin = (req, res, next) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Acces reserve aux administrateurs' });
    }
    next();
};

const validateRole = (role) => {
    return VALID_ROLES.includes(role);
};

// =====================
// ROUTES - AUTHENTICATION
// =====================

// Register
app.post('/api/auth/register', upload.single('photo'), async (req, res) => {
    try {
        const { nom, prenom, telephone, email, password, quartier, avenue, latitude, longitude } = req.body;
        
        // Check if user exists
        db.get('SELECT id FROM users WHERE telephone = ?', [telephone], async (err, user) => {
            if (user) {
                return res.status(400).json({ error: 'Ce numero de telephone est deja enregistre' });
            }

            const password_hash = await bcrypt.hash(password, 10);
            const photo_profil = req.file ? '/uploads/profiles/' + req.file.filename : null;

            db.run(`INSERT INTO users (nom, prenom, telephone, email, password_hash, quartier, avenue, latitude, longitude, photo_profil)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [nom, prenom, telephone, email, password_hash, quartier, avenue, latitude, longitude, photo_profil],
                function(err) {
                    if (err) {
                        return res.status(500).json({ error: 'Erreur lors de l\'inscription' });
                    }

                    const token = jwt.sign(
                        { id: this.lastID, telephone, role: 'citoyen' },
                        process.env.JWT_SECRET || 'default_secret',
                        { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
                    );

                    res.json({
                        message: 'Inscription reussie',
                        token,
                        user: { id: this.lastID, nom, prenom, telephone, role: 'citoyen' }
                    });
                });
        });
    } catch (error) {
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// Login
app.post('/api/auth/login', (req, res) => {
    const { telephone, password } = req.body;

    db.get('SELECT * FROM users WHERE telephone = ?', [telephone], async (err, user) => {
        if (err || !user) {
            return res.status(401).json({ error: 'Utilisateur non trouve' });
        }

        const validPassword = await bcrypt.compare(password, user.password_hash);
        if (!validPassword) {
            return res.status(401).json({ error: 'Mot de passe incorrect' });
        }

        // If 2FA is enabled, return temp token
        if (user['two_fa_enabled']) {
            const tempToken = jwt.sign(
                { id: user.id, telephone: user.telephone, temp: true },
                process.env.JWT_SECRET || 'default_secret',
                { expiresIn: '5m' }
            );
            return res.json({ requires2FA: true, tempToken });
        }

        const token = jwt.sign(
            { id: user.id, telephone: user.telephone, role: user.role },
            process.env.JWT_SECRET || 'default_secret',
            { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
        );

        res.json({
            message: 'Connexion reussie',
            token,
            user: {
                id: user.id,
                nom: user.nom,
                prenom: user.prenom,
                telephone: user.telephone,
                role: user.role,
                twoFaEnabled: !!user['two_fa_enabled']
            }
        });
    });
});

// Verify 2FA
app.post('/api/auth/verify-2fa', (req, res) => {
    const { tempToken, code } = req.body;

    jwt.verify(tempToken, process.env.JWT_SECRET || 'default_secret', (err, decoded) => {
        if (err || !decoded.temp) {
            return res.status(401).json({ error: 'Token invalide ou expire' });
        }

        db.get('SELECT * FROM users WHERE id = ?', [decoded.id], (err, user) => {
            if (err || !user) {
                return res.status(401).json({ error: 'Utilisateur non trouve' });
            }

            const verified = speakeasy.totp.verify({
                secret: user['two_fa_secret'],
                encoding: 'base32',
                token: code,
                window: 1
            });

            if (!verified) {
                return res.status(401).json({ error: 'Code invalide' });
            }

            const token = jwt.sign(
                { id: user.id, telephone: user.telephone, role: user.role },
                process.env.JWT_SECRET || 'default_secret',
                { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
            );

            res.json({
                message: 'Connexion reussie',
                token,
                user: {
                    id: user.id,
                    nom: user.nom,
                    prenom: user.prenom,
                    telephone: user.telephone,
                    role: user.role,
                    twoFaEnabled: !!user['two_fa_enabled']
                }
            });
        });
    });
});

// Setup 2FA
app.post('/api/auth/setup-2fa', authenticateToken, (req, res) => {
    const secret = speakeasy.generateSecret({
        name: `GomaSecurity:${req.user.telephone}`
    });

    db.run('UPDATE users SET two_fa_secret = ? WHERE id = ?', [secret.base32, req.user.id], (err) => {
        if (err) {
            return res.status(500).json({ error: 'Erreur lors de la configuration' });
        }

        QRCode.toDataURL(secret.otpauth_url, (err, data_url) => {
            res.json({
                secret: secret.base32,
                qrCode: data_url
            });
        });
    });
});

// Enable 2FA
app.post('/api/auth/enable-2fa', authenticateToken, (req, res) => {
    const { code } = req.body;

    db.get('SELECT two_fa_secret FROM users WHERE id = ?', [req.user.id], (err, user) => {
        if (err || !user) {
            return res.status(401).json({ error: 'Utilisateur non trouve' });
        }

        const verified = speakeasy.totp.verify({
            secret: user['two_fa_secret'],
            encoding: 'base32',
            token: code,
            window: 1
        });

        if (!verified) {
            return res.status(401).json({ error: 'Code invalide' });
        }

        db.run('UPDATE users SET two_fa_enabled = 1 WHERE id = ?', [req.user.id], (err) => {
            res.json({ message: '2FA active' });
        });
    });
});

// =====================
// ROUTES - ALERTS
// =====================

// Get emergency types
app.get('/api/emergency-types', (req, res) => {
    db.all('SELECT * FROM emergency_types ORDER BY priorite', [], (err, rows) => {
        if (err) {
            return res.status(500).json({ error: 'Erreur serveur' });
        }
        res.json(rows);
    });
});

// Create alert
app.post('/api/alerts', authenticateToken, upload.single('photo'), (req, res) => {
    const { type_id, description, latitude, longitude, accuracy, address, quartier, avenue, priority } = req.body;
    const photo = req.file ? '/uploads/profiles/' + req.file.filename : null;

    db.run(`INSERT INTO alerts (user_id, type_id, description, latitude, longitude, accuracy, address, quartier, avenue, photo, priority)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [req.user.id, type_id, description, latitude, longitude, accuracy, address, quartier, avenue, photo, priority || 3],
        function(err) {
            if (err) {
                return res.status(500).json({ error: 'Erreur lors de la creation de l\'alerte' });
            }

            const alertId = this.lastID;

            // Get alert with type info
            db.get(`SELECT a.*, u.nom, u.prenom, u.telephone, et.nom as type_nom, et.icone, et.couleur
                    FROM alerts a
                    JOIN users u ON a.user_id = u.id
                    JOIN emergency_types et ON a.type_id = et.id
                    WHERE a.id = ?`, [alertId], (err, alert) => {
                if (!err && alert) {
                    // Emit to security center
                    io.emit('new-alert', alert);
                }
            });

            res.json({
                message: 'Alerte creee avec succes',
                alertId
            });
        });
});

// Get citizen's alerts
app.get('/api/alerts/my', authenticateToken, (req, res) => {
    db.all(`SELECT a.*, et.nom as type_nom, et.icone, et.couleur
            FROM alerts a
            JOIN emergency_types et ON a.type_id = et.id
            WHERE a.user_id = ?
            ORDER BY a.created_at DESC`, [req.user.id], (err, rows) => {
        if (err) {
            return res.status(500).json({ error: 'Erreur serveur' });
        }
        res.json(rows);
    });
});

// Delete citizen's alert (citizen can only delete their own alerts)
app.delete('/api/alerts/:id', authenticateToken, (req, res) => {
    const alertId = parseInt(req.params.id);
    
    // First check if the alert belongs to the user
    db.get('SELECT user_id FROM alerts WHERE id = ?', [alertId], (err, row) => {
        if (err) {
            return res.status(500).json({ error: 'Erreur serveur' });
        }
        if (!row) {
            return res.status(404).json({ error: 'Alerte non trouvee' });
        }
        if (row.user_id !== req.user.id) {
            return res.status(403).json({ error: 'Non autorise' });
        }
        
        // Delete the alert
        db.run('DELETE FROM alerts WHERE id = ?', [alertId], (err) => {
            if (err) {
                return res.status(500).json({ error: 'Erreur lors de la suppression' });
            }
            res.json({ message: 'Alerte supprimee avec succes' });
        });
    });
});

// =====================
// CHAT API
// =====================

// Get chat messages (for citizen: get messages between user and admin)
app.get('/api/chat/messages', authenticateToken, (req, res) => {
    // Get admin user id
    db.get('SELECT id FROM users WHERE role = "admin" LIMIT 1', [], (err, adminRow) => {
        if (err) {
            return res.status(500).json({ error: 'Erreur serveur' });
        }
        
        const adminId = adminRow ? adminRow.id : null;
        
        // Get messages between user and admin
        db.all(`SELECT * FROM chat_messages 
                WHERE (sender_id = ? AND receiver_id = ?) 
                   OR (sender_id = ? AND receiver_id = ?)
                ORDER BY created_at ASC`, 
            [req.user.id, adminId, adminId, req.user.id], 
            (err, rows) => {
                if (err) {
                    return res.status(500).json({ error: 'Erreur serveur' });
                }
                res.json(rows || []);
            });
    });
});

// Send chat message
app.post('/api/chat/messages', authenticateToken, (req, res) => {
    const { message, receiver_id } = req.body;
    
    if (!message) {
        return res.status(400).json({ error: 'Message requis' });
    }
    
    // Get admin user id if no receiver specified
    let receiverId = receiver_id;
    if (!receiverId) {
        db.get('SELECT id FROM users WHERE role = "admin" LIMIT 1', [], (err, adminRow) => {
            if (err || !adminRow) {
                return res.status(500).json({ error: 'Admin non trouve' });
            }
            saveMessage(adminRow.id);
        });
    } else {
        saveMessage(receiverId);
    }
    
    function saveMessage(receiverId) {
        db.run(`INSERT INTO chat_messages (sender_id, receiver_id, message, is_from_admin)
                VALUES (?, ?, ?, 0)`,
            [req.user.id, receiverId, message],
            function(err) {
                if (err) {
                    return res.status(500).json({ error: 'Erreur lors de l\'envoi' });
                }
                
                // Emit socket event for real-time update
                io.emit('chat-message', {
                    id: this.lastID,
                    sender_id: req.user.id,
                    receiver_id: receiverId,
                    message: message,
                    created_at: new Date().toISOString()
                });
                
                res.json({ message: 'Message envoye', id: this.lastID });
            });
    }
});

// Send voice message (citizen)
app.post('/api/chat/voice', uploadVoice.single('audio'), (req, res) => {
    console.log('Voice upload request received');
    console.log('File:', req.file);
    console.log('Body:', req.body);
    
    if (!req.file) {
        return res.status(400).json({ error: 'Audio requis' });
    }
    
    // Get token from header
    const token = req.headers['authorization']?.split(' ')[1];
    if (!token) {
        return res.status(401).json({ error: 'Authentification requise' });
    }
    
    // Verify token
    jwt.verify(token, process.env.JWT_SECRET || 'default_secret', (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Token invalide' });
        }
        
        const audioPath = '/uploads/voices/' + path.basename(req.file.path);
        const message = '[Message vocal]';
        
        // Get admin user id
        db.get("SELECT id FROM users WHERE role = 'admin' LIMIT 1", [], (err, adminRow) => {
            if (err || !adminRow) {
                return res.status(500).json({ error: 'Admin non trouve' });
            }
            
            db.run(`INSERT INTO chat_messages (sender_id, receiver_id, message, is_from_admin, audio_path)
                    VALUES (?, ?, ?, 0, ?)`,
                [user.id, adminRow.id, message, audioPath],
                function(err) {
                    if (err) {
                        console.error('Insert error:', err);
                        return res.status(500).json({ error: 'Erreur lors de l\'envoi' });
                    }
                    
                    // Emit socket event for real-time update
                    io.emit('chat-message', {
                        id: this.lastID,
                        sender_id: user.id,
                        receiver_id: adminRow.id,
                        message: message,
                        audio_path: audioPath,
                        created_at: new Date().toISOString()
                    });
                    
                    res.json({ message: 'Message vocal envoye', id: this.lastID, audioPath: audioPath });
                });
        });
    });
});

// Delete chat message (citizen can only delete their own messages)
app.delete('/api/chat/messages/:id', authenticateToken, (req, res) => {
    const messageId = parseInt(req.params.id);
    
    db.run('DELETE FROM chat_messages WHERE id = ? AND sender_id = ?',
        [messageId, req.user.id],
        function(err) {
            if (err) {
                return res.status(500).json({ error: 'Erreur lors de la suppression' });
            }
            
            if (this.changes === 0) {
                return res.status(403).json({ error: 'Vous ne pouvez pas supprimer ce message' });
            }
            
            // Emit event about deleted message
            io.emit('chat-message-deleted', { id: messageId });
            
            res.json({ message: 'Message supprime' });
        }
    );
});

// Get all chat messages (admin only)
app.get('/api/chat/all', authenticateToken, requireAdmin, (req, res) => {
    db.all(`SELECT cm.*, u.nom as sender_nom, u.prenom as sender_prenom
            FROM chat_messages cm
            JOIN users u ON cm.sender_id = u.id
            ORDER BY cm.created_at DESC
            LIMIT 100`, [], (err, rows) => {
        if (err) {
            return res.status(500).json({ error: 'Erreur serveur' });
        }
        res.json(rows || []);
    });
});

// Send message from admin
app.post('/api/chat/admin/send', authenticateToken, requireAdmin, (req, res) => {
    const { user_id, message } = req.body;
    
    if (!user_id || !message) {
        return res.status(400).json({ error: 'Parametres requis' });
    }
    
    db.run(`INSERT INTO chat_messages (sender_id, receiver_id, message, is_from_admin)
            VALUES (?, ?, ?, 1)`,
        [req.user.id, user_id, message],
        function(err) {
            if (err) {
                return res.status(500).json({ error: 'Erreur lors de l\'envoi' });
            }
            
            // Emit socket event
            io.emit('chat-message', {
                id: this.lastID,
                sender_id: req.user.id,
                receiver_id: user_id,
                message: message,
                is_from_admin: 1,
                created_at: new Date().toISOString()
            });
            
            res.json({ message: 'Message envoye' });
        });
});

// Send voice message from admin
app.post('/api/chat/admin/voice', authenticateToken, requireAdmin, uploadVoice.single('audio'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'Audio requis' });
    }
    
    const user_id = parseInt(req.body.user_id);
    if (!user_id) {
        return res.status(400).json({ error: 'ID utilisateur requis' });
    }
    
    const audioPath = '/uploads/voices/' + path.basename(req.file.path);
    const message = '[Message vocal]';
    
    db.run(`INSERT INTO chat_messages (sender_id, receiver_id, message, is_from_admin, audio_path)
            VALUES (?, ?, ?, 1, ?)`,
        [req.user.id, user_id, message, audioPath],
        function(err) {
            if (err) {
                return res.status(500).json({ error: 'Erreur lors de l\'envoi' });
            }
            
            // Emit socket event
            io.emit('chat-message', {
                id: this.lastID,
                sender_id: req.user.id,
                receiver_id: user_id,
                message: message,
                audio_path: audioPath,
                is_from_admin: 1,
                created_at: new Date().toISOString()
            });
            
            res.json({ message: 'Message vocal envoye', audioPath: audioPath });
        });
});

// Delete chat message (admin can delete any message)
app.delete('/api/chat/admin/messages/:id', authenticateToken, requireAdmin, (req, res) => {
    const messageId = parseInt(req.params.id);
    
    db.run('DELETE FROM chat_messages WHERE id = ?',
        [messageId],
        function(err) {
            if (err) {
                return res.status(500).json({ error: 'Erreur lors de la suppression' });
            }
            
            // Emit event about deleted message
            io.emit('chat-message-deleted', { id: messageId });
            
            res.json({ message: 'Message supprime' });
        }
    );
});

// Get users who have sent chat messages (admin)
app.get('/api/chat/users', authenticateToken, requireAdmin, (req, res) => {
    db.all(`SELECT DISTINCT 
                u.id, 
                u.nom, 
                u.prenom, 
                u.telephone,
                (SELECT message FROM chat_messages 
                 WHERE sender_id = u.id 
                 ORDER BY created_at DESC LIMIT 1) as last_message,
                (SELECT created_at FROM chat_messages 
                 WHERE sender_id = u.id 
                 ORDER BY created_at DESC LIMIT 1) as last_message_time
            FROM chat_messages cm
            JOIN users u ON cm.sender_id = u.id
            WHERE cm.is_from_admin = 0
            ORDER BY last_message_time DESC`, 
        [], (err, rows) => {
            if (err) {
                return res.status(500).json({ error: 'Erreur lors de la recuperation' });
            }
            res.json(rows);
        });
});

// Get messages for a specific user (admin)
app.get('/api/chat/messages/:userId', authenticateToken, requireAdmin, (req, res) => {
    const userId = parseInt(req.params.userId);
    
    db.all(`SELECT cm.*, 
                CASE WHEN cm.is_from_admin = 1 THEN 'admin' ELSE 'citizen' END as sender_type
            FROM chat_messages cm
            WHERE (cm.sender_id = ? AND cm.receiver_id = (SELECT id FROM users WHERE role = 'admin' LIMIT 1))
               OR (cm.sender_id = (SELECT id FROM users WHERE role = 'admin' LIMIT 1) AND cm.receiver_id = ?)
            ORDER BY cm.created_at ASC`, 
        [userId, userId], (err, rows) => {
            if (err) {
                return res.status(500).json({ error: 'Erreur lors de la recuperation' });
            }
            res.json(rows);
        });
});

// Get all alerts (admin)
app.get('/api/alerts', authenticateToken, requireAdmin, (req, res) => {
    const { status, priority, quartier } = req.query;
    
    let query = `SELECT a.*, u.nom, u.prenom, u.telephone, et.nom as type_nom, et.icone, et.couleur
                 FROM alerts a
                 JOIN users u ON a.user_id = u.id
                 JOIN emergency_types et ON a.type_id = et.id
                 WHERE 1=1`;
    
    const params = [];
    
    if (status) {
        query += ' AND a.status = ?';
        params.push(status);
    }
    if (priority) {
        query += ' AND a.priority <= ?';
        params.push(priority);
    }
    if (quartier) {
        query += ' AND a.quartier = ?';
        params.push(quartier);
    }
    
    query += ' ORDER BY a.priority ASC, a.created_at DESC';

    db.all(query, params, (err, rows) => {
        if (err) {
            return res.status(500).json({ error: 'Erreur serveur' });
        }
        res.json(rows);
    });
});

// Get alerts assigned to a specific poste
app.get('/api/alerts/poste/:posteId', (req, res) => {
    const { posteId } = req.params;
    
    const query = `SELECT a.*, u.nom, u.prenom, u.telephone, et.nom as type_nom, et.icone, et.couleur
                 FROM alerts a
                 JOIN users u ON a.user_id = u.id
                 JOIN emergency_types et ON a.type_id = et.id
                 WHERE a.assigned_to = ?
                 ORDER BY a.priority ASC, a.created_at DESC`;

    db.all(query, [posteId], (err, rows) => {
        if (err) {
            return res.status(500).json({ error: 'Erreur serveur' });
        }
        res.json(rows);
    });
});

// Update alert status (admin)
app.put('/api/alerts/:id/status', authenticateToken, requireAdmin, (req, res) => {
    const { status } = req.body;
    const alertId = req.params.id;

    db.run(`UPDATE alerts SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [status, alertId],
        function(err) {
            if (err) {
                return res.status(500).json({ error: 'Erreur lors de la mise a jour' });
            }

            // Emit status update
            io.emit('alert-updated', { id: alertId, status });

            res.json({ message: 'Statut mis a jour' });
        }
    );
});

// Assign alert (admin)
app.put('/api/alerts/:id/assign', authenticateToken, requireAdmin, (req, res) => {
    const { assigned_to } = req.body;

    db.run('UPDATE alerts SET assigned_to = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [assigned_to, req.params.id],
        function(err) {
            if (err) {
                return res.status(500).json({ error: 'Erreur lors de l\'assignation' });
            }
            
            // Emit assignment update to all clients
            io.emit('alert-updated', { id: parseInt(req.params.id), assigned_to });
            
            res.json({ message: 'Alerte assignee' });
        }
    );
});

// =====================
// ROUTES - STATISTICS
// =====================

app.get('/api/stats', authenticateToken, requireAdmin, (req, res) => {
    const stats = {};
    
    console.log('Stats API called');
    
    // Use case-insensitive comparison with LOWER()
    db.get('SELECT COUNT(*) as total FROM alerts', [], (err, row) => {
        if (err || !row) {
            stats.total = 0;
        } else {
            stats.total = row.total;
            console.log('Total alerts:', row.total);
        }
        
        db.get('SELECT COUNT(*) as active FROM alerts WHERE LOWER(status) = "active" OR status IS NULL', [], (err, row) => {
            if (err || !row) {
                stats.active = 0;
            } else {
                stats.active = row.active;
                console.log('Active alerts:', row.active);
            }
            
            db.get('SELECT COUNT(*) as in_progress FROM alerts WHERE LOWER(status) = "en_cours"', [], (err, row) => {
                if (err || !row) {
                    stats.in_progress = 0;
                } else {
                    stats.in_progress = row.in_progress;
                }
                
                db.get('SELECT COUNT(*) as resolved FROM alerts WHERE LOWER(status) = "resolu"', [], (err, row) => {
                    if (err || !row) {
                        stats.resolved = 0;
                    } else {
                        stats.resolved = row.resolved;
                    }
                    
                    db.all(`SELECT et.nom, COUNT(*) as count 
                            FROM alerts a 
                            JOIN emergency_types et ON a.type_id = et.id 
                            GROUP BY et.nom`, [], (err, rows) => {
                        stats.by_type = rows || [];
                        
                        console.log('Sending stats:', stats);
                        res.json(stats);
                    });
                });
            });
        });
    });
});

// =====================
// ROUTES - USER PROFILE
// =====================

app.get('/api/user/profile', authenticateToken, (req, res) => {
    db.get('SELECT id, nom, prenom, telephone, email, role, quartier, avenue, latitude, longitude, photo_profil, two_fa_enabled, created_at FROM users WHERE id = ?',
        [req.user.id],
        (err, user) => {
            if (err || !user) {
                return res.status(404).json({ error: 'Utilisateur non trouve' });
            }
            res.json(user);
        }
    );
});

app.get('/api/user/role', authenticateToken, (req, res) => {
    db.get('SELECT role FROM users WHERE id = ?',
        [req.user.id],
        (err, user) => {
            if (err || !user) {
                return res.status(404).json({ error: 'Utilisateur non trouve' });
            }
            res.json({ role: user.role });
        }
    );
});

app.put('/api/user/profile', authenticateToken, upload.single('photo'), (req, res) => {
    const { nom, prenom, email, quartier, avenue, latitude, longitude } = req.body;
    const photo_profil = req.file ? '/uploads/profiles/' + req.file.filename : req.body.existing_photo;

    db.run(`UPDATE users SET nom = ?, prenom = ?, email = ?, quartier = ?, avenue = ?, latitude = ?, longitude = ?, photo_profil = ?
            WHERE id = ?`,
        [nom, prenom, email, quartier, avenue, latitude, longitude, photo_profil, req.user.id],
        function(err) {
            if (err) {
                return res.status(500).json({ error: 'Erreur lors de la mise a jour' });
            }
            res.json({ message: 'Profil mis a jour' });
        }
    );
});

// =====================
// SOCKET.IO
// =====================

io.on('connection', (socket) => {
    console.log('Client connecte:', socket.id);

    socket.on('join-room', (room) => {
        socket.join(room);
    });
    
    // Handle reinforcement call from poste
    socket.on('reinforcement-call', (data) => {
        console.log('Reinforcement call received:', data);
        // Broadcast to all clients in security-center room
        io.to('security-center').emit('reinforcement-call', data);
        // Also broadcast to all for debugging
        io.emit('reinforcement-call', data);
    });

    socket.on('disconnect', () => {
        console.log('Client deconnecte:', socket.id);
    });
});

// =====================
// PAGES
// =====================

// app.get('/', (req, res) => {
//     res.sendFile(path.join(__dirname, '..', 'frontend', 'public', 'index.html'));
// });

// app.get('/security-center', (req, res) => {
//     res.sendFile(path.join(__dirname, '..', 'frontend', 'public', 'security-center.html'));
// });

// app.get('/poste', (req, res) => {
//     res.sendFile(path.join(__dirname, '..', 'frontend', 'public', 'poste.html'));
// });

// app.get('/admin', (req, res) => {
//     res.sendFile(path.join(__dirname, '..', 'frontend', 'public', 'admin.html'));
// });
app.get('/',(req, res)=>{
    res.status(200).json({
        success:true,
        message:'Backend Goma secure '
    });
});

// =====================
// ROUTES - SYSTEM (Admin only)
// =====================

// Get database info
app.get('/api/system/database', authenticateToken, requireAdmin, (req, res) => {
    const dbPath = process.env.DB_PATH || './goma_security.db';
    const fs = require('fs');
    
    try {
        const stats = fs.statSync(dbPath);
        
        // Get table count
        db.get("SELECT COUNT(*) as count FROM sqlite_master WHERE type='table'", [], (err, row) => {
            res.json({
                path: dbPath,
                size: stats.size,
                tables: row ? row.count : 0
            });
        });
    } catch (error) {
        res.json({
            path: dbPath,
            size: 0,
            tables: 0
        });
    }
});

// Get server info
app.get('/api/system/server', authenticateToken, requireAdmin, (req, res) => {
    const os = require('os');
    
    res.json({
        port: process.env.PORT || 3000,
        environment: process.env.NODE_ENV || 'development',
        uptime: process.uptime(),
        memory: process.memoryUsage().heapUsed,
        platform: os.platform(),
        arch: os.arch(),
        nodeVersion: process.version
    });
});

// Get storage info
app.get('/api/system/storage', authenticateToken, requireAdmin, (req, res) => {
    const fs = require('fs');
    const path = require('path');
    
    const uploadsDir = path.join(__dirname, 'uploads');
    const profilesDir = path.join(uploadsDir, 'profiles');
    const voicesDir = path.join(uploadsDir, 'voices');
    
    let photos = 0;
    let voices = 0;
    let totalSize = 0;
    
    try {
        if (fs.existsSync(profilesDir)) {
            const profileFiles = fs.readdirSync(profilesDir);
            photos = profileFiles.filter(f => f !== '.gitkeep').length;
            profileFiles.forEach(f => {
                if (f !== '.gitkeep') {
                    const filePath = path.join(profilesDir, f);
                    const stat = fs.statSync(filePath);
                    totalSize += stat.size;
                }
            });
        }
        
        if (fs.existsSync(voicesDir)) {
            const voiceFiles = fs.readdirSync(voicesDir);
            voices = voiceFiles.filter(f => f !== '.gitkeep').length;
            voiceFiles.forEach(f => {
                if (f !== '.gitkeep') {
                    const filePath = path.join(voicesDir, f);
                    const stat = fs.statSync(filePath);
                    totalSize += stat.size;
                }
            });
        }
    } catch (error) {
        console.error('Error reading storage:', error);
    }
    
    res.json({ photos, voices, totalSize });
});

// Get socket info
app.get('/api/system/socket', authenticateToken, requireAdmin, (req, res) => {
    const connections = io.engine ? io.engine.clientsCount : 0;
    
    res.json({
        connections,
        messages: 0 // This would need to be tracked
    });
});

// Backup database
app.post('/api/system/backup', authenticateToken, requireAdmin, (req, res) => {
    const dbPath = process.env.DB_PATH || './goma_security.db';
    const fs = require('fs');
    
    try {
        if (fs.existsSync(dbPath)) {
            res.download(dbPath, `goma_security_backup_${new Date().toISOString().split('T')[0]}.db`);
        } else {
            res.status(404).json({ error: 'Base de donnees non trouvee' });
        }
    } catch (error) {
        res.status(500).json({ error: 'Erreur de sauvegarde' });
    }
});

// Cleanup unused files
app.post('/api/system/cleanup', authenticateToken, requireAdmin, (req, res) => {
    const fs = require('fs');
    const path = require('path');
    
    const uploadsDir = path.join(__dirname, 'uploads');
    let deleted = 0;
    
    try {
        // Get all photo paths from alerts
        db.all('SELECT photo FROM alerts WHERE photo IS NOT NULL', [], (err, alerts) => {
            if (err) {
                return res.status(500).json({ error: 'Erreur de nettoyage' });
            }
            
            const usedPhotos = new Set(alerts.map(a => a.photo));
            
            // Get all voice paths from chat messages
            db.all('SELECT audio_path FROM chat_messages WHERE audio_path IS NOT NULL', [], (err, messages) => {
                if (err) {
                    return res.status(500).json({ error: 'Erreur de nettoyage' });
                }
                
                const usedVoices = new Set(messages.map(m => m.audio_path));
                
                // Clean profiles directory
                const profilesDir = path.join(uploadsDir, 'profiles');
                if (fs.existsSync(profilesDir)) {
                    const files = fs.readdirSync(profilesDir);
                    files.forEach(file => {
                        if (file !== '.gitkeep') {
                            const filePath = `/uploads/profiles/${file}`;
                            if (!usedPhotos.has(filePath)) {
                                fs.unlinkSync(path.join(profilesDir, file));
                                deleted++;
                            }
                        }
                    });
                }
                
                // Clean voices directory
                const voicesDir = path.join(uploadsDir, 'voices');
                if (fs.existsSync(voicesDir)) {
                    const files = fs.readdirSync(voicesDir);
                    files.forEach(file => {
                        if (file !== '.gitkeep') {
                            const filePath = `/uploads/voices/${file}`;
                            if (!usedVoices.has(filePath)) {
                                fs.unlinkSync(path.join(voicesDir, file));
                                deleted++;
                            }
                        }
                    });
                }
                
                res.json({ deleted });
            });
        });
    } catch (error) {
        res.status(500).json({ error: 'Erreur de nettoyage' });
    }
});

// Get logs
app.get('/api/system/logs', authenticateToken, requireAdmin, (req, res) => {
    // In a real application, you would read from a log file
    // For now, return a placeholder
    res.send('Logs non disponibles dans cette version');
});

// Get all users (admin only)
app.get('/api/users', authenticateToken, requireAdmin, (req, res) => {
    db.all('SELECT id, nom, prenom, telephone, email, role, quartier, avenue, two_fa_enabled, created_at FROM users ORDER BY created_at DESC', [], (err, rows) => {
        if (err) {
            return res.status(500).json({ error: 'Erreur serveur' });
        }
        res.json(rows || []);
    });
});

// Update user (admin only)
app.put('/api/users/:id', authenticateToken, requireAdmin, (req, res) => {
    const { nom, prenom, email, role, quartier } = req.body;
    const userId = req.params.id;
    
    // Validate role if provided
    if (role && !validateRole(role)) {
        return res.status(400).json({ error: 'Role invalide. Roles valides: ' + VALID_ROLES.join(', ') });
    }
    
    db.run('UPDATE users SET nom = ?, prenom = ?, email = ?, role = ?, quartier = ? WHERE id = ?',
        [nom, prenom, email, role, quartier, userId],
        function(err) {
            if (err) {
                return res.status(500).json({ error: 'Erreur de mise a jour' });
            }
            res.json({ message: 'Utilisateur mis a jour' });
        }
    );
});

// Delete user (admin only)
app.delete('/api/users/:id', authenticateToken, requireAdmin, (req, res) => {
    const userId = req.params.id;
    
    // Don't allow deleting admin
    db.get('SELECT role FROM users WHERE id = ?', [userId], (err, user) => {
        if (err) {
            return res.status(500).json({ error: 'Erreur serveur' });
        }
        if (user && user.role === 'admin') {
            return res.status(403).json({ error: 'Impossible de supprimer un administrateur' });
        }
        
        db.run('DELETE FROM users WHERE id = ?', [userId], function(err) {
            if (err) {
                return res.status(500).json({ error: 'Erreur de suppression' });
            }
            res.json({ message: 'Utilisateur supprime' });
        });
    });
});

// Change password
app.post('/api/auth/change-password', authenticateToken, (req, res) => {
    const { currentPassword, newPassword } = req.body;
    
    db.get('SELECT password_hash FROM users WHERE id = ?', [req.user.id], async (err, user) => {
        if (err || !user) {
            return res.status(404).json({ error: 'Utilisateur non trouve' });
        }
        
        const validPassword = await bcrypt.compare(currentPassword, user.password_hash);
        if (!validPassword) {
            return res.status(401).json({ error: 'Mot de passe actuel incorrect' });
        }
        
        const newPasswordHash = await bcrypt.hash(newPassword, 10);
        
        db.run('UPDATE users SET password_hash = ? WHERE id = ?', [newPasswordHash, req.user.id], (err) => {
            if (err) {
                return res.status(500).json({ error: 'Erreur de mise a jour' });
            }
            res.json({ message: 'Mot de passe change' });
        });
    });
});

// =====================
// START SERVER
// =====================

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════════════════════════╗
║                                                            ║
║   🏢 GOMA SECURITY - Serveur en ligne                    ║
║                                                            ║
║   📍 Interface citoyens: http://localhost:${PORT}            ║
║   📍 Centre de securite: http://localhost:${PORT}/security-center  ║
║   📍 Poste de securite: http://localhost:${PORT}/poste      ║
║   📍 Panel Admin: http://localhost:${PORT}/admin             ║
║                                                            ║
║   👤 Admin par defaut:                                     ║
║      Telephone: +243000000000                              ║
║      Mot de passe: admin123                                ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
    `);
});

module.exports = { app, db, io };
