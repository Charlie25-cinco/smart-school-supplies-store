import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

const requireCloud = createRequire(new URL('../../cloud-app/package.json', import.meta.url));

/** Empty disposable engine for mocked browser RPCs; never reads real data. */
export async function createDatabaseFixture() {
  const { PGlite } = requireCloud('@electric-sql/pglite');
  const database = new PGlite();
  try {
    await database.waitReady;
    await database.exec(await readFile(new URL('./bootstrap.sql', import.meta.url), 'utf8'));
    const migrationDirectory = new URL('../migrations/', import.meta.url);
    const migrations = (await readdir(migrationDirectory)).filter(name => name.endsWith('.sql')).sort();
    assert.ok(migrations.length >= 3, 'the complete schema, rules, and RPC migrations must exist');
    for (const migration of migrations) {
      try {
        await database.exec(await readFile(new URL(migration, migrationDirectory), 'utf8'));
      } catch (error) {
        throw new Error(`Migration ${migration} failed: ${error.message}`, { cause: error });
      }
    }
    return { database, migrations };
  } catch (error) {
    await database.close();
    throw error;
  }
}

/** Always uses a new in-memory PostgreSQL engine; never reads a real database. */
export async function runDatabaseTests() {
  const { database, migrations } = await createDatabaseFixture();
  try {
    for (const fixture of ['workflow.sql', 'recovery.sql', 'authorization.sql', 'account-operations.sql']) {
      try {
        await database.exec(await readFile(new URL(fixture, import.meta.url), 'utf8'));
      } catch (error) {
        throw new Error(`Isolated fixture ${fixture} failed: ${error.message}`, { cause: error });
      }
    }
    const checks = await database.query('select label from store_tests.checks order by label');
    assert.ok(checks.rows.length >= 75, 'financial, lease, role, allocation, idempotency, and recovery assertions must run');
    return { assertions: checks.rows.length, migrations: migrations.length };
  } finally {
    await database.close();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fileURLToPath(pathToFileURL(process.argv[1]))) {
  try {
    const result = await runDatabaseTests();
    console.log(`PASS: ${result.migrations} PostgreSQL migrations; ${result.assertions} isolated SQL assertions.`);
  } catch (error) {
    console.error('FAIL: '+error.message);
    process.exitCode=1;
  }
}
