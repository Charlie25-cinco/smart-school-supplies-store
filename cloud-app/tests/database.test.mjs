import test from 'node:test';
import { runDatabaseTests } from '../../supabase/tests/runner.mjs';
test('fresh PostgreSQL schema, role, stock, financial and recovery fixtures', async () => {
  await runDatabaseTests();
});
