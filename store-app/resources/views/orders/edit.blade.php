<x-layout :title="'Edit '.$order->number()">
    <div class="page-heading"><div><a class="text-link" href="{{ route('orders.show', $order) }}"><x-icon name="back" :size="18" /> Back to order</a><h1>Edit {{ $order->number() }}</h1><p>{{ ucfirst($order->fulfillment) }} · {{ $order->statusLabel() }} · {{ $order->sale_id ? 'Paid — correct customer details and notes.' : 'Unpaid — review details, items and the agreed fee.' }}</p></div></div>
    @if($errors->has('edit_token'))<p class="notice warning"><a class="text-link" href="{{ route('orders.edit', $order) }}">Reload the latest order before editing again →</a></p>@endif
    <form action="{{ route('orders.update', $order) }}" method="post" id="order-edit-form" data-order-edit data-unpaid="{{ $order->sale_id ? '0' : '1' }}">@csrf @method('PUT')
        <input type="hidden" name="edit_token" value="{{ old('edit_token', $editToken) }}">
        <div class="order-layout">
            <div>
                <section class="panel"><div class="panel-heading"><h2>Customer & delivery</h2></div><div class="item-form">
                    <div class="form-grid"><div><label for="edit-customer">Customer name</label><input id="edit-customer" name="customer_name" maxlength="100" required autocomplete="off" value="{{ old('customer_name', $order->customer_name) }}"></div><div><label for="edit-phone">Contact number</label><input id="edit-phone" name="customer_phone" type="tel" maxlength="30" required autocomplete="off" value="{{ old('customer_phone', $order->customer_phone) }}"></div></div>
                    @if($order->fulfillment === 'delivery')<label class="edit-field-label" for="edit-address">Delivery address</label><textarea id="edit-address" name="delivery_address" rows="2" maxlength="300" required autocomplete="off">{{ old('delivery_address', $order->delivery_address) }}</textarea>@endif
                    <label class="edit-field-label" for="edit-notes">Preparation / delivery notes</label><textarea id="edit-notes" name="notes" rows="2" maxlength="500">{{ old('notes', $order->notes) }}</textarea>
                </div></section>
                <section class="panel"><div class="panel-heading"><div><h2>Order items</h2><p>{{ $order->sale_id ? 'Paid items and prices are fixed.' : 'Retained items keep their agreed prices. New items use current prices.' }}</p></div></div>
                    @if($order->sale_id)
                    <div class="table-wrap" tabindex="0" role="region" aria-label="Paid order items"><table><thead><tr><th>Item</th><th>Quantity</th><th>Amount</th></tr></thead><tbody>@foreach($order->items as $line)<tr><td>{{ $line->name }}</td><td>{{ $line->quantity }}</td><td class="money">{{ \App\Support\Money::format($line->total_cents) }}</td></tr>@endforeach</tbody></table></div>
                    @else
                    @php
                        $snapshots = $order->items->keyBy('product_id');
                        $choices = $products->keyBy('id');
                        $submitted = old('items', $order->items->map->only(['product_id', 'quantity'])->all());
                        $submitted = is_array($submitted) ? array_values($submitted) : $order->items->map->only(['product_id', 'quantity'])->all();
                    @endphp
                    <div id="edit-order-lines">@foreach($submitted as $index => $line)
                        @php
                            $productId = is_array($line) && is_scalar($line['product_id'] ?? null) ? (string) $line['product_id'] : '';
                            $quantity = is_array($line) && is_scalar($line['quantity'] ?? null) ? (string) $line['quantity'] : '';
                            $snapshot = $snapshots->get($productId) ?? $choices->get($productId);
                            $name = $snapshot?->name ?? 'Unavailable item';
                        @endphp
                        <div class="order-edit-line" data-order-line data-product-id="{{ $productId }}" data-price="{{ $snapshot?->price_cents ?? 0 }}"><div><strong>{{ $name }}</strong><small class="cell-sub">{{ $snapshot ? \App\Support\Money::format($snapshot->price_cents).' each' : 'Remove this item and select an available item.' }}</small></div><div><label for="edit-qty-{{ $index }}">Quantity</label><input id="edit-qty-{{ $index }}" name="items[{{ $index }}][quantity]" type="number" min="1" max="999" required value="{{ $quantity }}" aria-label="Quantity of {{ $name }}"><input type="hidden" name="items[{{ $index }}][product_id]" value="{{ $productId }}"></div><button type="button" class="text-button remove-edit-line" aria-label="Remove {{ $name }} from order">Remove</button></div>
                    @endforeach</div>
                    <p id="edit-items-empty" class="empty" hidden>Add at least one item before saving.</p>
                    <div class="item-picker"><div><label for="edit-item-picker">Add an item</label><select id="edit-item-picker"><option value="">Choose a supply or service</option>@foreach($products->where('active', true) as $product)<option value="{{ $product->id }}">{{ $product->name }} · {{ \App\Support\Money::format($product->price_cents) }}</option>@endforeach</select></div><button type="button" class="button secondary" id="add-order-item">Add item <x-icon name="plus" :size="18" /></button></div>
                    @endif
                </section>
            </div>
            <aside class="order-edit-aside"><section class="panel"><div class="panel-heading"><h2>Review changes</h2></div>
                @if(!$order->sale_id && $order->fulfillment === 'delivery')<div class="order-actions"><label for="edit-fee">Delivery fee (₱)</label><input id="edit-fee" name="delivery_fee" type="number" min="0" max="99999.99" step="0.01" required value="{{ old('delivery_fee', number_format($order->delivery_fee_cents / 100, 2, '.', '')) }}"><small class="field-help">Use the fee agreed with the customer.</small></div>@endif
                <div class="order-summary"><div class="checkout-breakdown"><span>Items subtotal</span><strong id="edit-subtotal">{{ \App\Support\Money::format($order->subtotal_cents) }}</strong></div><div class="checkout-breakdown"><span>Delivery fee</span><strong id="edit-fee-total">{{ \App\Support\Money::format($order->delivery_fee_cents) }}</strong></div><div class="total-row"><span>Order total</span><strong id="edit-total">{{ \App\Support\Money::format($order->total_cents) }}</strong></div><p class="field-help">{{ $order->sale_id ? 'Payment, items and fees stay fixed. Customer corrections do not change the paid receipt.' : 'Saving updates reserved quantities. Payment is still collected separately.' }}</p></div>
                <div class="order-actions"><p id="edit-announcement" class="field-help" role="status"></p><button type="submit" class="button primary full" id="save-order-changes">Save changes</button><a class="button secondary full edit-cancel" href="{{ route('orders.show', $order) }}">Cancel editing</a></div>
            </section></aside>
        </div>
    </form>
    @if(!$order->sale_id)<script type="application/json" id="order-edit-data">{!! json_encode($products->map(fn ($product) => $product->only(['id', 'name', 'price_cents', 'active'])), JSON_HEX_TAG | JSON_HEX_APOS | JSON_HEX_AMP | JSON_HEX_QUOT) !!}</script>@endif
</x-layout>
