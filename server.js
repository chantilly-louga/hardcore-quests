// ============================================================
//  SERVER.JS — Node.js Backend for Minecraft Hardcore Quest Site
//  Optimisé pour Replit
// ============================================================

const express = require('express');
const cors    = require('cors');
const fs      = require('fs');
const path    = require('path');

const app  = express();

// Replit injecte process.env.PORT automatiquement
const PORT = process.env.PORT || 3000;

// ——— Paths ———
const DATA_DIR    = path.join(process.cwd(), 'data');
const DATA_FILE   = path.join(DATA_DIR, 'db.json');
const QUESTS_FILE = path.join(process.cwd(), 'quests.json');
const PUBLIC_DIR  = process.cwd();

// ——— Middleware ———
app.use(cors());
app.use(express.json());
app.use(express.static(PUBLIC_DIR, {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
  }
}));

// ——— DB helpers ———
function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readDB() {
  ensureDataDir();
  if (!fs.existsSync(DATA_FILE)) {
    let quests = [];
    try {
      const raw = fs.readFileSync(QUESTS_FILE, 'utf8');
      quests = JSON.parse(raw).quests || [];
    } catch { console.warn('quests.json introuvable, DB vide créée.'); }
    const initial = { quests, progress: {}, players: [] };
    writeDB(initial);
    console.log('✅ DB initialisée avec ' + quests.length + ' quêtes depuis quests.json');
    return initial;
  }
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (e) {
    console.error('Erreur lecture DB:', e.message);
    return { quests: [], progress: {}, players: [] };
  }
}

function writeDB(data) {
  ensureDataDir();
  try { fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8'); }
  catch (e) { console.error('Erreur écriture DB:', e.message); }
}

// ——————————————————————————————————————————
//  API ROUTES
// ——————————————————————————————————————————

app.get('/api/data', (req, res) => {
  const db = readDB();
  res.json({ quests: db.quests, progress: db.progress, players: db.players });
});

app.put('/api/data', (req, res) => {
  const { quests, progress, players } = req.body;
  const db = readDB();
  if (quests   !== undefined) db.quests   = quests;
  if (progress !== undefined) db.progress = progress;
  if (players  !== undefined) db.players  = players;
  writeDB(db);
  res.json({ ok: true });
});

app.get('/api/quests', (req, res) => {
  res.json(readDB().quests);
});

app.put('/api/quests', (req, res) => {
  const db = readDB();
  db.quests = req.body;
  writeDB(db);
  res.json({ ok: true });
});

app.get('/api/progress', (req, res) => {
  res.json(readDB().progress);
});

app.put('/api/progress', (req, res) => {
  const db = readDB();
  db.progress = req.body;
  writeDB(db);
  res.json({ ok: true });
});

app.patch('/api/progress/:player/:questId', (req, res) => {
  const { player, questId } = req.params;
  const db = readDB();
  if (!db.progress[player]) db.progress[player] = {};
  db.progress[player][questId] = req.body;
  writeDB(db);
  res.json({ ok: true });
});

app.get('/api/players', (req, res) => {
  res.json(readDB().players || []);
});

app.post('/api/players', (req, res) => {
  const { name } = req.body;
  if (!name || typeof name !== 'string') return res.status(400).json({ error: 'name requis' });
  const db = readDB();
  if (!db.players) db.players = [];
  if (!db.players.includes(name)) {
    db.players.push(name);
    writeDB(db);
    console.log('👤 Nouveau joueur: ' + name);
  }
  res.json({ ok: true });
});

// Wildcard → login.html
app.get('*', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'login.html'));
});

// ——— Démarrage (0.0.0.0 OBLIGATOIRE sur Replit) ———
app.listen(PORT, '0.0.0.0', () => {
  const slug  = process.env.REPL_SLUG;
  const owner = process.env.REPL_OWNER;
  console.log('\n⚔️  Minecraft Hardcore Quest Server démarré !');
  if (slug && owner) {
    console.log('   🌐 URL : https://' + slug + '.' + owner + '.repl.co/login.html');
    console.log('   🔐 Admin : https://' + slug + '.' + owner + '.repl.co/admin.html');
  } else {
    console.log('   Local : http://localhost:' + PORT + '/login.html');
  }
  console.log('   Port  : ' + PORT + '\n');
});
