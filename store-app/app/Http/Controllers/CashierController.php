<?php

namespace App\Http\Controllers;

use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class CashierController extends Controller
{
    public function index(Request $request)
    {
        $this->ensureAdmin($request);

        return view('cashiers.index', [
            'cashiers' => User::where('role', 'cashier')->orderBy('name')->orderBy('id')->paginate(15),
        ]);
    }

    public function create(Request $request)
    {
        $this->ensureAdmin($request);

        return view('cashiers.form', ['cashier' => new User(['active' => true])]);
    }

    public function store(Request $request)
    {
        $this->ensureAdmin($request);
        $data = $this->profileData($request);
        $password = $request->validate(['password' => ['required', 'string', 'min:12', 'max:255', 'confirmed']]);
        $cashier = new User($data);
        $cashier->password = $password['password'];
        $cashier->role = 'cashier';
        $cashier->active = true;
        $cashier->save();

        return redirect()->route('cashiers.index')->with('success', 'Cashier account created. The cashier can now sign in.');
    }

    public function edit(Request $request, User $cashier)
    {
        $this->ensureAdmin($request, $cashier);

        return view('cashiers.form', compact('cashier'));
    }

    public function update(Request $request, User $cashier)
    {
        $this->ensureAdmin($request, $cashier);
        $data = $this->profileData($request, $cashier);
        $cashier->update($data);

        return redirect()->route('cashiers.edit', $cashier)->with('success', 'Cashier details updated. Transaction history is preserved.');
    }

    public function password(Request $request, User $cashier)
    {
        $this->ensureAdmin($request, $cashier);
        $data = $request->validate([
            'password' => ['required', 'string', 'min:12', 'max:255', 'confirmed'],
            'role' => ['prohibited'],
            'active' => ['prohibited'],
        ]);
        DB::transaction(function () use ($cashier, $data) {
            $cashier->password = $data['password'];
            $cashier->remember_token = Str::random(60);
            $cashier->save();
            $this->terminateSessions($cashier);
        });

        return redirect()->route('cashiers.edit', $cashier)->with('success', 'Password reset. Existing cashier sessions have ended.');
    }

    public function status(Request $request, User $cashier)
    {
        $this->ensureAdmin($request, $cashier);
        $request->validate(['active' => ['required', 'boolean'], 'role' => ['prohibited'], 'password' => ['prohibited']]);
        $active = $request->boolean('active');
        DB::transaction(function () use ($cashier, $active) {
            $cashier->active = $active;
            if (! $active) {
                $cashier->remember_token = Str::random(60);
            }
            $cashier->save();
            if (! $active) {
                $this->terminateSessions($cashier);
            }
        });

        return redirect()->route('cashiers.edit', $cashier)->with('success', $active
            ? 'Cashier account enabled. The cashier can sign in again.'
            : 'Cashier account disabled. Existing sessions have ended; transaction history is preserved.');
    }

    private function profileData(Request $request, ?User $cashier = null): array
    {
        if (is_string($request->input('email'))) {
            $request->merge(['email' => Str::lower(trim($request->input('email')))]);
        }

        $data = $request->validate([
            'name' => ['required', 'string', 'max:100'],
            'email' => ['bail', 'required', 'string', 'email:rfc', 'max:255', function ($attribute, $value, $fail) use ($cashier) {
                $existing = User::whereRaw('LOWER(email) = ?', [$value])
                    ->when($cashier, fn ($query) => $query->where('id', '!=', $cashier->id))->exists();
                if ($existing) {
                    $fail('This login email is already used by a staff account.');
                }
            }],
            'role' => ['prohibited'],
            'active' => ['prohibited'],
        ]);

        // Name-only edits preserve the exact address on historical accounts.
        $email = $cashier && Str::lower($cashier->email) === $data['email'] ? $cashier->email : $data['email'];

        return ['name' => $data['name'], 'email' => $email];
    }

    private function ensureAdmin(Request $request, ?User $cashier = null): void
    {
        abort_unless($request->user()?->isAdmin() && $request->user()->active, 403);
        if ($cashier) {
            abort_unless($cashier->role === 'cashier', 404);
        }
    }

    private function terminateSessions(User $cashier): void
    {
        DB::connection(config('session.connection'))->table(config('session.table', 'sessions'))
            ->where('user_id', $cashier->id)->delete();
    }
}
