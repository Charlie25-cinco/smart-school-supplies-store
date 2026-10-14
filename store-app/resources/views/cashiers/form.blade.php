<x-layout :title="$cashier->exists ? 'Manage cashier' : 'Add cashier'" eyebrow="Admin workspace">
    <div class="page-heading">
        <div><a class="text-link" href="{{ route('cashiers.index') }}"><x-icon name="back" :size="18" /> Back to cashier accounts</a><h1>{{ $cashier->exists ? 'Manage cashier' : 'Add cashier' }}</h1><p>{{ $cashier->exists ? 'Update login details, reset a password, or change access without removing transaction history.' : 'Create a dedicated login for POS, orders, payments, and the cashier’s own transaction history.' }}</p></div>
        @if($cashier->exists)<span @class(['badge', 'success' => $cashier->active, 'danger' => ! $cashier->active])>{{ $cashier->active ? 'Account enabled' : 'Account disabled' }}</span>@endif
    </div>
    <div class="cashier-account-sections">
        <form class="panel item-form" action="{{ $cashier->exists ? route('cashiers.update', $cashier) : route('cashiers.store') }}" method="post">
            @csrf @if($cashier->exists)@method('put')@endif
            <fieldset class="form-section"><legend>Cashier details</legend>
                <div class="form-grid">
                    <div><label for="cashier-name">Full name</label><input id="cashier-name" name="name" autocomplete="name" maxlength="100" required value="{{ old('name', $cashier->name) }}" @if($errors->has('name')) aria-invalid="true" @endif></div>
                    <div><label for="cashier-email">Login email</label><input id="cashier-email" name="email" type="email" autocomplete="username" maxlength="255" required value="{{ old('email', $cashier->email) }}" @if($errors->has('email')) aria-invalid="true" @endif><small class="field-help">Use a unique email address for each cashier.</small></div>
                </div>
            </fieldset>
            @unless($cashier->exists)
            <fieldset class="form-section"><legend>Set a password</legend>
                <div class="form-grid">
                    <div><label for="cashier-password">Password</label><input id="cashier-password" name="password" type="password" autocomplete="new-password" minlength="12" maxlength="255" required aria-describedby="cashier-password-help" @if($errors->has('password')) aria-invalid="true" @endif><small class="field-help" id="cashier-password-help">Use at least 12 characters. Give the password privately to the cashier.</small></div>
                    <div><label for="cashier-password-confirmation">Confirm password</label><input id="cashier-password-confirmation" name="password_confirmation" type="password" autocomplete="new-password" minlength="12" maxlength="255" required></div>
                </div>
            </fieldset>
            @endunless
            <div class="form-footer"><a class="button secondary" href="{{ route('cashiers.index') }}">Cancel</a><button class="button primary" type="submit">{{ $cashier->exists ? 'Save cashier details' : 'Create cashier account' }}</button></div>
        </form>
        @if($cashier->exists)
        <form class="panel item-form" action="{{ route('cashiers.password', $cashier) }}" method="post">
            @csrf @method('put')
            <fieldset class="form-section"><legend>Reset password</legend>
                <p class="field-help">This ends the cashier’s current sessions on all devices. They must sign in with the new password.</p>
                <div class="form-grid">
                    <div><label for="reset-password">New password</label><input id="reset-password" name="password" type="password" autocomplete="new-password" minlength="12" maxlength="255" required aria-describedby="reset-password-help" @if($errors->has('password')) aria-invalid="true" @endif><small class="field-help" id="reset-password-help">Use at least 12 characters. Passwords are never shown after saving.</small></div>
                    <div><label for="reset-password-confirmation">Confirm new password</label><input id="reset-password-confirmation" name="password_confirmation" type="password" autocomplete="new-password" minlength="12" maxlength="255" required></div>
                </div>
            </fieldset>
            <div class="form-footer"><button class="button primary" type="submit">Reset password &amp; end sessions</button></div>
        </form>
        <form class="panel item-form" action="{{ route('cashiers.status', $cashier) }}" method="post">
            @csrf @method('patch')
            <fieldset class="form-section"><legend>Account access</legend>
                <p>{{ $cashier->active ? 'Disabling this cashier ends their sessions and prevents sign-in. Past orders, receipts, and stock movements are preserved.' : 'This cashier cannot sign in. Enable the account to restore access to the cashier workspace.' }}</p>
                <input type="hidden" name="active" value="{{ $cashier->active ? '0' : '1' }}">
            </fieldset>
            <div class="form-footer"><button @class(['button', 'danger' => $cashier->active, 'primary' => ! $cashier->active]) type="submit">{{ $cashier->active ? 'Disable cashier account' : 'Enable cashier account' }}</button></div>
        </form>
        @endif
    </div>
</x-layout>
