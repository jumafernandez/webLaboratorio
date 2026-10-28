"""Arma conocimiento/clases.md: qué se dio en cada clase de la diplomatura, para que el agente lo sepa.

Fuentes (privadas, fuera de este repo público), las mismas que deja /temas-por-clase:
- la planilla "Temas por clase" de un curso (hoja "Temas por clase", una fila por clase);
- la carpeta clases/ de un curso, con un claseN.json por clase.

Del material solo entra el contenido: resumen, temas teóricos y prácticos, herramientas y conceptos. Nunca entran
participantes, preguntas de alumnos, chats ni transcripciones. Antes de escribir, busca en el resultado cada nombre de
alumno (roster.txt, participantes y autores de preguntas de las fuentes) y se corta si encuentra alguno.

clases.md no se versiona (.gitignore): se genera en la notebook y se sube al servicio con el resto de conocimiento/.

    uv run --with openpyxl python -I ingesta/extraer_clases.py \\
        --planilla 1 ".../Temas_por_clase_Blockchain.xlsx" \\
        --carpeta 2 ".../temas-por-clase-defi/clases" \\
        --carpeta 3 ".../_temas-por-clase-bc/clases" \\
        --roster ".../_temas-por-clase-bc/roster.txt" \\
        --reemplazo "(Pablo y Laura en el dibujo)=(dos personas en el dibujo)"
"""

import argparse
import json
import pathlib
import re
import sys

RAIZ = pathlib.Path(__file__).resolve().parents[1]
SALIDA = RAIZ / "conocimiento" / "clases.md"

CURSOS = {
    1: "Curso 1 · Fundamentos de Blockchain",
    2: "Curso 2 · Finanzas descentralizadas",
    3: "Curso 3 · Infraestructura y arquitectura",
    4: "Curso 4 · Desarrollo de DApps",
}
# Nombres que pueden aparecer: el equipo docente
DOCENTES = ("David", "Petrocelli", "Juan", "Manuel", "Fernández", "Ciro", "Edgardo", "Romero", "Julián", "Olivares",
            "Deiller", "Guevara", "Mauricio", "Marcelo")
# Marcas de minuto y de fuente que no le sirven al agente: "(min 3-5)", "(min 13-24 y 50-58)", "(video)", "(chat)"
MARCAS = re.compile(r"\s*\((?:min(?:uto)?s?\.? [^)]*|video|chat|video y chat|chat y video)\)", re.IGNORECASE)


def limpiar(t: str) -> str:
    return re.sub(r"[ \t]+", " ", MARCAS.sub("", t or "")).strip()


def lista(v) -> list[str]:
    """Una lista de la planilla viene como texto con viñetas; la del JSON, como lista."""
    if isinstance(v, list):
        items = v
    else:
        items = re.split(r"\n\s*[•\-]\s*|^\s*[•\-]\s*", str(v or ""))
    return [limpiar(i) for i in items if limpiar(i)]


def desde_planilla(curso: int, ruta: pathlib.Path) -> tuple[list[dict], set[str]]:
    import openpyxl

    hoja = openpyxl.load_workbook(ruta, read_only=True, data_only=True)["Temas por clase"]
    filas = list(hoja.iter_rows(values_only=True))
    cab = next(i for i, f in enumerate(filas) if f and str(f[0]).strip() == "Clase")
    col = {str(c).split("\n")[0].strip(): i for i, c in enumerate(filas[cab]) if c}
    clases, nombres = [], set()
    for f in filas[cab + 1:]:
        if not f or not f[0] or not str(f[0]).startswith("Clase"):
            continue
        cabeza = str(f[0]).split("\n")
        n = int(re.search(r"\d+", cabeza[0])[0])
        fecha = str(f[col["Fecha de clase"]] or "").split("\n")[0].strip()
        for nombre in re.split(r"[,;\n]", str(f[col["Participantes"]] or "")):
            if nombre.strip():
                nombres.add(nombre.strip())
        for m in re.finditer(r"^\s*•\s*([^:]{2,40}):", str(f[col["Preguntas / participación"]] or ""), re.MULTILINE):
            nombres.add(m[1].strip())
        clases.append({
            "curso": curso, "clase": n, "titulo": cabeza[1].strip() if len(cabeza) > 1 else "", "fecha": fecha,
            "docentes": [], "resumen": limpiar(f[col["Resumen"]]), "teoria": lista(f[col["Temas teóricos"]]),
            "practica": lista(f[col["Temas prácticos / demos"]]),
            "herramientas": limpiar(f[col["Herramientas / tecnologías"]]),
            "conceptos": limpiar(f[col["Conceptos clave"]]),
        })
    return clases, nombres


def desde_carpeta(curso: int, carpeta: pathlib.Path) -> tuple[list[dict], set[str]]:
    clases, nombres = [], set()
    for ruta in sorted(carpeta.glob("clase*.json"), key=lambda p: int(re.search(r"\d+", p.stem)[0])):
        d = json.loads(ruta.read_text(encoding="utf-8"))
        for p in d.get("preguntas") or []:
            if isinstance(p, dict) and p.get("quien"):
                nombres.add(p["quien"])
        for p in d.get("participantes") or []:
            nombres.add(p if isinstance(p, str) else str(p.get("nombre", "")))
        herr = d.get("herramientas") or []
        conc = d.get("conceptos") or []
        clases.append({
            "curso": curso, "clase": int(d["clase"]), "titulo": d.get("titulo", ""), "fecha": d.get("fecha", ""),
            "docentes": d.get("docentes") or [], "resumen": limpiar(d.get("resumen", "")),
            "teoria": lista(d.get("temas_teoricos")), "practica": lista(d.get("temas_practicos")),
            "herramientas": limpiar(", ".join(herr) if isinstance(herr, list) else herr),
            "conceptos": limpiar(", ".join(conc) if isinstance(conc, list) else conc),
        })
    return clases, nombres


def leer_roster(ruta: pathlib.Path) -> set[str]:
    return {
        linea.strip() for linea in ruta.read_text(encoding="utf-8").splitlines()
        if linea.strip() and not linea.lstrip().startswith("#")
    }


def tramos_prohibidos(nombres: set[str]) -> set[str]:
    """Cada nombre y cada parte de él (de 4 letras o más) que no sea de un docente."""
    salida = set()
    for n in nombres:
        n = n.strip()
        if not any(ch.isalpha() for ch in n) or n.lower().startswith(("alumno", "alumna", "estudiante", "sin identificar")):
            continue
        salida.add(n)
        salida.update(t for t in re.split(r"[\s,.]+", n) if len(t) >= 4 and t.isalpha() and t[0].isupper())
    return {t for t in salida if t not in DOCENTES and not any(t == d for d in DOCENTES)}


def markdown(clases: list[dict]) -> str:
    partes = []
    for c in sorted(clases, key=lambda c: (c["curso"], c["clase"])):
        cab = f"## {CURSOS.get(c['curso'], f'Curso {c['curso']}')} · Clase {c['clase']}"
        if c["titulo"]:
            cab += f": {c['titulo']}"
        lineas = [cab]
        meta = [f"fecha {c['fecha']}"] if c["fecha"] else []
        if c["docentes"]:
            meta.append("docentes: " + ", ".join(c["docentes"]))
        if meta:
            lineas.append("(" + "; ".join(meta) + ")")
        if c["resumen"]:
            lineas.append(f"Resumen: {c['resumen']}")
        if c["teoria"]:
            lineas.append("Teoría:\n" + "\n".join(f"- {t}" for t in c["teoria"]))
        if c["practica"]:
            lineas.append("Práctica:\n" + "\n".join(f"- {t}" for t in c["practica"]))
        if c["herramientas"]:
            lineas.append(f"Herramientas: {c['herramientas']}")
        if c["conceptos"]:
            lineas.append(f"Conceptos: {c['conceptos']}")
        partes.append("\n".join(lineas))
    return "\n\n".join(partes) + "\n"


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--planilla", nargs=2, action="append", default=[], metavar=("CURSO", "XLSX"))
    ap.add_argument("--carpeta", nargs=2, action="append", default=[], metavar=("CURSO", "DIR"))
    ap.add_argument("--roster", action="append", default=[], type=pathlib.Path)
    ap.add_argument("--salida", type=pathlib.Path, default=SALIDA)
    ap.add_argument("--reemplazo", action="append", default=[], metavar="TEXTO=NUEVO",
                    help="cambia un texto de la fuente antes del control de nombres (p. ej. un ejemplo con nombres)")
    a = ap.parse_args()
    clases, nombres = [], set()
    for curso, ruta in a.planilla:
        c, n = desde_planilla(int(curso), pathlib.Path(ruta).expanduser())
        clases += c
        nombres |= n
    for curso, ruta in a.carpeta:
        c, n = desde_carpeta(int(curso), pathlib.Path(ruta).expanduser())
        clases += c
        nombres |= n
    for r in a.roster:
        nombres |= leer_roster(r.expanduser())
    if not clases:
        sys.exit("No hay clases: pasá al menos una --planilla o --carpeta.")
    texto = markdown(clases)
    for r in a.reemplazo:
        viejo, _, nuevo = r.partition("=")
        if viejo not in texto:
            sys.exit(f"--reemplazo: no encontré «{viejo}» en el resultado")
        texto = texto.replace(viejo, nuevo)
    hallados = sorted(t for t in tramos_prohibidos(nombres) if re.search(rf"(?<!\w){re.escape(t)}(?!\w)", texto))
    if hallados:
        for t in hallados:
            for i, linea in enumerate(texto.splitlines(), 1):
                if re.search(rf"(?<!\w){re.escape(t)}(?!\w)", linea):
                    print(f"  línea {i}: «{t}» en: {linea[:160]}", file=sys.stderr)
                    break
        sys.exit(f"Aparecen {len(hallados)} nombres de alumnos en el resultado: corregir la fuente; no se escribió nada.")
    a.salida.parent.mkdir(parents=True, exist_ok=True)
    a.salida.write_text(texto, encoding="utf-8")
    por_curso = {}
    for c in clases:
        por_curso[c["curso"]] = por_curso.get(c["curso"], 0) + 1
    print(f"{len(clases)} clases ({', '.join(f'curso {k}: {v}' for k, v in sorted(por_curso.items()))}), "
          f"{a.salida.stat().st_size // 1024} KB → {a.salida}")


if __name__ == "__main__":
    main()
