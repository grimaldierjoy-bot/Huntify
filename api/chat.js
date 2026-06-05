export const config = { runtime: 'edge' };

// ─────────────────────────────────────────────────────────────────────────────
// HUNTIFY — Agent IA shopping + voyage
// Architecture : Groq DeepSearch (gratuit, web) → Claude (génération finale)
// ─────────────────────────────────────────────────────────────────────────────

const SUPABASE_URL = "https://enocxbrqyybendertytl.supabase.co";
const SUPABASE_KEY = "sb_publishable_NmPh--frZG5HuqfaoxnemA_E7cidV9Y";
const AMAZON_TAG   = "huntify21-21";
const AWIN_PUB     = "2920215";
const RAKUTEN_MID  = "55615";
const TP_MARKER    = "536663";
const MODEL        = "claude-haiku-4-5";

// ── SUPABASE ──────────────────────────────────────────────────────────────────
async function sbFetch(path, method, body) {
  method = method||"GET";
  const h = {"Content-Type":"application/json","apikey":SUPABASE_KEY,"Authorization":"Bearer "+SUPABASE_KEY};
  const opts = {method, headers:h};
  if (body) opts.body = JSON.stringify(body);
  try { const r = await fetch(SUPABASE_URL+"/rest/v1/"+path, opts); return await r.json(); } catch(e) { return null; }
}

async function getAdvertisers() {
  try {
    const r = await fetch(SUPABASE_URL+"/rest/v1/advertisers?active=eq.true", {headers:{"apikey":SUPABASE_KEY,"Authorization":"Bearer "+SUPABASE_KEY}});
    const data = await r.json();
    return Array.isArray(data) ? data : [];
  } catch(e) { return []; }
}

// ── LIEN AMAZON ───────────────────────────────────────────────────────────────
function amazonLink(keywords, directUrl, tag) {
  tag = tag||AMAZON_TAG;
  const kw = cleanKeywords(keywords);
  const isValidAsin = directUrl && directUrl.includes("/dp/") && !directUrl.includes("/dp/null") && !directUrl.includes("/dp/undefined") && directUrl.length > 20;
  const base = isValidAsin ? directUrl.split("?")[0] : "https://www.amazon.fr/s?k="+encodeURIComponent(kw);
  return base+"?tag="+tag;
}

// ── LIEN RAKUTEN (Awin) ───────────────────────────────────────────────────────
function rakutenLink(keywords, mid, affid) {
  mid = mid||RAKUTEN_MID; affid = affid||AWIN_PUB;
  const kw = cleanKeywords(keywords);
  const dest = "https://fr.shopping.rakuten.com/s/"+encodeURIComponent(kw.replace(/\s+/g,"+"));
  return "https://www.awin1.com/cread.php?awinmid="+mid+"&awinaffid="+affid+"&ued="+encodeURIComponent(dest);
}

// ── LIEN AWIN GÉNÉRIQUE ───────────────────────────────────────────────────────
function awinLink(adv, keywords) {
  const kw = cleanKeywords(keywords);
  const affid = adv.awin_affid||adv.awin_aff||AWIN_PUB;
  const dest = (adv.search_url||"https://www."+adv.slug+".fr/search?q={kw}").replace("{kw}", encodeURIComponent(kw));
  return "https://www.awin1.com/cread.php?awinmid="+adv.awin_mid+"&awinaffid="+affid+"&ued="+encodeURIComponent(dest);
}

function buildLink(adv, keywords, directUrl) {
  if (!adv||!adv.active) return null;
  if (adv.slug === "amazon") return amazonLink(keywords, directUrl, adv.amazon_tag||AMAZON_TAG);
  if (adv.slug === "rakuten") return rakutenLink(keywords, adv.awin_mid||RAKUTEN_MID, adv.awin_affid||adv.awin_aff||AWIN_PUB);
  if (adv.awin_mid) return awinLink(adv, keywords);
  return null;
}

function cleanKeywords(kw) {
  if (!kw) return "";
  const stop = new Set(["la","le","les","un","une","des","avec","et","en","du","au","aux","pour","sur","dans","par"]);
  return kw.replace(/,/g," ").replace(/\s+/g," ").trim()
    .split(" ").filter(w=>w.length>1&&!stop.has(w.toLowerCase())).slice(0,7).join(" ");
}

function findAdv(advertisers, slug) {
  return (advertisers||[]).find(a=>a.slug===(slug||"").toLowerCase())||null;
}

// ── VOYAGE : LIENS ────────────────────────────────────────────────────────────
const IATA = {
  paris:"CDG",lyon:"LYS",marseille:"MRS",nice:"NCE",bordeaux:"BOD",toulouse:"TLS",
  nantes:"NTE",strasbourg:"SXB",montpellier:"MPL",rennes:"RNS",biarritz:"BIQ",
  rome:"FCO",milan:"MXP",venise:"VCE",naples:"NAP",florence:"FLR",turin:"TRN",
  barcelone:"BCN",madrid:"MAD",ibiza:"IBZ",majorque:"PMI",seville:"SVQ",malaga:"AGP",
  lisbonne:"LIS",porto:"OPO",faro:"FAO",
  londres:"LHR",manchester:"MAN",edimbourg:"EDI",
  amsterdam:"AMS",bruxelles:"BRU",zurich:"ZRH",geneve:"GVA",vienne:"VIE",
  berlin:"BER",munich:"MUC",francfort:"FRA",hambourg:"HAM",dusseldorf:"DUS",
  prague:"PRG",budapest:"BUD",varsovie:"WAW",
  athenes:"ATH",santorin:"JTR",mykonos:"JMK",crete:"HER",rhodes:"RHO",corfou:"CFU",
  marrakech:"RAK",casablanca:"CMN",agadir:"AGA",tunis:"TUN",djerba:"DJE",hurghada:"HRG",
  istanbul:"IST",antalya:"AYT",
  dubai:"DXB","abu dhabi":"AUH",doha:"DOH",
  tokyo:"NRT",osaka:"KIX",bangkok:"BKK",singapour:"SIN",bali:"DPS","kuala lumpur":"KUL",
  "new york":"JFK","los angeles":"LAX",miami:"MIA",montreal:"YUL",cancun:"CUN",
  maldives:"MLE",maurice:"MRU",reunion:"RUN"
};

function toIATA(str) {
  if (!str) return null;
  const code = (str||"").match(/\b([A-Z]{3})\b/);
  if (code) return code[1];
  const s = str.toLowerCase().trim();
  for (const [k,v] of Object.entries(IATA)) { if (s.includes(k)) return v; }
  return null;
}

function skyscannerLink(from, to, ci, co, adults) {
  const f = (toIATA(from)||"par").toLowerCase();
  const t = (toIATA(to)||"xxx").toLowerCase();
  const fmt = d => d ? d.replace(/-/g,"").slice(2) : null;
  const out = fmt(ci), ret = fmt(co);
  const base = "https://www.skyscanner.fr/transport/vols/"+f+"/"+t+"/";
  if (out&&ret) return base+out+"/"+ret+"/?adults="+(adults||2)+"&currency=EUR";
  if (out) return base+out+"/?adults="+(adults||2)+"&currency=EUR";
  return base;
}

function hotellookLink(dest, ci, co, adults, minP, maxP) {
  let url = "https://www.hotellook.com/search?location="+encodeURIComponent(dest||"")+"&marker="+TP_MARKER+"&adults="+(adults||2)+"&currency=EUR";
  if (ci) url += "&checkIn="+ci;
  if (co) url += "&checkOut="+co;
  if (minP) url += "&priceMin="+minP;
  if (maxP) url += "&priceMax="+maxP;
  return url;
}

async function fetchHotellookPrices(dest, ci, co, adults) {
  const token = process.env.TRAVELPAYOUTS_TOKEN;
  if (!token||!ci||!co||!dest) return null;
  try {
    const url = "https://engine.hotellook.com/api/v2/cache.json"
      +"?location="+encodeURIComponent(dest)
      +"&checkIn="+ci+"&checkOut="+co
      +"&adultsCount="+(adults||2)+"&currency=EUR&token="+token+"&limit=25";
    const r = await fetch(url, {headers:{"Accept":"application/json"}});
    if (!r.ok) return null;
    const data = await r.json();
    if (!Array.isArray(data)||data.length<2) return null;
    const valid = data
      .filter(h=>h.priceFrom&&(h.hotelName||h.name)&&h.id)
      .map(h=>({
        name: h.hotelName||h.name,
        stars: Math.round(h.stars||3),
        price: Math.round(h.priceFrom),
        loc: (h.location&&h.location.name)||dest,
        url: "https://www.hotellook.com/hotels/"+h.id+"?marker="+TP_MARKER+"&adults="+(adults||2)+"&checkIn="+ci+"&checkOut="+co+"&currency=EUR"
      }))
      .sort((a,b)=>a.price-b.price);
    if (valid.length<2) return null;
    const t = Math.max(1,Math.floor(valid.length/3));
    const mid = arr => arr[Math.floor(arr.length/2)];
    return [
      Object.assign(mid(valid.slice(0,t)),    {cat:"budget",  hl:"Meilleur rapport qualite/prix"}),
      Object.assign(mid(valid.slice(t,t*2)),  {cat:"confort", hl:"Confort et emplacement ideal"}),
      Object.assign(mid(valid.slice(-t)),     {cat:"luxe",    hl:"Experience premium"}),
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
  if (!history||!history.length) return "";
  return (history||[]).map(m=>{
    const who = m.role==="user"?"Client":"Huntify";
    const text = (m.content||"").replace(/<[^>]*>/g," ").replace(/\s+/g," ").trim().slice(0,300);
    return text ? who+": "+text : null;
  }).filter(Boolean).join("\n").slice(0, maxLen||2000);
}

// ── APPELS IA ─────────────────────────────────────────────────────────────────

// Groq standard (Llama 70b, rapide, gratuit)
async function groq(sys, user, maxTok) {
  const key = process.env.GROQ_API_KEY;
  if (!key) return null;
  try {
    const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method:"POST",
      headers:{"Content-Type":"application/json","Authorization":"Bearer "+key},
      body: JSON.stringify({model:"llama-3.3-70b-versatile", max_tokens:maxTok||500, messages:[{role:"system",content:sys},{role:"user",content:user}]})
    });
    if (!r.ok) return null;
    const d = await r.json();
    return d.choices&&d.choices[0] ? d.choices[0].message.content : null;
  } catch(e) { return null; }
}

// Groq DeepSearch (compound-beta, recherche web gratuite)
async function groqSearch(prompt, maxTok) {
  const key = process.env.GROQ_API_KEY;
  if (!key) return null;
  try {
    const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method:"POST",
      headers:{"Content-Type":"application/json","Authorization":"Bearer "+key},
      body: JSON.stringify({model:"compound-beta", max_tokens:maxTok||1200, messages:[{role:"user",content:prompt}]})
    });
    if (!r.ok) {
      // fallback Llama si compound-beta indispo
      return await groq("Tu es un expert shopping. Reponds en JSON.", prompt, maxTok||1200);
    }
    const d = await r.json();
    return d.choices&&d.choices[0] ? d.choices[0].message.content : null;
  } catch(e) {
    return await groq("Tu es un expert shopping. Reponds en JSON.", prompt, maxTok||1200);
  }
}

// Gemini flash (gratuit, fallback)
async function gemini(prompt, maxTok) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  try {
    const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key="+key, {
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body: JSON.stringify({contents:[{parts:[{text:prompt}]}], generationConfig:{maxOutputTokens:maxTok||500}})
    });
    if (!r.ok) return null;
    const d = await r.json();
    return d.candidates&&d.candidates[0]&&d.candidates[0].content&&d.candidates[0].content.parts ? d.candidates[0].content.parts[0].text : null;
  } catch(e) { return null; }
}

// Mistral (fallback)
async function mistral(sys, user, maxTok) {
  const key = process.env.MISTRAL_API_KEY;
  if (!key) return null;
  try {
    const r = await fetch("https://api.mistral.ai/v1/chat/completions", {
      method:"POST",
      headers:{"Content-Type":"application/json","Authorization":"Bearer "+key},
      body: JSON.stringify({model:"mistral-small-latest", max_tokens:maxTok||500, messages:[{role:"system",content:sys},{role:"user",content:user}]})
    });
    if (!r.ok) return null;
    const d = await r.json();
    return d.choices&&d.choices[0] ? d.choices[0].message.content : null;
  } catch(e) { return null; }
}

// IA gratuite cascade (Groq → Gemini → Mistral)
async function freeAI(sys, user, maxTok) {
  return await groq(sys, user, maxTok)
      || await gemini(sys+"\n\n"+user, maxTok)
      || await mistral(sys, user, maxTok);
}

// Claude (payant, uniquement pour génération finale haute valeur)
async function claude(sys, user, maxTok, tools) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method:"POST",
      headers:{"Content-Type":"application/json; charset=utf-8","x-api-key":key,"anthropic-version":"2023-06-01"},
      body: JSON.stringify({model:MODEL, max_tokens:maxTok||800, tools:tools||[], system:sys, messages:[{role:"user",content:user}]})
    });
    const d = await r.json();
    if (!r.ok) return null;
    let txt = "";
    for (const b of (d.content||[])) { if (b.type==="text") txt+=b.text; }
    return txt||null;
  } catch(e) { return null; }
}

function parseJSON(raw) {
  if (!raw) return {};
  try { const m=raw.match(/```(?:json)?\s*([\s\S]*?)```/); if(m) return JSON.parse(m[1].trim()); } catch(e){}
  try { const m=raw.match(/\{[\s\S]*\}/); if(m) return JSON.parse(m[0]); } catch(e){}
  return {};
}

// ── DB INTERNE ────────────────────────────────────────────────────────────────
async function dbLookup(keywords) {
  const kw = (keywords||"").toLowerCase().split(" ")[0];
  try {
    const [deals,prices,promos] = await Promise.all([
      sbFetch("daily_deals?name=ilike.*"+encodeURIComponent(kw)+"*&limit=3"),
      sbFetch("price_history?product_name=ilike.*"+encodeURIComponent(kw)+"*&order=checked_at.desc&limit=5"),
      sbFetch("promo_codes?valid=eq.true&order=found_at.desc&limit=2")
    ]);
    const parts = [];
    if (deals&&deals.length) parts.push("Deals: "+deals.map(x=>x.name+" "+x.price+"€").join(" | "));
    if (prices&&prices.length) parts.push("Prix historique: "+prices.map(x=>x.product_name+" "+x.price+"€").join(" | "));
    if (promos&&promos.length) parts.push("Codes promo: "+promos.map(x=>x.code+" ("+x.store+")").join(" | "));
    return parts.join("\n");
  } catch(e) { return ""; }
}

// ── COMPOSANTS HTML ───────────────────────────────────────────────────────────
function cardProduct(name, price, url, adv, img, badge) {
  const imgH = img ? '<img src="'+img+'" style="width:56px;height:56px;object-fit:cover;border-radius:8px;flex-shrink:0" onerror="this.style.display=\'none\'">' : "";
  const pill = '<span style="background:rgba(255,255,255,.2);border-radius:100px;padding:2px 10px;font-size:10px;font-weight:800">'+(adv.emoji||"🛍️")+" "+adv.name+"</span>";
  const bdg  = badge ? " · "+badge : "";
  return '<a href="'+url+'" target="_blank" rel="sponsored noopener" style="display:flex;align-items:center;gap:12px;background:'+(adv.color||"#2f54ff")+';color:#fff;text-decoration:none;border-radius:14px;padding:12px 14px;margin-top:8px">'
    +imgH
    +'<div style="flex:1;min-width:0"><div style="font-size:10px;margin-bottom:4px;opacity:.85">'+pill+bdg+"</div>"
    +'<div style="font-size:13px;font-weight:800;line-height:1.3;word-break:break-word">'+name+"</div></div>"
    +'<span style="background:rgba(255,255,255,.22);border-radius:8px;padding:5px 10px;white-space:nowrap;font-size:14px;font-weight:900;flex-shrink:0">'+(price||"Voir prix")+"</span></a>";
}

function cardHotel(h, link) {
  const stars = "⭐".repeat(Math.min(h.stars||3,5));
  const colors = {budget:"#16a34a",confort:"#2f54ff",luxe:"#7c3aed"};
  const labels = {budget:"💚 Budget",confort:"💙 Confort",luxe:"💎 Luxe"};
  const cc = colors[h.cat]||"#2f54ff";
  const cl = labels[h.cat]||"";
  const hasPrice = h.price&&h.priceReal;
  const priceDiv = hasPrice
    ? '<div style="background:linear-gradient(135deg,#16a34a,#15803d);color:#fff;border-radius:10px;padding:7px 11px;text-align:center;flex-shrink:0;margin-left:8px"><div style="font-size:9px;opacity:.85">Prix réel ✓</div><div style="font-size:15px;font-weight:900">'+h.price+'€</div><div style="font-size:9px;opacity:.75">/nuit</div></div>'
    : '<div style="background:linear-gradient(135deg,'+cc+','+cc+'cc);color:#fff;border-radius:10px;padding:8px 12px;text-align:center;flex-shrink:0;margin-left:8px"><div style="font-size:10px">Voir prix</div><div style="font-size:12px;font-weight:800">→</div></div>';
  return '<a href="'+link+'" target="_blank" rel="sponsored noopener" style="display:flex;flex-direction:column;background:#fff;border:1.5px solid '+(hasPrice?"#bbf7d0":"#e6ebf7")+';border-radius:14px;padding:13px;margin-top:8px;text-decoration:none;gap:5px">'
    +'<div style="display:flex;justify-content:space-between;align-items:flex-start">'
    +'<div style="flex:1">'+(cl?'<span style="background:#eff6ff;color:'+cc+';border-radius:100px;padding:2px 9px;font-size:10px;font-weight:800">'+cl+"</span>":"")
    +'<div style="font-size:13px;font-weight:800;color:#0e1430;margin-top:3px">'+h.name+"</div>"
    +'<div style="font-size:11px;color:#7c89a8">'+stars+" · "+(h.loc||"")+"</div></div>"
    +priceDiv+"</div>"
    +(h.hl?'<div style="font-size:11px;color:#2f54ff;font-weight:600;background:#eff6ff;border-radius:8px;padding:4px 10px">✨ '+h.hl+"</div>":"")
    +'<div style="background:'+(hasPrice?"#f0fdf4":"#f0f9ff")+';;border-radius:8px;padding:6px 10px;font-size:11px;color:'+(hasPrice?"#15803d":"#0369a1")+';font-weight:600">'
    +(hasPrice?"🟢 Prix vérifié · Réserver sur Hotellook →":"🏨 Voir les prix en temps réel sur Hotellook →")+"</div></a>";
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
    +(d.resto?'<div style="background:#f0fdf4;border-radius:9px;padding:7px 11px;margin-top:6px;display:flex;justify-content:space-between"><div style="font-size:11px;color:#16a34a;font-weight:700">🍽️ '+d.resto.name+"</div><div style='font-size:11px;color:#16a34a;font-weight:700'>"+d.resto.price+"</div></div>":"")
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
    +'<div style="font-size:10px;color:rgba(255,255,255,.4);margin-top:8px">Estimations IA · Cliquez les liens pour les vrais prix en temps réel</div></div>';
}

function cardTips(tips) {
  if (!tips||!tips.length) return "";
  return '<div style="background:#f5f3ff;border:1.5px solid #ddd6fe;border-radius:14px;padding:14px;margin-top:10px">'
    +'<div style="font-size:12px;font-weight:800;color:#5b21b6;margin-bottom:8px">💡 Conseils pratiques</div>'
    +tips.map(t=>'<div style="font-size:12px;color:#374151;margin-bottom:5px;padding-left:8px;border-left:2px solid #c4b5fd">• '+t+"</div>").join("")+"</div>";
}

function promoBox(code, store, desc, best) {
  return '<div style="background:'+(best?"#dcfce7":"#f0fdf4")+';border:'+(best?"2px solid #16a34a":"1.5px solid #86efac")+';border-radius:12px;padding:10px 14px;margin-top:6px;display:flex;align-items:center;justify-content:space-between;gap:8px">'
    +'<div><span style="font-size:11px;color:#16a34a;font-weight:700">'+(best?"⭐ MEILLEUR — ":"")+"🏷️ "+store+"</span><div style='font-size:12px;color:#166534;font-weight:600'>"+desc+"</div></div>"
    +'<div onclick="navigator.clipboard.writeText(\''+code+'\');this.innerHTML=\'✓\';setTimeout(()=>this.innerHTML=\''+code+'\',2000)" style="background:#16a34a;color:#fff;border-radius:8px;padding:6px 10px;font-weight:800;font-size:12px;cursor:pointer;white-space:nowrap;flex-shrink:0">'+code+"</div></div>";
}

// ── HANDLER ───────────────────────────────────────────────────────────────────
export default async function handler(req) {
  if (req.method==="OPTIONS") return new Response(null,{status:204,headers:{"Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"POST,OPTIONS","Access-Control-Allow-Headers":"Content-Type"}});
  if (req.method!=="POST")   return new Response("Method not allowed",{status:405});
  const H = {"Content-Type":"application/json; charset=utf-8","Access-Control-Allow-Origin":"*"};

  try {
    const body          = await req.json();
    const message       = body.message||"";
    const history       = body.history||[];
    const sessionId     = body.sessionId;
    const userId        = body.userId;
    const trackEnabled  = body.trackingEnabled;
    const mode          = body.mode;
    const sid           = sessionId||("anon_"+Date.now());
    const isTravel      = mode==="travel";
    const today         = new Date().toISOString().slice(0,10);

    // Chargement annonceurs (pour affiliation)
    const advertisers = await getAdvertisers();

    // Tracking asynchrone non-bloquant
    if (trackEnabled) {
      Promise.all([
        sbFetch("searches","POST",{query:message,session_id:sid,user_id:userId||null}),
        sbFetch("trends","POST",{query:message.toLowerCase().trim(),count:1,last_searched:new Date().toISOString()})
      ]).catch(()=>{});
    }

    const hist  = formatHistory(history, 2000);
    const histS = formatHistory(history, 1000);

    // ══════════════════════════════════════════════════════════════════════════
    // ██████  MODE VOYAGE  ████████████████████████████████████████████████████
    // ══════════════════════════════════════════════════════════════════════════
    if (isTravel) {

      // ── Groq DeepSearch pilote TOUT — lit la conversation, extrait les infos,
      // décide seul si poser une question ou générer. Zéro logique hardcodée.
      const groqPrompt = "Tu es Huntify, agent voyage IA. Analyse cette conversation et agis.\n"
        +"Aujourd'hui: "+today+"\n\n"
        +"CONVERSATION COMPLETE:\n"+hist+"\n"
        +"MESSAGE EN COURS: "+message+"\n\n"
        +"INSTRUCTIONS:\n"
        +"1. Extrais TOUTES les infos du voyage dans la conversation (destination, ville de depart, dates, duree, budget, style, nb personnes).\n"
        +"2. La ville de depart peut etre mentionnee n'importe comment: 'marseille', 'depuis marseille', 'je pars de nice', 'marseilel' (faute ok).\n"
        +"3. Si tu as destination + ville depart + duree OU dates → action=generate.\n"
        +"4. Sinon → action=question avec UNE question courte sur l'info la plus importante manquante.\n"
        +"5. Ne pose JAMAIS deux fois la meme question. Lis bien l'historique avant.\n"
        +"6. Si plus de 3 echanges et infos insuffisantes → genere quand meme avec ce que tu as.\n\n"
        +"Reponds UNIQUEMENT en JSON valide:\n"
        +"Pour question: {action:'question', msg:'ta question', infos:{tout ce que tu as extrait}}\n"
        +"Pour generation: {action:'generate', infos:{destination, depart, nb_adultes, checkin, checkout, duree, budget, style}}";

      const groqDecision = parseJSON(
        await groqSearch(groqPrompt, 700)
        || await freeAI("Reponds en JSON.", groqPrompt, 700)
        || "{}"
      );

      // Groq dit de poser une question → on l'affiche directement
      if (groqDecision.action==="question" && groqDecision.msg) {
        return new Response(JSON.stringify({reply:'<div style="font-size:13.5px;color:#1e293b;line-height:1.6;padding:4px 0">'+groqDecision.msg+"</div>",sessionId:sid}),{headers:H});
      }

      // Groq dit de générer (ou pas de décision claire → on génère avec ce qu'on a)
      const infos = groqDecision.infos||{};
      const adults = parseInt(infos.nb_adultes)||2;
      const ci = parseDate(infos.checkin||infos.date_depart||null);
      const co = parseDate(infos.checkout||infos.date_retour||null)||(function(){
        if (ci && infos.duree) {
          const days = parseInt((infos.duree||"").match(/\d+/)||[3]);
          const d = new Date(ci); d.setDate(d.getDate()+days); return d.toISOString().slice(0,10);
        }
        return null;
      }());

      // ── ÉTAPE 2 : Claude génère l'itinéraire complet ─────────────────────────
      const claudeSys = "Tu es un expert voyage. Genere un itineraire complet en JSON.\n"
        +"Date: "+today+"\n"
        +"Infos client: destination="+infos.destination+", depart="+infos.depart+", adultes="+(infos.nb_adultes||2)+", checkin="+(ci||"?")+" checkout="+(co||"?")+", budget="+(infos.budget||"moyen")+", style="+(infos.style||"equilibre")+"\n\n"
        +"Genere un JSON avec:\n"
        +"- t: 'i', recap: string\n"
        +"- itin.dest, itin.country, itin.flag, itin.dur, itin.trav, itin.style, itin.dep\n"
        +"- itin.checkin, itin.checkout (YYYY-MM-DD), itin.adults\n"
        +"- itin.flights.out et ret: from/to (IATA 3 lettres MAJ), price, co, dur\n"
        +"- itin.hotels: 3 vrais hotels (name, stars, price, loc, hl, cat: budget/confort/luxe)\n"
        +"- itin.days: programme par jour (n, title, am, pm, eve, resto, acts, budget)\n"
        +"- itin.budget: vols, hotel, acts, resto, transport, total, pp\n"
        +"- itin.tips: 3-5 conseils\n"
        +"JSON UNIQUEMENT.";

      const claudeUser = "Genere l itineraire: "+JSON.stringify(infos);

      let itinRaw = await claude(claudeSys, claudeUser, 3000, []);

      // Fallback : Groq DeepSearch si Claude échoue
      if (!itinRaw) {
        itinRaw = await groqSearch(claudeSys+"\n\n"+claudeUser, 2500);
      }
      if (!itinRaw) {
        itinRaw = await gemini(claudeSys+"\n\n"+claudeUser, 2500);
      }

      const tP = parseJSON(itinRaw||"");
      const itin = tP.itin;

      // Si vraiment rien → liens directs minimaux
      if (!itin) {
        const skyUrl = skyscannerLink(infos.depart||"", infos.destination||"", ci, co, adults);
        const htlUrl = hotellookLink(infos.destination||"", ci, co, adults, null, null);
        const html = '<div style="font-size:13.5px;color:#1e293b;line-height:1.6;padding:4px 0;margin-bottom:12px">Je n\'ai pas pu générer l\'itinéraire complet, mais voici les liens directs pour votre voyage à '+(infos.destination||"destination")+" :</div>"
          +'<a href="'+skyUrl+'" target="_blank" style="display:flex;align-items:center;justify-content:center;gap:8px;background:linear-gradient(135deg,#0e1430,#1f2da0);color:#fff;text-decoration:none;border-radius:12px;padding:14px;margin-top:8px;font-size:13px;font-weight:700">✈️ Voir les vols sur Skyscanner →</a>'
          +'<a href="'+htlUrl+'" target="_blank" style="display:flex;align-items:center;justify-content:center;gap:8px;background:linear-gradient(135deg,#1f2da0,#2f54ff);color:#fff;text-decoration:none;border-radius:12px;padding:14px;margin-top:8px;font-size:13px;font-weight:700">🏨 Voir les hôtels sur Hotellook →</a>';
        return new Response(JSON.stringify({reply:html,sessionId:sid}),{headers:H});
      }

      // ── ÉTAPE 3 : Render HTML itinéraire ────────────────────────────────────
      const nights = parseInt(((itin.dur||"").match(/\d+/)||[3])[0])||3;
      const finalCi = (/^\d{4}-\d{2}-\d{2}$/.test(itin.checkin||"")) ? itin.checkin : (ci||null);
      const finalCo = (/^\d{4}-\d{2}-\d{2}$/.test(itin.checkout||"")) ? itin.checkout : (co||(function(){if(finalCi){const d=new Date(finalCi);d.setDate(d.getDate()+nights);return d.toISOString().slice(0,10);}return null;}()));
      const itinId = "itin_"+Date.now();
      let html = "";

      // Header
      html += '<div id="'+itinId+'" style="background:linear-gradient(135deg,#1f2da0,#2f54ff);border-radius:16px;padding:18px;margin-bottom:4px;text-align:center">'
        +'<div style="font-size:32px;margin-bottom:6px">'+(itin.flag||"✈️")+"</div>"
        +'<div style="font-family:\'Sora\',sans-serif;font-size:20px;font-weight:800;color:#fff">'+(itin.dest||"")+(itin.country?", "+itin.country:"")+"</div>"
        +'<div style="font-size:12px;color:rgba(255,255,255,.75);margin-top:6px;display:flex;justify-content:center;gap:12px;flex-wrap:wrap">'
        +"<span>📅 "+(itin.dur||nights+" jours")+"</span><span>👥 "+(itin.trav||adults+" pers.")+"</span>"
        +(itin.dep?"<span>🛫 Depuis "+itin.dep+"</span>":"")
        +(itin.budget&&itin.budget.total?"<span>💰 ~"+itin.budget.total+"€</span>":"")
        +"</div></div>";

      if (tP.recap) html += '<div style="background:#f5f3ff;border:1.5px solid #ddd6fe;border-radius:12px;padding:10px 14px;margin-top:8px;font-size:12px;color:#5b21b6;font-weight:600">🔎 '+tP.recap+"</div>";

      // Vols
      if (itin.flights&&itin.flights.out) {
        const f = itin.flights;
        const sky = skyscannerLink(f.out.from||itin.dep||infos.depart||"", f.out.to||itin.dest||"", finalCi, finalCo, itin.adults||adults);
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

      // Hôtels
      const realHotels = await fetchHotellookPrices(itin.dest||"", finalCi, finalCo, itin.adults||adults);
      const hasReal = !!(realHotels&&realHotels.length);
      const hotelsDisplay = hasReal ? realHotels : (itin.hotels||[]).map(function(h,i){
        return {
          name:h.name, stars:h.stars||3, price:null, loc:h.loc||itin.dest, hl:h.hl,
          cat:["budget","confort","luxe"][i]||h.cat||"confort",
          url: hotellookLink(itin.dest||"",finalCi,finalCo,itin.adults||adults, i===0?null:i===1?80:180, i===0?100:i===1?200:null)
        };
      });

      html += '<div style="font-size:12px;font-weight:800;color:#0e1430;margin:16px 0 6px">🏨 Hébergements · '
        +(hasReal?'<span style="color:#16a34a;font-size:11px">Prix réels Hotellook ✓</span>':'<span style="color:#7c89a8;font-size:11px">Cliquez pour les prix</span>')+"</div>";

      const htPrices = [];
      for (const h of hotelsDisplay) {
        if (h.price) htPrices.push(h.price);
        const hLink = h.url||hotellookLink(itin.dest||"",finalCi,finalCo,itin.adults||adults,null,null);
        html += cardHotel({name:h.name,stars:h.stars,price:h.price?String(h.price):null,priceReal:hasReal&&!!h.price,loc:h.loc||itin.dest,hl:h.hl,cat:h.cat}, hLink);
      }

      const htMin = htPrices.length?Math.max(0,Math.min.apply(null,htPrices)-20):null;
      const htMax = htPrices.length?Math.max.apply(null,htPrices)+50:null;
      html += '<a href="'+hotellookLink(itin.dest||"",finalCi,finalCo,itin.adults||adults,htMin,htMax)+'" target="_blank" style="display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#0e1430,#2f54ff);color:#fff;text-decoration:none;border-radius:12px;padding:12px;margin-top:8px;font-size:12px;font-weight:700">🏨 Voir tous les hôtels disponibles sur Hotellook'+(finalCi?" ("+finalCi+" → "+finalCo+")":"")+" →</a>";

      // Programme jour par jour
      if (itin.days&&itin.days.length) {
        html += '<div style="font-size:12px;font-weight:800;color:#0e1430;margin:16px 0 6px">📅 Programme jour par jour</div>';
        for (const d of itin.days) html += cardDay(d);
      }

      if (itin.budget) html += cardBudget(itin.budget);
      if (itin.tips&&itin.tips.length) html += cardTips(itin.tips);

      // Boutons Sauvegarder + Exporter
      const wData = JSON.stringify({
        type:"voyage", name:(itin.flag||"✈️")+" "+(itin.dest||""), subtitle:(itin.dur||"")+" · "+(itin.trav||adults+" pers."),
        store:"hotellook", url:hotellookLink(itin.dest||"",finalCi,finalCo,itin.adults||adults,null,null)
      }).replace(/"/g,"&quot;");
      html += '<div style="display:flex;gap:8px;margin-top:12px">'
        +'<button onclick="addToWishlist('+wData+')" style="flex:1;background:linear-gradient(135deg,#1f2da0,#2f54ff);border:none;color:#fff;border-radius:12px;padding:12px;font-weight:700;font-size:13px;cursor:pointer;font-family:inherit">♡ Sauvegarder</button>'
        +'<button onclick="exportItinerary(\''+itinId+'\')" style="background:#f5f7ff;border:1.5px solid #c7d2fe;color:#3b5bdb;border-radius:12px;padding:12px;font-weight:700;font-size:13px;cursor:pointer;font-family:inherit">⬇️ Exporter</button></div>';

      if (trackEnabled) sbFetch("searches","POST",{query:"[VOYAGE] "+message,session_id:sid,user_id:userId||null}).catch(()=>{});
      return new Response(JSON.stringify({reply:html,sessionId:sid}),{headers:H});
    }

    // ══════════════════════════════════════════════════════════════════════════
    // ██████  MODE PRODUIT  ███████████████████████████████████████████████████
    // ══════════════════════════════════════════════════════════════════════════

    // ── ÉTAPE 1 : Groq lit la conversation et décide ──────────────────────────
    // Groq DeepSearch comprend le contexte naturellement, sans logique hardcodée
    const nbExchanges = history.length;

    const groqProdSys = "Tu es l'assistant shopping Huntify. Tu analyses une conversation pour trouver le meilleur produit.\n"
      +"Historique:\n"+histS+"\n\n"
      +"Message actuel: "+message+"\n\n"
      +"ANALYSE et decide:\n"
      +"1. Si tu as assez d infos pour chercher (besoin + budget ou apres 2 echanges) → ready:true avec recap\n"
      +"2. Sinon → pose UNE question naturelle (uniquement sur budget ou usage, rien d autre)\n"
      +"3. Si 2 questions deja posees (nbEchanges="+nbExchanges+") → ready:true obligatoire\n\n"
      +"NE JAMAIS demander: forme du packaging, couleur, avis detaille, criteres superflus.\n"
      +"SEULEMENT: budget si pas connu, ou usage si vraiment ambigu.\n\n"
      +"Reponds JSON: {\"ready\":true,\"recap\":\"mots-cles produit concrets\"} ou {\"ready\":false,\"msg\":\"question courte\"}";

    const groqProd = parseJSON(
      await groq(groqProdSys, message, 300)
      || await gemini(groqProdSys+"\n"+message, 300)
      || "{}"
    );

    // Si pas prêt et moins de 2 échanges → question
    if (!groqProd.ready && groqProd.msg && nbExchanges < 4) {
      return new Response(JSON.stringify({reply:'<div style="font-size:13.5px;color:#1e293b;line-height:1.6;padding:4px 0">'+groqProd.msg+"</div>",sessionId:sid}),{headers:H});
    }

    // ── ÉTAPE 2 : Groq DeepSearch cherche les produits ────────────────────────
    const recap = (groqProd.ready&&groqProd.recap) ? groqProd.recap : (formatHistory(history,300)+" "+message).trim();
    const dbCtx = await dbLookup(recap);

    // Budget estimé pour choisir Claude ou Groq
    const budgetMatch = (recap+" "+hist).match(/(\d+)\s*(?:€|euros?)/i);
    const budgetNum   = budgetMatch ? parseInt(budgetMatch[1]) : 0;
    const useClaude   = budgetNum >= 150 || /cadeau|premium|luxe|meilleur/.test(recap.toLowerCase());

    const searchPrompt = "Agent shopping expert. Recherche les meilleurs produits pour: "+recap+"\n"
      +(dbCtx?"Donnees internes: "+dbCtx+"\n":"")
      +"Cherche sur Amazon.fr et fr.shopping.rakuten.com les vrais produits disponibles maintenant.\n"
      +"Retourne JSON avec:\n"
      +"- summary: phrase de présentation (1 ligne)\n"
      +"- products: tableau de 3 objets minimum (2 Amazon + 1 Rakuten obligatoire)\n"
      +"  Chaque produit: name (marque+modele exact), price (ex '29.99€'), store ('amazon' ou 'rakuten'), keywords, url (ASIN si trouvé), badge\n"
      +"- promoCodes: tableau de codes promo si trouvés (code, store, discount, best)\n"
      +"JSON uniquement.";

    let raw;
    if (useClaude) {
      // Claude + web_search pour produits premium (résultats de meilleure qualité)
      raw = await claude(searchPrompt, "Cherche: "+recap, 800, [{type:"web_search_20250305",name:"web_search",max_uses:3}]);
    }
    // Toujours Groq DeepSearch (gratuit) comme principal ou fallback
    if (!raw) {
      raw = await groqSearch(searchPrompt, 1000);
    }
    if (!raw) {
      raw = await gemini(searchPrompt, 800);
    }

    const parsed = parseJSON(raw||"");
    let products = (parsed.products||[]);
    const summary = parsed.summary||'Voici mes sélections pour "'+message+'" :';
    const promos  = parsed.promoCodes||[];

    // ── Garantit toujours Amazon + Rakuten ────────────────────────────────────
    const hasAmazon  = products.some(p=>(p.store||"").includes("amazon"));
    const hasRakuten = products.some(p=>(p.store||"").includes("rakuten"));

    if (!hasAmazon) {
      products.unshift({name:recap, price:"Voir prix", store:"amazon", keywords:recap, url:null, badge:"Bestseller"});
    }
    if (!hasRakuten) {
      products.push({name:recap, price:"Voir prix", store:"rakuten", keywords:recap, url:null, badge:"Bon plan"});
    }

    // ── Construction HTML ─────────────────────────────────────────────────────
    let buttons = "";
    for (const pr of products.slice(0,4)) {
      if (!pr.name) continue;
      let adv = findAdv(advertisers, pr.store);
      // Fallback si non en DB
      if (!adv) {
        if ((pr.store||"").includes("amazon"))  adv = {slug:"amazon", name:"Amazon",  emoji:"🛒", color:"#e47911", active:true};
        else if ((pr.store||"").includes("rakuten")) adv = {slug:"rakuten",name:"Rakuten",emoji:"🛍️",color:"#bf0000",active:true,awin_mid:RAKUTEN_MID};
        else continue;
      }
      const rawUrl = (pr.url&&pr.url!=="null"&&pr.url.length>15) ? pr.url : null;
      const url = buildLink(adv, pr.name.length>5?pr.name:(pr.keywords||pr.name), rawUrl);
      if (!url) continue;
      buttons += cardProduct(pr.name, pr.price||"Voir prix", url, adv, pr.img||null, pr.badge||null);
    }

    // Codes promo
    let promoHtml = "";
    for (const c of promos.filter(c=>c.code).sort((a,b)=>(b.best?1:0)-(a.best?1:0)).slice(0,2)) {
      promoHtml += promoBox(c.code, c.store||"boutique", c.discount||"Réduction", c.best||false);
      sbFetch("promo_codes","POST",{code:c.code,store:c.store||"unknown",discount:c.discount||"",found_at:new Date().toISOString(),valid:true}).catch(()=>{});
    }

    // Wishlist
    const first = products.find(p=>(p.store||"").includes("amazon"))||products[0];
    let wishHtml = "";
    if (first) {
      const adv0 = findAdv(advertisers,first.store)||{slug:"amazon",name:"Amazon",color:"#e47911",active:true};
      const wUrl = buildLink(adv0,first.keywords||first.name,first.url||null)||"";
      const wD   = JSON.stringify({type:"product",name:first.name,price:first.price,store:first.store,url:wUrl}).replace(/"/g,"&quot;");
      wishHtml = '<button onclick="addToWishlist('+wD+')" style="background:#fff;border:1.5px solid #e8edf8;color:#3b5bdb;border-radius:12px;padding:8px 16px;margin-top:10px;font-weight:700;font-size:12px;cursor:pointer;font-family:inherit;width:100%">♡ Ajouter à ma wishlist</button>';
    }

    const reply = '<div style="font-size:13.5px;color:#1e293b;margin-bottom:8px;font-weight:500;line-height:1.5">'+summary+"</div>"
      +buttons
      +(promoHtml?'<div style="margin-top:4px">'+promoHtml+"</div>":"")
      +wishHtml;

    return new Response(JSON.stringify({reply:reply,sessionId:sid}),{headers:H});

  } catch(err) {
    console.error("Huntify error:", err&&err.message);
    return new Response(JSON.stringify({reply:'<div style="font-size:13px;color:#1e293b">Désolé, problème momentané. Réessayez !</div>'}),{status:200,headers:{"Content-Type":"application/json; charset=utf-8","Access-Control-Allow-Origin":"*"}});
  }
}
