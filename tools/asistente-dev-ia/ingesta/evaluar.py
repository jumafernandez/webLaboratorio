"""Evaluación de la recuperación: para cada pregunta de prueba, si las secciones esperadas quedan entre las K que
recibe el modelo, con la lógica del backend importada de backend/recuperacion.py (casi duplicados y cupos por parte
en preguntas compuestas).

Uso: .venv/bin/python ingesta/evaluar.py [carpeta]   (indice, por defecto; indice-licdia usa ingesta/licdia/pruebas.json)
"""

import json
import pathlib
import sys

import numpy as np
from sentence_transformers import SentenceTransformer

RAIZ = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RAIZ))
from backend.recuperacion import K, consultas_de, recuperar  # noqa: E402  (la misma lógica que el backend)

# (pregunta, requisitos): cada requisito es una lista de alternativas de título; tienen que cumplirse todos
PRUEBAS = [
    ("¿Cuánto cuesta?", [["Estructura de aranceles"]]),
    ("¿Necesito saber programar?", [["conocimientos previos", "Sirve si no vengo", "pre-requisitos"]]),
    ("¿Qué voy a construir?", [["Lo que vas a construir"]]),
    ("¿Cuándo empieza la próxima cohorte?", [["Cuándo empieza", "Cohorte 2027"]]),
    ("¿Quiénes son los docentes?", [["Quiénes son los docentes", "Cuerpo docente"]]),
    ("¿Qué título otorga?", [["Qué título otorga"]]),
    ("¿El título tiene validez nacional?", [["validez nacional"]]),
    ("¿Cuántas horas por semana hay que dedicarle?", [["carga horaria", "pre-requisitos"]]),
    ("¿Necesito una GPU?", [["computadora especial"]]),
    ("¿Cómo se paga?", [["Cómo pagar", "formas de pago"]]),
    ("¿Puedo cursar un módulo suelto?", [["módulos sueltos"]]),
    ("¿Hay un trabajo final?", [["trabajo final"]]),
    ("¿Cómo es la evaluación?", [["evaluación", "Evaluación"]]),
    ("¿Hay examen de ingreso?", [["examen de admisión"]]),
    ("¿Qué se ve en el módulo de IA generativa?", [["4 Inteligencia Artificial Generativa"]]),
    ("¿Qué herramientas y tecnologías usan?", [["Stack tecnologico"]]),
    ("¿Qué salida laboral tiene?", [["salida laboral", "Para qué te prepara"]]),
    ("¿Las clases quedan grabadas?", [["100% virtual"]]),
    ("¿Qué clases hay en octubre?", [["Cronograma clase por clase"]]),
    ("¿Qué requisitos de admisión piden?", [["Requisitos de admisión", "pre-requisitos"]]),
    ("¿Cuánto cuesta la diplomatura y cómo se paga?", [["Estructura de aranceles"], ["Cómo pagar", "formas de pago"]]),
    ("¿Cuál es el precio de la diplomatura?", [["Estructura de aranceles"]]),
    ("¿Cuánto sale?", [["Estructura de aranceles"]]),
    ("¿Me puedo inscribir ahora y cuándo empieza la próxima cohorte?", [["Cómo me inscribo", "Inscripción", "Cohorte 2027"], ["Cuándo empieza", "Cohorte 2027"]]),
    ("¿Qué título otorga y tiene validez nacional?", [["Qué título otorga"], ["validez nacional"]]),
    ("¿Qué voy a aprender y quiénes dan las clases?", [["Plan de estudios", "Lo que vas a construir", "Enfoque"], ["docentes", "Cuerpo docente"]]),
    ("¿Qué días y en qué horario son las clases?", [["Dias y Horarios", "100% virtual"]]),
    ("¿Cuánto dura la diplomatura?", [["Duración", "carga horaria"]]),
]


def main():
    indice = RAIZ / (sys.argv[1] if len(sys.argv) > 1 else "indice")
    pruebas = PRUEBAS
    if indice.name == "indice-licdia":
        pruebas = json.loads((RAIZ / "ingesta" / "licdia" / "pruebas.json").read_text(encoding="utf-8"))["pruebas"]
    S = json.loads((indice / "secciones.json").read_text(encoding="utf-8"))["secciones"]
    E = np.load(indice / "embeddings.npy")
    conf = json.loads((indice / "modelo.json").read_text(encoding="utf-8"))
    m = SentenceTransformer(conf["modelo"], device="cpu")

    def top_de(q):
        cs = consultas_de(q)
        return recuperar(E, m.encode([conf["prefijo_consulta"] + c for c in cs], normalize_embeddings=True))[0]

    fallos = []
    for q, reqs in pruebas:
        titulos = [S[i]["titulo"] for i in top_de(q)]
        if not all(any(any(a in t for a in alt) for t in titulos) for alt in reqs):
            fallos.append((q, [t[:34] for t in titulos]))
    print(f"{len(pruebas) - len(fallos)}/{len(pruebas)} preguntas con todas sus secciones entre las {K} recuperadas")
    for f in fallos:
        print("  falla:", f)
    sys.exit(1 if fallos else 0)   # despliegue/reindexar.sh no publica un índice que no pasa todas las pruebas


if __name__ == "__main__":
    main()
