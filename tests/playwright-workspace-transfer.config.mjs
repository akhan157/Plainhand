import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: '.', testMatch: 'test-cloud-workspace-transfer.spec.mjs', workers: 1, timeout: 30000, use: { headless: true, viewport: { width: 1440, height: 1000 } }, reporter: 'list', outputDir: '../tmp/transfer-browser-results' });
