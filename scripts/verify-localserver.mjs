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
// The project database engine is Laragon MySQL; this suite resets the shared
// isolated smart_store_test database (credentials resolve from the local
// ignored .env, least-privileged to the test database).
import { spawnSync } from 'node:child_process';
const freshMysql = spawnSync(process.env.PHP_EXECUTABLE || 'php', ['artisan', 'migrate:fresh', '--force'], { cwd: app, env: { ...process.env, APP_ENV: 'testing', APP_DEBUG: 'false', APP_KEY: 'base64:' + randomBytes(32).toString('base64'), DB_CONNECTION: 'mysql', DB_DATABASE: 'smart_store_test', DB_URL: '', CACHE_STORE: 'array', SESSION_DRIVER: 'database' }, encoding: 'utf8', windowsHide: true });
assert.equal(freshMysql.status, 0, 'Isolated MySQL fixture reset failed.');
const views = resolve(artifacts, 'lan-views');
mkdirSync(views, { recursive: true });
const password = randomBytes(24).toString('hex');
const env = {
    ...process.env, APP_ENV: 'testing', APP_DEBUG: 'false',
    APP_KEY: 'base64:' + randomBytes(32).toString('base64'), APP_CONFIG_CACHE: resolve(artifacts, 'absent-lan-config.php'),
    DB_CONNECTION: 'mysql', DB_DATABASE: 'smart_store_test', DB_URL: '', CACHE_STORE: 'array',
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
let browser, started = false, launchAttempted = false;
const checks = [];
const startupTimings = {};
let readinessChecks;
const verifyReadiness = async () => {
    const probeRuntime=resolve(runtime,'startup-checks-'+randomUUID());
    mkdirSync(probeRuntime,{recursive:true});
    const probePort=await new Promise((resolvePort,reject)=>{const server=createServer();server.on('error',reject);server.listen(0,'127.0.0.1',()=>{const value=server.address().port;server.close(()=>resolvePort(value));});});
    const phpFixture=resolve(probeRuntime,'delayed-listener.php');
    const psDriver=resolve(probeRuntime,'verify-readiness.ps1');
    writeFileSync(phpFixture,String.raw`<?php
if (PHP_SAPI !== 'cli' || $argc !== 4) { exit(2); }
usleep((int) ((float) $argv[1] * 1000000));
if ($argv[3] === 'exit') { exit(0); }
$socket = stream_socket_server('tcp://127.0.0.1:'.(int) $argv[2], $errorCode, $errorMessage);
if (! $socket) { exit(3); }
$deadline = microtime(true) + 240;
while (microtime(true) < $deadline) {
    $peer = @stream_socket_accept($socket, 1);
    if ($peer) { fclose($peer); }
}
fclose($socket);
`);
    writeFileSync(psDriver,String.raw`[CmdletBinding()]
param([string] $ProjectRoot, [string] $PhpExecutable, [string] $RuntimeDirectory, [int] $Port)
. (Join-Path $ProjectRoot 'scripts\local-server-common.ps1')
$RuntimeDirectory = Get-StoreRuntime $RuntimeDirectory
if (Test-Path -LiteralPath $PhpExecutable -PathType Leaf) { $PhpExecutable = (Resolve-Path -LiteralPath $PhpExecutable).Path }
else { $PhpExecutable = (Get-Command $PhpExecutable -CommandType Application -ErrorAction Stop).Source }
$script:probe = $null
function Assert-Probe([bool] $Condition, [string] $Message) {
    if (-not $Condition) { throw $Message }
}
function New-Probe([double] $Delay, [string] $Mode = 'listen') {
    $fixture = Join-Path $RuntimeDirectory 'delayed-listener.php'
    $arguments = '"' + $fixture + '" ' + $Delay.ToString([Globalization.CultureInfo]::InvariantCulture) + ' ' + $Port + ' ' + $Mode
    $child = Start-Process -FilePath $PhpExecutable -ArgumentList $arguments -WorkingDirectory $RuntimeDirectory -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $RuntimeDirectory 'probe-output.log') -RedirectStandardError (Join-Path $RuntimeDirectory 'probe-error.log')
    $script:probe = @{ Mode='artisan'; Runtime=$RuntimeDirectory; Php=$PhpExecutable; Port=$Port; Url="http://127.0.0.1:$Port"; Pid=$child.Id; StartTicks=$child.StartTime.ToUniversalTime().Ticks }
    Write-StoreUtf8 (Join-Path $RuntimeDirectory 'settings.json') ($script:probe | ConvertTo-Json)
    return $script:probe
}
function Stop-Probe {
    if ($script:probe) {
        # This fixture is a single PHP listener, not an Artisan tree. Verify its
        # exact executable/PID/start time before closing only that test process.
        $owned = Get-StoreProcess $script:probe
        if ($owned) {
            $owned.Kill()
            Assert-Probe ($owned.WaitForExit(5000)) 'Isolated startup fixture did not stop.'
        }
        $script:probe = $null
    }
}
function Invoke-ReusedStart {
    $output = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $ProjectRoot 'scripts\Start-Store.ps1') -RuntimeDirectory $RuntimeDirectory
    Assert-Probe ($LASTEXITCODE -eq 0) 'Reused isolated startup failed.'
    Assert-Probe (($output | Out-String) -match 'already running') 'Launcher did not reuse its verified process.'
}
try {
    Assert-Probe (-not (Get-StoreProcess (Get-StoreSettings $RuntimeDirectory))) 'Isolated startup runtime already owns a live process.'
    $delayed = New-Probe 18
    $forged = @{}
    foreach ($entry in $delayed.GetEnumerator()) { $forged[$entry.Key] = $entry.Value }
    $forged.StartTicks = $delayed.StartTicks + 1
    $guardRejected = $false
    try { [void](Wait-StoreReady $forged -TimeoutSeconds 1) } catch { $guardRejected = $_.Exception.Message -match 'different process' }
    Assert-Probe $guardRejected 'Readiness accepted a live PID with forged start time.'
    Assert-Probe ([bool](Get-StoreProcess $delayed)) 'Identity rejection stopped the valid test process.'
    $timer = [Diagnostics.Stopwatch]::StartNew()
    $delayedResult = Wait-StoreReady $delayed
    $delayedMs = [int] $timer.Elapsed.TotalMilliseconds
    Assert-Probe ($delayedResult -eq 'ready') 'Default readiness rejected the delayed test listener.'
    Assert-Probe ($delayedMs -gt 15000 -and $delayedMs -lt 46000) 'Default readiness was not exercised beyond the former 15-second limit.'
    Invoke-ReusedStart
    $reused = Get-StoreSettings $RuntimeDirectory
    Assert-Probe ($reused.Pid -eq $delayed.Pid -and $reused.StartTicks -eq $delayed.StartTicks) 'Ready retry launched a second process.'
    Stop-Probe

    $warming = New-Probe 6
    $earlyResult = Wait-StoreReady $warming -TimeoutSeconds 2
    Assert-Probe ($earlyResult -eq 'timeout') 'Short readiness check did not time out while warming.'
    Assert-Probe ([bool](Get-StoreProcess $warming)) 'Readiness timeout stopped its owned process.'
    Assert-Probe (-not (Test-StorePort $Port)) 'Warm-reuse fixture was already listening before retry.'
    $reuseTimer = [Diagnostics.Stopwatch]::StartNew()
    Invoke-ReusedStart
    $warmReuseMs = [int] $reuseTimer.Elapsed.TotalMilliseconds
    $reused = Get-StoreSettings $RuntimeDirectory
    Assert-Probe ($reused.Pid -eq $warming.Pid -and $reused.StartTicks -eq $warming.StartTicks) 'Warm retry launched a second process.'
    Assert-Probe (Test-StorePort $Port) 'Reused launcher returned before the listener became ready.'
    Stop-Probe

    $ended = New-Probe 1 'exit'
    Assert-Probe ((Wait-StoreReady $ended) -eq 'exited') 'Readiness failed to distinguish process exit from timeout.'
    Stop-Probe
    $ended = New-Probe 1 'exit'
    $exitMessage = $false
    try { Confirm-StoreReady $ended } catch { $exitMessage = $_.Exception.Message -match 'process ended before it became ready' }
    Assert-Probe $exitMessage 'Readiness confirmation omitted the process-exit explanation.'
    Stop-Probe
    Write-Output ('STARTUP_CHECKS:' + (@{ delayedWaitMs=$delayedMs; warmReuseMs=$warmReuseMs; delayedReady=$true; readyReuse=$true; timeoutPreservedProcess=$true; warmReuse=$true; identityGuard=$true; exitState=$true; exitMessage=$true } | ConvertTo-Json -Compress))
} finally { Stop-Probe }
`);
    const output=await run('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',psDriver,'-ProjectRoot',root,'-PhpExecutable',process.env.PHP_EXECUTABLE||'php','-RuntimeDirectory',probeRuntime,'-Port',String(probePort)]);
    const result=/^STARTUP_CHECKS:(.+)$/m.exec(output);
    assert.ok(result,'Isolated startup verification did not return results.');
    return JSON.parse(result[1]);
};
try {
    await run(process.env.PHP_EXECUTABLE || 'php', [resolve(root, 'scripts/local-server-fixture.php')], app);
    readinessChecks=await verifyReadiness();
    checks.push('Default 45-second readiness accepted an owned PHP listener delayed beyond 15 seconds');
    checks.push('Readiness rejected forged live PID start-time metadata without stopping the verified process');
    checks.push('Early readiness timeout preserved the warming process; repeated Start waited and reused its original PID');
    checks.push('Already-ready Start reused the same verified process without duplicate launch');
    checks.push('Process exit returned exited and produced the distinct readiness-confirmation explanation');
    const launchStart = performance.now();
    launchAttempted = true;
    await launch('Start-Store.ps1', ['-Port', String(port)]);
    startupTimings.launcherMs = Math.round(performance.now() - launchStart);
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
    const loginStart = performance.now();
    assert.equal((await get('/login')).status, 200);
    startupTimings.firstLoginMs = Math.round(performance.now() - loginStart);
    startupTimings.launchToLoginMs = Math.round(performance.now() - launchStart);
    if (process.env.STORE_TIMING_BASELINE === '1') writeFileSync(resolve(artifacts,'startup-baseline.json'),JSON.stringify(startupTimings,null,2));
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
        await page.getByLabel('Username').fill(index ? 'two' : 'one');
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
    checks.push('Two independent cashier sessions submitted concurrent requests against one MySQL database');
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
    await pages[0].locator('#edit-order-details').click();
    await pages[0].getByLabel('Customer name', {exact:true}).fill('Concurrent demo customer');
    await pages[0].getByLabel('Contact number', {exact:true}).fill('09123456789');
    await pages[0].getByLabel('Delivery address', {exact:true}).fill('Demo school gate');
    await pages[0].getByLabel('Delivery fee (₱)').fill('20');
    await pages[0].getByLabel('When is payment collected?').selectOption('cod');
    await pages[0].getByRole('button',{name:'Use these details',exact:true}).click();
    await pages[0].locator('#complete-sale').click();
    await pages[0].waitForURL(/\/orders\/\d+$/);
    const orderId = new URL(pages[0].url()).pathname.split('/').pop();
    await pages[1].locator('#complete-sale').click();
    await pages[1].getByRole('alert').filter({hasText:'Insufficient stock'}).waitFor();
    await pages[0].goto(url+'/orders/'+orderId+'/edit');
    const editForm=Object.fromEntries(await pages[0].locator('#order-edit-form').evaluate(element=>[...new FormData(element).entries()]));
    const edits=await Promise.all(['A','B'].map(label=>pages[0].request.post(url+'/orders/'+orderId,{form:{...editForm,notes:'Concurrent demo edit '+label},maxRedirects:0})));
    assert.ok(edits.every(response=>response.status()===302));
    assert.equal(edits.filter(response=>response.headers().location.endsWith('/orders/'+orderId)).length,1,'Both stale edits were accepted');
    assert.equal(edits.filter(response=>response.headers().location.endsWith('/orders/'+orderId+'/edit')).length,1,'Stale edit did not return to correction');
    checks.push('Concurrent edits accepted one saved revision and rejected the stale form without duplicating reservations');
    const token = await pages[0].locator('[name=_token]').first().inputValue();
    const collection = {_token:token,payment_method:'gcash',cash:'32.00',payment_reference:'CONCURRENT-GCASH-001',payment_verified:'1'};
    const payments = await Promise.all([1,2].map(() => pages[0].request.post(url + '/orders/' + orderId + '/payment', {form:collection,maxRedirects:0})));
    assert.ok(payments.every(response => response.status() === 302));
    assert.equal(payments[0].headers().location, payments[1].headers().location);
    await pages[0].request.post(url+'/orders/'+orderId,{form:{...editForm,notes:'Rejected stale financial edit'},maxRedirects:0});
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
    writeFileSync(resolve(artifacts, 'local-server-results.json'), JSON.stringify({ status: 'PASS', checks, totals, startupTimings, readinessChecks, consoleErrors: errors }, null, 2));
    console.log('Startup timings (ms): '+JSON.stringify(startupTimings));
    for (const check of checks) console.log('PASS: ' + check);
} finally {
    if (browser) await browser.close();
    // A startup timeout retains its owned PHP process before started=true.
    // The Stop launcher verifies identity; only the isolated QA runtime is used.
    if (started || launchAttempted) await launch('Stop-Store.ps1');
    for (const suffix of ['', '-wal', '-shm', '-journal']) rmSync(database + suffix, { force: true });
}
