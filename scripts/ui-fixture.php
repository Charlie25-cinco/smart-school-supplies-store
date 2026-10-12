<?php

use App\Models\User;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Support\Facades\Artisan;

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
Artisan::call('migrate', ['--force' => true]);
Artisan::call('db:seed', ['--force' => true]);
$user = new User;
$user->name = 'Demo Owner';
$user->email = 'owner@example.test';
$user->password = $password;
$user->role = 'owner';
$user->save();
echo 'Isolated browser fixtures ready.'.PHP_EOL;
