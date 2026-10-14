<?php
declare(strict_types=1);

// Fictional fixture only. Argument is a NEW path owned by the isolated test.
if ($argc !== 2 || file_exists($argv[1])) {
    fwrite(STDERR, "Use a new fictional fixture path.\n");
    exit(1);
}
$database = new SQLite3($argv[1], SQLITE3_OPEN_READWRITE | SQLITE3_OPEN_CREATE);
$database->enableExceptions(true);
$database->exec('PRAGMA journal_mode=WAL');
$database->exec('PRAGMA wal_autocheckpoint=0');
$database->exec('PRAGMA foreign_keys=ON');
$database->exec(<<<'SQL'
CREATE TABLE users(id INTEGER PRIMARY KEY,name TEXT,email TEXT,password TEXT,role TEXT,active INTEGER,remember_token TEXT,created_at TEXT,updated_at TEXT);
CREATE TABLE products(id INTEGER PRIMARY KEY,sku TEXT,name TEXT,category TEXT,kind TEXT,price_cents INTEGER,stock INTEGER,reserved INTEGER,reorder_level INTEGER,active INTEGER,created_at TEXT,updated_at TEXT);
CREATE TABLE sales(id INTEGER PRIMARY KEY,reference TEXT,user_id INTEGER REFERENCES users(id),channel TEXT,total_cents INTEGER,cash_cents INTEGER,change_cents INTEGER,payment_method TEXT,payment_reference TEXT,delivery_fee_cents INTEGER,created_at TEXT,updated_at TEXT);
CREATE TABLE orders(id INTEGER PRIMARY KEY,reference TEXT,user_id INTEGER REFERENCES users(id),sale_id INTEGER REFERENCES sales(id),paid_by INTEGER REFERENCES users(id),channel TEXT,fulfillment TEXT,payment_plan TEXT,status TEXT,customer_name TEXT,customer_phone TEXT,delivery_address TEXT,notes TEXT,cancel_reason TEXT,subtotal_cents INTEGER,delivery_fee_cents INTEGER,total_cents INTEGER,assigned_cashier_id INTEGER REFERENCES users(id),assigned_by INTEGER REFERENCES users(id),assigned_at TEXT,assignment_version INTEGER,created_at TEXT,updated_at TEXT);
CREATE TABLE sale_items(id INTEGER PRIMARY KEY,sale_id INTEGER REFERENCES sales(id),product_id INTEGER REFERENCES products(id),name TEXT,sku TEXT,kind TEXT,quantity INTEGER,price_cents INTEGER,total_cents INTEGER);
CREATE TABLE order_items(id INTEGER PRIMARY KEY,order_id INTEGER REFERENCES orders(id),product_id INTEGER REFERENCES products(id),name TEXT,sku TEXT,kind TEXT,quantity INTEGER,price_cents INTEGER,total_cents INTEGER);
CREATE TABLE stock_movements(id INTEGER PRIMARY KEY,product_id INTEGER REFERENCES products(id),user_id INTEGER REFERENCES users(id),sale_id INTEGER REFERENCES sales(id),quantity INTEGER,reason TEXT,created_at TEXT,updated_at TEXT);
CREATE TABLE sessions(id TEXT,payload TEXT);
INSERT INTO sessions VALUES('fictional-session','fictional-private-session-payload');
SQL);
$hash = password_hash('fictional-test-credential-only', PASSWORD_BCRYPT);
$statement = $database->prepare("INSERT INTO users VALUES(:id,:name,:email,:password,:role,:active,'fictional-remember-token','2026-01-01 10:00:00','2026-01-01 10:00:00')");
foreach ([[10, 'Fictional Admin', 'Admin@example.invalid', 'owner', 1], [20, 'Fictional Cashier', 'cashier@example.invalid', 'cashier', 1], [30, 'Fictional Inactive', 'inactive@example.invalid', 'cashier', 0]] as $user) {
    $statement->bindValue(':id', $user[0], SQLITE3_INTEGER);
    $statement->bindValue(':name', $user[1], SQLITE3_TEXT);
    $statement->bindValue(':email', $user[2], SQLITE3_TEXT);
    $statement->bindValue(':password', $hash, SQLITE3_TEXT);
    $statement->bindValue(':role', $user[3], SQLITE3_TEXT);
    $statement->bindValue(':active', $user[4], SQLITE3_INTEGER);
    $statement->execute();
}
$database->exec(<<<'SQL'
INSERT INTO products VALUES(101,'CURRENT-PENCIL','Fictional current product','Writing','product',3000,10,2,3,1,'2026-01-01 10:00:00','2026-01-02 10:00:00');
INSERT INTO products VALUES(102,'CURRENT-SERVICE','Fictional current service','Service','service',500,0,0,0,1,'2026-01-01 10:00:00','2026-01-02 10:00:00');
INSERT INTO sales VALUES(40,'80000000-0000-4000-8000-000000000040',10,'messenger',3000,3000,0,'gcash','GCASH123',500,'2026-01-03 10:00:00','2026-01-03 10:00:00');
INSERT INTO sales VALUES(41,'80000000-0000-4000-8000-000000000041',20,'walk-in',500,500,0,'cash',NULL,0,'2026-01-03 11:00:00','2026-01-03 11:00:00');
INSERT INTO orders VALUES(50,'80000000-0000-4000-8000-000000000040',10,40,20,'messenger','delivery','prepaid','completed','Fictional Paid Customer','09000000000','Fictional delivered address',NULL,NULL,2500,500,3000,20,10,'2026-01-02 10:00:00',2,'2026-01-02 09:00:00','2026-01-05 10:00:00');
INSERT INTO orders VALUES(51,'80000000-0000-4000-8000-000000000051',20,NULL,NULL,'walk-in','pickup','cod','preparing','Fictional Unpaid Customer','09000000000',NULL,NULL,NULL,4000,0,4000,NULL,NULL,NULL,0,'2026-01-03 10:00:00','2026-01-03 10:00:00');
INSERT INTO sale_items VALUES(70,40,101,'Fictional original product','FROZEN-PENCIL','product',1,2500,2500);
INSERT INTO sale_items VALUES(71,41,102,'Fictional original service','FROZEN-SERVICE','service',1,500,500);
INSERT INTO order_items VALUES(60,50,101,'Fictional original product','FROZEN-PENCIL','product',1,2500,2500);
INSERT INTO order_items VALUES(61,51,101,'Fictional agreed product','AGREED-PENCIL','product',2,2000,4000);
INSERT INTO stock_movements VALUES(80,101,10,NULL,11,'Fictional opening stock','2026-01-01 10:00:00','2026-01-01 10:00:00');
INSERT INTO stock_movements VALUES(81,101,20,40,-1,'Fictional paid order movement','2026-01-03 10:00:00','2026-01-03 10:00:00');
SQL);
// Keep committed rows in WAL while the exporter runs. A raw main-file copy would
// omit these records; SQLite's online backup includes a consistent snapshot.
fwrite(STDOUT, "FICTIONAL_FIXTURE_READY\n");
fflush(STDOUT);
fgets(STDIN);
$database->close();
