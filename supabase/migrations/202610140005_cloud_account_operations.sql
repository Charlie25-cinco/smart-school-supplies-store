begin;
create table store_private.account_operations (
  staff_id bigint primary key references public.profiles(id),
  operation_id uuid not null unique default gen_random_uuid(),
  actor_id bigint not null references public.profiles(id),
  started_at timestamptz not null default now()
);
revoke all on store_private.account_operations from public,anon,authenticated;
create function public.begin_staff_operation(p_staff_id bigint) returns uuid
language plpgsql security definer set search_path=pg_catalog,public as $$
declare actor public.profiles; target public.profiles; operation uuid;
begin
  actor:=store_private.require_staff('admin');
  select * into target from public.profiles where id=p_staff_id for share;
  if not found or target.role<>'cashier' or target.auth_id is null then
    raise exception using errcode='P0001',message='Select a linked Cashier account.';
  end if;
  begin
    insert into store_private.account_operations(staff_id,actor_id) values(target.id,actor.id) returning operation_id into operation;
  exception when unique_violation then
    raise exception using errcode='P0001',message='A previous account change is still running or needs private administrator recovery.';
  end;
  return operation;
end;
$$;
create function public.finish_staff_operation(p_staff_id bigint,p_operation_id uuid) returns void
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if (auth.jwt()->>'role') is distinct from 'service_role' then
    raise exception using errcode='42501',message='Server account management is required.';
  end if;
  delete from store_private.account_operations where staff_id=p_staff_id and operation_id=p_operation_id;
end;
$$;
revoke all on function public.begin_staff_operation(bigint),public.finish_staff_operation(bigint,uuid) from public,anon,authenticated;
grant execute on function public.begin_staff_operation(bigint) to authenticated;
grant execute on function public.finish_staff_operation(bigint,uuid) to service_role;
commit;
