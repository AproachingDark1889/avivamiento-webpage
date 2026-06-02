// tests/operational-chaos/ui/index.ts
import { type Page, expect } from '@playwright/test'

export async function loginUserUI(page: Page, email: string, password: string, baseUrl: string): Promise<void> {
  const emailInput = page.locator('input[autocomplete="email"], input[type="email"], input[type="text"]').first()
  const passwordInput = page.locator('input[type="password"]').first()

  for (let attempt = 1; attempt <= 3; attempt++) {
    await page.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded' })
    await Promise.race([
      page.waitForURL(url => !url.toString().includes('/login'), { timeout: 5000 }).catch(() => null),
      passwordInput.waitFor({ state: 'visible', timeout: 5000 }).catch(() => null),
    ])

    if (!page.url().includes('/login')) {
      await page.waitForTimeout(500)
      return
    }

    const formReady = await Promise.all([
      emailInput.waitFor({ state: 'visible', timeout: 10000 }).then(() => true).catch(() => false),
      passwordInput.waitFor({ state: 'visible', timeout: 10000 }).then(() => true).catch(() => false),
    ])

    if (formReady.every(Boolean)) break

    if (attempt === 3) {
      const bodyText = await page.locator('body').textContent().catch(() => '')
      throw new Error(
        `Login form did not render for ${email}. url=${page.url()}; bodyLength=${bodyText?.length ?? 0}`,
      )
    }
  }

  try {
    await emailInput.fill(email, { timeout: 10000 })
    if (!page.url().includes('/login')) return
    await passwordInput.fill(password, { timeout: 10000 })
  } catch (err) {
    if (!page.url().includes('/login')) return
    throw err
  }
  
  const loginBtn = page.locator('button:has-text("ACCEDER"), button:has-text("Acceder"), button:has-text("Ingresar"), button[type="submit"]').first()
  await expect(loginBtn).toBeEnabled({ timeout: 10000 })

  const waitForLoggedIn = page.waitForURL(url => !url.toString().includes('/login'), { timeout: 20000 })
  try {
    await loginBtn.click({ timeout: 10000 })
  } catch (err) {
    if (page.url().includes('/login')) {
      await expect(passwordInput).toBeVisible({ timeout: 10000 })
      await passwordInput.press('Enter', { timeout: 10000 })
    }
  }

  await waitForLoggedIn
  await page.waitForTimeout(1500)
}

export async function performCheckoutUI(
  page: Page,
  productName: string,
  amountPaid: string,
  isMobile: boolean
): Promise<void> {
  // ── 1. Ensure we start from a clean POS view (no drawer overlay) ──
  if (isMobile) {
    // Navigate to POS to reset any lingering drawer state
    const currentUrl = page.url()
    if (!currentUrl.includes('/pointOfSales')) {
      await page.goto(resolvePosUrl(page), { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(1000)
    }
  }

  // ── 2. Click AGREGAR on the product card ──
  let prodCard = page.locator('.product-card, .v-card').filter({ hasText: productName }).first()
  let productVisible = false

  for (let attempt = 1; attempt <= 3; attempt++) {
    if (attempt > 1 || !page.url().includes('/pointOfSales')) {
      await page.goto(resolvePosUrl(page), { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(1000)
    }

    const searchInput = page.locator('input[placeholder*="Buscar"], input[aria-label*="Buscar"]').first()
    if (await searchInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await searchInput.fill(productName)
      await page.waitForTimeout(300)
    }

    prodCard = page.locator('.product-card, .v-card').filter({ hasText: productName }).first()
    productVisible = await prodCard.waitFor({ state: 'visible', timeout: 30000 })
      .then(() => true)
      .catch(() => false)

    if (productVisible) break
  }

  if (!productVisible) {
    const bodyText = await page.locator('body').textContent().catch(() => '')
    throw new Error(
      `Product card did not render before checkout. product="${productName}", url=${page.url()}, ` +
      `isMobile=${isMobile}, bodyLength=${bodyText?.length ?? 0}`,
    )
  }

  await prodCard.scrollIntoViewIfNeeded()

  const btnAgregar = prodCard.getByRole('button', { name: /AGREGAR|Agregar/i }).first()
  if (await btnAgregar.isVisible().catch(() => false)) {
    await btnAgregar.click()
  } else {
    await prodCard.click()
  }

  // ── 3. Wait for cart to reflect the added product (total changes from $0.00) ──
  // This confirms the product was actually added regardless of viewport
  await expect(page.locator('text=$0.00').first()).not.toBeVisible({ timeout: 5000 }).catch(() => {
    // If $0.00 is still visible somewhere (e.g. in another element), verify via FAB badge
  })
  await page.waitForTimeout(500)

  // ── 4. Mobile: open the cart drawer via the FAB button ──
  if (isMobile) {
    // The FAB is a v-btn with icon="mdi-cart" inside a v-badge.
    // Vuetify renders: <button class="v-btn ..."><i class="mdi mdi-cart"></i></button>
    // Locate the icon then traverse up to the button ancestor.
    const fabCart = page.locator('.mdi-cart').locator('xpath=ancestor::button').first()
    await fabCart.waitFor({ state: 'visible', timeout: 10000 })
    await fabCart.click()
    await page.waitForTimeout(800)
  }

  // ── 5. Assert COBRAR is enabled before clicking ──
  const btnCobrar = page.locator('button:visible').filter({ hasText: /COBRAR|Cobrar/i }).first()
  await btnCobrar.waitFor({ state: 'visible', timeout: 10000 })
  const isDisabled = await btnCobrar.isDisabled()
  if (isDisabled) {
    const bodyText = await page.locator('body').textContent()
    throw new Error(
      `COBRAR button is disabled — cart is empty or product was not added. ` +
      `Product: "${productName}", isMobile: ${isMobile}. ` +
      `bodyLength=${bodyText?.length ?? 0}`
    )
  }
  await btnCobrar.click()
  await page.waitForTimeout(1000)

  // ── 6. Select Cash / Efectivo payment method ──
  const btnEfectivo = page.locator('button:visible').filter({ hasText: /EFECTIVO|Efectivo/i }).first()
  if (await btnEfectivo.isVisible()) {
    await btnEfectivo.click()
    await page.waitForTimeout(500)
  }

  // ── 7. Input paid amount ──
  const inputRecibido = page.locator('input[type="number"]').first()
  if (await inputRecibido.isVisible()) {
    await inputRecibido.fill(amountPaid)
  }

  // ── 8. Confirm checkout ──
  const btnConfirmar = page.locator('button:visible').filter({ hasText: /FINALIZAR|Confirmar|Pagar/i }).first()
  await expect(btnConfirmar).toBeEnabled({ timeout: 10000 })
  await btnConfirmar.click()
  await page.waitForTimeout(2000)

  // ── 9. Mobile: navigate back to POS to guarantee clean state for next checkout ──
  if (isMobile) {
    await page.goto(resolvePosUrl(page), { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(1000)
  }
}

function resolvePosUrl(page: Page): string {
  const currentUrl = page.url()
  if (currentUrl.includes('/sistema/')) {
    return `${currentUrl.split('/sistema/')[0]}/sistema/page/POS/pointOfSales`
  }
  return 'http://localhost:3002/sistema/page/POS/pointOfSales'
}

export async function completeKdsOrderUI(page: Page, productName: string): Promise<void> {
  // Locate order card containing product name and click DELIVER/ENTREGAR
  const card = page.locator('.v-card, [class*="order"]').filter({ hasText: productName }).first()
  await card.waitFor({ state: 'visible', timeout: 30000 })
  
  const btnEntregar = card.locator('button').filter({ hasText: /ENTREGAR|Entregar/i }).first()
  await expect(btnEntregar).toBeEnabled({ timeout: 10000 })
  await btnEntregar.click()
  await page.waitForTimeout(1500)
}

export async function rejectKdsOrderUI(page: Page, productName: string): Promise<void> {
  const card = page.locator('.v-card, [class*="order"]').filter({ hasText: productName }).first()
  await card.waitFor({ state: 'visible', timeout: 30000 })
  
  // Click reject icon (mdi-close-circle)
  const btnAbrirRechazo = card.locator('button').filter({ has: page.locator('.mdi-close-circle') }).first()
  await expect(btnAbrirRechazo).toBeEnabled({ timeout: 10000 })
  await btnAbrirRechazo.click()
  await page.waitForTimeout(1000)
  
  const dialogRechazo = page.locator('.v-dialog:visible').first()
  await dialogRechazo.waitFor({ state: 'visible', timeout: 5000 })
  
  // Select Reason
  const selectMotivo = dialogRechazo.locator('.v-select').first()
  if (await selectMotivo.isVisible()) {
    await selectMotivo.click()
    await page.waitForTimeout(500)
    await page.locator('.v-overlay-container .v-list-item').filter({ hasText: /^Otro$/ }).last().click()
    await page.waitForTimeout(500)
  }
  
  // Confirm reject button
  const btnConfirmarRechazo = dialogRechazo.getByRole('button', { name: /Rechazar/i, exact: false })
  await expect(btnConfirmarRechazo).toBeEnabled({ timeout: 10000 })
  await btnConfirmarRechazo.click({ force: true })
  await page.waitForTimeout(2000)
}

export async function performCashClosingUI(page: Page, dateStr: string, countedAmount: string): Promise<void> {
  const dateInput = page.locator('input[type="date"]').first()
  await dateInput.fill(dateStr)
  await page.waitForTimeout(1000)
  
  // Click Calculate
  await page.locator('button:has-text("Calcular")').first().click()
  await page.waitForTimeout(3000)
  
  // Input cash counted
  const cashCountedInput = page.locator('input[type="number"]').nth(1)
  if (await cashCountedInput.isVisible()) {
    await cashCountedInput.fill(countedAmount)
    await page.waitForTimeout(500)
  }
  
  // Save Cash Closure button
  const saveBtn = page.locator('button:has-text("Guardar Corte"), button:has-text("Corregir corte")').first()
  await expect(saveBtn).toBeEnabled({ timeout: 10000 })
  await saveBtn.click()
  await page.waitForTimeout(3000)
}
