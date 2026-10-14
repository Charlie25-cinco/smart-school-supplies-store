# Cloud setup and cutover — 2.0.1

This operational guide applies simplified ISO/IEC/IEEE 29148 traceability to REQ-037–042; it is not a full compliance specification. The cloud implementation is under verification. The existing catalog and Laravel/SQLite fallback remain available; no real record transfer or cloud staff deployment has occurred.

## Services and cost

Use the accepted Cloudflare Workers Static Assets frontend and Supabase Free project in **Singapore** for implementation/testing. Static asset requests are free. Supabase Free has a 500MB database, can pause after a week of inactivity, and excludes automatic backups; keep private exports and monitor limits. A future Supabase Pro plan starts at US$25/month and adds daily backups and avoids inactivity pausing. No paid upgrade is configured or authorized. Singapore stores records outside the Philippines; select it deliberately before importing personal records, and keep access restricted. Sources: [Cloudflare billing](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/), [Supabase pricing](https://supabase.com/pricing), [regions](https://supabase.com/docs/guides/platform/regions).

## Prepare the provider project

1. In your own Supabase dashboard, create the store project in Singapore. Keep the database password private.
2. Apply the reviewed `supabase/migrations/` files in filename order to the new project using the Supabase CLI or dashboard SQL editor. Do not apply them to an unrelated database.
3. Disable public email signup. Set the minimum password length to 12 and restrict Auth site/redirect URLs to the chosen HTTPS staff address. Existing Cashiers are created only by Admin.
4. Deploy `supabase/functions/staff-admin/` using the Supabase CLI. Its handler validates the staff JWT itself; the function configuration disables the gateway's legacy JWT check to support current public keys. Set its private `ALLOWED_ORIGINS` to the exact Cloudflare origin. Never publish the service-role key; Supabase provides the server's built-in keys.
5. Link the first Admin through the verified private legacy importer or create an Auth user privately in the dashboard and insert its matching Admin profile with a private administrative connection. Do not add browser signup or a default password. Test with fictional accounts before transferring store records.

The project URL and **publishable key** may appear in public configuration. A database password, access token, secret key or service-role JWT must stay in local environment variables/provider secret storage and must never be shared in chat or committed.

## Build the static release

From `cloud-app/`:

```powershell
npm.cmd ci
Copy-Item .env.example .env.local
```

Edit the ignored `.env.local` with `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`, then run:

```powershell
npm.cmd test
npm.cmd run build
npm.cmd run test:ui
```

The build places the customer catalog at `dist/` and staff app at `dist/staff/`; only `dist/` is public. `wrangler.jsonc` targets this directory. Configure the existing Cloudflare Git build root as `cloud-app`, build command `npm ci && npm run build`, and deploy command `npx wrangler deploy`. Set the two public build variables in the provider. Confirm the build artifact contains no `.env`, private exports, logs, SQLite, service key or dependencies. Verify the HTTPS catalog, staff login, headers, role restrictions and installed offline behavior after publication before using real transactions.

## Working offline

Cashiers sign in online, name/register each browser device and synchronize. Admin allocates product stock to those devices while connected; Cashiers can then sell only their own remaining allocation. Services have no stock budget. Inventory edits use version checks and can require review if another Admin changed the same item. Accounts and allocation changes require internet. Stock receipts are available for products and internal supplies; **Usage / reduction** is available only for internal consumables, in both cloud and Laravel workspaces.

The installed PWA and normal browser use the same prepared workspace. Installation alone does not prepare an account or allocate stock. Use Sync now before going offline and after reconnecting; the app also attempts foreground synchronization when connectivity returns. Keep the app open to finish syncing. Background synchronization is not guaranteed. A saved pending receipt/order is local until its sync indicator becomes Synced.

An order is editable on one device. Synchronize and resolve reviews, release its editing device while online, then claim it on the next authorized Cashier device. Admin-origin handoff remains restricted to eligible unfinished orders and preserves original history. Do not clear site data, reinstall the browser, reset the device ID, or release an offline device's stock when it may contain unreported changes.

If a change needs review, inspect the original payload and reason. Correct its underlying allocation or current version, then select the original change's retry action. A version refresh requires the explicit review checkbox. Retries keep the original items, prices, receipt, payment reference and captured business date; a successfully synchronized retry links the original review to its confirmed replacement. A pre-existing matching replacement can be linked with a resolution note only if its captured date also matches. Do not enter a second GCash payment with a different reference to bypass a rejection. Unsupported or unrecoverable financial cases require administrator investigation; no paid refund/void module is included.

Remote reset/disable takes effect when a device contacts the cloud. A disconnected prepared device cannot immediately learn that its account was disabled; queued evidence remains on it and cloud access is denied on reconnect. Clean online logout clears its prepared private workspace; pending/review changes block logout to prevent losing evidence. Physical access to an unlocked prepared device must be controlled.

If Admin changes the login email, enter the current address when restoring the prepared session. The app still requires the same authenticated staff ID and device; another Cashier cannot take over its queue. If logout is interrupted, reload shows **Finish signing out** instead of the private workspace or sign-in form. Reconnect and select **Finish sign out** in the same browser profile, then prepare the device again. Cleanup retry requires Web Locks; private projections stay locked on an unsupported browser or a failed retry. Pending/review evidence remains protected. Keep `catalog/config.js` at `demo: true` until real public prices are confirmed; connecting Supabase or loading cached catalog data does not remove the sample labels.

Existing-account changes hold a private operation guard across Auth and profile updates. If a function stops with an uncertain result, the guard remains; it never expires automatically into an overlapping change. An operator with a private service connection must inspect both Auth and the profile, reconcile any mismatch, then call `finish_staff_operation` with that operation's ID. No public or Cashier recovery bypass exists. A definite rejected password change after successful revocation leaves sessions ended and the old password retained; an uncertain response requires inspection before claiming which password applies. Failed session cleanup after disable leaves access disabled. Re-enabling revokes old sessions before restoring access. Authorization checks fresh session creation time and token issuance, allowing genuine new logins within the same second while rejecting old sessions.

## Private migration and fallback

Use only the tested private exporter/importer documented with the tools. Stop new local transactions for final transfer, create an integrity-checked backup outside public assets, compare import row counts, receipt references, money totals and reserved stock, and verify both roles before cutover. Keep the source SQLite and private backup intact. Do not run `migrate:fresh` on store records. Failed or partial import must be diagnosed before using the destination; never write transactions to both systems during cutover.

From the repository root, with PHP available, create a **new** private export directory under ignored `.runtime/`:

```powershell
php cloud-app/scripts/export-legacy.php --source=store-app/database/database.sqlite --output=.runtime/final-cloud-export
```

The exporter opens the source read-only, creates a consistent SQLite snapshot, checks integrity/foreign keys, restricts folder access, and writes `legacy.private.json` with whitelisted records and private bcrypt hashes. Both files contain sensitive records; do not upload them as static assets, share them, or commit them. Reusing an existing output directory is rejected. The atomic importer supports exports up to 16MB; larger histories require a separately reviewed transfer procedure.

In a private terminal environment, set `SUPABASE_URL` and the server-only `SUPABASE_SERVICE_ROLE_KEY` using your secret-management mechanism, then run:

```powershell
node cloud-app/scripts/import-legacy.mjs --bundle .runtime/final-cloud-export/legacy.private.json
```

Never put a key on this command line or paste it into chat. The importer verifies backup/data digests, relationships, amounts and historical snapshots before provisioning Auth users. Bcrypt hashes are sent only to the private Auth Admin API; profiles contain no hash. Matching private import markers allow resuming an interrupted Auth phase. Financial/profile import is one transaction, so a failure exposes no partial store. It checks an empty or identically completed destination, compares counts and advances identity sequences. Resume **the same bundle** after interruption; a new export gets a different migration ID and cannot silently adopt previous accounts. No existing destination account/history is deleted or merged. Keep original IDs, `SS-000007`-style receipt numbers, source prices and actual payment collectors; legacy `cod` becomes `collection`.

Offline business dates use the device's captured timestamp; the server separately records receipt/synchronization time. Keep device clocks accurate. Product availability includes allocated unsold stock, excludes reserved stock, and reflects synchronized records only. Browser connectivity can remain reported online without internet: staff requests time out after eight seconds, retain their queue and pause automatic retries until manual Sync now or a new online event.

Until provider setup, fictional end-to-end checks and the final migration comparison pass, continue using the existing local system. Provider creation/login, real import, Cloudflare configuration and live verification remain pending; local isolated passes cannot substitute for them.
