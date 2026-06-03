// ══════════════════════════════════════════════
// HUNTIFY — ADVERTISERS.JS
// Fichier centralisé des annonceurs affiliés
// Ajoute un annonceur ici → tout le site se met à jour
// ══════════════════════════════════════════════

const ADVERTISERS = {

  // ── AMAZON ────────────────────────────────
  amazon: {
    name: "Amazon",
    tag: "huntify21-21",
    active: true,
    categories: ["Mode", "Santé", "Électronique", "Maison"],
    color: "linear-gradient(135deg,#ff9900,#ff6600)",
    emoji: "🛒",
    buildLink: (keywords) =>
      `https://www.amazon.fr/s?k=${encodeURIComponent(keywords)}&tag=huntify21-21`,
    buildDirectLink: (url) =>
      `${url}${url.includes('?')?'&':'?'}tag=huntify21-21`,
  },

  // ── RAKUTEN via AWIN ──────────────────────
  rakuten: {
    name: "Rakuten",
    awinMid: "55615",
    awinAff: "2920215",
    active: true,
    categories: ["Mode", "Électronique", "Maison"],
    color: "linear-gradient(135deg,#bf0000,#e00)",
    emoji: "🛍️",
    buildLink: (keywords) => {
      const dest = `https://fr.shopping.rakuten.com/search?keyword=${encodeURIComponent(keywords)}`;
      return `https://www.awin1.com/cread.php?awinmid=55615&awinaffid=2920215&ued=${encodeURIComponent(dest)}`;
    },
    buildDirectLink: (url) => {
      return `https://www.awin1.com/cread.php?awinmid=55615&awinaffid=2920215&ued=${encodeURIComponent(url)}`;
    },
  },

  // ── FNAC via AWIN — à activer quand validé ─
  fnac: {
    name: "Fnac",
    awinMid: null, // ← Remplace par ton mid Awin quand validé
    awinAff: "2920215",
    active: false, // ← Passe à true quand validé
    categories: ["Électronique"],
    color: "linear-gradient(135deg,#e1a800,#c49200)",
    emoji: "📦",
    buildLink: (keywords) => {
      const dest = `https://www.fnac.com/SearchResult/ResultList.aspx?Search=${encodeURIComponent(keywords)}`;
      return `https://www.awin1.com/cread.php?awinmid=${null}&awinaffid=2920215&ued=${encodeURIComponent(dest)}`;
    },
  },

  // ── CDISCOUNT via AWIN — à activer quand validé
  cdiscount: {
    name: "Cdiscount",
    awinMid: null,
    awinAff: "2920215",
    active: false,
    categories: ["Électronique", "Maison"],
    color: "linear-gradient(135deg,#e31010,#b00)",
    emoji: "🏷️",
    buildLink: (keywords) => {
      const dest = `https://www.cdiscount.com/search/10/${encodeURIComponent(keywords)}.html`;
      return `https://www.awin1.com/cread.php?awinmid=${null}&awinaffid=2920215&ued=${encodeURIComponent(dest)}`;
    },
  },

  // ── ZALANDO via AWIN — à activer quand validé
  zalando: {
    name: "Zalando",
    awinMid: null,
    awinAff: "2920215",
    active: false,
    categories: ["Mode"],
    color: "linear-gradient(135deg,#ff6900,#e55a00)",
    emoji: "👟",
    buildLink: (keywords) => {
      const dest = `https://www.zalando.fr/cataloguepage/?q=${encodeURIComponent(keywords)}`;
      return `https://www.awin1.com/cread.php?awinmid=${null}&awinaffid=2920215&ued=${encodeURIComponent(dest)}`;
    },
  },

  // ── DECATHLON via AWIN — à activer quand validé
  decathlon: {
    name: "Decathlon",
    awinMid: null,
    awinAff: "2920215",
    active: false,
    categories: ["Mode", "Santé"],
    color: "linear-gradient(135deg,#0082c3,#005f8e)",
    emoji: "🏋️",
    buildLink: (keywords) => {
      const dest = `https://www.decathlon.fr/search?Ntt=${encodeURIComponent(keywords)}`;
      return `https://www.awin1.com/cread.php?awinmid=${null}&awinaffid=2920215&ued=${encodeURIComponent(dest)}`;
    },
  },

  // ── DARTY via AWIN — à activer quand validé
  darty: {
    name: "Darty",
    awinMid: null,
    awinAff: "2920215",
    active: false,
    categories: ["Électronique", "Maison"],
    color: "linear-gradient(135deg,#e20020,#b0001a)",
    emoji: "🔌",
    buildLink: (keywords) => {
      const dest = `https://www.darty.com/nav/recherche?text=${encodeURIComponent(keywords)}`;
      return `https://www.awin1.com/cread.php?awinmid=${null}&awinaffid=2920215&ued=${encodeURIComponent(dest)}`;
    },
  },

};

// ── HELPERS ───────────────────────────────────

// Récupère tous les annonceurs actifs
function getActiveAdvertisers() {
  return Object.values(ADVERTISERS).filter(a => a.active);
}

// Récupère les annonceurs actifs pour une catégorie
function getAdvertisersByCategory(category) {
  return getActiveAdvertisers().filter(a =>
    a.categories.includes(category) || a.categories.includes('Tous')
  );
}

// Génère le contexte annonceurs pour l'agent IA
function getAgentContext() {
  const active = getActiveAdvertisers();
  return `Boutiques disponibles sur Huntify : ${active.map(a => a.name).join(', ')}.
Recherche les produits sur ces boutiques uniquement.
Pour chaque produit trouvé, indique le store avec exactement ce nom : ${active.map(a => `"${a.name.toLowerCase()}"`).join(' ou ')}.`;
}

// Génère un lien affilié à partir du nom du store
function buildAffiliateLink(storeName, keywords, directUrl = null) {
  const key = storeName.toLowerCase();
  const advertiser = ADVERTISERS[key];
  if (!advertiser || !advertiser.active) return null;
  if (directUrl && advertiser.buildDirectLink) return advertiser.buildDirectLink(directUrl);
  return advertiser.buildLink(keywords);
}
