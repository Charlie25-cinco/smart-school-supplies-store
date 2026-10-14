import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const app = resolve(root, 'store-app');
const catalogHeaders={};
let catalogHeaderPath='';
for(const line of readFileSync(resolve(root,'catalog/_headers'),'utf8').split(/\r?\n/)) {
    if(!line.trim() || line.trimStart().startsWith('#')) continue;
    if(!/^\s/.test(line)) { catalogHeaderPath=line.trim(); continue; }
    if(catalogHeaderPath!=='/*') continue;
    const header=/^\s+([A-Za-z0-9-]+):\s*(.+)$/.exec(line);
    assert.ok(header,'Invalid all-path catalog header rule.');
    catalogHeaders[header[1].toLowerCase()]=header[2];
}
assert.ok(catalogHeaders['content-security-policy'],'Catalog Content-Security-Policy rule is missing.');
const expectedCatalogPage='https://www.facebook.com/profile.php?id=61594157431738';
const { chromium } = await import(pathToFileURL(resolve(app, 'node_modules/playwright/index.mjs')).href);
const { default: AxeBuilder } = await import(pathToFileURL(resolve(app, 'node_modules/@axe-core/playwright/dist/index.mjs')).href);
const artifacts = resolve(root, 'artifacts');
mkdirSync(artifacts, { recursive: true });
const views = resolve(artifacts, 'ui-views');
mkdirSync(views, { recursive: true });
const database = resolve(artifacts, 'ui-test.sqlite');
for (const suffix of ['', '-wal', '-shm', '-journal']) rmSync(database + suffix, { force: true });
writeFileSync(database, '');
const password = randomBytes(24).toString('hex');
const managedPassword = randomBytes(24).toString('hex');
const managedEmail = 'managed-cashier@example.test';
const env = { ...process.env, APP_ENV: 'testing', APP_DEBUG: 'false', APP_KEY: `base64:${randomBytes(32).toString('base64')}`, DB_CONNECTION: 'sqlite', DB_DATABASE: database, DB_URL: '', CACHE_STORE: 'array', SESSION_DRIVER: 'database', VIEW_COMPILED_PATH: views, STORE_DEMO: 'true', UI_PASSWORD: password };
const php = process.env.PHP_EXECUTABLE || 'php';
const fixture = spawnSync(php, [resolve(root, 'scripts/ui-fixture.php')], { cwd: app, env, encoding: 'utf8', windowsHide: true });
assert.equal(fixture.status, 0, 'Isolated browser fixture setup failed.');
const fixtureAction = (action, ...args) => {
    const result=spawnSync(php,[resolve(root,'scripts/ui-fixture.php'),action,...args.map(String)],{cwd:app,env,encoding:'utf8',windowsHide:true});
    assert.equal(result.status,0,`Isolated ${action} fixture failed.`);
    return JSON.parse(result.stdout);
};
const port = () => new Promise((resolvePort, reject) => { const server = createServer(); server.on('error', reject); server.listen(0, '127.0.0.1', () => { const value = server.address().port; server.close(() => resolvePort(value)); }); });
const appPort = await port(), catalogPort = await port();
const appUrl = `http://127.0.0.1:${appPort}`, catalogUrl = `http://127.0.0.1:${catalogPort}`;
const servers = [];
const start = (args, cwd, variables = process.env) => { const child = spawn(php, args, { cwd, env: variables, stdio: 'ignore', windowsHide: true }); servers.push(child); return child; };
start(['-S', `127.0.0.1:${appPort}`, '-t', '.', resolve(app, 'vendor/laravel/framework/src/Illuminate/Foundation/resources/server.php')], resolve(app, 'public'), env);
start(['-S', `127.0.0.1:${catalogPort}`, '-t', 'catalog'], root);
const ready = async url => { for (let attempt = 0; attempt < 40; attempt++) { try { const response = await fetch(url); if (response.ok) return; } catch {} await new Promise(r => setTimeout(r, 150)); } throw new Error(`Preview did not become ready: ${url}`); };
let browser;
const checks = [];
try {
    await ready(`${appUrl}/login`); await ready(catalogUrl);
    const executable = process.env.BROWSER_EXECUTABLE || ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
    assert.ok(executable, 'Set BROWSER_EXECUTABLE to an installed Chromium browser.');
    browser = await chromium.launch({ executablePath: executable, headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    const errors = [];
    const fonts = [];
    const catalogPolicyErrors=[];
    const forbiddenCatalogRequests=[];
    let catalogPhase=true;
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => {if (/\.woff2(?:\?|$)/.test(response.url())) fonts.push({url:response.url(),status:response.status()});});
    page.on('console',message=>{
        if(catalogPhase && message.type()==='error' && /content[- ]security[- ]policy|violat(?:es?|ion).*directive|refused to (?:load|execute|apply|connect)/i.test(message.text())) catalogPolicyErrors.push(message.text());
    });
    await context.route('**/*',async route=>{
        if(!catalogPhase) { await route.fallback(); return; }
        const url=new URL(route.request().url());
        if(!['http:','https:'].includes(url.protocol)) { await route.fallback(); return; }
        const privatePath=/^\/(?:store-app|database|storage|\.runtime|\.git|\.env|login|pos|inventory|orders|sales|cashiers|dashboard)(?:\/|[.]|$)/i.test(decodeURIComponent(url.pathname));
        if(url.origin!==catalogUrl || privatePath) {
            forbiddenCatalogRequests.push(url.origin+url.pathname);
            await route.abort('blockedbyclient'); return;
        }
        // PHP does not interpret Cloudflare's _headers file. Apply its real
        // all-path rules here to verify browser compatibility before deployment.
        const response=await route.fetch();
        await route.fulfill({response,headers:{...response.headers(),...catalogHeaders}});
    });
    const setViewport = async size => {
        await page.setViewportSize(size);
        // CSS responds immediately; matchMedia change listeners run on the next
        // rendering turn. Wait for the actual menu/pane controls before asserting.
        await page.waitForFunction(() => {
            const menu=document.getElementById('workspace-menu-open');
            const switcher=document.getElementById('pos-view-switcher');
            return (!menu || (!menu.hidden && (getComputedStyle(menu).display!=='none')===matchMedia('(max-width: 1100px)').matches))
                && (!switcher || switcher.hidden!==matchMedia('(max-width: 900px)').matches);
        });
    };
    const accessibility = async label => {
        const result = await new AxeBuilder({ page }).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze();
        assert.deepEqual(result.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) })), [], `${label} accessibility violations`);
        checks.push(`${label}: axe PASS`); console.log(`${label}: accessibility PASS`);
    };
    const login = async role => {
        await page.goto(`${appUrl}/login`);
        await page.getByLabel('Email address').fill(`${role}@example.test`);
        await page.getByLabel('Password', {exact:true}).fill(password);
        await page.getByRole('button', {name:/Sign in/}).click();
        await page.waitForURL(`**/${role==='admin'?'dashboard':'pos'}`);
    };
    const signout = async () => {
        if (await page.locator('#workspace-menu-open').isVisible()) await page.locator('#workspace-menu-open').click();
        await page.getByRole('button',{name:/Sign out/}).click();
        await page.waitForURL('**/login');
    };
    const posPane = async pane => {
        const tab=page.locator(pane==='sale'?'#pos-sale-tab':'#pos-products-tab');
        if (await tab.isVisible()) await tab.click();
    };
    const compactNavigation = async label => {
        const trigger=page.locator('#workspace-menu-open');
        await trigger.focus(); await page.keyboard.press('Enter');
        assert.equal(await page.locator('#workspace-menu').evaluate(dialog=>dialog.open),true,`${label}: menu not keyboard operable`);
        const navigation=await page.locator('#workspace-menu .nav-link').evaluateAll(links=>links.map(link=>({icon:link.querySelectorAll('svg[aria-hidden=true]').length,height:link.getBoundingClientRect().height})));
        assert.ok(navigation.length>0 && navigation.every(link=>link.icon===1 && link.height>=44),`${label}: compact navigation targets too small`);
        assert.equal(await page.locator('#workspace-menu').getByRole('button',{name:/Sign out/}).isVisible(),true,`${label}: compact sign out hidden`);
        await page.keyboard.press('Escape');
        assert.equal(await trigger.evaluate(el=>el===document.activeElement),true,`${label}: closing menu does not restore focus`);
    };
    const responsive = async label => {
        for (const width of [1440, 1024, 768, 390, 375]) {
            await setViewport({ width, height: 1000 });
            const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
            assert.equal(overflow, false, `${label} overflows at ${width}px`);
            if (await page.locator('#workspace-menu-open').isVisible()) await compactNavigation(`${label} ${width}px`);
            else if (await page.locator('.sidebar').count()) assert.equal(await page.getByRole('button', {name:/Sign out/}).isVisible(), true, `${label}: sign out hidden at ${width}px`);
            if (await page.locator('.sidebar').isVisible()) {
                const navigation = await page.locator('.sidebar .nav-link').evaluateAll(links=>links.map(link=>({icon:link.querySelectorAll('svg[aria-hidden=true]').length,height:link.getBoundingClientRect().height})));
                assert.ok(navigation.every(link=>link.icon===1 && link.height>=44),`${label}: inconsistent navigation icons or touch targets`);
            }
            const logo = page.locator('.brand-emblem img').first();
            if (await logo.count()) assert.equal(await logo.evaluate(el => {
                const box=el.getBoundingClientRect(),frame=el.parentElement.getBoundingClientRect();
                return el.complete && el.naturalWidth===213 && el.naturalHeight===184 && getComputedStyle(el).objectFit==='contain'
                    && box.left>=frame.left-1 && box.right<=frame.right+1 && box.top>=frame.top-1 && box.bottom<=frame.bottom+1;
            }), true, `${label}: supplied logo failed to load without cropping`);
            if(page.url().startsWith(catalogUrl)) {
                const banner=page.locator('img.hero-banner');
                assert.equal(await banner.isVisible(),true,`${label}: banner hidden at ${width}px`);
                assert.equal(await banner.evaluate(image=>{
                    const box=image.getBoundingClientRect(),frame=image.parentElement.getBoundingClientRect();
                    return image.complete && image.naturalWidth===1536 && image.naturalHeight===1024 && getComputedStyle(image).objectFit==='contain'
                        && Math.abs(box.width/box.height-1.5)<0.01 && box.left>=frame.left-1 && box.right<=frame.right+1 && box.top>=frame.top-1 && box.bottom<=frame.bottom+1;
                }),true,`${label}: full supplied banner is clipped or distorted at ${width}px`);
            }
            await page.screenshot({ path: resolve(artifacts, `${label}-${width}.png`), fullPage: true, animations: 'disabled' });
            if (await page.locator('#pos-view-switcher').isVisible()) {
                for (const pane of ['products','sale']) {
                    await posPane(pane);
                    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,`${label}: ${pane} pane overflows at ${width}px`);
                    const target=page.locator(pane==='products'?'#product-browser':'#checkout-basket');
                    assert.equal(await target.isVisible(),true,`${label}: selected ${pane} pane hidden`);
                    await readableScreen(`${label} ${pane} ${width}px`);
                    await page.screenshot({path:resolve(artifacts,`${label}-${pane}-${width}.png`),fullPage:true,animations:'disabled'});
                }
            }
        }
        await setViewport({ width: 1440, height: 1000 }); checks.push(`${label}: desktop/tablet/390px/375px, compact keyboard navigation, POS panes and document branding PASS`);
    };
    // REQ-022 keeps payment outside the basket scroll area. Standard desktop POS
    // fits at 1101x768; shorter windows retain readable, reachable controls.
    const readableScreen = async label => {
        const size = await page.evaluate(() => ({height: document.documentElement.scrollHeight, viewport: innerHeight, width: document.documentElement.scrollWidth, viewportWidth: innerWidth}));
        assert.ok(size.width <= size.viewportWidth + 1, `${label}: horizontal page overflow`);
        const text = await page.locator('body, .page-heading p, input:not([type=hidden]):not([type=checkbox]), select, textarea, td, .pos-card strong, .pos-price').evaluateAll(elements => elements.filter(el => el.getClientRects().length).map(el => ({name:el.tagName, selector:el.className, font:parseFloat(getComputedStyle(el).fontSize), minimum:el.matches('.pos-card strong')?18:el.matches('.pos-price')?24:el.matches('td')?15:el.matches('.page-heading p')?15:16})));
        assert.deepEqual(text.filter(item=>item.font<item.minimum),[],`${label}: staff text below approved readable sizing`);
        if (await page.locator('#pos-app').count() && size.viewportWidth>=1101 && size.viewport>=768 && !await page.locator('.main > .notice.error').count()) {
            if (size.height>size.viewport+1) await page.screenshot({path:resolve(artifacts,'layout-failure.png'),fullPage:true});
            assert.ok(size.height<=size.viewport+1,`${label}: standard desktop POS overflows ${JSON.stringify(size)}`);
        }
    };
    const sidebarWorkflow = async role => {
        const originalUrl=page.url();
        const aside=page.locator('.sidebar');
        const navigation=aside.locator('nav');
        const links=navigation.locator('a');
        const profile=aside.locator('.profile');
        const signout=aside.getByRole('button',{name:/Sign out/});
        const brand=aside.locator('.brand');
        const snapshot=()=>aside.evaluate(element=>{
            const rectangle=node=>{const box=node.getBoundingClientRect();return {x:box.x,y:box.y,width:box.width,height:box.height};};
            return {brand:rectangle(element.querySelector('.brand')),profile:rectangle(element.querySelector('.profile')),signout:rectangle(element.querySelector('.signout')),asideScroll:element.scrollTop,windowScroll:scrollY};
        });
        const fixed=(before,after,label)=>{
            for(const item of ['brand','profile','signout']) for(const coordinate of ['x','y','width','height']) {
                assert.ok(Math.abs(before[item][coordinate]-after[item][coordinate])<=1,`${label}: ${item} moved while navigating`);
            }
            assert.equal(after.asideScroll,before.asideScroll,`${label}: the whole sidebar scrolled`);
            assert.equal(after.windowScroll,before.windowScroll,`${label}: navigation moved the main page`);
        };
        const fullyVisible=async(target,label)=>{
            const box=await target.boundingBox();
            const viewport=page.viewportSize();
            assert.ok(box && box.x>=-1 && box.y>=-1 && box.x+box.width<=viewport.width+1 && box.y+box.height<=viewport.height+1,`${label}: control is clipped ${JSON.stringify(box)}`);
        };
        const visibleNavLink=async(target,label)=>{
            const box=await target.boundingBox();
            const region=await navigation.boundingBox();
            assert.ok(box && region && box.height>=44 && box.y>=region.y-1 && box.y+box.height<=region.y+region.height+1,`${label}: focused navigation link is clipped or too small`);
            await fullyVisible(target,label);
        };
        let overflowObserved=false;
        await page.evaluate(()=>document.fonts.ready);
        for(const width of [1101,1280,1366,1440]) for(const height of [560,600,768]) {
            await setViewport({width,height});
            await page.evaluate(()=>window.scrollTo(0,0));
            await aside.evaluate(element=>element.scrollTop=0);
            await navigation.evaluate(element=>element.scrollTop=0);
            const before=await snapshot();
            const sidebarBox=await aside.boundingBox();
            assert.ok(sidebarBox && Math.abs(sidebarBox.width-(width<=1250?190:208))<=1,`${role}: sidebar width changed`);
            for(const target of [brand,profile,signout]) await fullyVisible(target,`${role} sidebar ${width}x${height}`);
            assert.equal(before.asideScroll,0,`${role}: normal sidebar already needs whole-panel scrolling`);
            const sizes=await links.evaluateAll(elements=>elements.map(element=>element.getBoundingClientRect().height));
            assert.ok(sizes.length>0 && sizes.every(height=>height>=44),`${role}: sidebar touch targets below 44px`);
            const scroll=await navigation.evaluate(element=>{element.scrollTop=element.scrollHeight;return {value:element.scrollTop,overflow:element.scrollHeight>element.clientHeight+1};});
            overflowObserved ||= scroll.overflow;
            if(scroll.overflow) assert.ok(scroll.value>0,`${role}: overflowing navigation cannot scroll`);
            fixed(before,await snapshot(),`${role} manual nav scroll ${width}x${height}`);
            await links.first().focus();
            await visibleNavLink(links.first(),`${role} first link ${width}x${height}`);
            for(let index=1;index<sizes.length;index++) {
                await page.keyboard.press('Tab');
                assert.equal(await links.nth(index).evaluate(element=>element===document.activeElement),true,`${role}: keyboard skipped navigation link ${index}`);
                await visibleNavLink(links.nth(index),`${role} keyboard link ${index} ${width}x${height}`);
            }
            await page.keyboard.press('Tab');
            assert.equal(await signout.evaluate(element=>element===document.activeElement),true,`${role}: keyboard cannot reach sign out`);
            fixed(before,await snapshot(),`${role} keyboard nav scroll ${width}x${height}`);
            if(width===1101 && height===560 || width===1366 && height===600 || width===1440 && height===768) {
                await page.screenshot({path:resolve(artifacts,`sidebar-${role.toLowerCase()}-${width}x${height}.png`),fullPage:true,animations:'disabled'});
            }
        }
        // Admin's real management links exercise overflow on a short desktop.
        // Cashier links may fit naturally; no synthetic links are inserted.
        if(role==='Admin') assert.ok(overflowObserved,'Admin: real navigation never exercised overflow');
        checks.push(`${role} sidebar: fixed brand/profile/sign-out, real navigation scrolling and native keyboard links at 1101/1280/1366/1440 widths and 560/600/768 heights PASS`);
        for(const height of [400,480]) {
            await setViewport({width:1280,height});
            await page.evaluate(()=>window.scrollTo(0,0));
            await aside.evaluate(element=>element.scrollTop=0);
            await fullyVisible(brand,`${role} tiny sidebar brand ${height}`);
            await links.first().focus(); await fullyVisible(links.first(),`${role} tiny sidebar first link ${height}`);
            for(let index=1;index<await links.count();index++) await page.keyboard.press('Tab');
            assert.equal(await links.last().evaluate(element=>element===document.activeElement),true,`${role}: tiny keyboard cannot reach last link`);
            await fullyVisible(links.last(),`${role} tiny sidebar last link ${height}`);
            await page.keyboard.press('Tab');
            assert.equal(await signout.evaluate(element=>element===document.activeElement),true,`${role}: tiny keyboard cannot reach sign out`);
            await fullyVisible(signout,`${role} tiny sidebar sign out ${height}`);
            await fullyVisible(profile,`${role} tiny sidebar profile ${height}`);
            const fallback=await aside.evaluate(element=>({overflow:element.scrollHeight>element.clientHeight+1,scroll:element.scrollTop,page:scrollY}));
            if(fallback.overflow) assert.ok(fallback.scroll>0,`${role}: tiny whole-sidebar fallback did not reveal controls`);
            assert.equal(fallback.page,0,`${role}: tiny sidebar focus moved the main page`);
            await brand.focus(); await fullyVisible(brand,`${role} tiny sidebar return to brand ${height}`);
            await page.screenshot({path:resolve(artifacts,`sidebar-${role.toLowerCase()}-1280x${height}.png`),fullPage:true,animations:'disabled'});
        }
        await setViewport({width:1280,height:560});
        const staffName=profile.locator('strong');
        const previousName=await staffName.textContent();
        try {
            await staffName.evaluate(element=>element.textContent='Alexandria Demo Example Staff Workspace Account');
            await page.evaluate(()=>window.scrollTo(0,0));
            await signout.focus();
            await fullyVisible(signout,`${role} long-name account controls`);
            await fullyVisible(profile,`${role} long-name profile`);
            assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,`${role}: long fictional staff name causes horizontal page overflow`);
            assert.equal(await profile.evaluate(element=>element.scrollWidth<=element.clientWidth+1),true,`${role}: long staff name overflows its profile`);
            assert.equal(await page.evaluate(()=>scrollY),0,`${role}: long-name sidebar recovery moved the main page`);
            await brand.focus(); await fullyVisible(brand,`${role} long-name return to brand`);
        } finally { await staffName.evaluate((element,value)=>element.textContent=value,previousName); }
        checks.push(`${role} sidebar: 400/480px whole-panel keyboard recovery and long fictional account-name layout PASS`);
        await page.goto(`${appUrl}/sales`);
        for(const width of [375,768,1024]) {
            await setViewport({width,height:600});
            await page.evaluate(()=>window.scrollTo(0,0));
            await compactNavigation(`${role} sales menu ${width}px`);
            await page.locator('#workspace-menu-open').click();
            const current=page.locator('#workspace-menu nav a[aria-current=page]');
            assert.equal(await current.evaluate(element=>element===element.parentElement.lastElementChild),true,`${role}: resize scenario did not use the last current link`);
            await current.focus(); await fullyVisible(current,`${role} compact current last link ${width}px`);
            await setViewport({width:1101,height:560});
            await page.waitForFunction(()=>!document.getElementById('workspace-menu').open && document.activeElement===document.querySelector('#store-navigation [aria-current=page]'));
            const desktopCurrent=aside.locator('nav a[aria-current=page]');
            await visibleNavLink(desktopCurrent,`${role} resize-revealed current last link`);
            assert.equal(await page.evaluate(()=>scrollY),0,`${role}: drawer resize restoration moved the main page`);
        }
        checks.push(`${role} sidebar/menu: compact Escape and resize reveal the current last navigation link without moving the main page PASS`);
        await setViewport({width:1440,height:1000});
        await page.goto(originalUrl);
    };
    const retailPos = async label => {
        for (const [width, height] of [[1366, 768], [1280, 720], [1024, 768], [1280, 679], [1280, 632], [1366, 600], [1024, 560]]) {
            await setViewport({width, height});
            await readableScreen(`${label} ${width}x${height}`);
            for (const selector of ['#cart-total', '#complete-sale']) {
                const target=page.locator(selector);
                const before=await target.boundingBox();
                assert.ok(before && before.width>0 && before.height>0,`${label} ${width}x${height}: ${selector} is hidden`);
                if ((width<1101 || height<768) && (before.y < -1 || before.y+before.height > height+1)) {
                    // Check real viewport geometry first, then exercise browser
                    // scrolling only when needed, without animation-frame gates.
                    await target.evaluate(element=>element.scrollIntoView({behavior:'instant',block:'center',inline:'nearest'}));
                }
                const box = await target.boundingBox();
                if (!box || box.y < -1 || box.y+box.height > height+1) {
                    const context=await target.evaluate(element=>({viewport:{width:innerWidth,height:innerHeight},scrollY,visibility:document.visibilityState,focusedControl:document.activeElement.id,hidden:!!element.closest('[hidden]'),openDialogs:[...document.querySelectorAll('dialog[open]')].map(dialog=>dialog.id)}));
                    writeFileSync(resolve(artifacts,'pos-reachability-failure.json'),JSON.stringify({label,selector,before,after:box,context},null,2));
                    await page.screenshot({path:resolve(artifacts,'pos-reachability-failure.png'),fullPage:true,animations:'disabled'});
                }
                assert.ok(box && box.y >= -1 && box.y + box.height <= height+1, `${label} ${width}x${height}: ${selector} outside viewport ${JSON.stringify(box)}`);
            }
            const gap = await page.locator('#checkout-basket').evaluate(panel => panel.getBoundingClientRect().bottom - panel.querySelector('.checkout-footer').getBoundingClientRect().bottom);
            assert.ok(gap <= 2, `${label}: blank panel space below checkout footer (${gap}px)`);
            const targets = await page.locator('#pos-app .button, #pos-app .tab, #pos-app .quantity-control button, #pos-app input:not([type=hidden]):not([type=checkbox]), #pos-app select').evaluateAll(elements => elements.filter(el => el.getClientRects().length).map(el => ({name:el.id || el.textContent, height:el.getBoundingClientRect().height})));
            assert.deepEqual(targets.filter(target => target.height < 44), [], `${label}: touch controls smaller than 44px`);
            await page.locator('.checkout-scroll').evaluate(el=>el.scrollTop=0);
            await page.locator('#pos-products').evaluate(el=>el.scrollTop=0);
            if (width===1366 && height===768) {
                const products=await page.locator('#pos-products').evaluate(region=>{
                    const bounds=region.getBoundingClientRect();
                    const cards=[...region.querySelectorAll('.pos-card')].filter(card=>!card.hidden).slice(0,6);
                    return cards.map(card=>{
                        const box=card.getBoundingClientRect();
                        const fields=[...card.querySelectorAll('strong,.pos-price,.pos-stock')].map(field=>field.getBoundingClientRect());
                        const padding=parseFloat(getComputedStyle(card).paddingBottom);
                        return {name:card.querySelector('strong').textContent,visible:box.top>=bounds.top-1 && box.bottom<=bounds.bottom+1,contentFits:fields.every(field=>field.top>=box.top-1 && field.bottom<=box.bottom-padding+1)};
                    });
                });
                assert.equal(products.length,6,`${label}: expected two three-item rows`);
                assert.deepEqual(products.filter(product=>!product.visible || !product.contentFits),[],`${label}: product cards or fields are cut off on the normal laptop`);
            }
            await page.screenshot({path: resolve(artifacts, `${label}-${width}x${height}.png`), fullPage: true, animations:'disabled'});
        }
        await setViewport({width: 1440, height: 1000});
        checks.push(`${label}: readable standard/short POS, reachable totals/action, 44px controls and no footer gap PASS`);
    };
    const gateLocked=async label=>{
        const handoff=page.locator('#open-messenger');
        assert.equal(await handoff.getAttribute('href'),null,label+': stale inquiry retains a destination');
        assert.equal(await handoff.getAttribute('aria-disabled'),'true',label+': stale inquiry is enabled');
        assert.equal(await handoff.getAttribute('tabindex'),'-1',label+': locked destination remains in keyboard order');
    };
    const mockCopy=async mode=>{
        await page.evaluate(mode=>{
            if(!navigator.clipboard) Object.defineProperty(navigator,'clipboard',{configurable:true,value:{}});
            Object.defineProperty(navigator.clipboard,'writeText',{configurable:true,value:text=>{
                if(mode==='failure') return Promise.reject(new DOMException('Isolated clipboard denial','NotAllowedError'));
                if(mode==='pending') {
                    const entry={text};
                    entry.promise=new Promise((resolve,reject)=>{
                        entry.resolve=()=>{window.__catalogClipboardText=text;resolve();};
                        entry.reject=()=>reject(new DOMException('Isolated pending clipboard denial','NotAllowedError'));
                    });
                    (window.__catalogPendingCopies ||= []).push(entry);
                    return entry.promise;
                }
                window.__catalogClipboardText=text;
                return Promise.resolve();
            }});
        },mode);
    };
    const copyCurrent=async destination=>{
        await mockCopy('success');
        await page.getByRole('button',{name:'Copy summary',exact:true}).click();
        await page.waitForFunction(()=>document.getElementById('basket-status').textContent.startsWith('Summary copied.'));
        assert.equal(await page.evaluate(()=>window.__catalogClipboardText),await page.locator('#order-summary').inputValue(),'Copied summary differs from current inquiry');
        if(destination) {
            assert.equal(await page.locator('#open-messenger').getAttribute('href'),destination,'Current successful copy did not unlock the correct destination');
            assert.equal(await page.locator('#open-messenger').getAttribute('aria-disabled'),'false');
            assert.equal(await page.locator('#open-messenger').getAttribute('tabindex'),'0');
        } else await gateLocked('Unconfigured successful copy');
    };
    const settleCopy=async (reject=false,index=-1)=>{
        await page.evaluate(async ({reject,index})=>{
            const queue=window.__catalogPendingCopies;
            const pending=queue[index<0 ? queue.length+index : index];
            if(reject) pending.reject(); else pending.resolve();
            await pending.promise.catch(()=>{});
            await Promise.resolve(); await Promise.resolve();
        },{reject,index});
    };
    const floatingCatalog=async()=>{
        const floating=page.locator('#floating-basket');
        const overlaps=(first,second)=>first && second && first.x<second.x+second.width-1 && first.x+first.width>second.x+1 && first.y<second.y+second.height-1 && first.y+first.height>second.y+1;
        for(const width of [375,390,768,1024,1440]) {
            await setViewport({width,height:1000});
            await page.getByRole('button',{name:'Add Black Ballpen to your list',exact:true}).click();
            assert.equal(await page.locator('#floating-basket-count').textContent(),await page.locator('#basket-count').textContent(),'Floating count differs from inquiry count');
            await page.locator('#catalog-toast').waitFor({state:'visible'});
            await page.evaluate(()=>window.scrollTo({top:document.documentElement.scrollHeight,behavior:'instant'}));
            const box=await floating.boundingBox();
            assert.ok(box && box.height>=44 && box.x>=-1 && box.y>=-1 && box.x+box.width<=width+1 && box.y+box.height<=1001,'Floating inquiry control is clipped or too small at '+width);
            const toast=await page.locator('#catalog-toast').boundingBox();
            assert.equal(overlaps(box,toast),false,'Toast covers floating inquiry control at '+width);
            const footerLinks=await page.locator('.site-footer a').evaluateAll(links=>links.map(link=>{const box=link.getBoundingClientRect();return {x:box.x,y:box.y,width:box.width,height:box.height};}));
            assert.ok(footerLinks.every(link=>!overlaps(box,link)),'Floating inquiry control covers footer links at '+width);
            const before=await page.evaluate(()=>scrollY);
            await floating.focus(); await page.keyboard.press('Enter');
            assert.equal(await page.locator('#basket-dialog').evaluate(dialog=>dialog.open),true,'Floating keyboard action did not open inquiry');
            assert.equal(await floating.isVisible(),false,'Floating control remains over the modal');
            assert.ok(Math.abs(await page.evaluate(()=>scrollY)-before)<=1,'Opening floating inquiry moved the main page');
            await page.keyboard.press('Escape');
            await page.waitForFunction(()=>document.activeElement===document.getElementById('floating-basket') && !document.getElementById('floating-basket').hidden);
            assert.ok(Math.abs(await page.evaluate(()=>scrollY)-before)<=1,'Closing floating inquiry moved the main page');
            await page.screenshot({path:resolve(artifacts,'catalog-floating-footer-'+width+'.png'),fullPage:true,animations:'disabled'});
        }
        await floating.click();
        await page.getByLabel('How would you like to receive your order?').selectOption({label:'Nearby delivery · fee confirmed by staff'});
        await copyCurrent(expectedCatalogPage);
        await page.evaluate(()=>localStorage.setItem('catalog-unrelated-test','preserved'));
        await page.locator('#clear-basket').click();
        assert.equal(await page.locator('#clear-basket').isVisible(),true,'Clear action disappeared with empty details');
        assert.equal(await page.locator('#clear-basket').isDisabled(),true,'Empty list leaves clear enabled');
        assert.equal(await page.locator('#basket-empty').isVisible(),true);
        assert.equal(await page.locator('#basket-details').isVisible(),false);
        assert.equal(await page.locator('#floating-basket-count').textContent(),'0');
        assert.equal(await page.locator('#basket-count').textContent(),'0');
        assert.equal(await page.getByLabel('How would you like to receive your order?').inputValue(),'Nearby delivery (fee to be confirmed)','Clear reset fulfillment');
        assert.equal(await page.evaluate(()=>localStorage.getItem('smart-supplies-list-v1')),null,'Clear retained the saved list');
        assert.equal(await page.evaluate(()=>localStorage.getItem('catalog-unrelated-test')),'preserved','Clear removed unrelated browser data');
        await gateLocked('Cleared copied inquiry');
        await page.keyboard.press('Escape');
        await page.reload(); await page.waitForSelector('.product-card');
        assert.equal(await page.locator('#basket-count').textContent(),'0','Cleared list returned after reload');
        assert.equal(await page.evaluate(()=>localStorage.getItem('catalog-unrelated-test')),'preserved');
        checks.push('catalog floating/clear: counts, 44px footer/toast-safe dock, keyboard/modal/scroll restoration at 375/390/768/1024/1440 and list-only persistent clearing PASS');
    };
    const catalogResponse=await page.goto(catalogUrl);
    assert.ok(catalogResponse,'Catalog document response missing.');
    const servedHeaders=await catalogResponse.allHeaders();
    for(const [name,value] of Object.entries(catalogHeaders)) assert.equal(servedHeaders[name],value,`Catalog security header ${name} was not applied.`);
    await page.waitForSelector('.product-card');
    assert.equal(await page.evaluate(async()=>{await document.fonts.ready;return document.fonts.check('16px Inter');}),true,'Local catalog font unavailable');
    assert.equal(await page.locator('.product-card').count(), 12);
    await accessibility('catalog'); await responsive('catalog');
    await page.locator('.basket-button').click();
    assert.equal(await page.locator('#clear-basket').isVisible(),true,'Empty inquiry omits its clear action');
    assert.equal(await page.locator('#clear-basket').isDisabled(),true,'Empty inquiry permits clearing');
    await gateLocked('Initial empty inquiry');
    await page.locator('#close-basket').click();
    await page.waitForFunction(()=>document.activeElement===document.querySelector('.basket-button'));
    await floatingCatalog();
    await setViewport({width:1440,height:1000});
    await page.getByRole('button', { name: 'Writing essentials', exact: true }).click();
    assert.equal(await page.locator('.product-card').count(), 3);
    await page.getByLabel('Search supplies').fill('no-match');
    await page.locator('#catalog-empty').waitFor({state:'visible'});
    await page.getByRole('button', {name:'Show all supplies'}).click();
    await page.getByRole('button', {name:'Add Spiral Notebook to your list', exact:true}).click();
    await page.getByRole('button', {name:'Add Spiral Notebook to your list', exact:true}).click();
    await page.getByRole('button', {name:'Add Black Ballpen to your list', exact:true}).click();
    await page.locator('.basket-button').click();
    assert.equal(await page.locator('#basket-total').textContent(), '₱102.00');
    assert.equal(await page.evaluate(()=>window.STORE_CONFIG.messengerUrl),expectedCatalogPage,'Catalog does not use the approved Facebook Page.');
    assert.equal(await page.evaluate(()=>window.STORE_CONFIG.demo),true,'Public preview lost its sample-data designation.');
    const pageLink=page.locator('#open-messenger');
    await gateLocked('Initial configured inquiry');
    await page.getByRole('button',{name:'Copy summary',exact:true}).focus();
    await page.keyboard.press('Tab');
    assert.equal(await pageLink.evaluate(el=>el===document.activeElement),false,'Locked destination is reachable with Tab');
    await copyCurrent(expectedCatalogPage);
    assert.equal(await pageLink.getAttribute('href'),expectedCatalogPage,'Configured Page URL changed.');
    const pageTarget=new URL(await pageLink.getAttribute('href'));
    assert.equal(pageTarget.pathname,'/profile.php');
    assert.equal(pageTarget.searchParams.get('id'),'61594157431738','Facebook Page ID was not preserved.');
    assert.match(await pageLink.textContent(),/Open Facebook Page/);
    assert.equal(await pageLink.getAttribute('target'),'_blank');
    assert.deepEqual((await pageLink.getAttribute('rel')).split(/\s+/).sort(),['noopener','noreferrer']);
    assert.equal(await page.locator('#messenger-unconfigured').isVisible(),false,'Configured Page still shows missing-link guidance.');
    assert.equal(await page.locator('#demo-badge').isVisible(),true,'Sample catalog label hidden.');
    await page.getByLabel('How would you like to receive your order?').selectOption({label:'Nearby delivery · fee confirmed by staff'});
    assert.match(await page.locator('#order-summary').inputValue(), /Nearby delivery/);
    await gateLocked('Changed fulfillment');
    await copyCurrent(expectedCatalogPage);
    await accessibility('basket');
    await page.getByRole('button',{name:'Increase Spiral Notebook',exact:true}).click();
    await gateLocked('Increased quantity');
    await copyCurrent(expectedCatalogPage);
    await page.getByRole('button',{name:'Decrease Spiral Notebook',exact:true}).click();
    await gateLocked('Decreased quantity');
    await copyCurrent(expectedCatalogPage);
    await page.getByRole('button',{name:'Remove Black Ballpen',exact:true}).click();
    await gateLocked('Removed item');
    await page.keyboard.press('Escape');
    await page.getByRole('button',{name:'Add Black Ballpen to your list',exact:true}).click();
    await page.locator('.basket-button').click();
    await gateLocked('Added item');
    await copyCurrent(expectedCatalogPage);
    await page.keyboard.press('Escape');
    await page.locator('.basket-button').click();
    assert.equal(await pageLink.getAttribute('href'),expectedCatalogPage,'Opening the unchanged inquiry invalidated a current copy');

    // Clipboard is mocked throughout: no host clipboard writes or Meta navigation.
    await mockCopy('pending');
    await page.getByRole('button',{name:'Copy summary',exact:true}).click();
    await gateLocked('New copy pending after successful copy');
    await settleCopy(true);
    await gateLocked('New copy failed after successful copy');
    assert.match(await page.locator('#basket-status').textContent(),/Automatic copying was unavailable.*summary is selected/);
    assert.equal(await page.locator('#order-summary').evaluate(field=>field.readOnly && document.activeElement===field && field.selectionStart===0 && field.selectionEnd===field.value.length),true,'Manual fallback did not select the complete readonly summary');
    await page.locator('#order-summary').evaluate(field=>field.dispatchEvent(new ClipboardEvent('copy',{bubbles:true,cancelable:true,clipboardData:new DataTransfer()})));
    await gateLocked('Synthetic full-selection copy');
    await page.locator('#order-summary').evaluate(field=>{field.setSelectionRange(0,1);field.dispatchEvent(new ClipboardEvent('copy',{bubbles:true,cancelable:true,clipboardData:new DataTransfer()}));});
    await gateLocked('Synthetic partial-selection copy');
    await copyCurrent(expectedCatalogPage);

    for(const rejectOlder of [false,true]) {
        await mockCopy('pending');
        await page.getByRole('button',{name:'Copy summary',exact:true}).click();
        const older=await page.evaluate(()=>window.__catalogPendingCopies.length-1);
        await page.getByRole('button',{name:'Increase Spiral Notebook',exact:true}).click();
        await gateLocked('Inquiry changed during pending copy');
        await page.getByRole('button',{name:'Copy summary',exact:true}).click();
        const newer=await page.evaluate(()=>window.__catalogPendingCopies.length-1);
        await settleCopy(false,newer);
        assert.equal(await pageLink.getAttribute('href'),expectedCatalogPage,'Newer current copy did not unlock destination');
        assert.equal(await page.evaluate(()=>window.__catalogClipboardText),await page.locator('#order-summary').inputValue());
        const currentStatus=await page.locator('#basket-status').textContent();
        const currentFocus=await page.evaluate(()=>document.activeElement.id);
        await settleCopy(rejectOlder,older);
        if(rejectOlder) {
            assert.equal(await pageLink.getAttribute('href'),expectedCatalogPage,'Rejected stale copy invalidated a newer successful copy');
            assert.equal(await page.locator('#basket-status').textContent(),currentStatus,'Rejected stale copy replaced current feedback');
            assert.equal(await page.evaluate(()=>document.activeElement.id),currentFocus,'Rejected stale copy stole keyboard focus');
        } else {
            assert.notEqual(await page.evaluate(()=>window.__catalogClipboardText),await page.locator('#order-summary').inputValue(),'Mock did not reproduce the stale clipboard overwrite');
            await gateLocked('Older successful write after newer successful write');
            assert.match(await page.locator('#basket-status').textContent(),/Copy the current summary again/);
        }
        await page.getByRole('button',{name:'Decrease Spiral Notebook',exact:true}).click();
        await gateLocked('Inquiry restored after asynchronous copy');
        await copyCurrent(expectedCatalogPage);
    }
    checks.push('catalog copy gate: changed fulfillment/items/quantities, keyboard exclusion, retry relock, mocked failure and synthetic-copy rejection PASS; native OS copy NOT RUN');
    checks.push('catalog asynchronous copy: newer success followed by stale success relocks; stale rejection preserves newer success/feedback/focus PASS');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#basket-dialog').evaluate(el => el.open), false);
    await page.reload(); await page.waitForSelector('.product-card');
    assert.equal(await page.locator('#basket-count').textContent(), '3');
    await gateLocked('Reloaded saved inquiry');
    await page.evaluate(() => localStorage.clear());
    // Preserve the deliberately supported blank-link preview state as well.
    await page.route('**/config.js',route=>route.fulfill({contentType:'application/javascript',headers:catalogHeaders,body:"window.STORE_CONFIG={messengerUrl:'',demo:true};"}));
    await page.reload(); await page.waitForSelector('.product-card');
    await page.getByRole('button',{name:'Add Black Ballpen to your list',exact:true}).click();
    await page.locator('.basket-button').click();
    assert.equal(await page.locator('#open-messenger').isVisible(),false,'Blank configuration exposes a Messenger action.');
    assert.equal(await page.locator('#messenger-unconfigured').isVisible(),true,'Blank configuration omits setup guidance.');
    await copyCurrent('');
    await page.keyboard.press('Escape');
    await page.unroute('**/config.js');
    await page.evaluate(()=>localStorage.clear());
    // Configure an inert example link in this test context; never navigate to Meta.
    await page.route('**/config.js', route => route.fulfill({contentType:'application/javascript',headers:catalogHeaders,body:"window.STORE_CONFIG={messengerUrl:'https://m.me/ExamplePage',demo:true};"}));
    await page.reload(); await page.waitForSelector('.product-card');
    await page.getByRole('button', {name:'Add Black Ballpen to your list', exact:true}).click();
    await page.locator('.basket-button').click();
    await gateLocked('Initial Messenger configuration');
    assert.match(await page.locator('#open-messenger').textContent(),/Open Messenger/);
    await copyCurrent('https://m.me/ExamplePage');
    assert.match(await page.locator('#basket-status').textContent(), /Summary copied.*Open Messenger/);
    await page.keyboard.press('Escape');
    await page.unroute('**/config.js');
    await page.route('**/products.json', route => route.fulfill({status:503,headers:catalogHeaders,body:'Unavailable'}));
    await page.reload(); await page.locator('#catalog-error').waitFor({state:'visible'});
    await page.unroute('**/products.json'); await page.getByRole('button', {name:'Try again'}).click(); await page.waitForSelector('.product-card');
    assert.deepEqual(catalogPolicyErrors,[],'Catalog browser rejected assets or code under Cloudflare security headers.');
    assert.deepEqual(forbiddenCatalogRequests,[],'Catalog attempted an external Meta or local staff/private-data request.');
    checks.push('catalog: filtering, empty/error recovery, basket persistence, summary, link and keyboard dialog PASS');
    checks.push('catalog publication: approved Facebook Page/query ID/new-tab safety, blank/m.me configurations, real _headers compatibility and no staff/private/external requests PASS');
    catalogPhase=false;

    await page.goto(`${appUrl}/login`);
    await accessibility('login'); await responsive('login');
    await page.getByLabel('Email address').fill('admin@example.test');
    await page.getByLabel('Password', {exact:true}).fill(password);
    await page.getByRole('button', {name:/Sign in/}).click();
    await page.waitForURL('**/dashboard');
    await accessibility('dashboard'); await responsive('dashboard');
    await sidebarWorkflow('Admin');
    await setViewport({width:1366, height:768});
    await readableScreen('empty dashboard');
    await page.screenshot({path:resolve(artifacts,'dashboard-1366x768.png'),fullPage:true});
    for (const route of ['orders', 'sales']) {
        await page.goto(`${appUrl}/${route}`);
        await page.locator('.empty-cell').waitFor();
        await readableScreen(`empty ${route}`);
        await accessibility(`empty-${route}`);
        await page.screenshot({path:resolve(artifacts,`empty-${route}-1366x768.png`),fullPage:true});
    }
    checks.push('dashboard/orders/sales: readable text and natural page flow at 1366x768 PASS');
    await page.goto(`${appUrl}/cashiers`);
    await accessibility('cashier-accounts'); await responsive('cashier-accounts');
    await page.getByRole('link',{name:/Add cashier/}).click();
    await accessibility('cashier-create'); await responsive('cashier-create');
    await page.locator('#cashier-name').fill('Managed Demo Cashier');
    await page.locator('#cashier-email').fill('initial-cashier@example.test');
    await page.locator('#cashier-password').fill(password);
    await page.locator('#cashier-password-confirmation').fill(password);
    await page.getByRole('button',{name:'Create cashier account',exact:true}).click();
    await page.waitForURL('**/cashiers');
    await page.locator('tr[data-cashier-id]').filter({hasText:'initial-cashier@example.test'}).getByRole('link',{name:'Manage Managed Demo Cashier',exact:true}).click();
    await page.waitForURL(/\/cashiers\/\d+\/edit$/);
    const managedEditUrl=page.url();
    await accessibility('cashier-manage'); await responsive('cashier-manage');
    await page.locator('#cashier-name').fill('Updated Demo Cashier');
    await page.locator('#cashier-email').fill(managedEmail);
    await page.getByRole('button',{name:'Save cashier details',exact:true}).click();
    await page.waitForURL(managedEditUrl);
    assert.equal(await page.locator('#cashier-name').inputValue(),'Updated Demo Cashier');
    const managedContext=await browser.newContext({viewport:{width:390,height:844}});
    try {
        const managedPage=await managedContext.newPage();
        const managedLogin=async secret=>{
            await managedPage.goto(`${appUrl}/login`);
            await managedPage.getByLabel('Email address').fill(managedEmail);
            await managedPage.getByLabel('Password',{exact:true}).fill(secret);
            await managedPage.getByRole('button',{name:/Sign in/}).click();
        };
        await managedLogin(password); await managedPage.waitForURL('**/pos');
        await page.locator('#reset-password').fill(managedPassword);
        await page.locator('#reset-password-confirmation').fill(managedPassword);
        await page.getByRole('button',{name:'Reset password & end sessions',exact:true}).click();
        await page.waitForURL(managedEditUrl);
        await managedPage.goto(`${appUrl}/pos`); await managedPage.waitForURL('**/login');
        await managedLogin(password); await managedPage.getByRole('alert').waitFor();
        assert.match(new URL(managedPage.url()).pathname,/\/login$/,'Reset password did not reject old password');
        await managedLogin(managedPassword); await managedPage.waitForURL('**/pos');
        await page.getByRole('button',{name:'Disable cashier account',exact:true}).click();
        await page.waitForURL(managedEditUrl);
        await managedPage.goto(`${appUrl}/pos`); await managedPage.waitForURL('**/login');
        await managedLogin(managedPassword); await managedPage.getByRole('alert').waitFor();
        assert.match(new URL(managedPage.url()).pathname,/\/login$/,'Disabled cashier could sign in');
        await page.getByRole('button',{name:'Enable cashier account',exact:true}).click();
        await page.waitForURL(managedEditUrl);
        await managedLogin(managedPassword); await managedPage.waitForURL('**/pos');
    } finally { await managedContext.close(); }
    checks.push('cashier accounts: Admin creates/edits/enables/disables, reset rejects old password and ends sessions, disabled sessions lose access PASS');
    assert.equal(await page.getByRole('link',{name:'Point of sale',exact:true}).count(),0,'Admin has a checkout navigation action');
    assert.equal((await page.request.get(`${appUrl}/pos`)).status(),403,'Admin can open POS directly');
    const adminToken=await page.locator('form[action$="/logout"] input[name=_token]').first().inputValue();
    for (const path of ['/sales','/orders']) assert.equal((await page.request.post(appUrl+path,{form:{_token:adminToken},maxRedirects:0})).status(),403,`Admin can submit ${path}`);
    await signout(); await login('cashier');
    assert.equal(await page.getByRole('link',{name:'Inventory',exact:true}).count(),0,'Cashier sees management navigation');
    for (const path of ['/dashboard','/inventory','/cashiers']) assert.equal((await page.request.get(appUrl+path)).status(),403,`Cashier can access ${path}`);
    checks.push('roles: distinct landing pages/navigation, Admin checkout denial and Cashier management denial PASS');
    await sidebarWorkflow('Cashier');
    await accessibility('pos'); await responsive('pos');
    assert.equal(await page.locator('#cash').evaluate(el=>el.closest('.checkout-scroll')===null),true,'Payment must remain outside basket scrolling');
    assert.equal(await page.evaluate(async()=>{await document.fonts.ready;return document.fonts.check('16px Inter');}),true,'Bundled staff font unavailable');
    await retailPos('pos-empty');
    await setViewport({width:1280,height:632});
    assert.equal(await page.locator('#basket-count').textContent(),'0 items');
    const lastProduct = page.locator('.pos-card:not([disabled])').last();
    await lastProduct.focus();
    assert.equal(await lastProduct.evaluate(el => {const field=el.getBoundingClientRect(),region=el.closest('.pos-grid').getBoundingClientRect();return field.top>=region.top && field.bottom<=region.bottom;}),true,'Last product unreachable by keyboard');
    await page.getByRole('button',{name:/Sign out/}).focus();
    const signoutBox = await page.getByRole('button',{name:/Sign out/}).boundingBox();
    assert.ok(signoutBox && signoutBox.y>=0 && signoutBox.y+signoutBox.height<=632,'Short-screen sign out unreachable');
    await readableScreen('short-screen keyboard navigation');
    // Match the submitted image's apparent 150% pixel scale without changing real browser settings.
    const scaledContext = await browser.newContext({storageState:await context.storageState(),viewport:{width:1280,height:632},deviceScaleFactor:1.5});
    try {
        const scaledPage = await scaledContext.newPage();
        await scaledPage.goto(`${appUrl}/pos`);
        await scaledPage.locator('#pos-products .pos-card').first().waitFor();
        assert.equal(await scaledPage.evaluate(() => document.documentElement.scrollWidth<=innerWidth+1),true,'Zoom-equivalent POS overflows horizontally');
        await scaledPage.getByLabel('Cash received (₱)').focus(); const scaledCash=await scaledPage.locator('#cash').boundingBox(); assert.ok(scaledCash && scaledCash.y>=0 && scaledCash.y+scaledCash.height<=632,'Scaled payment control unreachable');
        await scaledPage.screenshot({path:resolve(artifacts,'pos-zoom-equivalent-1920x948.png'),fullPage:true});
    } finally { await scaledContext.close(); }
    await accessibility('pos-short-screen');
    await setViewport({width:1280,height:500});
    const fallback = await page.locator('#checkout-basket').evaluate(panel => ({gap:panel.getBoundingClientRect().bottom-panel.querySelector('.checkout-footer').getBoundingClientRect().bottom,productsHeight:document.getElementById('pos-products').clientHeight}));
    assert.ok(fallback.gap<=2,'Very short window stretches empty basket');
    assert.ok(fallback.productsHeight<=680,'Very short window has unbounded product list');
    await page.getByLabel('Cash received (₱)').focus();
    const fallbackCash = await page.locator('#cash').boundingBox();
    assert.ok(fallbackCash && fallbackCash.y>=0 && fallbackCash.y+fallbackCash.height<=500,'Fallback payment field unreachable');
    await page.screenshot({path:resolve(artifacts,'pos-fallback-1280x500.png'),fullPage:true});
    await setViewport({width:1440,height:1000});
    checks.push('short POS: final product/sign-out keyboard access, zoom-equivalent screenshot and readable fallback PASS');
    await page.locator('[data-product-id]').filter({has:page.getByText('Spiral Notebook', {exact:true})}).click();
    await page.locator('[data-product-id]').filter({has:page.getByText('Spiral Notebook', {exact:true})}).click();
    await page.locator('[data-product-id]').filter({has:page.getByText('Black Ballpen', {exact:true})}).click();
    assert.equal(await page.locator('#basket-count').textContent(),'3 items');
    await page.getByLabel('Order channel').selectOption('messenger');
    await page.getByLabel('Cash received (₱)').fill('100');
    assert.equal(await page.locator('#complete-sale').isDisabled(), true);
    await page.getByLabel('Cash received (₱)').fill('200');
    assert.equal(await page.locator('#cart-change').textContent(), '₱98.00');
    await retailPos('pos-counter');
    await page.locator('[data-product-id]').filter({has:page.getByText('Blue Ballpen',{exact:true})}).click();
    await retailPos('pos-three-lines');
    await page.locator('.cart-line').filter({has:page.getByText('Blue Ballpen',{exact:true})}).getByRole('button',{name:'Remove Blue Ballpen',exact:true}).click();
    await setViewport({width:1280,height:632});
    await page.getByLabel('Payment method',{exact:true}).focus();
    assert.equal(await page.locator('#payment_method').evaluate(el => el === document.activeElement), true);
    await page.keyboard.press('Tab');
    assert.equal(await page.locator('#cash').evaluate(el => el === document.activeElement), true);
    assert.equal(await page.locator('#cash').evaluate(el => {const field=el.getBoundingClientRect();return field.top>=0 && field.bottom<=innerHeight && !el.closest('.checkout-scroll');}),true,'Focused payment input clipped');
    await page.keyboard.press('Tab');
    assert.equal(await page.locator('#complete-sale').evaluate(el => el === document.activeElement), true);
    await setViewport({width:800,height:600});
    await posPane('sale');
    await page.getByLabel('Cash received (₱)').focus();
    await page.keyboard.press('Tab');
    const smallAction = await page.locator('#complete-sale').boundingBox();
    assert.ok(smallAction && smallAction.y >= 0 && smallAction.y + smallAction.height <= 600,'Checkout action unreachable in smaller/zoomed layout');
    await page.screenshot({path:resolve(artifacts,'pos-small-window-800x600.png'),fullPage:true});
    await setViewport({width:1366,height:768});
    for (const selector of ['#payment_method','#cash','#cart-total','#complete-sale']) {
        const box=await page.locator(selector).boundingBox();
        assert.ok(box && box.y>=0 && box.y+box.height<=768,`Laptop cash control ${selector} requires scrolling`);
    }
    checks.push('checkout keyboard: payment field/action visible and smaller-window scrolling PASS');
    const completedReference = await page.locator('[name=reference]').inputValue();
    await page.getByRole('button', {name:/Complete sale/}).click();
    await page.waitForURL('**/receipt');
    assert.match(await page.locator('.receipt').textContent(), /SS-000001/);
    assert.match(await page.locator('.receipt').textContent(), /₱98.00/);
    await accessibility('receipt'); await responsive('receipt');
    await page.emulateMedia({media:'print'});
    assert.ok((await page.locator('.receipt').boundingBox()).width<=303,'Printed receipt exceeds approximately 80mm');
    assert.equal(await page.locator('.sidebar').isVisible(),false,'Navigation appears on printed receipt');
    await page.screenshot({path:resolve(artifacts,'receipt-print.png'),fullPage:true}); await page.emulateMedia({media:'screen'});
    const receiptUrl = page.url();
    const otherContext=await browser.newContext();
    try {
        const otherPage=await otherContext.newPage();
        await otherPage.goto(`${appUrl}/login`);
        await otherPage.getByLabel('Email address').fill(managedEmail);
        await otherPage.getByLabel('Password',{exact:true}).fill(managedPassword);
        await otherPage.getByRole('button',{name:/Sign in/}).click(); await otherPage.waitForURL('**/pos');
        assert.equal((await otherPage.request.get(receiptUrl)).status(),403,'Another cashier can read receipt');
        await otherPage.goto(`${appUrl}/sales`);
        assert.equal(await otherPage.getByText('SS-000001',{exact:true}).count(),0,'Cashier sees another cashier sale');
    } finally { await otherContext.close(); }
    checks.push('cashier history: unrelated receipt and transaction rows remain private PASS');
    await page.goBack(); await page.waitForURL('**/pos');
    await page.waitForFunction(previous => { const reference = document.querySelector('[name=reference]'); return reference && reference.value !== previous; }, completedReference);
    assert.notEqual(await page.locator('[name=reference]').inputValue(), completedReference);
    assert.equal(await page.locator('.cart-line').count(),0);
    await page.goto(receiptUrl);
    await signout(); await login('admin');
    await page.goto(`${appUrl}/inventory`);
    await accessibility('inventory'); await responsive('inventory');
    assert.equal(await page.locator('.inventory-table tbody tr').evaluateAll(rows=>rows.some(row=>!row.textContent.includes('Internal supply · not sold')&&row.querySelector('[data-modal-open^="usage-"]'))),false,'Sellable product/service rows must not expose consumable usage controls');
    await page.getByRole('tab',{name:'Items',exact:true}).focus();
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.getByRole('tab',{name:'Stock movements',exact:true}).getAttribute('aria-selected'),'true');
    assert.equal(await page.locator('#inventory-items').isVisible(),false);
    assert.equal(await page.locator('#inventory-movements').isVisible(),true);
    await accessibility('inventory-movements'); await responsive('inventory-movements');
    await page.getByRole('tab',{name:'Stock movements',exact:true}).focus();
    await page.keyboard.press('Home');
    assert.equal(await page.getByRole('tab',{name:'Items',exact:true}).getAttribute('aria-selected'),'true');
    await setViewport({width:375,height:900});
    assert.equal(await page.locator('.inventory-table tbody tr').first().evaluate(el=>getComputedStyle(el).display),'grid','Mobile inventory does not use item cards');
    await setViewport({width:1440,height:1000});
    checks.push('inventory: keyboard tabs, separate movements view and mobile item cards PASS');
    const notebook = page.locator('table').first().getByRole('row').filter({has:page.getByText('Spiral Notebook',{exact:true})});
    assert.match(await notebook.textContent(), /46/);
    await notebook.getByRole('button',{name:'Restock'}).click();
    const restock = page.locator('dialog[open]');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('dialog[open]').count(),0,'Stock dialog does not close with Escape');
    await notebook.getByRole('button',{name:'Restock'}).click();
    await restock.getByLabel('Quantity received').fill('10');
    await restock.getByLabel('Reason / reference').fill('   ');
    await restock.getByRole('button',{name:'Record restock'}).click();
    await page.locator('dialog[data-modal-reopen][open]').waitFor();
    assert.equal(await restock.getByLabel('Quantity received').inputValue(), '10');
    assert.match(await restock.getByRole('alert').textContent(), /reason/);
    await restock.getByLabel('Reason / reference').fill('Demo delivery');
    await accessibility('restock-dialog');
    await restock.getByRole('button',{name:'Record restock'}).click();
    await page.waitForURL('**/inventory');
    assert.match(await page.locator('table').first().getByRole('row').filter({has:page.getByText('Spiral Notebook',{exact:true})}).textContent(), /56/);
    await page.getByRole('link',{name:'Add item',exact:false}).click();
    await accessibility('item-form'); await responsive('item-form');
    await setViewport({width:1366,height:768});
    await readableScreen('add-item form');
    await page.screenshot({path:resolve(artifacts,'item-form-1366x768.png'),fullPage:true});
    await page.getByLabel('Item name').fill('Demo supply'); await page.getByLabel('SKU',{exact:true}).fill('NB-001'); await page.getByLabel('Category',{exact:true}).fill('Paper'); await page.getByLabel('Selling price (₱)').fill('15.50'); await page.getByLabel('Opening stock (units)').fill('20');
    await page.getByRole('checkbox',{name:/Active/}).uncheck();
    await page.getByRole('button',{name:'Add item',exact:true}).click();
    await page.getByRole('alert').waitFor();
    assert.equal(await page.getByRole('checkbox',{name:/Active/}).isChecked(), false);
    await page.getByLabel('SKU',{exact:true}).fill('DEMO-UI');
    await page.getByRole('button',{name:'Add item',exact:true}).click(); await page.waitForURL('**/inventory');
    await page.getByRole('link',{name:'Sales reports',exact:true}).click();
    await accessibility('sales'); await responsive('sales');
    assert.match(await page.locator('main').textContent(), /₱102.00/);
    // Confirm unpaid delivery, collect verified GCash, then complete fulfillment.
    await signout(); await login('cashier');
    await page.goto(`${appUrl}/pos`);
    await setViewport({width:375,height:900});
    await page.locator('[data-product-id]').filter({has:page.getByText('Spiral Notebook',{exact:true})}).click();
    await page.locator('[data-product-id]').filter({has:page.getByText('Black & White Printing · page',{exact:true})}).click();
    await page.locator('.mobile-basket-bar').click();
    await page.getByLabel('Quantity of Black & White Printing · page').fill('2');
    await page.getByLabel('Quantity of Black & White Printing · page').dispatchEvent('change');
    assert.match(await page.locator('#mobile-basket-count').textContent(), /3 items/);
    assert.equal(await page.locator('#pos-app').getAttribute('data-active-panel'),'sale','Phone basket did not open Current sale');
    await page.getByLabel('Fulfillment',{exact:true}).selectOption('delivery');
    await page.locator('#edit-order-details').click();
    await page.getByLabel('When is payment collected?').selectOption('cod');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#edit-order-details').evaluate(el=>el===document.activeElement),true,'Order dialog Escape does not restore focus');
    await posPane('sale');
    await page.getByRole('button',{name:/Confirm order/}).click();
    assert.equal(await page.locator('#order-details-dialog').evaluate(el=>el.open),true,'Missing required customer details do not reopen the dialog');
    await accessibility('order-details-dialog');
    await page.getByLabel('Customer name',{exact:true}).fill('Demo Delivery Customer');
    await page.getByLabel('Contact number',{exact:true}).fill('09123456789');
    await page.getByLabel('Delivery address',{exact:true}).fill('Demo school gate');
    await page.getByLabel('Delivery fee (₱)').fill('20');
    await page.getByLabel('Preparation / delivery notes').fill('Demo printing instructions');
    await page.getByLabel('When is payment collected?').selectOption('cod');
    await page.getByRole('button',{name:'Use these details',exact:true}).click();
    await posPane('products');
    assert.equal(await page.locator('#product-browser').isVisible(),true,'Phone could not return to products');
    await posPane('sale');
    assert.equal(await page.getByLabel('Quantity of Spiral Notebook',{exact:true}).inputValue(),'1','Changing pane lost basket');
    assert.equal(await page.getByLabel('Quantity of Black & White Printing · page',{exact:true}).inputValue(),'2','Changing pane lost service quantity');
    await page.locator('#edit-order-details').click();
    assert.equal(await page.getByLabel('Delivery address',{exact:true}).inputValue(),'Demo school gate','Changing pane lost delivery details');
    await page.keyboard.press('Escape');
    await posPane('sale');
    assert.equal(await page.locator('#cart-total').textContent(),'₱71.00');
    assert.equal(await page.locator('#cash').isDisabled(),true);
    await accessibility('delivery-checkout'); await responsive('delivery-checkout');
    await retailPos('pos-delivery');
    await setViewport({width:1366,height:768});
    await page.locator('#complete-sale').focus();
    assert.equal(await page.locator('#complete-sale').evaluate(el => el === document.activeElement),true);
    await page.locator('#edit-order-details').click();
    await page.getByLabel('Customer name',{exact:true}).fill('   ');
    await page.getByRole('button',{name:'Use these details',exact:true}).click();
    await page.getByRole('button',{name:/Confirm order/}).click();
    await page.locator('#order-details-dialog[data-modal-reopen][open]').waitFor();
    assert.equal(await page.getByLabel('Delivery address',{exact:true}).inputValue(),'Demo school gate','Rejected delivery details were lost');
    await page.getByLabel('Customer name',{exact:true}).fill('Demo Delivery Customer');
    await page.getByRole('button',{name:'Use these details',exact:true}).click();
    checks.push('order details: Escape/focus return, required-field dialog reopening and server validation recovery PASS');
    await page.getByRole('button',{name:/Confirm order/}).click();
    await page.waitForURL(/\/orders\/\d+$/);
    const orderUrl = page.url();
    const reviewContext=await browser.newContext({viewport:{width:768,height:1000}});
    try {
        const review=await reviewContext.newPage();
        await review.goto(`${appUrl}/login`);
        await review.getByLabel('Email address').fill('admin@example.test');
        await review.getByLabel('Password',{exact:true}).fill(password);
        await review.getByRole('button',{name:/Sign in/}).click(); await review.waitForURL('**/dashboard');
        await review.goto(orderUrl);
        for (const name of ['Edit order','New order','Mark ready','Send out for delivery','Record payment','Cancel order']) {
            assert.equal(await review.getByRole('link',{name,exact:true}).count()+await review.getByRole('button',{name,exact:true}).count(),0,`Admin review exposes ${name}`);
        }
        assert.equal(await review.locator('form[action*="/orders/"]').count(),0,'Admin review includes mutation forms');
        assert.match(await review.locator('[aria-current=step]').textContent(),/Preparing/);
        for (const width of [375,390,768,1024]) {
            await review.setViewportSize({width,height:1000});
            assert.equal(await review.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,`Admin order review overflows ${width}px`);
            await review.screenshot({path:resolve(artifacts,`admin-order-review-${width}.png`),fullPage:true,animations:'disabled'});
        }
        const reviewAxe=await new AxeBuilder({page:review}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze();
        assert.deepEqual(reviewAxe.violations.map(v=>v.id),[],'Admin order review accessibility violations');
        checks.push('admin-order-review: axe PASS');
    } finally { await reviewContext.close(); }
    checks.push('Admin order review: read-only progress/customer data at mobile/tablet widths; no checkout/edit/status/payment forms PASS');
    await accessibility('order-detail'); await responsive('order-detail');
    assert.match(await page.locator('main').textContent(), /Unpaid/);
    assert.match(await page.locator('[aria-current=step]').textContent(),/Preparing/);
    assert.equal(await page.locator('.page-heading').getByRole('link',{name:'Edit order',exact:true}).count(),1,'Edit action is not in the detail header');
    await page.locator('.order-progress').getByRole('link',{name:/Next step/}).click();
    assert.equal(await page.locator('#order-next-action').evaluate(panel=>panel===document.activeElement),true,'Next step shortcut does not focus its target');
    await page.getByRole('link',{name:'Back to orders',exact:true}).click();
    const orderId=new URL(orderUrl).pathname.split('/').pop();
    const orderRow=page.locator(`[data-order-id="${orderId}"]`);
    for(const width of [1440,768,375]) {
        await setViewport({width,height:1000});
        const actions=orderRow.locator('.order-row-actions'); await actions.scrollIntoViewIfNeeded();
        const controls=await actions.locator('a').evaluateAll(links=>links.map(link=>{const box=link.getBoundingClientRect();return {label:link.textContent,height:box.height,inside:box.left>=0 && box.right<=innerWidth+1};}));
        assert.equal(controls.length,2,'Eligible order lacks View/Edit buttons');
        assert.ok(controls.every(control=>control.height>=44 && control.inside),'Order actions clipped or too small');
        if(width===375) assert.equal(await orderRow.evaluate(row=>getComputedStyle(row).display),'grid','Phone orders do not use cards');
        await page.screenshot({path:resolve(artifacts,`active-orders-${width}.png`),fullPage:true,animations:'disabled'});
    }
    await orderRow.getByRole('link',{name:/View order/}).click(); await page.waitForURL(orderUrl);
    await page.getByRole('link',{name:'Back to orders',exact:true}).click();
    await orderRow.getByRole('link',{name:/Edit order/}).click();
    checks.push('order actions: explicit View/Edit links navigate correctly and remain visible at desktop/tablet/phone widths PASS');
    await accessibility('unpaid-order-edit'); await responsive('unpaid-order-edit');
    await page.getByLabel('Customer name',{exact:true}).fill('Updated Demo Delivery Customer');
    await page.getByLabel('Delivery address',{exact:true}).fill('Updated demo school gate');
    await page.getByLabel('Delivery fee (₱)',{exact:true}).fill('25');
    await page.getByLabel('Add an item',{exact:true}).selectOption({label:'Black Ballpen · ₱12.00'});
    await page.getByRole('button',{name:'Add item',exact:false}).click();
    assert.equal(await page.getByLabel('Quantity of Black Ballpen',{exact:true}).inputValue(),'1');
    await page.getByRole('button',{name:'Remove Black Ballpen from order',exact:true}).click();
    await page.getByLabel('Quantity of Spiral Notebook',{exact:true}).fill('999');
    await page.getByRole('button',{name:'Save changes',exact:true}).click();
    await page.getByRole('alert').waitFor();
    assert.match(await page.getByRole('alert').textContent(),/Insufficient available stock/);
    assert.equal(await page.getByLabel('Delivery address',{exact:true}).inputValue(),'Updated demo school gate');
    assert.equal(await page.getByLabel('Delivery fee (₱)',{exact:true}).inputValue(),'25');
    await page.getByLabel('Quantity of Spiral Notebook',{exact:true}).fill('2');
    await page.getByRole('button',{name:'Save changes',exact:true}).click();
    await page.waitForURL(orderUrl);
    assert.match(await page.locator('.order-summary').textContent(),/₱121.00/);
    await page.getByRole('link',{name:/Edit order/}).click();
    await page.getByLabel('Quantity of Spiral Notebook',{exact:true}).fill('1');
    await page.getByLabel('Delivery fee (₱)',{exact:true}).fill('20');
    await page.getByRole('button',{name:'Save changes',exact:true}).click();
    await page.waitForURL(orderUrl);
    assert.match(await page.locator('.order-summary').textContent(),/₱71.00/);
    checks.push('unpaid order edit: add/remove controls, shortage rollback/recovery, retained details and recalculated totals PASS');
    await page.getByRole('button',{name:'Mark ready',exact:true}).click();
    assert.match(await page.locator('[aria-current=step]').textContent(),/Ready/);
    await page.getByRole('button',{name:'Send out for delivery',exact:true}).click();
    assert.match(await page.locator('[aria-current=step]').textContent(),/Out for delivery/);
    assert.equal(await page.getByRole('link',{name:/Edit order/}).count(),0,'Dispatched order exposes editing');
    assert.equal(await page.getByRole('button',{name:'Mark delivered',exact:true}).isDisabled(),true);
    await page.getByLabel('Payment method',{exact:true}).selectOption('gcash');
    await page.getByLabel('Verified GCash amount (₱)').fill('71');
    await page.getByLabel('GCash transaction reference').fill(' demo-gcash-0001 ');
    await page.getByRole('checkbox',{name:/I verified this payment/}).check();
    assert.equal(await page.getByLabel('GCash transaction reference').inputValue(), 'DEMO-GCASH-0001');
    await accessibility('gcash-collection');
    await page.getByRole('button',{name:'Record payment',exact:true}).click();
    await page.waitForURL(orderUrl);
    await page.getByRole('button',{name:'Mark delivered',exact:true}).click();
    assert.equal(await page.locator('.page-heading .badge.positive').getByText('Delivered',{exact:true}).count(),1);
    assert.match(await page.locator('[aria-current=step]').textContent(),/Delivered/);
    await page.getByRole('link',{name:/View paid receipt/}).click();
    await page.waitForURL('**/receipt');
    assert.match(await page.locator('.receipt').textContent(), /GCash/);
    assert.match(await page.locator('.receipt').textContent(), /Delivery fee/);
    assert.equal(await page.locator('.receipt').getByText('Change',{exact:true}).count(),0);
    await accessibility('gcash-receipt'); await responsive('gcash-receipt');
    await page.getByRole('link',{name:'Orders & delivery',exact:true}).click();
    await accessibility('orders'); await responsive('orders');
    assert.match(await page.locator('main').textContent(),/Delivered/);
    assert.equal(await page.locator(`[data-order-id="${orderId}"]`).getByRole('link',{name:/Edit order/}).count(),0,'Completed order exposes an edit link');
    await page.getByText('How pickup & delivery orders work',{exact:true}).focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('.order-help').evaluate(help=>help.open),true,'Order guide does not open with keyboard');
    await accessibility('order-guide');
    await page.getByText('How pickup & delivery orders work',{exact:true}).focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('.order-help').evaluate(help=>help.open),false,'Order guide does not close with keyboard');
    // Prepaid pickup preserves exact GCash totals and ignores delivery fields.
    await page.getByRole('link',{name:/New order/}).click();
    assert.equal(await page.getByLabel('Fulfillment',{exact:true}).inputValue(),'pickup');
    await page.locator('[data-product-id]').filter({has:page.getByText('Black Ballpen',{exact:true})}).click();
    await page.getByLabel('Fulfillment',{exact:true}).selectOption('pickup');
    await page.locator('#edit-order-details').click();
    await page.getByLabel('Customer name',{exact:true}).fill('Demo Pickup Customer');
    await page.getByLabel('Contact number',{exact:true}).fill('09123456789');
    await page.getByRole('button',{name:'Use these details',exact:true}).click();
    await page.getByLabel('Payment method',{exact:true}).selectOption('gcash');
    await page.getByLabel('Verified GCash amount (₱)').fill('12');
    await page.getByLabel('GCash transaction reference').fill('DEMO-GCASH-0001');
    await page.getByRole('checkbox',{name:/I verified this payment/}).check();
    for (const width of [375,390,768]) {
        await setViewport({width,height:1000});
        await posPane('products');
        assert.equal(await page.locator('#checkout-basket').isVisible(),false,'Product pane does not hide checkout on narrow screen');
        await page.locator('#pos-products-tab').focus(); await page.keyboard.press('ArrowRight');
        assert.equal(await page.locator('#pos-sale-tab').getAttribute('aria-selected'),'true','POS tabs do not support arrow keys');
        assert.equal(await page.locator('#product-browser').isVisible(),false,'Sale pane does not hide products on narrow screen');
        assert.equal(await page.getByLabel('Verified GCash amount (₱)').inputValue(),'12','Changing pane lost GCash amount');
        assert.equal(await page.getByLabel('GCash transaction reference').inputValue(),'DEMO-GCASH-0001','Changing pane lost GCash reference');
        assert.equal(await page.getByRole('checkbox',{name:/I verified this payment/}).isChecked(),true,'Changing pane lost verification');
        assert.equal(await page.getByLabel('Quantity of Black Ballpen',{exact:true}).inputValue(),'1','Changing pane lost basket quantity');
        await page.locator('#edit-order-details').click();
        assert.equal(await page.getByLabel('Customer name',{exact:true}).inputValue(),'Demo Pickup Customer','Changing pane lost customer');
        await page.keyboard.press('Escape');
    }
    checks.push('mobile/tablet POS: Products/Current sale preserves basket quantities, customer/delivery details, GCash amount/reference and verification PASS');
    assert.equal(await page.locator('#complete-sale').isDisabled(),false);
    await setViewport({width:1366,height:768});
    await page.evaluate(()=>window.scrollTo(0,0));
    for (const selector of ['#payment_method','#cash','#payment_reference','[name=payment_verified]','#cart-total','#complete-sale']) {
        const box=await page.locator(selector).boundingBox();
        assert.ok(box && box.y>=0 && box.y+box.height<=768,`Laptop GCash control ${selector} requires scrolling`);
    }
    assert.equal(await page.locator('#payment_reference').evaluate(el=>!el.closest('.checkout-scroll')),true);
    await accessibility('prepaid-checkout');
    await retailPos('pos-gcash');
    await page.getByRole('button',{name:/Confirm order/}).click();
    await page.getByRole('alert').waitFor();
    assert.match(await page.getByRole('alert').textContent(), /reference/);
    assert.equal(await page.getByLabel('Fulfillment',{exact:true}).inputValue(),'pickup');
    assert.equal(await page.getByLabel('Quantity of Black Ballpen').inputValue(),'1');
    await setViewport({width:1024,height:560});
    await page.getByLabel('GCash transaction reference').focus();
    const recovery = await page.getByLabel('GCash transaction reference').evaluate(el => {const field=el.getBoundingClientRect();return field.top>=0 && field.bottom<=innerHeight && !el.closest('.checkout-scroll');});
    assert.equal(recovery,true,'Short-screen validation correction is clipped');
    await page.locator('#complete-sale').focus();
    const recoveryAction = await page.locator('#complete-sale').boundingBox();
    assert.ok(recoveryAction && recoveryAction.y>=0 && recoveryAction.y+recoveryAction.height<=560,'Validation recovery action unreachable');
    await page.screenshot({path:resolve(artifacts,'pos-validation-recovery-1024x560.png'),fullPage:true});
    await setViewport({width:1440,height:1000});
    checks.push('short-screen GCash validation recovery: correction field and submit reachable PASS');
    await page.getByLabel('GCash transaction reference').fill('DEMO-GCASH-0002');
    await page.getByRole('button',{name:/Confirm order/}).click();
    await page.waitForURL(/\/orders\/\d+$/);
    assert.match(await page.locator('main').textContent(),/Paid via GCash/);
    const paidPickupUrl=page.url();
    await page.getByRole('link',{name:/Edit order/}).click();
    await accessibility('paid-order-edit'); await responsive('paid-order-edit');
    assert.equal(await page.locator('#edit-fee').count(),0);
    assert.equal(await page.locator('#add-order-item').count(),0);
    await page.getByLabel('Preparation / delivery notes',{exact:true}).fill('Updated demo pickup instructions');
    await page.getByRole('button',{name:'Save changes',exact:true}).click();
    await page.waitForURL(paidPickupUrl);
    assert.match(await page.locator('.order-summary').textContent(),/₱12.00/);
    checks.push('paid order edit: customer notes saved with items, fee and paid total fixed PASS');
    await page.getByRole('button',{name:'Mark ready',exact:true}).click();
    await page.getByRole('button',{name:'Mark picked up',exact:true}).click();
    // Cancel a separate unpaid pickup and release its reservation.
    await page.goto(`${appUrl}/pos`);
    await page.locator('[data-product-id]').filter({has:page.getByText('Spiral Notebook',{exact:true})}).click();
    await page.getByLabel('Fulfillment',{exact:true}).selectOption('pickup');
    await page.locator('#edit-order-details').click();
    await page.getByLabel('Customer name',{exact:true}).fill('Demo Cancelled Customer');
    await page.getByLabel('Contact number',{exact:true}).fill('09123456789');
    await page.getByLabel('When is payment collected?').selectOption('cod');
    await page.getByRole('button',{name:'Use these details',exact:true}).click();
    await page.getByRole('button',{name:/Confirm order/}).click();
    await page.waitForURL(/\/orders\/\d+$/);
    await page.getByLabel('Cancellation reason').fill('Demo cancellation');
    await page.getByRole('button',{name:'Cancel order',exact:true}).click();
    assert.match(await page.locator('main').textContent(),/reservation was released/);
    // Admin records actual internal supply usage, with no supply in POS.
    await signout(); await login('admin');
    await page.goto(`${appUrl}/inventory`);
    await page.getByRole('link',{name:/Add item/}).click();
    await page.getByLabel('Item name').fill('Demo printing paper');
    await page.getByLabel('SKU',{exact:true}).fill('DEMO-INTERNAL');
    await page.getByLabel('Category',{exact:true}).fill('Printing supplies');
    await page.getByLabel('Item type').selectOption('consumable');
    await page.getByLabel('Selling price (₱)').fill('0');
    await page.getByLabel('Opening stock (units)').fill('50');
    await page.getByRole('button',{name:'Add item',exact:true}).click();
    await page.waitForURL('**/inventory');
    await page.getByLabel('Search inventory',{exact:true}).fill('Demo printing paper');
    await page.getByRole('button',{name:'Apply filters',exact:true}).click();
    const internal = page.locator('table').first().getByRole('row').filter({has:page.getByText('Demo printing paper',{exact:true})});
    await internal.getByRole('button',{name:'Record usage',exact:true}).click();
    const usage = page.locator('dialog[open]');
    // Exercise server rejection/recovery even if a stale client permits excess units.
    await usage.getByLabel('Quantity used').evaluate(el => el.max = '999');
    await usage.getByLabel('Quantity used').fill('51');
    await usage.getByLabel('Usage reason').fill('Demo printing job');
    await usage.getByRole('button',{name:'Record usage',exact:true}).click();
    await page.locator('dialog[data-modal-reopen][open]').waitFor();
    assert.equal(await usage.getByLabel('Quantity used').inputValue(),'51');
    assert.equal(await usage.getByLabel('Usage reason').inputValue(),'Demo printing job');
    assert.match(await usage.getByRole('alert').textContent(), /exceeds available/);
    await usage.getByLabel('Quantity used').fill('10');
    await usage.getByLabel('Usage reason').fill('Demo printing job');
    await accessibility('usage-dialog');
    const usageValidity = await usage.locator('form').evaluate(form => ({valid:form.checkValidity(),invalid:[...form.elements].filter(input => input.willValidate && !input.validity.valid).map(input => ({name:input.name,message:input.validationMessage}))}));
    assert.equal(usageValidity.valid,true,JSON.stringify(usageValidity.invalid));
    await usage.getByRole('button',{name:'Record usage',exact:true}).click();
    if (await page.getByRole('alert').count()) throw new Error('Isolated usage form rejected: ' + await page.getByRole('alert').textContent());
    await page.waitForURL('**/inventory');
    await page.getByLabel('Search inventory',{exact:true}).fill('Demo printing paper');
    await page.getByRole('button',{name:'Apply filters',exact:true}).click();
    assert.match(await page.locator('table').first().textContent(),/40 available/);
    await signout(); await login('cashier');
    await page.goto(`${appUrl}/pos`);
    assert.equal(await page.getByText('Demo printing paper',{exact:true}).count(),0);
    await page.goto(`${appUrl}/sales`);
    assert.match(await page.locator('.payment-strip').textContent(),/₱83.00/);
    assert.equal(await page.locator('table .payment-badge').getByText('GCash',{exact:true}).count(),2);
    checks.push('orders: COD reservation, delivery steps, verified GCash collection, prepaid pickup, unpaid cancellation and supply usage PASS');
    await setViewport({width:768,height:1000});
    await signout();
    checks.push('regressions: new-order mode, unchecked active state, reopened movement forms, GCash error recovery, reference normalization, payment rows and tablet sign-out PASS');
    checks.push('store: separate Admin/Cashier login/logout, mixed sale totals, receipt/print, stock deduction, restock and item creation PASS');
    // Populate one historical Admin-origin order only after existing empty-list
    // and transaction assertions; production still forbids Admin order creation.
    const legacy=fixtureAction('legacy-order');
    const legacyUrl=`${appUrl}/orders/${legacy.id}`;
    await login('cashier');
    assert.equal((await page.request.get(legacyUrl)).status(),403,'Unassigned cashier can access legacy order');
    await page.goto(`${appUrl}/orders`);
    assert.equal(await page.locator(`[data-order-id="${legacy.id}"]`).count(),0,'Unassigned legacy order appears in cashier list');
    await signout(); await login('admin');
    await page.goto(`${appUrl}/orders`);
    await page.locator(`[data-order-id="${legacy.id}"]`).getByRole('link',{name:/Hand off order/}).click();
    assert.equal(new URL(page.url()).hash,'#order-handoff','Legacy handoff list action did not reach assignment panel');
    const assignment=page.locator('#assigned-cashier');
    assert.equal(await assignment.getAttribute('required'),'','Assignment does not require a cashier');
    assert.equal(await assignment.inputValue(),'','Legacy order unexpectedly already assigned');
    assert.equal(await assignment.locator('option').filter({hasText:'Disabled Handoff Demo'}).count(),0,'Disabled cashier offered for assignment');
    await page.getByRole('button',{name:'Hand off order',exact:true}).click();
    assert.equal(await assignment.evaluate(select=>select.validity.valueMissing),true,'Blank assignment bypasses browser validation');
    assert.equal(fixtureAction('inspect-handoff',legacy.id).assigned_cashier_id,null,'Blank assignment changed legacy order');
    await accessibility('admin-order-handoff'); await responsive('admin-order-handoff');
    await assignment.selectOption(String(legacy.cashier_id));
    await page.getByRole('button',{name:'Hand off order',exact:true}).click();
    await page.waitForURL(legacyUrl);
    assert.match(await page.locator('#order-handoff').textContent(),/Demo Cashier/,'Assignment feedback omits selected cashier');
    const handed=fixtureAction('inspect-handoff',legacy.id);
    assert.equal(handed.creator_id,legacy.creator_id,'Handoff changed original recorder');
    assert.equal(handed.assigned_cashier_id,legacy.cashier_id,'Wrong cashier received order');
    assert.equal(handed.assigned_by,legacy.creator_id,'Handoff actor was not Admin');
    assert.equal(handed.assigned_at,true,'Handoff timestamp missing');
    assert.equal(handed.status,'ready','Handoff changed fulfillment status');
    assert.equal(handed.total_cents,legacy.total_cents,'Handoff repriced order');
    assert.equal(handed.snapshot_price,legacy.price_cents,'Handoff altered frozen price');
    assert.equal(handed.stock,legacy.stock_before,'Handoff deducted stock');
    assert.equal(handed.reserved,legacy.reserved_before+1,'Handoff changed reservation');
    for (const name of ['Edit order','Mark ready','Send out for delivery','Record payment','Cancel order']) {
        assert.equal(await page.getByRole('link',{name,exact:true}).count()+await page.getByRole('button',{name,exact:true}).count(),0,`Admin handoff exposes ${name}`);
    }
    await accessibility('admin-handed-off-order'); await responsive('admin-handed-off-order');
    await signout(); await login('cashier');
    await page.goto(`${appUrl}/orders`);
    const assignedRow=page.locator(`[data-order-id="${legacy.id}"]`);
    await assignedRow.getByRole('link',{name:/View order/}).click(); await page.waitForURL(legacyUrl);
    assert.match(await page.locator('main').textContent(),/Legacy Admin Demo/,'Assigned order inaccessible to cashier');
    await accessibility('cashier-assigned-order'); await responsive('cashier-assigned-order');
    await page.getByRole('button',{name:'Send out for delivery',exact:true}).click();
    await page.getByLabel('Payment method',{exact:true}).selectOption('cash');
    await page.getByLabel('Cash received (₱)',{exact:true}).fill((legacy.total_cents/100+10).toFixed(2));
    await page.getByRole('button',{name:'Record payment',exact:true}).click(); await page.waitForURL(legacyUrl);
    await page.getByRole('button',{name:'Mark delivered',exact:true}).click();
    assert.match(await page.locator('[aria-current=step]').textContent(),/Delivered/,'Assigned cashier could not complete order');
    await page.getByRole('link',{name:/View paid receipt/}).click(); await page.waitForURL('**/receipt');
    assert.match(await page.locator('.receipt').textContent(),/Legacy Notebook snapshot/,'Receipt lost historical item snapshot');
    assert.match(await page.locator('.receipt').textContent(),/Demo Admin/,'Receipt lost original recorder');
    assert.match(await page.locator('.receipt').textContent(),/Demo Cashier/,'Receipt lost payment collector');
    const collected=fixtureAction('inspect-handoff',legacy.id);
    assert.equal(collected.creator_id,legacy.creator_id);
    assert.equal(collected.paid_by,legacy.cashier_id);
    assert.equal(collected.sale_creator_id,legacy.creator_id);
    assert.equal(collected.sale_count,1,'Assigned collection produced duplicate sales');
    assert.equal(collected.sale_total_cents,legacy.total_cents,'Assigned collection used current product price');
    assert.equal(collected.stock,legacy.stock_before-1,'Assigned collection did not deduct exactly once');
    assert.equal(collected.reserved,legacy.reserved_before,'Assigned collection did not release exactly its reservation');
    await accessibility('assigned-order-receipt'); await responsive('assigned-order-receipt');
    await signout(); await login('admin'); await page.goto(legacyUrl);
    assert.equal(await page.locator('#order-handoff form').count(),0,'Completed order permits reassignment');
    assert.equal(await page.getByRole('button',{name:'Record payment',exact:true}).count(),0,'Admin can collect on completed legacy order');
    await signout();
    checks.push('legacy Admin orders: required active-cashier handoff, assignment-only Admin controls, assigned cashier visibility/payment/delivery, frozen snapshots and one stock deduction PASS');
    assert.ok(fonts.some(font=>font.url.startsWith(catalogUrl+'/') && font.status===200),'Catalog font did not load locally');
    assert.ok(fonts.some(font=>font.url.startsWith(appUrl+'/') && font.status===200),'Staff font did not load locally');
    assert.ok(fonts.every(font=>font.url.startsWith(catalogUrl+'/') || font.url.startsWith(appUrl+'/')),'UI requested a remote font');
    checks.push('typography: catalog and staff fonts load from their own local server, without a font CDN PASS');
    assert.deepEqual(errors, [], 'Browser JavaScript errors');
    writeFileSync(resolve(artifacts,'ui-results.json'), JSON.stringify({status:'PASS',checks,consoleErrors:errors},null,2));
    console.log(checks.join('\n'));
    console.log('UI verification PASS. Screenshots and results: artifacts/');
} finally {
    if (browser) await browser.close();
    for (const server of servers) server.kill();
    for (const suffix of ['', '-wal', '-shm', '-journal']) rmSync(database + suffix, { force: true });
}
