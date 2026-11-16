#!/bin/bash
# Carga la base w3schools y crea "alumno", el usuario de solo lectura que comparten los estudiantes. Corre sin sudo:
# administrador es superusuario de PostgreSQL (lo deja así instalar.sh). En la VM:
#   bash ~/postgres-w3schools/base.sh
# No toca la base ni el usuario si ya existen. La clave queda en ~/postgres-w3schools-credenciales.csv (solo la lee
# administrador).
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
CREDENCIALES=${CREDENCIALES:-$HOME/postgres-w3schools-credenciales.csv}

psql_() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }
existe() { [ "$(psql_ -d postgres -tAc "SELECT 1 FROM $1 WHERE $2 = '$3'")" = 1 ]; }

if ! existe pg_database datname w3schools; then
    psql_ -d postgres -c "CREATE DATABASE w3schools" -c "REVOKE CONNECT, TEMPORARY ON DATABASE w3schools FROM PUBLIC"
    psql_ -d w3schools -f "$DIR/w3schools_postgresql.sql"
    echo "   base w3schools cargada"
fi

# pg_hba.conf deja entrar desde afuera al grupo alumnos (instalar.sh)
existe pg_roles rolname alumnos || psql_ -d postgres -c "CREATE ROLE alumnos NOLOGIN"
if ! existe pg_roles rolname alumno; then
    CLAVE=$(python3 -c 'import secrets; print("".join(secrets.choice("abcdefghjkmnpqrstuvwxyz23456789") for _ in range(8)))')
    psql_ -d postgres -v clave="$CLAVE" <<'SQL'
CREATE ROLE alumno LOGIN PASSWORD :'clave' CONNECTION LIMIT 60 IN ROLE alumnos;
-- Solo consultas, y cada una se corta a los 30 segundos (un producto cartesiano no ocupa la VM)
ALTER ROLE alumno SET default_transaction_read_only = on;
ALTER ROLE alumno SET statement_timeout = '30s';
ALTER ROLE alumno SET temp_file_limit = '256MB';
SQL
    (umask 077; printf 'usuario,clave\nalumno,%s\n' "$CLAVE" > "$CREDENCIALES")
    echo "   usuario alumno creado; clave en $CREDENCIALES"
fi
psql_ -d postgres -c "GRANT CONNECT ON DATABASE w3schools TO alumno"
psql_ -d w3schools -c "GRANT USAGE ON SCHEMA public TO alumno" -c "GRANT SELECT ON ALL TABLES IN SCHEMA public TO alumno"
