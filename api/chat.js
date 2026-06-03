export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const { message, history } = await req.json();

    const systemPrompt = `Tu es l'Intelligence Artificielle de Huntify, un comparateur de prix expert et bienveillant.

Ton rôle : aider les utilisateurs à trouver le meilleur prix sur mode, santé et électronique.

Produits disponibles sur Huntify :
MODE: Birkenstock Arizona (67€ sur Amazon), Nike Air Max 270 (94€), Veste North Face (112€ sur Amazon), Sac Cabas (34€)
SANTÉ: Oméga-3 Premium 90 caps (14€ sur Amazon), Vitamines D3+K2 365 gélules (12€), Collagène Marin 500g (22€), Magnésium Bisglycinate (16€)
ÉLECTRONIQUE: Sony WH-1000XM5 casque ANC (279€), Samsung Galaxy A55 5G (299€), Apple iPad 10e gen (359€), Amazfit GTR 4 montre (89€)

Règles importantes :
- Réponds toujours en français sauf si l'utilisateur écrit en anglais
- Sois concis et direct (3-5 lignes max par réponse)
- Propose toujours le meilleur prix disponible
- Mentionne les économies réalisées
- Encourage à cliquer sur le produit pour l'acheter
- Pour Sephora : ne jamais mentionner Dior, Chanel, Guerlain, Hermès
- Termine toujours par une question ou une suggestion utile
- Ne jamais inventer des prix — utilise uniquement les produits listés ci-dessus`;

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
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        system: systemPrompt,
        messages: messages
      })
    });

    const data = await response.json();
    
    if (!response.ok) {
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
    return new Response(JSON.stringify({ 
      reply: "Désolé, je rencontre un problème technique. Réessayez dans quelques secondes." 
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
