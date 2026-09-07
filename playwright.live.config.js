import { defineConfig } from '@playwright/test';

// Deliberate opt-in: this suite uses the configured real provider and incurs cost.
export default defineConfig({
  testDir: './tests/live', timeout: 45000, expect: { timeout: 15000 },
  workers: 1, fullyParallel: false, retries: 0,
  reporter: [['list'], ['html', { outputFolder: 'results/live-browser-report', open: 'never' }]],
  outputDir: 'test-results/live',
  use: { baseURL: 'http://127.0.0.1:4603', browserName: 'chromium', headless: true,
    reducedMotion: 'reduce', viewport: { width: 1440, height: 1000 },
    trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: { command: 'node --env-file-if-exists=.env src/server.js', url: 'http://127.0.0.1:4603/healthz',
    reuseExistingServer: false, gracefulShutdown: { signal: 'SIGTERM', timeout: 5000 },
    env: { PORT: '4603', HOST: '127.0.0.1', AUTH_MODE: 'demo', GENERATION_MODE: 'model',
      SEMANTIC_SEARCH: 'on', SEMANTIC_CACHE_DIR: 'runtime/semantic',
      DATA_DIR: `runtime/live-browser-tests/${process.pid}-${Date.now()}` } },
});
