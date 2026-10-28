"""Extrae el texto de las páginas públicas de blockchain-dev a conocimiento/sitio.md.

El agente lleva este archivo entero en la parte fija del prompt de sistema (con prompt caching), así responde sobre
toda la diplomatura sin índice de embeddings: el sitio de Blockchain entra holgado en el contexto. Se vuelve a correr
cuando cambia el sitio. Un solo comando, desde cualquier carpeta; sin argumento usa la raíz del sitio de esta copia de
trabajo (dos niveles arriba de tools/asistente-blockchain):

    python3 tools/asistente-blockchain/ingesta/extraer_sitio.py [ruta/al/sitio]

Incluye todas las páginas de blockchain-dev (portada, plan, docentes, en-vivo, verificar, proyectos, espera-2027,
notas del blog...) menos las de EXCLUIR, más la próxima charla informativa (charla-proxima.json, que la página pinta con
JavaScript). Falla si en el resultado aparece alguien de NO_DEBE_APARECER.

También escribe conocimiento/fragmentos.json: el catálogo de fragmentos de clase (blockchain-dev/fragmentos/
fragmentos.json) con el texto de cada uno, sacado de sus subtítulos .vtt.
"""

import html
import json
import pathlib
import re
import sys

RAIZ = pathlib.Path(__file__).resolve().parents[1]
SITIO = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else RAIZ.parents[1]
BASE = SITIO / "blockchain-dev"
SALIDA = RAIZ / "conocimiento" / "sitio.md"
SALIDA_FRAGMENTOS = RAIZ / "conocimiento" / "fragmentos.json"
MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre",
         "diciembre"]

# Páginas que no aportan (agradecimientos, formulario de beca con código, borradores ocultos)
# Se compara contra los tramos de la ruta dentro de blockchain-dev ("gracias-" por prefijo, el resto exacto).
EXCLUIR_PREFIJOS = ("gracias-",)
EXCLUIR = ("programas-hidden", "beca", "prados")
# Nadie de esta lista forma parte del equipo: si aparece en el texto extraído, hay que corregir la página fuente.
NO_DEBE_APARECER = ("Prados",)
# Las páginas de docentes traen el CV completo: alcanza con el comienzo
TOPE_DOCENTE = 2500


def texto(ruta: pathlib.Path) -> tuple[str, str]:
    s = ruta.read_text(encoding="utf-8")
    titulo = re.search(r"<title>(.*?)</title>", s, re.S)
    s = re.sub(r"(?s)<(script|style|nav|footer|head|noscript|svg)\b.*?</\1>", "", s)
    s = re.sub(r"<(br|/p|/div|/li|/h\d|/tr)\b[^>]*>", "\n", s)
    s = html.unescape(re.sub(r"<[^>]+>", " ", s))
    s = re.sub(r"[ \t ]+", " ", s)
    s = re.sub(r"\n\s*\n+", "\n", s).strip()
    return (html.unescape(titulo.group(1)).strip() if titulo else ruta.parent.name), s


def charla() -> str:
    """La próxima charla informativa como texto, igual que la muestran la portada y el juego."""
    f = BASE / "charla-proxima.json"
    d = json.loads(f.read_text(encoding="utf-8")) if f.exists() else {}
    fecha = d.get("fecha") or ""
    if m := re.fullmatch(r"(\d{4})-(\d{2})-(\d{2})", fecha):
        cuando = f"{int(m[3])} de {MESES[int(m[2]) - 1]} de {m[1]}, {d.get('hora') or '19:00'} h (hora de Argentina)"
    elif m := re.fullmatch(r"(\d{4})-(\d{2})", fecha):
        cuando = f"{MESES[int(m[2]) - 1]} de {m[1]}; el día y la hora todavía no están confirmados"
    else:
        cuando = "fecha a confirmar"
    enlace = f" Inscripción a la charla: {d['enlace']}" if str(d.get("enlace") or "").startswith("https://") else ""
    return (f"## Próxima charla informativa\n\nPróxima charla informativa de la diplomatura (virtual, para la cohorte "
            f"2027): {cuando}. Quien está en la lista de espera recibe el aviso con la fecha.{enlace}")


def texto_vtt(ruta: pathlib.Path) -> str:
    """El texto hablado de un .vtt, sin numeración ni tiempos."""
    lineas = [
        linea.strip() for linea in ruta.read_text(encoding="utf-8").splitlines()
        if linea.strip() and "-->" not in linea and linea.strip() != "WEBVTT" and not linea.strip().isdigit()
    ]
    return re.sub(r"\s+", " ", " ".join(lineas)).strip()


def fragmentos() -> list[dict]:
    carpeta = BASE / "fragmentos"
    catalogo = json.loads((carpeta / "fragmentos.json").read_text(encoding="utf-8"))["fragmentos"]
    salida = []
    for f in catalogo:
        vtt = carpeta / f"{f['archivo']}.vtt"
        if not vtt.exists():
            sys.exit(f"Falta {vtt.relative_to(SITIO)} para el fragmento {f['id']}")
        salida.append({**f, "texto": texto_vtt(vtt)})
    return salida


def main() -> None:
    partes = []
    paginas = sorted(BASE.rglob("index.html"), key=lambda p: (len(p.parts), str(p)))
    for p in paginas:
        rel = p.relative_to(SITIO).parent.as_posix()
        tramos = p.relative_to(BASE).parent.parts
        if any(t in EXCLUIR or t.startswith(EXCLUIR_PREFIJOS) for t in tramos):
            continue
        titulo, cuerpo = texto(p)
        if "/docentes/" in f"/{rel}/":
            cuerpo = cuerpo[:TOPE_DOCENTE]
        partes.append(f"## {titulo}\nURL: /{rel}/\n\n{cuerpo}")
    partes.append(charla())
    contenido = "\n\n".join(partes) + "\n"
    for nombre in NO_DEBE_APARECER:
        if nombre in contenido:
            lineas = [i + 1 for i, linea in enumerate(contenido.splitlines()) if nombre in linea]
            sys.exit(f"'{nombre}' aparece en el texto extraído (líneas {lineas[:5]}); corregir la página fuente.")
    SALIDA.parent.mkdir(parents=True, exist_ok=True)
    SALIDA.write_text(contenido, encoding="utf-8")
    print(f"{len(partes) - 1} páginas + charla, {SALIDA.stat().st_size // 1024} KB → {SALIDA.relative_to(RAIZ)}")
    frags = fragmentos()
    SALIDA_FRAGMENTOS.write_text(json.dumps(frags, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"{len(frags)} fragmentos de clase → {SALIDA_FRAGMENTOS.relative_to(RAIZ)}")


if __name__ == "__main__":
    main()
