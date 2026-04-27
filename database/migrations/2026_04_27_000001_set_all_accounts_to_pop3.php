<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        // Set protocol to pop3 for all accounts
        DB::table('accounts')->update(['protocol' => 'pop3']);

        // Update imap_host: replace imap. prefix with pop. if present
        DB::statement("UPDATE accounts SET imap_host = CONCAT('pop.', SUBSTRING(imap_host, 6)) WHERE imap_host LIKE 'imap.%'");

        // Update imap_port: 143 → 110, 993 → 995
        DB::table('accounts')->where('imap_port', 143)->update(['imap_port' => 110]);
        DB::table('accounts')->where('imap_port', 993)->update(['imap_port' => 995]);
    }

    public function down(): void
    {
        // Cannot safely reverse host changes, just reset protocol
        DB::table('accounts')->update(['protocol' => 'imap']);
    }
};
