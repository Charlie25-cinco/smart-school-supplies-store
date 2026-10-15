<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Staff sign in · Smart School Supplies</title><link rel="icon" type="image/png" href="{{ asset('brand/logo.png') }}">@vite(['resources/css/app.css', 'resources/js/app.js'])</head>
<body class="login-page">
<a class="skip-link" href="#main">Skip to sign in</a>
<main id="main" class="login-shell">
    <section class="login-story"><x-brand /><div><span class="eyebrow">SMART SCHOOL SUPPLIES</span><h1>Your store,<br><em>in order.</em></h1><p>Dedicated access for daily sales and store management.</p><div class="login-features"><div class="login-feature"><x-icon name="pos" /> Counter sales & payments</div><div class="login-feature"><x-icon name="inventory" /> Inventory & supply usage</div><div class="login-feature"><x-icon name="delivery" /> Pickup & delivery orders</div></div></div><span class="login-foot">School essentials. Organized operations.</span></section>
    <section class="login-form"><span class="eyebrow">STORE WORKSPACE</span><h2>Staff sign in</h2><p class="muted">Sign in to your Admin or Cashier workspace.</p>
        @if($errors->any())<div class="notice error" role="alert">{{ $errors->first() }}</div>@endif
        @if(config('store.demo'))<p class="badge demo">Defense prototype · sample products and prices</p>@endif
        <form action="{{ url('/login') }}" method="post" class="form-stack">@csrf
            <label for="login">Username</label><input id="login" name="login" maxlength="40" value="{{ old('login') }}" required autocomplete="username" autofocus>
            <label for="password">Password</label><input id="password" type="password" name="password" required autocomplete="current-password">
            <button type="submit" class="button primary full">Sign in <span aria-hidden="true">→</span></button>
        </form>
        <p class="login-help">Staff access only. Ask the Admin if you need a cashier account.</p>
    </section>
</main>
</body>
</html>
