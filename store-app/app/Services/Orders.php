<?php

namespace App\Services;

use App\Models\Order;
use App\Models\Product;
use App\Models\Sale;
use App\Models\StockMovement;
use App\Models\User;
use App\Support\Money;
use App\Support\Payment;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class Orders
{
    public function create(User $user, array $data): Order
    {
        return DB::transaction(function () use ($user, $data) {
            $existing = Order::where('reference', $data['reference'])->first();
            if ($existing) {
                $this->authorize($user, $existing);

                return $existing;
            }
            if (Sale::where('reference', $data['reference'])->exists()) {
                throw ValidationException::withMessages(['reference' => 'This checkout was already recorded as a sale. Start a new order.']);
            }
            $lines = [];
            $subtotal = 0;
            foreach ($data['items'] as $item) {
                $product = Product::where('active', true)->find($item['product_id']);
                if (! $product || $product->kind === 'consumable') {
                    throw ValidationException::withMessages(['items' => 'An item is no longer available. Refresh the list.']);
                }
                $quantity = (int) $item['quantity'];
                if ($product->kind === 'product' && ! Product::whereKey($product->id)->whereRaw('stock - reserved >= ?', [$quantity])->increment('reserved', $quantity)) {
                    throw ValidationException::withMessages(['items' => "Insufficient stock for {$product->name}. Refresh the list."]);
                }
                $lineTotal = $quantity * $product->price_cents;
                $subtotal += $lineTotal;
                $lines[] = ['product_id' => $product->id, 'name' => $product->name, 'sku' => $product->sku, 'kind' => $product->kind, 'quantity' => $quantity, 'price_cents' => $product->price_cents, 'total_cents' => $lineTotal];
            }
            $fee = $data['fulfillment'] === 'delivery' ? Money::cents((string) $data['delivery_fee']) : 0;
            if ($subtotal + $fee > 999999999) {
                throw ValidationException::withMessages(['items' => 'This order exceeds the supported payment amount.']);
            }
            $order = Order::create([
                'reference' => $data['reference'], 'user_id' => $user->id, 'channel' => $data['channel'],
                'fulfillment' => $data['fulfillment'], 'payment_plan' => $data['payment_plan'], 'status' => 'preparing',
                'customer_name' => $data['customer_name'], 'customer_phone' => $data['customer_phone'],
                'delivery_address' => $data['fulfillment'] === 'delivery' ? $data['delivery_address'] : null,
                'notes' => $data['notes'] ?? null, 'subtotal_cents' => $subtotal, 'delivery_fee_cents' => $fee, 'total_cents' => $subtotal + $fee,
            ]);
            $order->items()->createMany($lines);
            if ($data['payment_plan'] === 'prepaid') {
                $this->pay($user, $order, $data);
            }

            return $order->fresh();
        }, 3);
    }

    public function authorize(User $user, Order $order): void
    {
        abort_unless($user->role === 'owner' || $order->user_id === $user->id, 403);
    }

    public function pay(User $user, Order $order, array $data): Sale
    {
        return DB::transaction(function () use ($user, $order, $data) {
            $order = Order::findOrFail($order->id);
            $this->authorize($user, $order);
            if ($order->sale_id) {
                return $order->sale;
            }
            if ($order->status === 'cancelled') {
                throw ValidationException::withMessages(['payment' => 'A cancelled order cannot receive payment.']);
            }
            $payment = Payment::fields(Money::cents((string) $data['cash']), $order->total_cents, $data['payment_method'], $data['payment_reference'] ?? null, (bool) ($data['payment_verified'] ?? false));
            foreach ($order->items as $line) {
                if ($line->kind === 'product') {
                    $updated = DB::update('UPDATE products SET stock = stock - ?, reserved = reserved - ?, updated_at = ? WHERE id = ? AND stock >= ? AND reserved >= ?', [$line->quantity, $line->quantity, now(), $line->product_id, $line->quantity, $line->quantity]);
                    if (! $updated) {
                        throw ValidationException::withMessages(['items' => 'Reserved stock is inconsistent. Ask the owner to review inventory.']);
                    }
                }
            }
            $sale = Sale::create(['reference' => $order->reference, 'user_id' => $order->user_id, 'channel' => $order->channel, 'total_cents' => $order->total_cents, 'delivery_fee_cents' => $order->delivery_fee_cents, ...$payment]);
            $sale->items()->createMany($order->items->map->only(['product_id', 'name', 'sku', 'kind', 'quantity', 'price_cents', 'total_cents'])->all());
            foreach ($order->items as $line) {
                if ($line->kind === 'product') {
                    StockMovement::create(['product_id' => $line->product_id, 'user_id' => $user->id, 'sale_id' => $sale->id, 'quantity' => -$line->quantity, 'reason' => 'Paid order '.$order->number()]);
                }
            }
            $order->update(['sale_id' => $sale->id, 'paid_by' => $user->id]);

            return $sale;
        }, 3);
    }

    public function transition(User $user, Order $order, string $status, ?string $reason = null, bool $returned = false): Order
    {
        return DB::transaction(function () use ($user, $order, $status, $reason, $returned) {
            $order = Order::findOrFail($order->id);
            $this->authorize($user, $order);
            if ($order->status === $status) {
                return $order;
            }
            if ($status === 'cancelled') {
                if ($order->sale_id || in_array($order->status, ['completed', 'cancelled'], true)) {
                    throw ValidationException::withMessages(['status' => 'Only an unpaid, unfinished order can be cancelled. Paid refunds need a separate process.']);
                }
                if (! trim($reason ?? '') || ($order->status === 'out_for_delivery' && ! $returned)) {
                    throw ValidationException::withMessages(['cancel_reason' => 'Enter a reason and confirm returned goods for a dispatched order.']);
                }
                foreach ($order->items as $line) {
                    if ($line->kind === 'product' && ! Product::whereKey($line->product_id)->where('reserved', '>=', $line->quantity)->decrement('reserved', $line->quantity)) {
                        throw ValidationException::withMessages(['items' => 'Reservation is inconsistent; ask the owner to review inventory.']);
                    }
                }
                $order->update(['status' => 'cancelled', 'cancel_reason' => $reason]);
            } else {
                $next = match ($order->status) {
                    'preparing' => 'ready',
                    'ready' => $order->fulfillment === 'delivery' ? 'out_for_delivery' : 'completed',
                    'out_for_delivery' => 'completed',
                    default => null,
                };
                if ($next !== $status || ($status === 'completed' && ! $order->sale_id)) {
                    throw ValidationException::withMessages(['status' => 'Follow the order steps and record payment before completing pickup or delivery.']);
                }
                $order->update(['status' => $status]);
            }

            return $order;
        }, 3);
    }
}
