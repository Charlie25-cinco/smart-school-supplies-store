import './payments';
import './pos';

document.querySelectorAll('[data-modal-open]').forEach(button => button.addEventListener('click', () => document.getElementById(button.dataset.modalOpen).showModal()));
document.querySelectorAll('[data-modal-close]').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
document.querySelector('dialog[data-modal-reopen]')?.showModal();
document.querySelectorAll('[data-print]').forEach(button => button.addEventListener('click', () => window.print()));
