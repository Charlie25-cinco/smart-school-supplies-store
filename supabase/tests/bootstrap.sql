-- Test ONLY: minimal fictional Supabase Auth boundary in a fresh in-memory DB.
-- Never apply this file to an existing or hosted Supabase project.
create role anon noinherit;
create role authenticated noinherit;
create role service_role noinherit bypassrls;
create schema auth;
create table auth.users(id uuid primary key, email text, raw_app_meta_data jsonb not null default '{}');
create table auth.sessions(id uuid primary key, user_id uuid not null references auth.users(id), created_at timestamptz not null default now());
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid
$$;
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
$$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid(), auth.jwt() to anon, authenticated, service_role;

create schema store_tests;
create table store_tests.checks(label text primary key);
create function store_tests.assert(p_value boolean, p_label text) returns void language plpgsql as $$
begin
  if p_value is distinct from true then raise exception using errcode = 'XX000', message = 'FAIL: ' || p_label; end if;
  insert into store_tests.checks(label) values(p_label);
end;
$$;
create function store_tests.actor(p_auth_id uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_auth_id::text, false);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_auth_id, 'role', 'authenticated',
    'session_id', p_auth_id, 'iat', extract(epoch from clock_timestamp())::bigint)::text, false);
end;
$$;
