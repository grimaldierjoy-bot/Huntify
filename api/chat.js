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
Produits disponibles :
MODE: Birkenstock Arizona (67€), Nike Air Max 270 (94€), Veste North Face (112€), Sac Cabas (34€)
SANTÉ: Oméga-3 90 caps (14€), Vitamines D3+K2 (12€), Collagène Marin (22€), Magnésium (16€)
ÉLECTRONIQUE: Sony WH-1000XM5 (279€), Samsung Galaxy A55 (299€), iPad 10e gen (359€), Amazfit GTR 4 (89€)
Règles: réponds en français, sois concis (3-5 lignes), utilise uniquement les produits listés.`;

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

    return new Response(JSON.stringify({
      reply: data.content[0].text
    }), {
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
