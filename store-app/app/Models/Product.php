<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Product extends Model
{
    protected $fillable = ['sku', 'name', 'category', 'kind', 'price_cents', 'stock', 'reserved', 'reorder_level', 'active'];

    protected function casts(): array
    {
        return ['active' => 'boolean', 'price_cents' => 'integer', 'stock' => 'integer', 'reserved' => 'integer', 'reorder_level' => 'integer'];
    }

    public function available(): int
    {
        return $this->stock - $this->reserved;
    }

    public function movements()
    {
        return $this->hasMany(StockMovement::class);
    }
}
