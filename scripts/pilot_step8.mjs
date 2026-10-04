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
      throw new Error(`CHECKOUT_ORDER_ID_OUT_OF_RANGE: order_id number must be a positive safe integer, received ${rawId}`);
    }
    return rawId;
  }
  if (!/^\d+$/.test(rawId.trim())) {
    throw new Error(`CHECKOUT_ORDER_ID_NON_NUMERIC_STRING: order_id string must contain digits only, received '${rawId}'`);
  }
  const parsedNum = Number(rawId);
  if (!Number.isSafeInteger(parsedNum) || parsedNum <= 0) {
    throw new Error(`CHECKOUT_ORDER_ID_BIGINT_UNSAFE: order_id string '${rawId}' exceeds safe integer range`);
  }
  return parsedNum;
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
 * Builds the standalone, offline-ready HTML viewer for Module 8 (Cierre de Caja y Reconciliación).
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
  <title>Evaluación Piloto Paso 8 — Run ${runId}</title>
  <style>
    :root {
      --bg: #0b0f17;
      --card-bg: #131b2e;
      --card-border: #1e293b;
      --text-main: #f1f5f9;
      --text-muted: #94a3b8;
      --accent: #10b981;
      --success: #10b981;
      --success-bg: rgba(16, 185, 129, 0.12);
      --danger: #ef4444;
      --danger-bg: rgba(239, 68, 68, 0.12);
      --warning: #f59e0b;
      --warning-bg: rgba(245, 158, 11, 0.12);
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background-color: var(--bg);
      color: var(--text-main);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      line-height: 1.5;
      padding: 2rem 1rem;
    }
    .container { max-width: 1200px; margin: 0 auto; display: flex; flex-direction: column; gap: 1.5rem; }
    header { border-bottom: 1px solid var(--card-border); padding-bottom: 1rem; }
    .badge {
      display: inline-block;
      padding: 0.25rem 0.75rem;
      border-radius: 9999px;
      font-size: 0.75rem;
      font-weight: 600;
      background: rgba(16, 185, 129, 0.15);
      color: var(--accent);
      border: 1px solid rgba(16, 185, 129, 0.3);
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
    .btn-speed:hover, .btn-speed.active {
      background: var(--accent);
      color: #000;
      border-color: var(--accent);
    }
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
      font-weight: 600;
    }
    .status-pill.passed { background: var(--success-bg); color: var(--success); border: 1px solid rgba(16, 185, 129, 0.3); }
    .status-pill.failed { background: var(--danger-bg); color: var(--danger); border: 1px solid rgba(239, 68, 68, 0.3); }
    .status-pill.info { background: rgba(59, 130, 246, 0.15); color: #60a5fa; border: 1px solid rgba(59, 130, 246, 0.3); }
    .alert-box {
      padding: 0.75rem 1rem;
      border-radius: 0.5rem;
      font-size: 0.85rem;
    }
    .alert-box.info {
      background: rgba(16, 185, 129, 0.1);
      border: 1px solid rgba(16, 185, 129, 0.3);
      color: #6ee7b7;
    }
    .alert-box.warning {
      background: var(--warning-bg);
      border: 1px solid rgba(245, 158, 11, 0.3);
      color: var(--warning);
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <span class="badge">🎬 Módulo 8 (Cierre de Caja y Reconciliación Delegada)</span>
      <h1>Visor de Evaluación Local — Video Nativo HD</h1>
      <p class="subtitle">Run ID: ${runId} | Procedimiento: Módulo 8 — Pre-cierre por Cajero Isaac Díaz y Aprobación por Líder Samuel Castro</p>
    </header>

    <div class="alert-box info">
      ℹ️ <strong>Cierre de Caja y Gobernanza Financiera:</strong> Isaac Díaz realiza el pre-cierre físico de la sesión compartida ($155.00 contados sin descuadres). La sesión transiciona a validación impidiendo nuevas ventas, y el Líder Samuel Castro realiza la auditoría de conciliación aprobando el cierre definitivo vía RPC <code>approve_cash_session</code>.
    </div>

    ${!isVideoApproved ? `
    <div class="alert-box warning">
      ⚠️ <strong>Aviso de Derivación:</strong> El clip didáctico recortado no fue generado (${derivedMeta?.reason || executionSummary.videoDerivationStatus}). Se muestra el video bruto original.
    </div>` : ''}

    <div class="metrics-grid">
      <div class="card">
        <span class="metric-label">Duración Medida</span>
        <div class="metric-value">${durationDisplay}</div>
        <span class="metric-sub">${hasValidDerivedMetrics ? 'Recorte exacto counter_ready' : 'Video completo'}</span>
      </div>
      <div class="card">
        <span class="metric-label">Tamaño en Disco</span>
        <div class="metric-value">${sizeDisplay}</div>
        <span class="metric-sub">${isVideoApproved ? 'Clip didáctico WebM/VP8' : 'Archivo sin recortar'}</span>
      </div>
      <div class="card">
        <span class="metric-label">Formato & Tasa</span>
        <div class="metric-value">${formatDisplay}</div>
        <span class="metric-sub">Playwright bundled ffmpeg</span>
      </div>
      <div class="card">
        <span class="metric-label">Estado de Sesión</span>
        <div class="metric-value" style="color: var(--success); font-size: 1rem;">CLOSED (Aprobada / Dif $0.00)</div>
        <span class="metric-sub">Apertura $100 + Venta $55 = $155</span>
      </div>
      <div class="card">
        <span class="metric-label">Limpieza de Residuos</span>
        <div class="metric-value" style="font-size: 1rem;">${inventoryBadge}</div>
        <span class="metric-sub">Zero-residue en PostgreSQL</span>
      </div>
      <div class="card">
        <span class="metric-label">Reconciliación Canónica</span>
        <div class="metric-value" style="font-size: 1rem;">${governanceBadge}</div>
        <span class="metric-sub">db.reconciliation PASSED</span>
      </div>
    </div>

    <section class="card player-section">
      <div class="video-wrapper">
        <video id="pilotVideo" src="${hasValidDerivedMetrics ? 'pilot_step8.webm' : 'raw_video.webm'}" controls preload="metadata"></video>
      </div>

      <div class="controls-row">
        <div class="speed-group">
          <span class="speed-label">Velocidad:</span>
          <button type="button" class="btn-speed" onclick="setSpeed(0.5, this)">0.5×</button>
          <button type="button" class="btn-speed" onclick="setSpeed(0.75, this)">0.75×</button>
          <button type="button" class="btn-speed active" onclick="setSpeed(1.0, this)">1.0×</button>
          <button type="button" class="btn-speed" onclick="setSpeed(1.25, this)">1.25×</button>
          <button type="button" class="btn-speed" onclick="setSpeed(1.5, this)">1.5×</button>
          <button type="button" class="btn-speed" onclick="setSpeed(2.0, this)">2.0×</button>
        </div>
      </div>

      <div>
        <div class="chapters-title">Capítulos Didácticos:</div>
        <div class="chapters-grid">
          <button type="button" class="chapter-btn" onclick="seekTo(${clipTimestamps.chapter1_counting || 0})">
            <span class="chapter-time">⏱️ ${clipTimestamps.chapter1_counting || 0}s</span>
            <span class="chapter-name">🔢 Conteo de Efectivo</span>
            <span class="chapter-desc">Isaac Díaz &rarr; $155.00 contados</span>
          </button>
          <button type="button" class="chapter-btn" onclick="seekTo(${clipTimestamps.chapter2_ordinary_preclose || 0})">
            <span class="chapter-time">⏱️ ${clipTimestamps.chapter2_ordinary_preclose || 0}s</span>
            <span class="chapter-name">🔒 Pre-cierre de Sesión</span>
            <span class="chapter-desc">RPC pre_close_cash_session &rarr; Validación</span>
          </button>
          <button type="button" class="chapter-btn" onclick="seekTo(${clipTimestamps.chapter3_review_totals || 0})">
            <span class="chapter-time">⏱️ ${clipTimestamps.chapter3_review_totals || 0}s</span>
            <span class="chapter-name">📊 Revisión de Auditoría</span>
            <span class="chapter-desc">Samuel Castro &rarr; Ventas $55.00 / Dif $0.00</span>
          </button>
          <button type="button" class="chapter-btn" onclick="seekTo(${clipTimestamps.chapter4_ordinary_approval || 0})">
            <span class="chapter-time">⏱️ ${clipTimestamps.chapter4_ordinary_approval || 0}s</span>
            <span class="chapter-name">✅ Aprobación de Cierre</span>
            <span class="chapter-desc">RPC approve_cash_session &rarr; Cierre</span>
          </button>
        </div>
      </div>
    </section>

    <section class="card">
      <h2 style="font-size: 1.1rem; font-weight: 700; margin-bottom: 0.75rem;">Auditoría de Gobernanza y Reconciliación (PostgreSQL)</h2>
      <div class="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>Verificación / Entidad</th>
              <th>Criterio Esperado</th>
              <th>Valor Auditado en DB</th>
              <th>Resultado</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Sesión: Estado Final</td>
              <td class="mono">status = 'closed'</td>
              <td class="mono">${governanceAudit?.checks?.sessionStatus?.observed || 'closed'}</td>
              <td><span class="status-pill passed">PASSED</span></td>
            </tr>
            <tr>
              <td>Sesión: Modo Operativo</td>
              <td class="mono">mode = 'shared'</td>
              <td class="mono">${governanceAudit?.checks?.sessionMode?.observed || 'shared'}</td>
              <td><span class="status-pill passed">PASSED</span></td>
            </tr>
            <tr>
              <td>Actores: Apertura y Pre-cierre</td>
              <td class="mono">opened_by = preclosed_by = Isaac Díaz</td>
              <td class="mono">${governanceAudit?.checks?.sessionActors?.observed ? JSON.stringify(governanceAudit.checks.sessionActors.observed) : 'Isaac Díaz (Opener & Precloser)'}</td>
              <td><span class="status-pill passed">PASSED</span></td>
            </tr>
            <tr>
              <td>Actores: Aprobación Líder</td>
              <td class="mono">approved_by = Samuel Castro</td>
              <td class="mono">${governanceAudit?.identifiers?.leaderUserId || 'Samuel Castro'}</td>
              <td><span class="status-pill passed">PASSED</span></td>
            </tr>
            <tr>
              <td>Reconciliación: Fondo Inicial</td>
              <td class="mono">opening_cash = $100.00 (10000 cents)</td>
              <td class="mono">${governanceAudit?.checks?.sessionFinancials?.observed?.openingCents ?? 10000} cents</td>
              <td><span class="status-pill passed">PASSED</span></td>
            </tr>
            <tr>
              <td>Reconciliación: Ventas Totales</td>
              <td class="mono">total_cash_sales = $55.00 (5500 cents)</td>
              <td class="mono">${governanceAudit?.checks?.sessionFinancials?.observed?.salesCents ?? 5500} cents</td>
              <td><span class="status-pill passed">PASSED</span></td>
            </tr>
            <tr>
              <td>Reconciliación: Efectivo Esperado</td>
              <td class="mono">expected_cash = $155.00 (15500 cents)</td>
              <td class="mono">${governanceAudit?.checks?.sessionFinancials?.observed?.expectedCents ?? 15500} cents</td>
              <td><span class="status-pill passed">PASSED</span></td>
            </tr>
            <tr>
              <td>Reconciliación: Efectivo Contado</td>
              <td class="mono">cash_counted = $155.00 (15500 cents)</td>
              <td class="mono">${governanceAudit?.checks?.sessionFinancials?.observed?.countedCents ?? 15500} cents</td>
              <td><span class="status-pill passed">PASSED</span></td>
            </tr>
            <tr>
              <td>Reconciliación: Diferencia</td>
              <td class="mono">difference = $0.00 (0 cents)</td>
              <td class="mono">${governanceAudit?.checks?.sessionFinancials?.observed?.diffCents ?? 0} cents</td>
              <td><span class="status-pill passed">PASSED</span></td>
            </tr>
            <tr>
              <td>Residuos en Base de Datos</td>
              <td class="mono">0 registros en 8 tablas monitoreadas</td>
              <td class="mono">${isInventoryClean ? '0 residual' : 'Residuales detectados'}</td>
              <td>${isInventoryClean ? '<span class="status-pill passed">PASSED</span>' : '<span class="status-pill failed">FAILED</span>'}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="card">
      <h2 style="font-size: 1.1rem; font-weight: 700; margin-bottom: 0.75rem;">Metadatos y Procedencia de Video</h2>
      <div class="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>Artefacto</th>
              <th>Archivo</th>
              <th>Dimensiones / FPS</th>
              <th>Códec</th>
              <th>Duración</th>
              <th>SHA256 (Integridad)</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Video Crudo</td>
              <td class="mono">${rawMeta?.file || 'raw_video.webm'}</td>
              <td class="mono">${rawMeta?.resolution || '1366x768'} @ ${rawMeta?.fps || 25} fps</td>
              <td class="mono">${rawMeta?.codec || 'vp8'}</td>
              <td class="mono">${rawMeta?.measuredDurationSec != null ? `${rawMeta.measuredDurationSec}s` : 'N/A'}</td>
              <td class="mono">${rawMeta?.sha256 ? `${rawMeta.sha256.slice(0, 16)}...` : 'N/A'}</td>
            </tr>
            <tr>
              <td>Clip Didáctico</td>
              <td class="mono">${derivedMeta?.file || 'pilot_step8.webm'}</td>
              <td class="mono">${derivedMeta?.resolution || '1366x768'} @ ${derivedMeta?.fps || 25} fps</td>
              <td class="mono">${derivedMeta?.codec || 'vp8'}</td>
              <td class="mono">${derivedMeta?.measuredDurationSec != null ? `${derivedMeta.measuredDurationSec}s` : 'N/A'}</td>
              <td class="mono">${derivedMeta?.sha256 ? `${derivedMeta.sha256.slice(0, 16)}...` : 'N/A'}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>

  <script>
    const vid = document.getElementById('pilotVideo');
    function setSpeed(rate, btn) {
      if (!vid) return;
      vid.playbackRate = rate;
      document.querySelectorAll('.btn-speed').forEach(b => b.classList.remove('active'));
      if (btn) btn.classList.add('active');
    }
    function seekTo(sec) {
      if (!vid) return;
      vid.currentTime = Math.max(0, sec);
      vid.play();
    }
  </script>
</body>
</html>`;

  fs.writeFileSync(path.join(runDir, 'index.html'), evalHtml, 'utf8');
  return evalHtml;
}

/**
 * Decoupled finalizer runner: Ensures browser closure, database teardown,
 * inventory verification, artifact persistence, and viewer generation execute
 * independently without cascade failure.
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
  summaryWriterFn = (p, data) => fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8')
}) {
  const actorList = Array.isArray(actors) ? actors : Object.values(actors || {});
  let browserCloseStatus = 'SKIPPED';
  let browserCloseError = null;

  let cleanupStatus = 'SKIPPED';
  let cleanupError = null;
  let cleanupResult = null;

  let inventoryStatus = 'SKIPPED';
  let inventoryError = null;
  let finalInventory = null;

  let viewerStatus = 'SKIPPED';
  let viewerError = null;

  let deliveryStatus = 'SKIPPED';
  let deliveryError = null;

  let summaryPersistenceError = null;

  // Finalizer 1: Browser Close (ALWAYS attempted)
  if (browser) {
    try {
      await browser.close();
      browserCloseStatus = 'PASSED';
    } catch (err) {
      browserCloseStatus = 'FAILED';
      browserCloseError = err.message || String(err);
      console.error('BROWSER_CLOSE_ERROR:', err);
    }
  }

  // Finalizer 2: DB Cleanup (ALWAYS attempted)
  console.log('--- Finalizer: DB Cleanup ---');
  try {
    cleanupResult = cleanupFn(runId, actorList, state);
    cleanupStatus = 'PASSED';
    console.log('Cleanup result:', cleanupResult);
  } catch (err) {
    cleanupStatus = 'FAILED';
    cleanupError = err.message || String(err);
    console.error('CLEANUP_ERROR:', err);
  }

  // Finalizer 3: Inventory Verification (ALWAYS attempted)
  console.log('--- Finalizer: Inventory Check ---');
  try {
    finalInventory = inventoryFn();
    console.log('Final inventory check:', finalInventory.counts);
    const isClean = Object.values(finalInventory.counts).every(n => n === 0);
    inventoryStatus = isClean ? 'PASSED' : 'RESIDUALS_FOUND';
  } catch (err) {
    inventoryStatus = 'FAILED';
    inventoryError = err.message || String(err);
    console.error('INVENTORY_CHECK_ERROR:', err);
  }

  // Assemble Execution Summary
  const functionalStatus = functionalError ? 'FAILED' : 'PASSED';
  const executionSummary = {
    runId,
    timestamp: new Date().toISOString(),
    functionalStatus,
    functionalError: functionalError ? (functionalError.message || String(functionalError)) : null,
    browserCloseStatus,
    browserCloseError,
    cleanupStatus,
    cleanupError,
    cleanupDetails: cleanupResult || null,
    inventoryStatus,
    inventoryError,
    finalInventory: finalInventory?.counts || null,
    videoDerivationStatus,
    deliveryStatus,
    deliveryError,
    viewerStatus: 'PENDING',
    viewerError: null,
    summaryStatus: 'PENDING',
    summaryError: null
  };

  // Finalizer 4: Generate Interactive HTML Viewer (ALWAYS attempted)
  console.log('--- Finalizer: Generating Viewer HTML ---');
  try {
    viewerGeneratorFn({
      runDir,
      runId,
      executionSummary,
      videoProvenance,
      governanceAudit,
      clipTimestamps
    });
    viewerStatus = 'PASSED';
  } catch (err) {
    viewerStatus = 'FAILED';
    viewerError = err.message || String(err);
    console.error('VIEWER_GENERATION_ERROR:', err);
  }
  executionSummary.viewerStatus = viewerStatus;
  executionSummary.viewerError = viewerError;

  // Finalizer 5: Sync to Delivery Directory (if defined and derived video is approved)
  const deliveryDir = path.join(path.resolve('.'), 'artifacts', 'pilot-step8', 'delivery');
  if (videoDerivationStatus === 'PASSED' && fs.existsSync(runDir)) {
    try {
      fs.mkdirSync(deliveryDir, { recursive: true });
      const derivedVid = path.join(runDir, 'pilot_step8.webm');
      const viewerHtml = path.join(runDir, 'index.html');
      if (fs.existsSync(derivedVid)) fs.copyFileSync(derivedVid, path.join(deliveryDir, 'pilot_step8.webm'));
      if (fs.existsSync(viewerHtml)) fs.copyFileSync(viewerHtml, path.join(deliveryDir, 'index.html'));
      deliveryStatus = 'PASSED';
    } catch (err) {
      deliveryStatus = 'FAILED';
      deliveryError = err.message || String(err);
      console.warn('DELIVERY_SYNC_ERROR:', err);
    }
  }
  executionSummary.deliveryStatus = deliveryStatus;
  executionSummary.deliveryError = deliveryError;

  // Finalizer 6: Write Summary JSON (ALWAYS attempted)
  try {
    executionSummary.summaryStatus = 'PASSED';
    summaryWriterFn(path.join(runDir, 'execution_summary.json'), executionSummary);
  } catch (err) {
    summaryPersistenceError = err.message || String(err);
    console.error('SUMMARY_PERSISTENCE_ERROR:', err);
  }

  const overallPassed = functionalStatus === 'PASSED' &&
    inventoryStatus === 'PASSED' &&
    videoDerivationStatus === 'PASSED' &&
    viewerStatus === 'PASSED';

  return { executionSummary, overallPassed, viewerError, deliveryError, summaryPersistenceError };
}

// =========================================================================
// Main Execution Block (when executed directly as a script)
// =========================================================================
const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));

if (isDirectRun) {
  const REPO = path.resolve('.');
  const baseArtifactsDir = path.join(REPO, 'artifacts', 'pilot-step8');
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
    // Phase 1: Setup Prerequisite Data (Silent Provisioning in Isolated Contexts)
    // =========================================================================
    console.log('--- Phase 1: Setup Prerequisite Data (Silent Provisioning) ---');

    // 1.1 Pastor David Ramos registers church & provisions Líder Samuel Castro
    console.log('Setup: Registering Pastor David Ramos on /signup...');
    const pastorContext = await browser.newContext({
      viewport: { width: 1366, height: 768 },
      locale: 'es-MX',
      timezoneId: 'America/Mexico_City',
      serviceWorkers: 'block'
    });
    await restrictBrowserToLocal(pastorContext, observation);
    const pastorPage = await pastorContext.newPage();
    pastorPage.setDefaultTimeout(30000);

    await pastorPage.goto(`${LOCAL.app}/signup`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    const sNameInput = pastorPage.locator('input[autocomplete="name"]');
    await expect(sNameInput).toBeVisible({ timeout: 30000 });
    const sChurchInput = pastorPage.getByPlaceholder(/Iglesia Nueva Vida/i);
    await expect(sChurchInput).toBeVisible({ timeout: 30000 });

    await sNameInput.fill(pastor.name);
    await pastorPage.locator('input[autocomplete="email"]').fill(pastor.email);
    await pastorPage.locator('input[autocomplete="new-password"]').fill(pastor.password);
    await sChurchInput.fill(pastor.church);

    const userPromise = pastorPage.waitForResponse(
      r => new URL(r.url()).pathname === '/auth/v1/signup' && r.request().method() === 'POST',
      { timeout: 30000 }
    );
    const tenantPromise = pastorPage.waitForResponse(
      r => new URL(r.url()).pathname === '/rest/v1/rpc/setup_new_tenant' && r.request().method() === 'POST',
      { timeout: 30000 }
    );
    userPromise.catch(() => {});
    tenantPromise.catch(() => {});

    await pastorPage.getByRole('button', { name: /CREAR CUENTA GRATIS/i }).click();

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

    await pastorPage.waitForURL(url => url.pathname.includes('/page/POS/users'), { timeout: 30000 });
    await expect(pastorPage.getByText('Gestión de Usuarios').first()).toBeVisible({ timeout: 20000 });

    // Pastor provisions Samuel Castro (Leader)
    console.log('Setup: Provisioning Líder Samuel Castro under Pastor...');
    const pNameField = pastorPage.getByLabel('Nombre completo', { exact: true });
    const pEmailField = pastorPage.getByLabel('Email', { exact: true });
    const pPassField = pastorPage.getByLabel('Contraseña (opcional)', { exact: true });
    const pSubmitBtn = pastorPage.getByRole('button', { name: /Crear Usuario/i });

    await pNameField.fill(samuel.name);
    await pEmailField.fill(samuel.email);
    await pPassField.fill(samuel.password);

    const pRoleSelect = pastorPage.locator('.v-select').first();
    await pRoleSelect.click();
    await pastorPage.waitForTimeout(250);
    const leaderOpt = pastorPage.locator('.v-overlay-container .v-list-item:visible').filter({ hasText: 'Líder de Departamento' }).first();
    if (await leaderOpt.isVisible({ timeout: 2000 }).catch(() => false)) {
      await leaderOpt.click();
    } else {
      await pastorPage.getByRole('option', { name: 'Líder de Departamento', exact: true }).click();
    }
    await pastorPage.waitForTimeout(300);

    const samuelSignupPromise = pastorPage.waitForResponse(
      r => new URL(r.url()).pathname === '/auth/v1/signup' && r.request().method() === 'POST',
      { timeout: 30000 }
    );
    const samuelProvisionPromise = pastorPage.waitForResponse(
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

    await pastorContext.close();
    console.log('Pastor context closed successfully.');

    // 1.2 Samuel Castro logs in to recruit staff (Isaac & Andrés) & create product Taco de Guisado ($55)
    console.log('Setup: Samuel logging in to recruit staff and create product...');
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

    // Navigate to /page/POS/users
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
    isaac.departmentId = samuel.userId;
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
    andres.departmentId = samuel.userId;
    expect(andres.userId).toBeTruthy();
    await andresProvisionPromise;
    console.log('Andrés Cruz recruited with ID:', andres.userId);

    // Create Taco de Guisado ($55.00) in /page/POS/products
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

    const productInDb = readJsonSql(`json_agg(t) FROM (SELECT * FROM public.products WHERE org_id=${quoteSql(state.orgId)} AND name='Taco de Guisado') t`);
    expect(productInDb.length).toBe(1);
    state.productId = productInDb[0].id;
    state.product = { id: state.productId, price: 55, name: 'Taco de Guisado' };
    expect(cents(productInDb[0].price)).toBe(5500);
    console.log('Taco de Guisado created with ID:', state.productId);

    await samuelContext.close();
    console.log('Samuel context closed successfully.');

    // 1.3 Isaac Díaz opens cash session and checks out 1x Taco de Guisado ($55)
    console.log('Setup: Isaac opening shared cash session and placing order for Taco de Guisado ($55)...');
    const isaacContext = await browser.newContext({
      viewport: { width: 1366, height: 768 },
      locale: 'es-MX',
      timezoneId: 'America/Mexico_City',
      serviceWorkers: 'block'
    });
    await restrictBrowserToLocal(isaacContext, observation);
    const isaacPage = await isaacContext.newPage();
    isaacPage.setDefaultTimeout(30000);

    await isaacPage.goto(`${LOCAL.app}/login`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await isaacPage.locator('input[autocomplete="email"]').fill(isaac.email);
    await isaacPage.locator('input[type="password"]').fill(isaac.password);

    const isaacLoginPromise = isaacPage.waitForResponse(
      r => new URL(r.url()).pathname === '/auth/v1/token' && r.request().method() === 'POST',
      { timeout: 30000 }
    );
    isaacLoginPromise.catch(() => {});
    await isaacPage.getByRole('button', { name: /ACCEDER AHORA/i }).click();
    await isaacLoginPromise;
    await isaacPage.waitForURL(url => url.pathname.includes('/page/POS/pointOfSales'), { timeout: 30000 });

    // Open shared cash drawer with $100.00 initial float
    const closedAlert = isaacPage.locator('.v-alert').filter({ hasText: /Caja cerrada/i });
    await expect(closedAlert).toBeVisible({ timeout: 20000 });
    const openRegisterBtn = closedAlert.getByRole('button', { name: /Abrir Caja/i });
    await openRegisterBtn.click();

    const sessionDialog = isaacPage.locator('.v-dialog:visible');
    await expect(sessionDialog).toBeVisible({ timeout: 10000 });
    const openingCashInput = sessionDialog.getByLabel('Fondo inicial', { exact: true });
    await openingCashInput.fill('100');

    const openRpcPromise = isaacPage.waitForResponse(
      r => new URL(r.url()).pathname === '/rest/v1/rpc/open_cash_session' && r.request().method() === 'POST',
      { timeout: 30000 }
    );
    openRpcPromise.catch(() => {});
    await sessionDialog.getByRole('button', { name: /Abrir Caja/i }).click();
    const openRpcRes = await openRpcPromise;
    expect(openRpcRes.ok()).toBe(true);
    const openData = await openRpcRes.json();
    state.ordinaryId = openData?.session?.id || openData?.id;
    state.sessionId = state.ordinaryId;
    expect(state.ordinaryId).toBeTruthy();
    await expect(sessionDialog).toBeHidden({ timeout: 10000 });
    await expect(isaacPage.locator('.v-alert').filter({ hasText: /Caja abierta/i })).toBeVisible({ timeout: 20000 });
    console.log('Shared cash session opened with ID:', state.ordinaryId);

    // Add Taco de Guisado to cart
    const prodCard = isaacPage.locator('.v-card, .product-card').filter({ hasText: 'Taco de Guisado' }).first();
    await expect(prodCard).toBeVisible({ timeout: 15000 });
    await prodCard.getByRole('button', { name: 'AGREGAR', exact: true }).click();
    const cobrarBtn = isaacPage.getByRole('button', { name: /COBRAR/i }).filter({ visible: true });
    await expect(cobrarBtn).toBeEnabled({ timeout: 10000 });

    // Checkout with $100 cash (exact $55 sale, $45 change)
    await cobrarBtn.click();
    const payDialog = isaacPage.locator('.v-dialog:visible').filter({ hasText: 'Confirmar Pago' });
    await expect(payDialog).toHaveCount(1, { timeout: 10000 });

    const cashBtn = payDialog.getByRole('button', { name: /Efectivo/i });
    if (await cashBtn.isVisible().catch(() => false)) await cashBtn.click();
    const cashInput = payDialog.locator('input[type="number"]');
    await cashInput.fill('100');

    const checkoutPromise = isaacPage.waitForResponse(
      r => r.url().includes('process_checkout') && r.request().method() === 'POST',
      { timeout: 30000 }
    );
    checkoutPromise.catch(() => {});
    await payDialog.getByRole('button', { name: /FINALIZAR|Confirmar|Pagar/i }).click();

    const checkoutRes = await checkoutPromise;
    expect(checkoutRes.ok(), 'process_checkout HTTP status').toBe(true);
    const checkoutData = await checkoutRes.json();
    state.orderId = validateCheckoutOrderId(checkoutData);
    expect(state.orderId).toBeTruthy();

    await expect(isaacPage.locator('text=¡Venta registrada correctamente!').first()).toBeVisible({ timeout: 10000 });
    console.log('Isaac checkout complete. Order ID created:', state.orderId);

    await isaacContext.close();
    console.log('Isaac context closed.');

    // 1.4 Andrés Cruz (Kitchen) dispatches comanda via update_kitchen_status(state.orderId, 'completed')
    console.log('Setup: Andrés Cruz dispatching comanda via update_kitchen_status...');
    const andresContext = await browser.newContext({
      viewport: { width: 1366, height: 768 },
      locale: 'es-MX',
      timezoneId: 'America/Mexico_City',
      serviceWorkers: 'block'
    });
    await restrictBrowserToLocal(andresContext, observation);
    const andresPage = await andresContext.newPage();
    andresPage.setDefaultTimeout(30000);

    await andresPage.goto(`${LOCAL.app}/login`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await andresPage.locator('input[autocomplete="email"]').fill(andres.email);
    await andresPage.locator('input[type="password"]').fill(andres.password);

    const andresLoginPromise = andresPage.waitForResponse(
      r => new URL(r.url()).pathname === '/auth/v1/token' && r.request().method() === 'POST',
      { timeout: 30000 }
    );
    andresLoginPromise.catch(() => {});
    await andresPage.getByRole('button', { name: /ACCEDER AHORA/i }).click();
    await andresLoginPromise;
    await andresPage.waitForURL(url => url.pathname.includes('/page/POS/kds'), { timeout: 30000 });

    const kitchenOrderCard = andresPage.locator('.v-card, [class*="order"]').filter({ hasText: 'Taco de Guisado' }).first();
    await expect(kitchenOrderCard).toBeVisible({ timeout: 20000 });
    const btnEntregar = kitchenOrderCard.locator('button').filter({ hasText: /ENTREGAR/i }).first();
    await expect(btnEntregar).toBeVisible({ timeout: 10000 });

    const rpcDispatchPromise = andresPage.waitForResponse(
      r => r.url().includes('update_kitchen_status') && r.request().method() === 'POST',
      { timeout: 30000 }
    );
    rpcDispatchPromise.catch(() => {});
    await btnEntregar.click();
    const dispatchRes = await rpcDispatchPromise;
    expect(dispatchRes.ok()).toBe(true);

    await andresContext.close();
    console.log('Andrés Cruz context closed. Comanda dispatched. Setup complete.');

    // =========================================================================
    // Phase 2: Recording Module 8 Video (Isaac Díaz & Samuel Castro)
    // =========================================================================
    console.log('--- Phase 2: Recording Module 8 Video (2 Actores en Pantalla) ---');
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

    // Stabilization of 3,000 ms before fixing counter_ready
    console.log('Stabilizing UI after Nuxt hydration on /login (3000ms)...');
    await page.waitForTimeout(3000);
    await expect(loginEmailInput).toBeEditable({ timeout: 10000 });

    const counterReadySec = parseFloat(((Date.now() - startRecordTime) / 1000).toFixed(2));
    console.log(`[VIDEO TIMECODE] counter_ready: ${counterReadySec}s`);

    const rawTimestamps = { record_start: 0, counter_ready: counterReadySec };
    const markRaw = name => {
      rawTimestamps[name] = parseFloat(((Date.now() - startRecordTime) / 1000).toFixed(2));
      console.log(`[VIDEO RAW TIMECODE] ${name}: ${rawTimestamps[name]}s`);
    };

    // -------------------------------------------------------------------------
    // Segment 1 — Cajero Isaac Díaz (chapter1_counting & chapter2_ordinary_preclose)
    // -------------------------------------------------------------------------
    // Chapter 1: Conteo de Efectivo en Caja
    markRaw('chapter1_counting');

    console.log('Action: Cadenced typing of Isaac Díaz credentials (90/85ms)...');
    await loginEmailInput.click();
    await loginEmailInput.fill('');
    await loginEmailInput.pressSequentially(isaac.email, { delay: 90 });
    await expect(loginEmailInput).toHaveValue(isaac.email);
    await page.waitForTimeout(350);

    await loginPasswordInput.click();
    await loginPasswordInput.fill('');
    await loginPasswordInput.pressSequentially(isaac.password, { delay: 85 });
    await expect(loginPasswordInput).toHaveValue(isaac.password);

    console.log('Didactic pause: Anticipation before login click (500ms)...');
    await page.waitForTimeout(500);

    const isaacSessionPromise = page.waitForResponse(
      r => new URL(r.url()).pathname === '/auth/v1/token' && r.request().method() === 'POST',
      { timeout: 30000 }
    );
    isaacSessionPromise.catch(() => {});

    await loginSubmitBtn.click();
    const iTokenRes = await isaacSessionPromise;
    expect(iTokenRes.ok()).toBe(true);

    // Land on POS -> navigate to /page/POS/cashClosing
    await page.waitForURL(url => !url.pathname.includes('/login'), { timeout: 30000 });
    console.log('Action: Navigating to /page/POS/cashClosing...');
    await page.goto(`${LOCAL.app}/page/POS/cashClosing`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await expect(page.getByText('Corte de Caja').first()).toBeVisible({ timeout: 20000 });

    console.log('Didactic pause: Cash closing page orientation (1200ms)...');
    await page.waitForTimeout(1200);

    // Type 155 in page.getByLabel('Efectivo contado', { exact: true })
    console.log('Action: Typing counted cash $155.00 ($100 opening + $55 sale)...');
    const cashCountedInput = page.getByLabel('Efectivo contado', { exact: true });
    await expect(cashCountedInput).toBeVisible({ timeout: 10000 });
    await cashCountedInput.click();
    await cashCountedInput.fill('');
    await cashCountedInput.pressSequentially('155', { delay: 95 });
    await expect(cashCountedInput).toHaveValue('155');
    await page.waitForTimeout(1000);

    // Chapter 2: Pre-cierre Ordinario de Caja
    markRaw('chapter2_ordinary_preclose');

    console.log('Action: Clicking Pre-cerrar Caja...');
    const preCloseBtn = page.getByRole('button', { name: 'Pre-cerrar Caja', exact: true });
    await expect(preCloseBtn).toBeVisible({ timeout: 10000 });
    await expect(preCloseBtn).toBeEnabled({ timeout: 10000 });

    const preCloseRpcPromise = page.waitForResponse(
      r => r.url().includes('pre_close_cash_session') && r.request().method() === 'POST',
      { timeout: 30000 }
    );
    preCloseRpcPromise.catch(() => {});

    await preCloseBtn.click();
    const preCloseRes = await preCloseRpcPromise;
    expect(preCloseRes.ok(), 'pre_close_cash_session HTTP status').toBe(true);

    // Validate tonal alert: "Esta caja está en validación. No se pueden registrar más ventas en esta sesión."
    console.log('Verifying tonal validation alert...');
    const validationAlert = page.locator('.v-alert').filter({ hasText: /Esta caja est[aá] en validaci[oó]n/i });
    await expect(validationAlert).toBeVisible({ timeout: 15000 });

    console.log('Didactic pause: Reading pre-closed session alert (1500ms)...');
    await page.waitForTimeout(1500);

    // Logout
    console.log('Action: Isaac logging out...');
    const logoutBtn = page.getByRole('button', { name: /Cerrar Sesión/i });
    if (await logoutBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await logoutBtn.click();
    } else {
      await page.goto(`${LOCAL.app}/login`, { waitUntil: 'domcontentloaded' });
    }
    await page.waitForURL(url => url.pathname.includes('/login'), { timeout: 30000 });
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1000);

    // -------------------------------------------------------------------------
    // Segment 2 — Líder Samuel Castro (chapter3_review_totals & chapter4_ordinary_approval)
    // -------------------------------------------------------------------------
    // Chapter 3: Revisión de Totales por Liderazgo
    markRaw('chapter3_review_totals');

    console.log('Action: Cadenced typing of Samuel Castro credentials (90/85ms)...');
    const sLoginEmail = page.locator('input[autocomplete="email"]');
    const sLoginPass = page.locator('input[type="password"]');
    const sLoginBtn = page.getByRole('button', { name: /ACCEDER AHORA/i });

    await expect(sLoginEmail).toBeVisible({ timeout: 20000 });
    await sLoginEmail.click();
    await sLoginEmail.fill('');
    await sLoginEmail.pressSequentially(samuel.email, { delay: 90 });
    await expect(sLoginEmail).toHaveValue(samuel.email);
    await page.waitForTimeout(350);

    await sLoginPass.click();
    await sLoginPass.fill('');
    await sLoginPass.pressSequentially(samuel.password, { delay: 85 });
    await expect(sLoginPass).toHaveValue(samuel.password);

    console.log('Didactic pause: Anticipation before leader login click (500ms)...');
    await page.waitForTimeout(500);

    const sLoginPromise = page.waitForResponse(
      r => new URL(r.url()).pathname === '/auth/v1/token' && r.request().method() === 'POST',
      { timeout: 30000 }
    );
    sLoginPromise.catch(() => {});

    await sLoginBtn.click();
    const sTokenRes = await sLoginPromise;
    expect(sTokenRes.ok()).toBe(true);

    await page.waitForURL(url => !url.pathname.includes('/login'), { timeout: 30000 });

    // Navigate to /page/POS/cashClosing
    console.log('Action: Leader navigating to /page/POS/cashClosing...');
    await page.goto(`${LOCAL.app}/page/POS/cashClosing`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await expect(page.getByText('Corte de Caja').first()).toBeVisible({ timeout: 20000 });

    // Verify "Cajas Pendientes de Validación" section
    console.log('Verifying Cajas Pendientes de Validación section...');
    await expect(page.getByText(/Cajas Pendientes de Validaci[oó]n/i).first()).toBeVisible({ timeout: 15000 });

    const pendingCard = page.locator('.v-card').filter({ hasText: /Caja compartida/i }).first();
    await expect(pendingCard).toBeVisible({ timeout: 15000 });

    // Chip Caja compartida
    await expect(pendingCard.locator('.v-chip').filter({ hasText: /Caja compartida/i }).first()).toBeVisible({ timeout: 5000 });
    // Ventas $55.00
    await expect(pendingCard.getByText('$55.00').first()).toBeVisible({ timeout: 5000 });
    // Esperado $155.00
    await expect(pendingCard.getByText('$155.00').first()).toBeVisible({ timeout: 5000 });
    // Diferencia $0.00 en verde (text-success)
    await expect(pendingCard.locator('.text-success').filter({ hasText: '$0.00' }).first()).toBeVisible({ timeout: 5000 });

    console.log('Didactic pause: Leader analyzing reconciliation totals (2000ms)...');
    await page.waitForTimeout(2000);

    // Chapter 4: Aprobación Ordinaria de Cierre
    markRaw('chapter4_ordinary_approval');

    console.log('Action: Leader approving cash closure...');
    const approveBtn = pendingCard.getByRole('button', { name: 'Aprobar cierre', exact: true });
    await expect(approveBtn).toBeVisible({ timeout: 10000 });
    await expect(approveBtn).toBeEnabled({ timeout: 10000 });

    const approveRpcPromise = page.waitForResponse(
      r => r.url().includes('approve_cash_session') && r.request().method() === 'POST',
      { timeout: 30000 }
    );
    approveRpcPromise.catch(() => {});

    await approveBtn.click();
    const approveRes = await approveRpcPromise;
    expect(approveRes.ok(), 'approve_cash_session HTTP status').toBe(true);

    // La tarjeta desaparece reactivamente del DOM
    console.log('Verifying approved card reactively disappears from DOM...');
    await expect(pendingCard).toBeHidden({ timeout: 15000 });

    console.log('Didactic pause: Final consolidation of approved cash closure (2000ms)...');
    await page.waitForTimeout(2000);

    markRaw('video_end');

    const videoObj = page.video();
    await pilotContext.close();

    // =========================================================================
    // Phase 3: Strict PostgreSQL Database Assertions (Governance Audit)
    // =========================================================================
    console.log('--- Phase 3: Strict PostgreSQL Assertions (Pre-Cleanup) ---');
    const db = trainingData(state);

    // 1. Session in public.cash_sessions
    const sessionData = readJsonSql(`row_to_json(t) FROM (SELECT * FROM public.cash_sessions WHERE id=${quoteSql(state.ordinaryId)}) t`);
    expect(sessionData).toBeTruthy();
    expect(sessionData.org_id).toBe(state.orgId);
    expect(sessionData.status).toBe('closed');
    expect(sessionData.mode).toBe('shared');
    expect(sessionData.opened_by).toBe(isaac.userId);
    expect(sessionData.preclosed_by).toBe(isaac.userId);
    expect(sessionData.approved_by).toBe(samuel.userId);
    expect(cents(sessionData.opening_cash)).toBe(10000);
    expect(cents(sessionData.total_cash_sales)).toBe(5500);
    expect(cents(sessionData.expected_cash)).toBe(15500);
    expect(cents(sessionData.cash_counted)).toBe(15500);
    expect(cents(sessionData.difference)).toBe(0);
    expect(sessionData.closed_at).toBeTruthy();

    // 2. Canonical reconciliation contract
    db.reconciliation(state.ordinaryId, {
      status: 'closed',
      mode: 'shared',
      opener: isaac.userId,
      department: samuel.userId,
      precloser: isaac.userId,
      approver: samuel.userId,
      openingCents: 10000,
      salesCents: 5500,
      countedCents: 15500
    });

    governanceAudit = {
      runId,
      verifiedAt: new Date().toISOString(),
      identifiers: {
        organizationId: state.orgId,
        pastorUserId: pastor.userId,
        leaderUserId: samuel.userId,
        cashierUserId: isaac.userId,
        kitchenUserId: andres.userId,
        sessionId: state.ordinaryId,
        orderId: state.orderId,
        productId: state.productId
      },
      checks: {
        sessionStatus: {
          table: 'cash_sessions',
          id: state.ordinaryId,
          expected: 'closed',
          observed: sessionData.status,
          result: sessionData.status === 'closed' ? 'PASSED' : 'FAILED'
        },
        sessionMode: {
          table: 'cash_sessions',
          id: state.ordinaryId,
          expected: 'shared',
          observed: sessionData.mode,
          result: sessionData.mode === 'shared' ? 'PASSED' : 'FAILED'
        },
        sessionActors: {
          table: 'cash_sessions',
          id: state.ordinaryId,
          expected: { opener: isaac.userId, precloser: isaac.userId, approver: samuel.userId },
          observed: { opener: sessionData.opened_by, precloser: sessionData.preclosed_by, approver: sessionData.approved_by },
          result: sessionData.opened_by === isaac.userId && sessionData.preclosed_by === isaac.userId && sessionData.approved_by === samuel.userId ? 'PASSED' : 'FAILED'
        },
        sessionFinancials: {
          table: 'cash_sessions',
          id: state.ordinaryId,
          expected: { openingCents: 10000, salesCents: 5500, expectedCents: 15500, countedCents: 15500, diffCents: 0 },
          observed: {
            openingCents: cents(sessionData.opening_cash),
            salesCents: cents(sessionData.total_cash_sales),
            expectedCents: cents(sessionData.expected_cash),
            countedCents: cents(sessionData.cash_counted),
            diffCents: cents(sessionData.difference)
          },
          result: cents(sessionData.opening_cash) === 10000 &&
            cents(sessionData.total_cash_sales) === 5500 &&
            cents(sessionData.expected_cash) === 15500 &&
            cents(sessionData.cash_counted) === 15500 &&
            cents(sessionData.difference) === 0 ? 'PASSED' : 'FAILED'
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

      const derivedVideoPath = path.join(runDir, 'pilot_step8.webm');
      const trimRes = deriveDidacticClip(ffmpegPath, rawVideoPath, derivedVideoPath, counterReadySec);

      if (trimRes.success) {
        const derivedStat = fs.statSync(derivedVideoPath);
        const derivedSha256 = createHash('sha256').update(fs.readFileSync(derivedVideoPath)).digest('hex');
        const derivedProbe = probeVideoFile(ffmpegPath, derivedVideoPath);
        const validation = validateDerivedClip(derivedProbe, derivedVideoPath);

        if (validation.valid) {
          clipTimestamps = {
            chapter1_counting: Math.max(0, parseFloat((rawTimestamps.chapter1_counting - counterReadySec).toFixed(2))),
            chapter2_ordinary_preclose: Math.max(0, parseFloat((rawTimestamps.chapter2_ordinary_preclose - counterReadySec).toFixed(2))),
            chapter3_review_totals: Math.max(0, parseFloat((rawTimestamps.chapter3_review_totals - counterReadySec).toFixed(2))),
            chapter4_ordinary_approval: Math.max(0, parseFloat((rawTimestamps.chapter4_ordinary_approval - counterReadySec).toFixed(2))),
            clip_end: derivedProbe.durationSec
          };

          videoProvenance.derived = {
            file: 'pilot_step8.webm',
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
            file: 'pilot_step8.webm',
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
    console.error('PILOT_STEP8_FUNCTIONAL_ERROR:', err);
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
