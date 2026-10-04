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
 * - Finite frame rate (e.g. 25 FPS)
 */
export function validateDerivedClip(probeResult, derivedVideoPath) {
  if (!derivedVideoPath || !fs.existsSync(derivedVideoPath)) {
    return { valid: false, reason: 'DERIVED_FILE_MISSING' };
  }
  const stat = fs.statSync(derivedVideoPath);
  if (stat.size <= 0) {
    return { valid: false, reason: 'DERIVED_FILE_ZERO_BYTES' };
  }
  if (!probeResult) {
    return { valid: false, reason: 'PROBE_FAILED' };
  }
  if (!probeResult.durationSec || probeResult.durationSec <= 0) {
    return { valid: false, reason: 'INVALID_DURATION', details: probeResult.durationSec };
  }
  if (!probeResult.codec || !probeResult.codec.toLowerCase().includes('vp8')) {
    return { valid: false, reason: 'NON_VP8_CODEC', details: probeResult.codec };
  }
  if (probeResult.resolution !== '1366x768') {
    return { valid: false, reason: 'NON_TARGET_RESOLUTION', details: probeResult.resolution };
  }
  if (!probeResult.fps || probeResult.fps <= 0) {
    return { valid: false, reason: 'INVALID_FPS', details: probeResult.fps };
  }
  return { valid: true };
}

/**
 * Generates an evaluation viewer HTML file matching the quality standard of Module 1 and 5.
 */
export function generateViewerHtml({
  runDir,
  runId,
  executionSummary,
  videoProvenance,
  governanceAudit,
  clipTimestamps = {}
}) {
  const isVideoApproved = executionSummary.videoDerivationStatus === 'PASSED';
  const isInventoryClean = executionSummary.inventoryStatus === 'PASSED';
  const isGovernancePassed = governanceAudit?.overallStatus === 'ALL_ASSERTIONS_PASSED';

  const derivedMeta = videoProvenance?.derived;
  const rawMeta = videoProvenance?.raw;

  const hasValidDerivedMetrics = isVideoApproved &&
    derivedMeta?.measuredDurationSec &&
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
  <title>Evaluación Piloto Paso 2 — Run ${runId}</title>
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
      <span class="badge">👥 Módulo 2 (Gestión de Personal y Delegación Ministerial)</span>
      <h1>Visor de Evaluación Local — Video Nativo HD</h1>
      <p class="subtitle">Run ID: ${runId} | Procedimiento: Módulo 2 — Delegación Departamental: Samuel Castro (Cafetería) y Marcos Peña (Librería + Auto-Completar)</p>
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
        <span class="metric-label">Gobernanza DB</span>
        <div class="metric-value">${governanceBadge}</div>
        <span class="metric-sub">Pastor, Líder Cafetería y Líder Librería</span>
      </div>
      <div class="card">
        <span class="metric-label">Limpieza BD</span>
        <div class="metric-value">${inventoryBadge}</div>
        <span class="metric-sub">Estado: ${executionSummary.cleanupStatus}</span>
      </div>
    </div>

    <section class="card player-section">
      <div class="video-wrapper">
        <video id="pilotVideo" src="${hasValidDerivedMetrics ? 'pilot_step2.webm' : 'raw_video.webm'}" controls preload="metadata"></video>
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
          <button type="button" class="chapter-btn" onclick="seekTo(${clipTimestamps.chapter1_invite_leader || 0})">
            <span class="chapter-time">⏱️ ${clipTimestamps.chapter1_invite_leader || 0}s</span>
            <span class="chapter-name">👤 Alta Líder Cafetería</span>
            <span class="chapter-desc">Samuel Castro (KDS Cocina Activa)</span>
          </button>
          <button type="button" class="chapter-btn" onclick="seekTo(${clipTimestamps.chapter2_invite_leader || 0})">
            <span class="chapter-time">⏱️ ${clipTimestamps.chapter2_invite_leader || 0}s</span>
            <span class="chapter-name">👤 Alta Líder Librería</span>
            <span class="chapter-desc">Marcos Peña (Venta de Mostrador)</span>
          </button>
          <button type="button" class="chapter-btn" onclick="seekTo(${clipTimestamps.chapter3_toggle_auto_accept || 0})">
            <span class="chapter-time">⏱️ ${clipTimestamps.chapter3_toggle_auto_accept || 0}s</span>
            <span class="chapter-name">⚡ Auto-Completar (ON)</span>
            <span class="chapter-desc">Librería: Cobro directo sin cocina</span>
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
              <td><code>organizations</code></td>
              <td><code>name / owner_id</code></td>
              <td class="mono">Comunidad Cristiana Monte de Sion / pastor.userId</td>
              <td class="mono">${governanceAudit?.checks?.organization?.observed?.name || 'N/A'} / ${governanceAudit?.checks?.organization?.observed?.owner_id || 'N/A'}</td>
              <td>${governanceAudit?.checks?.organization?.result === 'PASSED' ? '<span class="status-pill passed">PASSED</span>' : '<span class="status-pill failed">FAILED</span>'}</td>
            </tr>
            <tr>
              <td><code>profiles (Pastor)</code></td>
              <td><code>role / onboarding_completed</code></td>
              <td class="mono">pastor / true</td>
              <td class="mono">${governanceAudit?.checks?.pastorProfile?.observed?.role || 'N/A'} / ${String(governanceAudit?.checks?.pastorProfile?.observed?.onboarding_completed)}</td>
              <td>${governanceAudit?.checks?.pastorProfile?.result === 'PASSED' ? '<span class="status-pill passed">PASSED</span>' : '<span class="status-pill failed">FAILED</span>'}</td>
            </tr>
            <tr>
              <td><code>profiles (Líder Cafetería)</code></td>
              <td><code>role / auto_accept_orders</code></td>
              <td class="mono">leader / false (KDS cocina activo)</td>
              <td class="mono">${governanceAudit?.checks?.samuelProfile?.observed?.role || 'N/A'} / ${String(governanceAudit?.checks?.samuelProfile?.observed?.auto_accept_orders)}</td>
              <td>${governanceAudit?.checks?.samuelProfile?.result === 'PASSED' ? '<span class="status-pill passed">PASSED</span>' : '<span class="status-pill failed">FAILED</span>'}</td>
            </tr>
            <tr>
              <td><code>profiles (Líder Librería)</code></td>
              <td><code>role / auto_accept_orders</code></td>
              <td class="mono">leader / true (Venta directa)</td>
              <td class="mono">${governanceAudit?.checks?.marcosProfile?.observed?.role || 'N/A'} / ${String(governanceAudit?.checks?.marcosProfile?.observed?.auto_accept_orders)}</td>
              <td>${governanceAudit?.checks?.marcosProfile?.result === 'PASSED' ? '<span class="status-pill passed">PASSED</span>' : '<span class="status-pill failed">FAILED</span>'}</td>
            </tr>
            <tr>
              <td><code>profiles (Conteo)</code></td>
              <td><code>total_profiles_in_org</code></td>
              <td class="mono">3 perfiles asociados a la organización</td>
              <td class="mono">${governanceAudit?.checks?.staffCount?.observed || 'N/A'} perfiles</td>
              <td>${governanceAudit?.checks?.staffCount?.result === 'PASSED' ? '<span class="status-pill passed">PASSED</span>' : '<span class="status-pill failed">FAILED</span>'}</td>
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
  const baseArtifactsDir = path.join(REPO, 'artifacts', 'pilot-step2');
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
    name: 'Pastor David Ramos',
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

  const marcos = {
    id: 'marcos',
    role: 'leader',
    name: 'Marcos Peña',
    church: 'Comunidad Cristiana Monte de Sion',
    email: 'marcos.pena@example.org',
    password: 'Lider2026!'
  };

  const actors = [pastor, samuel, marcos];
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
    // Phase 1: Setup Prerequisite Data & Video Recording Context
    // =========================================================================
    console.log('--- Phase 1: Setup Prerequisite Data & Video Recording Context ---');
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

    console.log('Navigating to Signup page for Pastor onboarding...');
    await page.goto(`${LOCAL.app}/signup`, { waitUntil: 'domcontentloaded', timeout: 60000 });

    const sNameInput = page.locator('input[autocomplete="name"]');
    await expect(sNameInput).toBeVisible({ timeout: 30000 });
    const sChurchInput = page.getByPlaceholder(/Iglesia Nueva Vida/i);
    await expect(sChurchInput).toBeVisible({ timeout: 30000 });

    await sNameInput.fill(pastor.name);
    await page.locator('input[autocomplete="email"]').fill(pastor.email);
    await page.locator('input[autocomplete="new-password"]').fill(pastor.password);
    await sChurchInput.fill(pastor.church);

    const userPromise = page.waitForResponse(
      r => new URL(r.url()).pathname === '/auth/v1/signup' && r.request().method() === 'POST',
      { timeout: 30000 }
    );
    const tenantPromise = page.waitForResponse(
      r => new URL(r.url()).pathname === '/rest/v1/rpc/setup_new_tenant' && r.request().method() === 'POST',
      { timeout: 30000 }
    );
    userPromise.catch(() => {});
    tenantPromise.catch(() => {});

    await page.getByRole('button', { name: /CREAR CUENTA GRATIS/i }).click();

    const userRes = await userPromise;
    expect(userRes.ok(), 'local signup HTTP status').toBe(true);
    const userData = await userRes.json();
    pastor.userId = userData.user?.id || userData.id;
    expect(pastor.userId).toBeTruthy();

    const tenantRes = await tenantPromise;
    expect(tenantRes.ok(), 'local tenant RPC HTTP status').toBe(true);
    const tenantData = await tenantRes.json();
    expect(tenantData.success).toBe(true);
    expect(tenantData.org_id).toBeTruthy();
    state.orgId = tenantData.org_id;

    console.log('Pastor registered with ID:', pastor.userId);
    console.log('Organization created with ID:', state.orgId);

    console.log('Waiting for navigation to /page/POS/users...');
    await page.waitForURL(url => url.pathname.includes('/page/POS/users'), { timeout: 30000 });

    // Wait until Nuxt page transition, SSR hydration and Vite chunk compilations are 100% complete
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('Gestión de Usuarios').first()).toBeVisible({ timeout: 20000 });

    const nameInput = page.getByLabel('Nombre completo', { exact: true });
    await expect(nameInput).toBeVisible({ timeout: 30000 });
    const emailInput = page.getByLabel('Email', { exact: true });
    await expect(emailInput).toBeVisible({ timeout: 30000 });
    const passwordInput = page.getByLabel('Contraseña (opcional)', { exact: true });
    await expect(passwordInput).toBeVisible({ timeout: 30000 });
    const submitBtn = page.getByRole('button', { name: /Crear Usuario/i });
    await expect(submitBtn).toBeVisible({ timeout: 30000 });
    await expect(page.getByText('Usuarios Existentes')).toBeVisible({ timeout: 30000 });
    await expect(page.locator('table')).toBeVisible({ timeout: 30000 });

    // Ensure the Nuxt loading splash screen (Nuxt 4.2.1) has completely finished and unmounted
    console.log('Stabilizing UI after Nuxt hydration and compilation (3000ms)...');
    await page.waitForTimeout(3000);
    await expect(nameInput).toBeEditable({ timeout: 10000 });

    // Mark counterReadySec at the exact moment the console is 100% settled, dark, and stable
    const counterReadySec = parseFloat(((Date.now() - startRecordTime) / 1000).toFixed(2));
    console.log(`[VIDEO TIMECODE] counter_ready: ${counterReadySec}s`);

    const rawTimestamps = { record_start: 0, counter_ready: counterReadySec };
    const markRaw = name => {
      rawTimestamps[name] = parseFloat(((Date.now() - startRecordTime) / 1000).toFixed(2));
      console.log(`[VIDEO RAW TIMECODE] ${name}: ${rawTimestamps[name]}s`);
    };

    // Pausa de asimilación cognitiva inicial: 1,500 ms
    console.log('Didactic pause: Cognitive assimilation of users console (1500ms)...');
    await page.waitForTimeout(1500);

    // Helper to select role in Vuetify v-select
    async function selectRoleOption(targetTitle) {
      console.log(`Action: Selecting role '${targetTitle}'...`);
      const select = page.locator('.v-select').first();
      await select.click();
      await page.waitForTimeout(300);

      const option = page.locator('.v-overlay-container .v-list-item:visible').filter({ hasText: targetTitle }).first();
      if (await option.isVisible({ timeout: 3000 }).catch(() => false)) {
        await option.click();
      } else {
        await page.getByRole('option', { name: targetTitle, exact: true }).click();
      }
      await page.waitForTimeout(400);
      await expect(select).toContainText(targetTitle);
    }

    // =========================================================================
    // Chapter 1: Alta de Líder Departamental - Cafetería (Samuel Castro)
    // =========================================================================
    markRaw('chapter1_invite_leader');
    console.log('Action: Filling Samuel Name (pedagogical typing)...');
    await nameInput.click();
    await nameInput.fill('');
    await nameInput.pressSequentially(samuel.name, { delay: 95 });
    await expect(nameInput).toHaveValue(samuel.name);
    await page.waitForTimeout(350);

    console.log('Action: Filling Samuel Email (pedagogical typing)...');
    await emailInput.click();
    await emailInput.fill('');
    await emailInput.pressSequentially(samuel.email, { delay: 90 });
    await expect(emailInput).toHaveValue(samuel.email);
    await page.waitForTimeout(350);

    console.log('Action: Filling Samuel Password (pedagogical typing)...');
    await passwordInput.click();
    await passwordInput.fill('');
    await passwordInput.pressSequentially(samuel.password, { delay: 85 });
    await page.waitForTimeout(350);

    await selectRoleOption('Líder de Departamento');

    // Didactic pause of anticipation before submission
    await page.waitForTimeout(600);

    console.log('Action: Submitting Samuel creation...');
    const samuelSignupPromise = page.waitForResponse(
      r => new URL(r.url()).pathname === '/auth/v1/signup' && r.request().method() === 'POST',
      { timeout: 30000 }
    );
    const samuelProvisionPromise = page.waitForResponse(
      r => new URL(r.url()).pathname === '/rest/v1/rpc/provision_user_profile' && r.request().method() === 'POST',
      { timeout: 30000 }
    );
    samuelSignupPromise.catch(() => {});
    samuelProvisionPromise.catch(() => {});

    await submitBtn.click();

    const sSignupRes = await samuelSignupPromise;
    expect(sSignupRes.ok(), 'Samuel signup HTTP status').toBe(true);
    const sSignupData = await sSignupRes.json();
    samuel.userId = sSignupData.user?.id || sSignupData.id;
    expect(samuel.userId).toBeTruthy();
    console.log('Samuel Castro registered with ID:', samuel.userId);

    const sProvisionRes = await samuelProvisionPromise;
    expect(sProvisionRes.ok(), 'Samuel provisioning RPC HTTP status').toBe(true);

    // Verify Samuel Castro row in table with chip LÍDER DE DEPARTAMENTO
    console.log('Verifying Samuel Castro appears in users table...');
    const samuelRow = page.locator('tbody tr').filter({ hasText: samuel.email });
    await expect(samuelRow).toBeVisible({ timeout: 20000 });
    await expect(samuelRow.locator('.v-chip')).toContainText(/LÍDER DE DEPARTAMENTO/i);

    // Pausa didáctica de consolidación: 1,200 ms
    console.log('Didactic pause: Leader 1 consolidation (1200ms)...');
    await page.waitForTimeout(1200);

    // =========================================================================
    // Chapter 2: Alta de Líder Departamental - Librería (Marcos Peña)
    // =========================================================================
    markRaw('chapter2_invite_leader');
    console.log('Action: Filling Marcos Name (pedagogical typing)...');
    await nameInput.click();
    await nameInput.fill('');
    await nameInput.pressSequentially(marcos.name, { delay: 95 });
    await expect(nameInput).toHaveValue(marcos.name);
    await page.waitForTimeout(350);

    console.log('Action: Filling Marcos Email (pedagogical typing)...');
    await emailInput.click();
    await emailInput.fill('');
    await emailInput.pressSequentially(marcos.email, { delay: 90 });
    await expect(emailInput).toHaveValue(marcos.email);
    await page.waitForTimeout(350);

    console.log('Action: Filling Marcos Password (pedagogical typing)...');
    await passwordInput.click();
    await passwordInput.fill('');
    await passwordInput.pressSequentially(marcos.password, { delay: 85 });
    await page.waitForTimeout(350);

    await selectRoleOption('Líder de Departamento');

    // Didactic pause of anticipation before submission
    await page.waitForTimeout(600);

    console.log('Action: Submitting Marcos creation...');
    const marcosSignupPromise = page.waitForResponse(
      r => new URL(r.url()).pathname === '/auth/v1/signup' && r.request().method() === 'POST',
      { timeout: 30000 }
    );
    const marcosProvisionPromise = page.waitForResponse(
      r => new URL(r.url()).pathname === '/rest/v1/rpc/provision_user_profile' && r.request().method() === 'POST',
      { timeout: 30000 }
    );
    marcosSignupPromise.catch(() => {});
    marcosProvisionPromise.catch(() => {});

    await submitBtn.click();

    const mSignupRes = await marcosSignupPromise;
    expect(mSignupRes.ok(), 'Marcos signup HTTP status').toBe(true);
    const mSignupData = await mSignupRes.json();
    marcos.userId = mSignupData.user?.id || mSignupData.id;
    expect(marcos.userId).toBeTruthy();
    console.log('Marcos Peña registered with ID:', marcos.userId);

    const mProvisionRes = await marcosProvisionPromise;
    expect(mProvisionRes.ok(), 'Marcos provisioning RPC HTTP status').toBe(true);

    // Verify Marcos Peña row in table with chip LÍDER DE DEPARTAMENTO
    console.log('Verifying Marcos Peña appears in users table...');
    const marcosRow = page.locator('tbody tr').filter({ hasText: marcos.email });
    await expect(marcosRow).toBeVisible({ timeout: 20000 });
    await expect(marcosRow.locator('.v-chip')).toContainText(/LÍDER DE DEPARTAMENTO/i);

    // Verify both leaders present in table
    await expect(page.locator('tbody tr')).toHaveCount(2);

    // Pausa didáctica de consolidación: 1,200 ms
    console.log('Didactic pause: Leader 2 consolidation (1200ms)...');
    await page.waitForTimeout(1200);

    // =========================================================================
    // Chapter 3: Configuración de Auto-Completar (Marcos Peña - Librería)
    // =========================================================================
    markRaw('chapter3_toggle_auto_accept');
    console.log('Action: Opening action menu for Marcos Peña (Librería)...');
    const marcosMenuBtn = marcosRow.locator('button.v-btn').last();
    await expect(marcosMenuBtn).toBeVisible({ timeout: 5000 });
    await marcosMenuBtn.click();

    const autoAcceptItem = page.locator('.v-overlay-container .v-list-item').filter({ hasText: 'Auto-completar' });
    await expect(autoAcceptItem).toBeVisible({ timeout: 5000 });
    await expect(autoAcceptItem).toContainText('Auto-completar: OFF');
    await expect(autoAcceptItem).toContainText('Ventas pasan a KDS para aprobación');

    // Pausa didáctica para lectura de estado OFF (1,500ms)
    console.log('Didactic pause: Reading Auto-completar OFF and explanation (1500ms)...');
    await page.waitForTimeout(1500);

    console.log('Action: Clicking Auto-completar to activate direct sales mode...');
    const autoAcceptRpcPromise = page.waitForResponse(
      r => new URL(r.url()).pathname.includes('set_staff_auto_accept_safely') && r.request().method() === 'POST',
      { timeout: 15000 }
    );
    autoAcceptRpcPromise.catch(() => {});

    await autoAcceptItem.click();

    const autoAcceptRes = await autoAcceptRpcPromise;
    expect(autoAcceptRes.ok(), 'set_staff_auto_accept_safely HTTP status').toBe(true);
    console.log('RPC set_staff_auto_accept_safely executed successfully');

    // Breve pausa para asentar actualización reactiva (700ms)
    await page.waitForTimeout(700);

    // Reabrir menú para mostrar didácticamente el estado ON y su explicación
    console.log('Action: Reopening action menu to verify Auto-completar is ON...');
    await marcosMenuBtn.click();
    await expect(autoAcceptItem).toBeVisible({ timeout: 5000 });
    await expect(autoAcceptItem).toContainText('Auto-completar: ON');
    await expect(autoAcceptItem).toContainText('Ventas se aceptan sin pasar por cocina');

    // Pausa didáctica de asimilación: 2,500 ms mostrando Auto-completar: ON
    console.log('Didactic pause: Consolidating Auto-completar ON state (2500ms)...');
    await page.waitForTimeout(2500);

    // Cerrar menú limpiamente
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);

    // Pausa de consolidación final: 1,500 ms
    console.log('Didactic pause: Final consolidation (1500ms)...');
    await page.waitForTimeout(1500);

    markRaw('video_end');

    const videoObj = page.video();
    await pilotContext.close();

    // =========================================================================
    // Phase 3: Strict PostgreSQL Database Assertions (Governance Audit)
    // =========================================================================
    console.log('--- Phase 3: Strict PostgreSQL Assertions (Pre-Cleanup) ---');
    const db = trainingData(state);

    // 1. Verify Organization in PostgreSQL
    const orgData = db.organization(pastor);
    expect(orgData.name).toBe(pastor.church);
    expect(orgData.owner_id).toBe(pastor.userId);

    // 2. Verify Pastor Profile in PostgreSQL
    const pastorProfile = db.profile(pastor);
    expect(pastorProfile.role).toBe('pastor');
    expect(pastorProfile.onboarding_completed).toBe(true);
    expect(pastorProfile.org_id).toBe(state.orgId);

    // 3. Verify Leader Profile (Samuel Castro - Cafetería) in PostgreSQL
    const leaderSamuel = db.profile(samuel, pastor.userId);
    expect(leaderSamuel.role).toBe('leader');
    expect(leaderSamuel.email).toBe(samuel.email);
    expect(leaderSamuel.org_id).toBe(state.orgId);
    expect(leaderSamuel.owner_id).toBe(pastor.userId);
    expect(leaderSamuel.auto_accept_orders).toBe(false);

    // 4. Verify Leader Profile (Marcos Peña - Librería) in PostgreSQL
    const leaderMarcos = db.profile(marcos, pastor.userId);
    expect(leaderMarcos.role).toBe('leader');
    expect(leaderMarcos.email).toBe(marcos.email);
    expect(leaderMarcos.org_id).toBe(state.orgId);
    expect(leaderMarcos.owner_id).toBe(pastor.userId);
    expect(leaderMarcos.auto_accept_orders).toBe(true);

    // 5. Verify exactly 3 profiles associated to the organization
    const allProfilesInOrg = readJsonSql(`coalesce(json_agg(t),'[]'::json) FROM (SELECT * FROM public.profiles WHERE org_id=${quoteSql(state.orgId)}) t`);
    expect(allProfilesInOrg.length).toBe(3);

    governanceAudit = {
      runId,
      verifiedAt: new Date().toISOString(),
      identifiers: {
        organizationId: state.orgId,
        pastorUserId: pastor.userId,
        leaderSamuelId: samuel.userId,
        leaderMarcosId: marcos.userId,
        profileCount: allProfilesInOrg.length
      },
      checks: {
        organization: {
          table: 'organizations',
          id: state.orgId,
          expected: { id: state.orgId, name: pastor.church, owner_id: pastor.userId },
          observed: { id: orgData.id, name: orgData.name, owner_id: orgData.owner_id },
          result: 'PASSED'
        },
        pastorProfile: {
          table: 'profiles',
          id: pastor.userId,
          expected: { role: 'pastor', onboarding_completed: true, org_id: state.orgId },
          observed: { role: pastorProfile.role, onboarding_completed: pastorProfile.onboarding_completed, org_id: pastorProfile.org_id },
          result: 'PASSED'
        },
        samuelProfile: {
          table: 'profiles',
          id: samuel.userId,
          expected: { role: 'leader', email: samuel.email, org_id: state.orgId, owner_id: pastor.userId, auto_accept_orders: false },
          observed: { role: leaderSamuel.role, email: leaderSamuel.email, org_id: leaderSamuel.org_id, owner_id: leaderSamuel.owner_id, auto_accept_orders: leaderSamuel.auto_accept_orders },
          result: (leaderSamuel.role === 'leader' && leaderSamuel.auto_accept_orders === false) ? 'PASSED' : 'FAILED'
        },
        marcosProfile: {
          table: 'profiles',
          id: marcos.userId,
          expected: { role: 'leader', email: marcos.email, org_id: state.orgId, owner_id: pastor.userId, auto_accept_orders: true },
          observed: { role: leaderMarcos.role, email: leaderMarcos.email, org_id: leaderMarcos.org_id, owner_id: leaderMarcos.owner_id, auto_accept_orders: leaderMarcos.auto_accept_orders },
          result: (leaderMarcos.role === 'leader' && leaderMarcos.auto_accept_orders === true) ? 'PASSED' : 'FAILED'
        },
        staffCount: {
          table: 'profiles',
          expected: 3,
          observed: allProfilesInOrg.length,
          result: allProfilesInOrg.length === 3 ? 'PASSED' : 'FAILED'
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

      const derivedVideoPath = path.join(runDir, 'pilot_step2.webm');
      const trimRes = deriveDidacticClip(ffmpegPath, rawVideoPath, derivedVideoPath, counterReadySec);

      if (trimRes.success) {
        const derivedStat = fs.statSync(derivedVideoPath);
        const derivedSha256 = createHash('sha256').update(fs.readFileSync(derivedVideoPath)).digest('hex');
        const derivedProbe = probeVideoFile(ffmpegPath, derivedVideoPath);
        const validation = validateDerivedClip(derivedProbe, derivedVideoPath);

        if (validation.valid) {
          clipTimestamps = {
            chapter1_invite_leader: Math.max(0, parseFloat((rawTimestamps.chapter1_invite_leader - counterReadySec).toFixed(2))),
            chapter2_invite_leader: Math.max(0, parseFloat((rawTimestamps.chapter2_invite_leader - counterReadySec).toFixed(2))),
            chapter3_toggle_auto_accept: Math.max(0, parseFloat((rawTimestamps.chapter3_toggle_auto_accept - counterReadySec).toFixed(2))),
            clip_end: derivedProbe.durationSec
          };

          videoProvenance.derived = {
            file: 'pilot_step2.webm',
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
            file: 'pilot_step2.webm',
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
    console.error('PILOT_STEP2_FUNCTIONAL_ERROR:', err);
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
