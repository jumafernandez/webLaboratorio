"""Moderación de los textos que el juego escribe en la cadena real (sello, nombre y símbolo del token, nombre del NFT).

Lo que va a Base Sepolia queda público y para siempre, y lleva la firma de la diplomatura: antes de mandarlo se revisa
en dos capas.

1. Lista local (siempre, sin red): insultos, groserías, términos discriminatorios y sexuales en castellano rioplatense
   e inglés, después de normalizar (minúsculas, sin acentos, leetspeak 4→a 3→e 0→o 1→i 5→s 7→t @→a $→s, letras
   repetidas colapsadas, letras sueltas separadas por espacios o puntos unidas: "p u t o", "p.u.t.o", "putooo").
   Se compara por palabra, no por subcadena, para no rechazar "computadora" o "disputa". Links y arrobas de redes
   también se rechazan (spam permanente). Palabras que dependen del contexto ("negro", "gordo", "matar") no están en
   la lista: las decide el modelo.
2. Un modelo chico (Haiku) con criterio: agravios sin malas palabras, acoso a alguien con nombre y apellido,
   odio, contenido sexual, violencia, propaganda política partidaria, publicidad o estafas. Solo corre si hay clave
   de API; si la llamada falla, el texto NO va a la cadena real (fail-closed): el juego sigue con la simulada.

Los veredictos se guardan en memoria por texto normalizado: /revisar (lo que llama el widget apenas la persona
escribe) y la escritura en la cadena no pagan dos veces el mismo chequeo.
"""

import re
import threading
import unicodedata
from collections import OrderedDict

MODELO = "claude-haiku-5-5"
MAX_CACHE = 2000

# Raíces que se comparan contra el comienzo de cada palabra ("pelotud" → pelotudo, pelotuda, pelotudez).
PREFIJOS = (
    "pelotud", "boludo", "boluda", "boludit", "forro", "forra", "pajer", "chot", "conchud", "garch", "cogid",
    "mierd", "cagon", "cagad", "hijodeput", "putit", "putaz", "puton", "puto", "puta", "maric", "sudac",
    "mogol", "retrasad", "subnormal", "idiot", "imbecil", "estupid", "tarad", "culiad", "culead", "poronga",
    "verga", "vagin", "teton", "porno", "chupal", "chupam", "mamad", "violad", "violar", "nazi", "hitler",
    "fuck", "shit", "bitch", "cunt", "pussy", "nigg", "whore", "slut", "retard", "porn", "asshole", "bastard",
    "motherf",
)
# Palabras que empiezan con una raíz de arriba pero son inocentes.
EXCEPCIONES = {"putativo", "putativa", "forrado", "forrada", "forraje", "chotis", "mamadera", "mamaderas"}
# Palabras completas: cortas o con muchos falsos positivos como raíz.
PALABRAS = {
    "orto", "trola", "trolo", "trolos", "trolas", "pete", "petera", "petero", "sorete", "soretes", "concha",
    "conchas", "culo", "culos", "pija", "pijas", "teta", "tetas", "pene", "gil", "giles", "gila", "ass", "dick",
    "dicks", "cock", "cocks", "fag", "faggot", "fck", "fk", "stfu", "lpm", "lpmqtp", "lcdtm", "ctm", "ptm", "cdtm",
    "hdp", "hdps", "rape",
}

LEET = str.maketrans({"4": "a", "@": "a", "3": "e", "1": "i", "!": "i", "0": "o", "5": "s", "$": "s", "7": "t",
                      "8": "b", "9": "g"})
LINK = re.compile(r"(?:https?://|www\.|\b[\w-]+\.(?:com|net|org|io|xyz|ar|app|me|ly|gg|link|site|online)\b)",
                  re.IGNORECASE)
ARROBA = re.compile(r"(?<![\w.])@\w{3,}")

SISTEMA = """Revisás textos cortos que un visitante quiere grabar para siempre y en público en una blockchain, \
dentro de un juego en el sitio de una diplomatura universitaria (LICDIA, Universidad Nacional de Luján, Argentina). \
El texto es un mensaje, el nombre de una moneda inventada, su símbolo o el nombre de un NFT.

Aprobá casi todo: saludos, chistes sanos, frases, deseos, nombres propios o apodos, nombres de equipos, emojis, \
texto sin sentido, otros idiomas, críticas educadas, menciones a cripto o a la universidad.

Rechazá solo si el texto tiene: insultos o groserías (también disfrazados o en lunfardo), agravios o burlas hacia \
una persona o un grupo, discriminación u odio, contenido sexual, violencia o amenazas, drogas, propaganda política \
partidaria o electoral, publicidad, links, estafas o pedidos de dinero, datos personales de alguien (teléfono, \
documento, dirección, correo) o algo que deje mal a la universidad si apareciera en un explorador público.

Respondé solo con la herramienta veredicto."""

HERRAMIENTA = {
    "name": "veredicto",
    "description": "Decisión sobre si el texto puede grabarse en la cadena pública.",
    "input_schema": {
        "type": "object",
        "properties": {
            "ok": {"type": "boolean"},
            "motivo": {"type": "string", "enum": ["ok", "insulto", "odio", "sexual", "violencia", "politica",
                                                   "publicidad", "datos_personales", "otro"]},
        },
        "required": ["ok", "motivo"],
    },
}


def normalizar(texto: str) -> str:
    """Minúsculas, sin acentos, leetspeak traducido y letras repetidas colapsadas (putooo → puto)."""
    t = unicodedata.normalize("NFKD", texto.casefold())
    t = "".join(ch for ch in t if not unicodedata.combining(ch)).translate(LEET)
    return re.sub(r"([a-z])\1{2,}", r"\1", t)


def palabras(texto: str) -> list[str]:
    """Palabras normalizadas. Las letras sueltas seguidas ("p u t o", "p.u.t.o", "p-u-t-o") se unen en una."""
    crudas = re.findall(r"[a-zñ]+", normalizar(texto))
    salida: list[str] = []
    sueltas: list[str] = []
    for w in crudas:
        if len(w) == 1:
            sueltas.append(w)
            continue
        if len(sueltas) >= 3:
            salida.append("".join(sueltas))
        else:
            salida.extend(sueltas)
        sueltas = []
        salida.append(w)
    salida.extend(["".join(sueltas)] if len(sueltas) >= 3 else sueltas)
    return salida


def _bloqueada(w: str) -> bool:
    for v in {w, re.sub(r"([a-z])\1", r"\1", w)}:      # también con las dobles colapsadas: "puttto" → "puto"
        if v in PALABRAS or (v not in EXCEPCIONES and v.startswith(PREFIJOS)):
            return True
    return False


def revisar_lista(texto: str) -> str | None:
    """Motivo de rechazo según la lista local, o None. Sin red: corre siempre, también sin clave de API."""
    if LINK.search(texto) or ARROBA.search(texto):
        return "publicidad"
    ws = palabras(texto)
    if any(_bloqueada(w) for w in ws):
        return "insulto"
    # Todo junto sin espacios ("hijodeputa", "lpmqtp"): solo raíces largas, para no cazar "computadora"
    junto = "".join(ws)
    if any(p in junto for p in ("hijodeput", "pelotud", "conchadetumadre", "laputaque", "motherfuck", "fuckyou")):
        return "insulto"
    return None


class Moderador:
    """Lista local + modelo. revisar() devuelve None si el texto puede ir a la cadena, o el motivo del rechazo."""

    def __init__(self, cliente=None, modelo: str = MODELO):
        self.cliente = cliente          # anthropic.Anthropic o None (solo lista local)
        self.modelo = modelo
        self._cache: OrderedDict[str, str | None] = OrderedDict()
        self._cerrojo = threading.Lock()

    def revisar(self, texto: str) -> str | None:
        motivo = revisar_lista(texto)
        if motivo or self.cliente is None:
            return motivo
        clave = normalizar(texto).strip()
        with self._cerrojo:
            if clave in self._cache:
                self._cache.move_to_end(clave)
                return self._cache[clave]
        motivo = self._modelo(texto)
        if motivo != "sin_revision":            # un fallo de la API no se recuerda: se reintenta la próxima
            with self._cerrojo:
                self._cache[clave] = motivo
                while len(self._cache) > MAX_CACHE:
                    self._cache.popitem(last=False)
        return motivo

    def _modelo(self, texto: str) -> str | None:
        try:
            r = self.cliente.messages.create(
                model=self.modelo, max_tokens=60, system=SISTEMA, tools=[HERRAMIENTA],
                tool_choice={"type": "tool", "name": "veredicto"},
                messages=[{"role": "user", "content": f"Texto a revisar (entre comillas angulares):\n«{texto}»"}],
                timeout=8.0)
        except Exception as e:  # noqa: BLE001 — sin revisión no va a la cadena; nunca el mensaje (puede traer datos)
            print(f"moderacion: fallo del modelo ({type(e).__name__})", flush=True)
            return "sin_revision"
        for b in r.content:
            if getattr(b, "type", None) == "tool_use" and isinstance(b.input, dict):
                if b.input.get("ok") is True:
                    return None
                m = b.input.get("motivo")
                return m if isinstance(m, str) and m != "ok" else "otro"
        return "sin_revision"
