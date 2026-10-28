#!/usr/bin/env bash
# Issues credentials in batches from a JSON file under emisiones/ (format: emisiones/ejemplo.json).
# Usage: ./emitir-credenciales.sh anvil emisiones/archivo.json [rpc_url]
#        ./emitir-credenciales.sh base-sepolia emisiones/archivo.json   (run BY A HUMAN, never by automation)
# The contract address comes from deploy/<chainid>.json (credenciales.address) unless CREDENCIAL is set.
# base-sepolia requires BASE_SEPOLIA_RPC_URL and EMISOR_CUENTA (address of the "curso-dapps" keystore, which must hold
# EMISOR_ROLE); optional KEYSTORE_CLAVE_ARCHIVO. Optional: LOTE (batch size, default 20).
# Set SIMULAR=1 to only simulate (no transaction is sent).
set -euo pipefail
cd "$(dirname "$0")"
red="${1:?uso: $0 anvil|base-sepolia emisiones/archivo.json [rpc]}"
export ARCHIVO="${2:?falta el archivo de egresados (emisiones/*.json)}"
case "$ARCHIVO" in emisiones/*.json) ;; *) echo "error: el archivo tiene que estar en emisiones/ (permiso de lectura de forge)" >&2; exit 1 ;; esac
emitir=(--broadcast --slow)
[ "${SIMULAR:-0}" = "1" ] && emitir=()

case "$red" in
  anvil)
    RPC="${3:-${ANVIL_RPC:-http://127.0.0.1:8545}}"
    chain_id="$(cast chain-id --rpc-url "$RPC")"
    [ "$chain_id" = "31337" ] || { echo "error: ${RPC} tiene chain id ${chain_id}, se esperaba 31337" >&2; exit 1; }
    CLAVE_DEV="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"   # public Anvil dev key #0
    forge script script/EmitirCredenciales.s.sol:EmitirCredenciales --rpc-url "$RPC" --private-key "$CLAVE_DEV" "${emitir[@]}"
    ;;
  base-sepolia)
    : "${BASE_SEPOLIA_RPC_URL:?definí BASE_SEPOLIA_RPC_URL}"
    : "${EMISOR_CUENTA:?definí EMISOR_CUENTA (dirección del keystore con EMISOR_ROLE)}"
    chain_id="$(cast chain-id --rpc-url "$BASE_SEPOLIA_RPC_URL")"
    [ "$chain_id" = "84532" ] || { echo "error: el RPC devuelve chain id ${chain_id}, se esperaba 84532" >&2; exit 1; }
    clave=()
    [ -n "${KEYSTORE_CLAVE_ARCHIVO:-}" ] && clave=(--password-file "$KEYSTORE_CLAVE_ARCHIVO")
    forge script script/EmitirCredenciales.s.sol:EmitirCredenciales \
      --rpc-url "$BASE_SEPOLIA_RPC_URL" --account curso-dapps "${clave[@]}" --sender "$EMISOR_CUENTA" "${emitir[@]}"
    ;;
  *) echo "red desconocida: $red (anvil | base-sepolia)" >&2; exit 1 ;;
esac
