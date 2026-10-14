begin;
do $$
declare v_operation uuid; v_second uuid;
begin
  perform store_tests.actor('10000000-0000-4000-8000-000000000010');
  v_operation := public.begin_staff_operation(20);
  begin
    perform public.begin_staff_operation(20);
    raise exception using errcode = 'XX000', message = 'FAIL: concurrent target account change accepted';
  exception when sqlstate 'P0001' then null; end;
  perform store_tests.assert((select count(*) = 1 from store_private.account_operations where staff_id = 20), 'target account change is serialized by one durable operation');
  update store_private.account_operations set started_at = '2000-01-01T00:00:00Z' where staff_id = 20;
  begin
    perform public.begin_staff_operation(20);
    raise exception using errcode = 'XX000', message = 'FAIL: old uncertain Auth operation automatically reclaimed';
  exception when sqlstate 'P0001' then null; end;
  perform store_tests.assert((select operation_id = v_operation from store_private.account_operations where staff_id = 20), 'uncertain external Auth changes have no automatic expiry or reclaim');
  perform store_tests.actor('10000000-0000-4000-8000-000000000020');
  begin
    perform public.begin_staff_operation(30);
    raise exception using errcode = 'XX000', message = 'FAIL: Cashier acquired account mutation guard';
  exception when insufficient_privilege then null; end;
  perform store_tests.assert(true, 'Cashier cannot acquire staff management operation');
  perform set_config('store_tests.operation_id',v_operation::text,true);
end;
$$;
set local role authenticated;
do $$
begin
  begin
    perform public.finish_staff_operation(20,current_setting('store_tests.operation_id')::uuid);
    raise exception using errcode = 'XX000', message = 'FAIL: browser released private account operation';
  exception when insufficient_privilege then null; end;
  perform store_tests.assert(true, 'authenticated client cannot release account operation');
end;
$$;
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select public.finish_staff_operation(20,gen_random_uuid());
reset role;
select store_tests.assert((select count(*) = 1 from store_private.account_operations where staff_id = 20), 'wrong server operation UUID cannot release another operation');
set local role service_role;
select public.finish_staff_operation(20,current_setting('store_tests.operation_id')::uuid);
reset role;
select store_tests.assert((select count(*) = 0 from store_private.account_operations where staff_id = 20), 'matching service operation UUID releases completed account guard');

-- iat is whole seconds: a truly fresh session within the marker's second works.
do $$
declare v_marker timestamptz := date_trunc('second',clock_timestamp()) + interval '0.1 second';
  v_fresh uuid := '70000000-0000-4000-8000-000000000002';
begin
  update public.profiles set auth_revoked_at = v_marker where id = 20;
  update auth.sessions set created_at = v_marker - interval '1 minute' where id = '10000000-0000-4000-8000-000000000020';
  perform store_tests.actor('10000000-0000-4000-8000-000000000020');
  perform set_config('request.jwt.claims',jsonb_build_object('sub','10000000-0000-4000-8000-000000000020','role','authenticated',
    'session_id','10000000-0000-4000-8000-000000000020','iat',floor(extract(epoch from v_marker)) + 120)::text,true);
  perform store_tests.assert(store_private.current_staff_id() is null, 'old session remains revoked even when refreshed JWT iat is newer');
  insert into auth.sessions(id,user_id,created_at) values(v_fresh,'10000000-0000-4000-8000-000000000020',v_marker + interval '0.2 second');
  perform set_config('request.jwt.claims',jsonb_build_object('sub','10000000-0000-4000-8000-000000000020','role','authenticated',
    'session_id',v_fresh,'iat',floor(extract(epoch from v_marker)))::text,true);
  perform store_tests.assert(store_private.current_staff_id() = 20, 'genuine new session in same second as revocation marker is accepted');
  perform store_tests.assert((store_private.require_staff('cashier')).id = 20, 'post-lock staff guard accepts the fresh same-second session');
  update public.profiles set auth_revoked_at = null where id = 20;
end;
$$;
commit;
