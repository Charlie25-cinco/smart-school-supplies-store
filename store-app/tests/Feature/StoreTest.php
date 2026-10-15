<?php

namespace Tests\Feature;

use App\Models\Product;
use App\Models\Sale;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

class StoreTest extends TestCase
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

    private function payload(array $items, string $cash = '200.00'): array
    {
        return ['reference' => (string) Str::uuid(), 'channel' => 'walk-in', 'cash' => $cash, 'items' => $items];
    }

    public function test_guest_cannot_access_store_records(): void
    {
        foreach (['/pos', '/dashboard', '/inventory', '/sales'] as $path) {
            $this->get($path)->assertRedirect('/login');
        }
        $this->post('/sales', [])->assertRedirect('/login');
    }

    public function test_cashier_cannot_change_inventory_or_view_admin_dashboard(): void
    {
        $product = $this->product();
        $this->actingAs($this->staff());
        foreach (['/dashboard', '/inventory', '/inventory/create', '/inventory/'.$product->id.'/edit'] as $path) {
            $this->get($path)->assertForbidden();
        }
        $this->post('/inventory', [])->assertForbidden();
        $this->post('/inventory/'.$product->id.'/restock', ['quantity' => 10, 'reason' => 'Received'])->assertForbidden();
        $this->put('/inventory/'.$product->id, [])->assertForbidden();
        $this->assertSame(10, $product->fresh()->stock);
    }

    public function test_sale_records_exact_money_and_deducts_product_stock_only(): void
    {
        $product = $this->product();
        $service = $this->product(['kind' => 'service', 'price_cents' => 300, 'stock' => 0, 'name' => 'Printing']);
        $this->actingAs($this->staff())->post('/sales', $this->payload([['product_id' => $product->id, 'quantity' => 2], ['product_id' => $service->id, 'quantity' => 5]], '110.00'))->assertRedirect();
        $sale = Sale::firstOrFail();
        $this->assertSame(10550, $sale->total_cents);
        $this->assertSame(450, $sale->change_cents);
        $this->assertSame(8, $product->fresh()->stock);
        $this->assertSame(0, $service->fresh()->stock);
        $this->assertDatabaseCount('sale_items', 2);
        $this->assertDatabaseHas('stock_movements', ['product_id' => $product->id, 'quantity' => -2]);
        $this->assertDatabaseCount('stock_movements', 1);
    }

    public function test_failed_later_line_rolls_back_earlier_stock_deduction(): void
    {
        $first = $this->product();
        $second = $this->product(['stock' => 1]);
        $this->actingAs($this->staff())->from('/pos')->post('/sales', $this->payload([['product_id' => $first->id, 'quantity' => 2], ['product_id' => $second->id, 'quantity' => 2]]))->assertSessionHasErrors('items');
        $this->assertSame(10, $first->fresh()->stock);
        $this->assertSame(1, $second->fresh()->stock);
        $this->assertDatabaseCount('sales', 0);
        $this->assertDatabaseCount('stock_movements', 0);
    }

    public function test_underpayment_does_not_record_sale_or_change_stock(): void
    {
        $product = $this->product();
        $this->actingAs($this->staff())->post('/sales', $this->payload([['product_id' => $product->id, 'quantity' => 2]], '1.00'))->assertSessionHasErrors('cash');
        $this->assertSame(10, $product->fresh()->stock);
        $this->assertDatabaseCount('sales', 0);
    }

    public function test_repeated_checkout_records_one_sale_and_one_stock_deduction(): void
    {
        $product = $this->product();
        $payload = $this->payload([['product_id' => $product->id, 'quantity' => 2]]);
        $this->actingAs($this->staff());
        $this->post('/sales', $payload)->assertRedirect();
        $this->post('/sales', $payload)->assertRedirect();
        $this->assertDatabaseCount('sales', 1);
        $this->assertSame(8, $product->fresh()->stock);
    }

    public function test_duplicate_product_lines_and_invalid_quantities_are_rejected(): void
    {
        $product = $this->product();
        $this->actingAs($this->staff());
        $this->post('/sales', $this->payload([['product_id' => $product->id, 'quantity' => 1], ['product_id' => $product->id, 'quantity' => 1]]))->assertSessionHasErrors('items.0.product_id');
        foreach ([0, -1, 1.5, 1000] as $quantity) {
            $this->post('/sales', $this->payload([['product_id' => $product->id, 'quantity' => $quantity]]))->assertSessionHasErrors('items.0.quantity');
        }
        $this->assertSame(10, $product->fresh()->stock);
    }

    public function test_server_uses_current_price_and_ignores_client_total(): void
    {
        $product = $this->product(['price_cents' => 1234]);
        $this->actingAs($this->staff())->post('/sales', [...$this->payload([['product_id' => $product->id, 'quantity' => 1, 'price_cents' => 1]]), 'total_cents' => 1])->assertRedirect();
        $this->assertSame(1234, Sale::firstOrFail()->total_cents);
    }

    public function test_inactive_and_unknown_items_cannot_be_sold(): void
    {
        $product = $this->product(['active' => false]);
        $this->actingAs($this->staff());
        foreach ([$product->id, 99999] as $id) {
            $this->post('/sales', $this->payload([['product_id' => $id, 'quantity' => 1]]))->assertSessionHasErrors('items');
        }
        $this->assertDatabaseCount('sales', 0);
    }

    public function test_admin_can_restock_and_cashier_receipt_access_is_restricted(): void
    {
        $product = $this->product();
        $admin = $this->staff('admin');
        $cashier = $this->staff();
        $other = $this->staff();
        $this->actingAs($admin)->post('/inventory/'.$product->id.'/restock', ['quantity' => 7, 'reason' => 'New delivery'])->assertRedirect('/inventory');
        $this->assertSame(17, $product->fresh()->stock);
        $this->assertDatabaseHas('stock_movements', ['quantity' => 7, 'reason' => 'New delivery', 'user_id' => $admin->id]);
        $this->actingAs($cashier)->post('/sales', $this->payload([['product_id' => $product->id, 'quantity' => 1]]));
        $sale = Sale::firstOrFail();
        $this->get('/sales/'.$sale->id.'/receipt')->assertOk()->assertSee($sale->receiptNumber());
        $this->actingAs($other)->get('/sales/'.$sale->id.'/receipt')->assertForbidden();
        $this->get('/sales')->assertDontSee($sale->receiptNumber());
        $this->actingAs($admin)->get('/sales/'.$sale->id.'/receipt')->assertOk();
    }

    public function test_historical_receipt_keeps_original_name_and_price(): void
    {
        $product = $this->product();
        $this->actingAs($this->staff())->post('/sales', $this->payload([['product_id' => $product->id, 'quantity' => 1]]));
        $product->update(['name' => 'Renamed item', 'price_cents' => 9999]);
        $sale = Sale::firstOrFail();
        $this->get('/sales/'.$sale->id.'/receipt')->assertSee('Notebook')->assertSee('45.25')->assertDontSee('Renamed item');
    }

    public function test_product_creation_validation_and_kind_are_preserved(): void
    {
        $this->actingAs($this->staff('admin'));
        $data = ['sku' => 'TEST-01', 'name' => 'Test supply', 'category' => 'Paper', 'kind' => 'product', 'price' => '15.50', 'stock' => 4, 'reorder_level' => 2, 'active' => 1];
        $this->post('/inventory', $data)->assertRedirect('/inventory');
        $product = Product::firstOrFail();
        $this->assertSame(1550, $product->price_cents);
        $this->assertDatabaseHas('stock_movements', ['quantity' => 4]);
        $this->post('/inventory', $data)->assertSessionHasErrors('sku');
        $this->put('/inventory/'.$product->id, [...$data, 'kind' => 'service'])->assertRedirect();
        $this->assertSame('product', $product->fresh()->kind);
        $this->assertSame(4, $product->fresh()->stock);
        $this->post('/inventory', [...$data, 'sku' => 'OTHER', 'price' => '0.00'])->assertSessionHasErrors('price');
    }

    public function test_dashboard_and_report_include_only_selected_sales(): void
    {
        $this->travelTo(now()->setDate(2026, 10, 10)->setTime(12, 0));
        $admin = $this->staff('admin');
        $product = $this->product(['name' => 'Low stock item', 'stock' => 2, 'price_cents' => 1200]);
        $this->actingAs($this->staff())->post('/sales', $this->payload([['product_id' => $product->id, 'quantity' => 1]], '20.00'));
        $this->actingAs($admin)->get('/dashboard')->assertOk()->assertSee('12.00')->assertSee('Low stock item');
        // Receipt numbers follow the database sequence, which MySQL does not
        // rewind on rollback — assert the actual sale's number, not a fixed one.
        $receipt = Sale::firstOrFail()->receiptNumber();
        $this->get('/sales?from=2026-10-10&to=2026-10-10')->assertOk()->assertSee('12.00')->assertSee($receipt);
        $this->get('/sales?from=2026-10-09&to=2026-10-09')->assertOk()->assertDontSee($receipt);
        $this->get('/sales?from=2026-10-11&to=2026-10-10')->assertSessionHasErrors('to');
    }

    public function test_login_logout_and_account_creation_use_hashed_passwords(): void
    {
        $password = Str::random(24);
        $user = $this->staff('admin');
        $user->update(['password' => $password]);
        $this->post('/login', ['login' => $user->username, 'password' => 'invalid'])->assertSessionHasErrors('login');
        $this->post('/login', ['login' => $user->username, 'password' => $password])->assertRedirect('/dashboard');
        $this->assertAuthenticatedAs($user);
        $this->post('/logout')->assertRedirect('/login');
        $this->assertGuest();
        $staffPassword = Str::random(24);
        $this->artisan('store:staff --role=cashier')->expectsQuestion('Staff name', 'Cashier')->expectsQuestion('Username (letters, numbers, hyphens, 3-40 characters)', 'cashier')->expectsQuestion('Password (at least 12 characters)', $staffPassword)->assertSuccessful();
        $staff = User::where('username', 'cashier')->firstOrFail();
        $this->assertSame('cashier', $staff->role);
        $this->assertNotSame($staffPassword, $staff->password);
    }

    public function test_seeding_twice_does_not_reset_inventory(): void
    {
        $this->seed();
        $product = Product::where('sku', 'NB-001')->firstOrFail();
        $product->update(['stock' => 1, 'price_cents' => 7000]);
        $this->seed();
        $this->assertSame(1, $product->fresh()->stock);
        $this->assertSame(7000, $product->fresh()->price_cents);
        $this->assertDatabaseCount('products', 17);
        $this->assertDatabaseCount('users', 0);
    }

    public function test_new_order_entry_selects_pickup_and_preserves_failed_delivery_input(): void
    {
        $this->actingAs($this->staff());
        $this->get('/pos?fulfillment=pickup')->assertOk()->assertViewHas('fulfillment', 'pickup');
        $this->get('/pos?fulfillment=delivery')->assertOk()->assertViewHas('fulfillment', 'delivery');
        $this->get('/pos?fulfillment=unexpected')->assertOk()->assertViewHas('fulfillment', 'counter');
        $this->get('/orders')->assertSee(route('pos', ['fulfillment' => 'pickup']));
    }

    public function test_invalid_stock_movement_restores_server_derived_dialog_without_mutation(): void
    {
        $item = $this->product(['kind' => 'consumable', 'price_cents' => 0]);
        $this->actingAs($this->staff('admin'));
        $this->from('/inventory')->post('/inventory/'.$item->id.'/usage', ['quantity' => '11', 'reason' => 'Printing', 'movement_dialog' => 'restock-999'])
            ->assertRedirect('/inventory')->assertSessionHasErrors('quantity')
            ->assertSessionHasInput('movement_dialog', 'usage-'.$item->id)
            ->assertSessionHasInput('quantity', '11')->assertSessionHasInput('reason', 'Printing');
        $this->assertSame(10, $item->fresh()->stock);
        $this->assertDatabaseCount('stock_movements', 0);
        $this->from('/inventory')->post('/inventory/'.$item->id.'/restock', ['quantity' => '0', 'reason' => 'Delivery'])
            ->assertSessionHasErrors('quantity')->assertSessionHasInput('movement_dialog', 'restock-'.$item->id);
        $this->assertSame(10, $item->fresh()->stock);
    }

    public function test_supply_usage_is_limited_to_internal_consumables_in_forms_and_routes(): void
    {
        $product = $this->product();
        $service = $this->product(['sku' => 'DEMO-SERVICE', 'kind' => 'service', 'stock' => 0]);
        $supply = $this->product(['sku' => 'DEMO-SUPPLY', 'kind' => 'consumable', 'price_cents' => 0]);
        $this->actingAs($this->staff('admin'));
        $this->get('/inventory')->assertOk()
            ->assertDontSee('data-modal-open="usage-'.$product->id.'"', false)
            ->assertDontSee('id="usage-'.$product->id.'"', false)
            ->assertDontSee('data-modal-open="usage-'.$service->id.'"', false)
            ->assertSee('data-modal-open="usage-'.$supply->id.'"', false);
        foreach ([$product, $service] as $item) {
            $this->post('/inventory/'.$item->id.'/usage', ['quantity' => 1, 'reason' => 'Fictional forged usage'])->assertStatus(422);
        }
        $this->assertSame(10, $product->fresh()->stock);
        $this->assertDatabaseCount('stock_movements', 0);
        $this->post('/inventory/'.$supply->id.'/usage', ['quantity' => 1, 'reason' => 'Fictional paper usage'])->assertRedirect('/inventory');
        $this->assertSame(9, $supply->fresh()->stock);
        $this->assertDatabaseCount('stock_movements', 1);
    }

    public function test_unchecked_active_value_survives_validation_and_deactivates_item(): void
    {
        $item = $this->product();
        $this->actingAs($this->staff('admin'));
        $data = ['sku' => $item->sku, 'name' => $item->name, 'category' => $item->category, 'kind' => $item->kind, 'price' => '0', 'reorder_level' => '3', 'active' => '0'];
        $this->from('/inventory/'.$item->id.'/edit')->put('/inventory/'.$item->id, $data)
            ->assertSessionHasErrors('price')->assertSessionHasInput('active', '0');
        $this->assertTrue($item->fresh()->active);
        $this->put('/inventory/'.$item->id, [...$data, 'price' => '45.25'])->assertRedirect('/inventory');
        $this->assertFalse($item->fresh()->active);
        $this->actingAs($this->staff())->get('/pos')->assertDontSee($item->name);
    }
}
