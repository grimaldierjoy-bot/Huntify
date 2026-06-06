export const config = { runtime: 'edge' };

// ─────────────────────────────────────────────────────────────────────────────
// HUNTIFY — Agent IA shopping + voyage v3
// Version autonome pour le voyage
// ─────────────────────────────────────────────────────────────────────────────

const SUPABASE_URL = "https://enocxbrqyybendertytl.supabase.co";
const SUPABASE_KEY = "sb_publishable_NmPh--frZG5HuqfaoxnemA_E7cidV9Y";
const AMAZON_TAG   = "huntify21-21";
const AWIN_PUB     = "2920215";
const RAKUTEN_MID  = "55615";
const BOOKING_AID  = process.env.BOOKING_AID || "2311236";

// IATA + fonctions de base (toIATA, sbFetch, getAdvertisers, cleanKw, buildLink, findAdv) 
// → je les garde identiques à ton original

const IATA = { /* copie ton objet IATA complet ici */ };

function toIATA(str) { /* copie ta fonction */ }
async function sbFetch(path, method, body) { /* copie */ }
async function getAdvertisers() { /* copie */ }
function cleanKw(kw) { /* copie */ }
function buildLink(adv, keywords, directUrl) { /* copie */ }
function findAdv(advertisers, slug) { /* copie */ }

// Travel links
function bookingTPLink(dest, ci, co, adults, cat) { /* copie ta fonction */ }
function expediaTPLink(dest, ci, co, adults) { /* copie */ }
function skyscannerLink(from, to, ci, co, adults) { /* copie */ }
function getTransferLink(dest, ci) { /* copie */ }

// Prix hôtels
async function fetchHotelPrices(dest, ci, co, adults) { /* copie */ }
async function fetchHotelPricesDeepSeek(dest, ci, co, adults) { /* copie */ }

function parseDate(str) { /* copie */ }
function formatHistory(history, maxLen) { /* copie */ }

// IA Cascade (priorité Groq)
async function groq(sys, user, maxTok) { /* copie */ }
async function groqSearch(prompt, maxTok) { /* copie */ }
async function gemini(prompt, maxTok) { /* copie */ }
async function mistral(sys, user, maxTok) { /* copie */ }
async function deepseek(sys, user, maxTok) { /* copie */ }
async function claude(sys, user, maxTok, tools) { /* copie */ }
function parseJSON(raw) { /* copie */ }
async function dbLookup(kw) { /* copie */ }

// Composants HTML (cardProduct, promoBox, cardHotel, cardDay, cardBudget, cardTips) → copie depuis ton original

// ====================== HANDLER PRINCIPAL ======================
export default async function handler(req) {
  if (req.method === "OPTIONS") return new Response(null, {status:204, headers:{"Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"POST,OPTIONS","Access-Control-Allow-Headers":"Content-Type"}});
  if (req.method !== "POST") return new Response("Method not allowed", {status:405});

  const H = {"Content-Type":"application/json; charset=utf-8","Access-Control-Allow-Origin":"*"};

  try {
    const body = await req.json();
    const message = body.message || "";
    const history = body.history || [];
    const sid = body.sessionId || ("anon_" + Date.now());
    const isTravel = body.mode === "travel" || /voyage|partir|destination|lisbonne|rome|barcelone/i.test(message);

    const hist = formatHistory(history, 2500);

    if (isTravel) {
      // Prompt unique → IA autonome (plus de CAS 1 / CAS 2 rigides)
      const travelPrompt = `Tu es Huntify, un conseiller voyage passionné et autonome.

Historique : ${hist}

Message utilisateur : ${message}

Règles :
- Si l'utilisateur n'a pas de destination précise → propose 3 destinations attractives.
- Sinon → génère un itinéraire complet jour par jour.
- Utilise tes connaissances réelles pour les prix.
- NE JAMAIS inventer de prix ou d'hôtels.
- Retourne UNIQUEMENT du JSON valide.

{
  "type": "proposals" | "itinerary",
  "recap": "phrase enthousiaste",
  "proposals": [array],
  "itin": {dest, flights, hotels, days, budget, tips}
}`;

      let raw = await groqSearch(travelPrompt, 4000);
      if (!raw) raw = await deepseek("Expert voyage autonome. JSON uniquement.", travelPrompt, 3500);
      if (!raw) raw = await claude("Expert voyage autonome. JSON uniquement.", travelPrompt, 3500);

      const data = parseJSON(raw || "{}");

      // Construction HTML (avec bouton Planifier)
      let html = "";

      if (data.type === "proposals" && data.proposals?.length) {
        html = '<div style="font-size:14px;font-weight:700;color:#0e1430;margin-bottom:12px">🌟 Voici mes propositions :</div>';
        for (const p of data.proposals.slice(0,3)) {
          html += `<div style="background:#fff;border:2px solid #e6ebf7;border-radius:16px;padding:16px;margin-bottom:12px">
            <button data-huntify-plan="Planifie un itinéraire complet jour par jour pour ${p.dest}" 
                    onclick="handlePlanifyButton(this)" 
                    style="width:100%;padding:14px;background:linear-gradient(135deg,#2f54ff,#4a6bff);color:#fff;border:none;border-radius:12px;font-weight:700;cursor:pointer">
              📍 Planifier ${p.dest}
            </button>
          </div>`;
        }
      } else {
        // Itinéraire complet
        const itin = data.itin || data;
        html = `<div style="background:linear-gradient(135deg,#1f2da0,#2f54ff);color:white;padding:20px;border-radius:16px;text-align:center">🌍 ${itin.dest || "Ton voyage"}</div>`;
        // Ajoute les hôtels avec fetchHotelPrices etc. (comme dans ta version originale)
      }

      return new Response(JSON.stringify({reply: html, sessionId: sid}), {headers: H});
    }

    // Mode produit (garde ta logique originale avec cascade Groq)
    // ... (colle ici ta partie produit du code initial)

  } catch(err) {
    console.error(err);
    return new Response(JSON.stringify({reply: "Désolé, un problème momentané."}), {headers: H});
  }
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
