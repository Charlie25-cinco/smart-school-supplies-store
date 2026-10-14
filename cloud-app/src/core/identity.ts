import type { Mutation, MutationKind, Payloads } from '../models';

/** A deterministic representation excludes mutable queue status and feedback. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return '{' + Object.keys(value).filter(key => (value as Record<string, unknown>)[key] !== undefined).sort().map(key => JSON.stringify(key) + ':' + canonicalJson((value as Record<string, unknown>)[key])).join(',') + '}';
  }
  throw new Error('The change contains an unsupported value.');
}

export async function payloadHash<K extends MutationKind>(kind: K, payload: Payloads[K]): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalJson({kind, payload})));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export function replayIdentity(event: Mutation): string {
  return canonicalJson({id: event.id, device_id: event.device_id, sequence: event.sequence, kind: event.kind, payload: event.payload, captured_at: event.captured_at});
}
