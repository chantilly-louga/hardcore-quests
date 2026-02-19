// ============================================================
//  SCRIPT.JS — Logique principale du site de quêtes Minecraft
//  Architecture : JSONBin.io (multi-joueurs) + localStorage (fallback)
// ============================================================

// ——————————————————————————————————————————
//  STORAGE LAYER — Abstraction JSONBin + localStorage
// ——————————————————————————————————————————

const Storage = {
  // Clés localStorage
  KEYS: {
    PLAYER:       'mc_player',
    PROGRESS:     'mc_progress',    // { questId: { status, validatedAt } }
    ALL_PROGRESS: 'mc_all_progress' // { playerName: { questId: {...} } }
  },

  // ——— SESSION JOUEUR ———
  getCurrentPlayer() {
    try { return JSON.parse(sessionStorage.getItem(this.KEYS.PLAYER)); } catch { return null; }
  },

  setCurrentPlayer(player) {
    sessionStorage.setItem(this.KEYS.PLAYER, JSON.stringify(player));
  },

  clearCurrentPlayer() {
    sessionStorage.removeItem(this.KEYS.PLAYER);
  },

  // ——— PROGRESSION GLOBALE (tous joueurs) ———
  getAllProgress() {
    try { return JSON.parse(localStorage.getItem(this.KEYS.ALL_PROGRESS)) || {}; } catch { return {}; }
  },

  saveAllProgress(data) {
    localStorage.setItem(this.KEYS.ALL_PROGRESS, JSON.stringify(data));
  },

  // ——— PROGRESSION D'UN JOUEUR ———
  getPlayerProgress(playerName) {
    const all = this.getAllProgress();
    return all[playerName] || {};
  },

  updatePlayerProgress(playerName, questId, statusObj) {
    const all = this.getAllProgress();
    if (!all[playerName]) all[playerName] = {};
    all[playerName][questId] = statusObj;
    this.saveAllProgress(all);
  },

  // ——— LISTE DES JOUEURS CONNUS ———
  getKnownPlayers() {
    try { return JSON.parse(localStorage.getItem('mc_known_players')) || []; } catch { return []; }
  },

  addKnownPlayer(playerName) {
    const players = this.getKnownPlayers();
    if (!players.includes(playerName)) {
      players.push(playerName);
      localStorage.setItem('mc_known_players', JSON.stringify(players));
    }
    // Sync to NodeServer if enabled (async, fire-and-forget)
    if (typeof NodeServer !== 'undefined' && NodeServer.enabled) {
      NodeServer.registerPlayer(playerName).catch(() => {});
    }
  },

  // ——— QUÊTES (cache local) ———
  getCachedQuests() {
    try { return JSON.parse(localStorage.getItem('mc_quests_cache')); } catch { return null; }
  },

  setCachedQuests(quests) {
    localStorage.setItem('mc_quests_cache', JSON.stringify(quests));
    localStorage.setItem('mc_quests_cache_time', Date.now());
  },

  isCacheValid() {
    const t = localStorage.getItem('mc_quests_cache_time');
    if (!t) return false;
    return (Date.now() - parseInt(t)) < 30000; // 30s cache
  }
};

// ——————————————————————————————————————————
//  JSONBIN LAYER — Synchronisation multi-joueurs
// ——————————————————————————————————————————

const JsonBin = {
  get enabled() { return typeof CONFIG !== 'undefined' && CONFIG.jsonbin?.enabled; },
  get binId()   { return CONFIG?.jsonbin?.binId; },
  get apiKey()  { return CONFIG?.jsonbin?.apiKey; },
  BASE_URL:     'https://api.jsonbin.io/v3/b',

  async read() {
    if (!this.enabled) return null;
    try {
      const r = await fetch(`${this.BASE_URL}/${this.binId}/latest`, {
        headers: { 'X-Master-Key': this.apiKey, 'X-Bin-Meta': false }
      });
      if (!r.ok) throw new Error('JSONBin read failed');
      return await r.json();
    } catch (e) {
      console.warn('JSONBin read failed, using localStorage:', e);
      return null;
    }
  },

  async write(data) {
    if (!this.enabled) return false;
    try {
      const r = await fetch(`${this.BASE_URL}/${this.binId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Master-Key': this.apiKey
        },
        body: JSON.stringify(data)
      });
      return r.ok;
    } catch (e) {
      console.warn('JSONBin write failed, saved locally:', e);
      return false;
    }
  }
};

// ——————————————————————————————————————————
//  NODE SERVER LAYER — Remplacement de JSONBin par API locale
// ——————————————————————————————————————————

const NodeServer = {
  get enabled() {
    return typeof CONFIG !== 'undefined' && CONFIG.nodeServer?.enabled;
  },
  get base() {
    const b = CONFIG?.nodeServer?.baseUrl || '';
    return b.replace(/\/$/, '');
  },

  async read() {
    if (!this.enabled) return null;
    try {
      const r = await fetch(`${this.base}/api/data`);
      if (!r.ok) throw new Error('Node read failed');
      return await r.json();
    } catch (e) {
      console.warn('NodeServer read failed, falling back:', e);
      return null;
    }
  },

  async write(data) {
    if (!this.enabled) return false;
    try {
      const r = await fetch(`${this.base}/api/data`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      return r.ok;
    } catch (e) {
      console.warn('NodeServer write failed:', e);
      return false;
    }
  },

  async patchProgress(playerName, questId, statusObj) {
    if (!this.enabled) return false;
    try {
      const r = await fetch(`${this.base}/api/progress/${encodeURIComponent(playerName)}/${encodeURIComponent(questId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(statusObj)
      });
      return r.ok;
    } catch (e) {
      console.warn('NodeServer patch failed:', e);
      return false;
    }
  },

  async registerPlayer(name) {
    if (!this.enabled) return;
    try {
      await fetch(`${this.base}/api/players`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      });
    } catch {}
  }
};

// ——————————————————————————————————————————
//  QUEST API — Chargement et gestion des quêtes
// ——————————————————————————————————————————

const QuestAPI = {
  async loadQuests() {
    // 1. Essaie NodeServer (priorité absolue si activé)
    if (NodeServer.enabled) {
      const remote = await NodeServer.read();
      if (remote?.quests) {
        Storage.setCachedQuests(remote.quests);
        if (remote.progress) Storage.saveAllProgress(remote.progress);
        if (remote.players) localStorage.setItem('mc_known_players', JSON.stringify(remote.players));
        return remote.quests;
      }
    }

    // 2. Essaie JSONBin (progression + quêtes centralisées)
    const remote = await JsonBin.read();
    if (remote?.quests) {
      Storage.setCachedQuests(remote.quests);
      if (remote.progress) Storage.saveAllProgress(remote.progress);
      return remote.quests;
    }

    // 2. Essaie de charger quests.json du repo GitHub
    try {
      const base = (typeof CONFIG !== 'undefined' && CONFIG.githubRawBase)
        ? CONFIG.githubRawBase
        : '.';
      const r = await fetch(`${base}/quests.json?t=${Date.now()}`);
      if (r.ok) {
        const data = await r.json();
        Storage.setCachedQuests(data.quests);
        return data.quests;
      }
    } catch {}

    // 3. Cache local
    const cached = Storage.getCachedQuests();
    if (cached) return cached;

    // 4. Quêtes par défaut
    return this._defaultQuests();
  },

  _defaultQuests() {
    return [
      {
        id: 'q_default_1',
        title: 'Bienvenue !',
        description: "Le fichier quests.json n'a pas pu être chargé. Configure ton repo GitHub.",
        reward_item: 'Configuration requise',
        reward_icon: '⚙️',
        difficulty: 'Facile',
        xp: 0,
        active: true
      }
    ];
  },

  async saveQuests(quests) {
    Storage.setCachedQuests(quests);

    if (NodeServer.enabled) {
      await NodeServer.write({ quests, progress: Storage.getAllProgress(), players: Storage.getKnownPlayers() });
    } else if (JsonBin.enabled) {
      const remote = await JsonBin.read() || {};
      remote.quests = quests;
      await JsonBin.write(remote);
    }
  },

  async saveProgress(allProgress) {
    Storage.saveAllProgress(allProgress);

    if (NodeServer.enabled) {
      await NodeServer.write({ quests: Storage.getCachedQuests() || [], progress: allProgress, players: Storage.getKnownPlayers() });
    } else if (JsonBin.enabled) {
      const remote = await JsonBin.read() || {};
      remote.progress = allProgress;
      await JsonBin.write(remote);
    }
  }
};

// ——————————————————————————————————————————
//  UI UTILITIES
// ——————————————————————————————————————————

const UI = {
  // Toasts
  _toastContainer: null,

  getToastContainer() {
    if (!this._toastContainer) {
      this._toastContainer = document.createElement('div');
      this._toastContainer.className = 'toast-container';
      document.body.appendChild(this._toastContainer);
    }
    return this._toastContainer;
  },

  toast(message, type = 'info', duration = 3500) {
    const icons = { success: '✅', error: '❌', info: '💡', warning: '⚠️' };
    const container = this.getToastContainer();
    const el = document.createElement('div');
    el.className = `toast ${type} fade-in`;
    el.innerHTML = `<span>${icons[type]}</span><span>${message}</span>`;
    container.appendChild(el);
    setTimeout(() => {
      el.style.animation = 'slideIn 0.3s ease reverse';
      setTimeout(() => el.remove(), 300);
    }, duration);
  },

  // Avatar Minecraft via API Crafatar
  getAvatarUrl(playerName, size = 32) {
    // Crafatar retourne l'avatar du skin Minecraft
    return `https://crafatar.com/avatars/${encodeURIComponent(playerName)}?size=${size}&overlay&default=MHF_Steve`;
  },

  // Difficulté
  getDiffClass(diff) {
    const map = { 'Facile': 'diff-facile', 'Moyen': 'diff-moyen', 'Difficile': 'diff-difficile', 'Légendaire': 'diff-legendaire' };
    return map[diff] || 'diff-facile';
  },

  // Statut
  getStatusBadge(status) {
    const map = {
      'available': { text: 'Disponible', cls: 'status-available' },
      'pending':   { text: '⏳ En attente', cls: 'status-pending' },
      'validated': { text: '✓ Validée', cls: 'status-validated' }
    };
    return map[status] || map.available;
  },

  // Formater date
  formatDate(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  },

  // Spinner
  setLoading(el, loading) {
    if (!el) return;
    if (loading) {
      el.dataset.originalText = el.innerHTML;
      el.innerHTML = '<span class="loading-spinner"></span>';
      el.disabled = true;
    } else {
      el.innerHTML = el.dataset.originalText || el.innerHTML;
      el.disabled = false;
    }
  }
};

// ——————————————————————————————————————————
//  PAGE : LOGIN
// ——————————————————————————————————————————

function initLoginPage() {
  const form    = document.getElementById('loginForm');
  const input   = document.getElementById('playerInput');
  const errMsg  = document.getElementById('loginError');
  const btn     = document.getElementById('loginBtn');

  if (!form) return;

  // Si déjà connecté, rediriger
  const player = Storage.getCurrentPlayer();
  if (player) { window.location.href = 'index.html'; return; }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errMsg.classList.remove('show');

    const name = input.value.trim();
    if (!name) {
      errMsg.textContent = 'Entre ton pseudo Minecraft.';
      errMsg.classList.add('show');
      return;
    }
    if (name.length < 2 || name.length > 16) {
      errMsg.textContent = 'Le pseudo doit faire entre 2 et 16 caractères.';
      errMsg.classList.add('show');
      return;
    }
    if (!/^[a-zA-Z0-9_]+$/.test(name)) {
      errMsg.textContent = 'Seuls lettres, chiffres et _ sont autorisés.';
      errMsg.classList.add('show');
      return;
    }

    UI.setLoading(btn, true);

    // Enregistre le joueur
    const playerData = { name, joinedAt: new Date().toISOString() };
    Storage.setCurrentPlayer(playerData);
    Storage.addKnownPlayer(name);

    UI.toast(`Bienvenue, ${name} !`, 'success');
    setTimeout(() => { window.location.href = 'index.html'; }, 800);
  });
}

// ——————————————————————————————————————————
//  PAGE : INDEX (Joueur)
// ——————————————————————————————————————————

async function initIndexPage() {
  const player = Storage.getCurrentPlayer();
  if (!player) { window.location.href = 'login.html'; return; }

  // Header joueur
  renderPlayerHeader(player);
  renderPlayerProfile(player);

  // Charger quêtes
  renderLoading(document.getElementById('questsContainer'));
  const quests = await QuestAPI.loadQuests();
  const progress = Storage.getPlayerProgress(player.name);

  renderQuests(quests.filter(q => q.active), progress, player);
  renderPlayerStats(player, quests, progress);
  renderRewards(player, quests, progress);

  // Filtres
  initFilters(quests.filter(q => q.active), progress, player);
}

function renderPlayerHeader(player) {
  const el = document.getElementById('playerHeaderInfo');
  if (!el) return;
  el.innerHTML = `
    <div class="nav-player">
      <img class="nav-player-avatar" src="${UI.getAvatarUrl(player.name, 28)}" alt="${player.name}" onerror="this.src='https://crafatar.com/avatars/MHF_Steve?size=28'">
      <span class="nav-player-name">${player.name}</span>
    </div>
    <button class="btn btn-ghost btn-sm" onclick="logout()">Déconnexion</button>
  `;
}

function renderPlayerProfile(player) {
  const el = document.getElementById('playerProfile');
  if (!el) return;
  el.innerHTML = `
    <div class="player-avatar-wrap">
      <img class="player-avatar" src="${UI.getAvatarUrl(player.name, 80)}"
           alt="${player.name}" onerror="this.src='https://crafatar.com/avatars/MHF_Steve?size=80'">
    </div>
    <div class="player-info">
      <div class="player-name-display">${player.name}</div>
      <div><span class="hardcore-badge">❤️ HARDCORE</span></div>
      <div class="player-stats" id="playerStats">
        <div class="stat-block"><span class="stat-value" id="statTotal">—</span><span class="stat-label">Quêtes dispo</span></div>
        <div class="stat-block"><span class="stat-value" id="statValidated">—</span><span class="stat-label">Validées</span></div>
        <div class="stat-block"><span class="stat-value" id="statPending">—</span><span class="stat-label">En attente</span></div>
        <div class="stat-block"><span class="stat-value" id="statXP">—</span><span class="stat-label">XP Total</span></div>
      </div>
    </div>
  `;
}

function renderPlayerStats(player, quests, progress) {
  const active = quests.filter(q => q.active);
  const validated = Object.values(progress).filter(p => p.status === 'validated').length;
  const pending = Object.values(progress).filter(p => p.status === 'pending').length;
  const xp = active
    .filter(q => progress[q.id]?.status === 'validated')
    .reduce((sum, q) => sum + (q.xp || 0), 0);

  if (document.getElementById('statTotal'))     document.getElementById('statTotal').textContent = active.length;
  if (document.getElementById('statValidated')) document.getElementById('statValidated').textContent = validated;
  if (document.getElementById('statPending'))   document.getElementById('statPending').textContent = pending;
  if (document.getElementById('statXP'))        document.getElementById('statXP').textContent = xp + ' XP';
}

function renderRewards(player, quests, progress) {
  const el = document.getElementById('rewardsList');
  if (!el) return;
  const rewards = quests.filter(q => progress[q.id]?.status === 'validated');
  if (!rewards.length) {
    el.innerHTML = '<span style="color:var(--text-dim);font-size:0.85rem;">Aucune récompense pour l\'instant. Complète des quêtes !</span>';
    return;
  }
  el.innerHTML = rewards.map(q =>
    `<span class="reward-badge">${q.reward_icon} ${q.reward_item}</span>`
  ).join('');
}

function renderLoading(container) {
  if (!container) return;
  container.innerHTML = `<div class="loading-overlay"><div class="loading-spinner"></div> Chargement des quêtes...</div>`;
}

let _currentQuests = [];
let _currentProgress = {};
let _currentPlayer = null;
let _filterDiff = 'all';
let _filterStatus = 'all';
let _searchQuery = '';

function renderQuests(quests, progress, player) {
  _currentQuests = quests;
  _currentProgress = progress;
  _currentPlayer = player;
  _applyFiltersAndRender();
}

function _applyFiltersAndRender() {
  const container = document.getElementById('questsContainer');
  if (!container) return;

  let quests = _currentQuests;

  // Filtre difficulté
  if (_filterDiff !== 'all') {
    quests = quests.filter(q => q.difficulty === _filterDiff);
  }

  // Filtre statut
  if (_filterStatus !== 'all') {
    quests = quests.filter(q => {
      const s = _currentProgress[q.id]?.status || 'available';
      return s === _filterStatus;
    });
  }

  // Recherche
  if (_searchQuery) {
    const q = _searchQuery.toLowerCase();
    quests = quests.filter(quest =>
      quest.title.toLowerCase().includes(q) || quest.description.toLowerCase().includes(q)
    );
  }

  if (!quests.length) {
    container.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1">
        <span class="empty-state-icon">🔍</span>
        <div class="empty-state-text">Aucune quête ne correspond<br>à tes filtres.</div>
      </div>`;
    return;
  }

  container.className = 'quests-grid stagger';
  container.innerHTML = quests.map(q => renderQuestCard(q, _currentProgress, _currentPlayer)).join('');
}

function renderQuestCard(quest, progress, player) {
  const state  = progress[quest.id]?.status || 'available';
  const badge  = UI.getStatusBadge(state);
  const diffCls = UI.getDiffClass(quest.difficulty);
  const isValidated = state === 'validated';
  const isPending   = state === 'pending';

  let actionBtn = '';
  if (isValidated) {
    actionBtn = `<button class="btn btn-success btn-sm" disabled>✓ Validée</button>`;
  } else if (isPending) {
    actionBtn = `<button class="btn btn-gold btn-sm" disabled>⏳ En attente</button>`;
  } else {
    actionBtn = `<button class="btn btn-primary btn-sm" onclick="markQuestDone('${quest.id}')">Marquer terminée</button>`;
  }

  return `
    <div class="quest-card ${isValidated ? 'validated' : ''}" id="quest-card-${quest.id}">
      <div class="quest-card-top">
        <span class="quest-status-badge ${badge.cls}">${badge.text}</span>
        <div class="quest-card-header">
          <div class="quest-icon-wrap">${quest.reward_icon}</div>
          <div class="quest-title-block">
            <div class="quest-name">${quest.title}</div>
            <span class="quest-difficulty ${diffCls}">${quest.difficulty}</span>
          </div>
        </div>
        <p class="quest-desc">${quest.description}</p>
      </div>
      <div class="quest-card-bottom">
        <div class="quest-reward">
          <div>
            <div class="reward-label">Récompense</div>
            <div class="reward-item">${quest.reward_icon} ${quest.reward_item}</div>
          </div>
          <div class="quest-xp" style="margin-left:1rem">+${quest.xp} XP</div>
        </div>
        ${actionBtn}
      </div>
    </div>`;
}

async function markQuestDone(questId) {
  const player = Storage.getCurrentPlayer();
  if (!player) return;

  const btn = document.querySelector(`#quest-card-${questId} .btn-primary`);
  if (btn) UI.setLoading(btn, true);

  const statusObj = { status: 'pending', requestedAt: new Date().toISOString() };
  Storage.updatePlayerProgress(player.name, questId, statusObj);

  if (NodeServer.enabled) {
    // Efficient: only patch the specific quest status
    await NodeServer.patchProgress(player.name, questId, statusObj);
    await NodeServer.registerPlayer(player.name);
  } else {
    const allProgress = Storage.getAllProgress();
    await QuestAPI.saveProgress(allProgress);
  }

  _currentProgress[questId] = statusObj;

  // Refresh la carte
  const card = document.getElementById(`quest-card-${questId}`);
  if (card) {
    const quest = _currentQuests.find(q => q.id === questId);
    if (quest) {
      const tmp = document.createElement('div');
      tmp.innerHTML = renderQuestCard(quest, _currentProgress, player);
      card.replaceWith(tmp.firstElementChild);
    }
  }

  renderPlayerStats(player, _currentQuests, _currentProgress);
  UI.toast('Demande de validation envoyée ! L\'admin validera bientôt.', 'success');
}

function initFilters(quests, progress, player) {
  // Difficultés disponibles
  const diffs = ['all', ...new Set(quests.map(q => q.difficulty))];
  const pillsEl = document.getElementById('diffPills');
  if (pillsEl) {
    pillsEl.innerHTML = diffs.map(d => `
      <button class="filter-pill ${d === 'all' ? 'active' : ''}" data-diff="${d}" onclick="setDiffFilter(this, '${d}')">
        ${d === 'all' ? 'Tout' : d}
      </button>`).join('');
  }

  const statusPillsEl = document.getElementById('statusPills');
  if (statusPillsEl) {
    statusPillsEl.innerHTML = `
      <button class="filter-pill active" data-status="all" onclick="setStatusFilter(this, 'all')">Tout</button>
      <button class="filter-pill" data-status="available" onclick="setStatusFilter(this, 'available')">Disponibles</button>
      <button class="filter-pill" data-status="pending" onclick="setStatusFilter(this, 'pending')">En attente</button>
      <button class="filter-pill" data-status="validated" onclick="setStatusFilter(this, 'validated')">Validées</button>
    `;
  }

  const searchEl = document.getElementById('questSearch');
  if (searchEl) {
    searchEl.addEventListener('input', e => {
      _searchQuery = e.target.value.trim();
      _applyFiltersAndRender();
    });
  }
}

function setDiffFilter(el, diff) {
  document.querySelectorAll('[data-diff]').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  _filterDiff = diff;
  _applyFiltersAndRender();
}

function setStatusFilter(el, status) {
  document.querySelectorAll('[data-status]').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  _filterStatus = status;
  _applyFiltersAndRender();
}

function logout() {
  Storage.clearCurrentPlayer();
  window.location.href = 'login.html';
}

// ——————————————————————————————————————————
//  PAGE : ADMIN
// ——————————————————————————————————————————

let _adminQuests = [];
let _adminAllProgress = {};

async function initAdminPage() {
  // Vérif mot de passe
  const stored = sessionStorage.getItem('mc_admin_auth');
  if (!stored) {
    showAdminLogin();
    return;
  }
  await loadAdminDashboard();
}

function showAdminLogin() {
  const overlay = document.getElementById('adminLoginOverlay');
  if (overlay) overlay.classList.add('show');
}

async function submitAdminLogin() {
  const input = document.getElementById('adminPasswordInput');
  const err   = document.getElementById('adminLoginError');
  if (!input) return;

  const password = input.value;
  const expected = (typeof CONFIG !== 'undefined') ? CONFIG.adminPassword : 'admin1234';

  if (password === expected) {
    sessionStorage.setItem('mc_admin_auth', 'true');
    document.getElementById('adminLoginOverlay')?.classList.remove('show');
    await loadAdminDashboard();
    UI.toast('Bienvenue, Admin !', 'success');
  } else {
    if (err) {
      err.textContent = 'Mot de passe incorrect.';
      err.classList.add('show');
    }
    input.value = '';
    input.focus();
  }
}

async function loadAdminDashboard() {
  _adminQuests = await QuestAPI.loadQuests();

  if (NodeServer.enabled) {
    const remote = await NodeServer.read();
    if (remote?.progress) Storage.saveAllProgress(remote.progress);
    if (remote?.players)  localStorage.setItem('mc_known_players', JSON.stringify(remote.players));
  } else {
    const remote = await JsonBin.read();
    if (remote?.progress) Storage.saveAllProgress(remote.progress);
  }
  _adminAllProgress = Storage.getAllProgress();

  renderAdminStats();
  renderValidationPanel();
  renderQuestsTable();
  renderPlayersTable();
}

function renderAdminStats() {
  const players = Storage.getKnownPlayers();
  const pendingCount = Object.values(_adminAllProgress)
    .flatMap(p => Object.values(p))
    .filter(s => s.status === 'pending').length;
  const validatedCount = Object.values(_adminAllProgress)
    .flatMap(p => Object.values(p))
    .filter(s => s.status === 'validated').length;

  const el = document.getElementById('adminStats');
  if (!el) return;

  el.innerHTML = `
    <div class="stat-card blue">
      <span class="stat-card-value">${_adminQuests.filter(q=>q.active).length}</span>
      <span class="stat-card-label">Quêtes actives</span>
    </div>
    <div class="stat-card green">
      <span class="stat-card-value">${players.length}</span>
      <span class="stat-card-label">Joueurs inscrits</span>
    </div>
    <div class="stat-card gold">
      <span class="stat-card-value">${pendingCount}</span>
      <span class="stat-card-label">En attente validation</span>
    </div>
    <div class="stat-card red">
      <span class="stat-card-value">${validatedCount}</span>
      <span class="stat-card-label">Quêtes validées</span>
    </div>
  `;
}

function renderValidationPanel() {
  const el = document.getElementById('validationPanel');
  if (!el) return;

  const pending = [];
  Object.entries(_adminAllProgress).forEach(([player, quests]) => {
    Object.entries(quests).forEach(([questId, state]) => {
      if (state.status === 'pending') {
        const quest = _adminQuests.find(q => q.id === questId);
        if (quest) pending.push({ player, quest, state });
      }
    });
  });

  if (!pending.length) {
    el.innerHTML = `<div class="empty-state"><span class="empty-state-icon">✅</span><div class="empty-state-text">Aucune validation en attente !</div></div>`;
    return;
  }

  el.innerHTML = pending.map(({ player, quest, state }) => `
    <div class="validation-item" id="val-${player}-${quest.id}">
      <img class="validation-item-avatar"
        src="${UI.getAvatarUrl(player, 40)}"
        alt="${player}" onerror="this.src='https://crafatar.com/avatars/MHF_Steve?size=40'">
      <div class="validation-item-info">
        <div class="validation-player-name">${player}</div>
        <div class="validation-quest-name">${quest.reward_icon} ${quest.title}</div>
        <div style="font-size:0.7rem;color:var(--text-dim);margin-top:0.2rem">
          Demandé le ${UI.formatDate(state.requestedAt)}
        </div>
      </div>
      <div class="validation-actions">
        <button class="btn btn-success btn-sm"
          onclick="validateQuest('${player}', '${quest.id}')">✓ Valider</button>
        <button class="btn btn-danger btn-sm"
          onclick="rejectQuest('${player}', '${quest.id}')">✗ Refuser</button>
      </div>
    </div>
  `).join('');
}

async function validateQuest(playerName, questId) {
  const btn = document.querySelector(`#val-${playerName}-${questId} .btn-success`);
  if (btn) UI.setLoading(btn, true);

  Storage.updatePlayerProgress(playerName, questId, {
    status: 'validated',
    validatedAt: new Date().toISOString()
  });

  _adminAllProgress = Storage.getAllProgress();
  await QuestAPI.saveProgress(_adminAllProgress);

  const quest = _adminQuests.find(q => q.id === questId);
  UI.toast(`✓ Quête "${quest?.title}" validée pour ${playerName} !`, 'success');

  // Refresh
  document.getElementById(`val-${playerName}-${questId}`)?.remove();
  renderAdminStats();
  renderPlayersTable();
}

async function rejectQuest(playerName, questId) {
  Storage.updatePlayerProgress(playerName, questId, {
    status: 'available'
  });

  _adminAllProgress = Storage.getAllProgress();
  await QuestAPI.saveProgress(_adminAllProgress);

  UI.toast(`Demande de ${playerName} refusée. La quête redevient disponible.`, 'warning');

  document.getElementById(`val-${playerName}-${questId}`)?.remove();
  renderAdminStats();
}

function renderQuestsTable() {
  const el = document.getElementById('questsTable');
  if (!el) return;

  el.innerHTML = `
    <table class="data-table">
      <thead>
        <tr>
          <th>Quête</th><th>Difficulté</th><th>Récompense</th><th>XP</th><th>Statut</th><th>Actions</th>
        </tr>
      </thead>
      <tbody>
        ${_adminQuests.map(q => `
          <tr>
            <td style="font-weight:600">${q.reward_icon} ${q.title}</td>
            <td><span class="quest-difficulty ${UI.getDiffClass(q.difficulty)}">${q.difficulty}</span></td>
            <td>${q.reward_item}</td>
            <td style="color:var(--accent)">${q.xp} XP</td>
            <td>${q.active
              ? '<span style="color:var(--green)">● Active</span>'
              : '<span style="color:var(--text-dim)">● Inactive</span>'}</td>
            <td>
              <button class="btn btn-ghost btn-sm" onclick="toggleQuestActive('${q.id}')">
                ${q.active ? 'Désactiver' : 'Activer'}
              </button>
              <button class="btn btn-danger btn-sm" onclick="deleteQuest('${q.id}')" style="margin-left:0.25rem">
                Supprimer
              </button>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function renderPlayersTable() {
  const el = document.getElementById('playersTable');
  if (!el) return;
  const players = Storage.getKnownPlayers();

  if (!players.length) {
    el.innerHTML = `<div class="empty-state"><span class="empty-state-icon">👤</span><div class="empty-state-text">Aucun joueur inscrit.</div></div>`;
    return;
  }

  el.innerHTML = `
    <table class="data-table">
      <thead>
        <tr><th>Joueur</th><th>Quêtes validées</th><th>En attente</th><th>XP total</th></tr>
      </thead>
      <tbody>
        ${players.map(name => {
          const prog = _adminAllProgress[name] || {};
          const validated = Object.values(prog).filter(p => p.status === 'validated').length;
          const pending   = Object.values(prog).filter(p => p.status === 'pending').length;
          const xp = _adminQuests
            .filter(q => prog[q.id]?.status === 'validated')
            .reduce((sum, q) => sum + (q.xp || 0), 0);
          return `
            <tr>
              <td style="display:flex;align-items:center;gap:0.5rem">
                <img src="${UI.getAvatarUrl(name, 24)}" style="width:24px;height:24px;border-radius:2px;image-rendering:pixelated"
                  onerror="this.src='https://crafatar.com/avatars/MHF_Steve?size=24'">
                <strong>${name}</strong>
              </td>
              <td style="color:var(--green)">${validated}</td>
              <td style="color:var(--gold)">${pending}</td>
              <td style="color:var(--accent)">${xp} XP</td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
  `;
}

// ——— GESTION DES QUÊTES ADMIN ———

async function toggleQuestActive(questId) {
  const quest = _adminQuests.find(q => q.id === questId);
  if (!quest) return;
  quest.active = !quest.active;
  await QuestAPI.saveQuests(_adminQuests);
  renderQuestsTable();
  renderAdminStats();
  UI.toast(`Quête "${quest.title}" ${quest.active ? 'activée' : 'désactivée'}.`, 'info');
}

async function deleteQuest(questId) {
  if (!confirm('Supprimer cette quête ? Cette action est irréversible.')) return;
  _adminQuests = _adminQuests.filter(q => q.id !== questId);
  await QuestAPI.saveQuests(_adminQuests);
  renderQuestsTable();
  renderAdminStats();
  UI.toast('Quête supprimée.', 'warning');
}

async function addQuestFromForm() {
  const title   = document.getElementById('newQuestTitle')?.value.trim();
  const desc    = document.getElementById('newQuestDesc')?.value.trim();
  const reward  = document.getElementById('newQuestReward')?.value.trim();
  const icon    = document.getElementById('newQuestIcon')?.value.trim() || '⭐';
  const diff    = document.getElementById('newQuestDiff')?.value;
  const xp      = parseInt(document.getElementById('newQuestXP')?.value) || 100;

  if (!title || !desc || !reward) {
    UI.toast('Remplis tous les champs obligatoires.', 'error');
    return;
  }

  const newQuest = {
    id: 'q_' + Date.now(),
    title, description: desc, reward_item: reward,
    reward_icon: icon, difficulty: diff, xp, active: true
  };

  _adminQuests.push(newQuest);
  await QuestAPI.saveQuests(_adminQuests);

  renderQuestsTable();
  renderAdminStats();

  // Reset form
  ['newQuestTitle','newQuestDesc','newQuestReward','newQuestIcon','newQuestXP'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });

  UI.toast(`Quête "${title}" ajoutée avec succès !`, 'success');
  showAdminTab('validation');
}

// ——— TABS ADMIN ———

function showAdminTab(tabId) {
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));

  document.getElementById(`tab-${tabId}`)?.classList.add('active');
  document.querySelector(`[data-tab="${tabId}"]`)?.classList.add('active');
}

// ——————————————————————————————————————————
//  AUTO-INIT selon la page courante
// ——————————————————————————————————————————

document.addEventListener('DOMContentLoaded', () => {
  const page = document.body.dataset.page;

  if (page === 'login') initLoginPage();
  else if (page === 'index') initIndexPage();
  else if (page === 'admin') initAdminPage();

  // Enter sur le formulaire admin login
  document.getElementById('adminPasswordInput')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') submitAdminLogin();
  });
});
