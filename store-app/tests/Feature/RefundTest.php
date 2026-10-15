<?php

namespace Tests\Feature;

use App\Models\Product;
use App\Models\Refund;
use App\Models\Sale;
use App\Models\Setting;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

class RefundTest extends TestCase
{
    use RefreshDatabase;

    private function staff(string $role = 'cashier'): User
    {
        return User::factory()->create(['role' => $role]);
    }

    private function product(array $overrides = []): Product
    {
        return Product::create(array_merge(['sku' => 'ITEM-'.Str::random(8), 'name' => 'Notebook', 'category' => 'Paper', 'kind' => 'product', 'price_cents' => 4525, 'stock' => 10, 'reorder_level' => 3, 'active' => true], $overrides));
    }

    private function sale(User $cashier, Product $product, int $quantity = 2): Sale
    {
        $this->actingAs($cashier)->post('/sales', ['reference' => (string) Str::uuid(), 'channel' => 'walk-in', 'cash' => '200.00', 'items' => [['product_id' => $product->id, 'quantity' => $quantity]]])->assertRedirect();

        return Sale::latest('id')->firstOrFail();
    }

    public function test_cashier_refunds_own_sale_and_stock_returns(): void
    {
        $cashier = $this->staff();
        $product = $this->product();
        $sale = $this->sale($cashier, $product);
        $this->assertSame(8, $product->fresh()->stock);
        $this->actingAs($cashier)->post("/sales/{$sale->id}/refund", ['reason' => 'Customer changed mind', 'goods_returned' => '1'])->assertRedirect();
        $refund = Refund::firstOrFail();
        $this->assertSame($sale->total_cents, $refund->amount_cents);
        $this->assertSame($cashier->id, $refund->recorded_by);
        $this->assertSame(10, $product->fresh()->stock);
        $this->assertTrue($sale->fresh()->refund->is($refund));
    }

    public function test_refund_is_once_only_and_requires_reason_and_goods(): void
    {
        $cashier = $this->staff();
        $sale = $this->sale($cashier, $this->product());
        $this->actingAs($cashier)->post("/sales/{$sale->id}/refund", ['goods_returned' => '1'])->assertSessionHasErrors('reason');
        $this->actingAs($cashier)->post("/sales/{$sale->id}/refund", ['reason' => 'No goods'])->assertSessionHasErrors('goods_returned');
        $this->assertSame(0, Refund::count());
        $this->actingAs($cashier)->post("/sales/{$sale->id}/refund", ['reason' => 'Changed mind', 'goods_returned' => '1'])->assertRedirect();
        $this->actingAs($cashier)->post("/sales/{$sale->id}/refund", ['reason' => 'Again', 'goods_returned' => '1'])->assertSessionHasErrors('sale');
        $this->assertSame(1, Refund::count());
    }

    public function test_gcash_refund_requires_manual_confirmation(): void
    {
        $cashier = $this->staff();
        $product = $this->product();
        $this->actingAs($cashier)->post('/sales', ['reference' => (string) Str::uuid(), 'channel' => 'walk-in', 'cash' => '90.50', 'items' => [['product_id' => $product->id, 'quantity' => 2]], 'payment_method' => 'gcash', 'payment_reference' => 'GCASH-REFUND-1', 'payment_verified' => '1'])->assertRedirect();
        $sale = Sale::latest('id')->firstOrFail();
        $this->actingAs($cashier)->post("/sales/{$sale->id}/refund", ['reason' => 'Changed mind', 'goods_returned' => '1'])->assertSessionHasErrors('manual_return');
        $this->actingAs($cashier)->post("/sales/{$sale->id}/refund", ['reason' => 'Changed mind', 'goods_returned' => '1', 'manual_return' => '1'])->assertRedirect();
        $this->assertSame(1, Refund::count());
    }

    public function test_unauthorized_staff_cannot_refund(): void
    {
        $cashier = $this->staff();
        $sale = $this->sale($cashier, $this->product());
        auth()->logout();
        $this->post("/sales/{$sale->id}/refund", ['reason' => 'Trying', 'goods_returned' => '1'])->assertRedirect('/login');
        $this->actingAs($this->staff())->post("/sales/{$sale->id}/refund", ['reason' => 'Trying', 'goods_returned' => '1'])->assertForbidden();
        $this->assertSame(0, Refund::count());
        $this->actingAs(User::factory()->create(['role' => 'admin']))->post("/sales/{$sale->id}/refund", ['reason' => 'Admin refund', 'goods_returned' => '1'])->assertRedirect();
        $this->assertSame(1, Refund::count());
    }

    public function test_service_sale_refunds_without_goods_confirmation(): void
    {
        $cashier = $this->staff();
        $service = $this->product(['kind' => 'service', 'price_cents' => 300, 'stock' => 0, 'name' => 'Printing']);
        $sale = $this->sale($cashier, $service, 5);
        $this->actingAs($cashier)->post("/sales/{$sale->id}/refund", ['reason' => 'Service not rendered'])->assertRedirect();
        $this->assertFalse(Refund::firstOrFail()->goods_returned);
    }

    public function test_sales_report_shows_refund_and_net(): void
    {
        $cashier = $this->staff();
        $sale = $this->sale($cashier, $this->product());
        $this->actingAs($cashier)->post("/sales/{$sale->id}/refund", ['reason' => 'Changed mind', 'goods_returned' => '1'])->assertRedirect();
        $this->actingAs($cashier)->get('/sales')->assertOk()->assertSee('Refunded')->assertSee('Net');
        $this->actingAs($cashier)->get("/sales/{$sale->id}/receipt")->assertOk()->assertSee('Refunded')->assertSee('Changed Mind');
        Setting::set('receipt_note', 'Printed note');
        $this->actingAs($cashier)->get("/sales/{$sale->id}/receipt")->assertOk()->assertSee('Printed note');
    }

    public function test_dashboard_shows_net_revenue_and_refunded_total(): void
    {
        $cashier = $this->staff();
        $product = $this->product(['stock' => 10, 'price_cents' => 5000]);
        $refunded = $this->sale($cashier, $product, 2);
        $this->actingAs($cashier)->post("/sales/{$refunded->id}/refund", ['reason' => 'Changed mind', 'goods_returned' => '1'])->assertRedirect();
        $kept = $this->sale($cashier, $product, 1);
        $this->actingAs(User::factory()->create(['role' => 'admin']))->get('/dashboard')->assertOk()
            ->assertSee('₱50.00')
            ->assertSee('₱100.00')
            ->assertSee('Refunded');
        $this->assertSame(5000, $kept->fresh()->total_cents);
    }
}
