import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

// Pass explicit paths so Windows/Node20 does not depend on shell globbing.
const files = (await readdir('test')).filter((name) => name.endsWith('.test.mjs')).map((name) => `test/${name}`);
const result = spawnSync(process.execPath, ['--test', ...process.argv.slice(2), ...files], { stdio: 'inherit' });
process.exit(result.status ?? 1);
