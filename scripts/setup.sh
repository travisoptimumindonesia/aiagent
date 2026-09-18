#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ -e .env ]]; then
  echo '.env sudah ada. Edit konfigurasi yang ada; setup tidak menimpanya.'
  exit 1
fi
read -r -p 'Domain portal (contoh belajar.kursusmu.com): ' course_domain
read -r -p 'Email admin: ' course_email
read -r -s -p 'Kata sandi admin (12–72 karakter ASCII, tanpa petik tunggal): ' course_password
echo
if [[ ! "$course_domain" =~ ^[A-Za-z0-9][A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]] || [[ "$course_domain" == *..* ]]; then
  echo 'Domain tidak valid.'; exit 1
fi
if [[ ! "$course_email" =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]]; then
  echo 'Email tidak valid.'; exit 1
fi
if (( ${#course_password} < 12 || ${#course_password} > 72 )) || [[ "$course_password" == *"'"* ]] || [[ "$course_password" =~ [^\ -~] ]]; then
  echo 'Kata sandi tidak memenuhi ketentuan.'; exit 1
fi
course_token=$(openssl rand -hex 32)
course_verify=$(openssl rand -hex 24)
umask 077
{
  printf 'DOMAIN=%s\nPUBLIC_URL=https://%s\nACME_EMAIL=%s\nADMIN_EMAIL=%s\n' "$course_domain" "$course_domain" "$course_email" "$course_email"
  printf "ADMIN_PASSWORD='%s'\nSERVICE_TOKEN=%s\nWA_VERIFY_TOKEN=%s\n" "$course_password" "$course_token" "$course_verify"
  printf 'AI_DAILY_LIMIT=40\nLLM_BASE_URL=\nLLM_API_KEY=\nLLM_MODEL=\nOCR_URL=\nWA_PHONE_ID=\nWA_PUBLIC_NUMBER=\nWA_ACCESS_TOKEN=\nWA_APP_SECRET=\nWA_GRAPH_VERSION=24.0\nSPEECHSUPER_APP_KEY=\nSPEECHSUPER_SECRET_KEY=\nSPEECHSUPER_CORE_TYPE=\n'
} > .env
unset course_password course_token course_verify
echo 'Konfigurasi tersimpan. Arahkan DNS domain ke server, lalu: docker compose up -d --build'
