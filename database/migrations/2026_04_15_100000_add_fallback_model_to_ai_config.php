<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('ai_config', function (Blueprint $table) {
            // Modelo local al que caer cuando el primario falla o no tiene tokens.
            // Default 'qwen3' por ser el local actual en la API aiapi.hawkins.es.
            $table->string('fallback_model', 100)->nullable()->after('secondary_model');
        });

        // Poblar con 'qwen3' si aún no se ha configurado.
        \Illuminate\Support\Facades\DB::table('ai_config')
            ->whereNull('fallback_model')
            ->update(['fallback_model' => 'qwen3']);
    }

    public function down(): void
    {
        Schema::table('ai_config', function (Blueprint $table) {
            $table->dropColumn('fallback_model');
        });
    }
};
