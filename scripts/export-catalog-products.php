<?php

// Exports public catalog items from the store database (read-only).
// Never writes to the database.
// Usage: php scripts/export-catalog-products.php [--source=sqlite-file] [--output=...] [--dry-run]
// Defaults: source is the store default (MySQL via store-app/.env), output catalog/products.json.

require __DIR__ . '/catalog-items-lib.php';

$options = getopt('', ['source::', 'output::', 'dry-run']);
$root = dirname(__DIR__);
$source = $options['source'] ?? null;
$output = $options['output'] ?? ($root . '/catalog/products.json');
$dryRun = array_key_exists('dry-run', $options);

$realOutput = $output;
foreach (['/catalog/', '/.runtime/'] as $allowed) {
    $prefix = $root . str_replace('/', DIRECTORY_SEPARATOR, $allowed);
    if (str_starts_with($output . DIRECTORY_SEPARATOR, $prefix) || $output === rtrim($prefix, DIRECTORY_SEPARATOR)) {
        $realOutput = $output;
        break;
    }
}
if ($realOutput !== $output || ($source !== null && realpath($source) === realpath($output))) {
    fwrite(STDERR, "Refusing to write outside catalog/ or .runtime/, or over the source.\n");
    exit(1);
}

try {
    $result = readCatalogItems($root, $source, !$dryRun, function (string $message): void {
        fwrite(STDERR, $message);
    });
} catch (RuntimeException $error) {
    fwrite(STDERR, $error->getMessage() . "\n");
    exit(1);
}
$items = $result['items'];
if ($result['skipped'] !== []) {
    fwrite(STDERR, 'Refusing to export with invalid rows: ' . implode(', ', $result['skipped']) . "\n");
    exit(1);
}

$json = json_encode($items, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) . "\n";
if ($dryRun) {
    $previous = is_file($output) ? json_decode((string) file_get_contents($output), true) : [];
    $before = [];
    foreach (is_array($previous) ? $previous : [] as $item) {
        $before[$item['sku']] = $item;
    }
    $after = [];
    foreach ($items as $item) {
        $after[$item['sku']] = $item;
    }
    foreach ($after as $sku => $item) {
        if (!isset($before[$sku])) {
            echo "ADD {$sku} {$item['name']} {$item['price_cents']}\n";
        } elseif ($before[$sku] != $item) {
            echo "CHANGE {$sku} {$item['name']} {$item['price_cents']}\n";
        }
    }
    foreach (array_diff_key($before, $after) as $sku => $item) {
        echo "REMOVE {$sku} {$item['name']}\n";
    }
    echo count($items) . ' catalog items from ' . $result['rows'] . " inventory rows (dry run, nothing written).\n";
    exit(0);
}
$parent = dirname($output);
if (!is_dir($parent) && !mkdir($parent, 0777, true)) {
    fwrite(STDERR, "Could not create {$parent}\n");
    exit(1);
}
if (file_put_contents($output, $json) === false) {
    fwrite(STDERR, "Could not write {$output}\n");
    exit(1);
}
echo count($items) . ' catalog items written to ' . $output . ".\n";
