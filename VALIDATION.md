# Catatan validasi — 18 September 2026

## Konteks repo mandiri

Source diuji ulang setelah dipindah ke struktur root: 12 tes Node dan 6 tes Python lulus. [GitHub Actions repo private](https://github.com/travisoptimumindonesia/aiagent/actions/runs/35359403709) juga menyelesaikan job `test` dan `containers` dengan hasil **success**: dependency dipasang ulang, tes dijalankan, image app/bridge dibangun, container dinyalakan, dan health check HTTP berhasil.

## Dijalankan dan lulus

[GitHub Actions](https://github.com/travisoptimumindonesia/hanziguide/actions/runs/35331320599) menyelesaikan job `test` dan `containers` dengan hasil **success** untuk commit aplikasi `32ea8805c0f65a60195288167049bae68dd91d4e`.

- `npm run check`: pemeriksaan sintaks JavaScript aplikasi, worker, dan frontend.
- `npm test`: **12 tes** API/integrasi/UI DOM.
- `python -m unittest discover -s test -p 'test_*.py' -v`: **6 tes** layanan Python.
- `npm audit --omit=dev --audit-level=high`: **0 vulnerabilities** dilaporkan saat pemeriksaan; bukan jaminan bebas celah.
- `bash -n` pada skrip setup/deploy/backup/restore. Smoke test setup juga memastikan password literal, permission `.env` 600, serta penolakan menimpa konfigurasi lama.
- `docker compose config --quiet`, build image **app + bridge**, lalu `docker compose up -d --wait app bridge` berhasil di GitHub Actions. Health check HTTP app mengembalikan sukses.
- Pemisahan port publik/internal dan volume diperiksa.
- Instalasi dependency Node dan Python bridge/OCR pada Linux amd64, Python 3.12 / Node 24.
- Inisialisasi API PaddleOCR dicoba dengan package asli; berhenti ketika model tidak dapat diunduh karena host model tidak terjangkau dari lingkungan pengembangan.

## Perilaku yang diuji

1. Login, auth, CSRF, hak admin/laoshi/siswa, dan pencabutan sesi ketika akun dinonaktifkan.
2. Akses kelas belum aktif/kedaluwarsa; materi draf; jawaban kuis tidak dikirim kepada siswa sebelum submit; nilai dihitung server.
3. Kartu per akun, deduplikasi saat menambahkan kosakata, penyimpanan jadwal FSRS, validasi rating, dan penolakan review versi lama/ganda.
4. Upload perlu persetujuan, validasi signature file, isolasi file/tugas antar siswa, koreksi hanya oleh laoshi/admin, dan penghapusan file.
5. Ketika AI gagal, tugas tetap tersimpan untuk laoshi dan tidak diberi skor buatan; pesan error internal provider tidak bocor.
6. Isolasi riwayat chat dan kuota AI per hari.
7. HMAC webhook, penolakan tanda tangan palsu, ID pesan duplikat, kode penghubung sekali pakai, dan pesan kedaluwarsa.
8. Pengiriman ulang WhatsApp memakai jawaban tersimpan; FSRS WhatsApp memakai jadwal akun yang sama dan mematuhi akses kelas.
9. Editor materi, perubahan password, file library Hanzi lokal, dan penolakan path karakter yang tidak valid.
10. UI melalui jsdom: dashboard, kuis, review, chat, editor laoshi, latihan Hanzi, WhatsApp, upload, akun, serta teks respons AI tidak dieksekusi sebagai HTML.
11. Internal service token, pemanggilan PyWa (mock), allowlist URL media, signing HTTP SpeechSuper, dan tidak mengarang skor nada.
12. **FFmpeg sungguhan** mengonversi WAV dan menolak audio rusak/terlalu panjang. OCR image decoding sungguhan diuji; hasil mesin OCR pada unit test memakai mock.

## Belum diverifikasi

- **Boot Caddy/HTTPS dan image OCR**: CI baru membangun dan menjalankan app + bridge; layanan opsional OCR serta konfigurasi domain nyata perlu diuji di server kursus.
- Sertifikat HTTPS/DNS domain kursus, backup/restore nyata menggunakan volume Docker, dan pengujian beban.
- Rendering visual dan mikrofon pada HP/iOS/Android nyata; jsdom tidak menggantikan browser/device testing.
- Meta Cloud API sungguhan: token, nomor, webhook subscription, izin akun, download media, dan pengiriman balasan.
- Respons LLM sungguhan, penilaian SpeechSuper produk Mandarin, pemetaan metrik per suku kata, serta validasi akurasi nada.
- **Inferensi OCR asli**: paket terpasang tetapi host HuggingFace/ModelScope/AIStudio/BOS tidak dapat diakses dari lingkungan ini, sehingga bobot model belum terunduh. Uji di server yang memiliki akses model.

## Pemeriksaan setelah deploy

1. Pastikan `docker compose ps` menunjukkan app/bridge sehat dan domain bisa dibuka lewat HTTPS.
2. Buat dua siswa. Pastikan tugas/percakapan mereka terpisah dan akun tanpa kelas tidak dapat membuka materi.
3. Sebagai siswa: selesaikan kuis, simpan kartu, lakukan review, tulis Hanzi, upload foto, rekam suara, lalu masuk sebagai laoshi untuk mengoreksi.
4. Aktifkan provider satu per satu. Uji teks, foto Hanzi, dan rekaman Mandarin yang benar/salah dengan penutur ahli sebelum mengandalkan skor.
5. Tautkan nomor WhatsApp siswa, kirim teks, `/latihan 你好` + foto/suara, serta `/kartu` dan rating.
6. Buat backup dan uji restore pada deployment terpisah sebelum menerima data siswa sungguhan.
