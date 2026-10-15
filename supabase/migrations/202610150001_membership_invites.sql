-- VAYNTR membership invitations. Apply with Supabase CLI or SQL editor.
-- This migration creates the secure data model; it does not enable production auth UI.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'user' check (role in ('user', 'member', 'staff', 'admin')),
  membership_status text not null default 'none'
    check (membership_status in ('none', 'active', 'suspended', 'revoked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.invite_codes (
  id uuid primary key default gen_random_uuid(),
  key_hash text not null unique check (key_hash ~ '^[0-9a-f]{64}$'),
  issued_by uuid not null references auth.users(id) on delete restrict,
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days'),
  redeemed_by uuid unique references auth.users(id) on delete restrict,
  redeemed_at timestamptz,
  revoked_at timestamptz,
  label text check (label is null or length(label) <= 120),
  constraint invite_expiry_after_issue check (expires_at > issued_at),
  constraint invite_redemption_pair check (
    (redeemed_by is null and redeemed_at is null) or
    (redeemed_by is not null and redeemed_at is not null)
  )
);

create index if not exists invite_codes_issuer_idx on public.invite_codes (issued_by, issued_at desc);
create index if not exists invite_codes_expiry_idx on public.invite_codes (expires_at);
create index if not exists invite_codes_redeemer_idx on public.invite_codes (redeemed_by);

create table if not exists public.invite_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  attempted_at timestamptz not null default now()
);
create index if not exists invite_attempts_user_time_idx
  on public.invite_attempts (user_id, attempted_at desc);

alter table public.profiles enable row level security;
alter table public.invite_codes enable row level security;
alter table public.invite_attempts enable row level security;

-- Members can read only their own profile. There is intentionally no client UPDATE policy:
-- role and membership_status must only be changed by trusted server-side code.
drop policy if exists "Users can read their own profile" on public.profiles;
create policy "Users can read their own profile"
  on public.profiles for select to authenticated
  using (auth.uid() = id);

-- No client policies on invite_codes or invite_attempts. The browser cannot list, read,
-- create, redeem, or revoke invite records directly.
revoke all on public.invite_codes from anon, authenticated;
revoke all on public.invite_attempts from anon, authenticated;
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;

-- New accounts get a low-privilege profile. Never accept role/status from client metadata.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, role, membership_status)
  values (new.id, 'user', 'none')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
  after insert on auth.users
  for each row execute procedure public.handle_new_auth_user();

-- Atomic per-user rate limiting: at most 10 attempts per rolling 15-minute window.
-- Advisory lock avoids concurrent requests bypassing the count.
create or replace function public.consume_invite_attempt(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  recent_count integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  select count(*)::integer into recent_count
  from public.invite_attempts
  where user_id = p_user_id
    and attempted_at > now() - interval '15 minutes';

  if recent_count >= 10 then
    return false;
  end if;

  insert into public.invite_attempts (user_id) values (p_user_id);
  return true;
end;
$$;

-- Atomic redemption: lock the invitation row, enforce all validity checks, and bind the
-- invitation to the authenticated user in one transaction. Return only a generic result.
create or replace function public.redeem_invite_code(p_key_hash text, p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  invite public.invite_codes%rowtype;
begin
  select * into invite
  from public.invite_codes
  where key_hash = p_key_hash
  for update;

  if not found then return 'invalid'; end if;
  if invite.revoked_at is not null then return 'invalid'; end if;
  if invite.expires_at <= now() then return 'invalid'; end if;
  if invite.redeemed_at is not null then return 'invalid'; end if;

  update public.invite_codes
  set redeemed_by = p_user_id, redeemed_at = now()
  where id = invite.id;

  update public.profiles
  set role = 'member',
      membership_status = 'active',
      updated_at = now()
  where id = p_user_id
    and role = 'user'
    and membership_status = 'none';

  if not found then
    -- Roll back the invite redemption if the account is not eligible for first-time redemption.
    raise exception 'Account is not eligible for invite redemption';
  end if;

  return 'redeemed';
end;
$$;

-- These functions are called only by Edge Functions using the server-side service role.
revoke all on function public.consume_invite_attempt(uuid) from public, anon, authenticated;
revoke all on function public.redeem_invite_code(text, uuid) from public, anon, authenticated;
grant execute on function public.consume_invite_attempt(uuid) to service_role;
grant execute on function public.redeem_invite_code(text, uuid) to service_role;

-- Staff/admin role assignment must be performed out-of-band by a trusted project owner.
-- Do not add a client-side policy allowing users to set their own role or membership status.
