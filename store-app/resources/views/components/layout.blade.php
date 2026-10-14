@props(['title', 'eyebrow' => 'Store workspace'])
<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="light"><title>{{ $title }} · Smart School Supplies</title>
    <link rel="icon" type="image/png" href="{{ asset('brand/logo.png') }}">
    @vite(['resources/css/app.css', 'resources/js/app.js'])
</head>
<body data-workspace-role="{{ auth()->user()->role }}">
<a class="skip-link" href="#main">Skip to main content</a>
<div class="workspace">
    <aside class="sidebar no-print">
        <x-brand />
        <p class="nav-label">{{ auth()->user()->roleLabel() }} WORKSPACE</p>
        <nav id="store-navigation" aria-label="Store navigation">
            @if(auth()->user()->isAdmin())
            <a href="{{ route('dashboard') }}" @class(['nav-link', 'current' => request()->routeIs('dashboard')]) @if(request()->routeIs('dashboard')) aria-current="page" @endif><x-icon name="overview" /> Overview</a>
            <a href="{{ route('inventory') }}" @class(['nav-link', 'current' => request()->routeIs('inventory*')]) @if(request()->routeIs('inventory*')) aria-current="page" @endif><x-icon name="inventory" /> Inventory</a>
            <a href="{{ route('cashiers.index') }}" @class(['nav-link', 'current' => request()->routeIs('cashiers.*')]) @if(request()->routeIs('cashiers.*')) aria-current="page" @endif><x-icon name="pos" /> Cashier accounts</a>
            @else
            <a href="{{ route('pos') }}" @class(['nav-link', 'current' => request()->routeIs('pos')]) @if(request()->routeIs('pos')) aria-current="page" @endif><x-icon name="pos" /> Point of sale</a>
            @endif
            <a href="{{ route('orders.index') }}" @class(['nav-link', 'current' => request()->routeIs('orders.*')]) @if(request()->routeIs('orders.*')) aria-current="page" @endif><x-icon name="delivery" /> {{ auth()->user()->isAdmin() ? 'Orders review' : 'Orders & delivery' }}</a>
            <a href="{{ route('sales') }}" @class(['nav-link', 'current' => request()->routeIs('sales', 'receipt')]) @if(request()->routeIs('sales', 'receipt')) aria-current="page" @endif><x-icon name="sales" /> {{ auth()->user()->isAdmin() ? 'Sales reports' : 'My sales & receipts' }}</a>
        </nav>
        <div class="sidebar-note"><span class="status-dot"></span> Local store workspace<p>{{ auth()->user()->isAdmin() ? 'Manage stock, cashier access, and store reports.' : 'Accept orders, record payments, and complete handovers.' }}</p></div>
        <div class="profile"><span class="avatar" aria-hidden="true">{{ mb_substr(auth()->user()->name, 0, 1) }}</span><div><strong>{{ auth()->user()->name }}</strong><small>{{ auth()->user()->roleLabel() }}</small></div></div>
        <form action="{{ route('logout') }}" method="post">@csrf<button class="signout" type="submit">Sign out <x-icon name="logout" /></button></form>
    </aside>
    <div class="workspace-body">
        <header class="topbar no-print"><button type="button" class="workspace-menu-button" id="workspace-menu-open" aria-controls="workspace-menu" aria-haspopup="dialog" aria-expanded="false" hidden><svg class="ui-icon" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" /></svg><span>Menu</span></button><div class="topbar-context"><span>{{ auth()->user()->roleLabel() }} workspace</span><x-icon name="arrow" :size="16" /><strong>{{ $title }}</strong></div><div class="topbar-meta">@if(config('store.demo'))<span class="badge demo">Sample data</span>@endif <time datetime="{{ now()->toDateString() }}">{{ now()->format('D, M j, Y') }}</time></div></header>
        <main id="main" class="main" tabindex="-1">
            @if(session('success'))<div class="notice success" role="status">{{ session('success') }}</div>@endif
            @if($errors->any())<div class="notice error" role="alert"><strong>Please check the following:</strong><ul>@foreach($errors->all() as $error)<li>{{ $error }}</li>@endforeach</ul></div>@endif
            {{ $slot }}
        </main>
    </div>
</div>
<dialog id="workspace-menu" class="workspace-menu no-print" aria-labelledby="workspace-menu-title"><div class="dialog-heading"><div><span class="eyebrow">{{ auth()->user()->roleLabel() }} WORKSPACE</span><h2 id="workspace-menu-title">Store menu</h2></div><button type="button" class="icon-button" id="workspace-menu-close" aria-label="Close store menu"><x-icon name="close" :size="20" /></button></div><div id="mobile-store-navigation"></div><div class="profile"><span class="avatar" aria-hidden="true">{{ mb_substr(auth()->user()->name, 0, 1) }}</span><div><strong>{{ auth()->user()->name }}</strong><small>{{ auth()->user()->roleLabel() }}</small></div></div><form action="{{ route('logout') }}" method="post">@csrf<button class="signout" type="submit">Sign out <x-icon name="logout" /></button></form></dialog>
</body>
</html>
