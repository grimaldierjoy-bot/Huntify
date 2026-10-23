export const config = { runtime: 'edge' };
// Huntify V4 : L'IA comprend le besoin, les données de recherche fournissent les faits.
// Aucun lien ou prix fabriqué, aucune préférence pour les affiliés.
const BLOCKED = /(^|\.)(rakuten\.(com|fr)|aliexpress\.(com|fr)|aliexpress\.us)$/i;
const MAX_TURNS = 3;
const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
const respond = (data, code=200) => new Response(JSON.stringify(data), {status:code,headers});
const timeoutFetch = async (url, options={}, ms=11000) => {const c=new AbortController(), timer=setTimeout(()=>c.abort(),ms);try{return await fetch(url,{...options,signal:c.signal})}finally{clearTimeout(timer)}};
function parseJSON(s){if(!s)return null;try{return JSON.parse(s)}catch{} const match=String(s).match(/\{[\s\S]*\}/);if(!match)return null;try{return JSON.parse(match[0])}catch{return null}}
function host(url){try{const u=new URL(url);return u.protocol==='https:'&&!u.username&&!u.password&&!BLOCKED.test(u.hostname)?u.hostname.toLowerCase():null}catch{return null}}
function actualProductUrl(url){const h=host(url);if(!h)return null;const u=new URL(url);if(/(^|\.)google\.|(^|\.)bing\.|(^|\.)awin1\.|(^|\.)awin\./i.test(h))return null;if(/(^|\.)amazon\./i.test(h)&&!(/\/(dp|gp\/product)\/[A-Z0-9]{10}/i.test(u.pathname)))return null;if(/\/(search|searchresults|s\/|wholesale|catalogsearch|recherche)(\/|$)/i.test(u.pathname))return null;if(u.searchParams.has('q')&&u.pathname==='/')return null;return u.href}
function amount(raw){if(typeof raw==='number')return Number.isFinite(raw)&&raw>0?raw:null;let s=String(raw||'').replace(/\s/g,'');if(!/[€]|EUR/i.test(String(raw||'')))return null;let n=s.match(/\d[\d.,]*/)?.[0];if(!n)return null;const comma=n.lastIndexOf(','),dot=n.lastIndexOf('.');if(comma>dot)n=n.replace(/\./g,'').replace(',','.');else n=n.replace(/,/g,'');const v=Number(n);return Number.isFinite(v)&&v>0&&v<1000000?v:null}
function offer(o,source,observedAt,{allowIndexedOnly=false}={}){
 const name=String(o.title||o.name||o.productName||'').trim().slice(0,200);
 if(name.length<6)return null;
 const rawLink=o.merchantLink||o.merchant_link||o.offer_link||o.offerLink||o.product_url||o.productUrl||o.productLink||o.link||o.url||'';
 const link=actualProductUrl(rawLink);
 const priceValue=o.price??o.priceText??o.price_text??o.displayPrice??o.extracted_price;
 const explicitCurrency=String(o.currency||o.priceCurrency||'').toUpperCase();
 const price=amount(typeof priceValue==='number'?((!explicitCurrency||explicitCurrency==='EUR')?priceValue:null):priceValue);
 const rating=Number(o.rating);
 const reviews=Number(String(o.reviews??o.reviewCount??'').replace(/[^0-9]/g,''));
 // Une annonce Shopping sans lien marchand direct ne doit pas être présentée comme une fiche validée.
 if(!link&&(!allowIndexedOnly||price===null))return null;
 const store=String(o.source||o.store||o.merchant||o.seller|| (link?host(link):'Marchand non précisé')).trim().slice(0,70);
 const id='p-'+hash(link||name+'|'+store+'|'+String(price));
 const imageCandidate=o.imageUrl||o.image_url||o.thumbnail||null;
 return {id,name,store,price,priceLabel:price!==null?price.toLocaleString('fr-FR',{style:'currency',currency:'EUR'}):'Prix indisponible',currency:'EUR',url:link,directProductLink:!!link,priceVerified:false,priceSource:source,priceObservedAt:price===null?null:observedAt,priceStatus:price===null?'unavailable':'indexed',image:typeof imageCandidate==='string'&&host(imageCandidate)?imageCandidate:null,rating:Number.isFinite(rating)&&rating>=0&&rating<=5?rating:null,reviewCount:Number.isFinite(reviews)&&reviews>=0?reviews:null,reviewSource:'SerperMatrix Shopping (avis agrégés non vérifiés individuellement)',affiliate:false};
}
function rejectionReason(o){
 const name=String(o?.title||o?.name||o?.productName||'').trim();
 if(name.length<6)return 'missing_or_short_title';
 const rawLink=o.merchantLink||o.merchant_link||o.offer_link||o.offerLink||o.product_url||o.productUrl||o.productLink||o.link||o.url||'';
 if(!rawLink)return 'missing_product_link';
 if(!actualProductUrl(rawLink))return 'indirect_or_unsafe_link';
 return 'invalid_product';
}
function hash(s){let h=2166136261;for(let i=0;i<s.length;i++)h=Math.imul(h^s.charCodeAt(i),16777619);return (h>>>0).toString(36)}
// Orchestration du conseil : OpenAI d'abord (si activé), Gemini puis Groq en secours.
// Un fournisseur est appelé après l'autre ; aucun appel Anthropic sans consentement explicite.
// Conseil : aucun appel OpenAI facturable. Gemini puis Groq via modèles réellement disponibles.
// Claude uniquement si le propriétaire a activé explicitement le secours payant.
function safeErrorCode(payload, status) {
 const code=String(payload?.error?.code||payload?.error?.status||payload?.code||'').toLowerCase();
 if(/quota|resource_exhausted|insufficient|billing/.test(code))return 'quota_or_billing';
 if(/model|not_found|invalid_model/.test(code))return 'model_unavailable';
 if(status===401||status===403)return 'authentication_or_permission';
 if(status===429)return 'rate_limited_or_quota';
 if(status===404)return 'model_or_endpoint_not_found';
 return 'http_'+status;
}
async function modelList(provider,key,attempts) {
 const endpoint=provider==='gemini'
  ?'https://generativelanguage.googleapis.com/v1beta/models?pageSize=200'
  :'https://api.groq.com/openai/v1/models';
 const h=provider==='gemini'?{'x-goog-api-key':key}:{Authorization:'Bearer '+key};
 try{
  const r=await timeoutFetch(endpoint,{headers:h},8000);
  const data=await r.json().catch(()=>({}));
  if(!r.ok){attempts.push({provider,status:'models_'+safeErrorCode(data,r.status)});return []}
  return provider==='gemini'
   ?(data.models||[]).filter(m=>(m.supportedGenerationMethods||[]).includes('generateContent')).map(m=>m.name.replace(/^models\//,''))
   :(data.data||[]).filter(m=>m.active!==false).map(m=>m.id);
 }catch(e){attempts.push({provider,status:e?.name==='AbortError'?'models_timeout':'models_network_error'});return []}
}
function preferredModels(provider,available,configured){
 const preferred=provider==='gemini'
  ?['gemini-3.5-flash-lite','gemini-3.8-flash','gemini-3-flash','gemini-2.5-flash-lite','gemini-2.5-flash']
  :['llama-3.1-8b-instant','llama-3.3-70b-versatile','openai/gpt-oss-20b'];
 const validConfigured=configured&&available.includes(configured)?[configured]:[];
 const ranked=preferred.filter(m=>available.includes(m));
 // N'utiliser qu'un petit nombre de modèles de conseil texte réellement listés.
 const remainder=available.filter(m=>provider==='gemini'?/gemini.*(flash|lite)/i.test(m):/llama.*(instruct|instant|versatile)|gpt-oss/i.test(m));
 return [...new Set([...validConfigured,...ranked,...remainder])].slice(0,3);
}
async function llm(sys,user,max=650){
 const attempts=[], configured=[];
 const msg=[{role:'system',content:sys},{role:'user',content:user}];
 for(const provider of ['gemini','groq','claude']){
  const key=provider==='gemini'?process.env.GEMINI_API_KEY:provider==='groq'?process.env.GROQ_API_KEY:process.env.ANTHROPIC_API_KEY;
  if(!key)continue;
  if(provider==='claude'&&process.env.ENABLE_PAID_ADVISOR_FALLBACK!=='true')continue;
  configured.push(provider);
  const models=provider==='claude'
   ?[process.env.CLAUDE_MODEL||'claude-haiku-4-5']
   :preferredModels(provider,await modelList(provider,key,attempts),provider==='gemini'?process.env.GEMINI_MODEL:process.env.GROQ_MODEL);
  if(!models.length){attempts.push({provider,status:'no_supported_model_found'});continue}
  for(const model of models){
   try{
    let url,options;
    if(provider==='gemini'){
      url='https://generativelanguage.googleapis.com/v1beta/models/'+encodeURIComponent(model)+':generateContent';
      options={method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':key},body:JSON.stringify({contents:[{parts:[{text:sys+'\n'+user}]}],generationConfig:{maxOutputTokens:1200,responseMimeType:'application/json'}})};
    }else if(provider==='groq'){
      url='https://api.groq.com/openai/v1/chat/completions';
      options={method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+key},body:JSON.stringify({model,messages:msg,max_tokens:Math.min(max,700),temperature:0.2})};
    }else{
      url='https://api.anthropic.com/v1/messages';
      options={method:'POST',headers:{'Content-Type':'application/json','x-api-key':key,'anthropic-version':'2023-06-01'},body:JSON.stringify({model,max_tokens:Math.min(max,600),system:sys,messages:[{role:'user',content:user}]})};
    }
    const r=await timeoutFetch(url,options,11000);
    const data=await r.json().catch(()=>({}));
    if(!r.ok){
      const status=safeErrorCode(data,r.status);
      attempts.push({provider,model,status});
      // Un 404 permet de tenter un autre modèle réellement annoncé; pas un problème de quota.
      if(r.status===404)continue;
      break;
    }
    const content=provider==='gemini'?(data.candidates?.[0]?.content?.parts||[]).map(p=>p.text||'').join('')
     :provider==='claude'?(data.content||[]).filter(p=>p.type==='text').map(p=>p.text||'').join('')
     :data.choices?.[0]?.message?.content;
    if(content&&String(content).trim())return {text:String(content),provider,attempts,configured};
    attempts.push({provider,model,status:'empty_response'});
    break;
   }catch(e){attempts.push({provider,model,status:e?.name==='AbortError'?'timeout':'network_error'});break}
  }
 }
 return {text:null,provider:null,attempts,configured,openaiEnabled:false,paidFallbackEnabled:process.env.ENABLE_PAID_ADVISOR_FALLBACK==='true'};
}
// Recherche Google via Gemini, avec la clé EXISTANTE et sans API de scraping shopping.
// Le prix est accepté uniquement après confirmation par une page Product/Offer du marchand.
// Google Search grounding utilise la clé Gemini EXISTANTE. On ne retient jamais
// un prix proposé par un LLM sans preuve indexée ou constat sur la page marchande.
async function geminiGroundedShopping(query){
 const key=process.env.GEMINI_API_KEY;
 if(!key)return {offers:[],status:'missing_gemini_key',attempts:[]};
 const attempts=[];
 // Découverte des modèles réellement annoncés pour cette clé, comme pour le conseiller.
 // Les 2.5 renvoient 404 sur certains comptes récents (restriction Google).
 const available=await modelList('gemini',key,attempts);
 const newer=available.filter(x=>/^gemini-[34]/i.test(x)&&/flash|lite/i.test(x));
 const standard=available.filter(x=>/gemini/i.test(x)&&/flash|lite/i.test(x));
 const prefer=['gemini-3.5-flash-lite','gemini-3.8-flash','gemini-3.1-flash-lite','gemini-3.5-flash','gemini-3-flash'];
 const requested=process.env.GEMINI_SEARCH_MODEL;
 const models=[...new Set([requested,...prefer.filter(x=>available.includes(x)),...newer,...standard].filter(x=>x&&available.includes(x)))].slice(0,5);
 if(!models.length)return {offers:[],status:available.length?'no_search_model_found':'model_listing_unavailable',attempts};
 for(const model of models){
  try{
   const prompt='Recherche sur Google des fiches PRODUITS de boutiques françaises répondant à : '+query+
   '. Toutes les boutiques même non affiliées, sauf Rakuten et AliExpress. Trouve 8 à 12 fiches marchandes différentes (pas des pages de recherche). '+ 
   'Pour chaque produit, indique son nom exact, une URL HTTPS directe de sa fiche marchand et, si Google affiche explicitement son prix en EUR, le prix indexé (sinon null). '+ 
   'Réponds UNIQUEMENT avec du JSON, sans Markdown : {"products":[{"name":"marque et modèle","store":"marchand","url":"https://fiche-produit","price":"59,99 € ou null"}]}. '+ 
   'Les liens doivent venir de la recherche, ne crée aucune URL ou tarif.';
   const r=await timeoutFetch('https://generativelanguage.googleapis.com/v1beta/models/'+encodeURIComponent(model)+':generateContent',{
    method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':key},
    body:JSON.stringify({contents:[{parts:[{text:prompt}]}],tools:[{google_search:{}}],generationConfig:{temperature:0.1,maxOutputTokens:2400}})
   },18500);
   const data=await r.json().catch(()=>({}));
   if(!r.ok){
    const reason=safeErrorCode(data,r.status);
    attempts.push({provider:'gemini_google',model,status:reason});
    // 404 : modèle inaccessible. 400 : outil Google Search non pris en charge
    // par ce modèle. Essayer le suivant annoncé par models.list.
    if([400,404].includes(r.status))continue;
    return {offers:[],status:reason,attempts};
   }
   const c=data.candidates?.[0]||{};
   const raw=(c.content?.parts||[]).map(x=>x.text||'').join('\n');
   const parsed=parseJSON(raw);
   const products=Array.isArray(parsed?.products)?parsed.products.slice(0,14):[];
   const groundedUrls=(c.groundingMetadata?.groundingChunks||[]).map(x=>x.web?.uri).filter(Boolean);
   const candidates=[],seen=new Set();
   for(const p of products){
    const url=safeMerchantFetchUrl(p.url);
    if(!url||seen.has(url))continue;
    seen.add(url);
    candidates.push({url,claimedName:String(p.name||'').slice(0,150),indexedPrice:amount(p.price)});
   }
   // Gemini peut renvoyer du texte Markdown plutôt qu'un JSON valide.
   // On récupère alors seulement les URL présentes dans sa réponse, et
   // chaque URL doit encore passer la vérification sur la vraie fiche produit.
   if(!candidates.length){
    for(const match of raw.matchAll(/https:\/\/[^\s<>"')\]]+/g)){
     const cleaned=match[0].replace(/[),.;]+$/g,'');
     const direct=safeMerchantFetchUrl(cleaned);
     if(direct&&!seen.has(direct)){seen.add(direct);candidates.push({url:direct,claimedName:'',indexedPrice:null})}
     if(candidates.length>=10)break;
    }
   }
   if(!candidates.length)for(const url of groundedUrls){
    const direct=safeMerchantFetchUrl(url);
    if(direct&&!seen.has(direct)){seen.add(direct);candidates.push({url:direct,claimedName:'',indexedPrice:null})}
    if(candidates.length>=10)break;
   }
   // Contrôle simultané des pages marchandes, y compris métadonnées OpenGraph.
   const checked=await Promise.all(candidates.slice(0,10).map(async x=>{
    const result=await merchantProductEvidence(x.url,query,x.claimedName);
    if(result?.price!==null&&result?.price!==undefined)return {offer:result,status:'priced_on_merchant'};
    // Ne jamais afficher un tarif imaginé : prix provenant de Gemini uniquement
    // si l'URL du marchand figure explicitement dans les résultats Google cités.
    if(result&&x.indexedPrice!==null&&groundedUrls.some(url=>sameSourceUrl(url,x.url))){
     result.price=x.indexedPrice;
     result.priceLabel=x.indexedPrice.toLocaleString('fr-FR',{style:'currency',currency:'EUR'});
     result.priceSource='Prix indexé Google (à confirmer en boutique)';
     result.priceStatus='google_indexed';
     result.priceObservedAt=new Date().toISOString();
     return {offer:result,status:'indexed_price_cited'};
    }
    return {offer:null,status:result?'page_without_price':'page_unavailable_or_not_product'};
   }));
   const offers=checked.map(x=>x.offer).filter(Boolean);
   const counts={proposed:products.length,groundingLinks:groundedUrls.length,merchantUrls:candidates.length,checked:checked.length,pricedPages:checked.filter(x=>x.status==='priced_on_merchant').length,indexedCited:checked.filter(x=>x.status==='indexed_price_cited').length};
   attempts.push({provider:'gemini_google',model,status:offers.length?'ok':candidates.length?'no_readable_prices':'no_merchant_urls',...counts});
   // Un modèle peut générer du texte sans grounding ; si aucune URL n'est
   // exploitable, essayer les autres modèles disponibles (limite 5).
   if(!candidates.length)continue;
   return {offers,status:offers.length?'ok':candidates.length?'no_readable_prices':products.length?'no_merchant_urls':'no_products_extracted',attempts};
  }catch(e){attempts.push({provider:'gemini_google',model,status:e?.name==='AbortError'?'timeout':'network_error'})}
 }
 return {offers:[],status:attempts.at(-1)?.status||'unavailable',attempts};
}
function sameSourceUrl(a,b){
 try{const x=new URL(a),y=new URL(b);return x.hostname===y.hostname&&x.pathname.replace(/\/$/,'')===y.pathname.replace(/\/$/,'')}catch{return false}
}
// Index public RSS : découverte de liens sans IA payante, pas de prix inventés.
async function publicWebOffers(query){
 const attempts=[],seen=new Set(),candidates=[];
 for(const suffix of [' prix acheter',' site:fnac.com OR site:boulanger.com OR site:darty.com prix']){
  try{
   const url='https://www.bing.com/search?format=rss&setlang=fr-FR&q='+encodeURIComponent(query+suffix);
   const r=await timeoutFetch(url,{headers:{Accept:'application/rss+xml,application/xml,text/xml'},redirect:'manual'},5500);
   if(!r.ok){attempts.push('http_'+r.status);continue}
   const xml=(await r.text()).slice(0,160000);
   for(const match of xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)){
    const item=match[1],raw=item.match(/<link>([\s\S]*?)<\/link>/i)?.[1]||'';
    const link=safeMerchantFetchUrl(raw.replace(/&amp;/g,'&').trim());
    if(!link||seen.has(link))continue;
    const domain=host(link);
    if(/(?:google|bing|youtube|wikipedia)\./i.test(domain||''))continue;
    seen.add(link);candidates.push(link);
    if(candidates.length>=12)break;
   }
   attempts.push('rss_'+candidates.length);
  }catch(e){attempts.push(e?.name==='AbortError'?'timeout':'network_error')}
  if(candidates.length>=12)break;
 }
 const checked=await Promise.all(candidates.slice(0,12).map(link=>merchantProductEvidence(link,query)));
 const offers=checked.filter(o=>o&&o.price!==null);
 return {offers,status:offers.length?'ok':candidates.length?'no_public_prices':'no_public_links',found:candidates.length,checked:checked.length,attempts};
}
function approvedMaximum(brief){
 const text=[brief.query,brief.summary,...(brief.criteria||[])].filter(x=>typeof x==='string').join(' ');
 const values=[...text.matchAll(/(?:budget(?: maximum| max)?(?: de)?|prix max(?:imum)?(?: de)?|moins de|jusqu['’]à|maximum de)\s*(\d+(?:[,.]\d{1,2})?)\s*(?:€|euros?|eur)/gi)].map(m=>Number(m[1].replace(',','.'))).filter(x=>x>0);
 return values.length?Math.min(...values):null;
}
async function brave(query){const key=process.env.BRAVE_SEARCH_API_KEY;if(!key)return [];try{const u='https://api.search.brave.com/res/v1/web/search?q='+encodeURIComponent(query+' acheter prix')+'&country=fr&search_lang=fr&count=15';const r=await timeoutFetch(u,{headers:{'Accept':'application/json','X-Subscription-Token':key}},10000);if(!r.ok)return [];const d=await r.json();const t=new Date().toISOString();return (d.web?.results||[]).map(x=>offer({title:x.title,url:x.url,source:host(x.url),price:null},'Web (prix non disponible)',t)).filter(Boolean).slice(0,8)}catch{return []}}
async function groqWebCandidates(query){
if(!process.env.GROQ_API_KEY)return [];
try{const r=await timeoutFetch('https://api.groq.com/openai/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+process.env.GROQ_API_KEY},body:JSON.stringify({model:process.env.GROQ_SEARCH_MODEL||'compound-beta',max_tokens:950,messages:[{role:'user',content:'Recherche sur le web des fiches PRODUITS DIRECTES et réellement trouvées chez tous les marchands français sauf Rakuten et AliExpress pour: '+query+'. Jamais de page de résultats, jamais d’URL imaginée. Retourne uniquement JSON {"products":[{"name":"marque modèle exact","url":"https://lien-direct-observé","store":"marchand"}]}. N’indique aucun prix car le système vérifie les prix indépendamment.'}]})},13000);if(!r.ok)return [];const d=await r.json();const x=parseJSON(d.choices?.[0]?.message?.content);return (Array.isArray(x?.products)?x.products:[]).map(p=>offer(p,'Recherche IA (prix indisponible)',null)).filter(Boolean).slice(0,6)}catch{return []}}
// Recherche augmentée par Claude : les URLs et prix doivent provenir d'une recherche web
// réellement exécutée. Aucun prix inventé par le modèle n'est présenté.
// Moteur indépendant : Claude effectue AU MAXIMUM une recherche Web payante.
// Exploiter les sources factuelles du web_search Anthropic, même lorsque le
// modèle ne renvoie pas de JSON. Aucun prix non sourcé ne sera inventé.
// Contrôle IA en dernier, sans outil web et sans repayer une recherche.
// Il juge uniquement la cohérence de fiches déjà sourcées, jamais le prix réel en direct.
async function claudeCompactAudit(query,offers){
 if(process.env.ENABLE_CLAUDE_PRICE_AUDIT==='false'||!process.env.ANTHROPIC_API_KEY||!offers.length)return {status:'disabled',audited:0};
 const sample=offers.slice(0,5).map((o,i)=>({index:i,name:o.name,store:o.store,priceEUR:o.price,merchantHost:host(o.url),priceSource:o.priceSource}));
 try{
  const r=await timeoutFetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'Content-Type':'application/json','x-api-key':process.env.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01'},body:JSON.stringify({
   model:process.env.CLAUDE_MODEL||'claude-haiku-4-5',max_tokens:200,
   system:'Contrôle seulement la pertinence des références produits par rapport à la demande. Tu ne peux pas vérifier les prix en temps réel. N’invente aucun prix ni lien. Retourne JSON uniquement.',
   messages:[{role:'user',content:'Demande : '+query+'\nFiches structurées avec URL déjà trouvées : '+JSON.stringify(sample)+'\nJSON {"reviews":[{"index":0,"relevant":true,"reason":"..."}]}. Max 12 mots par raison.'}]
  })},8500);
  if(!r.ok)return {status:'http_'+r.status,audited:0};
  const data=await r.json().catch(()=>({}));
  const parsed=parseJSON((data.content||[]).filter(x=>x.type==='text').map(x=>x.text).join(''));
  if(!Array.isArray(parsed?.reviews))return {status:'invalid_output',audited:0};
  let checked=0;
  for(const item of parsed.reviews){
   if(!Number.isInteger(item.index)||item.index<0||item.index>=sample.length)continue;
   // L'avis IA est seulement une annotation, pas une confirmation de prix.
   offers[item.index].aiRelevance=item.relevant===true?'pertinent':item.relevant===false?'à examiner':'inconnu';
   checked++;
  }
  return {status:'ok',audited:checked};
 }catch(e){return {status:e?.name==='AbortError'?'timeout':'network_error',audited:0}}
}
// Accepte JSON-LD, meta og/product et microdata; un prix n'est jamais
// attribué à une autre référence produit ou une autre boutique.
function merchantPriceFromHtml(html){
 const tags=[...html.matchAll(/<meta\b[^>]*>/gi)].slice(0,220).map(x=>x[0]);
 let numeric=null,currency=null;
 for(const tag of tags){
  const attrs={};for(const m of tag.matchAll(/([a-z][\w:-]*)\s*=\s*["']([^"']*)["']/gi))attrs[m[1].toLowerCase()]=m[2];
  const label=String(attrs.property||attrs.name||attrs.itemprop||'').toLowerCase();
  if(['product:price:amount','og:price:amount','price','product_price','product:price','twitter:data1'].includes(label)){
   const raw=attrs.content??attrs.value;const val=amount(raw==null?null:String(raw)+' EUR');
   if(val!==null)numeric=val;
  }
  if(['product:price:currency','og:price:currency','pricecurrency'].includes(label))currency=String(attrs.content||attrs.value||'').toUpperCase();
 }
 if(numeric!==null&&currency==='EUR')return {price:numeric,method:'merchant_meta'};
 return {price:null,method:'missing_eur_meta'};
}
function productJsonPrice(html,expectedName){
 const reg=/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
 let m;
 while((m=reg.exec(html))){
  let root;try{root=JSON.parse(m[1].trim())}catch{continue}
  const queue=[root];let scan=0;
  while(queue.length&&scan++<100){
   const x=queue.shift();if(!x||typeof x!=='object')continue;
   if(Array.isArray(x)){queue.push(...x.slice(0,40));continue}
   if(x['@graph'])queue.push(x['@graph']);
   if(!String(x['@type']||'').includes('Product'))continue;
   const name=String(x.name||'').slice(0,180);
   if(!name||expectedName&&!productMatch(expectedName,name))continue;
   const entries=Array.isArray(x.offers)?x.offers:[x.offers];
   for(const o of entries){
    if(!o||String(o['@type']||'').includes('AggregateOffer'))continue;
    const currency=String(o.priceCurrency||o.priceSpecification?.priceCurrency||'').toUpperCase();
    const value=o.price??o.priceSpecification?.price??o.lowPrice;
    if(currency!=='EUR'||value==null)continue;
    const price=amount(typeof value==='number'?value:String(value)+' EUR');
    if(price!==null)return {name,price,method:'merchant_jsonld'};
   }
   // Nom du produit constaté : on pourra utiliser une meta EUR sur cette même page.
   return {name,price:null,method:'product_without_jsonld_price'};
  }
 }
 return null;
}
async function merchantProductEvidence(url,query,expectedName=''){
 const link=safeMerchantFetchUrl(url);if(!link)return null;
 try{
  const r=await timeoutFetch(link,{headers:{Accept:'text/html'},redirect:'manual'},6500);
  if(!r.ok||!/text\/html|application\/xhtml/i.test(r.headers.get('content-type')||''))return null;
  const html=(await r.text()).slice(0,700000);
  let ld=productJsonPrice(html,expectedName);
  if(!ld){
   // Certains marchands exposent OG title/price mais pas de JSON-LD.
   const match=html.match(/<meta\b[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["'][^>]*>/i);
   const title=match?.[1]?.replace(/&amp;/g,'&').trim()||'';
   const meta=merchantPriceFromHtml(html);
   if(title.length<8||meta.price===null||expectedName&&!productMatch(expectedName,title))return null;
   ld={name:title,price:meta.price,method:'merchant_og'};
  }
  const name=ld.name;
  const models=productTokens(query).filter(x=>/[a-z]/.test(x)&&/\d/.test(x)&&!['200','100'].includes(x));
  if(models.length&&!models.every(x=>productTokens(name).includes(x)))return null;
  const found=ld.price!==null?{price:ld.price,method:ld.method}:merchantPriceFromHtml(html);
  const o=offer({title:name,link,store:host(link),price:found.price},'Fiche produit marchande : '+found.method,new Date().toISOString());
  if(o){o.priceStatus=found.price===null?'unavailable':'merchant_structured';return o}
 }catch{}
 return null;
}
function pricedDirect(o){return !!o?.directProductLink&&!!o?.url&&typeof o?.price==='number'&&Number.isFinite(o.price)&&o.price>0}
function productTokens(v){
 return String(v||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').match(/[a-z0-9]{3,}/g)?.filter(x=>!['pour','avec','chez','dans','the','and','noir','blanc','black','white','prix','achat','livraison','produit'].includes(x))||[];
}
function productMatch(a,b){
 const x=[...new Set(productTokens(a))],y=new Set(productTokens(b));
 if(x.length<2)return false;
 const common=x.filter(t=>y.has(t));
 const models=x.filter(t=>/[a-z]/.test(t)&&/\d/.test(t));
 if(models.length&&!models.every(t=>y.has(t)))return false;
 return common.length>=2&&common.length/Math.min(x.length,8)>=0.5;
}
function sameMerchant(a,b){
 const aa=String(a||'').toLowerCase().replace(/[^a-z0-9]/g,''),bb=String(b||'').toLowerCase().replace(/[^a-z0-9]/g,'');
 return !!aa&&!!bb&&(aa===bb||aa.includes(bb)||bb.includes(aa));
}
function safeMerchantFetchUrl(url){
 const link=actualProductUrl(url);if(!link)return null;
 const u=new URL(link),h=u.hostname.toLowerCase();
 if(h==='localhost'||h.endsWith('.localhost')||h.endsWith('.local')||h.endsWith('.internal')||h.endsWith('.test')||h.endsWith('.invalid')||h.endsWith('.example')||h.endsWith('.onion')||h==='metadata.google.internal'||h==='169.254.169.254'||h==='0.0.0.0'||/^\d+\.\d+\.\d+\.\d+$/.test(h)||h.includes(':')||h.startsWith('xn--'))return null;
 return link;
}
function structuredPriceFromHtml(html,expectedTitle){
 const script=/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
 let m;
 while((m=script.exec(html))!==null){
  let data;try{data=JSON.parse(m[1].replace(/^\s*<!--|-->\s*$/g,''))}catch{continue}
  const todo=[data];let scanned=0;
  while(todo.length&&scanned++<80){
   const x=todo.shift();if(!x||typeof x!=='object')continue;
   if(Array.isArray(x)){todo.push(...x.slice(0,20));continue}
   if(x['@graph'])todo.push(x['@graph']);
   const type=String(x['@type']||'');
   if(/(^|[, ])Product($|[, ])/.test(type)){
    if(!productMatch(expectedTitle,x.name||''))continue;
    const offs=Array.isArray(x.offers)?x.offers:[x.offers];
    for(const o of offs){
     if(!o||typeof o!=='object'||/AggregateOffer/.test(String(o['@type']||'')))continue;
     const currency=String(o.priceCurrency||o.priceSpecification?.priceCurrency||'').toUpperCase();
     const amountRaw=o.price??o.priceSpecification?.price;
     if(currency!=='EUR'||amountRaw==null)continue;
     const price=amount(typeof amountRaw==='number'?amountRaw:String(amountRaw)+' EUR');
     if(price!==null)return price;
    }
   }
  }
 }
 return null;
}
async function merchantPagePrice(o){
 const url=safeMerchantFetchUrl(o.url);if(!url)return {status:'unsafe_link'};
 try{
  // Pas de redirections automatiques vers une autre URL/ressource.
  const r=await timeoutFetch(url,{headers:{'Accept':'text/html','User-Agent':'HuntifyPriceCheck/1.0'},redirect:'manual'},5500);
  if(!r.ok)return {status:'http_'+r.status};
  const contentType=r.headers.get('content-type')||'';
  if(!/text\/html|application\/xhtml\+xml/i.test(contentType))return {status:'not_html'};
  const html=(await r.text()).slice(0,650000);
  const price=structuredPriceFromHtml(html,o.name);
  if(price===null)return {status:'no_matching_eur_product_offer'};
  return {price,status:'structured_product_offer',observedAt:new Date().toISOString()};
 }catch(e){return {status:e?.name==='AbortError'?'timeout':'unavailable'}}
}

async function completeOffers(found,query){
 const counts={initial:found.length,completedFromMerchant:0,pairedFromSources:0,missingPrice:0,missingLink:0,notVerified:0,pageChecks:0};
 const direct=found.filter(o=>o?.directProductLink&&o.url);
 const indexed=found.filter(o=>o?.price!==null&&!o?.directProductLink);
 // Rejoindre uniquement les offres du même marchand ET du même modèle,
 // jamais un prix Fnac à un lien Boulanger ou deux variantes différentes.
 for(const target of direct){
  if(target.price!==null)continue;
  const shop=host(target.url)||'';
  const match=indexed.find(o=>productMatch(o.name,target.name)&&(sameMerchant(o.store,target.store)||sameMerchant(o.store,shop.split('.')[0])));
  if(match){
    target.price=match.price;target.priceLabel=match.priceLabel;target.priceSource=match.priceSource+' (rapproché même marchand/modèle)';target.priceObservedAt=match.priceObservedAt;target.priceStatus='cross_source_indexed';counts.pairedFromSources++;
  }
 }
 // Lire les données structurées publiques des fiches marchandes, pas la réponse d'une IA.
 const candidates=direct.filter(o=>o.price===null).slice(0,6);
 const resolved=await Promise.all(candidates.map(merchantPagePrice));
 for(let k=0;k<candidates.length;k++){
  const got=resolved[k];counts.pageChecks++;
  if(typeof got.price==='number'){
   const o=candidates[k];o.price=got.price;o.priceLabel=got.price.toLocaleString('fr-FR',{style:'currency',currency:'EUR'});o.priceSource='Données structurées Product/Offer du marchand';o.priceObservedAt=got.observedAt;o.priceStatus='merchant_structured';o.priceVerified=false;counts.completedFromMerchant++;
  }
 }
 const unique=new Map();
 for(const o of direct.filter(pricedDirect)){
  const key=o.url.replace(/[?#].*$/,'');
  if(!unique.has(key)||(!unique.get(key).priceObservedAt&&o.priceObservedAt))unique.set(key,o);
 }
 counts.missingPrice=direct.filter(o=>!pricedDirect(o)).length;
 counts.missingLink=indexed.length;
 counts.complete=unique.size;
 counts.notVerified=[...unique.values()].filter(o=>!o.priceVerified).length;
 return {offers:[...unique.values()].slice(0,12),diagnostic:counts};
}

// Les avis textuels proviennent uniquement des données JSON-LD des fiches marchandes.
// Une note agrégée seule n'autorise jamais une synthèse qualitative.
function extractReviewsFromHtml(html,expectedName){
 const out=[],seen=new Set(),blocks=/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
 let match;
 while((match=blocks.exec(html))&&out.length<8){
  let root;try{root=JSON.parse(match[1])}catch{continue}
  const queue=[root];let scanned=0;
  while(queue.length&&scanned++<90&&out.length<8){
   const x=queue.shift();if(!x||typeof x!=='object')continue;
   if(Array.isArray(x)){queue.push(...x.slice(0,30));continue}
   if(x['@graph'])queue.push(x['@graph']);
   if(!/(^|[, ])Product($|[, ])/.test(String(x['@type']||'')))continue;
   if(!productMatch(expectedName,x.name||''))continue;
   const entries=Array.isArray(x.review)?x.review:[x.review];
   for(const v of entries){
    if(!v||typeof v!=='object')continue;
    const content=String(v.reviewBody||v.description||'').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim().slice(0,650);
    if(content.length<35||seen.has(content))continue;
    seen.add(content);
    const rating=Number(v.reviewRating?.ratingValue);
    out.push({text:content,rating:Number.isFinite(rating)&&rating>=1&&rating<=5?rating:null});
    if(out.length>=8)break;
   }
  }
 }
 return out;
}
async function merchantReviewEvidence(item){
 const url=safeMerchantFetchUrl(item.url);
 if(!url)return {name:item.name,url:null,reviews:[],status:'invalid_url'};
 try{
  const r=await timeoutFetch(url,{headers:{Accept:'text/html'},redirect:'manual'},5500);
  if(!r.ok)return {name:item.name,url,reviews:[],status:'merchant_http_'+r.status};
  if(!/text\/html|application\/xhtml/i.test(r.headers.get('content-type')||''))return {name:item.name,url,reviews:[],status:'not_html'};
  const html=(await r.text()).slice(0,700000);
  const reviews=extractReviewsFromHtml(html,item.name);
  return {name:item.name,url,reviews,status:reviews.length?'reviews_found':'no_text_reviews'};
 }catch(e){return {name:item.name,url,reviews:[],status:e?.name==='AbortError'?'timeout':'merchant_unavailable'}}
}
async function compareCustomerReviews(items,brief){
 const evidence=await Promise.all(items.map(merchantReviewEvidence));
 const sources=evidence.map(x=>({name:x.name,url:x.url,reviewCount:x.reviews.length,status:x.status}));
 const eligible=evidence.filter(x=>x.reviews.length>=2);
 if(!eligible.length)return {summaries:[],sources,status:'insufficient_text_reviews'};
 const prompt='Analyse UNIQUEMENT ces avis clients textuels issus des pages marchandes citées. Pour chaque produit avec au moins 2 avis, synthétise un point positif et un point négatif SEULEMENT si soutenus par les extraits. Aucun fait externe ou inventé. Si une catégorie n’est pas étayée, retourne une chaîne vide. Explique brièvement l’adéquation aux critères utilisateur si vérifiable par les avis, sinon chaîne vide. Réponds strictement JSON {"items":[{"index":0,"pros":"...","cons":"...","fit":"..."}]}. Critères : '+String(brief||'').slice(0,300)+'\n'+JSON.stringify(evidence.map((x,i)=>({index:i,name:x.name,reviews:x.reviews.map(v=>v.text.slice(0,450))})));
 const ai=await llm('Tu es un analyste rigoureux de retours clients. Aucun avis inventé. Sortie JSON seule.',prompt,1150);
 if(!ai.text)return {summaries:[],sources,status:'ai_unavailable',diagnostic:ai.attempts};
 const parsed=parseJSON(ai.text);if(!Array.isArray(parsed?.items))return {summaries:[],sources,status:'invalid_summary'};
 const summaries=[];
 for(const x of parsed.items){
  const i=Number(x.index);if(!Number.isInteger(i)||i<0||i>=evidence.length||evidence[i].reviews.length<2)continue;
  const ev=evidence[i];
  summaries.push({index:i,name:ev.name,sourceUrl:ev.url,reviewCount:ev.reviews.length,pros:String(x.pros||'').slice(0,320),cons:String(x.cons||'').slice(0,320),fit:String(x.fit||'').slice(0,320)});
 }
 return {summaries,sources,status:summaries.length?'ok':'no_valid_summary',provider:ai.provider};
}

// Contrat conversationnel V6 : aucune recherche sans action explicite « search ».
// L'IA choisit les questions; seules les limites d'usage sont déterministes.
export default async function handler(req){
 if(req.method!=='POST')return respond({error:'POST requis'},405);
 let body;try{body=await req.json()}catch{return respond({error:'JSON invalide'},400)}
 const message=String(body.message||'').trim().slice(0,1500);
 const action=body.action==='search'?'search':body.action==='reviews'?'reviews':'consult';
 const sid=String(body.sessionId||'').slice(0,100)||crypto.randomUUID();
 const history=Array.isArray(body.history)?body.history.slice(-14).map(x=>({role:x.role==='user'?'user':'assistant',content:String(x.content||'').slice(0,500)})):[];
 if(action==='reviews'){
  const items=Array.isArray(body.products)?body.products.slice(0,6).filter(x=>x&&typeof x.name==='string'&&typeof x.url==='string').map(x=>({name:x.name.slice(0,180),url:x.url})): [];
  if(items.length<2)return respond({error:'Sélectionnez au moins deux produits avec une fiche marchande.'},400);
  const reviewAnalysis=await compareCustomerReviews(items,body.criteria);
  return respond({phase:'reviews',reviewAnalysis,sessionId:sid});
 }
 if(action==='search'){
  const approved=body.approvedBrief;
  if(!approved||typeof approved!=='object'||!Array.isArray(approved.criteria)||!String(approved.query||'').trim())return respond({error:'Critères non validés',reply:'Validez d’abord les critères avec l’assistant.'},400);
  const query=String(approved.query).slice(0,180);
  let offers=[],source='gemini_google';
  const seen=new Set(offers.map(o=>o.url||o.id));
  const addMore=items=>{for(const o of items||[]){const id=o.url||o.id;if(id&&!seen.has(id)){seen.add(id);offers.push(o)}}};
  // Flux public et données structurées marchandes en priorité.
  const free=await publicWebOffers(query);
  addMore(free.offers);
  if(free.offers.length)source='public_web+merchant_pages';
  const google=offers.filter(pricedDirect).length>=5?{offers:[],status:'not_needed',attempts:[]}:await geminiGroundedShopping(query);
  addMore(google.offers);
  if(google.offers.length)source='gemini_google';
  // Brave est indépendant de SerperMatrix, uniquement s'il est configuré.
  const braveOffers=offers.filter(pricedDirect).length<5?await brave(query):[];
  addMore(braveOffers);
  if(braveOffers.length)source='brave_web';
  // Phase de coût minimal : extraction directe des prix Product/Offer chez les marchands,
  // avant toute demande à Claude ; aucune consommation de tokens IA ici.
  const webCandidates=braveOffers.filter(o=>o.directProductLink&&o.url).slice(0,8);
  const structured=await Promise.all(webCandidates.map(o=>merchantProductEvidence(o.url,query)));
  const pageOffers=structured.filter(o=>o&&o.price!==null);
  // Priorité au prix constaté sur la page marchande, pas au titre du moteur de recherche.
  for(const p of pageOffers){
   const existing=offers.find(o=>o.url===p.url);
   if(existing)Object.assign(existing,p);else addMore([p]);
  }
  if(pageOffers.length)source='brave+merchant_pages';
  // Pas de recherche web facturable Anthropic. Haiku analyse uniquement les offres sourcées.
  const claudeResearch={status:'paid_web_search_disabled',attempts:[]};
  const completion=await completeOffers(offers,query);
  const max=approvedMaximum(approved);
  const valid=completion.offers.filter(o=>max===null||o.price<=max).sort((a,b)=>a.price-b.price);
  const priceAudit=await claudeCompactAudit(query,valid);
  const reply=valid.length
   ?'Voici '+valid.length+' offre(s) avec prix et fiche marchand directe. '+(valid.length<5?'La recherche a déjà exploré les sources disponibles, mais seulement '+valid.length+' offres ont un prix lisible sur leur fiche. ':'')+'Les prix sont sourcés mais à confirmer chez le marchand.'
   :'Aucune offre avec prix ET lien marchand ne peut encore être confirmée. Recherche web : '+source+'. '+(google.status!=='ok'?'Google/Gemini : '+google.status+' ('+(google.attempts||[]).map(x=>x.model+':'+x.status).join(', ')+'). ':'')+'Découverte gratuite : '+free.status+'. Claude Web Search désactivé. Aucun prix ni URL inventé.';
  return respond({phase:'results',reply,sessionId:sid,offers:valid,search:{query,criteria:approved.criteria.slice(0,8),source,completionDiagnostic:{...completion.diagnostic,publicDiscovery:{status:free.status,found:free.found,checked:free.checked,attempts:free.attempts},maximumBudget:max,googleGrounding:{status:google.status,attempts:google.attempts},freeMerchantPagesChecked:webCandidates.length,freeMerchantPrices:pageOffers.length,claudePriceAudit:priceAudit},pricedCount:valid.length,claudeResearch:{status:claudeResearch.status,attempts:claudeResearch.attempts,evidenceCount:claudeResearch.evidenceCount||0,rejected:claudeResearch.rejected||0},observedAt:new Date().toISOString()}})
 }
 if(!message)return respond({error:'Demande vide'},400);
 const turns=Math.max(0,Math.min(4,Number(body.questionCount)||0));
 const transcript=history.map(x=>x.role+': '+x.content).join('\n');
 const sys=`Tu es Huntify, conseiller d'achat expert, indépendant et exigeant. Tu identifies les usages et contraintes propres au besoin de l'utilisateur, sans questionnaire standard ni critères codés par catégorie. Le but est de lui proposer des produits pertinents, même chez des marchands sans affiliation. N'utilise pas Rakuten ou AliExpress. Pose UNE question uniquement si sa réponse changerait significativement le choix des produits. Évite les répétitions et ne redemande jamais une information déjà fournie. Si les informations suffisent, produis une synthèse à valider; tu ne déclenches PAS la recherche toi-même. Après ${turns} question(s), il reste au maximum ${Math.max(0,3-turns)} question(s). Si plus de questions possibles, synthétise ce qui est connu sans inventer les informations manquantes. Réponds UNIQUEMENT en JSON : soit {"state":"question","question":"une question courte et décisive"}, soit {"state":"ready","summary":"besoin reformulé en langage clair","query":"requête shopping précise avec termes des produits pertinents","criteria":["critères réellement fournis ou déduits explicitement"],"assumptions":["hypothèses si nécessaire"]}. Ne fabrique aucun produit, URL, prix ni avis.`;
 const ai=await llm(sys,'Historique:\n'+transcript+'\nMessage actuel : '+message+'\nNombre de questions déjà posées : '+turns,650);
 const raw=ai.text;
 if(!raw)return respond({phase:'error',reply:'Aucune IA de conseil n’a répondu. Vérifiez le diagnostic fournisseur : aucune recherche n’est lancée.',sessionId:sid,offers:[],diagnostic:'ai_unavailable',aiDiagnostic:{attempts:ai.attempts,configured:ai.configured,openaiEnabled:ai.openaiEnabled}},503);
 const decision=parseJSON(raw);
 if(!decision||!['question','ready'].includes(decision.state))return respond({phase:'error',reply:'La réponse de l’IA est inexploitable. Réessayez : aucune recherche n’a été déclenchée.',sessionId:sid,offers:[],diagnostic:'ai_invalid_output'},502);
 if(decision.state==='question'&&turns<3&&String(decision.question||'').trim())return respond({phase:'question',reply:String(decision.question).slice(0,350),sessionId:sid,offers:[],questionCount:turns+1,aiProvider:ai.provider});
 if(decision.state!=='ready')return respond({phase:'error',reply:'L’IA n’a pas pu finaliser les critères. Reformulez votre demande pour continuer.',sessionId:sid,offers:[],diagnostic:'ai_no_brief'},502);
 const brief={summary:String(decision.summary||message).slice(0,450),query:String(decision.query||'').slice(0,180),criteria:Array.isArray(decision.criteria)?decision.criteria.map(String).slice(0,8):[],assumptions:Array.isArray(decision.assumptions)?decision.assumptions.map(String).slice(0,4):[]};
 if(!brief.query)return respond({phase:'error',reply:'L’IA n’a pas fourni de requête produit précise.',sessionId:sid,offers:[],diagnostic:'ai_missing_query'},502);
 return respond({phase:'ready',reply:'Voici ce que j’ai compris. Confirmez ces critères avant la recherche, ou apportez une précision.',sessionId:sid,brief,offers:[],questionCount:turns,aiProvider:ai.provider});
}
