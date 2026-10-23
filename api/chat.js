export const config = { runtime: 'edge' };
// Huntify V4 : L'IA comprend le besoin, les données de recherche fournissent les faits.
// Aucun lien ou prix fabriqué, aucune préférence pour les affiliés.
const BLOCKED = /(^|\.)(rakuten\.(com|fr)|aliexpress\.(com|fr)|aliexpress\.us)$/i;
const MAX_TURNS = 2;
const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
const respond = (data, code=200) => new Response(JSON.stringify(data), {status:code,headers});
const timeoutFetch = async (url, options={}, ms=11000) => {const c=new AbortController(), timer=setTimeout(()=>c.abort(),ms);try{return await fetch(url,{...options,signal:c.signal})}finally{clearTimeout(timer)}};
function parseJSON(s){if(!s)return null;try{return JSON.parse(s)}catch{} const match=String(s).match(/\{[\s\S]*\}/);if(!match)return null;try{return JSON.parse(match[0])}catch{return null}}
function host(url){try{const u=new URL(url);return u.protocol==='https:'&&!u.username&&!u.password&&!BLOCKED.test(u.hostname)?u.hostname.toLowerCase():null}catch{return null}}
function actualProductUrl(url){const h=host(url);if(!h)return null;const u=new URL(url);if(/(^|\.)google\.|(^|\.)bing\.|(^|\.)awin1\.|(^|\.)awin\./i.test(h))return null;if(/(^|\.)amazon\./i.test(h)&&!(/\/(dp|gp\/product)\/[A-Z0-9]{10}/i.test(u.pathname)))return null;if(/\/(search|searchresults|s\/|wholesale|catalogsearch|recherche)(\/|$)/i.test(u.pathname))return null;if(u.searchParams.has('q')&&u.pathname==='/')return null;return u.href}
function amount(raw){if(typeof raw==='number')return Number.isFinite(raw)&&raw>0?raw:null;let s=String(raw||'').replace(/\s/g,'');if(!/[€]|EUR/i.test(String(raw||'')))return null;let n=s.match(/\d[\d.,]*/)?.[0];if(!n)return null;const comma=n.lastIndexOf(','),dot=n.lastIndexOf('.');if(comma>dot)n=n.replace(/\./g,'').replace(',','.');else n=n.replace(/,/g,'');const v=Number(n);return Number.isFinite(v)&&v>0&&v<1000000?v:null}
function offer(o,source,observedAt){const link=actualProductUrl(o.link||o.url||o.product_url||o.productLink);if(!link)return null;const name=String(o.title||o.name||'').trim().slice(0,200);if(name.length<9||name.split(' ').length<2)return null;const price=amount(o.price);const store=String(o.source||o.store||host(link)||'Boutique').slice(0,70);return {id:'p-'+hash(link),name,store,price,priceLabel:price!==null?price.toLocaleString('fr-FR',{style:'currency',currency:'EUR'}):'Prix indisponible',currency:'EUR',url:link,directProductLink:true,priceVerified:false,priceSource:source,priceObservedAt:price===null?null:observedAt,priceStatus:price===null?'unavailable':'indexed',image:typeof o.imageUrl==='string'&&host(o.imageUrl)?o.imageUrl:null,affiliate:false};}
function hash(s){let h=2166136261;for(let i=0;i<s.length;i++)h=Math.imul(h^s.charCodeAt(i),16777619);return (h>>>0).toString(36)}
async function llm(sys, user, max=400){const msg=[{role:'system',content:sys},{role:'user',content:user}];const calls=[];
if(process.env.GROQ_API_KEY)calls.push(['https://api.groq.com/openai/v1/chat/completions',{model:process.env.GROQ_MODEL||'llama-3.3-70b-versatile',max_tokens:max,messages:msg},{Authorization:'Bearer '+process.env.GROQ_API_KEY}]);
if(process.env.MISTRAL_API_KEY)calls.push(['https://api.mistral.ai/v1/chat/completions',{model:process.env.MISTRAL_MODEL||'mistral-small-latest',max_tokens:max,messages:msg},{Authorization:'Bearer '+process.env.MISTRAL_API_KEY}]);
if(process.env.DEEPSEEK_API_KEY)calls.push(['https://api.deepseek.com/chat/completions',{model:process.env.DEEPSEEK_MODEL||'deepseek-chat',max_tokens:max,messages:msg},{Authorization:'Bearer '+process.env.DEEPSEEK_API_KEY}]);
if(process.env.ENABLE_OPENAI_FALLBACK==='true'&&process.env.OPENAI_API_KEY)calls.push(['https://api.openai.com/v1/chat/completions',{model:process.env.OPENAI_MODEL||'gpt-4.1-mini',max_completion_tokens:max,messages:msg},{Authorization:'Bearer '+process.env.OPENAI_API_KEY}]);
for(const [url,body,h] of calls){try{const r=await timeoutFetch(url,{method:'POST',headers:{'Content-Type':'application/json',...h},body:JSON.stringify(body)},8500);if(!r.ok)continue;const d=await r.json();if(d.choices?.[0]?.message?.content)return d.choices[0].message.content}catch{}}
if(process.env.GEMINI_API_KEY){try{const m=process.env.GEMINI_MODEL||'gemini-2.0-flash';const r=await timeoutFetch('https://generativelanguage.googleapis.com/v1beta/models/'+encodeURIComponent(m)+':generateContent?key='+encodeURIComponent(process.env.GEMINI_API_KEY),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({contents:[{parts:[{text:sys+'\n'+user}]}],generationConfig:{maxOutputTokens:max}})},8500);if(r.ok){const d=await r.json();return d.candidates?.[0]?.content?.parts?.map(p=>p.text||'').join('')||null}}catch{}}
return null}
async function shopping(query){
  // Retourne un diagnostic sans clé, sans réponse brute du fournisseur et sans donnée privée.
  const key=process.env.SERPERMATRIX_API_KEY?.trim();
  if(!key)return {offers:[],status:'missing_key',received:0,rejected:0};
  try{
    const r=await timeoutFetch('https://serpermatrix.com/api/v1/shopping',{
      method:'POST',headers:{'Content-Type':'application/json','X-API-KEY':key},
      body:JSON.stringify({q:query,gl:'fr',hl:'fr',num:18,use_cache:true})
    },16000);
    if(!r.ok){
      const codes={400:'bad_request',401:'invalid_key',402:'insufficient_credits',403:'forbidden',429:'rate_limited',500:'provider_error',502:'provider_error',503:'provider_error'};
      return {offers:[],status:codes[r.status]||'http_'+r.status,received:0,rejected:0};
    }
    let d;
    try{d=await r.json()}catch{return {offers:[],status:'invalid_json',received:0,rejected:0}}
    // L'endpoint documenté renvoie shopping au niveau racine ; ne pas confondre avec /search.
    const items=Array.isArray(d.shopping)?d.shopping:(Array.isArray(d.data?.shopping)?d.data.shopping:[]);
    const seen=new Set(),t=new Date().toISOString();
    const valid=items.map(x=>offer(x,'Shopping (index marchand)',t)).filter(x=>x&&!seen.has(x.url)&&seen.add(x.url)).slice(0,10);
    return {offers:valid,status:valid.length?'ok':items.length?'all_filtered':'empty_results',received:items.length,rejected:Math.max(0,items.length-valid.length)};
  }catch(e){return {offers:[],status:e?.name==='AbortError'?'timeout':'network_error',received:0,rejected:0}}
}
const shoppingMessages={
  missing_key:'La variable SERPERMATRIX_API_KEY est absente de ce déploiement Vercel. Vérifiez son environnement Preview/Production et redéployez.',
  invalid_key:'SerperMatrix refuse la clé API (HTTP 401). Vérifiez sa validité et l’absence d’espaces superflus.',
  insufficient_credits:'SerperMatrix indique des crédits insuffisants (HTTP 402). Vérifiez le solde du compte.',
  rate_limited:'SerperMatrix limite les requêtes (HTTP 429). Réessayez plus tard.',
  bad_request:'SerperMatrix refuse les paramètres de recherche (HTTP 400).',
  forbidden:'SerperMatrix refuse l’accès (HTTP 403). Vérifiez les autorisations de la clé.',
  timeout:'SerperMatrix n’a pas répondu avant le délai maximal.',
  network_error:'Le serveur Vercel ne parvient pas à joindre SerperMatrix.',
  invalid_json:'SerperMatrix a renvoyé une réponse non interprétable.',
  all_filtered:'SerperMatrix a répondu, mais aucun de ses résultats ne répond aux règles de fiches produits directes.',
  empty_results:'SerperMatrix a répondu sans fiche shopping pour cette recherche.',
  provider_error:'Le service de recherche connaît une erreur temporaire.'
};
async function brave(query){const key=process.env.BRAVE_SEARCH_API_KEY;if(!key)return [];try{const u='https://api.search.brave.com/res/v1/web/search?q='+encodeURIComponent(query+' acheter prix')+'&country=fr&search_lang=fr&count=15';const r=await timeoutFetch(u,{headers:{'Accept':'application/json','X-Subscription-Token':key}},10000);if(!r.ok)return [];const d=await r.json();const t=new Date().toISOString();return (d.web?.results||[]).map(x=>offer({title:x.title,url:x.url,source:host(x.url),price:null},'Web (prix non disponible)',t)).filter(Boolean).slice(0,8)}catch{return []}}
async function groqWebCandidates(query){
if(!process.env.GROQ_API_KEY)return [];
try{const r=await timeoutFetch('https://api.groq.com/openai/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+process.env.GROQ_API_KEY},body:JSON.stringify({model:process.env.GROQ_SEARCH_MODEL||'compound-beta',max_tokens:950,messages:[{role:'user',content:'Recherche sur le web des fiches PRODUITS DIRECTES et réellement trouvées chez tous les marchands français sauf Rakuten et AliExpress pour: '+query+'. Jamais de page de résultats, jamais d’URL imaginée. Retourne uniquement JSON {"products":[{"name":"marque modèle exact","url":"https://lien-direct-observé","store":"marchand"}]}. N’indique aucun prix car le système vérifie les prix indépendamment.'}]})},13000);if(!r.ok)return [];const d=await r.json();const x=parseJSON(d.choices?.[0]?.message?.content);return (Array.isArray(x?.products)?x.products:[]).map(p=>offer(p,'Recherche IA (prix indisponible)',null)).filter(Boolean).slice(0,6)}catch{return []}}
async function claudeProductCandidates(query){if(!process.env.ANTHROPIC_API_KEY)return [];try{const r=await timeoutFetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'Content-Type':'application/json','x-api-key':process.env.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01'},body:JSON.stringify({model:process.env.CLAUDE_MODEL||'claude-haiku-4-5',max_tokens:700,tools:[{type:'web_search_20250305',name:'web_search',max_uses:2}],system:'Expert shopping : trouve des fiches produits réelles sur tous sites marchands hors Rakuten et AliExpress. N’invente ni URLs ni prix. Retourne du JSON uniquement {"products":[{"name":"nom complet","url":"https://.../fiche-produit","store":"boutique"}]}. Pas de résultats de recherche.',messages:[{role:'user',content:query}]})},14000);if(!r.ok)return [];const d=await r.json();const p=parseJSON((d.content||[]).filter(x=>x.type==='text').map(x=>x.text).join(''));return (p?.products||[]).map(x=>offer(x,'IA + recherche (prix indisponible)',null)).filter(Boolean)}catch{return []}}
export default async function handler(req){if(req.method!=='POST')return respond({error:'POST requis'},405);let body;try{body=await req.json()}catch{return respond({error:'JSON invalide'},400)}
const message=String(body.message||'').trim().slice(0,1500);if(!message)return respond({error:'Demande vide'},400);const history=Array.isArray(body.history)?body.history.slice(-10).map(x=>({role:x.role==='user'?'user':'assistant',content:String(x.content||'').slice(0,500)})):[];const sid=String(body.sessionId||'').slice(0,100)||crypto.randomUUID();const previousQuestions=history.filter(x=>x.role==='assistant'&&x.content.trim().endsWith('?')).length;const transcript=history.map(x=>x.role+': '+x.content).join('\n');
const sys='Tu es Huntify, expert indépendant en intention d’achat et en comparaison de PRODUITS. Ton travail est de comprendre le besoin réel, budget, usage et contraintes et choisir si UNE question est indispensable. Les vendeurs affiliés n’ont aucune priorité. Exclure Rakuten et AliExpress. Ne pose pas de question facultative; n’en répète aucune. Si le besoin est assez clair, lance la recherche. Réponds UNIQUEMENT en JSON: {"ready":true,"query":"mots-clés de vrais produits adaptés","reason":"intention d’achat en une phrase","criteria":["critère"],"comparisonAdvice":"conseil bref"} OU {"ready":false,"question":"une seule question essentielle"}. Ne cite jamais prix ni produit inventé.';
let decision=parseJSON(await llm(sys,'Historique:\n'+transcript+'\nDemande actuelle: '+message,430))||{};
if(decision.ready===false&&decision.question&&previousQuestions<MAX_TURNS){return respond({reply:String(decision.question).slice(0,280),needsClarification:true,offers:[],sessionId:sid})}
const query=String(decision.query||message).slice(0,180);const shop=await shopping(query);let offers=shop.offers;let source='shopping';if(!offers.length){offers=await brave(query);source='web'}if(!offers.length){offers=await groqWebCandidates(query);source='groq'}if(!offers.length&&process.env.ENABLE_CLAUDE_RESEARCH==='true'){offers=await claudeProductCandidates(query);source='claude'}
// Les prix ne sont jamais synthétisés par les IA. Les prix indexés ne sont pas des prix vérifiés chez le marchand.
const priced=offers.filter(o=>o.price!==null).length;const reply=offers.length?(priced?`J’ai trouvé ${offers.length} fiches produits, dont ${priced} avec un prix relevé dans un index shopping. Les prix et stocks restent à confirmer sur les fiches marchands.`:`J’ai trouvé ${offers.length} fiches produits. Je ne dispose pas de prix observés fiables : je les laisse indisponibles plutôt que de les inventer.`):'Je n’ai pas trouvé d’offre exploitable. Diagnostic de la source de prix : '+(shoppingMessages[shop.status]||'HTTP/API : '+shop.status)+ ' Aucun prix fictif ne sera affiché.';
return respond({reply,sessionId:sid,offers,search:{query,intent:String(decision.reason||'').slice(0,250),criteria:Array.isArray(decision.criteria)?decision.criteria.slice(0,6):[],comparisonAdvice:String(decision.comparisonAdvice||'').slice(0,300),source,shoppingDiagnostic:{status:shop.status,received:shop.received,rejected:shop.rejected,detail:shoppingMessages[shop.status]||null},pricedCount:priced,observedAt:new Date().toISOString()}})}
