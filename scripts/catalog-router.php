<?php

// Local catalog preview router ONLY. This file lives outside catalog/ and is
// never published to Cloudflare. It answers /products.json live from the
// store database (read-only; snapshot-copied for SQLite) so a plain page
// reload shows new products with no preview restart; every other request is
// served statically as normal.
// Photo files referenced by the data are copied into catalog/assets/products/
// (derived artifacts, identical to the exporter output).

$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);
if ($path !== '/products.json') {
    return false;
}
require __DIR__ . '/catalog-items-lib.php';
$root = dirname(__DIR__);
try {
    $result = readCatalogItems($root, null, true, function (string $message): void {
        error_log(trim($message));
    });
    if ($result['skipped'] !== []) {
        throw new RuntimeException('Invalid rows cannot be previewed.');
    }
    header('Content-Type: application/json');
    echo json_encode($result['items'], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) . "\n";
} catch (RuntimeException $error) {
    error_log('Catalog preview: ' . $error->getMessage());
    http_response_code(500);
    header('Content-Type: text/plain');
    echo 'Catalog preview unavailable.';
}
