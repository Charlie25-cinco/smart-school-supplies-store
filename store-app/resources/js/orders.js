const editForm = document.querySelector('[data-order-edit]');
if (editForm) {
    const save = document.getElementById('save-order-changes');
    if (editForm.dataset.unpaid === '1') {
        const products = new Map(JSON.parse(document.getElementById('order-edit-data').textContent).map(product => [String(product.id), product]));
        const lines = document.getElementById('edit-order-lines');
        const picker = document.getElementById('edit-item-picker');
        const add = document.getElementById('add-order-item');
        const fee = document.getElementById('edit-fee');
        const announcement = document.getElementById('edit-announcement');
        const money = value => new Intl.NumberFormat('en-PH', {style:'currency',currency:'PHP'}).format(value / 100);
        let nextIndex = lines.children.length;
        const refresh = () => {
            const rows = [...lines.querySelectorAll('[data-order-line]')];
            const selected = new Set(rows.map(row => row.dataset.productId));
            [...picker.options].forEach(option => { if (option.value) option.disabled = selected.has(option.value); });
            if (selected.has(picker.value)) picker.value = '';
            add.disabled = !picker.value || rows.length >= 100;
            save.disabled = !rows.length;
            document.getElementById('edit-items-empty').hidden = rows.length > 0;
            const subtotal = rows.reduce((sum,row) => sum + Number(row.dataset.price) * (Math.max(0, Number(row.querySelector('[type=number]').value)) || 0), 0);
            const feeCents = fee && /^\d{1,5}(\.\d{1,2})?$/.test(fee.value) ? Math.round(Number(fee.value) * 100) : 0;
            document.getElementById('edit-subtotal').textContent = money(subtotal);
            document.getElementById('edit-fee-total').textContent = money(feeCents);
            document.getElementById('edit-total').textContent = money(subtotal + feeCents);
        };
        lines.addEventListener('input', refresh);
        lines.addEventListener('click', event => {
            const remove = event.target.closest('.remove-edit-line');
            if (!remove) return;
            const row = remove.closest('[data-order-line]');
            const name = row.querySelector('strong').textContent;
            row.remove(); refresh(); picker.focus(); announcement.textContent = `${name} removed from these changes. Save to update the order.`;
        });
        picker.addEventListener('change', refresh);
        fee?.addEventListener('input', refresh);
        add.addEventListener('click', () => {
            const product = products.get(picker.value);
            if (!product || add.disabled) return;
            const row = document.createElement('div'); row.className = 'order-edit-line'; row.dataset.orderLine = ''; row.dataset.productId = String(product.id); row.dataset.price = String(product.price_cents);
            const details = document.createElement('div'); const title = document.createElement('strong'); title.textContent = product.name; const price = document.createElement('small'); price.className = 'cell-sub'; price.textContent = `${money(product.price_cents)} each`; details.append(title,price);
            const controls = document.createElement('div'); const label = document.createElement('label'); label.htmlFor = `edit-qty-${nextIndex}`; label.textContent = 'Quantity'; const quantity = document.createElement('input'); quantity.id = label.htmlFor; quantity.name = `items[${nextIndex}][quantity]`; quantity.type = 'number'; quantity.min = '1'; quantity.max = '999'; quantity.required = true; quantity.value = '1'; quantity.setAttribute('aria-label',`Quantity of ${product.name}`);
            const id = document.createElement('input'); id.type = 'hidden'; id.name = `items[${nextIndex}][product_id]`; id.value = product.id; controls.append(label,quantity,id);
            const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'text-button remove-edit-line'; remove.textContent = 'Remove'; remove.setAttribute('aria-label',`Remove ${product.name} from order`);
            row.append(details,controls,remove); lines.append(row); nextIndex++; refresh(); quantity.focus(); announcement.textContent = `${product.name} added to these changes. Save to update the order.`;
        });
        refresh();
    }
    editForm.addEventListener('submit', () => { save.disabled = true; save.textContent = 'Saving changes…'; });
}
