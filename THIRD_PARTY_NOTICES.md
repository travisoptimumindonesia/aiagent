# Lisensi dan asal komponen

Kode portal baru berlisensi MIT. Lisensi tersebut tidak mengganti lisensi dependensi, data, model, merek, atau layanan pihak ketiga.

- **HanziGuide** — Yorick Reum, MIT untuk kode. Kode/asset situs asal tidak dibawa ke repo mandiri. Pemberitahuan lisensi asal tetap disimpan untuk provenance. Portal baru memakai konsep latihan karakter sebagai referensi, tidak membawa aset/font/iklan Jekyll ke runtime. [MIT](licenses/hanziguide-MIT.txt).
- **Hanzi Writer** — David Chanin, MIT. Library disajikan dari paket lokal; header pemberitahuan asli dipertahankan. [MIT](licenses/hanzi-writer-MIT.txt).
- **Hanzi Writer Data** — data berasal dari Make Me a Hanzi dan sumber font Arphic yang dijelaskan dalam README upstream. Data memakai **Arphic Public License**, bukan MIT. Tidak dimodifikasi dalam aplikasi ini. Pemberitahuan asli: [ARPHICPL](licenses/hanzi-writer-data-ARPHICPL.txt), [APL](licenses/hanzi-writer-data-APL.txt). Periksa ketentuan tersebut bila memodifikasi atau mendistribusikan ulang data.
- **TS-FSRS** — open-spaced-repetition contributors, MIT. [MIT](licenses/ts-fsrs-MIT.txt).
- **PyWa** — David Levi dan kontributor, MIT. Paket dan lisensinya dipasang di image bridge. [Upstream](https://github.com/david-lev/pywa).
- **PaddleOCR / PaddlePaddle** — PaddlePaddle Authors, Apache-2.0. Kode dipasang dalam image OCR opsional. Ketentuan model/data yang diunduh tetap berlaku secara terpisah. [Upstream](https://github.com/PaddlePaddle/PaddleOCR).
- **SpeechSuper API samples** — SpeechSuper, MIT untuk contoh integrasi HTTP; pola signing diadaptasi pada bridge. [Lisensi](licenses/speechsuper-MIT.txt). Mesin penilai dan layanan SpeechSuper **bukan** bagian open source aplikasi ini dan memerlukan akun tersendiri.
- **pinyin-pro**, Express, bcryptjs dan dependensi Node lain: lihat `package-lock.json` dan LICENSE pada masing-masing paket terpasang. Paket tidak dibundel ulang sebagai kode tanpa notice.

Tidak ada source code, merek, aset, konten berbayar, atau model milik HuaHua/PinterMandarin yang disalin. Fitur dibangun dari kebutuhan fungsional dan komponen terbuka tersebut.

- **FFmpeg** — dipasang dari paket Debian pada image bridge; ketentuan LGPL/GPL mengikuti konfigurasi build paket. Pemberitahuan paket tetap ada di image. Tidak ditautkan ke kode Node aplikasi.
