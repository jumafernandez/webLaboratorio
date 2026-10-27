"""Relayer de la cadena real: el backend firma y paga el gas para que el visitante juegue sin tener ETH de prueba.

El visitante tiene una wallet de verdad generada en su navegador (solo la dirección llega acá). Los contratos de
contratos/ (SelloLICDIA, InsigniasLICDIA, FabricaTokens, USDLDemo, PasarelaDemo) actúan EN NOMBRE de esa dirección: el
relayer los llama y la dirección del visitante queda como autora, dueña del token o pagadora. En el Curso 4 real el
approve lo firma la persona; acá la pasarela emite los mismos eventos pero ejecuta el relayer.

Router de FastAPI con prefijo /blockchain-dev/api/cadena:

    GET  /estado                                           modo, red, contratos, relayer, saldo, bloque, topes
    POST /sellar   {"direccion", "mensaje"}                → tx, bloque, id
    POST /token    {"direccion", "nombre", "simbolo", "supply"} → tx, bloque, token
    POST /fondear  {"direccion"}                           → tx, bloque, saldo_usdl (o "ya_fondeado": true sin tx)
    POST /pagar    {"direccion", "producto", "monto"}      → tx, bloque, pago_id, recibo_id, saldo_usdl
                                                             (409 saldo_insuficiente sin mandar la tx)
    POST /insignia {"direccion", "tipo", "nombre"}         → tx, bloque, token_id (o "ya_tenia": true y el nombre
                                                             que quedó en la cadena, sin tx)
    POST /revisar  {"texto"}                               → ok, motivo (también en modo simulado; no firma ni manda)

Los textos libres (mensaje del sello, nombre y símbolo del token, nombre del NFT) pasan por backend/moderacion.py antes
de la firma: 400 {"error": "texto_rechazado", "motivo"} si tienen insultos, odio, contenido sexual, links, etc.; 503
"sin_revision" si el modelo que revisa no respondió (no se graba nada sin revisar). El widget llama a /revisar apenas
la persona escribe, para pedirle otro texto en vez de caer a la cadena simulada.

Prueba de control: cada escritura lleva además "firma", "expira" y "nonce". El visitante firma con su clave (EIP-191,
personal_sign) el texto de mensaje_a_firmar(): acción, chain id, contrato, dirección, los demás campos del cuerpo,
vencimiento (unix, a lo sumo FIRMA_VIGENCIA s) y un nonce al azar. El backend recupera la dirección de la firma y la
compara con "direccion" antes de cualquier llamada al nodo; cada (dirección, nonce) se usa una sola vez (tabla
cadena_firma). Así nadie puede gastar el USDL de otro, ni acuñarle insignias o sellos a su nombre. Las insignias de
los cursos, el hack y el certificado llevan un nombre fijo (NOMBRES_FIJOS): solo el NFT propio (tipo 4) acepta uno.

Configuración (entorno o .env, se lee solo cada variable pedida): CADENA_MODO=simulado|real (por defecto simulado;
en simulado todo responde 409 {"error": "modo_simulado"} y el widget sigue con su cadena simulada), CADENA_RPC,
CADENA_CHAIN_ID, CADENA_DEPLOY (contratos/deploy/<chainid>.json), y la firma: CADENA_KEYSTORE +
CADENA_KEYSTORE_CLAVE_ARCHIVO (rutas; la clave se descifra en memoria y nunca se registra ni se devuelve) o
CADENA_CLAVE_DEV, que solo se acepta con chain id 31337 (Anvil). Topes opcionales: CADENA_TX_POR_ORIGEN (40 por día
por dirección de origen), CADENA_TX_POR_DIA (600 en total) y CADENA_MIN_ETH (0.0005: por debajo, 503 sin_fondos).
CADENA_EXPLORADOR pisa el explorador por defecto (Blockscout de Base Sepolia para 84532; ninguno en Anvil).

Antes de tocar el nodo, cada pedido pasa por un tope de pedidos por origen (por minuto, en memoria, y por día, en la
base) y por un cupo de escrituras en curso (ENVIOS_EN_CURSO, esperado en el bucle de eventos sin ocupar hilos). Los
cerrojos se toman con un plazo corto (si no, 429 ocupado). /estado y el saldo del relayer se guardan unos segundos.

Los envíos se serializan con un cerrojo y el nonce se lleva acá (si una tx no se confirma a tiempo se mira si se cayó
del mempool para resincronizar el nonce, o se la reemplaza con más tarifa); cada dirección de visitante tiene además su propio
cerrojo para que dos pedidos simultáneos no pasen los dos el chequeo previo (ya fondeado, ya tiene la insignia,
saldo). Antes de mandar se estima el gas: si el contrato rechazaría la tx no se gasta nada. Los contadores van en la
misma base SQLite que backend/registro.py (tablas cadena_uso y cadena_sal), con el origen en un hash con sal diaria,
nunca la IP. Los errores nunca devuelven trazas, mensajes del nodo (pueden traer la URL del RPC) ni la clave.

Para enchufarlo en backend/app.py:

    from backend import cadena
    CADENA = cadena.Cadena(REGISTRO.db, REGISTRO.cerrojo)
    app.include_router(cadena.crear_router(CADENA))
"""

import asyncio
import hashlib
import json
import os
import pathlib
import re
import secrets
import sqlite3
import threading
import time
import unicodedata
from collections import deque
from decimal import Decimal

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from backend.moderacion import Moderador
from backend.origen import origen_de
from backend.registro import CORREO, NUMERO

RAIZ = pathlib.Path(__file__).resolve().parents[1]
ABI_DIR = RAIZ / "contratos" / "abi"
CONTRATOS = ("SelloLICDIA", "InsigniasLICDIA", "FabricaTokens", "USDLDemo", "PasarelaDemo")

PRODUCTOS = {"cafe": 5, "apunte": 15, "entrada": 25, "auto": 500}      # precio en USDL enteros
TIPOS_INSIGNIA = range(7)           # 0..3 cursos, 4 NFT propio, 5 hack, 6 certificado (7 = recibo: solo vía /pagar)
TIPO_NFT = 4
# Lo fija el servidor: un tercero no puede elegir el texto de una insignia ajena (iguales a widget/juego.js)
NOMBRES_FIJOS = {0: "Insignia Bloques", 1: "Insignia DeFi", 2: "Insignia Red", 3: "Insignia DApps",
                 5: "Bonus Auditoría", 6: "Recorrido completo"}
# Contrato que firma el visitante en cada acción
CONTRATO_DE = {"sellar": "SelloLICDIA", "token": "FabricaTokens", "fondear": "PasarelaDemo", "pagar": "PasarelaDemo",
               "insignia": "InsigniasLICDIA"}
CAMPOS_FIRMA = frozenset({"firma", "expira", "nonce"})
FIRMA_VIGENCIA = 600                # segundos hacia adelante como máximo
NONCE_FIRMA = re.compile(r"[0-9a-f]{16,64}")
FIRMA = re.compile(r"0x[0-9a-fA-F]{130}")
MAX_MENSAJE = 120                   # bytes, igual que los contratos
MAX_NOMBRE = 24
MAX_SIMBOLO = 5
MAX_SUPPLY = 21_000_000
ESPERA_RECIBO = 20                  # segundos (el widget espera 45: el peor caso del backend es menor)
ENVIOS_EN_CURSO = 4                 # escrituras a la vez; las demás esperan hasta ESPERA_CUPO en el bucle de eventos
ESPERA_CUPO = 3.0
ESPERA_CERROJO = 1.0
CACHE_ESTADO = 3.0                  # segundos que se reusa /estado
CACHE_SALDO = 5.0
RESYNC_TRAS = 5.0                   # tras este rato sin enviar, el nonce local se compara con el del nodo
REDES = {31337: "Anvil (local)", 84532: "Base Sepolia"}
EXPLORADORES = {84532: "https://base-sepolia.blockscout.com"}
CLAVE_DEV_CHAIN = 31337
CONTROL = re.compile(r"[\x00-\x1f\x7f]")
# Fechas (26-10-2026, 26/10/26) y números redondos (1.000.000) no son datos personales en un sello
FECHA = re.compile(r"\b\d{1,2}[-/.]\d{1,2}[-/.](?:\d{4}|\d{2})\b")
REDONDO = re.compile(r"\b\d{1,3}(?:\.000)+\b")
VARIABLES = {"CADENA_MODO", "CADENA_RPC", "CADENA_CHAIN_ID", "CADENA_DEPLOY", "CADENA_KEYSTORE",
             "CADENA_KEYSTORE_CLAVE_ARCHIVO", "CADENA_CLAVE_DEV", "CADENA_EXPLORADOR", "CADENA_TX_POR_ORIGEN",
             "CADENA_TX_POR_DIA", "CADENA_MIN_ETH", "CADENA_PEDIDOS_POR_MINUTO", "CADENA_PEDIDOS_POR_ORIGEN",
             "CADENA_PROXIES_CONFIABLES"}

ESQUEMA = """
CREATE TABLE IF NOT EXISTS cadena_sal (dia TEXT PRIMARY KEY, valor TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS cadena_uso (dia TEXT NOT NULL, clave TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0,
                                       PRIMARY KEY (dia, clave));
CREATE TABLE IF NOT EXISTS cadena_firma (direccion TEXT NOT NULL, nonce TEXT NOT NULL, expira INTEGER NOT NULL,
                                         PRIMARY KEY (direccion, nonce));
"""


class Rechazo(Exception):
    """Respuesta de error controlada: código HTTP + cuerpo JSON sin detalles internos."""

    def __init__(self, estado: int, error: str, **extra):
        super().__init__(error)
        self.estado = estado
        self.cuerpo = {"error": error, **extra}


def leer_env(nombre: str) -> str | None:
    """Del entorno o de .env (solo la variable pedida: no se vuelca el archivo ni se leen otras claves)."""
    if nombre in os.environ:
        return os.environ[nombre]
    f = RAIZ / ".env"
    if f.exists():
        for linea in f.read_text(encoding="utf-8").splitlines():
            k, _, v = linea.strip().partition("=")
            if k.strip() == nombre and not linea.lstrip().startswith("#"):
                return v.strip()
    return None


def configuracion() -> dict:
    """Lee la configuración del entorno. La clave queda solo como ruta o valor a usar una vez al conectar."""
    def numero(nombre, defecto, tipo=int):
        v = leer_env(nombre)
        return tipo(v) if v not in (None, "") else defecto

    return {
        "modo": (leer_env("CADENA_MODO") or "simulado").strip().lower(),
        "rpc": leer_env("CADENA_RPC") or "",
        "chain_id": numero("CADENA_CHAIN_ID", None),
        "deploy": leer_env("CADENA_DEPLOY") or "",
        "keystore": leer_env("CADENA_KEYSTORE") or "",
        "keystore_clave_archivo": leer_env("CADENA_KEYSTORE_CLAVE_ARCHIVO") or "",
        "clave_dev": leer_env("CADENA_CLAVE_DEV") or "",
        "explorador": leer_env("CADENA_EXPLORADOR") or None,
        "tx_por_origen": numero("CADENA_TX_POR_ORIGEN", 40),
        "tx_por_dia": numero("CADENA_TX_POR_DIA", 600),
        "min_eth": numero("CADENA_MIN_ETH", Decimal("0.0005"), Decimal),
        "pedidos_por_minuto": numero("CADENA_PEDIDOS_POR_MINUTO", 20),
        "pedidos_por_origen": numero("CADENA_PEDIDOS_POR_ORIGEN", 300),
    }


def avisar_variables_desconocidas() -> list[str]:
    """CADENA_* que el backend no lee (un nombre mal escrito deja el valor por defecto en silencio)."""
    nombres = {k for k in os.environ if k.startswith("CADENA_")}
    f = RAIZ / ".env"
    if f.exists():
        for linea in f.read_text(encoding="utf-8").splitlines():
            k = linea.strip().partition("=")[0].strip()
            if k.startswith("CADENA_") and not linea.lstrip().startswith("#"):
                nombres.add(k)
    raras = sorted(nombres - VARIABLES)
    for k in raras:
        print(f"cadena: AVISO: la variable {k} no existe (ver .env.example); se ignora", flush=True)
    return raras


def mensaje_a_firmar(accion: str, chain_id: int, contrato: str, direccion: str, campos: dict, expira: int,
                     nonce: str) -> str:
    """Texto que firma el visitante (EIP-191). widget/cadena-real.js arma exactamente el mismo."""
    lineas = ["Juego de la Diplomatura en Blockchain (LICDIA, UNLu)", f"accion: {accion}", f"red: {chain_id}",
              f"contrato: {contrato}", f"direccion: {direccion}"]
    lineas += [f"{k}: {campos[k]}" for k in sorted(campos)]
    lineas += [f"expira: {expira}", f"nonce: {nonce}"]
    return "\n".join(lineas)


# ---------- validación de entradas ----------

def _direccion(v) -> str:
    from web3 import Web3
    if not isinstance(v, str) or not re.fullmatch(r"0x[0-9a-fA-F]{40}", v):
        raise Rechazo(400, "direccion_invalida")
    cuerpo = v[2:]
    # EIP-55: con mayúsculas y minúsculas mezcladas tiene que ser el checksum correcto
    if cuerpo != cuerpo.lower() and cuerpo != cuerpo.upper() and not Web3.is_checksum_address(v):
        raise Rechazo(400, "direccion_invalida")
    if int(v, 16) == 0:
        raise Rechazo(400, "direccion_invalida")
    return Web3.to_checksum_address(v)


def _invisible(v: str) -> bool:
    """Controles, formato (bidi U+202E, ancho cero), uso privado y sustitutos: textos engañosos en exploradores y
    wallets. El unión de ancho cero (U+200D) se permite porque arma emojis compuestos."""
    return any(unicodedata.category(ch) in ("Cc", "Cf", "Co", "Cs") and ch != "\u200d" for ch in v)


def _texto(v, error: str, minimo: int, maximo: int) -> str:
    """Texto que va a quedar público y para siempre en la cadena: largo en bytes, sin control ni datos personales."""
    if not isinstance(v, str):
        raise Rechazo(400, error)
    v = v.strip()
    if not minimo <= len(v.encode("utf-8", "surrogatepass")) <= maximo or CONTROL.search(v) or _invisible(v):
        raise Rechazo(400, error)
    sin_fechas = REDONDO.sub(" ", FECHA.sub(" ", v))
    if CORREO.search(v) or NUMERO.search(sin_fechas):
        raise Rechazo(400, "datos_personales")
    return v


def _entero(v, error: str, minimo: int, maximo: int) -> int:
    if isinstance(v, bool) or not isinstance(v, int) or not minimo <= v <= maximo:
        raise Rechazo(400, error)
    return v


# ---------- relayer ----------

class Cadena:
    def __init__(self, db: sqlite3.Connection | None = None, cerrojo: threading.Lock | None = None,
                 conf: dict | None = None):
        if db is None:
            carpeta = pathlib.Path(os.environ.get("STATE_DIRECTORY") or RAIZ / "datos")
            carpeta.mkdir(parents=True, exist_ok=True)
            db = sqlite3.connect(carpeta / "asistente.sqlite3", check_same_thread=False, isolation_level=None,
                                 timeout=5)
        self.db = db
        self.cerrojo_db = cerrojo or threading.Lock()
        with self.cerrojo_db:
            self.db.executescript(ESQUEMA)
        self.conf = conf if conf is not None else configuracion()
        self.modo = "real" if self.conf.get("modo") == "real" else "simulado"
        self.purgado = ""
        self.cerrojo_envio = threading.Lock()       # nonce + firma + envío
        self.cerrojo_conexion = threading.Lock()
        self.cerrojos_direccion = [threading.Lock() for _ in range(64)]
        self.cerrojo_pedidos = threading.Lock()
        self._pedidos: dict[str, deque] = {}          # origen → momentos del último minuto (en memoria)
        self.en_curso = 0                             # escrituras en curso (cupo ENVIOS_EN_CURSO)
        self._estado: tuple[float, dict] | None = None
        self._saldo: tuple[float, int] | None = None
        self._nonce: int | None = None
        self._ultimo_envio = 0.0
        self._listo = False
        self._ultimo_intento = 0.0
        self._cuenta = None                          # LocalAccount; nunca se serializa ni se registra
        self.moderador = Moderador()                 # solo lista local; app.py le pone el cliente de Claude

    def __repr__(self) -> str:
        return f"<Cadena modo={self.modo} listo={self._listo}>"

    # --- conexión (perezosa: importar el módulo o arrancar la app no necesita el nodo) ---

    def conectar(self) -> None:
        if self._listo:
            return
        with self.cerrojo_conexion:
            if self._listo:
                return
            if time.monotonic() - self._ultimo_intento < 2:
                raise Rechazo(503, "no_disponible")
            self._ultimo_intento = time.monotonic()
            try:
                self._conectar()
            except Rechazo:
                raise
            except Exception as e:  # noqa: BLE001 — sin el mensaje: puede traer la URL del RPC
                print(f"cadena: no se pudo conectar ({type(e).__name__})", flush=True)
                raise Rechazo(503, "no_disponible") from None
            self._listo = True

    def _conectar(self) -> None:
        from eth_account import Account
        from web3 import Web3

        c = self.conf
        w3 = Web3(Web3.HTTPProvider(c["rpc"], request_kwargs={"timeout": 10}))
        chain_id = w3.eth.chain_id
        if c.get("chain_id") is not None and int(c["chain_id"]) != chain_id:
            print(f"cadena: el RPC tiene chain id {chain_id}, la configuración pide {c['chain_id']}", flush=True)
            raise Rechazo(503, "no_disponible")
        deploy = json.loads(pathlib.Path(c["deploy"]).read_text(encoding="utf-8"))
        if int(deploy["chainId"]) != chain_id:
            print(f"cadena: el deploy es de la red {deploy['chainId']} y el RPC de la {chain_id}", flush=True)
            raise Rechazo(503, "no_disponible")

        if c.get("keystore"):
            cifrada = json.loads(pathlib.Path(c["keystore"]).read_text(encoding="utf-8"))
            clave = Account.decrypt(cifrada, pathlib.Path(c["keystore_clave_archivo"]).read_text().rstrip("\r\n"))
            cuenta = Account.from_key(clave)
            del clave
        elif c.get("clave_dev"):
            if chain_id != CLAVE_DEV_CHAIN:
                print("cadena: CADENA_CLAVE_DEV solo se acepta en Anvil (31337)", flush=True)
                raise Rechazo(503, "no_disponible")
            cuenta = Account.from_key(c["clave_dev"])
        else:
            print("cadena: falta la firma (CADENA_KEYSTORE o CADENA_CLAVE_DEV)", flush=True)
            raise Rechazo(503, "no_disponible")

        contratos = {}
        for nombre in CONTRATOS:
            abi = json.loads((ABI_DIR / f"{nombre}.json").read_text(encoding="utf-8"))
            contratos[nombre] = w3.eth.contract(address=Web3.to_checksum_address(deploy["contratos"][nombre]),
                                                abi=abi)
        if not contratos["SelloLICDIA"].functions.relayers(cuenta.address).call():
            print(f"cadena: {cuenta.address} no es relayer de los contratos del deploy", flush=True)
            raise Rechazo(503, "no_disponible")

        self.w3, self.chain_id, self.deploy, self.contratos, self._cuenta = w3, chain_id, deploy, contratos, cuenta
        self.errores = self._selectores_de_error()
        self.explorador = c.get("explorador") or EXPLORADORES.get(chain_id)
        self.relayer = cuenta.address

    def _selectores_de_error(self) -> dict[str, str]:
        """Selector de 4 bytes → nombre del error, de todos los ABIs (para traducir un revert sin mostrar datos)."""
        from web3 import Web3
        salida = {}
        for nombre in (*CONTRATOS, "TokenSimple"):
            for e in json.loads((ABI_DIR / f"{nombre}.json").read_text(encoding="utf-8")):
                if e.get("type") == "error":
                    firma = f"{e['name']}({','.join(i['type'] for i in e['inputs'])})"
                    salida["0x" + Web3.keccak(text=firma).hex().removeprefix("0x")[:8]] = e["name"]
        return salida

    # --- topes ---

    def _clave(self, dia: str, origen: str) -> str:
        self.db.execute("INSERT OR IGNORE INTO cadena_sal VALUES (?, ?)", (dia, secrets.token_hex(16)))
        sal = self.db.execute("SELECT valor FROM cadena_sal WHERE dia = ?", (dia,)).fetchone()[0]
        return "ip:" + hashlib.sha256((sal + origen).encode()).hexdigest()[:24]

    def _usados(self, dia: str, clave: str) -> int:
        fila = self.db.execute("SELECT n FROM cadena_uso WHERE dia = ? AND clave = ?", (dia, clave)).fetchone()
        return fila[0] if fila else 0

    def _purgar(self, dia: str) -> None:
        if self.purgado != dia:
            self.db.execute("DELETE FROM cadena_sal WHERE dia < ?", (dia,))
            self.db.execute("DELETE FROM cadena_uso WHERE dia < date(?, '-2 days')", (dia,))
            self.purgado = dia

    def _sumar(self, dia: str, clave: str) -> None:
        self.db.execute("INSERT INTO cadena_uso (dia, clave, n) VALUES (?, ?, 1) ON CONFLICT (dia, clave) "
                        "DO UPDATE SET n = n + 1", (dia, clave))

    def admitir(self, origen: str, contar: bool = True) -> None:
        """Topes de tx. Con contar=False solo verifica (antes de gastar RPC); con True vuelve a verificar y cuenta."""
        dia = time.strftime("%Y-%m-%d")
        with self.cerrojo_db:
            self._purgar(dia)
            clave = self._clave(dia, origen)
            if self._usados(dia, "global") >= self.conf["tx_por_dia"]:
                raise Rechazo(429, "tope_global")
            if self._usados(dia, clave) >= self.conf["tx_por_origen"]:
                raise Rechazo(429, "tope_origen")
            if contar:
                for k in (clave, "global"):
                    self._sumar(dia, k)

    def admitir_pedido(self, origen: str) -> None:
        """Tope de PEDIDOS a /cadena/* (manden tx o no): por minuto en memoria y por día en la base. Corre en el bucle
        de eventos antes de tomar hilos, cerrojos o el nodo; las consultas a SQLite son cortas."""
        ahora = time.monotonic()
        with self.cerrojo_pedidos:
            q = self._pedidos.setdefault(origen, deque())
            while q and ahora - q[0] > 60:
                q.popleft()
            if len(q) >= self.conf["pedidos_por_minuto"]:
                raise Rechazo(429, "demasiados_pedidos")
            q.append(ahora)
            if len(self._pedidos) > 5000:               # no crece sin límite: se olvidan los orígenes quietos
                for k in [k for k, v in self._pedidos.items() if not v or ahora - v[-1] > 60]:
                    del self._pedidos[k]
        dia = time.strftime("%Y-%m-%d")
        with self.cerrojo_db:
            self._purgar(dia)
            clave = "pedidos:" + self._clave(dia, origen)
            if self._usados(dia, clave) >= self.conf["pedidos_por_origen"]:
                raise Rechazo(429, "demasiados_pedidos")
            self._sumar(dia, clave)

    def usar_firma(self, direccion: str, nonce: str, expira: int) -> None:
        """Cada firma vale una vez: (dirección, nonce) queda anotado hasta que vence."""
        with self.cerrojo_db:
            self.db.execute("DELETE FROM cadena_firma WHERE expira < ?", (int(time.time()),))
            cur = self.db.execute("INSERT OR IGNORE INTO cadena_firma VALUES (?, ?, ?)", (direccion, nonce, expira))
            if cur.rowcount == 0:
                raise Rechazo(409, "firma_usada")

    def usados_hoy(self) -> int:
        with self.cerrojo_db:
            return self._usados(time.strftime("%Y-%m-%d"), "global")

    # --- lecturas ---

    def saldo_relayer_wei(self) -> int:
        return self.w3.eth.get_balance(self.relayer)

    def _saldo_relayer(self) -> int:
        """Con caché corta: cada pedido no necesita su propio eth_getBalance."""
        if self._saldo and time.monotonic() - self._saldo[0] < CACHE_SALDO:
            return self._saldo[1]
        wei = self.saldo_relayer_wei()
        self._saldo = (time.monotonic(), wei)
        return wei

    def saldo_usdl(self, direccion: str) -> int:
        """En USDL enteros (el contrato usa 18 decimales; el juego solo mueve montos enteros)."""
        return self.contratos["USDLDemo"].functions.balanceOf(direccion).call() // 10**18

    def _explorador(self, ruta: str) -> str | None:
        return f"{self.explorador}/{ruta}" if self.explorador else None

    def estado(self) -> dict:
        self._exigir_real()
        self.conectar()
        guardado = self._estado
        if guardado and time.monotonic() - guardado[0] < CACHE_ESTADO:
            return guardado[1]
        e = {
            "modo": self.modo, "chain_id": self.chain_id, "red": REDES.get(self.chain_id, f"chain {self.chain_id}"),
            "explorador": self.explorador, "contratos": dict(self.deploy["contratos"]), "relayer": self.relayer,
            "saldo_relayer_eth": float(Decimal(self.saldo_relayer_wei()) / Decimal(10**18)),
            "bloque": self.w3.eth.block_number,
            "topes": {"tx_por_origen_por_dia": self.conf["tx_por_origen"], "tx_por_dia": self.conf["tx_por_dia"],
                      "tx_usadas_hoy": self.usados_hoy(), "min_eth": float(self.conf["min_eth"]),
                      "productos": PRODUCTOS, "max_mensaje": MAX_MENSAJE, "max_nombre": MAX_NOMBRE,
                      "max_simbolo": MAX_SIMBOLO, "max_supply": MAX_SUPPLY},
            "ahora": int(time.time()),
        }
        self._estado = (time.monotonic(), e)
        return e

    def _exigir_real(self) -> None:
        if self.modo != "real":
            raise Rechazo(409, "modo_simulado", modo="simulado")

    # --- envío ---

    def _cerrojo_de(self, direccion: str) -> "_Cerrojo":
        return _Cerrojo(self.cerrojos_direccion[int(direccion, 16) % len(self.cerrojos_direccion)])

    def _motivo(self, e: Exception) -> str | None:
        """Nombre del error del contrato en un revert, si se reconoce."""
        datos = getattr(e, "data", None)
        if isinstance(datos, dict):
            datos = datos.get("data")
        if isinstance(datos, str) and datos.startswith("0x"):
            return self.errores.get(datos[:10].lower())
        return None

    def _tarifas(self) -> dict:
        try:
            prioridad = self.w3.eth.max_priority_fee
            base = self.w3.eth.get_block("latest")["baseFeePerGas"]
            return {"maxPriorityFeePerGas": prioridad, "maxFeePerGas": 2 * base + prioridad}
        except Exception:  # noqa: BLE001 — nodo sin EIP-1559: tarifa clásica
            return {"gasPrice": self.w3.eth.gas_price}

    def enviar(self, origen: str, accion: str, llamada) -> tuple[dict, float]:
        """Topes, saldo del relayer, estimación (si revertiría no se manda), firma con nonce local y recibo."""
        from web3.exceptions import ContractCustomError, ContractLogicError, TimeExhausted

        self.admitir(origen, contar=False)           # si ya pasó el tope, ni saldo ni estimación
        if self._saldo_relayer() < int(self.conf["min_eth"] * 10**18):
            print("AVISO: el relayer de la cadena se quedó sin fondos; no manda más transacciones.", flush=True)
            raise Rechazo(503, "sin_fondos")
        try:
            gas = llamada.estimate_gas({"from": self.relayer})
        except (ContractCustomError, ContractLogicError) as e:
            motivo = self._motivo(e)
            if motivo == "NoEsRelayer":
                raise Rechazo(503, "no_disponible") from None
            raise Rechazo(409, "rechazada_por_contrato", motivo=motivo) from None
        self.admitir(origen)

        inicio = time.monotonic()
        if not self.cerrojo_envio.acquire(timeout=10):
            raise Rechazo(429, "ocupado")
        try:
            if self._nonce is not None and time.monotonic() - self._ultimo_envio > RESYNC_TRAS:
                # Si una tx propia se cayó del mempool, el nonce local quedó adelantado (las siguientes irían a la cola
                # de futuras y no se minarían nunca); si otro usó la clave, quedó atrás. En una ráfaga se confía en el
                # local: el "pending" de un RPC con balanceo puede no ver todavía la tx recién mandada.
                en_nodo = self.w3.eth.get_transaction_count(self.relayer, "pending")
                if en_nodo != self._nonce:
                    print(f"cadena: nonce local {self._nonce}, el nodo dice {en_nodo}: se resincroniza", flush=True)
                    self._nonce = en_nodo
            for intento in range(2):
                if self._nonce is None:
                    self._nonce = self.w3.eth.get_transaction_count(self.relayer, "pending")
                tx = llamada.build_transaction({"from": self.relayer, "nonce": self._nonce, "gas": gas * 12 // 10,
                                                "chainId": self.chain_id, **self._tarifas()})
                firmada = self._cuenta.sign_transaction(tx)
                try:
                    hash_tx = self.w3.eth.send_raw_transaction(firmada.raw_transaction)
                except Exception as e:  # noqa: BLE001 — se informa solo el tipo
                    self._nonce = None               # se vuelve a pedir al nodo
                    if intento == 0 and "nonce" in str(e).lower():
                        continue
                    print(f"cadena: {accion} no se pudo mandar ({type(e).__name__})", flush=True)
                    raise Rechazo(502, "fallo_cadena") from None
                self._nonce += 1
                self._ultimo_envio = time.monotonic()
                break
        finally:
            self.cerrojo_envio.release()
        self._saldo = None
        hex_tx = "0x" + hash_tx.hex().removeprefix("0x")
        try:
            recibo = self.w3.eth.wait_for_transaction_receipt(hash_tx, timeout=ESPERA_RECIBO, poll_latency=0.2)
        except TimeExhausted:
            nuevo = self._tras_demora(tx, hex_tx)
            hex_tx = nuevo or hex_tx
            raise Rechazo(504, "sin_confirmar", tx=hex_tx, explorador_tx=self._explorador(f"tx/{hex_tx}")) from None
        ms = (time.monotonic() - inicio) * 1000
        print(f"cadena: {accion} {hex_tx} bloque {recibo['blockNumber']} gas {recibo['gasUsed']} {ms:.0f} ms",
              flush=True)
        if recibo["status"] != 1:
            raise Rechazo(502, "tx_revertida", tx=hex_tx, explorador_tx=self._explorador(f"tx/{hex_tx}"))
        return recibo, ms

    def _tras_demora(self, tx: dict, hex_tx: str) -> str | None:
        """La tx no se confirmó a tiempo. Si se cayó del mempool, el nonce local queda adelantado y todas las que
        siguen irían a la cola de futuras: se resincroniza. Si sigue pendiente, se la reemplaza (mismo nonce, mismos
        datos, tarifa +30 %) para que no trabe a las siguientes. Devuelve el hash del reemplazo, si hubo."""
        nonce = tx["nonce"]
        with self.cerrojo_envio:
            try:
                if self.w3.eth.get_transaction_count(self.relayer, "latest") > nonce:
                    return None                       # se minó (o un reemplazo) mientras tanto
                if self.w3.eth.get_transaction_count(self.relayer, "pending") <= nonce:
                    print(f"cadena: {hex_tx} se cayó del mempool; se resincroniza el nonce", flush=True)
                    self._nonce = None
                    return None
                otra = dict(tx)
                if "gasPrice" in otra:
                    otra["gasPrice"] = max(otra["gasPrice"] * 13 // 10, self.w3.eth.gas_price)
                else:
                    nuevas = self._tarifas()
                    prio = max(otra["maxPriorityFeePerGas"] * 13 // 10, nuevas.get("maxPriorityFeePerGas", 0))
                    otra["maxPriorityFeePerGas"] = prio
                    otra["maxFeePerGas"] = max(otra["maxFeePerGas"] * 13 // 10, nuevas.get("maxFeePerGas", 0), prio)
                firmada = self._cuenta.sign_transaction(otra)
                nuevo = self.w3.eth.send_raw_transaction(firmada.raw_transaction)
                self._ultimo_envio = time.monotonic()
                hex_nuevo = "0x" + nuevo.hex().removeprefix("0x")
                print(f"cadena: {hex_tx} demorada; reemplazo {hex_nuevo} con más tarifa", flush=True)
                return hex_nuevo
            except Exception as e:  # noqa: BLE001 — ante la duda, el nonce se vuelve a pedir al nodo
                print(f"cadena: no se pudo revisar la tx demorada ({type(e).__name__})", flush=True)
                self._nonce = None
                return None

    def _base(self, recibo) -> dict:
        hex_tx = "0x" + recibo["transactionHash"].hex().removeprefix("0x")
        return {"tx": hex_tx, "bloque": recibo["blockNumber"], "explorador_tx": self._explorador(f"tx/{hex_tx}")}

    def _evento(self, contrato: str, evento: str, recibo) -> dict:
        from web3.logs import DISCARD
        logs = getattr(self.contratos[contrato].events, evento)().process_receipt(recibo, errors=DISCARD)
        if not logs:
            raise Rechazo(502, "fallo_cadena")
        return logs[0]["args"]

    def _nft(self, token_id: int) -> str | None:
        return self._explorador(f"token/{self.contratos['InsigniasLICDIA'].address}/instance/{token_id}")

    # --- acciones ---

    def _preparar(self, cuerpo, claves: set[str]) -> dict:
        self._exigir_real()
        if not isinstance(cuerpo, dict) or set(cuerpo) - claves - CAMPOS_FIRMA:
            raise Rechazo(400, "cuerpo_invalido")
        self.conectar()
        return cuerpo

    def moderar(self, *textos: str) -> None:
        """Lo que va a quedar público para siempre no lleva insultos, odio, sexo, links… (backend/moderacion.py)."""
        for t in textos:
            motivo = self.moderador.revisar(t)
            if motivo == "sin_revision":
                raise Rechazo(503, "sin_revision")
            if motivo:
                raise Rechazo(400, "texto_rechazado", motivo=motivo)

    def revisar(self, origen: str, cuerpo) -> dict:
        """Chequeo previo del widget: mismas reglas que una escritura, sin firma ni nodo. Anda en modo simulado."""
        if not isinstance(cuerpo, dict) or set(cuerpo) != {"texto"}:
            raise Rechazo(400, "cuerpo_invalido")
        try:
            texto = _texto(cuerpo.get("texto"), "texto_invalido", 1, MAX_MENSAJE)
        except Rechazo as r:
            return {"ok": False, "motivo": r.cuerpo["error"]}
        motivo = self.moderador.revisar(texto)
        return {"ok": motivo is None, "motivo": motivo or "ok"}

    def verificar_firma(self, accion: str, cuerpo: dict, direccion: str) -> None:
        """La persona que pide controla la dirección: firmó (EIP-191) la acción con su clave. Sin RPC."""
        from eth_account import Account
        from eth_account.messages import encode_defunct

        firma, expira, nonce = cuerpo.get("firma"), cuerpo.get("expira"), cuerpo.get("nonce")
        if not isinstance(firma, str) or not FIRMA.fullmatch(firma) or not isinstance(nonce, str) \
                or not NONCE_FIRMA.fullmatch(nonce) or isinstance(expira, bool) or not isinstance(expira, int):
            raise Rechazo(401, "firma_invalida")
        ahora = int(time.time())
        if expira < ahora or expira > ahora + FIRMA_VIGENCIA:
            raise Rechazo(401, "firma_vencida", ahora=ahora)
        campos = {k: v for k, v in cuerpo.items() if k not in CAMPOS_FIRMA and k != "direccion"}
        contrato = self.contratos[CONTRATO_DE[accion]].address
        texto = mensaje_a_firmar(accion, self.chain_id, contrato, direccion, campos, expira, nonce)
        try:
            firmante = Account.recover_message(encode_defunct(text=texto), signature=firma)
        except Exception:  # noqa: BLE001 — firma mal formada
            raise Rechazo(401, "firma_invalida") from None
        if firmante != direccion:
            raise Rechazo(401, "firma_invalida")
        self.usar_firma(direccion, nonce, expira)

    def sellar(self, origen: str, cuerpo) -> dict:
        c = self._preparar(cuerpo, {"direccion", "mensaje"})
        direccion = _direccion(c.get("direccion"))
        mensaje = _texto(c.get("mensaje"), "mensaje_invalido", 1, MAX_MENSAJE)
        self.verificar_firma("sellar", c, direccion)
        self.moderar(mensaje)
        with self._cerrojo_de(direccion):
            recibo, ms = self.enviar(origen, "sellar",
                                     self.contratos["SelloLICDIA"].functions.sellar(direccion, mensaje))
        return {**self._base(recibo), "id": self._evento("SelloLICDIA", "Sellado", recibo)["id"], "ms": round(ms)}

    def token(self, origen: str, cuerpo) -> dict:
        c = self._preparar(cuerpo, {"direccion", "nombre", "simbolo", "supply"})
        direccion = _direccion(c.get("direccion"))
        nombre = _texto(c.get("nombre"), "nombre_invalido", 1, MAX_NOMBRE)
        simbolo = _texto(c.get("simbolo"), "simbolo_invalido", 1, MAX_SIMBOLO)
        supply = _entero(c.get("supply"), "supply_invalido", 1, MAX_SUPPLY)
        self.verificar_firma("token", c, direccion)
        self.moderar(nombre, simbolo)
        with self._cerrojo_de(direccion):
            recibo, ms = self.enviar(origen, "token", self.contratos["FabricaTokens"].functions.crear(
                direccion, nombre, simbolo, supply))
        token = self._evento("FabricaTokens", "TokenCreado", recibo)["token"]
        return {**self._base(recibo), "token": token, "explorador_token": self._explorador(f"token/{token}"),
                "ms": round(ms)}

    def fondear(self, origen: str, cuerpo) -> dict:
        c = self._preparar(cuerpo, {"direccion"})
        direccion = _direccion(c.get("direccion"))
        self.verificar_firma("fondear", c, direccion)
        pasarela = self.contratos["PasarelaDemo"]
        with self._cerrojo_de(direccion):
            if pasarela.functions.fondeado(direccion).call():
                return {"ya_fondeado": True, "saldo_usdl": self.saldo_usdl(direccion)}
            recibo, ms = self.enviar(origen, "fondear", pasarela.functions.fondear(direccion))
            return {**self._base(recibo), "saldo_usdl": self.saldo_usdl(direccion), "ms": round(ms)}

    def pagar(self, origen: str, cuerpo) -> dict:
        c = self._preparar(cuerpo, {"direccion", "producto", "monto"})
        direccion = _direccion(c.get("direccion"))
        producto = c.get("producto")
        if not isinstance(producto, str) or producto not in PRODUCTOS:
            raise Rechazo(400, "producto_invalido")
        monto = PRODUCTOS[producto]
        if c.get("monto") is not None and (isinstance(c["monto"], bool) or c["monto"] != monto):
            raise Rechazo(400, "monto_invalido", esperado=monto)
        self.verificar_firma("pagar", c, direccion)
        with self._cerrojo_de(direccion):
            saldo = self.saldo_usdl(direccion)
            if saldo < monto:
                # El revert del Nivel 4: se explica sin gastar gas (el contrato revertiría con ERC20InsufficientBalance)
                detalle = f"El saldo es {saldo} USDL y el pago es de {monto} USDL."
                raise Rechazo(409, "saldo_insuficiente", detalle=detalle, saldo_usdl=saldo, monto=monto,
                              revert="ERC20InsufficientBalance")
            recibo, ms = self.enviar(origen, "pagar", self.contratos["PasarelaDemo"].functions.pagarPor(
                direccion, producto, monto))
            pago = self._evento("PasarelaDemo", "PagoRecibido", recibo)["id"]
            recibo_id = self._evento("InsigniasLICDIA", "Acunada", recibo)["tokenId"]
            return {**self._base(recibo), "pago_id": pago, "recibo_id": recibo_id,
                    "saldo_usdl": self.saldo_usdl(direccion), "explorador_nft": self._nft(recibo_id), "ms": round(ms)}

    def insignia(self, origen: str, cuerpo) -> dict:
        c = self._preparar(cuerpo, {"direccion", "tipo", "nombre"})
        direccion = _direccion(c.get("direccion"))
        tipo = _entero(c.get("tipo"), "tipo_invalido", TIPOS_INSIGNIA.start, TIPOS_INSIGNIA.stop - 1)
        if tipo == TIPO_NFT:
            nombre = _texto(c.get("nombre"), "nombre_invalido", 1, MAX_NOMBRE)
        elif c.get("nombre") not in (None, ""):
            raise Rechazo(400, "nombre_no_admitido")      # el de las insignias lo fija el servidor
        else:
            nombre = NOMBRES_FIJOS[tipo]
        self.verificar_firma("insignia", c, direccion)
        if tipo == TIPO_NFT:
            self.moderar(nombre)
        insignias = self.contratos["InsigniasLICDIA"]
        with self._cerrojo_de(direccion):
            if insignias.functions.tieneInsignia(direccion, tipo).call():
                token_id = insignias.functions.insigniaDe(direccion, tipo).call()
                return {"ya_tenia": True, "token_id": token_id, "nombre": insignias.functions.nombreDe(token_id).call(),
                        "explorador_nft": self._nft(token_id)}
            recibo, ms = self.enviar(origen, "insignia", insignias.functions.acunar(direccion, tipo, nombre))
            token_id = self._evento("InsigniasLICDIA", "Acunada", recibo)["tokenId"]
            return {**self._base(recibo), "token_id": token_id, "nombre": nombre,
                    "explorador_nft": self._nft(token_id), "ms": round(ms)}


class _Cerrojo:
    """Cerrojo por dirección con plazo: un pedido no espera indefinidamente (ni retiene su hilo) detrás de otros."""

    def __init__(self, cerrojo: threading.Lock):
        self.cerrojo = cerrojo

    def __enter__(self):
        if not self.cerrojo.acquire(timeout=ESPERA_CERROJO):
            raise Rechazo(429, "ocupado")
        return self

    def __exit__(self, *_):
        self.cerrojo.release()
        return False


# ---------- router ----------

def _responder(funcion, *args) -> JSONResponse:
    try:
        return JSONResponse(funcion(*args))
    except Rechazo as r:
        return JSONResponse(r.cuerpo, status_code=r.estado)
    except Exception as e:  # noqa: BLE001 — nunca trazas ni mensajes del nodo
        print(f"cadena: error inesperado ({type(e).__name__})", flush=True)
        return JSONResponse({"error": "fallo_cadena"}, status_code=502)


def crear_router(cadena: Cadena | None = None) -> APIRouter:
    cad = cadena or Cadena()
    if cad.modo == "real":
        avisar_variables_desconocidas()
    r = APIRouter(prefix="/blockchain-dev/api/cadena")
    cupo = threading.Lock()

    async def tomar_cupo() -> bool:
        """Cupo de escrituras en curso. Se espera con asyncio.sleep: los pedidos en espera no ocupan hilos."""
        limite = time.monotonic() + ESPERA_CUPO
        while True:
            with cupo:
                if cad.en_curso < ENVIOS_EN_CURSO:
                    cad.en_curso += 1
                    return True
            if time.monotonic() >= limite:
                return False
            await asyncio.sleep(0.05)

    def soltar_cupo() -> None:
        with cupo:
            cad.en_curso -= 1

    @r.get("/estado")
    def estado() -> JSONResponse:
        return _responder(cad.estado)

    def escritura(nombre: str):
        async def manejar(request: Request) -> JSONResponse:
            cuerpo = await request.body()
            if len(cuerpo) > 2048:
                return JSONResponse({"error": "cuerpo_invalido"}, status_code=413)
            try:
                datos = json.loads(cuerpo or b"null")
            except (ValueError, UnicodeDecodeError):
                datos = None
            if cad.modo != "real":
                return JSONResponse({"error": "modo_simulado", "modo": "simulado"}, status_code=409)
            origen = origen_de(request)
            try:
                cad.admitir_pedido(origen)
            except Rechazo as rz:
                return JSONResponse(rz.cuerpo, status_code=rz.estado)
            if not await tomar_cupo():
                return JSONResponse({"error": "ocupado"}, status_code=429)
            # Bloquea (RPC + espera del recibo): va al pool de hilos para no frenar el bucle de eventos
            from starlette.concurrency import run_in_threadpool
            try:
                return await run_in_threadpool(_responder, getattr(cad, nombre), origen, datos)
            finally:
                soltar_cupo()
        manejar.__name__ = f"cadena_{nombre}"
        return manejar

    for accion in ("sellar", "token", "fondear", "pagar", "insignia"):
        r.add_api_route(f"/{accion}", escritura(accion), methods=["POST"])

    @r.post("/revisar")
    async def revisar(request: Request) -> JSONResponse:
        cuerpo = await request.body()
        if len(cuerpo) > 1024:
            return JSONResponse({"error": "cuerpo_invalido"}, status_code=413)
        try:
            datos = json.loads(cuerpo or b"null")
        except (ValueError, UnicodeDecodeError):
            datos = None
        origen = origen_de(request)
        try:
            cad.admitir_pedido(origen)
        except Rechazo as rz:
            return JSONResponse(rz.cuerpo, status_code=rz.estado)
        from starlette.concurrency import run_in_threadpool
        return await run_in_threadpool(_responder, cad.revisar, origen, datos)

    r.cadena = cad          # para /estado de app.py y las pruebas
    return r
