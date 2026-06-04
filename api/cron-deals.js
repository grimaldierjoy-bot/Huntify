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

function buildAffiliateLink(adv, keywords) {
  if (!adv?.active) return null;
  if (adv.slug === 'amazon') return `https://www.amazon.fr/s?k=${encodeURIComponent(keywords)}&tag=${adv.amazon_tag}`;
  if (adv.awin_mid) {
    const dest = adv.search_url.replace('{keywords}', encodeURIComponent(keywords));
    return `https://www.awin1.com/cread.php?awinmid=${adv.awin_mid}&awinaffid=${adv.awin_aff}&ued=${encodeURIComponent(dest)}`;
  }
  return null;
}

async function sbFetch(path, method='GET', body=null) {
  const opts = { method, headers:{'Content-Type':'application/json','apikey':SUPABASE_KEY,'Authorization':`Bearer ${SUPABASE_KEY}`} };
  if (body) opts.body = JSON.stringify(body);
  try { const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, opts); return await r.json(); } catch(e) { return null; }
}

// âš¡ Images de placeholder par catÃ©gorie (remplace les URLs hallucinÃ©es par l'IA)
const CAT_IMAGES = {
  'Mode':          'https://images.unsplash.com/photo-1523381210434-271e8be1f52b?w=300&q=70',
  'Ã‰lectronique':  'https://images.unsplash.com/photo-1498049794561-7780e7231661?w=300&q=70',
  'Maison':        'https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=300&q=70',
  'SantÃ©':         'https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?w=300&q=70',
  'Sport':         'https://images.unsplash.com/photo-1517836357463-d25dfeac3438?w=300&q=70',
  'default':       'https://images.unsplash.com/photo-1607082348824-0a96f2a4b9da?w=300&q=70',
};
function getPlaceholderImg(cat) {
  return CAT_IMAGES[cat] || CAT_IMAGES['default'];
}

// âš¡ GÃ©nÃ¨re les deals pour un ensemble de boutiques donnÃ©
async function generateDeals(advertisers, trends, storeInstructions, maxTokens=2000) {
  const agentResp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {'Content-Type':'application/json','x-api-key':process.env.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01'},
    body: JSON.stringify({
      model: 'claude-haiku-4-5',
      max_tokens: maxTokens,
      tools: [{ type:"web_search_20250305", name:"web_search", max_uses:3 }],
      system: `Tu es l'agent deals de Huntify. Cherche les VRAIES promotions du jour.

RÃ‰PARTITION OBLIGATOIRE â€” respecte exactement :
${storeInstructions}

RÃˆGLES :
- Prix RÃ‰ELS trouvÃ©s sur le web (pas inventÃ©s)
- "img": null (on gÃ¨re les images cÃ´tÃ© serveur)
- "keywords": terme de recherche court et prÃ©cis (ex: "casque sony bluetooth", pas de virgules)
- CatÃ©gories autorisÃ©es : Mode, Ã‰lectronique, Maison, SantÃ©, Sport

JSON UNIQUEMENT :
{"deals":[{"id":"slug","name":"nom complet","cat":"CatÃ©gorie","price":"XXâ‚¬","was":"XXâ‚¬","pct":"-XX%","store":"slug_boutique","keywords":"mots clÃ©s"}]}`,
      messages: [{role:'user',content:`Tendances du moment : ${trends?.map(t=>t.query).join(', ')||'mode santÃ© Ã©lectronique'}. GÃ©nÃ¨re les deals.`}]
    })
  });
  const data = await agentResp.json();
  let rawText = '';
  for (const b of data.content) { if (b.type==='text') rawText += b.text; }
  try {
    const match = rawText.match(/\{[\s\S]*"deals"[\s\S]*\}/);
    if (match) return JSON.parse(match[0]).deals || [];
  } catch(e) {}
  return [];
}

export default async function handler(req) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) return new Response('Unauthorized', {status:401});
  try {
    const [advertisers, trends] = await Promise.all([
      getAdvertisers(),
      sbFetch('trends?order=count.desc&limit=10')
    ]);

    if (!advertisers.length) return new Response(JSON.stringify({message:'No advertisers'}), {status:200});

    // âš¡ FIX RAKUTEN : rÃ©partition explicite par boutique
    // Calcule combien de deals demander par store (rÃ©partition Ã©quilibrÃ©e)
    const totalDeals = 10;
    const perStore = Math.floor(totalDeals / advertisers.length);
    const remainder = totalDeals % advertisers.length;
    const storeInstructions = advertisers.map((a, i) => {
      const count = perStore + (i < remainder ? 1 : 0);
      return `- ${count} deals sur ${a.name} (store DOIT Ãªtre exactement "${a.slug}") â†’ cherche sur ${a.name}.fr`;
    }).join('\n');

    // Appel principal avec rÃ©partition
    let deals = await generateDeals(advertisers, trends, storeInstructions, 2000);

    // âš¡ SÃ‰CURITÃ‰ : si Rakuten manque dans les rÃ©sultats, on relance un appel ciblÃ©
    const slugsPresents = new Set(deals.map(d=>d.store?.toLowerCase()));
    const manquants = advertisers.filter(a => !slugsPresents.has(a.slug));
    if (manquants.length > 0) {
      constè£œå®ŒInstructions = manquants.map(a =>
        `- 3 deals sur ${a.name} (store DOIT Ãªtre exactement "${a.slug}") â†’ cherche UNIQUEMENT sur ${a.name}.fr`
      ).join('\n');
      constè£œå®Œ = await generateDeals(advertisers, trends, è£œå®ŒInstructions, 1000);
      deals = [...deals, ...è£œå®Œ];
    }

    if (!deals.length) return new Response(JSON.stringify({message:'No deals'}), {status:200});

    // Construction des deals finaux avec liens affiliÃ©s + images fiables
    const dealsWithLinks = deals.map(d => {
      const adv = advertisers.find(a => a.slug === d.store?.toLowerCase());
      if (!adv) return null;
      const url = buildAffiliateLink(adv, d.keywords || d.name);
      if (!url) return null;
      return {
        ...d,
        url,
        // âš¡ FIX IMAGES : placeholder fiable par catÃ©gorie (l'IA invente des URLs)
        img: getPlaceholderImg(d.cat),
        generated_at: new Date().toISOString()
      };
    }).filter(Boolean);

    // Statistiques de rÃ©partition pour le log
    const stats = {};
    dealsWithLinks.forEach(d => { stats[d.store] = (stats[d.store]||0)+1; });

    // Supprime les anciens deals et insÃ¨re les nouveaux
    await sbFetch('daily_deals?generated_at=not.is.null', 'DELETE');
    await sbFetch('daily_deals', 'POST', dealsWithLinks);

    return new Response(JSON.stringify({
      success: true,
      count: dealsWithLinks.length,
      repartition: stats,  // ex: {"amazon":5,"rakuten":4}
    }), {status:200});

  } catch(e) {
    return new Response(JSON.stringify({error:e.message}), {status:500});
  }
}
