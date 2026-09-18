# Mandarin Studio — aplikasi kursus terpadu

Repo private mandiri untuk portal siswa, ruang laoshi, latihan Hanzi, spaced repetition, tutor teks, tugas foto/suara, dan WhatsApp dalam satu deployment. Antarmuka bahasa Indonesia, responsif untuk HP.

**Mulai deploy:** bagian [Deployment](#deployment-ke-server). **Hasil pengujian dan batasan:** [VALIDATION.md](VALIDATION.md).

## Yang tersedia

- Akun admin/laoshi/siswa; akun dibuat admin. Password bcrypt, sesi server-side, cookie HttpOnly, CSRF, pembatasan login, dan pencabutan sesi.
- Kelas dan akses siswa dengan tanggal kedaluwarsa. Admin mengaktifkan akses setelah pendaftaran/pembayaran dikonfirmasi di luar aplikasi.
- Editor materi, kosakata, kuis pilihan ganda, draf/terbit, penilaian kuis di server, dan progres siswa. Nilai terbaik ≥70% menandai materi selesai.
- Hanzi Writer: animasi goresan, latihan sentuh dengan koreksi urutan, pinyin, data Hanzi lokal. Latihan dicatat sebagai latihan mandiri, bukan ujian terverifikasi.
- TS-FSRS: kartu per siswa, due date tersimpan, pilihan Lagi/Sulit/Baik/Mudah, pemeriksaan versi untuk mencegah review ganda. Jadwal yang sama dipakai web dan WhatsApp.
- Tutor percakapan dengan riwayat per akun dan batas penggunaan harian; memerlukan provider LLM yang kompatibel dengan `/chat/completions`.
- Upload foto dan audio, atau rekam dari browser HTTPS. File privat dengan pemeriksaan hak akses. Hasil AI dan catatan laoshi tampil dalam riwayat tugas.
- OCR melalui PaddleOCR opsional. Membaca karakter dan membandingkan target; **bukan penilaian kualitas/urutan goresan dari foto**.
- Adapter SpeechSuper dengan normalisasi audio melalui FFmpeg. **Produk Mandarin, core type dan API key harus diaktifkan pada akun provider**. Tidak ada skor nada buatan dari transkrip. Jika respons tidak berisi metrik nada yang dikenali, tampilkan bahwa nada perlu ditinjau laoshi.
- WhatsApp resmi melalui Meta Cloud API dan PyWa: webhook bertanda tangan HMAC, deduplikasi ID, antrean persisten, percobaan kirim ulang, tautan akun sekali pakai, teks/foto/suara, dan review FSRS.
- Docker Compose, HTTPS otomatis Caddy, volume persisten, health checks, backup/restore, serta tes otomatis.

Materi bawaan hanya **3 contoh pemula**. Laoshi perlu meninjau dan menggantinya dengan kurikulum kursus. Ini bukan kurikulum HSK lengkap. Belum ada checkout pembayaran, kelas live/video, langganan otomatis, sertifikat, aplikasi native, atau pendaftaran publik.

## Penggabungan keenam fork

Aplikasi berada langsung di root repo ini. Komponen dari enam fork dipakai sesuai fungsinya. Situs Jekyll HanziGuide dan histori fork tidak disertakan; provenance dan lisensi tetap disimpan di `SOURCES.json` dan `licenses/`.

| Fork milik akun | Penggunaan di aplikasi | Versi runtime |
|---|---|---|
| [hanziguide](https://github.com/travisoptimumindonesia/hanziguide) | Referensi awal alur latihan Hanzi; kode Jekyll tidak dibawa ke repo mandiri | Basis commit dalam [SOURCES.json](SOURCES.json) |
| [hanzi-writer](https://github.com/travisoptimumindonesia/hanzi-writer) | Animasi dan latihan goresan pada web | npm 3.7.3 |
| [hanzi-writer-data](https://github.com/travisoptimumindonesia/hanzi-writer-data) | Data goresan lokal | npm 2.0.1 |
| [ts-fsrs](https://github.com/travisoptimumindonesia/ts-fsrs) | Penjadwalan review pada server | npm 5.4.2 |
| [pywa](https://github.com/travisoptimumindonesia/pywa) | Pengiriman balasan dan pengambilan media WhatsApp | PyPI 4.4.0 |
| [paddleocr](https://github.com/travisoptimumindonesia/paddleocr) | Layanan OCR opsional, CPU | PaddleOCR 3.3.2 / PaddlePaddle 3.2.2 |

Dependensi runtime menggunakan rilis paket yang dikunci, **bukan otomatis mengambil perubahan terbaru dari fork**. Perubahan khusus pada fork perlu ditinjau dan diintegrasikan secara sengaja. Lihat [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md); data Hanzi berlisensi Arphic, bukan MIT.

## Deployment ke server

Target: satu server Linux **amd64**, Docker Engine + Docker Compose plugin, domain dengan DNS A/AAAA menuju server, port 80/443 terbuka. Perkiraan awal 2 vCPU/4 GB RAM tanpa OCR; 4 vCPU/8 GB RAM dengan OCR. Ini perkiraan, bukan hasil load test. Jangan jalankan lebih dari satu instance app/worker pada database SQLite yang sama.

```bash
git clone git@github.com:travisoptimumindonesia/aiagent.git mandarin-studio
cd mandarin-studio
bash scripts/setup.sh
bash scripts/deploy.sh
```

Untuk repo private, perintah clone di atas membutuhkan SSH key yang telah diberi akses ke repo, misalnya deploy key read-only pada server. Jangan menaruh token di URL clone atau di source code.

`setup.sh` meminta domain, email admin, dan kata sandi admin. Ia membuat `.env` dengan permission 600 dan token layanan acak; tidak menimpa `.env` yang sudah ada. Kata sandi hanya digunakan untuk membuat admin pada database kosong. Setelah itu reset sandi melalui aplikasi, bukan mengganti `ADMIN_PASSWORD` di `.env`.

Buka `https://DOMAIN`, login admin, lalu:

1. Ruang laoshi → tambah akun siswa dan laoshi.
2. Aktifkan akses siswa ke kelas; atur tanggal akhir bila diperlukan.
3. Edit materi contoh atau buat kelas/materi sendiri.
4. Uji satu akun siswa: kuis, latihan Hanzi, kartu review, dan upload tugas.
5. Isi konfigurasi layanan di bawah dan jalankan ulang `bash scripts/deploy.sh`.

Tidak perlu kredensial AI untuk menjalankan fitur inti. Tugas foto/suara tetap tersimpan untuk laoshi bila layanan AI tidak aktif atau gagal. Jangan menaruh `.env`, token, database, atau file siswa di GitHub.

### Mengaktifkan tutor teks

Isi `.env` sesuai dokumentasi provider:

```dotenv
LLM_BASE_URL=https://alamat-provider/v1
LLM_API_KEY=isi-di-server
LLM_MODEL=model-yang-diaktifkan
AI_DAILY_LIMIT=40
```

`LLM_BASE_URL` adalah prefix sebelum `/chat/completions`; jangan sertakan endpoint itu dua kali. Adapter mengirim `messages`, `model`, `temperature`, dan `max_tokens`. Provider harus mendukung format ini. Tidak ada model atau layanan LLM lokal yang dibundel. Biaya/token mengikuti provider. Setelah mengisi, rebuild/restart dan coba dari menu Tutor Mandarin. Jangan menganggap status “terkonfigurasi” sebagai bukti koneksi berhasil.

### Mengaktifkan OCR

Isi `OCR_URL=http://ocr:8002`, lalu:

```bash
bash scripts/deploy.sh --ocr
```

Request pertama mengunduh model PaddleOCR dan dapat lambat. Server perlu koneksi keluar ke repositori model; unduhan tersimpan di volume `ocr_models`. `/health` hanya memeriksa proses, bukan kesiapan model. Jika unduhan atau request gagal, tugas masuk antrean review laoshi. Uji dengan foto nyata sebelum dipakai siswa; akurasi tulisan tangan bervariasi. ARM/GPU belum divalidasi.

### Mengaktifkan penilaian suara Mandarin

Isi `SPEECHSUPER_APP_KEY`, `SPEECHSUPER_SECRET_KEY`, dan `SPEECHSUPER_CORE_TYPE` yang **diberikan provider untuk produk Mandarin akunmu**. Tidak dipasang default core bahasa Inggris. Rekaman dikonversi menjadi WAV mono 16 kHz dan dibatasi 60 detik/8 MB.

Adapter mengikuti pola signing dari [contoh resmi SpeechSuper](https://github.com/speechsuper/SpeechSuper-API-Samples/blob/main/http_samples/python_http_sample/sample.py). Respons produk Mandarin perlu divalidasi dengan akun asli. Metrik numerik yang dikenali: `overall`, `pronunciation`/`pron`, `fluency`, `integrity`, dan `tone`. Field berbeda memerlukan pemetaan eksplisit pada `normalize_scores()`; jangan menyamakan skor keseluruhan dengan skor nada. Feedback nada per suku kata belum dikalibrasi/diimplementasikan untuk produk Mandarin tertentu.

Suara contoh pada halaman kosakata menggunakan `speechSynthesis` perangkat bila suara Mandarin tersedia. Ini bukan layanan TTS server. WhatsApp saat ini membalas dengan teks, bukan suara sintetis.

### Mengaktifkan WhatsApp

Gunakan nomor WhatsApp Business dengan akses Meta Cloud API. Ini bukan QR login WhatsApp pribadi.

1. Isi `WA_PHONE_ID`, `WA_PUBLIC_NUMBER` (angka termasuk kode negara), `WA_ACCESS_TOKEN`, `WA_APP_SECRET`; `WA_VERIFY_TOKEN` sudah dibuat setup. Gunakan versi Graph API yang didukung akun melalui `WA_GRAPH_VERSION`.
2. Jalankan ulang deployment.
3. Pada pengaturan webhook aplikasi Meta, masukkan callback `https://DOMAIN/webhooks/whatsapp`, verify token sesuai `.env`, dan subscribe field `messages` untuk WABA/nomor terkait.
4. Di portal siswa → WhatsApp, setujui pemrosesan data, buat kode, lalu kirim `HUBUNGKAN KODE` dari nomor siswa. Kode berlaku 10 menit dan hanya sekali.
5. Kirim teks; untuk foto/suara kirim `/latihan 你好` dahulu. `/kartu` → `/jawaban` → `/lagi`, `/sulit`, `/baik`, atau `/mudah` untuk review.

Webhook memvalidasi `X-Hub-Signature-256` dari raw request body dan memfilter phone number ID. Penyimpanan ID pesan mencegah pemrosesan ulang webhook yang sama. Balasan gagal dicoba ulang sampai 5 kali. Balasan hasil AI disimpan sebelum kirim ulang. Pengiriman keluar bersifat **at least once**: jika Meta menerima pesan tetapi koneksi terputus sebelum konfirmasi, retry dapat mengirim balasan duplikat. Crash tepat sebelum response tersimpan juga dapat mengulang pemrosesan; tidak mengklaim exactly-once.

Hanya balasan terhadap pesan pengguna; pesan >23 jam ditandai kedaluwarsa untuk menjaga margin jendela percakapan. Belum ada broadcast, pengingat terjadwal, template marketing, atau sinkronisasi delivery/read receipt. Pengujian Meta sungguhan memerlukan akun, nomor dan token milik kursus.

## Operasional

```bash
docker compose ps
docker compose logs --tail=100 app bridge
docker compose --profile ocr logs --tail=100 ocr
curl -f http://127.0.0.1:3000/health
bash scripts/backup.sh
```

Database, sesi, progress, kartu, percakapan, antrean, dan media ada pada volume `app_data`. Jangan gunakan `docker compose down -v` karena akan menghapus data. Port app hanya terikat ke localhost; bridge/OCR tidak dipublikasikan. Caddy menyediakan HTTPS.

Backup menghentikan app sebentar, mengarsipkan database/WAL dan file, lalu menyalakan app kembali, termasuk bila proses salin gagal. Simpan backup terenkripsi di lokasi lain dan uji restore. `restore.sh` menolak menimpa database yang sudah ada; lakukan restore ke deployment/volume kosong:

```bash
bash scripts/restore.sh backups/mandarin-TANGGAL.tar.gz
```

Siswa dapat menghapus percakapan dan tugasnya. Admin/laoshi dapat menghapus tugas dari portal. Retensi otomatis belum dijadwalkan; tentukan kebijakan kursus dan kelola backup yang mengandung data pribadi. Seluruh laoshi pada deployment ini dapat melihat seluruh siswa dan tugas; ini model satu lembaga, bukan multi-tenant.

Untuk memperbarui kode: backup dahulu, `git pull --ff-only`, lalu deploy ulang. Jangan mengganti branch sembarang pada server. Jika upgrade mencakup perubahan schema, ikuti catatan migrasi rilis; schema awal ini versi 1.

## Pengembangan dan pengujian

Node 24+, Python 3.12+, FFmpeg untuk tes layanan audio.

```bash
npm ci
# Buat .env untuk lokal: PUBLIC_URL=http://localhost:3000,
# ADMIN_EMAIL, ADMIN_PASSWORD >=12 karakter; NODE_ENV jangan production.
npm start
npm run check
npm test
python -m venv .venv
. .venv/bin/activate
pip install -r services/bridge/requirements.txt pillow==12.1.1
python -m unittest discover -s test -p 'test_*.py' -v
```

Tes provider memakai mock; tidak memakai akun/biaya API sungguhan. UI dites dengan jsdom, bukan pengujian visual/perangkat nyata. Lihat [VALIDATION.md](VALIDATION.md) untuk cakupan aktual.

## Struktur

```text
mandarin-studio/
  src/             Node API, SQLite schema/seed, provider adapter, WhatsApp worker
  public/          Antarmuka responsif tanpa build frontend terpisah
  services/bridge/ PyWa, normalisasi audio, adapter SpeechSuper
  services/ocr/    PaddleOCR (profil opsional)
  scripts/         Setup, deploy, backup, restore
  test/            Pengujian API, UI DOM, webhook, dan layanan Python
  compose.yaml     App + bridge + Caddy + OCR opsional
```

Dokumentasi komponen: [Hanzi Writer](https://hanziwriter.org/docs.html), [TS-FSRS](https://open-spaced-repetition.github.io/ts-fsrs/), [PyWa](https://pywa.readthedocs.io/en/latest/), [PaddleOCR](https://www.paddleocr.ai/latest/en/version3.x/pipeline_usage/OCR.html).
