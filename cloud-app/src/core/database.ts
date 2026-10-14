import type { Mutation, Snapshot } from '../models';
import type { Prices } from './projection';

export interface StoredEvent { event: Mutation; payloadHash: string; identity: string; acknowledged?: boolean; projectionError?: string; replacementFor?: string; resolutionNote?: string; resolvedBy?: string; }
export interface Workspace { key: string; base: Snapshot; snapshot: Snapshot; prices: Prices; events: StoredEvent[]; nextSequence: number; authorized: boolean; signingOut?: boolean; onlineChangePending?: boolean; }
export const workspaceKey = (staffId: number, deviceId: string) => staffId + ':' + deviceId;

export function openDatabase(factory: IDBFactory, name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(name, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      database.createObjectStore('workspaces', {keyPath: 'key'});
      database.createObjectStore('settings');
    };
    request.onerror = () => reject(new Error('Offline storage could not be opened. Allow browser storage before recording changes.'));
    request.onblocked = () => reject(new Error('Close older store tabs to update offline storage.'));
    request.onsuccess = () => resolve(request.result);
  });
}

export function requestValue<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
}

export async function readWorkspace(database: IDBDatabase, key?: string): Promise<Workspace | undefined> {
  if (!key) key = await requestValue(database.transaction('settings', 'readonly').objectStore('settings').get('active')) as string | undefined;
  if (!key) return undefined;
  return requestValue(database.transaction('workspaces', 'readonly').objectStore('workspaces').get(key)) as Promise<Workspace | undefined>;
}

/** The callback must stay synchronous so IndexedDB cannot commit between reads and writes. */
export function updateWorkspace<T>(database: IDBDatabase, key: string, update: (workspace: Workspace | undefined, settings: IDBObjectStore, activeKey: string | undefined) => {workspace?: Workspace; remove?: boolean; result: T}): Promise<T> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(['workspaces', 'settings'], 'readwrite', {durability: 'strict'});
    const workspaces = transaction.objectStore('workspaces'), settings = transaction.objectStore('settings');
    let result: T, failure: unknown;
    transaction.oncomplete = () => resolve(result);
    transaction.onabort = () => reject(failure || new Error('The change was not saved. Offline storage may be full or unavailable. No success was recorded.'));
    transaction.onerror = () => { /* onabort reports failure after the transaction rolls back. */ };
    const request = workspaces.get(key), active = settings.get('active');
    let recordReady = false, activeReady = false;
    const apply = () => {
      if (!recordReady || !activeReady) return;
      try {
        const updated = update(request.result as Workspace | undefined, settings, active.result as string | undefined);
        result = updated.result;
        if (updated.remove) workspaces.delete(key);
        else if (updated.workspace) workspaces.put(updated.workspace);
      } catch (error) { failure = error; transaction.abort(); }
    };
    request.onsuccess = () => { recordReady = true; apply(); };
    active.onsuccess = () => { activeReady = true; apply(); };
  });
}
