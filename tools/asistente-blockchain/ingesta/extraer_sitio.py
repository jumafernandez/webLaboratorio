"""Extrae el texto de las páginas públicas de blockchain-dev a conocimiento/sitio.md.

El agente lleva este archivo entero en la parte fija del prompt de sistema (con prompt caching), así responde sobre
toda la diplomatura sin índice de embeddings: el sitio de Blockchain entra holgado en el contexto. Se vuelve a correr
cuando cambia el sitio:

    python3 ingesta/extraer_sitio.py [ruta/al/sitio]  (por defecto la raíz de webLaboratorio)
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
EXCLUIR = ("gracias-", "programas-hidden", "beca", "blog", "docentes/prados")
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
        if any(x in rel for x in EXCLUIR):
            continue
        titulo, cuerpo = texto(p)
        if "/docentes/" in f"/{rel}/":
            cuerpo = cuerpo[:TOPE_DOCENTE]
        partes.append(f"## {titulo}\nURL: /{rel}/\n\n{cuerpo}")
    SALIDA.parent.mkdir(parents=True, exist_ok=True)
    SALIDA.write_text("\n\n".join(partes) + "\n", encoding="utf-8")
    print(f"{len(partes)} páginas, {SALIDA.stat().st_size // 1024} KB → {SALIDA.relative_to(RAIZ)}")


if __name__ == "__main__":
    main()
