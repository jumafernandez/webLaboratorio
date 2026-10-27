"""Moderación de lo que va a la cadena pública: lista local, modelo falso y el endpoint /revisar."""

from types import SimpleNamespace

import pytest

from backend import cadena, moderacion
from backend.moderacion import Moderador, revisar_lista


@pytest.mark.parametrize("texto", [
    "sos un pelotudo", "PUTO el que lee", "p u t o", "p.u.t.o", "pu70", "putooooo", "m1erda", "hijodeputa",
    "la concha de tu madre", "fuck this", "Boludooo", "visitá www.mipagina.com", "seguime @cuenta_falsa",
    "https://estafa.xyz", "sudaca", "lpm",
])
def test_lista_rechaza(texto):
    assert revisar_lista(texto) is not None


@pytest.mark.parametrize("texto", [
    "Hola mundo descentralizado", "Vamos Luján 💜", "gm ☀️", "computadora", "una disputa sana", "Mate Coin", "MATE",
    "Saludos desde Mercedes 2026", "el control de la red", "Paraguay campeón", "mamadera", "padre putativo",
    "café con leche", "Probando Web3", "Penélope", "Disputando el título", "Gilberto", "culto al hash",
])
def test_lista_aprueba(texto):
    assert revisar_lista(texto) is None


class ClienteFalso:
    """Imita client.messages.create con un veredicto fijo y cuenta las llamadas."""

    def __init__(self, ok=True, motivo="ok", falla=False):
        self.llamadas = 0
        self.ok, self.motivo, self.falla = ok, motivo, falla
        self.messages = self

    def create(self, **_):
        self.llamadas += 1
        if self.falla:
            raise RuntimeError("caída")
        bloque = SimpleNamespace(type="tool_use", input={"ok": self.ok, "motivo": self.motivo})
        return SimpleNamespace(content=[bloque])


def test_modelo_rechaza_y_cachea():
    cli = ClienteFalso(ok=False, motivo="odio")
    m = Moderador(cli)
    assert m.revisar("los de tal lugar son todos chorros") == "odio"
    assert m.revisar("Los de tal lugar son todos chorros ") == "odio"
    assert cli.llamadas == 1


def test_lista_no_gasta_modelo():
    cli = ClienteFalso()
    assert Moderador(cli).revisar("pelotudo") == "insulto"
    assert cli.llamadas == 0


def test_fallo_del_modelo_no_aprueba_ni_se_recuerda():
    cli = ClienteFalso(falla=True)
    m = Moderador(cli)
    assert m.revisar("hola") == "sin_revision"
    assert m.revisar("hola") == "sin_revision"
    assert cli.llamadas == 2


def test_sin_cliente_solo_lista():
    assert Moderador(None).revisar("hola") is None


def _cadena(tmp_path, cliente=None):
    import sqlite3
    db = sqlite3.connect(tmp_path / "t.sqlite3", check_same_thread=False, isolation_level=None)
    c = cadena.Cadena(db, conf={"modo": "simulado"})
    c.moderador = moderacion.Moderador(cliente)
    return c


def test_revisar_endpoint_logica(tmp_path):
    c = _cadena(tmp_path, ClienteFalso(ok=False, motivo="politica"))
    assert c.revisar("o", {"texto": "boludo"}) == {"ok": False, "motivo": "insulto"}
    assert c.revisar("o", {"texto": "llamame 11 5555 1234"}) == {"ok": False, "motivo": "datos_personales"}
    assert c.revisar("o", {"texto": "votá a fulano"}) == {"ok": False, "motivo": "politica"}
    with pytest.raises(cadena.Rechazo):
        c.revisar("o", {"texto": "x", "otro": 1})


def test_moderar_levanta_rechazos(tmp_path):
    c = _cadena(tmp_path, ClienteFalso(falla=True))
    with pytest.raises(cadena.Rechazo) as e:
        c.moderar("hola")
    assert e.value.estado == 503 and e.value.cuerpo["error"] == "sin_revision"
    with pytest.raises(cadena.Rechazo) as e:
        c.moderar("forro")
    assert e.value.cuerpo == {"error": "texto_rechazado", "motivo": "insulto"}
