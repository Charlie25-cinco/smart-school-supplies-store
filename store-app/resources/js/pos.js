const app = document.getElementById('pos-app');
if (app) {
    const { products, oldItems } = JSON.parse(document.getElementById('pos-data').textContent);
    const byId = new Map(products.map(product => [String(product.id), product]));
    const cart = new Map();
    const money = value => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(value / 100);
    const node = (tag, className, text) => { const element = document.createElement(tag); if (className) element.className = className; if (text !== undefined) element.textContent = text; return element; };
    const lines = document.getElementById('cart-lines');
    const cash = document.getElementById('cash');
    const complete = document.getElementById('complete-sale');
    const feedback = document.getElementById('checkout-feedback');
    const announce = text => { document.getElementById('cart-announcement').textContent = text; };
    let total = 0;
    let subtotal = 0;
    let submitting = false;
    let filter = 'all';
    const maxQuantity = product => Math.min(999, product.kind === 'product' ? product.stock : 999);
    const fulfillment = document.getElementById('fulfillment');
    const plan = document.getElementById('payment_plan');
    const fee = document.getElementById('delivery_fee');
    const method = document.getElementById('payment_method');
    const orderDialog = document.getElementById('order-details-dialog');
    const detailsButton = document.getElementById('edit-order-details');
    const revealPanel = panel => app.dispatchEvent(new CustomEvent('pos:panel-reveal', { detail: { panel } }));
    const isOrder = () => fulfillment.value !== 'counter';
    const isUnpaid = () => isOrder() && plan.value === 'cod';
    const buttonLabel = () => isOrder() ? 'Confirm order →' : 'Complete sale →';
    const updatePayment = () => {
        const delivery = fulfillment.value === 'delivery';
        const feeValid = !delivery || /^\d{1,5}(\.\d{1,2})?$/.test(fee.value);
        const deliveryFee = delivery && feeValid ? Math.round(Number(fee.value) * 100) : 0;
        total = subtotal + deliveryFee;
        document.getElementById('cart-subtotal').textContent = money(subtotal);
        document.getElementById('cart-fee').textContent = money(deliveryFee);
        document.getElementById('cart-total').textContent = money(total);
        document.getElementById('fee-summary').hidden = !delivery;
        document.getElementById('subtotal-summary').hidden = !isOrder();
        document.getElementById('mobile-basket-total').textContent = money(total);
        const units = [...cart.values()].reduce((sum, quantity) => sum + quantity, 0);
        document.getElementById('basket-count').textContent = `${units} ${units === 1 ? 'item' : 'items'}`;
        document.getElementById('mobile-basket-count').textContent = `Current sale · ${units} ${units === 1 ? 'item' : 'items'}`;
        document.getElementById('pos-switch-count').textContent = String(units);
        document.getElementById('pos-switch-total').textContent = money(total);
        const value = cash.value;
        const valid = /^\d{1,7}(\.\d{1,2})?$/.test(value);
        const received = valid ? Math.round(Number(value) * 100) : 0;
        const gcash = method.value === 'gcash';
        const verified = document.querySelector('[name=payment_verified]').checked;
        const referenceValid = /^[A-Za-z0-9-]{6,80}$/.test(document.getElementById('payment_reference').value.trim());
        const paidValid = valid && received >= total && (!gcash || (received === total && verified && referenceValid));
        document.getElementById('change-row').hidden = isUnpaid() || gcash;
        document.getElementById('cart-change').textContent = money(gcash ? 0 : Math.max(0, received - total));
        complete.disabled = submitting || !cart.size || !feeValid || total > 999999999 || (!isUnpaid() && !paidValid);
        feedback.textContent = !cart.size ? '' : !feeValid ? 'Enter the agreed delivery fee.' : isUnpaid() ? 'Ready to confirm an unpaid order.' : !valid ? 'Enter the payment received.' : received < total ? `${money(total - received)} more needed.` : gcash && !paidValid ? 'Complete the GCash reference and verification.' : 'Payment covers the total.';
    };
    const toggle = (id, visible) => {
        const section = document.getElementById(id);
        section.hidden = !visible;
        section.querySelectorAll('input,select,textarea').forEach(input => { input.disabled = !visible; });
    };
    const syncMode = () => {
        app.dataset.mode = fulfillment.value;
        detailsButton.hidden = !isOrder();
        document.getElementById('order-detail-summary').hidden = !isOrder();
        document.getElementById('collection-note').hidden = !isUnpaid();
        toggle('order-fields', isOrder());
        toggle('delivery-fields', fulfillment.value === 'delivery');
        const paymentFields = document.querySelector('[data-payment-fields]');
        paymentFields.hidden = isUnpaid();
        paymentFields.querySelectorAll('input,select').forEach(input => { input.disabled = isUnpaid(); });
        method.dispatchEvent(new Event('change'));
        const form = document.getElementById('checkout-form');
        form.action = isOrder() ? form.dataset.ordersAction : form.dataset.salesAction;
        complete.textContent = buttonLabel();
        document.getElementById('checkout-note').textContent = isUnpaid() ? 'Available stock excludes confirmed unpaid reservations.' : 'Stock updates once when payment is recorded.';
        updatePayment();
        summarizeDetails();
    };
    const render = () => {
        const focused = document.activeElement?.dataset?.cartControl;
        lines.replaceChildren();
        const inputs = document.getElementById('cart-inputs');
        inputs.replaceChildren();
        subtotal = 0;
        let index = 0;
        cart.forEach((quantity, id) => {
            const product = byId.get(id);
            subtotal += quantity * product.price_cents;
            const row = node('div', 'cart-line');
            const details = node('div', 'cart-details');
            details.append(node('strong', '', product.name), node('small', '', `${money(product.price_cents)} each`));
            const controls = node('div', 'quantity-control');
            const minus = node('button', '', '−'); minus.type = 'button'; minus.setAttribute('aria-label', `Decrease ${product.name}`);
            const quantityInput = node('input'); quantityInput.type = 'number'; quantityInput.min = '1'; quantityInput.max = String(maxQuantity(product)); quantityInput.value = quantity; quantityInput.setAttribute('aria-label', `Quantity of ${product.name}`);
            const plus = node('button', '', '+'); plus.type = 'button'; plus.disabled = quantity >= maxQuantity(product); plus.setAttribute('aria-label', `Increase ${product.name}`);
            const remove = node('button', 'remove-line', 'Remove'); remove.type = 'button'; remove.setAttribute('aria-label', `Remove ${product.name}`);
            [[minus, 'minus'], [quantityInput, 'quantity'], [plus, 'plus'], [remove, 'remove']].forEach(([control, action]) => { control.dataset.cartControl = `${id}-${action}`; });
            minus.addEventListener('click', () => { quantity > 1 ? cart.set(id, quantity - 1) : cart.delete(id); render(); });
            plus.addEventListener('click', () => { cart.set(id, Math.min(maxQuantity(product), quantity + 1)); render(); });
            quantityInput.addEventListener('change', () => { const next = Math.trunc(Number(quantityInput.value)); cart.set(id, Math.max(1, Math.min(maxQuantity(product), next || 1))); render(); });
            remove.addEventListener('click', () => { cart.delete(id); render(); announce(`${product.name} removed.`); });
            controls.append(minus, quantityInput, plus, remove); row.append(details, node('span', 'line-price', money(quantity * product.price_cents)), controls); lines.append(row);
            for (const [field, value] of [['product_id', id], ['quantity', quantity]]) { const input = node('input'); input.type = 'hidden'; input.name = `items[${index}][${field}]`; input.value = value; inputs.append(input); }
            index++;
        });
        document.getElementById('cart-empty').hidden = cart.size > 0;
        document.getElementById('clear-cart').disabled = !cart.size;
        updatePayment();
        if (focused) { const control = [...lines.querySelectorAll('[data-cart-control]')].find(el => el.dataset.cartControl === focused); if (!control) revealPanel('products'); (control || document.getElementById('pos-search')).focus(); }
    };
    document.querySelectorAll('[data-product-id]').forEach(button => button.addEventListener('click', () => {
        const id = button.dataset.productId; const product = byId.get(id); const quantity = cart.get(id) || 0;
        if (quantity >= maxQuantity(product)) { announce(`Available quantity reached for ${product.name}.`); return; }
        cart.set(id, quantity + 1); render(); announce(`${product.name} added. Basket total ${money(total)}.`);
    }));
    const search = () => {
        const value = document.getElementById('pos-search').value.toLowerCase().trim(); let count = 0;
        document.querySelectorAll('[data-product-id]').forEach(button => { const product = byId.get(button.dataset.productId); const visible = (filter === 'all' || product.kind === filter) && `${product.name} ${product.sku} ${product.category}`.toLowerCase().includes(value); button.hidden = !visible; if (visible) count++; });
        document.getElementById('pos-count').textContent = `${count} ${count === 1 ? 'item' : 'items'} available`;
        document.getElementById('pos-empty').hidden = count > 0;
    };
    document.getElementById('pos-search').addEventListener('input', search);
    document.querySelectorAll('[data-pos-filter]').forEach(button => button.addEventListener('click', () => { filter = button.dataset.posFilter; document.querySelectorAll('[data-pos-filter]').forEach(tab => { tab.classList.toggle('active', tab === button); tab.setAttribute('aria-pressed', String(tab === button)); }); search(); }));
    document.getElementById('clear-cart').addEventListener('click', () => { cart.clear(); render(); announce('Basket cleared.'); });
    cash.addEventListener('input', updatePayment);
    method.addEventListener('change', updatePayment);
    document.getElementById('payment_reference').addEventListener('input', updatePayment);
    document.querySelector('[name=payment_verified]').addEventListener('change', updatePayment);
    fulfillment.addEventListener('change', syncMode);
    detailsButton.addEventListener('click', () => { revealPanel('sale'); orderDialog.showModal(); });
    const summarizeDetails = () => {
        const name = document.getElementById('customer_name').value.trim();
        document.getElementById('order-detail-summary').textContent = name ? `${name} · ${isUnpaid() ? 'Payment on collection' : 'Prepaid'}` : 'Add customer details before confirming.';
    };
    document.getElementById('save-order-details').addEventListener('click', () => {
        const invalid = [...orderDialog.querySelectorAll('input,select,textarea')].find(field => field.willValidate && !field.validity.valid);
        if (invalid) { invalid.reportValidity(); return; }
        orderDialog.close(); summarizeDetails();
    });
    orderDialog.addEventListener('close', () => {
        summarizeDetails();
        // The customer-details trigger lives in Products, which may now be hidden.
        if (detailsButton.closest('[hidden]')) document.getElementById('pos-sale-tab').focus({ preventScroll: true });
    });
    document.getElementById('checkout-form').addEventListener('invalid', event => {
        revealPanel('sale');
        if (orderDialog.contains(event.target) && !orderDialog.open) {
            event.preventDefault(); orderDialog.showModal();
            requestAnimationFrame(() => event.target.focus());
        }
    }, true);
    plan.addEventListener('change', syncMode);
    fee.addEventListener('input', updatePayment);
    document.getElementById('checkout-form').addEventListener('submit', event => { if (complete.disabled) { event.preventDefault(); return; } submitting = true; complete.disabled = true; complete.textContent = isOrder() ? 'Confirming order…' : 'Recording sale…'; });
    window.addEventListener('pageshow', event => {
        // A restored checkout must not reuse a completed request for a new sale.
        const historyNavigation = performance.getEntriesByType('navigation')[0]?.type === 'back_forward';
        if ((event.persisted && submitting) || historyNavigation) { window.location.reload(); return; }
        submitting = false; complete.textContent = buttonLabel(); updatePayment();
    });
    Object.values(oldItems || {}).forEach(item => { const id = String(item.product_id); const product = byId.get(id); if (product && maxQuantity(product) > 0) cart.set(id, Math.max(1, Math.min(maxQuantity(product), Number(item.quantity) || 1))); });
    syncMode(); summarizeDetails(); render(); search();
}
