import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';
const sync = process.env.KIRINJI_SYNC_TEST === '1';
export default defineConfig({
  testDir: './tests',
  timeout: 30000,
  workers: 1,
  use: {
    baseURL: sync ? 'http://127.0.0.1:3001' : 'http://127.0.0.1:3002',
    viewport: { width: 1440, height: 1000 },
    launchOptions: { executablePath: process.env.CHROMIUM_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined), args: ['--no-sandbox'] },
  },
  projects: [{ name: 'ui', testMatch: 'ui.spec.ts' }, { name: 'sync', testMatch: 'sync.spec.ts' }],
  webServer: {
    command: sync ? 'npm run dev -- --port 3001 --strictPort' : 'npm run dev -- --port 3002 --strictPort',
    url: sync ? 'http://127.0.0.1:3001' : 'http://127.0.0.1:3002',
    reuseExistingServer: false,
    env: sync ? {
      VITE_FIREBASE_CONFIG: JSON.stringify({ projectId: 'demo-kirinji', apiKey: 'demo-key', appId: 'demo-app', firestoreDatabaseId: '(default)' }),
      VITE_FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
    } : {},
  },
});
