import base64
import hashlib
import importlib.util
import io
import os
import pathlib
import unittest
import wave
from unittest.mock import patch
from types import SimpleNamespace
from fastapi.testclient import TestClient
from fastapi import HTTPException
from PIL import Image
ROOT=pathlib.Path(__file__).resolve().parents[1]

def load(name,path):
    spec=importlib.util.spec_from_file_location(name,path)
    mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod);return mod

bridge=load('bridge',ROOT/'services/bridge/app.py')
ocr=load('ocr',ROOT/'services/ocr/app.py')
TOKEN='testing-service-token-with-at-least-32-characters'

class ServiceTests(unittest.TestCase):
    def setUp(self):
        self.env=patch.dict(os.environ,{'SERVICE_TOKEN':TOKEN,'WA_ACCESS_TOKEN':'test-only','SPEECHSUPER_APP_KEY':'key','SPEECHSUPER_SECRET_KEY':'secret','SPEECHSUPER_CORE_TYPE':'configured.mandarin.core'})
        self.env.start();self.addCleanup(self.env.stop)
        self.headers={'X-Service-Token':TOKEN}
        self.client=TestClient(bridge.app)

    def test_internal_auth_and_pywa_contract(self):
        self.assertEqual(self.client.post('/send',json={'phone':'62812345678','text':'你好'}).status_code,401)
        class FakeWA:
            def send_message(self,*,to,text):
                self.to,self.text=to,text
                return SimpleNamespace(id='wamid.test')
        fake=FakeWA()
        with patch.object(bridge,'whatsapp',return_value=fake):
            result=self.client.post('/send',headers=self.headers,json={'phone':'62812345678','text':'你好'})
            self.assertEqual(result.status_code,200)
            self.assertEqual(result.json()['id'],'wamid.test')
            self.assertEqual(fake.to,'62812345678')

    def test_audio_conversion_and_duration(self):
        def audio(seconds):
            out=io.BytesIO()
            with wave.open(out,'wb') as w:
                w.setnchannels(1);w.setsampwidth(2);w.setframerate(16000);w.writeframes(b'\0\0'*16000*seconds)
            return out.getvalue()
        result=bridge.wav_audio(audio(1))
        with wave.open(io.BytesIO(result)) as wav:
            self.assertEqual(wav.getframerate(),16000)
            self.assertEqual(wav.getnchannels(),1)
        with self.assertRaises(HTTPException):bridge.wav_audio(audio(62))
        with self.assertRaises(HTTPException):bridge.wav_audio(b'not audio')

    def test_no_fabricated_tone_scores(self):
        result=bridge.normalize_scores({'result':{'overall':82,'fluency':77}})
        self.assertFalse(any(m['label']=='Nada' for m in result['metrics']))
        self.assertIn('tidak mengembalikan',result['note'])
        result=bridge.normalize_scores({'result':{'overall':82,'tone':65}})
        self.assertEqual(next(m['value'] for m in result['metrics'] if m['label']=='Nada'),65)

    def test_speech_signing_and_provider_failure(self):
        observed={}
        def post(url,**kwargs):
            observed.update(kwargs);observed['url']=url
            return SimpleNamespace(raise_for_status=lambda:None,json=lambda:{'result':{'overall':86}})
        with patch.object(bridge,'wav_audio',return_value=b'RIFF audio'),patch.object(bridge.httpx,'post',side_effect=post),patch.object(bridge.time,'time',return_value=1000):
            r=self.client.post('/assess',headers=self.headers,json={'audio':base64.b64encode(b'audio').decode(),'mime':'audio/wav','target':'你好','user_id':'7'})
        self.assertEqual(r.status_code,200)
        import json
        params=json.loads(observed['data']['text'])
        self.assertEqual(params['start']['param']['request']['refText'],'你好')
        self.assertEqual(params['start']['param']['app']['sig'],hashlib.sha1(b'key10007secret').hexdigest())
        with patch.dict(os.environ,{'SPEECHSUPER_CORE_TYPE':''}):
            r=self.client.post('/assess',headers=self.headers,json={'audio':'YQ==','mime':'audio/wav','target':'你好','user_id':'7'})
            self.assertEqual(r.status_code,503)

    def test_media_url_allowlist(self):
        fake=SimpleNamespace(get_media_url=lambda **kw:SimpleNamespace(url='http://169.254.169.254/latest/meta-data',sha256='',mime_type='image/jpeg'))
        with patch.object(bridge,'whatsapp',return_value=fake):
            r=self.client.get('/media/123',headers=self.headers)
            self.assertEqual(r.status_code,502)

    def test_ocr_auth_and_image_validation(self):
        client=TestClient(ocr.app)
        self.assertEqual(client.post('/recognize',json={'image':'','mime':'image/png'}).status_code,401)
        self.assertEqual(client.post('/recognize',headers=self.headers,json={'image':'bm90LWltYWdl','mime':'image/png'}).status_code,400)
        img=Image.new('RGB',(10,10),'white');out=io.BytesIO();img.save(out,format='PNG')
        fake=SimpleNamespace(predict=lambda _: [{'rec_texts':['你好'],'rec_scores':[0.98]}])
        with patch.object(ocr,'engine',return_value=fake):
            r=client.post('/recognize',headers=self.headers,json={'image':base64.b64encode(out.getvalue()).decode(),'mime':'image/png'})
            self.assertEqual(r.status_code,200)
            self.assertEqual(r.json()['text'],'你好')
            self.assertEqual(r.json()['confidence'],.98)
        # A mocked model verifies the HTTP contract, not real OCR accuracy.

if __name__=='__main__':unittest.main()
