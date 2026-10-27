// Anonymous conversion funnel (backend/medicion.py). One random session id per tab (sessionStorage), event names
// from a fixed list and a few short identifiers as data: never visitor text, never the address. Off when the browser
// sends Do Not Track, for the team's own browsers (esEquipo) or /estado says "medicion": false. Events wait in memory until /estado answers, so nothing is
// sent when the backend is missing. Nothing here may ever throw into the game.

const URL_M = "/blockchain-dev/api/m";
const KEY = "bcw-sesion";
const MAX_COLA = 40;

const dnt = (() => {
  try {
    return navigator.doNotTrack === "1" || window.doNotTrack === "1";
  } catch {
    return false;
  }
})();

// The team's own visits stay out of the funnel: opening any page with ?bcw_equipo=1 sets a flag in this browser
// (localStorage), ?bcw_equipo=0 clears it. While it is set the widget sends no metrics at all.
const EQUIPO = "bcw-equipo";
export const esEquipo = (() => {
  try {
    const q = new URLSearchParams(location.search).get("bcw_equipo");
    if (q === "1") localStorage.setItem(EQUIPO, "1");
    else if (q === "0") localStorage.removeItem(EQUIPO);
    return localStorage.getItem(EQUIPO) === "1";
  } catch {
    return false;
  }
})();
if (esEquipo) console.info("Diplomatura Blockchain: visita del equipo, sin medición. ?bcw_equipo=0 la vuelve a activar.");

let activa = dnt || esEquipo ? false : null; // null = waiting for /estado
let cola = [];
let sesion = null;

function idSesion() {
  if (sesion) return sesion;
  try {
    sesion = sessionStorage.getItem(KEY);
  } catch {
    /* no storage: the id lasts for this page */
  }
  if (!sesion || !/^[0-9a-f]{16,32}$/.test(sesion)) {
    const b = crypto.getRandomValues(new Uint8Array(16));
    sesion = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
    try {
      sessionStorage.setItem(KEY, sesion);
    } catch {
      /* idem */
    }
  }
  return sesion;
}

// Same rules as the backend: ≤6 flat keys, booleans, finite numbers, short identifiers.
function limpiar(datos) {
  const out = {};
  if (!datos || typeof datos !== "object") return out;
  for (const [k, v] of Object.entries(datos).slice(0, 6)) {
    if (typeof v === "boolean") out[k] = v;
    else if (typeof v === "number" && Number.isFinite(v) && Math.abs(v) < 1e9) out[k] = v;
    else if (typeof v === "string") out[k] = v.replace(/[^\p{L}\p{N}_.:#/ -]/gu, "").slice(0, 60);
  }
  return out;
}

function enviar(cuerpo) {
  try {
    const json = JSON.stringify(cuerpo);
    if (navigator.sendBeacon && navigator.sendBeacon(URL_M, new Blob([json], { type: "text/plain" }))) return;
    fetch(URL_M, { method: "POST", body: json, keepalive: true, headers: { "Content-Type": "text/plain" } }).catch(() => {});
  } catch {
    /* metrics never break the game */
  }
}

// Session id to hand to the server (it writes pregunta_agente itself); null when nothing is being measured.
export function sesionMedicion() {
  try {
    return activa === false ? null : idSesion();
  } catch {
    return null;
  }
}

export function track(evento, datos) {
  try {
    if (activa === false) return;
    const cuerpo = { sesion: idSesion(), evento: String(evento), datos: limpiar(datos) };
    if (activa) enviar(cuerpo);
    else if (cola.length < MAX_COLA) cola.push(cuerpo);
  } catch {
    /* idem */
  }
}

// Called once with /estado's answer (or false when /estado failed).
export function configurarMedicion(on) {
  try {
    activa = !dnt && !esEquipo && !!on;
    const pendientes = cola;
    cola = [];
    if (activa) for (const c of pendientes) enviar(c);
  } catch {
    /* idem */
  }
}

// pagehide: when /estado has not answered yet, the queued events (the visit, an early abandon) would be lost with the
// page. They go out best-effort; if metrics turn out to be off, the backend answers 204 without storing anything.
export function vaciarAlSalir() {
  try {
    if (activa !== null || dnt || esEquipo || !cola.length) return;
    const pendientes = cola;
    cola = [];
    for (const c of pendientes) enviar(c);
  } catch {
    /* idem */
  }
}
