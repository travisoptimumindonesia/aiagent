#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
archive_path="${1:-}"
[[ -f "$archive_path" ]] || { echo 'Pemakaian: bash scripts/restore.sh backups/nama.tar.gz'; exit 1; }
echo 'Restore hanya diizinkan ke volume data kosong. Untuk produksi, buat backup dahulu.'
docker compose stop app
trap 'docker compose start app >/dev/null' EXIT
# Refuse overwrite of existing data; never delete the live database automatically.
docker compose run --rm --no-deps --entrypoint sh app -c 'test ! -e /app/data/app.sqlite && test ! -e /app/data/app.sqlite-wal' || { echo 'Volume sudah berisi data. Gunakan deployment/volume baru untuk restore.'; exit 1; }
docker compose run --rm --no-deps -T --entrypoint tar app -xzf - -C /app/data < "$archive_path"
echo 'Data dipulihkan. Aplikasi akan dimulai kembali.'
