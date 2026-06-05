export const config = { runtime: 'edge' };

// ============================================================
// HUNTIFY — chat.js v6 PROPRE
// Architecture :
// - PRODUITS : IA gratuite (ciblage) → Claude 1er envoi si ROI≥3
// - VOYAGE   : Claude pour tout (conversation + itinéraire)
// - AI Router : Groq → Gemini → Mistral → Claude fallback
// - ROI scoring : budget + urgence + cadeau + premium
// - Anti-boucle : détection changement de sujet
// - Liens directs : Amazon /dp/ASIN + Booking hotel + Skyscanner IATA
// ============================================================

const SUPABASE_URL     = "https://enocxbrqyybendertytl.supabase.co";
const SUPABASE_KEY     = "sb_publishable_NmPh--frZG5HuqfaoxnemA_E7cidV9Y";
const MODEL            = 'claude-haiku-4-5';
const MAX_Q            = 3;
const TRAVEL_THRESHOLD = 300;

// ── Supabase ──────────────────────────────────────────────────
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
  const preserve = ['fond de teint','eau de toilette','eau de parfum','creme de jour',
    'creme de nuit','sac a main','sac a dos','machine a laver','table de chevet'];
  const cleaned = kw.replace(/,/g,' ').replace(/\s+/g,' ').trim();
  const lower = cleaned.toLowerCase();
  for (const expr of preserve) {
    if (lower.includes(expr)) {
      const rest = lower.replace(expr,'').trim();
      const rw = rest.split(' ').filter(w=>w.length>1).slice(0,3).join(' ');
      return (expr+' '+rw).trim().slice(0,60);
    }
  }
  const stop = new Set(['la','le','les','un','une','des','avec','et','en','du','au','aux','style','classique']);
  return cleaned.split(' ').filter(w=>w.length>1&&!stop.has(w.toLowerCase())).slice(0,6).join(' ');
}

function buildLink(adv, keywords, directUrl=null) {
  if (!adv?.active) return null;
  const kw = cleanKw(keywords);
  if (adv.slug === 'amazon') {
    const valid = directUrl && directUrl !== 'null' && directUrl.length > 10
               && directUrl.includes('amazon.fr') && !directUrl.includes('/dp/null');
    const base = valid ? directUrl : `https://www.amazon.fr/s?k=${encodeURIComponent(kw)}`;
    return `${base}${base.includes('?')?'&':'?'}tag=${adv.amazon_tag}`;
  }
  if (adv.awin_mid) {
    let searchBase = adv.search_url || 'https://fr.shopping.rakuten.com/s/{keywords}';
    if (searchBase.includes('/search?keyword=') || searchBase.includes('?keyword='))
      searchBase = 'https://fr.shopping.rakuten.com/s/{keywords}';
    const rkw = encodeURIComponent(kw).replace(/%20/g,'+');
    const dest = searchBase.replace('{keywords}', rkw);
    return `https://www.awin1.com/cread.php?awinmid=${adv.awin_mid}&awinaffid=${adv.awin_aff}&ued=${encodeURIComponent(dest)}`;
  }
  return null;
}

function findAdv(advertisers, slug) {
  return advertisers.find(a=>a.slug===slug?.toLowerCase())||null;
}

function buildBookingLink(destination, nights=5, adults=2, minPrice=null, maxPrice=null) {
  const pubId = process.env.CJ_PUBLISHER_ID||null;
  const advId = process.env.CJ_BOOKING_ADVERTISER_ID||null;
  const dest  = encodeURIComponent(destination||'');
  let base = `https://www.booking.com/search.html?ss=${dest}&group_adults=${adults}&nights=${nights}`;
  if (minPrice && maxPrice) base += `&nflt=price%3D${minPrice}-${maxPrice}-1`;
  if (!pubId||!advId) return base;
  return `https://www.anrdoezrs.net/click-${pubId}-${advId}?url=${encodeURIComponent(base)}`;
}

// ── DB interne ────────────────────────────────────────────────
async function queryInternalDB(keywords) {
  const kw = (keywords||'').toLowerCase().split(' ')[0];
  const results = { deals:[], prices:[], promos:[], hasData:false };
  try {
    const [deals, prices, promos] = await Promise.all([
      sbFetch(`daily_deals?name=ilike.*${encodeURIComponent(kw)}*&limit=3`),
      sbFetch(`price_history?product_name=ilike.*${encodeURIComponent(kw)}*&order=checked_at.desc&limit=5`),
      sbFetch(`promo_codes?valid=eq.true&order=found_at.desc&limit=3`)
    ]);
    if (deals?.length)  { results.deals  = deals;  results.hasData = true; }
    if (prices?.length) { results.prices = prices; results.hasData = true; }
    if (promos?.length)   results.promos = promos;
  } catch(e) {}
  return results;
}

function buildDBContext(d) {
  if (!d.hasData) return '';
  const parts = ['DONNEES INTERNES :'];
  if (d.deals?.length)  parts.push('Deals: '+d.deals.map(x=>`${x.name} ${x.price||''} (${x.store||''})`).join(' | '));
  if (d.prices?.length) parts.push('Prix: '+d.prices.map(x=>`${x.product_name} ${x.price}EUR`).join(' | '));
  if (d.promos?.length) parts.push('Codes: '+d.promos.map(x=>`${x.code} ${x.store||''}`).join(' | '));
  return parts.join('\n');
}

// ── ROI & routing ─────────────────────────────────────────────
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

function estimateROI(budget, message, hist) {
  let score = 0;
  const msg = (message+' '+(hist||'')).toLowerCase();
  if (budget===null) score+=2;
  else if (budget<30) score+=0;
  else if (budget<80) score+=1;
  else if (budget<200) score+=3;
  else if (budget<500) score+=5;
  else score+=8;
  if (/urgent|maintenant|aujourd'hui|vite|demain/i.test(msg)) score+=2;
  if (/famille|couple|enfants?|pour \d|groupe/i.test(msg)) score+=2;
  if (/cadeau|offrir|anniversaire|noel|mariage|relation/i.test(msg)) score+=2;
  if (/premium|luxe|meilleur|haut de gamme|pas de budget/i.test(msg)) score+=3;
  return { score, depth: score>=6?'deep':score>=3?'medium':'light', useWebSearch: score>=6 };
}

function detectCategory(text) {
  if (!text) return 'general';
  const t = text.toLowerCase();
  if (/fond de teint|mascara|parfum|creme|serum|maquillage|beaute|cosmetique/.test(t)) return 'beaute';
  if (/casque|telephone|laptop|tablette|tv|console|electronique|gaming/.test(t)) return 'electronique';
  if (/robe|veste|pantalon|chaussure|sneaker|jean|vetement|mode/.test(t)) return 'mode';
  if (/cadeau|anniversaire|noel|mariage|naissance|offrir|relation/.test(t)) return 'cadeau';
  if (/sport|running|velo|yoga|fitness|musculation/.test(t)) return 'sport';
  if (/voyage|hotel|vol|vacances|destination/.test(t)) return 'voyage';
  return 'general';
}

function analyzeConversation(history, message) {
  const exchanges = (history||[]).length;
  const histText  = (history||[]).map(m=>m.content||'').join(' ');
  const histCat   = detectCategory(histText);
  const curCat    = detectCategory(message);
  const topicChanged  = histCat!=='general' && curCat!=='general' && histCat!==curCat;
  const deepConversation = exchanges >= 6;
  return { curCat, histCat, topicChanged, deepConversation, exchanges };
}

// Extrait les infos voyage depuis l'historique
function extractTravelInfo(hist, message) {
  const text = ((hist||'')+ ' '+message).toLowerCase();
  const info = {};
  const destM = text.match(/(?:aller|partir|voyager|destination|visiter)\s+(?:a|à|en|au|aux|pour)?\s+([a-zA-ZÀ-ÿ\s]{2,20})(?:\.|,|!|\?|\s|$)/i)
             || text.match(/(?:je veux|on veut|j'aimerais)\s+(?:aller|partir)\s+(?:a|à|en|au)?\s*([a-zA-ZÀ-ÿ\s]{2,20})/i);
  if (destM) info.destination = destM[1].trim();
  const budM = text.match(/(\d+)\s*(?:€|euros?)/i);
  if (budM) info.budget = budM[1]+'€';
  const durM = text.match(/(\d+)\s*(?:jours?|nuits?|semaines?)/i);
  if (durM) info.duree = durM[0];
  const travM = text.match(/(\d+)\s*(?:personnes?|adultes?|voyageurs?)|(?:seul|couple|famille|duo|amis)/i);
  if (travM) info.voyageurs = travM[0];
  const depM = text.match(/(?:depuis|de|depart|départ)\s+([a-zA-ZÀ-ÿ\s]{2,20})(?:\s|,|\.)/i);
  if (depM) info.ville_depart = depM[1].trim();
  if (/chill|plage|repos|détente/.test(text)) info.style = 'chill';
  else if (/culture|musée|histoire|monument/.test(text)) info.style = 'culture';
  else if (/aventure|randonnée|sport|nature/.test(text)) info.style = 'aventure';
  else if (/famille|enfants|kids/.test(text)) info.style = 'famille';
  else if (/romantique|amoureux|couple/.test(text)) info.style = 'romantique';
  else if (/gastronomie|resto|manger|cuisine/.test(text)) info.style = 'gastronomie';
  return info;
}

// ── AI Router ─────────────────────────────────────────────────
async function callGroq(sys, user, model, maxTok) {
  const key = process.env.GROQ_API_KEY; if(!key) return null;
  try {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions',{
      method:'POST', headers:{'Content-Type':'application/json','Authorization':`Bearer ${key}`},
      body:JSON.stringify({model, max_tokens:maxTok, messages:[{role:'system',content:sys},{role:'user',content:user}]})
    });
    if(!r.ok) return null;
    const d = await r.json(); return d.choices?.[0]?.message?.content||null;
  } catch(e){return null;}
}

async function callGemini(sys, user, maxTok) {
  const key = process.env.GEMINI_API_KEY; if(!key) return null;
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`,{
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({contents:[{parts:[{text:`${sys}\n\n${user}`}]}],generationConfig:{maxOutputTokens:maxTok}})
    });
    if(!r.ok) return null;
    const d = await r.json(); return d.candidates?.[0]?.content?.parts?.[0]?.text||null;
  } catch(e){return null;}
}

async function callMistral(sys, user, maxTok) {
  const key = process.env.MISTRAL_API_KEY; if(!key) return null;
  try {
    const r = await fetch('https://api.mistral.ai/v1/chat/completions',{
      method:'POST', headers:{'Content-Type':'application/json','Authorization':`Bearer ${key}`},
      body:JSON.stringify({model:'mistral-small-latest', max_tokens:maxTok, messages:[{role:'system',content:sys},{role:'user',content:user}]})
    });
    if(!r.ok) return null;
    const d = await r.json(); return d.choices?.[0]?.message?.content||null;
  } catch(e){return null;}
}

async function callFreeAI(sys, user, depth='fast') {
  // 70b pour le ciblage (JSON fiable), 8b seulement pour les tâches simples
  const model = depth==='fast' ? 'llama-3.3-70b-versatile' : 'llama-3.3-70b-versatile';
  const tok   = depth==='deep' ? 700 : 300;
  return await callGroq(sys,user,model,tok) || await callGemini(sys,user,tok) || await callMistral(sys,user,tok);
}

async function chainAI(task, context) {
  const sys = 'Interpreteur de langage naturel. Reponds en JSON court.';
  const interp = await callGroq(sys, task+'\nContexte: '+context, 'llama-3.1-8b-instant', 150);
  if (!interp) return await callGemini(sys, task+'\nContexte: '+context, 150);
  const enriched = await callGemini('Enrichis et valide. Reponds en JSON court.',
    'Interpretation: '+interp+'\nContexte: '+context, 200);
  return enriched || interp;
}

function hasFreeAI() {
  return !!(process.env.GROQ_API_KEY || process.env.GEMINI_API_KEY || process.env.MISTRAL_API_KEY);
}

async function callClaude(sys, user, maxTok=600, tools=[]) {
  // PAS de cache_control — le prompt contient des variables dynamiques (hist, context)
  // qui changent à chaque appel → cache write inutile et coûteux (1.25x le prix normal)
  // Sans cache : input normal à 1$/M tokens, beaucoup moins cher
  const r = await fetch('https://api.anthropic.com/v1/messages',{
    method:'POST',
    headers:{'Content-Type':'application/json; charset=utf-8','x-api-key':process.env.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01'},
    body:JSON.stringify({model:MODEL, max_tokens:maxTok, tools,
      system:sys,
      messages:[{role:'user',content:user}]})
  });
  const d = await r.json();
  if(!r.ok) throw new Error(d.error?.message||'Claude error');
  let t=''; for(const b of d.content){if(b.type==='text')t+=b.text;} return t;
}

// ── Utilitaires ───────────────────────────────────────────────
function parseJSON(raw) {
  if(!raw) return {};
  try { const m=raw.match(/\{[\s\S]*\}/); if(m) return JSON.parse(m[0]); } catch(e){}
  return {};
}

function buildHistory(history) {
  return (history||[]).map(m=>{
    const role = m.role==='user'?'Client':'Agent';
    const text = (m.content||'').replace(/<[^>]*>/g,' ').replace(/&[^;]+;/g,' ').replace(/\s+/g,' ').trim().slice(0,400);
    return text ? `${role}: ${text}` : null;
  }).filter(Boolean).join('\n').slice(0,2000);
}

function countQ(history) {
  // Compte les messages de l'agent qui sont des questions (courts, pas de produit)
  // Un message avec un prix ou une longue réponse = résultat, pas une question
  return (history||[]).filter(m =>
    m.role !== 'user' &&
    (m.content||'').length > 10 &&
    (m.content||'').length < 300 &&   // Questions courtes
    !/\d+€/.test(m.content||'') &&   // Pas un résultat avec prix
    !/(amazon|rakuten|booking)/i.test(m.content||'')  // Pas un lien boutique
  ).length;
}

function countTravelQ(history) {
  return (history||[]).filter(m=>m.role!=='user'&&(m.content||'').length>20).length;
}

// ── Cross-suggestions & auto-coupons ─────────────────────────
function getCrossSuggestions(recap) {
  const r = (recap||'').toLowerCase();
  const map = {
    'fond de teint':['éponge maquillage beautyblender','primer teint'],
    'casque':['housse transport casque','coussinets rechange'],
    'telephone':['coque protection','verre trempé écran'],
    'laptop':['housse laptop','souris sans fil'],
    'sneakers':['semelles confort','spray imperméabilisant'],
    'parfum':['coffret miniatures','atomiseur voyage'],
    'robe':['sac de soirée','bijoux fantaisie'],
  };
  for (const [k,v] of Object.entries(map)) if (r.includes(k)) return v;
  return [];
}

async function getAutoCoupons(store) {
  try {
    const p = await sbFetch(`promo_codes?valid=eq.true&store=eq.${encodeURIComponent(store)}&order=found_at.desc&limit=2`);
    return (p||[]).filter(x=>x.code);
  } catch(e) { return []; }
}

// ── HTML Helpers produits ─────────────────────────────────────
function productCard(name, price, url, adv, img, badge) {
  const imgHtml  = img ? `<img src="${img}" style="width:56px;height:56px;object-fit:cover;border-radius:8px;flex-shrink:0" onerror="this.style.display='none'">` : '';
  const badgeHtml= badge ? `<span style="background:rgba(255,255,255,.22);border-radius:100px;padding:2px 8px;font-size:10px;font-weight:700">${badge}</span>` : '';
  const pill     = `<span style="background:rgba(255,255,255,.18);border:1px solid rgba(255,255,255,.35);border-radius:100px;padding:2px 9px;font-size:10px;font-weight:800">${adv.emoji} ${adv.name}</span>`;
  return `<a href="${url}" target="_blank" style="display:flex;align-items:center;gap:12px;background:${adv.color};color:#fff;text-decoration:none;border-radius:14px;padding:12px 14px;margin-top:8px">
    ${imgHtml}
    <div style="flex:1;min-width:0">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;flex-wrap:wrap">${pill}${badgeHtml}</div>
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
  const msg   = trend==='down'?`Prix en baisse ! Était ${old}€ ✅`:trend==='up'?`⚠️ Prix gonflé ! Était ${old}€`:'Prix stable';
  return `<div style="background:${color};border:1.5px solid ${border};border-radius:12px;padding:10px 14px;margin-top:8px;font-size:12px;font-weight:600;color:#374151">${icon} ${msg}</div>`;
}

function recapBox(r) {
  return `<div style="background:#f5f3ff;border:1.5px solid #ddd6fe;border-radius:12px;padding:10px 14px;margin-top:8px;font-size:12px;color:#5b21b6;font-weight:600">🔎 ${r}</div>`;
}

// ── HTML Helpers voyage ───────────────────────────────────────
function hotelCard(h, bookingUrl) {
  const stars = '⭐'.repeat(Math.min(h.stars||3,5));
  const cc = {budget:'#16a34a',confort:'#2f54ff',luxe:'#7c3aed'}[h.category]||'#2f54ff';
  const cl = {budget:'💚 Budget',confort:'💙 Confort',luxe:'💎 Luxe'}[h.category]||'';
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
      <div style="font-size:12px;font-weight:700;color:#0e1430;flex:1;margin-left:8px">${d.title||''}</div>
      ${d.budget?`<div style="font-size:11px;color:#16a34a;font-weight:700">~${d.budget}€</div>`:''}
    </div>
    ${d.morning?`<div style="display:flex;gap:9px;margin-bottom:8px"><span>🌅</span><div><div style="font-size:10px;font-weight:800;color:#94a3b8;text-transform:uppercase">Matin</div><div style="font-size:12px;color:#374151">${d.morning}</div></div></div>`:''}
    ${d.afternoon?`<div style="display:flex;gap:9px;margin-bottom:8px"><span>☀️</span><div><div style="font-size:10px;font-weight:800;color:#94a3b8;text-transform:uppercase">Après-midi</div><div style="font-size:12px;color:#374151">${d.afternoon}</div></div></div>`:''}
    ${d.evening?`<div style="display:flex;gap:9px;margin-bottom:4px"><span>🌙</span><div><div style="font-size:10px;font-weight:800;color:#94a3b8;text-transform:uppercase">Soirée</div><div style="font-size:12px;color:#374151">${d.evening}</div></div></div>`:''}
    ${d.restaurant?`<div style="background:#f0fdf4;border-radius:9px;padding:7px 11px;margin-top:6px;display:flex;justify-content:space-between"><div style="font-size:11px;color:#16a34a;font-weight:700">🍽️ ${d.restaurant.name||''}</div><div style="font-size:11px;color:#16a34a;font-weight:700">${d.restaurant.price||''}</div></div>`:''}
    ${d.activities?.length?`<div style="margin-top:7px;display:flex;flex-wrap:wrap;gap:4px">${d.activities.map(a=>`<span style="background:#eff6ff;color:#2f54ff;border-radius:100px;padding:2px 9px;font-size:10.5px;font-weight:600">${a}</span>`).join('')}</div>`:''}
  </div>`;
}

function budgetCard(b) {
  const items = [['✈️ Vols A/R',b.flights_total],['🏨 Hébergement',b.accommodation_total],
    ['🎯 Activités',b.activities_total],['🍽️ Restaurants',b.food_total],['🚇 Transport',b.transport_local]].filter(i=>i[1]);
  return `<div style="background:linear-gradient(135deg,#0e1430,#1f2da0);border-radius:16px;padding:16px;margin-top:12px">
    <div style="font-size:13px;font-weight:800;color:#fff;margin-bottom:12px">💰 Budget total estimé</div>
    ${items.map(([l,v])=>`<div style="display:flex;justify-content:space-between;margin-bottom:7px"><span style="font-size:12px;color:rgba(255,255,255,.75)">${l}</span><span style="font-size:12px;font-weight:700;color:#fff">${v}€</span></div>`).join('')}
    <div style="border-top:1px solid rgba(255,255,255,.2);margin-top:10px;padding-top:10px;display:flex;justify-content:space-between">
      <span style="font-size:13px;font-weight:800;color:#fff">TOTAL</span>
      <span style="font-size:16px;font-weight:900;color:#bcd0ff">${b.total||''}€</span>
    </div>
    ${b.per_person?`<div style="font-size:11px;color:rgba(255,255,255,.6);text-align:right;margin-top:3px">soit ${b.per_person}€/personne</div>`:''}
    ${b.note?`<div style="font-size:10px;color:rgba(255,255,255,.5);margin-top:8px">${b.note}</div>`:''}
  </div>`;
}

function tipsCard(tips) {
  if (!tips?.length) return '';
  return `<div style="background:#f5f3ff;border:1.5px solid #ddd6fe;border-radius:14px;padding:14px;margin-top:10px">
    <div style="font-size:12px;font-weight:800;color:#5b21b6;margin-bottom:8px">💡 Conseils pratiques</div>
    ${tips.map(t=>`<div style="font-size:12px;color:#374151;margin-bottom:5px;padding-left:8px;border-left:2px solid #c4b5fd">• ${t}</div>`).join('')}
  </div>`;
}

// ── HANDLER ───────────────────────────────────────────────────
export default async function handler(req) {
  if (req.method==='OPTIONS') return new Response(null,{status:204,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type'}});
  if (req.method!=='POST') return new Response('Method not allowed',{status:405});

  const H = {'Content-Type':'application/json; charset=utf-8','Access-Control-Allow-Origin':'*'};

  try {
    const { message, history, sessionId, userId, trackingEnabled, mode, travelContext } = await req.json();
    const sid      = sessionId || `anon_${Date.now()}`;
    const isTravel = mode === 'travel';

    const advertisers = await getAdvertisers();
    const activeNames = advertisers.map(a=>a.name).join(', ');

    if (trackingEnabled) {
      Promise.all([
        sbFetch('searches','POST',{query:message,session_id:sid,user_id:userId||null}),
        sbFetch('trends','POST',{query:message.toLowerCase().trim(),count:1,last_searched:new Date().toISOString()})
      ]);
    }

    const hist   = buildHistory(history);
    const ctx    = travelContext||{};
    const ctxStr = Object.entries(ctx).filter(([k,v])=>v&&k!=='suggestionsShown').map(([k,v])=>`${k}: ${v}`).join(', ');

    // ══════════════════════════════════════════════════════════
    // MODE VOYAGE — 1 seul appel Claude intelligent
    // Gère conversation + génération en une requête
    // Évite les double-appels, timeouts et boucles
    // ══════════════════════════════════════════════════════════
    if (isTravel) {
      const qAsked  = countTravelQ(history);
      const extr    = extractTravelInfo(hist, message);
      const merged  = {...extr, ...Object.fromEntries(Object.entries(ctx).filter(([k,v])=>v&&k!=='suggestionsShown'))};
      const mStr    = Object.entries(merged).filter(([k,v])=>v).map(([k,v])=>`${k}:${v}`).join(', ');
      const tBudget = detectBudget(mStr)||detectBudget(hist)||detectBudget(message);

      // Prompt unique : conversation naturelle + génération quand prêt
      // Court et précis pour réduire les tokens
      const tSys = `Expert agent voyage Huntify. Tu gères la conversation ET génères l'itinéraire.

INFOS COLLECTÉES : ${mStr||'aucune'}
HISTORIQUE : ${hist||'début'}
Questions posées : ${qAsked}

COMPORTEMENT :
- Si infos insuffisantes → pose UNE question naturelle et courte
- Si tu as destination + durée + ville de départ → génère l'itinéraire COMPLET
- Ne redemande JAMAIS ce qui est dans les infos collectées
- Si ${qAsked} >= 4 → génère avec ce que tu as

POUR LES QUESTIONS : sois naturel, chaleureux, concis.
Ex: "D'où partez-vous ?" / "Quel style ? Culture, plage, gastro, romantique ?" / "Budget total ?"

POUR LA GÉNÉRATION :
- Dispatche le budget : vols + hébergement + restau + activités + transport
- Hôtels réels que tu connais, dans le budget calculé
- Programme jour/jour adapté au style
- Vols : compagnie habituelle sur cette route, horaires typiques, prix approximatif
- Liens Skyscanner et Booking pour vrais prix

JSON UNIQUEMENT — 3 formats :

Question : {"t":"q","msg":"ta question"}

Suggestions (si pas de destination) :
{"t":"s","intro":"...","dests":[{"n":"Lisbonne","e":"🇵🇹","why":"...","price":"dès 700€/2","tags":["culture","soleil"]}],"q":"Laquelle te tente ?"}

Itinéraire complet :
{"t":"i","recap":"...","itin":{"dest":"...","country":"...","flag":"...","dur":"...","trav":"...","style":"...","dep":"...","flights":{"out":{"from":"...","to":"...","price":"...","co":"...","dur":"..."},"ret":{"from":"...","to":"...","price":"...","co":"...","dur":"..."}},"hotels":[{"name":"...","stars":4,"price":"120","loc":"...","hl":"...","cat":"confort"}],"days":[{"n":1,"title":"...","am":"...","pm":"...","eve":"...","resto":{"name":"...","price":"35€/2","spec":"..."},"acts":["..."],"budget":150}],"budget":{"vols":300,"hotel":500,"acts":150,"resto":200,"transport":80,"total":1230,"pp":615},"tips":["..."]}}`;

      const allText = (hist+' '+message+' '+mStr).toLowerCase();
      const hasDest = merged.destination || /capri|paris|rome|lisbonne|barcelone|londres|tokyo|bali|venise|madrid|amsterdam|berlin|prague|naples|athenes|santorin|marrakech|dubai/i.test(allText);
      const hasDep  = merged.ville_depart || /depuis|de barcelone|de paris|de lyon|de marseille|de nice|de bordeaux|de toulouse|départ/i.test(allText);
      const hasDates2 = merged.duree || /\\d+\\s*(jours?|nuits?|semaines?)|du \\d+/i.test(allText);
      const readyGen = hasDest && hasDep && hasDates2;
      const tUser = `COLLECTE: ${mStr||'rien'} HISTORIQUE: ${hist||'debut'} MESSAGE: ${message}${readyGen ? ' [INFOS COMPLETES - GENERE MAINTENANT itineraire format t:i, AUCUNE question]' : ''}`;
      const tRaw  = await callClaude(tSys, tUser, 2500, []);
      const tP    = parseJSON(tRaw||'');

      // ── Question ──────────────────────────────────────────
      if (tP.t === 'q' || (!tP.t && tP.msg)) {
        return new Response(JSON.stringify({
          reply:`<div style="font-size:13.5px;color:#1e293b;line-height:1.6;padding:4px 0">${tP.msg||tP.message||''}</div>`,
          sessionId:sid
        }),{headers:H});
      }

      // ── Suggestions de destinations ───────────────────────
      if (tP.t === 's' && tP.dests?.length) {
        let html = `<div style="font-size:13.5px;color:#1e293b;line-height:1.6;padding:4px 0 8px">${tP.intro||'Voici mes suggestions :'}</div>`;
        for (const d of tP.dests) {
          html += `<div onclick="send('${(d.n||'').replace(/'/g,"\'")}') " style="background:#fff;border:1.5px solid #e6ebf7;border-radius:16px;padding:14px;margin-top:8px;cursor:pointer">
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
              <span style="font-size:24px">${d.e||'🌍'}</span>
              <div><div style="font-size:14px;font-weight:800;color:#0e1430">${d.n}</div>
              <div style="font-size:11px;color:#7c89a8">${d.price||''}</div></div>
            </div>
            <div style="font-size:12px;color:#374151;margin-bottom:7px">${d.why||''}</div>
            <div style="display:flex;flex-wrap:wrap;gap:4px">${(d.tags||[]).map(t=>`<span style="background:#eff6ff;color:#2f54ff;border-radius:100px;padding:2px 9px;font-size:11px;font-weight:600">${t}</span>`).join('')}</div>
          </div>`;
        }
        if (tP.q) html += `<div style="font-size:13.5px;color:#1e293b;padding:8px 0 0">${tP.q}</div>`;
        return new Response(JSON.stringify({reply:html,sessionId:sid}),{headers:H});
      }

      // ── Itinéraire complet ────────────────────────────────
      const itin = tP.itin;
      if (!itin) {
        // Si Claude n'a pas généré l'itinéraire → demander ce qui manque
        return new Response(JSON.stringify({
          reply:`<div style="font-size:13.5px;color:#1e293b;line-height:1.6;padding:4px 0">${tP.msg||"Pour générer votre itinéraire, j'ai besoin de : destination, dates, ville de départ et budget 🗺️"}</div>`,
          sessionId:sid
        }),{headers:H});
      }

      let html = '';

      // Header
      html += `<div style="background:linear-gradient(135deg,#1f2da0,#2f54ff);border-radius:16px;padding:18px;margin-bottom:4px;text-align:center">
        <div style="font-size:32px;margin-bottom:6px">${itin.flag||'✈️'}</div>
        <div style="font-family:'Sora',sans-serif;font-size:20px;font-weight:800;color:#fff">${itin.dest||''}${itin.country?', '+itin.country:''}</div>
        <div style="font-size:12px;color:rgba(255,255,255,.75);margin-top:6px;display:flex;justify-content:center;gap:12px;flex-wrap:wrap">
          <span>📅 ${itin.dur||''}</span><span>👥 ${itin.trav||'2 pers.'}</span>
          ${itin.budget?.total?`<span>💰 ~${itin.budget.total}€</span>`:''}
        </div>
      </div>`;

      if (tP.recap) html += recapBox(tP.recap);

      // Vols
      if (itin.flights?.out) {
        const f = itin.flights;
        function getIATA(s){const m=(s||'').match(/([A-Z]{3})/);return m?m[1].toLowerCase():'par';}
        const sky = `https://www.skyscanner.fr/transport/vols/${getIATA(f.out.from)}/${getIATA(f.out.to)}/`;
        html += `<div style="font-size:12px;font-weight:800;color:#0e1430;margin:14px 0 6px">✈️ Vols recommandés</div>
        <div style="background:#fff;border:1.5px solid #e6ebf7;border-radius:14px;overflow:hidden">
          <div style="padding:12px 14px;border-bottom:1px solid #f0f4ff"><div style="display:flex;justify-content:space-between;align-items:center">
            <div><div style="font-size:10px;font-weight:800;color:#7c89a8">ALLER</div>
            <div style="font-size:13px;font-weight:700;color:#0e1430">${f.out.from||''} → ${f.out.to||''}</div>
            <div style="font-size:11px;color:#7c89a8">${f.out.co||''} · ${f.out.dur||''}</div></div>
            <div style="text-align:right"><div style="font-size:16px;font-weight:900;color:#2f54ff">~${f.out.price||'?'}</div><div style="font-size:10px;color:#7c89a8">/pers.</div></div>
          </div></div>
          ${f.ret?`<div style="padding:12px 14px"><div style="display:flex;justify-content:space-between;align-items:center">
            <div><div style="font-size:10px;font-weight:800;color:#7c89a8">RETOUR</div>
            <div style="font-size:13px;font-weight:700;color:#0e1430">${f.ret.from||''} → ${f.ret.to||''}</div>
            <div style="font-size:11px;color:#7c89a8">${f.ret.co||''} · ${f.ret.dur||''}</div></div>
            <div style="text-align:right"><div style="font-size:16px;font-weight:900;color:#2f54ff">~${f.ret.price||'?'}</div><div style="font-size:10px;color:#7c89a8">/pers.</div></div>
          </div></div>`:''}
        </div>
        <a href="${f.out.link||sky}" target="_blank" style="display:flex;align-items:center;justify-content:center;gap:8px;background:linear-gradient(135deg,#0e1430,#1f2da0);color:#fff;text-decoration:none;border-radius:12px;padding:11px;font-size:13px;font-weight:700;margin-top:6px">🔍 Comparer les vols sur Skyscanner →</a>`;
      }

      // Hôtels
      if (itin.hotels?.length) {
        html += `<div style="font-size:12px;font-weight:800;color:#0e1430;margin:16px 0 6px">🏨 Hébergements sur Booking.com</div>`;
        const nights = parseInt((itin.dur||'').match(/\d+/)?.[0]||'5');
        for (const h of itin.hotels) {
          html += hotelCard(
            {name:h.name,stars:h.stars,price:h.price,location:h.loc,highlight:h.hl,booking_link:h.link||null,category:h.cat},
            buildBookingLink((h.name+' '+(h.loc||'')+' '+(itin.dest||'')).trim(), nights)
          );
        }
        const hP = itin.hotels.map(h=>parseInt(h.price)||0).filter(p=>p>0);
        if (hP.length) {
          html += `<a href="${buildBookingLink(itin.dest||'',nights,2,Math.max(0,Math.min(...hP)-30),Math.max(...hP)+50)}" target="_blank" style="display:flex;align-items:center;justify-content:center;gap:8px;background:#f5f7ff;border:1.5px solid #c7d2fe;color:#3b5bdb;text-decoration:none;border-radius:12px;padding:10px;margin-top:8px;font-size:12px;font-weight:700">🔍 Explorer d'autres hôtels sur Booking.com →</a>`;
        }
      }

      // Programme
      if (itin.days?.length) {
        html += `<div style="font-size:12px;font-weight:800;color:#0e1430;margin:16px 0 6px">📅 Programme jour par jour</div>`;
        for (const d of itin.days) html += dayCard({
          num:d.n, title:d.title, morning:d.am, afternoon:d.pm, evening:d.eve,
          restaurant:d.resto, activities:d.acts, hotel:d.hotel, budget:d.budget
        });
      }

      // Budget
      if (itin.budget) {
        const b = itin.budget;
        html += budgetCard({
          flights_total:b.vols, accommodation_total:b.hotel,
          activities_total:b.acts, food_total:b.resto,
          transport_local:b.transport, total:b.total, per_person:b.pp,
          note:'Prix indicatifs. Cliquez les liens Skyscanner et Booking pour vérifier disponibilités et tarifs réels du moment.'
        });
      }

      // Conseils
      if (itin.tips?.length) html += tipsCard(itin.tips);

      // Wishlist
      const vUrl  = (itin.hotels||[])[0]?.link || buildBookingLink(itin.dest||'',5);
      const vData = JSON.stringify({name:`Voyage ${itin.dest||''}${itin.country?' ('+itin.country+')':''}`,price:itin.budget?.total?itin.budget.total+'€':'',store:'booking',url:vUrl}).replace(/"/g,'&quot;');
      html += `<button onclick="addToWishlist(${vData})" style="background:linear-gradient(135deg,#1f2da0,#2f54ff);border:none;color:#fff;border-radius:12px;padding:12px 16px;margin-top:12px;font-weight:700;font-size:13px;cursor:pointer;font-family:inherit;width:100%">♡ Sauvegarder ce voyage dans ma wishlist</button>`;

      if (trackingEnabled) sbFetch('searches','POST',{query:`[VOYAGE] ${message}`,session_id:sid,user_id:userId||null});
      return new Response(JSON.stringify({reply:html,sessionId:sid}),{headers:H});
    }

    // ══════════════════════════════════════════════════════════
    // MODE PRODUIT
    // ══════════════════════════════════════════════════════════
    const qAsked = countQ(history);
    const conv   = analyzeConversation(history, message);

    // Changement de sujet → reset
    if (conv.topicChanged && conv.exchanges >= 4) {
      const resetMsg = conv.curCat==='cadeau'
        ? "Nouveau sujet ! Pour un cadeau, dis-moi pour qui et quel budget tu as en tête ?"
        : conv.curCat==='beaute'
        ? "Nouveau sujet ! Pour ce produit beauté, tu cherches quelque chose de précis ?"
        : "Nouveau sujet ! Dis-moi ce que tu cherches et ton budget ?";
      return new Response(JSON.stringify({reply:`<div style="font-size:13.5px;color:#1e293b;line-height:1.6;padding:4px 0">${resetMsg}</div>`,sessionId:sid,resetContext:true}),{headers:H});
    }

    const deepSearchUnlocked = conv.deepConversation && !conv.topicChanged;
    const hasBudget  = /\d+\s*€|\d+\s*euros?/i.test(message);
    const hasPrecise = message.trim().split(/\s+/).length >= 3;
    const mustSearch = qAsked >= MAX_Q || (hasBudget && hasPrecise && (history||[]).length > 0);
    let decision = {ready:mustSearch, question:null, recap:null, message:null};

    if (!mustSearch) {
      const p1sys = `Tu es l'assistant shopping de Huntify. Tu poses des questions pour cibler le besoin.

IMPORTANT : Réponds UNIQUEMENT avec du JSON valide, rien d'autre. Pas de texte avant/après.

Une demande vague ("je cherche un fond de teint", "un casque") = ready:false + une question.
Tu ne cherches (ready:true) QUE si tu as compris le besoin précis.

EXEMPLES :
- "fond de teint" → {"ready":false,"message":"Super ! Tu cherches plutôt couvrant ou léger et naturel ? Et tu as un budget en tête ?"}
- "fond de teint" + réponse "couvrant, rougeurs" → {"ready":true,"recap":"fond de teint couvrant anti-rougeurs","message":"Parfait, je cherche !"}
- "cadeau 2 ans relation" → {"ready":false,"message":"Bel anniversaire ! Objet symbolique (bijou, accessoire) ou expérience à partager ? Quel budget ?"}
- "casque" → {"ready":false,"message":"Pour quel usage ? Musique, gaming, sport, travail ?"}

INTERPRÉTATION :
- "pas de budget" = premium, haut de gamme
- "pas cher" = bon rapport qualité-prix, moins de 50€
- "quelque chose de bien" = top rated, qualité
- "je ne sais pas" = ignore ce critère, cherche directement

RÈGLES :
1. Ne JAMAIS redemander ce qui est dans l'historique — relis-le avant de répondre
2. MAX ${MAX_Q} questions — tu en as posé ${qAsked} — si >= ${MAX_Q} → ready:true obligatoire
3. Si tu comprends le besoin principal → ready:true (pas besoin de tout savoir)
4. Recap = mots-clés produit concrets JAMAIS les réponses brutes
   "couvrant + rougeurs" → "fond de teint couvrant anti-rougeurs"
   "pas de budget" → "fond de teint premium"

HISTORIQUE (LIS AVANT DE RÉPONDRE): ${hist||'Début'}

JSON UNIQUEMENT :
{"ready":false,"message":"question naturelle"}
{"ready":true,"recap":"mots-clés produit","message":"phrase courte"}`;

      const p1user = `HISTORIQUE:\n${hist||'Début'}\nQuestions: ${qAsked}/${MAX_Q}\nMESSAGE: ${message}`;

      // IA gratuite directement — pas de chaining complexe
      const t1 = await callFreeAI(p1sys, p1user, 'fast');

      if (t1) {
        const d = parseJSON(t1);
        decision.ready    = d.ready===true;
        decision.question = d.question||d.message||null;
        decision.recap    = d.recap||null;
        decision.message  = d.message||d.question||null;
      }

      // Si le ciblage a échoué (pas de JSON valide) ET début de conversation
      // → poser une question intelligente au lieu de chercher dans le vide
      if (!decision.ready && !decision.message && (history||[]).length === 0) {
        const cat = detectCategory(message);
        const q = cat==='beaute' ? "Super ! Tu cherches quelque chose de précis (teinte, couvrance) ou je te trouve les mieux notés ? Et un budget ?"
                : cat==='electronique' ? "Pour quel usage, et tu as un budget en tête ?"
                : cat==='mode' ? "Quel style et quelle taille ? Et un budget ?"
                : cat==='cadeau' ? "C'est pour qui et quel budget ?"
                : "Tu peux m'en dire un peu plus ? Un budget ou des préférences ?";
        return new Response(JSON.stringify({reply:`<div style="font-size:13.5px;color:#1e293b;line-height:1.6;padding:4px 0">${q}</div>`,sessionId:sid}),{headers:H});
      }
    }

    if (!decision.ready && (decision.message||decision.question)) {
      const msg = decision.message||decision.question;
      return new Response(JSON.stringify({reply:`<div style="font-size:13.5px;color:#1e293b;line-height:1.6;padding:4px 0">${msg}</div>`,sessionId:sid}),{headers:H});
    }

    const recap  = decision.recap||`Je cherche : ${message}`;
    const budget = detectBudget(recap)||detectBudget(hist)||detectBudget(message);
    const roi    = estimateROI(budget, message, hist);

    // Stratégie hybride :
    // - 1er envoi + ROI>=3 → Claude + web search (liens directs)
    // - Conversation avancée (4+ échanges même sujet) → deep search
    // - Sinon → IA gratuite
    const hasPrev    = (history||[]).some(m=>m.role!=='user'&&/\d+€/.test(m.content||''));
    const isFirst    = !hasPrev;
    const strategy   = ((isFirst && roi.score>=3) || deepSearchUnlocked) ? 'paid_deep'
                     : (roi.depth==='medium' ? 'free_deep' : 'free_fast');
    const effective  = (!hasFreeAI() && strategy!=='paid_deep') ? 'paid_deep' : strategy;

    // DB interne
    const dbData    = await queryInternalDB(recap);
    const dbContext = buildDBContext(dbData);

    let products=[], promoCodes=[], summary='';

    if (effective==='free_fast'||effective==='free_deep') {
      const depth  = effective==='free_deep'?'deep':'fast';
      const stores = effective==='free_deep'?'Amazon.fr ET Rakuten':'Amazon.fr';
      const p2sys  = `Agent shopping Huntify. Boutiques: ${activeNames}.
BESOIN: ${recap}
${dbContext}
Cherche sur ${stores}. Interprète le besoin (pas de budget=premium, pas cher=<50€).
Name = NOM RÉEL du produit (marque + modèle). Ce nom sera le terme de recherche.
BON: "L'Oréal True Match fond de teint" | MAUVAIS: "fond de teint couvrant"
url:null. Badge: Premium/Bestseller/Idéal en cadeau.
JSON: {"summary":"...","products":[{"name":"NOM EXACT","price":"XX€","store":"amazon","keywords":"NOM EXACT","url":null,"img":null,"badge":"..."}],"promoCodes":[]}`;
      const raw = await callFreeAI(p2sys, `BESOIN: ${recap}\nMESSAGE: ${message}`, depth);
      const p   = parseJSON(raw||'');
      products=p.products||[]; promoCodes=p.promoCodes||[]; summary=p.summary||'';
    } else {
      const p2sys = `Agent shopping Huntify. Boutiques: ${activeNames}.
BESOIN: ${recap}
${dbContext}
1. CHERCHE SUR AMAZON — 2 produits avec vrais prix et liens /dp/ASIN si trouvés
2. CHERCHE SUR RAKUTEN — 1 produit. OBLIGATOIRE.
3. CODES PROMOS — dealabs.com si possible.
Interprète: "pas de budget"=premium, "pas cher"=<50€.
Name = NOM RÉEL (marque + modèle + référence).
2 Amazon + 1 Rakuten OBLIGATOIRES.
JSON: {"summary":"...","products":[{"name":"NOM EXACT","price":"XX€","store":"amazon","keywords":"NOM EXACT","url":"https://amazon.fr/dp/ASIN_ou_null","img":null,"badge":"..."}],"promoCodes":[{"code":"...","store":"...","discount":"...","best":true}]}`;
      const raw = await callClaude(p2sys, `BESOIN: ${recap}\nMESSAGE: ${message}`, 700, [{type:"web_search_20250305",name:"web_search",max_uses:2}]);
      const p   = parseJSON(raw);
      products=p.products||[]; promoCodes=p.promoCodes||[]; summary=p.summary||'';
    }

    if (!products.length) {
      products = advertisers.slice(0,2).map(a=>({name:message,price:'Voir prix',store:a.slug,keywords:message,url:null,img:null,badge:null}));
      summary  = `Résultats pour "${message}" :`;
    }

    // Historique prix
    let priceHistHtml = '';
    const main = products.find(p=>p.store==='amazon');
    if (main?.price && !main.price.includes('Voir')) {
      const cur  = parseFloat(main.price.replace(/[^0-9.,]/g,'').replace(',','.'));
      const slug = main.name.toLowerCase().replace(/\s+/g,'-').slice(0,50);
      const h2   = await sbFetch(`price_history?product_id=eq.${slug}&order=checked_at.desc&limit=10`)||[];
      if (h2.length>1 && !isNaN(cur)) {
        const old = h2[h2.length-1].price;
        const trend = cur<old*0.97?'down':cur>old*1.03?'up':'stable';
        priceHistHtml = priceHistBox(old, trend);
      }
      if (!isNaN(cur)) sbFetch('price_history','POST',{product_id:slug,product_name:main.name,price:cur,store:'amazon',url:main.url||null});
    }

    // Cartes produits
    let buttons = '';
    for (const pr of products) {
      if (!pr.name) continue;
      const adv = findAdv(advertisers, pr.store); if(!adv) continue;
      const rawUrl = (pr.url&&pr.url!=='null'&&!pr.url.includes('/dp/null')&&pr.url.length>15) ? pr.url : null;
      const terms  = pr.name && pr.name.length>5 ? pr.name : (pr.keywords||pr.name);
      const url    = buildLink(adv, terms, rawUrl);
      if (!url) continue;
      buttons += productCard(pr.name, pr.price||'Voir prix', url, adv, pr.img||null, pr.badge||null);
    }

    // Codes promos
    let promos = '';
    for (const c of (promoCodes||[]).filter(c=>c.code).sort((a,b)=>b.best-a.best).slice(0,2)) {
      promos += promoBox(c.code, c.store||'boutique', c.discount||'Réduction', c.best||false);
      sbFetch('promo_codes','POST',{code:c.code,store:c.store||'unknown',discount:c.discount||'',product_query:message,found_at:new Date().toISOString(),valid:true});
    }

    // Auto-coupons DB
    let dbPromos = '';
    for (const adv of advertisers) {
      const cpns = await getAutoCoupons(adv.slug);
      for (const c of cpns) {
        if (!(promoCodes||[]).find(p=>p.code===c.code))
          dbPromos += promoBox(c.code, c.store||adv.name, c.discount||'Réduction', false);
      }
    }

    // Wishlist
    const first = products[0];
    const adv0  = first ? findAdv(advertisers, first.store) : null;
    const wish  = first && adv0
      ? `<button onclick="addToWishlist(${JSON.stringify({name:first.name,price:first.price,store:first.store,url:buildLink(adv0,first.keywords||first.name,first.url||null)}).replace(/"/g,'&quot;')})" style="background:#fff;border:1.5px solid #e8edf8;color:#3b5bdb;border-radius:12px;padding:8px 16px;margin-top:10px;font-weight:700;font-size:12px;cursor:pointer;font-family:inherit;width:100%">♡ Ajouter à ma wishlist</button>`
      : '';

    // Cross-suggestions
    const sugs = getCrossSuggestions(recap);
    const cross = sugs.length
      ? `<div style="margin-top:12px;padding-top:10px;border-top:1px solid #f0f4ff">
          <div style="font-size:11px;font-weight:700;color:#7c89a8;margin-bottom:6px">Tu pourrais aussi aimer :</div>
          <div style="display:flex;gap:6px;flex-wrap:wrap">${sugs.map(s=>`<button onclick="send('${s.replace(/'/g,"\\'")}') " style="background:#f5f7ff;border:1.5px solid #e8edf8;color:#3b5bdb;border-radius:100px;padding:6px 14px;font-size:11px;font-weight:600;cursor:pointer;font-family:inherit">${s}</button>`).join('')}</div>
        </div>`
      : '';

    const reply =
      `<div style="font-size:13.5px;color:#1e293b;margin-bottom:8px;font-weight:500;line-height:1.5">${decision.message||summary}</div>`+
      priceHistHtml + buttons +
      (promos  ? `<div style="margin-top:4px">${promos}</div>`  : '') +
      (dbPromos? `<div style="margin-top:4px">${dbPromos}</div>`: '') +
      wish + cross;

    return new Response(JSON.stringify({reply, sessionId:sid}),{headers:H});

  } catch(err) {
    console.error('Error:', err.message);
    return new Response(JSON.stringify({reply:"Désolé, problème technique. Réessayez."}),{status:200,headers:{'Content-Type':'application/json; charset=utf-8','Access-Control-Allow-Origin':'*'}});
  }
}
