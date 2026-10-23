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
async function shopping(query){
  // Deux voies publiées par le fournisseur : Shopping spécialisé, puis Search multi-sources.
  // Ne jamais transmettre la clé ou les réponses brutes au navigateur.
  if(process.env.ENABLE_SERPERMATRIX_SEARCH!=='true')return {offers:[],status:'disabled_optional',received:0,rejected:0,attempts:[]};
  const key=process.env.SERPERMATRIX_API_KEY?.trim();
  if(!key)return {offers:[],status:'missing_key',received:0,rejected:0,attempts:[]};
  const attempts=[];
  const requests=[
    {name:'shopping',url:'https://serpermatrix.com/api/v1/shopping',body:{q:query,gl:'fr',hl:'fr',num:18,use_cache:true}},
    {name:'search_shopping',url:'https://serpermatrix.com/api/v1/search',body:{query,sources:['shopping'],limit:18,country:'fr',lang:'fr',use_cache:true}}
  ];
  for(const endpoint of requests){
    let r;
    try{
      r=await timeoutFetch(endpoint.url,{
        method:'POST',redirect:'follow',headers:{'Content-Type':'application/json','X-API-KEY':key},
        body:JSON.stringify(endpoint.body)
      },14000);
    }catch(e){
      const status=e?.name==='AbortError'?'timeout':'network_error';
      attempts.push({endpoint:endpoint.name,status});
      // La deuxième voie est un secours uniquement si la première est introuvable.
      return {offers:[],status,received:0,rejected:0,attempts};
    }
    if(!r.ok){
      const codes={400:'bad_request',401:'invalid_key',402:'insufficient_credits',403:'forbidden',404:'http_404',405:'http_405',429:'rate_limited',500:'provider_error',502:'provider_error',503:'provider_error'};
      const status=codes[r.status]||'http_'+r.status;
      attempts.push({endpoint:endpoint.name,status});
      if(endpoint.name==='shopping' && (r.status===404 || r.status===405))continue;
      return {offers:[],status,received:0,rejected:0,attempts};
    }
    let data;
    try{data=await r.json()}catch{
      attempts.push({endpoint:endpoint.name,status:'invalid_json'});
      return {offers:[],status:'invalid_json',received:0,rejected:0,attempts};
    }
    const candidates=[data?.shopping,data?.data?.shopping,data?.data?.results?.shopping,data?.results?.shopping];
    const items=candidates.find(Array.isArray)||[];
    const seen=new Set(),t=new Date().toISOString(),rejectionReasons={};
    const linked=[],indexedOnly=[];
    for(const item of items){
      const direct=offer(item,'Shopping SerperMatrix (prix indexé)',t);
      if(direct){
        if(!seen.has(direct.id)){seen.add(direct.id);linked.push(direct)}
        continue;
      }
      const indexed=offer(item,'Shopping SerperMatrix (lien marchand non vérifié)',t,{allowIndexedOnly:true});
      if(indexed){
        if(!seen.has(indexed.id)){seen.add(indexed.id);indexedOnly.push(indexed)}
        continue;
      }
      const reason=rejectionReason(item);
      rejectionReasons[reason]=(rejectionReasons[reason]||0)+1;
    }
    // Si les annonces Shopping ne fournissent aucun lien marchand direct, rechercher
    // des fiches produits via la même API de recherche web, plutôt qu'inventer des liens.
    const webOffers=[];
    if(linked.length===0&&process.env.ENABLE_SERPER_WEB_FALLBACK!=='false'){
      try{
        const wr=await timeoutFetch('https://serpermatrix.com/api/v1/search',{
          method:'POST',headers:{'Content-Type':'application/json','X-API-KEY':key},
          body:JSON.stringify({query:query+' acheter prix',sources:['web'],limit:15,country:'fr',lang:'fr',use_cache:true})
        },12000);
        if(wr.ok){
          const wd=await wr.json();
          const webItems=wd?.data?.web||wd?.web||wd?.results?.web||[];
          for(const item of webItems){
            const candidate=offer(item,'Recherche web SerperMatrix (prix non disponible)',t);
            if(candidate&&!seen.has(candidate.id)){seen.add(candidate.id);webOffers.push(candidate)}
          }
          attempts.push({endpoint:'merchant_web_fallback',status:webOffers.length?'ok':'no_direct_product_links'});
        }else attempts.push({endpoint:'merchant_web_fallback',status:'http_'+wr.status});
      }catch(e){attempts.push({endpoint:'merchant_web_fallback',status:e?.name==='AbortError'?'timeout':'network_error'})}
    }
    // Pour ne pas masquer les résultats : conserver les prix indexés sans inventer
    // d'URL de marchand. L'interface cache naturellement le bouton si url === null.
    const valid=[...linked,...webOffers,...indexedOnly].slice(0,10);
    const status=valid.length?(linked.length?'ok':webOffers.length?'web_fallback':'indexed_without_direct_links'):items.length?'all_filtered':'empty_results';
    attempts.push({endpoint:endpoint.name,status});
    return {offers:valid,status,received:items.length,rejected:Math.max(0,items.length-linked.length-indexedOnly.length),directCount:linked.length+webOffers.length,indexedCount:indexedOnly.length,rejectionReasons,attempts};
  }
  return {offers:[],status:'shopping_endpoints_unavailable',received:0,rejected:0,attempts};
}
const shoppingMessages={
  shopping_endpoints_unavailable:'Les deux accès Shopping documentés sont introuvables (HTTP 404/405). Vérifiez l’accès aux endpoints auprès du fournisseur.',
  disabled_optional:'SerperMatrix est facultatif et désactivé : utilisation des autres moteurs.',
  missing_key:'Clé SerperMatrix absente ; utilisation des autres moteurs.',
  invalid_key:'SerperMatrix refuse la clé API (HTTP 401). Vérifiez sa validité et l’absence d’espaces superflus.',
  insufficient_credits:'SerperMatrix indique des crédits insuffisants (HTTP 402). Vérifiez le solde du compte.',
  rate_limited:'SerperMatrix limite les requêtes (HTTP 429). Réessayez plus tard.',
  bad_request:'SerperMatrix refuse les paramètres de recherche (HTTP 400).',
  forbidden:'SerperMatrix refuse l’accès (HTTP 403). Vérifiez les autorisations de la clé.',
  timeout:'SerperMatrix n’a pas répondu avant le délai maximal.',
  network_error:'Le serveur Vercel ne parvient pas à joindre SerperMatrix.',
  invalid_json:'SerperMatrix a renvoyé une réponse non interprétable.',
  all_filtered:'Les annonces reçues ne disposent pas des données minimales exploitables.',
  indexed_without_direct_links:'Produits et prix trouvés, mais aucun lien marchand direct confirmé. Ces annonces sont affichées sans lien inventé.',
  web_fallback:'Les liens marchands directs proviennent de la recherche web complémentaire ; leurs prix ne sont pas vérifiés.',
  empty_results:'SerperMatrix a répondu sans fiche shopping pour cette recherche.',
  provider_error:'Le service de recherche connaît une erreur temporaire.'
};
async function brave(query){const key=process.env.BRAVE_SEARCH_API_KEY;if(!key)return [];try{const u='https://api.search.brave.com/res/v1/web/search?q='+encodeURIComponent(query+' acheter prix')+'&country=fr&search_lang=fr&count=15';const r=await timeoutFetch(u,{headers:{'Accept':'application/json','X-Subscription-Token':key}},10000);if(!r.ok)return [];const d=await r.json();const t=new Date().toISOString();return (d.web?.results||[]).map(x=>offer({title:x.title,url:x.url,source:host(x.url),price:null},'Web (prix non disponible)',t)).filter(Boolean).slice(0,8)}catch{return []}}
async function groqWebCandidates(query){
if(!process.env.GROQ_API_KEY)return [];
try{const r=await timeoutFetch('https://api.groq.com/openai/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+process.env.GROQ_API_KEY},body:JSON.stringify({model:process.env.GROQ_SEARCH_MODEL||'compound-beta',max_tokens:950,messages:[{role:'user',content:'Recherche sur le web des fiches PRODUITS DIRECTES et réellement trouvées chez tous les marchands français sauf Rakuten et AliExpress pour: '+query+'. Jamais de page de résultats, jamais d’URL imaginée. Retourne uniquement JSON {"products":[{"name":"marque modèle exact","url":"https://lien-direct-observé","store":"marchand"}]}. N’indique aucun prix car le système vérifie les prix indépendamment.'}]})},13000);if(!r.ok)return [];const d=await r.json();const x=parseJSON(d.choices?.[0]?.message?.content);return (Array.isArray(x?.products)?x.products:[]).map(p=>offer(p,'Recherche IA (prix indisponible)',null)).filter(Boolean).slice(0,6)}catch{return []}}
// Recherche augmentée par Claude : les URLs et prix doivent provenir d'une recherche web
// réellement exécutée. Aucun prix inventé par le modèle n'est présenté.
// Moteur indépendant : Claude effectue AU MAXIMUM une recherche Web payante.
async function claudeProductCandidates(query){
 if(!process.env.ANTHROPIC_API_KEY)return {offers:[],status:'missing_key',attempts:[]};
 if(process.env.ENABLE_CLAUDE_RESEARCH==='false')return {offers:[],status:'disabled',attempts:[]};
 try{
  const prompt='Effectue une recherche web réelle sur des fiches PRODUIT françaises pertinentes pour : '+query+'. Explore plusieurs marchands sans condition d’affiliation, sauf Rakuten et AliExpress. Retourne uniquement JSON {"products":[{"name":"produit marque et référence","store":"marchand","url":"https://fiche-marchand","price":"prix explicite en EUR ou null"}]}. N’invente aucun lien ni prix, et utilise les URL visibles dans les résultats de ta recherche. Jusqu’à 8 produits.';
  const resp=await timeoutFetch('https://api.anthropic.com/v1/messages',{
   method:'POST',headers:{'Content-Type':'application/json','x-api-key':process.env.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01'},
   body:JSON.stringify({model:process.env.CLAUDE_MODEL||'claude-haiku-4-5',max_tokens:1600,tools:[{type:'web_search_20250305',name:'web_search',max_uses:1}],system:'Recherche les produits sur le web. Ne fabrique aucun prix ni URL. Réponds en JSON uniquement.',messages:[{role:'user',content:prompt}]})
  },22000);
  const data=await resp.json().catch(()=>({}));
  if(!resp.ok)return {offers:[],status:'http_'+resp.status,attempts:[{source:'claude',status:'http_'+resp.status}]};
  const sources=new Set();
  function scan(node,depth=0){
   if(!node||typeof node!=='object'||depth>10)return;
   if(Array.isArray(node)){node.forEach(v=>scan(v,depth+1));return}
   if(typeof node.url==='string'&&node.url.startsWith('https://'))sources.add(node.url);
   for(const k of ['citations','content','results','sources','data'])if(node[k])scan(node[k],depth+1);
  }
  for(const part of data.content||[])scan(part);
  const raw=(data.content||[]).filter(x=>x.type==='text').map(x=>x.text||'').join('\n');
  const products=parseJSON(raw)?.products||[];
  const results=[],used=new Set();let rejected=0;
  for(const p of Array.isArray(products)?products.slice(0,12):[]){
   const url=actualProductUrl(p.url);
   if(!url||!sources.has(p.url)){rejected++;continue}
   const o=offer({title:p.name,link:url,store:p.store,price:p.price},'Claude Web Search, URL citée (prix non confirmé)',new Date().toISOString());
   if(!o||used.has(o.url)){rejected++;continue}
   used.add(o.url);results.push(o);
  }
  // Si l'IA n'a pas produit un JSON exploitable, inspecter directement les pages
  // marchandes découvertes par la recherche web pour leurs prix structurés.
  if(!results.length){
   for(const url of [...sources].slice(0,10)){
    if(!safeMerchantFetchUrl(url))continue;
    const page=await merchantProductEvidence(url,query);
    if(page&&!used.has(page.url)){used.add(page.url);results.push(page)}
    if(results.length>=5)break;
   }
  }
  return {offers:results,status:results.length?'ok':'no_grounded_offers',attempts:[{source:'claude_web',status:results.length?'ok':'no_grounded_offers'}],evidenceCount:sources.size,rejected};
 }catch(e){return {offers:[],status:e?.name==='AbortError'?'timeout':'network_error',attempts:[{source:'claude_web',status:e?.name==='AbortError'?'timeout':'network_error'}]}}
}
async function merchantProductEvidence(url,query){
 const link=safeMerchantFetchUrl(url);if(!link)return null;
 try{
  const r=await timeoutFetch(link,{headers:{Accept:'text/html'},redirect:'manual'},4500);
  if(!r.ok||!/text\/html/i.test(r.headers.get('content-type')||''))return null;
  const html=(await r.text()).slice(0,500000);
  const pattern=/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while((m=pattern.exec(html))){
   let root;try{root=JSON.parse(m[1])}catch{continue}
   const queue=[root];let n=0;
   while(queue.length&&n++<60){
    const x=queue.shift();if(!x||typeof x!=='object')continue;
    if(Array.isArray(x)){queue.push(...x.slice(0,20));continue}
    if(x['@graph'])queue.push(x['@graph']);
    if(!String(x['@type']||'').includes('Product'))continue;
    const name=String(x.name||'').slice(0,180);if(name.length<8)continue;
    const modelTokens=productTokens(query).filter(v=>/[a-z]/.test(v)&&/\d/.test(v));
    if(modelTokens.length&&!modelTokens.every(v=>productTokens(name).includes(v)))continue;
    const offers=Array.isArray(x.offers)?x.offers:[x.offers];
    let price=null;
    for(const o of offers){if(!o||String(o.priceCurrency||'').toUpperCase()!=='EUR')continue;const v=o.price??o.priceSpecification?.price;price=amount(typeof v==='number'?v:String(v)+' EUR');if(price!==null)break}
    const result=offer({title:name,link,price,store:host(link)},'Données Product/Offer du marchand',new Date().toISOString());
    if(result)return result;
   }
  }
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

async function recoverMerchantLinksFromSearch(indexed){
 const key=process.env.ENABLE_SERPERMATRIX_SEARCH==='true'?process.env.SERPERMATRIX_API_KEY?.trim():null;
 const found=[],attempts=[];
 if(!key)return {offers:found,attempts};
 const shortlist=[];const seenStore=new Set();
 for(const offer of indexed){
  if(offer.directProductLink||offer.price===null||!offer.store||offer.store==='Marchand non précisé')continue;
  const fingerprint=offer.store.toLowerCase()+'|'+productTokens(offer.name).slice(0,4).join('-');
  if(seenStore.has(fingerprint))continue;
  seenStore.add(fingerprint);shortlist.push(offer);
  if(shortlist.length>=3)break;
 }
 for(const target of shortlist){
  try{
   const title=target.name.replace(/["']/g,' ').slice(0,110);
   const r=await timeoutFetch('https://serpermatrix.com/api/v1/search',{
    method:'POST',headers:{'Content-Type':'application/json','X-API-KEY':key},
    body:JSON.stringify({query:'"'+title+'" '+target.store+' acheter',sources:['web'],limit:10,country:'fr',lang:'fr',use_cache:true})
   },8500);
   if(!r.ok){attempts.push({status:'http_'+r.status});continue}
   const data=await r.json().catch(()=>({}));
   const items=[data?.data?.web,data?.web,data?.results?.web].find(Array.isArray)||[];
   let matched=false;
   for(const w of items){
    const url=actualProductUrl(w.url||w.link);
    if(!url||!productMatch(target.name,w.title||''))continue;
    const domain=host(url)||'';
    const stem=domain.replace(/^www\./,'').split('.')[0];
    if(!sameMerchant(target.store,stem))continue;
    const result={...target,url,directProductLink:true,id:'p-'+hash(url),priceStatus:'matched_shopping_index',priceSource:target.priceSource+' (fiche web rapprochée par marchand et modèle)',rating:target.rating,reviewCount:target.reviewCount};
    found.push(result);matched=true;break;
   }
   attempts.push({status:matched?'matched':'no_same_merchant_model_match'});
  }catch(e){attempts.push({status:e?.name==='AbortError'?'timeout':'network_error'})}
 }
 return {offers:found,attempts};
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
  const shop=await shopping(query);
  let offers=[...shop.offers],source='web_independent';
  const seen=new Set(offers.map(o=>o.url||o.id));
  const addMore=items=>{for(const o of items||[]){const id=o.url||o.id;if(id&&!seen.has(id)){seen.add(id);offers.push(o)}}};
  // Brave est indépendant de SerperMatrix, uniquement s'il est configuré.
  const braveOffers=await brave(query);
  addMore(braveOffers);
  if(braveOffers.length)source='brave_web';
  let claudeResearch={status:'not_needed',attempts:[]};
  // Claude n'utilise les crédits Anthropic que si les offres complètes sont insuffisantes.
  if(offers.filter(pricedDirect).length<5&&process.env.ENABLE_CLAUDE_RESEARCH!=='false'&&process.env.ANTHROPIC_API_KEY){
   claudeResearch=await claudeProductCandidates(query);
   addMore(claudeResearch.offers);
   source=braveOffers.length?'brave+claude':'claude_web';
  }
  let recovered={offers:[],attempts:[]};
  if(process.env.ENABLE_SERPERMATRIX_SEARCH==='true'&&shop.status==='ok'){
   recovered=await recoverMerchantLinksFromSearch(offers.filter(o=>!o.directProductLink&&o.price!==null));
   addMore(recovered.offers);
  }
  const completion=await completeOffers(offers,query);
  const valid=completion.offers;
  const reply=valid.length
   ?'Voici '+valid.length+' offre(s) avec prix et fiche marchand directe. Les prix sont sourcés mais à confirmer chez le marchand.'
   :'Aucune offre avec prix ET lien marchand ne peut encore être confirmée. Recherche web indépendante : '+source+'. Aucun prix ni URL inventé.';
  return respond({phase:'results',reply,sessionId:sid,offers:valid,search:{query,criteria:approved.criteria.slice(0,8),source,shoppingDiagnostic:{status:shop.status,received:shop.received,rejected:shop.rejected,attempts:shop.attempts||[],detail:shoppingMessages[shop.status]||shop.status},completionDiagnostic:{...completion.diagnostic,merchantRecovery:recovered.attempts},pricedCount:valid.length,claudeResearch:{status:claudeResearch.status,attempts:claudeResearch.attempts,evidenceCount:claudeResearch.evidenceCount||0,rejected:claudeResearch.rejected||0},observedAt:new Date().toISOString()}})
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
