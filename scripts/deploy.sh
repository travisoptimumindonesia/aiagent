#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
command -v docker >/dev/null || { echo 'Pasang Docker Engine dan Compose plugin dahulu.'; exit 1; }
docker compose version >/dev/null
[[ -f .env ]] || bash scripts/setup.sh
docker compose config --quiet
if [[ "${1:-}" == '--ocr' ]]; then
  docker compose --profile ocr up -d --build --wait --wait-timeout 240
else
  docker compose up -d --build --wait --wait-timeout 180
fi
docker compose ps
echo 'Buka PUBLIC_URL dari .env. Lihat README untuk aktivasi AI/WhatsApp.'
