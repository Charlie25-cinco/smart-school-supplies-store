<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Product extends Model
{
    protected $fillable = ['sku', 'name', 'category', 'kind', 'price_cents', 'stock', 'reserved', 'reorder_level', 'active', 'image_path', 'description'];

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

    public function saleItems()
    {
        return $this->hasMany(SaleItem::class);
    }

    public function orderItems()
    {
        return $this->hasMany(OrderItem::class);
    }
}
