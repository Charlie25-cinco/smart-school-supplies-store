# Local fallback during cloud migration

The accepted 2.0.0 target is Cloudflare + Supabase with prepared-device offline operation (REQ-037–042). The procedures below operate the existing Laravel/MySQL store (REQ-043); they do not deploy the cloud app. Keep the store database and backups private. Do not reset it to perform migration tests. See [CLOUD_DEPLOYMENT.md](CLOUD_DEPLOYMENT.md) for the new deployment and cutover process. The legacy instructions and their earlier verification remain historical evidence.

# Run the store demo

This quick-start guide uses simplified requirements traceability, not full ISO/IEC/IEEE 29148 compliance. See REQ-007, REQ-009–011 and REQ-030–036 in REQUIREMENTS.md.

## On the main computer

1. Double-click **Start Store.cmd** in the project folder.
2. Sign in at **http://127.0.0.1:8000**, which opens automatically.
3. When all cashiers finish, double-click **Stop Store.cmd**.

Dependencies and assets must already be installed using README's one-time setup. Laragon's MySQL service must be running, and your current staff account and MySQL records are preserved. No Apache, certificate installation, or separate server setup command is required. The Laragon application need not run; PHP must remain installed.

## On a phone or tablet

On desktop, scrolling the sidebar navigation keeps the logo, profile and Sign out in place when the window has sufficient height. Use the mouse wheel over the links, or Tab to a link; focus reveals it inside the navigation region. Very short or zoomed windows allow the sidebar to scroll naturally so all controls remain reachable. Returning from an open phone/tablet menu to desktop reveals the current page's navigation link.

Connect to the same reachable store Wi-Fi network. Open the main computer's IPv4 address with port 8000, for example **http://192.168.1.10:8000**.

Start Store prints possible network links. If several appear, use the address of the active Wi-Fi/Ethernet connection; you can also find it with **ipconfig**. The example above is not your detected address. Localhost and 127.0.0.1 on a phone refer to that phone.

The server computer must stay awake and running. Windows Firewall must permit PHP on the private store network. A guest Wi-Fi network may isolate devices. Internet is unnecessary for POS operations, but the local connection is required.

Every device uses the same MySQL database on the main computer through Laravel. Another device's changes appear when you refresh the page. There is no disconnected-device transaction queue.

Phones/tablets have **Menu** for role-specific pages and Sign out. On narrow POS screens, use **Products** to browse and **Current sale** (or the basket summary) for fulfillment/channel, customer details, quantities and payment. Switching preserves entered details. Validation opens the correction panel/dialog. Wider tablets keep products beside checkout with compact navigation.

## Admin and Cashier workspaces

- **Admin:** Overview, Inventory/IMS, Cashier accounts, all Orders review, and Sales reports/receipts. Admin can hand off unfinished Admin-created orders; checkout, order editing/payment/status changes belong to Cashiers.
- **Cashier:** POS, their Orders & delivery, payments, receipts and transaction history. Inventory, Overview and account administration are forbidden, including direct URLs.

Sign in with the existing Owner credentials after upgrading: that account is now **Admin**. To add a cashier, choose **Cashier accounts → Add cashier**, enter their name/username and a confirmed password of at least 12 characters, and give the password privately. **Manage account** edits the profile, resets the password or enables/disables access. Reset/disable ends existing sessions; disabling prevents login and does not remove past transactions. Admin accounts cannot be changed through the cashier forms.

For a fresh installation, create the first Admin privately with `php artisan store:staff --role=admin`. The legacy `--role=owner` option maps to Admin; no default credentials are provided. Admin and Cashier land on Overview and POS respectively. Local operation needs store-network access, even without internet; the cloud/PWA/Rider proposal was cancelled.

## Upgrade existing staff access to 1.0.0

Finish transactions, stop the server, and back up the `smart_store` database (HeidiSQL export or `mysqldump`) to private storage. From **store-app/** run:

~~~powershell
php artisan migrate
npm.cmd run build
~~~

Then start the store and refresh (Ctrl+F5). This additive migration converts Owner to Admin and enables existing accounts while preserving IDs, password hashes, inventory, orders and receipts. Never use `migrate:fresh` for an upgrade. Existing Admin and Cashier credentials remain usable. Create a cashier from the Admin screen if the store previously used only an Owner login.

Legacy Owner orders keep their original creator. The 1.0.0 upgrade preserved one unfinished record without assigning it. The approved 1.1.0 additive migration adds nullable assignment fields; after a private backup, run `php artisan migrate --force` from `store-app/` while the Store is stopped, then start it again. Do not reset the database, replace creators or remove reservations manually. Account login/uniqueness compare usernames without letter-case differences.

## Hand off an unfinished Admin order

1. Sign in as Admin. Create or enable the recipient under **Cashier accounts** if needed.
2. Open **Orders review**, select **Hand off order** or **View order**, then find **Hand off to cashier**.
3. Choose an active Cashier and submit the handoff. No recipient is chosen automatically. If another request changed the order, reload and review it before retrying.
4. The selected Cashier opens **Orders & delivery** and **View order** to finish the order using the existing editing, payment and fulfillment controls.

Only Admin-created orders in Preparing, Ready or Out for delivery can be handed off. Admin may change the assigned Cashier while the order remains unfinished. The former Cashier then loses order access. The original recorder and agreed prices stay intact, and paid items/fees cannot be changed. Payment collection is recorded separately; the collector retains their payment receipt/history even if responsibility changes. Assignment alone does not add an existing paid sale to a new Cashier's revenue totals. Disabled Cashiers cannot work on an order; Admin can select another active account. Completed/cancelled orders and Cashier-created orders have no handoff control. Admin still cannot record payment or update delivery status.

## What Start/Stop do

Start runs this command from store-app in the background:

~~~powershell
php artisan serve --host=0.0.0.0 --port=8000 --no-reload --no-ansi
~~~

The last two flags keep the process stable and logs plain. Runtime settings/logs are prepared automatically in ignored **.runtime/artisan/**. Repeating Start checks readiness before opening the existing instance.

Start displays progress and the time taken to start the server. The first launch starts PowerShell/PHP/Laravel; repeating Start reuses the running process. Keep the server running during store work, even if you close a browser tab. Browser startup and the first page request add time beyond the displayed server measurement. The launcher checks port availability with a short exclusive bind, closes that probe, then starts Artisan; it never stops an unrelated application to take its port.

The 1.1.1 launcher waits up to **45 seconds** for PHP to listen, for both a new and an existing owned process. During a longer wait it reports progress every ten seconds. This replaces the old 15-second deadline that could report failure shortly before a slow startup completed; it does not promise faster PHP or first-page loading.

If it reports **PHP is still running** after the wait, wait a moment and run **Start Store.cmd** again. The retry waits for the same verified process instead of creating another instance. If it reports **the PHP store process ended**, inspect **.runtime/artisan/server-output.log** and **server-error.log** locally before retrying. Keep those files private; do not share credentials, customer details or full application logs. Neither error removes MySQL records. Readiness confirms a listening local TCP port; the first Laravel page can take additional time to respond.

Stop verifies the recorded PHP process path and launch time, then stops only its process tree, including Artisan's PHP server child. Finish and confirm sales before stopping. If a checkout was interrupted, check sales history before repeating it; the same checkout reference prevents duplicate recording.

If your old terminal server occupies port 8000, stop it with Ctrl+C before using Start Store. Start never kills another process to free a port.

This is the user-approved temporary **HTTP demo with sample accounts/data on trusted Wi-Fi**. HTTP does not encrypt network traffic; it is not a deployment of real staff/customer data. Production HTTPS and automatic startup are deferred. Any old ignored Apache/certificate runtime files are unused; Windows trust/firewall settings are not changed by these launchers.

## Optional troubleshooting

For a different port or PHP installation:

~~~powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\Start-Store.ps1 -Port 8001 -PhpExecutable C:\Tools\PHP\php.exe -OpenBrowser
~~~

The selected port is remembered for later Start/Stop calls. Otherwise PHP comes from PHP_EXECUTABLE, your PATH, or the installed PHP path under C:\laragon. This is an executable dependency, not a requirement to launch Laragon.

If a device cannot connect, check the main computer's IP, chosen port, active server, host power, firewall, and Wi-Fi isolation. Reserve the server IP in the router when eventually deploying. No port forwarding is needed.

If necessary for the demonstration, a Windows administrator can permit the specific PHP executable/port on a **Private** network and **LocalSubnet**:

~~~powershell
New-NetFirewallRule -DisplayName 'Smart School Supplies Demo' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 8000 -Profile Private -RemoteAddress LocalSubnet -Program 'C:\laragon\bin\php\php-8.3.30-Win32-vs16-x64\php.exe'
~~~

Adjust the executable/port to match your setup. The launchers do not install this rule or change power settings.

Login currently expires after **120 idle minutes**. For eight hours, set **SESSION_LIFETIME=480** in store-app/.env and restart the demo. The launcher bypasses cached configuration for its own process, so this setting is reread on restart. Per-request PHP limits do not impose a server uptime limit.

Logs remain local in .runtime/artisan. Redact credentials and personal/transaction details before sharing diagnostics.

For a backup, finish sales and stop all processes using the database, then export the `smart_store` database (HeidiSQL export or `mysqldump`) to private storage. Keep .env separately in secure storage; retain the export until a restored copy is verified.

## Orders, payments, and supply usage

In **Point of sale**, add products/services and select a fulfillment mode:

- **Counter sale:** collect cash or verified GCash and complete the sale immediately.
- **Store pickup / Delivery:** open **Customer details** and enter the customer's name/contact and preparation notes. Delivery also requires an address and the agreed delivery fee; pickup adds no delivery fee.
- In that dialog choose **Prepaid** to record payment now, or **On delivery / pickup** to confirm unpaid. Select **Use these details** to return to checkout. Unpaid product quantities are reserved until collection or cancellation.

The basket items scroll separately from payment and totals on a normal laptop window (1366x768 CSS pixels). Shorter windows permit page scrolling. If customer/delivery validation fails, the details dialog reopens with entered values; correct them and confirm again. Cash/GCash errors remain beside the checkout flow. **Order channel** is separate from fulfillment: select **Messenger (confirmed)** for an inquiry already agreed with staff.

For **cash**, enter the received amount; the receipt records change. For **GCash**, verify the incoming payment in the store account, enter the exact order total and transaction reference, and check the verification box. The app records your confirmation; it does not contact GCash. A GCash reference cannot be reused for another sale. Do not record a payment based only on a customer screenshot. No real account login, PIN, OTP, or API credential belongs in this app.

Open **Orders & delivery** to find orders by customer name, fulfillment status, or payment status. Select **View order** in the Actions column/card; the order number is a reference. The progress strip shows **Preparing → Ready → Out for delivery → Delivered**, or **Preparing → Ready → Picked up**. Select **Next step** to reach the action and its explanation. Record collected cash/verified GCash before marking the order delivered/picked up. Paid orders have a receipt; unpaid orders appear in awaiting-payment totals and are excluded from sales revenue. Delivery fees are included in paid revenue and itemized on receipts. To return money for a paid sale, use **Record a refund** on its receipt: full amount back with a mandatory reason, returned-goods confirmation for products, manual-return confirmation for GCash, product restocking, and the original sale preserved. Each sale refunds once. Admin reviews all records; a Cashier manages their own orders and currently assigned Admin-origin orders. Handoff and original/payment attribution are explained above. **How pickup & delivery orders work** opens a short guide.

An unpaid order can be cancelled with a reason. If dispatched, confirm that the goods returned before releasing stock. Paid refunds/voids are outside this workflow. Finishing an order or recording payment twice does not create a second sale or deduction.

### Edit a confirmed order

1. Open **Orders & delivery** and choose the row/card's **Edit order** button. You can also choose **View order**, then **Edit order** at the top of the detail page. Editing is available while **Preparing** or **Ready**.
2. Correct customer name/contact, delivery address or preparation notes. Paid orders permit these corrections while their items, fee and receipt amounts stay fixed.
3. For unpaid orders, adjust quantities, remove lines or use **Add an item**, and correct the agreed delivery fee. Retained items keep their agreed prices; added items use current prices. Available stock limits increases. An inactive retained item can be kept/reduced, but cannot be added or increased.
4. Review the total and choose **Save changes**. The order remains unpaid until you record collection separately. Saved quantity changes reserve/release only this order's units; a failed save changes neither stock nor order details.

If another device changes the order while the edit page is open, use **Reload the latest order before editing again**, review the new details and enter your correction again. The system prevents stale edits from overwriting a payment or another saved edit. Dispatched, delivered/picked-up and cancelled orders cannot be edited. Fulfillment and payment arrangement are kept as originally confirmed.

In **Inventory**, use **Items** for category/status filters and stock actions, and **Stock movements** for the audit history. Arrow keys, Home and End switch the focused tabs. Phones display item cards. **Available = total stock − unpaid reservations.** Total stock can include reserved COD goods already out for delivery; use available stock for new sales, not a physical shelf-count interpretation of the total. Admin can restock physical products/supplies; **Record usage** is restricted to **Internal supply** items and requires a quantity and reason. Items with no sales, orders, or stock records can be permanently deleted from the item form after an explicit confirmation; transacted items can only be deactivated to preserve history. Direct usage submissions for sellable products/services are rejected. Create **Internal supply** items for ink/paper used only internally (price 0, stock in a consistent unit you choose); they never appear in POS. Printing charges do not automatically deduct paper/ink. Record actual consumption manually, using the same unit as the inventory item.

For the HTTP defense demo, use fictional customer names, contacts, addresses, and payment references. Customer details stay in the staff app; the public catalog remains a Messenger inquiry flow.

### Upgrade an existing installation to 0.4.0

Finish sales, stop the server, and export the database to private storage. From the project folder, run:

~~~powershell
cd store-app
php artisan migrate
npm.cmd run build
~~~

Then use **Start Store.cmd**. This migration adds order/payment fields and preserves existing accounts, inventory, and paid sales. Historical sales remain recorded as cash; only newly confirmed orders create reservations. Never use the reset command below to apply an upgrade.

## Reset the demo database

Use this only when you want to start the local MySQL demo over. **A full reset deletes all staff accounts, orders, payments, sales, reservations, stock movements, custom items, and inventory edits.** It recreates the tables and restores the sample products, prices, and opening stock from the committed seeder fixture (`store-app/database/seeders/data/sample-products.json`). It does not reset the separate customer catalog file or its browser list.

1. Finish sales and double-click **Stop Store.cmd**. If another terminal is running the POS, stop it with Ctrl+C too. All processes using the database must be stopped before the backup/reset.
2. Export the `smart_store` database (HeidiSQL export or `mysqldump`) to private storage outside the project. Keep **store-app/.env** separately in secure storage. The reset command affects Laravel's configured database.
3. Open PowerShell in the project folder. Confirm the app is configured for the Laragon MySQL database (`DB_CONNECTION=mysql`), then run:

~~~powershell
cd store-app
php artisan migrate:fresh --seed
~~~

4. Once the reset succeeds, create a new Admin account in the same terminal:

~~~powershell
php artisan store:staff --role=admin
~~~

Enter a name, username, and a password of **at least 12 characters**. Password entry is hidden; type it and press Enter. The seeder does not create staff accounts. If needed, also run `php artisan store:staff --role=cashier` for each cashier.

5. Double-click **Start Store.cmd**, sign in with the new account, and confirm that sales history is empty and sample inventory is restored. Old login credentials no longer work unless you recreated them.

Do not delete the database or regenerate the application key for this reset. `php artisan db:seed` alone does **not** reset existing stock/prices or remove sales. Keep the export until you have checked the new demo records. If a command fails, leave the server stopped and inspect the error before continuing.

## Day-after runbook: real records and catalog refresh

Do this only after the defense, never on venue Wi-Fi. The defense demo stays on sample data over unencrypted HTTP.

1. Finish sales, stop the server, and export the `smart_store` database plus keep **store-app/.env** in private storage, as in the reset section above.
2. Practice on a copy first: export the database, restore it under a test name, point a test checkout at it if needed, and rehearse the reset there. Only run `php artisan migrate:fresh --seed` followed by `php artisan store:staff --role=admin` against the live database when the rehearsal is clean.
3. Enter real products, prices, and opening stock through **Inventory** in the Admin workspace (or a separately reviewed import that preserves IDs). Add a product photo on the item form where available (JPEG, PNG, or WebP up to 2MB); photos appear on staff screens immediately. Real customer names, contacts, addresses, and payment references belong only in the staff app on the trusted store network — never in the public catalog.
4. Refresh the public catalog from the confirmed list with the reviewed exporter (never hand-edit around it): preview the diff, then write the file.

~~~powershell
php scripts/export-catalog-products.php --dry-run
php scripts/export-catalog-products.php
~~~

The exporter reads the store database read-only (a snapshot copy for SQLite files, a direct read-only connection for MySQL; nothing is ever written to it), excludes inactive items and internal consumables, keeps services with zero stock, and refuses to export when a row has an invalid SKU or non-positive price. Set `demo: false` in `catalog/config.js` only when every public price is confirmed, commit through the existing Git integration, wait for the Cloudflare build, then verify the live page, product JSON, headers, copy gate, and Page link before announcing it.
5. An on-demand staff export that regenerates `products.json` from inventory (availability badges only, never exact counts) is queued post-defense work; until it exists, catalog edits stay manual and reviewed per release.

## Customer website

Double-click **Start Catalog.cmd** in the project folder to preview the customer catalog locally at **http://127.0.0.1:8080**; **Stop Catalog.cmd** ends that preview only. The preview reads the store database live on every page load, so a newly added product appears after a plain browser reload with no preview restart. Like the store launcher, repeating Start reuses the recorded preview process, an occupied port is refused, and only the recorded process tree is stopped. The terminal equivalent from the repository root is `php -S 127.0.0.1:8080 -t catalog` (Ctrl+C stops it).

The accepted 2026-10-14 revision (1.3.0, REQ-034–036) retains the user's existing **Cloudflare Workers Static Assets** deployment at [Smart School Supplies catalog](https://smart-school-supplies-store.cincocharlie25.workers.dev/). The current artwork and inquiry-control update was published through GitHub commit 89ef5e0; Cloudflare's automatic build succeeded and the live assets match the tested source. See [verification results](VERIFICATION.md) for browser checks and limits. Future releases require publication and actual live verification before being described as deployed. This address is a Workers project rather than Pages.

Only public files from `catalog/` are served. Laravel/POS/IMS, MySQL records, accounts, real customer/payment records, secrets and backups remain on the store computer. The online catalog does not require Start Store to run; local staff transactions still require the main computer and store network. Keep the existing Worker project and Git connection; this scope adds no paid plan, public staff endpoint, Worker API or cloud database. Its asset directory must remain catalog-only, with `_headers` applying to static responses. Do not publish the repository root or `store-app/` as assets. See [Workers Git build settings](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/) and [static headers](https://developers.cloudflare.com/workers/static-assets/headers/).

The earlier 1.2.0/REQ-033 Pages approach is retained below as a historical accepted plan, superseded for the active host by REQ-034; it is not a reason to create a second project:

| Setting | Value |
|---|---|
| Hosting product | Cloudflare Pages with Git integration |
| Repository root directory | catalog |
| Framework preset | None |
| Build command | exit 0 |
| Build output directory | . |
| Public address | Cloudflare-generated pages.dev address after a successful deployment |

Publish the output from `catalog/` only. Do not use the repository root or `store-app/` as the public output. Do not upload `.env`, databases, accounts, orders/payments, private backups, runtime/logs or test artifacts. Staff manually maintain public catalog data; inventory changes do not synchronize to the website. Keep sample/demo labels visible until the store confirms real public products and prices.

Use the floating **Your list** control to open the inquiry. Add items and choose fulfillment, then select **Copy summary**. The Facebook/Messenger action unlocks only after the current nonempty summary is copied successfully. Changing quantities/items or fulfillment relocks it, so copy again before opening the Page. If clipboard access fails, the read-only text is selected: use the browser's native Copy action on the full selection. A successful trusted full-selection copy can unlock the link; partial copying, synthetic events and stale asynchronous copy results cannot. If copying cannot be confirmed, the link remains locked and recovery guidance stays visible.

The destination remains the supplied [Facebook Page](https://www.facebook.com/profile.php?id=61594157431738). After copying, open the Page, choose **Message**, paste and send the summary manually. Facebook may require sign-in; the Page must allow messaging. Staff confirm inquiries through Messenger and enter accepted sales/orders in the local Cashier workspace. GCash still uses staff verification in the store account.

**Clear all** empties the inquiry and removes only its saved cart (`smart-supplies-list-v1`). Its count, total and copy state reset; the current fulfillment selection stays. Other browser storage is untouched. When clearing disables the focused button, focus moves to Close. With browser storage available, the cleared basket stays empty after reload; an unlocked copy state never survives reload. Clearing this public inquiry does not change staff orders or MySQL records.

The current artwork is the supplied 213×184 Picture1 logo in the catalog and matching local staff brand, plus the supplied 1536×1024 banner shown whole on phones/tablets/desktops. Historical Plan.docx artwork instructions remain recorded. Sample/demo products and prices still require confirmation before replacing labels with real public content.

Static-asset requests on Workers are free and unlimited, while Worker-code requests have separate limits; no paid Cloudflare plan or purchased domain is needed for this existing workers.dev address. A custom domain is optional future work. See [static-asset billing](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/). After the tested source update deploys, check the actual live logo/banner, security headers, search/categories, quantities, copy gate/fallback, clearing and Page link on desktop, phone and tablet. HTTPS on the catalog does not change the local staff server's HTTP demo boundaries.
