import { config } from '../config.mjs';
import { KaptureDriver } from './kapture-driver.mjs';
import { PlaywrightDriver } from './playwright-driver.mjs';

export function createBrowserDriver({ kind = config.browserDriver, ...options } = {}) {
  if (kind === 'kapture') return new KaptureDriver(options);
  if (kind === 'playwright') return new PlaywrightDriver(options);
  throw new Error(`BROWSER_CONFIG: unknown driver ${kind}`);
}
export { KaptureDriver, PlaywrightDriver };
