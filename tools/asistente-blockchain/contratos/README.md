# Contratos del asistente-juego (Foundry)

Cinco contratos para que los niveles del juego dejen rastro en una cadena real. Los visitantes no tienen ETH de
testnet, así que el backend (`backend/cadena.py`) firma y paga el gas como **relayer**: los contratos actúan *en
nombre de* la dirección del visitante (una wallet real generada en su navegador). El Curso 4 usa `approve` firmado por
el usuario; acá se reflejan los mismos eventos pero ejecuta el relayer.

| Contrato | Para qué | Función del relayer |
|---|---|---|
| `SelloLICDIA` | Nivel 1: sellar un mensaje (1 a 120 bytes) y guardar su huella `keccak256` | `sellar(autor, mensaje) → id` |
| `InsigniasLICDIA` | ERC-721 "Insignias LICDIA" (`LICDIA`) con metadatos y SVG 100 % on-chain | `acunar(a, tipo, nombre) → tokenId` |
| `FabricaTokens` | Nivel 2: despliega un `TokenSimple` ERC-20 a nombre del visitante | `crear(dueno, nombre, simbolo, supply) → token` |
| `USDLDemo` | ERC-20 "USD LICDIA Demo" (`USDL`); solo la pasarela lo acuña y lo mueve | — |
| `PasarelaDemo` | Nivel 4: faucet de 100 USDL y pago con recibo NFT | `fondear(v)`, `pagarPor(v, producto, monto) → (pagoId, reciboId)` |

Tipos de `acunar`: 0 a 3 = insignia Curso 1 a 4, 4 = NFT propio (nombre obligatorio, ≤ 24; el dibujo sale del hash del
nombre), 5 = bonus hack, 6 = certificado del recorrido, 7 = recibo de pago (nombre = producto). Del 0 al 6 son
**intransferibles** (cualquier transferencia revierte con `Intransferible`) y hay una sola por dirección
(`YaTieneInsignia`); los recibos se pueden transferir y no tienen tope. El certificado (6) exige tener antes las
cuatro insignias de los cursos (`FaltanInsignias`). El dueño puede quemar cualquiera de sus tokens con `quemar(id)`
(`NoEsDueno` si no es suyo), lo que libera el lugar de un tipo intransferible. Los ids (sellos, tokens, pagos)
arrancan en 1. El backend exige además la firma del visitante para cada acción y fija el nombre de las insignias.

Acceso: todos heredan de `ConRelayers` (`Ownable` + `relayers(address)` + `setRelayer(address,bool)` solo del owner).
La pasarela es relayer de `InsigniasLICDIA` para acuñar los recibos. Un pago sin saldo revierte con
`ERC20InsufficientBalance` de OpenZeppelin (el backend lo chequea antes con `balanceOf` y no manda la tx).

Versiones: solc 0.8.24, `evm_version = cancun`, OpenZeppelin **v5.6.1** y forge-std v1.9.7 instalados en `lib/` con
`forge install --no-git` (no usar OZ 5.7.0: pide un EVM más nuevo).

## Uso

```
forge build
forge test                    # 29 tests (control de acceso, límites, intransferibles, duplicados, saldo, tokenURI)
forge test --gas-report
./exportar-abi.sh             # abi/<Contrato>.json para el backend
```

### Despliegue local (Anvil)

```
anvil --port 8545 &
./desplegar-anvil.sh http://127.0.0.1:8545
```

Usa la cuenta de desarrollo #0 de Anvil (clave pública conocida, sin fondos reales) como owner y, salvo que se defina
`RELAYER`, también como relayer. Se niega a correr si el RPC no es chain id 31337. Escribe `deploy/31337.json`:

```json
{"chainId": 31337, "contratos": {"SelloLICDIA": "0x…", "InsigniasLICDIA": "0x…", "FabricaTokens": "0x…",
 "USDLDemo": "0x…", "PasarelaDemo": "0x…"}, "relayer": "0x…", "comercio": "0x…", "owner": "0x…", "bloque": 0}
```

`bloque` es el último bloque antes del despliegue: desde ahí conviene buscar eventos.

### Base Sepolia (lo corre una persona, no la automatización)

```
export BASE_SEPOLIA_RPC_URL=…   RELAYER=0x…   # COMERCIO opcional
./desplegar-base-sepolia.sh
```

Firma con el keystore de Foundry `curso-dapps` (la contraseña se pide en la terminal, nunca se guarda), verifica en
Sourcify y deja `deploy/84532.json`. El relayer necesita ETH de testnet para pagar el gas. Explorador:
https://base-sepolia.blockscout.com.
