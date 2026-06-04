export const config = { runtime: 'edge' };

const SUPABASE_URL = "https://enocxbrqyybendertytl.supabase.co";
const SUPABASE_KEY = "sb_publishable_NmPh--frZG5HuqfaoxnemA_E7cidV9Y";
const MODEL = 'claude-haiku-4-5';
const MAX_TARGETING_QUESTIONS = 5;

// ============================================================
// AI ROUTER MULTI-IA - Huntify
//
// TIERS GRATUITS (mai 2026) :
//   Groq   : 14 400 req/jour, 30 req/min  - ultra rapide, RGPD ok
//   Gemini : 1 500 req/jour,  15 req/min  - 1M tokens/min, puissant
//   Mistral: illimite tokens,  2 req/min  - serveurs EU, RGPD natif
//   Claude : payant MAIS web search natif - reserve aux gros budgets
//
// ROI RULE : cout IA <= 50% commission esperee conservative
//   < 80  EUR  -> IA gratuite, recherche interne (0$)
//   80-150 EUR -> IA gratuite approfondie (0$)
//   > 150 EUR  -> Claude + web search reel (0.05$, ROI positif)
// ============================================================


// ============================================================
// MODULE VOYAGE
// Seuil ROI voyage : 300EUR (vs 150EUR produits)
// Commission Booking via CJ : ~4% du prix hébergement
// 500EUR de budget = ~0.13$ commission espérée -> Claude rentable
// ============================================================
const TRAVEL_ROI_THRESHOLD = 300;

function buildBookingLink(destination, nights, adults=2) {
  const pubId = process.env.CJ_PUBLISHER_ID || null;
  const advId = process.env.CJ_BOOKING_ADVERTISER_ID || null;
  const dest = encodeURIComponent(destination);
  const base = `https://www.booking.com/search.html?ss=${dest}&group_adults=${adults}&nights=${nights}`;
  if (!pubId || !advId) return base; // pas encore d'ID CJ -> lien direct
  return `https://www.anrdoezrs.net/click-${pubId}-${advId}?url=${encodeURIComponent(base)}`;
}

function hotelCard(h) {
  const stars = '⭐'.repeat(Math.min(h.stars||3,5));
  return `<a href="${h.url||'#'}" target="_blank" style="display:flex;flex-direction:column;background:#fff;border:1.5px solid #e6ebf7;border-radius:16px;padding:14px;margin-top:8px;text-decoration:none;gap:6px;box-shadow:0 4px 14px -8px rgba(31,42,138,.2)">
    <div style="display:flex;justify-content:space-between;align-items:flex-start">
      <div style="flex:1"><div style="font-size:13px;font-weight:800;color:#0e1430">${h.name}</div>
      <div style="font-size:11px;color:#7c89a8;margin-top:2px">${stars} · ${h.location||''}</div></div>
      <div style="background:linear-gradient(135deg,#2f54ff,#4a6bff);color:#fff;border-radius:10px;padding:6px 10px;text-align:right;flex-shrink:0;margin-left:10px">
        <div style="font-size:15px;font-weight:900">${h.price||'Voir prix'}</div>
        <div style="font-size:9px;opacity:.8">/ nuit</div></div></div>
    ${h.highlight?`<div style="background:#eff6ff;border-radius:8px;padding:5px 10px;font-size:11px;color:#2f54ff;font-weight:600">✨ ${h.highlight}</div>`:''}
    <div style="font-size:11px;color:#94a3b8;font-weight:600">🏨 Booking.com · Voir disponibilités →</div>
  </a>`;
}

function dayCard(d) {
  return `<div style="background:#fff;border:1.5px solid #e6ebf7;border-radius:16px;padding:14px;margin-top:10px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
      <div style="background:linear-gradient(135deg,#2f54ff,#4a6bff);color:#fff;border-radius:8px;padding:4px 12px;font-size:12px;font-weight:800">Jour ${d.num}</div>
      <div style="font-size:12px;font-weight:700;color:#0e1430">${d.title||''}</div>
      ${d.budget?`<div style="font-size:11px;color:#16a34a;font-weight:700">~${d.budget}€</div>`:''}
    </div>
    ${d.morning?`<div style="display:flex;gap:8px;margin-bottom:6px"><span>🌅</span><div style="font-size:12px;color:#374151"><b>Matin</b> — ${d.morning}</div></div>`:''}
    ${d.afternoon?`<div style="display:flex;gap:8px;margin-bottom:6px"><span>☀️</span><div style="font-size:12px;color:#374151"><b>Après-midi</b> — ${d.afternoon}</div></div>`:''}
    ${d.evening?`<div style="display:flex;gap:8px;margin-bottom:6px"><span>🌙</span><div style="font-size:12px;color:#374151"><b>Soirée</b> — ${d.evening}</div></div>`:''}
    ${d.hotel?`<div style="display:flex;gap:8px;margin-top:8px;padding-top:8px;border-top:1px solid #f0f4ff"><span>🏨</span><div style="font-size:11px;color:#2f54ff;font-weight:600">${d.hotel}</div></div>`:''}
  </div>`;
}

function budgetCard(b) {
  const items=[['🏨 Hébergement',b.hebergement],['🎯 Activités',b.activites],['🍽️ Repas',b.repas],['🚇 Transport',b.transport]].filter(i=>i[1]);
  return `<div style="background:linear-gradient(135deg,#0e1430,#1f2da0);border-radius:16px;padding:16px;margin-top:10px">
    <div style="font-size:13px;font-weight:800;color:#fff;margin-bottom:12px">💰 Budget estimé</div>
    ${items.map(([l,v])=>`<div style="display:flex;justify-content:space-between;margin-bottom:6px"><span style="font-size:12px;color:rgba(255,255,255,.75)">${l}</span><span style="font-size:12px;font-weight:700;color:#fff">${v}€</span></div>`).join('')}
    <div style="border-top:1px solid rgba(255,255,255,.2);margin-top:8px;padding-top:8px;display:flex;justify-content:space-between">
      <span style="font-size:13px;font-weight:800;color:#fff">TOTAL</span>
      <span style="font-size:15px;font-weight:900;color:#bcd0ff">${b.total}€</span>
    </div>
    ${b.note?`<div style="font-size:10px;color:rgba(255,255,255,.55);margin-top:8px">${b.note}</div>`:''}
  </div>`;
}

function tipsCard(tips) {
  if (!tips?.length) return '';
  return `<div style="background:#f5f3ff;border:1.5px solid #ddd6fe;border-radius:14px;padding:14px;margin-top:10px">
    <div style="font-size:12px;font-weight:800;color:#5b21b6;margin-bottom:8px">💡 Conseils pratiques</div>
    ${tips.map(t=>`<div style="font-size:12px;color:#374151;margin-bottom:5px;padding-left:8px;border-left:2px solid #c4b5fd">• ${t}</div>`).join('')}
  </div>`;
}

async function getAdvertisers() {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/advertisers?active=eq.true`, {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
    });
    return await r.json();
  } catch(e) { return []; }
}

async function sbFetch(path, method='GET', body=null) {
  const opts = { method, headers:{'Content-Type':'application/json','apikey':SUPABASE_KEY,'Authorization':`Bearer ${SUPABASE_KEY}`} };
  if (body) opts.body = JSON.stringify(body);
  try { const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, opts); return await r.json(); } catch(e) { return null; }
}

function cleanKeywords(kw) {
  if (!kw) return '';
  const stop = new Set(['style','classique','de','la','le','les','un','une','des','pour','avec','et','en','du','au','aux']);
  return kw.replace(/,/g,' ').replace(/\s+/g,' ').trim()
    .split(' ').filter(w => w.length > 1 && !stop.has(w.toLowerCase()))
    .slice(0,5).join(' ');
}

function buildAffiliateLink(adv, keywords, directUrl=null) {
  if (!adv?.active) return null;
  const kw = cleanKeywords(keywords);
  if (adv.slug === 'amazon') {
    const base = directUrl && directUrl.includes('amazon.fr') ? directUrl : `https://www.amazon.fr/s?k=${encodeURIComponent(kw)}`;
    return `${base}${base.includes('?')?'&':'?'}tag=${adv.amazon_tag}`;
  }
  if (adv.awin_mid) {
    const rakutenKw = encodeURIComponent(kw).replace(/%20/g, '+');
    // ⚡ FIX DÉFINITIF : force le format /s/ même si search_url en DB est encore l'ancien format
    let searchBase = adv.search_url || 'https://fr.shopping.rakuten.com/s/{keywords}';
    if (searchBase.includes('/search?keyword=') || searchBase.includes('?keyword=')) {
      // Ancien format détecté → on force le bon
      searchBase = 'https://fr.shopping.rakuten.com/s/{keywords}';
    }
    const dest = searchBase.replace('{keywords}', rakutenKw);
    return `https://www.awin1.com/cread.php?awinmid=${adv.awin_mid}&awinaffid=${adv.awin_aff}&ued=${encodeURIComponent(dest)}`;
  }
  return null;
}

function findAdvertiser(advertisers, slug) {
  return advertisers.find(a => a.slug === slug?.toLowerCase()) || null;
}

// ROI-aware routing
function detectBudget(text) {
  if (!text) return null;
  const patterns = [
    /(?:moins de|maxi|maximum|budget|environ|max)[^\d]*(\d+)\s*(?:€|euros?)/i,
    /(\d+)\s*(?:€|euros?)\s*(?:max|maxi|maximum|environ|budget)/i,
    /budget[^\d]*(\d+)/i,
    /(\d{2,})\s*€/,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) { const b = parseInt(m[1]); if (b > 0 && b < 100000) return b; }
  }
  return null;
}

function routingStrategy(budget) {
  if (budget === null) return 'paid_deep';
  if (budget < 80)    return 'free_fast';
  if (budget < 150)   return 'free_deep';
  return 'paid_deep';
}

// Appels IA gratuites avec fallback en chaine
async function callGroq(system, user, model, maxTokens) {
  const key = process.env.GROQ_API_KEY;
  if (!key) return null;
  try {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':`Bearer ${key}`},
      body: JSON.stringify({ model, max_tokens: maxTokens,
        messages:[{role:'system',content:system},{role:'user',content:user}] })
    });
    if (!r.ok) return null;
    const d = await r.json();
    return d.choices?.[0]?.message?.content || null;
  } catch(e) { return null; }
}

async function callGemini(system, user, maxTokens) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`,
      { method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({
          contents:[{parts:[{text:`${system}\n\n${user}`}]}],
          generationConfig:{maxOutputTokens:maxTokens}
        }) }
    );
    if (!r.ok) return null;
    const d = await r.json();
    return d.candidates?.[0]?.content?.parts?.[0]?.text || null;
  } catch(e) { return null; }
}

async function callMistral(system, user, maxTokens) {
  const key = process.env.MISTRAL_API_KEY;
  if (!key) return null;
  try {
    const r = await fetch('https://api.mistral.ai/v1/chat/completions', {
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':`Bearer ${key}`},
      body: JSON.stringify({ model:'mistral-small-latest', max_tokens:maxTokens,
        messages:[{role:'system',content:system},{role:'user',content:user}] })
    });
    if (!r.ok) return null;
    const d = await r.json();
    return d.choices?.[0]?.message?.content || null;
  } catch(e) { return null; }
}

// Essaie les IA gratuites dans l'ordre : Groq -> Gemini -> Mistral
async function callFreeAI(system, user, depth) {
  const isDeep = depth === 'deep';
  const groqModel = isDeep ? 'llama-3.3-70b-versatile' : 'llama-3.1-8b-instant';
  const maxTok = isDeep ? 700 : 250;
  return await callGroq(system, user, groqModel, maxTok)
      || await callGemini(system, user, maxTok)
      || await callMistral(system, user, maxTok);
}

// HTML helpers
function productCard(name, price, url, color, emoji, img, badge) {
  const imgHtml = img ? `<img src="${img}" style="width:60px;height:60px;object-fit:cover;border-radius:8px;flex-shrink:0" onerror="this.style.display='none'">` : '';
  const badgeHtml = badge ? `<span style="background:rgba(255,255,255,.25);border-radius:100px;padding:2px 8px;font-size:10px;font-weight:700">${badge}</span>` : '';
  return `<a href="${url}" target="_blank" style="display:flex;align-items:center;gap:12px;background:${color};color:#fff;text-decoration:none;border-radius:14px;padding:12px 14px;margin-top:8px;font-weight:700;font-size:13px">
    ${imgHtml}
    <div style="flex:1;min-width:0">
      <div style="font-size:11px;opacity:.8;margin-bottom:2px">${emoji} ${badgeHtml}</div>
      <div style="font-size:13px;font-weight:800;line-height:1.3;word-break:break-word">${name}</div>
    </div>
    <span style="background:rgba(255,255,255,.25);border-radius:8px;padding:5px 10px;white-space:nowrap;font-size:14px;font-weight:900;flex-shrink:0">${price}</span>
  </a>`;
}

function promoBox(code, store, desc, best) {
  const border = best ? '2px solid #16a34a' : '1.5px solid #86efac';
  const bg = best ? '#dcfce7' : '#f0fdf4';
  return `<div style="background:${bg};border:${border};border-radius:12px;padding:10px 14px;margin-top:6px;display:flex;align-items:center;justify-content:space-between;gap:8px">
    <div>
      <span style="font-size:11px;color:#16a34a;font-weight:700">${best?'⭐ MEILLEUR — ':''}🏷️ ${store}</span>
      <div style="font-size:12px;color:#166534;font-weight:600">${desc}</div>
    </div>
    <div onclick="navigator.clipboard.writeText('${code}');this.innerHTML='✓';setTimeout(()=>this.innerHTML='${code}',2000)" style="background:#16a34a;color:#fff;border-radius:8px;padding:6px 10px;font-weight:800;font-size:12px;cursor:pointer;white-space:nowrap;flex-shrink:0">${code}</div>
  </div>`;
}

function priceHistoryBox(old, trend) {
  const icon = trend==='down'?'📉':trend==='up'?'📈':'➡️';
  const color = trend==='down'?'#dcfce7':trend==='up'?'#fee2e2':'#f1f5f9';
  const border = trend==='down'?'#86efac':trend==='up'?'#fca5a5':'#e2e8f0';
  const msg = trend==='down'?`Prix en baisse ! Était à ${old} ✅`:trend==='up'?`⚠️ Prix gonflé ! Était à ${old}`:`Prix stable`;
  return `<div style="background:${color};border:1.5px solid ${border};border-radius:12px;padding:10px 14px;margin-top:8px;font-size:12px;font-weight:600;color:#374151">${icon} ${msg}</div>`;
}

function questionBox(question) {
  return `<div data-qbox="1" style="background:#eff6ff;border:1.5px solid #bfdbfe;border-radius:12px;padding:12px 14px;margin-top:8px;font-size:13px;color:#1e40af;font-weight:600">💬 ${question}</div>`;
}

function recapBox(recap) {
  return `<div style="background:#f5f3ff;border:1.5px solid #ddd6fe;border-radius:12px;padding:10px 14px;margin-top:8px;font-size:12px;color:#5b21b6;font-weight:600">🔎 ${recap}</div>`;
}

function roiInfoBox(strategy, budget) {
  if (strategy === 'paid_deep') return '';
  const msg = budget
    ? `🔍 Mode économique (budget ${budget}€ — recherche optimisée)`
    : `🔍 Mode économique activé`;
  return `<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:8px 12px;margin-top:6px;font-size:11px;color:#16a34a;font-weight:600">${msg}</div>`;
}

function countQuestionsAsked(history) {
  return (history||[]).filter(m => m.role !== 'user' && (m.content||'').includes('data-qbox')).length;
}

function parseAgentJSON(raw) {
  if (!raw) return {};
  try { const m = raw.match(/\{[\s\S]*\}/); if (m) return JSON.parse(m[0]); } catch(e) {}
  return {};
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status:204, headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type'} });
  if (req.method !== 'POST') return new Response('Method not allowed', { status:405 });

  const HEADERS = {'Content-Type':'application/json; charset=utf-8','Access-Control-Allow-Origin':'*'};

  try {
    const { message, history, sessionId, userId, trackingEnabled, mode, travelContext } = await req.json();
    const sid = sessionId || `anon_${Date.now()}`;
    const isTravel = mode === 'travel'; // toggle Comparateur/Voyage

    const advertisers = await getAdvertisers();

    if (trackingEnabled) {
      Promise.all([
        sbFetch('searches','POST',{query:message,session_id:sid,user_id:userId||null}),
        sbFetch('trends','POST',{query:message.toLowerCase().trim(),count:1,last_searched:new Date().toISOString()})
      ]);
    }

    const activeNames = advertisers.map(a=>a.name).join(', ');

    // Historique propre : 400 chars/message, 8 tours, nettoyage HTML
    const histSummary = (history||[]).map(m => {
      const role = m.role==='user' ? 'Client' : 'Agent';
      const text = (m.content||'').replace(/<[^>]*>/g,' ').replace(/&[^;]+;/g,' ').replace(/\s+/g,' ').trim().slice(0,400);
      if (!text) return null;
      return `${role}: ${text}`;
    }).filter(Boolean).join('\n').slice(0,2000);

    const questionsAsked = countQuestionsAsked(history);
    const precisionSignals = /\b(\d{2,})\s?(€|euro|go|gb|cm|w)\b|moins de|budget|taille|modèle|\b(s|m|l|xl)\b/i;
    const looksPrecise = message.trim().split(/\s+/).length >= 4 && precisionSignals.test(message);
    const hasHistory = (history||[]).length > 0;
    const mustSearchNow = questionsAsked >= MAX_TARGETING_QUESTIONS || (!hasHistory && looksPrecise);

    // ══════════════════════════════════════════════════════════
    // MODE VOYAGE : itinéraire personnalisé jour par jour
    // Questions ciblage -> ROI check -> génération itinéraire
    // ══════════════════════════════════════════════════════════
    if (isTravel) {
      const travelQAsked = countQuestionsAsked(history);
      const travelBudget = detectBudget(histSummary) || detectBudget(message);
      const travelStrategy = (travelBudget && travelBudget >= TRAVEL_ROI_THRESHOLD) ? 'paid' : 'free';

      // travelContext : résumé structuré transmis depuis le front (évite la boucle)
      // Le front maintient un objet {destination, budget, duration, travelers, style, suggestionsShown}
      // et le transmet explicitement — plus fiable que de parser du HTML dégradé
      const ctx = travelContext || {};
      const ctxSummary = Object.entries(ctx)
        .filter(([k,v]) => v && k !== 'suggestionsShown')
        .map(([k,v]) => `${k}: ${v}`)
        .join(', ');

      // Prompt système voyage complet
      const travelSys = `Tu es l'agent voyage IA de Huntify. Tu génères des FEUILLES DE ROUTE complètes comme un vrai agent de voyage.

CONTEXTE DÉJÀ COLLECTÉ (NE PAS REDEMANDER CES INFOS) :
${ctxSummary ? ctxSummary : 'Aucun — début de conversation'}

HISTORIQUE : ${histSummary || 'Début de conversation'}
Questions posées : ${travelQAsked}/5

═══════════════════════════════════════
RÈGLE ABSOLUE ANTI-BOUCLE :
- NE REDEMANDE JAMAIS une info déjà dans le contexte ou l'historique
- NE REPROPOSE JAMAIS les mêmes destinations si déjà proposées
- Si l'utilisateur a choisi une destination → GÉNÈRE L'ITINÉRAIRE, ne pose plus de questions sur la destination
- Si tu as déjà l'essentiel (destination + budget OU durée) → génère directement
═══════════════════════════════════════

INFOS NÉCESSAIRES (collecte UNE seule à la fois si manquante) :
1. Destination — ou style/envie si pas de destination précise
2. Durée ou dates
3. Budget total
4. Nombre de voyageurs
5. Style (optionnel — chill/culture/aventure/famille/romantique)

CAS 1 — PAS DE DESTINATION PRÉCISE :
Si l'utilisateur dit "je sais pas", "propose", "surprends-moi", ou donne juste budget+style → PROPOSE 3 destinations.
NE REPROPOSE PAS si tu l'as déjà fait — génère l'itinéraire de la destination choisie.

CAS 2 — DESTINATION CONNUE + infos suffisantes :
GÉNÈRE LA FEUILLE DE ROUTE COMPLÈTE avec vrais prix trouvés via web search.

═══════════════════════════════════════
QUAND TU GÉNÈRES LA FEUILLE DE ROUTE :

1. VOLS — cherche sur Google Flights / Skyscanner / Kayak :
   - Meilleur prix aller-retour depuis Paris (ou ville proche)
   - Compagnie, durée, escales
   - Lien de réservation direct

2. HÔTELS — cherche sur Booking.com :
   - 3 options (budget/confort/luxe) avec VRAIS prix par nuit
   - Quartier, note, points forts
   - Lien Booking direct

3. PROGRAMME JOUR PAR JOUR :
   - Matin / Après-midi / Soirée
   - Activités concrètes avec prix d'entrée si payant
   - Restaurant recommandé le soir avec fourchette de prix
   - Transport entre les étapes

4. BUDGET TOTAL DÉTAILLÉ :
   - Vols (aller-retour total)
   - Hébergement (X nuits × prix/nuit)
   - Activités et visites
   - Restaurants et repas
   - Transport local
   - TOTAL avec marge de sécurité 10%

5. CONSEILS PRATIQUES :
   - Meilleure période pour réserver
   - Transport depuis l'aéroport
   - Carte SIM / WiFi local
   - Ce qu'il ne faut pas manquer
   - Ce qu'il faut éviter

═══════════════════════════════════════
JSON UNIQUEMENT — 3 formats :

FORMAT 1 — Question :
{"type":"question","question":"ta question courte"}

FORMAT 2 — Suggestions destinations :
{"type":"suggestions","intro":"Voici 3 destinations parfaites selon tes critères :","destinations":[{"name":"Lisbonne, Portugal","emoji":"🇵🇹","why":"Culture riche, gastronomie excellente, soleil garanti, très abordable","price":"Dès 600€/semaine tout compris pour 2","tags":["culture","soleil","gastronomie"],"flight":"~150€ A/R depuis Paris","hotel":"Dès 80€/nuit centre-ville"}],"question":"Laquelle te tente ? Je génère ta feuille de route complète avec vols et hôtels !"}

FORMAT 3 — Feuille de route complète :
{"type":"itinerary","recap":"...","itinerary":{"destination":"Lisbonne","country":"Portugal","flag":"🇵🇹","duration":"7 jours","dates":"adaptable","travelers":"2 adultes","style":"culture","flights":{"outbound":{"from":"Paris CDG","to":"Lisbonne LIS","price":"142€/pers","airline":"TAP Air Portugal","duration":"2h30","link":"https://www.skyscanner.fr/..."},"return":{"from":"Lisbonne LIS","to":"Paris CDG","price":"142€/pers","airline":"TAP Air Portugal","duration":"2h30","link":"https://www.skyscanner.fr/..."}},"hotels":[{"name":"Hotel do Chiado","stars":4,"price":"95€","location":"Chiado — centre historique","highlight":"Vue sur les toits, petit-déjeuner inclus","booking_link":"https://www.booking.com/hotel/pt/do-chiado.fr.html","category":"confort"},{"name":"Lisbon Calling Hostel","stars":3,"price":"45€","location":"Mouraria","highlight":"Ambiance locale, rooftop","booking_link":"https://www.booking.com/...","category":"budget"},{"name":"Bairro Alto Hotel","stars":5,"price":"280€","location":"Bairro Alto","highlight":"Vue panoramique, spa","booking_link":"https://www.booking.com/...","category":"luxe"}],"days":[{"num":1,"title":"Arrivée et Alfama","morning":"Arrivée à LIS, transfert en metro (1.65€) jusqu'au centre. Check-in hôtel.","afternoon":"Découverte du quartier Alfama, Miradouro da Graça (gratuit), vue panoramique sur la ville","evening":"Dîner au restaurant Solar dos Presuntos — spécialités portugaises, budget 35€/2 pers","hotel":"Hotel do Chiado","budget":80,"activities":["Miradouro da Graça — gratuit","Cathédrale Sé — 5€/pers"],"restaurant":{"name":"Solar dos Presuntos","price":"35€ pour 2","specialty":"Bacalhau traditionnel"}}],"budget":{"flights_total":284,"accommodation_total":665,"activities_total":150,"food_total":280,"transport_local":45,"total":1424,"total_with_margin":1566,"per_person":783,"note":"Prix relevés le ${new Date().toLocaleDateString('fr')} — peuvent varier selon les dates exactes"},"tips":["Réserver les vols 6-8 semaines à l'avance pour les meilleurs prix","Le metro est le transport idéal : ticket 10 trajets = 9.10€","Éviter août (très chaud et touristique) — mai/juin ou septembre sont idéaux","Carte Lisboa Card (24h = 20€) : transports illimités + musées gratuits","Télécharger l'app MB Way pour payer partout sans frais"]}}`;`;

      const travelUser = `HISTORIQUE:
${histSummary||'Début'}

Questions posées: ${travelQAsked}/5

MESSAGE: ${message}`;

      // IA gratuite pour le ciblage et la génération selon ROI
      let travelRaw = null;

      if (travelStrategy === 'free' || travelQAsked < 5) {
        // Phase ciblage OU petit budget -> IA gratuite
        const depth = (travelBudget && travelBudget >= 300) ? 'deep' : 'fast';
        travelRaw = await callFreeAI(travelSys, travelUser, depth);
      }

      if (!travelRaw) {
        // Fallback Claude (toujours pour gros budget, ou si IA gratuite échoue)
        const tools = travelStrategy === 'paid'
          ? [{ type:"web_search_20250305", name:"web_search", max_uses: 2 }]
          : [];
        const rT = await fetch('https://api.anthropic.com/v1/messages', {
          method:'POST',
          headers:{'Content-Type':'application/json; charset=utf-8','x-api-key':process.env.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01'},
          body: JSON.stringify({ model:MODEL, max_tokens:1200, tools,
            system:[{type:'text',text:travelSys,cache_control:{type:'ephemeral'}}],
            messages:[{role:'user',content:travelUser}] })
        });
        const dT = await rT.json();
        if (rT.ok) { travelRaw=''; for(const b of dT.content){ if(b.type==='text') travelRaw+=b.text; } }
      }

      const tP = parseAgentJSON(travelRaw||'');

      // CAS 1 : question de ciblage
      if (tP.type === 'question' || (tP.needsInfo && tP.question)) {
        const q = tP.question || tP.needsInfo;
        return new Response(JSON.stringify({ reply: questionBox(q), sessionId:sid }), { headers:HEADERS });
      }

      // CAS 2 : suggestions de destinations
      if (tP.type === 'suggestions' && tP.destinations?.length) {
        let sugHtml = `<div style="font-size:13px;color:#374151;font-weight:600;margin-bottom:8px">${tP.intro||'Voici 3 destinations parfaites pour toi :'}</div>`;
        for (const d of tP.destinations) {
          sugHtml += `<div style="background:#fff;border:1.5px solid #e6ebf7;border-radius:16px;padding:14px;margin-top:8px;cursor:pointer" onclick="send('${d.name.replace(/'/g,"\'")}')">
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
              <span style="font-size:24px">${d.emoji||'🌍'}</span>
              <div>
                <div style="font-size:14px;font-weight:800;color:#0e1430">${d.name}</div>
                <div style="font-size:11px;color:#2f54ff;font-weight:700">${d.price||''}</div>
              </div>
            </div>
            <div style="font-size:12px;color:#374151;margin-bottom:8px">${d.why||''}</div>
            <div style="display:flex;flex-wrap:wrap;gap:5px">
              ${(d.tags||[]).map(t=>`<span style="background:#eff6ff;color:#2f54ff;border-radius:100px;padding:3px 10px;font-size:11px;font-weight:600">${t}</span>`).join('')}
            </div>
          </div>`;
        }
        if (tP.question) {
          sugHtml += questionBox(tP.question);
        }
        return new Response(JSON.stringify({ reply: sugHtml, sessionId:sid }), { headers:HEADERS });
      }

      // CAS 3 : feuille de route complète
      const itin = tP.itinerary || (tP.type === 'itinerary' ? tP.itinerary : null);
      if (!itin) {
        return new Response(JSON.stringify({ reply: questionBox("Dis-moi ta destination et ton budget pour que je génère ta feuille de route complète !"), sessionId:sid }), { headers:HEADERS });
      }

      let travelHtml = '';

      // ── Header destination ──────────────────────────────────
      travelHtml += `<div style="background:linear-gradient(135deg,#1f2da0,#2f54ff);border-radius:16px;padding:18px;margin-bottom:4px;text-align:center">
        <div style="font-size:32px;margin-bottom:6px">${itin.flag||'✈️'}</div>
        <div style="font-family:'Sora',sans-serif;font-size:20px;font-weight:800;color:#fff">${itin.destination}${itin.country?', '+itin.country:''}</div>
        <div style="font-size:12px;color:rgba(255,255,255,.75);margin-top:6px;display:flex;justify-content:center;gap:12px;flex-wrap:wrap">
          <span>📅 ${itin.duration}</span>
          <span>👥 ${itin.travelers||'2 pers.'}</span>
          ${itin.budget?.total?`<span>💰 ${itin.budget.total}€ estimé</span>`:''}
        </div>
      </div>`;

      // ── Récap ───────────────────────────────────────────────
      if (tP.recap) travelHtml += recapBox(tP.recap);

      // ── VOLS ────────────────────────────────────────────────
      if (itin.flights) {
        const f = itin.flights;
        travelHtml += `<div style="font-size:12px;font-weight:800;color:#0e1430;margin:14px 0 6px">✈️ Vols recommandés</div>`;
        const flightTotal = f.outbound?.price && f.return?.price
          ? `(Total A/R : ~${parseInt(f.outbound.price)*parseInt(itin.travelers||'2')*2||'voir site'}€)`
          : '';
        travelHtml += `<div style="background:#fff;border:1.5px solid #e6ebf7;border-radius:14px;overflow:hidden;margin-bottom:8px">`;
        if (f.outbound) {
          travelHtml += `<div style="padding:12px 14px;border-bottom:1px solid #f0f4ff">
            <div style="display:flex;justify-content:space-between;align-items:center">
              <div><span style="font-size:10px;font-weight:800;color:#7c89a8;text-transform:uppercase">Aller</span>
                <div style="font-size:13px;font-weight:700;color:#0e1430;margin-top:2px">${f.outbound.from||''} → ${f.outbound.to||''}</div>
                <div style="font-size:11px;color:#7c89a8">${f.outbound.airline||''} · ${f.outbound.duration||''}</div>
              </div>
              <div style="text-align:right">
                <div style="font-size:16px;font-weight:900;color:#2f54ff">${f.outbound.price||'Voir prix'}</div>
                <div style="font-size:10px;color:#7c89a8">par pers.</div>
              </div>
            </div>
          </div>`;
        }
        if (f.return) {
          travelHtml += `<div style="padding:12px 14px">
            <div style="display:flex;justify-content:space-between;align-items:center">
              <div><span style="font-size:10px;font-weight:800;color:#7c89a8;text-transform:uppercase">Retour</span>
                <div style="font-size:13px;font-weight:700;color:#0e1430;margin-top:2px">${f.return.from||''} → ${f.return.to||''}</div>
                <div style="font-size:11px;color:#7c89a8">${f.return.airline||''} · ${f.return.duration||''}</div>
              </div>
              <div style="text-align:right">
                <div style="font-size:16px;font-weight:900;color:#2f54ff">${f.return.price||'Voir prix'}</div>
                <div style="font-size:10px;color:#7c89a8">par pers.</div>
              </div>
            </div>
          </div>`;
        }
        travelHtml += `</div>`;
        const flightLink = f.outbound?.link || `https://www.skyscanner.fr/transport/vols/${encodeURIComponent((f.outbound?.from||'PAR').slice(0,3))}/${encodeURIComponent((f.outbound?.to||'LIS').slice(0,3))}/`;
        travelHtml += `<a href="${flightLink}" target="_blank" style="display:flex;align-items:center;justify-content:center;gap:8px;background:linear-gradient(135deg,#0e1430,#1f2da0);color:#fff;text-decoration:none;border-radius:12px;padding:11px;font-size:13px;font-weight:700;margin-bottom:4px">🔍 Comparer les vols sur Skyscanner →</a>`;
      }

      // ── HÔTELS ──────────────────────────────────────────────
      if (itin.hotels?.length) {
        travelHtml += `<div style="font-size:12px;font-weight:800;color:#0e1430;margin:14px 0 6px">🏨 Hébergements sur Booking.com</div>`;
        const catLabels = {budget:'💚 Budget',confort:'💙 Confort',luxe:'💎 Luxe'};
        for (const h of itin.hotels) {
          const nights = parseInt((itin.duration||'').match(/\d+/)?.[0]||'3');
          const bookUrl = h.booking_link || buildBookingLink(itin.destination, nights);
          const stars = '⭐'.repeat(Math.min(h.stars||3,5));
          const catLabel = catLabels[h.category] || '';
          travelHtml += `<a href="${bookUrl}" target="_blank" style="display:flex;flex-direction:column;background:#fff;border:1.5px solid #e6ebf7;border-radius:14px;padding:13px;margin-top:7px;text-decoration:none;gap:5px">
            <div style="display:flex;justify-content:space-between;align-items:flex-start">
              <div style="flex:1">
                <div style="display:flex;align-items:center;gap:6px;margin-bottom:2px">
                  ${catLabel?`<span style="font-size:10px;font-weight:800;background:#eff6ff;color:#2f54ff;border-radius:100px;padding:1px 8px">${catLabel}</span>`:''}
                </div>
                <div style="font-size:13px;font-weight:800;color:#0e1430">${h.name}</div>
                <div style="font-size:11px;color:#7c89a8">${stars} · ${h.location||''}</div>
              </div>
              <div style="background:linear-gradient(135deg,#2f54ff,#4a6bff);color:#fff;border-radius:10px;padding:6px 10px;text-align:right;flex-shrink:0;margin-left:8px">
                <div style="font-size:15px;font-weight:900">${h.price||'?'}€</div>
                <div style="font-size:9px;opacity:.8">/nuit</div>
              </div>
            </div>
            ${h.highlight?`<div style="font-size:11px;color:#2f54ff;font-weight:600;background:#eff6ff;border-radius:8px;padding:4px 10px">✨ ${h.highlight}</div>`:''}
            <div style="font-size:10.5px;color:#94a3b8;font-weight:600">Voir sur Booking.com →</div>
          </a>`;
        }
      }

      // ── PROGRAMME JOUR PAR JOUR ─────────────────────────────
      if (itin.days?.length) {
        travelHtml += `<div style="font-size:12px;font-weight:800;color:#0e1430;margin:16px 0 6px">📅 Programme jour par jour</div>`;
        for (const d of itin.days) {
          travelHtml += `<div style="background:#fff;border:1.5px solid #e6ebf7;border-radius:14px;padding:14px;margin-top:8px">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
              <div style="background:linear-gradient(135deg,#2f54ff,#4a6bff);color:#fff;border-radius:8px;padding:4px 12px;font-size:12px;font-weight:800">Jour ${d.num}</div>
              <div style="font-size:12px;font-weight:700;color:#0e1430">${d.title||''}</div>
              ${d.budget?`<div style="font-size:11px;color:#16a34a;font-weight:700">~${d.budget}€</div>`:''}
            </div>
            ${d.morning?`<div style="display:flex;gap:8px;margin-bottom:7px"><span style="font-size:16px">🌅</span><div><div style="font-size:11px;font-weight:700;color:#7c89a8;text-transform:uppercase;margin-bottom:1px">Matin</div><div style="font-size:12px;color:#374151">${d.morning}</div></div></div>`:''}
            ${d.afternoon?`<div style="display:flex;gap:8px;margin-bottom:7px"><span style="font-size:16px">☀️</span><div><div style="font-size:11px;font-weight:700;color:#7c89a8;text-transform:uppercase;margin-bottom:1px">Après-midi</div><div style="font-size:12px;color:#374151">${d.afternoon}</div></div></div>`:''}
            ${d.evening?`<div style="display:flex;gap:8px;margin-bottom:7px"><span style="font-size:16px">🌙</span><div><div style="font-size:11px;font-weight:700;color:#7c89a8;text-transform:uppercase;margin-bottom:1px">Soirée</div><div style="font-size:12px;color:#374151">${d.evening}</div></div></div>`:''}
            ${d.restaurant?`<div style="background:#f0fdf4;border-radius:8px;padding:7px 10px;margin-top:4px;display:flex;justify-content:space-between;align-items:center"><div style="font-size:11px;color:#16a34a;font-weight:700">🍽️ ${d.restaurant.name||''}</div><div style="font-size:11px;color:#16a34a">${d.restaurant.price||''}</div></div>`:''}
            ${d.activities?.length?`<div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:4px">${d.activities.map(a=>`<span style="background:#eff6ff;color:#2f54ff;border-radius:100px;padding:2px 9px;font-size:10.5px;font-weight:600">${a}</span>`).join('')}</div>`:''}
          </div>`;
        }
      }

      // ── BUDGET TOTAL ────────────────────────────────────────
      if (itin.budget) {
        const b = itin.budget;
        const items = [
          ['✈️ Vols A/R', b.flights_total],
          ['🏨 Hébergement', b.accommodation_total],
          ['🎯 Activités', b.activities_total],
          ['🍽️ Restaurants', b.food_total],
          ['🚇 Transport local', b.transport_local],
        ].filter(i=>i[1]);
        travelHtml += `<div style="background:linear-gradient(135deg,#0e1430,#1f2da0);border-radius:16px;padding:16px;margin-top:14px">
          <div style="font-size:13px;font-weight:800;color:#fff;margin-bottom:12px">💰 Budget total estimé</div>
          ${items.map(([l,v])=>`<div style="display:flex;justify-content:space-between;margin-bottom:7px"><span style="font-size:12px;color:rgba(255,255,255,.75)">${l}</span><span style="font-size:12px;font-weight:700;color:#fff">${v}€</span></div>`).join('')}
          <div style="border-top:1px solid rgba(255,255,255,.2);margin-top:10px;padding-top:10px">
            <div style="display:flex;justify-content:space-between;margin-bottom:5px">
              <span style="font-size:13px;font-weight:800;color:#fff">TOTAL</span>
              <span style="font-size:16px;font-weight:900;color:#bcd0ff">${b.total||''}€</span>
            </div>
            ${b.per_person?`<div style="font-size:11px;color:rgba(255,255,255,.6);text-align:right">soit ${b.per_person}€/personne</div>`:''}
          </div>
          ${b.note?`<div style="font-size:10px;color:rgba(255,255,255,.5);margin-top:8px;line-height:1.4">${b.note}</div>`:''}
        </div>`;
      }

      // ── CONSEILS PRATIQUES ──────────────────────────────────
      if (itin.tips?.length) travelHtml += tipsCard(itin.tips);

      // ── BOUTON WISHLIST VOYAGE ──────────────────────────────
      const voyageName = `Voyage ${(itin.destination||'')}${itin.country?' ('+itin.country+')':''}`;
      const voyagePrice = itin.budget?.total ? itin.budget.total+'€' : '';
      const voyageUrl = (itin.hotels||[])[0]?.booking_link || buildBookingLink(itin.destination||'', 5);
      const voyageData = JSON.stringify({name:voyageName,price:voyagePrice,store:'booking',url:voyageUrl}).replace(/"/g,'&quot;');
      travelHtml += `<button onclick="addToWishlist(${voyageData})" style="background:linear-gradient(135deg,#1f2da0,#2f54ff);border:none;color:#fff;border-radius:12px;padding:12px 16px;margin-top:12px;font-weight:700;font-size:13px;cursor:pointer;font-family:inherit;width:100%">♡ Sauvegarder ce voyage dans ma wishlist</button>`;
      travelHtml += '<div style="font-size:10px;color:#7c89a8;text-align:center;margin-top:6px">Retrouve cette feuille de route dans ton compte → Wishlist ✈️</div>';

      // Tracking Supabase
      if (trackingEnabled) {
        sbFetch('searches','POST',{query:`[VOYAGE] ${message}`,session_id:sid,user_id:userId||null});
      }

      return new Response(JSON.stringify({ reply:travelHtml, sessionId:sid }), { headers:HEADERS });
    }

    // ── FIN MODE VOYAGE ─────────────────────────────────────

    // ── PHASE 1 : CIBLAGE (IA gratuite en priorité) ───────────
    let decision = { ready: mustSearchNow, question: null, recap: null };

    if (!mustSearchNow) {
      const p1sys = `Tu es l'agent shopping de Huntify. SEULE tâche : décider si tu as assez d'infos ou poser UNE question.

RÈGLES :
1. LIS L'HISTORIQUE. Si une info est déjà là, NE LA REDEMANDE PAS.
2. Il manque parmi : catégorie précise, budget, usage/critères.
3. Si tout clair OU ${MAX_TARGETING_QUESTIONS} questions posées -> ready:true.
4. Sinon -> UNE question sur ce qui manque vraiment.

JSON UNIQUEMENT :
- {"ready":false,"question":"question"}
- {"ready":true,"recap":"Je cherche X, budget Y, critères Z"}`;

      const p1user = `HISTORIQUE:\n${histSummary || 'Début'}\n\nQuestions posées: ${questionsAsked}/${MAX_TARGETING_QUESTIONS}\n\nMESSAGE: ${message}`;

      // Groq -> Gemini -> Mistral -> Claude fallback
      let t1 = await callFreeAI(p1sys, p1user, 'fast');

      if (!t1) {
        const r1 = await fetch('https://api.anthropic.com/v1/messages', {
          method:'POST',
          headers:{'Content-Type':'application/json; charset=utf-8','x-api-key':process.env.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01'},
          body: JSON.stringify({ model:MODEL, max_tokens:250,
            system:[{type:'text',text:p1sys,cache_control:{type:'ephemeral'}}],
            messages:[{role:'user',content:p1user}] })
        });
        const d1 = await r1.json();
        if (r1.ok) { t1=''; for(const b of d1.content){ if(b.type==='text') t1+=b.text; } }
      }

      if (t1) {
        const d = parseAgentJSON(t1);
        decision.ready    = d.ready    === true;
        decision.question = d.question || null;
        decision.recap    = d.recap    || null;
      } else {
        decision.ready = true;
      }
    }

    if (!decision.ready && decision.question) {
      return new Response(JSON.stringify({ reply: questionBox(decision.question), sessionId: sid }), { headers: HEADERS });
    }

    // ── PHASE 2 : RECHERCHE avec ROI ROUTING ─────────────────
    const recapText = decision.recap || `Je cherche : ${message}`;
    const detectedBudget = detectBudget(recapText) || detectBudget(histSummary) || detectBudget(message);
    const strategy = routingStrategy(detectedBudget);

    let products=[], promoCodes=[], summary='';

    if (strategy === 'free_fast' || strategy === 'free_deep') {
      // IA gratuites : Groq 70B ou Gemini pour la recherche
      const depth = strategy === 'free_deep' ? 'deep' : 'fast';
      const storeMsg = strategy === 'free_deep'
        ? 'Cherche sur Amazon.fr ET Rakuten (fr.shopping.rakuten.com) avec prix réalistes.'
        : 'Cherche sur Amazon.fr avec prix réalistes.';

      const p2sys = `Tu es l'agent shopping de Huntify. Boutiques: ${activeNames}.
CONTEXTE : ${recapText}
${storeMsg}
SOIS INTELLIGENT : adapte les produits au contexte (occasion, pour qui, usage).
Ex: "cadeau 2 ans relation" → propose bijoux, expériences, accessoires romantiques selon budget.
Utilise ta connaissance des prix courants. Si prix inconnu, donne fourchette réaliste.
Mets badge utile : "Idéal en cadeau", "Coup de coeur", "Bestseller".
Ne fournis pas d'URL directes (risque 404), laisse url:null.

JSON UNIQUEMENT :
{"summary":"1 phrase","products":[{"name":"nom","price":"XX€","store":"amazon","keywords":"mots clés","url":null,"img":null,"badge":null},{"name":"nom","price":"Dès XX€","store":"rakuten","keywords":"mots clés","url":null,"img":null,"badge":null}],"promoCodes":[]}`;

      const p2user = `HISTORIQUE:\n${histSummary||'Début'}\n\nBESOIN: ${recapText}\n\nMESSAGE: ${message}`;

      let freeResult = await callFreeAI(p2sys, p2user, depth);

      if (!freeResult) {
        // Fallback Claude sans web search si toutes IA gratuites échouent
        const r2 = await fetch('https://api.anthropic.com/v1/messages', {
          method:'POST',
          headers:{'Content-Type':'application/json; charset=utf-8','x-api-key':process.env.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01'},
          body: JSON.stringify({ model:MODEL, max_tokens:400,
            system:[{type:'text',text:p2sys,cache_control:{type:'ephemeral'}}],
            messages:[{role:'user',content:p2user}] })
        });
        const d2 = await r2.json();
        if (r2.ok) { freeResult=''; for(const b of d2.content){ if(b.type==='text') freeResult+=b.text; } }
      }

      const p = parseAgentJSON(freeResult);
      products   = p.products   || [];
      promoCodes = p.promoCodes || [];
      summary    = p.summary    || '';

    } else {
      // Claude + web search (budget > 150EUR, ROI positif)
      const p2sys = `Tu es l'agent shopping de Huntify. Boutiques: ${activeNames}.

CONTEXTE DU BESOIN : ${recapText}

1. CHERCHE SUR AMAZON - 1 recherche web sur amazon.fr, 2 produits ADAPTÉS au contexte avec prix réels.
2. CHERCHE SUR RAKUTEN - 1 recherche web sur fr.shopping.rakuten.com, 1 produit. OBLIGATOIRE.
3. CODES PROMOS - dealabs.com si possible.

INTELLIGENCE CONTEXTUELLE :
- "cadeau 2 ans relation" → cherche idées cadeaux romantiques/expériences/bijoux selon budget
- "cadeau enfant 5 ans" → cherche jouets éducatifs adaptés à l'âge
- Adapte TOUJOURS les produits au contexte émotionnel et à l'occasion
- Mets dans "badge" une suggestion utile : "Idéal en cadeau", "Bestseller", "Livraison rapide"

RÈGLES :
- 2 Amazon + 1 Rakuten OBLIGATOIRES
- keywords: termes de recherche précis et adaptés au contexte (ex: "cadeau romantique couple bijou")
- url: null si pas certain
- Max 2 codes promos

JSON UNIQUEMENT :
{"summary":"1 phrase","products":[{"name":"nom","price":"XX€","store":"amazon","keywords":"mots","url":null,"img":null,"badge":null},{"name":"nom","price":"Dès XX€","store":"rakuten","keywords":"mots","url":null,"img":null,"badge":null}],"promoCodes":[{"code":"CODE","store":"boutique","discount":"-XX%","best":true}]}`;

      const agentResp = await fetch('https://api.anthropic.com/v1/messages', {
        method:'POST',
        headers:{'Content-Type':'application/json; charset=utf-8','x-api-key':process.env.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01'},
        body: JSON.stringify({
          model:MODEL, max_tokens:600,
          tools:[{type:"web_search_20250305",name:"web_search",max_uses:2}],
          system:[{type:'text',text:p2sys,cache_control:{type:'ephemeral'}}],
          messages:[{role:'user',content:`HISTORIQUE:\n${histSummary||'Début'}\n\nBESOIN: ${recapText}\n\nMESSAGE: ${message}`}]
        })
      });

      const agentData = await agentResp.json();
      if (!agentResp.ok) throw new Error(agentData.error?.message || 'Agent error');

      let raw=''; for(const b of agentData.content){ if(b.type==='text') raw+=b.text; }
      const p = parseAgentJSON(raw);
      products   = p.products   || [];
      promoCodes = p.promoCodes || [];
      summary    = p.summary    || '';
    }

    if (!products.length) {
      products = advertisers.slice(0,2).map(a=>({name:message,price:'Voir prix',store:a.slug,keywords:message,url:null,img:null,badge:null}));
      summary = `Résultats pour "${message}" :`;
    }

    // Historique prix
    let priceHistoryHtml = '';
    const mainProduct = products.find(p=>p.store==='amazon');
    if (mainProduct?.price && !mainProduct.price.includes('Voir')) {
      const cur = parseFloat(mainProduct.price.replace(/[^0-9.,]/g,'').replace(',','.'));
      const slug = mainProduct.name.toLowerCase().replace(/\s+/g,'-').slice(0,50);
      const hist = await sbFetch(`price_history?product_id=eq.${slug}&order=checked_at.desc&limit=10`) || [];
      if (hist.length > 1 && !isNaN(cur)) {
        const old = hist[hist.length-1].price;
        const trend = cur < old*0.97 ? 'down' : cur > old*1.03 ? 'up' : 'stable';
        priceHistoryHtml = priceHistoryBox(`${old}€`, trend);
      }
      if (!isNaN(cur)) sbFetch('price_history','POST',{product_id:slug,product_name:mainProduct.name,price:cur,store:'amazon',url:mainProduct.url||null});
    }

    for (const pr of products) {
      if (!pr.price || pr.price==='Voir prix' || pr.store==='amazon') continue;
      const priceNum = parseFloat(pr.price.replace('Dès ','').replace(/[^0-9.,]/g,'').replace(',','.'));
      if (!isNaN(priceNum)) {
        const pSlug = pr.name.toLowerCase().replace(/\s+/g,'-').slice(0,50);
        sbFetch('price_history','POST',{product_id:pSlug,product_name:pr.name,price:priceNum,store:pr.store,url:pr.url||null});
      }
    }
    for (const c of (promoCodes||[]).filter(c=>c.code)) {
      sbFetch('promo_codes','POST',{code:c.code,store:c.store||'unknown',discount:c.discount||'',product_query:message,found_at:new Date().toISOString(),valid:true}).catch(()=>{});
    }

    let buttons = '';
    for (const pr of products) {
      if (!pr.name) continue;
      const adv = findAdvertiser(advertisers, pr.store);
      if (!adv) continue;
      const url = buildAffiliateLink(adv, pr.keywords||pr.name, pr.url||null);
      if (!url) continue;
      buttons += productCard(pr.name, pr.price||'Voir prix', url, adv.color, adv.emoji, pr.img||null, pr.badge||null);
    }

    let promos = '';
    const sorted = (promoCodes||[]).filter(c=>c.code).sort((a,b)=>b.best-a.best).slice(0,2);
    for (const c of sorted) { promos += promoBox(c.code, c.store||'boutique', c.discount||'Réduction', c.best||false); }

    const first = products[0];
    const adv0 = first ? findAdvertiser(advertisers, first.store) : null;
    const wishlistBtn = first && adv0
      ? `<button onclick="addToWishlist(${JSON.stringify({name:first.name,price:first.price,store:first.store,url:buildAffiliateLink(adv0,first.keywords||first.name,first.url||null)}).replace(/"/g,'&quot;')})" style="background:#fff;border:1.5px solid #e8edf8;color:#3b5bdb;border-radius:12px;padding:8px 16px;margin-top:10px;font-weight:700;font-size:12px;cursor:pointer;font-family:inherit;width:100%">♡ Ajouter à ma wishlist</button>`
      : '';

    const reply =
      `<div style="font-size:13px;color:#374151;margin-bottom:6px;font-weight:500">${summary}</div>` +
      roiInfoBox(strategy, detectedBudget) +
      recapBox(recapText) +
      priceHistoryHtml + buttons +
      (promos ? `<div style="margin-top:4px">${promos}</div>` : '') +
      wishlistBtn;

    return new Response(JSON.stringify({reply, sessionId:sid}), { headers:HEADERS });

  } catch(error) {
    console.error('Error:', error.message);
    return new Response(JSON.stringify({reply:"Désolé, problème technique. Réessayez."}),
      { status:200, headers:{'Content-Type':'application/json; charset=utf-8','Access-Control-Allow-Origin':'*'} });
  }
}
