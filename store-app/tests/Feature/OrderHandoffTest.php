<?php

namespace Tests\Feature;

use App\Models\Order;
use App\Models\Product;
use App\Models\Sale;
use App\Models\User;
use App\Services\Orders;
use Carbon\CarbonInterface;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Arr;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use Symfony\Component\HttpKernel\Exception\HttpException;
use Tests\TestCase;

class OrderHandoffTest extends TestCase
{
    use RefreshDatabase;

    private function staff(string $role = 'cashier', bool $active = true): User
    {
        return User::factory()->create(['role' => $role, 'active' => $active]);
    }

    /** Historical orders predate the current Cashier-only creation rule. */
    private function historicalOrder(User $creator, array $overrides = []): Order
    {
        $product = Product::create(['sku' => 'HANDOFF-'.Str::random(8), 'name' => 'Agreed notebook', 'category' => 'Paper', 'kind' => 'product', 'price_cents' => 4525, 'stock' => 10, 'reserved' => 2, 'reorder_level' => 2, 'active' => true]);
        $order = Order::create([...[
            'reference' => (string) Str::uuid(), 'user_id' => $creator->id, 'channel' => 'messenger', 'fulfillment' => 'delivery', 'payment_plan' => 'cod', 'status' => 'preparing',
            'customer_name' => 'Demo Customer '.Str::random(6), 'customer_phone' => '09000000000', 'delivery_address' => 'Fictional school gate', 'notes' => 'Original agreed details',
            'subtotal_cents' => 9050, 'delivery_fee_cents' => 2000, 'total_cents' => 11050,
        ], ...$overrides]);
        $order->items()->create(['product_id' => $product->id, 'name' => 'Agreed notebook', 'sku' => $product->sku, 'kind' => 'product', 'quantity' => 2, 'price_cents' => 4525, 'total_cents' => 9050]);

        return $order->fresh('items');
    }

    private function handoff(Order $order, User $cashier): array
    {
        return ['assigned_cashier_id' => $cashier->id, 'handoff_token' => app(Orders::class)->editToken($order->fresh('items'))];
    }

    private function immutableDetails(Order $order): array
    {
        return Arr::only($order->getAttributes(), ['id', 'reference', 'user_id', 'sale_id', 'paid_by', 'channel', 'fulfillment', 'payment_plan', 'status', 'customer_name', 'customer_phone', 'delivery_address', 'notes', 'cancel_reason', 'subtotal_cents', 'delivery_fee_cents', 'total_cents', 'created_at']);
    }

    private function product(Order $order): Product
    {
        return Product::findOrFail($order->items->first()->product_id);
    }

    private function editData(Order $order): array
    {
        $order = $order->fresh('items');

        return [
            'edit_token' => app(Orders::class)->editToken($order),
            ...$order->only(['customer_name', 'customer_phone', 'delivery_address', 'notes']),
            ...($order->sale_id ? [] : ['items' => $order->items->map->only(['product_id', 'quantity'])->all(), 'delivery_fee' => '20.00']),
        ];
    }

    private function makeHistoricalPaid(Order $order): Sale
    {
        $sale = Sale::create(['reference' => $order->reference, 'user_id' => $order->user_id, 'channel' => $order->channel, 'total_cents' => $order->total_cents, 'cash_cents' => 12000, 'change_cents' => 950, 'delivery_fee_cents' => 2000]);
        $sale->items()->createMany($order->items->map->only(['product_id', 'name', 'sku', 'kind', 'quantity', 'price_cents', 'total_cents'])->all());
        $order->update(['sale_id' => $sale->id, 'paid_by' => $order->user_id]);
        $this->product($order)->update(['stock' => 8, 'reserved' => 0]);

        return $sale->fresh('items');
    }

    public function test_handoff_in_each_unfinished_state_preserves_original_order_and_inventory(): void
    {
        $creator = $this->staff('admin');
        $admin = $this->staff('admin');
        $cashier = $this->staff();
        $this->actingAs($admin);
        foreach (['preparing', 'ready', 'out_for_delivery'] as $status) {
            $order = $this->historicalOrder($creator, ['status' => $status]);
            $details = $this->immutableDetails($order);
            $items = $order->items->map->getAttributes()->all();
            $stock = $this->product($order)->getAttributes();
            $this->assertTrue($order->canBeHandedOff());
            $this->put('/orders/'.$order->id.'/handoff', $this->handoff($order, $cashier))->assertRedirect('/orders/'.$order->id)->assertSessionHas('success');
            $fresh = $order->fresh('items');
            $this->assertSame($details, $this->immutableDetails($fresh));
            $this->assertSame($items, $fresh->items->map->getAttributes()->all());
            $this->assertSame($stock, $this->product($fresh)->getAttributes());
            $this->assertSame($cashier->id, $fresh->assigned_cashier_id);
            $this->assertSame($admin->id, $fresh->assigned_by);
            $this->assertInstanceOf(CarbonInterface::class, $fresh->assigned_at);
            $this->assertTrue($fresh->assignedCashier->is($cashier));
            $this->assertTrue($fresh->assignedBy->is($admin));
            $assignment = $fresh->getAttributes();
            $this->put('/orders/'.$order->id.'/handoff', $this->handoff($order, $cashier))->assertRedirect();
            $this->assertSame($assignment, $order->fresh()->getAttributes());
        }
        $this->assertDatabaseCount('sales', 0);
        $this->assertDatabaseCount('stock_movements', 0);
    }

    public function test_invalid_or_disabled_handoff_targets_are_rejected_without_reservation_changes(): void
    {
        $admin = $this->staff('admin');
        $order = $this->historicalOrder($admin);
        $disabled = $this->staff('cashier', false);
        $otherAdmin = $this->staff('admin');
        $this->actingAs($admin);
        foreach ([$disabled->id, $otherAdmin->id, 999999, 'invalid'] as $target) {
            $this->put('/orders/'.$order->id.'/handoff', ['assigned_cashier_id' => $target, 'handoff_token' => app(Orders::class)->editToken($order->fresh('items'))])
                ->assertSessionHasErrors('assigned_cashier_id');
        }
        $this->assertNull($order->fresh()->assigned_cashier_id);
        $this->assertNull($order->fresh()->assigned_by);
        $this->assertSame(2, $this->product($order)->reserved);
        $this->assertDatabaseCount('sales', 0);
    }

    public function test_cashier_origin_and_closed_admin_orders_cannot_be_handed_off(): void
    {
        $admin = $this->staff('admin');
        $cashier = $this->staff();
        $orders = [
            $this->historicalOrder($cashier),
            $this->historicalOrder($admin, ['status' => 'completed']),
            $this->historicalOrder($admin, ['status' => 'cancelled']),
        ];
        $this->actingAs($admin);
        foreach ($orders as $order) {
            $details = $this->immutableDetails($order);
            $this->assertFalse($order->canBeHandedOff());
            $this->put('/orders/'.$order->id.'/handoff', $this->handoff($order, $cashier))->assertSessionHasErrors();
            $this->assertNull($order->fresh()->assigned_cashier_id);
            $this->assertSame($details, $this->immutableDetails($order->fresh()));
        }
    }

    public function test_handoff_requires_active_admin_in_routes_and_direct_service_calls(): void
    {
        $admin = $this->staff('admin');
        $cashier = $this->staff();
        $order = $this->historicalOrder($admin);
        $path = '/orders/'.$order->id.'/handoff';
        $data = $this->handoff($order, $cashier);
        $this->put($path, $data)->assertRedirect('/login');
        $this->actingAs($cashier)->put($path, $data)->assertForbidden();
        foreach ([$cashier, $this->staff('admin', false)] as $actor) {
            try {
                app(Orders::class)->handoff($actor, $order, $data);
                $this->fail('A restricted account handed off an order.');
            } catch (HttpException $exception) {
                $this->assertSame(403, $exception->getStatusCode());
            }
        }
        $this->assertNull($order->fresh()->assigned_cashier_id);
    }

    public function test_stale_handoff_and_edit_forms_cannot_overwrite_a_reassignment(): void
    {
        $admin = $this->staff('admin');
        $first = $this->staff();
        $second = $this->staff();
        $order = $this->historicalOrder($admin);
        $initial = $this->handoff($order, $first);
        $this->actingAs($admin)->put('/orders/'.$order->id.'/handoff', $initial)->assertRedirect();
        $oldEdit = $this->editData($order);
        $this->put('/orders/'.$order->id.'/handoff', [...$initial, 'assigned_cashier_id' => $second->id])->assertSessionHasErrors('handoff_token');
        $this->assertSame($first->id, $order->fresh()->assigned_cashier_id);
        $this->put('/orders/'.$order->id.'/handoff', $this->handoff($order, $second))->assertRedirect();
        $this->actingAs($second)->put('/orders/'.$order->id, [...$oldEdit, 'notes' => 'Rejected stale edit'])->assertSessionHasErrors('edit_token');
        $this->assertSame('Original agreed details', $order->fresh()->notes);
        $this->assertSame($second->id, $order->fresh()->assigned_cashier_id);
        $this->assertSame(2, $this->product($order)->reserved);
    }

    public function test_assigned_cashier_sees_own_and_assigned_orders_while_reassignment_revokes_prior_access(): void
    {
        $admin = $this->staff('admin');
        $first = $this->staff();
        $second = $this->staff();
        $legacy = $this->historicalOrder($admin);
        $unassigned = $this->historicalOrder($admin);
        $own = $this->historicalOrder($first);
        $other = $this->historicalOrder($second);
        $this->actingAs($admin)->put('/orders/'.$legacy->id.'/handoff', $this->handoff($legacy, $first))->assertRedirect();
        $this->actingAs($first)->get('/orders')->assertOk()->assertSee($legacy->number())->assertSee($own->number())->assertDontSee($unassigned->number())->assertDontSee($other->number());
        $this->get('/orders/'.$legacy->id)->assertOk();
        $this->get('/orders/'.$legacy->id.'/edit')->assertOk();
        $this->put('/orders/'.$legacy->id, [...$this->editData($legacy), 'notes' => 'Assigned cashier correction'])->assertRedirect();
        $this->post('/orders/'.$legacy->id.'/status', ['status' => 'ready'])->assertRedirect();
        $this->assertSame($admin->id, $legacy->fresh()->user_id);
        $this->actingAs($admin)->put('/orders/'.$legacy->id.'/handoff', $this->handoff($legacy, $second))->assertRedirect();
        $this->actingAs($first)->get('/orders/'.$legacy->id)->assertForbidden();
        $this->get('/orders/'.$legacy->id.'/edit')->assertForbidden();
        $this->put('/orders/'.$legacy->id, $this->editData($legacy))->assertForbidden();
        $this->post('/orders/'.$legacy->id.'/payment', ['payment_method' => 'cash', 'cash' => '120.00'])->assertForbidden();
        $this->post('/orders/'.$legacy->id.'/status', ['status' => 'out_for_delivery'])->assertForbidden();
        $this->get('/orders')->assertDontSee($legacy->number())->assertSee($own->number());
        $this->actingAs($second)->get('/orders/'.$legacy->id)->assertOk();
        $this->get('/orders')->assertSee($legacy->number())->assertSee($other->number())->assertDontSee($own->number());
    }

    public function test_assigned_cashier_collects_once_with_original_receipt_attribution_and_keeps_collection_history(): void
    {
        $admin = $this->staff('admin');
        $collector = $this->staff();
        $next = $this->staff();
        $stranger = $this->staff();
        $order = $this->historicalOrder($admin);
        $product = $this->product($order);
        $product->update(['name' => 'Current inventory name', 'price_cents' => 9999]);
        $this->actingAs($admin)->put('/orders/'.$order->id.'/handoff', $this->handoff($order, $collector))->assertRedirect();
        $payment = ['payment_method' => 'cash', 'cash' => '120.00'];
        $this->actingAs($collector)->post('/orders/'.$order->id.'/payment', $payment)->assertRedirect();
        $this->post('/orders/'.$order->id.'/payment', $payment)->assertRedirect();
        $sale = Sale::firstOrFail();
        $this->assertSame($admin->id, $sale->user_id);
        $this->assertSame($admin->id, $order->fresh()->user_id);
        $this->assertSame($collector->id, $order->fresh()->paid_by);
        $this->assertSame(11050, $sale->total_cents);
        $this->assertSame(950, $sale->change_cents);
        $this->assertSame(8, $product->fresh()->stock);
        $this->assertSame(0, $product->fresh()->reserved);
        $this->assertDatabaseCount('sales', 1);
        $this->assertDatabaseCount('stock_movements', 1);
        $this->assertDatabaseHas('stock_movements', ['user_id' => $collector->id, 'sale_id' => $sale->id, 'quantity' => -2]);
        $this->get('/sales/'.$sale->id.'/receipt')->assertOk()->assertSee('Agreed notebook')->assertDontSee('Current inventory name');
        $this->get('/sales')->assertViewHas('total', 11050)->assertSee($sale->receiptNumber());
        $receipt = $sale->getAttributes();
        $this->actingAs($admin)->put('/orders/'.$order->id.'/handoff', $this->handoff($order, $next))->assertRedirect();
        $this->assertSame($receipt, $sale->fresh()->getAttributes());
        $this->actingAs($collector)->get('/orders/'.$order->id)->assertForbidden();
        $this->get('/sales/'.$sale->id.'/receipt')->assertOk();
        $this->get('/sales')->assertViewHas('total', 11050)->assertSee($sale->receiptNumber());
        $this->actingAs($next)->get('/sales/'.$sale->id.'/receipt')->assertOk();
        $this->get('/sales')->assertViewHas('total', 0)->assertDontSee($sale->receiptNumber());
        $this->actingAs($stranger)->get('/sales/'.$sale->id.'/receipt')->assertForbidden();
        $this->get('/sales')->assertViewHas('total', 0);
        $this->actingAs($next)->post('/orders/'.$order->id.'/status', ['status' => 'ready'])->assertRedirect();
        $this->post('/orders/'.$order->id.'/status', ['status' => 'out_for_delivery'])->assertRedirect();
        $this->post('/orders/'.$order->id.'/status', ['status' => 'completed'])->assertRedirect();
        $this->assertSame('completed', $order->fresh()->status);
        $this->assertSame($admin->id, $order->fresh()->user_id);
        $this->assertSame($collector->id, $order->fresh()->paid_by);
        $this->get('/sales/'.$sale->id.'/receipt')->assertOk();
    }

    public function test_paid_historical_order_handoff_preserves_existing_receipts_and_revokes_noncollector_receipt_access(): void
    {
        $admin = $this->staff('admin');
        $first = $this->staff();
        $second = $this->staff();
        $order = $this->historicalOrder($admin, ['status' => 'ready']);
        $sale = $this->makeHistoricalPaid($order);
        $before = $sale->getAttributes();
        $items = $sale->items->map->getAttributes()->all();
        $this->actingAs($admin)->put('/orders/'.$order->id.'/handoff', $this->handoff($order, $first))->assertRedirect();
        $this->actingAs($first)->get('/sales/'.$sale->id.'/receipt')->assertOk();
        $this->post('/orders/'.$order->id.'/payment', ['payment_method' => 'cash', 'cash' => '120.00'])->assertRedirect();
        $this->assertSame($before, $sale->fresh()->getAttributes());
        $this->assertSame($items, $sale->fresh('items')->items->map->getAttributes()->all());
        $this->assertSame($admin->id, $order->fresh()->paid_by);
        $this->assertDatabaseCount('sales', 1);
        $this->actingAs($admin)->put('/orders/'.$order->id.'/handoff', $this->handoff($order, $second))->assertRedirect();
        $this->actingAs($first)->get('/sales/'.$sale->id.'/receipt')->assertForbidden();
        $this->actingAs($second)->get('/sales/'.$sale->id.'/receipt')->assertOk();
    }

    public function test_admin_still_cannot_perform_cashier_actions_and_disabled_assignee_cannot_act(): void
    {
        $admin = $this->staff('admin');
        $cashier = $this->staff();
        $order = $this->historicalOrder($admin);
        $this->actingAs($admin)->put('/orders/'.$order->id.'/handoff', $this->handoff($order, $cashier))->assertRedirect();
        $this->get('/orders/'.$order->id)->assertOk();
        $this->get('/orders/'.$order->id.'/edit')->assertForbidden();
        $this->put('/orders/'.$order->id, $this->editData($order))->assertForbidden();
        $this->post('/orders/'.$order->id.'/payment', ['payment_method' => 'cash', 'cash' => '120.00'])->assertForbidden();
        $this->post('/orders/'.$order->id.'/status', ['status' => 'ready'])->assertForbidden();
        $cashier->active = false;
        $cashier->save();
        foreach ([$admin, $cashier->fresh()] as $actor) {
            try {
                app(Orders::class)->pay($actor, $order, ['payment_method' => 'cash', 'cash' => '120.00']);
                $this->fail('A restricted account collected payment.');
            } catch (HttpException $exception) {
                $this->assertSame(403, $exception->getStatusCode());
            }
        }
        $this->actingAs($cashier->fresh())->get('/orders/'.$order->id)->assertRedirect('/login');
        $this->assertDatabaseCount('sales', 0);
        $this->assertSame('preparing', $order->fresh()->status);
        $this->assertSame(2, $this->product($order)->reserved);
    }

    public function test_assignment_requests_cannot_change_creator_money_items_or_assignment_actor(): void
    {
        $admin = $this->staff('admin');
        $cashier = $this->staff();
        $order = $this->historicalOrder($admin);
        $fields = ['user_id' => $cashier->id, 'assigned_by' => $cashier->id, 'assigned_at' => now()->toDateTimeString(), 'assignment_version' => 999, 'items' => [['product_id' => $order->items->first()->product_id, 'quantity' => 999]], 'status' => 'completed', 'total_cents' => 1, 'sale_id' => 999, 'paid_by' => $cashier->id];
        $this->actingAs($admin)->put('/orders/'.$order->id.'/handoff', [...$this->handoff($order, $cashier), ...$fields])->assertSessionHasErrors(array_keys($fields));
        $this->assertSame($admin->id, $order->fresh()->user_id);
        $this->assertNull($order->fresh()->assigned_cashier_id);
        $this->assertSame(11050, $order->fresh()->total_cents);
        $this->put('/orders/'.$order->id.'/handoff', $this->handoff($order, $cashier))->assertRedirect();
        $this->actingAs($cashier)->put('/orders/'.$order->id, [...$this->editData($order), 'assigned_cashier_id' => $admin->id])->assertSessionHasErrors('assigned_cashier_id');
        $this->assertSame($cashier->id, $order->fresh()->assigned_cashier_id);
        $this->assertSame(2, $this->product($order)->reserved);
    }

    public function test_additive_handoff_migration_preserves_existing_orders_and_paid_history(): void
    {
        // SQLite schema rebuilds must run outside RefreshDatabase's transaction,
        // matching Migrator's SQLite execution and foreign-key pragma behavior.
        $originalConnection = DB::getDefaultConnection();
        $originalSchema = Schema::getFacadeRoot();
        config(['database.connections.handoff_preservation' => [...config('database.connections.sqlite'), 'database' => ':memory:', 'url' => null]]);
        DB::setDefaultConnection('handoff_preservation');
        Schema::swap(DB::connection()->getSchemaBuilder());
        try {
            foreach (glob(database_path('migrations/*.php')) as $path) {
                if (basename($path) !== '2026_10_12_000004_add_order_handoff.php') {
                    (require $path)->up();
                }
            }
            $this->assertSame(0, DB::connection()->transactionLevel());
            $admin = $this->staff('admin');
            $order = $this->historicalOrder($admin);
            $sale = $this->makeHistoricalPaid($order);
            $fields = ['assigned_cashier_id', 'assigned_by', 'assigned_at', 'assignment_version'];
            $before = $order->fresh()->getAttributes();
            $saleBefore = $sale->getAttributes();
            $orderItems = $order->fresh('items')->items->map->getAttributes()->all();
            $saleItems = $sale->fresh('items')->items->map->getAttributes()->all();
            $stock = $this->product($order)->getAttributes();
            $account = $admin->fresh()->getAttributes();
            $this->assertFalse(Schema::hasColumn('orders', 'assigned_cashier_id'));
            $migration = require database_path('migrations/2026_10_12_000004_add_order_handoff.php');
            $migration->up();
            $after = $order->fresh()->getAttributes();
            $this->assertSame($before, Arr::except($after, $fields));
            foreach (['assigned_cashier_id', 'assigned_by', 'assigned_at'] as $field) {
                $this->assertNull($after[$field]);
            }
            $this->assertSame(0, $after['assignment_version']);
            $this->assertSame($saleBefore, $sale->fresh()->getAttributes());
            $this->assertSame($orderItems, $order->fresh('items')->items->map->getAttributes()->all());
            $this->assertSame($saleItems, $sale->fresh('items')->items->map->getAttributes()->all());
            $this->assertSame($stock, $this->product($order)->getAttributes());
            $this->assertSame($account, $admin->fresh()->getAttributes());
            $this->assertSame([], DB::select('PRAGMA foreign_key_check'));
        } finally {
            DB::setDefaultConnection($originalConnection);
            Schema::swap($originalSchema);
            DB::purge('handoff_preservation');
            config(['database.connections.handoff_preservation' => null]);
        }
    }

    public function test_same_second_assignment_cycle_cannot_restore_old_edit_or_handoff_tokens(): void
    {
        $this->travelTo(now()->startOfSecond());
        $admin = $this->staff('admin');
        $first = $this->staff();
        $second = $this->staff();
        $order = $this->historicalOrder($admin);
        $path = '/orders/'.$order->id.'/handoff';
        $this->actingAs($admin)->put($path, $this->handoff($order, $first))->assertRedirect();
        $oldEdit = $this->editData($order);
        $oldHandoff = $this->handoff($order, $second);
        $timestamp = $order->fresh()->assigned_at->toDateTimeString();
        $this->assertSame(1, $order->fresh()->assignment_version);
        $this->put($path, $this->handoff($order, $second))->assertRedirect();
        $this->put($path, $this->handoff($order, $first))->assertRedirect();
        $this->assertSame($first->id, $order->fresh()->assigned_cashier_id);
        $this->assertSame($timestamp, $order->fresh()->assigned_at->toDateTimeString());
        $this->assertSame(3, $order->fresh()->assignment_version);
        $this->put($path, $oldHandoff)->assertSessionHasErrors('handoff_token');
        $this->actingAs($first)->put('/orders/'.$order->id, [...$oldEdit, 'notes' => 'Rejected previous assignment edit'])->assertSessionHasErrors('edit_token');
        $this->assertSame('Original agreed details', $order->fresh()->notes);
        $this->assertSame(3, $order->fresh()->assignment_version);
        $this->assertSame(2, $this->product($order)->reserved);
    }
}
