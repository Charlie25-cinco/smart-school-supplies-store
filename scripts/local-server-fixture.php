<?php

use App\Models\Product;
use App\Models\Sale;
use App\Models\StockMovement;
use App\Models\User;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Support\Facades\Artisan;

require __DIR__.'/../store-app/vendor/autoload.php';
$app = require __DIR__.'/../store-app/bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();
$database = config('database.connections.sqlite.database');
$artifacts = realpath(__DIR__.'/../artifacts');
if (! app()->environment('testing') || config('database.default') !== 'sqlite' || ! $artifacts || realpath(dirname($database)) !== $artifacts || basename($database) !== 'lan-test.sqlite') {
    throw new RuntimeException('Local-server checks require the isolated test database.');
}
if (($argv[1] ?? '') === 'inspect') {
    echo json_encode([
        'sales' => Sale::count(),
        'references' => Sale::distinct()->count('reference'),
        'notebook_stock' => Product::where('sku', 'NB-001')->value('stock'),
        'pen_stock' => Product::where('sku', 'PN-001')->value('stock'),
        'blue_stock' => Product::where('sku', 'PN-002')->value('stock'),
        'reserved' => Product::sum('reserved'),
        'sale_units' => -StockMovement::whereNotNull('sale_id')->sum('quantity'),
        'revenue_cents' => Sale::sum('total_cents'),
    ]);
    exit;
}
$password = getenv('UI_PASSWORD');
if (! is_string($password) || strlen($password) < 24) {
    throw new RuntimeException('A random ephemeral test password is required.');
}
Artisan::call('migrate', ['--force' => true]);
Artisan::call('db:seed', ['--force' => true]);
foreach (['NB-001' => 2, 'PN-001' => 1, 'PN-002' => 1] as $sku => $quantity) {
    $product = Product::where('sku', $sku)->firstOrFail();
    $product->update(['stock' => $quantity]);
    $product->movements()->where('reason', 'Sample opening stock')->update(['quantity' => $quantity]);
}
foreach (['one', 'two'] as $staff) {
    $user = new User;
    $user->name = 'Test Cashier '.$staff;
    $user->email = $staff.'@example.test';
    $user->password = $password;
    $user->role = 'cashier';
    $user->save();
}
echo 'Isolated local-server fixtures ready.'.PHP_EOL;
