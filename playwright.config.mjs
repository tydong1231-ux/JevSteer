import { defineConfig } from '@playwright/test';
import { resolve, relative, isAbsolute, join } from 'node:path';

// Playwright clears its results directory on startup. Isolate concurrent runs
// without allowing an environment override to delete a broad/unrelated path.
const artifactRoot = resolve('.test-artifacts');
const output = resolve(process.env.JEVSTEER_E2E_OUTPUT || '.test-artifacts/playwright');
const scoped = relative(artifactRoot, output);
if (!scoped || scoped === '..' || scoped.startsWith('..\\') || scoped.startsWith('../') || isAbsolute(scoped)) throw new Error('E2E output must be a subdirectory of .test-artifacts');

export default defineConfig({
  testDir: './e2e',
  timeout: 45000,
  workers: 1,
  retries: 0, // An uncertain business write must never be replayed by a runner.
  outputDir: join(output, 'results'),
  reporter: [['list'], ['json', { outputFile: join(output, 'report.json') }]],
  use: {
    headless: process.env.JEVSTEER_E2E_HEADED !== '1',
    launchOptions: { executablePath: process.env.JEVSTEER_TEST_EXECUTABLE_PATH },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
