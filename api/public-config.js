export const config = { runtime: 'edge' };
export default function handler() {
  const id = String(process.env.GA4_MEASUREMENT_ID || '').trim();
  return new Response(JSON.stringify({ ga4MeasurementId: /^G-[A-Z0-9]{5,20}$/.test(id) ? id : null }),
    {headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
}
