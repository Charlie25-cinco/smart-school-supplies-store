import assert from 'node:assert/strict';
import test, {type TestContext} from 'node:test';
import {IDBFactory, IDBObjectStore} from 'fake-indexeddb';
import type {Backend, Device, EventResult, Mutation, Payloads, Snapshot, Staff} from '../src/models';
import {OfflineStore} from '../src/core/store';
import {canonicalJson, payloadHash, replayIdentity} from '../src/core/identity';
import {collectPrices, projectEvent} from '../src/core/projection';
import {openDatabase, readWorkspace, updateWorkspace, workspaceKey} from '../src/core/database';

const clone = <T>(value: T): T => structuredClone(value);
const deviceId = '10000000-0000-4000-8000-000000000001';
const oldPrice = '20000000-0000-4000-8000-000000000001';
const currentPrice = '20000000-0000-4000-8000-000000000002';
const uuid = () => crypto.randomUUID();
const now = '2026-10-14T02:00:00.000Z';

function seed(role: 'admin' | 'cashier' = 'cashier', quota = 2): Snapshot {
  const staff: Staff = {id: role === 'admin' ? 1 : 10, name: 'Fictional ' + role, email: role + '@example.test', role, active: true};
  return {
    staff, device: {id: deviceId, staff_id: staff.id, name: 'Fictional test device', next_sequence: 1, active: true},
    products: [{id: 1, sku: 'DEMO-NOTE', name: 'Demo notebook', category: 'Paper', kind: 'product', price_cents: 100, stock: 5, reserved: 0, allocated: quota, reorder_level: 1, active: true, version: 1, price_version_id: oldPrice, description: 'Fictional item'}],
    allocations: quota ? [{product_id: 1, remaining: quota, price_version_id: oldPrice}] : [],
    price_grants: [{product_id: 1, price_version_id: oldPrice, name: 'Demo notebook', sku: 'DEMO-NOTE', kind: 'product', price_cents: 100}],
    orders: [], sales: [], movements: [], cashiers: [{id: 10, name: 'Fictional cashier', email: 'cashier@example.test', role: 'cashier', active: true}],
    staff_directory: [{id: 1, name: 'Fictional admin', role: 'admin', active: true},{id: 10, name: 'Fictional cashier', role: 'cashier', active: true}],
    devices: [], reviews: [], fetched_at: now,
  };
}
const sale = (quantity = 1): Payloads['sale.create'] => ({reference: uuid(), receipt_number: 'DEMO-' + uuid(), channel: 'walk-in', items: [{product_id: 1, quantity, price_version_id: oldPrice}], payment: {method: 'cash', amount_cents: quantity * 100}});
const order = (quantity = 1): Payloads['order.create'] => ({reference: uuid(), receipt_number: 'DEMO-' + uuid(), channel: 'messenger', fulfillment: 'delivery', payment_plan: 'collection', customer_name: 'Fictional customer', customer_phone: '09000000000', delivery_address: 'Fictional delivery address', notes: '', delivery_fee_cents: 20, items: [{product_id: 1, quantity, price_version_id: oldPrice}]});

/** Transport/idempotency double; numeric business expectations are asserted separately. */
class FakeBackend implements Backend {
  calls: Mutation[] = [];
  signOutCalls = 0;
  failTransport = false;
  failAfterCommit = false;
  failSnapshot = false;
  failSignOut = false;
  failResolution = false;
  reviewNext = false;
  authorizationDenied = false;
  resolutions: {original: string; replacement: string}[] = [];
  private results = new Map<string, {identity: string; result: EventResult}>();
  constructor(public state: Snapshot) {}
  async signIn(): Promise<Staff> { return clone(this.state.staff); }
  async signOut(): Promise<void> { this.signOutCalls++; if (this.failSignOut) throw new Error('Fictional sign-out transport failure'); }
  async registerDevice(): Promise<Device> { return clone(this.state.device); }
  async snapshot(): Promise<Snapshot> { if (this.failSnapshot) throw new Error('Fictional snapshot transport failure'); return clone(this.state); }
  async submit(event: Mutation): Promise<EventResult> {
    this.calls.push(clone(event));
    if (this.authorizationDenied) throw Object.assign(new Error('Fictional authorization denied'), {code: 'STAFF_REAUTH_REQUIRED'});
    if (this.failTransport) throw new Error('Fictional transport interruption');
    const previous = this.results.get(event.id);
    if (previous) { assert.equal(replayIdentity(event), previous.identity); return clone(previous.result); }
    assert.equal(event.sequence, this.state.device.next_sequence, 'Server received an out-of-order event');
    let result: EventResult;
    if (this.reviewNext) {
      this.reviewNext = false;
      result = {id: event.id, status: 'review', message: 'Fictional cloud conflict requires review'};
      this.state.reviews.push({id: event.id, kind: event.kind, message: result.message!, created_at: event.captured_at});
    } else { this.state = projectEvent(this.state, event, collectPrices(this.state), false); result = {id: event.id, status: 'synced'}; }
    this.state.device.next_sequence = event.sequence + 1;
    this.results.set(event.id, {identity: replayIdentity(event), result});
    if (this.failAfterCommit) { this.failAfterCommit = false; throw new Error('Fictional response lost after commit'); }
    return clone(result);
  }
  async allocate(_deviceId: string, productId: number, quantity: number): Promise<void> {
    const product = this.state.products.find(item => item.id === productId)!;
    product.allocated += quantity; product.version++;
    const existing = this.state.allocations.find(allocation => allocation.product_id === productId);
    if (existing) existing.remaining += quantity; else this.state.allocations.push({product_id: productId, remaining: quantity, price_version_id: product.price_version_id});
  }
  async releaseAllocation(_deviceId: string, productId: number): Promise<void> {
    const allocation = this.state.allocations.find(item => item.product_id === productId)!;
    this.state.products.find(item => item.id === productId)!.allocated -= allocation.remaining; allocation.remaining = 0;
  }
  async claimOrder(): Promise<void> {}
  async releaseOrder(): Promise<void> {}
  async refreshPriceGrants(): Promise<void> {}
  async staffAction(): Promise<void> {}
  async resolveReview(original: string, _note: string, replacement: string): Promise<void> {
    if (this.failResolution) throw new Error('Fictional resolution transport failure');
    assert.equal(this.results.get(replacement)?.result.status, 'synced');
    this.resolutions.push({original, replacement}); this.state.reviews = this.state.reviews.filter(review => review.id !== original);
  }
}

async function setup(t: TestContext, snapshot = seed(), options: {locks?: Pick<LockManager, 'request'> | null; clock?: () => string} = {}) {
  const factory = new IDBFactory(), name = 'core-' + uuid(), backend = new FakeBackend(clone(snapshot));
  const stores: OfflineStore[] = [];
  const open = async () => { const store = await OfflineStore.open({backend, indexedDB: factory, databaseName: name, clock: () => now, broadcast: false, ...options}); stores.push(store); return store; };
  const store = await open(); await store.prepare(snapshot);
  t.after(() => stores.forEach(item => item.close()));
  return {store, open, factory, name, backend};
}

function serializedLocks(): Pick<LockManager, 'request'> {
  let tail = Promise.resolve();
  return {request: (...args: unknown[]) => {
    const callback = args.at(-1) as () => Promise<unknown>;
    const operation = tail.then(() => callback()); tail = operation.then(() => undefined, () => undefined); return operation;
  }} as unknown as Pick<LockManager, 'request'>;
}

test('payload hashing is canonical, rejects non-finite values, and ignores mutable queue feedback', async () => {
  assert.equal(canonicalJson({b: 2, a: 1}), canonicalJson({a: 1, b: 2}));
  assert.throws(() => canonicalJson({amount: NaN}), /unsupported/);
  const input = sale(), hash = await payloadHash('sale.create', input);
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.notEqual(hash, await payloadHash('sale.create', {...input, payment: {...input.payment, amount_cents: 200}}));
  const event: Mutation = {id: uuid(), device_id: deviceId, sequence: 1, kind: 'sale.create', payload: input, captured_at: now, status: 'pending'};
  assert.equal(replayIdentity(event), replayIdentity({...event, status: 'review', message: 'Needs review'}));
  assert.notEqual(replayIdentity(event), replayIdentity({...event, sequence: 2}));
});

test('fresh browser cannot record offline before a device is prepared', async t => {
  const factory = new IDBFactory(), backend = new FakeBackend(seed());
  const store = await OfflineStore.open({backend, indexedDB: factory, databaseName: uuid(), broadcast: false}); t.after(() => store.close());
  assert.equal(await store.restore(), null);
  await assert.rejects(store.mutate('sale.create', sale()), /prepare this device/);
  assert.equal(backend.calls.length, 0);
});

test('sale and outbox commit together, survive reload and never reuse sequence numbers', async t => {
  const {store, open, backend} = await setup(t);
  let notifications = 0; store.subscribe(() => notifications++);
  const first = await store.mutate('sale.create', sale());
  assert.equal(first.sequence, 1); assert.equal(notifications, 1);
  assert.equal(store.snapshot!.sales.length, 1); assert.equal(store.snapshot!.products[0].stock, 4);
  assert.equal(store.snapshot!.allocations[0].remaining, 1); assert.equal(store.pendingCount, 1); assert.equal(backend.calls.length, 0);
  const reopened = await open(); assert.equal(reopened.pendingCount, 1); assert.deepEqual(reopened.events[0], first);
  const second = await reopened.mutate('sale.create', sale()); assert.equal(second.sequence, 2);
  assert.equal(reopened.snapshot!.allocations[0].remaining, 0); assert.equal(reopened.snapshot!.products[0].version, 3);
});

test('simultaneous tabs cannot overspend the same last allocated unit without Web Locks', async t => {
  const {store, open} = await setup(t, seed('cashier', 1), {locks: null}); const secondTab = await open();
  const results = await Promise.allSettled([store.mutate('sale.create', sale()), secondTab.mutate('sale.create', sale())]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter(result => result.status === 'rejected').length, 1);
  const reloaded = await open(); assert.equal(reloaded.snapshot!.sales.length, 1); assert.equal(reloaded.snapshot!.allocations[0].remaining, 0);
  assert.equal(reloaded.pendingCount, 1); assert.equal(reloaded.snapshot!.device.next_sequence, 2);
});

test('aborted IDB commit reports failure without changing stock, queue, sequence or success notifications', async t => {
  const {store, open} = await setup(t); const before = store.snapshot; let notified = false; store.subscribe(() => { notified = true; });
  const put = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function () { throw new DOMException('Isolated storage capacity failure', 'QuotaExceededError'); };
  try { await assert.rejects(store.mutate('sale.create', sale()), /capacity failure/); }
  finally { IDBObjectStore.prototype.put = put; }
  assert.equal(notified, false); assert.deepEqual(store.snapshot, before);
  const reloaded = await open(); assert.equal(reloaded.pendingCount, 0); assert.equal(reloaded.snapshot!.device.next_sequence, 1);
});

test('snapshot and event getters cannot mutate durable allocations or replay payloads', async t => {
  const {store} = await setup(t); await store.mutate('sale.create', sale());
  store.snapshot!.allocations[0].remaining = 999;
  (store.events[0].payload as Payloads['sale.create']).payment.amount_cents = 999;
  assert.equal(store.snapshot!.allocations[0].remaining, 1);
  assert.equal((store.events[0].payload as Payloads['sale.create']).payment.amount_cents, 100);
});

test('transport interruption retains immutable pending identity across reload and idempotent retry', async t => {
  const {store, open, backend} = await setup(t); const event = await store.mutate('sale.create', sale());
  backend.failAfterCommit = true; const first = await store.sync();
  assert.equal(first.pending, 1); assert.match(first.transportError!, /lost after commit/);
  assert.equal(backend.state.sales.length, 1);
  const reloaded = await open(); const second = await reloaded.sync();
  assert.equal(second.pending, 0); assert.equal(second.synced, 1); assert.equal(backend.state.sales.length, 1);
  assert.equal(reloaded.snapshot!.sales.length, 1); assert.equal(reloaded.snapshot!.allocations[0].remaining, 1);
  assert.equal(replayIdentity(backend.calls[0]), replayIdentity(backend.calls[1])); assert.equal(backend.calls[1].id, event.id);
});

test('acknowledged projection is retained if fresh cloud snapshot fails', async t => {
  const {store, open, backend} = await setup(t); await store.mutate('sale.create', sale()); backend.failSnapshot = true;
  const result = await store.sync(); assert.equal(result.synced, 1); assert.equal(result.pending, 0); assert.match(result.transportError!, /snapshot/);
  const reloaded = await open(); assert.equal(reloaded.snapshot!.sales.length, 1); assert.equal(reloaded.snapshot!.products[0].stock, 4);
  backend.failSnapshot = false; await reloaded.sync(); assert.equal(backend.calls.length, 1); assert.equal(reloaded.snapshot!.sales[0].local_status, undefined);
});

test('cloud refresh reapplies pending events without restoring spent stock', async t => {
  const {store, open} = await setup(t); await store.mutate('sale.create', sale()); await store.refresh();
  assert.equal(store.snapshot!.products[0].stock, 4); assert.equal(store.snapshot!.allocations[0].remaining, 1);
  const reloaded = await open(); assert.equal(reloaded.pendingCount, 1); assert.equal(reloaded.snapshot!.sales.length, 1);
});

test('server review consumes sequence, persists visible review and allows later queue events to sync', async t => {
  const {store, open, backend} = await setup(t); const first = await store.mutate('sale.create', sale()); await store.mutate('sale.create', sale());
  backend.reviewNext = true; const result = await store.sync();
  assert.equal(result.review, 1); assert.equal(result.synced, 1); assert.equal(result.pending, 0);
  assert.deepEqual(backend.calls.map(event => event.sequence), [1, 2]); assert.equal(store.snapshot!.sales.length, 1);
  assert.equal(store.snapshot!.allocations[0].remaining, 1); assert.equal(store.events[0].id, first.id); assert.equal(store.events[0].status, 'review');
  const reloaded = await open(); assert.equal(reloaded.reviewCount, 1); assert.equal(reloaded.canSignOut, false);
  await assert.rejects(reloaded.signOut(), /resolve pending or reviewed/); assert.equal(backend.signOutCalls, 0);
});

test('failed pending replay remains in outbox with explicit review feedback rather than disappearing', async t => {
  const {store, backend} = await setup(t); const event = await store.mutate('sale.create', sale());
  backend.state.allocations[0].remaining = 0; backend.state.products[0].allocated = 0; await store.refresh();
  assert.equal(store.pendingCount, 1); assert.equal(store.events[0].id, event.id); assert.match(store.events[0].message!, /allocated stock/);
  assert.equal(store.reviewCount, 1); assert.match(store.snapshot!.reviews[0].message, /Pending sync/);
});

test('saved payload tampering fails the identity check and cannot submit to the cloud', async t => {
  const {store, factory, name, backend} = await setup(t); await store.mutate('sale.create', sale());
  const db = await openDatabase(factory, name);
  await updateWorkspace(db, workspaceKey(10, deviceId), record => { (record!.events[0].event.payload as Payloads['sale.create']).payment.amount_cents = 1; return {workspace: record, result: undefined}; }); db.close();
  const result = await store.sync(); assert.match(result.transportError!, /identity check/); assert.equal(result.pending, 1); assert.equal(backend.calls.length, 0);
});

test('exact review retry uses a new identity/sequence and retains old review until reconciliation succeeds', async t => {
  const {store, open, backend} = await setup(t); const original = await store.mutate('sale.create', sale()); backend.reviewNext = true; await store.sync();
  const replacement = await store.retryReview(original.id);
  assert.notEqual(replacement.id, original.id); assert.equal(replacement.sequence, 2); assert.deepEqual(replacement.payload, original.payload);
  assert.equal(store.reviewCount, 1); backend.failResolution = true;
  const failedResolution = await store.sync(); assert.match(failedResolution.transportError!, /resolution/); assert.equal(store.reviewCount, 1); assert.equal(store.canSignOut, false);
  const reloaded = await open(); backend.failResolution = false; await reloaded.sync();
  assert.equal(reloaded.reviewCount, 0); assert.equal(reloaded.canSignOut, true); assert.equal(backend.state.sales.length, 1);
  assert.deepEqual(backend.resolutions, [{original: original.id, replacement: replacement.id}]);
});

test('review retry across business days preserves the original sale date through reload and synchronization', async t => {
  let capturedAt = now;
  const {store, open, backend} = await setup(t, seed(), {clock: () => capturedAt});
  const original = await store.mutate('sale.create', sale()); backend.reviewNext = true; await store.sync();
  capturedAt = '2026-10-16T02:00:00.000Z';
  const reloaded = await open(), replacement = await reloaded.retryReview(original.id);
  assert.notEqual(replacement.id, original.id); assert.equal(replacement.sequence, original.sequence + 1);
  assert.equal(replacement.captured_at, original.captured_at); assert.deepEqual(replacement.payload, original.payload);
  assert.equal(reloaded.snapshot!.sales[0].created_at, now);
  await reloaded.sync(); assert.equal(backend.state.sales[0].created_at, now); assert.equal(reloaded.reviewCount, 0);
});

test('version-approved payment retry preserves original money, collector and business date', async t => {
  let capturedAt = now;
  const {store, backend} = await setup(t, seed(), {clock: () => capturedAt});
  const input = order(); await store.mutate('order.create', input); await store.sync();
  const original = await store.mutate('order.payment', {reference: input.reference, expected_version: 1, receipt_number: input.receipt_number, payment: {method: 'gcash', amount_cents: 120, reference: 'DATE-RECOVERY-001', verified: true}});
  backend.reviewNext = true; await store.sync(); backend.state.orders[0].version = 2;
  capturedAt = '2026-10-17T02:00:00.000Z';
  await assert.rejects(store.retryReview(original.id), /order changed/);
  const replacement = await store.retryReview(original.id, true);
  assert.equal(replacement.captured_at, now);
  assert.deepEqual(replacement.payload, {...original.payload, expected_version: 2});
  await store.sync(); const saved = backend.state.sales[0];
  assert.equal(saved.created_at, now); assert.equal(saved.total_cents, 120); assert.equal(saved.paid_by, 10);
  assert.equal(saved.payment_reference, 'DATE-RECOVERY-001'); assert.equal(backend.state.orders[0].paid_at, now);
  assert.equal(store.reviewCount, 0);
});

test('version-approved inventory retry uses the current version and preserves the original capture', async t => {
  let capturedAt = now;
  const {store, backend} = await setup(t, seed('admin'), {clock: () => capturedAt});
  const input: Payloads['inventory.save'] = {id: 1, expected_version: 1, sku: 'DEMO-NOTE', name: 'Corrected fictional notebook', category: 'Paper', kind: 'product', price_cents: 100, reorder_level: 1, active: true, description: ''};
  const original = await store.mutate('inventory.save', input); backend.reviewNext = true; await store.sync();
  backend.state.products[0].version = 2; capturedAt = '2026-10-18T02:00:00.000Z';
  const replacement = await store.retryReview(original.id, true);
  assert.deepEqual(replacement.payload, {...input, expected_version: 2}); assert.equal(replacement.captured_at, now);
  await store.sync(); assert.equal(store.reviewCount, 0); assert.equal(backend.state.products[0].name, input.name);
});

test('historical grants freeze their own names/prices despite newer inventory values', async t => {
  const snapshot = seed(); snapshot.products[0].name = 'New label'; snapshot.products[0].price_cents = 250; snapshot.products[0].price_version_id = currentPrice;
  const {store} = await setup(t, snapshot); const input = sale(); await store.mutate('sale.create', input);
  assert.equal(store.snapshot!.sales[0].total_cents, 100); assert.equal(store.snapshot!.sales[0].items[0].name, 'Demo notebook');
  assert.equal(store.snapshot!.sales[0].items[0].price_version_id, oldPrice);
  await assert.rejects(store.mutate('sale.create', {...sale(), items: [{product_id: 1, quantity: 1, price_version_id: currentPrice}]}), /prepare the current price/);
});

test('COD reserves allocated units, adjusts reservations on edit and records payment exactly once', async t => {
  const {store} = await setup(t); const input = order(); await store.mutate('order.create', input);
  assert.equal(store.snapshot!.products[0].stock, 5); assert.equal(store.snapshot!.products[0].reserved, 1); assert.equal(store.snapshot!.allocations[0].remaining, 1);
  const editing: Payloads['order.edit'] = {reference: input.reference, expected_version: 1, customer_name: input.customer_name, customer_phone: input.customer_phone, delivery_address: input.delivery_address, notes: 'Fictional correction', delivery_fee_cents: 20, items: [{product_id: 1, quantity: 2, price_version_id: oldPrice}]};
  await store.mutate('order.edit', editing); assert.equal(store.snapshot!.products[0].reserved, 2); assert.equal(store.snapshot!.allocations[0].remaining, 0);
  await store.mutate('order.payment', {reference: input.reference, expected_version: 2, receipt_number: input.receipt_number, payment: {method: 'cash', amount_cents: 300}});
  assert.equal(store.snapshot!.sales.length, 1); assert.equal(store.snapshot!.sales[0].change_cents, 80);
  assert.equal(store.snapshot!.products[0].stock, 3); assert.equal(store.snapshot!.products[0].reserved, 0); assert.equal(store.snapshot!.products[0].version, 4);
  await assert.rejects(store.mutate('order.payment', {reference: input.reference, expected_version: 3, receipt_number: input.receipt_number, payment: {method: 'cash', amount_cents: 300}}), /already been paid/);
  assert.equal(store.pendingCount, 3); assert.equal(store.snapshot!.sales.length, 1);
});

test('prepaid order matches reservation/payment versions and paid edits preserve receipt amounts', async t => {
  const {store} = await setup(t); const input = {...order(), payment_plan: 'prepaid' as const, payment: {method: 'cash' as const, amount_cents: 200}};
  await store.mutate('order.create', input); assert.equal(store.snapshot!.orders[0].version, 2); assert.equal(store.snapshot!.products[0].version, 3);
  assert.equal(store.snapshot!.products[0].reserved, 0); assert.equal(store.snapshot!.products[0].stock, 4); assert.equal(store.snapshot!.sales[0].total_cents, 120);
  const edit: Payloads['order.edit'] = {reference: input.reference, expected_version: 2, customer_name: 'Corrected fictional name', customer_phone: input.customer_phone, delivery_address: input.delivery_address, notes: '', delivery_fee_cents: 20, items: input.items};
  await store.mutate('order.edit', edit); assert.equal(store.snapshot!.sales[0].total_cents, 120);
  await assert.rejects(store.mutate('order.edit', {...edit, expected_version: 3, delivery_fee_cents: 30}), /amounts are frozen/);
});

test('cancel releases reservations back to this device once and requires returned dispatched goods', async t => {
  const {store} = await setup(t); const input = order(); await store.mutate('order.create', input);
  await store.mutate('order.status', {reference: input.reference, expected_version: 1, status: 'ready'});
  await store.mutate('order.status', {reference: input.reference, expected_version: 2, status: 'out_for_delivery'});
  await assert.rejects(store.mutate('order.status', {reference: input.reference, expected_version: 3, status: 'cancelled', cancel_reason: 'Fictional cancellation'}), /returned/);
  await store.mutate('order.status', {reference: input.reference, expected_version: 3, status: 'cancelled', cancel_reason: 'Fictional cancellation', goods_returned: true});
  assert.equal(store.snapshot!.allocations[0].remaining, 2); assert.equal(store.snapshot!.products[0].reserved, 0); assert.equal(store.snapshot!.products[0].stock, 5);
  await store.mutate('order.status', {reference: input.reference, expected_version: 4, status: 'cancelled'});
  assert.equal(store.snapshot!.allocations[0].remaining, 2);
});

test('lease, ownership, stale versions, skipped status and unpaid completion fail without consuming sequence', async t => {
  const {store, backend} = await setup(t); const input = order(); await store.mutate('order.create', input);
  await assert.rejects(store.mutate('order.status', {reference: input.reference, expected_version: 1, status: 'completed'}), /next delivery/);
  await assert.rejects(store.mutate('order.status', {reference: input.reference, expected_version: 99, status: 'ready'}), /order changed/);
  await store.mutate('order.status', {reference: input.reference, expected_version: 1, status: 'ready'});
  await store.mutate('order.status', {reference: input.reference, expected_version: 2, status: 'out_for_delivery'});
  await assert.rejects(store.mutate('order.status', {reference: input.reference, expected_version: 3, status: 'completed'}), /Record payment/);
  await store.sync(); backend.state.orders[0].device_id = uuid(); await store.refresh();
  await assert.rejects(store.mutate('order.payment', {reference: input.reference, expected_version: 3, receipt_number: input.receipt_number, payment: {method: 'cash', amount_cents: 200}}), /claim this order/);
  backend.state.orders[0].device_id = deviceId; backend.state.orders[0].user_id = 999; await store.refresh();
  await assert.rejects(store.mutate('order.status', {reference: input.reference, expected_version: 3, status: 'completed'}), /unavailable to your account/);
  assert.equal(store.snapshot!.device.next_sequence, 4);
});

test('GCash is exact, manually verified, normalized and unique across queued transactions', async t => {
  const {store} = await setup(t); const input = sale(); input.payment = {method: 'gcash', amount_cents: 100, reference: ' demo-gcash-123 ', verified: true};
  await store.mutate('sale.create', input); assert.equal(store.snapshot!.sales[0].payment_reference, 'DEMO-GCASH-123');
  await assert.rejects(store.mutate('sale.create', {...sale(), payment: input.payment}), /already been recorded/);
  await assert.rejects(store.mutate('sale.create', {...sale(), payment: {...input.payment, reference: 'OTHER-123', verified: false}}), /Verify the exact/);
  await assert.rejects(store.mutate('sale.create', {...sale(), payment: {...input.payment, reference: 'OTHER-123', amount_cents: 200}}), /Verify the exact/);
  assert.equal(store.pendingCount, 1);
});

test('centavos/quantity bounds and unknown payload fields are rejected before persistence', async t => {
  const {store} = await setup(t);
  for (const quantity of [0, -1, 1.5, 1000]) await assert.rejects(store.mutate('sale.create', {...sale(), items: [{product_id: 1, quantity, price_version_id: oldPrice}]}), /between 1 and 999/);
  await assert.rejects(store.mutate('sale.create', {...sale(), payment: {method: 'cash', amount_cents: 100.5}}), /valid payment/);
  await assert.rejects(store.mutate('sale.create', {...sale(), password: 'never-persist-this'} as Payloads['sale.create']), /unsupported fields/);
  assert.equal(store.pendingCount, 0); assert.equal(store.snapshot!.device.next_sequence, 1);
});

test('Admin and Cashier mutation permissions are enforced locally', async t => {
  const cashier = await setup(t); await assert.rejects(cashier.store.mutate('inventory.movement', {product_id: 1, quantity: 1, reason: 'Demo'}), /Only an Admin/);
  const admin = await setup(t, seed('admin')); await assert.rejects(admin.store.mutate('sale.create', sale()), /Only a Cashier/);
});

test('Admin offline consumable usage cannot exceed remaining physical stock', async t => {
  const snapshot = seed('admin'); snapshot.products[0].kind = 'consumable'; snapshot.products[0].allocated = 0; snapshot.products[0].reserved = 0;
  snapshot.products[0].price_cents = 0; snapshot.allocations = []; snapshot.price_grants = [];
  const {store} = await setup(t, snapshot);
  await assert.rejects(store.mutate('inventory.movement', {product_id: 1, quantity: -6, reason: 'Fictional adjustment'}), /Reserved or device-allocated/);
  await store.mutate('inventory.movement', {product_id: 1, quantity: -1, reason: 'Fictional adjustment'});
  assert.equal(store.snapshot!.products[0].stock, 4); assert.equal(store.snapshot!.products[0].version, 2);
});

test('sellable-product usage is rejected without consuming stock, evidence or sequence; receipts remain possible', async t => {
  const {store} = await setup(t, seed('admin'));
  await assert.rejects(store.mutate('inventory.movement', {product_id: 1, quantity: -1, reason: 'Fictional product usage'}), /internal consumables/);
  assert.equal(store.snapshot!.products[0].stock, 5); assert.equal(store.snapshot!.products[0].version, 1);
  assert.equal(store.pendingCount, 0); assert.equal(store.snapshot!.device.next_sequence, 1);
  await store.mutate('inventory.movement', {product_id: 1, quantity: 1, reason: 'Fictional product receipt'});
  assert.equal(store.snapshot!.products[0].stock, 6); assert.equal(store.snapshot!.device.next_sequence, 2);
});

test('new offline inventory supports dependent stock and edits through its client reference', async t => {
  const {store, open} = await setup(t, seed('admin'));
  const client_reference = uuid(), input: Payloads['inventory.save'] = {client_reference, sku: 'NEW-DEMO', name: 'New fictional item', category: 'Paper', kind: 'product', price_cents: 250, reorder_level: 2, active: true, description: ''};
  await store.mutate('inventory.save', input); const product = store.snapshot!.products.find(item => item.client_reference === client_reference)!;
  assert.equal(product.id, -1);
  await store.mutate('inventory.movement', {product_id: product.id, product_reference: client_reference, quantity: 4, reason: 'Fictional opening stock'});
  await store.mutate('inventory.save', {...input, id: product.id, expected_version: 2, name: 'Edited fictional item'});
  const reloaded = await open(), saved = reloaded.snapshot!.products.find(item => item.client_reference === client_reference)!;
  assert.equal(saved.stock, 4); assert.equal(saved.version, 3); assert.equal(saved.name, 'Edited fictional item');
  assert.deepEqual(reloaded.events.map(event => event.sequence), [1, 2, 3]);
});

test('online resource actions fail closed without Web Locks and are blocked by pending changes', async t => {
  const fallback = await setup(t, seed(), {locks: null}); let calls = 0;
  await assert.rejects(fallback.store.onlineAction(async () => { calls++; }), /Web Locks/); assert.equal(calls, 0);
  const locked = await setup(t, seed(), {locks: serializedLocks()}); await locked.store.mutate('sale.create', sale());
  await assert.rejects(locked.store.onlineAction(async () => { calls++; }), /Sync and resolve/); assert.equal(calls, 0);
});

test('onlineAction holds the same cross-tab lock while release and snapshot refresh run', async t => {
  const {store, open} = await setup(t, seed(), {locks: serializedLocks()}); const secondTab = await open();
  let release!: () => void, entered!: () => void;
  const inside = new Promise<void>(resolve => { entered = resolve; }), barrier = new Promise<void>(resolve => { release = resolve; });
  const action = store.onlineAction(async backend => { entered(); await barrier; await backend.releaseAllocation(deviceId, 1); });
  await inside; let mutationSettled = false;
  const mutation = secondTab.mutate('sale.create', sale()).finally(() => { mutationSettled = true; });
  await new Promise(resolve => setTimeout(resolve, 5)); assert.equal(mutationSettled, false);
  release(); await action; await assert.rejects(mutation, /allocated stock/); assert.equal(store.pendingCount, 0);
});

test('logout with a clean queue deletes prepared sensitive data only after backend success', async t => {
  const {store, open, factory, name, backend} = await setup(t, seed(), {locks: serializedLocks()}); backend.failSignOut = true;
  await assert.rejects(store.signOut(), /sign-out transport/); assert.equal(await store.restore(), null);
  assert.equal(store.signOutPending, true); assert.notEqual(store.preparedIdentity, null);
  backend.failSignOut = false; await store.signOut(); assert.equal(store.snapshot, null);
  const db = await openDatabase(factory, name); assert.equal(await readWorkspace(db, workspaceKey(10, deviceId)), undefined); db.close();
  const reloaded = await open(); assert.equal(await reloaded.restore(10, deviceId), null);
  await assert.rejects(reloaded.mutate('sale.create', sale()), /prepare this device/);
});

test('interrupted logout is suspended after restart and can finish before the device is prepared again', async t => {
  const {store, open, factory, name, backend} = await setup(t, seed(), {locks: serializedLocks()});
  const db = await openDatabase(factory, name);
  await updateWorkspace(db, workspaceKey(10, deviceId), workspace => { workspace!.signingOut = true; return {workspace, result: undefined}; }); db.close();
  const reloaded = await open();
  assert.equal(reloaded.snapshot, null); assert.equal(reloaded.signOutPending, true); assert.equal(reloaded.canSignOut, true);
  await assert.rejects(reloaded.prepare(seed()), /Finish the interrupted sign out/);
  await assert.rejects(reloaded.mutate('sale.create', sale()), /prepare this device/);
  await reloaded.signOut(); assert.equal(backend.signOutCalls, 1); assert.equal(reloaded.preparedIdentity, null);
  await reloaded.prepare(seed()); assert.equal(reloaded.snapshot!.staff.id, 10); assert.equal(reloaded.signOutPending, false);
  await store.restore(); assert.equal(store.signOutPending, false);
});

test('backend logout followed by aborted private-data deletion remains recoverable after reload', async t => {
  const {store, open, backend} = await setup(t, seed(), {locks: serializedLocks()});
  const remove = IDBObjectStore.prototype.delete;
  IDBObjectStore.prototype.delete = function () { throw new DOMException('Fictional interrupted cleanup', 'AbortError'); };
  try { await assert.rejects(store.signOut(), /interrupted cleanup/); }
  finally { IDBObjectStore.prototype.delete = remove; }
  assert.equal(backend.signOutCalls, 1); assert.equal(store.snapshot, null);
  const reloaded = await open(); assert.equal(reloaded.signOutPending, true); assert.notEqual(reloaded.preparedIdentity, null);
  await reloaded.signOut(); assert.equal(backend.signOutCalls, 2); assert.equal(reloaded.preparedIdentity, null);
});

test('two tabs serialize cleanup retries and cannot sign out overlapping sessions', async t => {
  const {open, factory, name, backend} = await setup(t, seed(), {locks: serializedLocks()});
  const db = await openDatabase(factory, name);
  await updateWorkspace(db, workspaceKey(10, deviceId), workspace => { workspace!.signingOut = true; return {workspace, result: undefined}; }); db.close();
  const first = await open(), second = await open();
  let entered!: () => void, release!: () => void;
  const inside = new Promise<void>(resolve => { entered = resolve; }), barrier = new Promise<void>(resolve => { release = resolve; });
  backend.signOut = async () => { backend.signOutCalls++; entered(); await barrier; };
  const firstCleanup = first.signOut(); await inside;
  const secondCleanup = assert.rejects(second.signOut(), /no active prepared account/);
  await new Promise(resolve => setTimeout(resolve, 5)); assert.equal(backend.signOutCalls, 1);
  release(); await firstCleanup; await secondCleanup;
  assert.equal(backend.signOutCalls, 1); const reloaded = await open(); assert.equal(reloaded.preparedIdentity, null);
});

test('interrupted logout never deletes pending evidence and cannot resume without cross-tab locks', async t => {
  const {store, open, factory, name, backend} = await setup(t, seed(), {locks: null});
  const db = await openDatabase(factory, name);
  await updateWorkspace(db, workspaceKey(10, deviceId), workspace => { workspace!.signingOut = true; return {workspace, result: undefined}; }); db.close();
  const reloaded = await open(); await assert.rejects(reloaded.signOut(), /Web Locks support/);
  assert.equal(backend.signOutCalls, 0); assert.notEqual(reloaded.preparedIdentity, null);
  const resetDb = await openDatabase(factory, name);
  await updateWorkspace(resetDb, workspaceKey(10, deviceId), workspace => { workspace!.signingOut = false; return {workspace, result: undefined}; }); resetDb.close();
  await store.restore(); await store.mutate('sale.create', sale());
  const evidenceDb = await openDatabase(factory, name);
  await updateWorkspace(evidenceDb, workspaceKey(10, deviceId), workspace => { workspace!.signingOut = true; return {workspace, result: undefined}; }); evidenceDb.close();
  const locked = await OfflineStore.open({backend, indexedDB: factory, databaseName: name, broadcast: false, locks: serializedLocks()}); t.after(() => locked.close());
  await assert.rejects(locked.signOut(), /pending or reviewed/); assert.equal(locked.pendingCount, 1); assert.equal(backend.signOutCalls, 0);
});

test('pending changes block logout and cache cannot switch to another staff identity', async t => {
  const {store, backend} = await setup(t); await store.mutate('sale.create', sale());
  await assert.rejects(store.signOut(), /Sync and resolve/); assert.equal(backend.signOutCalls, 0);
  await assert.rejects(store.restore(1, deviceId), /switching staff/);
  await assert.rejects(store.prepare(seed('admin')), /Sign out/); assert.equal(store.snapshot!.staff.role, 'cashier');
});

test('known authorization denial suspends offline writes durably without erasing pending events', async t => {
  const {store, open, backend} = await setup(t); const original = await store.mutate('sale.create', sale()); backend.authorizationDenied = true;
  const result = await store.sync(); assert.equal(result.pending, 1); assert.match(result.transportError!, /authorization denied/); assert.equal(store.snapshot, null);
  const reloaded = await open(); assert.equal(reloaded.snapshot, null); assert.equal(reloaded.events[0].id, original.id);
  await assert.rejects(reloaded.mutate('sale.create', sale()), /prepare this device/);
  await assert.rejects(reloaded.signOut(), /resolve pending/); assert.equal(backend.signOutCalls, 0);
  backend.authorizationDenied = false; await reloaded.prepare(await backend.snapshot()); await reloaded.sync();
  assert.equal(reloaded.pendingCount, 0); assert.equal(reloaded.snapshot!.sales.length, 1);
});

test('inactive and unknown-role snapshots cannot authorize offline work', async t => {
  const {store} = await setup(t);
  const inactive = seed(); inactive.staff.active = false;
  await assert.rejects(store.prepare(inactive), /prepare this device/);
  const unknown = seed(); unknown.staff.role = 'rider' as Staff['role'];
  await assert.rejects(store.prepare(unknown), /prepare this device/);
  assert.equal(store.snapshot!.staff.role, 'cashier'); assert.equal(store.snapshot!.staff.active, true);
});

test('services use historical grants without consuming physical device allocation', async t => {
  const snapshot = seed('cashier', 0); snapshot.products[0].kind = 'service'; snapshot.price_grants[0].kind = 'service';
  const {store} = await setup(t, snapshot); await store.mutate('sale.create', sale(2));
  assert.equal(store.snapshot!.sales[0].total_cents, 200); assert.equal(store.snapshot!.products[0].stock, 5); assert.equal(store.snapshot!.products[0].version, 1);
  assert.equal(store.snapshot!.allocations.length, 0); assert.equal(store.snapshot!.movements.length, 0);
});

test('a claimed historical order can return its reservation even without a prior allocation row', async t => {
  const snapshot = seed('cashier', 0), input = order(); snapshot.products[0].reserved = 1;
  snapshot.orders.push({reference: input.reference, user_id: 1, assigned_cashier_id: 10, device_id: deviceId, channel: 'messenger', fulfillment: 'delivery', payment_plan: 'collection', status: 'preparing', customer_name: input.customer_name, customer_phone: input.customer_phone, delivery_address: input.delivery_address, notes: '', subtotal_cents: 100, delivery_fee_cents: 20, total_cents: 120, items: [{...input.items[0], price_version_id: null, name: 'Historical notebook', sku: 'OLD-NOTE', kind: 'product', price_cents: 100, total_cents: 100}], version: 1, created_at: now});
  const {store} = await setup(t, snapshot);
  await store.mutate('order.status', {reference: input.reference, expected_version: 1, status: 'cancelled', cancel_reason: 'Fictional historical cancellation'});
  assert.equal(store.snapshot!.products[0].reserved, 0); assert.equal(store.snapshot!.allocations[0].remaining, 1);
  assert.equal(store.snapshot!.orders[0].items[0].price_version_id, null);
});

test('Admin handoff preserves creator and frozen history and cannot revoke an active device lease', async t => {
  const snapshot = seed('admin'), input = order();
  snapshot.orders.push({reference: input.reference, user_id: 1, device_id: deviceId, channel: 'messenger', fulfillment: 'delivery', payment_plan: 'collection', status: 'preparing', customer_name: input.customer_name, customer_phone: input.customer_phone, delivery_address: input.delivery_address, notes: '', subtotal_cents: 100, delivery_fee_cents: 20, total_cents: 120, items: [{...input.items[0], name: 'Frozen historical notebook', sku: 'OLD-NOTE', kind: 'product', price_cents: 100, total_cents: 100}], version: 1, created_at: now});
  const {store, backend} = await setup(t, snapshot);
  await assert.rejects(store.mutate('order.handoff', {reference: input.reference, expected_version: 1, assigned_cashier_id: 10}), /release this order lease/);
  backend.state.orders[0].device_id = null; await store.refresh();
  await store.mutate('order.handoff', {reference: input.reference, expected_version: 1, assigned_cashier_id: 10});
  const handed = store.snapshot!.orders[0]; assert.equal(handed.user_id, 1); assert.equal(handed.assigned_cashier_id, 10); assert.equal(handed.version, 2); assert.equal(handed.items[0].name, 'Frozen historical notebook'); assert.equal(handed.total_cents, 120);
});

test('older server responses cannot overwrite newer cached snapshots or sequence progress', async t => {
  const {store, backend} = await setup(t); backend.state.fetched_at = '2026-10-14T02:05:00.000Z'; backend.state.products[0].name = 'Newer cloud label'; await store.refresh();
  backend.state.fetched_at = now; backend.state.products[0].name = 'Stale cloud label';
  await assert.rejects(store.refresh(), /newer cloud snapshot/); assert.equal(store.snapshot!.products[0].name, 'Newer cloud label');
  backend.state.fetched_at = '2026-10-14T02:06:00.000Z'; backend.state.device.next_sequence = 0;
  await assert.rejects(store.refresh(), /Invalid device sequence/); assert.equal(store.snapshot!.device.next_sequence, 1);
});

test('failed retry chains retain every review until a final exact replacement succeeds', async t => {
  const {store, backend} = await setup(t); const original = await store.mutate('sale.create', sale()); backend.reviewNext = true; await store.sync();
  const firstRetry = await store.retryReview(original.id); backend.reviewNext = true; await store.sync(); assert.equal(store.reviewCount, 2);
  await assert.rejects(store.retryReview(original.id), /retry already exists/);
  const finalRetry = await store.retryReview(firstRetry.id); await store.sync();
  assert.equal(store.reviewCount, 0); assert.equal(store.snapshot!.sales.length, 1);
  assert.deepEqual(backend.resolutions, [{original: firstRetry.id, replacement: finalRetry.id},{original: original.id, replacement: finalRetry.id}]);
});

test('new offline receipt is immediately viewable without a cloud refresh', async t => {
  const snapshot = seed(); snapshot.receipts = [];
  const {store} = await setup(t, snapshot); const input = sale(); await store.mutate('sale.create', input);
  assert.equal(store.snapshot!.receipts!.length, 1); assert.equal(store.snapshot!.receipts![0].reference, input.reference); assert.equal(store.snapshot!.receipts![0].local_status, 'pending');
});

test('ambiguous online resource change blocks offline spending until a successful refresh after reload', async t => {
  const {store, open, backend} = await setup(t, seed(), {locks: serializedLocks()}); backend.failSnapshot = true;
  await assert.rejects(store.onlineAction(client => client.releaseAllocation(deviceId, 1)), /snapshot/);
  assert.equal(store.requiresRefresh, true); assert.equal(backend.state.allocations[0].remaining, 0);
  const reloaded = await open(); assert.equal(reloaded.requiresRefresh, true);
  await assert.rejects(reloaded.mutate('sale.create', sale()), /unfinished shared-state update/); assert.equal(reloaded.pendingCount, 0);
  backend.failSnapshot = false; await reloaded.sync(); assert.equal(reloaded.requiresRefresh, false); assert.equal(reloaded.snapshot!.allocations[0].remaining, 0);
  await assert.rejects(reloaded.mutate('sale.create', sale()), /allocated stock/);
});

test('explicit stale-version resolution retains synced evidence and resumes reconciliation after reload', async t => {
  const {store, open, backend} = await setup(t); const input = order(); await store.mutate('order.create', input); await store.sync();
  const original = await store.mutate('order.status', {reference: input.reference, expected_version: 1, status: 'ready'}); backend.reviewNext = true; await store.sync();
  backend.state.orders[0].version = 2; await store.refresh();
  const corrected = await store.mutate('order.status', {reference: input.reference, expected_version: 2, status: 'ready'}); await store.sync();
  assert.equal(store.reviewCount, 1); assert.equal(store.syncedEvents.some(event => event.id === corrected.id), true);
  backend.failResolution = true;
  await assert.rejects(store.resolveReview(original.id, corrected.id, 'Reviewed the fresh order version and applied the same intended status.'), /resolution/);
  const reloaded = await open(); assert.equal(reloaded.reviewCount, 1); assert.equal(reloaded.syncedEvents.some(event => event.id === corrected.id), true);
  backend.failResolution = false; await reloaded.sync(); assert.equal(reloaded.reviewCount, 0);
  assert.deepEqual(backend.resolutions, [{original: original.id, replacement: corrected.id}]);
});

test('explicit resolution cannot rewrite money or match an unrelated sale', async t => {
  const {store, backend} = await setup(t); const original = await store.mutate('sale.create', sale()); backend.reviewNext = true; await store.sync();
  const unrelated = await store.mutate('sale.create', sale()); await store.sync();
  await assert.rejects(store.resolveReview(original.id, unrelated.id, 'Fictional invalid replacement'), /preserve the original/);
  assert.equal(store.reviewCount, 1); assert.equal(backend.resolutions.length, 0);
});

test('local resolution rejects a confirmed matching action captured on a different business day', async t => {
  let capturedAt = now;
  const {store, backend} = await setup(t, seed(), {clock: () => capturedAt});
  const input = order(); await store.mutate('order.create', input); await store.sync();
  const original = await store.mutate('order.status', {reference: input.reference, expected_version: 1, status: 'ready'}); backend.reviewNext = true; await store.sync();
  backend.state.orders[0].version = 2; await store.refresh(); capturedAt = '2026-10-18T02:00:00.000Z';
  const laterAction = await store.mutate('order.status', {reference: input.reference, expected_version: 2, status: 'ready'}); await store.sync();
  await assert.rejects(store.resolveReview(original.id, laterAction.id, 'Fictional changed-date resolution'), /original captured business date/);
  assert.equal(store.events.find(event => event.id === original.id)!.captured_at, now);
  assert.equal(store.reviewCount, 1); assert.equal(backend.resolutions.length, 0);
});

test('suspended prepared identity has no credentials and clean revoked cache can still be signed out', async t => {
  const {store, backend, factory, name} = await setup(t);
  const db = await openDatabase(factory, name);
  await updateWorkspace(db, workspaceKey(10, deviceId), workspace => { workspace!.authorized = false; return {workspace, result: undefined}; }); db.close();
  await store.restore(); assert.equal(store.snapshot, null);
  assert.deepEqual(store.preparedIdentity, {staffId: 10, email: 'cashier@example.test', deviceId, name: 'Fictional test device', staffName: 'Fictional cashier'});
  await store.signOut(); assert.equal(backend.signOutCalls, 1); assert.equal(store.preparedIdentity, null);
});

test('other-device cloud reviews remain visible without blocking this clean device', async t => {
  const snapshot = seed(); snapshot.reviews.push({id: uuid(), kind: 'sale.create', message: 'Fictional review on another prepared device', device_id: uuid(), created_at: now});
  const {store} = await setup(t, snapshot, {locks: serializedLocks()});
  assert.equal(store.snapshot!.reviews.length, 1); assert.equal(store.reviewCount, 0); assert.equal(store.canSignOut, true);
  await store.onlineAction(async () => {}); await store.signOut(); assert.equal(store.snapshot, null);
});
