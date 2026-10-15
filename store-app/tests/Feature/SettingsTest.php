<?php

namespace Tests\Feature;

use App\Models\Setting;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

class SettingsTest extends TestCase
{
    use RefreshDatabase;

    public function test_staff_updates_own_name_but_not_preferences(): void
    {
        $cashier = User::factory()->create(['role' => 'cashier']);
        $this->actingAs($cashier)->put('/settings/profile', ['name' => 'New Display Name'])->assertRedirect(route('settings'));
        $this->assertSame('New Display Name', $cashier->fresh()->name);
        $this->actingAs($cashier)->put('/settings/preferences', ['default_reorder_level' => 5])->assertForbidden();
        $this->assertNull(Setting::get('default_reorder_level'));
    }

    public function test_password_change_requires_current_and_ends_other_sessions(): void
    {
        $cashier = User::factory()->create(['role' => 'cashier']);
        $cashier->update(['password' => 'old-twelve-chars']);
        $this->actingAs($cashier)->put('/settings/password', ['current_password' => 'wrong', 'password' => 'new-twelve-chars', 'password_confirmation' => 'new-twelve-chars'])->assertSessionHasErrors('current_password');
        DB::table('sessions')->insert(['id' => 'other-device-session', 'user_id' => $cashier->id, 'ip_address' => '127.0.0.1', 'user_agent' => 'test', 'payload' => 'x', 'last_activity' => time()]);
        $this->actingAs($cashier)->put('/settings/password', ['current_password' => 'old-twelve-chars', 'password' => 'new-twelve-chars', 'password_confirmation' => 'new-twelve-chars'])->assertRedirect(route('settings'));
        $this->assertSame(0, DB::table('sessions')->where('id', 'other-device-session')->count());
        $this->post('/logout');
        $this->post('/login', ['login' => $cashier->username, 'password' => 'new-twelve-chars'])->assertRedirect('/pos');
    }

    public function test_admin_updates_preferences_and_form_prefills(): void
    {
        $this->actingAs(User::factory()->create(['role' => 'admin']));
        $this->put('/settings/preferences', ['default_reorder_level' => 25, 'receipt_note' => 'Thank you, come again!'])->assertRedirect(route('settings'));
        $this->assertSame('25', Setting::get('default_reorder_level'));
        $this->assertSame('Thank You, Come Again!', Setting::get('receipt_note'));
        $this->get('/settings')->assertOk()->assertSee('Thank You, Come Again!');
    }

    public function test_guests_cannot_reach_settings(): void
    {
        $this->get('/settings')->assertRedirect('/login');
        $this->put('/settings/profile', ['name' => 'Nobody'])->assertRedirect('/login');
        $this->put('/settings/password', [])->assertRedirect('/login');
    }
}
