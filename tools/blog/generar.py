"""Genera el blog del LICDIA (/blog/) a partir de tools/blog/entradas/*.md.

Cada entrada es Markdown (admite HTML) con un encabezado entre dos líneas '---', una clave por línea:
  titulo, fecha (AAAA-MM-DD), autores, categoria (novedades | publicaciones | tesis | tecnicos),
  tema (ia | blockchain | datos), idioma (es | en), resumen
  y, si hacen falta: imagen, imagen_alt, imagen_vertical (si), video (id de YouTube), etiqueta, slug, codigo (si).
Escribe blog/<slug>/index.html, blog/index.html y blog/feed.xml; el bloque de novedades de la portada y las URL del blog
en sitemap.xml (entre <!-- BLOG:INICIO --> y <!-- BLOG:FIN -->); y la redirección de /dev-ia/blog/ al blog
(/blockchain-dev/blog/ tiene sus propias notas y no se toca).
Uso: tools/blog/.venv/bin/python tools/blog/generar.py
"""

import datetime
import hashlib
import html
import json
import pathlib
import re
import string

import markdown

RAIZ = pathlib.Path(__file__).resolve().parents[2]
ENTRADAS = pathlib.Path(__file__).resolve().parent / "entradas"
PLANTILLAS = pathlib.Path(__file__).resolve().parent / "plantillas"
SITIO = "https://licdia.unlu.edu.ar"

CATEGORIAS = {  # clave: (es, en)
    "novedades": ("Novedades", "News"),
    "publicaciones": ("Publicaciones", "Publications"),
    "tesis": ("Tesis", "Theses"),
    "tecnicos": ("Artículos técnicos", "Technical articles"),
}
TEMAS = {"ia": ("Inteligencia artificial", "Artificial intelligence"), "blockchain": ("Blockchain", "Blockchain"),
         "datos": ("Ciencia de datos", "Data science")}
MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre",
         "diciembre"]
REDIRECCIONES = ["dev-ia/blog"]  # blockchain-dev/blog has its own hand-written notes
EN_PORTADA = 3   # entradas en el bloque de novedades de la portada (sin los artículos técnicos, que están en inglés)


def leer(ruta):
    texto = ruta.read_text(encoding="utf-8")
    m = re.match(r"---\n(.*?)\n---\n(.*)", texto, re.S)
    if not m:
        raise SystemExit(f"{ruta.name}: falta el encabezado entre líneas '---'")
    meta = {}
    for linea in m.group(1).splitlines():
        if linea.strip():
            k, _, v = linea.partition(":")
            meta[k.strip()] = v.strip()
    for k in ("titulo", "fecha", "autores", "categoria", "tema", "idioma", "resumen"):
        if not meta.get(k):
            raise SystemExit(f"{ruta.name}: falta '{k}'")
    if meta["categoria"] not in CATEGORIAS or meta["tema"] not in TEMAS or meta["idioma"] not in ("es", "en"):
        raise SystemExit(f"{ruta.name}: categoría, tema o idioma desconocido")
    meta["fecha"] = datetime.date.fromisoformat(meta["fecha"])
    meta["slug"] = meta.get("slug") or re.sub(r"^\d{4}-\d{2}-\d{2}-", "", ruta.stem)
    cuerpo = markdown.markdown(m.group(2), extensions=["extra", "sane_lists"])
    cuerpo = cuerpo.replace("<table>", '<div class="bl-tabla"><table>').replace("</table>", "</table></div>")
    plano = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", cuerpo))).strip()
    meta["cuerpo"] = cuerpo
    meta["hash"] = hashlib.sha256((meta["titulo"] + "\n" + plano).encode("utf-8")).hexdigest()
    meta["minutos"] = max(1, round(len(plano.split()) / 220))
    return meta


def fecha_larga(e):
    f = e["fecha"]
    if e["idioma"] == "en":
        return f.strftime("%B ") + str(f.day) + f.strftime(", %Y")
    return f"{f.day} de {MESES[f.month - 1]} de {f.year}"


def huella(e, columnas=16):
    """Los 32 bytes del SHA-256 de la entrada como 64 celdas: la intensidad de cada una es un nibble."""
    nibbles = [int(c, 16) for c in e["hash"]]
    filas = len(nibbles) // columnas
    celdas = "".join(
        f'<rect x="{(i % columnas) * 10}" y="{(i // columnas) * 10}" width="8" height="8" rx="2" '
        f'fill-opacity="{0.1 + 0.9 * n / 15:.2f}"/>' for i, n in enumerate(nibbles))
    return (f'<svg viewBox="0 0 {columnas * 10 - 2} {filas * 10 - 2}" fill="currentColor" aria-hidden="true">'
            f'{celdas}</svg>')


def esc(s):
    return html.escape(str(s), quote=True)


def plantilla(nombre, **vals):
    return string.Template((PLANTILLAS / nombre).read_text(encoding="utf-8")).substitute(**vals)


def tarjeta(e, nivel="h2"):
    cat_es = CATEGORIAS[e["categoria"]][0]
    if e.get("imagen"):
        webp = re.sub(r"\.(jpe?g|png)$", ".webp", e["imagen"])
        fuente = f'<source srcset="{esc(webp)}" type="image/webp">' if (RAIZ / webp.lstrip("/")).exists() else ""
        visual = f'<picture>{fuente}<img src="{esc(e["imagen"])}" alt="" loading="lazy"></picture>'
    else:
        visual = f'<div class="bl-huella">{huella(e)}</div>'
    idioma = '<span class="bl-idioma" title="Artículo en inglés">EN</span>' if e["idioma"] == "en" else ""
    return f"""<div class="col-md-6 col-lg-4 bl-item" data-cat="{e['categoria']}" data-tema="{e['tema']}" data-slug="{e['slug']}">
                <a class="bl-tarjeta" href="/blog/{e['slug']}/" data-cat="{e['categoria']}">
                    <div class="bl-tarjeta-visual">{visual}</div>
                    <div class="bl-tarjeta-cuerpo">
                        <div class="bl-tarjeta-meta"><span class="bl-chip">{esc(cat_es)}</span>{idioma}<span>{e['fecha'].isoformat()}</span></div>
                        <{nivel}>{esc(e['titulo'])}</{nivel}>
                        <p>{esc(e['resumen'])}</p>
                        <div class="bl-tarjeta-pie">{esc(e['autores'])} · {e['minutos']} min</div>
                    </div>
                </a>
            </div>"""


def pagina_entrada(e, todas):
    en = e["idioma"] == "en"
    cat = CATEGORIAS[e["categoria"]][1 if en else 0]
    tema = TEMAS[e["tema"]][1 if en else 0]
    figura = ""
    # con video, la entrada muestra el video y la imagen queda para la tarjeta y para compartir
    if e.get("imagen") and not e.get("video"):
        webp = re.sub(r"\.(jpe?g|png)$", ".webp", e["imagen"])
        fuente = f'<source srcset="{esc(webp)}" type="image/webp">' if (RAIZ / webp.lstrip("/")).exists() else ""
        clase = ' vertical' if e.get("imagen_vertical") == "si" else ""
        figura = (f'<figure class="bl-figura{clase}"><picture>{fuente}<img src="{esc(e["imagen"])}" '
                  f'alt="{esc(e.get("imagen_alt", ""))}"></picture></figure>')
    if e.get("video"):
        figura = (f'<div class="bl-video"><iframe src="https://www.youtube-nocookie.com/embed/{esc(e["video"])}" '
                  f'title="{esc(e["titulo"])}" loading="lazy" allow="accelerometer; clipboard-write; encrypted-media; '
                  f'gyroscope; picture-in-picture" allowfullscreen></iframe></div>')
    otras = [o for o in todas if o is not e and o["tema"] == e["tema"]][:3]
    otras += [o for o in todas if o is not e and o not in otras][:3 - len(otras)]
    relacionadas = ("" if not otras else
                    f'<section class="bl-relacionadas"><h2>{"Keep reading" if en else "Seguir leyendo"}</h2>'
                    f'<div class="row g-4">{"".join(tarjeta(o, "h3") for o in otras)}</div></section>')
    codigo_css = ('<link href="https://cdn.jsdelivr.net/npm/highlight.js@11.9.0/styles/github-dark.min.css" rel="stylesheet">'
                  if e.get("codigo") == "si" else "")
    codigo_js = ('<script src="https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11.9.0/build/highlight.min.js"></script>'
                 '<script>hljs.highlightAll();</script>' if e.get("codigo") == "si" else "")
    url = f"{SITIO}/blog/{e['slug']}/"
    ld = {"@context": "https://schema.org", "@type": "BlogPosting", "headline": e["titulo"], "description": e["resumen"],
          "datePublished": e["fecha"].isoformat(), "inLanguage": e["idioma"], "mainEntityOfPage": url,
          "author": [{"@type": "Person" if a.strip() != "LICDIA" else "Organization", "name": a.strip()}
                     for a in e["autores"].split(",")],
          "publisher": {"@type": "Organization", "name": "LICDIA — Universidad Nacional de Luján", "url": SITIO + "/"}}
    if e.get("imagen"):
        ld["image"] = SITIO + e["imagen"]
    return plantilla(
        "entrada.html", idioma=e["idioma"], titulo=esc(e["titulo"]), resumen=esc(e["resumen"]), url=url,
        og_imagen=esc(SITIO + e["imagen"]) if e.get("imagen") else f"{SITIO}/assets/img/licdia-logo-circulo.webp",
        jsonld=json.dumps(ld, ensure_ascii=False, indent=1), codigo_css=codigo_css, codigo_js=codigo_js,
        cat=e["categoria"], cat_nombre=esc(cat), tema=esc(tema),
        idioma_marca='<span class="bl-idioma">EN</span>' if en else "",
        volver="Back to the blog" if en else "Volver al blog",
        meta=f'{esc(e["autores"])} · {fecha_larga(e)} · {e["minutos"]} {"min read" if en else "min de lectura"}',
        huella=huella(e), hash_corto=e["hash"][:16],
        huella_nota=("Fingerprint: the 32 bytes of the SHA-256 of this text" if en
                     else "Huella: los 32 bytes del SHA-256 de este texto"),
        figura=figura, cuerpo=e["cuerpo"], relacionadas=relacionadas, pie=plantilla("pie.html"),
        nav=plantilla("nav.html"))


def pagina_indice(todas):
    cuenta = {c: sum(1 for e in todas if e["categoria"] == c) for c in CATEGORIAS}
    botones = [f'<button type="button" class="bl-filtro" data-tipo="cat" data-valor="" aria-pressed="true">Todo'
               f'<span class="bl-n">{len(todas)}</span></button>']
    botones += [f'<button type="button" class="bl-filtro" data-tipo="cat" data-valor="{c}" data-cat="{c}" '
                f'aria-pressed="false">{esc(n[0])}<span class="bl-n">{cuenta[c]}</span></button>'
                for c, n in CATEGORIAS.items() if cuenta[c]]
    temas_attr = " ".join(f'data-{k}="{esc(v[0])}"' for k, v in TEMAS.items())
    botones.append(f'<button type="button" class="bl-filtro bl-filtro-tema" data-tipo="tema" data-valor="" {temas_attr} '
                   f'aria-pressed="false" title="Quitar el filtro de tema">Tema: <span class="bl-tema-nombre"></span> ✕</button>')
    datos = [{"slug": e["slug"], "cat": e["categoria"], "tema": e["tema"], "h": e["hash"][:16]} for e in todas]
    return plantilla("indice.html", nav=plantilla("nav.html"), pie=plantilla("pie.html"), filtros="\n".join(botones),
                     tarjetas="\n".join(tarjeta(e) for e in todas), datos=json.dumps(datos))


def feed(todas):
    items = "\n".join(f"""  <item>
    <title>{esc(e['titulo'])}</title>
    <link>{SITIO}/blog/{e['slug']}/</link>
    <guid isPermaLink="true">{SITIO}/blog/{e['slug']}/</guid>
    <pubDate>{datetime.datetime.combine(e['fecha'], datetime.time(12)).strftime('%a, %d %b %Y %H:%M:%S -0300')}</pubDate>
    <dc:creator>{esc(e['autores'])}</dc:creator>
    <category>{esc(CATEGORIAS[e['categoria']][0])}</category>
    <description>{esc(e['resumen'])}</description>
  </item>""" for e in todas)
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
  <title>Blog del LICDIA</title>
  <link>{SITIO}/blog/</link>
  <atom:link href="{SITIO}/blog/feed.xml" rel="self" type="application/rss+xml"/>
  <description>Novedades, publicaciones, tesis y artículos técnicos del Laboratorio de Investigación en Ciencia de Datos e Inteligencia Artificial (UNLu).</description>
  <language>es-ar</language>
{items}
</channel>
</rss>
"""


def portada(todas):
    elegidas = [e for e in todas if e["categoria"] != "tecnicos"][:EN_PORTADA]
    tarjetas = "\n".join(f"""                <a class="bl-nov" href="/blog/{e['slug']}/">
                    <span class="bl-nov-huella" title="Huella de la entrada: el SHA-256 de su texto">{huella(e)}</span>
                    <span class="bl-nov-meta">{esc(CATEGORIAS[e['categoria']][0])} · {fecha_larga(e)}</span>
                    <span class="bl-nov-titulo">{esc(e['titulo'])}</span>
                    <span class="bl-nov-resumen">{esc(e['resumen'])}</span>
                </a>""" for e in elegidas)
    return f"""<!-- BLOG:INICIO (lo escribe tools/blog/generar.py) -->
    <section class="page-section bl-novedades" id="noticias">
        <div class="container">
            <div class="text-center">
                <h2 class="section-heading text-uppercase">Novedades</h2>
            </div>
            <div class="bl-nov-grilla">
{tarjetas}
            </div>
            <p class="text-center mt-4 mb-0"><a class="bl-nov-todas" href="/blog/">Ver todas las entradas del blog →</a></p>
        </div>
    </section>
    <!-- BLOG:FIN -->"""


def reemplazar_bloque(ruta, bloque):
    texto = ruta.read_text(encoding="utf-8")
    m = re.search(r"[ \t]*<!-- BLOG:INICIO.*?<!-- BLOG:FIN -->", texto, re.S)
    if not m:
        raise SystemExit(f"{ruta}: faltan las marcas <!-- BLOG:INICIO --> y <!-- BLOG:FIN -->")
    ruta.write_text(texto[:m.start()] + bloque + texto[m.end():], encoding="utf-8")


def main():
    todas = sorted((leer(r) for r in ENTRADAS.glob("*.md")), key=lambda e: (e["fecha"], e["slug"]), reverse=True)
    slugs = [e["slug"] for e in todas]
    if len(set(slugs)) != len(slugs):
        raise SystemExit("hay dos entradas con el mismo slug")
    for e in todas:
        destino = RAIZ / "blog" / e["slug"] / "index.html"
        destino.parent.mkdir(parents=True, exist_ok=True)
        destino.write_text(pagina_entrada(e, todas), encoding="utf-8")
    (RAIZ / "blog" / "index.html").write_text(pagina_indice(todas), encoding="utf-8")
    (RAIZ / "blog" / "feed.xml").write_text(feed(todas), encoding="utf-8")
    reemplazar_bloque(RAIZ / "index.html", "    " + portada(todas))
    urls = [f'  <url><loc>{SITIO}/blog/</loc><priority>0.7</priority><lastmod>{todas[0]["fecha"].isoformat()}</lastmod></url>']
    urls += [f'  <url><loc>{SITIO}/blog/{e["slug"]}/</loc><priority>0.6</priority><lastmod>{e["fecha"].isoformat()}</lastmod></url>'
             for e in todas]
    reemplazar_bloque(RAIZ / "sitemap.xml", "  <!-- BLOG:INICIO (lo escribe tools/blog/generar.py) -->\n" + "\n".join(urls)
                      + "\n  <!-- BLOG:FIN -->")
    for carpeta in REDIRECCIONES:
        (RAIZ / carpeta / "index.html").write_text(plantilla("redireccion.html"), encoding="utf-8")
    print(f"{len(todas)} entradas: " + ", ".join(f"{c} {sum(1 for e in todas if e['categoria'] == c)}" for c in CATEGORIAS))


if __name__ == "__main__":
    main()
