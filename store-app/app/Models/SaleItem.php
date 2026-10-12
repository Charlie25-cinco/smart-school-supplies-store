<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class SaleItem extends Model
{
    public $timestamps = false;

    protected $fillable = ['product_id', 'name', 'sku', 'kind', 'quantity', 'price_cents', 'total_cents'];
}
