<x-layout title="Settings">
    <div class="page-heading"><div><span class="eyebrow">STORE WORKSPACE</span><h1>Settings</h1><p>Manage your profile and store preferences.</p></div></div>
    <form class="panel item-form" action="{{ route('settings.profile') }}" method="post">@csrf @method('put')
        <fieldset class="form-section"><legend>Profile</legend><div class="form-grid"><div><label for="settings-name">Display name</label><input id="settings-name" name="name" maxlength="100" required value="{{ old('name', auth()->user()->name) }}"></div></div></fieldset>
        <div class="form-footer"><button class="button primary" type="submit">Save name</button></div>
    </form>
    <form class="panel item-form" action="{{ route('settings.password') }}" method="post">@csrf @method('put')
        <fieldset class="form-section"><legend>Change password</legend><p class="field-help">Changing your password signs out your other devices. Use at least 12 characters; mixing letters, numbers, and symbols is encouraged.</p><div class="form-grid"><div><label for="settings-current-password">Current password</label><input id="settings-current-password" name="current_password" type="password" autocomplete="current-password" required></div><div><label for="settings-password">New password</label><input id="settings-password" name="password" type="password" autocomplete="new-password" minlength="12" maxlength="255" required></div><div><label for="settings-password-confirmation">Confirm new password</label><input id="settings-password-confirmation" name="password_confirmation" type="password" autocomplete="new-password" minlength="12" maxlength="255" required></div></div></fieldset>
        <div class="form-footer"><button class="button primary" type="submit">Change password</button></div>
    </form>
    @if(auth()->user()->isAdmin())
    <form class="panel item-form" action="{{ route('settings.preferences') }}" method="post">@csrf @method('put')
        <fieldset class="form-section"><legend>Store preferences</legend><div class="form-grid"><div><label for="settings-reorder">Default reorder level (units)</label><input id="settings-reorder" name="default_reorder_level" type="number" min="0" max="1000000" required value="{{ old('default_reorder_level', \App\Models\Setting::get('default_reorder_level', '10')) }}"><small class="field-help">Prefilled for newly added items.</small></div><div><label for="settings-receipt-note">Receipt note</label><input id="settings-receipt-note" name="receipt_note" maxlength="200" value="{{ old('receipt_note', \App\Models\Setting::get('receipt_note', '')) }}"><small class="field-help">Printed on receipts. Leave blank for none.</small></div></div>
        <p class="field-help">Sign-in idle timeout is currently {{ config('session.lifetime') }} minutes (SESSION_LIFETIME in the private store configuration; restart the demo after changing it).</p></fieldset>
        <div class="form-footer"><button class="button primary" type="submit">Save preferences</button></div>
    </form>
    @endif
</x-layout>
