export const config = { runtime: 'edge', maxDuration: 60 };

// ─────────────────────────────────────────────────────────────────────────────
// HUNTIFY v4 — Agent IA shopping + voyage
// Architecture : Groq DeepSearch (gratuit) → Claude web_search (si ASIN invalide)
// Voyage : Groq → DeepSeek → Mistral → Claude
// ─────────────────────────────────────────────────────────────────────────────

const SUPABASE_URL  = "https://enocxbrqyybendertytl.supabase.co";
const SUPABASE_KEY  = "sb_publishable_NmPh--frZG5HuqfaoxnemA_E7cidV9Y";
const AMAZON_TAG    = "huntify21-21";
const AWIN_PUB      = "2920215";
const RAKUTEN_MID   = "55615";
const TP_MARKER     = "536663";
const MODEL         = "claude-haiku-4-5";
const BOOKING_AID   = process.env.BOOKING_AID || "2311236";

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
  phuket:"HKT",hongkong:"HKG",seoul:"ICN",sydney:"SYD",dubrovnik:"DBV"
};

function toIATA(s) {
  if (!s) return null;
  const c = (s||"").match(/\b([A-Z]{3})\b/);
  if (c) return c[1];
  const k = s.toLowerCase().trim();
  for (const [n,v] of Object.entries(IATA)) { if (k.includes(n)) return v; }
  return null;
}

// ── FETCH AVEC TIMEOUT ───────────────────────────────────────────────────────
// Evite les 504 : chaque appel IA a un timeout strict
async function fetchWithTimeout(url, opts, ms) {
  ms = ms||12000;
  var ctrl = new AbortController();
  var timer = setTimeout(function(){ ctrl.abort(); }, ms||8000);
  try {
    var r = await fetch(url, Object.assign({}, opts, {signal: ctrl.signal}));
    clearTimeout(timer);
    return r;
  } catch(e) {
    clearTimeout(timer);
    return null;
  }
}

// ── SUPABASE ──────────────────────────────────────────────────────────────────
async function sbFetch(path, method, body) {
  const opts = {
    method:method||"GET",
    headers:{"Content-Type":"application/json","apikey":SUPABASE_KEY,"Authorization":"Bearer "+SUPABASE_KEY}
  };
  if (body) opts.body = JSON.stringify(body);
  try { const r = await fetch(SUPABASE_URL+"/rest/v1/"+path,opts); return await r.json(); } catch(e){return null;}
}

async function getAdvertisers() {
  try {
    const r = await fetch(SUPABASE_URL+"/rest/v1/advertisers?active=eq.true",{
      headers:{"apikey":SUPABASE_KEY,"Authorization":"Bearer "+SUPABASE_KEY}
    });
    const d = await r.json();
    return Array.isArray(d)?d:[];
  } catch(e){return [];}
}

// ── LIENS ─────────────────────────────────────────────────────────────────────
function amazonLink(keywords, asin) {
  const validAsin = asin && /^B[A-Z0-9]{9}$/.test(asin);
  const base = validAsin
    ? "https://www.amazon.fr/dp/"+asin
    : "https://www.amazon.fr/s?k="+encodeURIComponent((keywords||"").replace(/\s+/g," ").trim().slice(0,80));
  return base+"?tag="+AMAZON_TAG;
}

function rakutenLink(keywords) {
  const kw = (keywords||"").replace(/\s+/g,"+").trim().slice(0,80);
  const dest = "https://fr.shopping.rakuten.com/s/"+encodeURIComponent(kw);
  return "https://www.awin1.com/cread.php?awinmid="+RAKUTEN_MID+"&awinaffid="+AWIN_PUB+"&clickref=huntify&ued="+encodeURIComponent(dest);
}

function bookingLink(dest, ci, co, adults, cat) {
  const rooms = Math.ceil((adults||2)/2);
  let url = "https://www.booking.com/searchresults.html"
    +"?ss="+encodeURIComponent(dest||"")
    +"&group_adults="+(adults||2)+"&no_rooms="+rooms
    +"&lang=fr&selected_currency=EUR&aid="+BOOKING_AID;
  if (ci) url += "&checkin="+ci;
  if (co) url += "&checkout="+co;
  if (cat==="budget")  url += "&nflt=class%3D2%3Bclass%3D3";
  if (cat==="confort") url += "&nflt=class%3D3%3Bclass%3D4";
  if (cat==="luxe")    url += "&nflt=class%3D4%3Bclass%3D5";
  return url+"&order=popularity";
}

function bookingHotelLink(hotelName, dest, ci, co, adults) {
  // Lien vers un hotel specifique sur Booking
  const url = "https://www.booking.com/search.html"
    +"?ss="+encodeURIComponent((hotelName||dest||"")+" "+( dest||""))
    +"&group_adults="+(adults||2)+"&no_rooms="+Math.ceil((adults||2)/2)
    +"&lang=fr&selected_currency=EUR&aid="+BOOKING_AID;
  var r = url;
  if (ci) r += "&checkin="+ci;
  if (co) r += "&checkout="+co;
  return r;
}

function expediaLink(dest, ci, co, adults) {
  let url = "https://www.expedia.fr/Hotel-Search"
    +"?destination="+encodeURIComponent(dest||"")+"&adults="+(adults||2)+"&sort=RECOMMENDED";
  if (ci) url += "&startDate="+ci;
  if (co) url += "&endDate="+co;
  const aid = process.env.EXPEDIA_AID||"";
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
  return dest ? base+"?to="+encodeURIComponent(dest)+(ci?"&date="+ci:"") : base;
}

// ── HOTELLOOK API ─────────────────────────────────────────────────────────────
async function fetchHotelPrices(dest, ci, co, adults) {
  const token = process.env.TRAVELPAYOUTS_TOKEN;
  if (!token||!dest||!ci||!co) return null;
  try {
    const url = "https://engine.hotellook.com/api/v2/cache.json"
      +"?location="+encodeURIComponent(dest)
      +"&checkIn="+ci+"&checkOut="+co
      +"&adultsCount="+(adults||2)+"&currency=EUR&token="+token+"&limit=30";
    const r = await fetch(url,{headers:{"Accept":"application/json"}});
    if (!r.ok) return null;
    const data = await r.json();
    if (!Array.isArray(data)||data.length<2) return null;
    const valid = data
      .filter(function(h){return h.priceFrom&&(h.hotelName||h.name);})
      .map(function(h){return {
        name:h.hotelName||h.name, stars:Math.round(h.stars||3),
        price:Math.round(h.priceFrom), loc:(h.location&&h.location.name)||dest,
        id:h.id
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
  } catch(e){return null;}
}

// ── DATE PARSER ───────────────────────────────────────────────────────────────
function parseDate(s) {
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const now = new Date();
  const add = function(n){const d=new Date(now);d.setDate(d.getDate()+n);return d.toISOString().slice(0,10);};
  const l = s.toLowerCase().trim();
  if (l==="demain") return add(1);
  const slash = s.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (slash){const y=slash[3].length===2?"20"+slash[3]:slash[3];return y+"-"+slash[2].padStart(2,"0")+"-"+slash[1].padStart(2,"0");}
  const MO={jan:1,janv:1,fev:2,mars:3,avr:4,avril:4,mai:5,juin:6,juil:7,juillet:7,aout:8,sep:9,sept:9,oct:10,nov:11,dec:12};
  const mn=l.match(/(\d{1,2})\s+([a-z\u00e9\u00fb\u00f4\u00e0]+)(?:\s+(\d{4}))?/);
  if (mn){
    const mo=Object.entries(MO).find(function(e){return mn[2].startsWith(e[0]);});
    if (mo){let y=mn[3]||String(now.getFullYear());return y+"-"+String(mo[1]).padStart(2,"0")+"-"+mn[1].padStart(2,"0");}
  }
  return null;
}

// ── HISTORIQUE ────────────────────────────────────────────────────────────────
function fmtHist(history, max) {
  return ((history||[]).map(function(m){
    const who = m.role==="user"?"Vous":"Huntify";
    const txt = (m.content||"").replace(/<[^>]*>/g," ").replace(/\s+/g," ").trim().slice(0,400);
    return txt?who+": "+txt:null;
  }).filter(Boolean).join("\n")).slice(0,max||2500);
}

// ── IA CASCADE ────────────────────────────────────────────────────────────────
async function groq(sys, user, maxTok) {
  const k=process.env.GROQ_API_KEY; if(!k) return null;
  try {
    const r=await fetchWithTimeout("https://api.groq.com/openai/v1/chat/completions",{
      method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+k},
      body:JSON.stringify({model:"llama-3.3-70b-versatile",max_tokens:maxTok||500,temperature:0.2,
        messages:[{role:"system",content:sys},{role:"user",content:user}]})
    },8000);
    if(!r||!r.ok) return null;
    const d=await r.json(); return d.choices&&d.choices[0]?d.choices[0].message.content:null;
  } catch(e){return null;}
}

async function groqSearch(prompt, maxTok) {
  const k=process.env.GROQ_API_KEY; if(!k) return null;
  try {
    const r=await fetchWithTimeout("https://api.groq.com/openai/v1/chat/completions",{
      method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+k},
      body:JSON.stringify({model:"compound-beta",max_tokens:maxTok||1500,
        messages:[{role:"user",content:prompt}]})
    },18000);
    if(!r.ok) return await groq("Reponds en JSON.",prompt,maxTok||1500);
    const d=await r.json(); return d.choices&&d.choices[0]?d.choices[0].message.content:null;
  } catch(e){return await groq("Reponds en JSON.",prompt,maxTok||1500);}
}

async function gemini(prompt, maxTok) {
  const k=process.env.GEMINI_API_KEY; if(!k) return null;
  try {
    const r=await fetchWithTimeout("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key="+k,{
      method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{maxOutputTokens:maxTok||500,temperature:0.2}})
    },8000);
    if(!r||!r.ok) return null;
    const d=await r.json(); return d.candidates&&d.candidates[0]?d.candidates[0].content.parts[0].text:null;
  } catch(e){return null;}
}

async function mistral(sys, user, maxTok) {
  const k=process.env.MISTRAL_API_KEY; if(!k) return null;
  try {
    const r=await fetchWithTimeout("https://api.mistral.ai/v1/chat/completions",{
      method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+k},
      body:JSON.stringify({model:"mistral-small-latest",max_tokens:maxTok||500,temperature:0.2,
        messages:[{role:"system",content:sys},{role:"user",content:user}]})
    },8000);
    if(!r||!r.ok) return null;
    const d=await r.json(); return d.choices&&d.choices[0]?d.choices[0].message.content:null;
  } catch(e){return null;}
}

async function deepseek(sys, user, maxTok) {
  const k=process.env.DEEPSEEK_API_KEY; if(!k) return null;
  try {
    const r=await fetchWithTimeout("https://api.deepseek.com/v1/chat/completions",{
      method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+k},
      body:JSON.stringify({model:"deepseek-chat",max_tokens:maxTok||500,temperature:0.2,
        messages:[{role:"system",content:sys},{role:"user",content:user}]})
    },8000);
    if(!r||!r.ok) return null;
    const d=await r.json(); return d.choices&&d.choices[0]?d.choices[0].message.content:null;
  } catch(e){return null;}
}

async function claudeAI(sys, user, maxTok, tools) {
  const k=process.env.ANTHROPIC_API_KEY; if(!k) return null;
  try {
    const payload={model:MODEL,max_tokens:maxTok||800,system:sys,messages:[{role:"user",content:user}]};
    if(tools&&tools.length) payload.tools=tools;
    const r=await fetchWithTimeout("https://api.anthropic.com/v1/messages",{
      method:"POST",
      headers:{"Content-Type":"application/json","x-api-key":k,"anthropic-version":"2023-06-01"},
      body:JSON.stringify(payload)
    },12000);
    const d=await r.json(); if(!r.ok) return null;
    let t=""; for(const b of (d.content||[])){if(b.type==="text")t+=b.text;} return t||null;
  } catch(e){return null;}
}

// Cascade gratuite : Groq → Gemini → Mistral → DeepSeek
async function freeAI(sys, user, maxTok) {
  return await groq(sys,user,maxTok)
    || await gemini(sys+"\n\n"+user,maxTok)
    || await mistral(sys,user,maxTok)
    || await deepseek(sys,user,maxTok);
}

function parseJSON(raw) {
  if (!raw) return {};
  // 1. Bloc code markdown
  try { var m=raw.match(/```(?:json)?\s*([\s\S]*?)```/); if(m) return JSON.parse(m[1].trim()); } catch(e){}
  // 2. JSON direct
  try { var m2=raw.match(/\{[\s\S]*\}/); if(m2) return JSON.parse(m2[0]); } catch(e){}
  // 3. Cherche le premier { et extrait jusqu au } correspondant
  try {
    var start = raw.indexOf('{');
    if (start >= 0) {
      var depth = 0, end = -1;
      for (var i=start; i<raw.length; i++) {
        if (raw[i]==='{') depth++;
        else if (raw[i]==='}') { depth--; if (depth===0) { end=i; break; } }
      }
      if (end > start) return JSON.parse(raw.slice(start, end+1));
    }
  } catch(e){}
  return {};
}

async function dbLookup(kw) {
  const k=(kw||"").toLowerCase().split(" ")[0];
  try {
    const [deals,promos]=await Promise.all([
      sbFetch("daily_deals?name=ilike.*"+encodeURIComponent(k)+"*&limit=3"),
      sbFetch("promo_codes?valid=eq.true&order=found_at.desc&limit=2")
    ]);
    const parts=[];
    if(deals&&deals.length) parts.push("Deals: "+deals.map(function(x){return x.name+" "+x.price+"EUR";}).join("|"));
    if(promos&&promos.length) parts.push("Codes: "+promos.map(function(x){return x.code+"("+x.store+")";}).join("|"));
    return parts.join("\n");
  } catch(e){return "";}
}

// ── COMPOSANTS HTML PREMIUM ──────────────────────────────────────────────────

// ── PLANIFIER ─────────────────────────────────────────────────────────────────
function planButton(msg) {
  var safe = (msg||"").replace(/\\/g,"\\\\").replace(/'/g,"\\'").replace(/\n/g," ");
  var oc = "(function(){"
    +"var m='"+safe+"';"
    +"var sel='textarea,input[type=text],input[name=message],[contenteditable=true],.chat-input,#chat-input,#message';"
    +"var t=document.querySelector(sel);"
    +"if(t){"
    +"if(typeof t.value!=='undefined')t.value=m;"
    +"else t.textContent=m;"
    +"['input','change'].forEach(function(ev){t.dispatchEvent(new Event(ev,{bubbles:true}));});"
    +"setTimeout(function(){"
    +"var f=t.closest('form');"
    +"var b=f?f.querySelector('button[type=submit],button:last-of-type')"
    +":document.querySelector('button[type=submit],#send-btn,.send-btn,[data-send],[aria-label=Envoyer]');"
    +"if(b)b.click();"
    +"else t.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',keyCode:13,bubbles:true}));"
    +"},100);}"
    +"if(window.sendPrompt)window.sendPrompt(m);"
    +"window.dispatchEvent(new CustomEvent('huntify_send',{detail:{message:m,mode:'travel'}}));"
    +"})()";
  return "<button onclick=\""+oc+"\" "
    +"style=\"flex:1;display:flex;justify-content:center;align-items:center;gap:6px;"
    +"background:linear-gradient(135deg,#2f54ff,#4a6bff);border:none;color:#fff;"
    +"border-radius:10px;padding:10px 8px;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit\">"
    +"\uD83D\uDDFA\uFE0F Planifier</button>";
}

// ── HERO ──────────────────────────────────────────────────────────────────────
function renderHero(itin, fCi, fCo) {
  var badges = (itin.badges||[]).map(function(b){
    return "<div style=\"background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.11);border-radius:4px;padding:4px 11px;font-size:12px;color:#d4cfc9\">"+b+"</div>";
  }).join("");
  return "<div style=\"background:#1c1a17;color:white;padding:28px 20px 22px;border-radius:16px;position:relative;overflow:hidden;margin-bottom:4px\">"
    +"<div style=\"position:absolute;top:-30px;right:-30px;width:200px;height:200px;background:radial-gradient(circle,rgba(192,96,58,.22) 0%,transparent 65%);pointer-events:none\"></div>"
    +"<div style=\"font-size:10px;letter-spacing:.15em;text-transform:uppercase;color:#e8917a;margin-bottom:8px\">"+(itin.eyebrow||"\uD83C\uDF0D Itineraire Premium")+"</div>"
    +"<div style=\"font-size:28px;font-weight:800;color:#fff;line-height:1.1;margin-bottom:6px\">"+(itin.flag||"\u2708\uFE0F")+" "+(itin.dest||"")+(itin.country?", "+itin.country:"")+"</div>"
    +"<div style=\"color:#a8a09a;font-size:13px;font-weight:300;margin-bottom:10px\">"+(itin.style||"")+"</div>"
    +"<div style=\"display:inline-flex;align-items:center;gap:10px;background:rgba(192,96,58,.18);border:1px solid rgba(232,145,122,.35);border-radius:6px;padding:7px 14px;margin-bottom:16px;font-size:12px;font-weight:600;color:#e8917a\">"
    +"\uD83D\uDCC5 "+(fCi||"")+" \u2014 "+(fCo||"")+(itin.dep?" \u00B7 Depuis "+itin.dep:"")+"</div>"
    +(badges?"<div style=\"display:flex;gap:8px;flex-wrap:wrap\">"+badges+"</div>":"")
    +"</div>";
}

// ── METEO ─────────────────────────────────────────────────────────────────────
function renderMeteo(meteo) {
  if (!meteo||!meteo.length) return "";
  var days = meteo.map(function(m){
    return "<div style=\"background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.1);border-radius:5px;padding:7px 10px;text-align:center;min-width:60px\">"
      +"<div style=\"font-size:9px;color:#7aaac8;margin-bottom:2px\">"+(m.date||"")+"</div>"
      +"<div style=\"font-size:16px;margin-bottom:1px\">"+(m.icon||"\u2600\uFE0F")+"</div>"
      +"<div style=\"font-size:11px;font-weight:600;color:white\">"+(m.temp||"")+"</div>"
      +"<div style=\"font-size:9px;color:#7aaac8\">"+(m.desc||"")+"</div>"
      +"</div>";
  }).join("");
  return "<div style=\"background:linear-gradient(135deg,#1a3a5c,#0d2840);padding:12px 16px;display:flex;align-items:center;gap:16px;flex-wrap:wrap;border-radius:0;margin-bottom:4px\">"
    +"<div>"
    +"<div style=\"font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:#5a9ac0;margin-bottom:5px\">\u2600\uFE0F Meteo prevue</div>"
    +"<div style=\"display:flex;gap:6px;flex-wrap:wrap\">"+days+"</div>"
    +"</div>"
    +"<div style=\"font-size:11px;color:#7aaac8;max-width:200px;line-height:1.4\">Conditions ideales pour votre voyage \u2705</div>"
    +"</div>";
}

// ── BANNER VOLS ───────────────────────────────────────────────────────────────
function renderFlightsBanner(f, fCi, fCo, fAd, dep, dest) {
  if (!f||!f.out) return "";
  var sky = skyscannerLink(f.out.from||dep, f.out.to||dest, fCi, fCo, fAd);
  function leg(isRet, flight, date) {
    return "<div style=\"padding:16px 18px;display:flex;align-items:center;gap:14px;"+(isRet?"border-left:1px solid rgba(255,255,255,.1)":"")+"align-items:center\">"
      +"<div style=\"font-size:22px\">"+(isRet?"\uD83D\uDEEC":"\uD83D\uDEEB")+"</div>"
      +"<div style=\"flex:1\">"
      +"<div style=\"font-size:10px;letter-spacing:.09em;text-transform:uppercase;color:#5a7090;margin-bottom:2px\">"+(isRet?"Retour":"Aller")+(date?" \u00B7 "+date:"")+"</div>"
      +"<div style=\"font-weight:700;font-size:14px;color:white;margin-bottom:2px\">"+(flight.from||"")+" \u2192 "+(flight.to||"")+"</div>"
      +"<div style=\"font-size:11px;color:#8aa0b8\">"+(flight.co||"")+(flight.dur?" \u00B7 "+flight.dur:"")+"</div>"
      +"</div>"
      +"<div style=\"font-size:19px;font-weight:700;color:#e8917a;white-space:nowrap\">~"+(flight.prix||flight.price||"?")+"\u20AC</div>"
      +"</div>";
  }
  return "<div style=\"background:#0a1628;border-radius:12px;overflow:hidden;margin-bottom:4px;\">"
    +"<div style=\"display:grid;grid-template-columns:1fr 1fr;border-bottom:3px solid #c0603a\">"
    +leg(false, f.out, f.out.date||fCi)
    +leg(true,  f.ret||{from:f.out.to,to:f.out.from,prix:f.out.prix,co:f.out.co,dur:f.out.dur}, f.ret&&f.ret.date||fCo)
    +"</div>"
    +"<a href=\""+sky+"\" target=\"_blank\" style=\"display:flex;justify-content:center;padding:10px;background:rgba(47,84,255,.2);color:#7c9fff;font-size:11px;font-weight:700;text-decoration:none;\">\uD83D\uDD0D Comparer et reserver sur Skyscanner \u2192</a>"
    +"</div>";
}

// ── NUITS OVERVIEW ────────────────────────────────────────────────────────────
function renderNightsOverview(nuits) {
  if (!nuits||!nuits.length) return "";
  var cells = nuits.map(function(n, i){
    var hi = n.highlight||i===0;
    return "<div style=\"border:1px solid "+(hi?"#c0603a":"#e4ded5")+";"
      +"border-right:"+(i===nuits.length-1?"1px solid "+(hi?"#c0603a":"#e4ded5"):"none")+";"
      +"padding:11px 10px;background:"+(hi?"#c0603a":"#f5f0e8")+";\""
      +(!i?"border-radius:8px 0 0 8px":i===nuits.length-1?"border-radius:0 8px 8px 0":"")+">"
      +"<div style=\"font-size:9px;text-transform:uppercase;letter-spacing:.07em;color:"+(hi?"rgba(255,255,255,.55)":"#7a7570")+"\">"+( n.date||"Nuit "+n.n)+"</div>"
      +"<div style=\"font-weight:700;font-size:12px;color:"+(hi?"#fff":"#1c1a17")+"\">"+( n.lieu||"")+"</div>"
      +"<div style=\"font-size:10px;color:"+(hi?"rgba(255,255,255,.65)":"#7a7570")+"\">"+( n.hotel||"")+"</div>"
      +(n.prix?"<div style=\"font-size:11px;font-weight:600;color:"+(hi?"rgba(255,255,255,.8)":"#c0603a")+";margin-top:3px\">~"+n.prix+"\u20AC</div>":"")
      +"</div>";
  }).join("");
  return "<div style=\"background:white;padding:18px 16px;border-radius:12px;margin-bottom:4px\">"
    +"<div style=\"font-size:14px;font-weight:700;color:#1c1a17;margin-bottom:12px\">"+(nuits.length)+" nuits</div>"
    +"<div style=\"display:grid;grid-template-columns:repeat("+nuits.length+",1fr)\">"+cells+"</div>"
    +"</div>";
}

// ── TRAJET BAR ────────────────────────────────────────────────────────────────
function renderTrajetBar(steps) {
  if (!steps||!steps.length) return "";
  var html = "<div style=\"display:flex;align-items:center;flex-wrap:wrap;gap:5px;padding:9px 14px;background:#f7f3ee;border-bottom:1px solid #ede8e0;font-size:11px;\">";
  for (var i=0; i<steps.length; i++) {
    var s = steps[i];
    if (s.arrow) {
      html += "<span style=\"color:#c0603a;font-size:13px;font-weight:700\">\u2192</span>";
    } else {
      html += "<div style=\"display:flex;align-items:center;gap:4px;background:white;border:1px solid #e4ded5;border-radius:20px;padding:3px 9px;font-weight:500\">"
        +(s.icon?"<span>"+s.icon+"</span>":"")
        +"<span>"+( s.label||"")+"</span>"
        +(s.time?"<span style=\"font-size:10px;color:#7a7570\">"+s.time+"</span>":"")
        +(s.prix?"<span style=\"font-size:10px;font-weight:700;color:#c0603a\">"+s.prix+"</span>":"")
        +"</div>";
    }
  }
  html += "</div>";
  return html;
}

// ── CHIPS ─────────────────────────────────────────────────────────────────────
function renderChip(chip) {
  var styles = {
    t:"background:#fff5f2;border:1px solid #f5c9b5;color:#c0603a",   // transport
    k:"background:#eff8fb;border:1px solid #bfe0e8;color:#2e6e7e",   // activite payante
    f:"background:#d8eddf;border:1px solid #b2d9bc;color:#3d6b4a",   // gratuit
    g:"background:#f5f0e8;border:1px solid #ddd6c8;color:#5a5550",   // info
    l:"background:#eae5f5;border:1px solid #c8bcec;color:#5a4a8a"    // logistique
  };
  var st = styles[chip.type||"g"]||styles.g;
  return "<span style=\"border-radius:4px;padding:3px 9px;font-size:11px;font-weight:500;"+st+"\">"+chip.text+"</span>";
}

// ── BOXES TIP/WARN/STAR ───────────────────────────────────────────────────────
function renderBox(tip) {
  var styles = {
    tip: "background:#eff8fb;border-left:3px solid #2e6e7e;color:#1e5a6a",
    warn:"background:#fff9e6;border-left:3px solid #b8941a;color:#6a5008",
    star:"background:#fff5f2;border-left:3px solid #c0603a;color:#6a2a08"
  };
  var st = styles[tip.type||"tip"]||styles.tip;
  return "<div style=\""+st+";border-radius:0 5px 5px 0;padding:8px 12px;font-size:11px;margin-top:7px;line-height:1.5\">"+tip.text+"</div>";
}

// ── SLOT HORAIRE ──────────────────────────────────────────────────────────────
function renderSlot(slot, isLast) {
  var chips = (slot.chips||[]).map(renderChip).join(" ");
  var tips  = (slot.tips||[]).map(renderBox).join("");
  var restoHtml = "";
  if (slot.resto) {
    var r = slot.resto;
    restoHtml = "<div style=\"display:flex;gap:10px;margin-top:9px;padding:11px 13px;background:#f7f3ee;border-radius:8px;font-size:12px;\">"
      +"<div style=\"font-size:19px;flex-shrink:0\">"+(r.emoji||"\uD83C\uDF7D\uFE0F")+"</div>"
      +"<div style=\"flex:1\">"
      +"<div style=\"font-weight:700;font-size:12px;margin-bottom:1px\">"+(r.nom||r.name||"")+"</div>"
      +(r.note?"<div style=\"color:#b8941a;font-size:10px;margin-bottom:2px\">"+r.note+"</div>":"")
      +(r.desc?"<div style=\"color:#7a7570;font-size:11px;line-height:1.4\">"+r.desc+"</div>":"")
      +(r.prix?"<div style=\"font-weight:700;color:#c0603a;margin-top:3px;font-size:11px\">"+r.prix+"</div>":"")
      +"</div></div>";
  }
  return "<div style=\"display:flex;border-bottom:"+(isLast?"none":"1px solid #f0ebe4")+";background:white\">"
    +"<div style=\"width:70px;flex-shrink:0;padding:14px 8px;display:flex;flex-direction:column;align-items:center;gap:3px\">"
    +"<div style=\"font-size:18px\">"+(slot.slot_icon||"\u26AA")+"</div>"
    +"<div style=\"font-size:8px;text-transform:uppercase;letter-spacing:.07em;color:#94a3b8;text-align:center\">"+(slot.slot_label||"")+"</div>"
    +"</div>"
    +"<div style=\"flex:1;padding:14px 16px;border-left:1px solid #f0ebe4\">"
    +"<div style=\"font-weight:600;font-size:13px;margin-bottom:4px\">"+(slot.title||"")+"</div>"
    +"<div style=\"font-size:12px;color:#7a7570;line-height:1.5\">"+(slot.desc||"")+"</div>"
    +(chips?"<div style=\"display:flex;flex-wrap:wrap;gap:5px;margin-top:7px\">"+chips+"</div>":"")
    +tips
    +restoHtml
    +"</div></div>";
}

// ── CARTE JOUR ────────────────────────────────────────────────────────────────
function cardDay(jour) {
  var bgColors = ["#2a1a0e","#0a2030","#093020","#0a2020","#1a0a2a","#0a1a3a"];
  var bg = bgColors[(jour.n-1)%bgColors.length]||"#1a1a2e";
  var slots = jour.slots||[];
  var slotsHtml = slots.map(function(s,i){return renderSlot(s,i===slots.length-1);}).join("");
  
  return "<div style=\"border:1px solid #e4ded5;border-radius:12px;overflow:hidden;margin-top:12px\">"
    // Header
    +"<div style=\"background:"+bg+";padding:13px 18px;display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px\">"
    +"<div>"
    +"<div style=\"font-size:10px;color:rgba(255,255,255,.4);margin-bottom:2px\">"+(jour.date||"")+(jour.meteo_icon?" \u00B7 "+jour.meteo_icon+" "+(jour.meteo_temp||""):"")+"</div>"
    +"<div style=\"font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:#e8917a;margin-bottom:2px\">"+(jour.tag||"")+"</div>"
    +"<div style=\"font-size:18px;font-weight:800;color:#fff\">"+(jour.titre||"")+"</div>"
    +"</div>"
    +(jour.budget_jour?"<div style=\"text-align:right\"><div style=\"font-size:20px;font-weight:700;color:#e8917a\">~"+jour.budget_jour+"\u20AC</div><div style=\"font-size:10px;color:rgba(255,255,255,.3)\">budget jour</div></div>":"")
    +"</div>"
    // Bande hotel
    +(jour.hotel_soir?"<div style=\"display:flex;align-items:center;gap:12px;padding:9px 18px;background:#242220;border-bottom:1px solid #333\">"
      +"<div><div style=\"font-size:9px;text-transform:uppercase;letter-spacing:.07em;color:#6a6460\">\uD83D\uDECC Hotel ce soir</div>"
      +"<div style=\"font-size:12px;font-weight:600;color:white\">"+(jour.hotel_soir.nom||"")+"</div>"
      +"<div style=\"font-size:10px;color:#7a7470\">"+(jour.hotel_soir.adresse||"")+"</div></div>"
      +(jour.hotel_soir.prix?"<div style=\"margin-left:auto;font-size:14px;font-weight:700;color:#e8917a;white-space:nowrap\">~"+jour.hotel_soir.prix+"\u20AC/nuit</div>":"")
      +"</div>":"")
    // Trajet bar
    +renderTrajetBar(jour.trajet_steps||[])
    // Slots
    +slotsHtml
    +"</div>";
}

// ── RECAP TRAJETS ─────────────────────────────────────────────────────────────
function renderTrajetsRecap(trajets) {
  if (!trajets||!trajets.length) return "";
  var cards = trajets.map(function(tr){
    var steps = (tr.steps||[]).map(function(s){
      return "<li style=\"position:relative;padding:3px 0;font-size:11px;color:#7a7570\">"+s+"</li>";
    }).join("");
    return "<div style=\"background:white;border:1px solid #e4ded5;border-radius:10px;overflow:hidden;margin-bottom:10px\">"
      +"<div style=\"padding:10px 16px;background:#f7f3ee;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;border-bottom:1px solid #e4ded5\">"
      +"<div style=\"font-weight:700;font-size:13px\">"+(tr.route||"")
      +(tr.date?"<span style=\"font-size:10px;color:#7a7570;font-weight:400\"> \u00B7 "+tr.date+"</span>":"")+"</div>"
      +"<div style=\"display:flex;gap:12px;align-items:center\">"
      +(tr.duree?"<span style=\"font-size:11px;color:#7a7570\">\u23F1 "+tr.duree+"</span>":"")
      +(tr.prix?"<span style=\"font-weight:700;color:#c0603a;font-size:14px\">~"+tr.prix+"\u20AC</span>":"")
      +(tr.optimise?"<span style=\"background:#3d6b4a;color:white;border-radius:3px;padding:1px 6px;font-size:9px;font-weight:700\">\u2713 OPTIMISE</span>":"")
      +"</div></div>"
      +(steps?"<div style=\"padding:12px 16px\"><ul style=\"list-style:none;border-left:2px solid #e4ded5;padding-left:14px\">"+steps+"</ul></div>":"")
      +"</div>";
  }).join("");
  return "<div style=\"background:#f5f0e8;padding:18px 16px;border-radius:12px;margin-bottom:4px\">"
    +"<div style=\"font-size:16px;font-weight:700;color:#1c1a17;margin-bottom:4px\">\uD83D\uDE84 Recapitulatif des trajets</div>"
    +"<div style=\"font-size:12px;color:#7a7570;margin-bottom:14px\">Prix et durees reels verifies</div>"
    +cards+"</div>";
}

// ── HOTELS SECTION ────────────────────────────────────────────────────────────
function renderHotels(hotels) {
  if (!hotels||!hotels.length) return "";
  var cards = hotels.map(function(h){
    var features = (h.features||[]).map(function(f){
      return "<span style=\"background:white;border:1px solid #e4ded5;border-radius:3px;padding:2px 6px;font-size:9px\">"+f+"</span>";
    }).join("");
    return "<div style=\"border:1px solid #e4ded5;border-radius:10px;overflow:hidden\">"
      +"<div style=\"padding:12px 14px 9px;display:flex;justify-content:space-between;align-items:flex-start;gap:8px\">"
      +"<div style=\"flex:1\">"
      +"<div style=\"font-size:9px;letter-spacing:.09em;text-transform:uppercase;color:#c0603a;font-weight:600;margin-bottom:2px\">"+(h.nuits_label||"")+"</div>"
      +"<div style=\"font-weight:700;font-size:13px;line-height:1.3\">"+(h.nom||h.name||"")+"</div>"
      +"<div style=\"font-size:10px;color:#7a7570;margin-top:1px\">"+(h.adresse||h.lieu||"")+"</div>"
      +"</div>"
      +"<div style=\"text-align:right;flex-shrink:0\">"
      +"<div style=\"font-size:17px;font-weight:700;color:#c0603a\">~"+(h.prix_nuit||h.price||"?")+"\u20AC</div>"
      +"<div style=\"font-size:9px;color:#7a7570\">/nuit</div></div></div>"
      +"<div style=\"padding:9px 14px 12px;background:#f5f0e8;border-top:1px solid #e4ded5\">"
      +"<div style=\"color:#b8941a;font-size:11px;margin-bottom:2px\">"+(h.note||"")+"</div>"
      +(h.desc?"<div style=\"font-size:11px;color:#7a7570;line-height:1.5;margin-bottom:6px\">"+h.desc+"</div>":"")
      +(features?"<div style=\"display:flex;flex-wrap:wrap;gap:4px\">"+features+"</div>":"")
      +"</div></div>";
  }).join("");
  return "<div style=\"background:white;padding:18px 16px;border-radius:12px;margin-bottom:4px\">"
    +"<div style=\"font-size:16px;font-weight:700;color:#1c1a17;margin-bottom:4px\">\uD83C\uDFE8 Hebergements</div>"
    +"<div style=\"font-size:12px;color:#7a7570;margin-bottom:14px\">Meme hotel 2 nuits par etape</div>"
    +"<div style=\"display:grid;grid-template-columns:1fr 1fr;gap:10px\">"+cards+"</div>"
    +"</div>";
}

// ── BUDGET ────────────────────────────────────────────────────────────────────
function cardBudget(b) {
  var items = b.items||[
    {cat:"\u2708\uFE0F Vols A/R", montant:b.vols, note:""},
    {cat:"\uD83C\uDFE8 Hebergement", montant:b.hotel, note:""},
    {cat:"\uD83C\uDFAF Activites", montant:b.activites||b.acts, note:""},
    {cat:"\uD83C\uDF7D\uFE0F Restaurants", montant:b.resto, note:""},
    {cat:"\uD83D\uDE87 Transports", montant:b.transport, note:""}
  ].filter(function(r){return r.montant!=null;});
  var grid = items.map(function(it){
    return "<div style=\"background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.08);border-radius:7px;padding:11px\">"
      +"<div style=\"font-size:9px;letter-spacing:.09em;text-transform:uppercase;color:#8a8580;margin-bottom:3px\">"+it.cat+"</div>"
      +"<div style=\"font-size:20px;font-weight:700;color:#e8917a\">~"+it.montant+"\u20AC</div>"
      +(it.note?"<div style=\"font-size:10px;color:#6a6560;margin-top:1px\">"+it.note+"</div>":"")
      +"</div>";
  }).join("");
  return "<div style=\"background:#1c1a17;color:white;padding:24px 16px;border-radius:12px;margin-bottom:4px\">"
    +"<div style=\"font-size:16px;font-weight:700;margin-bottom:3px\">\uD83D\uDCB0 Budget total</div>"
    +"<div style=\"color:#9a9390;font-size:12px;margin-bottom:16px\">Par personne \u00B7 Estimations verifiees</div>"
    +"<div style=\"display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:8px;margin-bottom:18px\">"+grid+"</div>"
    +"<div style=\"border-top:1px solid rgba(255,255,255,.11);padding-top:14px\">"
    +"<div style=\"display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:5px\">"
    +"<div style=\"font-size:10px;text-transform:uppercase;letter-spacing:.09em;color:#9a9390\">Total estime / personne</div>"
    +"<div><span style=\"font-size:28px;font-weight:700\">~"+(b.par_personne||b.total||"")+"\u20AC</span></div>"
    +"</div>"
    +(b.total&&b.par_personne&&b.total!==b.par_personne?"<div style=\"font-size:12px;color:#e8917a;margin-top:4px\">soit ~"+b.total+"\u20AC pour 2 personnes</div>":"")
    +"<div style=\"font-size:10px;color:rgba(255,255,255,.35);margin-top:8px\">Cliquez les liens pour les vrais prix en temps reel</div>"
    +"</div></div>";
}

// ── TIPS GRID ─────────────────────────────────────────────────────────────────
function cardTips(conseils) {
  if (!conseils||!conseils.length) return "";
  var cards = conseils.map(function(c){
    return "<div style=\"background:#f5f0e8;border-radius:7px;padding:13px\">"
      +"<div style=\"font-size:18px;margin-bottom:5px\">"+(c.icon||"\uD83D\uDCA1")+"</div>"
      +"<div style=\"font-weight:600;font-size:12px;margin-bottom:3px\">"+(c.titre||c.title||"")+"</div>"
      +"<div style=\"font-size:11px;color:#7a7570;line-height:1.5\">"+(c.corps||c.body||"")+"</div>"
      +"</div>";
  }).join("");
  return "<div style=\"background:white;padding:18px 16px;border-radius:12px\">"
    +"<div style=\"font-size:16px;font-weight:700;color:#1c1a17;margin-bottom:4px\">\uD83D\uDCA1 Conseils pratiques</div>"
    +"<div style=\"font-size:12px;color:#7a7570;margin-bottom:14px\">L essentiel pour que tout roule</div>"
    +"<div style=\"display:grid;grid-template-columns:1fr 1fr;gap:10px\">"+cards+"</div>"
    +"</div>";
}

// ── PRODUIT ───────────────────────────────────────────────────────────────────
function cardProduct(name, price, url, storeName, storeColor, storeEmoji, badge) {
  var priceTag = (price&&price!=="null"&&price!=="undefined"&&price!=="Voir prix"&&price!=="0") ? price : "Voir prix";
  return "<a href=\""+url+"\" target=\"_blank\" rel=\"sponsored noopener\" "
    +"style=\"display:flex;align-items:center;gap:12px;background:"+storeColor+";color:#fff;"
    +"text-decoration:none;border-radius:14px;padding:13px 14px;margin-top:8px\">"
    +"<div style=\"flex:1;min-width:0\">"
    +"<div style=\"font-size:10px;margin-bottom:4px;opacity:.85\">"
    +"<span style=\"background:rgba(255,255,255,.22);border-radius:100px;padding:2px 9px;font-size:10px;font-weight:800\">"+storeEmoji+" "+storeName+"</span>"
    +(badge?" \u00B7 "+badge:"")+"</div>"
    +"<div style=\"font-size:13.5px;font-weight:800;line-height:1.3;word-break:break-word\">"+name+"</div></div>"
    +"<div style=\"background:rgba(255,255,255,.22);border-radius:9px;padding:6px 11px;"
    +"white-space:nowrap;font-size:14px;font-weight:900;flex-shrink:0\">"+priceTag+"</div></a>";
}

function promoBox(code, store, desc, best) {
  return "<div style=\"background:"+(best?"#dcfce7":"#f0fdf4")+";border:"+(best?"2px solid #16a34a":"1.5px solid #86efac")+";border-radius:12px;padding:10px 14px;margin-top:6px;display:flex;align-items:center;justify-content:space-between;gap:8px\">"
    +"<div><span style=\"font-size:11px;color:#16a34a;font-weight:700\">"+(best?"\u2B50 MEILLEUR \u2014 ":"")+"\uD83C\uDFF7\uFE0F "+store+"</span>"
    +"<div style=\"font-size:12px;color:#166534;font-weight:600\">"+desc+"</div></div>"
    +"<div onclick=\"navigator.clipboard.writeText('"+code+"');this.textContent='\u2713';setTimeout(()=>this.textContent='"+code+"',2000)\" "
    +"style=\"background:#16a34a;color:#fff;border-radius:8px;padding:6px 10px;font-weight:800;font-size:12px;cursor:pointer;white-space:nowrap\">"+code+"</div></div>";
}


// ── HANDLER ───────────────────────────────────────────────────────────────────
export default async function handler(req) {
  if (req.method==="OPTIONS") return new Response(null,{status:204,headers:{"Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"POST,OPTIONS","Access-Control-Allow-Headers":"Content-Type"}});
  if (req.method!=="POST") return new Response("Method not allowed",{status:405});
  const H={"Content-Type":"application/json; charset=utf-8","Access-Control-Allow-Origin":"*"};

  try {
    const body     = await req.json();
    const message  = body.message||"";
    const history  = body.history||[];
    const sid      = body.sessionId||("anon_"+Date.now());
    const isTravel = body.mode==="travel";
    const today    = new Date().toISOString().slice(0,10);
    const adv      = await getAdvertisers();
    const hist     = fmtHist(history,2500);
    const histS    = fmtHist(history,1000);

    if (body.trackingEnabled) {
      Promise.all([
        sbFetch("searches","POST",{query:message,session_id:sid,user_id:body.userId||null}),
        sbFetch("trends","POST",{query:message.toLowerCase().trim(),count:1,last_searched:new Date().toISOString()})
      ]).catch(function(){});
    }

    // MODE VOYAGE — L IA est totalement libre, aucune logique imposee
    if (isTravel) {

      // Compte combien de fois l IA a deja pose une question
      const nbQ = (history||[]).filter(function(m){
        return m.role==="assistant" && (m.content||{}).toString().includes("?");
      }).length;

      // UN SEUL PROMPT — L IA decide seule ce qu elle fait
      // Elle a acces au web, elle cherche les vrais prix, elle raisonne librement
      // La seule contrainte : max 1 question, apres elle genere quoi qu il arrive
      const travelPrompt =
        "Tu es Huntify, expert voyage de niveau premium. "
        +"Tu as acces au web pour trouver les vrais prix en temps reel. "
        +"Tu produis des itineraires avec le meme niveau de detail qu un guide Lonely Planet.\n\n"
        +"Date aujourd hui : "+today+"\n"
        +"Conversation :\n"+hist+"\n\nMessage : "+message+"\n\n"
        +"Questions posees : "+nbQ+". "+(nbQ>0?"GENERE maintenant.":"Une question si vraiment necessaire.")+"\n\n"
        +"MISSION : recherche sur le web et genere un JSON complet avec vrais prix.\n"
        +"Pour chaque jour : trajet etape par etape avec modes de transport, prix et durees reels.\n"
        +"Pour chaque hotel : adresse, note, description, points forts.\n"
        +"Pour chaque restaurant : nom reel, note, specialite, prix d un repas.\n\n"
        +"Si pas de destination : propose 3 destinations (t:p).\n"
        +"Si destination connue : itineraire complet (t:i).\n\n"
        +"FORMAT t:i :\n"
        +"{t:\"i\", recap:\"phrase enthousiaste\", itin:{\n"
        +"  dest, country, flag, dur, dep, style,\n"
        +"  checkin:\"YYYY-MM-DD\", checkout:\"YYYY-MM-DD\", adults,\n"
        +"  eyebrow:\"flag + description courte\",\n"
        +"  badges:[\"emoji + info cle\"],\n"
        +"  meteo:[{date:\"17 juin\",icon:\"\\u2600\\uFE0F\",temp:\"27C\",desc:\"Soleil\"}],\n"
        +"  flights:{out:{from,to,prix,co,dur,date},ret:{from,to,prix,co,dur,date}},\n"
        +"  nuits:[{n,date:\"17 juin N1\",lieu,hotel,prix,highlight:bool}],\n"
        +"  hotels:[{nom,etoiles,prix_nuit,adresse,note:\"4.6/5\",desc,features:[],nuits_label,cat}],\n"
        +"  jours:[{\n"
        +"    n, date:\"Mercredi 17 juin\", meteo_icon, meteo_temp,\n"
        +"    tag:\"Jour 1 - Arrivee\", titre:\"ville depart vers ville arrivee\",\n"
        +"    budget_jour, hotel_soir:{nom,adresse,prix},\n"
        +"    trajet_steps:[{icon,label,time,prix}|{arrow:true}],\n"
        +"    slots:[{\n"
        +"      slot_icon, slot_label:\"Matin|Midi|Apres-midi|Soiree\",\n"
        +"      title, desc,\n"
        +"      chips:[{type:\"t|k|f|g|l\",text}],\n"
        +"      tips:[{type:\"tip|warn|star\",text}],\n"
        +"      resto:{emoji,nom,note,desc,prix}\n"
        +"    }]\n"
        +"  }],\n"
        +"  trajets:[{route,date,duree,prix,steps:[string],optimise:bool}],\n"
        +"  hotels_section:[meme que hotels],\n"
        +"  budget:{items:[{cat,montant,note}],total,par_personne},\n"
        +"  conseils:[{icon,titre,corps}]\n"
        +"}}\n\n"
        +"FORMAT t:p : {t:\"p\",intro,items:[{dest,country,flag,vibe,pitch,why,vol_prix,vol_co,vol_dur,hotel_nom,hotel_prix,budget_total,checkin,checkout,iata_dep,iata_arr,activites:[]}]}\n"
        +"FORMAT t:q : {t:\"q\",msg:\"question courte\"}\n\n"
        +"IATA: CDG=Paris,MRS=Marseille,NCE=Nice,BCN=Barcelone,MAD=Madrid,FCO=Rome,NAP=Naples,VCE=Venise,LIS=Lisbonne,LHR=Londres,AMS=Amsterdam,PRG=Prague,BUD=Budapest,JTR=Santorin,RAK=Marrakech.\n"
        +"JSON uniquement."

      // Cascade IA — Groq DeepSearch en premier (web search natif gratuit)
      let raw = await groqSearch(travelPrompt, 4000);
      let ai  = parseJSON(raw||"{}");
      if (!ai.t) { raw = await gemini(travelPrompt, 3500); ai = parseJSON(raw||"{}"); }
      if (!ai.t) { raw = await mistral("Expert voyage JSON.", travelPrompt, 3000); ai = parseJSON(raw||"{}"); }
      if (!ai.t) { raw = await deepseek("Expert voyage JSON.", travelPrompt, 3000); ai = parseJSON(raw||"{}"); }
      if (!ai.t) { raw = await claudeAI("Expert voyage JSON.", travelPrompt, 3000, []); ai = parseJSON(raw||"{}"); }

      // Question
      if (ai.t==="q" && ai.msg) {
        return new Response(JSON.stringify({
          reply:'<div style="font-size:13.5px;color:#1e293b;line-height:1.7">'+ai.msg+"</div>",
          sessionId:sid
        }),{headers:H});
      }

      // Propositions
      if (ai.t==="p" && ai.items && ai.items.length) {
        const vibeC={"Romantique":"#e83e8c","Culturel":"#6f42c1","Soleil":"#fd7e14",
          "Aventure":"#20c997","Gastronomie":"#e63946","Detente":"#0ea5e9"};
        let html = (ai.intro
          ? '<div style="font-size:13.5px;color:#1e293b;font-weight:500;line-height:1.7;margin-bottom:14px">'+ai.intro+"</div>"
          : '<div style="font-size:14px;font-weight:700;color:#0e1430;margin-bottom:14px">\uD83C\uDF1F Voici mes coups de coeur :</div>');

        for (const p of ai.items.slice(0,3)) {
          const vc  = vibeC[p.vibe]||"#2f54ff";
          const sky = skyscannerLink(p.iata_dep, p.iata_arr, p.checkin, p.checkout, 2);
          const bkg = bookingLink(p.dest, p.checkin, p.checkout, 2, null);
          const pm  = "Planifie un itineraire complet pour "+p.dest
            +" depuis "+p.iata_dep
            +" du "+p.checkin+" au "+p.checkout
            +" pour 2 adultes budget "+p.budget_total+"EUR";

          html += '<div style="background:#fff;border:2px solid #e6ebf7;border-radius:16px;padding:16px;margin-bottom:12px">'
            +'<div style="display:flex;align-items:center;gap:12px;margin-bottom:10px">'
            +'<div style="font-size:34px">'+(p.flag||"\u2708\uFE0F")+"</div>"
            +'<div style="flex:1"><div style="font-size:17px;font-weight:900;color:#0e1430">'+(p.dest||"")+"</div>"
            +(p.vibe?'<span style="background:'+vc+';color:#fff;border-radius:100px;padding:2px 10px;font-size:10px;font-weight:800">'+p.vibe+"</span>":"")
            +"</div>"
            +'<div style="text-align:right">'
            +'<div style="font-size:11px;color:#7c89a8">Tout compris</div>'
            +'<div style="font-size:20px;font-weight:900;color:#2f54ff">~'+(p.budget_total||"?")+"\u20AC</div>"
            +'<div style="font-size:10px;color:#7c89a8">/ 2 pers.</div></div></div>'
            +(p.pitch?'<div style="font-size:12.5px;color:#374151;font-style:italic;background:#f8f9ff;border-radius:10px;padding:9px 12px;margin-bottom:10px;line-height:1.6">\u201C'+p.pitch+'\u201D</div>':"")
            +'<div style="display:flex;gap:8px;margin-bottom:8px">'
            +'<div style="flex:1;background:#eff6ff;border-radius:10px;padding:9px 11px">'
            +'<div style="font-size:10px;font-weight:700;color:#7c89a8;text-transform:uppercase">\u2708\uFE0F Vol A/R aller</div>'
            +'<div style="font-size:15px;font-weight:900;color:#2f54ff">~'+(p.vol_prix||"?")+"\u20AC</div>"
            +'<div style="font-size:10px;color:#7c89a8">'+(p.vol_co||"")+(p.vol_dur?" \u00B7 "+p.vol_dur:"")+"</div></div>"
            +'<div style="flex:1;background:#f0fdf4;border-radius:10px;padding:9px 11px">'
            +'<div style="font-size:10px;font-weight:700;color:#7c89a8;text-transform:uppercase">\uD83C\uDFE8 Hotel</div>'
            +'<div style="font-size:15px;font-weight:900;color:#16a34a">~'+(p.hotel_prix||"?")+"\u20AC/nuit</div>"
            +'<div style="font-size:10px;color:#7c89a8">'+(p.hotel_nom||"")+"</div></div></div>"
            +(p.activites&&p.activites.length
              ?'<div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:10px">'
                +p.activites.map(function(a){return '<span style="background:#f5f3ff;color:#6f42c1;border-radius:100px;padding:3px 10px;font-size:11px;font-weight:600">'+a+"</span>";}).join("")
                +"</div>":"")
            +(p.why?'<div style="font-size:11px;color:#64748b;background:#f8fafc;border-radius:8px;padding:6px 10px;margin-bottom:10px">\uD83D\uDCA1 '+p.why+"</div>":"")
            +'<div style="display:flex;gap:7px">'
            +'<a href="'+sky+'" target="_blank" style="flex:1;display:flex;justify-content:center;align-items:center;background:linear-gradient(135deg,#0e1430,#1f2da0);color:#fff;text-decoration:none;border-radius:10px;padding:10px;font-size:11px;font-weight:700">\u2708\uFE0F Vols</a>'
            +'<a href="'+bkg+'" target="_blank" rel="sponsored" style="flex:1;display:flex;justify-content:center;align-items:center;background:linear-gradient(135deg,#003580,#0071c2);color:#fff;text-decoration:none;border-radius:10px;padding:10px;font-size:11px;font-weight:700">\uD83C\uDFE8 Hotels</a>'
            +planButton(pm)
            +"</div></div>";
        }
        html += '<div style="font-size:11px;color:#94a3b8;text-align:center;margin-top:6px">Cliquez Planifier pour l itineraire complet jour par jour</div>';
        return new Response(JSON.stringify({reply:html,sessionId:sid}),{headers:H});
      }

      // Itineraire complet
      const itin = ai.itin || (ai.t==="i" ? ai.itin : null) || (ai.dest ? ai : null);
      if (!itin) {
        return new Response(JSON.stringify({reply:
          '<div style="font-size:13px;color:#1e293b;margin-bottom:10px">Liens pour organiser votre voyage :</div>'
          +'<a href="https://www.skyscanner.fr" target="_blank" style="display:flex;justify-content:center;background:linear-gradient(135deg,#0e1430,#1f2da0);color:#fff;text-decoration:none;border-radius:12px;padding:14px;margin-top:8px;font-size:13px;font-weight:700">\u2708\uFE0F Vols Skyscanner \u2192</a>'
          +'<a href="https://www.booking.com/?aid='+BOOKING_AID+'" target="_blank" rel="sponsored" style="display:flex;justify-content:center;background:linear-gradient(135deg,#003580,#0071c2);color:#fff;text-decoration:none;border-radius:12px;padding:14px;margin-top:8px;font-size:13px;font-weight:700">\uD83C\uDFE8 Hotels Booking \u2192</a>',
          sessionId:sid}),{headers:H});
      }

      const fCi = itin.checkin||today;
      const fCo = itin.checkout||today;
      const fAd = itin.adults||2;
      const dest = itin.dest||"";
      let html = "";

      // 1. Hero
      html += renderHero(itin, fCi, fCo);

      // 2. Meteo
      if (itin.meteo&&itin.meteo.length) html += renderMeteo(itin.meteo);

      // 3. Banner vols
      html += renderFlightsBanner(itin.flights, fCi, fCo, fAd, itin.dep||"", dest);

      // 4. Nuits overview
      if (itin.nuits&&itin.nuits.length) html += renderNightsOverview(itin.nuits);

      // 5. Recap IA
      if (ai.recap) html += "<div style='background:#f5f3ff;border:1.5px solid #ddd6fe;border-radius:12px;padding:10px 14px;margin-bottom:4px;font-size:12.5px;color:#5b21b6;font-weight:600;line-height:1.5'>"+ai.recap+"</div>";

      // 6. Programme jours
      var joursArr = itin.jours||itin.days||[];
      if (joursArr.length) {
        html += "<div style='font-size:10px;letter-spacing:.13em;text-transform:uppercase;color:#7a7570;padding:16px 16px 8px;font-weight:600'>\uD83D\uDCC5 Programme Jour par Jour</div>";
        for (var ji=0; ji<joursArr.length; ji++) html += cardDay(joursArr[ji]);
      }

      // 7. Recap trajets
      if (itin.trajets&&itin.trajets.length) html += renderTrajetsRecap(itin.trajets);

      // 8. Hotels
      var hotArr = itin.hotels_section||itin.hotels||[];
      if (hotArr.length) {
        html += renderHotels(hotArr);
        html += "<div style='display:flex;gap:8px;margin-bottom:4px'>"
          +"<a href='"+bookingLink(dest,fCi,fCo,fAd,null)+"' target='_blank' rel='sponsored' "
          +"style='flex:1;display:flex;justify-content:center;align-items:center;background:linear-gradient(135deg,#003580,#0071c2);color:#fff;text-decoration:none;border-radius:12px;padding:10px;font-size:11px;font-weight:700'>\uD83C\uDFE8 Plus sur Booking.com</a>"
          +"<a href='"+expediaLink(dest,fCi,fCo,fAd)+"' target='_blank' rel='sponsored' "
          +"style='flex:1;display:flex;justify-content:center;align-items:center;background:linear-gradient(135deg,#00355f,#00a0e3);color:#fff;text-decoration:none;border-radius:12px;padding:10px;font-size:11px;font-weight:700'>\u2708\uFE0F Expedia</a>"
          +"</div>";
      }

      // GetTransfer
      if (fCi) html += "<a href='"+getTransferLink(dest,fCi)+"' target='_blank' rel='sponsored' style='display:flex;justify-content:center;align-items:center;gap:8px;background:linear-gradient(135deg,#1a1a2e,#e94560);color:#fff;text-decoration:none;border-radius:12px;padding:11px;margin-bottom:4px;font-size:12px;font-weight:700'>\uD83D\uDE97 Transfert aeroport \u00B7 GetTransfer \u2192</a>";

      // 9. Budget
      if (itin.budget) html += cardBudget(itin.budget);

      // 10. Conseils
      var consArr = itin.conseils||itin.tips||[];
      if (consArr.length) html += cardTips(consArr);

      // Wishlist + export
      var itinId = "itin_"+Date.now();
      var wD = JSON.stringify({type:"voyage",name:(itin.flag||"\u2708\uFE0F")+" "+(itin.dest||""),
        price:itin.budget&&(itin.budget.par_personne||itin.budget.total)?(itin.budget.par_personne||itin.budget.total)+"\u20AC":"",
        url:bookingLink(dest,fCi,fCo,fAd,null)}).replace(/"/g,"&quot;");
      html += "<div style='display:flex;gap:8px;margin-top:8px'>"
        +"<button onclick='addToWishlist("+wD+")' style='flex:1;background:linear-gradient(135deg,#1f2da0,#2f54ff);border:none;color:#fff;border-radius:12px;padding:12px;font-weight:700;font-size:13px;cursor:pointer;font-family:inherit'>\u2661 Sauvegarder</button>"
        +"<button onclick=\"(function(){var c=document.querySelector('[class*=chat],[class*=messages],[class*=response]');var w=window.open('','_blank');if(w){w.document.write('<html><head><title>Itineraire Huntify</title><meta charset=UTF-8><style>body{font-family:sans-serif;padding:20px;max-width:800px;margin:0 auto}@media print{button,a[onclick]{display:none}}</style></head><body>'+document.body.innerHTML+'</body></html>');w.document.close();setTimeout(function(){w.print();},400);}else window.print();})()\" style=\"background:#f5f7ff;border:1.5px solid #c7d2fe;color:#3b5bdb;border-radius:12px;padding:12px;font-weight:700;font-size:13px;cursor:pointer;font-family:inherit\">\u2B07\uFE0F PDF</button>"
        +"</div>";

      return new Response(JSON.stringify({reply:html,sessionId:sid}),{headers:H});
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  MODE PRODUIT
    // ══════════════════════════════════════════════════════════════════════════

    // Etape 1 : Groq comprend la demande en lisant toute la conversation
    const ctxMsg = hist
      ? "Conversation:\n"+hist+"\n\nNouveau message: "+message
      : "Demande: "+message;

    const intentRaw = await groq(
      "Tu es le conseiller shopping Huntify. Tu lis toute la conversation et tu comprends ce que l utilisateur veut vraiment. "
      +"Tu es curieux et attentif : tu captes les criteres implicites (style de vie, budget, usage). "
      +"ready:true si tu as compris (meme vaguement). Un mot suffit. "
      +"recap : decris le produit ideal en integrant TOUS les criteres mentionnes dans la conversation. "
      +"JSON: {ready:bool, recap:string, msg:string}",
      ctxMsg, 300
    ) || await gemini("Shopping conseiller. JSON: {ready:bool,recap:string,msg:string}\n\n"+ctxMsg, 300);

    const intent = parseJSON(intentRaw||"");

    if (!intent.ready && intent.msg && history.length < 2) {
      return new Response(JSON.stringify({
        reply:'<div style="font-size:13.5px;color:#1e293b;line-height:1.6;padding:4px 0">'+intent.msg+"</div>",
        sessionId:sid
      }),{headers:H});
    }

    const recap = intent.recap || (histS+" "+message).trim().slice(0,200);
    const dbCtx = await dbLookup(recap);

    // Etape 2 : Groq DeepSearch cherche les vrais produits avec ASINs
    // Prompt produit : l IA est autonome, elle choisit les meilleurs produits
    // et cherche les vraies URLs. Pas de contrainte sur les marques ou modeles.
    const searchPrompt =
      "Tu es un expert shopping. Cherche les MEILLEURS produits pour : "+recap+".\n"
      +(dbCtx?"Contexte : "+dbCtx+"\n":"")
      +"Tu es libre de choisir les marques et modeles que tu juges les meilleurs.\n"
      +"Pour Amazon.fr : trouve les vraies pages produit avec leur ASIN (B+9 alphanum).\n"
      +"Pour Rakuten.fr : trouve le produit le plus pertinent.\n"
      +"Donne les vrais prix actuels. Si tu n es pas sur d un prix, donne une fourchette.\n"
      +"Retourne exactement ce JSON :\n"
      +"{ summary: \"phrase naturelle qui resume ta selection et pourquoi ces produits\",\n"
      +"  products: [\n"
      +"    { name: \"nom complet du produit\",\n"
      +"      price: \"prix en EUR ex: 39.99 EUR\",\n"
      +"      store: \"amazon\" ou \"rakuten\",\n"
      +"      keywords: \"mots cles de recherche\",\n"
      +"      url: \"https://www.amazon.fr/dp/BASIN ou null si incertain\",\n"
      +"      badge: \"ex: Meilleure vente, Rapport qualite/prix, Top avis\" }\n"
      +"  ],\n"
      +"  promoCodes: [] }\n"
      +"JSON uniquement."
    const groqRaw  = await groqSearch(searchPrompt, 1200);
    const groqData = parseJSON(groqRaw||"");
    let products   = groqData.products||[];
    let summary    = groqData.summary||"";
    let promos     = groqData.promoCodes||[];

    // Etape 3 : Detecte si Groq a invente un ASIN
    // Invente = URL non-null mais format ASIN invalide
    // Honnete = URL null (on utilise /s?k= → pas de pb)
    // Groq a invente une URL ? (url non-null mais ASIN invalide)
    const groqLied = products.some(function(p){
      return (p.store||"").includes("amazon")
        && p.url && p.url!=="null" && p.url.length>5
        && !/\/dp\/B[A-Z0-9]{9}/.test(p.url);
    });

    // Nettoie les urls nulles
    products.forEach(function(p){
      if ((p.store||"").includes("amazon") && (!p.url||p.url==="null"||p.url==="undefined")) {
        p.url = null;
      }
    });

    // Claude + web_search si pas d ASIN valide ou si Groq a invente
    var hasValidAsin = products.some(function(p){
      return (p.store||"").includes("amazon") && p.url && /\/dp\/B[A-Z0-9]{9}/.test(p.url);
    });

    if (groqLied || !hasValidAsin) {
      var cpSys = "Tu es expert shopping. Cherche sur amazon.fr les meilleurs produits pour : "+recap+". "
        +"Tu es libre de choisir les meilleures marques et modeles selon ton expertise. "
        +"Trouve les vraies pages produit avec leurs ASINs. "
        +"JSON uniquement: {summary:string, products:[{name,price,store,keywords,url,badge}]}";
      const cRaw = await claudeAI(cpSys, "Cherche sur amazon.fr et retourne le JSON.", 600,
        [{type:"web_search_20250305",name:"web_search",max_uses:3}]);
      const cParsed = parseJSON(cRaw||"");
      const cProds  = cParsed.products||[];
      const validC  = cProds.filter(function(p){
        return (p.store||"").includes("amazon") && p.url && /\/dp\/B[A-Z0-9]{9}/.test(p.url);
      });
      if (validC.length) {
        products = products.filter(function(p){return !(p.store||"").includes("amazon");});
        products  = validC.concat(products);
        if (cParsed.summary) summary = cParsed.summary;
      }
    }


    // Garantit Amazon + Rakuten
    if (!products.some(function(p){return (p.store||"").includes("amazon");})) {
      products.unshift({name:recap,price:null,store:"amazon",keywords:recap,url:null,badge:"Meilleure vente"});
    }
    if (!products.some(function(p){return (p.store||"").includes("rakuten");})) {
      products.push({name:recap,price:null,store:"rakuten",keywords:recap,url:null,badge:"Bon plan"});
    }

    // Etape 5 : Rendu cartes produits
    let buttons = "";
    for (const pr of products.slice(0,4)) {
      if (!pr.name) continue;
      const isAmazon  = (pr.store||"").includes("amazon");
      const isRakuten = (pr.store||"").includes("rakuten");
      if (!isAmazon && !isRakuten) continue;

      // Extrait ASIN si present
      const asinMatch = pr.url&&pr.url.match(/\/dp\/(B[A-Z0-9]{9})/);
      const asin = asinMatch?asinMatch[1]:null;
      const kw   = pr.keywords||pr.name;

      let url, color, emoji, storeName;
      if (isAmazon) {
        url = amazonLink(kw, asin);
        color="#e47911"; emoji="\uD83D\uDED2"; storeName="Amazon";
        // Verif depuis Supabase advertisers
        const advA = adv.find(function(a){return a.slug==="amazon";});
        if (advA&&advA.amazon_tag) url = amazonLink(kw,asin).replace(AMAZON_TAG,advA.amazon_tag);
      } else {
        url = rakutenLink(kw);
        color="#bf0000"; emoji="\uD83D\uDECD\uFE0F"; storeName="Rakuten";
      }

      const price = pr.price&&pr.price!=="null"&&pr.price!=="undefined"&&pr.price!=="0"
        ? pr.price : null;
      buttons += cardProduct(pr.name, price, url, storeName, color, emoji, pr.badge||null);
    }

    let promoHtml = "";
    for (const c of (promos||[]).filter(function(c){return c&&c.code;}).sort(function(a,b){return (b.best?1:0)-(a.best?1:0);}).slice(0,2)) {
      promoHtml += promoBox(c.code, c.store||"boutique", c.discount||"Reduction", c.best||false);
    }

    if (!summary) summary = "Voici ma selection pour "+recap+" :";

    const firstAmazon = products.find(function(p){return (p.store||"").includes("amazon");});
    let wishHtml = "";
    if (firstAmazon) {
      const asinM = firstAmazon.url&&firstAmazon.url.match(/\/dp\/(B[A-Z0-9]{9})/);
      const wUrl  = amazonLink(firstAmazon.keywords||firstAmazon.name, asinM?asinM[1]:null);
      const wD    = JSON.stringify({type:"product",name:firstAmazon.name,price:firstAmazon.price,store:"amazon",url:wUrl}).replace(/"/g,"&quot;");
      wishHtml = '<button onclick="addToWishlist('+wD+')" style="background:#fff;border:1.5px solid #e8edf8;color:#3b5bdb;border-radius:12px;padding:9px 16px;margin-top:10px;font-weight:700;font-size:12px;cursor:pointer;font-family:inherit;width:100%">\u2661 Ajouter a ma wishlist</button>';
    }

    return new Response(JSON.stringify({
      reply:'<div style="font-size:13.5px;color:#1e293b;margin-bottom:8px;font-weight:500;line-height:1.5">'+summary+"</div>"
        +buttons+(promoHtml?'<div style="margin-top:4px">'+promoHtml+"</div>":"")+wishHtml,
      sessionId:sid
    }),{headers:H});

  } catch(err) {
    var msg = err&&err.message ? err.message : String(err);
    var stk = err&&err.stack ? err.stack.slice(0,300) : "";
    console.error("Huntify error:", msg, stk);
    return new Response(JSON.stringify({
      reply:"<div style='font-size:13px;color:#1e293b;padding:8px'>"        +"<strong>Erreur technique</strong><br>"+msg.replace(/</g,"&lt;").slice(0,120)+"</div>"
    }),{status:200,headers:{"Content-Type":"application/json","Access-Control-Allow-Origin":"*"}});
  }
}
