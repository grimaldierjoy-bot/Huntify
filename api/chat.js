export const config = { runtime: 'edge' };

import {
  sbFetch, getAdvertisers, buildLink, findAdv,
  callGroq, callGroqSearch, callGemini, callMistral, callDeepseek, callFreeAI, hasFreeAI,
  callClaude, parseJSON, buildHistory, queryInternalDB, buildDBContext,
  productCard, promoBox, priceHistBox
} from './_shared.js';

const MAX_Q = 3;

function countQ(history) {
  return (history||[]).filter(m=>m.role!=='user'&&(m.content||'').includes('data-qbox')).length;
}

function getCrossSuggestions(recap) {
  const r = (recap||'').toLowerCase();
  const map = {
    'fond de teint':['éponge maquillage beautyblender','primer teint'],
    'casque':['housse transport casque','coussinets rechange'],
    'telephone':['coque protection','verre trempé écran'],
    'laptop':['housse laptop','souris sans fil'],
    'sneakers':['semelles confort','spray imperméabilisant'],
    'parfum':['coffret miniatures','atomiseur voyage'],
    'robe':['sac de soirée','bijoux fantaisie'],
    'masque':['palmes', 'tuba', 'sac étanche'],
    'snorkeling':['palmes réglables','sac étanche plage'],
  };
  for (const [k,v] of Object.entries(map)) if (r.includes(k)) return v;
  return [];
}

async function getAutoCoupons(store) {
  try {
    const p = await sbFetch(`promo_codes?valid=eq.true&store=eq.${encodeURIComponent(store)}&order=found_at.desc&limit=2`);
    return (p||[]).filter(x=>x.code);
  } catch(e) { return []; }
}

function detectBudget(text) {
  if (!text) return null;
  const p = [
    /(?:moins de|maxi|maximum|budget|environ|max)[^\d]*(\d+)\s*(?:€|euros?)/i,
    /(\d+)\s*(?:€|euros?)\s*(?:max|maxi|maximum|environ|budget)/i,
    /budget[^\d]*(\d+)/i,
    /(\d{2,})\s*€/,
  ];
  for (const r of p) { const m=text.match(r); if(m){const b=parseInt(m[1]);if(b>0&&b<100000)return b;} }
  return null;
}

function estimateROI(budget, message, hist) {
  let score = 0;
  const msg = (message+' '+(hist||'')).toLowerCase();
  if (budget===null) score+=2;
  else if (budget<30) score+=0;
  else if (budget<80) score+=1;
  else if (budget<200) score+=3;
  else if (budget<500) score+=5;
  else score+=8;
  if (/urgent|maintenant|aujourd'hui|vite|demain/i.test(msg)) score+=2;
  if (/famille|couple|enfants?|pour \d|groupe/i.test(msg)) score+=2;
  if (/cadeau|offrir|anniversaire|noel|mariage/i.test(msg)) score+=2;
  if (/premium|luxe|meilleur|haut de gamme|pas de budget/i.test(msg)) score+=3;
  return { score, depth: score>=6?'deep':score>=3?'medium':'light', useWebSearch: score>=6 };
}

function detectCategory(text) {
  if (!text) return 'general';
  const t = text.toLowerCase();
  if (/fond de teint|mascara|parfum|creme|serum|maquillage|beaute|cosmetique/.test(t)) return 'beaute';
  if (/casque|telephone|laptop|tablette|tv|console|electronique|gaming/.test(t)) return 'electronique';
  if (/robe|veste|pantalon|chaussure|sneaker|jean|vetement|mode/.test(t)) return 'mode';
  if (/cadeau|anniversaire|noel|mariage|naissance|offrir/.test(t)) return 'cadeau';
  if (/sport|running|velo|yoga|fitness|musculation|snorkeling|plongee|masque/.test(t)) return 'sport';
  if (/voyage|hotel|vol|vacances|destination/.test(t)) return 'voyage';
  return 'general';
}

function analyzeConversation(history, message) {
  const exchanges = (history||[]).length;
  const histText  = (history||[]).map(m=>m.content||'').join(' ');
  const histCat   = detectCategory(histText);
  const curCat    = detectCategory(message);
  const topicChanged = histCat!=='general' && curCat!=='general' && histCat!==curCat;
  const deepConversation = exchanges >= 6;
  return { curCat, histCat, topicChanged, deepConversation, exchanges };
}

export default async function handler(req) {
  if (req.method==='OPTIONS') return new Response(null,{status:204,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type'}});
  if (req.method!=='POST')   return new Response('Method not allowed',{status:405});

  const H = {'Content-Type':'application/json; charset=utf-8','Access-Control-Allow-Origin':'*'};

  try {
    const { message, history, sessionId, userId, trackingEnabled } = await req.json();
    const sid = sessionId || `anon_${Date.now()}`;

    const advertisers = await getAdvertisers();
    const activeNames = advertisers.map(a=>a.name).join(', ');

    if (trackingEnabled) {
      Promise.all([
        sbFetch('searches','POST',{query:message,session_id:sid,user_id:userId||null}),
        sbFetch('trends','POST',{query:message.toLowerCase().trim(),count:1,last_searched:new Date().toISOString()})
      ]);
    }

    const hist = buildHistory(history);

    const qAsked = countQ(history);
    const conv   = analyzeConversation(history, message);

    if (conv.topicChanged && conv.exchanges >= 4) {
      const resetMsg = conv.curCat==='cadeau'
        ? "Nouveau sujet ! Pour un cadeau, dis-moi pour qui et quel budget tu as en tête ?"
        : conv.curCat==='beaute'
        ? "Nouveau sujet ! Pour ce produit beauté, tu cherches quelque chose de précis ?"
        : "Nouveau sujet ! Dis-moi ce que tu cherches et ton budget ?";
      return new Response(JSON.stringify({reply:`<div style="font-size:13.5px;color:#1e293b;line-height:1.6;padding:4px 0">${resetMsg}</div>`,sessionId:sid,resetContext:true}),{headers:H});
    }

    const hasBudget    = /\d+\s*€|\d+\s*euros?/i.test(message) || /\d+\s*€|\d+\s*euros?/i.test(hist);
    const hasPrecise   = message.trim().split(/\s+/).length >= 2;
    const productClear = hasPrecise || detectCategory(message) !== 'general';
    const mustSearch   = qAsked >= MAX_Q || productClear || hasBudget || (history||[]).length >= 2;

    let decision = { ready:mustSearch, question:null, recap:null, message:null };

    if (!mustSearch) {
      const p1sys = 'Tu es l assistant shopping Huntify. REGLE D OR: si tu comprends le produit recherche - ready:true IMMEDIATEMENT.\n'
        + 'Un nom de produit seul suffit (mascara, casque sony, masque snorkeling...). Le budget est optionnel.\n'
        + 'Pose une question UNIQUEMENT si la demande est vraiment incomprehensible.\n'
        + 'JAMAIS de question sur: type exact, couleur, caracteristiques techniques, marque precise.\n'
        + 'HISTORIQUE: ' + (hist||'Debut') + '\n'
        + 'Si ' + qAsked + ' >= 1 alors ready:true OBLIGATOIRE, on cherche avec ce qu on a.\n'
        + 'recap = le VRAI produit cherche, sous forme de mots-cles concrets pour une recherche e-commerce (PAS la phrase brute du client).\n'
        + 'Exemple: client dit "je veux vraiment respirer sous l eau" donc recap = "masque de plongee snorkeling tuba"\n'
        + 'Exemple: client dit "un truc pour courir" donc recap = "chaussures running"\n'
        + 'JSON: {ready:true,recap:"mots-cles produit concrets"} ou {ready:false,msg:"question tres courte"}';

      const t1 = await callFreeAI(p1sys, `HISTORIQUE:\n${hist||'Début'}\nMESSAGE: ${message}`, 'fast');
      if (t1) {
        const d = parseJSON(t1);
        decision.ready    = d.ready===true;
        decision.question = d.question || d.message || null;
        decision.recap    = d.recap || null;
        decision.message  = d.message || d.question || null;
      }

      if (!decision.ready && !decision.message && (history||[]).length === 0) {
        const cat = detectCategory(message);
        const q = cat==='beaute'     ? "Super ! Tu cherches quelque chose de précis (teinte, couvrance) ou je te trouve les mieux notés ? Et un budget ?"
                : cat==='electronique' ? "Pour quel usage ? Et tu as un budget en tête ?"
                : cat==='mode'       ? "Quel style et quelle taille ? Et un budget ?"
                : cat==='cadeau'     ? "C'est pour qui et quel budget ?"
                : "Tu peux m'en dire un peu plus ? Un budget ou des préférences ?";
        return new Response(JSON.stringify({reply:`<div style="font-size:13.5px;color:#1e293b;line-height:1.6;padding:4px 0">${q}</div>`,sessionId:sid}),{headers:H});
      }
    }

    if (!decision.ready && (decision.message || decision.question)) {
      return new Response(JSON.stringify({
        reply:`<div style="font-size:13.5px;color:#1e293b;line-height:1.6;padding:4px 0">${decision.message||decision.question}</div>`,
        sessionId:sid
      }),{headers:H});
    }

    let recap = decision.recap;

    if (!recap) {
      const allUserMsgs = (history||[]).filter(m=>m.role==='user').map(m=>m.content||'').join(' ');
      const rawText = (allUserMsgs ? allUserMsgs + ' ' + message : message).trim();

      const looksLikeKeywords = rawText.split(/\s+/).length <= 5 && !/^(je|j'|on|tu|vous|c'est|c est)/i.test(rawText.trim());

      if (looksLikeKeywords) {
        recap = rawText;
      } else {
        const extractSys = 'Extrait le PRODUIT recherche de cette phrase, sous forme de mots-cles concrets pour une recherche e-commerce.\n'
          + 'JAMAIS la phrase brute. TOUJOURS un nom de produit ou categorie clair.\n'
          + 'Exemples:\n'
          + '"je veux vraiment respirer sous l eau" donne "masque de plongee snorkeling tuba"\n'
          + '"un truc pour courir plus vite" donne "chaussures running performance"\n'
          + '"j ai besoin de me proteger du soleil" donne "creme solaire protection"\n'
          + 'JSON: {recap:"mots-cles produit"}';
        const extractRaw = await callFreeAI(extractSys, rawText, 'fast');
        const extracted = parseJSON(extractRaw||'').recap;
        recap = extracted || rawText;
      }
    }

    const budget = detectBudget(recap) || detectBudget(hist) || detectBudget(message);
    const roi    = estimateROI(budget, message, hist);

    const hasPrev  = (history||[]).some(m=>m.role!=='user'&&/\d+€/.test(m.content||''));
    const isFirst  = !hasPrev;
    const deepConv = conv.deepConversation && !conv.topicChanged;

    const strategy = ((isFirst && roi.score>=3) || roi.score>=6 || deepConv) ? 'paid_deep'
                   : roi.depth==='medium' ? 'groq_search'
                   : 'free_fast';
    const effective = (!hasFreeAI() && strategy!=='paid_deep') ? 'paid_deep' : strategy;

    const dbData    = await queryInternalDB(recap);
    const dbContext = buildDBContext(dbData);

    let products=[], promoCodes=[], summary='';

    if (effective === 'groq_search') {
      const groqPrompt = 'Agent shopping Huntify. Recherche MAINTENANT sur amazon.fr et fr.shopping.rakuten.com.\n'
        + 'BESOIN CLIENT: ' + recap + '\n'
        + (dbContext ? dbContext + '\n' : '')
        + 'INSTRUCTIONS CRITIQUES:\n'
        + '1. Va sur amazon.fr et cherche des vrais produits correspondants\n'
        + '2. Le nom du produit DOIT etre le vrai nom complet (marque + modele exact) tel qu il apparait sur le site\n'
        + '   JAMAIS de noms generiques comme "Masque de snorkeling" ou "Casque audio" seuls\n'
        + '   TOUJOURS: "Decathlon Easybreath 500", "Sony WH-1000XM5", "Cressi F1 Masque"\n'
        + '3. Pour Amazon: trouve l URL exacte /dp/ASIN si possible\n'
        + '4. Pour Rakuten: trouve le meme type de produit sur fr.shopping.rakuten.com\n'
        + '5. Prix: le vrai prix trouve sur le site (pas une estimation)\n'
        + 'JSON: {summary:"1 phrase", products:[{name:"VRAI NOM MARQUE MODELE",price:"XX€",store:"amazon",keywords:"VRAI NOM",url:"https://amazon.fr/dp/ASIN ou null",badge:"Top vente"}], promoCodes:[]}\n'
        + 'MINIMUM: 2 produits Amazon + 1 Rakuten. JSON UNIQUEMENT.';
      const raw = await callGroqSearch(groqPrompt, 1200);
      const p   = parseJSON(raw || '');
      products  = p.products || [];
      promoCodes= p.promoCodes || [];
      summary   = p.summary || '';
    }
    else if (effective === 'paid_deep') {
      const p2sys = 'Agent shopping Huntify. Cherche sur Amazon.fr et Rakuten.fr.\n'
        + 'BESOIN: ' + recap + '\n'
        + (dbContext ? dbContext + '\n' : '')
        + 'REGLE ABSOLUE sur les noms: le champ name doit etre le VRAI NOM COMPLET du produit tel qu il apparait sur le site.\n'
        + 'Exemples corrects: "Sony WH-1000XM5 Casque Bluetooth", "Cressi F1 Masque Snorkeling", "Philips Airfryer XXL HD9630"\n'
        + 'Exemples INTERDITS: "Casque audio", "Masque de plongee", "Airfryer pas cher"\n'
        + '1. AMAZON.FR: 2 produits avec vrais noms + ASIN dans URL /dp/ASIN si trouve\n'
        + '2. RAKUTEN.FR: 1 produit avec vrai nom\n'
        + '3. CODES PROMO: dealabs.com si dispo\n'
        + 'JSON: {summary:"phrase courte", products:[{name:"VRAI NOM",price:"XX€",store:"amazon",keywords:"VRAI NOM",url:"https://amazon.fr/dp/ASIN",badge:"..."}], promoCodes:[]}';
      const raw = await callClaude(p2sys, `BESOIN: ${recap}\nMESSAGE: ${message}`, 800,
        [{type:"web_search_20250305",name:"web_search",max_uses:3}]);
      const p   = parseJSON(raw);
      products  = p.products  || [];
      promoCodes= p.promoCodes|| [];
      summary   = p.summary   || '';
    }
    else {
      const p2sys = 'Agent shopping Huntify. Boutiques: ' + activeNames + '.\n'
        + 'BESOIN: ' + recap + '\n'
        + (dbContext ? dbContext + '\n' : '')
        + 'IMPORTANT: name = VRAI NOM COMPLET (marque + modele exact). Jamais de nom generique.\n'
        + 'Ex: "Sony WH-1000XM5" pas "Casque audio". "Cressi F1" pas "Masque snorkeling".\n'
        + '2 produits Amazon + 1 Rakuten. JSON: {summary, products:[{name,price,store,keywords,url,badge}], promoCodes:[]}';
      const raw = await callFreeAI(p2sys, `BESOIN: ${recap}`, 'fast');
      const p   = parseJSON(raw || '');
      products  = p.products  || [];
      promoCodes= p.promoCodes|| [];
      summary   = p.summary   || '';
    }

    if (!products.length) {
      products = advertisers.slice(0,2).map(a=>({
        name:recap, price:'Voir prix', store:a.slug,
        keywords:recap, url:null, img:null, badge:null
      }));
      summary = `Résultats pour "${recap}" :`;
    }

    let priceHistHtml = '';
    const main = products.find(p=>p.store==='amazon');
    if (main?.price && !main.price.includes('Voir')) {
      const cur  = parseFloat(main.price.replace(/[^0-9.,]/g,'').replace(',','.'));
      const slug = main.name.toLowerCase().replace(/\s+/g,'-').slice(0,50);
      const ph   = await sbFetch(`price_history?product_id=eq.${slug}&order=checked_at.desc&limit=10`) || [];
      if (ph.length>1 && !isNaN(cur)) {
        const old   = ph[ph.length-1].price;
        const trend = cur<old*0.97?'down':cur>old*1.03?'up':'stable';
        priceHistHtml = priceHistBox(old, trend);
      }
      if (!isNaN(cur)) sbFetch('price_history','POST',{product_id:slug,product_name:main.name,price:cur,store:'amazon',url:main.url||null});
    }

    let buttons = '';
    for (const pr of products) {
      if (!pr.name) continue;
      const adv = findAdv(advertisers, pr.store);
      if (!adv) continue;
      const rawUrl = (pr.url && pr.url !== 'null' && pr.url.length > 15) ? pr.url : null;
      const terms  = (pr.name && pr.name.length > 5) ? pr.name : (pr.keywords || pr.name);
      const url    = buildLink(adv, terms, rawUrl);
      if (!url) continue;
      buttons += productCard(pr.name, pr.price||'Voir prix', url, adv, pr.img||null, pr.badge||null);
    }

    let promos = '';
    for (const c of (promoCodes||[]).filter(c=>c.code).sort((a,b)=>(b.best?1:0)-(a.best?1:0)).slice(0,2)) {
      promos += promoBox(c.code, c.store||'boutique', c.discount||'Réduction', c.best||false);
      sbFetch('promo_codes','POST',{code:c.code,store:c.store||'unknown',discount:c.discount||'',product_query:recap,found_at:new Date().toISOString(),valid:true});
    }

    let dbPromos = '';
    for (const adv of advertisers) {
      const cpns = await getAutoCoupons(adv.slug);
      for (const c of cpns) {
        if (!(promoCodes||[]).find(p=>p.code===c.code))
          dbPromos += promoBox(c.code, c.store||adv.name, c.discount||'Réduction', false);
      }
    }

    const first = products[0];
    const adv0  = first ? findAdv(advertisers, first.store) : null;
    const wish  = first && adv0
      ? `<button onclick="addToWishlist(${JSON.stringify({type:'product',name:first.name,price:first.price,store:first.store,url:buildLink(adv0,first.keywords||first.name,first.url||null)}).replace(/"/g,'&quot;')})" style="background:#fff;border:1.5px solid #e8edf8;color:#3b5bdb;border-radius:12px;padding:8px 16px;margin-top:10px;font-weight:700;font-size:12px;cursor:pointer;font-family:inherit;width:100%">♡ Ajouter à ma wishlist</button>`
      : '';

    const sugs  = getCrossSuggestions(recap);
    const cross = sugs.length
      ? `<div style="margin-top:12px;padding-top:10px;border-top:1px solid #f0f4ff">
          <div style="font-size:11px;font-weight:700;color:#7c89a8;margin-bottom:6px">Tu pourrais aussi aimer :</div>
          <div style="display:flex;gap:6px;flex-wrap:wrap">${sugs.map(s=>`<button onclick="send('${s.replace(/'/g,"\\'")}')" style="background:#f5f7ff;border:1.5px solid #e8edf8;color:#3b5bdb;border-radius:100px;padding:6px 14px;font-size:11px;font-weight:600;cursor:pointer;font-family:inherit">${s}</button>`).join('')}</div>
        </div>`
      : '';

    const reply =
      `<div style="font-size:13.5px;color:#1e293b;margin-bottom:8px;font-weight:500;line-height:1.5">${decision.message||summary}</div>`
      + priceHistHtml + buttons
      + (promos   ? `<div style="margin-top:4px">${promos}</div>`   : '')
      + (dbPromos ? `<div style="margin-top:4px">${dbPromos}</div>` : '')
      + wish + cross;

    return new Response(JSON.stringify({reply, sessionId:sid}), {headers:H});

  } catch(err) {
    console.error('Huntify chat error:', err.message);
    return new Response(
      JSON.stringify({reply:"Désolé, problème technique momentané. Réessayez !"}),
      {status:200, headers:{'Content-Type':'application/json; charset=utf-8','Access-Control-Allow-Origin':'*'}}
    );
  }
}
