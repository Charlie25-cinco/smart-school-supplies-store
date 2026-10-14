import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export class LegacyImportError extends Error {}
const fail = message => { throw new LegacyImportError(message); };
const sha256 = value => createHash('sha256').update(value).digest('hex');
const tables = ['users', 'products', 'sales', 'orders', 'sale_items', 'order_items', 'stock_movements'];
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const integer = (value, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) => {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) fail('Source numbers exceed the supported range. Preserve the backup for private review.');
  return value;
};
const text = (value, maximum, required = true) => {
  if (value == null && !required) return '';
  if (typeof value !== 'string' || value.length > maximum || (required && !value.trim())) fail('Source text does not meet the supported schema. Preserve the backup for private review.');
  return value;
};
const boolean = value => {
  if (![true, false, 1, 0].includes(value)) fail('Source account or item status is invalid.');
  return value === true || value === 1;
};
const uuid = value => {
  if (typeof value !== 'string' || !uuidPattern.test(value)) fail('A source reference is not a UUID. No record was changed.');
  return value.toLowerCase();
};
const choice = (value, choices) => {
  if (!choices.includes(value)) fail('A source status, role, or item kind is unsupported.');
  return value;
};
const nullableId = value => value == null ? null : integer(value, 1);

/** Laravel timestamps without an offset are Asia/Manila store time. */
export function legacyTimestamp(value, optional = false) {
  if (value == null && optional) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})?$/.test(value)) {
    fail('A source timestamp is missing or invalid. Do not invent a historical date; resolve it privately before migration.');
  }
  const zoned = value.replace(' ', 'T') + (/(Z|[+-]\d{2}:\d{2})$/.test(value) ? '' : '+08:00');
  const [year,month,day,hour,minute,second]=value.match(/\d+/g).slice(0,6).map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year,month,0)).getUTCDate() || hour > 23 || minute > 59 || second > 59) fail('A source timestamp has an invalid calendar date. Preserve its original data for review.');
  const parsed = new Date(zoned);
  if (!Number.isFinite(parsed.getTime())) fail('A source timestamp is invalid.');
  // Keep submillisecond digits where available instead of truncating snapshots.
  const fraction = value.match(/\.(\d{1,6})/)?.[1];
  const stamp = parsed.toISOString();
  return fraction ? stamp.replace(/\.\d{3}Z$/, '.' + fraction + 'Z') : stamp.replace(/\.000Z$/, 'Z');
}

function rowsById(rows) {
  const map = new Map();
  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) fail('A source record is invalid.');
    const id = integer(row.id, 1);
    if (map.has(id)) fail('Duplicate source IDs were found.');
    map.set(id, row);
  }
  return map;
}

/** Bcrypt is private Auth input only; it is NEVER a public profile field. */
export function legacyPasswordHash(value) {
  if (typeof value !== 'string' || !/^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(value)) {
    fail('A legacy credential is not a supported bcrypt hash. Arrange a private password reset rather than substituting credentials.');
  }
  return value.replace(/^\$2y\$/, '$2b$');
}

/** Whitelist conversion; produces no password, remember token, or session data. */
export function mapLegacyDataset(source, authMapping) {
  if (!source || typeof source !== 'object' || Array.isArray(source) || Object.keys(source).some(key => !tables.includes(key))) fail('The private source bundle has unsupported tables.');
  for (const table of tables) if (!Array.isArray(source[table])) fail('The private source bundle is incomplete.');
  const raw = Object.fromEntries(tables.map(table => [table, rowsById(source[table])]));
  const staffIds = new Set(raw.users.keys());
  const productIds = new Set(raw.products.keys());
  const saleIds = new Set(raw.sales.keys());
  const orderIds = new Set(raw.orders.keys());
  const reference = (id, set) => { if (id !== null && !set.has(id)) fail('A source relationship points to a missing record.'); return id; };
  const dated = row => ({ created_at: legacyTimestamp(row.created_at), updated_at: legacyTimestamp(row.updated_at) });
  const emails = new Set();
  const profiles = source.users.map(row => {
    const email = text(row.email, 255);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || emails.has(email.toLowerCase())) fail('Case-conflicting or invalid staff emails require private review before migration.');
    emails.add(email.toLowerCase());
    legacyPasswordHash(row.password);
    return { id: row.id, auth_id: uuid(authMapping.get(row.id)), name: text(row.name, 100), email,
      role: choice(row.role === 'owner' ? 'admin' : row.role, ['admin', 'cashier']), active: boolean(row.active), ...dated(row) };
  });
  const profileById = rowsById(profiles);
  const products = source.products.map(row => {
    const kind = choice(row.kind, ['product', 'service', 'consumable']);
    const sku = text(row.sku, 40);
    if (!/^[A-Za-z0-9-]+$/.test(sku)) fail('A source SKU is invalid.');
    const stock = integer(row.stock, 0, 1000000), reserved = integer(row.reserved, 0, stock);
    if ((kind === 'service' && (stock !== 0 || reserved !== 0)) || (kind === 'consumable' && reserved !== 0)) fail('Source service or supply stock is inconsistent.');
    return { id: row.id, sku, name: text(row.name, 100), category: text(row.category, 60), kind,
      price_cents: integer(row.price_cents, kind === 'consumable' ? 0 : 1, 9999999), stock, reserved,
      reorder_level: integer(row.reorder_level, 0, 1000000), active: boolean(row.active), description: '', ...dated(row) };
  });
  if (new Set(products.map(row => row.sku)).size !== products.length) fail('Duplicate source SKUs were found.');
  const line = (row, parentKey, parentIds) => {
    const quantity = integer(row.quantity, 1, 999), price = integer(row.price_cents, 1, 9999999);
    if (integer(row.total_cents, 1) !== quantity * price) fail('A frozen line amount is inconsistent. Original prices were not changed.');
    return { id: row.id, [parentKey]: reference(integer(row[parentKey], 1), parentIds), product_id: reference(integer(row.product_id, 1), productIds),
      name: text(row.name, 100), sku: text(row.sku, 40), kind: choice(row.kind, ['product', 'service']), quantity, price_cents: price, total_cents: row.total_cents };
  };
  const order_items = source.order_items.map(row => line(row, 'order_id', orderIds));
  const sale_items = source.sale_items.map(row => line(row, 'sale_id', saleIds));
  const sumLines = (items, key, id) => items.filter(row => row[key] === id).reduce((total, row) => total + row.total_cents, 0);
  const seenParents = new Set();
  for (const [items, parentKey] of [[order_items, 'order_id'], [sale_items, 'sale_id']]) {
    for (const row of items) {
      const key = parentKey + ':' + row[parentKey] + ':' + row.product_id;
      if (seenParents.has(key)) fail('A source receipt or order repeats an item.');
      seenParents.add(key);
    }
  }
  const linkedOrders = new Map();
  for (const row of source.orders) if (row.sale_id != null) {
    if (linkedOrders.has(row.sale_id)) fail('More than one order links to the same receipt.');
    linkedOrders.set(reference(integer(row.sale_id, 1), saleIds), row);
  }
  const sales = source.sales.map(row => {
    const linked = linkedOrders.get(row.id);
    const collector = linked ? nullableId(linked.paid_by) : integer(row.user_id, 1);
    if (collector === null) fail('A paid source order has no recorded collector. Do not guess payment attribution.');
    const subtotal = sumLines(sale_items, 'sale_id', row.id), fee = integer(row.delivery_fee_cents, 0, 9999999), total = integer(row.total_cents, 1, 999999999);
    if (subtotal < 1 || subtotal + fee !== total) fail('A source receipt total does not match its frozen lines and fee.');
    const method = choice(row.payment_method, ['cash', 'gcash']), received = integer(row.cash_cents, total, 999999999), change = integer(row.change_cents, 0);
    const paymentReference = row.payment_reference == null ? null : text(row.payment_reference, 80);
    if ((method === 'cash' && (change !== received - total || paymentReference !== null)) ||
      (method === 'gcash' && (received !== total || change !== 0 || !/^[A-Z0-9-]{6,80}$/.test(paymentReference ?? '')))) fail('Source payment fields are inconsistent. No payment reference was changed.');
    return { id: row.id, reference: uuid(row.reference), receipt_number: 'SS-' + String(row.id).padStart(6, '0'),
      user_id: reference(integer(row.user_id, 1), staffIds), paid_by: reference(collector, staffIds), channel: choice(row.channel, ['walk-in', 'messenger']),
      subtotal_cents: subtotal, delivery_fee_cents: fee, total_cents: total, cash_cents: received, change_cents: change,
      payment_method: method, payment_reference: paymentReference, ...dated(row) };
  });
  if (new Set(sales.map(row => row.reference)).size !== sales.length || new Set(sales.filter(row => row.payment_reference).map(row => row.payment_reference)).size !== sales.filter(row => row.payment_reference).length) fail('Duplicate source checkout or payment references were found.');
  const saleById = rowsById(sales);
  const orders = source.orders.map(row => {
    const subtotal = integer(row.subtotal_cents, 1, 999999999), fee = integer(row.delivery_fee_cents, 0, 9999999), total = integer(row.total_cents, 1, 999999999);
    if (sumLines(order_items, 'order_id', row.id) !== subtotal || subtotal + fee !== total) fail('A source order total does not match its frozen lines and fee.');
    const saleId = nullableId(row.sale_id), sale = saleId === null ? null : saleById.get(saleId);
    const creator = reference(integer(row.user_id, 1), staffIds), orderReference = uuid(row.reference);
    if (sale && (sale.reference !== orderReference || sale.user_id !== creator || sale.total_cents !== total || sale.delivery_fee_cents !== fee || sale.channel !== row.channel)) fail('A paid source order differs from its historical receipt.');
    const originalLines = order_items.filter(item => item.order_id === row.id).map(({id, order_id, ...snapshot}) => snapshot).sort((a,b) => a.product_id - b.product_id);
    const receiptLines = sale_items.filter(item => item.sale_id === saleId).map(({id, sale_id, ...snapshot}) => snapshot).sort((a,b) => a.product_id - b.product_id);
    if (sale && JSON.stringify(originalLines) !== JSON.stringify(receiptLines)) fail('A paid source order line differs from its frozen receipt snapshot.');
    const assigned = reference(nullableId(row.assigned_cashier_id), staffIds), assignedBy = reference(nullableId(row.assigned_by), staffIds);
    if (assigned !== null && (profileById.get(creator).role !== 'admin' || profileById.get(assigned).role !== 'cashier' || assignedBy === null || profileById.get(assignedBy).role !== 'admin')) fail('A source assignment has an invalid creator, actor, or recipient.');
    const fulfillment = choice(row.fulfillment, ['pickup', 'delivery']), address = text(row.delivery_address, 300, fulfillment === 'delivery');
    if (fulfillment === 'pickup' && fee !== 0) fail('A source pickup has a delivery fee.');
    const phone = text(row.customer_phone, 30);
    if (!/^[0-9+()\s-]{7,30}$/.test(phone)) fail('A source contact number is invalid.');
    const status = choice(row.status, ['preparing', 'ready', 'out_for_delivery', 'completed', 'cancelled']);
    if ((status === 'completed' && !sale) || (status === 'cancelled' && (sale || !row.cancel_reason?.trim()))) fail('A source fulfillment/payment state is inconsistent.');
    return { id: row.id, reference: orderReference, user_id: creator, sale_id: saleId, paid_by: sale?.paid_by ?? null,
      paid_at: sale?.created_at ?? null, assigned_cashier_id: assigned, assigned_by: assignedBy, assigned_at: legacyTimestamp(row.assigned_at, assigned === null),
      assignment_version: integer(row.assignment_version, 0), channel: choice(row.channel, ['walk-in', 'messenger']), fulfillment,
      payment_plan: choice(row.payment_plan === 'cod' ? 'collection' : row.payment_plan, ['prepaid', 'collection']), status,
      customer_name: text(row.customer_name, 100), customer_phone: phone, delivery_address: fulfillment === 'delivery' ? address : '',
      notes: text(row.notes, 500, false), cancel_reason: row.cancel_reason == null ? null : text(row.cancel_reason, 300),
      subtotal_cents: subtotal, delivery_fee_cents: fee, total_cents: total, ...dated(row) };
  });
  if (new Set(orders.map(row => row.reference)).size !== orders.length) fail('Duplicate source order references were found.');
  for (const order of orders) {
    const sale = sales.find(row => row.reference === order.reference);
    if (sale && order.sale_id !== sale.id) fail('An unrelated source sale and order share a checkout reference.');
  }
  for (const product of products) {
    const reserved = orders.filter(row => row.sale_id === null && row.status !== 'cancelled')
      .reduce((sum, order) => sum + order_items.filter(item => item.order_id === order.id && item.product_id === product.id && item.kind === 'product').reduce((n,item) => n + item.quantity,0),0);
    if (reserved !== product.reserved) fail('Source reservation totals do not equal unpaid unfinished order quantities. No stock was corrected automatically.');
  }
  const stock_movements = source.stock_movements.map(row => {
    const quantity = integer(row.quantity, -1000000, 1000000);
    if (quantity === 0) fail('A source stock movement has zero quantity.');
    return { id: row.id, product_id: reference(integer(row.product_id,1),productIds), user_id: reference(nullableId(row.user_id),staffIds),
      sale_id: reference(nullableId(row.sale_id),saleIds), quantity, reason: text(row.reason,200), ...dated(row) };
  });
  return { profiles, products, sales, orders, sale_items, order_items, stock_movements };
}

async function fileDigest(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

export async function loadLegacyBundle(path) {
  const metadata = await stat(path);
  if (!metadata.isFile() || metadata.size > 36000000) fail('Use a complete private migration bundle within the supported size.');
  const bytes = await readFile(path);
  let bundle, source;
  try { bundle = JSON.parse(bytes.toString('utf8')); source = JSON.parse(bundle.data_json); }
  catch { fail('The private migration bundle could not be read.'); }
  if (bundle.format !== 'smart-school-supplies-legacy-v1' || !uuidPattern.test(bundle.import_id) || typeof bundle.data_json !== 'string' || Buffer.byteLength(bundle.data_json) > 16000000 || sha256(bundle.data_json) !== bundle.data_sha256) fail('The private source data digest does not match the export.');
  const backupPath = join(dirname(path),'database.snapshot.sqlite');
  if (await fileDigest(backupPath) !== bundle.backup_sha256) fail('The verified SQLite backup is missing or its digest changed.');
  for (const table of tables) if (!Array.isArray(source[table]) || source[table].length !== bundle.counts?.[table]) fail('Private export row counts do not match.');
  // Validate before creating even one Auth account; temporary IDs never leave CLI.
  const dummy = new Map(source.users.map(row => [row.id, '10000000-0000-4000-8000-' + sha256(String(row.id)).slice(0,12)]));
  mapLegacyDataset(source,dummy);
  return { bundle, source, digest: sha256(bytes) };
}

/** Adapter is injectable solely for isolated tests; real CLI uses Admin API. */
export async function runLegacyImport(path, adapter) {
  const {bundle,source,digest} = await loadLegacyBundle(path);
  const status = await adapter.status(bundle.import_id,digest);
  if (status.status === 'complete') return status;
  if (status.status !== 'empty') fail('The target is not empty or does not match this migration. No existing data was replaced.');
  const existing = await adapter.listAuthUsers();
  const mapping = new Map();
  for (const user of existing) {
    const marker = user.app_metadata ?? {};
    const staff = source.users.find(row => row.id === marker.legacy_staff_id);
    if (!staff || marker.legacy_import_id !== bundle.import_id || marker.legacy_source_digest !== digest || user.email?.toLowerCase() !== staff.email.toLowerCase() || mapping.has(staff.id)) fail('The target contains unrelated or conflicting Auth accounts. Do not merge them automatically.');
    mapping.set(staff.id,uuid(user.id));
  }
  for (const staff of source.users) if (!mapping.has(staff.id)) {
    const user = await adapter.createAuthUser({ email:staff.email.toLowerCase(), password_hash:legacyPasswordHash(staff.password), email_confirm:true,
      app_metadata:{legacy_import_id:bundle.import_id,legacy_staff_id:staff.id,legacy_source_digest:digest} });
    mapping.set(staff.id,uuid(user.id));
  }
  const dataset = mapLegacyDataset(source,mapping);
  const result = await adapter.importData({p_import_id:bundle.import_id,p_source_digest:digest,p_dataset:dataset});
  const expected = Object.fromEntries(Object.entries(dataset).map(([table,rows]) => [table,rows.length]));
  if (result.status !== 'complete' || Object.entries(expected).some(([table,count]) => result.counts?.[table] !== count)) fail('The import response could not be verified. Preserve this bundle and retry the same migration; do not create a new export.');
  return result;
}

export async function supabaseImportAdapter(url,key) {
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(url ?? '') || typeof key !== 'string' || !key) fail('Set SUPABASE_URL and the server-only SUPABASE_SERVICE_ROLE_KEY in this CLI environment.');
  const {createClient} = await import('@supabase/supabase-js');
  const server = createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  const rpc = async (name,parameters) => {
    const {data,error} = await server.rpc(name,parameters);
    if (error || !data) fail('The private database operation did not complete. Preserve the bundle and retry against the same target.');
    return data;
  };
  return {
    status:(id,digest) => rpc('legacy_import_status',{p_import_id:id,p_source_digest:digest}),
    async listAuthUsers() {
      const users=[];
      for(let page=1;;page++) {
        const {data,error}=await server.auth.admin.listUsers({page,perPage:1000});
        if(error) fail('Private Auth inspection failed. No credentials were printed.');
        users.push(...data.users);
        if(data.users.length<1000) return users;
      }
    },
    async createAuthUser(attributes) {
      const {data,error}=await server.auth.admin.createUser(attributes);
      if(error||!data.user) fail('Private Auth provisioning did not complete. Resume this same bundle; do not delete or overwrite accounts.');
      return data.user;
    },
    importData:parameters => rpc('import_legacy',parameters),
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fileURLToPath(pathToFileURL(process.argv[1]))) {
  try {
    if (process.argv.length !== 4 || process.argv[2] !== '--bundle') fail('Usage: node import-legacy.mjs --bundle <private legacy.private.json path>');
    const adapter = await supabaseImportAdapter(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY);
    const result = await runLegacyImport(process.argv[3],adapter);
    console.log('Private atomic import verified. Preserved rows: ' + Object.values(result.counts).reduce((sum,count) => sum+count,0) + '. No credentials or records were printed.');
  } catch(error) {
    console.error(error instanceof LegacyImportError ? error.message : 'Private migration failed. Preserve the bundle and resume it after private inspection.');
    process.exitCode=1;
  }
}
