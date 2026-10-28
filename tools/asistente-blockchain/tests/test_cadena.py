"""Relayer de la cadena real contra un Anvil propio: cada endpoint, errores, topes, modo simulado, fondos y nonce.

Levanta anvil en un puerto libre, despliega con contratos/desplegar-anvil.sh (la cuenta de desarrollo #0 de Anvil,
pública) y arma una app con el router en modo real. Se saltea si anvil, forge o cast no están instalados.
"""

import concurrent.futures
import json
import pathlib
import shutil
import socket
import sqlite3
import statistics
import subprocess
import time

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend import cadena

RAIZ = pathlib.Path(__file__).resolve().parents[1]
CONTRATOS = RAIZ / "contratos"
# Cuenta de desarrollo #0 de Anvil/Hardhat (publicada en la documentación de Foundry; nunca tiene fondos reales)
CLAVE_DEV = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
RELAYER = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
# Cuentas de desarrollo #1..#9 de Anvil, usadas solo como direcciones de visitantes
VISITANTES = [
    "0x70997970C51812dc3A010C7d01b50e0d17dc79C8", "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
    "0x90F79bf6EB2c4f870365E785982E1f101E93b906", "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65",
    "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc", "0x976EA74026E726554dB657fA54763abd0C3a0aa9",
    "0x14dC79964da2C08b23698B3D3cc7Ca32193d9955", "0x23618e81E3f5cdF7f54C3d65f7FBc0aBf5B21E8f",
    "0xa0Ee7A142d267C1f36714E4a8F75612F20a79720",
]
# Mnemónico de desarrollo de Anvil/Hardhat (público): de acá salen las claves de esas mismas cuentas, para firmar
MNEMONICO_DEV = "test test test test test test test test test test test junk"
API = "/blockchain-dev/api/cadena"
LATENCIAS: dict[str, list[float]] = {}

pytestmark = pytest.mark.skipif(not all(shutil.which(h) for h in ("anvil", "forge", "cast")),
                                reason="hace falta Foundry (anvil, forge, cast)")


def puerto_libre() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def levantar_anvil(chain_id: int = 31337) -> tuple[subprocess.Popen, str]:
    puerto = puerto_libre()
    proc = subprocess.Popen(["anvil", "--port", str(puerto), "--chain-id", str(chain_id), "--silent"],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    rpc = f"http://127.0.0.1:{puerto}"
    for _ in range(100):
        try:
            socket.create_connection(("127.0.0.1", puerto), timeout=0.2).close()
            return proc, rpc
        except OSError:
            time.sleep(0.1)
    proc.kill()
    pytest.skip("anvil no arrancó")


@pytest.fixture(scope="module")
def red(tmp_path_factory):
    """Anvil propio + despliegue. Deja contratos/deploy/31337.json como estaba."""
    carpeta = tmp_path_factory.mktemp("cadena")
    proc, rpc = levantar_anvil()
    original = CONTRATOS / "deploy" / "31337.json"
    respaldo = original.read_bytes() if original.exists() else None
    try:
        r = subprocess.run([str(CONTRATOS / "desplegar-anvil.sh"), rpc], capture_output=True, text=True, timeout=600)
        assert r.returncode == 0, r.stdout[-2000:] + r.stderr[-2000:]
        deploy = carpeta / "31337.json"
        shutil.copy(original, deploy)
        yield {"rpc": rpc, "deploy": str(deploy), "carpeta": carpeta}
    finally:
        if respaldo is not None:
            original.write_bytes(respaldo)
        proc.terminate()
        proc.wait(timeout=10)


def conf_real(red, **extra) -> dict:
    base = cadena.configuracion() | {"modo": "real", "rpc": red["rpc"], "chain_id": 31337, "deploy": red["deploy"],
                                     "keystore": "", "clave_dev": CLAVE_DEV, "explorador": None}
    return base | extra


def armar(red, tmp_path, ip: str = "203.0.113.7", **extra) -> tuple[TestClient, cadena.Cadena]:
    db = sqlite3.connect(tmp_path / "a.sqlite3", check_same_thread=False, isolation_level=None)
    cad = cadena.Cadena(db, conf=conf_real(red, **extra) if red else cadena.configuracion() | extra)
    app = FastAPI()
    app.include_router(cadena.crear_router(cad))
    return TestClient(app, client=(ip, 5000)), cad


@pytest.fixture
def cliente(red, tmp_path):
    return armar(red, tmp_path)


def w3(red):
    from web3 import Web3
    return Web3(Web3.HTTPProvider(red["rpc"]))


def _claves() -> dict:
    from eth_account import Account
    Account.enable_unaudited_hdwallet_features()
    cuentas = [Account.from_mnemonic(MNEMONICO_DEV, account_path=f"m/44'/60'/0'/0/{i}") for i in range(1, 10)]
    assert [c.address for c in cuentas] == VISITANTES
    return {c.address.lower(): c for c in cuentas}


CLAVES: dict = {}


def firmado(cad, accion: str, cuerpo: dict, cuenta=None, expira: int | None = None, nonce: str | None = None) -> dict:
    """El cuerpo con la firma del visitante (como widget/cadena-real.js). `cuenta` firma en lugar del dueño."""
    import secrets as _s

    from eth_account.messages import encode_defunct
    if not CLAVES:
        CLAVES.update(_claves())
    cad.conectar()
    direccion = cad.w3.to_checksum_address(cuerpo["direccion"])
    cuenta = cuenta or CLAVES[direccion.lower()]
    expira = expira if expira is not None else int(time.time()) + 120
    nonce = nonce or _s.token_hex(16)
    campos = {k: v for k, v in cuerpo.items() if k != "direccion"}
    texto = cadena.mensaje_a_firmar(accion, cad.chain_id, cad.contratos[cadena.CONTRATO_DE[accion]].address,
                                    direccion, campos, expira, nonce)
    firma = "0x" + cuenta.sign_message(encode_defunct(text=texto)).signature.hex().removeprefix("0x")
    return {**cuerpo, "firma": firma, "expira": expira, "nonce": nonce}


def enviar(c, cad, accion: str, cuerpo: dict, **kw):
    return c.post(f"{API}/{accion}", json=firmado(cad, accion, cuerpo), **kw)


def anotar(accion: str, r) -> dict:
    datos = r.json()
    assert r.status_code == 200, datos
    LATENCIAS.setdefault(accion, []).append(datos["ms"])
    return datos


def sin_clave(texto: str) -> bool:
    return CLAVE_DEV.lower()[2:] not in texto.lower()


# ---------- camino feliz ----------

def test_estado(cliente):
    c, _ = cliente
    r = c.get(f"{API}/estado")
    e = r.json()
    assert r.status_code == 200, e
    assert e["modo"] == "real" and e["chain_id"] == 31337 and e["red"] == "Anvil (local)" and e["explorador"] is None
    assert set(e["contratos"]) == set(cadena.CONTRATOS) and e["relayer"] == RELAYER
    assert e["saldo_relayer_eth"] > 1 and e["bloque"] > 0
    assert e["topes"]["tx_por_origen_por_dia"] == 40 and e["topes"]["productos"]["auto"] == 500
    assert sin_clave(r.text) and "rpc" not in e


def test_sellar(cliente, red):
    from web3 import Web3
    c, cad = cliente
    s = anotar("sellar", enviar(c, cad, "sellar", {"direccion": VISITANTES[0], "mensaje": "Hola, cadena 🧱"}))
    assert s["tx"].startswith("0x") and len(s["tx"]) == 66 and s["bloque"] > 0 and s["id"] >= 1
    assert s["explorador_tx"] is None
    sello = cad.contratos["SelloLICDIA"]
    assert sello.functions.huella(s["id"]).call() == Web3.keccak(text="Hola, cadena 🧱")
    assert sello.functions.autorDe(s["id"]).call() == VISITANTES[0]
    # una dirección en minúsculas también vale (se normaliza al checksum)
    s2 = anotar("sellar", enviar(c, cad, "sellar", {"direccion": VISITANTES[1].lower(), "mensaje": "x"}))
    assert sello.functions.autorDe(s2["id"]).call() == VISITANTES[1]


def test_token(cliente):
    c, cad = cliente
    t = anotar("token", enviar(c, cad, "token", {"direccion": VISITANTES[1], "nombre": "Mate Coin",
                                                     "simbolo": "MATE", "supply": 1000}))
    assert t["token"].startswith("0x") and t["explorador_token"] is None
    abi = json.loads((CONTRATOS / "abi" / "TokenSimple.json").read_text())
    token = cad.w3.eth.contract(address=t["token"], abi=abi)
    assert token.functions.balanceOf(VISITANTES[1]).call() == 1000 * 10**18
    assert token.functions.symbol().call() == "MATE"


def test_fondear_y_pagar(cliente, red):
    c, cad = cliente
    v = VISITANTES[2]
    f = anotar("fondear", enviar(c, cad, "fondear", {"direccion": v}))
    assert f["saldo_usdl"] == 100 and f["tx"]
    bloque = cad.w3.eth.block_number
    otra = enviar(c, cad, "fondear", {"direccion": v}).json()
    assert otra == {"ya_fondeado": True, "saldo_usdl": 100}
    assert cad.w3.eth.block_number == bloque                       # sin tx

    nonce = cad.w3.eth.get_transaction_count(RELAYER)
    r = enviar(c, cad, "pagar", {"direccion": v, "producto": "auto", "monto": 500})
    assert r.status_code == 409 and r.json()["error"] == "saldo_insuficiente"
    assert r.json()["saldo_usdl"] == 100 and "detalle" in r.json()
    assert cad.w3.eth.get_transaction_count(RELAYER) == nonce and cad.w3.eth.block_number == bloque

    p = anotar("pagar", enviar(c, cad, "pagar", {"direccion": v, "producto": "apunte", "monto": 15}))
    assert p["saldo_usdl"] == 85 and p["pago_id"] >= 1 and p["recibo_id"] >= 1 and p["explorador_nft"] is None
    insignias = cad.contratos["InsigniasLICDIA"]
    assert insignias.functions.ownerOf(p["recibo_id"]).call() == v
    assert insignias.functions.tipoDe(p["recibo_id"]).call() == 7
    p2 = anotar("pagar", enviar(c, cad, "pagar", {"direccion": v, "producto": "cafe"}))   # monto opcional
    assert p2["saldo_usdl"] == 80 and p2["pago_id"] == p["pago_id"] + 1

    # sin fondear: saldo 0 → 409 sin tx
    r = enviar(c, cad, "pagar", {"direccion": VISITANTES[8], "producto": "cafe"})
    assert r.status_code == 409 and r.json()["saldo_usdl"] == 0


def test_insignia(cliente):
    c, cad = cliente
    v = VISITANTES[3]
    i = anotar("insignia", enviar(c, cad, "insignia", {"direccion": v, "tipo": 0}))
    assert i["token_id"] >= 1 and i["nombre"] == "Insignia Bloques"
    insignias = cad.contratos["InsigniasLICDIA"]
    assert insignias.functions.ownerOf(i["token_id"]).call() == v
    assert insignias.functions.nombreDe(i["token_id"]).call() == "Insignia Bloques"     # lo fija el servidor
    bloque = cad.w3.eth.block_number
    otra = enviar(c, cad, "insignia", {"direccion": v, "tipo": 0})
    assert otra.status_code == 200 and otra.json()["ya_tenia"] is True and otra.json()["token_id"] == i["token_id"]
    assert cad.w3.eth.block_number == bloque
    # el nombre de una insignia de curso no lo elige el cliente
    r = enviar(c, cad, "insignia", {"direccion": v, "tipo": 1, "nombre": "ESTAFADOR"})
    assert r.status_code == 400 and r.json()["error"] == "nombre_no_admitido"
    n = anotar("insignia", enviar(c, cad, "insignia", {"direccion": v, "tipo": 4, "nombre": "Mi NFT"}))
    assert insignias.functions.nombreDe(n["token_id"]).call() == "Mi NFT"
    # el NFT propio ya está: la respuesta trae el nombre que quedó en la cadena, no el pedido
    otra = enviar(c, cad, "insignia", {"direccion": v, "tipo": 4, "nombre": "Otro nombre"}).json()
    assert otra["ya_tenia"] is True and otra["nombre"] == "Mi NFT"
    # el certificado exige los cuatro cursos, en la cadena
    nonce = cad.w3.eth.get_transaction_count(RELAYER)
    r = enviar(c, cad, "insignia", {"direccion": v, "tipo": 6})
    assert r.status_code == 409 and r.json() == {"error": "rechazada_por_contrato", "motivo": "FaltanInsignias"}
    assert cad.w3.eth.get_transaction_count(RELAYER) == nonce
    for tipo in (1, 2, 3):
        anotar("insignia", enviar(c, cad, "insignia", {"direccion": v, "tipo": tipo}))
    sin_nombre = anotar("insignia", enviar(c, cad, "insignia", {"direccion": v, "tipo": 6}))
    assert insignias.functions.tipoDe(sin_nombre["token_id"]).call() == 6
    uri = insignias.functions.tokenURI(n["token_id"]).call()
    assert uri.startswith("data:application/json;base64,")


def test_insignia_en_wallet_propia(cliente):
    from eth_account.messages import encode_defunct
    c, cad = cliente
    juego, propia, otra = VISITANTES[4], VISITANTES[5], VISITANTES[6]
    enviar(c, cad, "insignia", {"direccion": juego, "tipo": 0})          # carga CLAVES con la primera firma
    contrato = cad.contratos["InsigniasLICDIA"].address

    def vinculo(firmante, destino):
        texto = cadena.texto_vinculo(cad.chain_id, contrato, juego, destino)
        return "0x" + CLAVES[firmante.lower()].sign_message(encode_defunct(text=texto)).signature.hex().removeprefix("0x")

    i = anotar("insignia", enviar(c, cad, "insignia", {"direccion": juego, "tipo": 1, "destino": propia,
                                                      "vinculo": vinculo(propia, propia)}))
    insignias = cad.contratos["InsigniasLICDIA"]
    assert i["destino"] == propia and insignias.functions.ownerOf(i["token_id"]).call() == propia
    assert not insignias.functions.tieneInsignia(juego, 1).call()
    # la wallet propia ya la tiene: no se acuña de nuevo
    r = enviar(c, cad, "insignia", {"direccion": juego, "tipo": 1, "destino": propia, "vinculo": vinculo(propia, propia)})
    assert r.json()["ya_tenia"] is True and r.json()["token_id"] == i["token_id"]
    # sin el vínculo, o firmado por otra cuenta, nadie le acuña a un tercero
    for v in (None, vinculo(propia, otra), vinculo(juego, otra)):
        cuerpo = {"direccion": juego, "tipo": 2, "destino": otra} | ({"vinculo": v} if v else {})
        r = enviar(c, cad, "insignia", cuerpo)
        assert r.status_code == 401 and r.json()["error"] == "vinculo_invalido", r.json()
    assert not insignias.functions.tieneInsignia(otra, 2).call()
    r = enviar(c, cad, "insignia", {"direccion": juego, "tipo": 2, "destino": juego, "vinculo": vinculo(juego, juego)})
    assert r.status_code == 400 and r.json()["error"] == "destino_invalido"
    r = enviar(c, cad, "insignia", {"direccion": juego, "tipo": 2, "vinculo": vinculo(propia, propia)})
    assert r.status_code == 400 and r.json()["error"] == "cuerpo_invalido"


# ---------- errores de entrada ----------

@pytest.mark.parametrize(("ruta", "cuerpo", "error"), [
    ("sellar", {"direccion": "0x123", "mensaje": "hola"}, "direccion_invalida"),
    ("sellar", {"direccion": VISITANTES[0][:-1] + ("a" if VISITANTES[0][-1] != "a" else "b"), "mensaje": "x"},
     "direccion_invalida"),                                                           # checksum mal
    ("sellar", {"direccion": "0x" + "0" * 40, "mensaje": "x"}, "direccion_invalida"),
    ("sellar", {"direccion": VISITANTES[0], "mensaje": "a" * 121}, "mensaje_invalido"),
    ("sellar", {"direccion": VISITANTES[0], "mensaje": "ñ" * 61}, "mensaje_invalido"),  # 122 bytes
    ("sellar", {"direccion": VISITANTES[0], "mensaje": "   "}, "mensaje_invalido"),
    ("sellar", {"direccion": VISITANTES[0], "mensaje": "a\x00b"}, "mensaje_invalido"),
    ("sellar", {"direccion": VISITANTES[0], "mensaje": "\u202eodarbmiv"}, "mensaje_invalido"),       # bidi
    ("sellar", {"direccion": VISITANTES[0], "mensaje": "hola\u200bmundo"}, "mensaje_invalido"),      # ancho cero
    ("insignia", {"direccion": VISITANTES[0], "tipo": 4, "nombre": "\u202eodarbmiv"}, "nombre_invalido"),
    ("sellar", {"direccion": VISITANTES[0], "mensaje": "escribime a ana@ejemplo.com"}, "datos_personales"),
    ("sellar", {"direccion": VISITANTES[0], "mensaje": "mi DNI 30.123.456"}, "datos_personales"),
    ("sellar", {"direccion": VISITANTES[0], "mensaje": "x", "otra": 1}, "cuerpo_invalido"),
    ("sellar", None, "cuerpo_invalido"),
    ("token", {"direccion": VISITANTES[0], "nombre": "A", "simbolo": "TOOLONG", "supply": 1}, "simbolo_invalido"),
    ("token", {"direccion": VISITANTES[0], "nombre": "A" * 25, "simbolo": "A", "supply": 1}, "nombre_invalido"),
    ("token", {"direccion": VISITANTES[0], "nombre": "A", "simbolo": "A", "supply": 0}, "supply_invalido"),
    ("token", {"direccion": VISITANTES[0], "nombre": "A", "simbolo": "A", "supply": 21_000_001}, "supply_invalido"),
    ("token", {"direccion": VISITANTES[0], "nombre": "A", "simbolo": "A", "supply": True}, "supply_invalido"),
    ("pagar", {"direccion": VISITANTES[0], "producto": "yate"}, "producto_invalido"),
    ("pagar", {"direccion": VISITANTES[0], "producto": "cafe", "monto": 1}, "monto_invalido"),
    ("insignia", {"direccion": VISITANTES[0], "tipo": 7, "nombre": "x"}, "tipo_invalido"),
    ("insignia", {"direccion": VISITANTES[0], "tipo": -1}, "tipo_invalido"),
    ("insignia", {"direccion": VISITANTES[0], "tipo": "0"}, "tipo_invalido"),
    ("insignia", {"direccion": VISITANTES[0], "tipo": 4}, "nombre_invalido"),
])
def test_entradas_invalidas(cliente, ruta, cuerpo, error):
    c, cad = cliente
    nonce = cad.w3.eth.get_transaction_count(RELAYER) if cad._listo else None
    r = c.post(f"{API}/{ruta}", json=cuerpo) if cuerpo is not None else c.post(f"{API}/{ruta}", content=b"{no json")
    assert r.status_code == 400 and r.json()["error"] == error, r.text
    if nonce is not None:
        assert cad.w3.eth.get_transaction_count(RELAYER) == nonce


# ---------- topes, modo y fondos ----------

def test_tope_por_origen_y_global(red, tmp_path):
    c, cad = armar(red, tmp_path, ip="198.51.100.1", tx_por_origen=2, tx_por_dia=3)
    cuerpo = {"direccion": VISITANTES[4], "mensaje": "tope"}
    assert enviar(c, cad, "sellar", cuerpo).status_code == 200
    assert enviar(c, cad, "sellar", cuerpo).status_code == 200
    nonce = cad.w3.eth.get_transaction_count(RELAYER)
    r = enviar(c, cad, "sellar", cuerpo)
    assert r.status_code == 429 and r.json() == {"error": "tope_origen"}
    assert cad.w3.eth.get_transaction_count(RELAYER) == nonce
    otra = TestClient(c.app, client=("198.51.100.2", 5000))
    assert enviar(otra, cad, "sellar", cuerpo).status_code == 200
    r = enviar(otra, cad, "sellar", cuerpo)
    assert r.status_code == 429 and r.json() == {"error": "tope_global"}
    assert c.get(f"{API}/estado").json()["topes"]["tx_usadas_hoy"] == 3
    # sin IP en la base: solo hashes
    claves = [k for (k,) in cad.db.execute("SELECT clave FROM cadena_uso")]
    assert "global" in claves and not any("198.51" in k for k in claves)
    # lo que no manda tx (ya fondeado, saldo insuficiente) no consume tope
    r = enviar(c, cad, "pagar", {"direccion": VISITANTES[8], "producto": "cafe"})
    assert r.status_code == 409 and r.json()["error"] == "saldo_insuficiente"


def test_modo_simulado(tmp_path):
    c, _ = armar(None, tmp_path, modo="simulado")
    assert c.get(f"{API}/estado").status_code == 409
    assert c.get(f"{API}/estado").json()["error"] == "modo_simulado"
    for ruta in ("sellar", "token", "fondear", "pagar", "insignia"):
        r = c.post(f"{API}/{ruta}", json={"direccion": VISITANTES[0]})
        assert r.status_code == 409 and r.json()["error"] == "modo_simulado"


def test_modo_por_defecto_es_simulado(monkeypatch):
    monkeypatch.delenv("CADENA_MODO", raising=False)
    monkeypatch.setattr(cadena, "RAIZ", pathlib.Path("/nonexistent"))      # sin .env
    assert cadena.configuracion()["modo"] == "simulado"


def test_relayer_sin_fondos(cliente, monkeypatch):
    c, cad = cliente
    assert c.get(f"{API}/estado").status_code == 200
    monkeypatch.setattr(cad, "saldo_relayer_wei", lambda: 4 * 10**14)       # 0.0004 ETH
    nonce = cad.w3.eth.get_transaction_count(RELAYER)
    r = enviar(c, cad, "sellar", {"direccion": VISITANTES[0], "mensaje": "sin gas"})
    assert r.status_code == 503 and r.json() == {"error": "sin_fondos"}
    assert cad.w3.eth.get_transaction_count(RELAYER) == nonce


def test_nodo_caido(tmp_path):
    c, cad = armar(None, tmp_path, modo="real", rpc=f"http://127.0.0.1:{puerto_libre()}", chain_id=31337,
                 deploy="/nonexistent.json", clave_dev=CLAVE_DEV)
    r = c.post(f"{API}/sellar", json={"direccion": VISITANTES[0], "mensaje": "x"})
    assert r.status_code == 503 and r.json() == {"error": "no_disponible"} and sin_clave(r.text)


def test_clave_dev_fuera_de_anvil(tmp_path, capsys):
    """CADENA_CLAVE_DEV solo vale con chain id 31337: en otra red no firma."""
    proc, rpc = levantar_anvil(chain_id=84532)
    try:
        deploy = tmp_path / "84532.json"
        deploy.write_text(json.dumps({"chainId": 84532, "contratos": {}}))
        c, cad = armar(None, tmp_path, modo="real", rpc=rpc, chain_id=84532, deploy=str(deploy), keystore="",
                       clave_dev=CLAVE_DEV, tx_por_origen=40, tx_por_dia=600, min_eth=0)
        r = c.post(f"{API}/sellar", json={"direccion": VISITANTES[0], "mensaje": "x"})
        assert r.status_code == 503 and r.json() == {"error": "no_disponible"}
        assert cad._cuenta is None
        assert "31337" in capsys.readouterr().out
    finally:
        proc.terminate()
        proc.wait(timeout=10)


# ---------- concurrencia y secretos ----------

def test_nonce_con_pedidos_simultaneos(cliente):
    c, cad = cliente
    c.get(f"{API}/estado")
    nonce = cad.w3.eth.get_transaction_count(RELAYER)

    def sellar(i: int):
        cliente_hilo = TestClient(c.app, client=(f"192.0.2.{i}", 5000))
        return enviar(cliente_hilo, cad, "sellar", {"direccion": VISITANTES[i % 4], "mensaje": f"paralelo {i}"})

    with concurrent.futures.ThreadPoolExecutor(8) as pool:
        respuestas = list(pool.map(sellar, range(8)))
    datos = [anotar("sellar (8 en paralelo)", r) for r in respuestas]
    assert len({d["tx"] for d in datos}) == 8 and len({d["id"] for d in datos}) == 8
    assert cad.w3.eth.get_transaction_count(RELAYER) == nonce + 8
    # mismo visitante, dos fondeos a la vez: uno manda la tx y el otro ve ya_fondeado
    v = VISITANTES[5]
    with concurrent.futures.ThreadPoolExecutor(2) as pool:
        dos = list(pool.map(lambda _: enviar(c, cad, "fondear", {"direccion": v}).json(), range(2)))
    assert sorted("ya_fondeado" in d for d in dos) == [False, True] and all(d["saldo_usdl"] == 100 for d in dos)


def test_clave_nunca_sale(cliente, capsys):
    c, cad = cliente
    textos = [c.get(f"{API}/estado").text, repr(cad), str(cad.__dict__.get("conf", {}).keys())]
    textos.append(enviar(c, cad, "sellar", {"direccion": VISITANTES[0], "mensaje": "secreto?"}).text)
    textos.append(capsys.readouterr().out)
    assert all(sin_clave(t) for t in textos)


def test_latencia(cliente, capsys):
    """Imprime la latencia por escritura en Anvil (correr con -s para verla)."""
    c, cad = cliente
    for i in range(5):
        for accion, cuerpo in (("sellar", {"mensaje": f"lat {i}"}),
                               ("token", {"nombre": f"T{i}", "simbolo": "T", "supply": 10})):
            t0 = time.perf_counter()
            anotar(accion, enviar(c, cad, accion, {"direccion": VISITANTES[6], **cuerpo}))
            LATENCIAS.setdefault(f"{accion} (HTTP completo)", []).append((time.perf_counter() - t0) * 1000)
    for accion, ms in LATENCIAS.items():
        assert statistics.median(ms) < 5000
    with capsys.disabled():
        print()
        for accion, ms in sorted(LATENCIAS.items()):
            print(f"  latencia {accion:<24} n={len(ms):<3} mediana {statistics.median(ms):6.0f} ms  "
                  f"máx {max(ms):6.0f} ms")


# ---------- prueba de control de la dirección ----------

def test_sin_firma_no_hay_tx(cliente):
    """Un tercero no puede gastar el USDL de otro ni acuñarle nada: hace falta la firma del dueño de la dirección."""
    c, cad = cliente
    victima, atacante = VISITANTES[7], CLAVES.get(VISITANTES[0].lower())
    anotar("fondear", enviar(c, cad, "fondear", {"direccion": victima}))
    atacante = atacante or _claves()[VISITANTES[0].lower()]
    nonce = cad.w3.eth.get_transaction_count(RELAYER)
    pedido = {"direccion": victima, "producto": "entrada"}
    casos = [
        {k: v for k, v in firmado(cad, "pagar", pedido).items() if k != "firma"},              # sin firma
        firmado(cad, "pagar", pedido, cuenta=atacante),                                       # firma de otro
        {**firmado(cad, "pagar", {**pedido, "producto": "cafe"}), "producto": "entrada"},     # cuerpo cambiado
        firmado(cad, "fondear", pedido),                                                      # otra acción
        firmado(cad, "pagar", pedido, expira=int(time.time()) - 1),                           # vencida
        firmado(cad, "pagar", pedido, expira=int(time.time()) + 3600),                        # demasiado larga
        {**firmado(cad, "pagar", pedido), "firma": "0x" + "ab" * 65},                          # basura
    ]
    for cuerpo in casos:
        r = c.post(f"{API}/pagar", json=cuerpo)
        assert r.status_code == 401 and r.json()["error"] in ("firma_invalida", "firma_vencida"), r.text
    r = c.post(f"{API}/insignia", json=firmado(cad, "insignia", {"direccion": victima, "tipo": 4,
                                                                 "nombre": "ESTAFADOR"}, cuenta=atacante))
    assert r.status_code == 401
    assert cad.w3.eth.get_transaction_count(RELAYER) == nonce
    assert cad.saldo_usdl(victima) == 100
    # la firma del dueño vale una sola vez
    bueno = firmado(cad, "pagar", pedido)
    assert anotar("pagar", c.post(f"{API}/pagar", json=bueno))["saldo_usdl"] == 75
    r = c.post(f"{API}/pagar", json=bueno)
    assert r.status_code == 409 and r.json()["error"] == "firma_usada"
    assert cad.saldo_usdl(victima) == 75


# ---------- origen, topes de pedidos y cupo ----------

def test_x_real_ip_solo_desde_proxy_confiable(red, tmp_path, monkeypatch):
    monkeypatch.delenv("PROXIES_CONFIABLES", raising=False)
    monkeypatch.delenv("CADENA_PROXIES_CONFIABLES", raising=False)
    monkeypatch.setattr("backend.origen.RAIZ", pathlib.Path("/nonexistent"))
    c, cad = armar(red, tmp_path, ip="198.51.100.9", tx_por_origen=2)
    cuerpo = {"direccion": VISITANTES[4], "mensaje": "proxy"}
    for i in range(2):
        assert enviar(c, cad, "sellar", cuerpo, headers={"X-Real-IP": f"10.0.0.{i}"}).status_code == 200
    r = enviar(c, cad, "sellar", cuerpo, headers={"X-Real-IP": "10.0.0.9"})
    assert r.status_code == 429 and r.json() == {"error": "tope_origen"}            # el encabezado no cuenta
    # detrás de un proxy de confianza sí se usa (nginx pisa el encabezado con $remote_addr)
    monkeypatch.setenv("PROXIES_CONFIABLES", "198.51.100.9")
    assert enviar(c, cad, "sellar", cuerpo, headers={"X-Real-IP": "10.0.0.10"}).status_code == 200


def test_tope_de_pedidos_sin_tx(red, tmp_path):
    """Los caminos sin tx (ya_tenia, rechazos) también cuentan: el nodo no se consulta sin tope."""
    c, cad = armar(red, tmp_path, ip="198.51.100.20", pedidos_por_minuto=4)
    v = VISITANTES[5]
    respuestas = [enviar(c, cad, "insignia", {"direccion": v, "tipo": 5}) for _ in range(6)]
    assert [r.status_code for r in respuestas] == [200, 200, 200, 200, 429, 429]
    assert respuestas[1].json()["ya_tenia"] is True and respuestas[-1].json() == {"error": "demasiados_pedidos"}
    otra = TestClient(c.app, client=("198.51.100.21", 5000))
    assert enviar(otra, cad, "insignia", {"direccion": v, "tipo": 5}).status_code == 200
    # tope diario de pedidos
    (tmp_path / "b").mkdir()
    c2, cad2 = armar(red, tmp_path / "b", ip="198.51.100.22", pedidos_por_origen=2)
    assert [enviar(c2, cad2, "fondear", {"direccion": v}).status_code for _ in range(3)] == [200, 200, 429]


def test_estado_en_cache(cliente):
    c, cad = cliente
    primero = c.get(f"{API}/estado").json()
    llamadas = []
    original = cad.saldo_relayer_wei
    cad.saldo_relayer_wei = lambda: llamadas.append(1) or original()
    for _ in range(5):
        assert c.get(f"{API}/estado").json() == primero
    assert llamadas == [] and isinstance(primero["ahora"], int)


def test_cerrojo_ocupado(cliente, monkeypatch):
    """Con el cerrojo de la dirección tomado, el pedido no espera indefinidamente: 429 ocupado en ~1 s."""
    c, cad = cliente
    monkeypatch.setattr(cadena, "ESPERA_CERROJO", 0.2)
    v = VISITANTES[6]
    cad.conectar()
    with cad.cerrojos_direccion[int(v, 16) % len(cad.cerrojos_direccion)]:
        t0 = time.monotonic()
        r = enviar(c, cad, "fondear", {"direccion": v})
        assert r.status_code == 429 and r.json() == {"error": "ocupado"} and time.monotonic() - t0 < 2


def test_nonce_se_resincroniza_si_la_tx_se_cae(red, tmp_path, monkeypatch):
    """Una tx que se cae del mempool no deja trabado al relayer: tras el 504 el nonce se vuelve a pedir."""
    monkeypatch.setattr(cadena, "ESPERA_RECIBO", 1.5)
    monkeypatch.setattr(cadena, "RESYNC_TRAS", 0.0)
    c, cad = armar(red, tmp_path, ip="198.51.100.30")
    nodo = w3(red)
    cuerpo = {"direccion": VISITANTES[2], "mensaje": "se cae"}
    nodo.provider.make_request("evm_setAutomine", [False])
    try:
        r = enviar(c, cad, "sellar", cuerpo)
        assert r.status_code == 504 and r.json()["error"] == "sin_confirmar" and r.json()["tx"].startswith("0x")
        nodo.provider.make_request("anvil_dropAllTransactions", [])
    finally:
        nodo.provider.make_request("evm_setAutomine", [True])
    # el siguiente pedido sale con el nonce de la cadena y se mina
    s = anotar("sellar", enviar(c, cad, "sellar", cuerpo))
    assert s["bloque"] > 0
    assert nodo.eth.get_transaction_count(RELAYER, "pending") == nodo.eth.get_transaction_count(RELAYER)


@pytest.mark.parametrize(("texto", "error"), [
    ("Hoy 26-10-2026 empecé", None), ("Gracias 1.000.000 de veces", None), ("Nos vemos el 1/3/27", None),
    ("mi DNI 30.123.456", "datos_personales"), ("llamame al 11 5555 4444", "datos_personales"),
])
def test_filtro_de_sello_deja_fechas(texto, error):
    if error is None:
        assert cadena._texto(texto, "mensaje_invalido", 1, 120) == texto
    else:
        with pytest.raises(cadena.Rechazo) as r:
            cadena._texto(texto, "mensaje_invalido", 1, 120)
        assert r.value.cuerpo["error"] == error
