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
  openCashSessionUI,
  performCashClosingUI,
  performCheckoutUI,
  rejectKdsOrderUI,
} from './ui'
import { assertCashSessionConsistency } from './assertions'
import { attemptAll, requireOwnedEmails, resolveOwnedOrganization } from '../../scripts/portal/lifecycle.mjs'
import { withExactSessionRpc } from '../../scripts/portal/session-guard.mjs'

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

const ALL_VIEWPORTS: CampaignViewport[] = [
  { id: 'desktop', label: 'Desktop 1440x900', viewport: { width: 1440, height: 900 } },
  { id: 'laptop', label: 'Laptop 1366x768', viewport: { width: 1366, height: 768 } },
  { id: 'tablet', label: 'Tablet 768x1024', viewport: { width: 768, height: 1024 } },
  { id: 'mobile', label: 'Mobile 390x844', viewport: { width: 390, height: 844 } },
  { id: 'mobile-chico', label: 'Mobile chico 360x740', viewport: { width: 360, height: 740 } },
]

const targetVp = process.env.TARGET_VIEWPORT?.toLowerCase()
const FINAL_CHAOS_VIEWPORTS: CampaignViewport[] = targetVp && targetVp !== 'all'
  ? ALL_VIEWPORTS.filter(v => v.id === targetVp)
  : ALL_VIEWPORTS

const DEPARTMENT_PLANS: DepartmentPlan[] = [
  {
    id: 'books',
    label: 'Recursos y Librería',
    leaderKey: 'leaderA',
    leaderAutoAccept: true,
    staff: [],
    products: [
      { name: 'Biblia RVR 1960', price: '150' },
      { name: 'Biblia NVI Estudio', price: '170' },
      { name: 'Devocional Diario', price: '80' },
      { name: 'Cuaderno de Notas', price: '60' },
      { name: 'Bolígrafo Ejecutivo', price: '25' },
      { name: 'Libro Oración Eficaz', price: '120' },
      { name: 'Libro Liderazgo Cristiano', price: '140' },
      { name: 'Manual de Discipulado', price: '90' },
      { name: 'Separador de Biblia', price: '20' },
      { name: 'Guía de Estudio Bíblico', price: '110' },
    ],
  },
  {
    id: 'cafe',
    label: 'Cafetería y Snacks',
    leaderKey: 'leaderB',
    leaderAutoAccept: false,
    staff: [
      { key: 'sellerB1', roleTitle: 'Cajero', autoAccept: true },
      { key: 'sellerB2', roleTitle: 'Cajero', autoAccept: true },
      { key: 'sellerB3', roleTitle: 'Cajero', autoAccept: true },
    ],
    products: [
      { name: 'Café Americano', price: '45' },
      { name: 'Pan Dulce Artesanal', price: '35' },
      { name: 'Agua Natural 500ml', price: '25' },
      { name: 'Snack Integral', price: '40' },
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
      { name: 'Taco de Guisado', price: '55' },
      { name: 'Torta Especial', price: '70' },
      { name: 'Agua Fresca del Día', price: '30' },
      { name: 'Platillo del Comedor', price: '95' },
    ],
  },
]

test.use({ trace: 'on', video: 'on', screenshot: 'on' })

test.describe('Final Chaos Journey - Resurgencia Simbiotica', () => {
  test.skip(!isOperationalChaosEnabled(), 'Operational Chaos disabled')
  test.setTimeout(900000)

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
    const churchName = 'Comunidad Cristiana Monte de Sion'
    const onboardingProduct = { name: 'Libro Bienvenidos', price: '50' }
    const smokeProduct = { name: 'Biblia RVR 1960', price: '150' }
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
        await openCashSessionUI(actors.leaderA.page, '0')
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
      await attemptAll([
        ['capture-known-entities', () => captureKnownEntitiesForCleanup(supabaseAdmin, manifest, {
          churchName,
          emails: [users.pastor.email, users.leaderA.email],
          productNames: [onboardingProduct.name, smokeProduct.name],
        })],
        ['cleanup-known-entities', () => cleanupJourney(manifest, supabaseAdmin, actors)],
      ])
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
    const churchName = 'Comunidad Cristiana Monte de Sion'
    const onboardingProduct = { name: 'Libro Bienvenidos', price: '50' }
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

        // El líder de Cafetería administra el catálogo; el cajero no tiene ese permiso.
        await loginUserUI(actors.leaderB.page, users.leaderB.email, users.leaderB.password, BASE_URL)
        for (const product of DEPARTMENT_PLANS.find(dept => dept.id === 'cafe')!.products) {
          await createProductFromProductsUI(actors.leaderB.page, product)
        }

        // El líder de Comedor administra los platillos; Cocina opera el KDS.
        await loginUserUI(actors.leaderC.page, users.leaderC.email, users.leaderC.password, BASE_URL)
        for (const product of DEPARTMENT_PLANS.find(dept => dept.id === 'kitchen')!.products) {
          await createProductFromProductsUI(actors.leaderC.page, product)
        }

        const allProductNames = DEPARTMENT_PLANS.flatMap(d => d.products.map(p => p.name))
        await captureKnownEntitiesForCleanup(supabaseAdmin, manifest, {
          churchName, emails: [], productNames: allProductNames,
        })
      })

      // 4. TORMENTA CONCURRENTE
      await test.step('Operación concurrente masiva', async () => {
        const departmentAProducts = DEPARTMENT_PLANS.find(dept => dept.id === 'books')!.products
        const departmentBProducts = DEPARTMENT_PLANS.find(dept => dept.id === 'cafe')!.products
        const departmentCProducts = DEPARTMENT_PLANS.find(dept => dept.id === 'kitchen')!.products

        // 1. Abrir cajas primero con los líderes (estabilización con carga 0)
        await openCashSessionUI(actors.leaderA.page, '0')
        await openCashSessionUI(actors.leaderB.page, '0')
        await openCashSessionUI(actors.leaderC.page, '0')

        // 2. Iniciar sesión de cajeros de forma concurrente
        await Promise.all([
          loginUserUI(actors.sellerB1.page, users.sellerB1.email, users.sellerB1.password, BASE_URL),
          loginUserUI(actors.sellerB2.page, users.sellerB2.email, users.sellerB2.password, BASE_URL),
          loginUserUI(actors.sellerB3.page, users.sellerB3.email, users.sellerB3.password, BASE_URL),
          loginUserUI(actors.sellerC.page, users.sellerC.email, users.sellerC.password, BASE_URL),
          loginUserUI(actors.cookC.page, users.cookC.email, users.cookC.password, BASE_URL),
        ])

        // Preparar pantallas de venta de forma secuencial evita falsos negativos
        // por hidratacion del dev server; la concurrencia real ocurre en los cobros.
        await openPosAndWaitForProducts(actors.leaderA.page, departmentAProducts)
        await openPosAndWaitForProducts(actors.sellerB1.page, departmentBProducts)
        await openPosAndWaitForProducts(actors.sellerB2.page, departmentBProducts)
        await openPosAndWaitForProducts(actors.sellerB3.page, departmentBProducts)
        await openPosAndWaitForProducts(actors.sellerC.page, departmentCProducts)

        // Tormenta concurrente con volumen completo de validacion final.
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

      // 6. CONTINGENCIA Y RESCATE DE CAJA DESATENDIDA
      await test.step('Contingencia y rescate de caja desatendida', async () => {
        // Seller B1 abre una nueva caja para un turno extraordinario
        await actors.sellerB1.page.goto(`${BASE_URL}/page/POS/pointOfSales`, { waitUntil: 'domcontentloaded' })
        await openCashSessionUI(actors.sellerB1.page, '50')

        // Obtener el ID exacto de la sesión abierta para contingencia
        const sellerProfile = await requireProfileByEmail(supabaseAdmin, users.sellerB1.email)
        expect(sellerProfile.org_id).toBe(orgId)
        expect(sellerProfile.owner_id).toBe(leaderBDepartmentId)
        const { data: openSession, error: openError } = await supabaseAdmin
          .from('cash_sessions')
          .select('id')
          .eq('org_id', orgId)
          .eq('department_owner_id', leaderBDepartmentId)
          .eq('opened_by', sellerProfile.id)
          .eq('mode', 'shared')
          .eq('status', 'open')
          .single()
        expect(openError).toBeNull()
        const targetSessionId = openSession?.id
        expect(targetSessionId).toBeTruthy()

        // Realiza un cobro
        const cafeProduct = DEPARTMENT_PLANS.find(dept => dept.id === 'cafe')!.products[0]
        await performCheckoutUI(actors.sellerB1.page, cafeProduct.name, '100', false)

        // Retiro simulado del cajero. about:blank NO demuestra una caída de red.
        await actors.sellerB1.page.goto('about:blank')

        // El Líder B entra a Corte de Caja para rescate de contingencia
        await actors.leaderB.page.goto(`${BASE_URL}/page/POS/cashClosing`, { waitUntil: 'domcontentloaded' })

        // Localizar la caja abierta en la sección "Cajas Abiertas"
        const openSessionsHeader = actors.leaderB.page.getByText(/^Cajas Abiertas$/i)
        await expect(openSessionsHeader).toBeVisible({ timeout: 15000 })

        // Clic en Pre-cerrar (Contingencia)
        const btnContingencia = actors.leaderB.page.getByRole('button', { name: /Pre-cerrar \(Contingencia\)/i })
        await expect(btnContingencia).toHaveCount(1)
        await expect(btnContingencia).toBeVisible({ timeout: 15000 })
        await btnContingencia.click()

        // Modal de contingencia
        const modal = actors.leaderB.page.locator('.v-dialog:visible').filter({ hasText: /Pre-cierre de Contingencia/i })
        await expect(modal).toHaveCount(1)
        await expect(modal).toBeVisible({ timeout: 10000 })

        // Efectivo contado: 50 fondo + 45 venta = 95
        const inputContado = modal.locator('input[type="number"]')
        await expect(inputContado).toHaveCount(1)
        await inputContado.fill('95')

        // Nota de justificación
        const inputNota = modal.locator('textarea')
        await expect(inputNota).toHaveCount(1)
        await inputNota.fill('Rescate de turno: cajero se retiró por emergencia familiar.')

        // Confirmar pre-cierre
        const btnConfirmar = modal.getByRole('button', { name: /Confirmar Pre-cierre/i })
        await expect(btnConfirmar).toBeEnabled({ timeout: 10000 })
        await withExactSessionRpc(actors.leaderB.page, 'pre_close_cash_session', targetSessionId, () => btnConfirmar.click())

        // Pasa a validación y el líder aprueba el cierre definitivo
        await expect(actors.leaderB.page.getByText(/Cajas Pendientes de Validacion/i).first()).toBeVisible({ timeout: 20000 })
        const btnAprobar = actors.leaderB.page.getByRole('button', { name: /Aprobar cierre/i })
        await expect(btnAprobar).toHaveCount(1)
        await expect(btnAprobar).toBeVisible({ timeout: 15000 })
        await withExactSessionRpc(actors.leaderB.page, 'approve_cash_session', targetSessionId, () => btnAprobar.click())

        // Aserción estricta de base de datos vinculada exactamente a targetSessionId
        const { data: closedSession, error: sessionErr } = await supabaseAdmin
          .from('cash_sessions')
          .select('id,status,difference,opening_cash,total_cash_sales,cash_counted,expected_cash')
          .eq('org_id', orgId)
          .eq('department_owner_id', leaderBDepartmentId)
          .eq('id', targetSessionId)
          .single()

        expect(sessionErr).toBeNull()
        expect(closedSession?.status).toBe('closed')
        expect(Number(closedSession?.opening_cash)).toBe(50)
        expect(Number(closedSession?.total_cash_sales)).toBe(45)
        expect(Number(closedSession?.cash_counted)).toBe(95)
        expect(Number(closedSession?.expected_cash)).toBe(95)
        expect(Number(closedSession?.difference)).toBe(0) // Cuadre matemático exacto (95 - 50 - 45 = 0)

        const { data: paidOrders, error: ordersError } = await supabaseAdmin.from('orders')
          .select('id,total').eq('org_id', orgId).eq('cash_session_id', targetSessionId)
          .eq('financial_status', 'paid').eq('payment_method', 'cash')
        expect(ordersError).toBeNull()
        expect(paidOrders).toHaveLength(1)
        expect(paidOrders.reduce((sum: number, order: any) => sum + Math.round(Number(order.total) * 100), 0)).toBe(4500)

        // Explicitly demonstrate that the closed session no longer blocks opening.
        await actors.sellerB1.page.goto(`${BASE_URL}/page/POS/pointOfSales`, { waitUntil: 'domcontentloaded' })
        await openCashSessionUI(actors.sellerB1.page, '0')
        const { data: nextSession, error: nextError } = await supabaseAdmin.from('cash_sessions')
          .select('id').eq('org_id', orgId).eq('department_owner_id', leaderBDepartmentId)
          .eq('opened_by', sellerProfile.id).eq('mode', 'shared').eq('status', 'open').single()
        expect(nextError).toBeNull()
        expect(nextSession?.id).toBeTruthy()
        expect(nextSession?.id).not.toBe(targetSessionId)
      })

    } finally {
      const allProductNames = DEPARTMENT_PLANS.flatMap(d => d.products.map(p => p.name))
      const allEmails = Object.values(users).map(u => u.email)
      await attemptAll([
        ['capture-known-entities', () => captureKnownEntitiesForCleanup(supabaseAdmin, manifest, {
          churchName, emails: allEmails, productNames: [onboardingProduct.name, ...allProductNames],
        })],
        ['save-evidence', () => saveFinalChaosManifest(manifest)],
        ['cleanup-known-entities', () => cleanupJourney(manifest, supabaseAdmin, actors)],
      ])
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
  await attemptAll(Object.values(actors).map(actor => [actor.key, () => actor.context.close()]))
}

async function cleanupJourney(
  manifest: ChaosManifest,
  supabaseAdmin: any,
  actors: Record<ActorKey, ActorSession>,
): Promise<void> {
  await attemptAll([
    ['close-contexts', () => closeActorSessions(actors)],
    ['save-manifest', () => saveManifestSafe(manifest, `tests/evidence/operational-chaos/manifest_${manifest.runId}.json`)],
    ['cleanup-recorded-ids', () => executeCleanup(manifest, supabaseAdmin)],
  ])
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
    const url = response.url()
    const method = response.request().method()
    const matchesSafeRpc = url.includes('/rest/v1/rpc/set_staff_auto_accept_safely')
      && method === 'POST'
    const matchesLegacyPatch = url.includes('/rest/v1/profiles')
      && method === 'PATCH'

    return (matchesSafeRpc || matchesLegacyPatch)
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

async function openPosAndWaitForProducts(page: Page, catalog: ProductPlan[]): Promise<void> {
  const firstProduct = catalog[0]

  for (let attempt = 1; attempt <= 3; attempt++) {
    await page.goto(
      `${BASE_URL}/page/POS/pointOfSales?chaosRetry=${attempt}-${Date.now()}`,
      { waitUntil: 'domcontentloaded', timeout: 60000 },
    )
    await page.locator('#__nuxt, #app, body').first().waitFor({ state: 'attached', timeout: 10000 }).catch(() => null)

    const bodyText = await page.locator('body').textContent({ timeout: 5000 }).catch(() => '')
    if ((bodyText?.trim().length ?? 0) <= 500) {
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 })
      await page.locator('#__nuxt, #app, body').first().waitFor({ state: 'attached', timeout: 10000 }).catch(() => null)
    }

    const visible = await page
      .locator('.product-card, .v-card')
      .filter({ hasText: firstProduct.name })
      .first()
      .waitFor({ state: 'visible', timeout: 30000 })
      .then(() => true)
      .catch(() => false)

    if (visible) return

    await page.waitForTimeout(1000 * attempt)
  }

  const bodyText = await page.locator('body').textContent().catch(() => '')
  throw new Error(
    `POS did not render expected catalog product before chaos. product="${firstProduct.name}", ` +
    `url=${page.url()}, bodyLength=${bodyText?.length ?? 0}`,
  )
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
  await assertCashSessionConsistency(supabaseAdmin, orgId, departmentOwnerId)
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
  await gotoWithRetry(page, `${BASE_URL}/signup`, 'signup')
  await page.locator('input[autocomplete="name"]').fill(pastor.name)
  await page.locator('input[autocomplete="email"]').fill(pastor.email)
  await page.locator('input[autocomplete="new-password"]').fill(pastor.password)
  await page.getByPlaceholder(/Iglesia Nueva Vida/i).fill(churchName)

  const submit = page.getByRole('button', { name: /CREAR CUENTA GRATIS/i })
  await expect(submit).toBeEnabled({ timeout: 10000 })
  await submit.click()

  try {
    await waitForLoginOrOnboarding(page)

    if (page.url().includes('/login')) {
      await confirmAuthEmailForTestOnly(supabaseAdmin, pastor.email)
      await page.locator('input[autocomplete="email"]').fill(pastor.email)
      await page.locator('input[autocomplete="current-password"]').fill(pastor.password)
      await page.getByRole('button', { name: /ACCEDER AHORA/i }).click()
      await waitForOnboardingUI(page)
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

async function gotoWithRetry(page: Page, url: string, label: string): Promise<void> {
  let lastError: unknown

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
      return
    } catch (err) {
      lastError = err
      await page.waitForTimeout(1000 * attempt)
    }
  }

  throw new Error(
    `${label} navigation failed after retries: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  )
}

async function waitForLoginOrOnboarding(page: Page): Promise<void> {
  await Promise.race([
    page.waitForURL(
      url => url.toString().includes('/onboarding') || url.toString().includes('/login'),
      { timeout: 30000 },
    ),
    page.getByText(/Configuraci[oÃ³]n Inicial|Configura tu Iglesia/i).first().waitFor({
      state: 'visible',
      timeout: 30000,
    }),
  ])
}

async function waitForOnboardingUI(page: Page): Promise<void> {
  await expect(
    page.getByText(/Configuraci[oÃ³]n Inicial|Configura tu Iglesia/i).first(),
  ).toBeVisible({ timeout: 30000 })
}

async function completeOnboardingUI(
  page: Page,
  data: {
    churchName: string
    productName?: string
    productPrice?: string
    leader: TestUser
  },
): Promise<void> {
  await waitForOnboardingUI(page)

  await page.getByPlaceholder(/Iglesia Nueva Vida/i).fill(data.churchName)
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
  params: { churchName: string; emails: string[]; productNames?: string[]; orgId?: string },
): Promise<void> {
  requireOwnedEmails(manifest.runId, params.emails)
  const profiles: any[] = []
  const authOnlyEmails: string[] = []
  for (const email of params.emails) {
    const { data: profile, error } = await supabaseAdmin
      .from('profiles')
      .select('id,email,role,org_id')
      .eq('email', email)
      .maybeSingle()
    if (error) throw new Error('CLEANUP_PROFILE_QUERY_FAILED')
    if (profile) profiles.push(profile)
    else authOnlyEmails.push(email)
  }
  const targetOrgId = resolveOwnedOrganization({
    profiles,
    knownOrgIds: manifest.organizations.map(o => o.orgId),
    explicitOrgId: params.orgId,
  })
  // Register only after every returned profile agrees on ownership.
  if (targetOrgId && !manifest.organizations.some(o => o.orgId === targetOrgId)) {
    const { data: org, error } = await supabaseAdmin.from('organizations')
      .select('id,name').eq('id', targetOrgId).single()
    if (error || !org) throw new Error('CLEANUP_ORGANIZATION_QUERY_FAILED')
    addOrganization(manifest, org.id, org.name)
  }
  for (const profile of profiles) {
      if (!manifest.authUsers.some(u => u.userId === profile.id)) {
        addAuthUser(manifest, profile.id, profile.email, profile.role, profile.org_id)
      }
      if (profile.org_id && !manifest.users.some(u => u.userId === profile.id)) {
        addUser(manifest, profile.id, profile.org_id, profile.email, profile.role)
      }
  }
  for (const email of authOnlyEmails) await captureAuthOnlyUser(supabaseAdmin, manifest, email)

  const cleanupOrgId = targetOrgId
  if (cleanupOrgId && params.productNames?.length) {
    for (const productName of params.productNames) {
      const { data: product, error } = await supabaseAdmin
        .from('products')
        .select('id,org_id,name')
        .eq('org_id', cleanupOrgId)
        .eq('name', productName)
        .maybeSingle()
      if (error) throw new Error('CLEANUP_PRODUCT_QUERY_FAILED')
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
  requireOwnedEmails(manifest.runId, [email])
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
    pastor: { name: 'Pastor David Ramos', email: `pastor.david.${slug}@demo.avivacheck.org`, password },
    leaderA: { name: 'Líder Daniel Soto', email: `daniel.libreria.${slug}@demo.avivacheck.org`, password },
    leaderB: { name: 'Líder Marcos Peña', email: `marcos.cafeteria.${slug}@demo.avivacheck.org`, password },
    leaderC: { name: 'Líder Samuel Castro', email: `samuel.comedor.${slug}@demo.avivacheck.org`, password },
    sellerB1: { name: 'Cajera Sofía Mendoza', email: `sofia.cajero.${slug}@demo.avivacheck.org`, password },
    sellerB2: { name: 'Cajero Mateo Vega', email: `mateo.cajero.${slug}@demo.avivacheck.org`, password },
    sellerB3: { name: 'Cajero Lucas Ortiz', email: `lucas.cajero.${slug}@demo.avivacheck.org`, password },
    sellerC: { name: 'Cajero Isaac Díaz', email: `isaac.cajero.${slug}@demo.avivacheck.org`, password },
    cookC: { name: 'Cocinero Andrés Cruz', email: `andres.cocina.${slug}@demo.avivacheck.org`, password },
  }
}
