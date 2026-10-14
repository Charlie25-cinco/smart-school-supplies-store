<?php

namespace App\Http\Controllers;

use App\Models\Product;
use App\Models\StockMovement;
use App\Support\Money;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class InventoryController extends Controller
{
    public function index(Request $request)
    {
        $filters = $request->validate(['q' => ['nullable', 'string', 'max:100'], 'category' => ['nullable', 'string', 'max:60'], 'status' => ['nullable', 'in:active,inactive,low,out']]);
        $search = $filters['q'] ?? '';
        $query = Product::query()->when($search !== '', fn ($query) => $query->where(fn ($q) => $q->where('name', 'like', '%'.$search.'%')->orWhere('sku', 'like', '%'.$search.'%')))
            ->when($filters['category'] ?? null, fn ($q, $category) => $q->where('category', $category));
        match ($filters['status'] ?? '') {
            'active' => $query->where('active', true),
            'inactive' => $query->where('active', false),
            'low' => $query->where('active', true)->where('kind', '!=', 'service')->whereRaw('stock - reserved > ?', [0])->whereRaw('stock - reserved <= reorder_level'),
            'out' => $query->where('active', true)->where('kind', '!=', 'service')->whereRaw('stock - reserved <= ?', [0]),
            default => null,
        };

        return view('inventory.index', ['products' => $query->orderBy('kind')->orderBy('name')->paginate(15)->withQueryString(), 'search' => $search, 'filters' => $filters, 'categories' => Product::distinct()->orderBy('category')->pluck('category'), 'movements' => StockMovement::with('product', 'user')->latest('id')->limit(12)->get()]);
    }

    public function create()
    {
        return view('inventory.form', ['product' => new Product(['kind' => 'product', 'reorder_level' => 10, 'active' => true])]);
    }

    public function edit(Product $product)
    {
        return view('inventory.form', compact('product'));
    }

    public function store(Request $request)
    {
        $data = $this->validated($request);
        $request->validate(['stock' => ['required', 'integer', 'min:0', 'max:1000000']]);
        DB::transaction(function () use ($request, $data) {
            $stock = $data['kind'] === 'service' ? 0 : (int) $request->input('stock');
            $product = Product::create([...$data, 'stock' => $stock]);
            if ($stock > 0) {
                StockMovement::create(['product_id' => $product->id, 'user_id' => $request->user()->id, 'quantity' => $stock, 'reason' => 'Opening stock']);
            }
        });

        return redirect()->route('inventory')->with('success', 'Item added to the store inventory.');
    }

    public function update(Request $request, Product $product)
    {
        $data = $this->validated($request, $product);
        $data['kind'] = $product->kind;
        $product->update($data);

        return redirect()->route('inventory')->with('success', 'Item details updated.');
    }

    public function restock(Request $request, Product $product)
    {
        abort_unless($product->kind !== 'service', 422);
        $data = $this->movementData($request, $product, 'restock');
        DB::transaction(function () use ($request, $product, $data) {
            $product->increment('stock', $data['quantity']);
            StockMovement::create(['product_id' => $product->id, 'user_id' => $request->user()->id, 'quantity' => $data['quantity'], 'reason' => $data['reason']]);
        });

        return redirect()->route('inventory')->with('success', 'Stock received and movement recorded.');
    }

    public function usage(Request $request, Product $product)
    {
        abort_unless($product->kind === 'consumable', 422, 'Supply usage is limited to internal consumables.');
        $data = $this->movementData($request, $product, 'usage');
        DB::transaction(function () use ($request, $product, $data) {
            if (! Product::whereKey($product->id)->whereRaw('stock - reserved >= ?', [$data['quantity']])->decrement('stock', $data['quantity'])) {
                throw ValidationException::withMessages(['quantity' => 'Usage exceeds available stock. Reserved orders cannot be consumed.']);
            }
            StockMovement::create(['product_id' => $product->id, 'user_id' => $request->user()->id, 'quantity' => -$data['quantity'], 'reason' => 'Supply usage: '.$data['reason']]);
        }, 3);

        return redirect()->route('inventory')->with('success', 'Supply usage recorded. Available stock updated.');
    }

    private function movementData(Request $request, Product $product, string $action): array
    {
        // Server-derived context restores only the form that failed validation.
        $request->merge(['movement_dialog' => $action.'-'.$product->id]);
        $data = $request->validate(['quantity' => ['required', 'integer', 'min:1', 'max:1000000'], 'reason' => ['required', 'string', 'max:120']]);
        $data['quantity'] = (int) $data['quantity'];

        return $data;
    }

    private function validated(Request $request, ?Product $product = null): array
    {
        $data = $request->validate([
            'sku' => ['required', 'string', 'max:40', 'regex:/^[A-Za-z0-9-]+$/', Rule::unique('products')->ignore($product)],
            'name' => ['required', 'string', 'max:100'], 'category' => ['required', 'string', 'max:60'],
            'kind' => ['required', 'in:product,service,consumable'],
            'price' => ['required', 'regex:/^\d{1,5}(\.\d{1,2})?$/', function ($attribute, $value, $fail) use ($product, $request) {
                if (($product?->kind ?? $request->input('kind')) !== 'consumable' && Money::cents((string) $value) < 1) {
                    $fail('Price must be greater than zero.');
                }
            }],
            'reorder_level' => ['required', 'integer', 'min:0', 'max:1000000'], 'active' => ['nullable', 'boolean'],
        ]);
        $data['price_cents'] = Money::cents((string) $data['price']);
        $data['active'] = $request->boolean('active');
        unset($data['price']);

        return $data;
    }
}
