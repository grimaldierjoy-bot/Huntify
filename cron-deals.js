export const config = { runtime: 'edge' };

import { getAdvertisers, buildAffiliateLink, buildAgentContext } from './advertisers.js';

const SUPABASE_URL = "https://enocxbrqyybendertytl.supabase.co";
const SUPABASE_KEY = "sb_publishable_NmPh--frZG5HuqfaoxnemA_E7cidV9Y";

async function sbFetch(path, method='GET', body=null) {
  const opts = { method, headers:{'Content-Type':'application/json','apikey':SUPABASE_KEY,'Authorization':`Bearer ${SUPABASE_KEY}`} };
  if (body) opts.body = JSON.stringify(body);
  try { const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, opts); return await r.json(); } catch(e) { return null; }
}

export default async function handler(req) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    const [advertisers, trends] = await Promise.all([
      getAdvertisers(true),
      sbFetch('trends?order=count.desc&limit=10')
    ]);

    const storeCtx = buildAgentContext(advertisers);

    // ── 1 SEUL appel Claude pour tous les deals ──
    const agentResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {'Content-Type':'application/json','x-api-key':process.env.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01'},
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 3000,
        tools: [{ type:"web_search_20250305", name:"web_search" }],
        system: `Tu es l'agent deals de Huntify.
${storeCtx}
Fais MAX 3 recherches web pour trouver les meilleures promos du jour.
Retourne UNIQUEMENT ce JSON :
{
  "deals": [
    {
      "id": "slug-unique",
      "name": "Nom produit",
      "cat": "Mode|Santé|Électronique|Maison",
      "price": "XX€",
      "was": "XX€", 
      "pct": "-XX%",
      "store": "slug_boutique",
      "hot": true,
      "keywords": "mots clés",
      "img": "https://images.unsplash.com/photo-XXXXX?w=400&q=80"
    }
  ]
}
8-12 deals max. Prix RÉELS uniquement.`,
        messages: [{
          role: 'user',
          content: `Tendances : ${trends?.map(t=>t.query).join(', ')||'mode santé électronique maison'}.
Génère les meilleurs deals du jour en 1 recherche groupée.`
        }]
      })
    });

    const data = await agentResp.json();
    let rawText = '';
    for (const b of data.content) { if (b.type==='text') rawText += b.text; }

    let deals = [];
    try {
      const match = rawText.match(/\{[\s\S]*"deals"[\s\S]*\}/);
      if (match) deals = JSON.parse(match[0]).deals || [];
    } catch(e) {}

    if (deals.length === 0) return new Response(JSON.stringify({ message:'No deals' }), { status:200 });

    const dealsWithLinks = deals.map(d => {
      const adv = advertisers.find(a => a.slug === d.store?.toLowerCase());
      if (!adv) return null;
      return { ...d, url: buildAffiliateLink(adv, d.keywords), generated_at: new Date().toISOString() };
    }).filter(Boolean);

    await sbFetch('daily_deals?generated_at=not.is.null', 'DELETE');
    await sbFetch('daily_deals', 'POST', dealsWithLinks);

    return new Response(JSON.stringify({
      success: true,
      count: dealsWithLinks.length,
      claudeCalls: 1,
      costEstimate: '~$0.005'
    }), { status: 200 });

  } catch(e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
}
