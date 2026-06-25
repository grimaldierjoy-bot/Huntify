export const config = { runtime: 'edge' };

// ─────────────────────────────────────────────────────────────────────────────
// HUNTIFY — Pipeline multi-agents
// Les IA se nourrissent entre elles :
// Groq DeepSearch (cherche) → Groq 70b (structure) → Claude (perfectionne)
// ─────────────────────────────────────────────────────────────────────────────

const SUPABASE_URL = "https://enocxbrqyybendertytl.supabase.co";
const SUPABASE_KEY = "sb_publishable_NmPh--frZG5HuqfaoxnemA_E7cidV9Y";
const AMAZON_TAG   = "huntify21-21";
const AWIN_PUB     = "2920215";
const RAKUTEN_MID  = "55615";
const TP_MARKER    = "536663";
const MODEL        = "claude-haiku-4-5";

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
  dubai:"DXB",doha:"DOH",
  tokyo:"NRT",osaka:"KIX",bangkok:"BKK",singapour:"SIN",bali:"DPS",
  "new york":"JFK","los angeles":"LAX",miami:"MIA",montreal:"YUL",cancun:"CUN",
  maldives:"MLE",maurice:"MRU",reunion:"RUN"
};

function toIATA(str) {
  if (!str) return null;
  const m = (str||"").match(/\b([A-Z]{3})\b/);
  if (m) return m[1];
  const s = str.toLowerCase().trim();
  for (const [k,v] of Object.entries(IATA)) { if (s.includes(k)) return v; }
  return null;
}

// ── SUPABASE ──────────────────────────────────────────────────────────────────
async function sbFetch(path, method, body) {
  const h = {"Content-Type":"application/json","apikey":SUPABASE_KEY,"Authorization":"Bearer "+SUPABASE_KEY};
  const opts = {method:method||"GET", headers:h};
  if (body) opts.body = JSON.stringify(body);
  try { const r = await fetch(SUPABASE_URL+"/rest/v1/"+path, opts); return await r.json(); } catch(e) { return null; }
}

async function getAdvertisers() {
  try {
    const r = await fetch(SUPABASE_URL+"/rest/v1/advertisers?active=eq.true",
      {headers:{"apikey":SUPABASE_KEY,"Authorization":"Bearer "+SUPABASE_KEY}});
    const d = await r.json(); return Array.isArray(d)?d:[];
  } catch(e) { return []; }
}

// ── LIENS ─────────────────────────────────────────────────────────────────────
function cleanKw(kw) {
  const stop = new Set(["la","le","les","un","une","des","avec","et","en","du","au","aux","pour","sur"]);
  return (kw||"").replace(/,/g," ").replace(/\s+/g," ").trim()
    .split(" ").filter(w=>w.length>1&&!stop.has(w.toLowerCase())).slice(0,7).join(" ");
}

function buildLink(adv, keywords, directUrl) {
  if (!adv||!adv.active) return null;
  const kw = cleanKw(keywords);
  if (adv.slug==="amazon") {
    const tag = adv.amazon_tag||AMAZON_TAG;
    const asinM = (directUrl||"").match(/\/dp\/([A-Z0-9]{10})(?:[/?]|$)/);
    const validAsin = asinM && /^B[A-Z0-9]{9}$/.test(asinM[1]);
    const base = validAsin ? "https://www.amazon.fr/dp/"+asinM[1] : "https://www.amazon.fr/s?k="+encodeURIComponent(kw);
    return base+"?tag="+tag;
  }
  if (adv.slug==="rakuten") {
    const dest = "https://fr.shopping.rakuten.com/s/"+encodeURIComponent(kw.replace(/\s+/g,"+"));
    return "https://www.awin1.com/cread.php?awinmid="+(adv.awin_mid||RAKUTEN_MID)+"&awinaffid="+(adv.awin_affid||AWIN_PUB)+"&clickref=huntify&ued="+encodeURIComponent(dest);
  }
  if (adv.awin_mid) {
    const dest = (adv.search_url||"https://www."+adv.slug+".fr/search?q={kw}").replace("{kw}",encodeURIComponent(kw));
    return "https://www.awin1.com/cread.php?awinmid="+adv.awin_mid+"&awinaffid="+(adv.awin_affid||AWIN_PUB)+"&ued="+encodeURIComponent(dest);
  }
  return null;
}

function findAdv(advertisers, slug) {
  return (advertisers||[]).find(a=>a.slug===(slug||"").toLowerCase())||null;
}

function skyscannerLink(from, to, ci, co, adults) {
  const f=(toIATA(from)||"par").toLowerCase(), t=(toIATA(to)||"xxx").toLowerCase();
  const fmt = d => d?d.replace(/-/g,"").slice(2):null;
  const out=fmt(ci), ret=fmt(co);
  const base = "https://www.skyscanner.fr/transport/vols/"+f+"/"+t+"/";
  if (out&&ret) return base+out+"/"+ret+"/?adults="+(adults||2)+"&currency=EUR";
  if (out) return base+out+"/?adults="+(adults||2)+"&currency=EUR";
  return base;
}

function bookingLink(dest, ci, co, adults, cat) {
  const rooms = Math.ceil((adults||2)/2);
  let url = "https://www.booking.com/searchresults.html?ss="+encodeURIComponent(dest||"")
    +"&group_adults="+(adults||2)+"&no_rooms="+rooms+"&lang=fr&selected_currency=EUR";
  if (ci) url += "&checkin="+ci;
  if (co) url += "&checkout="+co;
  if (cat==="budget")  url += "&nflt=class%3D2%3Bclass%3D3";
  if (cat==="confort") url += "&nflt=class%3D3%3Bclass%3D4";
  if (cat==="luxe")    url += "&nflt=class%3D4%3Bclass%3D5";
  return url;
}

function expediaLink(dest, ci, co, adults) {
  let url = "https://www.expedia.fr/Hotel-Search?destination="+encodeURIComponent(dest||"")+"&adults="+(adults||2);
  if (ci) url += "&startDate="+ci;
  if (co) url += "&endDate="+co;
  return url;
}

function getTransferLink(dest, ci) {
  const base = "https://gettransfer.tpk.mx/vMnVrFfO";
  return dest ? base+"?to="+encodeURIComponent(dest)+(ci?"&date="+ci:"") : base;
}

function parseDate(str) {
  if (!str) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  const now = new Date();
  const addD = n => { const d=new Date(now); d.setDate(d.getDate()+n); return d.toISOString().slice(0,10); };
  const s = str.toLowerCase().trim();
  if (s==="demain") return addD(1);
  if (/apres.?demain/.test(s)) return addD(2);
  const slash = str.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (slash) { const y=slash[3].length===2?"20"+slash[3]:slash[3]; return y+"-"+slash[2].padStart(2,"0")+"-"+slash[1].padStart(2,"0"); }
  const MONTHS = {jan:1,janv:1,fev:2,mar:3,mars:3,avr:4,avril:4,mai:5,juin:6,juil:7,juillet:7,aout:8,sep:9,sept:9,oct:10,nov:11,dec:12};
  const mn = s.match(/(\d{1,2})\s+([a-z]+)(?:\s+(\d{4}))?/);
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

function formatHistory(history, maxLen) {
  return ((history||[]).map(m=>{
    const who = m.role==="user"?"Client":"Huntify";
    const text = (m.content||"").replace(/<[^>]*>/g," ").replace(/\s+/g," ").trim().slice(0,300);
    return text?who+": "+text:null;
  }).filter(Boolean).join("\n")).slice(0,maxLen||2000);
}

function parseJSON(raw) {
  if (!raw) return {};
  try { const m=raw.match(/```(?:json)?\s*([\s\S]*?)```/); if(m) return JSON.parse(m[1].trim()); } catch(e){}
  try { const m=raw.match(/\{[\s\S]*\}/); if(m) return JSON.parse(m[0]); } catch(e){}
  return {};
}

// ── APPELS IA ─────────────────────────────────────────────────────────────────
async function groqCall(sys, user, model, maxTok) {
  const key = process.env.GROQ_API_KEY; if (!key) return null;
  try {
    const r = await fetch("https://api.groq.com/openai/v1/chat/completions",{
      method:"POST", headers:{"Content-Type":"application/json","Authorization":"Bearer "+key},
      body:JSON.stringify({model:model||"llama-3.3-70b-versatile", max_tokens:maxTok||600,
        messages:[{role:"system",content:sys},{role:"user",content:user}]})
    });
    if (!r.ok) return null;
    const d=await r.json(); return d.choices&&d.choices[0]?d.choices[0].message.content:null;
  } catch(e){return null;}
}

async function groqSearch(prompt, maxTok) {
  const key = process.env.GROQ_API_KEY; if (!key) return null;
  try {
    const r = await fetch("https://api.groq.com/openai/v1/chat/completions",{
      method:"POST", headers:{"Content-Type":"application/json","Authorization":"Bearer "+key},
      body:JSON.stringify({model:"compound-beta", max_tokens:maxTok||1500,
        messages:[{role:"user",content:prompt}]})
    });
    if (!r.ok) return await groqCall("Reponds en JSON.", prompt, "llama-3.3-70b-versatile", maxTok||1500);
    const d=await r.json(); return d.choices&&d.choices[0]?d.choices[0].message.content:null;
  } catch(e){ return await groqCall("Reponds en JSON.", prompt, "llama-3.3-70b-versatile", maxTok||1500); }
}

async function gemini(prompt, maxTok) {
  const key = process.env.GEMINI_API_KEY; if (!key) return null;
  try {
    const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key="+key,{
      method:"POST", headers:{"Content-Type":"application/json"},
      body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{maxOutputTokens:maxTok||600}})
    });
    if (!r.ok) return null;
    const d=await r.json(); return d.candidates&&d.candidates[0]&&d.candidates[0].content?d.candidates[0].content.parts[0].text:null;
  } catch(e){return null;}
}

async function mistral(sys, user, maxTok) {
  const key = process.env.MISTRAL_API_KEY; if (!key) return null;
  try {
    const r = await fetch("https://api.mistral.ai/v1/chat/completions",{
      method:"POST", headers:{"Content-Type":"application/json","Authorization":"Bearer "+key},
      body:JSON.stringify({model:"mistral-small-latest", max_tokens:maxTok||600,
        messages:[{role:"system",content:sys},{role:"user",content:user}]})
    });
    if (!r.ok) return null;
    const d=await r.json(); return d.choices&&d.choices[0]?d.choices[0].message.content:null;
  } catch(e){return null;}
}

async function deepseek(sys, user, maxTok) {
  const key = process.env.DEEPSEEK_API_KEY; if (!key) return null;
  try {
    const r = await fetch("https://api.deepseek.com/v1/chat/completions",{
      method:"POST", headers:{"Content-Type":"application/json","Authorization":"Bearer "+key},
      body:JSON.stringify({model:"deepseek-chat", max_tokens:maxTok||600,
        messages:[{role:"system",content:sys},{role:"user",content:user}]})
    });
    if (!r.ok) return null;
    const d=await r.json(); return d.choices&&d.choices[0]?d.choices[0].message.content:null;
  } catch(e){return null;}
}

async function claude(sys, user, maxTok, tools) {
  const key = process.env.ANTHROPIC_API_KEY; if (!key) return null;
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages",{
      method:"POST",
      headers:{"Content-Type":"application/json; charset=utf-8","x-api-key":key,"anthropic-version":"2023-06-01"},
      body:JSON.stringify({model:MODEL, max_tokens:maxTok||800, tools:tools||[], system:sys,
        messages:[{role:"user",content:user}]})
    });
    const d=await r.json(); if (!r.ok) return null;
    let t=""; for(const b of (d.content||[])){if(b.type==="text")t+=b.text;} return t||null;
  } catch(e){return null;}
}

// ── SUPABASE DB ───────────────────────────────────────────────────────────────
async function dbLookup(kw) {
  const k=(kw||"").toLowerCase().split(" ")[0];
  try {
    const [deals,prices,promos] = await Promise.all([
      sbFetch("daily_deals?name=ilike.*"+encodeURIComponent(k)+"*&limit=3"),
      sbFetch("price_history?product_name=ilike.*"+encodeURIComponent(k)+"*&order=checked_at.desc&limit=5"),
      sbFetch("promo_codes?valid=eq.true&order=found_at.desc&limit=2")
    ]);
    const parts=[];
    if(deals&&deals.length) parts.push("Deals: "+deals.map(x=>x.name+" "+x.price+"EUR").join(" | "));
    if(prices&&prices.length) parts.push("Historique prix: "+prices.map(x=>x.product_name+" "+x.price+"EUR").join(" | "));
    if(promos&&promos.length) parts.push("Codes promo: "+promos.map(x=>x.code+" ("+x.store+")").join(" | "));
    return parts.join("\n");
  } catch(e){return "";}
}

// ── HTML COMPONENTS ───────────────────────────────────────────────────────────
function cardProduct(name, price, url, adv, badge) {
  const pill = '<span style="background:rgba(255,255,255,.2);border-radius:100px;padding:2px 10px;font-size:10px;font-weight:800">'+(adv.emoji||"🛍")+" "+adv.name+"</span>";
  return '<a href="'+url+'" target="_blank" rel="sponsored noopener" style="display:flex;align-items:center;gap:12px;background:'+(adv.color||"#2f54ff")+';color:#fff;text-decoration:none;border-radius:14px;padding:12px 14px;margin-top:8px">'
    +'<div style="flex:1;min-width:0"><div style="font-size:10px;margin-bottom:4px;opacity:.85">'+pill+(badge?" · "+badge:"")+"</div>"
    +'<div style="font-size:13px;font-weight:800;line-height:1.3;word-break:break-word">'+name+"</div></div>"
    +'<span style="background:rgba(255,255,255,.22);border-radius:8px;padding:5px 10px;white-space:nowrap;font-size:14px;font-weight:900;flex-shrink:0">'+(price||"Voir prix")+"</span></a>";
}

function cardHotel(h, link) {
  const stars = "⭐".repeat(Math.min(h.stars||3,5));
  const cc = {budget:"#16a34a",confort:"#2f54ff",luxe:"#7c3aed"}[h.cat]||"#2f54ff";
  const cl = {budget:"💚 Budget",confort:"💙 Confort",luxe:"💎 Luxe"}[h.cat]||"";
  return '<a href="'+link+'" target="_blank" rel="sponsored noopener" style="display:flex;flex-direction:column;background:#fff;border:1.5px solid #e6ebf7;border-radius:14px;padding:13px;margin-top:8px;text-decoration:none;gap:5px">'
    +'<div style="display:flex;justify-content:space-between;align-items:flex-start">'
    +'<div style="flex:1">'+(cl?'<span style="background:#eff6ff;color:'+cc+';border-radius:100px;padding:2px 9px;font-size:10px;font-weight:800">'+cl+"</span>":"")
    +'<div style="font-size:13px;font-weight:800;color:#0e1430;margin-top:3px">'+h.name+"</div>"
    +'<div style="font-size:11px;color:#7c89a8">'+stars+" · "+(h.loc||"")+"</div></div>"
    +(h.price?'<div style="background:linear-gradient(135deg,#16a34a,#15803d);color:#fff;border-radius:10px;padding:7px 11px;text-align:center;flex-shrink:0;margin-left:8px"><div style="font-size:9px;opacity:.85">Prix web</div><div style="font-size:15px;font-weight:900">'+h.price+'</div></div>':'<div style="background:linear-gradient(135deg,'+cc+','+cc+'cc);color:#fff;border-radius:10px;padding:8px 12px;text-align:center;flex-shrink:0;margin-left:8px;min-width:60px"><div style="font-size:10px">Voir prix</div><div style="font-size:12px;font-weight:800">→</div></div>')
    +"</div>"
    +(h.hl?'<div style="font-size:11px;color:'+cc+';font-weight:600;background:#eff6ff;border-radius:8px;padding:4px 10px">✨ '+h.hl+"</div>":"")
    +'<div style="background:#f0f9ff;border-radius:8px;padding:6px 10px;font-size:11px;color:#0369a1;font-weight:600">🏨 Voir disponibilites sur Booking.com →</div></a>';
}

function cardDay(d) {
  return '<div style="background:#fff;border:1.5px solid #e6ebf7;border-radius:14px;padding:14px;margin-top:9px">'
    +'<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">'
    +'<div style="background:linear-gradient(135deg,#2f54ff,#4a6bff);color:#fff;border-radius:8px;padding:4px 12px;font-size:12px;font-weight:800">Jour '+d.n+"</div>"
    +'<div style="font-size:12px;font-weight:700;color:#0e1430;flex:1;margin-left:8px">'+(d.title||"")+"</div>"
    +(d.budget?'<div style="font-size:11px;color:#16a34a;font-weight:700">~'+d.budget+"</div>":"")+"</div>"
    +(d.am?'<div style="display:flex;gap:9px;margin-bottom:8px"><span>🌅</span><div><div style="font-size:10px;font-weight:800;color:#94a3b8;text-transform:uppercase">Matin</div><div style="font-size:12px;color:#374151">'+d.am+"</div></div></div>":"")
    +(d.pm?'<div style="display:flex;gap:9px;margin-bottom:8px"><span>☀️</span><div><div style="font-size:10px;font-weight:800;color:#94a3b8;text-transform:uppercase">Apres-midi</div><div style="font-size:12px;color:#374151">'+d.pm+"</div></div></div>":"")
    +(d.eve?'<div style="display:flex;gap:9px;margin-bottom:4px"><span>🌙</span><div><div style="font-size:10px;font-weight:800;color:#94a3b8;text-transform:uppercase">Soiree</div><div style="font-size:12px;color:#374151">'+d.eve+"</div></div></div>":"")
    +(d.resto?'<div style="background:#f0fdf4;border-radius:9px;padding:7px 11px;margin-top:6px;display:flex;justify-content:space-between;align-items:center"><div><div style="font-size:11px;color:#16a34a;font-weight:700">🍽 '+d.resto.name+"</div>"+(d.resto.spec?'<div style="font-size:10px;color:#86efac">'+d.resto.spec+"</div>":"")+"</div>"+'<div style="font-size:12px;color:#16a34a;font-weight:800">'+(d.resto.price||"")+"</div></div>":"")
    +(d.acts&&d.acts.length?'<div style="margin-top:7px;display:flex;flex-wrap:wrap;gap:4px">'+d.acts.map(a=>'<span style="background:#eff6ff;color:#2f54ff;border-radius:100px;padding:2px 9px;font-size:10.5px;font-weight:600">'+a+"</span>").join("")+"</div>":"")
    +"</div>";
}

function cardBudget(b) {
  const rows=[["✈️ Vols A/R",b.vols],["🏨 Hebergement",b.hotel],["🎯 Activites",b.acts],["🍽 Restaurants",b.resto],["🚇 Transport local",b.transport]].filter(r=>r[1]!=null);
  return '<div style="background:linear-gradient(135deg,#0e1430,#1f2da0);border-radius:16px;padding:16px;margin-top:12px">'
    +'<div style="font-size:13px;font-weight:800;color:#fff;margin-bottom:12px">💰 Budget estime</div>'
    +rows.map(r=>'<div style="display:flex;justify-content:space-between;margin-bottom:7px"><span style="font-size:12px;color:rgba(255,255,255,.75)">'+r[0]+'</span><span style="font-size:12px;font-weight:700;color:#fff">~'+r[1]+"</span></div>").join("")
    +'<div style="border-top:1px solid rgba(255,255,255,.2);margin-top:10px;padding-top:10px;display:flex;justify-content:space-between">'
    +'<span style="font-size:13px;font-weight:800;color:#fff">TOTAL</span>'
    +'<span style="font-size:16px;font-weight:900;color:#bcd0ff">~'+(b.total||"")+"</span></div>"
    +(b.pp?'<div style="font-size:11px;color:rgba(255,255,255,.6);text-align:right;margin-top:3px">soit ~'+b.pp+"/personne</div>":"")
    +"</div>";
}

function cardTips(tips) {
  if (!tips||!tips.length) return "";
  return '<div style="background:#f5f3ff;border:1.5px solid #ddd6fe;border-radius:14px;padding:14px;margin-top:10px">'
    +'<div style="font-size:12px;font-weight:800;color:#5b21b6;margin-bottom:8px">💡 Conseils pratiques</div>'
    +tips.map(t=>'<div style="font-size:12px;color:#374151;margin-bottom:5px;padding-left:8px;border-left:2px solid #c4b5fd">• '+t+"</div>").join("")+"</div>";
}

function promoBox(code, store, desc, best) {
  return '<div style="background:'+(best?"#dcfce7":"#f0fdf4")+';border:'+(best?"2px solid #16a34a":"1.5px solid #86efac")+';border-radius:12px;padding:10px 14px;margin-top:6px;display:flex;align-items:center;justify-content:space-between;gap:8px">'
    +'<div><span style="font-size:11px;color:#16a34a;font-weight:700">'+(best?"⭐ MEILLEUR — ":"")+"🏷 "+store+"</span>"
    +'<div style="font-size:12px;color:#166534;font-weight:600">'+desc+"</div></div>"
    +'<div onclick="navigator.clipboard.writeText(\''+code+'\');this.innerHTML=\'✓\';setTimeout(()=>this.innerHTML=\''+code+'\',2000)" style="background:#16a34a;color:#fff;border-radius:8px;padding:6px 10px;font-weight:800;font-size:12px;cursor:pointer;white-space:nowrap;flex-shrink:0">'+code+"</div></div>";
}

// ═════════════════════════════════════════════════════════════════════════════
// PIPELINE MULTI-AGENTS
// Chaque IA nourrit la suivante avec un contexte de plus en plus riche
// ═════════════════════════════════════════════════════════════════════════════

// ── PIPELINE VOYAGE ───────────────────────────────────────────────────────────
// Etape 1 : Groq DeepSearch cherche les vraies donnees sur le web
// Etape 2 : Groq 70b structure en JSON propre
// Etape 3 : Claude recoit tout et genere l itineraire parfait
async function pipelineVoyage(hist, message, today) {

  // ── ETAPE 1 : Groq DeepSearch cherche sur le web ──────────────────────────
  const searchQuery = "Tu es un agent de recherche voyage. Objectif: collecter des donnees reelles.\n"
    +"Conversation: "+hist+"\nMessage: "+message+"\n\n"
    +"CHERCHE sur internet maintenant:\n"
    +"1. Extrait: destination, ville depart, dates, nb personnes, budget, style\n"
    +"2. Cherche: vrais prix vols aller-retour pour ces dates et villes (compagnies reelles)\n"
    +"3. Cherche: vrais hotels existants a destination (3 categories: budget/confort/luxe avec prix reels/nuit)\n"
    +"4. Cherche: vrais restaurants populaires locaux avec leurs prix moyens\n"
    +"5. Cherche: activites incontournables et tarifs\n\n"
    +"Si infos insuffisantes pour generer, reponds: {action:'question', msg:'ta question'}\n"
    +"Sinon reponds: {action:'data', destination, depart, checkin, checkout, adults, budget, style,"
    +" flights:{out:{from,to,price,co,dur},ret:{from,to,price,co,dur}},"
    +" hotels:[{name,stars,price,loc,hl,cat}],"
    +" restaurants:[{name,price,spec}],"
    +" activities:[{name,price}],"
    +" tips:[conseils]}";

  const step1raw = await groqSearch(searchQuery, 2000);
  const step1 = parseJSON(step1raw||"{}");

  // Si Groq demande une question → on la pose directement
  if (step1.action==="question" && step1.msg) {
    return {type:"question", reply:'<div style="font-size:13.5px;color:#1e293b;line-height:1.6;padding:4px 0">'+step1.msg+"</div>"};
  }

  // ── ETAPE 2 : Groq 70b structure et valide les donnees ────────────────────
  const structurePrompt = "Tu es un validateur de donnees voyage. Recois les donnees brutes et structure-les.\n"
    +"DONNEES BRUTES DE GROQ DEEPSEARCH:\n"
    +JSON.stringify(step1)+"\n\n"
    +"Valide et complete avec les codes IATA (Paris=CDG,Marseille=MRS,Nice=NCE,Lyon=LYS,"
    +"Rome=FCO,Barcelone=BCN,Madrid=MAD,Lisbonne=LIS,Londres=LHR,Amsterdam=AMS).\n"
    +"Calcule le budget total coherent avec les donnees.\n"
    +"Reponds JSON valide: {destination,country,flag,depart,checkin,checkout,adults,dur,trav,style,"
    +"flights:{out:{from,to,price,co,dur},ret:{from,to,price,co,dur}},"
    +"hotels:[{name,stars,price,loc,hl,cat:budget/confort/luxe}],"
    +"days:[{n,title,am,pm,eve,resto:{name,price,spec},acts:[],budget}],"
    +"budget:{vols,hotel,acts,resto,transport,total,pp},"
    +"tips:[]}";

  const step2raw = await groqCall("Reponds JSON uniquement.", structurePrompt, "llama-3.3-70b-versatile", 2000)
    || await mistral("Reponds JSON uniquement.", structurePrompt, 2000)
    || await deepseek("Reponds JSON uniquement.", structurePrompt, 2000);

  const step2 = parseJSON(step2raw||"{}");

  // ── ETAPE 3 : Claude recoit tout et perfectionne ──────────────────────────
  // Claude recoit un contexte ultra-riche : donnees brutes + donnees structurees
  // Il n a plus qu a perfectionner et combler les manques
  const claudeSys = "Tu es l expert voyage de Huntify. Tu recois des donnees deja recherchees et structurees par d autres IA.\n"
    +"Ta mission: perfectionner, combler les manques, assurer la coherence, et retourner le JSON final parfait.\n"
    +"Date: "+today;

  const claudeUser = "DONNEES COLLECTEES PAR GROQ DEEPSEARCH:\n"
    +JSON.stringify(step1)+"\n\n"
    +"DONNEES STRUCTUREES PAR GROQ 70B:\n"
    +JSON.stringify(step2)+"\n\n"
    +"Genere le JSON final complet avec: t:i, recap, itin:{dest,country,flag,dur,trav,style,dep,"
    +"checkin:YYYY-MM-DD,checkout:YYYY-MM-DD,adults,"
    +"flights:{out:{from:IATA,to:IATA,price,co,dur},ret:{...}},"
    +"hotels:[3 objets avec name/stars/price/loc/hl/cat],"
    +"days:[{n,title,am,pm,eve,resto:{name,price,spec},acts:[],budget}],"
    +"budget:{vols,hotel,acts,resto,transport,total,pp},"
    +"tips:[4 conseils specifiques]}\n"
    +"JSON UNIQUEMENT.";

  const step3raw = await claude(claudeSys, claudeUser, 3000, [])
    || await gemini(claudeSys+"\n\n"+claudeUser, 3000)
    || step2raw; // fallback: on utilise step2 si Claude echoue

  return {type:"itin", data: parseJSON(step3raw||"{}"), step1, step2};
}

// ── PIPELINE PRODUIT ──────────────────────────────────────────────────────────
// Etape 1 : Groq DeepSearch cherche les vrais produits et ASINs sur le web
// Etape 2 : Groq 70b valide les ASINs et structure
// Etape 3 : Claude enrichit et garantit la qualite finale
async function pipelineProduit(hist, message, advertisers) {

  // ── ETAPE 1 : Groq DeepSearch cherche produits reels ─────────────────────
  const searchQ = "Tu es un agent shopping. Cherche maintenant sur amazon.fr et fr.shopping.rakuten.com.\n"
    +"Conversation: "+hist+"\nMessage: "+message+"\n\n"
    +"CHERCHE les vrais produits correspondants:\n"
    +"1. Sur amazon.fr: trouve 2 produits avec leurs vraies URLs (https://www.amazon.fr/dp/BASIN)\n"
    +"2. Sur rakuten.fr: trouve 1 produit similaire\n"
    +"3. Cherche si des codes promo existent sur dealabs.com\n\n"
    +"Si la demande est incomprehensible, reponds: {action:'question', msg:'question courte'}\n"
    +"Sinon reponds: {action:'products', summary:'1 phrase', "
    +"products:[{name,price,store:'amazon' ou 'rakuten',url,badge}], promoCodes:[{code,store,discount}]}";

  const step1raw = await groqSearch(searchQ, 1500);
  const step1 = parseJSON(step1raw||"{}");

  // Si Groq demande une info
  if (step1.action==="question" && step1.msg && hist.split("\n").length < 3) {
    return {type:"question", reply:'<div style="font-size:13.5px;color:#1e293b;line-height:1.6;padding:4px 0">'+step1.msg+"</div>"};
  }

  let products = step1.products||[];

  // ── ETAPE 2 : Groq 70b valide les ASINs ──────────────────────────────────
  const hasValidAsin = products.some(p=>p.store==="amazon"&&(p.url||"").match(/\/dp\/B[A-Z0-9]{9}/));

  if (!hasValidAsin && products.length > 0) {
    const validateQ = "Valide ces produits Amazon et corrige les ASINs si necessaire.\n"
      +"PRODUITS: "+JSON.stringify(products)+"\n"
      +"Pour chaque produit Amazon: verifie que l ASIN est au format B suivi de 9 chars.\n"
      +"Si ASIN invalide ou manquant: cherche le bon ASIN sur amazon.fr.\n"
      +"Reponds JSON: {products:[meme structure avec urls corrigees]}";

    const step2raw = await groqCall("Reponds JSON.", validateQ, "llama-3.3-70b-versatile", 800)
      || await deepseek("Reponds JSON.", validateQ, 800);
    const step2 = parseJSON(step2raw||"{}");
    if (step2.products&&step2.products.length) products = step2.products;
  }

  // ── ETAPE 3 : Claude corrige les ASINs manquants avec web_search ─────────
  const stillNoAsin = !products.some(p=>p.store==="amazon"&&(p.url||"").match(/\/dp\/B[A-Z0-9]{9}/));
  if (stillNoAsin) {
    const claudeRaw = await claude(
      "Tu es un agent shopping expert. Trouve les vrais produits Amazon.fr avec leurs ASINs.",
      "Cherche sur amazon.fr: "+message+". Retourne JSON: {products:[{name,price,store:'amazon',url:https://www.amazon.fr/dp/ASIN,badge}]}",
      600,
      [{type:"web_search_20250305",name:"web_search",max_uses:2}]
    );
    const claudeP = parseJSON(claudeRaw||"{}").products||[];
    if (claudeP.some(p=>(p.url||"").match(/\/dp\/B[A-Z0-9]{9}/))) {
      products = [...claudeP, ...products.filter(p=>p.store==="rakuten")];
    }
  }

  // Garantit toujours Amazon + Rakuten
  if (!products.some(p=>(p.store||"").includes("amazon"))) {
    products.unshift({name:message, price:"Voir prix", store:"amazon", keywords:message, url:null, badge:"Bestseller"});
  }
  if (!products.some(p=>(p.store||"").includes("rakuten"))) {
    products.push({name:message, price:"Voir prix", store:"rakuten", keywords:message, url:null, badge:"Bon plan"});
  }

  return {type:"products", products, summary:step1.summary||'', promoCodes:step1.promoCodes||[]};
}

// ── HANDLER PRINCIPAL ─────────────────────────────────────────────────────────
export default async function handler(req) {
  if (req.method==="OPTIONS") return new Response(null,{status:204,headers:{"Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"POST,OPTIONS","Access-Control-Allow-Headers":"Content-Type"}});
  if (req.method!=="POST") return new Response("Method not allowed",{status:405});
  const H = {"Content-Type":"application/json; charset=utf-8","Access-Control-Allow-Origin":"*"};

  try {
    const body       = await req.json();
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
      ]).catch(()=>{});
    }

    const hist = formatHistory(history, 2000);

    // ═══════════════════════════════════════════════════════════════════════
    // MODE VOYAGE
    // ═══════════════════════════════════════════════════════════════════════
    if (isTravel) {
      const result = await pipelineVoyage(hist, message, today);

      if (result.type==="question") {
        return new Response(JSON.stringify({reply:result.reply,sessionId:sid}),{headers:H});
      }

      const tP   = result.data;
      const itin = tP.itin;

      // Fallback minimal si tout echoue
      if (!itin) {
        const infos = result.step1||{};
        const sky = skyscannerLink(infos.depart||"",infos.destination||"",infos.checkin||null,infos.checkout||null,infos.adults||2);
        const bkg = bookingLink(infos.destination||"",infos.checkin||null,infos.checkout||null,infos.adults||2,null);
        const gtf = getTransferLink(infos.destination||"",infos.checkin||null);
        return new Response(JSON.stringify({reply:
          '<div style="font-size:13.5px;color:#1e293b;margin-bottom:12px">Voici les liens directs pour votre voyage :</div>'
          +'<a href="'+sky+'" target="_blank" style="display:flex;justify-content:center;background:linear-gradient(135deg,#0e1430,#1f2da0);color:#fff;text-decoration:none;border-radius:12px;padding:14px;margin-top:8px;font-size:13px;font-weight:700">✈️ Vols sur Skyscanner →</a>'
          +'<a href="'+bkg+'" target="_blank" style="display:flex;justify-content:center;background:linear-gradient(135deg,#003580,#0071c2);color:#fff;text-decoration:none;border-radius:12px;padding:14px;margin-top:8px;font-size:13px;font-weight:700">🏨 Hotels sur Booking.com →</a>'
          +'<a href="'+gtf+'" target="_blank" style="display:flex;justify-content:center;background:linear-gradient(135deg,#1a1a2e,#e94560);color:#fff;text-decoration:none;border-radius:12px;padding:14px;margin-top:8px;font-size:13px;font-weight:700">🚗 Transfert GetTransfer →</a>',
          sessionId:sid}),{headers:H});
      }

      const adults     = itin.adults||2;
      const finalCi    = itin.checkin||null;
      const finalCo    = itin.checkout||null;
      const nights     = parseInt(((itin.dur||"3").match(/\d+/)||["3"])[0])||3;
      const itinId     = "itin_"+Date.now();
      let html = "";

      // Header
      html += '<div id="'+itinId+'" style="background:linear-gradient(135deg,#1f2da0,#2f54ff);border-radius:16px;padding:18px;margin-bottom:4px;text-align:center">'
        +'<div style="font-size:32px;margin-bottom:6px">'+(itin.flag||"✈️")+"</div>"
        +'<div style="font-family:\'Sora\',sans-serif;font-size:20px;font-weight:800;color:#fff">'+(itin.dest||"")+(itin.country?", "+itin.country:"")+"</div>"
        +'<div style="font-size:12px;color:rgba(255,255,255,.75);margin-top:6px;display:flex;justify-content:center;gap:12px;flex-wrap:wrap">'
        +"<span>📅 "+(itin.dur||nights+" jours")+"</span>"
        +"<span>👥 "+(itin.trav||adults+" pers.")+"</span>"
        +(itin.dep?"<span>🛫 Depuis "+itin.dep+"</span>":"")
        +(itin.budget&&itin.budget.total?"<span>💰 ~"+itin.budget.total+"</span>":"")
        +"</div></div>";

      if (tP.recap) html += '<div style="background:#f5f3ff;border:1.5px solid #ddd6fe;border-radius:12px;padding:10px 14px;margin-top:8px;font-size:12px;color:#5b21b6;font-weight:600">🔎 '+tP.recap+"</div>";

      // Vols
      if (itin.flights&&itin.flights.out) {
        const f = itin.flights;
        const sky = skyscannerLink(f.out.from||itin.dep||"",f.out.to||itin.dest||"",finalCi,finalCo,adults);
        html += '<div style="font-size:12px;font-weight:800;color:#0e1430;margin:14px 0 6px">✈️ Vols recommandes</div>'
          +'<div style="background:#fff;border:1.5px solid #e6ebf7;border-radius:14px;overflow:hidden">'
          +'<div style="padding:12px 14px;border-bottom:1px solid #f0f4ff">'
          +'<div style="display:flex;justify-content:space-between;align-items:center">'
          +'<div><div style="font-size:10px;font-weight:800;color:#7c89a8;text-transform:uppercase">Aller'+(finalCi?" · "+finalCi:"")+"</div>"
          +'<div style="font-size:13px;font-weight:700;color:#0e1430;margin-top:2px">'+(f.out.from||"")+" → "+(f.out.to||"")+"</div>"
          +'<div style="font-size:11px;color:#7c89a8">'+(f.out.co||"")+" · "+(f.out.dur||"")+"</div></div>"
          +'<div style="text-align:right"><div style="font-size:16px;font-weight:900;color:#2f54ff">~'+(f.out.price||"?")+"€</div>"
          +'<div style="font-size:10px;color:#7c89a8">/pers.</div></div></div></div>'
          +(f.ret?'<div style="padding:12px 14px"><div style="display:flex;justify-content:space-between;align-items:center">'
            +'<div><div style="font-size:10px;font-weight:800;color:#7c89a8;text-transform:uppercase">Retour'+(finalCo?" · "+finalCo:"")+"</div>"
            +'<div style="font-size:13px;font-weight:700;color:#0e1430;margin-top:2px">'+(f.ret.from||"")+" → "+(f.ret.to||"")+"</div>"
            +'<div style="font-size:11px;color:#7c89a8">'+(f.ret.co||"")+" · "+(f.ret.dur||"")+"</div></div>"
            +'<div style="text-align:right"><div style="font-size:16px;font-weight:900;color:#2f54ff">~'+(f.ret.price||"?")+"€</div>"
            +'<div style="font-size:10px;color:#7c89a8">/pers.</div></div></div></div>':"")
          +"</div>"
          +'<a href="'+sky+'" target="_blank" style="display:flex;align-items:center;justify-content:center;gap:8px;background:linear-gradient(135deg,#0e1430,#1f2da0);color:#fff;text-decoration:none;border-radius:12px;padding:12px;font-size:13px;font-weight:700;margin-top:6px">🔍 Comparer ces vols sur Skyscanner →</a>';
      }

      // Hotels
      if (itin.hotels&&itin.hotels.length) {
        html += '<div style="font-size:12px;font-weight:800;color:#0e1430;margin:16px 0 6px">🏨 Hebergements</div>';
        itin.hotels.slice(0,3).forEach(function(h,i) {
          const cat = ["budget","confort","luxe"][i]||h.cat||"confort";
          const link = bookingLink(itin.dest||"",finalCi,finalCo,adults,cat);
          html += cardHotel({name:h.name,stars:h.stars||3,price:h.price||null,loc:h.loc||itin.dest,hl:h.hl,cat:cat}, link);
        });
        html += '<div style="display:flex;gap:8px;margin-top:8px">'
          +'<a href="'+bookingLink(itin.dest||"",finalCi,finalCo,adults,null)+'" target="_blank" style="flex:1;display:flex;justify-content:center;align-items:center;background:linear-gradient(135deg,#003580,#0071c2);color:#fff;text-decoration:none;border-radius:12px;padding:10px;font-size:11px;font-weight:700">🏨 Booking.com</a>'
          +'<a href="'+expediaLink(itin.dest||"",finalCi,finalCo,adults)+'" target="_blank" style="flex:1;display:flex;justify-content:center;align-items:center;background:linear-gradient(135deg,#00355f,#00a0e3);color:#fff;text-decoration:none;border-radius:12px;padding:10px;font-size:11px;font-weight:700">✈️ Expedia.fr</a>'
          +'<a href="'+getTransferLink(itin.dest||"",finalCi)+'" target="_blank" style="flex:1;display:flex;justify-content:center;align-items:center;background:linear-gradient(135deg,#1a1a2e,#e94560);color:#fff;text-decoration:none;border-radius:12px;padding:10px;font-size:11px;font-weight:700">🚗 Transfert</a>'
          +"</div>";
      }

      // Programme
      if (itin.days&&itin.days.length) {
        html += '<div style="font-size:12px;font-weight:800;color:#0e1430;margin:16px 0 6px">📅 Programme jour par jour</div>';
        for (const d of itin.days) html += cardDay(d);
      }

      if (itin.budget) html += cardBudget(itin.budget);
      if (itin.tips&&itin.tips.length) html += cardTips(itin.tips);

      const wData = JSON.stringify({
        type:"voyage", name:(itin.flag||"✈️")+" "+(itin.dest||""),
        subtitle:(itin.dur||"")+" · "+(itin.trav||adults+" pers."),
        store:"booking", url:bookingLink(itin.dest||"",finalCi,finalCo,adults,null)
      }).replace(/"/g,"&quot;");

      html += '<div style="display:flex;gap:8px;margin-top:12px">'
        +'<button onclick="addToWishlist('+wData+')" style="flex:1;background:linear-gradient(135deg,#1f2da0,#2f54ff);border:none;color:#fff;border-radius:12px;padding:12px;font-weight:700;font-size:13px;cursor:pointer;font-family:inherit">♡ Sauvegarder</button>'
        +'<button onclick="exportItinerary(\''+itinId+'\')" style="background:#f5f7ff;border:1.5px solid #c7d2fe;color:#3b5bdb;border-radius:12px;padding:12px;font-weight:700;font-size:13px;cursor:pointer;font-family:inherit">⬇️ Exporter</button>'
        +"</div>";

      return new Response(JSON.stringify({reply:html,sessionId:sid}),{headers:H});
    }

    // ═══════════════════════════════════════════════════════════════════════
    // MODE PRODUIT
    // ═══════════════════════════════════════════════════════════════════════
    const result = await pipelineProduit(hist, message, advertisers);

    if (result.type==="question") {
      return new Response(JSON.stringify({reply:result.reply,sessionId:sid}),{headers:H});
    }

    const {products, summary, promoCodes} = result;
    let buttons = "";

    for (const pr of products.slice(0,4)) {
      if (!pr.name) continue;
      let adv = findAdv(advertisers, pr.store);
      if (!adv) {
        if ((pr.store||"").includes("amazon"))  adv={slug:"amazon", name:"Amazon",  emoji:"🛒",color:"#e47911",active:true};
        else if ((pr.store||"").includes("rakuten")) adv={slug:"rakuten",name:"Rakuten",emoji:"🛍",color:"#bf0000",active:true,awin_mid:RAKUTEN_MID};
        else continue;
      }
      const rawUrl=(pr.url&&pr.url!=="null"&&pr.url.length>15)?pr.url:null;
      const url=buildLink(adv, pr.name.length>5?pr.name:(pr.keywords||pr.name), rawUrl);
      if (!url) continue;
      buttons += cardProduct(pr.name, pr.price||"Voir prix", url, adv, pr.badge||null);
    }

    let promoHtml="";
    for (const c of (promoCodes||[]).filter(c=>c.code).slice(0,2)) {
      promoHtml += promoBox(c.code,c.store||"boutique",c.discount||"Reduction",c.best||false);
    }

    const first=products.find(p=>(p.store||"").includes("amazon"))||products[0];
    let wishHtml="";
    if (first) {
      const adv0=findAdv(advertisers,first.store)||{slug:"amazon",name:"Amazon",color:"#e47911",active:true};
      const wUrl=buildLink(adv0,first.keywords||first.name,first.url||null)||"";
      const wD=JSON.stringify({type:"product",name:first.name,price:first.price,store:first.store,url:wUrl}).replace(/"/g,"&quot;");
      wishHtml='<button onclick="addToWishlist('+wD+')" style="background:#fff;border:1.5px solid #e8edf8;color:#3b5bdb;border-radius:12px;padding:8px 16px;margin-top:10px;font-weight:700;font-size:12px;cursor:pointer;font-family:inherit;width:100%">♡ Ajouter a ma wishlist</button>';
    }

    const reply='<div style="font-size:13.5px;color:#1e293b;margin-bottom:8px;font-weight:500;line-height:1.5">'+(summary||'Voici mes selections :')+"</div>"
      +buttons+(promoHtml?'<div style="margin-top:4px">'+promoHtml+"</div>":"")+wishHtml;

    return new Response(JSON.stringify({reply,sessionId:sid}),{headers:H});

  } catch(err) {
    console.error("Huntify error:",err&&err.message);
    return new Response(JSON.stringify({reply:'<div style="font-size:13px;color:#1e293b">Desole, probleme momentane. Reessayez !</div>'}),
      {status:200,headers:{"Content-Type":"application/json; charset=utf-8","Access-Control-Allow-Origin":"*"}});
  }
}
