// tests/operational-chaos/multi-viewport-journey.spec.ts
// ============================================================================
// FASE B: MULTI-VIEWPORT RESPONSIVE & CONTINGENCY PLAYWRIGHT SUITE
// ============================================================================
// Valida la experiencia de usuario y resiliencia transaccional a través de:
// 1. Mobile Compact (iPhone SE / Android 375x667)
// 2. Mobile Modern (iPhone 14/15 / Android 390x844)
// 3. Tablet Portrait (iPad 768x1024 / Android Tablet 820x1180)
// 4. Kitchen Touchscreen KDS (1024x768 / 1280x800)
// 5. Desktop High-Res (1440x900)
//
// Incluye validación de diálogos táctiles, drawer de ventas móvil,
// concurrencia en checkout y flujo de pre-cierre de contingencia por líderes.
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
import { assertCashSessionConsistency, assertMathematicalConsistency } from './assertions'

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3002/sistema'

export interface ViewportProfile {
  id: string
  name: string
  category: 'mobile' | 'tablet' | 'kds' | 'desktop'
  viewport: { width: number; height: number }
  deviceScaleFactor?: number
  isMobile?: boolean
  hasTouch?: boolean
}

export const TARGET_VIEWPORT_PROFILES: ViewportProfile[] = [
  {
    id: 'mobile-compact-375',
    name: 'iPhone SE / Android Compact',
    category: 'mobile',
    viewport: { width: 375, height: 667 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  },
  {
    id: 'mobile-standard-390',
    name: 'iPhone 14/15 / Modern Mobile',
    category: 'mobile',
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  },
  {
    id: 'tablet-pos-768',
    name: 'iPad / Mostrador Tablet',
    category: 'tablet',
    viewport: { width: 768, height: 1024 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  },
  {
    id: 'kds-touchscreen-1024',
    name: 'Monitor Táctil KDS Cocina',
    category: 'kds',
    viewport: { width: 1024, height: 768 },
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: true,
  },
  {
    id: 'desktop-supervision-1440',
    name: 'Estación de Supervisión / Pastor',
    category: 'desktop',
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false,
  },
]

interface TestUser {
  name: string
  email: string
  password: string
}

test.use({ trace: 'on', video: 'on', screenshot: 'on' })

test.describe('Fase B: Suite Playwright Multi-Viewport Responsivo & Contingencia', () => {
  test.skip(!isOperationalChaosEnabled(), 'Operational Chaos disabled')
  test.setTimeout(900000)

  // =========================================================================
  // TEST 1: Matriz de Validación Responsiva Multi-Dispositivo
  // =========================================================================
  for (const profile of TARGET_VIEWPORT_PROFILES) {
    test(`Viewport ${profile.name} (${profile.viewport.width}x${profile.viewport.height}) — Flujo Completo POS & Adaptabilidad UI`, async ({ browser }) => {
      assertPhase2BExecutionAllowed()

      const runId = createRunId()
      const password = getTestPasswordSafe()
      const manifest = createEmptyManifest(runId)
      const supabaseAdmin = createClient(getSupabaseUrlSafe(), getServiceKeySafe(), {
        auth: { persistSession: false, autoRefreshToken: false },
      })

      const slug = runId.toLowerCase().replace(/[^a-z0-9-]/g, '-')
      const churchName = `Iglesia VP ${profile.id} ${slug}`
      const today = new Date().toISOString().split('T')[0]

      const pastorUser: TestUser = {
        name: `Pastor ${profile.id}`,
        email: `pastor.${profile.id}.${slug}@test.com`,
        password,
      }
      const leaderUser: TestUser = {
        name: `Lider ${profile.id}`,
        email: `leader.${profile.id}.${slug}@test.com`,
        password,
      }
      const cashierUser: TestUser = {
        name: `Cajero ${profile.id}`,
        email: `cashier.${profile.id}.${slug}@test.com`,
        password,
      }
      const cookUser: TestUser = {
        name: `Cocinero ${profile.id}`,
        email: `cook.${profile.id}.${slug}@test.com`,
        password,
      }

      const testProducts = [
        { name: `Cafe Espresso ${profile.id}`, price: '45' },
        { name: `Croissant ${profile.id}`, price: '35' },
        { name: `Jugo Natural ${profile.id}`, price: '30' },
      ]

      let orgId = ''
      let leaderDeptId = ''

      // Crear contextos adaptados con viewport específico
      const pastorContext = await browser.newContext({ viewport: profile.viewport, isMobile: profile.isMobile, hasTouch: profile.hasTouch })
      const pastorPage = await pastorContext.newPage()

      const cashierContext = await browser.newContext({ viewport: profile.viewport, isMobile: profile.isMobile, hasTouch: profile.hasTouch })
      const cashierPage = await cashierContext.newPage()

      const cookContext = await browser.newContext({ viewport: { width: 1024, height: 768 }, hasTouch: true })
      const cookPage = await cookContext.newPage()

      try {
        // ── 1. Onboarding y Configuración Inicial ──
        await test.step('Pastor realiza Onboarding y alta de departamento', async () => {
          await pastorPage.goto(`${BASE_URL}/signup`, { waitUntil: 'domcontentloaded' })
          await pastorPage.locator('input[autocomplete="name"]').fill(pastorUser.name)
          await pastorPage.locator('input[autocomplete="email"]').fill(pastorUser.email)
          await pastorPage.locator('input[autocomplete="new-password"]').fill(pastorUser.password)
          await pastorPage.getByPlaceholder(/Iglesia Nueva Vida/i).fill(churchName)

          const submitBtn = pastorPage.getByRole('button', { name: /CREAR CUENTA GRATIS/i })
          await expect(submitBtn).toBeEnabled({ timeout: 10000 })
          await submitBtn.click()

          await Promise.race([
            pastorPage.waitForURL(url => url.toString().includes('/onboarding') || url.toString().includes('/login'), { timeout: 30000 }),
            pastorPage.getByText(/Configuraci[oó]n Inicial|Configura tu Iglesia/i).first().waitFor({ state: 'visible', timeout: 30000 }),
          ])

          if (pastorPage.url().includes('/login')) {
            await confirmAuthEmailForTestOnly(supabaseAdmin, pastorUser.email)
            await pastorPage.locator('input[autocomplete="email"]').fill(pastorUser.email)
            await pastorPage.locator('input[autocomplete="current-password"]').fill(pastorUser.password)
            await pastorPage.getByRole('button', { name: /ACCEDER AHORA/i }).click()
            await pastorPage.waitForURL(url => url.toString().includes('/onboarding'), { timeout: 30000 })
          }

          // Completar wizard de Onboarding
          await pastorPage.getByPlaceholder(/Iglesia Nueva Vida/i).fill(churchName)
          await pastorPage.getByRole('button', { name: /Siguiente/i }).click()

          await pastorPage.getByPlaceholder(/Americano/i).fill(testProducts[0].name)
          await pastorPage.getByPlaceholder(/25\.00/i).fill(testProducts[0].price)
          await pastorPage.getByRole('button', { name: /Siguiente/i }).click()

          await pastorPage.getByPlaceholder(/lider@iglesia\.com/i).fill(leaderUser.email)
          await pastorPage.getByPlaceholder(/Juan/i).fill(leaderUser.name)
          await pastorPage.getByPlaceholder(/contrase/i).fill(leaderUser.password)
          await pastorPage.getByRole('button', { name: /Finalizar/i }).click()

          await pastorPage.waitForURL(url => url.toString().includes('/page/POS/pointOfSales'), { timeout: 30000 })

          const pastorProfile = await getProfileByEmail(supabaseAdmin, pastorUser.email)
          expect(pastorProfile).toBeTruthy()
          orgId = pastorProfile.org_id

          const leaderProfile = await getProfileByEmail(supabaseAdmin, leaderUser.email)
          expect(leaderProfile).toBeTruthy()
          leaderDeptId = leaderProfile.id

          addOrganization(manifest, orgId, churchName)
          addAuthUser(manifest, pastorProfile.id, pastorUser.email, 'pastor', orgId)
          addAuthUser(manifest, leaderProfile.id, leaderUser.email, 'leader', orgId)
          addUser(manifest, pastorProfile.id, orgId, pastorUser.email, 'pastor')
          addUser(manifest, leaderProfile.id, orgId, leaderUser.email, 'leader')
          saveManifestSafe(manifest, `tests/evidence/operational-chaos/manifest_${manifest.runId}.json`)
        })

        // ── 2. Líder crea staff y catálogo subalterno ──
        await test.step('Líder crea cajero, cocinero y productos', async () => {
          await loginUserUI(pastorPage, leaderUser.email, leaderUser.password, BASE_URL)
          
          // Crear cajero y cocinero
          await pastorPage.goto(`${BASE_URL}/page/POS/users`, { waitUntil: 'domcontentloaded' })
          
          // Cajero
          await pastorPage.getByLabel(/Nombre completo/i).fill(cashierUser.name)
          await pastorPage.getByLabel(/^Email$/i).fill(cashierUser.email)
          await pastorPage.getByLabel(/Contras/i).fill(cashierUser.password)
          await selectRoleInUsersUI(pastorPage, 'Cajero')
          await pastorPage.getByRole('button', { name: /Crear Usuario/i }).click()
          await expect(pastorPage.getByText(cashierUser.email, { exact: false })).toBeVisible({ timeout: 30000 })

          // Cocinero
          await pastorPage.getByLabel(/Nombre completo/i).fill(cookUser.name)
          await pastorPage.getByLabel(/^Email$/i).fill(cookUser.email)
          await pastorPage.getByLabel(/Contras/i).fill(cookUser.password)
          await selectRoleInUsersUI(pastorPage, 'Cocina')
          await pastorPage.getByRole('button', { name: /Crear Usuario/i }).click()
          await expect(pastorPage.getByText(cookUser.email, { exact: false })).toBeVisible({ timeout: 30000 })

          // Agregar productos al catálogo
          for (let i = 1; i < testProducts.length; i++) {
            await pastorPage.goto(`${BASE_URL}/page/POS/products`, { waitUntil: 'domcontentloaded' })
            await pastorPage.getByRole('button', { name: /Nuevo Producto/i }).click()
            await pastorPage.getByLabel(/Nombre del Producto/i).fill(testProducts[i].name)
            await pastorPage.getByLabel(/Precio/i).fill(testProducts[i].price)
            await pastorPage.getByRole('button', { name: /Guardar/i }).click()
            await expect(pastorPage.getByText(testProducts[i].name, { exact: false })).toBeVisible({ timeout: 30000 })
          }
        })

        // ── 3. Operación en Viewport Específico (Cajero en POS & Cocina en KDS) ──
        await test.step(`Cajero opera POS en ${profile.name}`, async () => {
          await loginUserUI(cashierPage, cashierUser.email, cashierUser.password, BASE_URL)
          await loginUserUI(cookPage, cookUser.email, cookUser.password, BASE_URL)

          await cookPage.goto(`${BASE_URL}/page/POS/kds`, { waitUntil: 'domcontentloaded' })

          // Abrir caja
          await openCashSessionUI(cashierPage, '100')

          // Verificar adaptabilidad de elementos táctiles según el viewport
          if (profile.category === 'mobile') {
            // Verificar visibilidad del botón flotante del carrito (FAB)
            const fabCart = cashierPage.locator('.mdi-cart').locator('xpath=ancestor::button').first()
            await expect(fabCart).toBeVisible({ timeout: 15000 })
          }

          // Ejecutar ventas en POS móvil/tablet/desktop
          const isMobileMode = profile.viewport.width < 960

          // Venta 1: Despachada por KDS
          await performCheckoutUI(cashierPage, testProducts[0].name, '200', isMobileMode)
          await completeKdsOrderUI(cookPage, testProducts[0].name)

          // Venta 2: Otra orden para verificar acumulación
          await performCheckoutUI(cashierPage, testProducts[1].name, '200', isMobileMode)
          await completeKdsOrderUI(cookPage, testProducts[1].name)
        })

        // ── 4. Reconciliación Transaccional y Cierre ──
        await test.step('Reconciliación y cierre de caja regular', async () => {
          await cashierPage.goto(`${BASE_URL}/page/POS/cashClosing`, { waitUntil: 'domcontentloaded' })
          
          const expectedTotal = 100 + Number(testProducts[0].price) + Number(testProducts[1].price)
          await performCashClosingUI(cashierPage, today, String(expectedTotal))

          await assertCashSessionConsistency(supabaseAdmin, orgId, leaderDeptId)
        })

      } finally {
        await pastorContext.close().catch(() => null)
        await cashierContext.close().catch(() => null)
        await cookContext.close().catch(() => null)
        await executeCleanup(manifest, supabaseAdmin).catch(() => null)
      }
    })
  }

  // =========================================================================
  // TEST 2: Escenario Crítico de Rescate — Pre-cierre de Contingencia por Líder
  // =========================================================================
  test('Escenario de Contingencia: Líder pre-cierra caja abandonada por cajero offline (pre_close_cash_session)', async ({ browser }) => {
    assertPhase2BExecutionAllowed()

    const runId = createRunId()
    const password = getTestPasswordSafe()
    const manifest = createEmptyManifest(runId)
    const supabaseAdmin = createClient(getSupabaseUrlSafe(), getServiceKeySafe(), {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const slug = runId.toLowerCase().replace(/[^a-z0-9-]/g, '-')
    const churchName = `Iglesia Contingencia ${slug}`
    const today = new Date().toISOString().split('T')[0]

    const pastorUser: TestUser = {
      name: 'Pastor Contingencia',
      email: `pastor.contingencia.${slug}@test.com`,
      password,
    }
    const leaderUser: TestUser = {
      name: 'Lider Rescate',
      email: `leader.rescate.${slug}@test.com`,
      password,
    }
    const offlineCashier: TestUser = {
      name: 'Cajero Desconectado',
      email: `cashier.offline.${slug}@test.com`,
      password,
    }

    const testProduct = { name: `Producto Emergencia ${slug}`, price: '120' }
    let orgId = ''
    let leaderDeptId = ''

    const leaderContext = await browser.newContext({ viewport: { width: 1280, height: 720 } })
    const leaderPage = await leaderContext.newPage()

    const cashierContext = await browser.newContext({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true })
    const cashierPage = await cashierContext.newPage()

    try {
      // 1. Setup inicial
      await test.step('Alta de iglesia, líder y cajero', async () => {
        await leaderPage.goto(`${BASE_URL}/signup`, { waitUntil: 'domcontentloaded' })
        await leaderPage.locator('input[autocomplete="name"]').fill(pastorUser.name)
        await leaderPage.locator('input[autocomplete="email"]').fill(pastorUser.email)
        await leaderPage.locator('input[autocomplete="new-password"]').fill(pastorUser.password)
        await leaderPage.getByPlaceholder(/Iglesia Nueva Vida/i).fill(churchName)
        await leaderPage.getByRole('button', { name: /CREAR CUENTA GRATIS/i }).click()

        await Promise.race([
          leaderPage.waitForURL(url => url.toString().includes('/onboarding') || url.toString().includes('/login'), { timeout: 30000 }),
          leaderPage.getByText(/Configuraci[oó]n Inicial|Configura tu Iglesia/i).first().waitFor({ state: 'visible', timeout: 30000 }),
        ])

        if (leaderPage.url().includes('/login')) {
          await confirmAuthEmailForTestOnly(supabaseAdmin, pastorUser.email)
          await leaderPage.locator('input[autocomplete="email"]').fill(pastorUser.email)
          await leaderPage.locator('input[autocomplete="current-password"]').fill(pastorUser.password)
          await leaderPage.getByRole('button', { name: /ACCEDER AHORA/i }).click()
          await leaderPage.waitForURL(url => url.toString().includes('/onboarding'), { timeout: 30000 })
        }

        await leaderPage.getByPlaceholder(/Iglesia Nueva Vida/i).fill(churchName)
        await leaderPage.getByRole('button', { name: /Siguiente/i }).click()

        await leaderPage.getByPlaceholder(/Americano/i).fill(testProduct.name)
        await leaderPage.getByPlaceholder(/25\.00/i).fill(testProduct.price)
        await leaderPage.getByRole('button', { name: /Siguiente/i }).click()

        await leaderPage.getByPlaceholder(/lider@iglesia\.com/i).fill(leaderUser.email)
        await leaderPage.getByPlaceholder(/Juan/i).fill(leaderUser.name)
        await leaderPage.getByPlaceholder(/contrase/i).fill(leaderUser.password)
        await leaderPage.getByRole('button', { name: /Finalizar/i }).click()

        await leaderPage.waitForURL(url => url.toString().includes('/page/POS/pointOfSales'), { timeout: 30000 })

        const pastorProfile = await getProfileByEmail(supabaseAdmin, pastorUser.email)
        orgId = pastorProfile.org_id
        const leaderProfile = await getProfileByEmail(supabaseAdmin, leaderUser.email)
        leaderDeptId = leaderProfile.id

        addOrganization(manifest, orgId, churchName)
        addAuthUser(manifest, pastorProfile.id, pastorUser.email, 'pastor', orgId)
        addAuthUser(manifest, leaderProfile.id, leaderUser.email, 'leader', orgId)
        addUser(manifest, pastorProfile.id, orgId, pastorUser.email, 'pastor')
        addUser(manifest, leaderProfile.id, orgId, leaderUser.email, 'leader')

        // Líder crea al cajero y activa auto_accept para agilizar la prueba
        await loginUserUI(leaderPage, leaderUser.email, leaderUser.password, BASE_URL)
        await leaderPage.goto(`${BASE_URL}/page/POS/users`, { waitUntil: 'domcontentloaded' })
        await leaderPage.getByLabel(/Nombre completo/i).fill(offlineCashier.name)
        await leaderPage.getByLabel(/^Email$/i).fill(offlineCashier.email)
        await leaderPage.getByLabel(/Contras/i).fill(offlineCashier.password)
        await selectRoleInUsersUI(leaderPage, 'Cajero')
        await leaderPage.getByRole('button', { name: /Crear Usuario/i }).click()
        await expect(leaderPage.getByText(offlineCashier.email, { exact: false })).toBeVisible({ timeout: 30000 })

        // Activar Auto-completar para no depender de cocina
        await toggleAutoAcceptUIInline(leaderPage, offlineCashier.email, true)
      })

      // 2. Cajero abre caja, realiza cobros y "pierde conexión / abandona turno"
      await test.step('Cajero abre caja, cobra y se desconecta abruptamente', async () => {
        await loginUserUI(cashierPage, offlineCashier.email, offlineCashier.password, BASE_URL)
        await openCashSessionUI(cashierPage, '50')

        // Realizar 2 cobros en móvil
        await performCheckoutUI(cashierPage, testProduct.name, '200', true)
        await performCheckoutUI(cashierPage, testProduct.name, '200', true)

        // Simular abandono / pérdida de conexión cerrando el contexto del cajero
        await cashierContext.close()
      })

      // 3. Líder entra a cashClosing, detecta la caja desatendida y ejecuta pre-cierre de contingencia
      await test.step('Líder rescata la sesión mediante Pre-cierre de Contingencia', async () => {
        await leaderPage.goto(`${BASE_URL}/page/POS/cashClosing`, { waitUntil: 'domcontentloaded' })

        // Verificar que aparezca la sección "Cajas Abiertas"
        const openSessionsHeader = leaderPage.getByText(/Cajas Abiertas/i).first()
        await expect(openSessionsHeader).toBeVisible({ timeout: 15000 })

        // Hacer clic en "Pre-cerrar (Contingencia)"
        const btnContingencia = leaderPage.getByRole('button', { name: /Pre-cerrar \(Contingencia\)/i }).first()
        await expect(btnContingencia).toBeVisible({ timeout: 15000 })
        await btnContingencia.click()

        // Verificar apertura del modal de contingencia
        const modal = leaderPage.locator('.v-dialog:visible').filter({ hasText: /Pre-cierre de Contingencia/i }).first()
        await expect(modal).toBeVisible({ timeout: 10000 })

        // Ingresar monto contado en cajón físico (Fondo 50 + Ventas 240 = 290)
        const inputContado = modal.locator('input[type="number"]').first()
        await inputContado.fill('290')

        // Ingresar justificación obligatoria
        const inputNota = modal.locator('textarea').first()
        await inputNota.fill('Arqueo de emergencia: terminal del cajero se quedó sin batería.')

        // Confirmar pre-cierre
        const btnConfirmar = modal.getByRole('button', { name: /Confirmar Pre-cierre/i })
        await expect(btnConfirmar).toBeEnabled({ timeout: 10000 })
        await btnConfirmar.click()

        // Verificar que la sesión pasa a "Cajas Pendientes de Validación"
        await expect(leaderPage.getByText(/Cajas Pendientes de Validacion/i).first()).toBeVisible({ timeout: 20000 })
      })

      // 4. Aprobación final por Líder/Pastor
      await test.step('Líder o Pastor aprueba el cierre definitivo', async () => {
        const btnAprobar = leaderPage.getByRole('button', { name: /Aprobar cierre/i }).first()
        await expect(btnAprobar).toBeVisible({ timeout: 15000 })
        await btnAprobar.click()

        await leaderPage.waitForTimeout(2000)

        // Verificar consistencia matemática en base de datos PostgreSQL
        await assertCashSessionConsistency(supabaseAdmin, orgId, leaderDeptId)
      })

    } finally {
      await leaderContext.close().catch(() => null)
      await executeCleanup(manifest, supabaseAdmin).catch(() => null)
    }
  })
})

// ── Helpers Locales de la Suite Multi-Viewport ──

async function getProfileByEmail(supabaseAdmin: any, email: string): Promise<any> {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('id,email,role,org_id,owner_id,onboarding_completed')
    .eq('email', email)
    .single()

  expect(error).toBeNull()
  return data
}

async function selectRoleInUsersUI(page: Page, roleTitle: string): Promise<void> {
  const roleSelect = page.locator('.v-input').filter({ hasText: /Rol/i }).first()
  await roleSelect.click()
  const roleOption = page.locator('.v-overlay-container .v-list-item').filter({ hasText: roleTitle }).last()
  await expect(roleOption).toBeVisible({ timeout: 10000 })
  await roleOption.click()
}

async function toggleAutoAcceptUIInline(page: Page, email: string, desiredState: boolean): Promise<void> {
  const row = page.locator('tr').filter({ hasText: email }).first()
  await expect(row).toBeVisible({ timeout: 30000 })

  const menuButton = row.locator('.mdi-dots-vertical').locator('xpath=ancestor::button').first()
  await menuButton.click()

  const desiredText = desiredState ? 'Auto-completar: ON' : 'Auto-completar: OFF'
  const autoAcceptItem = page.locator('.v-overlay-container .v-list-item').filter({
    hasText: /Auto-completar: (ON|OFF)/,
  }).last()

  await expect(autoAcceptItem).toBeVisible({ timeout: 10000 })
  const currentText = await autoAcceptItem.textContent()

  if (currentText?.includes(desiredText)) {
    await page.keyboard.press('Escape')
    return
  }

  await autoAcceptItem.click()
  await page.waitForTimeout(1000)
}

async function confirmAuthEmailForTestOnly(supabaseAdmin: any, email: string): Promise<void> {
  const { data: usersData, error: listError } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 })
  if (listError) throw listError

  const user = usersData?.users?.find((u: any) => u.email === email)
  if (!user?.id) throw new Error(`User not found for confirmation: ${email}`)

  await supabaseAdmin.auth.admin.updateUserById(user.id, { email_confirm: true })
}
