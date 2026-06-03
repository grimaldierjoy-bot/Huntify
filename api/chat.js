export const config = { runtime: 'edge' };

const AMZ_TAG     = "huntify21-21";
const AWIN_AFF    = "2920215";
const RAKUTEN_MID = "55615";
const SUPABASE_URL = "https://enocxbrqyybendertytl.supabase.co";
const SUPABASE_KEY = "sb_publishable_NmPh--frZG5HuqfaoxnemA_E7cidV9Y";

function amazonLink(k) { return `https://www.amazon.fr/s?k=${encodeURIComponent(k)}&tag=${AMZ_TAG}`; }
function rakutenLink(dest) { return `https://www.awin1.com/cread.php?awinmid=${RAKUTEN_MID}&awinaffid=${AWIN_AFF}&ued=${encodeURIComponent(dest)}`; }

function productBtn(name, price, url, color, emoji) {
  return `<a href="${url}" target="_blank" style="display:flex;align-items:center;justify-content:space-between;background:${color};color:#fff;text-decoration:none;border-radius:12px;padding:11px 16px;margin-top:8px;font-weight:700;font-size:13px">${emoji} ${name}<span style="background:rgba(255,255,255,.25);border-radius:8px;padding:3px 10px;white-space:nowrap;margin-left:8px">${price}</span></a>`;
}

function promoBox(code, store, desc) {
  return `<div style="background:linear-gradient(135deg,#f0fdf4,#dcfce7);border:1.5px solid #86efac;border-radius:12px;padding:12px 14px;margin-top:8px;display:flex;align-items:center;justify-content:space-between;gap:8px">
    <div>
      <div style="font-size:11px;color:#16a34a;font-weight:700;text-transform:uppercase;letter-spacing:.05em">🏷️ Code promo ${store}</div>
      <div style="font-size:13px;color:#166534;font-weight:600;margin-top:2px">${desc}</div>
    </div>
    <div onclick="navigator.clipboard.writeText('${code}');this.textContent='✓ Copié!';setTimeout(()=>this.textContent='${code}',2000)" style="background:#16a34a;color:#fff;border-radius:8px;padding:6px 12px;font-weight:800;font-size:13px;cursor:pointer;white-space:nowrap">${code}</div>
  </div>`;
}

async function saveToSupabase(query, sessionId, userId, trackingEnabled) {
  if (!trackingEnabled) return;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/searches`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` },
      body: JSON.stringify({ query, session_id: sessionId, user_id: userId })
    });
    await fetch(`${SUPABASE_URL}/rest/v1/trends`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Prefer': 'resolution=merge-duplicates' },
      body: JSON.stringify({ query: query.toLowerCase().trim(), count: 1, last_searched: new Date().toISOString() })
    });
  } catch(e) {}
}

async function getTrends() {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/trends?order=count.desc&limit=5`, {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
    });
    return await res.json();
  } catch(e) { return []; }
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

    // Sauvegarde + tendances en parallèle
    const [_, trends] = await Promise.all([
      saveToSupabase(message, sid, userId || null, trackingEnabled),
      getTrends()
    ]);

    const trendCtx = trends.length > 0
      ? `Tendances actuelles sur Huntify : ${trends.map(t=>t.query).join(', ')}.`
      : '';

    // ── AGENT PRINCIPAL : produits + codes promos ──
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
        system: `Tu es l'agent shopping IA de Huntify. Tu as 2 missions :
1. Trouver les meilleurs produits sur Amazon.fr et Rakuten
2. Chercher des codes promo actifs sur dealabs.com et ma-reduc.com pour ces produits

${trendCtx}

Fais 2-3 recherches web :
- Une sur Amazon.fr pour le produit
- Une sur Rakuten pour le produit  
- Une sur dealabs.com OU ma-reduc.com pour les codes promo

Retourne UNIQUEMENT ce JSON strict (zéro texte autour) :
{
  "summary": "conseil en 1-2 phrases",
  "products": [
    {"name":"nom exact","price":"prix réel","store":"amazon","keywords":"mots clés","url":"url ou null"},
    {"name":"nom exact","price":"prix réel","store":"rakuten","keywords":"mots clés","url":"url ou null"}
  ],
  "promoCodes": [
    {"code":"CODE","store":"Amazon","discount":"description remise","valid":true}
  ]
}
Si aucun code promo trouvé : "promoCodes": []
Prix RÉELS uniquement. Maximum 2 produits par store.`,
        messages: [
          ...(history || []).slice(-4),
          { role: 'user', content: `Recherche ce produit et les codes promo associés : ${message}` }
        ]
      })
    });

    const agentData = await agentResp.json();
    if (!agentResp.ok) throw new Error(agentData.error?.message || 'Agent error');

    let rawText = '';
    for (const block of agentData.content) {
      if (block.type === 'text') rawText += block.text;
    }

    // Parser JSON
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

    // Fallback
    if (products.length === 0) {
      products = [
        { name: message, price: 'Voir prix', store: 'amazon',  keywords: message, url: null },
        { name: message, price: 'Voir prix', store: 'rakuten', keywords: message, url: null }
      ];
      summary = `Voici les résultats pour "${message}" :`;
    }

    // Construire boutons produits
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

    // Construire codes promos
    let promos = '';
    for (const c of promoCodes) {
      if (c.code && c.valid !== false) {
        promos += promoBox(c.code, c.store || 'boutique', c.discount || 'Réduction disponible');
      }
    }

    // Ajouter data-product pour wishlist
    const wishlistData = products.map(p => ({
      name: p.name,
      price: p.price,
      store: p.store,
      url: p.store === 'rakuten'
        ? rakutenLink(`https://fr.shopping.rakuten.com/search?keyword=${encodeURIComponent(p.keywords||p.name)}`)
        : amazonLink(p.keywords||p.name)
    }));

    const wishlistBtn = wishlistData.length > 0
      ? `<button onclick="addToWishlist(${JSON.stringify(wishlistData[0]).replace(/"/g,'&quot;')})" style="background:#fff;border:1.5px solid #e8edf8;color:#3b5bdb;border-radius:12px;padding:8px 16px;margin-top:8px;font-weight:700;font-size:12px;cursor:pointer;font-family:inherit;width:100%">♡ Ajouter à ma wishlist</button>`
      : '';

    const reply = (summary || `Résultats pour "${message}" :`) + buttons + promos + wishlistBtn;

    return new Response(JSON.stringify({ reply, sessionId: sid }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });

  } catch (error) {
    console.error('Error:', error.message);
    return new Response(JSON.stringify({ reply: "Désolé, problème technique. Réessayez." }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}
