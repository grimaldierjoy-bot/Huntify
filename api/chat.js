export const config = { runtime: 'edge' };

// ─────────────────────────────────────────────────────────────────────────────
// HUNTIFY — Agent IA shopping + voyage v3
// IA autonome pour voyage + cascade intelligente pour produits
// ─────────────────────────────────────────────────────────────────────────────

const SUPABASE_URL = "https://enocxbrqyybendertytl.supabase.co";
const SUPABASE_KEY = "sb_publishable_NmPh--frZG5HuqfaoxnemA_E7cidV9Y";
const AMAZON_TAG   = "huntify21-21";
const AWIN_PUB     = "2920215";
const RAKUTEN_MID  = "55615";
const BOOKING_AID  = process.env.BOOKING_AID || "2311236";

const IATA = {
  paris:"CDG",lyon:"LYS",marseille:"MRS",nice:"NCE",bordeaux:"BOD",toulouse:"TLS",
  nantes:"NTE",strasbourg:"SXB",montpellier:"MPL",rennes:"RNS",lille:"LIL",
  rome:"FCO",milan:"MXP",venise:"VCE",naples:"NAP",florence:"FLR",
  barcelone:"BCN",madrid:"MAD",ibiza:"IBZ",majorque:"PMI",seville:"SVQ",malaga:"AGP",
  lisbonne:"LIS",porto:"OPO",faro:"FAO",
  londres:"LHR",manchester:"MAN",edimbourg:"EDI",
  amsterdam:"AMS",bruxelles:"BRU",zurich:"ZRH",geneve:"GVA",vienne:"VIE",
  berlin:"BER",munich:"MUC",francfort:"FRA",hambourg:"HAM",
  prague:"PRG",budapest:"BUD",varsovie:"WAW",cracovie:"KRK",
  athenes:"ATH",santorin:"JTR",mykonos:"JMK",crete:"HER",rhodes:"RHO",
  marrakech:"RAK",casablanca:"CMN",agadir:"AGA",tunis:"TUN",djerba:"DJE",
  istanbul:"IST",antalya:"AYT",hurghada:"HRG",
  dubai:"DXB","abu dhabi":"AUH",doha:"DOH",
  tokyo:"NRT",osaka:"KIX",bangkok:"BKK",singapour:"SIN",bali:"DPS",
  "kuala lumpur":"KUL","new york":"JFK","los angeles":"LAX",miami:"MIA",
  montreal:"YUL",cancun:"CUN",maldives:"MLE",maurice:"MRU",reunion:"RUN",
  phuket:"HKT",hongkong:"HKG",seoul:"ICN",pekin:"PEK",shanghai:"PVG",
  sydney:"SYD",melbourne:"MEL"
};

function toIATA(str) {
  if (!str) return null;
  const code = (str||"").match(/\b([A-Z]{3})\b/);
  if (code) return code[1];
  const s = str.toLowerCase().trim();
  for (const [k,v] of Object.entries(IATA)) { if (s.includes(k)) return v; }
  return null;
}

// SUPABASE
async function sbFetch(path, method, body) {
  method = method||"GET";
  const opts = { method, headers:{"Content-Type":"application/json","apikey":SUPABASE_KEY,"Authorization":"Bearer "+SUPABASE_KEY} };
  if (body) opts.body = JSON.stringify(body);
  try { const r = await fetch(SUPABASE_URL+"/rest/v1/"+path, opts); return await r.json(); } catch(e) { return null; }
}

async function getAdvertisers() {
  try {
    const r = await fetch(SUPABASE_URL+"/rest/v1/advertisers?active=eq.true", { headers:{"apikey":SUPABASE_KEY,"Authorization":"Bearer "+SUPABASE_KEY} });
    const d = await r.json();
    return Array.isArray(d)?d:[];
  } catch(e) { return []; }
}

// Liens affiliation
function cleanKw(kw) {
  if (!kw) return "";
  const stop = new Set(["la","le","les","un","une","des","avec","et","en","du","au","aux","pour","sur","de"]);
  return kw.replace(/,/g," ").replace(/\s+/g," ").trim().split(" ").filter(w => w.length>1 && !stop.has(w.toLowerCase())).slice(0,7).join(" ");
}

function buildLink(adv, keywords, directUrl) {
  if (!adv || !adv.active) return null;
  const kw = cleanKw(keywords);
  if (adv.slug==="amazon") {
    const tag = adv.amazon_tag || AMAZON_TAG;
    const asinMatch = directUrl && directUrl.match(/\/dp\/([A-Z0-9]{10})(?:[/?]|$)/);
    const isRealAsin = asinMatch && /^B[A-Z0-9]{9}$/.test(asinMatch[1]);
    const base = isRealAsin ? "https://www.amazon.fr/dp/"+asinMatch[1] : "https://www.amazon.fr/s?k="+encodeURIComponent(kw);
    return base + "?tag=" + tag;
  }
  if (adv.slug==="rakuten") {
    const mid = adv.awin_mid || RAKUTEN_MID;
    const aff = adv.awin_affid || adv.awin_aff || AWIN_PUB;
    const searchUrl = "https://fr.shopping.rakuten.com/s/"+encodeURIComponent(kw.replace(/\s+/g,"+"));
    return "https://www.awin1.com/cread.php?awinmid="+mid+"&awinaffid="+aff+"&clickref=huntify&ued="+encodeURIComponent(searchUrl);
  }
  if (adv.awin_mid) {
    const aff = adv.awin_affid || adv.awin_aff || AWIN_PUB;
    const dest = (adv.search_url || "https://www."+adv.slug+".fr/search?q={kw}").replace("{kw}",encodeURIComponent(kw));
    return "https://www.awin1.com/cread.php?awinmid="+adv.awin_mid+"&awinaffid="+aff+"&ued="+encodeURIComponent(dest);
  }
  return null;
}

function findAdv(advertisers, slug) {
  return (advertisers||[]).find(a => a.slug === (slug||"").toLowerCase()) || null;
}

// Travel Links
function bookingTPLink(dest, ci, co, adults, cat) {
  const rooms = Math.ceil((adults||2)/2);
  let url = "https://www.booking.com/searchresults.html?ss="+encodeURIComponent(dest||"")
    +"&group_adults="+(adults||2)+"&no_rooms="+rooms+"&lang=fr&selected_currency=EUR&aid="+BOOKING_AID;
  if (ci) url += "&checkin="+ci;
  if (co) url += "&checkout="+co;
  if (cat==="budget") url += "&nflt=class%3D2%3Bclass%3D3";
  if (cat==="confort") url += "&nflt=class%3D3%3Bclass%3D4";
  if (cat==="luxe") url += "&nflt=class%3D4%3Bclass%3D5";
  url += "&order=popularity";
  return url;
}

function expediaTPLink(dest, ci, co, adults) {
  const aid = process.env.EXPEDIA_AID||"";
  let url = "https://www.expedia.fr/Hotel-Search?destination="+encodeURIComponent(dest||"")+"&adults="+(adults||2)+"&sort=RECOMMENDED";
  if (ci) url += "&startDate="+ci;
  if (co) url += "&endDate="+co;
  if (aid) url += "&affcid="+aid;
  return url;
}

function skyscannerLink(from, to, ci, co, adults) {
  const f = (toIATA(from)||"par").toLowerCase();
  const t = (toIATA(to)||"xxx").toLowerCase();
  const fmt = d => d ? d.replace(/-/g,"").slice(2) : null;
  const out = fmt(ci), ret = fmt(co);
  const base = "https://www.skyscanner.fr/transport/vols/"+f+"/"+t+"/";
  if (out && ret) return base + out + "/" + ret + "/?adults=" + (adults||2) + "&currency=EUR";
  if (out) return base + out + "/?adults=" + (adults||2) + "&currency=EUR";
  return base;
}

function getTransferLink(dest, ci) {
  const base = "https://gettransfer.tpk.mx/vMnVrFfO";
  if (dest) return base + "?to=" + encodeURIComponent(dest) + (ci ? "&date="+ci : "");
  return base;
}

// Prix hôtels réels
async function fetchHotelPrices(dest, ci, co, adults) {
  const token = process.env.TRAVELPAYOUTS_TOKEN;
  if (!token || !ci || !co || !dest) return null;
  try {
    const url = "https://engine.hotellook.com/api/v2/cache.json?location="+encodeURIComponent(dest)+"&checkIn="+ci+"&checkOut="+co+"&adultsCount="+(adults||2)+"&currency=EUR&token="+token+"&limit=30";
    const r = await fetch(url, {headers:{"Accept":"application/json"}});
    if (!r.ok) return null;
    const data = await r.json();
    if (!Array.isArray(data) || data.length < 2) return null;
    const valid = data.filter(h => h.priceFrom && (h.hotelName||h.name) && h.id)
      .map(h => ({
        name: h.hotelName||h.name,
        stars: Math.round(h.stars||3),
        price: Math.round(h.priceFrom),
        loc: (h.location && h.location.name) || dest,
        url: bookingTPLink(h.hotelName||h.name, ci, co, adults, null)
      }))
      .sort((a,b) => a.price - b.price);
    if (valid.length < 2) return null;
    const t = Math.max(1, Math.floor(valid.length/3));
    const mid = arr => arr[Math.floor(arr.length/2)];
    return [
      Object.assign({}, mid(valid.slice(0,t)), {cat:"budget", hl:"Meilleur rapport qualité/prix"}),
      Object.assign({}, mid(valid.slice(t, t*2)), {cat:"confort", hl:"Confort et emplacement idéal"}),
      Object.assign({}, mid(valid.slice(-t)), {cat:"luxe", hl:"Expérience premium"})
    ];
  } catch(e) { return null; }
}

async function fetchHotelPricesDeepSeek(dest, ci, co, adults) {
  if (!dest || !ci || !co) return null;
  const sys = "Tu es un agent de recherche de prix d hotels. Reponds en JSON uniquement.";
  const user = `Trouve 3 vrais hotels a ${dest} disponibles du ${ci} au ${co} pour ${adults} adultes. Prix en EUR par nuit.\nJSON: {hotels:[{name:string, stars:number, price:number, loc:string, cat:'budget'|'confort'|'luxe'}]}\nUtilise tes connaissances sur les prix reels. JSON uniquement.`;
  try {
    const raw = await deepseek(sys, user, 600);
    const d = parseJSON(raw||"");
    if (!d.hotels || !d.hotels.length) return null;
    return d.hotels.slice(0,3).map((h,i) => ({
      name:h.name, stars:h.stars||3, price:h.price||null,
      loc:h.loc||dest, hl:["Meilleur rapport qualité/prix","Confort idéal","Expérience premium"][i],
      cat:h.cat||["budget","confort","luxe"][i]
    }));
  } catch(e){ return null; }
}

// Helpers
function parseDate(str) { /* identique à l'original - copie si besoin */ }
function formatHistory(history, maxLen) { /* identique */ }

// IA Cascade (coût optimisé)
async function groq(sys, user, maxTok) { /* identique */ }
async function groqSearch(prompt, maxTok) { /* identique */ }
async function gemini(prompt, maxTok) { /* identique */ }
async function mistral(sys, user, maxTok) { /* identique */ }
async function deepseek(sys, user, maxTok) { /* identique */ }
async function claude(sys, user, maxTok, tools) { /* identique */ }
function parseJSON(raw) { /* identique */ }
async function dbLookup(kw) { /* identique */ }

// Composants HTML (cardProduct, promoBox, cardHotel, cardDay, cardBudget, cardTips) → copie depuis ton fichier original

// HANDLER PRINCIPAL (version autonome)
export default async function handler(req) {
  // ... (OPTIONS + POST check identique)

  const H = {"Content-Type":"application/json; charset=utf-8","Access-Control-Allow-Origin":"*"};

  try {
    const body = await req.json();
    const message = body.message || "";
    const history = body.history || [];
    const sid = body.sessionId || ("anon_" + Date.now());
    const isTravel = body.mode === "travel";
    const advertisers = await getAdvertisers();

    const hist = formatHistory(history, 2500);
    const histS = formatHistory(history, 1200);

    if (isTravel) {
      const travelPrompt = `Tu es Huntify, conseiller voyage passionné et autonome.
Historique: ${hist}

Message: ${message}

Sois proactif. Si pas de destination claire → propose 3 destinations variées. Sinon génère un itinéraire complet.
Utilise recherche réelle. NE JAMAIS inventer prix ou hôtels.
Retourne UNIQUEMENT JSON :
{
  "type": "proposals" | "itinerary",
  "recap": "phrase courte enthousiaste",
  "proposals": [...],
  "itin": {dest, flights, hotels, days, budget, tips, ...}
}`;

      let raw = await groqSearch(travelPrompt, 4000);
      if (!raw) raw = await deepseek("Expert voyage autonome. JSON uniquement.", travelPrompt, 3500);
      if (!raw) raw = await claude("Expert voyage autonome. JSON uniquement.", travelPrompt, 3500);

      const data = parseJSON(raw || "{}");

      let html = "";

      if (data.type === "proposals" && data.proposals?.length) {
        // rendu propositions avec bouton Planifier
        html = '<div style="font-size:14px;font-weight:700;color:#0e1430;margin-bottom:12px">🌟 Mes propositions pour toi :</div>';
        for (const p of data.proposals.slice(0,3)) {
          const bkgP = bookingTPLink(p.dest, p.checkin, p.checkout, 2);
          html += `<div style="background:#fff;border:2px solid #e6ebf7;border-radius:16px;padding:16px;margin-bottom:12px">`
            + `<button data-huntify-plan="Planifie un itinéraire complet jour par jour pour ${p.dest}" onclick="handlePlanifyButton(this)" style="width:100%;padding:12px;background:#2f54ff;color:white;border:none;border-radius:12px;font-weight:700">📍 Planifier ${p.dest}</button>`
            + `</div>`;
        }
      } else {
        // Itinéraire complet avec hôtels réels
        const itin = data.itin || data;
        const ci = parseDate(itin.checkin);
        const co = parseDate(itin.checkout);
        const realHotels = await fetchHotelPrices(itin.dest, ci, co, 2);
        const hotelsShow = realHotels || await fetchHotelPricesDeepSeek(itin.dest, ci, co, 2) || itin.hotels || [];

        html = `<div style="background:linear-gradient(135deg,#1f2da0,#2f54ff);color:white;padding:20px;border-radius:16px;text-align:center">🌍 ${itin.dest || "Voyage"}</div>`;

        hotelsShow.forEach(h => {
          const link = h.url || bookingTPLink(h.name || itin.dest, ci, co, 2);
          html += cardHotel(h, link);
        });
      }

      return new Response(JSON.stringify({reply: html, sessionId: sid}), {headers: H});
    }

   // ══════════════════════════════════════════════════════════════════════════
    //  MODE PRODUIT
    // ══════════════════════════════════════════════════════════════════════════

    // L IA reflechit comme un vrai conseiller, pas comme un formulaire
    const prodSys = "Tu es le conseiller shopping de Huntify. Tu analyses ce que veut vraiment l utilisateur "
      +"en lisant tout le contexte, et tu agis immediatement sans poser de questions inutiles.\n"
      +"Si tu comprends le produit cherche (meme vaguement), tu generes direct : ready:true.\n"
      +"Un seul mot suffit : mascara, casque, lampe, iphone... tu cherches sans demander.\n"
      +"Tu ne demandes JAMAIS la couleur, la marque exacte, ou des details techniques.\n"
      +"Tu poses UNE question seulement si la demande est vraiment incomprehensible.\n"
      +"Si une question a deja ete posee dans l historique : ready:true obligatoirement.\n"
      +"Reponds en JSON : {ready:true, recap:'description concise du produit + budget si mentionne'} "
      +"ou {ready:false, msg:'question courte et naturelle'}";

    const prodUser = "Historique :\n"+histS+"\n\nMessage : "+message;

    const prodDecision = parseJSON(
      await groq(prodSys, prodUser, 300)
      || await gemini(prodSys+"\n\n"+prodUser, 300)
      || await mistral(prodSys, prodUser, 300)
      || "{}"
    );

    if (!prodDecision.ready && prodDecision.msg && history.length < 3) {
      return new Response(JSON.stringify({
        reply:'<div style="font-size:13.5px;color:#1e293b;line-height:1.6;padding:4px 0">'+prodDecision.msg+"</div>",
        sessionId:sid
      }),{headers:H});
    }

    const recap = (prodDecision.ready&&prodDecision.recap)
      ? prodDecision.recap
      : (formatHistory(history,300)+" "+message).trim();

    const dbCtx = await dbLookup(recap);
    const budgetNum = parseInt(((recap+" "+histS).match(/(\d+)\s*(?:EUR|euros?)/i)||[0,"0"])[1])||0;
    const isPremium = budgetNum>=100
      ||/cadeau|premium|luxe|meilleur|haute gamme|qualite/.test((recap+" "+histS).toLowerCase())
      ||history.length>=4;

    // ── RECHERCHE PRODUIT — Strategie intelligente low-cost ────────────────
    // 1. Groq DeepSearch cherche les produits (gratuit)
    // 2. On valide : ASIN reel ? Prix coherent ? Pas invente ?
    // 3. Claude web_search SEULEMENT si Groq echoue la validation
    //    = Claude appele ~20% du temps seulement, pas systematiquement

    // Contexte complet de la conversation pour que l IA comprenne l evolution de la demande
    const convContext = hist ? "Conversation precedente :\n"+hist+"\n\n" : "";

    const groqProdPrompt = convContext
      +"Demande actuelle : "+recap+"\n"
      +(dbCtx?"Donnees internes : "+dbCtx+"\n":"")
      +"Tu dois tenir compte de TOUS les criteres mentionnes dans la conversation.\n"
      +"Exemple : si l utilisateur a dit 'couvrant et lumineux' puis 'budget 40 euros', cherche un fond de teint couvrant lumineux a moins de 40 euros.\n\n"
      +"Cherche sur amazon.fr des produits correspondant exactement a ces criteres.\n"
      +"ASIN : B + 9 caracteres alphanumeriques EXACTS. Si tu n es pas certain, mets url:null.\n"
      +"Prix : le vrai prix amazon.fr en EUR. Si inconnu : null.\n"
      +"Trouve aussi 1 produit rakuten adapte aux criteres.\n"
      +"JSON: {summary:'phrase qui resume bien la recherche avec les criteres', products:[{name:string, price:string|null, store:'amazon'|'rakuten', keywords:string, url:string|null, badge:string}], promoCodes:[{code,store,discount,best}]}\n"
      +"JSON uniquement.";

    const groqRaw = await groqSearch(groqProdPrompt, 1200);
    const groqParsed = parseJSON(groqRaw||"");
    let products = groqParsed.products||[];
    let summary  = groqParsed.summary||"";
    let promos   = groqParsed.promoCodes||[];

    // ── VALIDATION Groq : detecte les inventions ──────────────────────────────
    // Groq invente quand : ASIN inexistant, prix aberrant, URL mal formee
    const amazonFromGroq = products.filter(function(p){
      return (p.store||"").toLowerCase().includes("amazon");
    });

    const validAsinGroq = amazonFromGroq.filter(function(p){
      // ASIN valide : B + exactement 9 chars alphanumeriques
      if (!p.url) return false;
      const m = p.url.match(/\/dp\/(B[A-Z0-9]{9})(?:[/?]|$)/);
      if (!m) return false;
      // Prix coherent : nombre entre 1 et 9999
      const pNum = parseFloat((p.price||"0").replace(/[^0-9,.]/g,"").replace(",","."));
      return pNum > 0.5 && pNum < 9999;
    });

    // Groq a invente = il a retourne une URL non-null avec un ASIN invalide
    // Groq honnete = il a mis url:null quand il ne savait pas (on garde ses produits + lien search)
    const groqLiedAsin = amazonFromGroq.some(function(p){
      return p.url && p.url !== "null" && p.url.length > 10
        && !/\/dp\/B[A-Z0-9]{9}/.test(p.url);
    });
    // Prix invente = Groq a mis un prix mais url:null (prix hallucine sans source)
    // Dans ce cas on garde le nom mais on efface le prix
    for (const p of amazonFromGroq) {
      if (!p.url || p.url === "null") p.price = null; // prix sans ASIN = invente
    }

    // ── Claude web_search : UNIQUEMENT si Groq a menti sur les ASINs ─────────
    // Si Groq a mis url:null honnêtement → on n appelle PAS Claude, on fait juste un lien /s?k=
    let claudeProds = [];
    if (groqLiedAsin) {
      const claudeRaw = await claude(
        "Cherche sur amazon.fr : "+recap
        +". JSON uniquement: {products:[{name,price,store:'amazon',keywords,url,badge}]}",
        "Trouve les vrais ASINs. URL: https://www.amazon.fr/dp/B0XXXXXXXXX",
        500,
        [{type:"web_search_20250305", name:"web_search", max_uses:2}]
      );
      claudeProds = parseJSON(claudeRaw||"").products||[];
    }

    // ── FUSION : meilleur de Groq + correctif Claude ──────────────────────────
    // Amazon : ASINs valides de Claude en priorite, puis Groq valides, puis Groq sans ASIN
    const claudeAmazon = claudeProds.filter(function(p){
      return (p.store||"").toLowerCase().includes("amazon")
        && p.url && /\/dp\/B[A-Z0-9]{9}/.test(p.url);
    });

    const finalAmazon = claudeAmazon.length ? claudeAmazon.slice(0,2)
      : validAsinGroq.length ? validAsinGroq.slice(0,2)
      : amazonFromGroq.slice(0,2);  // Garde quand meme pour afficher avec lien search

    // Rakuten : Groq puis Claude (Groq est generalement bon pour Rakuten)
    const finalRakuten = products.filter(function(p){
      return (p.store||"").toLowerCase().includes("rakuten");
    }).slice(0,1);

    products = finalAmazon.concat(finalRakuten);

    let buttons = "";
    for (const pr of products.slice(0,4)) {
      if (!pr.name) continue;
      let adv = findAdv(advertisers, pr.store);
      if (!adv) {
        if ((pr.store||"").toLowerCase().includes("amazon")) {
          adv = {slug:"amazon", name:"Amazon", emoji:"\uD83D\uDED2", color:"#e47911", active:true};
        } else if ((pr.store||"").toLowerCase().includes("rakuten")) {
          adv = {slug:"rakuten", name:"Rakuten", emoji:"\uD83D\uDECD\uFE0F", color:"#bf0000", active:true, awin_mid:RAKUTEN_MID};
        } else {
          continue;
        }
      }
      const rawUrl = (pr.url && pr.url !== "null" && pr.url.length > 15) ? pr.url : null;
      const kw = pr.name.length > 5 ? pr.name : (pr.keywords || pr.name);
      const url = buildLink(adv, kw, rawUrl);
      if (!url) continue;
      // Affiche le vrai prix si dispo, sinon "Voir prix"
      const displayPrice = (pr.price && pr.price !== "null" && pr.price !== "undefined" && pr.price.length > 0)
        ? pr.price : "Voir prix";
      buttons += cardProduct(pr.name, displayPrice, url, adv, pr.img||null, pr.badge||null);
    }

    let promoHtml = "";
    for (const c of promos.sort(function(a,b){return (b.best?1:0)-(a.best?1:0);}).slice(0,2)) {
      promoHtml += promoBox(c.code, c.store||"boutique", c.discount||"Reduction exclusive", c.best||false);
    }

    const first = products.find(function(p){return (p.store||"").toLowerCase().includes("amazon");})||products[0];
    let wishHtml = "";
    if (first) {
      const adv0 = findAdv(advertisers, first.store)||{slug:"amazon", name:"Amazon", color:"#e47911", active:true};
      const wUrl = buildLink(adv0, first.keywords||first.name, first.url||null)||"";
      const wD = JSON.stringify({type:"product", name:first.name, price:first.price, store:first.store, url:wUrl}).replace(/"/g,"&quot;");
      wishHtml = '<button onclick="addToWishlist('+wD+')" style="background:#fff;border:1.5px solid #e8edf8;color:#3b5bdb;border-radius:12px;padding:8px 16px;margin-top:10px;font-weight:700;font-size:12px;cursor:pointer;font-family:inherit;width:100%">\u2661 Ajouter a ma wishlist</button>';
    }

    return new Response(JSON.stringify({
      reply:'<div style="font-size:13.5px;color:#1e293b;margin-bottom:8px;font-weight:500;line-height:1.5">'
        +summary+"</div>"
        +buttons
        +(promoHtml?'<div style="margin-top:4px">'+promoHtml+"</div>":"")
        +wishHtml,
      sessionId:sid
    }),{headers:H});

  } catch(err) {
    console.error("Huntify error:", err&&err.message);
    return new Response(JSON.stringify({
      reply:'<div style="font-size:13px;color:#1e293b">Desole, un probleme momentane. Reessayez dans quelques secondes !</div>'
    }),{status:200,headers:{"Content-Type":"application/json; charset=utf-8","Access-Control-Allow-Origin":"*"}});
  }
}
