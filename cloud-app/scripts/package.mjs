import { copyFile, cp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadEnv } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
const outputIndex = process.argv.indexOf('--output');
const destination = outputIndex < 0 ? path.join(root, 'dist') : path.resolve(process.argv[outputIndex+1] || '');
const fixtureRoot = path.resolve(root,'../.runtime')+path.sep;
if (destination !== path.join(root,'dist') && !destination.startsWith(fixtureRoot)) throw new Error('Fixture output must stay inside the ignored workspace .runtime directory.');
const catalog = fileURLToPath(new URL('../../catalog/', import.meta.url));
const env = loadEnv('production', root, 'VITE_');
const url = env.VITE_SUPABASE_URL || '', key = env.VITE_SUPABASE_PUBLISHABLE_KEY || '';
let origin = '';
if (url || key) {
  const endpoint = new URL(url);
  if (endpoint.protocol !== 'https:' || !/^[a-z0-9-]+\.supabase\.co$/.test(endpoint.hostname) || endpoint.pathname !== '/' || endpoint.search || endpoint.hash || endpoint.username || endpoint.password) throw new Error('Use the public Supabase project URL.');
  let publicKey = /^sb_publishable_[A-Za-z0-9_-]+$/.test(key);
  if (!publicKey && key.split('.').length === 3) {
    try { publicKey = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()).role === 'anon'; } catch { /* Invalid keys fail the build. */ }
  }
  if (!publicKey) throw new Error('Only a publishable/anon key is permitted in the public build.');
  origin = endpoint.origin;
}
await mkdir(destination, {recursive:true});
for (const name of ['index.html','app.js','styles.css','theme.css','products.json','config.js']) await copyFile(path.join(catalog,name),path.join(destination,name));
await cp(path.join(catalog,'assets'),path.join(destination,'assets'),{recursive:true});
await writeFile(path.join(destination,'cloud-config.js'),'window.CLOUD_CONFIG = Object.freeze('+JSON.stringify({url:origin,key:origin?key:''})+');\n');
// Raster artwork is embedded unchanged inside a code-native square icon frame.
const logo = await readFile(path.join(catalog,'assets/logo.png'));
await writeFile(path.join(destination,'staff/icon.svg'),`<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><rect width="512" height="512" fill="#f4f6fa"/><image x="94" y="116" width="324" height="280" href="data:image/png;base64,${logo.toString('base64')}"/></svg>`);
await writeFile(path.join(destination,'manifest.webmanifest'),JSON.stringify({id:'/',name:'Smart School Supplies',short_name:'Smart Supplies',start_url:'/',scope:'/',display:'standalone',theme_color:'#122c50',background_color:'#faf9f5',icons:[{src:'/staff/icon.svg',sizes:'any',type:'image/svg+xml',purpose:'any maskable'}]},null,2));
let html = await readFile(path.join(destination,'index.html'),'utf8');
html = html.replace('<script src="config.js" defer></script>','<link rel="manifest" href="manifest.webmanifest"><script src="cloud-config.js" defer></script><script src="config.js" defer></script>');
await writeFile(path.join(destination,'index.html'),html);
async function files(directory,prefix='') {
  const result=[];
  for(const entry of await readdir(directory,{withFileTypes:true})) {
    const relative=prefix+entry.name;
    if(entry.isDirectory())result.push(...await files(path.join(directory,entry.name),relative+'/'));
    else if(!['sw.js','_headers'].includes(entry.name))result.push('/'+relative);
  }
  return result.sort();
}
const all = await files(destination);
const versionHash = createHash('sha256');
for(const name of all)versionHash.update(name).update(await readFile(path.join(destination,name.slice(1))));
const version=versionHash.digest('hex').slice(0,16);
function worker(scope,list) {
  const prefix='smart-static-'+scope+'-', cache=prefix+version;
  return `'use strict';\nconst CACHE=${JSON.stringify(cache)}, PREFIX=${JSON.stringify(prefix)}, FILES=${JSON.stringify(list)};\n`+
    `self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(FILES))));\n`+
    `self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith(PREFIX)&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));\n`+
    `self.addEventListener('fetch',event=>{const url=new URL(event.request.url);if(event.request.method!=='GET'||url.origin!==self.location.origin)return;let name=url.pathname;if(name===${JSON.stringify(scope==='staff'?'/staff/':'/')})name+= 'index.html';if(url.search||!FILES.includes(name))return;event.respondWith(caches.open(CACHE).then(async cache=>(await cache.match(name))||fetch(event.request)));});\n`;
}
const staff = all.filter(name=>name.startsWith('/staff/')||name.startsWith('/assets/'));
const guest = all.filter(name=>!name.startsWith('/staff/')||name==='/staff/icon.svg');
await writeFile(path.join(destination,'staff/sw.js'),worker('staff',staff));
await writeFile(path.join(destination,'sw.js'),worker('guest',guest));
const connect=origin?` ${origin} ${origin.replace('https:','wss:')}`:'';
await writeFile(path.join(destination,'_headers'),`/*\n  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'${connect}; worker-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n  Permissions-Policy: camera=(), microphone=(), geolocation=()\n  X-Frame-Options: DENY\n/staff/sw.js\n  Cache-Control: no-cache\n/sw.js\n  Cache-Control: no-cache\n/cloud-config.js\n  Cache-Control: no-cache\n`);
console.log(`Static package ready: ${all.length} public assets; configuration ${origin?'connected':'not configured'}.`);
