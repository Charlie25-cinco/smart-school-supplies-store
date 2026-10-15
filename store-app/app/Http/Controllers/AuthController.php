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
        $data = $request->validate(['login' => ['required', 'string', 'max:40'], 'password' => ['required', 'string']]);
        $username = Str::lower(trim($data['login']));
        $credentials = ['username' => fn ($query) => $query->whereRaw('LOWER(username) = ?', [$username]), 'password' => $data['password'], 'active' => true];
        if (! Auth::attemptWhen($credentials, fn (User $user) => $user->isAdmin() || $user->isCashier())) {
            throw ValidationException::withMessages(['login' => 'The username or password is incorrect.']);
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
