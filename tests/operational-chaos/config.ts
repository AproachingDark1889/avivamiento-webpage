// tests/operational-chaos/config.ts
// Configuration, cuadruple guarda, and safe env parsing for Operational Chaos

import '../test-config'

export function isOperationalChaosEnabled(): boolean {
  return process.env.TEST_ALLOW_OPERATIONAL_CHAOS === 'true'
}

export function assertOperationalChaosEnabled(): void {
  if (!isOperationalChaosEnabled()) {
    throw new Error('Operational Chaos is not enabled. Set TEST_ALLOW_OPERATIONAL_CHAOS=true.')
  }
  
  const targetEnv = process.env.TEST_TARGET_ENV
  if (targetEnv !== 'local' && targetEnv !== 'staging' && targetEnv !== 'test') {
    throw new Error('TEST_TARGET_ENV must be local, staging, or test.')
  }
  
  const ack = process.env.TEST_OPERATIONAL_CHAOS_ACK
  if (ack !== 'I_UNDERSTAND_THIS_MUTATES_DB') {
    throw new Error('TEST_OPERATIONAL_CHAOS_ACK is missing or invalid.')
  }

  const projectRef = process.env.TEST_ALLOWED_SUPABASE_PROJECT_REF
  if (!projectRef) {
    throw new Error('TEST_ALLOWED_SUPABASE_PROJECT_REF is required.')
  }

  const supabaseUrl = process.env.TEST_SUPABASE_URL || process.env.SUPABASE_URL || ''
  
  try {
    const urlObj = new URL(supabaseUrl)
    const hostname = urlObj.hostname
    
    if (targetEnv === 'local') {
      if (hostname !== 'localhost' && hostname !== '127.0.0.1') {
        throw new Error('CRITICAL ABORT: Local target env requires localhost or 127.0.0.1 in URL.')
      }
    } else {
      if (!hostname.endsWith('.supabase.co')) {
        throw new Error('CRITICAL ABORT: Supabase Cloud URL must end with .supabase.co')
      }
      const extractedRef = hostname.replace('.supabase.co', '')
      if (extractedRef !== projectRef) {
        throw new Error('CRITICAL ABORT: Project Ref mismatch.')
      }
    }
  } catch (err: any) {
    throw new Error('CRITICAL ABORT: Invalid Supabase URL parsing: ' + err.message)
  }
}

export function createRunId(): string {
  const randomSuffix = Math.random().toString(36).substring(2, 7)
  return 'avivacheck-chaos-' + Date.now().toString() + '-' + randomSuffix
}

export function getServiceKeySafe(): string {
  assertOperationalChaosEnabled() // ALWAYS VALIDATE FIRST
  const key = process.env.TEST_SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) throw new Error('Missing service key (TEST_SUPABASE_SERVICE_KEY or SUPABASE_SERVICE_ROLE_KEY)')
  return key
}

export function getSupabaseUrlSafe(): string {
  assertOperationalChaosEnabled()
  const url = process.env.TEST_SUPABASE_URL || process.env.SUPABASE_URL
  if (!url) throw new Error('Missing Supabase URL (TEST_SUPABASE_URL or SUPABASE_URL)')
  return url
}

export function getTestPasswordSafe(): string {
  assertOperationalChaosEnabled()
  const pwd = process.env.TEST_OPERATIONAL_CHAOS_PASSWORD || process.env.TEST_PASSWORD || '123456'
  if (!pwd) throw new Error('Missing test password')
  return pwd
}

export function assertPhase2BExecutionAllowed(): void {
  assertOperationalChaosEnabled()
  if (process.env.TEST_ALLOW_OPERATIONAL_CHAOS_PHASE_2B !== 'true') {
    throw new Error('Fase 2B no autorizada. Falta bandera TEST_ALLOW_OPERATIONAL_CHAOS_PHASE_2B=true.')
  }
}
