import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 45000,
  workers: 1,
  retries: 0, // An uncertain business write must never be replayed by a runner.
  outputDir: '.test-artifacts/playwright/results',
  reporter: [['list'], ['json', { outputFile: '.test-artifacts/playwright/report.json' }]],
  use: {
    headless: process.env.JEVSTEER_E2E_HEADED !== '1',
    launchOptions: { executablePath: process.env.JEVSTEER_TEST_EXECUTABLE_PATH },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
