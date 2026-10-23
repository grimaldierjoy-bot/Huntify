-- Huntify: comptes sans mot de passe via Supabase Auth.
-- Exécuter cette migration dans Supabase SQL Editor AVANT de déployer l'interface de synchronisation.
create table if not exists public.huntify_favorites (
  user_id uuid not null references auth.users(id) on delete cascade,
  offer_key text not null check (char_length(offer_key) between 1 and 700),
  offer jsonb not null,
  updated_at timestamptz not null default now(),
  primary key(user_id, offer_key)
);
create table if not exists public.huntify_search_history (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  query text not null,
  summary text,
  criteria jsonb not null default '[]'::jsonb,
  offer_count integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists huntify_history_user_date on public.huntify_search_history(user_id, created_at desc);
alter table public.huntify_favorites enable row level security;
alter table public.huntify_search_history enable row level security;
revoke all on public.huntify_favorites from anon;
revoke all on public.huntify_search_history from anon;
grant select,insert,update,delete on public.huntify_favorites to authenticated;
grant select,insert,update,delete on public.huntify_search_history to authenticated;
create policy "favorites_select_own" on public.huntify_favorites for select to authenticated using ((select auth.uid())=user_id);
create policy "favorites_insert_own" on public.huntify_favorites for insert to authenticated with check ((select auth.uid())=user_id);
create policy "favorites_update_own" on public.huntify_favorites for update to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
create policy "favorites_delete_own" on public.huntify_favorites for delete to authenticated using ((select auth.uid())=user_id);
create policy "history_select_own" on public.huntify_search_history for select to authenticated using ((select auth.uid())=user_id);
create policy "history_insert_own" on public.huntify_search_history for insert to authenticated with check ((select auth.uid())=user_id);
create policy "history_update_own" on public.huntify_search_history for update to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
create policy "history_delete_own" on public.huntify_search_history for delete to authenticated using ((select auth.uid())=user_id);
