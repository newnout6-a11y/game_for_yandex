import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('the enforced Python audit rejects real exported NORMAL corruption', () => {
  const result = spawnSync('python3', [fileURLToPath(new URL('./garage-normal-audit.py', import.meta.url))], {
    encoding: 'utf8', timeout: 30_000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
