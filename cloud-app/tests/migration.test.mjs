import test, {before} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {createHash, randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {createDatabaseFixture} from '../../supabase/tests/runner.mjs';
import {loadLegacyBundle, mapLegacyDataset, runLegacyImport} from '../scripts/import-legacy.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const fixture=path.join(root,'.runtime','migration-test-'+randomUUID());
const bundlePath=path.join(fixture,'private-export','legacy.private.json');
let bundle,source;
before(async()=>{
  await mkdir(fixture,{recursive:true});
  const php=process.env.PHP_BINARY||'C:/laragon/bin/php/php-8.3.30-Win32-vs16-x64/php.exe';
  const result=spawnSync(php,[path.join(root,'cloud-app/tests/legacy-fixture.php'),fixture],{encoding:'utf8',windowsHide:true});
  assert.equal(result.status,0,'The fictional SQLite exporter fixture did not complete. '+(result.stderr||''));
  ({bundle,source}=await loadLegacyBundle(bundlePath));
});
const mapping=()=>new Map(source.users.map(row=>[row.id,'10000000-0000-4000-8000-'+String(row.id).padStart(12,'0')]));
const sha=value=>createHash('sha256').update(value).digest('hex');
test('verified private backup and whitelisted conversion preserve money, actor, receipt, reservations and frozen prices',async()=>{
  const dataset=mapLegacyDataset(source,mapping());
  assert.equal(dataset.sales[0].receipt_number,'SS-000007');assert.equal(dataset.sales[0].paid_by,2);assert.equal(dataset.sales[0].user_id,1);
  assert.equal(dataset.sales[0].total_cents,4500);assert.equal(dataset.sales[0].created_at,'2026-10-12T01:30:00Z');
  assert.equal(dataset.orders[1].payment_plan,'collection');assert.equal(dataset.products[0].reserved,2);
  assert.equal(dataset.sale_items[0].price_cents,4000);assert.equal(dataset.products[0].price_cents,4500);
  assert.equal(dataset.profiles[2].active,false);assert.ok(!JSON.stringify(dataset).includes('password'));
  assert.equal(JSON.parse(await readFile(path.join(fixture,'fixture-checks.json'),'utf8')).source_unchanged,true,'Read-only export changed the SQLite source');
});
test('corrupt digest, inconsistent payment totals and missing references fail before provisioning',async()=>{
  const invalid=structuredClone(source);invalid.sales[0].total_cents++;
  assert.throws(()=>mapLegacyDataset(invalid,mapping()));
  const missing=structuredClone(source);missing.sale_items[0].product_id=999;assert.throws(()=>mapLegacyDataset(missing,mapping()));
  const broken=path.join(fixture,'corrupt.private.json');await writeFile(broken,JSON.stringify({...bundle,data_sha256:'0'.repeat(64)}));
  await assert.rejects(loadLegacyBundle(broken));
});
test('private Auth provisioning and atomic PostgreSQL import can resume without duplicating accounts or financial history',async()=>{
  const {database}=await createDatabaseFixture();
  const users=[];let provisioning=0;
  const server=async(name,args)=>database.transaction(async tx=>{
    await tx.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({role:'service_role'})]);await tx.exec('set local role service_role');
    return(await tx.query(name,args)).rows[0].value;
  });
  const adapter={
    status:(id,digest)=>server('select public.legacy_import_status($1::uuid,$2) as value',[id,digest]),
    listAuthUsers:async()=>structuredClone(users),
    async createAuthUser(attributes){
      assert.ok(attributes.password_hash.startsWith('$2b$'));assert.equal(attributes.password,undefined);
      const user={id:randomUUID(),email:attributes.email,app_metadata:attributes.app_metadata};
      await database.query('insert into auth.users(id,email,raw_app_meta_data) values($1::uuid,$2,$3::jsonb)',[user.id,user.email,JSON.stringify(user.app_metadata)]);users.push(user);provisioning++;return user;
    },
    importData:args=>server('select public.import_legacy($1::uuid,$2,$3::jsonb) as value',[args.p_import_id,args.p_source_digest,JSON.stringify(args.p_dataset)])
  };
  try{
    const first=await runLegacyImport(bundlePath,adapter);assert.equal(first.status,'complete');assert.equal(provisioning,3);
    const second=await runLegacyImport(bundlePath,adapter);assert.equal(second.status,'complete');assert.equal(provisioning,3);
    assert.equal((await database.query('select count(*) as count from public.sales')).rows[0].count,1);
    assert.equal((await database.query('select receipt_number,paid_by from public.sales')).rows[0].receipt_number,'SS-000007');
    assert.equal((await database.query("select nextval(pg_get_serial_sequence('public.sales','id')) as id")).rows[0].id,8);
    await assert.rejects(server('select public.import_legacy($1::uuid,$2,$3::jsonb) as value',[randomUUID(),'0'.repeat(64),JSON.stringify(mapLegacyDataset(source,mapping()))]));
  }finally{await database.close();}
});
test('partial Auth provisioning has no usable profiles and resumes from the same private import markers',async()=>{
  const users=[];let failed=true,imported=false;
  const adapter={status:async()=>({status:'empty'}),listAuthUsers:async()=>structuredClone(users),
    createAuthUser:async attributes=>{if(failed&&users.length===1){failed=false;throw new Error('Fictional provisioning interruption');}const user={id:randomUUID(),email:attributes.email,app_metadata:attributes.app_metadata};users.push(user);return user;},
    importData:async args=>{imported=true;return{status:'complete',counts:Object.fromEntries(Object.entries(args.p_dataset).map(([name,rows])=>[name,rows.length]))};}
  };
  await assert.rejects(runLegacyImport(bundlePath,adapter));assert.equal(imported,false);assert.equal(users.length,1);
  await runLegacyImport(bundlePath,adapter);assert.equal(users.length,3);assert.equal(imported,true);
});
test('a failing atomic financial import leaves no profiles, stock or sales usable',async()=>{
  const {database}=await createDatabaseFixture();
  try{
    const importId=randomUUID(),digest='0'.repeat(64),ids=mapping();for(const row of source.users)await database.query('insert into auth.users(id,email,raw_app_meta_data) values($1::uuid,$2,$3::jsonb)',[ids.get(row.id),row.email,JSON.stringify({legacy_import_id:importId,legacy_staff_id:row.id,legacy_source_digest:digest})]);
    const dataset=mapLegacyDataset(source,ids);dataset.products[0].reserved=3;
    await assert.rejects(database.transaction(async tx=>{await tx.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({role:'service_role'})]);await tx.exec('set local role service_role');await tx.query('select public.import_legacy($1::uuid,$2,$3::jsonb)',[importId,digest,JSON.stringify(dataset)]);}),/reservations/);
    for(const name of ['profiles','products','sales','orders'])assert.equal((await database.query(`select count(*) as count from public.${name}`)).rows[0].count,0);
  }finally{await database.close();}
});
