"""Loop del agente con un cliente de Anthropic simulado: texto, acciones del escenario, vueltas y validación."""

import json
import os
import types

import pytest

os.environ["LLM_API_KEY"] = "clave-de-prueba"
os.environ["STATE_DIRECTORY"] = os.path.join(os.path.dirname(__file__), ".datos-prueba")

from fastapi.testclient import TestClient  # noqa: E402

from backend import app as modulo  # noqa: E402


def bloque_texto(t):
    return types.SimpleNamespace(type="text", text=t)


def bloque_herramienta(nombre, args, i="tu_1"):
    return types.SimpleNamespace(type="tool_use", name=nombre, input=args, id=i)


def respuesta(bloques, stop="end_turn"):
    uso = types.SimpleNamespace(input_tokens=10, cache_read_input_tokens=20000, cache_creation_input_tokens=0,
                                output_tokens=40)
    return types.SimpleNamespace(content=bloques, stop_reason=stop, usage=uso)


class FlujoFalso:
    def __init__(self, msg):
        self.msg = msg

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def __iter__(self):
        for b in self.msg.content:
            if b.type == "text":
                yield types.SimpleNamespace(type="text", text=b.text)

    def get_final_message(self):
        return self.msg


class ClienteFalso:
    """Devuelve las respuestas en orden y guarda cada pedido."""

    def __init__(self, respuestas):
        self.respuestas = list(respuestas)
        self.pedidos = []
        self.messages = self

    def stream(self, **kw):
        self.pedidos.append(json.loads(json.dumps(kw, default=lambda o: o.__dict__)))
        return FlujoFalso(self.respuestas.pop(0))


def eventos(texto_sse):
    salida = []
    for trozo in texto_sse.strip().split("\n\n"):
        ev = trozo.split("\n")[0].removeprefix("event: ")
        datos = json.loads(trozo.split("\n")[1].removeprefix("data: "))
        salida.append((ev, datos))
    return salida


@pytest.fixture
def cliente(monkeypatch):
    def armar(respuestas):
        falso = ClienteFalso(respuestas)
        monkeypatch.setattr(modulo, "CLIENTE", falso)
        monkeypatch.setattr(modulo, "LLM_API_KEY", "clave-de-prueba")
        return TestClient(modulo.app), falso

    return armar


def pedir(tc, texto, estado=None):
    r = tc.post("/blockchain-dev/api/chat", json={"mensajes": [{"rol": "usuario", "texto": texto}],
                                                  "estado": estado or {}})
    assert r.status_code == 200
    return eventos(r.text)


def test_texto_y_nivel_en_una_vuelta(cliente):
    tc, falso = cliente([respuesta([bloque_texto("¡Probemos!"),
                                    bloque_herramienta("jugar_nivel", {"nivel": "c1", "ejemplo": "Sellá una factura."})],
                                   stop="tool_use")])
    evs = pedir(tc, "soy contador, ¿para qué me sirve?")
    assert ("texto", {"t": "¡Probemos!"}) in evs
    accion = next(d for e, d in evs if e == "accion")
    assert accion == {"tipo": "jugar_nivel", "nivel": "c1", "ejemplo": "Sellá una factura."}
    assert evs[-1][0] == "fin"
    assert len(falso.pedidos) == 1, "con texto y nivel no hace falta otra vuelta"


def test_herramienta_sin_texto_pide_otra_vuelta(cliente):
    tc, falso = cliente([
        respuesta([bloque_herramienta("mostrar_sitio", {"tema": "aranceles", "curso": 0})], stop="tool_use"),
        respuesta([bloque_texto("Son $850.000 en total.")]),
    ])
    evs = pedir(tc, "¿cuánto sale?")
    assert ("accion", {"tipo": "mostrar_sitio", "tema": "aranceles", "curso": None}) in evs
    assert ("texto", {"t": "Son $850.000 en total."}) in evs
    assert len(falso.pedidos) == 2
    resultado = falso.pedidos[1]["messages"][-1]["content"][0]
    assert resultado["type"] == "tool_result" and resultado["tool_use_id"] == "tu_1"


def test_argumentos_invalidos_no_llegan_al_widget(cliente):
    tc, falso = cliente([
        respuesta([bloque_herramienta("jugar_nivel", {"nivel": "c9", "ejemplo": ""})], stop="tool_use"),
        respuesta([bloque_texto("Elegí un nivel del mapa.")]),
    ])
    evs = pedir(tc, "jugar")
    assert not [d for e, d in evs if e == "accion"]
    assert falso.pedidos[1]["messages"][-1]["content"][0]["is_error"] is True


def test_sugerencias_se_recortan_y_validan(cliente):
    ops = [{"etiqueta": f"Op {i}", "tipo": "nivel", "valor": "c2"} for i in range(6)]
    ops.append({"etiqueta": "mala", "tipo": "otra", "valor": "x"})
    tc, _ = cliente([respuesta([bloque_texto("Dale."), bloque_herramienta("sugerir", {"opciones": ops})],
                               stop="tool_use")])
    accion = next(d for e, d in pedir(tc, "¿qué hago?") if e == "accion")
    assert len(accion["opciones"]) == 4


def test_parte_fija_cacheada_y_estado_al_final(cliente):
    tc, falso = cliente([respuesta([bloque_texto("Hola.")])])
    pedir(tc, "hola", {"insignias": ["c1"], "pendientes": ["c2", "c3", "c4"], "wallet": True})
    p = falso.pedidos[0]
    assert p["system"][0]["cache_control"] == {"type": "ephemeral"}
    assert "Información del sitio" in p["system"][0]["text"]
    ultimo = p["messages"][-1]["content"]
    assert "<estado_del_juego>" in ultimo[0]["text"] and "c1" in ultimo[0]["text"]
    assert ultimo[1]["text"] == "hola"


def test_mensajes_seguidos_del_mismo_rol_se_juntan():
    p = modulo.Pedido(mensajes=[
        {"rol": "asistente", "texto": "¡Hola!"},
        {"rol": "usuario", "texto": "Nivel 1"},
        {"rol": "asistente", "texto": "Escribí algo."},
        {"rol": "asistente", "texto": "Mirá a la derecha."},
        {"rol": "usuario", "texto": "¿qué es un hash?"},
    ])
    m = modulo.armar_mensajes(p)
    assert [x["role"] for x in m] == ["user", "assistant", "user"]
    assert "Mirá a la derecha." in m[1]["content"]


def test_sin_clave_no_llama_al_modelo(cliente, monkeypatch):
    tc, falso = cliente([])
    monkeypatch.setattr(modulo, "LLM_API_KEY", "")
    evs = pedir(tc, "hola")
    assert evs[0][0] == "error" and not falso.pedidos
