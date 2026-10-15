<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class UsernameTest extends TestCase
{
    use RefreshDatabase;

    public function test_sign_in_accepts_username_case_insensitively(): void
    {
        $user = User::factory()->create(['role' => 'cashier', 'username' => 'Counter-Lead']);
        $user->update(['password' => 'twelve-chars-pw']);
        $this->post('/login', ['login' => 'counter-lead', 'password' => 'twelve-chars-pw'])->assertRedirect('/pos');
        $this->assertAuthenticatedAs($user);
    }

    public function test_email_style_login_is_rejected(): void
    {
        User::factory()->create(['role' => 'cashier', 'username' => 'till-two']);
        $this->post('/login', ['login' => 'till-two@example.test', 'password' => 'twelve-chars-pw'])->assertSessionHasErrors('login');
        $this->assertGuest();
    }

    public function test_wrong_credentials_report_login_error(): void
    {
        User::factory()->create(['role' => 'cashier', 'username' => 'till-one']);
        $this->post('/login', ['login' => 'till-one', 'password' => 'wrong-password'])->assertSessionHasErrors('login');
        $this->assertGuest();
    }

    public function test_duplicate_username_is_rejected_case_insensitively(): void
    {
        User::factory()->create(['role' => 'cashier', 'username' => 'till-one']);
        $this->actingAs(User::factory()->create(['role' => 'admin']));
        $this->post('/cashiers', ['name' => 'New', 'username' => 'TILL-ONE', 'password' => 'twelve-chars-here', 'password_confirmation' => 'twelve-chars-here'])->assertSessionHasErrors('username');
        $this->assertSame(2, User::count());
    }

    public function test_invalid_username_format_is_rejected(): void
    {
        $this->actingAs(User::factory()->create(['role' => 'admin']));
        $this->post('/cashiers', ['name' => 'New', 'username' => 'has space!', 'password' => 'twelve-chars-here', 'password_confirmation' => 'twelve-chars-here'])->assertSessionHasErrors('username');
        $this->post('/cashiers', ['name' => 'New', 'username' => 'ab', 'password' => 'twelve-chars-here', 'password_confirmation' => 'twelve-chars-here'])->assertSessionHasErrors('username');
    }
}
