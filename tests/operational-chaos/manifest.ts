// tests/operational-chaos/manifest.ts
// Manifest interface and helpers. No sensitive secrets allowed.

import * as fs from 'fs'
import { assertOperationalChaosEnabled } from './config'

export interface MockSupabaseFilterBuilder extends Promise<{ data: any; error: any }> {
  eq(column: string, value: any): this;
  in(column: string, values: any[]): this;
  select(columns?: string): this;
  single(): this;
}

export interface MockSupabaseQueryBuilder {
  select(columns?: string): MockSupabaseFilterBuilder;
  insert(data: any): MockSupabaseFilterBuilder;
  update(data: any): MockSupabaseFilterBuilder;
  delete(): MockSupabaseFilterBuilder;
}

export interface MockSupabaseClient {
  from(table: string): MockSupabaseQueryBuilder;
  auth: {
    admin: {
      createUser(attrs: any): Promise<{ data: { user: any }; error: any }>;
      deleteUser(id: string): Promise<{ data: any; error: any }>;
    };
  };
}

export interface ChaosManifest {
  runId: string;
  organizations: { orgId: string, name: string }[];
  authUsers: { userId: string, email: string, role: string, orgId?: string | null }[];
  users: { userId: string, orgId: string, email: string, role: string }[];
  products: { productId: string, orgId: string }[];
  orders: { orderId: string, orgId: string }[];
  cashClosures: { closureId: string, orgId: string }[];
  evidencePaths: string[];
}

export function createEmptyManifest(runId: string): ChaosManifest {
  return {
    runId,
    organizations: [],
    authUsers: [],
    users: [],
    products: [],
    orders: [],
    cashClosures: [],
    evidencePaths: []
  }
}

export function addAuthUser(manifest: ChaosManifest, userId: string, email: string, role: string, orgId?: string | null) {
  manifest.authUsers.push({ userId, email, role, orgId })
}

export function updateAuthUserOrg(manifest: ChaosManifest, userId: string, orgId: string) {
  const user = manifest.authUsers.find(u => u.userId === userId)
  if (user) user.orgId = orgId
}

export function addOrganization(manifest: ChaosManifest, orgId: string, name: string) {
  manifest.organizations.push({ orgId, name })
}

export function addUser(manifest: ChaosManifest, userId: string, orgId: string, email: string, role: string) {
  manifest.users.push({ userId, orgId, email, role })
}

export function addProduct(manifest: ChaosManifest, productId: string, orgId: string) {
  manifest.products.push({ productId, orgId })
}

export function addOrder(manifest: ChaosManifest, orderId: string, orgId: string) {
  manifest.orders.push({ orderId, orgId })
}

export function addCashClosure(manifest: ChaosManifest, closureId: string, orgId: string) {
  manifest.cashClosures.push({ closureId, orgId })
}

export function addEvidencePath(manifest: ChaosManifest, path: string) {
  manifest.evidencePaths.push(path)
}

function sanitizeObject(obj: any): void {
  const blockedKeys = [
    'password', 'servicekey', 'service_key', 'anonkey', 'anon_key',
    'access_token', 'refresh_token', 'accesstoken', 'refreshtoken',
    'token', 'tokens', 'authorization', 'bearer', 'apikey', 'api_key',
    'session', 'service_role'
  ]
  const jwtRegex = /(?:^|\s)eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+(?:$|\s)/
  const bearerRegex = /(?:^|\s)bearer\s+/i
  const authRegex = /authorization:/i
  const apiKeyRegex = /apikey:/i
  const api_keyRegex = /api_key:/i

  if (obj === null || obj === undefined) return;
  if (typeof obj === 'string') {
    if (jwtRegex.test(obj) || bearerRegex.test(obj) || authRegex.test(obj) || apiKeyRegex.test(obj) || api_keyRegex.test(obj)) {
      throw new Error('SANITIZATION FAILED: JWT, Bearer or Authorization pattern detected in value')
    }
    return
  }
  if (typeof obj === 'object') {
    for (const [key, value] of Object.entries(obj)) {
      const lowerKey = key.toLowerCase()
      if (blockedKeys.some(blocked => lowerKey.includes(blocked))) {
        throw new Error(`SANITIZATION FAILED: Manifest contains blocked key: ${key}`)
      }
      sanitizeObject(value)
    }
  }
}

import * as path from 'path'

export function saveManifestSafe(manifest: ChaosManifest, pathStr: string): void {
  assertOperationalChaosEnabled() // Guard check before operating
  sanitizeObject(manifest)
  
  const dir = path.dirname(pathStr)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  
  fs.writeFileSync(pathStr, JSON.stringify(manifest, null, 2), 'utf8')
}
