<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->boolean('active')->default(true);
        });
        DB::table('users')->where('role', 'owner')->update(['role' => 'admin']);
    }

    public function down(): void
    {
        DB::table('users')->where('role', 'admin')->update(['role' => 'owner']);
        Schema::table('users', fn (Blueprint $table) => $table->dropColumn('active'));
    }
};
