<?php

use App\Models\Order;
use App\Models\Product;
use App\Models\User;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

// This script can populate only the explicitly isolated browser-test database.
require __DIR__.'/../store-app/vendor/autoload.php';
$app = require __DIR__.'/../store-app/bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();
$database = config('database.connections.sqlite.database');
$artifacts = realpath(__DIR__.'/../artifacts');
if (app()->environment() !== 'testing' || config('database.default') !== 'sqlite' || ! $artifacts || realpath(dirname($database)) !== $artifacts || basename($database) !== 'ui-test.sqlite') {
    throw new RuntimeException('Browser fixtures require the isolated test database.');
}
$password = getenv('UI_PASSWORD');
if (! is_string($password) || strlen($password) < 24) {
    throw new RuntimeException('A random ephemeral test password is required.');
}
if (($argv[1] ?? '') === 'legacy-order') {
    $admin = User::where('email', 'admin@example.test')->firstOrFail();
    $cashier = User::where('email', 'cashier@example.test')->firstOrFail();
    $disabled = new User;
    $disabled->name = 'Disabled Handoff Demo';
    $disabled->email = 'disabled-handoff@example.test';
    $disabled->role = 'cashier';
    $disabled->active = false;
    $disabled->password = $password;
    $disabled->save();
    $result = DB::transaction(function () use ($admin, $cashier) {
        $product = Product::where('sku', 'NB-001')->firstOrFail();
        if ($product->available() < 1) {
            throw new RuntimeException('Legacy fixture needs one available notebook.');
        }
        $stockBefore = $product->stock;
        $reservedBefore = $product->reserved;
        $price = $product->price_cents;
        $order = Order::create([
            'reference' => (string) Str::uuid(), 'user_id' => $admin->id,
            'channel' => 'messenger', 'fulfillment' => 'delivery', 'payment_plan' => 'cod',
            'status' => 'ready', 'customer_name' => 'Legacy Admin Demo',
            'customer_phone' => '09123456789', 'delivery_address' => 'Fictional school gate',
            'notes' => 'Legacy order before role separation',
            'subtotal_cents' => $price, 'delivery_fee_cents' => 2000, 'total_cents' => $price + 2000,
        ]);
        $order->items()->create([
            'product_id' => $product->id, 'name' => 'Legacy Notebook snapshot', 'sku' => $product->sku,
            'kind' => 'product', 'quantity' => 1, 'price_cents' => $price, 'total_cents' => $price,
        ]);
        $product->increment('reserved');
        // A later catalog price must not alter the historical order on handoff.
        $product->update(['price_cents' => $price + 777]);

        return ['id' => $order->id, 'creator_id' => $admin->id, 'cashier_id' => $cashier->id,
            'product_id' => $product->id, 'price_cents' => $price, 'total_cents' => $price + 2000,
            'stock_before' => $stockBefore, 'reserved_before' => $reservedBefore];
    });
    echo json_encode($result);
    exit;
}
if (($argv[1] ?? '') === 'inspect-handoff') {
    $order = Order::with('items', 'sale')->findOrFail((int) ($argv[2] ?? 0));
    $product = Product::findOrFail($order->items->first()->product_id);
    echo json_encode([
        'creator_id' => $order->user_id, 'assigned_cashier_id' => $order->assigned_cashier_id,
        'assigned_by' => $order->assigned_by, 'assigned_at' => $order->assigned_at !== null,
        'paid_by' => $order->paid_by, 'status' => $order->status, 'total_cents' => $order->total_cents,
        'snapshot_name' => $order->items->first()->name, 'snapshot_price' => $order->items->first()->price_cents,
        'stock' => $product->stock, 'reserved' => $product->reserved,
        'sale_count' => $order->sale()->count(), 'sale_creator_id' => $order->sale?->user_id,
        'sale_total_cents' => $order->sale?->total_cents,
    ]);
    exit;
}
Artisan::call('migrate', ['--force' => true]);
Artisan::call('db:seed', ['--force' => true]);
foreach (['admin' => 'Demo Admin', 'cashier' => 'Demo Cashier'] as $role => $name) {
    $user = new User;
    $user->name = $name;
    $user->email = $role.'@example.test';
    $user->password = $password;
    $user->role = $role;
    $user->save();
}
echo 'Isolated browser fixtures ready.'.PHP_EOL;
