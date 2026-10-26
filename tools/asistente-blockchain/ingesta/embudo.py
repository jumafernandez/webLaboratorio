"""Embudo de conversión del asistente-juego, con los eventos anónimos que guarda backend/medicion.py.

Lee la tabla `medicion` de la base SQLite del registro (STATE_DIRECTORY o ../datos/asistente.sqlite3), imprime el
resumen y escribe ingesta/embudo.md:

- embudo por sesión: visitas (sesiones con el evento `visita`, que el widget manda una vez por sesión al cargar,
  arranque en el juego o en el sitio convencional; las sesiones sin `visita` quedan fuera del denominador y se cuentan
  aparte) → entraron al juego → empezaron un nivel → completaron al menos uno → completaron los
  cuatro cursos → clic en la lista de espera (cantidades y % sobre las visitas). Cada paso cuenta las sesiones que lo
  hicieron, sin exigir el paso anterior (alguien puede ir a la lista de espera sin jugar).
- por nivel: inicios, finales, abandonos y el paso donde más se abandona.
- desde dónde se entra al juego (chip, texto, mapa), preguntas al agente por sesión y % de sesiones que pasaron al
  sitio convencional.

Solo biblioteca estándar: backend/medicion.py usa calcular() para el panel de desarrollo.

    uv run python ingesta/embudo.py [--dias 30] [--base ruta.sqlite3] [--salida ingesta/embudo.md]
"""

import argparse
import collections
import datetime
import json
import os
import pathlib
import sqlite3

RAIZ = pathlib.Path(__file__).resolve().parents[1]
CURSOS = ("c1", "c2", "c3", "c4")
NIVELES = CURSOS + ("nft", "hack")
PASOS = (
    ("visitas", "Visitas"),
    ("juego", "Entraron al juego"),
    ("empezaron", "Empezaron un nivel"),
    ("completaron_1", "Completaron al menos un nivel"),
    ("completaron_4", "Completaron los cuatro cursos"),
    ("lista_espera", "Clic en la lista de espera"),
)


def ruta_base() -> pathlib.Path:
    """Misma ubicación que backend/registro.py."""
    return pathlib.Path(os.environ.get("STATE_DIRECTORY") or RAIZ / "datos") / "asistente.sqlite3"


def pct(n: int, total: int) -> float:
    return round(100 * n / total, 1) if total else 0.0


def calcular(db: sqlite3.Connection, dias: int = 30, hasta: str | None = None) -> dict:
    """Números del embudo para los últimos `dias` días (incluido `hasta`, por defecto hoy)."""
    hasta = hasta or datetime.date.today().isoformat()
    desde = (datetime.date.fromisoformat(hasta) - datetime.timedelta(days=max(1, dias) - 1)).isoformat()
    try:
        filas = db.execute("SELECT sesion, evento, datos FROM medicion WHERE dia BETWEEN ? AND ? ORDER BY id",
                           (desde, hasta)).fetchall()
    except sqlite3.OperationalError:            # la tabla todavía no existe: nadie midió nada
        filas = []

    eventos: dict[str, list[tuple[str, dict]]] = collections.defaultdict(list)
    for sesion, evento, datos in filas:
        try:
            d = json.loads(datos) if datos else {}
        except ValueError:
            d = {}
        eventos[sesion].append((evento, d if isinstance(d, dict) else {}))

    pasos = dict.fromkeys(k for k, _ in PASOS)
    conteo = collections.Counter()
    fuentes = collections.Counter()
    niveles = {n: {"inicios": 0, "finales": 0, "abandonos": 0, "pasos": collections.Counter()} for n in NIVELES}
    vistas = collections.Counter()
    preguntas_total = sesiones_con_preguntas = sin_visita = 0
    for lista in eventos.values():
        tipos = {e for e, _ in lista}
        if "visita" not in tipos:
            sin_visita += 1
            continue
        vistas[next((str(d.get("vista") or "juego") for e, d in lista if e == "visita"))] += 1
        fin = {str(d.get("nivel")) for e, d in lista if e == "nivel_fin"}
        conteo["visitas"] += 1
        conteo["juego"] += "entro_juego" in tipos
        conteo["empezaron"] += "nivel_inicio" in tipos
        conteo["completaron_1"] += bool(fin)
        conteo["completaron_4"] += set(CURSOS) <= fin or "certificado" in tipos
        conteo["lista_espera"] += "lista_espera_click" in tipos
        conteo["sitio_convencional"] += "sitio_convencional" in tipos
        n_preguntas = sum(e == "pregunta_agente" for e, _ in lista)
        preguntas_total += n_preguntas
        sesiones_con_preguntas += n_preguntas > 0
        for e, d in lista:
            nivel = str(d.get("nivel", ""))
            if e == "entro_juego":
                fuentes[str(d.get("fuente") or "desconocida")] += 1
            elif e in ("nivel_inicio", "nivel_fin", "nivel_abandono") and nivel in niveles:
                fila = niveles[nivel]                 # un nivel desconocido no inventa filas
                if e == "nivel_inicio":
                    fila["inicios"] += 1
                elif e == "nivel_fin":
                    fila["finales"] += 1
                else:
                    fila["abandonos"] += 1
                    fila["pasos"][str(d.get("paso", "?"))] += 1

    visitas = conteo["visitas"]
    for clave, _ in PASOS:
        pasos[clave] = {"n": conteo[clave], "pct": pct(conteo[clave], visitas)}
    por_nivel = {}
    for nivel, f in niveles.items():
        comun = f["pasos"].most_common(1)
        por_nivel[nivel] = {"inicios": f["inicios"], "finales": f["finales"], "abandonos": f["abandonos"],
                            "pct_completan": pct(f["finales"], f["inicios"]),
                            "paso_abandono": comun[0][0] if comun else None,
                            "abandonos_en_ese_paso": comun[0][1] if comun else 0}
    return {
        "desde": desde, "hasta": hasta, "dias": max(1, dias), "eventos": len(filas),
        "embudo": pasos,
        "sesiones_sin_visita": sin_visita,
        "vistas": dict(vistas.most_common()),
        "niveles": por_nivel,
        "fuentes": dict(fuentes.most_common()),
        "agente": {"preguntas": preguntas_total, "sesiones_con_preguntas": sesiones_con_preguntas,
                   "por_sesion": round(preguntas_total / visitas, 2) if visitas else 0.0,
                   "por_sesion_que_pregunto": round(preguntas_total / sesiones_con_preguntas, 2)
                   if sesiones_con_preguntas else 0.0},
        "sitio_convencional": {"n": conteo["sitio_convencional"], "pct": pct(conteo["sitio_convencional"], visitas)},
    }


def markdown(r: dict) -> str:
    """El informe en Markdown (lo mismo que se imprime)."""
    lineas = [f"# Embudo del asistente-juego ({r['desde']} a {r['hasta']}, {r['dias']} días)", "",
              f"{r['eventos']} eventos, {r['embudo']['visitas']['n']} sesiones con visita "
              f"(arrancaron en: {', '.join(f'{k} {n}' for k, n in r['vistas'].items()) or '—'}); "
              f"{r['sesiones_sin_visita']} sesiones sin el evento visita quedan fuera.", "",
              "## Embudo", "", "| Paso | Sesiones | % de las visitas |", "|---|---:|---:|"]
    for clave, nombre in PASOS:
        p = r["embudo"][clave]
        lineas.append(f"| {nombre} | {p['n']} | {p['pct']:.1f} % |")
    lineas += ["", "## Por nivel", "", "| Nivel | Inicios | Finales | % completan | Abandonos | Paso con más abandonos |",
               "|---|---:|---:|---:|---:|---|"]
    for nivel, f in r["niveles"].items():
        paso = f"{f['paso_abandono']} ({f['abandonos_en_ese_paso']})" if f["paso_abandono"] is not None else "—"
        lineas.append(f"| {nivel} | {f['inicios']} | {f['finales']} | {f['pct_completan']:.1f} % | {f['abandonos']} "
                      f"| {paso} |")
    lineas += ["", "## Entrada al juego", ""]
    if r["fuentes"]:
        lineas += [f"- {fuente}: {n}" for fuente, n in r["fuentes"].items()]
    else:
        lineas.append("- (sin datos)")
    a, s = r["agente"], r["sitio_convencional"]
    lineas += ["", "## Agente y sitio convencional", "",
               (f"- Preguntas al agente: {a['preguntas']} ({a['por_sesion']:.2f} por sesión; "
                f"{a['por_sesion_que_pregunto']:.2f} entre las {a['sesiones_con_preguntas']} sesiones que preguntaron)"),
               f"- Pasaron al sitio convencional: {s['n']} sesiones ({s['pct']:.1f} %)", ""]
    return "\n".join(lineas)


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--dias", type=int, default=30, help="días hacia atrás, incluido hoy (30)")
    ap.add_argument("--base", type=pathlib.Path, default=None, help="base SQLite (la del registro)")
    ap.add_argument("--salida", type=pathlib.Path, default=RAIZ / "ingesta" / "embudo.md")
    args = ap.parse_args()
    base = args.base or ruta_base()
    if not base.exists():
        raise SystemExit(f"No existe la base {base}: todavía no se midió nada.")
    db = sqlite3.connect(f"file:{base}?mode=ro", uri=True)
    texto = markdown(calcular(db, args.dias))
    print(texto)
    args.salida.write_text(texto, encoding="utf-8")
    print(f"→ {args.salida}")


if __name__ == "__main__":
    main()
