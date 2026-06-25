export const config = { runtime: 'edge' };

const SUPABASE_URL  = "https://enocxbrqyybendertytl.supabase.co";
const SUPABASE_KEY  = "sb_publishable_NmPh--frZG5HuqfaoxnemA_E7cidV9Y";
const MODEL         = 'claude-haiku-4-5';
const MAX_Q         = 3;

// ── CONSTANTES AFFILIATION ────────────────────────────────────────────────────
const AMAZON_TAG  = 'huntify21-21';   // fallback si absent en DB
const AWIN_PUB    = '2920215';        // Publisher ID Awin (toujours valide)
const RAKUTEN_MID = '55615';          // Awin MID Rakuten FR

// ── MAPPING IATA VILLES → CODES ───────────────────────────────────────────────
const IATA_MAP = {
  // France
  paris:'CDG', 'paris cdg':'CDG', 'paris orly':'ORY', lyon:'LYS', marseille:'MRS',
  nice:'NCE', bordeaux:'BOD', toulouse:'TLS', nantes:'NTE', strasbourg:'SXB',
  montpellier:'MPL', biarritz:'BIQ', grenoble:'GNB', brest:'BES', rennes:'RNS',
  // Italie
  rome:'FCO', 'rome fco':'FCO', milan:'MXP', 'milan malpensa':'MXP', venise:'VCE',
  naples:'NAP', florence:'FLR', catane:'CTA', palerme:'PMO', bari:'BRI',
  bologne:'BLQ', turin:'TRN', pise:'PSA',
  // Espagne
  barcelone:'BCN', madrid:'MAD', ibiza:'IBZ', majorque:'PMI', seville:'SVQ',
  malaga:'AGP', valence:'VLC', bilbao:'BIO', alicante:'ALC', tenerife:'TFS',
  // Portugal
  lisbonne:'LIS', porto:'OPO', faro:'FAO',
  // Royaume-Uni
  londres:'LHR', 'london heathrow':'LHR', 'london gatwick':'LGW', manchester:'MAN', edimbourg:'EDI',
  // Pays-Bas / Belgique / Suisse / Autriche
  amsterdam:'AMS', bruxelles:'BRU', zurich:'ZRH', geneve:'GVA', vienne:'VIE',
  // Allemagne
  berlin:'BER', munich:'MUC', francfort:'FRA', hambourg:'HAM', dusseldorf:'DUS',
  // Europe Est
  prague:'PRG', budapest:'BUD', varsovie:'WAW', bucarest:'OTP', zagreb:'ZAG',
  sofia:'SOF', athenes:'ATH', thessalonique:'SKG',
  // Grèce / Îles
  santorin:'JTR', mykonos:'JMK', crete:'HER', heraklion:'HER', rhodes:'RHO', corfou:'CFU',
  // Maroc / Tunisie / Égypte
  marrakech:'RAK', casablanca:'CMN', agadir:'AGA', fes:'FEZ',
  tunis:'TUN', djerba:'DJE',
  hurghada:'HRG', 'charm el cheikh':'SSH', caire:'CAI',
  // Turquie
  istanbul:'IST', antalya:'AYT', bodrum:'BJV',
  // Moyen-Orient
  dubai:'DXB', abu:'AUH', 'abu dhabi':'AUH', doha:'DOH', riyad:'RUH',
  // Asie
  tokyo:'NRT', osaka:'KIX', bangkok:'BKK', singapour:'SIN',
  'hong kong':'HKG', hanoi:'HAN', 'ho chi minh':'SGN', bali:'DPS', denpasar:'DPS',
  kuala:'KUL', 'kuala lumpur':'KUL', shanghai:'PVG', pekin:'PEK', seoul:'ICN',
  // Amériques
  'new york':'JFK', 'los angeles':'LAX', miami:'MIA', montreal:'YUL',
  toronto:'YYZ', cancun:'CUN', 'mexico':'MEX',
  // Afrique
  dakar:'DSS', abidjan:'ABJ', nairobi:'NBO', reunion:'RUN', 'la reunion':'RUN',
  maldives:'MLE', maurice:'MRU',
};

function cityToIATA(str) {
  if (!str) return null;
  const s = str.toLowerCase().trim();
  // Code IATA direct (3 lettres majuscules)
  const m3 = (str||'').match(/\b([A-Z]{3})\b/);
  if (m3) return m3[1].toUpperCase();
  // Lookup dans le map (correspondance partielle)
  for (const [key, code] of Object.entries(IATA_MAP)) {
    if (s.includes(key)) return code;
  }
  // Essai sur les 3 premières lettres en majuscules
  const initials = s.replace(/[^a-z]/g,'').slice(0,3).toUpperCase();
  return initials.length === 3 ? initials : null;
}

// ── SUPABASE ──────────────────────────────────────────────────────────────────
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

// ── NETTOYAGE MOTS-CLÉS ───────────────────────────────────────────────────────
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

// ── CONSTRUCTION LIENS AFFILIATION ───────────────────────────────────────────
function buildLink(adv, keywords, directUrl=null) {
  if (!adv?.active) return null;
  const kw = cleanKw(keywords);

  // ── AMAZON ────────────────────────────────────────────────────────────────
  if (adv.slug === 'amazon') {
    const tag = adv.amazon_tag || AMAZON_TAG;
    // URL directe /dp/ASIN si valide
    const isValidAsin = directUrl
      && directUrl !== 'null'
      && directUrl.length > 15
      && (directUrl.includes('/dp/') || directUrl.includes('amazon'))
      && !directUrl.includes('/dp/null')
      && !directUrl.includes('/dp/undefined');
    const base = isValidAsin
      ? directUrl.split('?')[0]                          // retire params existants
      : `https://www.amazon.fr/s?k=${encodeURIComponent(kw)}`;
    return `${base}?tag=${tag}`;
  }

  // ── AWIN (Rakuten + autres) ───────────────────────────────────────────────
  if (adv.awin_mid) {
    const mid    = adv.awin_mid;
    const affid  = adv.awin_affid || adv.awin_aff || AWIN_PUB;
    let dest;

    if (adv.slug === 'rakuten') {
      const rkw = encodeURIComponent(kw.replace(/\s+/g,'+'));
      dest = `https://fr.shopping.rakuten.com/s/${rkw}`;
    } else if (adv.search_url) {
      dest = adv.search_url.replace('{keywords}', encodeURIComponent(kw));
    } else {
      dest = `https://www.${adv.slug}.fr/catalogsearch/result/?q=${encodeURIComponent(kw)}`;
    }

    return `https://www.awin1.com/cread.php?awinmid=${mid}&awinaffid=${affid}&ued=${encodeURIComponent(dest)}`;
  }

  return null;
}

function findAdv(advertisers, slug) {
  return advertisers.find(a=>a.slug===slug?.toLowerCase()) || null;
}

// ── BOOKING LINK ──────────────────────────────────────────────────────────────
// Produit un lien Booking avec dates exactes + filtre prix optionnel
function buildBookingLink(destination, nights=5, adults=2, minPrice=null, maxPrice=null, checkin=null, checkout=null) {
  const dest = encodeURIComponent((destination||'').trim());
  const rooms = Math.ceil(adults / 2);   // 1 chambre par défaut, 2 si >2 adultes

  let url = `https://www.booking.com/searchresults.html`
          + `?ss=${dest}`
          + `&group_adults=${adults}`
          + `&no_rooms=${rooms}`
          + `&lang=fr`;

  if (checkin && checkout) {
    // Dates précises → vraies disponibilités
    url += `&checkin=${checkin}&checkout=${checkout}`;
  } else if (nights > 0) {
    url += `&nights=${nights}`;
  }

  // Filtre prix (format Booking : min-max en EUR)
  if (minPrice != null && maxPrice != null && minPrice >= 0 && maxPrice > 0) {
    url += `&nflt=price%3DEUR-${Math.round(minPrice)}-${Math.round(maxPrice)}-1`;
  }

  url += `&order=class`;   // Tri par étoiles par défaut

  // Affiliation CJ si dispo
  const cjPub = (typeof process !== 'undefined' && process.env?.CJ_PUBLISHER_ID) || null;
  const cjAdv = (typeof process !== 'undefined' && process.env?.CJ_BOOKING_ADVERTISER_ID) || null;
  if (cjPub && cjAdv) {
    return `https://www.anrdoezrs.net/click-${cjPub}-${cjAdv}?url=${encodeURIComponent(url)}`;
  }
  return url;
}

// ── GETTRANSFER (Travelpayouts) ────────────────────────────────────────────────
function buildGetTransferLink(dest, ci) {
  const base = 'https://gettransfer.tpk.mx/vMnVrFfO';
  return dest ? base + '?to=' + encodeURIComponent(dest) + (ci ? '&date=' + ci : '') : base;
}

// ── EXPEDIA ─────────────────────────────────────────────────────────────────────
function buildExpediaLink(dest, ci, co, adults) {
  let url = 'https://www.expedia.fr/Hotel-Search?destination=' + encodeURIComponent(dest||'') + '&adults=' + (adults||2);
  if (ci) url += '&startDate=' + ci;
  if (co) url += '&endDate=' + co;
  return url;
}

// ── SKYSCANNER LINK ───────────────────────────────────────────────────────────
// Construit un lien Skyscanner avec codes IATA extraits et dates au format YYMMDD
function buildSkyscannerLink(fromStr, toStr, outbound, inbound, adults=2) {
  const from = cityToIATA(fromStr) || 'par';   // fallback Paris
  const to   = cityToIATA(toStr)   || 'xxx';
  const fromLc = from.toLowerCase();
  const toLc   = to.toLowerCase();

  // Format YYMMDD → 2026-06-17 devient 260617
  function skyfmt(d) {
    if (!d) return null;
    const clean = d.replace(/-/g,'');    // "20260617"
    return clean.length >= 8 ? clean.slice(2) : null;  // "260617"
  }

  const out = skyfmt(outbound);
  const ret = skyfmt(inbound);

  if (out && ret) {
    return `https://www.skyscanner.fr/transport/vols/${fromLc}/${toLc}/${out}/${ret}/?adults=${adults}&currency=EUR&locale=fr-FR`;
  }
  if (out) {
    return `https://www.skyscanner.fr/transport/vols/${fromLc}/${toLc}/${out}/?adults=${adults}&currency=EUR&locale=fr-FR`;
  }
  return `https://www.skyscanner.fr/transport/vols/${fromLc}/${toLc}/`;
}

// ── PARSE DATE ────────────────────────────────────────────────────────────────
// Convertit tout format de date vers YYYY-MM-DD
function parseDate(str) {
  if (!str) return null;
  const s = str.trim().toLowerCase();

  // Déjà ISO
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;

  // Relatif
  const now = new Date();
  if (s === 'demain' || s === 'tomorrow') {
    const d = new Date(now.getTime() + 86400000);
    return d.toISOString().slice(0,10);
  }
  if (s === 'après-demain' || s === 'apres-demain') {
    const d = new Date(now.getTime() + 2*86400000);
    return d.toISOString().slice(0,10);
  }
  if (/ce week-?end|ce weekend/.test(s)) {
    const day = now.getDay();
    const daysUntilSat = (6 - day + 7) % 7 || 7;
    const d = new Date(now.getTime() + daysUntilSat*86400000);
    return d.toISOString().slice(0,10);
  }

  // JJ/MM/AAAA ou JJ-MM-AAAA
  const dm = str.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (dm) {
    const y = dm[3].length===2 ? '20'+dm[3] : dm[3];
    return `${y}-${dm[2].padStart(2,'0')}-${dm[1].padStart(2,'0')}`;
  }

  // Mois en lettres
  const MONTHS = {
    'jan':1,'janv':1,'janvier':1,
    'fév':2,'fev':2,'fevr':2,'février':2,
    'mar':3,'mars':3,
    'avr':4,'avril':4,
    'mai':5,
    'juin':6,
    'juil':7,'juillet':7,
    'aoû':8,'aou':8,'aout':8,'août':8,
    'sep':9,'sept':9,'septembre':9,
    'oct':10,'octobre':10,
    'nov':11,'novembre':11,
    'déc':12,'dec':12,'décembre':12,'decembre':12,
  };
  const fm = s.match(/(\d{1,2})\s+([a-zéûôàù]+)(?:\s+(\d{4}))?/);
  if (fm) {
    const mn = fm[2];
    const mm = Object.entries(MONTHS).find(([k]) => mn.startsWith(k));
    if (mm) {
      const y = fm[3] || String(now.getFullYear());
      return `${y}-${String(mm[1]).padStart(2,'0')}-${fm[1].padStart(2,'0')}`;
    }
  }

  // Juste un chiffre → jour du mois prochain ou ce mois
  const dayOnly = str.match(/^(\d{1,2})$/);
  if (dayOnly) {
    const day = parseInt(dayOnly[1]);
    const cur = new Date(now);
    if (day <= cur.getDate()) cur.setMonth(cur.getMonth()+1);
    cur.setDate(day);
    return cur.toISOString().slice(0,10);
  }

  return null;
}

// ── EXTRACTION INFOS VOYAGE ───────────────────────────────────────────────────
function extractTravelInfo(hist, message) {
  const text = ((hist||'')+ ' '+message).toLowerCase();
  const info = {};

  // Destination
  const destM = text.match(/(?:aller|partir|voyager|destination|visiter|à|a|en|au|aux|pour)\s+([a-zA-ZÀ-ÿ\s]{2,25})(?:\.|,|!|\?|\s(?:du|le|en|pour|avec)|$)/i)
             || text.match(/(?:je veux|on veut|j'aimerais|week.?end)\s+(?:aller|partir)?\s*(?:a|à|en|au)?\s*([a-zA-ZÀ-ÿ\s]{2,25})/i);
  if (destM) info.destination = destM[1].trim();

  // Budget
  const budM = text.match(/budget\s*:?\s*(\d+)\s*(?:€|euros?)/i) || text.match(/(\d+)\s*(?:€|euros?)\s*(?:par personne|pp)?/i);
  if (budM) info.budget = budM[1]+'€';

  // Durée
  const durM = text.match(/(\d+)\s*(?:jours?|nuits?|semaines?)/i);
  if (durM) info.duree = durM[0];

  // Voyageurs
  const travM = text.match(/(\d+)\s*(?:personnes?|adultes?|voyageurs?)/i)
             || text.match(/(?:seul|couple|famille|duo|amis)/i);
  if (travM) info.voyageurs = travM[0];

  // Ville départ
  const depPatterns = [
    /depuis\s+([a-zA-ZÀ-ÿ\s]{2,25})(?:\s|,|\.)/i,
    /départ\s+de\s+([a-zA-ZÀ-ÿ\s]{2,25})(?:\s|,|\.)/i,
    /je pars? (?:de|depuis)\s+([a-zA-ZÀ-ÿ\s]{2,25})(?:\s|,|\.)/i,
    /on part (?:de|depuis)\s+([a-zA-ZÀ-ÿ\s]{2,25})(?:\s|,|\.)/i,
    /au départ de\s+([a-zA-ZÀ-ÿ\s]{2,25})(?:\s|,|\.)/i,
  ];
  for (const p of depPatterns) {
    const m = text.match(p);
    if (m) { info.ville_depart = m[1].trim(); break; }
  }

  // Dates : "du 17 au 21 juin", "du 17 juin au 21 juin 2026"
  const rangeFull = text.match(/du\s+(\d{1,2}\s+\w+(?:\s+\d{4})?)\s+au\s+(\d{1,2}\s+\w+(?:\s+\d{4})?)/i);
  const rangeShort = text.match(/du\s+(\d{1,2})\s+au\s+(\d{1,2}\s+\w+(?:\s+\d{4})?)/i);
  if (rangeFull) {
    info.date_depart_raw = rangeFull[1].trim();
    info.date_retour_raw = rangeFull[2].trim();
  } else if (rangeShort) {
    info.date_depart_raw = rangeShort[1].trim();
    info.date_retour_raw = rangeShort[2].trim();
  } else {
    // Dates individuelles
    const singleDate = text.match(/(?:le|partir le|départ le|dès le)?\s*(\d{1,2}\s+(?:jan|fév|mar|avr|mai|juin|juil|aoû|sep|oct|nov|déc)\w*(?:\s+\d{4})?)/i);
    if (singleDate) info.date_depart_raw = singleDate[1].trim();
    // "demain"
    if (/demain/.test(text) && !info.date_depart_raw) info.date_depart_raw = 'demain';
    if (/après-?demain/.test(text) && !info.date_retour_raw) info.date_retour_raw = 'après-demain';
  }

  // Nombre adultes
  const adultsM = text.match(/(\d+)\s+adultes?/i) || text.match(/pour\s+(\d+)\s+(?:personnes?|adultes?)/i);
  if (adultsM) info.nb_adultes = parseInt(adultsM[1]) || 2;
  else if (/couple|deux|2\s+pers/.test(text)) info.nb_adultes = 2;
  else if (/seul\b/.test(text)) info.nb_adultes = 1;
  else if (/famille|3\s+pers|trio/.test(text)) info.nb_adultes = 3;

  // Style
  if (/chill|plage|repos|détente|relax/.test(text)) info.style = 'chill';
  else if (/culture|musée|histoire|monument|patrimoine/.test(text)) info.style = 'culture';
  else if (/aventure|randonnée|sport|nature|outdoor/.test(text)) info.style = 'aventure';
  else if (/famille|enfants?|kids/.test(text)) info.style = 'famille';
  else if (/romantique|amoureux|couple/.test(text)) info.style = 'romantique';
  else if (/gastronomie|resto|manger|cuisine|food/.test(text)) info.style = 'gastronomie';

  return info;
}

// ── FREE AI (cascade Groq→Gemini→Mistral) ────────────────────────────────────
async function callGroq(sys, user, model, maxTok) {
  const key = process.env.GROQ_API_KEY; if (!key) return null;
  try {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':`Bearer ${key}`},
      body: JSON.stringify({ model, max_tokens:maxTok,
        messages:[{role:'system',content:sys},{role:'user',content:user}] })
    });
    if (!r.ok) return null;
    const d = await r.json();
    return d.choices?.[0]?.message?.content || null;
  } catch(e) { return null; }
}

// ── GROQ DEEPSEARCH (compound-beta = recherche web gratuite) ─────────────────
async function callGroqSearch(userPrompt, maxTok=1200) {
  const key = process.env.GROQ_API_KEY; if (!key) return null;
  try {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':`Bearer ${key}`},
      body: JSON.stringify({
        model: 'compound-beta',           // Groq model avec web search intégré
        max_tokens: maxTok,
        messages: [{ role:'user', content: userPrompt }]
      })
    });
    if (!r.ok) {
      // fallback sur llama-3.3-70b si compound-beta non dispo
      return await callGroq('Reponds en JSON court.', userPrompt, 'llama-3.3-70b-versatile', maxTok);
    }
    const d = await r.json();
    return d.choices?.[0]?.message?.content || null;
  } catch(e) { return null; }
}

async function callGemini(sys, user, maxTok) {
  const key = process.env.GEMINI_API_KEY; if (!key) return null;
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({contents:[{parts:[{text:`${sys}\n\n${user}`}]}],generationConfig:{maxOutputTokens:maxTok}})
    });
    if (!r.ok) return null;
    const d = await r.json();
    return d.candidates?.[0]?.content?.parts?.[0]?.text || null;
  } catch(e) { return null; }
}

async function callMistral(sys, user, maxTok) {
  const key = process.env.MISTRAL_API_KEY; if (!key) return null;
  try {
    const r = await fetch('https://api.mistral.ai/v1/chat/completions', {
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':`Bearer ${key}`},
      body: JSON.stringify({model:'mistral-small-latest', max_tokens:maxTok,
        messages:[{role:'system',content:sys},{role:'user',content:user}]})
    });
    if (!r.ok) return null;
    const d = await r.json();
    return d.choices?.[0]?.message?.content || null;
  } catch(e) { return null; }
}

async function callDeepseek(sys, user, maxTok) {
  const key = process.env.DEEPSEEK_API_KEY; if (!key) return null;
  try {
    const r = await fetch('https://api.deepseek.com/v1/chat/completions',{
      method:'POST', headers:{'Content-Type':'application/json','Authorization':`Bearer ${key}`},
      body:JSON.stringify({model:'deepseek-chat',max_tokens:maxTok||500,messages:[{role:'system',content:sys},{role:'user',content:user}]})
    });
    if (!r.ok) return null;
    const d=await r.json(); return d.choices?.[0]?.message?.content||null;
  } catch(e){return null;}
}

async function callFreeAI(sys, user, depth='fast') {
  const tok = depth==='deep' ? 800 : 350;
  return await callGroq(sys, user, 'llama-3.3-70b-versatile', tok)
      || await callGemini(sys, user, tok)
      || await callMistral(sys, user, tok)
      || await callDeepseek(sys, user, tok);
}

function hasFreeAI() {
  return !!(process.env.GROQ_API_KEY || process.env.GEMINI_API_KEY || process.env.MISTRAL_API_KEY);
}

// ── CLAUDE ────────────────────────────────────────────────────────────────────
async function callClaude(sys, user, maxTok=700, tools=[]) {
  const key = process.env.ANTHROPIC_API_KEY; if (!key) return null;
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method:'POST',
      headers:{'Content-Type':'application/json; charset=utf-8',
        'x-api-key':key,'anthropic-version':'2023-06-01',
        'anthropic-beta':'prompt-caching-2024-07-31'},
      body: JSON.stringify({ model:MODEL, max_tokens:maxTok, tools,
        system:[{type:'text',text:sys,cache_control:{type:'ephemeral'}}],
        messages:[{role:'user',content:user}] })
    });
    const d = await r.json();
    if (!r.ok) return null;
    let t = '';
    for (const b of (d.content||[])) { if (b.type==='text') t += b.text; }
    return t || null;
  } catch(e) { return null; }
}

function parseJSON(raw) {
  if (!raw) return {};
  try {
    // JSON dans un bloc markdown
    const mdMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (mdMatch) return JSON.parse(mdMatch[1].trim());
    // JSON brut
    const objMatch = raw.match(/\{[\s\S]*\}/);
    if (objMatch) return JSON.parse(objMatch[0]);
  } catch(e) {}
  return {};
}

// ── UTILITAIRES ───────────────────────────────────────────────────────────────
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
  if (/cadeau|offrir|anniversaire|noel|mariage/i.test(msg)) score+=2;
  if (/premium|luxe|meilleur|haut de gamme|pas de budget/i.test(msg)) score+=3;
  return { score, depth: score>=6?'deep':score>=3?'medium':'light', useWebSearch: score>=6 };
}

function detectCategory(text) {
  if (!text) return 'general';
  const t = text.toLowerCase();
  if (/fond de teint|mascara|parfum|creme|serum|maquillage|beaute|cosmetique/.test(t)) return 'beaute';
  if (/casque|telephone|laptop|tablette|tv|console|electronique|gaming/.test(t)) return 'electronique';
  if (/robe|veste|pantalon|chaussure|sneaker|jean|vetement|mode/.test(t)) return 'mode';
  if (/cadeau|anniversaire|noel|mariage|naissance|offrir/.test(t)) return 'cadeau';
  if (/sport|running|velo|yoga|fitness|musculation/.test(t)) return 'sport';
  if (/voyage|hotel|vol|vacances|destination/.test(t)) return 'voyage';
  return 'general';
}

function analyzeConversation(history, message) {
  const exchanges = (history||[]).length;
  const histText  = (history||[]).map(m=>m.content||'').join(' ');
  const histCat   = detectCategory(histText);
  const curCat    = detectCategory(message);
  const topicChanged = histCat!=='general' && curCat!=='general' && histCat!==curCat;
  const deepConversation = exchanges >= 6;
  return { curCat, histCat, topicChanged, deepConversation, exchanges };
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

// ── COMPOSANTS HTML ───────────────────────────────────────────────────────────
function productCard(name, price, url, adv, img, badge) {
  const imgHtml   = img ? `<img src="${img}" style="width:56px;height:56px;object-fit:cover;border-radius:8px;flex-shrink:0" onerror="this.style.display='none'">` : '';
  const badgeHtml = badge ? `<span style="background:rgba(255,255,255,.22);border-radius:100px;padding:2px 8px;font-size:10px;font-weight:700">${badge}</span>` : '';
  const pill      = `<span style="background:rgba(255,255,255,.18);border:1px solid rgba(255,255,255,.35);border-radius:100px;padding:2px 9px;font-size:10px;font-weight:800">${adv.emoji||'🛍️'} ${adv.name}</span>`;
  return `<a href="${url}" target="_blank" rel="sponsored noopener" style="display:flex;align-items:center;gap:12px;background:${adv.color||'#2f54ff'};color:#fff;text-decoration:none;border-radius:14px;padding:12px 14px;margin-top:8px">
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

function hotelCard(h, bookingUrl) {
  const stars = '⭐'.repeat(Math.min(h.stars||3,5));
  const cc = {budget:'#16a34a',confort:'#2f54ff',luxe:'#7c3aed'}[h.category]||'#2f54ff';
  const cl = {budget:'💚 Budget',confort:'💙 Confort',luxe:'💎 Luxe'}[h.category]||'';
  const url = h.booking_link || bookingUrl;
  return `<a href="${url}" target="_blank" rel="sponsored noopener" style="display:flex;flex-direction:column;background:#fff;border:1.5px solid #e6ebf7;border-radius:14px;padding:13px;margin-top:8px;text-decoration:none;gap:5px">
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
    <div style="font-size:10.5px;color:#94a3b8;font-weight:600;margin-top:2px">🏨 Voir disponibilités sur Booking.com →</div>
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
  const items = [
    ['✈️ Vols A/R',         b.flights_total],
    ['🏨 Hébergement',       b.accommodation_total],
    ['🎯 Activités',         b.activities_total],
    ['🍽️ Restaurants',       b.food_total],
    ['🚇 Transport local',   b.transport_local]
  ].filter(i => i[1] != null && i[1] !== '');
  return `<div style="background:linear-gradient(135deg,#0e1430,#1f2da0);border-radius:16px;padding:16px;margin-top:12px">
    <div style="font-size:13px;font-weight:800;color:#fff;margin-bottom:12px">💰 Budget total estimé</div>
    ${items.map(([l,v])=>`<div style="display:flex;justify-content:space-between;margin-bottom:7px"><span style="font-size:12px;color:rgba(255,255,255,.75)">${l}</span><span style="font-size:12px;font-weight:700;color:#fff">${v}€</span></div>`).join('')}
    <div style="border-top:1px solid rgba(255,255,255,.2);margin-top:10px;padding-top:10px;display:flex;justify-content:space-between">
      <span style="font-size:13px;font-weight:800;color:#fff">TOTAL</span>
      <span style="font-size:16px;font-weight:900;color:#bcd0ff">${b.total||''}€</span>
    </div>
    ${b.per_person?`<div style="font-size:11px;color:rgba(255,255,255,.6);text-align:right;margin-top:3px">soit ${b.per_person}€/personne</div>`:''}
    <div style="font-size:10px;color:rgba(255,255,255,.4);margin-top:8px">Prix indicatifs · Cliquez les liens pour vérifier disponibilités et tarifs réels</div>
  </div>`;
}

function tipsCard(tips) {
  if (!tips?.length) return '';
  return `<div style="background:#f5f3ff;border:1.5px solid #ddd6fe;border-radius:14px;padding:14px;margin-top:10px">
    <div style="font-size:12px;font-weight:800;color:#5b21b6;margin-bottom:8px">💡 Conseils pratiques</div>
    ${tips.map(t=>`<div style="font-size:12px;color:#374151;margin-bottom:5px;padding-left:8px;border-left:2px solid #c4b5fd">• ${t}</div>`).join('')}
  </div>`;
}

// ── HANDLER PRINCIPAL ─────────────────────────────────────────────────────────
export default async function handler(req) {
  if (req.method==='OPTIONS') return new Response(null,{status:204,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type'}});
  if (req.method!=='POST')   return new Response('Method not allowed',{status:405});

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

    const hist = buildHistory(history);
    const ctx  = travelContext || {};

    // ══════════════════════════════════════════════════════════════════════════
    // MODE VOYAGE
    // ══════════════════════════════════════════════════════════════════════════
    if (isTravel) {
      const qAsked = countTravelQ(history);
      const extr   = extractTravelInfo(hist, message);
      const merged = { ...extr, ...Object.fromEntries(Object.entries(ctx).filter(([k,v])=>v&&k!=='suggestionsShown')) };
      const mStr   = Object.entries(merged).filter(([,v])=>v).map(([k,v])=>`${k}:${v}`).join(', ');

      const tSys = 'Expert agent voyage Huntify. Tu geres la conversation ET generes l itineraire.\n'
        + '\nINFOS COLLECTEES : ' + (mStr||'aucune')
        + '\nHISTORIQUE : ' + (hist||'debut')
        + '\nQuestions posees : ' + qAsked
        + '\n\nCOMPORTEMENT :\n'
        + '- Si infos insuffisantes: pose UNE question naturelle et courte\n'
        + '- Si tu as destination + duree + ville de depart: genere l itineraire COMPLET\n'
        + '- Ne redemande JAMAIS ce qui est dans les infos collectees\n'
        + '- Si ' + qAsked + ' >= 4: genere avec ce que tu as\n'
        + '\nPOUR LES QUESTIONS : naturel, chaleureux, concis.\n'
        + '\nPOUR LA GENERATION - REGLES ABSOLUES :\n'
        + '- checkin/checkout TOUJOURS en ISO YYYY-MM-DD. Aujourd hui = ' + new Date().toISOString().slice(0,10) + '\n'
        + '- from/to vols = codes IATA 3 lettres MAJ (BCN CDG FCO LIS NCE MRS etc.)\n'
        + '- hotels.name = NOM REEL existant dans cette ville\n'
        + '- 3 hotels obligatoires (budget/confort/luxe)\n'
        + '- Budget dispatche: vols + hotel + restau + activites + transport\n'
        + '\nJSON UNIQUEMENT - 3 formats:\n'
        + 'Question: t=q, msg=question\n'
        + 'Suggestions: t=s, intro, dests=[n,e,why,price,tags], q\n'
        + 'Itineraire: t=i, recap, itin={dest,country,flag,dur,trav,style,dep,'
        + 'checkin:YYYY-MM-DD,checkout:YYYY-MM-DD,adults,'
        + 'flights:{out:{from:IATA,to:IATA,price,co,dur},ret:{...}},'
        + 'hotels:[{name,stars,price,loc,hl,cat:budget/confort/luxe}],'
        + 'days:[{n,title,am,pm,eve,resto:{name,price,spec},acts:[],budget}],'
        + 'budget:{vols,hotel,acts,resto,transport,total,pp},'
        + 'tips:[conseils]}';
      const allText = (hist+' '+message+' '+mStr).toLowerCase();
      const hasDest  = merged.destination || /capri|paris|rome|lisbonne|barcelone|londres|tokyo|bali|venise|madrid|amsterdam|berlin|prague|naples|athenes|santorin|marrakech|dubai|côte.?d'azur/i.test(allText);
      const hasDep   = merged.ville_depart || /depuis|de barcelone|de paris|de lyon|de marseille|de nice|de bordeaux|de toulouse|depuis nice|depuis paris|départ de/i.test(allText);
      const hasDates = merged.duree || /\d+\s*(jours?|nuits?|semaines?)|du \d+|demain|week.?end/i.test(allText);
      const readyGen = hasDest && hasDep && hasDates;

      const tUser = `COLLECTE: ${mStr||'rien'}\nHISTORIQUE: ${hist||'debut'}\nMESSAGE: ${message}${readyGen ? '\n\n[INFOS COMPLÈTES → GÉNÈRE ITINÉRAIRE MAINTENANT, format t:i, PAS DE QUESTION]' : ''}`;
      const tRaw  = await callClaude(tSys, tUser, 3000, []);
      const tP    = parseJSON(tRaw || '');

      // ── Réponse question
      if (tP.t === 'q' || (!tP.t && tP.msg)) {
        return new Response(JSON.stringify({
          reply: `<div style="font-size:13.5px;color:#1e293b;line-height:1.6;padding:4px 0">${tP.msg||tP.message||''}</div>`,
          sessionId: sid
        }), {headers:H});
      }

      // ── Suggestions destinations
      if (tP.t === 's' && tP.dests?.length) {
        let html = `<div style="font-size:13.5px;color:#1e293b;line-height:1.6;padding:4px 0 8px">${tP.intro||'Voici mes suggestions :'}</div>`;
        for (const d of tP.dests) {
          html += `<div onclick="send('${(d.n||'').replace(/'/g,"\\'")}')" style="background:#fff;border:1.5px solid #e6ebf7;border-radius:16px;padding:14px;margin-top:8px;cursor:pointer">
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

      const itin = tP.itin;
      if (!itin) {
        return new Response(JSON.stringify({
          reply: `<div style="font-size:13.5px;color:#1e293b;line-height:1.6;padding:4px 0">${tP.msg||"Pour générer votre itinéraire, j'ai besoin de : destination, durée, ville de départ 🗺️"}</div>`,
          sessionId: sid
        }), {headers:H});
      }

      // ══ GÉNÉRATION ITINÉRAIRE COMPLET ════════════════════════════════════
      let html = '';
      const itinId = `itin_${Date.now()}`;

      // ── En-tête destination
      html += `<div id="${itinId}" style="background:linear-gradient(135deg,#1f2da0,#2f54ff);border-radius:16px;padding:18px;margin-bottom:4px;text-align:center">
        <div style="font-size:32px;margin-bottom:6px">${itin.flag||'✈️'}</div>
        <div style="font-family:'Sora',sans-serif;font-size:20px;font-weight:800;color:#fff">${itin.dest||''}${itin.country?', '+itin.country:''}</div>
        <div style="font-size:12px;color:rgba(255,255,255,.75);margin-top:6px;display:flex;justify-content:center;gap:12px;flex-wrap:wrap">
          <span>📅 ${itin.dur||''}</span>
          <span>👥 ${itin.trav||'2 pers.'}</span>
          ${itin.dep?`<span>🛫 Depuis ${itin.dep}</span>`:''}
          ${itin.budget?.total?`<span>💰 ~${itin.budget.total}€</span>`:''}
        </div>
      </div>`;

      if (tP.recap) html += recapBox(tP.recap);

      // ── Dates checkin/checkout (utilisées pour tous les liens)
      const adults = itin.adults || merged.nb_adultes || 2;
      const nightsRaw = parseInt((itin.dur||'').match(/\d+/)?.[0] || '3');
      const nights = isNaN(nightsRaw) ? 3 : nightsRaw;

      // Dates : priorité au JSON Claude (déjà en ISO), sinon extraction
      const ci = (itin.checkin && /^\d{4}-\d{2}-\d{2}$/.test(itin.checkin))
               ? itin.checkin
               : parseDate(merged.date_depart_raw || itin.checkin || null);
      const co = (itin.checkout && /^\d{4}-\d{2}-\d{2}$/.test(itin.checkout))
               ? itin.checkout
               : parseDate(merged.date_retour_raw || itin.checkout || null)
                 || (() => {
                   // Calcule checkout depuis checkin + durée
                   if (ci) {
                     const d = new Date(ci);
                     d.setDate(d.getDate() + nights);
                     return d.toISOString().slice(0,10);
                   }
                   return null;
                 })();

      // ── Section vols
      if (itin.flights?.out) {
        const f = itin.flights;
        // Skyscanner avec IATA et dates
        const skyUrl = buildSkyscannerLink(
          f.out.from || itin.dep || '',
          f.out.to   || itin.dest || '',
          ci, co, adults
        );

        html += `<div style="font-size:12px;font-weight:800;color:#0e1430;margin:14px 0 6px">✈️ Vols recommandés</div>
        <div style="background:#fff;border:1.5px solid #e6ebf7;border-radius:14px;overflow:hidden">
          <div style="padding:12px 14px;border-bottom:1px solid #f0f4ff">
            <div style="display:flex;justify-content:space-between;align-items:center">
              <div>
                <div style="font-size:10px;font-weight:800;color:#7c89a8;text-transform:uppercase">Aller · ${ci||''}</div>
                <div style="font-size:13px;font-weight:700;color:#0e1430;margin-top:2px">${f.out.from||''} → ${f.out.to||''}</div>
                <div style="font-size:11px;color:#7c89a8">${f.out.co||''} · ${f.out.dur||''}</div>
              </div>
              <div style="text-align:right">
                <div style="font-size:16px;font-weight:900;color:#2f54ff">~${f.out.price||'?'}€</div>
                <div style="font-size:10px;color:#7c89a8">/pers.</div>
              </div>
            </div>
          </div>
          ${f.ret ? `<div style="padding:12px 14px">
            <div style="display:flex;justify-content:space-between;align-items:center">
              <div>
                <div style="font-size:10px;font-weight:800;color:#7c89a8;text-transform:uppercase">Retour · ${co||''}</div>
                <div style="font-size:13px;font-weight:700;color:#0e1430;margin-top:2px">${f.ret.from||''} → ${f.ret.to||''}</div>
                <div style="font-size:11px;color:#7c89a8">${f.ret.co||''} · ${f.ret.dur||''}</div>
              </div>
              <div style="text-align:right">
                <div style="font-size:16px;font-weight:900;color:#2f54ff">~${f.ret.price||'?'}€</div>
                <div style="font-size:10px;color:#7c89a8">/pers.</div>
              </div>
            </div>
          </div>` : ''}
        </div>
        <a href="${skyUrl}" target="_blank" rel="noopener" style="display:flex;align-items:center;justify-content:center;gap:8px;background:linear-gradient(135deg,#0e1430,#1f2da0);color:#fff;text-decoration:none;border-radius:12px;padding:12px;font-size:13px;font-weight:700;margin-top:6px">
          🔍 Comparer ces vols sur Skyscanner →
        </a>`;
      }

      // ── Section hôtels
      if (itin.hotels?.length) {
        html += `<div style="font-size:12px;font-weight:800;color:#0e1430;margin:16px 0 6px">🏨 Hébergements sur Booking.com</div>`;

        const hotelPrices = [];
        for (const h of itin.hotels) {
          const p = parseInt(h.price);
          if (p > 0) hotelPrices.push(p);

          // Lien direct : nom hôtel + destination → vraies dispos Booking avec dates
          const hotelQuery = [h.name, itin.dest].filter(Boolean).join(' ');
          const hotelLink = buildBookingLink(hotelQuery, nights, adults, null, null, ci, co);

          html += hotelCard(
            { name:h.name, stars:h.stars, price:h.price,
              location:h.loc, highlight:h.hl, booking_link:null, category:h.cat },
            hotelLink
          );
        }

        // "Voir plus" : recherche large sur la destination avec filtre prix + mêmes dates
        const minP = hotelPrices.length ? Math.max(0, Math.min(...hotelPrices) - 30) : null;
        const maxP = hotelPrices.length ? Math.max(...hotelPrices) + 60 : null;
        const exploreUrl = buildBookingLink(itin.dest||'', nights, adults, minP, maxP, ci, co);

        html += `<a href="${exploreUrl}" target="_blank" rel="sponsored noopener" style="display:flex;align-items:center;justify-content:center;gap:8px;background:#f5f7ff;border:1.5px solid #c7d2fe;color:#3b5bdb;text-decoration:none;border-radius:12px;padding:11px;margin-top:8px;font-size:12px;font-weight:700">
          🔍 Voir d'autres hôtels disponibles${ci?' ('+ci+' → '+co+')':''} →
        </a>`;
      }

      // ── Programme jour par jour
      if (itin.days?.length) {
        html += `<div style="font-size:12px;font-weight:800;color:#0e1430;margin:16px 0 6px">📅 Programme jour par jour</div>`;
        for (const d of itin.days) {
          html += dayCard({ num:d.n, title:d.title, morning:d.am, afternoon:d.pm, evening:d.eve,
            restaurant:d.resto, activities:d.acts, budget:d.budget });
        }
      }

      // ── Budget
      if (itin.budget) {
        const b = itin.budget;
        html += budgetCard({
          flights_total:b.vols, accommodation_total:b.hotel,
          activities_total:b.acts, food_total:b.resto,
          transport_local:b.transport, total:b.total, per_person:b.pp
        });
      }

      // ── Conseils
      if (itin.tips?.length) html += tipsCard(itin.tips);

      // ── Wishlist + Export
      const h1 = (itin.hotels||[])[0];
      const bookLinkWish = h1
        ? buildBookingLink([h1.name, itin.dest].join(' '), nights, adults, null, null, ci, co)
        : buildBookingLink(itin.dest||'', nights, adults, null, null, ci, co);

      const skyLinkWish = itin.flights?.out
        ? buildSkyscannerLink(itin.flights.out.from||'', itin.flights.out.to||'', ci, co, adults)
        : null;

      const wishData = JSON.stringify({
        type:'voyage',
        name:`${itin.flag||'✈️'} ${itin.dest||''}${itin.country?', '+itin.country:''}`,
        subtitle:`${itin.dur||''} · ${itin.trav||adults+' pers.'} · ${itin.style||''}`,
        price: itin.budget?.total ? String(itin.budget.total)+'€' : '',
        perPerson: itin.budget?.pp ? String(itin.budget.pp)+'€/pers.' : '',
        store:'booking', url:bookLinkWish,
        flightUrl:skyLinkWish,
        dep:itin.dep||'',
        hotels:(itin.hotels||[]).slice(0,3).map(h=>({
          name:h.name||'',
          price:(h.price||'?')+'€/nuit',
          cat:h.cat||'confort',
          url:buildBookingLink([h.name,itin.dest].join(' '), nights, adults, null, null, ci, co)
        })),
        budget:itin.budget||null
      }).replace(/"/g,'&quot;');

      html += `<div style="display:flex;gap:8px;margin-top:12px">
        <button onclick="addToWishlist(${wishData})" style="flex:1;background:linear-gradient(135deg,#1f2da0,#2f54ff);border:none;color:#fff;border-radius:12px;padding:12px 14px;font-weight:700;font-size:13px;cursor:pointer;font-family:inherit">♡ Sauvegarder</button>
        <button onclick="exportItinerary('${itinId}')" style="background:#f5f7ff;border:1.5px solid #c7d2fe;color:#3b5bdb;border-radius:12px;padding:12px 14px;font-weight:700;font-size:13px;cursor:pointer;font-family:inherit">⬇️ Exporter PDF</button>
      </div>`;

      if (trackingEnabled) sbFetch('searches','POST',{query:`[VOYAGE] ${message}`,session_id:sid,user_id:userId||null});
      return new Response(JSON.stringify({reply:html,sessionId:sid}),{headers:H});
    }

    // ══════════════════════════════════════════════════════════════════════════
    // MODE PRODUIT
    // ══════════════════════════════════════════════════════════════════════════
    const qAsked = countQ(history);
    const conv   = analyzeConversation(history, message);

    if (conv.topicChanged && conv.exchanges >= 4) {
      const resetMsg = conv.curCat==='cadeau'
        ? "Nouveau sujet ! Pour un cadeau, dis-moi pour qui et quel budget tu as en tête ?"
        : conv.curCat==='beaute'
        ? "Nouveau sujet ! Pour ce produit beauté, tu cherches quelque chose de précis ?"
        : "Nouveau sujet ! Dis-moi ce que tu cherches et ton budget ?";
      return new Response(JSON.stringify({reply:`<div style="font-size:13.5px;color:#1e293b;line-height:1.6;padding:4px 0">${resetMsg}</div>`,sessionId:sid,resetContext:true}),{headers:H});
    }

    const hasBudget  = /\d+\s*€|\d+\s*euros?/i.test(message);
    const hasPrecise = message.trim().split(/\s+/).length >= 3;
    const mustSearch = qAsked >= MAX_Q || (hasBudget && hasPrecise && (history||[]).length > 0);
    let decision = { ready:mustSearch, question:null, recap:null, message:null };

    if (!mustSearch) {
      const p1sys = 'Tu es l assistant shopping Huntify. JSON valide UNIQUEMENT.\n'
        + 'Une demande vague = ready:false + une question. Si besoin compris = ready:true.\n'
        + 'HISTORIQUE: ' + (hist||'Debut') + '\n'
        + 'Questions posees: ' + qAsked + '/' + MAX_Q + '\n'
        + 'REGLES: Ne redemande pas l historique. Si ' + qAsked + '>=' + MAX_Q + ' ready:true obligatoire.\n'
        + 'Recap = mots-cles produit concrets (marque+modele).\n'
        + 'JSON: {ready:false,message:question} ou {ready:true,recap:mots-cles,message:phrase courte}';

      const t1 = await callFreeAI(p1sys, `HISTORIQUE:\n${hist||'Début'}\nMESSAGE: ${message}`, 'fast');
      if (t1) {
        const d = parseJSON(t1);
        decision.ready    = d.ready===true;
        decision.question = d.question || d.message || null;
        decision.recap    = d.recap || null;
        decision.message  = d.message || d.question || null;
      }

      if (!decision.ready && !decision.message && (history||[]).length === 0) {
        const cat = detectCategory(message);
        const q = cat==='beaute'     ? "Super ! Tu cherches quelque chose de précis (teinte, couvrance) ou je te trouve les mieux notés ? Et un budget ?"
                : cat==='electronique' ? "Pour quel usage ? Et tu as un budget en tête ?"
                : cat==='mode'       ? "Quel style et quelle taille ? Et un budget ?"
                : cat==='cadeau'     ? "C'est pour qui et quel budget ?"
                : "Tu peux m'en dire un peu plus ? Un budget ou des préférences ?";
        return new Response(JSON.stringify({reply:`<div style="font-size:13.5px;color:#1e293b;line-height:1.6;padding:4px 0">${q}</div>`,sessionId:sid}),{headers:H});
      }
    }

    if (!decision.ready && (decision.message || decision.question)) {
      return new Response(JSON.stringify({
        reply:`<div style="font-size:13.5px;color:#1e293b;line-height:1.6;padding:4px 0">${decision.message||decision.question}</div>`,
        sessionId:sid
      }),{headers:H});
    }

    const recap  = decision.recap || `Je cherche : ${message}`;
    const budget = detectBudget(recap) || detectBudget(hist) || detectBudget(message);
    const roi    = estimateROI(budget, message, hist);

    const hasPrev  = (history||[]).some(m=>m.role!=='user'&&/\d+€/.test(m.content||''));
    const isFirst  = !hasPrev;
    const deepConv = conv.deepConversation && !conv.topicChanged;

    // Stratégie :
    // paid_deep   : Claude + web_search (score >= 6 ou 1er résultat ROI élevé)
    // groq_search : Groq compound-beta avec web search (score 3-5 OU si hasFreeAI)
    // free_fast   : Groq 70b sans search (score < 3)
    const strategy = ((isFirst && roi.score>=3) || roi.score>=6 || deepConv) ? 'paid_deep'
                   : roi.depth==='medium' ? 'groq_search'
                   : 'free_fast';
    const effective = (!hasFreeAI() && strategy!=='paid_deep') ? 'paid_deep' : strategy;

    const dbData    = await queryInternalDB(recap);
    const dbContext = buildDBContext(dbData);

    let products=[], promoCodes=[], summary='';

    // ── Groq DeepSearch (gratuit, web search intégré)
    if (effective === 'groq_search') {
      const groqPrompt = 'Tu es un assistant shopping expert. Cherche sur le web les meilleurs produits.\n'
        + 'BESOIN: ' + recap + '\n'
        + dbContext + '\n'
        + 'Cherche sur Amazon.fr ET fr.shopping.rakuten.com les vrais produits disponibles.\n'
        + 'Retourne JSON avec: summary, products (2 Amazon + 1 Rakuten min), promoCodes.\n'
        + 'Chaque produit: name (marque+modele exact), price (ex 29.99EUR), store (amazon ou rakuten), keywords, url (ASIN si trouve), badge.\n'
        + 'JSON UNIQUEMENT.';
      const raw = await callGroqSearch(groqPrompt, 1200);
      const p   = parseJSON(raw || '');
      products  = p.products || [];
      promoCodes= p.promoCodes || [];
      summary   = p.summary || '';
    }
    // ── Claude + web_search (premium)
    else if (effective === 'paid_deep') {
      const p2sys = 'Agent shopping Huntify. Boutiques: ' + activeNames + '.\n'
        + 'BESOIN: ' + recap + '\n'
        + dbContext + '\n'
        + '1. AMAZON.FR: 2 produits avec ASIN reels dans URL /dp/ASIN\n'
        + '2. RAKUTEN FR: 1 produit reel sur fr.shopping.rakuten.com\n'
        + '3. CODES PROMO: dealabs.com si disponible\n'
        + 'name = NOM COMPLET REEL (marque + modele). store = amazon ou rakuten.\n'
        + 'JSON: {summary, products:[{name,price,store,keywords,url,badge}], promoCodes:[{code,store,discount,best}]}';
      const raw = await callClaude(p2sys, `BESOIN: ${recap}\nMESSAGE: ${message}`, 800,
        [{type:"web_search_20250305",name:"web_search",max_uses:3}]);
      const p   = parseJSON(raw);
      products  = p.products  || [];
      promoCodes= p.promoCodes|| [];
      summary   = p.summary   || '';
    }
    // ── Free fast (Groq sans search)
    else {
      const p2sys = 'Agent shopping Huntify. Boutiques: ' + activeNames + '.\n'
        + 'BESOIN: ' + recap + ' ' + dbContext + '\n'
        + '2 produits Amazon + 1 Rakuten. name = NOM REEL (marque+modele).\n'
        + 'JSON: {summary, products:[{name,price,store,keywords,url,badge}], promoCodes:[]}';      const raw = await callFreeAI(p2sys, `BESOIN: ${recap}`, 'fast');
      const p   = parseJSON(raw || '');
      products  = p.products  || [];
      promoCodes= p.promoCodes|| [];
      summary   = p.summary   || '';
    }

    // Fallback produits si vide
    if (!products.length) {
      products = advertisers.slice(0,2).map(a=>({
        name:message, price:'Voir prix', store:a.slug,
        keywords:message, url:null, img:null, badge:null
      }));
      summary = `Résultats pour "${message}" :`;
    }

    // ── Historique prix
    let priceHistHtml = '';
    const main = products.find(p=>p.store==='amazon');
    if (main?.price && !main.price.includes('Voir')) {
      const cur  = parseFloat(main.price.replace(/[^0-9.,]/g,'').replace(',','.'));
      const slug = main.name.toLowerCase().replace(/\s+/g,'-').slice(0,50);
      const ph   = await sbFetch(`price_history?product_id=eq.${slug}&order=checked_at.desc&limit=10`) || [];
      if (ph.length>1 && !isNaN(cur)) {
        const old   = ph[ph.length-1].price;
        const trend = cur<old*0.97?'down':cur>old*1.03?'up':'stable';
        priceHistHtml = priceHistBox(old, trend);
      }
      if (!isNaN(cur)) sbFetch('price_history','POST',{product_id:slug,product_name:main.name,price:cur,store:'amazon',url:main.url||null});
    }

    // ── Construction des boutons produits
    let buttons = '';
    for (const pr of products) {
      if (!pr.name) continue;
      const adv = findAdv(advertisers, pr.store);
      if (!adv) continue;
      const rawUrl = (pr.url && pr.url !== 'null' && pr.url.length > 15) ? pr.url : null;
      const terms  = (pr.name && pr.name.length > 5) ? pr.name : (pr.keywords || pr.name);
      const url    = buildLink(adv, terms, rawUrl);
      if (!url) continue;
      buttons += productCard(pr.name, pr.price||'Voir prix', url, adv, pr.img||null, pr.badge||null);
    }

    // ── Codes promo
    let promos = '';
    for (const c of (promoCodes||[]).filter(c=>c.code).sort((a,b)=>(b.best?1:0)-(a.best?1:0)).slice(0,2)) {
      promos += promoBox(c.code, c.store||'boutique', c.discount||'Réduction', c.best||false);
      sbFetch('promo_codes','POST',{code:c.code,store:c.store||'unknown',discount:c.discount||'',product_query:message,found_at:new Date().toISOString(),valid:true});
    }

    let dbPromos = '';
    for (const adv of advertisers) {
      const cpns = await getAutoCoupons(adv.slug);
      for (const c of cpns) {
        if (!(promoCodes||[]).find(p=>p.code===c.code))
          dbPromos += promoBox(c.code, c.store||adv.name, c.discount||'Réduction', false);
      }
    }

    // ── Wishlist button
    const first = products[0];
    const adv0  = first ? findAdv(advertisers, first.store) : null;
    const wish  = first && adv0
      ? `<button onclick="addToWishlist(${JSON.stringify({type:'product',name:first.name,price:first.price,store:first.store,url:buildLink(adv0,first.keywords||first.name,first.url||null)}).replace(/"/g,'&quot;')})" style="background:#fff;border:1.5px solid #e8edf8;color:#3b5bdb;border-radius:12px;padding:8px 16px;margin-top:10px;font-weight:700;font-size:12px;cursor:pointer;font-family:inherit;width:100%">♡ Ajouter à ma wishlist</button>`
      : '';

    // ── Cross-suggestions
    const sugs  = getCrossSuggestions(recap);
    const cross = sugs.length
      ? `<div style="margin-top:12px;padding-top:10px;border-top:1px solid #f0f4ff">
          <div style="font-size:11px;font-weight:700;color:#7c89a8;margin-bottom:6px">Tu pourrais aussi aimer :</div>
          <div style="display:flex;gap:6px;flex-wrap:wrap">${sugs.map(s=>`<button onclick="send('${s.replace(/'/g,"\\'")}')" style="background:#f5f7ff;border:1.5px solid #e8edf8;color:#3b5bdb;border-radius:100px;padding:6px 14px;font-size:11px;font-weight:600;cursor:pointer;font-family:inherit">${s}</button>`).join('')}</div>
        </div>`
      : '';

    const reply =
      `<div style="font-size:13.5px;color:#1e293b;margin-bottom:8px;font-weight:500;line-height:1.5">${decision.message||summary}</div>`
      + priceHistHtml + buttons
      + (promos   ? `<div style="margin-top:4px">${promos}</div>`   : '')
      + (dbPromos ? `<div style="margin-top:4px">${dbPromos}</div>` : '')
      + wish + cross;

    return new Response(JSON.stringify({reply, sessionId:sid}), {headers:H});

  } catch(err) {
    console.error('Huntify error:', err.message);
    return new Response(
      JSON.stringify({reply:"Désolé, problème technique momentané. Réessayez !"}),
      {status:200, headers:{'Content-Type':'application/json; charset=utf-8','Access-Control-Allow-Origin':'*'}}
    );
  }
}
