<?php

namespace Tests\Feature;

use App\Models\Order;
use App\Models\Product;
use App\Models\Sale;
use App\Models\StockMovement;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Tests\TestCase;

class CashierManagementTest extends TestCase
{
    use RefreshDatabase;

    private function staff(string $role = 'cashier'): User
    {
        return User::factory()->create(['role' => $role, 'active' => true]);
    }

    private function details(array $overrides = []): array
    {
        $password = Str::random(24);

        return [...['name' => 'Demo Cashier', 'username' => 'demo-'.Str::lower(Str::random(6)), 'password' => $password, 'password_confirmation' => $password], ...$overrides];
    }

    private function storedSession(User $staff): string
    {
        $id = Str::random(40);
        DB::table('sessions')->insert(['id' => $id, 'user_id' => $staff->id, 'ip_address' => '127.0.0.1', 'user_agent' => 'Isolated test', 'payload' => '', 'last_activity' => time()]);

        return $id;
    }

    public function test_admin_creates_and_edits_a_cashier_with_hashed_credentials(): void
    {
        $admin = $this->staff('admin');
        $data = $this->details(['username' => 'DEMO-CASHIER']);
        $this->actingAs($admin)->get('/cashiers/create')->assertOk()->assertSee('Create cashier account');
        $this->post('/cashiers', $data)->assertRedirect('/cashiers')->assertSessionHas('success');
        $cashier = User::where('username', 'demo-cashier')->firstOrFail();
        $this->assertSame('cashier', $cashier->role);
        $this->assertTrue($cashier->active);
        $this->assertTrue(Hash::check($data['password'], $cashier->password));
        $this->assertNotSame($data['password'], $cashier->password);
        $this->get('/cashiers')->assertOk()->assertSee('Demo Cashier')->assertSee('Manage account')->assertDontSee($data['password'])->assertDontSee($admin->username);
        $this->get('/cashiers/'.$cashier->id.'/edit')->assertOk()->assertSee('Reset password')->assertSee('Disable cashier account')->assertDontSee($cashier->password);
        $hash = $cashier->password;
        $this->put('/cashiers/'.$cashier->id, ['name' => 'Updated Cashier', 'username' => 'updated-cashier'])->assertRedirect('/cashiers/'.$cashier->id.'/edit');
        $this->assertSame('Updated Cashier', $cashier->fresh()->name);
        $this->assertSame($hash, $cashier->fresh()->password);
    }

    public function test_invalid_account_input_is_recoverable_without_flashing_passwords(): void
    {
        $this->actingAs($this->staff('admin'));
        $existing = $this->staff();
        $data = $this->details(['name' => 'Keep this name', 'username' => $existing->username, 'password' => 'short', 'password_confirmation' => 'short']);
        $this->from('/cashiers/create')->post('/cashiers', $data)->assertRedirect('/cashiers/create')
            ->assertSessionHasErrors('username')->assertSessionHasInput('name', 'Keep this name')->assertSessionHasInput('username', $existing->username)
            ->assertSessionMissing('_old_input.password')->assertSessionMissing('_old_input.password_confirmation');
        $this->post('/cashiers', $this->details(['password' => 'short', 'password_confirmation' => 'short']))->assertSessionHasErrors('password');
        $this->post('/cashiers', $this->details(['password_confirmation' => Str::random(24)]))->assertSessionHasErrors('password');
        $this->post('/cashiers', $this->details(['name' => str_repeat('x', 101), 'username' => 'bad name!']))->assertSessionHasErrors(['name', 'username']);
        $this->post('/cashiers', $this->details(['password' => str_repeat('x', 256), 'password_confirmation' => str_repeat('x', 256)]))->assertSessionHasErrors('password');
        $this->assertDatabaseCount('users', 2);
    }

    public function test_crafted_role_or_access_fields_cannot_change_account_privileges(): void
    {
        $cashier = $this->staff();
        $originalName = $cashier->name;
        $this->actingAs($this->staff('admin'));
        $this->post('/cashiers', $this->details(['role' => 'admin']))->assertSessionHasErrors('role');
        $this->post('/cashiers', $this->details(['active' => 0]))->assertSessionHasErrors('active');
        $this->put('/cashiers/'.$cashier->id, ['name' => 'Forged', 'username' => $cashier->username, 'role' => 'admin'])->assertSessionHasErrors('role');
        $this->put('/cashiers/'.$cashier->id, ['name' => 'Forged', 'username' => $cashier->username, 'active' => 0])->assertSessionHasErrors('active');
        $this->put('/cashiers/'.$cashier->id, ['name' => 'Still cashier', 'username' => $cashier->username, 'role' => null, 'active' => null])->assertRedirect();
        $this->assertSame('cashier', $cashier->fresh()->role);
        $this->assertTrue($cashier->fresh()->active);
        $this->assertSame('Still Cashier', $cashier->fresh()->name);
        $this->assertNotSame($originalName, $cashier->fresh()->name);
        $this->patch('/cashiers/'.$cashier->id.'/status', ['active' => 0, 'role' => 'admin'])->assertSessionHasErrors('role');
        $this->assertTrue($cashier->fresh()->active);
    }

    public function test_cashier_and_guest_cannot_access_any_management_endpoint(): void
    {
        $cashier = $this->staff();
        $requests = [
            ['get', '/cashiers', []], ['get', '/cashiers/create', []], ['post', '/cashiers', $this->details()],
            ['get', '/cashiers/'.$cashier->id.'/edit', []], ['put', '/cashiers/'.$cashier->id, ['name' => 'Blocked', 'username' => $cashier->username]],
            ['put', '/cashiers/'.$cashier->id.'/password', $this->details()], ['patch', '/cashiers/'.$cashier->id.'/status', ['active' => 0]],
        ];
        foreach ($requests as [$method, $url, $data]) {
            $this->{$method}($url, $data)->assertRedirect('/login');
        }
        $this->actingAs($cashier);
        foreach ($requests as [$method, $url, $data]) {
            $this->{$method}($url, $data)->assertForbidden();
        }
        $this->assertTrue($cashier->fresh()->active);
        $this->assertDatabaseCount('users', 1);
    }

    public function test_admin_accounts_cannot_be_targeted_as_cashiers_or_deleted(): void
    {
        $admin = $this->staff('admin');
        $cashier = $this->staff();
        $hash = $admin->password;
        $this->actingAs($admin);
        $this->get('/cashiers/'.$admin->id.'/edit')->assertNotFound();
        $this->put('/cashiers/'.$admin->id, ['name' => 'Blocked', 'username' => 'blocked-user'])->assertNotFound();
        $this->put('/cashiers/'.$admin->id.'/password', $this->details())->assertNotFound();
        $this->patch('/cashiers/'.$admin->id.'/status', ['active' => 0])->assertNotFound();
        $this->delete('/cashiers/'.$cashier->id)->assertStatus(405);
        $this->assertSame($hash, $admin->fresh()->password);
        $this->assertTrue($admin->fresh()->active);
        $this->assertDatabaseCount('users', 2);
    }

    public function test_password_reset_ends_only_target_sessions_and_rotates_remember_token(): void
    {
        $admin = $this->staff('admin');
        $cashier = $this->staff();
        $other = $this->staff();
        $cashier->remember_token = Str::random(60);
        $cashier->save();
        $token = $cashier->remember_token;
        $targetSession = $this->storedSession($cashier);
        $otherSession = $this->storedSession($other);
        $adminSession = $this->storedSession($admin);
        $data = $this->details();
        $this->actingAs($admin)->put('/cashiers/'.$cashier->id.'/password', ['password' => $data['password'], 'password_confirmation' => $data['password_confirmation']])
            ->assertRedirect('/cashiers/'.$cashier->id.'/edit')->assertSessionHas('success')->assertSessionMissing('_old_input.password');
        $this->assertTrue(Hash::check($data['password'], $cashier->fresh()->password));
        $this->assertNotSame($token, $cashier->fresh()->remember_token);
        $this->assertTrue($cashier->fresh()->active);
        $this->assertDatabaseMissing('sessions', ['id' => $targetSession]);
        $this->assertDatabaseHas('sessions', ['id' => $otherSession]);
        $this->assertDatabaseHas('sessions', ['id' => $adminSession]);
    }

    public function test_failed_password_reset_preserves_credentials_and_sessions(): void
    {
        $cashier = $this->staff();
        $session = $this->storedSession($cashier);
        $hash = $cashier->password;
        $this->actingAs($this->staff('admin'))->from('/cashiers/'.$cashier->id.'/edit')
            ->put('/cashiers/'.$cashier->id.'/password', ['password' => Str::random(24), 'password_confirmation' => Str::random(24)])
            ->assertSessionHasErrors('password')->assertSessionMissing('_old_input.password')->assertSessionMissing('_old_input.password_confirmation');
        $this->assertSame($hash, $cashier->fresh()->password);
        $this->assertDatabaseHas('sessions', ['id' => $session]);
    }

    public function test_disabling_and_reenabling_cashier_preserves_transactions_and_other_sessions(): void
    {
        $cashier = $this->staff();
        $admin = $this->staff('admin');
        $token = $cashier->remember_token;
        $targetSession = $this->storedSession($cashier);
        $adminSession = $this->storedSession($admin);
        $product = Product::create(['sku' => 'HISTORY', 'name' => 'Frozen item', 'category' => 'Paper', 'kind' => 'product', 'price_cents' => 2500, 'stock' => 9, 'reserved' => 0, 'reorder_level' => 3, 'active' => true]);
        $sale = Sale::create(['reference' => Str::uuid(), 'user_id' => $cashier->id, 'channel' => 'walk-in', 'total_cents' => 2500, 'cash_cents' => 3000, 'change_cents' => 500]);
        $sale->items()->create(['product_id' => $product->id, 'name' => $product->name, 'sku' => $product->sku, 'kind' => 'product', 'quantity' => 1, 'price_cents' => 2500, 'total_cents' => 2500]);
        StockMovement::create(['product_id' => $product->id, 'user_id' => $cashier->id, 'sale_id' => $sale->id, 'quantity' => -1, 'reason' => 'Sale']);
        $order = Order::create(['reference' => Str::uuid(), 'user_id' => $cashier->id, 'channel' => 'messenger', 'fulfillment' => 'delivery', 'payment_plan' => 'collection', 'status' => 'preparing', 'customer_name' => 'Demo Customer', 'customer_phone' => '09000000000', 'delivery_address' => 'Fictional location', 'subtotal_cents' => 2500, 'delivery_fee_cents' => 0, 'total_cents' => 2500]);
        $this->actingAs($admin)->patch('/cashiers/'.$cashier->id.'/status', ['active' => 0])->assertRedirect('/cashiers/'.$cashier->id.'/edit');
        $this->assertFalse($cashier->fresh()->active);
        $this->assertNotSame($token, $cashier->fresh()->remember_token);
        $this->assertDatabaseMissing('sessions', ['id' => $targetSession]);
        $this->assertDatabaseHas('sessions', ['id' => $adminSession]);
        $this->assertSame($cashier->id, $sale->fresh()->user_id);
        $this->assertSame($cashier->id, $order->fresh()->user_id);
        $this->assertSame(2500, $sale->fresh()->total_cents);
        $this->assertSame(9, $product->fresh()->stock);
        $this->assertDatabaseCount('sale_items', 1);
        $this->assertDatabaseCount('stock_movements', 1);
        $this->get('/sales/'.$sale->id.'/receipt')->assertOk()->assertSee('Frozen item')->assertSee('25.00');
        $this->patch('/cashiers/'.$cashier->id.'/status', ['active' => 1])->assertRedirect('/cashiers/'.$cashier->id.'/edit');
        $this->assertTrue($cashier->fresh()->active);
        $this->assertDatabaseCount('users', 2);
        $this->assertDatabaseCount('sales', 1);
        $this->assertDatabaseCount('orders', 1);
    }

    public function test_duplicate_username_update_and_invalid_status_leave_target_unchanged(): void
    {
        $cashier = $this->staff();
        $other = $this->staff();
        $name = $cashier->name;
        $username = $cashier->username;
        $this->actingAs($this->staff('admin'))->put('/cashiers/'.$cashier->id, ['name' => 'Changed', 'username' => Str::upper($other->username)])
            ->assertSessionHasErrors('username')->assertSessionHasInput('name', 'Changed');
        $this->patch('/cashiers/'.$cashier->id.'/status', ['active' => 'invalid'])->assertSessionHasErrors('active');
        $this->assertSame($name, $cashier->fresh()->name);
        $this->assertSame($username, $cashier->fresh()->username);
        $this->assertTrue($cashier->fresh()->active);
    }

    public function test_case_variants_cannot_duplicate_legacy_accounts_and_name_edits_preserve_usernames(): void
    {
        $admin = User::factory()->create(['role' => 'admin', 'active' => true, 'username' => 'Legacy-Admin']);
        $legacy = User::factory()->create(['role' => 'cashier', 'active' => true, 'username' => 'Legacy-Cashier']);
        $target = $this->staff();
        $username = $target->username;
        $this->actingAs($admin);
        foreach (['legacy-admin', 'LEGACY-ADMIN', 'legacy-cashier', 'LEGACY-CASHIER'] as $duplicate) {
            $this->post('/cashiers', $this->details(['username' => $duplicate]))->assertSessionHasErrors('username');
            $this->put('/cashiers/'.$target->id, ['name' => 'Blocked update', 'username' => $duplicate])->assertSessionHasErrors('username');
        }
        $this->assertSame($username, $target->fresh()->username);
        $this->assertSame('Legacy-Admin', $admin->fresh()->username);
        $this->assertSame('Legacy-Cashier', $legacy->fresh()->username);
        $this->put('/cashiers/'.$legacy->id, ['name' => 'Updated Legacy Cashier', 'username' => 'LEGACY-CASHIER'])->assertRedirect('/cashiers/'.$legacy->id.'/edit');
        $this->assertSame('Legacy-Cashier', $legacy->fresh()->username);
        $this->assertSame('Updated Legacy Cashier', $legacy->fresh()->name);
        $data = $this->details(['username' => 'New-Cashier']);
        $this->post('/cashiers', $data)->assertRedirect('/cashiers');
        $this->assertDatabaseHas('users', ['username' => 'new-cashier', 'role' => 'cashier']);
        $this->assertDatabaseCount('users', 4);
    }
}
