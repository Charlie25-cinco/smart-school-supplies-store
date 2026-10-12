<x-layout title="Point of sale">
    <div class="page-heading"><div><span class="eyebrow">CHECKOUT</span><h1>Point of sale</h1><p>Sell at the counter or prepare a confirmed pickup/delivery order.</p></div><a class="button secondary" href="{{ route('orders.index') }}">View orders <x-icon name="arrow" :size="18" /></a></div>
    <div class="pos-layout" id="pos-app">
        <section class="pos-products"><div class="search-row"><label class="search-field"><span class="sr-only">Search products or SKU</span><x-icon name="search" /><input id="pos-search" type="search" placeholder="Search products or SKU…" autocomplete="off"></label></div>
            <div class="filter-tabs" role="group" aria-label="Item type"><button class="tab active" type="button" data-pos-filter="all" aria-pressed="true">All items</button><button class="tab" type="button" data-pos-filter="product" aria-pressed="false">Supplies</button><button class="tab" type="button" data-pos-filter="service" aria-pressed="false">Services</button></div>
            <p class="result-count" id="pos-count" role="status"></p>
            <div class="pos-grid" id="pos-products" tabindex="0" role="region" aria-label="Available products">
                @foreach($products as $product)<button type="button" class="pos-card" data-product-id="{{ $product->id }}" @disabled($product->kind === 'product' && $product->available() <= 0)>
                    <span class="product-kind"><span class="item-symbol {{ $product->kind === 'service' ? 'service-symbol' : '' }}"><x-icon :name="$product->kind === 'service' ? 'service' : 'product'" /></span><small>{{ $product->category }}</small></span><strong>{{ $product->name }}</strong><span class="pos-price">{{ \App\Support\Money::format($product->price_cents) }}</span><span @class(['pos-stock', 'stock-alert' => $product->kind === 'product' && $product->available() <= $product->reorder_level])>{{ $product->kind === 'service' ? 'Service charge' : ($product->available() <= 0 ? 'Unavailable · sold or reserved' : $product->available().' available') }}</span><span class="add-symbol"><x-icon name="plus" :size="20" /></span>
                </button>@endforeach
            </div><div class="empty" id="pos-empty" hidden><h2>No items found.</h2><p>Try a different search or filter.</p></div>
        </section>
        <section class="panel checkout-panel" id="checkout-basket" tabindex="-1" aria-labelledby="basket-heading"><div class="panel-heading"><div class="basket-title"><h2 id="basket-heading">Customer's basket</h2><span class="basket-count" id="basket-count">0 items</span></div><button type="button" class="text-button" id="clear-cart">Clear</button></div>
            <form id="checkout-form" action="{{ route('sales.store') }}" data-sales-action="{{ route('sales.store') }}" data-orders-action="{{ route('orders.store') }}" method="post">@csrf
                <input type="hidden" name="reference" value="{{ old('reference', $reference) }}">
                <div class="checkout-scroll" tabindex="0" role="region" aria-label="Basket items and checkout details">
                <div id="cart-lines" class="cart-lines"></div><div id="cart-empty" class="empty"><div class="basket-empty-message"><x-icon name="basket" :size="32" /><div><h3>Your basket is empty</h3><p>Select a product or service to begin.</p></div></div></div>
                <div id="cart-inputs"></div>
                <div class="checkout-summary">
                    <h3 class="section-title">Sale details</h3><div class="checkout-options"><div><label for="fulfillment">Fulfillment</label><select id="fulfillment" name="fulfillment"><option value="counter" @selected(old('fulfillment', $fulfillment) === 'counter')>Counter sale</option><option value="pickup" @selected(old('fulfillment', $fulfillment) === 'pickup')>Store pickup</option><option value="delivery" @selected(old('fulfillment', $fulfillment) === 'delivery')>Delivery</option></select></div>
                    <div><label for="channel">Order channel</label><select id="channel" name="channel"><option value="walk-in" @selected(old('channel') === 'walk-in')>Walk-in</option><option value="messenger" @selected(old('channel') === 'messenger')>Messenger (confirmed)</option></select></div></div>
                    <div id="order-fields" hidden><h3 class="section-title">Customer & fulfillment</h3>
                        <label for="customer_name">Customer name</label><input id="customer_name" name="customer_name" maxlength="100" required value="{{ old('customer_name') }}" autocomplete="off">
                        <label for="customer_phone">Contact number</label><input id="customer_phone" name="customer_phone" type="tel" maxlength="30" required value="{{ old('customer_phone') }}" autocomplete="off">
                        <div id="delivery-fields" hidden><label for="delivery_address">Delivery address</label><textarea id="delivery_address" name="delivery_address" maxlength="300" rows="2" required autocomplete="off">{{ old('delivery_address') }}</textarea><label for="delivery_fee">Delivery fee (₱)</label><input id="delivery_fee" name="delivery_fee" type="number" min="0" max="99999.99" step="0.01" required value="{{ old('delivery_fee', '0.00') }}"><small class="field-help">Enter the fee agreed with the customer; no automatic distance pricing.</small></div>
                        <label for="notes">Preparation / delivery notes</label><textarea id="notes" name="notes" maxlength="500" rows="2" placeholder="e.g. 10 A4 pages, single-sided; call on arrival">{{ old('notes') }}</textarea>
                        <label for="payment_plan">When is payment collected?</label><select id="payment_plan" name="payment_plan"><option value="prepaid" @selected(old('payment_plan', 'prepaid') === 'prepaid')>Prepaid · record payment now</option><option value="cod" @selected(old('payment_plan') === 'cod')>On delivery / pickup · unpaid now</option></select>
                    </div>
                    <x-payment-fields :heading="true" />
                </div></div>
                <div class="checkout-footer">
                    <div class="checkout-breakdown"><span>Items subtotal</span><strong id="cart-subtotal">₱0.00</strong></div><div class="checkout-breakdown" id="fee-summary" hidden><span>Delivery fee</span><strong id="cart-fee">₱0.00</strong></div>
                    <div class="total-row"><span>Total due</span><strong id="cart-total">₱0.00</strong></div>
                    <div class="change-row" id="change-row"><span>Change</span><strong id="cart-change">₱0.00</strong></div><p id="checkout-feedback" class="muted" role="status"></p>
                    <button type="submit" id="complete-sale" class="button primary full" disabled>Complete sale →</button><p class="checkout-note" id="checkout-note">Stock updates when the paid sale completes.</p>
                </div>
            </form><p id="cart-announcement" class="sr-only" aria-live="polite"></p>
        </section>
    </div>
    <a class="mobile-basket-bar button primary no-print" href="#checkout-basket"><span id="mobile-basket-count">Basket · 0 items</span><strong id="mobile-basket-total">₱0.00</strong><span aria-hidden="true">↓</span></a>
    <script type="application/json" id="pos-data">{!! json_encode(['products' => $products->map(fn ($product) => [...$product->only(['id', 'sku', 'name', 'category', 'kind', 'price_cents']), 'stock' => $product->available()]), 'oldItems' => old('items', [])], JSON_HEX_TAG | JSON_HEX_APOS | JSON_HEX_AMP | JSON_HEX_QUOT) !!}</script>
</x-layout>
