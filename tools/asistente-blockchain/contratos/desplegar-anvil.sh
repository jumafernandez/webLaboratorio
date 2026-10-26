#!/usr/bin/env bash
# Local deploy against Anvil (chain id 31337) using Anvil's well-known public dev account #0.
# Usage: ./desplegar-anvil.sh [rpc_url]      (default http://127.0.0.1:8545)
# Env:   RELAYER (default: dev account #0, the same key the backend uses with CADENA_CLAVE_DEV)
set -euo pipefail
cd "$(dirname "$0")"
RPC="${1:-${ANVIL_RPC:-http://127.0.0.1:8545}}"

chain_id="$(cast chain-id --rpc-url "$RPC")"
if [ "$chain_id" != "31337" ]; then
  echo "error: ${RPC} tiene chain id ${chain_id}; este script solo despliega en Anvil (31337)" >&2
  exit 1
fi

# Public Anvil/Hardhat dev key #0 (published in the Foundry docs; never holds real funds).
CLAVE_DEV="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
export RELAYER="${RELAYER:-0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266}"

./exportar-abi.sh
forge script script/Desplegar.s.sol:Desplegar --rpc-url "$RPC" --private-key "$CLAVE_DEV" --broadcast --slow
echo "listo: $(pwd)/deploy/31337.json"
