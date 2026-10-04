"""Create synthetic TEST artifacts only, never portal evidence."""
import json
import sys
from pathlib import Path
import zipfile
from PIL import Image, PngImagePlugin

request = json.load(sys.stdin)
root = Path(request['root'])
if request['operation'] == 'images':
    for name, offset in [('red', 20), ('blue', 140)]:
        im = Image.new('RGB', (64, 40))
        im.putdata([((x * 11 + offset) % 256, (x * 3) % 256, (x + offset) % 256) for x in range(2560)])
        im.save(root / f'{name}.jpg', quality=88)
    im.save(root / 'same-a.png', compress_level=1)
    meta = PngImagePlugin.PngInfo()
    meta.add_text('fixture', 'same pixels different encoding')
    im.save(root / 'same-b.png', compress_level=9, pnginfo=meta)
    raw = bytearray(1024)
    raw[:2] = b'\xff\xd8'
    raw[-2:] = b'\xff\xd9'
    (root / 'fake.jpg').write_bytes(raw)
    (root / 'fake.png').write_bytes(b'\x89PNG\r\n\x1a\n' + bytes(1024))
    original = (root / 'red.jpg').read_bytes()
    (root / 'truncated.jpg').write_bytes(original[:len(original)//2] + b'\xff\xd9')
    png = (root / 'same-a.png').read_bytes()
    (root / 'truncated.png').write_bytes(png[:len(png)//2])
elif request['operation'] == 'zip':
    with zipfile.ZipFile(root / request['name'], 'w', compression=zipfile.ZIP_DEFLATED) as archive:
        for name, content in request.get('traces', {}).items():
            archive.writestr(name, content)
        if request.get('images', True):
            for name in ['red.jpg', 'blue.jpg']:
                archive.writestr('resources/' + name, (root / name).read_bytes())
        for name, content in request.get('extra', {}).items():
            # ZipInfo(name) normalizes backslashes on Windows. Assign afterwards
            # so the negative fixture really contains the hostile archive name.
            info = zipfile.ZipInfo()
            info.filename = name
            info.orig_filename = name
            archive.writestr(info, content)
print(json.dumps({'created': True}))
