#!/bin/bash
# Actualiza el código del asistente en la VM sin sudo y reindexa allá. Requiere haber corrido instalar.sh (que deja el código
# de administrador con el grupo del servicio y la regla para reiniciar solo este servicio). Desde la Mac, con la VPN:
#   bash despliegue/actualizar.sh
# Si cambian requirements.txt o la unidad de systemd, usar instalar.sh. Los permisos los da la VM: la carpeta raíz es
# 750 y las carpetas de código heredan el grupo del servicio (setgid).
set -euo pipefail
RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
# Los índices no viajan: los arma la VM desde el sitio publicado (despliegue/reindexar.sh), así no se pisan los del
# reindexado diario con los del repo.
rsync -rlt \
    --exclude .venv --exclude .env --exclude .cache --exclude datos --exclude __pycache__ --exclude .DS_Store \
    --exclude /indice --exclude /indice-licdia \
    "$RAIZ"/ licdia:/opt/asistente-dev-ia/
# Reindexa con el código nuevo y reinicia el servicio aunque los índices no cambien
ssh licdia 'bash /opt/asistente-dev-ia/despliegue/reindexar.sh --reiniciar'
