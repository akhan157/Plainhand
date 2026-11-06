#!/usr/bin/env bash
# Stream only: plaintext never lands in the checkout, temp files or artifacts.
set -euo pipefail
umask 077
: "${BACKUP_DATABASE_URL:?Set the dedicated read-only backup connection}"
: "${BACKUP_AGE_RECIPIENT:?Set the approved age public recipient}"
: "${BACKUP_S3_URI:?Set the approved private s3://bucket/prefix}"
[[ "$BACKUP_S3_URI" =~ ^s3://[^/]+/.+ ]] || { echo 'A private bucket prefix is required.' >&2; exit 1; }
[[ "${BACKUP_DESTINATION_APPROVED:-}" == yes ]] || { echo 'Owner approval of private destination and 14-day lifecycle is required.' >&2; exit 1; }
# Credentials supplied by the runner's role. Do not print URL, keys or dump output.
export PGDATABASE="$BACKUP_DATABASE_URL"
unset BACKUP_DATABASE_URL
pg_dump --format=custom --no-owner --no-acl --schema=plainhand \
  | age --encrypt --recipient "$BACKUP_AGE_RECIPIENT" \
  | aws s3 cp - "${BACKUP_S3_URI%/}/plainhand-$(date -u +%Y%m%dT%H%M%SZ).dump.age" --sse AES256 --only-show-errors
