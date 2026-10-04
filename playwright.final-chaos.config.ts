import { defineConfig, devices } from '@playwright/test'


export default defineConfig({
  testDir: './tests',
  testMatch: /operational-chaos\/final-chaos-journey\.spec\.ts/,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 900000,
  expect: { timeout: 30000 },
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],

  use: {
    baseURL: 'http://localhost:3002/sistema',
    trace: 'on',
    screenshot: 'on',
    video: 'on',
  },

  projects: [
    {
      name: 'final-chaos-chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: {
    command: 'npm run dev',
    port: 3002,
    reuseExistingServer: true,
    timeout: 120000,
  },

  outputDir: 'tests/evidence/final-chaos',
})
