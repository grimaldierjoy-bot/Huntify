export const config = { runtime: 'edge' };

// ─────────────────────────────────────────────────────────────────────────────
// HUNTIFY — /api/travel.js — Agent Voyage
// FICHIER 100% AUTONOME — aucun import relatif (même raison que chat.js :
// ce projet Vercel ne supporte pas les imports entre fichiers /api).
//
// PIPELINE :
//   1. DÉCISION  → IA gratuite (Groq compound-beta → Gemini/Mistral), lit tout
//                  l'historique, plafond 2 questions (anti-boucle)
//   2. GÉNÉRATION → IA gratuite (Groq compound-beta, recherche web) construit
//                   l'itinéraire (hôtels réels, prix réalistes)
//   3. SECOURS    → Claude + web_search, UNIQUEMENT si (2) échoue. Plafonné.
//
// ENRICHISSEMENTS : météo réelle (Open-Meteo, gratuit, sans clé), transport
// local, budget ventilé par jour + global.
// ─────────────────────────────────────────────────────────────────────────────

const SUPABASE_URL = "https://enocxbrqyybendertytl.supabase.co";
const SUPABASE_KEY = "sb_publishable_NmPh--frZG5HuqfaoxnemA_E7cidV9Y";
const CLAUDE_MODEL = "claude-haiku-4-5";
const AWIN_PUB = "2920215";
const SAFETY_CEILING = 6; // filet ANTI-BOUCLE uniquement (jamais un objectif de questions) — l'IA décide seule combien lui sont vraiment nécessaires
const CLAUDE_HARD_CAP = 2000;

// ── IATA ──────────────────────────────────────────────────────────────────────
const IATA = {
  paris:"CDG",lyon:"LYS",marseille:"MRS",nice:"NCE",bordeaux:"BOD",toulouse:"TLS",
  nantes:"NTE",strasbourg:"SXB",montpellier:"MPL",rennes:"RNS",
  rome:"FCO",milan:"MXP",venise:"VCE",naples:"NAP",florence:"FLR",
  barcelone:"BCN",madrid:"MAD",ibiza:"IBZ",majorque:"PMI",seville:"SVQ",malaga:"AGP",
  lisbonne:"LIS",porto:"OPO",faro:"FAO",
  londres:"LHR",manchester:"MAN",edimbourg:"EDI",
  amsterdam:"AMS",bruxelles:"BRU",zurich:"ZRH",geneve:"GVA",vienne:"VIE",
  berlin:"BER",munich:"MUC",francfort:"FRA",hambourg:"HAM",
  prague:"PRG",budapest:"BUD",varsovie:"WAW",
  athenes:"ATH",santorin:"JTR",mykonos:"JMK",crete:"HER",rhodes:"RHO",
  marrakech:"RAK",casablanca:"CMN",agadir:"AGA",tunis:"TUN",djerba:"DJE",
  istanbul:"IST",antalya:"AYT",hurghada:"HRG",
  dubai:"DXB",doha:"DOH",
  tokyo:"NRT",bangkok:"BKK",bali:"DPS",singapour:"SIN",
  "new york":"JFK","los angeles":"LAX",miami:"MIA",montreal:"YUL",cancun:"CUN",
  maldives:"MLE",maurice:"MRU",reunion:"RUN"
};

function toIATA(str) {
  if (!str) return null;
  const m = (str || "").match(/\b([A-Z]{3})\b/); if (m) return m[1];
  const s = str.toLowerCase().trim();
  for (const k in IATA) if (s.includes(k)) return IATA[k];
  return null;
}

// ── FETCH AVEC TIMEOUT ────────────────────────────────────────────────────────
async function fetchT(url, opts, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms || 8000);
  try { const r = await fetch(url, { ...opts, signal: ctrl.signal }); clearTimeout(timer); return r; }
  catch (e) { clearTimeout(timer); throw e; }
}

// ── SUPABASE ──────────────────────────────────────────────────────────────────
async function sb(path, method, body) {
  const h = { "Content-Type": "application/json", "apikey": SUPABASE_KEY, "Authorization": "Bearer " + SUPABASE_KEY };
  const opts = { method: method || "GET", headers: h };
  if (body) opts.body = JSON.stringify(body);
  try { const r = await fetchT(SUPABASE_URL + "/rest/v1/" + path, opts, 6000); return await r.json(); } catch (e) { return null; }
}

// ── MÉTÉO (API gratuite Open-Meteo, sans clé — coût zéro) ────────────────────
// Priorité 1 : prévision réelle (disponible ~16 jours avant la date).
// Priorité 2 : si la date est trop lointaine, on interroge les données
// ARCHIVÉES (réelles) de l'année précédente à la même période — c'est une
// vraie mesure historique, pas une estimation IA, et ça reste gratuit.
async function getWeather(cityName, dateStr) {
  if (!cityName) return null;
  try {
    const geoR = await fetchT("https://geocoding-api.open-meteo.com/v1/search?name=" + encodeURIComponent(cityName) + "&count=1&language=fr", {}, 5000);
    const geo = await geoR.json();
    const loc = geo && geo.results && geo.results[0];
    if (!loc) return null;

    const fR = await fetchT("https://api.open-meteo.com/v1/forecast?latitude=" + loc.latitude + "&longitude=" + loc.longitude
      + "&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weathercode&timezone=auto", {}, 5000);
    const f = await fR.json();
    if (f && f.daily && dateStr) {
      const i = f.daily.time.indexOf(dateStr);
      if (i !== -1) {
        const code = f.daily.weathercode[i];
        return { tempMax: Math.round(f.daily.temperature_2m_max[i]), tempMin: Math.round(f.daily.temperature_2m_min[i]), rainPct: f.daily.precipitation_probability_max[i], icon: weatherIcon(code), historical: false };
      }
    }

    // Repli : donnée réelle archivée de l'année dernière à la même date
    if (dateStr) {
      const lastYear = String(parseInt(dateStr.slice(0, 4)) - 1) + dateStr.slice(4);
      const aR = await fetchT("https://archive-api.open-meteo.com/v1/archive?latitude=" + loc.latitude + "&longitude=" + loc.longitude
        + "&start_date=" + lastYear + "&end_date=" + lastYear + "&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weathercode&timezone=auto", {}, 5000);
      const a = await aR.json();
      if (a && a.daily && a.daily.time && a.daily.time.length) {
        const code = a.daily.weathercode[0];
        return { tempMax: Math.round(a.daily.temperature_2m_max[0]), tempMin: Math.round(a.daily.temperature_2m_min[0]), rainPct: (a.daily.precipitation_sum[0] > 1 ? 60 : 10), icon: weatherIcon(code), historical: true };
      }
    }
    return null;
  } catch (e) { return null; }
}
function weatherIcon(code) {
  if (code === 0) return "☀️"; if (code <= 2) return "🌤️"; if (code === 3) return "☁️";
  if (code >= 51 && code <= 67) return "🌧️"; if (code >= 71 && code <= 77) return "❄️";
  if (code >= 80 && code <= 82) return "🌦️"; if (code >= 95) return "⛈️"; return "🌡️";
}

// ── LIENS VOYAGE (garde-fous code) ────────────────────────────────────────────
function skyLink(from, to, ci, co, adults) {
  const f = (toIATA(from) || "par").toLowerCase(), t = (toIATA(to) || "xxx").toLowerCase();
  const fmt = d => d ? d.replace(/-/g, "").slice(2) : null;
  const out = fmt(ci), ret = fmt(co);
  const base = "https://www.skyscanner.fr/transport/vols/" + f + "/" + t + "/";
  if (out && ret) return base + out + "/" + ret + "/?adults=" + (adults || 2) + "&currency=EUR";
  if (out) return base + out + "/?adults=" + (adults || 2) + "&currency=EUR";
  return base;
}
function bookLink(dest, ci, co, adults, cat) {
  const rooms = Math.ceil((adults || 2) / 2);
  let url = "https://www.booking.com/searchresults.html?ss=" + encodeURIComponent(dest || "") + "&group_adults=" + (adults || 2) + "&no_rooms=" + rooms + "&lang=fr&selected_currency=EUR";
  if (ci) url += "&checkin=" + ci;
  if (co) url += "&checkout=" + co;
  if (cat === "budget") url += "&nflt=class%3D2%3Bclass%3D3";
  if (cat === "confort") url += "&nflt=class%3D3%3Bclass%3D4";
  if (cat === "luxe") url += "&nflt=class%3D4%3Bclass%3D5";
  return url;
}
function bookHotelLink(hotelName, dest, ci, co, adults) {
  const q = (hotelName || "") + " " + (dest || "");
  let url = "https://www.booking.com/searchresults.html?ss=" + encodeURIComponent(q.trim()) + "&group_adults=" + (adults || 2) + "&no_rooms=" + Math.ceil((adults || 2) / 2) + "&lang=fr&selected_currency=EUR";
  if (ci) url += "&checkin=" + ci;
  if (co) url += "&checkout=" + co;
  return url;
}
function expLink(dest, ci, co, adults) {
  let url = "https://www.expedia.fr/Hotel-Search?destination=" + encodeURIComponent(dest || "") + "&adults=" + (adults || 2);
  if (ci) url += "&startDate=" + ci;
  if (co) url += "&endDate=" + co;
  return url;
}
function getTransferLink(dest, ci) { return "https://gettransfer.tpk.mx/vMnVrFfO" + (dest ? "?to=" + encodeURIComponent(dest) + (ci ? "&date=" + ci : "") : ""); }
function eurocarLink(dest, ci, co) {
  const destUrl = "https://www.europcar.fr/fr/search?pickUpLocation=" + encodeURIComponent(dest || "") + (ci ? "&pickUpDate=" + ci : "") + (co ? "&dropOffDate=" + co : "");
  return "https://www.awin1.com/cread.php?awinmid=7418&awinaffid=" + AWIN_PUB + "&ued=" + encodeURIComponent(destUrl);
}
function wantsCar(dest) {
  const noNeed = ["paris","londres","rome","barcelone","madrid","amsterdam","berlin","tokyo","new york","singapour"];
  const d = (dest || "").toLowerCase();
  return !noNeed.some(c => d.includes(c));
}
function klookLink() { return "https://klook.tpk.mx/uGeFNRZq"; }

function parseDate(str) {
  if (!str) return null;
  str = String(str); // garde-fou : l'IA renvoie parfois un type inattendu (nombre, etc.)
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  const now = new Date(); const s = str.toLowerCase().trim();
  if (s === "demain") { const d = new Date(now.getTime() + 86400000); return d.toISOString().slice(0, 10); }
  if (/apres.?demain/.test(s)) { const d2 = new Date(now.getTime() + 172800000); return d2.toISOString().slice(0, 10); }
  const slash = str.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (slash) { const y = slash[3].length === 2 ? "20" + slash[3] : slash[3]; return y + "-" + slash[2].padStart(2, "0") + "-" + slash[1].padStart(2, "0"); }
  const MO = { jan:1,janv:1,fev:2,mars:3,avr:4,avril:4,mai:5,juin:6,juil:7,juillet:7,aout:8,sep:9,sept:9,oct:10,nov:11,dec:12 };
  const fm = s.match(/(\d{1,2})\s+([a-z]+)(?:\s+(\d{4}))?/);
  if (fm) { let mo = null; for (const mk in MO) if (fm[2].startsWith(mk)) { mo = MO[mk]; break; }
    if (mo) { const yr = fm[3] || String(now.getFullYear()); return yr + "-" + String(mo).padStart(2, "0") + "-" + fm[1].padStart(2, "0"); } }
  return null;
}

function usableItin(itin) {
  if (!itin || !itin.dest) return false;
  return !!(itin.hotels && itin.hotels.length && itin.hotels.some(h => h.name && h.name.split(/\s+/).length >= 2));
}

function buildHist(history) {
  return ((history || []).map(m => {
    const who = m.role === "user" ? "Client" : "Huntify";
    const txt = (m.content || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 300);
    return txt ? who + ": " + txt : null;
  }).filter(Boolean).join("\n")).slice(0, 2000);
}
function countQ(history) { return (history || []).filter(m => m.role !== "user" && (m.content || "").length > 10 && (m.content || "").length < 300).length; }

function parseJSON(raw) {
  if (!raw) return {};
  try { const m = raw.match(/```(?:json)?\s*([\s\S]*?)```/); if (m) return JSON.parse(m[1].trim()); } catch (e) {}
  try { const m = raw.match(/\{[\s\S]*\}/); if (m) return JSON.parse(m[0]); } catch (e) {}
  return {};
}

// ── MODÈLES IA — cascade gratuite d'abord, Claude en dernier recours ─────────
async function groq(sys, user, maxTok) {
  const key = process.env.GROQ_API_KEY; if (!key) return null;
  try {
    const r = await fetchT("https://api.groq.com/openai/v1/chat/completions", { method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + key },
      body: JSON.stringify({ model: "llama-3.3-70b-versatile", max_tokens: maxTok || 500, messages: [{ role: "system", content: sys }, { role: "user", content: user }] }) }, 7000);
    if (!r.ok) return null; const d = await r.json(); return d.choices && d.choices[0] ? d.choices[0].message.content : null;
  } catch (e) { return null; }
}
async function groqSearch(prompt, maxTok) {
  const key = process.env.GROQ_API_KEY; if (!key) return null;
  try {
    const r = await fetchT("https://api.groq.com/openai/v1/chat/completions", { method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + key },
      body: JSON.stringify({ model: "compound-beta", max_tokens: maxTok || 1500, messages: [{ role: "user", content: prompt }] }) }, 12000);
    if (!r.ok) return null; const d = await r.json(); return d.choices && d.choices[0] ? d.choices[0].message.content : null;
  } catch (e) { return null; }
}
async function gemini(prompt, maxTok) {
  const key = process.env.GEMINI_API_KEY; if (!key) return null;
  try {
    const r = await fetchT("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=" + key, { method: "POST",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: maxTok || 1500 } }) }, 10000);
    if (!r.ok) return null; const d = await r.json(); return d.candidates && d.candidates[0] && d.candidates[0].content ? d.candidates[0].content.parts[0].text : null;
  } catch (e) { return null; }
}
async function mistral(sys, user, maxTok) {
  const key = process.env.MISTRAL_API_KEY; if (!key) return null;
  try {
    const r = await fetchT("https://api.mistral.ai/v1/chat/completions", { method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + key },
      body: JSON.stringify({ model: "mistral-small-latest", max_tokens: maxTok || 500, messages: [{ role: "system", content: sys }, { role: "user", content: user }] }) }, 7000);
    if (!r.ok) return null; const d = await r.json(); return d.choices && d.choices[0] ? d.choices[0].message.content : null;
  } catch (e) { return null; }
}
async function freeAI(sys, user, maxTok) { return await groq(sys, user, maxTok) || await gemini(sys + "\n\n" + user, maxTok) || await mistral(sys, user, maxTok); }

// Claude — DERNIER RECOURS uniquement, tokens plafonnés en dur
async function claude(sys, user, maxTok, tools) {
  const key = process.env.ANTHROPIC_API_KEY; if (!key) return null;
  try {
    const payload = { model: CLAUDE_MODEL, max_tokens: Math.min(maxTok || 1500, CLAUDE_HARD_CAP), system: sys, messages: [{ role: "user", content: user }] };
    if (tools && tools.length) payload.tools = tools;
    const r = await fetchT("https://api.anthropic.com/v1/messages", { method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8", "x-api-key": key, "anthropic-version": "2023-06-01" }, body: JSON.stringify(payload) }, 18000);
    if (!r.ok) return null; const d = await r.json();
    let t = ""; for (const b of (d.content || [])) if (b.type === "text") t += b.text; return t || null;
  } catch (e) { return null; }
}

// ── HTML VOYAGE ───────────────────────────────────────────────────────────────
function cardWeather(w, label) {
  if (!w) return "";
  const lbl = w.historical ? label.replace("Météo", "Climat (année dernière, même période)") : label;
  return '<div style="display:flex;align-items:center;gap:8px;background:#eff6ff;border-radius:10px;padding:8px 12px;margin-top:6px">'
    + '<span style="font-size:20px">' + w.icon + '</span>'
    + '<div style="font-size:11.5px;color:#1e40af;font-weight:600">' + lbl + ' : ' + w.tempMin + '° / ' + w.tempMax + '°C' + (w.rainPct != null ? ' · ' + w.rainPct + '% pluie' : '') + '</div></div>';
}
function cardHotel(h, link) {
  const stars = "⭐".repeat(Math.min(h.stars || 3, 5));
  const colors = { budget: "#16a34a", confort: "#2f54ff", luxe: "#7c3aed" };
  const labels = { budget: "💚 Budget", confort: "💙 Confort", luxe: "💎 Luxe" };
  const cc = colors[h.cat] || "#2f54ff"; const cl = labels[h.cat] || "";
  return '<a href="' + link + '" target="_blank" rel="sponsored noopener" style="display:flex;flex-direction:column;background:#fff;border:1.5px solid #e6ebf7;border-radius:14px;padding:13px;margin-top:8px;text-decoration:none;gap:5px">'
    + '<div style="display:flex;justify-content:space-between;align-items:flex-start">'
    + '<div style="flex:1">' + (cl ? '<span style="background:#eff6ff;color:' + cc + ';border-radius:100px;padding:2px 9px;font-size:10px;font-weight:800">' + cl + '</span>' : '')
    + '<div style="font-size:13px;font-weight:800;color:#0e1430;margin-top:3px">' + h.name + '</div>'
    + '<div style="font-size:11px;color:#7c89a8">' + stars + ' · ' + (h.loc || '') + '</div></div>'
    + '<div style="background:linear-gradient(135deg,' + cc + ',' + cc + 'cc);color:#fff;border-radius:10px;padding:7px 11px;text-align:right;flex-shrink:0;margin-left:8px">'
    + '<div style="font-size:15px;font-weight:900">' + (h.price || '?') + 'EUR</div><div style="font-size:9px;opacity:.8">/nuit</div></div></div>'
    + (h.hl ? '<div style="font-size:11px;color:' + cc + ';font-weight:600;background:#eff6ff;border-radius:8px;padding:4px 10px">✨ ' + h.hl + '</div>' : '')
    + '<div style="font-size:10.5px;color:#94a3b8;font-weight:600">🏨 Voir cet hotel sur Booking.com →</div></a>';
}
function cardDay(d) {
  return '<div style="background:#fff;border:1.5px solid #e6ebf7;border-radius:14px;padding:14px;margin-top:9px">'
    + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">'
    + '<div style="background:linear-gradient(135deg,#2f54ff,#4a6bff);color:#fff;border-radius:8px;padding:4px 12px;font-size:12px;font-weight:800">Jour ' + d.n + '</div>'
    + '<div style="font-size:12px;font-weight:700;color:#0e1430;flex:1;margin-left:8px">' + (d.title || '') + '</div>'
    + (d.budget ? '<div style="font-size:11px;color:#16a34a;font-weight:700">~' + d.budget + '</div>' : '') + '</div>'
    + (d.weather ? cardWeather(d.weather, "Météo") : '')
    + (d.am ? '<div style="display:flex;gap:9px;margin-top:8px;margin-bottom:8px"><span>🌅</span><div><div style="font-size:10px;font-weight:800;color:#94a3b8;text-transform:uppercase">Matin</div><div style="font-size:12px;color:#374151">' + d.am + '</div></div></div>' : '')
    + (d.pm ? '<div style="display:flex;gap:9px;margin-bottom:8px"><span>☀️</span><div><div style="font-size:10px;font-weight:800;color:#94a3b8;text-transform:uppercase">Apres-midi</div><div style="font-size:12px;color:#374151">' + d.pm + '</div></div></div>' : '')
    + (d.eve ? '<div style="display:flex;gap:9px;margin-bottom:4px"><span>🌙</span><div><div style="font-size:10px;font-weight:800;color:#94a3b8;text-transform:uppercase">Soiree</div><div style="font-size:12px;color:#374151">' + d.eve + '</div></div></div>' : '')
    + (d.resto ? '<div style="background:#f0fdf4;border-radius:9px;padding:7px 11px;margin-top:6px;display:flex;justify-content:space-between;align-items:center"><div><div style="font-size:11px;color:#16a34a;font-weight:700">🍽 ' + d.resto.name + '</div>' + (d.resto.spec ? '<div style="font-size:10px;color:#86efac">' + d.resto.spec + '</div>' : '') + '</div><div style="font-size:12px;color:#16a34a;font-weight:800">' + (d.resto.price || '') + '</div></div>' : '')
    + (d.acts && d.acts.length ? '<div style="margin-top:7px;display:flex;flex-wrap:wrap;gap:4px">' + d.acts.map(a => '<span style="background:#eff6ff;color:#2f54ff;border-radius:100px;padding:2px 9px;font-size:10.5px;font-weight:600">' + a + '</span>').join('') + '</div>' : '')
    + '</div>';
}
function cardBudget(b) {
  const rows = [["✈️ Vols A/R", b.vols], ["🏨 Hebergement", b.hotel], ["🎯 Activites", b.acts], ["🍽 Restaurants", b.resto], ["🚇 Transport local", b.transport]].filter(r => r[1] != null);
  return '<div style="background:linear-gradient(135deg,#0e1430,#1f2da0);border-radius:16px;padding:16px;margin-top:12px">'
    + '<div style="font-size:13px;font-weight:800;color:#fff;margin-bottom:12px">💰 Budget estime</div>'
    + rows.map(r => '<div style="display:flex;justify-content:space-between;margin-bottom:7px"><span style="font-size:12px;color:rgba(255,255,255,.75)">' + r[0] + '</span><span style="font-size:12px;font-weight:700;color:#fff">~' + r[1] + '</span></div>').join('')
    + '<div style="border-top:1px solid rgba(255,255,255,.2);margin-top:10px;padding-top:10px;display:flex;justify-content:space-between">'
    + '<span style="font-size:13px;font-weight:800;color:#fff">TOTAL</span><span style="font-size:16px;font-weight:900;color:#bcd0ff">~' + (b.total || '') + '</span></div>'
    + (b.pp ? '<div style="font-size:11px;color:rgba(255,255,255,.6);text-align:right;margin-top:3px">soit ~' + b.pp + '/personne</div>' : '') + '</div>';
}
function cardTips(tips) {
  if (!tips || !tips.length) return "";
  return '<div style="background:#f5f3ff;border:1.5px solid #ddd6fe;border-radius:14px;padding:14px;margin-top:10px">'
    + '<div style="font-size:12px;font-weight:800;color:#5b21b6;margin-bottom:8px">💡 Conseils pratiques</div>'
    + tips.map(t => '<div style="font-size:12px;color:#374151;margin-bottom:5px;padding-left:8px;border-left:2px solid #c4b5fd">• ' + t + '</div>').join('') + '</div>';
}
function cardLocalTransport(t) {
  if (!t) return "";
  return '<div style="background:#fffbeb;border:1.5px solid #fde68a;border-radius:14px;padding:12px 14px;margin-top:10px">'
    + '<div style="font-size:12px;font-weight:800;color:#92400e;margin-bottom:6px">🚇 Se déplacer sur place</div>'
    + '<div style="font-size:12px;color:#78350f;line-height:1.5">' + (t.desc || '') + (t.price ? ' <b>· ~' + t.price + '</b>' : '') + '</div></div>';
}

// ── HANDLER ───────────────────────────────────────────────────────────────────
export default async function handler(req) {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST,OPTIONS", "Access-Control-Allow-Headers": "Content-Type" } });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const H = { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" };

  try {
    const body = await req.json();
    const message = body.message || "";
    const history = body.history || [];
    const sid = body.sessionId || ("anon_" + Date.now());
    const today = new Date().toISOString().slice(0, 10);
    const hist = buildHist(history);
    const qAsked = countQ(history);

    if (body.trackingEnabled) sb("searches", "POST", { query: "[VOYAGE] " + message, session_id: sid, user_id: body.userId || null });

    // ── ÉTAPE 1 : DÉCISION multi-turn (IA gratuite) ───────────────────────────
    const decidePrompt = 'Tu es Huntify, un AGENT DE VOYAGE EXPERT — pas un formulaire administratif, et pas un\n'
      + 'robot qui coche des cases. Tu as des annees d experience a organiser des voyages sur mesure.\n'
      + 'Aujourd hui: ' + today + '\n\n'
      + 'CONVERSATION COMPLETE:\n' + hist + '\n'
      + 'MESSAGE: ' + message + '\n\n'
      + 'MISSION: comprends ce que la personne veut, comme le ferait un vrai conseiller voyage.\n'
      + 'Extrais TOUTES les infos disponibles sur toute la conversation (pas seulement le dernier message):\n'
      + 'destination, ville_depart, checkin (YYYY-MM-DD), checkout (YYYY-MM-DD), duree, nb_adultes, budget, style.\n'
      + 'Tolere les fautes de frappe. Si la personne a deja repondu a une question precedente, sa reponse\n'
      + 'EST la reponse — ne la redemande JAMAIS, et ne redemande jamais deux fois la meme chose.\n\n'
      + 'C EST TOI QUI DECIDES, EN EXPERT, QUAND TU AS ASSEZ D INFOS. Aucune regle fixe ne te dit combien\n'
      + 'de questions poser — utilise ton jugement professionnel, exactement comme le ferait un excellent\n'
      + 'conseiller voyage humain face a un client:\n'
      + '- Une destination et un point de depart sont TOUJOURS necessaires pour proposer quoi que ce soit\n'
      + '  de concret (vols, hotels) — si l un des deux manque, pose la question, c est non-negociable.\n'
      + '- Les dates/duree influencent fortement les prix et la meteo — un expert les demande presque\n'
      + '  toujours si elles ne sont pas donnees.\n'
      + '- Le budget et le style de voyage (detente/culture/aventure/famille/romantique) determinent quels\n'
      + '  hotels et activites proposer — un bon conseiller les demande si rien ne les laisse deviner,\n'
      + '  sauf si le client a deja donne assez d indices (ex: "voyage en amoureux" = style romantique,\n'
      + '  "avec les enfants" = famille).\n'
      + '- Une fois que tu as reellement de quoi construire un itineraire PERTINENT et PERSONNALISE (pas\n'
      + '  generique), genere. Ne pose plus de questions juste pour "faire complet" — un expert sait\n'
      + '  s arreter au bon moment, ni trop tot (itineraire generique), ni trop tard (interrogatoire).\n'
      + '- Pose UNE SEULE question a la fois, jamais une liste de questions.\n\n'
      + 'JSON:\n'
      + 'question: {"action":"question","msg":"question courte, naturelle et chaleureuse"}\n'
      + 'generation: {"action":"generate","infos":{"destination":..,"ville_depart":..,"nb_adultes":..,"checkin":..,"checkout":..,"duree":..,"budget":..,"style":..}}';

    let step1raw = await groqSearch(decidePrompt, 700);
    if (!step1raw) step1raw = await freeAI('Tu es un agent voyage. Reponds en JSON strict.', decidePrompt, 700);
    const step1 = parseJSON(step1raw || "{}");

    // Le code n'impose AUCUN nombre cible de questions — c'est l'IA, experte
    // voyage, qui décide seule quand elle a assez d'infos. SAFETY_CEILING
    // n'intervient qu'en tout dernier recours pour empêcher une boucle
    // infinie en cas de comportement anormal du modèle (garde-fou technique,
    // pas une consigne produit).
    if (step1.action === "question" && step1.msg && qAsked < SAFETY_CEILING) {
      return new Response(JSON.stringify({ reply: '<div style="font-size:13.5px;color:#1e293b;line-height:1.6;padding:4px 0">' + step1.msg + '</div>', sessionId: sid }), { headers: H });
    }

    // ── ÉTAPE 2 : GÉNÉRATION (Groq compound-beta, gratuit, recherche web) ────
    const infos = step1.infos || {};
    const adults = parseInt(infos.nb_adultes) || 2;
    let ci = parseDate(infos.checkin || null);
    const dureeStr = String(infos.duree || "3 jours"); // garde-fou : l'IA peut renvoyer un nombre brut
    const nights = parseInt((dureeStr.match(/\d+/) || ["3"])[0]) || 3;
    let co = parseDate(infos.checkout || null);
    if (!co && ci) { const dco = new Date(ci); dco.setDate(dco.getDate() + nights); co = dco.toISOString().slice(0, 10); }
    if (!infos.destination) infos.destination = "Barcelone";
    if (!infos.ville_depart) infos.ville_depart = "Paris";

    const genPrompt = 'Expert voyage Huntify. Recherche sur le web et genere un itineraire COMPLET en JSON.\n'
      + 'Date: ' + today + '\n'
      + 'Infos: destination=' + infos.destination + ', depart=' + infos.ville_depart + ', adultes=' + adults
      + ', checkin=' + (ci || '?') + ' checkout=' + (co || '?') + ' (' + nights + ' nuits)'
      + ', budget=' + (infos.budget || 'moyen') + ', style=' + (infos.style || 'equilibre') + '\n\n'
      + 'RECHERCHE les vrais hotels existants et prix realistes pour cette destination et ces dates.\n'
      + 'N INVENTE JAMAIS un nom d hotel: uniquement des etablissements reels connus a ' + infos.destination + '.\n'
      + 'Inclus aussi le TRANSPORT LOCAL typique (metro/bus/tram) avec un ordre de prix realiste.\n'
      + 'JSON avec TOUS ces champs:\n'
      + '{"t":"i","recap":"...","itin":{\n'
      + '  "dest":"...","country":"...","flag":"emoji","dur":"...","trav":"...","style":"...","dep":"...",\n'
      + '  "checkin":"YYYY-MM-DD","checkout":"YYYY-MM-DD","adults":' + adults + ',\n'
      + '  "flights":{"out":{"from":"IATA","to":"IATA","price":0,"co":"...","dur":"..."},"ret":{...}},\n'
      + '  "hotels":[3 VRAIS hotels existants: {"name":"...","stars":0,"price":0,"loc":"...","hl":"...","cat":"budget|confort|luxe"}],\n'
      + '  "localTransport":{"desc":"ex: Metro + bus, pass journalier disponible","price":"~8EUR/jour"},\n'
      + '  "days":[{"n":1,"title":"...","am":"...","pm":"...","eve":"...","resto":{"name":"...","price":"...","spec":"..."},"acts":[],"budget":"..."}],\n'
      + '  "budget":{"vols":"...","hotel":"...","acts":"...","resto":"...","transport":"...","total":"...","pp":"..."},\n'
      + '  "tips":["...","...","...","..."]}}\n'
      + 'IATA utiles: Paris=CDG,Marseille=MRS,Nice=NCE,Lyon=LYS,Rome=FCO,Barcelone=BCN,Madrid=MAD,Lisbonne=LIS,Londres=LHR.\n'
      + 'JSON UNIQUEMENT, aucun texte autour.';

    // Filet de sécurité : si la génération plante pour une raison imprévue
    // (type inattendu renvoyé par une IA, champ manquant, etc.), on dégrade
    // vers les liens directs plutôt que le message froid "problème momentané".
    let itin = null, tP = {};
    try {
      let itinRaw = await groqSearch(genPrompt, 2500);
      tP = parseJSON(itinRaw || "");
      itin = tP.itin;

      if (!usableItin(itin)) {
        const fbRaw = await gemini(genPrompt, 2500) || await freeAI('Reponds en JSON strict.', genPrompt, 2000);
        const fbP = parseJSON(fbRaw || "");
        if (usableItin(fbP.itin)) { itin = fbP.itin; tP = fbP; }
      }

      // ── ÉTAPE 3 : CLAUDE — dernier recours ──────────────────────────────────
      if (!usableItin(itin)) {
        const claudeRaw = await claude(
          'Expert voyage. Utilise web_search pour verifier de vrais hotels existants et prix realistes.\n'
          + 'N invente jamais un nom d hotel.', genPrompt, 1800, [{ type: "web_search_20250305", name: "web_search", max_uses: 2 }]);
        const cP = parseJSON(claudeRaw || "");
        if (usableItin(cP.itin)) { itin = cP.itin; tP = cP; }
      }
    } catch (genErr) {
      console.error("Huntify travel — erreur pendant la génération:", genErr && genErr.message);
      itin = null;
    }

    if (!itin) {
      const skyF = skyLink(infos.ville_depart || "", infos.destination || "", ci, co, adults);
      const bkgF = bookLink(infos.destination || "", ci, co, adults, null);
      const gtfF = getTransferLink(infos.destination || "", ci);
      return new Response(JSON.stringify({
        reply: '<div style="font-size:13.5px;color:#1e293b;margin-bottom:12px">Voici les liens directs pour votre voyage a ' + (infos.destination || "") + ' :</div>'
          + '<a href="' + skyF + '" target="_blank" style="display:flex;justify-content:center;background:linear-gradient(135deg,#0e1430,#1f2da0);color:#fff;text-decoration:none;border-radius:12px;padding:14px;margin-top:8px;font-size:13px;font-weight:700">✈️ Vols sur Skyscanner →</a>'
          + '<a href="' + bkgF + '" target="_blank" style="display:flex;justify-content:center;background:linear-gradient(135deg,#003580,#0071c2);color:#fff;text-decoration:none;border-radius:12px;padding:14px;margin-top:8px;font-size:13px;font-weight:700">🏨 Hotels sur Booking.com →</a>'
          + '<a href="' + gtfF + '" target="_blank" style="display:flex;justify-content:center;background:linear-gradient(135deg,#1a1a2e,#e94560);color:#fff;text-decoration:none;border-radius:12px;padding:14px;margin-top:8px;font-size:13px;font-weight:700">🚗 Transfert GetTransfer →</a>',
        sessionId: sid }), { headers: H });
    }

    try { // filet de sécurité pour tout le rendu — dégrade vers liens directs si un champ inattendu casse l'affichage
    const finalCi = (/^\d{4}-\d{2}-\d{2}$/.test(itin.checkin || "")) ? itin.checkin : (ci || "");
    const finalCo = (/^\d{4}-\d{2}-\d{2}$/.test(itin.checkout || "")) ? itin.checkout : (co || "");
    const finalAdults = itin.adults || adults;
    const arrivalWeather = await getWeather(itin.dest, finalCi);

    const itinId = "itin_" + Date.now();
    let html = "";

    html += '<div id="' + itinId + '" style="background:linear-gradient(135deg,#1f2da0,#2f54ff);border-radius:16px;padding:18px;margin-bottom:4px;text-align:center">'
      + '<div style="font-size:32px;margin-bottom:6px">' + (itin.flag || "✈️") + '</div>'
      + '<div style="font-size:20px;font-weight:800;color:#fff">' + (itin.dest || "") + (itin.country ? ", " + itin.country : "") + '</div>'
      + '<div style="font-size:12px;color:rgba(255,255,255,.75);margin-top:6px;display:flex;justify-content:center;gap:12px;flex-wrap:wrap">'
      + '<span>📅 ' + (itin.dur || nights + " jours") + '</span><span>👥 ' + (itin.trav || finalAdults + " pers.") + '</span>'
      + (itin.dep ? '<span>🛫 Depuis ' + itin.dep + '</span>' : '') + (itin.budget && itin.budget.total ? '<span>💰 ~' + itin.budget.total + '</span>' : '') + '</div></div>';

    if (arrivalWeather) html += cardWeather(arrivalWeather, "Météo à l'arrivée");
    if (tP.recap) html += '<div style="background:#f5f3ff;border:1.5px solid #ddd6fe;border-radius:12px;padding:10px 14px;margin-top:8px;font-size:12px;color:#5b21b6;font-weight:600">🔎 ' + tP.recap + '</div>';

    if (itin.flights && itin.flights.out) {
      const f = itin.flights;
      const skyU = skyLink(f.out.from || itin.dep || infos.ville_depart || "", f.out.to || itin.dest || "", finalCi, finalCo, finalAdults);
      html += '<div style="font-size:12px;font-weight:800;color:#0e1430;margin:14px 0 6px">✈️ Vols recommandes</div>'
        + '<div style="background:#fff;border:1.5px solid #e6ebf7;border-radius:14px;overflow:hidden">'
        + '<div style="padding:12px 14px;border-bottom:1px solid #f0f4ff"><div style="display:flex;justify-content:space-between;align-items:center">'
        + '<div><div style="font-size:10px;font-weight:800;color:#7c89a8;text-transform:uppercase">Aller' + (finalCi ? " · " + finalCi : "") + '</div>'
        + '<div style="font-size:13px;font-weight:700;color:#0e1430;margin-top:2px">' + (f.out.from || "") + ' → ' + (f.out.to || "") + '</div>'
        + '<div style="font-size:11px;color:#7c89a8">' + (f.out.co || "") + ' · ' + (f.out.dur || "") + '</div></div>'
        + '<div style="text-align:right"><div style="font-size:16px;font-weight:900;color:#2f54ff">~' + (f.out.price || "?") + 'EUR</div><div style="font-size:10px;color:#7c89a8">/pers.</div></div></div></div>'
        + (f.ret ? '<div style="padding:12px 14px"><div style="display:flex;justify-content:space-between;align-items:center">'
          + '<div><div style="font-size:10px;font-weight:800;color:#7c89a8;text-transform:uppercase">Retour' + (finalCo ? " · " + finalCo : "") + '</div>'
          + '<div style="font-size:13px;font-weight:700;color:#0e1430;margin-top:2px">' + (f.ret.from || "") + ' → ' + (f.ret.to || "") + '</div>'
          + '<div style="font-size:11px;color:#7c89a8">' + (f.ret.co || "") + ' · ' + (f.ret.dur || "") + '</div></div>'
          + '<div style="text-align:right"><div style="font-size:16px;font-weight:900;color:#2f54ff">~' + (f.ret.price || "?") + 'EUR</div><div style="font-size:10px;color:#7c89a8">/pers.</div></div></div></div>' : '')
        + '</div>'
        + '<a href="' + skyU + '" target="_blank" style="display:flex;align-items:center;justify-content:center;gap:8px;background:linear-gradient(135deg,#0e1430,#1f2da0);color:#fff;text-decoration:none;border-radius:12px;padding:12px;font-size:13px;font-weight:700;margin-top:6px">🔍 Comparer ces vols sur Skyscanner →</a>';
    }

    html += '<a href="' + klookLink() + '" target="_blank" style="display:flex;align-items:center;gap:10px;background:linear-gradient(135deg,#ff5722,#ff8a50);color:#fff;text-decoration:none;border-radius:14px;padding:12px 14px;margin-top:8px">'
      + '<span style="font-size:20px">🎫</span><div style="flex:1"><div style="font-size:12px;font-weight:800">Activites, tickets et transport local</div>'
      + '<div style="font-size:11px;opacity:.85">Klook · ' + (itin.dest || "") + '</div></div>'
      + '<span style="font-size:11px;font-weight:700;background:rgba(255,255,255,.2);border-radius:8px;padding:5px 10px">Voir tout →</span></a>';

    if (itin.hotels && itin.hotels.length) {
      html += '<div style="font-size:12px;font-weight:800;color:#0e1430;margin:16px 0 6px">🏨 Hebergements</div>';
      const cats = ["budget", "confort", "luxe"];
      for (let hi = 0; hi < itin.hotels.length; hi++) {
        const h = itin.hotels[hi];
        const hcat = cats[hi] || h.cat || "confort";
        const hlink = bookHotelLink(h.name, itin.dest || "", finalCi, finalCo, finalAdults);
        html += cardHotel({ name: h.name, stars: h.stars, price: h.price, loc: h.loc || itin.dest, hl: h.hl, cat: hcat }, hlink);
      }
      html += '<div style="display:flex;gap:8px;margin-top:8px">'
        + '<a href="' + bookLink(itin.dest || "", finalCi, finalCo, finalAdults, null) + '" target="_blank" style="flex:1;display:flex;justify-content:center;align-items:center;background:linear-gradient(135deg,#003580,#0071c2);color:#fff;text-decoration:none;border-radius:12px;padding:10px;font-size:11px;font-weight:700">🏨 Booking.com</a>'
        + '<a href="' + expLink(itin.dest || "", finalCi, finalCo, finalAdults) + '" target="_blank" style="flex:1;display:flex;justify-content:center;align-items:center;background:linear-gradient(135deg,#00355f,#00a0e3);color:#fff;text-decoration:none;border-radius:12px;padding:10px;font-size:11px;font-weight:700">✈️ Expedia.fr</a></div>';
    }

    if (finalCi) {
      html += '<a href="' + getTransferLink(itin.dest || "", finalCi) + '" target="_blank" style="display:flex;align-items:center;gap:10px;background:linear-gradient(135deg,#1a1a2e,#e94560);color:#fff;text-decoration:none;border-radius:14px;padding:12px 14px;margin-top:8px">'
        + '<span style="font-size:20px">🚐</span><div style="flex:1"><div style="font-size:12px;font-weight:800">Transfert aeroport</div>'
        + '<div style="font-size:11px;opacity:.75">GetTransfer · ' + (itin.dest || "") + '</div></div>'
        + '<span style="font-size:11px;font-weight:700;background:rgba(255,255,255,.15);border-radius:8px;padding:5px 10px">Voir prix →</span></a>';
    }

    if (itin.localTransport) html += cardLocalTransport(itin.localTransport);

    if (wantsCar(itin.dest)) {
      html += '<a href="' + eurocarLink(itin.dest || "", finalCi, finalCo) + '" target="_blank" style="display:flex;align-items:center;gap:10px;background:linear-gradient(135deg,#1a1a2e,#16213e);color:#fff;text-decoration:none;border-radius:14px;padding:12px 14px;margin-top:8px">'
        + '<span style="font-size:20px">🚗</span><div style="flex:1"><div style="font-size:12px;font-weight:800">Louer une voiture sur place</div>'
        + '<div style="font-size:11px;opacity:.75">Europcar · ' + (itin.dest || "") + '</div></div>'
        + '<span style="font-size:11px;font-weight:700;background:rgba(255,255,255,.15);border-radius:8px;padding:5px 10px">Voir prix →</span></a>';
    }

    if (itin.days && itin.days.length) {
      html += '<div style="font-size:12px;font-weight:800;color:#0e1430;margin:16px 0 6px">📅 Programme jour par jour</div>';
      for (let di = 0; di < itin.days.length; di++) html += cardDay(itin.days[di]);
    }

    if (itin.budget) html += cardBudget(itin.budget);
    if (itin.tips && itin.tips.length) html += cardTips(itin.tips);

    const wData = JSON.stringify({ type: "voyage", name: (itin.flag || "✈️") + " " + (itin.dest || ""), subtitle: (itin.dur || ""), store: "booking", url: bookLink(itin.dest || "", finalCi, finalCo, finalAdults, null) }).replace(/"/g, "&quot;");
    html += '<div style="display:flex;gap:8px;margin-top:12px">'
      + '<button onclick="addToWishlist(' + wData + ')" style="flex:1;background:linear-gradient(135deg,#1f2da0,#2f54ff);border:none;color:#fff;border-radius:12px;padding:12px;font-weight:700;font-size:13px;cursor:pointer;font-family:inherit">♡ Sauvegarder</button>'
      + '<button onclick="exportItinerary(\'' + itinId + '\')" style="background:#f5f7ff;border:1.5px solid #c7d2fe;color:#3b5bdb;border-radius:12px;padding:12px;font-weight:700;font-size:13px;cursor:pointer;font-family:inherit">⬇️ Exporter</button></div>';

    const contextOut = { destination: itin.dest || null, budget: (itin.budget && itin.budget.total) || infos.budget || null, dates: (finalCi && finalCo) ? (finalCi + " → " + finalCo) : null, travelers: finalAdults };

    return new Response(JSON.stringify({ reply: html, sessionId: sid, travelContext: contextOut }), { headers: H });
    } catch (renderErr) {
      // Le rendu a échoué malgré un itinéraire généré — repli sur liens directs,
      // toujours utile, plutôt que le message générique.
      console.error("Huntify travel — erreur de rendu:", renderErr && renderErr.message);
      const skyF = skyLink(infos.ville_depart || "", infos.destination || "", ci, co, adults);
      const bkgF = bookLink(infos.destination || "", ci, co, adults, null);
      const gtfF = getTransferLink(infos.destination || "", ci);
      return new Response(JSON.stringify({
        reply: '<div style="font-size:13.5px;color:#1e293b;margin-bottom:12px">Voici les liens directs pour votre voyage a ' + (infos.destination || "") + ' :</div>'
          + '<a href="' + skyF + '" target="_blank" style="display:flex;justify-content:center;background:linear-gradient(135deg,#0e1430,#1f2da0);color:#fff;text-decoration:none;border-radius:12px;padding:14px;margin-top:8px;font-size:13px;font-weight:700">✈️ Vols sur Skyscanner →</a>'
          + '<a href="' + bkgF + '" target="_blank" style="display:flex;justify-content:center;background:linear-gradient(135deg,#003580,#0071c2);color:#fff;text-decoration:none;border-radius:12px;padding:14px;margin-top:8px;font-size:13px;font-weight:700">🏨 Hotels sur Booking.com →</a>'
          + '<a href="' + gtfF + '" target="_blank" style="display:flex;justify-content:center;background:linear-gradient(135deg,#1a1a2e,#e94560);color:#fff;text-decoration:none;border-radius:12px;padding:14px;margin-top:8px;font-size:13px;font-weight:700">🚗 Transfert GetTransfer →</a>',
        sessionId: sid }), { headers: H });
    }

  } catch (err) {
    console.error("Huntify travel error:", err && err.message);
    return new Response(JSON.stringify({ reply: '<div style="font-size:13px;color:#1e293b">Desole, probleme momentane. Reessayez !</div>' }), { status: 200, headers: { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" } });
  }
}
