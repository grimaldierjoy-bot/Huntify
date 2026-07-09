export const config = { runtime: 'edge' };

// ─────────────────────────────────────────────────────────────────────────────
// HUNTIFY — Mode Voyage
// Fichier autonome — aucun import externe
// Liens : Skyscanner + Booking.com + Expedia + GetTransfer + Eurocar (Awin 7418)
// Pipeline : Groq DeepSearch → Groq 70b → Claude (generation finale)
// ─────────────────────────────────────────────────────────────────────────────

var SUPABASE_URL = "https://enocxbrqyybendertytl.supabase.co";
var SUPABASE_KEY = "sb_publishable_NmPh--frZG5HuqfaoxnemA_E7cidV9Y";
var MODEL        = "claude-haiku-4-5";
var AWIN_PUB     = "2920215";

// ── IATA ──────────────────────────────────────────────────────────────────────
var IATA = {
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
  tokyo:"NRT",bangkok:"BKK",bali:"DPS",singapour:"SIN",
  "new york":"JFK","los angeles":"LAX",miami:"MIA",montreal:"YUL",cancun:"CUN",
  maldives:"MLE",maurice:"MRU",reunion:"RUN"
};

function toIATA(str) {
  if (!str) return null;
  var m=(str||"").match(/\b([A-Z]{3})\b/); if (m) return m[1];
  var s=str.toLowerCase().trim();
  for (var k in IATA) { if (s.includes(k)) return IATA[k]; }
  return null;
}

// ── SUPABASE ──────────────────────────────────────────────────────────────────
async function sb(path, method, body) {
  var h={"Content-Type":"application/json","apikey":SUPABASE_KEY,"Authorization":"Bearer "+SUPABASE_KEY};
  var opts={method:method||"GET",headers:h};
  if (body) opts.body=JSON.stringify(body);
  try { var r=await fetch(SUPABASE_URL+"/rest/v1/"+path,opts); return await r.json(); } catch(e){return null;}
}

// ── LIENS VOYAGE ──────────────────────────────────────────────────────────────
function skyLink(from, to, ci, co, adults) {
  var f=(toIATA(from)||"par").toLowerCase(), t=(toIATA(to)||"xxx").toLowerCase();
  function fmt(d){return d?d.replace(/-/g,"").slice(2):null;}
  var out=fmt(ci),ret=fmt(co);
  var base="https://www.skyscanner.fr/transport/vols/"+f+"/"+t+"/";
  if (out&&ret) return base+out+"/"+ret+"/?adults="+(adults||2)+"&currency=EUR";
  if (out) return base+out+"/?adults="+(adults||2)+"&currency=EUR";
  return base;
}

function bookLink(dest, ci, co, adults, cat) {
  var rooms=Math.ceil((adults||2)/2);
  var url="https://www.booking.com/searchresults.html?ss="+encodeURIComponent(dest||"")
    +"&group_adults="+(adults||2)+"&no_rooms="+rooms+"&lang=fr&selected_currency=EUR";
  if (ci) url+="&checkin="+ci;
  if (co) url+="&checkout="+co;
  if (cat==="budget")  url+="&nflt=class%3D2%3Bclass%3D3";
  if (cat==="confort") url+="&nflt=class%3D3%3Bclass%3D4";
  if (cat==="luxe")    url+="&nflt=class%3D4%3Bclass%3D5";
  return url;
}

function expLink(dest, ci, co, adults) {
  var url="https://www.expedia.fr/Hotel-Search?destination="+encodeURIComponent(dest||"")+"&adults="+(adults||2);
  if (ci) url+="&startDate="+ci;
  if (co) url+="&endDate="+co;
  return url;
}

function getTransferLink(dest, ci) {
  return "https://gettransfer.tpk.mx/vMnVrFfO"+(dest?"?to="+encodeURIComponent(dest)+(ci?"&date="+ci:""):"");
}

function eurocarLink(dest, ci, co) {
  var destUrl="https://www.europcar.fr/fr/search?pickUpLocation="+encodeURIComponent(dest||"")
    +(ci?"&pickUpDate="+ci:"")+(co?"&dropOffDate="+co:"");
  return "https://www.awin1.com/cread.php?awinmid=7418&awinaffid="+AWIN_PUB+"&ued="+encodeURIComponent(destUrl);
}

function wantsCar(dest, style) {
  var noNeed=["paris","londres","rome","barcelone","madrid","amsterdam","berlin","tokyo","new york","singapour"];
  var d=(dest||"").toLowerCase();
  for (var i=0;i<noNeed.length;i++) { if (d.includes(noNeed[i])) return false; }
  return true;
}

// ── KLOOK (activites et excursions, via Travelpayouts) ────────────────────────
// Lien affilie reel Klook — le tracking se fait via ce lien de base,
// la recherche destination se passe cote Klook une fois sur le site
function klookLink(dest) {
  return "https://klook.tpk.mx/uGeFNRZq";
}

function parseDate(str) {
  if (!str) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  var now=new Date();
  var s=str.toLowerCase().trim();
  if (s==="demain") { var d=new Date(now.getTime()+86400000); return d.toISOString().slice(0,10); }
  if (/apres.?demain/.test(s)) { var d2=new Date(now.getTime()+172800000); return d2.toISOString().slice(0,10); }
  var slash=str.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (slash) { var y=slash[3].length===2?"20"+slash[3]:slash[3]; return y+"-"+slash[2].padStart(2,"0")+"-"+slash[1].padStart(2,"0"); }
  var MO={jan:1,janv:1,fev:2,mars:3,avr:4,avril:4,mai:5,juin:6,juil:7,juillet:7,aout:8,sep:9,sept:9,oct:10,nov:11,dec:12};
  var fm=s.match(/(\d{1,2})\s+([a-z]+)(?:\s+(\d{4}))?/);
  if (fm) {
    var mo=null; for (var mk in MO) { if (fm[2].startsWith(mk)) { mo=MO[mk]; break; } }
    if (mo) { var yr=fm[3]||String(now.getFullYear()); return yr+"-"+String(mo).padStart(2,"0")+"-"+fm[1].padStart(2,"0"); }
  }
  return null;
}

// ── APPELS IA ─────────────────────────────────────────────────────────────────
// Timeout de securite — evite qu un appel IA lent fasse depasser la limite
// Vercel Edge (~25s) et plante toute la requete sans reponse JSON propre
async function fetchT(url, opts, ms) {
  var ctrl = new AbortController();
  var timer = setTimeout(function(){ctrl.abort();}, ms||8000);
  try {
    var r = await fetch(url, Object.assign({}, opts, {signal:ctrl.signal}));
    clearTimeout(timer);
    return r;
  } catch(e) {
    clearTimeout(timer);
    throw e;
  }
}

async function groqDS(prompt, maxTok) {
  var key=process.env.GROQ_API_KEY; if (!key) return null;
  try {
    var r=await fetchT("https://api.groq.com/openai/v1/chat/completions",{method:"POST",
      headers:{"Content-Type":"application/json","Authorization":"Bearer "+key},
      body:JSON.stringify({model:"compound-beta",max_tokens:maxTok||1500,messages:[{role:"user",content:prompt}]})},12000);
    if (!r.ok) return null; var d=await r.json(); return d.choices&&d.choices[0]?d.choices[0].message.content:null;
  } catch(e){return null;}
}

async function groq70b(sys, user, maxTok) {
  var key=process.env.GROQ_API_KEY; if (!key) return null;
  try {
    var r=await fetchT("https://api.groq.com/openai/v1/chat/completions",{method:"POST",
      headers:{"Content-Type":"application/json","Authorization":"Bearer "+key},
      body:JSON.stringify({model:"llama-3.3-70b-versatile",max_tokens:maxTok||800,messages:[{role:"system",content:sys},{role:"user",content:user}]})},7000);
    if (!r.ok) return null; var d=await r.json(); return d.choices&&d.choices[0]?d.choices[0].message.content:null;
  } catch(e){return null;}
}

async function claude(sys, user, maxTok) {
  var key=process.env.ANTHROPIC_API_KEY; if (!key) return null;
  try {
    var r=await fetchT("https://api.anthropic.com/v1/messages",{method:"POST",
      headers:{"Content-Type":"application/json; charset=utf-8","x-api-key":key,"anthropic-version":"2023-06-01"},
      body:JSON.stringify({model:MODEL,max_tokens:maxTok||2500,system:sys,messages:[{role:"user",content:user}]})},15000);
    var d=await r.json(); if (!r.ok) return null;
    var t=""; for(var i=0;i<(d.content||[]).length;i++){if(d.content[i].type==="text")t+=d.content[i].text;} return t||null;
  } catch(e){return null;}
}

async function gemini(prompt, maxTok) {
  var key=process.env.GEMINI_API_KEY; if (!key) return null;
  try {
    var r=await fetchT("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key="+key,{method:"POST",
      headers:{"Content-Type":"application/json"},body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{maxOutputTokens:maxTok||1500}})},12000);
    if (!r.ok) return null; var d=await r.json(); return d.candidates&&d.candidates[0]&&d.candidates[0].content?d.candidates[0].content.parts[0].text:null;
  } catch(e){return null;}
}

function parseJSON(raw) {
  if (!raw) return {};
  try { var m=raw.match(/```(?:json)?\s*([\s\S]*?)```/); if(m) return JSON.parse(m[1].trim()); } catch(e){}
  try { var m2=raw.match(/\{[\s\S]*\}/); if(m2) return JSON.parse(m2[0]); } catch(e){}
  return {};
}

function buildHist(history) {
  return ((history||[]).map(function(m){
    var who=m.role==="user"?"Client":"Huntify";
    var txt=(m.content||"").replace(/<[^>]*>/g," ").replace(/\s+/g," ").trim().slice(0,300);
    return txt?who+": "+txt:null;
  }).filter(Boolean).join("\n")).slice(0,2000);
}

// ── HTML VOYAGE ───────────────────────────────────────────────────────────────
function cardHotel(h, link) {
  var stars="⭐".repeat(Math.min(h.stars||3,5));
  var colors={budget:"#16a34a",confort:"#2f54ff",luxe:"#7c3aed"};
  var labels={budget:"💚 Budget",confort:"💙 Confort",luxe:"💎 Luxe"};
  var cc=colors[h.cat]||"#2f54ff";
  var cl=labels[h.cat]||"";
  return '<a href="'+link+'" target="_blank" rel="sponsored noopener" style="display:flex;flex-direction:column;background:#fff;border:1.5px solid #e6ebf7;border-radius:14px;padding:13px;margin-top:8px;text-decoration:none;gap:5px">'
    +'<div style="display:flex;justify-content:space-between;align-items:flex-start">'
    +'<div style="flex:1">'+(cl?'<span style="background:#eff6ff;color:'+cc+';border-radius:100px;padding:2px 9px;font-size:10px;font-weight:800">'+cl+'</span>':'')
    +'<div style="font-size:13px;font-weight:800;color:#0e1430;margin-top:3px">'+h.name+'</div>'
    +'<div style="font-size:11px;color:#7c89a8">'+stars+' · '+(h.loc||'')+'</div></div>'
    +'<div style="background:linear-gradient(135deg,'+cc+','+cc+'cc);color:#fff;border-radius:10px;padding:7px 11px;text-align:right;flex-shrink:0;margin-left:8px">'
    +'<div style="font-size:15px;font-weight:900">'+(h.price||'?')+'EUR</div>'
    +'<div style="font-size:9px;opacity:.8">/nuit</div></div></div>'
    +(h.hl?'<div style="font-size:11px;color:'+cc+';font-weight:600;background:#eff6ff;border-radius:8px;padding:4px 10px">✨ '+h.hl+'</div>':'')
    +'<div style="font-size:10.5px;color:#94a3b8;font-weight:600">🏨 Voir disponibilites sur Booking.com →</div></a>';
}

function cardDay(d) {
  return '<div style="background:#fff;border:1.5px solid #e6ebf7;border-radius:14px;padding:14px;margin-top:9px">'
    +'<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">'
    +'<div style="background:linear-gradient(135deg,#2f54ff,#4a6bff);color:#fff;border-radius:8px;padding:4px 12px;font-size:12px;font-weight:800">Jour '+d.n+'</div>'
    +'<div style="font-size:12px;font-weight:700;color:#0e1430;flex:1;margin-left:8px">'+(d.title||'')+'</div>'
    +(d.budget?'<div style="font-size:11px;color:#16a34a;font-weight:700">~'+d.budget+'</div>':'')+'</div>'
    +(d.am?'<div style="display:flex;gap:9px;margin-bottom:8px"><span>🌅</span><div><div style="font-size:10px;font-weight:800;color:#94a3b8;text-transform:uppercase">Matin</div><div style="font-size:12px;color:#374151">'+d.am+'</div></div></div>':'')
    +(d.pm?'<div style="display:flex;gap:9px;margin-bottom:8px"><span>☀️</span><div><div style="font-size:10px;font-weight:800;color:#94a3b8;text-transform:uppercase">Apres-midi</div><div style="font-size:12px;color:#374151">'+d.pm+'</div></div></div>':'')
    +(d.eve?'<div style="display:flex;gap:9px;margin-bottom:4px"><span>🌙</span><div><div style="font-size:10px;font-weight:800;color:#94a3b8;text-transform:uppercase">Soiree</div><div style="font-size:12px;color:#374151">'+d.eve+'</div></div></div>':'')
    +(d.resto?'<div style="background:#f0fdf4;border-radius:9px;padding:7px 11px;margin-top:6px;display:flex;justify-content:space-between;align-items:center"><div><div style="font-size:11px;color:#16a34a;font-weight:700">🍽 '+d.resto.name+'</div>'+(d.resto.spec?'<div style="font-size:10px;color:#86efac">'+d.resto.spec+'</div>':'')+'</div><div style="font-size:12px;color:#16a34a;font-weight:800">'+(d.resto.price||'')+'</div></div>':'')
    +(d.acts&&d.acts.length?'<div style="margin-top:7px;display:flex;flex-wrap:wrap;gap:4px">'+d.acts.map(function(a){return '<span style="background:#eff6ff;color:#2f54ff;border-radius:100px;padding:2px 9px;font-size:10.5px;font-weight:600">'+a+'</span>';}).join('')+'</div>':'')
    +'</div>';
}

function cardBudget(b) {
  var rows=[["✈️ Vols A/R",b.vols],["🏨 Hebergement",b.hotel],["🎯 Activites",b.acts],["🍽 Restaurants",b.resto],["🚇 Transport",b.transport]].filter(function(r){return r[1]!=null;});
  return '<div style="background:linear-gradient(135deg,#0e1430,#1f2da0);border-radius:16px;padding:16px;margin-top:12px">'
    +'<div style="font-size:13px;font-weight:800;color:#fff;margin-bottom:12px">💰 Budget estime</div>'
    +rows.map(function(r){return '<div style="display:flex;justify-content:space-between;margin-bottom:7px"><span style="font-size:12px;color:rgba(255,255,255,.75)">'+r[0]+'</span><span style="font-size:12px;font-weight:700;color:#fff">~'+r[1]+'</span></div>';}).join('')
    +'<div style="border-top:1px solid rgba(255,255,255,.2);margin-top:10px;padding-top:10px;display:flex;justify-content:space-between">'
    +'<span style="font-size:13px;font-weight:800;color:#fff">TOTAL</span>'
    +'<span style="font-size:16px;font-weight:900;color:#bcd0ff">~'+(b.total||'')+'</span></div>'
    +(b.pp?'<div style="font-size:11px;color:rgba(255,255,255,.6);text-align:right;margin-top:3px">soit ~'+b.pp+'/personne</div>':'')
    +'</div>';
}

function cardTips(tips) {
  if (!tips||!tips.length) return "";
  return '<div style="background:#f5f3ff;border:1.5px solid #ddd6fe;border-radius:14px;padding:14px;margin-top:10px">'
    +'<div style="font-size:12px;font-weight:800;color:#5b21b6;margin-bottom:8px">💡 Conseils pratiques</div>'
    +tips.map(function(t){return '<div style="font-size:12px;color:#374151;margin-bottom:5px;padding-left:8px;border-left:2px solid #c4b5fd">• '+t+'</div>';}).join('')+'</div>';
}

// ── HANDLER ───────────────────────────────────────────────────────────────────
export default async function handler(req) {
  if (req.method==="OPTIONS") return new Response(null,{status:204,headers:{"Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"POST,OPTIONS","Access-Control-Allow-Headers":"Content-Type"}});
  if (req.method!=="POST") return new Response("Method not allowed",{status:405});
  var H={"Content-Type":"application/json; charset=utf-8","Access-Control-Allow-Origin":"*"};

  try {
    var body=await req.json();
    var message=body.message||"";
    var history=body.history||[];
    var sid=body.sessionId||("anon_"+Date.now());
    var today=new Date().toISOString().slice(0,10);
    var hist=buildHist(history);

    if (body.trackingEnabled) {
      sb("searches","POST",{query:"[VOYAGE] "+message,session_id:sid,user_id:body.userId||null});
    }

    // ── PIPELINE : Groq DeepSearch comprend + Claude genere ────────────────────

    // Etape 1 — Groq DeepSearch analyse la conversation et decide, en totale autonomie
    var groqPrompt = 'Tu es Huntify, un ami expert voyage — pas un formulaire administratif.\n'
      +'Aujourd\'hui: '+today+'\n\n'
      +'CONVERSATION COMPLETE:\n'+hist+'\n'
      +'MESSAGE: '+message+'\n\n'
      +'MISSION: comprends vraiment ce que la personne veut, comme le ferait un ami tres competent qui organise le voyage.\n'
      +'Extrais toutes les infos disponibles: destination, ville_depart, checkin (YYYY-MM-DD), checkout (YYYY-MM-DD), duree, nb_adultes, budget, style.\n'
      +'Si l utilisateur repond a une question precedente, sa reponse EST la reponse a cette question — ne la redemande jamais.\n'
      +'"marseille", "marseilel", "depuis marseille" = ville de depart (tolere les fautes de frappe).\n\n'
      +'DECISION — utilise ton jugement, pas une regle fixe:\n'
      +'- Si tu as assez d infos essentielles (destination + point de depart + une notion de duree/dates) pour proposer un voyage pertinent → action:generate MAINTENANT. Ne cherche pas la perfection, un ami ne fait pas un interrogatoire.\n'
      +'- Si une info vraiment bloquante manque (on ne sait meme pas ou la personne veut aller, ou d ou elle part) → action:question, UNE seule question naturelle et chaleureuse, jamais une liste.\n'
      +'- Relis TOUJOURS l historique avant de decider : si la personne a deja repondu a une question, meme approximativement, on avance — on ne boucle jamais sur la meme question.\n'
      +'- En cas de doute entre demander et generer, privilegie GENERER avec des hypotheses raisonnables (budget moyen, 2 adultes, 3-4 jours) plutot que de multiplier les questions.\n\n'
      +'JSON:\n'
      +'question: {action:"question", msg:"question courte et chaleureuse"}\n'
      +'generation: {action:"generate", infos:{destination, ville_depart, nb_adultes, checkin, checkout, duree, budget, style}}';

    var step1raw = await groqDS(groqPrompt, 700);
    var step1 = parseJSON(step1raw||"{}");

    if (step1.action==="question" && step1.msg) {
      return new Response(JSON.stringify({reply:'<div style="font-size:13.5px;color:#1e293b;line-height:1.6;padding:4px 0">'+step1.msg+'</div>',sessionId:sid}),{headers:H});
    }

    // Etape 2 — Claude genere l itineraire complet
    var infos = step1.infos||{};
    var adults = parseInt(infos.nb_adultes)||2;
    var ci = parseDate(infos.checkin||null);
    var nights = parseInt(((infos.duree||"3 jours").match(/\d+/)||["3"])[0])||3;
    var co = parseDate(infos.checkout||null);
    if (!co && ci) { var dco=new Date(ci); dco.setDate(dco.getDate()+nights); co=dco.toISOString().slice(0,10); }

    var claudeSys = 'Expert voyage Huntify. Genere un itineraire COMPLET en JSON.\n'
      +'Date: '+today+'\n'
      +'Infos: destination='+infos.destination+', depart='+infos.ville_depart+', adultes='+adults
      +', checkin='+(ci||'?')+' checkout='+(co||'?')+' ('+nights+' nuits)'
      +', budget='+(infos.budget||'moyen')+', style='+(infos.style||'equilibre')+'\n\n'
      +'RECHERCHE les vrais prix pour cette destination et ces dates.\n'
      +'JSON avec TOUS ces champs:\n'
      +'t:"i", recap:string, itin:{\n'
      +'  dest, country, flag, dur, trav, style, dep,\n'
      +'  checkin:YYYY-MM-DD, checkout:YYYY-MM-DD, adults,\n'
      +'  flights:{out:{from:IATA,to:IATA,price,co,dur}, ret:{from:IATA,to:IATA,price,co,dur}},\n'
      +'  hotels:[3 vrais hotels: {name,stars,price,loc,hl,cat:budget/confort/luxe}],\n'
      +'  days:[{n,title,am,pm,eve,resto:{name,price,spec},acts:[],budget}],\n'
      +'  budget:{vols,hotel,acts,resto,transport,total,pp},\n'
      +'  tips:[4 conseils specifiques]}\n'
      +'IATA: Paris=CDG,Marseille=MRS,Nice=NCE,Lyon=LYS,Rome=FCO,Barcelone=BCN,Madrid=MAD,Lisbonne=LIS,Londres=LHR.\n'
      +'Hotels: VRAIS etablissements existants. JSON UNIQUEMENT.';

    var itinRaw = await claude(claudeSys, 'Genere: '+JSON.stringify(infos), 3000);
    if (!itinRaw) itinRaw = await groqDS(claudeSys+'\nGenere: '+JSON.stringify(infos), 2500);
    if (!itinRaw) itinRaw = await gemini(claudeSys+'\nGenere: '+JSON.stringify(infos), 2500);

    var tP = parseJSON(itinRaw||"");
    var itin = tP.itin;

    // Fallback minimal
    if (!itin) {
      var skyF=skyLink(infos.ville_depart||"",infos.destination||"",ci,co,adults);
      var bkgF=bookLink(infos.destination||"",ci,co,adults,null);
      var gtfF=getTransferLink(infos.destination||"",ci);
      return new Response(JSON.stringify({reply:
        '<div style="font-size:13.5px;color:#1e293b;margin-bottom:12px">Voici les liens directs pour votre voyage :</div>'
        +'<a href="'+skyF+'" target="_blank" style="display:flex;justify-content:center;background:linear-gradient(135deg,#0e1430,#1f2da0);color:#fff;text-decoration:none;border-radius:12px;padding:14px;margin-top:8px;font-size:13px;font-weight:700">✈️ Vols sur Skyscanner →</a>'
        +'<a href="'+bkgF+'" target="_blank" style="display:flex;justify-content:center;background:linear-gradient(135deg,#003580,#0071c2);color:#fff;text-decoration:none;border-radius:12px;padding:14px;margin-top:8px;font-size:13px;font-weight:700">🏨 Hotels sur Booking.com →</a>'
        +'<a href="'+gtfF+'" target="_blank" style="display:flex;justify-content:center;background:linear-gradient(135deg,#1a1a2e,#e94560);color:#fff;text-decoration:none;border-radius:12px;padding:14px;margin-top:8px;font-size:13px;font-weight:700">🚗 Transfert GetTransfer →</a>',
        sessionId:sid}),{headers:H});
    }

    // ── RENDER ITINERAIRE COMPLET ─────────────────────────────────────────────
    var finalCi = (/^\d{4}-\d{2}-\d{2}$/.test(itin.checkin||""))?itin.checkin:(ci||"");
    var finalCo = (/^\d{4}-\d{2}-\d{2}$/.test(itin.checkout||""))?itin.checkout:(co||"");
    var finalAdults = itin.adults||adults;
    var itinId = "itin_"+Date.now();
    var html = "";

    // Header
    html += '<div id="'+itinId+'" style="background:linear-gradient(135deg,#1f2da0,#2f54ff);border-radius:16px;padding:18px;margin-bottom:4px;text-align:center">'
      +'<div style="font-size:32px;margin-bottom:6px">'+(itin.flag||"✈️")+'</div>'
      +'<div style="font-size:20px;font-weight:800;color:#fff">'+(itin.dest||"")+(itin.country?", "+itin.country:"")+'</div>'
      +'<div style="font-size:12px;color:rgba(255,255,255,.75);margin-top:6px;display:flex;justify-content:center;gap:12px;flex-wrap:wrap">'
      +'<span>📅 '+(itin.dur||nights+" jours")+'</span><span>👥 '+(itin.trav||finalAdults+" pers.")+'</span>'
      +(itin.dep?'<span>🛫 Depuis '+itin.dep+'</span>':'')
      +(itin.budget&&itin.budget.total?'<span>💰 ~'+itin.budget.total+'</span>':'')
      +'</div></div>';

    if (tP.recap) html += '<div style="background:#f5f3ff;border:1.5px solid #ddd6fe;border-radius:12px;padding:10px 14px;margin-top:8px;font-size:12px;color:#5b21b6;font-weight:600">🔎 '+tP.recap+'</div>';

    // Vols
    if (itin.flights&&itin.flights.out) {
      var f=itin.flights;
      var skyU=skyLink(f.out.from||itin.dep||infos.ville_depart||"",f.out.to||itin.dest||"",finalCi,finalCo,finalAdults);
      html += '<div style="font-size:12px;font-weight:800;color:#0e1430;margin:14px 0 6px">✈️ Vols recommandes</div>'
        +'<div style="background:#fff;border:1.5px solid #e6ebf7;border-radius:14px;overflow:hidden">'
        +'<div style="padding:12px 14px;border-bottom:1px solid #f0f4ff"><div style="display:flex;justify-content:space-between;align-items:center">'
        +'<div><div style="font-size:10px;font-weight:800;color:#7c89a8;text-transform:uppercase">Aller'+(finalCi?" · "+finalCi:"")+'</div>'
        +'<div style="font-size:13px;font-weight:700;color:#0e1430;margin-top:2px">'+(f.out.from||"")+' → '+(f.out.to||"")+'</div>'
        +'<div style="font-size:11px;color:#7c89a8">'+(f.out.co||"")+' · '+(f.out.dur||"")+'</div></div>'
        +'<div style="text-align:right"><div style="font-size:16px;font-weight:900;color:#2f54ff">~'+(f.out.price||"?")+'EUR</div><div style="font-size:10px;color:#7c89a8">/pers.</div></div></div></div>'
        +(f.ret?'<div style="padding:12px 14px"><div style="display:flex;justify-content:space-between;align-items:center">'
          +'<div><div style="font-size:10px;font-weight:800;color:#7c89a8;text-transform:uppercase">Retour'+(finalCo?" · "+finalCo:"")+'</div>'
          +'<div style="font-size:13px;font-weight:700;color:#0e1430;margin-top:2px">'+(f.ret.from||"")+' → '+(f.ret.to||"")+'</div>'
          +'<div style="font-size:11px;color:#7c89a8">'+(f.ret.co||"")+' · '+(f.ret.dur||"")+'</div></div>'
          +'<div style="text-align:right"><div style="font-size:16px;font-weight:900;color:#2f54ff">~'+(f.ret.price||"?")+'EUR</div><div style="font-size:10px;color:#7c89a8">/pers.</div></div></div></div>':'')
        +'</div>'
        +'<a href="'+skyU+'" target="_blank" style="display:flex;align-items:center;justify-content:center;gap:8px;background:linear-gradient(135deg,#0e1430,#1f2da0);color:#fff;text-decoration:none;border-radius:12px;padding:12px;font-size:13px;font-weight:700;margin-top:6px">🔍 Comparer ces vols sur Skyscanner →</a>';
    }

    // Klook — activites et excursions sur place
    html += '<a href="'+klookLink(itin.dest||"")+'" target="_blank" style="display:flex;align-items:center;gap:10px;background:linear-gradient(135deg,#ff5722,#ff8a50);color:#fff;text-decoration:none;border-radius:14px;padding:12px 14px;margin-top:8px">'
      +'<span style="font-size:20px">🎫</span><div style="flex:1"><div style="font-size:12px;font-weight:800">Activites, tickets et transport local</div>'
      +'<div style="font-size:11px;opacity:.85">Klook · '+(itin.dest||"")+'</div></div>'
      +'<span style="font-size:11px;font-weight:700;background:rgba(255,255,255,.2);border-radius:8px;padding:5px 10px">Voir tout →</span></a>';

    // Hotels
    if (itin.hotels&&itin.hotels.length) {
      html += '<div style="font-size:12px;font-weight:800;color:#0e1430;margin:16px 0 6px">🏨 Hebergements</div>';
      var cats=["budget","confort","luxe"];
      for (var hi=0;hi<itin.hotels.length;hi++) {
        var h=itin.hotels[hi];
        var hcat=cats[hi]||h.cat||"confort";
        var hlink=bookLink(itin.dest||"",finalCi,finalCo,finalAdults,hcat);
        html += cardHotel({name:h.name,stars:h.stars,price:h.price,loc:h.loc||itin.dest,hl:h.hl,cat:hcat}, hlink);
      }
      // Boutons voir plus
      html += '<div style="display:flex;gap:8px;margin-top:8px">'
        +'<a href="'+bookLink(itin.dest||"",finalCi,finalCo,finalAdults,null)+'" target="_blank" style="flex:1;display:flex;justify-content:center;align-items:center;background:linear-gradient(135deg,#003580,#0071c2);color:#fff;text-decoration:none;border-radius:12px;padding:10px;font-size:11px;font-weight:700">🏨 Booking.com</a>'
        +'<a href="'+expLink(itin.dest||"",finalCi,finalCo,finalAdults)+'" target="_blank" style="flex:1;display:flex;justify-content:center;align-items:center;background:linear-gradient(135deg,#00355f,#00a0e3);color:#fff;text-decoration:none;border-radius:12px;padding:10px;font-size:11px;font-weight:700">✈️ Expedia.fr</a>'
        +'</div>';
    }

    // GetTransfer
    if (finalCi) {
      html += '<a href="'+getTransferLink(itin.dest||"",finalCi)+'" target="_blank" style="display:flex;align-items:center;gap:10px;background:linear-gradient(135deg,#1a1a2e,#e94560);color:#fff;text-decoration:none;border-radius:14px;padding:12px 14px;margin-top:8px">'
        +'<span style="font-size:20px">🚐</span><div style="flex:1"><div style="font-size:12px;font-weight:800">Transfert aeroport</div>'
        +'<div style="font-size:11px;opacity:.75">GetTransfer · '+(itin.dest||"")+'</div></div>'
        +'<span style="font-size:11px;font-weight:700;background:rgba(255,255,255,.15);border-radius:8px;padding:5px 10px">Voir prix →</span></a>';
    }

    // Eurocar (si pertinent)
    if (wantsCar(itin.dest, itin.style)) {
      html += '<a href="'+eurocarLink(itin.dest||"",finalCi,finalCo)+'" target="_blank" style="display:flex;align-items:center;gap:10px;background:linear-gradient(135deg,#1a1a2e,#16213e);color:#fff;text-decoration:none;border-radius:14px;padding:12px 14px;margin-top:8px">'
        +'<span style="font-size:20px">🚗</span><div style="flex:1"><div style="font-size:12px;font-weight:800">Louer une voiture sur place</div>'
        +'<div style="font-size:11px;opacity:.75">Europcar · '+(itin.dest||"")+'</div></div>'
        +'<span style="font-size:11px;font-weight:700;background:rgba(255,255,255,.15);border-radius:8px;padding:5px 10px">Voir prix →</span></a>';
    }

    // Programme jour par jour
    if (itin.days&&itin.days.length) {
      html += '<div style="font-size:12px;font-weight:800;color:#0e1430;margin:16px 0 6px">📅 Programme jour par jour</div>';
      for (var di=0;di<itin.days.length;di++) html += cardDay(itin.days[di]);
    }

    if (itin.budget) html += cardBudget(itin.budget);
    if (itin.tips&&itin.tips.length) html += cardTips(itin.tips);

    // Wishlist + Export
    var wData=JSON.stringify({type:"voyage",name:(itin.flag||"✈️")+" "+(itin.dest||""),subtitle:(itin.dur||""),store:"booking",url:bookLink(itin.dest||"",finalCi,finalCo,finalAdults,null)}).replace(/"/g,"&quot;");
    html += '<div style="display:flex;gap:8px;margin-top:12px">'
      +'<button onclick="addToWishlist('+wData+')" style="flex:1;background:linear-gradient(135deg,#1f2da0,#2f54ff);border:none;color:#fff;border-radius:12px;padding:12px;font-weight:700;font-size:13px;cursor:pointer;font-family:inherit">♡ Sauvegarder</button>'
      +'<button onclick="exportItinerary(\''+itinId+'\')" style="background:#f5f7ff;border:1.5px solid #c7d2fe;color:#3b5bdb;border-radius:12px;padding:12px;font-weight:700;font-size:13px;cursor:pointer;font-family:inherit">⬇️ Exporter</button></div>';

    return new Response(JSON.stringify({reply:html,sessionId:sid}),{headers:H});

  } catch(err) {
    console.error("Huntify travel error:",err&&err.message);
    return new Response(JSON.stringify({reply:'<div style="font-size:13px;color:#1e293b">Desole, probleme momentane. Reessayez !</div>'}),{status:200,headers:{"Content-Type":"application/json; charset=utf-8","Access-Control-Allow-Origin":"*"}});
  }
}
