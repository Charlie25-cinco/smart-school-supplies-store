-- Session/role privacy boundary, fictional records in the disposable engine.
begin;
select store_tests.actor('10000000-0000-4000-8000-000000000010');
set local role authenticated;
select store_tests.assert((select count(*) = 4 from public.profiles), 'active Admin may read staff management profiles');
select store_tests.assert((select count(*) >= 4 from public.stock_movements), 'active Admin may read inventory and payment movement history');
do $$
begin
  begin
    update public.profiles set role = 'admin' where id = 20;
    raise exception using errcode = 'XX000', message = 'FAIL: browser directly promoted Cashier';
  exception when insufficient_privilege then null; end;
  perform store_tests.assert(true, 'even Admin browser cannot bypass private account provisioning');
end;
$$;
reset role;

-- Missing Auth session must reject a token even if its profile remains active.
delete from auth.sessions where id = '10000000-0000-4000-8000-000000000020';
select store_tests.actor('10000000-0000-4000-8000-000000000020');
set local role authenticated;
do $$
begin
  perform store_tests.assert((select count(*) = 0 from public.orders) and (select count(*) = 0 from public.profiles), 'deleted Auth session immediately rejects private RLS reads');
  begin
    perform public.store_snapshot('20000000-0000-4000-8000-000000000002');
    raise exception using errcode = 'XX000', message = 'FAIL: revoked session called staff snapshot';
  exception when insufficient_privilege then null; end;
  perform store_tests.assert(true, 'deleted Auth session immediately rejects staff RPC writes');
end;
$$;
reset role;
insert into auth.sessions(id,user_id) values('10000000-0000-4000-8000-000000000020','10000000-0000-4000-8000-000000000020');
select store_tests.actor('10000000-0000-4000-8000-000000000020');
select store_tests.assert(store_private.current_staff_id() = 20, 'fresh active Auth session restores authorized Cashier access');

-- The revocation marker prevents a still-existing old token from gaining access
-- when an account is re-enabled. Test root's following auth migration directly.
update public.profiles set auth_revoked_at = now() + interval '1 minute' where id = 20;
set local role authenticated;
select store_tests.assert((select count(*) = 0 from public.sales), 'token issued before profile revocation marker cannot regain receipt access');
reset role;
update public.profiles set auth_revoked_at = null where id = 20;

do $$
declare base timestamptz:=date_trunc('second',now()); subject uuid:='10000000-0000-4000-8000-000000000020'; fresh uuid:='10000000-0000-4000-8000-000000000021';
begin
  update public.profiles set auth_revoked_at=base+interval '200 milliseconds' where id=20;
  update auth.sessions set created_at=base+interval '100 milliseconds' where id=subject;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',subject,'role','authenticated','session_id',subject,'iat',floor(extract(epoch from base))+60)::text,false);
  perform store_tests.assert(store_private.current_staff_id() is null,'refreshing an older session cannot bypass its revocation marker');
  insert into auth.sessions(id,user_id,created_at) values(fresh,subject,base+interval '300 milliseconds');
  perform set_config('request.jwt.claims',jsonb_build_object('sub',subject,'role','authenticated','session_id',fresh,'iat',floor(extract(epoch from base)))::text,false);
  perform store_tests.assert(store_private.current_staff_id()=20,'genuine fresh login within the revocation second remains authorized');
  delete from auth.sessions where id=fresh;
  update public.profiles set auth_revoked_at=null where id=20;
end;
$$;

select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000020',false);
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000020","role":"authenticated","iat":1}',false);
set local role authenticated;
select store_tests.assert((select count(*) = 0 from public.products), 'staff JWT without session_id cannot read private products');
reset role;
commit;
