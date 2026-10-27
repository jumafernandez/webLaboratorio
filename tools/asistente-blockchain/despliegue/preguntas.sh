#!/bin/bash
# Resumen de lo que le preguntan al asistente-juego y de las insignias del día, leído en la VM (solo lectura).
# Desde la Mac, con la VPN:
#   bash despliegue/preguntas.sh            # últimos 7 días
#   bash despliegue/preguntas.sh 30         # últimos 30 días
# administrador lee la base por el grupo del servicio (instalar.sh lo suma al grupo). No hay backend/consultas.py
# como en dev-ia: la consulta va acá, con la base abierta en modo solo lectura.
set -euo pipefail
DIAS="${1:-7}"
[[ "$DIAS" =~ ^[0-9]+$ ]] || { echo "uso: $0 [días]" >&2; exit 1; }
ssh licdia "/opt/asistente-blockchain/.venv/bin/python - $DIAS" <<'PY'
import sqlite3, sys
dias = int(sys.argv[1])
db = sqlite3.connect("file:/var/lib/asistente-blockchain/asistente.sqlite3?mode=ro", uri=True)
desde = f"-{dias} days"
print(f"== Por día (últimos {dias})")
for fila in db.execute(
    "SELECT substr(momento,1,10) d, count(*), sum(deriva), sum(error IS NOT NULL), sum(bloqueo IS NOT NULL),"
    " round(sum(coalesce(usd,0)),3) FROM preguntas WHERE momento >= datetime('now', ?) GROUP BY d ORDER BY d",
    (desde,),
):
    print("  {}  preguntas {:>4}  derivadas {:>3}  errores {:>3}  topes {:>3}  US$ {}".format(*fila))
print("== Insignias y certificados")
for fila in db.execute(
    "SELECT dia, tipo, n FROM eventos WHERE dia >= date('now', ?) ORDER BY dia, tipo", (desde,)
):
    print("  {}  {:<12} {}".format(*fila))
print("== Últimas 20 preguntas")
for momento, pregunta in db.execute(
    "SELECT momento, pregunta FROM preguntas WHERE momento >= datetime('now', ?) ORDER BY id DESC LIMIT 20", (desde,)
):
    print(f"  {momento[:16]}  {pregunta[:110]}")
PY
