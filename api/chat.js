export const config = { runtime: 'edge' };

// ══════════════════════════════════════════════
// CONFIG
// ══════════════════════════════════════════════
const AMZ_TAG      = "huntify21-21";
const AWIN_AFF     = "2920215";
const RAKUTEN_MID  = "55615";
const SUPABASE_URL = "https://enocxbrqyybendertytl.supabase.co";
const SUPABASE_KEY = "sb_publishable_NmPh--frZG5HuqfaoxnemA_E7cidV9Y";

function amazonLink(k) {
  return `https://www.amazon.fr/s?k=${encodeURIComponent(k)}&tag=${AMZ_TAG}`;
}
function rakutenLink(dest) {
  return `https://www.awin1.com/cread.php?awinmid=${RAKUTEN_MID}&awinaffid=${AWIN_AFF}&ued=${encodeURIComponent(dest)}`;
}
function btn(label, price, url, color) {
  return `<a href="${url}" target="_blank" style="display:flex;align-items:center;justify-content:space-between;background:${color};color:#fff;text-decoration:none;border-radius:12px;padding:11px 16px;margin-top:8px;font-weight:700;font-size:13px">${label}<span style="background:rgba(255,255,255,.25);border-radius:8px;padding:3px 10px;white-space:nowrap;margin-left:8px">${price}</span></a>`;
}

// ── Sauvegarde dans Supabase ──────────────────
async function saveSearch(query, sessionId, userId = null) {
  try {
    // Sauvegarde la recherche
    await fetch(`${SUPABASE_URL}/rest/v1/searches`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`
      },
      body: JSON.stringify({ query, session_id: sessionId, user_id: userId })
    });

    // Met à jour les tendances
    await fetch(`${SUPABASE_URL}/rest/v1/trends`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Prefer': 'resolution=merge-duplicates'
      },
      body: JSON.stringify({ query: query.toLowerCase().trim(), count: 1, last_searched: new Date().toISOString() })
    });
  } catch(e) {
    console.error('Supabase save error:', e.message);
  }
}

async function saveClick(productName, store, price, url, sessionId, userId = null) {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/clicks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`
      },
      body: JSON.stringify({ product_name: productName, store, price, url, session_id: sessionId, user_id: userId })
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
    const { message, history, sessionId, userId } = await req.json();
    const sid = sessionId || `anon_${Date.now()}`;

    // ── Sauvegarde la recherche + tendances ──
    saveSearch(message, sid, userId || null);

    // ── Récupère les tendances pour enrichir l'agent ──
    const trends = await getTrends();
    const trendContext = trends.length > 0
      ? `Produits tendance sur Huntify en ce moment : ${trends.map(t => t.query).join(', ')}.`
      : '';

    // ── AGENT : Recherche web réelle ─────────
    const searchResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 1500,
        tools: [{ type: "web_search_20250305", name: "web_search" }],
        system: `Tu es un agent shopping expert pour Huntify.
${trendContext}
Recherche des produits RÉELS sur Amazon.fr et fr.shopping.rakuten.com.
Retourne UNIQUEMENT ce JSON strict (zéro texte autour) :
{"summary":"conseil utile en 1-2 phrases","products":[{"name":"nom exact du produit","price":"prix réel constaté","store":"amazon","keywords":"mots clés","url":"url directe ou null"},{"name":"nom exact","price":"prix réel","store":"rakuten","keywords":"mots clés","url":"url directe ou null"}]}
Prix RÉELS uniquement. Maximum 2 Amazon + 2 Rakuten.`,
        messages: [
          ...(history || []).slice(-4),
          { role: 'user', content: `Cherche sur Amazon.fr et fr.shopping.rakuten.com : ${message}` }
        ]
      })
    });

    const searchData = await searchResp.json();
    if (!searchResp.ok) throw new Error(searchData.error?.message || 'Search error');

    let rawText = '';
    for (const block of searchData.content) {
      if (block.type === 'text') rawText += block.text;
    }

    // ── Parser JSON ──────────────────────────
    let products = [];
    let summary = '';
    try {
      const match = rawText.match(/\{[\s\S]*"products"[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        products = parsed.products || [];
        summary = parsed.summary || '';
      }
    } catch(e) {}

    // ── Fallback si JSON rate ────────────────
    if (products.length === 0) {
      products = [
        { name: message, price: 'Voir prix', store: 'amazon', keywords: message, url: null },
        { name: message, price: 'Voir prix', store: 'rakuten', keywords: message, url: null }
      ];
      summary = `Voici les résultats pour "${message}" :`;
    }

    // ── Construire les boutons ───────────────
    let buttons = '';
    for (const p of products) {
      if (!p.name) continue;
      if (p.store === 'rakuten') {
        const dest = (p.url && p.url.includes('rakuten'))
          ? p.url
          : `https://fr.shopping.rakuten.com/search?keyword=${encodeURIComponent(p.keywords || p.name)}`;
        const affUrl = rakutenLink(dest);
        buttons += btn(`🛍️ ${p.name}`, p.price || 'Voir prix', affUrl, 'linear-gradient(135deg,#bf0000,#e00)');
      } else {
        const affUrl = (p.url && p.url.includes('amazon.fr'))
          ? `${p.url}${p.url.includes('?') ? '&' : '?'}tag=${AMZ_TAG}`
          : amazonLink(p.keywords || p.name);
        buttons += btn(`🛒 ${p.name}`, p.price || 'Voir prix', affUrl, 'linear-gradient(135deg,#ff9900,#ff6600)');
      }
    }

    const reply = (summary || `Résultats pour "${message}" :`) + buttons;

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
