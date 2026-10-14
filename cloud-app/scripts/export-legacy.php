<?php

declare(strict_types=1);

/** Private CLI tooling. Never include this file in a public deployment. */
class LegacyExportError extends RuntimeException {}

function makeMigrationDirectoryPrivate(string $directory): void
{
    if (PHP_OS_FAMILY !== 'Windows') {
        if (! chmod($directory, 0700)) {
            throw new LegacyExportError('Private directory permissions could not be set.');
        }

        return;
    }
    // Pass the path as an environment value, never interpolate it into shell code.
    $script = <<<'POWERSHELL'
$ErrorActionPreference = 'Stop'
$migrationPath = $env:STORE_MIGRATION_DIRECTORY
$migrationSid = [Security.Principal.WindowsIdentity]::GetCurrent().User
$migrationAcl = New-Object Security.AccessControl.DirectorySecurity
$migrationAcl.SetAccessRuleProtection($true, $false)
$migrationRights = [Security.AccessControl.FileSystemRights]::FullControl
$migrationInheritance = [Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit'
$migrationPropagation = [Security.AccessControl.PropagationFlags]::None
$migrationType = [Security.AccessControl.AccessControlType]::Allow
$migrationAcl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($migrationSid, $migrationRights, $migrationInheritance, $migrationPropagation, $migrationType)))
$migrationSystem = New-Object Security.Principal.SecurityIdentifier('S-1-5-18')
$migrationAcl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($migrationSystem, $migrationRights, $migrationInheritance, $migrationPropagation, $migrationType)))
Set-Acl -LiteralPath $migrationPath -AclObject $migrationAcl
$migrationResult = Get-Acl -LiteralPath $migrationPath
if (-not $migrationResult.AreAccessRulesProtected) { throw 'Private ACL verification failed.' }
foreach ($migrationRule in $migrationResult.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
  if ($migrationRule.AccessControlType -eq 'Allow' -and $migrationRule.IdentityReference.Value -notin @($migrationSid.Value, 'S-1-5-18')) { throw 'Unexpected private-directory access.' }
}
POWERSHELL;
    $environment = getenv();
    $environment['STORE_MIGRATION_DIRECTORY'] = $directory;
    $process = proc_open(['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', $script],
        [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes, null, $environment);
    if (! is_resource($process)) {
        throw new LegacyExportError('Private directory permissions could not be set.');
    }
    fclose($pipes[0]);
    stream_get_contents($pipes[1]);
    stream_get_contents($pipes[2]);
    fclose($pipes[1]);
    fclose($pipes[2]);
    if (proc_close($process) !== 0) {
        throw new LegacyExportError('Private directory permissions could not be verified. No export was written.');
    }
}

function migrationUuid(): string
{
    $bytes = random_bytes(16);
    $bytes[6] = chr((ord($bytes[6]) & 0x0F) | 0x40);
    $bytes[8] = chr((ord($bytes[8]) & 0x3F) | 0x80);
    $hex = bin2hex($bytes);

    return substr($hex, 0, 8).'-'.substr($hex, 8, 4).'-'.substr($hex, 12, 4).'-'.substr($hex, 16, 4).'-'.substr($hex, 20);
}

/** Creates a verified online snapshot and credential-bearing PRIVATE bundle. */
function exportLegacyDatabase(string $sourcePath, string $outputDirectory): array
{
    if (! class_exists(SQLite3::class)) {
        throw new LegacyExportError('PHP SQLite3 is required for a consistent online backup.');
    }
    $source = realpath($sourcePath);
    if ($source === false || ! is_file($source)) {
        throw new LegacyExportError('An explicit existing SQLite source file is required.');
    }
    if (file_exists($outputDirectory)) {
        throw new LegacyExportError('Use a new private output directory. Existing bundles are never overwritten.');
    }
    $parent = realpath(dirname($outputDirectory));
    if ($parent === false || ! is_dir($parent)) {
        throw new LegacyExportError('Create the private parent directory before exporting.');
    }
    $privateRoot = realpath(__DIR__.'/../../.runtime');
    if ($privateRoot === false || ($parent !== $privateRoot && ! str_starts_with($parent, $privateRoot.DIRECTORY_SEPARATOR))) {
        throw new LegacyExportError('Export only inside the ignored private .runtime directory.');
    }
    $directory = $parent.DIRECTORY_SEPARATOR.basename($outputDirectory);
    if (! mkdir($directory, 0700)) {
        throw new LegacyExportError('The private backup directory could not be created.');
    }
    makeMigrationDirectoryPrivate($directory);
    $backupPath = $directory.DIRECTORY_SEPARATOR.'database.snapshot.sqlite';
    $reader = new SQLite3($source, SQLITE3_OPEN_READONLY);
    $reader->enableExceptions(true);
    $reader->busyTimeout(5000);
    $backup = new SQLite3($backupPath, SQLITE3_OPEN_READWRITE | SQLITE3_OPEN_CREATE);
    $backup->enableExceptions(true);
    try {
        if (! $reader->backup($backup)) {
            throw new LegacyExportError('A consistent SQLite online backup could not be completed.');
        }
    } finally {
        $reader->close();
    }
    try {
        if ($backup->querySingle('PRAGMA integrity_check') !== 'ok') {
            throw new LegacyExportError('The private SQLite snapshot failed integrity verification.');
        }
        $foreignKeys = $backup->query('PRAGMA foreign_key_check');
        if ($foreignKeys->fetchArray(SQLITE3_ASSOC) !== false) {
            throw new LegacyExportError('The private SQLite snapshot contains unresolved foreign-key errors.');
        }
        $columns = [
            'users' => ['id', 'name', 'email', 'password', 'role', 'active', 'created_at', 'updated_at'],
            'products' => ['id', 'sku', 'name', 'category', 'kind', 'price_cents', 'stock', 'reserved', 'reorder_level', 'active', 'created_at', 'updated_at'],
            'sales' => ['id', 'reference', 'user_id', 'channel', 'total_cents', 'cash_cents', 'change_cents', 'payment_method', 'payment_reference', 'delivery_fee_cents', 'created_at', 'updated_at'],
            'orders' => ['id', 'reference', 'user_id', 'sale_id', 'paid_by', 'channel', 'fulfillment', 'payment_plan', 'status', 'customer_name', 'customer_phone', 'delivery_address', 'notes', 'cancel_reason', 'subtotal_cents', 'delivery_fee_cents', 'total_cents', 'assigned_cashier_id', 'assigned_by', 'assigned_at', 'assignment_version', 'created_at', 'updated_at'],
            'sale_items' => ['id', 'sale_id', 'product_id', 'name', 'sku', 'kind', 'quantity', 'price_cents', 'total_cents'],
            'order_items' => ['id', 'order_id', 'product_id', 'name', 'sku', 'kind', 'quantity', 'price_cents', 'total_cents'],
            'stock_movements' => ['id', 'product_id', 'user_id', 'sale_id', 'quantity', 'reason', 'created_at', 'updated_at'],
        ];
        $data = [];
        $counts = [];
        foreach ($columns as $table => $fields) {
            // Table/column names come ONLY from the hard-coded whitelist above.
            $known = [];
            $metadata = $backup->query('PRAGMA table_info("'.$table.'")');
            while ($column = $metadata->fetchArray(SQLITE3_ASSOC)) {
                $known[] = $column['name'];
            }
            if (array_diff($fields, $known)) {
                throw new LegacyExportError('The source schema is not the current local version. Upgrade it privately before migration.');
            }
            $result = $backup->query('SELECT "'.implode('", "', $fields).'" FROM "'.$table.'" ORDER BY id');
            $rows = [];
            while ($row = $result->fetchArray(SQLITE3_ASSOC)) {
                $rows[] = $row;
            }
            $data[$table] = $rows;
            $counts[$table] = count($rows);
        }
    } finally {
        $backup->close();
    }
    $encodedData = json_encode($data, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    if (strlen($encodedData) > 16000000) {
        throw new LegacyExportError('This snapshot exceeds the supported 16 MB atomic migration size. Keep the backup and arrange a larger controlled migration.');
    }
    $bundle = [
        'format' => 'smart-school-supplies-legacy-v1',
        'import_id' => migrationUuid(),
        'created_at' => gmdate('Y-m-d\TH:i:s\Z'),
        'backup_sha256' => hash_file('sha256', $backupPath),
        'data_sha256' => hash('sha256', $encodedData),
        'counts' => $counts,
        // Keep exact serialized bytes for cross-language digest verification.
        'data_json' => $encodedData,
    ];
    $exportPath = $directory.DIRECTORY_SEPARATOR.'legacy.private.json';
    $export = fopen($exportPath, 'x');
    if ($export === false) {
        throw new LegacyExportError('The private export could not be created.');
    }
    try {
        $bytes = json_encode($bundle, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES);
        if (fwrite($export, $bytes) !== strlen($bytes)) {
            throw new LegacyExportError('The private export could not be written completely.');
        }
        fflush($export);
    } finally {
        fclose($export);
    }
    if (PHP_OS_FAMILY !== 'Windows') {
        chmod($backupPath, 0600);
        chmod($exportPath, 0600);
    }

    return ['export_path' => $exportPath, 'counts' => $counts, 'backup_verified' => true];
}

if (isset($_SERVER['SCRIPT_FILENAME']) && realpath($_SERVER['SCRIPT_FILENAME']) === __FILE__) {
    $options = getopt('', ['source:', 'output:']);
    if (! isset($options['source'], $options['output'])) {
        fwrite(STDERR, "Usage: php export-legacy.php --source=<SQLite path> --output=<new private directory>\n");
        exit(1);
    }
    try {
        $result = exportLegacyDatabase($options['source'], $options['output']);
        fwrite(STDOUT, 'Verified private backup and export created. Whitelisted rows: '.array_sum($result['counts']).". No credentials or records were printed.\n");
    } catch (Throwable $error) {
        // SQLite/JSON exceptions can contain data. Only our fixed safe diagnostics
        // are shown; no SQL DETAIL, hash, email, or customer field is printed.
        $message = $error instanceof LegacyExportError
            ? $error->getMessage() : 'Private export failed. Preserve the snapshot and inspect it privately.';
        fwrite(STDERR, $message."\n");
        exit(1);
    }
}
