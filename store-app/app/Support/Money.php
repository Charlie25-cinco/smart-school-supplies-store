<?php

namespace App\Support;

class Money
{
    public static function cents(string $value): int
    {
        [$whole, $fraction] = array_pad(explode('.', $value, 2), 2, '');

        return ((int) $whole * 100) + (int) str_pad($fraction, 2, '0');
    }

    public static function format(int $cents): string
    {
        return '₱'.number_format($cents / 100, 2);
    }
}
