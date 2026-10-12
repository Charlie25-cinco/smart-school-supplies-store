# Verification record — 2026-10-12

This is an observed verification record, not a full ISO/IEC/IEEE 29148 compliance claim. Requirement IDs and traceability are in REQUIREMENTS.md; formal independent validation is simplified.

## Milestone 0.5.1 — GitHub source handoff

Observed pre-upload checks for the user-approved source transfer to Charlie25-cinco/smart-school-supplies-store. This milestone changes exclusions and handoff documentation, not application behavior or UI. The user remains dissatisfied with the visual result and intends Claude to review it; automated passes do not establish stakeholder acceptance. Historical records follow unchanged. Remote publication is confirmed separately by comparing the committed local HEAD with GitHub main after push.

| Check | Result | Observed evidence |
|---|---|---|
| PHP tests / Composer | PASS | composer test: 32 tests, 257 assertions; composer validate --no-check-publish. Composer was initially slow to produce output, then completed successfully without source changes. |
| Formatting / syntax | PASS | Application and both fixture Pint checks; PHP syntax on 44 files, JavaScript syntax on 8 files, PowerShell parser checks on 3 scripts. |
| Frontend build | PASS | npm.cmd run build: 32.01 kB CSS, 7.97 kB JavaScript. Build output remains ignored; new clones build assets locally after installing dependencies. |
| UI workflows / accessibility / responsiveness | PASS | npm.cmd run test:ui: existing catalog, login/logout, checkout/receipt, inventory forms, COD/prepaid orders, manual GCash, cancellation, validation recovery and keyboard checks pass. Twenty states pass selected axe A/AA rules; twelve screens checked at 375/768/1024/1440px; no JavaScript page errors. These checks do not certify full accessibility or approve the design. |
| Local server / shared SQLite | PASS | npm.cmd run test:local: shared-database cashier requests, last-unit rejection, duplicate checkout, COD reservation protection, idempotent GCash collection, manual Start/Stop/restart, unrelated-PID and occupied-port safeguards pass. Isolated totals: five sales/references, four product units, zero reserved, 17,400 centavos revenue. |
| Git exclusions / source review | PASS | Reviewed 123 staged files, approximately 4.15 MB before Git compression. Twenty sensitive/generated path cases are ignored. Safe .env.example is included with blank/null secret placeholders. Actual .env, databases, credentials, backups/keys, dependencies, builds, runtime/logs and artifacts are absent. Checked known token/private-key/embedded-credential patterns found no matches. Only source binaries are the two supplied logo copies and existing favicon. GitHub noreply author metadata is used. |
| Data preservation / scope / cleanup | PASS | Actual SQLite and .env SHA-256 values match the private baseline. Application, catalog, scripts, dependency manifests/lockfiles and configuration retain their baseline hashes; only .gitignore, AGENTS.md, CHANGELOG.md, README.md and this verification record changed. Isolated test databases/sidecars cleaned. |
| Documentation / handoff whitespace | PASS | Local Markdown link targets and balanced code fences checked. Git whitespace check passes on the handoff-edited files. The full initial snapshot reports three pre-existing whitespace-only blank lines in unused store-app/resources/views/welcome.blade.php (179/191/203); they are preserved and are not introduced by this source-handoff task. README includes clone/setup guidance and the outstanding visual-review request. |
| Physical devices / actual browser zoom / printer / live payments or messaging | NOT RUN | This source handoff uses isolated automated checks and fictional data; no physical-device/printer or external account transaction performed. |
| Type checking / migration / hosting deployment / automatic startup | NOT APPLICABLE | No TypeScript and no application/schema changes. This uploads source only; website publication and startup installation remain deferred. |

## Milestone 0.5.0 — full staff UI redesign

The user accepted a clean retail workspace with readable text and balanced spacing. REQ-021 explicitly replaces the earlier strict short-window fitting clauses; the historical results below remain intact. Shorter windows may scroll naturally, and checkout details can scroll internally without shrinking the text.

| Check | Result | Observed evidence |
|---|---|---|
| PHP tests / Composer | PASS | composer test: 32 tests, 257 assertions; composer validate --no-check-publish. Backend and dependency manifests/lockfiles retain their pre-build fingerprints. |
| Formatting / syntax | PASS | Application and both isolated-fixture Pint checks; PHP syntax on 44 files, JavaScript syntax on 8 files, PowerShell parser checks on 3 scripts. Final edited UI harness and POS JavaScript rechecked. Blade views compiled and rendered by the isolated browser suite. |
| Frontend build | PASS | Final npm.cmd run build: 32.01 kB CSS, 7.97 kB JavaScript. Consolidated staff CSS, icons, forms and live basket count are compiled for browser reload. |
| Readability / responsive layout — REQ-021 | PASS | Body/input text at least 16px, tables 15px, product names 18px and prices 24px in the checked layouts. Twelve screens pass overflow/branding/navigation checks at 375/768/1024/1440px. Local SVG navigation icons and 44px navigation targets checked. Five POS states pass seven standard/short sizes; fitted desktop totals/actions visible, short-window controls reachable through scrolling, footer gap within 2px, checked primary controls at least 44px. Empty payment fields fit without internal clipping at 1440x1000. |
| Keyboard / recovery / print | PASS | Last product and sign out reachable at 1280x632; cash input and submit reachable by Tab at short/tablet widths. Duplicate GCash reference recovery checked at 1024x560. Mobile basket shortcut focuses checkout; native stock dialog closes with Escape. Print rendering hides navigation and keeps receipt width within 303 CSS pixels (approximately 80mm). |
| UI workflows / accessibility | PASS | Final npm.cmd run test:ui: catalog, owner login/logout, cash sale/receipt, stock deduction, item creation, restock/usage validation recovery, COD delivery, GCash collection, prepaid pickup, unpaid cancellation and duplicate-reference correction pass. Live basket count checked. Twenty states pass the selected axe A/AA rules; no browser JavaScript errors. Automated results are not full WCAG certification. |
| Visual polish | PASS | Reviewed final login, Overview, empty/populated POS, short/phone/tablet layouts, grouped item form, order detail, inventory and print screenshots. Empty-basket presentation, header spacing and fieldset dividers refined after review. Final suite captures 92 screenshots with fictional test data. |
| Local server / shared SQLite | PASS | npm.cmd run test:local under the ordinary Windows account: concurrent cashier requests, last-unit rejection, duplicate submission, COD reservation protection and idempotent verified GCash collection. Manual Start/repeated Start/Stop/restart and unrelated-PID/occupied-port safeguards pass. Five sales, five references, four product units, zero reserved and 17,400 centavos revenue in the isolated fixture. Artisan may serialize requests; this is not a parallel-worker load claim. |
| Data preservation / source / documentation | PASS | Actual store SQLite SHA-256 matches the private pre-build baseline. Changes confined to staff views/CSS/POS JavaScript, UI harness and six documentation/changelog files (21 source files, including one new SVG component). Public catalog/logo files, backend, schema, launchers, configuration, dependencies and lockfiles unchanged. Isolated test database/sidecar cleanup and expected fingerprints checked; local Markdown links/code fences checked. |
| Physical devices / actual browser zoom / printer / external accounts | NOT RUN | Viewport/device-scale emulation and print screenshots do not establish physical-device, Wi-Fi, actual zoom or printer compatibility. No live GCash/Facebook account contacted. |
| Type checking / Git diff / migration / deployment / automatic startup | NOT APPLICABLE | No TypeScript or Git repository in this workspace; fingerprints used for source review. This redesign requires no migration, publication or startup changes. |

Resolved findings: short-window diagnostics identified a 0.078px viewport-boundary discrepancy; the check now uses a 1px rounding tolerance consistent with overflow checks. Short windows use natural basket positioning, and empty-basket spacing was refined within the accepted UI scope. One final syntax command initially used a root-relative path from store-app; it was corrected to ../scripts/verify-ui.mjs and passed. Final required checks pass with no unresolved failure. Historical results follow.

## Milestone 0.4.3 — shorter-screen POS correction

The 0.4.2 checks missed short desktop viewports below 680 CSS pixels high. The user's screenshot exposed product-list growth and basket stretching in that fallback. This accepted correction extends coverage rather than treating the earlier checks as proof for that size.

| Check | Result | Observed evidence |
|---|---|---|
| PHP tests / Composer | PASS | composer test: 32 tests, 257 assertions; composer validate --no-check-publish. Backend source and dependency manifests/lockfiles unchanged. |
| Formatting / syntax | PASS | Application and both isolated-fixture Pint checks; PHP syntax on 44 files, JavaScript syntax on 8 files, PowerShell parser checks on 3 scripts. UI harness syntax checked after its final edit. |
| Frontend build | PASS | Final npm.cmd run build: 40.08 kB CSS, 7.88 kB JavaScript. Assets already rebuilt for browser reload. |
| Short-screen layout — REQ-020 | PASS | Empty, counter, three-line, delivery/COD and prepaid GCash POS states fit all seven sizes: 1366x768, 1280x720, 1024x768, 1280x679, 1280x632, 1366x600 and 1024x560. No vertical/horizontal document overflow; totals/actions visible; footer bottom within 2px of basket bottom. Checked POS controls remain at least 44px high. |
| Screenshot comparison / compact fallback | PASS | 1280x632 CSS viewport at device scale 1.5 produces a 1920x948 comparison image. Empty checkout details fit without internal scrolling at that size. At 1280x500, the product list stays bounded, the basket has no footer gap, and focused payment is visible with normal page scrolling. The comparison does not establish the user's actual zoom/OS scale. |
| Keyboard / validation recovery | PASS | Last product and sign out reachable at 1280x632; cash input and submit reachable by Tab. After server rejection of a duplicate GCash reference, the correction field and submit remain visible/reachable at 1024x560 through natural page height. Mobile basket shortcut still focuses checkout. |
| UI workflows / accessibility / responsiveness | PASS | Final npm.cmd run test:ui passes catalog, cash sale/receipt, item creation/restock/usage, COD delivery, GCash collection, prepaid pickup, duplicate-reference correction, cancellation and sign-out workflows. Twenty states pass checked axe A/AA rules; twelve screens pass horizontal overflow/branding/navigation checks at 375px, 768px and 1440px. No JavaScript page errors. |
| Visual polish / print | PASS | Reviewed final 1920x948 comparison, short empty/counter POS, very short fallback, phone/tablet layouts and receipt rendering. Empty-message padding was reduced after the first visual review so payment inputs fit the comparison viewport. Final suite captures 80 screenshots. Checked axe rules and screenshots are not full WCAG certification. |
| Local server / shared SQLite | PASS | npm.cmd run test:local under the ordinary Windows account: concurrent cashier requests, last-unit rejection, duplicate checkout, COD reservation protection, idempotent GCash collection, manual Start/Stop lifecycle and unrelated-PID/occupied-port guards. Isolated totals: five sales, five references, four units, zero reserved, 17,400 centavos revenue. Artisan may serialize requests; no parallel-worker load claim. |
| Data preservation / scope / documentation | PASS | Actual store SQLite SHA-256 matches the pre-build private baseline. Only staff CSS, UI harness and six documentation/changelog files changed; no views, catalog, backend, schema, launch scripts, configuration or dependencies changed. Isolated test databases/sidecars removed. Markdown link targets/code fences and expected source fingerprints checked. |
| Physical devices / actual browser zoom / printer / live payment or messaging | NOT RUN | CSS viewport/device-scale emulation does not establish physical screen, Wi-Fi, actual browser zoom, or printer compatibility. Test data is fictional; no external account contacted. |
| Type checking / Git diff / migration / deployment / automatic startup | NOT APPLICABLE | No TypeScript or Git repository in this workspace; source fingerprints used for review. No migration or deployment/startup work required. |

One initial JavaScript syntax command used a root-relative path from store-app and was corrected to ../scripts/verify-ui.mjs before checks continued. Final required checks pass; no unresolved failure remains. Historical results follow.

## Milestone 0.4.2 — compact staff workspace

| Check | Result | Observed evidence |
|---|---|---|
| PHP tests | PASS | composer test: 32 tests, 257 assertions, covering checkout, inventory, permissions, reservations, COD/prepaid payments and validation recovery. |
| Formatting / syntax | PASS | Application and isolated-fixture Pint checks; PHP syntax on 44 files, JavaScript syntax on 8 files, and parser checks on 3 PowerShell scripts. Final edited UI harness rechecked. |
| Composer / frontend build | PASS | composer validate --no-check-publish and npm.cmd run build. Final Vite output: 39.23 kB CSS and 7.88 kB JavaScript. No dependency/lockfile changes. |
| Laptop layout — REQ-019 | PASS | Empty dashboard, Orders and Sales fit 1366x768 without vertical document overflow; the Add item form also fits. Empty, counter, three-line, delivery/COD and prepaid GCash POS states fit 1366x768, 1280x720 and 1024x768; totals and submit remain within each viewport. Checked POS touch controls are at least 44px high. |
| Keyboard / small window | PASS | Tab reaches payment method, cash input and submission; focused cash input remains inside the visible scrolling region. COD payment-plan Tab reaches submission. At 800x600, normal page scrolling brings the focused action into view. Mobile basket shortcut still focuses checkout. This tests CSS viewport behavior, not physical-device or browser-zoom certification. |
| UI workflows / accessibility / responsiveness | PASS | npm.cmd run test:ui: cash sale/receipt, stock deduction, restock recovery, item creation, COD delivery, verified manual GCash collection, prepaid pickup, duplicate-reference recovery, cancellation, supply usage, catalog and sign-out flows pass. 19 states pass checked axe A/AA rules; 12 screens pass horizontal-overflow/logo/navigation checks at 375px, 768px and 1440px. No JavaScript page errors. |
| Visual polish / print | PASS | Reviewed laptop empty/populated POS, dashboard, empty Orders, item form, tablet delivery, phone POS and print receipt screenshots. Paired payment controls align when labels wrap. Final suite captures 57 screenshots including short-screen states and print rendering. Automated checks are not complete WCAG certification. |
| Local server / shared SQLite | PASS | npm.cmd run test:local under the ordinary Windows account: concurrent cashier requests, last-unit rejection, duplicate submission, reservation protection and idempotent GCash collection. Start/repeated Start/Stop/restart/repeated Stop and unrelated-PID/occupied-port safeguards pass. Five paid sales, five references, four product units, zero remaining reservation, and 17,400 centavos revenue in the isolated fixture. Artisan can serialize requests; no parallel-worker load claim. |
| Database / source / documentation | PASS | Actual store SQLite SHA-256 matches the private pre-build baseline. Changes are confined to staff CSS/views, UI checks and accepted-amendment documentation/changelog. Catalog, logo assets, backend, schema, launch scripts, configuration, dependencies and lockfiles retain their baseline hashes. Test databases/sidecars and temporary servers are removed; generated assets/artifacts remain ignored. Local Markdown links and code fences checked. |
| Physical devices / actual printer / live payment or messaging | NOT RUN | Phone/tablet emulation and print rendering do not establish hardware or Wi-Fi compatibility. All test customer/payment data is fictional; no external account was contacted. |
| Type checking / Git diff / migration / deployment / automatic startup | NOT APPLICABLE | No TypeScript or Git repository in this workspace; source fingerprints used for scope review. Layout changes require no migration, publication or startup configuration. |

Resolved finding: the first laptop check detected 41px of dashboard overflow. Reduced chart, card, panel and empty-state spacing within the approved scope and reran the affected build/UI checks. The final required checks pass with no unresolved failures. Historical milestone results follow.

## Milestone 0.4.1 — workflow recovery, supplied logo, and UI refresh

| Check | Result | Observed evidence |
|---|---|---|
| Laravel tests | PASS | composer test: 32 tests, 257 assertions. Existing checkout/order/payment/reservation/access/report tests retained; additional tests cover permitted order-entry modes, server-derived stock-dialog recovery without mutation, and unchecked Active validation/deactivation. |
| PHP formatting | PASS | php vendor/bin/pint --test and separate checks for both isolated PHP fixtures. Formatting was applied only to the three changed PHP files. |
| Source syntax | PASS | 44 application/config/migration/seeder/test/fixture PHP files, 8 catalog/script/frontend JavaScript files, and 3 PowerShell scripts checked. Changed browser/history script syntax rechecked after fixes. |
| Composer validation / frontend build | PASS | composer validate --no-check-publish and npm.cmd run build from store-app. Final Vite build succeeded; package/composer manifests and lockfiles match their baseline fingerprints. |
| Browser workflow regressions | PASS | npm.cmd run test:ui: counter sale/change/receipt/print, catalog filtering/retry/list/summary/handoff, restock/item creation, unpaid delivery, GCash collection, prepaid pickup, cancellation, usage and reporting. New order starts in pickup mode; duplicate GCash preserves the basket; failed stock forms reopen with draft values; unchecked Active remains unchecked; pasted GCash references normalize; browser Back refreshes a submitted checkout reference; tablet sign out succeeds. |
| Accessibility / responsive layout | PASS | 17 screen/dialog states passed checked axe WCAG A/AA rules; 12 screens passed document-overflow, sign-out visibility where applicable, and document-logo loading checks at 375px/768px/1440px (36 screenshots). No browser page errors. Automated checks do not establish full WCAG certification. |
| Visual polish / print | PASS | Reviewed fresh desktop POS, tablet POS/catalog, phone order detail, and print receipt for typography, spacing, hierarchy, consistent brand/status colors, logo framing, and responsive navigation. Corrected checkout corner clipping during the polish pass and reran the build/UI suite. Receipt print rendering uses the document logo. |
| Shared SQLite / local server | PASS | npm.cmd run test:local under the ordinary Windows account: two cashier sessions, last-unit contention, repeated checkout, COD reservation blocking another sale, and concurrent GCash collection producing one paid sale/deduction. Start/repeated Start/Stop/restart/repeated Stop, protected paths, HTTP session-cookie properties, and unrelated-PID/occupied-port safeguards passed. The development server can serialize client requests; this is not a parallel-worker load test. |
| Isolated local totals | PASS | 5 paid sales, 5 references, 4 product units sold, notebook/black/blue pen stock zero, reserved zero, revenue 17,400 centavos. Test databases/sidecars and temporary servers removed after verification. |
| Artwork provenance / data preservation | PASS | Both local logo PNGs are identical to the original word/media/image1.png in Plan.docx. Actual store SQLite SHA-256 remains equal to its pre-build baseline. No migration, reset, seeding, or real payment/order submission was performed against that database. |
| Documentation / source scope | PASS | README, AGENTS, requirements/design explanation, changelog and this record updated for the accepted amendment. Local document link targets and code fences checked. Source changes are limited to the approved catalog branding/styles, staff views/styles/JS, POS/inventory controllers, regression tests and documentation, plus two new logo assets. Launch scripts, schema, existing transaction services, framework configuration and dependencies retain baseline hashes. Generated build/QA/runtime files remain ignored. |
| Physical phone/tablet network / printer / live payment or messaging | NOT RUN | Emulation and print rendering do not establish physical Wi-Fi/firewall/printer compatibility. Only fictional customer/payment records and inert Messenger examples were tested; no external account contacted. |
| Type checking / Git diff / migration / publishing / automatic startup | NOT APPLICABLE | No TypeScript or Git repository in the workspace; file fingerprints used for scope review. This refresh requires no migration and keeps deployment/startup boundaries unchanged. |

Resolved verification findings: separated adjacent Blade directives to correct dialog compilation; accounted for browser history restoration when refreshing checkout state; awaited asynchronous clipboard feedback in the browser harness; restored checkout panel clipping on stacked layouts. One rebuild was initially invoked from the repository root and corrected to the documented store-app directory. All final required checks passed with no unresolved failures. Prior milestone results below are historical, not new executions for those versions.

## Milestone 0.4.0 — orders, GCash, inventory and staff UI

| Check | Result | Observed evidence |
|---|---|---|
| PHP tests | PASS | composer test: 29 tests, 229 assertions, including reservations, COD/prepaid collection, GCash exact amounts/unique references, cancellations, snapshots, access control, usage and reports. |
| Formatting and syntax | PASS | Application Pint plus isolated fixtures; 49 PHP files, 8 JavaScript files and 3 PowerShell scripts checked. Final changed files rechecked after fixes. |
| Composer / frontend build | PASS | composer validate --no-check-publish and npm.cmd run build; no dependency or lockfile changes. |
| UI regression | PASS | npm.cmd run test:ui; previous catalog/POS flows plus unpaid delivery, verified GCash collection, prepaid pickup, cancellation, internal supply creation/usage and payment totals. |
| Accessibility / responsiveness | PASS | 17 checked screens/dialog states passed axe tags; checked screens passed 375px/1440px document-overflow checks; mobile basket total/quantity and keyboard focus destination verified. No browser page errors. Automated checks are not full WCAG certification. |
| Visual / print review | PASS | Fresh desktop/mobile POS and order detail screenshots reviewed for hierarchy, readability, spacing, alignment, status feedback and palette consistency. Receipt print rendering retained in browser checks. |
| Shared-database server checks | PASS | npm.cmd run test:local under ordinary Windows account: two cashier sessions, competing last-unit sales, duplicate checkout and COD reservation blocking another cashier. Two concurrent GCash collection requests created one sale and one deduction. PHP development server may serialize these client requests; no parallel-worker/load claim. |
| Isolated local totals | PASS | 5 sales, 5 distinct references, 4 physical units deducted, notebook/black/blue pen stocks zero, no remaining reservations and revenue 17,400 centavos including the agreed delivery fee. |
| Lifecycle / protected files | PASS | Start/repeated Start/Stop/restart/repeated Stop; guest/role checks, HttpOnly HTTP session cookies, blocked sensitive paths, mismatched PID and occupied-port refusal. Test servers stopped and QA databases/sidecars removed. |
| Additive migration / existing records | PASS | Tested migration on a private copy first. The original SQLite checksum stayed unchanged throughout isolated tests. Applied only the new migration to the backed-up store database; row counts and record hashes for existing users, product fields, sales, movements and other original tables matched before/after. New orders/reservations are empty; historical sales default to cash/zero delivery fee. No reset or seeding of live data performed. |
| Documentation / source scope | PASS | README, agent guidance, requirements, architecture, defense, local operations and changelog updated for the expressly approved amendment. Links/anchors/code fences checked. Source inventory includes only the approved order/payment models/services/controller/migration/tests, relevant existing checkout/inventory/report files, staff views/assets and verification scripts/docs. Catalog, launchers, secrets and dependency manifests/lockfiles unchanged. |
| Restored local server | PASS | Previously running manual Artisan demo restored after migration verification. Its login page responds and guest orders access requires login. Only the user's restored server remains running; temporary test instances stopped. |
| Physical tablet/phone network / printer | NOT RUN | Browser emulation and print rendering do not establish physical Wi-Fi/firewall/device or printer compatibility. |
| Live GCash / Messenger | NOT RUN | Only fictional payment references/customer details used; no real payment account or Messenger Page contacted. |
| Payment gateway / production HTTPS / publishing / automatic startup | NOT APPLICABLE | Manual GCash recording only; other deployment/integration features remain deferred. |
| Git diff / TypeScript | NOT APPLICABLE | No Git repository or TypeScript frontend; source inventory/timestamps reviewed. |

Resolved within the approved scope: the movement screen needed its staff relationship; browser-submitted usage quantities needed conversion to integers for SQLite expression comparison (now covered by a string-quantity test); browser harness adds form-validity/error diagnostics; an incorrect GCash test amount was corrected to the actual sample price, which the application had correctly rejected. Private backups/copy checks remain in ignored .runtime/backups and contain sensitive store data; they are not public artifacts. Final required checks have no unresolved failures.

## Historical milestone 0.3.0 — simplified Artisan HTTP demo

The following results describe the preceding version and test totals.

| Check | Result | Observed evidence |
|---|---|---|
| PHP tests | PASS | composer test: 17 tests, 114 assertions. |
| PHP formatting | PASS | Application Pint check and separate ui-fixture.php/local-server-fixture.php checks. |
| Syntax | PASS | 42 PHP files, 7 JavaScript files, and all 3 remaining PowerShell scripts. |
| Composer validation | PASS | composer validate --no-check-publish. |
| Frontend build | PASS | npm.cmd run build produced the Vite assets. |
| UI/accessibility/responsive checks | PASS | npm.cmd run test:ui; catalog and staff flows, axe checks and 375px/1440px overflow checks passed; no browser page errors. |
| Visual review | PASS | Fresh desktop/mobile POS screenshots reviewed for spacing, hierarchy, alignment and consistent styling. No UI source changes in this milestone. |
| Artisan HTTP server/access | PASS | npm.cmd run test:local; HTTP login, guest redirect, cashier role denial, HttpOnly non-Secure session cookies and protected-file rejection. |
| Shared SQLite checkouts | PASS | Two independent cashier contexts submitted concurrent client requests; last-unit attempts produced one sale and one rejection; duplicate submission returned one receipt. Windows PHP development server serializes requests; this is not a parallel-worker load benchmark. |
| Isolated totals | PASS | 4 sales, 4 distinct references, 3 physical units deducted, notebook/pen stock zero and revenue 14,200 centavos. |
| Manual lifecycle/process ownership | PASS | Start, repeated Start, Stop, restart and repeated Stop; HTTP refused connections after Stop. Mismatched PID and occupied port rejected without terminating an unrelated application. |
| Store-data isolation | PASS | Actual database SHA-256 unchanged before/after checks. Test databases and sidecars removed; temporary servers stopped. No real staff credentials printed. |
| Expected file scope | PASS | Changes limited to launch/common scripts, local-server verification, CHANGELOG/README/AGENTS and the relevant docs. Obsolete Setup-LocalServer.ps1 and Apache configuration template removed. Root .cmd launchers reused. Ignored runtime/QA/build artifacts changed as expected; project-owner runtime access rule repaired. Dependency lockfiles and application source unchanged. |
| Git diff | NOT APPLICABLE | Workspace has no Git repository; source inventory and file timestamps reviewed instead. |
| Physical phone/tablet/LAN/firewall checks | NOT RUN | Browser emulation does not establish access from a physical device. Host IP selection, host power, Wi-Fi isolation and firewall access remain checks before presenting. |
| HTTPS/certificate setup | NOT APPLICABLE | User accepted HTTP for a temporary sample-data demo on trusted Wi-Fi; production HTTPS is deferred. |
| Automatic startup/publication | NOT APPLICABLE | Explicitly deferred; no startup task, Windows service, firewall/trust-store change or publication performed. |
| Live Messenger/printer hardware | NOT RUN | No real Page supplied or physical printer exercised. |

Diagnostics resolved: Windows descendants retained a test subprocess pipe, so the harness now observes process exit; the cookie selector now accepts Laravel's hyphenated session name. The earlier private runtime ACL omitted the workspace owner; an access rule now grants that owner access while retaining existing rules. Process-tree termination is blocked inside the execution sandbox, so the full isolated local-server suite passed under the ordinary Windows account. The initial fixture-format command used an incorrect filename; both actual fixtures passed the corrected command. No required checks remain failing.

## Historical milestone 0.2.0 — manual LAN server

The following records describe the superseded Apache/HTTPS implementation, not the current startup requirements.

| Check | Result | Observed evidence |
|---|---|---|
| PHP tests | PASS | composer test: 17 tests, 114 assertions. |
| PHP formatting | PASS | Pint application check and separate checks of both isolated fixtures. |
| PHP/JS/PowerShell syntax | PASS | 40 PHP files; both browser scripts, catalog/config and app/POS JavaScript; all four PowerShell scripts parsed without errors. |
| Composer validation | PASS | composer validate --no-check-publish. |
| Frontend build | PASS | npm.cmd run build; existing production assets built successfully. No frontend dependency changes. |
| Existing UI/accessibility/responsive checks | PASS | npm.cmd run test:ui; all checked screens passed axe and 375px/1440px overflow checks; no browser page errors. |
| Standalone Apache/HTTPS | PASS | npm.cmd run test:local launched Apache with independent configuration/PHP INI; HTTPS certificate and hostname validated using the explicitly supplied local CA. No Windows trust-store changes were made. |
| Access and protected files | PASS | Guest POS redirected; both test cashiers denied inventory access; secure/HttpOnly session cookies; .env, .git/config, database/log paths and encoded traversal returned 400/403/404. |
| Simultaneous checkouts | PASS | Two independent cashier contexts completed simultaneous notebook sales; competing pen sales with one remaining unit yielded one receipt and one stock error. Concurrent duplicate submission produced one service sale/receipt. |
| Shared SQLite totals | PASS | Isolated final database: 4 sales, 4 distinct references, 3 physical units deducted, notebook/pen stock 0, revenue 14,200 centavos. |
| Manual lifecycle | PASS | Start, repeated Start, Stop, restart, repeated Stop; HTTPS stopped responding after Stop. Temporary Apache was stopped at test completion. |
| Test data isolation | PASS | New fixture rejects any database except artifacts/lan-test.sqlite in testing environment; compiled views and random staff credentials isolated. Test database and sidecar files removed. No accounts, migrations, or sales were written to the actual store database by this suite. |
| Physical phone/tablet access and certificate installation | NOT RUN | No physical device configured; browser contexts on the host do not establish Wi-Fi/firewall/device trust compatibility. |
| Actual LAN/firewall/power setup | NOT RUN | Localhost runtime prepared; store IP selection, certificate trust, firewall rule and host power settings are documented deployment steps. |
| Reboot/automatic startup | NOT APPLICABLE | User explicitly deferred automatic startup; no services, startup tasks, or reboot introduced. |
| Cloudflare publication | NOT APPLICABLE | Publishing remains deferred; catalog configuration documented. |
| Live Messenger/printer hardware | NOT RUN | No real Page URL supplied or physical printer exercised. |

Windows setup diagnostics resolved within the approved scope: the bundled Apache OpenSSL executable failed with missing-entry-point status, so setup uses the working installed Git OpenSSL executable; native stderr handling was corrected for Windows PowerShell; runtime ACL updates change access rules only; process ownership uses recorded PID/path/start time instead of restricted WMI; manual Stop controls the console server rather than attempting to stop an uninstalled Windows service. Existing application checkout code did not require modification.

Expected source scope: .gitignore, root Start/Stop launchers, deploy/windows template, four PowerShell scripts, isolated fixture/local-server browser test, package.json verification script, README/AGENTS/CHANGELOG, and requirements/architecture/defense/local-deployment/verification documents. Generated .runtime, artifacts, compiled views, and Vite assets are ignored. Dependencies and lockfiles were not changed. Git diff remains unavailable because this workspace has no Git repository.

## Historical milestone 0.1.0

The following checks describe the original build and its data at that time, before the user created a staff account; they are not current store-record counts.

| Check | Result | Observed evidence |
|---|---|---|
| `composer test` | PASS | 17 tests, 114 assertions; guest/role restrictions, exact monetary totals, atomic rollback, duplicate protection, server pricing, stock movements, historical receipts, report dates, staff creation, and safe re-seeding. |
| `php vendor/bin/pint --test` | PASS | Application formatting check passed. The fixture script also passed its separate Pint check. |
| PHP syntax checks | PASS | Application, configuration, migrations, routes, tests, and browser fixture passed `php -l`. |
| JavaScript syntax checks | PASS | Catalog/config, app/POS JavaScript, and browser verification script passed `node --check`. |
| `composer validate --no-check-publish` | PASS | Composer manifest is valid. |
| `npm.cmd run build` | PASS | Vite generated the production CSS/JS and manifest. |
| `npm.cmd run test:ui` | PASS | Installed Edge completed catalog search/filtering, empty/error recovery, list persistence, inquiry/link behavior, keyboard dialog dismissal, owner login/logout, cash checkout, receipts, stock deduction/restock, item creation, and sales reporting. |
| Responsive checks | PASS | Catalog, login, dashboard, POS, receipts, inventory, item form, and sales report had no horizontal document overflow at 1440px and 375px widths. |
| Automated accessibility | PASS | axe WCAG 2 A/AA and 2.1 A/AA tags reported zero violations on catalog, basket, login, dashboard, POS, receipt, inventory, restock dialog, item form, and sales screens. This is not complete accessibility certification. |
| Visual/print review | PASS | Desktop/mobile screenshots reviewed for layout, spacing, contrast, and consistency; receipt print-media rendering captured. |
| Browser JavaScript errors | PASS | No page errors during the completed walkthrough. |
| Store data isolation | PASS | Actual SQLite database retained 17 sample items, 0 staff accounts, 0 sales, and original Spiral Notebook stock of 48. Test database was removed after the browser run. |
| Expected file scope | PASS | Initial workspace was empty. Source additions are limited to the catalog, Laravel application, verification scripts, and documentation. Composer/npm lockfiles are expected installation artifacts; local secrets, SQLite, dependency/cache/build directories, and QA artifacts are ignored. |
| Git diff | NOT APPLICABLE | The supplied workspace was not a Git repository; file inventory was reviewed instead. No remote repository was created or pushed. |
| TypeScript checks | NOT APPLICABLE | Frontend uses JavaScript, not TypeScript. |
| Cloudflare deployment | NOT APPLICABLE | User deferred deployment until after the defense. |
| Real Facebook/Messenger handoff | NOT RUN | No actual store Page/link was supplied. Configured-link rendering was tested using an inert example URL without contacting Meta. |
| Physical receipt printer | NOT RUN | Browser print rendering was checked; no printer hardware was available or configured. |

## Issues resolved during verification

- Windows JavaScript imports were corrected to use file URLs.
- Browser navigation selectors were made exact where multiple links had matching text.
- Parallel PHP test runs collided on Windows compiled-view files. Tests were re-run sequentially and browser QA now uses its own compiled-view directory.
- Inactive pagination labels received readable contrast and native disabled controls.
- Date controls were made flexible and mobile navigation was compacted.
- Hidden receipt text escaped the table scroll container at phone width. A rendered diagnostic confirmed that positioning the table wrapper reduced document width from 561px to 375px; the final full browser run passed.

The final required verification suite has no unresolved failures. Screenshots and machine-readable UI results are in ignored `artifacts/`. Create the owner's account privately with `php artisan store:staff --role=owner` before your demonstration.
