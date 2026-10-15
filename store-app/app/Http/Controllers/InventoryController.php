<?php

namespace App\Http\Controllers;

use App\Models\Product;
use App\Models\Setting;
use App\Models\StockMovement;
use App\Support\Money;
use App\Support\Text;
use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
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
        $reorder = (int) (Setting::get('default_reorder_level', '10') ?? '10');

        return view('inventory.form', ['product' => new Product(['kind' => 'product', 'reorder_level' => min(max($reorder, 0), 1000000), 'active' => true]), 'categories' => $this->categories()]);
    }

    public function edit(Product $product)
    {
        return view('inventory.form', ['product' => $product, 'categories' => $this->categories()]);
    }

    public function store(Request $request)
    {
        $data = $this->validated($request);
        $request->validate(['stock' => ['required', 'integer', 'min:0', 'max:1000000']]);
        DB::transaction(function () use ($request, $data) {
            $image = $data['image'] ?? null;
            unset($data['image'], $data['remove_image']);
            $stock = $data['kind'] === 'service' ? 0 : (int) $request->input('stock');
            $product = Product::create([...$data, 'stock' => $stock]);
            if ($image instanceof UploadedFile) {
                $product->update(['image_path' => $this->storeImage($image)]);
            }
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
        DB::transaction(function () use ($product, $data) {
            $image = $data['image'] ?? null;
            $remove = ! empty($data['remove_image']);
            unset($data['image'], $data['remove_image']);
            if ($image instanceof UploadedFile) {
                $path = $this->storeImage($image);
                $this->deleteImage($product->image_path);
                $data['image_path'] = $path;
            } elseif ($remove) {
                $this->deleteImage($product->image_path);
                $data['image_path'] = null;
            }
            $product->update($data);
        });

        return redirect()->route('inventory')->with('success', 'Item details updated.');
    }

    public function destroy(Product $product)
    {
        return DB::transaction(function () use ($product) {
            $product = Product::findOrFail($product->id);
            if ($product->saleItems()->exists() || $product->orderItems()->exists()
                || $product->movements()->whereNotIn('reason', ['Opening stock', 'Sample opening stock'])->exists()) {
                throw ValidationException::withMessages(['product' => 'This item has sales, orders, or recorded stock movements and cannot be deleted. Deactivate it instead to preserve history.']);
            }
            $product->movements()->delete();
            $this->deleteImage($product->image_path);
            $product->delete();

            return redirect()->route('inventory')->with('success', 'Item deleted. Items with transaction history cannot be deleted.');
        });
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
        $data['reason'] = Text::words($data['reason'], 120);

        return $data;
    }

    public function image(Product $product)
    {
        $path = $product->image_path;
        if (! is_string($path) || ! str_starts_with($path, 'product-images/') || str_contains($path, '..') || ! Storage::disk('local')->exists($path)) {
            abort(404);
        }
        $mime = match (strtolower(pathinfo($path, PATHINFO_EXTENSION))) {
            'jpg', 'jpeg' => 'image/jpeg',
            'png' => 'image/png',
            'webp' => 'image/webp',
            default => abort(404),
        };

        return response()->file(Storage::disk('local')->path($path), ['Content-Type' => $mime]);
    }

    private function storeImage(UploadedFile $file): string
    {
        return $file->store('product-images', 'local');
    }

    private function deleteImage(?string $path): void
    {
        if (is_string($path) && str_starts_with($path, 'product-images/') && ! str_contains($path, '..')) {
            Storage::disk('local')->delete($path);
        }
    }

    private function categories(): array
    {
        $defaults = ['Notebooks & Paper', 'Writing Essentials', 'School Essentials', 'Art Materials', 'Academic Services'];

        return Product::distinct()->orderBy('category')->pluck('category')->merge($defaults)->unique()->values()->all();
    }

    private function validated(Request $request, ?Product $product = null): array
    {
        $data = $request->validate([
            'sku' => ['required', 'string', 'max:40', 'regex:/^[A-Za-z0-9-]+$/', Rule::unique('products')->ignore($product)],
            'name' => ['required', 'string', 'max:100'], 'category' => ['nullable', 'string', 'max:60'],
            'category_new' => ['nullable', 'string', 'max:60'],
            'description' => ['nullable', 'string', 'max:1000'],
            'kind' => ['required', 'in:product,service,consumable'],
            'price' => ['required', 'regex:/^\d{1,5}(\.\d{1,2})?$/', function ($attribute, $value, $fail) use ($product, $request) {
                if (($product?->kind ?? $request->input('kind')) !== 'consumable' && Money::cents((string) $value) < 1) {
                    $fail('Price must be greater than zero.');
                }
            }],
            'reorder_level' => ['required', 'integer', 'min:0', 'max:1000000'], 'active' => ['nullable', 'boolean'],
            'image' => ['nullable', 'file', 'image', 'mimes:jpg,jpeg,png,webp', 'max:2048'],
            'remove_image' => ['nullable', 'boolean'],
        ]);
        $data['price_cents'] = Money::cents((string) $data['price']);
        $data['active'] = $request->boolean('active');
        unset($data['price']);
        $category = trim((string) ($data['category_new'] ?? ''));
        if ($category === '') {
            $category = trim((string) ($data['category'] ?? ''));
        }
        unset($data['category_new']);
        if ($category === '' || mb_strlen($category) > 60) {
            throw ValidationException::withMessages(['category' => 'Choose a category or enter a new one (max 60 characters).']);
        }
        $data['category'] = Text::words($category);
        $data['name'] = Text::words(trim((string) ($data['name'] ?? '')));
        $data['description'] = trim((string) ($data['description'] ?? ''));

        return $data;
    }
}
