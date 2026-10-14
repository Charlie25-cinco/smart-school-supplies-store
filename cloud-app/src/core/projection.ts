import type { Allocation, FrozenLine, Kind, Line, Mutation, MutationKind, Order, OrderStatus, Payloads, Payment, Product, Sale, Snapshot } from '../models';

export class ValidationError extends Error {
  constructor(message: string) { super(message); this.name = 'ValidationError'; }
}

export interface PriceSnapshot { product_id: number; price_version_id: string | null; name: string; sku: string; kind: Kind; price_cents: number; }
export type Prices = Record<string, PriceSnapshot>;
const MAX_MONEY = 999_999_999;
const MAX_PRICE = 9_999_999;
const MAX_STOCK = 1_000_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function requireValue(condition: unknown, message: string): asserts condition { if (!condition) throw new ValidationError(message); }
const integer = (value: number, min: number, max: number, message: string) => { requireValue(Number.isSafeInteger(value) && value >= min && value <= max, message); return value; };
const text = (value: string, max: number, label: string, required = true) => { requireValue(typeof value === 'string' && value.length <= max && (!required || value.trim().length > 0), label + ' is missing or too long.'); return value; };
export const priceKey = (product: number, version: string | null) => product + ':' + version;

export function collectPrices(snapshot: Snapshot, previous: Prices = {}): Prices {
  const result = structuredClone(previous);
  for (const product of snapshot.products) result[priceKey(product.id, product.price_version_id)] = {product_id: product.id, price_version_id: product.price_version_id, name: product.name, sku: product.sku, kind: product.kind, price_cents: product.price_cents};
  for (const grant of snapshot.price_grants) {
    const frozen = grant as typeof grant & Partial<PriceSnapshot>;
    if (typeof frozen.price_cents === 'number' && typeof frozen.name === 'string' && typeof frozen.sku === 'string' && frozen.kind) {
      result[priceKey(grant.product_id, grant.price_version_id)] = frozen as PriceSnapshot;
    }
  }
  for (const record of [...snapshot.orders, ...snapshot.sales]) for (const line of record.items) {
    result[priceKey(line.product_id, line.price_version_id)] = {product_id: line.product_id, price_version_id: line.price_version_id, name: line.name, sku: line.sku, kind: line.kind, price_cents: line.price_cents};
  }
  return result;
}

function payloadFields(kind: MutationKind, payload: unknown): void {
  const fields: Record<MutationKind, string[]> = {
    'sale.create': ['reference','receipt_number','channel','items','payment'],
    'order.create': ['reference','receipt_number','channel','fulfillment','payment_plan','customer_name','customer_phone','delivery_address','notes','delivery_fee_cents','items','payment'],
    'order.edit': ['reference','expected_version','customer_name','customer_phone','delivery_address','notes','delivery_fee_cents','items'],
    'order.payment': ['reference','expected_version','receipt_number','payment'],
    'order.status': ['reference','expected_version','status','goods_returned','cancel_reason'],
    'inventory.save': ['id','client_reference','expected_version','sku','name','category','kind','price_cents','reorder_level','active','description'],
    'inventory.movement': ['product_id','product_reference','quantity','reason'],
    'order.handoff': ['reference','expected_version','assigned_cashier_id'],
  };
  requireValue(payload && typeof payload === 'object' && !Array.isArray(payload), 'The change must contain valid fields.');
  requireValue(Object.keys(payload).every(key => fields[kind]?.includes(key)), 'The change contains unsupported fields.');
}

function productFor(snapshot: Snapshot, id: number, clientReference?: string): Product {
  integer(id, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, 'Invalid item identity.');
  requireValue(id !== 0, 'Invalid item identity.');
  if (id < 0) requireValue(typeof clientReference === 'string' && UUID.test(clientReference), 'A new offline item requires its saved client reference.');
  const product = clientReference ? snapshot.products.find(item => item.client_reference === clientReference) : snapshot.products.find(item => item.id === id);
  requireValue(product, 'The item is unavailable on this device.');
  return product;
}

function reference(value: string) { requireValue(typeof value === 'string' && UUID.test(value), 'The record reference must be a UUID.'); }
function receipt(snapshot: Snapshot, value: string) {
  text(value, 80, 'Receipt number');
  requireValue(!snapshot.sales.some(sale => sale.receipt_number === value), 'This receipt number has already been used.');
}
function channel(value: string) { requireValue(value === 'messenger' || value === 'walk-in', 'Choose walk-in or Messenger.'); }
function details(input: {customer_name: string; customer_phone: string; delivery_address: string; notes: string}, fulfillment: string) {
  text(input.customer_name, 100, 'Customer name');
  requireValue(typeof input.customer_phone === 'string' && /^[0-9+()\s-]{7,30}$/.test(input.customer_phone), 'Enter a valid customer phone number.');
  text(input.delivery_address, 300, 'Delivery address', fulfillment === 'delivery');
  text(input.notes, 500, 'Notes', false);
}
function canAccessOrder(snapshot: Snapshot, order: Order): boolean {
  return snapshot.staff.role === 'admin' || order.user_id === snapshot.staff.id || (order.assigned_cashier_id === snapshot.staff.id && (snapshot.staff_directory || snapshot.cashiers).some(staff => staff.id === order.user_id && staff.role === 'admin'));
}
function cashierOrder(snapshot: Snapshot, ref: string, version: number): Order {
  requireValue(snapshot.staff.role === 'cashier', 'Only a Cashier can change an order.');
  reference(ref);
  const order = snapshot.orders.find(item => item.reference === ref);
  requireValue(order && canAccessOrder(snapshot, order), 'This order is unavailable to your account.');
  requireValue(order.device_id === snapshot.device.id, 'Connect and claim this order on this device before changing it.');
  integer(version, 1, Number.MAX_SAFE_INTEGER, 'Invalid order version.');
  requireValue(order.version === version, 'This order changed. Refresh and review it before saving.');
  return order;
}

function freezeLines(snapshot: Snapshot, lines: Line[], prices: Prices, retained?: FrozenLine[]): FrozenLine[] {
  requireValue(Array.isArray(lines) && lines.length >= 1 && lines.length <= 100, 'Choose between 1 and 100 different items.');
  const seen = new Set<number>();
  return lines.map(line => {
    requireValue(line && typeof line === 'object' && Object.keys(line).every(key => ['product_id','quantity','price_version_id'].includes(key)), 'Invalid item fields.');
    integer(line.quantity, 1, 999, 'Item quantity must be between 1 and 999.');
    requireValue(!seen.has(line.product_id), 'Combine duplicate items into one line.'); seen.add(line.product_id);
    const product = productFor(snapshot, line.product_id);
    const old = retained?.find(item => item.product_id === line.product_id);
    requireValue(product.kind !== 'consumable', 'Internal supplies cannot be sold.');
    requireValue(product.active || (old && line.quantity <= old.quantity), 'An inactive item cannot be added or increased.');
    if (old) {
      requireValue(line.price_version_id === old.price_version_id, 'Retained lines must keep their saved price.');
      return {...old, quantity: line.quantity, total_cents: integer(old.price_cents * line.quantity, 1, MAX_MONEY, 'Item total exceeds the allowed amount.')};
    }
    requireValue(typeof line.price_version_id === 'string' && snapshot.price_grants.some(grant => grant.product_id === line.product_id && grant.price_version_id === line.price_version_id), 'Connect to prepare the current price for this item.');
    const price = prices[priceKey(line.product_id, line.price_version_id)];
    requireValue(price && price.kind === product.kind, 'The granted item price is unavailable. Connect to refresh this device.');
    integer(price.price_cents, 1, MAX_PRICE, 'Invalid item price.');
    return {product_id: line.product_id, quantity: line.quantity, price_version_id: line.price_version_id, name: price.name, sku: price.sku, kind: price.kind, price_cents: price.price_cents, total_cents: integer(price.price_cents * line.quantity, 1, MAX_MONEY, 'Item total exceeds the allowed amount.')};
  });
}
function amounts(items: FrozenLine[], fee = 0) {
  integer(fee, 0, MAX_PRICE, 'Delivery fee exceeds the allowed amount.');
  const subtotal_cents = integer(items.reduce((sum, line) => sum + line.total_cents, 0), 1, MAX_MONEY, 'The subtotal exceeds the allowed amount.');
  return {subtotal_cents, delivery_fee_cents: fee, total_cents: integer(subtotal_cents + fee, 1, MAX_MONEY, 'The total exceeds the allowed amount.')};
}
function allocation(snapshot: Snapshot, line: FrozenLine): Allocation {
  const allotted = snapshot.allocations.find(item => item.product_id === line.product_id);
  requireValue(allotted, 'No offline stock is allocated to this device for ' + line.name + '.');
  return allotted;
}
function takeQuota(snapshot: Snapshot, line: FrozenLine, quantity = line.quantity, reserve = false) {
  if (line.kind === 'service' || quantity === 0) return;
  const product = productFor(snapshot, line.product_id), allotted = allocation(snapshot, line);
  requireValue(allotted.remaining >= quantity, 'Not enough allocated stock for ' + line.name + '. Connect and request more stock.');
  requireValue(product.allocated >= quantity && product.stock - product.reserved >= quantity, 'The saved stock allocation is inconsistent. Connect to refresh.');
  allotted.remaining -= quantity; product.allocated -= quantity;
  if (reserve) product.reserved += quantity; else product.stock -= quantity;
  product.version++;
}
function returnQuota(snapshot: Snapshot, line: FrozenLine, quantity = line.quantity) {
  if (line.kind === 'service' || quantity === 0) return;
  const product = productFor(snapshot, line.product_id);
  let allotted = snapshot.allocations.find(item => item.product_id === line.product_id);
  if (!allotted) { allotted = {product_id: product.id, remaining: 0, price_version_id: product.price_version_id}; snapshot.allocations.push(allotted); }
  requireValue(product.reserved >= quantity, 'The saved reservation is inconsistent. Connect to refresh.');
  product.reserved -= quantity; product.allocated += quantity; allotted.remaining += quantity;
  product.version++;
}
function consumeReservation(snapshot: Snapshot, line: FrozenLine) {
  if (line.kind === 'service') return;
  const product = productFor(snapshot, line.product_id);
  requireValue(product.reserved >= line.quantity && product.stock >= line.quantity, 'The saved reservation is inconsistent. Connect to refresh.');
  product.reserved -= line.quantity; product.stock -= line.quantity;
  product.version++;
}
function validatePayment(snapshot: Snapshot, payment: Payment, total: number) {
  requireValue(payment && typeof payment === 'object' && Object.keys(payment).every(key => ['method','amount_cents','reference','verified'].includes(key)), 'Invalid payment fields.');
  integer(payment.amount_cents, 1, MAX_MONEY, 'Enter a valid payment amount.');
  requireValue(payment.method === 'cash' || payment.method === 'gcash', 'Choose cash or GCash.');
  if (payment.method === 'cash') requireValue(payment.amount_cents >= total, 'Cash received is below the total.');
  else {
    const normalized = typeof payment.reference === 'string' ? payment.reference.trim().toUpperCase() : '';
    requireValue(payment.amount_cents === total && payment.verified === true && /^[A-Z0-9-]{6,80}$/.test(normalized), 'Verify the exact GCash payment and its reference before recording it.');
    requireValue(!snapshot.sales.some(sale => sale.payment_reference?.trim().toUpperCase() === normalized), 'This GCash reference has already been recorded.');
  }
}
function createSale(snapshot: Snapshot, event: Mutation, ref: string, receiptNumber: string, saleChannel: string, items: FrozenLine[], fee: number, payment: Payment, userId = snapshot.staff.id, pending = true, orderPayment = false): Sale {
  receipt(snapshot, receiptNumber); const totals = amounts(items, fee); validatePayment(snapshot, payment, totals.total_cents);
  const sale: Sale = {reference: ref, receipt_number: receiptNumber, user_id: userId, paid_by: snapshot.staff.id, channel: saleChannel, ...totals, cash_cents: payment.amount_cents, change_cents: payment.method === 'cash' ? payment.amount_cents - totals.total_cents : 0, payment_method: payment.method, items: structuredClone(items), created_at: event.captured_at, ...(payment.method === 'gcash' ? {payment_reference: payment.reference!.trim().toUpperCase()} : {}), ...(pending ? {local_status: 'pending' as const} : {})};
  snapshot.sales.unshift(sale);
  snapshot.receipts?.unshift(structuredClone(sale));
  items.filter(line => line.kind === 'product').forEach(line => snapshot.movements.unshift({product_id: line.product_id, user_id: snapshot.staff.id, quantity: -line.quantity, reason: (orderPayment ? 'Paid order ' : 'Sale ') + receiptNumber, created_at: event.captured_at}));
  return sale;
}

/** Pure projection; the caller commits this and its event in one IDB transaction. */
export function projectEvent(source: Snapshot, event: Mutation, prices: Prices, pending = true): Snapshot {
  const snapshot = structuredClone(source), payload = event.payload;
  requireValue(snapshot.staff.active && snapshot.device.active && snapshot.staff.id === snapshot.device.staff_id, 'This account or device is not prepared for offline changes.');
  requireValue(snapshot.staff.role === 'admin' || snapshot.staff.role === 'cashier', 'This account has no store access.');
  requireValue(event.device_id === snapshot.device.id, 'This change belongs to another device.');
  payloadFields(event.kind, payload);
  if (event.kind.startsWith('inventory.') || event.kind === 'order.handoff') requireValue(snapshot.staff.role === 'admin', 'Only an Admin can manage inventory or hand off orders.');
  else requireValue(snapshot.staff.role === 'cashier', 'Only a Cashier can create sales or change orders.');
  const markOrder = (order: Order) => { order.version++; if (pending) order.local_status = 'pending'; else delete order.local_status; };
  switch (event.kind) {
    case 'sale.create': {
      const input = payload as Payloads['sale.create']; reference(input.reference); channel(input.channel);
      requireValue(!snapshot.sales.some(sale => sale.reference === input.reference) && !snapshot.orders.some(order => order.reference === input.reference), 'This record reference has already been used.');
      const items = freezeLines(snapshot, input.items, prices);
      createSale(snapshot, event, input.reference, input.receipt_number, input.channel, items, 0, input.payment, snapshot.staff.id, pending);
      items.forEach(line => takeQuota(snapshot, line)); break;
    }
    case 'order.create': {
      const input = payload as Payloads['order.create']; reference(input.reference); channel(input.channel);
      requireValue(!snapshot.orders.some(order => order.reference === input.reference) && !snapshot.sales.some(sale => sale.reference === input.reference), 'This record reference has already been used.');
      requireValue(['pickup','delivery'].includes(input.fulfillment) && ['prepaid','collection'].includes(input.payment_plan), 'Choose a valid fulfillment and payment plan.');
      details(input, input.fulfillment);
      requireValue(input.fulfillment === 'delivery' || input.delivery_fee_cents === 0, 'Pickup orders cannot include a delivery fee.');
      const items = freezeLines(snapshot, input.items, prices), totals = amounts(items, input.delivery_fee_cents);
      requireValue(input.payment_plan !== 'prepaid' || input.payment, 'Prepaid orders require verified payment.');
      requireValue(input.payment_plan !== 'collection' || !input.payment, 'Collection orders record payment when it is collected.');
      const order: Order = {reference: input.reference, user_id: snapshot.staff.id, device_id: snapshot.device.id, channel: input.channel, fulfillment: input.fulfillment, payment_plan: input.payment_plan, status: 'preparing', customer_name: input.customer_name.trim(), customer_phone: input.customer_phone.trim(), delivery_address: input.fulfillment === 'delivery' ? input.delivery_address.trim() : '', notes: input.notes.trim(), ...totals, items, version: 1, created_at: event.captured_at, ...(pending ? {local_status: 'pending' as const} : {})};
      items.forEach(line => takeQuota(snapshot, line, line.quantity, true));
      if (input.payment) {
        const sale = createSale(snapshot, event, input.reference, input.receipt_number, input.channel, items, input.delivery_fee_cents, input.payment, snapshot.staff.id, pending, true);
        order.paid_by = snapshot.staff.id; order.paid_at = event.captured_at; order.sale_reference = sale.reference;
        items.forEach(line => consumeReservation(snapshot, line)); order.version++;
      }
      snapshot.orders.unshift(order); break;
    }
    case 'order.edit': {
      const input = payload as Payloads['order.edit'], order = cashierOrder(snapshot, input.reference, input.expected_version);
      requireValue(['preparing','ready'].includes(order.status), 'Only preparing or ready orders can be edited.'); details(input, order.fulfillment);
      requireValue(order.fulfillment === 'delivery' || input.delivery_fee_cents === 0, 'Pickup orders cannot include a delivery fee.');
      const items = freezeLines(snapshot, input.items, prices, order.items), totals = amounts(items, input.delivery_fee_cents);
      if (order.paid_at) {
        requireValue(items.length === order.items.length && items.every(line => order.items.some(old => old.product_id === line.product_id && old.quantity === line.quantity && old.price_version_id === line.price_version_id)) && totals.delivery_fee_cents === order.delivery_fee_cents, 'Paid orders allow customer corrections only; their items and amounts are frozen.');
      } else {
        for (const old of order.items) { const next = items.find(line => line.product_id === old.product_id); if (!next || next.quantity < old.quantity) returnQuota(snapshot, old, old.quantity - (next?.quantity || 0)); }
        for (const line of items) { const old = order.items.find(item => item.product_id === line.product_id); if (line.quantity > (old?.quantity || 0)) takeQuota(snapshot, line, line.quantity - (old?.quantity || 0), true); }
      }
      Object.assign(order, {customer_name: input.customer_name.trim(), customer_phone: input.customer_phone.trim(), delivery_address: order.fulfillment === 'delivery' ? input.delivery_address.trim() : '', notes: input.notes.trim(), items, ...totals}); markOrder(order); break;
    }
    case 'order.payment': {
      const input = payload as Payloads['order.payment'], order = cashierOrder(snapshot, input.reference, input.expected_version);
      requireValue(order.status !== 'cancelled' && !order.paid_at, 'This order is cancelled or has already been paid.');
      const sale = createSale(snapshot, event, order.reference, input.receipt_number, order.channel, order.items, order.delivery_fee_cents, input.payment, order.user_id, pending, true);
      order.items.forEach(line => consumeReservation(snapshot, line)); order.paid_by = snapshot.staff.id; order.paid_at = event.captured_at; order.sale_reference = sale.reference; markOrder(order); break;
    }
    case 'order.status': {
      const input = payload as Payloads['order.status'] & {cancel_reason?: string}, order = cashierOrder(snapshot, input.reference, input.expected_version);
      requireValue(['preparing','ready','out_for_delivery','completed','cancelled'].includes(input.status), 'Choose a valid order status.');
      if (input.status === order.status) break;
      const next: Partial<Record<OrderStatus, OrderStatus>> = {preparing: 'ready', ready: order.fulfillment === 'delivery' ? 'out_for_delivery' : 'completed', out_for_delivery: 'completed'};
      if (input.status === 'cancelled') {
        requireValue(!order.paid_at && order.status !== 'completed' && order.status !== 'cancelled', 'Only unfinished unpaid orders can be cancelled.');
        text(input.cancel_reason || '', 300, 'Cancellation reason');
        requireValue(order.status !== 'out_for_delivery' || input.goods_returned === true, 'Confirm that dispatched goods were returned before cancellation.');
        order.items.forEach(line => returnQuota(snapshot, line));
      } else {
        requireValue(next[order.status] === input.status, 'Follow the next delivery or pickup step.');
        requireValue(input.status !== 'completed' || order.paid_at, 'Record payment before completing the order.');
      }
      order.status = input.status; markOrder(order); break;
    }
    case 'inventory.save': {
      const input = payload as Payloads['inventory.save'];
      requireValue(typeof input.sku === 'string' && /^[A-Za-z0-9-]{1,40}$/.test(input.sku), 'Use a unique SKU with 1–40 letters, digits or hyphens.');
      text(input.name, 100, 'Item name'); text(input.category, 60, 'Category'); text(input.description, 1000, 'Description', false);
      requireValue(['product','service','consumable'].includes(input.kind) && typeof input.active === 'boolean', 'Choose a valid item kind and availability.');
      integer(input.price_cents, input.kind === 'consumable' ? 0 : 1, MAX_PRICE, 'Enter a valid price in centavos.'); integer(input.reorder_level, 0, MAX_STOCK, 'Invalid reorder level.');
      requireValue(!snapshot.products.some(item => item.id !== input.id && (!input.client_reference || item.client_reference !== input.client_reference) && item.sku.toLowerCase() === input.sku.toLowerCase()), 'Another item already uses this SKU.');
      if (input.id !== undefined) {
        const product = productFor(snapshot, input.id, input.client_reference); requireValue(product.version === input.expected_version, 'This item changed. Refresh and review it before saving.');
        requireValue(product.kind === input.kind, 'An item’s kind cannot be changed.');
        const changedPrice = product.sku !== input.sku || product.name !== input.name.trim() || product.price_cents !== input.price_cents;
        Object.assign(product, {sku: input.sku, name: input.name.trim(), category: input.category.trim(), price_cents: input.price_cents, reorder_level: input.reorder_level, active: input.active, description: input.description.trim(), version: product.version + 1, price_version_id: changedPrice ? event.id : product.price_version_id});
      } else {
        requireValue(typeof input.client_reference === 'string' && UUID.test(input.client_reference), 'A new offline item requires a client reference.');
        requireValue(!snapshot.products.some(product => product.client_reference === input.client_reference), 'This item reference has already been used.');
        snapshot.products.unshift({id: -event.sequence, client_reference: input.client_reference, sku: input.sku, name: input.name.trim(), category: input.category.trim(), kind: input.kind, price_cents: input.price_cents, stock: 0, reserved: 0, allocated: 0, reorder_level: input.reorder_level, active: input.active, version: 1, price_version_id: event.id, description: input.description.trim()});
      }
      break;
    }
    case 'inventory.movement': {
      const input = payload as Payloads['inventory.movement'], product = productFor(snapshot, input.product_id, input.product_reference);
      requireValue(product.kind !== 'service', 'Services do not have physical stock.'); integer(input.quantity, -MAX_STOCK, MAX_STOCK, 'Invalid stock movement.'); requireValue(input.quantity !== 0, 'Stock movement cannot be zero.'); text(input.reason, 120, 'Movement reason');
      requireValue(input.quantity > 0 || product.kind === 'consumable', 'Outgoing supply usage is limited to internal consumables.');
      requireValue(input.quantity >= 0 || product.stock - product.reserved - product.allocated >= -input.quantity, 'Reserved or device-allocated stock cannot be removed.');
      integer(product.stock + input.quantity, 0, MAX_STOCK, 'Resulting stock exceeds the allowed amount.'); product.stock += input.quantity; product.version++;
      snapshot.movements.unshift({product_id: product.id, user_id: snapshot.staff.id, quantity: input.quantity, reason: input.reason.trim(), created_at: event.captured_at}); break;
    }
    case 'order.handoff': {
      const input = payload as Payloads['order.handoff']; reference(input.reference);
      const order = snapshot.orders.find(item => item.reference === input.reference);
      requireValue(order && ((snapshot.staff_directory || snapshot.cashiers).some(staff => staff.id === order.user_id && staff.role === 'admin') || order.user_id === snapshot.staff.id), 'Only an Admin-created order can be handed off.');
      requireValue(order && ['preparing','ready','out_for_delivery'].includes(order.status) && order.version === input.expected_version, 'This order is finished or changed. Refresh before handoff.');
      requireValue(!order.device_id, 'The Cashier must sync and release this order lease before handoff.');
      requireValue(snapshot.cashiers.some(staff => staff.id === input.assigned_cashier_id && staff.role === 'cashier' && staff.active), 'Choose an active Cashier.');
      if (order.assigned_cashier_id !== input.assigned_cashier_id) { order.assigned_cashier_id = input.assigned_cashier_id; order.assigned_by = snapshot.staff.id; order.assigned_at = event.captured_at; order.device_id = null; markOrder(order); }
      break;
    }
  }
  return snapshot;
}
