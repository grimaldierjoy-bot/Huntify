export const config = { runtime: 'edge' };

import { getAdvertisers, buildAffiliateLink, findAdvertiser } from './advertisers.js';

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
    const [advertisers, alerts] = await Promise.all([
      getAdvertisers(true),
      sbFetch('alerts?active=eq.true')
    ]);

    if (!alerts?.length) {
      return new Response(JSON.stringify({ message:'No active alerts' }), { status:200 });
    }

    // ── 1 SEUL appel Claude pour TOUTES les alertes ──
    // Regroupe jusqu'à 20 produits par batch
    const BATCH_SIZE = 20;
    const triggered = [];

    for (let i = 0; i < alerts.length; i += BATCH_SIZE) {
      const batch = alerts.slice(i, i + BATCH_SIZE);
      const productList = batch.map((a, idx) => `${idx+1}. "${a.product}" (seuil: ${a.price_max}€)`).join('\n');

      // 1 seul appel pour tout le batch
      const searchResp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {'Content-Type':'application/json','x-api-key':process.env.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01'},
        body: JSON.stringify({
          model: 'claude-haiku-4-5',
          max_tokens: 2000,
          tools: [{ type:"web_search_20250305", name:"web_search" }],
          system: `Tu es un agent de surveillance de prix.
Pour chaque produit de la liste, trouve le prix actuel sur Amazon.fr.
Fais UN MAXIMUM de 3 recherches web pour couvrir tous les produits.
Retourne UNIQUEMENT ce JSON :
{
  "prices": [
    {"index": 1, "product": "nom", "price": 99.99, "store": "amazon", "url": "url ou null"},
    {"index": 2, "product": "nom", "price": 45.00, "store": "amazon", "url": "url ou null"}
  ]
}
Si un produit n'est pas trouvé : {"index": N, "product": "nom", "price": null, "store": null, "url": null}`,
          messages: [{
            role: 'user',
            content: `Vérifie les prix actuels sur Amazon.fr pour ces ${batch.length} produits :\n${productList}`
          }]
        })
      });

      const sData = await searchResp.json();
      let priceResults = [];
      for (const b of sData.content) {
        if (b.type === 'text') {
          try {
            const m = b.text.match(/\{[\s\S]*"prices"[\s\S]*\}/);
            if (m) priceResults = JSON.parse(m[0]).prices || [];
          } catch(e) {}
        }
      }

      // Traiter les résultats
      for (const result of priceResults) {
        if (!result.price) continue;
        const alert = batch[result.index - 1];
        if (!alert) continue;

        const slug = alert.product.toLowerCase().replace(/\s+/g,'-').slice(0,50);

        // Sauvegarder historique prix
        sbFetch('price_history', 'POST', {
          product_id: slug,
          product_name: alert.product,
          price: result.price,
          store: result.store || 'amazon',
          url: result.url || null
        });

        // Prix en dessous du seuil → déclencher
        if (result.price <= alert.price_max) {
          const adv = findAdvertiser(advertisers, result.store || 'amazon');
          triggered.push({
            email: alert.email,
            product: alert.product,
            currentPrice: result.price,
            maxPrice: alert.price_max,
            store: result.store,
            url: adv ? buildAffiliateLink(adv, alert.product, result.url) : null,
            alertId: alert.id
          });
          sbFetch(`alerts?id=eq.${alert.id}`, 'PATCH', { active: false });
        }
      }
    }

    // TODO: envoyer emails via Resend
    for (const t of triggered) {
      console.log(`ALERT: ${t.email} | ${t.product} | ${t.currentPrice}€`);
    }

    const batchCount = Math.ceil(alerts.length / BATCH_SIZE);

    return new Response(JSON.stringify({
      success: true,
      alertsChecked: alerts.length,
      claudeCalls: batchCount,        // ← nombre d'appels réels
      costEstimate: `~$${(batchCount * 0.005).toFixed(3)}`,
      triggered: triggered.length
    }), { status: 200 });

  } catch(e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
}
