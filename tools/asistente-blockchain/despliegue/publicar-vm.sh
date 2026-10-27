#!/bin/bash
# Publishes the backend on the LICDIA VM in real-chain mode (Base Sepolia). Run it yourself from this machine:
#   bash despliegue/publicar-vm.sh
# It handles secrets, so it is meant to be run by a person, not by an agent:
#   - the relayer keystore (Foundry "curso-dapps") and its password file go to /etc/asistente-blockchain/ (root, 600)
#     and reach the service only as systemd credentials (instalar.sh adds the drop-in);
#   - the Claude API key is taken on the VM from the dev-ia assistant's .env (CLAVE_DE_DEVIA=1), it never travels.
# sudo on the VM takes the server password from ~/.unlu-deploy.creds. The VPN is brought up and down with the site's commands.sh.
set -euo pipefail

RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
# tools/asistente-blockchain -> webLaboratorio -> site/ (where commands.sh lives)
SITE="$(cd "$RAIZ/../../.." && pwd)"
KEYSTORE="${KEYSTORE:-$HOME/.foundry/keystores/curso-dapps}"
KEYSTORE_CLAVE="${KEYSTORE_CLAVE:-$HOME/code/teacher/diplomatura/dapps-2026/catedra/.wallet/.pw}"
[ -f "$KEYSTORE" ] && [ -f "$KEYSTORE_CLAVE" ] || { echo "Falta el keystore o su archivo de clave" >&2; exit 1; }

# shellcheck source=/dev/null
source "$HOME/.unlu-deploy.creds"
O=(-o StrictHostKeyChecking=no -o PreferredAuthentications=password -o PubkeyAuthentication=no
   -o IdentitiesOnly=yes -o NumberOfPasswordPrompts=1)
E="ssh -p $SSH_PORT ${O[*]}"

bash "$SITE/commands.sh" vpn-on
trap 'bash "$SITE/commands.sh" vpn-off' EXIT

echo "== Código"
sshpass -p "$SERVER_PASS" rsync -rlt --delete \
    --exclude .venv --exclude .env --exclude datos --exclude __pycache__ --exclude .pytest_cache --exclude .ruff_cache \
    --include 'contratos/' --include 'contratos/abi/***' --include 'contratos/deploy/' \
    --include 'contratos/deploy/84532.json' --exclude 'contratos/**' \
    --include 'ingesta/' --include 'ingesta/__init__.py' --include 'ingesta/embudo.py' --exclude 'ingesta/**' --exclude tests --exclude widget --exclude .DS_Store --exclude node_modules \
    -e "$E" "$RAIZ"/ "${SERVER}:asistente-blockchain/"

echo "== Keystore del relayer (temporal en el home, se mueve a /etc y se borra)"
sshpass -p "$SERVER_PASS" rsync --chmod=F600 -e "$E" "$KEYSTORE" "${SERVER}:.bc-keystore.tmp"
sshpass -p "$SERVER_PASS" rsync --chmod=F600 -e "$E" "$KEYSTORE_CLAVE" "${SERVER}:.bc-keystore-clave.tmp"

echo "== Instalación"
# sudo reads the server password (same as SSH, from ~/.unlu-deploy.creds) on stdin: nothing to type
# shellcheck disable=SC2016
printf '%s\n' "$SERVER_PASS" | sshpass -p "$SERVER_PASS" ssh -p "$SSH_PORT" "${O[@]}" "$SERVER" 'sudo -S -p "" bash -c "
set -euo pipefail
install -d -m 700 -o root -g root /etc/asistente-blockchain
install -m 600 -o root -g root ~administrador/.bc-keystore.tmp /etc/asistente-blockchain/keystore
install -m 600 -o root -g root ~administrador/.bc-keystore-clave.tmp /etc/asistente-blockchain/keystore-clave
shred -u ~administrador/.bc-keystore.tmp ~administrador/.bc-keystore-clave.tmp
CLAVE_DE_DEVIA=1 bash ~administrador/asistente-blockchain/despliegue/instalar.sh
F=/opt/asistente-blockchain/.env
fijar() { grep -q \"^\$1=\" \$F && sed -i \"s|^\$1=.*|\$1=\$2|\" \$F || echo \"\$1=\$2\" >> \$F; }
fijar CADENA_MODO real
fijar CADENA_RPC https://sepolia.base.org
fijar CADENA_MIN_ETH 0.00005
systemctl restart asistente-blockchain
for _ in \$(seq 1 30); do curl -sf -o /dev/null http://127.0.0.1:8021/blockchain-dev/api/estado && break; sleep 2; done
curl -s http://127.0.0.1:8021/blockchain-dev/api/estado; echo
"'
echo "== Listo"
