@props(['name', 'size' => 24])
<svg {{ $attributes->class(['ui-icon']) }} width="{{ $size }}" height="{{ $size }}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
    @switch($name)
        @case('overview')<path d="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z"/>@break
        @case('pos')<rect x="3" y="3" width="18" height="13" rx="2"/><path d="M8 21h8M12 16v5M7 8h4M7 11h7"/>@break
        @case('delivery')<path d="M3 6h11v12H3zM14 10h4l3 4v4h-7M3 10h6"/><circle cx="7" cy="19" r="2"/><circle cx="18" cy="19" r="2"/>@break
        @case('inventory')<path d="m12 3 9 5-9 5-9-5 9-5ZM3 8v9l9 5 9-5V8M12 13v9M7.5 5.5l9 5"/>@break
        @case('sales')<path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3ZM9 7h6M9 11h6M9 15h3"/>@break
        @case('logout')<path d="M9 4H4v16h5M14 8l4 4-4 4M8 12h10"/>@break
        @case('search')<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>@break
        @case('plus')<path d="M12 5v14M5 12h14"/>@break
        @case('arrow')<path d="M4 12h16M14 6l6 6-6 6"/>@break
        @case('back')<path d="M20 12H4M10 6l-6 6 6 6"/>@break
        @case('close')<path d="m6 6 12 12M6 18 18 6"/>@break
        @case('check')<path d="m5 12 4 4L19 6"/>@break
        @case('basket')<path d="m8 9 4-6 4 6M3 9h18l-2 12H5L3 9ZM9 13v4M15 13v4"/>@break
        @case('service')<path d="M7 8V3h10v5M7 17H4V8h16v9h-3M7 14h10v7H7zM16 11h1"/>@break
        @case('product')<path d="M5 3h14v18H5zM8 3v18M11 7h5M11 11h5"/>@break
        @case('cash')<rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M6 12h.01M18 12h.01"/>@break
        @case('phone')<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>@break
    @endswitch
</svg>
