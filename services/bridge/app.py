"""Internal PyWa sender/media and SpeechSuper adapter. Never expose port 8001."""
import base64
import hashlib
import hmac
import json
import os
import subprocess
import tempfile
import time
import uuid
from pathlib import Path
from functools import lru_cache
import httpx
from fastapi import FastAPI, Header, HTTPException, Depends
from pydantic import BaseModel, Field
from pywa import WhatsApp

app = FastAPI(docs_url=None, redoc_url=None)
MAX_BYTES = 8 * 1024 * 1024


def authorized(x_service_token: str = Header(default='')):
    expected = os.environ.get('SERVICE_TOKEN', '')
    if len(expected) < 32 or not hmac.compare_digest(x_service_token, expected):
        raise HTTPException(401, 'Unauthorized')


@app.get('/health')
def health():
    return {'ok': True}


@lru_cache(maxsize=1)
def whatsapp():
    if not os.environ.get('WA_ACCESS_TOKEN') or not os.environ.get('WA_PHONE_ID'):
        raise HTTPException(503, 'WhatsApp belum dikonfigurasi')
    return WhatsApp(phone_id=os.environ['WA_PHONE_ID'], token=os.environ['WA_ACCESS_TOKEN'],
                    api_version=os.environ.get('WA_GRAPH_VERSION', '24.0'),
                    session=httpx.Client(timeout=40))


class Outgoing(BaseModel):
    phone: str = Field(pattern=r'^\d{6,20}$')
    text: str = Field(min_length=1, max_length=4000)


@app.post('/send', dependencies=[Depends(authorized)])
def send(data: Outgoing):
    try:
        result = whatsapp().send_message(to=data.phone, text=data.text)
        return {'id': result.id}
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(502, 'Pengiriman WhatsApp gagal')


@app.get('/media/{media_id}', dependencies=[Depends(authorized)])
def media(media_id: str):
    if not media_id.isdecimal() or len(media_id) > 80:
        raise HTTPException(400, 'ID media tidak valid')
    try:
        m = whatsapp().get_media_url(media_id=media_id)
        # Only request the URL returned by Meta, never a URL from an incoming message.
        from urllib.parse import urlparse
        url = str(m.url)
        host = urlparse(url).hostname or ''
        if urlparse(url).scheme != 'https' or not (host.endswith('.facebook.com') or host.endswith('.fbcdn.net') or host.endswith('.fbsbx.com')):
            raise HTTPException(502, 'Host media tidak dikenal')
        with httpx.stream('GET', url, headers={'Authorization': 'Bearer '+os.environ['WA_ACCESS_TOKEN']}, timeout=45, follow_redirects=False) as response:
            response.raise_for_status()
            parts, size = [], 0
            for part in response.iter_bytes():
                size += len(part)
                if size > MAX_BYTES:
                    raise HTTPException(413, 'Media lebih dari 8 MB')
                parts.append(part)
            raw = b''.join(parts)
            expected = getattr(m, 'sha256', None)
            if expected and hashlib.sha256(raw).hexdigest() != expected:
                raise HTTPException(502, 'Checksum media tidak sesuai')
            return {'data': base64.b64encode(raw).decode(), 'mime': m.mime_type}
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(502, 'Pengambilan media gagal')


class Assessment(BaseModel):
    audio: str = Field(max_length=12*1024*1024)
    mime: str = Field(max_length=100)
    target: str = Field(min_length=1, max_length=200)
    user_id: str = Field(min_length=1, max_length=100)


def wav_audio(raw: bytes) -> bytes:
    """Decode untrusted media without network protocols; refuse duration >60s."""
    with tempfile.TemporaryDirectory() as directory:
        src, dst = Path(directory)/'input', Path(directory)/'audio.wav'
        src.write_bytes(raw)
        try:
            probe = subprocess.run(['ffprobe', '-v', 'error', '-protocol_whitelist', 'file,pipe', '-show_entries', 'format=duration', '-of', 'json', str(src)], capture_output=True, timeout=15, check=True)
            duration = float(json.loads(probe.stdout).get('format', {}).get('duration', 0))
            if duration > 61:
                raise HTTPException(400, 'Rekaman maksimal 60 detik')
            subprocess.run(['ffmpeg', '-v', 'error', '-nostdin', '-protocol_whitelist', 'file,pipe', '-i', str(src), '-t', '61', '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', str(dst)], capture_output=True, timeout=30, check=True)
            import wave
            with wave.open(str(dst), 'rb') as recording:
                if recording.getnframes()/recording.getframerate() > 60.2:
                    raise HTTPException(400, 'Rekaman maksimal 60 detik')
            return dst.read_bytes()
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(400, 'Audio tidak dapat dibaca')


def normalize_scores(payload):
    """Surface only numeric fields returned by the selected provider, never infer tone."""
    result = payload.get('result')
    if not isinstance(result, dict):
        raise HTTPException(502, 'Provider tidak mengembalikan hasil penilaian')
    metrics = []
    for key, label in [('overall', 'Keseluruhan'), ('pronunciation', 'Pelafalan'), ('pron', 'Pelafalan'), ('fluency', 'Kelancaran'), ('integrity', 'Kelengkapan'), ('tone', 'Nada')]:
        value = result.get(key)
        if isinstance(value, (float, int)) and not isinstance(value, bool):
            metrics.append({'label': label, 'value': value})
    return {'provider': 'SpeechSuper', 'summary': 'Rekaman telah diproses mesin penilai. Konfirmasikan koreksi dengan laoshi.',
            'metrics': metrics,
            'note': 'Skala mengikuti produk SpeechSuper yang diaktifkan. '+('Skor nada berasal dari provider.' if any(m['label']=='Nada' for m in metrics) else 'Provider tidak mengembalikan skor nada yang dikenali; nada perlu ditinjau laoshi.'),
            'provider_result': result}


@app.post('/assess', dependencies=[Depends(authorized)])
def assess(data: Assessment):
    key, secret = os.environ.get('SPEECHSUPER_APP_KEY'), os.environ.get('SPEECHSUPER_SECRET_KEY')
    core = os.environ.get('SPEECHSUPER_CORE_TYPE', '')
    # The Mandarin core type must be supplied by the provider for this account.
    if not key or not secret or not core:
        raise HTTPException(503, 'Aktifkan produk penilaian Mandarin dan isi core type dari provider')
    import re
    if not re.fullmatch(r'[A-Za-z0-9._-]+', core):
        raise HTTPException(503, 'Core type tidak valid')
    try:
        raw = base64.b64decode(data.audio, validate=True)
    except ValueError:
        raise HTTPException(400, 'Audio tidak valid')
    if not raw or len(raw) > MAX_BYTES:
        raise HTTPException(413, 'Audio kosong atau terlalu besar')
    audio = wav_audio(raw)
    stamp = str(int(time.time()))
    connect_sig = hashlib.sha1((key+stamp+secret).encode()).hexdigest()
    start_sig = hashlib.sha1((key+stamp+data.user_id+secret).encode()).hexdigest()
    params = {'connect': {'cmd': 'connect', 'param': {'sdk': {'version': 16777472, 'source': 9, 'protocol': 2}, 'app': {'applicationId': key, 'sig': connect_sig, 'timestamp': stamp}}},
              'start': {'cmd': 'start', 'param': {'app': {'userId': data.user_id, 'applicationId': key, 'timestamp': stamp, 'sig': start_sig},
                       'audio': {'audioType': 'wav', 'channel': 1, 'sampleBytes': 2, 'sampleRate': 16000},
                       'request': {'coreType': core, 'refText': data.target, 'tokenId': uuid.uuid4().hex}}}}
    try:
        response = httpx.post('https://api.speechsuper.com/'+core, data={'text': json.dumps(params)}, files={'audio': ('audio.wav', audio, 'audio/wav')}, headers={'Request-Index': '0'}, timeout=70)
        response.raise_for_status()
        body = response.json()
        if body.get('error') or body.get('errId'):
            raise HTTPException(502, 'Provider menolak penilaian; periksa hak akses produk Mandarin')
        return normalize_scores(body)
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(502, 'Penilaian suara gagal')
