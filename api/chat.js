export const config = { runtime: 'edge' };

const SUPABASE_URL  = "https://enocxbrqyybendertytl.supabase.co";
const SUPABASE_KEY  = "sb_publishable_NmPh--frZG5HuqfaoxnemA_E7cidV9Y";
const MODEL         = 'claude-haiku-4-5';
const MAX_Q         = 3;
const AMAZON_TAG    = 'huntify21-21';
const AWIN_PUB      = '2920215';
const TODAY         = new Date().toISOString().slice(0,10);

// ── TRAVELPAYOUTS HOTELLOOK — vrais hotels + vrais prix ─────────────────────
const TP_MARKER = '536663';

// Retourne 3 vrais hotels (budget/confort/luxe) depuis Hotellook avec vrais prix
async function fetchRealHotels(destination, checkin, checkout, adults=2) {
  const token = process.env.TRAVELPAYOUTS_TOKEN;
  if (!token || !checkin || !checkout) return null;
  try {
    const url = 'https://engine.hotellook.com/api/v2/cache.json'
      + '?location=' + encodeURIComponent(destination)
      + '&checkIn=' + checkin
      + '&checkOut=' + checkout
      + '&adultsCount=' + adults
      + '&currency=EUR'
      + '&token=' + token
      + '&limit=25';
    const r = await fetch(url, { headers:{'Accept':'application/json'} });
    if (!r.ok) return null;
    const data = await r.json();
    if (!Array.isArray(data) || !data.length) return null;

    const valid = data
      .filter(h => h.priceFrom && (h.hotelName||h.name) && h.id)
      .map(h => ({
        name:  h.hotelName || h.name,
        stars: Math.round(h.stars || 3),
        price: Math.round(h.priceFrom),
        loc:   (h.location && h.location.name) || destination,
        url:   'https://www.hotellook.com/hotels/' + h.id + '?marker=' + TP_MARKER + '&adults=' + adults + '&checkIn=' + checkin + '&checkOut=' + checkout + '&currency=EUR',
        id:    h.id
      }))
      .sort((a,b) => a.price - b.price);

    if (valid.length < 2) return null;

    const third = Math.max(1, Math.floor(valid.length / 3));
    const pick = (arr) => arr[Math.floor(arr.length/2)];

    return [
      {...pick(valid.slice(0, third)),       cat:'budget',  hl:'Meilleur rapport qualite/prix'},
      {...pick(valid.slice(third, third*2)),  cat:'confort', hl:'Confort et emplacement ideal'},
      {...pick(valid.slice(-third)),          cat:'luxe',    hl:'Experience premium'},
    ];
  } catch(e) { return null; }
}

function buildHotellookLink(destination, checkin, checkout, adults=2, minPrice=null, maxPrice=null) {
  let url = 'https://www.hotellook.com/search'
    + '?location=' + encodeURIComponent(destination)
    + '&marker=' + TP_MARKER
    + '&adults=' + adults
    + '&currency=EUR';
  if (checkin && checkout) url += '&checkIn=' + checkin + '&checkOut=' + checkout;
  if (minPrice) url += '&priceMin=' + minPrice;
  if (maxPrice) url += '&priceMax=' + maxPrice;
  return url;
}

// ── IATA MAP ─────────────────────────────────────────────────────────────────
const IATA_MAP = {
  paris:'CDG','paris cdg':'CDG','paris orly':'ORY',lyon:'LYS',marseille:'MRS',
  nice:'NCE',bordeaux:'BOD',toulouse:'TLS',nantes:'NTE',strasbourg:'SXB',
  montpellier:'MPL',biarritz:'BIQ',grenoble:'GNB',brest:'BES',rennes:'RNS',
  rome:'FCO','rome fco':'FCO',milan:'MXP','milan malpensa':'MXP',venise:'VCE',
  naples:'NAP',florence:'FLR',catane:'CTA',palerme:'PMO',bologne:'BLQ',
  turin:'TRN',pise:'PSA',bari:'BRI',
  barcelone:'BCN',madrid:'MAD',ibiza:'IBZ',majorque:'PMI',seville:'SVQ',
  malaga:'AGP',valence:'VLC',bilbao:'BIO',alicante:'ALC',tenerife:'TFS',
  lisbonne:'LIS',porto:'OPO',faro:'FAO',
  londres:'LHR','london heathrow':'LHR','london gatwick':'LGW',manchester:'MAN',edimbourg:'EDI',
  amsterdam:'AMS',bruxelles:'BRU',zurich:'ZRH',geneve:'GVA',vienne:'VIE',
  berlin:'BER',munich:'MUC',francfort:'FRA',hambourg:'HAM',dusseldorf:'DUS',
  prague:'PRG',budapest:'BUD',varsovie:'WAW',bucarest:'OTP',
  athenes:'ATH',thessalonique:'SKG',santorin:'JTR',mykonos:'JMK',
  crete:'HER',heraklion:'HER',rhodes:'RHO',corfou:'CFU',
  marrakech:'RAK',casablanca:'CMN',agadir:'AGA',tunis:'TUN',djerba:'DJE',
  hurghada:'HRG','charm el cheikh':'SSH',caire:'CAI',
  istanbul:'IST',antalya:'AYT',bodrum:'BJV',
  dubai:'DXB','abu dhabi':'AUH',doha:'DOH',
  tokyo:'NRT',osaka:'KIX',bangkok:'BKK',singapour:'SIN',
  'hong kong':'HKG',bali:'DPS',denpasar:'DPS','kuala lumpur':'KUL',
  shanghai:'PVG',pekin:'PEK',seoul:'ICN',hanoi:'HAN',
  'new york':'JFK','los angeles':'LAX',miami:'MIA',montreal:'YUL',
  cancun:'CUN',dakar:'DSS',nairobi:'NBO',reunion:'RUN',maldives:'MLE',
  maurice:'MRU',
};

function cityToIATA(str) {
  if (!str) return null;
  const m3 = (str||'').match(/\b([A-Z]{3})\b/);
  if (m3) return m3[1].toUpperCase();
  const s = str.toLowerCase().trim();
  for (const [k,v] of Object.entries(IATA_MAP)) { if (s.includes(k)) return v; }
  const init = s.replace(/[^a-z]/g,'').slice(0,3).toUpperCase();
  return init.length===3 ? init : null;
}

// ── SUPABASE ──────────────────────────────────────────────────────────────────
async function sbFetch(path, method='GET', body=null) {
  const opts = { method, headers:{'Content-Type':'application/json','apikey':SUPABASE_KEY,'Authorization':`Bearer ${SUPABASE_KEY}`} };
  if (body) opts.body = JSON.stringify(body);
  try { const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, opts); return await r.json(); } catch(e) { return null; }
}
async function getAdvertisers() {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/advertisers?active=eq.true`,
      {headers:{'apikey':SUPABASE_KEY,'Authorization':`Bearer ${SUPABASE_KEY}`}});
    return await r.json();
  } catch(e) { return []; }
}

// ── NETTOYAGE MOTS-CLÉS ───────────────────────────────────────────────────────
function cleanKw(kw) {
  if (!kw) return '';
  const preserve = ['fond de teint','eau de toilette','eau de parfum','creme de jour',
    'creme de nuit','sac a main','sac a dos','machine a laver'];
  const cleaned = kw.replace(/,/g,' ').replace(/\s+/g,' ').trim();
  const lower = cleaned.toLowerCase();
  for (const expr of preserve) {
    if (lower.includes(expr)) {
      const rest = lower.replace(expr,'').trim();
      const rw = rest.split(' ').filter(w=>w.length>1).slice(0,3).join(' ');
      return (expr+' '+rw).trim().slice(0,60);
    }
  }
  const stop = new Set(['la','le','les','un','une','des','avec','et','en','du','au','aux','style']);
  return cleaned.split(' ').filter(w=>w.length>1&&!stop.has(w.toLowerCase())).slice(0,6).join(' ');
}

// ── LIENS AFFILIATION ─────────────────────────────────────────────────────────
function buildLink(adv, keywords, directUrl=null) {
  if (!adv?.active) return null;
  const kw = cleanKw(keywords);
  if (adv.slug === 'amazon') {
    const tag = adv.amazon_tag || AMAZON_TAG;
    const isValidAsin = directUrl && directUrl!=='null' && directUrl.length>15
      && (directUrl.includes('/dp/') || directUrl.includes('amazon'))
      && !directUrl.includes('/dp/null') && !directUrl.includes('/dp/undefined');
    const base = isValidAsin ? directUrl.split('?')[0] : `https://www.amazon.fr/s?k=${encodeURIComponent(kw)}`;
    return `${base}?tag=${tag}`;
  }
  if (adv.awin_mid) {
    const affid = adv.awin_affid || adv.awin_aff || AWIN_PUB;
    let dest;
    if (adv.slug === 'rakuten') {
      dest = `https://fr.shopping.rakuten.com/s/${encodeURIComponent(kw.replace(/\s+/g,'+'))}`;
    } else if (adv.search_url) {
      dest = adv.search_url.replace('{keywords}', encodeURIComponent(kw));
    } else {
      dest = `https://www.${adv.slug}.fr/catalogsearch/result/?q=${encodeURIComponent(kw)}`;
    }
    return `https://www.awin1.com/cread.php?awinmid=${adv.awin_mid}&awinaffid=${affid}&ued=${encodeURIComponent(dest)}`;
  }
  return null;
}
function findAdv(advertisers, slug) {
  return advertisers.find(a=>a.slug===slug?.toLowerCase()) || null;
}

// ── BOOKING ───────────────────────────────────────────────────────────────────
function buildBookingLink(dest, nights=3, adults=2, minP=null, maxP=null, ci=null, co=null) {
  const d = encodeURIComponent((dest||'').trim());
  let url = `https://www.booking.com/searchresults.html?ss=${d}&group_adults=${adults}&no_rooms=${Math.ceil(adults/2)}&lang=fr`;
  if (ci && co) url += `&checkin=${ci}&checkout=${co}`;
  else if (nights>0) url += `&nights=${nights}`;
  if (minP!=null && maxP!=null && maxP>0) url += `&nflt=price%3DEUR-${Math.round(minP)}-${Math.round(maxP)}-1`;
  url += `&order=class`;
  const cjP = process.env.CJ_PUBLISHER_ID, cjA = process.env.CJ_BOOKING_ADVERTISER_ID;
  return (cjP && cjA) ? `https://www.anrdoezrs.net/click-${cjP}-${cjA}?url=${encodeURIComponent(url)}` : url;
}

// ── SKYSCANNER ────────────────────────────────────────────────────────────────
function buildSkyscannerLink(fromStr, toStr, outbound, inbound, adults=2) {
  const from = (cityToIATA(fromStr)||'par').toLowerCase();
  const to   = (cityToIATA(toStr)  ||'xxx').toLowerCase();
  const fmt  = d => d ? d.replace(/-/g,'').slice(2) : null;
  const out  = fmt(outbound), ret = fmt(inbound);
  const base = `https://www.skyscanner.fr/transport/vols/${from}/${to}/`;
  if (out && ret) return `${base}${out}/${ret}/?adults=${adults}&currency=EUR&locale=fr-FR`;
  if (out)        return `${base}${out}/?adults=${adults}&currency=EUR&locale=fr-FR`;
  return base;
}

// ── PARSE DATE ────────────────────────────────────────────────────────────────
function parseDate(str) {
  if (!str) return null;
  const s = str.trim().toLowerCase();
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  const now = new Date();
  const addDays = n => { const d=new Date(now); d.setDate(d.getDate()+n); return d.toISOString().slice(0,10); };
  if (s==='demain'||s==='tomorrow') return addDays(1);
  if (/après-?demain/.test(s)) return addDays(2);
  if (/week-?end/.test(s)) { const g=(6-now.getDay()+7)%7||7; return addDays(g); }
  const dm = str.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (dm) { const y=dm[3].length===2?'20'+dm[3]:dm[3]; return `${y}-${dm[2].padStart(2,'0')}-${dm[1].padStart(2,'0')}`; }
  const MONTHS = {jan:1,janv:1,janvier:1,'fév':2,'fev':2,mars:3,avr:4,avril:4,mai:5,juin:6,
    juil:7,juillet:7,'aoû':8,aout:8,sep:9,sept:9,oct:10,nov:11,'déc':12,dec:12};
  const fm = s.match(/(\d{1,2})\s+([a-zéûôàù]+)(?:\s+(\d{4}))?/);
  if (fm) {
    const mm = Object.entries(MONTHS).find(([k])=>fm[2].startsWith(k));
    if (mm) return `${fm[3]||now.getFullYear()}-${String(mm[1]).padStart(2,'0')}-${fm[1].padStart(2,'0')}`;
  }
  const dayOnly = str.match(/^(\d{1,2})$/);
  if (dayOnly) {
    const day=parseInt(dayOnly[1]), cur=new Date(now);
    if (day<=cur.getDate()) cur.setMonth(cur.getMonth()+1);
    cur.setDate(day); return cur.toISOString().slice(0,10);
  }
  return null;
}

// ── EXTRACTION VOYAGE ─────────────────────────────────────────────────────────
function extractTravelInfo(hist, message) {
  const text = ((hist||'')+' '+message).toLowerCase();
  const info = {};
  const destPatterns = [
    /(?:aller|partir|voyager|visiter)\s+(?:a|à|en|au|aux|pour)?\s*([a-zA-ZÀ-ÿ]{2,20})/i,
    /(?:destination|pour)\s*:?\s*([a-zA-ZÀ-ÿ]{2,20})/i,
    /(?:week.?end|séjour|vacances)\s+(?:a|à|en|au)?\s*([a-zA-ZÀ-ÿ]{2,20})/i,
  ];
  for (const p of destPatterns) { const m=text.match(p); if(m){info.destination=m[1].trim();break;} }
  const budM = text.match(/budget\s*:?\s*(\d+)\s*(?:€|euros?)/i) || text.match(/(\d+)\s*(?:€|euros?)/i);
  if (budM) info.budget = budM[1]+'€';
  const durM = text.match(/(\d+)\s*(?:jours?|nuits?|semaines?)/i);
  if (durM) info.duree = durM[0];
  const depP = [
    /depuis\s+([a-zA-ZÀ-ÿ\s]{2,20})(?:\s|,|\.)/i,
    /(?:départ|depart)\s+de\s+([a-zA-ZÀ-ÿ\s]{2,20})(?:\s|,|\.)/i,
    /(?:je pars?|on part)\s+(?:de|depuis)\s+([a-zA-ZÀ-ÿ\s]{2,20})/i,
    /au départ de\s+([a-zA-ZÀ-ÿ\s]{2,20})/i,
  ];
  for (const p of depP) { const m=text.match(p); if(m){info.ville_depart=m[1].trim();break;} }
  const rf = text.match(/du\s+(\d{1,2}\s+\w+(?:\s+\d{4})?)\s+au\s+(\d{1,2}\s+\w+(?:\s+\d{4})?)/i);
  const rs = text.match(/du\s+(\d{1,2})\s+au\s+(\d{1,2}\s+\w+(?:\s+\d{4})?)/i);
  if (rf) { info.date_depart_raw=rf[1].trim(); info.date_retour_raw=rf[2].trim(); }
  else if (rs) { info.date_depart_raw=rs[1].trim(); info.date_retour_raw=rs[2].trim(); }
  else {
    const sd = text.match(/(\d{1,2}\s+(?:jan|fév|mar|avr|mai|juin|juil|aoû|sep|oct|nov|déc)\w*(?:\s+\d{4})?)/i);
    if (sd) info.date_depart_raw = sd[1].trim();
    if (/demain/.test(text) && !info.date_depart_raw) info.date_depart_raw='demain';
  }
  const am = text.match(/(\d+)\s+adultes?/i) || text.match(/pour\s+(\d+)\s+(?:personnes?|adultes?)/i);
  if (am) info.nb_adultes=parseInt(am[1]);
  else if (/seul\b/.test(text)) info.nb_adultes=1;
  else if (/couple|deux|2\s*pers/.test(text)) info.nb_adultes=2;
  else if (/famille|3\s*pers|trio/.test(text)) info.nb_adultes=3;
  if (/chill|plage|repos|détente/.test(text)) info.style='chill';
  else if (/culture|musée|histoire|patrimoine/.test(text)) info.style='culture';
  else if (/aventure|randonnée|nature/.test(text)) info.style='aventure';
  else if (/famille|enfant/.test(text)) info.style='famille';
  else if (/romantique|amoureux|couple/.test(text)) info.style='romantique';
  else if (/gastro|manger|cuisine|food/.test(text)) info.style='gastronomie';
  return info;
}

// ── APPELS IA ─────────────────────────────────────────────────────────────────
async function callGroq(sys, user, model, maxTok) {
  const key = process.env.GROQ_API_KEY; if (!key) return null;
  try {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions',{
      method:'POST', headers:{'Content-Type':'application/json','Authorization':`Bearer ${key}`},
      body:JSON.stringify({model, max_tokens:maxTok, messages:[{role:'system',content:sys},{role:'user',content:user}]})
    });
    if (!r.ok) return null;
    const d = await r.json(); return d.choices?.[0]?.message?.content||null;
  } catch(e){return null;}
}

// GROQ DEEPSEARCH — compound-beta (web search intégré GRATUIT)
async function callGroqDS(prompt, maxTok=1000) {
  const key = process.env.GROQ_API_KEY; if (!key) return null;
  try {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions',{
      method:'POST', headers:{'Content-Type':'application/json','Authorization':`Bearer ${key}`},
      body:JSON.stringify({model:'compound-beta', max_tokens:maxTok, messages:[{role:'user',content:prompt}]})
    });
    if (!r.ok) {
      // fallback: llama-3.3-70b si compound-beta indisponible
      return await callGroq('Réponds en JSON uniquement.', prompt, 'llama-3.3-70b-versatile', maxTok);
    }
    const d = await r.json(); return d.choices?.[0]?.message?.content||null;
  } catch(e){ return await callGroq('Réponds en JSON.', prompt, 'llama-3.3-70b-versatile', maxTok); }
}

async function callGemini(sys, user, maxTok) {
  const key = process.env.GEMINI_API_KEY; if (!key) return null;
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`,{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({contents:[{parts:[{text:`${sys}\n\n${user}`}]}],generationConfig:{maxOutputTokens:maxTok}})
    });
    if (!r.ok) return null;
    const d=await r.json(); return d.candidates?.[0]?.content?.parts?.[0]?.text||null;
  } catch(e){return null;}
}

async function callMistral(sys, user, maxTok) {
  const key = process.env.MISTRAL_API_KEY; if (!key) return null;
  try {
    const r = await fetch('https://api.mistral.ai/v1/chat/completions',{
      method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${key}`},
      body:JSON.stringify({model:'mistral-small-latest',max_tokens:maxTok,messages:[{role:'system',content:sys},{role:'user',content:user}]})
    });
    if (!r.ok) return null;
    const d=await r.json(); return d.choices?.[0]?.message?.content||null;
  } catch(e){return null;}
}

// Cascade gratuite Groq→Gemini→Mistral
async function callFreeAI(sys, user, maxTok=400) {
  return await callGroq(sys,user,'llama-3.3-70b-versatile',maxTok)
      || await callGemini(sys,user,maxTok)
      || await callMistral(sys,user,maxTok);
}

function hasFreeAI() {
  return !!(process.env.GROQ_API_KEY||process.env.GEMINI_API_KEY||process.env.MISTRAL_API_KEY);
}

// CLAUDE
async function callClaude(sys, user, maxTok=700, tools=[]) {
  const r = await fetch("https://api.anthropic.com/v1/messages",{
    method:"POST",
    headers:{"Content-Type":"application/json; charset=utf-8",
      "x-api-key":process.env.ANTHROPIC_API_KEY,
      "anthropic-version":"2023-06-01"},
    body:JSON.stringify({model:MODEL, max_tokens:maxTok, tools,
      system:sys,
      messages:[{role:"user",content:user}]})
  });
  const d=await r.json();
  if (!r.ok) throw new Error(d.error?.message||"Claude error");
  let t=""; for(const b of d.content){if(b.type==="text")t+=b.text;} return t;
}

function parseJSON(raw) {
  if (!raw) return {};
  try {
    const md = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (md) return JSON.parse(md[1].trim());
    const obj = raw.match(/\{[\s\S]*\}/);
    if (obj) return JSON.parse(obj[0]);
  } catch(e){}
  return {};
}

// ── UTILITAIRES ───────────────────────────────────────────────────────────────
function buildHistory(history, maxLen=1800) {
  return (history||[]).map(m=>{
    const role=m.role==='user'?'Client':'Agent';
    const text=(m.content||'').replace(/<[^>]*>/g,' ').replace(/&[^;]+;/g,' ').replace(/\s+/g,' ').trim().slice(0,350);
    return text?`${role}: ${text}`:null;
  }).filter(Boolean).join('\n').slice(0,maxLen);
}

function buildHistShort(history) { return buildHistory(history, 900); }  // pour Groq (contexte limité)

async function queryInternalDB(keywords) {
  const kw=(keywords||'').toLowerCase().split(' ')[0];
  const results={deals:[],prices:[],promos:[],hasData:false};
  try {
    const [deals,prices,promos]=await Promise.all([
      sbFetch(`daily_deals?name=ilike.*${encodeURIComponent(kw)}*&limit=3`),
      sbFetch(`price_history?product_name=ilike.*${encodeURIComponent(kw)}*&order=checked_at.desc&limit=5`),
      sbFetch(`promo_codes?valid=eq.true&order=found_at.desc&limit=3`)
    ]);
    if (deals?.length){results.deals=deals;results.hasData=true;}
    if (prices?.length){results.prices=prices;results.hasData=true;}
    if (promos?.length) results.promos=promos;
  }catch(e){}
  return results;
}

function buildDBContext(d) {
  if (!d.hasData) return '';
  const p=['DONNÉES INTERNES :'];
  if (d.deals?.length)  p.push('Deals: '+d.deals.map(x=>`${x.name} ${x.price||''}`).join(' | '));
  if (d.prices?.length) p.push('Prix: '+d.prices.map(x=>`${x.product_name} ${x.price}€`).join(' | '));
  if (d.promos?.length) p.push('Codes: '+d.promos.map(x=>`${x.code} ${x.store||''}`).join(' | '));
  return p.join('\n');
}

function detectBudget(text) {
  if (!text) return null;
  const p=[/(?:moins de|maxi?|budget|environ)[^\d]*(\d+)\s*(?:€|euros?)/i,/(\d+)\s*(?:€|euros?)\s*(?:max|budget|environ)/i,/budget[^\d]*(\d+)/i,/(\d{2,})\s*€/];
  for (const r of p){const m=text.match(r);if(m){const b=parseInt(m[1]);if(b>0&&b<100000)return b;}}
  return null;
}

function estimateROI(budget, message, hist) {
  let s=0;
  const msg=(message+' '+(hist||'')).toLowerCase();
  if (budget===null) s+=2; else if (budget<30) s+=0; else if (budget<80) s+=1;
  else if (budget<200) s+=3; else if (budget<500) s+=5; else s+=8;
  if (/urgent|maintenant|aujourd'hui|vite/.test(msg)) s+=2;
  if (/famille|couple|enfants?|pour \d/.test(msg)) s+=2;
  if (/cadeau|anniversaire|noel|mariage/.test(msg)) s+=2;
  if (/premium|luxe|meilleur|pas de budget/.test(msg)) s+=3;
  return {score:s, depth:s>=6?'deep':s>=3?'medium':'light'};
}

function detectCategory(text) {
  if (!text) return 'general';
  const t=text.toLowerCase();
  if (/fond de teint|mascara|parfum|creme|maquillage|beaute/.test(t)) return 'beaute';
  if (/casque|telephone|laptop|tablette|tv|console|gaming/.test(t)) return 'electronique';
  if (/robe|veste|pantalon|chaussure|sneaker|jean|mode/.test(t)) return 'mode';
  if (/cadeau|anniversaire|noel|mariage|offrir/.test(t)) return 'cadeau';
  if (/sport|running|velo|yoga|fitness/.test(t)) return 'sport';
  return 'general';
}

function countQ(history) {
  return (history||[]).filter(m=>m.role!=='user'&&(m.content||'').includes('data-qbox')).length;
}
function countTravelQ(history) {
  return (history||[]).filter(m=>m.role!=='user'&&(m.content||'').length>20).length;
}

async function getAutoCoupons(store) {
  try {
    const p=await sbFetch(`promo_codes?valid=eq.true&store=eq.${encodeURIComponent(store)}&order=found_at.desc&limit=2`);
    return (p||[]).filter(x=>x.code);
  } catch(e){return [];}
}

function getCrossSuggestions(recap) {
  const r=(recap||'').toLowerCase();
  const map={'fond de teint':['éponge beautyblender','primer teint'],'casque':['housse transport casque'],
    'telephone':['coque protection','verre trempé'],'laptop':['housse laptop','souris sans fil'],
    'sneakers':['semelles confort','spray imperméabilisant'],'parfum':['coffret miniatures']};
  for (const [k,v] of Object.entries(map)) if (r.includes(k)) return v;
  return [];
}

// ── COMPOSANTS HTML ───────────────────────────────────────────────────────────
function productCard(name, price, url, adv, img, badge) {
  const imgH  = img?`<img src="${img}" style="width:56px;height:56px;object-fit:cover;border-radius:8px;flex-shrink:0" onerror="this.style.display='none'">`:'';
  const badgeH= badge?`<span style="background:rgba(255,255,255,.22);border-radius:100px;padding:2px 8px;font-size:10px;font-weight:700">${badge}</span>`:'';
  const pill  = `<span style="background:rgba(255,255,255,.18);border:1px solid rgba(255,255,255,.35);border-radius:100px;padding:2px 9px;font-size:10px;font-weight:800">${adv.emoji||'🛍️'} ${adv.name}</span>`;
  return `<a href="${url}" target="_blank" rel="sponsored noopener" style="display:flex;align-items:center;gap:12px;background:${adv.color||'#2f54ff'};color:#fff;text-decoration:none;border-radius:14px;padding:12px 14px;margin-top:8px">
    ${imgH}
    <div style="flex:1;min-width:0">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;flex-wrap:wrap">${pill}${badgeH}</div>
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
  const icon=trend==='down'?'📉':trend==='up'?'📈':'➡️';
  const color=trend==='down'?'#dcfce7':trend==='up'?'#fee2e2':'#f1f5f9';
  const border=trend==='down'?'#86efac':trend==='up'?'#fca5a5':'#e2e8f0';
  const msg=trend==='down'?`Prix en baisse ! Était ${old}€ ✅`:trend==='up'?`⚠️ Prix gonflé ! Était ${old}€`:'Prix stable';
  return `<div style="background:${color};border:1.5px solid ${border};border-radius:12px;padding:10px 14px;margin-top:8px;font-size:12px;font-weight:600;color:#374151">${icon} ${msg}</div>`;
}

function recapBox(r) {
  return `<div style="background:#f5f3ff;border:1.5px solid #ddd6fe;border-radius:12px;padding:10px 14px;margin-top:8px;font-size:12px;color:#5b21b6;font-weight:600">🔎 ${r}</div>`;
}

function hotelCard(h, bookingUrl) {
  const stars='⭐'.repeat(Math.min(h.stars||3,5));
  const cc={budget:'#16a34a',confort:'#2f54ff',luxe:'#7c3aed'}[h.category]||'#2f54ff';
  const cl={budget:'💚 Budget',confort:'💙 Confort',luxe:'💎 Luxe'}[h.category]||'';
  const url=h.booking_link||bookingUrl;
  const hasRealPrice = h.price && h.priceReal;
  const priceBlock = hasRealPrice
    // Prix réel Hotellook → affiché en vert
    ? `<div style="background:linear-gradient(135deg,#16a34a,#15803d);color:#fff;border-radius:10px;padding:7px 11px;text-align:center;flex-shrink:0;margin-left:8px">
        <div style="font-size:9px;opacity:.85;margin-bottom:1px">Prix réel ✓</div>
        <div style="font-size:15px;font-weight:900">${h.price}€</div>
        <div style="font-size:9px;opacity:.75">/nuit</div>
       </div>`
    // Pas de prix → bouton "Voir"
    : `<div style="background:linear-gradient(135deg,${cc},${cc}cc);color:#fff;border-radius:10px;padding:8px 12px;text-align:center;flex-shrink:0;white-space:nowrap">
        <div style="font-size:10px;opacity:.85;margin-bottom:2px">Prix réel</div>
        <div style="font-size:12px;font-weight:800">Voir →</div>
       </div>`;
  return `<a href="${url}" target="_blank" rel="sponsored noopener" style="display:flex;flex-direction:column;background:#fff;border:1.5px solid ${hasRealPrice?'#bbf7d0':'#e6ebf7'};border-radius:14px;padding:13px;margin-top:8px;text-decoration:none;gap:5px">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px">
      <div style="flex:1">
        ${cl?`<span style="background:#eff6ff;color:${cc};border-radius:100px;padding:2px 9px;font-size:10px;font-weight:800">${cl}</span>`:''}
        <div style="font-size:13px;font-weight:800;color:#0e1430;margin-top:3px">${h.name}</div>
        <div style="font-size:11px;color:#7c89a8">${stars} · ${h.location||''}</div>
      </div>
      ${priceBlock}
    </div>
    ${h.highlight?`<div style="font-size:11px;color:#2f54ff;font-weight:600;background:#eff6ff;border-radius:8px;padding:4px 10px">✨ ${h.highlight}</div>`:''}
    <div style="background:${hasRealPrice?'#f0fdf4':'#f0f9ff'};border-radius:8px;padding:6px 10px;display:flex;align-items:center;gap:6px;margin-top:2px">
      <span style="font-size:11px">${hasRealPrice?'🟢':'🏨'}</span>
      <span style="font-size:11px;color:${hasRealPrice?'#15803d':'#0369a1'};font-weight:600">${hasRealPrice?'Prix vérifié · Réserver sur Hotellook →':'Voir les prix en temps réel sur Hotellook →'}</span>
    </div>
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
  // Hôtel affiché comme fourchette estimée, pas un prix exact
  const items=[
    ['✈️ Vols A/R',         b.vols,   false],
    ['🏨 Hébergement',      b.hotel,  true],   // true = estimé
    ['🎯 Activités',        b.acts,   false],
    ['🍽️ Restaurants',      b.resto,  false],
    ['🚇 Transport local',  b.transport, false]
  ].filter(i=>i[1]!=null);
  return `<div style="background:linear-gradient(135deg,#0e1430,#1f2da0);border-radius:16px;padding:16px;margin-top:12px">
    <div style="font-size:13px;font-weight:800;color:#fff;margin-bottom:12px">💰 Budget estimé par l'IA</div>
    ${items.map(([l,v,est])=>`<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:7px">
      <span style="font-size:12px;color:rgba(255,255,255,.75)">${l}</span>
      <span style="font-size:12px;font-weight:700;color:#fff">~${v}€${est?' <span style="font-size:9px;opacity:.55;font-weight:400">estimé</span>':''}</span>
    </div>`).join('')}
    <div style="border-top:1px solid rgba(255,255,255,.2);margin-top:10px;padding-top:10px;display:flex;justify-content:space-between;align-items:center">
      <span style="font-size:13px;font-weight:800;color:#fff">TOTAL</span>
      <span style="font-size:16px;font-weight:900;color:#bcd0ff">~${b.total||''}€</span>
    </div>
    ${b.pp?`<div style="font-size:11px;color:rgba(255,255,255,.6);text-align:right;margin-top:3px">soit ~${b.pp}€/personne</div>`:''}
    <div style="background:rgba(255,255,255,.07);border-radius:8px;padding:8px 10px;margin-top:10px;font-size:10px;color:rgba(255,255,255,.55);line-height:1.5">
      ⚠️ Estimations IA · Les prix hôtels et vols varient selon les dates.<br>Cliquez les liens pour voir les <b style="color:rgba(255,255,255,.75)">vrais prix en temps réel</b>.
    </div>
  </div>`;
}

function tipsCard(tips) {
  if (!tips?.length) return '';
  return `<div style="background:#f5f3ff;border:1.5px solid #ddd6fe;border-radius:14px;padding:14px;margin-top:10px">
    <div style="font-size:12px;font-weight:800;color:#5b21b6;margin-bottom:8px">💡 Conseils pratiques</div>
    ${tips.map(t=>`<div style="font-size:12px;color:#374151;margin-bottom:5px;padding-left:8px;border-left:2px solid #c4b5fd">• ${t}</div>`).join('')}
  </div>`;
}

// ══════════════════════════════════════════════════════════════════════════════
// HANDLER PRINCIPAL
// ══════════════════════════════════════════════════════════════════════════════
export default async function handler(req) {
  if (req.method==='OPTIONS') return new Response(null,{status:204,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type'}});
  if (req.method!=='POST') return new Response('Method not allowed',{status:405});
  const H={'Content-Type':'application/json; charset=utf-8','Access-Control-Allow-Origin':'*'};

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

    const hist  = buildHistory(history);
    const histS = buildHistShort(history);   // version courte pour Groq
    const ctx   = travelContext || {};

    // ══════════════════════════════════════════════════════════════════════════
    // MODE VOYAGE
    // ══════════════════════════════════════════════════════════════════════════
    if (isTravel) {
      const qAsked = countTravelQ(history);
      const extr   = extractTravelInfo(histS, message);
      const merged = {...extr, ...Object.fromEntries(Object.entries(ctx).filter(([k,v])=>v&&k!=='suggestionsShown'))};
      const mStr   = Object.entries(merged).filter(([,v])=>v).map(([k,v])=>`${k}:${v}`).join(', ');

      const allText = (histS+' '+message+' '+mStr).toLowerCase();
      const hasDest  = merged.destination || /capri|paris|rome|lisbonne|barcelone|londres|tokyo|bali|venise|madrid|amsterdam|berlin|prague|naples|athenes|santorin|marrakech|dubai|côte.?d'azur/i.test(allText);
      const hasDep   = merged.ville_depart || /depuis|de barcelone|de paris|de lyon|de marseille|de nice|de bordeaux|depuis nice|depuis paris|départ de/i.test(allText);
      const hasDates = merged.duree || /\d+\s*(jours?|nuits?|semaines?)|du \d+|demain|week.?end/i.test(allText);
      const readyGen = hasDest && hasDep && hasDates;

      // ── QUESTIONS INTERMÉDIAIRES → GROQ DEEPSEARCH (100% GRATUIT) ────────
      if (!readyGen && qAsked < 4) {
        const missing = [
          !hasDest  && 'destination',
          !hasDep   && 'ville de départ',
          !hasDates && 'durée',
          !merged.budget && 'budget (optionnel)',
        ].filter(Boolean);

        const groqQ = `Tu es un agent voyage Huntify expert et chaleureux.
Infos collectées: ${mStr||'aucune'}
Historique: ${histS||'début'}
Message: "${message}"
Questions déjà posées: ${qAsked}
Info manquantes: ${missing.join(', ')||'aucune'}
Aujourd'hui: ${TODAY}

TÂCHE: Pose UNE seule question naturelle pour collecter la prochaine info manquante.
Si message = une destination seule sans contexte → suggère 3 destinations similaires.
Si toutes les infos sont là → dis que tu génères l'itinéraire.

Réponds UNIQUEMENT en JSON, rien d'autre:
Question: {"t":"q","msg":"ta question courte et naturelle"}
Suggestions: {"t":"s","intro":"...","dests":[{"n":"Ville","e":"🏳","why":"pourquoi visiter","price":"dès X€/pers","tags":["tag1","tag2"]}],"q":"question de suivi"}`;

        const gRaw = await callGroqDS(groqQ, 400) || await callFreeAI('JSON uniquement.', groqQ, 400);
        const gP   = parseJSON(gRaw || '');

        if (gP.t === 'q' && gP.msg) {
          return new Response(JSON.stringify({
            reply:`<div style="font-size:13.5px;color:#1e293b;line-height:1.6;padding:4px 0">${gP.msg}</div>`,
            sessionId:sid
          }),{headers:H});
        }
        if (gP.t === 's' && gP.dests?.length) {
          let html=`<div style="font-size:13.5px;color:#1e293b;line-height:1.6;padding:4px 0 8px">${gP.intro||'Voici mes suggestions :'}</div>`;
          for (const d of gP.dests) {
            html+=`<div onclick="send('${(d.n||'').replace(/'/g,"\\'")}') " style="background:#fff;border:1.5px solid #e6ebf7;border-radius:16px;padding:14px;margin-top:8px;cursor:pointer">
              <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
                <span style="font-size:24px">${d.e||'🌍'}</span>
                <div><div style="font-size:14px;font-weight:800;color:#0e1430">${d.n}</div>
                <div style="font-size:11px;color:#7c89a8">${d.price||''}</div></div>
              </div>
              <div style="font-size:12px;color:#374151;margin-bottom:7px">${d.why||''}</div>
              <div style="display:flex;flex-wrap:wrap;gap:4px">${(d.tags||[]).map(t=>`<span style="background:#eff6ff;color:#2f54ff;border-radius:100px;padding:2px 9px;font-size:11px;font-weight:600">${t}</span>`).join('')}</div>
            </div>`;
          }
          if (gP.q) html+=`<div style="font-size:13.5px;color:#1e293b;padding:8px 0 0">${gP.q}</div>`;
          return new Response(JSON.stringify({reply:html,sessionId:sid}),{headers:H});
        }
        // fallback : question générique
        const fallbackQ = !hasDest ? "Quelle destination vous tente ? (ou dites-moi votre envie du moment 🌍)"
          : !hasDep ? "Vous partez de quelle ville ?"
          : !hasDates ? "C'est pour combien de jours ?"
          : "Quel est votre budget approximatif pour ce voyage ?";
        return new Response(JSON.stringify({
          reply:`<div style="font-size:13.5px;color:#1e293b;line-height:1.6;padding:4px 0">${fallbackQ}</div>`,
          sessionId:sid
        }),{headers:H});
      }

      // ── GÉNÉRATION ITINÉRAIRE → CLAUDE UNIQUEMENT (1 seul appel) ─────────
      // System prompt compressé (~380 tokens vs ~600 avant) + cache_control
      const tSys = `Expert voyage Huntify. Génère des itinéraires complets en JSON.
Aujourd'hui: ${TODAY}. Infos: ${mStr||'aucune'}.

FORMAT ITINÉRAIRE (JSON strict, toutes clés obligatoires):
{"t":"i","recap":"résumé 1 ligne","itin":{
"dest":"Rome","country":"Italie","flag":"🇮🇹","dur":"3 jours / 2 nuits",
"trav":"2 adultes","style":"romantique","dep":"Nice",
"checkin":"YYYY-MM-DD","checkout":"YYYY-MM-DD","adults":2,
"flights":{"out":{"from":"NCE","to":"FCO","price":"85","co":"easyJet","dur":"1h30"},"ret":{"from":"FCO","to":"NCE","price":"95","co":"easyJet","dur":"1h30"}},
"hotels":[{"name":"Hotel Artemide","stars":4,"price":"150","loc":"Centre","hl":"Rooftop vue","cat":"confort"},{"name":"The Beehive","stars":3,"price":"75","loc":"Monti","hl":"Bobo","cat":"budget"},{"name":"Rome Cavalieri","stars":5,"price":"310","loc":"Parioli","hl":"Spa","cat":"luxe"}],
"days":[{"n":1,"title":"Arrivée & Dolce Vita","am":"...","pm":"...","eve":"...","resto":{"name":"Armando al Pantheon","price":"45€/pers","spec":"Cucina romana"},"acts":["Fontaine de Trevi","Piazza Navona"],"budget":120}],
"budget":{"vols":360,"hotel":300,"acts":100,"resto":200,"transport":60,"total":1020,"pp":510},
"tips":["conseil 1","conseil 2"]}}

RÈGLES:
- checkin/checkout: vraies dates ISO depuis "${TODAY}" + durée demandée
- from/to vols: codes IATA 3 lettres MAJUSCULES (NCE CDG FCO BCN etc.)
- hotels.name: vrais hôtels existants dans la ville
- 3 hôtels obligatoires (budget/confort/luxe)
- Budget dispatché logiquement selon destination + style
- JSON UNIQUEMENT`;

      const tUser = `INFOS: ${mStr}\nHIST: ${hist}\nMSG: "${message}"\n[GÉNÈRE MAINTENANT l'itinéraire complet, format t:i]`;
      const tRaw  = await callClaude(tSys, tUser, 2800, []);  // cache_control actif
      const tP    = parseJSON(tRaw || '');
      const itin  = tP.itin;

      if (!itin) {
        return new Response(JSON.stringify({
          reply:`<div style="font-size:13.5px;color:#1e293b;line-height:1.6;padding:4px 0">${tP.msg||"Désolé, je n'ai pas pu générer l'itinéraire. Pouvez-vous préciser destination, durée et ville de départ ?"}</div>`,
          sessionId:sid
        }),{headers:H});
      }

      // ── Construction HTML itinéraire ───────────────────────────────────────
      let html='';
      const itinId = `itin_${Date.now()}`;
      const adults = itin.adults || merged.nb_adultes || 2;
      const nights = parseInt((itin.dur||'').match(/\d+/)?.[0]||'3') || 3;
      const ci = /^\d{4}-\d{2}-\d{2}$/.test(itin.checkin||'') ? itin.checkin : parseDate(merged.date_depart_raw||itin.checkin||null);
      const coRaw = /^\d{4}-\d{2}-\d{2}$/.test(itin.checkout||'') ? itin.checkout : parseDate(merged.date_retour_raw||itin.checkout||null);
      const co = coRaw || (() => { if(ci){const d=new Date(ci);d.setDate(d.getDate()+nights);return d.toISOString().slice(0,10);}return null; })();

      html+=`<div id="${itinId}" style="background:linear-gradient(135deg,#1f2da0,#2f54ff);border-radius:16px;padding:18px;margin-bottom:4px;text-align:center">
        <div style="font-size:32px;margin-bottom:6px">${itin.flag||'✈️'}</div>
        <div style="font-family:'Sora',sans-serif;font-size:20px;font-weight:800;color:#fff">${itin.dest||''}${itin.country?', '+itin.country:''}</div>
        <div style="font-size:12px;color:rgba(255,255,255,.75);margin-top:6px;display:flex;justify-content:center;gap:12px;flex-wrap:wrap">
          <span>📅 ${itin.dur||''}</span><span>👥 ${itin.trav||adults+' pers.'}</span>
          ${itin.dep?`<span>🛫 Depuis ${itin.dep}</span>`:''}
          ${itin.budget?.total?`<span>💰 ~${itin.budget.total}€</span>`:''}
        </div>
      </div>`;

      if (tP.recap) html+=recapBox(tP.recap);

      // Vols
      if (itin.flights?.out) {
        const f=itin.flights;
        const skyUrl=buildSkyscannerLink(f.out.from||itin.dep||'',f.out.to||itin.dest||'',ci,co,adults);
        html+=`<div style="font-size:12px;font-weight:800;color:#0e1430;margin:14px 0 6px">✈️ Vols recommandés</div>
        <div style="background:#fff;border:1.5px solid #e6ebf7;border-radius:14px;overflow:hidden">
          <div style="padding:12px 14px;border-bottom:1px solid #f0f4ff">
            <div style="display:flex;justify-content:space-between;align-items:center">
              <div><div style="font-size:10px;font-weight:800;color:#7c89a8;text-transform:uppercase">Aller${ci?' · '+ci:''}</div>
              <div style="font-size:13px;font-weight:700;color:#0e1430;margin-top:2px">${f.out.from||''} → ${f.out.to||''}</div>
              <div style="font-size:11px;color:#7c89a8">${f.out.co||''} · ${f.out.dur||''}</div></div>
              <div style="text-align:right"><div style="font-size:16px;font-weight:900;color:#2f54ff">~${f.out.price||'?'}€</div>
              <div style="font-size:10px;color:#7c89a8">/pers.</div></div>
            </div>
          </div>
          ${f.ret?`<div style="padding:12px 14px">
            <div style="display:flex;justify-content:space-between;align-items:center">
              <div><div style="font-size:10px;font-weight:800;color:#7c89a8;text-transform:uppercase">Retour${co?' · '+co:''}</div>
              <div style="font-size:13px;font-weight:700;color:#0e1430;margin-top:2px">${f.ret.from||''} → ${f.ret.to||''}</div>
              <div style="font-size:11px;color:#7c89a8">${f.ret.co||''} · ${f.ret.dur||''}</div></div>
              <div style="text-align:right"><div style="font-size:16px;font-weight:900;color:#2f54ff">~${f.ret.price||'?'}€</div>
              <div style="font-size:10px;color:#7c89a8">/pers.</div></div>
            </div>
          </div>`:''}
        </div>
        <a href="${skyUrl}" target="_blank" rel="noopener" style="display:flex;align-items:center;justify-content:center;gap:8px;background:linear-gradient(135deg,#0e1430,#1f2da0);color:#fff;text-decoration:none;border-radius:12px;padding:12px;font-size:13px;font-weight:700;margin-top:6px">
          🔍 Comparer ces vols sur Skyscanner →
        </a>`;
      }

      // Hôtels — vrais prix via Travelpayouts Hotellook
      if (itin.hotels?.length) {
        // Hotellook : vrais hotels avec vrais prix pour ces dates
        // ── HOTELLOOK : vrais prix si API dispo, liens directs sinon ────────
        // Tente l'API (marche si compte TP activé + dates fournies)
        const realHotels = (ci && co) ? await fetchRealHotels(itin.dest||'', ci, co, adults) : null;
        const hasReal = Array.isArray(realHotels) && realHotels.length > 0;

        html += '<div style="font-size:12px;font-weight:800;color:#0e1430;margin:16px 0 6px">🏨 '
          + 'Hébergements · <span style="color:' + (hasReal ? '#16a34a' : '#2f54ff') + ';font-size:11px">'
          + (hasReal ? 'Prix réels ✓' : 'Hotellook · cliquez pour les prix')
          + '</span></div>';

        // Hotels à afficher : vrais si API OK, sinon noms Claude avec liens Hotellook
        const hotelsToShow = hasReal ? realHotels : (itin.hotels || []).map((h, i) => ({
          name:  h.name,
          stars: h.stars || 3,
          price: null,
          loc:   h.loc || itin.dest,
          hl:    h.hl,
          cat:   ['budget','confort','luxe'][i] || h.cat || 'confort',
          // Lien Hotellook avec destination + dates + fourchette de prix par catégorie
          url: 'https://www.hotellook.com/search?location=' + encodeURIComponent(itin.dest||'')
               + '&marker=' + TP_MARKER
               + '&adults=' + adults
               + (ci ? '&checkIn=' + ci : '')
               + (co ? '&checkOut=' + co : '')
               + '&currency=EUR'
               + (i===0 ? '&priceMax=100' : i===1 ? '&priceMin=80&priceMax=200' : '&priceMin=180')
        }));

        const prices = hotelsToShow.filter(h=>h.price).map(h=>h.price);

        for (const h of hotelsToShow) {
          html += hotelCard({
            name:      h.name,
            stars:     h.stars,
            price:     h.price ? String(h.price) : null,
            priceReal: hasReal && !!h.price,
            location:  h.loc || itin.dest,
            highlight: h.hl,
            booking_link: h.url,
            category:  h.cat
          }, h.url);
        }

        // Bouton "Voir plus" → toujours Hotellook avec dates
        const exploreUrl = 'https://www.hotellook.com/search?location=' + encodeURIComponent(itin.dest||'')
          + '&marker=' + TP_MARKER
          + '&adults=' + adults
          + (ci ? '&checkIn=' + ci : '')
          + (co ? '&checkOut=' + co : '')
          + '&currency=EUR';

        html += '<a href="' + exploreUrl + '" target="_blank" rel="sponsored noopener" '
          + 'style="display:flex;align-items:center;justify-content:center;gap:8px;'
          + 'background:linear-gradient(135deg,#0e1430,#2f54ff);color:#fff;text-decoration:none;'
          + 'border-radius:12px;padding:12px;margin-top:8px;font-size:12px;font-weight:700">'
          + '🏨 Voir tous les hôtels disponibles sur Hotellook'
          + (ci ? ' · ' + ci + ' → ' + co : '')
          + ' →</a>';
      // Programme
      if (itin.days?.length) {
        html+=`<div style="font-size:12px;font-weight:800;color:#0e1430;margin:16px 0 6px">📅 Programme jour par jour</div>`;
        for (const d of itin.days) html+=dayCard({num:d.n,title:d.title,morning:d.am,afternoon:d.pm,evening:d.eve,restaurant:d.resto,activities:d.acts,budget:d.budget});
      }

      // Budget
      if (itin.budget) html+=budgetCard(itin.budget);

      // Conseils
      if (itin.tips?.length) html+=tipsCard(itin.tips);

      // Wishlist + Export
      const h1=(itin.hotels||[])[0];
      const bookWish=h1?buildBookingLink([h1.name,itin.dest].join(' '),nights,adults,null,null,ci,co):buildBookingLink(itin.dest||'',nights,adults,null,null,ci,co);
      const skyWish=itin.flights?.out?buildSkyscannerLink(itin.flights.out.from||'',itin.flights.out.to||'',ci,co,adults):null;
      const wD=JSON.stringify({type:'voyage',name:`${itin.flag||'✈️'} ${itin.dest||''}${itin.country?', '+itin.country:''}`,subtitle:`${itin.dur||''} · ${itin.trav||adults+' pers.'} · ${itin.style||''}`,price:itin.budget?.total?String(itin.budget.total)+'€':'',perPerson:itin.budget?.pp?String(itin.budget.pp)+'€/pers.':'',store:'booking',url:bookWish,flightUrl:skyWish,dep:itin.dep||'',hotels:(itin.hotels||[]).slice(0,3).map(h=>({name:h.name||'',price:(h.price||'?')+'€/nuit',cat:h.cat||'confort',url:buildBookingLink([h.name,itin.dest].join(' '),nights,adults,null,null,ci,co)})),budget:itin.budget||null}).replace(/"/g,'&quot;');

      html+=`<div style="display:flex;gap:8px;margin-top:12px">
        <button onclick="addToWishlist(${wD})" style="flex:1;background:linear-gradient(135deg,#1f2da0,#2f54ff);border:none;color:#fff;border-radius:12px;padding:12px 14px;font-weight:700;font-size:13px;cursor:pointer;font-family:inherit">♡ Sauvegarder</button>
        <button onclick="exportItinerary('${itinId}')" style="background:#f5f7ff;border:1.5px solid #c7d2fe;color:#3b5bdb;border-radius:12px;padding:12px 14px;font-weight:700;font-size:13px;cursor:pointer;font-family:inherit">⬇️ Exporter PDF</button>
      </div>`;

      if (trackingEnabled) sbFetch('searches','POST',{query:`[VOYAGE] ${message}`,session_id:sid,user_id:userId||null});
      return new Response(JSON.stringify({reply:html,sessionId:sid}),{headers:H});
    }

    // ══════════════════════════════════════════════════════════════════════════
    // MODE PRODUIT
    // ══════════════════════════════════════════════════════════════════════════
    const qAsked=countQ(history);
    const histCat=detectCategory((history||[]).map(m=>m.content||'').join(' '));
    const curCat=detectCategory(message);
    const topicChanged=histCat!=='general'&&curCat!=='general'&&histCat!==curCat;
    const exchanges=(history||[]).length;

    if (topicChanged && exchanges>=4) {
      const resetMsg=curCat==='cadeau'?"Nouveau sujet ! Pour un cadeau, dis-moi pour qui et quel budget ?":curCat==='beaute'?"Nouveau sujet ! Tu cherches quelque chose de précis ?":"Nouveau sujet ! Dis-moi ce que tu cherches et ton budget ?";
      return new Response(JSON.stringify({reply:`<div style="font-size:13.5px;color:#1e293b;line-height:1.6;padding:4px 0">${resetMsg}</div>`,sessionId:sid,resetContext:true}),{headers:H});
    }

    const hasBudget  = /\d+\s*€|\d+\s*euros?/i.test(message);
    const hasPrecise = message.trim().split(/\s+/).length>=3;
    const mustSearch = qAsked>=MAX_Q||(hasBudget&&hasPrecise&&(history||[]).length>0);
    let decision={ready:mustSearch,question:null,recap:null,message:null};

    // ── Ciblage → GROQ 70b (GRATUIT) ─────────────────────────────────────────
    if (!mustSearch) {
      const p1sys=`Assistant shopping Huntify. JSON UNIQUEMENT.
Historique: ${histS||'Début'} | Questions posées: ${qAsked}/${MAX_Q}
Demande vague → ready:false + une question.
Si besoin compris → ready:true + recap (mots-clés produit réels, marque+modèle).
Si ${qAsked}>=${MAX_Q} → ready:true obligatoire.
Ne JAMAIS redemander ce qui est dans l'historique.
JSON: {"ready":false,"message":"question"} ou {"ready":true,"recap":"mots-clés","message":"phrase courte"}`;

      const t1=await callGroq(p1sys,`HIST:\n${histS}\nMSG: ${message}`,'llama-3.3-70b-versatile',300)
            || await callGemini(p1sys,`MSG: ${message}`,300);
      if (t1) {
        const d=parseJSON(t1);
        decision.ready=d.ready===true; decision.question=d.question||d.message||null;
        decision.recap=d.recap||null; decision.message=d.message||d.question||null;
      }
      if (!decision.ready&&!decision.message&&(history||[]).length===0) {
        const q=curCat==='beaute'?"Tu cherches quelque chose de précis ou je te trouve les mieux notés ? Et un budget ?":curCat==='electronique'?"Pour quel usage ? Et tu as un budget en tête ?":curCat==='mode'?"Quel style et quelle taille ? Et un budget ?":curCat==='cadeau'?"C'est pour qui et quel budget ?":'Tu peux m\'en dire un peu plus ? Un budget ou des préférences ?';
        return new Response(JSON.stringify({reply:`<div style="font-size:13.5px;color:#1e293b;line-height:1.6;padding:4px 0">${q}</div>`,sessionId:sid}),{headers:H});
      }
    }

    if (!decision.ready&&(decision.message||decision.question)) {
      return new Response(JSON.stringify({reply:`<div style="font-size:13.5px;color:#1e293b;line-height:1.6;padding:4px 0">${decision.message||decision.question}</div>`,sessionId:sid}),{headers:H});
    }

    const recap  = decision.recap || `Je cherche : ${message}`;
    const budget = detectBudget(recap)||detectBudget(histS)||detectBudget(message);
    const roi    = estimateROI(budget, message, histS);
    const hasPrev= (history||[]).some(m=>m.role!=='user'&&/\d+€/.test(m.content||''));
    const deepConv= exchanges>=6 && !topicChanged;

    // Stratégie :
    //   paid_deep   → Claude + web_search (ROI ≥ 6 ou 1er résultat important)
    //   groq_search → Groq compound-beta DeepSearch (ROI 3-5, GRATUIT)
    //   free_fast   → Groq 70b sans search (ROI < 3)
    const strategy = ((!hasPrev&&roi.score>=3)||roi.score>=6||deepConv) ? 'paid_deep'
                   : roi.depth==='medium' ? 'groq_search'
                   : 'free_fast';
    const effective = (!hasFreeAI()&&strategy!=='paid_deep') ? 'paid_deep' : strategy;

    const dbData    = await queryInternalDB(recap);
    const dbContext = buildDBContext(dbData);
    let products=[], promoCodes=[], summary='';

    // ── Groq DeepSearch (GRATUIT, web search) ─────────────────────────────────
    if (effective==='groq_search') {
      const gPrompt=`Agent shopping. Cherche sur Amazon.fr et fr.shopping.rakuten.com les meilleurs produits.
BESOIN: ${recap}
${dbContext}
Trouve 2 produits Amazon + 1 Rakuten avec vrais noms (marque+modèle).
Si tu trouves un ASIN Amazon réel → url = "https://www.amazon.fr/dp/ASIN"
JSON UNIQUEMENT:
{"summary":"...","products":[{"name":"VRAI NOM PRODUIT","price":"XX€","store":"amazon","keywords":"VRAI NOM","url":"https://www.amazon.fr/dp/ASIN_ou_null","img":null,"badge":"Bestseller"},{"name":"VRAI NOM 2","price":"XX€","store":"rakuten","keywords":"VRAI NOM 2","url":null,"img":null,"badge":"Rapport qualité-prix"}],"promoCodes":[]}`;
      const raw=await callGroqDS(gPrompt,1000);
      const p=parseJSON(raw||''); products=p.products||[]; promoCodes=p.promoCodes||[]; summary=p.summary||'';
    }
    // ── Claude + web_search (premium, cache_control) ──────────────────────────
    else if (effective==='paid_deep') {
      const p2sys=`Agent shopping Huntify. Boutiques: ${activeNames}.
BESOIN: ${recap}
${dbContext}
1. AMAZON.FR → 2 produits avec ASIN réels dans URL /dp/ASIN
2. RAKUTEN FR → 1 produit réel
3. CODES PROMO → dealabs.com si disponible
name = NOM COMPLET RÉEL (marque + modèle). store = "amazon" ou "rakuten".
JSON: {"summary":"...","products":[{"name":"...","price":"XX€","store":"amazon","keywords":"...","url":"https://www.amazon.fr/dp/ASIN","img":null,"badge":"..."}],"promoCodes":[{"code":"...","store":"...","discount":"...","best":true}]}`;
      const raw=await callClaude(p2sys,`BESOIN: ${recap}\nMSG: ${message}`,800,[{type:"web_search_20250305",name:"web_search",max_uses:3}]);
      const p=parseJSON(raw); products=p.products||[]; promoCodes=p.promoCodes||[]; summary=p.summary||'';
    }
    // ── Groq 70b rapide ────────────────────────────────────────────────────────
    else {
      const p2sys=`Agent shopping. Boutiques: ${activeNames}. BESOIN: ${recap} ${dbContext}
2 produits Amazon + 1 Rakuten. name=NOM RÉEL (marque+modèle).
JSON:{"summary":"...","products":[{"name":"...","price":"XX€","store":"amazon","keywords":"...","url":null,"img":null,"badge":"..."}],"promoCodes":[]}`;
      const raw=await callFreeAI(p2sys,`BESOIN: ${recap}`,350);
      const p=parseJSON(raw||''); products=p.products||[]; promoCodes=p.promoCodes||[]; summary=p.summary||'';
    }

    if (!products.length) {
      products=advertisers.slice(0,2).map(a=>({name:message,price:'Voir prix',store:a.slug,keywords:message,url:null,img:null,badge:null}));
      summary=`Résultats pour "${message}" :`;
    }

    // Historique prix
    let priceHistHtml='';
    const main=products.find(p=>p.store==='amazon');
    if (main?.price&&!main.price.includes('Voir')) {
      const cur=parseFloat(main.price.replace(/[^0-9.,]/g,'').replace(',','.'));
      const slug=main.name.toLowerCase().replace(/\s+/g,'-').slice(0,50);
      const ph=await sbFetch(`price_history?product_id=eq.${slug}&order=checked_at.desc&limit=10`)||[];
      if (ph.length>1&&!isNaN(cur)) {
        const old=ph[ph.length-1].price, trend=cur<old*0.97?'down':cur>old*1.03?'up':'stable';
        priceHistHtml=priceHistBox(old,trend);
      }
      if (!isNaN(cur)) sbFetch('price_history','POST',{product_id:slug,product_name:main.name,price:cur,store:'amazon',url:main.url||null});
    }

    // Boutons produits
    let buttons='';
    for (const pr of products) {
      if (!pr.name) continue;
      const adv=findAdv(advertisers,pr.store); if(!adv) continue;
      const rawUrl=(pr.url&&pr.url!=='null'&&pr.url.length>15)?pr.url:null;
      const terms=(pr.name&&pr.name.length>5)?pr.name:(pr.keywords||pr.name);
      const url=buildLink(adv,terms,rawUrl); if(!url) continue;
      buttons+=productCard(pr.name,pr.price||'Voir prix',url,adv,pr.img||null,pr.badge||null);
    }

    // Promos
    let promos='';
    for (const c of (promoCodes||[]).filter(c=>c.code).sort((a,b)=>(b.best?1:0)-(a.best?1:0)).slice(0,2)) {
      promos+=promoBox(c.code,c.store||'boutique',c.discount||'Réduction',c.best||false);
      sbFetch('promo_codes','POST',{code:c.code,store:c.store||'unknown',discount:c.discount||'',product_query:message,found_at:new Date().toISOString(),valid:true});
    }
    let dbPromos='';
    for (const adv of advertisers) {
      const cpns=await getAutoCoupons(adv.slug);
      for (const c of cpns) { if(!(promoCodes||[]).find(p=>p.code===c.code)) dbPromos+=promoBox(c.code,c.store||adv.name,c.discount||'Réduction',false); }
    }

    const first=products[0], adv0=first?findAdv(advertisers,first.store):null;
    const wish=first&&adv0?`<button onclick="addToWishlist(${JSON.stringify({type:'product',name:first.name,price:first.price,store:first.store,url:buildLink(adv0,first.keywords||first.name,first.url||null)}).replace(/"/g,'&quot;')})" style="background:#fff;border:1.5px solid #e8edf8;color:#3b5bdb;border-radius:12px;padding:8px 16px;margin-top:10px;font-weight:700;font-size:12px;cursor:pointer;font-family:inherit;width:100%">♡ Ajouter à ma wishlist</button>`:'';

    const sugs=getCrossSuggestions(recap);
    const cross=sugs.length?`<div style="margin-top:12px;padding-top:10px;border-top:1px solid #f0f4ff"><div style="font-size:11px;font-weight:700;color:#7c89a8;margin-bottom:6px">Tu pourrais aussi aimer :</div><div style="display:flex;gap:6px;flex-wrap:wrap">${sugs.map(s=>`<button onclick="send('${s.replace(/'/g,"\\'")}')" style="background:#f5f7ff;border:1.5px solid #e8edf8;color:#3b5bdb;border-radius:100px;padding:6px 14px;font-size:11px;font-weight:600;cursor:pointer;font-family:inherit">${s}</button>`).join('')}</div></div>`:'';

    const reply=`<div style="font-size:13.5px;color:#1e293b;margin-bottom:8px;font-weight:500;line-height:1.5">${decision.message||summary}</div>`+priceHistHtml+buttons+(promos?`<div style="margin-top:4px">${promos}</div>`:'')+( dbPromos?`<div style="margin-top:4px">${dbPromos}</div>`:'')+wish+cross;
    return new Response(JSON.stringify({reply,sessionId:sid}),{headers:H});

  } catch(err) {
    console.error('Huntify error:',err.message);
    return new Response(JSON.stringify({reply:"Désolé, problème technique momentané. Réessayez !"}),{status:200,headers:{'Content-Type':'application/json; charset=utf-8','Access-Control-Allow-Origin':'*'}});
  }
}
