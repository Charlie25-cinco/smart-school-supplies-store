-- Fictional isolated regression coverage. Run only with the in-memory runner.
begin;
create function store_tests.event(p_device uuid, p_kind text, p_payload jsonb) returns jsonb language sql as $$
  select jsonb_build_object('id', gen_random_uuid(), 'device_id', p_device, 'sequence', next_sequence,
    'kind', p_kind, 'payload', p_payload, 'captured_at', now(), 'status', 'pending') from public.devices where id = p_device
$$;
insert into auth.users(id, email) values
 ('10000000-0000-4000-8000-000000000010', 'admin@example.invalid'),
 ('10000000-0000-4000-8000-000000000020', 'cashier-a@example.invalid'),
 ('10000000-0000-4000-8000-000000000030', 'cashier-b@example.invalid'),
 ('10000000-0000-4000-8000-000000000040', 'inactive@example.invalid');
insert into auth.sessions(id,user_id) select id,id from auth.users;
insert into public.profiles(id, auth_id, name, email, role, active) values
 (10,'10000000-0000-4000-8000-000000000010','Fictional Admin','admin@example.invalid','admin',true),
 (20,'10000000-0000-4000-8000-000000000020','Fictional Cashier A','cashier-a@example.invalid','cashier',true),
 (30,'10000000-0000-4000-8000-000000000030','Fictional Cashier B','cashier-b@example.invalid','cashier',true),
 (40,'10000000-0000-4000-8000-000000000040','Fictional Inactive','inactive@example.invalid','cashier',false);
insert into public.products(id,sku,name,category,kind,price_cents,stock) values
 (101,'TEST-PENCIL','Fictional Pencil','Writing','product',1000,20),
 (102,'TEST-NOTEBOOK','Fictional Notebook','Paper','product',3000,10),
 (103,'TEST-PRINT','Fictional Printing','Services','service',500,0),
 (104,'TEST-SUPPLY','Fictional Internal Supply','Supplies','consumable',0,20);
select setval(pg_get_serial_sequence('public.profiles','id'),40,true);
select setval(pg_get_serial_sequence('public.products','id'),104,true);

-- Historical Admin-origin order retains IDs, original labels and agreed price.
update public.products set reserved = 2 where id = 101;
insert into public.orders(id,reference,user_id,channel,fulfillment,payment_plan,customer_name,customer_phone,delivery_address,
  subtotal_cents,delivery_fee_cents,total_cents,created_at,updated_at)
values(500,'50000000-0000-4000-8000-000000000500',10,'messenger','delivery','collection','Fictional Legacy Customer','09000000000',
  'Fictional address',1400,0,1400,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z');
insert into public.order_items(id,order_id,product_id,name,sku,kind,quantity,price_cents,total_cents)
values(700,500,101,'Original Fictional Pencil','OLD-PENCIL','product',2,700,1400);
select setval(pg_get_serial_sequence('public.orders','id'),500,true);
select setval(pg_get_serial_sequence('public.order_items','id'),700,true);

do $$
declare
  a uuid := '10000000-0000-4000-8000-000000000010';
  b uuid := '10000000-0000-4000-8000-000000000020';
  c uuid := '10000000-0000-4000-8000-000000000030';
  da uuid := '20000000-0000-4000-8000-000000000001';
  db uuid := '20000000-0000-4000-8000-000000000002';
  db2 uuid := '20000000-0000-4000-8000-000000000003';
  dc uuid := '20000000-0000-4000-8000-000000000004';
  r jsonb; e jsonb; retry jsonb; snap jsonb; p jsonb; lines jsonb; old_price uuid; new_price uuid; service_price uuid;
  order_ref uuid := '30000000-0000-4000-8000-000000000001';
  cancel_ref uuid := '30000000-0000-4000-8000-000000000002';
  offline_item uuid := '60000000-0000-4000-8000-000000000001';
  v_before bigint; v_order bigint; v_version bigint; v_product bigint; saved_snapshot jsonb; v_status text;
begin
  perform store_tests.actor(a);
  r := public.register_device(da, 'Fictional Admin device');
  perform store_tests.assert((r ->> 'next_sequence')::bigint = 1, 'new device starts with next unused sequence 1');
  perform store_tests.actor(b);
  perform public.register_device(db, 'Fictional Cashier A phone');
  perform public.register_device(db2, 'Fictional Cashier A tablet');
  perform public.store_snapshot(db2);
  snap := public.store_snapshot(db);
  perform store_tests.assert(jsonb_array_length(snap -> 'products') = 3, 'Cashier snapshot excludes internal supplies');
  perform store_tests.assert(jsonb_array_length(snap -> 'cashiers') = 0 and jsonb_array_length(snap -> 'movements') = 0, 'Cashier snapshot excludes Admin-only account and inventory history');
  perform store_tests.actor(c);
  perform public.register_device(dc, 'Fictional Cashier B phone');
  perform public.store_snapshot(dc);
  perform store_tests.actor(a);
  perform public.allocate_stock(db,101,10);
  perform public.allocate_stock(dc,101,8);
  perform public.allocate_stock(db,102,6);
  perform public.allocate_stock(dc,102,4);
  begin
    perform public.allocate_stock(db,101,1);
    raise exception using errcode = 'XX000', message = 'FAIL: over-allocation accepted';
  exception when sqlstate 'P0001' then null; end;
  perform store_tests.assert((select allocated = 18 and stock = 20 and reserved = 2 from public.products where id = 101), 'two device allocations cannot exceed physical stock minus reservations');
  begin
    perform public.release_allocation(db,101);
    raise exception using errcode = 'XX000', message = 'FAIL: Admin confiscated remote offline quota';
  exception when insufficient_privilege then null; end;
  perform store_tests.assert((select remaining = 10 from public.stock_allocations where device_id = db and product_id = 101), 'Admin cannot force-release remote device stock');
  select price_version_id into old_price from public.products where id = 101;
  select price_version_id into service_price from public.products where id = 103;
  lines := jsonb_build_array(jsonb_build_object('product_id',101,'quantity',2,'price_version_id',old_price));
  p := jsonb_build_object('reference',gen_random_uuid(),'receipt_number','S-test-admin-denied','channel','walk-in','items',lines,
    'payment',jsonb_build_object('method','cash','amount_cents',2000));
  r := public.apply_event(store_tests.event(da,'sale.create',p));
  perform store_tests.assert(r ->> 'status' = 'review' and (select count(*) = 0 from public.sales), 'Admin checkout refused and saved for review');

  perform store_tests.actor(b);
  begin
    perform public.allocate_stock(db,101,1);
    raise exception using errcode = 'XX000', message = 'FAIL: Cashier allocated stock';
  exception when insufficient_privilege then null; end;
  perform store_tests.assert(true, 'Cashier cannot allocate cloud stock');
  e := store_tests.event(db,'sale.create',p || jsonb_build_object('reference',gen_random_uuid(),'receipt_number','S-test-valid-sale'));
  r := public.apply_event(e);
  perform store_tests.assert(r ->> 'status' = 'synced', 'allocated cash sale synchronizes');
  retry := public.apply_event(e || '{"status":"review","message":"local status only"}'::jsonb);
  perform store_tests.assert(retry = r and (select count(*) = 1 from public.sales), 'identical event retry returns same receipt result once');
  v_before := (select next_sequence from public.devices where id = db);
  begin
    perform public.apply_event(jsonb_set(e,'{payload,payment,amount_cents}','3000'));
    raise exception using errcode = 'XX000', message = 'FAIL: reused ID accepted changed payment';
  exception when sqlstate 'P0001' then null; end;
  perform store_tests.assert((select next_sequence = v_before from public.devices where id = db), 'different payload cannot reuse event ID or advance sequence');
  perform store_tests.assert((select stock = 18 and reserved = 2 and allocated = 16 from public.products where id = 101)
    and (select remaining = 8 from public.stock_allocations where device_id = db and product_id = 101), 'sale consumes device quota and physical stock once');
  perform store_tests.assert((select paid_by = 20 and user_id = 20 and total_cents = 2000 from public.sales where receipt_number = 'S-test-valid-sale'), 'Cashier sale collector and frozen price are server-attributed');

  p := jsonb_build_object('reference',gen_random_uuid(),'receipt_number','S-test-gcash','channel','messenger','items',
    jsonb_build_array(jsonb_build_object('product_id',103,'quantity',2,'price_version_id',service_price)),
    'payment',jsonb_build_object('method','gcash','amount_cents',1000,'reference',' gcash001 ','verified',true));
  r := public.apply_event(store_tests.event(db,'sale.create',p));
  perform store_tests.assert(r ->> 'status' = 'synced' and (select payment_reference = 'GCASH001' and change_cents = 0 from public.sales where receipt_number = 'S-test-gcash'), 'verified exact GCash normalizes reference and records no change');
  r := public.apply_event(store_tests.event(db,'sale.create',p || jsonb_build_object('reference',gen_random_uuid(),'receipt_number','S-test-duplicate-gcash')));
  perform store_tests.assert(r ->> 'status' = 'review' and (select count(*) = 2 from public.sales), 'duplicate normalized GCash reference cannot create a sale');
  r := public.apply_event(store_tests.event(db,'sale.create',jsonb_set(p || jsonb_build_object('reference',gen_random_uuid(),'receipt_number','S-test-unverified'),'{payment,verified}','false')));
  perform store_tests.assert(r ->> 'status' = 'review', 'unverified GCash is rejected without automatic gateway verification');

  p := jsonb_build_object('reference',gen_random_uuid(),'receipt_number','S-test-rollback','channel','walk-in','items',
    jsonb_build_array(jsonb_build_object('product_id',101,'quantity',1,'price_version_id',old_price),
      jsonb_build_object('product_id',102,'quantity',7,'price_version_id',(select price_version_id from public.products where id = 102))),
    'payment',jsonb_build_object('method','cash','amount_cents',22000));
  e := store_tests.event(db,'sale.create',p);
  r := public.apply_event(e);
  perform store_tests.assert(r ->> 'status' = 'review' and (select stock = 18 and allocated = 16 from public.products where id = 101)
    and (select stock = 10 and allocated = 10 from public.products where id = 102), 'later line quota failure rolls back every earlier stock change');
  perform store_tests.assert((select payload = p and sequence = (e ->> 'sequence')::bigint from public.sync_events where id = (e ->> 'id')::uuid)
    and (select next_sequence = (e ->> 'sequence')::bigint + 1 from public.devices where id = db), 'failed event preserves full submitted financial data and advances sequence for review');
  v_before := (select next_sequence from public.devices where id = db);
  begin
    perform public.apply_event(jsonb_set(store_tests.event(db,'sale.create',p),'{sequence}',to_jsonb(v_before + 1)));
    raise exception using errcode = 'XX000', message = 'FAIL: out-of-order event accepted';
  exception when sqlstate 'P0001' then null; end;
  perform store_tests.assert((select next_sequence = v_before from public.devices where id = db), 'future device sequence cannot skip pending events');
  r := public.apply_event(store_tests.event(db,'sale.create',jsonb_set(p,'{items,0,price_cents}','1')));
  perform store_tests.assert(r ->> 'status' = 'review', 'browser price/totals fields are forbidden');
  r := public.apply_event(store_tests.event(db,'inventory.movement','{"product_id":101,"quantity":5,"reason":"Fictional forged restock"}'::jsonb));
  perform store_tests.assert(r ->> 'status' = 'review' and (select stock = 18 from public.products where id = 101), 'Cashier cannot alter inventory via event forgery');

  p := jsonb_build_object('reference',order_ref,'receipt_number','S-test-order','channel','messenger','fulfillment','delivery','payment_plan','collection',
    'customer_name','Fictional Customer','customer_phone','09000000000','delivery_address','Fictional address','notes','Fictional note',
    'delivery_fee_cents',500,'items',jsonb_build_array(jsonb_build_object('product_id',101,'quantity',3,'price_version_id',old_price)));
  r := public.apply_event(store_tests.event(db,'order.create',p));
  perform store_tests.assert(r ->> 'status' = 'synced' and (select reserved = 5 and allocated = 13 and stock = 18 from public.products where id = 101)
    and (select remaining = 5 from public.stock_allocations where device_id = db and product_id = 101), 'unpaid order converts device allocation to reservation without reducing physical stock');
  select id,version into v_order,v_version from public.orders where reference = order_ref;
  begin
    perform public.claim_order(db2,order_ref);
    raise exception using errcode = 'XX000', message = 'FAIL: same Cashier second device stole lease';
  exception when sqlstate 'P0001' then null; end;
  perform store_tests.assert((select device_id = db from public.orders where id = v_order), 'same staff second device cannot steal an offline order lease');
  r := public.apply_event(store_tests.event(db,'order.status',jsonb_build_object('reference',order_ref,'expected_version',v_version,'status','ready')));
  perform store_tests.assert(r ->> 'status' = 'synced', 'preparing order advances to ready');
  v_version := (select version from public.orders where id = v_order);
  r := public.apply_event(store_tests.event(db,'order.status',jsonb_build_object('reference',order_ref,'expected_version',v_version,'status','completed')));
  perform store_tests.assert(r ->> 'status' = 'review' and (select status = 'ready' from public.orders where id = v_order), 'fulfillment cannot skip dispatch or complete unpaid');

  perform store_tests.actor(a);
  p := (select jsonb_build_object('id',id,'expected_version',version,'sku',sku,'name','Updated Fictional Pencil','category',category,'kind',kind,
    'price_cents',1200,'reorder_level',reorder_level,'active',active,'description','Fictional description') from public.products where id = 101);
  r := public.apply_event(store_tests.event(da,'inventory.save',p));
  select price_version_id into new_price from public.products where id = 101;
  perform store_tests.assert(r ->> 'status' = 'synced' and new_price <> old_price, 'Admin price edit creates immutable server price version');
  perform store_tests.actor(b);
  snap := public.store_snapshot(db);
  perform store_tests.assert(exists(select 1 from jsonb_array_elements(snap -> 'price_grants') g where g ->> 'price_version_id' = old_price::text)
    and exists(select 1 from jsonb_array_elements(snap -> 'price_grants') g where g ->> 'price_version_id' = new_price::text), 'normal refresh preserves pending historical price grants');
  p := jsonb_build_object('reference',order_ref,'expected_version',v_version,'customer_name','Fictional corrected name','customer_phone','09000000000',
    'delivery_address','Fictional corrected address','notes','','delivery_fee_cents',500,'items',jsonb_build_array(
      jsonb_build_object('product_id',101,'quantity',4,'price_version_id',new_price),
      jsonb_build_object('product_id',103,'quantity',1,'price_version_id',service_price)));
  r := public.apply_event(store_tests.event(db,'order.edit',p));
  perform store_tests.assert(r ->> 'status' = 'synced' and (select subtotal_cents = 4500 and total_cents = 5000 from public.orders where id = v_order)
    and (select price_cents = 1000 and name = 'Fictional Pencil' from public.order_items where order_id = v_order and product_id = 101), 'retained order line keeps agreed price and name after inventory edit');
  perform store_tests.assert((select reserved = 6 and allocated = 12 from public.products where id = 101), 'unpaid order edit changes only quantity-difference reservation and quota');
  r := public.apply_event(store_tests.event(db,'order.edit',p));
  perform store_tests.assert(r ->> 'status' = 'review', 'stale expected order version cannot overwrite a newer edit');
  v_version := (select version from public.orders where id = v_order);
  r := public.apply_event(store_tests.event(db,'order.payment',jsonb_build_object('reference',order_ref,'expected_version',v_version,
    'receipt_number','S-test-order-payment','payment',jsonb_build_object('method','cash','amount_cents',6000))));
  perform store_tests.assert(r ->> 'status' = 'synced' and (select reserved = 2 and stock = 14 and allocated = 12 from public.products where id = 101)
    and (select remaining = 4 from public.stock_allocations where device_id = db and product_id = 101), 'order payment consumes reserved stock once without consuming allocation twice');
  perform store_tests.assert((select total_cents = 5000 and delivery_fee_cents = 500 and cash_cents = 6000 and change_cents = 1000 from public.sales where receipt_number = 'S-test-order-payment'), 'delivery payment freezes fee, cash and change on receipt');
  saved_snapshot := (select to_jsonb(s) from public.sales s where receipt_number = 'S-test-order-payment');
  v_version := (select version from public.orders where id = v_order);
  r := public.apply_event(store_tests.event(db,'order.payment',jsonb_build_object('reference',order_ref,'expected_version',v_version,
    'receipt_number','S-test-double-pay','payment',jsonb_build_object('method','cash','amount_cents',6000))));
  perform store_tests.assert(r ->> 'status' = 'review' and (select count(*) = 1 from public.sales where reference = order_ref), 'new payment event cannot pay a paid order again');
  p := jsonb_build_object('reference',order_ref,'expected_version',v_version,'customer_name','Fictional paid correction','customer_phone','09000000000',
    'delivery_address','Fictional paid corrected address','notes','Details corrected');
  r := public.apply_event(store_tests.event(db,'order.edit',p));
  perform store_tests.assert(r ->> 'status' = 'synced' and saved_snapshot = (select to_jsonb(s) from public.sales s where receipt_number = 'S-test-order-payment'), 'paid customer correction preserves entire receipt snapshot');
  v_version := (select version from public.orders where id = v_order);
  r := public.apply_event(store_tests.event(db,'order.edit',p || jsonb_build_object('expected_version',v_version,'delivery_fee_cents',700)));
  perform store_tests.assert(r ->> 'status' = 'review', 'paid financial fee edit refused');
  r := public.apply_event(store_tests.event(db,'order.status',jsonb_build_object('reference',order_ref,'expected_version',v_version,'status','cancelled','cancel_reason','Fictional return')));
  perform store_tests.assert(r ->> 'status' = 'review', 'paid cancellation/refund refused');
  r := public.apply_event(store_tests.event(db,'order.status',jsonb_build_object('reference',order_ref,'expected_version',v_version,'status','out_for_delivery')));
  perform store_tests.assert(r ->> 'status' = 'synced', 'ready delivery advances to dispatched');
  v_version := (select version from public.orders where id = v_order);
  r := public.apply_event(store_tests.event(db,'order.edit',p || jsonb_build_object('expected_version',v_version)));
  perform store_tests.assert(r ->> 'status' = 'review', 'dispatched order cannot be edited');
  r := public.apply_event(store_tests.event(db,'order.status',jsonb_build_object('reference',order_ref,'expected_version',v_version,'status','completed')));
  perform store_tests.assert(r ->> 'status' = 'synced' and (select status = 'completed' from public.orders where id = v_order), 'paid dispatched delivery can complete');

  p := jsonb_build_object('reference',cancel_ref,'receipt_number','S-test-cancel','channel','walk-in','fulfillment','delivery','payment_plan','collection',
    'customer_name','Fictional cancellation','customer_phone','09000000000','delivery_address','Fictional address','notes','',
    'delivery_fee_cents',0,'items',jsonb_build_array(jsonb_build_object('product_id',102,'quantity',2,'price_version_id',(select price_version_id from public.products where id = 102))));
  r := public.apply_event(store_tests.event(db,'order.create',p));
  perform store_tests.assert(r ->> 'status' = 'synced', 'second unpaid delivery can reserve allocated goods');
  for v_status in select unnest(array['ready','out_for_delivery']) loop
    r := public.apply_event(store_tests.event(db,'order.status',jsonb_build_object('reference',cancel_ref,
      'expected_version',(select version from public.orders where reference = cancel_ref),'status',v_status)));
    perform store_tests.assert(r ->> 'status' = 'synced', 'unpaid delivery step ' || v_status);
  end loop;
  v_version := (select version from public.orders where reference = cancel_ref);
  r := public.apply_event(store_tests.event(db,'order.status',jsonb_build_object('reference',cancel_ref,'expected_version',v_version,
    'status','cancelled','cancel_reason','Fictional customer cancellation','goods_returned',false)));
  perform store_tests.assert(r ->> 'status' = 'review' and (select reserved = 2 from public.products where id = 102), 'dispatched unpaid cancellation requires returned-goods confirmation');
  r := public.apply_event(store_tests.event(db,'order.status',jsonb_build_object('reference',cancel_ref,'expected_version',v_version,
    'status','cancelled','cancel_reason','Fictional customer cancellation','goods_returned',true)));
  perform store_tests.assert(r ->> 'status' = 'synced' and (select reserved = 0 and allocated = 10 and stock = 10 from public.products where id = 102)
    and (select remaining = 6 from public.stock_allocations where device_id = db and product_id = 102), 'cancel restores only this order reservation to claiming device quota');

  perform store_tests.actor(a);
  saved_snapshot := (select to_jsonb(i) from public.order_items i where id = 700);
  r := public.apply_event(store_tests.event(da,'order.handoff',jsonb_build_object('reference','50000000-0000-4000-8000-000000000500',
    'expected_version',1,'assigned_cashier_id',20)));
  perform store_tests.assert(r ->> 'status' = 'synced' and saved_snapshot = (select to_jsonb(i) from public.order_items i where id = 700)
    and (select user_id = 10 and assigned_by = 10 and assigned_cashier_id = 20 and created_at = '2026-01-01T00:00:00Z'::timestamptz from public.orders where id = 500), 'Admin handoff preserves historical item, creator and timestamps');
  perform store_tests.actor(b);
  perform public.claim_order(db2,'50000000-0000-4000-8000-000000000500');
  v_version := (select version from public.orders where id = 500);
  perform store_tests.actor(a);
  r := public.apply_event(store_tests.event(da,'order.handoff',jsonb_build_object('reference','50000000-0000-4000-8000-000000000500',
    'expected_version',v_version,'assigned_cashier_id',30)));
  perform store_tests.assert(r ->> 'status' = 'review', 'Admin cannot reassign a leased offline order');
  perform store_tests.actor(b);
  r := public.apply_event(store_tests.event(db2,'order.payment',jsonb_build_object('reference','50000000-0000-4000-8000-000000000500',
    'expected_version',v_version,'receipt_number','S-test-legacy-paid','payment',jsonb_build_object('method','cash','amount_cents',1500))));
  perform store_tests.assert(r ->> 'status' = 'synced' and (select user_id = 10 and paid_by = 20 and total_cents = 1400 from public.sales where receipt_number = 'S-test-legacy-paid'), 'assigned Cashier collects legacy Admin order at original price with original creator');
  perform store_tests.assert((select name = 'Original Fictional Pencil' and sku = 'OLD-PENCIL' and price_cents = 700 from public.sale_items where sale_id =
    (select id from public.sales where receipt_number = 'S-test-legacy-paid')), 'paid legacy receipt retains original line snapshot rather than new catalog price');
  perform public.release_order(db2,'50000000-0000-4000-8000-000000000500');
  v_version := (select version from public.orders where id = 500);
  perform store_tests.actor(a);
  r := public.apply_event(store_tests.event(da,'order.handoff',jsonb_build_object('reference','50000000-0000-4000-8000-000000000500',
    'expected_version',v_version,'assigned_cashier_id',30)));
  perform store_tests.assert(r ->> 'status' = 'synced', 'released unfinished Admin-origin order can be reassigned');
  perform store_tests.actor(b);
  snap := public.store_snapshot(db);
  perform store_tests.assert(not exists(select 1 from jsonb_array_elements(snap -> 'orders') o where o ->> 'id' = '500'), 'former assignee loses order snapshot access');
  perform store_tests.assert(exists(select 1 from jsonb_array_elements(snap -> 'sales') s where s ->> 'receipt_number' = 'S-test-legacy-paid'), 'original collector retains Admin-origin sales history after reassignment');
  r := public.apply_event(store_tests.event(db,'order.status',jsonb_build_object('reference','50000000-0000-4000-8000-000000000500',
    'expected_version',(select version from public.orders where id = 500),'status','ready')));
  perform store_tests.assert(r ->> 'status' = 'review', 'former assignee cannot advance the reassigned order');
  perform store_tests.actor(c);
  snap := public.store_snapshot(dc);
  perform store_tests.assert(exists(select 1 from jsonb_array_elements(snap -> 'orders') o where o ->> 'id' = '500')
    and not exists(select 1 from jsonb_array_elements(snap -> 'sales') s where s ->> 'receipt_number' = 'S-test-legacy-paid'), 'new assignee sees order but revenue stays with original collector');
  perform store_tests.assert(exists(select 1 from jsonb_array_elements(snap -> 'receipts') s where s ->> 'receipt_number' = 'S-test-legacy-paid'), 'new assignee receives separate paid receipt without report revenue');

  perform store_tests.actor(a);
  p := jsonb_build_object('client_reference',offline_item,'sku','TEST-OFFLINE','name','Fictional new offline item','category','Writing','kind','product',
    'price_cents',2500,'reorder_level',3,'active',true,'description','');
  r := public.apply_event(store_tests.event(da,'inventory.save',p));
  perform store_tests.assert(r ->> 'status' = 'synced', 'Admin offline new item creates a server ID and stable client reference');
  select id into v_product from public.products where client_reference = offline_item;
  r := public.apply_event(store_tests.event(da,'inventory.movement',jsonb_build_object('product_id',-123,'product_reference',offline_item,
    'quantity',5,'reason','Fictional new-item opening stock')));
  perform store_tests.assert(r ->> 'status' = 'synced' and (select stock = 5 and version = 2 from public.products where id = v_product), 'dependent offline restock resolves provisional ID by stable reference');
  r := public.apply_event(store_tests.event(da,'inventory.save',p || jsonb_build_object('id',-123,'expected_version',2,'name','Fictional renamed offline item')));
  perform store_tests.assert(r ->> 'status' = 'synced' and (select version = 3 and name = 'Fictional renamed offline item' from public.products where id = v_product), 'dependent offline edit resolves provisional ID and version');
  r := public.apply_event(store_tests.event(da,'inventory.movement','{"product_id":101,"quantity":-1,"reason":"Fictional invalid usage"}'::jsonb));
  perform store_tests.assert(r ->> 'status' = 'review' and (select stock = reserved + allocated from public.products where id = 101), 'Admin usage cannot consume allocated or reserved stock');
  r := public.apply_event(store_tests.event(da,'inventory.movement','{"product_id":104,"quantity":-3,"reason":"Fictional printing supply usage"}'::jsonb));
  perform store_tests.assert(r ->> 'status' = 'synced' and (select stock = 17 from public.products where id = 104), 'explicit internal-supply usage is supported');
  perform store_tests.assert((select stock = 0 and reserved = 0 and allocated = 0 from public.products where id = 103), 'service sales never consume stock automatically');
  p := (select jsonb_build_object('id',id,'expected_version',version,'sku',sku,'name',name,'category',category,'kind','service',
    'price_cents',price_cents,'reorder_level',reorder_level,'active',active,'description',description) from public.products where id = 101);
  r := public.apply_event(store_tests.event(da,'inventory.save',p));
  perform store_tests.assert(r ->> 'status' = 'review' and (select kind = 'product' from public.products where id = 101), 'existing item kind remains immutable');

  r := public.apply_event(store_tests.event(da,'inventory.movement','{"product_id":101,"quantity":1,"reason":"Fictional clean-device restock"}'::jsonb));
  perform store_tests.assert(r ->> 'status' = 'synced', 'Admin restocks unallocated clean-device unit');
  perform public.allocate_stock(db2,101,1);
  perform store_tests.actor(b);
  perform public.refresh_price_grants(db2,(select next_sequence from public.devices where id = db2));
  perform store_tests.assert(exists(select 1 from public.device_price_grants where device_id = db2 and price_version_id = old_price), 'explicit price refresh retains historical grant tied to remaining quota');
  perform public.release_allocation(db2,101);
  perform public.refresh_price_grants(db2,(select next_sequence from public.devices where id = db2));
  perform store_tests.assert(not exists(select 1 from public.device_price_grants where device_id = db2 and price_version_id = old_price)
    and (select allocated = 12 from public.products where id = 101), 'owner synchronized release frees unused quota and then allows old grant revocation');
  begin
    perform public.release_allocation(db,101);
    raise exception using errcode = 'XX000', message = 'FAIL: reviewed device released unverified quota';
  exception when sqlstate 'P0001' then null; end;
  perform store_tests.assert((select remaining = 4 from public.stock_allocations where device_id = db and product_id = 101), 'unresolved review blocks owner allocation release');
  begin
    perform public.refresh_price_grants(db,(select next_sequence from public.devices where id = db));
    raise exception using errcode = 'XX000', message = 'FAIL: reviewed device revoked original price grants';
  exception when sqlstate 'P0001' then null; end;
  perform store_tests.assert(exists(select 1 from public.device_price_grants where device_id = db and price_version_id = old_price), 'unresolved review blocks price-grant revocation');
  begin
    perform public.refresh_price_grants(db2,1);
    raise exception using errcode = 'XX000', message = 'FAIL: stale price-refresh sequence accepted';
  exception when sqlstate 'P0001' then null; end;
  perform store_tests.assert(true, 'stale explicit refresh sequence rejected');
  begin
    perform public.register_device(dc,'Fictional attempted takeover');
    raise exception using errcode = 'XX000', message = 'FAIL: different owner took device';
  exception when insufficient_privilege then null; end;
  perform store_tests.assert((select staff_id = 30 from public.devices where id = dc), 'device ID cannot be rebound to a different staff account');
end;
$$;

-- Exercise actual RLS/table privileges using an unprivileged authenticated role.
select store_tests.actor('10000000-0000-4000-8000-000000000020');
grant usage on schema store_tests to authenticated, anon;
grant execute on function store_tests.assert(boolean,text) to authenticated, anon;
grant select,insert on store_tests.checks to authenticated, anon;
set local role authenticated;
do $$
begin
  perform store_tests.assert((select count(*) = 1 from public.profiles), 'Cashier RLS hides other staff emails and profiles');
  perform store_tests.assert((select count(*) = 0 from public.orders where id = 500), 'Cashier RLS revokes reassigned order access');
  perform store_tests.assert((select count(*) = 1 from public.sales where receipt_number = 'S-test-legacy-paid'), 'collector RLS retains original Admin-origin receipt');
  perform store_tests.assert((select count(*) = 0 from public.products where kind = 'consumable'), 'Cashier RLS hides internal supplies');
  begin
    update public.products set stock = 999 where id = 101;
    raise exception using errcode = 'XX000', message = 'FAIL: direct stock write accepted';
  exception when insufficient_privilege then null; end;
  perform store_tests.assert(true, 'authenticated direct stock writes forbidden');
  begin
    delete from public.sales;
    raise exception using errcode = 'XX000', message = 'FAIL: receipt history deletion accepted';
  exception when insufficient_privilege then null; end;
  perform store_tests.assert(true, 'authenticated receipt deletion forbidden');
  begin
    perform store_private.consume_allocation('20000000-0000-4000-8000-000000000002',101,1,false);
    raise exception using errcode = 'XX000', message = 'FAIL: private stock helper exposed';
  exception when insufficient_privilege then null; end;
  perform store_tests.assert(true, 'private mutation helpers cannot be invoked by clients');
end;
$$;
reset role;

select store_tests.actor('10000000-0000-4000-8000-000000000030');
set local role authenticated;
select store_tests.assert((select count(*) = 1 from public.orders where id = 500), 'current-assignee RLS sees Admin-origin order');
select store_tests.assert((select count(*) = 1 from public.sales where receipt_number = 'S-test-legacy-paid'), 'current assignee RLS can view receipt without moving revenue');
reset role;

select store_tests.actor('10000000-0000-4000-8000-000000000040');
set local role authenticated;
do $$
begin
  perform store_tests.assert((select count(*) = 0 from public.profiles) and (select count(*) = 0 from public.orders), 'inactive profile RLS rejects all private data');
  begin
    perform public.register_device(gen_random_uuid(),'Fictional disabled attempt');
    raise exception using errcode = 'XX000', message = 'FAIL: disabled staff registered device';
  exception when insufficient_privilege then null; end;
  perform store_tests.assert(true, 'inactive profile RPC access rejected');
end;
$$;
reset role;

do $$
declare device uuid:='20000000-0000-4000-8000-000000000004'; grant_id uuid; recorded timestamptz:=now()-interval '2 days'; submission jsonb; result jsonb;
begin
  perform store_tests.actor('10000000-0000-4000-8000-000000000030');
  select g.price_version_id into grant_id from public.device_price_grants g join public.price_versions v on v.id=g.price_version_id
    where g.device_id=device and v.product_id=103 and v.price_cents=500 limit 1;
  submission:=store_tests.event(device,'sale.create',jsonb_build_object('reference',gen_random_uuid(),'receipt_number','OFFLINE-DATE-FIXTURE','channel','walk-in',
    'items',jsonb_build_array(jsonb_build_object('product_id',103,'quantity',1,'price_version_id',grant_id)),
    'payment',jsonb_build_object('method','cash','amount_cents',500)));
  submission:=jsonb_set(submission,'{captured_at}',to_jsonb(recorded));
  result:=public.apply_event(submission);
  perform store_tests.assert(result->>'status'='synced','backlogged offline sale is accepted within its approved grant');
  perform store_tests.assert((select created_at=recorded from public.sales where receipt_number='OFFLINE-DATE-FIXTURE'),'receipt keeps captured date after later synchronization');
  perform store_tests.assert((select created_at=now() and captured_at=recorded from public.sync_events where id=(submission->>'id')::uuid),'sync audit preserves both capture and server receipt times');
end;
$$;

select set_config('request.jwt.claim.sub','',false);
select set_config('request.jwt.claims','{}',false);
set local role anon;
do $$
declare v_catalog jsonb;
begin
  v_catalog := public.public_catalog();
  perform store_tests.assert(jsonb_array_length(v_catalog) > 0 and not exists(select 1 from jsonb_array_elements(v_catalog) item
    where item ?| array['stock','reserved','allocated','user_id','auth_id','email','customer_name','customer_phone','device_id']), 'guest catalog projection contains no stock, customer, or staff data');
  perform store_tests.assert(exists(select 1 from jsonb_array_elements(v_catalog) item where item ->> 'id' = '103' and item ->> 'available' = 'true'), 'guest service availability is true without exposing counts');
  perform store_tests.assert(exists(select 1 from jsonb_array_elements(v_catalog) item where item ->> 'id' = '102' and item ->> 'available' = 'true'), 'allocated unsold product remains available for a staff-confirmed inquiry');
  begin
    perform 1 from public.products;
    raise exception using errcode = 'XX000', message = 'FAIL: anonymous private table access accepted';
  exception when insufficient_privilege then null; end;
  perform store_tests.assert(true, 'anonymous clients cannot query private tables');
  begin
    perform public.store_snapshot(gen_random_uuid());
    raise exception using errcode = 'XX000', message = 'FAIL: anonymous staff RPC accepted';
  exception when insufficient_privilege then null; end;
  perform store_tests.assert(true, 'anonymous clients cannot call staff mutation or snapshot RPCs');
end;
$$;
reset role;

select store_tests.assert(not exists(select 1 from public.products where stock < reserved + allocated or stock < 0)
  and not exists(select 1 from public.stock_allocations where remaining < 0), 'all workflows preserve nonnegative stock reservation/allocation invariants');
select store_tests.assert(not exists(select 1 from public.products p where p.allocated <> coalesce((select sum(remaining) from public.stock_allocations a where a.product_id = p.id),0)), 'global allocated totals match summed device remaining quotas');
commit;
