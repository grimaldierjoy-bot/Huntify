export const config = { runtime: 'edge' };

const SUPABASE_URL = "https://enocxbrqyybendertytl.supabase.co";
const SUPABASE_KEY = "sb_publishable_NmPh--frZG5HuqfaoxnemA_E7cidV9Y";

// ── ANNONCEURS — source unique de vérité ──────
// Pour ajouter un annonceur : modifier advertisers.js UNIQUEMENT
const ADVERTISERS = {
  amazon:    { name:"Amazon",    active:true,  color:"linear-gradient(135deg,#ff9900,#ff6600)", emoji:"🛒", awinMid:null,    tag:"huntify21-21" },
  rakuten:   { name:"Rakuten",   active:true,  color:"linear-gradient(135deg,#bf0000,#e00)",    emoji:"🛍️", awinMid:"55615", awinAff:"2920215" },
  fnac:      { name:"Fnac",      active:false, color:"linear-gradient(135deg,#e1a800,#c49200)", emoji:"📦", awinMid:null,    awinAff:"2920215" },
  cdiscount: { name:"Cdiscount", active:false, color:"linear-gradient(135deg,#e31010,#b00)",    emoji:"🏷️", awinMid:null,    awinAff:"2920215" },
  zalando:   { name:"Zalando",   active:false, color:"linear-gradient(135deg,#ff6900,#e55a00)", emoji:"👟", awinMid:null,    awinAff:"2920215" },
  decathlon: { name:"Decathlon", active:false, color:"linear-gradient(135deg,#0082c3,#005f8e)", emoji:"🏋️", awinMid:null,    awinAff:"2920215" },
  darty:     { name:"Darty",     active:false, color:"linear-gradient(135deg,#e20020,#b0001a)", emoji:"🔌", awinMid:null,    awinAff:"2920215" },
};

function getActive() { return Object.entries(ADVERTISERS).filter(([,a])=>a.active); }

function buildLink(storeName, keywords, directUrl=null) {
  const a = ADVERTISERS[storeName.toLowerCase()];
  if (!a || !a.active) return null;
  if (storeName.toLowerCase() === 'amazon') {
    const url = directUrl || `https://www.amazon.fr/s?k=${encodeURIComponent(keywords)}`;
    return `${url}${url.includes('?')?'&':'?'}tag=${a.tag}`;
  }
  const dest = directUrl || getSearchUrl(storeName.toLowerCase(), keywords);
  return `https://www.awin1.com/cread.php?awinmid=${a.awinMid}&awinaffid=${a.awinAff}&ued=${encodeURIComponent(dest)}`;
}

function getSearchUrl(store, keywords) {
  const urls = {
    rakuten:   `https://fr.shopping.rakuten.com/search?keyword=${encodeURIComponent(keywords)}`,
    fnac:      `https://www.fnac.com/SearchResult/ResultList.aspx?Search=${encodeURIComponent(keywords)}`,
    cdiscount: `https://www.cdiscount.com/search/10/${encodeURIComponent(keywords)}.html`,
    zalando:   `https://www.zalando.fr/cataloguepage/?q=${encodeURIComponent(keywords)}`,
    decathlon: `https://www.decathlon.fr/search?Ntt=${encodeURIComponent(keywords)}`,
    darty:     `https://www.darty.com/nav/recherche?text=${encodeURIComponent(keywords)}`,
  };
  return urls[store] || `https://www.google.fr/search?q=${encodeURIComponent(keywords)}`;
}

function productBtn(name, price, url, color, emoji) {
  return `<a href="${url}" target="_blank" style="display:flex;align-items:center;justify-content:space-between;background:${color};color:#fff;text-decoration:none;border-radius:12px;padding:11px 16px;margin-top:8px;font-weight:700;font-size:13px">${emoji} ${name}<span style="background:rgba(255,255,255,.25);border-radius:8px;padding:3px 10px;white-space:nowrap;margin-left:8px">${price}</span></a>`;
}

function promoBox(code, store, desc, verified) {
  const badge = verified ? '✅ Vérifié' : '⚠️ À vérifier';
  const badgeColor = verified ? '#16a34a' : '#d97706';
  return `<div style="background:linear-gradient(135deg,#f0fdf4,#dcfce7);border:1.5px solid #86efac;border-radius:12px;padding:12px 14px;margin-top:8px">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
      <div style="flex:1">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
          <span style="font-size:11px;color:#16a34a;font-weight:700">🏷️ Code promo ${store}</span>
          <span style="font-size:10px;color:${badgeColor};font-weight:700;background:${verified?'#dcfce7':'#fef3c7'};padding:2px 6px;border-radius:100px">${badge}</span>
        </div>
        <div style="font-size:13px;color:#166534;font-weight:600">${desc}</div>
      </div>
      <div onclick="navigator.clipboard.writeText('${code}');this.innerHTML='✓ Copié!';this.style.background='#15803d';setTimeout(()=>{this.innerHTML='${code}';this.style.background='#16a34a'},2000)" style="background:#16a34a;color:#fff;border-radius:8px;padding:8px 12px;font-weight:800;font-size:13px;cursor:pointer;white-space:nowrap;min-width:80px;text-align:center">${code}</div>
    </div>
  </div>`;
}

function priceHistoryBox(currentPrice, oldPrice, trend) {
  const isGood = trend === 'down';
  const icon = isGood ? '📉' : trend === 'up' ? '📈' : '➡️';
  const color = isGood ? '#dcfce7' : trend === 'up' ? '#fee2e2' : '#f1f5f9';
  const border = isGood ? '#86efac' : trend === 'up' ? '#fca5a5' : '#e2e8f0';
  const msg = isGood
    ? `Prix en baisse ! Était à ${oldPrice} — vraie bonne affaire ✅`
    : trend === 'up'
    ? `⚠️ Prix gonflé ! Était à ${oldPrice} avant promo`
    : `Prix stable depuis 30 jours`;
  return `<div style="background:${color};border:1.5px solid ${border};border-radius:12px;padding:10px 14px;margin-top:8px;font-size:12px;font-weight:600;color:#374151">${icon} ${msg}</div>`;
}

async function sbFetch(path, method='GET', body=null) {
  const opts = { method, headers: { 'Content-Type':'application/json', 'apikey':SUPABASE_KEY, 'Authorization':`Bearer ${SUPABASE_KEY}` } };
  if (body) opts.body = JSON.stringify(body);
  try { const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, opts); return await r.json(); } catch(e) { return null; }
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status:204, headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type'} });
  if (req.method !== 'POST') return new Response('Method not allowed', { status:405 });

  try {
    const { message, history, sessionId, userId, trackingEnabled } = await req.json();
    const sid = sessionId || `anon_${Date.now()}`;

    // Sauvegarde + tendances en parallèle
    if (trackingEnabled) {
      Promise.all([
        sbFetch('searches','POST',{ query:message, session_id:sid, user_id:userId||null }),
        sbFetch('trends','POST',{ query:message.toLowerCase().trim(), count:1, last_searched:new Date().toISOString() })
      ]);
    }
    const trends = await sbFetch('trends?order=count.desc&limit=5') || [];

    // Contexte annonceurs actifs pour l'agent
    const activeStores = getActive().map(([k,a])=>a.name);
    const storeContext = `Boutiques actives sur Huntify : ${activeStores.join(', ')}.`;
    const trendContext = trends.length > 0 ? `Tendances : ${trends.map(t=>t.query).join(', ')}.` : '';

    // ── AGENT IA ──────────────────────────────
    const agentResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type':'application/json', 'x-api-key':process.env.ANTHROPIC_API_KEY, 'anthropic-version':'2023-06-01' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 2000,
        tools: [{ type:"web_search_20250305", name:"web_search" }],
        system: `Tu es l'agent shopping IA de Huntify.
${storeContext}
${trendContext}

Tes 3 missions :
1. Chercher le produit sur chaque boutique active (${activeStores.join(', ')})
2. Chercher des codes promo sur dealabs.com et ma-reduc.com
3. Vérifier la validité des codes trouvés

Retourne UNIQUEMENT ce JSON :
{
  "summary": "conseil 1-2 phrases",
  "products": [
    {"name":"nom exact","price":"prix réel","store":"amazon","keywords":"mots clés","url":"url ou null"},
    {"name":"nom exact","price":"prix réel","store":"rakuten","keywords":"mots clés","url":"url ou null"}
  ],
  "promoCodes": [
    {"code":"CODE","store":"boutique","discount":"description","valid":true,"expires":"date ou null"}
  ]
}
Store doit être exactement : ${activeStores.map(s=>s.toLowerCase()).join(' ou ')}.
Prix RÉELS. Max 2 produits par boutique. promoCodes:[] si rien trouvé.`,
        messages: [
          ...(history||[]).slice(-4),
          { role:'user', content:`Recherche + codes promo : ${message}` }
        ]
      })
    });

    const agentData = await agentResp.json();
    if (!agentResp.ok) throw new Error(agentData.error?.message || 'Agent error');

    let rawText = '';
    for (const block of agentData.content) { if (block.type==='text') rawText += block.text; }

    let products=[], promoCodes=[], summary='';
    try {
      const match = rawText.match(/\{[\s\S]*"products"[\s\S]*\}/);
      if (match) { const p=JSON.parse(match[0]); products=p.products||[]; promoCodes=p.promoCodes||[]; summary=p.summary||''; }
    } catch(e) {}

    if (products.length === 0) {
      products = activeStores.slice(0,2).map(s=>({ name:message, price:'Voir prix', store:s.toLowerCase(), keywords:message, url:null }));
      summary = `Voici les résultats pour "${message}" :`;
    }

    // Historique prix
    let priceHistoryHtml = '';
    const mainProduct = products.find(p=>p.store==='amazon');
    if (mainProduct?.price && mainProduct.price !== 'Voir prix') {
      const productSlug = mainProduct.name.toLowerCase().replace(/\s+/g,'-').slice(0,50);
      const hist = await sbFetch(`price_history?product_id=eq.${productSlug}&order=checked_at.desc&limit=10`) || [];
      if (hist.length > 1) {
        const cur = parseFloat(mainProduct.price.replace(/[^0-9.]/g,''));
        const old = hist[hist.length-1].price;
        const trend = cur < old*0.97 ? 'down' : cur > old*1.03 ? 'up' : 'stable';
        priceHistoryHtml = priceHistoryBox(mainProduct.price, `${old}€`, trend);
      }
      sbFetch('price_history','POST',{ product_id:productSlug, product_name:mainProduct.name, price:parseFloat(mainProduct.price.replace(/[^0-9.]/g,'')), store:'amazon', url:mainProduct.url||null });
    }

    // Boutons produits avec liens affiliés dynamiques
    let buttons = '';
    for (const p of products) {
      if (!p.name) continue;
      const a = ADVERTISERS[p.store?.toLowerCase()];
      if (!a || !a.active) continue;
      const url = buildLink(p.store, p.keywords||p.name, p.url&&p.url.includes(p.store)?p.url:null);
      if (!url) continue;
      buttons += productBtn(p.name, p.price||'Voir prix', url, a.color, a.emoji);
    }

    // Codes promos vérifiés
    let promos = '';
    for (const c of promoCodes.filter(c=>c.code&&c.valid!==false)) {
      promos += promoBox(c.code, c.store||'boutique', c.discount||'Réduction disponible', true);
    }

    // Bouton wishlist
    const first = products[0];
    const wishlistBtn = first ? `<button onclick="addToWishlist(${JSON.stringify({name:first.name,price:first.price,store:first.store,url:buildLink(first.store,first.keywords||first.name)}).replace(/"/g,'&quot;')})" style="background:#fff;border:1.5px solid #e8edf8;color:#3b5bdb;border-radius:12px;padding:8px 16px;margin-top:8px;font-weight:700;font-size:12px;cursor:pointer;font-family:inherit;width:100%">♡ Ajouter à ma wishlist</button>` : '';

    const reply = (summary||`Résultats pour "${message}" :`) + priceHistoryHtml + buttons + promos + wishlistBtn;

    return new Response(JSON.stringify({ reply, sessionId:sid }), {
      headers: { 'Content-Type':'application/json', 'Access-Control-Allow-Origin':'*' }
    });

  } catch(error) {
    console.error('Error:', error.message);
    return new Response(JSON.stringify({ reply:"Désolé, problème technique. Réessayez." }), {
      status:200, headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}
    });
  }
}
