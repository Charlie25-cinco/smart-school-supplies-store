import type { Backend, Mutation, MutationKind, Payloads, Review, Snapshot } from '../models';
import { canonicalJson, payloadHash, replayIdentity } from './identity';
import { collectPrices, projectEvent, ValidationError } from './projection';
import { openDatabase, readWorkspace, updateWorkspace, workspaceKey, type StoredEvent, type Workspace } from './database';

export { ValidationError } from './projection';
export interface StoreOptions { backend: Backend; databaseName?: string; indexedDB?: IDBFactory; locks?: Pick<LockManager, 'request'> | null; clock?: () => string; uuid?: () => string; broadcast?: boolean; }
export interface SyncResult { synced: number; review: number; pending: number; transportError?: string; }
const copy = <T>(value: T): T => structuredClone(value);

function usable(workspace: Workspace | undefined, allowRefresh = false): asserts workspace is Workspace {
  if (!workspace || !workspace.authorized || workspace.signingOut) throw new ValidationError('Sign in online and prepare this device before recording changes.');
  const {staff, device} = workspace.snapshot;
  if (!staff.active || !device.active || staff.id !== device.staff_id || !['admin','cashier'].includes(staff.role)) throw new ValidationError('This account or device is not authorized for offline changes.');
  if (workspace.onlineChangePending && !allowRefresh) throw new ValidationError('Connect and refresh this device before recording changes after the unfinished shared-state update.');
}
function activeWorkspace(workspace: Workspace | undefined, activeKey: string | undefined, allowRefresh = false): asserts workspace is Workspace {
  usable(workspace, allowRefresh);
  if (workspace.key !== activeKey) throw new ValidationError('This staff account is no longer the active prepared session.');
}

function project(workspace: Workspace): void {
  let snapshot = copy(workspace.base);
  const reviews = new Map<string, Review>(snapshot.reviews.map(review => [review.id, review]));
  for (const stored of [...workspace.events].sort((a, b) => a.event.sequence - b.event.sequence)) {
    const event = stored.event;
    delete stored.projectionError;
    if (stored.resolvedBy) { reviews.delete(event.id); continue; }
    if (event.status === 'review') {
      reviews.set(event.id, {id: event.id, kind: event.kind, message: event.message || 'This change needs manual review.', created_at: event.captured_at, device_id: event.device_id, sequence: event.sequence, staff_id: snapshot.staff.id, payload: copy(event.payload), captured_at: event.captured_at});
      continue;
    }
    // The server snapshot already includes this processed sequence. Keep an
    // unacknowledged envelope for idempotent retry, without applying it twice.
    if (event.sequence < workspace.base.device.next_sequence) continue;
    try { snapshot = projectEvent(snapshot, event, workspace.prices, !stored.acknowledged); }
    catch (error) {
      stored.projectionError = error instanceof Error ? error.message : 'This pending change could not be projected.';
      reviews.set(event.id, {id: event.id, kind: event.kind, message: 'Pending sync: ' + stored.projectionError, created_at: event.captured_at, device_id: event.device_id, sequence: event.sequence, staff_id: snapshot.staff.id, payload: copy(event.payload), captured_at: event.captured_at});
    }
  }
  snapshot.reviews = [...reviews.values()]; snapshot.device.next_sequence = workspace.nextSequence;
  workspace.snapshot = snapshot;
}

function merge(workspace: Workspace, incoming: Snapshot): void {
  if (workspace.key !== workspaceKey(incoming.staff.id, incoming.device.id)) throw new ValidationError('The cloud snapshot belongs to another staff account or device.');
  if (!Number.isSafeInteger(incoming.device.next_sequence) || incoming.device.next_sequence < 1) throw new ValidationError('Invalid device sequence from the cloud.');
  if (incoming.device.next_sequence < workspace.base.device.next_sequence || Date.parse(incoming.fetched_at) < Date.parse(workspace.base.fetched_at)) throw new ValidationError('A newer cloud snapshot is already saved. Refresh again before changing shared state.');
  workspace.base = copy(incoming); workspace.prices = collectPrices(incoming, workspace.prices);
  const openReviews = incoming.reviews.length > 0 || workspace.events.some(stored => stored.event.status === 'review' && !stored.resolvedBy);
  workspace.events = workspace.events.filter(stored => !(stored.acknowledged && !stored.replacementFor && !openReviews && stored.event.sequence < incoming.device.next_sequence));
  workspace.nextSequence = Math.max(workspace.nextSequence, incoming.device.next_sequence, ...workspace.events.map(stored => stored.event.sequence + 1));
  workspace.authorized = incoming.staff.active && incoming.device.active && incoming.staff.id === incoming.device.staff_id && ['admin','cashier'].includes(incoming.staff.role);
  workspace.onlineChangePending = false;
  project(workspace);
}

/** Per-staff/device durable projections and immutable, sequential outbox events. */
export class OfflineStore {
  private workspace?: Workspace;
  private readonly listeners = new Set<() => void>();
  private readonly backend: Backend;
  private readonly name: string;
  private readonly locks: Pick<LockManager, 'request'> | null;
  private readonly clock: () => string;
  private readonly uuid: () => string;
  private channel?: BroadcastChannel;
  private constructor(private readonly database: IDBDatabase, options: StoreOptions) {
    this.backend = options.backend; this.name = options.databaseName || 'smart-school-supplies-offline-v1';
    this.locks = options.locks === undefined ? (typeof navigator === 'undefined' ? null : navigator.locks || null) : options.locks;
    this.clock = options.clock || (() => new Date().toISOString()); this.uuid = options.uuid || (() => crypto.randomUUID());
    if (options.broadcast !== false && typeof BroadcastChannel !== 'undefined') {
      this.channel = new BroadcastChannel(this.name + ':updates');
      this.channel.onmessage = () => { void this.reload().catch(() => { /* The next explicit action reports storage failures. */ }); };
    }
  }

  static async open(options: StoreOptions): Promise<OfflineStore> {
    const factory = options.indexedDB || globalThis.indexedDB;
    if (!factory) throw new ValidationError('This browser does not support durable offline storage.');
    const store = new OfflineStore(await openDatabase(factory, options.databaseName || 'smart-school-supplies-offline-v1'), options);
    await store.restore(); return store;
  }
  get snapshot(): Snapshot | null { return this.workspace?.authorized && !this.workspace.signingOut ? copy(this.workspace.snapshot) : null; }
  get preparedIdentity(): {staffId: number; email: string; deviceId: string; name: string; staffName: string} | null {
    const snapshot = this.workspace?.snapshot;
    return snapshot ? {staffId: snapshot.staff.id, email: snapshot.staff.email, deviceId: snapshot.device.id, name: snapshot.device.name, staffName: snapshot.staff.name} : null;
  }
  get events(): Mutation[] { return this.workspace ? this.workspace.events.filter(stored => !stored.acknowledged && !stored.resolvedBy).map(stored => copy({...stored.event, ...(stored.projectionError ? {message: stored.projectionError} : {})})) : []; }
  get syncedEvents(): Mutation[] { return this.workspace ? this.workspace.events.filter(stored => stored.acknowledged).map(stored => copy(stored.event)) : []; }
  get pendingCount(): number { return this.events.filter(event => event.status === 'pending').length; }
  get reviewCount(): number { return this.workspace?.snapshot.reviews.filter(review => !review.device_id || review.device_id === this.workspace!.snapshot.device.id).length || 0; }
  get requiresRefresh(): boolean { return !!this.workspace?.onlineChangePending; }
  get signOutPending(): boolean { return !!this.workspace?.signingOut; }
  get canSignOut(): boolean { return !!this.workspace && this.pendingCount === 0 && this.reviewCount === 0; }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  close(): void { this.channel?.close(); this.database.close(); this.listeners.clear(); }
  private notify(): void { for (const listener of this.listeners) { try { listener(); } catch { /* A rendering error cannot roll back durable data. */ } } }
  private async locked<T>(action: () => Promise<T>): Promise<T> { return this.locks ? this.locks.request(this.name + ':operations', {mode: 'exclusive'}, action) : action(); }
  private async reload(): Promise<void> { this.workspace = await readWorkspace(this.database); this.notify(); }
  private async committed(): Promise<void> { await this.reload(); this.channel?.postMessage('changed'); }
  private key(): string { if (!this.workspace) throw new ValidationError('Sign in online and prepare this device first.'); return this.workspace.key; }

  async restore(staffId?: number, deviceId?: string): Promise<Snapshot | null> {
    const active = await readWorkspace(this.database);
    if (active && ((staffId !== undefined && active.snapshot.staff.id !== staffId) || (deviceId !== undefined && active.snapshot.device.id !== deviceId))) throw new ValidationError('Sign in online before switching staff accounts or devices.');
    this.workspace = active;
    if (!active || !active.authorized || active.signingOut) { this.notify(); return null; }
    usable(active, true); this.notify(); return this.snapshot;
  }

  async prepare(snapshot: Snapshot): Promise<Snapshot> {
    return this.locked(async () => {
      const active = await readWorkspace(this.database), key = workspaceKey(snapshot.staff.id, snapshot.device.id);
      if (active && active.key !== key && active.authorized) throw new ValidationError('Sign out of the current account before preparing another account.');
      await updateWorkspace(this.database, key, (existing, settings, activeKey) => {
        if (activeKey && activeKey !== key) throw new ValidationError('Sign out of the current account before preparing another account.');
        const workspace: Workspace = existing || {key, base: copy(snapshot), snapshot: copy(snapshot), prices: {}, events: [], nextSequence: snapshot.device.next_sequence, authorized: true};
        if (workspace.signingOut) throw new ValidationError('Finish the interrupted sign out online before preparing this device again.');
        merge(workspace, snapshot); usable(workspace); workspace.signingOut = false;
        settings.put(key, 'active'); return {workspace, result: undefined};
      });
      await this.committed(); return this.snapshot!;
    });
  }

  async mutate<K extends MutationKind>(kind: K, payload: Payloads[K]): Promise<Mutation<K>> {
    // Hash before the IDB transaction; all reads, validation, sequence assignment,
    // outbox writes and projected-state writes stay inside its synchronous body.
    const captured = copy(payload), hash = await payloadHash(kind, captured), id = this.uuid(), capturedAt = this.clock();
    return this.locked(() => this.appendMutation(kind, captured, hash, id, capturedAt));
  }
  private async appendMutation<K extends MutationKind>(kind: K, captured: Payloads[K], hash: string, id: string, capturedAt: string, replacementFor?: string): Promise<Mutation<K>> {
      const key = this.key();
      const event = await updateWorkspace(this.database, key, (workspace, _settings, activeKey) => {
        activeWorkspace(workspace, activeKey);
        if (replacementFor) {
          const original = workspace.events.find(stored => stored.event.id === replacementFor);
          if (!original || original.event.status !== 'review' || original.resolvedBy) throw new ValidationError('This review is no longer available for retry.');
          if (workspace.events.some(stored => stored.replacementFor === replacementFor && !stored.resolvedBy)) throw new ValidationError('A retry already exists. Review that retry before trying again.');
        }
        const event: Mutation<K> = {id, device_id: workspace.snapshot.device.id, sequence: workspace.nextSequence, kind, payload: captured, captured_at: capturedAt, status: 'pending'};
        if (!Number.isSafeInteger(event.sequence) || event.sequence < 1 || event.sequence === Number.MAX_SAFE_INTEGER) throw new ValidationError('Connect to repair this device sequence before recording more changes.');
        if (workspace.events.some(stored => stored.event.id === event.id)) throw new ValidationError('This change identity has already been used.');
        const snapshot = projectEvent(workspace.snapshot, event as Mutation, workspace.prices);
        workspace.events.push({event: event as Mutation, payloadHash: hash, identity: replayIdentity(event as Mutation), ...(replacementFor ? {replacementFor} : {})});
        workspace.nextSequence++; snapshot.device.next_sequence = workspace.nextSequence; workspace.snapshot = snapshot;
        return {workspace, result: event};
      });
      await this.committed(); return copy(event);
  }
  enqueue<K extends MutationKind>(kind: K, payload: Payloads[K]): Promise<Mutation<K>> { return this.mutate(kind, payload); }

  async refresh(): Promise<Snapshot> {
    return this.locked(async () => { await this.refreshInside(); return this.snapshot!; });
  }
  private async refreshInside(): Promise<void> {
    const key = this.key(), current = await readWorkspace(this.database, key); usable(current, true);
    let incoming: Snapshot;
    try { incoming = await this.backend.snapshot(current.snapshot.device.id); }
    catch (error) { await this.suspendIfUnauthorized(error); throw error; }
    await updateWorkspace(this.database, key, (workspace, _settings, activeKey) => { activeWorkspace(workspace, activeKey, true); merge(workspace, incoming); return {workspace, result: undefined}; });
    await this.committed();
  }

  async sync(): Promise<SyncResult> {
    return this.locked(async () => {
      const result: SyncResult = {synced: 0, review: 0, pending: 0}; const key = this.key();
      try {
        const prepared = await readWorkspace(this.database, key); usable(prepared, true);
        if (prepared.onlineChangePending) await this.refreshInside();
        for (;;) {
          const current = await readWorkspace(this.database, key); usable(current);
          const stored = [...current.events].filter(item => item.event.status === 'pending' && !item.acknowledged && !item.resolvedBy).sort((a, b) => a.event.sequence - b.event.sequence)[0];
          if (!stored) break;
          if (stored.identity !== replayIdentity(stored.event) || stored.payloadHash !== await payloadHash(stored.event.kind, stored.event.payload)) throw new ValidationError('A saved change failed its identity check. It remains on this device for review.');
          const acknowledgement = await this.backend.submit(copy(stored.event));
          if (acknowledgement.id !== stored.event.id || !['synced','review'].includes(acknowledgement.status)) throw new ValidationError('The cloud acknowledgement did not match the saved change. It remains pending.');
          await updateWorkspace(this.database, key, (workspace, _settings, activeKey) => {
            activeWorkspace(workspace, activeKey);
            const target = workspace.events.find(item => item.event.id === stored.event.id);
            if (!target || target.identity !== stored.identity) throw new ValidationError('The saved change changed while syncing.');
            if (acknowledgement.status === 'review') { target.event.status = 'review'; target.event.message = acknowledgement.message || 'The cloud requires manual review of this change.'; }
            else target.acknowledged = true;
            project(workspace); return {workspace, result: undefined};
          });
          result[acknowledgement.status === 'synced' ? 'synced' : 'review']++;
          await this.committed();
        }
        await this.reconcileReviewsInside();
        await this.refreshInside();
      } catch (error) { await this.suspendIfUnauthorized(error); result.transportError = error instanceof Error ? error.message : 'Sync was interrupted. Saved changes remain on this device.'; }
      await this.reload(); result.pending = this.pendingCount; return result;
    });
  }

  private async suspendIfUnauthorized(error: unknown): Promise<void> {
    if (!error || typeof error !== 'object' || (error as {code?: string}).code !== 'STAFF_REAUTH_REQUIRED' || !this.workspace) return;
    const key = this.workspace.key;
    await updateWorkspace(this.database, key, (workspace, _settings, activeKey) => {
      if (workspace && activeKey === key) workspace.authorized = false;
      return {workspace, result: undefined};
    });
    await this.committed();
  }

  /** Explicit retry keeps the original business date and financial details. */
  async retryReview(id: string, refreshVersion = false): Promise<Mutation> {
    return this.locked(async () => {
      await this.refreshInside();
      const workspace = await readWorkspace(this.database, this.key()); usable(workspace);
      const original = workspace.events.find(stored => stored.event.id === id && stored.event.status === 'review' && !stored.resolvedBy);
      if (!original) throw new ValidationError('Retry this review on the device that captured the original change.');
      if (original.identity !== replayIdentity(original.event) || original.payloadHash !== await payloadHash(original.event.kind, original.event.payload)) throw new ValidationError('The original review failed its identity check.');
      const payload = copy(original.event.payload);
      if (refreshVersion) {
        if (!('expected_version' in payload)) throw new ValidationError('This change has no record version to refresh.');
        const version = original.event.kind === 'inventory.save'
          ? workspace.snapshot.products.find(product => ('id' in payload && product.id === payload.id) || ('client_reference' in payload && !!payload.client_reference && product.client_reference === payload.client_reference))?.version
          : original.event.kind.startsWith('order.') && 'reference' in payload
            ? workspace.snapshot.orders.find(order => order.reference === payload.reference)?.version : undefined;
        if (version === undefined) throw new ValidationError('The reviewed record is unavailable. Restore its access before retrying.');
        payload.expected_version = version;
      }
      return this.appendMutation(original.event.kind, payload, refreshVersion ? await payloadHash(original.event.kind, payload) : original.payloadHash, this.uuid(), original.event.captured_at, id);
    });
  }

  /** User-selected correction; only expected_version may differ from the review. */
  async resolveReview(originalId: string, replacementEventId: string, note: string): Promise<void> {
    if (typeof note !== 'string' || !note.trim() || note.trim().length > 300) throw new ValidationError('Explain the manual correction in 1–300 characters.');
    return this.locked(async () => {
      const key = this.key();
      await updateWorkspace(this.database, key, (workspace, _settings, activeKey) => {
        activeWorkspace(workspace, activeKey);
        const original = workspace.events.find(stored => stored.event.id === originalId && stored.event.status === 'review' && !stored.resolvedBy);
        const replacement = workspace.events.find(stored => stored.event.id === replacementEventId && stored.acknowledged);
        if (!original || !replacement) throw new ValidationError('Choose a saved review and its successfully synchronized replacement on this device.');
        const financialPayload = (event: Mutation) => { const payload = {...event.payload}; delete (payload as {expected_version?: number}).expected_version; return canonicalJson({kind: event.kind, payload}); };
        if (financialPayload(original.event) !== financialPayload(replacement.event)) throw new ValidationError('The replacement must preserve the original items, amounts, prices, receipt and payment references. Only the version may change.');
        if (original.event.captured_at !== replacement.event.captured_at) throw new ValidationError('The replacement must preserve the original captured business date.');
        if (replacement.replacementFor && replacement.replacementFor !== originalId) throw new ValidationError('This replacement is already linked to another reviewed change.');
        replacement.replacementFor = originalId; replacement.resolutionNote = note.trim(); return {workspace, result: undefined};
      });
      await this.committed();
      try { await this.reconcileReviewsInside(); await this.refreshInside(); }
      catch (error) { await this.suspendIfUnauthorized(error); throw error; }
    });
  }

  private async reconcileReviewsInside(): Promise<void> {
    const key = this.key(), workspace = await readWorkspace(this.database, key); usable(workspace);
    for (const replacement of workspace.events.filter(stored => stored.acknowledged && stored.replacementFor)) {
      let originalId = replacement.replacementFor;
      const seen = new Set<string>();
      while (originalId && !seen.has(originalId)) {
        seen.add(originalId);
        const current = await readWorkspace(this.database, key); usable(current);
        const original = current.events.find(stored => stored.event.id === originalId);
        if (!original) throw new ValidationError('The original review is missing from this device.');
        if (!original.resolvedBy) {
          await this.backend.resolveReview(original.event.id, replacement.resolutionNote || 'Exact original change retried successfully after manual correction.', replacement.event.id);
          await updateWorkspace(this.database, key, (record, _settings, activeKey) => {
            activeWorkspace(record, activeKey);
            const reviewed = record.events.find(stored => stored.event.id === original!.event.id);
            if (!reviewed) throw new ValidationError('The original review changed while resolving it.');
            reviewed.resolvedBy = replacement.event.id; project(record); return {workspace: record, result: undefined};
          });
          await this.committed();
        }
        originalId = original.replacementFor;
      }
    }
  }

  async onlineAction<T>(action: (backend: Backend) => Promise<T>): Promise<T> {
    if (!this.locks) throw new ValidationError('This browser cannot safely release shared stock or order locks. Use a browser with Web Locks support.');
    return this.locked(async () => {
      await this.reload(); usable(this.workspace);
      if (!this.canSignOut || this.workspace.events.some(event => event.acknowledged && event.event.sequence >= this.workspace!.base.device.next_sequence)) throw new ValidationError('Sync and resolve all pending changes before changing shared stock, order locks or accounts.');
      await updateWorkspace(this.database, this.key(), (workspace, _settings, activeKey) => {
        activeWorkspace(workspace, activeKey); workspace.onlineChangePending = true; return {workspace, result: undefined};
      });
      await this.committed();
      try { const result = await action(this.backend); await this.refreshInside(); return result; }
      catch (error) { await this.suspendIfUnauthorized(error); throw error; }
    });
  }

  async signOut(): Promise<void> {
    return this.locked(async () => {
      const key = this.key();
      await updateWorkspace(this.database, key, (workspace, _settings, activeKey) => {
        if (!workspace || workspace.key !== activeKey) throw new ValidationError('There is no active prepared account to sign out.');
        if (workspace.signingOut && !this.locks) throw new ValidationError('This browser needs Web Locks support to safely finish the interrupted sign out.');
        if (workspace.events.some(item => !item.acknowledged && !item.resolvedBy) || workspace.snapshot.reviews.some(review => !review.device_id || review.device_id === workspace.snapshot.device.id)) throw new ValidationError('Sync and resolve pending or reviewed changes before signing out.');
        workspace.signingOut = true; return {workspace, result: undefined};
      });
      await this.committed();
      try {
        await this.backend.signOut();
        await updateWorkspace(this.database, key, (workspace, settings, activeKey) => {
          if (!workspace || workspace.key !== activeKey || !workspace.signingOut) throw new ValidationError('The prepared sign-out state changed. Refresh before continuing.');
          settings.delete('active'); return {remove: true, result: undefined};
        });
      } catch (error) {
        // The Auth session may already be gone. Keep the durable cleanup intent
        // and hide private projections until logout is successfully resumed.
        await this.committed();
        throw error;
      }
      await this.committed();
    });
  }
}
