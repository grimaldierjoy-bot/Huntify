export const config = { runtime: 'edge' };

const SUPABASE_URL = "https://enocxbrqyybendertytl.supabase.co";
const SUPABASE_KEY = "sb_publishable_NmPh--frZG5HuqfaoxnemA_E7cidV9Y";

async function getAdvertisers() {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/advertisers?active=eq.true`, {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
    });
    return await r.json();
  } catch(e) { return []; }
}

function buildAffiliateLink(adv, keywords, directUrl=null) {
  if (!adv?.active) return null;
  if (adv.slug === 'amazon') {
    const base = directUrl || `https://www.amazon.fr/s?k=${encodeURIComponent(keywords)}`;
    return `${base}${base.includes('?')?'&':'?'}tag=${adv.amazon_tag}`;
  }
  if (adv.awin_mid) {
    const dest = directUrl || adv.search_url.replace('{keywords}', encodeURIComponent(keywords));
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

function productBtn(name, price, url, color, emoji) {
  return `<a href="${url}" target="_blank" style="display:flex;align-items:center;justify-content:space-between;background:${color};color:#fff;text-decoration:none;border-radius:12px;padding:11px 16px;margin-top:8px;font-weight:700;font-size:13px">${emoji} ${name}<span style="background:rgba(255,255,255,.25);border-radius:8px;padding:3px 10px;white-space:nowrap;margin-left:8px">${price}</span></a>`;
}

function promoBox(code, store, desc) {
  return `<div style="background:#f0fdf4;border:1.5px solid #86efac;border-radius:12px;padding:10px 14px;margin-top:8px;display:flex;align-items:center;justify-content:space-between;gap:8px">
    <span style="font-size:12px;color:#166534;font-weight:600">🏷️ <b>${store}</b> — ${desc}</span>
    <div onclick="navigator.clipboard.writeText('${code}');this.innerHTML='✓ Copié';setTimeout(()=>this.innerHTML='${code}',2000)" style="background:#16a34a;color:#fff;border-radius:8px;padding:6px 10px;font-weight:800;font-size:12px;cursor:pointer;white-space:nowrap;flex-shrink:0">${code}</div>
  </div>`;
}

function priceHistoryBox(old, trend) {
  const icon = trend==='down'?'📉':trend==='up'?'📈':'➡️';
  const color = trend==='down'?'#dcfce7':trend==='up'?'#fee2e2':'#f1f5f9';
  const border = trend==='down'?'#86efac':trend==='up'?'#fca5a5':'#e2e8f0';
  const msg = trend==='down'?`Prix en baisse ! Était à ${old} ✅`:trend==='up'?`⚠️ Prix gonflé ! Était à ${old}` :`Prix stable`;
  return `<div style="background:${color};border:1.5px solid ${border};border-radius:12px;padding:10px 14px;margin-top:8px;font-size:12px;font-weight:600;color:#374151">${icon} ${msg}</div>`;
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status:204, headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type'} });
  if (req.method !== 'POST') return new Response('Method not allowed', { status:405 });

  try {
    const { message, history, sessionId, userId, trackingEnabled } = await req.json();
    const sid = sessionId || `anon_${Date.now()}`;

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
    const trendCtx = trends?.length ? `Tendances : ${trends.map(t=>t.query).join(', ')}.` : '';

    // ══════════════════════════════════════════
    // APPEL 1 — AGENT CHERCHE EN LIVE
    // Recherche réelle sur Amazon + Rakuten + codes promos
    // ══════════════════════════════════════════
    const searchResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {'Content-Type':'application/json','x-api-key':process.env.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01'},
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 2500,
        tools: [{ type:"web_search_20250305", name:"web_search" }],
        system: `Tu es l'agent shopping de Huntify. Boutiques actives : ${activeNames}.
${trendCtx}

Tu DOIS faire ces 3 recherches dans l'ordre :
1. Cherche le produit sur Amazon.fr → trouve le nom EXACT, le prix EXACT, et l'URL DIRECTE du produit
2. Cherche le même produit sur fr.shopping.rakuten.com → trouve le nom EXACT, le prix le plus bas, et l'URL DIRECTE
3. Cherche des codes promo actifs sur dealabs.com pour ce produit/marque

Pour chaque produit trouvé, note :
- Le nom exact tel qu'affiché sur le site
- Le prix exact en euros (ex: 151,05€)
- L'URL directe de la page produit (pas une URL de recherche)
- Pour Rakuten : le prix du vendeur le moins cher

Présente tes trouvailles de façon détaillée et précise.`,
        messages: [
          ...(history||[]).slice(-4),
          { role:'user', content:`Recherche en live sur Amazon.fr et Rakuten.fr, puis codes promo pour : ${message}` }
        ]
      })
    });

    const searchData = await searchResp.json();
    if (!searchResp.ok) throw new Error(searchData.error?.message || 'Search error');

    let searchText = '';
    for (const b of searchData.content) { if (b.type==='text') searchText += b.text; }

    // ══════════════════════════════════════════
    // APPEL 2 — STRUCTURATION JSON PROPRE
    // Transforme les résultats en JSON exploitable
    // ══════════════════════════════════════════
    const slugs = advertisers.map(a=>`"${a.slug}"`).join(', ');
    const structResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {'Content-Type':'application/json','x-api-key':process.env.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01'},
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 1000,
        system: `Tu extrais des données shopping en JSON strict.
Stores valides : ${slugs}.

RÈGLES ABSOLUES :
- Inclus TOUJOURS 1 produit amazon ET 1 produit rakuten
- "price" : prix exact trouvé en live avec € (ex: "151,05€"). Pour Rakuten mettre "Dès XX€"
- "url" : URL DIRECTE du produit trouvée (pas une URL de recherche générique)
- "keywords" : 3-4 mots clés du produit
- Maximum 2 codes promos en 1 ligne chacun
- "summary" : 1 phrase comparant les deux prix

JSON UNIQUEMENT, zéro texte autour :
{
  "summary": "Sony WH-1000XM5 à 249€ sur Amazon, dès 239€ sur Rakuten",
  "products": [
    {"name":"nom exact","price":"XX,XX€","store":"amazon","keywords":"mots clés","url":"https://www.amazon.fr/dp/..."},
    {"name":"nom exact","price":"Dès XX€","store":"rakuten","keywords":"mots clés","url":"https://fr.shopping.rakuten.com/offer/..."}
  ],
  "promoCodes": [
    {"code":"CODE","store":"Amazon","discount":"-10%"}
  ]
}`,
        messages: [{ role:'user', content:`Extrais les données de cette recherche en JSON :\n\n${searchText}` }]
      })
    });

    const structData = await structResp.json();
    let structText = '';
    for (const b of structData.content) { if (b.type==='text') structText += b.text; }

    let products=[], promoCodes=[], summary='';
    try {
      const match = structText.match(/\{[\s\S]*\}/);
      if (match) {
        const p = JSON.parse(match[0]);
        products   = p.products   || [];
        promoCodes = p.promoCodes || [];
        summary    = p.summary    || '';
      }
    } catch(e) {}

    if (!products.length) {
      products = advertisers.slice(0,2).map(a=>({
        name: message, price:'Voir prix', store:a.slug, keywords:message, url:null
      }));
      summary = `Voici les résultats pour "${message}" :`;
    }

    // ── Historique prix ───────────────────────
    let priceHistoryHtml = '';
    const mainProduct = products.find(p=>p.store==='amazon');
    if (mainProduct?.price && !mainProduct.price.includes('Voir')) {
      const cur = parseFloat(mainProduct.price.replace(/[^0-9.,]/g,'').replace(',','.'));
      const slug = mainProduct.name.toLowerCase().replace(/\s+/g,'-').slice(0,50);
      const hist = await sbFetch(`price_history?product_id=eq.${encodeURIComponent(slug)}&order=checked_at.desc&limit=10`) || [];
      if (hist.length > 1 && !isNaN(cur)) {
        const old = hist[hist.length-1].price;
        const trend = cur < old*0.97 ? 'down' : cur > old*1.03 ? 'up' : 'stable';
        priceHistoryHtml = priceHistoryBox(`${old}€`, trend);
      }
      if (!isNaN(cur)) {
        sbFetch('price_history','POST',{
          product_id: slug,
          product_name: mainProduct.name,
          price: cur,
          store: 'amazon',
          url: mainProduct.url || null
        });
      }
    }

    // ── Boutons avec liens directs affiliés ───
    let buttons = '';
    for (const p of products) {
      if (!p.name) continue;
      const adv = findAdvertiser(advertisers, p.store);
      if (!adv) continue;
      // Utilise l'URL directe trouvée par l'agent si disponible
      const url = buildAffiliateLink(adv, p.keywords||p.name, p.url||null);
      if (!url) continue;
      buttons += productBtn(p.name, p.price||'Voir prix', url, adv.color, adv.emoji);
    }

    // ── Codes promos compacts ─────────────────
    let promos = '';
    for (const c of (promoCodes||[]).filter(c=>c.code).slice(0,2)) {
      promos += promoBox(c.code, c.store||'boutique', c.discount||'Réduction');
    }

    // ── Bouton wishlist ───────────────────────
    const first = products[0];
    const adv0 = first ? findAdvertiser(advertisers, first.store) : null;
    const wishlistBtn = first && adv0
      ? `<button onclick="addToWishlist(${JSON.stringify({name:first.name,price:first.price,store:first.store,url:buildAffiliateLink(adv0,first.keywords||first.name,first.url||null)}).replace(/"/g,'&quot;')})" style="background:#fff;border:1.5px solid #e8edf8;color:#3b5bdb;border-radius:12px;padding:8px 16px;margin-top:8px;font-weight:700;font-size:12px;cursor:pointer;font-family:inherit;width:100%">♡ Ajouter à ma wishlist</button>`
      : '';

    const reply = (summary||`Résultats pour "${message}" :`) + priceHistoryHtml + buttons + promos + wishlistBtn;

    return new Response(JSON.stringify({reply, sessionId:sid}), {
      headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}
    });

  } catch(error) {
    console.error('Error:', error.message);
    return new Response(JSON.stringify({reply:"Désolé, problème technique. Réessayez."}), {
      status:200, headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}
    });
  }
}
