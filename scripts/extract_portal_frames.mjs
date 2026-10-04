import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { decodeImages, fileHash, parseTrace, pythonCall, requireThat, selectScenes, validateApproval } from './portal/validation.mjs';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Only a NEW candidate directory is writable. There is no --promote option.
export function extractCandidate({ tracePath, approvalPath, resultPath, name, python = 'python', workspace = repository }) {
  requireThat(/^[a-zA-Z0-9_-]{8,100}$/.test(name), 'CANDIDATE_NAME');
  const root = path.resolve(workspace, 'artifacts', 'training-candidates');
  for (const p of [workspace, path.dirname(root), root]) if (fs.existsSync(p)) requireThat(!fs.lstatSync(p).isSymbolicLink(), 'OUTPUT_SYMLINK');
  requireThat(fs.realpathSync(workspace).toLowerCase() === path.resolve(workspace).toLowerCase(), 'WORKSPACE_ALIAS');
  const target = path.join(root, name);
  requireThat(!fs.existsSync(target), 'CANDIDATE_EXISTS');
  const approval = JSON.parse(fs.readFileSync(approvalPath, 'utf8'));
  const runnerResult = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'avc-extract-'));
  let ownTarget = false;
  try {
    const traceCopy = path.join(temp, 'source.zip');
    fs.copyFileSync(tracePath, traceCopy, fs.constants.COPYFILE_EXCL);
    validateApproval(approval, fileHash(traceCopy), runnerResult);
    const unpacked = path.join(temp, 'trace');
    pythonCall('archive.py', { source: traceCopy, destination: unpacked }, python);
    const traces = {};
    for (const contextFile of new Set(approval.actors.map(a => a.contextFile))) traces[contextFile] = parseTrace(fs.readFileSync(path.join(unpacked, contextFile), 'utf8'));
    const scenes = selectScenes(approval, traces);
    const resources = [...new Set(scenes.flatMap(s => s.frames.map(f => f.sha256)))];
    const raster = decodeImages(resources.map(r => path.join(unpacked, 'resources', r)), python);
    const images = new Map(resources.map((r, i) => [r, raster.images[i]]));
    fs.mkdirSync(root, { recursive: true });
    fs.mkdirSync(target); ownTarget = true;
    const manifest = { schema: 1, state: 'CANDIDATE_REQUIRES_VISUAL_REVIEW', runId: approval.runId,
      testId: approval.testId, traceSha256: approval.traceSha256, viewport: approval.viewport,
      decoder: { name: 'Pillow', version: raster.pillow, strictJpeg: 'OpenCV/native warnings rejected', opencv: raster.opencv }, policy: 'all_observed_frames_no_padding', modules: [] };
    for (let moduleId = 1; moduleId <= 9; moduleId++) {
      const moduleScenes = scenes.filter(s => s.moduleId === moduleId);
      const dir = path.join(target, `module_${moduleId}`); fs.mkdirSync(dir);
      const records = [];
      for (const scene of moduleScenes) for (const frame of scene.frames) {
        const image = images.get(frame.sha256);
        const relative = `module_${moduleId}/frame_${String(records.length + 1).padStart(5, '0')}.${image.format === 'JPEG' ? 'jpg' : 'png'}`;
        fs.copyFileSync(path.join(unpacked, 'resources', frame.sha256), path.join(target, relative), fs.constants.COPYFILE_EXCL);
        requireThat(fileHash(path.join(target, relative)) === image.sha256, 'DERIVED_HASH_MISMATCH');
        records.push({ path: relative, sourceResource: frame.sha256, sourceTimestamp: frame.timestamp,
          contextFile: scene.contextFile, actorId: scene.actorId, segmentId: scene.segmentId,
          entityKey: scene.entityKey, entityId: scene.entityId,
          milestones: scene.windows.filter(w => frame.timestamp >= w.start && frame.timestamp <= w.end).map(w => w.id), ...image });
      }
      manifest.modules.push({ moduleId, frameCount: records.length,
        uniqueFiles: new Set(records.map(r => r.sha256)).size,
        uniqueRasters: new Set(records.map(r => r.pixelSha256)).size,
        flatFrames: records.filter(r => r.flat).length,
        segments: moduleScenes.map(({ frames, ...metadata }) => metadata), frames: records });
    }
    fs.writeFileSync(path.join(target, 'candidate.json'), JSON.stringify(manifest, null, 2), { flag: 'wx' });
    return { target, manifest };
  } catch (error) {
    if (ownTarget && path.dirname(target) === root && !fs.lstatSync(target).isSymbolicLink()) fs.rmSync(target, { recursive: true });
    throw error;
  } finally {
    if (path.dirname(fs.realpathSync(temp)).toLowerCase() === fs.realpathSync(os.tmpdir()).toLowerCase()) fs.rmSync(temp, { recursive: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    requireThat(args.length >= 8 && args.length % 2 === 0, 'USAGE: --trace PATH --approval PATH --result PATH --name UNIQUE_ID [--python PATH]');
    const options = {};
    for (let i = 0; i < args.length; i += 2) {
      requireThat(['--trace', '--approval', '--result', '--name', '--python'].includes(args[i]) && !options[args[i]], 'UNKNOWN_OR_DUPLICATE_OPTION');
      options[args[i]] = args[i + 1];
    }
    requireThat(options['--trace'] && options['--approval'] && options['--result'] && options['--name'], 'REQUIRED_ARGUMENT_MISSING');
    const result = extractCandidate({ tracePath: options['--trace'], approvalPath: options['--approval'], resultPath: options['--result'], name: options['--name'], python: options['--python'] });
    console.log(JSON.stringify({ status: 'candidate', path: result.target, modules: result.manifest.modules.map(m => ({ moduleId: m.moduleId, frames: m.frameCount })) }));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
