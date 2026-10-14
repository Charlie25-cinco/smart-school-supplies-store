# Changelog

## 2.0.1 — 2026-10-14 (review corrections; not deployed)

- Fixed interrupted logout recovery with a private-workspace suspension and an online Finish sign out action before device reuse.
- Fixed exact and refreshed-version review retries to preserve the original captured business date; resolution also checks that date.
- Fixed stock-usage parity by restricting outgoing usage to internal consumables in the cloud UI/offline core and Laravel fallback.
- Fixed prepared-device reauthentication after an Admin email change while preserving the staff-ID check and queued evidence.
- Fixed cloud catalog sample-price labels to remain governed by the explicit demo setting.
- Added focused recovery, financial-date, inventory, identity and catalog-label regression coverage; verified 58 cloud tests, 73 Laravel tests, sequential cloud/legacy browser suites, launcher regressions, builds, syntax and 11 Edge-handler tests. Detailed results and limits are in docs/VERIFICATION.md.

## 2.0.0 — 2026-10-14 (cloud migration in progress; not deployed)

- Added the approved Cloudflare static staff PWA and Supabase migration workspace, with separate Admin and Cashier permissions.
- Added durable per-device offline transactions, stock allocations, sequential idempotent synchronization, order editing leases and visible review handling.
- Added Supabase read-only row policies, validated transaction RPCs and server-only Cashier account management with session revocation.
- Added private integrity-checked SQLite export and resumable Auth provisioning followed by atomic history import, preserving credentials and original record/receipt attribution.
- Fixed captured sale/payment dates across synchronization, uncertain account-operation recovery, phone catalog freshness and responsive product browsing.
- Changed the migration target to Singapore; customer inquiries continue through Facebook Messenger without registration.
- Preserved the existing Laravel/SQLite installation as the fallback. No real records have been transferred and no new cloud release is claimed.

## 1.3.0 — 2026-10-14

- Added a floating customer Your list control with synchronized item count and a Clear all action that removes the saved inquiry list.
- Changed Facebook/Messenger handoff to unlock after copying the current summary; item, quantity and fulfillment changes require copying again, with recovery for failed copying and stale copy attempts.
- Changed catalog and local staff branding to the newly supplied transparent logo and added the supplied, uncropped promotional banner to the responsive catalog hero.
- Recorded the user-created Cloudflare Workers Static Assets deployment as an accepted alternative to the earlier Pages preparation; staff operations and SQLite records remain local.
- Published the reviewed catalog update in GitHub commit 89ef5e0 and confirmed Cloudflare's successful build, matching live assets and 29 passing public browser checks.
- Added responsive, inquiry-control and copy-state regression coverage; retained prior verification history.

## 1.2.0 — 2026-10-14

- Added catalog-only Cloudflare Pages deployment preparation through the existing GitHub repository, using a free pages.dev address.
- Published the reviewed customer catalog source to GitHub in commit 2c48b74; Cloudflare account connection and live-site verification remain pending.
- Changed the public inquiry handoff to the supplied Facebook Page link while retaining demo/sample-price labels.
- Added catalog security-header and configured Page-link verification alongside existing inquiry workflows.
- Clarified that POS, inventory, accounts, orders and SQLite records remain on the store computer; cloud POS migration is cancelled.

## 1.1.3 — 2026-10-13

- Changed system UI design across Staff Workspace and Customer Catalog to a cohesive Modern Clean Retail design.
- Added layered card elevations, softer borders, and polished micro-interactions across panels, dialogs, and interactive buttons.
- Refined Dashboard overview metric tiles, stock alerts, payment summaries, and chart bars with clearer visual hierarchy.
- Refined POS product card hover states, category top borders, live basket count badge, cart line dividers, quantity controls, and checkout button.
- Refined status badge pills, order progress timeline step markers, and table header and row hover states across all staff views.
- Refined public storefront hero styling, search bar, benefits bar, product cards, service cards, and inquiry drawer.
- Preserved all approved minimum font sizes, 44px minimum touch targets, zero horizontal page overflow across breakpoints, and 100% axe accessibility passes.

## 1.1.2 — 2026-10-13

- Fixed desktop sidebar scrolling so navigation links scroll while the logo and account controls stay in place when space permits.
- Fixed visibility of the focused desktop navigation link when returning from the compact menu.
- Kept natural sidebar scrolling in very short windows so navigation and account controls remain reachable.
- Added short-window, keyboard, long-name and mobile-menu sidebar regression checks.

## 1.1.1 — 2026-10-13

- Fixed premature startup failure by waiting up to 45 seconds for the verified PHP server to listen.
- Fixed repeated Start checks so an existing process must become ready before the browser opens; retries reuse the owned process.
- Changed startup feedback to show continued waiting and distinguish a readiness timeout from a process that exited.
- Fixed exited-process detection during identity checks while retaining rejection of unrelated live PIDs.
- Added isolated delayed-start, timeout/retry and process-exit checks while retaining launcher ownership and shared-database safeguards.

## 1.1.0 — 2026-10-12

- Added Admin handoff of unfinished Admin-created orders to an active Cashier, with reassignment and stale-form protection.
- Added assignment visibility and Cashier access to handed-off orders and their paid receipts while preserving original creators, prices, reservations and payment records.
- Changed Cashier sales history to include payments they collected for Admin-origin orders; reassignment does not change collection attribution.
- Added an additive, nullable assignment migration and isolated permission, preservation, payment and responsive handoff checks.
- Fixed browser layout checks to request scrolling only for controls outside the viewport while retaining visibility, sizing and product-card assertions.

## 1.0.0 — 2026-10-12

- Changed staff access to separate Admin management and Cashier transaction workspaces; Admin reviews orders/sales without checkout or order mutations.
- Added Admin cashier-account creation, profile editing, password resets, and enable/disable controls with session revocation and retained transaction history.
- Added a non-destructive staff migration converting existing Owner accounts to Admin and enabling existing accounts.
- Fixed email-case consistency across login and cashier management/creation while preserving legacy stored addresses.
- Changed phone/tablet navigation and POS browsing/checkout to fit smaller screens with readable controls and preserved form recovery.
- Added role, session, migration, account-management, responsive and workflow regression checks; retained the local Laravel/SQLite and Messenger architecture.
- Removed the obsolete OwnerOnly middleware. This is a major version because Admin transaction permissions change; it remains a defense prototype.

## 0.7.1 — 2026-10-12

- Fixed order-action discoverability with explicit View order/Edit order buttons, phone cards, and a prominent detail-page edit action.
- Changed order guidance to show preparation/delivery steps, payment state, and the next staff action clearly.
- Fixed cramped POS browsing by placing search/filters and order controls in shorter rows while preserving readable product text and visible payment controls.
- Added complete-product-row, order-action, progress and responsive workflow checks; preserved existing records and business rules.

## 0.7.0 — 2026-10-12

- Added preparing/ready order editing for customer/contact/address/notes, with unpaid item and delivery-fee changes.
- Added transactional reservation adjustment, frozen retained-item prices, stale-edit detection, and paid/dispatched order safeguards.
- Changed manual-launch feedback and startup readiness based on measured launcher/server timing; kept the Artisan launch and owned-process checks.
- Added order-edit workflow, permission, rollback and startup timing verification; updated usage and design documentation.

## 0.6.0 — 2026-10-12

- Changed customer and staff screens to a cohesive navy/yellow retail design with locally bundled open-source typography.
- Changed POS layout to separate basket scrolling from visible payment/totals, with pickup/delivery details in a dedicated accessible dialog.
- Added inventory Items/Stock movements tabs and responsive item cards with clearer available/reserved quantities.
- Changed catalog shopping hierarchy, product/service cards, inquiry drawer, staff navigation, forms and reporting presentation.
- Added layout, modal recovery and payment-visibility checks; preserved SQLite records and existing transaction rules.

## 0.5.1 — 2026-10-12

- Added GitHub source-control handoff and fresh-clone setup guidance for the existing system.
- Changed repository exclusions to protect environment files, credentials, databases, backups and private keys at any project depth.
- Documented the current UI review request and preserved verification history for the next developer.

## 0.5.0 — 2026-10-11

- Changed the entire staff interface to a clean retail workspace with readable text, balanced spacing, and the supplied navy/yellow identity.
- Added consistent local SVG icons, a live basket item count, and grouped checkout/item forms.
- Changed desktop POS proportions, responsive navigation, tables, dialogs, order details, and receipt presentation; preserved approximately 80mm printing.
- Removed accumulated compact-layout overrides; readable controls and natural scrolling supersede strict fitting on short windows.
- Added typography, navigation, small-laptop, and checkout-reachability checks alongside existing workflow regressions.

## 0.4.3 — 2026-10-11

- Fixed POS page overflow on shorter laptop viewports, including the 1280x632 CSS viewport corresponding to the reported enlarged screenshot.
- Fixed the empty basket stretching to product-list height outside the fitted layout; bounded product scrolling and short-screen navigation.
- Changed the short-screen empty-basket message and padding so basic payment fields fit at the screenshot-equivalent size.
- Fixed short-screen validation recovery by allowing error messages and correction fields to use natural page height.
- Added shorter-window, basket-footer alignment, keyboard visibility, and zoom-equivalent screenshot checks.

## 0.4.2 — 2026-10-11

- Fixed unnecessary page scrolling in the desktop POS by fitting its panels below the page header and keeping checkout totals/actions visible.
- Changed staff page spacing, product cards, forms, tables, and empty states for a more compact workspace with accessible touch controls.
- Added short-screen layout checks for empty lists, checkout, and keyboard access alongside existing device/workflow checks.

## 0.4.1 — 2026-10-11

- Fixed tablet sign-out access, order-entry navigation, unchecked inventory settings, and stock-dialog validation recovery.
- Fixed stale checkout references after browser Back and normalized pasted GCash references before browser validation.
- Changed catalog and staff branding to the logo supplied in Plan.docx, with navy, warm-white, and yellow styling.
- Changed checkout layout, order status presentation, and per-transaction payment visibility for clearer daily use.
- Added isolated regression checks for validation recovery, tablet navigation, branding, and existing store workflows.

## 0.4.0 — 2026-10-10

- Added pickup/delivery orders, stock reservations, prepaid/COD collection, and verified manual GCash payment records.
- Added inventory category/status filters, printing-supply usage records, and available/reserved stock visibility.
- Changed staff screens with compact POS cards, clearer order/payment statuses, payment-method reporting, and a mobile basket shortcut.
- Added an additive SQLite migration, isolated transaction/UI checks, and operational/requirements documentation for the approved scope.

## 0.3.1 — 2026-10-10

- Added full SQLite demo-reset instructions covering backups, deleted records, restored sample inventory, and staff-account recreation.
- Changed README and agent guidance to link the reset procedure and distinguish documentation approval from permission to reset data.

## 0.3.0 — 2026-10-10

- Changed Start/Stop Store to launch Laravel Artisan over HTTP for the temporary LAN demo.
- Removed Apache/certificate setup from the demo workflow; first Start prepares runtime settings automatically.
- Changed quick-start documentation and local-server checks to the approved Artisan approach.
- Fixed inherited Windows process-pipe handling in verification and restored project-owner access to the existing runtime folder.
- Automatic startup and public publishing remain deferred.

## 0.2.0 — 2026-10-10

- Added manual standalone Apache/PHP setup, HTTPS certificates, and Start/Stop/Open launchers for local-network use.
- Added isolated simultaneous-checkout and Apache security/lifecycle verification.
- Changed operational documentation to describe one SQLite database shared through Laravel by connected store devices.
- Automatic startup and public publishing remain deferred; no Windows services or startup tasks are installed.

## 0.1.0 — 2026-10-10

- Added a static school supplies catalog with an order summary and configurable Messenger handoff.
- Added a local Laravel and SQLite POS, staff access, cash receipts, inventory movements, and sales reporting.
- Added sample products and services, setup instructions, requirements traceability, and automated verification.
- Deployment is deferred until after the defense.
