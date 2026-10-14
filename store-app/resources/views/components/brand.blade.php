<a href="{{ auth()->check() ? route(auth()->user()->isAdmin() ? 'dashboard' : 'pos') : route('login') }}" class="brand" aria-label="Smart School Supplies home">
    <span class="brand-emblem"><img src="{{ asset('brand/logo.png') }}" alt="" width="213" height="184"></span>
    <span class="brand-name">Smart<span class="brand-sub">SCHOOL SUPPLIES</span></span>
</a>
