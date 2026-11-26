"""Respuestas del anotador de parafraseos (backend/anotador.py). Sin modelos ni red: corre en segundos.

Uso: .venv/bin/python -m pytest tests/
"""

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from backend.anotador import Base, Caso, Lote, limpiar_nombre, rutas


@pytest.fixture
def api(tmp_path):
    r = rutas(Base(tmp_path / "a.sqlite3"))
    return {(ruta.path, list(ruta.methods)[0]): ruta.endpoint for ruta in r.routes}


def test_guarda_y_carga_por_anotador(api):
    guardar, cargar = api[("/dev-ia/api/anotador", "POST")], api[("/dev-ia/api/anotador", "GET")]
    lote = Lote(anotador="Francisco", lista=[Caso(id=1, acto={"request": "si", "good bye": "no"},
                                                   datos={"personfullname": "duda"}, idioma="en")])
    assert guardar(lote) == {"ok": True, "casos": 1}
    assert cargar("francisco") == {"1": {"acto": {"request": "si", "good bye": "no"}, "datos": {"personfullname": "duda"}}}
    assert cargar("cari") == {}


def test_cada_guardado_reemplaza_el_caso(api):
    guardar, cargar = api[("/dev-ia/api/anotador", "POST")], api[("/dev-ia/api/anotador", "GET")]
    guardar(Lote(anotador="jm", lista=[Caso(id=5, acto={"inform": "si"})]))
    guardar(Lote(anotador="jm", lista=[Caso(id=5, acto={"inform": "no"}, datos={"time": "si"})]))
    assert cargar("jm") == {"5": {"acto": {"inform": "no"}, "datos": {"time": "si"}}}


def test_descarta_respuestas_invalidas(api):
    guardar, cargar = api[("/dev-ia/api/anotador", "POST")], api[("/dev-ia/api/anotador", "GET")]
    guardar(Lote(anotador="jm", lista=[Caso(id=2, acto={"inform": "tal vez", "x" * 61: "si", "offer": "si"})]))
    assert cargar("jm") == {"2": {"acto": {"offer": "si"}, "datos": {}}}


def test_rechaza_casos_fuera_de_rango_e_idiomas_desconocidos():
    with pytest.raises(ValidationError):
        Caso(id=61)
    with pytest.raises(ValidationError):
        Caso(id=1, idioma="fr")


def test_nombre_vacio_o_raro(api):
    assert limpiar_nombre("  Juan Manuel ") == "juan-manuel"
    with pytest.raises(HTTPException):
        api[("/dev-ia/api/anotador", "GET")]("!!!")
