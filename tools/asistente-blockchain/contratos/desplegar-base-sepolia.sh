#!/usr/bin/env bash
# Deploy to Base Sepolia (chain id 84532). Meant to be run BY A HUMAN, never by automation.
# Requires:
#   BASE_SEPOLIA_RPC_URL  RPC endpoint
#   RELAYER               address of the backend's relayer wallet (it will need some testnet ETH for gas)
#   a Foundry keystore named "curso-dapps" (cast wallet import curso-dapps --interactive); the password is
#   asked interactively (or read by forge from KEYSTORE_CLAVE_ARCHIVO) and is never stored here.
# Optional: COMERCIO (merchant address that receives USDL; default = the deployer).
set -euo pipefail
cd "$(dirname "$0")"
: "${BASE_SEPOLIA_RPC_URL:?definí BASE_SEPOLIA_RPC_URL}"
: "${RELAYER:?definí RELAYER (dirección del relayer del backend)}"
# DEPLOYER: address of the curso-dapps keystore. Passed as --sender so the script sees it as msg.sender (owner and
# default merchant); without it forge uses its placeholder sender 0x1804...1f38.
: "${DEPLOYER:?definí DEPLOYER (dirección del keystore curso-dapps)}"

chain_id="$(cast chain-id --rpc-url "$BASE_SEPOLIA_RPC_URL")"
if [ "$chain_id" != "84532" ]; then
  echo "error: el RPC devuelve chain id ${chain_id}, se esperaba 84532 (Base Sepolia)" >&2
  exit 1
fi

./exportar-abi.sh
# KEYSTORE_CLAVE_ARCHIVO (optional): path to a file with the keystore password, read by forge itself.
clave=()
[ -n "${KEYSTORE_CLAVE_ARCHIVO:-}" ] && clave=(--password-file "$KEYSTORE_CLAVE_ARCHIVO")
forge script script/Desplegar.s.sol:Desplegar \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" \
  --account curso-dapps "${clave[@]}" --sender "$DEPLOYER" \
  --broadcast --slow \
  --verify --verifier sourcify \
  --chain 84532
echo "listo: $(pwd)/deploy/84532.json  (explorador: https://base-sepolia.blockscout.com)"
