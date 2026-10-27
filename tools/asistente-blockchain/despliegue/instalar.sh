#!/bin/bash
# Instala o actualiza el asistente-juego de Blockchain en la VM de LICDIA. Se corre con sudo desde la copia del proyecto:
#   sudo bash ~/asistente-blockchain/despliegue/instalar.sh
#   sudo CLAVE_DE_DEVIA=1 bash ~/asistente-blockchain/despliegue/instalar.sh   (usa la clave del asistente de dev-ia)
# Cadena real: con /etc/asistente-blockchain/keystore y keystore-clave (root, 600) se agrega la credencial de systemd.
# Es idempotente: en una actualización copia el código, reinstala dependencias si cambiaron y reinicia.
# La primera vez pide la clave de la API sin mostrarla y arma /opt/asistente-blockchain/.env (600) con el resto de
# despliegue/asistente-blockchain.env.example (DEV=0, CADENA_MODO=simulada).
# Mismo esquema que tools/asistente-dev-ia: usuario de sistema "asistente" (compartido), código de administrador
# legible por el grupo del servicio, y administrador puede reiniciar SOLO este servicio sin contraseña
# (despliegue/actualizar.sh). Requiere que la regla equivalente de dev-ia esté autorizada también para este servicio.
# El widget NO se instala acá: va en el repo del sitio (despliegue/exportar_widget.sh) y lo sirve nginx.
set -euo pipefail

ORIGEN="$(cd "$(dirname "$0")/.." && pwd)"
DEST=/opt/asistente-blockchain
SERVICIO=asistente-blockchain
PUERTO=8021
PROXY=http://proxy.unlu.edu.ar:8080
export HTTPS_PROXY=$PROXY HTTP_PROXY=$PROXY NO_PROXY=localhost,127.0.0.1
SITIO=/etc/nginx/sites-enabled/default

echo "== 0. Python"
python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3, 12) else 1)' \
    || { echo "Hace falta Python 3.12 o más (pyproject.toml); la VM tiene $(python3 -V)." >&2; exit 1; }

echo "== 1. Usuario de sistema"
id asistente >/dev/null 2>&1 || useradd --system --home-dir /opt/asistente-dev-ia --shell /usr/sbin/nologin asistente

echo "== 2. Código"
mkdir -p "$DEST"
# Lo de desarrollo no viaja: entorno, clave, datos locales, pruebas, contratos (Foundry, salvo ABIs y el deploy de
# Base Sepolia, que lee backend/cadena.py) ni ingesta.
rsync -a --delete \
    --exclude .venv --exclude .env --exclude datos --exclude __pycache__ --exclude .pytest_cache --exclude .ruff_cache \
    --include 'contratos/' --include 'contratos/abi/***' --include 'contratos/deploy/' \
    --include 'contratos/deploy/84532.json' --exclude 'contratos/**' \
    --include 'ingesta/' --include 'ingesta/__init__.py' --include 'ingesta/embudo.py' --exclude 'ingesta/**' --exclude tests --exclude widget \
    "$ORIGEN"/ "$DEST"/

echo "== 3. Clave de la API y configuración"
if [ ! -f "$DEST/.env" ]; then
    if [ "${CLAVE_DE_DEVIA:-0}" = 1 ]; then
        # Same Claude API key as the dev-ia assistant on this VM (its own .env, read here as root)
        K="$(sed -n 's/^LLM_API_KEY=//p' /opt/asistente-dev-ia/.env | head -1)"
        [ -n "$K" ] || { echo "No hay LLM_API_KEY en /opt/asistente-dev-ia/.env" >&2; exit 1; }
    else
        read -rsp "Clave de la API de Claude (platform.claude.com): " K
        echo
    fi
    {
        printf 'LLM_API_KEY=%s\n' "$K"                    # proveedor y modelo: backend/llm.json
        grep -v '^LLM_API_KEY=' "$DEST/despliegue/asistente-blockchain.env.example"
    } > "$DEST/.env"
    unset K
else
    echo "   ya existe $DEST/.env, no se toca"
fi
if grep -q '^DEV=1' "$DEST/.env"; then
    echo "$DEST/.env tiene DEV=1: en producción la app no debe servir el sitio. Cambiarlo a DEV=0." >&2
    exit 1
fi

echo "== 4. Entorno de Python"
# La VM no tiene python3-venv (sin ensurepip): el entorno se crea sin pip y pip se instala con el instalador oficial.
if [ ! -x "$DEST/.venv/bin/pip" ]; then
    rm -rf "$DEST/.venv"
    python3 -m venv --without-pip "$DEST/.venv"
    curl -fsS -x "$PROXY" https://bootstrap.pypa.io/get-pip.py -o /tmp/get-pip-asistente-blockchain.py
    "$DEST/.venv/bin/python" /tmp/get-pip-asistente-blockchain.py -q
    rm -f /tmp/get-pip-asistente-blockchain.py
fi
"$DEST/.venv/bin/pip" install -q --upgrade pip
# Versiones fijas con hash, exportadas de uv.lock (ver README, "Producción").
"$DEST/.venv/bin/pip" install -q --require-hashes -r "$DEST/despliegue/requirements.txt"

echo "== 5. Permisos"
# Código: de administrador, legible por el grupo del servicio. Entorno y clave: solo del servicio.
chown -R administrador:asistente "$DEST"
chmod -R u=rwX,g=rX,o= "$DEST"
chown -R asistente:asistente "$DEST/.venv" "$DEST/.env"
chmod 600 "$DEST/.env"
chmod 750 "$DEST"
usermod -aG asistente administrador
find "$DEST" -path "$DEST/.venv" -prune -o -type d -exec chmod g+s {} +

echo "== 5b. Reinicio sin contraseña, solo de este servicio"
REGLA=/etc/sudoers.d/$SERVICIO
printf 'administrador ALL=(root) NOPASSWD: /usr/bin/systemctl restart %s, /usr/bin/systemctl is-active %s\n' \
    "$SERVICIO" "$SERVICIO" > "$REGLA.nuevo"
chmod 440 "$REGLA.nuevo"
if visudo -cf "$REGLA.nuevo" >/dev/null; then mv "$REGLA.nuevo" "$REGLA"; else rm -f "$REGLA.nuevo"; echo "regla de sudoers inválida, no se instaló" >&2; exit 1; fi

echo "== 6. Servicio"
install -m 644 "$DEST/despliegue/$SERVICIO.service" /etc/systemd/system/$SERVICIO.service
CRED=/etc/$SERVICIO
DROPIN=/etc/systemd/system/$SERVICIO.service.d
if [ -f "$CRED/keystore" ] && [ -f "$CRED/keystore-clave" ]; then
    chown root:root "$CRED" "$CRED/keystore" "$CRED/keystore-clave"
    chmod 700 "$CRED"
    chmod 600 "$CRED/keystore" "$CRED/keystore-clave"
    mkdir -p "$DROPIN"
    printf '[Service]\nLoadCredential=keystore:%s/keystore\nLoadCredential=keystore-clave:%s/keystore-clave\n' "$CRED" "$CRED" \
        > "$DROPIN/relayer.conf"
    echo "   keystore del relayer como credencial de systemd ($DROPIN/relayer.conf)"
else
    rm -f "$DROPIN/relayer.conf"
fi
systemctl daemon-reload
systemctl enable -q $SERVICIO
systemctl restart $SERVICIO

echo "== 7. nginx"
install -m 644 "$DEST/despliegue/nginx-zonas.conf" /etc/nginx/conf.d/$SERVICIO-zonas.conf
install -m 644 "$DEST/despliegue/nginx-snippet.conf" /etc/nginx/snippets/$SERVICIO.conf
if ! grep -q "snippets/$SERVICIO.conf" "$SITIO"; then
    # Se cuelga del include de dev-ia (que ya está una sola vez en el server{} del sitio).
    if [ "$(grep -c 'include snippets/asistente-dev-ia.conf;' "$SITIO")" != 1 ]; then
        echo "No encuentro un único 'include snippets/asistente-dev-ia.conf;' en $SITIO: agregar el include a mano." >&2
        exit 1
    fi
    cp "$SITIO" /root/default.antes-del-asistente-blockchain
    sed -i "/include snippets\/asistente-dev-ia.conf;/a\    include snippets/$SERVICIO.conf;" "$SITIO"
    echo "   include agregado (copia previa en /root/default.antes-del-asistente-blockchain)"
fi
nginx -t
systemctl reload nginx

echo "== 8. Prueba"
for _ in $(seq 1 30); do curl -sf -o /dev/null http://127.0.0.1:$PUERTO/blockchain-dev/api/estado && break; sleep 2; done
curl -s -o /dev/null -w "   servicio local:    %{http_code}\n" http://127.0.0.1:$PUERTO/blockchain-dev/api/estado
curl -s -o /dev/null -w "   a través de nginx: %{http_code}\n" --resolve licdia.unlu.edu.ar:443:127.0.0.1 \
    https://licdia.unlu.edu.ar/blockchain-dev/api/estado
# El flujo SSE tiene que llegar sin búfer: la primera línea "event:" aparece antes de que termine la respuesta.
# Es una pregunta real al modelo (alrededor de un centavo de dólar) y queda en el registro.
curl -sN -m 60 --resolve licdia.unlu.edu.ar:443:127.0.0.1 -H 'Content-Type: application/json' \
    -d '{"mensajes":[{"rol":"usuario","texto":"¿Cuánto dura la diplomatura?"}]}' \
    https://licdia.unlu.edu.ar/blockchain-dev/api/chat | head -2 | sed 's/^/   sse: /' || true
systemctl --no-pager --lines=0 status $SERVICIO | head -5
