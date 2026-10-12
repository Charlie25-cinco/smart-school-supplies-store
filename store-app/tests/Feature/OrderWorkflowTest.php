<?php

namespace Tests\Feature;

use App\Models\Order;
use App\Models\Product;
use App\Models\Sale;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

class OrderWorkflowTest extends TestCase
{
    use RefreshDatabase;

    private function item(array $overrides = []): Product
    {
        return Product::create([...['sku' => 'TEST-'.Str::random(8), 'name' => 'Test notebook', 'category' => 'Paper', 'kind' => 'product', 'price_cents' => 4525, 'stock' => 5, 'reorder_level' => 2, 'active' => true], ...$overrides]);
    }

    private function orderData(Product $item, array $overrides = []): array
    {
        return [...['reference' => (string) Str::uuid(), 'channel' => 'messenger', 'fulfillment' => 'delivery', 'payment_plan' => 'cod', 'customer_name' => 'Demo Customer', 'customer_phone' => '09123456789', 'delivery_address' => 'Demo address, near school', 'delivery_fee' => '20.00', 'items' => [['product_id' => $item->id, 'quantity' => 2]]], ...$overrides];
    }

    private function payment(array $overrides = []): array
    {
        return [...['payment_method' => 'cash', 'cash' => '120.00'], ...$overrides];
    }

    public function test_unpaid_order_reserves_stock_and_is_excluded_from_paid_reports(): void
    {
        $item = $this->item();
        $this->actingAs(User::factory()->create(['role' => 'owner']))->post('/orders', $this->orderData($item))->assertRedirect();
        $order = Order::firstOrFail();
        $this->assertSame(11050, $order->total_cents);
        $this->assertSame(5, $item->fresh()->stock);
        $this->assertSame(2, $item->fresh()->reserved);
        $this->assertDatabaseCount('sales', 0);
        $this->get('/orders')->assertSee('110.50')->assertSee('Unpaid');
        $this->get('/sales')->assertViewHas('total', 0);
        $this->get('/dashboard')->assertViewHas('outstanding', 11050)->assertViewHas('revenue', 0);
    }

    public function test_reservations_block_counter_overselling_and_supply_usage(): void
    {
        $item = $this->item(['stock' => 2]);
        $this->actingAs(User::factory()->create(['role' => 'owner']));
        $this->post('/orders', $this->orderData($item))->assertRedirect();
        $this->post('/sales', ['reference' => (string) Str::uuid(), 'channel' => 'walk-in', 'cash' => '100', 'items' => [['product_id' => $item->id, 'quantity' => 1]]])->assertSessionHasErrors('items');
        $this->post('/inventory/'.$item->id.'/usage', ['quantity' => 1, 'reason' => 'Print job'])->assertSessionHasErrors('quantity');
        $this->post('/orders', $this->orderData($item))->assertSessionHasErrors('items');
        $this->assertSame(2, $item->fresh()->stock);
        $this->assertSame(2, $item->fresh()->reserved);
        $this->assertDatabaseCount('orders', 1);
    }

    public function test_cod_collection_is_idempotent_and_records_fee_change_and_stock_once(): void
    {
        $item = $this->item();
        $this->actingAs(User::factory()->create(['role' => 'cashier']));
        $data = $this->orderData($item);
        $this->post('/orders', $data);
        $this->post('/orders', $data);
        $order = Order::firstOrFail();
        $this->post('/orders/'.$order->id.'/payment', $this->payment())->assertRedirect();
        $this->post('/orders/'.$order->id.'/payment', $this->payment())->assertRedirect();
        $sale = Sale::firstOrFail();
        $this->assertSame(11050, $sale->total_cents);
        $this->assertSame(2000, $sale->delivery_fee_cents);
        $this->assertSame(950, $sale->change_cents);
        $this->assertSame(3, $item->fresh()->stock);
        $this->assertSame(0, $item->fresh()->reserved);
        $this->assertDatabaseCount('orders', 1);
        $this->assertDatabaseCount('sales', 1);
        $this->assertDatabaseCount('stock_movements', 1);
        $this->get('/sales/'.$sale->id.'/receipt')->assertSee('Delivery fee')->assertSee('20.00');
    }

    public function test_prepaid_gcash_requires_verification_exact_total_and_unique_reference(): void
    {
        $item = $this->item();
        $this->actingAs(User::factory()->create(['role' => 'owner']));
        $data = [...$this->orderData($item, ['payment_plan' => 'prepaid']), ...$this->payment(['payment_method' => 'gcash', 'cash' => '110.50', 'payment_reference' => 'TEST-GCASH-001'])];
        $this->post('/orders', $data)->assertSessionHasErrors('payment_reference');
        $this->assertDatabaseCount('orders', 0);
        $this->assertSame(0, $item->fresh()->reserved);
        $this->post('/orders', [...$data, 'cash' => '120.00', 'payment_verified' => 1])->assertSessionHasErrors('payment_reference');
        $this->post('/orders', [...$data, 'payment_verified' => 1])->assertRedirect();
        $sale = Sale::firstOrFail();
        $this->assertSame('gcash', $sale->payment_method);
        $this->assertSame(0, $sale->change_cents);
        $this->post('/orders', [...$data, 'reference' => (string) Str::uuid(), 'payment_reference' => 'test-gcash-001', 'payment_verified' => 1])->assertSessionHasErrors('payment_reference');
        $this->assertDatabaseCount('orders', 1);
        $this->assertDatabaseCount('sales', 1);
        $this->assertSame(3, $item->fresh()->stock);
        $this->assertSame(0, $item->fresh()->reserved);
        $this->get('/sales')->assertViewHas('gcashTotal', 11050)->assertViewHas('cashTotal', 0);
    }

    public function test_counter_gcash_and_duplicate_reference_roll_back_stock(): void
    {
        $item = $this->item();
        $this->actingAs(User::factory()->create());
        $data = ['reference' => (string) Str::uuid(), 'channel' => 'walk-in', 'items' => [['product_id' => $item->id, 'quantity' => 1]], 'cash' => '45.25', 'payment_method' => 'gcash', 'payment_reference' => 'TEST-GCASH-002', 'payment_verified' => 1];
        $this->post('/sales', $data)->assertRedirect();
        $this->post('/sales', $data)->assertRedirect();
        $this->post('/sales', [...$data, 'reference' => (string) Str::uuid()])->assertSessionHasErrors('payment_reference');
        $this->assertDatabaseCount('sales', 1);
        $this->assertSame(4, $item->fresh()->stock);
        $this->get('/sales/'.Sale::firstOrFail()->id.'/receipt')->assertSee('GCash')->assertDontSee('Change');
    }

    public function test_cancel_unpaid_order_releases_stock_once_and_cannot_receive_payment(): void
    {
        $item = $this->item();
        $this->actingAs(User::factory()->create());
        $this->post('/orders', $this->orderData($item));
        $order = Order::firstOrFail();
        $data = ['status' => 'cancelled', 'cancel_reason' => 'Customer changed plans'];
        $this->post('/orders/'.$order->id.'/status', $data)->assertRedirect();
        $this->post('/orders/'.$order->id.'/status', $data)->assertRedirect();
        $this->assertSame(0, $item->fresh()->reserved);
        $this->assertSame(5, $item->fresh()->stock);
        $this->post('/orders/'.$order->id.'/payment', $this->payment())->assertSessionHasErrors('payment');
        $this->assertDatabaseCount('sales', 0);
    }

    public function test_delivery_steps_require_payment_and_return_confirmation_for_dispatched_cancellation(): void
    {
        $item = $this->item();
        $this->actingAs(User::factory()->create());
        $this->post('/orders', $this->orderData($item));
        $order = Order::firstOrFail();
        $path = '/orders/'.$order->id.'/status';
        $this->post($path, ['status' => 'completed'])->assertSessionHasErrors('status');
        $this->post($path, ['status' => 'ready'])->assertRedirect();
        $this->post($path, ['status' => 'out_for_delivery'])->assertRedirect();
        $this->post($path, ['status' => 'completed'])->assertSessionHasErrors('status');
        $this->post($path, ['status' => 'cancelled', 'cancel_reason' => 'Failed delivery'])->assertSessionHasErrors('cancel_reason');
        $this->assertSame(2, $item->fresh()->reserved);
        $this->post($path, ['status' => 'cancelled', 'cancel_reason' => 'Returned undelivered', 'stock_returned' => 1])->assertRedirect();
        $this->assertSame(0, $item->fresh()->reserved);
    }

    public function test_pickup_snapshots_prices_and_paid_orders_cannot_be_cancelled(): void
    {
        $item = $this->item();
        $this->actingAs(User::factory()->create());
        $this->post('/orders', $this->orderData($item, ['fulfillment' => 'pickup', 'delivery_fee' => '999']));
        $order = Order::firstOrFail();
        $this->assertSame(9050, $order->total_cents);
        $item->update(['price_cents' => 9999, 'name' => 'Changed product', 'active' => false]);
        $this->post('/orders/'.$order->id.'/payment', $this->payment())->assertRedirect();
        $this->assertSame(9050, Sale::firstOrFail()->total_cents);
        $this->get('/orders/'.$order->id)->assertSee('Test notebook')->assertDontSee('Changed product');
        $this->post('/orders/'.$order->id.'/status', ['status' => 'cancelled', 'cancel_reason' => 'Refund'])->assertSessionHasErrors('status');
        $this->post('/orders/'.$order->id.'/status', ['status' => 'ready'])->assertRedirect();
        $this->post('/orders/'.$order->id.'/status', ['status' => 'completed'])->assertRedirect();
        $this->assertSame('completed', $order->fresh()->status);
    }

    public function test_order_details_payment_and_status_are_private_to_creator_and_owner(): void
    {
        $item = $this->item();
        $cashier = User::factory()->create(['role' => 'cashier']);
        $this->actingAs($cashier)->post('/orders', $this->orderData($item));
        $order = Order::firstOrFail();
        $this->actingAs(User::factory()->create(['role' => 'cashier']));
        $this->get('/orders/'.$order->id)->assertForbidden();
        $this->post('/orders/'.$order->id.'/payment', $this->payment())->assertForbidden();
        $this->post('/orders/'.$order->id.'/status', ['status' => 'ready'])->assertForbidden();
        $this->get('/orders')->assertDontSee('Demo Customer');
        $owner = User::factory()->create(['role' => 'owner']);
        $this->actingAs($owner)->get('/orders/'.$order->id)->assertOk();
        $this->post('/orders/'.$order->id.'/payment', $this->payment())->assertRedirect();
        $this->assertSame($owner->id, $order->fresh()->paid_by);
        $this->actingAs($cashier)->get('/sales/'.$order->fresh()->sale_id.'/receipt')->assertOk();
    }

    public function test_internal_supplies_usage_filters_and_permissions(): void
    {
        $supply = $this->item(['kind' => 'consumable', 'name' => 'Demo ink stock', 'price_cents' => 0]);
        $other = $this->item(['name' => 'Other category item', 'category' => 'Pens']);
        $owner = User::factory()->create(['role' => 'owner']);
        $this->actingAs($owner)->get('/pos')->assertDontSee('Demo ink stock');
        $this->post('/inventory/'.$supply->id.'/usage', ['quantity' => '3', 'reason' => 'ID printing job'])->assertRedirect();
        $this->assertSame(2, $supply->fresh()->stock);
        $this->assertDatabaseHas('stock_movements', ['user_id' => $owner->id, 'quantity' => -3, 'reason' => 'Supply usage: ID printing job']);
        $this->get('/inventory?category=Paper&status=low')->assertSee('Demo ink stock')->assertDontSee('Other category item');
        $this->post('/sales', ['reference' => (string) Str::uuid(), 'channel' => 'walk-in', 'cash' => '100', 'items' => [['product_id' => $supply->id, 'quantity' => 1]]])->assertSessionHasErrors('items');
        $this->actingAs(User::factory()->create(['role' => 'cashier']))->post('/inventory/'.$other->id.'/usage', ['quantity' => 1, 'reason' => 'Unauthorized'])->assertForbidden();
        $this->assertSame(5, $other->fresh()->stock);
    }

    public function test_invalid_order_details_and_failed_prepaid_sale_roll_back_reservations(): void
    {
        $item = $this->item();
        $this->actingAs(User::factory()->create());
        $this->post('/orders', $this->orderData($item, ['delivery_address' => '', 'delivery_fee' => '-1']))->assertSessionHasErrors(['delivery_address', 'delivery_fee']);
        $this->post('/orders', [...$this->orderData($item, ['payment_plan' => 'prepaid']), ...$this->payment(['cash' => '1.00'])])->assertSessionHasErrors('cash');
        $this->assertDatabaseCount('orders', 0);
        $this->assertDatabaseCount('sales', 0);
        $this->assertSame(0, $item->fresh()->reserved);
    }

    public function test_order_reference_cannot_be_reused_for_counter_checkout(): void
    {
        $item = $this->item();
        $this->actingAs(User::factory()->create());
        $data = $this->orderData($item);
        $this->post('/orders', $data);
        $this->post('/sales', [...$data, 'cash' => '200.00'])->assertSessionHasErrors('reference');
        $this->assertDatabaseCount('sales', 0);
        $this->assertSame(2, $item->fresh()->reserved);
    }
}
