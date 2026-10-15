<x-layout title="Cashier accounts" eyebrow="Admin workspace">
    <div class="page-heading">
        <div><h1>Cashier accounts</h1><p>Give cashiers access to sales and customer orders. Inventory and account management stay with Admin.</p></div>
        <a class="button primary" href="{{ route('cashiers.create') }}"><x-icon name="plus" :size="18" /> Add cashier</a>
    </div>
    <section class="panel" aria-labelledby="cashier-list-heading">
        <div class="panel-heading"><div><h2 id="cashier-list-heading">Your cashier team</h2><p>Disable access when needed. Accounts remain linked to their past transactions.</p></div><span class="badge">{{ $cashiers->total() }} {{ $cashiers->total() === 1 ? 'cashier' : 'cashiers' }}</span></div>
        <div class="table-wrap cashier-table-wrap" tabindex="0" role="region" aria-label="Cashier accounts">
            <table class="cashiers-table">
                <thead><tr><th scope="col">Cashier</th><th scope="col">Username</th><th scope="col">Access</th><th scope="col">Actions</th></tr></thead>
                <tbody>
                    @forelse($cashiers as $cashier)
                    <tr data-cashier-id="{{ $cashier->id }}">
                        <td class="cashier-name-cell" data-label="Cashier"><strong>{{ $cashier->name }}</strong><small class="cell-sub">Cashier workspace</small></td>
                        <td data-label="Username">{{ $cashier->username }}</td>
                        <td data-label="Access"><span @class(['badge', 'success' => $cashier->active, 'danger' => ! $cashier->active])>{{ $cashier->active ? 'Enabled' : 'Disabled' }}</span></td>
                        <td class="cashier-actions-cell" data-label="Actions"><a class="button secondary" href="{{ route('cashiers.edit', $cashier) }}" aria-label="Manage {{ $cashier->name }}">Manage account</a></td>
                    </tr>
                    @empty
                    <tr><td class="empty-cell" colspan="4"><strong>No cashier accounts yet.</strong><p>Add a cashier so transactions can be handled in a separate workspace.</p><a class="button primary" href="{{ route('cashiers.create') }}">Add your first cashier</a></td></tr>
                    @endforelse
                </tbody>
            </table>
        </div>
        <x-pagination :paginator="$cashiers" />
    </section>
</x-layout>
