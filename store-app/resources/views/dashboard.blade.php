<x-layout title="Overview">
    <div class="page-heading"><div><span class="eyebrow">STORE OVERVIEW</span><h1>Good {{ now()->hour < 12 ? 'morning' : 'day' }}, {{ explode(' ', auth()->user()->name)[0] }}.</h1><p>Here's how your store is doing today.</p></div><a class="button primary" href="{{ route('pos') }}">New sale <x-icon name="plus" :size="20" /></a></div>
    <section class="metrics" aria-label="Today's store metrics">
        <article class="metric featured"><span>Today's sales</span><strong>{{ \App\Support\Money::format((int) $revenue) }}</strong><small>Recorded revenue · not net profit</small></article>
        <article class="metric"><span>Transactions</span><strong>{{ $transactions }}</strong><small>Completed sales today</small></article>
        <article class="metric"><span>Items sold</span><strong>{{ $units }}</strong><small>Product units today</small></article>
        <article class="metric"><span>Low-stock items</span><strong>{{ $lowStock->count() }}</strong><small>Active products to review</small></article>
    </section>
    <section class="payment-strip" aria-label="Payments and orders"><span>Cash sales today <strong>{{ \App\Support\Money::format((int) $cashTotal) }}</strong></span><span>GCash sales today <strong>{{ \App\Support\Money::format((int) $gcashTotal) }}</strong></span><a href="{{ route('orders.index') }}"><strong>{{ $openOrders }}</strong> open orders · {{ \App\Support\Money::format((int) $outstanding) }} awaiting payment</a></section>
    <div class="dashboard-grid">
        <section class="panel"><div class="panel-heading"><div><h2>Sales this week</h2><p>Daily revenue for the last seven days</p></div><span class="badge">Last 7 days</span></div>
            <figure class="chart"><figcaption class="sr-only">Daily sales revenue</figcaption>@foreach($days as $day)<div class="chart-column"><span class="chart-value">{{ \App\Support\Money::format($day['total']) }}</span><div class="bar-track"><div class="bar" style="height: {{ $day['total'] > 0 ? max(4, round($day['total'] / max(1, $days->max('total')) * 100)) : 0 }}%"></div></div><span>{{ $day['day'] }}</span></div>@endforeach</figure>
        </section>
        <section class="panel"><div class="panel-heading"><div><h2>Stock alerts</h2><p>At or below the reorder level</p></div><span class="badge warning">{{ $lowStock->count() }} items</span></div>
            <div class="stock-list" tabindex="0" role="region" aria-label="Low-stock items">@forelse($lowStock as $product)<a class="stock-row" href="{{ route('inventory.edit', $product) }}"><span><strong>{{ $product->name }}</strong><small>Reorder at {{ $product->reorder_level }} units · {{ $product->reserved }} reserved</small></span><span class="stock-number">{{ $product->available() }}<small>available</small></span></a>@empty<div class="empty"><x-icon name="check" :size="32" /><h3>Stock levels are healthy</h3><p>No active products are below their reorder level.</p></div>@endforelse</div>
        </section>
    </div>
    <section class="panel"><div class="panel-heading"><div><h2>Recent transactions</h2><p>The latest completed sales</p></div><a class="text-link" href="{{ route('sales') }}">View all sales <x-icon name="arrow" :size="16" /></a></div>
        <div class="table-wrap" tabindex="0" role="region" aria-label="Recent transactions"><table><thead><tr><th>Receipt</th><th>Time</th><th>Channel</th><th>Payment</th><th>Cashier</th><th class="align-right">Total</th></tr></thead><tbody>@forelse($recent as $sale)<tr><td><a class="text-link" href="{{ route('receipt', $sale) }}">{{ $sale->receiptNumber() }}</a></td><td>{{ $sale->created_at->format('M j, g:i a') }}</td><td><span class="badge">{{ ucfirst($sale->channel) }}</span></td><td><span class="badge payment-badge">{{ $sale->payment_method === 'gcash' ? 'GCash' : 'Cash' }}</span></td><td>{{ $sale->user->name }}</td><td class="align-right money">{{ \App\Support\Money::format($sale->total_cents) }}</td></tr>@empty<tr><td colspan="6" class="empty-cell">Your first sale starts here. <a href="{{ route('pos') }}">Open point of sale</a>.</td></tr>@endforelse</tbody></table></div>
    </section>
</x-layout>
