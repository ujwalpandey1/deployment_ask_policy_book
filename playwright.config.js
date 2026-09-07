import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser', timeout: 30000, fullyParallel: false, workers: 1,
  reporter: [['list'], ['html', { outputFolder: 'results/browser-report', open: 'never' }]], use: { baseURL: 'http://127.0.0.1:4602', browserName: 'chromium', headless: true, reducedMotion: 'reduce', viewport: { width: 1440, height: 1000 }, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: { command: 'node src/server.js', url: 'http://127.0.0.1:4602/healthz', reuseExistingServer: false,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 5000 },
    env: { PORT: '4602', HOST: '127.0.0.1', AUTH_MODE: 'demo', GENERATION_MODE: 'extractive', DATA_DIR: `runtime/browser-tests/${process.pid}-${Date.now()}` } },
});
