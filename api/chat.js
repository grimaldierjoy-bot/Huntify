export const config = { runtime: 'edge' };

// ══════════════════════════════════════════════
// HUNTIFY AGENT — Configuration affiliation
// ══════════════════════════════════════════════
const AMZ_TAG     = "huntify21-21";
const AWIN_AFF    = "2920215";
const RAKUTEN_MID = "55615";

// Construit un lien affilié Amazon
function amazonLink(keywords) {
  return `https://www.amazon.fr/s?k=${encodeURIComponent(keywords)}&tag=${AMZ_TAG}`;
}

// Construit un lien affilié Rakuten via Awin
function rakutenLink(url) {
  return `https://www.awin1.com/cread.php?awinmid=${RAKUTEN_MID}&awinaffid=${AWIN_AFF}&ued=${encodeURIComponent(url)}`;
}

// Bouton HTML stylé
function makeButton(label, url, color) {
  return `<a href="${url}" target="_blank" style="display:flex;align-items:center;justify-content:space-between;background:${color};color:#fff;text-decoration:none;border-radius:12px;padding:11px 16px;margin-top:8px;font-weight:700;font-size:13px;gap:8px">${label}</a>`;
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      }
    });
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const { message, history } = await req.json();

    // ══════════════════════════════════════════
    // ÉTAPE 1 — L'AGENT cherche sur le web
    // ══════════════════════════════════════════
    const agentSystemPrompt = `Tu es un agent de recherche shopping expert.
    
Ton travail : rechercher des produits réels disponibles à l'achat en France.

Quand l'utilisateur demande un produit :
1. Utilise l'outil web_search pour chercher sur Amazon.fr ET Rakuten.fr
2. Trouve des produits RÉELS avec leurs vrais prix
3. Vérifie que les URLs existent vraiment
4. Retourne un JSON structuré UNIQUEMENT, sans texte autour :

{
  "summary": "Résumé en 2-3 lignes du meilleur choix",
  "products": [
    {
      "name": "Nom exact du produit",
      "price": "Prix constaté",
      "store": "amazon" ou "rakuten",
      "keywords": "mots clés pour recherche",
      "url": "URL directe du produit si trouvée, sinon null"
    }
  ]
}

Retourne maximum 3 produits. Uniquement des produits RÉELS trouvés via recherche.`;

    const agentResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 2000,
        system: agentSystemPrompt,
        tools: [
          {
            type: "web_search_20250305",
            name: "web_search"
          }
        ],
        messages: [
          {
            role: 'user',
            content: `Recherche ce produit sur Amazon.fr et fr.shopping.rakuten.com : "${message}". Trouve les vrais prix et URLs disponibles aujourd'hui.`
          }
        ]
      })
    });

    const agentData = await agentResponse.json();

    if (!agentResponse.ok) {
      throw new Error(agentData.error?.message || 'Agent error');
    }

    // Extraire le texte de la réponse agent
    let agentText = '';
    for (const block of agentData.content) {
      if (block.type === 'text') agentText += block.text;
    }

    // Parser le JSON retourné par l'agent
    let searchResult = null;
    try {
      const jsonMatch = agentText.match(/\{[\s\S]*\}/);
      if (jsonMatch) searchResult = JSON.parse(jsonMatch[0]);
    } catch(e) {
      console.error('JSON parse error:', e.message);
    }

    // ══════════════════════════════════════════
    // ÉTAPE 2 — Construire la réponse finale
    // ══════════════════════════════════════════
    let reply = '';

    if (searchResult && searchResult.summary) {
      reply += searchResult.summary;
    } else {
      // Fallback si l'agent n'a pas trouvé de JSON
      reply += agentText.replace(/\{[\s\S]*\}/, '').trim() || "Voici ce que j'ai trouvé pour vous :";
    }

    // Générer les boutons avec vrais liens affiliés
    let buttons = '';
    if (searchResult && searchResult.products && searchResult.products.length > 0) {
      for (const p of searchResult.products) {
        if (p.store === 'rakuten') {
          const dest = p.url || `https://fr.shopping.rakuten.com/search?keyword=${encodeURIComponent(p.keywords)}`;
          // Vérifier que c'est bien une URL Rakuten
          if (dest.includes('rakuten.com')) {
            const affUrl = rakutenLink(dest);
            buttons += makeButton(
              `🛍️ <span style="flex:1">${p.name}</span><span style="background:rgba(255,255,255,.25);border-radius:8px;padding:3px 10px">${p.price}</span>`,
              affUrl,
              'linear-gradient(135deg,#bf0000,#e00)'
            );
          }
        } else {
          // Amazon
          const affUrl = p.url
            ? `${p.url}${p.url.includes('?') ? '&' : '?'}tag=${AMZ_TAG}`
            : amazonLink(p.keywords);
          buttons += makeButton(
            `🛒 <span style="flex:1">${p.name}</span><span style="background:rgba(255,255,255,.25);border-radius:8px;padding:3px 10px">${p.price}</span>`,
            affUrl,
            'linear-gradient(135deg,#ff9900,#ff6600)'
          );
        }
      }
    } else {
      // Fallback : boutons de recherche générique
      buttons += makeButton(
        `🛒 <span style="flex:1">Voir sur Amazon</span><span style="background:rgba(255,255,255,.25);border-radius:8px;padding:3px 10px">Meilleur prix</span>`,
        amazonLink(message),
        'linear-gradient(135deg,#ff9900,#ff6600)'
      );
      buttons += makeButton(
        `🛍️ <span style="flex:1">Voir sur Rakuten</span><span style="background:rgba(255,255,255,.25);border-radius:8px;padding:3px 10px">Comparer</span>`,
        rakutenLink(`https://fr.shopping.rakuten.com/search?keyword=${encodeURIComponent(message)}`),
        'linear-gradient(135deg,#bf0000,#e00)'
      );
    }

    reply = reply + buttons;

    return new Response(JSON.stringify({ reply }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });

  } catch (error) {
    console.error('Handler error:', error.message);
    return new Response(JSON.stringify({
      reply: "Désolé, problème technique. Réessayez."
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
}
