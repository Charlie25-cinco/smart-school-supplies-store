<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Refund extends Model
{
    protected $fillable = ['sale_id', 'recorded_by', 'amount_cents', 'reason', 'goods_returned'];

    protected function casts(): array
    {
        return ['amount_cents' => 'integer', 'goods_returned' => 'boolean'];
    }

    public function sale()
    {
        return $this->belongsTo(Sale::class);
    }

    public function recorder()
    {
        return $this->belongsTo(User::class, 'recorded_by');
    }
}
