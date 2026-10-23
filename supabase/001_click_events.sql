-- Execute in Supabase SQL editor in the project for Huntify.
-- Anonymous clients never write directly; the Vercel /api/click endpoint uses the server-side service role.
create table if not exists public.huntify_click_events (
 id bigint generated always as identity primary key,
 session_id text, product text, store text, dest_url text,
 event_type text not null default 'outbound_product_click',
 clicked_at timestamptz not null default now()
);
create index if not exists huntify_click_events_clicked_at_idx on public.huntify_click_events(clicked_at desc);
alter table public.huntify_click_events enable row level security;
revoke all on public.huntify_click_events from anon, authenticated;
-- Service-role writes bypass RLS. Set a retention policy appropriate for your privacy notice.
