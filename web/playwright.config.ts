import { defineConfig } from '@playwright/test'
import fs from 'node:fs'

const executablePath = process.env.CHROMIUM_PATH || (fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined)
export default defineConfig({
  testDir: './tests', timeout: 45000, workers: 1, fullyParallel: false,
  reporter: 'list', outputDir: 'test-results',
  use: { baseURL: process.env.FLASHNEXT_TEST_BASE_URL || 'http://127.0.0.1:19005',
    browserName: 'chromium', headless: true, viewport: { width: 1200, height: 850 },
    launchOptions: { executablePath, args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=user-gesture-required'] },
    screenshot: 'only-on-failure', trace: 'retain-on-failure',
  },
})
