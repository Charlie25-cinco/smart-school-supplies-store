<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;

class Order extends Model
{
    protected $guarded = ['id'];

    protected function casts(): array
    {
        return ['assigned_at' => 'datetime'];
    }

    public function items()
    {
        return $this->hasMany(OrderItem::class);
    }

    public function user()
    {
        return $this->belongsTo(User::class);
    }

    public function sale()
    {
        return $this->belongsTo(Sale::class);
    }

    public function paidBy()
    {
        return $this->belongsTo(User::class, 'paid_by');
    }

    public function assignedCashier()
    {
        return $this->belongsTo(User::class, 'assigned_cashier_id');
    }

    public function assignedBy()
    {
        return $this->belongsTo(User::class, 'assigned_by');
    }

    public function canBeHandedOff(): bool
    {
        return $this->user?->isAdmin() && in_array($this->status, ['preparing', 'ready', 'out_for_delivery'], true);
    }

    public function isAssignedTo(User $user): bool
    {
        return $this->assigned_cashier_id === $user->id && $this->user?->isAdmin();
    }

    public function scopeAccessibleToCashier(Builder $query, User $user): void
    {
        $query->where(fn (Builder $query) => $query->where('user_id', $user->id)
            ->orWhere(fn (Builder $query) => $query->where('assigned_cashier_id', $user->id)
                ->whereHas('user', fn (Builder $query) => $query->where('role', 'admin'))));
    }

    public function number(): string
    {
        return 'ORD-'.str_pad((string) $this->id, 6, '0', STR_PAD_LEFT);
    }

    public function statusLabel(): string
    {
        return match ($this->status) {
            'out_for_delivery' => 'Out for delivery',
            'completed' => $this->fulfillment === 'delivery' ? 'Delivered' : 'Picked up',
            default => ucfirst($this->status),
        };
    }
}
