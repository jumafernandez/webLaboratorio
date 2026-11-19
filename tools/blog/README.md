# Generador del blog (/blog/)

Las páginas del blog no se editan a mano: se generan desde las entradas de `entradas/` con `generar.py`.

| Archivo | Qué es |
|---|---|
| `entradas/AAAA-MM-DD-slug.md` | Una entrada: encabezado entre dos líneas `---` y el texto en Markdown (admite HTML). |
| `plantillas/` | HTML de la entrada, el índice, la barra superior, el pie y las redirecciones (variables `$nombre`). |
| `generar.py` | Escribe `blog/<slug>/index.html`, `blog/index.html`, `blog/feed.xml`, el bloque de novedades de la portada (`index.html`), las URL del blog en `sitemap.xml` y las redirecciones de `/dev-ia/blog/` y `/blockchain-dev/blog/` al blog. |

Los estilos están en `css/blog.css` y los filtros y el mapa del encabezado en `js/blog.js`; esos sí se publican.

## Agregar una entrada

1. Crear `entradas/AAAA-MM-DD-slug.md` copiando una existente. Claves del encabezado:
   - obligatorias: `titulo`, `fecha`, `autores` (separados por coma), `categoria` (`novedades`, `publicaciones`, `tesis` o `tecnicos`), `tema` (`ia`, `blockchain` o `datos`), `idioma` (`es` o `en`), `resumen`;
   - optativas: `imagen` (ruta absoluta; si existe la versión `.webp` al lado, se usa), `imagen_alt`, `imagen_vertical: si`, `imagen_en_entrada: no` (la imagen queda solo para la tarjeta y para compartir), `video` (id de YouTube; con video, la entrada muestra el video y la imagen queda para la tarjeta), `slug` (si no, sale del nombre del archivo), `codigo: si` (resalta bloques de código).
2. `tools/blog/.venv/bin/python tools/blog/generar.py`
3. Publicar `blog/`, `index.html` y `sitemap.xml`.

La portada muestra las tres entradas más recientes que no son artículos técnicos (esos están en inglés). La primera vez:
`python3 -m venv tools/blog/.venv && tools/blog/.venv/bin/python -m pip install markdown`.
