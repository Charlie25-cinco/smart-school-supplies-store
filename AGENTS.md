# Agent entry point

This file describes repository operations and conventions. It is not a full ISO/IEC/IEEE 29148 specification; [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) contains the requirements and traceability using a simplified application of the standard.

## Workflow and authorization

Follow the user's AI Engineering Standard v1.3.0: Plan → Build → Verify → Explain. Present a clear Accept / Reject scope before Build; approval applies once to that scope. Return to Plan for approval if scope expands. Verification follows automatically; resolve failures within approved scope and escalate repeated unresolved failures. Never change specifications merely to make implementation appear compliant.

Approved scope: static customer catalog with a copyable inquiry summary and configurable Facebook/Messenger handoff; local Laravel POS and inventory; owner/cashier permissions; cash receipts and sales reporting. The user explicitly approved **SQLite** and deferred public deployment until after the defense. Do not publish, configure paid services, create live payment integrations, or synchronize cloud/local inventory without authorization.

Approved 0.4.0 amendment (2026-10-10): local pickup/delivery orders, prepaid and cash-on-delivery/collection, staff-verified manual GCash payments, inventory reservations/filters/supply usage, and modest staff-UI refinements. GCash has no API or automatic verification. Orders/customer details remain local; use fictional data on the HTTP demo network. No public order tracking, payment gateway, paid refund/void, or automatic supply-consumption formula was approved. Update REQUIREMENTS/ARCHITECTURE for this explicit amendment; preserve prior records through an additive migration and private backup.

Approved 0.4.1 refresh (2026-10-11): review/fix existing workflows with isolated regression checks, use the original Plan.docx logo in catalog and staff screens/receipts/icons, and refine navy/warm-white/yellow styling and device layouts. No schema change, reset, publication, automatic startup, or new business module is included. Document logo PNG copies live at catalog/assets/logo.png and store-app/public/brand/logo.png; preserve the supplied artwork. Check tablet navigation at 768px alongside 375px/1440px, and verify recovery after invalid movement/item/payment submissions.

Approved 0.5.0 full staff UI redesign (2026-10-11): the user selected a clean retail workspace and accepted the full staff scope (login, shell/navigation, Overview, POS, Orders/detail/payment, Inventory/forms/dialogs, Sales, and receipts). Use 16px body/inputs, 18px product names, 24px product prices, 44px minimum touch controls, local SVG icons, and restrained navy/yellow branding. Consolidate staff CSS; keep the public catalog, backend, database, and deployment unchanged. REQ-021 explicitly supersedes the strict small-window fitting clauses of REQ-019/020: standard desktop POS fits from 1101x720 CSS pixels; short windows allow natural scrolling with controls reachable. Preserve historical requirement/verification records. Verify readability, responsive layouts at 375/768/1024/1440, short-window keyboard recovery, workflows, and approximately 80mm print rendering. See ARCHITECTURE.md for the current design system.

Maintain `CHANGELOG.md` with version/date and Added/Changed/Fixed/Removed entries. Update README and these instructions when setup, usage, or agent conventions change. The initial milestone is 0.1.0, dated 2026-10-10 in Asia/Manila.

Approved 0.5.1 source handoff (2026-10-12): initialize Git, connect https://github.com/Charlie25-cinco/smart-school-supplies-store, review source/configuration exclusions, run verification, and commit/push the project to the existing public repository. This authorizes source upload only; hosting/deployment remains deferred. Include source, original logo copies, docs, scripts, tests, lockfiles and safe .env.example; exclude real .env, SQLite/records, credentials, private backups/keys, dependencies, builds, runtime/logs and test artifacts. Use GitHub noreply commit metadata. Preserve historical verification records; Git-based scope checks are available from this milestone. README documents fresh-clone setup. The user intends Claude to review/improve the UI and has not accepted the visual result; prior automated passes do not imply stakeholder satisfaction. New UI implementation still requires an accepted plan.

## Project map

The 0.4.2/0.4.3 accepted amendments below are historical; REQ-021 and the approved 0.5.0 direction supersede their strict short-window fitting rules.

Approved 0.4.3 short-screen correction (2026-10-11): fix the user's reported POS blank-space/scrolling regression. Keep fitted desktop panels from 1001px width/560px height in CSS pixels; smaller windows retain bounded products and a naturally sized basket. Short desktop navigation scrolls internally. Verify 1280x632, 1366x600, 1024x560 and the former 680px boundary alongside prior sizes; assert no blank region below the checkout footer. A 1280x632 CSS viewport at device scale 1.5 is a screenshot comparison, not proof of the user's actual zoom setting. Preserve normal keyboard access and existing workflows. Scope is POS CSS, browser checks, and documentation only; REQ-020 records the accepted correction.

Approved 0.4.2 compact-layout amendment (2026-10-11): reduce staff spacing and fit the laptop POS below the header, with scrollable products/checkout details and visible totals/actions. Preserve 44px touch controls and all existing form behavior. Test 1366x768 empty lists and POS, plus short laptop, tablet, and phone layouts; allow normal page scrolling on smaller/zoomed windows and long content. Changes are limited to staff views/styles, UI verification, and documentation; no schema, business-rule, catalog, deployment, or startup changes. REQ-019 records the acceptance criteria.

- `catalog/`: buildless HTML/CSS/JS, sample `products.json`, public `config.js`, Cloudflare `_headers`.
- `store-app/`: Laravel 13, SQLite, Blade, Vite. No React or external API required.
- `docs/REQUIREMENTS.md`: stakeholder/system requirements, design constraints, acceptance criteria and traceability.
- `docs/ARCHITECTURE.md`: transactional checkout, permissions, storage, and visual direction.
- `docs/DEFENSE.md`: prototype demonstration and boundaries.
- `docs/VERIFICATION.md`: observed checks, results, and verification limits.
- `scripts/`: browser/accessibility checks and isolated fixtures.
- `docs/LOCAL_DEPLOYMENT.md`: manual launch, LAN/firewall troubleshooting, timeout, backups, and the full demo-database reset procedure.
- Root Start/Stop Store launchers call PowerShell scripts; generated settings and logs stay inside ignored `.runtime/artisan`.

Current approved milestone 0.3.0 supersedes the Apache/HTTPS setup from 0.2.0: the user accepted simple manual `php artisan serve` launchers with HTTP for a temporary sample-data defense demo on trusted Wi-Fi. No certificates or separate setup script are required. Production HTTPS remains future work; do not present HTTP as appropriate for real store credentials/records. Automatic startup, service installation, and publishing remain deferred. Do not change firewall/trust/startup settings or Laragon-managed configuration. Scripts verify PID, executable path, and launch timestamp before controlling the owned process tree. The launcher sets insecure HTTP session cookies only in its child process and bypasses cached configuration without altering `.env`. Run browser verification sequentially; each suite uses isolated data and compiled views. Include **npm.cmd run test:local** and PowerShell parser checks in required verification.

## Conventions

POS validation-error pages use natural height rather than the fitted panel constraint, preserving visible correction fields and submission in short windows. Keep that recovery behavior in responsive checks.

- Store money as integer centavos. Validate decimal input before parsing it; never trust browser prices or totals.
- Checkout, reservations, payment, and stock movements use database transactions. Available stock is stock minus reserved. Conditional writes prevent overselling; unique checkout references and normalized GCash references prevent duplicate recording.
- Confirmed unpaid orders reserve products. Payment deducts stock/releases reservations once and creates a sale from frozen order prices. Cancelled unpaid orders release reservations once; dispatched goods must be confirmed returned. Paid cancellations/refunds are outside scope. Completed fulfillment requires payment.
- Services do not automatically consume stock. Internal supplies use kind=consumable, are excluded from POS, and support owner-recorded usage with actor/reason. Usage cannot consume reserved stock. Item kind is immutable; old order/receipt snapshots never change after product edits.
- Owners manage inventory and view all orders/sales. Cashiers see their own records; guest access is forbidden. Order receipts remain attributed to the creator; paid_by records the staff member collecting payment. No public registration or default credentials.
- Passwords are entered privately with `php artisan store:staff`, hashed by Laravel, and never printed/logged. Secrets are in ignored `.env`; no secrets in catalog configuration.
- Database and runtime files remain ignored. Never commit database files, real staff data, transaction data, logs, or screenshots of sensitive content.
- The documented demo reset uses `php artisan migrate:fresh --seed` followed by `php artisan store:staff --role=owner`; it removes accounts, sales, and inventory edits. Approval to document these commands does not authorize executing a reset. Never verify reset documentation against the actual store database; use read-only command/source checks or an isolated test database.
- Laravel is served from `public/`; static catalog deployment uses only `catalog/`. The public catalog has manually maintained data and cannot access local stock.
- Use Asia/Manila for store dates. Sample prices/stock must remain clearly labeled until replaced with real data.
- Apply the restrained stationery design described in ARCHITECTURE.md: navy primary actions, warm-white surfaces, yellow brand accents, and separate green/amber/red semantic statuses. Keep visible focus, input labels, semantic headings, responsive layouts, deliberate statuses and empty/error states. Stock-dialog context is derived on the server; failed validation restores only that dialog and its inputs.

## Verification

From `store-app/`: `composer test`, `php vendor/bin/pint --test`, `npm.cmd run build`, `npm.cmd run test:ui`. Run PHP syntax checks on application/config/migration/test files and `node --check` on catalog/scripts JavaScript. Check expected changed files. Browser tests use isolated data and installed Edge/Chrome, never real inventory. Record PASS / FAIL / NOT RUN / NOT APPLICABLE honestly; no claim of full accessibility certification.

Use targeted diffs. Prefer open-source/free tools first and explain paid alternatives where relevant. Do not spawn agents unless the user or an applicable instruction explicitly requests delegation.
