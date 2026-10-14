<?php

namespace App\Http\Controllers;

use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

class AuthController extends Controller
{
    public function show()
    {
        return auth()->check() ? redirect()->route(auth()->user()->isAdmin() ? 'dashboard' : 'pos') : view('auth.login');
    }

    public function login(Request $request)
    {
        $credentials = $request->validate(['email' => ['required', 'email'], 'password' => ['required', 'string']]);
        $email = Str::lower(trim($credentials['email']));
        $credentials['email'] = fn ($query) => $query->whereRaw('LOWER(email) = ?', [$email]);
        if (! Auth::attemptWhen([...$credentials, 'active' => true], fn (User $user) => $user->isAdmin() || $user->isCashier())) {
            throw ValidationException::withMessages(['email' => 'The email or password is incorrect.']);
        }
        $request->session()->regenerate();

        return redirect()->route(auth()->user()->isAdmin() ? 'dashboard' : 'pos');
    }

    public function logout(Request $request)
    {
        Auth::logout();
        $request->session()->invalidate();
        $request->session()->regenerateToken();

        return redirect()->route('login');
    }
}
