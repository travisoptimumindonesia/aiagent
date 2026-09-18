#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p backups
chmod 700 backups
backup_file="backups/mandarin-$(date -u +%Y%m%d-%H%M%S).tar.gz"
# Stop writers to capture database, WAL and media as one consistent archive.
# No volume is removed. Restart even if copying fails.
docker compose stop app
trap 'docker compose start app >/dev/null' EXIT
umask 077
docker compose run --rm --no-deps --entrypoint tar app -czf - -C /app/data . > "$backup_file"
tar -tzf "$backup_file" >/dev/null
echo "Backup tersimpan: $backup_file"
echo 'Salin ke penyimpanan terenkripsi di luar server. Arsip berisi data pribadi.'
