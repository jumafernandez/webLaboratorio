#!/bin/bash
# Rearma los índices de los dos asistentes (diplomatura y laboratorio) desde el sitio publicado, en la VM, sin sudo.
# Lo corre el cron del usuario administrador todos los días (ver README, "Reindexado automático"):
#   30 4 * * * bash /opt/asistente-dev-ia/despliegue/reindexar.sh >> /home/administrador/reindexar.log 2>&1
# y actualizar.sh al final de cada despliegue, con --reiniciar.
# Arma los índices en una copia del código, los evalúa con las preguntas de prueba y solo si pasan todas y cambió el
# contenido los copia a /opt/asistente-dev-ia y reinicia el servicio (unos 40 s sin asistente mientras carga). Si algo
# falla, el asistente sigue con los índices anteriores. --reiniciar: reinicia aunque los índices no hayan cambiado.
set -uo pipefail
APP=/opt/asistente-dev-ia
SITIO=/var/www/html
PY=$APP/.venv/bin/python
REINICIAR=0; [ "${1:-}" = "--reiniciar" ] && REINICIAR=1
export HF_HOME=$APP/.cache/huggingface HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 OMP_NUM_THREADS=2 TOKENIZERS_PARALLELISM=false
export HTTPS_PROXY=http://proxy.unlu.edu.ar:8080 HTTP_PROXY=http://proxy.unlu.edu.ar:8080 NO_PROXY=localhost,127.0.0.1
TRABAJO=$(mktemp -d /var/tmp/reindexar.XXXXXX)
trap 'rm -rf "$TRABAJO"' EXIT
echo "== $(date '+%F %T')"

rsync -a --exclude .venv --exclude .cache --exclude .env --exclude __pycache__ --exclude .pytest_cache "$APP"/ "$TRABAJO"/
cd "$TRABAJO" || exit 1
ok=1
# Indexa y evalúa un índice. En la corrida diaria el código es el publicado, así que si el contenido extraído es igual
# al del índice en uso no hay nada que hacer; después de un despliegue (--reiniciar) se hace siempre.
procesar() {
    local d=$1 nombre=$2
    if [ "$REINICIAR" = 0 ] && cmp -s "$d/secciones.json" "$APP/$d/secciones.json"; then
        echo "$nombre: sin cambios en el contenido"; return 0
    fi
    "$PY" ingesta/indexar.py "$d" 2>&1 | grep -v -E 'Loading weights|Redirects' \
        && "$PY" ingesta/evaluar.py "$d" 2>/dev/null || { echo "$nombre: NO pasa las pruebas"; return 1; }
}
# 1. Diplomatura en IA Generativa (el índice del laboratorio suma sus secciones, así que va primero)
"$PY" ingesta/extraer_sitio.py "$SITIO/dev-ia" && procesar indice diplomatura || ok=0
# 2. Laboratorio: sitio, subsitios y la documentación de Liminar (por el proxy)
"$PY" ingesta/licdia/extraer.py "$SITIO" && procesar indice-licdia laboratorio || ok=0

cambio=0
if [ "$ok" = 1 ]; then
    for d in indice indice-licdia; do
        cmp -s "$TRABAJO/$d/secciones.json" "$APP/$d/secciones.json" && cmp -s "$TRABAJO/$d/embeddings.npy" "$APP/$d/embeddings.npy" && continue
        cambio=1
        for f in secciones.json embeddings.npy pca.npz modelo.json cache-vectores.npz; do   # copia y renombra: el servicio nunca lee uno a medias
            cp "$TRABAJO/$d/$f" "$APP/$d/.$f.nuevo" && mv -f "$APP/$d/.$f.nuevo" "$APP/$d/$f"
        done
        echo "$d: índice nuevo publicado"
    done
    [ "$cambio" = 0 ] && echo "sin cambios en el contenido"
else
    echo "se mantienen los índices anteriores"
fi

if [ "$cambio" = 1 ] || [ "$REINICIAR" = 1 ]; then
    sudo -n /usr/bin/systemctl restart asistente-dev-ia
    for _ in $(seq 1 90); do curl -sf -o /dev/null http://127.0.0.1:8030/dev-ia/api/mapa && break; sleep 2; done
    curl -s -o /dev/null -w "servicio reiniciado: %{http_code}\n" http://127.0.0.1:8030/dev-ia/api/mapa
fi
[ "$ok" = 1 ]
