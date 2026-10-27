#!/usr/bin/env bash
# Local demo with the REAL chain: Anvil (31337) + contract deploy + backend in CADENA_MODO=real with DEV=1.
# Uses only Anvil's well-known public dev account #0 as relayer. Never touches a public network.
#
#   bash scripts/dev-real.sh                 # server on 8766, Anvil on 8545
#   PUERTO=8770 ANVIL_PUERTO=18545 bash scripts/dev-real.sh
#   BLOQUE=2 bash scripts/dev-real.sh        # 2 s block time, like Base Sepolia (default: automine)
#
# Ctrl+C stops the server and the Anvil this script started (nothing else).
set -euo pipefail
cd "$(dirname "$0")/.."
RAIZ="$(pwd)"

PUERTO="${PUERTO:-8766}"
ANVIL_PUERTO="${ANVIL_PUERTO:-8545}"
BLOQUE="${BLOQUE:-}"
RPC="http://127.0.0.1:${ANVIL_PUERTO}"

for h in anvil forge cast uv; do
  command -v "$h" >/dev/null || { echo "error: falta ${h} en el PATH" >&2; exit 1; }
done
ocupado() { ss -ltn "sport = :$1" | grep -q LISTEN; }
if ocupado "$PUERTO"; then echo "error: el puerto ${PUERTO} ya está en uso (PUERTO=... para otro)" >&2; exit 1; fi
if ocupado "$ANVIL_PUERTO"; then
  echo "error: el puerto ${ANVIL_PUERTO} ya está en uso (ANVIL_PUERTO=... para otro)" >&2; exit 1
fi

mkdir -p datos
args=(--port "$ANVIL_PUERTO" --chain-id 31337)
[ -n "$BLOQUE" ] && args+=(--block-time "$BLOQUE")
anvil "${args[@]}" >datos/anvil.log 2>&1 &
ANVIL_PID=$!
limpiar() { kill "$ANVIL_PID" 2>/dev/null || true; wait "$ANVIL_PID" 2>/dev/null || true; }
trap limpiar EXIT INT TERM

for _ in $(seq 50); do cast chain-id --rpc-url "$RPC" >/dev/null 2>&1 && break; sleep 0.2; done
cast chain-id --rpc-url "$RPC" >/dev/null || { echo "error: anvil no arrancó (ver datos/anvil.log)" >&2; exit 1; }

./contratos/desplegar-anvil.sh "$RPC" >datos/despliegue-anvil.log 2>&1 \
  || { echo "error: falló el despliegue (ver datos/despliegue-anvil.log)" >&2; exit 1; }

# Public Anvil/Hardhat dev key #0 (published in the Foundry docs; never holds real funds).
export CADENA_MODO=real
export CADENA_RPC="$RPC"
export CADENA_CHAIN_ID=31337
export CADENA_DEPLOY="${RAIZ}/contratos/deploy/31337.json"
export CADENA_CLAVE_DEV="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
# An explicit empty value wins over .env (which may point at the Base Sepolia keystore).
export CADENA_KEYSTORE="" CADENA_KEYSTORE_CLAVE_ARCHIVO="" CADENA_MIN_ETH=0.0005
export DEV=1

echo "Anvil:   ${RPC} (pid ${ANVIL_PID}, log datos/anvil.log)"
echo "Deploy:  contratos/deploy/31337.json"
echo "Abrí:    http://127.0.0.1:${PUERTO}/blockchain-dev/?bcw=open"
echo "Cadena:  http://127.0.0.1:${PUERTO}/blockchain-dev/api/cadena/estado"
echo "Panel:   http://127.0.0.1:${PUERTO}/blockchain-dev/api/panel"
echo "Ctrl+C para cortar todo."
uv run uvicorn backend.app:app --host 127.0.0.1 --port "$PUERTO"
