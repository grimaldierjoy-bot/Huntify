export const config = { runtime: 'edge' };

const SUPABASE_URL = "https://enocxbrqyybendertytl.supabase.co";
const SUPABASE_KEY = "sb_publishable_NmPh--frZG5HuqfaoxnemA_E7cidV9Y";
const MODEL        = 'claude-haiku-4-5';
const MAX_Q        = 3;
const AMAZON_TAG   = 'huntify21-21';
const AWIN_PUB     = '2920215';
const TP_MARKER    = '536663';

// ── IATA MAP ──────────────────────────────────────────────────────────────────
const IATA_MAP = {
  paris:'CDG',lyon:'LYS',marseille:'MRS',nice:'NCE',bordeaux:'BOD',
  toulouse:'TLS',nantes:'NTE',strasbourg:'SXB',montpellier:'MPL',
  rome:'FCO',milan:'MXP',venise:'VCE',naples:'NAP',florence:'FLR',
  barcelone:'BCN',madrid:'MAD',ibiza:'IBZ',majorque:'PMI',seville:'SVQ',
  malaga:'AGP',valence:'VLC',tenerife:'TFS',
  lisbonne:'LIS',porto:'OPO',faro:'FAO',
  londres:'LHR',manchester:'MAN',edimbourg:'EDI',
  amsterdam:'AMS',bruxelles:'BRU',zurich:'ZRH',geneve:'GVA',vienne:'VIE',
  berlin:'BER',munich:'MUC',francfort:'FRA',hambourg:'HAM',
  prague:'PRG',budapest:'BUD',varsovie:'WAW',
  athenes:'ATH',santorin:'JTR',mykonos:'JMK',crete:'HER',rhodes:'RHO',
  marrakech:'RAK',casablanca:'CMN',agadir:'AGA',tunis:'TUN',djerba:'DJE',
  hurghada:'HRG',caire:'CAI',istanbul:'IST',antalya:'AYT',
  dubai:'DXB','abu dhabi':'AUH',doha:'DOH',
  tokyo:'NRT',osaka:'KIX',bangkok:'BKK',singapour:'SIN',bali:'DPS',
  'kuala lumpur':'KUL',shanghai:'PVG',pekin:'PEK',seoul:'ICN',
  'new york':'JFK','los angeles':'LAX',miami:'MIA',montreal:'YUL',
  cancun:'CUN',dakar:'DSS',maldives:'MLE',maurice:'MRU',reunion:'RUN',
};

function cityToIATA(str) {
  if (!str) return null;
  const m = (str||'').match(/\b([A-Z]{3})\b/);
  if (m) return m[1].toUpperCase();
  const s = str.toLowerCase().trim();
  for (const [k,v] of Object.entries(IATA_MAP)) { if (s.includes(k)) return v; }
  return null;
}

// ── SUPABASE ──────────────────────────────────────────────────────────────────
async function sbFetch(path, method, body) {
  method = method || 'GET';
  const opts = { method, headers:{'Content-Type':'application/json','apikey':SUPABASE_KEY,'Authorization':'Bearer '+SUPABASE_KEY} };
  if (body) opts.body = JSON.stringify(body);
  try { const r = await fetch(SUPABASE_URL+'/rest/v1/'+path, opts); return await r.json(); } catch(e) { return null; }
}

async function getAdvertisers() {
  try {
    const r = await fetch(SUPABASE_URL+'/rest/v1/advertisers?active=eq.true', { headers:{'apikey':SUPABASE_KEY,'Authorization':'Bearer '+SUPABASE_KEY} });
    return await r.json();
  } catch(e) { return []; }
}

// ── LINKS ─────────────────────────────────────────────────────────────────────
function cleanKw(kw) {
  if (!kw) return '';
  const stop = new Set(['la','le','les','un','une','des','avec','et','en','du','au','aux']);
  return kw.replace(/,/g,' ').replace(/\s+/g,' ').trim()
    .split(' ').filter(w=>w.length>1&&!stop.has(w.toLowerCase())).slice(0,6).join(' ');
}

function buildLink(adv, keywords, directUrl) {
  if (!adv || !adv.active) return null;
  const kw = cleanKw(keywords);
  if (adv.slug === 'amazon') {
    const tag = adv.amazon_tag || AMAZON_TAG;
    const valid = directUrl && directUrl !== 'null' && directUrl.length > 15
      && directUrl.includes('/dp/') && !directUrl.includes('/dp/null');
    const base = valid ? directUrl.split('?')[0] : 'https://www.amazon.fr/s?k='+encodeURIComponent(kw);
    return base+'?tag='+tag;
  }
  if (adv.awin_mid) {
    const affid = adv.awin_affid || adv.awin_aff || AWIN_PUB;
    const dest = adv.slug === 'rakuten'
      ? 'https://fr.shopping.rakuten.com/s/'+encodeURIComponent(kw.replace(/\s+/g,'+'))
      : (adv.search_url||'https://www.'+adv.slug+'.fr/search?q={kw}').replace('{kw}',encodeURIComponent(kw));
    return 'https://www.awin1.com/cread.php?awinmid='+adv.awin_mid+'&awinaffid='+affid+'&ued='+encodeURIComponent(dest);
  }
  return null;
}

function findAdv(advertisers, slug) {
  return (advertisers||[]).find(a=>a.slug===slug)||null;
}

// ── BOOKING / SKYSCANNER / HOTELLOOK ─────────────────────────────────────────
function buildBookingLink(dest, nights, adults, minP, maxP, ci, co) {
  nights = nights||3; adults = adults||2;
  const d = encodeURIComponent((dest||'').trim());
  let url = 'https://www.booking.com/searchresults.html?ss='+d+'&group_adults='+adults+'&no_rooms='+Math.ceil(adults/2)+'&lang=fr';
  if (ci && co) url += '&checkin='+ci+'&checkout='+co;
  else if (nights>0) url += '&nights='+nights;
  if (minP!=null && maxP!=null) url += '&nflt=price%3DEUR-'+Math.round(minP)+'-'+Math.round(maxP)+'-1';
  return url;
}

function buildSkyscannerLink(fromStr, toStr, outbound, inbound, adults) {
  adults = adults||2;
  const from = (cityToIATA(fromStr)||'par').toLowerCase();
  const to   = (cityToIATA(toStr)||'xxx').toLowerCase();
  function fmt(d) { return d ? d.replace(/-/g,'').slice(2) : null; }
  const out = fmt(outbound), ret = fmt(inbound);
  const base = 'https://www.skyscanner.fr/transport/vols/'+from+'/'+to+'/';
  if (out && ret) return base+out+'/'+ret+'/?adults='+adults+'&currency=EUR';
  if (out) return base+out+'/?adults='+adults+'&currency=EUR';
  return base;
}

function buildHotellookLink(dest, ci, co, adults, minP, maxP) {
  adults = adults||2;
  let url = 'https://www.hotellook.com/search?location='+encodeURIComponent(dest||'')+'&marker='+TP_MARKER+'&adults='+adults+'&currency=EUR';
  if (ci) url += '&checkIn='+ci;
  if (co) url += '&checkOut='+co;
  if (minP) url += '&priceMin='+minP;
  if (maxP) url += '&priceMax='+maxP;
  return url;
}

async function fetchRealHotels(dest, ci, co, adults) {
  const token = process.env.TRAVELPAYOUTS_TOKEN;
  if (!token || !ci || !co) return null;
  try {
    const url = 'https://engine.hotellook.com/api/v2/cache.json?location='+encodeURIComponent(dest)
      +'&checkIn='+ci+'&checkOut='+co+'&adultsCount='+adults+'&currency=EUR&token='+token+'&limit=25';
    const r = await fetch(url, { headers:{'Accept':'application/json'} });
    if (!r.ok) return null;
    const data = await r.json();
    if (!Array.isArray(data) || !data.length) return null;
    const valid = data.filter(h=>h.priceFrom&&(h.hotelName||h.name)&&h.id)
      .map(h => ({
        name:  h.hotelName||h.name,
        stars: Math.round(h.stars||3),
        price: Math.round(h.priceFrom),
        loc:   (h.location&&h.location.name)||dest,
        url:   'https://www.hotellook.com/hotels/'+h.id+'?marker='+TP_MARKER+'&adults='+adults+'&checkIn='+ci+'&checkOut='+co+'&currency=EUR'
      })).sort((a,b)=>a.price-b.price);
    if (valid.length < 2) return null;
    const t = Math.max(1,Math.floor(valid.length/3));
    const pick = arr => arr[Math.floor(arr.length/2)];
    return [
      Object.assign({}, pick(valid.slice(0,t)),       { cat:'budget',  hl:'Meilleur rapport qualite/prix' }),
      Object.assign({}, pick(valid.slice(t,t*2)),     { cat:'confort', hl:'Confort et emplacement ideal' }),
      Object.assign({}, pick(valid.slice(-t)),        { cat:'luxe',    hl:'Experience premium' }),
    ];
  } catch(e) { return null; }
}

// ── PARSE DATE ────────────────────────────────────────────────────────────────
function parseDate(str) {
  if (!str) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  const now = new Date();
  const addD = n => { const d=new Date(now); d.setDate(d.getDate()+n); return d.toISOString().slice(0,10); };
  const s = str.toLowerCase().trim();
  if (s==='demain') return addD(1);
  if (/apres.?demain/.test(s)) return addD(2);
  const dm = str.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (dm) { const y=dm[3].length===2?'20'+dm[3]:dm[3]; return y+'-'+dm[2].padStart(2,'0')+'-'+dm[1].padStart(2,'0'); }
  const MONTHS = {jan:1,janv:1,fev:2,mars:3,avr:4,avril:4,mai:5,juin:6,juil:7,juillet:7,aout:8,sep:9,sept:9,oct:10,nov:11,dec:12};
  const fm = s.match(/(\d{1,2})\s+([a-z]+)(?:\s+(\d{4}))?/);
  if (fm) {
    const mm = Object.entries(MONTHS).find(([k])=>fm[2].startsWith(k));
    if (mm) return (fm[3]||String(now.getFullYear()))+'-'+String(mm[1]).padStart(2,'0')+'-'+fm[1].padStart(2,'0');
  }
  return null;
}

// ── EXTRACT TRAVEL INFO ───────────────────────────────────────────────────────
function extractTravelInfo(hist, message) {
  const text = ((hist||'')+' '+message).toLowerCase();
  const info = {};
  const destP = [/(?:aller|partir|voyager|visiter)\s+(?:a|à|en|au|aux|pour)?\s*([a-zA-ZÀ-ÿ]{2,20})/i,/(?:week.?end|séjour|vacances)\s+(?:a|à|en|au)?\s*([a-zA-ZÀ-ÿ]{2,20})/i];
  for (const p of destP) { const m=text.match(p); if(m){info.destination=m[1].trim();break;} }
  const bud = text.match(/budget\s*:?\s*(\d+)\s*(?:€|euros?)/i)||text.match(/(\d+)\s*(?:€|euros?)/i);
  if (bud) info.budget = bud[1]+'€';
  const dur = text.match(/(\d+)\s*(?:jours?|nuits?|semaines?)/i);
  if (dur) info.duree = dur[0];
  const depP = [/depuis\s+([a-zA-ZÀ-ÿ\s]{2,20})(?:\s|,|\.)/i,/départ\s+de\s+([a-zA-ZÀ-ÿ\s]{2,20})(?:\s|,|\.)/i,/je pars?\s+(?:de|depuis)\s+([a-zA-ZÀ-ÿ\s]{2,20})/i];
  for (const p of depP) { const m=text.match(p); if(m){info.ville_depart=m[1].trim();break;} }
  const rf = text.match(/du\s+(\d{1,2}\s+\w+(?:\s+\d{4})?)\s+au\s+(\d{1,2}\s+\w+(?:\s+\d{4})?)/i);
  const rs = text.match(/du\s+(\d{1,2})\s+au\s+(\d{1,2}\s+\w+(?:\s+\d{4})?)/i);
  if (rf) { info.date_depart_raw=rf[1].trim(); info.date_retour_raw=rf[2].trim(); }
  else if (rs) { info.date_depart_raw=rs[1].trim(); info.date_retour_raw=rs[2].trim(); }
  else if (/demain/.test(text)) info.date_depart_raw='demain';
  const am = text.match(/(\d+)\s+adultes?/i)||text.match(/pour\s+(\d+)\s+personnes?/i);
  if (am) info.nb_adultes=parseInt(am[1]);
  else if (/seul\b/.test(text)) info.nb_adultes=1;
  else if (/couple|deux/.test(text)) info.nb_adultes=2;
  else if (/famille|trois/.test(text)) info.nb_adultes=3;
  if (/chill|plage|repos/.test(text)) info.style='chill';
  else if (/culture|musée|histoire/.test(text)) info.style='culture';
  else if (/aventure|randonnée/.test(text)) info.style='aventure';
  else if (/famille|enfant/.test(text)) info.style='famille';
  else if (/romantique|amoureux|couple/.test(text)) info.style='romantique';
  return info;
}

// ── AI CALLS ──────────────────────────────────────────────────────────────────
async function callGroq(sys, user, model, maxTok) {
  const key = process.env.GROQ_API_KEY; if (!key) return null;
  try {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method:'POST', headers:{'Content-Type':'application/json','Authorization':'Bearer '+key},
      body:JSON.stringify({ model:model, max_tokens:maxTok, messages:[{role:'system',content:sys},{role:'user',content:user}] })
    });
    if (!r.ok) return null;
    const d = await r.json(); return d.choices&&d.choices[0]&&d.choices[0].message?d.choices[0].message.content:null;
  } catch(e) { return null; }
}

async function callGroqDS(prompt, maxTok) {
  maxTok = maxTok||1000;
  const key = process.env.GROQ_API_KEY; if (!key) return null;
  try {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method:'POST', headers:{'Content-Type':'application/json','Authorization':'Bearer '+key},
      body:JSON.stringify({ model:'compound-beta', max_tokens:maxTok, messages:[{role:'user',content:prompt}] })
    });
    if (!r.ok) return await callGroq('Reponds en JSON.', prompt, 'llama-3.3-70b-versatile', maxTok);
    const d = await r.json(); return d.choices&&d.choices[0]&&d.choices[0].message?d.choices[0].message.content:null;
  } catch(e) { return await callGroq('Reponds en JSON.', prompt, 'llama-3.3-70b-versatile', maxTok); }
}

async function callGemini(sys, user, maxTok) {
  const key = process.env.GEMINI_API_KEY; if (!key) return null;
  try {
    const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key='+key, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({ contents:[{parts:[{text:sys+'\n\n'+user}]}], generationConfig:{maxOutputTokens:maxTok} })
    });
    if (!r.ok) return null;
    const d = await r.json(); return d.candidates&&d.candidates[0]&&d.candidates[0].content&&d.candidates[0].content.parts?d.candidates[0].content.parts[0].text:null;
  } catch(e) { return null; }
}

async function callMistral(sys, user, maxTok) {
  const key = process.env.MISTRAL_API_KEY; if (!key) return null;
  try {
    const r = await fetch('https://api.mistral.ai/v1/chat/completions', {
      method:'POST', headers:{'Content-Type':'application/json','Authorization':'Bearer '+key},
      body:JSON.stringify({ model:'mistral-small-latest', max_tokens:maxTok, messages:[{role:'system',content:sys},{role:'user',content:user}] })
    });
    if (!r.ok) return null;
    const d = await r.json(); return d.choices&&d.choices[0]&&d.choices[0].message?d.choices[0].message.content:null;
  } catch(e) { return null; }
}

async function callFreeAI(sys, user, maxTok) {
  maxTok = maxTok||400;
  return await callGroq(sys,user,'llama-3.3-70b-versatile',maxTok)||await callGemini(sys,user,maxTok)||await callMistral(sys,user,maxTok);
}

function hasFreeAI() { return !!(process.env.GROQ_API_KEY||process.env.GEMINI_API_KEY||process.env.MISTRAL_API_KEY); }

async function callClaude(sys, user, maxTok, tools) {
  maxTok = maxTok||700; tools = tools||[];
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method:'POST',
    headers:{'Content-Type':'application/json; charset=utf-8','x-api-key':process.env.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01'},
    body:JSON.stringify({ model:MODEL, max_tokens:maxTok, tools:tools, system:sys, messages:[{role:'user',content:user}] })
  });
  const d = await r.json();
  if (!r.ok) throw new Error((d.error&&d.error.message)||'Claude error');
  let t=''; for (const b of d.content) { if (b.type==='text') t+=b.text; } return t;
}

function parseJSON(raw) {
  if (!raw) return {};
  try { const md=raw.match(/```(?:json)?\s*([\s\S]*?)```/); if(md) return JSON.parse(md[1].trim()); } catch(e){}
  try { const ob=raw.match(/\{[\s\S]*\}/); if(ob) return JSON.parse(ob[0]); } catch(e){}
  return {};
}

// ── UTILITIES ─────────────────────────────────────────────────────────────────
function buildHistory(history, maxLen) {
  maxLen = maxLen||1800;
  return ((history||[]).map(m=>{
    const role=m.role==='user'?'Client':'Agent';
    const text=(m.content||'').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim().slice(0,350);
    return text?role+': '+text:null;
  }).filter(Boolean).join('\n')).slice(0,maxLen);
}

async function queryInternalDB(keywords) {
  const kw=(keywords||'').toLowerCase().split(' ')[0];
  const results={deals:[],prices:[],promos:[],hasData:false};
  try {
    const [deals,prices,promos] = await Promise.all([
      sbFetch('daily_deals?name=ilike.*'+encodeURIComponent(kw)+'*&limit=3'),
      sbFetch('price_history?product_name=ilike.*'+encodeURIComponent(kw)+'*&order=checked_at.desc&limit=5'),
      sbFetch('promo_codes?valid=eq.true&order=found_at.desc&limit=3')
    ]);
    if (deals&&deals.length){results.deals=deals;results.hasData=true;}
    if (prices&&prices.length){results.prices=prices;results.hasData=true;}
    if (promos&&promos.length) results.promos=promos;
  } catch(e){}
  return results;
}

function buildDBContext(d) {
  if (!d.hasData) return '';
  const p=['DONNEES INTERNES :'];
  if (d.deals&&d.deals.length) p.push('Deals: '+d.deals.map(x=>x.name+' '+(x.price||'')).join(' | '));
  if (d.prices&&d.prices.length) p.push('Prix: '+d.prices.map(x=>x.product_name+' '+x.price+'EUR').join(' | '));
  if (d.promos&&d.promos.length) p.push('Codes: '+d.promos.map(x=>x.code+' '+(x.store||'')).join(' | '));
  return p.join('\n');
}

function detectBudget(text) {
  if (!text) return null;
  const ps=[/(?:moins de|maxi?|budget|environ)[^\d]*(\d+)\s*(?:€|euros?)/i,/(\d+)\s*(?:€|euros?)\s*(?:max|budget)/i,/budget[^\d]*(\d+)/i,/(\d{2,})\s*€/];
  for (const r of ps) { const m=text.match(r); if(m){const b=parseInt(m[1]);if(b>0&&b<100000)return b;} }
  return null;
}

function estimateROI(budget, message, hist) {
  let s=0;
  const msg=((message||'')+' '+(hist||'')).toLowerCase();
  if (budget===null) s+=2; else if (budget<30) s+=0; else if (budget<80) s+=1;
  else if (budget<200) s+=3; else if (budget<500) s+=5; else s+=8;
  if (/urgent|vite|demain/.test(msg)) s+=2;
  if (/cadeau|anniversaire|noel/.test(msg)) s+=2;
  if (/premium|luxe|meilleur/.test(msg)) s+=3;
  return { score:s, depth:s>=6?'deep':s>=3?'medium':'light' };
}

function detectCategory(text) {
  if (!text) return 'general';
  const t=text.toLowerCase();
  if (/fond de teint|parfum|creme|maquillage/.test(t)) return 'beaute';
  if (/casque|telephone|laptop|tablette|console/.test(t)) return 'electronique';
  if (/robe|veste|chaussure|sneaker|jean/.test(t)) return 'mode';
  if (/cadeau|anniversaire|noel|offrir/.test(t)) return 'cadeau';
  return 'general';
}

function countQ(history) { return (history||[]).filter(m=>m.role!=='user'&&(m.content||'').includes('data-qbox')).length; }
function countTravelQ(history) { return (history||[]).filter(m=>m.role!=='user'&&(m.content||'').length>20).length; }

async function getAutoCoupons(store) {
  try { const p=await sbFetch('promo_codes?valid=eq.true&store=eq.'+encodeURIComponent(store)+'&order=found_at.desc&limit=2'); return (p||[]).filter(x=>x.code); } catch(e){return [];}
}

function getCrossSuggestions(recap) {
  const r=(recap||'').toLowerCase();
  if (r.includes('casque')) return ['housse transport casque'];
  if (r.includes('telephone')) return ['coque protection','verre trempé'];
  if (r.includes('laptop')) return ['housse laptop','souris sans fil'];
  if (r.includes('parfum')) return ['coffret miniatures'];
  return [];
}

// ── HTML COMPONENTS ───────────────────────────────────────────────────────────
function productCard(name, price, url, adv, img, badge) {
  const imgH = img ? '<img src="'+img+'" style="width:56px;height:56px;object-fit:cover;border-radius:8px;flex-shrink:0" onerror="this.style.display=\'none\'">' : '';
  const badgeH = badge ? '<span style="background:rgba(255,255,255,.22);border-radius:100px;padding:2px 8px;font-size:10px;font-weight:700">'+badge+'</span>' : '';
  const pill = '<span style="background:rgba(255,255,255,.18);border:1px solid rgba(255,255,255,.35);border-radius:100px;padding:2px 9px;font-size:10px;font-weight:800">'+(adv.emoji||'🛍️')+' '+adv.name+'</span>';
  return '<a href="'+url+'" target="_blank" rel="sponsored noopener" style="display:flex;align-items:center;gap:12px;background:'+(adv.color||'#2f54ff')+';color:#fff;text-decoration:none;border-radius:14px;padding:12px 14px;margin-top:8px">'
    +imgH
    +'<div style="flex:1;min-width:0"><div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;flex-wrap:wrap">'+pill+badgeH+'</div>'
    +'<div style="font-size:13px;font-weight:800;line-height:1.3;word-break:break-word">'+name+'</div></div>'
    +'<span style="background:rgba(255,255,255,.22);border-radius:8px;padding:5px 10px;white-space:nowrap;font-size:14px;font-weight:900;flex-shrink:0">'+(price||'Voir prix')+'</span></a>';
}

function promoBox(code, store, desc, best) {
  return '<div style="background:'+(best?'#dcfce7':'#f0fdf4')+';border:'+(best?'2px solid #16a34a':'1.5px solid #86efac')+';border-radius:12px;padding:10px 14px;margin-top:6px;display:flex;align-items:center;justify-content:space-between;gap:8px">'
    +'<div><span style="font-size:11px;color:#16a34a;font-weight:700">'+(best?'⭐ MEILLEUR — ':'')+'🏷️ '+store+'</span><div style="font-size:12px;color:#166534;font-weight:600">'+desc+'</div></div>'
    +'<div onclick="navigator.clipboard.writeText(\''+code+'\');this.innerHTML=\'✓\';setTimeout(()=>this.innerHTML=\''+code+'\',2000)" style="background:#16a34a;color:#fff;border-radius:8px;padding:6px 10px;font-weight:800;font-size:12px;cursor:pointer;white-space:nowrap;flex-shrink:0">'+code+'</div></div>';
}

function recapBox(r) {
  return '<div style="background:#f5f3ff;border:1.5px solid #ddd6fe;border-radius:12px;padding:10px 14px;margin-top:8px;font-size:12px;color:#5b21b6;font-weight:600">🔎 '+r+'</div>';
}

function hotelCard(h, link) {
  const stars = '⭐'.repeat(Math.min(h.stars||3,5));
  const cc = {budget:'#16a34a',confort:'#2f54ff',luxe:'#7c3aed'}[h.cat]||'#2f54ff';
  const cl = {budget:'💚 Budget',confort:'💙 Confort',luxe:'💎 Luxe'}[h.cat]||'';
  const hasPrice = h.price && h.priceReal;
  const priceBlock = hasPrice
    ? '<div style="background:linear-gradient(135deg,#16a34a,#15803d);color:#fff;border-radius:10px;padding:7px 11px;text-align:center;flex-shrink:0;margin-left:8px"><div style="font-size:9px;opacity:.85">Prix réel ✓</div><div style="font-size:15px;font-weight:900">'+h.price+'€</div><div style="font-size:9px;opacity:.75">/nuit</div></div>'
    : '<div style="background:linear-gradient(135deg,'+cc+','+cc+'cc);color:#fff;border-radius:10px;padding:8px 12px;text-align:center;flex-shrink:0;margin-left:8px"><div style="font-size:10px;opacity:.85">Voir prix</div><div style="font-size:12px;font-weight:800">→</div></div>';
  return '<a href="'+link+'" target="_blank" rel="sponsored noopener" style="display:flex;flex-direction:column;background:#fff;border:1.5px solid '+(hasPrice?'#bbf7d0':'#e6ebf7')+';border-radius:14px;padding:13px;margin-top:8px;text-decoration:none;gap:5px">'
    +'<div style="display:flex;justify-content:space-between;align-items:flex-start">'
    +'<div style="flex:1">'+(cl?'<span style="background:#eff6ff;color:'+cc+';border-radius:100px;padding:2px 9px;font-size:10px;font-weight:800">'+cl+'</span>':'')
    +'<div style="font-size:13px;font-weight:800;color:#0e1430;margin-top:3px">'+h.name+'</div>'
    +'<div style="font-size:11px;color:#7c89a8">'+stars+' · '+(h.loc||'')+'</div></div>'
    +priceBlock+'</div>'
    +(h.hl?'<div style="font-size:11px;color:#2f54ff;font-weight:600;background:#eff6ff;border-radius:8px;padding:4px 10px">✨ '+h.hl+'</div>':'')
    +'<div style="background:'+(hasPrice?'#f0fdf4':'#f0f9ff')+';border-radius:8px;padding:6px 10px;font-size:11px;color:'+(hasPrice?'#15803d':'#0369a1')+';font-weight:600">'
    +(hasPrice?'🟢 Prix vérifié · Réserver sur Hotellook →':'🏨 Voir les prix en temps réel →')+'</div></a>';
}

function dayCard(d) {
  return '<div style="background:#fff;border:1.5px solid #e6ebf7;border-radius:14px;padding:14px;margin-top:9px">'
    +'<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">'
    +'<div style="background:linear-gradient(135deg,#2f54ff,#4a6bff);color:#fff;border-radius:8px;padding:4px 12px;font-size:12px;font-weight:800">Jour '+d.num+'</div>'
    +'<div style="font-size:12px;font-weight:700;color:#0e1430;flex:1;margin-left:8px">'+(d.title||'')+'</div>'
    +(d.budget?'<div style="font-size:11px;color:#16a34a;font-weight:700">~'+d.budget+'€</div>':'')+'</div>'
    +(d.morning?'<div style="display:flex;gap:9px;margin-bottom:8px"><span>🌅</span><div><div style="font-size:10px;font-weight:800;color:#94a3b8;text-transform:uppercase">Matin</div><div style="font-size:12px;color:#374151">'+d.morning+'</div></div></div>':'')
    +(d.afternoon?'<div style="display:flex;gap:9px;margin-bottom:8px"><span>☀️</span><div><div style="font-size:10px;font-weight:800;color:#94a3b8;text-transform:uppercase">Après-midi</div><div style="font-size:12px;color:#374151">'+d.afternoon+'</div></div></div>':'')
    +(d.evening?'<div style="display:flex;gap:9px;margin-bottom:4px"><span>🌙</span><div><div style="font-size:10px;font-weight:800;color:#94a3b8;text-transform:uppercase">Soirée</div><div style="font-size:12px;color:#374151">'+d.evening+'</div></div></div>':'')
    +(d.restaurant?'<div style="background:#f0fdf4;border-radius:9px;padding:7px 11px;margin-top:6px;display:flex;justify-content:space-between"><div style="font-size:11px;color:#16a34a;font-weight:700">🍽️ '+(d.restaurant.name||'')+'</div><div style="font-size:11px;color:#16a34a;font-weight:700">'+(d.restaurant.price||'')+'</div></div>':'')
    +(d.activities&&d.activities.length?'<div style="margin-top:7px;display:flex;flex-wrap:wrap;gap:4px">'+d.activities.map(a=>'<span style="background:#eff6ff;color:#2f54ff;border-radius:100px;padding:2px 9px;font-size:10.5px;font-weight:600">'+a+'</span>').join('')+'</div>':'')
    +'</div>';
}

function budgetCard(b) {
  const items = [['✈️ Vols A/R',b.vols],['🏨 Hébergement',b.hotel],['🎯 Activités',b.acts],['🍽️ Restaurants',b.resto],['🚇 Transport',b.transport]].filter(i=>i[1]!=null);
  return '<div style="background:linear-gradient(135deg,#0e1430,#1f2da0);border-radius:16px;padding:16px;margin-top:12px">'
    +'<div style="font-size:13px;font-weight:800;color:#fff;margin-bottom:12px">💰 Budget estimé par l\'IA</div>'
    +items.map(i=>'<div style="display:flex;justify-content:space-between;margin-bottom:7px"><span style="font-size:12px;color:rgba(255,255,255,.75)">'+i[0]+'</span><span style="font-size:12px;font-weight:700;color:#fff">~'+i[1]+'€</span></div>').join('')
    +'<div style="border-top:1px solid rgba(255,255,255,.2);margin-top:10px;padding-top:10px;display:flex;justify-content:space-between">'
    +'<span style="font-size:13px;font-weight:800;color:#fff">TOTAL</span>'
    +'<span style="font-size:16px;font-weight:900;color:#bcd0ff">~'+(b.total||'')+'€</span></div>'
    +(b.pp?'<div style="font-size:11px;color:rgba(255,255,255,.6);text-align:right;margin-top:3px">soit ~'+b.pp+'€/personne</div>':'')
    +'<div style="background:rgba(255,255,255,.07);border-radius:8px;padding:8px 10px;margin-top:10px;font-size:10px;color:rgba(255,255,255,.55)">⚠️ Estimations IA · Cliquez les liens pour les vrais prix en temps réel.</div></div>';
}

function tipsCard(tips) {
  if (!tips||!tips.length) return '';
  return '<div style="background:#f5f3ff;border:1.5px solid #ddd6fe;border-radius:14px;padding:14px;margin-top:10px">'
    +'<div style="font-size:12px;font-weight:800;color:#5b21b6;margin-bottom:8px">💡 Conseils pratiques</div>'
    +tips.map(t=>'<div style="font-size:12px;color:#374151;margin-bottom:5px;padding-left:8px;border-left:2px solid #c4b5fd">• '+t+'</div>').join('')+'</div>';
}

function priceHistBox(old, trend) {
  const icon=trend==='down'?'📉':trend==='up'?'📈':'➡️';
  const color=trend==='down'?'#dcfce7':trend==='up'?'#fee2e2':'#f1f5f9';
  const border=trend==='down'?'#86efac':trend==='up'?'#fca5a5':'#e2e8f0';
  const msg=trend==='down'?'Prix en baisse ! Était '+old+'€ ✅':trend==='up'?'⚠️ Prix gonflé ! Était '+old+'€':'Prix stable';
  return '<div style="background:'+color+';border:1.5px solid '+border+';border-radius:12px;padding:10px 14px;margin-top:8px;font-size:12px;font-weight:600;color:#374151">'+icon+' '+msg+'</div>';
}

// ── MAIN HANDLER ──────────────────────────────────────────────────────────────
export default async function handler(req) {
  if (req.method==='OPTIONS') return new Response(null,{status:204,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type'}});
  if (req.method!=='POST') return new Response('Method not allowed',{status:405});
  const H = {'Content-Type':'application/json; charset=utf-8','Access-Control-Allow-Origin':'*'};

  try {
    const body = await req.json();
    const message = body.message;
    const history = body.history;
    const sessionId = body.sessionId;
    const userId = body.userId;
    const trackingEnabled = body.trackingEnabled;
    const mode = body.mode;
    const travelContext = body.travelContext;

    const sid = sessionId||('anon_'+Date.now());
    const isTravel = mode === 'travel';
    const advertisers = await getAdvertisers();
    const activeNames = advertisers.map(a=>a.name).join(', ');

    if (trackingEnabled) {
      Promise.all([
        sbFetch('searches','POST',{query:message,session_id:sid,user_id:userId||null}),
        sbFetch('trends','POST',{query:message.toLowerCase().trim(),count:1,last_searched:new Date().toISOString()})
      ]);
    }

    const hist  = buildHistory(history, 1800);
    const histS = buildHistory(history, 900);
    const ctx   = travelContext||{};
    const today = new Date().toISOString().slice(0,10);

    if (isTravel) {
      const qAsked = countTravelQ(history);
      const extr   = extractTravelInfo(histS, message);
      const merged = Object.assign({}, extr, Object.fromEntries(Object.entries(ctx).filter(function(e){return e[1]&&e[0]!=='suggestionsShown';})));
      const mStr   = Object.entries(merged).filter(function(e){return e[1];}).map(function(e){return e[0]+':'+e[1];}).join(', ');

      const allText = (histS+' '+message+' '+mStr).toLowerCase();
      const hasDest  = merged.destination||/rome|paris|barcelone|madrid|lisbonne|amsterdam|berlin|prague|athenes|marrakech|dubai|tokyo|bali|naples|venise|florence/.test(allText);
      const hasDep   = merged.ville_depart||/depuis|de barcelone|de paris|de lyon|de nice|de marseille|depart de/.test(allText);
      const hasDates = merged.duree||/\d+\s*(jours?|nuits?|semaines?)|du \d+|demain|week.?end/.test(allText);
      const readyGen = hasDest && hasDep && hasDates;

      if (!readyGen && qAsked < 4) {
        const missing = [!hasDest&&'destination',!hasDep&&'ville de depart',!hasDates&&'duree',!merged.budget&&'budget'].filter(Boolean);
        const groqPrompt = 'Tu es un agent voyage Huntify chaleureux.\n'
          +'Infos collectees: '+(mStr||'aucune')+'\n'
          +'Historique: '+(histS||'debut')+'\n'
          +'Message: '+message+'\n'
          +'Info manquantes: '+missing.join(', ')+'\n'
          +'Aujourdhui: '+today+'\n\n'
          +'Pose UNE question naturelle pour la prochaine info manquante.\n'
          +'Si message=destination seule, suggere 3 destinations similaires.\n'
          +'Reponds UNIQUEMENT en JSON: type q pour question (msg), type s pour suggestions (intro/dests/q).';

        const gRaw = await callGroqDS(groqPrompt, 400)||await callFreeAI('JSON uniquement.', groqPrompt, 400);
        const gP   = parseJSON(gRaw||'');

        if (gP.t === 'q' && gP.msg) {
          return new Response(JSON.stringify({reply:'<div style="font-size:13.5px;color:#1e293b;line-height:1.6;padding:4px 0">'+gP.msg+'</div>',sessionId:sid}),{headers:H});
        }

        if (gP.t === 's' && gP.dests && gP.dests.length) {
          let html = '<div style="font-size:13.5px;color:#1e293b;line-height:1.6;padding:4px 0 8px">'+(gP.intro||'Voici mes suggestions :')+'</div>';
          for (const d of gP.dests) {
            html += '<div onclick="send(\''+((d.n||'').replace(/'/g,"\\'"))+'\')" style="background:#fff;border:1.5px solid #e6ebf7;border-radius:16px;padding:14px;margin-top:8px;cursor:pointer">'
              +'<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px"><span style="font-size:24px">'+(d.e||'🌍')+'</span>'
              +'<div><div style="font-size:14px;font-weight:800;color:#0e1430">'+(d.n||'')+'</div><div style="font-size:11px;color:#7c89a8">'+(d.price||'')+'</div></div></div>'
              +'<div style="font-size:12px;color:#374151;margin-bottom:7px">'+(d.why||'')+'</div>'
              +'<div style="display:flex;flex-wrap:wrap;gap:4px">'+((d.tags||[]).map(t=>'<span style="background:#eff6ff;color:#2f54ff;border-radius:100px;padding:2px 9px;font-size:11px;font-weight:600">'+t+'</span>').join(''))+'</div></div>';
          }
          if (gP.q) html += '<div style="font-size:13.5px;color:#1e293b;padding:8px 0 0">'+gP.q+'</div>';
          return new Response(JSON.stringify({reply:html,sessionId:sid}),{headers:H});
        }

        const fallbackQ = !hasDest?'Quelle destination vous tente ?':!hasDep?'Vous partez de quelle ville ?':!hasDates?'Pour combien de jours ?':'Quel est votre budget aproximatif ?';
        return new Response(JSON.stringify({reply:'<div style="font-size:13.5px;color:#1e293b;line-height:1.6;padding:4px 0">'+fallbackQ+'</div>',sessionId:sid}),{headers:H});
      }

      // Generation itineraire - Claude uniquement
      const tSys = 'Expert voyage Huntify. Genere des itineraires complets en JSON.\n'
        +'Aujourdhui: '+today+'. Infos: '+(mStr||'aucune')+'.\n\n'
        +'CHAMPS JSON OBLIGATOIRES (format t:i):\n'
        +'t, recap, itin.dest, itin.country, itin.flag, itin.dur, itin.trav, itin.style, itin.dep\n'
        +'itin.checkin (YYYY-MM-DD), itin.checkout (YYYY-MM-DD), itin.adults\n'
        +'itin.flights.out/ret: from, to (IATA 3 lettres MAJ ex NCE FCO BCN CDG), price, co, dur\n'
        +'itin.hotels: 3 objets avec name, stars, price, loc, hl, cat (budget/confort/luxe)\n'
        +'itin.days: n, title, am, pm, eve, resto, acts, budget\n'
        +'itin.budget: vols, hotel, acts, resto, transport, total, pp\n'
        +'itin.tips: tableau conseils\n\n'
        +'REGLES: checkin/checkout vraies dates ISO. IATA 3 lettres MAJ. Vrais hotels existants. JSON UNIQUEMENT.';

      const tUser = 'INFOS: '+mStr+'\nHIST: '+hist+'\nMSG: '+message+'\n'+(readyGen?'[GENERE MAINTENANT itineraire format t:i]':'');
      const tRaw  = await callClaude(tSys, tUser, 2800, []);
      const tP    = parseJSON(tRaw||'');
      const itin  = tP.itin;

      if (!itin) {
        return new Response(JSON.stringify({reply:'<div style="font-size:13.5px;color:#1e293b;line-height:1.6;padding:4px 0">'+(tP.msg||'Pour generer votre itineraire, precisez destination, duree et ville de depart.')+'</div>',sessionId:sid}),{headers:H});
      }

      const adults = itin.adults||merged.nb_adultes||2;
      const nights = parseInt(((itin.dur||'').match(/\d+/)||['3'])[0])||3;
      const ci = (/^\d{4}-\d{2}-\d{2}$/.test(itin.checkin||''))?itin.checkin:parseDate(merged.date_depart_raw||itin.checkin||null);
      const coRaw = (/^\d{4}-\d{2}-\d{2}$/.test(itin.checkout||''))?itin.checkout:parseDate(merged.date_retour_raw||itin.checkout||null);
      const co = coRaw||(function(){if(ci){const d=new Date(ci);d.setDate(d.getDate()+nights);return d.toISOString().slice(0,10);}return null;}());

      let html = '';
      const itinId = 'itin_'+Date.now();

      html += '<div id="'+itinId+'" style="background:linear-gradient(135deg,#1f2da0,#2f54ff);border-radius:16px;padding:18px;margin-bottom:4px;text-align:center">'
        +'<div style="font-size:32px;margin-bottom:6px">'+(itin.flag||'✈️')+'</div>'
        +'<div style="font-family:\'Sora\',sans-serif;font-size:20px;font-weight:800;color:#fff">'+(itin.dest||'')+(itin.country?', '+itin.country:'')+'</div>'
        +'<div style="font-size:12px;color:rgba(255,255,255,.75);margin-top:6px;display:flex;justify-content:center;gap:12px;flex-wrap:wrap">'
        +'<span>📅 '+(itin.dur||'')+'</span><span>👥 '+(itin.trav||adults+' pers.')+'</span>'
        +(itin.dep?'<span>🛫 Depuis '+itin.dep+'</span>':'')
        +(itin.budget&&itin.budget.total?'<span>💰 ~'+itin.budget.total+'€</span>':'')
        +'</div></div>';

      if (tP.recap) html += recapBox(tP.recap);

      if (itin.flights&&itin.flights.out) {
        const f = itin.flights;
        const skyUrl = buildSkyscannerLink(f.out.from||itin.dep||'', f.out.to||itin.dest||'', ci, co, adults);
        html += '<div style="font-size:12px;font-weight:800;color:#0e1430;margin:14px 0 6px">✈️ Vols recommandés</div>'
          +'<div style="background:#fff;border:1.5px solid #e6ebf7;border-radius:14px;overflow:hidden">'
          +'<div style="padding:12px 14px;border-bottom:1px solid #f0f4ff"><div style="display:flex;justify-content:space-between;align-items:center">'
          +'<div><div style="font-size:10px;font-weight:800;color:#7c89a8;text-transform:uppercase">Aller'+(ci?' · '+ci:'')+'</div>'
          +'<div style="font-size:13px;font-weight:700;color:#0e1430;margin-top:2px">'+(f.out.from||'')+' → '+(f.out.to||'')+'</div>'
          +'<div style="font-size:11px;color:#7c89a8">'+(f.out.co||'')+' · '+(f.out.dur||'')+'</div></div>'
          +'<div style="text-align:right"><div style="font-size:16px;font-weight:900;color:#2f54ff">~'+(f.out.price||'?')+'€</div><div style="font-size:10px;color:#7c89a8">/pers.</div></div></div></div>'
          +(f.ret?'<div style="padding:12px 14px"><div style="display:flex;justify-content:space-between;align-items:center">'
            +'<div><div style="font-size:10px;font-weight:800;color:#7c89a8;text-transform:uppercase">Retour'+(co?' · '+co:'')+'</div>'
            +'<div style="font-size:13px;font-weight:700;color:#0e1430;margin-top:2px">'+(f.ret.from||'')+' → '+(f.ret.to||'')+'</div>'
            +'<div style="font-size:11px;color:#7c89a8">'+(f.ret.co||'')+' · '+(f.ret.dur||'')+'</div></div>'
            +'<div style="text-align:right"><div style="font-size:16px;font-weight:900;color:#2f54ff">~'+(f.ret.price||'?')+'€</div><div style="font-size:10px;color:#7c89a8">/pers.</div></div></div></div>':'')
          +'</div>'
          +'<a href="'+skyUrl+'" target="_blank" rel="noopener" style="display:flex;align-items:center;justify-content:center;gap:8px;background:linear-gradient(135deg,#0e1430,#1f2da0);color:#fff;text-decoration:none;border-radius:12px;padding:12px;font-size:13px;font-weight:700;margin-top:6px">🔍 Comparer ces vols sur Skyscanner →</a>';
      }

      if (itin.hotels&&itin.hotels.length) {
        const realHotels = (ci&&co)?await fetchRealHotels(itin.dest||'',ci,co,adults):null;
        const hasReal = !!(realHotels&&realHotels.length);
        const hotelsToShow = hasReal ? realHotels : (itin.hotels||[]).map(function(h,i){
          return { name:h.name, stars:h.stars||3, price:null, loc:h.loc||itin.dest, hl:h.hl, cat:['budget','confort','luxe'][i]||h.cat||'confort',
            url: buildHotellookLink(itin.dest||'',ci,co,adults,i===0?null:i===1?80:180,i===0?100:i===1?200:null) };
        });

        html += '<div style="font-size:12px;font-weight:800;color:#0e1430;margin:16px 0 6px">🏨 Hébergements · '
          +(hasReal?'<span style="color:#16a34a;font-size:11px">Prix réels Hotellook ✓</span>':'<span style="color:#7c89a8;font-size:11px">Cliquez pour voir les prix</span>')+'</div>';

        for (const h of hotelsToShow) {
          const hLink = h.url||buildHotellookLink(itin.dest||'',ci,co,adults,null,null);
          html += hotelCard({ name:h.name, stars:h.stars, price:h.price?String(h.price):null, priceReal:hasReal&&!!h.price, loc:h.loc||itin.dest, hl:h.hl, cat:h.cat }, hLink);
        }

        const prices = hotelsToShow.filter(h=>h.price).map(h=>h.price);
        const minP = prices.length?Math.max(0,Math.min.apply(null,prices)-20):null;
        const maxP = prices.length?Math.max.apply(null,prices)+50:null;
        html += '<a href="'+buildHotellookLink(itin.dest||'',ci,co,adults,minP,maxP)+'" target="_blank" rel="sponsored noopener" style="display:flex;align-items:center;justify-content:center;gap:8px;background:linear-gradient(135deg,#0e1430,#2f54ff);color:#fff;text-decoration:none;border-radius:12px;padding:12px;margin-top:8px;font-size:12px;font-weight:700">🏨 Voir tous les hôtels disponibles sur Hotellook'+(ci?' ('+ci+' → '+co+')':'')+'→</a>';
      }

      if (itin.days&&itin.days.length) {
        html += '<div style="font-size:12px;font-weight:800;color:#0e1430;margin:16px 0 6px">📅 Programme jour par jour</div>';
        for (const d of itin.days) { html += dayCard({num:d.n,title:d.title,morning:d.am,afternoon:d.pm,evening:d.eve,restaurant:d.resto,activities:d.acts,budget:d.budget}); }
      }

      if (itin.budget) html += budgetCard(itin.budget);
      if (itin.tips&&itin.tips.length) html += tipsCard(itin.tips);

      const h1 = (itin.hotels||[])[0];
      const bookWish = buildHotellookLink(itin.dest||'',ci,co,adults,null,null);
      const skyWish  = (itin.flights&&itin.flights.out)?buildSkyscannerLink(itin.flights.out.from||'',itin.flights.out.to||'',ci,co,adults):null;
      const wData = JSON.stringify({ type:'voyage', name:(itin.flag||'✈️')+' '+(itin.dest||'')+(itin.country?', '+itin.country:''), subtitle:(itin.dur||'')+' · '+(itin.trav||adults+' pers.')+' · '+(itin.style||''), price:itin.budget&&itin.budget.total?String(itin.budget.total)+'€':'', store:'hotellook', url:bookWish, flightUrl:skyWish||'', hotels:(itin.hotels||[]).slice(0,3).map(h=>({name:h.name||'',cat:h.cat||'confort',url:buildHotellookLink(itin.dest||'',ci,co,adults,null,null)})), budget:itin.budget||null }).replace(/"/g,'&quot;');

      html += '<div style="display:flex;gap:8px;margin-top:12px">'
        +'<button onclick="addToWishlist('+wData+')" style="flex:1;background:linear-gradient(135deg,#1f2da0,#2f54ff);border:none;color:#fff;border-radius:12px;padding:12px 14px;font-weight:700;font-size:13px;cursor:pointer;font-family:inherit">♡ Sauvegarder</button>'
        +'<button onclick="exportItinerary(\''+itinId+'\')" style="background:#f5f7ff;border:1.5px solid #c7d2fe;color:#3b5bdb;border-radius:12px;padding:12px 14px;font-weight:700;font-size:13px;cursor:pointer;font-family:inherit">⬇️ Exporter PDF</button>'
        +'</div>';

      if (trackingEnabled) sbFetch('searches','POST',{query:'[VOYAGE] '+message,session_id:sid,user_id:userId||null});
      return new Response(JSON.stringify({reply:html,sessionId:sid}),{headers:H});
    }

    // ── MODE PRODUIT ──────────────────────────────────────────────────────────
    const qAskedP = countQ(history);
    const histCat = detectCategory((history||[]).map(m=>m.content||'').join(' '));
    const curCat  = detectCategory(message);
    const topicChanged = histCat!=='general'&&curCat!=='general'&&histCat!==curCat;
    const exchanges = (history||[]).length;

    if (topicChanged && exchanges>=4) {
      const resetMsg = curCat==='cadeau'?"Nouveau sujet ! Pour un cadeau, dis-moi pour qui et quel budget ?":curCat==='beaute'?"Nouveau sujet ! Tu cherches quelque chose de précis ?":"Nouveau sujet ! Dis-moi ce que tu cherches et ton budget ?";
      return new Response(JSON.stringify({reply:'<div style="font-size:13.5px;color:#1e293b;line-height:1.6;padding:4px 0">'+resetMsg+'</div>',sessionId:sid,resetContext:true}),{headers:H});
    }

    const hasBudget  = /\d+\s*€|\d+\s*euros?/i.test(message);
    const hasPrecise = message.trim().split(/\s+/).length>=3;
    const mustSearch = qAskedP>=MAX_Q||(hasBudget&&hasPrecise&&(history||[]).length>0);
    let decision = {ready:mustSearch,question:null,recap:null,message:null};

    if (!mustSearch) {
      const p1sys = 'Assistant shopping Huntify. JSON UNIQUEMENT.\n'
        +'Historique: '+(histS||'Debut')+' | Questions posees: '+qAskedP+'/'+MAX_Q+'\n'
        +'Demande vague=ready:false+question. Besoin compris=ready:true+recap.\n'
        +'Si '+qAskedP+'>='+MAX_Q+' ready:true obligatoire. Ne jamais redemander historique.\n'
        +'Recap=mots-cles produit (marque+modele). Reponds JSON: ready, message, recap.';
      const t1 = await callGroq(p1sys,'HIST:\n'+(histS||'Debut')+'\nMSG: '+message,'llama-3.3-70b-versatile',300)||await callGemini(p1sys,'MSG: '+message,300);
      if (t1) {
        const d = parseJSON(t1);
        decision.ready=d.ready===true; decision.recap=d.recap||null; decision.message=d.message||d.question||null;
      }
      if (!decision.ready&&!decision.message&&(history||[]).length===0) {
        const q = curCat==='beaute'?"Tu cherches quelque chose de précis ou les mieux notés ? Et un budget ?":curCat==='electronique'?"Pour quel usage ? Et un budget en tête ?":curCat==='mode'?"Quel style et quelle taille ?":curCat==='cadeau'?"C'est pour qui et quel budget ?":'Tu peux m\'en dire plus ? Un budget ou des préférences ?';
        return new Response(JSON.stringify({reply:'<div style="font-size:13.5px;color:#1e293b;line-height:1.6;padding:4px 0">'+q+'</div>',sessionId:sid}),{headers:H});
      }
    }

    if (!decision.ready&&decision.message) {
      return new Response(JSON.stringify({reply:'<div style="font-size:13.5px;color:#1e293b;line-height:1.6;padding:4px 0">'+decision.message+'</div>',sessionId:sid}),{headers:H});
    }

    const recap  = decision.recap||'Je cherche : '+message;
    const budget = detectBudget(recap)||detectBudget(histS)||detectBudget(message);
    const roi    = estimateROI(budget, message, histS);
    const hasPrev = (history||[]).some(m=>m.role!=='user'&&/\d+€/.test(m.content||''));
    const deepConv = exchanges>=6&&!topicChanged;

    const strategy = ((!hasPrev&&roi.score>=3)||roi.score>=6||deepConv)?'paid_deep':roi.depth==='medium'?'groq_search':'free_fast';
    const effective = (!hasFreeAI()&&strategy!=='paid_deep')?'paid_deep':strategy;

    const dbData    = await queryInternalDB(recap);
    const dbContext = buildDBContext(dbData);
    let products=[], promoCodes=[], summary='';

    if (effective==='groq_search') {
      const gP2 = 'Agent shopping. Cherche Amazon.fr et fr.shopping.rakuten.com.\n'
        +'BESOIN: '+recap+'\n'+dbContext+'\n'
        +'Trouve 2 produits Amazon + 1 Rakuten avec vrais noms (marque+modele).\n'
        +'Si ASIN Amazon reel trouve: url=https://www.amazon.fr/dp/ASIN sinon url=null.\n'
        +'Retourne JSON: summary, products(name/price/store/keywords/url/badge), promoCodes.';
      const raw = await callGroqDS(gP2, 1000);
      const p = parseJSON(raw||''); products=p.products||[]; promoCodes=p.promoCodes||[]; summary=p.summary||'';
    } else if (effective==='paid_deep') {
      const p2sys = 'Agent shopping Huntify. Boutiques: '+activeNames+'.\n'
        +'BESOIN: '+recap+'\n'+dbContext+'\n'
        +'1. AMAZON.FR: 2 produits avec ASIN reels dans URL /dp/ASIN\n'
        +'2. RAKUTEN FR: 1 produit reel\n'
        +'3. CODES PROMO: dealabs.com si disponible\n'
        +'name=NOM COMPLET REEL (marque+modele). store=amazon ou rakuten.\n'
        +'Retourne JSON: summary, products(name/price/store/keywords/url/badge), promoCodes.';
      const raw = await callClaude(p2sys, 'BESOIN: '+recap+'\nMSG: '+message, 800, [{type:"web_search_20250305",name:"web_search",max_uses:3}]);
      const p = parseJSON(raw); products=p.products||[]; promoCodes=p.promoCodes||[]; summary=p.summary||'';
    } else {
      const p2sys = 'Agent shopping. Boutiques: '+activeNames+'. BESOIN: '+recap+' '+dbContext+'\n'
        +'2 produits Amazon + 1 Rakuten. name=NOM REEL (marque+modele).\n'
        +'Retourne JSON: summary, products(name/price/store/keywords/url/badge), promoCodes.';
      const raw = await callFreeAI(p2sys, 'BESOIN: '+recap, 350);
      const p = parseJSON(raw||''); products=p.products||[]; promoCodes=p.promoCodes||[]; summary=p.summary||'';
    }

    if (!products.length) {
      products = advertisers.slice(0,2).map(function(a){return {name:message,price:'Voir prix',store:a.slug,keywords:message,url:null};});
      summary = 'Résultats pour "'+message+'" :';
    }

    let priceHistHtml = '';
    const main = products.find(function(p){return p.store==='amazon';});
    if (main&&main.price&&!main.price.includes('Voir')) {
      const cur = parseFloat(main.price.replace(/[^0-9.,]/g,'').replace(',','.'));
      const slug = main.name.toLowerCase().replace(/\s+/g,'-').slice(0,50);
      const ph = await sbFetch('price_history?product_id=eq.'+slug+'&order=checked_at.desc&limit=10')||[];
      if (ph.length>1&&!isNaN(cur)) {
        const old=ph[ph.length-1].price;
        const trend=cur<old*0.97?'down':cur>old*1.03?'up':'stable';
        priceHistHtml=priceHistBox(old,trend);
      }
      if (!isNaN(cur)) sbFetch('price_history','POST',{product_id:slug,product_name:main.name,price:cur,store:'amazon',url:main.url||null});
    }

    let buttons = '';
    for (const pr of products) {
      if (!pr.name) continue;
      const adv = findAdv(advertisers, pr.store); if(!adv) continue;
      const rawUrl = (pr.url&&pr.url!=='null'&&pr.url.length>15)?pr.url:null;
      const url = buildLink(adv, pr.name&&pr.name.length>5?pr.name:(pr.keywords||pr.name), rawUrl);
      if (!url) continue;
      buttons += productCard(pr.name, pr.price||'Voir prix', url, adv, pr.img||null, pr.badge||null);
    }

    let promos = '';
    for (const c of (promoCodes||[]).filter(function(c){return c.code;}).sort(function(a,b){return (b.best?1:0)-(a.best?1:0);}).slice(0,2)) {
      promos += promoBox(c.code, c.store||'boutique', c.discount||'Réduction', c.best||false);
      sbFetch('promo_codes','POST',{code:c.code,store:c.store||'unknown',discount:c.discount||'',product_query:message,found_at:new Date().toISOString(),valid:true});
    }

    let dbPromos = '';
    for (const adv of advertisers) {
      const cpns = await getAutoCoupons(adv.slug);
      for (const c of cpns) { if(!(promoCodes||[]).find(function(p){return p.code===c.code;})) dbPromos+=promoBox(c.code,c.store||adv.name,c.discount||'Réduction',false); }
    }

    const first = products[0];
    const adv0  = first?findAdv(advertisers,first.store):null;
    const wish  = (first&&adv0)?'<button onclick="addToWishlist('+JSON.stringify({type:'product',name:first.name,price:first.price,store:first.store,url:buildLink(adv0,first.keywords||first.name,first.url||null)}).replace(/"/g,'&quot;')+')" style="background:#fff;border:1.5px solid #e8edf8;color:#3b5bdb;border-radius:12px;padding:8px 16px;margin-top:10px;font-weight:700;font-size:12px;cursor:pointer;font-family:inherit;width:100%">♡ Ajouter à ma wishlist</button>':'';

    const sugs  = getCrossSuggestions(recap);
    const cross = sugs.length?'<div style="margin-top:12px;padding-top:10px;border-top:1px solid #f0f4ff"><div style="font-size:11px;font-weight:700;color:#7c89a8;margin-bottom:6px">Tu pourrais aussi aimer :</div><div style="display:flex;gap:6px;flex-wrap:wrap">'+sugs.map(function(s){return '<button onclick="send(\''+s.replace(/'/g,"\\'")+'\')  " style="background:#f5f7ff;border:1.5px solid #e8edf8;color:#3b5bdb;border-radius:100px;padding:6px 14px;font-size:11px;font-weight:600;cursor:pointer;font-family:inherit">'+s+'</button>';}).join('')+'</div></div>':'';

    const reply = '<div style="font-size:13.5px;color:#1e293b;margin-bottom:8px;font-weight:500;line-height:1.5">'+(decision.message||summary)+'</div>'
      +priceHistHtml+buttons
      +(promos?'<div style="margin-top:4px">'+promos+'</div>':'')
      +(dbPromos?'<div style="margin-top:4px">'+dbPromos+'</div>':'')
      +wish+cross;

    return new Response(JSON.stringify({reply:reply,sessionId:sid}),{headers:H});

  } catch(err) {
    console.error('Huntify error:', err.message);
    return new Response(JSON.stringify({reply:'Désolé, problème technique momentané. Réessayez !'}),{status:200,headers:{'Content-Type':'application/json; charset=utf-8','Access-Control-Allow-Origin':'*'}});
  }
}
