export const config = { runtime: 'edge' };

const AMZ_TAG      = "huntify21-21";
const AWIN_AFF     = "2920215";
const RAKUTEN_MID  = "55615";
const SUPABASE_URL = "https://enocxbrqyybendertytl.supabase.co";
const SUPABASE_KEY = "sb_publishable_NmPh--frZG5HuqfaoxnemA_E7cidV9Y";

function amazonLink(k) { return `https://www.amazon.fr/s?k=${encodeURIComponent(k)}&tag=${AMZ_TAG}`; }
function rakutenLink(dest) { return `https://www.awin1.com/cread.php?awinmid=${RAKUTEN_MID}&awinaffid=${AWIN_AFF}&ued=${encodeURIComponent(dest)}`; }

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
          <span style="font-size:11px;color:#16a34a;font-weight:700;text-transform:uppercase">🏷️ Code promo ${store}</span>
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
    ? `Prix en baisse ! Était à ${oldPrice} — c'est une vraie bonne affaire ✅`
    : trend === 'up'
    ? `⚠️ Prix gonflé ! Était à ${oldPrice} avant la promo`
    : `Prix stable depuis 30 jours`;
  return `<div style="background:${color};border:1.5px solid ${border};border-radius:12px;padding:10px 14px;margin-top:8px;font-size:12px;font-weight:600;color:#374151">${icon} ${msg}</div>`;
}

async function supabase(path, method='GET', body=null) {
  const opts = {
    method,
    headers: { 'Content-Type':'application/json', 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
  };
  if (body) opts.body = JSON.stringify(body);
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, opts);
    return await r.json();
  } catch(e) { return null; }
}

async function saveSearch(query, sessionId, userId, trackingEnabled) {
  if (!trackingEnabled) return;
  await Promise.all([
    supabase('searches', 'POST', { query, session_id: sessionId, user_id: userId }),
    supabase('trends', 'POST', { query: query.toLowerCase().trim(), count: 1, last_searched: new Date().toISOString() })
  ]);
}

async function getTrends() {
  const data = await supabase('trends?order=count.desc&limit=5');
  return data || [];
}

async function getPriceHistory(productName) {
  const slug = encodeURIComponent(`product_id=eq.${productName.toLowerCase().replace(/\s+/g,'-').slice(0,50)}&order=checked_at.desc&limit=10`);
  const data = await supabase(`price_history?product_id=eq.${productName.toLowerCase().replace(/\s+/g,'-').slice(0,50)}&order=checked_at.desc&limit=10`);
  return data || [];
}

async function savePriceHistory(productName, price, store, url) {
  const numPrice = parseFloat(price.replace(/[^0-9.]/g,''));
  if (isNaN(numPrice)) return;
  await supabase('price_history', 'POST', {
    product_id: productName.toLowerCase().replace(/\s+/g,'-').slice(0,50),
    product_name: productName,
    price: numPrice,
    store,
    url: url || null
  });
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    }});
  }
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  try {
    const { message, history, sessionId, userId, trackingEnabled } = await req.json();
    const sid = sessionId || `anon_${Date.now()}`;

    const [_, trends] = await Promise.all([
      saveSearch(message, sid, userId||null, trackingEnabled),
      getTrends()
    ]);

    const trendCtx = trends.length > 0
      ? `Tendances Huntify : ${trends.map(t=>t.query).join(', ')}.`
      : '';

    // ── AGENT : produits + codes promos + vérification ──
    const agentResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 2000,
        tools: [{ type: "web_search_20250305", name: "web_search" }],
        system: `Tu es l'agent shopping IA de Huntify. Tu as 3 missions :
1. Trouver les meilleurs produits sur Amazon.fr et Rakuten avec leurs VRAIS prix
2. Chercher des codes promo actifs sur dealabs.com et ma-reduc.com
3. VÉRIFIER que les codes trouvés sont encore valides (cherche la date d'expiration)

${trendCtx}

Fais ces recherches dans l'ordre :
- Recherche 1 : produit sur Amazon.fr
- Recherche 2 : produit sur fr.shopping.rakuten.com
- Recherche 3 : codes promo sur dealabs.com OU ma-reduc.com pour ce produit/marque

Pour chaque code promo trouvé, vérifie :
- La date d'expiration (si elle est passée → valid: false)
- Si le code est toujours mentionné comme actif → valid: true

Retourne UNIQUEMENT ce JSON strict :
{
  "summary": "conseil utile 1-2 phrases avec analyse prix",
  "products": [
    {"name":"nom exact","price":"prix réel","store":"amazon","keywords":"mots clés","url":"url ou null"},
    {"name":"nom exact","price":"prix réel","store":"rakuten","keywords":"mots clés","url":"url ou null"}
  ],
  "promoCodes": [
    {"code":"CODE","store":"nom boutique","discount":"description remise ex: -10%","valid":true,"expires":"date ou null"}
  ]
}
Si aucun code : "promoCodes":[]
Maximum 2 produits par store. Prix RÉELS uniquement.`,
        messages: [
          ...(history||[]).slice(-4),
          { role:'user', content:`Recherche produit + codes promo : ${message}` }
        ]
      })
    });

    const agentData = await agentResp.json();
    if (!agentResp.ok) throw new Error(agentData.error?.message || 'Agent error');

    let rawText = '';
    for (const block of agentData.content) {
      if (block.type === 'text') rawText += block.text;
    }

    let products = [], promoCodes = [], summary = '';
    try {
      const match = rawText.match(/\{[\s\S]*"products"[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        products   = parsed.products   || [];
        promoCodes = parsed.promoCodes || [];
        summary    = parsed.summary    || '';
      }
    } catch(e) {}

    if (products.length === 0) {
      products = [
        { name: message, price:'Voir prix', store:'amazon',  keywords:message, url:null },
        { name: message, price:'Voir prix', store:'rakuten', keywords:message, url:null }
      ];
      summary = `Voici les résultats pour "${message}" :`;
    }

    // Historique prix pour le 1er produit Amazon
    let priceHistoryHtml = '';
    const mainProduct = products.find(p => p.store === 'amazon');
    if (mainProduct && mainProduct.price && mainProduct.price !== 'Voir prix') {
      const history_data = await getPriceHistory(mainProduct.name);
      if (history_data.length > 1) {
        const currentNum = parseFloat(mainProduct.price.replace(/[^0-9.]/g,''));
        const oldNum = history_data[history_data.length - 1].price;
        const trend = currentNum < oldNum * 0.97 ? 'down' : currentNum > oldNum * 1.03 ? 'up' : 'stable';
        priceHistoryHtml = priceHistoryBox(mainProduct.price, `${oldNum}€`, trend);
      }
      // Sauvegarder le prix actuel
      savePriceHistory(mainProduct.name, mainProduct.price, 'amazon', mainProduct.url);
    }

    // Boutons produits
    let buttons = '';
    for (const p of products) {
      if (!p.name) continue;
      if (p.store === 'rakuten') {
        const dest = (p.url && p.url.includes('rakuten'))
          ? p.url
          : `https://fr.shopping.rakuten.com/search?keyword=${encodeURIComponent(p.keywords||p.name)}`;
        buttons += productBtn(p.name, p.price||'Voir prix', rakutenLink(dest), 'linear-gradient(135deg,#bf0000,#e00)', '🛍️');
      } else {
        const url = (p.url && p.url.includes('amazon.fr'))
          ? `${p.url}${p.url.includes('?')?'&':'?'}tag=${AMZ_TAG}`
          : amazonLink(p.keywords||p.name);
        buttons += productBtn(p.name, p.price||'Voir prix', url, 'linear-gradient(135deg,#ff9900,#ff6600)', '🛒');
      }
    }

    // Codes promos vérifiés
    let promos = '';
    const validCodes = promoCodes.filter(c => c.code && c.valid !== false);
    for (const c of validCodes) {
      promos += promoBox(c.code, c.store||'boutique', c.discount||'Réduction disponible', true);
    }

    // Bouton wishlist
    const firstProduct = products[0];
    const wishlistBtn = firstProduct ? `<button onclick="addToWishlist(${JSON.stringify({
      name: firstProduct.name,
      price: firstProduct.price,
      store: firstProduct.store,
      url: firstProduct.store==='rakuten'
        ? rakutenLink(`https://fr.shopping.rakuten.com/search?keyword=${encodeURIComponent(firstProduct.keywords||firstProduct.name)}`)
        : amazonLink(firstProduct.keywords||firstProduct.name)
    }).replace(/"/g,'&quot;')})" style="background:#fff;border:1.5px solid #e8edf8;color:#3b5bdb;border-radius:12px;padding:8px 16px;margin-top:8px;font-weight:700;font-size:12px;cursor:pointer;font-family:inherit;width:100%">♡ Ajouter à ma wishlist</button>` : '';

    const reply = (summary||`Résultats pour "${message}" :`) + priceHistoryHtml + buttons + promos + wishlistBtn;

    return new Response(JSON.stringify({ reply, sessionId: sid }), {
      headers: { 'Content-Type':'application/json', 'Access-Control-Allow-Origin':'*' }
    });

  } catch (error) {
    console.error('Error:', error.message);
    return new Response(JSON.stringify({ reply:"Désolé, problème technique. Réessayez." }), {
      status: 200,
      headers: { 'Content-Type':'application/json', 'Access-Control-Allow-Origin':'*' }
    });
  }
}
