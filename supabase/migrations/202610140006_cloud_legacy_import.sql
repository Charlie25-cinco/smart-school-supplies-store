begin;

create table store_private.legacy_imports (
  id uuid primary key,
  source_digest text not null unique check (source_digest ~ '^[0-9a-f]{64}$'),
  dataset_digest text not null,
  counts jsonb not null,
  completed_at timestamptz not null default now()
);
revoke all on store_private.legacy_imports from public, anon, authenticated;

create function store_private.require_import_server() returns void
language plpgsql set search_path = pg_catalog as $$
begin
  if (auth.jwt() ->> 'role') is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'Private server migration access is required.';
  end if;
end;
$$;
revoke all on function store_private.require_import_server() from public, anon, authenticated;

create function public.legacy_import_status(p_import_id uuid, p_source_digest text) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_existing store_private.legacy_imports;
begin
  perform store_private.require_import_server();
  if p_import_id is null or p_source_digest is null or p_source_digest !~ '^[0-9a-f]{64}$' then perform store_private.fail('Submit a valid private migration identity.'); end if;
  perform pg_advisory_xact_lock(hashtextextended('legacy-bootstrap', 3));
  select * into v_existing from store_private.legacy_imports where id = p_import_id;
  if found then
    if v_existing.source_digest <> p_source_digest then perform store_private.fail('This import identity belongs to a different private snapshot.'); end if;
    return jsonb_build_object('status', 'complete', 'counts', v_existing.counts);
  end if;
  if exists(select 1 from store_private.legacy_imports) or exists(select 1 from public.profiles)
    or exists(select 1 from public.products) or exists(select 1 from public.orders) or exists(select 1 from public.sales)
    or exists(select 1 from public.devices) or exists(select 1 from public.sync_events) then
    perform store_private.fail('The target store is not empty. No record may be replaced or merged automatically.');
  end if;
  return jsonb_build_object('status', 'empty');
end;
$$;

create function public.import_legacy(p_import_id uuid, p_source_digest text, p_dataset jsonb) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_status jsonb; v_counts jsonb := '{}'; v_table text; v_row jsonb; v_fields text[];
  v_dataset_digest text; v_existing store_private.legacy_imports; v_max bigint; v_sequence text;
  v_keys jsonb := '{
    "profiles":["id","auth_id","name","email","role","active","created_at","updated_at"],
    "products":["id","sku","name","category","kind","price_cents","stock","reserved","reorder_level","active","description","created_at","updated_at"],
    "sales":["id","reference","receipt_number","user_id","paid_by","channel","subtotal_cents","delivery_fee_cents","total_cents","cash_cents","change_cents","payment_method","payment_reference","created_at","updated_at"],
    "orders":["id","reference","user_id","sale_id","paid_by","paid_at","assigned_cashier_id","assigned_by","assigned_at","assignment_version","channel","fulfillment","payment_plan","status","customer_name","customer_phone","delivery_address","notes","cancel_reason","subtotal_cents","delivery_fee_cents","total_cents","created_at","updated_at"],
    "sale_items":["id","sale_id","product_id","name","sku","kind","quantity","price_cents","total_cents"],
    "order_items":["id","order_id","product_id","name","sku","kind","quantity","price_cents","total_cents"],
    "stock_movements":["id","product_id","user_id","sale_id","quantity","reason","created_at","updated_at"]
  }'::jsonb;
begin
  perform store_private.require_import_server();
  v_status := public.legacy_import_status(p_import_id, p_source_digest);
  perform store_private.object_keys(p_dataset, array['profiles','products','sales','orders','sale_items','order_items','stock_movements']);
  if octet_length(p_dataset::text) > 16000000 then perform store_private.fail('This dataset exceeds the supported atomic migration size.'); end if;
  v_dataset_digest := encode(sha256(convert_to(p_dataset::text, 'UTF8')), 'hex');
  if v_status ->> 'status' = 'complete' then
    select * into v_existing from store_private.legacy_imports where id = p_import_id;
    if v_existing.dataset_digest <> v_dataset_digest then perform store_private.fail('The completed import dataset cannot be changed.'); end if;
    return v_status;
  end if;
  for v_table in select jsonb_object_keys(v_keys) loop
    if jsonb_typeof(p_dataset -> v_table) is distinct from 'array' then perform store_private.fail('The migration dataset is incomplete.'); end if;
    if jsonb_array_length(p_dataset -> v_table) > 100000 then perform store_private.fail('A migration table exceeds the supported row limit.'); end if;
    select array_agg(value) into v_fields from jsonb_array_elements_text(v_keys -> v_table);
    for v_row in select value from jsonb_array_elements(p_dataset -> v_table) loop
      -- Reject password/hash/remember-token fields before any public insert.
      perform store_private.object_keys(v_row, v_fields);
    end loop;
    v_counts := v_counts || jsonb_build_object(v_table, jsonb_array_length(p_dataset -> v_table));
  end loop;
  if jsonb_array_length(p_dataset -> 'profiles') = 0 then perform store_private.fail('Import a privately provisioned staff roster.'); end if;
  -- Only Auth users provably created for this exact private snapshot are linked.
  if exists(select 1 from auth.users u where u.raw_app_meta_data ->> 'legacy_import_id' is distinct from p_import_id::text
    or u.raw_app_meta_data ->> 'legacy_source_digest' is distinct from p_source_digest)
    or exists(select 1 from jsonb_array_elements(p_dataset -> 'profiles') p left join auth.users u on u.id = (p ->> 'auth_id')::uuid
      where u.id is null or u.raw_app_meta_data ->> 'legacy_staff_id' is distinct from p ->> 'id'
        or lower(u.email) is distinct from lower(p ->> 'email'))
    or (select count(*) from auth.users) <> jsonb_array_length(p_dataset -> 'profiles') then
    perform store_private.fail('The target Auth roster does not match this private migration.');
  end if;

  insert into public.profiles(id,auth_id,name,email,role,active,created_at,updated_at)
    select id,auth_id,name,email,role,active,created_at,updated_at from jsonb_to_recordset(p_dataset -> 'profiles') as r
      (id bigint,auth_id uuid,name text,email text,role text,active boolean,created_at timestamptz,updated_at timestamptz);
  insert into public.products(id,sku,name,category,kind,price_cents,stock,reserved,reorder_level,active,description,created_at,updated_at)
    select id,sku,name,category,kind,price_cents,stock,reserved,reorder_level,active,description,created_at,updated_at from jsonb_to_recordset(p_dataset -> 'products') as r
      (id bigint,sku text,name text,category text,kind text,price_cents bigint,stock bigint,reserved bigint,reorder_level bigint,active boolean,description text,created_at timestamptz,updated_at timestamptz);
  insert into public.sales(id,reference,receipt_number,user_id,paid_by,channel,subtotal_cents,delivery_fee_cents,total_cents,cash_cents,change_cents,payment_method,payment_reference,created_at,updated_at)
    select id,reference,receipt_number,user_id,paid_by,channel,subtotal_cents,delivery_fee_cents,total_cents,cash_cents,change_cents,payment_method,payment_reference,created_at,updated_at from jsonb_to_recordset(p_dataset -> 'sales') as r
      (id bigint,reference uuid,receipt_number text,user_id bigint,paid_by bigint,channel text,subtotal_cents bigint,delivery_fee_cents bigint,total_cents bigint,cash_cents bigint,change_cents bigint,payment_method text,payment_reference text,created_at timestamptz,updated_at timestamptz);
  insert into public.orders(id,reference,user_id,sale_id,paid_by,paid_at,assigned_cashier_id,assigned_by,assigned_at,assignment_version,channel,fulfillment,payment_plan,status,customer_name,customer_phone,delivery_address,notes,cancel_reason,subtotal_cents,delivery_fee_cents,total_cents,created_at,updated_at)
    select id,reference,user_id,sale_id,paid_by,paid_at,assigned_cashier_id,assigned_by,assigned_at,assignment_version,channel,fulfillment,payment_plan,status,customer_name,customer_phone,delivery_address,notes,cancel_reason,subtotal_cents,delivery_fee_cents,total_cents,created_at,updated_at from jsonb_to_recordset(p_dataset -> 'orders') as r
      (id bigint,reference uuid,user_id bigint,sale_id bigint,paid_by bigint,paid_at timestamptz,assigned_cashier_id bigint,assigned_by bigint,assigned_at timestamptz,assignment_version bigint,channel text,fulfillment text,payment_plan text,status text,customer_name text,customer_phone text,delivery_address text,notes text,cancel_reason text,subtotal_cents bigint,delivery_fee_cents bigint,total_cents bigint,created_at timestamptz,updated_at timestamptz);
  insert into public.sale_items(id,sale_id,product_id,name,sku,kind,quantity,price_cents,total_cents)
    select id,sale_id,product_id,name,sku,kind,quantity,price_cents,total_cents from jsonb_to_recordset(p_dataset -> 'sale_items') as r
      (id bigint,sale_id bigint,product_id bigint,name text,sku text,kind text,quantity bigint,price_cents bigint,total_cents bigint);
  insert into public.order_items(id,order_id,product_id,name,sku,kind,quantity,price_cents,total_cents)
    select id,order_id,product_id,name,sku,kind,quantity,price_cents,total_cents from jsonb_to_recordset(p_dataset -> 'order_items') as r
      (id bigint,order_id bigint,product_id bigint,name text,sku text,kind text,quantity bigint,price_cents bigint,total_cents bigint);
  insert into public.stock_movements(id,product_id,user_id,sale_id,quantity,reason,created_at,updated_at)
    select id,product_id,user_id,sale_id,quantity,reason,created_at,updated_at from jsonb_to_recordset(p_dataset -> 'stock_movements') as r
      (id bigint,product_id bigint,user_id bigint,sale_id bigint,quantity bigint,reason text,created_at timestamptz,updated_at timestamptz);

  -- Verify conservation/snapshot consistency before the transaction becomes visible.
  if exists(select 1 from public.products p where p.reserved <> coalesce((select sum(i.quantity) from public.order_items i
    join public.orders o on o.id = i.order_id where i.product_id = p.id and i.kind = 'product' and o.sale_id is null and o.status <> 'cancelled'),0))
    or exists(select 1 from public.sales s where s.subtotal_cents <> coalesce((select sum(total_cents) from public.sale_items where sale_id = s.id),0))
    or exists(select 1 from public.orders o where o.subtotal_cents <> coalesce((select sum(total_cents) from public.order_items where order_id = o.id),0)) then
    perform store_private.fail('Imported stock reservations or frozen totals are inconsistent. The whole import was rolled back.');
  end if;
  if exists(select 1 from public.orders o join public.sales s on s.id = o.sale_id where o.reference <> s.reference or o.user_id <> s.user_id
    or o.paid_by <> s.paid_by or o.total_cents <> s.total_cents or o.delivery_fee_cents <> s.delivery_fee_cents or o.channel <> s.channel)
    or exists(select 1 from public.orders o join public.sales s on s.reference = o.reference where o.sale_id is distinct from s.id)
    or exists(select 1 from public.orders o join public.order_items i on i.order_id = o.id left join public.sale_items si
      on si.sale_id = o.sale_id and si.product_id = i.product_id where o.sale_id is not null and
      (si.id is null or (i.name,i.sku,i.kind,i.quantity,i.price_cents,i.total_cents) is distinct from (si.name,si.sku,si.kind,si.quantity,si.price_cents,si.total_cents)))
    or exists(select 1 from public.orders o join public.sale_items si on si.sale_id = o.sale_id left join public.order_items i
      on i.order_id = o.id and i.product_id = si.product_id where i.id is null) then
    perform store_private.fail('Imported paid order snapshots differ from their original receipts. The whole import was rolled back.');
  end if;
  foreach v_table in array array['profiles','products','sales','orders','sale_items','order_items','stock_movements'] loop
    execute format('select max(id) from public.%I',v_table) into v_max;
    v_sequence := pg_get_serial_sequence('public.' || v_table, 'id');
    perform setval(v_sequence,coalesce(v_max,1),v_max is not null);
  end loop;
  insert into store_private.legacy_imports(id,source_digest,dataset_digest,counts) values(p_import_id,p_source_digest,v_dataset_digest,v_counts);
  return jsonb_build_object('status','complete','counts',v_counts);
end;
$$;

revoke all on function public.legacy_import_status(uuid,text), public.import_legacy(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.legacy_import_status(uuid,text), public.import_legacy(uuid,text,jsonb) to service_role;
commit;
