<?php

namespace App\Services;

use App\Models\Order;
use App\Models\Product;
use App\Models\Sale;
use App\Models\StockMovement;
use App\Models\User;
use App\Support\Payment;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class Checkout
{
    public function complete(User $user, array $items, int $cash, string $channel, string $reference, string $method = 'cash', ?string $paymentReference = null, bool $verified = false): Sale
    {
        abort_unless($user->active && $user->isCashier(), 403);

        return DB::transaction(function () use ($user, $items, $cash, $channel, $reference, $method, $paymentReference, $verified) {
            $existing = Sale::where('reference', $reference)->first();
            if ($existing) {
                abort_unless($existing->user_id === $user->id, 403);

                return $existing;
            }
            if (Order::where('reference', $reference)->exists()) {
                throw ValidationException::withMessages(['reference' => 'This checkout is already an order. Open its details to collect payment.']);
            }
            $lines = [];
            $total = 0;
            foreach ($items as $item) {
                $product = Product::where('active', true)->find($item['product_id']);
                if (! $product || $product->kind === 'consumable') {
                    throw ValidationException::withMessages(['items' => 'An item is no longer available. Refresh the product list.']);
                }
                $quantity = (int) $item['quantity'];
                if ($product->kind === 'product') {
                    // Conditional update is atomic in SQLite; stale browser stock cannot oversell.
                    $updated = Product::whereKey($product->id)->whereRaw('stock - reserved >= ?', [$quantity])->decrement('stock', $quantity);
                    if (! $updated) {
                        throw ValidationException::withMessages(['items' => "Insufficient stock for {$product->name}. Refresh the product list."]);
                    }
                }
                $lineTotal = $product->price_cents * $quantity;
                $total += $lineTotal;
                $lines[] = ['product_id' => $product->id, 'name' => $product->name, 'sku' => $product->sku, 'kind' => $product->kind, 'quantity' => $quantity, 'price_cents' => $product->price_cents, 'total_cents' => $lineTotal];
            }
            if ($total > 999999999 || $cash < $total) {
                throw ValidationException::withMessages(['cash' => $cash < $total ? 'Cash received must cover the full total.' : 'This sale exceeds the supported transaction amount.']);
            }
            $payment = Payment::fields($cash, $total, $method, $paymentReference, $verified);
            $sale = Sale::create(['reference' => $reference, 'user_id' => $user->id, 'channel' => $channel, 'total_cents' => $total, ...$payment]);
            $sale->items()->createMany($lines);
            foreach ($lines as $line) {
                if ($line['kind'] === 'product') {
                    StockMovement::create(['product_id' => $line['product_id'], 'user_id' => $user->id, 'sale_id' => $sale->id, 'quantity' => -$line['quantity'], 'reason' => 'Sale '.$sale->receiptNumber()]);
                }
            }

            return $sale;
        }, 3);
    }
}
