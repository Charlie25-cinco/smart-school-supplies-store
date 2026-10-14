-- Financial review recovery and further boundary cases, fictional data only.
begin;
do $$
declare
  a uuid := '10000000-0000-4000-8000-000000000010';
  b uuid := '10000000-0000-4000-8000-000000000020';
  c uuid := '10000000-0000-4000-8000-000000000030';
  da uuid := '20000000-0000-4000-8000-000000000001';
  db uuid := '20000000-0000-4000-8000-000000000006';
  p jsonb; e jsonb; replacement jsonb; result jsonb; snap jsonb; review_id uuid; replacement_id uuid;
  price uuid; service_price uuid; order_ref uuid; v_version bigint; v_before bigint; paid_order bigint;
begin
  perform store_tests.actor(b);
  perform public.register_device(db,'Fictional recovery device');
  perform public.store_snapshot(db);
  select price_version_id into price from public.products where id = 101;
  select price_version_id into service_price from public.products where id = 103;
  p := jsonb_build_object('reference',gen_random_uuid(),'receipt_number','S-test-review-recovered','channel','walk-in','items',
    jsonb_build_array(jsonb_build_object('product_id',101,'quantity',1,'price_version_id',price)),
    'payment',jsonb_build_object('method','cash','amount_cents',1500));
  e := store_tests.event(db,'sale.create',p);
  e := jsonb_set(e,'{captured_at}',to_jsonb('2026-10-12T02:00:00.000Z'::text));
  result := public.apply_event(e);
  review_id := (e ->> 'id')::uuid;
  perform store_tests.assert(result ->> 'status' = 'review' and (select payload = p from public.sync_events where id = review_id), 'quota-blocked financial submission is durably retained for recovery');
  begin
    perform public.resolve_review(review_id,'Fictional unbacked dismissal',gen_random_uuid());
    raise exception using errcode = 'XX000', message = 'FAIL: unbacked review dismissal accepted';
  exception when sqlstate 'P0001' then null; end;
  perform store_tests.assert((select resolved_at is null from public.sync_events where id = review_id), 'review cannot be dismissed without synchronized exact replacement');
  begin
    perform public.resolve_review(review_id,'Fictional unrelated sale',(select id from public.sync_events where status = 'synced' and kind = 'sale.create' limit 1));
    raise exception using errcode = 'XX000', message = 'FAIL: unrelated receipt resolved financial review';
  exception when sqlstate 'P0001' then null; end;
  perform store_tests.assert(true, 'different reference receipt items or payment cannot resolve a review');
  perform store_tests.actor(c);
  begin
    perform public.resolve_review(review_id,'Fictional other staff action',gen_random_uuid());
    raise exception using errcode = 'XX000', message = 'FAIL: another Cashier resolved review';
  exception when insufficient_privilege then null; end;
  perform store_tests.assert(true, 'unrelated Cashier cannot resolve another actor review');
  perform store_tests.actor(a);
  result := public.apply_event(store_tests.event(da,'inventory.movement','{"product_id":101,"quantity":2,"reason":"Fictional review-recovery restock"}'::jsonb));
  perform store_tests.assert(result ->> 'status' = 'synced', 'Admin supplies physical units before review-recovery allocation');
  perform public.allocate_stock(db,101,2);
  perform store_tests.actor(b);
  replacement := store_tests.event(db,'sale.create',p);
  replacement := jsonb_set(replacement,'{captured_at}',e -> 'captured_at');
  replacement_id := (replacement ->> 'id')::uuid;
  result := public.apply_event(replacement);
  perform store_tests.assert(result ->> 'status' = 'synced' and (select count(*) = 1 from public.sales where receipt_number = 'S-test-review-recovered'), 'condition-fixed exact financial retry uses new event ID and creates one original receipt');
  perform store_tests.assert((select created_at = (e ->> 'captured_at')::timestamptz from public.sales where receipt_number = 'S-test-review-recovered')
    and (select created_at = now() and captured_at = (e ->> 'captured_at')::timestamptz from public.sync_events where id = replacement_id), 'financial recovery preserves the original business date and a separate server receipt time');
  perform public.resolve_review(review_id,'Fictional quota allocation completed',replacement_id);
  perform public.resolve_review(review_id,'Fictional quota allocation completed',replacement_id);
  perform store_tests.assert((select status = 'review' and payload = p and resolved_by = 20 and replacement_event_id = replacement_id and resolved_at is not null
    from public.sync_events where id = review_id), 'resolution preserves original review data and links exact accepted replacement idempotently');
  snap := public.store_snapshot(db);
  perform store_tests.assert(not exists(select 1 from jsonb_array_elements(snap -> 'reviews') r where r ->> 'id' = review_id::text), 'resolved reviews no longer block unresolved review list');

  -- A version-only retry may recover an unchanged action; original finances stay fixed.
  order_ref := gen_random_uuid();
  p := jsonb_build_object('reference',order_ref,'receipt_number','S-test-version-fixture','channel','walk-in','fulfillment','pickup','payment_plan','prepaid',
    'customer_name','Fictional Version Customer','customer_phone','09000000000','delivery_address','','notes','','delivery_fee_cents',0,
    'items',jsonb_build_array(jsonb_build_object('product_id',103,'quantity',1,'price_version_id',service_price)),
    'payment',jsonb_build_object('method','cash','amount_cents',500));
  result := public.apply_event(store_tests.event(db,'order.create',p));
  perform store_tests.assert(result ->> 'status' = 'synced', 'version-recovery fixture is leased to its own clean device');
  select version into v_version from public.orders where reference = order_ref;
  p := jsonb_build_object('reference',order_ref,'expected_version',v_version - 1,'status','ready');
  e := store_tests.event(db,'order.status',p);
  result := public.apply_event(e);
  review_id := (e ->> 'id')::uuid;
  replacement := store_tests.event(db,'order.status',p || jsonb_build_object('expected_version',v_version));
  replacement_id := (replacement ->> 'id')::uuid;
  result := public.apply_event(replacement);
  perform store_tests.assert(result ->> 'status' = 'synced', 'same requested action can retry after reviewing current order version');
  perform store_tests.actor(a);
  perform public.resolve_review(review_id,'Fictional version reviewed, original action retained',replacement_id);
  perform store_tests.assert((select resolved_by = 10 and payload ->> 'expected_version' = (v_version - 1)::text from public.sync_events where id = review_id), 'Admin may record version-only review recovery without altering original event');

  perform store_tests.actor(b);
  p := jsonb_build_object('reference',gen_random_uuid(),'receipt_number','S-test-prepaid','channel','walk-in','fulfillment','pickup','payment_plan','prepaid',
    'customer_name','Fictional Prepaid Customer','customer_phone','09000000000','delivery_address','','notes','', 'delivery_fee_cents',0,
    'items',jsonb_build_array(jsonb_build_object('product_id',103,'quantity',2,'price_version_id',service_price)),
    'payment',jsonb_build_object('method','gcash','amount_cents',1000,'reference','PREPAID001','verified',true));
  result := public.apply_event(store_tests.event(db,'order.create',p));
  select id into paid_order from public.orders where reference = (p ->> 'reference')::uuid;
  perform store_tests.assert(result ->> 'status' = 'synced' and (select sale_id is not null and version = 2 and paid_by = 20 from public.orders where id = paid_order), 'prepaid order records payment atomically and starts at version 2');
  v_before := (select count(*) from public.orders);
  result := public.apply_event(store_tests.event(db,'order.create',p || jsonb_build_object('reference',gen_random_uuid(),'receipt_number','S-test-pickup-fee','delivery_fee_cents',100)));
  perform store_tests.assert(result ->> 'status' = 'review' and (select count(*) = v_before from public.orders), 'invalid pickup delivery fee rolls back entire prepaid order');
  result := public.apply_event(store_tests.event(db,'sale.create',jsonb_build_object('reference',gen_random_uuid(),'receipt_number','S-test-fraction','channel','walk-in',
    'items',jsonb_build_array(jsonb_build_object('product_id',103,'quantity',1.5,'price_version_id',service_price)),
    'payment',jsonb_build_object('method','cash','amount_cents',1000))));
  perform store_tests.assert(result ->> 'status' = 'review', 'fractional quantities are rejected server-side');
  result := public.apply_event(store_tests.event(db,'sale.create',jsonb_build_object('reference',gen_random_uuid(),'receipt_number','S-test-underpaid','channel','walk-in',
    'items',jsonb_build_array(jsonb_build_object('product_id',103,'quantity',2,'price_version_id',service_price)),
    'payment',jsonb_build_object('method','cash','amount_cents',999))));
  perform store_tests.assert(result ->> 'status' = 'review', 'underpaid cash sale is rejected server-side');
  result := public.apply_event(store_tests.event(db,'sale.create',jsonb_build_object('reference',gen_random_uuid(),'receipt_number','S-test-forged-grant','channel','walk-in',
    'items',jsonb_build_array(jsonb_build_object('product_id',103,'quantity',1,'price_version_id',gen_random_uuid())),
    'payment',jsonb_build_object('method','cash','amount_cents',500))));
  perform store_tests.assert(result ->> 'status' = 'review', 'arbitrary historical price UUID cannot authorize a browser price');

  -- Remaining line reductions on deactivated products remain safe.
  order_ref := gen_random_uuid();
  p := jsonb_build_object('reference',order_ref,'receipt_number','S-test-inactive-retained','channel','walk-in','fulfillment','pickup','payment_plan','collection',
    'customer_name','Fictional Retained Customer','customer_phone','09000000000','delivery_address','','notes','', 'delivery_fee_cents',0,
    'items',jsonb_build_array(jsonb_build_object('product_id',101,'quantity',1,'price_version_id',price),
      jsonb_build_object('product_id',103,'quantity',1,'price_version_id',service_price)));
  result := public.apply_event(store_tests.event(db,'order.create',p));
  perform store_tests.assert(result ->> 'status' = 'synced', 'unpaid order reserves remaining allocation before deactivation');
  perform store_tests.actor(a);
  p := (select jsonb_build_object('id',id,'expected_version',version,'sku',sku,'name',name,'category',category,'kind',kind,
    'price_cents',price_cents,'reorder_level',reorder_level,'active',false,'description',description) from public.products where id = 101);
  result := public.apply_event(store_tests.event(da,'inventory.save',p));
  perform store_tests.assert(result ->> 'status' = 'synced', 'Admin can deactivate an item while preserving its history');
  perform store_tests.actor(b);
  v_version := (select version from public.orders where reference = order_ref);
  p := jsonb_build_object('reference',order_ref,'expected_version',v_version,'customer_name','Fictional Retained Correction','customer_phone','09000000000',
    'delivery_address','','notes','','delivery_fee_cents',0,'items',jsonb_build_array(jsonb_build_object('product_id',101,'quantity',1,'price_version_id',price),
      jsonb_build_object('product_id',103,'quantity',1,'price_version_id',service_price)));
  result := public.apply_event(store_tests.event(db,'order.edit',p));
  perform store_tests.assert(result ->> 'status' = 'synced', 'deactivated retained line can be kept at original quantity and price');
  v_version := (select version from public.orders where reference = order_ref);
  result := public.apply_event(store_tests.event(db,'order.edit',jsonb_set(p || jsonb_build_object('expected_version',v_version),'{items,0,quantity}','2')));
  perform store_tests.assert(result ->> 'status' = 'review', 'deactivated retained line cannot be increased');
  result := public.apply_event(store_tests.event(db,'order.edit',p || jsonb_build_object('expected_version',v_version,'items',
    jsonb_build_array(jsonb_build_object('product_id',103,'quantity',1,'price_version_id',service_price)))));
  perform store_tests.assert(result ->> 'status' = 'synced' and (select reserved = 0 from public.products where id = 101), 'removing deactivated retained line restores reservation to device quota');
  perform store_tests.assert((select allocated = coalesce((select sum(remaining) from public.stock_allocations where product_id = 101),0)
    and allocated + reserved <= stock from public.products where id = 101), 'recovery and deactivation paths preserve allocation invariants');
end;
$$;

do $$
declare
  b uuid := '10000000-0000-4000-8000-000000000020';
  d uuid := '20000000-0000-4000-8000-000000000007';
  p jsonb; e jsonb; replacement jsonb; result jsonb; price uuid;
begin
  perform store_tests.actor(b);
  perform public.register_device(d,'Fictional date-mismatch recovery device');
  perform public.store_snapshot(d);
  select price_version_id into price from public.products where id = 103;
  p := jsonb_build_object('reference',gen_random_uuid(),'receipt_number','S-test-mismatched-date','channel','walk-in',
    'items',jsonb_build_array(jsonb_build_object('product_id',103,'quantity',1,'price_version_id',price)),
    'payment',jsonb_build_object('method','cash','amount_cents',500));
  update public.products set active=false where id=103;
  e := jsonb_set(store_tests.event(d,'sale.create',p),'{captured_at}',to_jsonb('2026-10-12T02:00:00.000Z'::text));
  result := public.apply_event(e);
  perform store_tests.assert(result ->> 'status' = 'review','date-mismatch fixture retains its rejected original sale');
  update public.products set active=true where id=103;
  replacement := store_tests.event(d,'sale.create',p);
  result := public.apply_event(replacement);
  perform store_tests.assert(result ->> 'status' = 'synced','date-mismatch fixture has an otherwise identical confirmed replacement');
  begin
    perform public.resolve_review((e ->> 'id')::uuid,'Fictional attempt to move a financial business date',(replacement ->> 'id')::uuid);
    raise exception using errcode='XX000',message='FAIL: a changed business date resolved the original review';
  exception when sqlstate 'P0001' then null; end;
  perform store_tests.assert((select resolved_at is null from public.sync_events where id=(e ->> 'id')::uuid),'review resolution cannot dismiss an original sale with a different captured business date');
end;
$$;
commit;
