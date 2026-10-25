#!/bin/bash
# Instala o actualiza el asistente de dev-ia en la VM de LICDIA. Se corre con sudo desde la copia del proyecto:
#   sudo bash ~/asistente-dev-ia/despliegue/instalar.sh
# Es idempotente: en una actualización copia código e índice, reinstala dependencias si cambiaron y reinicia.
# La primera vez pide la clave de la API sin mostrarla y la guarda en /opt/asistente-dev-ia/.env (600).
# Deja además el despliegue sin sudo para el día a día (despliegue/actualizar.sh): el código y el índice son de
# administrador (el servicio los lee por grupo) y administrador puede reiniciar SOLO este servicio sin contraseña
# (autorizado por JM el 21/10/2026). Para cambios de dependencias o de la unidad de systemd, volver a correr este script.
set -euo pipefail

ORIGEN="$(cd "$(dirname "$0")/.." && pwd)"
DEST=/opt/asistente-dev-ia
PROXY=http://proxy.unlu.edu.ar:8080
export HTTPS_PROXY=$PROXY HTTP_PROXY=$PROXY NO_PROXY=localhost,127.0.0.1
SITIO=/etc/nginx/sites-enabled/default

echo "== 1. Usuario de sistema"
id asistente >/dev/null 2>&1 || useradd --system --home-dir "$DEST" --shell /usr/sbin/nologin asistente

echo "== 2. Código e índice"
mkdir -p "$DEST"
rsync -a --exclude .venv --exclude .cache --exclude .env --exclude datos --exclude __pycache__ "$ORIGEN"/ "$DEST"/

echo "== 3. Clave de la API"
if [ ! -f "$DEST/.env" ]; then
    read -rsp "Clave de la API de Claude (platform.claude.com): " K
    echo
    printf 'LLM_API_KEY=%s\n' "$K" > "$DEST/.env"      # proveedor y modelo: backend/llm.json
    unset K
else
    echo "   ya existe $DEST/.env, no se toca"
fi

echo "== 4. Entorno de Python (torch de CPU, la misma versión que rag-unlu en esta VM)"
# La VM no tiene python3-venv (sin ensurepip): el entorno se crea sin pip y pip se instala con el instalador oficial.
if [ ! -x "$DEST/.venv/bin/pip" ]; then
    rm -rf "$DEST/.venv"
    python3 -m venv --without-pip "$DEST/.venv"
    curl -fsS -x "$PROXY" https://bootstrap.pypa.io/get-pip.py -o /tmp/get-pip-asistente.py
    "$DEST/.venv/bin/python" /tmp/get-pip-asistente.py -q
    rm -f /tmp/get-pip-asistente.py
fi
"$DEST/.venv/bin/pip" install -q --upgrade pip
"$DEST/.venv/bin/pip" install -q --index-url https://download.pytorch.org/whl/cpu "torch==2.13.0"
"$DEST/.venv/bin/pip" install -q -r "$DEST/requirements.txt"

echo "== 5. Modelo de embeddings en la caché del servicio"
MODELO=$(python3 -c "import json; print(json.load(open('$DEST/indice/modelo.json'))['modelo'])")
# Primero sin conexión, con la caché que ya tiene el servicio (así no consulta a Hugging Face ni avisa por la falta de
# token); solo la primera instalación lo descarga. get_embedding_dimension es el nombre nuevo de la función.
VERIFICAR="from sentence_transformers import SentenceTransformer as S; m = S('$MODELO', device='cpu'); d = getattr(m, 'get_embedding_dimension', None) or m.get_sentence_embedding_dimension; print('   ', '$MODELO', d(), 'dimensiones')"
HF_HOME="$DEST/.cache/huggingface" HF_HUB_OFFLINE=1 "$DEST/.venv/bin/python" -c "$VERIFICAR" 2>/dev/null \
    || HF_HOME="$DEST/.cache/huggingface" "$DEST/.venv/bin/python" -c "$VERIFICAR"

echo "== 6. Permisos"
# Código e índice: de administrador, legibles por el grupo del servicio. Entorno, caché y clave: solo del servicio.
chown -R administrador:asistente "$DEST"
chmod -R u=rwX,g=rX,o= "$DEST"
chown -R asistente:asistente "$DEST/.venv" "$DEST/.cache" "$DEST/.env"
chmod 600 "$DEST/.env"
chmod 750 "$DEST"
# Los archivos nuevos que copie administrador heredan el grupo del servicio (setgid en las carpetas de código)
usermod -aG asistente administrador
find "$DEST" \( -path "$DEST/.venv" -o -path "$DEST/.cache" \) -prune -o -type d -exec chmod g+s {} +

echo "== 6b. Reinicio sin contraseña, solo de este servicio"
REGLA=/etc/sudoers.d/asistente-dev-ia
printf 'administrador ALL=(root) NOPASSWD: /usr/bin/systemctl restart asistente-dev-ia, /usr/bin/systemctl is-active asistente-dev-ia\n' > "$REGLA.nuevo"
chmod 440 "$REGLA.nuevo"
if visudo -cf "$REGLA.nuevo" >/dev/null; then mv "$REGLA.nuevo" "$REGLA"; else rm -f "$REGLA.nuevo"; echo "regla de sudoers inválida, no se instaló" >&2; exit 1; fi

echo "== 7. Servicio"
install -m 644 "$DEST/despliegue/asistente-dev-ia.service" /etc/systemd/system/asistente-dev-ia.service
systemctl daemon-reload
systemctl enable -q asistente-dev-ia
systemctl restart asistente-dev-ia

echo "== 8. nginx"
install -m 644 "$DEST/despliegue/nginx-zonas.conf" /etc/nginx/conf.d/asistente-dev-ia-zonas.conf
install -m 644 "$DEST/despliegue/nginx-snippet.conf" /etc/nginx/snippets/asistente-dev-ia.conf
if ! grep -q 'snippets/asistente-dev-ia.conf' "$SITIO"; then
    if [ "$(grep -c 'include snippets/entregas.conf;' "$SITIO")" != 1 ]; then
        echo "No encuentro un único 'include snippets/entregas.conf;' en $SITIO: agregar el include a mano." >&2
        exit 1
    fi
    cp "$SITIO" /root/default.antes-del-asistente
    sed -i '/include snippets\/entregas.conf;/a\    include snippets/asistente-dev-ia.conf;' "$SITIO"
    echo "   include agregado (copia previa en /root/default.antes-del-asistente)"
fi
nginx -t
systemctl reload nginx

echo "== 9. Prueba"
for _ in $(seq 1 90); do curl -sf -o /dev/null http://127.0.0.1:8030/dev-ia/api/mapa && break; sleep 2; done
curl -s -o /dev/null -w "   servicio local:  %{http_code}\n" http://127.0.0.1:8030/dev-ia/api/mapa
curl -s -o /dev/null -w "   a través de nginx: %{http_code}\n" --resolve licdia.unlu.edu.ar:443:127.0.0.1 https://licdia.unlu.edu.ar/dev-ia/api/mapa
systemctl --no-pager --lines=0 status asistente-dev-ia | head -5
