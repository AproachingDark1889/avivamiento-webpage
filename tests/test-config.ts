// tests/test-config.ts
// ============================================================================
// SHARED CONFIGURATION for all E2E test suites
// Centralizes Supabase credentials, base URL, and test user accounts.
// Values are securely loaded from .env or system environment variables.
// ============================================================================

import * as fs from 'fs'
import * as path from 'path'

// Helper to manually parse .env if process env vars aren't set (e.g. running Playwright directly)
try {
  const envPath = path.resolve(process.cwd(), '.env')
  if (fs.existsSync(envPath)) {
    const envConfig = fs.readFileSync(envPath, 'utf-8')
    for (const line of envConfig.split('\n')) {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/)
      if (match) {
        const key = match[1]
        let val = (match[2] || '').trim()
        if (val.startsWith('"') && val.endsWith('"')) {
          val = val.substring(1, val.length - 1)
        } else if (val.startsWith("'") && val.endsWith("'")) {
          val = val.substring(1, val.length - 1)
        }
        if (!process.env[key]) {
          process.env[key] = val
        }
      }
    }
  }
} catch (e) {
  // Ignorar errores al cargar el .env
}

export const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3002/sistema'

export const SUPABASE_URL = process.env.TEST_SUPABASE_URL || process.env.SUPABASE_URL || ''
export const SUPABASE_ANON_KEY = process.env.TEST_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''
export const TEST_PASSWORD = process.env.TEST_PASSWORD || process.env.TEST_OPERATIONAL_CHAOS_PASSWORD || '123456'

export function validateTestCredentials() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !TEST_PASSWORD) {
    throw new Error('SUPABASE_URL, SUPABASE_ANON_KEY, and TEST_PASSWORD must be defined in the environment or .env file.')
  }
}

export const USERS = {
  admin:         { email: 'admin@genesis.com',       password: TEST_PASSWORD },
  cashierAlpha:  { email: 'cajero.alpha@test.com',   password: TEST_PASSWORD },
  kitchenAlpha:  { email: 'cocina.alpha@test.com',   password: TEST_PASSWORD },
  leaderAlpha:   { email: 'leader.alpha@test.com',   password: TEST_PASSWORD },
  cashierBeta:   { email: 'cajero.beta@test.com',    password: TEST_PASSWORD },
  kitchenBeta:   { email: 'cocina.beta@test.com',    password: TEST_PASSWORD },
  leaderBeta:    { email: 'leader.beta@test.com',    password: TEST_PASSWORD },
} as const

