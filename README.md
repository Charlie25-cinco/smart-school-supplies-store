# Cloud migration status — 2.0.1

The accepted target is a Cloudflare-hosted customer catalog and staff PWA backed by Supabase in Singapore. Admin manages inventory and Cashier accounts; Cashiers handle POS and their authorized orders. Prepared devices record offline changes using allocated stock and synchronize when connected. Customers still send inquiries through Facebook Messenger without accounts.

Implementation and isolated verification are in progress. The existing live catalog and local Laravel installation remain available; the new cloud system is not deployed and real records have not been imported. See [cloud setup and cutover](docs/CLOUD_DEPLOYMENT.md), [requirements](docs/REQUIREMENTS.md) and [verification](docs/VERIFICATION.md). Documentation applies simplified ISO/IEC/IEEE 29148 traceability, not full compliance.

Cloud development: Node.js 22.13+; in `cloud-app/`, run `npm.cmd ci`, copy `.env.example` to ignored `.env.local` and configure only the public Supabase URL/publishable key. Run `npm.cmd test` and `npm.cmd run build`; the public deployment directory is `cloud-app/dist/`. `npm.cmd run dev` serves the staff development UI; a built preview is required for service-worker/offline checks. Staff require online sign-in and device preparation before offline use. Account creation, allocating stock and moving an order between devices require internet. Never clear site data or sign out while saved changes need synchronization/review.

The accepted 2.0.1 review corrections preserve original business dates on review retries, limit outgoing supply usage to **Internal supply** items in both staff implementations, and retain public sample-price labels while `demo: true`, including cloud/cached catalog views. If Admin changes your email, restore a prepared session with the current address for the same staff account; another account cannot adopt its saved work. If logout is interrupted, the private workspace stays locked across reload: reconnect and select **Finish sign out**, then sign in again. Safe interrupted-logout recovery requires Web Locks support in the same browser profile. See [cloud operation and recovery](docs/CLOUD_DEPLOYMENT.md#working-offline).

The local setup below is retained for the existing system and fallback; it does not deploy the cloud version.

# Smart School Supplies Store

A BSIT Technopreneurship prototype: a static customer catalog with Facebook/Messenger inquiries, and a local Laravel 13 + MySQL point of sale and inventory system. Only the catalog is online at [the customer website](https://smart-school-supplies-store.cincocharlie25.workers.dev/), using Cloudflare Workers Static Assets; store records and staff operations stay on the main computer.

This README is operational documentation, not a claim of full ISO/IEC/IEEE 29148 compliance. [Requirements](docs/REQUIREMENTS.md) applies unique IDs, sources, rationale, priorities, acceptance criteria, and implementation traceability; formal validation and lifecycle artifacts are simplified.

## What is included

- **Catalog:** search, category filters, supplies and academic services, a floating essentials list, Clear all, pickup/delivery preference, copyable inquiry summary, and a Facebook Page or Messenger link enabled after copying.
- **POS:** products and service charges, cash/verified GCash payments, cash change, paid receipts, server-controlled pricing, and duplicate-submission protection.
- **Refunds:** full-order paid refunds with mandatory reasons, goods-returned and manual-GCash confirmations, product restocking, preserved originals, and gross/refund/net reporting.
- **Inventory:** Admin-managed item details, photos, descriptions, category selection, safe deletion of never-transacted items, incoming stock, unpaid-order reservations, printing-supply usage, filters, movement history, and low-stock alerts.
- **Orders and delivery:** confirmed pickup/delivery orders, customer/preparation details, agreed delivery fees, prepaid or payment-on-collection arrangements, and fulfillment statuses.
- **Order editing:** preparing/ready customer corrections, with unpaid item/fee edits and safe reservation adjustment. Paid financial details and dispatched/finished orders are locked.
- **Reporting:** today's sales and product units, gross/refund/net totals, a seven-day revenue chart, and date-filtered sales history.
- **Workspaces:** Admin manages inventory/cashier accounts and reviews all orders/sales; Cashiers record transactions and access their own orders/receipts/history. Both roles have Settings for profile and password self-service plus a collapsible sidebar.
- **Cashier accounts:** Admin creates/edits cashiers with usernames, resets passwords and enables/disables access (each behind an explicit confirmation); reset/disable ends existing sessions and preserves records. Staff sign in with their username; passwords stay at least 12 characters.
- **Manual local server:** Start/Stop launchers run `php artisan serve`; connected devices share one MySQL database. Laragon's MySQL service must be running before the store starts. HTTP is for the temporary defense demo on trusted Wi-Fi with sample data. Automatic startup is deferred.

Sample products, stock quantities, and prices are illustrative, not verified store data. Services are charged per the displayed unit; Admin records actual paper/ink usage manually. GCash payments are verified by staff in the store account, without a gateway/API integration. Reports show gross, refunded, and net revenue including delivery fees; unpaid orders are shown separately. Receipts are sales acknowledgments, not BIR-registered invoices.

The 0.4.1 refresh uses the original logo from Plan.docx throughout both applications. Navy actions, warm-white surfaces, and small yellow accents match the store's branding. **New order** starts in pickup mode; select delivery when needed. Stock forms reopen with entered values after server validation fails, and sign out remains accessible on tablets. Sales rows show cash/GCash methods. No database migration is required for this refresh; rebuild assets with `npm.cmd run build` from `store-app/` and reload the browser.

## Requirements and folders

Current 1.0.0 staff access separates management from transactions. Existing Owner accounts become **Admin**, with the same login credentials. Admin lands on Overview and has Inventory, Cashier accounts, Orders review, and Sales reports. **Cashier accounts → Add cashier** creates a dedicated POS login; use Manage account to edit name/username, reset a password, or disable/enable access. Cashier passwords must be confirmed and at least 12 characters. Reset/disable ends their existing sessions. Accounts are retained with their historical orders/receipts; this page cannot create or modify Admin accounts.

Cashiers land on POS and have Orders & delivery plus My sales/receipts. They manage their own orders and Admin-origin orders currently assigned to them, under the existing paid/status restrictions. Admin reviews all records and can hand off eligible legacy orders; checkout, customer/item editing, payment and delivery updates remain Cashier functions. The system remains a defense prototype. Apply the additive upgrades described in the [local guide](docs/LOCAL_DEPLOYMENT.md#upgrade-existing-staff-access-to-100); do not reset your database.

Historical orders created by an Owner remain attributed to that account after it becomes Admin. In **Orders review → View order → Hand off to cashier**, Admin can select an active Cashier to finish an unfinished Admin-created order. No recipient is selected automatically. The original creator, agreed prices and existing receipts remain intact. Reassignment removes the previous Cashier's order access; payments remain in the actual collector's history. See the [handoff guide](docs/LOCAL_DEPLOYMENT.md#hand-off-an-unfinished-admin-order). Login and account-username uniqueness ignore letter casing.

On desktop, the sidebar keeps the logo and account controls in place while navigation links scroll when needed. Keyboard focus reveals links inside that region. Very short windows allow natural sidebar scrolling so every control stays reachable.

Phones and tablets use **Menu** for their role's pages and Sign out. At narrow POS widths, **Products / Current sale** switches between browsing and checkout without clearing the basket. Current sale contains fulfillment/channel, Customer details, quantities, payment and confirmation. Use Products to continue shopping. Wider tablets retain a two-panel POS with compact navigation. Responsive forms/cards preserve readable text and touch controls; validation reveals the relevant checkout panel/dialog. Local access still requires the main computer and store network; there is no PWA or disconnected-device synchronization.

The 0.6.0 redesign brings the customer site and staff workspace together with stronger navy/yellow branding, the original document logo, and locally served Inter typography. The catalog emphasizes browsing, illustrated products, academic services, and a side-panel inquiry list. Staff body/inputs are 16px, product names 18px, and prices 24px. Desktop POS fits from 1101x768 CSS pixels; basket lines scroll while cash/GCash fields, totals, and confirmation remain outside that region. Shorter windows allow natural scrolling. Phones stack the POS with a basket shortcut and show inventory as item cards. Inventory separates **Items** from **Stock movements** with keyboard-operable tabs.

For pickup/delivery, select **Fulfillment**, open **Customer details**, enter the contact/address/fee and payment arrangement, then select **Use these details**. Record prepaid cash/GCash in the main checkout area, or confirm an unpaid collection order. Validation restores the relevant fields. The shorter POS toolbar gives products more room; wrapped names and stock/prices stay inside each card. Rebuild assets from `store-app/` with `npm.cmd run build`, then reload (Ctrl+F5 if older styling remains). The 1.0.0 role upgrade requires the additive migration above; no reset is needed. Inter is distributed under the [SIL Open Font License](catalog/assets/fonts/LICENSE.txt); the UI makes no remote font requests.

In **Orders & delivery**, use the labeled **View order** button for preparation, dispatch, collection and completion; **Edit order** opens corrections directly while Preparing/Ready. The order number is a reference. Phones show the same actions in order cards. The detail page shows current progress, a prominent Edit button, and **Next step** to reach the required staff action. Open **How pickup & delivery orders work** for the short workflow guide. Payment and delivery status remain separate: COD collection must be recorded before delivery/pickup completes.

Use PHP 8.3+ with PDO MySQL, Composer, and Node.js compatible with Vite 7 (20.19+ or 22.12+). Laragon provides PHP and the MySQL 8.x service; start MySQL before the store server.

```text
catalog/       Static customer files for local preview and Cloudflare hosting
store-app/     Laravel app, MySQL migrations, views, and tests
scripts/       Browser/accessibility verification with isolated test data
docs/          Requirements, architecture/design decisions, and defense walkthrough
```

The two applications do not synchronize automatically. The local catalog preview reads the store database live; the published catalog ships only the reviewed `products.json` file. Staff confirm inquiries through Messenger and enter confirmed, paid sales into the POS.

## Dependency setup (PowerShell)

For a fresh clone, start in PowerShell from your desired parent folder:

```powershell
git clone https://github.com/Charlie25-cinco/smart-school-supplies-store.git
cd smart-school-supplies-store
```

From the repository root:

```powershell
cd store-app
composer install
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
```

Then create the `smart_store` database in Laragon (HeidiSQL as root) and a least-privileged user with full rights on it, and set `DB_CONNECTION=mysql` plus the host/port/database/username/password in `.env`. Never share passwords in chat. Continue setup with:

```powershell
php artisan key:generate
php artisan migrate --seed
npm.cmd ci
npm.cmd run build
php artisan store:staff --role=admin
```

The staff command creates the first Admin and prompts privately for a name, username and password of at least 12 characters. No default staff account/password is seeded. Sign in at **http://127.0.0.1:8000**, then use **Cashier accounts → Add cashier**. The cashier CLI option remains available; `--role=owner` is a compatible alias for Admin.

Run these setup commands only for a new installation; your existing installation and staff account can be reused. Run **key:generate** only during initial setup. Assets need rebuilding only after source edits.

Double-click **Start Store.cmd** in the project folder. It opens **http://127.0.0.1:8000** and prints possible network addresses. On a phone/tablet connected to the same Wi-Fi, open **http://YOUR-COMPUTER-IP:8000** using the computer's active Wi-Fi address. Double-click **Stop Store.cmd** after everyone finishes. See the [short local guide](docs/LOCAL_DEPLOYMENT.md) for firewall and connection troubleshooting. No certificate or separate server setup is needed. PHP must remain installed; Laragon's application need not run.

The launcher shows **Starting the local store**, progress during a longer wait, and elapsed server-start time. It waits up to 45 seconds for PHP to listen before opening the browser. Start it once for a working session; leave it running while staff use the system. Repeating Start checks readiness and reuses the existing instance. If the wait expires while PHP remains alive, wait a moment and run Start again; if PHP exited, the message directs you to the private runtime logs. Browser-opening and first-page time are additional to the displayed server-start measurement. See the [startup guide](docs/LOCAL_DEPLOYMENT.md#what-startstop-do). No setup or database migration is needed for 1.1.1.

The equivalent terminal command, from `store-app/`, is `php artisan serve --host=0.0.0.0 --port=8000`. Stop an existing terminal server with Ctrl+C before using the launcher on the same port. HTTP sends credentials and records without transport encryption: use this temporary demo only with sample data/accounts on trusted Wi-Fi; production HTTPS remains future work.

Double-click **Start Catalog.cmd** in the project folder to preview the customer catalog at **http://127.0.0.1:8080**; double-click **Stop Catalog.cmd** when finished. Repeating Start reuses the running preview. Use an HTTP server rather than double-clicking `index.html`, because the catalog loads JSON.

The equivalent terminal command, from the repository root, is:

```powershell
php -S 127.0.0.1:8080 -t catalog
```

Open **http://127.0.0.1:8080**. Ctrl+C stops the terminal server. The POS works offline once dependencies and assets are installed; Messenger requires internet.

Laravel must be served from `store-app/public/` if using a Laragon virtual host. Serving the project root can expose `.env` and other private files. The commands above serve the correct application directory automatically.

To start the sample POS over, follow [Reset the demo database](docs/LOCAL_DEPLOYMENT.md#reset-the-demo-database). This deletes staff accounts, sales, and inventory changes; back up first and recreate the Admin afterward.

See [Orders, payments, and supply usage](docs/LOCAL_DEPLOYMENT.md#orders-payments-and-supply-usage) for the new workflow. Existing installations moving to 0.4.0 must stop the server, back up SQLite, and run `php artisan migrate` from `store-app/` before restarting. This additive upgrade preserves existing accounts, items, and sales; never use `migrate:fresh` to apply an upgrade. Existing sales retain cash as their payment method.

## Facebook/Messenger configuration

Edit `catalog/config.js` and set `messengerUrl` to either:

- `https://m.me/YourPageUsername` for a direct conversation; or
- `https://www.facebook.com/YourPageUsername` for the Page, where the customer selects **Message**.

Keep it blank for the defense demo if a Page does not exist; the catalog clearly shows that the link is unconfigured and still supports copying the summary. The link never sends a message automatically. The Facebook Page must permit messaging for staff to receive inquiries.

Use the floating **Your list** button anywhere in the catalog. Choose quantities and pickup/delivery, then select **Copy summary**. **Open Facebook Page** becomes available after the current summary is copied; choose **Message** on the Page, paste, and send. Editing the list or fulfillment requires copying again. If automatic copying fails, the selected summary can be copied with Ctrl+C or the phone's Copy action; the Page stays locked until the full summary is copied. **Clear all** empties the saved list while keeping the fulfillment selection. Copied status is not saved between visits.

The 1.3.0 update uses the newly supplied transparent logo in both applications and the supplied promotional banner in the customer hero. Images are fitted without cropping. Rebuild staff assets with `npm.cmd run build` after pulling source changes; no database migration is needed.

`config.js` and `products.json` contain public data only. Set `demo: false` and replace sample content before an actual business launch. Set `STORE_DEMO=false` in the local `.env` when the store is using real records.

## Verification

From `store-app/`:

```powershell
composer test
php vendor/bin/pint --test
npm.cmd run build
npm.cmd run test:ui
npm.cmd run test:local
```

PHP tests run against an isolated MySQL database (`smart_store_test`). Browser checks create isolated databases the same way, launch their own local servers, and use a randomly generated test-only password. They do not change the real store database. UI checks use installed Microsoft Edge or Google Chrome; set `BROWSER_EXECUTABLE` to a supported Chromium executable if neither is available. Screenshots at desktop (1440px), tablet (768px), and phone (375px) widths are written to `artifacts/`. Accessibility checks use axe and cover WCAG 2 A/AA and WCAG 2.1 A/AA rules; automated checks do not certify full accessibility compliance.

## GitHub handoff

Source repository: [Charlie25-cinco/smart-school-supplies-store](https://github.com/Charlie25-cinco/smart-school-supplies-store). The public repository contains application/catalog source, the original logo copies, documentation, launchers, tests, example configuration, and dependency lockfiles. Each new clone follows the dependency setup above and creates its own MySQL database and staff account. Credentials, store records, private backups, runtime files, browser artifacts, dependencies, and compiled assets stay excluded. Run `npm.cmd run build` after installing dependencies to create the ignored assets locally.

For the next developer, begin with [AGENTS.md](AGENTS.md), [requirements](docs/REQUIREMENTS.md), [architecture/design](docs/ARCHITECTURE.md), [CHANGELOG.md](CHANGELOG.md), and [verification results](docs/VERIFICATION.md). The 0.5.1 source handoff preceded the user's accepted 0.6.0 redesign and subsequent request for bolder styling. Automated passes establish observed workflow/layout checks; visual acceptance remains the user's judgment. Future changes follow the approval workflow and retain MySQL, payment, inventory, and local-server behavior unless a new scope is approved.

GitHub source upload is independent of website hosting. The accepted 1.3.0 amendment keeps the user-created Workers Static Assets deployment as an alternative to the earlier 1.2.0 Pages plan. Both publish only the customer catalog; the repository must never contain private store data.

## Publish the customer catalog

The existing [customer website](https://smart-school-supplies-store.cincocharlie25.workers.dev/) uses **Cloudflare Workers Static Assets**. Keep the GitHub integration publishing **only `catalog/`** from **Charlie25-cinco/smart-school-supplies-store**, branch **main**. Its actual provider build settings must be inspected in Cloudflare; they have not been read through an authenticated account in this session. Sign in through provider authorization screens; do not share passwords or API tokens in chat.

The earlier accepted 1.2.0 Pages preparation remains documented below as an alternative, rather than a requirement to recreate the working deployment:

| Setting | Value |
|---|---|
| Production branch | `main` |
| Framework preset | `None` |
| Root directory | `catalog` |
| Build command | `exit 0` |
| Build output directory | `.` |

Pages supplies an HTTPS `pages.dev` address; the current Workers deployment uses its `workers.dev` address. No custom domain purchase is required. After each catalog update, verify the live home page, product JSON, local font/logo/banner, security headers, phone/tablet layouts and inquiry flow. See [verification results](docs/VERIFICATION.md) for observed checks and limits.

The catalog uses the supplied Facebook Page link, so the inquiry button says **Open Facebook Page**. Customers copy their inquiry summary, open the Page and choose Message to paste/send it. The Page's messaging availability must be checked in Facebook; link-format checks do not verify the Page itself. Keep `demo: true` and sample-price labels until the real public product/service prices are confirmed. Catalog availability is confirmed by staff; it is not connected to local stock.

Laravel, `.env`, MySQL records, staff accounts, orders, payments and transaction data stay local. Never select the repository root or `store-app/` as the public asset directory. Scope excludes cloud POS hosting, a cloud database, public staff access and disconnected-device synchronization.

- **Free approach:** GitHub Free for source control and Workers Static Assets with a `workers.dev` address (Pages is an alternative). [Static requests are free and unlimited](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/); Worker-code invocations and account settings are separate. A custom domain is optional; registration and renewal are separate from DNS.
- **Paid growth option:** Workers Paid if future Worker code needs higher limits, or paid Laravel hosting and a managed database if remote store access is approved later. These add cost and require provider-specific data-residency/privacy review. Static hosting alone does not require the paid plan.

No cloud customer database is used in this prototype. Public visitors who follow the Facebook link use Meta's service and its privacy terms. Store databases and backups contain staff details and transaction records; keep them outside public repositories. For a simple offline backup, stop the POS and export the MySQL database (HeidiSQL export or `mysqldump`), retaining `.env` separately in secure storage for application recovery. Do not back up while sales are being recorded.

See [the defense walkthrough](docs/DEFENSE.md), [architecture and design](docs/ARCHITECTURE.md), [verification results](docs/VERIFICATION.md), and [agent instructions](AGENTS.md).
