export const config = { runtime: 'edge' };

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

    const systemPrompt = `Tu es l'IA Huntify, expert comparateur de prix shopping.

Pour TOUTE demande de produit, tu réponds en français avec une recommandation concise ET tu génères toujours des liens vers plusieurs boutiques.

FORMAT OBLIGATOIRE — après ta réponse, liste les liens comme ceci :
LINK:mots+clés|Nom du produit|prix estimé|amazon
LINK:mots+clés|Nom du produit|prix estimé|rakuten

RÈGLES :
- Génère TOUJOURS au moins 2 LINK: (un Amazon + un Rakuten) par réponse
- Pour Rakuten, utilise les mêmes mots-clés qu'Amazon
- Donne une fourchette de prix réaliste en euros
- Réponds en 2-4 lignes max, sois direct et utile
- Ne mets JAMAIS de balises HTML dans ta réponse texte

EXEMPLES :
LINK:sony+wh1000xm5|Sony WH-1000XM5|250-290€|amazon
LINK:sony+wh1000xm5+casque|Sony WH-1000XM5|250-290€|rakuten
LINK:nike+air+force+1|Nike Air Force 1|80-120€|amazon
LINK:nike+air+force+1|Nike Air Force 1|80-120€|rakuten`;

    const messages = [
      ...(history || []),
      { role: 'user', content: message }
    ];

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 1000,
        system: systemPrompt,
        messages
      })
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('API error:', JSON.stringify(data));
      throw new Error(data.error?.message || 'API error');
    }

    const raw = data.content[0].text;

    // Infos affiliation
    const AMZ_TAG      = "huntify21-21";
    const AWIN_AFF     = "2920215";
    const RAKUTEN_MID  = "55615";

    // Construire les boutons
    const linkRegex = /LINK:([^\|]+)\|([^\|]+)\|([^\|]+)\|([^\n]+)/g;
    let buttons = '';
    let match;

    while ((match = linkRegex.exec(raw)) !== null) {
      const keywords = match[1].trim();
      const name     = match[2].trim();
      const price    = match[3].trim();
      const store    = match[4].trim().toLowerCase();

      let url, label, color;

      if (store === 'rakuten') {
        const dest = `https://fr.shopping.rakuten.com/search?keyword=${keywords}`;
        url   = `https://www.awin1.com/cread.php?awinmid=${RAKUTEN_MID}&awinaffid=${AWIN_AFF}&ued=${encodeURIComponent(dest)}`;
        label = '🛍️ Voir sur Rakuten';
        color = 'linear-gradient(135deg,#bf0000,#e00)';
      } else {
        url   = `https://www.amazon.fr/s?k=${keywords}&tag=${AMZ_TAG}`;
        label = '🛒 Voir sur Amazon';
        color = 'linear-gradient(135deg,#ff9900,#ff6600)';
      }

      buttons += `<a href="${url}" target="_blank" style="display:flex;align-items:center;justify-content:space-between;background:${color};color:#fff;text-decoration:none;border-radius:12px;padding:11px 16px;margin-top:8px;font-weight:700;font-size:13px;gap:8px">
        <span>${label} — ${name}</span>
        <span style="background:rgba(255,255,255,.25);border-radius:8px;padding:3px 10px;white-space:nowrap">${price}</span>
      </a>`;
    }

    // Texte propre sans les LINK:
    const cleanText = raw.replace(/LINK:[^\n]*/g, '').replace(/\n{3,}/g, '\n\n').trim();
    const reply = cleanText + (buttons ? buttons : '');

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
