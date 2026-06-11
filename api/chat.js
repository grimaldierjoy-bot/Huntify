export const config = { runtime: 'edge' };

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
    const r=await fetch("https://api.groq.com/openai/v1/chat/completions",{
      method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+k},
      body:JSON.stringify({model:"llama-3.3-70b-versatile",max_tokens:maxTok||500,temperature:0.2,
        messages:[{role:"system",content:sys},{role:"user",content:user}]})
    });
    if(!r.ok) return null;
    const d=await r.json(); return d.choices&&d.choices[0]?d.choices[0].message.content:null;
  } catch(e){return null;}
}

async function groqSearch(prompt, maxTok) {
  const k=process.env.GROQ_API_KEY; if(!k) return null;
  try {
    const r=await fetch("https://api.groq.com/openai/v1/chat/completions",{
      method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+k},
      body:JSON.stringify({model:"compound-beta",max_tokens:maxTok||1500,
        messages:[{role:"user",content:prompt}]})
    });
    if(!r.ok) return await groq("Reponds en JSON.",prompt,maxTok||1500);
    const d=await r.json(); return d.choices&&d.choices[0]?d.choices[0].message.content:null;
  } catch(e){return await groq("Reponds en JSON.",prompt,maxTok||1500);}
}

async function gemini(prompt, maxTok) {
  const k=process.env.GEMINI_API_KEY; if(!k) return null;
  try {
    const r=await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key="+k,{
      method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{maxOutputTokens:maxTok||500,temperature:0.2}})
    });
    if(!r.ok) return null;
    const d=await r.json(); return d.candidates&&d.candidates[0]?d.candidates[0].content.parts[0].text:null;
  } catch(e){return null;}
}

async function mistral(sys, user, maxTok) {
  const k=process.env.MISTRAL_API_KEY; if(!k) return null;
  try {
    const r=await fetch("https://api.mistral.ai/v1/chat/completions",{
      method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+k},
      body:JSON.stringify({model:"mistral-small-latest",max_tokens:maxTok||500,temperature:0.2,
        messages:[{role:"system",content:sys},{role:"user",content:user}]})
    });
    if(!r.ok) return null;
    const d=await r.json(); return d.choices&&d.choices[0]?d.choices[0].message.content:null;
  } catch(e){return null;}
}

async function deepseek(sys, user, maxTok) {
  const k=process.env.DEEPSEEK_API_KEY; if(!k) return null;
  try {
    const r=await fetch("https://api.deepseek.com/v1/chat/completions",{
      method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+k},
      body:JSON.stringify({model:"deepseek-chat",max_tokens:maxTok||500,temperature:0.2,
        messages:[{role:"system",content:sys},{role:"user",content:user}]})
    });
    if(!r.ok) return null;
    const d=await r.json(); return d.choices&&d.choices[0]?d.choices[0].message.content:null;
  } catch(e){return null;}
}

async function claudeAI(sys, user, maxTok, tools) {
  const k=process.env.ANTHROPIC_API_KEY; if(!k) return null;
  try {
    const payload={model:MODEL,max_tokens:maxTok||800,system:sys,messages:[{role:"user",content:user}]};
    if(tools&&tools.length) payload.tools=tools;
    const r=await fetch("https://api.anthropic.com/v1/messages",{
      method:"POST",
      headers:{"Content-Type":"application/json","x-api-key":k,"anthropic-version":"2023-06-01"},
      body:JSON.stringify(payload)
    });
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
  try { const m=raw.match(/```(?:json)?\s*([\s\S]*?)```/); if(m) return JSON.parse(m[1].trim()); } catch(e){}
  try { const m=raw.match(/\{[\s\S]*\}/); if(m) return JSON.parse(m[0]); } catch(e){}
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

// ── PLANIFIER : bouton qui envoie le message dans le chat ────────────────────
// Snippet a ajouter dans index.html pour garantir le fonctionnement :
// <script>
//   window.addEventListener('huntify_send', function(e) {
//     var inp = document.querySelector('textarea, input[type=text], #chat-input, .chat-input');
//     if (inp) { inp.value = e.detail.message; inp.dispatchEvent(new Event('input',{bubbles:true})); }
//     var btn = document.querySelector('button[type=submit], #send-btn, .send-button');
//     if (btn) btn.click();
//   });
// </script>
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

// ── CARTE PRODUIT ─────────────────────────────────────────────────────────────
function cardProduct(name, price, url, storeName, storeColor, storeEmoji, badge) {
  var pill = "<span style=\"background:rgba(255,255,255,.22);border-radius:100px;padding:2px 9px;font-size:10px;font-weight:800\">"
    +storeEmoji+" "+storeName+"</span>";
  var priceTag = (price && price!=="null" && price!=="undefined" && price!=="Voir prix" && price!=="0")
    ? price : "Voir prix";
  return "<a href=\""+url+"\" target=\"_blank\" rel=\"sponsored noopener\" "
    +"style=\"display:flex;align-items:center;gap:12px;background:"+storeColor+";color:#fff;"
    +"text-decoration:none;border-radius:14px;padding:13px 14px;margin-top:8px\">"
    +"<div style=\"flex:1;min-width:0\">"
    +"<div style=\"font-size:10px;margin-bottom:4px;opacity:.85\">"+pill+(badge?" \u00B7 "+badge:"")+"</div>"
    +"<div style=\"font-size:13.5px;font-weight:800;line-height:1.3;word-break:break-word\">"+name+"</div></div>"
    +"<div style=\"background:rgba(255,255,255,.22);border-radius:9px;padding:6px 11px;"
    +"white-space:nowrap;font-size:14px;font-weight:900;flex-shrink:0\">"+priceTag+"</div></a>";
}

// ── CODE PROMO ────────────────────────────────────────────────────────────────
function promoBox(code, store, desc, best) {
  return "<div style=\"background:"+(best?"#dcfce7":"#f0fdf4")+";border:"+(best?"2px solid #16a34a":"1.5px solid #86efac")+";border-radius:12px;padding:10px 14px;margin-top:6px;display:flex;align-items:center;justify-content:space-between;gap:8px\">"
    +"<div><span style=\"font-size:11px;color:#16a34a;font-weight:700\">"+(best?"\u2B50 MEILLEUR \u2014 ":"")+"\uD83C\uDFF7\uFE0F "+store+"</span>"
    +"<div style=\"font-size:12px;color:#166534;font-weight:600\">"+desc+"</div></div>"
    +"<div onclick=\"navigator.clipboard.writeText('"+code+"');this.textContent='\u2713';setTimeout(()=>this.textContent='"+code+"',2000)\" "
    +"style=\"background:#16a34a;color:#fff;border-radius:8px;padding:6px 10px;font-weight:800;font-size:12px;cursor:pointer;white-space:nowrap\">"
    +code+"</div></div>";
}

// ── HERO ITINERAIRE ───────────────────────────────────────────────────────────
function heroItin(itin, fCi, fCo, fAd, budgetTotal) {
  var dest   = itin.dest||"";
  var country= itin.country||"";
  var flag   = itin.flag||"\u2708\uFE0F";
  var dur    = itin.dur||"";
  var dep    = itin.dep||"";
  var style  = itin.style||"";
  return "<div style=\"background:#0e1430;color:white;padding:28px 20px 22px;border-radius:16px;position:relative;overflow:hidden;margin-bottom:4px\">"
    +"<div style=\"position:absolute;top:-30px;right:-30px;width:180px;height:180px;"
    +"background:radial-gradient(circle,rgba(47,84,255,.25) 0%,transparent 65%);pointer-events:none\"></div>"
    +"<div style=\"font-size:10px;letter-spacing:.15em;text-transform:uppercase;color:#7c8fff;margin-bottom:8px\">"
    +"\uD83C\uDDEE\uD83C\uDDF9 Itineraire Premium \u00B7 Huntify</div>"
    +"<div style=\"font-size:30px;font-weight:800;color:#fff;margin-bottom:4px;line-height:1.1\">"
    +flag+" "+dest+(country?", "+country:"")+"</div>"
    +"<div style=\"font-size:12px;color:#a8b0d8;margin-bottom:14px\">"+style+"</div>"
    +"<div style=\"display:flex;flex-wrap:wrap;gap:8px\">"
    +(fCi&&fCo?"<span style=\"background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.15);border-radius:6px;padding:5px 11px;font-size:11px;font-weight:600;color:#c8d0ff\">\uD83D\uDCC5 "+fCi+" \u2192 "+fCo+"</span>":"")
    +(dep?"<span style=\"background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.15);border-radius:6px;padding:5px 11px;font-size:11px;font-weight:600;color:#c8d0ff\">\uD83D\uDEEB "+dep+"</span>":"")
    +(fAd?"<span style=\"background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.15);border-radius:6px;padding:5px 11px;font-size:11px;font-weight:600;color:#c8d0ff\">\uD83D\uDC65 "+fAd+" pers.</span>":"")
    +(budgetTotal?"<span style=\"background:rgba(47,84,255,.3);border:1px solid rgba(100,130,255,.4);border-radius:6px;padding:5px 11px;font-size:11px;font-weight:700;color:#bcd0ff\">\uD83D\uDCB0 ~"+budgetTotal+"\u20AC</span>":"")
    +"</div></div>";
}

// ── VOLS ──────────────────────────────────────────────────────────────────────
function cardFlights(f, fCi, fCo, fAd, depStr, destStr) {
  if (!f||!f.out) return "";
  var sky = skyscannerLink(f.out.from||depStr||"", f.out.to||destStr||"", fCi, fCo, fAd);
  var out = f.out, ret = f.ret;
  var html = "<div style=\"font-size:11px;font-weight:800;color:#7c89a8;text-transform:uppercase;letter-spacing:.08em;margin:14px 0 6px\">\u2708\uFE0F Vols</div>"
    +"<div style=\"background:#fff;border:1.5px solid #e6ebf7;border-radius:14px;overflow:hidden\">"
    +"<div style=\"padding:12px 16px;"+(ret?"border-bottom:1px solid #f0f4ff":"")+"\">"
    +"<div style=\"display:flex;justify-content:space-between;align-items:center\">"
    +"<div><div style=\"font-size:9px;font-weight:700;color:#7c89a8;text-transform:uppercase\">Aller"+(fCi?" \u00B7 "+fCi:"")+"</div>"
    +"<div style=\"font-size:14px;font-weight:800;color:#0e1430;margin:3px 0\">"+(out.from||"")+" \u2192 "+(out.to||"")+"</div>"
    +"<div style=\"font-size:11px;color:#94a3b8\">"+(out.co||"")+(out.dur?" \u00B7 "+out.dur:"")+"</div></div>"
    +"<div style=\"text-align:right\"><div style=\"font-size:20px;font-weight:900;color:#2f54ff\">~"+(out.prix||out.price||"?")+"\u20AC</div>"
    +"<div style=\"font-size:10px;color:#94a3b8\">/pers.</div></div></div></div>";
  if (ret) {
    html += "<div style=\"padding:12px 16px\">"
    +"<div style=\"display:flex;justify-content:space-between;align-items:center\">"
    +"<div><div style=\"font-size:9px;font-weight:700;color:#7c89a8;text-transform:uppercase\">Retour"+(fCo?" \u00B7 "+fCo:"")+"</div>"
    +"<div style=\"font-size:14px;font-weight:800;color:#0e1430;margin:3px 0\">"+(ret.from||"")+" \u2192 "+(ret.to||"")+"</div>"
    +"<div style=\"font-size:11px;color:#94a3b8\">"+(ret.co||"")+(ret.dur?" \u00B7 "+ret.dur:"")+"</div></div>"
    +"<div style=\"text-align:right\"><div style=\"font-size:20px;font-weight:900;color:#2f54ff\">~"+(ret.prix||ret.price||"?")+"\u20AC</div>"
    +"<div style=\"font-size:10px;color:#94a3b8\">/pers.</div></div></div></div>";
  }
  html += "</div>"
    +"<a href=\""+sky+"\" target=\"_blank\" "
    +"style=\"display:flex;justify-content:center;align-items:center;gap:8px;"
    +"background:linear-gradient(135deg,#0e1430,#1f2da0);color:#fff;text-decoration:none;"
    +"border-radius:12px;padding:12px;font-size:13px;font-weight:700;margin-top:6px\">"
    +"\uD83D\uDD0D Voir et reserver sur Skyscanner \u2192</a>";
  return html;
}

// ── HOTEL CARD PREMIUM ────────────────────────────────────────────────────────
function cardHotel(h, hotelUrl, destUrl) {
  var catColor = {budget:"#16a34a", confort:"#2f54ff", luxe:"#7c3aed"}[h.cat]||"#2f54ff";
  var catLabel = {budget:"\uD83D\uDC9A Budget", confort:"\uD83D\uDC99 Confort", luxe:"\uD83D\uDC8E Luxe"}[h.cat]||"";
  var stars    = "\u2B50".repeat(Math.min(h.stars||h.etoiles||3,5));
  var prix     = h.prix_nuit||h.price||null;
  var hasPrice = !!(prix && prix > 0);
  return "<a href=\""+hotelUrl+"\" target=\"_blank\" rel=\"sponsored noopener\" "
    +"style=\"display:flex;flex-direction:column;background:#fff;border:1.5px solid "+(hasPrice?"#bbf7d0":"#e6ebf7")+";border-radius:14px;padding:13px;margin-top:8px;text-decoration:none;gap:5px\">"
    +"<div style=\"display:flex;justify-content:space-between;align-items:flex-start\">"
    +"<div style=\"flex:1\">"
    +(catLabel?"<span style=\"background:#eff6ff;color:"+catColor+";border-radius:100px;padding:2px 9px;font-size:10px;font-weight:800\">"+catLabel+"</span>":"")
    +"<div style=\"font-size:13.5px;font-weight:800;color:#0e1430;margin-top:4px\">"+(h.nom||h.name||"")+"</div>"
    +"<div style=\"font-size:11px;color:#7c89a8;margin-top:2px\">"+stars+" \u00B7 "+(h.lieu||h.loc||"")+"</div>"
    +"</div>"
    +(hasPrice?"<div style=\"background:linear-gradient(135deg,"+catColor+","+catColor+"cc);color:#fff;border-radius:10px;padding:8px 12px;text-align:center;flex-shrink:0;margin-left:10px\">"
      +"<div style=\"font-size:9px;opacity:.8\">par nuit</div>"
      +"<div style=\"font-size:17px;font-weight:900\">"+prix+"\u20AC</div></div>"
      :"<div style=\"background:linear-gradient(135deg,"+catColor+","+catColor+"cc);color:#fff;border-radius:10px;padding:8px 12px;text-align:center;flex-shrink:0;margin-left:10px;min-width:64px\">"
      +"<div style=\"font-size:10px\">Voir prix</div>"
      +"<div style=\"font-size:13px;font-weight:800\">\u2192</div></div>")
    +"</div>"
    +((h.description||h.hl)?"<div style=\"font-size:11px;color:"+catColor+";font-weight:600;background:#eff6ff;border-radius:8px;padding:4px 10px\">\u2728 "+(h.description||h.hl)+"</div>":"")
    +"<div style=\"background:"+(hasPrice?"#f0fdf4":"#f0f9ff")+";border-radius:8px;padding:6px 10px;font-size:11px;font-weight:600;color:"+(hasPrice?"#15803d":"#0369a1")+"\">"
    +(hasPrice?"\uD83D\uDFE2 Prix verifie \u00B7 Voir sur Booking.com \u2192":"\uD83C\uDFE8 Voir disponibilites sur Booking.com \u2192")
    +"</div></a>";
}

// ── PROGRAMME JOUR ────────────────────────────────────────────────────────────
function cardDay(d) {
  var bgColors = ["#2A1A0E","#0A2030","#093020","#0A2020","#1A0A2A"];
  var bg = bgColors[(d.n-1)%bgColors.length]||"#1A1A2E";
  var am  = d.matin||d.am||"";
  var pm  = d.aprem||d.pm||"";
  var eve = d.soir||d.eve||"";
  var budget = d.budget_jour||d.budget||null;
  var resto  = d.resto;
  var acts   = d.activites||d.acts||[];

  var html = "<div style=\"border:1.5px solid #e6ebf7;border-radius:14px;overflow:hidden;margin-top:10px\">"
    // Header jour
    +"<div style=\"background:"+bg+";padding:12px 16px;display:flex;justify-content:space-between;align-items:center\">"
    +"<div>"
    +"<div style=\"font-size:9px;font-weight:700;color:rgba(255,255,255,.4);text-transform:uppercase;letter-spacing:.1em;margin-bottom:2px\">Jour "+d.n+"</div>"
    +"<div style=\"font-size:15px;font-weight:800;color:#fff\">"+(d.titre||d.title||"")+"</div>"
    +"</div>"
    +(budget?"<div style=\"text-align:right\"><div style=\"font-size:18px;font-weight:900;color:#e8917a\">~"+budget+"\u20AC</div><div style=\"font-size:9px;color:rgba(255,255,255,.3)\">budget jour</div></div>":"")
    +"</div>";

  // Trajet du jour si present
  if (d.trajet) {
    html += "<div style=\"background:#f7f3ee;padding:8px 14px;border-bottom:1px solid #ede8e0;font-size:11px;color:#5a5550\">"
      +"\uD83D\uDE97 "+d.trajet+"</div>";
  }

  // Slots horaires
  var slots = [
    {ico:"\uD83C\uDF05", label:"Matin", txt:am},
    {ico:"\u2600\uFE0F", label:"Apres-midi", txt:pm},
    {ico:"\uD83C\uDF19", label:"Soiree", txt:eve}
  ];
  for (var si=0; si<slots.length; si++) {
    var sl = slots[si];
    if (!sl.txt) continue;
    html += "<div style=\"display:flex;background:#fff;border-bottom:1px solid #f0ebe4\">"
      +"<div style=\"width:64px;flex-shrink:0;padding:14px 8px;display:flex;flex-direction:column;align-items:center;gap:3px\">"
      +"<div style=\"font-size:18px\">"+sl.ico+"</div>"
      +"<div style=\"font-size:8px;text-transform:uppercase;letter-spacing:.06em;color:#94a3b8;text-align:center\">"+sl.label+"</div>"
      +"</div>"
      +"<div style=\"flex:1;padding:14px 16px;border-left:1px solid #f0ebe4\">"
      +"<div style=\"font-size:12.5px;color:#374151;line-height:1.6\">"+sl.txt+"</div>"
      +"</div></div>";
  }

  // Activites chips
  if (acts.length) {
    html += "<div style=\"padding:10px 14px;background:#fff;border-bottom:1px solid #f0ebe4;display:flex;flex-wrap:wrap;gap:4px\">";
    for (var ai=0; ai<acts.length; ai++) {
      html += "<span style=\"background:#eff6ff;color:#2f54ff;border-radius:100px;padding:3px 10px;font-size:10.5px;font-weight:600\">"+acts[ai]+"</span>";
    }
    html += "</div>";
  }

  // Restaurant
  if (resto) {
    var rNom   = resto.nom||resto.name||"";
    var rPrix  = resto.prix||resto.price||"";
    var rSpec  = resto.cuisine||resto.spec||"";
    html += "<div style=\"background:#f7f3ee;padding:10px 14px;display:flex;gap:10px;align-items:flex-start\">"
      +"<div style=\"font-size:20px;flex-shrink:0\">\uD83C\uDF7D\uFE0F</div>"
      +"<div style=\"flex:1\">"
      +"<div style=\"font-size:12px;font-weight:700;color:#0e1430\">"+rNom+"</div>"
      +(rSpec?"<div style=\"font-size:10px;color:#b8941a;margin-top:1px\">"+rSpec+"</div>":"")
      +"</div>"
      +(rPrix?"<div style=\"font-size:12px;font-weight:800;color:#c0603a;flex-shrink:0\">"+rPrix+"</div>":"")
      +"</div>";
  }

  html += "</div>";
  return html;
}

// ── BUDGET TOTAL ──────────────────────────────────────────────────────────────
function cardBudget(b) {
  var rows = [
    ["\u2708\uFE0F Vols A/R", b.vols],
    ["\uD83C\uDFE8 Hebergement", b.hotel],
    ["\uD83C\uDFAF Activites", b.activites||b.acts],
    ["\uD83C\uDF7D\uFE0F Restaurants", b.resto],
    ["\uD83D\uDE87 Transports", b.transport]
  ].filter(function(r){return r[1]!=null&&r[1]!==undefined;});

  var html = "<div style=\"background:linear-gradient(135deg,#0e1430,#1a2a6e);border-radius:16px;padding:18px;margin-top:12px\">"
    +"<div style=\"font-size:13px;font-weight:800;color:#fff;margin-bottom:14px\">\uD83D\uDCB0 Budget total estime</div>";

  for (var ri=0; ri<rows.length; ri++) {
    html += "<div style=\"display:flex;justify-content:space-between;margin-bottom:8px\">"
      +"<span style=\"font-size:12px;color:rgba(255,255,255,.7)\">"+rows[ri][0]+"</span>"
      +"<span style=\"font-size:12px;font-weight:700;color:#fff\">~"+rows[ri][1]+"\u20AC</span></div>";
  }

  html += "<div style=\"border-top:1px solid rgba(255,255,255,.15);margin-top:10px;padding-top:12px\">"
    +"<div style=\"display:flex;justify-content:space-between;align-items:baseline\">"
    +"<span style=\"font-size:13px;font-weight:800;color:#fff\">TOTAL 2 pers.</span>"
    +"<span style=\"font-size:22px;font-weight:900;color:#bcd0ff\">~"+(b.total||"")+"\u20AC</span></div>"
    +(b.par_personne||b.pp?"<div style=\"font-size:11px;color:rgba(255,255,255,.45);text-align:right;margin-top:3px\">soit ~"+(b.par_personne||b.pp)+"\u20AC / personne</div>":"")
    +"</div>"
    +"<div style=\"font-size:10px;color:rgba(255,255,255,.3);margin-top:10px\">Estimations basees sur les prix web actuels \u00B7 Cliquez les liens pour reserver</div>"
    +"</div>";
  return html;
}

// ── CONSEILS ──────────────────────────────────────────────────────────────────
function cardTips(tips) {
  if (!tips||!tips.length) return "";
  var html = "<div style=\"background:#f5f3ff;border:1.5px solid #ddd6fe;border-radius:14px;padding:14px;margin-top:10px\">"
    +"<div style=\"font-size:11px;font-weight:800;color:#5b21b6;text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px\">\uD83D\uDCA1 Conseils du guide local</div>";
  for (var ti=0; ti<tips.length; ti++) {
    html += "<div style=\"display:flex;gap:8px;margin-bottom:8px\">"
      +"<div style=\"width:4px;background:#7c3aed;border-radius:2px;flex-shrink:0\"></div>"
      +"<div style=\"font-size:12px;color:#374151;line-height:1.6\">"+tips[ti]+"</div>"
      +"</div>";
  }
  html += "</div>";
  return html;
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
        "Tu es Huntify, le meilleur conseiller voyage. "
        +"Tu as acces au web en temps reel pour trouver les vrais prix. "
        +"Tu parles comme un ami passione qui connait tous les bons plans.\n\n"
        +"Date : "+today+"\n"
        +"Conversation complete :\n"+hist+"\n\n"
        +"Message : "+message+"\n\n"
        +"Questions deja posees : "+nbQ+". "
        +(nbQ>0
          ?"Tu as deja pose une question. GENERE maintenant, ne pose plus de question."
          :"Si une info vraiment cruciale manque tu peux poser UNE question courte.")
        +"\n\nReflechis librement et utilise le web pour trouver :\n"
        +"- Vrais prix de vols avec compagnie et duree\n"
        +"- Vrais hotels existants avec vrais prix par nuit, adresse, note\n"
        +"- Transports locaux (train/bus/ferry) avec prix et durees reels\n"
        +"- Restaurants locaux avec vrais prix d un repas, specialite\n"
        +"- Activites avec tarifs reels et conseils pratiques\n\n"
        +"Retourne UN JSON selon ce que tu decides :\n\n"
        +"Si tu poses une question : {\"t\":\"q\", \"msg\":\"ta question naturelle\"}\n\n"
        +"Si tu proposes des destinations (pas de destination connue) :\n"
        +"{\"t\":\"p\", \"intro\":\"phrase d intro enthousiaste\", \"items\":[\n"
        +"  {\"dest\":string, \"country\":string, \"flag\":string, \"vibe\":string,\n"
        +"   \"pitch\":\"2 phrases qui donnent envie\",\n"
        +"   \"why\":\"pourquoi cette destination pour ce profil\",\n"
        +"   \"vol_prix\":number, \"vol_co\":string, \"vol_dur\":string,\n"
        +"   \"hotel_nom\":string, \"hotel_prix\":number,\n"
        +"   \"budget_total\":number,\n"
        +"   \"checkin\":\"YYYY-MM-DD\", \"checkout\":\"YYYY-MM-DD\",\n"
        +"   \"iata_dep\":string, \"iata_arr\":string,\n"
        +"   \"activites\":[string,string,string]}\n"
        +"]}\n\n"
        +"Si tu generes un itineraire complet :\n"
        +"{\"t\":\"i\", \"recap\":\"phrase enthousiaste\", \"itin\":{\n"
        +"  \"dest\":string, \"country\":string, \"flag\":string,\n"
        +"  \"dur\":string, \"trav\":string, \"dep\":string, \"style\":string,\n"
        +"  \"checkin\":\"YYYY-MM-DD\", \"checkout\":\"YYYY-MM-DD\", \"adults\":number,\n"
        +"  \"flights\":{\n"
        +"    \"out\":{\"from\":string,\"to\":string,\"prix\":number,\"co\":string,\"dur\":string},\n"
        +"    \"ret\":{\"from\":string,\"to\":string,\"prix\":number,\"co\":string,\"dur\":string}},\n"
        +"  \"hotels\":[{\n"
        +"    \"nom\":string, \"etoiles\":number, \"prix_nuit\":number,\n"
        +"    \"lieu\":string, \"cat\":\"budget|confort|luxe\",\n"
        +"    \"description\":\"1 phrase sur le point fort de cet hotel\"}],\n"
        +"  \"jours\":[{\n"
        +"    \"n\":number, \"titre\":string,\n"
        +"    \"matin\":string, \"aprem\":string, \"soir\":string,\n"
        +"    \"trajet\":\"description du trajet du jour avec prix et durees\",\n"
        +"    \"resto\":{\"nom\":string,\"prix\":\"~XX EUR/pers\",\"cuisine\":string},\n"
        +"    \"activites\":[string],\"budget_jour\":number}],\n"
        +"  \"budget\":{\"vols\":number,\"hotel\":number,\"activites\":number,\n"
        +"    \"resto\":number,\"transport\":number,\"total\":number,\"par_personne\":number},\n"
        +"  \"conseils\":[\"conseil pratique specifique x4\"]}}\n\n"
        +"IATA ref : CDG=Paris,MRS=Marseille,NCE=Nice,LYS=Lyon,BOD=Bordeaux,"
        +"BCN=Barcelone,MAD=Madrid,FCO=Rome,VCE=Venise,FLR=Florence,NAP=Naples,"
        +"LIS=Lisbonne,OPO=Porto,LHR=Londres,AMS=Amsterdam,"
        +"PRG=Prague,BUD=Budapest,ATH=Athenes,JTR=Santorin,"
        +"RAK=Marrakech,DBV=Dubrovnik,IBZ=Ibiza,PMI=Majorque.\n"
        +"JSON uniquement, rien d autre."

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
      const itinId = "itin_"+Date.now();
      let html = "";

      // Hero header premium
      html += heroItin(itin, fCi, fCo, fAd, itin.budget&&itin.budget.total?itin.budget.total:null);

      // Recap IA
      if (ai.recap) html += "<div style='background:#f5f3ff;border:1.5px solid #ddd6fe;border-radius:12px;padding:10px 14px;margin-top:6px;font-size:12.5px;color:#5b21b6;font-weight:600;line-height:1.5'>"+ai.recap+"</div>";

      // Vols
      html += cardFlights(itin.flights, fCi, fCo, fAd, itin.dep||"", dest);

      // Hotels
      var hotelsArr = itin.hotels||[];
      if (hotelsArr.length) {
        html += "<div style='font-size:11px;font-weight:800;color:#7c89a8;text-transform:uppercase;letter-spacing:.08em;margin:16px 0 6px'>\uD83C\uDFE8 Hebergements</div>";
        for (var hi=0; hi<Math.min(hotelsArr.length,3); hi++) {
          var h = hotelsArr[hi];
          h.cat = h.cat||["budget","confort","luxe"][hi]||"confort";
          var hUrl = bookingHotelLink(h.nom||h.name, dest, fCi, fCo, fAd);
          html += cardHotel(h, hUrl, bookingLink(dest,fCi,fCo,fAd,null));
        }
        html += "<div style='display:flex;gap:8px;margin-top:8px'>"
          +"<a href='"+bookingLink(dest,fCi,fCo,fAd,null)+"' target='_blank' rel='sponsored' "
          +"style='flex:1;display:flex;justify-content:center;align-items:center;background:linear-gradient(135deg,#003580,#0071c2);color:#fff;text-decoration:none;border-radius:12px;padding:10px;font-size:11px;font-weight:700'>\uD83C\uDFE8 Booking.com</a>"
          +"<a href='"+expediaLink(dest,fCi,fCo,fAd)+"' target='_blank' rel='sponsored' "
          +"style='flex:1;display:flex;justify-content:center;align-items:center;background:linear-gradient(135deg,#00355f,#00a0e3);color:#fff;text-decoration:none;border-radius:12px;padding:10px;font-size:11px;font-weight:700'>\u2708\uFE0F Expedia</a>"
          +"</div>";
      }

      // GetTransfer
      if (fCi) html += "<a href='"+getTransferLink(dest,fCi)+"' target='_blank' rel='sponsored' "
        +"style='display:flex;justify-content:center;align-items:center;gap:8px;background:linear-gradient(135deg,#1a1a2e,#e94560);color:#fff;text-decoration:none;border-radius:12px;padding:11px;margin-top:8px;font-size:12px;font-weight:700'>\uD83D\uDE97 Transfert aeroport \u00B7 GetTransfer \u2192</a>";

      // Programme jours
      var joursArr = itin.jours||itin.days||[];
      if (joursArr.length) {
        html += "<div style='font-size:11px;font-weight:800;color:#7c89a8;text-transform:uppercase;letter-spacing:.08em;margin:16px 0 8px'>\uD83D\uDCC5 Programme jour par jour</div>";
        for (var ji=0; ji<joursArr.length; ji++) html += cardDay(joursArr[ji]);
      }

      // Budget
      if (itin.budget) html += cardBudget(itin.budget);

      // Conseils
      var consArr = itin.conseils||itin.tips||[];
      if (consArr.length) html += cardTips(consArr);

      // Wishlist + export
      var wD = JSON.stringify({
        type:"voyage", name:(itin.flag||"\u2708\uFE0F")+" "+(itin.dest||""),
        price:itin.budget&&itin.budget.total?itin.budget.total+"\u20AC":"",
        url:bookingLink(dest,fCi,fCo,fAd,null)
      }).replace(/"/g,"&quot;");
      html += "<div style='display:flex;gap:8px;margin-top:12px'>"
        +"<button onclick='addToWishlist("+wD+")' style='flex:1;background:linear-gradient(135deg,#1f2da0,#2f54ff);border:none;color:#fff;border-radius:12px;padding:12px;font-weight:700;font-size:13px;cursor:pointer;font-family:inherit'>\u2661 Sauvegarder</button>"
        +"<button onclick='exportItinerary(\"" + itinId + "\")' style='background:#f5f7ff;border:1.5px solid #c7d2fe;color:#3b5bdb;border-radius:12px;padding:12px;font-weight:700;font-size:13px;cursor:pointer;font-family:inherit'>\u2B07\uFE0F PDF</button>"
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
      "Tu es conseiller shopping Huntify. Lis toute la conversation et deduis le produit exact cherche "
      +"avec TOUS les criteres mentionnes (type, caracteristiques, budget). "
      +"ready:true si tu comprends (meme vaguement). "
      +"JSON: {ready:bool, recap:'produit exact avec tous les criteres', msg:'question si vraiment incomprehensible'}",
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
    const searchPrompt = "Recherche sur amazon.fr les meilleurs produits pour : "+recap+".\n"
      +(dbCtx?"Donnees: "+dbCtx+"\n":"")
      +"IMPORTANT: ne retourne un ASIN (URL /dp/B+9chars) que si tu es CERTAIN qu il existe.\n"
      +"Si incertain : url:null (le systeme fera une recherche a la place, c est ok).\n"
      +"Prix : vrai prix amazon.fr. Si inconnu : null.\n"
      +"Rakuten : 1 produit, url:null est ok.\n"
      +"JSON: {summary:string, "
      +"products:[{name,price:string|null,store:'amazon'|'rakuten',keywords,url:string|null,badge}], "
      +"promoCodes:[{code,store,discount,best:bool}]}";

    const groqRaw  = await groqSearch(searchPrompt, 1200);
    const groqData = parseJSON(groqRaw||"");
    let products   = groqData.products||[];
    let summary    = groqData.summary||"";
    let promos     = groqData.promoCodes||[];

    // Etape 3 : Detecte si Groq a invente un ASIN
    // Invente = URL non-null mais format ASIN invalide
    // Honnete = URL null (on utilise /s?k= → pas de pb)
    const groqLied = products.some(function(p){
      return (p.store||"").includes("amazon")
        && p.url && p.url!=="null" && p.url.length>5
        && !/\/dp\/B[A-Z0-9]{9}/.test(p.url);
    });

    // Efface les prix sur produits sans ASIN (prix sans source = invente)
    products.forEach(function(p){
      if ((p.store||"").includes("amazon") && (!p.url||p.url==="null")) {
        p.price = null;
      }
    });

    // Etape 4 : Claude web_search SEULEMENT si Groq a invente
    if (groqLied) {
      const cRaw = await claudeAI(
        "Agent shopping. Cherche sur amazon.fr : "+recap+". JSON: {products:[{name,price,store:'amazon',keywords,url,badge}]}",
        "Trouve les vrais ASINs (URL: https://www.amazon.fr/dp/B0XXXXXXXXX). JSON uniquement.",
        500,
        [{type:"web_search_20250305",name:"web_search",max_uses:2}]
      );
      const cProds = parseJSON(cRaw||"").products||[];
      const validC = cProds.filter(function(p){return p.url&&/\/dp\/B[A-Z0-9]{9}/.test(p.url);});
      if (validC.length) {
        // Remplace seulement les produits Amazon par ceux de Claude
        products = products.filter(function(p){return !(p.store||"").includes("amazon");});
        products = validC.concat(products);
        if (!summary && parseJSON(cRaw||"").summary) summary = parseJSON(cRaw||"").summary;
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
    console.error("Huntify error:", err&&err.message, err&&err.stack);
    return new Response(JSON.stringify({
      reply:'<div style="font-size:13px;color:#1e293b">Une erreur est survenue, reessayez !</div>'
    }),{status:200,headers:{"Content-Type":"application/json","Access-Control-Allow-Origin":"*"}});
  }
}
