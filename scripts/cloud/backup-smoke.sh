#!/usr/bin/env bash
# Run in a disposable Postgres container with age installed. Synthetic data only.
set -euo pipefail
umask 077
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
age-keygen -o "$scratch/key" 2>/dev/null
recipient=$(age-keygen -y "$scratch/key")
createdb backup_source
createdb backup_restored
psql -X -v ON_ERROR_STOP=1 -d backup_source -c "create schema plainhand; create table plainhand.fixture(id int primary key, content bytea); insert into plainhand.fixture values (1,decode('0001ff','hex'));" >/dev/null
pg_dump -d backup_source -Fc --no-owner --no-acl --schema=plainhand | age -r "$recipient" > "$scratch/synthetic.dump.age"
BACKUP_AGE_IDENTITY_FILE="$scratch/key" RESTORE_DATABASE_URL=backup_restored RESTORE_DISPOSABLE_CONFIRMED=yes bash /app/scripts/cloud/restore.sh < "$scratch/synthetic.dump.age"
[[ "$(psql -X -At -d backup_restored -c "select encode(content,'hex') from plainhand.fixture where id=1")" == 0001ff ]]
dropdb backup_source
dropdb backup_restored
echo 'PASS: encrypted synthetic pg_dump decrypted and restored byte-for-byte; temporary identity and ciphertext removed.'
