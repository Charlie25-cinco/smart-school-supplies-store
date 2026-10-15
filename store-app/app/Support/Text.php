<?php

namespace App\Support;

class Text
{
    /**
     * Uppercase the first letter of each word, leaving all other
     * characters untouched (multibyte-safe). An optional maximum
     * length guards against case-expansion overflow on strict databases.
     */
    public static function words(?string $value, ?int $max = null): string
    {
        $value = (string) $value;
        $titled = preg_replace_callback('/\p{L}+/u', fn (array $word): string => mb_strtoupper(mb_substr($word[0], 0, 1)).mb_substr($word[0], 1), $value) ?? $value;

        return $max === null ? $titled : mb_substr($titled, 0, $max);
    }
}
