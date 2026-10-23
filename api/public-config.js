export const config = { runtime: 'edge' };
export default function handler() {
 const id=String(process.env.GA4_MEASUREMENT_ID||'').trim();
 const url=String(process.env.SUPABASE_URL||'').trim();
 const publicKey=String(process.env.SUPABASE_PUBLISHABLE_KEY||process.env.SUPABASE_ANON_KEY||'').trim();
 const validUrl=/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url);
 const validKey=/^(sb_publishable_[A-Za-z0-9_-]+|eyJ[A-Za-z0-9_.-]+)$/.test(publicKey);
 return new Response(JSON.stringify({
  ga4MeasurementId:/^G-[A-Z0-9]{5,20}$/.test(id)?id:null,
  supabaseUrl:validUrl?url:null,
  supabasePublishableKey:validUrl&&validKey?publicKey:null
 }),{headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
}
