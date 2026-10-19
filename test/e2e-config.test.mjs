import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('E2E output overrides stay scoped below the private artifact directory', () => {
  for (const output of ['.', '.test-artifacts', '../outside', '.test-artifacts/../../outside']) {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', "await import('./playwright.config.mjs')"], { encoding: 'utf8', env: { ...process.env, JEVSTEER_E2E_OUTPUT: output } });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /E2E output must be a subdirectory/);
  }
  const valid = spawnSync(process.execPath, ['--input-type=module', '-e', "await import('./playwright.config.mjs')"], { encoding: 'utf8', env: { ...process.env, JEVSTEER_E2E_OUTPUT: '.test-artifacts/isolated-validation' } });
  assert.equal(valid.status, 0, valid.stderr);
});
