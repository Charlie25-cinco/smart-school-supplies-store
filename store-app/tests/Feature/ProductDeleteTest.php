<?php

namespace Tests\Feature;

use App\Models\Product;
use App\Models\StockMovement;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class ProductDeleteTest extends TestCase
{
    use RefreshDatabase;

    public function test_admin_deletes_only_never_transacted_items(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);
        $unused = Product::create(['sku' => 'DEL-1', 'name' => 'Stale', 'category' => 'Paper', 'kind' => 'product', 'price_cents' => 100, 'stock' => 0, 'reorder_level' => 1, 'active' => false]);
        $this->actingAs($admin)->delete("/inventory/{$unused->id}")->assertRedirect(route('inventory'));
        $this->assertSame(0, Product::where('sku', 'DEL-1')->count());
        $opened = Product::create(['sku' => 'DEL-0', 'name' => 'Fresh', 'category' => 'Paper', 'kind' => 'product', 'price_cents' => 100, 'stock' => 5, 'reorder_level' => 1, 'active' => true]);
        $opened->movements()->create(['user_id' => $admin->id, 'quantity' => 5, 'reason' => 'Opening stock']);
        $this->actingAs($admin)->delete("/inventory/{$opened->id}")->assertRedirect(route('inventory'));
        $this->assertSame(0, Product::where('sku', 'DEL-0')->count());
        $this->assertSame(0, StockMovement::where('product_id', $opened->id)->count());
        $used = Product::create(['sku' => 'DEL-2', 'name' => 'Sold', 'category' => 'Paper', 'kind' => 'product', 'price_cents' => 100, 'stock' => 5, 'reorder_level' => 1, 'active' => true]);
        $used->movements()->create(['user_id' => $admin->id, 'quantity' => 5, 'reason' => 'Opening stock']);
        $used->movements()->create(['user_id' => $admin->id, 'quantity' => 3, 'reason' => 'New supplies received']);
        $this->actingAs($admin)->delete("/inventory/{$used->id}")->assertSessionHasErrors('product');
        $this->assertSame(1, Product::where('sku', 'DEL-2')->count());
    }

    public function test_cashier_and_guest_cannot_delete(): void
    {
        $product = Product::create(['sku' => 'DEL-3', 'name' => 'Stale', 'category' => 'Paper', 'kind' => 'product', 'price_cents' => 100, 'stock' => 0, 'reorder_level' => 1, 'active' => false]);
        $this->delete("/inventory/{$product->id}")->assertRedirect('/login');
        $this->actingAs(User::factory()->create(['role' => 'cashier']))->delete("/inventory/{$product->id}")->assertForbidden();
        $this->assertSame(1, Product::where('sku', 'DEL-3')->count());
    }
}
