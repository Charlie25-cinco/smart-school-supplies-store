import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {existsSync} from 'node:fs';
import {mkdir, readFile, stat, writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createDatabaseFixture} from '../supabase/tests/runner.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const cloud = path.join(root, 'cloud-app');
const cloudRequire = createRequire(path.join(cloud, 'package.json'));
const staffRequire = createRequire(path.join(root, 'store-app/package.json'));
const {chromium} = staffRequire('playwright');
const {default: AxeBuilder} = staffRequire('@axe-core/playwright');
const artifacts = path.join(root, 'artifacts');
const runtime = path.join(root, '.runtime', 'cloud-ui-' + randomUUID());
const site = path.join(runtime, 'site');
const fixtureOrigin = 'https://fixture.supabase.co';
const databaseName = 'smart-school-supplies-offline-v1-fixture.supabase.co';
const anonKey = Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url') + '.' + Buffer.from(JSON.stringify({role:'anon',iss:'supabase'})).toString('base64url') + '.fictional-public-test-key';
const password = 'Test-' + randomUUID();
const staff = new Map();
for (const [id, role, email, name] of [[1,'admin','admin@example.test','Demo Admin'],[10,'cashier','cashier@example.test','Demo Cashier'],[11,'cashier','other@example.test','Other Demo Cashier']]) staff.set(email,{id,role,email,name,authId:randomUUID(),password});
const checks = [], javascriptErrors = [], policyErrors = [], forbiddenRequests = [];
const observedEvents = [];
let browser, server, database, origin, installContext;
let requestsTail = Promise.resolve();
const serialize = action => { const operation = requestsTail.then(action); requestsTail = operation.then(()=>undefined,()=>undefined); return operation; };
const resultFile = path.join(artifacts,'cloud-ui-results.json');
const limitations = ['Supabase Auth and Edge HTTP are isolated doubles; RPC rules run actual migrations in a fresh in-memory PostgreSQL engine.','No live cloud project, real records, credentials, hosting changes, Meta requests or OS clipboard writes.','Selected automated accessibility rules and browser viewports do not certify WCAG compliance or physical-device behavior.','Installation uses the actual manifest/service-worker cache; native OS installation prompts are not automated.'];
const report = (status,error) => ({status,checks,counts:{checks:checks.length,accessibilityStates:checks.filter(check=>check.includes('axe')).length},javascriptErrors,policyErrors,forbiddenRequests,limitations,...(error?{error:error.message||String(error)}:{})});
async function runNode(args, cwd=cloud) {
  await new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,args,{cwd,windowsHide:true,env:{...process.env,VITE_SUPABASE_URL:fixtureOrigin,VITE_SUPABASE_PUBLISHABLE_KEY:anonKey},stdio:['ignore','pipe','pipe']});
    let output=''; child.stdout.on('data',data=>{output+=data;});child.stderr.on('data',data=>{output+=data;});
    child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error('Isolated cloud build failed: '+output.slice(-2500))));
  });
}
async function asActor(actor, action) {
  return serialize(()=>database.transaction(async tx=>{
    await tx.exec('set local role '+(actor?'authenticated':'anon'));
    await tx.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)",[actor?.authId||'',JSON.stringify(actor?{sub:actor.authId,role:'authenticated',session_id:actor.sessionId,iat:actor.issuedAt}:{role:'anon'})]);
    return action(tx);
  }));
}
const rpcQueries={
  register_device:{sql:'select public.register_device($1::uuid,$2::text) as value',args:['p_device_id','p_name']},
  store_snapshot:{sql:'select public.store_snapshot($1::uuid) as value',args:['p_device_id']},
  apply_event:{sql:'select public.apply_event($1::jsonb) as value',args:['p_event'],json:true},
  allocate_stock:{sql:'select public.allocate_stock($1::uuid,$2::bigint,$3::bigint) as value',args:['p_device_id','p_product_id','p_quantity']},
  release_allocation:{sql:'select public.release_allocation($1::uuid,$2::bigint) as value',args:['p_device_id','p_product_id']},
  claim_order:{sql:'select public.claim_order($1::uuid,$2::uuid) as value',args:['p_device_id','p_reference']},
  release_order:{sql:'select public.release_order($1::uuid,$2::uuid) as value',args:['p_device_id','p_reference']},
  refresh_price_grants:{sql:'select public.refresh_price_grants($1::uuid,$2::bigint) as value',args:['p_device_id','p_expected_sequence']},
  resolve_review:{sql:'select public.resolve_review($1::uuid,$2::text,$3::uuid) as value',args:['p_event_id','p_note','p_replacement_event_id']},
  public_catalog:{sql:'select public.public_catalog() as value',args:[]},
};
function decodeActor(request) {
  try {
    const token=(request.headers().authorization||'').replace(/^Bearer /i,'');
    const claims=JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString());
    const actor=[...staff.values()].find(person=>person.authId===claims.sub);
    return actor?{...actor,sessionId:claims.session_id,issuedAt:claims.iat}:null;
  } catch { return null; }
}
async function mockContext(context) {
  let disconnected=false;
  let interruptLogout=false;
  await context.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());
    if(url.origin===origin || !['http:','https:'].includes(url.protocol)) return route.fallback();
    if(url.origin!==fixtureOrigin) {forbiddenRequests.push(url.origin+url.pathname);return route.abort('blockedbyclient');}
    if(disconnected) return route.abort('internetdisconnected');
    const headers={'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info,x-supabase-api-version','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Content-Type':'application/json'};
    if(request.method()==='OPTIONS') return route.fulfill({status:204,headers});
    try {
      const body=request.postDataJSON()||{},actor=decodeActor(request);
      if(url.pathname==='/auth/v1/token') {
        const person=staff.get(body.email);
        if(!person||person.password!==body.password) return route.fulfill({status:400,headers,body:JSON.stringify({error:'invalid_grant',error_description:'Invalid fictional login'})});
        const sessionId=randomUUID(),issuedAt=Math.floor(Date.now()/1000);
        await serialize(()=>database.query('insert into auth.sessions(id,user_id) values($1::uuid,$2::uuid)',[sessionId,person.authId]));
        const claims={sub:person.authId,role:'authenticated',session_id:sessionId,iat:issuedAt,exp:issuedAt+3600,aud:'authenticated'};
        const token=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')+'.'+Buffer.from(JSON.stringify(claims)).toString('base64url')+'.fixture-auth';
        return route.fulfill({headers,body:JSON.stringify({access_token:token,token_type:'bearer',expires_in:3600,expires_at:issuedAt+3600,refresh_token:randomUUID(),user:{id:person.authId,email:person.email,aud:'authenticated',role:'authenticated',app_metadata:{provider:'email'},user_metadata:{},created_at:new Date().toISOString()}})});
      }
      if(url.pathname==='/auth/v1/logout') {
        assert.equal(url.searchParams.get('scope'),'local','Ordinary logout must preserve other prepared device sessions');
        if(actor) await serialize(()=>database.query('delete from auth.sessions where id=$1::uuid',[actor.sessionId]));
        if(interruptLogout) {interruptLogout=false;return route.abort('connectionreset');}
        return route.fulfill({status:204,headers});
      }
      if(url.pathname==='/rest/v1/profiles') {
        if(!actor) throw new Error('Fictional authenticated account is required.');
        const result=await asActor(actor,tx=>tx.query('select id,name,email,role,active from public.profiles where auth_id=$1::uuid',[actor.authId]));
        return route.fulfill({headers,body:JSON.stringify(result.rows[0]||null)});
      }
      if(url.pathname.startsWith('/rest/v1/rpc/')) {
        const name=url.pathname.slice('/rest/v1/rpc/'.length),definition=rpcQueries[name];
        assert.ok(definition,'Unapproved fixture RPC '+name);
        if(name==='apply_event') observedEvents.push(structuredClone(body.p_event));
        const result=await asActor(actor,tx=>tx.query(definition.sql,definition.args.map(key=>definition.json?JSON.stringify(body[key]):body[key])));
        return route.fulfill({headers,body:JSON.stringify(result.rows[0]?.value??null)});
      }
      if(url.pathname==='/functions/v1/staff-admin') {
        const profile=await asActor(actor,tx=>tx.query('select id,role,active from public.profiles where auth_id=$1::uuid',[actor?.authId]));
        assert.equal(profile.rows[0]?.role,'admin');assert.equal(profile.rows[0]?.active,true);
        if(body.action==='create') {
          assert.ok(body.password.length>=12&&body.password===body.password_confirmation);
          const authId=randomUUID();
          const created=await serialize(()=>database.transaction(async tx=>{
            await tx.query('insert into auth.users(id,email) values($1::uuid,$2)',[authId,body.email]);
            return tx.query("insert into public.profiles(auth_id,name,email,role) values($1::uuid,$2,$3,'cashier') returning id",[authId,body.name,body.email]);
          }));
          staff.set(body.email,{id:created.rows[0].id,role:'cashier',email:body.email,name:body.name,authId,password:body.password});
        } else {
          const person=[...staff.values()].find(value=>value.id===body.staff_id);assert.ok(person);
          if(body.action==='edit') {
            await serialize(()=>database.query('update public.profiles set name=$2,email=$3 where id=$1',[person.id,body.name,body.email]));
            staff.delete(person.email);person.email=body.email;person.name=body.name;staff.set(person.email,person);
          } else if(body.action==='password'||body.action==='active') {
            if(body.action==='password') {assert.ok(body.password.length>=12&&body.password===body.password_confirmation);person.password=body.password;}
            if(body.action==='active'&&!body.active) await serialize(()=>database.query('update public.profiles set active=false where id=$1',[person.id]));
            await serialize(()=>database.transaction(async tx=>{
              await tx.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({role:'service_role'})]);
              await tx.exec('set local role service_role');
              await tx.query('select public.revoke_staff_sessions($1::bigint)',[person.id]);
            }));
            if(body.action==='active'&&body.active) await serialize(()=>database.query('update public.profiles set active=true where id=$1',[person.id]));
          } else throw new Error('Unapproved account action.');
        }
        return route.fulfill({headers,body:JSON.stringify({ok:true})});
      }
      throw new Error('Unapproved fake API path.');
    } catch(error) {
      return route.fulfill({status:error.code==='42501'?403:400,headers,body:JSON.stringify({code:error.code||'FIXTURE_FAILURE',message:error.message})});
    }
  });
  return {offline:async value=>{disconnected=value;await context.setOffline(value);},interruptNextLogout:()=>{interruptLogout=true;}};
}
function listen(page) {
  page.on('pageerror',error=>javascriptErrors.push(error.message));
  page.on('console',message=>{if(message.type()==='error'&&/content[- ]security[- ]policy|refused to.*(?:load|execute|apply|connect)|violat(?:es?|ion).*directive/i.test(message.text()))policyErrors.push(message.text());});
}
async function localQueue(page) {
  return page.evaluate(databaseName=>new Promise((resolve,reject)=>{
    const opening=indexedDB.open(databaseName);
    opening.onerror=()=>reject(new Error('Offline store unavailable'));
    opening.onsuccess=()=>{
      const db=opening.result;
      const active=db.transaction('settings').objectStore('settings').get('active');
      active.onsuccess=()=>{
        if(!active.result){db.close();resolve({pending:0,reviews:0,events:[],snapshot:null});return;}
        const request=db.transaction('workspaces').objectStore('workspaces').get(active.result);
        request.onsuccess=()=>{const value=request.result;db.close();resolve({pending:value.events.filter(item=>item.event.status==='pending'&&!item.acknowledged&&!item.resolvedBy).length,reviews:value.snapshot.reviews.length,events:value.events.filter(item=>!item.resolvedBy).map(item=>({id:item.event.id,sequence:item.event.sequence,kind:item.event.kind,status:item.event.status,acknowledged:!!item.acknowledged,captured_at:item.event.captured_at})),snapshot:{role:value.snapshot.staff.role,staffId:value.snapshot.staff.id,deviceId:value.snapshot.device.id,email:value.snapshot.staff.email,sales:value.snapshot.sales.length,orders:value.snapshot.orders.length,products:value.snapshot.products.map(item=>({id:item.id,name:item.name,stock:item.stock,reserved:item.reserved,allocated:item.allocated})),nextSequence:value.nextSequence},authorized:value.authorized,signingOut:!!value.signingOut});};
      };
    };
  }),databaseName);
}
async function waitQueue(page,pending,reviews) {
  await page.waitForFunction(({pending,reviews,databaseName})=>new Promise(resolve=>{
    const open=indexedDB.open(databaseName);
    open.onsuccess=()=>{const db=open.result;const active=db.transaction('settings').objectStore('settings').get('active');active.onsuccess=()=>{if(!active.result){db.close();resolve(false);return;}const record=db.transaction('workspaces').objectStore('workspaces').get(active.result);record.onsuccess=()=>{const value=record.result;db.close();resolve(value.events.filter(item=>item.event.status==='pending'&&!item.acknowledged&&!item.resolvedBy).length===pending&&(reviews===undefined||value.snapshot.reviews.length===reviews));};};};
  }),{pending,reviews,databaseName});
}
async function login(page,email,name) {
  await page.goto(origin+'/staff/');
  await page.locator('#signin-email').fill(email);await page.locator('#signin-password').fill(staff.get(email).password);await page.locator('#device-name').fill(name);
  await page.locator('#signin-form [type=submit]').click();await page.locator('.workspace').waitFor();
  await page.evaluate(async()=>{await navigator.serviceWorker.ready;if(!navigator.serviceWorker.controller)await new Promise(resolve=>navigator.serviceWorker.addEventListener('controllerchange',resolve,{once:true}));});
}
async function gotoRoute(page,route) {await page.goto(origin+'/staff/#'+route);await page.locator('h1').waitFor();}
async function axe(page,label) {
  const result=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze();
  assert.deepEqual(result.violations.map(item=>({id:item.id,targets:item.nodes.map(node=>node.target)})),[],label+' accessibility violations');checks.push(label+': axe PASS');
}
async function responsive(page,label) {
  for(const width of [375,390,768,1024,1440]) {
    await page.setViewportSize({width,height:900});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,label+' horizontal overflow at '+width);
    const menu=page.locator('[data-action=menu]');
    if(await menu.isVisible()) {
      await menu.focus();await page.keyboard.press('Enter');await page.locator('#store-menu[open]').waitFor();
      const last=page.locator('#store-menu .nav-link').last();await last.focus();
      const bounds=await last.boundingBox();assert.ok(bounds&&bounds.y>=0&&bounds.y+bounds.height<=901&&bounds.height>=44,label+' last compact link is clipped');
      assert.equal(await page.locator('#store-menu .signout').isVisible(),true);
      await page.keyboard.press('Escape');assert.equal(await menu.evaluate(element=>element===document.activeElement),true,label+' menu did not restore focus');
    }
    const controls=await page.locator('input:not([type=hidden]):not([type=checkbox]),select,button.button,button.icon-button,.nav-link').evaluateAll(elements=>elements.filter(element=>element.getClientRects().length).map(element=>({name:element.id||element.textContent,height:element.getBoundingClientRect().height,font:parseFloat(getComputedStyle(element).fontSize),input:element.matches('input,select')})));
    assert.deepEqual(controls.filter(control=>control.height<44-1),[],label+' undersized touch controls');
    assert.deepEqual(controls.filter(control=>control.name&&control.font<(control.input?16:14)),[],label+' unreadable controls');
    await page.screenshot({path:path.join(artifacts,'cloud-ui-'+label+'-'+width+'.png'),fullPage:true,animations:'disabled'});
  }
  await page.setViewportSize({width:1440,height:900});checks.push(label+': phone/tablet/desktop 375/390/768/1024/1440 no overflow, reachable menu/focus and44px controls PASS');
}
async function sync(page) {
  const response=page.waitForResponse(response=>response.url()===fixtureOrigin+'/rest/v1/rpc/store_snapshot'&&response.status()===200);
  await page.locator('[data-action=sync]').first().click();await response;await waitQueue(page,0);await page.waitForFunction(()=>!document.querySelector('[data-action=sync]').disabled);
}
async function posPane(page,pane) {const tab=page.locator(pane==='sale'?'#sale-tab':'#products-tab');if(await tab.isVisible())await tab.click();}

try {
  await mkdir(artifacts,{recursive:true});await mkdir(path.join(site,'staff'),{recursive:true});
  await runNode([path.join(cloud,'node_modules/vite/bin/vite.js'),'build','--outDir',path.join(site,'staff')]);
  await runNode([path.join(cloud,'scripts/package.mjs'),'--output',site]);
  ({database}=await createDatabaseFixture());
  for(const person of staff.values()) {
    await database.query('insert into auth.users(id,email) values($1::uuid,$2)',[person.authId,person.email]);
    await database.query('insert into public.profiles(id,auth_id,name,email,role) values($1,$2::uuid,$3,$4,$5)',[person.id,person.authId,person.name,person.email,person.role]);
  }
  await database.exec("select setval(pg_get_serial_sequence('public.profiles','id'),11)");
  for(const [id,name,price] of [[1,'Demo Notebook',4500],[2,'Demo Ballpen',1200],[3,'Demo Folder',1500],[4,'Demo School Bag',35000],[5,'Demo Pencil',1000],[6,'Demo Index Cards',2500],[7,'Demo Long Product Name For A Wrapped Retail Card',5500]])await database.query("insert into public.products(id,sku,name,category,kind,price_cents,stock) values($1,$2,$3,'School Essentials','product',$4,50)",[id,'DEMO-'+id,name,price]);
  await database.exec("insert into public.products(id,sku,name,category,kind,price_cents,stock) values(8,'DEMO-PRINT','Demo Printing','Academic Services','service',300,0),(9,'DEMO-SUPPLY','Demo Internal Paper','Supplies','consumable',0,50);select setval(pg_get_serial_sequence('public.products','id'),9)");
  const rules=[];
  for(const line of (await readFile(path.join(site,'_headers'),'utf8')).split(/\r?\n/)) {
    if(!line.trim())continue;
    if(!/^\s/.test(line))rules.push({path:line.trim(),headers:{}});
    else {const match=/^\s+([^:]+):\s*(.+)$/.exec(line);if(match)rules.at(-1).headers[match[1]]=match[2];}
  }
  const types={'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2','.webmanifest':'application/manifest+json'};
  server=createServer(async(request,response)=>{
    try {
      const pathname=decodeURIComponent(new URL(request.url,'http://127.0.0.1').pathname),relative=pathname.endsWith('/')?pathname+'index.html':pathname;
      const filename=path.resolve(site,'.'+relative);
      if(!filename.startsWith(site+path.sep)||!['GET','HEAD'].includes(request.method)) {response.writeHead(404);response.end();return;}
      const info=await stat(filename);if(!info.isFile())throw new Error('Missing file');
      const headers=Object.assign({},...rules.filter(rule=>rule.path==='/*'||rule.path===pathname).map(rule=>rule.headers));
      response.writeHead(200,{...headers,'Content-Type':types[path.extname(filename)]||'application/octet-stream'});
      response.end(request.method==='HEAD'?'':await readFile(filename));
    } catch {response.writeHead(404);response.end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;
  const executablePath=process.env.BROWSER_EXECUTABLE||['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
  assert.ok(executablePath,'Installed Edge/Chrome is required.');
  browser=await chromium.launch({executablePath,headless:true});
  const cashierContext=await browser.newContext({viewport:{width:1440,height:900}}),adminContext=await browser.newContext({viewport:{width:1440,height:900}});
  const cashierNetwork=await mockContext(cashierContext),adminNetwork=await mockContext(adminContext);
  const cashier=await cashierContext.newPage(),admin=await adminContext.newPage();listen(cashier);listen(admin);
  await cashier.goto(origin+'/staff/');await axe(cashier,'signin');await responsive(cashier,'signin');
  await cashierNetwork.offline(true);assert.equal(await cashier.locator('#signin-form [type=submit]').isDisabled(),true);await cashierNetwork.offline(false);
  checks.push('first offline sign-in disabled and previously prepared device required PASS');
  await login(cashier,'cashier@example.test','Browser cashier tablet');
  const manifestSession=await cashierContext.newCDPSession(cashier);
  const manifestInfo=await manifestSession.send('Page.getAppManifest');
  assert.equal(manifestInfo.errors.length,0,'Staff web manifest must parse without errors');
  const manifest=JSON.parse(manifestInfo.data);assert.equal(manifest.start_url,'/staff/');assert.equal(manifest.scope,'/staff/');
  const installability=await manifestSession.send('Page.getInstallabilityErrors');
  assert.deepEqual(installability.installabilityErrors.filter(error=>error.errorId!=='in-incognito'),[],'Staff PWA has an application installation error');
  await manifestSession.detach();
  installContext=await chromium.launchPersistentContext(path.join(runtime,'install-profile'),{executablePath,headless:true,viewport:{width:1440,height:900}});
  await mockContext(installContext);const installPage=await installContext.newPage();listen(installPage);await installPage.goto(origin+'/staff/');
  await installPage.evaluate(async()=>{await navigator.serviceWorker.ready;});
  const installSession=await installContext.newCDPSession(installPage);
  const normalInstall=await installSession.send('Page.getInstallabilityErrors');
  assert.deepEqual(normalInstall.installabilityErrors,[],'Normal isolated browser must satisfy staff PWA installation criteria');
  await installSession.detach();await installContext.close();installContext=undefined;
  checks.push('staff manifest, service-worker scope and normal-browser installation criteria PASS');
  const cashierDevice=(await database.query('select id from public.devices where staff_id=10')).rows[0].id;
  assert.equal(await cashier.locator('.pos-card[data-id="1"]').isDisabled(),true,'Cashier can sell unallocated physical stock');
  await login(admin,'admin@example.test','Browser admin laptop');
  assert.equal(await admin.locator('a[data-route=pos]').count(),0);assert.equal(await cashier.locator('a[data-route=inventory]').count(),0);
  await gotoRoute(admin,'pos');assert.match(await admin.locator('h1').textContent(),/store today/);
  await gotoRoute(cashier,'inventory');assert.match(await cashier.locator('h1').textContent(),/Point of sale/);
  checks.push('separate Admin/Cashier navigation, route guard and zero unallocated stock sales PASS');
  await gotoRoute(admin,'allocations');await axe(admin,'allocations');await responsive(admin,'allocations');
  await admin.locator('#allocation-device').selectOption(cashierDevice);await admin.locator('#allocation-product').selectOption('1');await admin.locator('#allocation-quantity').fill('8');await admin.locator('#allocation-form [type=submit]').click();
  await admin.getByText('Stock allocated to the selected cashier device.',{exact:true}).waitFor();
  await asActor({...staff.get('admin@example.test'),sessionId:(await database.query('select id from auth.sessions where user_id=$1::uuid',[staff.get('admin@example.test').authId])).rows[0].id,issuedAt:Math.floor(Date.now()/1000)},tx=>tx.query('select public.allocate_stock($1::uuid,2,8)',[cashierDevice]));
  await sync(cashier);await gotoRoute(cashier,'pos');assert.equal(await cashier.locator('.pos-card[data-id="1"]').isDisabled(),false);
  await axe(cashier,'pos');await responsive(cashier,'pos');
  await cashier.setViewportSize({width:1366,height:768});
  const fitted=await cashier.locator('#pos-products').evaluate(region=>{
    const box=region.getBoundingClientRect();return [...region.querySelectorAll('.pos-card')].slice(0,6).map(card=>{const bounds=card.getBoundingClientRect();return {visible:bounds.top>=box.top-1&&bounds.bottom<=box.bottom+1,nameSize:parseFloat(getComputedStyle(card.querySelector('strong')).fontSize),priceSize:parseFloat(getComputedStyle(card.querySelector('.pos-price')).fontSize)};});
  });
  await cashier.screenshot({path:path.join(artifacts,'cloud-ui-pos-1366.png'),fullPage:true});
  assert.equal(fitted.length,6);assert.ok(fitted.every(card=>card.visible&&card.nameSize>=18&&card.priceSize>=24),'Normal laptop product rows are clipped or unreadable: '+JSON.stringify(fitted));
  const checkout=await cashier.locator('#complete-sale').boundingBox();assert.ok(checkout&&checkout.y+checkout.height<=769,'Normal laptop checkout action clipped');
  checks.push('POS normal laptop: two full product rows,18px names/24px prices and reachable payment/action PASS');
  await cashierNetwork.offline(true);await cashier.setViewportSize({width:375,height:900});await posPane(cashier,'products');
  await cashier.locator('.pos-card[data-id="1"]').click();await cashier.locator('.pos-card[data-id="1"]').click();await cashier.locator('.pos-card[data-id="2"]').click();
  await cashier.locator('#products-tab').focus();await cashier.keyboard.press('End');assert.equal(await cashier.locator('#sale-tab').getAttribute('aria-selected'),'true');
  await cashier.locator('#pos-payment-method').selectOption('gcash');await cashier.locator('#pos-amount').fill('102.00');await cashier.locator('#pos-reference').fill('UI-GCASH-001');await cashier.locator('[name=payment_verified]').check();
  await cashier.locator('#pos-fulfillment').selectOption('delivery');await cashier.locator('#pos-channel').selectOption('messenger');
  await cashier.locator('[data-action=customer-details]').click();await cashier.locator('#customer-name').fill('Demo Customer');await cashier.locator('#customer-phone').fill('09000000000');await cashier.locator('#delivery-address').fill('Fictional delivery address');await cashier.locator('#delivery-fee').fill('10.00');await cashier.locator('#customer-notes').fill('Fictional browser inquiry');
  await axe(cashier,'customer-dialog');await cashier.locator('#customer-form [type=submit]').click();
  await cashier.locator('#pos-amount').fill('112.00');await cashier.locator('#sale-tab').focus();await cashier.keyboard.press('Home');await cashier.keyboard.press('End');
  assert.equal(await cashier.locator('#pos-reference').inputValue(),'UI-GCASH-001');assert.equal(await cashier.locator('[name=payment_verified]').isChecked(),true);assert.equal(await cashier.locator('#cart-total').textContent(),'₱112.00');
  await cashier.locator('[data-action=customer-details]').click();assert.equal(await cashier.locator('#customer-name').inputValue(),'Demo Customer');await cashier.keyboard.press('Escape');
  assert.equal(await cashier.locator('[data-action=customer-details]').evaluate(element=>element===document.activeElement),true,'Customer dialog lost its opener focus');
  await cashier.locator('#pos-payment-plan').selectOption('collection');await cashier.locator('#complete-sale').click();await cashier.waitForURL(/#order\//);await waitQueue(cashier,1);
  const orderReference=cashier.url().split('#order/')[1];assert.equal(observedEvents.length,0,'Offline order contacted the backend');
  assert.equal(await cashier.locator('.sidebar .signout').isDisabled(),true);
  await axe(cashier,'offline-order');await responsive(cashier,'offline-order');
  await cashier.locator('[data-action=edit-order]').first().click();await cashier.locator('#edit-customer-name').fill('Corrected Demo Customer');await cashier.locator('#edit-quantity-1').fill('1');await cashier.locator('#edit-quantity-1').dispatchEvent('change');await cashier.locator('#order-edit-form [type=submit]').click();await waitQueue(cashier,2);
  await cashier.locator('[data-action=order-payment]').click();await cashier.locator('#collected-payment-method').selectOption('gcash');await cashier.locator('#collected-amount').fill('67.00');await cashier.locator('#collected-reference').fill('UI-COD-GCASH-001');await cashier.locator('#order-payment-form [name=payment_verified]').check();await cashier.locator('#order-payment-form [type=submit]').click();await waitQueue(cashier,3);
  for(const status of ['ready','out_for_delivery','completed']) {await cashier.locator('[data-action=order-status][data-status="'+status+'"]').click();}
  await waitQueue(cashier,6);
  const beforeReload=await localQueue(cashier);assert.equal(beforeReload.snapshot.orders,1);assert.equal(beforeReload.snapshot.sales,1);assert.equal(beforeReload.snapshot.products.find(product=>product.id===1).reserved,0);
  await cashier.reload();await cashier.locator('.workspace').waitFor();const reloaded=await localQueue(cashier);assert.deepEqual(reloaded.events,beforeReload.events);assert.equal(reloaded.snapshot.nextSequence,7);
  await gotoRoute(cashier,'pos');await cashier.locator('.pos-card[data-id="1"]').click();await cashier.locator('#pos-amount').fill('100.00');await cashier.locator('#complete-sale').click();await cashier.waitForURL(/#receipt\//);await waitQueue(cashier,7);
  assert.deepEqual((await localQueue(cashier)).events.map(event=>event.sequence),[1,2,3,4,5,6,7]);await axe(cashier,'offline-receipt');await responsive(cashier,'offline-receipt');
  const cacheUrls=await cashier.evaluate(async()=>{const result=[];for(const name of await caches.keys())for(const request of await(await caches.open(name)).keys())result.push(request.url);return result;});
  assert.ok(cacheUrls.length>0);assert.ok(cacheUrls.every(url=>new URL(url).origin===origin),'Static cache contains an external response');
  assert.ok(cacheUrls.every(url=>!url.includes('/rest/v1/')&&!url.includes('/auth/v1/')&&!url.includes('/functions/v1/')),'Private API data entered the static cache');
  checks.push('Cashier offline: pane/details/GCash recovery, COD edit/reservation/payment/status, receipt, reload identities and strictly increasing durable sequence PASS');
  await cashierNetwork.offline(false);await sync(cashier);
  const durable=await database.query('select (select count(*) from public.sales) as sales,(select count(*) from public.sync_events where status=$1) as synced',['synced']);
  assert.equal(Number(durable.rows[0].sales),2);assert.equal(Number(durable.rows[0].synced),7);
  assert.deepEqual((await database.query('select stock,reserved from public.products where id=1')).rows[0],{stock:48,reserved:0});
  checks.push('Reconnect confirms seven ordered events once in actual PostgreSQL and no duplicate sales/stock deductions PASS');

  await sync(admin);await gotoRoute(admin,'inventory');await axe(admin,'inventory');await responsive(admin,'inventory');
  await admin.locator('[data-action=stock-movement][data-id="1"]').click();
  assert.equal(await admin.locator('#movement-direction option[value=use]').count(),0,'Sellable products must not offer supply usage');
  await admin.keyboard.press('Escape');
  await admin.locator('[data-action=stock-movement][data-id="9"]').click();
  assert.equal(await admin.locator('#movement-direction option[value=use]').count(),1,'Internal consumables must retain supply usage');
  await admin.keyboard.press('Escape');checks.push('stock movement dialog offers outgoing usage only for internal consumables PASS');
  await adminNetwork.offline(true);await admin.locator('[data-action=new-product]').click();await admin.locator('#item-name').fill('New Browser Item');await admin.locator('#item-sku').fill('BROWSER-NEW');await admin.locator('#item-category').fill('School Essentials');await admin.locator('#item-price').fill('80.00');await admin.locator('#item-reorder').fill('2');await admin.locator('#inventory-form [type=submit]').click();await waitQueue(admin,1);
  let newRow=admin.locator('tr').filter({hasText:'BROWSER-NEW'});await newRow.locator('[data-action=stock-movement]').click();await admin.locator('#movement-quantity').fill('5');await admin.locator('#movement-reason').fill('Fictional browser opening stock');await admin.locator('#movement-form [type=submit]').click();await waitQueue(admin,2);
  newRow=admin.locator('tr').filter({hasText:'BROWSER-NEW'});await newRow.locator('[data-action=edit-product]').click();await admin.locator('#item-name').fill('Edited Browser Item');await admin.locator('#inventory-form [type=submit]').click();await waitQueue(admin,3);
  await admin.reload();await admin.locator('.workspace').waitFor();await gotoRoute(admin,'inventory');assert.match(await admin.locator('tr').filter({hasText:'BROWSER-NEW'}).textContent(),/Edited Browser Item/);
  await gotoRoute(admin,'accounts');assert.equal(await admin.locator('[data-action=new-cashier]').isDisabled(),true);
  await adminNetwork.offline(false);await sync(admin);
  const newProduct=(await database.query("select id,stock,name from public.products where sku='BROWSER-NEW'")).rows[0];assert.ok(newProduct.id>0);assert.equal(newProduct.stock,5);assert.equal(newProduct.name,'Edited Browser Item');
  checks.push('Admin offline IMS: new item, dependent opening stock/edit, reload, clean-online account guard and server identity resolution PASS');

  await gotoRoute(admin,'inventory');await adminNetwork.offline(true);
  await admin.clock.setFixedTime(new Date(Date.now()-2*86400000));
  await admin.locator('tr').filter({hasText:'BROWSER-NEW'}).locator('[data-action=edit-product]').click();
  await admin.locator('#item-name').fill('Version Reviewed Browser Item');await admin.locator('#inventory-form [type=submit]').click();await waitQueue(admin,1);
  const originalInventoryEvent=(await localQueue(admin)).events.find(event=>event.status==='pending');
  await serialize(()=>database.query('update public.products set reorder_level=reorder_level+1 where id=$1',[newProduct.id]));
  await admin.clock.setFixedTime(new Date());await adminNetwork.offline(false);await sync(admin);await waitQueue(admin,0,1);
  await gotoRoute(admin,'device');await admin.locator('[data-action=retry-review]').first().click();
  await admin.locator('[name=refresh_version]').check();
  const inventoryRetryResponse=admin.waitForResponse(response=>response.url()===fixtureOrigin+'/rest/v1/rpc/apply_event'&&response.request().postDataJSON()?.p_event?.id!==originalInventoryEvent.id);
  await admin.locator('#review-retry-form [type=submit]').click();
  assert.equal((await(await inventoryRetryResponse).json()).status,'synced','The version-approved inventory retry must receive a fresh successful acknowledgement');
  await waitQueue(admin,0,0);
  const retriedInventory=observedEvents.filter(event=>event.kind==='inventory.save').at(-1);
  assert.notEqual(retriedInventory.id,originalInventoryEvent.id);assert.equal(retriedInventory.captured_at,originalInventoryEvent.captured_at);
  assert.equal((await database.query('select name from public.products where id=$1',[newProduct.id])).rows[0].name,'Version Reviewed Browser Item');
  checks.push('explicit version-approved inventory retry keeps original captured time and links confirmed recovery PASS');

  await gotoRoute(admin,'accounts');await axe(admin,'accounts');await responsive(admin,'accounts');
  await admin.locator('[data-action=new-cashier]').click();await admin.locator('#cashier-name').fill('Managed Browser Cashier');await admin.locator('#cashier-email').fill('managed@example.test');await admin.locator('#cashier-password').fill(password);await admin.locator('#cashier-confirmation').fill(password);await admin.locator('#cashier-form [type=submit]').click();
  await admin.getByText('Cashier account updated.',{exact:true}).waitFor();let managed=admin.locator('tr').filter({hasText:'managed@example.test'});await managed.locator('[data-action=edit-cashier]').click();await admin.locator('#cashier-name').fill('Updated Managed Cashier');await admin.locator('#cashier-form [type=submit]').click();
  await admin.locator('tr').filter({hasText:'Updated Managed Cashier'}).waitFor();managed=admin.locator('tr').filter({hasText:'managed@example.test'});await managed.locator('[data-action=cashier-active]').click();await admin.locator('#cashier-form [type=submit]').click();
  await admin.locator('tr').filter({hasText:'managed@example.test'}).getByText('Disabled',{exact:true}).waitFor();
  managed=admin.locator('tr').filter({hasText:'managed@example.test'});await managed.locator('[data-action=cashier-active]').click();await admin.locator('#cashier-form [type=submit]').click();await admin.locator('tr').filter({hasText:'managed@example.test'}).getByText('Enabled',{exact:true}).waitFor();
  checks.push('Admin online cashier account create/edit/disable/enable over isolated Auth/Edge boundary PASS');

  // Product deactivation creates a genuine business review without stealing quota.
  await gotoRoute(cashier,'pos');await cashierNetwork.offline(true);await cashier.clock.setFixedTime(new Date(Date.now()-2*86400000));await cashier.locator('.pos-card[data-id="1"]').click();await cashier.locator('#pos-amount').fill('100.00');await cashier.locator('#complete-sale').click();await cashier.waitForURL(/#receipt\//);await waitQueue(cashier,1);
  const originalSaleEvent=(await localQueue(cashier)).events.find(event=>event.status==='pending');
  await cashier.clock.setFixedTime(new Date());
  await serialize(()=>database.query('update public.products set active=false where id=1'));
  await cashierNetwork.offline(false);await sync(cashier);await waitQueue(cashier,0,1);await gotoRoute(cashier,'device');await axe(cashier,'review');await responsive(cashier,'review');
  assert.equal(await cashier.locator('.sidebar .signout').isDisabled(),true);
  await serialize(()=>database.query('update public.products set active=true where id=1'));await sync(cashier);
  await cashier.locator('[data-action=retry-review]').first().click();
  const retryResponse=cashier.waitForResponse(response=>response.url()===fixtureOrigin+'/rest/v1/rpc/apply_event');
  await cashier.locator('#review-retry-form [type=submit]').click();
  assert.equal((await(await retryResponse).json()).status,'synced','The corrected original sale must receive a successful cloud acknowledgement');
  await waitQueue(cashier,0,0);
  assert.equal(Number((await database.query('select count(*) as count from public.sales')).rows[0].count),3);
  const retriedSale=observedEvents.filter(event=>event.kind==='sale.create').at(-1);
  assert.notEqual(retriedSale.id,originalSaleEvent.id);assert.equal(retriedSale.captured_at,originalSaleEvent.captured_at);
  const recoveredSale=(await database.query('select created_at from public.sales where reference=$1::uuid',[retriedSale.payload.reference])).rows[0];
  assert.equal(new Date(recoveredSale.created_at).toISOString(),originalSaleEvent.captured_at);
  checks.push('Business conflict persists review, blocks logout, and explicit exact retry confirms once after correction PASS');
  checks.push('cross-day financial retry retains the original receipt/sales business timestamp PASS');

  const secondContext=await browser.newContext({viewport:{width:390,height:900}}),secondNetwork=await mockContext(secondContext);
  const secondCashier=await secondContext.newPage();listen(secondCashier);
  await login(secondCashier,'cashier@example.test','Second cashier device');
  const secondDevice=(await database.query('select id from public.devices where staff_id=10 and id<>$1::uuid',[cashierDevice])).rows[0].id;
  assert.notEqual(secondDevice,cashierDevice);
  await asActor({...staff.get('admin@example.test'),sessionId:(await database.query('select id from auth.sessions where user_id=$1::uuid',[staff.get('admin@example.test').authId])).rows[0].id,issuedAt:Math.floor(Date.now()/1000)},tx=>tx.query('select public.allocate_stock($1::uuid,1,2)',[secondDevice]));
  await sync(secondCashier);
  const stockBefore=Number((await database.query('select stock from public.products where id=1')).rows[0].stock);
  for(const [page,network] of [[cashier,cashierNetwork],[secondCashier,secondNetwork]]){
    await network.offline(true);await gotoRoute(page,'pos');await posPane(page,'products');await page.locator('.pos-card[data-id="1"]').click();await posPane(page,'sale');await page.locator('#pos-amount').fill('100.00');await page.locator('#complete-sale').click();await page.waitForURL(/#receipt\//);await waitQueue(page,1);
  }
  assert.equal(Number((await database.query('select count(*) as count from public.sales')).rows[0].count),3,'Disconnected devices must not already write cloud sales');
  await cashierNetwork.offline(false);await sync(cashier);await secondNetwork.offline(false);await sync(secondCashier);
  assert.equal(Number((await database.query('select count(*) as count from public.sales')).rows[0].count),5);
  assert.equal(Number((await database.query('select stock from public.products where id=1')).rows[0].stock),stockBefore-2);
  assert.equal(Number((await database.query('select remaining from public.stock_allocations where device_id=$1::uuid and product_id=1',[secondDevice])).rows[0].remaining),1);
  await sync(cashier);await sync(secondCashier);assert.equal(Number((await database.query('select count(*) as count from public.sales')).rows[0].count),5);
  checks.push('two independent offline Cashier devices preserve separate quotas/outboxes and synchronize sales exactly once PASS');
  await secondCashier.setViewportSize({width:1440,height:900});await secondCashier.locator('.sidebar .signout').click();await secondCashier.locator('#signin-form').waitFor();
  assert.equal((await localQueue(secondCashier)).snapshot,null,'Clean logout must remove this private prepared workspace');
  await sync(cashier);assert.ok(await cashier.locator('.workspace').isVisible(),'Signing out one device must preserve the other cashier session');
  checks.push('clean device logout clears its private cache while preserving other device sessions PASS');

  await cashierNetwork.offline(true);await gotoRoute(cashier,'pos');await cashier.locator('.pos-card[data-id="1"]').click();await cashier.locator('#pos-amount').fill('100.00');await cashier.locator('#complete-sale').click();await cashier.waitForURL(/#receipt\//);await waitQueue(cashier,1);
  const retainedIdentity=(await localQueue(cashier)).events.find(event=>event.status==='pending').id;
  await sync(admin);await gotoRoute(admin,'accounts');
  let renamed=admin.locator('tr').filter({hasText:'cashier@example.test'});await renamed.locator('[data-action=edit-cashier]').click();await admin.locator('#cashier-email').fill('renamed@example.test');await admin.locator('#cashier-form [type=submit]').click();
  renamed=admin.locator('tr').filter({hasText:'renamed@example.test'});await renamed.waitFor();await renamed.locator('[data-action=cashier-password]').click();await admin.locator('#cashier-password').fill(password);await admin.locator('#cashier-confirmation').fill(password);await admin.locator('#cashier-form [type=submit]').click();
  await admin.getByText('Cashier account updated.',{exact:true}).waitFor();
  await cashierNetwork.offline(false);await cashier.locator('#signin-form').waitFor();
  assert.equal(await cashier.locator('#signin-email').evaluate(input=>input.readOnly),false);
  await cashier.locator('#signin-email').fill('other@example.test');await cashier.locator('#signin-password').fill(password);await cashier.locator('#signin-form [type=submit]').click();
  await cashier.getByText('Use this prepared device’s original staff account. Its saved changes have been retained.',{exact:true}).waitFor();
  assert.equal((await localQueue(cashier)).events.find(event=>event.status==='pending').id,retainedIdentity);
  await cashier.locator('#signin-email').fill('renamed@example.test');await cashier.locator('#signin-password').fill(password);await cashier.locator('#signin-form [type=submit]').click();await cashier.locator('.workspace').waitFor();await waitQueue(cashier,0,0);
  const restoredIdentity=(await localQueue(cashier)).snapshot;
  assert.equal(restoredIdentity.staffId,10);assert.equal(restoredIdentity.deviceId,cashierDevice);assert.equal(restoredIdentity.email,'renamed@example.test');
  assert.equal(observedEvents.find(event=>event.id===retainedIdentity).id,retainedIdentity);
  assert.equal(Number((await database.query('select count(*) as count from public.sales')).rows[0].count),6);
  checks.push('email-change reauthentication rejects another Cashier, restores the same staff/device and syncs retained evidence once PASS');

  await login(secondCashier,'renamed@example.test','Second cashier device');await secondCashier.setViewportSize({width:1440,height:900});
  secondNetwork.interruptNextLogout();await secondCashier.locator('.sidebar .signout').click();
  await secondCashier.getByRole('button',{name:'Finish sign out',exact:true}).waitFor();
  assert.equal((await localQueue(secondCashier)).signingOut,true);assert.equal(await secondCashier.locator('.workspace').count(),0);
  await secondNetwork.offline(true);await secondCashier.reload();
  await secondCashier.getByRole('button',{name:'Finish sign out',exact:true}).waitFor();
  assert.equal(await secondCashier.getByRole('button',{name:'Finish sign out',exact:true}).isDisabled(),true);
  assert.equal(await secondCashier.locator('#signin-form').count(),0);await axe(secondCashier,'interrupted-signout');
  await responsive(secondCashier,'interrupted-signout');
  await secondCashier.screenshot({path:path.join(artifacts,'cloud-ui-interrupted-signout.png'),fullPage:true});
  await secondNetwork.offline(false);await secondCashier.getByRole('button',{name:'Finish sign out',exact:true}).click();await secondCashier.locator('#signin-form').waitFor();
  assert.equal((await localQueue(secondCashier)).snapshot,null);await login(secondCashier,'renamed@example.test','Second cashier device');
  checks.push('logout interrupted after Auth cleanup hides private data across offline reload and finishes online before device reuse PASS');

  const guestContext=await browser.newContext({viewport:{width:390,height:900}}),guestNetwork=await mockContext(guestContext),guest=await guestContext.newPage();listen(guest);
  await serialize(()=>database.query('update public.products set stock=0 where id=7'));
  await guest.goto(origin+'/');await guest.locator('.product-card').first().waitFor();await guest.locator('#catalog-freshness').filter({hasText:'Synced catalog'}).waitFor();
  const unavailable=guest.locator('.product-card').filter({hasText:'Demo Long Product Name For A Wrapped Retail Card'});assert.equal(await unavailable.locator('button').isDisabled(),true);
  assert.equal(await guest.locator('#demo-badge').isVisible(),true);assert.equal(await guest.locator('#demo-footer').isVisible(),true);await axe(guest,'guest-cloud');
  const publicRecords=(await asActor(null,tx=>tx.query('select public.public_catalog() as value'))).rows[0].value;
  assert.ok(publicRecords.every(item=>!Object.keys(item).some(key=>['stock','reserved','allocated','customer_name','email','user_id'].includes(key))),'Guest projection exposes private counts or staff/customer data');
  await guest.evaluate(async()=>{await navigator.serviceWorker.ready;if(!navigator.serviceWorker.controller)await new Promise(resolve=>navigator.serviceWorker.addEventListener('controllerchange',resolve,{once:true}));});
  await guestNetwork.offline(true);await guest.reload();await guest.locator('#catalog-freshness').filter({hasText:'Cached catalog'}).waitFor();assert.ok(await guest.locator('.product-card').count()>0);
  assert.equal(await guest.locator('#demo-badge').isVisible(),true);assert.equal(await guest.locator('#demo-footer').isVisible(),true);
  await guest.evaluate(()=>{for(const key of Object.keys(localStorage))if(key.startsWith('smart-public-catalog-v1-'))localStorage.removeItem(key);});await guest.reload();await guest.locator('#catalog-error').waitFor({state:'visible'});assert.equal(await guest.locator('.product-card').count(),0);assert.match(await guest.locator('#catalog-freshness').textContent(),/No synchronized catalog/);
  await guestNetwork.offline(false);await guest.locator('.product-card').first().waitFor();
  await guest.locator('.product-card').filter({hasText:'Demo Notebook'}).getByRole('button',{name:/Add/}).click();await guest.locator('#floating-basket').click();
  assert.equal(await guest.locator('#open-messenger').getAttribute('href'),null);await guest.evaluate(()=>Object.defineProperty(navigator.clipboard,'writeText',{configurable:true,value:async text=>{window.__cloudMockClipboard=text;}}));await guest.locator('#copy-summary').click();
  await guest.waitForFunction(()=>document.getElementById('open-messenger').hasAttribute('href'));assert.equal(new URL(await guest.locator('#open-messenger').getAttribute('href')).searchParams.get('id'),'61594157431738');
  await guest.keyboard.press('Escape');await guest.screenshot({path:path.join(artifacts,'cloud-ui-guest-390.png'),fullPage:true});
  checks.push('Guest cloud catalog: public safe availability, unavailable Add, cached freshness, no-cache error/recovery and copy-gated Messenger inquiry PASS');
  const confirmedContext=await browser.newContext({viewport:{width:390,height:900}});await mockContext(confirmedContext);
  const confirmedGuest=await confirmedContext.newPage();listen(confirmedGuest);
  await confirmedGuest.route(origin+'/config.js',async route=>{const response=await route.fetch();await route.fulfill({response,body:(await response.text()).replace('demo: true','demo: false')});});
  await confirmedGuest.goto(origin+'/');await confirmedGuest.locator('#catalog-freshness').filter({hasText:'Synced catalog'}).waitFor();
  assert.equal(await confirmedGuest.locator('#demo-badge').isVisible(),false);assert.equal(await confirmedGuest.locator('#demo-footer').isVisible(),false);
  checks.push('cloud and cached catalog preserve sample-price labels until demo is explicitly false PASS');
  assert.deepEqual(javascriptErrors,[]);assert.deepEqual(policyErrors,[]);assert.deepEqual(forbiddenRequests,[]);
  checks.push('zero JavaScript/CSP errors and zero real external requests PASS');
  await writeFile(resultFile,JSON.stringify(report('PASS'),null,2));console.log(JSON.stringify(report('PASS'),null,2));
} catch(error) {
  await mkdir(artifacts,{recursive:true});await writeFile(resultFile,JSON.stringify(report('FAIL',error),null,2));console.error(JSON.stringify(report('FAIL',error),null,2));process.exitCode=1;
} finally {
  if(installContext)await installContext.close();
  if(browser)await browser.close();if(server)await new Promise(resolve=>server.close(resolve));if(database)await database.close();
}
