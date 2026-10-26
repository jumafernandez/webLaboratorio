"""Contadores del día para el mapa del juego ("hoy los visitantes ganaron N insignias").

Solo cantidades por día y tipo de evento, en la misma base SQLite del registro: nada que identifique a nadie.
"""

import sqlite3
import threading
import time

ESQUEMA = """
CREATE TABLE IF NOT EXISTS eventos (dia TEXT NOT NULL, tipo TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0,
                                    PRIMARY KEY (dia, tipo));
"""


class Estadisticas:
    def __init__(self, db: sqlite3.Connection, cerrojo: threading.Lock):
        self.db = db
        self.cerrojo = cerrojo
        self.db.executescript(ESQUEMA)

    def sumar(self, tipo: str) -> None:
        with self.cerrojo:
            self.db.execute(
                "INSERT INTO eventos (dia, tipo, n) VALUES (?, ?, 1) ON CONFLICT (dia, tipo) "
                "DO UPDATE SET n = n + 1",
                (time.strftime("%Y-%m-%d"), tipo),
            )

    def hoy(self) -> dict[str, int]:
        filas = dict(
            self.db.execute(
                "SELECT tipo, n FROM eventos WHERE dia = ?",
                (time.strftime("%Y-%m-%d"),),
            )
        )
        return {
            "insignias_hoy": filas.get("insignia", 0),
            "certificados_hoy": filas.get("certificado", 0),
        }
