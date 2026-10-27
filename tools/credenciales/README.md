# CredencialLICDIA (diseño, sin desplegar)

Contrato de las credenciales oficiales de la Diplomatura de Posgrado en Blockchain (LICDIA, UNLu). Es un ERC-721
intransferible (soulbound, con la interfaz ERC-5192) que **solo la universidad** puede emitir y revocar. Todavía no
está desplegado: la primera cohorte egresa en 2027 y la página `/blockchain-dev/verificar/` muestra "todavía no se
emitieron credenciales" mientras la configuración tenga la dirección vacía.

La cadena no reemplaza al título. El documento oficial es el acto de la UNLu; el contrato guarda el SHA-256 de ese
acto (`actoHash`), el alcance, la cohorte y el estado (vigente o revocada), para que cualquiera lo pueda comprobar.

## Qué guarda cada credencial

| Campo | Contenido |
|-------|-----------|
| `cohorte` | Año de inicio de la cohorte (por ejemplo 2026) |
| `alcance` | 0 = Diplomatura completa, 1 a 4 = Curso 1 a 4 |
| `nombre` | Texto libre de hasta 48 bytes: puede ser un seudónimo o iniciales |
| `mencion` | Opcional, hasta 48 bytes (por ejemplo "Con distinción") |
| `actoHash` | SHA-256 del acto administrativo (no puede ser cero) |
| `emitidaEn` | Fecha de emisión (timestamp del bloque) |
| `revocada`, `motivoRevocacion` | Estado y motivo; una revocada sigue visible |

No hay DNI, mail ni legajo en la cadena. Todo lo que se escribe es público e imborrable: solo conviene escribir lo
que la persona aceptó que sea público.

## Funciones

- `issue(to, cohorte, alcance, nombre, mencion, actoHash)`: solo el owner. Una credencial vigente por (titular, cohorte, alcance); si se revoca, se puede volver a emitir.
- `revoke(tokenId, motivo)`: solo el owner. No borra nada: marca la credencial como revocada con el motivo.
- `verify(tokenId)`: devuelve `(vigente, titular, datos)`.
- `tokenURI(tokenId)`: metadata y SVG generados en la cadena; el SVG muestra VIGENTE o REVOCADA.
- No se puede transferir, aprobar ni quemar. `locked(tokenId)` siempre es verdadero.
- `ERC721Enumerable`: la página lista las credenciales de una dirección con `tokenOfOwnerByIndex`.

## Pruebas

```bash
cd tools/credenciales
git submodule update --init --recursive   # OpenZeppelin v5.6.1 y forge-std v1.9.7
forge test
```

## Cómo desplegarlo (lo hace David, con su keystore)

Nada de esto se ejecuta desde automatizaciones. Requiere el keystore `curso-dapps`
(`cast wallet import curso-dapps --interactive`) con ETH de Base Sepolia para el gas.

```bash
cd tools/credenciales
export BASE_SEPOLIA_RPC_URL=https://sepolia.base.org
export DEPLOYER=0x...   # dirección del keystore curso-dapps: queda como owner

forge script script/Desplegar.s.sol:Desplegar \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" \
  --account curso-dapps --sender "$DEPLOYER" \
  --broadcast --slow \
  --verify --verifier sourcify --chain 84532
```

El script imprime la dirección y el número de bloque. Con `--verify --verifier sourcify` el código queda verificado en
Sourcify, igual que los contratos del juego. Después:

1. Cargar en `blockchain-dev/verificar/config.json`: `credenciales.address` (la dirección) y `credenciales.bloque`.
2. Revisar la página en local antes de publicar.

## Cómo emitir una credencial

1. Calcular el hash del acto oficial: `sha256sum disposicion.pdf` y anteponer `0x`.
2. Emitir con el keystore:

```bash
cast send <CONTRATO> "issue(address,uint16,uint8,string,string,bytes32)" \
  <BILLETERA_DEL_EGRESADO> 2026 0 "Nombre o seudónimo" "" 0x<SHA256_DEL_ACTO> \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" --account curso-dapps
```

3. Para revocar: `cast send <CONTRATO> "revoke(uint256,string)" <TOKEN_ID> "Motivo" ...`.

Para que el egresado compruebe su credencial alcanza con pegar su dirección, el número de token o el hash de la
transacción en `/blockchain-dev/verificar/`.

## Decisiones abiertas

- Qué va en `nombre`: nombre completo, iniciales o seudónimo (queda público para siempre).
- Si la credencial se emite en una testnet (gratis, pero las testnets pueden reiniciarse) o en una red principal de bajo costo.
- Quién custodia la clave del owner y si conviene una multifirma en lugar de una cuenta sola.
- Si se emite una credencial por curso aprobado, solo la de la diplomatura completa, o ambas.
