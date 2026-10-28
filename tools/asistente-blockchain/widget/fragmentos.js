// Class clips (blockchain-dev/fragmentos/fragmentos.json): the catalog, what this visitor watched (in the game or on
// the landing page, kept in localStorage) and a hook so the game can follow up when a clip ends. The agent gets the
// watched list in the game state and knows what each teacher says in them (backend/app.py, FRAGMENTOS).

export const FRAG_DIR = "/blockchain-dev/fragmentos/";
const CLAVE = "bcw-fragmentos";
const MAX = 20;

let pedido = null;
export function catalogo() {
  pedido ||= fetch(`${FRAG_DIR}fragmentos.json`, { cache: "no-cache" })
    .then((r) => (r.ok ? r.json() : { fragmentos: [] }))
    .then((d) => d.fragmentos || [])
    .catch(() => {
      pedido = null; // a network failure must not leave the game without clips for the whole visit
      return [];
    });
  return pedido;
}

const leer = () => {
  try {
    return JSON.parse(localStorage.getItem(CLAVE)) || {};
  } catch {
    return {};
  }
};
const guardar = (v) => {
  try {
    localStorage.setItem(CLAVE, JSON.stringify(v));
  } catch {
    /* no storage: the watched list lasts for this page */
  }
};

// For the agent: most recent first, {id, segundos, completo}
export function vistos() {
  return Object.entries(leer())
    .sort((a, b) => (b[1].t || 0) - (a[1].t || 0))
    .slice(0, MAX)
    .map(([id, v]) => ({ id, segundos: Math.min(3600, Math.round(v.s || 0)), completo: !!v.c }));
}

const oyentes = new Set();
// f(id, video) runs once per <video> when it ends, or when it is paused past half its length
export function alTerminar(f) {
  oyentes.add(f);
  return () => oyentes.delete(f);
}

// Follows one <video>: the furthest second reached and whether it was watched to the end (90% counts).
export function seguir(video, id) {
  if (!id || video.dataset.fragSeguido) return;
  video.dataset.fragSeguido = "1";
  let ultimo = 0;
  let avisado = false;
  const anotar = () => {
    const todos = leer();
    const antes = todos[id] || { s: 0, c: false };
    const fin = video.ended || (video.duration > 0 && video.currentTime >= video.duration * 0.9);
    todos[id] = { s: Math.max(antes.s || 0, video.currentTime || 0), c: !!(antes.c || fin), t: Date.now() };
    const claves = Object.keys(todos).sort((a, b) => (todos[b].t || 0) - (todos[a].t || 0));
    for (const k of claves.slice(MAX)) delete todos[k];
    guardar(todos);
  };
  const avisar = () => {
    if (avisado) return;
    avisado = true;
    for (const f of oyentes) f(id, video);
  };
  video.addEventListener("timeupdate", () => {
    if (Date.now() - ultimo > 3000) {
      ultimo = Date.now();
      anotar();
    }
  });
  video.addEventListener("pause", () => {
    anotar();
    if (!video.ended && video.duration > 0 && video.currentTime >= video.duration / 2) avisar();
  });
  video.addEventListener("ended", () => {
    anotar();
    avisar();
  });
}

// Landing page: every <video data-frag> of the normal site counts too, so the agent knows it when the game opens.
export function seguirPagina(raiz = document) {
  raiz.addEventListener(
    "play",
    (e) => {
      const v = e.target;
      if (v instanceof HTMLVideoElement && v.dataset.frag) seguir(v, v.dataset.frag);
    },
    true,
  );
}
