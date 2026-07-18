export const config = { runtime: 'edge' };

// ─────────────────────────────────────────────────────────────────────────────
// HUNTIFY — /api/chat.js — Comparateur Produit (Amazon + Rakuten + AliExpress)
// Utilise l'orchestrateur MEGA IA centralisé (api/_lib/orchestrator.js).
//
// PIPELINE :
//   1. route()    → IA gratuite décide s'il faut clarifier (plafond 2 questions)
//   2. generate()  → IA gratuite (Groq compound-beta, recherche web) trouve
//                    les vrais produits
//   3. finalize()  → Claude, UNIQUEMENT si (2) n'a rien donné d'exploitable
//                    ou aucune URL vérifiée. Tokens plafonnés.
//
// Garde-fous code (jamais d'orientation du contenu, seulement la fiabilité) :
//   - URLs validées par regex stricte, sinon lien de recherche par nom exact
//   - Détection légère (regex, coût zéro) d'une intention voyage mal aiguillée
// ─────────────────────────────────────────────────────────────────────────────

import { sb, getAds, buildHist, countQ, detectBudget, cleanKw, dbLookup,
         validAmazonUrl, validRakutenUrl, validAliExpressUrl,
         buildLink, findAdv, defaultAdv, getCross, MAX_QUESTIONS } from './_lib/shared.js';
import { route, generate, finalize } from './_lib/orchestrator.js';

// ── Détection intention voyage (regex, coût zéro — évite un aiguillage IA) ───
function looksLikeTravel(text) {
  const t = (text || "").toLowerCase();
  const travelWords = /(voyage|vacances|s[ée]jour|weekend|week-end|h[ôo]tel.*vol|vol.*h[ôo]tel|partir en|itin[ée]raire|billet d avion)/;
  return travelWords.test(t);
}

function usableProducts(products) {
  return (products || []).filter(p => {
    const n = (p && p.name || "").trim();
    return n.length >= 8 && n.split(/\s+/).length >= 2;
  });
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
    + 'Passe en mode <b>Voyage</b> (bouton en haut du chat) pour que je te construise un itinéraire complet avec vols, hôtels et programme jour par jour.'
    + '</div>';
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

    // ── ROUTING LÉGER : intention voyage mal aiguillée (coût zéro) ───────────
    if (looksLikeTravel(message) && countQ(history) === 0) {
      return new Response(JSON.stringify({ reply: switchHint(), sessionId: sid }), { headers: H });
    }

    // ── ÉTAPE 1 : DÉCISION (orchestrator.route — IA gratuite) ────────────────
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
      const { parsed } = await route(decidePrompt, message, 300);
      const asksQuestion = (parsed.ready === false || parsed.ready === "false") && parsed.msg && qAsked < MAX_QUESTIONS;
      if (asksQuestion) decision = { ready: false, msg: parsed.msg };
      else if (parsed.recap) decision = { ready: true, recap: parsed.recap };
    } catch (e) { /* jamais bloquant, on cherche par défaut */ }

    if (decision.ready === false) {
      return new Response(JSON.stringify({ reply: '<div style="font-size:13.5px;color:#1e293b;line-height:1.6;padding:4px 0">' + decision.msg + '</div>', sessionId: sid }), { headers: H });
    }

    // Extraction mots-clés (IA gratuite via route())
    const allUserMsgs = history.filter(m => m.role === "user").map(m => m.content || "").join(" ") + " " + message;
    let recap = decision.recap || null;
    if (!recap) {
      const { parsed } = await route(
        'Extrait le PRODUIT recherche. Retourne des mots-cles e-commerce concrets, jamais la phrase brute.\n'
        + 'Ex: "je veux respirer sous l eau" → "masque snorkeling plongee". "un truc pour courir" → "chaussures running".\n'
        + 'JSON: {recap:"mots-cles produit"}',
        allUserMsgs.trim(), 200);
      recap = parsed.recap || cleanKw(allUserMsgs);
    }

    const budget = detectBudget(recap) || detectBudget(message) || detectBudget(hist);
    if (budget && !(recap || "").includes("EUR") && !(recap || "").includes("€")) recap = recap + " " + budget + "EUR";

    // ── ÉTAPE 2 : RECHERCHE (orchestrator.generate — Groq compound-beta) ─────
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

    let { parsed: gen1 } = await generate(searchPrompt, 1200);
    let products = gen1.products || [];
    let summary = gen1.summary || "";
    let promos = gen1.promoCodes || [];

    // Repli gratuit supplémentaire si generate() n'a rien donné
    if (!usableProducts(products).length) {
      const { parsed: gen2 } = await route(
        'Agent shopping. Reponds en JSON.',
        'Besoin client: ' + recap + '\nPropose 3 produits CONNUS et populaires de cette categorie\n'
        + '(marque + modele reels et courants, ex "Sony WH-CH520"). Ne fournis PAS d URL.\n'
        + 'JSON: {summary:"1 phrase", products:[{name,price:"Voir prix",store:"amazon"|"rakuten"|"aliexpress",badge}]}', 700);
      products = (gen2.products || []).map(p => ({ ...p, url: null })); // URLs neutralisées (non issues d'une recherche web)
      summary = gen2.summary || summary;
    }

    // ── ÉTAPE 3 : CLAUDE — dernier recours (orchestrator.finalize) ───────────
    const hasGoodUrl = products.some(p => validAmazonUrl(p.url) || validRakutenUrl(p.url) || validAliExpressUrl(p.url));
    const needClaude = !usableProducts(products).length || (!hasGoodUrl && usableProducts(products).length > 0);

    if (needClaude) {
      const { parsed: cp } = await finalize(
        'Agent shopping. Utilise web_search pour trouver les vrais produits sur amazon.fr,\n'
        + 'fr.shopping.rakuten.com ou aliexpress.com. URLs exactes uniquement si vues dans les\n'
        + 'resultats, sinon url:null. Jamais de nom generique.',
        'Cherche: ' + recap + '. JSON: {summary:"1 phrase",products:[{name:"VRAI NOM",price,store:"amazon"|"rakuten"|"aliexpress",url,badge}]}',
        600, true
      );
      const cProducts = usableProducts(cp.products || []);
      if (cProducts.length) {
        products = [...cProducts, ...products.filter(p => !(p.store || "").includes("amazon"))];
        if (cp.summary) summary = cp.summary;
      }
    }

    // ── Garanties finales ──────────────────────────────────────────────────
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
      for (var si = 0; si < sugs.length; si++) {
        crossHtml += '<button onclick="send(\'' + sugs[si].replace(/'/g, "\\'") + '\')" style="background:#f5f7ff;border:1.5px solid #e8edf8;color:#3b5bdb;border-radius:100px;padding:6px 14px;font-size:11px;font-weight:600;cursor:pointer;font-family:inherit">' + sugs[si] + '</button>';
      }
      crossHtml += '</div></div>';
    }

    var reply = '<div style="font-size:13.5px;color:#1e293b;margin-bottom:8px;font-weight:500;line-height:1.5">' + summary + '</div>'
      + buttons
      + (promoHtml ? '<div style="margin-top:4px">' + promoHtml + '</div>' : "")
      + wishHtml + crossHtml;

    return new Response(JSON.stringify({ reply: reply, sessionId: sid }), { headers: H });

  } catch (err) {
    console.error("Huntify chat error:", err && err.message);
    return new Response(JSON.stringify({ reply: '<div style="font-size:13px;color:#1e293b">Desole, probleme momentane. Reessayez !</div>' }), { status: 200, headers: { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" } });
  }
}
