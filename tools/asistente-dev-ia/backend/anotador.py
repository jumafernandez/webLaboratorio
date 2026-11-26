"""Respuestas del anotador de parafraseos de D2F (licdia.unlu.edu.ar/anotador-d2f), en un SQLite propio.

La página muestra una oración generada por un modelo de lenguaje y, debajo, cada acción y cada dato de la etiqueta del
turno original; quien anota responde "si", "no" o "duda" a cada uno. Por anotador y caso se guarda una fila con esas
respuestas, el idioma en que se anotó (es o en) y la hora; cada guardado reemplaza la fila entera del caso.
No hay datos personales: el anotador es el nombre que figura en su enlace (?a=nombre).

La base va en STATE_DIRECTORY (systemd la crea en /var/lib/asistente-dev-ia) o, en desarrollo, en ../datos/.
"""

import json
import os
import pathlib
import re
import sqlite3
import threading
import time

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

RAIZ = pathlib.Path(__file__).resolve().parents[1]
CASOS = 60
VALORES = {"si", "no", "duda"}
FUERA = re.compile(r"[^a-z0-9áéíóúñü_-]")

ESQUEMA = """
CREATE TABLE IF NOT EXISTS respuestas (
    anotador TEXT NOT NULL, caso INTEGER NOT NULL, acciones TEXT NOT NULL, datos TEXT NOT NULL, idioma TEXT,
    actualizado TEXT NOT NULL, PRIMARY KEY (anotador, caso));
"""


def limpiar_nombre(texto: str) -> str:
    """El mismo criterio que la página: minúsculas, espacios como guiones y solo letras, números, - y _."""
    return FUERA.sub("", re.sub(r"\s+", "-", str(texto or "").lower().strip()))[:40]


def limpiar_respuestas(d: dict) -> dict:
    """Solo etiquetas cortas con respuestas válidas; a lo sumo 20 por caso."""
    return {k: v for k, v in list(d.items())[:20] if 0 < len(k) <= 60 and v in VALORES}


class Base:
    def __init__(self, ruta: pathlib.Path | None = None):
        if ruta is None:
            carpeta = pathlib.Path(os.environ.get("STATE_DIRECTORY") or RAIZ / "datos")
            carpeta.mkdir(parents=True, exist_ok=True)
            ruta = carpeta / "anotador.sqlite3"
        self.db = sqlite3.connect(ruta, check_same_thread=False, isolation_level=None)
        self.db.executescript(ESQUEMA)
        self.cerrojo = threading.Lock()

    def cargar(self, anotador: str) -> dict:
        """{caso: {"acto": {...}, "datos": {...}}} de un anotador."""
        with self.cerrojo:
            filas = self.db.execute("SELECT caso, acciones, datos FROM respuestas WHERE anotador = ?", (anotador,))
            return {str(c): {"acto": json.loads(a), "datos": json.loads(d)} for c, a, d in filas}

    def guardar(self, anotador: str, casos: list) -> int:
        ahora = time.strftime("%Y-%m-%d %H:%M:%S")
        with self.cerrojo:
            for x in casos:
                self.db.execute(
                    "INSERT INTO respuestas (anotador, caso, acciones, datos, idioma, actualizado) VALUES (?, ?, ?, ?, ?, ?) "
                    "ON CONFLICT (anotador, caso) DO UPDATE SET acciones = excluded.acciones, datos = excluded.datos, "
                    "idioma = excluded.idioma, actualizado = excluded.actualizado",
                    (anotador, x.id, json.dumps(limpiar_respuestas(x.acto), ensure_ascii=False),
                     json.dumps(limpiar_respuestas(x.datos), ensure_ascii=False), x.idioma, ahora))
        return len(casos)


class Caso(BaseModel):
    id: int = Field(ge=1, le=CASOS)
    acto: dict[str, str] = Field(default_factory=dict)
    datos: dict[str, str] = Field(default_factory=dict)
    idioma: str = Field(default="es", pattern="^(es|en)$")


class Lote(BaseModel):
    anotador: str = Field(min_length=1, max_length=60)
    lista: list[Caso] = Field(max_length=CASOS)


def rutas(base: Base) -> APIRouter:
    """GET carga las respuestas de un anotador; POST guarda las de uno o más casos."""
    r = APIRouter()

    @r.get("/dev-ia/api/anotador")
    def cargar(anotador: str = ""):
        a = limpiar_nombre(anotador)
        if not a:
            raise HTTPException(400, "falta el nombre de quien anota")
        return base.cargar(a)

    @r.post("/dev-ia/api/anotador")
    def guardar(lote: Lote):
        a = limpiar_nombre(lote.anotador)
        if not a:
            raise HTTPException(400, "falta el nombre de quien anota")
        return {"ok": True, "casos": base.guardar(a, lote.lista)}

    return r
