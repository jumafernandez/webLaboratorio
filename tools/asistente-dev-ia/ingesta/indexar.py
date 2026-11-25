"""Calcula los embeddings de las secciones extraídas (indice/secciones.json) y los guarda normalizados.

El backend usa el mismo modelo para la pregunta, así que la similitud coseno es el producto interno.
Modelo por defecto: intfloat/multilingual-e5-base (768 dimensiones, ~1,1 GB en memoria). Se eligió en lugar de BGE-M3
(~2,5 GB) por la memoria de la VM; con 20 preguntas de prueba ambos traen la sección correcta entre las 6 recuperadas
en las 20. Los modelos e5 esperan los prefijos "query: " y "passage: ".
Uso: .venv/bin/python ingesta/indexar.py [carpeta]   (otro modelo: EMB_MODEL, EMB_PREFIJO_CONSULTA, EMB_PREFIJO_PASAJE)
La carpeta es la del índice: indice (la diplomatura, por defecto) o indice-licdia (el laboratorio); las expansiones
salen de ingesta/expansiones.json o de ingesta/licdia/expansiones.json. Los dos índices tienen que usar el mismo
modelo, porque el backend lo carga una sola vez.
Escribe <carpeta>/embeddings.npy (float32, una fila por sección, en el orden del JSON), modelo.json y pca.npz.
Guarda además <carpeta>/cache-vectores.npz (texto → vector) y en la corrida siguiente solo calcula las secciones nuevas
o cambiadas: en la CPU de la VM cada sección tarda unos 2,5 s, y el reindexado diario casi no cambia nada.
"""

import hashlib

import json
import os
import pathlib
import sys

import numpy as np
from sentence_transformers import SentenceTransformer

RAIZ = pathlib.Path(__file__).resolve().parents[1]


def main():
    modelo = os.environ.get("EMB_MODEL", "intfloat/multilingual-e5-base")
    e5 = "e5" in modelo
    pref_q = os.environ.get("EMB_PREFIJO_CONSULTA", "query: " if e5 else "")
    pref_p = os.environ.get("EMB_PREFIJO_PASAJE", "passage: " if e5 else "")
    indice = RAIZ / (sys.argv[1] if len(sys.argv) > 1 else "indice")
    datos = json.loads((indice / "secciones.json").read_text(encoding="utf-8"))
    # Expansión de documentos: sinónimos que el sitio no usa ("precio" donde dice "aranceles"), solo para el embedding
    f_exp = RAIZ / "ingesta" / ("licdia/expansiones.json" if indice.name == "indice-licdia" else "expansiones.json")
    exp = {k: v for k, v in (json.loads(f_exp.read_text(encoding="utf-8")) if f_exp.exists() else {}).items()
           if not k.startswith("_")}

    def extra(titulo):
        return "".join(v + "\n" for k, v in exp.items() if k in titulo)

    textos = [f"{pref_p}{s['titulo']}\n{extra(s['titulo'])}{s['texto']}" for s in datos["secciones"]]
    # Caché por texto exacto (incluye prefijo, expansión y modelo): lo que no cambió no se vuelve a calcular
    claves = [hashlib.sha1(f"{modelo}\n{t}".encode("utf-8")).hexdigest() for t in textos]
    f_cache = indice / "cache-vectores.npz"
    cache = {}
    if f_cache.exists():
        c = np.load(f_cache)
        cache = dict(zip(c["claves"].tolist(), c["vectores"]))
    faltan = [i for i, k in enumerate(claves) if k not in cache]
    if faltan:
        nuevos = SentenceTransformer(modelo, device="cpu").encode([textos[i] for i in faltan], normalize_embeddings=True,
                                                                  batch_size=16, show_progress_bar=False)
        for i, v in zip(faltan, nuevos):
            cache[claves[i]] = v
    E = np.stack([cache[k] for k in claves]).astype(np.float32)
    np.savez(f_cache, claves=np.array(claves), vectores=E)   # solo las secciones actuales
    print(f"{len(faltan)} de {len(textos)} secciones calculadas (el resto, de la caché)")
    np.save(indice / "embeddings.npy", E)
    (indice / "modelo.json").write_text(json.dumps({"modelo": modelo, "prefijo_consulta": pref_q,
                                                            "prefijo_pasaje": pref_p}, ensure_ascii=False) + "\n", encoding="utf-8")
    # Proyección a 3D por PCA para el mapa de la interfaz. Es lineal: el backend proyecta la pregunta con la
    # misma media y los mismos ejes, así que su posición en el mapa es la real.
    media = E.mean(0)
    _, S, Vt = np.linalg.svd(E - media, full_matrices=False)
    ejes = Vt[:3]
    P = (E - media) @ ejes.T
    escala = float(np.abs(P).max())
    np.savez(indice / "pca.npz", media=media.astype(np.float32), ejes=ejes.astype(np.float32),
             escala=np.float32(escala))
    var = (S[:3] ** 2).sum() / (S ** 2).sum()
    print(f"{E.shape[0]} secciones × {E.shape[1]} dimensiones con {modelo}; PCA 3D explica {var:.0%} de la varianza")


if __name__ == "__main__":
    main()
