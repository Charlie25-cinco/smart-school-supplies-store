<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;

class ActiveStaff
{
    public function handle(Request $request, Closure $next)
    {
        $user = $request->user();
        if (! $user?->active || (! $user->isAdmin() && ! $user->isCashier())) {
            Auth::logout();
            $request->session()->invalidate();
            $request->session()->regenerateToken();

            return redirect()->route('login')->withErrors(['email' => 'Your staff access is unavailable. Ask the Admin for assistance.']);
        }

        return $next($request);
    }
}
