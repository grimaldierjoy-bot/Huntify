// ─────────────────────────────────────────────────────────────────────────────
// HUNTIFY — api/_lib/shared.js
// Helpers centralisés : Supabase, liens affiliation, parsing, météo, DB.
// Fichier SANS export default → Vercel ne le traite PAS comme un endpoint
// public. Placé dans /api/_lib/ (préfixe _ = exclu du routing Vercel).
// Importé uniquement par chat.js, travel.js et orchestrator.js.
// ─────────────────────────────────────────────────────────────────────────────

export const SUPABASE_URL = "https://enocxbrqyybendertytl.supabase.co";
export const SUPABASE_KEY = "sb_publishable_NmPh--frZG5HuqfaoxnemA_E7cidV9Y";
export const AMAZON_TAG     = "huntify21-21";
export const AWIN_PUB       = "2920215";       // ID affilié Awin — commun à tous les programmes Awin
export const RAKUTEN_MID    = "55615";
export const ALIEXPRESS_MID = "REMPLACE_PAR_TON_AWINMID_ALIEXPRESS"; // dashboard Awin > Programmes > AliExpress
export const EUROPCAR_MID   = "7418";
export const MAX_QUESTIONS  = 2; // plafond anti-boucle, commun chat + voyage

// ── FETCH AVEC TIMEOUT (garde-fou : jamais un appel lent ne bloque tout) ──────
export async function fetchT(url, opts, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms || 8000);
  try {
    const r = await fetch(url, { ...opts, signal: ctrl.signal });
    clearTimeout(timer);
    return r;
  } catch (e) {
    clearTimeout(timer);
    throw e;
  }
}

// ── SUPABASE ──────────────────────────────────────────────────────────────────
export async function sb(path, method, body) {
  const h = { "Content-Type": "application/json", "apikey": SUPABASE_KEY, "Authorization": "Bearer " + SUPABASE_KEY };
  const opts = { method: method || "GET", headers: h };
  if (body) opts.body = JSON.stringify(body);
  try {
    const r = await fetchT(SUPABASE_URL + "/rest/v1/" + path, opts, 6000);
    return await r.json();
  } catch (e) { return null; }
}

export async function getAds() {
  try {
    const r = await fetchT(SUPABASE_URL + "/rest/v1/advertisers?active=eq.true", {
      headers: { "apikey": SUPABASE_KEY, "Authorization": "Bearer " + SUPABASE_KEY }
    }, 6000);
    const d = await r.json();
    return Array.isArray(d) ? d : [];
  } catch (e) { return []; }
}

export async function dbLookup(kw) {
  const k = (kw || "").toLowerCase().split(" ")[0];
  try {
    const [deals, prices, promos] = await Promise.all([
      sb("daily_deals?name=ilike.*" + encodeURIComponent(k) + "*&limit=3"),
      sb("price_history?product_name=ilike.*" + encodeURIComponent(k) + "*&order=checked_at.desc&limit=5"),
      sb("promo_codes?valid=eq.true&order=found_at.desc&limit=2")
    ]);
    const parts = [];
    if (deals && deals.length) parts.push("Deals: " + deals.map(x => x.name + " " + x.price + "EUR").join(" | "));
    if (prices && prices.length) parts.push("Prix: " + prices.map(x => x.product_name + " " + x.price + "EUR").join(" | "));
    if (promos && promos.length) parts.push("Codes: " + promos.map(x => x.code + " (" + x.store + ")").join(" | "));
    return parts.join("\n");
  } catch (e) { return ""; }
}

// ── PARSING JSON ROBUSTE ───────────────────────────────────────────────────────
export function parseJSON(raw) {
  if (!raw) return {};
  try { const m = raw.match(/```(?:json)?\s*([\s\S]*?)```/); if (m) return JSON.parse(m[1].trim()); } catch (e) {}
  try { const m = raw.match(/\{[\s\S]*\}/); if (m) return JSON.parse(m[0]); } catch (e) {}
  return {};
}

// ── HISTORIQUE / CONTEXTE CONVERSATION ────────────────────────────────────────
export function buildHist(history) {
  return ((history || []).map(m => {
    const who = m.role === "user" ? "Client" : "Huntify";
    const txt = (m.content || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 300);
    return txt ? who + ": " + txt : null;
  }).filter(Boolean).join("\n")).slice(0, 2000);
}

export function countQ(history) {
  return (history || []).filter(m => m.role !== "user" && (m.content || "").length > 10 && (m.content || "").length < 300).length;
}

export function detectBudget(text) {
  if (!text) return null;
  const ps = [/(?:moins de|maxi|budget|environ|max)[^\d]*(\d+)\s*(?:€|euros?)/i, /(\d+)\s*(?:€|euros?)/i, /budget[^\d]*(\d+)/i];
  for (const r of ps) { const m = text.match(r); if (m) { const b = parseInt(m[1]); if (b > 0 && b < 100000) return b; } }
  return null;
}

export function cleanKw(kw) {
  if (!kw) return "";
  const stop = new Set(["la","le","les","un","une","des","avec","et","en","du","au","aux","pour","sur","dans","pas","cher","je","veux","cherche"]);
  return kw.replace(/,/g, " ").replace(/\s+/g, " ").trim()
    .split(" ").filter(w => w.length > 1 && !stop.has(w.toLowerCase())).slice(0, 7).join(" ");
}

// ── VALIDATION STRICTE DES URLS PRODUIT (garde-fou anti-lien-cassé) ───────────
// Une IA peut halluciner une URL. Le code ne fait JAMAIS confiance à une URL
// telle quelle : soit elle passe cette regex stricte, soit elle est écartée
// au profit d'un lien de recherche fiable basé sur le nom exact du produit.
export function validAmazonUrl(url) {
  const m = (url || "").match(/amazon\.fr\/(?:[^\/]+\/)?dp\/([A-Z0-9]{10})(?:[\/?]|$)/);
  return (m && /^B[A-Z0-9]{9}$/.test(m[1])) ? m[1] : null;
}
export function validRakutenUrl(url) {
  return !!(url && url.includes("rakuten.com") && /\/(mfp|m)\/\d+/.test(url) && !url.includes("/s/"));
}
export function validAliExpressUrl(url) {
  return !!(url && /aliexpress\.com\/item\/\d{10,}\.html/.test(url));
}
export function anyVerified(url) {
  return !!(validAmazonUrl(url) || validRakutenUrl(url) || validAliExpressUrl(url));
}

export function buildLink(adv, keywords, directUrl) {
  if (!adv || !adv.active) return null;
  const kw = cleanKw(keywords);

  if (adv.slug === "amazon") {
    const tag = adv.amazon_tag || AMAZON_TAG;
    const asin = validAmazonUrl(directUrl);
    if (asin) return "https://www.amazon.fr/dp/" + asin + "?tag=" + tag;
    return "https://www.amazon.fr/s?k=" + encodeURIComponent(kw) + "&tag=" + tag;
  }

  if (adv.slug === "rakuten") {
    const mid = adv.awin_mid || RAKUTEN_MID;
    const aff = adv.awin_affid || adv.awin_aff || AWIN_PUB;
    const dest = validRakutenUrl(directUrl)
      ? directUrl.split("?")[0]
      : "https://fr.shopping.rakuten.com/s/" + encodeURIComponent(kw.replace(/\s+/g, "+"));
    return "https://www.awin1.com/cread.php?awinmid=" + mid + "&awinaffid=" + aff + "&clickref=huntify&ued=" + encodeURIComponent(dest);
  }

  if (adv.slug === "aliexpress") {
    const mid = adv.awin_mid || ALIEXPRESS_MID;
    const aff = adv.awin_affid || adv.awin_aff || AWIN_PUB;
    const dest = validAliExpressUrl(directUrl)
      ? directUrl.split("?")[0]
      : "https://fr.aliexpress.com/wholesale?SearchText=" + encodeURIComponent(kw);
    return "https://www.awin1.com/cread.php?awinmid=" + mid + "&awinaffid=" + aff + "&clickref=huntify&ued=" + encodeURIComponent(dest);
  }

  if (adv.awin_mid) {
    const aff = adv.awin_affid || adv.awin_aff || AWIN_PUB;
    const dest = (adv.search_url || "https://www." + adv.slug + ".fr/search?q={kw}").replace("{kw}", encodeURIComponent(kw));
    return "https://www.awin1.com/cread.php?awinmid=" + adv.awin_mid + "&awinaffid=" + aff + "&ued=" + encodeURIComponent(dest);
  }
  return null;
}

export function findAdv(ads, slug) { return (ads || []).find(a => a.slug === (slug || "").toLowerCase()) || null; }

export function defaultAdv(slug) {
  if (slug === "amazon")     return { slug: "amazon", name: "Amazon", emoji: "🛒", color: "#e47911", active: true };
  if (slug === "rakuten")    return { slug: "rakuten", name: "Rakuten", emoji: "🛍", color: "#bf0000", active: true, awin_mid: RAKUTEN_MID };
  if (slug === "aliexpress") return { slug: "aliexpress", name: "AliExpress", emoji: "📦", color: "#e62e04", active: true, awin_mid: ALIEXPRESS_MID };
  return null;
}

export function getCross(recap) {
  const r = (recap || "").toLowerCase();
  const map = {
    "casque": ["housse transport casque", "coussinets rechange"],
    "telephone": ["coque protection", "verre trempe"],
    "laptop": ["housse laptop", "souris sans fil"],
    "sneakers": ["semelles confort", "spray impermeabilisant"],
    "parfum": ["coffret miniatures", "atomiseur voyage"],
    "masque": ["palmes", "tuba", "sac etanche"],
    "snorkeling": ["palmes reglables", "sac etanche"]
  };
  for (const [k, v] of Object.entries(map)) if (r.includes(k)) return v;
  return [];
}

// ── MÉTÉO (API gratuite Open-Meteo, aucune clé requise — coût zéro) ───────────
// Utilisée par travel.js pour enrichir l'itinéraire. Géocode la ville puis
// récupère la prévision. Renvoie null si indisponible (ville trop obscure,
// date hors plage de prévision ~16 jours) — jamais bloquant.
export async function getWeather(cityName, dateStr) {
  if (!cityName) return null;
  try {
    const geoR = await fetchT("https://geocoding-api.open-meteo.com/v1/search?name=" + encodeURIComponent(cityName) + "&count=1&language=fr", {}, 5000);
    const geo = await geoR.json();
    const loc = geo && geo.results && geo.results[0];
    if (!loc) return null;

    const fR = await fetchT("https://api.open-meteo.com/v1/forecast?latitude=" + loc.latitude + "&longitude=" + loc.longitude
      + "&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weathercode&timezone=auto", {}, 5000);
    const f = await fR.json();
    if (!f || !f.daily) return null;

    let idx = 0;
    if (dateStr && f.daily.time) {
      const i = f.daily.time.indexOf(dateStr);
      if (i === -1) return null; // date hors plage de prévision dispo
      idx = i;
    }
    const code = f.daily.weathercode[idx];
    const icon = weatherIcon(code);
    return {
      tempMax: Math.round(f.daily.temperature_2m_max[idx]),
      tempMin: Math.round(f.daily.temperature_2m_min[idx]),
      rainPct: f.daily.precipitation_probability_max[idx],
      icon
    };
  } catch (e) { return null; }
}

function weatherIcon(code) {
  if (code === 0) return "☀️";
  if (code <= 2) return "🌤️";
  if (code === 3) return "☁️";
  if (code >= 51 && code <= 67) return "🌧️";
  if (code >= 71 && code <= 77) return "❄️";
  if (code >= 80 && code <= 82) return "🌦️";
  if (code >= 95) return "⛈️";
  return "🌡️";
}
