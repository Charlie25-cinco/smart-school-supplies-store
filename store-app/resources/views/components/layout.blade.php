@props(['title', 'eyebrow' => 'Store workspace'])
<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="light"><title>{{ $title }} · Smart School Supplies</title>
    <link rel="icon" type="image/png" href="{{ asset('brand/logo.png') }}">
    @vite(['resources/css/app.css', 'resources/js/app.js'])
</head>
<body>
<a class="skip-link" href="#main">Skip to main content</a>
<div class="workspace">
    <aside class="sidebar no-print">
        <x-brand />
        <p class="nav-label">YOUR STORE</p>
        <nav aria-label="Store navigation">
            @if(auth()->user()->role === 'owner')
            <a href="{{ route('dashboard') }}" @class(['nav-link', 'current' => request()->routeIs('dashboard')]) @if(request()->routeIs('dashboard')) aria-current="page" @endif><x-icon name="overview" /> Overview</a>
            @endif
            <a href="{{ route('pos') }}" @class(['nav-link', 'current' => request()->routeIs('pos')]) @if(request()->routeIs('pos')) aria-current="page" @endif><x-icon name="pos" /> Point of sale</a>
            <a href="{{ route('orders.index') }}" @class(['nav-link', 'current' => request()->routeIs('orders.*')]) @if(request()->routeIs('orders.*')) aria-current="page" @endif><x-icon name="delivery" /> Orders & delivery</a>
            @if(auth()->user()->role === 'owner')
            <a href="{{ route('inventory') }}" @class(['nav-link', 'current' => request()->routeIs('inventory*')]) @if(request()->routeIs('inventory*')) aria-current="page" @endif><x-icon name="inventory" /> Inventory</a>
            @endif
            <a href="{{ route('sales') }}" @class(['nav-link', 'current' => request()->routeIs('sales', 'receipt')]) @if(request()->routeIs('sales', 'receipt')) aria-current="page" @endif><x-icon name="sales" /> Sales & receipts</a>
        </nav>
        <div class="sidebar-note"><span class="status-dot"></span> Local store workspace<p>Orders from Messenger are entered by staff after confirmation.</p></div>
        <div class="profile"><span class="avatar" aria-hidden="true">{{ mb_substr(auth()->user()->name, 0, 1) }}</span><div><strong>{{ auth()->user()->name }}</strong><small>{{ ucfirst(auth()->user()->role) }}</small></div></div>
        <form action="{{ route('logout') }}" method="post">@csrf<button class="signout" type="submit">Sign out <x-icon name="logout" /></button></form>
    </aside>
    <div class="workspace-body">
        <header class="topbar no-print"><div class="topbar-context"><span>{{ $eyebrow }}</span><x-icon name="arrow" :size="16" /><strong>{{ $title }}</strong></div><div>@if(config('store.demo'))<span class="badge demo">Sample data</span>@endif <time datetime="{{ now()->toDateString() }}">{{ now()->format('D, M j, Y') }}</time></div></header>
        <main id="main" class="main" tabindex="-1">
            @if(session('success'))<div class="notice success" role="status">{{ session('success') }}</div>@endif
            @if($errors->any())<div class="notice error" role="alert"><strong>Please check the following:</strong><ul>@foreach($errors->all() as $error)<li>{{ $error }}</li>@endforeach</ul></div>@endif
            {{ $slot }}
        </main>
    </div>
</div>
</body>
</html>
