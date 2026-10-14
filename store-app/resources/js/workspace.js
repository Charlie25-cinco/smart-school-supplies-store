const menuButton = document.getElementById('workspace-menu-open');
const menu = document.getElementById('workspace-menu');
const navigation = document.getElementById('store-navigation');
if (menuButton && menu && navigation) {
    const mobileNavigation = navigation.cloneNode(true);
    mobileNavigation.removeAttribute('id');
    mobileNavigation.setAttribute('aria-label', 'Mobile store navigation');
    document.getElementById('mobile-store-navigation').append(mobileNavigation);
    document.body.classList.add('workspace-enhanced');
    menuButton.hidden = false;
    const compact = window.matchMedia('(max-width: 1100px)');
    const revealWithin = (container, link) => {
        if (!container || container.scrollHeight <= container.clientHeight || !['auto', 'scroll'].includes(getComputedStyle(container).overflowY)) return;
        const bounds = container.getBoundingClientRect();
        const target = link.getBoundingClientRect();
        const top = bounds.top + container.clientTop + 6;
        const bottom = bounds.top + container.clientTop + container.clientHeight - 6;
        if (target.top < top) container.scrollTop += target.top - top;
        else if (target.bottom > bottom) container.scrollTop += target.bottom - bottom;
    };
    const revealDesktopLink = link => {
        if (!link) return;
        revealWithin(navigation, link);
        // A very short window or unusually tall account details use natural sidebar scrolling.
        revealWithin(navigation.closest('.sidebar'), link);
    };
    navigation.addEventListener('focusin', event => {
        if (!compact.matches) revealDesktopLink(event.target.closest('.nav-link'));
    });
    const updateMenu = () => {
        if (!compact.matches && menu.open) menu.close();
    };
    menuButton.addEventListener('click', () => {
        menu.showModal();
        menuButton.setAttribute('aria-expanded', 'true');
    });
    document.getElementById('workspace-menu-close').addEventListener('click', () => menu.close());
    menu.addEventListener('close', () => {
        menuButton.setAttribute('aria-expanded', 'false');
        if (compact.matches) menuButton.focus({ preventScroll: true });
        else {
            const current = navigation.querySelector('[aria-current=page]');
            current?.focus({ preventScroll: true });
            revealDesktopLink(current);
        }
    });
    compact.addEventListener('change', updateMenu);
    updateMenu();
}

// Use the table's own column headings as card labels, retaining semantic tables.
document.querySelectorAll('.table-wrap table:not(.inventory-table):not(.orders-table):not(.cashiers-table)').forEach(table => {
    const headings = [...table.querySelectorAll('thead th')];
    if (headings.length < 4) return;
    table.classList.add('record-table');
    table.querySelectorAll('tbody tr').forEach(row => {
        const cells = [...row.querySelectorAll('td')];
        if (cells.length !== headings.length) return;
        cells.forEach((cell, index) => {
            cell.dataset.label = headings[index].textContent.trim() || 'Actions';
            if (index === 0) cell.classList.add('record-primary-cell');
            if (index === cells.length - 1 && cell.querySelector('a,button')) cell.classList.add('record-actions-cell');
        });
    });
});

const pos = document.getElementById('pos-app');
if (pos) {
    const narrow = window.matchMedia('(max-width: 900px)');
    const switcher = document.getElementById('pos-view-switcher');
    const products = document.getElementById('product-browser');
    const sale = document.getElementById('checkout-basket');
    const productTab = document.getElementById('pos-products-tab');
    const saleTab = document.getElementById('pos-sale-tab');
    const returnButton = document.getElementById('pos-return-products');
    const basketButton = document.querySelector('.mobile-basket-bar');
    const modeFields = document.querySelector('.sale-mode-fields');
    const modeAnchor = document.createComment('Desktop checkout options');
    modeFields.before(modeAnchor);
    const tabs = [productTab, saleTab];
    let active = pos.dataset.checkoutInvalid ? 'sale' : 'products';
    const show = (panel, { focus = false, scroll = false } = {}) => {
        active = panel;
        pos.dataset.activePanel = panel;
        const focusedOption = modeFields.contains(document.activeElement) ? document.activeElement : null;
        if (narrow.matches && modeFields.parentElement !== sale) sale.querySelector('.panel-heading').after(modeFields);
        else if (!narrow.matches && modeFields.parentElement !== modeAnchor.parentElement) modeAnchor.after(modeFields);
        products.hidden = narrow.matches && panel !== 'products';
        sale.hidden = narrow.matches && panel !== 'sale';
        if (narrow.matches) {
            products.setAttribute('role', 'tabpanel');
            products.setAttribute('aria-labelledby', productTab.id);
            sale.setAttribute('role', 'tabpanel');
            sale.setAttribute('aria-labelledby', saleTab.id);
        } else {
            products.removeAttribute('role');
            products.removeAttribute('aria-labelledby');
            sale.removeAttribute('role');
            sale.setAttribute('aria-labelledby', 'basket-heading');
        }
        tabs.forEach((tab, index) => {
            const selected = panel === (index ? 'sale' : 'products');
            tab.setAttribute('aria-selected', String(selected));
            tab.tabIndex = selected ? 0 : -1;
        });
        switcher.hidden = !narrow.matches;
        returnButton.hidden = !narrow.matches;
        basketButton.hidden = !narrow.matches || panel === 'sale';
        if (focusedOption && !focusedOption.closest('[hidden]')) focusedOption.focus({ preventScroll: true });
        if (focus && narrow.matches) (panel === 'sale' ? sale : document.getElementById('pos-search')).focus({ preventScroll: true });
        if (scroll && narrow.matches) switcher.scrollIntoView({ block: 'start', behavior: 'instant' });
    };
    pos.classList.add('pos-panel-workspace');
    productTab.addEventListener('click', () => show('products'));
    saleTab.addEventListener('click', () => show('sale'));
    tabs.forEach((tab, index) => tab.addEventListener('keydown', event => {
        const next = ['ArrowRight', 'ArrowLeft'].includes(event.key) ? 1 - index : event.key === 'Home' ? 0 : event.key === 'End' ? 1 : null;
        if (next === null) return;
        event.preventDefault();
        show(next ? 'sale' : 'products');
        tabs[next].focus();
    }));
    returnButton.addEventListener('click', () => show('products', { focus: true, scroll: true }));
    basketButton.addEventListener('click', () => show('sale', { focus: true, scroll: true }));
    pos.addEventListener('pos:panel-reveal', event => show(event.detail.panel));
    narrow.addEventListener('change', () => {
        if (narrow.matches && sale.contains(document.activeElement)) active = 'sale';
        if (narrow.matches && products.contains(document.activeElement)) active = modeFields.contains(document.activeElement) ? 'sale' : 'products';
        show(active);
    });
    show(active);
}
