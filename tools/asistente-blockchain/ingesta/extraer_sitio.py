"""Extrae el texto de las páginas públicas de blockchain-dev a conocimiento/sitio.md.

El agente lleva este archivo entero en la parte fija del prompt de sistema (con prompt caching), así responde sobre
toda la diplomatura sin índice de embeddings: el sitio de Blockchain entra holgado en el contexto. Se vuelve a correr
cuando cambia el sitio. Un solo comando, desde cualquier carpeta; sin argumento usa la raíz del sitio de esta copia de
trabajo (dos niveles arriba de tools/asistente-blockchain):

    python3 tools/asistente-blockchain/ingesta/extraer_sitio.py [ruta/al/sitio]

Incluye todas las páginas de blockchain-dev (portada, plan, docentes, en-vivo, verificar, proyectos, espera-2027,
notas del blog...) menos las de EXCLUIR. Falla si en el resultado aparece alguien de NO_DEBE_APARECER.
"""

import html
import pathlib
import re
import sys

RAIZ = pathlib.Path(__file__).resolve().parents[1]
SITIO = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else RAIZ.parents[1]
BASE = SITIO / "blockchain-dev"
SALIDA = RAIZ / "conocimiento" / "sitio.md"

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
    contenido = "\n\n".join(partes) + "\n"
    for nombre in NO_DEBE_APARECER:
        if nombre in contenido:
            lineas = [i + 1 for i, linea in enumerate(contenido.splitlines()) if nombre in linea]
            sys.exit(f"'{nombre}' aparece en el texto extraído (líneas {lineas[:5]}); corregir la página fuente.")
    SALIDA.parent.mkdir(parents=True, exist_ok=True)
    SALIDA.write_text(contenido, encoding="utf-8")
    print(f"{len(partes)} páginas, {SALIDA.stat().st_size // 1024} KB → {SALIDA.relative_to(RAIZ)}")


if __name__ == "__main__":
    main()
