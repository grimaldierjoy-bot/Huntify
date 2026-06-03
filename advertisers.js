// ══════════════════════════════════════════════
// HUNTIFY — ADVERTISERS.JS
// Helper partagé — lit les annonceurs depuis Supabase
// Ce fichier est importé par chat.js, cron-deals.js, cron-alerts.js
// Pour ajouter un annonceur : Supabase → Table Editor → advertisers
// ══════════════════════════════════════════════

const SUPABASE_URL = "https://enocxbrqyybendertytl.supabase.co";
const SUPABASE_KEY = "sb_publishable_NmPh--frZG5HuqfaoxnemA_E7cidV9Y";

// Récupère tous les annonceurs actifs depuis Supabase
export async function getAdvertisers(activeOnly = true) {
  try {
    const query = activeOnly ? 'advertisers?active=eq.true' : 'advertisers';
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${query}`, {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`
      }
    });
    return await res.json();
  } catch(e) {
    console.error('getAdvertisers error:', e.message);
    return [];
  }
}

// Construit un lien affilié pour un annonceur
export function buildAffiliateLink(advertiser, keywords, directUrl = null) {
  if (!advertiser || !advertiser.active) return null;

  // Amazon — tag dans l'URL
  if (advertiser.slug === 'amazon') {
    if (directUrl) {
      return `${directUrl}${directUrl.includes('?') ? '&' : '?'}tag=${advertiser.amazon_tag}`;
    }
    return advertiser.search_url
      .replace('{keywords}', encodeURIComponent(keywords))
      .replace('{tag}', advertiser.amazon_tag);
  }

  // Awin (Rakuten, Fnac, Cdiscount, Zalando...)
  if (advertiser.awin_mid && advertiser.awin_aff) {
    const dest = directUrl || advertiser.search_url
      .replace('{keywords}', encodeURIComponent(keywords));
    return `https://www.awin1.com/cread.php?awinmid=${advertiser.awin_mid}&awinaffid=${advertiser.awin_aff}&ued=${encodeURIComponent(dest)}`;
  }

  return null;
}

// Génère le contexte annonceurs pour l'agent IA
export function buildAgentContext(advertisers) {
  const names = advertisers.map(a => a.name).join(', ');
  const slugs = advertisers.map(a => `"${a.slug}"`).join(' ou ');
  return `Boutiques actives sur Huntify : ${names}.
Pour chaque produit trouvé, le champ "store" doit être exactement : ${slugs}.`;
}

// Trouve un annonceur par son slug
export function findAdvertiser(advertisers, slug) {
  return advertisers.find(a => a.slug === slug?.toLowerCase()) || null;
}
