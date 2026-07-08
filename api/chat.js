export const config = { runtime: 'edge' };

// ─────────────────────────────────────────────────────────────────────────────
// HUNTIFY — Mode Comparateur Produit (Amazon + Rakuten)
// Fichier autonome — aucun import externe
// Pipeline : Groq DeepSearch → Groq 70b → Gemini → Mistral → DeepSeek → Claude
// ─────────────────────────────────────────────────────────────────────────────

const SUPABASE_URL = "https://enocxbrqyybendertytl.supabase.co";
const SUPABASE_KEY = "sb_publishable_NmPh--frZG5HuqfaoxnemA_E7cidV9Y";
const MODEL        = "claude-haiku-4-5";
const MAX_Q        = 3;
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

function buildLink(adv, keywords, directUrl) {
  if (!adv||!adv.active) return null;
  const kw = cleanKw(keywords);
  if (adv.slug==="amazon") {
    const tag = adv.amazon_tag||AMAZON_TAG;
    // Validation ASIN strict : B + 9 chars alphanumériques
    const asinM = (directUrl||"").match(/\/dp\/([A-Z0-9]{10})(?:[/?]|$)/);
    const validAsin = asinM && /^B[A-Z0-9]{9}$/.test(asinM[1]);
    if (validAsin) return "https://www.amazon.fr/dp/"+asinM[1]+"?tag="+tag;
    return "https://www.amazon.fr/s?k="+encodeURIComponent(kw)+"&tag="+tag;
  }
  if (adv.slug==="rakuten") {
    const mid = adv.awin_mid||RAKUTEN_MID;
    const aff = adv.awin_affid||adv.awin_aff||AWIN_PUB;
    const dest = "https://fr.shopping.rakuten.com/s/"+encodeURIComponent(kw.replace(/\s+/g,"+"));
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

// ── APPELS IA ─────────────────────────────────────────────────────────────────
async function groq(sys, user, maxTok) {
  const key = process.env.GROQ_API_KEY; if (!key) return null;
  try {
    const r = await fetch("https://api.groq.com/openai/v1/chat/completions",{method:"POST",
      headers:{"Content-Type":"application/json","Authorization":"Bearer "+key},
      body:JSON.stringify({model:"llama-3.3-70b-versatile",max_tokens:maxTok||500,messages:[{role:"system",content:sys},{role:"user",content:user}]})});
    if (!r.ok) return null; const d=await r.json(); return d.choices&&d.choices[0]?d.choices[0].message.content:null;
  } catch(e){return null;}
}

async function groqDS(prompt, maxTok) {
  const key = process.env.GROQ_API_KEY; if (!key) return null;
  try {
    const r = await fetch("https://api.groq.com/openai/v1/chat/completions",{method:"POST",
      headers:{"Content-Type":"application/json","Authorization":"Bearer "+key},
      body:JSON.stringify({model:"compound-beta",max_tokens:maxTok||1200,messages:[{role:"user",content:prompt}]})});
    if (!r.ok) return await groq("Reponds en JSON.",prompt,maxTok||1200);
    const d=await r.json(); return d.choices&&d.choices[0]?d.choices[0].message.content:null;
  } catch(e){return await groq("Reponds en JSON.",prompt,maxTok||1200);}
}

async function gemini(prompt, maxTok) {
  const key = process.env.GEMINI_API_KEY; if (!key) return null;
  try {
    const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key="+key,{method:"POST",
      headers:{"Content-Type":"application/json"},body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{maxOutputTokens:maxTok||500}})});
    if (!r.ok) return null; const d=await r.json(); return d.candidates&&d.candidates[0]&&d.candidates[0].content?d.candidates[0].content.parts[0].text:null;
  } catch(e){return null;}
}

async function mistral(sys, user, maxTok) {
  const key = process.env.MISTRAL_API_KEY; if (!key) return null;
  try {
    const r = await fetch("https://api.mistral.ai/v1/chat/completions",{method:"POST",
      headers:{"Content-Type":"application/json","Authorization":"Bearer "+key},
      body:JSON.stringify({model:"mistral-small-latest",max_tokens:maxTok||500,messages:[{role:"system",content:sys},{role:"user",content:user}]})});
    if (!r.ok) return null; const d=await r.json(); return d.choices&&d.choices[0]?d.choices[0].message.content:null;
  } catch(e){return null;}
}

async function deepseek(sys, user, maxTok) {
  const key = process.env.DEEPSEEK_API_KEY; if (!key) return null;
  try {
    const r = await fetch("https://api.deepseek.com/v1/chat/completions",{method:"POST",
      headers:{"Content-Type":"application/json","Authorization":"Bearer "+key},
      body:JSON.stringify({model:"deepseek-chat",max_tokens:maxTok||500,messages:[{role:"system",content:sys},{role:"user",content:user}]})});
    if (!r.ok) return null; const d=await r.json(); return d.choices&&d.choices[0]?d.choices[0].message.content:null;
  } catch(e){return null;}
}

async function freeAI(sys, user, maxTok) {
  return await groq(sys,user,maxTok)||await gemini(sys+"\n\n"+user,maxTok)||await mistral(sys,user,maxTok)||await deepseek(sys,user,maxTok);
}

async function claude(sys, user, maxTok, tools) {
  const key = process.env.ANTHROPIC_API_KEY; if (!key) return null;
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages",{method:"POST",
      headers:{"Content-Type":"application/json; charset=utf-8","x-api-key":key,"anthropic-version":"2023-06-01"},
      body:JSON.stringify({model:MODEL,max_tokens:maxTok||800,tools:tools||[],system:sys,messages:[{role:"user",content:user}]})});
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

function detectCat(text) {
  if (!text) return "general";
  const t=text.toLowerCase();
  if (/fond de teint|mascara|parfum|creme|serum|maquillage|beaute|cosmetique/.test(t)) return "beaute";
  if (/casque|telephone|laptop|tablette|tv|console|electronique|gaming/.test(t)) return "electronique";
  if (/robe|veste|pantalon|chaussure|sneaker|jean|vetement|mode/.test(t)) return "mode";
  if (/cadeau|anniversaire|noel|mariage|naissance|offrir/.test(t)) return "cadeau";
  if (/sport|running|velo|yoga|fitness|snorkeling|plongee|masque|piscine/.test(t)) return "sport";
  return "general";
}

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
function cardProd(name, price, url, adv, badge) {
  const pill='<span style="background:rgba(255,255,255,.2);border-radius:100px;padding:2px 10px;font-size:10px;font-weight:800">'+(adv.emoji||"🛍")+" "+adv.name+"</span>";
  return '<a href="'+url+'" target="_blank" rel="sponsored noopener" style="display:flex;align-items:center;gap:12px;background:'+(adv.color||"#2f54ff")+';color:#fff;text-decoration:none;border-radius:14px;padding:12px 14px;margin-top:8px">'
    +'<div style="flex:1;min-width:0"><div style="font-size:10px;margin-bottom:4px;opacity:.85">'+pill+(badge?" · "+badge:"")+"</div>"
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

    // ── ÉTAPE 1 : Groq comprend le besoin et extrait les mots-cles produit ─────
    // JAMAIS le message brut en recap. Groq traduit la phrase en mots-cles e-commerce.
    const qAsked = countQ(history);
    const cat    = detectCat(message+" "+hist);
    const budget = detectBudget(message)||detectBudget(hist);
    const hasProd= message.trim().split(/\s+/).length>=2 || cat!=="general";

    // Si premiere demande vague (1 seul mot, pas de categorie reconnue) → 1 question
    if (!hasProd && qAsked===0 && !budget && history.length===0) {
      return new Response(JSON.stringify({reply:'<div style="font-size:13.5px;color:#1e293b;line-height:1.6;padding:4px 0">Dis-moi ce que tu cherches ! Par exemple: casque audio, mascara waterproof, airfryer... 🛍</div>',sessionId:sid}),{headers:H});
    }

    // Groq transforme la phrase naturelle en mots-cles produit
    const allUserMsgs = history.filter(m=>m.role==="user").map(m=>m.content||"").join(" ")+" "+message;
    let recap;

    const extractPrompt = 'Extrait le PRODUIT recherche de ces messages. Retourne des mots-cles e-commerce concrets.\n'
      +'JAMAIS la phrase brute du client. TOUJOURS un nom de produit/categorie clair.\n'
      +'Si un budget est mentionne, inclus-le.\n'
      +'Exemples:\n'
      +'"je veux vraiment respirer sous l eau" donne "masque snorkeling plongee"\n'
      +'"un truc pour courir" donne "chaussures running"\n'
      +'"masque de plongee pour respirer dans l eau budget 150 euros" donne "masque snorkeling plongee 150EUR"\n'
      +'"mascara" donne "mascara waterproof"\n'
      +'JSON: {recap:"mots-cles produit"}';

    const extractRaw = await freeAI(extractPrompt, allUserMsgs.trim(), 200);
    const extracted = parseJSON(extractRaw||"").recap;
    recap = extracted || cleanKw(allUserMsgs);

    if (budget && !(recap||"").includes("EUR") && !(recap||"").includes("€")) {
      recap = recap + " " + budget + "EUR";
    }

    // ── ÉTAPE 2 : Groq DeepSearch cherche les vrais produits ───────────────────
    const dbCtx = await dbLookup(recap);

    const searchPrompt = 'Agent shopping Huntify. Recherche MAINTENANT sur amazon.fr et fr.shopping.rakuten.com.\n'
      +'BESOIN CLIENT: '+recap+'\n'
      +(dbCtx?'Donnees internes: '+dbCtx+'\n':'')
      +'INSTRUCTIONS CRITIQUES:\n'
      +'1. Cherche les vrais produits disponibles sur amazon.fr\n'
      +'2. Le nom DOIT etre le VRAI NOM COMPLET (marque + modele exact) tel qu il apparait sur le site\n'
      +'   INTERDIT: noms generiques comme "Masque de snorkeling" ou "Casque audio"\n'
      +'   CORRECT: "Cressi F1 Masque Snorkeling", "Sony WH-1000XM5", "Philips Airfryer HD9252"\n'
      +'3. Pour Amazon: copie l URL exacte /dp/ASIN si tu la trouves. Sinon url=null\n'
      +'4. Pour Rakuten: 1 produit avec vrai nom sur fr.shopping.rakuten.com\n'
      +'5. Prix: le vrai prix trouve sur le site\n'
      +'JSON: {summary:"1 phrase courte", products:[{name:"VRAI NOM",price:"XX EUR",store:"amazon",keywords:"VRAI NOM",url:"URL ou null",badge:"Top vente"}], promoCodes:[]}\n'
      +'MINIMUM: 2 produits Amazon + 1 Rakuten. JSON UNIQUEMENT.';

    let raw = await groqDS(searchPrompt, 1200);
    let products = parseJSON(raw||"").products||[];
    let summary  = parseJSON(raw||"").summary||"";
    let promos   = parseJSON(raw||"").promoCodes||[];

    // ── ÉTAPE 3 : Si ASINs invalides → Claude corrige ──────────────────────────
    const hasGoodAsin = products.some(p=>p.store==="amazon"&&(p.url||"").match(/\/dp\/B[A-Z0-9]{9}/));

    if (!hasGoodAsin && products.length > 0) {
      const claudeRaw = await claude(
        'Cherche sur amazon.fr les vrais produits. Retourne les URLs exactes /dp/ASIN.',
        'Cherche: '+recap+'. JSON: {products:[{name:"VRAI NOM",price:"XX EUR",store:"amazon",url:"https://www.amazon.fr/dp/ASIN",badge:"..."}]}',
        600,
        [{type:"web_search_20250305",name:"web_search",max_uses:2}]
      );
      const cp = parseJSON(claudeRaw||"").products||[];
      if (cp.some(p=>p.store==="amazon"&&(p.url||"").match(/\/dp\/B[A-Z0-9]{9}/))) {
        // Garde les produits Claude (meilleurs ASINs) + Rakuten de Groq
        products = [...cp.filter(p=>p.store==="amazon"), ...products.filter(p=>p.store==="rakuten")];
      }
    }

    // Si aucun resultat du tout → fallback Gemini/Mistral
    if (!products.length) {
      const fallback = await freeAI('Agent shopping. Reponds en JSON.', searchPrompt, 700);
      const fp = parseJSON(fallback||"");
      products = fp.products||[];
      summary  = fp.summary||summary;
    }

    // ── Garantit toujours Amazon + Rakuten ────────────────────────────────────
    if (!products.some(p=>(p.store||"").includes("amazon"))) {
      products.unshift({name:recap,price:"Voir prix",store:"amazon",keywords:recap,url:null,badge:"Bestseller"});
    }
    if (!products.some(p=>(p.store||"").includes("rakuten"))) {
      products.push({name:recap,price:"Voir prix",store:"rakuten",keywords:recap,url:null,badge:"Bon plan"});
    }

    if (!summary) summary = 'Voici mes selections pour vous :';

    // ── Construction HTML ─────────────────────────────────────────────────────
    var buttons = "";
    for (var idx=0; idx<Math.min(products.length,4); idx++) {
      var pr = products[idx];
      if (!pr.name) continue;
      var adv = findAdv(ads, pr.store);
      if (!adv) {
        if ((pr.store||"").includes("amazon"))  adv={slug:"amazon",name:"Amazon",emoji:"🛒",color:"#e47911",active:true};
        else if ((pr.store||"").includes("rakuten")) adv={slug:"rakuten",name:"Rakuten",emoji:"🛍",color:"#bf0000",active:true,awin_mid:RAKUTEN_MID};
        else continue;
      }
      var rawUrl=(pr.url&&pr.url!=="null"&&(pr.url||"").length>15)?pr.url:null;
      var url=buildLink(adv, pr.name.length>5?pr.name:(pr.keywords||pr.name), rawUrl);
      if (!url) continue;
      buttons += cardProd(pr.name, pr.price||"Voir prix", url, adv, pr.badge||null);
    }

    var promoHtml="";
    for (var pi=0; pi<Math.min((promos||[]).length,2); pi++) {
      var c=promos[pi];
      if (c.code) promoHtml += promoBox(c.code,c.store||"boutique",c.discount||"Reduction");
    }

    // Wishlist
    var wishHtml="";
    var first=products[0];
    if (first) {
      var wAdv=findAdv(ads,first.store)||{slug:"amazon",name:"Amazon",color:"#e47911",active:true};
      var wUrl=buildLink(wAdv,first.keywords||first.name,first.url||null)||"";
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
