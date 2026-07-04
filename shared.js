// ─────────────────────────────────────────────────────────────────────────────
// _shared.js — Helpers communs Huntify (produit + voyage)
// Supabase, appels IA (Groq/Claude/Gemini/Mistral/DeepSeek), liens affiliation,
// composants HTML partagés.
// ─────────────────────────────────────────────────────────────────────────────

export const SUPABASE_URL  = "https://enocxbrqyybendertytl.supabase.co";
export const SUPABASE_KEY  = "sb_publishable_NmPh--frZG5HuqfaoxnemA_E7cidV9Y";
export const MODEL         = 'claude-haiku-4-5';

// ── CONSTANTES AFFILIATION ────────────────────────────────────────────────────
export const AMAZON_TAG  = 'huntify21-21';
export const AWIN_PUB    = '2920215';
export const RAKUTEN_MID = '55615';

// ── SUPABASE ──────────────────────────────────────────────────────────────────
export async function sbFetch(path, method='GET', body=null) {
  const opts = { method, headers:{'Content-Type':'application/json','apikey':SUPABASE_KEY,'Authorization':`Bearer ${SUPABASE_KEY}`} };
  if (body) opts.body = JSON.stringify(body);
  try { const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, opts); return await r.json(); } catch(e) { return null; }
}

export async function getAdvertisers() {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/advertisers?active=eq.true`, {
      headers:{'apikey':SUPABASE_KEY,'Authorization':`Bearer ${SUPABASE_KEY}`}
    });
    return await r.json();
  } catch(e) { return []; }
}

// ── NETTOYAGE MOTS-CLÉS ───────────────────────────────────────────────────────
export function cleanKw(kw) {
  if (!kw) return '';
  const preserve = ['fond de teint','eau de toilette','eau de parfum','creme de jour',
    'creme de nuit','sac a main','sac a dos','machine a laver','table de chevet'];
  const cleaned = kw.replace(/,/g,' ').replace(/\s+/g,' ').trim();
  const lower = cleaned.toLowerCase();
  for (const expr of preserve) {
    if (lower.includes(expr)) {
      const rest = lower.replace(expr,'').trim();
      const rw = rest.split(' ').filter(w=>w.length>1).slice(0,3).join(' ');
      return (expr+' '+rw).trim().slice(0,60);
    }
  }
  const stop = new Set(['la','le','les','un','une','des','avec','et','en','du','au','aux','style','classique']);
  return cleaned.split(' ').filter(w=>w.length>1&&!stop.has(w.toLowerCase())).slice(0,6).join(' ');
}

// ── CONSTRUCTION LIENS AFFILIATION (Amazon + Rakuten/Awin) ───────────────────
export function buildLink(adv, keywords, directUrl=null) {
  if (!adv?.active) return null;
  const kw = cleanKw(keywords);

  // ── AMAZON ────────────────────────────────────────────────────────────────
  if (adv.slug === 'amazon') {
    const tag = adv.amazon_tag || AMAZON_TAG;
    const isValidAsin = directUrl
      && directUrl !== 'null'
      && directUrl.length > 15
      && (directUrl.includes('/dp/') || directUrl.includes('amazon'))
      && !directUrl.includes('/dp/null')
      && !directUrl.includes('/dp/undefined');
    const base = isValidAsin
      ? directUrl.split('?')[0]
      : `https://www.amazon.fr/s?k=${encodeURIComponent(kw)}`;
    return `${base}?tag=${tag}`;
  }

  // ── AWIN (Rakuten + autres) ───────────────────────────────────────────────
  if (adv.awin_mid) {
    const mid    = adv.awin_mid;
    const affid  = adv.awin_affid || adv.awin_aff || AWIN_PUB;
    let dest;

    if (adv.slug === 'rakuten') {
      const rkw = encodeURIComponent(kw.replace(/\s+/g,'+'));
      dest = `https://fr.shopping.rakuten.com/s/${rkw}`;
    } else if (adv.search_url) {
      dest = adv.search_url.replace('{keywords}', encodeURIComponent(kw));
    } else {
      dest = `https://www.${adv.slug}.fr/catalogsearch/result/?q=${encodeURIComponent(kw)}`;
    }

    return `https://www.awin1.com/cread.php?awinmid=${mid}&awinaffid=${affid}&ued=${encodeURIComponent(dest)}`;
  }

  return null;
}

export function findAdv(advertisers, slug) {
  return advertisers.find(a=>a.slug===slug?.toLowerCase()) || null;
}

// ── APPELS IA ─────────────────────────────────────────────────────────────────
export async function callGroq(sys, user, model='llama-3.3-70b-versatile', maxTok=500) {
  const key = process.env.GROQ_API_KEY; if (!key) return null;
  try {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':`Bearer ${key}`},
      body: JSON.stringify({ model, max_tokens:maxTok,
        messages:[{role:'system',content:sys},{role:'user',content:user}] })
    });
    if (!r.ok) return null;
    const d = await r.json();
    return d.choices?.[0]?.message?.content || null;
  } catch(e) { return null; }
}

// Groq DeepSearch (compound-beta = recherche web gratuite intégrée)
export async function callGroqSearch(userPrompt, maxTok=1200) {
  const key = process.env.GROQ_API_KEY; if (!key) return null;
  try {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':`Bearer ${key}`},
      body: JSON.stringify({
        model: 'compound-beta',
        max_tokens: maxTok,
        messages: [{ role:'user', content: userPrompt }]
      })
    });
    if (!r.ok) {
      return await callGroq('Reponds en JSON court.', userPrompt, 'llama-3.3-70b-versatile', maxTok);
    }
    const d = await r.json();
    return d.choices?.[0]?.message?.content || null;
  } catch(e) { return null; }
}

export async function callGemini(sys, user, maxTok) {
  const key = process.env.GEMINI_API_KEY; if (!key) return null;
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({contents:[{parts:[{text:`${sys}\n\n${user}`}]}],generationConfig:{maxOutputTokens:maxTok}})
    });
    if (!r.ok) return null;
    const d = await r.json();
    return d.candidates?.[0]?.content?.parts?.[0]?.text || null;
  } catch(e) { return null; }
}

export async function callMistral(sys, user, maxTok) {
  const key = process.env.MISTRAL_API_KEY; if (!key) return null;
  try {
    const r = await fetch('https://api.mistral.ai/v1/chat/completions', {
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':`Bearer ${key}`},
      body: JSON.stringify({model:'mistral-small-latest', max_tokens:maxTok,
        messages:[{role:'system',content:sys},{role:'user',content:user}]})
    });
    if (!r.ok) return null;
    const d = await r.json();
    return d.choices?.[0]?.message?.content || null;
  } catch(e) { return null; }
}

export async function callDeepseek(sys, user, maxTok) {
  const key = process.env.DEEPSEEK_API_KEY; if (!key) return null;
  try {
    const r = await fetch('https://api.deepseek.com/v1/chat/completions',{
      method:'POST', headers:{'Content-Type':'application/json','Authorization':`Bearer ${key}`},
      body:JSON.stringify({model:'deepseek-chat',max_tokens:maxTok||500,messages:[{role:'system',content:sys},{role:'user',content:user}]})
    });
    if (!r.ok) return null;
    const d=await r.json(); return d.choices?.[0]?.message?.content||null;
  } catch(e){return null;}
}

export async function callFreeAI(sys, user, depth='fast') {
  const tok = depth==='deep' ? 800 : 350;
  return await callGroq(sys, user, 'llama-3.3-70b-versatile', tok)
      || await callGemini(sys, user, tok)
      || await callMistral(sys, user, tok)
      || await callDeepseek(sys, user, tok);
}

export function hasFreeAI() {
  return !!(process.env.GROQ_API_KEY || process.env.GEMINI_API_KEY || process.env.MISTRAL_API_KEY);
}

// ── CLAUDE ────────────────────────────────────────────────────────────────────
export async function callClaude(sys, user, maxTok=700, tools=[]) {
  const key = process.env.ANTHROPIC_API_KEY; if (!key) return null;
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method:'POST',
      headers:{'Content-Type':'application/json; charset=utf-8',
        'x-api-key':key,'anthropic-version':'2023-06-01',
        'anthropic-beta':'prompt-caching-2024-07-31'},
      body: JSON.stringify({ model:MODEL, max_tokens:maxTok, tools,
        system:[{type:'text',text:sys,cache_control:{type:'ephemeral'}}],
        messages:[{role:'user',content:user}] })
    });
    const d = await r.json();
    if (!r.ok) return null;
    let t = '';
    for (const b of (d.content||[])) { if (b.type==='text') t += b.text; }
    return t || null;
  } catch(e) { return null; }
}

export function parseJSON(raw) {
  if (!raw) return {};
  try {
    const mdMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (mdMatch) return JSON.parse(mdMatch[1].trim());
    const objMatch = raw.match(/\{[\s\S]*\}/);
    if (objMatch) return JSON.parse(objMatch[0]);
  } catch(e) {}
  return {};
}

// ── HISTORIQUE CONVERSATION ───────────────────────────────────────────────────
export function buildHistory(history) {
  return (history||[]).map(m=>{
    const role = m.role==='user'?'Client':'Agent';
    const text = (m.content||'').replace(/<[^>]*>/g,' ').replace(/&[^;]+;/g,' ').replace(/\s+/g,' ').trim().slice(0,400);
    return text ? `${role}: ${text}` : null;
  }).filter(Boolean).join('\n').slice(0,2000);
}

// ── DB INTERNE (deals, prix, promos) ──────────────────────────────────────────
export async function queryInternalDB(keywords) {
  const kw = (keywords||'').toLowerCase().split(' ')[0];
  const results = { deals:[], prices:[], promos:[], hasData:false };
  try {
    const [deals, prices, promos] = await Promise.all([
      sbFetch(`daily_deals?name=ilike.*${encodeURIComponent(kw)}*&limit=3`),
      sbFetch(`price_history?product_name=ilike.*${encodeURIComponent(kw)}*&order=checked_at.desc&limit=5`),
      sbFetch(`promo_codes?valid=eq.true&order=found_at.desc&limit=3`)
    ]);
    if (deals?.length)  { results.deals  = deals;  results.hasData = true; }
    if (prices?.length) { results.prices = prices; results.hasData = true; }
    if (promos?.length)   results.promos = promos;
  } catch(e) {}
  return results;
}

export function buildDBContext(d) {
  if (!d.hasData) return '';
  const parts = ['DONNEES INTERNES :'];
  if (d.deals?.length)  parts.push('Deals: '+d.deals.map(x=>`${x.name} ${x.price||''} (${x.store||''})`).join(' | '));
  if (d.prices?.length) parts.push('Prix: '+d.prices.map(x=>`${x.product_name} ${x.price}EUR`).join(' | '));
  if (d.promos?.length) parts.push('Codes: '+d.promos.map(x=>`${x.code} ${x.store||''}`).join(' | '));
  return parts.join('\n');
}

// ── HTML — COMPOSANTS PARTAGÉS ────────────────────────────────────────────────
export function productCard(name, price, url, adv, img, badge) {
  const imgHtml   = img ? `<img src="${img}" style="width:56px;height:56px;object-fit:cover;border-radius:8px;flex-shrink:0" onerror="this.style.display='none'">` : '';
  const badgeHtml = badge ? `<span style="background:rgba(255,255,255,.22);border-radius:100px;padding:2px 8px;font-size:10px;font-weight:700">${badge}</span>` : '';
  const pill      = `<span style="background:rgba(255,255,255,.18);border:1px solid rgba(255,255,255,.35);border-radius:100px;padding:2px 9px;font-size:10px;font-weight:800">${adv.emoji||'🛍️'} ${adv.name}</span>`;
  return `<a href="${url}" target="_blank" rel="sponsored noopener" style="display:flex;align-items:center;gap:12px;background:${adv.color||'#2f54ff'};color:#fff;text-decoration:none;border-radius:14px;padding:12px 14px;margin-top:8px">
    ${imgHtml}
    <div style="flex:1;min-width:0">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;flex-wrap:wrap">${pill}${badgeHtml}</div>
      <div style="font-size:13px;font-weight:800;line-height:1.3;word-break:break-word">${name}</div>
    </div>
    <span style="background:rgba(255,255,255,.22);border-radius:8px;padding:5px 10px;white-space:nowrap;font-size:14px;font-weight:900;flex-shrink:0">${price}</span>
  </a>`;
}

export function promoBox(code, store, desc, best) {
  return `<div style="background:${best?'#dcfce7':'#f0fdf4'};border:${best?'2px solid #16a34a':'1.5px solid #86efac'};border-radius:12px;padding:10px 14px;margin-top:6px;display:flex;align-items:center;justify-content:space-between;gap:8px">
    <div><span style="font-size:11px;color:#16a34a;font-weight:700">${best?'⭐ MEILLEUR — ':''}🏷️ ${store}</span><div style="font-size:12px;color:#166534;font-weight:600">${desc}</div></div>
    <div onclick="navigator.clipboard.writeText('${code}');this.innerHTML='✓';setTimeout(()=>this.innerHTML='${code}',2000)" style="background:#16a34a;color:#fff;border-radius:8px;padding:6px 10px;font-weight:800;font-size:12px;cursor:pointer;white-space:nowrap;flex-shrink:0">${code}</div>
  </div>`;
}

export function priceHistBox(old, trend) {
  const icon  = trend==='down'?'📉':trend==='up'?'📈':'➡️';
  const color = trend==='down'?'#dcfce7':trend==='up'?'#fee2e2':'#f1f5f9';
  const border= trend==='down'?'#86efac':trend==='up'?'#fca5a5':'#e2e8f0';
  const msg   = trend==='down'?`Prix en baisse ! Était ${old}€ ✅`:trend==='up'?`⚠️ Prix gonflé ! Était ${old}€`:'Prix stable';
  return `<div style="background:${color};border:1.5px solid ${border};border-radius:12px;padding:10px 14px;margin-top:8px;font-size:12px;font-weight:600;color:#374151">${icon} ${msg}</div>`;
}

export function recapBox(r) {
  return `<div style="background:#f5f3ff;border:1.5px solid #ddd6fe;border-radius:12px;padding:10px 14px;margin-top:8px;font-size:12px;color:#5b21b6;font-weight:600">🔎 ${r}</div>`;
}
