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
// Booking.com lien affilie direct
// AID a recuperer : dashboard Travelpayouts → Booking.com → Get link → parametre aid=XXXXXXX
// Ajouter BOOKING_AID dans les variables Vercel
const BOOKING_AID = process.env.BOOKING_AID||"2311236";

function bookingTPLink(dest, ci, co, adults, cat) {
  const rooms = Math.ceil((adults||2)/2);
  let url = "https://www.booking.com/searchresults.html"
    +"?ss="+encodeURIComponent(dest||"")
    +"&group_adults="+(adults||2)
    +"&no_rooms="+rooms
    +"&lang=fr&selected_currency=EUR"
    +"&aid="+BOOKING_AID;
  if (ci) url += "&checkin="+ci;
  if (co) url += "&checkout="+co;
  if (cat==="budget")  url += "&nflt=class%3D2%3Bclass%3D3";
  if (cat==="confort") url += "&nflt=class%3D3%3Bclass%3D4";
  if (cat==="luxe")    url += "&nflt=class%3D4%3Bclass%3D5";
  url += "&order=popularity";
  return url;
}

function expediaTPLink(dest, ci, co, adults) {
  const aid = process.env.EXPEDIA_AID||"";
  let url = "https://www.expedia.fr/Hotel-Search"
    +"?destination="+encodeURIComponent(dest||"")
    +"&adults="+(adults||2)
    +"&sort=RECOMMENDED";
  if (ci) url += "&startDate="+ci;
  if (co) url += "&endDate="+co;
  if (aid) url += "&affcid="+aid;
  return url;
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

            // ── CAS 1 : l utilisateur veut des propositions ou pas de destination → 3 DESTINATIONS ──
      if (wantsSuggestions || !knownInfos.destination) {
        const dep    = knownInfos.ville_depart||"France";
        const budget = knownInfos.budget||"2000EUR";
        const ciK    = knownInfos.checkin||ci;
        const coK    = knownInfos.checkout||co;
        const dureeK = knownInfos.duree||"4 nuits";
        const styleK = knownInfos.style||"romantique en amoureux";
        const adultK = knownInfos.nb_adultes||2;

        // L IA genere 3 destinations differentes avec vrais prix
        const multiPropPrompt = "Tu es le conseiller voyage Huntify, passionne et expert.\n"
          +"Un couple part depuis "+dep+" du "+(ciK||"17 juin")+" au "+(coK||"21 juin")+"\n"
          +"Budget total max : "+budget+" pour 2 personnes. Style : "+styleK+".\n\n"
          +"Utilise tes capacites de recherche web pour trouver des VRAIS prix de vols et hotels.\n\n"
          +"Genere EXACTEMENT 3 propositions de destinations differentes et complementaires.\n"
          +"Pour chaque destination : vols depuis "+dep+", hotels avec vrais prix, programme.\n\n"
          +"JSON :\n"
          +"{\n"
          +"  proposals: [\n"
          +"    {\n"
          +"      dest:string, country:string, flag:string,\n"
          +"      pitch: 'une phrase percutante qui donne envie (2 lignes max)',\n"
          +"      vibe: 'mot cle : Romantique | Culturel | Soleil | Aventure | Gastronomie',\n"
          +"      flight_price: number, flight_co: string, flight_dur: string,\n"
          +"      hotel_budget_name: string, hotel_budget_price: number,\n"
          +"      hotel_luxe_name: string, hotel_luxe_price: number,\n"
          +"      total_est: number,\n"
          +"      checkin: 'YYYY-MM-DD', checkout: 'YYYY-MM-DD',\n"
          +"      from_iata: string, to_iata: string,\n"
          +"      top3: ['activite 1', 'activite 2', 'activite 3'],\n"
          +"      why: 'pourquoi cette destination depuis "+dep+" pour ce profil'\n"
          +"    }\n"
          +"  ]\n"
          +"}\n"
          +"Les 3 destinations doivent etre TRES differentes (ex: une ville culturelle, une destination soleil, une ville romantique proche).\n"
          +"Toutes accessibles depuis "+dep+" dans le budget "+budget+".\n"
          +"JSON uniquement.";

        // Cascade pour les propositions
        let propRaw = await groqSearch(multiPropPrompt, 3000);
        let propData = parseJSON(propRaw||"");
        if (!propData.proposals||!propData.proposals.length) {
          propRaw = await deepseek("Expert voyage. JSON uniquement.", multiPropPrompt, 2800);
          propData = parseJSON(propRaw||"");
        }
        if (!propData.proposals||!propData.proposals.length) {
          propRaw = await mistral("Expert voyage. JSON uniquement.", multiPropPrompt, 2500);
          propData = parseJSON(propRaw||"");
        }
        if (!propData.proposals||!propData.proposals.length) {
          propRaw = await gemini("Expert voyage. JSON uniquement.\n\n"+multiPropPrompt, 2500);
          propData = parseJSON(propRaw||"");
        }
        if (!propData.proposals||!propData.proposals.length) {
          propRaw = await claude("Expert voyage. JSON uniquement.", multiPropPrompt, 2500, []);
          propData = parseJSON(propRaw||"");
        }

        // Rendu cartes destinations multiples
        if (propData.proposals&&propData.proposals.length) {
          const vibeColor = {
            "Romantique":"#e83e8c","Culturel":"#6f42c1","Soleil":"#fd7e14",
            "Aventure":"#20c997","Gastronomie":"#e63946"
          };
          let html3 = '<div style="font-size:14px;font-weight:700;color:#0e1430;margin-bottom:12px">'
            +'\uD83C\uDF1F Voici mes 3 coups de coeur pour vous depuis '+dep+' :</div>';

          for (const p of propData.proposals.slice(0,3)) {
            const vc = vibeColor[p.vibe]||"#2f54ff";
            const skyP = skyscannerLink(p.from_iata||dep, p.to_iata||p.dest||"", p.checkin||ciK, p.checkout||coK, adultK);
            const bkgP = bookingTPLink(p.dest||"", p.checkin||ciK, p.checkout||coK, adultK, null);

            html3 += '<div style="background:#fff;border:2px solid #e6ebf7;border-radius:16px;padding:16px;margin-bottom:12px;box-shadow:0 2px 8px rgba(0,0,0,.06)">'
              // Header destination
              +'<div style="display:flex;align-items:center;gap:12px;margin-bottom:10px">'
              +'<div style="font-size:36px">'+(p.flag||"\u2708\uFE0F")+"</div>"
              +'<div style="flex:1">'
              +'<div style="font-size:16px;font-weight:900;color:#0e1430">'+(p.dest||"")+(p.country?", "+p.country:"")+"</div>"
              +'<span style="background:'+vc+';color:#fff;border-radius:100px;padding:2px 10px;font-size:10px;font-weight:800">'+(p.vibe||"Voyage")+"</span>"
              +"</div>"
              +'<div style="text-align:right"><div style="font-size:11px;color:#7c89a8">Budget estim\u00e9</div>'
              +'<div style="font-size:18px;font-weight:900;color:#2f54ff">~'+(p.total_est||"?")+"EUR</div>"
              +'<div style="font-size:10px;color:#7c89a8">/ 2 pers.</div></div>'
              +"</div>"
              // Pitch
              +'<div style="font-size:13px;color:#374151;font-style:italic;background:#f8f9ff;border-radius:10px;padding:8px 12px;margin-bottom:10px;line-height:1.5">'
              +"\u201C"+(p.pitch||"")+"\u201D</div>"
              // Vols + hotels
              +'<div style="display:flex;gap:8px;margin-bottom:8px">'
              +'<div style="flex:1;background:#eff6ff;border-radius:10px;padding:8px 10px">'
              +'<div style="font-size:10px;font-weight:800;color:#7c89a8;text-transform:uppercase">\u2708\uFE0F Vol aller</div>'
              +'<div style="font-size:13px;font-weight:800;color:#2f54ff">~'+(p.flight_price||"?")+"EUR</div>"
              +'<div style="font-size:10px;color:#7c89a8">'+(p.flight_co||"")+" \u00B7 "+(p.flight_dur||"")+"</div>"
              +"</div>"
              +'<div style="flex:1;background:#f0fdf4;border-radius:10px;padding:8px 10px">'
              +'<div style="font-size:10px;font-weight:800;color:#7c89a8;text-transform:uppercase">\uD83C\uDFE8 H\u00f4tel budget</div>'
              +'<div style="font-size:13px;font-weight:800;color:#16a34a">~'+(p.hotel_budget_price||"?")+"EUR/nuit</div>"
              +'<div style="font-size:10px;color:#7c89a8">'+(p.hotel_budget_name||"")+"</div>"
              +"</div></div>"
              // Top 3 activites
              +(p.top3&&p.top3.length?'<div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:10px">'
                +p.top3.map(function(a){return '<span style="background:#f5f3ff;color:#6f42c1;border-radius:100px;padding:3px 10px;font-size:11px;font-weight:600">'+a+"</span>";}).join("")
                +"</div>":"")
              // Pourquoi ce choix
              +'<div style="font-size:11px;color:#64748b;background:#f8fafc;border-radius:8px;padding:6px 10px;margin-bottom:10px">'
              +"\uD83D\uDCA1 "+(p.why||"")+"</div>"
              // Boutons
              +'<div style="display:flex;gap:8px">'
              +'<a href="'+skyP+'" target="_blank" style="flex:1;display:flex;justify-content:center;align-items:center;background:linear-gradient(135deg,#0e1430,#1f2da0);color:#fff;text-decoration:none;border-radius:10px;padding:9px;font-size:11px;font-weight:700">\u2708\uFE0F Vols</a>'
              +'<a href="'+bkgP+'" target="_blank" rel="sponsored" style="flex:1;display:flex;justify-content:center;align-items:center;background:linear-gradient(135deg,#003580,#0071c2);color:#fff;text-decoration:none;border-radius:10px;padding:9px;font-size:11px;font-weight:700">\uD83C\uDFE8 H\u00f4tels</a>'
              +'<button onclick="this.closest(\'div[id]\') && sendPrompt(\'Planifie le voyage complet pour '+p.dest+'\');" style="flex:1;background:linear-gradient(135deg,#2f54ff,#4a6bff);border:none;color:#fff;border-radius:10px;padding:9px;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit">\uD83D\uDDFA\uFE0F Planifier</button>'
              +"</div></div>";
          }

          html3 += '<div style="font-size:11px;color:#94a3b8;text-align:center;margin-top:8px">'
            +'Cliquez "Planifier" sur la destination de votre choix pour l itineraire complet jour par jour</div>';

          return new Response(JSON.stringify({reply:html3,sessionId:sid}),{headers:H});
        }

        // Si l IA n a pas pu generer → on force une destination par defaut
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

    // ── RECHERCHE PRODUIT : Claude web_search en PREMIER pour prix reels ─────
    // Strategie : Claude cherche les vrais prix Amazon + ASIN via web_search
    // Groq DeepSearch en parallele pour Rakuten et codes promo
    // On fusionne les resultats pour avoir prix reels + liens directs

    // 1. Claude + web_search = seul capable de trouver les vrais prix Amazon en temps reel
    const claudeSearchSys = "Tu es un agent shopping expert. Cherche sur amazon.fr les meilleurs produits "
      +"correspondant exactement a cette demande : "+recap+"\n"
      +"Pour chaque produit trouve :\n"
      +"- Le vrai prix actuel en EUR (pas un prix invente)\n"
      +"- L URL exacte amazon.fr/dp/ASIN (ASIN = B suivi de 9 caracteres alphanumeriques)\n"
      +"- La note client si disponible\n"
      +"Cherche aussi 1 produit sur fr.shopping.rakuten.com.\n"
      +"Retourne un JSON valide uniquement :\n"
      +"{ summary:'phrase naturelle et utile', products:[{name:string, price:string, store:'amazon'|'rakuten', keywords:string, url:string, badge:string, rating:string}], promoCodes:[{code,store,discount,best}] }";

    const claudeSearchUser = "Cherche maintenant sur amazon.fr : "+recap
      +". Trouve les vrais prix et ASINs reels. JSON uniquement.";

    // Lance Claude web_search + Groq DeepSearch en parallele pour aller plus vite
    const [claudeRaw, groqRaw] = await Promise.all([
      claude(claudeSearchSys, claudeSearchUser, 1200,
        [{type:"web_search_20250305", name:"web_search", max_uses:5}]
      ),
      groqSearch(
        "Tu es agent shopping. Cherche sur amazon.fr et rakuten.fr : "+recap+"\n"
        +"Trouve les vrais produits avec vrais prix et ASINs amazon.fr.\n"
        +"JSON: {summary:string, products:[{name,price,store,keywords,url,badge}], promoCodes:[{code,store,discount,best}]}\n"
        +"JSON uniquement.",
        1200
      )
    ]);

    // Parse les deux resultats
    const claudeParsed = parseJSON(claudeRaw||"");
    const groqParsed   = parseJSON(groqRaw||"");

    // Fusion intelligente : on prend le meilleur de chaque
    // Claude est prioritaire pour Amazon (vrais prix via web_search)
    // Groq peut complementer avec Rakuten
    let products = [];
    const claudeProds = claudeParsed.products||[];
    const groqProds   = groqParsed.products||[];

    // Produits Amazon : Claude prioritaire si ASIN valide
    const claudeAmazon = claudeProds.filter(function(p){
      return (p.store||"").toLowerCase().includes("amazon")
        && p.url && /\/dp\/B[A-Z0-9]{9}/.test(p.url)
        && p.price && p.price !== "Voir prix";
    });
    const groqAmazon = groqProds.filter(function(p){
      return (p.store||"").toLowerCase().includes("amazon")
        && p.url && /\/dp\/B[A-Z0-9]{9}/.test(p.url)
        && p.price && p.price !== "Voir prix";
    });

    // Prend Claude si disponible, sinon Groq, sinon produit sans prix
    const amazonProds = claudeAmazon.length ? claudeAmazon.slice(0,2)
      : groqAmazon.length ? groqAmazon.slice(0,2)
      : claudeProds.filter(function(p){return (p.store||"").toLowerCase().includes("amazon");}).slice(0,2)
      || groqProds.filter(function(p){return (p.store||"").toLowerCase().includes("amazon");}).slice(0,2);

    // Produits Rakuten : Groq puis Claude
    const rakutenProds = groqProds.filter(function(p){return (p.store||"").toLowerCase().includes("rakuten");}).slice(0,1)
      || claudeProds.filter(function(p){return (p.store||"").toLowerCase().includes("rakuten");}).slice(0,1);

    products = amazonProds.concat(rakutenProds);

    // Codes promo : merge les deux sources
    const promos = (claudeParsed.promoCodes||[]).concat(groqParsed.promoCodes||[])
      .filter(function(c){return c&&c.code;})
      .slice(0,2);

    // Summary : Claude est plus naturel
    const summary = claudeParsed.summary || groqParsed.summary || "Voici ma selection pour vous :";

    // Fallback si toujours rien de valide
    if (!products.length) {
      const fbRaw = await deepseek("Agent shopping. JSON uniquement.", claudeSearchSys+". "+claudeSearchUser, 900)
        || await mistral("Agent shopping. JSON uniquement.", claudeSearchSys+". "+claudeSearchUser, 900);
      if (fbRaw) products = parseJSON(fbRaw||"").products||[];
    }

    // Garantit Amazon + Rakuten meme sans produit trouve
    if (!products.some(function(p){return (p.store||"").toLowerCase().includes("amazon");})) {
      products.unshift({name:recap, price:"Voir prix", store:"amazon", keywords:recap, url:null, badge:"Meilleure vente"});
    }
    if (!products.some(function(p){return (p.store||"").toLowerCase().includes("rakuten");})) {
      products.push({name:recap, price:"Voir prix", store:"rakuten", keywords:recap, url:null, badge:"Bon plan"});
    }

    let buttons = "";
    for (const pr of products.slice(0,4)) {
      if (!pr.name) continue;
      let adv = findAdv(advertisers, pr.store);
      if (!adv) {
        if ((pr.store||"").toLowerCase().includes("amazon")) {
          adv = {slug:"amazon", name:"Amazon", emoji:"\uD83D\uDED2", color:"#e47911", active:true};
        } else if ((pr.store||"").toLowerCase().includes("rakuten")) {
          adv = {slug:"rakuten", name:"Rakuten", emoji:"\uD83D\uDECD\uFE0F", color:"#bf0000", active:true, awin_mid:RAKUTEN_MID};
        } else {
          continue;
        }
      }
      const rawUrl = (pr.url && pr.url !== "null" && pr.url.length > 15) ? pr.url : null;
      const kw = pr.name.length > 5 ? pr.name : (pr.keywords || pr.name);
      const url = buildLink(adv, kw, rawUrl);
      if (!url) continue;
      // Affiche le vrai prix si dispo, sinon "Voir prix"
      const displayPrice = (pr.price && pr.price !== "null" && pr.price !== "undefined" && pr.price.length > 0)
        ? pr.price : "Voir prix";
      buttons += cardProduct(pr.name, displayPrice, url, adv, pr.img||null, pr.badge||null);
    }

    let promoHtml = "";
    for (const c of promos.sort(function(a,b){return (b.best?1:0)-(a.best?1:0);}).slice(0,2)) {
      promoHtml += promoBox(c.code, c.store||"boutique", c.discount||"Reduction exclusive", c.best||false);
    }

    const first = products.find(function(p){return (p.store||"").toLowerCase().includes("amazon");})||products[0];
    let wishHtml = "";
    if (first) {
      const adv0 = findAdv(advertisers, first.store)||{slug:"amazon", name:"Amazon", color:"#e47911", active:true};
      const wUrl = buildLink(adv0, first.keywords||first.name, first.url||null)||"";
      const wD = JSON.stringify({type:"product", name:first.name, price:first.price, store:first.store, url:wUrl}).replace(/"/g,"&quot;");
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
