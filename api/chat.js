export const config = { runtime: 'edge' };

const SUPABASE_URL = "https://enocxbrqyybendertytl.supabase.co";
const SUPABASE_KEY = "sb_publishable_NmPh--frZG5HuqfaoxnemA_E7cidV9Y";

// âš¡ OPTIM : modÃ¨le centralisÃ© + plafond questions de ciblage
const MODEL = 'claude-haiku-4-5';
const MAX_TARGETING_QUESTIONS = 5;

async function getAdvertisers() {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/advertisers?active=eq.true`, {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
    });
    return await r.json();
  } catch(e) { return []; }
}

// âš¡ FIX RAKUTEN : nettoie les keywords pour une recherche e-commerce valide.
// L'agent renvoie parfois "satin, longue, trapÃ¨ze, style classique" (liste
// d'adjectifs) -> page de rÃ©sultats vide. On retire virgules et mots vides,
// et on limite Ã  4-5 termes utiles.
function cleanKeywords(kw) {
  if (!kw) return '';
  const stop = new Set(['style','classique','de','la','le','les','un','une','des','pour','avec','et','en','du','au','aux','trÃ¨s','plus','moins']);
  return kw
    .replace(/,/g, ' ')                 // virgules -> espaces
    .replace(/\s+/g, ' ')               // espaces multiples
    .trim()
    .split(' ')
    .filter(w => w.length > 1 && !stop.has(w.toLowerCase()))
    .slice(0, 5)                        // max 5 termes
    .join(' ');
}

function buildAffiliateLink(adv, keywords, directUrl=null) {
  if (!adv?.active) return null;
  const kw = cleanKeywords(keywords); // âš¡ FIX : keywords nettoyÃ©s
  if (adv.slug === 'amazon') {
    const base = directUrl && directUrl.includes('amazon.fr') ? directUrl : `https://www.amazon.fr/s?k=${encodeURIComponent(kw)}`;
    return `${base}${base.includes('?')?'&':'?'}tag=${adv.amazon_tag}`;
  }
  if (adv.awin_mid) {
    // âš¡ FIX 404 : on n'utilise JAMAIS l'URL directe Rakuten (hallucinations IA -> 404).
    // On construit toujours le lien de recherche depuis search_url.
    const dest = adv.search_url.replace('{keywords}', encodeURIComponent(kw));
    return `https://www.awin1.com/cread.php?awinmid=${adv.awin_mid}&awinaffid=${adv.awin_aff}&ued=${encodeURIComponent(dest)}`;
  }
  return null;
}

function findAdvertiser(advertisers, slug) {
  return advertisers.find(a => a.slug === slug?.toLowerCase()) || null;
}

async function sbFetch(path, method='GET', body=null) {
  const opts = { method, headers:{'Content-Type':'application/json','apikey':SUPABASE_KEY,'Authorization':`Bearer ${SUPABASE_KEY}`} };
  if (body) opts.body = JSON.stringify(body);
  try { const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, opts); return await r.json(); } catch(e) { return null; }
}

// âš¡ GARDE-FOU anti-double-clic (Edge-safe via Supabase).
// Hash lÃ©ger du message (pas de crypto async en Edge â†’ simple djb2).
function hashMsg(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
// Tente de poser un verrou. Retourne true si OK (1Ã¨re fois), false si doublon (<10s).
async function acquireLock(sessionId, message) {
  const key = `${sessionId}:${hashMsg((message||'').trim().toLowerCase())}`;
  const cutoff = new Date(Date.now() - 10_000).toISOString(); // fenÃªtre 10s
  try {
    // 1) un verrou rÃ©cent existe dÃ©jÃ  ? â†’ doublon
    const existing = await fetch(
      `${SUPABASE_URL}/rest/v1/request_locks?lock_key=eq.${encodeURIComponent(key)}&created_at=gt.${encodeURIComponent(cutoff)}&select=lock_key`,
      { headers:{'apikey':SUPABASE_KEY,'Authorization':`Bearer ${SUPABASE_KEY}`} }
    ).then(r => r.json()).catch(() => []);
    if (Array.isArray(existing) && existing.length > 0) return false;

    // 2) tente d'insÃ©rer (PK unique). Conflit 409 = doublon simultanÃ©.
    const ins = await fetch(`${SUPABASE_URL}/rest/v1/request_locks`, {
      method: 'POST',
      headers: {'Content-Type':'application/json','apikey':SUPABASE_KEY,'Authorization':`Bearer ${SUPABASE_KEY}`,'Prefer':'resolution=ignore-duplicates'},
      body: JSON.stringify({ lock_key: key, created_at: new Date().toISOString() })
    });
    // 409 = la clÃ© existait dÃ©jÃ  (double-clic exact simultanÃ©)
    if (ins.status === 409) return false;
    return true;
  } catch(e) {
    // En cas d'erreur du verrou, on NE bloque pas l'utilisateur (fail-open)
    return true;
  }
}

function productCard(name, price, url, color, emoji, img, badge) {
  const imgHtml = img ? `<img src="${img}" style="width:60px;height:60px;object-fit:cover;border-radius:8px;flex-shrink:0" onerror="this.style.display='none'">` : '';
  const badgeHtml = badge ? `<span style="background:rgba(255,255,255,.25);border-radius:100px;padding:2px 8px;font-size:10px;font-weight:700">${badge}</span>` : '';
  return `<a href="${url}" target="_blank" style="display:flex;align-items:center;gap:12px;background:${color};color:#fff;text-decoration:none;border-radius:14px;padding:12px 14px;margin-top:8px;font-weight:700;font-size:13px">
    ${imgHtml}
    <div style="flex:1;min-width:0">
      <div style="font-size:11px;opacity:.8;margin-bottom:2px">${emoji} ${badgeHtml}</div>
      <div style="font-size:13px;font-weight:800;line-height:1.3;word-break:break-word">${name}</div>
    </div>
    <span style="background:rgba(255,255,255,.25);border-radius:8px;padding:5px 10px;white-space:nowrap;font-size:14px;font-weight:900;flex-shrink:0">${price}</span>
  </a>`;
}

function promoBox(code, store, desc, best) {
  const border = best ? '2px solid #16a34a' : '1.5px solid #86efac';
  const bg = best ? '#dcfce7' : '#f0fdf4';
  return `<div style="background:${bg};border:${border};border-radius:12px;padding:10px 14px;margin-top:6px;display:flex;align-items:center;justify-content:space-between;gap:8px">
    <div>
      <span style="font-size:11px;color:#16a34a;font-weight:700">${best?'â­ MEILLEUR â€” ':''}ðŸ·ï¸ ${store}</span>
      <div style="font-size:12px;color:#166534;font-weight:600">${desc}</div>
    </div>
    <div onclick="navigator.clipboard.writeText('${code}');this.innerHTML='âœ“';setTimeout(()=>this.innerHTML='${code}',2000)" style="background:#16a34a;color:#fff;border-radius:8px;padding:6px 10px;font-weight:800;font-size:12px;cursor:pointer;white-space:nowrap;flex-shrink:0">${code}</div>
  </div>`;
}

function priceHistoryBox(old, trend) {
  const icon = trend==='down'?'ðŸ“‰':trend==='up'?'ðŸ“ˆ':'âž¡ï¸';
  const color = trend==='down'?'#dcfce7':trend==='up'?'#fee2e2':'#f1f5f9';
  const border = trend==='down'?'#86efac':trend==='up'?'#fca5a5':'#e2e8f0';
  const msg = trend==='down'?`Prix en baisse ! Ã‰tait Ã  ${old} âœ…`:trend==='up'?`âš ï¸ Prix gonflÃ© ! Ã‰tait Ã  ${old}`:`Prix stable`;
  return `<div style="background:${color};border:1.5px solid ${border};border-radius:12px;padding:10px 14px;margin-top:8px;font-size:12px;font-weight:600;color:#374151">${icon} ${msg}</div>`;
}

function questionBox(question) {
  // âš¡ OPTIM : data-qbox sert au comptage serveur des questions dÃ©jÃ  posÃ©es
  return `<div data-qbox="1" style="background:#eff6ff;border:1.5px solid #bfdbfe;border-radius:12px;padding:12px 14px;margin-top:8px;font-size:13px;color:#1e40af;font-weight:600">ðŸ’¬ ${question}</div>`;
}

// âš¡ OPTIM : rÃ©cap de ce que l'agent a compris, juste avant la recherche
function recapBox(recap) {
  return `<div style="background:#f5f3ff;border:1.5px solid #ddd6fe;border-radius:12px;padding:10px 14px;margin-top:8px;font-size:12px;color:#5b21b6;font-weight:600">ðŸ”Ž ${recap}</div>`;
}

// âš¡ OPTIM : compte les questions de ciblage dÃ©jÃ  posÃ©es dans l'historique
function countQuestionsAsked(history) {
  return (history||[]).filter(m => m.role !== 'user' && (m.content||'').includes('data-qbox')).length;
}

// âš¡ OPTIM : extrait le bloc JSON de la rÃ©ponse de faÃ§on robuste
function parseAgentJSON(rawText) {
  try {
    const match = rawText.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
  } catch(e) {}
  return {};
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status:204, headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type'} });
  if (req.method !== 'POST') return new Response('Method not allowed', { status:405 });

  try {
    const { message, history, sessionId, userId, trackingEnabled } = await req.json();
    const sid = sessionId || `anon_${Date.now()}`;

    // âš¡ GARDE-FOU : rejette les doublons (double-clic / renvoi) avant tout appel payant.
    // Fail-open : si le verrou Ã©choue techniquement, on laisse passer.
    const ok = await acquireLock(sid, message);
    if (!ok) {
      return new Response(JSON.stringify({
        reply: '', duplicate: true, sessionId: sid
      }), { headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'} });
    }

    const [advertisers, trends] = await Promise.all([
      getAdvertisers(),
      sbFetch('trends?order=count.desc&limit=5')
    ]);

    if (trackingEnabled) {
      Promise.all([
        sbFetch('searches','POST',{query:message,session_id:sid,user_id:userId||null}),
        sbFetch('trends','POST',{query:message.toLowerCase().trim(),count:1,last_searched:new Date().toISOString()})
      ]);
    }

    const activeNames = advertisers.map(a=>a.name).join(', ');

    // âš¡ FIX HISTORIQUE : on reconstruit un dialogue propre depuis tout l'historique.
    // On ne tronque plus Ã  150/300 chars â€” une rÃ©ponse coupÃ©e = question reposÃ©e.
    // On garde tous les tours (l'historique entier est envoyÃ© depuis le front).
    const histSummary = (history||[]).map(m => {
      const role = m.role==='user' ? 'Client' : 'Agent';
      // Nettoyer le HTML (questionBox, productCard, etc.) pour garder juste le texte
      const text = (m.content||'')
        .replace(/<[^>]*>/g,' ')   // balises -> espaces
        .replace(/&[^;]+;/g,' ')   // entitÃ©s HTML (&quot; etc.)
        .replace(/\s+/g,' ')
        .trim()
        .slice(0,400);               // 400 chars par message, suffisant sans couper
      if (!text) return null;
      return `${role}: ${text}`;
    }).filter(Boolean).join('\n').slice(0,2000);

    // âš¡ OPTIM : combien de questions de ciblage dÃ©jÃ  posÃ©es ?
    const questionsAsked = countQuestionsAsked(history);
    // âš¡ OPTIM : bypass phase 1 si la demande est DÃ‰JÃ€ prÃ©cise.
    // Ã‰vite le surcoÃ»t (~5%) d'un appel de ciblage inutile sur une requÃªte one-shot
    // type "iPhone 15 128Go noir" ou "casque Sony WH-1000XM5 moins de 300â‚¬".
    // Heuristique lÃ©gÃ¨re et gratuite (aucun token) : longueur + signaux de prÃ©cision.
    const msgLower = (message||'').toLowerCase();
    const precisionSignals = /\b(\d{2,})\s?(â‚¬|euro|eur|go|gb|to|cm|mm|"|pouces?|w|watts?)\b|moins de|budget|taille|modÃ¨le|rÃ©f|noir|blanc|bleu|rouge|vert|\b(s|m|l|xl|xxl)\b/i;
    const looksPrecise = (message||'').trim().split(/\s+/).length >= 4 && precisionSignals.test(message||'');
    const hasHistory = (history||[]).length > 0;
    // On cherche direct si : plafond atteint, OU 1er message dÃ©jÃ  prÃ©cis (pas d'historique).
    const mustSearchNow = questionsAsked >= MAX_TARGETING_QUESTIONS || (!hasHistory && looksPrecise);

    // ===================================================================
    // âš¡ PHASE 1 â€” CIBLAGE (sans web search, appel lÃ©ger & peu coÃ»teux)
    // On ne paie le web search QUE quand on est prÃªt Ã  chercher.
    // ===================================================================
    let decision = { ready: mustSearchNow, question: null, recap: null };

    if (!mustSearchNow) {
      const phase1Resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {'Content-Type':'application/json','x-api-key':process.env.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01'},
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 250, // âš¡ OPTIM : dÃ©cision courte, pas de produits ici
          system: [{
            type: 'text',
            // âš¡ OPTIM : partie stable du prompt â†’ mise en cache (payÃ©e 1x puis 10%)
            text: `Tu es l'agent shopping IA de Huntify. Ta SEULE tÃ¢che : dÃ©cider si tu as assez d'infos pour chercher, ou poser UNE question.

RÃˆGLES ABSOLUES :
1. LIS L'HISTORIQUE COMPLET avant tout. Si une info y est dÃ©jÃ  (budget, usage, taille, marque...), NE LA REDEMANDE PAS.
2. Identifie ce qui manque encore parmi : catÃ©gorie prÃ©cise, budget, usage/critÃ¨res.
3. Si tout est clair OU si tu as dÃ©jÃ  posÃ© ${MAX_TARGETING_QUESTIONS} questions â†’ rÃ©ponds ready:true.
4. Sinon â†’ pose UNE seule question sur CE QUI MANQUE VRAIMENT (pas ce qui est dÃ©jÃ  rÃ©pondu).

ERREUR INTERDITE : reposer une question dont la rÃ©ponse est dÃ©jÃ  dans l'historique.

RÃ©ponds en JSON UNIQUEMENT :
- Question nÃ©cessaire : {"ready":false,"question":"ta question sur ce qui manque"}
- PrÃªt Ã  chercher : {"ready":true,"recap":"Je cherche X, budget Y, critÃ¨res Z (rÃ©sume TOUT ce que tu sais)"}`,
            cache_control: { type: 'ephemeral' }
          }],
          messages: [{
            role: 'user',
            content: `HISTORIQUE RÃ‰CENT:\n${histSummary || 'DÃ©but de conversation'}\n\nQuestions dÃ©jÃ  posÃ©es: ${questionsAsked}/${MAX_TARGETING_QUESTIONS}\n\nNOUVEAU MESSAGE CLIENT: ${message}`
          }]
        })
      });

      const phase1Data = await phase1Resp.json();
      if (phase1Resp.ok) {
        let t1 = '';
        for (const b of phase1Data.content) { if (b.type==='text') t1 += b.text; }
        const d = parseAgentJSON(t1);
        decision.ready = d.ready === true;
        decision.question = d.question || null;
        decision.recap = d.recap || null;
      } else {
        // En cas d'Ã©chec phase 1, on bascule en recherche pour ne pas bloquer
        decision.ready = true;
      }
    }

    // L'agent veut une info de plus â†’ on s'arrÃªte lÃ  (aucun web search facturÃ©)
    if (!decision.ready && decision.question) {
      return new Response(JSON.stringify({
        reply: questionBox(decision.question),
        sessionId: sid
      }), { headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'} });
    }

    // ===================================================================
    // âš¡ PHASE 2 â€” RECHERCHE (web search dÃ©clenchÃ© UNE seule fois)
    // ===================================================================
    const recapText = decision.recap || `Je cherche : ${message}`;

    const agentResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {'Content-Type':'application/json','x-api-key':process.env.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01'},
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 600, // âš¡ OPTIM : 800 â†’ 600, le JSON tient largement
        // âš¡ OPTIM : max_uses:1 â€” une seule recherche ~14,6k tokens, reste loin
        // sous le plafond 50k/min du tier 1. La phase 1 ayant dÃ©jÃ  ciblÃ© le besoin,
        // une recherche prÃ©cise suffit (passer Ã  2 risque de frÃ´ler la limite).
        tools: [{ type:"web_search_20250305", name:"web_search", max_uses: 1 }],
        system: [{
          type: 'text',
          // âš¡ OPTIM : system stable â†’ cachÃ©. Seul le message user change.
          text: `Tu es l'agent shopping IA de Huntify. Boutiques : ${activeNames}.

TA TÃ‚CHE :
1. CHERCHER EN LIVE â€” fais 1-2 recherches web sur Amazon.fr ET Rakuten pour trouver des produits RÃ‰ELS avec prix EXACTS et URLs DIRECTES.
2. CODES PROMOS â€” cherche sur dealabs.com, note le meilleur avec â­.
3. CONTEXTE â€” utilise l'historique pour affiner (si "moins cher" â†’ cherche moins cher que proposÃ© avant).

RÃˆGLES :
- Max 2 produits Amazon + 1 Rakuten
- Max 2 codes promos
- Prix exacts, URLs directes quand possible
- "keywords" = terme de recherche e-commerce SIMPLE qui retourne des rÃ©sultats. TOUJOURS commencer par le TYPE de produit (ex: "robe satin longue", "casque sans fil bluetooth"). JAMAIS une liste d'adjectifs sÃ©parÃ©s par des virgules (ex INTERDIT: "satin, longue, trapÃ¨ze, classique"). Max 4-5 mots.
- "url" : ne mets une URL QUE si tu es certain qu'elle existe vraiment. Sinon laisse null (le lien de recherche sera construit automatiquement).

JSON UNIQUEMENT :
{"summary":"1 phrase","products":[{"name":"nom","price":"XXâ‚¬","store":"amazon","keywords":"mots","url":"url ou null","img":null,"badge":null},{"name":"nom","price":"DÃ¨s XXâ‚¬","store":"rakuten","keywords":"mots","url":"url ou null","img":null,"badge":null}],"promoCodes":[{"code":"CODE","store":"boutique","discount":"-XX%","best":true}]}`,
          cache_control: { type: 'ephemeral' }
        }],
        messages: [{
          role: 'user',
          content: `HISTORIQUE:\n${histSummary || 'DÃ©but'}\n\nBESOIN CIBLÃ‰: ${recapText}\n\nMESSAGE: ${message}`
        }]
      })
    });

    const agentData = await agentResp.json();
    if (!agentResp.ok) throw new Error(agentData.error?.message || 'Agent error');

    let rawText = '';
    for (const b of agentData.content) { if (b.type==='text') rawText += b.text; }

    const p = parseAgentJSON(rawText);
    let products   = p.products    || [];
    let promoCodes = p.promoCodes  || [];
    let summary    = p.summary     || '';

    if (!products.length) {
      products = advertisers.slice(0,2).map(a=>({name:message,price:'Voir prix',store:a.slug,keywords:message,url:null,img:null,badge:null}));
      summary = `RÃ©sultats pour "${message}" :`;
    }

    // Historique prix
    let priceHistoryHtml = '';
    const mainProduct = products.find(p=>p.store==='amazon');
    if (mainProduct?.price && !mainProduct.price.includes('Voir')) {
      const cur = parseFloat(mainProduct.price.replace(/[^0-9.,]/g,'').replace(',','.'));
      const slug = mainProduct.name.toLowerCase().replace(/\s+/g,'-').slice(0,50);
      const hist = await sbFetch(`price_history?product_id=eq.${slug}&order=checked_at.desc&limit=10`) || [];
      if (hist.length > 1 && !isNaN(cur)) {
        const old = hist[hist.length-1].price;
        const trend = cur < old*0.97 ? 'down' : cur > old*1.03 ? 'up' : 'stable';
        priceHistoryHtml = priceHistoryBox(`${old}â‚¬`, trend);
      }
      if (!isNaN(cur)) sbFetch('price_history','POST',{product_id:slug,product_name:mainProduct.name,price:cur,store:'amazon',url:mainProduct.url||null});
    }

    // AUTO-ALIMENTATION : sauvegarde prix Rakuten + codes promos
    for (const pr of products) {
      if (!pr.price || pr.price==='Voir prix' || pr.store==='amazon') continue;
      const priceNum = parseFloat(pr.price.replace('DÃ¨s ','').replace(/[^0-9.,]/g,'').replace(',','.'));
      if (!isNaN(priceNum)) {
        const pSlug = pr.name.toLowerCase().replace(/\s+/g,'-').slice(0,50);
        sbFetch('price_history','POST',{product_id:pSlug,product_name:pr.name,price:priceNum,store:pr.store,url:pr.url||null});
      }
    }
    for (const c of (promoCodes||[]).filter(c=>c.code)) {
      sbFetch('promo_codes','POST',{code:c.code,store:c.store||'unknown',discount:c.discount||'',product_query:message,found_at:new Date().toISOString(),valid:true}).catch(()=>{});
    }

    // Cartes produits avec image
    let buttons = '';
    for (const pr of products) {
      if (!pr.name) continue;
      const adv = findAdvertiser(advertisers, pr.store);
      if (!adv) continue;
      const url = buildAffiliateLink(adv, pr.keywords||pr.name, pr.url||null);
      if (!url) continue;
      buttons += productCard(pr.name, pr.price||'Voir prix', url, adv.color, adv.emoji, pr.img||null, pr.badge||null);
    }

    // Codes promos â€” meilleur en premier
    let promos = '';
    const sorted = (promoCodes||[]).filter(c=>c.code).sort((a,b)=>b.best-a.best).slice(0,2);
    for (const c of sorted) {
      promos += promoBox(c.code, c.store||'boutique', c.discount||'RÃ©duction', c.best||false);
    }

    // Wishlist
    const first = products[0];
    const adv0 = first ? findAdvertiser(advertisers, first.store) : null;
    const wishlistBtn = first && adv0
      ? `<button onclick="addToWishlist(${JSON.stringify({name:first.name,price:first.price,store:first.store,url:buildAffiliateLink(adv0,first.keywords||first.name,first.url||null)}).replace(/"/g,'&quot;')})" style="background:#fff;border:1.5px solid #e8edf8;color:#3b5bdb;border-radius:12px;padding:8px 16px;margin-top:10px;font-weight:700;font-size:12px;cursor:pointer;font-family:inherit;width:100%">â™¡ Ajouter Ã  ma wishlist</button>`
      : '';

    // âš¡ OPTIM : on affiche le rÃ©cap juste avant les rÃ©sultats
    const reply = `<div style="font-size:13px;color:#374151;margin-bottom:6px;font-weight:500">${summary}</div>` + recapBox(recapText) + priceHistoryHtml + buttons + (promos ? `<div style="margin-top:4px">${promos}</div>` : '') + wishlistBtn;

    return new Response(JSON.stringify({reply, sessionId:sid}), {
      headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}
    });

  } catch(error) {
    console.error('Error:', error.message);
    return new Response(JSON.stringify({reply:"DÃ©solÃ©, problÃ¨me technique. RÃ©essayez."}), {
      status:200, headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}
    });
  }
}
