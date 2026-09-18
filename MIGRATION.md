# Pemindahan ke repo private mandiri

Status: **diunggah ke repository private**.

Tujuan saat pemindahan: `travisoptimumindonesia/aiagent`, visibility **Private**, branch `main`.
Nama aplikasi dan package tetap `mandarin-studio`. Repo dapat diganti nama menjadi `mandarin-studio` melalui GitHub Settings; GitHub akan mengalihkan URL lama.
Sumber: `travisoptimumindonesia/hanziguide`, branch `mandarin-platform`, commit `713c844620910be244cbd186f28c6209dfe27e71`.

## Perubahan struktur

- Isi `platform/` dipindahkan ke root; tidak membawa Jekyll, situs lama, atau histori Git fork.
- README dan perintah deployment diperbarui untuk repo private mandiri.
- Workflow CI memakai branch `main` dan path root.
- Identitas paket npm menjadi `mandarin-studio`; entry point menggunakan `src/server.js`.
- Source, fitur, tes, Docker, provenance, dan lisensi komponen dipertahankan.
- Tidak ada `.env`, kredensial, database, upload siswa, node_modules, atau file Git yang diunggah.

## Salinan lama

Repo/fork `hanziguide` dan branch `mandarin-platform` masih public. Repo private baru tidak menarik kembali kode yang pernah dipublikasikan. Penghapusan repo/branch lama tidak dilakukan.

## Validasi

Struktur mandiri lulus 12 tes Node dan 6 tes Python sebelum diunggah. Workflow GitHub pada repo tujuan menguji ulang source dan menjalankan build/health check container inti. Lihat `VALIDATION.md` untuk batasan provider live.
