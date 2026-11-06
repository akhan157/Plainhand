#!/usr/bin/env bash
set -euo pipefail
: "${RESTORE_DATABASE_URL:?Use only an empty disposable database}"
: "${BACKUP_AGE_IDENTITY_FILE:?Path to the private age identity}"
[[ "${RESTORE_DISPOSABLE_CONFIRMED:-}" == yes ]] || { echo 'Confirm an empty disposable destination.' >&2; exit 1; }
export PGDATABASE="$RESTORE_DATABASE_URL"
unset RESTORE_DATABASE_URL
# Read encrypted bytes on stdin. No plaintext dump on disk.
age --decrypt --identity "$BACKUP_AGE_IDENTITY_FILE" | pg_restore --exit-on-error --no-owner --no-acl --dbname="$PGDATABASE"
