# Asistentes del LICDIA: la Diplomatura en IA Generativa (dev-ia) y el laboratorio

Backend de los asistentes conversacionales de https://licdia.unlu.edu.ar/dev-ia/ (abre por defecto en la portada) y
de https://licdia.unlu.edu.ar/ (se abre desde la pregunta del encabezado o el ítem "Asistente" del menú). Vive en
`tools/` del repositorio del sitio, que no se publica; la interfaz de los dos es `js/devia-asistente.js` y
`css/devia-asistente.css` (el laboratorio la configura con `window.ASISTENTE` en `index.html`).

Un solo servicio sirve a los dos sitios: cada uno tiene su índice (`indice/` y `indice-licdia/`), su ficha y sus
reglas, y comparten el modelo de embeddings (cargado una vez), los topes y el registro, que anota de qué sitio vino
cada pregunta. Las rutas son las de la diplomatura, que nginx ya publica: el laboratorio usa `?sitio=licdia` en el mapa
y `"sitio": "licdia"` en el pedido.

Es un RAG chico de punta a punta: el texto del sitio estático se parte en secciones citables, cada sección tiene su
embedding, y ante cada pregunta se calcula el embedding de la pregunta, se recuperan las 6 secciones más parecidas
(sin repetir casi duplicados) y un modelo de lenguaje responde solo con ellas, citándolas. La respuesta llega en
streaming (Server-Sent Events) con las etapas que muestra la interfaz: embedding, secciones recuperadas, texto y uso.
No se guardan conversaciones: solo cada pregunta suelta, anónima (ver "Topes y registro").

## Estructura

- `ingesta/extraer_sitio.py`: extrae las secciones del sitio (portada, preguntas frecuentes, módulos del plan y
  subpáginas) a `indice/secciones.json`.
- `ingesta/licdia/extraer.py`: lo mismo para el laboratorio (portada: presentación y cifras, líneas de I+D con sus
  trabajos, proyectos, desarrollos, cursos, carreras, equipo, «Sumate» y contacto; las publicaciones desde
  `tools/publicaciones`; las entradas de `tools/blog`, con cada póster de las Jornadas como sección; las páginas de
  proyectos, Liminar, LidIA y su instructivo, Normativa, director y maestría) a `indice-licdia/secciones.json`. Su ficha, expansiones y preguntas de prueba están en `ingesta/licdia/`.
- `ingesta/indexar.py [carpeta]`: embeddings de las secciones (`intfloat/multilingual-e5-base`), `modelo.json` y la
  proyección 3D por PCA que dibuja la interfaz.
- `backend/app.py`: FastAPI con `/dev-ia/api/mapa` y `/dev-ia/api/chat`. Llama a Claude con el SDK oficial de
  Anthropic, con prompt caching sobre la parte fija del prompt (reglas + ficha de datos clave); la fecha y las secciones
  de cada consulta van en un bloque aparte, después del punto de caché.
- `backend/recuperacion.py`: la recuperación (cupos por parte en preguntas compuestas, casi duplicados). La usan el
  backend y `ingesta/evaluar.py`, así la evaluación mide lo mismo que corre en producción.
- `backend/registro.py` y `backend/topes.json`: topes de uso y registro anónimo de preguntas (SQLite).
- `backend/consultas.py` y `despliegue/preguntas.sh`: resumen de lo que se pregunta.
- `tests/`: pruebas de topes y registro (`.venv/bin/python -m pytest tests/`).
- `despliegue/`: servicio de systemd, snippet y zonas de nginx, e `instalar.sh` para la VM.

## Configuración

Modelo, modo de pensamiento y precios en `backend/llm.json` (en el repo: se cambia con un despliegue común; si se
cambia de modelo, actualizar los precios, que alimentan el tope de gasto). La clave va en `.env` (`LLM_API_KEY`, ver
`.env.example`), que no se versiona ni se copia en las actualizaciones.

## Topes y registro

- Tope por persona: `preguntas_por_persona_por_dia` por dirección de origen (la que pasa nginx en `X-Real-IP`).
- Tope global: `usd_por_dia` de gasto en el modelo, calculado con el uso que informa la API. Al llegar, el servicio deja
  una línea `AVISO:` en `journalctl -u asistente-dev-ia` y hasta el día siguiente responde con el contacto.
- Opiniones: debajo de cada respuesta hay 👍 / 👎 y, con 👎, un comentario opcional. Llegan a `/dev-ia/api/opinion`
  con una clave al azar que el backend manda en el evento `fin` y quedan en la misma fila de la pregunta.
- Registro: cada pregunta con fecha, secciones recuperadas, si la respuesta derivó al contacto (indicio de un dato que
  falta en el sitio), tokens, costo y tiempos. Sin la dirección de origen (el contador usa un hash con sal diaria) y
  con correos y números de 7 dígitos o más reemplazados. Se borra a los `dias_registro` días. En la VM está en
  `/var/lib/asistente-dev-ia/asistente.sqlite3` (grupo del servicio); en desarrollo, en `datos/`.

```
bash despliegue/preguntas.sh --dias 30          # resumen: por día, derivadas, secciones más usadas, últimas
bash despliegue/preguntas.sh --csv > preguntas.csv
```

## Desarrollo

```
python3 -m venv .venv && .venv/bin/pip install torch -r requirements.txt
SITIO_DIR=../.. .venv/bin/python -m uvicorn backend.app:app --port 8020
```

Con `SITIO_DIR` el backend sirve también el sitio estático: la portada queda en http://localhost:8020/dev-ia/.

## Evaluación

- `ingesta/evaluar.py`: recuperación. Si las secciones esperadas quedan entre las K de cada pregunta de prueba. No
  llama al modelo.
- `ingesta/evaluar_respuestas.py`: respuestas, con el backend corriendo. Chequeos deterministas sobre 25 preguntas:
  citas solo a secciones recibidas, montos, porcentajes, horas y fechas que aparecen tal cual en la sección citada,
  respuestas con datos que citan, derivación al contacto cuando el sitio no tiene el dato, y consultas ajenas o
  intentos de cambiar las reglas que vuelven al tema. Llama al modelo de verdad (unos USD 0,20 por corrida).

```
.venv/bin/python ingesta/evaluar.py
.venv/bin/python ingesta/evaluar_respuestas.py -v      # -v muestra cada respuesta
```

Correr las dos antes de desplegar un cambio de prompt, de modelo o del índice.

## Cuando cambia el contenido del sitio

```
.venv/bin/python ingesta/extraer_sitio.py ../../dev-ia
.venv/bin/python ingesta/indexar.py
.venv/bin/python ingesta/evaluar.py
```

Para el laboratorio (también cuando hay una entrada nueva en el blog o una publicación nueva):

```
.venv/bin/python ingesta/licdia/extraer.py ../..
.venv/bin/python ingesta/indexar.py indice-licdia
.venv/bin/python ingesta/evaluar.py indice-licdia
```

Así se prueban los cambios en la Mac. Los índices que usa el servicio no viajan con el código: los arma la VM (ver
«Reindexado automático»).

## Reindexado automático

`despliegue/reindexar.sh` rearma los dos índices en la VM desde el sitio publicado (`/var/www/html`, más la
documentación de Liminar por el proxy de la UNLu), sin sudo. Lo corre:

- el cron del usuario administrador, todos los días a las 4:30
  (`30 4 * * * bash /opt/asistente-dev-ia/despliegue/reindexar.sh >> /home/administrador/reindexar.log 2>&1`);
- `actualizar.sh`, al final de cada despliegue, con `--reiniciar`.

Trabaja sobre una copia del código en `/var/tmp`: extrae, indexa y corre las preguntas de prueba de cada asistente
(`ingesta/evaluar.py` termina con error si falla alguna). Solo si pasan todas y el índice cambió, lo copia a
`/opt/asistente-dev-ia` y reinicia el servicio (unos 40 s sin asistente mientras carga los modelos). Si algo falla, el
asistente sigue con los índices anteriores y el motivo queda en `/home/administrador/reindexar.log`. Si el contenido
no cambió, termina en segundos.

Cada índice guarda `cache-vectores.npz` (texto → vector): solo se calculan las secciones nuevas o cambiadas, porque en
la CPU de la VM cada una tarda unos 2,5 s. Una corrida desde cero lleva unos 30 minutos; con la caché, entre 10 y 20
(la mayor parte es la evaluación). Para pausar el reindexado diario: `crontab -e` en la VM y comentar la línea.

## Despliegue en la VM

Primera instalación, o cambios de dependencias o de la unidad de systemd (por ejemplo, el paso al SDK de Anthropic y
la carpeta de datos de los topes y el registro): copiar el proyecto (sin `.venv`, `.env` ni
cachés) a `~/asistente-dev-ia` en la VM y correr `sudo bash ~/asistente-dev-ia/despliegue/instalar.sh`. Código e
índice, sin sudo: `bash despliegue/actualizar.sh` desde la Mac con la VPN conectada. El servicio queda en `/opt/asistente-dev-ia` con usuario
propio, en el puerto 8030 local, detrás de nginx en `/dev-ia/api/`, con límite de tasa y tope de memoria de 2,5 GB.
