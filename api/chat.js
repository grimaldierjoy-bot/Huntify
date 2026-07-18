export const config = { runtime: 'edge' };

// ─────────────────────────────────────────────────────────────────────────────
// HUNTIFY — /api/chat.js — Comparateur Produit (Amazon + Rakuten + AliExpress)
// FICHIER 100% AUTONOME — aucun import relatif.
//
// IMPORTANT : ce projet Vercel (Edge Functions "brutes", sans Next.js) ne
// supporte pas les imports entre fichiers /api (ex: `import ... from './_lib/x.js'`).
// Chaque endpoint doit être self-contained, exactement comme cron-alerts.js.
// La logique "MEGA IA" (cascade gratuite → Claude en dernier recours) reste
// identique à l'architecture orchestrateur — simplement dupliquée ici plutôt
// que partagée via un module externe.
//
// PIPELINE :
//   1. DÉCISION  → IA gratuites (Groq 70b → Gemini → Mistral → DeepSeek)
//   2. RECHERCHE → Groq compound-beta (GRATUIT, recherche web réelle)
//   3. SECOURS   → Claude — UNIQUEMENT si (2) n'a rien donné d'exploitable
//                  ou aucune URL vérifiée. Tokens plafonnés (600 max).
// ─────────────────────────────────────────────────────────────────────────────

const SUPABASE_URL = "https://enocxbrqyybendertytl.supabase.co";
const SUPABASE_KEY = "sb_publishable_NmPh--frZG5HuqfaoxnemA_E7cidV9Y";
const CLAUDE_MODEL   = "claude-haiku-4-5";
const AMAZON_TAG     = "huntify21-21";
const AWIN_PUB       = "2920215";
const RAKUTEN_MID    = "55615";
const ALIEXPRESS_MID = "REMPLACE_PAR_TON_AWINMID_ALIEXPRESS"; // dashboard Awin > Programmes > AliExpress
const MAX_QUESTIONS  = 2;
const CLAUDE_HARD_CAP = 900;

// ── FETCH AVEC TIMEOUT ────────────────────────────────────────────────────────
async function fetchT(url, opts, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms || 8000);
  try { const r = await fetch(url, { ...opts, signal: ctrl.signal }); clearTimeout(timer); return r; }
  catch (e) { clearTimeout(timer); throw e; }
}

// ── SUPABASE ──────────────────────────────────────────────────────────────────
async function sb(path, method, body) {
  const h = { "Content-Type": "application/json", "apikey": SUPABASE_KEY, "Authorization": "Bearer " + SUPABASE_KEY };
  const opts = { method: method || "GET", headers: h };
  if (body) opts.body = JSON.stringify(body);
  try { const r = await fetchT(SUPABASE_URL + "/rest/v1/" + path, opts, 6000); return await r.json(); } catch (e) { return null; }
}

async function getAds() {
  try {
    const r = await fetchT(SUPABASE_URL + "/rest/v1/advertisers?active=eq.true", {
      headers: { "apikey": SUPABASE_KEY, "Authorization": "Bearer " + SUPABASE_KEY }
    }, 6000);
    const d = await r.json();
    return Array.isArray(d) ? d : [];
  } catch (e) { return []; }
}

async function dbLookup(kw) {
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

// ── PARSING / UTILS ────────────────────────────────────────────────────────────
function parseJSON(raw) {
  if (!raw) return {};
  try { const m = raw.match(/```(?:json)?\s*([\s\S]*?)```/); if (m) return JSON.parse(m[1].trim()); } catch (e) {}
  try { const m = raw.match(/\{[\s\S]*\}/); if (m) return JSON.parse(m[0]); } catch (e) {}
  return {};
}

function buildHist(history) {
  return ((history || []).map(m => {
    const who = m.role === "user" ? "Client" : "Huntify";
    const txt = (m.content || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 300);
    return txt ? who + ": " + txt : null;
  }).filter(Boolean).join("\n")).slice(0, 2000);
}

function countQ(history) { return (history || []).filter(m => m.role !== "user" && (m.content || "").length > 20 && (m.content || "").length < 300).length; }

function detectBudget(text) {
  if (!text) return null;
  const ps = [/(?:moins de|maxi|budget|environ|max)[^\d]*(\d+)\s*(?:€|euros?)/i, /(\d+)\s*(?:€|euros?)/i, /budget[^\d]*(\d+)/i];
  for (const r of ps) { const m = text.match(r); if (m) { const b = parseInt(m[1]); if (b > 0 && b < 100000) return b; } }
  return null;
}

function cleanKw(kw) {
  if (!kw) return "";
  const stop = new Set(["la","le","les","un","une","des","avec","et","en","du","au","aux","pour","sur","dans","pas","cher","je","veux","cherche"]);
  return kw.replace(/,/g, " ").replace(/\s+/g, " ").trim()
    .split(" ").filter(w => w.length > 1 && !stop.has(w.toLowerCase())).slice(0, 7).join(" ");
}

function looksLikeTravel(text) {
  const t = (text || "").toLowerCase();
  return /(voyage|vacances|s[ée]jour|weekend|week-end|h[ôo]tel.*vol|vol.*h[ôo]tel|partir en|itin[ée]raire|billet d avion)/.test(t);
}

function usableProducts(products) {
  return (products || []).filter(p => {
    const n = (p && p.name || "").trim();
    return n.length >= 8 && n.split(/\s+/).length >= 2;
  });
}

// ── VALIDATION STRICTE DES URLS (garde-fou anti-lien-cassé) ───────────────────
function validAmazonUrl(url) {
  const m = (url || "").match(/amazon\.fr\/(?:[^\/]+\/)?dp\/([A-Z0-9]{10})(?:[\/?]|$)/);
  return (m && /^B[A-Z0-9]{9}$/.test(m[1])) ? m[1] : null;
}
function validRakutenUrl(url) { return !!(url && url.includes("rakuten.com") && /\/(mfp|m)\/\d+/.test(url) && !url.includes("/s/")); }
function validAliExpressUrl(url) { return !!(url && /aliexpress\.com\/item\/\d{10,}\.html/.test(url)); }

function buildLink(adv, keywords, directUrl) {
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
    const dest = validRakutenUrl(directUrl) ? directUrl.split("?")[0] : "https://fr.shopping.rakuten.com/s/" + encodeURIComponent(kw.replace(/\s+/g, "+"));
    return "https://www.awin1.com/cread.php?awinmid=" + mid + "&awinaffid=" + aff + "&clickref=huntify&ued=" + encodeURIComponent(dest);
  }
  if (adv.slug === "aliexpress") {
    const mid = adv.awin_mid || ALIEXPRESS_MID;
    const aff = adv.awin_affid || adv.awin_aff || AWIN_PUB;
    const dest = validAliExpressUrl(directUrl) ? directUrl.split("?")[0] : "https://fr.aliexpress.com/wholesale?SearchText=" + encodeURIComponent(kw);
    return "https://www.awin1.com/cread.php?awinmid=" + mid + "&awinaffid=" + aff + "&clickref=huntify&ued=" + encodeURIComponent(dest);
  }
  if (adv.awin_mid) {
    const aff = adv.awin_affid || adv.awin_aff || AWIN_PUB;
    const dest = (adv.search_url || "https://www." + adv.slug + ".fr/search?q={kw}").replace("{kw}", encodeURIComponent(kw));
    return "https://www.awin1.com/cread.php?awinmid=" + adv.awin_mid + "&awinaffid=" + aff + "&ued=" + encodeURIComponent(dest);
  }
  return null;
}

function findAdv(ads, slug) { return (ads || []).find(a => a.slug === (slug || "").toLowerCase()) || null; }

function defaultAdv(slug) {
  if (slug === "amazon")     return { slug: "amazon", name: "Amazon", emoji: "🛒", color: "#e47911", active: true };
  if (slug === "rakuten")    return { slug: "rakuten", name: "Rakuten", emoji: "🛍", color: "#bf0000", active: true, awin_mid: RAKUTEN_MID };
  if (slug === "aliexpress") return { slug: "aliexpress", name: "AliExpress", emoji: "📦", color: "#e62e04", active: true, awin_mid: ALIEXPRESS_MID };
  return null;
}

function getCross(recap) {
  const r = (recap || "").toLowerCase();
  const map = {
    "casque": ["housse transport casque", "coussinets rechange"], "telephone": ["coque protection", "verre trempe"],
    "laptop": ["housse laptop", "souris sans fil"], "sneakers": ["semelles confort", "spray impermeabilisant"],
    "parfum": ["coffret miniatures", "atomiseur voyage"], "masque": ["palmes", "tuba", "sac etanche"],
    "snorkeling": ["palmes reglables", "sac etanche"]
  };
  for (const [k, v] of Object.entries(map)) if (r.includes(k)) return v;
  return [];
}

// ── MODÈLES IA — cascade gratuite d'abord, Claude en dernier recours ─────────
async function groq(sys, user, maxTok) {
  const key = process.env.GROQ_API_KEY; if (!key) return null;
  try {
    const r = await fetchT("https://api.groq.com/openai/v1/chat/completions", { method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + key },
      body: JSON.stringify({ model: "llama-3.3-70b-versatile", max_tokens: maxTok || 500, messages: [{ role: "system", content: sys }, { role: "user", content: user }] }) }, 7000);
    if (!r.ok) return null; const d = await r.json(); return d.choices && d.choices[0] ? d.choices[0].message.content : null;
  } catch (e) { return null; }
}
async function groqSearch(prompt, maxTok) {
  const key = process.env.GROQ_API_KEY; if (!key) return null;
  try {
    const r = await fetchT("https://api.groq.com/openai/v1/chat/completions", { method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + key },
      body: JSON.stringify({ model: "compound-beta", max_tokens: maxTok || 1200, messages: [{ role: "user", content: prompt }] }) }, 12000);
    if (!r.ok) return null; const d = await r.json(); return d.choices && d.choices[0] ? d.choices[0].message.content : null;
  } catch (e) { return null; }
}
async function gemini(prompt, maxTok) {
  const key = process.env.GEMINI_API_KEY; if (!key) return null;
  try {
    const r = await fetchT("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=" + key, { method: "POST",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: maxTok || 500 } }) }, 7000);
    if (!r.ok) return null; const d = await r.json(); return d.candidates && d.candidates[0] && d.candidates[0].content ? d.candidates[0].content.parts[0].text : null;
  } catch (e) { return null; }
}
async function mistral(sys, user, maxTok) {
  const key = process.env.MISTRAL_API_KEY; if (!key) return null;
  try {
    const r = await fetchT("https://api.mistral.ai/v1/chat/completions", { method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + key },
      body: JSON.stringify({ model: "mistral-small-latest", max_tokens: maxTok || 500, messages: [{ role: "system", content: sys }, { role: "user", content: user }] }) }, 7000);
    if (!r.ok) return null; const d = await r.json(); return d.choices && d.choices[0] ? d.choices[0].message.content : null;
  } catch (e) { return null; }
}
async function deepseek(sys, user, maxTok) {
  const key = process.env.DEEPSEEK_API_KEY; if (!key) return null;
  try {
    const r = await fetchT("https://api.deepseek.com/v1/chat/completions", { method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + key },
      body: JSON.stringify({ model: "deepseek-chat", max_tokens: maxTok || 500, messages: [{ role: "system", content: sys }, { role: "user", content: user }] }) }, 7000);
    if (!r.ok) return null; const d = await r.json(); return d.choices && d.choices[0] ? d.choices[0].message.content : null;
  } catch (e) { return null; }
}
async function freeAI(sys, user, maxTok) {
  return await groq(sys, user, maxTok) || await gemini(sys + "\n\n" + user, maxTok) || await mistral(sys, user, maxTok) || await deepseek(sys, user, maxTok);
}
// Claude — DERNIER RECOURS uniquement, tokens plafonnés en dur
async function claude(sys, user, maxTok, tools) {
  const key = process.env.ANTHROPIC_API_KEY; if (!key) return null;
  try {
    const payload = { model: CLAUDE_MODEL, max_tokens: Math.min(maxTok || 600, CLAUDE_HARD_CAP), system: sys, messages: [{ role: "user", content: user }] };
    if (tools && tools.length) payload.tools = tools;
    const r = await fetchT("https://api.anthropic.com/v1/messages", { method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8", "x-api-key": key, "anthropic-version": "2023-06-01" }, body: JSON.stringify(payload) }, 15000);
    if (!r.ok) return null; const d = await r.json();
    let t = ""; for (const b of (d.content || [])) if (b.type === "text") t += b.text; return t || null;
  } catch (e) { return null; }
}

// ── HTML ──────────────────────────────────────────────────────────────────────
function cardProd(name, price, url, adv, badge, verified) {
  const pill = '<span style="background:rgba(255,255,255,.2);border-radius:100px;padding:2px 10px;font-size:10px;font-weight:800">' + (adv.emoji || "🛍") + " " + adv.name + "</span>";
  const vBadge = verified ? ' · <span style="font-size:9px;opacity:.9">✓ lien direct</span>' : '';
  return '<a href="' + url + '" target="_blank" rel="sponsored noopener" style="display:flex;align-items:center;gap:12px;background:' + (adv.color || "#2f54ff") + ';color:#fff;text-decoration:none;border-radius:14px;padding:12px 14px;margin-top:8px">'
    + '<div style="flex:1;min-width:0"><div style="font-size:10px;margin-bottom:4px;opacity:.85">' + pill + (badge ? " · " + badge : "") + vBadge + "</div>"
    + '<div style="font-size:13px;font-weight:800;line-height:1.3;word-break:break-word">' + name + "</div></div>"
    + '<span style="background:rgba(255,255,255,.22);border-radius:8px;padding:5px 10px;white-space:nowrap;font-size:14px;font-weight:900;flex-shrink:0">' + (price || "Voir prix") + "</span></a>";
}
function promoBox(code, store, desc) {
  return '<div style="background:#f0fdf4;border:1.5px solid #86efac;border-radius:12px;padding:10px 14px;margin-top:6px;display:flex;align-items:center;justify-content:space-between;gap:8px">'
    + '<div><span style="font-size:11px;color:#16a34a;font-weight:700">🏷 ' + store + '</span>'
    + '<div style="font-size:12px;color:#166534;font-weight:600">' + desc + '</div></div>'
    + '<div onclick="navigator.clipboard.writeText(\'' + code + '\');this.textContent=\'Copie !\';setTimeout(()=>this.textContent=\'' + code + '\',2000)" style="background:#16a34a;color:#fff;border-radius:8px;padding:6px 10px;font-weight:800;font-size:12px;cursor:pointer;white-space:nowrap;flex-shrink:0">' + code + '</div></div>';
}
function switchHint() {
  return '<div style="font-size:13.5px;color:#1e293b;line-height:1.6;padding:4px 0">On dirait que tu prépares un voyage plutôt qu\'un achat ! ✈️<br><br>'
    + 'Passe en mode <b>Voyage</b> (bouton en haut du chat) pour que je te construise un itinéraire complet avec vols, hôtels et programme jour par jour.</div>';
}

// ── HANDLER ───────────────────────────────────────────────────────────────────
export default async function handler(req) {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST,OPTIONS", "Access-Control-Allow-Headers": "Content-Type" } });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const H = { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" };

  try {
    const body = await req.json();
    const message = body.message || "";
    const history = body.history || [];
    const sid = body.sessionId || ("anon_" + Date.now());
    const ads = await getAds();
    const hist = buildHist(history);

    if (body.trackingEnabled) {
      sb("searches", "POST", { query: message, session_id: sid, user_id: body.userId || null });
      sb("trends", "POST", { query: message.toLowerCase().trim(), count: 1, last_searched: new Date().toISOString() });
    }

    if (looksLikeTravel(message) && countQ(history) === 0) {
      return new Response(JSON.stringify({ reply: switchHint(), sessionId: sid }), { headers: H });
    }

    // ── ÉTAPE 1 : DÉCISION (IA gratuite) ──────────────────────────────────────
    const qAsked = countQ(history);
    const decidePrompt = 'Tu es l assistant shopping Huntify, expert et attentif. Decide si UNE question\n'
      + 'de clarification rendrait la recherche VRAIMENT meilleure, ou si tu peux chercher tout de suite.\n\n'
      + 'HISTORIQUE:\n' + (hist || '(debut de conversation)') + '\n'
      + 'DERNIER MESSAGE: ' + message + '\n\n'
      + 'Utilise ton bon sens selon la categorie du produit: pose UNE question courte seulement\n'
      + 'si un critere manquant change vraiment le resultat (teinte pour maquillage teint,\n'
      + 'pointure pour chaussures, usage+budget pour electronique cher, destinataire pour cadeau...).\n'
      + 'Ne pose PAS de question si le produit est deja assez clair, si ' + qAsked + ' question(s) ont deja\n'
      + 'ete posee(s), ou si le client vient de repondre a une question.\n\n'
      + 'JSON STRICT, rien d autre:\n'
      + '{"ready": false, "msg": "question courte, naturelle et chaleureuse"}\n'
      + 'ou {"ready": true, "recap": "mots-cles produit precis (marque/type/critere si connu)"}';

    let decision = { ready: true, recap: null };
    try {
      const decideRaw = await freeAI(decidePrompt, message, 300);
      if (decideRaw) {
        const parsed = parseJSON(decideRaw);
        const asksQuestion = (parsed.ready === false || parsed.ready === "false") && parsed.msg && qAsked < MAX_QUESTIONS;
        if (asksQuestion) decision = { ready: false, msg: parsed.msg };
        else if (parsed.recap) decision = { ready: true, recap: parsed.recap };
      }
    } catch (e) { /* jamais bloquant */ }

    if (decision.ready === false) {
      return new Response(JSON.stringify({ reply: '<div style="font-size:13.5px;color:#1e293b;line-height:1.6;padding:4px 0">' + decision.msg + '</div>', sessionId: sid }), { headers: H });
    }

    const allUserMsgs = history.filter(m => m.role === "user").map(m => m.content || "").join(" ") + " " + message;
    let recap = decision.recap || null;
    if (!recap) {
      const extractRaw = await freeAI(
        'Extrait le PRODUIT recherche. Retourne des mots-cles e-commerce concrets, jamais la phrase brute.\n'
        + 'Ex: "je veux respirer sous l eau" → "masque snorkeling plongee". "un truc pour courir" → "chaussures running".\n'
        + 'JSON: {recap:"mots-cles produit"}', allUserMsgs.trim(), 200);
      recap = parseJSON(extractRaw || "").recap || cleanKw(allUserMsgs);
    }

    const budget = detectBudget(recap) || detectBudget(message) || detectBudget(hist);
    if (budget && !(recap || "").includes("EUR") && !(recap || "").includes("€")) recap = recap + " " + budget + "EUR";

    // ── ÉTAPE 2 : RECHERCHE (Groq compound-beta, gratuit, recherche web) ─────
    const dbCtx = await dbLookup(recap);
    const searchPrompt = 'Agent shopping Huntify. Recherche MAINTENANT sur le web les produits reels\n'
      + 'disponibles sur amazon.fr, fr.shopping.rakuten.com et aliexpress.com.\n'
      + 'BESOIN CLIENT: ' + recap + '\n'
      + (dbCtx ? 'Donnees internes: ' + dbCtx + '\n' : '')
      + 'REGLES ABSOLUES:\n'
      + '1. name = VRAI nom complet (marque + modele exact) vu dans tes resultats de recherche.\n'
      + '   INTERDIT: "Casque audio", "Masque de snorkeling". CORRECT: "Sony WH-1000XM5", "Cressi F1".\n'
      + '2. url = URL exacte (amazon.fr /dp/ASIN, page produit Rakuten /mfp/ ou /m/+ID,\n'
      + '   ou page produit AliExpress /item/NUMERO.html) UNIQUEMENT si vue dans un resultat.\n'
      + '   Si pas vue → url:null. NE DEVINE JAMAIS une URL.\n'
      + '3. price = prix vu dans les resultats, sinon "Voir prix". Jamais un prix devine.\n'
      + '4. 3 a 4 produits varies en gamme (AliExpress = souvent le moins cher, utile si budget serre).\n'
      + 'JSON: {summary:"1 phrase courte", products:[{name,price,store:"amazon"|"rakuten"|"aliexpress",url,badge}], promoCodes:[]}\n'
      + 'MINIMUM 2 produits Amazon + 1 autre boutique. JSON UNIQUEMENT.';

    let raw = await groqSearch(searchPrompt, 1200);
    let parsed2 = parseJSON(raw || "");
    let products = parsed2.products || [];
    let summary = parsed2.summary || "";
    let promos = parsed2.promoCodes || [];

    if (!usableProducts(products).length) {
      const fbRaw = await freeAI('Agent shopping. Reponds en JSON.',
        'Besoin client: ' + recap + '\nPropose 3 produits CONNUS et populaires de cette categorie\n'
        + '(marque + modele reels et courants, ex "Sony WH-CH520"). Ne fournis PAS d URL.\n'
        + 'JSON: {summary:"1 phrase", products:[{name,price:"Voir prix",store:"amazon"|"rakuten"|"aliexpress",badge}]}', 700);
      const fp = parseJSON(fbRaw || "");
      products = (fp.products || []).map(p => ({ ...p, url: null }));
      summary = fp.summary || summary;
    }

    // ── ÉTAPE 3 : CLAUDE — dernier recours ────────────────────────────────────
    const hasGoodUrl = products.some(p => validAmazonUrl(p.url) || validRakutenUrl(p.url) || validAliExpressUrl(p.url));
    const needClaude = !usableProducts(products).length || (!hasGoodUrl && usableProducts(products).length > 0);

    if (needClaude) {
      const claudeRaw = await claude(
        'Agent shopping. Utilise web_search pour trouver les vrais produits sur amazon.fr,\n'
        + 'fr.shopping.rakuten.com ou aliexpress.com. URLs exactes uniquement si vues dans les\n'
        + 'resultats, sinon url:null. Jamais de nom generique.',
        'Cherche: ' + recap + '. JSON: {summary:"1 phrase",products:[{name:"VRAI NOM",price,store:"amazon"|"rakuten"|"aliexpress",url,badge}]}',
        600, [{ type: "web_search_20250305", name: "web_search", max_uses: 2 }]
      );
      const cp = parseJSON(claudeRaw || "");
      const cProducts = usableProducts(cp.products || []);
      if (cProducts.length) {
        products = [...cProducts, ...products.filter(p => !(p.store || "").includes("amazon"))];
        if (cp.summary) summary = cp.summary;
      }
    }

    if (!products.some(p => (p.store || "").includes("amazon"))) {
      products.unshift({ name: recap, price: "Voir prix", store: "amazon", url: null, badge: "Bestseller" });
    }
    if (!products.some(p => (p.store || "").includes("rakuten") || (p.store || "").includes("aliexpress"))) {
      products.push({ name: recap, price: "Voir prix", store: "aliexpress", url: null, badge: "Petit prix" });
    }
    if (!summary) summary = 'Voici mes selections pour vous :';

    // ── Construction HTML ─────────────────────────────────────────────────────
    var buttons = "";
    for (var idx = 0; idx < Math.min(products.length, 4); idx++) {
      var pr = products[idx];
      if (!pr || typeof pr !== "object" || !pr.name) continue;
      var adv = findAdv(ads, pr.store) || defaultAdv((pr.store || "").toLowerCase());
      if (!adv) continue;
      var prName = String(pr.name || "");
      var rawUrl = (pr.url && pr.url !== "null" && (pr.url || "").length > 15) ? pr.url : null;
      var verified = !!(validAmazonUrl(rawUrl) || validRakutenUrl(rawUrl) || validAliExpressUrl(rawUrl));
      var url = buildLink(adv, prName.length > 5 ? prName : recap, rawUrl);
      if (!url) continue;
      buttons += cardProd(prName, pr.price || "Voir prix", url, adv, pr.badge || null, verified);
    }

    var promoHtml = "";
    for (var pi = 0; pi < Math.min((promos || []).length, 2); pi++) {
      var c = promos[pi];
      if (c && typeof c === "object" && c.code) promoHtml += promoBox(c.code, c.store || "boutique", c.discount || "Reduction");
    }

    var wishHtml = "";
    var first = products[0];
    if (first) {
      var wAdv = findAdv(ads, first.store) || defaultAdv((first.store || "").toLowerCase()) || defaultAdv("amazon");
      var wUrl = buildLink(wAdv, first.name || recap, first.url || null) || "";
      var wD = JSON.stringify({ type: "product", name: first.name, price: first.price, store: first.store, url: wUrl }).replace(/"/g, "&quot;");
      wishHtml = '<button onclick="addToWishlist(' + wD + ')" style="background:#fff;border:1.5px solid #e8edf8;color:#3b5bdb;border-radius:12px;padding:8px 16px;margin-top:10px;font-weight:700;font-size:12px;cursor:pointer;font-family:inherit;width:100%">♡ Ajouter a ma wishlist</button>';
    }

    var sugs = getCross(recap);
    var crossHtml = "";
    if (sugs.length) {
      crossHtml = '<div style="margin-top:12px;padding-top:10px;border-top:1px solid #f0f4ff"><div style="font-size:11px;font-weight:700;color:#7c89a8;margin-bottom:6px">Tu pourrais aussi aimer :</div><div style="display:flex;gap:6px;flex-wrap:wrap">';
      for (var si = 0; si < sugs.length; si++) crossHtml += '<button onclick="send(\'' + sugs[si].replace(/'/g, "\\'") + '\')" style="background:#f5f7ff;border:1.5px solid #e8edf8;color:#3b5bdb;border-radius:100px;padding:6px 14px;font-size:11px;font-weight:600;cursor:pointer;font-family:inherit">' + sugs[si] + '</button>';
      crossHtml += '</div></div>';
    }

    var reply = '<div style="font-size:13.5px;color:#1e293b;margin-bottom:8px;font-weight:500;line-height:1.5">' + summary + '</div>'
      + buttons + (promoHtml ? '<div style="margin-top:4px">' + promoHtml + '</div>' : "") + wishHtml + crossHtml;

    return new Response(JSON.stringify({ reply: reply, sessionId: sid }), { headers: H });

  } catch (err) {
    console.error("Huntify chat error:", err && err.message);
    return new Response(JSON.stringify({ reply: '<div style="font-size:13px;color:#1e293b">Desole, probleme momentane. Reessayez !</div>' }), { status: 200, headers: { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" } });
  }
}
