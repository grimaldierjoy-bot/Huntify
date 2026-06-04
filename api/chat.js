export const config = { runtime: 'edge' };

// ============================================================
// HUNTIFY — chat.js COMPLET v5
// - AI Router : Groq → Gemini → Mistral → Claude (fallback)
// - ROI routing : < 80€ free_fast | 80-150€ free_deep | > 150€ paid_deep
// - Mode PRODUIT : ciblage contextuel (cadeaux, occasions) + pastille store
// - Mode VOYAGE : feuille de route complète (vols, hôtels 3 cats, jours, budget)
// - DeepSearch déclenché pour les gros budgets voyage (> 300€)
// - Wishlist : produits ET voyages, affichage différencié
// - Fix Rakuten : /s/ forcé même si DB pas à jour
// ============================================================

const SUPABASE_URL  = "https://enocxbrqyybendertytl.supabase.co";
const SUPABASE_KEY  = "sb_publishable_NmPh--frZG5HuqfaoxnemA_E7cidV9Y";
const MODEL         = 'claude-haiku-4-5';
const MAX_Q         = 2;
const TRAVEL_THRESHOLD = 300; // EUR — au-dessus : Claude + web search

// ── Supabase ─────────────────────────────────────────────────
async function sbFetch(path, method='GET', body=null) {
  const opts = { method, headers:{'Content-Type':'application/json','apikey':SUPABASE_KEY,'Authorization':`Bearer ${SUPABASE_KEY}`} };
  if (body) opts.body = JSON.stringify(body);
  try { const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, opts); return await r.json(); } catch(e) { return null; }
}
async function getAdvertisers() {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/advertisers?active=eq.true`, {
      headers:{'apikey':SUPABASE_KEY,'Authorization':`Bearer ${SUPABASE_KEY}`}
    });
    return await r.json();
  } catch(e) { return []; }
}

// ── Keywords & liens affiliés ─────────────────────────────────
function cleanKw(kw) {
  if (!kw) return '';
  const stop = new Set(['de','la','le','les','un','une','des','pour','avec','et','en','du','au','aux','style','classique']);
  return kw.replace(/,/g,' ').replace(/\s+/g,' ').trim()
    .split(' ').filter(w=>w.length>1&&!stop.has(w.toLowerCase())).slice(0,5).join(' ');
}

function buildLink(adv, keywords, directUrl=null) {
  if (!adv?.active) return null;
  const kw = cleanKw(keywords);
  if (adv.slug === 'amazon') {
    const base = directUrl?.includes('amazon.fr') ? directUrl : `https://www.amazon.fr/s?k=${encodeURIComponent(kw)}`;
    return `${base}${base.includes('?')?'&':'?'}tag=${adv.amazon_tag}`;
  }
  if (adv.awin_mid) {
    // Fix Rakuten définitif : force /s/ même si DB contient encore /search?keyword=
    let searchBase = adv.search_url || 'https://fr.shopping.rakuten.com/s/{keywords}';
    if (searchBase.includes('/search?keyword=') || searchBase.includes('?keyword=')) {
      searchBase = 'https://fr.shopping.rakuten.com/s/{keywords}';
    }
    const rkw = encodeURIComponent(kw).replace(/%20/g,'+');
    const dest = searchBase.replace('{keywords}', rkw);
    return `https://www.awin1.com/cread.php?awinmid=${adv.awin_mid}&awinaffid=${adv.awin_aff}&ued=${encodeURIComponent(dest)}`;
  }
  return null;
}

function findAdv(advertisers, slug) {
  return advertisers.find(a=>a.slug===slug?.toLowerCase())||null;
}

// ── Consultation DB interne (source 1, gratuite) ──────────────
// Cherche dans Supabase si on a déjà des données utiles sur ce produit
async function queryInternalDB(keywords, budget) {
  const kw = (keywords||'').toLowerCase().trim();
  const results = { deals:[], prices:[], promos:[], hasData:false };
  
  try {
    // 1. Daily deals actifs qui correspondent
    const deals = await sbFetch(`daily_deals?name=ilike.*${encodeURIComponent(kw.split(' ')[0])}*&limit=3`);
    if (deals?.length) {
      results.deals = deals;
      results.hasData = true;
    }
    
    // 2. Historique des prix récents sur ce type de produit
    const prices = await sbFetch(`price_history?product_name=ilike.*${encodeURIComponent(kw.split(' ')[0])}*&order=checked_at.desc&limit=5`);
    if (prices?.length) {
      results.prices = prices;
      results.hasData = true;
    }
    
    // 3. Codes promos existants dans notre base
    const promos = await sbFetch(`promo_codes?valid=eq.true&order=found_at.desc&limit=3`);
    if (promos?.length) {
      results.promos = promos;
    }
  } catch(e) { /* DB indisponible -> on continue sans */ }
  
  return results;
}

// Construit un contexte DB à injecter dans le prompt
function buildDBContext(dbData) {
  if (!dbData.hasData) return '';
  const parts = ['DONNEES INTERNES DISPONIBLES (utilise en priorite) :'];
  if (dbData.deals?.length) {
    parts.push('Deals actuels : ' + dbData.deals.map(d=>`${d.name} ${d.price||''} chez ${d.store||''}`).join(' | '));
  }
  if (dbData.prices?.length) {
    parts.push('Historique prix : ' + dbData.prices.map(p=>`${p.product_name} ${p.price}EUR (${p.store})`).join(' | '));
  }
  if (dbData.promos?.length) {
    parts.push('Codes promos : ' + dbData.promos.map(p=>`${p.code} (${p.store} ${p.discount||''})`).join(' | '));
  }
  return parts.join('\n');
}

function buildBookingLink(destination, nights=5, adults=2) {
  const pubId = process.env.CJ_PUBLISHER_ID||null;
  const advId = process.env.CJ_BOOKING_ADVERTISER_ID||null;
  const dest  = encodeURIComponent(destination||'');
  const base  = `https://www.booking.com/search.html?ss=${dest}&group_adults=${adults}&nights=${nights}`;
  if (!pubId||!advId) return base;
  return `https://www.anrdoezrs.net/click-${pubId}-${advId}?url=${encodeURIComponent(base)}`;
}

// ── ROI routing ───────────────────────────────────────────────
function detectBudget(text) {
  if (!text) return null;
  const p = [
    /(?:moins de|maxi|maximum|budget|environ|max)[^\d]*(\d+)\s*(?:€|euros?)/i,
    /(\d+)\s*(?:€|euros?)\s*(?:max|maxi|maximum|environ|budget)/i,
    /budget[^\d]*(\d+)/i,
    /(\d{2,})\s*€/,
  ];
  for (const r of p) { const m=text.match(r); if(m){const b=parseInt(m[1]);if(b>0&&b<100000)return b;} }
  return null;
}
function routingStrategy(budget) {
  if (budget===null) return 'paid_deep';
  if (budget<80)     return 'free_fast';
  if (budget<150)    return 'free_deep';
  return 'paid_deep';
}

// ── AI Router (IA gratuites) ──────────────────────────────────
async function callGroq(sys, user, model, maxTok) {
  const key=process.env.GROQ_API_KEY; if(!key) return null;
  try {
    const r=await fetch('https://api.groq.com/openai/v1/chat/completions',{
      method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${key}`},
      body:JSON.stringify({model,max_tokens:maxTok,messages:[{role:'system',content:sys},{role:'user',content:user}]})
    });
    if(!r.ok) return null;
    const d=await r.json(); return d.choices?.[0]?.message?.content||null;
  } catch(e){return null;}
}
async function callGemini(sys, user, maxTok) {
  const key=process.env.GEMINI_API_KEY; if(!key) return null;
  try {
    const r=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`,{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({contents:[{parts:[{text:`${sys}\n\n${user}`}]}],generationConfig:{maxOutputTokens:maxTok}})
    });
    if(!r.ok) return null;
    const d=await r.json(); return d.candidates?.[0]?.content?.parts?.[0]?.text||null;
  } catch(e){return null;}
}
async function callMistral(sys, user, maxTok) {
  const key=process.env.MISTRAL_API_KEY; if(!key) return null;
  try {
    const r=await fetch('https://api.mistral.ai/v1/chat/completions',{
      method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${key}`},
      body:JSON.stringify({model:'mistral-small-latest',max_tokens:maxTok,messages:[{role:'system',content:sys},{role:'user',content:user}]})
    });
    if(!r.ok) return null;
    const d=await r.json(); return d.choices?.[0]?.message?.content||null;
  } catch(e){return null;}
}
async function callFreeAI(sys, user, depth='fast') {
  const model = depth==='deep' ? 'llama-3.3-70b-versatile' : 'llama-3.1-8b-instant';
  const tok   = depth==='deep' ? 800 : 280;
  return await callGroq(sys,user,model,tok) || await callGemini(sys,user,tok) || await callMistral(sys,user,tok);
}

// Vérifie si au moins une IA gratuite est configurée
function hasFreeAI() {
  return !!(process.env.GROQ_API_KEY || process.env.GEMINI_API_KEY || process.env.MISTRAL_API_KEY);
}
async function callClaude(sys, user, maxTok=600, tools=[]) {
  const r=await fetch('https://api.anthropic.com/v1/messages',{
    method:'POST',
    headers:{'Content-Type':'application/json; charset=utf-8','x-api-key':process.env.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01'},
    body:JSON.stringify({model:MODEL,max_tokens:maxTok,tools,system:[{type:'text',text:sys,cache_control:{type:'ephemeral'}}],messages:[{role:'user',content:user}]})
  });
  const d=await r.json();
  if(!r.ok) throw new Error(d.error?.message||'Claude error');
  let t=''; for(const b of d.content){if(b.type==='text')t+=b.text;} return t;
}

// ── JSON parser ───────────────────────────────────────────────
function parseJSON(raw) {
  if(!raw) return {};
  try { const m=raw.match(/\{[\s\S]*\}/); if(m) return JSON.parse(m[0]); } catch(e){}
  return {};
}

// ── Historique propre ─────────────────────────────────────────
function buildHistory(history) {
  return (history||[]).map(m=>{
    const role = m.role==='user'?'Client':'Agent';
    const text = (m.content||'').replace(/<[^>]*>/g,' ').replace(/&[^;]+;/g,' ').replace(/\s+/g,' ').trim().slice(0,400);
    return text ? `${role}: ${text}` : null;
  }).filter(Boolean).join('\n').slice(0,2000);
}
function countQ(history) {
  return (history||[]).filter(m=>m.role!=='user'&&(m.content||'').includes('data-qbox')).length;
}

// ── HTML helpers ──────────────────────────────────────────────
function qBox(q)    { return `<div data-qbox="1" style="background:#eff6ff;border:1.5px solid #bfdbfe;border-radius:12px;padding:12px 14px;margin-top:8px;font-size:13px;color:#1e40af;font-weight:600">💬 ${q}</div>`; }
function recapBox(r){ return `<div style="background:#f5f3ff;border:1.5px solid #ddd6fe;border-radius:12px;padding:10px 14px;margin-top:8px;font-size:12px;color:#5b21b6;font-weight:600">🔎 ${r}</div>`; }

// Carte produit avec pastille store
function productCard(name, price, url, adv, img, badge) {
  const imgHtml = img?`<img src="${img}" style="width:56px;height:56px;object-fit:cover;border-radius:8px;flex-shrink:0" onerror="this.style.display='none'">`:'';
  const badgeHtml = badge?`<span style="background:rgba(255,255,255,.22);border-radius:100px;padding:2px 8px;font-size:10px;font-weight:700">${badge}</span>`:'';
  // Pastille store
  const storePill = `<span style="background:rgba(255,255,255,.18);border:1px solid rgba(255,255,255,.35);border-radius:100px;padding:2px 9px;font-size:10px;font-weight:800;letter-spacing:.3px">${adv.emoji} ${adv.name}</span>`;
  return `<a href="${url}" target="_blank" style="display:flex;align-items:center;gap:12px;background:${adv.color};color:#fff;text-decoration:none;border-radius:14px;padding:12px 14px;margin-top:8px;font-weight:700;font-size:13px">
    ${imgHtml}
    <div style="flex:1;min-width:0">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;flex-wrap:wrap">${storePill}${badgeHtml}</div>
      <div style="font-size:13px;font-weight:800;line-height:1.3;word-break:break-word">${name}</div>
    </div>
    <span style="background:rgba(255,255,255,.22);border-radius:8px;padding:5px 10px;white-space:nowrap;font-size:14px;font-weight:900;flex-shrink:0">${price}</span>
  </a>`;
}

function promoBox(code, store, desc, best) {
  return `<div style="background:${best?'#dcfce7':'#f0fdf4'};border:${best?'2px solid #16a34a':'1.5px solid #86efac'};border-radius:12px;padding:10px 14px;margin-top:6px;display:flex;align-items:center;justify-content:space-between;gap:8px">
    <div><span style="font-size:11px;color:#16a34a;font-weight:700">${best?'⭐ MEILLEUR — ':''}🏷️ ${store}</span><div style="font-size:12px;color:#166534;font-weight:600">${desc}</div></div>
    <div onclick="navigator.clipboard.writeText('${code}');this.innerHTML='✓';setTimeout(()=>this.innerHTML='${code}',2000)" style="background:#16a34a;color:#fff;border-radius:8px;padding:6px 10px;font-weight:800;font-size:12px;cursor:pointer;white-space:nowrap;flex-shrink:0">${code}</div>
  </div>`;
}

function priceHistBox(old, trend) {
  const icon  = trend==='down'?'📉':trend==='up'?'📈':'➡️';
  const color = trend==='down'?'#dcfce7':trend==='up'?'#fee2e2':'#f1f5f9';
  const border= trend==='down'?'#86efac':trend==='up'?'#fca5a5':'#e2e8f0';
  const msg   = trend==='down'?`Prix en baisse ! Était à ${old}€ ✅`:trend==='up'?`⚠️ Prix gonflé ! Était à ${old}€`:'Prix stable';
  return `<div style="background:${color};border:1.5px solid ${border};border-radius:12px;padding:10px 14px;margin-top:8px;font-size:12px;font-weight:600;color:#374151">${icon} ${msg}</div>`;
}

// ── Helpers HTML voyage ───────────────────────────────────────
function hotelCard(h, bookingUrl) {
  const stars='⭐'.repeat(Math.min(h.stars||3,5));
  const catColors={budget:'#16a34a',confort:'#2f54ff',luxe:'#7c3aed'};
  const catLabels={budget:'💚 Budget',confort:'💙 Confort',luxe:'💎 Luxe'};
  const cc=catColors[h.category]||'#2f54ff';
  const cl=catLabels[h.category]||'';
  return `<a href="${h.booking_link||bookingUrl}" target="_blank" style="display:flex;flex-direction:column;background:#fff;border:1.5px solid #e6ebf7;border-radius:14px;padding:13px;margin-top:8px;text-decoration:none;gap:5px">
    <div style="display:flex;justify-content:space-between;align-items:flex-start">
      <div style="flex:1">
        ${cl?`<span style="background:#eff6ff;color:${cc};border-radius:100px;padding:2px 9px;font-size:10px;font-weight:800">${cl}</span>`:''}
        <div style="font-size:13px;font-weight:800;color:#0e1430;margin-top:3px">${h.name}</div>
        <div style="font-size:11px;color:#7c89a8">${stars} · ${h.location||''}</div>
      </div>
      <div style="background:linear-gradient(135deg,${cc},${cc}cc);color:#fff;border-radius:10px;padding:7px 11px;text-align:right;flex-shrink:0;margin-left:8px">
        <div style="font-size:15px;font-weight:900">${h.price||'?'}€</div>
        <div style="font-size:9px;opacity:.8">/nuit</div>
      </div>
    </div>
    ${h.highlight?`<div style="font-size:11px;color:#2f54ff;font-weight:600;background:#eff6ff;border-radius:8px;padding:4px 10px">✨ ${h.highlight}</div>`:''}
    <div style="font-size:10.5px;color:#94a3b8;font-weight:600">🏨 Voir sur Booking.com →</div>
  </a>`;
}

function dayCard(d) {
  return `<div style="background:#fff;border:1.5px solid #e6ebf7;border-radius:14px;padding:14px;margin-top:9px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
      <div style="background:linear-gradient(135deg,#2f54ff,#4a6bff);color:#fff;border-radius:8px;padding:4px 12px;font-size:12px;font-weight:800">Jour ${d.num}</div>
      <div style="font-size:12px;font-weight:700;color:#0e1430;text-align:right;flex:1;margin-left:8px">${d.title||''}</div>
      ${d.budget?`<div style="font-size:11px;color:#16a34a;font-weight:700;margin-left:8px">~${d.budget}€</div>`:''}
    </div>
    ${d.morning?`<div style="display:flex;gap:9px;margin-bottom:8px"><span style="font-size:16px;flex-shrink:0">🌅</span><div><div style="font-size:10px;font-weight:800;color:#94a3b8;text-transform:uppercase;margin-bottom:1px">Matin</div><div style="font-size:12px;color:#374151">${d.morning}</div></div></div>`:''}
    ${d.afternoon?`<div style="display:flex;gap:9px;margin-bottom:8px"><span style="font-size:16px;flex-shrink:0">☀️</span><div><div style="font-size:10px;font-weight:800;color:#94a3b8;text-transform:uppercase;margin-bottom:1px">Après-midi</div><div style="font-size:12px;color:#374151">${d.afternoon}</div></div></div>`:''}
    ${d.evening?`<div style="display:flex;gap:9px;margin-bottom:4px"><span style="font-size:16px;flex-shrink:0">🌙</span><div><div style="font-size:10px;font-weight:800;color:#94a3b8;text-transform:uppercase;margin-bottom:1px">Soirée</div><div style="font-size:12px;color:#374151">${d.evening}</div></div></div>`:''}
    ${d.restaurant?`<div style="background:#f0fdf4;border-radius:9px;padding:7px 11px;margin-top:6px;display:flex;justify-content:space-between;align-items:center"><div style="font-size:11px;color:#16a34a;font-weight:700">🍽️ ${d.restaurant.name||''}</div><div style="font-size:11px;color:#16a34a;font-weight:700">${d.restaurant.price||''}</div></div>`:''}
    ${d.activities?.length?`<div style="margin-top:7px;display:flex;flex-wrap:wrap;gap:4px">${d.activities.map(a=>`<span style="background:#eff6ff;color:#2f54ff;border-radius:100px;padding:2px 9px;font-size:10.5px;font-weight:600">${a}</span>`).join('')}</div>`:''}
  </div>`;
}

function budgetCard(b) {
  const items=[['✈️ Vols A/R',b.flights_total],['🏨 Hébergement',b.accommodation_total],['🎯 Activités',b.activities_total],['🍽️ Restaurants',b.food_total],['🚇 Transport local',b.transport_local]].filter(i=>i[1]);
  return `<div style="background:linear-gradient(135deg,#0e1430,#1f2da0);border-radius:16px;padding:16px;margin-top:12px">
    <div style="font-size:13px;font-weight:800;color:#fff;margin-bottom:12px">💰 Budget total estimé</div>
    ${items.map(([l,v])=>`<div style="display:flex;justify-content:space-between;margin-bottom:7px"><span style="font-size:12px;color:rgba(255,255,255,.75)">${l}</span><span style="font-size:12px;font-weight:700;color:#fff">${v}€</span></div>`).join('')}
    <div style="border-top:1px solid rgba(255,255,255,.2);margin-top:10px;padding-top:10px;display:flex;justify-content:space-between">
      <span style="font-size:13px;font-weight:800;color:#fff">TOTAL</span>
      <span style="font-size:16px;font-weight:900;color:#bcd0ff">${b.total||''}€</span>
    </div>
    ${b.per_person?`<div style="font-size:11px;color:rgba(255,255,255,.6);text-align:right;margin-top:3px">soit ${b.per_person}€/personne</div>`:''}
    ${b.note?`<div style="font-size:10px;color:rgba(255,255,255,.5);margin-top:8px;line-height:1.4">${b.note}</div>`:''}
  </div>`;
}

function tipsCard(tips) {
  if(!tips?.length) return '';
  return `<div style="background:#f5f3ff;border:1.5px solid #ddd6fe;border-radius:14px;padding:14px;margin-top:10px">
    <div style="font-size:12px;font-weight:800;color:#5b21b6;margin-bottom:8px">💡 Conseils pratiques</div>
    ${tips.map(t=>`<div style="font-size:12px;color:#374151;margin-bottom:5px;padding-left:8px;border-left:2px solid #c4b5fd">• ${t}</div>`).join('')}
  </div>`;
}

// ── HANDLER PRINCIPAL ─────────────────────────────────────────
export default async function handler(req) {
  if (req.method==='OPTIONS') return new Response(null,{status:204,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type'}});
  if (req.method!=='POST') return new Response('Method not allowed',{status:405});

  const H = {'Content-Type':'application/json; charset=utf-8','Access-Control-Allow-Origin':'*'};

  try {
    const { message, history, sessionId, userId, trackingEnabled, mode, travelContext } = await req.json();
    const sid = sessionId || `anon_${Date.now()}`;
    const isTravel = mode === 'travel';

    const advertisers = await getAdvertisers();
    const activeNames = advertisers.map(a=>a.name).join(', ');

    if (trackingEnabled) {
      Promise.all([
        sbFetch('searches','POST',{query:message,session_id:sid,user_id:userId||null}),
        sbFetch('trends','POST',{query:message.toLowerCase().trim(),count:1,last_searched:new Date().toISOString()})
      ]);
    }

    const hist     = buildHistory(history);
    const qAsked   = countQ(history);
    const ctx      = travelContext||{};
    const ctxStr   = Object.entries(ctx).filter(([k,v])=>v&&k!=='suggestionsShown').map(([k,v])=>`${k}: ${v}`).join(', ');

    // ══════════════════════════════════════════════════════════
    // MODE VOYAGE
    // ══════════════════════════════════════════════════════════
    if (isTravel) {
      const tBudget   = detectBudget(ctxStr)||detectBudget(hist)||detectBudget(message);
      const tStrategy = (tBudget&&tBudget>=TRAVEL_THRESHOLD) ? 'paid' : 'free';

      const tSys = `Tu es l'agent voyage IA de Huntify. Tu crées des feuilles de route complètes comme un vrai agent de voyage.

CONTEXTE DÉJÀ COLLECTÉ — NE PAS REDEMANDER :
${ctxStr||'Aucun — début de conversation'}

HISTORIQUE : ${hist||'Début'}
Questions posées : ${qAsked}/5

RÈGLE ANTI-BOUCLE ABSOLUE :
- Ne redemande JAMAIS ce qui est déjà dans le contexte ou l'historique
- Si destination déjà choisie → génère l'itinéraire directement, ne pose plus de question dessus
- Si tu as destination + budget ou durée → génère sans attendre plus

INFOS À COLLECTER (une à la fois si manquante) :
1. Destination — ou style/envie si l'utilisateur ne sait pas
2. Durée ou dates
3. Budget total
4. Nombre de voyageurs
5. Style : chill | culture | aventure | famille | romantique | mix

CAS 1 — PAS DE DESTINATION :
Propose 3 destinations adaptées au profil avec prix indicatifs vols + hôtels.
Ne re-propose pas si déjà fait — génère l'itinéraire de celle choisie.

CAS 2 — DESTINATION CONNUE :
Génère la FEUILLE DE ROUTE COMPLÈTE :
1. VOLS — Recherche aller/retour depuis Paris : prix réaliste, compagnie, durée
2. HÔTELS BOOKING — 3 catégories (budget/confort/luxe) avec prix/nuit réaliste et lien Booking direct
3. PROGRAMME JOUR PAR JOUR — Matin/Après-midi/Soirée avec activités concrètes et prix
4. RESTAURANTS — 1 restaurant recommandé par soirée avec spécialité et fourchette de prix
5. BUDGET TOTAL — vols + hébergement + activités + restaurants + transport local + marge 10%
6. CONSEILS PRATIQUES — transport aéroport, carte SIM, période idéale, bons plans

JSON UNIQUEMENT — 3 formats :

Question : {"type":"question","question":"..."}

Suggestions destinations :
{"type":"suggestions","intro":"...","destinations":[{"name":"Lisbonne, Portugal","emoji":"🇵🇹","why":"...","price":"Dès 700€/semaine pour 2","flight":"~150€ A/R","hotel":"Dès 80€/nuit","tags":["culture","soleil"]}],"question":"Laquelle te tente ?"}

Feuille de route complète :
{"type":"itinerary","recap":"...","itinerary":{"destination":"Lisbonne","country":"Portugal","flag":"🇵🇹","duration":"7 jours","travelers":"2 adultes","style":"culture","flights":{"outbound":{"from":"Paris CDG","to":"Lisbonne LIS","price":"145€","airline":"TAP Air Portugal","duration":"2h30","link":null},"return":{"from":"Lisbonne LIS","to":"Paris CDG","price":"145€","airline":"TAP Air Portugal","duration":"2h30","link":null}},"hotels":[{"name":"Hotel do Chiado","stars":4,"price":"95","location":"Chiado","highlight":"Vue sur les toits","booking_link":null,"category":"confort"},{"name":"Yes! Lisbon Hostel","stars":3,"price":"40","location":"Mouraria","highlight":"Ambiance locale","booking_link":null,"category":"budget"},{"name":"Bairro Alto Hotel","stars":5,"price":"290","location":"Bairro Alto","highlight":"Vue panoramique","booking_link":null,"category":"luxe"}],"days":[{"num":1,"title":"Arrivée et Alfama","morning":"Arrivée LIS, metro vers le centre (1.65€)","afternoon":"Quartier Alfama, Miradouro da Graça — gratuit","evening":"Découverte du Bairro Alto animé","restaurant":{"name":"Solar dos Presuntos","price":"35€/2 pers","specialty":"Bacalhau traditionnel"},"activities":["Miradouro da Graça — gratuit","Cathédrale Sé — 5€/pers"],"hotel":"Hotel do Chiado","budget":90}],"budget":{"flights_total":290,"accommodation_total":665,"activities_total":150,"food_total":280,"transport_local":40,"total":1425,"per_person":712,"note":"Prix relevés en juin 2026, variables selon dates exactes"},"tips":["Réserver vols 6-8 semaines à l'avance","Metro : 10 trajets = 9.10€","Éviter août — préférer mai/juin ou septembre","Lisboa Card 24h = 20€ : transports + musées gratuits","App MB Way pour payer sans frais"]}}`;

      const tUser = `HISTORIQUE:\n${hist||'Début'}\n\nQuestions posées: ${qAsked}/5\n\nMESSAGE: ${message}`;

      // DeepSearch : Claude + web search pour gros budgets voyage
      let tRaw = null;
      if (tStrategy === 'paid') {
        tRaw = await callClaude(tSys, tUser, 1500, [{type:"web_search_20250305",name:"web_search",max_uses:3}]);
      } else {
        // ⚡ VOYAGE GRATUIT : Groq → Gemini → Mistral uniquement
        tRaw = await callFreeAI(tSys, tUser, 'deep');
      }

      const tP = parseJSON(tRaw||'');

      // Question de ciblage
      if (tP.type==='question'||(tP.needsInfo&&tP.question)) {
        return new Response(JSON.stringify({reply:qBox(tP.question||tP.needsInfo),sessionId:sid}),{headers:H});
      }

      // Suggestions de destinations
      if (tP.type==='suggestions'&&tP.destinations?.length) {
        let html=`<div style="font-size:13px;color:#374151;font-weight:600;margin-bottom:8px">${tP.intro||'Voici 3 destinations parfaites :'}</div>`;
        for(const d of tP.destinations) {
          html+=`<div style="background:#fff;border:1.5px solid #e6ebf7;border-radius:16px;padding:14px;margin-top:8px;cursor:pointer" onclick="send('${d.name.replace(/'/g,"\\'")}')">
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
              <span style="font-size:24px">${d.emoji||'🌍'}</span>
              <div><div style="font-size:14px;font-weight:800;color:#0e1430">${d.name}</div>
              <div style="font-size:11px;color:#7c89a8">${d.flight||''} · hôtel ${d.hotel||''}</div></div>
              <div style="margin-left:auto;font-size:13px;font-weight:800;color:#2f54ff">${d.price||''}</div>
            </div>
            <div style="font-size:12px;color:#374151;margin-bottom:7px">${d.why||''}</div>
            <div style="display:flex;flex-wrap:wrap;gap:4px">${(d.tags||[]).map(t=>`<span style="background:#eff6ff;color:#2f54ff;border-radius:100px;padding:2px 9px;font-size:11px;font-weight:600">${t}</span>`).join('')}</div>
          </div>`;
        }
        if(tP.question) html+=qBox(tP.question);
        return new Response(JSON.stringify({reply:html,sessionId:sid}),{headers:H});
      }

      // Feuille de route complète
      const itin = tP.itinerary||(tP.type==='itinerary'?tP.itinerary:null);
      if(!itin) return new Response(JSON.stringify({reply:qBox("Dis-moi ta destination et ton budget, je génère ta feuille de route complète avec vols et hôtels !"),sessionId:sid}),{headers:H});

      let html='';

      // Header
      html+=`<div style="background:linear-gradient(135deg,#1f2da0,#2f54ff);border-radius:16px;padding:18px;margin-bottom:4px;text-align:center">
        <div style="font-size:32px;margin-bottom:6px">${itin.flag||'✈️'}</div>
        <div style="font-family:'Sora',sans-serif;font-size:20px;font-weight:800;color:#fff">${itin.destination}${itin.country?', '+itin.country:''}</div>
        <div style="font-size:12px;color:rgba(255,255,255,.75);margin-top:6px;display:flex;justify-content:center;gap:12px;flex-wrap:wrap">
          <span>📅 ${itin.duration}</span><span>👥 ${itin.travelers||'2 pers.'}</span>
          ${itin.budget?.total?`<span>💰 ~${itin.budget.total}€</span>`:''}
        </div>
        ${tStrategy==='paid'?'<div style="font-size:10px;color:rgba(255,255,255,.6);margin-top:6px">🔍 Recherche en temps réel (vols + hôtels actualisés)</div>':''}
      </div>`;

      if(tP.recap) html+=recapBox(tP.recap);

      // Vols
      if(itin.flights) {
        const f=itin.flights;
        html+=`<div style="font-size:12px;font-weight:800;color:#0e1430;margin:14px 0 6px">✈️ Vols recommandés</div>
        <div style="background:#fff;border:1.5px solid #e6ebf7;border-radius:14px;overflow:hidden">`;
        if(f.outbound) html+=`<div style="padding:12px 14px;border-bottom:1px solid #f0f4ff">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <div><div style="font-size:10px;font-weight:800;color:#7c89a8;text-transform:uppercase">Aller</div>
            <div style="font-size:13px;font-weight:700;color:#0e1430;margin-top:2px">${f.outbound.from} → ${f.outbound.to}</div>
            <div style="font-size:11px;color:#7c89a8">${f.outbound.airline||''} · ${f.outbound.duration||''}</div></div>
            <div style="text-align:right"><div style="font-size:16px;font-weight:900;color:#2f54ff">${f.outbound.price||'Voir prix'}</div><div style="font-size:10px;color:#7c89a8">/ pers.</div></div>
          </div></div>`;
        if(f.return) html+=`<div style="padding:12px 14px">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <div><div style="font-size:10px;font-weight:800;color:#7c89a8;text-transform:uppercase">Retour</div>
            <div style="font-size:13px;font-weight:700;color:#0e1430;margin-top:2px">${f.return.from} → ${f.return.to}</div>
            <div style="font-size:11px;color:#7c89a8">${f.return.airline||''} · ${f.return.duration||''}</div></div>
            <div style="text-align:right"><div style="font-size:16px;font-weight:900;color:#2f54ff">${f.return.price||'Voir prix'}</div><div style="font-size:10px;color:#7c89a8">/ pers.</div></div>
          </div></div>`;
        html+=`</div>`;
        const flightLink=f.outbound?.link||`https://www.skyscanner.fr/transport/vols/par/${encodeURIComponent((itin.destination||'').slice(0,3).toLowerCase())}/`;
        html+=`<a href="${flightLink}" target="_blank" style="display:flex;align-items:center;justify-content:center;gap:8px;background:linear-gradient(135deg,#0e1430,#1f2da0);color:#fff;text-decoration:none;border-radius:12px;padding:11px;font-size:13px;font-weight:700;margin-top:6px">🔍 Comparer tous les vols sur Skyscanner →</a>`;
      }

      // Hôtels
      if(itin.hotels?.length) {
        html+=`<div style="font-size:12px;font-weight:800;color:#0e1430;margin:16px 0 6px">🏨 Hébergements sur Booking.com</div>`;
        const nights=parseInt((itin.duration||'').match(/\d+/)?.[0]||'5');
        for(const h of itin.hotels) html+=hotelCard(h, buildBookingLink(itin.destination||'', nights));
      }

      // Programme jour par jour
      if(itin.days?.length) {
        html+=`<div style="font-size:12px;font-weight:800;color:#0e1430;margin:16px 0 6px">📅 Programme jour par jour</div>`;
        for(const d of itin.days) html+=dayCard(d);
      }

      // Budget total
      if(itin.budget) html+=budgetCard(itin.budget);

      // Conseils
      if(itin.tips?.length) html+=tipsCard(itin.tips);

      // Wishlist voyage
      const voyagePrice=itin.budget?.total?itin.budget.total+'€':'';
      const voyageUrl=(itin.hotels||[])[0]?.booking_link||buildBookingLink(itin.destination||'',5);
      const voyageData=JSON.stringify({name:`Voyage ${itin.destination||''}${itin.country?' ('+itin.country+')':''}`,price:voyagePrice,store:'booking',url:voyageUrl}).replace(/"/g,'&quot;');
      html+=`<button onclick="addToWishlist(${voyageData})" style="background:linear-gradient(135deg,#1f2da0,#2f54ff);border:none;color:#fff;border-radius:12px;padding:12px 16px;margin-top:12px;font-weight:700;font-size:13px;cursor:pointer;font-family:inherit;width:100%">♡ Sauvegarder ce voyage dans ma wishlist</button>`;
      html+=`<div style="font-size:10px;color:#7c89a8;text-align:center;margin-top:5px">Retrouve ta feuille de route dans Compte → Wishlist ✈️</div>`;

      if(trackingEnabled) sbFetch('searches','POST',{query:`[VOYAGE] ${message}`,session_id:sid,user_id:userId||null});

      return new Response(JSON.stringify({reply:html,sessionId:sid}),{headers:H});
    }

    // ══════════════════════════════════════════════════════════
    // MODE PRODUIT
    // ══════════════════════════════════════════════════════════
    // On ne saute le ciblage QUE si budget ET produit précis ET déjà des échanges
    // Sinon on passe TOUJOURS par la phase de questions (IA gratuite)
    const hasExplicitBudget = /\d+\s*€|\d+\s*euros?/i.test(message);
    const hasExplicitProduct = message.trim().split(/\s+/).length >= 3;
    const mustSearch = qAsked >= MAX_Q || (hasExplicitBudget && hasExplicitProduct && (history||[]).length > 0);
    let decision = {ready:mustSearch, question:null, recap:null};

    if (!mustSearch) {
      // Phase 1 : MAX 2 questions, puis on cherche avec ce qu'on a
      const p1sys = `Agent shopping Huntify. Tu poses MAX 2 questions COURTES puis tu cherches.

REGLE 1 : SI L'UTILISATEUR DIT "je ne sais pas" ou "je sais pas" ou "aucune idée" a une question → IGNORE ce critère et passe a ready:true avec ce que tu as. Ne repose JAMAIS la meme question autrement.

REGLE 2 : MAX 2 questions AU TOTAL sur toute la conversation. Tu en as pose ${qAsked}. Si ${qAsked} >= 2 → ready:true OBLIGATOIRE.

REGLE 3 : Pose UNE SEULE question qui regroupe le MAXIMUM d'infos utiles.
Exemples de bonnes questions uniques :
- "fond de teint" → "Quel est ton budget, et tu cherches plutot couvrant ou leger ?"
- "casque" → "Pour quel usage (musique/gaming/sport) et quel budget ?"
- "cadeau" → "C'est pour qui et quel budget ?"

REGLE 4 : Ne pose JAMAIS de question sur :
- La marque
- La teinte exacte (si la personne ne sait pas, cherche "toutes teintes" ou "universel")
- Des details techniques que l'utilisateur moyen ne connait pas
- Le sport ou des sujets hors contexte

REGLE 5 : Recap = MOTS-CLES PRODUIT pour Amazon/Rakuten.
- fond de teint + rougeurs + couvrant + hydratant → "fond de teint couvrant hydratant anti-rougeurs teinte claire"
- casque + sport → "casque sport bluetooth sans fil"
NE COPIE JAMAIS les reponses brutes.

HISTORIQUE : ${hist || 'Debut'}
Questions posees : ${qAsked}/${MAX_Q}

JSON UNIQUEMENT :
{"ready":false,"question":"UNE question courte qui regroupe budget + usage"}
{"ready":true,"recap":"mots-cles produit precis"}`;

      const p1user = `HISTORIQUE:\n${hist||'Début'}\n\nQuestions posées: ${qAsked}/${MAX_Q}\n\nMESSAGE: ${message}`;

      // ⚡ CIBLAGE : uniquement IA gratuites (Groq → Gemini → Mistral)
      // Pas de fallback Claude ici — si tout échoue, on lance la recherche directement
      let t1 = await callFreeAI(p1sys, p1user, 'fast');

      if (t1) {
        const d=parseJSON(t1);
        decision.ready    = d.ready===true;
        decision.question = d.question||null;
        decision.recap    = d.recap||null;
      } else {
        decision.ready=true;
      }
    }

    if (!decision.ready && decision.question) {
      return new Response(JSON.stringify({reply:qBox(decision.question),sessionId:sid}),{headers:H});
    }

    const recap    = decision.recap||`Je cherche : ${message}`;
    const budget   = detectBudget(recap)||detectBudget(hist)||detectBudget(message);
    const strategy = routingStrategy(budget);

    let products=[], promoCodes=[], summary='';

    // ── Consultation DB interne AVANT les IA (source 0, gratuite) ───
    const dbData = await queryInternalDB(recap, budget);
    const dbContext = buildDBContext(dbData);

    // ── Routing : si pas d'IA gratuite configurée → paid direct ──────
    const effectiveStrategy = (!hasFreeAI() && strategy !== 'paid_deep') ? 'paid_deep' : strategy;

    if (effectiveStrategy==='free_fast'||effectiveStrategy==='free_deep') {
      const depth = effectiveStrategy==='free_deep'?'deep':'fast';
      const stores = effectiveStrategy==='free_deep'?'Amazon.fr ET Rakuten':'Amazon.fr';
      const p2sys = `Tu es l'agent shopping de Huntify. Boutiques: ${activeNames}.
BESOIN PRÉCIS : ${recap}

${dbContext}

Cherche sur ${stores} des produits qui correspondent EXACTEMENT au recap ci-dessus.
RÈGLES CRITIQUES :
- Le champ "keywords" doit être un terme de recherche PRÉCIS qui mène au bon produit sur Amazon/Rakuten
  Bon : "fond de teint teinte medium L'Oreal" | Mauvais : "fond de teint entre clair et moyen"
  Bon : "casque Sony WH-1000XM5 bluetooth" | Mauvais : "casque bluetooth"
- Propose des produits avec des prix RÉALISTES pour la catégorie
- Ne propose JAMAIS de produit à moins de 5€ si le besoin est clairement premium
- Badge : "Idéal en cadeau" / "Bestseller" / "Top qualité" selon le contexte
- url: null toujours (évite les 404)

JSON UNIQUEMENT :
{"summary":"1 phrase","products":[{"name":"nom produit précis","price":"XX€","store":"amazon","keywords":"termes recherche précis","url":null,"img":null,"badge":"badge"}],"promoCodes":[]}`;
      const p2user=`HISTORIQUE:\n${hist||'Début'}\n\nBESOIN: ${recap}\n\nMESSAGE: ${message}`;

      // ⚡ RECHERCHE GRATUITE : Groq → Gemini → Mistral
      // Pas de fallback Claude — si tout échoue, réponse générique sans coût
      let raw = await callFreeAI(p2sys, p2user, depth);
      const p=parseJSON(raw||'');
      products=p.products||[]; promoCodes=p.promoCodes||[]; summary=p.summary||'';
    }

    // ── Stratégie PAID : Claude + web search ─────────────────
    else {
      const p2sys = `Tu es l'agent shopping de Huntify. Boutiques: ${activeNames}.
BESOIN PRÉCIS : ${recap}

${dbContext}

1. CHERCHE SUR AMAZON — 1 recherche sur amazon.fr, 2 produits avec VRAIS prix et liens directs produit
2. CHERCHE SUR RAKUTEN — 1 recherche sur fr.shopping.rakuten.com, 1 produit. OBLIGATOIRE.
3. CODES PROMOS — dealabs.com si disponible

RÈGLES CRITIQUES POUR LES LIENS :
- "keywords" = termes PRÉCIS pour trouver CE produit exact (pas une catégorie générale)
  BON : "Nike Air Max 270 blanc homme taille 42"
  MAUVAIS : "chaussures sport blanc"
- "url" = lien direct vers LA PAGE PRODUIT si trouvé (pas la page de recherche)
  Format Amazon : https://www.amazon.fr/dp/ASIN (mettre null si pas certain)
  Format Rakuten : null (on utilise search_url)
- Prix réels trouvés sur le web MAINTENANT
- 2 Amazon + 1 Rakuten OBLIGATOIRES
- Ne propose jamais de produit hors sujet ou hors budget

JSON UNIQUEMENT :
{"summary":"1 phrase","products":[{"name":"nom produit précis","price":"XX€","store":"amazon","keywords":"termes précis","url":"https://amazon.fr/dp/ASIN_ou_null","img":null,"badge":"badge"}],"promoCodes":[{"code":"CODE","store":"boutique","discount":"-XX%","best":true}]}`;

      const raw=await callClaude(p2sys,`HISTORIQUE:\n${hist||'Début'}\n\nBESOIN: ${recap}\n\nMESSAGE: ${message}`,700,[{type:"web_search_20250305",name:"web_search",max_uses:2}]);
      const p=parseJSON(raw);
      products=p.products||[]; promoCodes=p.promoCodes||[]; summary=p.summary||'';
    }

    if(!products.length) {
      products=advertisers.slice(0,2).map(a=>({name:message,price:'Voir prix',store:a.slug,keywords:message,url:null,img:null,badge:null}));
      summary=`Résultats pour "${message}" :`;
    }

    // Historique prix
    let priceHistHtml='';
    const main=products.find(p=>p.store==='amazon');
    if(main?.price&&!main.price.includes('Voir')) {
      const cur=parseFloat(main.price.replace(/[^0-9.,]/g,'').replace(',','.'));
      const slug=main.name.toLowerCase().replace(/\s+/g,'-').slice(0,50);
      const hist2=await sbFetch(`price_history?product_id=eq.${slug}&order=checked_at.desc&limit=10`)||[];
      if(hist2.length>1&&!isNaN(cur)){
        const old=hist2[hist2.length-1].price;
        const trend=cur<old*0.97?'down':cur>old*1.03?'up':'stable';
        priceHistHtml=priceHistBox(old,trend);
      }
      if(!isNaN(cur)) sbFetch('price_history','POST',{product_id:slug,product_name:main.name,price:cur,store:'amazon',url:main.url||null});
    }

    // Cartes produits
    let buttons='';
    for(const pr of products) {
      if(!pr.name) continue;
      const adv=findAdv(advertisers,pr.store);
      if(!adv) continue;
      const url=buildLink(adv,pr.keywords||pr.name,pr.url||null);
      if(!url) continue;
      buttons+=productCard(pr.name,pr.price||'Voir prix',url,adv,pr.img||null,pr.badge||null);
    }

    // Codes promos
    let promos='';
    for(const c of (promoCodes||[]).filter(c=>c.code).sort((a,b)=>b.best-a.best).slice(0,2)) {
      promos+=promoBox(c.code,c.store||'boutique',c.discount||'Réduction',c.best||false);
      sbFetch('promo_codes','POST',{code:c.code,store:c.store||'unknown',discount:c.discount||'',product_query:message,found_at:new Date().toISOString(),valid:true});
    }

    // Wishlist
    const first=products[0];
    const adv0=first?findAdv(advertisers,first.store):null;
    const wishBtn=first&&adv0
      ?`<button onclick="addToWishlist(${JSON.stringify({name:first.name,price:first.price,store:first.store,url:buildLink(adv0,first.keywords||first.name,first.url||null)}).replace(/"/g,'&quot;')})" style="background:#fff;border:1.5px solid #e8edf8;color:#3b5bdb;border-radius:12px;padding:8px 16px;margin-top:10px;font-weight:700;font-size:12px;cursor:pointer;font-family:inherit;width:100%">♡ Ajouter à ma wishlist</button>`
      :'';

    const reply=
      `<div style="font-size:13px;color:#374151;margin-bottom:6px;font-weight:500">${summary}</div>`+
      recapBox(recap)+
      priceHistHtml+buttons+
      (promos?`<div style="margin-top:4px">${promos}</div>`:'')+
      wishBtn;

    return new Response(JSON.stringify({reply,sessionId:sid}),{headers:H});

  } catch(err) {
    console.error('Error:',err.message);
    return new Response(JSON.stringify({reply:"Désolé, problème technique. Réessayez dans un instant."}),{status:200,headers:{'Content-Type':'application/json; charset=utf-8','Access-Control-Allow-Origin':'*'}});
  }
}
