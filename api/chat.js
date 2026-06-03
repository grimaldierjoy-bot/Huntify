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

    const systemPrompt = `Tu es l'IA Huntify, expert comparateur de prix.

Produits disponibles avec leurs IDs Amazon :
MODE:
- Birkenstock Arizona Sandales (67€, était 92€) → AMZ:birkenstock+arizona
- Nike Air Max 270 Homme (94€, était 150€) → AMZ:nike+air+max+270
- Veste The North Face Femme (112€, était 220€) → AMZ:veste+north+face+femme
- Sac Cabas Tendance Femme (34€, était 60€) → AMZ:sac+cabas+femme

SANTÉ:
- Oméga-3 Premium 90 capsules (14€, était 32€) → AMZ:omega+3+capsules
- Vitamines D3+K2 365 gélules (12€, était 24€) → AMZ:vitamine+d3+k2
- Collagène Marin Hydrolysé 500g (22€, était 45€) → AMZ:collagene+marin
- Magnésium Bisglycinate 120 gél. (16€, était 29€) → AMZ:magnesium+bisglycinate

ÉLECTRONIQUE:
- Sony WH-1000XM5 Casque ANC (279€, était 420€) → AMZ:sony+wh-1000xm5
- Samsung Galaxy A55 5G 128Go (299€, était 449€) → AMZ:samsung+galaxy+a55
- Apple iPad 10e génération 64Go (359€, était 499€) → AMZ:apple+ipad+10+generation
- Amazfit GTR 4 Montre Connectée (89€, était 180€) → AMZ:amazfit+gtr+4

RÈGLES IMPORTANTES :
- Réponds toujours en français
- Sois concis (3-5 lignes max)
- Pour CHAQUE produit mentionné, termine OBLIGATOIREMENT par une ligne exactement comme ceci :
  LINK:mot+clé+amazon|Nom du produit|prix€
- Tu peux mettre plusieurs LINK: si tu mentionnes plusieurs produits
- Ne jamais inventer de prix, utilise uniquement les produits listés`;

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

    // Extraire les LINK: et construire les boutons HTML
    const linkRegex = /LINK:([^\|]+)\|([^\|]+)\|([^\n]+)/g;
    let buttons = '';
    let match;
    while ((match = linkRegex.exec(raw)) !== null) {
      const keywords = match[1].trim();
      const name     = match[2].trim();
      const price    = match[3].trim();
      const url = `https://www.amazon.fr/s?k=${keywords}&tag=${AMZ_TAG}`;
      buttons += `<a href="${url}" target="_blank" style="display:flex;align-items:center;justify-content:space-between;background:linear-gradient(135deg,#ff9900,#ff6600);color:#fff;text-decoration:none;border-radius:12px;padding:11px 16px;margin-top:8px;font-weight:700;font-size:13px">
        <span>🛒 ${name}</span>
        <span style="background:rgba(255,255,255,.25);border-radius:8px;padding:3px 10px">${price}</span>
      </a>`;
    }

    // Nettoyer le texte (enlever les lignes LINK:)
    const cleanText = raw.replace(/LINK:[^\n]+/g, '').trim();
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
      error: error.message,
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
