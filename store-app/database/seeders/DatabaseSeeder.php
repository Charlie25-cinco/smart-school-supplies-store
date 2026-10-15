<?php

namespace Database\Seeders;

use App\Models\Product;
use App\Models\StockMovement;
use Illuminate\Database\Console\Seeds\WithoutModelEvents;
use Illuminate\Database\Seeder;

class DatabaseSeeder extends Seeder
{
    use WithoutModelEvents;

    /**
     * Seed the application's database.
     */
    public function run(): void
    {
        // Demo/test seed data lives here — never in the public catalog file,
        // which mirrors the store database instead.
        $items = json_decode(file_get_contents(database_path('seeders/data/sample-products.json')), true, 512, JSON_THROW_ON_ERROR);
        foreach ($items as $item) {
            // Re-running the seeder never resets a store's existing stock or prices.
            $product = Product::firstOrCreate(['sku' => $item['sku']], collect($item)->only(['name', 'category', 'kind', 'price_cents', 'stock', 'reorder_level'])->all());
            if ($product->wasRecentlyCreated && $product->stock > 0) {
                StockMovement::create(['product_id' => $product->id, 'quantity' => $product->stock, 'reason' => 'Sample opening stock']);
            }
        }
    }
}
