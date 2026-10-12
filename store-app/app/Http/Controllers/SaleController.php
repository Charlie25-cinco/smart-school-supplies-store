<?php

namespace App\Http\Controllers;

use App\Models\Product;
use App\Models\Sale;
use App\Services\Checkout;
use App\Support\Money;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

class SaleController extends Controller
{
    public function pos(Request $request)
    {
        $fulfillment = in_array($request->query('fulfillment'), ['pickup', 'delivery'], true) ? $request->query('fulfillment') : 'counter';

        return view('pos', ['products' => Product::where('active', true)->where('kind', '!=', 'consumable')->orderBy('kind')->orderBy('name')->get(), 'reference' => (string) Str::uuid(), 'fulfillment' => $fulfillment]);
    }

    public function store(Request $request, Checkout $checkout)
    {
        $data = $request->validate([
            'reference' => ['required', 'uuid'], 'channel' => ['required', 'in:walk-in,messenger'],
            'cash' => ['required', 'regex:/^\d{1,7}(\.\d{1,2})?$/'],
            'items' => ['required', 'array', 'min:1', 'max:100'],
            'items.*.product_id' => ['required', 'integer', 'distinct'],
            'items.*.quantity' => ['required', 'integer', 'min:1', 'max:999'],
            'payment_method' => ['sometimes', 'required', 'in:cash,gcash'],
            'payment_reference' => ['nullable', 'string', 'max:80'],
            'payment_verified' => ['nullable', 'boolean'],
        ]);
        $sale = $checkout->complete($request->user(), $data['items'], Money::cents((string) $data['cash']), $data['channel'], $data['reference'], $data['payment_method'] ?? 'cash', $data['payment_reference'] ?? null, (bool) ($data['payment_verified'] ?? false));

        return redirect()->route('receipt', $sale)->with('success', 'Sale completed. Inventory and sales records have been updated.');
    }

    public function index(Request $request)
    {
        $data = $request->validate(['from' => ['nullable', 'date_format:Y-m-d'], 'to' => ['nullable', 'date_format:Y-m-d', 'after_or_equal:from']]);
        $from = $data['from'] ?? now()->startOfMonth()->toDateString();
        $to = $data['to'] ?? now()->toDateString();
        $query = Sale::with('user')->whereBetween('created_at', [$from.' 00:00:00', $to.' 23:59:59']);
        if ($request->user()->role !== 'owner') {
            $query->where('user_id', $request->user()->id);
        }
        $total = (clone $query)->sum('total_cents');
        $count = (clone $query)->count();
        $cashTotal = (clone $query)->where('payment_method', 'cash')->sum('total_cents');
        $gcashTotal = (clone $query)->where('payment_method', 'gcash')->sum('total_cents');

        return view('sales', ['sales' => $query->latest()->paginate(15)->withQueryString(), 'total' => $total, 'count' => $count, 'cashTotal' => $cashTotal, 'gcashTotal' => $gcashTotal, 'from' => $from, 'to' => $to]);
    }

    public function receipt(Request $request, Sale $sale)
    {
        abort_unless($request->user()->role === 'owner' || $sale->user_id === $request->user()->id, 403);

        return view('receipt', ['sale' => $sale->load('items', 'user', 'order')]);
    }
}
