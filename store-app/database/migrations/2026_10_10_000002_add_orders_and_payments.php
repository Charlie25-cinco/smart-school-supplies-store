<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('products', function (Blueprint $table) {
            $table->unsignedInteger('reserved')->default(0);
        });
        Schema::table('sales', function (Blueprint $table) {
            $table->string('payment_method')->default('cash');
            $table->string('payment_reference')->nullable()->unique();
            $table->unsignedInteger('delivery_fee_cents')->default(0);
        });
        Schema::create('orders', function (Blueprint $table) {
            $table->id();
            $table->uuid('reference')->unique();
            $table->foreignId('user_id')->constrained()->restrictOnDelete();
            $table->foreignId('sale_id')->nullable()->unique()->constrained()->restrictOnDelete();
            $table->foreignId('paid_by')->nullable()->constrained('users')->restrictOnDelete();
            $table->string('channel');
            $table->string('fulfillment');
            $table->string('payment_plan');
            $table->string('status')->default('preparing');
            $table->string('customer_name', 100);
            $table->string('customer_phone', 30);
            $table->string('delivery_address', 300)->nullable();
            $table->string('notes', 500)->nullable();
            $table->string('cancel_reason', 300)->nullable();
            $table->unsignedInteger('subtotal_cents');
            $table->unsignedInteger('delivery_fee_cents')->default(0);
            $table->unsignedInteger('total_cents');
            $table->timestamps();
        });
        Schema::create('order_items', function (Blueprint $table) {
            $table->id();
            $table->foreignId('order_id')->constrained()->cascadeOnDelete();
            $table->foreignId('product_id')->constrained()->restrictOnDelete();
            $table->string('name');
            $table->string('sku');
            $table->string('kind');
            $table->unsignedInteger('quantity');
            $table->unsignedInteger('price_cents');
            $table->unsignedInteger('total_cents');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('order_items');
        Schema::dropIfExists('orders');
        Schema::table('sales', function (Blueprint $table) {
            $table->dropUnique(['payment_reference']);
            $table->dropColumn(['payment_method', 'payment_reference', 'delivery_fee_cents']);
        });
        Schema::table('products', fn (Blueprint $table) => $table->dropColumn('reserved'));
    }
};
