// tests/operational-chaos/final-user-journey.spec.ts
// ============================================================================
// FINAL USER JOURNEY
// Prueba E2E real desde UI: signup pastor -> onboarding -> lider -> staff -> POS/KDS.
// Service role se usa solo para captura forense y cleanup, no para crear el negocio.
// ============================================================================
import { expect, test, type Page } from '@playwright/test'
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

test.use({ trace: 'on', video: 'on', screenshot: 'on' })

test.describe('Final User Journey - Real customer flow', () => {
  test.skip(!isOperationalChaosEnabled(), 'Operational Chaos disabled')
  test.setTimeout(300000)

  test('pastor crea negocio por UI y el equipo opera POS/KDS/corte', async ({ browser }, testInfo) => {
    assertPhase2BExecutionAllowed()

    const runId = createRunId()
    const password = getTestPasswordSafe()
    const manifest = createEmptyManifest(runId)
    const supabaseAdmin = createClient(getSupabaseUrlSafe(), getServiceKeySafe(), {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const slug = runId.toLowerCase().replace(/[^a-z0-9-]/g, '-')
    const churchName = `Iglesia Real ${slug}`
    const onboardingProductName = 'Producto Pastor'
    const productName = 'Cafe Americano'
    const productBName = 'Biblia RVR'
    const pastor = {
      name: 'Pastor Journey',
      email: `pastor.${slug}@gmail.com`,
      password,
    }
    const leader = {
      name: 'Lider Cafeteria',
      email: `leader.${slug}@gmail.com`,
      password,
    }
    const leaderB = {
      name: 'Lider Libreria',
      email: `leader.books.${slug}@gmail.com`,
      password,
    }
    const cashier = {
      name: 'Cajero Cafeteria',
      email: `cashier.${slug}@gmail.com`,
      password,
    }
    const cashierB = {
      name: 'Cajero Libreria',
      email: `cashier.books.${slug}@gmail.com`,
      password,
    }
    const kitchen = {
      name: 'Cocina Cafeteria',
      email: `kitchen.${slug}@gmail.com`,
      password,
    }

    const pastorCtx = await browser.newContext()
    const leaderCtx = await browser.newContext()
    const leaderBCtx = await browser.newContext()
    const cashierCtx = await browser.newContext()
    const cashierBCtx = await browser.newContext()
    const kitchenCtx = await browser.newContext()

    const pastorPage = await pastorCtx.newPage()
    const leaderPage = await leaderCtx.newPage()
    const leaderBPage = await leaderBCtx.newPage()
    const cashierPage = await cashierCtx.newPage()
    const cashierBPage = await cashierBCtx.newPage()
    const kitchenPage = await kitchenCtx.newPage()

    let orgId = ''
    let leaderDepartmentId = ''
    let cleanupError: any = null

    try {
      await test.step('Signup real: pastor crea organizacion desde UI', async () => {
        await signupPastorUI(pastorPage, pastor, churchName, supabaseAdmin)
        await captureKnownEntitiesForCleanup(supabaseAdmin, manifest, {
          churchName,
          emails: [pastor.email],
        })
        saveJourneyManifest(manifest)

        const pastorProfile = await requireProfileByEmail(supabaseAdmin, pastor.email)
        expect(pastorProfile.role).toBe('pastor')
        expect(pastorProfile.org_id).toBeTruthy()
        expect(pastorProfile.onboarding_completed).toBe(false)
        orgId = pastorProfile.org_id
      })

      await test.step('Onboarding real: pastor configura org, producto inicial y lider', async () => {
        await completeOnboardingUI(pastorPage, {
          churchName,
          productName: onboardingProductName,
          productPrice: '150',
          leader,
        })

        await captureKnownEntitiesForCleanup(supabaseAdmin, manifest, {
          churchName,
          emails: [pastor.email, leader.email],
          productNames: [onboardingProductName],
        })
        saveJourneyManifest(manifest)

        const leaderProfile = await requireProfileByEmail(supabaseAdmin, leader.email)
        expect(leaderProfile.role).toBe('leader')
        expect(leaderProfile.org_id).toBe(orgId)
        leaderDepartmentId = leaderProfile.id

        await createUserFromUsersUI(pastorPage, leaderB, /L.der de Departamento/i)
        await captureKnownEntitiesForCleanup(supabaseAdmin, manifest, {
          churchName,
          emails: [pastor.email, leader.email, leaderB.email],
          productNames: [onboardingProductName],
        })
        saveJourneyManifest(manifest)

        const leaderBProfile = await requireProfileByEmail(supabaseAdmin, leaderB.email)
        expect(leaderBProfile.role).toBe('leader')
        expect(leaderBProfile.org_id).toBe(orgId)
      })

      await test.step('Lideres reales: crean staff y catalogos separados por departamento', async () => {
        await loginUserUI(leaderPage, leader.email, leader.password, BASE_URL)
        await createUserFromUsersUI(leaderPage, cashier, 'Cajero')
        await createUserFromUsersUI(leaderPage, kitchen, 'Cocina')
        await createProductFromProductsUI(leaderPage, productName, '150')

        await loginUserUI(leaderBPage, leaderB.email, leaderB.password, BASE_URL)
        await createUserFromUsersUI(leaderBPage, cashierB, 'Cajero')
        await createProductFromProductsUI(leaderBPage, productBName, '150')

        await captureKnownEntitiesForCleanup(supabaseAdmin, manifest, {
          churchName,
          emails: [pastor.email, leader.email, leaderB.email, cashier.email, cashierB.email, kitchen.email],
          productNames: [onboardingProductName, productName, productBName],
        })
        saveJourneyManifest(manifest)

        const cashierProfile = await requireProfileByEmail(supabaseAdmin, cashier.email)
        const cashierBProfile = await requireProfileByEmail(supabaseAdmin, cashierB.email)
        const kitchenProfile = await requireProfileByEmail(supabaseAdmin, kitchen.email)
        expect(cashierProfile.role).toBe('cashier')
        expect(cashierBProfile.role).toBe('cashier')
        expect(kitchenProfile.role).toBe('kitchen')
        expect(cashierProfile.org_id).toBe(orgId)
        expect(cashierBProfile.org_id).toBe(orgId)
        expect(kitchenProfile.org_id).toBe(orgId)
      })

      await test.step('Aislamiento real: cajero A no ve catalogo B y cajero B no ve catalogo A', async () => {
        await loginUserUI(cashierPage, cashier.email, cashier.password, BASE_URL)
        await assertCatalogIsolationUI(cashierPage, productName, productBName)

        await loginUserUI(cashierBPage, cashierB.email, cashierB.password, BASE_URL)
        await assertCatalogIsolationUI(cashierBPage, productBName, productName)
      })

      await test.step('Operacion real: cajero vende y cocina entrega/rechaza en KDS', async () => {
        const isMobile = testInfo.project.use.viewport
          ? testInfo.project.use.viewport.width < 960
          : false

        await cashierPage.goto(`${BASE_URL}/page/POS/pointOfSales`, { waitUntil: 'domcontentloaded' })
        await loginUserUI(kitchenPage, kitchen.email, kitchen.password, BASE_URL)
        await kitchenPage.goto(`${BASE_URL}/page/POS/kds`, { waitUntil: 'domcontentloaded' })

        await performCheckoutUI(cashierPage, productName, '200', isMobile)
        await completeKdsOrderUI(kitchenPage, productName)

        await performCheckoutUI(cashierPage, productName, '200', isMobile)
        await rejectKdsOrderUI(kitchenPage, productName)
      })

      await test.step('Cierre real: cajero hace corte y BD cuadra matematicamente', async () => {
        const today = new Date().toISOString().split('T')[0]
        await cashierPage.goto(`${BASE_URL}/page/POS/cashClosing`, { waitUntil: 'domcontentloaded' })
        await performCashClosingUI(cashierPage, today, '300')
        await assertMathematicalConsistency(supabaseAdmin, orgId, today, leaderDepartmentId)
      })
    } finally {
      try {
        await captureKnownEntitiesForCleanup(supabaseAdmin, manifest, {
          churchName,
          emails: [pastor.email, leader.email, leaderB.email, cashier.email, cashierB.email, kitchen.email],
          productNames: [onboardingProductName, productName, productBName],
        })
      } catch (err) {
        cleanupError = err
      }

      // Close browser contexts first to halt background updates before deleting records
      await Promise.allSettled([
        pastorCtx.close(),
        leaderCtx.close(),
        leaderBCtx.close(),
        cashierCtx.close(),
        cashierBCtx.close(),
        kitchenCtx.close(),
      ])

      try {
        saveJourneyManifest(manifest)
        await executeCleanup(manifest, supabaseAdmin as any)
      } catch (err) {
        if (!cleanupError) cleanupError = err
      }

      saveJourneyManifest(manifest)

      if (cleanupError) throw cleanupError
    }
  })
})

function saveJourneyManifest(manifest: ChaosManifest): void {
  saveManifestSafe(
    manifest,
    `tests/evidence/operational-chaos/manifest_${manifest.runId}.json`,
  )
}

async function signupPastorUI(
  page: Page,
  pastor: { name: string; email: string; password: string },
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
      page.getByText(/Configuraci[oó]n Inicial|Configura tu Iglesia/i).first()
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
    productName?: string
    productPrice?: string
    leader: { name: string; email: string; password: string }
  },
): Promise<void> {
  await page.waitForURL(url => url.toString().includes('/onboarding'), { timeout: 30000 })

  await page.getByPlaceholder(/Iglesia Nueva Vida/i).fill(data.churchName)
  await page.getByRole('button', { name: /Siguiente/i }).click()

  await page.getByPlaceholder(/lider@iglesia\.com/i).fill(data.leader.email)
  await page.getByPlaceholder(/Juan/i).fill(data.leader.name)
  await page.getByPlaceholder(/contrase/i).fill(data.leader.password)
  await page.getByRole('button', { name: /Finalizar/i }).click()
  await page.waitForURL(url => url.toString().includes('/page/POS/pointOfSales'), { timeout: 30000 })
}

async function createUserFromUsersUI(
  page: Page,
  user: { name: string; email: string; password: string },
  roleTitle: string | RegExp,
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

function matchesText(text: string, matcher: string | RegExp): boolean {
  if (typeof matcher === 'string') return text.includes(matcher)
  return new RegExp(matcher.source, matcher.flags).test(text)
}

async function assertCatalogIsolationUI(
  page: Page,
  visibleProductName: string,
  hiddenProductName: string,
): Promise<void> {
  await page.goto(`${BASE_URL}/page/POS/pointOfSales`, { waitUntil: 'domcontentloaded' })
  await expect(page.getByText(visibleProductName, { exact: false }).first()).toBeVisible({ timeout: 30000 })
  await expect(page.getByText(hiddenProductName, { exact: false })).toHaveCount(0)
}

async function createProductFromProductsUI(
  page: Page,
  productName: string,
  productPrice: string,
): Promise<void> {
  await page.goto(`${BASE_URL}/page/POS/products`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: /Nuevo Producto/i }).click()
  await page.getByLabel(/Nombre del Producto/i).fill(productName)
  await page.getByLabel(/Precio/i).fill(productPrice)
  await page.getByRole('button', { name: /Guardar/i }).click()
  await expect(page.getByText(productName, { exact: false })).toBeVisible({ timeout: 30000 })
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
    'Admin email confirmation timed out during final user journey',
  )

  if (error) {
    throw new Error(`Admin email confirmation failed during final user journey: ${error.message}`)
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
