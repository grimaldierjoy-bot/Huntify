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
    const dest = adv.search_url.replace('{keywords}', rakutenKw);
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
      const travelSys = `Tu es l'agent voyage IA de Huntify. Tu crées des voyages sur-mesure.

CONTEXTE DÉJÀ COLLECTÉ (NE PAS REDEMANDER) :
${ctxSummary ? ctxSummary : 'Aucun — début de conversation'}

Tu es l'agent voyage IA de Huntify. Tu crées des voyages sur-mesure.

HISTORIQUE : ${histSummary || 'Début de conversation'}
Questions déjà posées : ${travelQAsked}/5

RÈGLE ABSOLUE : ne repose JAMAIS une question dont la réponse est déjà dans l'historique.

CAS 1 — L'UTILISATEUR N'A PAS DE DESTINATION PRÉCISE
Si le client dit "je sais pas", "propose-moi", "surprends-moi", "peu importe" ou donne seulement un style/budget/durée sans destination → PROPOSE 3 destinations adaptées.
Pour cela, tu dois d'abord connaître : budget, durée, style, nombre de voyageurs.
Si ces 4 infos sont disponibles → propose les destinations.
Sinon → pose UNE question pour collecter ce qui manque parmi ces 4.

CAS 2 — L'UTILISATEUR A UNE DESTINATION PRÉCISE
Collecte : dates/durée, nombre de voyageurs, budget, style.
Quand tout est réuni OU 5 questions posées → génère l'itinéraire complet.

QUAND TU PROPOSES DES DESTINATIONS (CAS 1) :
- 3 destinations variées et adaptées au profil (budget, style, durée)
- Pour chaque : nom, pays, pourquoi c'est parfait pour lui, fourchette de prix indicative
- Demande ensuite laquelle lui plaît

QUAND TU GÉNÈRES L'ITINÉRAIRE :
- Programme jour par jour (matin/après-midi/soirée)
- Adapté au style ET au budget
- 2-3 hébergements Booking.com avec prix réalistes
- Budget détaillé (hébergement/activités/repas/transport)
- 3-5 conseils pratiques

JSON UNIQUEMENT — 3 formats possibles :

1. Question de ciblage :
{"type":"question","question":"ta question"}

2. Suggestions de destinations :
{"type":"suggestions","intro":"Selon tes critères, voici 3 destinations parfaites :","destinations":[{"name":"Lisbonne, Portugal","emoji":"🇵🇹","why":"Idéale pour la culture, abordable, soleil garanti","price":"Dès 600€/semaine pour 2","tags":["culture","soleil","gastronomie"]},{"name":"Marrakech, Maroc","emoji":"🇲🇦","why":"Dépaysement total, budget serré, authenticité","price":"Dès 500€/semaine pour 2","tags":["dépaysement","culture","aventure"]},{"name":"Budapest, Hongrie","emoji":"🇭🇺","why":"Romantique, architecture splendide, très abordable","price":"Dès 550€/semaine pour 2","tags":["romantique","culture","fêtes"]}],"question":"Laquelle te tente le plus ? Je génère ton itinéraire complet !"}

3. Itinéraire complet :
{"type":"itinerary","recap":"Destination X, Y nuits, Z pers, budget W€, style S","itinerary":{"destination":"X","duration":"Y jours","style":"S","days":[{"num":1,"title":"Titre","morning":"...","afternoon":"...","evening":"...","hotel":"Nom hôtel","budget":150}],"hotels":[{"name":"Nom","stars":3,"price":"90€","location":"Quartier","highlight":"Point fort"}],"budget":{"total":1200,"hebergement":450,"activites":200,"repas":300,"transport":150,"note":"Estimations"},"tips":["Conseil 1","Conseil 2","Conseil 3"]}}`;

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

      // CAS 3 : itinéraire complet
      const itin = tP.itinerary || (tP.type === 'itinerary' ? tP.itinerary : null);
      if (!itin) {
        return new Response(JSON.stringify({ reply: questionBox("Dis-moi ton budget, la durée et le style de voyage souhaité !"), sessionId:sid }), { headers:HEADERS });
      }

      // Construction de la réponse voyage
      let travelHtml = '';

      // Header destination
      travelHtml += `<div style="background:linear-gradient(135deg,#1f2da0,#2f54ff);border-radius:16px;padding:16px;margin-bottom:4px;text-align:center">
        <div style="font-size:24px;margin-bottom:6px">✈️</div>
        <div style="font-family:'Sora',sans-serif;font-size:18px;font-weight:800;color:#fff">${itin.destination}</div>
        <div style="font-size:12px;color:rgba(255,255,255,.75);margin-top:4px">${itin.duration} · ${itin.style} · ${travelBudget||''}${travelBudget?'€':''}</div>
      </div>`;

      // Récap
      if (tP.recap) travelHtml += recapBox(tP.recap);

      // Jours
      if (itin.days?.length) {
        travelHtml += `<div style="font-size:12px;font-weight:800;color:#0e1430;margin:12px 0 4px">📅 Programme jour par jour</div>`;
        for (const d of itin.days) travelHtml += dayCard(d);
      }

      // Hôtels Booking
      if (itin.hotels?.length) {
        travelHtml += `<div style="font-size:12px;font-weight:800;color:#0e1430;margin:14px 0 4px">🏨 Hébergements suggérés sur Booking.com</div>`;
        for (const h of itin.hotels) {
          const dest = itin.destination;
          const nights = parseInt((itin.duration||'').match(/\d+/)?.[0]||'3');
          travelHtml += hotelCard({...h, url: buildBookingLink(dest, nights)});
        }
      }

      // Budget
      if (itin.budget) travelHtml += budgetCard(itin.budget);

      // Conseils
      if (itin.tips?.length) travelHtml += tipsCard(itin.tips);

      // Indicateur ROI
      if (travelStrategy === 'free') {
        travelHtml += `<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:8px 12px;margin-top:10px;font-size:11px;color:#16a34a;font-weight:600">🔍 Mode économique — pour des disponibilités et prix en temps réel, précise un budget plus élevé</div>`;
      }

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
${storeMsg}
Utilise ta connaissance des prix courants. Si prix inconnu, donne fourchette réaliste.
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

1. CHERCHE SUR AMAZON - 1 recherche web sur amazon.fr, 2 produits prix réels.
2. CHERCHE SUR RAKUTEN - 1 recherche web sur fr.shopping.rakuten.com, 1 produit. OBLIGATOIRE.
3. CODES PROMOS - dealabs.com si possible.

RÈGLES :
- 2 Amazon + 1 Rakuten OBLIGATOIRES
- keywords: termes simples sans virgules (ex: "casque sony bluetooth")
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
