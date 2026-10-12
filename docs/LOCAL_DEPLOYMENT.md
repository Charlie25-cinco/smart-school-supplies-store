# Run the store demo

This quick-start guide uses simplified requirements traceability, not full ISO/IEC/IEEE 29148 compliance. See REQ-007 and REQ-009–011 in REQUIREMENTS.md.

## On the main computer

1. Double-click **Start Store.cmd** in the project folder.
2. Sign in at **http://127.0.0.1:8000**, which opens automatically.
3. When all cashiers finish, double-click **Stop Store.cmd**.

Dependencies and assets must already be installed using README's one-time setup. Your current staff account and SQLite records are preserved. No Apache, certificate installation, or separate server setup command is required. The Laragon application need not run; PHP must remain installed.

## On a phone or tablet

Connect to the same reachable store Wi-Fi network. Open the main computer's IPv4 address with port 8000, for example **http://192.168.1.10:8000**.

Start Store prints possible network links. If several appear, use the address of the active Wi-Fi/Ethernet connection; you can also find it with **ipconfig**. The example above is not your detected address. Localhost and 127.0.0.1 on a phone refer to that phone.

The server computer must stay awake and running. Windows Firewall must permit PHP on the private store network. A guest Wi-Fi network may isolate devices. Internet is unnecessary for POS operations, but the local connection is required.

Every device uses the same SQLite database on the main computer through Laravel. Another device's changes appear when you refresh the page. There is no disconnected-device transaction queue.

## What Start/Stop do

Start runs this command from store-app in the background:

~~~powershell
php artisan serve --host=0.0.0.0 --port=8000 --no-reload --no-ansi
~~~

The last two flags keep the process stable and logs plain. Runtime settings/logs are prepared automatically in ignored **.runtime/artisan/**. Repeating Start opens the existing instance.

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

For a backup, finish sales and stop all processes using the database, then copy **store-app/database/database.sqlite** to private storage. Keep .env separately in secure storage; retain the original until a restored copy is verified.

## Orders, payments, and supply usage

In **Point of sale**, add products/services and select a fulfillment mode:

- **Counter sale:** collect cash or verified GCash and complete the sale immediately.
- **Scheduled pickup / nearby delivery:** enter the customer's name/contact and preparation notes. Delivery also requires an address and the agreed delivery fee; pickup adds no delivery fee.
- **Prepaid:** record payment now. **On delivery / pickup:** confirm the order unpaid; product quantities are reserved until collection or cancellation.

For **cash**, enter the received amount; the receipt records change. For **GCash**, verify the incoming payment in the store account, enter the exact order total and transaction reference, and check the verification box. The app records your confirmation; it does not contact GCash. A GCash reference cannot be reused for another sale. Do not record a payment based only on a customer screenshot. No real account login, PIN, OTP, or API credential belongs in this app.

Open **Orders & delivery** to find orders by customer name, fulfillment status, or payment status. Staff advance **Preparing → Ready → Out for delivery → Delivered**, or **Preparing → Ready → Picked up**. Record collected cash/verified GCash before marking the order delivered/picked up. Paid orders have a receipt; unpaid orders appear in awaiting-payment totals and are excluded from sales revenue. Delivery fees are included in paid revenue and itemized on receipts. The owner sees all records; a cashier sees orders/sales they recorded.

An unpaid order can be cancelled with a reason. If dispatched, confirm that the goods returned before releasing stock. Paid refunds/voids are outside this workflow. Finishing an order or recording payment twice does not create a second sale or deduction.

In **Inventory**, filter category and stock status. **Available = total stock − unpaid reservations.** Total stock can include reserved COD goods already out for delivery; use available stock for new sales, not a physical shelf-count interpretation of the total. Owners can restock or record actual supply usage with a quantity and reason; usage cannot consume reserved quantities. Create **Internal supply** items for ink/paper used only internally (price 0, stock in a consistent unit you choose); they never appear in POS. Printing charges do not automatically deduct paper/ink. Record actual consumption manually, using the same unit as the inventory item.

For the HTTP defense demo, use fictional customer names, contacts, addresses, and payment references. Customer details stay in the staff app; the public catalog remains a Messenger inquiry flow.

### Upgrade an existing installation to 0.4.0

Finish sales, stop the server, and back up the SQLite file to private storage. From the project folder, run:

~~~powershell
cd store-app
php artisan migrate
npm.cmd run build
~~~

Then use **Start Store.cmd**. This migration adds order/payment fields and preserves existing accounts, inventory, and paid sales. Historical sales remain recorded as cash; only newly confirmed orders create reservations. Never use the reset command below to apply an upgrade.

## Reset the demo database

Use this only when you want to start the local SQLite demo over. **A full reset deletes all staff accounts, orders, payments, sales, reservations, stock movements, custom items, and inventory edits.** It recreates the tables and restores the sample products, prices, and opening stock from `catalog/products.json`. It does not reset the separate customer catalog or its browser list.

1. Finish sales and double-click **Stop Store.cmd**. If another terminal is running the POS, stop it with Ctrl+C too. All processes using the database must be stopped before the backup/reset.
2. Back up **store-app/database/database.sqlite** to private storage outside the project. Keep **store-app/.env** separately in secure storage. If you configured a different SQLite file, back up that file instead; the reset command affects Laravel's configured database.
3. Open PowerShell in the project folder. Confirm the app is configured for the local demo SQLite database (`DB_CONNECTION=sqlite`), then run:

~~~powershell
cd store-app
php artisan migrate:fresh --seed
~~~

4. Once the reset succeeds, create a new owner account in the same terminal:

~~~powershell
php artisan store:staff --role=owner
~~~

Enter a name, login email, and a password of **at least 12 characters**. Password entry is hidden; type it and press Enter. The seeder does not create staff accounts. If needed, also run `php artisan store:staff --role=cashier` for each cashier.

5. Double-click **Start Store.cmd**, sign in with the new account, and confirm that sales history is empty and sample inventory is restored. Old login credentials no longer work unless you recreated them.

Do not delete the SQLite file or regenerate the application key for this reset. `php artisan db:seed` alone does **not** reset existing stock/prices or remove sales. Keep the backup until you have checked the new demo records. If a command fails, leave the server stopped and inspect the error before continuing.

## Customer website

The separate catalog remains prepared for Cloudflare Pages after the defense: repository root **catalog**, preset **None**, blank build command (or **exit 0**), output directory **.**. Staff manually maintain public products and confirm inquiries through Messenger.

PHP/Laravel/SQLite and GitHub Free suit the student budget. Optional paid upgrades are a custom domain or dedicated host/UPS later. Public publication remains deferred.
