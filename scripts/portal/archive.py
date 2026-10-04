"""Extract only trace events and raster resources into a NEW owned directory."""
import json
from pathlib import Path, PurePosixPath
import stat
import sys
import zipfile


def extract(source, destination):
    out = Path(destination)
    if out.exists():
        raise ValueError('DESTINATION_EXISTS')
    with zipfile.ZipFile(source) as archive:
        entries = archive.infolist()
        if len(entries) > 50000 or sum(i.file_size for i in entries) > 2_000_000_000:
            raise ValueError('ARCHIVE_LIMIT')
        seen = set()
        for item in entries:
            # zipfile also normalizes separators while READING on Windows.
            # Validate the preserved raw name, not only its normalized version.
            raw_name = item.orig_filename
            p = PurePosixPath(item.filename)
            reserved = {'CON', 'PRN', 'AUX', 'NUL'} | {f'COM{i}' for i in range(1, 10)} | {f'LPT{i}' for i in range(1, 10)}
            if ('\\' in raw_name or '\x00' in raw_name or p.is_absolute() or '..' in p.parts or '\\' in item.filename or
                    p.as_posix() != raw_name.rstrip('/') or
                    any(part != part.rstrip('. ') or part.split('.')[0].upper() in reserved for part in p.parts) or
                    ':' in item.filename or item.filename.casefold() in seen or
                    stat.S_ISLNK(item.external_attr >> 16)):
                raise ValueError('UNSAFE_ARCHIVE')
            seen.add(item.filename.casefold())
        out.mkdir()
        for item in entries:
            p = PurePosixPath(item.filename)
            selected = (len(p.parts) == 1 and p.suffix == '.trace') or (
                len(p.parts) == 2 and p.parts[0] == 'resources' and p.suffix.lower() in ('.jpg', '.jpeg', '.png'))
            if selected and not item.is_dir():
                if item.file_size > 150_000_000:
                    raise ValueError('ENTRY_LIMIT')
                target = out.joinpath(*p.parts)
                target.parent.mkdir(exist_ok=True)
                target.write_bytes(archive.read(item))
    return dict(files=sum(1 for p in out.rglob('*') if p.is_file()))


if __name__ == '__main__':
    try:
        request = json.load(sys.stdin)
        print(json.dumps(extract(request['source'], request['destination'])))
    except Exception as error:
        print(json.dumps(dict(error='TRACE_ARCHIVE_REJECTED', reason=type(error).__name__)))
        sys.exit(1)
