<?php

namespace Tests\Feature;

use App\Models\Product;
use App\Models\Sale;
use App\Models\User;
use App\Services\Checkout;
use App\Services\Orders;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Symfony\Component\HttpKernel\Exception\HttpException;
use Tests\TestCase;

class RoleAccessTest extends TestCase
{
    use RefreshDatabase;

    public function test_login_and_existing_login_route_use_role_landing_pages(): void
    {
        foreach (['admin' => '/dashboard', 'cashier' => '/pos'] as $role => $landing) {
            $password = Str::random(20);
            $user = User::factory()->create(['role' => $role, 'password' => $password]);
            $this->withSession(['url.intended' => '/inventory'])->post('/login', ['login' => $user->username, 'password' => $password])->assertRedirect($landing);
            $this->get('/login')->assertRedirect($landing);
            $this->post('/logout')->assertRedirect('/login');
        }
    }

    public function test_disabled_and_unknown_roles_cannot_log_in(): void
    {
        foreach ([['role' => 'cashier', 'active' => false], ['role' => 'unexpected', 'active' => true]] as $attributes) {
            $password = Str::random(20);
            $user = User::factory()->create([...$attributes, 'password' => $password]);
            $this->post('/login', ['login' => $user->username, 'password' => $password])->assertSessionHasErrors('login');
            $this->assertGuest();
        }
    }

    public function test_login_username_casing_is_case_insensitive(): void
    {
        foreach (['admin', 'cashier'] as $role) {
            $password = Str::random(20);
            $username = 'Legacy-'.$role.'-Lead';
            $user = User::factory()->create(['role' => $role, 'username' => $username, 'password' => $password]);
            $this->post('/login', ['login' => strtoupper($username), 'password' => $password])->assertRedirect($role === 'admin' ? '/dashboard' : '/pos');
            $this->assertAuthenticatedAs($user);
            $this->assertSame($username, $user->fresh()->username);
            $this->post('/logout');
        }
    }

    public function test_staff_command_rejects_case_variant_of_existing_username(): void
    {
        User::factory()->create(['username' => 'Legacy-Command']);
        $this->artisan('store:staff', ['--role' => 'cashier'])
            ->expectsQuestion('Staff name', 'Demo Cashier')
            ->expectsQuestion('Username (letters, numbers, hyphens, 3-40 characters)', 'LEGACY-COMMAND')
            ->expectsQuestion('Password (at least 12 characters)', Str::random(20))
            ->expectsOutput('The username has already been taken.')
            ->assertFailed();
        $this->assertDatabaseCount('users', 1);
    }

    public function test_disabled_existing_session_loses_staff_access(): void
    {
        $cashier = User::factory()->create(['role' => 'cashier', 'active' => false]);
        $this->actingAs($cashier)->get('/pos')->assertRedirect('/login')->assertSessionHasErrors('login');
        $this->assertGuest();
    }

    public function test_recreated_stale_session_is_rejected_after_password_change(): void
    {
        $cashier = User::factory()->create();
        $oldHash = $cashier->password;
        $cashier->update(['password' => Str::random(20)]);
        $this->actingAs($cashier->fresh())->withSession(['password_hash_web' => $oldHash])->get('/pos')->assertRedirect('/login');
        $this->assertGuest();
    }

    public function test_admin_cannot_checkout_or_mutate_orders_even_with_direct_requests(): void
    {
        $cashier = User::factory()->create();
        $product = Product::create(['sku' => 'GUARD-TEST', 'name' => 'Demo notebook', 'category' => 'Paper', 'kind' => 'product', 'price_cents' => 4500, 'stock' => 4, 'reorder_level' => 1, 'active' => true]);
        $order = app(Orders::class)->create($cashier, ['reference' => (string) Str::uuid(), 'channel' => 'walk-in', 'fulfillment' => 'pickup', 'payment_plan' => 'cod', 'customer_name' => 'Demo customer', 'customer_phone' => '09123456789', 'items' => [['product_id' => $product->id, 'quantity' => 1]]]);
        $path = '/orders/'.$order->id;
        $this->actingAs(User::factory()->create(['role' => 'admin']));
        $this->get('/pos')->assertForbidden();
        $this->post('/sales', [])->assertForbidden();
        $this->post('/orders', [])->assertForbidden();
        $this->get($path.'/edit')->assertForbidden();
        $this->put($path, [])->assertForbidden();
        $this->post($path.'/payment', [])->assertForbidden();
        $this->post($path.'/status', [])->assertForbidden();
        $this->assertDatabaseCount('sales', 0);
        $this->assertDatabaseCount('orders', 1);
        $this->assertSame('preparing', $order->fresh()->status);
        $this->assertSame(1, $product->fresh()->reserved);
    }

    public function test_checkout_service_also_rejects_admin_and_inactive_cashier(): void
    {
        foreach ([['role' => 'admin'], ['role' => 'cashier', 'active' => false]] as $attributes) {
            try {
                app(Checkout::class)->complete(User::factory()->create($attributes), [], 0, 'walk-in', (string) Str::uuid());
                $this->fail('A restricted account reached checkout.');
            } catch (HttpException $exception) {
                $this->assertSame(403, $exception->getStatusCode());
            }
        }
        $this->assertDatabaseCount('sales', 0);
    }

    public function test_additive_migration_preserves_account_and_transaction_ids(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);
        $cashier = User::factory()->create();
        $product = Product::create(['sku' => 'MIGRATION-TEST', 'name' => 'Demo notebook', 'category' => 'Paper', 'kind' => 'product', 'price_cents' => 4500, 'stock' => 4, 'reorder_level' => 1, 'active' => true]);
        app(Checkout::class)->complete($cashier, [['product_id' => $product->id, 'quantity' => 1]], 5000, 'walk-in', (string) Str::uuid());
        $sale = Sale::firstOrFail()->getAttributes();
        $stock = $product->fresh()->getAttributes();
        $account = $admin->getAttributes();
        $migration = require database_path('migrations/2026_10_12_000003_add_staff_access.php');
        $migration->down();
        $this->assertSame('owner', DB::table('users')->where('id', $admin->id)->value('role'));
        $migration->up();
        $this->assertSame('admin', $admin->fresh()->role);
        $this->assertTrue($admin->fresh()->active);
        foreach (['id', 'name', 'username', 'password', 'created_at'] as $field) {
            $this->assertSame($account[$field], $admin->fresh()->getAttributes()[$field]);
        }
        $this->assertSame($sale, Sale::firstOrFail()->getAttributes());
        $this->assertSame($stock, $product->fresh()->getAttributes());
        $this->assertSame($cashier->id, Sale::firstOrFail()->user_id);
        $this->assertDatabaseCount('users', 2);
        $this->assertDatabaseCount('sale_items', 1);
        $this->assertDatabaseCount('stock_movements', 1);
    }

    public function test_legacy_owner_command_creates_admin_without_printing_password(): void
    {
        $password = Str::random(20);
        $this->artisan('store:staff', ['--role' => 'owner'])
            ->expectsQuestion('Staff name', 'Demo Admin')
            ->expectsQuestion('Username (letters, numbers, hyphens, 3-40 characters)', 'demo-admin')
            ->expectsQuestion('Password (at least 12 characters)', $password)
            ->expectsOutput('Staff account created. Sign in using the credentials you entered.')
            ->assertSuccessful();
        $user = User::where('username', 'demo-admin')->firstOrFail();
        $this->assertSame('admin', $user->role);
        $this->assertTrue($user->active);
        $this->assertTrue(Hash::check($password, $user->password));
    }
}
