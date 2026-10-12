<?php

namespace App\Http\Controllers;

use App\Models\Order;
use App\Services\Orders;
use Illuminate\Http\Request;

class OrderController extends Controller
{
    public function index(Request $request)
    {
        $data = $request->validate(['status' => ['nullable', 'in:preparing,ready,out_for_delivery,completed,cancelled'], 'payment' => ['nullable', 'in:paid,unpaid'], 'q' => ['nullable', 'string', 'max:100']]);
        $query = Order::with('sale', 'user');
        if ($request->user()->role !== 'owner') {
            $query->where('user_id', $request->user()->id);
        }
        $outstanding = (clone $query)->whereNull('sale_id')->where('status', '!=', 'cancelled')->sum('total_cents');
        $open = (clone $query)->whereNotIn('status', ['completed', 'cancelled'])->count();
        $query->when($data['status'] ?? null, fn ($q, $status) => $q->where('status', $status))
            ->when($data['payment'] ?? null, fn ($q, $payment) => $payment === 'paid' ? $q->whereNotNull('sale_id') : $q->whereNull('sale_id'))
            ->when($data['q'] ?? null, fn ($q, $search) => $q->where('customer_name', 'like', '%'.$search.'%'));

        return view('orders.index', ['orders' => $query->latest()->paginate(15)->withQueryString(), 'filters' => $data, 'outstanding' => $outstanding, 'open' => $open]);
    }

    public static function paymentRules(): array
    {
        return [
            'cash' => ['required', 'regex:/^\d{1,7}(\.\d{1,2})?$/'],
            'payment_method' => ['required', 'in:cash,gcash'],
            'payment_reference' => ['nullable', 'string', 'max:80'],
            'payment_verified' => ['nullable', 'boolean'],
        ];
    }

    public function store(Request $request, Orders $orders)
    {
        $rules = [
            'reference' => ['required', 'uuid'], 'channel' => ['required', 'in:walk-in,messenger'],
            'fulfillment' => ['required', 'in:pickup,delivery'], 'payment_plan' => ['required', 'in:prepaid,cod'],
            'customer_name' => ['required', 'string', 'max:100'], 'customer_phone' => ['required', 'string', 'regex:/^[0-9+()\s-]{7,30}$/'],
            'delivery_address' => ['nullable', 'required_if:fulfillment,delivery', 'string', 'max:300'],
            'delivery_fee' => ['nullable', 'required_if:fulfillment,delivery', 'regex:/^\d{1,5}(\.\d{1,2})?$/'],
            'notes' => ['nullable', 'string', 'max:500'],
            'items' => ['required', 'array', 'min:1', 'max:100'], 'items.*.product_id' => ['required', 'integer', 'distinct'], 'items.*.quantity' => ['required', 'integer', 'min:1', 'max:999'],
        ];
        if ($request->input('payment_plan') === 'prepaid') {
            $rules = [...$rules, ...self::paymentRules()];
        }
        $order = $orders->create($request->user(), $request->validate($rules));

        return redirect()->route('orders.show', $order)->with('success', 'Confirmed order recorded. Review payment and fulfillment below.');
    }

    public function show(Request $request, Order $order, Orders $orders)
    {
        $orders->authorize($request->user(), $order);

        return view('orders.show', ['order' => $order->load('items', 'sale', 'user', 'paidBy')]);
    }

    public function pay(Request $request, Order $order, Orders $orders)
    {
        $orders->authorize($request->user(), $order);
        $orders->pay($request->user(), $order, $request->validate(self::paymentRules()));

        return redirect()->route('orders.show', $order)->with('success', 'Payment recorded once. A paid receipt is now available.');
    }

    public function status(Request $request, Order $order, Orders $orders)
    {
        $orders->authorize($request->user(), $order);
        $data = $request->validate(['status' => ['required', 'in:ready,out_for_delivery,completed,cancelled'], 'cancel_reason' => ['nullable', 'string', 'max:300'], 'stock_returned' => ['nullable', 'boolean']]);
        $orders->transition($request->user(), $order, $data['status'], $data['cancel_reason'] ?? null, (bool) ($data['stock_returned'] ?? false));

        return redirect()->route('orders.show', $order)->with('success', 'Order status updated.');
    }
}
