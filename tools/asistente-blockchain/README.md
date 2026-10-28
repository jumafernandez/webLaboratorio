# Asistente-juego de la Diplomatura en Blockchain

Asistente de https://licdia.unlu.edu.ar/blockchain-dev/ que, en vez de explicar blockchain, la hace
jugar. Es un widget embebido en la portada: a la izquierda el chat, a la derecha un **escenario** donde pasan cosas en
una blockchain que corre en el navegador del visitante. Cada curso de la diplomatura es un **nivel**; cada nivel
completo da una **insignia** (un NFT en la wallet del visitante); con las cuatro llega un certificado simbólico del
recorrido. Por el chat se puede preguntar cualquier cosa de la diplomatura: responde un agente con Claude que conoce
todo el sitio y que maneja el escenario (arranca niveles, muestra partes del sitio, lleva a secciones de la página).

Como dev-ia, el juego se abre a pantalla completa al entrar (`main.js` trae `app.js` y los niveles en ese momento),
salvo que la URL traiga un ancla o que la persona haya elegido antes el sitio convencional (queda `bcw-vista=sitio`
en localStorage). También se abre
desde el lanzador, el selector, un botón `data-bcw-nivel` o `?bcw=open` / `?bcw=c1` en un enlace. `?vista=sitio` siempre
arranca en el sitio. Abierto se comporta como un diálogo modal (`role="dialog"
aria-modal`, el resto de la página `inert`, Tab atrapado, Escape cierra y el foco vuelve a quien lo abrió). A pantalla
completa: una portada sobre un fondo animado (carrusel
3D con los bloques reales de la cadena del navegador minándose en vivo, constelación de nodos y hashes flotando), un
selector **Juego | Sitio convencional** que se recuerda, y
**Ver por dentro**, que muestra la cadena bloque por bloque y lo que hizo el agente en la última pregunta (herramientas,
tokens, caché, costo, tiempos). Con "reducir movimiento" activado en el sistema, el fondo se dibuja quieto.

Está publicado en el sitio: `widget/` se copia a `js/blockchain-juego/` y `css/blockchain-juego.css` con
`despliegue/exportar_widget.sh`, y el backend corre en la VM con la cadena en Base Sepolia (`CADENA_MODO=real`). Con `DEV=1`
también corre aparte, sirviendo el sitio real con el widget inyectado.

## Los niveles

| Nivel | Curso | Qué hace el visitante |
|---|---|---|
| 1 · Que nada se pueda borrar | Fundamentos | Escribe un mensaje y ve su SHA-256 cambiar en vivo, lo mina (prueba de trabajo real, hash con `000`), llega otro bloque encima y lo intenta adulterar: la cadena se rompe. |
| 2 · Creá tu propia moneda | DeFi | Crea un token ERC-20 (nombre, símbolo, supply), abre un pool `x · y = k`, mueve el precio con compradores y una ballena (slippage) y hace un rug pull. |
| 3 · Intentá tirar la red | Infraestructura | Apaga nodos de una red de 7 (Luján, CABA, Rosario…) con quórum de 5: la red sigue, después se frena, después vuelve sola. Cierra con una capa 2 que empaqueta 100 tx en una. |
| 4 · Pagá con cripto | DApps | Usa la pasarela del Curso 4: faucet de 100 USDL, `approve`, `pay`, eventos, NFT recibo; y un `revert` por saldo insuficiente. |
| Bonus · Hacete un NFT | — | Diseño y nombre propios, minteo ERC-721. |
| Bonus · Hackeá un contrato | — | Drena una bóveda con reentrancy (The DAO) y la arregla con Checks-Effects-Interactions. |

El hash, el minado y la detección de adulteración son reales (Web Crypto en el navegador). Por defecto
(`CADENA_MODO=simulado`) wallet, transacciones, contratos y NFTs son **simulados** y el cartel "DEMO · cadena simulada"
lo aclara. Con `CADENA_MODO=real` el juego escribe en una cadena de verdad (Anvil local o Base Sepolia) con los
contratos de `contratos/`: la wallet es un par de claves real generado en el navegador, cada acción la firma el
visitante (EIP-191) y la ejecuta el relayer del backend, que paga el gas (ver "Cadena real en local").

## Arquitectura

```
navegador                                            servidor (FastAPI)
┌───────────────────────────────────────────┐        ┌──────────────────────────────────────────┐
│ widget/app.js    flujos, chat, escenario  │  SSE   │ backend/app.py                           │
│   ├─ niveles/*.js   un módulo por nivel   │◄──────►│   POST /blockchain-dev/api/chat          │
│   ├─ cadena.js      SHA-256, PoW, cadena  │        │     Claude + herramientas = acciones UI  │
│   ├─ juego.js       insignias, progreso   │        │   GET  /blockchain-dev/api/estado        │
│   └─ sitio.js       tarjetas del sitio    │        │   POST /blockchain-dev/api/evento        │
└───────────────────────────────────────────┘        │ backend/registro.py  topes + registro    │
                                                     │ conocimiento/sitio.md  texto del sitio   │
                                                     └──────────────────────────────────────────┘
```

**Widget** (`widget/`, módulos ES sin build; `main.js` es solo el lanzador y carga `app.js` a pedido). Todo nivel, tema o turno del agente corre como un *flujo*; empezar uno
nuevo cancela el anterior (su pregunta pendiente se resuelve y cualquier llamada posterior a `ctx` corta), así las
animaciones largas se detienen solas. Los niveles usan una API chica: `ctx.bot()`, `ctx.choose()`, `ctx.ask()`,
`ctx.until()` (esperar algo del escenario), `ctx.scene()`, `ctx.award()`, `ctx.bridge()`. Sin backend, el widget pasa
a rutear por palabras clave: la página nunca se rompe.

**Agente** (`backend/app.py`). Mismo esquema que el asistente de dev-ia: FastAPI, SDK oficial de Anthropic,
`backend/llm.json` (Sonnet 5.5 con `between_tools`, igual que dev-ia), topes y registro anónimo con
`backend/registro.py` **copiado sin cambios** de `tools/asistente-dev-ia`. Diferencias:

- **Sin embeddings.** El sitio de Blockchain entero (~113 KB) va en la parte fija del prompt de sistema
  con prompt caching; `ingesta/extraer_sitio.py` lo regenera. A partir de la segunda pregunta en cinco minutos esa parte
  se cobra al 10 %.
- **Sabe qué se da en clase.** En la misma parte fija van los fragmentos de clase con lo que dice el docente
  (`conocimiento/fragmentos.json`, de `blockchain-dev/fragmentos/fragmentos.json` y sus `.vtt`) y un resumen de cada
  clase de la cohorte 2026 (`conocimiento/clases.md`, de `ingesta/extraer_clases.py`). `clases.md` sale de las planillas
  y los `claseN.json` de `/temas-por-clase`, que son privados: no se versiona, y el script se corta si aparece un nombre
  de alumno. El juego manda en el estado qué fragmentos vio la persona (en el juego o en la portada), y cuando uno
  termina pregunta qué le pareció y ofrece las repreguntas del catálogo.
- **Herramientas que manejan el escenario.** `jugar_nivel(nivel, ejemplo)`, `mostrar_sitio(tema, curso)`,
  `mostrar_fragmento(id)`, `llevar_al_sitio(seccion)`, `sugerir(opciones)`. No se ejecutan en el servidor: cada llamada se valida contra su
  esquema y viaja al navegador como evento `accion`. Con `ejemplo`, el agente adapta el nivel al rubro de la persona
  ("soy contador" → Nivel 1 con "lo mismo sirve para sellar una factura y probar que nadie la tocó").
- **Una vuelta casi siempre.** El prompt pide texto y herramientas en el mismo turno; solo si el modelo llamó
  herramientas sin escribir nada se hace una segunda vuelta con los resultados.
- **Estado del juego** (insignias, niveles pendientes, nivel en curso) en un bloque aparte del último mensaje, después
  del punto de caché.

Eventos SSE de `/api/chat`: `texto {t}`, `accion {tipo, …}`, `error {mensaje}`, `fin {modelo, acciones, usd, …}`.

## Desarrollo

```
uv sync
cp .env.example .env            # completar LLM_API_KEY (sin clave, el widget funciona sin IA)
uv run uvicorn backend.app:app --port 8765
# http://127.0.0.1:8765/blockchain-dev/?bcw=open
uv run --group dev pytest -q tests/      # loop del agente con un cliente de Anthropic simulado
node tests/e2e/jugar_todo.mjs 1440 900   # partida completa en Chrome headless (también 390 844 = celular)
node tests/e2e/ramas.mjs                 # 15 ramas alternativas, cada una en un navegador limpio
uv run python ingesta/evaluar_respuestas.py   # 24 preguntas al agente real (~US$ 0,37) → ingesta/evaluacion.md
python3 ingesta/extraer_sitio.py         # cuando cambia el sitio
uv run --with openpyxl python -I ingesta/extraer_clases.py --planilla 1 X.xlsx --carpeta 3 DIR/clases --roster R.txt
```

Con `DEV=1` el backend sirve también el sitio (la raíz de este repo, `../..`), inyecta el widget en `/blockchain-dev/` y saca el
píxel de Meta, Doppler y web-vitals para no ensuciar las métricas reales.

`GET /blockchain-dev/api/estado` devuelve además `"cadena": {modo, chain_id, red, explorador, disponible}` y
`"medicion": true|false`, para que el widget elija entre la cadena real y la simulada y sepa si mide.

### Cadena real en local (Anvil)

Por defecto `CADENA_MODO=simulado`: todo `/api/cadena/*` responde 409 `modo_simulado` y el widget usa su cadena del
navegador. Para probar la cadena real sin tocar ninguna red pública, todo de una (Anvil + despliegue + servidor):

```
bash scripts/dev-real.sh                       # servidor en 8766, Anvil en 8545; Ctrl+C corta los dos
PUERTO=8770 ANVIL_PUERTO=18545 BLOQUE=2 bash scripts/dev-real.sh   # otros puertos; bloques cada 2 s como Base
```

O a mano, en tres terminales:

```
anvil --chain-id 31337                                  # 1) nodo local
./contratos/desplegar-anvil.sh http://127.0.0.1:8545    # 2) contratos → contratos/deploy/31337.json y contratos/abi/
CADENA_MODO=real CADENA_RPC=http://127.0.0.1:8545 CADENA_CHAIN_ID=31337 \
CADENA_DEPLOY="$PWD/contratos/deploy/31337.json" \
CADENA_CLAVE_DEV=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
DEV=1 uv run uvicorn backend.app:app --port 8766        # 3) backend en modo real
curl -s http://127.0.0.1:8766/blockchain-dev/api/cadena/estado
```

`CADENA_CLAVE_DEV` es la cuenta de desarrollo #0 de Anvil (pública, publicada en la documentación de Foundry) y el
backend la rechaza en cualquier red que no sea 31337. Para Base Sepolia van `CADENA_KEYSTORE` y
`CADENA_KEYSTORE_CLAVE_ARCHIVO` (rutas, nunca la clave en `.env`); todas las variables están en `.env.example`.

Cada escritura (`/cadena/sellar|token|fondear|pagar|insignia`) lleva `firma`, `expira` y `nonce`: el navegador firma
con la clave de la wallet el texto de `cadena.mensaje_a_firmar()` (acción, red, contrato, dirección, campos,
vencimiento, nonce) y el backend verifica que la firma sea de `direccion` antes de tocar el nodo; cada firma vale una
vez. Así nadie puede gastar el USDL de otro visitante ni acuñarle insignias. Las insignias de los cursos, el hack y el
certificado llevan nombre fijo (solo el NFT propio lo elige el visitante) y el contrato exige los cuatro cursos para
el certificado. Topes: pedidos por minuto y por día por origen (con o sin tx), tx por origen y globales, y cuatro
escrituras en curso a la vez. `X-Real-IP` solo se cree si la conexión viene de `PROXIES_CONFIABLES`.

### Medición

El embudo anónimo se ve en `http://127.0.0.1:<puerto>/blockchain-dev/api/panel` (solo con `DEV=1`) o con
`uv run python ingesta/embudo.py --dias 30` (escribe `ingesta/embudo.md`). `MEDICION=0` la apaga.

## Producción

Todo lo necesario está en `despliegue/`, armado igual que `tools/asistente-dev-ia/despliegue/`, y está en uso en la VM.

| Archivo | Qué es |
|---|---|
| `asistente-blockchain.service` | Unidad de systemd: usuario `asistente` (el mismo de dev-ia), `127.0.0.1:8021`, `DEV=0`, proxy de la UNLu, `EnvironmentFile=/opt/asistente-blockchain/.env`, `StateDirectory=asistente-blockchain` (topes, registro y contadores en `/var/lib/asistente-blockchain/asistente.sqlite3`), endurecimiento y `MemoryMax=512M`. |
| `nginx-zonas.conf` | Zonas `bc_chat` (15/min), `bc_estado` (120/min), `bc_evento` (30/min), `bc_medicion` (60/min) y `bc_cadena` (12/min), en `conf.d/`. |
| `nginx-snippet.conf` | `location`s exactos de `/blockchain-dev/api/` (`chat` solo POST y con SSE sin búfer: `proxy_buffering off`, `proxy_cache off`, HTTP/1.1, sin gzip, 120 s; `estado` solo GET; `evento` solo POST; `m` solo POST; `cadena/estado` solo GET y `cadena/(sellar|token|fondear|pagar|insignia)` solo POST con 60 s; todos con `X-Real-IP $remote_addr`) y 404 para el resto. Probado con `nginx -t` y contra un backend local: SSE en flujo, 403 a otros métodos, 429 al pasar la ráfaga. |
| `asistente-blockchain.env.example` | Plantilla del `.env` de la VM: `LLM_API_KEY` vacía, `DEV=0`, `PROXIES_CONFIABLES=127.0.0.1`, `MEDICION` y las `CADENA_*` con los mismos nombres que lee `backend/cadena.py` (`CADENA_MODO=simulado` por defecto). El keystore del relayer nunca va ahí: `LoadCredential=` en la unidad y la ruta en `CADENA_KEYSTORE`. |
| `requirements.txt` | Dependencias con versión y hash, exportadas de `uv.lock` (la VM no tiene uv). |
| `instalar.sh` | Primera instalación o cambios de dependencias o de la unidad, con sudo en la VM. |
| `actualizar.sh` | Código nuevo sin sudo, desde la Mac con la VPN. |
| `preguntas.sh [días]` | Resumen de solo lectura del registro: preguntas por día, derivadas, errores, gasto, insignias. |
| `exportar_widget.sh <sitio> [--aplicar]` | Copia `widget/` a `js/blockchain-juego/` y `widget.css` a `css/blockchain-juego.css` de una copia del repo del sitio. Sin `--aplicar` solo simula. No toca el HTML ni hace commit. |

Pasos:

1. **Antes**: revisar los textos de los niveles con el equipo docente (el Nivel 4 con Ciro), correr
   `uv run --group dev pytest -q tests/`, los dos e2e y `ingesta/evaluar_respuestas.py`. Si cambiaron dependencias:
   `uv export --no-dev --format requirements-txt --no-emit-project -o despliegue/requirements.txt`.
2. **Backend**: copiar el proyecto a `~/asistente-blockchain` en la VM (sin `.venv`, `.env`, `datos/`) y correr
   `sudo bash ~/asistente-blockchain/despliegue/instalar.sh`. Pide la clave sin mostrarla, arma
   `/opt/asistente-blockchain/.env` (600) desde la plantilla, instala el entorno (necesita Python 3.12 o más), la regla
   de sudoers para reiniciar solo este servicio (autorizarla igual que la de dev-ia), la unidad, las zonas y el snippet
   de nginx (lo cuelga debajo del `include` de dev-ia) y prueba `/estado` local, por nginx y una pregunta por SSE.
   No viajan `widget/`, `tests/`, `contratos/` ni `ingesta/`.
3. **Widget**: en una copia del repo del sitio, `bash despliegue/exportar_widget.sh <sitio>` (simulación), después con
   `--aplicar`, y agregar a mano antes de `</body>` en `blockchain-dev/index.html`:
   ```
   <link href="../css/blockchain-juego.css" rel="stylesheet" />
   <script type="module" src="../js/blockchain-juego/main.js"></script>
   ```
   Se publica con el flujo normal del sitio. Sin backend el widget anda igual, sin IA.
4. **Día a día**: `bash despliegue/actualizar.sh` para código y `bash despliegue/preguntas.sh 30` para ver qué se
   pregunta. Logs y avisos de tope de gasto en `journalctl -u asistente-blockchain`.

Lista de espera: el widget lleva a `/charla/blockchain/#inscripcion`. Ese ancla existe en el sitio y hoy es la sección
"Inscripción 2026 — Cerrada" con el formulario "Lista de espera — cohorte 2027". Si se reabre la inscripción, el sitio
mueve el `id="inscripcion"` al formulario completo y los textos del widget ("cohorte 2026 completa") quedan viejos.

## Para publicarlo (propuesta, nada hecho)

1. Widget al repo del sitio (`js/blockchain-juego/` + `css/`), y dos etiquetas en `blockchain-dev/index.html`.
2. Backend en `tools/asistente-blockchain/` como servicio de systemd, igual que dev-ia, con un `location
   /blockchain-dev/api/` en nginx y su propia clave y topes.
3. Antes: revisar textos de los niveles con el equipo docente (el Nivel 4 con Ciro), y armar una evaluación de
   respuestas como `ingesta/evaluar_respuestas.py` de dev-ia.

## Cadena real en Base Sepolia (lo hace una persona)

Los contratos de `contratos/` (SelloLICDIA, InsigniasLICDIA, FabricaTokens, USDLDemo, PasarelaDemo) ya corren contra
Anvil en las pruebas. Para la red de prueba pública:

1. Crear la wallet del relayer (keystore cifrado) y cargarle ETH de prueba de Base Sepolia.
2. Con el keystore `curso-dapps` importado en Foundry: `BASE_SEPOLIA_RPC_URL=… RELAYER=0x… ./contratos/desplegar-base-sepolia.sh`
   (pide la contraseña en la terminal, verifica con Sourcify y escribe `contratos/deploy/84532.json`).
3. En la VM: `CADENA_MODO=real`, `CADENA_RPC`, `CADENA_CHAIN_ID=84532`, `CADENA_DEPLOY` y el keystore por
   `LoadCredential=` (ver `despliegue/asistente-blockchain.env.example`), y recargar nginx con el snippet nuevo.


## Excluir las visitas del equipo de la medición

Abrir cualquier página del sitio con `?bcw_equipo=1` (por ejemplo `https://licdia.unlu.edu.ar/blockchain-dev/?bcw_equipo=1`)
deja una marca en el localStorage de ese navegador: mientras esté, el widget no manda ningún evento de medición (ni
`visita`, ni niveles, ni `pregunta_agente`, que el servidor solo escribe si el pedido trae el id de sesión) y tampoco
suma a «hoy los visitantes ganaron…». `?bcw_equipo=0` la saca. Hay que hacerlo una vez por navegador y perfil; los
modos privados la pierden. Las preguntas al agente siguen en el registro de costos (`preguntas`).

## Medición y registro de preguntas

`pregunta_agente` lo escribe el servidor al terminar el turno (el widget manda su id de sesión en `/api/chat`), así que no
depende de que la página siga abierta. Cada pregunta admitida deja su fila en `preguntas` en el momento de admitirla
(`Registro.iniciar`), con `error = interrumpida` hasta que el turno cierra: el contador de topes (`uso`) y el registro
coinciden siempre; las filas `interrumpida` son páginas cerradas a mitad de la respuesta.

## Regenerar el conocimiento del chatbot

```
python3 tools/asistente-blockchain/ingesta/extraer_sitio.py        # desde la raíz del sitio (o de la copia de trabajo)
```

Escribe `conocimiento/sitio.md` con todas las páginas de `blockchain-dev` (menos `gracias-*`, `beca`, `programas-hidden`) y
falla si aparece «Prados». Después de regenerar hay que desplegar el backend (la parte fija del prompt se lee al arrancar).
