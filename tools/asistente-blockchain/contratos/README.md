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
forge test                    # 52 tests: 29 del juego + 23 de CredencialLICDIA (incluye un fuzz)
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

## CredencialLICDIA (credenciales oficiales)

ERC-721 **intransferible** (ERC-5192: `locked(id)` siempre `true`, evento `Locked` al emitir) para las credenciales
oficiales de la Diplomatura de Posgrado en Blockchain. Es independiente de los contratos del juego: no usa relayer y
solo la universidad emite. Su interfaz de lectura la fija `js/bc-verificar.js` (`ABI_CRED`) y la página
`/blockchain-dev/verificar/`.

- Roles (`AccessControl`): el que despliega queda con `DEFAULT_ADMIN_ROLE` (da y quita emisores) y `EMISOR_ROLE`.
- `emitir(a, cohorte, alcance, actoHash, nombre, mencion)` y `emitirLote(cohorte, [(a, alcance, actoHash, nombre,
  mencion)])` (hasta 50 por tx, todo o nada). `alcance`: 0 = Diplomatura completa, 1 a 4 = Curso 1 a 4. `nombre`
  obligatorio (≤ 64 bytes), `mencion` opcional (≤ 64), `actoHash` = SHA-256 del PDF del acto (no puede ser cero).
  Una sola credencial vigente por (dirección, cohorte, alcance): `YaEmitida`. Si se revoca, se puede reemitir.
- `revocar(id, motivo)`: no borra nada; `verify` pasa a devolver `vigente = false` con el motivo (≤ 140 bytes).
- `verify(id) → (vigente, titular, Datos)`, `tokenURI` (JSON y SVG on-chain, muestra VIGENTE o REVOCADA),
  `tokenOfOwnerByIndex`, `totalEmitidas`. Transferir, aprobar o quemar revierte.
- En la cadena solo va el nombre que la persona aceptó publicar: nada de DNI, mail ni legajo. Es público e imborrable.

### Desplegar

```
./desplegar-credencial.sh anvil http://127.0.0.1:8545     # cuenta dev #0 de Anvil
# Base Sepolia, lo corre una persona con el keystore curso-dapps (queda como admin y emisor):
export BASE_SEPOLIA_RPC_URL=…  DEPLOYER=0x…               # EMISOR=0x… opcional: otra billetera emisora
./desplegar-credencial.sh base-sepolia
```

Agrega `contratos.CredencialLICDIA` y un bloque `credenciales` (`address`, `bloque`, `admin`, `emisor`) a
`deploy/<chainid>.json` sin tocar lo demás. Ojo: `desplegar-anvil.sh` reescribe ese archivo, así que en Anvil
conviene desplegar el juego primero y la credencial después. En Base Sepolia verifica el código en Sourcify.

Después del despliegue real, copiar a `blockchain-dev/verificar/config.json`:

```json
"credenciales": { "address": "<credenciales.address>", "bloque": <credenciales.bloque> }
```

Mientras `address` esté vacío la página dice que todavía no se emitieron credenciales.

### Emitir

1. Hash del acto: `echo 0x$(sha256sum acto.pdf | cut -d' ' -f1)`.
2. Armar `emisiones/<archivo>.json` con el formato de `emisiones/ejemplo.json` (`cohorte` y una lista `egresados`
   con `direccion`, `alcance`, `actoHash`, `nombre`, `mencion`). Los archivos reales no se suben al repo
   (`.gitignore`).
3. Emitir (valida todo antes de mandar; las filas ya emitidas se omiten, así que se puede repetir):

```
SIMULAR=1 ./emitir-credenciales.sh base-sepolia emisiones/2026.json      # solo simula
EMISOR_CUENTA=0x… ./emitir-credenciales.sh base-sepolia emisiones/2026.json
./emitir-credenciales.sh anvil emisiones/ejemplo.json                     # local
```

Una sola, a mano:

```
cast send <CONTRATO> "emitir(address,uint16,uint8,bytes32,string,string)" <BILLETERA> 2026 0 0x<SHA256> "Nombre" "" \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" --account curso-dapps
```

### Revocar y dar emisores

```
cast send <CONTRATO> "revocar(uint256,string)" <TOKEN_ID> "Motivo" --rpc-url "$BASE_SEPOLIA_RPC_URL" --account curso-dapps
cast send <CONTRATO> "grantRole(bytes32,address)" $(cast keccak EMISOR_ROLE) <BILLETERA> --rpc-url … --account curso-dapps
cast call <CONTRATO> "verify(uint256)(bool,address,(uint16,uint8,uint64,bool,bytes32,string,string,string))" 1 --rpc-url …
```
