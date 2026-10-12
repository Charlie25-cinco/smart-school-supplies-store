# Changelog

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
