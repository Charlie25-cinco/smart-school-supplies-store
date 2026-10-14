import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createDatabaseFixture } from './runner.mjs';
import { LegacyImportError, legacyTimestamp, loadLegacyBundle, mapLegacyDataset, runLegacyImport } from '../../cloud-app/scripts/import-legacy.mjs';

const workspace = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const php = process.env.PHP_BIN || (process.platform === 'win32' ? 'C:\\laragon\\bin\\php\\php-8.3.30-Win32-vs16-x64\\php.exe' : 'php');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

export async function runMigrationTests() {
  let assertions=0;
  const check=(condition,message) => {assert.ok(condition,message);assertions++;};
  const directory=join(workspace,'.runtime','cloud-migration-tests',randomUUID());
  await mkdir(directory,{recursive:true});
  const sourcePath=join(directory,'fictional-source.sqlite');
  const holder=spawn(php,[fileURLToPath(new URL('./seed-legacy.php',import.meta.url)),sourcePath],{stdio:['pipe','pipe','pipe'],windowsHide:true});
  let database;
  try {
    await new Promise((yes,no) => {
      let text='';const timeout=setTimeout(()=>no(new Error('Fictional SQLite fixture did not become ready.')),10000);
      holder.once('error',error=>{clearTimeout(timeout);no(error);});
      holder.once('exit',code=>{if(!text.includes('FICTIONAL_FIXTURE_READY')){clearTimeout(timeout);no(new Error('Fictional SQLite fixture could not be created. Exit '+code));}});
      holder.stdout.on('data',chunk=>{text+=chunk.toString();if(text.includes('FICTIONAL_FIXTURE_READY')){clearTimeout(timeout);yes();}});
    });
    const sourceDigest=digest(await readFile(sourcePath));
    const exportDirectory=join(directory,'private-export');
    const exported=spawnSync(php,[fileURLToPath(new URL('../../cloud-app/scripts/export-legacy.php',import.meta.url)),
      '--source='+sourcePath,'--output='+exportDirectory],{encoding:'utf8',windowsHide:true,timeout:20000});
    check(exported.status===0,'online export creates a verified private snapshot: '+exported.stderr);
    check(!exported.stdout.includes('$2')&&!exported.stdout.includes('@example')&&!exported.stdout.includes('Customer'),'export stdout never exposes hashes or record content');
    check(sourceDigest===digest(await readFile(sourcePath)),'export leaves the opened source database file unchanged');
    const path=join(exportDirectory,'legacy.private.json');
    const loaded=await loadLegacyBundle(path);
    check(loaded.source.users.length===3&&loaded.source.orders.length===2,'online backup includes committed WAL staff and financial rows');
    check(!loaded.bundle.data_json.includes('remember_token')&&!loaded.bundle.data_json.includes('session-payload'),'whitelist excludes remember tokens and sessions');
    check(legacyTimestamp('2026-01-03 10:00:00')==='2026-01-03T02:00:00Z','source local timestamps preserve Asia/Manila instants');
    const mapping=new Map(loaded.source.users.map((row,i)=>[row.id,'90000000-0000-4000-8000-'+String(i+1).padStart(12,'0')]));
    const dataset=mapLegacyDataset(loaded.source,mapping);
    check(!JSON.stringify(dataset).includes('$2')&&!JSON.stringify(dataset).includes('password'),'public dataset contains no credential/hash fields');
    check(dataset.profiles[0].id===10&&dataset.profiles[0].role==='admin'&&dataset.profiles[0].email==='Admin@example.invalid','legacy IDs, Owner alias and exact stored email are preserved');
    check(dataset.orders.find(row=>row.id===51).payment_plan==='collection'&&dataset.orders.find(row=>row.id===51).notes==='','cod converts to collection and empty optional fields retain meaning');
    check(dataset.sales.find(row=>row.id===40).paid_by===20&&dataset.sales.find(row=>row.id===40).receipt_number==='SS-000040','Admin-created paid order keeps collecting Cashier and original SS receipt number');
    check(dataset.orders.find(row=>row.id===50).paid_at==='2026-01-03T02:00:00Z','paid_at derives from receipt date rather than later delivery edit date');
    check(dataset.sale_items.find(row=>row.id===70).price_cents===2500&&dataset.products[0].price_cents===3000,'historical receipt retains frozen price instead of current product price');
    for (const change of [raw=>{raw.users[0].created_at=null;},raw=>{raw.orders[0].paid_by=null;},raw=>{raw.products[0].reserved=1;},raw=>{raw.sales[0].total_cents=2999;}]) {
      const invalid=structuredClone(loaded.source);change(invalid);
      assert.throws(()=>mapLegacyDataset(invalid,mapping),LegacyImportError);assertions++;
    }

    ({database}=await createDatabaseFixture());
    const authUsers=[];
    let created=0;let interrupt=true;
    const serverRpc=async (name,parameters) => database.transaction(async tx=>{
      await tx.query("select set_config('request.jwt.claims','{\"role\":\"service_role\"}',true)");
      await tx.exec('set local role service_role');
      const result=name==='status'
        ? await tx.query('select public.legacy_import_status($1,$2) as result',[parameters.id,parameters.digest])
        : await tx.query('select public.import_legacy($1,$2,$3::jsonb) as result',[parameters.p_import_id,parameters.p_source_digest,JSON.stringify(parameters.p_dataset)]);
      return result.rows[0].result;
    });
    const adapter={
      status:(id,digest)=>serverRpc('status',{id,digest}),
      listAuthUsers:async()=>authUsers,
      async createAuthUser(attributes){
        if(interrupt&&created===1)throw new LegacyImportError('Fictional network interruption; resume the same bundle.');
        check(attributes.password_hash.startsWith('$2b$')&&!('password' in attributes),'Auth receives private existing bcrypt hash without plaintext password');
        const user={id:randomUUID(),email:attributes.email,app_metadata:attributes.app_metadata};
        authUsers.push(user);created++;
        await database.query('insert into auth.users(id,email,raw_app_meta_data) values($1,$2,$3::jsonb)',[user.id,user.email,JSON.stringify(user.app_metadata)]);
        return user;
      },
      importData:parameters=>serverRpc('import',parameters),
    };
    await assert.rejects(runLegacyImport(path,adapter),LegacyImportError);assertions++;
    check((await database.query('select count(*)::int as count from public.profiles')).rows[0].count===0&&authUsers.length===1,'partial Auth import creates no active linked profiles or financial records');
    interrupt=false;
    const imported=await runLegacyImport(path,adapter);
    check(imported.status==='complete'&&created===3,'resuming same marker reuses prior Auth user and atomically imports remainder');
    const again=await runLegacyImport(path,adapter);
    check(JSON.stringify(again)===JSON.stringify(imported)&&created===3,'completed migration retry performs no account or financial duplication');
    const rows=await database.query('select id,reference,receipt_number,user_id,paid_by,total_cents from public.sales order by id');
    assert.deepEqual(rows.rows.map(row=>Number(row.id)),[40,41]);assertions++;
    check(Number(rows.rows[0].paid_by)===20&&rows.rows[0].receipt_number==='SS-000040','atomic SQL import preserves receipt identity and collector');
    const stock=await database.query('select stock,reserved,allocated from public.products where id=101');
    check(Number(stock.rows[0].stock)===10&&Number(stock.rows[0].reserved)===2&&Number(stock.rows[0].allocated)===0,'atomic SQL import preserves stock/reservations without allocating real units');
    check((await database.query("select count(*)::int as count from information_schema.columns where table_schema='public' and table_name='profiles' and column_name in ('password','password_hash','remember_token')")).rows[0].count===0,'credential columns do not exist on public profiles');
    const next=await database.query("select nextval(pg_get_serial_sequence('public.profiles','id')) as id");
    check(Number(next.rows[0].id)===31,'preserved explicit IDs advance identity sequence past existing records');
    await assert.rejects(serverRpc('status',{id:randomUUID(),digest:loaded.digest}),/not empty/);assertions++;
    const changed=structuredClone(dataset);changed.profiles[0].auth_id=authUsers.find(row=>row.app_metadata.legacy_staff_id===10).id;
    for(const row of changed.profiles)row.auth_id=authUsers.find(user=>user.app_metadata.legacy_staff_id===row.id).id;
    changed.sale_items[0].name='Fictional attempted snapshot rewrite';
    await assert.rejects(serverRpc('import',{p_import_id:loaded.bundle.import_id,p_source_digest:loaded.digest,p_dataset:changed}),/cannot be changed/);assertions++;

    // A new target catches consistency failure after INSERT and rolls all rows back.
    await database.close();database=null;
    ({database}=await createDatabaseFixture());
    for(const row of dataset.profiles)await database.query('insert into auth.users(id,email,raw_app_meta_data) values($1,$2,$3::jsonb)',[row.auth_id,row.email,JSON.stringify({legacy_import_id:loaded.bundle.import_id,legacy_source_digest:loaded.digest,legacy_staff_id:row.id})]);
    const broken=structuredClone(dataset);broken.products[0].reserved=1;
    await assert.rejects(serverRpc('import',{p_import_id:loaded.bundle.import_id,p_source_digest:loaded.digest,p_dataset:broken}),/whole import was rolled back/);assertions++;
    check((await database.query('select count(*)::int as count from public.products')).rows[0].count===0&&
      (await database.query('select count(*)::int as count from public.profiles')).rows[0].count===0,'late conservation failure leaves no partially usable data');
    const credentialInjection=structuredClone(dataset);credentialInjection.profiles[0].password_hash='fictional forbidden field';
    await assert.rejects(serverRpc('import',{p_import_id:loaded.bundle.import_id,p_source_digest:loaded.digest,p_dataset:credentialInjection}),/Unsupported fields/);assertions++;
    return {assertions};
  } finally {
    if(database)await database.close();
    if(holder.exitCode===null){
      const stopped=new Promise(resolve=>holder.once('exit',resolve));
      holder.stdin.end('\n');
      await stopped;
    }
    const owned=resolve(directory),runtime=resolve(workspace,'.runtime','cloud-migration-tests')+sep;
    if(!owned.startsWith(runtime))throw new Error('Fictional cleanup target escaped its test directory.');
    await rm(owned,{recursive:true,force:true});
  }
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===fileURLToPath(pathToFileURL(process.argv[1]))) {
  const result=await runMigrationTests();
  console.log('PASS: '+result.assertions+' fictional private export/import assertions; no real SQLite or hosted Auth access.');
}
