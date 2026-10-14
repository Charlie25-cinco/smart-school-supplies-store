export type Role = 'admin' | 'cashier';
export type Kind = 'product' | 'service' | 'consumable';
export type PaymentMethod = 'cash' | 'gcash';
export type OrderStatus = 'preparing' | 'ready' | 'out_for_delivery' | 'completed' | 'cancelled';
export interface Staff { id: number; name: string; email: string; role: Role; active: boolean; }
export interface Product { id: number; client_reference?: string; sku: string; name: string; category: string; kind: Kind; price_cents: number; stock: number; reserved: number; allocated: number; reorder_level: number; active: boolean; version: number; price_version_id: string; description: string; }
export interface Allocation { product_id: number; remaining: number; price_version_id: string; }
export interface PriceGrant { product_id: number; price_version_id: string; name: string; sku: string; kind: Kind; price_cents: number; }
export interface Device { id: string; staff_id: number; name: string; next_sequence: number; active: boolean; }
export interface Line { product_id: number; quantity: number; price_version_id: string | null; }
export interface FrozenLine extends Line { name: string; sku: string; kind: Kind; price_cents: number; total_cents: number; }
export interface Payment { method: PaymentMethod; amount_cents: number; reference?: string; verified?: boolean; }
export interface Sale { id?: number; reference: string; receipt_number: string; user_id: number; paid_by: number; channel: string; subtotal_cents: number; delivery_fee_cents: number; total_cents: number; cash_cents: number; change_cents: number; payment_method: PaymentMethod; payment_reference?: string; items: FrozenLine[]; created_at: string; local_status?: 'pending' | 'review'; }
export interface Order { id?: number; reference: string; user_id: number; assigned_cashier_id?: number | null; assigned_by?: number | null; assigned_at?: string | null; device_id?: string | null; channel: string; fulfillment: 'pickup' | 'delivery'; payment_plan: 'prepaid' | 'collection'; status: OrderStatus; customer_name: string; customer_phone: string; delivery_address: string; notes: string; subtotal_cents: number; delivery_fee_cents: number; total_cents: number; paid_by?: number | null; paid_at?: string | null; sale_reference?: string | null; items: FrozenLine[]; version: number; created_at: string; local_status?: 'pending' | 'review'; }
export interface Movement { id?: number; product_id: number; user_id: number; quantity: number; reason: string; created_at: string; }
export interface Review { id: string; kind: string; message: string; created_at: string; device_id?: string; staff_id?: number; sequence?: number; payload?: unknown; captured_at?: string; }
export interface Snapshot { staff: Staff; device: Device; products: Product[]; allocations: Allocation[]; price_grants: PriceGrant[]; orders: Order[]; sales: Sale[]; receipts?: Sale[]; movements: Movement[]; cashiers: Staff[]; staff_directory?: Omit<Staff, 'email'>[]; devices: Device[]; reviews: Review[]; fetched_at: string; }
export type Payloads = {
 'sale.create': { reference: string; receipt_number: string; channel: string; items: Line[]; payment: Payment };
 'order.create': { reference: string; receipt_number: string; channel: string; fulfillment: 'pickup' | 'delivery'; payment_plan: 'prepaid' | 'collection'; customer_name: string; customer_phone: string; delivery_address: string; notes: string; delivery_fee_cents: number; items: Line[]; payment?: Payment };
 'order.edit': { reference: string; expected_version: number; customer_name: string; customer_phone: string; delivery_address: string; notes: string; delivery_fee_cents: number; items: Line[] };
 'order.payment': { reference: string; expected_version: number; receipt_number: string; payment: Payment };
 'order.status': { reference: string; expected_version: number; status: OrderStatus; goods_returned?: boolean; cancel_reason?: string };
 'inventory.save': { id?: number; client_reference?: string; expected_version?: number; sku: string; name: string; category: string; kind: Kind; price_cents: number; reorder_level: number; active: boolean; description: string };
 'inventory.movement': { product_id: number; product_reference?: string; quantity: number; reason: string };
 'order.handoff': { reference: string; expected_version: number; assigned_cashier_id: number };
};
export type MutationKind = keyof Payloads;
export type Mutation<K extends MutationKind = MutationKind> = { id: string; device_id: string; sequence: number; kind: K; payload: Payloads[K]; captured_at: string; status: 'pending' | 'review'; message?: string };
export interface EventResult { id: string; status: 'synced' | 'review'; message?: string; }
export interface Backend {
 signIn(email: string, password: string): Promise<Staff>;
 signOut(): Promise<void>;
 registerDevice(name: string, id: string): Promise<Device>;
 snapshot(deviceId: string): Promise<Snapshot>;
 submit(event: Mutation): Promise<EventResult>;
 allocate(deviceId: string, productId: number, quantity: number): Promise<void>;
 releaseAllocation(deviceId: string, productId: number): Promise<void>;
 claimOrder(deviceId: string, reference: string): Promise<void>;
 releaseOrder(deviceId: string, reference: string): Promise<void>;
 refreshPriceGrants(deviceId: string, expectedSequence: number): Promise<void>;
 resolveReview(eventId: string, note: string, replacementEventId: string): Promise<void>;
 staffAction(action: 'create' | 'edit' | 'password' | 'active', values: Record<string, unknown>): Promise<void>;
}
