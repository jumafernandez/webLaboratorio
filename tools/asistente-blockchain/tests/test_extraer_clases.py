"""ingesta/extraer_clases.py: arma clases.md desde los claseN.json y se corta si aparece un alumno."""

import json
import pathlib
import subprocess
import sys

import pytest

RAIZ = pathlib.Path(__file__).resolve().parents[1]
SCRIPT = RAIZ / "ingesta" / "extraer_clases.py"


def clase(n, **extra):
    base = {"clase": n, "titulo": f"Tema {n}", "fecha": "2026-10-13", "docentes": ["David Petrocelli"],
            "resumen": "Infraestructura como código con Terraform (min 3-5).", "temas_teoricos": ["Estado remoto (min 10)"],
            "temas_practicos": ["terraform plan y apply"], "herramientas": ["Terraform"], "conceptos": ["tfstate"],
            "preguntas": [{"quien": "Ana Pérez", "texto": "¿Dónde vive el estado?", "fuente": "chat", "minuto": 3}],
            "participantes": ["Ana Pérez"]}
    base.update(extra)
    return base


@pytest.fixture
def carpeta(tmp_path):
    d = tmp_path / "clases"
    d.mkdir()
    return d, tmp_path / "conocimiento" / "clases.md"


def correr(d, salida, *args):
    return subprocess.run([sys.executable, "-I", str(SCRIPT), "--carpeta", "3", str(d), "--salida", str(salida), *args],
                          check=False, capture_output=True, text=True)


def test_solo_contenido_sin_preguntas_ni_minutos(carpeta):
    d, salida = carpeta
    (d / "clase2.json").write_text(json.dumps(clase(2)), encoding="utf-8")
    r = correr(d, salida)
    assert r.returncode == 0, r.stderr
    md = salida.read_text(encoding="utf-8")
    assert "## Curso 3 · Infraestructura y arquitectura · Clase 2: Tema 2" in md
    assert "docentes: David Petrocelli" in md and "Estado remoto" in md
    assert "(min" not in md and "Ana" not in md and "Dónde vive el estado" not in md


def test_se_corta_si_aparece_un_alumno(carpeta):
    d, salida = carpeta
    (d / "clase1.json").write_text(json.dumps(clase(1, resumen="Ana Pérez mostró su lab.")), encoding="utf-8")
    r = correr(d, salida)
    assert r.returncode != 0 and "nombres de alumnos" in r.stderr and not salida.exists()


def test_reemplazo_antes_del_control(carpeta):
    d, salida = carpeta
    (d / "clase1.json").write_text(json.dumps(clase(1, resumen="Como en el ejemplo de Ana Pérez.")), encoding="utf-8")
    r = correr(d, salida, "--reemplazo", "de Ana Pérez=de una alumna")
    assert r.returncode == 0, r.stderr
    assert "de una alumna" in salida.read_text(encoding="utf-8")
