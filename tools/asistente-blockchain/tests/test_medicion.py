"""Medición anónima: eventos admitidos y rechazados, validación de datos, sin IP, purga, embudo y panel de desarrollo."""

import datetime
import json
import sqlite3

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend import medicion
from ingesta import embudo

SESION = "a1b2c3d4e5f60718"


@pytest.fixture
def entorno(tmp_path, monkeypatch):
    monkeypatch.setenv("STATE_DIRECTORY", str(tmp_path))
    monkeypatch.delenv("MEDICION", raising=False)

    def armar(dev: bool = False, activa: bool | None = True):
        m = medicion.Medicion(activa=activa)
        app = FastAPI()
        app.include_router(medicion.crear_router(m, dev=dev))
        return TestClient(app, client=("203.0.113.9", 5000)), m

    return armar


def filas(m):
    return m.db.execute("SELECT sesion, evento, datos FROM medicion ORDER BY id").fetchall()


def test_eventos_admitidos(entorno):
    c, m = entorno()
    assert c.post("/blockchain-dev/api/m", json={"sesion": SESION, "evento": "visita"}).status_code == 204
    r = c.post("/blockchain-dev/api/m", json={"sesion": SESION.upper(), "evento": "nivel_abandono",
                                              "datos": {"nivel": "c2", "paso": "pool"}})
    assert r.status_code == 204
    r = c.post("/blockchain-dev/api/m", content=json.dumps({"sesion": SESION, "evento": "tx_real",
                                                            "datos": {"accion": "sellar", "ok": True}}),
               headers={"content-type": "text/plain"})            # sendBeacon con un string
    assert r.status_code == 204
    assert filas(m) == [(SESION, "visita", "{}"), (SESION, "nivel_abandono", '{"nivel": "c2", "paso": "pool"}'),
                        (SESION, "tx_real", '{"accion": "sellar", "ok": true}')]
    dia, momento = m.db.execute("SELECT dia, momento FROM medicion LIMIT 1").fetchone()
    assert dia == datetime.date.today().isoformat() and len(momento) == 5 and momento[2] == ":"


@pytest.mark.parametrize("cuerpo", [
    {"sesion": SESION, "evento": "inventado"},
    {"sesion": "corta", "evento": "visita"},
    {"sesion": "z" * 16, "evento": "visita"},
    {"sesion": "a" * 33, "evento": "visita"},
    {"sesion": SESION, "evento": "visita", "extra": 1},
    {"sesion": SESION, "evento": "visita", "datos": {"nivel": "c1"}},                # clave no prevista
    {"sesion": SESION, "evento": "nivel_paso", "datos": {"nivel": "c1" * 31}},       # más de 60 caracteres
    {"sesion": SESION, "evento": "nivel_paso", "datos": {"nivel": {"x": 1}}},        # no plano
    {"sesion": SESION, "evento": "nivel_paso", "datos": {"nivel": ["c1"]}},
    {"sesion": SESION, "evento": "tema_sitio", "datos": {"tema": "mi mail es a@b.com, llamame!"}},
    # texto libre sin signos: tampoco (solo identificadores fijos por clave)
    {"sesion": SESION, "evento": "tema_sitio", "datos": {"tema": "Juan Perez DNI 30123456 tel 1155554444 Lujan"}},
    {"sesion": SESION, "evento": "ir_seccion", "datos": {"ancla": "maria.gomez gmail.com quiero que me llamen"}},
    {"sesion": SESION, "evento": "pregunta_agente", "datos": {"acciones": "cuanto sale la diplo para abogadas"}},
    {"sesion": SESION, "evento": "pregunta_agente", "datos": {"acciones": "sugerir sugerir"}},
    {"sesion": SESION, "evento": "nivel_inicio", "datos": {"nivel": "Juan Perez"}},
    {"sesion": SESION, "evento": "nivel_paso", "datos": {"nivel": "c1", "paso": 3}},
    {"sesion": SESION, "evento": "wallet_creada", "datos": {"real": "si"}},
    {"sesion": SESION, "evento": "visita", "datos": {"vista": "otra"}},
    {"sesion": SESION, "evento": "compartir", "datos": {"red": "facebook", "id": "c1"}},
    {"sesion": SESION, "evento": "nivel_paso", "datos": "c1"},
    ["no", "es", "objeto"],
])
def test_eventos_rechazados(entorno, cuerpo):
    c, m = entorno()
    r = c.post("/blockchain-dev/api/m", json=cuerpo)
    assert r.status_code == 400 and r.json() == {"error": "evento_invalido"}
    assert filas(m) == []


def test_cuerpo_invalido_o_grande(entorno):
    c, m = entorno()
    assert c.post("/blockchain-dev/api/m", content=b"{no es json").status_code == 400
    assert c.post("/blockchain-dev/api/m", content=b"\xff\xfe").status_code == 400
    assert c.post("/blockchain-dev/api/m", content=b"x" * 5000).status_code == 413
    assert filas(m) == []


def test_mas_de_seis_claves():
    with pytest.raises(medicion.DatosInvalidos):
        medicion.validar({"sesion": SESION, "evento": "nivel_paso", "datos": {str(i): 1 for i in range(7)}})


def test_no_guarda_ip(entorno, tmp_path):
    c, m = entorno()
    c.post("/blockchain-dev/api/m", json={"sesion": SESION, "evento": "visita"},
           headers={"x-real-ip": "198.51.100.77"})
    volcado = "\n".join(m.db.iterdump())
    assert "198.51.100.77" not in volcado and "203.0.113.9" not in volcado
    assert (tmp_path / "asistente.sqlite3").exists()


def test_tope_por_origen(entorno, monkeypatch):
    monkeypatch.setattr(medicion, "EVENTOS_POR_DIA", 3)
    c, m = entorno()
    for _ in range(5):
        assert c.post("/blockchain-dev/api/m", json={"sesion": SESION, "evento": "visita"}).status_code == 204
    assert len(filas(m)) == 3
    # un X-Real-IP del cliente no abre otro cupo: solo vale detrás de un proxy de confianza
    monkeypatch.delenv("PROXIES_CONFIABLES", raising=False)
    monkeypatch.setattr("backend.origen.RAIZ", __import__("pathlib").Path("/nonexistent"))
    c.post("/blockchain-dev/api/m", json={"sesion": SESION, "evento": "visita"}, headers={"x-real-ip": "10.0.0.2"})
    assert len(filas(m)) == 3
    monkeypatch.setenv("PROXIES_CONFIABLES", "203.0.113.9")
    c.post("/blockchain-dev/api/m", json={"sesion": SESION, "evento": "visita"}, headers={"x-real-ip": "10.0.0.2"})
    assert len(filas(m)) == 4


def test_valores_admitidos(entorno):
    c, m = entorno()
    for evento, datos in [("visita", {"vista": "sitio"}), ("ir_seccion", {"ancla": "#team"}),
                          ("pregunta_agente", {"acciones": "mostrar_sitio sugerir"}), ("insignia", {"id": "cert"}),
                          ("nivel_paso", {"nivel": "c4", "paso": "revert"}), ("ver_por_dentro", {"tab": "agente"}),
                          ("lista_espera_click", {"origen": "certificado"}), ("wallet_creada", {"real": True}),
                          ("compartir", {"red": "linkedin", "id": "cert"}), ("perfil", {"perfil": "finanzas"}),
                          ("lista_espera_enviada", {"origen": "programa"}), ("fragmento", {"curso": "c2"})]:
        assert c.post("/blockchain-dev/api/m", json={"sesion": SESION, "evento": evento,
                                                     "datos": datos}).status_code == 204, (evento, datos)
    assert len(filas(m)) == 12


def test_pasos_del_widget_admitidos():
    """Cada ctx.paso() de los niveles está en la lista blanca (si se agrega uno, hay que sumarlo a PASOS)."""
    import pathlib
    import re
    raiz = pathlib.Path(__file__).resolve().parents[1] / "widget" / "niveles"
    pasos = {p for f in raiz.glob("*.js") for p in re.findall(r'ctx\.paso\("([a-z0-9_]+)"\)', f.read_text())}
    assert pasos and pasos <= medicion.PASOS, pasos - medicion.PASOS


def test_apagada(entorno):
    c, m = entorno(activa=False)
    assert c.post("/blockchain-dev/api/m", json={"sesion": SESION, "evento": "visita"}).status_code == 204
    assert filas(m) == [] and m.activa is False


def test_apagada_por_entorno(entorno, monkeypatch):
    monkeypatch.setenv("MEDICION", "0")
    _, m = entorno(activa=None)
    assert m.activa is False


def test_purga(entorno):
    _, m = entorno()
    hoy = datetime.date.today()
    viejo = (hoy - datetime.timedelta(days=medicion.DIAS_RETENCION + 1)).isoformat()
    limite = (hoy - datetime.timedelta(days=medicion.DIAS_RETENCION)).isoformat()
    for dia in (viejo, limite, hoy.isoformat()):
        m.db.execute("INSERT INTO medicion (dia, momento, sesion, evento, datos) VALUES (?, '10:00', ?, 'visita', '{}')",
                     (dia, SESION))
    m.db.execute("INSERT INTO medicion_sal VALUES (?, 'x')", (viejo,))
    m.purgar(hoy.isoformat())
    # al arrancar también se purga, aunque no lleguen eventos (y aunque la medición esté apagada)
    m.db.execute("INSERT INTO medicion (dia, momento, sesion, evento, datos) VALUES (?, '10:00', ?, 'visita', '{}')",
                 (viejo, SESION))
    medicion.Medicion(m.db, activa=False)
    assert [d for (d,) in m.db.execute("SELECT dia FROM medicion ORDER BY dia")] == [limite, hoy.isoformat()]
    assert m.db.execute("SELECT count(*) FROM medicion_sal").fetchone()[0] == 0


def sinteticos(db: sqlite3.Connection, hoy: str):
    """5 sesiones: s1 completa todo y va a la lista; s2 abandona c2; s3 solo entra; s4 se va al sitio; s5 es vieja."""
    viejo = (datetime.date.fromisoformat(hoy) - datetime.timedelta(days=40)).isoformat()
    ev = []
    ev += [("s1", "visita", {}), ("s1", "entro_juego", {"fuente": "chip"})]
    for n in embudo.CURSOS:
        ev += [("s1", "nivel_inicio", {"nivel": n}), ("s1", "nivel_fin", {"nivel": n})]
    ev += [("s1", "certificado", {}), ("s1", "pregunta_agente", {"acciones": 1}),
           ("s1", "pregunta_agente", {"acciones": 0}), ("s1", "lista_espera_click", {"origen": "certificado"}),
           ("s1", "lista_espera_enviada", {"origen": "certificado"})]
    ev += [("s2", "visita", {}), ("s2", "entro_juego", {"fuente": "texto"}), ("s2", "nivel_inicio", {"nivel": "c1"}),
           ("s2", "nivel_fin", {"nivel": "c1"}), ("s2", "nivel_inicio", {"nivel": "c2"}),
           ("s2", "nivel_abandono", {"nivel": "c2", "paso": "pool"}), ("s2", "pregunta_agente", {"acciones": 2})]
    ev += [("s3", "visita", {}), ("s3", "entro_juego", {"fuente": "chip"})]
    ev += [("s4", "visita", {"vista": "sitio"}), ("s4", "sitio_convencional", {})]
    # s6 nunca mandó visita: no entra en el denominador (y su nivel inventado no crea filas)
    ev += [("s6", "tema_sitio", {"tema": "plan"}), ("s6", "nivel_inicio", {"nivel": "Juan Perez"})]
    for s, e, d in ev:
        db.execute("INSERT INTO medicion (dia, momento, sesion, evento, datos) VALUES (?, '12:00', ?, ?, ?)",
                   (hoy, s, e, json.dumps(d)))
    db.execute("INSERT INTO medicion (dia, momento, sesion, evento, datos) VALUES (?, '12:00', 's5', 'visita', '{}')",
               (viejo,))


def test_embudo_sintetico(entorno, tmp_path):
    _, m = entorno()
    hoy = datetime.date.today().isoformat()
    sinteticos(m.db, hoy)
    r = embudo.calcular(m.db, dias=30)
    assert {k: v["n"] for k, v in r["embudo"].items()} == {"visitas": 4, "juego": 3, "empezaron": 2,
                                                          "completaron_1": 2, "completaron_4": 1, "lista_espera": 1,
                                                          "lista_espera_enviada": 1}
    assert r["embudo"]["juego"]["pct"] == 75.0 and r["embudo"]["completaron_4"]["pct"] == 25.0
    assert r["niveles"]["c2"] == {"inicios": 2, "finales": 1, "abandonos": 1, "pct_completan": 50.0,
                                  "paso_abandono": "pool", "abandonos_en_ese_paso": 1}
    assert r["niveles"]["c1"]["finales"] == 2 and r["niveles"]["nft"]["inicios"] == 0
    assert r["fuentes"] == {"chip": 2, "texto": 1}
    assert r["agente"] == {"preguntas": 3, "sesiones_con_preguntas": 2, "por_sesion": 0.75,
                           "por_sesion_que_pregunto": 1.5}
    assert r["sitio_convencional"] == {"n": 1, "pct": 25.0}
    assert r["sesiones_sin_visita"] == 1 and r["vistas"] == {"juego": 3, "sitio": 1}
    assert "Juan Perez" not in r["niveles"]
    assert embudo.calcular(m.db, dias=60)["embudo"]["visitas"]["n"] == 5
    md = embudo.markdown(r)
    assert "| Entraron al juego | 3 | 75.0 % |" in md and "pool (1)" in md


def test_embudo_sin_tabla():
    r = embudo.calcular(sqlite3.connect(":memory:"))
    assert r["embudo"]["visitas"] == {"n": 0, "pct": 0.0} and r["agente"]["por_sesion"] == 0.0


def test_panel_solo_en_dev(entorno):
    c, _ = entorno(dev=False)
    assert c.get("/blockchain-dev/api/panel").status_code == 404
    c, m = entorno(dev=True)
    sinteticos(m.db, datetime.date.today().isoformat())
    r = c.get("/blockchain-dev/api/panel?dias=7")
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/html")
    assert "Entraron al juego" in r.text and "#261951" in r.text and "75,0 %" in r.text
