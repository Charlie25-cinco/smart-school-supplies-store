import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { createServer } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const app = resolve(root, 'store-app');
const artifacts = resolve(root, 'artifacts');
const runtime = resolve(root, '.runtime', 'qa-artisan');
mkdirSync(artifacts, { recursive: true });
const database = resolve(artifacts, 'lan-test.sqlite');
assert.equal(dirname(database), artifacts);
for (const suffix of ['', '-wal', '-shm', '-journal']) rmSync(database + suffix, { force: true });
writeFileSync(database, '');
const views = resolve(artifacts, 'lan-views');
mkdirSync(views, { recursive: true });
const password = randomBytes(24).toString('hex');
const env = {
    ...process.env, APP_ENV: 'testing', APP_DEBUG: 'false',
    APP_KEY: 'base64:' + randomBytes(32).toString('base64'), APP_CONFIG_CACHE: resolve(artifacts, 'absent-lan-config.php'),
    DB_CONNECTION: 'sqlite', DB_DATABASE: database, DB_URL: '', CACHE_STORE: 'array',
    SESSION_DRIVER: 'database', VIEW_COMPILED_PATH: views, UI_PASSWORD: password,
};
const run = (command, args, cwd = root) => new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd, env, windowsHide: true });
    let output = '';
    child.stdout.on('data', chunk => output += chunk);
    // Do not print native errors or application logs containing sensitive data.
    child.stderr.on('data', () => {});
    child.on('error', reject);
    // Windows background descendants can retain pipe handles after PowerShell exits.
    child.on('exit', code => {
        child.stdout.destroy();
        child.stderr.destroy();
        child.stdin.destroy();
        code === 0 ? resolveRun(output) : reject(new Error('Verification subprocess failed: ' + command));
    });
});
const ps = script => ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', resolve(root, 'scripts', script)];
const launch = (script, args = []) => run('powershell.exe', [...ps(script), '-RuntimeDirectory', runtime, ...args]);
const port = await new Promise((resolvePort, reject) => {
    const server = createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => { const value = server.address().port; server.close(() => resolvePort(value)); });
});
const url = 'http://127.0.0.1:' + port;
let browser, started = false;
const checks = [];
try {
    await run(process.env.PHP_EXECUTABLE || 'php', [resolve(root, 'scripts/local-server-fixture.php')], app);
    await launch('Start-Store.ps1', ['-Port', String(port)]);
    started = true;
    const get = path => new Promise((resolveGet, reject) => {
        const request = http.get(url + path, response => {
            let body = '';
            response.on('data', chunk => body += chunk);
            response.on('end', () => resolveGet({ status: response.statusCode, body, headers: response.headers }));
        });
        request.setTimeout(10000, () => request.destroy(new Error('HTTP request timed out')));
        request.on('error', reject);
    });
    assert.equal((await get('/login')).status, 200);
    assert.equal((await get('/pos')).status, 302);
    for (const path of ['/.env', '/.git/config', '/database/database.sqlite', '/storage/logs/laravel.log', '/%2e%2e/.env']) {
        const response = await get(path);
        assert.ok([400, 403, 404].includes(response.status), 'Protected path was exposed: ' + path);
        assert.ok(!response.body.includes('APP_KEY='));
    }
    checks.push('Artisan HTTP server responded; protected files blocked');
    const { chromium } = await import(pathToFileURL(resolve(app, 'node_modules/playwright/index.mjs')).href);
    const executablePath = process.env.BROWSER_EXECUTABLE || ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
    assert.ok(executablePath, 'Installed Edge or Chrome is required');
    browser = await chromium.launch({ executablePath, headless: true });
    const contexts = await Promise.all([1, 2].map(() => browser.newContext()));
    const pages = await Promise.all(contexts.map(context => context.newPage()));
    const errors = [];
    for (const page of pages) page.on('pageerror', error => errors.push(error.message));
    await Promise.all(pages.map(async (page, index) => {
        await page.goto(url + '/login');
        await page.getByLabel('Email address').fill((index ? 'two' : 'one') + '@example.test');
        await page.getByLabel('Password', { exact: true }).fill(password);
        await page.getByRole('button', { name: /Sign in/ }).click();
        await page.waitForURL('**/pos');
        assert.equal((await page.request.get(url + '/inventory')).status(), 403);
        const cookies = (await contexts[index].cookies()).filter(cookie => /[-_]session$/.test(cookie.name));
        assert.equal(cookies.length, 1);
        assert.ok(cookies.every(cookie => !cookie.secure && cookie.httpOnly));
    }));
    const select = async (page, name, reference) => {
        await page.goto(url + '/pos');
        await page.locator('[data-product-id]').filter({ has: page.getByText(name, { exact: true }) }).click();
        await page.locator('#cash').fill('100');
        if (reference) await page.locator('[name=reference]').evaluate((input, value) => { input.value = value; }, reference);
    };
    await Promise.all(pages.map(page => select(page, 'Spiral Notebook')));
    await Promise.all(pages.map(page => page.locator('#complete-sale').click()));
    await Promise.all(pages.map(page => page.waitForURL('**/receipt')));
    checks.push('Two independent cashier sessions submitted concurrent requests against one SQLite database');
    await Promise.all(pages.map(page => select(page, 'Black Ballpen')));
    await Promise.all(pages.map(page => page.locator('#complete-sale').click()));
    await Promise.all(pages.map(page => page.waitForLoadState('networkidle')));
    assert.equal(pages.filter(page => page.url().endsWith('/receipt')).length, 1);
    const rejected = pages.find(page => !page.url().endsWith('/receipt'));
    await rejected.getByRole('alert').filter({ hasText: 'Insufficient stock' }).waitFor();
    checks.push('Concurrent attempts to sell the last unit produced one sale and one stock rejection');
    const page = pages[0];
    await select(page, 'ID Picture Printing · set', randomUUID());
    const form = await page.locator('#checkout-form').evaluate(element => [...new FormData(element).entries()]);
    const formData = Object.fromEntries(form);
    const responses = await Promise.all([1, 2].map(() => page.request.post(url + '/sales', { form: formData, maxRedirects: 0 })));
    assert.ok(responses.every(response => response.status() === 302));
    assert.equal(responses[0].headers().location, responses[1].headers().location);
    let totals = JSON.parse(await run(process.env.PHP_EXECUTABLE || 'php', [resolve(root, 'scripts/local-server-fixture.php'), 'inspect'], app));
    assert.equal(totals.sales, 4);
    assert.equal(totals.references, 4);
    assert.equal(totals.notebook_stock, 0);
    assert.equal(totals.pen_stock, 0);
    assert.equal(totals.sale_units, 3);
    // Two notebooks (45 each), one pen (12), and one ID picture set (40).
    assert.equal(totals.revenue_cents, 14200);
    checks.push('Concurrent duplicate submission returned one receipt and recorded one sale');
    await Promise.all(pages.map(page => select(page, 'Blue Ballpen')));
    await pages[0].getByLabel('Fulfillment', {exact:true}).selectOption('delivery');
    await pages[0].getByLabel('Customer name', {exact:true}).fill('Concurrent demo customer');
    await pages[0].getByLabel('Contact number', {exact:true}).fill('09123456789');
    await pages[0].getByLabel('Delivery address', {exact:true}).fill('Demo school gate');
    await pages[0].getByLabel('Delivery fee (₱)').fill('20');
    await pages[0].getByLabel('When is payment collected?').selectOption('cod');
    await pages[0].locator('#complete-sale').click();
    await pages[0].waitForURL(/\/orders\/\d+$/);
    const orderId = new URL(pages[0].url()).pathname.split('/').pop();
    await pages[1].locator('#complete-sale').click();
    await pages[1].getByRole('alert').filter({hasText:'Insufficient stock'}).waitFor();
    const token = await pages[0].locator('[name=_token]').first().inputValue();
    const collection = {_token:token,payment_method:'gcash',cash:'32.00',payment_reference:'CONCURRENT-GCASH-001',payment_verified:'1'};
    const payments = await Promise.all([1,2].map(() => pages[0].request.post(url + '/orders/' + orderId + '/payment', {form:collection,maxRedirects:0})));
    assert.ok(payments.every(response => response.status() === 302));
    assert.equal(payments[0].headers().location, payments[1].headers().location);
    totals = JSON.parse(await run(process.env.PHP_EXECUTABLE || 'php', [resolve(root, 'scripts/local-server-fixture.php'), 'inspect'], app));
    assert.equal(totals.sales,5);
    assert.equal(totals.references,5);
    assert.equal(totals.blue_stock,0);
    assert.equal(totals.reserved,0);
    assert.equal(totals.sale_units,4);
    assert.equal(totals.revenue_cents,17400);
    checks.push('COD reservation blocked another cashier; concurrent verified GCash collection recorded one sale and deduction');
    assert.deepEqual(errors, []);
    await browser.close(); browser = null;
    assert.match(await launch('Start-Store.ps1'), /already running/);
    await launch('Stop-Store.ps1'); started = false;
    await assert.rejects(get('/login'));
    await launch('Start-Store.ps1'); started = true;
    assert.equal((await get('/login')).status, 200);
    await launch('Stop-Store.ps1'); started = false;
    assert.match(await launch('Stop-Store.ps1'), /already stopped/);
    checks.push('Manual start/repeated start/stop/restart/repeated stop verified');
    const settingsPath = resolve(runtime, 'settings.json');
    const settingsText = readFileSync(settingsPath, 'utf8');
    try {
        writeFileSync(settingsPath, JSON.stringify({ ...JSON.parse(settingsText), Pid: process.pid }));
        await assert.rejects(launch('Stop-Store.ps1'));
    } finally { writeFileSync(settingsPath, settingsText); }
    const occupied = createServer();
    await new Promise((resolveListen, reject) => { occupied.once('error', reject); occupied.listen(port, '127.0.0.1', resolveListen); });
    try {
        await assert.rejects(launch('Start-Store.ps1'));
        assert.ok(occupied.listening);
    } finally { await new Promise(resolveClose => occupied.close(resolveClose)); }
    checks.push('Unrelated PID and occupied port rejected without stopping another application');
    writeFileSync(resolve(artifacts, 'local-server-results.json'), JSON.stringify({ status: 'PASS', checks, totals, consoleErrors: errors }, null, 2));
    for (const check of checks) console.log('PASS: ' + check);
} finally {
    if (browser) await browser.close();
    if (started) await launch('Stop-Store.ps1');
    for (const suffix of ['', '-wal', '-shm', '-journal']) rmSync(database + suffix, { force: true });
}
