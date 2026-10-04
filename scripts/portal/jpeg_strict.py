"""Secondary JPEG decode. Parent rejects native libjpeg corruption warnings."""
import json
import sys
from pathlib import Path
import cv2
import numpy as np

cv2.setNumThreads(1)
try:
    request = json.load(sys.stdin)
    for path in request['paths']:
        image = cv2.imdecode(np.frombuffer(Path(path).read_bytes(), dtype=np.uint8), cv2.IMREAD_UNCHANGED)
        if image is None or image.size == 0:
            raise ValueError('JPEG_DECODE_FAILED')
    print(json.dumps({'decoded': len(request['paths']), 'opencv': cv2.__version__}))
except Exception as error:
    print(json.dumps({'error': 'JPEG_DECODE_FAILED', 'reason': type(error).__name__}))
    sys.exit(1)
