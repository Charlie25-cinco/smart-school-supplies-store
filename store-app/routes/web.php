<?php

use App\Http\Controllers\AuthController;
use App\Http\Controllers\CashierController;
use App\Http\Controllers\DashboardController;
use App\Http\Controllers\InventoryController;
use App\Http\Controllers\OrderController;
use App\Http\Controllers\SaleController;
use App\Http\Controllers\SettingsController;
use App\Http\Middleware\ActiveStaff;
use App\Http\Middleware\StaffRole;
use Illuminate\Support\Facades\Route;

Route::get('/', fn () => redirect()->route('login'));
Route::get('/login', [AuthController::class, 'show'])->name('login');
Route::post('/login', [AuthController::class, 'login'])->middleware('throttle:5,1');
Route::middleware(['auth', ActiveStaff::class, 'auth.session'])->group(function () {
    Route::post('/logout', [AuthController::class, 'logout'])->name('logout');
    Route::get('/pos', [SaleController::class, 'pos'])->middleware(StaffRole::class.':cashier')->name('pos');
    Route::post('/sales', [SaleController::class, 'store'])->middleware(StaffRole::class.':cashier')->name('sales.store');
    Route::get('/sales', [SaleController::class, 'index'])->name('sales');
    Route::get('/sales/{sale}/receipt', [SaleController::class, 'receipt'])->name('receipt');
    Route::post('/sales/{sale}/refund', [SaleController::class, 'refund'])->name('sales.refund');
    Route::get('/orders', [OrderController::class, 'index'])->name('orders.index');
    Route::post('/orders', [OrderController::class, 'store'])->middleware(StaffRole::class.':cashier')->name('orders.store');
    Route::get('/orders/{order}', [OrderController::class, 'show'])->name('orders.show');
    Route::get('/product-images/{product}', [InventoryController::class, 'image'])->name('products.image');
    Route::get('/orders/{order}/edit', [OrderController::class, 'edit'])->middleware(StaffRole::class.':cashier')->name('orders.edit');
    Route::put('/orders/{order}', [OrderController::class, 'update'])->middleware(StaffRole::class.':cashier')->name('orders.update');
    Route::post('/orders/{order}/payment', [OrderController::class, 'pay'])->middleware(StaffRole::class.':cashier')->name('orders.pay');
    Route::post('/orders/{order}/status', [OrderController::class, 'status'])->middleware(StaffRole::class.':cashier')->name('orders.status');
    Route::get('/settings', [SettingsController::class, 'show'])->name('settings');
    Route::put('/settings/profile', [SettingsController::class, 'updateProfile'])->name('settings.profile');
    Route::put('/settings/password', [SettingsController::class, 'updatePassword'])->name('settings.password');
    Route::middleware(StaffRole::class.':admin')->group(function () {
        Route::put('/orders/{order}/handoff', [OrderController::class, 'handoff'])->name('orders.handoff');
        Route::put('/settings/preferences', [SettingsController::class, 'updatePreferences'])->name('settings.preferences');
        Route::get('/dashboard', DashboardController::class)->name('dashboard');
        Route::get('/inventory', [InventoryController::class, 'index'])->name('inventory');
        Route::get('/inventory/create', [InventoryController::class, 'create'])->name('inventory.create');
        Route::post('/inventory', [InventoryController::class, 'store'])->name('inventory.store');
        Route::get('/inventory/{product}/edit', [InventoryController::class, 'edit'])->name('inventory.edit');
        Route::put('/inventory/{product}', [InventoryController::class, 'update'])->name('inventory.update');
        Route::delete('/inventory/{product}', [InventoryController::class, 'destroy'])->name('inventory.destroy');
        Route::post('/inventory/{product}/restock', [InventoryController::class, 'restock'])->name('inventory.restock');
        Route::post('/inventory/{product}/usage', [InventoryController::class, 'usage'])->name('inventory.usage');
        Route::get('/cashiers', [CashierController::class, 'index'])->name('cashiers.index');
        Route::get('/cashiers/create', [CashierController::class, 'create'])->name('cashiers.create');
        Route::post('/cashiers', [CashierController::class, 'store'])->name('cashiers.store');
        Route::get('/cashiers/{cashier}/edit', [CashierController::class, 'edit'])->name('cashiers.edit');
        Route::put('/cashiers/{cashier}', [CashierController::class, 'update'])->name('cashiers.update');
        Route::put('/cashiers/{cashier}/password', [CashierController::class, 'password'])->name('cashiers.password');
        Route::patch('/cashiers/{cashier}/status', [CashierController::class, 'status'])->name('cashiers.status');
    });
});
