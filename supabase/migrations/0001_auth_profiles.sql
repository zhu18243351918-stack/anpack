-- Anpack shares the Supabase project with another application, so every
-- database object is namespaced to avoid changing the host application's
-- profiles table, functions, policies, or auth triggers.
create table if not exists public.anpack_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.anpack_profiles enable row level security;

drop policy if exists "anpack_profiles_select_own" on public.anpack_profiles;
create policy "anpack_profiles_select_own"
  on public.anpack_profiles for select
  using (auth.uid() = id);

drop policy if exists "anpack_profiles_update_own" on public.anpack_profiles;
create policy "anpack_profiles_update_own"
  on public.anpack_profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

create or replace function public.anpack_handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.anpack_profiles(id, display_name, avatar_url)
  values(new.id, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)), new.raw_user_meta_data->>'avatar_url')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists anpack_on_auth_user_created on auth.users;
create trigger anpack_on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.anpack_handle_new_user();
