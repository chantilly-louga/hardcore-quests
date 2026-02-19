// ============================================================
//  CONFIG.JS — Configuration Replit
// ============================================================

const CONFIG = {

  // --- IDENTITÉ DU SERVEUR ---
  serverName: "Hardcore Survival",
  serverSeason: "Saison 1",

  // --- MOT DE PASSE ADMIN ---
  // ⚠️ Change ça avant d'inviter des joueurs !
  adminPassword: "admin1234",

  // --- SERVEUR NODE.JS (Replit) ---
  // baseUrl vide = même domaine que la page (fonctionne sur Replit automatiquement)
  nodeServer: {
    enabled: true,
    baseUrl: "" // Laisser vide sur Replit
  },

  // --- JSONBIN (désactivé, remplacé par Node.js) ---
  jsonbin: {
    enabled: false,
    binId: "",
    apiKey: ""
  },

  githubRawBase: "",

};
