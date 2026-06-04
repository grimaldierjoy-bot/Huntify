export const config = { runtime: 'edge' };

const SUPABASE_URL = "https://enocxbrqyybendertytl.supabase.co";
const SUPABASE_KEY = "sb_publishable_NmPh--frZG5HuqfaoxnemA_E7cidV9Y";

// Passerelles d'affiliation toujours autorisÃ©es (communes Ã  plusieurs annonceurs)
const ALWAYS_ALLOWED = ['awin1.com', 'awin.com'];

function extractHost(url) {
  try { return new URL(url.replace('{keywords}','x')).hostname.replace(/^www\./,''); }
  catch(e){ return null; }
}

// âš¡ UNIVERSEL : construit la liste des domaines autorisÃ©s depuis la table advertisers
async function getAllowedHosts() {
  const hosts = new Set(ALWAYS_ALLOWED);
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/advertisers?active=eq.true&select=search_url,site_url`, {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
    });
    const advs = await r.json();
    (advs || []).forEach(a => {
      // depuis search_url
      const h1 = a.search_url ? extractHost(a.search_url) : null;
      if (h1) hosts.add(h1);
      // depuis site_url si la colonne existe
      const h2 = a.site_url ? extractHost(a.site_url) : null;
      if (h2) hosts.add(h2);
    });
  } catch(e) { /* en cas d'Ã©chec, on garde au moins les passerelles */ }
  return hosts;
}

function isAllowed(urlStr, hosts) {
  try {
    const u = new URL(urlStr);
    const host = u.hostname.replace(/^www\./,'');
    return [...hosts].some(h => host === h || host.endsWith('.' + h));
  } catch(e) { return false; }
}

async function logClick(data) {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/clicks`, {
      method: 'POST',
      headers: {'Content-Type':'application/json','apikey':SUPABASE_KEY,'Authorization':`Bearer ${SUPABASE_KEY}`},
      body: JSON.stringify(data)
    });
  } catch(e) { /* le tracking ne doit jamais bloquer la redirection */ }
}

export default async function handler(req) {
  const url = new URL(req.url);
  const dest = url.searchParams.get('url');
  const store = url.searchParams.get('store') || 'unknown';
  const product = url.searchParams.get('p') || null;
  const sid = url.searchParams.get('sid') || null;

  if (!dest) return Response.redirect('https://huntify.shop', 302);

  // âš¡ VÃ©rifie contre les domaines de TES annonceurs (table advertisers)
  const allowedHosts = await getAllowedHosts();
  if (!isAllowed(dest, allowedHosts)) {
    return Response.redirect('https://huntify.shop', 302);
  }

  // Enregistre le clic sans bloquer
  logClick({
    dest_url: dest, store, product, session_id: sid,
    clicked_at: new Date().toISOString(),
    user_agent: req.headers.get('user-agent') || null
  });

  // Page intermÃ©diaire : sur iOS, rester sur huntify.shop puis rediriger
  // en JS tend Ã  garder l'utilisateur dans le navigateur plutÃ´t que l'app.
  const html = `<!DOCTYPE html>
<html lang="fr"><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Redirection vers l'offreâ€¦</title>
<style>
  body{font-family:system-ui,sans-serif;background:#f4f7ff;color:#0e1430;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
  .box{text-align:center;padding:24px}
  .spin{width:38px;height:38px;border:4px solid #e6ebf7;border-top-color:#2f54ff;border-radius:50%;margin:0 auto 16px;animation:s .8s linear infinite}
  @keyframes s{to{transform:rotate(360deg)}}
  a{color:#2f54ff;font-weight:700;text-decoration:none}
</style>
</head><body>
<div class="box">
  <div class="spin"></div>
  <div style="font-weight:700;font-size:15px">Redirection vers la meilleure offreâ€¦</div>
  <div style="font-size:12px;color:#7c89a8;margin-top:8px">Si rien ne se passe, <a href="${dest}">clique ici</a>.</div>
</div>
<script>window.location.replace(${JSON.stringify(dest)});</script>
</body></html>`;

  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}
