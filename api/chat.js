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
function offer(o,source,observedAt){const link=actualProductUrl(o.link||o.url||o.product_url||o.productLink);if(!link)return null;const name=String(o.title||o.name||'').trim().slice(0,200);if(name.length<9||name.split(' ').length<2)return null;const price=amount(o.price);const store=String(o.source||o.store||host(link)||'Boutique').slice(0,70);return {id:'p-'+hash(link),name,store,price,priceLabel:price!==null?price.toLocaleString('fr-FR',{style:'currency',currency:'EUR'}):'Prix indisponible',currency:'EUR',url:link,directProductLink:true,priceVerified:false,priceSource:source,priceObservedAt:price===null?null:observedAt,priceStatus:price===null?'unavailable':'indexed',image:typeof o.imageUrl==='string'&&host(o.imageUrl)?o.imageUrl:null,affiliate:false};}
function hash(s){let h=2166136261;for(let i=0;i<s.length;i++)h=Math.imul(h^s.charCodeAt(i),16777619);return (h>>>0).toString(36)}
// Orchestration du conseil : OpenAI d'abord (si activé), Gemini puis Groq en secours.
// Un fournisseur est appelé après l'autre ; aucun appel Anthropic sans consentement explicite.
async function llm(sys, user, max=400){
 const msg=[{role:'system',content:sys},{role:'user',content:user}];
 const attempts=[];
 const providers=[];
 const enabled=Boolean(process.env.OPENAI_API_KEY)&&process.env.ENABLE_OPENAI_ADVISOR!=='false';
 if(enabled&&process.env.OPENAI_API_KEY)providers.push('openai');
 if(process.env.GEMINI_API_KEY)providers.push('gemini');
 if(process.env.GROQ_API_KEY)providers.push('groq');
 if(process.env.ENABLE_PAID_ADVISOR_FALLBACK==='true'&&process.env.ANTHROPIC_API_KEY)providers.push('claude');
 for(const provider of providers){
   try{
     let url,options;
     if(provider==='openai'){
       url='https://api.openai.com/v1/chat/completions';
       options={method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+process.env.OPENAI_API_KEY},body:JSON.stringify({model:process.env.OPENAI_MODEL||'gpt-4.1-mini',messages:msg,max_completion_tokens:Math.min(max,500),temperature:0.2})};
     }else if(provider==='gemini'){
       const model=process.env.GEMINI_MODEL||'gemini-2.5-flash';
       url='https://generativelanguage.googleapis.com/v1beta/models/'+encodeURIComponent(model)+':generateContent';
       options={method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':process.env.GEMINI_API_KEY},body:JSON.stringify({contents:[{parts:[{text:sys+'\n'+user}]}],generationConfig:{maxOutputTokens:Math.min(max,500)}})};
     }else if(provider==='groq'){
       url='https://api.groq.com/openai/v1/chat/completions';
       options={method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+process.env.GROQ_API_KEY},body:JSON.stringify({model:process.env.GROQ_MODEL||'llama-3.3-70b-versatile',messages:msg,max_tokens:Math.min(max,500)})};
     }else{
       url='https://api.anthropic.com/v1/messages';
       options={method:'POST',headers:{'Content-Type':'application/json','x-api-key':process.env.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01'},body:JSON.stringify({model:process.env.CLAUDE_MODEL||'claude-haiku-4-5',max_tokens:Math.min(max,500),system:sys,messages:[{role:'user',content:user}]})};
     }
     const r=await timeoutFetch(url,options,11000);
     if(!r.ok){attempts.push({provider,status:'http_'+r.status});continue;}
     const data=await r.json();
     const text=provider==='gemini'?(data.candidates?.[0]?.content?.parts||[]).map(p=>p.text||'').join(''):provider==='claude'?(data.content||[]).filter(p=>p.type==='text').map(p=>p.text||'').join(''):data.choices?.[0]?.message?.content;
     if(text&&String(text).trim())return {text:String(text),provider,attempts};
     attempts.push({provider,status:'empty_response'});
   }catch(e){attempts.push({provider,status:e?.name==='AbortError'?'timeout':'network_error'});}
 }
 return {text:null,provider:null,attempts,configured:providers,openaiEnabled:enabled,paidFallbackEnabled:process.env.ENABLE_PAID_ADVISOR_FALLBACK==='true'};
}
async function shopping(query){
  // Deux voies publiées par le fournisseur : Shopping spécialisé, puis Search multi-sources.
  // Ne jamais transmettre la clé ou les réponses brutes au navigateur.
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
    const seen=new Set(),t=new Date().toISOString();
    const valid=items.map(x=>offer(x,'Shopping (index marchand)',t)).filter(x=>x&&!seen.has(x.url)&&seen.add(x.url)).slice(0,10);
    const status=valid.length?'ok':items.length?'all_filtered':'empty_results';
    attempts.push({endpoint:endpoint.name,status});
    return {offers:valid,status,received:items.length,rejected:Math.max(0,items.length-valid.length),attempts};
  }
  return {offers:[],status:'shopping_endpoints_unavailable',received:0,rejected:0,attempts};
}
const shoppingMessages={
  shopping_endpoints_unavailable:'Les deux accès Shopping documentés sont introuvables (HTTP 404/405). Vérifiez l’accès aux endpoints auprès du fournisseur.',
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
// Contrat conversationnel V6 : aucune recherche sans action explicite « search ».
// L'IA choisit les questions; seules les limites d'usage sont déterministes.
export default async function handler(req){
 if(req.method!=='POST')return respond({error:'POST requis'},405);
 let body;try{body=await req.json()}catch{return respond({error:'JSON invalide'},400)}
 const message=String(body.message||'').trim().slice(0,1500);
 const action=body.action==='search'?'search':'consult';
 const sid=String(body.sessionId||'').slice(0,100)||crypto.randomUUID();
 const history=Array.isArray(body.history)?body.history.slice(-14).map(x=>({role:x.role==='user'?'user':'assistant',content:String(x.content||'').slice(0,500)})):[];
 if(action==='search'){
  const approved=body.approvedBrief;
  if(!approved||typeof approved!=='object'||!Array.isArray(approved.criteria)||!String(approved.query||'').trim())return respond({error:'Critères non validés',reply:'Validez d’abord les critères avec l’assistant.'},400);
  const query=String(approved.query).slice(0,180);
  const shop=await shopping(query);
  let offers=shop.offers, source='shopping';
  if(!offers.length){offers=await brave(query);source='web'}
  if(!offers.length&&process.env.ENABLE_GROQ_WEB_SEARCH==='true'){offers=await groqWebCandidates(query);source='groq'}
  if(!offers.length&&process.env.ENABLE_CLAUDE_RESEARCH==='true'){offers=await claudeProductCandidates(query);source='claude'}
  const priced=offers.filter(o=>o.price!==null).length;
  const reply=offers.length?(priced?`Voici ${offers.length} fiches produits, dont ${priced} avec un prix relevé par une source Shopping. Les prix restent à confirmer chez le marchand.`:`Voici ${offers.length} fiches produits. Aucun prix suffisamment sourcé : ils ne seront pas inventés.`):'Recherche terminée : aucune fiche produit exploitable. Source prix : '+(shoppingMessages[shop.status]||shop.status)+'.';
  return respond({phase:'results',reply,sessionId:sid,offers,search:{query,criteria:approved.criteria.slice(0,8),source,shoppingDiagnostic:{status:shop.status,received:shop.received,rejected:shop.rejected,attempts:shop.attempts,detail:shoppingMessages[shop.status]||null},pricedCount:priced,observedAt:new Date().toISOString()}})
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
