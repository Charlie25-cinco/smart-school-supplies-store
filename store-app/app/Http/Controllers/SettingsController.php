<?php

namespace App\Http\Controllers;

use App\Models\Setting;
use App\Support\Text;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

class SettingsController extends Controller
{
    public function show()
    {
        return view('settings.form');
    }

    public function updateProfile(Request $request)
    {
        $data = $request->validate(['name' => ['required', 'string', 'max:100']]);
        $request->user()->update(['name' => Text::words(trim($data['name']))]);

        return redirect()->route('settings')->with('success', 'Profile name updated.');
    }

    public function updatePassword(Request $request)
    {
        $user = $request->user();
        $data = $request->validate([
            'current_password' => ['required', 'string'],
            'password' => ['required', 'string', 'min:12', 'max:255', 'confirmed'],
        ]);
        if (! Hash::check($data['current_password'], $user->password)) {
            throw ValidationException::withMessages(['current_password' => 'The current password is incorrect.']);
        }
        DB::transaction(function () use ($request, $user, $data) {
            $user->password = $data['password'];
            $user->remember_token = Str::random(60);
            $user->save();
            // End sessions on other devices; the current session is regenerated below.
            DB::table('sessions')->where('user_id', $user->id)->where('id', '!=', $request->session()->getId())->delete();
            $request->session()->regenerate();
        });

        return redirect()->route('settings')->with('success', 'Password changed. Other devices have been signed out.');
    }

    public function updatePreferences(Request $request)
    {
        abort_unless($request->user()->isAdmin(), 403);
        $data = $request->validate([
            'default_reorder_level' => ['required', 'integer', 'min:0', 'max:1000000'],
            'receipt_note' => ['nullable', 'string', 'max:200'],
        ]);
        Setting::set('default_reorder_level', (string) $data['default_reorder_level']);
        Setting::set('receipt_note', $data['receipt_note'] !== null ? Text::words(trim($data['receipt_note']), 200) : null);

        return redirect()->route('settings')->with('success', 'Store preferences updated.');
    }
}
