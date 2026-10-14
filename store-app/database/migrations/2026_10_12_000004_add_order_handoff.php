<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            $table->foreignId('assigned_cashier_id')->nullable()->constrained('users')->restrictOnDelete();
            $table->foreignId('assigned_by')->nullable()->constrained('users')->restrictOnDelete();
            $table->timestamp('assigned_at')->nullable();
            $table->unsignedInteger('assignment_version')->default(0);
        });
    }

    public function down(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            $table->dropForeign(['assigned_cashier_id']);
            $table->dropForeign(['assigned_by']);
            $table->dropColumn(['assigned_cashier_id', 'assigned_by', 'assigned_at', 'assignment_version']);
        });
    }
};
