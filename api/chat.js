export const config = { runtime: 'edge' };

// ─────────────────────────────────────────────────────────────────────────────
// HUNTIFY — Mode Comparateur Produit (Amazon + Rakuten) — v2 FIABILISÉE
//
// CHANGEMENT MAJEUR vs v1 :
// Les liens faux venaient du fait que Groq (compound-beta) INVENTAIT des URLs.
// Un LLM sans recherche web ne peut PAS connaître un ASIN réel — il hallucine.
//
// Nouvelle règle d'or, appliquée DANS LE CODE (pas seulement dans le prompt) :
//   1. Claude + web_search = SOURCE PRIMAIRE (il cherche réellement sur le web)
//   2. Toute URL non vérifiée par regex stricte → remplacée par un lien de
//      RECHERCHE contenant le NOM EXACT du produit. Un lien de recherche
//      fonctionne toujours et correspond toujours à la proposition affichée.
//   3. Groq/Gemini/Mistral ne servent qu'à la décision et au fallback,
//      et leurs URLs sont TOUJOURS ignorées (url forcée à null).
// ─────────────────────────────────────────────────────────────────────────────

const SUPABASE_URL = "https://enocxbrqyybendertytl.supabase.co";
const SUPABASE_KEY = "sb_publishable_NmPh--frZG5HuqfaoxnemA_E7cidV9Y";
const MODEL        = "claude-haiku-4-5";
const AMAZON_TAG   = "huntify21-21";
const AWIN_PUB     = "2920215";
const RAKUTEN_MID  = "55615";

// ── SUPABASE ──────────────────────────────────────────────────────────────────
async function sb(path, method, body) {
  const h = {"Content-Type":"application/json","apikey":SUPABASE_KEY,"Authorization":"Bearer "+SUPABASE_KEY};
  const opts = {method:method||"GET",headers:h};
  if (body) opts.body = JSON.stringify(body);
  try { const r = await fetch(SUPABASE_URL+"/rest/v1/"+path, opts); return await r.json(); } catch(e) { return null; }
}

async function getAds() {
  try {
    const r = await fetch(SUPABASE_URL+"/rest/v1/advertisers?active=eq.true",{headers:{"apikey":SUPABASE_KEY,"Authorization":"Bearer "+SUPABASE_KEY}});
    const d = await r.json(); return Array.isArray(d)?d:[];
  } catch(e) { return []; }
}

// ── LIENS AFFILIATION ─────────────────────────────────────────────────────────
function cleanKw(kw) {
  if (!kw) return "";
  const stop = new Set(["la","le","les","un","une","des","avec","et","en","du","au","aux","pour","sur","dans","pas","cher","je","veux","cherche"]);
  return kw.replace(/,/g," ").replace(/\s+/g," ").trim()
    .split(" ").filter(w=>w.length>1&&!stop.has(w.toLowerCase())).slice(0,7).join(" ");
}

// Validation STRICTE des URLs produit. Tout ce qui ne passe pas → lien recherche.
function validAmazonUrl(url) {
  const m = (url||"").match(/amazon\.fr\/(?:[^\/]+\/)?dp\/([A-Z0-9]{10})(?:[\/?]|$)/);
  return (m && /^B[A-Z0-9]{9}$/.test(m[1])) ? m[1] : null;
}
function validRakutenUrl(url) {
  return !!(url && url.includes("rakuten.com") && /\/(mfp|m)\/\d+/.test(url) && !url.includes("/s/"));
}

function buildLink(adv, keywords, directUrl) {
  if (!adv||!adv.active) return null;
  const kw = cleanKw(keywords);
  if (adv.slug==="amazon") {
    const tag = adv.amazon_tag||AMAZON_TAG;
    const asin = validAmazonUrl(directUrl);
    if (asin) return "https://www.amazon.fr/dp/"+asin+"?tag="+tag;
    // Lien de recherche avec le NOM EXACT du produit → toujours cohérent
    return "https://www.amazon.fr/s?k="+encodeURIComponent(kw)+"&tag="+tag;
  }
  if (adv.slug==="rakuten") {
    const mid = adv.awin_mid||RAKUTEN_MID;
    const aff = adv.awin_affid||adv.awin_aff||AWIN_PUB;
    const dest = validRakutenUrl(directUrl)
      ? directUrl.split("?")[0]
      : "https://fr.shopping.rakuten.com/s/"+encodeURIComponent(kw.replace(/\s+/g,"+"));
    return "https://www.awin1.com/cread.php?awinmid="+mid+"&awinaffid="+aff+"&clickref=huntify&ued="+encodeURIComponent(dest);
  }
  if (adv.awin_mid) {
    const aff = adv.awin_affid||adv.awin_aff||AWIN_PUB;
    const dest = (adv.search_url||"https://www."+adv.slug+".fr/search?q={kw}").replace("{kw}",encodeURIComponent(kw));
    return "https://www.awin1.com/cread.php?awinmid="+adv.awin_mid+"&awinaffid="+aff+"&ued="+encodeURIComponent(dest);
  }
  return null;
}

function findAdv(ads, slug) { return (ads||[]).find(a=>a.slug===(slug||"").toLowerCase())||null; }

// ── APPELS IA (avec timeout de sécurité) ──────────────────────────────────────
async function fetchT(url, opts, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(()=>ctrl.abort(), ms||8000);
  try {
    const r = await fetch(url, {...opts, signal:ctrl.signal});
    clearTimeout(timer);
    return r;
  } catch(e) { clearTimeout(timer); throw e; }
}

async function groq(sys, user, maxTok) {
  const key = process.env.GROQ_API_KEY; if (!key) return null;
  try {
    const r = await fetchT("https://api.groq.com/openai/v1/chat/completions",{method:"POST",
      headers:{"Content-Type":"application/json","Authorization":"Bearer "+key},
      body:JSON.stringify({model:"llama-3.3-70b-versatile",max_tokens:maxTok||500,messages:[{role:"system",content:sys},{role:"user",content:user}]})},7000);
    if (!r.ok) return null; const d=await r.json(); return d.choices&&d.choices[0]?d.choices[0].message.content:null;
  } catch(e){return null;}
}

async function groqDS(prompt, maxTok) {
  const key = process.env.GROQ_API_KEY; if (!key) return null;
  try {
    const r = await fetchT("https://api.groq.com/openai/v1/chat/completions",{method:"POST",
      headers:{"Content-Type":"application/json","Authorization":"Bearer "+key},
      body:JSON.stringify({model:"compound-beta",max_tokens:maxTok||1200,messages:[{role:"user",content:prompt}]})},12000);
    if (!r.ok) return await groq("Reponds en JSON.",prompt,maxTok||1200);
    const d=await r.json(); return d.choices&&d.choices[0]?d.choices[0].message.content:null;
  } catch(e){return await groq("Reponds en JSON.",prompt,maxTok||1200);}
}

async function gemini(prompt, maxTok) {
  const key = process.env.GEMINI_API_KEY; if (!key) return null;
  try {
    const r = await fetchT("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key="+key,{method:"POST",
      headers:{"Content-Type":"application/json"},body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{maxOutputTokens:maxTok||500}})},7000);
    if (!r.ok) return null; const d=await r.json(); return d.candidates&&d.candidates[0]&&d.candidates[0].content?d.candidates[0].content.parts[0].text:null;
  } catch(e){return null;}
}

async function mistral(sys, user, maxTok) {
  const key = process.env.MISTRAL_API_KEY; if (!key) return null;
  try {
    const r = await fetchT("https://api.mistral.ai/v1/chat/completions",{method:"POST",
      headers:{"Content-Type":"application/json","Authorization":"Bearer "+key},
      body:JSON.stringify({model:"mistral-small-latest",max_tokens:maxTok||500,messages:[{role:"system",content:sys},{role:"user",content:user}]})},7000);
    if (!r.ok) return null; const d=await r.json(); return d.choices&&d.choices[0]?d.choices[0].message.content:null;
  } catch(e){return null;}
}

async function freeAI(sys, user, maxTok) {
  return await groq(sys,user,maxTok)||await gemini(sys+"\n\n"+user,maxTok)||await mistral(sys,user,maxTok);
}

async function claude(sys, user, maxTok, tools) {
  const key = process.env.ANTHROPIC_API_KEY; if (!key) return null;
  try {
    const payload = {model:MODEL,max_tokens:maxTok||800,system:sys,messages:[{role:"user",content:user}]};
    if (tools&&tools.length) payload.tools = tools;
    const r = await fetchT("https://api.anthropic.com/v1/messages",{method:"POST",
      headers:{"Content-Type":"application/json; charset=utf-8","x-api-key":key,"anthropic-version":"2023-06-01"},
      body:JSON.stringify(payload)},18000);
    const d=await r.json(); if (!r.ok) return null;
    let t=""; for(const b of (d.content||[])){if(b.type==="text")t+=b.text;} return t||null;
  } catch(e){return null;}
}

function parseJSON(raw) {
  if (!raw) return {};
  try { const m=raw.match(/```(?:json)?\s*([\s\S]*?)```/); if(m) return JSON.parse(m[1].trim()); } catch(e){}
  try { const m=raw.match(/\{[\s\S]*\}/); if(m) return JSON.parse(m[0]); } catch(e){}
  return {};
}

// ── UTILS ─────────────────────────────────────────────────────────────────────
function buildHist(history) {
  return ((history||[]).map(m=>{
    const who=m.role==="user"?"Client":"Huntify";
    const txt=(m.content||"").replace(/<[^>]*>/g," ").replace(/\s+/g," ").trim().slice(0,300);
    return txt?who+": "+txt:null;
  }).filter(Boolean).join("\n")).slice(0,2000);
}

function countQ(history) { return (history||[]).filter(m=>m.role!=="user"&&(m.content||"").length>20&&(m.content||"").length<300).length; }

function detectBudget(text) {
  if (!text) return null;
  const ps=[/(?:moins de|maxi|budget|environ|max)[^\d]*(\d+)\s*(?:€|euros?)/i,/(\d+)\s*(?:€|euros?)/i,/budget[^\d]*(\d+)/i];
  for (const r of ps) { const m=text.match(r); if(m){const b=parseInt(m[1]);if(b>0&&b<100000)return b;} }
  return null;
}

async function dbLookup(kw) {
  const k=(kw||"").toLowerCase().split(" ")[0];
  try {
    const [deals,prices,promos]=await Promise.all([
      sb("daily_deals?name=ilike.*"+encodeURIComponent(k)+"*&limit=3"),
      sb("price_history?product_name=ilike.*"+encodeURIComponent(k)+"*&order=checked_at.desc&limit=5"),
      sb("promo_codes?valid=eq.true&order=found_at.desc&limit=2")]);
    const parts=[];
    if(deals&&deals.length) parts.push("Deals: "+deals.map(x=>x.name+" "+x.price+"EUR").join(" | "));
    if(prices&&prices.length) parts.push("Prix: "+prices.map(x=>x.product_name+" "+x.price+"EUR").join(" | "));
    if(promos&&promos.length) parts.push("Codes: "+promos.map(x=>x.code+" ("+x.store+")").join(" | "));
    return parts.join("\n");
  } catch(e){return "";}
}

function getCross(recap) {
  const r=(recap||"").toLowerCase();
  const map={"casque":["housse transport casque","coussinets rechange"],"telephone":["coque protection","verre trempe"],"laptop":["housse laptop","souris sans fil"],"sneakers":["semelles confort","spray impermeabilisant"],"parfum":["coffret miniatures","atomiseur voyage"],"masque":["palmes","tuba","sac etanche"],"snorkeling":["palmes reglables","sac etanche"]};
  for (const [k,v] of Object.entries(map)) if (r.includes(k)) return v;
  return [];
}

// ── HTML ──────────────────────────────────────────────────────────────────────
function cardProd(name, price, url, adv, badge, verified) {
  const pill='<span style="background:rgba(255,255,255,.2);border-radius:100px;padding:2px 10px;font-size:10px;font-weight:800">'+(adv.emoji||"🛍")+" "+adv.name+"</span>";
  const vBadge = verified ? ' · <span style="font-size:9px;opacity:.9">✓ lien direct</span>' : '';
  return '<a href="'+url+'" target="_blank" rel="sponsored noopener" style="display:flex;align-items:center;gap:12px;background:'+(adv.color||"#2f54ff")+';color:#fff;text-decoration:none;border-radius:14px;padding:12px 14px;margin-top:8px">'
    +'<div style="flex:1;min-width:0"><div style="font-size:10px;margin-bottom:4px;opacity:.85">'+pill+(badge?" · "+badge:"")+vBadge+"</div>"
    +'<div style="font-size:13px;font-weight:800;line-height:1.3;word-break:break-word">'+name+"</div></div>"
    +'<span style="background:rgba(255,255,255,.22);border-radius:8px;padding:5px 10px;white-space:nowrap;font-size:14px;font-weight:900;flex-shrink:0">'+(price||"Voir prix")+"</span></a>";
}

function promoBox(code, store, desc) {
  return '<div style="background:#f0fdf4;border:1.5px solid #86efac;border-radius:12px;padding:10px 14px;margin-top:6px;display:flex;align-items:center;justify-content:space-between;gap:8px">'
    +'<div><span style="font-size:11px;color:#16a34a;font-weight:700">🏷 '+store+'</span>'
    +'<div style="font-size:12px;color:#166534;font-weight:600">'+desc+'</div></div>'
    +'<div onclick="navigator.clipboard.writeText(\''+code+'\');this.textContent=\'Copie !\';setTimeout(()=>this.textContent=\''+code+'\',2000)" style="background:#16a34a;color:#fff;border-radius:8px;padding:6px 10px;font-weight:800;font-size:12px;cursor:pointer;white-space:nowrap;flex-shrink:0">'+code+'</div></div>';
}

// ── HANDLER ───────────────────────────────────────────────────────────────────
export default async function handler(req) {
  if (req.method==="OPTIONS") return new Response(null,{status:204,headers:{"Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"POST,OPTIONS","Access-Control-Allow-Headers":"Content-Type"}});
  if (req.method!=="POST") return new Response("Method not allowed",{status:405});
  const H={"Content-Type":"application/json; charset=utf-8","Access-Control-Allow-Origin":"*"};

  try {
    const body=await req.json();
    const message=body.message||"";
    const history=body.history||[];
    const sid=body.sessionId||("anon_"+Date.now());
    const ads=await getAds();
    const hist=buildHist(history);

    if (body.trackingEnabled) {
      sb("searches","POST",{query:message,session_id:sid,user_id:body.userId||null});
      sb("trends","POST",{query:message.toLowerCase().trim(),count:1,last_searched:new Date().toISOString()});
    }

    // ── ÉTAPE 1 : Décision — clarifier ou chercher ────────────────────────────
    // Jamais bloquant : si la décision IA échoue, on cherche avec ce qu'on a.
    const qAsked = countQ(history);

    const decidePrompt = 'Tu es l assistant shopping Huntify. Decide si UNE question de clarification\n'
      +'rendrait la recherche VRAIMENT meilleure, ou si tu peux chercher tout de suite.\n\n'
      +'HISTORIQUE:\n'+(hist||'(debut de conversation)')+'\n'
      +'DERNIER MESSAGE: '+message+'\n\n'
      +'Pose UNE question courte SEULEMENT si un critere manquant change vraiment le resultat\n'
      +'(teinte pour maquillage teint, pointure pour chaussures, usage+budget pour electronique cher,\n'
      +'destinataire+budget pour cadeau...). Bon sens selon la categorie.\n'
      +'Ne pose PAS de question si: le produit est assez clair, ou si '+qAsked+' question(s) deja posee(s)\n'
      +'(dans ce cas ready:true OBLIGATOIRE), ou si le client vient de repondre a une question.\n\n'
      +'JSON STRICT, rien d autre:\n'
      +'{"ready": false, "msg": "question courte et naturelle"}\n'
      +'ou {"ready": true, "recap": "mots-cles produit precis (marque/type/critere si connu)"}';

    let decision = { ready: true, recap: null };
    try {
      const decideRaw = await freeAI(decidePrompt, message, 300);
      if (decideRaw) {
        const parsed = parseJSON(decideRaw);
        const asksQuestion = (parsed.ready === false || parsed.ready === "false") && parsed.msg && qAsked < 2;
        if (asksQuestion) decision = { ready:false, msg:parsed.msg };
        else if (parsed.recap) decision = { ready:true, recap:parsed.recap };
      }
    } catch(e) { /* jamais bloquant */ }

    if (decision.ready === false) {
      return new Response(JSON.stringify({reply:'<div style="font-size:13.5px;color:#1e293b;line-height:1.6;padding:4px 0">'+decision.msg+'</div>',sessionId:sid}),{headers:H});
    }

    // Extraction des mots-clés produit
    const allUserMsgs = history.filter(m=>m.role==="user").map(m=>m.content||"").join(" ")+" "+message;
    let recap = decision.recap || null;
    if (!recap) {
      const extractRaw = await freeAI(
        'Extrait le PRODUIT recherche. Retourne des mots-cles e-commerce concrets, jamais la phrase brute.\n'
        +'Ex: "je veux respirer sous l eau" → "masque snorkeling plongee". "un truc pour courir" → "chaussures running".\n'
        +'JSON: {recap:"mots-cles produit"}',
        allUserMsgs.trim(), 200);
      recap = parseJSON(extractRaw||"").recap || cleanKw(allUserMsgs);
    }

    const budget = detectBudget(recap) || detectBudget(message) || detectBudget(hist);
    if (budget && !(recap||"").includes("EUR") && !(recap||"").includes("€")) recap = recap+" "+budget+"EUR";

    // ── ÉTAPE 2 : Claude + web_search = SOURCE PRIMAIRE ──────────────────────
    // C'est LE changement clé : le modèle qui propose les produits est celui
    // qui a réellement cherché sur le web. Fini les noms/prix/URLs inventés.
    const dbCtx = await dbLookup(recap);

    const searchSys = 'Tu es l agent shopping Huntify. Tu DOIS utiliser web_search MAINTENANT pour trouver\n'
      +'les VRAIS produits en vente sur amazon.fr (et si possible fr.shopping.rakuten.com).\n\n'
      +'REGLES ABSOLUES — toute violation rend ta reponse inutilisable:\n'
      +'1. INTERDIT d inventer un nom, un prix ou une URL. Tout doit venir de tes resultats de recherche.\n'
      +'2. name = VRAI nom complet (marque + modele exact) vu dans les resultats.\n'
      +'   INTERDIT: "Casque audio", "Masque de snorkeling". CORRECT: "Sony WH-1000XM5", "Cressi F1".\n'
      +'3. url = URL amazon.fr contenant /dp/ASIN UNIQUEMENT si tu l as VUE dans un resultat de recherche.\n'
      +'   Si tu n as pas vu l URL exacte → url:null (le systeme creera un lien fiable a partir du nom).\n'
      +'4. price = prix vu dans les resultats. Si non visible → "Voir prix". Jamais un prix devine.\n'
      +'5. 3 a 4 produits, varies en gamme de prix si possible, adaptes au budget du client.\n\n'
      +(dbCtx?'Donnees internes Huntify (utilisables): '+dbCtx+'\n\n':'')
      +'Reponds en JSON UNIQUEMENT:\n'
      +'{summary:"1 phrase courte et chaleureuse", products:[{name,price,store:"amazon"|"rakuten",url,badge:"Top vente"|"Meilleur rapport qualite/prix"|"Budget"|null}]}';

    let products = [], summary = "", promos = [];
    const claudeRaw = await claude(searchSys, 'Recherche pour ce besoin client: '+recap, 1200,
      [{type:"web_search_20250305",name:"web_search",max_uses:3}]);
    if (claudeRaw) {
      const cp = parseJSON(claudeRaw);
      products = cp.products||[];
      summary  = cp.summary||"";
    }

    // ── ÉTAPE 3 : Fallbacks — mais leurs URLs sont TOUJOURS neutralisees ─────
    // Groq/Gemini n'ont pas de vraie recherche fiable → on garde leurs noms de
    // produits (utiles pour des liens de recherche precis) mais url forcee null.
    if (!products.length) {
      const fbPrompt = 'Agent shopping. Besoin client: '+recap+'\n'
        +'Propose 3 produits CONNUS et populaires de cette categorie (marque + modele reels et courants).\n'
        +'Ne fournis PAS d URL. JSON: {summary:"1 phrase", products:[{name,price:"Voir prix",store:"amazon"|"rakuten",badge}]}';
      const raw = await groqDS(fbPrompt, 800) || await freeAI('Reponds en JSON.', fbPrompt, 700);
      const fp = parseJSON(raw||"");
      products = (fp.products||[]).map(p=>({...p, url:null})); // URLs neutralisées
      summary  = fp.summary||summary;
    }

    // ── Garantit toujours au moins Amazon + Rakuten ───────────────────────────
    if (!products.some(p=>(p.store||"").includes("amazon"))) {
      products.unshift({name:recap,price:"Voir prix",store:"amazon",url:null,badge:"Bestseller"});
    }
    if (!products.some(p=>(p.store||"").includes("rakuten"))) {
      products.push({name:recap,price:"Voir prix",store:"rakuten",url:null,badge:"Bon plan"});
    }
    if (!summary) summary = 'Voici mes selections pour vous :';

    // ── Construction HTML ─────────────────────────────────────────────────────
    var buttons = "";
    for (var idx=0; idx<Math.min(products.length,4); idx++) {
      var pr = products[idx];
      if (!pr || typeof pr!=="object" || !pr.name) continue;
      var adv = findAdv(ads, pr.store);
      if (!adv) {
        if ((pr.store||"").includes("amazon"))  adv={slug:"amazon",name:"Amazon",emoji:"🛒",color:"#e47911",active:true};
        else if ((pr.store||"").includes("rakuten")) adv={slug:"rakuten",name:"Rakuten",emoji:"🛍",color:"#bf0000",active:true,awin_mid:RAKUTEN_MID};
        else continue;
      }
      var prName = String(pr.name||"");
      var rawUrl = (pr.url && pr.url!=="null" && (pr.url||"").length>15) ? pr.url : null;
      // verified = un vrai lien produit validé par regex (donc issu de la recherche web)
      var verified = !!(validAmazonUrl(rawUrl) || validRakutenUrl(rawUrl));
      var url = buildLink(adv, prName.length>5?prName:recap, rawUrl);
      if (!url) continue;
      buttons += cardProd(prName, pr.price||"Voir prix", url, adv, pr.badge||null, verified);
    }

    var promoHtml="";
    for (var pi=0; pi<Math.min((promos||[]).length,2); pi++) {
      var c=promos[pi];
      if (c && typeof c==="object" && c.code) promoHtml += promoBox(c.code,c.store||"boutique",c.discount||"Reduction");
    }

    // Wishlist
    var wishHtml="";
    var first=products[0];
    if (first) {
      var wAdv=findAdv(ads,first.store)||{slug:"amazon",name:"Amazon",color:"#e47911",active:true};
      var wUrl=buildLink(wAdv,first.name||recap,first.url||null)||"";
      var wD=JSON.stringify({type:"product",name:first.name,price:first.price,store:first.store,url:wUrl}).replace(/"/g,"&quot;");
      wishHtml='<button onclick="addToWishlist('+wD+')" style="background:#fff;border:1.5px solid #e8edf8;color:#3b5bdb;border-radius:12px;padding:8px 16px;margin-top:10px;font-weight:700;font-size:12px;cursor:pointer;font-family:inherit;width:100%">♡ Ajouter a ma wishlist</button>';
    }

    // Cross-suggestions
    var sugs=getCross(recap);
    var crossHtml="";
    if (sugs.length) {
      crossHtml='<div style="margin-top:12px;padding-top:10px;border-top:1px solid #f0f4ff"><div style="font-size:11px;font-weight:700;color:#7c89a8;margin-bottom:6px">Tu pourrais aussi aimer :</div><div style="display:flex;gap:6px;flex-wrap:wrap">';
      for (var si=0;si<sugs.length;si++) {
        crossHtml+='<button onclick="send(\''+sugs[si].replace(/'/g,"\\'")+'\')" style="background:#f5f7ff;border:1.5px solid #e8edf8;color:#3b5bdb;border-radius:100px;padding:6px 14px;font-size:11px;font-weight:600;cursor:pointer;font-family:inherit">'+sugs[si]+'</button>';
      }
      crossHtml+='</div></div>';
    }

    var reply='<div style="font-size:13.5px;color:#1e293b;margin-bottom:8px;font-weight:500;line-height:1.5">'+summary+'</div>'
      +buttons
      +(promoHtml?'<div style="margin-top:4px">'+promoHtml+'</div>':"")
      +wishHtml+crossHtml;

    return new Response(JSON.stringify({reply:reply,sessionId:sid}),{headers:H});

  } catch(err) {
    console.error("Huntify chat error:",err&&err.message);
    return new Response(JSON.stringify({reply:'<div style="font-size:13px;color:#1e293b">Desole, probleme momentane. Reessayez !</div>'}),{status:200,headers:{"Content-Type":"application/json; charset=utf-8","Access-Control-Allow-Origin":"*"}});
  }
}
