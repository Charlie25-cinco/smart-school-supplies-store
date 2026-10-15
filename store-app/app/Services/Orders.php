<?php

namespace App\Services;

use App\Models\Order;
use App\Models\Product;
use App\Models\Sale;
use App\Models\StockMovement;
use App\Models\User;
use App\Support\Money;
use App\Support\Payment;
use App\Support\Text;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class Orders
{
    public function create(User $user, array $data): Order
    {
        $this->authorizeCashier($user);

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
                'customer_name' => Text::words($data['customer_name']), 'customer_phone' => $data['customer_phone'],
                'delivery_address' => $data['fulfillment'] === 'delivery' ? Text::words($data['delivery_address']) : null,
                'notes' => isset($data['notes']) ? Text::words($data['notes']) : null, 'subtotal_cents' => $subtotal, 'delivery_fee_cents' => $fee, 'total_cents' => $subtotal + $fee,
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
        abort_unless($user->active && ($user->isAdmin() || ($user->isCashier() && ($order->user_id === $user->id || $order->isAssignedTo($user)))), 403);
    }

    public function handoff(User $user, Order $order, array $data): Order
    {
        abort_unless($user->active && $user->isAdmin(), 403);

        return DB::transaction(function () use ($user, $order, $data) {
            abort_unless(User::whereKey($user->id)->where('active', true)->where('role', 'admin')->exists(), 403);
            $order = Order::with('user', 'items')->findOrFail($order->id);
            if (! $order->canBeHandedOff()) {
                throw ValidationException::withMessages(['handoff' => 'Only unfinished orders originally recorded by Admin can be handed off.']);
            }
            if (! hash_equals($this->editToken($order), $data['handoff_token'])) {
                throw ValidationException::withMessages(['handoff_token' => 'This order changed while you were choosing a Cashier. Reload and review the latest order before handing it off.']);
            }
            $cashier = User::whereKey($data['assigned_cashier_id'])->where('role', 'cashier')->where('active', true)->first();
            if (! $cashier) {
                throw ValidationException::withMessages(['assigned_cashier_id' => 'Choose an active Cashier account.']);
            }
            if ($order->assigned_cashier_id !== $cashier->id) {
                $order->update(['assigned_cashier_id' => $cashier->id, 'assigned_by' => $user->id, 'assigned_at' => now(), 'assignment_version' => $order->assignment_version + 1]);
            }

            return $order->fresh();
        }, 3);
    }

    private function authorizeCashier(User $user): void
    {
        abort_unless($user->active && $user->isCashier(), 403);
    }

    public function editToken(Order $order): string
    {
        $order->loadMissing('items');

        return hash('sha256', json_encode([
            $order->only(['id', 'user_id', 'assigned_cashier_id', 'assigned_by', 'assigned_at', 'assignment_version', 'status', 'sale_id', 'fulfillment', 'customer_name', 'customer_phone', 'delivery_address', 'notes', 'subtotal_cents', 'delivery_fee_cents', 'total_cents']),
            $order->items->sortBy('product_id')->map->only(['id', 'product_id', 'name', 'sku', 'kind', 'quantity', 'price_cents', 'total_cents'])->values()->all(),
        ], JSON_THROW_ON_ERROR));
    }

    public function update(User $user, Order $order, array $data): Order
    {
        $this->authorizeCashier($user);

        return DB::transaction(function () use ($user, $order, $data) {
            $order = Order::with('items')->findOrFail($order->id);
            $this->authorize($user, $order);
            if (! in_array($order->status, ['preparing', 'ready'], true)) {
                throw ValidationException::withMessages(['order' => 'Only preparing or ready orders can be edited.']);
            }
            if (! hash_equals($this->editToken($order), $data['edit_token'])) {
                throw ValidationException::withMessages(['edit_token' => 'This order changed while you were editing. Reload the edit page and review the latest details.']);
            }
            $details = [
                'customer_name' => Text::words($data['customer_name']), 'customer_phone' => $data['customer_phone'],
                'delivery_address' => $order->fulfillment === 'delivery' ? Text::words($data['delivery_address']) : null,
                'notes' => isset($data['notes']) ? Text::words($data['notes']) : null,
            ];
            if ($order->sale_id) {
                if (array_key_exists('items', $data) || array_key_exists('delivery_fee', $data)) {
                    throw ValidationException::withMessages(['order' => 'Paid items and fees are fixed. Only customer details and notes can be corrected.']);
                }
                $order->update($details);

                return $order->fresh();
            }
            $existing = $order->items->keyBy('product_id');
            $lines = [];
            $subtotal = 0;
            foreach ($data['items'] as $item) {
                $product = Product::find($item['product_id']);
                $old = $existing->get($item['product_id']);
                $quantity = (int) $item['quantity'];
                if (! $product || $product->kind === 'consumable' || (! $product->active && (! $old || $quantity > $old->quantity))) {
                    throw ValidationException::withMessages(['items' => 'An added or increased item is no longer available. Reload and review the order.']);
                }
                // Retained lines keep the agreed name, SKU, kind and price.
                $snapshot = $old ? $old->only(['product_id', 'name', 'sku', 'kind', 'price_cents']) : [...$product->only(['name', 'sku', 'kind', 'price_cents']), 'product_id' => $product->id];
                $lineTotal = $quantity * $snapshot['price_cents'];
                $subtotal += $lineTotal;
                $lines[$product->id] = [...$snapshot, 'quantity' => $quantity, 'total_cents' => $lineTotal];
            }
            $fee = $order->fulfillment === 'delivery' ? Money::cents((string) $data['delivery_fee']) : 0;
            if ($subtotal + $fee > 999999999) {
                throw ValidationException::withMessages(['items' => 'This order exceeds the supported payment amount.']);
            }
            foreach (array_unique([...$existing->keys()->all(), ...array_keys($lines)]) as $productId) {
                $old = $existing->get($productId);
                $line = $lines[$productId] ?? null;
                if (($old?->kind ?? $line['kind']) !== 'product') {
                    continue;
                }
                $difference = ($line['quantity'] ?? 0) - ($old?->quantity ?? 0);
                if ($difference > 0 && ! Product::whereKey($productId)->whereRaw('stock - reserved >= ?', [$difference])->increment('reserved', $difference)) {
                    throw ValidationException::withMessages(['items' => 'Insufficient available stock for the edited order. Reduce quantities and retry.']);
                }
                if ($difference < 0 && ! Product::whereKey($productId)->where('reserved', '>=', -$difference)->decrement('reserved', -$difference)) {
                    throw ValidationException::withMessages(['items' => 'Reservation is inconsistent; ask the Admin to review inventory.']);
                }
            }
            foreach ($lines as $productId => $line) {
                if ($old = $existing->get($productId)) {
                    $old->update(['quantity' => $line['quantity'], 'total_cents' => $line['total_cents']]);
                } else {
                    $order->items()->create($line);
                }
            }
            $order->items()->whereNotIn('product_id', array_keys($lines))->delete();
            $order->update([...$details, 'subtotal_cents' => $subtotal, 'delivery_fee_cents' => $fee, 'total_cents' => $subtotal + $fee]);

            return $order->fresh();
        }, 3);
    }

    public function pay(User $user, Order $order, array $data): Sale
    {
        $this->authorizeCashier($user);

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
                        throw ValidationException::withMessages(['items' => 'Reserved stock is inconsistent. Ask the Admin to review inventory.']);
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
        $this->authorizeCashier($user);

        return DB::transaction(function () use ($user, $order, $status, $reason, $returned) {
            $order = Order::findOrFail($order->id);
            $this->authorize($user, $order);
            if ($order->status === $status) {
                return $order;
            }
            if ($status === 'cancelled') {
                if ($order->sale_id || in_array($order->status, ['completed', 'cancelled'], true)) {
                    throw ValidationException::withMessages(['status' => 'Only an unpaid, unfinished order can be cancelled. Paid sales need a recorded refund.']);
                }
                if (! trim($reason ?? '') || ($order->status === 'out_for_delivery' && ! $returned)) {
                    throw ValidationException::withMessages(['cancel_reason' => 'Enter a reason and confirm returned goods for a dispatched order.']);
                }
                foreach ($order->items as $line) {
                    if ($line->kind === 'product' && ! Product::whereKey($line->product_id)->where('reserved', '>=', $line->quantity)->decrement('reserved', $line->quantity)) {
                        throw ValidationException::withMessages(['items' => 'Reservation is inconsistent; ask the owner to review inventory.']);
                    }
                }
                $order->update(['status' => 'cancelled', 'cancel_reason' => Text::words($reason, 300)]);
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
