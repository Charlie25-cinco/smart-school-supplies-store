# Defense walkthrough

This is presentation guidance, not a requirements specification or a claim of ISO/IEC/IEEE 29148 compliance. Requirement IDs and traceability are in REQUIREMENTS.md.

## One-sentence introduction

“Smart School Supplies combines a customer catalog with Facebook/Messenger inquiries and a local point of sale and inventory system, helping customers prepare their needs while staff keep sales and stock records organized.”

## Before presenting

Reuse the installed dependencies and your existing owner account. Double-click Start Store.cmd; the main POS URL is http://127.0.0.1:8000. No certificate setup is needed. Start the separate catalog preview from README. For a phone/tablet on the same trusted Wi-Fi, use http://YOUR-COMPUTER-IP:8000 with the host's active Wi-Fi address and check firewall access before presenting. Use sample accounts/data because HTTP is unencrypted. Keep sample labels visible. Configure a real Facebook Page only when supplied; otherwise explain the unconfigured demo link. See LOCAL_DEPLOYMENT.md for troubleshooting.

Prepare the business-plan capital explanation: the supplied plan contains both ₱128,000 and ₱185,000. Reconcile these with the team/instructor; the system does not resolve or modify that document.

## Five-minute demonstration

1. Open the customer catalog. Explain that products and prices are sample data. Search for notebooks and switch categories.
2. Add two Spiral Notebooks and one Black Ballpen. Open **Your list**. Estimated total is ₱102.00 at initial sample prices. Show pickup versus nearby delivery; delivery charges remain subject to staff confirmation.
3. Copy the summary. Explain the customer pastes/sends it after opening Messenger or the Facebook Page. It is an inquiry, not an automatically accepted order. Printing documents and specifications are discussed with staff through Messenger.
4. Sign in to the local owner workspace. Open POS, add the same items, choose **Confirmed Messenger order**, and enter ₱200.00 cash. The change is ₱98.00. Complete the sale and show the receipt/print preview. Stock is deducted only now.
5. Open inventory. Show Spiral Notebook stock decreased by two and Black Ballpen by one; stock movement entries provide an audit record. Restock a low-stock product with a reason.
6. Open the overview and sales report. Show the completed sale in revenue, transaction count, and dated receipts. Explain that these totals are sales revenue, not net profit.

If using a cashier account, demonstrate that inventory and the owner's overview are unavailable and other cashiers' receipts cannot be opened.

## Delivery and GCash demonstration

Use fictional details only. In POS select **Nearby delivery**, enter a sample contact/address, an agreed fee (for example ₱20), preparation notes, and **On delivery / pickup**. Confirm the order: its products become reserved, available inventory decreases, and paid revenue stays unchanged. Open Orders & delivery and advance to Ready and Out for delivery. Record cash collected or a fictional verified GCash reference for the demo; explain that real GCash confirmation must come from the store account, not the app. Show the paid receipt with subtotal/fee/payment method, then mark Delivered. GCash requires the exact total and shows no cash change.

Show a separate unpaid cancelled order releasing its reservation once. Show Inventory category/status filters and Record usage for a printing-supply item. Reports separate cash/GCash paid revenue from amounts awaiting payment. Prepaid pickup/delivery records payment at confirmation and then follows the same fulfillment steps.

## Questions you may receive

**Why SQLite?** One store computer hosts the database; multiple browser clients access it through Laravel. Short transactional writes take turns and validate stock on the server. MySQL can be reconsidered if write concurrency grows; migration requires schema/data verification.

**Where is the technopreneurship value?** Customers prepare inquiries in one place; staff confirm through an existing social channel, record sales, monitor stock, and identify restocking needs. This supports the business model's convenience and low initial operating complexity.

**Why not full online checkout?** The approved milestone uses staff confirmation through Facebook/Messenger, matching the business plan. Payments, stock availability, delivery, and service details need confirmation; live gateways/order tracking are future scope.

**Does inventory update on the website?** No. The public catalog is manually maintained and cannot read the private local database. Staff enter confirmed orders locally; unpaid reservations protect available quantities, and payment commits the sale.

**Can it work offline?** POS works without internet when the host and local store network remain available. A device disconnected from store Wi-Fi cannot transact. Facebook/Messenger and the public catalog need internet. No browser data synchronization is claimed.

**Do staff need terminal commands every day?** No. Start Store.cmd runs php artisan serve in the background and opens the browser; Stop Store.cmd stops its processes after cashiers finish. Automatic Windows startup is deferred. This HTTP development server is the temporary defense setup; production deployment needs a separate plan.

**Will it be hosted?** After the defense, the static catalog may be deployed from GitHub to Cloudflare Pages. A free `pages.dev` address is sufficient; a paid custom domain is optional. Laravel and SQLite remain local.

**Does GCash verify automatically?** No. Authorized staff verify money received in the store account and record the amount/reference; this prototype has no payment gateway. References are unique and GCash payments have no change.

**What is not demonstrated?** Automatic payment verification, automatic messaging, public order acceptance/tracking, paid-sale refunds/voids, printer hardware control, tax-compliant invoicing, profit accounting, and automatic catalog synchronization. Local staff order tracking is included.
