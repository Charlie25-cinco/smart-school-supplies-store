<?php

namespace Tests\Feature;

use App\Models\Order;
use App\Models\Product;
use App\Models\Sale;
use App\Models\User;
use App\Services\Orders;
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

    private function editData(Order $order, array $overrides = []): array
    {
        $order = $order->fresh('items');

        return [...[
            'edit_token' => app(Orders::class)->editToken($order),
            ...$order->only(['customer_name', 'customer_phone', 'delivery_address', 'notes']),
            ...($order->sale_id ? [] : [
                'items' => $order->items->map->only(['product_id', 'quantity'])->all(),
                ...($order->fulfillment === 'delivery' ? ['delivery_fee' => number_format($order->delivery_fee_cents / 100, 2, '.', '')] : []),
            ]),
        ], ...$overrides];
    }

    public function test_edit_adjusts_unpaid_reservations_and_preserves_retained_prices(): void
    {
        $item = $this->item();
        $pen = $this->item(['name' => 'Demo pen', 'price_cents' => 1200, 'stock' => 4]);
        $service = $this->item(['name' => 'Demo printing', 'kind' => 'service', 'price_cents' => 300, 'stock' => 0]);
        $this->actingAs(User::factory()->create(['role' => 'cashier']))->post('/orders', $this->orderData($item));
        $order = Order::firstOrFail();
        $item->update(['name' => 'Renamed item', 'price_cents' => 9999]);
        $this->put('/orders/'.$order->id, $this->editData($order, [
            'customer_name' => 'Updated Demo Customer', 'delivery_address' => 'Updated demo school gate', 'delivery_fee' => '25.00',
            'items' => [['product_id' => $item->id, 'quantity' => 3, 'price_cents' => 1], ['product_id' => $pen->id, 'quantity' => 1], ['product_id' => $service->id, 'quantity' => 2]],
        ]))->assertRedirect('/orders/'.$order->id);
        $order = $order->fresh('items');
        $this->assertSame(17875, $order->total_cents);
        $this->assertSame(3, $item->fresh()->reserved);
        $this->assertSame(1, $pen->fresh()->reserved);
        $this->assertSame(0, $service->fresh()->reserved);
        $this->assertSame(5, $item->fresh()->stock);
        $retained = $order->items->firstWhere('product_id', $item->id);
        $this->assertSame(4525, $retained->price_cents);
        $this->assertSame('Test notebook', $retained->name);
        $this->assertSame('Updated Demo Customer', $order->customer_name);
        $this->assertDatabaseCount('sales', 0);
        $this->actingAs(User::factory()->create(['role' => 'admin']))->get('/dashboard')->assertViewHas('outstanding', 17875);
    }

    public function test_edit_releases_only_its_own_reservations_and_payment_uses_edited_items(): void
    {
        $item = $this->item();
        $pen = $this->item(['price_cents' => 1200, 'stock' => 4]);
        $this->actingAs(User::factory()->create(['role' => 'cashier']))->post('/orders', $this->orderData($item));
        $order = Order::firstOrFail();
        $this->post('/orders', $this->orderData($item, ['items' => [['product_id' => $item->id, 'quantity' => 1]]]));
        $this->put('/orders/'.$order->id, $this->editData($order, ['items' => [['product_id' => $item->id, 'quantity' => 1], ['product_id' => $pen->id, 'quantity' => 1]]]))->assertRedirect();
        $this->assertSame(2, $item->fresh()->reserved);
        $this->put('/orders/'.$order->id, $this->editData($order, ['items' => [['product_id' => $pen->id, 'quantity' => 1]]]))->assertRedirect();
        $this->assertSame(1, $item->fresh()->reserved);
        $this->post('/orders/'.$order->id.'/payment', $this->payment())->assertRedirect();
        $sale = Sale::firstOrFail();
        $this->assertSame(3200, $sale->total_cents);
        $this->assertSame(1, $sale->items->count());
        $this->assertSame($pen->id, $sale->items->first()->product_id);
        $this->assertSame(5, $item->fresh()->stock);
        $this->assertSame(3, $pen->fresh()->stock);
        $this->assertSame(0, $pen->fresh()->reserved);
    }

    public function test_edit_stock_failure_rolls_back_all_lines_and_details(): void
    {
        $item = $this->item();
        $limited = $this->item(['stock' => 1]);
        $this->actingAs(User::factory()->create(['role' => 'cashier']))->post('/orders', $this->orderData($item));
        $order = Order::firstOrFail();
        $this->put('/orders/'.$order->id, $this->editData($order, ['customer_name' => 'Rejected change', 'delivery_fee' => '30.00', 'items' => [['product_id' => $item->id, 'quantity' => 3], ['product_id' => $limited->id, 'quantity' => 2]]]))->assertSessionHasErrors('items');
        $this->assertSame(2, $item->fresh()->reserved);
        $this->assertSame(0, $limited->fresh()->reserved);
        $this->assertSame('Demo Customer', $order->fresh()->customer_name);
        $this->assertSame(11050, $order->fresh()->total_cents);
        $this->assertDatabaseCount('order_items', 1);
        $this->get('/orders/'.$order->id.'/edit')->assertOk()->assertSee('Rejected change');
    }

    public function test_edit_rejects_stale_forms_and_keeps_other_staff_records_private(): void
    {
        $item = $this->item();
        $cashier = User::factory()->create(['role' => 'cashier']);
        $this->actingAs($cashier)->post('/orders', $this->orderData($item));
        $order = Order::firstOrFail();
        $old = $this->editData($order);
        $this->put('/orders/'.$order->id, [...$old, 'customer_name' => 'Latest Details'])->assertRedirect();
        $this->put('/orders/'.$order->id, [...$old, 'customer_name' => 'Stale details'])->assertSessionHasErrors('edit_token');
        $this->assertSame('Latest Details', $order->fresh()->customer_name);
        $this->assertSame(2, $item->fresh()->reserved);
        $this->actingAs(User::factory()->create(['role' => 'cashier']));
        $this->get('/orders/'.$order->id.'/edit')->assertForbidden();
        $this->put('/orders/'.$order->id, $this->editData($order))->assertForbidden();
        $this->actingAs(User::factory()->create(['role' => 'admin']))->get('/orders/'.$order->id.'/edit')->assertForbidden();
        $this->put('/orders/'.$order->id, $this->editData($order))->assertForbidden();
        $this->get('/orders/'.$order->id)->assertOk()->assertSee('Latest Details');
    }

    public function test_paid_order_allows_customer_correction_but_freezes_items_fee_and_receipt(): void
    {
        $item = $this->item();
        $this->actingAs(User::factory()->create(['role' => 'cashier']))->post('/orders', [...$this->orderData($item, ['payment_plan' => 'prepaid']), ...$this->payment()]);
        $order = Order::firstOrFail();
        $sale = Sale::firstOrFail();
        $saleBefore = $sale->getAttributes();
        $this->put('/orders/'.$order->id, $this->editData($order, ['customer_name' => 'Corrected Customer', 'delivery_address' => 'Corrected school gate', 'notes' => 'Demo correction']))->assertRedirect();
        $this->assertSame('Corrected Customer', $order->fresh()->customer_name);
        $this->assertSame($saleBefore, $sale->fresh()->getAttributes());
        $this->put('/orders/'.$order->id, $this->editData($order, ['delivery_fee' => '0', 'items' => [['product_id' => $item->id, 'quantity' => 1]]]))->assertSessionHasErrors(['delivery_fee', 'items']);
        $this->assertSame(11050, $order->fresh()->total_cents);
        $this->assertSame(3, $item->fresh()->stock);
        $this->assertSame(0, $item->fresh()->reserved);
        $this->get('/orders/'.$order->id.'/edit')->assertOk()->assertDontSee('name="delivery_fee"', false)->assertDontSee('id="add-order-item"', false);
    }

    public function test_dispatched_completed_and_cancelled_orders_cannot_be_edited(): void
    {
        $item = $this->item();
        $this->actingAs(User::factory()->create(['role' => 'cashier']))->post('/orders', [...$this->orderData($item, ['payment_plan' => 'prepaid']), ...$this->payment()]);
        $order = Order::firstOrFail();
        $this->post('/orders/'.$order->id.'/status', ['status' => 'ready']);
        $this->get('/orders/'.$order->id.'/edit')->assertOk();
        $this->post('/orders/'.$order->id.'/status', ['status' => 'out_for_delivery']);
        $this->get('/orders/'.$order->id.'/edit')->assertStatus(409);
        $this->put('/orders/'.$order->id, $this->editData($order))->assertSessionHasErrors('order');
        $this->post('/orders/'.$order->id.'/status', ['status' => 'completed']);
        $this->get('/orders/'.$order->id.'/edit')->assertStatus(409);
        $this->put('/orders/'.$order->id, $this->editData($order))->assertSessionHasErrors('order');
        $this->post('/orders', $this->orderData($item, ['items' => [['product_id' => $item->id, 'quantity' => 1]]]));
        $cancelled = Order::latest('id')->firstOrFail();
        $this->post('/orders/'.$cancelled->id.'/status', ['status' => 'cancelled', 'cancel_reason' => 'Demo cancellation']);
        $this->get('/orders/'.$cancelled->id.'/edit')->assertStatus(409);
        $this->put('/orders/'.$cancelled->id, $this->editData($cancelled))->assertSessionHasErrors('order');
    }

    public function test_edit_rejects_invalid_lines_and_allows_only_reductions_of_inactive_items(): void
    {
        $item = $this->item();
        $supply = $this->item(['kind' => 'consumable', 'price_cents' => 0]);
        $this->actingAs(User::factory()->create(['role' => 'cashier']))->post('/orders', $this->orderData($item));
        $order = Order::firstOrFail();
        $this->put('/orders/'.$order->id, $this->editData($order, ['items' => []]))->assertSessionHasErrors('items');
        $this->put('/orders/'.$order->id, $this->editData($order, ['items' => [['product_id' => $item->id, 'quantity' => 1], ['product_id' => $item->id, 'quantity' => 1]]]))->assertSessionHasErrors('items.0.product_id');
        $this->put('/orders/'.$order->id, $this->editData($order, ['items' => [['product_id' => $supply->id, 'quantity' => 1]]]))->assertSessionHasErrors('items');
        $item->update(['active' => false]);
        $this->put('/orders/'.$order->id, $this->editData($order, ['items' => [['product_id' => $item->id, 'quantity' => 3]]]))->assertSessionHasErrors('items');
        $this->put('/orders/'.$order->id, $this->editData($order, ['items' => [['product_id' => $item->id, 'quantity' => 1]]]))->assertRedirect();
        $this->assertSame(1, $item->fresh()->reserved);
        $this->assertSame(0, $supply->fresh()->reserved);
    }

    public function test_pickup_edit_has_no_delivery_fee_and_status_changes_invalidate_open_forms(): void
    {
        $item = $this->item();
        $this->actingAs(User::factory()->create(['role' => 'cashier']))->post('/orders', $this->orderData($item, ['fulfillment' => 'pickup']));
        $order = Order::firstOrFail();
        $old = $this->editData($order);
        $this->post('/orders/'.$order->id.'/status', ['status' => 'ready']);
        $this->put('/orders/'.$order->id, $old)->assertSessionHasErrors('edit_token');
        $this->put('/orders/'.$order->id, $this->editData($order, ['delivery_fee' => '20']))->assertSessionHasErrors('delivery_fee');
        $this->put('/orders/'.$order->id, $this->editData($order, ['notes' => 'Updated pickup notes']))->assertRedirect();
        $this->assertSame(9050, $order->fresh()->total_cents);
        $this->assertSame(0, $order->fresh()->delivery_fee_cents);
        $this->assertNull($order->fresh()->delivery_address);
    }

    public function test_unpaid_order_reserves_stock_and_is_excluded_from_paid_reports(): void
    {
        $item = $this->item();
        $this->actingAs(User::factory()->create(['role' => 'cashier']))->post('/orders', $this->orderData($item))->assertRedirect();
        $order = Order::firstOrFail();
        $this->assertSame(11050, $order->total_cents);
        $this->assertSame(5, $item->fresh()->stock);
        $this->assertSame(2, $item->fresh()->reserved);
        $this->assertDatabaseCount('sales', 0);
        $this->get('/orders')->assertSee('110.50')->assertSee('Unpaid');
        $this->get('/sales')->assertViewHas('total', 0);
        $this->actingAs(User::factory()->create(['role' => 'admin']))->get('/dashboard')->assertViewHas('outstanding', 11050)->assertViewHas('revenue', 0);
    }

    public function test_reservations_block_counter_overselling_and_supply_usage(): void
    {
        $item = $this->item(['stock' => 2]);
        $cashier = User::factory()->create(['role' => 'cashier']);
        $this->actingAs($cashier);
        $this->post('/orders', $this->orderData($item))->assertRedirect();
        $this->post('/sales', ['reference' => (string) Str::uuid(), 'channel' => 'walk-in', 'cash' => '100', 'items' => [['product_id' => $item->id, 'quantity' => 1]]])->assertSessionHasErrors('items');
        $this->actingAs(User::factory()->create(['role' => 'admin']))->post('/inventory/'.$item->id.'/usage', ['quantity' => 1, 'reason' => 'Print job'])->assertStatus(422);
        $this->actingAs($cashier);
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
        $this->actingAs(User::factory()->create(['role' => 'cashier']));
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
        $this->actingAs(User::factory()->create(['role' => 'cashier']));
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
        $this->actingAs(User::factory()->create(['role' => 'cashier']));
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
        $this->actingAs(User::factory()->create(['role' => 'cashier']));
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
        $this->actingAs(User::factory()->create(['role' => 'cashier']));
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

    public function test_order_details_are_reviewable_by_admin_but_payment_and_status_belong_to_creator(): void
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
        $admin = User::factory()->create(['role' => 'admin']);
        $this->actingAs($admin)->get('/orders/'.$order->id)->assertOk();
        $this->post('/orders/'.$order->id.'/payment', $this->payment())->assertForbidden();
        $this->post('/orders/'.$order->id.'/status', ['status' => 'ready'])->assertForbidden();
        $this->actingAs($cashier)->post('/orders/'.$order->id.'/payment', $this->payment())->assertRedirect();
        $this->assertSame($cashier->id, $order->fresh()->paid_by);
        $this->actingAs($cashier)->get('/sales/'.$order->fresh()->sale_id.'/receipt')->assertOk();
    }

    public function test_internal_supplies_usage_filters_and_permissions(): void
    {
        $supply = $this->item(['kind' => 'consumable', 'name' => 'Demo ink stock', 'price_cents' => 0]);
        $other = $this->item(['name' => 'Other category item', 'category' => 'Pens']);
        $cashier = User::factory()->create(['role' => 'cashier']);
        $this->actingAs($cashier)->get('/pos')->assertDontSee('Demo ink stock');
        $admin = User::factory()->create(['role' => 'admin']);
        $this->actingAs($admin);
        $this->post('/inventory/'.$supply->id.'/usage', ['quantity' => '3', 'reason' => 'ID printing job'])->assertRedirect();
        $this->assertSame(2, $supply->fresh()->stock);
        $this->assertDatabaseHas('stock_movements', ['user_id' => $admin->id, 'quantity' => -3, 'reason' => 'Supply usage: ID printing job']);
        $this->get('/inventory?category=Paper&status=low')->assertSee('Demo ink stock')->assertDontSee('Other category item');
        $this->actingAs($cashier)->post('/sales', ['reference' => (string) Str::uuid(), 'channel' => 'walk-in', 'cash' => '100', 'items' => [['product_id' => $supply->id, 'quantity' => 1]]])->assertSessionHasErrors('items');
        $this->actingAs(User::factory()->create(['role' => 'cashier']))->post('/inventory/'.$other->id.'/usage', ['quantity' => 1, 'reason' => 'Unauthorized'])->assertForbidden();
        $this->assertSame(5, $other->fresh()->stock);
    }

    public function test_invalid_order_details_and_failed_prepaid_sale_roll_back_reservations(): void
    {
        $item = $this->item();
        $this->actingAs(User::factory()->create(['role' => 'cashier']));
        $this->post('/orders', $this->orderData($item, ['delivery_address' => '', 'delivery_fee' => '-1']))->assertSessionHasErrors(['delivery_address', 'delivery_fee']);
        $this->post('/orders', [...$this->orderData($item, ['payment_plan' => 'prepaid']), ...$this->payment(['cash' => '1.00'])])->assertSessionHasErrors('cash');
        $this->assertDatabaseCount('orders', 0);
        $this->assertDatabaseCount('sales', 0);
        $this->assertSame(0, $item->fresh()->reserved);
    }

    public function test_order_reference_cannot_be_reused_for_counter_checkout(): void
    {
        $item = $this->item();
        $this->actingAs(User::factory()->create(['role' => 'cashier']));
        $data = $this->orderData($item);
        $this->post('/orders', $data);
        $this->post('/sales', [...$data, 'cash' => '200.00'])->assertSessionHasErrors('reference');
        $this->assertDatabaseCount('sales', 0);
        $this->assertSame(2, $item->fresh()->reserved);
    }
}
