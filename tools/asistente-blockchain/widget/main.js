/* Blockchain assistant widget, entry point: only the launcher button. Everything heavy (the game panel, the levels,
 * the animated background, the chain code; see app.js) is loaded the first time the visitor opens the game, so the
 * normal site is what loads first. The page tags stay the same: one stylesheet and this module.
 *
 * The game opens when the visitor asks for it: the launcher, a [data-bcw-nivel] button on the page, ?bcw=open or
 * ?bcw=<level> in a link, or a saved "juego" preference (kept in localStorage when the visitor chose the game).
 * ?vista=sitio always starts on the site.
 */

import { configurarMedicion, track, vaciarAlSalir } from "./medicion.js";

const API = "/blockchain-dev/api";
const PREF = "bcw-vista";
const LEVELS = ["c1", "c2", "c3", "c4", "nft", "hack"];

const readPref = () => {
  try {
    return localStorage.getItem(PREF);
  } catch {
    return null;
  }
};

const launcher = document.createElement("button");
launcher.className = "bcw-launcher";
launcher.type = "button";
launcher.innerHTML = '<span class="bcw-cubes">⛓️</span><span class="bcw-ltxt">Jugá a la blockchain</span>';
launcher.setAttribute("aria-haspopup", "dialog");
document.body.append(launcher);

// ---------- lazy load of the game ----------
let appPromise = null;
function cargar() {
  appPromise ??= import("./app.js").catch((e) => {
    appPromise = null; // a network failure must not leave the launcher dead: the next click tries again
    throw e;
  });
  return appPromise;
}
async function conJuego(fn) {
  launcher.setAttribute("aria-busy", "true");
  try {
    fn(await cargar());
  } catch {
    /* the site keeps working; the visitor can click again */
  } finally {
    launcher.removeAttribute("aria-busy");
  }
}
const calentar = () => cargar().catch(() => {}); // pointer or focus on the launcher: start downloading before the click
launcher.addEventListener("pointerenter", calentar, { once: true });
launcher.addEventListener("focus", calentar, { once: true });
launcher.addEventListener("click", () => conJuego((app) => app.abrir(true)));

// A button of the normal site that plays a level right there (data-bcw-nivel="c1"…, "red" for the live-network card).
document.addEventListener("click", (e) => {
  const b = e.target.closest?.("[data-bcw-nivel]");
  if (!b || b.closest(".bcw-panel")) return;
  const id = b.dataset.bcwNivel;
  if (!LEVELS.includes(id) && id !== "red") return;
  e.preventDefault();
  conJuego((app) => app.playFromPage(id));
});

// ---------- how this visit starts ----------
const linked = new URLSearchParams(location.search).get("bcw");
const forcedSite = /[?&]vista=sitio/.test(location.search);
const startsInGame = LEVELS.includes(linked) || linked === "open" || (!forcedSite && readPref() === "juego");

// One "visita" per session, wherever it starts: it is the funnel's denominator (queued until /estado answers).
(() => {
  let seen = false;
  try {
    seen = sessionStorage.getItem("bcw-visita") === "1";
    sessionStorage.setItem("bcw-visita", "1");
  } catch {
    /* no storage: one per page view */
  }
  if (!seen) track("visita", { vista: startsInGame ? "juego" : "sitio" });
})();

// Metrics need /estado's answer (the backend may have them off). app.js asks again when the game opens.
const sinJuego = () =>
  fetch(`${API}/estado`)
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status))))
    .then((d) => configurarMedicion(d.medicion !== false))
    .catch(() => configurarMedicion(false));
addEventListener("pagehide", vaciarAlSalir);

if (startsInGame) {
  // Linked level, ?bcw=open or the saved preference: the game opens right away (and /estado comes with it).
  conJuego((app) => (LEVELS.includes(linked) ? app.playFromPage(linked) : app.abrir(false)));
  sinJuego();
} else if (document.readyState === "complete") {
  sinJuego();
} else {
  addEventListener("load", () => setTimeout(sinJuego, 0), { once: true });
}
