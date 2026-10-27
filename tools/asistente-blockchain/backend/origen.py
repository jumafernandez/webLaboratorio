"""Dirección de origen de un pedido, para los topes (chat, cadena, medición).

X-Real-IP solo se cree cuando la conexión viene de un proxy de confianza (el nginx de la VM, que pisa el encabezado
con $remote_addr). Si no, cualquier cliente podría mandar un X-Real-IP distinto en cada pedido y saltearse los topes
por origen. PROXIES_CONFIABLES (entorno o .env) es una lista separada por comas; vacía por defecto, así con DEV=1 o
con uvicorn expuesto el encabezado se ignora. En producción va PROXIES_CONFIABLES=127.0.0.1 (nginx en la misma VM).
CADENA_PROXIES_CONFIABLES se acepta como nombre alternativo.
"""

import os
import pathlib

from fastapi import Request

RAIZ = pathlib.Path(__file__).resolve().parents[1]
_cache: dict[str, frozenset[str]] = {}


def _leer_env(nombre: str) -> str | None:
    if nombre in os.environ:
        return os.environ[nombre]
    f = RAIZ / ".env"
    if f.exists():
        for linea in f.read_text(encoding="utf-8").splitlines():
            k, _, v = linea.strip().partition("=")
            if k.strip() == nombre and not linea.lstrip().startswith("#"):
                return v.strip()
    return None


def proxies_confiables() -> frozenset[str]:
    """Se lee una vez por valor del entorno (las pruebas lo cambian con monkeypatch)."""
    crudo = _leer_env("PROXIES_CONFIABLES") or _leer_env("CADENA_PROXIES_CONFIABLES") or ""
    if crudo not in _cache:
        _cache[crudo] = frozenset(p.strip() for p in crudo.split(",") if p.strip())
    return _cache[crudo]


def origen_de(request: Request) -> str:
    directo = request.client.host if request.client else ""
    if directo and directo in proxies_confiables():
        real = (request.headers.get("x-real-ip") or "").strip()
        if real and len(real) <= 64:
            return real
    return directo
