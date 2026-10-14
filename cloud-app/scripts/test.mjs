import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const tests = readdirSync('tests').filter(name => /\.test\.(?:ts|mjs|js)$/.test(name)).sort().map(name => 'tests/'+name);
if (!tests.length) throw new Error('Cloud verification tests are missing.');
const result = spawnSync(process.execPath, ['--import', 'tsx', '--test', '--test-concurrency=1', ...tests], {stdio:'inherit',windowsHide:true});
process.exitCode = result.status ?? 1;
