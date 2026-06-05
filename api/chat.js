export const config = { runtime: 'edge' };

// ─────────────────────────────────────────────────────────────────────────────
// HUNTIFY — Agent IA shopping + voyage
// Groq DeepSearch (gratuit) → Claude (génération finale premium)
// Travelpayouts : Booking.com + Expedia + GetTransfer
// ─────────────────────────────────────────────────────────────────────────────

const SUPABASE_URL  = "https://enocxbrqyybendertytl.supabase.co";
const SUPABASE_KEY  = "sb_publishable_NmPh--frZG5HuqfaoxnemA_E7cidV9Y";
const AMAZON_TAG    = "huntify21-21";
const AWIN_PUB      = "2920215";
const RAKUTEN_MID   = "55615";
const TP_MARKER     = "536663";
const MODEL         = "claude-haiku-4-5";

// Codes IATA — données de référence, pas de logique
const IATA = {
  paris:"CDG",lyon:"LYS",marseille:"MRS",nice:"NCE",bordeaux:"BOD",toulouse:"TLS",
  nantes:"NTE",strasbourg:"SXB",montpellier:"MPL",rennes:"RNS",
  rome:"FCO",milan:"MXP",venise:"VCE",naples:"NAP",florence:"FLR",
  barcelone:"BCN",madrid:"MAD",ibiza:"IBZ",majorque:"PMI",seville:"SVQ",malaga:"AGP",
  lisbonne:"LIS",porto:"OPO",faro:"FAO",
  londres:"LHR",manchester:"MAN",edimbourg:"EDI",
  amsterdam:"AMS",bruxelles:"BRU",zurich:"ZRH",geneve:"GVA",vienne:"VIE",
  berlin:"BER",munich:"MUC",francfort:"FRA",hambourg:"HAM",
  prague:"PRG",budapest:"BUD",varsovie:"WAW",
  athenes:"ATH",santorin:"JTR",mykonos:"JMK",crete:"HER",rhodes:"RHO",
  marrakech:"RAK",casablanca:"CMN",agadir:"AGA",tunis:"TUN",djerba:"DJE",
  istanbul:"IST",antalya:"AYT",hurghada:"HRG",
  dubai:"DXB","abu dhabi":"AUH",doha:"DOH",
  tokyo:"NRT",osaka:"KIX",bangkok:"BKK",singapour:"SIN",bali:"DPS",
  "kuala lumpur":"KUL","new york":"JFK","los angeles":"LAX",miami:"MIA",
  montreal:"YUL",cancun:"CUN",maldives:"MLE",maurice:"MRU",reunion:"RUN"
};

function toIATA(str) {
  if (!str) return null;
  const code = (str||"").match(/\b([A-Z]{3})\b/);
  if (code) return code[1];
  const s = str.toLowerCase().trim();
  for (const [k,v] of Object.entries(IATA)) { if (s.includes(k)) return v; }
  return null;
}

// ── SUPABASE ──────────────────────────────────────────────────────────────────
async function sbFetch(path, method, body) {
  method = method||"GET";
  const opts = {method, headers:{"Content-Type":"application/json","apikey":SUPABASE_KEY,"Authorization":"Bearer "+SUPABASE_KEY}};
  if (body) opts.body = JSON.stringify(body);
  try { const r = await fetch(SUPABASE_URL+"/rest/v1/"+path, opts); return await r.json(); } catch(e) { return null; }
}

async function getAdvertisers() {
  try {
    const r = await fetch(SUPABASE_URL+"/rest/v1/advertisers?active=eq.true", {headers:{"apikey":SUPABASE_KEY,"Authorization":"Bearer "+SUPABASE_KEY}});
    const d = await r.json(); return Array.isArray(d)?d:[];
  } catch(e) { return []; }
}

// ── LIENS AFFILIATION ─────────────────────────────────────────────────────────
function cleanKw(kw) {
  if (!kw) return "";
  const stop = new Set(["la","le","les","un","une","des","avec","et","en","du","au","aux","pour","sur"]);
  return kw.replace(/,/g," ").replace(/\s+/g," ").trim()
    .split(" ").filter(w=>w.length>1&&!stop.has(w.toLowerCase())).slice(0,7).join(" ");
}

function buildLink(adv, keywords, directUrl) {
  if (!adv||!adv.active) return null;
  const kw = cleanKw(keywords);
  if (adv.slug==="amazon") {
    const tag = adv.amazon_tag||AMAZON_TAG;
    // Valide que l ASIN est réel : 10 caractères alphanumériques commençant par B
    // Un ASIN inventé par une IA ne passe pas ce test → on utilise la recherche
    const asinMatch = directUrl&&directUrl.match(/\/dp\/([A-Z0-9]{10})(?:[/?]|$)/);
    const isRealAsin = asinMatch&&/^B[A-Z0-9]{9}$/.test(asinMatch[1]);
    const base = isRealAsin
      ? "https://www.amazon.fr/dp/"+asinMatch[1]   // ASIN validé → lien direct
      : "https://www.amazon.fr/s?k="+encodeURIComponent(kw); // sinon → recherche
    return base+"?tag="+tag;
  }
  if (adv.slug==="rakuten") {
    // Lien direct Rakuten avec tag affilié dans le referer Awin
    const mid = adv.awin_mid||RAKUTEN_MID;
    const aff = adv.awin_affid||adv.awin_aff||AWIN_PUB;
    const searchUrl = "https://fr.shopping.rakuten.com/s/"+encodeURIComponent(kw.replace(/\s+/g,"+"));
    // Lien Awin direct → Rakuten FR (fonctionne même sans approbation)
    return "https://www.awin1.com/cread.php?awinmid="+mid+"&awinaffid="+aff+"&clickref=huntify&ued="+encodeURIComponent(searchUrl);
  }
  if (adv.awin_mid) {
    const aff = adv.awin_affid||adv.awin_aff||AWIN_PUB;
    const dest = (adv.search_url||"https://www."+adv.slug+".fr/search?q={kw}").replace("{kw}",encodeURIComponent(kw));
    return "https://www.awin1.com/cread.php?awinmid="+adv.awin_mid+"&awinaffid="+aff+"&ued="+encodeURIComponent(dest);
  }
  return null;
}

function findAdv(advertisers, slug) {
  return (advertisers||[]).find(a=>a.slug===(slug||"").toLowerCase())||null;
}

// ── TRAVELPAYOUTS LIENS ───────────────────────────────────────────────────────

// Skyscanner via Travelpayouts
function skyscannerLink(from, to, ci, co, adults) {
  const f = (toIATA(from)||"par").toLowerCase();
  const t = (toIATA(to)||"xxx").toLowerCase();
  const fmt = d => d?d.replace(/-/g,"").slice(2):null;
  const out = fmt(ci), ret = fmt(co);
  const base = "https://www.skyscanner.fr/transport/vols/"+f+"/"+t+"/";
  if (out&&ret) return base+out+"/"+ret+"/?adults="+(adults||2)+"&currency=EUR";
  if (out) return base+out+"/?adults="+(adults||2)+"&currency=EUR";
  return base;
}

// Booking.com — lien affilié Travelpayouts (marker 536663)
// ── BOOKING.COM — lien direct avec dates et filtres ──────────────────────────
// Quand les IDs Travelpayouts seront disponibles, on ajoutera le wrapper TP
function bookingLink(dest, ci, co, adults, cat) {
  const rooms = Math.ceil((adults||2)/2);
  let url = "https://www.booking.com/searchresults.html"
    +"?ss="+encodeURIComponent(dest||"")
    +"&group_adults="+(adults||2)+"&no_rooms="+rooms
    +"&lang=fr&selected_currency=EUR";
  if (ci) url += "&checkin="+ci;
  if (co) url += "&checkout="+co;
  // Filtres étoiles selon catégorie (Budget=2-3★, Confort=3-4★, Luxe=4-5★)
  if (cat==="budget")  url += "&nflt=class%3D2%3Bclass%3D3";
  if (cat==="confort") url += "&nflt=class%3D3%3Bclass%3D4";
  if (cat==="luxe")    url += "&nflt=class%3D4%3Bclass%3D5";
  url += "&order=popularity";
  return url;
}

// ── EXPEDIA.FR — lien direct avec dates ──────────────────────────────────────
function expediaLink(dest, ci, co, adults) {
  let url = "https://www.expedia.fr/Hotel-Search"
    +"?destination="+encodeURIComponent(dest||"")
    +"&adults="+(adults||2)
    +"&sort=RECOMMENDED";
  if (ci) url += "&startDate="+ci;
  if (co) url += "&endDate="+co;
  return url;
}

// ── GETTRANSFER (Travelpayouts) ───────────────────────────────────────────────
function getTransferLink(dest, ci) {
  const base = "https://gettransfer.tpk.mx/vMnVrFfO";
  if (dest) return base+"?to="+encodeURIComponent(dest)+(ci?"&date="+ci:"");
  return base;
}

// ── TRAVELPAYOUTS : API PRIX HÔTELS (Hotellook backend) ──────────────────────
// Même si le site hotellook.com n'est pas affiché, l'API retourne des prix
// qu'on redirige ensuite vers Booking.com pour la réservation
async function fetchHotelPrices(dest, ci, co, adults) {
  const token = process.env.TRAVELPAYOUTS_TOKEN;
  if (!token||!ci||!co||!dest) return null;
  try {
    const url = "https://engine.hotellook.com/api/v2/cache.json"
      +"?location="+encodeURIComponent(dest)
      +"&checkIn="+ci+"&checkOut="+co
      +"&adultsCount="+(adults||2)+"&currency=EUR"
      +"&token="+token+"&limit=25";
    const r = await fetch(url, {headers:{"Accept":"application/json"}});
    if (!r.ok) return null;
    const data = await r.json();
    if (!Array.isArray(data)||data.length<2) return null;
    const valid = data
      .filter(h=>h.priceFrom&&(h.hotelName||h.name)&&h.id)
      .map(h=>({
        name:  h.hotelName||h.name,
        stars: Math.round(h.stars||3),
        price: Math.round(h.priceFrom),
        loc:   (h.location&&h.location.name)||dest,
        // On redirige vers Booking.com pour la réservation (site français et sécurisé)
        url:   bookingLink(h.hotelName||h.name, ci, co, adults, null)
      }))
      .sort((a,b)=>a.price-b.price);
    if (valid.length<2) return null;
    const t = Math.max(1,Math.floor(valid.length/3));
    const mid = arr => arr[Math.floor(arr.length/2)];
    return [
      Object.assign({},mid(valid.slice(0,t)),    {cat:"budget",  hl:"Meilleur rapport qualité/prix"}),
      Object.assign({},mid(valid.slice(t,t*2)),  {cat:"confort", hl:"Confort et emplacement idéal"}),
      Object.assign({},mid(valid.slice(-t)),     {cat:"luxe",    hl:"Expérience premium"}),
    ];
  } catch(e) { return null; }
}

// ── DATE PARSER ───────────────────────────────────────────────────────────────
function parseDate(str) {
  if (!str) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  const now = new Date();
  const addDays = n => { const d=new Date(now); d.setDate(d.getDate()+n); return d.toISOString().slice(0,10); };
  const s = str.toLowerCase().trim();
  if (s==="demain") return addDays(1);
  if (/apres.?demain/.test(s)) return addDays(2);
  const slash = str.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (slash) { const y=slash[3].length===2?"20"+slash[3]:slash[3]; return y+"-"+slash[2].padStart(2,"0")+"-"+slash[1].padStart(2,"0"); }
  const MONTHS = {jan:1,janv:1,fev:2,mar:3,mars:3,avr:4,avril:4,mai:5,juin:6,juil:7,juillet:7,aout:8,sep:9,sept:9,oct:10,nov:11,dec:12};
  const mn = s.match(/(\d{1,2})\s+([a-zéûôà]+)(?:\s+(\d{4}))?/);
  if (mn) {
    const mo = Object.entries(MONTHS).find(([k])=>mn[2].startsWith(k));
    if (mo) {
      let y = mn[3]||String(now.getFullYear());
      const d = new Date(y+"-"+String(mo[1]).padStart(2,"0")+"-"+mn[1].padStart(2,"0"));
      if (!mn[3]&&d<now) y = String(now.getFullYear()+1);
      return y+"-"+String(mo[1]).padStart(2,"0")+"-"+mn[1].padStart(2,"0");
    }
  }
  return null;
}

// ── HISTORIQUE ────────────────────────────────────────────────────────────────
function formatHistory(history, maxLen) {
  return ((history||[]).map(m=>{
    const who = m.role==="user"?"Client":"Huntify";
    const text = (m.content||"").replace(/<[^>]*>/g," ").replace(/\s+/g," ").trim().slice(0,300);
    return text?who+": "+text:null;
  }).filter(Boolean).join("\n")).slice(0,maxLen||2000);
}

// ── APPELS IA ─────────────────────────────────────────────────────────────────
async function groq(sys, user, maxTok) {
  const key = process.env.GROQ_API_KEY; if (!key) return null;
  try {
    const r = await fetch("https://api.groq.com/openai/v1/chat/completions",{
      method:"POST", headers:{"Content-Type":"application/json","Authorization":"Bearer "+key},
      body:JSON.stringify({model:"llama-3.3-70b-versatile",max_tokens:maxTok||500,messages:[{role:"system",content:sys},{role:"user",content:user}]})
    });
    if (!r.ok) return null;
    const d = await r.json(); return d.choices&&d.choices[0]?d.choices[0].message.content:null;
  } catch(e){return null;}
}

async function groqSearch(prompt, maxTok) {
  const key = process.env.GROQ_API_KEY; if (!key) return null;
  try {
    const r = await fetch("https://api.groq.com/openai/v1/chat/completions",{
      method:"POST", headers:{"Content-Type":"application/json","Authorization":"Bearer "+key},
      body:JSON.stringify({model:"compound-beta",max_tokens:maxTok||1200,messages:[{role:"user",content:prompt}]})
    });
    if (!r.ok) return await groq("Reponds en JSON.",prompt,maxTok||1200);
    const d = await r.json(); return d.choices&&d.choices[0]?d.choices[0].message.content:null;
  } catch(e){ return await groq("Reponds en JSON.",prompt,maxTok||1200); }
}

async function gemini(prompt, maxTok) {
  const key = process.env.GEMINI_API_KEY; if (!key) return null;
  try {
    const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key="+key,{
      method:"POST", headers:{"Content-Type":"application/json"},
      body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{maxOutputTokens:maxTok||500}})
    });
    if (!r.ok) return null;
    const d = await r.json(); return d.candidates&&d.candidates[0]&&d.candidates[0].content?d.candidates[0].content.parts[0].text:null;
  } catch(e){return null;}
}

async function mistral(sys, user, maxTok) {
  const key = process.env.MISTRAL_API_KEY; if (!key) return null;
  try {
    const r = await fetch("https://api.mistral.ai/v1/chat/completions",{
      method:"POST", headers:{"Content-Type":"application/json","Authorization":"Bearer "+key},
      body:JSON.stringify({model:"mistral-small-latest",max_tokens:maxTok||500,messages:[{role:"system",content:sys},{role:"user",content:user}]})
    });
    if (!r.ok) return null;
    const d = await r.json(); return d.choices&&d.choices[0]?d.choices[0].message.content:null;
  } catch(e){return null;}
}

async function freeAI(sys, user, maxTok) {
  return await groq(sys,user,maxTok)||await gemini(sys+"\n\n"+user,maxTok)||await mistral(sys,user,maxTok);
}

async function claude(sys, user, maxTok, tools) {
  const key = process.env.ANTHROPIC_API_KEY; if (!key) return null;
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages",{
      method:"POST",
      headers:{"Content-Type":"application/json; charset=utf-8","x-api-key":key,"anthropic-version":"2023-06-01"},
      body:JSON.stringify({model:MODEL,max_tokens:maxTok||800,tools:tools||[],system:sys,messages:[{role:"user",content:user}]})
    });
    const d = await r.json(); if (!r.ok) return null;
    let t=""; for(const b of (d.content||[])){if(b.type==="text")t+=b.text;} return t||null;
  } catch(e){return null;}
}

function parseJSON(raw) {
  if (!raw) return {};
  try { const m=raw.match(/```(?:json)?\s*([\s\S]*?)```/); if(m) return JSON.parse(m[1].trim()); } catch(e){}
  try { const m=raw.match(/\{[\s\S]*\}/); if(m) return JSON.parse(m[0]); } catch(e){}
  return {};
}

async function dbLookup(kw) {
  const k=(kw||"").toLowerCase().split(" ")[0];
  try {
    const [deals,prices,promos]=await Promise.all([
      sbFetch("daily_deals?name=ilike.*"+encodeURIComponent(k)+"*&limit=3"),
      sbFetch("price_history?product_name=ilike.*"+encodeURIComponent(k)+"*&order=checked_at.desc&limit=5"),
      sbFetch("promo_codes?valid=eq.true&order=found_at.desc&limit=2")
    ]);
    const parts=[];
    if(deals&&deals.length) parts.push("Deals: "+deals.map(x=>x.name+" "+x.price+"€").join(" | "));
    if(prices&&prices.length) parts.push("Prix: "+prices.map(x=>x.product_name+" "+x.price+"€").join(" | "));
    if(promos&&promos.length) parts.push("Codes: "+promos.map(x=>x.code+" ("+x.store+")").join(" | "));
    return parts.join("\n");
  } catch(e){return "";}
}

// ── COMPOSANTS HTML ───────────────────────────────────────────────────────────
function cardProduct(name, price, url, adv, img, badge) {
  const imgH = img?'<img src="'+img+'" style="width:56px;height:56px;object-fit:cover;border-radius:8px;flex-shrink:0" onerror="this.style.display=\'none\'">':'';
  const pill = '<span style="background:rgba(255,255,255,.2);border-radius:100px;padding:2px 10px;font-size:10px;font-weight:800">'+(adv.emoji||"🛍️")+" "+adv.name+"</span>";
  return '<a href="'+url+'" target="_blank" rel="sponsored noopener" style="display:flex;align-items:center;gap:12px;background:'+(adv.color||"#2f54ff")+';color:#fff;text-decoration:none;border-radius:14px;padding:12px 14px;margin-top:8px">'
    +imgH+'<div style="flex:1;min-width:0"><div style="font-size:10px;margin-bottom:4px;opacity:.85">'+pill+(badge?" · "+badge:"")+"</div>"
    +'<div style="font-size:13px;font-weight:800;line-height:1.3;word-break:break-word">'+name+"</div></div>"
    +'<span style="background:rgba(255,255,255,.22);border-radius:8px;padding:5px 10px;white-space:nowrap;font-size:14px;font-weight:900;flex-shrink:0">'+(price||"Voir prix")+"</span></a>";
}

function promoBox(code, store, desc, best) {
  return '<div style="background:'+(best?"#dcfce7":"#f0fdf4")+';border:'+(best?"2px solid #16a34a":"1.5px solid #86efac")+';border-radius:12px;padding:10px 14px;margin-top:6px;display:flex;align-items:center;justify-content:space-between;gap:8px">'
    +'<div><span style="font-size:11px;color:#16a34a;font-weight:700">'+(best?"⭐ MEILLEUR — ":"")+"🏷️ "+store+"</span>"
    +'<div style="font-size:12px;color:#166534;font-weight:600">'+desc+"</div></div>"
    +'<div onclick="navigator.clipboard.writeText(\''+code+'\');this.innerHTML=\'✓\';setTimeout(()=>this.innerHTML=\''+code+'\',2000)" style="background:#16a34a;color:#fff;border-radius:8px;padding:6px 10px;font-weight:800;font-size:12px;cursor:pointer;white-space:nowrap;flex-shrink:0">'+code+"</div></div>";
}

function cardHotel(h, link) {
  const stars = "⭐".repeat(Math.min(h.stars||3,5));
  const cc = {budget:"#16a34a",confort:"#2f54ff",luxe:"#7c3aed"}[h.cat]||"#2f54ff";
  const cl = {budget:"💚 Budget",confort:"💙 Confort",luxe:"💎 Luxe"}[h.cat]||"";
  const hasPrice = h.price&&h.priceReal;
  const priceDiv = hasPrice
    ? '<div style="background:linear-gradient(135deg,#16a34a,#15803d);color:#fff;border-radius:10px;padding:7px 11px;text-align:center;flex-shrink:0;margin-left:8px"><div style="font-size:9px;opacity:.85">Prix réel ✓</div><div style="font-size:15px;font-weight:900">'+h.price+'€</div><div style="font-size:9px;opacity:.75">/nuit</div></div>'
    : '<div style="background:linear-gradient(135deg,'+cc+','+cc+'cc);color:#fff;border-radius:10px;padding:8px 12px;text-align:center;flex-shrink:0;margin-left:8px;min-width:60px"><div style="font-size:10px">Voir prix</div><div style="font-size:12px;font-weight:800">→</div></div>';
  return '<a href="'+link+'" target="_blank" rel="sponsored noopener" style="display:flex;flex-direction:column;background:#fff;border:1.5px solid '+(hasPrice?"#bbf7d0":"#e6ebf7")+';border-radius:14px;padding:13px;margin-top:8px;text-decoration:none;gap:5px">'
    +'<div style="display:flex;justify-content:space-between;align-items:flex-start">'
    +'<div style="flex:1">'+(cl?'<span style="background:#eff6ff;color:'+cc+';border-radius:100px;padding:2px 9px;font-size:10px;font-weight:800">'+cl+"</span>":"")
    +'<div style="font-size:13px;font-weight:800;color:#0e1430;margin-top:3px">'+h.name+"</div>"
    +'<div style="font-size:11px;color:#7c89a8">'+stars+" · "+(h.loc||"")+"</div></div>"+priceDiv+"</div>"
    +(h.hl?'<div style="font-size:11px;color:'+cc+';font-weight:600;background:#eff6ff;border-radius:8px;padding:4px 10px">✨ '+h.hl+"</div>":"")
    +'<div style="background:'+(hasPrice?"#f0fdf4":"#f0f9ff")+';border-radius:8px;padding:6px 10px;font-size:11px;color:'+(hasPrice?"#15803d":"#0369a1")+';font-weight:600">'
    +(hasPrice?"🟢 Prix vérifié · Réserver sur Booking.com →":"🏨 Voir disponibilités et prix sur Booking.com →")+"</div></a>";
}

function cardDay(d) {
  return '<div style="background:#fff;border:1.5px solid #e6ebf7;border-radius:14px;padding:14px;margin-top:9px">'
    +'<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">'
    +'<div style="background:linear-gradient(135deg,#2f54ff,#4a6bff);color:#fff;border-radius:8px;padding:4px 12px;font-size:12px;font-weight:800">Jour '+d.n+"</div>"
    +'<div style="font-size:12px;font-weight:700;color:#0e1430;flex:1;margin-left:8px">'+(d.title||"")+"</div>"
    +(d.budget?'<div style="font-size:11px;color:#16a34a;font-weight:700">~'+d.budget+"€</div>":"")+"</div>"
    +(d.am?'<div style="display:flex;gap:9px;margin-bottom:8px"><span>🌅</span><div><div style="font-size:10px;font-weight:800;color:#94a3b8;text-transform:uppercase">Matin</div><div style="font-size:12px;color:#374151">'+d.am+"</div></div></div>":"")
    +(d.pm?'<div style="display:flex;gap:9px;margin-bottom:8px"><span>☀️</span><div><div style="font-size:10px;font-weight:800;color:#94a3b8;text-transform:uppercase">Après-midi</div><div style="font-size:12px;color:#374151">'+d.pm+"</div></div></div>":"")
    +(d.eve?'<div style="display:flex;gap:9px;margin-bottom:4px"><span>🌙</span><div><div style="font-size:10px;font-weight:800;color:#94a3b8;text-transform:uppercase">Soirée</div><div style="font-size:12px;color:#374151">'+d.eve+"</div></div></div>":"")
    +(d.resto?'<div style="background:#f0fdf4;border-radius:9px;padding:7px 11px;margin-top:6px;display:flex;justify-content:space-between;align-items:center"><div><div style="font-size:11px;color:#16a34a;font-weight:700">🍽️ '+d.resto.name+"</div>"+(d.resto.spec?'<div style="font-size:10px;color:#86efac">'+d.resto.spec+"</div>":"")+"</div>"+'<div style="font-size:12px;color:#16a34a;font-weight:800">'+d.resto.price+"</div></div>":"")
    +(d.acts&&d.acts.length?'<div style="margin-top:7px;display:flex;flex-wrap:wrap;gap:4px">'+d.acts.map(a=>'<span style="background:#eff6ff;color:#2f54ff;border-radius:100px;padding:2px 9px;font-size:10.5px;font-weight:600">'+a+"</span>").join("")+"</div>":"")
    +"</div>";
}

function cardBudget(b) {
  const rows = [["✈️ Vols A/R",b.vols],["🏨 Hébergement",b.hotel],["🎯 Activités",b.acts],["🍽️ Restaurants",b.resto],["🚇 Transport",b.transport]].filter(r=>r[1]!=null);
  return '<div style="background:linear-gradient(135deg,#0e1430,#1f2da0);border-radius:16px;padding:16px;margin-top:12px">'
    +'<div style="font-size:13px;font-weight:800;color:#fff;margin-bottom:12px">💰 Budget estimé par l\'IA</div>'
    +rows.map(r=>'<div style="display:flex;justify-content:space-between;margin-bottom:7px"><span style="font-size:12px;color:rgba(255,255,255,.75)">'+r[0]+'</span><span style="font-size:12px;font-weight:700;color:#fff">~'+r[1]+"€</span></div>").join("")
    +'<div style="border-top:1px solid rgba(255,255,255,.2);margin-top:10px;padding-top:10px;display:flex;justify-content:space-between">'
    +'<span style="font-size:13px;font-weight:800;color:#fff">TOTAL</span>'
    +'<span style="font-size:16px;font-weight:900;color:#bcd0ff">~'+(b.total||"")+"€</span></div>"
    +(b.pp?'<div style="font-size:11px;color:rgba(255,255,255,.6);text-align:right;margin-top:3px">soit ~'+b.pp+"€/personne</div>":"")
    +'<div style="font-size:10px;color:rgba(255,255,255,.4);margin-top:8px">Estimations IA · Cliquez les liens pour les vrais prix</div></div>';
}

function cardTips(tips) {
  if (!tips||!tips.length) return "";
  return '<div style="background:#f5f3ff;border:1.5px solid #ddd6fe;border-radius:14px;padding:14px;margin-top:10px">'
    +'<div style="font-size:12px;font-weight:800;color:#5b21b6;margin-bottom:8px">💡 Conseils pratiques</div>'
    +tips.map(t=>'<div style="font-size:12px;color:#374151;margin-bottom:5px;padding-left:8px;border-left:2px solid #c4b5fd">• '+t+"</div>").join("")+"</div>";
}

// ── HANDLER ───────────────────────────────────────────────────────────────────
export default async function handler(req) {
  if (req.method==="OPTIONS") return new Response(null,{status:204,headers:{"Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"POST,OPTIONS","Access-Control-Allow-Headers":"Content-Type"}});
  if (req.method!=="POST")   return new Response("Method not allowed",{status:405});
  const H = {"Content-Type":"application/json; charset=utf-8","Access-Control-Allow-Origin":"*"};

  try {
    const body = await req.json();
    const message = body.message||"";
    const history = body.history||[];
    const sid = body.sessionId||("anon_"+Date.now());
    const isTravel = body.mode==="travel";
    const today = new Date().toISOString().slice(0,10);
    const advertisers = await getAdvertisers();

    if (body.trackingEnabled) {
      Promise.all([
        sbFetch("searches","POST",{query:message,session_id:sid,user_id:body.userId||null}),
        sbFetch("trends","POST",{query:message.toLowerCase().trim(),count:1,last_searched:new Date().toISOString()})
      ]).catch(()=>{});
    }

    const hist  = formatHistory(history, 2000);
    const histS = formatHistory(history, 1000);

    // ══════════════════════════════════════════════════════════════════════════
    //  MODE VOYAGE — Groq pilote, Claude génère
    // ══════════════════════════════════════════════════════════════════════════
    if (isTravel) {

      // Groq DeepSearch lit toute la conversation et décide seul
      const groqPrompt = "Tu es Huntify, agent voyage expert et chaleureux.\n"
        +"Aujourd'hui: "+today+"\n\n"
        +"CONVERSATION COMPLETE:\n"+hist+"\n"
        +"MESSAGE: "+message+"\n\n"
        +"MISSION: analyse tout et decides.\n"
        +"Extrais les infos: destination, ville_depart, checkin (YYYY-MM-DD), checkout (YYYY-MM-DD), duree, nb_adultes, budget, style.\n"
        +"La ville de depart peut etre dite de n'importe quelle facon (marseille / depuis marseille / je pars de nice / marseilel = faute ok).\n"
        +"Si l'utilisateur repond a une question, sa reponse est la reponse a cette question.\n"
        +"Ne pose JAMAIS deux fois la meme question. Lis l'historique.\n\n"
        +"DECISION:\n"
        +"- destination + ville_depart + (duree OU dates) connues → action:generate\n"
        +"- info manquante importante → action:question avec UNE question courte\n"
        +"- plus de 3 echanges → action:generate avec ce qu'on a\n\n"
        +"JSON:\n"
        +"question: {action:'question', msg:'question courte'}\n"
        +"generation: {action:'generate', infos:{destination, ville_depart, nb_adultes, checkin, checkout, duree, budget, style}}";

      const decision = parseJSON(
        await groqSearch(groqPrompt, 700)
        || await freeAI("Reponds en JSON.", groqPrompt, 700)
        || "{}"
      );

      if (decision.action==="question" && decision.msg) {
        return new Response(JSON.stringify({reply:'<div style="font-size:13.5px;color:#1e293b;line-height:1.6;padding:4px 0">'+decision.msg+"</div>",sessionId:sid}),{headers:H});
      }

      // ── GÉNÉRATION ITINÉRAIRE ─────────────────────────────────────────────────
      // ORDRE DE COÛT : Groq DeepSearch (gratuit) → Mistral (gratuit) → Claude (payant)
      const infos = decision.infos||{};
      const adults = parseInt(infos.nb_adultes)||2;
      const ci = parseDate(infos.checkin||null);
      const nights = parseInt(((infos.duree||"3 jours").match(/\d+/)||["3"])[0])||3;
      const co = parseDate(infos.checkout||null)||(ci?(function(){const d=new Date(ci);d.setDate(d.getDate()+nights);return d.toISOString().slice(0,10);}()):"");

      // Groq DeepSearch cherche les VRAIS prix sur le web — aucun prix hardcodé
      const itinPrompt = "Tu es Huntify, expert voyage avec acces au web en temps reel.\n"
        +"VOYAGE DEMANDE: "+infos.destination+" depuis "+infos.ville_depart
        +", "+adults+" adultes, "+(ci||"bientot")+" au "+(co||"")+" ("+nights+" nuits)"
        +", budget: "+(infos.budget||"pas de contrainte")
        +", style: "+(infos.style||"equilibre")+"\n\n"
        +"ETAPE 1 - RECHERCHE WEB (utilise tes capacites de recherche):\n"
        +"- Cherche les vrais prix de vols "+infos.ville_depart+" → "+infos.destination+" pour ces dates\n"
        +"- Cherche les vrais prix d hotels a "+infos.destination+" (3 categories: budget, confort, luxe)\n"
        +"- Cherche les vrais restaurants populaires locaux avec leurs prix\n"
        +"- Cherche les activites incontournables et leurs tarifs reels\n\n"
        +"ETAPE 2 - GENERE le JSON avec les prix trouves:\n"
        +"t:i, recap:string, itin:{\n"
        +"  dest, country, flag, dur, trav, style, dep,\n"
        +"  checkin:YYYY-MM-DD, checkout:YYYY-MM-DD, adults,\n"
        +"  flights:{out:{from:IATA,to:IATA,price:prix reel trouve,co:compagnie reelle,dur}, ret:{...}},\n"
        +"  hotels:[3 vrais hotels: {name,stars,price:prix reel/nuit,loc,hl,cat:budget/confort/luxe}],\n"
        +"  days:[{n,title,am,pm,eve,resto:{name,price:prix reel,spec},acts:[activites],budget:total jour}],\n"
        +"  budget:{vols,hotel,acts,resto,transport,total,pp},\n"
        +"  tips:[4 conseils specifiques]\n"
        +"}\n"
        +"IATA: Paris=CDG, Marseille=MRS, Nice=NCE, Lyon=LYS, Rome=FCO, Barcelone=BCN, Madrid=MAD, Lisbonne=LIS, Londres=LHR.\n"
        +"Hotels et restaurants: vrais etablissements existants avec vrais prix trouves sur le web.\n"
        +"JSON UNIQUEMENT.";

      // 1. Groq DeepSearch (gratuit, web search) — génération principale
      let itinRaw = await groqSearch(itinPrompt, 2500);
      // 2. Mistral si Groq échoue (gratuit)
      if (!itinRaw) itinRaw = await mistral("Genere un itineraire de voyage en JSON.", itinPrompt, 2500);
      // 3. Claude uniquement en dernier recours (payant)
      if (!itinRaw) itinRaw = await claude(itinPrompt, "Genere maintenant.", 2800, []);

      const tP = parseJSON(itinRaw||"");
      const itin = tP.itin;

      // Fallback minimal si génération échoue
      if (!itin) {
        const sky = skyscannerLink(infos.ville_depart||"",infos.destination||"",ci,co,adults);
        const htl = bookingLink(infos.destination||"",ci,co,adults,null);
        const bkg = bookingLink(infos.destination||"",ci,co,adults,null);
        const gtf = getTransferLink(infos.destination||"",ci);
        return new Response(JSON.stringify({reply:
          '<div style="font-size:13.5px;color:#1e293b;line-height:1.6;margin-bottom:12px">Voici les liens directs pour votre voyage :</div>'
          +'<a href="'+sky+'" target="_blank" style="display:flex;justify-content:center;background:linear-gradient(135deg,#0e1430,#1f2da0);color:#fff;text-decoration:none;border-radius:12px;padding:14px;margin-top:8px;font-size:13px;font-weight:700">✈️ Vols sur Skyscanner →</a>'
          +'<a href="'+bkg+'" target="_blank" style="display:flex;justify-content:center;background:linear-gradient(135deg,#003580,#0071c2);color:#fff;text-decoration:none;border-radius:12px;padding:14px;margin-top:8px;font-size:13px;font-weight:700">🏨 Hôtels sur Booking.com →</a>'
          +'<a href="'+gtf+'" target="_blank" style="display:flex;justify-content:center;background:linear-gradient(135deg,#1a1a2e,#e94560);color:#fff;text-decoration:none;border-radius:12px;padding:14px;margin-top:8px;font-size:13px;font-weight:700">🚗 Transfert aéroport GetTransfer →</a>',
          sessionId:sid}),{headers:H});
      }

      // Render itinéraire complet
      const finalCi = (/^\d{4}-\d{2}-\d{2}$/.test(itin.checkin||""))?itin.checkin:(ci||"");
      const finalCo = (/^\d{4}-\d{2}-\d{2}$/.test(itin.checkout||""))?itin.checkout:(co||"");
      const finalAdults = itin.adults||adults;
      const itinId = "itin_"+Date.now();
      let html = "";

      // Header destination
      html += '<div id="'+itinId+'" style="background:linear-gradient(135deg,#1f2da0,#2f54ff);border-radius:16px;padding:18px;margin-bottom:4px;text-align:center">'
        +'<div style="font-size:32px;margin-bottom:6px">'+(itin.flag||"✈️")+"</div>"
        +'<div style="font-family:\'Sora\',sans-serif;font-size:20px;font-weight:800;color:#fff">'+(itin.dest||"")+(itin.country?", "+itin.country:"")+"</div>"
        +'<div style="font-size:12px;color:rgba(255,255,255,.75);margin-top:6px;display:flex;justify-content:center;gap:12px;flex-wrap:wrap">'
        +"<span>📅 "+(itin.dur||"")+"</span><span>👥 "+(itin.trav||finalAdults+" pers.")+"</span>"
        +(itin.dep?"<span>🛫 Depuis "+itin.dep+"</span>":"")
        +(itin.budget&&itin.budget.total?"<span>💰 ~"+itin.budget.total+"€</span>":"")
        +"</div></div>";

      if (tP.recap) html += '<div style="background:#f5f3ff;border:1.5px solid #ddd6fe;border-radius:12px;padding:10px 14px;margin-top:8px;font-size:12px;color:#5b21b6;font-weight:600">🔎 '+tP.recap+"</div>";

      // Vols
      if (itin.flights&&itin.flights.out) {
        const f = itin.flights;
        const sky = skyscannerLink(f.out.from||itin.dep||infos.ville_depart||"",f.out.to||itin.dest||"",finalCi,finalCo,finalAdults);
        html += '<div style="font-size:12px;font-weight:800;color:#0e1430;margin:14px 0 6px">✈️ Vols recommandés</div>'
          +'<div style="background:#fff;border:1.5px solid #e6ebf7;border-radius:14px;overflow:hidden">'
          +'<div style="padding:12px 14px;border-bottom:1px solid #f0f4ff"><div style="display:flex;justify-content:space-between;align-items:center">'
          +'<div><div style="font-size:10px;font-weight:800;color:#7c89a8;text-transform:uppercase">Aller'+(finalCi?" · "+finalCi:"")+"</div>"
          +'<div style="font-size:13px;font-weight:700;color:#0e1430;margin-top:2px">'+(f.out.from||"")+" → "+(f.out.to||"")+"</div>"
          +'<div style="font-size:11px;color:#7c89a8">'+(f.out.co||"")+" · "+(f.out.dur||"")+"</div></div>"
          +'<div style="text-align:right"><div style="font-size:16px;font-weight:900;color:#2f54ff">~'+(f.out.price||"?")+"€</div><div style='font-size:10px;color:#7c89a8'>/pers.</div></div></div></div>"
          +(f.ret?'<div style="padding:12px 14px"><div style="display:flex;justify-content:space-between;align-items:center">'
            +'<div><div style="font-size:10px;font-weight:800;color:#7c89a8;text-transform:uppercase">Retour'+(finalCo?" · "+finalCo:"")+"</div>"
            +'<div style="font-size:13px;font-weight:700;color:#0e1430;margin-top:2px">'+(f.ret.from||"")+" → "+(f.ret.to||"")+"</div>"
            +'<div style="font-size:11px;color:#7c89a8">'+(f.ret.co||"")+" · "+(f.ret.dur||"")+"</div></div>"
            +'<div style="text-align:right"><div style="font-size:16px;font-weight:900;color:#2f54ff">~'+(f.ret.price||"?")+"€</div><div style='font-size:10px;color:#7c89a8'>/pers.</div></div></div></div>":"")
          +"</div>"
          +'<a href="'+sky+'" target="_blank" style="display:flex;align-items:center;justify-content:center;gap:8px;background:linear-gradient(135deg,#0e1430,#1f2da0);color:#fff;text-decoration:none;border-radius:12px;padding:12px;font-size:13px;font-weight:700;margin-top:6px">🔍 Voir ces vols sur Skyscanner →</a>';
      }

      // Hôtels — Hotellook API (vrais prix) + Booking fallback
      const realHotels = await fetchHotelPrices(itin.dest||"",finalCi,finalCo,finalAdults);
      const hasReal = !!(realHotels&&realHotels.length);
      const hotelsShow = hasReal ? realHotels : (itin.hotels||[]).map(function(h,i){
        return {
          name:h.name, stars:h.stars||3, price:null, loc:h.loc||itin.dest, hl:h.hl,
          cat:["budget","confort","luxe"][i]||h.cat||"confort",
          // Lien Booking avec filtre étoiles selon catégorie
          url: bookingLink(itin.dest||"",finalCi,finalCo,finalAdults, i===0?"budget":i===1?"confort":"luxe")
        };
      });

      html += '<div style="font-size:12px;font-weight:800;color:#0e1430;margin:16px 0 6px">🏨 Hébergements · '
        +(hasReal?'<span style="color:#16a34a;font-size:11px">Prix réels Bookingok ✓</span>':'<span style="color:#7c89a8;font-size:11px">Comparez les prix ci-dessous</span>')+"</div>";

      const htPrices = [];
      for (const h of hotelsShow) {
        if (h.price) htPrices.push(h.price);
        const hLink = h.url||bookingLink(itin.dest||"",finalCi,finalCo,finalAdults,null);
        html += cardHotel({name:h.name,stars:h.stars,price:h.price?String(h.price):null,priceReal:hasReal&&!!h.price,loc:h.loc||itin.dest,hl:h.hl,cat:h.cat}, hLink);
      }

      // Boutons voir plus : Booking + Expedia
      const htMin = htPrices.length?Math.max(0,Math.min.apply(null,htPrices)-20):null;
      const htMax = htPrices.length?Math.max.apply(null,htPrices)+50:null;
      html += '<div style="font-size:11px;color:#7c89a8;font-weight:600;margin:10px 0 4px">🔍 Voir plus d'hôtels :</div>'
        +'<div style="display:flex;gap:8px">'
        +'<a href="'+bookingLink(itin.dest||"",finalCi,finalCo,finalAdults,null)+'" target="_blank" style="flex:1;display:flex;justify-content:center;align-items:center;background:linear-gradient(135deg,#003580,#0071c2);color:#fff;text-decoration:none;border-radius:12px;padding:10px;font-size:11px;font-weight:700">🏨 Booking.com</a>'
        +'<a href="'+expediaLink(itin.dest||"",finalCi,finalCo,finalAdults)+'" target="_blank" style="flex:1;display:flex;justify-content:center;align-items:center;background:linear-gradient(135deg,#00355f,#00a0e3);color:#fff;text-decoration:none;border-radius:12px;padding:10px;font-size:11px;font-weight:700">✈️ Expedia.fr</a>'
        +"</div>";

      // GetTransfer — transfert aéroport
      if (finalCi) {
        html += '<a href="'+getTransferLink(itin.dest||"",finalCi)+'" target="_blank" style="display:flex;align-items:center;justify-content:center;gap:8px;background:linear-gradient(135deg,#1a1a2e,#e94560);color:#fff;text-decoration:none;border-radius:12px;padding:11px;margin-top:8px;font-size:12px;font-weight:700">🚗 Réserver son transfert aéroport · GetTransfer →</a>';
      }

      // Programme jour par jour
      if (itin.days&&itin.days.length) {
        html += '<div style="font-size:12px;font-weight:800;color:#0e1430;margin:16px 0 6px">📅 Programme jour par jour</div>';
        for (const d of itin.days) html += cardDay(d);
      }

      if (itin.budget) html += cardBudget(itin.budget);
      if (itin.tips&&itin.tips.length) html += cardTips(itin.tips);

      // Wishlist + Export
      const wData = JSON.stringify({
        type:"voyage",
        name:(itin.flag||"✈️")+" "+(itin.dest||"")+(itin.country?", "+itin.country:""),
        subtitle:(itin.dur||"")+" · "+(itin.trav||finalAdults+" pers.")+" · "+(itin.style||""),
        price:itin.budget&&itin.budget.total?String(itin.budget.total)+"€":"",
        store:"booking",
        url:bookingLink(itin.dest||"",finalCi,finalCo,finalAdults,null),
        flightUrl:itin.flights&&itin.flights.out?skyscannerLink(itin.flights.out.from||"",itin.flights.out.to||"",finalCi,finalCo,finalAdults):"",
        hotels:(itin.hotels||[]).slice(0,3).map(function(h,i){
          return {name:h.name||"",cat:["budget","confort","luxe"][i]||"confort",url:bookingLink(itin.dest||"",finalCi,finalCo,finalAdults,null)};
        }),
        budget:itin.budget||null
      }).replace(/"/g,"&quot;");

      html += '<div style="display:flex;gap:8px;margin-top:12px">'
        +'<button onclick="addToWishlist('+wData+')" style="flex:1;background:linear-gradient(135deg,#1f2da0,#2f54ff);border:none;color:#fff;border-radius:12px;padding:12px;font-weight:700;font-size:13px;cursor:pointer;font-family:inherit">♡ Sauvegarder</button>'
        +'<button onclick="exportItinerary(\''+itinId+'\')" style="background:#f5f7ff;border:1.5px solid #c7d2fe;color:#3b5bdb;border-radius:12px;padding:12px;font-weight:700;font-size:13px;cursor:pointer;font-family:inherit">⬇️ Exporter</button>'
        +"</div>";

      if (body.trackingEnabled) sbFetch("searches","POST",{query:"[VOYAGE] "+message,session_id:sid,user_id:body.userId||null}).catch(()=>{});
      return new Response(JSON.stringify({reply:html,sessionId:sid}),{headers:H});
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  MODE PRODUIT — Groq décide, Groq DeepSearch cherche, Claude si premium
    // ══════════════════════════════════════════════════════════════════════════

    // Groq lit la conversation et décide
    // Groq lit toute la conversation et décide intelligemment
    // Philosophie : chercher VITE plutôt que poser des questions inutiles
    const groqProdPrompt = "Tu es l'assistant shopping Huntify. Analyse et agis.
"
      +"Historique complet:
"+histS+"
"
      +"Message: "+message+"

"
      +"REGLE D OR: si tu comprends ce que l utilisateur cherche → ready:true IMMEDIATEMENT.
"
      +"Un nom de produit seul (mascara, casque, iPhone...) suffit pour chercher.
"
      +"Le budget est optionnel — cherche sans si l utilisateur ne l a pas donne.

"
      +"Pose UNE question SEULEMENT si:
"
      +"- La demande est vraiment incomprehensible (exemple: 'un truc' sans contexte)
"
      +"- L historique montre deja une question posee → ready:true OBLIGATOIRE maintenant

"
      +"NE JAMAIS demander: packaging, couleur, marque exacte, caracteristiques techniques.
"
      +"Si budget mentionné dans l historique → l integrer dans le recap.

"
      +"JSON: {ready:true, recap:'produit + budget si connu + criteres utiles'} ou {ready:false, msg:'question tres courte'}";

    const prodDecision = parseJSON(
      await groq(groqProdPrompt, message, 250)
      || await gemini(groqProdPrompt+"
"+message, 250)
      || "{}"
    );

    // Si Groq hésite ou ne répond pas → on cherche directement sans question
    if (!prodDecision.ready && prodDecision.msg && history.length === 0) {
      return new Response(JSON.stringify({reply:'<div style="font-size:13.5px;color:#1e293b;line-height:1.6;padding:4px 0">'+prodDecision.msg+"</div>",sessionId:sid}),{headers:H});
    }

    const recap = (prodDecision.ready&&prodDecision.recap) ? prodDecision.recap : (formatHistory(history,300)+" "+message).trim();
    const dbCtx = await dbLookup(recap);
    const budgetNum = parseInt(((recap+" "+histS).match(/(\d+)\s*(?:€|euros?)/i)||[0,"0"])[1])||0;
    const isPremium = budgetNum>=150||/cadeau|premium|luxe|meilleur/.test(recap.toLowerCase());

    // Prompt commun pour Groq et Claude
    const searchPrompt = "Agent shopping Huntify. Recherche: "+recap+"\n"
      +(dbCtx?"Données internes: "+dbCtx+"\n":"")
      +"Trouve 2 produits sur amazon.fr + 1 sur fr.shopping.rakuten.com.\n"
      +"Pour Amazon: cherche la vraie page produit et copie l URL exacte (https://www.amazon.fr/dp/BASIN).\n"
      +"Si ASIN introuvable → url:null.\n"
      +"JSON: summary, products[name, price, store, keywords, url, badge], promoCodes.\n"
      +"JSON uniquement.";

    // ── STRATÉGIE DE RECHERCHE ────────────────────────────────────────────────
    // 1. Groq DeepSearch (gratuit) — cherche produits + ASINs sur le web
    let raw = await groqSearch(searchPrompt, 1000);
    let products = parseJSON(raw||"").products||[];

    // 2. Vérifie si les ASINs Amazon retournés sont valides
    const hasValidAsin = products.some(p =>
      p.store==="amazon" && p.url && /\/dp\/B[A-Z0-9]{9}/.test(p.url)
    );

    // 3. Si pas d ASIN valide → Claude + web_search pour trouver les vrais ASINs
    if (!hasValidAsin) {
      const claudeRaw = await claude(
        searchPrompt,
        "Cherche sur amazon.fr: "+recap+". Trouve les vrais ASINs.",
        800,
        [{type:"web_search_20250305",name:"web_search",max_uses:3}]
      );
      if (claudeRaw) {
        const claudeProducts = parseJSON(claudeRaw).products||[];
        // Merge : garde les produits Claude si meilleurs ASINs
        if (claudeProducts.some(p=>p.store==="amazon"&&p.url&&/\/dp\/B[A-Z0-9]{9}/.test(p.url))) {
          products = claudeProducts;
          raw = claudeRaw;
        }
      }
    }

    // 4. Fallback final si tout échoue
    if (!products.length) {
      const fallbackRaw = await gemini(searchPrompt, 800) || await freeAI("Reponds en JSON.", searchPrompt, 700);
      products = parseJSON(fallbackRaw||"").products||[];
      if (!raw) raw = fallbackRaw;
    }

    const parsed = parseJSON(raw||"");
    if (!products.length) products = parsed.products||[];
    const summary = parsed.summary||'Voici mes sélections pour "'+message+'" :';
    const promos  = parsed.promoCodes||[];

    // Garantit Amazon + Rakuten
    if (!products.some(p=>(p.store||"").includes("amazon"))) {
      products.unshift({name:recap,price:"Voir prix",store:"amazon",keywords:recap,url:null,badge:"Bestseller"});
    }
    if (!products.some(p=>(p.store||"").includes("rakuten"))) {
      products.push({name:recap,price:"Voir prix",store:"rakuten",keywords:recap,url:null,badge:"Bon plan"});
    }

    let buttons = "";
    for (const pr of products.slice(0,4)) {
      if (!pr.name) continue;
      let adv = findAdv(advertisers, pr.store);
      if (!adv) {
        if ((pr.store||"").includes("amazon"))  adv={slug:"amazon", name:"Amazon", emoji:"🛒",color:"#e47911",active:true};
        else if ((pr.store||"").includes("rakuten")) adv={slug:"rakuten",name:"Rakuten",emoji:"🛍️",color:"#bf0000",active:true,awin_mid:RAKUTEN_MID};
        else continue;
      }
      const rawUrl = (pr.url&&pr.url!=="null"&&pr.url.length>15)?pr.url:null;
      const url = buildLink(adv, pr.name.length>5?pr.name:(pr.keywords||pr.name), rawUrl);
      if (!url) continue;
      buttons += cardProduct(pr.name, pr.price||"Voir prix", url, adv, pr.img||null, pr.badge||null);
    }

    let promoHtml = "";
    for (const c of promos.filter(c=>c.code).sort((a,b)=>(b.best?1:0)-(a.best?1:0)).slice(0,2)) {
      promoHtml += promoBox(c.code,c.store||"boutique",c.discount||"Réduction",c.best||false);
    }

    const first = products.find(p=>(p.store||"").includes("amazon"))||products[0];
    let wishHtml = "";
    if (first) {
      const adv0 = findAdv(advertisers,first.store)||{slug:"amazon",name:"Amazon",color:"#e47911",active:true};
      const wUrl = buildLink(adv0,first.keywords||first.name,first.url||null)||"";
      const wD = JSON.stringify({type:"product",name:first.name,price:first.price,store:first.store,url:wUrl}).replace(/"/g,"&quot;");
      wishHtml = '<button onclick="addToWishlist('+wD+')" style="background:#fff;border:1.5px solid #e8edf8;color:#3b5bdb;border-radius:12px;padding:8px 16px;margin-top:10px;font-weight:700;font-size:12px;cursor:pointer;font-family:inherit;width:100%">♡ Ajouter à ma wishlist</button>';
    }

    return new Response(JSON.stringify({
      reply:'<div style="font-size:13.5px;color:#1e293b;margin-bottom:8px;font-weight:500;line-height:1.5">'+summary+"</div>"
        +buttons+(promoHtml?'<div style="margin-top:4px">'+promoHtml+"</div>":"")+wishHtml,
      sessionId:sid
    }),{headers:H});

  } catch(err) {
    console.error("Huntify error:", err&&err.message);
    return new Response(JSON.stringify({reply:'<div style="font-size:13px;color:#1e293b">Désolé, problème momentané. Réessayez !</div>'}),{status:200,headers:{"Content-Type":"application/json; charset=utf-8","Access-Control-Allow-Origin":"*"}});
  }
}
