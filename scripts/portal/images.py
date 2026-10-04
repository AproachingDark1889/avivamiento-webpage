"""Offline raster validation. No network, environment files or application imports."""
import hashlib
import json
import sys
import subprocess
import warnings
from pathlib import Path
from PIL import Image, ImageFile, __version__ as pillow_version

ImageFile.LOAD_TRUNCATED_IMAGES = False
Image.MAX_IMAGE_PIXELS = 40_000_000
warnings.simplefilter('error', Image.DecompressionBombWarning)


def inspect(path):
    raw = Path(path).read_bytes()
    if len(raw) > 30_000_000:
        raise ValueError('IMAGE_TOO_LARGE')
    # Markers supplement the decoder; they do not replace verify() and load().
    with Image.open(path) as image:
        kind = image.format
        if kind not in ('JPEG', 'PNG') or getattr(image, 'n_frames', 1) != 1:
            raise ValueError('UNSUPPORTED_RASTER')
        if kind == 'JPEG' and not raw.endswith(b'\xff\xd9'):
            raise ValueError('TRUNCATED_JPEG')
        image.verify()
    with Image.open(path) as image:
        image.load()
        pixels = image.convert('RGBA')
        width, height = pixels.size
        signature = f'{width}x{height}:RGBA:'.encode() + pixels.tobytes()
        extrema = pixels.getextrema()
    return dict(sha256=hashlib.sha256(raw).hexdigest(),
                pixelSha256=hashlib.sha256(signature).hexdigest(),
                width=width, height=height, format=kind, bytes=len(raw),
                flat=all(low == high for low, high in extrema))


if __name__ == '__main__':
    try:
        request = json.load(sys.stdin)
        results = [inspect(path) for path in request['paths']]
        jpegs = [path for path, result in zip(request['paths'], results) if result['format'] == 'JPEG']
        strict_version = None
        if jpegs:
            strict = subprocess.run([sys.executable, str(Path(__file__).with_name('jpeg_strict.py'))],
                input=json.dumps({'paths': jpegs}), text=True, capture_output=True, timeout=90,
                creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == 'win32' else 0)
            # libjpeg can fill damaged MCU rows and still return an image. Its
            # native warnings must not silently turn that salvage into approval.
            if strict.returncode != 0 or strict.stderr.strip():
                raise ValueError('JPEG_STRICT_DECODE_OR_WARNING')
            strict_version = json.loads(strict.stdout)['opencv']
        print(json.dumps(dict(pillow=pillow_version, opencv=strict_version, images=results)))
    except Exception as error:
        # Never dump pixels, file contents or external error messages.
        print(json.dumps(dict(error='RASTER_DECODE_FAILED', reason=type(error).__name__)))
        sys.exit(1)
