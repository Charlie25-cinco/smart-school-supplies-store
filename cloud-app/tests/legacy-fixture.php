<?php

declare(strict_types=1);
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;

// Fictional migration fixtures only; refuse paths outside the ignored test tree.
try {
    $repository = realpath(__DIR__.'/../..');
    $runtime = realpath($repository.'/.runtime');
    $directory = realpath($argv[1] ?? '');
    if ($directory === false || $runtime === false || ! str_starts_with($directory, $runtime.DIRECTORY_SEPARATOR)) {
        throw new RuntimeException('Invalid isolated fixture directory.');
    }
    $databasePath = $directory.'/source.sqlite';
    if (file_exists($databasePath)) {
        throw new RuntimeException('Fixture already exists.');
    }
    touch($databasePath);
    putenv('APP_ENV=testing');
    putenv('DB_CONNECTION=sqlite');
    putenv('DB_DATABASE='.$databasePath);
    putenv('CACHE_STORE=array');
    putenv('SESSION_DRIVER=array');
    require $repository.'/store-app/vendor/autoload.php';
    $app = require $repository.'/store-app/bootstrap/app.php';
    $app->make(Kernel::class)->bootstrap();
    config(['database.default' => 'sqlite', 'database.connections.sqlite.database' => $databasePath]);
    Artisan::call('migrate', ['--force' => true]);
    $db = DB::connection('sqlite');
    $date = '2026-10-12 09:30:00';
    foreach ([[1, 'Fixture Admin', 'admin', true], [2, 'Fixture Cashier', 'cashier', true], [3, 'Fixture Disabled', 'cashier', false]] as [$id, $name, $role, $active]) {
        $db->table('users')->insert(['id' => $id, 'name' => $name, 'email' => 'fixture'.$id.'@example.invalid', 'role' => $role, 'active' => $active, 'password' => password_hash(bin2hex(random_bytes(16)), PASSWORD_BCRYPT), 'created_at' => $date, 'updated_at' => $date]);
    }
    foreach ([[1, 'TEST-NOTE', 'Fixture notebook', 'product', 4500, 20, 2], [2, 'TEST-PRINT', 'Fixture printing', 'service', 300, 0, 0], [3, 'TEST-PAPER', 'Fixture internal paper', 'consumable', 0, 10, 0]] as [$id, $sku, $name, $kind, $price, $stock, $reserved]) {
        $db->table('products')->insert(['id' => $id, 'sku' => $sku, 'name' => $name, 'category' => 'Fixture category', 'kind' => $kind, 'price_cents' => $price, 'stock' => $stock, 'reserved' => $reserved, 'reorder_level' => 3, 'active' => true, 'created_at' => $date, 'updated_at' => $date]);
    }
    $paidReference = '33333333-3333-4333-8333-333333333333';
    $db->table('sales')->insert(['id' => 7, 'reference' => $paidReference, 'user_id' => 1, 'channel' => 'messenger', 'total_cents' => 4500, 'delivery_fee_cents' => 500, 'cash_cents' => 4500, 'change_cents' => 0, 'payment_method' => 'gcash', 'payment_reference' => 'FIXTURE-GCASH-7', 'created_at' => $date, 'updated_at' => $date]);
    $base = ['user_id' => 1, 'channel' => 'messenger', 'fulfillment' => 'delivery', 'customer_name' => 'Fictional recipient', 'customer_phone' => '09000000000', 'delivery_address' => 'Fictional test address', 'notes' => null, 'delivery_fee_cents' => 500, 'created_at' => $date, 'updated_at' => $date];
    $db->table('orders')->insert($base + ['id' => 11, 'reference' => $paidReference, 'sale_id' => 7, 'paid_by' => 2, 'payment_plan' => 'prepaid', 'status' => 'ready', 'subtotal_cents' => 4000, 'total_cents' => 4500, 'assigned_cashier_id' => 2, 'assigned_by' => 1, 'assigned_at' => $date, 'assignment_version' => 1]);
    $db->table('orders')->insert(array_replace($base, ['id' => 12, 'reference' => '44444444-4444-4444-8444-444444444444', 'user_id' => 2, 'payment_plan' => 'cod', 'status' => 'preparing', 'subtotal_cents' => 8000, 'total_cents' => 8500]));
    $line = ['product_id' => 1, 'name' => 'Frozen fixture notebook', 'sku' => 'OLD-NOTE', 'kind' => 'product', 'quantity' => 1, 'price_cents' => 4000, 'total_cents' => 4000];
    $db->table('sale_items')->insert($line + ['id' => 31, 'sale_id' => 7]);
    $db->table('order_items')->insert($line + ['id' => 41, 'order_id' => 11]);
    $db->table('order_items')->insert(array_replace($line, ['id' => 42, 'order_id' => 12, 'quantity' => 2, 'total_cents' => 8000]));
    $db->table('stock_movements')->insert(['id' => 61, 'product_id' => 1, 'user_id' => 2, 'sale_id' => 7, 'quantity' => -1, 'reason' => 'Fictional paid sale', 'created_at' => $date, 'updated_at' => $date]);
    $db->table('stock_movements')->insert(['id' => 62, 'product_id' => 3, 'user_id' => 1, 'quantity' => -2, 'reason' => 'Fictional paper usage', 'created_at' => $date, 'updated_at' => $date]);
    $db->disconnect();
    require __DIR__.'/../scripts/export-legacy.php';
    $beforeHash = hash_file('sha256', $databasePath);
    $result = exportLegacyDatabase($databasePath, $directory.'/private-export');
    if (! $result['backup_verified']) {
        throw new RuntimeException('Fixture backup failed.');
    }
    file_put_contents($directory.'/fixture-checks.json', json_encode(['source_unchanged' => $beforeHash === hash_file('sha256', $databasePath)]));
    fwrite(STDOUT, "Fictional SQLite export verified.\n");
} catch (Throwable $error) {
    fwrite(STDERR, "Fictional migration fixture failed; no private data printed.\n");
    exit(1);
}
