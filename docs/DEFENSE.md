# Defense walkthrough

This is presentation guidance, not a requirements specification or a claim of ISO/IEC/IEEE 29148 compliance. Requirement IDs and traceability are in REQUIREMENTS.md.

## One-sentence introduction

“Smart School Supplies combines a customer catalog with Facebook/Messenger inquiries and a local point of sale and inventory system, helping customers prepare their needs while staff keep sales and stock records organized.”

## Before presenting

Reuse the installed dependencies and the existing Owner account, now Admin after the additive upgrade. Create a Cashier from Cashier accounts before demonstrating transactions. Double-click Start Store.cmd; the main POS URL is http://127.0.0.1:8000. No certificate setup is needed. Start the separate catalog preview from README. For a phone/tablet on the same trusted Wi-Fi, use http://YOUR-COMPUTER-IP:8000 with the host's active Wi-Fi address and check firewall access before presenting. Use sample accounts/data because HTTP is unencrypted. Keep sample labels visible. The catalog now uses the supplied [Facebook Page](https://www.facebook.com/profile.php?id=61594157431738); explain that customers choose Message and send the copied inquiry themselves. See LOCAL_DEPLOYMENT.md for troubleshooting.

Prepare the business-plan capital explanation: the supplied plan contains both ₱128,000 and ₱185,000. Reconcile these with the team/instructor; the system does not resolve or modify that document.

The existing public catalog is [Smart School Supplies on Workers Static Assets](https://smart-school-supplies-store.cincocharlie25.workers.dev/). The revised 1.3.0 scope accepts this host instead of the historical Pages plan. Check VERIFICATION.md before presenting the new floating list, copy gate and supplied logo/banner as live: the address alone does not prove this release has been published. If the new update is pending, demonstrate the working local catalog preview and explain that limitation.

## Five-minute demonstration

1. Open the customer catalog. Explain that products and prices are sample data. Search for notebooks and switch categories.
2. Add two Spiral Notebooks and one Black Ballpen. Open the floating **Your list** control and show its quantity count. Estimated total is ₱102.00 at initial sample prices. Show pickup versus nearby delivery; delivery charges remain subject to staff confirmation. Point out the new supplied logo and the whole banner on a phone-sized preview.
3. Show that the Facebook/Messenger action stays locked until **Copy summary** succeeds for the current inquiry. Change a quantity or fulfillment and show that copying is required again. If clipboard permission is denied, use native Copy on the selected full read-only summary; failure or partial copying leaves the action locked. After a successful copy, explain that the customer opens the Page, chooses Message, then pastes/sends manually. It is an inquiry, not an automatically accepted order. Printing documents and specifications are discussed with staff through Messenger. Demonstrate **Clear all** on a separate inquiry after the sales example: it clears the saved public basket while keeping fulfillment and staff records intact.
4. Sign in to the local Cashier workspace. Open POS, add the same items, keep **Counter sale**, select **Messenger (confirmed)** under Order channel, and enter ₱200.00 cash. The change is ₱98.00. Complete the sale and show the receipt/print preview. Stock is deducted only now.
5. Sign out, sign in as Admin, then open Inventory. On **Items**, show Spiral Notebook stock decreased by two and Black Ballpen by one; switch to **Stock movements** for the audit record. Return to Items and restock a low-stock product with a reason.
6. Open the overview and sales report. Show the completed sale in revenue, transaction count, and dated receipts. Explain that these totals are sales revenue, not net profit.

If using a cashier account, demonstrate that inventory, cashier account management and the Admin overview are unavailable and other cashiers' receipts cannot be opened.

## Delivery and GCash demonstration

For a preserved unfinished order originally created by Owner/Admin, show **Admin → Orders review → Hand off order**, select a fictional active Cashier, then sign in as that Cashier to continue it. Point out the unchanged original recorder/prices and separate current responsibility/payment collector. Admin does not collect payment or update fulfillment. Use only an isolated demo record; do not create an Admin order through unsupported direct database edits during store use.

Sign in as Cashier and use fictional details only. In POS select **Delivery**, open **Customer details**, enter a sample contact/address, an agreed fee (for example ₱20), preparation notes, and **On delivery / pickup**. Select **Use these details**, then confirm the order: its products become reserved, available inventory decreases, and paid revenue stays unchanged. Open Orders & delivery, select **View order**, and use **Next step** to advance to Ready and Out for delivery. The progress strip shows the current stage; payment is separate. Record cash collected or a fictional verified GCash reference for the demo; explain that real GCash confirmation must come from the store account, not the app. Show the paid receipt with subtotal/fee/payment method, then mark Delivered. GCash requires the exact total and shows no cash change.

Show a separate unpaid cancelled order releasing its reservation once. Show Inventory category/status filters and Record usage for a printing-supply item. Reports separate cash/GCash paid revenue from amounts awaiting payment. Prepaid pickup/delivery records payment at confirmation and then follows the same fulfillment steps.

Before dispatch, open **Edit order** to correct the address/notes. On an unpaid preparing/ready order, change a quantity or fee and show the revised total and available inventory. Explain that paid items/fees stay fixed, dispatched/finished orders are locked, and stale edits from another device require reloading the latest order.

## Questions you may receive

**Why SQLite?** One store computer hosts the database; multiple browser clients access it through Laravel. Short transactional writes take turns and validate stock on the server. MySQL can be reconsidered if write concurrency grows; migration requires schema/data verification.

**Where is the technopreneurship value?** Customers prepare inquiries in one place; staff confirm through an existing social channel, record sales, monitor stock, and identify restocking needs. This supports the business model's convenience and low initial operating complexity.

**Why not full online checkout?** The approved milestone uses staff confirmation through Facebook/Messenger, matching the business plan. Payments, stock availability, delivery, and service details need confirmation; live gateways/order tracking are future scope.

**Does inventory update on the website?** No. The public catalog is manually maintained and cannot read the private local database. Staff enter confirmed orders locally; unpaid reservations protect available quantities, and payment commits the sale.

**Can it work offline?** POS works without internet when the host and local store network remain available. A device disconnected from store Wi-Fi cannot transact. Facebook/Messenger and the public catalog need internet. No browser data synchronization is claimed.

**Do staff need terminal commands every day?** No. Start Store.cmd runs php artisan serve in the background and opens the browser; Stop Store.cmd stops its processes after cashiers finish. Automatic Windows startup is deferred. This HTTP development server is the temporary defense setup; production deployment needs a separate plan.

**Will it be hosted?** The existing catalog address is https://smart-school-supplies-store.cincocharlie25.workers.dev/ on Cloudflare Workers Static Assets. The user explicitly accepted this catalog-only host in the 2026-10-14 revised 1.3.0 plan (REQ-034), replacing the historical Pages approach in REQ-033. Public updates use the existing Git integration; current release publication and live checks must be confirmed in VERIFICATION.md. Static hosting needs no paid plan or custom domain for this address. Only catalog files are public; Laravel/POS/IMS, SQLite, accounts and real records remain local. The public catalog needs internet but does not require the store computer to run.

**Does GCash verify automatically?** No. Authorized staff verify money received in the store account and record the amount/reference; this prototype has no payment gateway. References are unique and GCash payments have no change.

**What is not demonstrated?** Automatic payment verification, automatic messaging, public order acceptance/tracking, paid-sale refunds/voids, printer hardware control, tax-compliant invoicing, profit accounting, and automatic catalog synchronization. Local staff order tracking is included.
