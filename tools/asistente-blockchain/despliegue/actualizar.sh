#!/bin/bash
# Actualiza el código del asistente-juego de Blockchain en la VM sin sudo. Requiere haber corrido instalar.sh (código
# de administrador con el grupo del servicio y la regla para reiniciar solo este servicio). Desde la Mac, con la VPN:
#   bash despliegue/actualizar.sh
# Si cambian las dependencias (despliegue/requirements.txt) o la unidad de systemd, usar instalar.sh.
# El widget va aparte, por el repo del sitio (despliegue/exportar_widget.sh).
set -euo pipefail
RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
rsync -rlt \
    --exclude .venv --exclude .env --exclude datos --exclude __pycache__ --exclude .pytest_cache --exclude .ruff_cache \
    --include 'contratos/' --include 'contratos/abi/***' --include 'contratos/deploy/' \
    --include 'contratos/deploy/84532.json' --exclude 'contratos/**' \
    --include 'ingesta/' --include 'ingesta/__init__.py' --include 'ingesta/embudo.py' --exclude 'ingesta/**' --exclude tests --exclude widget --exclude .DS_Store \
    "$RAIZ"/ licdia:/opt/asistente-blockchain/
ssh licdia 'sudo -n /usr/bin/systemctl restart asistente-blockchain && for _ in $(seq 1 30); do curl -sf -o /dev/null http://127.0.0.1:8021/blockchain-dev/api/estado && break; sleep 2; done; curl -s -o /dev/null -w "servicio: %{http_code}\n" http://127.0.0.1:8021/blockchain-dev/api/estado'
