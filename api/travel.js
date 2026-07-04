export const config = { runtime: 'edge' };

import {
  sbFetch, callClaude, parseJSON, buildHistory,
  recapBox, AWIN_PUB
} from './_shared.js';

// ── MAPPING IATA VILLES → CODES ───────────────────────────────────────────────
const IATA_MAP = {
  paris:'CDG', 'paris cdg':'CDG', 'paris orly':'ORY', lyon:'LYS', marseille:'MRS',
  nice:'NCE', bordeaux:'BOD', toulouse:'TLS', nantes:'NTE', strasbourg:'SXB',
  montpellier:'MPL', biarritz:'BIQ', grenoble:'GNB', brest:'BES', rennes:'RNS',
  rome:'FCO', 'rome fco':'FCO', milan:'MXP', 'milan malpensa':'MXP', venise:'VCE',
  naples:'NAP', florence:'FLR', catane:'CTA', palerme:'PMO', bari:'BRI',
  bologne:'BLQ', turin:'TRN', pise:'PSA',
  barcelone:'BCN', madrid:'MAD', ibiza:'IBZ', majorque:'PMI', seville:'SVQ',
  malaga:'AGP', valence:'VLC', bilbao:'BIO', alicante:'ALC', tenerife:'TFS',
  lisbonne:'LIS', porto:'OPO', faro:'FAO',
  londres:'LHR', 'london heathrow':'LHR', 'london gatwick':'LGW', manchester:'MAN', edimbourg:'EDI',
  amsterdam:'AMS', bruxelles:'BRU', zurich:'ZRH', geneve:'GVA', vienne:'VIE',
  berlin:'BER', munich:'MUC', francfort:'FRA', hambourg:'HAM', dusseldorf:'DUS',
  prague:'PRG', budapest:'BUD', varsovie:'WAW', bucarest:'OTP', zagreb:'ZAG',
  sofia:'SOF', athenes:'ATH', thessalonique:'SKG',
  santorin:'JTR', mykonos:'JMK', crete:'HER', heraklion:'HER', rhodes:'RHO', corfou:'CFU',
  marrakech:'RAK', casablanca:'CMN', agadir:'AGA', fes:'FEZ',
  tunis:'TUN', djerba:'DJE',
  hurghada:'HRG', 'charm el cheikh':'SSH', caire:'CAI',
  istanbul:'IST', antalya:'AYT', bodrum:'BJV',
  dubai:'DXB', abu:'AUH', 'abu dhabi':'AUH', doha:'DOH', riyad:'RUH',
  tokyo:'NRT', osaka:'KIX', bangkok:'BKK', singapour:'SIN',
  'hong kong':'HKG', hanoi:'HAN', 'ho chi minh':'SGN', bali:'DPS', denpasar:'DPS',
  kuala:'KUL', 'kuala lumpur':'KUL', shanghai:'PVG', pekin:'PEK', seoul:'ICN',
  'new york':'JFK', 'los angeles':'LAX', miami:'MIA', montreal:'YUL',
  toronto:'YYZ', cancun:'CUN', 'mexico':'MEX',
  dakar:'DSS', abidjan:'ABJ', nairobi:'NBO', reunion:'RUN', 'la reunion':'RUN',
  maldives:'MLE', maurice:'MRU',
};

function cityToIATA(str) {
  if (!str) return null;
  const s = str.toLowerCase().trim();
  const m3 = (str||'').match(/\b([A-Z]{3})\b/);
  if (m3) return m3[1].toUpperCase();
  for (const [key, code] of Object.entries(IATA_MAP)) {
    if (s.includes(key)) return code;
  }
  const initials = s.replace(/[^a-z]/g,'').slice(0,3).toUpperCase();
  return initials.length === 3 ? initials : null;
}

// ── BOOKING LINK ──────────────────────────────────────────────────────────────
function buildBookingLink(destination, nights=5, adults=2, minPrice=null, maxPrice=null, checkin=null, checkout=null) {
  const dest = encodeURIComponent((destination||'').trim());
  const rooms = Math.ceil(adults / 2);

  let url = `https://www.booking.com/searchresults.html`
          + `?ss=${dest}`
          + `&group_adults=${adults}`
          + `&no_rooms=${rooms}`
          + `&lang=fr`;

  if (checkin && checkout) {
    url += `&checkin=${checkin}&checkout=${checkout}`;
  } else if (nights > 0) {
    url += `&nights=${nights}`;
  }

  if (minPrice != null && maxPrice != null && minPrice >= 0 && maxPrice > 0) {
    url += `&nflt=price%3DEUR-${Math.round(minPrice)}-${Math.round(maxPrice)}-1`;
  }

  url += `&order=class`;

  const cjPub = (typeof process !== 'undefined' && process.env?.CJ_PUBLISHER_ID) || null;
  const cjAdv = (typeof process !== 'undefined' && process.env?.CJ_BOOKING_ADVERTISER_ID) || null;
  if (cjPub && cjAdv) {
    return `https://www.anrdoezrs.net/click-${cjPub}-${cjAdv}?url=${encodeURIComponent(url)}`;
  }
  return url;
}

// ── GETTRANSFER (Travelpayouts) ────────────────────────────────────────────────
function buildGetTransferLink(dest, ci) {
  const base = 'https://gettransfer.tpk.mx/vMnVrFfO';
  return dest ? base + '?to=' + encodeURIComponent(dest) + (ci ? '&date=' + ci : '') : base;
}

// ── EXPEDIA ─────────────────────────────────────────────────────────────────────
function buildExpediaLink(dest, ci, co, adults) {
  let url = 'https://www.expedia.fr/Hotel-Search?destination=' + encodeURIComponent(dest||'') + '&adults=' + (adults||2);
  if (ci) url += '&startDate=' + ci;
  if (co) url += '&endDate=' + co;
  return url;
}

// ── EUROCAR (location de voiture, via Awin ID 7418) ───────────────────────────
function buildEurocarLink(dest, ci, co) {
  const destUrl = `https://www.europcar.fr/fr/search?pickUpLocation=${encodeURIComponent(dest||'')}`
    + (ci ? `&pickUpDate=${ci}` : '')
    + (co ? `&dropOffDate=${co}` : '')
    + `&pickUpLocation=${encodeURIComponent(dest||'')}`;
  // Awin tracking — Europcar advertiser ID 7418
  return `https://www.awin1.com/cread.php?awinmid=7418&awinaffid=${AWIN_PUB}&ued=${encodeURIComponent(destUrl)}`;
}

// Heuristique simple : la location de voiture a du sens hors grandes métropoles
// bien desservies en transports en commun (Paris, Londres, Rome, Barcelone, Tokyo...)
function suggestsCarRental(dest, style) {
  const noNeed = ['paris','londres','rome','barcelone','madrid','amsterdam','berlin','tokyo','new york','singapour'];
  const d = (dest||'').toLowerCase();
  if (noNeed.some(c => d.includes(c))) return false;
  if (/road.?trip|campagne|nature|ile|île|montagne|aventure/i.test(style||'')) return true;
  return true; // par défaut on propose, l'utilisateur clique ou ignore
}

// ── SKYSCANNER LINK ───────────────────────────────────────────────────────────
function buildSkyscannerLink(fromStr, toStr, outbound, inbound, adults=2) {
  const from = cityToIATA(fromStr) || 'par';
  const to   = cityToIATA(toStr)   || 'xxx';
  const fromLc = from.toLowerCase();
  const toLc   = to.toLowerCase();

  function skyfmt(d) {
    if (!d) return null;
    const clean = d.replace(/-/g,'');
    return clean.length >= 8 ? clean.slice(2) : null;
  }

  const out = skyfmt(outbound);
  const ret = skyfmt(inbound);

  if (out && ret) {
    return `https://www.skyscanner.fr/transport/vols/${fromLc}/${toLc}/${out}/${ret}/?adults=${adults}&currency=EUR&locale=fr-FR`;
  }
  if (out) {
    return `https://www.skyscanner.fr/transport/vols/${fromLc}/${toLc}/${out}/?adults=${adults}&currency=EUR&locale=fr-FR`;
  }
  return `https://www.skyscanner.fr/transport/vols/${fromLc}/${toLc}/`;
}

// ── PARSE DATE ────────────────────────────────────────────────────────────────
function parseDate(str) {
  if (!str) return null;
  const s = str.trim().toLowerCase();

  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;

  const now = new Date();
  if (s === 'demain' || s === 'tomorrow') {
    const d = new Date(now.getTime() + 86400000);
    return d.toISOString().slice(0,10);
  }
  if (s === 'après-demain' || s === 'apres-demain') {
    const d = new Date(now.getTime() + 2*86400000);
    return d.toISOString().slice(0,10);
  }
  if (/ce week-?end|ce weekend/.test(s)) {
    const day = now.getDay();
    const daysUntilSat = (6 - day + 7) % 7 || 7;
    const d = new Date(now.getTime() + daysUntilSat*86400000);
    return d.toISOString().slice(0,10);
  }

  const dm = str.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (dm) {
    const y = dm[3].length===2 ? '20'+dm[3] : dm[3];
    return `${y}-${dm[2].padStart(2,'0')}-${dm[1].padStart(2,'0')}`;
  }

  const MONTHS = {
    'jan':1,'janv':1,'janvier':1,
    'fév':2,'fev':2,'fevr':2,'février':2,
    'mar':3,'mars':3,
    'avr':4,'avril':4,
    'mai':5,
    'juin':6,
    'juil':7,'juillet':7,
    'aoû':8,'aou':8,'aout':8,'août':8,
    'sep':9,'sept':9,'septembre':9,
    'oct':10,'octobre':10,
    'nov':11,'novembre':11,
    'déc':12,'dec':12,'décembre':12,'decembre':12,
  };
  const fm = s.match(/(\d{1,2})\s+([a-zéûôàù]+)(?:\s+(\d{4}))?/);
  if (fm) {
    const mn = fm[2];
    const mm = Object.entries(MONTHS).find(([k]) => mn.startsWith(k));
    if (mm) {
      const y = fm[3] || String(now.getFullYear());
      return `${y}-${String(mm[1]).padStart(2,'0')}-${fm[1].padStart(2,'0')}`;
    }
  }

  const dayOnly = str.match(/^(\d{1,2})$/);
  if (dayOnly) {
    const day = parseInt(dayOnly[1]);
    const cur = new Date(now);
    if (day <= cur.getDate()) cur.setMonth(cur.getMonth()+1);
    cur.setDate(day);
    return cur.toISOString().slice(0,10);
  }

  return null;
}

// ── EXTRACTION INFOS VOYAGE ───────────────────────────────────────────────────
function extractTravelInfo(hist, message) {
  const text = ((hist||'')+ ' '+message).toLowerCase();
  const info = {};

  const destM = text.match(/(?:aller|partir|voyager|destination|visiter|à|a|en|au|aux|pour)\s+([a-zA-ZÀ-ÿ\s]{2,25})(?:\.|,|!|\?|\s(?:du|le|en|pour|avec)|$)/i)
             || text.match(/(?:je veux|on veut|j'aimerais|week.?end)\s+(?:aller|partir)?\s*(?:a|à|en|au)?\s*([a-zA-ZÀ-ÿ\s]{2,25})/i);
  if (destM) info.destination = destM[1].trim();

  const budM = text.match(/budget\s*:?\s*(\d+)\s*(?:€|euros?)/i) || text.match(/(\d+)\s*(?:€|euros?)\s*(?:par personne|pp)?/i);
  if (budM) info.budget = budM[1]+'€';

  const durM = text.match(/(\d+)\s*(?:jours?|nuits?|semaines?)/i);
  if (durM) info.duree = durM[0];

  const travM = text.match(/(\d+)\s*(?:personnes?|adultes?|voyageurs?)/i)
             || text.match(/(?:seul|couple|famille|duo|amis)/i);
  if (travM) info.voyageurs = travM[0];

  const depPatterns = [
    /depuis\s+([a-zA-ZÀ-ÿ\s]{2,25})(?:\s|,|\.)/i,
    /départ\s+de\s+([a-zA-ZÀ-ÿ\s]{2,25})(?:\s|,|\.)/i,
    /je pars? (?:de|depuis)\s+([a-zA-ZÀ-ÿ\s]{2,25})(?:\s|,|\.)/i,
    /on part (?:de|depuis)\s+([a-zA-ZÀ-ÿ\s]{2,25})(?:\s|,|\.)/i,
    /au départ de\s+([a-zA-ZÀ-ÿ\s]{2,25})(?:\s|,|\.)/i,
  ];
  for (const p of depPatterns) {
    const m = text.match(p);
    if (m) { info.ville_depart = m[1].trim(); break; }
  }

  const rangeFull = text.match(/du\s+(\d{1,2}\s+\w+(?:\s+\d{4})?)\s+au\s+(\d{1,2}\s+\w+(?:\s+\d{4})?)/i);
  if (rangeFull) {
    info.date_depart_raw = rangeFull[1];
    info.date_retour_raw = rangeFull[2];
  } else {
    const rangeShort = text.match(/du\s+(\d{1,2})\s+au\s+(\d{1,2})\s+(\w+)/i);
    if (rangeShort) {
      info.date_depart_raw = `${rangeShort[1]} ${rangeShort[3]}`;
      info.date_retour_raw = `${rangeShort[2]} ${rangeShort[3]}`;
    } else {
      const single = text.match(/(?:le|du)\s+(\d{1,2}\s+\w+(?:\s+\d{4})?)/i);
      if (single) info.date_depart_raw = single[1];
      else if (/demain/.test(text)) info.date_depart_raw = 'demain';
    }
  }

  return info;
}

function countTravelQ(history) {
  return (history||[]).filter(m=>m.role!=='user'&&(m.content||'').length>20).length;
}

// ── COMPOSANTS HTML SPÉCIFIQUES VOYAGE ────────────────────────────────────────
function hotelCard(h, bookingUrl) {
  const stars = '⭐'.repeat(Math.min(h.stars||3,5));
  const cc = {budget:'#16a34a',confort:'#2f54ff',luxe:'#7c3aed'}[h.category]||'#2f54ff';
  const cl = {budget:'💚 Budget',confort:'💙 Confort',luxe:'💎 Luxe'}[h.category]||'';
  const url = h.booking_link || bookingUrl;
  return `<a href="${url}" target="_blank" rel="sponsored noopener" style="display:flex;flex-direction:column;background:#fff;border:1.5px solid #e6ebf7;border-radius:14px;padding:13px;margin-top:8px;text-decoration:none;gap:5px">
    <div style="display:flex;justify-content:space-between;align-items:flex-start">
      <div style="flex:1">
        ${cl?`<span style="background:#eff6ff;color:${cc};border-radius:100px;padding:2px 9px;font-size:10px;font-weight:800">${cl}</span>`:''}
        <div style="font-size:13px;font-weight:800;color:#0e1430;margin-top:3px">${h.name}</div>
        <div style="font-size:11px;color:#7c89a8">${stars} · ${h.location||''}</div>
      </div>
      <div style="background:linear-gradient(135deg,${cc},${cc}cc);color:#fff;border-radius:10px;padding:7px 11px;text-align:right;flex-shrink:0;margin-left:8px">
        <div style="font-size:15px;font-weight:900">${h.price||'?'}€</div>
        <div style="font-size:9px;opacity:.8">/nuit</div>
      </div>
    </div>
    ${h.highlight?`<div style="font-size:11px;color:#2f54ff;font-weight:600;background:#eff6ff;border-radius:8px;padding:4px 10px">✨ ${h.highlight}</div>`:''}
    <div style="font-size:10.5px;color:#94a3b8;font-weight:600;margin-top:2px">🏨 Voir disponibilités sur Booking.com →</div>
  </a>`;
}

function dayCard(d) {
  return `<div style="background:#fff;border:1.5px solid #e6ebf7;border-radius:14px;padding:14px;margin-top:9px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
      <div style="background:linear-gradient(135deg,#2f54ff,#4a6bff);color:#fff;border-radius:8px;padding:4px 12px;font-size:12px;font-weight:800">Jour ${d.num}</div>
      <div style="font-size:12px;font-weight:700;color:#0e1430;flex:1;margin-left:8px">${d.title||''}</div>
      ${d.budget?`<div style="font-size:11px;color:#16a34a;font-weight:700">~${d.budget}€</div>`:''}
    </div>
    ${d.morning?`<div style="display:flex;gap:9px;margin-bottom:8px"><span>🌅</span><div><div style="font-size:10px;font-weight:800;color:#94a3b8;text-transform:uppercase">Matin</div><div style="font-size:12px;color:#374151">${d.morning}</div></div></div>`:''}
    ${d.afternoon?`<div style="display:flex;gap:9px;margin-bottom:8px"><span>☀️</span><div><div style="font-size:10px;font-weight:800;color:#94a3b8;text-transform:uppercase">Après-midi</div><div style="font-size:12px;color:#374151">${d.afternoon}</div></div></div>`:''}
    ${d.evening?`<div style="display:flex;gap:9px;margin-bottom:4px"><span>🌙</span><div><div style="font-size:10px;font-weight:800;color:#94a3b8;text-transform:uppercase">Soirée</div><div style="font-size:12px;color:#374151">${d.evening}</div></div></div>`:''}
    ${d.restaurant?`<div style="background:#f0fdf4;border-radius:9px;padding:7px 11px;margin-top:6px;display:flex;justify-content:space-between"><div style="font-size:11px;color:#16a34a;font-weight:700">🍽️ ${d.restaurant.name||''}</div><div style="font-size:11px;color:#16a34a;font-weight:700">${d.restaurant.price||''}</div></div>`:''}
    ${d.activities?.length?`<div style="margin-top:7px;display:flex;flex-wrap:wrap;gap:4px">${d.activities.map(a=>`<span style="background:#eff6ff;color:#2f54ff;border-radius:100px;padding:2px 9px;font-size:10.5px;font-weight:600">${a}</span>`).join('')}</div>`:''}
  </div>`;
}

function budgetCard(b) {
  const items = [
    ['✈️ Vols A/R',         b.flights_total],
    ['🏨 Hébergement',       b.accommodation_total],
    ['🎯 Activités',         b.activities_total],
    ['🍽️ Restaurants',       b.food_total],
    ['🚇 Transport local',   b.transport_local]
  ].filter(i => i[1] != null && i[1] !== '');
  return `<div style="background:linear-gradient(135deg,#0e1430,#1f2da0);border-radius:16px;padding:16px;margin-top:12px">
    <div style="font-size:13px;font-weight:800;color:#fff;margin-bottom:12px">💰 Budget total estimé</div>
    ${items.map(([l,v])=>`<div style="display:flex;justify-content:space-between;margin-bottom:7px"><span style="font-size:12px;color:rgba(255,255,255,.75)">${l}</span><span style="font-size:12px;font-weight:700;color:#fff">${v}€</span></div>`).join('')}
    <div style="border-top:1px solid rgba(255,255,255,.2);margin-top:10px;padding-top:10px;display:flex;justify-content:space-between">
      <span style="font-size:13px;font-weight:800;color:#fff">TOTAL</span>
      <span style="font-size:16px;font-weight:900;color:#bcd0ff">${b.total||''}€</span>
    </div>
    ${b.per_person?`<div style="font-size:11px;color:rgba(255,255,255,.6);text-align:right;margin-top:3px">soit ${b.per_person}€/personne</div>`:''}
    <div style="font-size:10px;color:rgba(255,255,255,.4);margin-top:8px">Prix indicatifs · Cliquez les liens pour vérifier disponibilités et tarifs réels</div>
  </div>`;
}

function tipsCard(tips) {
  if (!tips?.length) return '';
  return `<div style="background:#f5f3ff;border:1.5px solid #ddd6fe;border-radius:14px;padding:14px;margin-top:10px">
    <div style="font-size:12px;font-weight:800;color:#5b21b6;margin-bottom:8px">💡 Conseils pratiques</div>
    ${tips.map(t=>`<div style="font-size:12px;color:#374151;margin-bottom:5px;padding-left:8px;border-left:2px solid #c4b5fd">• ${t}</div>`).join('')}
  </div>`;
}

// ── HANDLER ───────────────────────────────────────────────────────────────────
export default async function handler(req) {
  if (req.method==='OPTIONS') return new Response(null,{status:204,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type'}});
  if (req.method!=='POST')   return new Response('Method not allowed',{status:405});

  const H = {'Content-Type':'application/json; charset=utf-8','Access-Control-Allow-Origin':'*'};

  try {
    const { message, history, sessionId, userId, trackingEnabled, travelContext } = await req.json();
    const sid = sessionId || `anon_${Date.now()}`;

    if (trackingEnabled) {
      Promise.all([
        sbFetch('searches','POST',{query:`[VOYAGE] ${message}`,session_id:sid,user_id:userId||null}),
        sbFetch('trends','POST',{query:message.toLowerCase().trim(),count:1,last_searched:new Date().toISOString()})
      ]);
    }

    const hist = buildHistory(history);
    const ctx  = travelContext || {};

    const qAsked = countTravelQ(history);
    const extr   = extractTravelInfo(hist, message);
    const merged = { ...extr, ...Object.fromEntries(Object.entries(ctx).filter(([k,v])=>v&&k!=='suggestionsShown')) };
    const mStr   = Object.entries(merged).filter(([,v])=>v).map(([k,v])=>`${k}:${v}`).join(', ');

    const tSys = 'Expert agent voyage Huntify. Tu geres la conversation ET generes l itineraire.\n'
      + '\nINFOS COLLECTEES : ' + (mStr||'aucune')
      + '\nHISTORIQUE : ' + (hist||'debut')
      + '\nQuestions posees : ' + qAsked
      + '\n\nCOMPORTEMENT :\n'
      + '- Si infos insuffisantes: pose UNE question naturelle et courte\n'
      + '- Si tu as destination + duree + ville de depart: genere l itineraire COMPLET\n'
      + '- Ne redemande JAMAIS ce qui est dans les infos collectees\n'
      + '- Si ' + qAsked + ' >= 4: genere avec ce que tu as\n'
      + '\nPOUR LES QUESTIONS : naturel, chaleureux, concis.\n'
      + '\nPOUR LA GENERATION - REGLES ABSOLUES :\n'
      + '- checkin/checkout TOUJOURS en ISO YYYY-MM-DD. Aujourd hui = ' + new Date().toISOString().slice(0,10) + '\n'
      + '- from/to vols = codes IATA 3 lettres MAJ (BCN CDG FCO LIS NCE MRS etc.)\n'
      + '- hotels.name = NOM REEL existant dans cette ville\n'
      + '- 3 hotels obligatoires (budget/confort/luxe)\n'
      + '- Budget dispatche: vols + hotel + restau + activites + transport\n'
      + '\nJSON UNIQUEMENT - 3 formats:\n'
      + 'Question: t=q, msg=question\n'
      + 'Suggestions: t=s, intro, dests=[n,e,why,price,tags], q\n'
      + 'Itineraire: t=i, recap, itin={dest,country,flag,dur,trav,style,dep,'
      + 'checkin:YYYY-MM-DD,checkout:YYYY-MM-DD,adults,'
      + 'flights:{out:{from:IATA,to:IATA,price,co,dur},ret:{...}},'
      + 'hotels:[{name,stars,price,loc,hl,cat:budget/confort/luxe}],'
      + 'days:[{n,title,am,pm,eve,resto:{name,price,spec},acts:[],budget}],'
      + 'budget:{vols,hotel,acts,resto,transport,total,pp},'
      + 'tips:[conseils]}';

    const allText = (hist+' '+message+' '+mStr).toLowerCase();
    const hasDest  = merged.destination || /capri|paris|rome|lisbonne|barcelone|londres|tokyo|bali|venise|madrid|amsterdam|berlin|prague|naples|athenes|santorin|marrakech|dubai|côte.?d'azur/i.test(allText);
    const hasDep   = merged.ville_depart || /depuis|de barcelone|de paris|de lyon|de marseille|de nice|de bordeaux|de toulouse|depuis nice|depuis paris|départ de/i.test(allText);
    const hasDates = merged.duree || /\d+\s*(jours?|nuits?|semaines?)|du \d+|demain|week.?end/i.test(allText);
    const readyGen = hasDest && hasDep && hasDates;

    const tUser = `COLLECTE: ${mStr||'rien'}\nHISTORIQUE: ${hist||'debut'}\nMESSAGE: ${message}${readyGen ? '\n\n[INFOS COMPLÈTES → GÉNÈRE ITINÉRAIRE MAINTENANT, format t:i, PAS DE QUESTION]' : ''}`;
    const tRaw  = await callClaude(tSys, tUser, 3000, []);
    const tP    = parseJSON(tRaw || '');

    if (tP.t === 'q' || (!tP.t && tP.msg)) {
      return new Response(JSON.stringify({
        reply: `<div style="font-size:13.5px;color:#1e293b;line-height:1.6;padding:4px 0">${tP.msg||tP.message||''}</div>`,
        sessionId: sid
      }), {headers:H});
    }

    if (tP.t === 's' && tP.dests?.length) {
      let html = `<div style="font-size:13.5px;color:#1e293b;line-height:1.6;padding:4px 0 8px">${tP.intro||'Voici mes suggestions :'}</div>`;
      for (const d of tP.dests) {
        html += `<div onclick="send('${(d.n||'').replace(/'/g,"\\'")}')" style="background:#fff;border:1.5px solid #e6ebf7;border-radius:16px;padding:14px;margin-top:8px;cursor:pointer">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
            <span style="font-size:24px">${d.e||'🌍'}</span>
            <div><div style="font-size:14px;font-weight:800;color:#0e1430">${d.n}</div>
            <div style="font-size:11px;color:#7c89a8">${d.price||''}</div></div>
          </div>
          <div style="font-size:12px;color:#374151;margin-bottom:7px">${d.why||''}</div>
          <div style="display:flex;flex-wrap:wrap;gap:4px">${(d.tags||[]).map(t=>`<span style="background:#eff6ff;color:#2f54ff;border-radius:100px;padding:2px 9px;font-size:11px;font-weight:600">${t}</span>`).join('')}</div>
        </div>`;
      }
      if (tP.q) html += `<div style="font-size:13.5px;color:#1e293b;padding:8px 0 0">${tP.q}</div>`;
      return new Response(JSON.stringify({reply:html,sessionId:sid}),{headers:H});
    }

    const itin = tP.itin;
    if (!itin) {
      return new Response(JSON.stringify({
        reply: `<div style="font-size:13.5px;color:#1e293b;line-height:1.6;padding:4px 0">${tP.msg||"Pour générer votre itinéraire, j'ai besoin de : destination, durée, ville de départ 🗺️"}</div>`,
        sessionId: sid
      }), {headers:H});
    }

    let html = '';
    const itinId = `itin_${Date.now()}`;

    html += `<div id="${itinId}" style="background:linear-gradient(135deg,#1f2da0,#2f54ff);border-radius:16px;padding:18px;margin-bottom:4px;text-align:center">
      <div style="font-size:32px;margin-bottom:6px">${itin.flag||'✈️'}</div>
      <div style="font-family:'Sora',sans-serif;font-size:20px;font-weight:800;color:#fff">${itin.dest||''}${itin.country?', '+itin.country:''}</div>
      <div style="font-size:12px;color:rgba(255,255,255,.75);margin-top:6px;display:flex;justify-content:center;gap:12px;flex-wrap:wrap">
        <span>📅 ${itin.dur||''}</span>
        <span>👥 ${itin.trav||'2 pers.'}</span>
        ${itin.dep?`<span>🛫 Depuis ${itin.dep}</span>`:''}
        ${itin.budget?.total?`<span>💰 ~${itin.budget.total}€</span>`:''}
      </div>
    </div>`;

    if (tP.recap) html += recapBox(tP.recap);

    const adults = itin.adults || merged.nb_adultes || 2;
    const nightsRaw = parseInt((itin.dur||'').match(/\d+/)?.[0] || '3');
    const nights = isNaN(nightsRaw) ? 3 : nightsRaw;

    const ci = (itin.checkin && /^\d{4}-\d{2}-\d{2}$/.test(itin.checkin))
             ? itin.checkin
             : parseDate(merged.date_depart_raw || itin.checkin || null);
    const co = (itin.checkout && /^\d{4}-\d{2}-\d{2}$/.test(itin.checkout))
             ? itin.checkout
             : parseDate(merged.date_retour_raw || itin.checkout || null)
               || (() => {
                 if (ci) {
                   const d = new Date(ci);
                   d.setDate(d.getDate() + nights);
                   return d.toISOString().slice(0,10);
                 }
                 return null;
               })();

    if (itin.flights?.out) {
      const f = itin.flights;
      const skyUrl = buildSkyscannerLink(
        f.out.from || itin.dep || merged.ville_depart || '',
        f.out.to   || itin.dest || '',
        ci, co, adults
      );

      html += `<div style="font-size:12px;font-weight:800;color:#0e1430;margin:14px 0 6px">✈️ Vols recommandés</div>
      <div style="background:#fff;border:1.5px solid #e6ebf7;border-radius:14px;overflow:hidden">
        <div style="padding:12px 14px;border-bottom:1px solid #f0f4ff">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <div>
              <div style="font-size:10px;font-weight:800;color:#7c89a8;text-transform:uppercase">Aller · ${ci||''}</div>
              <div style="font-size:13px;font-weight:700;color:#0e1430;margin-top:2px">${f.out.from||''} → ${f.out.to||''}</div>
              <div style="font-size:11px;color:#7c89a8">${f.out.co||''} · ${f.out.dur||''}</div>
            </div>
            <div style="text-align:right">
              <div style="font-size:16px;font-weight:900;color:#2f54ff">~${f.out.price||'?'}€</div>
              <div style="font-size:10px;color:#7c89a8">/pers.</div>
            </div>
          </div>
        </div>
        ${f.ret ? `<div style="padding:12px 14px">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <div>
              <div style="font-size:10px;font-weight:800;color:#7c89a8;text-transform:uppercase">Retour · ${co||''}</div>
              <div style="font-size:13px;font-weight:700;color:#0e1430;margin-top:2px">${f.ret.from||''} → ${f.ret.to||''}</div>
              <div style="font-size:11px;color:#7c89a8">${f.ret.co||''} · ${f.ret.dur||''}</div>
            </div>
            <div style="text-align:right">
              <div style="font-size:16px;font-weight:900;color:#2f54ff">~${f.ret.price||'?'}€</div>
              <div style="font-size:10px;color:#7c89a8">/pers.</div>
            </div>
          </div>
        </div>` : ''}
      </div>
      <a href="${skyUrl}" target="_blank" rel="noopener" style="display:flex;align-items:center;justify-content:center;gap:8px;background:linear-gradient(135deg,#0e1430,#1f2da0);color:#fff;text-decoration:none;border-radius:12px;padding:12px;font-size:13px;font-weight:700;margin-top:6px">
        🔍 Comparer ces vols sur Skyscanner →
      </a>`;
    }

    if (itin.hotels?.length) {
      html += `<div style="font-size:12px;font-weight:800;color:#0e1430;margin:16px 0 6px">🏨 Hébergements sur Booking.com</div>`;

      const hotelPrices = [];
      for (const h of itin.hotels) {
        const p = parseInt(h.price);
        if (p > 0) hotelPrices.push(p);

        const hotelQuery = [h.name, itin.dest].filter(Boolean).join(' ');
        const hotelLink = buildBookingLink(hotelQuery, nights, adults, null, null, ci, co);

        html += hotelCard(
          { name:h.name, stars:h.stars, price:h.price,
            location:h.loc, highlight:h.hl, booking_link:null, category:h.cat },
          hotelLink
        );
      }

      const minP = hotelPrices.length ? Math.max(0, Math.min(...hotelPrices) - 30) : null;
      const maxP = hotelPrices.length ? Math.max(...hotelPrices) + 60 : null;
      const exploreUrl = buildBookingLink(itin.dest||'', nights, adults, minP, maxP, ci, co);

      html += `<a href="${exploreUrl}" target="_blank" rel="sponsored noopener" style="display:flex;align-items:center;justify-content:center;gap:8px;background:#f5f7ff;border:1.5px solid #c7d2fe;color:#3b5bdb;text-decoration:none;border-radius:12px;padding:11px;margin-top:8px;font-size:12px;font-weight:700">
        🔍 Voir d'autres hôtels disponibles${ci?' ('+ci+' → '+co+')':''} →
      </a>`;
    }

    // ── Location de voiture (Eurocar via Awin) ──────────────────────────────
    if (suggestsCarRental(itin.dest, itin.style)) {
      const carUrl = buildEurocarLink(itin.dest||'', ci, co);
      html += `<a href="${carUrl}" target="_blank" rel="sponsored noopener" style="display:flex;align-items:center;gap:10px;background:linear-gradient(135deg,#1a1a2e,#16213e);color:#fff;text-decoration:none;border-radius:14px;padding:13px 14px;margin-top:10px">
        <span style="font-size:22px">🚗</span>
        <div style="flex:1">
          <div style="font-size:12.5px;font-weight:800">Louer une voiture sur place</div>
          <div style="font-size:11px;opacity:.75">Europcar · ${itin.dest||''}${ci?' · '+ci+' → '+co:''}</div>
        </div>
        <span style="font-size:11px;font-weight:700;background:rgba(255,255,255,.15);border-radius:8px;padding:5px 10px">Voir prix →</span>
      </a>`;
    }

    if (itin.days?.length) {
      html += `<div style="font-size:12px;font-weight:800;color:#0e1430;margin:16px 0 6px">📅 Programme jour par jour</div>`;
      for (const d of itin.days) {
        html += dayCard({ num:d.n, title:d.title, morning:d.am, afternoon:d.pm, evening:d.eve,
          restaurant:d.resto, activities:d.acts, budget:d.budget });
      }
    }

    if (itin.budget) {
      const b = itin.budget;
      html += budgetCard({
        flights_total:b.vols, accommodation_total:b.hotel,
        activities_total:b.acts, food_total:b.resto,
        transport_local:b.transport, total:b.total, per_person:b.pp
      });
    }

    if (itin.tips?.length) html += tipsCard(itin.tips);

    const h1 = (itin.hotels||[])[0];
    const bookLinkWish = h1
      ? buildBookingLink([h1.name, itin.dest].join(' '), nights, adults, null, null, ci, co)
      : buildBookingLink(itin.dest||'', nights, adults, null, null, ci, co);

    const skyLinkWish = itin.flights?.out
      ? buildSkyscannerLink(itin.flights.out.from||'', itin.flights.out.to||'', ci, co, adults)
      : null;

    const wishData = JSON.stringify({
      type:'voyage',
      name:`${itin.flag||'✈️'} ${itin.dest||''}${itin.country?', '+itin.country:''}`,
      subtitle:`${itin.dur||''} · ${itin.trav||adults+' pers.'} · ${itin.style||''}`,
      price: itin.budget?.total ? String(itin.budget.total)+'€' : '',
      perPerson: itin.budget?.pp ? String(itin.budget.pp)+'€/pers.' : '',
      store:'booking', url:bookLinkWish,
      flightUrl:skyLinkWish,
      dep:itin.dep||'',
      hotels:(itin.hotels||[]).slice(0,3).map(h=>({
        name:h.name||'',
        price:(h.price||'?')+'€/nuit',
        cat:h.cat||'confort',
        url:buildBookingLink([h.name,itin.dest].join(' '), nights, adults, null, null, ci, co)
      })),
      budget:itin.budget||null
    }).replace(/"/g,'&quot;');

    html += `<div style="display:flex;gap:8px;margin-top:12px">
      <button onclick="addToWishlist(${wishData})" style="flex:1;background:linear-gradient(135deg,#1f2da0,#2f54ff);border:none;color:#fff;border-radius:12px;padding:12px 14px;font-weight:700;font-size:13px;cursor:pointer;font-family:inherit">♡ Sauvegarder</button>
      <button onclick="exportItinerary('${itinId}')" style="background:#f5f7ff;border:1.5px solid #c7d2fe;color:#3b5bdb;border-radius:12px;padding:12px 14px;font-weight:700;font-size:13px;cursor:pointer;font-family:inherit">⬇️ Exporter PDF</button>
    </div>`;

    return new Response(JSON.stringify({reply:html,sessionId:sid}),{headers:H});

  } catch(err) {
    console.error('Huntify travel error:', err.message);
    return new Response(
      JSON.stringify({reply:"Désolé, problème technique momentané. Réessayez !"}),
      {status:200, headers:{'Content-Type':'application/json; charset=utf-8','Access-Control-Allow-Origin':'*'}}
    );
  }
}
