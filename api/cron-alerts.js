export const config = { runtime: 'edge' };

const SUPABASE_URL = "https://enocxbrqyybendertytl.supabase.co";
const SUPABASE_KEY = "sb_publishable_NmPh--frZG5HuqfaoxnemA_E7cidV9Y";

async function getAdvertisers() {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/advertisers?active=eq.true`, {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
    });
    return await r.json();
  } catch(e) { return []; }
}

function buildAffiliateLink(adv, keywords, directUrl=null) {
  if (!adv?.active) return null;
  if (adv.slug === 'amazon') {
    const base = directUrl || `https://www.amazon.fr/s?k=${encodeURIComponent(keywords)}`;
    return `${base}${base.includes('?')?'&':'?'}tag=${adv.amazon_tag}`;
  }
  if (adv.awin_mid) {
    const dest = directUrl || adv.search_url.replace('{keywords}', encodeURIComponent(keywords));
    return `https://www.awin1.com/cread.php?awinmid=${adv.awin_mid}&awinaffid=${adv.awin_aff}&ued=${encodeURIComponent(dest)}`;
  }
  return null;
}

async function sbFetch(path, method='GET', body=null) {
  const opts = { method, headers:{'Content-Type':'application/json','apikey':SUPABASE_KEY,'Authorization':`Bearer ${SUPABASE_KEY}`} };
  if (body) opts.body = JSON.stringify(body);
  try { const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, opts); return await r.json(); } catch(e) { return null; }
}

export default async function handler(req) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) return new Response('Unauthorized', {status:401});

  try {
    const [advertisers, alerts] = await Promise.all([
      getAdvertisers(),
      sbFetch('alerts?active=eq.true')
    ]);

    if (!alerts?.length) return new Response(JSON.stringify({message:'No active alerts'}), {status:200});

    const activeNames = advertisers.map(a=>a.name).join(', ');
    const triggered = [];
    const BATCH_SIZE = 20;

    for (let i = 0; i < alerts.length; i += BATCH_SIZE) {
      const batch = alerts.slice(i, i + BATCH_SIZE);
      const productList = batch.map((a,idx)=>`${idx+1}. "${a.product}" (seuil: ${a.price_max}€)`).join('\n');

      const searchResp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {'Content-Type':'application/json','x-api-key':process.env.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01'},
        body: JSON.stringify({
          model: 'claude-haiku-4-5',
          max_tokens: 2000,
          tools: [{ type:"web_search_20250305", name:"web_search" }],
          system: `Cherche les prix actuels sur ${activeNames}. MAX 3 recherches web pour tous les produits.
Retourne UNIQUEMENT ce JSON :
{"prices":[{"index":1,"price":99.99,"store":"amazon","url":"url ou null"}]}
Si non trouvé : {"index":N,"price":null,"store":null,"url":null}`,
          messages: [{role:'user',content:`Prix actuels sur Amazon.fr pour ces ${batch.length} produits :\n${productList}`}]
        })
      });

      const sData = await searchResp.json();
      let priceResults = [];
      for (const b of sData.content) {
        if (b.type==='text') { try { const m=b.text.match(/\{[\s\S]*"prices"[\s\S]*\}/); if(m) priceResults=JSON.parse(m[0]).prices||[]; } catch(e){} }
      }

      for (const result of priceResults) {
        if (!result.price) continue;
        const alert = batch[result.index - 1];
        if (!alert) continue;

        const slug = alert.product.toLowerCase().replace(/\s+/g,'-').slice(0,50);
        sbFetch('price_history','POST',{product_id:slug,product_name:alert.product,price:result.price,store:result.store||'amazon',url:result.url||null});

        if (result.price <= alert.price_max) {
          const adv = advertisers.find(a=>a.slug===(result.store||'amazon'));
          triggered.push({
            email:alert.email, product:alert.product,
            currentPrice:result.price, maxPrice:alert.price_max,
            store:result.store, alertId:alert.id,
            url: adv ? buildAffiliateLink(adv, alert.product, result.url) : null
          });
          sbFetch(`alerts?id=eq.${alert.id}`, 'PATCH', {active:false});
        }
      }
    }

    for (const t of triggered) {
      console.log(`ALERT: ${t.email} | ${t.product} | ${t.currentPrice}€`);
      // TODO: email via Resend
    }

    return new Response(JSON.stringify({
      success:true,
      checked:alerts.length,
      calls:Math.ceil(alerts.length/BATCH_SIZE),
      triggered:triggered.length
    }), {status:200});

  } catch(e) {
    return new Response(JSON.stringify({error:e.message}), {status:500});
  }
}
