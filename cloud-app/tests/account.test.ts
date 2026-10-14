import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAccountRequest } from '../../supabase/functions/staff-admin/validation.ts';
import { boundedFetch, validateConfig } from '../src/backend';
test('account input never accepts promotion, deletion, unconfirmed or weak passwords', () => {
  const valid={action:'create',name:'Fixture Cashier',email:'fixture@example.invalid',password:'Example-123456',password_confirmation:'Example-123456'};
  assert.equal(validateAccountRequest(valid).action,'create');
  for(const changed of [{role:'admin'},{active:false},{password:'short'},{password_confirmation:'different'},{email:'invalid'}])assert.throws(()=>validateAccountRequest({...valid,...changed}));
  assert.throws(()=>validateAccountRequest({action:'delete',staff_id:1}));
  assert.throws(()=>validateAccountRequest({...valid,action:'constructor'}));
  assert.throws(()=>validateAccountRequest({...valid,password:'😀'.repeat(20),password_confirmation:'😀'.repeat(20)}));
  assert.throws(()=>validateAccountRequest({...valid,password:'😀'.repeat(6),password_confirmation:'😀'.repeat(6)}));
  assert.throws(()=>validateAccountRequest({action:'active',staff_id:1,active:'false'}));
  assert.throws(()=>validateAccountRequest({action:'edit',staff_id:-1,name:'Test',email:'fixture@example.invalid'}));
  assert.deepEqual(validateAccountRequest({action:'active',staff_id:2,active:false}),{action:'active',staff_id:2,active:false});
});
test('public configuration rejects secret keys, credentials and unrelated endpoints', () => {
  assert.equal(validateConfig().configured,false);
  assert.equal(validateConfig('https://fixture.supabase.co','sb_publishable_fixture').configured,true);
  for(const url of ['http://fixture.supabase.co','https://example.com','https://name:password@fixture.supabase.co','https://fixture.supabase.co/private'])assert.equal(validateConfig(url,'sb_publishable_fixture').configured,false);
  for(const key of ['sb_secret_fixture','',`a.${btoa(JSON.stringify({role:'service_role'}))}.b`])assert.equal(validateConfig('https://fixture.supabase.co',key).configured,false);
});
test('cloud requests stop waiting when Wi-Fi stays connected without internet', async () => {
  let aborted = false;
  const waiting: typeof fetch = async (_input, init) => new Promise((_resolve, reject) => { init!.signal!.addEventListener('abort', () => { aborted = true; reject(init!.signal!.reason); }, {once:true}); });
  await assert.rejects(boundedFetch(waiting, 20)('https://fixture.supabase.co/rest/v1/rpc/store_snapshot'), {name:'TimeoutError'});
  assert.equal(aborted, true);
});
