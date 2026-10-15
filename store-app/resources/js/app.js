import './workspace';
import './payments';
import './pos';
import './orders';

const titleCase = value => value.replace(/\p{L}+/gu, word => word.charAt(0).toLocaleUpperCase() + word.slice(1));
const capsExcluded = /password|username|login|sku|reference|phone|contact|search|description|gcash/i;
document.querySelectorAll('form input:not([type]), form input[type=text], form textarea').forEach(field => {
    if (field.dataset.capsChecked) return;
    field.dataset.capsChecked = '1';
    if (capsExcluded.test(field.id + ' ' + field.name + ' ' + (field.getAttribute('aria-label') || ''))) return;
    field.addEventListener('input', () => {
        const start = field.selectionStart, end = field.selectionEnd, before = field.value;
        const next = titleCase(before);
        if (next === before) return;
        const delta = next.length - before.length;
        field.value = next;
        try { field.setSelectionRange(Math.max(0, start + delta), Math.max(0, end + delta)); } catch { /* Keep the typed text without restoring the caret. */ }
    });
});const eyeShown = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>';const eyeHidden = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 4l16 16"/><path d="M10.6 5.2A9.8 9.8 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4M6.6 6.6C4 8.2 2 12 2 12s3.5 7 10 7c1.5 0 2.9-.3 4.1-.9"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>';
document.querySelectorAll('input[type=password]').forEach(field => {
    if (field.closest('.password-field')) return;
    const wrap = document.createElement('span');
    wrap.className = 'password-field';
    const toggle = document.createElement('button');
    toggle.type = 'button'; toggle.className = 'password-toggle';
    toggle.setAttribute('aria-pressed', 'false');
    toggle.setAttribute('aria-label', 'Show password');
    toggle.innerHTML = eyeShown;
    toggle.addEventListener('click', () => {
        const showing = field.type === 'text';
        field.type = showing ? 'password' : 'text';
        toggle.setAttribute('aria-pressed', String(!showing));
        toggle.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
        toggle.innerHTML = showing ? eyeShown : eyeHidden;
    });
    field.replaceWith(wrap); wrap.append(field, toggle);
});
document.querySelectorAll('input[type=password][autocomplete=new-password]').forEach(field => {
    if (field.dataset.passwordChecks || !field.form) return;
    field.dataset.passwordChecks = '1';
    const isConfirm = /confirm/i.test(field.id + ' ' + field.name);
    const primary = isConfirm ? [...field.form.querySelectorAll('input[type=password][autocomplete=new-password]')].find(item => !/confirm/i.test(item.id + ' ' + item.name)) : null;
    const checks = isConfirm
        ? [['match', 'Passwords match']]
        : [['length', 'At least 12 characters (required)'], ['upper', 'Uppercase letter (suggested)'], ['lower', 'Lowercase letter (suggested)'], ['digit', 'Number (suggested)'], ['symbol', 'Symbol (suggested)']];
    const list = document.createElement('ul');
    list.className = 'password-checks'; list.setAttribute('aria-live', 'polite');
    const rows = checks.map(([key, label]) => {
        const row = document.createElement('li');
        row.dataset.check = key;
        const mark = document.createElement('span');
        mark.className = 'check-mark'; mark.setAttribute('aria-hidden', 'true'); mark.textContent = '○';
        row.append(mark, document.createTextNode(label));
        list.append(row);
        return row;
    });
    const state = (row, met) => { row.classList.toggle('met', met); row.querySelector('.check-mark').textContent = met ? '✓' : '○'; };
    const update = () => {
        const value = field.value;
        for (const row of rows) {
            const key = row.dataset.check;
            if (key === 'length') state(row, [...value].length >= 12);
            else if (key === 'upper') state(row, /[A-Z]/.test(value));
            else if (key === 'lower') state(row, /[a-z]/.test(value));
            else if (key === 'digit') state(row, /[0-9]/.test(value));
            else if (key === 'symbol') state(row, /[^A-Za-z0-9]/.test(value));
            else if (key === 'match') state(row, value !== '' && primary !== undefined && primary !== null && value === primary.value);
        }
    };
    field.addEventListener('input', update);
    primary?.addEventListener('input', update);
    update();
    (field.closest('.password-field') || field).after(list);
});

document.querySelectorAll('[data-modal-open]').forEach(button => button.addEventListener('click', () => document.getElementById(button.dataset.modalOpen).showModal()));
document.querySelectorAll('[data-modal-close]').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
document.querySelector('dialog[data-modal-reopen]')?.showModal();
document.querySelectorAll('[data-print]').forEach(button => button.addEventListener('click', () => window.print()));

const sidebarToggle = document.getElementById('sidebar-toggle');
const sidebarExpand = document.getElementById('sidebar-expand');
if (sidebarToggle && sidebarExpand) {
    const setSidebar = collapsed => {
        document.body.classList.toggle('sidebar-collapsed', collapsed);
        sidebarToggle.setAttribute('aria-expanded', String(!collapsed));
        sidebarExpand.hidden = !collapsed;
        sidebarExpand.setAttribute('aria-expanded', String(collapsed));
        try { localStorage.setItem('store-sidebar-collapsed', collapsed ? '1' : '0'); } catch { /* Sidebar stays open without storage. */ }
    };
    let collapsed = false;
    try { collapsed = localStorage.getItem('store-sidebar-collapsed') === '1'; } catch { /* Sidebar stays open without storage. */ }
    setSidebar(collapsed);
    sidebarToggle.addEventListener('click', () => setSidebar(true));
    sidebarExpand.addEventListener('click', () => { setSidebar(false); sidebarToggle.focus({ preventScroll: true }); });
}

document.querySelectorAll('[data-view-tabs]').forEach(workspace => {
    const tabs = [...workspace.querySelectorAll('[role=tab]')];
    const select = tab => {
        tabs.forEach(item => {
            const active = item === tab;
            item.setAttribute('aria-selected', String(active)); item.tabIndex = active ? 0 : -1;
            document.getElementById(item.getAttribute('aria-controls')).hidden = !active;
        });
    };
    tabs.forEach((tab, index) => {
        tab.addEventListener('click', () => select(tab));
        tab.addEventListener('keydown', event => {
            const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null;
            if (next !== null) { event.preventDefault(); select(tabs[next]); tabs[next].focus(); }
        });
    });
});
