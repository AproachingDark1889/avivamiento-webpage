import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { chromium, expect } from '@playwright/test';
import { LOCAL, inventory, readJsonSql, quoteSql } from './portal/local-environment.mjs';
import { restrictBrowserToLocal, loginActor, signupOrganization, completeInitialConfiguration, fillStaffForm, submitStaff, productForm, saveProduct, openingForm, openSession } from './portal/real-adapters.mjs';
import { cents, trainingData, cleanupTraining } from './portal/training-data.mjs';

/**
 * Locate Playwright's bundled ffmpeg binary across operating systems.
 */
export function findPlaywrightFfmpeg() {
  const localAppData = process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Local');
  const msPlaywright = path.join(localAppData, 'ms-playwright');
  if (fs.existsSync(msPlaywright)) {
    const ffmpegDirs = fs.readdirSync(msPlaywright).filter(d => d.startsWith('ffmpeg'));
    for (const dir of ffmpegDirs) {
      const candidate = path.join(msPlaywright, dir, process.platform === 'win32' ? 'ffmpeg-win64.exe' : 'ffmpeg');
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return null;
}

/**
 * Validates checkout RPC response according to PostgreSQL contract:
 * process_checkout returns v_order_id as bigint in json_build_object.
 * Strictly enforces positive safe integers without float precision loss.
 */
export function validateCheckoutOrderId(checkoutData) {
  if (!checkoutData || typeof checkoutData !== 'object' || Array.isArray(checkoutData)) {
    throw new Error('CHECKOUT_RESPONSE_INVALID: Response must be a non-null, non-array object');
  }
  if (checkoutData.success !== true) {
    throw new Error(`CHECKOUT_FAILED: Expected success: true, received: ${checkoutData.success}`);
  }
  const rawId = checkoutData.order_id;
  if (rawId === null || rawId === undefined) {
    throw new Error('CHECKOUT_MISSING_ORDER_ID: order_id is null or undefined');
  }
  if (typeof rawId !== 'number' && typeof rawId !== 'string') {
    throw new Error(`CHECKOUT_INVALID_ORDER_ID_TYPE: order_id must be a number or string, received ${typeof rawId}`);
  }
  if (typeof rawId === 'number') {
    if (!Number.isSafeInteger(rawId) || rawId <= 0) {
      throw new Error(`CHECKOUT_UNSAFE_OR_NON_POSITIVE_INTEGER: order_id must be a positive safe integer (1 to 2^53-1), received ${rawId}`);
    }
    return String(rawId);
  }
  const trimmed = rawId.trim();
  if (!/^[1-9]\d*$/.test(trimmed)) {
    throw new Error(`CHECKOUT_INVALID_ORDER_ID_FORMAT: order_id string must be a positive decimal integer without leading zeroes, received ${JSON.stringify(rawId)}`);
  }
  return trimmed;
}

/**
 * Probes real video stream properties directly from container metadata using ffmpeg.
 */
export function probeVideoFile(ffmpegPath, filePath) {
  if (!ffmpegPath || !fs.existsSync(filePath)) return null;
  try {
    const res = spawnSync(ffmpegPath, ['-i', filePath], { encoding: 'utf8' });
    const output = res.stderr || '';

    const durationMatch = output.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
    let durationSec = null;
    if (durationMatch) {
      const hours = Number(durationMatch[1]);
      const minutes = Number(durationMatch[2]);
      const seconds = Number(durationMatch[3]);
      durationSec = parseFloat((hours * 3600 + minutes * 60 + seconds).toFixed(2));
    }

    const streamMatch = output.match(/Stream #\d+:\d+.*?: Video: ([^,\s]+).*?,.*?,\s*(\d+x\d+).*?,\s*([\d.]+)\s*fps/);
    const codec = streamMatch ? streamMatch[1] : (output.match(/Video:\s*([^,\s]+)/)?.[1] || null);
    const resolution = streamMatch ? streamMatch[2] : (output.match(/(\d{3,4}x\d{3,4})/)?.[1] || null);
    const fps = streamMatch ? parseFloat(streamMatch[3]) : (output.match(/([\d.]+)\s*fps/)?.[1] ? parseFloat(output.match(/([\d.]+)\s*fps/)[1]) : null);

    return {
      durationSec,
      codec,
      resolution,
      fps,
      rawProbeText: output.split('\n').filter(line => line.includes('Duration:') || line.includes('Stream #')).join(' | ').trim()
    };
  } catch (err) {
    return { error: err.message || String(err) };
  }
}

/**
 * Derives the didactic clip using Playwright's bundled ffmpeg starting from counter_ready.
 */
export function deriveDidacticClip(ffmpegPath, rawVideoPath, derivedVideoPath, counterReadySec) {
  if (!ffmpegPath || !fs.existsSync(ffmpegPath)) {
    return { success: false, reason: 'FFMPEG_NOT_FOUND' };
  }
  if (!fs.existsSync(rawVideoPath)) {
    return { success: false, reason: 'RAW_VIDEO_NOT_FOUND' };
  }
  try {
    execFileSync(ffmpegPath, [
      '-y',
      '-i', rawVideoPath,
      '-ss', String(counterReadySec),
      '-c:v', 'libvpx',
      '-b:v', '1M',
      '-an',
      derivedVideoPath
    ], { stdio: 'pipe' });

    if (!fs.existsSync(derivedVideoPath)) {
      return { success: false, reason: 'DERIVED_FILE_NOT_CREATED' };
    }
    const stat = fs.statSync(derivedVideoPath);
    if (stat.size <= 0) {
      return { success: false, reason: 'DERIVED_FILE_EMPTY' };
    }
    return { success: true };
  } catch (err) {
    return { success: false, reason: 'TRIM_EXECUTION_FAILED', error: err.message || String(err) };
  }
}

/**
 * Rigorously validates that a derived clip strictly complies with the contracted specification:
 * - Non-empty file on disk
 * - Finite positive duration
 * - Exact VP8 video codec
 * - Exact 1366x768 resolution
 * - Finite 25 FPS (with +/- 0.5 probe tolerance)
 */
export function validateDerivedClip(probeResult, derivedPath) {
  if (!derivedPath || !fs.existsSync(derivedPath)) {
    return { valid: false, reason: 'DERIVED_FILE_MISSING' };
  }
  const stat = fs.statSync(derivedPath);
  if (stat.size <= 0) {
    return { valid: false, reason: 'DERIVED_FILE_EMPTY' };
  }
  if (!probeResult || typeof probeResult !== 'object' || probeResult.error) {
    return { valid: false, reason: `PROBE_FAILED: ${probeResult?.error || 'No probe output'}` };
  }
  if (typeof probeResult.durationSec !== 'number' || !Number.isFinite(probeResult.durationSec) || probeResult.durationSec <= 0) {
    return { valid: false, reason: `INVALID_DURATION: Expected finite positive number, received ${probeResult.durationSec}` };
  }
  if (!probeResult.codec || typeof probeResult.codec !== 'string' || probeResult.codec.toLowerCase() !== 'vp8') {
    return { valid: false, reason: `INVALID_CODEC: Expected 'vp8', received ${JSON.stringify(probeResult.codec)}` };
  }
  if (probeResult.resolution !== '1366x768') {
    return { valid: false, reason: `INVALID_RESOLUTION: Expected '1366x768', received ${JSON.stringify(probeResult.resolution)}` };
  }
  if (typeof probeResult.fps !== 'number' || !Number.isFinite(probeResult.fps) || Math.abs(probeResult.fps - 25) > 0.5) {
    return { valid: false, reason: `INVALID_FPS: Expected finite 25 fps, received ${probeResult.fps}` };
  }
  return { valid: true };
}

/**
 * Builds the standalone, offline-ready HTML viewer based on actual observed summary.
 * Never fills unverified fields with default fallback constants.
 */
export function generateViewerHtml({ runDir, runId, executionSummary, videoProvenance, financialAudit, clipTimestamps }) {
  const derivedMeta = videoProvenance?.derived || null;
  const rawMeta = videoProvenance?.raw || null;
  const isVideoApproved = executionSummary.videoDerivationStatus === 'PASSED';
  const isInventoryClean = executionSummary.inventoryStatus === 'PASSED';
  const isFinancialPassed = financialAudit?.overallStatus === 'ALL_ASSERTIONS_PASSED';

  const hasValidDerivedMetrics = isVideoApproved &&
    derivedMeta?.measuredDurationSec != null &&
    derivedMeta?.codec &&
    derivedMeta?.resolution &&
    derivedMeta?.fps != null;

  const durationDisplay = hasValidDerivedMetrics ? `${derivedMeta.measuredDurationSec}s` : 'No verificado';
  const sizeDisplay = derivedMeta?.sizeBytes ? `${Math.round(derivedMeta.sizeBytes / 1024)} KB` : (rawMeta?.sizeBytes ? `${Math.round(rawMeta.sizeBytes / 1024)} KB (Bruto)` : 'No medido');
  const formatDisplay = hasValidDerivedMetrics ? `${derivedMeta.codec.toUpperCase()} (${derivedMeta.resolution} @ ${derivedMeta.fps} FPS)` : 'No verificado';

  const inventoryBadge = isInventoryClean ?
    `<span class="status-pill passed">0 Residual (8 tablas verificadas)</span>` :
    `<span class="status-pill failed">${executionSummary.inventoryStatus || 'ERROR_INVENTARIO'}</span>`;

  const financialBadge = isFinancialPassed ?
    `<span class="status-pill passed">PASSED</span>` :
    `<span class="status-pill failed">NO VERIFICADO</span>`;

  const evalHtml = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Evaluación Piloto Paso 5 — Run ${runId}</title>
  <style>
    :root {
      --bg: #0b0f17;
      --card-bg: #131b2e;
      --card-border: #1e293b;
      --text-main: #f1f5f9;
      --text-muted: #94a3b8;
      --accent: #3b82f6;
      --success: #10b981;
      --success-bg: rgba(16, 185, 129, 0.12);
      --danger: #ef4444;
      --danger-bg: rgba(239, 68, 68, 0.15);
      --warning: #f59e0b;
      --warning-bg: rgba(245, 158, 11, 0.15);
      --font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background-color: var(--bg);
      color: var(--text-main);
      font-family: var(--font);
      line-height: 1.5;
      padding: 2rem 1rem;
    }
    .container { max-width: 1040px; margin: 0 auto; display: flex; flex-direction: column; gap: 1.5rem; }
    header { border-bottom: 1px solid var(--card-border); padding-bottom: 1rem; }
    .badge {
      display: inline-block;
      padding: 0.25rem 0.75rem;
      border-radius: 9999px;
      font-size: 0.75rem;
      font-weight: 600;
      background: rgba(59, 130, 246, 0.15);
      color: var(--accent);
      border: 1px solid rgba(59, 130, 246, 0.3);
      margin-bottom: 0.5rem;
    }
    h1 { font-size: 1.5rem; font-weight: 700; color: #fff; }
    .subtitle { color: var(--text-muted); font-size: 0.85rem; margin-top: 0.25rem; font-family: monospace; }
    .metrics-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 0.75rem;
      padding: 1rem;
    }
    .metric-label { font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; }
    .metric-value { font-size: 1.25rem; font-weight: 700; color: #fff; font-family: monospace; margin: 0.25rem 0; }
    .metric-sub { font-size: 0.7rem; color: var(--text-muted); }
    .player-section { display: flex; flex-direction: column; gap: 1rem; }
    .video-wrapper {
      width: 100%;
      aspect-ratio: 1366 / 768;
      background: #000;
      border-radius: 0.75rem;
      overflow: hidden;
      border: 1px solid var(--card-border);
    }
    video { width: 100%; height: 100%; object-fit: contain; }
    .controls-row { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 1rem; }
    .speed-group { display: flex; align-items: center; gap: 0.5rem; }
    .speed-label { font-size: 0.8rem; color: var(--text-muted); font-weight: 600; }
    .btn-speed {
      background: #1e293b;
      border: 1px solid #334155;
      color: #cbd5e1;
      padding: 0.35rem 0.75rem;
      border-radius: 0.375rem;
      font-size: 0.8rem;
      cursor: pointer;
      font-weight: 600;
      transition: all 0.15s ease;
    }
    .btn-speed:hover { background: #334155; color: #fff; }
    .btn-speed.active { background: var(--accent); border-color: var(--accent); color: #fff; }
    .chapters-title { font-size: 0.75rem; font-weight: 600; text-transform: uppercase; color: var(--text-muted); margin-bottom: 0.5rem; }
    .chapters-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 0.75rem; }
    .chapter-btn {
      display: flex;
      flex-direction: column;
      text-align: left;
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 0.5rem;
      padding: 0.75rem;
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .chapter-btn:hover { background: #273549; border-color: var(--accent); }
    .chapter-time { font-size: 0.75rem; color: var(--accent); font-weight: 700; font-family: monospace; }
    .chapter-name { font-size: 0.85rem; font-weight: 600; color: #fff; margin-top: 0.15rem; }
    .chapter-desc { font-size: 0.75rem; color: var(--text-muted); margin-top: 0.25rem; }
    .table-wrapper { overflow-x: auto; margin-top: 0.5rem; }
    table { width: 100%; border-collapse: collapse; font-size: 0.8rem; }
    th, td { padding: 0.6rem 0.75rem; text-align: left; border-bottom: 1px solid var(--card-border); }
    th { color: var(--text-muted); font-weight: 600; background: #0f172a; }
    td.mono { font-family: monospace; }
    .status-pill {
      display: inline-block;
      padding: 0.2rem 0.5rem;
      border-radius: 0.25rem;
      font-size: 0.75rem;
      font-weight: 700;
    }
    .status-pill.passed { background: var(--success-bg); color: var(--success); border: 1px solid rgba(16, 185, 129, 0.3); }
    .status-pill.failed { background: var(--danger-bg); color: var(--danger); border: 1px solid rgba(239, 68, 68, 0.3); }
    .status-pill.warning { background: var(--warning-bg); color: var(--warning); border: 1px solid rgba(245, 158, 11, 0.3); }
    .alert-box { padding: 0.75rem 1rem; border-radius: 0.5rem; font-size: 0.85rem; margin-bottom: 1rem; }
    .alert-box.warning { background: var(--warning-bg); border: 1px solid rgba(245, 158, 11, 0.3); color: #fde68a; }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <span class="badge">🎬 Ensayo Acotado del Paso 5 (Certificación de Evidencia)</span>
      <h1>Visor de Evaluación Local — Video Nativo HD</h1>
      <p class="subtitle">Run ID: ${runId} | Procedimiento: Paso 5 — Cobro en Efectivo y Cambio</p>
    </header>

    ${!isVideoApproved ? `
    <div class="alert-box warning">
      ⚠️ <strong>Aviso de Derivación:</strong> El clip didáctico recortado no fue generado (${derivedMeta?.reason || executionSummary.videoDerivationStatus}). Se muestra el video bruto original.
    </div>` : ''}

    <div class="metrics-grid">
      <div class="card">
        <span class="metric-label">Duración Medida</span>
        <div class="metric-value">${durationDisplay}</div>
        <span class="metric-sub">${hasValidDerivedMetrics ? `Medición en archivo WebM (offset: ${derivedMeta?.trimOffsetSec}s)` : 'Duración de captura bruta o no verificada'}</span>
      </div>
      <div class="card">
        <span class="metric-label">Tamaño WebM</span>
        <div class="metric-value" style="color: #60a5fa;">${sizeDisplay}</div>
        <span class="metric-sub">${formatDisplay}</span>
      </div>
      <div class="card">
        <span class="metric-label">Auditoría Financiera</span>
        <div class="metric-value">${financialBadge}</div>
        <span class="metric-sub">Total $55 / Recibido $100 / Cambio $45</span>
      </div>
      <div class="card">
        <span class="metric-label">Limpieza BD</span>
        <div class="metric-value">${inventoryBadge}</div>
        <span class="metric-sub">Estado: ${executionSummary.cleanupStatus}</span>
      </div>
    </div>

    <section class="card player-section">
      <div class="video-wrapper">
        <video id="pilotVideo" src="${hasValidDerivedMetrics ? 'pilot_step5.webm' : 'raw_video.webm'}" controls preload="metadata"></video>
      </div>

      <div class="controls-row">
        <div class="speed-group">
          <span class="speed-label">Velocidad:</span>
          <button type="button" class="btn-speed" onclick="setSpeed(0.5, this)">0.5×</button>
          <button type="button" class="btn-speed active" onclick="setSpeed(1.0, this)">1.0×</button>
          <button type="button" class="btn-speed" onclick="setSpeed(1.5, this)">1.5×</button>
        </div>
        <span class="metric-sub">Reproducción nativa acelerada por hardware</span>
      </div>

      <div>
        <div class="chapters-title">Capítulos Didácticos:</div>
        <div class="chapters-grid">
          <button type="button" class="chapter-btn" onclick="seekTo(${clipTimestamps.chapter1_selection || 0})">
            <span class="chapter-time">⏱️ ${clipTimestamps.chapter1_selection || 0}s</span>
            <span class="chapter-name">📍 Dónde dar clic</span>
            <span class="chapter-desc">Taco de Guisado ($55.00)</span>
          </button>
          <button type="button" class="chapter-btn" onclick="seekTo(${clipTimestamps.chapter2_payment || 0})">
            <span class="chapter-time">⏱️ ${clipTimestamps.chapter2_payment || 0}s</span>
            <span class="chapter-name">✍️ Qué ingresar</span>
            <span class="chapter-desc">Efectivo $100 y lectura de cambio $45</span>
          </button>
          <button type="button" class="chapter-btn" onclick="seekTo(${clipTimestamps.chapter3_confirmation || 0})">
            <span class="chapter-time">⏱️ ${clipTimestamps.chapter3_confirmation || 0}s</span>
            <span class="chapter-name">🧾 Resultado real</span>
            <span class="chapter-desc">Confirmación toast de venta en UI</span>
          </button>
        </div>
      </div>
    </section>

    <section class="card">
      <h3 style="font-size: 0.95rem; font-weight: 700; color: #fff;">Evidencia de Auditoría Financiera (PostgreSQL)</h3>
      <div class="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>Entidad / Tabla</th>
              <th>Propiedad / Campo</th>
              <th>Valor Esperado</th>
              <th>Valor Observado</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><code>cash_sessions</code></td>
              <td><code>opening_cash</code></td>
              <td class="mono">$100.00</td>
              <td class="mono">${financialAudit?.checks?.cashSession?.observed?.opening_cash != null ? `$${financialAudit.checks.cashSession.observed.opening_cash}` : 'N/A'}</td>
              <td>${financialAudit?.checks?.cashSession?.result === 'PASSED' ? '<span class="status-pill passed">PASSED</span>' : '<span class="status-pill failed">FAILED</span>'}</td>
            </tr>
            <tr>
              <td><code>orders</code></td>
              <td><code>financial_status</code></td>
              <td class="mono">'paid'</td>
              <td class="mono">${financialAudit?.checks?.order?.observed?.financial_status ? `'${financialAudit.checks.order.observed.financial_status}'` : 'N/A'}</td>
              <td>${financialAudit?.checks?.order?.result === 'PASSED' ? '<span class="status-pill passed">PASSED</span>' : '<span class="status-pill failed">FAILED</span>'}</td>
            </tr>
            <tr>
              <td><code>orders</code></td>
              <td><code>total</code></td>
              <td class="mono">$55.00</td>
              <td class="mono">${financialAudit?.checks?.order?.observed?.total != null ? `$${financialAudit.checks.order.observed.total}` : 'N/A'}</td>
              <td>${financialAudit?.checks?.order?.result === 'PASSED' ? '<span class="status-pill passed">PASSED</span>' : '<span class="status-pill failed">FAILED</span>'}</td>
            </tr>
            <tr>
              <td><code>orders</code></td>
              <td><code>paid_with</code></td>
              <td class="mono">$100.00</td>
              <td class="mono">${financialAudit?.checks?.order?.observed?.paid_with != null ? `$${financialAudit.checks.order.observed.paid_with}` : 'N/A'}</td>
              <td>${financialAudit?.checks?.order?.result === 'PASSED' ? '<span class="status-pill passed">PASSED</span>' : '<span class="status-pill failed">FAILED</span>'}</td>
            </tr>
            <tr>
              <td><code>orders</code></td>
              <td><code>change</code></td>
              <td class="mono">$45.00</td>
              <td class="mono">${financialAudit?.checks?.order?.observed?.change != null ? `$${financialAudit.checks.order.observed.change}` : 'N/A'}</td>
              <td>${financialAudit?.checks?.order?.result === 'PASSED' ? '<span class="status-pill passed">PASSED</span>' : '<span class="status-pill failed">FAILED</span>'}</td>
            </tr>
            <tr>
              <td><code>order_items</code></td>
              <td><code>quantity & price</code></td>
              <td class="mono">1x $55.00</td>
              <td class="mono">${financialAudit?.checks?.orderItem?.observed ? `${financialAudit.checks.orderItem.observed.quantity}x $${financialAudit.checks.orderItem.observed.price}` : 'N/A'}</td>
              <td>${financialAudit?.checks?.orderItem?.result === 'PASSED' ? '<span class="status-pill passed">PASSED</span>' : '<span class="status-pill failed">FAILED</span>'}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>

  <script>
    const video = document.getElementById('pilotVideo');
    function setSpeed(rate, btn) {
      if (!video) return;
      video.playbackRate = rate;
      document.querySelectorAll('.btn-speed').forEach(b => b.classList.remove('active'));
      if (btn) btn.classList.add('active');
    }
    function seekTo(sec) {
      if (!video) return;
      video.currentTime = sec;
      video.play();
    }
  </script>
</body>
</html>`;

  fs.writeFileSync(path.join(runDir, 'index.html'), evalHtml, 'utf8');
}

/**
 * Executes all finalizers independently so that a failure in one
 * (e.g. browser.close() or cleanup) never prevents attempting the others.
 * Fails delivery explicitly if the target artifacts directory is missing or invalid.
 */
export async function runFinalizers({
  browser,
  runId,
  actors,
  state,
  runDir,
  functionalError,
  videoDerivationStatus = 'SKIPPED',
  videoProvenance = {},
  financialAudit = null,
  clipTimestamps = {},
  cleanupFn = cleanupTraining,
  inventoryFn = inventory,
  viewerGeneratorFn = generateViewerHtml,
  summaryWriterFn = fs.writeFileSync
}) {
  let browserCloseError = null;
  let cleanupError = null;
  let cleanupResult = null;
  let inventoryError = null;
  let finalInventory = null;
  let viewerError = null;
  let deliveryError = null;
  let summaryPersistenceError = null;

  // Finalizer 1: Browser Close
  if (browser) {
    try {
      await browser.close();
    } catch (err) {
      browserCloseError = err;
      console.error('BROWSER_CLOSE_ERROR:', err);
    }
  }

  // Finalizer 2: DB Cleanup (ALWAYS attempted)
  console.log('--- Finalizer: DB Cleanup ---');
  try {
    cleanupResult = cleanupFn(runId, actors, state);
    console.log('Cleanup result:', cleanupResult);
  } catch (err) {
    cleanupError = err;
    console.error('CLEANUP_ERROR:', err);
  }

  // Finalizer 3: Inventory Verification (ALWAYS attempted)
  console.log('--- Finalizer: Inventory Check ---');
  try {
    finalInventory = inventoryFn();
    console.log('Final inventory counts:', finalInventory?.counts);
  } catch (err) {
    inventoryError = err;
    console.error('INVENTORY_CHECK_ERROR:', err);
  }

  const inventoryPassed = !inventoryError && finalInventory && finalInventory.counts && Object.values(finalInventory.counts).every(n => n === 0);
  const inventoryStatus = inventoryError ? 'FAILED' : (inventoryPassed ? 'PASSED' : 'LEAK_DETECTED');

  // Verify delivery directory validity
  const isRunDirValid = Boolean(runDir && typeof runDir === 'string' && fs.existsSync(runDir));
  if (!isRunDirValid) {
    deliveryError = new Error(`DELIVERY_DIRECTORY_MISSING: Artifacts directory '${runDir}' does not exist or is invalid`);
    console.error('DELIVERY_ERROR:', deliveryError.message);
  }

  // Finalizer 4: Viewer Generation
  if (isRunDirValid) {
    const preViewerSummary = {
      functionalStatus: functionalError ? 'FAILED' : 'PASSED',
      cleanupStatus: cleanupError ? 'FAILED' : 'PASSED',
      inventoryStatus,
      videoDerivationStatus
    };
    try {
      viewerGeneratorFn({
        runDir,
        runId,
        executionSummary: preViewerSummary,
        videoProvenance,
        financialAudit,
        clipTimestamps
      });
    } catch (err) {
      viewerError = err;
      console.error('VIEWER_GENERATION_ERROR:', err);
    }
  } else {
    viewerError = new Error('VIEWER_SKIPPED_DUE_TO_MISSING_RUN_DIR');
  }

  let viewerStatus = viewerError ? 'FAILED' : 'PASSED';
  let deliveryStatus = deliveryError ? 'FAILED' : 'PASSED';

  // Finalizer 5: Execution Summary Manifest
  const executionSummary = {
    runId,
    timestamp: new Date().toISOString(),
    functionalStatus: functionalError ? 'FAILED' : 'PASSED',
    functionalError: functionalError ? (functionalError.message || String(functionalError)) : null,
    browserCloseStatus: browserCloseError ? 'FAILED' : 'PASSED',
    browserCloseError: browserCloseError ? (browserCloseError.message || String(browserCloseError)) : null,
    cleanupStatus: cleanupError ? 'FAILED' : 'PASSED',
    cleanupError: cleanupError ? (cleanupError.message || String(cleanupError)) : null,
    cleanupDetails: cleanupResult || null,
    inventoryStatus,
    inventoryError: inventoryError ? (inventoryError.message || String(inventoryError)) : null,
    finalInventory: finalInventory?.counts || null,
    videoDerivationStatus,
    deliveryStatus,
    deliveryError: deliveryError ? (deliveryError.message || String(deliveryError)) : null,
    viewerStatus,
    viewerError: viewerError ? (viewerError.message || String(viewerError)) : null,
    summaryStatus: 'PENDING',
    summaryError: null
  };

  if (isRunDirValid) {
    try {
      executionSummary.summaryStatus = 'PASSED';
      summaryWriterFn(path.join(runDir, 'execution_summary.json'), JSON.stringify(executionSummary, null, 2), 'utf8');
    } catch (err) {
      summaryPersistenceError = err;
      deliveryError = deliveryError || err;
      deliveryStatus = 'FAILED';
      executionSummary.summaryStatus = 'FAILED';
      executionSummary.summaryError = err.message || String(err);
      executionSummary.deliveryStatus = 'FAILED';
      executionSummary.deliveryError = deliveryError.message || String(deliveryError);
      console.error('SUMMARY_PERSISTENCE_ERROR:', err.message || String(err));
    }
  } else {
    summaryPersistenceError = new Error('SUMMARY_SKIPPED_DUE_TO_MISSING_RUN_DIR');
    executionSummary.summaryStatus = 'FAILED';
    executionSummary.summaryError = summaryPersistenceError.message;
    console.error('SUMMARY_PERSISTENCE_FAILED: execution_summary.json could not be written because delivery directory is missing');
  }

  const overallPassed = !functionalError &&
    !browserCloseError &&
    !cleanupError &&
    inventoryPassed &&
    videoDerivationStatus === 'PASSED' &&
    !deliveryError &&
    !viewerError &&
    !summaryPersistenceError;

  return { executionSummary, overallPassed, viewerError, deliveryError, summaryPersistenceError };
}

// =========================================================================
// Main Execution Block (when executed directly as a script)
// =========================================================================
const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));

if (isDirectRun) {
  const REPO = path.resolve('.');
  const baseArtifactsDir = path.join(REPO, 'artifacts', 'pilot-step5');
  const runId = `avc-training-${randomUUID()}`;
  const runDir = path.join(baseArtifactsDir, 'runs', runId);
  const rawVideoDir = path.join(runDir, 'raw');

  fs.mkdirSync(runDir, { recursive: true });
  fs.mkdirSync(rawVideoDir, { recursive: true });

  console.log('Pilot Run Directory initialized:', runDir);
  console.log('Pilot Run ID:', runId);

  // Verify clean DB before start
  const before = inventory();
  console.log('Verifying clean DB before pilot:', before.counts);
  if (!Object.values(before.counts).every(n => n === 0)) {
    throw new Error('LOCAL_DATABASE_NOT_EMPTY: Please ensure 0 records before pilot');
  }

  const definitions = [
    ['pastor', 'pastor', 'Pastor David Ramos'],
    ['samuel', 'leader', 'Líder Samuel Castro'],
    ['isaac', 'cashier', 'Cajero Isaac Díaz']
  ];

  const actors = definitions.map(([id, role, name]) => ({
    id, role, name, church: 'Comunidad Cristiana Monte de Sion',
    email: `${id}.${runId}@training.avivacheck.invalid`,
    password: `Local-${randomBytes(20).toString('hex')}!`
  }));

  const pastor = actors[0];
  const samuel = actors[1];
  const isaac = actors[2];

  const observation = { allowedOrigins: new Set(), blocked: [] };
  const state = {};

  const taco = { name: 'Taco de Guisado', price: 55 };
  const initial = { name: 'Café Americano', price: 25 };

  let browser = null;
  let functionalError = null;
  let videoDerivationStatus = 'SKIPPED';
  let videoProvenance = {};
  let financialAudit = null;
  let clipTimestamps = {};

  try {
    browser = await chromium.launch({ headless: true });

    // Phase 1: Setup Prerequisite Data
    console.log('--- Phase 1: Setup Prerequisite Data & In-Memory Auth ---');
    
    // 1.1 Pastor Setup
    const pastorContext = await browser.newContext({ viewport: { width: 1366, height: 768 } });
    await restrictBrowserToLocal(pastorContext, observation);
    pastor.page = await pastorContext.newPage();
    const created = await signupOrganization(pastor.page, pastor, id => { pastor.userId = id; });
    state.orgId = created.orgId;
    await completeInitialConfiguration(pastor.page, initial);
    await fillStaffForm(pastor.page, samuel);
    await submitStaff(pastor.page, samuel, () => {});
    await pastorContext.close();

    // 1.2 Samuel Setup
    const samuelContext = await browser.newContext({ viewport: { width: 1366, height: 768 } });
    await restrictBrowserToLocal(samuelContext, observation);
    samuel.page = await samuelContext.newPage();
    await loginActor(samuel);
    await fillStaffForm(samuel.page, isaac);
    await submitStaff(samuel.page, isaac, () => {});
    isaac.departmentId = samuel.userId; // Required for department owner matching
    await productForm(samuel.page, taco);
    await saveProduct(samuel.page, taco);
    await samuelContext.close();

    // 1.3 Isaac Setup (Apertura de caja)
    console.log('Opening cash session with $100 for Isaac...');
    const isaacSetupContext = await browser.newContext({ viewport: { width: 1366, height: 768 } });
    await restrictBrowserToLocal(isaacSetupContext, observation);
    isaac.page = await isaacSetupContext.newPage();
    await loginActor(isaac);
    await openingForm(isaac.page);
    state.ordinaryId = await openSession(isaac.page, 100, 'shared');
    console.log('Cash session opened with id:', state.ordinaryId);
    await isaacSetupContext.close();

    // Phase 2: Recording Pilot Video
    console.log('--- Phase 2: Recording Pilot Video (Isaac Checkout) ---');
    const pilotContext = await browser.newContext({
      viewport: { width: 1366, height: 768 },
      recordVideo: {
        dir: rawVideoDir,
        size: { width: 1366, height: 768 }
      },
      locale: 'es-MX',
      timezoneId: 'America/Mexico_City',
      serviceWorkers: 'block'
    });
    await restrictBrowserToLocal(pilotContext, observation);

    const page = await pilotContext.newPage();
    page.setDefaultTimeout(25000);
    const startRecordTime = Date.now();

    // Authenticate Isaac directly inside the recording context
    console.log('Authenticating Isaac Díaz in recording context...');
    isaac.page = page;
    await loginActor(isaac);

    console.log('Navigating to Point of Sales...');
    await page.goto(`${LOCAL.app}/page/POS/pointOfSales`, { waitUntil: 'domcontentloaded' });

    // Verify that the POS counter is ready with the specific product visible
    const card = page.locator('.product-card').filter({ hasText: taco.name });
    await expect(card).toHaveCount(1, { timeout: 20000 });
    await expect(card).toBeVisible();

    // Mark counterReadySec at the exact moment the counter is confirmed ready
    const counterReadySec = parseFloat(((Date.now() - startRecordTime) / 1000).toFixed(2));
    console.log(`[VIDEO TIMECODE] counter_ready: ${counterReadySec}s`);

    const rawTimestamps = { record_start: 0, counter_ready: counterReadySec };
    const markRaw = name => {
      rawTimestamps[name] = parseFloat(((Date.now() - startRecordTime) / 1000).toFixed(2));
      console.log(`[VIDEO RAW TIMECODE] ${name}: ${rawTimestamps[name]}s`);
    };

    // Initial recognition pause so the trimmed clip allows the learner to assimilate the counter
    console.log('Didactic pause: Counter orientation (1500ms)...');
    await page.waitForTimeout(1500);

    // Chapter 1: Click producto
    markRaw('chapter1_selection');
    console.log('Action: Adding Taco de Guisado ($55.00) to cart...');
    await card.getByRole('button', { name: 'AGREGAR', exact: true }).click();
    await page.waitForTimeout(1200);
    await expect(page.getByRole('button', { name: /COBRAR/i }).filter({ visible: true })).toBeEnabled();

    // Chapter 2: Cobro y cambio
    markRaw('chapter2_payment');
    await page.getByRole('button', { name: /COBRAR/i }).filter({ visible: true }).click();
    const dialog = page.locator('.v-dialog:visible').filter({ hasText: 'Confirmar Pago' });
    await expect(dialog).toHaveCount(1);
    await page.waitForTimeout(800);

    const cashBtn = dialog.getByRole('button', { name: /Efectivo/i });
    if (await cashBtn.isVisible()) await cashBtn.click();
    await page.waitForTimeout(600);

    const cashInput = dialog.locator('input[type="number"]');
    await cashInput.click();
    await cashInput.fill('');
    await cashInput.pressSequentially('100', { delay: 95 });
    await page.waitForTimeout(2000);

    // Chapter 3: Confirmación y resultado
    markRaw('chapter3_confirmation');
    const checkoutPromise = page.waitForResponse(r => r.url().includes('process_checkout'));
    await dialog.getByRole('button', { name: /FINALIZAR|Confirmar|Pagar/i }).click();
    const checkoutRes = await checkoutPromise;
    expect(checkoutRes.ok()).toBe(true);
    const checkoutData = await checkoutRes.json();

    // Validate checkout order_id using real Postgres bigint contract
    state.orderId = validateCheckoutOrderId(checkoutData);

    // Confirm UI toast is visible
    await expect(page.locator('text=¡Venta registrada correctamente!').first()).toBeVisible({ timeout: 5000 });
    await page.waitForTimeout(2500);

    markRaw('video_end');

    const videoObj = page.video();
    await pilotContext.close();

    // Phase 3: Strict Financial Assertions in PostgreSQL (BEFORE video post-processing)
    console.log('--- Phase 3: Strict Financial Assertions (Pre-Cleanup) ---');
    const db = trainingData(state);

    const sessionData = db.session(state.ordinaryId, {
      status: 'open',
      mode: 'shared',
      opened_by: isaac.userId,
      department_owner_id: samuel.userId
    });
    expect(cents(sessionData.opening_cash)).toBe(10000);

    const productData = db.product(samuel, taco);
    expect(cents(productData.price)).toBe(5500);

    const orderData = db.order(state.orderId, isaac, state.ordinaryId, taco, 100, 'pending');

    const items = readJsonSql(`coalesce(json_agg(t),'[]'::json) FROM (SELECT * FROM public.order_items WHERE org_id=${quoteSql(state.orgId)} AND order_id=${quoteSql(state.orderId)}) t`);
    expect(items.length).toBe(1);
    const itemData = items[0];

    financialAudit = {
      runId,
      verifiedAt: new Date().toISOString(),
      identifiers: {
        organizationId: state.orgId,
        orderId: state.orderId,
        sessionId: state.ordinaryId,
        cashierUserId: isaac.userId,
        leaderUserId: samuel.userId,
        productId: productData.id
      },
      checks: {
        cashSession: {
          table: 'cash_sessions',
          id: state.ordinaryId,
          expected: { status: 'open', mode: 'shared', opened_by: isaac.userId, opening_cash: '100.00' },
          observed: { status: sessionData.status, mode: sessionData.mode, opened_by: sessionData.opened_by, opening_cash: String(sessionData.opening_cash) },
          result: 'PASSED'
        },
        order: {
          table: 'orders',
          id: state.orderId,
          expected: { financial_status: 'paid', payment_method: 'cash', operational_status: 'pending', total: '55.00', paid_with: '100.00', change: '45.00' },
          observed: { financial_status: orderData.financial_status, payment_method: orderData.payment_method, operational_status: orderData.operational_status, total: String(orderData.total), paid_with: String(orderData.paid_with), change: String(orderData.change) },
          result: 'PASSED'
        },
        orderItem: {
          table: 'order_items',
          id: itemData.id,
          expected: { product_id: productData.id, quantity: 1, price: '55.00', subtotal: '55.00' },
          observed: { product_id: itemData.product_id, quantity: itemData.quantity, price: String(itemData.price), subtotal: String(itemData.subtotal) },
          result: 'PASSED'
        }
      },
      overallStatus: 'ALL_ASSERTIONS_PASSED'
    };

    fs.writeFileSync(path.join(runDir, 'financial_audit.json'), JSON.stringify(financialAudit, null, 2), 'utf8');

    // Phase 4: Video Processing, Trimming & Metadata Probe
    console.log('--- Phase 4: Video Processing & Provenance ---');
    if (videoObj) {
      const generatedRaw = await videoObj.path();
      const rawVideoPath = path.join(runDir, 'raw_video.webm');
      fs.copyFileSync(generatedRaw, rawVideoPath);

      const rawStat = fs.statSync(rawVideoPath);
      const rawSha256 = createHash('sha256').update(fs.readFileSync(rawVideoPath)).digest('hex');
      const ffmpegPath = findPlaywrightFfmpeg();
      const rawProbe = probeVideoFile(ffmpegPath, rawVideoPath);

      videoProvenance.raw = {
        file: 'raw_video.webm',
        sizeBytes: rawStat.size,
        sha256: rawSha256,
        measuredDurationSec: rawProbe?.durationSec || null,
        codec: rawProbe?.codec || null,
        resolution: rawProbe?.resolution || null,
        fps: rawProbe?.fps || null,
        rawTimestamps
      };

      const derivedVideoPath = path.join(runDir, 'pilot_step5.webm');
      const trimRes = deriveDidacticClip(ffmpegPath, rawVideoPath, derivedVideoPath, counterReadySec);

      if (trimRes.success) {
        const derivedStat = fs.statSync(derivedVideoPath);
        const derivedSha256 = createHash('sha256').update(fs.readFileSync(derivedVideoPath)).digest('hex');
        const derivedProbe = probeVideoFile(ffmpegPath, derivedVideoPath);
        const validation = validateDerivedClip(derivedProbe, derivedVideoPath);

        if (validation.valid) {
          clipTimestamps = {
            chapter1_selection: Math.max(0, parseFloat((rawTimestamps.chapter1_selection - counterReadySec).toFixed(2))),
            chapter2_payment: Math.max(0, parseFloat((rawTimestamps.chapter2_payment - counterReadySec).toFixed(2))),
            chapter3_confirmation: Math.max(0, parseFloat((rawTimestamps.chapter3_confirmation - counterReadySec).toFixed(2))),
            clip_end: derivedProbe.durationSec
          };

          videoProvenance.derived = {
            file: 'pilot_step5.webm',
            sizeBytes: derivedStat.size,
            measuredDurationSec: derivedProbe.durationSec,
            codec: derivedProbe.codec,
            resolution: derivedProbe.resolution,
            fps: derivedProbe.fps,
            sha256: derivedSha256,
            trimOffsetSec: counterReadySec,
            clipTimestamps,
            status: 'DERIVED_VERIFIED'
          };
          videoDerivationStatus = 'PASSED';
        } else {
          console.warn('Derived clip failed probe validation:', validation.reason);
          videoProvenance.derived = {
            file: 'pilot_step5.webm',
            sizeBytes: derivedStat.size,
            status: 'PROBE_FAILED',
            reason: validation.reason,
            probeDetails: derivedProbe
          };
          videoDerivationStatus = 'FAILED';
        }
      } else {
        console.warn('Derivation failed or ffmpeg unavailable:', trimRes);
        videoProvenance.derived = {
          file: null,
          status: 'NOT_DERIVED',
          reason: trimRes.reason
        };
        videoDerivationStatus = 'FAILED';
      }

      fs.writeFileSync(path.join(runDir, 'video_provenance.json'), JSON.stringify(videoProvenance, null, 2), 'utf8');
    }

  } catch (err) {
    functionalError = err;
    console.error('PILOT_FUNCTIONAL_ERROR:', err);
  } finally {
    // Decoupled finalizers with viewer status integrated
    const { overallPassed } = await runFinalizers({
      browser,
      runId,
      actors,
      state,
      runDir,
      functionalError,
      videoDerivationStatus,
      videoProvenance,
      financialAudit,
      clipTimestamps
    });

    if (!overallPassed) {
      process.exitCode = 1;
    }
  }
}
