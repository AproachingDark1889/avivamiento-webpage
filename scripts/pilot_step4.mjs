import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { chromium, expect } from '@playwright/test';
import { LOCAL, inventory, readJsonSql, quoteSql } from './portal/local-environment.mjs';
import { restrictBrowserToLocal } from './portal/real-adapters.mjs';
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
 * Builds the standalone, offline-ready HTML viewer for Module 4.
 */
export function generateViewerHtml({ runDir, runId, executionSummary, videoProvenance, governanceAudit, clipTimestamps }) {
  const derivedMeta = videoProvenance?.derived || null;
  const rawMeta = videoProvenance?.raw || null;
  const isVideoApproved = executionSummary.videoDerivationStatus === 'PASSED';
  const isInventoryClean = executionSummary.inventoryStatus === 'PASSED';
  const isGovernancePassed = governanceAudit?.overallStatus === 'ALL_ASSERTIONS_PASSED';

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

  const governanceBadge = isGovernancePassed ?
    `<span class="status-pill passed">PASSED</span>` :
    `<span class="status-pill failed">NO VERIFICADO</span>`;

  const evalHtml = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Evaluación Piloto Paso 4 — Run ${runId}</title>
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
    .alert-box.info { background: rgba(59, 130, 246, 0.12); border: 1px solid rgba(59, 130, 246, 0.3); color: #93c5fd; }
    .alert-box.warning { background: var(--warning-bg); border: 1px solid rgba(245, 158, 11, 0.3); color: #fde68a; }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <span class="badge">🎬 Módulo 4 (Apertura de Turno y Caja Compartida)</span>
      <h1>Visor de Evaluación Local — Video Nativo HD</h1>
      <p class="subtitle">Run ID: ${runId} | Procedimiento: Módulo 4 — Apertura de Caja General por Cajero Isaac Díaz</p>
    </header>

    <div class="alert-box info">
      ℹ️ <strong>Puente Didáctico:</strong> Isaac Díaz abre la <strong>Caja General/Compartida</strong> de Cafetería (estándar grupal del equipo). La modalidad de <strong>Caja Independiente</strong> (gaveta personal por cajero) y el protocolo de rescate por contingencia se certificarán a detalle en el <strong>Módulo 9</strong>.
    </div>

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
        <span class="metric-label">Gobernanza DB</span>
        <div class="metric-value">${governanceBadge}</div>
        <span class="metric-sub">Caja Compartida $100.00 / Cafetería</span>
      </div>
      <div class="card">
        <span class="metric-label">Limpieza BD</span>
        <div class="metric-value">${inventoryBadge}</div>
        <span class="metric-sub">Estado: ${executionSummary.cleanupStatus}</span>
      </div>
    </div>

    <section class="card player-section">
      <div class="video-wrapper">
        <video id="pilotVideo" src="${hasValidDerivedMetrics ? 'pilot_step4.webm' : 'raw_video.webm'}" controls preload="metadata"></video>
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
          <button type="button" class="chapter-btn" onclick="seekTo(${clipTimestamps.chapter1_cashier_login || 0})">
            <span class="chapter-time">⏱️ ${clipTimestamps.chapter1_cashier_login || 0}s</span>
            <span class="chapter-name">🔐 Inicio de Sesión de Cajero</span>
            <span class="chapter-desc">Isaac Díaz (Cafetería)</span>
          </button>
          <button type="button" class="chapter-btn" onclick="seekTo(${clipTimestamps.chapter2_opening_dialog || 0})">
            <span class="chapter-time">⏱️ ${clipTimestamps.chapter2_opening_dialog || 0}s</span>
            <span class="chapter-name">⚠️ Detección y Diálogo de Apertura</span>
            <span class="chapter-desc">Caja Cerrada &rarr; Diálogo Modal</span>
          </button>
          <button type="button" class="chapter-btn" onclick="seekTo(${clipTimestamps.chapter3_submit_opening_fund || 0})">
            <span class="chapter-time">⏱️ ${clipTimestamps.chapter3_submit_opening_fund || 0}s</span>
            <span class="chapter-name">💵 Fondo Inicial y Activación</span>
            <span class="chapter-desc">Fondo $100.00 &rarr; Caja Abierta</span>
          </button>
        </div>
      </div>
    </section>

    <section class="card">
      <h3 style="font-size: 0.95rem; font-weight: 700; color: #fff;">Evidencia de Auditoría de Gobernanza (PostgreSQL)</h3>
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
              <td><code>status / mode / opening_cash</code></td>
              <td class="mono">open / shared / $100.00</td>
              <td class="mono">${governanceAudit?.checks?.cashSession?.observed?.status || 'N/A'} / ${governanceAudit?.checks?.cashSession?.observed?.mode || 'N/A'} / $${((governanceAudit?.checks?.cashSession?.observed?.opening_cash || 0)/100).toFixed(2)}</td>
              <td>${governanceAudit?.checks?.cashSession?.result === 'PASSED' ? '<span class="status-pill passed">PASSED</span>' : '<span class="status-pill failed">FAILED</span>'}</td>
            </tr>
            <tr>
              <td><code>cash_sessions</code></td>
              <td><code>opened_by / department_owner_id / cashier_id</code></td>
              <td class="mono">isaac.userId / samuel.userId / null</td>
              <td class="mono">${governanceAudit?.checks?.cashSession?.observed?.opened_by || 'N/A'} / ${governanceAudit?.checks?.cashSession?.observed?.department_owner_id || 'N/A'} / ${String(governanceAudit?.checks?.cashSession?.observed?.cashier_id)}</td>
              <td>${governanceAudit?.checks?.cashSession?.result === 'PASSED' ? '<span class="status-pill passed">PASSED</span>' : '<span class="status-pill failed">FAILED</span>'}</td>
            </tr>
            <tr>
              <td><code>cash_sessions (Total)</code></td>
              <td><code>total_sessions_in_org</code></td>
              <td class="mono">1 sesión activa</td>
              <td class="mono">${governanceAudit?.checks?.sessionCount?.observed || 0} sesiones</td>
              <td>${governanceAudit?.checks?.sessionCount?.result === 'PASSED' ? '<span class="status-pill passed">PASSED</span>' : '<span class="status-pill failed">FAILED</span>'}</td>
            </tr>
            <tr>
              <td><code>orders / order_items</code></td>
              <td><code>total_orders / total_items</code></td>
              <td class="mono">0 órdenes / 0 partidas</td>
              <td class="mono">${governanceAudit?.checks?.zeroOrders?.observed || 0} órdenes</td>
              <td>${governanceAudit?.checks?.zeroOrders?.result === 'PASSED' ? '<span class="status-pill passed">PASSED</span>' : '<span class="status-pill failed">FAILED</span>'}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>

  <script>
    const video = document.getElementById('pilotVideo');
    function setSpeed(speed, btn) {
      if (!video) return;
      video.playbackRate = speed;
      document.querySelectorAll('.btn-speed').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
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
  governanceAudit = null,
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
        governanceAudit,
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
  const baseArtifactsDir = path.join(REPO, 'artifacts', 'pilot-step4');
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

  const pastor = {
    id: 'pastor',
    role: 'pastor',
    name: 'David Ramos',
    church: 'Comunidad Cristiana Monte de Sion',
    email: 'david.ramos@example.org',
    password: 'Pastor2026!'
  };

  const samuel = {
    id: 'samuel',
    role: 'leader',
    name: 'Samuel Castro',
    church: 'Comunidad Cristiana Monte de Sion',
    email: 'samuel.castro@example.org',
    password: 'Lider2026!'
  };

  const isaac = {
    id: 'isaac',
    role: 'cashier',
    name: 'Isaac Díaz',
    church: 'Comunidad Cristiana Monte de Sion',
    email: 'isaac.diaz@example.org',
    password: 'Cajero2026!'
  };

  const andres = {
    id: 'andres',
    role: 'kitchen',
    name: 'Andrés Cruz',
    church: 'Comunidad Cristiana Monte de Sion',
    email: 'andres.cruz@example.org',
    password: 'Cocina2026!'
  };

  const actors = [pastor, samuel, isaac, andres];
  const observation = { allowedOrigins: new Set(), blocked: [] };
  const state = {};

  let browser = null;
  let functionalError = null;
  let videoDerivationStatus = 'SKIPPED';
  let videoProvenance = {};
  let governanceAudit = null;
  let clipTimestamps = {};

  try {
    browser = await chromium.launch({ headless: true });

    // =========================================================================
    // Phase 1: Setup Prerequisite Data (Silent Provisioning)
    // =========================================================================
    console.log('--- Phase 1: Setup Prerequisite Data (Silent Provisioning) ---');
    const setupContext = await browser.newContext({
      viewport: { width: 1366, height: 768 },
      locale: 'es-MX',
      timezoneId: 'America/Mexico_City',
      serviceWorkers: 'block'
    });
    await restrictBrowserToLocal(setupContext, observation);
    const setupPage = await setupContext.newPage();
    setupPage.setDefaultTimeout(30000);

    // 1.1 Register Pastor David Ramos
    console.log('Setup: Registering Pastor David Ramos on /signup...');
    await setupPage.goto(`${LOCAL.app}/signup`, { waitUntil: 'domcontentloaded', timeout: 60000 });

    const sNameInput = setupPage.locator('input[autocomplete="name"]');
    await expect(sNameInput).toBeVisible({ timeout: 30000 });
    const sChurchInput = setupPage.getByPlaceholder(/Iglesia Nueva Vida/i);
    await expect(sChurchInput).toBeVisible({ timeout: 30000 });

    await sNameInput.fill(pastor.name);
    await setupPage.locator('input[autocomplete="email"]').fill(pastor.email);
    await setupPage.locator('input[autocomplete="new-password"]').fill(pastor.password);
    await sChurchInput.fill(pastor.church);

    const userPromise = setupPage.waitForResponse(
      r => new URL(r.url()).pathname === '/auth/v1/signup' && r.request().method() === 'POST',
      { timeout: 30000 }
    );
    const tenantPromise = setupPage.waitForResponse(
      r => new URL(r.url()).pathname === '/rest/v1/rpc/setup_new_tenant' && r.request().method() === 'POST',
      { timeout: 30000 }
    );
    userPromise.catch(() => {});
    tenantPromise.catch(() => {});

    await setupPage.getByRole('button', { name: /CREAR CUENTA GRATIS/i }).click();

    const userRes = await userPromise;
    expect(userRes.ok(), 'Pastor signup HTTP status').toBe(true);
    const userData = await userRes.json();
    pastor.userId = userData.user?.id || userData.id;
    expect(pastor.userId).toBeTruthy();

    const tenantRes = await tenantPromise;
    expect(tenantRes.ok(), 'Tenant RPC HTTP status').toBe(true);
    const tenantData = await tenantRes.json();
    expect(tenantData.success).toBe(true);
    expect(tenantData.org_id).toBeTruthy();
    state.orgId = tenantData.org_id;

    console.log('Pastor registered with ID:', pastor.userId, 'Org ID:', state.orgId);

    await setupPage.waitForURL(url => url.pathname.includes('/page/POS/users'), { timeout: 30000 });
    await expect(setupPage.getByText('Gestión de Usuarios').first()).toBeVisible({ timeout: 20000 });

    // 1.2 Pastor provisions Samuel Castro (Leader)
    console.log('Setup: Provisioning Líder Samuel Castro under Pastor...');
    const pNameField = setupPage.getByLabel('Nombre completo', { exact: true });
    const pEmailField = setupPage.getByLabel('Email', { exact: true });
    const pPassField = setupPage.getByLabel('Contraseña (opcional)', { exact: true });
    const pSubmitBtn = setupPage.getByRole('button', { name: /Crear Usuario/i });

    await pNameField.fill(samuel.name);
    await pEmailField.fill(samuel.email);
    await pPassField.fill(samuel.password);

    const pRoleSelect = setupPage.locator('.v-select').first();
    await pRoleSelect.click();
    await setupPage.waitForTimeout(250);
    const leaderOpt = setupPage.locator('.v-overlay-container .v-list-item:visible').filter({ hasText: 'Líder de Departamento' }).first();
    if (await leaderOpt.isVisible({ timeout: 2000 }).catch(() => false)) {
      await leaderOpt.click();
    } else {
      await setupPage.getByRole('option', { name: 'Líder de Departamento', exact: true }).click();
    }
    await setupPage.waitForTimeout(300);

    const samuelSignupPromise = setupPage.waitForResponse(
      r => new URL(r.url()).pathname === '/auth/v1/signup' && r.request().method() === 'POST',
      { timeout: 30000 }
    );
    const samuelProvisionPromise = setupPage.waitForResponse(
      r => new URL(r.url()).pathname === '/rest/v1/rpc/provision_user_profile' && r.request().method() === 'POST',
      { timeout: 30000 }
    );
    samuelSignupPromise.catch(() => {});
    samuelProvisionPromise.catch(() => {});

    await pSubmitBtn.click();

    const sSignupRes = await samuelSignupPromise;
    expect(sSignupRes.ok(), 'Samuel signup HTTP status').toBe(true);
    const sSignupData = await sSignupRes.json();
    samuel.userId = sSignupData.user?.id || sSignupData.id;
    expect(samuel.userId).toBeTruthy();

    const sProvisionRes = await samuelProvisionPromise;
    expect(sProvisionRes.ok(), 'Samuel provision RPC HTTP status').toBe(true);
    console.log('Samuel Castro provisioned with ID:', samuel.userId);

    await setupContext.close();
    console.log('Setup: Pastor setup complete, context closed.');

    // 1.3 Samuel logs in on fresh samuelContext to recruit Isaac & Andrés and create Taco de Guisado
    console.log('Setup: Logging in as Líder Samuel on fresh context...');
    const samuelContext = await browser.newContext({
      viewport: { width: 1366, height: 768 },
      locale: 'es-MX',
      timezoneId: 'America/Mexico_City',
      serviceWorkers: 'block'
    });
    await restrictBrowserToLocal(samuelContext, observation);
    const samuelPage = await samuelContext.newPage();
    samuelPage.setDefaultTimeout(30000);

    await samuelPage.goto(`${LOCAL.app}/login`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await samuelPage.locator('input[autocomplete="email"]').fill(samuel.email);
    await samuelPage.locator('input[type="password"]').fill(samuel.password);

    const samuelLoginPromise = samuelPage.waitForResponse(
      r => new URL(r.url()).pathname === '/auth/v1/token' && r.request().method() === 'POST',
      { timeout: 30000 }
    );
    samuelLoginPromise.catch(() => {});
    await samuelPage.getByRole('button', { name: /ACCEDER AHORA/i }).click();
    await samuelLoginPromise;
    await samuelPage.waitForURL(url => !url.pathname.includes('/login'), { timeout: 30000 });

    // Navigate to /page/POS/users to recruit Isaac (cashier) and Andrés (kitchen)
    await samuelPage.goto(`${LOCAL.app}/page/POS/users`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await expect(samuelPage.getByText('Gestión de Usuarios').first()).toBeVisible({ timeout: 20000 });

    const sNameField = samuelPage.getByLabel('Nombre completo', { exact: true });
    const sEmailField = samuelPage.getByLabel('Email', { exact: true });
    const sPassField = samuelPage.getByLabel('Contraseña (opcional)', { exact: true });
    const sSubmitBtn = samuelPage.getByRole('button', { name: /Crear Usuario/i });

    // Recruit Isaac (cashier)
    console.log('Setup: Samuel recruiting Isaac Díaz (cashier)...');
    await sNameField.fill(isaac.name);
    await sEmailField.fill(isaac.email);
    await sPassField.fill(isaac.password);

    const iRoleSelect = samuelPage.locator('.v-select').first();
    await iRoleSelect.click();
    await samuelPage.waitForTimeout(250);
    const cashierOpt = samuelPage.locator('.v-overlay-container .v-list-item:visible').filter({ hasText: 'Cajero' }).first();
    if (await cashierOpt.isVisible({ timeout: 2000 }).catch(() => false)) {
      await cashierOpt.click();
    } else {
      await samuelPage.getByRole('option', { name: 'Cajero', exact: true }).click();
    }
    await samuelPage.waitForTimeout(300);

    const isaacSignupPromise = samuelPage.waitForResponse(
      r => new URL(r.url()).pathname === '/auth/v1/signup' && r.request().method() === 'POST',
      { timeout: 30000 }
    );
    const isaacProvisionPromise = samuelPage.waitForResponse(
      r => new URL(r.url()).pathname === '/rest/v1/rpc/provision_user_profile' && r.request().method() === 'POST',
      { timeout: 30000 }
    );
    isaacSignupPromise.catch(() => {});
    isaacProvisionPromise.catch(() => {});

    await sSubmitBtn.click();
    const iSignupRes = await isaacSignupPromise;
    expect(iSignupRes.ok()).toBe(true);
    const iSignupData = await iSignupRes.json();
    isaac.userId = iSignupData.user?.id || iSignupData.id;
    expect(isaac.userId).toBeTruthy();
    await isaacProvisionPromise;
    console.log('Isaac Díaz recruited with ID:', isaac.userId);

    // Recruit Andrés (kitchen)
    console.log('Setup: Samuel recruiting Andrés Cruz (kitchen)...');
    await sNameField.fill(andres.name);
    await sEmailField.fill(andres.email);
    await sPassField.fill(andres.password);

    await iRoleSelect.click();
    await samuelPage.waitForTimeout(250);
    const kitchenOpt = samuelPage.locator('.v-overlay-container .v-list-item:visible').filter({ hasText: 'Cocina' }).first();
    if (await kitchenOpt.isVisible({ timeout: 2000 }).catch(() => false)) {
      await kitchenOpt.click();
    } else {
      await samuelPage.getByRole('option', { name: 'Cocina', exact: true }).click();
    }
    await samuelPage.waitForTimeout(300);

    const andresSignupPromise = samuelPage.waitForResponse(
      r => new URL(r.url()).pathname === '/auth/v1/signup' && r.request().method() === 'POST',
      { timeout: 30000 }
    );
    const andresProvisionPromise = samuelPage.waitForResponse(
      r => new URL(r.url()).pathname === '/rest/v1/rpc/provision_user_profile' && r.request().method() === 'POST',
      { timeout: 30000 }
    );
    andresSignupPromise.catch(() => {});
    andresProvisionPromise.catch(() => {});

    await sSubmitBtn.click();
    const aSignupRes = await andresSignupPromise;
    expect(aSignupRes.ok()).toBe(true);
    const aSignupData = await aSignupRes.json();
    andres.userId = aSignupData.user?.id || aSignupData.id;
    expect(andres.userId).toBeTruthy();
    await andresProvisionPromise;
    console.log('Andrés Cruz recruited with ID:', andres.userId);

    // Create Taco de Guisado in /page/POS/products
    console.log('Setup: Samuel creating product Taco de Guisado ($55)...');
    await samuelPage.goto(`${LOCAL.app}/page/POS/products`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await expect(samuelPage.getByText('Catálogo de Productos').first()).toBeVisible({ timeout: 20000 });
    await samuelPage.getByRole('button', { name: /Nuevo Producto/i }).click();

    const prodDialog = samuelPage.locator('.v-dialog:visible');
    await expect(prodDialog).toBeVisible({ timeout: 10000 });
    await prodDialog.getByLabel('Nombre del Producto', { exact: true }).fill('Taco de Guisado');
    await prodDialog.getByLabel('Precio', { exact: true }).fill('55');

    const saveProdPromise = samuelPage.waitForResponse(
      r => r.url().includes('/rest/v1/products') && r.request().method() === 'POST',
      { timeout: 30000 }
    );
    saveProdPromise.catch(() => {});
    await prodDialog.getByRole('button', { name: /Guardar/i }).click();
    await saveProdPromise;
    await expect(prodDialog).toBeHidden({ timeout: 10000 });
    console.log('Taco de Guisado created successfully.');

    await samuelContext.close();
    console.log('Setup: Samuel context closed. Prerequisite state complete.');

    // =========================================================================
    // Phase 2: Recording Module 4 Video (Starting from /login)
    // =========================================================================
    console.log('--- Phase 2: Recording Module 4 Video (Cajero Isaac Díaz) ---');
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
    page.setDefaultTimeout(30000);
    const startRecordTime = Date.now();

    console.log('Navigating to Login page...');
    await page.goto(`${LOCAL.app}/login`, { waitUntil: 'networkidle', timeout: 60000 });

    const loginEmailInput = page.locator('input[autocomplete="email"]');
    const loginPasswordInput = page.locator('input[type="password"]');
    const loginSubmitBtn = page.getByRole('button', { name: /ACCEDER AHORA/i });

    await expect(loginEmailInput).toBeVisible({ timeout: 30000 });
    await expect(loginPasswordInput).toBeVisible({ timeout: 30000 });
    await expect(loginSubmitBtn).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(500);

    // Synchronize counter_ready timecode when login page is 100% visible, dark and stable
    const counterReadySec = parseFloat(((Date.now() - startRecordTime) / 1000).toFixed(2));
    console.log(`[VIDEO TIMECODE] counter_ready: ${counterReadySec}s`);

    const rawTimestamps = { record_start: 0, counter_ready: counterReadySec };
    const markRaw = name => {
      rawTimestamps[name] = parseFloat(((Date.now() - startRecordTime) / 1000).toFixed(2));
      console.log(`[VIDEO RAW TIMECODE] ${name}: ${rawTimestamps[name]}s`);
    };

    // =========================================================================
    // Chapter 1: Inicio de Sesión del Cajero (chapter1_cashier_login)
    // =========================================================================
    markRaw('chapter1_cashier_login');

    console.log('Action: Typing Cashier Isaac email...');
    await loginEmailInput.click();
    await loginEmailInput.fill('');
    await loginEmailInput.pressSequentially(isaac.email, { delay: 90 });
    await expect(loginEmailInput).toHaveValue(isaac.email);
    await page.waitForTimeout(350);

    console.log('Action: Typing Cashier Isaac password...');
    await loginPasswordInput.click();
    await loginPasswordInput.fill('');
    await loginPasswordInput.pressSequentially(isaac.password, { delay: 85 });
    await expect(loginPasswordInput).toHaveValue(isaac.password);

    console.log('Didactic pause: Anticipation before login click (500ms)...');
    await page.waitForTimeout(500);

    const loginTokenPromise = page.waitForResponse(
      r => new URL(r.url()).pathname === '/auth/v1/token' && r.request().method() === 'POST',
      { timeout: 30000 }
    );
    loginTokenPromise.catch(() => {});

    await loginSubmitBtn.click();

    const tokenRes = await loginTokenPromise;
    expect(tokenRes.ok(), 'Login token response HTTP').toBe(true);

    // Cashier redirects automatically to /page/POS/pointOfSales
    await page.waitForURL(url => url.pathname.includes('/page/POS/pointOfSales'), { timeout: 30000 });
    console.log('Login successful. Landed on Punto de Venta (/page/POS/pointOfSales)...');

    console.log('Didactic pause: Cognitive assimilation in POS console (1200ms)...');
    await page.waitForTimeout(1200);

    // =========================================================================
    // Chapter 2: Detección de Turno y Diálogo de Apertura (chapter2_opening_dialog)
    // =========================================================================
    markRaw('chapter2_opening_dialog');

    console.log('Verifying detection of closed register alert...');
    const closedAlert = page.locator('.v-alert').filter({ hasText: /Caja cerrada/i });
    await expect(closedAlert).toBeVisible({ timeout: 20000 });

    const openRegisterBtn = closedAlert.getByRole('button', { name: /Abrir Caja/i });
    await expect(openRegisterBtn).toBeVisible({ timeout: 20000 });

    console.log('Action: Clicking Abrir Caja button to display opening dialog...');
    await openRegisterBtn.click();

    const sessionDialog = page.locator('.v-dialog:visible');
    await expect(sessionDialog).toBeVisible({ timeout: 10000 });
    await expect(sessionDialog.getByText('Apertura de Caja')).toBeVisible({ timeout: 10000 });
    await expect(sessionDialog.getByText('Registra el fondo inicial para abrir la caja de este turno.')).toBeVisible({ timeout: 10000 });

    console.log('Didactic pause: Dialogue assimilation (1200ms)...');
    await page.waitForTimeout(1200);

    // =========================================================================
    // Chapter 3: Registro de Fondo Inicial y Activación (chapter3_submit_opening_fund)
    // =========================================================================
    markRaw('chapter3_submit_opening_fund');

    const openingCashInput = sessionDialog.getByLabel('Fondo inicial', { exact: true });
    await expect(openingCashInput).toBeVisible({ timeout: 10000 });

    console.log('Action: Typing initial cash fund ($100.00)...');
    await openingCashInput.click();
    await openingCashInput.fill('');
    await openingCashInput.pressSequentially('100', { delay: 85 });
    await expect(openingCashInput).toHaveValue('100');

    console.log('Didactic pause: Anticipation before submitting fund (400ms)...');
    await page.waitForTimeout(400);

    const openRpcPromise = page.waitForResponse(
      r => new URL(r.url()).pathname === '/rest/v1/rpc/open_cash_session' && r.request().method() === 'POST',
      { timeout: 30000 }
    );
    openRpcPromise.catch(() => {});

    const confirmOpenBtn = sessionDialog.getByRole('button', { name: /Abrir Caja/i });
    await confirmOpenBtn.click();

    const openRpcRes = await openRpcPromise;
    expect(openRpcRes.ok(), 'open_cash_session RPC HTTP status').toBe(true);
    const rpcData = await openRpcRes.json();
    state.sessionId = rpcData?.session?.id || rpcData?.id;
    expect(state.sessionId).toBeTruthy();
    console.log('Cash session opened successfully with ID:', state.sessionId);

    // Verify dialog closes
    await expect(sessionDialog).toBeHidden({ timeout: 10000 });

    // Verify state transition: closed alert disappears, open register alert appears
    const openAlert = page.locator('.v-alert').filter({ hasText: /Caja abierta/i });
    await expect(openAlert).toBeVisible({ timeout: 20000 });
    await expect(openAlert).toContainText(/Caja compartida/i);
    await expect(openAlert).toContainText('$100.00');

    console.log('Didactic pause: Final active cash register consolidation (2000ms)...');
    await page.waitForTimeout(2000);

    markRaw('video_end');

    const videoObj = page.video();
    await pilotContext.close();

    // =========================================================================
    // Phase 3: Strict PostgreSQL Database Assertions (Governance Audit)
    // =========================================================================
    console.log('--- Phase 3: Strict PostgreSQL Assertions (Pre-Cleanup) ---');
    const db = trainingData(state);

    // 1. Verify cash session in PostgreSQL
    const sessionData = db.session(state.sessionId, {
      status: 'open',
      mode: 'shared',
      opened_by: isaac.userId,
      department_owner_id: samuel.userId,
      cashier_id: null
    });
    expect(cents(sessionData.opening_cash)).toBe(10000);
    expect(sessionData.closed_at).toBe(null);

    // Verify exactly 1 session in organization
    const sessionsInOrg = readJsonSql(`coalesce(json_agg(t),'[]'::json) FROM (SELECT * FROM public.cash_sessions WHERE org_id=${quoteSql(state.orgId)}) t`);
    expect(sessionsInOrg.length).toBe(1);

    // 2. Zero premature transactions
    const ordersCount = readJsonSql(`(SELECT count(*) FROM public.orders WHERE org_id=${quoteSql(state.orgId)})`);
    expect(ordersCount).toBe(0);
    const orderItemsCount = readJsonSql(`(SELECT count(*) FROM public.order_items WHERE order_id IN (SELECT id FROM public.orders WHERE org_id=${quoteSql(state.orgId)}))`);
    expect(orderItemsCount).toBe(0);

    governanceAudit = {
      runId,
      verifiedAt: new Date().toISOString(),
      identifiers: {
        organizationId: state.orgId,
        pastorUserId: pastor.userId,
        leaderUserId: samuel.userId,
        cashierUserId: isaac.userId,
        kitchenUserId: andres.userId,
        sessionId: state.sessionId
      },
      checks: {
        cashSession: {
          table: 'cash_sessions',
          id: state.sessionId,
          expected: {
            status: 'open',
            mode: 'shared',
            opening_cash: 10000,
            opened_by: isaac.userId,
            department_owner_id: samuel.userId,
            cashier_id: null,
            closed_at: null
          },
          observed: {
            status: sessionData.status,
            mode: sessionData.mode,
            opening_cash: cents(sessionData.opening_cash),
            opened_by: sessionData.opened_by,
            department_owner_id: sessionData.department_owner_id,
            cashier_id: sessionData.cashier_id,
            closed_at: sessionData.closed_at
          },
          result: 'PASSED'
        },
        sessionCount: {
          table: 'cash_sessions',
          expected: 1,
          observed: sessionsInOrg.length,
          result: sessionsInOrg.length === 1 ? 'PASSED' : 'FAILED'
        },
        zeroOrders: {
          table: 'orders',
          expected: 0,
          observed: ordersCount,
          result: ordersCount === 0 && orderItemsCount === 0 ? 'PASSED' : 'FAILED'
        }
      },
      overallStatus: 'ALL_ASSERTIONS_PASSED'
    };

    fs.writeFileSync(path.join(runDir, 'governance_audit.json'), JSON.stringify(governanceAudit, null, 2), 'utf8');

    // =========================================================================
    // Phase 4: Video Processing, Trimming & Metadata Probe
    // =========================================================================
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

      const derivedVideoPath = path.join(runDir, 'pilot_step4.webm');
      const trimRes = deriveDidacticClip(ffmpegPath, rawVideoPath, derivedVideoPath, counterReadySec);

      if (trimRes.success) {
        const derivedStat = fs.statSync(derivedVideoPath);
        const derivedSha256 = createHash('sha256').update(fs.readFileSync(derivedVideoPath)).digest('hex');
        const derivedProbe = probeVideoFile(ffmpegPath, derivedVideoPath);
        const validation = validateDerivedClip(derivedProbe, derivedVideoPath);

        if (validation.valid) {
          clipTimestamps = {
            chapter1_cashier_login: Math.max(0, parseFloat((rawTimestamps.chapter1_cashier_login - counterReadySec).toFixed(2))),
            chapter2_opening_dialog: Math.max(0, parseFloat((rawTimestamps.chapter2_opening_dialog - counterReadySec).toFixed(2))),
            chapter3_submit_opening_fund: Math.max(0, parseFloat((rawTimestamps.chapter3_submit_opening_fund - counterReadySec).toFixed(2))),
            clip_end: derivedProbe.durationSec
          };

          videoProvenance.derived = {
            file: 'pilot_step4.webm',
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
            file: 'pilot_step4.webm',
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
    console.error('PILOT_STEP4_FUNCTIONAL_ERROR:', err);
  } finally {
    // Decoupled finalizers
    const { overallPassed } = await runFinalizers({
      browser,
      runId,
      actors,
      state,
      runDir,
      functionalError,
      videoDerivationStatus,
      videoProvenance,
      governanceAudit,
      clipTimestamps
    });

    if (!overallPassed) {
      process.exitCode = 1;
    }
  }
}
