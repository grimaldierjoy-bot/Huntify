export const config = { runtime: 'edge' };

import { getAdvertisers, buildAffiliateLink, buildAgentContext, findAdvertiser } from './advertisers.js';

const SUPABASE_URL = "https://enocxbrqyybendertytl.supabase.co";
const SUPABASE_KEY = "sb_publishable_NmPh--frZG5HuqfaoxnemA_E7cidV9Y";

async function sbFetch(path, method='GET', body=null) {
  const opts = { method, headers:{'Content-Type':'application/json','apikey':SUPABASE_KEY,'Authorization':`Bearer ${SUPABASE_KEY}`} };
  if (body) opts.body = JSON.stringify(body);
  try { const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, opts); return await r.json(); } catch(e) { return null; }
}

export default async function handler(req) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) return new Response('Unauthorized', {status:401});

  try {
    const [advertisers, alerts] = await Promise.all([
      getAdvertisers(true),
      sbFetch('alerts?active=eq.true')
    ]);

    if (!alerts?.length) return new Response(JSON.stringify({message:'No active alerts'}), {status:200});

    const storeCtx = buildAgentContext(advertisers);
    const triggered = [];

    for (const alert of alerts) {
      const searchResp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {'Content-Type':'application/json','x-api-key':process.env.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01'},
        body: JSON.stringify({
          model: 'claude-haiku-4-5',
          max_tokens: 500,
          tools: [{ type:"web_search_20250305", name:"web_search" }],
          system: `${storeCtx}
Cherche le prix actuel de ce produit sur toutes les boutiques actives.
Retourne UNIQUEMENT ce JSON :
{"results":[{"store":"slug","price":99.99,"url":"url ou null"}],"lowestPrice":99.99,"lowestStore":"slug"}
Si non trouvé : {"results":[],"lowestPrice":null,"lowestStore":null}`,
          messages: [{role:'user', content:`Prix actuel de : ${alert.product}`}]
        })
      });

      const sData = await searchResp.json();
      let priceData = null;
      for (const b of sData.content) {
        if (b.type==='text') { try { const m=b.text.match(/\{[\s\S]*\}/); if(m) priceData=JSON.parse(m[0]); } catch(e){} }
      }

      if (priceData?.lowestPrice !== null && priceData?.lowestPrice !== undefined) {
        const slug = alert.product.toLowerCase().replace(/\s+/g,'-').slice(0,50);

        // Sauvegarder historique
        for (const r of priceData.results||[]) {
          if (r.price) {
            const adv = findAdvertiser(advertisers, r.store);
            sbFetch('price_history','POST',{
              product_id:slug, product_name:alert.product,
              price:r.price, store:r.store,
              url: adv ? buildAffiliateLink(adv, alert.product, r.url) : null
            });
          }
        }

        if (priceData.lowestPrice <= alert.price_max) {
          const adv = findAdvertiser(advertisers, priceData.lowestStore);
          const best = priceData.results?.find(r=>r.store===priceData.lowestStore);
          triggered.push({
            email: alert.email,
            product: alert.product,
            currentPrice: priceData.lowestPrice,
            maxPrice: alert.price_max,
            store: priceData.lowestStore,
            url: adv ? buildAffiliateLink(adv, alert.product, best?.url||null) : null,
            alertId: alert.id
          });
          await sbFetch(`alerts?id=eq.${alert.id}`, 'PATCH', {active:false});
        }
      }
    }

    // TODO: envoyer emails via Resend
    for (const t of triggered) {
      console.log(`ALERT: ${t.email} | ${t.product} | ${t.currentPrice}€ sur ${t.store}`);
    }

    return new Response(JSON.stringify({success:true, checked:alerts.length, triggered:triggered.length}), {status:200});

  } catch(e) {
    return new Response(JSON.stringify({error:e.message}), {status:500});
  }
}
