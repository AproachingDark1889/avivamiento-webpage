// tests/operational-chaos/final-chaos-journey.spec.ts
// ============================================================================
// FINAL CHAOS JOURNEY - RESURGENCIA SIMBIOTICA
//
// Fase A: arquitectura compilable y contratos de automatizacion.
// No usa seed.ts, no usa globalSetup, no crea datos por service_role.
// El service_role queda reservado para evidencia forense y cleanup selectivo.
// ============================================================================
import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import {
  assertPhase2BExecutionAllowed,
  createRunId,
  getServiceKeySafe,
  getSupabaseUrlSafe,
  getTestPasswordSafe,
  isOperationalChaosEnabled,
} from './config'
import {
  addAuthUser,
  addOrganization,
  addProduct,
  addUser,
  createEmptyManifest,
  saveManifestSafe,
  type ChaosManifest,
} from './manifest'
import { executeCleanup } from './cleanup'
import {
  completeKdsOrderUI,
  loginUserUI,
  performCashClosingUI,
  performCheckoutUI,
  rejectKdsOrderUI,
} from './ui'
import { assertMathematicalConsistency } from './assertions'

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3002/sistema'

type ActorKey =
  | 'pastor'
  | 'leaderA'
  | 'leaderB'
  | 'leaderC'
  | 'sellerB1'
  | 'sellerB2'
  | 'sellerB3'
  | 'sellerC'
  | 'cookC'

type RoleTitle = 'Lider de Departamento' | 'Cajero' | 'Cocina'
const LEADER_ROLE_OPTION = /L.{0,4}der de Departamento|Lider de Departamento/i

interface TestUser {
  name: string
  email: string
  password: string
}

interface ActorPlan {
  key: ActorKey
  viewport: { width: number; height: number }
  purpose: string
}

interface CampaignViewport {
  id: string
  label: string
  viewport: { width: number; height: number }
}

interface ActorSession extends ActorPlan {
  context: BrowserContext
  page: Page
}

interface ProductPlan {
  name: string
  price: string
}

interface DepartmentPlan {
  id: 'books' | 'cafe' | 'kitchen'
  label: string
  leaderKey: ActorKey
  leaderAutoAccept: boolean
  staff: Array<{
    key: ActorKey
    roleTitle: RoleTitle
    autoAccept: boolean
  }>
  products: ProductPlan[]
}

interface TrackAndVerifyEntityArgs {
  page: Page
  responsePattern: string | RegExp
  trigger: () => Promise<void>
  verify: () => Promise<boolean>
  register: (id: string) => void | Promise<void>
  description: string
}

const ACTOR_PLANS: ActorPlan[] = [
  {
    key: 'pastor',
    viewport: { width: 1280, height: 720 },
    purpose: 'Fundador del tenant, alta de lideres y auditoria final',
  },
  {
    key: 'leaderA',
    viewport: { width: 1280, height: 720 },
    purpose: 'Departamento A - libreria con auto-completar',
  },
  {
    key: 'leaderB',
    viewport: { width: 768, height: 1024 },
    purpose: 'Departamento B - supervision de cafeteria',
  },
  {
    key: 'sellerB1',
    viewport: { width: 375, height: 667 },
    purpose: 'Vendedor B1 - alta de catalogo y ventas directas',
  },
  {
    key: 'sellerB2',
    viewport: { width: 375, height: 667 },
    purpose: 'Vendedor B2 - ventas directas concurrentes',
  },
  {
    key: 'sellerB3',
    viewport: { width: 375, height: 667 },
    purpose: 'Vendedor B3 - ventas directas concurrentes',
  },
  {
    key: 'leaderC',
    viewport: { width: 1280, height: 720 },
    purpose: 'Departamento C - comedor con flujo KDS',
  },
  {
    key: 'sellerC',
    viewport: { width: 375, height: 667 },
    purpose: 'Vendedor C - inyeccion de ordenes pendientes',
  },
  {
    key: 'cookC',
    viewport: { width: 1024, height: 768 },
    purpose: 'Cocinero C - catalogo de platillos y KDS',
  },
]

const FINAL_CHAOS_VIEWPORTS: CampaignViewport[] = [
  { id: 'desktop', label: 'Desktop 1440x900', viewport: { width: 1440, height: 900 } },
  { id: 'laptop', label: 'Laptop 1366x768', viewport: { width: 1366, height: 768 } },
  { id: 'tablet', label: 'Tablet 768x1024', viewport: { width: 768, height: 1024 } },
  { id: 'mobile', label: 'Mobile 390x844', viewport: { width: 390, height: 844 } },
  { id: 'mobile-chico', label: 'Mobile chico 360x740', viewport: { width: 360, height: 740 } },
]

const DEPARTMENT_PLANS: DepartmentPlan[] = [
  {
    id: 'books',
    label: 'Recursos y Libreria',
    leaderKey: 'leaderA',
    leaderAutoAccept: true,
    staff: [],
    products: [
      { name: 'Biblia RVR Caos', price: '150' },
      { name: 'Biblia NVI Caos', price: '170' },
      { name: 'Devocional Semanal Caos', price: '80' },
      { name: 'Cuaderno de Notas Caos', price: '60' },
      { name: 'Lapicero Avivamiento Caos', price: '25' },
      { name: 'Libro Oracion Caos', price: '120' },
      { name: 'Libro Liderazgo Caos', price: '140' },
      { name: 'Manual Discipulado Caos', price: '90' },
      { name: 'Separador Biblia Caos', price: '20' },
      { name: 'Guia Estudio Caos', price: '110' },
    ],
  },
  {
    id: 'cafe',
    label: 'Cafeteria y Snacks',
    leaderKey: 'leaderB',
    leaderAutoAccept: false,
    staff: [
      { key: 'sellerB1', roleTitle: 'Cajero', autoAccept: true },
      { key: 'sellerB2', roleTitle: 'Cajero', autoAccept: true },
      { key: 'sellerB3', roleTitle: 'Cajero', autoAccept: true },
    ],
    products: [
      { name: 'Cafe Americano Caos', price: '45' },
      { name: 'Pan Dulce Caos', price: '35' },
      { name: 'Agua Natural Caos', price: '25' },
      { name: 'Snack Integral Caos', price: '40' },
    ],
  },
  {
    id: 'kitchen',
    label: 'Comedor y Alimentos',
    leaderKey: 'leaderC',
    leaderAutoAccept: false,
    staff: [
      { key: 'sellerC', roleTitle: 'Cajero', autoAccept: false },
      { key: 'cookC', roleTitle: 'Cocina', autoAccept: false },
    ],
    products: [
      { name: 'Taco de Guisado Caos', price: '55' },
      { name: 'Torta Especial Caos', price: '70' },
      { name: 'Agua Fresca Caos', price: '30' },
      { name: 'Platillo Comedor Caos', price: '95' },
    ],
  },
]

test.use({ trace: 'on', video: 'on', screenshot: 'on' })

test.describe('Final Chaos Journey - Resurgencia Simbiotica', () => {
  test.skip(!isOperationalChaosEnabled(), 'Operational Chaos disabled')
  test.setTimeout(600000)

  test('Fase A: topologia de actores y departamentos reales', async () => {
    expect(ACTOR_PLANS.map(actor => actor.key)).toEqual([
      'pastor',
      'leaderA',
      'leaderB',
      'sellerB1',
      'sellerB2',
      'sellerB3',
      'leaderC',
      'sellerC',
      'cookC',
    ])

    expect(DEPARTMENT_PLANS).toHaveLength(3)
    expect(DEPARTMENT_PLANS.find(dept => dept.id === 'books')?.products).toHaveLength(10)
    expect(DEPARTMENT_PLANS.find(dept => dept.id === 'cafe')?.staff).toHaveLength(3)
    expect(DEPARTMENT_PLANS.find(dept => dept.id === 'kitchen')?.staff).toEqual([
      { key: 'sellerC', roleTitle: 'Cajero', autoAccept: false },
      { key: 'cookC', roleTitle: 'Cocina', autoAccept: false },
    ])
  })

  test('Fase B: smoke humano de baja densidad', async ({ browser }) => {
    assertPhase2BExecutionAllowed()

    const runId = createRunId()
    const password = getTestPasswordSafe()
    const manifest = createEmptyManifest(runId)
    const supabaseAdmin = createClient(getSupabaseUrlSafe(), getServiceKeySafe(), {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const actors = await createActorSessions(browser)
    const users = buildUsers(runId, password)
    const slug = runId.toLowerCase().replace(/[^a-z0-9-]/g, '-')
    const churchName = `Iglesia Final Chaos ${slug}`
    const onboardingProduct = { name: 'Producto Inicial Final Chaos', price: '50' }
    const smokeProduct = { name: 'Biblia Smoke Final Chaos', price: '150' }
    const today = new Date().toISOString().split('T')[0]
    let orgId = ''
    let leaderDepartmentId = ''

    try {
      await test.step('Pastor crea iglesia y primer lider desde UI', async () => {
        await signupPastorUI(actors.pastor.page, users.pastor, churchName, supabaseAdmin)
        await captureKnownEntitiesForCleanup(supabaseAdmin, manifest, {
          churchName,
          emails: [users.pastor.email],
        })
        saveFinalChaosManifest(manifest)

        const pastorProfile = await requireProfileByEmail(supabaseAdmin, users.pastor.email)
        expect(pastorProfile.role).toBe('pastor')
        expect(pastorProfile.org_id).toBeTruthy()
        expect(pastorProfile.onboarding_completed).toBe(false)
        orgId = pastorProfile.org_id

        await completeOnboardingUI(actors.pastor.page, {
          churchName,
          productName: onboardingProduct.name,
          productPrice: onboardingProduct.price,
          leader: users.leaderA,
        })

        await captureKnownEntitiesForCleanup(supabaseAdmin, manifest, {
          churchName,
          emails: [users.pastor.email, users.leaderA.email],
          productNames: [onboardingProduct.name],
        })
        saveFinalChaosManifest(manifest)

        const leaderProfile = await requireProfileByEmail(supabaseAdmin, users.leaderA.email)
        expect(leaderProfile.role).toBe('leader')
        expect(leaderProfile.org_id).toBe(orgId)
        leaderDepartmentId = leaderProfile.id
      })

      await test.step('Pastor activa auto-completar del lider desde UI', async () => {
        await toggleAutoAcceptUI(actors.pastor.page, users.leaderA.email, true)
      })

      await test.step('Lider crea catalogo, vende y cierra caja', async () => {
        await loginUserUI(actors.leaderA.page, users.leaderA.email, users.leaderA.password, BASE_URL)
        await createProductFromProductsUI(actors.leaderA.page, smokeProduct)

        await captureKnownEntitiesForCleanup(supabaseAdmin, manifest, {
          churchName,
          emails: [users.pastor.email, users.leaderA.email],
          productNames: [onboardingProduct.name, smokeProduct.name],
        })
        saveFinalChaosManifest(manifest)

        await actors.leaderA.page.goto(`${BASE_URL}/page/POS/pointOfSales`, { waitUntil: 'domcontentloaded' })
        await performCheckoutUI(actors.leaderA.page, smokeProduct.name, '200', false)
        await closeDepartmentCash(
          actors.leaderA.page,
          today,
          smokeProduct.price,
          orgId,
          leaderDepartmentId,
          supabaseAdmin,
        )
      })
    } finally {
      await captureKnownEntitiesForCleanup(supabaseAdmin, manifest, {
        churchName,
        emails: [users.pastor.email, users.leaderA.email],
        productNames: [onboardingProduct.name, smokeProduct.name],
      })
      await cleanupJourney(manifest, supabaseAdmin, actors)
    }
  })

  for (const viewportCase of FINAL_CHAOS_VIEWPORTS) {
  test(`Fase C matriz: ${viewportCase.label} - caos multi-departamento sobre una iglesia real`, async ({ browser }) => {
    assertPhase2BExecutionAllowed()

    const runId = createRunId()
    const password = getTestPasswordSafe()
    const manifest = createEmptyManifest(runId)
    const supabaseAdmin = createClient(getSupabaseUrlSafe(), getServiceKeySafe(), {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const actors = await createActorSessions(browser, viewportCase.viewport)
    const users = buildUsers(runId, password)
    const slug = runId.toLowerCase().replace(/[^a-z0-9-]/g, '-')
    const churchName = `Iglesia Chaos ${viewportCase.id} ${slug}`
    const onboardingProduct = { name: 'Producto Inicial', price: '50' }
    const today = new Date().toISOString().split('T')[0]

    let orgId = ''
    let leaderADepartmentId = ''
    let leaderBDepartmentId = ''
    let leaderCDepartmentId = ''

    try {
      // 1. EL FUNDADOR (PASTOR)
      await test.step('Pastor crea iglesia, lideres y delega permisos', async () => {
        await signupPastorUI(actors.pastor.page, users.pastor, churchName, supabaseAdmin)
        await captureKnownEntitiesForCleanup(supabaseAdmin, manifest, { churchName, emails: [users.pastor.email] })

        const pastorProfile = await requireProfileByEmail(supabaseAdmin, users.pastor.email)
        orgId = pastorProfile.org_id

        await completeOnboardingUI(actors.pastor.page, {
          churchName,
          productName: onboardingProduct.name,
          productPrice: onboardingProduct.price,
          leader: users.leaderA,
        })

        await captureKnownEntitiesForCleanup(supabaseAdmin, manifest, {
          churchName, emails: [users.pastor.email, users.leaderA.email], productNames: [onboardingProduct.name],
        })

        const leaderAProfile = await requireProfileByEmail(supabaseAdmin, users.leaderA.email)
        leaderADepartmentId = leaderAProfile.id

        await createUserFromUsersUI(actors.pastor.page, users.leaderB, LEADER_ROLE_OPTION)
        await createUserFromUsersUI(actors.pastor.page, users.leaderC, LEADER_ROLE_OPTION)

        const leaderBProfile = await requireProfileByEmail(supabaseAdmin, users.leaderB.email)
        leaderBDepartmentId = leaderBProfile.id
        const leaderCProfile = await requireProfileByEmail(supabaseAdmin, users.leaderC.email)
        leaderCDepartmentId = leaderCProfile.id

        // Delega auto-cobro solo a Leader A (Librería no tiene cajeros)
        await toggleAutoAcceptUI(actors.pastor.page, users.leaderA.email, true)

        await captureKnownEntitiesForCleanup(supabaseAdmin, manifest, {
          churchName, emails: [users.leaderB.email, users.leaderC.email],
        })
      })

      // 2. LOS LIDERES (CONTRATACION Y DELEGACION)
      await test.step('Líderes contratan staff y delegan permisos', async () => {
        // Leader B (Cafeteria)
        await loginUserUI(actors.leaderB.page, users.leaderB.email, users.leaderB.password, BASE_URL)
        await createUserFromUsersUI(actors.leaderB.page, users.sellerB1, 'Cajero')
        await createUserFromUsersUI(actors.leaderB.page, users.sellerB2, 'Cajero')
        await createUserFromUsersUI(actors.leaderB.page, users.sellerB3, 'Cajero')

        // Delega auto-cobro a su staff manualmente en UI
        await toggleAutoAcceptUI(actors.leaderB.page, users.sellerB1.email, true)
        await toggleAutoAcceptUI(actors.leaderB.page, users.sellerB2.email, true)
        await toggleAutoAcceptUI(actors.leaderB.page, users.sellerB3.email, true)

        // Leader C (Comedor)
        await loginUserUI(actors.leaderC.page, users.leaderC.email, users.leaderC.password, BASE_URL)
        await createUserFromUsersUI(actors.leaderC.page, users.sellerC, 'Cajero')
        await createUserFromUsersUI(actors.leaderC.page, users.cookC, 'Cocina')

        await captureKnownEntitiesForCleanup(supabaseAdmin, manifest, {
          churchName, emails: [users.sellerB1.email, users.sellerB2.email, users.sellerB3.email, users.sellerC.email, users.cookC.email],
        })
      })

      // 3. STAFF OPERATIVO (CATALOGO SUBALTERNO)
      await test.step('Construcción de catálogo subalterno', async () => {
        // Leader A registra libros (no tiene staff)
        await loginUserUI(actors.leaderA.page, users.leaderA.email, users.leaderA.password, BASE_URL)
        for (const product of DEPARTMENT_PLANS.find(dept => dept.id === 'books')!.products) {
          await createProductFromProductsUI(actors.leaderA.page, product)
        }

        // Seller B1 registra snacks (prueba de permisos subalternos)
        await loginUserUI(actors.sellerB1.page, users.sellerB1.email, users.sellerB1.password, BASE_URL)
        for (const product of DEPARTMENT_PLANS.find(dept => dept.id === 'cafe')!.products) {
          await createProductFromProductsUI(actors.sellerB1.page, product)
        }

        // Cook C registra platillos
        await loginUserUI(actors.cookC.page, users.cookC.email, users.cookC.password, BASE_URL)
        for (const product of DEPARTMENT_PLANS.find(dept => dept.id === 'kitchen')!.products) {
          await createProductFromProductsUI(actors.cookC.page, product)
        }

        const allProductNames = DEPARTMENT_PLANS.flatMap(d => d.products.map(p => p.name))
        await captureKnownEntitiesForCleanup(supabaseAdmin, manifest, {
          churchName, emails: [], productNames: allProductNames,
        })
      })

      // 4. TORMENTA CONCURRENTE
      await test.step('Operación concurrente masiva', async () => {
        await Promise.all([
          loginUserUI(actors.sellerB2.page, users.sellerB2.email, users.sellerB2.password, BASE_URL),
          loginUserUI(actors.sellerB3.page, users.sellerB3.email, users.sellerB3.password, BASE_URL),
          loginUserUI(actors.sellerC.page, users.sellerC.email, users.sellerC.password, BASE_URL),
        ])

        // Navegamos al POS / KDS
        await Promise.all([
          actors.leaderA.page.goto(`${BASE_URL}/page/POS/pointOfSales`, { waitUntil: 'domcontentloaded' }),
          actors.sellerB1.page.goto(`${BASE_URL}/page/POS/pointOfSales`, { waitUntil: 'domcontentloaded' }),
          actors.sellerB2.page.goto(`${BASE_URL}/page/POS/pointOfSales`, { waitUntil: 'domcontentloaded' }),
          actors.sellerB3.page.goto(`${BASE_URL}/page/POS/pointOfSales`, { waitUntil: 'domcontentloaded' }),
          actors.sellerC.page.goto(`${BASE_URL}/page/POS/pointOfSales`, { waitUntil: 'domcontentloaded' }),
        ])

        const departmentAProducts = DEPARTMENT_PLANS.find(dept => dept.id === 'books')!.products
        const departmentBProducts = DEPARTMENT_PLANS.find(dept => dept.id === 'cafe')!.products
        const departmentCProducts = DEPARTMENT_PLANS.find(dept => dept.id === 'kitchen')!.products

        await Promise.all([
          performConcurrentSales(actors.leaderA.page, departmentAProducts, 15),
          performConcurrentSales(actors.sellerB1.page, departmentBProducts, 10),
          performConcurrentSales(actors.sellerB2.page, departmentBProducts, 10),
          performConcurrentSales(actors.sellerB3.page, departmentBProducts, 10),
          orchestratePosKdsChaos(actors.sellerC.page, actors.cookC.page, departmentCProducts, 12),
        ])
      })

      // 5. CORTES DESCENTRALIZADOS Y AUDITORIA
      await test.step('Cierres de caja descentralizados', async () => {
        const departmentAProducts = DEPARTMENT_PLANS.find(dept => dept.id === 'books')!.products
        const departmentBProducts = DEPARTMENT_PLANS.find(dept => dept.id === 'cafe')!.products
        const departmentCProducts = DEPARTMENT_PLANS.find(dept => dept.id === 'kitchen')!.products

        await closeDepartmentCash(
          actors.leaderA.page,
          today,
          expectedCashForSales(departmentAProducts, 15),
          orgId,
          leaderADepartmentId,
          supabaseAdmin,
        )
        await closeDepartmentCash(
          actors.leaderB.page,
          today,
          expectedCashForSales(departmentBProducts, 10 * 3),
          orgId,
          leaderBDepartmentId,
          supabaseAdmin,
        )
        await closeDepartmentCash(
          actors.leaderC.page,
          today,
          expectedCashForSales(departmentCProducts, 12),
          orgId,
          leaderCDepartmentId,
          supabaseAdmin,
        )
      })

    } finally {
      const allProductNames = DEPARTMENT_PLANS.flatMap(d => d.products.map(p => p.name))
      const allEmails = Object.values(users).map(u => u.email)
      await captureKnownEntitiesForCleanup(supabaseAdmin, manifest, {
        churchName,
        emails: allEmails,
        productNames: [onboardingProduct.name, ...allProductNames],
      })
      saveFinalChaosManifest(manifest)
      await cleanupJourney(manifest, supabaseAdmin, actors)
    }
  })
  }
})

async function createActorSessions(
  browser: Browser,
  viewportOverride?: { width: number; height: number },
): Promise<Record<ActorKey, ActorSession>> {
  const entries = await Promise.all(
    ACTOR_PLANS.map(async plan => {
      const viewport = viewportOverride ?? plan.viewport
      const context = await browser.newContext({ viewport })
      const page = await context.newPage()
      return [plan.key, { ...plan, viewport, context, page }] as const
    }),
  )

  return Object.fromEntries(entries) as Record<ActorKey, ActorSession>
}

async function closeActorSessions(actors: Record<ActorKey, ActorSession>): Promise<void> {
  await Promise.allSettled(
    Object.values(actors).map(actor => actor.context.close()),
  )
}

async function cleanupJourney(
  manifest: ChaosManifest,
  supabaseAdmin: any,
  actors: Record<ActorKey, ActorSession>,
): Promise<void> {
  let cleanupError: unknown

  try {
    saveManifestSafe(manifest, `tests/evidence/operational-chaos/manifest_${manifest.runId}.json`)
    await executeCleanup(manifest, supabaseAdmin)
  } catch (err) {
    cleanupError = err
  }

  await closeActorSessions(actors)

  if (cleanupError) throw cleanupError
}

function saveFinalChaosManifest(manifest: ChaosManifest): void {
  saveManifestSafe(
    manifest,
    `tests/evidence/operational-chaos/manifest_${manifest.runId}.json`,
  )
}

async function toggleAutoAcceptUI(
  page: Page,
  userEmail: string,
  desiredState: boolean,
): Promise<void> {
  await page.goto(`${BASE_URL}/page/POS/users`, { waitUntil: 'domcontentloaded' })

  const row = page.locator('tr').filter({ hasText: userEmail }).first()
  await expect(row).toBeVisible({ timeout: 30000 })

  const menuButton = row.locator('.mdi-dots-vertical').locator('xpath=ancestor::button').first()
  await expect(menuButton).toBeEnabled({ timeout: 10000 })
  await menuButton.click()

  const desiredText = desiredState ? 'Auto-completar: ON' : 'Auto-completar: OFF'
  const oppositeText = desiredState ? 'Auto-completar: OFF' : 'Auto-completar: ON'
  const autoAcceptItem = page.locator('.v-overlay-container .v-list-item').filter({
    hasText: /Auto-completar: (ON|OFF)/,
  }).last()

  await expect(autoAcceptItem).toBeVisible({ timeout: 10000 })
  const currentText = await autoAcceptItem.textContent()

  if (currentText?.includes(desiredText)) {
    await page.keyboard.press('Escape')
    return
  }

  if (!currentText?.includes(oppositeText)) {
    throw new Error(`No se pudo determinar estado auto-completar para ${userEmail}. Texto actual: ${currentText}`)
  }

  const responsePromise = page.waitForResponse(response => {
    return response.url().includes('/rest/v1/profiles')
      && response.request().method() === 'PATCH'
      && response.status() >= 200
      && response.status() < 300
  }, { timeout: 15000 })

  await autoAcceptItem.click()
  await responsePromise

  await autoAcceptItem.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => null)

  await menuButton.click()
  const updatedAutoAcceptItem = page.locator('.v-overlay-container .v-list-item').filter({
    hasText: /Auto-completar: (ON|OFF)/,
  }).last()
  await expect(updatedAutoAcceptItem).toContainText(desiredText, { timeout: 15000 })
  await page.keyboard.press('Escape')
}

async function trackAndVerifyEntity(args: TrackAndVerifyEntityArgs): Promise<string> {
  const responsePromise = args.page.waitForResponse(response => {
    const url = response.url()
    const matches = typeof args.responsePattern === 'string'
      ? url.includes(args.responsePattern)
      : args.responsePattern.test(url)

    return matches
      && ['POST', 'PATCH', 'PUT'].includes(response.request().method())
      && response.status() >= 200
      && response.status() < 300
  }, { timeout: 30000 })

  await args.trigger()
  const response = await responsePromise
  const body = await response.json().catch(() => null)
  const entityId = extractEntityId(body)

  if (!entityId) {
    throw new Error(`[CRITICAL] ${args.description}: response did not expose an entity id.`)
  }

  const verified = await args.verify()
  if (!verified) {
    throw new Error(`[CRITICAL] ${args.description}: entity ${entityId} was not verified after UI action.`)
  }

  await args.register(entityId)
  return entityId
}

function extractEntityId(body: any): string | null {
  if (!body) return null
  if (typeof body.id === 'string') return body.id
  if (typeof body.order_id === 'string') return body.order_id
  if (typeof body.closure_id === 'string') return body.closure_id
  if (Array.isArray(body)) {
    for (const entry of body) {
      const id = extractEntityId(entry)
      if (id) return id
    }
  }
  return null
}

async function createUserFromUsersUI(
  page: Page,
  user: TestUser,
  roleTitle: RoleTitle | RegExp,
): Promise<void> {
  await page.goto(`${BASE_URL}/page/POS/users`, { waitUntil: 'domcontentloaded' })
  await page.getByLabel(/Nombre completo/i).fill(user.name)
  await page.getByLabel(/^Email$/i).fill(user.email)
  await page.getByLabel(/Contras/i).fill(user.password)

  const roleSelect = page.locator('.v-input').filter({ hasText: /Rol/i }).first()
  const currentRoleText = await roleSelect.textContent()
  if (!matchesText(currentRoleText ?? '', roleTitle)) {
    await roleSelect.click()
    const roleOption = page.locator('.v-overlay-container .v-list-item').filter({ hasText: roleTitle }).last()
    await expect(roleOption).toBeVisible({ timeout: 10000 })
    await roleOption.click()
    await expect(roleSelect).toContainText(roleTitle, { timeout: 10000 })
  }

  const createButton = page.getByRole('button', { name: /Crear Usuario/i })
  await expect(createButton).toBeEnabled({ timeout: 10000 })
  await createButton.click()
  await expect(page.getByText(user.email, { exact: false })).toBeVisible({ timeout: 30000 })
}

async function createProductFromProductsUI(
  page: Page,
  product: ProductPlan,
): Promise<void> {
  await page.goto(`${BASE_URL}/page/POS/products`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: /Nuevo Producto/i }).click()
  await page.getByLabel(/Nombre del Producto/i).fill(product.name)
  await page.getByLabel(/Precio/i).fill(product.price)
  await page.getByRole('button', { name: /Guardar/i }).click()
  await expect(page.getByText(product.name, { exact: false })).toBeVisible({ timeout: 30000 })
}

async function performConcurrentSales(
  page: Page,
  catalog: ProductPlan[],
  count: number,
): Promise<void> {
  const isMobile = page.viewportSize() ? page.viewportSize()!.width < 960 : false

  for (let idx = 0; idx < count; idx++) {
    const product = catalog[idx % catalog.length]
    await performCheckoutUI(page, product.name, '1000', isMobile)
  }
}

async function orchestratePosKdsChaos(
  sellerPage: Page,
  cookPage: Page,
  catalog: ProductPlan[],
  count: number,
): Promise<void> {
  const isMobile = sellerPage.viewportSize() ? sellerPage.viewportSize()!.width < 960 : false

  await cookPage.goto(`${BASE_URL}/page/POS/kds`, { waitUntil: 'domcontentloaded' })

  for (let idx = 0; idx < count; idx++) {
    const product = catalog[idx % catalog.length]
    await performCheckoutUI(sellerPage, product.name, '1000', isMobile)

    if (idx % 4 === 3) {
      await rejectKdsOrderUI(cookPage, product.name)
    } else {
      await completeKdsOrderUI(cookPage, product.name)
    }
  }
}

async function closeDepartmentCash(
  page: Page,
  dateStr: string,
  countedAmount: string,
  orgId: string,
  departmentOwnerId: string,
  supabaseAdmin: any,
): Promise<void> {
  await page.goto(`${BASE_URL}/page/POS/cashClosing`, { waitUntil: 'domcontentloaded' })
  await performCashClosingUI(page, dateStr, countedAmount)
  await assertMathematicalConsistency(supabaseAdmin, orgId, dateStr, departmentOwnerId)
}

function expectedCashForSales(catalog: ProductPlan[], count: number): string {
  let total = 0
  for (let idx = 0; idx < count; idx++) {
    total += Number(catalog[idx % catalog.length].price)
  }

  return String(total)
}

async function signupPastorUI(
  page: Page,
  pastor: TestUser,
  churchName: string,
  supabaseAdmin: any,
): Promise<void> {
  await page.goto(`${BASE_URL}/signup`, { waitUntil: 'domcontentloaded' })
  await page.locator('input[autocomplete="name"]').fill(pastor.name)
  await page.locator('input[autocomplete="email"]').fill(pastor.email)
  await page.locator('input[autocomplete="new-password"]').fill(pastor.password)
  await page.getByPlaceholder(/Iglesia Nueva Vida/i).fill(churchName)

  const submit = page.getByRole('button', { name: /CREAR CUENTA GRATIS/i })
  await expect(submit).toBeEnabled({ timeout: 10000 })
  await submit.click()

  try {
    await page.waitForURL(
      url => url.toString().includes('/onboarding') || url.toString().includes('/login'),
      { timeout: 30000 },
    )

    if (page.url().includes('/login')) {
      await confirmAuthEmailForTestOnly(supabaseAdmin, pastor.email)
      await page.locator('input[autocomplete="email"]').fill(pastor.email)
      await page.locator('input[autocomplete="current-password"]').fill(pastor.password)
      await page.getByRole('button', { name: /ACCEDER AHORA/i }).click()
      await page.waitForURL(url => url.toString().includes('/onboarding'), { timeout: 30000 })
    }

    await expect(
      page.getByText(/Configuraci[oó]n Inicial|Configura tu Iglesia/i).first(),
    ).toBeVisible({ timeout: 30000 })
  } catch (err) {
    const visibleErrors = (await page
      .locator('.v-alert, [role="alert"], .v-messages__message')
      .allTextContents())
      .map(text => text.trim())
      .filter(Boolean)

    throw new Error(
      `Signup did not reach onboarding. currentUrl=${page.url()}; visibleErrors=${visibleErrors.join(' | ') || 'none'}; error=${err instanceof Error ? err.message : String(err)}`,
    )
  }
}

async function completeOnboardingUI(
  page: Page,
  data: {
    churchName: string
    productName: string
    productPrice: string
    leader: TestUser
  },
): Promise<void> {
  await page.waitForURL(url => url.toString().includes('/onboarding'), { timeout: 30000 })

  await page.getByPlaceholder(/Iglesia Nueva Vida/i).fill(data.churchName)
  await page.getByRole('button', { name: /Siguiente/i }).click()

  await page.getByPlaceholder(/Americano/i).fill(data.productName)
  await page.getByPlaceholder(/25\.00/i).fill(data.productPrice)
  await page.getByRole('button', { name: /Siguiente/i }).click()

  await page.getByPlaceholder(/lider@iglesia\.com/i).fill(data.leader.email)
  await page.getByPlaceholder(/Juan/i).fill(data.leader.name)
  await page.getByPlaceholder(/contrase/i).fill(data.leader.password)
  await page.getByRole('button', { name: /Finalizar/i }).click()
  await page.waitForURL(url => url.toString().includes('/page/POS/pointOfSales'), { timeout: 30000 })
}

async function requireProfileByEmail(supabaseAdmin: any, email: string): Promise<any> {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('id,email,role,org_id,owner_id,onboarding_completed')
    .eq('email', email)
    .single()

  expect(error).toBeNull()
  expect(data).toBeTruthy()
  return data
}

async function captureKnownEntitiesForCleanup(
  supabaseAdmin: any,
  manifest: ChaosManifest,
  params: { churchName: string; emails: string[]; productNames?: string[] },
): Promise<void> {
  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('id,name')
    .eq('name', params.churchName)
    .maybeSingle()

  if (org && !manifest.organizations.some(o => o.orgId === org.id)) {
    addOrganization(manifest, org.id, org.name)
  }

  for (const email of params.emails) {
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('id,email,role,org_id')
      .eq('email', email)
      .maybeSingle()

    if (profile) {
      if (!manifest.authUsers.some(u => u.userId === profile.id)) {
        addAuthUser(manifest, profile.id, profile.email, profile.role, profile.org_id)
      }
      if (profile.org_id && !manifest.users.some(u => u.userId === profile.id)) {
        addUser(manifest, profile.id, profile.org_id, profile.email, profile.role)
      }
    } else {
      await captureAuthOnlyUser(supabaseAdmin, manifest, email)
    }
  }

  if (org && params.productNames?.length) {
    for (const productName of params.productNames) {
      const { data: product } = await supabaseAdmin
        .from('products')
        .select('id,org_id,name')
        .eq('org_id', org.id)
        .eq('name', productName)
        .maybeSingle()

      if (product && !manifest.products.some(p => p.productId === product.id)) {
        addProduct(manifest, product.id, product.org_id)
      }
    }
  }
}

async function captureAuthOnlyUser(
  supabaseAdmin: any,
  manifest: ChaosManifest,
  email: string,
): Promise<void> {
  if (manifest.authUsers.some(u => u.email === email)) return

  const user = await findAuthUserByEmailForTestOnly(supabaseAdmin, email)
  if (user?.id) {
    addAuthUser(manifest, user.id, email, 'unknown', null)
  }
}

async function confirmAuthEmailForTestOnly(supabaseAdmin: any, email: string): Promise<void> {
  const user = await findAuthUserByEmailForTestOnly(supabaseAdmin, email)
  if (!user?.id) {
    throw new Error(`Auth user not found for test email ${email}`)
  }

  const { error } = await withTimeout(
    supabaseAdmin.auth.admin.updateUserById(user.id, { email_confirm: true }),
    15000,
    'Admin email confirmation timed out during final chaos journey',
  )

  if (error) {
    throw new Error(`Admin email confirmation failed during final chaos journey: ${error.message}`)
  }
}

async function findAuthUserByEmailForTestOnly(supabaseAdmin: any, email: string): Promise<any | null> {
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await withTimeout(
      supabaseAdmin.auth.admin.listUsers({ page, perPage: 1000 }),
      15000,
      `Admin listUsers timed out on page ${page}`,
    )

    if (error) {
      throw new Error(`Admin listUsers failed on page ${page}: ${error.message}`)
    }

    const user = data?.users?.find((candidate: any) => candidate.email === email)
    if (user) return user
    if (!data?.users || data.users.length < 1000) return null
  }

  return null
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function matchesText(text: string, matcher: string | RegExp): boolean {
  if (typeof matcher === 'string') return text.includes(matcher)
  return new RegExp(matcher.source, matcher.flags).test(text)
}

function buildUsers(runId: string, password: string): Record<ActorKey, TestUser> {
  const slug = runId.toLowerCase().replace(/[^a-z0-9-]/g, '-')

  return {
    pastor: { name: 'Pastor Final Chaos', email: `pastor.${slug}@gmail.com`, password },
    leaderA: { name: 'Lider Libreria Chaos', email: `leader.books.${slug}@gmail.com`, password },
    leaderB: { name: 'Lider Cafeteria Chaos', email: `leader.cafe.${slug}@gmail.com`, password },
    leaderC: { name: 'Lider Comedor Chaos', email: `leader.kitchen.${slug}@gmail.com`, password },
    sellerB1: { name: 'Vendedor Cafe 1', email: `seller.b1.${slug}@gmail.com`, password },
    sellerB2: { name: 'Vendedor Cafe 2', email: `seller.b2.${slug}@gmail.com`, password },
    sellerB3: { name: 'Vendedor Cafe 3', email: `seller.b3.${slug}@gmail.com`, password },
    sellerC: { name: 'Vendedor Comedor', email: `seller.c.${slug}@gmail.com`, password },
    cookC: { name: 'Cocinero Comedor', email: `cook.c.${slug}@gmail.com`, password },
  }
}
