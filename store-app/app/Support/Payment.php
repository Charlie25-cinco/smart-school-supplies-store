<?php

namespace App\Support;

use App\Models\Sale;
use Illuminate\Validation\ValidationException;

class Payment
{
    public static function fields(int $received, int $total, string $method, ?string $reference, bool $verified): array
    {
        if (! in_array($method, ['cash', 'gcash'], true)) {
            throw ValidationException::withMessages(['payment_method' => 'Choose cash or GCash.']);
        }
        if ($received < $total || $received > 999999999) {
            throw ValidationException::withMessages(['cash' => 'Payment received must cover the full total within the supported amount.']);
        }
        if ($method === 'gcash') {
            $reference = strtoupper(trim($reference ?? ''));
            if (! $verified || ! preg_match('/^[A-Z0-9-]{6,80}$/', $reference) || $received !== $total) {
                throw ValidationException::withMessages(['payment_reference' => 'Verify the payment in the store GCash account, enter its reference, and record the exact total.']);
            }
            if (Sale::where('payment_reference', $reference)->exists()) {
                throw ValidationException::withMessages(['payment_reference' => 'This GCash reference has already been recorded.']);
            }
        }

        return ['payment_method' => $method, 'payment_reference' => $method === 'gcash' ? $reference : null, 'cash_cents' => $received, 'change_cents' => $method === 'cash' ? $received - $total : 0];
    }
}
