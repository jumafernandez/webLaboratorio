"""Topes de uso y registro anónimo de preguntas, en un SQLite local.

Topes (backend/topes.json): preguntas por día por dirección de origen, y gasto en dólares por día para todo el
asistente. Al llegar a cualquiera de los dos la pregunta no llega al modelo y la persona ve un mensaje con el contacto;
el tope global además deja un aviso en el registro del servicio (journalctl) una vez por día.

Registro: cada pregunta queda con la fecha, las secciones recuperadas, si la respuesta derivó al contacto (el indicio
de que el sitio no tenía el dato), tokens, costo y tiempos, y la opinión de la persona si la da (útil / no me sirvió y
un comentario opcional, ligados a la pregunta por una clave al azar que solo conoce esa página). No se guarda la
dirección de origen ni nada que identifique a quien pregunta: el contador por dirección usa un hash con una sal que
cambia cada día, y los correos y números de teléfono o documento que alguien escriba en la pregunta o el comentario se
reemplazan antes de guardarlos. Las filas más viejas que dias_registro se borran solas.

La base va en STATE_DIRECTORY (systemd la crea en /var/lib/asistente-dev-ia) o, en desarrollo, en ../datos/.
"""

import hashlib
import json
import os
import pathlib
import re
import secrets
import sqlite3
import threading
import time

RAIZ = pathlib.Path(__file__).resolve().parents[1]
CONF = json.loads((RAIZ / "backend" / "topes.json").read_text(encoding="utf-8"))

ESQUEMA = """
CREATE TABLE IF NOT EXISTS sal (dia TEXT PRIMARY KEY, valor TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS uso (dia TEXT NOT NULL, clave TEXT NOT NULL, preguntas INTEGER NOT NULL DEFAULT 0,
                                usd REAL NOT NULL DEFAULT 0, avisado INTEGER NOT NULL DEFAULT 0,
                                PRIMARY KEY (dia, clave));
CREATE TABLE IF NOT EXISTS preguntas (
    id INTEGER PRIMARY KEY, momento TEXT NOT NULL, pregunta TEXT NOT NULL, turno INTEGER NOT NULL,
    secciones TEXT NOT NULL, deriva INTEGER, bloqueo TEXT, error TEXT, modelo TEXT,
    tokens_entrada INTEGER, tokens_cache_lectura INTEGER, tokens_cache_escritura INTEGER, tokens_salida INTEGER,
    usd REAL, ms_primer_token INTEGER, ms_total INTEGER, clave TEXT, voto INTEGER, comentario TEXT);
CREATE INDEX IF NOT EXISTS preguntas_clave ON preguntas (clave);
"""

# Datos personales que alguien puede escribir en la pregunta: no se guardan
CORREO = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
NUMERO = re.compile(r"\+?\d[\d\s.-]{5,}\d")          # teléfonos, DNI, CUIT, tarjetas: 7 dígitos o más

# Frases con las que el asistente deriva al contacto (ver REGLAS en app.py). Incluye las respuestas a "¿cómo me
# comunico?", así que es un indicio, no una medida exacta de datos faltantes.
DERIVA = re.compile(r"licdia@unlu\.edu\.ar|whats ?app|no (?:lo )?tengo a mano", re.IGNORECASE)


def hoy() -> str:
    return time.strftime("%Y-%m-%d")


def limpiar(texto: str) -> str:
    return NUMERO.sub("[número]", CORREO.sub("[correo]", texto))[:600]


class Registro:
    def __init__(self, ruta: pathlib.Path | None = None):
        if ruta is None:
            carpeta = pathlib.Path(os.environ.get("STATE_DIRECTORY") or RAIZ / "datos")
            carpeta.mkdir(parents=True, exist_ok=True)
            ruta = carpeta / "asistente.sqlite3"
        self.db = sqlite3.connect(ruta, check_same_thread=False, isolation_level=None)
        self.db.executescript(ESQUEMA)
        self.cerrojo = threading.Lock()
        self.purgado = ""

    def _purgar(self, dia: str):
        """Una vez por día: borra contadores y sales viejas y las preguntas fuera del período de registro."""
        if self.purgado == dia:
            return
        self.db.execute("DELETE FROM sal WHERE dia < ?", (dia,))
        self.db.execute("DELETE FROM uso WHERE dia < date(?, '-2 days')", (dia,))
        retencion = f"-{int(CONF['dias_registro'])} days"
        self.db.execute("DELETE FROM preguntas WHERE momento < date(?, ?)", (dia, retencion))
        self.purgado = dia

    def _clave(self, dia: str, origen: str) -> str:
        fila = self.db.execute("SELECT valor FROM sal WHERE dia = ?", (dia,)).fetchone()
        if fila is None:
            sal = secrets.token_hex(16)
            self.db.execute("INSERT INTO sal VALUES (?, ?)", (dia, sal))
        else:
            sal = fila[0]
        return "ip:" + hashlib.sha256((sal + origen).encode()).hexdigest()[:24]

    def admitir(self, origen: str) -> str | None:
        """Cuenta la pregunta si está dentro de los topes. Devuelve None, o el tope alcanzado ("persona" o "global")."""
        dia = hoy()
        with self.cerrojo:
            self._purgar(dia)
            clave = self._clave(dia, origen)
            g = self.db.execute("SELECT usd, avisado FROM uso WHERE dia = ? AND clave = 'global'", (dia,)).fetchone()
            if g and g[0] >= CONF["usd_por_dia"]:
                if not g[1]:
                    print(f"AVISO: el asistente llegó al tope de gasto diario (USD {g[0]:.2f} de "
                          f"{CONF['usd_por_dia']}); hasta mañana no responde preguntas.", flush=True)
                    self.db.execute("UPDATE uso SET avisado = 1 WHERE dia = ? AND clave = 'global'", (dia,))
                return "global"
            p = self.db.execute("SELECT preguntas FROM uso WHERE dia = ? AND clave = ?", (dia, clave)).fetchone()
            if p and p[0] >= CONF["preguntas_por_persona_por_dia"]:
                return "persona"
            for c in (clave, "global"):
                self.db.execute("INSERT INTO uso (dia, clave, preguntas) VALUES (?, ?, 1) ON CONFLICT (dia, clave) "
                                "DO UPDATE SET preguntas = preguntas + 1", (dia, c))
            return None

    def anotar(self, pregunta: str, turno: int, secciones: list[str], respuesta: str = "", bloqueo: str | None = None,
               error: str | None = None, modelo: str | None = None, uso: dict | None = None,
               ms_primer_token: int | None = None, ms_total: int | None = None, clave: str | None = None):
        """Guarda la pregunta (sin datos personales) y suma su costo al gasto del día."""
        uso = uso or {}
        dia = hoy()
        with self.cerrojo:
            self.db.execute(
                "INSERT INTO preguntas (momento, pregunta, turno, secciones, deriva, bloqueo, error, modelo, "
                "tokens_entrada, tokens_cache_lectura, tokens_cache_escritura, tokens_salida, usd, ms_primer_token, "
                "ms_total, clave) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (time.strftime("%Y-%m-%d %H:%M"), limpiar(pregunta), turno, json.dumps(secciones),
                 int(bool(DERIVA.search(respuesta))) if respuesta else None, bloqueo, error, modelo,
                 uso.get("entrada"), uso.get("cache_lectura"), uso.get("cache_escritura"), uso.get("salida"),
                 uso.get("usd"), ms_primer_token, ms_total, clave))
            if uso.get("usd"):
                self.db.execute("INSERT INTO uso (dia, clave, usd) VALUES (?, 'global', ?) ON CONFLICT (dia, clave) "
                                "DO UPDATE SET usd = usd + excluded.usd", (dia, uso["usd"]))

    def opinar(self, clave: str, voto: int, comentario: str = "") -> bool:
        """Útil (1) o no (-1) y comentario opcional sobre una respuesta de las últimas 24 horas. Se puede cambiar."""
        with self.cerrojo:
            c = self.db.execute("UPDATE preguntas SET voto = ?, comentario = ? WHERE clave = ? "
                                "AND momento >= strftime('%Y-%m-%d %H:%M', 'now', 'localtime', '-1 day')",
                                (voto, limpiar(comentario)[:500] or None, clave))
            return c.rowcount > 0
