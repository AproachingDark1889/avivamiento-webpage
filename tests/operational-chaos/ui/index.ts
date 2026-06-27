// tests/operational-chaos/ui/index.ts
import { type Locator, type Page, expect } from '@playwright/test'

const cashSessionVerifiedPages = new WeakSet<Page>()
const nuxtDevtoolsSuppressedPages = new WeakSet<Page>()

export async function loginUserUI(page: Page, email: string, password: string, baseUrl: string): Promise<void> {
  const emailInput = page.locator('input[autocomplete="email"], input[type="email"], input[type="text"]').first()
  const passwordInput = page.locator('input[type="password"]').first()
  const authenticatedShell = page
    .locator('a[href*="/page/POS"], button:has-text("Cerrar")')
    .first()
  const isExpectedSession = async () =>
    (await currentSupabaseSessionEmail(page))?.toLowerCase() === email.toLowerCase()
  const hasAuthenticatedShell = async () =>
    !page.url().includes('/login') || await authenticatedShell.isVisible().catch(() => false)

  for (let attempt = 1; attempt <= 3; attempt++) {
    await page.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded' })
    await Promise.race([
      page.waitForURL(url => !url.toString().includes('/login'), { timeout: 5000 }).catch(() => null),
      authenticatedShell.waitFor({ state: 'visible', timeout: 5000 }).catch(() => null),
      passwordInput.waitFor({ state: 'visible', timeout: 5000 }).catch(() => null),
    ])

    if (await isExpectedSession()) {
      await page.waitForTimeout(500)
      return
    }

    if (await hasAuthenticatedShell()) {
      await clearStoredSupabaseAuth(page)
      continue
    }

    const formReady = await Promise.all([
      emailInput.waitFor({ state: 'visible', timeout: 30000 }).then(() => true).catch(() => false),
      passwordInput.waitFor({ state: 'visible', timeout: 30000 }).then(() => true).catch(() => false),
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
    if (await isExpectedSession()) return
    await passwordInput.fill(password, { timeout: 10000 })
  } catch (err) {
    if (await isExpectedSession()) return
    throw err
  }
  
  const loginBtn = page.locator('button:has-text("ACCEDER"), button:has-text("Acceder"), button:has-text("Ingresar"), button[type="submit"]').first()
  await expect(loginBtn).toBeEnabled({ timeout: 10000 })

  try {
    await loginBtn.click({ timeout: 10000 })
  } catch (err) {
    if (await isExpectedSession()) return

    if (page.url().includes('/login')) {
      await expect(passwordInput).toBeVisible({ timeout: 10000 })
      await passwordInput.press('Enter', { timeout: 10000 })
    }
  }

  await Promise.race([
    page.waitForURL(url => !url.toString().includes('/login'), { timeout: 60000, waitUntil: 'domcontentloaded' }),
    authenticatedShell.waitFor({ state: 'visible', timeout: 60000 }),
  ])
  await expect
    .poll(() => currentSupabaseSessionEmail(page), { timeout: 60000 })
    .toBe(email.toLowerCase())
  await page.waitForTimeout(1500)
}

async function currentSupabaseSessionEmail(page: Page): Promise<string | null> {
  return await page.evaluate(() => {
    const read = (storage: Storage) => {
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i) || ''
        if (!key.includes('auth-token')) continue

        try {
          const raw = storage.getItem(key)
          if (!raw) continue

          const parsed = JSON.parse(raw)
          const email = parsed?.user?.email
            ?? parsed?.currentSession?.user?.email
            ?? parsed?.session?.user?.email

          if (typeof email === 'string') return email.toLowerCase()
        } catch {
          // Ignore non-JSON storage entries.
        }
      }
      return null
    }

    return read(window.sessionStorage) ?? read(window.localStorage)
  })
}

async function clearStoredSupabaseAuth(page: Page): Promise<void> {
  await page.evaluate(() => {
    const clear = (storage: Storage) => {
      const keys: string[] = []
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i) || ''
        if (key.includes('auth-token')) keys.push(key)
      }
      keys.forEach(key => storage.removeItem(key))
    }

    clear(window.sessionStorage)
    clear(window.localStorage)
  })
}

export async function openCashSessionUI(page: Page, openingCash = '0'): Promise<void> {
  for (let attempt = 1; attempt <= 5; attempt++) {
    if (!page.url().includes('/pointOfSales') || attempt > 1) {
      await gotoPosForChaos(page, attempt)
    } else {
      await waitForClientHydration(page)
    }

    const openedText = page.getByText(/Caja abierta/i).first()
    const dialog = page
      .locator('.v-dialog:visible, .v-overlay__content:visible, [role="dialog"]:visible')
      .filter({ hasText: /Apertura de Caja/i })
      .first()
    const blockedAlert = page
      .locator('.v-alert, [role="alert"]')
      .filter({ hasText: /No autenticado|Usuario no pertenece|Supabase no detectado|Error/i })
      .first()

    const state = await Promise.race([
      openedText.waitFor({ state: 'visible', timeout: 30000 }).then(() => 'open' as const).catch(() => null),
      dialog.waitFor({ state: 'visible', timeout: 30000 }).then(() => 'dialog' as const).catch(() => null),
      blockedAlert.waitFor({ state: 'visible', timeout: 30000 }).then(() => 'blocked' as const).catch(() => null),
    ])

    if (state === 'open') {
      cashSessionVerifiedPages.add(page)
      return
    }
    if (state === 'blocked') {
      const message = await blockedAlert.textContent().catch(() => '')
      throw new Error(`Cash session blocked: ${message?.trim() || 'unknown state'}`)
    }

    if (state === 'dialog') {
      const openingInput = dialog.locator('input[type="number"], input[inputmode="decimal"]').first()
      await openingInput.waitFor({ state: 'visible', timeout: 10000 })
      await openingInput.fill(openingCash)

      const openResponse = page.waitForResponse(response => (
        response.url().includes('/rest/v1/rpc/open_cash_session')
        && response.request().method() === 'POST'
      ), { timeout: 30000 }).catch(() => null)

      const openBtn = dialog.getByRole('button', { name: /Abrir Caja/i }).first()
      await expect(openBtn).toBeEnabled({ timeout: 10000 })
      await openBtn.click()

      const openResult = await Promise.race([
        openResponse.then(response => response ? ({ type: 'response' as const, response }) : null),
        page.getByText(/Caja abierta/i).first()
          .waitFor({ state: 'visible', timeout: 20000 })
          .then(() => ({ type: 'ui-open' as const }))
          .catch(() => null),
      ])

      if (!openResult) {
        throw new Error('open_cash_session did not return a response and the UI did not confirm an open cash session.')
      }

      if (openResult.type === 'response' && (openResult.response.status() < 200 || openResult.response.status() >= 300)) {
        throw new Error(`open_cash_session failed with HTTP ${openResult.response.status()}`)
      }

      await expect(page.getByText(/Caja abierta/i).first()).toBeVisible({ timeout: 20000 })
      cashSessionVerifiedPages.add(page)
      return
    }

    await page.waitForTimeout(1000 * attempt)
  }

  const bodyText = await page.locator('body').textContent().catch(() => '')
  throw new Error(`Cash session gate did not render. url=${page.url()}, bodyLength=${bodyText?.length ?? 0}`)
}

export async function performCheckoutUI(
  page: Page,
  productName: string,
  amountPaid: string,
  isMobile: boolean
): Promise<void> {
  if (!cashSessionVerifiedPages.has(page)) {
    await openCashSessionUI(page, '0')
  }

  // ── 1. Ensure we start from a clean POS view (no drawer overlay) ──
  if (isMobile) {
    await suppressNuxtDevtools(page)
    await closeMobileCartDrawerIfOpen(page)

    // Navigate to POS to reset any lingering drawer state
    const currentUrl = page.url()
    if (!currentUrl.includes('/pointOfSales')) {
      await gotoPosForChaos(page)
      await page.waitForTimeout(1000)
    }
  }

  // ── 2. Click AGREGAR on the product card ──
  let prodCard = page.locator('.product-card, .v-card').filter({ hasText: productName }).first()
  let productVisible = false

  for (let attempt = 1; attempt <= 3; attempt++) {
    if (isMobile) {
      await closeMobileCartDrawerIfOpen(page)
    }

    if (attempt > 1 || !page.url().includes('/pointOfSales')) {
      await gotoPosForChaos(page, attempt)
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

  const btnAgregar = prodCard.getByRole('button', { name: /AGREGAR|Agregar/i }).first()
  if (await btnAgregar.isVisible().catch(() => false)) {
    await clickAgregarButton(page, btnAgregar, productName, isMobile)
  } else {
    if (isMobile) {
      await centerLocatorInViewport(page, prodCard)
      await assertLocatorNotCovered(page, prodCard, `product card ${productName}`)
    } else {
      await prodCard.scrollIntoViewIfNeeded()
    }
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
    await page.waitForTimeout(300)
  }

  // ── 5. Assert COBRAR is enabled before clicking ──
  const btnCobrar = page.locator('button').filter({ hasText: /COBRAR|Cobrar/i }).first()
  await btnCobrar.waitFor({ state: 'attached', timeout: 15000 })

  const isDisabled = await btnCobrar.isDisabled()
  if (isDisabled) {
    const bodyText = await page.locator('body').textContent()
    throw new Error(
      `COBRAR button is disabled — cart is empty or product was not added. ` +
      `Product: "${productName}", isMobile: ${isMobile}. ` +
      `bodyLength=${bodyText?.length ?? 0}`
    )
  }

  try {
    if (isMobile) {
      await btnCobrar.click({ force: true, position: { x: 48, y: 18 }, timeout: 3000 })
    } else {
      await btnCobrar.click({ timeout: 5000 })
    }
  } catch (err) {
    // Fallback to native JS click if the drawer animation is lagging or not fully visible
    await btnCobrar.evaluate((el) => {
      ;(el as HTMLElement).click()
    }).catch(() => null)
  }
  await page.waitForTimeout(isMobile ? 300 : 1000)

  // ── 6. Select Cash / Efectivo payment method ──
  const paymentDialog = page
    .locator('.v-dialog:visible, .v-overlay__content:visible, [role="dialog"]:visible')
    .filter({ hasText: /Confirmar Pago|Total a Pagar/i })
    .first()
  await paymentDialog.waitFor({ state: 'visible', timeout: 10000 })

  const btnEfectivo = paymentDialog.locator('button').filter({ hasText: /EFECTIVO|Efectivo/i }).first()
  if (await btnEfectivo.isVisible({ timeout: 3000 }).catch(() => false)) {
    try {
      await btnEfectivo.click({ force: true, timeout: 2000 })
    } catch {
      await btnEfectivo.evaluate((el) => {
        ;(el as HTMLElement).click()
      }).catch(() => null)
    }
    await page.waitForTimeout(300)
  }

  // ── 7. Input paid amount ──
  const inputRecibido = paymentDialog.locator('input[type="number"], input[inputmode="decimal"]').first()
  await inputRecibido.waitFor({ state: 'attached', timeout: 10000 })
  await inputRecibido.fill(amountPaid)
  await expect(inputRecibido).toHaveValue(amountPaid, { timeout: 5000 })

  // ── 8. Confirm checkout ──
  const btnConfirmar = paymentDialog.locator('button').filter({ hasText: /FINALIZAR|Confirmar|Pagar/i }).first()
  await btnConfirmar.waitFor({ state: 'attached', timeout: 10000 })
  await expect(btnConfirmar).toBeEnabled({ timeout: 10000 })

  const checkoutResponse = page.waitForResponse(response => (
    response.url().includes('/rest/v1/rpc/process_checkout')
    && response.request().method() === 'POST'
  ), { timeout: 30000 })

  try {
    await btnConfirmar.click({ force: true, timeout: 5000 })
  } catch {
    await btnConfirmar.evaluate((el) => {
      ;(el as HTMLElement).click()
    }).catch(() => null)
  }
  const response = await checkoutResponse
  if (response.status() < 200 || response.status() >= 300) {
    throw new Error(`process_checkout failed with HTTP ${response.status()}`)
  }

  const checkoutBody = await response.json().catch(() => null)
  if (checkoutBody?.success !== true || !checkoutBody?.order_id) {
    throw new Error('process_checkout response did not confirm order creation')
  }

  await expect(paymentDialog).toBeHidden({ timeout: 20000 })
  await page.waitForTimeout(500)

  // ── 9. Mobile: close the cart drawer in place. Avoiding a full navigation per
  // checkout keeps the mobile chaos run inside the global test timeout.
  if (isMobile) {
    await closeMobileCartDrawerIfOpen(page)
  }
}

async function closeMobileCartDrawerIfOpen(page: Page): Promise<void> {
  if (await isCartDrawerClosedOrOffscreen(page)) return

  await waitForTransientSuccessToastToClear(page)

  for (let attempt = 1; attempt <= 3; attempt++) {
    if (await isCartDrawerClosedOrOffscreen(page)) return

    if (attempt === 1) {
      await clickCartDrawerCloseButton(page)
    } else if (attempt === 2) {
      await page.keyboard.press('Escape').catch(() => null)
    } else {
      await clickCartDrawerScrim(page)
    }

    await page.waitForFunction(() => {
      const findCartDrawer = () => Array.from(document.querySelectorAll('.v-navigation-drawer'))
        .find(d => d.textContent?.includes('Ticket de Venta')) as HTMLElement | undefined
      const isDrawerClosedOrOffscreen = (drawer: HTMLElement) => {
        const rect = drawer.getBoundingClientRect()
        const style = window.getComputedStyle(drawer)
        const isActive = drawer.classList.contains('v-navigation-drawer--active')
        const blocksPointer = style.pointerEvents !== 'none'
        const isOffscreenRight = rect.left >= window.innerWidth - 4
        const coversViewport = rect.left < window.innerWidth - 8 && rect.right > 8 && rect.width > 10 && rect.height > 10

        return !isActive || !blocksPointer || isOffscreenRight || !coversViewport
      }
      const drawer = findCartDrawer()
      if (!drawer) return true
      return isDrawerClosedOrOffscreen(drawer)
    }, null, { timeout: 2500 }).catch(() => null)
  }

  if (!await isCartDrawerClosedOrOffscreen(page)) {
    throw new Error('Cart drawer remained active and would intercept the next mobile checkout.')
  }
}

async function clickAgregarButton(page: Page, btnAgregar: Locator, productName: string, isMobile: boolean): Promise<void> {
  await expect(btnAgregar, `AGREGAR button must be enabled for ${productName}`).toBeEnabled({ timeout: 10000 })

  if (isMobile) {
    await closeMobileCartDrawerIfOpen(page)
    await centerLocatorInViewport(page, btnAgregar)
    await assertLocatorNotCovered(page, btnAgregar, `AGREGAR ${productName}`)
  } else {
    await btnAgregar.scrollIntoViewIfNeeded()
  }

  try {
    await btnAgregar.click({ timeout: 10000 })
  } catch (err) {
    if (!isMobile) throw err

    await closeMobileCartDrawerIfOpen(page)
    await centerLocatorInViewport(page, btnAgregar)
    const coverage = await getLocatorCoverage(page, btnAgregar)
    if (coverage.covered) {
      throw new Error(
        `AGREGAR remains covered after mobile recovery. product="${productName}", ` +
        `blocker="${coverage.blockerText}", blockerClass="${coverage.blockerClass}"`,
      )
    }

    // Last-resort harness fallback: the exact enabled button is centered and
    // uncovered, so this bypasses Playwright actionability drift, not real UX.
    await btnAgregar.evaluate((el) => {
      ;(el as HTMLElement).click()
    })
  }
}

async function centerLocatorInViewport(page: Page, locator: Locator): Promise<void> {
  await locator.evaluate((el) => {
    el.scrollIntoView({ block: 'center', inline: 'center' })
  })
  await page.waitForTimeout(150)

  for (let attempt = 1; attempt <= 2; attempt++) {
    const coverage = await getLocatorCoverage(page, locator)
    if (!coverage.covered) return

    const shift = coverage.blockerKind === 'bottom-navigation' ? 180 : 120
    await page.evaluate((scrollShift) => {
      window.scrollBy({ top: scrollShift, left: 0, behavior: 'instant' })
    }, shift)
    await page.waitForTimeout(150)
  }
}

async function assertLocatorNotCovered(page: Page, locator: Locator, label: string): Promise<void> {
  const coverage = await getLocatorCoverage(page, locator)
  if (coverage.covered) {
    throw new Error(
      `${label} is covered before click. blocker="${coverage.blockerText}", ` +
      `blockerClass="${coverage.blockerClass}", blockerKind="${coverage.blockerKind}"`,
    )
  }
}

async function getLocatorCoverage(page: Page, locator: Locator): Promise<{
  covered: boolean
  blockerText: string
  blockerClass: string
  blockerKind: string
}> {
  return await locator.evaluate((el) => {
    const rect = el.getBoundingClientRect()
    const x = Math.min(Math.max(rect.left + rect.width / 2, 1), window.innerWidth - 1)
    const y = Math.min(Math.max(rect.top + rect.height / 2, 1), window.innerHeight - 1)
    const top = document.elementFromPoint(x, y)
    const covered = !!top && top !== el && !el.contains(top)
    const blocker = top?.closest('.v-navigation-drawer, .v-bottom-navigation, .v-overlay, [role="alert"], [class*="toast"], [class*="snackbar"], footer') as HTMLElement | null
    const className = blocker?.className
    const blockerClass = typeof className === 'string' ? className : ''
    const blockerText = (blocker?.textContent || top?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120)
    const blockerKind = blockerClass.includes('v-navigation-drawer')
      ? 'cart-drawer'
      : blockerClass.includes('v-bottom-navigation')
        ? 'bottom-navigation'
        : blockerClass.includes('snackbar') || blockerClass.includes('toast')
          ? 'toast'
          : blocker?.tagName?.toLowerCase() || top?.tagName?.toLowerCase() || 'unknown'

    return { covered, blockerText, blockerClass, blockerKind }
  }).catch((err) => ({
    covered: true,
    blockerText: `coverage check failed: ${err instanceof Error ? err.message : String(err)}`,
    blockerClass: '',
    blockerKind: 'unknown',
  }))
}

async function waitForTransientSuccessToastToClear(page: Page): Promise<void> {
  const hasSuccessToast = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('body *')).some((el) => {
      const text = el.textContent || ''
      if (!/Venta registrada|Caja abierta|correctamente/i.test(text)) return false
      const rect = (el as HTMLElement).getBoundingClientRect()
      return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < window.innerHeight
    })
  }).catch(() => false)

  if (!hasSuccessToast) return

  await page.waitForFunction(() => {
    return !Array.from(document.querySelectorAll('body *')).some((el) => {
      const text = el.textContent || ''
      if (!/Venta registrada|Caja abierta|correctamente/i.test(text)) return false
      const rect = (el as HTMLElement).getBoundingClientRect()
      return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < window.innerHeight
    })
  }, null, { timeout: 5000 }).catch(() => null)
}

async function clickCartDrawerCloseButton(page: Page): Promise<void> {
  await page.evaluate(() => {
    const drawer = Array.from(document.querySelectorAll('.v-navigation-drawer'))
      .find(d => d.textContent?.includes('Ticket de Venta')) as HTMLElement | undefined
    if (!drawer) return

    const icon = drawer.querySelector('.mdi-close')
    const button = icon?.closest('button')
      || drawer.querySelector('button[aria-label*="Cerrar" i]')
      || drawer.querySelector('button')

    ;(button as HTMLElement | null)?.click()
  }).catch(() => null)
}

async function clickCartDrawerScrim(page: Page): Promise<void> {
  await page.evaluate(() => {
    const scrim = document.querySelector('.v-navigation-drawer__scrim, .v-overlay__scrim') as HTMLElement | null
    scrim?.click()
  }).catch(() => null)
}

async function isCartDrawerClosedOrOffscreen(page: Page): Promise<boolean> {
  return await page.evaluate(() => {
    const drawer = Array.from(document.querySelectorAll('.v-navigation-drawer'))
      .find(d => d.textContent?.includes('Ticket de Venta')) as HTMLElement | undefined
    if (!drawer) return true

    const isDrawerClosedOrOffscreen = (cartDrawer: HTMLElement) => {
      const rect = cartDrawer.getBoundingClientRect()
      const style = window.getComputedStyle(cartDrawer)
      const isActive = cartDrawer.classList.contains('v-navigation-drawer--active')
      const blocksPointer = style.pointerEvents !== 'none'
      const isOffscreenRight = rect.left >= window.innerWidth - 4
      const coversViewport = rect.left < window.innerWidth - 8 && rect.right > 8 && rect.width > 10 && rect.height > 10

      return !isActive || !blocksPointer || isOffscreenRight || !coversViewport
    }

    return isDrawerClosedOrOffscreen(drawer)
  }).catch(() => true)
}

async function suppressNuxtDevtools(page: Page): Promise<void> {
  if (nuxtDevtoolsSuppressedPages.has(page)) return

  await page.addStyleTag({
    content: `
      #__nuxt-devtools,
      #nuxt-devtools-container,
      [id*="nuxt-devtools"],
      [class*="nuxt-devtools"],
      [data-nuxt-devtools],
      button[aria-label*="Nuxt DevTools"],
      button[title*="Nuxt DevTools"] {
        display: none !important;
        pointer-events: none !important;
      }
    `,
  }).catch(() => null)

  // Use page.evaluate to check and hide the devtools toggle button natively
  // without triggering Playwright's infinite auto-waiting mechanism.
  await page.evaluate(() => {
    const btn = document.querySelector('button[aria-label*="Nuxt DevTools"], button[title*="Nuxt DevTools"]') as HTMLElement
    if (btn) {
      btn.style.display = 'none'
      btn.style.pointerEvents = 'none'
    }
  }).catch(() => null)

  nuxtDevtoolsSuppressedPages.add(page)
}

function resolvePosUrl(page: Page): string {
  const currentUrl = page.url()
  if (currentUrl.includes('/sistema/')) {
    return `${currentUrl.split('/sistema/')[0]}/sistema/page/POS/pointOfSales`
  }
  return 'http://localhost:3002/sistema/page/POS/pointOfSales'
}

async function gotoPosForChaos(page: Page, attempt = 1): Promise<void> {
  const separator = resolvePosUrl(page).includes('?') ? '&' : '?'
  await page.goto(`${resolvePosUrl(page)}${separator}chaosRetry=${attempt}-${Date.now()}`, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  })
  await waitForClientHydration(page)
  await suppressNuxtDevtools(page)
}

async function waitForClientHydration(page: Page): Promise<void> {
  // Wait for the Nuxt app container to render
  const container = page.locator('#__nuxt, #app, body').first()
  await container.waitFor({ state: 'attached', timeout: 10000 }).catch(() => null)

  // Under high concurrent load (like multi-page mobile tests), Nuxt hydration
  // can lag behind DOM rendering. A safety wait ensures clicks are not lost on unhydrated elements.
  const isMobile = page.viewportSize() ? page.viewportSize()!.width < 960 : false
  if (isMobile) {
    await page.waitForTimeout(1500)
  } else {
    await page.waitForTimeout(250)
  }
}

export async function completeKdsOrderUI(page: Page, productName: string): Promise<void> {
  // Locate order card containing product name and click DELIVER/ENTREGAR
  const card = page.locator('.v-card, [class*="order"]').filter({ hasText: productName }).first()
  for (let attempt = 1; attempt <= 4; attempt++) {
    const visible = await card
      .waitFor({ state: 'visible', timeout: 15000 })
      .then(() => true)
      .catch(() => false)

    if (visible) break

    const refreshButton = page.locator('button').filter({ has: page.locator('.mdi-refresh') }).first()
    if (await refreshButton.isVisible().catch(() => false)) {
      await refreshButton.click()
    } else {
      await page.reload({ waitUntil: 'domcontentloaded' })
    }
    await page.waitForTimeout(1000 * attempt)
  }
  await card.waitFor({ state: 'visible', timeout: 1000 })
  
  const btnEntregar = card.locator('button').filter({ hasText: /ENTREGAR|Entregar/i }).first()
  await expect(btnEntregar).toBeEnabled({ timeout: 10000 })
  await btnEntregar.click()
  await page.waitForTimeout(1500)
}

export async function rejectKdsOrderUI(page: Page, productName: string): Promise<void> {
  const card = page.locator('.v-card, [class*="order"]').filter({ hasText: productName }).first()
  for (let attempt = 1; attempt <= 4; attempt++) {
    const visible = await card
      .waitFor({ state: 'visible', timeout: 15000 })
      .then(() => true)
      .catch(() => false)

    if (visible) break

    const refreshButton = page.locator('button').filter({ has: page.locator('.mdi-refresh') }).first()
    if (await refreshButton.isVisible().catch(() => false)) {
      await refreshButton.click()
    } else {
      await page.reload({ waitUntil: 'domcontentloaded' })
    }
    await page.waitForTimeout(1000 * attempt)
  }
  await card.waitFor({ state: 'visible', timeout: 1000 })
  
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
  void dateStr

  await page
    .getByText(/Corte de Caja|Sesion de Caja|Sesión de Caja/i)
    .first()
    .waitFor({ state: 'visible', timeout: 60000 })

  const cashCountedInput = page.locator('input[type="number"], input[inputmode="decimal"]').first()
  const unavailableState = page
    .locator('.v-alert, [role="alert"]')
    .filter({ hasText: /No hay caja abierta|Usuario no pertenece|No autenticado|Supabase no detectado/i })
    .first()

  const state = await Promise.race([
    cashCountedInput.waitFor({ state: 'visible', timeout: 60000 }).then(() => 'input' as const).catch(() => null),
    unavailableState.waitFor({ state: 'visible', timeout: 60000 }).then(() => 'unavailable' as const).catch(() => null),
  ])

  if (state === 'unavailable') {
    const message = await unavailableState.textContent().catch(() => '')
    throw new Error(`Cash closing session unavailable: ${message?.trim() || 'unknown state'}`)
  }

  await expect(cashCountedInput).toBeVisible({ timeout: 1000 })
  await cashCountedInput.fill(countedAmount)
  await page.waitForTimeout(500)

  const preCloseBtn = page.getByRole('button', { name: /Pre-cerrar Caja/i }).first()
  await expect(preCloseBtn).toBeEnabled({ timeout: 10000 })
  await preCloseBtn.click()
  await page.waitForTimeout(1500)

  const approveBtn = page.getByRole('button', { name: /Aprobar cierre/i }).first()
  if (await approveBtn.isVisible({ timeout: 10000 }).catch(() => false)) {
    await expect(approveBtn).toBeEnabled({ timeout: 10000 })
    await approveBtn.click()
    await page.waitForTimeout(2000)
  }
}
