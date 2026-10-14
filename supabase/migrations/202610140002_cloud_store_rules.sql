begin;

create function store_private.fail(p_message text) returns void
language plpgsql set search_path = pg_catalog as $$
begin raise exception using errcode = 'P0001', message = p_message; end;
$$;

create function store_private.object_keys(p_data jsonb, p_keys text[]) returns void
language plpgsql set search_path = pg_catalog as $$
begin
  if jsonb_typeof(p_data) is distinct from 'object' then
    perform store_private.fail('Submit a valid object.');
  end if;
  if exists (select 1 from jsonb_object_keys(p_data) k where not (k = any(p_keys))) then
    perform store_private.fail('Unsupported fields were submitted.');
  end if;
end;
$$;

create function store_private.integer_field(p_data jsonb, p_key text, p_min bigint, p_max bigint) returns bigint
language plpgsql set search_path = pg_catalog as $$
declare v_number numeric;
begin
  if jsonb_typeof(p_data -> p_key) is distinct from 'number' or (p_data ->> p_key) !~ '^-?[0-9]+$' then
    perform store_private.fail('Enter whole numbers within the supported range.');
  end if;
  v_number := (p_data ->> p_key)::numeric;
  if v_number < p_min or v_number > p_max then
    perform store_private.fail('Enter whole numbers within the supported range.');
  end if;
  return v_number::bigint;
end;
$$;

create function store_private.text_field(p_data jsonb, p_key text, p_max integer, p_required boolean default true) returns text
language plpgsql set search_path = pg_catalog as $$
declare v_text text;
begin
  if not p_required and (not (p_data ? p_key) or p_data -> p_key = 'null'::jsonb) then return ''; end if;
  if jsonb_typeof(p_data -> p_key) is distinct from 'string' then
    perform store_private.fail('Enter valid text for all required fields.');
  end if;
  v_text := p_data ->> p_key;
  if length(v_text) > p_max or (p_required and length(btrim(v_text)) = 0) then
    perform store_private.fail('Required text is empty or exceeds the supported length.');
  end if;
  return v_text;
end;
$$;

create function store_private.uuid_field(p_data jsonb, p_key text) returns uuid
language plpgsql set search_path = pg_catalog as $$
declare v_text text;
begin
  v_text := store_private.text_field(p_data, p_key, 36);
  if v_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    perform store_private.fail('Submit a valid reference.');
  end if;
  return v_text::uuid;
end;
$$;

create function store_private.boolean_field(p_data jsonb, p_key text) returns boolean
language plpgsql set search_path = pg_catalog as $$
begin
  if jsonb_typeof(p_data -> p_key) is distinct from 'boolean' then
    perform store_private.fail('Submit a valid yes or no value.');
  end if;
  return (p_data ->> p_key)::boolean;
end;
$$;

create function store_private.current_staff_id() returns bigint
language sql stable security definer set search_path = pg_catalog, public as $$
  select id from public.profiles where auth_id = auth.uid() and active and role in ('admin', 'cashier')
$$;

create function store_private.current_role() returns text
language sql stable security definer set search_path = pg_catalog, public as $$
  select role from public.profiles where auth_id = auth.uid() and active and role in ('admin', 'cashier')
$$;

create function store_private.require_staff(p_role text default null) returns public.profiles
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_staff public.profiles;
begin
  select * into v_staff from public.profiles where auth_id = auth.uid() and active and role in ('admin', 'cashier');
  if not found or (p_role is not null and v_staff.role <> p_role) then
    raise exception using errcode = '42501', message = 'Active staff access is required for this action.';
  end if;
  return v_staff;
end;
$$;

create function store_private.require_device(p_device_id uuid, p_staff_id bigint, p_admin_override boolean default false) returns public.devices
language plpgsql set search_path = pg_catalog, public as $$
declare v_device public.devices;
begin
  select * into v_device from public.devices where id = p_device_id for update;
  if not found or (not p_admin_override and v_device.staff_id <> p_staff_id) or not v_device.active then
    raise exception using errcode = '42501', message = 'This device is not available to the current staff account.';
  end if;
  return v_device;
end;
$$;

create function store_private.require_clean_device(p_device_id uuid) returns void
language plpgsql set search_path = pg_catalog, public as $$
begin
  if exists(select 1 from public.sync_events where device_id = p_device_id and status = 'review' and resolved_at is null) then
    perform store_private.fail('Resolve this device\u2019s saved review events before releasing stock, orders, or price grants.');
  end if;
end;
$$;

create function store_private.can_read_order(p_order_id bigint) returns boolean
language sql stable security definer set search_path = pg_catalog, public as $$
  select exists (select 1 from public.orders o join public.profiles creator on creator.id = o.user_id
    where o.id = p_order_id and store_private.current_staff_id() is not null and
      (store_private.current_role() = 'admin' or o.user_id = store_private.current_staff_id()
        or (creator.role = 'admin' and o.assigned_cashier_id = store_private.current_staff_id())))
$$;

create function store_private.can_read_sale(p_sale_id bigint) returns boolean
language sql stable security definer set search_path = pg_catalog, public as $$
  select exists (select 1 from public.sales s join public.profiles creator on creator.id = s.user_id
    where s.id = p_sale_id and store_private.current_staff_id() is not null and
      (store_private.current_role() = 'admin' or s.user_id = store_private.current_staff_id()
        or (creator.role = 'admin' and (s.paid_by = store_private.current_staff_id()
          or exists (select 1 from public.orders o where o.sale_id = s.id and o.assigned_cashier_id = store_private.current_staff_id())))))
$$;

create function store_private.require_order(p_device_id uuid, p_staff_id bigint, p_reference uuid, p_version bigint) returns public.orders
language plpgsql set search_path = pg_catalog, public as $$
declare v_order public.orders;
begin
  select * into v_order from public.orders where reference = p_reference for update;
  if not found or not (v_order.user_id = p_staff_id or (v_order.assigned_cashier_id = p_staff_id and exists
    (select 1 from public.profiles where id = v_order.user_id and role = 'admin'))) then
    perform store_private.fail('This order is not available to the current Cashier.');
  end if;
  if v_order.device_id is distinct from p_device_id then
    perform store_private.fail('Claim this order online on this device before changing it.');
  end if;
  if v_order.version <> p_version then
    perform store_private.fail('This order changed. Review its current version before retrying.');
  end if;
  return v_order;
end;
$$;

-- Server-owned historical grants contain the price and label, never client totals.
-- Retained order lines keep their original snapshots even after catalog changes.
create function store_private.frozen_lines(p_device_id uuid, p_items jsonb, p_order_id bigint default null) returns jsonb
language plpgsql set search_path = pg_catalog, public as $$
declare v_input jsonb; v_product public.products; v_price public.price_versions;
  v_old public.order_items; v_product_id bigint; v_quantity bigint; v_version uuid;
  v_seen bigint[] := '{}'; v_lines jsonb := '[]';
begin
  if jsonb_typeof(p_items) is distinct from 'array' then perform store_private.fail('Add at least one valid item.'); end if;
  if jsonb_array_length(p_items) not between 1 and 100 then perform store_private.fail('Add between 1 and 100 distinct items.'); end if;
  -- Validate IDs first, then lock new AND retained/removed products numerically.
  -- Payment/cancellation use this same order to avoid cross-device deadlocks.
  for v_input in select value from jsonb_array_elements(p_items) loop
    perform store_private.object_keys(v_input, array['product_id', 'quantity', 'price_version_id']);
    v_product_id := store_private.integer_field(v_input, 'product_id', 1, 9007199254740991);
    perform store_private.integer_field(v_input, 'quantity', 1, 999);
    if v_product_id = any(v_seen) then perform store_private.fail('Each item may appear only once.'); end if;
    v_seen := array_append(v_seen, v_product_id);
  end loop;
  perform 1 from public.products where id = any(v_seen)
    or id in (select product_id from public.order_items where order_id = p_order_id) order by id for update;
  for v_input in select value from jsonb_array_elements(p_items) order by (value ->> 'product_id')::bigint loop
    v_product_id := (v_input ->> 'product_id')::bigint;
    v_quantity := (v_input ->> 'quantity')::bigint;
    select * into v_product from public.products where id = v_product_id for update;
    if not found or v_product.kind = 'consumable' then perform store_private.fail('An item is not available for sale.'); end if;
    v_old := null;
    if p_order_id is not null then
      select * into v_old from public.order_items where order_id = p_order_id and product_id = v_product_id;
    end if;
    if not v_product.active and (v_old.id is null or v_quantity > v_old.quantity) then
      perform store_private.fail('An added or increased item is no longer active.');
    end if;
    if v_old.id is not null then
      v_lines := v_lines || jsonb_build_array(jsonb_build_object('product_id', v_product_id, 'quantity', v_quantity,
        'price_version_id', v_old.price_version_id, 'name', v_old.name,
        'sku', v_old.sku, 'kind', v_old.kind, 'price_cents', v_old.price_cents, 'total_cents', v_old.price_cents * v_quantity));
    else
      v_version := store_private.uuid_field(v_input, 'price_version_id');
      select pv.* into v_price from public.price_versions pv join public.device_price_grants g on g.price_version_id = pv.id
        where g.device_id = p_device_id and pv.id = v_version and pv.product_id = v_product_id;
      if not found or v_price.kind = 'consumable' then perform store_private.fail('Refresh valid price grants before adding this item.'); end if;
      v_lines := v_lines || jsonb_build_array(jsonb_build_object('product_id', v_product_id, 'quantity', v_quantity,
        'price_version_id', v_price.id, 'name', v_price.name, 'sku', v_price.sku, 'kind', v_price.kind,
        'price_cents', v_price.price_cents, 'total_cents', v_price.price_cents * v_quantity));
    end if;
  end loop;
  return v_lines;
end;
$$;

create function store_private.consume_allocation(p_device_id uuid, p_product_id bigint, p_quantity bigint, p_reserve boolean) returns void
language plpgsql set search_path = pg_catalog, public as $$
begin
  if p_quantity <= 0 then perform store_private.fail('A positive item quantity is required.'); end if;
  update public.stock_allocations set remaining = remaining - p_quantity, updated_at = now()
    where device_id = p_device_id and product_id = p_product_id and remaining >= p_quantity;
  if not found then perform store_private.fail('This device does not have enough allocated stock. Keep the submitted event for Admin review.'); end if;
  update public.products set allocated = allocated - p_quantity,
    reserved = reserved + case when p_reserve then p_quantity else 0 end,
    stock = stock - case when p_reserve then 0 else p_quantity end
    where id = p_product_id and allocated >= p_quantity;
  if not found then perform store_private.fail('Allocated stock is inconsistent. Ask the Admin to review it.'); end if;
end;
$$;

create function store_private.restore_reservation(p_device_id uuid, p_product_id bigint, p_quantity bigint) returns void
language plpgsql set search_path = pg_catalog, public as $$
begin
  update public.products set reserved = reserved - p_quantity, allocated = allocated + p_quantity
    where id = p_product_id and reserved >= p_quantity;
  if not found then perform store_private.fail('Reserved stock is inconsistent. Ask the Admin to review it.'); end if;
  insert into public.stock_allocations(device_id, product_id, price_version_id, remaining)
    select p_device_id, id, price_version_id, p_quantity from public.products where id = p_product_id
    on conflict (device_id, product_id) do update set remaining = public.stock_allocations.remaining + excluded.remaining, updated_at = now();
end;
$$;

create function store_private.payment_fields(p_payment jsonb, p_total bigint) returns jsonb
language plpgsql set search_path = pg_catalog, public as $$
declare v_method text; v_amount bigint; v_reference text;
begin
  perform store_private.object_keys(p_payment, array['method', 'amount_cents', 'reference', 'verified']);
  v_method := store_private.text_field(p_payment, 'method', 10);
  v_amount := store_private.integer_field(p_payment, 'amount_cents', 1, 999999999);
  if v_method not in ('cash', 'gcash') or v_amount < p_total then
    perform store_private.fail('Choose Cash or GCash and record payment covering the full total.');
  end if;
  if v_method = 'gcash' then
    v_reference := upper(btrim(store_private.text_field(p_payment, 'reference', 80)));
    if v_reference !~ '^[A-Z0-9-]{6,80}$' or v_amount <> p_total or not store_private.boolean_field(p_payment, 'verified') then
      perform store_private.fail('Verify GCash in the store account, enter its reference, and record the exact total.');
    end if;
    if exists(select 1 from public.sales where payment_reference = v_reference) then
      perform store_private.fail('This GCash reference has already been recorded.');
    end if;
  end if;
  return jsonb_build_object('method', v_method, 'amount_cents', v_amount, 'reference', v_reference,
    'change_cents', case when v_method = 'cash' then v_amount - p_total else 0 end);
end;
$$;

create function store_private.save_order_lines(p_order_id bigint, p_lines jsonb) returns void
language plpgsql set search_path = pg_catalog, public as $$
declare v_line jsonb;
begin
  for v_line in select value from jsonb_array_elements(p_lines) loop
    insert into public.order_items(order_id, product_id, price_version_id, name, sku, kind, quantity, price_cents, total_cents)
    values (p_order_id, (v_line ->> 'product_id')::bigint, (v_line ->> 'price_version_id')::uuid, v_line ->> 'name',
      v_line ->> 'sku', v_line ->> 'kind', (v_line ->> 'quantity')::bigint, (v_line ->> 'price_cents')::bigint, (v_line ->> 'total_cents')::bigint)
    on conflict (order_id, product_id) do update set quantity = excluded.quantity, total_cents = excluded.total_cents;
  end loop;
  delete from public.order_items where order_id = p_order_id and product_id not in
    (select (value ->> 'product_id')::bigint from jsonb_array_elements(p_lines));
end;
$$;

create function store_private.make_sale(p_reference uuid, p_receipt text, p_creator bigint, p_collector bigint,
  p_channel text, p_lines jsonb, p_fee bigint, p_payment jsonb, p_captured timestamptz, p_order_id bigint default null) returns bigint
language plpgsql set search_path = pg_catalog, public as $$
declare v_subtotal bigint; v_payment jsonb; v_id bigint; v_line jsonb;
begin
  select sum((value ->> 'total_cents')::bigint) into v_subtotal from jsonb_array_elements(p_lines);
  if v_subtotal + p_fee > 999999999 then perform store_private.fail('This transaction exceeds the supported payment amount.'); end if;
  v_payment := store_private.payment_fields(p_payment, v_subtotal + p_fee);
  insert into public.sales(reference, receipt_number, user_id, paid_by, channel, subtotal_cents, delivery_fee_cents, total_cents,
    cash_cents, change_cents, payment_method, payment_reference, created_at, updated_at)
  values (p_reference, p_receipt, p_creator, p_collector, p_channel, v_subtotal, p_fee, v_subtotal + p_fee,
    (v_payment ->> 'amount_cents')::bigint, (v_payment ->> 'change_cents')::bigint, v_payment ->> 'method', v_payment ->> 'reference', p_captured, p_captured) returning id into v_id;
  perform 1 from public.products where id in (select (value ->> 'product_id')::bigint from jsonb_array_elements(p_lines)) order by id for update;
  for v_line in select value from jsonb_array_elements(p_lines) order by (value ->> 'product_id')::bigint loop
    if p_order_id is not null and v_line ->> 'kind' = 'product' then
      update public.products set stock = stock - (v_line ->> 'quantity')::bigint, reserved = reserved - (v_line ->> 'quantity')::bigint
        where id = (v_line ->> 'product_id')::bigint and stock >= (v_line ->> 'quantity')::bigint and reserved >= (v_line ->> 'quantity')::bigint;
      if not found then perform store_private.fail('Reserved stock is inconsistent. Ask the Admin to review it.'); end if;
    end if;
    insert into public.sale_items(sale_id, product_id, price_version_id, name, sku, kind, quantity, price_cents, total_cents)
    values (v_id, (v_line ->> 'product_id')::bigint, (v_line ->> 'price_version_id')::uuid, v_line ->> 'name', v_line ->> 'sku',
      v_line ->> 'kind', (v_line ->> 'quantity')::bigint, (v_line ->> 'price_cents')::bigint, (v_line ->> 'total_cents')::bigint);
    if v_line ->> 'kind' = 'product' then
      insert into public.stock_movements(product_id, user_id, sale_id, quantity, reason, created_at, updated_at)
      values ((v_line ->> 'product_id')::bigint, p_collector, v_id, -(v_line ->> 'quantity')::bigint,
        case when p_order_id is null then 'Sale ' else 'Paid order ' end || p_receipt, p_captured, p_captured);
    end if;
  end loop;
  if p_order_id is not null then
    update public.orders set sale_id = v_id, paid_by = p_collector, paid_at = p_captured, version = version + 1, updated_at = p_captured where id = p_order_id;
  end if;
  return v_id;
end;
$$;

create function store_private.order_lines(p_order_id bigint) returns jsonb
language sql stable set search_path = pg_catalog, public as $$
  select coalesce(jsonb_agg(jsonb_build_object('product_id', i.product_id, 'price_version_id', i.price_version_id,
    'name', i.name, 'sku', i.sku, 'kind', i.kind, 'quantity', i.quantity, 'price_cents', i.price_cents, 'total_cents', i.total_cents)
    order by i.product_id), '[]'::jsonb) from public.order_items i join public.products p on p.id = i.product_id where i.order_id = p_order_id
$$;

-- All event handlers run inside apply_event's rollback/review subtransaction.
create function store_private.process_event(p_actor public.profiles, p_device uuid, p_kind text, p_data jsonb, p_captured timestamptz) returns void
language plpgsql set search_path = pg_catalog, public as $$
declare v_reference uuid; v_order public.orders; v_product public.products; v_old public.order_items;
  v_lines jsonb; v_line jsonb; v_fee bigint; v_subtotal bigint; v_id bigint; v_sale_id bigint;
  v_quantity bigint; v_difference bigint; v_target bigint; v_status text; v_next text; v_name text;
  v_phone text; v_address text; v_notes text; v_receipt text; v_kind text; v_price bigint; v_reorder bigint;
  v_client_reference uuid; v_submitted_id bigint;
begin
  if p_kind in ('sale.create', 'order.create', 'order.edit', 'order.payment', 'order.status') and p_actor.role <> 'cashier' then
    perform store_private.fail('Only active Cashiers may record or change transactions.');
  end if;
  if p_kind in ('inventory.save', 'inventory.movement', 'order.handoff') and p_actor.role <> 'admin' then
    perform store_private.fail('Only Admin may manage inventory or hand off historical orders.');
  end if;

  if p_kind = 'sale.create' then
    perform store_private.object_keys(p_data, array['reference', 'receipt_number', 'channel', 'items', 'payment']);
    v_reference := store_private.uuid_field(p_data, 'reference');
    -- Sales and orders intentionally share a reference after payment, so a
    -- cross-table UNIQUE constraint cannot be used. Serialize creation checks.
    perform pg_advisory_xact_lock(hashtextextended(v_reference::text, 1));
    v_receipt := store_private.text_field(p_data, 'receipt_number', 80);
    if exists(select 1 from public.orders where reference = v_reference) or exists(select 1 from public.sales where reference = v_reference) then
      perform store_private.fail('This checkout reference has already been recorded.');
    end if;
    if store_private.text_field(p_data, 'channel', 10) not in ('walk-in', 'messenger') then perform store_private.fail('Choose Walk-in or Messenger.'); end if;
    v_lines := store_private.frozen_lines(p_device, p_data -> 'items');
    for v_line in select value from jsonb_array_elements(v_lines) loop
      if v_line ->> 'kind' = 'product' then
        perform store_private.consume_allocation(p_device, (v_line ->> 'product_id')::bigint, (v_line ->> 'quantity')::bigint, false);
      end if;
    end loop;
    perform store_private.make_sale(v_reference, v_receipt, p_actor.id, p_actor.id, p_data ->> 'channel', v_lines, 0, p_data -> 'payment', p_captured);

  elsif p_kind = 'order.create' then
    perform store_private.object_keys(p_data, array['reference', 'receipt_number', 'channel', 'fulfillment', 'payment_plan',
      'customer_name', 'customer_phone', 'delivery_address', 'notes', 'delivery_fee_cents', 'items', 'payment']);
    v_reference := store_private.uuid_field(p_data, 'reference');
    perform pg_advisory_xact_lock(hashtextextended(v_reference::text, 1));
    if exists(select 1 from public.orders where reference = v_reference) or exists(select 1 from public.sales where reference = v_reference) then
      perform store_private.fail('This checkout reference has already been recorded.');
    end if;
    if store_private.text_field(p_data, 'channel', 10) not in ('walk-in', 'messenger')
      or store_private.text_field(p_data, 'fulfillment', 10) not in ('pickup', 'delivery')
      or store_private.text_field(p_data, 'payment_plan', 10) not in ('prepaid', 'collection') then
      perform store_private.fail('Choose a valid channel, fulfillment, and payment plan.');
    end if;
    v_name := store_private.text_field(p_data, 'customer_name', 100);
    v_phone := store_private.text_field(p_data, 'customer_phone', 30);
    if v_phone !~ '^[0-9+()[:space:]-]{7,30}$' then perform store_private.fail('Enter a valid contact number.'); end if;
    v_address := store_private.text_field(p_data, 'delivery_address', 300, p_data ->> 'fulfillment' = 'delivery');
    v_notes := store_private.text_field(p_data, 'notes', 500, false);
    v_fee := store_private.integer_field(p_data, 'delivery_fee_cents', 0, 9999999);
    if p_data ->> 'fulfillment' = 'pickup' then
      if v_fee <> 0 then perform store_private.fail('Pickup has no delivery fee.'); end if;
      v_address := '';
    end if;
    v_lines := store_private.frozen_lines(p_device, p_data -> 'items');
    select sum((value ->> 'total_cents')::bigint) into v_subtotal from jsonb_array_elements(v_lines);
    if v_subtotal + v_fee > 999999999 then perform store_private.fail('This order exceeds the supported payment amount.'); end if;
    insert into public.orders(reference, user_id, device_id, channel, fulfillment, payment_plan, customer_name, customer_phone,
      delivery_address, notes, subtotal_cents, delivery_fee_cents, total_cents, created_at, updated_at)
    values (v_reference, p_actor.id, p_device, p_data ->> 'channel', p_data ->> 'fulfillment', p_data ->> 'payment_plan',
      v_name, v_phone, v_address, v_notes, v_subtotal, v_fee, v_subtotal + v_fee, p_captured, p_captured) returning id into v_id;
    for v_line in select value from jsonb_array_elements(v_lines) loop
      if v_line ->> 'kind' = 'product' then
        perform store_private.consume_allocation(p_device, (v_line ->> 'product_id')::bigint, (v_line ->> 'quantity')::bigint, true);
      end if;
    end loop;
    perform store_private.save_order_lines(v_id, v_lines);
    if p_data ->> 'payment_plan' = 'prepaid' then
      v_receipt := store_private.text_field(p_data, 'receipt_number', 80);
      perform store_private.make_sale(v_reference, v_receipt, p_actor.id, p_actor.id, p_data ->> 'channel', v_lines, v_fee, p_data -> 'payment', p_captured, v_id);
    elsif p_data ? 'payment' and p_data -> 'payment' <> 'null'::jsonb then
      perform store_private.fail('Collection orders record payment separately.');
    end if;

  elsif p_kind in ('order.edit', 'order.payment', 'order.status') then
    v_reference := store_private.uuid_field(p_data, 'reference');
    v_order := store_private.require_order(p_device, p_actor.id, v_reference, store_private.integer_field(p_data, 'expected_version', 1, 9007199254740991));
    if p_kind = 'order.edit' then
      perform store_private.object_keys(p_data, array['reference', 'expected_version', 'customer_name', 'customer_phone',
        'delivery_address', 'notes', 'delivery_fee_cents', 'items']);
      if v_order.status not in ('preparing', 'ready') then perform store_private.fail('Only preparing or ready orders can be edited.'); end if;
      v_name := store_private.text_field(p_data, 'customer_name', 100);
      v_phone := store_private.text_field(p_data, 'customer_phone', 30);
      if v_phone !~ '^[0-9+()[:space:]-]{7,30}$' then perform store_private.fail('Enter a valid contact number.'); end if;
      v_address := store_private.text_field(p_data, 'delivery_address', 300, v_order.fulfillment = 'delivery');
      if v_order.fulfillment = 'pickup' then v_address := ''; end if;
      v_notes := store_private.text_field(p_data, 'notes', 500, false);
      if v_order.sale_id is not null then
        if p_data ? 'delivery_fee_cents' and store_private.integer_field(p_data, 'delivery_fee_cents', 0, 9999999) <> v_order.delivery_fee_cents then
          perform store_private.fail('Paid item quantities and fees are fixed.');
        end if;
        if p_data ? 'items' then
          if jsonb_typeof(p_data -> 'items') is distinct from 'array' then perform store_private.fail('Paid item quantities and fees are fixed.'); end if;
          if jsonb_array_length(p_data -> 'items') <> (select count(*) from public.order_items where order_id = v_order.id) then
            perform store_private.fail('Paid item quantities and fees are fixed.');
          end if;
          v_lines := store_private.frozen_lines(p_device, p_data -> 'items', v_order.id);
          if exists(select 1 from jsonb_array_elements(v_lines) l left join public.order_items i
            on i.order_id = v_order.id and i.product_id = (l ->> 'product_id')::bigint
            where i.id is null or i.quantity <> (l ->> 'quantity')::bigint) then
            perform store_private.fail('Paid item quantities and fees are fixed.');
          end if;
        end if;
        update public.orders set customer_name = v_name, customer_phone = v_phone, delivery_address = v_address, notes = v_notes,
          version = version + 1, updated_at = now() where id = v_order.id;
      else
        v_fee := store_private.integer_field(p_data, 'delivery_fee_cents', 0, 9999999);
        if v_order.fulfillment = 'pickup' and v_fee <> 0 then perform store_private.fail('Pickup has no delivery fee.'); end if;
        v_lines := store_private.frozen_lines(p_device, p_data -> 'items', v_order.id);
        select sum((value ->> 'total_cents')::bigint) into v_subtotal from jsonb_array_elements(v_lines);
        if v_subtotal + v_fee > 999999999 then perform store_private.fail('This order exceeds the supported payment amount.'); end if;
        for v_id in select product_id from public.order_items where order_id = v_order.id union select (value ->> 'product_id')::bigint from jsonb_array_elements(v_lines) order by 1 loop
          select * into v_old from public.order_items where order_id = v_order.id and product_id = v_id;
          select value into v_line from jsonb_array_elements(v_lines) where (value ->> 'product_id')::bigint = v_id;
          if coalesce(v_old.kind, v_line ->> 'kind') <> 'product' then continue; end if;
          v_difference := coalesce((v_line ->> 'quantity')::bigint, 0) - coalesce(v_old.quantity, 0);
          if v_difference > 0 then perform store_private.consume_allocation(p_device, v_id, v_difference, true);
          elsif v_difference < 0 then perform store_private.restore_reservation(p_device, v_id, -v_difference); end if;
        end loop;
        perform store_private.save_order_lines(v_order.id, v_lines);
        update public.orders set customer_name = v_name, customer_phone = v_phone, delivery_address = v_address, notes = v_notes,
          subtotal_cents = v_subtotal, delivery_fee_cents = v_fee, total_cents = v_subtotal + v_fee, version = version + 1, updated_at = now() where id = v_order.id;
      end if;

    elsif p_kind = 'order.payment' then
      perform store_private.object_keys(p_data, array['reference', 'expected_version', 'receipt_number', 'payment']);
      if v_order.sale_id is not null then perform store_private.fail('This order is already paid.'); end if;
      if v_order.status = 'cancelled' then perform store_private.fail('A cancelled order cannot receive payment.'); end if;
      v_lines := store_private.order_lines(v_order.id);
      v_receipt := store_private.text_field(p_data, 'receipt_number', 80);
      perform store_private.make_sale(v_order.reference, v_receipt, v_order.user_id, p_actor.id, v_order.channel,
        v_lines, v_order.delivery_fee_cents, p_data -> 'payment', p_captured, v_order.id);

    else
      perform store_private.object_keys(p_data, array['reference', 'expected_version', 'status', 'goods_returned', 'cancel_reason']);
      v_status := store_private.text_field(p_data, 'status', 20);
      if v_status = v_order.status then return; end if;
      if v_status = 'cancelled' then
        if v_order.sale_id is not null or v_order.status in ('completed', 'cancelled') then
          perform store_private.fail('Only unpaid unfinished orders may be cancelled. Refunds are outside this workflow.');
        end if;
        v_notes := store_private.text_field(p_data, 'cancel_reason', 300);
        if v_order.status = 'out_for_delivery' and not store_private.boolean_field(p_data, 'goods_returned') then
          perform store_private.fail('Confirm returned goods before cancelling a dispatched order.');
        end if;
        for v_old in select * from public.order_items where order_id = v_order.id and kind = 'product' order by product_id loop
          perform store_private.restore_reservation(p_device, v_old.product_id, v_old.quantity);
        end loop;
        update public.orders set status = 'cancelled', cancel_reason = v_notes, version = version + 1, updated_at = now() where id = v_order.id;
      else
        v_next := case v_order.status when 'preparing' then 'ready' when 'ready' then
          case when v_order.fulfillment = 'delivery' then 'out_for_delivery' else 'completed' end when 'out_for_delivery' then 'completed' else null end;
        if v_status is distinct from v_next or (v_status = 'completed' and v_order.sale_id is null) then
          perform store_private.fail('Follow each fulfillment step and collect payment before completion.');
        end if;
        update public.orders set status = v_status, version = version + 1, updated_at = now() where id = v_order.id;
      end if;
    end if;

  elsif p_kind = 'inventory.save' then
    perform store_private.object_keys(p_data, array['id', 'client_reference', 'expected_version', 'sku', 'name', 'category', 'kind', 'price_cents', 'reorder_level', 'active', 'description']);
    v_name := store_private.text_field(p_data, 'name', 100);
    v_kind := store_private.text_field(p_data, 'kind', 20);
    if v_kind not in ('product', 'service', 'consumable') then perform store_private.fail('Choose a valid item kind.'); end if;
    v_price := store_private.integer_field(p_data, 'price_cents', case when v_kind = 'consumable' then 0 else 1 end, 9999999);
    v_reorder := store_private.integer_field(p_data, 'reorder_level', 0, 1000000);
    v_notes := store_private.text_field(p_data, 'description', 1000, false);
    if store_private.text_field(p_data, 'sku', 40) !~ '^[A-Za-z0-9-]{1,40}$' then perform store_private.fail('Use letters, numbers, and hyphens for SKU.'); end if;
    perform store_private.text_field(p_data, 'category', 60);
    perform store_private.boolean_field(p_data, 'active');
    v_id := null;
    v_client_reference := null;
    if p_data ? 'client_reference' and p_data -> 'client_reference' <> 'null'::jsonb then
      v_client_reference := store_private.uuid_field(p_data, 'client_reference');
      select id into v_id from public.products where client_reference = v_client_reference;
    end if;
    if p_data ? 'id' and p_data -> 'id' <> 'null'::jsonb then
      v_submitted_id := store_private.integer_field(p_data, 'id', -9007199254740991, 9007199254740991);
      if v_submitted_id = 0 then perform store_private.fail('Submit a valid item reference.'); end if;
      if v_submitted_id > 0 then
        if v_id is not null and v_id <> v_submitted_id then perform store_private.fail('Item references do not match.'); end if;
        v_id := v_submitted_id;
      elsif v_client_reference is null or (v_id is null and p_data ? 'expected_version') then
        perform store_private.fail('Synchronize the new item before editing it.');
      end if;
    end if;
    if v_id is not null then
      select * into v_product from public.products where id = v_id for update;
      if not found or v_product.version <> store_private.integer_field(p_data, 'expected_version', 1, 9007199254740991) then
        perform store_private.fail('This item changed. Review the current inventory version.');
      end if;
      if v_kind <> v_product.kind then perform store_private.fail('Item kind cannot be changed.'); end if;
      if v_client_reference is not null and v_product.client_reference is distinct from v_client_reference then
        perform store_private.fail('The item creation reference cannot be changed.');
      end if;
      update public.products set sku = p_data ->> 'sku', name = v_name, category = p_data ->> 'category', price_cents = v_price,
        reorder_level = v_reorder, active = (p_data ->> 'active')::boolean, description = v_notes where id = v_id;
    else
      insert into public.products(client_reference, sku, name, category, kind, price_cents, reorder_level, active, description)
      values (v_client_reference, p_data ->> 'sku', v_name, p_data ->> 'category', v_kind, v_price, v_reorder, (p_data ->> 'active')::boolean, v_notes);
    end if;

  elsif p_kind = 'inventory.movement' then
    perform store_private.object_keys(p_data, array['product_id', 'product_reference', 'quantity', 'reason']);
    v_submitted_id := store_private.integer_field(p_data, 'product_id', -9007199254740991, 9007199254740991);
    if p_data ? 'product_reference' and p_data -> 'product_reference' <> 'null'::jsonb then
      v_client_reference := store_private.uuid_field(p_data, 'product_reference');
      select id into v_id from public.products where client_reference = v_client_reference;
      if v_id is null or (v_submitted_id > 0 and v_id <> v_submitted_id) then perform store_private.fail('Synchronize and review the item reference.'); end if;
    else
      if v_submitted_id <= 0 then perform store_private.fail('A new offline item requires its creation reference.'); end if;
      v_id := v_submitted_id;
    end if;
    v_quantity := store_private.integer_field(p_data, 'quantity', -1000000, 1000000);
    if v_quantity = 0 then perform store_private.fail('Stock movements must change quantity.'); end if;
    v_notes := store_private.text_field(p_data, 'reason', 120);
    select * into v_product from public.products where id = v_id for update;
    if not found or v_product.kind = 'service' then perform store_private.fail('Services do not have stock movements.'); end if;
    if v_quantity < 0 and v_product.kind <> 'consumable' then perform store_private.fail('Outgoing supply usage is limited to internal consumables.'); end if;
    if v_product.stock + v_quantity < v_product.reserved + v_product.allocated or v_product.stock + v_quantity > 1000000 then
      perform store_private.fail('This movement exceeds unreserved, unallocated stock or the stock limit.');
    end if;
    update public.products set stock = stock + v_quantity where id = v_id;
    insert into public.stock_movements(product_id, user_id, quantity, reason, created_at, updated_at) values(v_id, p_actor.id, v_quantity, v_notes, p_captured, p_captured);

  elsif p_kind = 'order.handoff' then
    perform store_private.object_keys(p_data, array['reference', 'expected_version', 'assigned_cashier_id']);
    v_reference := store_private.uuid_field(p_data, 'reference');
    select * into v_order from public.orders where reference = v_reference for update;
    if not found or v_order.status not in ('preparing', 'ready', 'out_for_delivery')
      or not exists(select 1 from public.profiles where id = v_order.user_id and role = 'admin') then
      perform store_private.fail('Only unfinished Admin-created historical orders may be handed off.');
    end if;
    if v_order.device_id is not null then perform store_private.fail('Release the current device lease before handing off this order.'); end if;
    if v_order.version <> store_private.integer_field(p_data, 'expected_version', 1, 9007199254740991) then
      perform store_private.fail('This order changed. Review the current assignment.');
    end if;
    v_target := store_private.integer_field(p_data, 'assigned_cashier_id', 1, 9007199254740991);
    if not exists(select 1 from public.profiles where id = v_target and role = 'cashier' and active and auth_id is not null) then
      perform store_private.fail('Choose an active linked Cashier account.');
    end if;
    if v_order.assigned_cashier_id is distinct from v_target then
      update public.orders set assigned_cashier_id = v_target, assigned_by = p_actor.id, assigned_at = now(),
        assignment_version = assignment_version + 1, version = version + 1, updated_at = now() where id = v_order.id;
    end if;
  else
    perform store_private.fail('This event kind is not supported.');
  end if;
end;
$$;

commit;
