"""Private PaddleOCR service; downloads PP-OCRv5 models on first request."""
import base64
import hmac
import io
import os
import tempfile
from functools import lru_cache
from threading import Lock
from pathlib import Path
from fastapi import FastAPI, Depends, Header, HTTPException
from pydantic import BaseModel, Field
from PIL import Image, UnidentifiedImageError
Image.MAX_IMAGE_PIXELS = 16_000_000
app = FastAPI(docs_url=None, redoc_url=None)
lock = Lock()


def authorized(x_service_token: str = Header(default='')):
    expected = os.environ.get('SERVICE_TOKEN', '')
    if len(expected) < 32 or not hmac.compare_digest(expected, x_service_token):
        raise HTTPException(401, 'Unauthorized')


@lru_cache(maxsize=1)
def engine():
    from paddleocr import PaddleOCR
    return PaddleOCR(lang='ch', device='cpu', use_doc_orientation_classify=False,
                     use_doc_unwarping=False, use_textline_orientation=False)


class Photo(BaseModel):
    image: str = Field(max_length=12*1024*1024)
    mime: str = Field(max_length=100)


@app.get('/health')
def health():
    return {'ok': True, 'model_loaded': engine.cache_info().currsize > 0}


@app.post('/recognize', dependencies=[Depends(authorized)])
def recognize(photo: Photo):
    try:
        data = base64.b64decode(photo.image, validate=True)
        if len(data) > 8*1024*1024:
            raise HTTPException(413, 'Foto terlalu besar')
        image = Image.open(io.BytesIO(data))
        if image.width*image.height > 16_000_000:
            raise HTTPException(413, 'Foto maksimal 16 megapiksel')
        image = image.convert('RGB')
        # Strip metadata and normalize image before OCR.
        image.thumbnail((2400, 2400))
    except HTTPException:
        raise
    except (ValueError, UnidentifiedImageError, Image.DecompressionBombError, OSError):
        raise HTTPException(400, 'Foto tidak dapat dibaca')
    if not lock.acquire(blocking=False):
        raise HTTPException(503, 'OCR sedang sibuk')
    try:
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory)/'photo.png'
            image.save(file)
            texts, scores = [], []
            for result in engine().predict(str(file)):
                texts.extend(str(v) for v in result.get('rec_texts', []))
                scores.extend(float(v) for v in result.get('rec_scores', []))
            return {'text': '\n'.join(texts), 'confidence': sum(scores)/len(scores) if scores else None,
                    'note': 'OCR confidence bukan skor kualitas tulisan tangan.'}
    except Exception:
        raise HTTPException(503, 'OCR belum siap; periksa unduhan model dan memori server')
    finally:
        lock.release()
