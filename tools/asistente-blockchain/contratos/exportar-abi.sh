#!/usr/bin/env bash
# Builds the contracts and exports each ABI to abi/<Name>.json (used by backend/cadena.py; CredencialLICDIA is read
# by js/bc-verificar.js, which keeps its own human-readable ABI).
set -euo pipefail
cd "$(dirname "$0")"
forge build --silent
mkdir -p abi
for nombre in SelloLICDIA InsigniasLICDIA FabricaTokens TokenSimple USDLDemo PasarelaDemo CredencialLICDIA; do
  archivo="out/${nombre}.sol/${nombre}.json"
  [ "$nombre" = TokenSimple ] && archivo="out/FabricaTokens.sol/TokenSimple.json"
  jq '.abi' "$archivo" > "abi/${nombre}.json"
done
echo "ABIs en $(pwd)/abi"
