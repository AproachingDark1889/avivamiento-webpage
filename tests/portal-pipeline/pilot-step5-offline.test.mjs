import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  validateCheckoutOrderId,
  probeVideoFile,
  deriveDidacticClip,
  validateDerivedClip,
  runFinalizers,
  generateViewerHtml,
  findPlaywrightFfmpeg
} from '../../scripts/pilot_step5.mjs';

test('1. validateCheckoutOrderId strictly validates positive safe integer identifiers without float loss', () => {
  // 1.1 Accept positive safe integer number
  assert.equal(validateCheckoutOrderId({ success: true, order_id: 12345 }), '12345');

  // 1.2 Accept positive decimal string representation
  assert.equal(validateCheckoutOrderId({ success: true, order_id: '9876543210' }), '9876543210');

  // 1.3 Reject zero (0 is not a valid DB order ID)
  assert.throws(
    () => validateCheckoutOrderId({ success: true, order_id: 0 }),
    /CHECKOUT_UNSAFE_OR_NON_POSITIVE_INTEGER/
  );
  assert.throws(
    () => validateCheckoutOrderId({ success: true, order_id: '0' }),
    /CHECKOUT_INVALID_ORDER_ID_FORMAT/
  );

  // 1.4 Reject arrays containing numbers (e.g. [123])
  assert.throws(
    () => validateCheckoutOrderId({ success: true, order_id: [123] }),
    /CHECKOUT_INVALID_ORDER_ID_TYPE/
  );

  // 1.5 Reject unsafe integers that suffer IEEE-754 float precision loss (Number.MAX_SAFE_INTEGER + 2)
  assert.throws(
    () => validateCheckoutOrderId({ success: true, order_id: 9007199254740993 }),
    /CHECKOUT_UNSAFE_OR_NON_POSITIVE_INTEGER/
  );

  // 1.6 Reject floats
  assert.throws(
    () => validateCheckoutOrderId({ success: true, order_id: 55.4 }),
    /CHECKOUT_UNSAFE_OR_NON_POSITIVE_INTEGER/
  );

  // 1.7 Reject negative numbers
  assert.throws(
    () => validateCheckoutOrderId({ success: true, order_id: -1 }),
    /CHECKOUT_UNSAFE_OR_NON_POSITIVE_INTEGER/
  );

  // 1.8 Reject strings with leading zeroes or non-numeric characters
  assert.throws(
    () => validateCheckoutOrderId({ success: true, order_id: '0123' }),
    /CHECKOUT_INVALID_ORDER_ID_FORMAT/
  );
  assert.throws(
    () => validateCheckoutOrderId({ success: true, order_id: 'order_uuid_xyz' }),
    /CHECKOUT_INVALID_ORDER_ID_FORMAT/
  );

  // 1.9 Reject success === false or missing
  assert.throws(
    () => validateCheckoutOrderId({ success: false, order_id: 123 }),
    /CHECKOUT_FAILED/
  );
  assert.throws(
    () => validateCheckoutOrderId({ success: true, order_id: null }),
    /CHECKOUT_MISSING_ORDER_ID/
  );
  assert.throws(
    () => validateCheckoutOrderId([123]),
    /CHECKOUT_RESPONSE_INVALID/
  );
});

test('2. probeVideoFile accurately measures container metadata and handles invalid files cleanly', () => {
  const ffmpeg = findPlaywrightFfmpeg();
  assert.ok(ffmpeg, 'Playwright bundled ffmpeg must be discoverable');

  // 2.1 Measure existing pilot video file
  const videoPath = path.resolve('artifacts/pilot-step5/pilot_step5.webm');
  if (fs.existsSync(videoPath)) {
    const probe = probeVideoFile(ffmpeg, videoPath);
    assert.ok(probe, 'Probe must return metadata object');
    assert.equal(probe.durationSec, 10.52);
    assert.equal(probe.codec, 'vp8');
    assert.equal(probe.resolution, '1366x768');
    assert.equal(probe.fps, 25);
  }

  // 2.2 Handle non-existent file gracefully without throwing
  const nullProbe = probeVideoFile(ffmpeg, 'non/existent/path.webm');
  assert.equal(nullProbe, null);

  // 2.3 Handle null ffmpeg gracefully
  assert.equal(probeVideoFile(null, videoPath), null);
});

test('3. deriveDidacticClip fails safely when FFmpeg or input is missing without corrupting outputs', () => {
  // 3.1 Missing ffmpeg
  const resNullFfmpeg = deriveDidacticClip(null, 'some/raw.webm', 'some/derived.webm', 2.5);
  assert.equal(resNullFfmpeg.success, false);
  assert.equal(resNullFfmpeg.reason, 'FFMPEG_NOT_FOUND');

  // 3.2 Non-existent ffmpeg
  const resNonExistent = deriveDidacticClip('C:/non-existent-ffmpeg.exe', 'some/raw.webm', 'some/derived.webm', 2.5);
  assert.equal(resNonExistent.success, false);
  assert.equal(resNonExistent.reason, 'FFMPEG_NOT_FOUND');

  // 3.3 Missing raw video input
  const ffmpeg = findPlaywrightFfmpeg();
  const resMissingRaw = deriveDidacticClip(ffmpeg, 'non/existent/raw.webm', 'some/derived.webm', 2.5);
  assert.equal(resMissingRaw.success, false);
  assert.equal(resMissingRaw.reason, 'RAW_VIDEO_NOT_FOUND');
});

test('4. validateDerivedClip strictly enforces contract: 1366x768, 25 FPS, VP8 and finite positive metrics', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pilot-clip-contract-'));
  const testFile = path.join(tmpDir, 'test_clip.webm');
  fs.writeFileSync(testFile, 'dummy-video-content', 'utf8');

  // 4.1 Valid contract
  const validRes = validateDerivedClip({
    durationSec: 10.52,
    codec: 'vp8',
    resolution: '1366x768',
    fps: 25
  }, testFile);
  assert.equal(validRes.valid, true);

  // 4.2 Rejects non-contract resolution (e.g. 640x360)
  const wrongRes = validateDerivedClip({
    durationSec: 10.52,
    codec: 'vp8',
    resolution: '640x360',
    fps: 25
  }, testFile);
  assert.equal(wrongRes.valid, false);
  assert.match(wrongRes.reason, /INVALID_RESOLUTION/);

  // 4.3 Rejects non-contract FPS (e.g. 1 FPS)
  const wrongFps = validateDerivedClip({
    durationSec: 10.52,
    codec: 'vp8',
    resolution: '1366x768',
    fps: 1
  }, testFile);
  assert.equal(wrongFps.valid, false);
  assert.match(wrongFps.reason, /INVALID_FPS/);

  // 4.4 Rejects Infinity duration or FPS
  assert.equal(validateDerivedClip({ durationSec: Infinity, codec: 'vp8', resolution: '1366x768', fps: 25 }, testFile).valid, false);
  assert.equal(validateDerivedClip({ durationSec: 10.5, codec: 'vp8', resolution: '1366x768', fps: Infinity }, testFile).valid, false);

  // 4.5 Rejects non-vp8 codec (e.g. h264)
  assert.equal(validateDerivedClip({ durationSec: 10.5, codec: 'h264', resolution: '1366x768', fps: 25 }, testFile).valid, false);

  // 4.6 Rejects 0-byte empty file
  const emptyFile = path.join(tmpDir, 'empty.webm');
  fs.writeFileSync(emptyFile, Buffer.alloc(0));
  assert.equal(validateDerivedClip({ durationSec: 10.5, codec: 'vp8', resolution: '1366x768', fps: 25 }, emptyFile).valid, false);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('5. runFinalizers executes DB cleanup and inventory even if browser.close() throws', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pilot-test-browser-fail-'));
  let cleanupCalled = 0;
  let inventoryCalled = 0;

  const mockBrowser = {
    close: async () => {
      throw new Error('SIMULATED_BROWSER_CLOSE_CRASH');
    }
  };

  const { executionSummary, overallPassed } = await runFinalizers({
    browser: mockBrowser,
    runId: 'avc-training-test-run-browser-fail',
    actors: [],
    state: {},
    runDir: tmpDir,
    functionalError: null,
    videoDerivationStatus: 'PASSED',
    cleanupFn: () => {
      cleanupCalled++;
      return { status: 'passed', usersDeleted: 3, organizationsDeleted: 1 };
    },
    inventoryFn: () => {
      inventoryCalled++;
      return { counts: { orders: 0, profiles: 0 } };
    }
  });

  assert.equal(cleanupCalled, 1, 'Cleanup must be called exactly once');
  assert.equal(inventoryCalled, 1, 'Inventory check must be called exactly once');
  assert.equal(executionSummary.browserCloseStatus, 'FAILED');
  assert.equal(executionSummary.browserCloseError, 'SIMULATED_BROWSER_CLOSE_CRASH');
  assert.equal(executionSummary.cleanupStatus, 'PASSED');
  assert.equal(executionSummary.inventoryStatus, 'PASSED');
  assert.equal(overallPassed, false, 'Overall execution must report failure due to browser close crash');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('6. runFinalizers executes inventory check even if DB cleanup throws', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pilot-test-cleanup-fail-'));
  let inventoryCalled = 0;

  const { executionSummary, overallPassed } = await runFinalizers({
    browser: null,
    runId: 'avc-training-test-run-cleanup-fail',
    actors: [],
    state: {},
    runDir: tmpDir,
    functionalError: null,
    videoDerivationStatus: 'PASSED',
    cleanupFn: () => {
      throw new Error('SIMULATED_DB_CLEANUP_TIMEOUT');
    },
    inventoryFn: () => {
      inventoryCalled++;
      return { counts: { orders: 1, profiles: 2 } };
    }
  });

  assert.equal(inventoryCalled, 1, 'Inventory check must still be called after cleanup error');
  assert.equal(executionSummary.cleanupStatus, 'FAILED');
  assert.equal(executionSummary.cleanupError, 'SIMULATED_DB_CLEANUP_TIMEOUT');
  assert.equal(executionSummary.inventoryStatus, 'LEAK_DETECTED');
  assert.equal(overallPassed, false);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('7. runFinalizers detects inventory failure and residual leaks accurately', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pilot-test-inventory-leak-'));

  // 7.1 Case A: Inventory threw connection error
  const resA = await runFinalizers({
    browser: null,
    runId: 'avc-training-test-run-inv-a',
    actors: [],
    state: {},
    runDir: tmpDir,
    functionalError: null,
    videoDerivationStatus: 'PASSED',
    cleanupFn: () => ({ status: 'passed' }),
    inventoryFn: () => {
      throw new Error('SIMULATED_DB_DISCONNECTED');
    }
  });
  assert.equal(resA.executionSummary.inventoryStatus, 'FAILED');
  assert.equal(resA.executionSummary.inventoryError, 'SIMULATED_DB_DISCONNECTED');
  assert.equal(resA.overallPassed, false);

  // 7.2 Case B: Non-zero residuals in table counts
  const resB = await runFinalizers({
    browser: null,
    runId: 'avc-training-test-run-inv-b',
    actors: [],
    state: {},
    runDir: tmpDir,
    functionalError: null,
    videoDerivationStatus: 'PASSED',
    cleanupFn: () => ({ status: 'passed' }),
    inventoryFn: () => ({ counts: { orders: 1, cash_sessions: 0 } })
  });
  assert.equal(resB.executionSummary.inventoryStatus, 'LEAK_DETECTED');
  assert.equal(resB.overallPassed, false);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('8. runFinalizers incorporates viewer generation failure into summary and overall outcome', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pilot-viewer-fail-'));

  const { executionSummary, overallPassed, viewerError } = await runFinalizers({
    browser: null,
    runId: 'viewer-failure-run',
    actors: [],
    state: {},
    runDir: tmpDir,
    functionalError: null,
    videoDerivationStatus: 'PASSED',
    cleanupFn: () => ({ status: 'passed' }),
    inventoryFn: () => ({ counts: { orders: 0, profiles: 0 } }),
    viewerGeneratorFn: () => {
      throw new Error('INJECTED_VIEWER_WRITE_FAILURE');
    }
  });

  assert.ok(viewerError, 'viewerError must be captured');
  assert.equal(executionSummary.viewerStatus, 'FAILED');
  assert.equal(executionSummary.viewerError, 'INJECTED_VIEWER_WRITE_FAILURE');
  assert.equal(overallPassed, false, 'overallPassed must be false when viewer generation fails');

  const summaryFile = path.join(tmpDir, 'execution_summary.json');
  assert.ok(fs.existsSync(summaryFile), 'execution_summary.json must exist');
  const savedSummary = JSON.parse(fs.readFileSync(summaryFile, 'utf8'));
  assert.equal(savedSummary.viewerStatus, 'FAILED');
  assert.equal(savedSummary.viewerError, 'INJECTED_VIEWER_WRITE_FAILURE');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('9. runFinalizers fails execution when delivery directory is missing without falsely declaring success', async () => {
  let cleanupCalled = 0;
  let inventoryCalled = 0;

  const { executionSummary, overallPassed, deliveryError, viewerError } = await runFinalizers({
    browser: null,
    runId: 'missing-run-dir-run',
    actors: [],
    state: {},
    runDir: null, // missing delivery directory
    functionalError: null,
    videoDerivationStatus: 'PASSED',
    cleanupFn: () => {
      cleanupCalled++;
      return { status: 'passed' };
    },
    inventoryFn: () => {
      inventoryCalled++;
      return { counts: { orders: 0, profiles: 0 } };
    }
  });

  // 9.1 Cleanup and inventory must STILL execute
  assert.equal(cleanupCalled, 1, 'Cleanup must still run even if delivery directory is missing');
  assert.equal(inventoryCalled, 1, 'Inventory check must still run');

  // 9.2 Delivery and viewer must be marked FAILED
  assert.ok(deliveryError, 'deliveryError must be reported');
  assert.ok(viewerError, 'viewerError must be reported');
  assert.equal(executionSummary.deliveryStatus, 'FAILED');
  assert.equal(executionSummary.viewerStatus, 'FAILED');

  // 9.3 Overall passed must strictly be false
  assert.equal(overallPassed, false, 'overallPassed must be false when delivery directory is missing');
});

test('10. generateViewerHtml shows "No verificado" when metrics are missing and never fills defaults', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pilot-no-defaults-'));

  // 10.1 Missing metrics: must NOT display default constants
  generateViewerHtml({
    runDir: tmpDir,
    runId: 'missing-metrics-001',
    executionSummary: {
      functionalStatus: 'PASSED',
      cleanupStatus: 'PASSED',
      inventoryStatus: 'PASSED',
      videoDerivationStatus: 'PASSED'
    },
    videoProvenance: {
      derived: { measuredDurationSec: null, codec: null, resolution: null, fps: null, sizeBytes: 500000 }
    },
    financialAudit: { overallStatus: 'ALL_ASSERTIONS_PASSED' },
    clipTimestamps: {}
  });

  const htmlContent = fs.readFileSync(path.join(tmpDir, 'index.html'), 'utf8');
  assert.match(htmlContent, /No verificado/);
  assert.doesNotMatch(htmlContent, /VP8 \(1366x768 @ 25 FPS\)/);

  // 10.2 Derivation failed: shows derivation alert and points to raw_video.webm
  generateViewerHtml({
    runDir: tmpDir,
    runId: 'failed-derivation-002',
    executionSummary: {
      functionalStatus: 'PASSED',
      cleanupStatus: 'PASSED',
      inventoryStatus: 'PASSED',
      videoDerivationStatus: 'FAILED'
    },
    videoProvenance: {
      derived: { status: 'PROBE_FAILED', reason: 'INVALID_DURATION' },
      raw: { sizeBytes: 1200000 }
    },
    financialAudit: { overallStatus: 'ALL_ASSERTIONS_PASSED' },
    clipTimestamps: {}
  });

  const failedHtml = fs.readFileSync(path.join(tmpDir, 'index.html'), 'utf8');
  assert.match(failedHtml, /Aviso de Derivaci[oó]n.*El clip did[aá]ctico recortado no fue generado/);
  assert.match(failedHtml, /src="raw_video\.webm"/);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('11. runFinalizers fails execution when execution_summary.json persistence throws an error', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pilot-summary-fail-'));

  const { executionSummary, overallPassed, summaryPersistenceError } = await runFinalizers({
    browser: null,
    runId: 'summary-failure-run',
    actors: [],
    state: {},
    runDir: tmpDir,
    functionalError: null,
    videoDerivationStatus: 'PASSED',
    cleanupFn: () => ({ status: 'passed' }),
    inventoryFn: () => ({ counts: { orders: 0, profiles: 0 } }),
    summaryWriterFn: () => {
      throw new Error('SIMULATED_DISK_FULL_PERSISTENCE_CRASH');
    }
  });

  assert.ok(summaryPersistenceError, 'summaryPersistenceError must be captured');
  assert.equal(summaryPersistenceError.message, 'SIMULATED_DISK_FULL_PERSISTENCE_CRASH');
  assert.equal(executionSummary.summaryStatus, 'FAILED');
  assert.equal(executionSummary.summaryError, 'SIMULATED_DISK_FULL_PERSISTENCE_CRASH');
  assert.equal(executionSummary.deliveryStatus, 'FAILED');
  assert.equal(overallPassed, false, 'overallPassed must be false when summary persistence fails');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

