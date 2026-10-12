<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Sale extends Model
{
    protected $fillable = ['reference', 'user_id', 'channel', 'total_cents', 'cash_cents', 'change_cents', 'payment_method', 'payment_reference', 'delivery_fee_cents'];

    public function order()
    {
        return $this->hasOne(Order::class);
    }

    public function items()
    {
        return $this->hasMany(SaleItem::class);
    }

    public function user()
    {
        return $this->belongsTo(User::class);
    }

    public function receiptNumber(): string
    {
        return 'SS-'.str_pad((string) $this->id, 6, '0', STR_PAD_LEFT);
    }
}
