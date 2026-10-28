#!/usr/bin/env bash
# Deploys CredencialLICDIA and records it in deploy/<chainid>.json (key "credenciales", keeping the game contracts).
# Usage: ./desplegar-credencial.sh anvil [rpc_url]     (default http://127.0.0.1:8545, Anvil dev account #0)
#        ./desplegar-credencial.sh base-sepolia        (run BY A HUMAN, never by automation)
# base-sepolia requires BASE_SEPOLIA_RPC_URL, DEPLOYER (address of the "curso-dapps" Foundry keystore, becomes admin
# and issuer) and optionally KEYSTORE_CLAVE_ARCHIVO. Optional for both: EMISOR (extra address granted EMISOR_ROLE).
set -euo pipefail
cd "$(dirname "$0")"
red="${1:?uso: $0 anvil [rpc] | base-sepolia}"

./exportar-abi.sh
case "$red" in
  anvil)
    RPC="${2:-${ANVIL_RPC:-http://127.0.0.1:8545}}"
    chain_id="$(cast chain-id --rpc-url "$RPC")"
    [ "$chain_id" = "31337" ] || { echo "error: ${RPC} tiene chain id ${chain_id}, se esperaba 31337" >&2; exit 1; }
    # Public Anvil/Hardhat dev key #0 (published in the Foundry docs; never holds real funds).
    CLAVE_DEV="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
    forge script script/DesplegarCredencial.s.sol:DesplegarCredencial \
      --rpc-url "$RPC" --private-key "$CLAVE_DEV" --broadcast --slow
    ;;
  base-sepolia)
    : "${BASE_SEPOLIA_RPC_URL:?definí BASE_SEPOLIA_RPC_URL}"
    : "${DEPLOYER:?definí DEPLOYER (dirección del keystore curso-dapps)}"
    chain_id="$(cast chain-id --rpc-url "$BASE_SEPOLIA_RPC_URL")"
    [ "$chain_id" = "84532" ] || { echo "error: el RPC devuelve chain id ${chain_id}, se esperaba 84532" >&2; exit 1; }
    clave=()
    [ -n "${KEYSTORE_CLAVE_ARCHIVO:-}" ] && clave=(--password-file "$KEYSTORE_CLAVE_ARCHIVO")
    forge script script/DesplegarCredencial.s.sol:DesplegarCredencial \
      --rpc-url "$BASE_SEPOLIA_RPC_URL" \
      --account curso-dapps "${clave[@]}" --sender "$DEPLOYER" \
      --broadcast --slow \
      --verify --verifier sourcify \
      --chain 84532
    ;;
  *) echo "red desconocida: $red (anvil | base-sepolia)" >&2; exit 1 ;;
esac
echo "listo: $(pwd)/deploy/${chain_id}.json  -> copiar credenciales.address y credenciales.bloque a blockchain-dev/verificar/config.json"
