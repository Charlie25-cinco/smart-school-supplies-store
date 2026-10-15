<?php

namespace App\Services;

use App\Models\Product;
use App\Models\Refund;
use App\Models\Sale;
use App\Models\User;
use App\Support\Text;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class Refunds
{
    public function authorize(User $user, Sale $sale): void
    {
        abort_unless($user->active && ($user->isAdmin() || ($user->isCashier()
            && ($sale->user_id === $user->id || $sale->order?->paid_by === $user->id))), 403);
    }

    public function record(User $user, Sale $sale, array $data): Refund
    {
        $this->authorize($user, $sale);

        return DB::transaction(function () use ($user, $sale, $data) {
            $sale = Sale::with('items', 'refund')->findOrFail($sale->id);
            $this->authorize($user, $sale);
            if ($sale->refund) {
                throw ValidationException::withMessages(['sale' => 'This sale has already been refunded.']);
            }
            $hasProducts = $sale->items->contains(fn ($line) => $line->kind === 'product');
            if ($hasProducts && empty($data['goods_returned'])) {
                throw ValidationException::withMessages(['goods_returned' => 'Confirm that the sold goods were returned before refunding.']);
            }
            if ($sale->payment_method === 'gcash' && empty($data['manual_return'])) {
                throw ValidationException::withMessages(['manual_return' => 'Confirm that the GCash amount was returned manually through the store account.']);
            }
            $refund = Refund::create([
                'sale_id' => $sale->id, 'recorded_by' => $user->id, 'amount_cents' => $sale->total_cents,
                'reason' => Text::words($data['reason'], 300), 'goods_returned' => $hasProducts,
            ]);
            foreach ($sale->items as $line) {
                if ($line->kind === 'product') {
                    Product::whereKey($line->product_id)->increment('stock', $line->quantity);
                }
            }

            return $refund->fresh();
        }, 3);
    }
}
