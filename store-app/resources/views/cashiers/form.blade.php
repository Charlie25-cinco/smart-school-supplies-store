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
                    <div><label for="cashier-username">Username</label><input id="cashier-username" name="username" maxlength="40" pattern="[A-Za-z0-9\-]{3,40}" required value="{{ old('username', $cashier->username) }}" @if($errors->has('username')) aria-invalid="true" @endif><small class="field-help">Letters, numbers, and hyphens, 3–40 characters. Used for sign-in.</small></div>
                </div>
            </fieldset>
            @unless($cashier->exists)
            <fieldset class="form-section"><legend>Set a password</legend>
                <div class="form-grid">
                    <div><label for="cashier-password">Password</label><input id="cashier-password" name="password" type="password" autocomplete="new-password" minlength="12" maxlength="255" required aria-describedby="cashier-password-help" @if($errors->has('password')) aria-invalid="true" @endif><small class="field-help" id="cashier-password-help">Use at least 12 characters; mixing uppercase, lowercase, numbers, and symbols is encouraged. Give the password privately to the cashier.</small></div>
                    <div><label for="cashier-password-confirmation">Confirm password</label><input id="cashier-password-confirmation" name="password_confirmation" type="password" autocomplete="new-password" minlength="12" maxlength="255" required></div>
                </div>
            </fieldset>
            @endunless
            <div class="form-footer"><a class="button secondary" href="{{ route('cashiers.index') }}">Cancel</a><button class="button primary" type="submit">{{ $cashier->exists ? 'Save cashier details' : 'Create cashier account' }}</button></div>
        </form>
        @if($cashier->exists)
        <form class="panel item-form" id="reset-password-form" action="{{ route('cashiers.password', $cashier) }}" method="post">
            @csrf @method('put')
            <fieldset class="form-section"><legend>Reset password</legend>
                <p class="field-help">This ends the cashier’s current sessions on all devices. They must sign in with the new password.</p>
                <div class="form-grid">
                    <div><label for="reset-password">New password</label><input id="reset-password" name="password" type="password" autocomplete="new-password" minlength="12" maxlength="255" required aria-describedby="reset-password-help" @if($errors->has('password')) aria-invalid="true" @endif><small class="field-help" id="reset-password-help">Use at least 12 characters; mixing uppercase, lowercase, numbers, and symbols is encouraged. Passwords are never shown after saving.</small></div>
                    <div><label for="reset-password-confirmation">Confirm new password</label><input id="reset-password-confirmation" name="password_confirmation" type="password" autocomplete="new-password" minlength="12" maxlength="255" required></div>
                </div>
            </fieldset>
            <div class="form-footer"><button class="button primary" type="button" data-modal-open="confirm-reset-password">Reset password &amp; end sessions</button></div>
        </form>
        <dialog id="confirm-reset-password" aria-labelledby="confirm-reset-password-title"><div class="dialog-heading"><h2 id="confirm-reset-password-title">Reset this cashier’s password?</h2><button type="button" class="icon-button" data-modal-close aria-label="Close password reset confirmation"><x-icon name="close" :size="20" /></button></div><p>The cashier is signed out everywhere and must use the new password. This cannot be undone; a new reset is required to change it again.</p><div class="form-footer"><button type="button" class="button secondary" data-modal-close>Keep current password</button><button type="submit" form="reset-password-form" class="button danger">Reset password &amp; end sessions</button></div></dialog>
        <form class="panel item-form" id="cashier-status-form" action="{{ route('cashiers.status', $cashier) }}" method="post">
            @csrf @method('patch')
            <fieldset class="form-section"><legend>Account access</legend>
                <p>{{ $cashier->active ? 'Disabling this cashier ends their sessions and prevents sign-in. Past orders, receipts, and stock movements are preserved.' : 'This cashier cannot sign in. Enable the account to restore access to the cashier workspace.' }}</p>
                <input type="hidden" name="active" value="{{ $cashier->active ? '0' : '1' }}">
            </fieldset>
            <div class="form-footer"><button @class(['button', 'danger' => $cashier->active, 'primary' => ! $cashier->active]) type="button" data-modal-open="confirm-cashier-status">{{ $cashier->active ? 'Disable cashier account' : 'Enable cashier account' }}</button></div>
        </form>
        <dialog id="confirm-cashier-status" aria-labelledby="confirm-cashier-status-title"><div class="dialog-heading"><h2 id="confirm-cashier-status-title">{{ $cashier->active ? 'Disable this cashier account?' : 'Enable this cashier account?' }}</h2><button type="button" class="icon-button" data-modal-close aria-label="Close account access confirmation"><x-icon name="close" :size="20" /></button></div><p>{{ $cashier->active ? 'The cashier is signed out everywhere and cannot sign in again. Transaction history is preserved.' : 'The cashier can sign in again with their existing password.' }}</p><div class="form-footer"><button type="button" class="button secondary" data-modal-close>Cancel</button><button type="submit" form="cashier-status-form" @class(['button', 'danger' => $cashier->active, 'primary' => ! $cashier->active])>{{ $cashier->active ? 'Disable cashier account' : 'Enable cashier account' }}</button></div></dialog>
        @endif
    </div>
</x-layout>
