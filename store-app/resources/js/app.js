import './workspace';
import './payments';
import './pos';
import './orders';

document.querySelectorAll('[data-modal-open]').forEach(button => button.addEventListener('click', () => document.getElementById(button.dataset.modalOpen).showModal()));
document.querySelectorAll('[data-modal-close]').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
document.querySelector('dialog[data-modal-reopen]')?.showModal();
document.querySelectorAll('[data-print]').forEach(button => button.addEventListener('click', () => window.print()));

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
