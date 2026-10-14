begin;
alter table public.profiles add column auth_revoked_at timestamptz;

create or replace function store_private.current_staff_id() returns bigint
language sql stable security definer set search_path = pg_catalog, public as $$
  select p.id from public.profiles p
  where p.auth_id = auth.uid() and p.active and p.role in ('admin','cashier')
    and case when (auth.jwt()->>'iat') ~ '^[0-9]{1,12}$'
      then p.auth_revoked_at is null or (auth.jwt()->>'iat')::bigint >= floor(extract(epoch from p.auth_revoked_at))
      else false end
    and exists (
      select 1 from auth.sessions s where s.user_id = p.auth_id
      and (p.auth_revoked_at is null or s.created_at > p.auth_revoked_at)
      and s.id = case when (auth.jwt()->>'session_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then (auth.jwt()->>'session_id')::uuid else null end
    )
$$;
create or replace function store_private.current_role() returns text
language sql stable security definer set search_path = pg_catalog, public as $$
  select role from public.profiles where id = store_private.current_staff_id()
$$;
create or replace function store_private.require_staff(p_role text default null) returns public.profiles
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_staff public.profiles;
begin
  select * into v_staff from public.profiles where id = store_private.current_staff_id() for share;
  if not found or not v_staff.active or (p_role is not null and v_staff.role <> p_role)
    or (case when (auth.jwt()->>'iat') ~ '^[0-9]{1,12}$'
      then v_staff.auth_revoked_at is not null and (auth.jwt()->>'iat')::bigint < floor(extract(epoch from v_staff.auth_revoked_at))
      else true end)
    or (v_staff.auth_revoked_at is not null and not exists (
      select 1 from auth.sessions s where s.user_id=v_staff.auth_id and s.created_at>v_staff.auth_revoked_at
      and s.id=case when (auth.jwt()->>'session_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then (auth.jwt()->>'session_id')::uuid else null end
    )) then
    raise exception using errcode='42501', message='Active staff access and a current session are required.';
  end if;
  return v_staff;
end;
$$;

-- Called only by the server-side staff-admin function. Old JWTs lose DB access
-- immediately because every authenticated policy/RPC checks auth.sessions.
create function public.revoke_staff_sessions(p_staff_id bigint) returns void
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_auth uuid;
begin
  if (auth.jwt()->>'role') is distinct from 'service_role' then
    raise exception using errcode='42501',message='Server account management is required.';
  end if;
  select auth_id into v_auth from public.profiles where id=p_staff_id and role='cashier' for update;
  if not found then raise exception using errcode='42501',message='Only Cashier accounts can be managed.'; end if;
  update public.profiles set auth_revoked_at=now(),updated_at=now() where id=p_staff_id;
  delete from auth.sessions where user_id=v_auth;
end;
$$;
revoke all on function public.revoke_staff_sessions(bigint) from public,anon,authenticated;
grant execute on function public.revoke_staff_sessions(bigint) to service_role;
commit;
