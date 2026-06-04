export const config = { runtime: 'edge' };

const SUPABASE_URL = "https://enocxbrqyybendertytl.supabase.co";
const SUPABASE_KEY = "sb_publishable_NmPh--frZG5HuqfaoxnemA_E7cidV9Y";

// ⚡ OPTIM : modèle centralisé + plafond questions de ciblage
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

// ⚡ FIX RAKUTEN : nettoie les keywords pour une recherche e-commerce valide.
// L'agent renvoie parfois "satin, longue, trapèze, style classique" (liste
// d'adjectifs) -> page de résultats vide. On retire virgules et mots vides,
// et on limite à 4-5 termes utiles.
function cleanKeywords(kw) {
  if (!kw) return '';
  const stop = new Set(['style','classique','de','la','le','les','un','une','des','pour','avec','et','en','du','au','aux','très','plus','moins']);
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
  const kw = cleanKeywords(keywords); // ⚡ FIX : keywords nettoyés
  if (adv.slug === 'amazon') {
    const base = directUrl && directUrl.includes('amazon.fr') ? directUrl : `https://www.amazon.fr/s?k=${encodeURIComponent(kw)}`;
    return `${base}${base.includes('?')?'&':'?'}tag=${adv.amazon_tag}`;
  }
  if (adv.awin_mid) {
    // ⚡ FIX 404 : on n'utilise JAMAIS l'URL directe Rakuten (hallucinations IA -> 404).
    // Rakuten France utilise le format /s/mot+clé (+ au lieu de %20).
    const rakutenKw = kw.replace(/%20/g, '+');
    const dest = adv.search_url.replace('{keywords}', encodeURIComponent(kw).replace(/%20/g, '+'));
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

// ⚡ GARDE-FOU anti-double-clic (Edge-safe via Supabase).
// Hash léger du message (pas de crypto async en Edge → simple djb2).
function hashMsg(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
// Tente de poser un verrou. Retourne true si OK (1ère fois), false si doublon (<10s).
async function acquireLock(sessionId, message) {
  const key = `${sessionId}:${hashMsg((message||'').trim().toLowerCase())}`;
  const cutoff = new Date(Date.now() - 10_000).toISOString(); // fenêtre 10s
  try {
    // 1) un verrou récent existe déjà ? → doublon
    const existing = await fetch(
      `${SUPABASE_URL}/rest/v1/request_locks?lock_key=eq.${encodeURIComponent(key)}&created_at=gt.${encodeURIComponent(cutoff)}&select=lock_key`,
      { headers:{'apikey':SUPABASE_KEY,'Authorization':`Bearer ${SUPABASE_KEY}`} }
    ).then(r => r.json()).catch(() => []);
    if (Array.isArray(existing) && existing.length > 0) return false;

    // 2) tente d'insérer (PK unique). Conflit 409 = doublon simultané.
    const ins = await fetch(`${SUPABASE_URL}/rest/v1/request_locks`, {
      method: 'POST',
      headers: {'Content-Type':'application/json','apikey':SUPABASE_KEY,'Authorization':`Bearer ${SUPABASE_KEY}`,'Prefer':'resolution=ignore-duplicates'},
      body: JSON.stringify({ lock_key: key, created_at: new Date().toISOString() })
    });
    // 409 = la clé existait déjà (double-clic exact simultané)
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
      <span style="font-size:11px;color:#16a34a;font-weight:700">${best?'⭐ MEILLEUR — ':''}🏷️ ${store}</span>
      <div style="font-size:12px;color:#166534;font-weight:600">${desc}</div>
    </div>
    <div onclick="navigator.clipboard.writeText('${code}');this.innerHTML='✓';setTimeout(()=>this.innerHTML='${code}',2000)" style="background:#16a34a;color:#fff;border-radius:8px;padding:6px 10px;font-weight:800;font-size:12px;cursor:pointer;white-space:nowrap;flex-shrink:0">${code}</div>
  </div>`;
}

function priceHistoryBox(old, trend) {
  const icon = trend==='down'?'📉':trend==='up'?'📈':'➡️';
  const color = trend==='down'?'#dcfce7':trend==='up'?'#fee2e2':'#f1f5f9';
  const border = trend==='down'?'#86efac':trend==='up'?'#fca5a5':'#e2e8f0';
  const msg = trend==='down'?`Prix en baisse ! Était à ${old} ✅`:trend==='up'?`⚠️ Prix gonflé ! Était à ${old}`:`Prix stable`;
  return `<div style="background:${color};border:1.5px solid ${border};border-radius:12px;padding:10px 14px;margin-top:8px;font-size:12px;font-weight:600;color:#374151">${icon} ${msg}</div>`;
}

function questionBox(question) {
  // ⚡ OPTIM : data-qbox sert au comptage serveur des questions déjà posées
  return `<div data-qbox="1" style="background:#eff6ff;border:1.5px solid #bfdbfe;border-radius:12px;padding:12px 14px;margin-top:8px;font-size:13px;color:#1e40af;font-weight:600">💬 ${question}</div>`;
}

// ⚡ OPTIM : récap de ce que l'agent a compris, juste avant la recherche
function recapBox(recap) {
  return `<div style="background:#f5f3ff;border:1.5px solid #ddd6fe;border-radius:12px;padding:10px 14px;margin-top:8px;font-size:12px;color:#5b21b6;font-weight:600">🔎 ${recap}</div>`;
}

// ⚡ OPTIM : compte les questions de ciblage déjà posées dans l'historique
function countQuestionsAsked(history) {
  return (history||[]).filter(m => m.role !== 'user' && (m.content||'').includes('data-qbox')).length;
}

// ⚡ OPTIM : extrait le bloc JSON de la réponse de façon robuste
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

    // ⚡ GARDE-FOU : rejette les doublons (double-clic / renvoi) avant tout appel payant.
    // Fail-open : si le verrou échoue techniquement, on laisse passer.
    const ok = await acquireLock(sid, message);
    if (!ok) {
      return new Response(JSON.stringify({
        reply: '', duplicate: true, sessionId: sid
      }), { headers:{'Content-Type':'application/json; charset=utf-8','Access-Control-Allow-Origin':'*'} });
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

    // ⚡ FIX HISTORIQUE : on reconstruit un dialogue propre depuis tout l'historique.
    // On ne tronque plus à 150/300 chars — une réponse coupée = question reposée.
    // On garde tous les tours (l'historique entier est envoyé depuis le front).
    const histSummary = (history||[]).map(m => {
      const role = m.role==='user' ? 'Client' : 'Agent';
      // Nettoyer le HTML (questionBox, productCard, etc.) pour garder juste le texte
      const text = (m.content||'')
        .replace(/<[^>]*>/g,' ')   // balises -> espaces
        .replace(/&[^;]+;/g,' ')   // entités HTML (&quot; etc.)
        .replace(/\s+/g,' ')
        .trim()
        .slice(0,400);               // 400 chars par message, suffisant sans couper
      if (!text) return null;
      return `${role}: ${text}`;
    }).filter(Boolean).join('\n').slice(0,2000);

    // ⚡ OPTIM : combien de questions de ciblage déjà posées ?
    const questionsAsked = countQuestionsAsked(history);
    // ⚡ OPTIM : bypass phase 1 si la demande est DÉJÀ précise.
    // Évite le surcoût (~5%) d'un appel de ciblage inutile sur une requête one-shot
    // type "iPhone 15 128Go noir" ou "casque Sony WH-1000XM5 moins de 300€".
    // Heuristique légère et gratuite (aucun token) : longueur + signaux de précision.
    const msgLower = (message||'').toLowerCase();
    const precisionSignals = /\b(\d{2,})\s?(€|euro|eur|go|gb|to|cm|mm|"|pouces?|w|watts?)\b|moins de|budget|taille|modèle|réf|noir|blanc|bleu|rouge|vert|\b(s|m|l|xl|xxl)\b/i;
    const looksPrecise = (message||'').trim().split(/\s+/).length >= 4 && precisionSignals.test(message||'');
    const hasHistory = (history||[]).length > 0;
    // On cherche direct si : plafond atteint, OU 1er message déjà précis (pas d'historique).
    const mustSearchNow = questionsAsked >= MAX_TARGETING_QUESTIONS || (!hasHistory && looksPrecise);

    // ===================================================================
    // ⚡ PHASE 1 — CIBLAGE (sans web search, appel léger & peu coûteux)
    // On ne paie le web search QUE quand on est prêt à chercher.
    // ===================================================================
    let decision = { ready: mustSearchNow, question: null, recap: null };

    if (!mustSearchNow) {
      const phase1Resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {'Content-Type':'application/json','x-api-key':process.env.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01'},
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 250, // ⚡ OPTIM : décision courte, pas de produits ici
          system: [{
            type: 'text',
            // ⚡ OPTIM : partie stable du prompt → mise en cache (payée 1x puis 10%)
            text: `Tu es l'agent shopping IA de Huntify. Ta SEULE tâche : décider si tu as assez d'infos pour chercher, ou poser UNE question.

RÈGLES ABSOLUES :
1. LIS L'HISTORIQUE COMPLET avant tout. Si une info y est déjà (budget, usage, taille, marque...), NE LA REDEMANDE PAS.
2. Identifie ce qui manque encore parmi : catégorie précise, budget, usage/critères.
3. Si tout est clair OU si tu as déjà posé ${MAX_TARGETING_QUESTIONS} questions → réponds ready:true.
4. Sinon → pose UNE seule question sur CE QUI MANQUE VRAIMENT (pas ce qui est déjà répondu).

ERREUR INTERDITE : reposer une question dont la réponse est déjà dans l'historique.

Réponds en JSON UNIQUEMENT :
- Question nécessaire : {"ready":false,"question":"ta question sur ce qui manque"}
- Prêt à chercher : {"ready":true,"recap":"Je cherche X, budget Y, critères Z (résume TOUT ce que tu sais)"}`,
            cache_control: { type: 'ephemeral' }
          }],
          messages: [{
            role: 'user',
            content: `HISTORIQUE RÉCENT:\n${histSummary || 'Début de conversation'}\n\nQuestions déjà posées: ${questionsAsked}/${MAX_TARGETING_QUESTIONS}\n\nNOUVEAU MESSAGE CLIENT: ${message}`
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
        // En cas d'échec phase 1, on bascule en recherche pour ne pas bloquer
        decision.ready = true;
      }
    }

    // L'agent veut une info de plus → on s'arrête là (aucun web search facturé)
    if (!decision.ready && decision.question) {
      return new Response(JSON.stringify({
        reply: questionBox(decision.question),
        sessionId: sid
      }), { headers:{'Content-Type':'application/json; charset=utf-8','Access-Control-Allow-Origin':'*'} });
    }

    // ===================================================================
    // ⚡ PHASE 2 — RECHERCHE (web search déclenché UNE seule fois)
    // ===================================================================
    const recapText = decision.recap || `Je cherche : ${message}`;

    const agentResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {'Content-Type':'application/json','x-api-key':process.env.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01'},
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 600, // ⚡ OPTIM : 800 → 600, le JSON tient largement
        // ⚡ OPTIM : max_uses:1 — une seule recherche ~14,6k tokens, reste loin
        // sous le plafond 50k/min du tier 1. La phase 1 ayant déjà ciblé le besoin,
        // une recherche précise suffit (passer à 2 risque de frôler la limite).
        // ⚡ max_uses:2 pour Amazon (1 recherche) + Rakuten (1 recherche) séparément
        tools: [{ type:"web_search_20250305", name:"web_search", max_uses: 2 }],
        system: [{
          type: 'text',
          // ⚡ OPTIM : system stable → caché. Seul le message user change.
          text: `Tu es l'agent shopping IA de Huntify. Boutiques : ${activeNames}.

TA TÂCHE :
1. CHERCHER SUR AMAZON — 1 recherche web sur amazon.fr, trouve 2 produits avec prix réels.
2. CHERCHER SUR RAKUTEN — 1 recherche web sur fr.shopping.rakuten.com, trouve 1 produit avec prix réel. OBLIGATOIRE.
3. CODES PROMOS — cherche sur dealabs.com si il reste une recherche disponible.
4. CONTEXTE — utilise l'historique pour affiner (si "moins cher" → cherche moins cher que proposé avant).

RÈGLES :
- EXACTEMENT 2 produits Amazon + 1 produit Rakuten (les deux sont OBLIGATOIRES)
- Max 2 codes promos
- Prix exacts, URLs directes quand possible
- "keywords" = terme de recherche e-commerce SIMPLE qui retourne des résultats. TOUJOURS commencer par le TYPE de produit (ex: "robe satin longue", "casque sans fil bluetooth"). JAMAIS une liste d'adjectifs séparés par des virgules (ex INTERDIT: "satin, longue, trapèze, classique"). Max 4-5 mots.
- "url" : ne mets une URL QUE si tu es certain qu'elle existe vraiment. Sinon laisse null (le lien de recherche sera construit automatiquement).

JSON UNIQUEMENT :
{"summary":"1 phrase","products":[{"name":"nom","price":"XX€","store":"amazon","keywords":"mots","url":"url ou null","img":null,"badge":null},{"name":"nom","price":"Dès XX€","store":"rakuten","keywords":"mots","url":"url ou null","img":null,"badge":null}],"promoCodes":[{"code":"CODE","store":"boutique","discount":"-XX%","best":true}]}`,
          cache_control: { type: 'ephemeral' }
        }],
        messages: [{
          role: 'user',
          content: `HISTORIQUE:\n${histSummary || 'Début'}\n\nBESOIN CIBLÉ: ${recapText}\n\nMESSAGE: ${message}`
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
      summary = `Résultats pour "${message}" :`;
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
        priceHistoryHtml = priceHistoryBox(`${old}€`, trend);
      }
      if (!isNaN(cur)) sbFetch('price_history','POST',{product_id:slug,product_name:mainProduct.name,price:cur,store:'amazon',url:mainProduct.url||null});
    }

    // AUTO-ALIMENTATION : sauvegarde prix Rakuten + codes promos
    for (const pr of products) {
      if (!pr.price || pr.price==='Voir prix' || pr.store==='amazon') continue;
      const priceNum = parseFloat(pr.price.replace('Dès ','').replace(/[^0-9.,]/g,'').replace(',','.'));
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

    // Codes promos — meilleur en premier
    let promos = '';
    const sorted = (promoCodes||[]).filter(c=>c.code).sort((a,b)=>b.best-a.best).slice(0,2);
    for (const c of sorted) {
      promos += promoBox(c.code, c.store||'boutique', c.discount||'Réduction', c.best||false);
    }

    // Wishlist
    const first = products[0];
    const adv0 = first ? findAdvertiser(advertisers, first.store) : null;
    const wishlistBtn = first && adv0
      ? `<button onclick="addToWishlist(${JSON.stringify({name:first.name,price:first.price,store:first.store,url:buildAffiliateLink(adv0,first.keywords||first.name,first.url||null)}).replace(/"/g,'&quot;')})" style="background:#fff;border:1.5px solid #e8edf8;color:#3b5bdb;border-radius:12px;padding:8px 16px;margin-top:10px;font-weight:700;font-size:12px;cursor:pointer;font-family:inherit;width:100%">♡ Ajouter à ma wishlist</button>`
      : '';

    // ⚡ OPTIM : on affiche le récap juste avant les résultats
    const reply = `<div style="font-size:13px;color:#374151;margin-bottom:6px;font-weight:500">${summary}</div>` + recapBox(recapText) + priceHistoryHtml + buttons + (promos ? `<div style="margin-top:4px">${promos}</div>` : '') + wishlistBtn;

    return new Response(JSON.stringify({reply, sessionId:sid}), {
      headers:{'Content-Type':'application/json; charset=utf-8','Access-Control-Allow-Origin':'*'}
    });

  } catch(error) {
    console.error('Error:', error.message);
    return new Response(JSON.stringify({reply:"Désolé, problème technique. Réessayez."}), {
      status:200, headers:{'Content-Type':'application/json; charset=utf-8','Access-Control-Allow-Origin':'*'}
    });
  }
}
