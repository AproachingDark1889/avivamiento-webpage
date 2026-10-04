import { expect } from '@playwright/test';
import { LOCAL, localUrl } from './local-environment.mjs';

export async function restrictBrowserToLocal(context, observations) {
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    try { localUrl(url.href); }
    catch { observations.blocked.push({ origin: url.origin, kind: 'http' }); await route.abort('blockedbyclient'); return; }
    observations.allowedOrigins.add(url.origin);
    await route.continue();
  });
  await context.routeWebSocket('**/*', route => {
    const url = new URL(route.url());
    if (url.hostname !== '127.0.0.1' || !['3002', '54321'].includes(url.port)) {
      observations.blocked.push({ origin: url.origin, kind: 'websocket' }); route.close({ code: 1008 }); return;
    }
    observations.allowedOrigins.add(url.origin); route.connectToServer();
  });
}

export async function signupOrganization(page, identity, onUserCreated) {
  await page.goto(`${LOCAL.app}/signup`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.locator('input[autocomplete="name"]').fill(identity.name, { timeout: 30000 });
  await page.locator('input[autocomplete="email"]').fill(identity.email);
  await page.locator('input[autocomplete="new-password"]').fill(identity.password);
  await page.getByPlaceholder(/Iglesia Nueva Vida/i).fill(identity.church);
  const userResponse = page.waitForResponse(r => new URL(r.url()).pathname === '/auth/v1/signup' && r.request().method() === 'POST', { timeout: 30000 });
  const tenantResponse = page.waitForResponse(r => new URL(r.url()).pathname === '/rest/v1/rpc/setup_new_tenant' && r.request().method() === 'POST', { timeout: 30000 });
  // Attach rejection handlers immediately so a failed signup cannot leak a pending promise.
  userResponse.catch(() => {}); tenantResponse.catch(() => {});
  await page.getByRole('button', { name: /CREAR CUENTA GRATIS/i }).click();
  const user = await userResponse;
  expect(user.ok(), 'local signup HTTP status').toBe(true);
  const userData = await user.json();
  const userId = userData.user?.id || userData.id;
  expect(userId).toBeTruthy();
  await onUserCreated(userId);
  const tenant = await tenantResponse;
  expect(tenant.ok(), 'local tenant RPC HTTP status').toBe(true);
  const body = await tenant.json();
  expect(body.success).toBe(true); expect(body.org_id).toBeTruthy();
  await expect(page.getByText('Configuración Inicial', { exact: true })).toBeVisible({ timeout: 30000 });
  return { userId, orgId: body.org_id, signupStatus: user.status(), rpcStatus: tenant.status() };
}

export async function completeInitialConfiguration(page, product) {
  await page.getByRole('button', { name: 'Siguiente', exact: true }).click();
  await page.getByPlaceholder('Café Americano', { exact: true }).fill(product.name);
  await page.getByPlaceholder('25.00', { exact: true }).fill(String(product.price));
  await page.getByRole('button', { name: 'Siguiente', exact: true }).click();
  await page.getByRole('button', { name: 'Saltar', exact: true }).click();
  await page.waitForURL(url => url.pathname.includes('/page/POS'), { timeout: 30000 });
}

export async function localRpc(page, name, expected, action) {
  if (!/^[a-z_]+$/.test(name)) throw new Error('RPC_NAME');
  const pattern = `**/rest/v1/rpc/${name}`;
  let forwarded = 0, rejected = false;
  const handler = async route => {
    const request = route.request(), url = new URL(request.url());
    const body = request.postDataJSON();
    if (url.origin !== LOCAL.api || request.method() !== 'POST'
      || !Object.entries(expected).every(([key, value]) => body?.[key] === value)) {
      rejected = true; await route.abort('blockedbyclient'); return;
    }
    forwarded++; await route.fallback(); // Preserve the context-level local network guard.
  };
  await page.route(pattern, handler);
  const waiting = page.waitForResponse(r => r.url() === `${LOCAL.api}/rest/v1/rpc/${name}` && r.request().method() === 'POST', { timeout: 20000 });
  waiting.catch(() => {});
  try {
    const [response] = await Promise.all([waiting, action()]);
    expect(rejected, `RPC ${name} target`).toBe(false); expect(forwarded).toBe(1);
    expect(response.ok(), `RPC ${name} HTTP ${response.status()}`).toBe(true);
    return await response.json();
  } finally { await page.unroute(pattern, handler); }
}

export async function loginActor(actor) {
  const page = actor.page;
  await page.goto(`${LOCAL.app}/login`, { waitUntil: 'domcontentloaded' });
  await page.locator('input[autocomplete="email"]').fill(actor.email);
  await page.locator('input[type="password"]').fill(actor.password);
  const waiting = page.waitForResponse(r => new URL(r.url()).origin === LOCAL.api && new URL(r.url()).pathname === '/auth/v1/token' && r.request().method() === 'POST');
  waiting.catch(() => {});
  const [response] = await Promise.all([waiting, page.getByRole('button', { name: /Acceder/i }).click()]);
  expect(response.ok(), 'login HTTP').toBe(true);
  const body = await response.json();
  expect(body.user?.id).toBe(actor.userId); // Do not return, print or persist the token.
  await page.waitForURL(url => !url.pathname.includes('/login'), { timeout: 30000 });
}

export async function fillStaffForm(page, actor) {
  await page.goto(`${LOCAL.app}/page/POS/users`, { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Nombre completo', { exact: true }).fill(actor.name);
  await page.getByLabel('Email', { exact: true }).fill(actor.email);
  await page.getByLabel('Contraseña (opcional)', { exact: true }).fill(actor.password);
  await expect(page.getByRole('button', { name: 'Crear Usuario', exact: true })).toBeVisible();
}

export async function submitStaff(page, actor, remember) {
  const titles = { leader: 'Líder de Departamento', cashier: 'Cajero', kitchen: 'Cocina' };
  const select = page.locator('.v-select').first();
  if (!(await select.textContent()).includes(titles[actor.role])) {
    await select.click();
    await page.getByRole('option', { name: titles[actor.role], exact: true }).click();
  }
  await expect(select).toContainText(titles[actor.role]);
  const signup = page.waitForResponse(r => r.url() === `${LOCAL.api}/auth/v1/signup` && r.request().method() === 'POST');
  signup.catch(() => {});
  const provision = page.waitForResponse(r => r.url() === `${LOCAL.api}/rest/v1/rpc/provision_user_profile` && r.request().method() === 'POST');
  provision.catch(() => {});
  await page.getByRole('button', { name: 'Crear Usuario', exact: true }).click();
  const response = await signup;
  expect(response.ok(), 'staff signup HTTP').toBe(true);
  const body = await response.json();
  actor.userId = body.user?.id || body.id; expect(actor.userId).toBeTruthy();
  remember(actor);
  const assigned = await provision; expect(assigned.ok(), 'staff provisioning HTTP').toBe(true);
  expect(assigned.request().postDataJSON()?.target_user_id).toBe(actor.userId);
  await expect(page.locator('tr').filter({ hasText: actor.email })).toHaveCount(1);
}

export async function enableStaffSetting(page, actor, setting) {
  const independent = setting === 'independent';
  if (!independent && setting !== 'auto') throw new Error('UNKNOWN_STAFF_SETTING');
  await page.goto(`${LOCAL.app}/page/POS/users`, { waitUntil: 'domcontentloaded' });
  const row = page.locator('tr').filter({ hasText: actor.email });
  await expect(row).toHaveCount(1);
  const menu = row.locator('button').filter({ has: page.locator('.mdi-dots-vertical') });
  await menu.click();
  const label = independent ? 'Caja independiente' : 'Auto-completar';
  const item = page.locator('.v-overlay-container .v-list-item:visible').filter({ hasText: `${label}: OFF` });
  await expect(item).toHaveCount(1);
  await localRpc(page, independent ? 'set_staff_independent_cash_safely' : 'set_staff_auto_accept_safely',
    { p_target_user_id: actor.userId, p_enabled: true }, () => item.click());
  await menu.click();
  await expect(page.locator('.v-overlay-container .v-list-item:visible').filter({ hasText: `${label}: ON` })).toHaveCount(1);
  await page.keyboard.press('Escape');
}

export async function productForm(page, product) {
  await page.goto(`${LOCAL.app}/page/POS/products`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Nuevo Producto', exact: true }).click();
  const dialog = page.locator('.v-dialog:visible');
  await expect(dialog).toHaveCount(1);
  await dialog.getByLabel('Nombre del Producto', { exact: true }).fill(product.name);
  await dialog.getByLabel('Precio', { exact: true }).fill(String(product.price));
  await expect(dialog.getByLabel('Precio', { exact: true })).toHaveValue(String(product.price));
}

export async function saveProduct(page, product) {
  const waiting = page.waitForResponse(r => new URL(r.url()).origin === LOCAL.api && new URL(r.url()).pathname === '/rest/v1/products' && r.request().method() === 'POST');
  waiting.catch(() => {});
  const [response] = await Promise.all([waiting, page.locator('.v-dialog:visible').getByRole('button', { name: 'Guardar', exact: true }).click()]);
  expect(response.ok(), 'product insert HTTP').toBe(true);
  await expect(page.locator('.v-dialog:visible')).toHaveCount(0);
  await expect(page.getByText(product.name, { exact: true })).toBeVisible();
}

export async function openingForm(page) {
  await page.goto(`${LOCAL.app}/page/POS/pointOfSales`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Abrir Caja', exact: true }).click();
  const dialog = page.locator('.v-dialog:visible').filter({ hasText: 'Apertura de Caja' });
  await expect(dialog).toHaveCount(1, { timeout: 30000 });
  await expect(dialog.locator('input[type="number"]')).toBeVisible();
}

export async function openSession(page, opening, mode) {
  const dialog = page.locator('.v-dialog:visible').filter({ hasText: 'Apertura de Caja' });
  await dialog.locator('input[type="number"]').fill(String(opening));
  const data = await localRpc(page, 'open_cash_session', { p_opening_cash: opening, p_mode: mode },
    () => dialog.getByRole('button', { name: 'Abrir Caja', exact: true }).click());
  expect(data?.session?.id).toBeTruthy();
  await expect(page.getByText(/Caja abierta/i).first()).toBeVisible();
  return data.session.id;
}

export async function addToCart(page, product) {
  const card = page.locator('.product-card').filter({ hasText: product.name });
  await expect(card).toHaveCount(1);
  await card.getByRole('button', { name: 'AGREGAR', exact: true }).click();
  await expect(page.getByRole('button', { name: /COBRAR/i }).filter({ visible: true })).toBeEnabled();
}

export async function payCash(page, received, mode) {
  await page.getByRole('button', { name: /COBRAR/i }).filter({ visible: true }).click();
  const dialog = page.locator('.v-dialog:visible').filter({ hasText: 'Confirmar Pago' });
  await dialog.getByRole('button', { name: /Efectivo/i }).click();
  await dialog.locator('input[type="number"]').fill(String(received));
  const data = await localRpc(page, 'process_checkout', { p_payment_method: 'cash', p_paid_with: received, p_mode: mode },
    () => dialog.getByRole('button', { name: /FINALIZAR|Confirmar|Pagar/i }).click());
  expect(data?.success).toBe(true); expect(data?.order_id).toBeTruthy();
  await expect(dialog).toBeHidden();
  return String(data.order_id);
}

export async function closingPage(page) {
  await page.goto(`${LOCAL.app}/page/POS/cashClosing`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Sesion de Caja', { exact: true })).toBeVisible();
}

export async function approveSession(page, id) {
  const button = page.getByRole('button', { name: 'Aprobar cierre', exact: true });
  // Fail closed on an ambiguous card; the RPC guard also pins the exact UUID.
  await expect(button).toHaveCount(1);
  await localRpc(page, 'approve_cash_session', { p_session_id: id }, () => button.click());
  await expect(button).toHaveCount(0);
}

export async function showContingency(page) {
  await closingPage(page);
  const button = page.getByRole('button', { name: 'Pre-cerrar (Contingencia)', exact: true });
  await expect(button).toHaveCount(1);
  await button.click();
  const dialog = page.locator('.v-dialog:visible').filter({ hasText: 'Pre-cierre de Contingencia' });
  await expect(dialog).toHaveCount(1); return dialog;
}
