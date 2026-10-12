<?php

use App\Http\Controllers\AuthController;
use App\Http\Controllers\DashboardController;
use App\Http\Controllers\InventoryController;
use App\Http\Controllers\OrderController;
use App\Http\Controllers\SaleController;
use App\Http\Middleware\OwnerOnly;
use Illuminate\Support\Facades\Route;

Route::get('/', fn () => redirect()->route('login'));
Route::get('/login', [AuthController::class, 'show'])->name('login');
Route::post('/login', [AuthController::class, 'login'])->middleware('throttle:5,1');
Route::middleware('auth')->group(function () {
    Route::post('/logout', [AuthController::class, 'logout'])->name('logout');
    Route::get('/pos', [SaleController::class, 'pos'])->name('pos');
    Route::post('/sales', [SaleController::class, 'store'])->name('sales.store');
    Route::get('/sales', [SaleController::class, 'index'])->name('sales');
    Route::get('/sales/{sale}/receipt', [SaleController::class, 'receipt'])->name('receipt');
    Route::get('/orders', [OrderController::class, 'index'])->name('orders.index');
    Route::post('/orders', [OrderController::class, 'store'])->name('orders.store');
    Route::get('/orders/{order}', [OrderController::class, 'show'])->name('orders.show');
    Route::post('/orders/{order}/payment', [OrderController::class, 'pay'])->name('orders.pay');
    Route::post('/orders/{order}/status', [OrderController::class, 'status'])->name('orders.status');
    Route::middleware(OwnerOnly::class)->group(function () {
        Route::get('/dashboard', DashboardController::class)->name('dashboard');
        Route::get('/inventory', [InventoryController::class, 'index'])->name('inventory');
        Route::get('/inventory/create', [InventoryController::class, 'create'])->name('inventory.create');
        Route::post('/inventory', [InventoryController::class, 'store'])->name('inventory.store');
        Route::get('/inventory/{product}/edit', [InventoryController::class, 'edit'])->name('inventory.edit');
        Route::put('/inventory/{product}', [InventoryController::class, 'update'])->name('inventory.update');
        Route::post('/inventory/{product}/restock', [InventoryController::class, 'restock'])->name('inventory.restock');
        Route::post('/inventory/{product}/usage', [InventoryController::class, 'usage'])->name('inventory.usage');
    });
});
