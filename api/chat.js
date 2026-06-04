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
  const model = depth==='deep' ? 'llama-3.3-70b-versatile' : 'llama-3.1-8b-instant';
  const tok   = depth==='deep' ? 700 : 250;
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
  const r = await fetch('https://api.anthropic.com/v1/messages',{
    method:'POST',
    headers:{'Content-Type':'application/json; charset=utf-8','x-api-key':process.env.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01'},
    body:JSON.stringify({model:MODEL, max_tokens:maxTok, tools,
      system:[{type:'text',text:sys,cache_control:{type:'ephemeral'}}],
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
  return (history||[]).filter(m=>m.role!=='user'&&(m.content||'').includes('data-qbox')).length;
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
    // MODE VOYAGE — Claude uniquement (conversation + itinéraire)
    // ══════════════════════════════════════════════════════════
    if (isTravel) {
      const qAsked = countTravelQ(history);

      // Fusion contexte front + extraction historique
      const extracted = extractTravelInfo(hist, message);
      const merged    = {...extracted, ...Object.fromEntries(Object.entries(ctx).filter(([k,v])=>v&&k!=='suggestionsShown'))};
      const mergedStr = Object.entries(merged).filter(([k,v])=>v).map(([k,v])=>`${k}: ${v}`).join(', ');

      const tBudget   = detectBudget(mergedStr)||detectBudget(hist)||detectBudget(message);
      const tStrategy = (tBudget&&tBudget>=TRAVEL_THRESHOLD) ? 'paid' : 'free';

      // ── Phase 1 : Conversation (Claude, questions intelligentes) ──
      const tSysConv = `Tu es un expert agent de voyage pour Huntify. Tu collectes les infos nécessaires pour créer un itinéraire complet avec vrais prix.

INFOS DÉJÀ CONNUES : ${mergedStr||'aucune'}
HISTORIQUE : ${hist||'début'}
Questions posées : ${qAsked}

RÈGLES :
- UNE question à la fois, naturelle et directe
- Ne redemande JAMAIS ce qui est dans les infos connues
- Si ${qAsked} >= 4 → type:ready immédiatement

INFOS NÉCESSAIRES (dans l'ordre, saute si déjà connue) :
1. Destination
2. Dates précises + durée + nombre de voyageurs
3. Ville de départ (indispensable pour calculer le vrai prix des vols)
4. Style du voyage (culturel / plage / gastronomie / romantique / aventure / mix)
5. Budget total — préciser si vols inclus ou non

Quand tu as destination + dates + ville de départ + style → type:ready.

JSON UNIQUEMENT :
{"type":"question","message":"ta question naturelle"}
{"type":"suggestions","intro":"...","destinations":[{"name":"...","emoji":"...","why":"...","price":"...","flight":"...","hotel":"...","tags":[]}],"question":"..."}
{"type":"ready","recap":"destination, dates, voyageurs, ville_depart, style, budget, vols_inclus"}`;

      const tUser = `INFOS COLLECTÉES: ${mergedStr||'aucune'}\nHISTORIQUE:\n${hist||'Début'}\nQuestions posées: ${qAsked}/4\nMESSAGE: ${message}`;

      const tRaw1 = await callClaude(tSysConv, tUser, 400);
      const tP1   = parseJSON(tRaw1||'');

      // Question
      if (tP1.type==='question') {
        return new Response(JSON.stringify({reply:`<div style="font-size:13.5px;color:#1e293b;line-height:1.6;padding:4px 0">${tP1.message||''}</div>`,sessionId:sid}),{headers:H});
      }

      // Suggestions destinations
      if (tP1.type==='suggestions' && tP1.destinations?.length) {
        let html = `<div style="font-size:13.5px;color:#1e293b;line-height:1.6;padding:4px 0 8px">${tP1.intro||'Voici mes suggestions :'}</div>`;
        for (const d of tP1.destinations) {
          html += `<div style="background:#fff;border:1.5px solid #e6ebf7;border-radius:16px;padding:14px;margin-top:8px;cursor:pointer" onclick="send('${(d.name||'').replace(/'/g,"\\'")}')">
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
        if (tP1.question) html += `<div style="font-size:13.5px;color:#1e293b;line-height:1.6;padding:8px 0 0">${tP1.question}</div>`;
        return new Response(JSON.stringify({reply:html,sessionId:sid}),{headers:H});
      }

      // ── Phase 2 : Génération itinéraire (Claude + web search) ──
      const recap2 = tP1.recap || mergedStr || message;
      const tUser2 = `PROFIL VOYAGE: ${recap2}\n\nHISTORIQUE:\n${hist||''}\n\nMESSAGE: ${message}`;

      const tSys = `Tu es un expert agent de voyage pour Huntify. Tu crées des feuilles de route complètes et réalistes.

PROFIL : ${recap2}

════════════════════════════════════════
RÈGLE BUDGET — CRITIQUE
════════════════════════════════════════
Le budget donné est LE BUDGET TOTAL TOUT COMPRIS.
AVANT de proposer, dispatche le budget :
Ex: 1500€ / 2 pers / 4 nuits →
  Vols A/R (2 pers)    : ~300€
  Hébergement (4 nuits): ~600€ (~150€/nuit)
  Restaurants (4 soirs): ~240€
  Activités/visites    : ~200€
  Transport local      : ~80€
  Marge (5%)           : ~80€
  TOTAL                : 1500€ ✅

NE PROPOSE PAS d'hôtel hors budget hébergement calculé.
NE PROPOSE PAS de vols hors budget vols calculé.
════════════════════════════════════════

GÉNÈRE LA FEUILLE DE ROUTE COMPLÈTE :

1. VOLS — Recherche web depuis la ville de départ du client :
   - Vols pour les dates exactes demandées
   - Compagnie, horaires départ/arrivée, durée, escales
   - Prix RÉEL trouvé sur le web
   - Lien Skyscanner direct

2. HÔTELS — Recherche web sur Booking.com pour les dates exactes :
   - Prix réels disponibles, dans le budget hébergement calculé
   - 3 hôtels (budget/confort/luxe), liens Booking directs
   - Lien filtre Booking pour explorer d'autres options

3. ACTIVITÉS — Depuis ta connaissance (prix stables) :
   - Incontournables avec prix d'entrée approximatifs
   - Expériences locales adaptées au style du voyage

4. RESTAURANTS — Depuis ta connaissance (fourchettes fiables) :
   - 1 restaurant par soirée : nom réel, spécialité, fourchette de prix
   - Adapté au style (gastronomique / local / romantique)

5. PROGRAMME JOUR PAR JOUR :
   - Matin / Après-midi / Soirée avec activités et restaurants concrets
   - Prix approximatifs (fiables car stables)

6. BUDGET TOTAL détaillé basé sur les vrais prix trouvés

7. CONSEILS PRATIQUES personnalisés (transport, carte SIM, réservations, etc.)

JSON UNIQUEMENT :
{"type":"itinerary","recap":"...","itinerary":{"destination":"...","country":"...","flag":"...","duration":"...","travelers":"...","style":"...","ville_depart":"...","flights":{"outbound":{"from":"...","to":"...","price":"...","airline":"...","duration":"...","link":null},"return":{"from":"...","to":"...","price":"...","airline":"...","duration":"...","link":null}},"hotels":[{"name":"...","stars":3,"price":"...","location":"...","highlight":"...","booking_link":null,"category":"confort","minPrice":null,"maxPrice":null}],"days":[{"num":1,"title":"...","morning":"...","afternoon":"...","evening":"...","restaurant":{"name":"...","price":"...","specialty":"..."},"activities":["..."],"hotel":"...","budget":0}],"budget":{"flights_total":0,"accommodation_total":0,"activities_total":0,"food_total":0,"transport_local":0,"total":0,"per_person":0,"note":"..."},"tips":["..."]}}`;

      // Web search : vols (prix dynamiques) + hôtels (dispo dynamique)
      // Restaurants et activités depuis connaissance Claude (prix stables)
      const maxSearches = tStrategy === 'paid' ? 3 : 2;
      const tools2 = [{type:"web_search_20250305",name:"web_search",max_uses:maxSearches}];
      const tRaw2  = await callClaude(tSys, tUser2, 1500, tools2);
      const tP     = parseJSON(tRaw2||'');

      const itin = tP.itinerary;
      if (!itin) {
        return new Response(JSON.stringify({reply:`<div style="font-size:13.5px;color:#1e293b;line-height:1.6;padding:4px 0">Dis-moi où tu veux aller et ton budget, je te prépare une feuille de route complète avec vols, hôtels et programme ! ✈️</div>`,sessionId:sid}),{headers:H});
      }

      // ── Rendu HTML de l'itinéraire ──────────────────────────
      let html = '';

      // Header
      html += `<div style="background:linear-gradient(135deg,#1f2da0,#2f54ff);border-radius:16px;padding:18px;margin-bottom:4px;text-align:center">
        <div style="font-size:32px;margin-bottom:6px">${itin.flag||'✈️'}</div>
        <div style="font-family:'Sora',sans-serif;font-size:20px;font-weight:800;color:#fff">${itin.destination}${itin.country?', '+itin.country:''}</div>
        <div style="font-size:12px;color:rgba(255,255,255,.75);margin-top:6px;display:flex;justify-content:center;gap:12px;flex-wrap:wrap">
          <span>📅 ${itin.duration}</span>
          <span>👥 ${itin.travelers||'2 pers.'}</span>
          ${itin.budget?.total?`<span>💰 ~${itin.budget.total}€</span>`:''}
        </div>
        <div style="font-size:10px;color:rgba(255,255,255,.6);margin-top:6px">🔍 Prix vols et hôtels en temps réel</div>
      </div>`;

      if (tP.recap) html += recapBox(tP.recap);

      // Vols
      if (itin.flights) {
        const f = itin.flights;
        html += `<div style="font-size:12px;font-weight:800;color:#0e1430;margin:14px 0 6px">✈️ Vols recommandés</div>
        <div style="background:#fff;border:1.5px solid #e6ebf7;border-radius:14px;overflow:hidden">`;
        if (f.outbound) html += `<div style="padding:12px 14px;border-bottom:1px solid #f0f4ff">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <div><div style="font-size:10px;font-weight:800;color:#7c89a8;text-transform:uppercase">Aller</div>
            <div style="font-size:13px;font-weight:700;color:#0e1430;margin-top:2px">${f.outbound.from||''} → ${f.outbound.to||''}</div>
            <div style="font-size:11px;color:#7c89a8">${f.outbound.airline||''} · ${f.outbound.duration||''}</div></div>
            <div style="text-align:right"><div style="font-size:16px;font-weight:900;color:#2f54ff">${f.outbound.price||'Voir prix'}</div><div style="font-size:10px;color:#7c89a8">/ pers.</div></div>
          </div></div>`;
        if (f.return) html += `<div style="padding:12px 14px">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <div><div style="font-size:10px;font-weight:800;color:#7c89a8;text-transform:uppercase">Retour</div>
            <div style="font-size:13px;font-weight:700;color:#0e1430;margin-top:2px">${f.return.from||''} → ${f.return.to||''}</div>
            <div style="font-size:11px;color:#7c89a8">${f.return.airline||''} · ${f.return.duration||''}</div></div>
            <div style="text-align:right"><div style="font-size:16px;font-weight:900;color:#2f54ff">${f.return.price||'Voir prix'}</div><div style="font-size:10px;color:#7c89a8">/ pers.</div></div>
          </div></div>`;
        html += `</div>`;

        // Lien Skyscanner avec IATA
        function extractIATA(str) {
          if (!str) return '';
          const m = (str||'').match(/\b([A-Z]{3})\b/);
          return m ? m[1].toLowerCase() : encodeURIComponent((str||'').slice(0,3).toLowerCase());
        }
        const fromIATA = f.outbound?.from ? extractIATA(f.outbound.from) : 'par';
        const toIATA   = f.outbound?.to   ? extractIATA(f.outbound.to)   : encodeURIComponent((itin.destination||'').slice(0,3).toLowerCase());
        const flightLink = f.outbound?.link || `https://www.skyscanner.fr/transport/vols/${fromIATA}/${toIATA}/`;
        html += `<a href="${flightLink}" target="_blank" style="display:flex;align-items:center;justify-content:center;gap:8px;background:linear-gradient(135deg,#0e1430,#1f2da0);color:#fff;text-decoration:none;border-radius:12px;padding:11px;font-size:13px;font-weight:700;margin-top:6px">🔍 Comparer tous les vols sur Skyscanner →</a>`;
      }

      // Hôtels
      if (itin.hotels?.length) {
        html += `<div style="font-size:12px;font-weight:800;color:#0e1430;margin:16px 0 6px">🏨 Hébergements sur Booking.com</div>`;
        const nights = parseInt((itin.duration||'').match(/\d+/)?.[0]||'5');
        for (const h of itin.hotels) {
          const hotelSearch = (h.name+' '+(h.location||'')+' '+(itin.destination||'')).trim();
          html += hotelCard(h, h.booking_link || buildBookingLink(hotelSearch, nights));
        }
        // Lien Explorer d'autres hôtels
        const hPrices = (itin.hotels||[]).map(h=>parseInt(h.price)||0).filter(p=>p>0);
        const hMin = hPrices.length ? Math.max(0, Math.min(...hPrices)-30) : null;
        const hMax = hPrices.length ? Math.max(...hPrices)+50 : null;
        html += `<a href="${buildBookingLink(itin.destination||'',nights,2,hMin,hMax)}" target="_blank" style="display:flex;align-items:center;justify-content:center;gap:8px;background:#f5f7ff;border:1.5px solid #c7d2fe;color:#3b5bdb;text-decoration:none;border-radius:12px;padding:10px;margin-top:8px;font-size:12px;font-weight:700">🔍 Explorer d'autres hôtels sur Booking.com →</a>`;
      }

      // Programme jour par jour
      if (itin.days?.length) {
        html += `<div style="font-size:12px;font-weight:800;color:#0e1430;margin:16px 0 6px">📅 Programme jour par jour</div>`;
        for (const d of itin.days) html += dayCard(d);
      }

      // Budget
      if (itin.budget) html += budgetCard(itin.budget);

      // Conseils
      if (itin.tips?.length) html += tipsCard(itin.tips);

      // Wishlist
      const vPrice = itin.budget?.total ? itin.budget.total+'€' : '';
      const vUrl   = (itin.hotels||[])[0]?.booking_link || buildBookingLink(itin.destination||'',5);
      const vData  = JSON.stringify({name:`Voyage ${itin.destination||''}${itin.country?' ('+itin.country+')':''}`,price:vPrice,store:'booking',url:vUrl}).replace(/"/g,'&quot;');
      html += `<button onclick="addToWishlist(${vData})" style="background:linear-gradient(135deg,#1f2da0,#2f54ff);border:none;color:#fff;border-radius:12px;padding:12px 16px;margin-top:12px;font-weight:700;font-size:13px;cursor:pointer;font-family:inherit;width:100%">♡ Sauvegarder ce voyage dans ma wishlist</button>`;
      html += `<div style="font-size:10px;color:#7c89a8;text-align:center;margin-top:5px">Retrouve ta feuille de route dans Compte → Wishlist ✈️</div>`;

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
      const p1sys = `Tu es un assistant shopping pour Huntify. Tu parles naturellement comme un ami qui s'y connaît.

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
1. Ne redemande JAMAIS ce qui est dans l'historique
2. MAX ${MAX_Q} questions (posées: ${qAsked})
3. Si tu as produit + usage OU budget → ready:true
4. Recap = mots-clés produit concrets (PAS les réponses brutes)
   Ex: "couvrant + rougeurs" → recap:"fond de teint couvrant anti-rougeurs"

HISTORIQUE: ${hist||'Début'}

JSON UNIQUEMENT :
{"ready":false,"message":"question naturelle"}
{"ready":true,"recap":"mots-clés produit","message":"phrase courte"}`;

      const p1user = `HISTORIQUE:\n${hist||'Début'}\nQuestions: ${qAsked}/${MAX_Q}\nMESSAGE: ${message}`;

      // Chaining si réponse ambiguë
      const isAmbiguous = message.trim().split(/\s+/).length <= 3 && !/\d+\s*€/.test(message);
      let t1 = null;
      if (isAmbiguous && (history||[]).length > 0) {
        const interp = await chainAI(
          `Le client dit "${message}" en contexte shopping. Que veut-il dire ? JSON: {"meaning":"...","searchTerms":"..."}`,
          hist
        );
        if (interp) t1 = await callFreeAI(p1sys, p1user+'\n\nINTERPRETATION: '+interp, 'fast');
      }
      if (!t1) t1 = await callFreeAI(p1sys, p1user, 'fast');

      if (t1) {
        const d = parseJSON(t1);
        decision.ready    = d.ready===true;
        decision.question = d.question||d.message||null;
        decision.recap    = d.recap||null;
        decision.message  = d.message||d.question||null;
      } else {
        decision.ready = true;
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
