"""La app completa: /estado con la cadena y la medición, y los routers de cadena y medición montados en backend/app.py."""

import os
import pathlib
import shutil
import sqlite3
import subprocess
import time

import pytest

os.environ.setdefault("LLM_API_KEY", "clave-de-prueba")
os.environ.setdefault("STATE_DIRECTORY", os.path.join(os.path.dirname(__file__), ".datos-prueba"))

from fastapi.testclient import TestClient  # noqa: E402

from backend import app as modulo  # noqa: E402
from backend import moderacion  # noqa: E402
from backend import cadena  # noqa: E402

RAIZ = pathlib.Path(__file__).resolve().parents[1]
CONTRATOS = RAIZ / "contratos"
# Cuenta de desarrollo #0 de Anvil/Hardhat (pública, sin fondos reales) y #1 como visitante
CLAVE_DEV = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
VISITANTE = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8"
SESION = "0123456789abcdef0123"
HAY_FOUNDRY = all(shutil.which(h) for h in ("anvil", "forge", "cast"))


@pytest.fixture
def tc():
    return TestClient(modulo.app, client=("198.51.100.4", 5000))


def test_estado_en_modo_simulado(tc):
    assert modulo.CADENA.modo == "simulado"
    e = tc.get("/blockchain-dev/api/estado").json()
    assert e["cadena"] == {"modo": "simulado", "chain_id": None, "red": None, "explorador": None, "disponible": False}
    assert e["medicion"] is True
    assert {"ok", "modelo"} <= set(e)


def test_contadores_acumulados(tc):
    antes = tc.get("/blockchain-dev/api/estado").json()
    for tipo in ("bloque", "bloque", "insignia", "certificado"):
        assert tc.post("/blockchain-dev/api/evento", json={"tipo": tipo}).status_code == 200
    assert tc.post("/blockchain-dev/api/evento", json={"tipo": "inventado"}).status_code == 422
    e = tc.get("/blockchain-dev/api/estado").json()
    assert e["bloques_total"] == antes["bloques_total"] + 2
    assert e["insignias_total"] == antes["insignias_total"] + 1
    assert e["certificados_total"] == antes["certificados_total"] + 1
    assert e["insignias_hoy"] == antes["insignias_hoy"] + 1


def test_cadena_simulada_responde_409(tc):
    assert tc.get("/blockchain-dev/api/cadena/estado").status_code == 409
    r = tc.post("/blockchain-dev/api/cadena/sellar", json={"direccion": VISITANTE, "mensaje": "hola"})
    assert r.status_code == 409 and r.json()["error"] == "modo_simulado"


def test_medicion_montada(tc):
    r = tc.post("/blockchain-dev/api/m", json={"sesion": SESION, "evento": "nivel_inicio", "datos": {"nivel": "c1"}})
    assert r.status_code == 204
    r = tc.post("/blockchain-dev/api/m", json={"sesion": SESION, "evento": "inventado", "datos": {}})
    assert r.status_code == 400
    # El panel solo existe con DEV=1 (las pruebas corren sin DEV, salvo que el .env lo prenda)
    esperado = 200 if modulo.DEV else 404
    assert tc.get("/blockchain-dev/api/panel").status_code == esperado


def test_estado_real_con_nodo_caido(tc, monkeypatch):
    conf = cadena.configuracion() | {"modo": "real", "rpc": "http://127.0.0.1:9", "chain_id": 31337,
                                     "deploy": str(CONTRATOS / "deploy" / "31337.json"), "clave_dev": CLAVE_DEV}
    monkeypatch.setattr(modulo.CADENA, "conf", conf)
    monkeypatch.setattr(modulo.CADENA, "modo", "real")
    monkeypatch.setattr(modulo.CADENA, "_ultimo_intento", 0.0)
    r = tc.get("/blockchain-dev/api/estado")
    assert r.status_code == 200
    assert r.json()["cadena"] == {"modo": "real", "chain_id": 31337, "red": "Anvil (local)", "explorador": None,
                                  "disponible": False}


@pytest.mark.skipif(not HAY_FOUNDRY, reason="hace falta Foundry (anvil, forge, cast)")
def test_estado_y_sello_reales_en_anvil(tc, monkeypatch, tmp_path):
    from tests.test_cadena import firmado, levantar_anvil

    proc, rpc = levantar_anvil()
    original = CONTRATOS / "deploy" / "31337.json"
    respaldo = original.read_bytes() if original.exists() else None
    try:
        r = subprocess.run([str(CONTRATOS / "desplegar-anvil.sh"), rpc], capture_output=True, text=True, timeout=600,
                           check=False)
        assert r.returncode == 0, r.stdout[-2000:] + r.stderr[-2000:]
        deploy = tmp_path / "31337.json"
        shutil.copy(original, deploy)
        conf = cadena.configuracion() | {"modo": "real", "rpc": rpc, "chain_id": 31337, "deploy": str(deploy),
                                         "keystore": "", "clave_dev": CLAVE_DEV, "explorador": None}
        # Base propia: los topes de la prueba no se mezclan con la base compartida del resto
        db = sqlite3.connect(tmp_path / "a.sqlite3", check_same_thread=False, isolation_level=None)
        monkeypatch.setattr(modulo.CADENA, "db", db)
        # la clave de prueba no llega a la API: la moderación usa solo la lista local
        monkeypatch.setattr(modulo.CADENA, "moderador", moderacion.Moderador(None))
        db.executescript(cadena.ESQUEMA)
        for k, v in {"conf": conf, "modo": "real", "_listo": False, "_ultimo_intento": 0.0, "_nonce": None}.items():
            monkeypatch.setattr(modulo.CADENA, k, v)

        e = tc.get("/blockchain-dev/api/estado").json()
        contratos, ahora = e["cadena"].pop("contratos"), e["cadena"].pop("ahora")
        assert e["cadena"] == {"modo": "real", "chain_id": 31337, "red": "Anvil (local)", "explorador": None,
                               "disponible": True}
        assert set(contratos) == set(cadena.CONTRATO_DE) and abs(ahora - time.time()) < 5
        assert contratos["sellar"] == modulo.CADENA.contratos["SelloLICDIA"].address
        cuerpo = {"direccion": VISITANTE, "mensaje": "hola desde la app"}
        sin_firma = tc.post("/blockchain-dev/api/cadena/sellar", json=cuerpo)
        assert sin_firma.status_code == 401 and sin_firma.json()["error"] == "firma_invalida"
        r = tc.post("/blockchain-dev/api/cadena/sellar", json=firmado(modulo.CADENA, "sellar", cuerpo))
        assert r.status_code == 200, r.text
        assert r.json()["id"] >= 1 and r.json()["tx"].startswith("0x")
        assert CLAVE_DEV[2:] not in r.text and CLAVE_DEV[2:] not in tc.get("/blockchain-dev/api/estado").text
    finally:
        if respaldo is not None:
            original.write_bytes(respaldo)
        proc.terminate()
        proc.wait(timeout=10)
