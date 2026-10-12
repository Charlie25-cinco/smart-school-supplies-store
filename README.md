# Smart School Supplies Store

A BSIT Technopreneurship prototype: a static customer catalog with Facebook/Messenger inquiries, and a local Laravel 13 + SQLite point of sale and inventory system. Public deployment is deferred until after the defense.

This README is operational documentation, not a claim of full ISO/IEC/IEEE 29148 compliance. [Requirements](docs/REQUIREMENTS.md) applies unique IDs, sources, rationale, priorities, acceptance criteria, and implementation traceability; formal validation and lifecycle artifacts are simplified.

## What is included

- **Catalog:** search, category filters, supplies and academic services, an essentials list, pickup/delivery preference, copyable inquiry summary, and a configurable Facebook Page or Messenger link.
- **POS:** products and service charges, cash/verified GCash payments, cash change, paid receipts, server-controlled pricing, and duplicate-submission protection.
- **Orders and delivery:** confirmed pickup/delivery orders, customer/preparation details, agreed delivery fees, prepaid or payment-on-collection arrangements, and fulfillment statuses.
- **Inventory:** item details, incoming stock, unpaid-order reservations, owner-recorded printing-supply usage, category/status filters, movement history, and low-stock alerts.
- **Reporting:** today's sales and product units, a seven-day revenue chart, and date-filtered sales history.
- **Permissions:** owners manage inventory and review all orders/sales; cashiers record sales/orders and access only their own records.
- **Manual local server:** Start/Stop launchers run `php artisan serve`; connected devices share one SQLite database. HTTP is for the temporary defense demo on trusted Wi-Fi with sample data. Automatic startup is deferred.

Sample products, stock quantities, and prices are illustrative, not verified store data. Services are charged per the displayed unit; owners record actual paper/ink usage manually. GCash payments are verified by staff in the store account, without a gateway/API integration. Reports show collected sales revenue including delivery fees, not net profit; unpaid orders are shown separately. Receipts are sales acknowledgments, not BIR-registered invoices.

The 0.4.1 refresh uses the original logo from Plan.docx throughout both applications. Navy actions, warm-white surfaces, and small yellow accents match the store's branding. **New order** starts in pickup mode; select delivery when needed. Stock forms reopen with entered values after server validation fails, and sign out remains accessible on tablets. Sales rows show cash/GCash methods. No database migration is required for this refresh; rebuild assets with `npm.cmd run build` from `store-app/` and reload the browser.

## Requirements and folders

The 0.5.0 staff redesign uses a clean retail workspace throughout login, navigation, Overview, POS, Orders, Inventory, Sales, and receipts. Body text and inputs are 16px; product names are 18px and prices 24px. Desktop POS fits its panels on windows at least 1101px wide and 720px high in CSS pixels, with separately scrolling products/details and accessible totals/actions. Shorter windows prioritize readability and allow natural page scrolling. Tablet navigation wraps; phones stack POS panels with a basket shortcut. The public catalog retains its existing design. Rebuild assets from `store-app/` with `npm.cmd run build`, then reload (Ctrl+F5 if older styling remains); no database migration or reset is needed.

Use PHP 8.3+ with PDO SQLite, Composer, and Node.js compatible with Vite 7 (20.19+ or 22.12+). Your existing Laragon PHP supports SQLite; MySQL does not need to run.

```text
catalog/       Static files for local preview and future Cloudflare Pages deployment
store-app/     Laravel app, SQLite migrations, views, and tests
scripts/       Browser/accessibility verification with isolated test data
docs/          Requirements, architecture/design decisions, and defense walkthrough
```

The two applications do not synchronize automatically. The catalog's `products.json` is manually maintained; it never reads the local SQLite file. Staff confirm inquiries through Messenger and enter confirmed, paid sales into the POS. Editing the local inventory does not publish catalog updates.

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
if (-not (Test-Path database/database.sqlite)) { New-Item database/database.sqlite -ItemType File }
php artisan key:generate
php artisan migrate --seed
npm.cmd ci
npm.cmd run build
php artisan store:staff --role=owner
```

The staff command prompts for a name, login email, and a password of at least 12 characters. Password entry is hidden and only its hash is stored. No default staff account or shared password is seeded. Create a cashier with `php artisan store:staff --role=cashier` if needed. Use the credentials you entered to sign in at **http://127.0.0.1:8000**.

Run these setup commands only for a new installation; your existing installation and staff account can be reused. Run **key:generate** only during initial setup. Assets need rebuilding only after source edits.

Double-click **Start Store.cmd** in the project folder. It opens **http://127.0.0.1:8000** and prints possible network addresses. On a phone/tablet connected to the same Wi-Fi, open **http://YOUR-COMPUTER-IP:8000** using the computer's active Wi-Fi address. Double-click **Stop Store.cmd** after everyone finishes. See the [short local guide](docs/LOCAL_DEPLOYMENT.md) for firewall and connection troubleshooting. No certificate or separate server setup is needed. PHP must remain installed; Laragon's application need not run.

The equivalent terminal command, from `store-app/`, is `php artisan serve --host=0.0.0.0 --port=8000`. Stop an existing terminal server with Ctrl+C before using the launcher on the same port. HTTP sends credentials and records without transport encryption: use this temporary demo only with sample data/accounts on trusted Wi-Fi; production HTTPS remains future work.

In a second terminal, from the repository root:

```powershell
php -S 127.0.0.1:8080 -t catalog
```

Open **http://127.0.0.1:8080**. Use an HTTP server rather than double-clicking `index.html`, because the catalog loads JSON. Ctrl+C stops each server. The POS works offline once dependencies and assets are installed; Messenger requires internet.

Laravel must be served from `store-app/public/` if using a Laragon virtual host. Serving the project root can expose `.env` and database files. The commands above serve the correct application directory automatically.

To start the sample POS over, follow [Reset the demo database](docs/LOCAL_DEPLOYMENT.md#reset-the-demo-database). This deletes staff accounts, sales, and inventory changes; back up first and recreate the owner afterward.

See [Orders, payments, and supply usage](docs/LOCAL_DEPLOYMENT.md#orders-payments-and-supply-usage) for the new workflow. Existing installations moving to 0.4.0 must stop the server, back up SQLite, and run `php artisan migrate` from `store-app/` before restarting. This additive upgrade preserves existing accounts, items, and sales; never use `migrate:fresh` to apply an upgrade. Existing sales retain cash as their payment method.

## Facebook/Messenger configuration

Edit `catalog/config.js` and set `messengerUrl` to either:

- `https://m.me/YourPageUsername` for a direct conversation; or
- `https://www.facebook.com/YourPageUsername` for the Page, where the customer selects **Message**.

Keep it blank for the defense demo if a Page does not exist; the catalog clearly shows that the link is unconfigured and still supports copying the summary. The link never sends a message automatically. Customers copy, open, paste, and send. The Facebook Page must permit messaging for staff to receive inquiries.

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

PHP tests use an in-memory SQLite database. Browser checks create a separate temporary SQLite database under ignored `artifacts/`, launch their own local servers, and use a randomly generated test-only password. They do not change the real store database. UI checks use installed Microsoft Edge or Google Chrome; set `BROWSER_EXECUTABLE` to a supported Chromium executable if neither is available. Screenshots at desktop (1440px), tablet (768px), and phone (375px) widths are written to `artifacts/`. Accessibility checks use axe and cover WCAG 2 A/AA and WCAG 2.1 A/AA rules; automated checks do not certify full accessibility compliance.

## GitHub handoff

Source repository: [Charlie25-cinco/smart-school-supplies-store](https://github.com/Charlie25-cinco/smart-school-supplies-store). The public repository contains application/catalog source, the original logo copies, documentation, launchers, tests, example configuration, and dependency lockfiles. Each new clone follows the dependency setup above and creates its own local SQLite database and staff account. Credentials, store records, private backups, runtime files, browser artifacts, dependencies, and compiled assets stay excluded. Run `npm.cmd run build` after installing dependencies to create the ignored assets locally.

For the next developer, begin with [AGENTS.md](AGENTS.md), [requirements](docs/REQUIREMENTS.md), [architecture/design](docs/ARCHITECTURE.md), [CHANGELOG.md](CHANGELOG.md), and [verification results](docs/VERIFICATION.md). The user remains dissatisfied with the current visual design and wants Claude to review/improve it. The earlier automated passes establish the observed workflow/layout checks, not acceptance of the visual result. Propose UI changes for approval under the project workflow; retain the existing SQLite, payment, inventory, and local-server behavior unless a new scope is approved.

GitHub source upload is independent of website hosting; public deployment remains deferred.

## Future publishing and costs

After the defense, connect GitHub to Cloudflare Pages and publish **only `catalog/`**. For this buildless catalog, use root directory `catalog`, no build command, and output directory `.`. Test relative asset paths, `products.json`, and the configured link before launch. Laravel, `.env`, SQLite files, staff records, and transaction data stay local.

- **Free approach:** GitHub Free for source control and Cloudflare Pages' free static hosting with a `pages.dev` address. A custom domain is optional; registration and renewal are separate from free DNS.
- **Paid growth option:** Cloudflare Pro/Business for higher Pages build limits; a separately hosted Laravel app and managed database if remote store access later becomes necessary. These add recurring cost and require a separate deployment/security/data-residency review based on the chosen provider.

No cloud customer database is used in this prototype. Public visitors who follow the Facebook link use Meta's service and its privacy terms. Store databases and backups contain staff details and transaction records; keep them outside public repositories. For a simple offline backup, stop the POS and copy the SQLite file, retaining `.env` separately in secure storage for application recovery. Do not copy an actively written database as a backup.

See [the defense walkthrough](docs/DEFENSE.md), [architecture and design](docs/ARCHITECTURE.md), [verification results](docs/VERIFICATION.md), and [agent instructions](AGENTS.md).
