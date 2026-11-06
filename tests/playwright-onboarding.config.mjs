import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: '.', testMatch: 'test-cloud-onboarding.spec.mjs', workers: 1, fullyParallel: false, timeout: 60000, use: { headless: true, viewport: { width: 1440, height: 1000 } }, reporter: 'list', outputDir: '../tmp/onboarding-browser-results' });
