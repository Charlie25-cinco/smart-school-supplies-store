document.querySelectorAll('[data-payment-fields]').forEach(fields => {
    const method = fields.querySelector('[name=payment_method]');
    const gcash = fields.querySelector('[data-gcash-fields]');
    const update = () => {
        const active = method.value === 'gcash' && !fields.hidden;
        gcash.hidden = !active;
        gcash.querySelectorAll('input').forEach(input => { input.disabled = !active; input.required = active; });
        fields.querySelector('#payment-amount-label').textContent = method.value === 'gcash' ? 'Verified GCash amount (₱)' : 'Cash received (₱)';
    };
    method.addEventListener('change', update);
    const reference = gcash.querySelector('[name=payment_reference]');
    reference.addEventListener('blur', () => {
        reference.value = reference.value.trim().toUpperCase();
        reference.dispatchEvent(new Event('input', { bubbles: true }));
    });
    update();
});
