"""Medición anónima del embudo de conversión del asistente-juego.

El widget (widget/medicion.js) manda eventos chicos a POST /blockchain-dev/api/m:
{"sesion": id al azar de sessionStorage (16 a 32 hex), "evento": uno de EVENTOS, "datos": objeto plano chico}.
Se guardan día, hora (HH:MM), sesión, evento y datos en la tabla `medicion` de la misma base SQLite del registro
(backend/registro.py). NO se guarda la dirección de origen ni texto escrito por la persona: los datos solo admiten las
claves previstas para cada evento, con valores cortos (las preguntas al agente ya quedan en el registro, sin datos
personales). Un tope por día por dirección de origen (hash con una sal que cambia cada día, como registro.py) frena
abusos; las filas más viejas que DIAS_RETENCION se borran solas. MEDICION=0 (entorno o .env) la apaga: el endpoint
responde 204 sin guardar y `Medicion.activa` es False, para que /estado le avise al widget.

Con DEV=1 hay además un panel: GET /blockchain-dev/api/panel[?dias=30] con los números de ingesta/embudo.py.

Para enchufarla en backend/app.py (comparte la conexión y el cerrojo del registro, como Estadisticas):

    from backend import medicion
    MEDICION = medicion.Medicion(REGISTRO.db, REGISTRO.cerrojo)
    app.include_router(medicion.crear_router(MEDICION, dev=DEV))
    # y en GET /blockchain-dev/api/estado: "medicion": MEDICION.activa

`medicion.router` también existe (se arma la primera vez que se lo pide, con su propia conexión a la base).
"""

import hashlib
import html
import json
import os
import pathlib
import re
import secrets
import sqlite3
import threading
import time

from fastapi import APIRouter, Request, Response
from fastapi.responses import HTMLResponse, JSONResponse

from backend.origen import origen_de
from ingesta import embudo

RAIZ = pathlib.Path(__file__).resolve().parents[1]
DIAS_RETENCION = 180
EVENTOS_POR_DIA = 300            # por dirección de origen
MAX_CUERPO = 2048                # bytes
MAX_CLAVES = 6
MAX_TEXTO = 60

# Evento → claves admitidas en datos
EVENTOS: dict[str, frozenset[str]] = {
    "visita": frozenset({"vista"}),
    "entro_juego": frozenset({"fuente"}),
    "nivel_inicio": frozenset({"nivel"}),
    "nivel_paso": frozenset({"nivel", "paso"}),
    "nivel_fin": frozenset({"nivel"}),
    "nivel_abandono": frozenset({"nivel", "paso"}),
    "insignia": frozenset({"id"}),
    "certificado": frozenset(),
    "pregunta_agente": frozenset({"acciones"}),
    "tema_sitio": frozenset({"tema"}),
    "sitio_convencional": frozenset(),
    "volver_juego": frozenset(),
    "ir_seccion": frozenset({"ancla"}),
    "lista_espera_click": frozenset({"origen"}),
    "lista_espera_enviada": frozenset({"origen"}),
    "ver_por_dentro": frozenset({"tab"}),
    "wallet_creada": frozenset({"real"}),
    "tx_real": frozenset({"accion", "ok"}),
    "texto_rechazado": frozenset({"motivo"}),
    "ver_red": frozenset(),
    "compartir": frozenset({"red", "id"}),
    "perfil": frozenset({"perfil"}),
    "fragmento": frozenset({"curso"}),
}

SESION = re.compile(r"[0-9a-f]{16,32}")

# Valores admitidos por clave: identificadores fijos del widget, nunca texto de la persona. Tienen que coincidir con
# widget/juego.js (niveles e insignias), widget/sitio.js (temas), backend/app.py (ANCLAS y tipos de acción del agente)
# y los ctx.paso() de widget/niveles/*.js. Un valor fuera de la lista es 400.
NIVELES = frozenset({"c1", "c2", "c3", "c4", "nft", "hack", "firmas"})
PASOS = frozenset({
    "inicio",
    "mensaje", "minado", "bloque_encima", "cadena_rota",                               # nivel 1
    "supply", "deploy", "pool", "compradores", "ballena", "rug_pull",                  # nivel 2
    "nodo_apagado", "sin_quorum", "recuperada", "capa2", "paquete",                    # nivel 3
    "faucet", "producto", "approve", "pago", "recibo", "revert",                      # nivel 4
    "diseno", "nombre", "minteo",                                                      # bonus NFT
    "ataque", "ataque_bloqueado", "arreglo",                                           # bonus hack
    "firma", "adulterar", "impostor",                                                  # bonus firmas
})
ACCIONES_AGENTE = frozenset({"jugar_nivel", "mostrar_sitio", "llevar_al_sitio", "sugerir", "ninguna"})
VALORES: dict[str, frozenset] = {
    "nivel": NIVELES,
    "paso": PASOS,
    "fuente": frozenset({"chip", "texto", "mapa", "sitio"}),
    "tab": frozenset({"agente", "cadena"}),
    "tema": frozenset({"plan", "docentes", "aranceles", "inscripcion", "requisitos", "destinatarios", "salida"}),
    "ancla": frozenset({"#informacionPlan", "#team", "#proceso-inscripcion", "#faq", "#proyectos", "#roles-laborales",
                        "#comparativa", "#prerequisitos-check", "#por-que-licdia", "/blockchain-dev/espera-2027/"}),
    "id": NIVELES | {"cert"},
    "origen": frozenset({"certificado", "recorrido", "inscripcion", "programa", "sitio", "otro"}),
    "accion": frozenset({"sellar", "token", "fondear", "pagar", "insignia"}),
    "vista": frozenset({"juego", "sitio"}),
    "red": frozenset({"linkedin", "x", "whatsapp", "copiar"}),
    "perfil": frozenset({"dev", "legal", "finanzas", "otro"}),
    "curso": frozenset({"c1", "c2", "c3", "c4"}),
    # backend/moderacion.py HERRAMIENTA + datos_personales/texto_invalido de cadena._texto
    "motivo": frozenset({"insulto", "odio", "sexual", "violencia", "politica", "publicidad", "datos_personales",
                         "texto_invalido", "otro"}),
}
BOOLEANOS = frozenset({"real", "ok"})

ESQUEMA = """
CREATE TABLE IF NOT EXISTS medicion (id INTEGER PRIMARY KEY, dia TEXT NOT NULL, momento TEXT NOT NULL,
                                     sesion TEXT NOT NULL, evento TEXT NOT NULL, datos TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS medicion_dia ON medicion (dia);
CREATE TABLE IF NOT EXISTS medicion_sal (dia TEXT PRIMARY KEY, valor TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS medicion_uso (dia TEXT NOT NULL, clave TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0,
                                         PRIMARY KEY (dia, clave));
"""


class DatosInvalidos(ValueError):
    """El cuerpo no cumple el formato: 400 sin detalles internos."""


def leer_env(nombre: str) -> str | None:
    """Del entorno o de ../.env (sin volcar el archivo al entorno ni leer otras claves)."""
    if nombre in os.environ:
        return os.environ[nombre]
    f = RAIZ / ".env"
    if f.exists():
        for linea in f.read_text(encoding="utf-8").splitlines():
            k, _, v = linea.strip().partition("=")
            if k.strip() == nombre and not linea.lstrip().startswith("#"):
                return v.strip()
    return None


def validar(cuerpo: object) -> tuple[str, str, dict]:
    """(sesion, evento, datos) o DatosInvalidos."""
    if not isinstance(cuerpo, dict) or set(cuerpo) - {"sesion", "evento", "datos"}:
        raise DatosInvalidos("cuerpo")
    sesion, evento, datos = cuerpo.get("sesion"), cuerpo.get("evento"), cuerpo.get("datos") or {}
    if not isinstance(sesion, str) or not SESION.fullmatch(sesion.lower()):
        raise DatosInvalidos("sesion")
    if not isinstance(evento, str) or evento not in EVENTOS:
        raise DatosInvalidos("evento")
    if not isinstance(datos, dict) or len(datos) > MAX_CLAVES or set(datos) - EVENTOS[evento]:
        raise DatosInvalidos("datos")
    for k, v in datos.items():
        if not valor_admitido(k, v):
            raise DatosInvalidos("valor")
    return sesion.lower(), evento, datos


def valor_admitido(clave: str, v: object) -> bool:
    if clave in BOOLEANOS:
        return isinstance(v, bool)
    if not isinstance(v, str) or len(v) > MAX_TEXTO:
        return False
    if clave == "acciones":                     # tipos de acción del agente, separados por espacios
        partes = v.split(" ")
        return 0 < len(partes) <= len(ACCIONES_AGENTE) and len(set(partes)) == len(partes) \
            and set(partes) <= ACCIONES_AGENTE
    return v in VALORES.get(clave, ())


class Medicion:
    def __init__(self, db: sqlite3.Connection | None = None, cerrojo: threading.Lock | None = None,
                 activa: bool | None = None):
        if db is None:
            carpeta = pathlib.Path(os.environ.get("STATE_DIRECTORY") or RAIZ / "datos")
            carpeta.mkdir(parents=True, exist_ok=True)
            db = sqlite3.connect(carpeta / "asistente.sqlite3", check_same_thread=False, isolation_level=None,
                                 timeout=5)
        self.db = db
        self.cerrojo = cerrojo or threading.Lock()
        self.activa = (leer_env("MEDICION") != "0") if activa is None else activa
        self.purgado = ""
        with self.cerrojo:
            self.db.executescript(ESQUEMA)
            self.purgar(time.strftime("%Y-%m-%d"))     # también al arrancar: aunque no lleguen eventos nuevos

    def purgar(self, dia: str) -> None:
        """Borra eventos fuera del período de retención y contadores y sales de días anteriores."""
        self.db.execute("DELETE FROM medicion WHERE dia < date(?, ?)", (dia, f"-{DIAS_RETENCION} days"))
        self.db.execute("DELETE FROM medicion_sal WHERE dia < ?", (dia,))
        self.db.execute("DELETE FROM medicion_uso WHERE dia < ?", (dia,))
        self.purgado = dia

    def _clave(self, dia: str, origen: str) -> str:
        self.db.execute("INSERT OR IGNORE INTO medicion_sal VALUES (?, ?)", (dia, secrets.token_hex(16)))
        sal = self.db.execute("SELECT valor FROM medicion_sal WHERE dia = ?", (dia,)).fetchone()[0]
        return hashlib.sha256((sal + origen).encode()).hexdigest()[:24]

    def anotar(self, origen: str, sesion: str, evento: str, datos: dict) -> bool:
        """Guarda el evento si la dirección no pasó el tope del día. Devuelve si lo guardó."""
        dia = time.strftime("%Y-%m-%d")
        with self.cerrojo:
            if self.purgado != dia:
                self.purgar(dia)
            if not self.activa:
                return False
            clave = self._clave(dia, origen)
            fila = self.db.execute("SELECT n FROM medicion_uso WHERE dia = ? AND clave = ?", (dia, clave)).fetchone()
            if fila and fila[0] >= EVENTOS_POR_DIA:
                return False
            self.db.execute("INSERT INTO medicion_uso (dia, clave, n) VALUES (?, ?, 1) ON CONFLICT (dia, clave) "
                            "DO UPDATE SET n = n + 1", (dia, clave))
            self.db.execute("INSERT INTO medicion (dia, momento, sesion, evento, datos) VALUES (?, ?, ?, ?, ?)",
                            (dia, time.strftime("%H:%M"), sesion, evento,
                             json.dumps(datos, ensure_ascii=False, sort_keys=True)))
            return True

    def embudo(self, dias: int = 30) -> dict:
        with self.cerrojo:
            dia = time.strftime("%Y-%m-%d")
            if self.purgado != dia:
                self.purgar(dia)
            return embudo.calcular(self.db, min(dias, DIAS_RETENCION))


def coma(x: float) -> str:
    """1 decimal con coma, como se escribe en la Argentina."""
    return f"{x:.1f}".replace(".", ",")


def barra(etiqueta: str, n: int, porcentaje: float, extra: str = "") -> str:
    ancho = max(0.0, min(100.0, porcentaje))
    return (f'<div class="fila"><span class="et">{html.escape(etiqueta)}</span>'
            f'<span class="barra"><i style="width:{ancho:.1f}%"></i></span>'
            f'<span class="num">{n} · {coma(porcentaje)} %{html.escape(extra)}</span></div>')


def panel_html(r: dict) -> str:
    """El embudo con barras simples, en la paleta del sitio de Blockchain."""
    filas = [barra(nombre, r["embudo"][k]["n"], r["embudo"][k]["pct"]) for k, nombre in embudo.PASOS]
    niveles = [barra(f"{nivel}: {f['finales']} de {f['inicios']}", f["finales"], f["pct_completan"],
                     f" · abandonos {f['abandonos']}" + (f" (más en «{f['paso_abandono']}»)" if f["paso_abandono"]
                                                         else ""))
               for nivel, f in r["niveles"].items()]
    total_fuentes = sum(r["fuentes"].values())
    fuentes = [barra(f, n, embudo.pct(n, total_fuentes)) for f, n in r["fuentes"].items()] or ["<p>Sin datos.</p>"]
    a, s = r["agente"], r["sitio_convencional"]
    return f"""<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Embudo del juego</title>
<style>
:root {{ --fondo: #261951; --tarjeta: #4C1C7F; --lavanda: #c4b5fd; --oro: #ffd782; --texto: #f5f3ff; }}
body {{ margin: 0; background: var(--fondo); color: var(--texto); font: 15px/1.5 system-ui, sans-serif; }}
main {{ max-width: 860px; margin: 0 auto; padding: 24px 16px; }}
h1 {{ color: var(--oro); font-size: 1.4rem; }} h2 {{ color: var(--lavanda); font-size: 1.05rem; margin-top: 28px; }}
section {{ background: var(--tarjeta); border-radius: 12px; padding: 12px 16px; }}
.fila {{ display: grid; grid-template-columns: minmax(120px, 1.2fr) 2fr minmax(110px, 1fr); gap: 10px;
        align-items: center; padding: 4px 0; }}
.barra {{ height: 12px; background: rgba(196, 181, 253, .18); border-radius: 6px; overflow: hidden; }}
.barra i {{ display: block; height: 100%; background: linear-gradient(90deg, var(--lavanda), var(--oro)); }}
.num {{ font-variant-numeric: tabular-nums; color: var(--lavanda); font-size: .9rem; }}
@media (max-width: 560px) {{ .fila {{ grid-template-columns: 1fr; gap: 2px; }} }}
</style></head><body><main>
<h1>Embudo del asistente-juego</h1>
<p>{html.escape(r["desde"])} a {html.escape(r["hasta"])} ({r["dias"]} días) · {r["eventos"]} eventos ·
{r["embudo"]["visitas"]["n"]} sesiones con visita ({html.escape(", ".join(f"{k} {n}" for k, n in r["vistas"].items())
or "—")}) · {r["sesiones_sin_visita"]} sin visita, fuera del denominador · solo en desarrollo</p>
<h2>Embudo (% de las visitas)</h2><section>{"".join(filas)}</section>
<h2>Por nivel (% que completa)</h2><section>{"".join(niveles)}</section>
<h2>Entrada al juego</h2><section>{"".join(fuentes)}</section>
<h2>Agente y sitio convencional</h2><section>
<p>Preguntas al agente: {a["preguntas"]} ({f"{a['por_sesion']:.2f}".replace(".", ",")} por sesión;
{f"{a['por_sesion_que_pregunto']:.2f}".replace(".", ",")} entre
las {a["sesiones_con_preguntas"]} sesiones que preguntaron).</p>
{barra("Sitio convencional", s["n"], s["pct"])}</section>
</main></body></html>"""


def crear_router(medicion: Medicion | None = None, dev: bool | None = None) -> APIRouter:
    m = medicion or Medicion()
    dev = (leer_env("DEV") == "1") if dev is None else dev
    r = APIRouter(prefix="/blockchain-dev/api")

    @r.post("/m", status_code=204)
    async def medir(request: Request) -> Response:
        cuerpo = await request.body()
        if len(cuerpo) > MAX_CUERPO:
            return JSONResponse({"error": "muy_grande"}, status_code=413)
        try:
            sesion, evento, datos = validar(json.loads(cuerpo or b"null"))
        except (ValueError, UnicodeDecodeError):     # json inválido o DatosInvalidos
            return JSONResponse({"error": "evento_invalido"}, status_code=400)
        m.anotar(origen_de(request), sesion, evento, datos)
        return Response(status_code=204)

    if dev:
        @r.get("/panel", response_class=HTMLResponse)
        def panel(dias: int = 30) -> HTMLResponse:
            return HTMLResponse(panel_html(m.embudo(max(1, min(dias, DIAS_RETENCION)))))

    r.medicion = m          # para /estado y las pruebas
    return r


def __getattr__(nombre: str):
    """`medicion.router` se arma al pedirlo, así importar el módulo no abre la base."""
    if nombre == "router":
        globals()["router"] = crear_router()
        return globals()["router"]
    raise AttributeError(nombre)
