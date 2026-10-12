<a href="{{ auth()->check() ? route('pos') : route('login') }}" class="brand" aria-label="Smart School Supplies home">
    <span class="brand-emblem"><img src="{{ asset('brand/logo.png') }}" alt="" width="1024" height="1024"></span>
    <span class="brand-name">Smart<span class="brand-sub">SCHOOL SUPPLIES</span></span>
</a>
