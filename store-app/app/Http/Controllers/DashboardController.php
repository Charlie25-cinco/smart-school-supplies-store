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
        $today = Sale::whereDate('sales.created_at', today());
        $refundedToday = (clone $today)->join('refunds', 'refunds.sale_id', '=', 'sales.id')->sum('refunds.amount_cents');
        $lowStock = Product::where('active', true)->where('kind', '!=', 'service')->whereRaw('stock - reserved <= reorder_level')->orderBy('stock')->get();
        $days = collect(range(6, 0))->map(function ($offset) {
            $date = today()->subDays($offset);
            $gross = (int) Sale::whereDate('sales.created_at', $date)->sum('total_cents');
            $refunded = (int) Sale::whereDate('sales.created_at', $date)->join('refunds', 'refunds.sale_id', '=', 'sales.id')->sum('refunds.amount_cents');

            return ['day' => $date->format('D'), 'total' => $gross - $refunded];
        });
        $refundedUnits = (int) DB::table('sale_items')->join('sales', 'sales.id', '=', 'sale_items.sale_id')->join('refunds', 'refunds.sale_id', '=', 'sales.id')->whereDate('sales.created_at', today())->where('sale_items.kind', 'product')->sum('quantity');

        return view('dashboard', [
            'revenue' => (clone $today)->sum('total_cents') - $refundedToday, 'transactions' => (clone $today)->count(),
            'units' => DB::table('sale_items')->join('sales', 'sales.id', '=', 'sale_items.sale_id')->whereDate('sales.created_at', today())->where('sale_items.kind', 'product')->sum('quantity') - $refundedUnits,
            'refunded' => $refundedToday,
            'lowStock' => $lowStock, 'days' => $days, 'recent' => Sale::with('user', 'refund')->latest()->limit(5)->get(),
            'openOrders' => Order::whereNotIn('status', ['completed', 'cancelled'])->count(),
            'outstanding' => Order::whereNull('sale_id')->where('status', '!=', 'cancelled')->sum('total_cents'),
            'cashTotal' => (clone $today)->where('payment_method', 'cash')->sum('total_cents')
                - (clone $today)->where('payment_method', 'cash')->join('refunds', 'refunds.sale_id', '=', 'sales.id')->sum('refunds.amount_cents'),
            'gcashTotal' => (clone $today)->where('payment_method', 'gcash')->sum('total_cents')
                - (clone $today)->where('payment_method', 'gcash')->join('refunds', 'refunds.sale_id', '=', 'sales.id')->sum('refunds.amount_cents'),
        ]);
    }
}
