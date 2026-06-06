export const config = { runtime: 'edge' };

// ─────────────────────────────────────────────────────────────────────────────
// HUNTIFY — Agent IA shopping + voyage v3
// Cascade IA intelligente : Groq DeepSearch → Gemini → Mistral → DeepSeek → Claude
// Affiliation : Amazon · Rakuten · Booking (TP) · Expedia (TP) · GetTransfer · Skyscanner
// ─────────────────────────────────────────────────────────────────────────────

const SUPABASE_URL = "https://enocxbrqyybendertytl.supabase.co";
const SUPABASE_KEY = "sb_publishable_NmPh--frZG5HuqfaoxnemA_E7cidV9Y";
const AMAZON_TAG   = "huntify21-21";
const AWIN_PUB     = "2920215";
const RAKUTEN_MID  = "55615";
const TP_MARKER    = "536663";
const MODEL        = "claude-haiku-4-5";

// ── Travelpayouts programme IDs (a remplacer quand approuves) ──────────────
// En attendant : redirect Travelpayouts universel avec marker
// Format final : "https://tp.media/r?marker=536663&trs=XXX&p=PROGRAMME_ID&u=URL"
// Booking programme ID TP = 257 (global), Expedia = 2041
const TP_BOOKING_PID  = "257";
const TP_EXPEDIA_PID  = "2041";

const IATA = {
  paris:"CDG",lyon:"LYS",marseille:"MRS",nice:"NCE",bordeaux:"BOD",toulouse:"TLS",
  nantes:"NTE",strasbourg:"SXB",montpellier:"MPL",rennes:"RNS",lille:"LIL",
  rome:"FCO",milan:"MXP",venise:"VCE",naples:"NAP",florence:"FLR",
  barcelone:"BCN",madrid:"MAD",ibiza:"IBZ",majorque:"PMI",seville:"SVQ",malaga:"AGP",
  lisbonne:"LIS",porto:"OPO",faro:"FAO",
  londres:"LHR",manchester:"MAN",edimbourg:"EDI",
  amsterdam:"AMS",bruxelles:"BRU",zurich:"ZRH",geneve:"GVA",vienne:"VIE",
  berlin:"BER",munich:"MUC",francfort:"FRA",hambourg:"HAM",
  prague:"PRG",budapest:"BUD",varsovie:"WAW",cracovie:"KRK",
  athenes:"ATH",santorin:"JTR",mykonos:"JMK",crete:"HER",rhodes:"RHO",
  marrakech:"RAK",casablanca:"CMN",agadir:"AGA",tunis:"TUN",djerba:"DJE",
  istanbul:"IST",antalya:"AYT",hurghada:"HRG",
  dubai:"DXB","abu dhabi":"AUH",doha:"DOH",
  tokyo:"NRT",osaka:"KIX",bangkok:"BKK",singapour:"SIN",bali:"DPS",
  "kuala lumpur":"KUL","new york":"JFK","los angeles":"LAX",miami:"MIA",
  montreal:"YUL",cancun:"CUN",maldives:"MLE",maurice:"MRU",reunion:"RUN",
  phuket:"HKT",hongkong:"HKG",seoul:"ICN",pekin:"PEK",shanghai:"PVG",
  sydney:"SYD",melbourne:"MEL"
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
  const opts = {
    method,
    headers:{"Content-Type":"application/json","apikey":SUPABASE_KEY,"Authorization":"Bearer "+SUPABASE_KEY}
  };
  if (body) opts.body = JSON.stringify(body);
  try {
    const r = await fetch(SUPABASE_URL+"/rest/v1/"+path, opts);
    return await r.json();
  } catch(e) { return null; }
}

async function getAdvertisers() {
  try {
    const r = await fetch(SUPABASE_URL+"/rest/v1/advertisers?active=eq.true", {
      headers:{"apikey":SUPABASE_KEY,"Authorization":"Bearer "+SUPABASE_KEY}
    });
    const d = await r.json();
    return Array.isArray(d)?d:[];
  } catch(e) { return []; }
}

// ── LIENS AFFILIATION ─────────────────────────────────────────────────────────
function cleanKw(kw) {
  if (!kw) return "";
  const stop = new Set(["la","le","les","un","une","des","avec","et","en","du","au","aux","pour","sur","de"]);
  return kw.replace(/,/g," ").replace(/\s+/g," ").trim()
    .split(" ").filter(function(w){return w.length>1&&!stop.has(w.toLowerCase());}).slice(0,7).join(" ");
}

function buildLink(adv, keywords, directUrl) {
  if (!adv||!adv.active) return null;
  const kw = cleanKw(keywords);
  if (adv.slug==="amazon") {
    const tag = adv.amazon_tag||AMAZON_TAG;
    const asinMatch = directUrl&&directUrl.match(/\/dp\/([A-Z0-9]{10})(?:[/?]|$)/);
    const isRealAsin = asinMatch&&/^B[A-Z0-9]{9}$/.test(asinMatch[1]);
    const base = isRealAsin
      ? "https://www.amazon.fr/dp/"+asinMatch[1]
      : "https://www.amazon.fr/s?k="+encodeURIComponent(kw);
    return base+"?tag="+tag;
  }
  if (adv.slug==="rakuten") {
    const mid = adv.awin_mid||RAKUTEN_MID;
    const aff = adv.awin_affid||adv.awin_aff||AWIN_PUB;
    const searchUrl = "https://fr.shopping.rakuten.com/s/"+encodeURIComponent(kw.replace(/\s+/g,"+"));
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
  return (advertisers||[]).find(function(a){return a.slug===(slug||"").toLowerCase();})||null;
}

// ── TRAVELPAYOUTS — LIENS AFFILIES CORRECTS ───────────────────────────────────
// tp.media/r = redirecteur universel TP avec tracking marker
// Booking.com programme 257 = partenaire global Travelpayouts
// Expedia programme 2041 = partenaire TP
// Ces liens trackent les conversions meme sans approbation formelle dans certains cas
// Sinon : fallback lien direct en attendant approbation

function bookingTPLink(dest, ci, co, adults, cat) {
  const rooms = Math.ceil((adults||2)/2);
  let destUrl = "https://www.booking.com/searchresults.html"
    +"?ss="+encodeURIComponent(dest||"")
    +"&group_adults="+(adults||2)
    +"&no_rooms="+rooms
    +"&lang=fr&selected_currency=EUR";
  if (ci) destUrl += "&checkin="+ci;
  if (co) destUrl += "&checkout="+co;
  if (cat==="budget")  destUrl += "&nflt=class%3D2%3Bclass%3D3";
  if (cat==="confort") destUrl += "&nflt=class%3D3%3Bclass%3D4";
  if (cat==="luxe")    destUrl += "&nflt=class%3D4%3Bclass%3D5";
  destUrl += "&aid=304142";
  // Wrapper TP universel — commissions trackes via marker 536663
  return "https://tp.media/r?marker="+TP_MARKER
    +"&trs=233738&p="+TP_BOOKING_PID
    +"&u="+encodeURIComponent(destUrl);
}

function expediaTPLink(dest, ci, co, adults) {
  let destUrl = "https://www.expedia.fr/Hotel-Search"
    +"?destination="+encodeURIComponent(dest||"")
    +"&adults="+(adults||2)
    +"&sort=RECOMMENDED";
  if (ci) destUrl += "&startDate="+ci;
  if (co) destUrl += "&endDate="+co;
  // Wrapper TP universel pour Expedia
  return "https://tp.media/r?marker="+TP_MARKER
    +"&trs=233738&p="+TP_EXPEDIA_PID
    +"&u="+encodeURIComponent(destUrl);
}

function skyscannerLink(from, to, ci, co, adults) {
  const f = (toIATA(from)||"par").toLowerCase();
  const t = (toIATA(to)||"xxx").toLowerCase();
  const fmt = function(d){return d?d.replace(/-/g,"").slice(2):null;};
  const out = fmt(ci), ret = fmt(co);
  const base = "https://www.skyscanner.fr/transport/vols/"+f+"/"+t+"/";
  if (out&&ret) return base+out+"/"+ret+"/?adults="+(adults||2)+"&currency=EUR";
  if (out) return base+out+"/?adults="+(adults||2)+"&currency=EUR";
  return base;
}

function getTransferLink(dest, ci) {
  const base = "https://gettransfer.tpk.mx/vMnVrFfO";
  if (dest) return base+"?to="+encodeURIComponent(dest)+(ci?"&date="+ci:"");
  return base;
}

// ── TRAVELPAYOUTS API PRIX HOTELS ─────────────────────────────────────────────
async function fetchHotelPrices(dest, ci, co, adults) {
  const token = process.env.TRAVELPAYOUTS_TOKEN;
  if (!token||!ci||!co||!dest) return null;
  try {
    const url = "https://engine.hotellook.com/api/v2/cache.json"
      +"?location="+encodeURIComponent(dest)
      +"&checkIn="+ci+"&checkOut="+co
      +"&adultsCount="+(adults||2)
      +"&currency=EUR&token="+token+"&limit=30";
    const r = await fetch(url, {headers:{"Accept":"application/json"}});
    if (!r.ok) return null;
    const data = await r.json();
    if (!Array.isArray(data)||data.length<2) return null;
    const valid = data
      .filter(function(h){return h.priceFrom&&(h.hotelName||h.name)&&h.id;})
      .map(function(h){return {
        name:  h.hotelName||h.name,
        stars: Math.round(h.stars||3),
        price: Math.round(h.priceFrom),
        loc:   (h.location&&h.location.name)||dest,
        url:   bookingTPLink(h.hotelName||h.name, ci, co, adults, null)
      };})
      .sort(function(a,b){return a.price-b.price;});
    if (valid.length<2) return null;
    const t = Math.max(1,Math.floor(valid.length/3));
    const mid = function(arr){return arr[Math.floor(arr.length/2)];};
    return [
      Object.assign({},mid(valid.slice(0,t)),   {cat:"budget",  hl:"Meilleur rapport qualite/prix"}),
      Object.assign({},mid(valid.slice(t,t*2)), {cat:"confort", hl:"Confort et emplacement ideal"}),
      Object.assign({},mid(valid.slice(-t)),    {cat:"luxe",    hl:"Experience premium"}),
    ];
  } catch(e) { return null; }
}

// ── DATE PARSER ───────────────────────────────────────────────────────────────
function parseDate(str) {
  if (!str) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  const now = new Date();
  const addDays = function(n){const d=new Date(now);d.setDate(d.getDate()+n);return d.toISOString().slice(0,10);};
  const s = str.toLowerCase().trim();
  if (s==="demain") return addDays(1);
  if (/apres.?demain/.test(s)) return addDays(2);
  if (/semaine prochaine/.test(s)) return addDays(7);
  const slash = str.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (slash) {
    const y = slash[3].length===2?"20"+slash[3]:slash[3];
    return y+"-"+slash[2].padStart(2,"0")+"-"+slash[1].padStart(2,"0");
  }
  const MONTHS = {
    jan:1,janv:1,fev:2,fevr:2,mar:3,mars:3,avr:4,avril:4,
    mai:5,juin:6,juil:7,juillet:7,aout:8,sep:9,sept:9,oct:10,nov:11,dec:12
  };
  const mn = s.match(/(\d{1,2})\s+([a-z\u00e9\u00fb\u00f4\u00e0]+)(?:\s+(\d{4}))?/);
  if (mn) {
    const mo = Object.entries(MONTHS).find(function(e){return mn[2].startsWith(e[0]);});
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
  return ((history||[]).map(function(m){
    const who = m.role==="user"?"Vous":"Huntify";
    const text = (m.content||"").replace(/<[^>]*>/g," ").replace(/\s+/g," ").trim().slice(0,400);
    return text?who+" : "+text:null;
  }).filter(Boolean).join("\n")).slice(0,maxLen||2500);
}

// ── APPELS IA — CASCADE COMPLETE ──────────────────────────────────────────────
async function groq(sys, user, maxTok) {
  const key = process.env.GROQ_API_KEY;
  if (!key) return null;
  try {
    const r = await fetch("https://api.groq.com/openai/v1/chat/completions",{
      method:"POST",
      headers:{"Content-Type":"application/json","Authorization":"Bearer "+key},
      body:JSON.stringify({
        model:"llama-3.3-70b-versatile",
        max_tokens:maxTok||600,
        temperature:0.3,
        messages:[{role:"system",content:sys},{role:"user",content:user}]
      })
    });
    if (!r.ok) return null;
    const d = await r.json();
    return d.choices&&d.choices[0]?d.choices[0].message.content:null;
  } catch(e){return null;}
}

async function groqSearch(prompt, maxTok) {
  const key = process.env.GROQ_API_KEY;
  if (!key) return null;
  try {
    const r = await fetch("https://api.groq.com/openai/v1/chat/completions",{
      method:"POST",
      headers:{"Content-Type":"application/json","Authorization":"Bearer "+key},
      body:JSON.stringify({
        model:"compound-beta",
        max_tokens:maxTok||1500,
        messages:[{role:"user",content:prompt}]
      })
    });
    if (!r.ok) return await groq("Tu es un expert. Reponds en JSON valide uniquement.",prompt,maxTok||1500);
    const d = await r.json();
    return d.choices&&d.choices[0]?d.choices[0].message.content:null;
  } catch(e){
    return await groq("Tu es un expert. Reponds en JSON valide uniquement.",prompt,maxTok||1500);
  }
}

async function gemini(prompt, maxTok) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  try {
    const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key="+key,{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({
        contents:[{parts:[{text:prompt}]}],
        generationConfig:{maxOutputTokens:maxTok||600,temperature:0.3}
      })
    });
    if (!r.ok) return null;
    const d = await r.json();
    return d.candidates&&d.candidates[0]&&d.candidates[0].content?d.candidates[0].content.parts[0].text:null;
  } catch(e){return null;}
}

async function mistral(sys, user, maxTok) {
  const key = process.env.MISTRAL_API_KEY;
  if (!key) return null;
  try {
    const r = await fetch("https://api.mistral.ai/v1/chat/completions",{
      method:"POST",
      headers:{"Content-Type":"application/json","Authorization":"Bearer "+key},
      body:JSON.stringify({
        model:"mistral-small-latest",
        max_tokens:maxTok||600,
        temperature:0.3,
        messages:[{role:"system",content:sys},{role:"user",content:user}]
      })
    });
    if (!r.ok) return null;
    const d = await r.json();
    return d.choices&&d.choices[0]?d.choices[0].message.content:null;
  } catch(e){return null;}
}

async function deepseek(sys, user, maxTok) {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) return null;
  try {
    const r = await fetch("https://api.deepseek.com/v1/chat/completions",{
      method:"POST",
      headers:{"Content-Type":"application/json","Authorization":"Bearer "+key},
      body:JSON.stringify({
        model:"deepseek-chat",
        max_tokens:maxTok||600,
        temperature:0.3,
        messages:[{role:"system",content:sys},{role:"user",content:user}]
      })
    });
    if (!r.ok) return null;
    const d = await r.json();
    return d.choices&&d.choices[0]?d.choices[0].message.content:null;
  } catch(e){return null;}
}

async function freeAI(sys, user, maxTok) {
  // Cascade complete par cout croissant
  return await groq(sys,user,maxTok)
      || await gemini(sys+"\n\n"+user, maxTok)
      || await mistral(sys,user,maxTok)
      || await deepseek(sys,user,maxTok);
}

async function claude(sys, user, maxTok, tools) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  try {
    const payload = {
      model:MODEL,
      max_tokens:maxTok||1000,
      system:sys,
      messages:[{role:"user",content:user}]
    };
    if (tools&&tools.length) payload.tools = tools;
    const r = await fetch("https://api.anthropic.com/v1/messages",{
      method:"POST",
      headers:{
        "Content-Type":"application/json; charset=utf-8",
        "x-api-key":key,
        "anthropic-version":"2023-06-01"
      },
      body:JSON.stringify(payload)
    });
    const d = await r.json();
    if (!r.ok) return null;
    let t="";
    for(const b of (d.content||[])){if(b.type==="text")t+=b.text;}
    return t||null;
  } catch(e){return null;}
}

function parseJSON(raw) {
  if (!raw) return {};
  try {
    const m = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if(m) return JSON.parse(m[1].trim());
  } catch(e){}
  try {
    const m = raw.match(/\{[\s\S]*\}/);
    if(m) return JSON.parse(m[0]);
  } catch(e){}
  return {};
}

async function dbLookup(kw) {
  const k = (kw||"").toLowerCase().split(" ")[0];
  try {
    const [deals,prices,promos] = await Promise.all([
      sbFetch("daily_deals?name=ilike.*"+encodeURIComponent(k)+"*&limit=3"),
      sbFetch("price_history?product_name=ilike.*"+encodeURIComponent(k)+"*&order=checked_at.desc&limit=5"),
      sbFetch("promo_codes?valid=eq.true&order=found_at.desc&limit=2")
    ]);
    const parts = [];
    if(deals&&deals.length)  parts.push("Deals: "+deals.map(function(x){return x.name+" "+x.price+"EUR";}).join(" | "));
    if(prices&&prices.length) parts.push("Prix: "+prices.map(function(x){return x.product_name+" "+x.price+"EUR";}).join(" | "));
    if(promos&&promos.length) parts.push("Codes: "+promos.map(function(x){return x.code+" ("+x.store+")";}).join(" | "));
    return parts.join("\n");
  } catch(e){return "";}
}

// ── COMPOSANTS HTML ───────────────────────────────────────────────────────────
function cardProduct(name, price, url, adv, img, badge) {
  const imgH = img?'<img src="'+img+'" style="width:56px;height:56px;object-fit:cover;border-radius:8px;flex-shrink:0" onerror="this.style.display=\'none\'">':'';
  const pill = '<span style="background:rgba(255,255,255,.2);border-radius:100px;padding:2px 10px;font-size:10px;font-weight:800">'+(adv.emoji||"\uD83D\uDECD\uFE0F")+" "+adv.name+"</span>";
  return '<a href="'+url+'" target="_blank" rel="sponsored noopener" style="display:flex;align-items:center;gap:12px;background:'+(adv.color||"#2f54ff")+';color:#fff;text-decoration:none;border-radius:14px;padding:12px 14px;margin-top:8px">'
    +imgH+'<div style="flex:1;min-width:0">'
    +'<div style="font-size:10px;margin-bottom:4px;opacity:.85">'+pill+(badge?" \u00B7 "+badge:"")+"</div>"
    +'<div style="font-size:13px;font-weight:800;line-height:1.3;word-break:break-word">'+name+"</div></div>"
    +'<span style="background:rgba(255,255,255,.22);border-radius:8px;padding:5px 10px;white-space:nowrap;font-size:14px;font-weight:900;flex-shrink:0">'+(price||"Voir prix")+"</span></a>";
}

function promoBox(code, store, desc, best) {
  return '<div style="background:'+(best?"#dcfce7":"#f0fdf4")+';border:'+(best?"2px solid #16a34a":"1.5px solid #86efac")+';border-radius:12px;padding:10px 14px;margin-top:6px;display:flex;align-items:center;justify-content:space-between;gap:8px">'
    +'<div><span style="font-size:11px;color:#16a34a;font-weight:700">'+(best?"\u2B50 MEILLEUR \u2014 ":"")+"\uD83C\uDFF7\uFE0F "+store+"</span>"
    +'<div style="font-size:12px;color:#166534;font-weight:600">'+desc+"</div></div>"
    +'<div onclick="navigator.clipboard.writeText(\''+code+'\');this.innerHTML=\'&#10003;\';setTimeout(()=>this.innerHTML=\''+code+'\',2000)" style="background:#16a34a;color:#fff;border-radius:8px;padding:6px 10px;font-weight:800;font-size:12px;cursor:pointer;white-space:nowrap;flex-shrink:0">'+code+"</div></div>";
}

function cardHotel(h, link) {
  const stars = "\u2B50".repeat(Math.min(h.stars||3,5));
  const cc = {budget:"#16a34a",confort:"#2f54ff",luxe:"#7c3aed"}[h.cat]||"#2f54ff";
  const cl = {budget:"\uD83D\uDC9A Budget",confort:"\uD83D\uDC99 Confort",luxe:"\uD83D\uDC8E Luxe"}[h.cat]||"";
  const hasPrice = h.price&&h.priceReal;
  const priceDiv = hasPrice
    ? '<div style="background:linear-gradient(135deg,#16a34a,#15803d);color:#fff;border-radius:10px;padding:7px 11px;text-align:center;flex-shrink:0;margin-left:8px"><div style="font-size:9px;opacity:.85">Prix reel</div><div style="font-size:15px;font-weight:900">'+h.price+"EUR</div><div style='font-size:9px;opacity:.75'>/nuit</div></div>"
    : '<div style="background:linear-gradient(135deg,'+cc+','+cc+'cc);color:#fff;border-radius:10px;padding:8px 12px;text-align:center;flex-shrink:0;margin-left:8px;min-width:60px"><div style="font-size:10px">Voir prix</div><div style="font-size:12px;font-weight:800">\u2192</div></div>';
  return '<a href="'+link+'" target="_blank" rel="sponsored noopener" style="display:flex;flex-direction:column;background:#fff;border:1.5px solid '+(hasPrice?"#bbf7d0":"#e6ebf7")+';border-radius:14px;padding:13px;margin-top:8px;text-decoration:none;gap:5px">'
    +'<div style="display:flex;justify-content:space-between;align-items:flex-start">'
    +'<div style="flex:1">'+(cl?'<span style="background:#eff6ff;color:'+cc+';border-radius:100px;padding:2px 9px;font-size:10px;font-weight:800">'+cl+"</span>":"")
    +'<div style="font-size:13px;font-weight:800;color:#0e1430;margin-top:3px">'+h.name+"</div>"
    +'<div style="font-size:11px;color:#7c89a8">'+stars+" \u00B7 "+(h.loc||"")+"</div></div>"+priceDiv+"</div>"
    +(h.hl?'<div style="font-size:11px;color:'+cc+';font-weight:600;background:#eff6ff;border-radius:8px;padding:4px 10px">\u2728 '+h.hl+"</div>":"")
    +'<div style="background:'+(hasPrice?"#f0fdf4":"#f0f9ff")+';border-radius:8px;padding:6px 10px;font-size:11px;color:'+(hasPrice?"#15803d":"#0369a1")+';font-weight:600">'
    +(hasPrice?"\uD83D\uDFE2 Prix verifie \u00B7 Reserver sur Booking.com \u2192":"\uD83C\uDFE8 Voir disponibilites et prix \u2192")
    +"</div></a>";
}

function cardDay(d) {
  return '<div style="background:#fff;border:1.5px solid #e6ebf7;border-radius:14px;padding:14px;margin-top:9px">'
    +'<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">'
    +'<div style="background:linear-gradient(135deg,#2f54ff,#4a6bff);color:#fff;border-radius:8px;padding:4px 12px;font-size:12px;font-weight:800">Jour '+d.n+"</div>"
    +'<div style="font-size:12px;font-weight:700;color:#0e1430;flex:1;margin-left:8px">'+(d.title||"")+"</div>"
    +(d.budget?'<div style="font-size:11px;color:#16a34a;font-weight:700">~'+d.budget+"EUR</div>":"")
    +"</div>"
    +(d.am?'<div style="display:flex;gap:9px;margin-bottom:8px"><span>\uD83C\uDF05</span><div><div style="font-size:10px;font-weight:800;color:#94a3b8;text-transform:uppercase">Matin</div><div style="font-size:12px;color:#374151">'+d.am+"</div></div></div>":"")
    +(d.pm?'<div style="display:flex;gap:9px;margin-bottom:8px"><span>\u2600\uFE0F</span><div><div style="font-size:10px;font-weight:800;color:#94a3b8;text-transform:uppercase">Apres-midi</div><div style="font-size:12px;color:#374151">'+d.pm+"</div></div></div>":"")
    +(d.eve?'<div style="display:flex;gap:9px;margin-bottom:4px"><span>\uD83C\uDF19</span><div><div style="font-size:10px;font-weight:800;color:#94a3b8;text-transform:uppercase">Soiree</div><div style="font-size:12px;color:#374151">'+d.eve+"</div></div></div>":"")
    +(d.resto?'<div style="background:#f0fdf4;border-radius:9px;padding:7px 11px;margin-top:6px;display:flex;justify-content:space-between;align-items:center">'
      +'<div><div style="font-size:11px;color:#16a34a;font-weight:700">\uD83C\uDF7D\uFE0F '+d.resto.name+"</div>"
      +(d.resto.spec?'<div style="font-size:10px;color:#86efac">'+d.resto.spec+"</div>":"")
      +"</div>"+'<div style="font-size:12px;color:#16a34a;font-weight:800">'+d.resto.price+"</div></div>":"")
    +(d.acts&&d.acts.length?'<div style="margin-top:7px;display:flex;flex-wrap:wrap;gap:4px">'
      +d.acts.map(function(a){return '<span style="background:#eff6ff;color:#2f54ff;border-radius:100px;padding:2px 9px;font-size:10.5px;font-weight:600">'+a+"</span>";}).join("")
      +"</div>":"")
    +"</div>";
}

function cardBudget(b) {
  const rows = [
    ["\u2708\uFE0F Vols A/R", b.vols],
    ["\uD83C\uDFE8 Hebergement", b.hotel],
    ["\uD83C\uDFAF Activites", b.acts],
    ["\uD83C\uDF7D\uFE0F Restaurants", b.resto],
    ["\uD83D\uDE87 Transport local", b.transport]
  ].filter(function(r){return r[1]!=null;});
  return '<div style="background:linear-gradient(135deg,#0e1430,#1f2da0);border-radius:16px;padding:16px;margin-top:12px">'
    +'<div style="font-size:13px;font-weight:800;color:#fff;margin-bottom:12px">\uD83D\uDCB0 Budget total estime</div>'
    +rows.map(function(r){
      return '<div style="display:flex;justify-content:space-between;margin-bottom:7px">'
        +'<span style="font-size:12px;color:rgba(255,255,255,.75)">'+r[0]+"</span>"
        +'<span style="font-size:12px;font-weight:700;color:#fff">~'+r[1]+"EUR</span></div>";
    }).join("")
    +'<div style="border-top:1px solid rgba(255,255,255,.2);margin-top:10px;padding-top:10px;display:flex;justify-content:space-between">'
    +'<span style="font-size:13px;font-weight:800;color:#fff">TOTAL</span>'
    +'<span style="font-size:16px;font-weight:900;color:#bcd0ff">~'+(b.total||"")+"EUR</span></div>"
    +(b.pp?'<div style="font-size:11px;color:rgba(255,255,255,.6);text-align:right;margin-top:3px">soit ~'+b.pp+"EUR / personne</div>":"")
    +'<div style="font-size:10px;color:rgba(255,255,255,.4);margin-top:8px">Estimations basees sur les prix actuels du web. Cliquez les liens pour reserver.</div>'
    +"</div>";
}

function cardTips(tips) {
  if (!tips||!tips.length) return "";
  return '<div style="background:#f5f3ff;border:1.5px solid #ddd6fe;border-radius:14px;padding:14px;margin-top:10px">'
    +'<div style="font-size:12px;font-weight:800;color:#5b21b6;margin-bottom:8px">\uD83D\uDCA1 Conseils du guide local</div>'
    +tips.map(function(t){
      return '<div style="font-size:12px;color:#374151;margin-bottom:6px;padding-left:10px;border-left:3px solid #c4b5fd">'
        +t+"</div>";
    }).join("")+"</div>";
}

// ── HANDLER PRINCIPAL ─────────────────────────────────────────────────────────
export default async function handler(req) {
  if (req.method==="OPTIONS") return new Response(null,{
    status:204,
    headers:{
      "Access-Control-Allow-Origin":"*",
      "Access-Control-Allow-Methods":"POST,OPTIONS",
      "Access-Control-Allow-Headers":"Content-Type"
    }
  });
  if (req.method!=="POST") return new Response("Method not allowed",{status:405});

  const H = {"Content-Type":"application/json; charset=utf-8","Access-Control-Allow-Origin":"*"};

  try {
    const body = await req.json();
    const message    = body.message||"";
    const history    = body.history||[];
    const sid        = body.sessionId||("anon_"+Date.now());
    const isTravel   = body.mode==="travel";
    const today      = new Date().toISOString().slice(0,10);
    const advertisers = await getAdvertisers();

    if (body.trackingEnabled) {
      Promise.all([
        sbFetch("searches","POST",{query:message,session_id:sid,user_id:body.userId||null}),
        sbFetch("trends","POST",{query:message.toLowerCase().trim(),count:1,last_searched:new Date().toISOString()})
      ]).catch(function(){});
    }

    const hist  = formatHistory(history, 2500);
    const histS = formatHistory(history, 1200);

    // ══════════════════════════════════════════════════════════════════════════
    //  MODE VOYAGE
    // ══════════════════════════════════════════════════════════════════════════
    if (isTravel) {

      // ── DETECTION : l utilisateur veut des propositions ? ─────────────────
      const wantsSuggestions = /je ne sais pas|pas d.id[eé]e|propose[sz]?|suggestion|id[eé]e|surprise|tu choisis|choisis pour|qu est.ce que tu|recommande/i.test(message);
      const msgLower = (hist+" "+message).toLowerCase();

      // Extrait les infos deja connues de la conversation
      const knownInfos = parseJSON(
        await groq(
          "Lis cette conversation et extrais les infos voyage connues en JSON.\n"
          +"Reponds UNIQUEMENT en JSON : {ville_depart:string|null, checkin:string|null, checkout:string|null, duree:string|null, nb_adultes:number|null, budget:string|null, style:string|null, destination:string|null}\n"
          +"Si une info n est pas mentionnee, mets null. Dates au format YYYY-MM-DD si possible.",
          "Conversation :\n"+hist+"\nMessage : "+message,
          400
        ) || "{}"
      );

      // ── CAS 1 : l utilisateur veut des propositions → l IA choisit une destination ──
      if (wantsSuggestions || !knownInfos.destination) {
        const dep     = knownInfos.ville_depart||"France";
        const budget  = knownInfos.budget||"2000EUR";
        const ciK     = knownInfos.checkin||ci;
        const coK     = knownInfos.checkout||co;
        const dureeK  = knownInfos.duree||"4 jours";
        const styleK  = knownInfos.style||"romantique en amoureux";
        const adultK  = knownInfos.nb_adultes||2;

        // L IA choisit la meilleure destination selon le contexte et genere directement
        const propPrompt = "Tu es le conseiller voyage Huntify, passionne et expert.\n"
          +"Un couple part depuis "+dep+" pour un sejour "
          +(ciK?"du "+ciK+" au "+(coK||""):"de "+dureeK)
          +", budget "+budget+", style : "+styleK+".\n\n"
          +"Utilise tes capacites de recherche web pour :\n"
          +"1. Choisir LA meilleure destination depuis "+dep+" pour ce profil (accessible, pas chere en vol, romantique)\n"
          +"2. Verifier les vrais prix de vols depuis "+dep+" pour ces dates\n"
          +"3. Trouver de vrais hotels avec vrais prix\n"
          +"4. Trouver les meilleurs restaurants locaux avec vrais prix\n\n"
          +"Destinations ideales depuis "+dep+" avec budget "+budget+" : Lisbonne, Porto, Rome, Florence, Prague, Dubrovnik, Majorque, Santorin, Marrakech...\n"
          +"Choisis celle avec le meilleur rapport qualite/prix/romantisme pour les dates demandees.\n\n"
          +"Genere un JSON complet :\n"
          +"{\n"
          +"  t: 'i',\n"
          +"  recap: 'phrase enthousiaste expliquant pourquoi tu as choisi cette destination',\n"
          +"  itin: {\n"
          +"    dest:string, country:string, flag:string, dur:string, trav:string, style:string, dep:string,\n"
          +"    checkin:'YYYY-MM-DD', checkout:'YYYY-MM-DD', adults:number,\n"
          +"    flights:{ out:{from:string,to:string,price:number,co:string,dur:string}, ret:{from:string,to:string,price:number,co:string,dur:string} },\n"
          +"    hotels:[ {name:string,stars:number,price:number,loc:string,hl:string,cat:'budget'|'confort'|'luxe'} x3 ],\n"
          +"    days:[ {n:number,title:string,am:string,pm:string,eve:string,resto:{name:string,price:string,spec:string},acts:[string],budget:number} ],\n"
          +"    budget:{vols:number,hotel:number,acts:number,resto:number,transport:number,total:number,pp:number},\n"
          +"    tips:[4 conseils specifiques et pratiques]\n"
          +"  }\n"
          +"}\n"
          +"IATA : Paris=CDG, Marseille=MRS, Nice=NCE, Lyon=LYS, Bordeaux=BOD, Barcelone=BCN, "
          +"Rome=FCO, Florence=FLR, Lisbonne=LIS, Porto=OPO, Prague=PRG, Dubrovnik=DBV, "
          +"Majorque=PMI, Santorin=JTR, Marrakech=RAK, Amsterdam=AMS, Budapest=BUD.\n"
          +"JSON uniquement.";

        // Cascade DeepSeek prioritaire ici car meilleur en raisonnement multi-etapes
        let propRaw = await groqSearch(propPrompt, 4000);
        if (!propRaw || !parseJSON(propRaw).itin) propRaw = await deepseek("Tu es expert voyage. JSON uniquement.", propPrompt, 3500);
        if (!propRaw || !parseJSON(propRaw).itin) propRaw = await mistral("Tu es expert voyage. JSON uniquement.", propPrompt, 3000);
        if (!propRaw || !parseJSON(propRaw).itin) propRaw = await gemini("Tu es expert voyage. Reponds en JSON uniquement.\n\n"+propPrompt, 3000);
        if (!propRaw || !parseJSON(propRaw).itin) propRaw = await claude("Tu es expert voyage. JSON uniquement.", propPrompt, 3000, []);

        const propP = parseJSON(propRaw||"");
        if (propP.itin) {
          // Injecte dans decision pour le rendu commun ci-dessous
          const pi = propP.itin;
          knownInfos.destination   = pi.dest||"";
          knownInfos.ville_depart  = pi.dep||dep;
          knownInfos.nb_adultes    = pi.adults||adultK;
          knownInfos.checkin       = pi.checkin||ciK;
          knownInfos.checkout      = pi.checkout||coK;
          // Rendu direct — on court-circuite le bloc generation standard
          const fCi = pi.checkin||ciK||"";
          const fCo = pi.checkout||coK||"";
          const fAd = pi.adults||adultK;
          const itinId2 = "itin_"+Date.now();
          let html2 = "";

          html2 += '<div id="'+itinId2+'" style="background:linear-gradient(135deg,#1f2da0,#2f54ff);border-radius:16px;padding:18px;margin-bottom:4px;text-align:center">'
            +'<div style="font-size:32px;margin-bottom:6px">'+(pi.flag||"\u2708\uFE0F")+"</div>"
            +'<div style="font-family:sans-serif;font-size:20px;font-weight:800;color:#fff">'+(pi.dest||"")+(pi.country?", "+pi.country:"")+"</div>"
            +'<div style="font-size:12px;color:rgba(255,255,255,.75);margin-top:6px;display:flex;justify-content:center;gap:12px;flex-wrap:wrap">'
            +"<span>\uD83D\uDCC5 "+(pi.dur||"")+"</span><span>\uD83D\uDC65 "+(pi.trav||fAd+" pers.")+"</span>"
            +(pi.dep?"<span>\uD83D\uDEEB Depuis "+pi.dep+"</span>":"")
            +(pi.budget&&pi.budget.total?"<span>\uD83D\uDCB0 ~"+pi.budget.total+"EUR / 2 pers.</span>":"")
            +"</div></div>";

          if (propP.recap) {
            html2 += '<div style="background:#f5f3ff;border:1.5px solid #ddd6fe;border-radius:12px;padding:12px 14px;margin-top:8px;font-size:13px;color:#5b21b6;font-weight:600;line-height:1.6">'
              +"\uD83D\uDCA1 "+propP.recap+"</div>";
          }

          if (pi.flights&&pi.flights.out) {
            const f2 = pi.flights;
            const sky2 = skyscannerLink(f2.out.from||dep,f2.out.to||pi.dest||"",fCi,fCo,fAd);
            html2 += '<div style="font-size:12px;font-weight:800;color:#0e1430;margin:14px 0 6px">\u2708\uFE0F Vols depuis '+dep+'</div>'
              +'<div style="background:#fff;border:1.5px solid #e6ebf7;border-radius:14px;overflow:hidden">'
              +'<div style="padding:12px 14px;border-bottom:1px solid #f0f4ff">'
              +'<div style="display:flex;justify-content:space-between;align-items:center">'
              +'<div><div style="font-size:10px;font-weight:800;color:#7c89a8;text-transform:uppercase">Aller'+(fCi?" \u00B7 "+fCi:"")+"</div>"
              +'<div style="font-size:13px;font-weight:700;color:#0e1430;margin-top:2px">'+f2.out.from+" \u2192 "+f2.out.to+"</div>"
              +'<div style="font-size:11px;color:#7c89a8">'+(f2.out.co||"")+" \u00B7 "+(f2.out.dur||"")+"</div></div>"
              +'<div style="text-align:right"><div style="font-size:16px;font-weight:900;color:#2f54ff">~'+f2.out.price+"EUR</div>"
              +'<div style="font-size:10px;color:#7c89a8">/pers.</div></div></div></div>"'
              +(f2.ret?'<div style="padding:12px 14px">'
                +'<div style="display:flex;justify-content:space-between;align-items:center">'
                +'<div><div style="font-size:10px;font-weight:800;color:#7c89a8;text-transform:uppercase">Retour'+(fCo?" \u00B7 "+fCo:"")+"</div>"
                +'<div style="font-size:13px;font-weight:700;color:#0e1430;margin-top:2px">'+f2.ret.from+" \u2192 "+f2.ret.to+"</div>"
                +'<div style="font-size:11px;color:#7c89a8">'+(f2.ret.co||"")+" \u00B7 "+(f2.ret.dur||"")+"</div></div>"
                +'<div style="text-align:right"><div style="font-size:16px;font-weight:900;color:#2f54ff">~'+f2.ret.price+"EUR</div>"
                +'<div style="font-size:10px;color:#7c89a8">/pers.</div></div></div></div>':"")
              +"</div>"
              +'<a href="'+sky2+'" target="_blank" style="display:flex;align-items:center;justify-content:center;gap:8px;background:linear-gradient(135deg,#0e1430,#1f2da0);color:#fff;text-decoration:none;border-radius:12px;padding:12px;font-size:13px;font-weight:700;margin-top:6px">\uD83D\uDD0D Confirmer ces vols sur Skyscanner \u2192</a>';
          }

          const realH2 = await fetchHotelPrices(pi.dest||"",fCi,fCo,fAd);
          const hasR2  = !!(realH2&&realH2.length);
          const hotShow2 = hasR2 ? realH2 : (pi.hotels||[]).map(function(h,i){
            return {name:h.name,stars:h.stars||3,price:null,loc:h.loc||pi.dest,hl:h.hl,
              cat:["budget","confort","luxe"][i]||"confort",
              url:bookingTPLink(pi.dest||"",fCi,fCo,fAd,["budget","confort","luxe"][i])};
          });

          html2 += '<div style="font-size:12px;font-weight:800;color:#0e1430;margin:16px 0 6px">\uD83C\uDFE8 Hebergements romantiques</div>';
          for (const h of hotShow2) {
            const hLnk = h.url||bookingTPLink(pi.dest||"",fCi,fCo,fAd,null);
            html2 += cardHotel({name:h.name,stars:h.stars,price:h.price?String(h.price):null,priceReal:hasR2&&!!h.price,loc:h.loc||pi.dest,hl:h.hl,cat:h.cat},hLnk);
          }

          html2 += '<div style="display:flex;gap:8px;margin-top:8px">'
            +'<a href="'+bookingTPLink(pi.dest||"",fCi,fCo,fAd,null)+'" target="_blank" rel="sponsored" style="flex:1;display:flex;justify-content:center;align-items:center;gap:6px;background:linear-gradient(135deg,#003580,#0071c2);color:#fff;text-decoration:none;border-radius:12px;padding:10px;font-size:11px;font-weight:700">\uD83C\uDFE8 Booking.com</a>'
            +'<a href="'+expediaTPLink(pi.dest||"",fCi,fCo,fAd)+'" target="_blank" rel="sponsored" style="flex:1;display:flex;justify-content:center;align-items:center;gap:6px;background:linear-gradient(135deg,#00355f,#00a0e3);color:#fff;text-decoration:none;border-radius:12px;padding:10px;font-size:11px;font-weight:700">\u2708\uFE0F Expedia.fr</a>'
            +"</div>";

          if (fCi) {
            html2 += '<a href="'+getTransferLink(pi.dest||"",fCi)+'" target="_blank" rel="sponsored" style="display:flex;align-items:center;justify-content:center;gap:8px;background:linear-gradient(135deg,#1a1a2e,#e94560);color:#fff;text-decoration:none;border-radius:12px;padding:11px;margin-top:8px;font-size:12px;font-weight:700">\uD83D\uDE97 Transfert aeroport \u00B7 GetTransfer \u2192</a>';
          }

          if (pi.days&&pi.days.length) {
            html2 += '<div style="font-size:12px;font-weight:800;color:#0e1430;margin:16px 0 6px">\uD83D\uDCC5 Programme romantique jour par jour</div>';
            for (const d of pi.days) html2 += cardDay(d);
          }

          if (pi.budget) html2 += cardBudget(pi.budget);
          if (pi.tips&&pi.tips.length) html2 += cardTips(pi.tips);

          const wD2 = JSON.stringify({
            type:"voyage", name:(pi.flag||"\u2708\uFE0F")+" "+(pi.dest||"")+(pi.country?", "+pi.country:""),
            subtitle:(pi.dur||"")+" \u00B7 en amoureux \u00B7 "+(pi.style||"romantique"),
            price:pi.budget&&pi.budget.total?String(pi.budget.total)+"EUR":"",
            store:"booking", url:bookingTPLink(pi.dest||"",fCi,fCo,fAd,null),
            budget:pi.budget||null
          }).replace(/"/g,"&quot;");

          html2 += '<div style="display:flex;gap:8px;margin-top:12px">'
            +'<button onclick="addToWishlist('+wD2+')" style="flex:1;background:linear-gradient(135deg,#1f2da0,#2f54ff);border:none;color:#fff;border-radius:12px;padding:12px;font-weight:700;font-size:13px;cursor:pointer;font-family:inherit">\u2661 Sauvegarder ce voyage</button>'
            +'<button onclick="exportItinerary(\''+itinId2+'\')" style="background:#f5f7ff;border:1.5px solid #c7d2fe;color:#3b5bdb;border-radius:12px;padding:12px;font-weight:700;font-size:13px;cursor:pointer;font-family:inherit">\u2B07\uFE0F Exporter PDF</button>'
            +"</div>";

          return new Response(JSON.stringify({reply:html2,sessionId:sid}),{headers:H});
        }
        // Si l IA n a pas pu generer un itineraire complet → on continue avec le flux normal
        // en forcant une destination populaire par defaut
        if (!knownInfos.destination) knownInfos.destination = "Lisbonne";
      }

      // ── CAS 2 : destination connue → extraction et generation standard ──
      const groqDecidePrompt = "Tu es l assistant voyage de Huntify, expert et chaleureux.\n"
        +"Aujourd hui : "+today+". Conversation :\n"+hist+"\nMessage : "+message+"\n\n"
        +"Extrais les infos et genere IMMEDIATEMENT (la destination est connue : "+(knownInfos.destination||"")+")\n"
        +"Reponds en JSON : {action:'generate', infos:{destination:string, ville_depart:string, nb_adultes:number, "
        +"checkin:string, checkout:string, duree:string, budget:string, style:string}}";

      const decision = parseJSON(
        await groq("Reponds en JSON uniquement.", groqDecidePrompt, 500)
        || JSON.stringify({action:"generate", infos:knownInfos})
      );

      // Fallback solide : si pas de decision claire on force la generation avec ce qu on a
      if (decision.action!=="generate") {
        decision.action = "generate";
        decision.infos  = knownInfos;
      }

      // Generation itineraire
      const infos = decision.infos||knownInfos;
      const adults = parseInt(infos.nb_adultes)||2;
      const ci = parseDate(infos.checkin||null);
      const nightsRaw = (infos.duree||"3 jours").match(/\d+/);
      const nights = parseInt(nightsRaw?nightsRaw[0]:"3")||3;
      const coCalc = ci?(function(){
        const d = new Date(ci);
        d.setDate(d.getDate()+nights);
        return d.toISOString().slice(0,10);
      }()):"";
      const co = parseDate(infos.checkout||null)||coCalc;

      // Prompt generation : l IA cherche les vrais prix sur le web et genere un itineraire complet
      // Ton : expert, passionné, pas robotique
      const itinPrompt = "Tu es le conseiller voyage expert de Huntify. Tu aimes voyager, tu connais les bonnes adresses, "
        +"tu parles comme un ami qui a vraiment ete sur place.\n\n"
        +"VOYAGE A PLANIFIER :\n"
        +"- Destination : "+infos.destination+"\n"
        +"- Depart depuis : "+(infos.ville_depart||"France")+"\n"
        +"- Voyageurs : "+adults+" adulte"+(adults>1?"s":"")+"\n"
        +"- Dates : "+(ci||"bientot")+" au "+(co||"")+" ("+nights+" nuit"+(nights>1?"s":"")+") \n"
        +"- Budget : "+(infos.budget||"flexible")+"\n"
        +"- Style : "+(infos.style||"equilibre entre culture et detente")+"\n\n"
        +"Utilise tes capacites de recherche web pour trouver :\n"
        +"1. Les vrais prix de vols pour ces dates (compagnie, prix approximatif, duree)\n"
        +"2. De vrais hotels existants avec leurs vrais prix (pas inventes)\n"
        +"3. Les restaurants locaux authentiques que les habitants recommandent\n"
        +"4. Les activites avec leurs tarifs reels\n\n"
        +"Genere un JSON complet et detaille. Les hotels, restaurants et activites doivent etre REELS.\n"
        +"Format JSON :\n"
        +"{\n"
        +"  t: 'i',\n"
        +"  recap: 'phrase de synthese naturelle et enthousiaste de ce voyage',\n"
        +"  itin: {\n"
        +"    dest: string, country: string, flag: emoji, dur: string, trav: string, style: string, dep: string,\n"
        +"    checkin: 'YYYY-MM-DD', checkout: 'YYYY-MM-DD', adults: number,\n"
        +"    flights: { out: {from:'IATA',to:'IATA',price:number,co:string,dur:string}, ret: {from,to,price,co,dur} },\n"
        +"    hotels: [ 3 objets avec name:string, stars:number, price:number, loc:string, hl:string, cat:'budget'|'confort'|'luxe' ],\n"
        +"    days: [ pour chaque jour: {n:number, title:string, am:string, pm:string, eve:string, "
        +"resto:{name:string,price:string,spec:string}, acts:[string], budget:number} ],\n"
        +"    budget: { vols:number, hotel:number, acts:number, resto:number, transport:number, total:number, pp:number },\n"
        +"    tips: [ 4 conseils pratiques specifiques et utiles, pas generiques ]\n"
        +"  }\n"
        +"}\n"
        +"IATA : Paris=CDG, Marseille=MRS, Nice=NCE, Lyon=LYS, Rome=FCO, Barcelone=BCN, Madrid=MAD, Lisbonne=LIS, Londres=LHR, Barcelone=BCN.\n"
        +"JSON uniquement, sans texte autour.";

      // Cascade complete : Groq DeepSearch → Mistral → DeepSeek → Claude
      let itinRaw = await groqSearch(itinPrompt, 3500);
      if (!itinRaw || !parseJSON(itinRaw).itin) {
        itinRaw = await mistral(
          "Tu es un expert voyage. Reponds en JSON uniquement.",
          itinPrompt, 3000
        );
      }
      if (!itinRaw || !parseJSON(itinRaw).itin) {
        itinRaw = await deepseek(
          "Tu es un expert voyage. Reponds en JSON uniquement.",
          itinPrompt, 3000
        );
      }
      if (!itinRaw || !parseJSON(itinRaw).itin) {
        itinRaw = await claude(
          "Tu es un expert voyage. Reponds en JSON uniquement.",
          itinPrompt, 3000, []
        );
      }

      const tP = parseJSON(itinRaw||"");
      const itin = tP.itin;

      // Fallback minimal
      if (!itin) {
        const sky = skyscannerLink(infos.ville_depart||"",infos.destination||"",ci,co,adults);
        const bkg = bookingTPLink(infos.destination||"",ci,co,adults,null);
        const exp = expediaTPLink(infos.destination||"",ci,co,adults);
        const gtf = getTransferLink(infos.destination||"",ci);
        return new Response(JSON.stringify({reply:
          '<div style="font-size:13.5px;color:#1e293b;line-height:1.6;margin-bottom:12px">'
          +'Super voyage en preparation ! Voici les liens pour commencer :'
          +"</div>"
          +'<a href="'+sky+'" target="_blank" style="display:flex;justify-content:center;background:linear-gradient(135deg,#0e1430,#1f2da0);color:#fff;text-decoration:none;border-radius:12px;padding:14px;margin-top:8px;font-size:13px;font-weight:700">\u2708\uFE0F Vols sur Skyscanner \u2192</a>'
          +'<a href="'+bkg+'" target="_blank" style="display:flex;justify-content:center;background:linear-gradient(135deg,#003580,#0071c2);color:#fff;text-decoration:none;border-radius:12px;padding:14px;margin-top:8px;font-size:13px;font-weight:700">\uD83C\uDFE8 Hotels sur Booking.com \u2192</a>'
          +'<a href="'+exp+'" target="_blank" style="display:flex;justify-content:center;background:linear-gradient(135deg,#00355f,#00a0e3);color:#fff;text-decoration:none;border-radius:12px;padding:14px;margin-top:8px;font-size:13px;font-weight:700">\uD83D\uDED2 Comparer sur Expedia \u2192</a>'
          +'<a href="'+gtf+'" target="_blank" style="display:flex;justify-content:center;background:linear-gradient(135deg,#1a1a2e,#e94560);color:#fff;text-decoration:none;border-radius:12px;padding:14px;margin-top:8px;font-size:13px;font-weight:700">\uD83D\uDE97 Transfert aeroport GetTransfer \u2192</a>',
          sessionId:sid}),{headers:H});
      }

      // Rendu itineraire complet
      const finalCi = (/^\d{4}-\d{2}-\d{2}$/.test(itin.checkin||""))?itin.checkin:(ci||"");
      const finalCo = (/^\d{4}-\d{2}-\d{2}$/.test(itin.checkout||""))?itin.checkout:(co||"");
      const finalAdults = itin.adults||adults;
      const itinId = "itin_"+Date.now();
      let html = "";

      // Header
      html += '<div id="'+itinId+'" style="background:linear-gradient(135deg,#1f2da0,#2f54ff);border-radius:16px;padding:18px;margin-bottom:4px;text-align:center">'
        +'<div style="font-size:32px;margin-bottom:6px">'+(itin.flag||"\u2708\uFE0F")+"</div>"
        +'<div style="font-family:sans-serif;font-size:20px;font-weight:800;color:#fff">'
        +(itin.dest||"")+(itin.country?", "+itin.country:"")+"</div>"
        +'<div style="font-size:12px;color:rgba(255,255,255,.75);margin-top:6px;display:flex;justify-content:center;gap:12px;flex-wrap:wrap">'
        +"<span>\uD83D\uDCC5 "+(itin.dur||nights+" nuits")+"</span>"
        +"<span>\uD83D\uDC65 "+(itin.trav||finalAdults+" pers.")+"</span>"
        +(itin.dep?"<span>\uD83D\uDEEB Depuis "+itin.dep+"</span>":"")
        +(itin.budget&&itin.budget.total?"<span>\uD83D\uDCB0 ~"+itin.budget.total+"EUR</span>":"")
        +"</div></div>";

      if (tP.recap) {
        html += '<div style="background:#f5f3ff;border:1.5px solid #ddd6fe;border-radius:12px;padding:10px 14px;margin-top:8px;font-size:12.5px;color:#5b21b6;font-weight:600;line-height:1.5">'
          +tP.recap+"</div>";
      }

      // Vols
      if (itin.flights&&itin.flights.out) {
        const f = itin.flights;
        const skyFrom = f.out.from||toIATA(itin.dep||infos.ville_depart||"")||"par";
        const skyTo   = f.out.to||toIATA(itin.dest||infos.destination||"")||"xxx";
        const sky = skyscannerLink(skyFrom, skyTo, finalCi, finalCo, finalAdults);
        html += '<div style="font-size:12px;font-weight:800;color:#0e1430;margin:14px 0 6px">\u2708\uFE0F Vols recommandes</div>'
          +'<div style="background:#fff;border:1.5px solid #e6ebf7;border-radius:14px;overflow:hidden">'
          +'<div style="padding:12px 14px;border-bottom:1px solid #f0f4ff">'
          +'<div style="display:flex;justify-content:space-between;align-items:center">'
          +'<div><div style="font-size:10px;font-weight:800;color:#7c89a8;text-transform:uppercase">'
          +"Aller"+(finalCi?" \u00B7 "+finalCi:"")+"</div>"
          +'<div style="font-size:13px;font-weight:700;color:#0e1430;margin-top:2px">'
          +f.out.from+" \u2192 "+f.out.to+"</div>"
          +'<div style="font-size:11px;color:#7c89a8">'+(f.out.co||"")+" \u00B7 "+(f.out.dur||"")+"</div></div>"
          +'<div style="text-align:right">'
          +'<div style="font-size:16px;font-weight:900;color:#2f54ff">~'+f.out.price+"EUR</div>"
          +'<div style="font-size:10px;color:#7c89a8">/pers.</div></div></div></div>"';
        if (f.ret) {
          html += '<div style="padding:12px 14px">'
            +'<div style="display:flex;justify-content:space-between;align-items:center">'
            +'<div><div style="font-size:10px;font-weight:800;color:#7c89a8;text-transform:uppercase">'
            +"Retour"+(finalCo?" \u00B7 "+finalCo:"")+"</div>"
            +'<div style="font-size:13px;font-weight:700;color:#0e1430;margin-top:2px">'
            +f.ret.from+" \u2192 "+f.ret.to+"</div>"
            +'<div style="font-size:11px;color:#7c89a8">'+(f.ret.co||"")+" \u00B7 "+(f.ret.dur||"")+"</div></div>"
            +'<div style="text-align:right">'
            +'<div style="font-size:16px;font-weight:900;color:#2f54ff">~'+f.ret.price+"EUR</div>"
            +'<div style="font-size:10px;color:#7c89a8">/pers.</div></div></div></div>';
        }
        html += "</div>";
        html += '<a href="'+sky+'" target="_blank" style="display:flex;align-items:center;justify-content:center;gap:8px;background:linear-gradient(135deg,#0e1430,#1f2da0);color:#fff;text-decoration:none;border-radius:12px;padding:12px;font-size:13px;font-weight:700;margin-top:6px">\uD83D\uDD0D Voir et reserver ces vols sur Skyscanner \u2192</a>';
      }

      // Hotels — Hotellook API (vrais prix affilies TP) ou fallback IA
      const realHotels = await fetchHotelPrices(itin.dest||"",finalCi,finalCo,finalAdults);
      const hasReal = !!(realHotels&&realHotels.length);
      const hotelsShow = hasReal ? realHotels : (itin.hotels||[]).map(function(h,i){
        return {
          name:h.name, stars:h.stars||3, price:null,
          loc:h.loc||itin.dest, hl:h.hl,
          cat:["budget","confort","luxe"][i]||h.cat||"confort",
          url:bookingTPLink(itin.dest||"",finalCi,finalCo,finalAdults, ["budget","confort","luxe"][i]||"confort")
        };
      });

      html += '<div style="font-size:12px;font-weight:800;color:#0e1430;margin:16px 0 6px">'
        +'\uD83C\uDFE8 Hebergements \u00B7 '
        +(hasReal
          ?'<span style="color:#16a34a;font-size:11px">Prix reels \u2713</span>'
          :'<span style="color:#7c89a8;font-size:11px">Selections IA</span>')
        +"</div>";

      const htPrices = [];
      for (const h of hotelsShow) {
        if (h.price) htPrices.push(h.price);
        const hLink = h.url||bookingTPLink(itin.dest||"",finalCi,finalCo,finalAdults,null);
        html += cardHotel({
          name:h.name, stars:h.stars,
          price:h.price?String(h.price):null,
          priceReal:hasReal&&!!h.price,
          loc:h.loc||itin.dest, hl:h.hl, cat:h.cat
        }, hLink);
      }

      // Boutons Booking + Expedia — DEUX liens affilies TP
      html += '<div style="font-size:11px;color:#7c89a8;font-weight:600;margin:10px 0 4px">\uD83D\uDD0D Voir plus de disponibilites :</div>'
        +'<div style="display:flex;gap:8px">'
        +'<a href="'+bookingTPLink(itin.dest||"",finalCi,finalCo,finalAdults,null)+'" target="_blank" rel="sponsored" style="flex:1;display:flex;justify-content:center;align-items:center;gap:6px;background:linear-gradient(135deg,#003580,#0071c2);color:#fff;text-decoration:none;border-radius:12px;padding:10px;font-size:11px;font-weight:700">\uD83C\uDFE8 Booking.com</a>'
        +'<a href="'+expediaTPLink(itin.dest||"",finalCi,finalCo,finalAdults)+'" target="_blank" rel="sponsored" style="flex:1;display:flex;justify-content:center;align-items:center;gap:6px;background:linear-gradient(135deg,#00355f,#00a0e3);color:#fff;text-decoration:none;border-radius:12px;padding:10px;font-size:11px;font-weight:700">\u2708\uFE0F Expedia.fr</a>'
        +"</div>";

      // GetTransfer
      if (finalCi) {
        html += '<a href="'+getTransferLink(itin.dest||"",finalCi)+'" target="_blank" rel="sponsored" '
          +'style="display:flex;align-items:center;justify-content:center;gap:8px;background:linear-gradient(135deg,#1a1a2e,#e94560);color:#fff;text-decoration:none;border-radius:12px;padding:11px;margin-top:8px;font-size:12px;font-weight:700">'
          +'\uD83D\uDE97 Transfert aeroport sans stress \u00B7 GetTransfer \u2192</a>';
      }

      // Programme jour par jour
      if (itin.days&&itin.days.length) {
        html += '<div style="font-size:12px;font-weight:800;color:#0e1430;margin:16px 0 6px">\uD83D\uDCC5 Programme jour par jour</div>';
        for (const d of itin.days) html += cardDay(d);
      }

      if (itin.budget) html += cardBudget(itin.budget);
      if (itin.tips&&itin.tips.length) html += cardTips(itin.tips);

      // Wishlist + Export
      const wData = JSON.stringify({
        type:"voyage",
        name:(itin.flag||"\u2708\uFE0F")+" "+(itin.dest||"")+(itin.country?", "+itin.country:""),
        subtitle:(itin.dur||"")+" \u00B7 "+(itin.trav||finalAdults+" pers.")+" \u00B7 "+(itin.style||""),
        price:itin.budget&&itin.budget.total?String(itin.budget.total)+"EUR":"",
        store:"booking",
        url:bookingTPLink(itin.dest||"",finalCi,finalCo,finalAdults,null),
        flightUrl:itin.flights&&itin.flights.out?skyscannerLink(
          itin.flights.out.from||"", itin.flights.out.to||"", finalCi, finalCo, finalAdults
        ):"",
        hotels:(itin.hotels||[]).slice(0,3).map(function(h,i){
          return {
            name:h.name||"",
            cat:["budget","confort","luxe"][i]||"confort",
            url:bookingTPLink(itin.dest||"",finalCi,finalCo,finalAdults,["budget","confort","luxe"][i])
          };
        }),
        budget:itin.budget||null
      }).replace(/"/g,"&quot;");

      html += '<div style="display:flex;gap:8px;margin-top:12px">'
        +'<button onclick="addToWishlist('+wData+')" style="flex:1;background:linear-gradient(135deg,#1f2da0,#2f54ff);border:none;color:#fff;border-radius:12px;padding:12px;font-weight:700;font-size:13px;cursor:pointer;font-family:inherit">\u2661 Sauvegarder ce voyage</button>'
        +'<button onclick="exportItinerary(\''+itinId+'\')" style="background:#f5f7ff;border:1.5px solid #c7d2fe;color:#3b5bdb;border-radius:12px;padding:12px;font-weight:700;font-size:13px;cursor:pointer;font-family:inherit">\u2B07\uFE0F Exporter PDF</button>'
        +"</div>";

      if (body.trackingEnabled) {
        sbFetch("searches","POST",{query:"[VOYAGE] "+message,session_id:sid,user_id:body.userId||null}).catch(function(){});
      }
      return new Response(JSON.stringify({reply:html,sessionId:sid}),{headers:H});
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  MODE PRODUIT
    // ══════════════════════════════════════════════════════════════════════════

    // L IA reflechit comme un vrai conseiller, pas comme un formulaire
    const prodSys = "Tu es le conseiller shopping de Huntify. Tu analyses ce que veut vraiment l utilisateur "
      +"en lisant tout le contexte, et tu agis immediatement sans poser de questions inutiles.\n"
      +"Si tu comprends le produit cherche (meme vaguement), tu generes direct : ready:true.\n"
      +"Un seul mot suffit : mascara, casque, lampe, iphone... tu cherches sans demander.\n"
      +"Tu ne demandes JAMAIS la couleur, la marque exacte, ou des details techniques.\n"
      +"Tu poses UNE question seulement si la demande est vraiment incomprehensible.\n"
      +"Si une question a deja ete posee dans l historique : ready:true obligatoirement.\n"
      +"Reponds en JSON : {ready:true, recap:'description concise du produit + budget si mentionne'} "
      +"ou {ready:false, msg:'question courte et naturelle'}";

    const prodUser = "Historique :\n"+histS+"\n\nMessage : "+message;

    const prodDecision = parseJSON(
      await groq(prodSys, prodUser, 300)
      || await gemini(prodSys+"\n\n"+prodUser, 300)
      || await mistral(prodSys, prodUser, 300)
      || "{}"
    );

    if (!prodDecision.ready && prodDecision.msg && history.length < 3) {
      return new Response(JSON.stringify({
        reply:'<div style="font-size:13.5px;color:#1e293b;line-height:1.6;padding:4px 0">'+prodDecision.msg+"</div>",
        sessionId:sid
      }),{headers:H});
    }

    const recap = (prodDecision.ready&&prodDecision.recap)
      ? prodDecision.recap
      : (formatHistory(history,300)+" "+message).trim();

    const dbCtx = await dbLookup(recap);
    const budgetNum = parseInt(((recap+" "+histS).match(/(\d+)\s*(?:EUR|euros?)/i)||[0,"0"])[1])||0;
    const isPremium = budgetNum>=100
      ||/cadeau|premium|luxe|meilleur|haute gamme|qualite/.test((recap+" "+histS).toLowerCase())
      ||history.length>=4;

    // Prompt de recherche produit : naturel, efficace, pas robotique
    const searchSys = "Tu es l agent shopping Huntify. Trouve les meilleurs produits pour : "+recap+".\n"
      +(dbCtx?"Contexte interne : "+dbCtx+"\n":"")
      +"Recherche sur amazon.fr 2 produits avec leurs vrais ASINs (URL /dp/BXXXXXXXXX), "
      +"et 1 produit sur Rakuten.fr.\n"
      +"Choisis des produits pertinents, bien notes, bon rapport qualite/prix.\n"
      +"Si tu ne trouves pas un ASIN reel, mets url:null.\n"
      +"JSON : { summary:'phrase naturelle et utile sur ta selection', "
      +"products:[ {name, price, store:'amazon'|'rakuten', keywords, url, badge} ], "
      +"promoCodes:[ {code,store,discount,best} ] }\n"
      +"JSON uniquement.";

    // Cascade complete pour la recherche produit
    let raw = await groqSearch(searchSys, 1200);
    let products = parseJSON(raw||"").products||[];

    // Valide les ASINs Amazon
    const hasValidAsin = products.some(function(p){
      return (p.store||"").includes("amazon") && p.url && /\/dp\/B[A-Z0-9]{9}/.test(p.url);
    });

    // Si pas d ASIN valide : Claude + web_search (il est meilleur pour ca)
    if (!hasValidAsin) {
      const claudeRaw = await claude(
        "Tu es un agent shopping. Trouve les vrais ASINs Amazon pour : "+recap,
        "Cherche sur amazon.fr et retourne un JSON avec les produits trouves (URL /dp/ASIN).",
        900,
        [{type:"web_search_20250305",name:"web_search",max_uses:3}]
      );
      if (claudeRaw) {
        const cp = parseJSON(claudeRaw).products||[];
        if (cp.some(function(p){return (p.store||"").includes("amazon")&&p.url&&/\/dp\/B[A-Z0-9]{9}/.test(p.url);})) {
          products = cp;
          raw = claudeRaw;
        }
      }
    }

    // Fallback final cascade complete
    if (!products.length) {
      const fbRaw = await gemini(searchSys+" Reponds en JSON uniquement.", 900)
        || await mistral("Reponds en JSON uniquement.", searchSys, 900)
        || await deepseek("Reponds en JSON uniquement.", searchSys, 900);
      if (fbRaw) {
        products = parseJSON(fbRaw).products||[];
        if (!raw) raw = fbRaw;
      }
    }

    const parsed = parseJSON(raw||"");
    if (!products.length) products = parsed.products||[];
    const summary = parsed.summary||"Voici ma selection pour vous :";
    const promos  = parsed.promoCodes||[];

    // Garantit toujours Amazon + Rakuten
    if (!products.some(function(p){return (p.store||"").includes("amazon");})) {
      products.unshift({name:recap,price:"Voir prix",store:"amazon",keywords:recap,url:null,badge:"Recommande"});
    }
    if (!products.some(function(p){return (p.store||"").includes("rakuten");})) {
      products.push({name:recap,price:"Voir prix",store:"rakuten",keywords:recap,url:null,badge:"Bon plan"});
    }

    let buttons = "";
    for (const pr of products.slice(0,4)) {
      if (!pr.name) continue;
      let adv = findAdv(advertisers, pr.store);
      if (!adv) {
        if ((pr.store||"").includes("amazon")) {
          adv = {slug:"amazon",name:"Amazon",emoji:"\uD83D\uDED2",color:"#e47911",active:true};
        } else if ((pr.store||"").includes("rakuten")) {
          adv = {slug:"rakuten",name:"Rakuten",emoji:"\uD83D\uDECD\uFE0F",color:"#bf0000",active:true,awin_mid:RAKUTEN_MID};
        } else {
          continue;
        }
      }
      const rawUrl = (pr.url&&pr.url!=="null"&&pr.url.length>15)?pr.url:null;
      const kw = pr.name.length>5?pr.name:(pr.keywords||pr.name);
      const url = buildLink(adv, kw, rawUrl);
      if (!url) continue;
      buttons += cardProduct(pr.name, pr.price||"Voir prix", url, adv, pr.img||null, pr.badge||null);
    }

    let promoHtml = "";
    const sortedPromos = promos.filter(function(c){return c.code;}).sort(function(a,b){return (b.best?1:0)-(a.best?1:0);});
    for (const c of sortedPromos.slice(0,2)) {
      promoHtml += promoBox(c.code, c.store||"boutique", c.discount||"Reduction exclusive", c.best||false);
    }

    const first = products.find(function(p){return (p.store||"").includes("amazon");})||products[0];
    let wishHtml = "";
    if (first) {
      const adv0 = findAdv(advertisers,first.store)||{slug:"amazon",name:"Amazon",color:"#e47911",active:true};
      const wUrl = buildLink(adv0, first.keywords||first.name, first.url||null)||"";
      const wD = JSON.stringify({type:"product",name:first.name,price:first.price,store:first.store,url:wUrl}).replace(/"/g,"&quot;");
      wishHtml = '<button onclick="addToWishlist('+wD+')" style="background:#fff;border:1.5px solid #e8edf8;color:#3b5bdb;border-radius:12px;padding:8px 16px;margin-top:10px;font-weight:700;font-size:12px;cursor:pointer;font-family:inherit;width:100%">\u2661 Ajouter a ma wishlist</button>';
    }

    return new Response(JSON.stringify({
      reply:'<div style="font-size:13.5px;color:#1e293b;margin-bottom:8px;font-weight:500;line-height:1.5">'
        +summary+"</div>"
        +buttons
        +(promoHtml?'<div style="margin-top:4px">'+promoHtml+"</div>":"")
        +wishHtml,
      sessionId:sid
    }),{headers:H});

  } catch(err) {
    console.error("Huntify error:", err&&err.message);
    return new Response(JSON.stringify({
      reply:'<div style="font-size:13px;color:#1e293b">Desole, un probleme momentane. Reessayez dans quelques secondes !</div>'
    }),{status:200,headers:{"Content-Type":"application/json; charset=utf-8","Access-Control-Allow-Origin":"*"}});
  }
}
