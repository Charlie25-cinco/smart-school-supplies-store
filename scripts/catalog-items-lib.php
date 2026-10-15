<?php

// Shared SQLite/MySQL-to-catalog mapping for the exporter and the local
// preview router. The store database is only ever read, never written.
// A null $sourceFile means the store default (MySQL via store-app/.env);
// an explicit path means a SQLite file (snapshot-copied first).
// Returns ['items' => ..., 'skipped' => [...], 'rows' => int].
// Throws RuntimeException when the source cannot be read.
function readCatalogItems(string $root, ?string $sourceFile, bool $copyPhotos, callable $warn): array
{
    $cleanup = function (): void {};
    if ($sourceFile === null) {
        $config = loadStoreDbConfig($root);
        if (($config['DB_CONNECTION'] ?? '') !== 'mysql') {
            throw new RuntimeException('The store database is not MySQL.');
        }
        foreach (['DB_HOST', 'DB_PORT', 'DB_DATABASE', 'DB_USERNAME'] as $key) {
            if (!isset($config[$key]) || $config[$key] === '') {
                throw new RuntimeException("Store configuration is missing {$key}.");
            }
        }
        if (!isset($config['DB_PASSWORD'])) {
            throw new RuntimeException('Store configuration is missing DB_PASSWORD.');
        }
        $db = new PDO(
            "mysql:host={$config['DB_HOST']};port={$config['DB_PORT']};dbname={$config['DB_DATABASE']};charset=utf8mb4",
            $config['DB_USERNAME'],
            $config['DB_PASSWORD'],
            [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]
        );
        $columns = array_column($db->query('SHOW COLUMNS FROM products')->fetchAll(PDO::FETCH_ASSOC), 'Field');
    } else {
        $realSource = realpath($sourceFile);
        if ($realSource === false || !is_file($realSource)) {
            throw new RuntimeException("Source database not found: {$sourceFile}");
        }
        // Snapshot first so the live file is only ever read, never locked for writing.
        $snapshot = tempnam(sys_get_temp_dir(), 'catalog-items-');
        if ($snapshot === false || !copy($realSource, $snapshot)) {
            throw new RuntimeException('Could not snapshot the source database.');
        }
        $cleanup = function () use ($snapshot): void {
            unlink($snapshot);
        };
        try {
            $db = new PDO('sqlite:' . $snapshot, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
            $db->exec('PRAGMA query_only = ON');
            $columns = array_column($db->query('PRAGMA table_info(products)')->fetchAll(PDO::FETCH_ASSOC), 'name');
        } catch (Throwable $error) {
            $cleanup();
            throw new RuntimeException('Could not read products: ' . $error->getMessage());
        }
    }
    try {
        $hasDescription = in_array('description', $columns, true);
        $hasImage = in_array('image_path', $columns, true);
        $select = 'sku, name, category, kind, price_cents, stock, reorder_level, active'
            . ($hasDescription ? ', description' : '')
            . ($hasImage ? ', image_path' : '');
        $rows = $db->query("SELECT {$select} FROM products ORDER BY category, name")->fetchAll(PDO::FETCH_ASSOC);
        $db = null; // Release any snapshot file lock before deleting it (Windows).
    } catch (Throwable $error) {
        $cleanup();
        throw new RuntimeException('Could not read products: ' . $error->getMessage());
    }
    $cleanup();

    $artFor = function (string $category, string $kind): string {
        $text = strtolower($category . ' ' . $kind);
        foreach (['paper' => 'paper', 'stapler' => 'stapler', 'bag' => 'bag', 'folder' => 'folder', 'envelope' => 'folder', 'pencil' => 'pencils', 'pen' => 'pen', 'print' => 'paper', 'scan' => 'paper', 'bind' => 'notebook'] as $word => $art) {
            if (str_contains($text, $word)) {
                return $art;
            }
        }
        return 'notebook';
    };
    $colors = ['sage', 'peach', 'blue', 'yellow'];

    $items = [];
    $skipped = [];
    $photoDir = $root . '/catalog/assets/products';
    // The local disk root is storage/app/private on current Laravel; the
    // older storage/app location stays as a fallback for existing files.
    $storageDirs = [$root . '/store-app/storage/app/private', $root . '/store-app/storage/app'];
    foreach ($rows as $row) {
        if (!$row['active'] || !in_array($row['kind'], ['product', 'service'], true)) {
            continue; // Inactive items and internal consumables never reach the public catalog.
        }
        $sku = (string) $row['sku'];
        $price = (int) $row['price_cents'];
        if (!preg_match('/^[A-Za-z0-9-]{1,40}$/', $sku) || trim((string) $row['name']) === '' || $price < 1) {
            $skipped[] = $sku;
            continue;
        }
        $image = null;
        $stored = $hasImage ? (string) ($row['image_path'] ?? '') : '';
        if ($row['kind'] === 'product' && $stored !== '') {
            $extension = strtolower(pathinfo($stored, PATHINFO_EXTENSION));
            $sourceFile = null;
            foreach ($storageDirs as $candidateDir) {
                if (is_file($candidateDir . '/' . $stored)) {
                    $sourceFile = $candidateDir . '/' . $stored;
                    break;
                }
            }
            if (!str_starts_with($stored, 'product-images/') || str_contains($stored, '..')
                || !in_array($extension, ['jpg', 'jpeg', 'png', 'webp'], true) || $sourceFile === null) {
                $warn("WARNING: {$sku} photo is missing or unsupported; exporting without a photo.\n");
            } else {
                $image = 'assets/products/' . $sku . '.' . $extension;
                if ($copyPhotos) {
                    if (!is_dir($photoDir) && !mkdir($photoDir, 0777, true)) {
                        throw new RuntimeException("Could not create {$photoDir}");
                    }
                    if (!copy($sourceFile, $root . '/catalog/' . $image)) {
                        throw new RuntimeException("Could not copy the {$sku} photo.");
                    }
                }
            }
        }
        $items[] = [
            'sku' => $sku,
            'name' => trim((string) $row['name']),
            'category' => trim((string) $row['category']) !== '' ? trim((string) $row['category']) : 'School Essentials',
            'kind' => $row['kind'],
            'price_cents' => $price,
            'stock' => $row['kind'] === 'service' ? 0 : (int) $row['stock'],
            'reorder_level' => (int) $row['reorder_level'],
            'description' => $hasDescription ? (string) $row['description'] : '',
            'image' => $image,
            'art' => $artFor((string) $row['category'], (string) $row['kind']),
            'color' => $colors[abs(crc32($sku)) % count($colors)],
        ];
    }

    return ['items' => $items, 'skipped' => $skipped, 'rows' => count($rows)];
}

// Minimal store-app/.env reader for connection values only. Values are
// returned, never printed — callers must not log them either.
function loadStoreDbConfig(string $root): array
{
    $values = [];
    $file = $root . '/store-app/.env';
    if (!is_file($file)) {
        return $values;
    }
    foreach (file($file, FILE_IGNORE_NEW_LINES) as $line) {
        $line = trim($line);
        if ($line === '' || str_starts_with($line, '#')) {
            continue;
        }
        $position = strpos($line, '=');
        if ($position === false) {
            continue;
        }
        $key = trim(substr($line, 0, $position));
        $value = trim(substr($line, $position + 1));
        if (strlen($value) >= 2 && (($value[0] === '"' && $value[-1] === '"') || ($value[0] === "'" && $value[-1] === "'"))) {
            $value = stripcslashes(substr($value, 1, -1));
        }
        $values[$key] = $value;
    }

    return $values;
}
