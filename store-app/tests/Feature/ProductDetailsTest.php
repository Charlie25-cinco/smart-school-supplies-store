<?php

namespace Tests\Feature;

use App\Models\Product;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

class ProductDetailsTest extends TestCase
{
    use RefreshDatabase;

    private function admin(): User
    {
        return User::factory()->create(['role' => 'admin']);
    }

    private function item(array $overrides = []): array
    {
        return array_merge(['sku' => 'ITEM-'.Str::random(8), 'name' => 'Notebook', 'category' => 'Paper', 'kind' => 'product', 'price' => '45.25', 'reorder_level' => 3, 'active' => '1', 'stock' => 10, 'description' => ''], $overrides);
    }

    public function test_create_saves_description_and_new_category(): void
    {
        $this->actingAs($this->admin())->post('/inventory', $this->item(['category' => '', 'category_new' => 'New Arrivals', 'description' => '  A dependable ruled notebook.  ']))->assertRedirect(route('inventory'));
        $product = Product::firstOrFail();
        $this->assertSame('New Arrivals', $product->category);
        $this->assertSame('A dependable ruled notebook.', $product->description);
    }

    public function test_create_uses_selected_category_when_no_new_value(): void
    {
        $this->actingAs($this->admin())->post('/inventory', $this->item(['category' => 'Paper', 'category_new' => '   ']))->assertRedirect(route('inventory'));
        $this->assertSame('Paper', Product::firstOrFail()->category);
    }

    public function test_blank_category_is_rejected_without_changes(): void
    {
        $this->actingAs($this->admin())->post('/inventory', $this->item(['category' => '', 'category_new' => '']))->assertSessionHasErrors('category');
        $this->assertSame(0, Product::count());
    }

    public function test_overlong_description_is_rejected_and_form_recovers(): void
    {
        $product = Product::create(['sku' => 'ITEM-1', 'name' => 'Notebook', 'category' => 'Paper', 'kind' => 'product', 'price_cents' => 4525, 'stock' => 10, 'reorder_level' => 3, 'active' => true, 'description' => 'Kept']);
        $this->actingAs($this->admin())->put("/inventory/{$product->id}", $this->item(['description' => str_repeat('a', 1001)]))->assertSessionHasErrors('description');
        $this->assertSame('Kept', $product->fresh()->description);
    }

    public function test_form_offers_existing_categories_as_a_dropdown(): void
    {
        Product::create(['sku' => 'ITEM-1', 'name' => 'Notebook', 'category' => 'Paper', 'kind' => 'product', 'price_cents' => 4525, 'stock' => 10, 'reorder_level' => 3, 'active' => true]);
        $response = $this->actingAs($this->admin())->get('/inventory/create')->assertOk();
        $response->assertSee('<select id="category" name="category">', false);
        $response->assertSee('Or new category');
        $response->assertSee('Short catalog detail');
    }
}
