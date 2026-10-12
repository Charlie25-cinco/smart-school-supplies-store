<?php

namespace App\Http\Controllers;

use App\Models\Order;
use App\Models\Product;
use App\Models\Sale;
use Illuminate\Support\Facades\DB;

class DashboardController extends Controller
{
    public function __invoke()
    {
        $today = Sale::whereDate('created_at', today());
        $lowStock = Product::where('active', true)->where('kind', '!=', 'service')->whereRaw('stock - reserved <= reorder_level')->orderBy('stock')->get();
        $days = collect(range(6, 0))->map(function ($offset) {
            $date = today()->subDays($offset);

            return ['day' => $date->format('D'), 'total' => (int) Sale::whereDate('created_at', $date)->sum('total_cents')];
        });

        return view('dashboard', [
            'revenue' => (clone $today)->sum('total_cents'), 'transactions' => (clone $today)->count(),
            'units' => DB::table('sale_items')->join('sales', 'sales.id', '=', 'sale_items.sale_id')->whereDate('sales.created_at', today())->where('sale_items.kind', 'product')->sum('quantity'),
            'lowStock' => $lowStock, 'days' => $days, 'recent' => Sale::with('user')->latest()->limit(5)->get(),
            'openOrders' => Order::whereNotIn('status', ['completed', 'cancelled'])->count(),
            'outstanding' => Order::whereNull('sale_id')->where('status', '!=', 'cancelled')->sum('total_cents'),
            'cashTotal' => (clone $today)->where('payment_method', 'cash')->sum('total_cents'),
            'gcashTotal' => (clone $today)->where('payment_method', 'gcash')->sum('total_cents'),
        ]);
    }
}
