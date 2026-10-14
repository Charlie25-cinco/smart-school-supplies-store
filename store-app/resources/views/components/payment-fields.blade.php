@props(['amount' => null, 'heading' => false])
<div class="payment-fields" data-payment-fields>
    @if($heading)<h3 class="section-title">Payment</h3>@endif
    <div class="payment-row"><div><label for="payment_method">Payment method</label>
    <select id="payment_method" name="payment_method"><option value="cash" @selected(old('payment_method', 'cash') === 'cash')>Cash</option><option value="gcash" @selected(old('payment_method') === 'gcash')>GCash</option></select>
    </div><div><label for="cash" id="payment-amount-label">Cash received (₱)</label>
    <input id="cash" name="cash" type="number" min="0" max="9999999.99" step="0.01" inputmode="decimal" value="{{ old('cash', $amount) }}" required placeholder="0.00">
    </div></div>
    <div data-gcash-fields @if(old('payment_method') !== 'gcash') hidden @endif>
        <label for="payment_reference">GCash transaction reference</label>
        <input id="payment_reference" name="payment_reference" maxlength="80" minlength="6" pattern="[A-Za-z0-9\-]{6,80}" value="{{ old('payment_reference') }}" autocomplete="off">
        <label class="checkbox-label"><input type="checkbox" name="payment_verified" value="1" @checked(old('payment_verified'))> I verified this payment in the store's GCash account.</label>
        <p class="field-help">Record the exact total received. This system does not contact GCash or verify a screenshot.</p>
    </div>
</div>
