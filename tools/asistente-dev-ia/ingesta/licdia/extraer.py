"""Extrae el contenido del sitio del laboratorio (licdia.unlu.edu.ar) en secciones citables para su asistente.

Lee solo el sitio publicado, así que sirve igual sobre el repo que sobre /var/www/html de la VM (ver
despliegue/reindexar.sh, que lo corre a diario en la VM):
- la portada: presentación y cifras, líneas de I+D con sus trabajos, proyectos y el texto de sus ventanas,
  desarrollos, cursos, carreras, equipo por grupos, «Sumate» y contacto;
- /publicaciones/ y las entradas del blog (los pósters de las Jornadas, uno por sección);
- las páginas propias: proyectos, Liminar, LidIA y su instructivo, Normativa y el director;
- los subsitios: la documentación de Liminar (GitHub Pages, por HTTP), la Diplomatura en Blockchain, la Maestría y la
  Diplomatura en IA Generativa (sus secciones salen de indice/, que hay que extraer antes con extraer_sitio.py).
Los bloques largos se cortan en tramos con el mismo título, como en la extracción de la diplomatura.

Uso: .venv/bin/python ingesta/licdia/extraer.py <raíz del sitio>   (el repo webLaboratorio o /var/www/html)
Escribe indice-licdia/secciones.json.
"""

import json
import pathlib
import re
import sys

from bs4 import BeautifulSoup, Comment, NavigableString, Tag

RAIZ = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(RAIZ / "ingesta"))
from extraer_sitio import limpio, tramos  # noqa: E402  (mismas reglas de corte)


def texto_de(el):
    """Texto legible: los bloques y los ítems quedan separados, y los saltos de línea del HTML no cortan oraciones
    (a diferencia del extractor de la diplomatura, acá el HTML viene con líneas cortadas a mano)."""
    partes = []
    for d in el.descendants:
        if isinstance(d, Comment):
            continue
        if isinstance(d, NavigableString):
            if not (d.parent and d.parent.name in QUITAR):
                partes.append(re.sub(r"\s+", " ", str(d)))
        elif isinstance(d, Tag) and d.name in ("p", "li", "h1", "h2", "h3", "h4", "h5", "tr", "br", "div"):
            partes.append("\n")
    return "\n".join(x for x in (limpio(x) for x in "".join(partes).split("\n")) if x)

PAGINAS_PROYECTO = {"LLM": "Proyecto LLM en la nube", "ipc": "Proyecto IPC", "fitba-13c": "Proyecto fitba-13c",
                    "proyecto-enseñanza": "Proyecto de enseñanza de programación",
                    "proyecto-enseñanza/ia": "Curso de IA para escuelas secundarias",
                    "proyecto-enseñanza/juego": "Curso de videojuegos para escuelas secundarias",
                    "proyecto-enseñanza/web": "Curso de programación web para escuelas secundarias",
                    # desarrollos y páginas propias del laboratorio
                    "liminar": "Liminar: modelos de lenguaje abiertos del sistema universitario argentino",
                    "lidia": "LidIA: retroalimentación formativa asistida por IA con revisión docente",
                    "lidia/instructivo": "Instructivo de uso de LidIA",
                    "normativa": "Normativa UNLu: consulta conversacional de la normativa universitaria",
                    "director": "Director del laboratorio (Juan Manuel Fernández)"}
# Páginas cuyo encabezado no sirve de título (mezcla nombre y bajada): van con el nombre de PAGINAS_PROYECTO
NOMBRE_FIJO = {"liminar", "lidia", "lidia/instructivo", "normativa", "director"}
QUITAR = ["script", "style", "nav", "footer", "form", "noscript", "iframe", "svg", "button"]


def sopa(ruta):
    s = BeautifulSoup(ruta.read_text(encoding="utf-8"), "html.parser")
    for t in s(QUITAR):
        t.decompose()
    return s


def agregar(salida, titulo, texto, url, ancla="", tipo="texto"):
    texto = texto.strip()
    if len(texto.split()) < 4:
        return
    for k, tramo in enumerate(tramos(texto)):
        salida.append({"titulo": titulo + (f" ({k + 1})" if k else ""), "url": url, "ancla": ancla, "tipo": tipo,
                       "texto": tramo})


def portada(sitio, salida):
    s = sopa(sitio / "index.html")
    pf = s.find(id="portfolio")
    intro = pf.find("h3", class_="section-subheading") if pf else None
    if intro:
        texto = limpio(intro.get_text(" "))
        cifras = [limpio(a.get_text(" ")) for a in pf.select(".qh-cifras a")]
        if cifras:
            texto += "\nEn cifras: " + "; ".join(cifras) + "."
        agregar(salida, "Investigación del laboratorio", "Laboratorio de Investigación en Ciencia de Datos e Inteligencia "
                "Artificial (LICDIA), Departamento de Ciencias Básicas, Universidad Nacional de Luján. " + texto, "/", "portfolio")
    # Líneas de I+D: tarjetas con descripción y trabajos de cada línea
    for ln in s.select("article.qh-linea"):
        nombre = limpio(ln.find("h4").get_text(" "))
        desc = limpio(ln.find("p").get_text(" ")) if ln.find("p") else ""
        trabajos = [limpio(li.get_text(" ")) + " (" + (li.find("a") or {}).get("href", "") + ")" for li in ln.select("li")]
        agregar(salida, "Línea de I+D: " + nombre, desc + "\nTrabajos de la línea: " + "; ".join(trabajos) + ".", "/", "lineas")
    # Proyectos de I+D+E: la lista completa (las páginas y ventanas de cada uno se extraen aparte)
    proys = [limpio(a.select_one(".qh-proy-titulo").get_text(" ")) + " (" + a.get("href", "") + ")" for a in s.select("a.qh-proy")]
    if proys:
        agregar(salida, "Proyectos de I+D+E del laboratorio", "\n".join(proys), "/", "portfolio")
    # Desarrollos: sistemas en uso, con su página y el enlace al sistema
    des = s.find(id="desarrollos")
    if des:
        lista = []
        for it in des.find_all_next(class_="portfolio-item"):
            if not it.find_parent(id="portfolio"):   # las tarjetas de cursos que siguen no son desarrollos
                break
            t = limpio(it.select_one(".portfolio-caption-heading").get_text(" "))
            enl = {limpio(a.get_text(" ")).strip("> ").strip(): a.get("href", "") for a in it.select(".portfolio-caption-subheading a")}
            lista.append(t + ". " + "; ".join(f"{k}: {v}" for k, v in enl.items()))
            agregar(salida, "Desarrollo: " + t, "Desarrollo del laboratorio. " + "; ".join(f"{k}: {v}" for k, v in enl.items()) + ".",
                    "/", "desarrollos")
        agregar(salida, "Desarrollos del laboratorio", "\n".join(lista), "/", "desarrollos")
    # Cada línea y proyecto: el texto de su ventana (las tarjetas solo traen el título)
    for m in s.select("div.portfolio-modal"):
        cuerpo = m.find(class_="modal-body")
        if not cuerpo:
            continue
        t = limpio(cuerpo.find(["h2", "h3"]).get_text(" ")) if cuerpo.find(["h2", "h3"]) else ""
        cat = ""
        for li in cuerpo.select("ul.list-inline li"):
            if "Categoría" in li.get_text():
                cat = limpio(li.get_text(" ").replace("Categoría:", ""))
        for x in cuerpo.select("ul.list-inline"):
            x.decompose()
        nombre = ("Línea de I+D" if "Líneas" in cat else "Proyecto") + ": " + t.capitalize() if t.isupper() else \
            ("Línea de I+D" if "Líneas" in cat else "Proyecto") + ": " + t
        agregar(salida, nombre, texto_de(cuerpo), "/", m.get("id", ""))
    cur = s.find(id="cursosYcarreras")
    if cur:
        cursos = []
        for c in cur.select(".portfolio-caption"):
            cursos.append(limpio(c.get_text(" ")))
        agregar(salida, "Cursos, charlas, webinars y participaciones del laboratorio", "\n".join(cursos), "/", "cursosYcarreras")
        for d in cur.select("a.diplo-card"):
            agregar(salida, "Carrera: " + limpio(d.find(class_="diplo-card-titulo").get_text(" ")),
                    "Diplomatura de posgrado del laboratorio. " + texto_de(d) + "\nSitio: " + d.get("href", ""), "/", "cursosYcarreras")
        otras = [texto_de(c).replace("\n", " · ") + " (" + c.get("href", "") + ")" for c in cur.select("a.carrera-mini")]
        agregar(salida, "Otras carreras en las que participa el laboratorio", "\n".join(otras), "/", "cursosYcarreras")
    eq = s.find(id="team")
    if eq:
        grupo, personas = "Integrantes del laboratorio (UNLu)", {}
        for e in eq.select("h3.low-tittle, .team-member"):
            if e.name == "h3":
                t = limpio(e.get_text(" "))
                grupo = ("Tesistas actuales del laboratorio" if "Tesista" in t else "Pasantes del laboratorio" if "Pasante" in t
                         else "Colaboradores externos del laboratorio" if "Colaborador" in t else "Integrantes del laboratorio (UNLu)")
                continue
            personas.setdefault(grupo, []).append(texto_de(e).replace("\n", " · "))
        for g, lista in personas.items():
            agregar(salida, "Equipo: " + g, "\n".join(lista), "/", "team")
    sm = s.find(id="sumate")
    if sm:
        sub = limpio(sm.find("h3").get_text(" ")) if sm.find("h3") else ""
        caminos = [limpio(c.find("h4").get_text(" ")) + ": " + limpio(c.find("p").get_text(" ")) for c in sm.select(".sm-camino")]
        agregar(salida, "Sumate al LICDIA: tesis, ayudantías, becas, integración y convenios",
                sub + "\n" + "\n".join(caminos) + "\nPara sumarse se completa el formulario de la portada "
                "(https://licdia.unlu.edu.ar/#sumate) o se escribe a licdia@unlu.edu.ar.", "/", "sumate")
    ct = s.find(id="contact")
    if ct:
        agregar(salida, "Contacto y ubicación del laboratorio", texto_de(ct), "/", "contact")


def publicaciones(sitio, salida):
    """Desde la página publicada /publicaciones/ (generada por tools/publicaciones), para que la extracción funcione
    también en la VM, que solo tiene el sitio publicado."""
    s = sopa(sitio / "publicaciones" / "index.html") if (sitio / "publicaciones" / "index.html").exists() else None
    for it in (s.select("article.pub-item") if s else []):
        t = limpio(it.select_one(".pub-titulo").get_text(" "))
        cab = [limpio(x.get_text(" ")) for x in it.select(".pub-meta > *") if limpio(x.get_text(" "))]
        partes = [". ".join(cab) + ".",
                  "Autores: " + limpio(it.select_one(".pub-autores").get_text(" ")) if it.select_one(".pub-autores") else "",
                  "Presentado en: " + limpio(it.select_one(".pub-venue").get_text(" ")) if it.select_one(".pub-venue") else ""]
        tags = [x for x in it.get("data-tags", "").split("|") if x]
        if tags:
            partes.append("Palabras clave: " + ", ".join(tags) + ".")
        enlaces = [a.get("href") for a in it.select(".pub-acciones a[href]") if a.get("href", "").strip("#")]
        if enlaces:
            partes.append("Enlace: " + enlaces[0])
        agregar(salida, "Publicación: " + t, "\n".join(x for x in partes if x), "/publicaciones/", "publicaciones")


def blog(sitio, salida):
    """Desde las páginas publicadas del blog (las genera tools/blog/generar.py)."""
    for f in sorted((sitio / "blog").glob("*/index.html"), reverse=True):
        s = BeautifulSoup(f.read_text(encoding="utf-8"), "html.parser")
        cuerpo = s.select_one(".bl-texto")
        if not cuerpo or not s.select_one("h1"):
            continue
        titulo = limpio(s.select_one("h1").get_text(" "))
        slug = f.parent.name
        meta = limpio(s.select_one(".bl-meta").get_text(" ")) if s.select_one(".bl-meta") else ""
        bajada = limpio(s.select_one(".bl-bajada").get_text(" ")) if s.select_one(".bl-bajada") else ""
        for t in cuerpo(QUITAR):
            t.decompose()
        # Muro de pósters (css/blog-posters.css): cada póster es una sección propia
        evento = titulo.split(" en las ")[-1] if " en las " in titulo else titulo
        for li in cuerpo.select("li.px-item"):
            t = limpio(li.select_one(".px-titulo").get_text(" "))
            pdf = li.select_one("a.px-pdf")
            partes = ["Póster presentado por el laboratorio. Línea de I+D: " + limpio(li.select_one(".px-linea").get_text(" ")) + ".",
                      "Autores: " + limpio(li.select_one(".px-autores").get_text(" ")),
                      "Síntesis: " + limpio(li.select_one(".px-mensaje").get_text(" ")),
                      "Resumen: " + texto_de(li.select_one(".px-resumen"))]
            if pdf:
                partes.append("Póster en PDF: " + pdf.get("href", ""))
            agregar(salida, f"Póster ({evento}): {t}", "\n".join(partes), f"/blog/{slug}/", li.get("id", ""))
        for muro in cuerpo.select("section.px"):
            muro.decompose()
        agregar(salida, "Blog: " + titulo, (meta + ". " if meta else "") + bajada + "\n" + texto_de(cuerpo), f"/blog/{slug}/")


DOC_LIMINAR = "https://licdia-unlu.github.io/liminar/"


def doc_liminar(salida):
    """La documentación de Liminar (GitHub Pages, mkdocs): una sección por cada título de segundo nivel. En la VM sale
    por el proxy de la UNLu (HTTPS_PROXY). Si no se puede leer, se avisa y sigue: la prueba de Liminar en pruebas.json
    hace que el índice nuevo no se publique."""
    import urllib.request
    from urllib.parse import urljoin

    def leer(url):
        with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "licdia-asistente"}), timeout=30) as r:
            return BeautifulSoup(r.read().decode("utf-8"), "html.parser")
    try:
        inicio = leer(DOC_LIMINAR)
    except Exception as e:  # noqa: BLE001
        print("aviso: no pude leer la documentación de Liminar:", type(e).__name__, str(e)[:120])
        return
    paginas = [DOC_LIMINAR]
    for a in inicio.select("nav a.md-nav__link[href]"):
        u = urljoin(DOC_LIMINAR, a["href"]).split("#")[0]
        if u.startswith(DOC_LIMINAR) and u not in paginas:
            paginas.append(u)
    for u in paginas:
        try:
            s = inicio if u == DOC_LIMINAR else leer(u)
        except Exception as e:  # noqa: BLE001
            print("aviso: no pude leer", u, type(e).__name__)
            continue
        art = s.select_one("article.md-content__inner") or s.select_one("article")
        if not art:
            continue
        for x in art.select("a.headerlink, .md-content__button, script, style"):
            x.decompose()
        h1 = limpio(art.find("h1").get_text(" ")) if art.find("h1") else "Liminar"
        actual, ancla, partes = h1, "", []
        def cerrar():
            if partes:
                agregar(salida, "Liminar (documentación): " + (h1 if actual == h1 else h1 + " · " + actual),
                        "\n".join(partes), u, ancla)
        for el in art.find_all(["h2", "p", "li", "td", "pre", "h3"], recursive=True):
            if el.name == "h2":
                cerrar()
                actual, ancla, partes = limpio(el.get_text(" ")), el.get("id", ""), []
            elif el.name in ("p", "h3", "pre") or (el.name in ("li", "td") and not el.find(["p", "ul", "ol"])):
                t = limpio(el.get_text(" "))
                if t:
                    partes.append(t)
        cerrar()


# Subsitios: todas sus páginas con contenido (las de inscripción, agradecimiento, espera o en vivo no)
SUBSITIOS = {"blockchain-dev": "Diplomatura en Blockchain",
             "maestria-ciencia-datos": "Maestría en Ciencia de Datos (carrera vinculada al laboratorio)"}
SUBSITIO_EXCLUIR = ("inscripcion", "gracias", "espera", "en-vivo", "verificar", "programas-hidden")


def subsitios(sitio, salida):
    for carpeta, prefijo in SUBSITIOS.items():
        for ruta in sorted((sitio / carpeta).rglob("index.html")):
            rel = ruta.parent.relative_to(sitio).as_posix()
            html = ruta.read_text(encoding="utf-8")
            if any(x in rel for x in SUBSITIO_EXCLUIR) or 'http-equiv="refresh"' in html:
                continue
            s = BeautifulSoup(html, "html.parser")
            for t in s(QUITAR):
                t.decompose()
            h1 = s.find("h1")
            pagina = limpio(h1.get_text(" ")) if h1 and len(limpio(h1.get_text(" "))) < 120 else rel.split("/")[-1].replace("-", " ")
            nombre = prefijo if rel == carpeta else f"{prefijo}: {pagina}"
            bloques = [b for b in s.find_all(["section", "article"]) if not b.find_parent(["section", "article"])]
            for b in bloques:
                h = b.find(["h2", "h3"])
                sub = limpio(h.get_text(" ")).strip("¿? ") if h else ""
                agregar(salida, nombre + (": " + sub if sub and sub.lower() not in nombre.lower() else ""), texto_de(b),
                        f"/{rel}/", b.get("id", "") if b.name else "")
                b.decompose()
            # Lo que queda fuera de section/article (en aranceles, por ejemplo, los montos)
            if s.body:
                agregar(salida, nombre, texto_de(s.body), f"/{rel}/")


def diplomatura_ia(salida):
    """La Diplomatura en IA Generativa ya tiene su índice (indice/, de ingesta/extraer_sitio.py): se suman sus secciones."""
    f = RAIZ / "indice" / "secciones.json"
    if not f.exists():
        return
    datos = json.loads(f.read_text(encoding="utf-8"))
    for x in (datos["secciones"] if isinstance(datos, dict) else datos):
        agregar(salida, "Diplomatura en IA Generativa: " + x["titulo"], x["texto"], x["url"], x.get("ancla", ""), x.get("tipo", "texto"))


def paginas_proyecto(sitio, salida):
    for carpeta, nombre in PAGINAS_PROYECTO.items():
        ruta = sitio / carpeta / "index.html"
        if not ruta.exists():
            continue
        s = sopa(ruta)
        cab = s.find("header")
        titulo = nombre if carpeta in NOMBRE_FIJO else (
            limpio(cab.get_text(" ")) if cab and len(limpio(cab.get_text(" "))) < 140 else nombre)
        if cab:
            cab.decompose()
        # Por bloques con título; lo que no está bajo un título va con el nombre del proyecto
        bloques = s.find_all(["section", "article"]) or [s.body]
        for b in bloques:
            h = b.find(["h2", "h3"])
            # sin signos de pregunta: "¿De qué trata el proyecto?" sin el nombre del proyecto no sirve de repregunta
            sub = limpio(h.get_text(" ")).strip("¿? ") if h else ""
            agregar(salida, titulo + (": " + sub.capitalize() if sub.isupper() else ": " + sub if sub else ""),
                    texto_de(b), f"/{carpeta}/", b.get("id", "") if b.name else "")


def main():
    sitio = pathlib.Path(sys.argv[1]).expanduser()
    salida = []
    portada(sitio, salida)
    publicaciones(sitio, salida)
    blog(sitio, salida)
    paginas_proyecto(sitio, salida)
    doc_liminar(salida)
    subsitios(sitio, salida)
    diplomatura_ia(salida)
    vistos, unicas = set(), []
    for s in salida:
        clave = s["texto"][:200]
        if clave not in vistos:
            vistos.add(clave)
            unicas.append(s)
    for i, s in enumerate(unicas, 1):
        s["id"] = f"S{i}"
    destino = RAIZ / "indice-licdia"
    destino.mkdir(exist_ok=True)
    (destino / "secciones.json").write_text(json.dumps({"secciones": unicas, "videos": []}, ensure_ascii=False, indent=1),
                                            encoding="utf-8")
    palabras = sum(len(s["texto"].split()) for s in unicas)
    print(f"{len(unicas)} secciones, {palabras} palabras")


if __name__ == "__main__":
    main()
