import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Backend, Device, EventResult, Mutation, Snapshot, Staff } from './models';

type CloudConfig = { url: string; key: string; configured: boolean; error?: string };
export function boundedFetch(fetcher: typeof fetch, timeoutMs = 8000): typeof fetch {
  return async (input, init) => {
    const controller = new AbortController();
    const original = init?.signal || (input instanceof Request ? input.signal : null);
    const abort = () => controller.abort(original?.reason);
    if (original?.aborted) abort(); else original?.addEventListener('abort', abort, {once:true});
    const timer = setTimeout(() => controller.abort(new DOMException('Cloud request timed out.', 'TimeoutError')), timeoutMs);
    try { return await fetcher(input, {...init, signal:controller.signal}); }
    finally { clearTimeout(timer); original?.removeEventListener('abort', abort); }
  };
}
export function validateConfig(url = '', key = ''): CloudConfig {
  if (!url && !key) return {url:'',key:'',configured:false};
  try {
    const endpoint = new URL(url);
    if (endpoint.protocol !== 'https:' || !/^[a-z0-9-]+\.supabase\.co$/.test(endpoint.hostname) || endpoint.pathname !== '/' || endpoint.search || endpoint.hash || endpoint.username || endpoint.password) throw new Error();
    if (key.startsWith('sb_secret_') || !key) throw new Error();
    if (!key.startsWith('sb_publishable_')) {
      const claims = JSON.parse(atob(key.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));
      if (claims.role !== 'anon') throw new Error();
    }
    return {url:endpoint.origin,key,configured:true};
  } catch { return {url:'',key:'',configured:false,error:'Use a public Supabase project URL and publishable (or anon) key. Secret and service-role keys must stay on the server.'}; }
}
export const getCloudConfig = () => validateConfig(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY);
const rememberedKey = 'smart-cloud-staff-v1';
function storageKey(url: string) { return 'smart-cloud-auth-v1-'+new URL(url).hostname; }
export function getRememberedStaffId(): number | null {
  const config = getCloudConfig(); if (!config.configured) return null;
  try {
    const remembered = JSON.parse(localStorage.getItem(rememberedKey) || 'null');
    const auth = JSON.parse(localStorage.getItem(storageKey(config.url)) || 'null');
    return remembered?.project === config.url && auth?.user?.id === remembered.auth_id && auth.access_token && Number.isSafeInteger(remembered.id) ? remembered.id : null;
  } catch { return null; }
}
class CloudBackend implements Backend {
  constructor(private client: SupabaseClient, private config: CloudConfig) {}
  private async rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
    const {data,error} = await this.client.rpc(name,args);
    if (error) {
      if (error.code === '42501' || error.code === 'PGRST301' || error.code === 'PGRST302') throw Object.assign(new Error('Sign in again with the active account for this device. Your unsynchronized work is retained.'),{code:'STAFF_REAUTH_REQUIRED'});
      if (!error.code) throw new Error('Connection interrupted. Your saved changes remain on this device. Use Sync now after reconnecting.');
      throw new Error(error.message || 'The cloud request did not complete. Your saved work is retained.');
    }
    return data as T;
  }
  async signIn(email: string, password: string): Promise<Staff> {
    const {data,error} = await this.client.auth.signInWithPassword({email,password});
    if (error || !data.user) throw new Error('Sign-in failed. Check your credentials and internet connection.');
    const result = await this.client.from('profiles').select('id,name,email,role,active').eq('auth_id',data.user.id).single();
    const profile = result.data as Staff | null;
    if (result.error || !profile?.active || !['admin','cashier'].includes(profile.role)) {
      await this.client.auth.signOut({scope:'local'}); throw new Error('This account has no active staff access. Contact the Admin.');
    }
    localStorage.setItem(rememberedKey,JSON.stringify({id:profile.id,auth_id:data.user.id,project:this.config.url}));
    return profile;
  }
  async signOut(): Promise<void> {
    const {error} = await this.client.auth.signOut({scope:'local'});
    if (error) throw new Error('Connect to the internet to finish signing out.');
    localStorage.removeItem(rememberedKey);
  }
  registerDevice(name: string, id: string) { return this.rpc<Device>('register_device',{p_device_id:id,p_name:name}); }
  snapshot(deviceId: string) { return this.rpc<Snapshot>('store_snapshot',{p_device_id:deviceId}); }
  submit(event: Mutation) { return this.rpc<EventResult>('apply_event',{p_event:event}); }
  async allocate(deviceId: string, productId: number, quantity: number) { await this.rpc('allocate_stock',{p_device_id:deviceId,p_product_id:productId,p_quantity:quantity}); }
  async releaseAllocation(deviceId: string, productId: number) { await this.rpc('release_allocation',{p_device_id:deviceId,p_product_id:productId}); }
  async claimOrder(deviceId: string, reference: string) { await this.rpc('claim_order',{p_device_id:deviceId,p_reference:reference}); }
  async releaseOrder(deviceId: string, reference: string) { await this.rpc('release_order',{p_device_id:deviceId,p_reference:reference}); }
  async refreshPriceGrants(deviceId: string, expectedSequence: number) { await this.rpc('refresh_price_grants',{p_device_id:deviceId,p_expected_sequence:expectedSequence}); }
  async resolveReview(eventId: string, note: string, replacementEventId: string) { await this.rpc('resolve_review',{p_event_id:eventId,p_note:note,p_replacement_event_id:replacementEventId}); }
  async staffAction(action: 'create' | 'edit' | 'password' | 'active', values: Record<string, unknown>) {
    const {data,error} = await this.client.functions.invoke('staff-admin',{body:{action,...values}});
    if (error || !data?.ok) {
      let message = data?.error;
      const context = error && 'context' in error ? error.context : null;
      if (context instanceof Response) {
        try { const body = await context.clone().json(); if (typeof body.error === 'string' && body.error.length <= 500) message = body.error; } catch { /* Provider failures retain the generic message. */ }
      }
      const failure = new Error(message || 'The cashier account could not be updated. Verify Admin access and internet connection.');
      if (context instanceof Response && (context.status === 401 || message === 'Only active Admins manage Cashier accounts.')) Object.assign(failure,{code:'STAFF_REAUTH_REQUIRED'});
      throw failure;
    }
  }
}
export function createBackend(): Backend | null {
  const config = getCloudConfig(); if (!config.configured) return null;
  return new CloudBackend(createClient(config.url,config.key,{global:{fetch:boundedFetch(globalThis.fetch.bind(globalThis))},auth:{storageKey:storageKey(config.url),persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}}),config);
}
