export const config = { runtime: 'edge' };
const json=(x,status=200)=>new Response(JSON.stringify(x),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
const forbidden=/(^|\.)(rakuten\.(com|fr)|aliexpress\.(com|fr)|aliexpress\.us)$/i;
export default async function handler(req){
 if(req.method!=='POST')return json({error:'method_not_allowed'},405);
 // Same-origin browsers only; the endpoint does not act as a redirect.
 const origin=req.headers.get('origin');
 if(origin && origin!==new URL(req.url).origin)return json({error:'origin_mismatch'},403);
 let data;try{data=await req.json()}catch{return json({error:'bad_json'},400)}
 const dest=String(data.url||'').slice(0,1500);
 let u;try{u=new URL(dest);if(u.protocol!=='https:'||u.username||u.password||forbidden.test(u.hostname))throw Error()}catch{return json({error:'invalid_url'},400)}
 const sbUrl=process.env.SUPABASE_URL;
 const sbKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!sbUrl||!sbKey)return json({stored:false,reason:'supabase_tracking_not_configured'},503);
 const body={session_id:String(data.sessionId||'').slice(0,100), product:String(data.product||'').slice(0,180),store:String(data.store||u.hostname).slice(0,90),dest_url:dest,event_type:'outbound_product_click',clicked_at:new Date().toISOString()};
 try{const r=await fetch(sbUrl.replace(/\/$/,'')+'/rest/v1/huntify_click_events',{
 method:'POST',headers:{'Content-Type':'application/json','apikey':sbKey,'Authorization':'Bearer '+sbKey,'Prefer':'return=minimal'},body:JSON.stringify(body)});
 if(!r.ok)return json({stored:false,reason:'database_error'},503);
 return json({stored:true});
 }catch{return json({stored:false,reason:'network_error'},503)}
}
