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

Ton rôle : pour TOUTE demande de produit, tu réponds en français avec une recommandation concise ET tu génères toujours un ou plusieurs liens Amazon.

FORMAT DE RÉPONSE OBLIGATOIRE :
1. Une réponse courte et utile (2-4 lignes max)
2. Ensuite, pour chaque produit recommandé, une ligne LINK: comme ceci :
   LINK:mots+clés+amazon|Nom du produit|fourchette de prix

RÈGLES :
- Génère TOUJOURS au moins un LINK: même si le produit n'est pas dans ta liste
- Pour les mots-clés, utilise des termes Amazon français précis
- Donne une fourchette de prix réaliste (ex: "50-80€")
- Tu peux recommander 1 à 3 produits max par réponse
- Sois direct et helpful, pas de blabla

EXEMPLES DE LINK: :
LINK:sony+wh1000xm5|Sony WH-1000XM5|279€
LINK:nike+air+force+1+homme|Nike Air Force 1|80-120€
LINK:aspirateur+robot+roomba|Aspirateur Robot Roomba|200-350€
LINK:cafetiere+delonghi+expresso|Cafetière DeLonghi|150-300€`;

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
    const AMZ_TAG = "huntify21-21";

    // Extraire les LINK: et construire les boutons
    const linkRegex = /LINK:([^\|]+)\|([^\|]+)\|([^\n]+)/g;
    let buttons = '';
    let match;
    while ((match = linkRegex.exec(raw)) !== null) {
      const keywords = match[1].trim();
      const name     = match[2].trim();
      const price    = match[3].trim();
      const url = `https://www.amazon.fr/s?k=${keywords}&tag=${AMZ_TAG}`;
      buttons += `<a href="${url}" target="_blank" style="display:flex;align-items:center;justify-content:space-between;background:linear-gradient(135deg,#ff9900,#ff6600);color:#fff;text-decoration:none;border-radius:12px;padding:11px 16px;margin-top:8px;font-weight:700;font-size:13px;gap:8px">
        <span>🛒 ${name}</span>
        <span style="background:rgba(255,255,255,.25);border-radius:8px;padding:3px 10px;white-space:nowrap">${price}</span>
      </a>`;
    }

    // Texte propre sans les lignes LINK:
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
