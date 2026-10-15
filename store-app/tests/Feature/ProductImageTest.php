<?php

namespace Tests\Feature;

use App\Models\Product;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\TestCase;

class ProductImageTest extends TestCase
{
    use RefreshDatabase;

    private function admin(): User
    {
        return User::factory()->create(['role' => 'admin']);
    }

    private function item(array $overrides = []): array
    {
        return array_merge(['sku' => 'ITEM-'.Str::random(8), 'name' => 'Notebook', 'category' => 'Paper', 'kind' => 'product', 'price' => '45.25', 'reorder_level' => 3, 'active' => '1', 'stock' => 10], $overrides);
    }

    public function test_admin_uploads_a_product_photo(): void
    {
        Storage::fake('local');
        $this->actingAs($this->admin())->post('/inventory', $this->item(['image' => UploadedFile::fake()->image('photo.jpg')]))->assertRedirect(route('inventory'));
        $product = Product::firstOrFail();
        $this->assertNotNull($product->image_path);
        $this->assertStringStartsWith('product-images/', $product->image_path);
        Storage::disk('local')->assertExists($product->image_path);
    }

    public function test_invalid_or_oversized_photos_are_rejected_without_changes(): void
    {
        Storage::fake('local');
        $this->actingAs($this->admin());
        $this->post('/inventory', $this->item(['sku' => 'BAD-1', 'image' => UploadedFile::fake()->create('notes.txt', 10, 'text/plain')]))->assertSessionHasErrors('image');
        $this->post('/inventory', $this->item(['sku' => 'BAD-2', 'image' => UploadedFile::fake()->image('big.jpg')->size(3000)]))->assertSessionHasErrors('image');
        $this->assertSame(0, Product::count());
        $this->assertCount(0, Storage::disk('local')->allFiles('product-images'));
    }

    public function test_replacing_a_photo_removes_the_previous_file(): void
    {
        Storage::fake('local');
        $this->actingAs($this->admin());
        $this->post('/inventory', $this->item(['image' => UploadedFile::fake()->image('first.jpg')]))->assertRedirect();
        $product = Product::firstOrFail();
        $previous = $product->image_path;
        $this->put("/inventory/{$product->id}", $this->item(['image' => UploadedFile::fake()->image('second.png')]))->assertRedirect(route('inventory'));
        $this->assertNotSame($previous, $product->fresh()->image_path);
        Storage::disk('local')->assertMissing($previous);
        Storage::disk('local')->assertExists($product->fresh()->image_path);
    }

    public function test_removing_a_photo_clears_it(): void
    {
        Storage::fake('local');
        $this->actingAs($this->admin());
        $this->post('/inventory', $this->item(['image' => UploadedFile::fake()->image('photo.jpg')]))->assertRedirect();
        $product = Product::firstOrFail();
        $this->put("/inventory/{$product->id}", $this->item(['remove_image' => '1']))->assertRedirect(route('inventory'));
        $this->assertNull($product->fresh()->image_path);
        Storage::disk('local')->assertMissing($product->image_path);
    }

    public function test_photo_route_serves_staff_only(): void
    {
        Storage::fake('local');
        $this->get('/product-images/1')->assertRedirect('/login');
        $this->actingAs($this->admin())->post('/inventory', $this->item(['image' => UploadedFile::fake()->image('photo.jpg')]))->assertRedirect();
        $product = Product::firstOrFail();
        $this->actingAs(User::factory()->create(['role' => 'cashier']))->get("/product-images/{$product->id}")->assertOk()->assertHeader('Content-Type', 'image/jpeg');
        $product->update(['image_path' => null]);
        $this->get("/product-images/{$product->id}")->assertNotFound();
    }

    public function test_cashier_cannot_upload_or_change_photos(): void
    {
        Storage::fake('local');
        $product = Product::create(['sku' => 'ITEM-1', 'name' => 'Notebook', 'category' => 'Paper', 'kind' => 'product', 'price_cents' => 4525, 'stock' => 10, 'reorder_level' => 3, 'active' => true]);
        $this->actingAs(User::factory()->create(['role' => 'cashier']));
        $this->put("/inventory/{$product->id}", ['image' => UploadedFile::fake()->image('photo.jpg')])->assertForbidden();
        $this->assertNull($product->fresh()->image_path);
    }
}
