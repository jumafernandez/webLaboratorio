#!/bin/bash
# Carga la base eph (microdatos de la EPH de INDEC, armada con el cuaderno "De la EPH a PostgreSQL" del curso) y le da
# al usuario alumno permiso de consulta. Corre sin sudo, como base.sh. En la VM:
#   bash ~/postgres-w3schools/eph.sh ~/eph.dump
# El respaldo se genera desde la base eph del cuaderno:
#   pg_dump -Fc --no-owner --no-privileges -d eph -f eph.dump
# No toca la base si ya existe.
set -euo pipefail

RESPALDO=${1:?uso: eph.sh RESPALDO}
psql_() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }

if [ "$(psql_ -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = 'eph'")" != 1 ]; then
    psql_ -d postgres -c "CREATE DATABASE eph" -c "REVOKE CONNECT, TEMPORARY ON DATABASE eph FROM PUBLIC"
    pg_restore --no-owner --no-privileges --exit-on-error -d eph "$RESPALDO"
    psql_ -d eph -c "ANALYZE"
    echo "   base eph cargada"
fi
psql_ -d postgres -c "GRANT CONNECT ON DATABASE eph TO alumno"
psql_ -d eph -c "GRANT USAGE ON SCHEMA public TO alumno" -c "GRANT SELECT ON ALL TABLES IN SCHEMA public TO alumno"
psql_ -d eph -tAc "SELECT '   eph: ' || count(*) || ' personas, ' || pg_size_pretty(pg_database_size('eph')) FROM personas"
