(() => {
    'use strict';
    const config = window.STORE_CONFIG || {};
    const money = cents => new Intl.NumberFormat('en-PH', {style: 'currency', currency: 'PHP'}).format(cents / 100);
    const element = (tag, className, text) => { const el = document.createElement(tag); if (className) el.className = className; if (text !== undefined) el.textContent = text; return el; };
    const dialog = document.getElementById('basket-dialog');
    const cart = new Map();
    let products = [], category = 'all', timer;
    const art = {
        notebook: '<rect x="41" y="22" width="91" height="124" rx="5" fill="#71906e"/><rect x="48" y="24" width="83" height="117" rx="3" fill="#9bb095"/><path d="M55 24v117" stroke="#51704f"/><rect x="65" y="59" width="54" height="39" rx="2" fill="#faf4dd"/><path d="M74 73h37M74 82h26" stroke="#7b9070" stroke-width="2"/><g stroke="#375b3b" stroke-width="2" stroke-linecap="round"><path d="M39 36h12M39 49h12M39 62h12M39 75h12M39 88h12M39 101h12M39 114h12M39 127h12"/></g>',
        pen: '<g transform="rotate(23 90 86)"><rect x="70" y="17" width="13" height="122" rx="4" fill="#284f63"/><rect x="71" y="18" width="11" height="40" rx="3" fill="#477c90"/><path d="M81 22h4v33" stroke="#becdd0" stroke-width="2"/><path d="m72 136 4.5 12 4.5-12" fill="#a8b5b7"/><rect x="91" y="32" width="12" height="114" rx="4" fill="#344636"/><rect x="92" y="32" width="10" height="38" rx="3" fill="#586b53"/><path d="M100 36h5v30" stroke="#bac1b0" stroke-width="2"/><path d="m93 143 4 11 4-11" fill="#a8b5b7"/></g>',
        pencil: '<g transform="rotate(23 88 85)"><rect x="76" y="13" width="14" height="128" rx="2" fill="#d3a341"/><path d="M80 25v111" stroke="#f0c86f" stroke-width="3"/><rect x="76" y="13" width="14" height="15" rx="2" fill="#dba199"/><rect x="76" y="27" width="14" height="10" fill="#b5b49a"/><path d="m76 140 7 19 7-19" fill="#c6ad7d"/><path d="m80 150 3 9 3-9" fill="#314034"/></g>',
        paper: '<g transform="rotate(9 92 85)"><rect x="44" y="27" width="88" height="122" rx="3" fill="#c9d5c0"/><rect x="38" y="21" width="88" height="122" rx="3" fill="#fdfbf2"/><path d="M53 49h55M53 59h55M53 69h55M53 79h55M53 89h55M53 99h43M53 109h55M53 119h45" stroke="#aab9a2" stroke-width="1.5"/></g>',
        folder: '<path d="M29 45q0-5 5-5h42l12 13h48q5 0 5 5v81q0 5-5 5H34q-5 0-5-5V45Z" fill="#bd964f"/><path d="M34 61h109q5 0 4 5l-12 72q-1 6-6 6H27L29 67q0-6 5-6Z" fill="#dfbf7d"/><path d="M39 77h57" stroke="#f5deb0" stroke-width="2"/><rect x="44" y="98" width="51" height="24" rx="3" fill="#f7edcf"/>',
        pencils: '<rect x="42" y="55" width="94" height="91" rx="4" fill="#d8ab7b"/><rect x="49" y="64" width="80" height="73" rx="2" fill="#f6e7c8"/><path d="M58 105h61" stroke="#c9af80" stroke-width="2"/><g stroke-width="8" stroke-linecap="round"><path d="M54 35v61" stroke="#9275a1"/><path d="M69 29v67" stroke="#5d8c7b"/><path d="M84 36v60" stroke="#e4b348"/><path d="M99 25v71" stroke="#c17b68"/><path d="M114 34v62" stroke="#5d8da5"/><path d="M129 31v65" stroke="#a2ad78"/></g><path d="M54 23v7M69 17v7M84 24v7M99 13v7M114 22v7M129 19v7" stroke="#ab9574" stroke-width="4"/>',
        stapler: '<path d="M39 117h99l-7 20H47l-8-20Z" fill="#53776b"/><path d="M35 74q0-8 8-8h87q8 0 8 8v13l-102 26-1-39Z" fill="#7da396"/><path d="m39 111 96-22v17l-94 23-2-18Z" fill="#b6c7be"/><path d="M47 76h69" stroke="#abcbb7" stroke-width="3" stroke-linecap="round"/><path d="M44 118h90" stroke="#375e50" stroke-width="3"/>',
        bag: '<path d="M67 37v-8q0-12 18-12t18 12v8" stroke="#547057" stroke-width="8"/><rect x="43" y="33" width="88" height="114" rx="24" fill="#7f9c79"/><rect x="49" y="41" width="76" height="48" rx="17" fill="#99b08d"/><rect x="53" y="91" width="67" height="45" rx="12" fill="#668760"/><path d="M61 105h51" stroke="#c5d2b7" stroke-width="2"/><rect x="76" y="58" width="23" height="14" rx="3" fill="#eee4c5"/><path d="M45 56v69M129 56v69" stroke="#5f7e57" stroke-width="4"/>'
    };
    const announce = text => { const toast = document.getElementById('catalog-toast'); toast.textContent = text; toast.hidden = false; clearTimeout(timer); timer = setTimeout(() => { toast.hidden = true; }, 2600); };
    const save = () => { try { localStorage.setItem('smart-supplies-list-v1', JSON.stringify([...cart])); } catch { /* Basket remains usable without browser storage. */ } };
    const add = sku => { cart.set(sku, Math.min(99, (cart.get(sku) || 0) + 1)); save(); renderBasket(); announce(`${products.find(p => p.sku === sku).name} added to your list.`); };
    const renderProducts = () => {
        const search = document.getElementById('catalog-search').value.toLowerCase().trim();
        const items = products.filter(p => p.kind === 'product' && (category === 'all' || p.category === category) && `${p.name} ${p.description} ${p.category}`.toLowerCase().includes(search));
        const grid = document.getElementById('catalog-products'); grid.replaceChildren();
        items.forEach(product => {
            const card = element('article', 'product-card');
            const visual = element('div', `product-art ${['sage','peach','blue','yellow'].includes(product.color) ? product.color : 'sage'}`); visual.setAttribute('aria-hidden', 'true');
            // SVG artwork is an internal constant, never catalog-supplied HTML.
            visual.innerHTML = `<svg viewBox="0 0 175 175" fill="none">${art[product.art] || art.notebook}</svg>`;
            const content = element('div', 'product-content'); content.append(element('p', 'product-category', product.category), element('h3', '', product.name), element('p', 'product-description', product.description));
            const bottom = element('div', 'product-bottom'); const button = element('button', 'add-item', '+'); button.type = 'button'; button.setAttribute('aria-label', `Add ${product.name} to your list`); button.addEventListener('click', () => add(product.sku));
            bottom.append(element('strong', '', money(product.price_cents)), button); content.append(bottom); card.append(visual, content); grid.append(card);
        });
        grid.setAttribute('aria-busy', 'false'); document.getElementById('catalog-count').textContent = `${items.length} ${items.length === 1 ? 'essential' : 'essentials'}`; document.getElementById('catalog-empty').hidden = items.length > 0;
    };
    const renderServices = () => {
        const grid = document.getElementById('catalog-services'); grid.replaceChildren();
        products.filter(p => p.kind === 'service').forEach((product, index) => { const card = element('article', 'service-card'); const icon = element('span', 'service-icon', ['▤', '▥', '⌁', '▣', '▧'][index] || '↗'); icon.setAttribute('aria-hidden', 'true'); const button = element('button', 'text-button', 'Add to inquiry →'); button.type = 'button'; button.setAttribute('aria-label', `Add ${product.name} to inquiry`); button.addEventListener('click', () => add(product.sku)); card.append(icon, element('h3', '', product.name.split(' · ')[0]), element('p', '', product.description), element('span', 'service-price', `From ${money(product.price_cents)} / ${product.name.split(' · ')[1] || 'unit'}`), button); grid.append(card); });
    };
    const summary = () => {
        let total = 0; const rows = ['Hello Smart School Supplies! I would like to inquire about:', ''];
        cart.forEach((quantity, sku) => { const product = products.find(p => p.sku === sku); if (!product) return; total += quantity * product.price_cents; rows.push(`• ${product.name} — ${quantity} × ${money(product.price_cents)} = ${money(quantity * product.price_cents)}`); });
        rows.push('', `Estimated total: ${money(total)}`, `Fulfillment: ${document.getElementById('fulfillment').value}`, 'Please confirm availability, final price, any delivery fee, and payment arrangements.');
        document.getElementById('order-summary').value = rows.join('\n'); document.getElementById('basket-total').textContent = money(total);
    };
    const renderBasket = () => {
        const focused = document.activeElement?.dataset?.basketControl;
        const lines = document.getElementById('basket-lines'); lines.replaceChildren(); let count = 0;
        cart.forEach((quantity, sku) => {
            const product = products.find(p => p.sku === sku); if (!product) return; count += quantity;
            const row = element('div', 'basket-line'); const details = element('div'); details.append(element('h3', '', product.name), element('small', '', `${money(product.price_cents)} each`));
            const controls = element('div', 'basket-quantity'); const minus = element('button', 'icon-button', '−'); const plus = element('button', 'icon-button', '+'); const remove = element('button', 'text-button', 'Remove');
            [[minus,'Decrease'],[plus,'Increase'],[remove,'Remove']].forEach(([button, action]) => { button.type = 'button'; button.setAttribute('aria-label', `${action} ${product.name}`); button.dataset.basketControl = `${sku}-${action}`; });
            const input = element('input'); input.type = 'number'; input.min = '1'; input.max = '99'; input.value = quantity; input.setAttribute('aria-label', `Quantity of ${product.name}`); input.dataset.basketControl = `${sku}-quantity`; plus.disabled = quantity === 99;
            const change = next => { next <= 0 ? cart.delete(sku) : cart.set(sku, Math.max(1, Math.min(99, next))); save(); renderBasket(); };
            minus.addEventListener('click', () => change(quantity - 1)); plus.addEventListener('click', () => change(quantity + 1)); remove.addEventListener('click', () => change(0)); input.addEventListener('change', () => change(Math.trunc(Number(input.value)) || 1));
            controls.append(minus, input, plus, remove); details.append(controls); row.append(details, element('span', 'basket-line-price', money(quantity * product.price_cents))); lines.append(row);
        });
        document.getElementById('basket-count').textContent = count; document.getElementById('basket-empty').hidden = count > 0; document.getElementById('basket-details').hidden = count === 0; summary();
        if (focused) { const control = [...lines.querySelectorAll('[data-basket-control]')].find(el => el.dataset.basketControl === focused); (control || document.getElementById('close-basket')).focus(); }
    };
    let restored = [];
    try { restored = JSON.parse(localStorage.getItem('smart-supplies-list-v1') || '[]'); } catch { /* Ignore invalid or unavailable local storage. */ }
    const load = async () => {
        document.getElementById('catalog-error').hidden = true; document.getElementById('catalog-count').textContent = 'Loading catalog…';
        try {
            const response = await fetch('products.json'); if (!response.ok) throw new Error('Catalog unavailable');
            const data = await response.json(); if (!Array.isArray(data) || !data.every(p => typeof p.sku === 'string' && typeof p.name === 'string' && Number.isInteger(p.price_cents) && p.price_cents > 0)) throw new Error('Invalid catalog');
            products = data;
            if (Array.isArray(restored)) restored.forEach(entry => { if (Array.isArray(entry) && products.some(p => p.sku === entry[0]) && Number.isInteger(entry[1]) && entry[1] > 0 && entry[1] <= 99) cart.set(entry[0], entry[1]); });
            restored = []; renderProducts(); renderServices(); renderBasket();
        } catch {
            document.getElementById('catalog-count').textContent = 'Catalog unavailable'; document.getElementById('catalog-products').setAttribute('aria-busy', 'false'); document.getElementById('catalog-error').hidden = false;
        }
    };
    document.querySelectorAll('[data-category]').forEach(button => button.addEventListener('click', () => { category = button.dataset.category; document.querySelectorAll('[data-category]').forEach(tab => { tab.classList.toggle('active', tab === button); tab.setAttribute('aria-pressed', String(tab === button)); }); renderProducts(); }));
    document.getElementById('catalog-search').addEventListener('input', renderProducts);
    document.getElementById('reset-search').addEventListener('click', () => { document.getElementById('catalog-search').value = ''; document.querySelector('[data-category="all"]').click(); });
    document.querySelectorAll('[data-open-basket]').forEach(button => button.addEventListener('click', () => { renderBasket(); dialog.showModal(); }));
    document.getElementById('close-basket').addEventListener('click', () => dialog.close());
    document.getElementById('fulfillment').addEventListener('change', summary);
    document.getElementById('retry-catalog').addEventListener('click', load);
    document.getElementById('copy-summary').addEventListener('click', async () => {
        const field = document.getElementById('order-summary'); const status = document.getElementById('basket-status');
        try { await navigator.clipboard.writeText(field.value); status.textContent = 'Summary copied. Open Messenger, paste it, and send your inquiry.'; }
        catch { field.focus(); field.select(); status.textContent = 'Select and copy the summary, then paste it into Messenger.'; }
    });
    if (config.demo === false) { document.getElementById('demo-badge').hidden = true; document.getElementById('demo-footer').hidden = true; }
    document.getElementById('store-location').textContent = config.location || 'Confirm pickup or nearby delivery with staff.';
    try { const url = new URL(config.messengerUrl); if (url.protocol === 'https:' && ['m.me','messenger.com','www.messenger.com','facebook.com','www.facebook.com'].includes(url.hostname)) { const link = document.getElementById('open-messenger'); link.href = url.href; link.textContent = url.hostname.includes('facebook.com') ? 'Open Facebook Page ↗' : 'Open Messenger ↗'; link.hidden = false; document.getElementById('messenger-unconfigured').hidden = true; } } catch { /* Missing link is deliberately shown as a demo state. */ }
    load();
})();
