begin;

create function public.register_device(p_device_id uuid, p_name text) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_actor public.profiles; v_device public.devices;
begin
  v_actor := store_private.require_staff();
  if p_device_id is null or p_name is null or length(btrim(p_name)) not between 1 and 100 then
    perform store_private.fail('Enter a device name with at most 100 characters.');
  end if;
  insert into public.devices(id, staff_id, name) values(p_device_id, v_actor.id, btrim(p_name)) on conflict(id) do nothing;
  v_device := store_private.require_device(p_device_id, v_actor.id);
  return jsonb_build_object('id', v_device.id, 'staff_id', v_device.staff_id, 'name', v_device.name,
    'next_sequence', v_device.next_sequence, 'active', v_device.active);
end;
$$;

create function public.allocate_stock(p_device_id uuid, p_product_id bigint, p_quantity bigint) returns void
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_actor public.profiles; v_device public.devices; v_product public.products;
begin
  v_actor := store_private.require_staff('admin');
  v_device := store_private.require_device(p_device_id, v_actor.id, true);
  if not exists(select 1 from public.profiles where id = v_device.staff_id and active and role = 'cashier' and auth_id is not null) then
    perform store_private.fail('Allocate stock to an active Cashier device.');
  end if;
  if p_quantity is null or p_quantity not between 1 and 1000000 then perform store_private.fail('Enter a positive allocation within the stock limit.'); end if;
  select * into v_product from public.products where id = p_product_id for update;
  if not found or v_product.kind <> 'product' or not v_product.active then perform store_private.fail('Only active products can be allocated.'); end if;
  if v_product.stock - v_product.reserved - v_product.allocated < p_quantity then
    perform store_private.fail('This allocation exceeds unreserved, unallocated store stock.');
  end if;
  update public.products set allocated = allocated + p_quantity where id = p_product_id;
  insert into public.stock_allocations(device_id, product_id, price_version_id, remaining)
    values(p_device_id, p_product_id, v_product.price_version_id, p_quantity)
    on conflict(device_id, product_id) do update set remaining = public.stock_allocations.remaining + excluded.remaining, updated_at = now();
  insert into public.device_price_grants(device_id, price_version_id) values(p_device_id, v_product.price_version_id) on conflict do nothing;
end;
$$;

create function public.release_allocation(p_device_id uuid, p_product_id bigint) returns void
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_actor public.profiles; v_remaining bigint;
begin
  -- An Admin cannot confiscate stock from a disconnected device: it may already
  -- have issued receipts against those units. The owner first synchronizes its
  -- entire outbox, then calls this RPC under the client mutation lock.
  v_actor := store_private.require_staff('cashier');
  perform store_private.require_device(p_device_id, v_actor.id);
  perform store_private.require_clean_device(p_device_id);
  perform 1 from public.products where id = p_product_id for update;
  select remaining into v_remaining from public.stock_allocations where device_id = p_device_id and product_id = p_product_id for update;
  if not found or v_remaining = 0 then return; end if;
  update public.products set allocated = allocated - v_remaining where id = p_product_id and allocated >= v_remaining;
  if not found then perform store_private.fail('Allocated stock is inconsistent. Ask the Admin to review it.'); end if;
  update public.stock_allocations set remaining = 0, updated_at = now() where device_id = p_device_id and product_id = p_product_id;
end;
$$;

create function public.refresh_price_grants(p_device_id uuid, p_expected_sequence bigint) returns void
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_actor public.profiles; v_device public.devices;
begin
  v_actor := store_private.require_staff();
  v_device := store_private.require_device(p_device_id, v_actor.id);
  if p_expected_sequence is null or p_expected_sequence <> v_device.next_sequence then
    perform store_private.fail('Synchronize all pending events before refreshing price grants.');
  end if;
  perform store_private.require_clean_device(p_device_id);
  -- Keep every historical grant for a product with remaining device quota.
  -- The UI must confirm an empty pending/review outbox before this explicit RPC.
  delete from public.device_price_grants g using public.price_versions pv, public.products p
    where g.device_id = p_device_id and pv.id = g.price_version_id and p.id = pv.product_id
      and pv.id <> p.price_version_id and not exists(select 1 from public.stock_allocations a
        where a.device_id = p_device_id and a.product_id = p.id and a.remaining > 0);
  insert into public.device_price_grants(device_id, price_version_id)
    select p_device_id, price_version_id from public.products where active and kind <> 'consumable' on conflict do nothing;
end;
$$;

create function public.claim_order(p_device_id uuid, p_reference uuid) returns void
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_actor public.profiles; v_order public.orders;
begin
  v_actor := store_private.require_staff('cashier');
  perform store_private.require_device(p_device_id, v_actor.id);
  select * into v_order from public.orders where reference = p_reference for update;
  if not found or not (v_order.user_id = v_actor.id or (v_order.assigned_cashier_id = v_actor.id
    and exists(select 1 from public.profiles where id = v_order.user_id and role = 'admin'))) then
    perform store_private.fail('This order is not available to the current Cashier.');
  end if;
  if v_order.status in ('completed', 'cancelled') then perform store_private.fail('Closed orders cannot be claimed for changes.'); end if;
  if v_order.device_id is not null and v_order.device_id <> p_device_id then
    perform store_private.fail('This order is already claimed by another device. Synchronize and release that device first.');
  end if;
  if v_order.device_id is null then
    update public.orders set device_id = p_device_id, version = version + 1, updated_at = now() where id = v_order.id;
  end if;
end;
$$;

create function public.release_order(p_device_id uuid, p_reference uuid) returns void
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_actor public.profiles; v_order public.orders;
begin
  -- Owner-initiated release has the same clean-outbox requirement as stock release.
  v_actor := store_private.require_staff('cashier');
  perform store_private.require_device(p_device_id, v_actor.id);
  perform store_private.require_clean_device(p_device_id);
  select * into v_order from public.orders where reference = p_reference for update;
  if not found or not (v_order.user_id = v_actor.id or (v_order.assigned_cashier_id = v_actor.id
    and exists(select 1 from public.profiles where id = v_order.user_id and role = 'admin'))) then
    perform store_private.fail('This order is not available to the current Cashier.');
  end if;
  if v_order.device_id is null then return; end if;
  if v_order.device_id <> p_device_id then perform store_private.fail('Release the order from its current device.'); end if;
  update public.orders set device_id = null, version = version + 1, updated_at = now() where id = v_order.id;
end;
$$;

create function public.apply_event(p_event jsonb) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_actor public.profiles; v_device public.devices; v_existing public.sync_events;
  v_id uuid; v_device_id uuid; v_sequence bigint; v_kind text; v_digest text; v_captured timestamptz;
  v_status text := 'synced'; v_message text; v_result jsonb; v_captured_text text;
begin
  v_actor := store_private.require_staff();
  perform store_private.object_keys(p_event, array['id', 'device_id', 'sequence', 'kind', 'payload', 'captured_at', 'status', 'message']);
  if octet_length(p_event::text) > 262144 then perform store_private.fail('This submission exceeds the supported event size.'); end if;
  v_id := store_private.uuid_field(p_event, 'id');
  v_device_id := store_private.uuid_field(p_event, 'device_id');
  v_sequence := store_private.integer_field(p_event, 'sequence', 1, 9007199254740991);
  v_kind := store_private.text_field(p_event, 'kind', 30);
  if jsonb_typeof(p_event -> 'payload') is distinct from 'object' then perform store_private.fail('Submit a valid event payload.'); end if;
  v_captured_text := store_private.text_field(p_event, 'captured_at', 50);
  if v_captured_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$' then
    perform store_private.fail('Submit a valid captured date.');
  end if;
  begin
    v_captured := v_captured_text::timestamptz;
  exception when invalid_datetime_format or datetime_field_overflow then
    perform store_private.fail('Submit a valid captured date.');
  end;
  -- JSONB has canonical object ordering. Local-only status/message are excluded.
  v_digest := encode(sha256(convert_to((p_event - 'status' - 'message')::text, 'UTF8')), 'hex');
  v_device := store_private.require_device(v_device_id, v_actor.id);
  -- Serialize event IDs across devices too; identical UUIDs cannot race into
  -- different financial mutations before the unique event row is inserted.
  perform pg_advisory_xact_lock(hashtextextended(v_id::text, 0));
  select * into v_existing from public.sync_events where id = v_id;
  if found then
    if v_existing.staff_id <> v_actor.id or v_existing.device_id <> v_device_id
      or v_existing.request_identity <> (p_event - 'status' - 'message') then
      perform store_private.fail('This event ID was used for a different submission. Its saved result was not changed.');
    end if;
    return v_existing.result;
  end if;
  if v_sequence <> v_device.next_sequence then
    perform store_private.fail('Synchronize device events in their original sequence.');
  end if;
  begin
    perform store_private.process_event(v_actor, v_device_id, v_kind, p_event -> 'payload', v_captured);
  exception
    when sqlstate 'P0001' then
      get stacked diagnostics v_message = message_text;
      v_status := 'review';
    when unique_violation then
      v_message := 'A checkout, receipt, SKU, or payment reference has already been recorded. Review the submitted event.';
      v_status := 'review';
    when check_violation or foreign_key_violation or not_null_violation or numeric_value_out_of_range or invalid_text_representation then
      v_message := 'Submitted values are inconsistent or exceed the supported range. Review the saved event.';
      v_status := 'review';
    when others then
      -- Never leak SQL DETAIL, customer data, payment references, or tokens.
      v_message := 'Unable to apply this submission. Ask the Admin to review the saved event.';
      v_status := 'review';
  end;
  v_result := jsonb_build_object('id', v_id, 'status', v_status);
  if v_message is not null then v_result := v_result || jsonb_build_object('message', v_message); end if;
  insert into public.sync_events(id, device_id, staff_id, sequence, kind, request_digest, request_identity, payload, captured_at, status, message, result)
    values(v_id, v_device_id, v_actor.id, v_sequence, v_kind, v_digest, p_event - 'status' - 'message', p_event -> 'payload', v_captured, v_status, v_message, v_result);
  update public.devices set next_sequence = next_sequence + 1, updated_at = now() where id = v_device_id;
  return v_result;
end;
$$;

create function public.resolve_review(p_event_id uuid, p_note text, p_replacement_event_id uuid) returns void
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_actor public.profiles; v_review public.sync_events; v_replacement public.sync_events;
begin
  v_actor := store_private.require_staff();
  if p_note is null or length(btrim(p_note)) not between 1 and 500 then perform store_private.fail('Explain how the matching event was recovered.'); end if;
  select * into v_review from public.sync_events where id = p_event_id for update;
  if not found or v_review.status <> 'review' or (v_actor.role <> 'admin' and v_review.staff_id <> v_actor.id) then
    raise exception using errcode = '42501', message = 'This review is not available to the current staff account.';
  end if;
  select * into v_replacement from public.sync_events where id = p_replacement_event_id;
  if not found or v_replacement.status <> 'synced' or v_replacement.staff_id <> v_review.staff_id
    or v_replacement.device_id <> v_review.device_id or v_replacement.kind <> v_review.kind
    or v_replacement.captured_at <> v_review.captured_at
    or (v_replacement.payload - 'expected_version') <> (v_review.payload - 'expected_version') then
    perform store_private.fail('A synchronized matching replacement by the same staff account and device is required. Submitted finances and the captured business date cannot be changed.');
  end if;
  if v_review.resolved_at is not null then
    if v_review.replacement_event_id = p_replacement_event_id and v_review.resolution_note = btrim(p_note) then return; end if;
    perform store_private.fail('This review already has a recorded resolution.');
  end if;
  update public.sync_events set resolved_by = v_actor.id, resolved_at = now(), resolution_note = btrim(p_note),
    replacement_event_id = p_replacement_event_id where id = p_event_id;
end;
$$;

create function store_private.sale_json(p_sale_id bigint) returns jsonb
language sql stable set search_path = pg_catalog, public as $$
  select to_jsonb(s) || jsonb_build_object('items', (select coalesce(jsonb_agg(jsonb_build_object(
    'product_id', i.product_id, 'price_version_id', i.price_version_id, 'name', i.name, 'sku', i.sku, 'kind', i.kind,
    'quantity', i.quantity, 'price_cents', i.price_cents, 'total_cents', i.total_cents) order by i.product_id), '[]')
    from public.sale_items i where i.sale_id = s.id)) from public.sales s where s.id = p_sale_id
$$;

create function public.store_snapshot(p_device_id uuid) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_actor public.profiles; v_device public.devices; v_products jsonb; v_allocations jsonb; v_grants jsonb;
  v_orders jsonb; v_sales jsonb; v_receipts jsonb; v_movements jsonb; v_cashiers jsonb; v_devices jsonb; v_reviews jsonb; v_directory jsonb;
begin
  v_actor := store_private.require_staff();
  v_device := store_private.require_device(p_device_id, v_actor.id);
  insert into public.device_price_grants(device_id, price_version_id)
    select p_device_id, price_version_id from public.products where active and kind <> 'consumable' on conflict do nothing;
  select coalesce(jsonb_agg(to_jsonb(p) order by p.name, p.id), '[]') into v_products from public.products p
    where v_actor.role = 'admin' or p.kind <> 'consumable';
  select coalesce(jsonb_agg(jsonb_build_object('product_id', a.product_id, 'remaining', a.remaining,
    'price_version_id', a.price_version_id) order by a.product_id), '[]') into v_allocations from public.stock_allocations a where a.device_id = p_device_id;
  select coalesce(jsonb_agg(jsonb_build_object('product_id', p.product_id, 'price_version_id', p.id, 'name', p.name,
    'sku', p.sku, 'kind', p.kind, 'price_cents', p.price_cents) order by p.product_id, p.created_at, p.id), '[]') into v_grants
    from public.price_versions p join public.device_price_grants g on g.price_version_id = p.id where g.device_id = p_device_id;
  select coalesce(jsonb_agg(to_jsonb(o) || jsonb_build_object('sale_reference', case when o.sale_id is null then null else o.reference end,
    'items', store_private.order_lines(o.id)) order by o.created_at desc, o.id desc), '[]') into v_orders
    from public.orders o join public.profiles creator on creator.id = o.user_id
    where v_actor.role = 'admin' or o.user_id = v_actor.id or (creator.role = 'admin' and o.assigned_cashier_id = v_actor.id);
  select coalesce(jsonb_agg(to_jsonb(s) || jsonb_build_object('items', (select coalesce(jsonb_agg(jsonb_build_object(
    'product_id', i.product_id, 'price_version_id', i.price_version_id, 'name', i.name, 'sku', i.sku, 'kind', i.kind,
    'quantity', i.quantity, 'price_cents', i.price_cents, 'total_cents', i.total_cents) order by i.product_id), '[]')
    from public.sale_items i where i.sale_id = s.id)) order by s.created_at desc, s.id desc), '[]') into v_sales
    from public.sales s join public.profiles creator on creator.id = s.user_id
    where v_actor.role = 'admin' or s.user_id = v_actor.id or (creator.role = 'admin' and s.paid_by = v_actor.id);
  select coalesce(jsonb_agg(store_private.sale_json(s.id) order by s.created_at desc, s.id desc), '[]') into v_receipts
    from public.sales s join public.orders o on o.sale_id = s.id join public.profiles creator on creator.id = o.user_id
    where v_actor.role = 'cashier' and creator.role = 'admin' and o.assigned_cashier_id = v_actor.id and s.paid_by <> v_actor.id;
  select coalesce(jsonb_agg(to_jsonb(m) order by m.created_at desc, m.id desc), '[]') into v_movements from public.stock_movements m where v_actor.role = 'admin';
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'email', p.email, 'role', p.role, 'active', p.active) order by p.name, p.id), '[]')
    into v_cashiers from public.profiles p where v_actor.role = 'admin' and p.role = 'cashier';
  select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'staff_id', d.staff_id, 'name', d.name, 'next_sequence', d.next_sequence,
    'active', d.active) order by d.created_at, d.id), '[]') into v_devices from public.devices d where v_actor.role = 'admin' or d.staff_id = v_actor.id;
  select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'kind', e.kind, 'message', e.message, 'created_at', e.created_at,
    'payload', e.payload, 'captured_at', e.captured_at, 'device_id', e.device_id, 'staff_id', e.staff_id, 'sequence', e.sequence)
    order by e.created_at desc, e.id), '[]') into v_reviews from public.sync_events e
    where e.status = 'review' and e.resolved_at is null and (v_actor.role = 'admin' or e.staff_id = v_actor.id);
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'role', p.role, 'active', p.active) order by p.id), '[]') into v_directory
    from public.profiles p where v_actor.role = 'admin' or p.id = v_actor.id or p.id in (
      select o.user_id from public.orders o join public.profiles c on c.id = o.user_id where o.user_id = v_actor.id or (c.role = 'admin' and o.assigned_cashier_id = v_actor.id)
      union select o.assigned_by from public.orders o join public.profiles c on c.id = o.user_id where o.user_id = v_actor.id or (c.role = 'admin' and o.assigned_cashier_id = v_actor.id)
      union select s.user_id from public.sales s join public.profiles c on c.id = s.user_id where s.user_id = v_actor.id or (c.role = 'admin' and s.paid_by = v_actor.id)
      union select s.paid_by from public.sales s join public.orders o on o.sale_id = s.id join public.profiles c on c.id = o.user_id
        where c.role = 'admin' and o.assigned_cashier_id = v_actor.id
    );
  return jsonb_build_object('staff', jsonb_build_object('id', v_actor.id, 'name', v_actor.name, 'email', v_actor.email, 'role', v_actor.role, 'active', v_actor.active),
    'device', jsonb_build_object('id', v_device.id, 'staff_id', v_device.staff_id, 'name', v_device.name, 'next_sequence', v_device.next_sequence, 'active', v_device.active),
    'products', v_products, 'allocations', v_allocations, 'price_grants', v_grants, 'orders', v_orders, 'sales', v_sales, 'receipts', v_receipts, 'movements', v_movements,
    'cashiers', v_cashiers, 'staff_directory', v_directory, 'devices', v_devices, 'reviews', v_reviews, 'fetched_at', now());
end;
$$;

create function public.public_catalog() returns jsonb
language sql stable security definer set search_path = pg_catalog, public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'sku', sku, 'name', name, 'category', category,
    'kind', kind, 'price_cents', price_cents, 'description', description,
    'available', kind = 'service' or stock - reserved > 0) order by name, id), '[]')
  from public.products where active and kind in ('product', 'service')
$$;

-- Policies are deliberately read-only. No authenticated client, including an
-- Admin, may bypass event validation by writing tables or history directly.
alter table public.profiles enable row level security;
alter table public.devices enable row level security;
alter table public.products enable row level security;
alter table public.price_versions enable row level security;
alter table public.device_price_grants enable row level security;
alter table public.stock_allocations enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.sales enable row level security;
alter table public.sale_items enable row level security;
alter table public.stock_movements enable row level security;
alter table public.sync_events enable row level security;

create policy profiles_read on public.profiles for select to authenticated using (store_private.current_role() = 'admin' or id = store_private.current_staff_id());
create policy devices_read on public.devices for select to authenticated using (store_private.current_role() = 'admin' or staff_id = store_private.current_staff_id());
create policy products_read on public.products for select to authenticated using (store_private.current_role() = 'admin' or (store_private.current_role() = 'cashier' and kind <> 'consumable'));
create policy price_versions_read on public.price_versions for select to authenticated using (store_private.current_role() = 'admin' or exists (
  select 1 from public.device_price_grants g join public.devices d on d.id = g.device_id where g.price_version_id = price_versions.id and d.staff_id = store_private.current_staff_id()));
create policy device_grants_read on public.device_price_grants for select to authenticated using (store_private.current_role() = 'admin' or exists (
  select 1 from public.devices d where d.id = device_id and d.staff_id = store_private.current_staff_id()));
create policy allocations_read on public.stock_allocations for select to authenticated using (store_private.current_role() = 'admin' or exists (
  select 1 from public.devices d where d.id = device_id and d.staff_id = store_private.current_staff_id()));
create policy orders_read on public.orders for select to authenticated using (store_private.can_read_order(id));
create policy order_items_read on public.order_items for select to authenticated using (store_private.can_read_order(order_id));
create policy sales_read on public.sales for select to authenticated using (store_private.can_read_sale(id));
create policy sale_items_read on public.sale_items for select to authenticated using (store_private.can_read_sale(sale_id));
create policy movements_read on public.stock_movements for select to authenticated using (store_private.current_role() = 'admin');
create policy sync_events_read on public.sync_events for select to authenticated using (store_private.current_role() = 'admin' or staff_id = store_private.current_staff_id());

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
grant select on public.profiles, public.devices, public.products, public.price_versions, public.device_price_grants,
  public.stock_allocations, public.orders, public.order_items, public.sales, public.sale_items, public.stock_movements, public.sync_events to authenticated;
grant all on public.profiles, public.devices, public.products, public.price_versions, public.device_price_grants,
  public.stock_allocations, public.orders, public.order_items, public.sales, public.sale_items, public.stock_movements, public.sync_events to service_role;
grant usage, select on all sequences in schema public to service_role;

revoke all on all functions in schema store_private from public, anon, authenticated;
grant usage on schema store_private to authenticated;
grant execute on function store_private.current_staff_id(), store_private.current_role(),
  store_private.can_read_order(bigint), store_private.can_read_sale(bigint) to authenticated;
revoke all on function public.register_device(uuid,text), public.allocate_stock(uuid,bigint,bigint), public.release_allocation(uuid,bigint),
  public.refresh_price_grants(uuid,bigint), public.claim_order(uuid,uuid), public.release_order(uuid,uuid), public.apply_event(jsonb),
  public.store_snapshot(uuid), public.public_catalog(), public.resolve_review(uuid,text,uuid) from public, anon, authenticated;
grant execute on function public.register_device(uuid,text), public.allocate_stock(uuid,bigint,bigint), public.release_allocation(uuid,bigint),
  public.refresh_price_grants(uuid,bigint), public.claim_order(uuid,uuid), public.release_order(uuid,uuid), public.apply_event(jsonb), public.store_snapshot(uuid), public.resolve_review(uuid,text,uuid) to authenticated;
grant execute on function public.public_catalog() to anon, authenticated;

commit;
