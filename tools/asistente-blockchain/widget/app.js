/* Blockchain assistant widget, the heavy part: a game where every course of the diploma is a level.
 *
 * Loaded on demand by main.js (the small launcher) the first time the visitor opens the game. It builds the panel,
 * and behaves as a modal dialog while open: focus trap, Escape closes, the rest of the page is inert, and focus goes
 * back to whatever opened it.
 *
 * Chat on the left, a live "stage" on the right. Scripted chips drive the levels; free text goes to the Claude
 * agent (backend/app.py), which answers from the site content and drives the stage through tool calls
 * (start a level, show a page of the site, scroll the real page, suggest next steps). Without backend the widget
 * falls back to keyword routing, so the page never breaks.
 *
 * Flows: every level, topic or agent turn runs as a "flow". Starting a new one cancels the previous: its pending
 * question resolves, and any later ctx call throws CANCEL, so long animations stop by themselves.
 */

import { addBlock, chain, onBlock, ready } from "./cadena.js";
import * as real from "./cadena-real.js";
import { buildDentro, renderAgente, renderCadena } from "./dentro.js";
import { buildRed, contratosEnSitio, renderRed, vigilarBloque } from "./red.js";
import { startFondo } from "./fondo.js";
import { BADGES, LEVELS, BONUS, badgeSVG, progressEl } from "./juego.js";
import { configurarMedicion, esEquipo, sesionMedicion, track, vaciarAlSalir } from "./medicion.js";
import { SITE_TOPICS, showSite, planScene } from "./sitio.js";
import { MOBILE, POINT, REDUCE, WAITLIST_URL, esc, h, md, norm, randHex, short, sleep } from "./util.js";
import nivel1 from "./niveles/nivel1-bloques.js";
import nivel2 from "./niveles/nivel2-token.js";
import nivel3 from "./niveles/nivel3-red.js";
import nivel4 from "./niveles/nivel4-pasarela.js";
import bonusNft from "./niveles/bonus-nft.js";
import bonusHack from "./niveles/bonus-hack.js";

const API = "/blockchain-dev/api";
const PLAY = { c1: nivel1, c2: nivel2, c3: nivel3, c4: nivel4, nft: bonusNft, hack: bonusHack };
const CANCEL = Symbol("cancel");

// ---------- state ----------
const S = {
  wallet: null,
  balances: {}, // symbol -> amount
  nfts: [], // {svg, name, id, kind}
  badges: new Set(),
  log: [],
  history: [], // {rol, texto} sent to the agent
  flow: 0,
  pending: null, // {kind: "choose"|"ask", resolve, onInput, row}
  current: null, // level id being played
  started: false,
  ai: null, // null = unknown, true/false after /estado
  closingShown: false,
  lastTurn: null, // what the agent did on the last question, for "Ver por dentro"
  run: null, // level being played, for the funnel: {id, paso, fin}
  entered: false, // first interaction with the game already counted
  visited: false,
};

// ---------- DOM ----------
// The game opens on demand (main.js): from the launcher, the "Juego" selector, ?bcw=open, a level link, or a saved
// "juego" preference. "Sitio convencional" closes it and the choice is remembered.
const PREF = "bcw-vista";
const savePref = (v) => {
  try {
    localStorage.setItem(PREF, v);
  } catch {
    /* no storage: the choice lasts for this visit */
  }
};

// The launcher belongs to main.js (it exists before this module is loaded).
const launcher = document.querySelector(".bcw-launcher");
const panel = h("div", "bcw-panel");
panel.setAttribute("role", "dialog");
panel.setAttribute("aria-modal", "true");
panel.setAttribute("aria-label", "Juego de la Diplomatura en Blockchain");
panel.tabIndex = -1;
panel.inert = true; // closed: out of the keyboard order and the accessibility tree
panel.innerHTML = `
  <canvas class="bcw-fondo" aria-hidden="true"></canvas>
  <div class="bcw-head">
    <span class="bcw-logo">⛓️</span>
    <div class="bcw-id"><div class="bcw-title">Diplomatura en Blockchain</div><div class="bcw-sub">Juego · LICDIA · UNLu <span class="bcw-ai" hidden>· con Claude</span></div></div>
    <div class="bcw-progress-slot"></div>
    <button class="bcw-badge bcw-llama" type="button" aria-expanded="false" aria-controls="bcw-redpop" aria-label="DEMO · cadena simulada. Qué red usa el juego" title="¿Qué red usa el juego?"><span class="bcw-btxt">DEMO · cadena simulada</span><span class="bcw-bq" aria-hidden="true">?</span></button>
    <button class="bcw-iconbtn bcw-home" type="button" aria-label="Mapa del juego" title="Mapa del juego">🗺️</button>
    <button class="bcw-dentro-btn bcw-llama" type="button" aria-expanded="false" aria-controls="bcw-dentro"><span class="bcw-eye"></span><span class="bcw-dtxt">Ver por dentro</span></button>
    <div class="bcw-selector" role="group" aria-label="Vista de la página">
      <button type="button" data-v="juego" aria-pressed="true">Juego</button><button type="button" data-v="sitio" aria-pressed="false" aria-label="Sitio convencional">Sitio<span class="bcw-sel-largo"> convencional</span></button>
    </div>
  </div>
  <div class="bcw-hero">
    <h2>No te voy a explicar blockchain.<br><span>La vas a jugar.</span></h2>
    <p>Cada curso de la diplomatura es un nivel que pasa en una blockchain de verdad, corriendo en tu navegador. O preguntame lo que quieras de la cursada.</p>
    <form class="bcw-heroform"><input type="text" autocomplete="off" maxlength="300" aria-label="Tu pregunta" placeholder="${MOBILE ? "Ej: soy contador, ¿me sirve?" : "Por ejemplo: soy contador, ¿esto me sirve?"}"><button type="submit" aria-label="Enviar">→</button></form>
    <div class="bcw-herochips"></div>
    <p class="bcw-aviso">Respuestas generadas con IA a partir del contenido de este sitio: pueden tener errores. La cadena del juego es real; wallet, transacciones y NFTs son simulados. Guardamos las preguntas, sin datos de quién las hace, para mejorar el sitio.</p>
  </div>
  <div class="bcw-chat">
    <div class="bcw-msgs" role="log" aria-live="polite" aria-relevant="additions text" aria-label="Conversación"></div>
    <form class="bcw-form"><input type="text" autocomplete="off" maxlength="300" placeholder="Preguntame lo que quieras…" aria-label="Mensaje"><button type="submit">Enviar</button></form>
  </div>
  <div class="bcw-stage"><div class="bcw-sr" role="status" aria-live="assertive"></div><div class="bcw-scene"></div><button class="bcw-log" type="button">🧾 Lo que hiciste hoy <span class="bcw-count">0</span></button></div>`;
const msgs = panel.querySelector(".bcw-msgs");
const form = panel.querySelector(".bcw-form");
const input = form.querySelector("input");
const stage = panel.querySelector(".bcw-stage");
const logBtn = panel.querySelector(".bcw-log");
const progressSlot = panel.querySelector(".bcw-progress-slot");
const dentro = buildDentro();
const redPop = buildRed();
panel.append(dentro, redPop);
document.body.append(panel);
const fondo = startFondo(panel.querySelector(".bcw-fondo"));
fondo.stop();

function renderProgress() {
  progressSlot.replaceChildren(progressEl(S.badges));
}
renderProgress();

// Modal behaviour: while the game is open the rest of the page is inert (nothing behind it can take focus), Tab stays
// inside, Escape closes, and focus returns to the element that opened it.
let opener = null;
let inertidos = [];
function fondoInerte(on) {
  if (on) {
    inertidos = [...document.body.children].filter((el) => el !== panel && !el.inert && !/^(SCRIPT|STYLE|LINK)$/.test(el.tagName));
    for (const el of inertidos) el.inert = true;
  } else {
    for (const el of inertidos) el.inert = false;
    inertidos = [];
  }
}
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';
function focoVisible() {
  return [...panel.querySelectorAll(FOCUSABLE)].filter((el) => !el.closest("[inert], [hidden]") && el.getClientRects().length > 0);
}
function atraparTab(e) {
  if (e.key !== "Tab" || !panel.classList.contains("bcw-open")) return;
  const items = focoVisible();
  if (!items.length) {
    e.preventDefault();
    panel.focus({ preventScroll: true });
    return;
  }
  const first = items[0];
  const last = items[items.length - 1];
  const dentroDelPanel = panel.contains(document.activeElement);
  if (!dentroDelPanel || (e.shiftKey && (document.activeElement === first || document.activeElement === panel))) {
    e.preventDefault();
    (e.shiftKey ? last : first).focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}
document.addEventListener("keydown", atraparTab);

function openGame(byUser) {
  const yaAbierto = panel.classList.contains("bcw-open");
  // A return only if the game was already on screen earlier in this page view.
  if (byUser && S.visited && !yaAbierto) track("volver_juego");
  S.visited = true;
  if (!yaAbierto) {
    opener = document.activeElement && document.activeElement !== document.body && !panel.contains(document.activeElement) ? document.activeElement : launcher;
    panel.inert = false;
    fondoInerte(true);
  }
  panel.classList.add("bcw-open");
  document.documentElement.classList.add("bcw-locked");
  launcher.style.display = "none";
  panel.querySelectorAll(".bcw-selector button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === "juego")));
  if (byUser) savePref("juego");
  fondo.start();
  S.started = true;
  // Phones: the keyboard would cover the stage, so focus lands on the dialog itself. Elsewhere, on the input.
  setTimeout(() => {
    if (!panel.classList.contains("bcw-open")) return;
    (MOBILE ? panel : panel.classList.contains("bcw-playing") ? input : heroInput).focus({ preventScroll: true });
  }, 250);
}
function toSite(byUser) {
  const estabaAbierto = panel.classList.contains("bcw-open");
  if (byUser && estabaAbierto) track("sitio_convencional");
  panel.classList.remove("bcw-open");
  document.documentElement.classList.remove("bcw-locked");
  launcher.style.display = "";
  launcher.querySelector(".bcw-ltxt").textContent = S.started ? "Volver al juego" : "Jugá a la blockchain";
  if (byUser) savePref("sitio");
  fondo.stop();
  if (!estabaAbierto) return;
  panel.inert = true;
  fondoInerte(false);
  const destino = opener && document.contains(opener) && opener.getClientRects().length ? opener : launcher;
  opener = null;
  destino.focus({ preventScroll: true });
}
panel.querySelector(".bcw-selector").addEventListener("click", (e) => {
  if (e.target.closest("button")?.dataset.v === "sitio") toSite(true);
});
panel.querySelector(".bcw-home").addEventListener("click", () => {
  startPlaying("mapa");
  startFlow(backToMap);
});
// ---------- "Base Sepolia · en vivo": what the network is ----------
const badgeBtn = panel.querySelector(".bcw-badge");
function toggleRed(on) {
  const open = on ?? redPop.hidden;
  if (open === !redPop.hidden) return;
  redPop.hidden = !open;
  badgeBtn.setAttribute("aria-expanded", String(open));
  vigilarBloque(redPop, open);
  if (!open) return;
  badgeBtn.classList.remove("bcw-llama");
  marcarVisto(RED_VISTA);
  renderRed(redPop, {
    onVerTxs: () => {
      toggleRed(false);
      toggleDentro(true);
      pickTab("cadena");
    },
  });
  redPop.querySelector(".bcw-redx").addEventListener("click", () => {
    toggleRed(false);
    badgeBtn.focus();
  });
  track("ver_red");
  setTimeout(() => redPop.querySelector("summary")?.focus({ preventScroll: true }), 60);
}
badgeBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  toggleRed();
});
document.addEventListener("click", (e) => {
  if (!redPop.hidden && !redPop.contains(e.target)) toggleRed(false);
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !redPop.hidden) {
    e.preventDefault();
    toggleRed(false);
    badgeBtn.focus();
    return;
  }
  if (e.key === "Escape" && panel.classList.contains("bcw-dentro-open")) {
    e.preventDefault();
    toggleDentro(false);
    dentroBtn.focus();
    return;
  }
  // Last: Escape closes the game itself, like any modal dialog.
  if (e.key === "Escape" && panel.classList.contains("bcw-open") && !e.defaultPrevented) {
    e.preventDefault();
    toSite(true);
  }
});
// Every waitlist link of the game counts as a conversion click (origen = where it was shown).
panel.addEventListener("click", (e) => {
  const a = e.target.closest?.(`a[href="${WAITLIST_URL}"]`);
  if (a) track("lista_espera_click", { origen: a.dataset.origen || "otro" });
});
// Leaving the page in the middle of a level is an abandon too (sendBeacon survives pagehide).
addEventListener("pagehide", () => {
  abandon();
  vaciarAlSalir(); // events still waiting for /estado go out best-effort
});
logBtn.addEventListener("click", () => logScene());

// ---------- hero ----------
const heroInput = panel.querySelector(".bcw-heroform input");
function startPlaying(fuente) {
  if (!S.entered && fuente) {
    S.entered = true;
    track("entro_juego", { fuente });
  }
  if (panel.classList.contains("bcw-playing")) return;
  panel.classList.add("bcw-playing");
  fondo.setMode("juego");
  if (!msgs.children.length) {
    const hi = "👋 Soy el asistente de la **Diplomatura en Blockchain**. Acá la blockchain se juega: cada curso es un nivel.";
    msgs.append(h("div", "bcw-msg bcw-bot", md(hi)));
    S.history.push({ rol: "asistente", texto: hi.replace(/\*\*/g, "") });
  }
}
function heroGo(label, fn, fuente) {
  startPlaying(fuente);
  userSay(label);
  startFlow(async (ctx) => {
    mapScene(ctx);
    await fn(ctx);
  });
}
const HERO_CHIPS = [
  { l: "▶️ Jugar el Nivel 1", f: (ctx) => ctx.play("c1") },
  { l: "🗺️ Ver los 4 niveles", f: welcomeRest },
  { l: "💰 ¿Cuánto sale?", q: true },
  { l: "🧑‍💻 ¿Necesito saber programar?", q: true },
  { l: "👩‍🏫 ¿Quiénes son los docentes?", q: true },
  { l: "⚖️ Soy abogada, ¿me sirve?", q: true },
];
for (const c of HERO_CHIPS) {
  const b = h("button", "bcw-chip", esc(c.l));
  b.type = "button";
  const text = c.l.replace(/^\S+\s/, "");
  b.addEventListener("click", () => heroGo(c.q ? text : c.l, c.q ? (ctx) => route(ctx, text) : c.f, "chip"));
  panel.querySelector(".bcw-herochips").append(b);
}
panel.querySelector(".bcw-heroform").addEventListener("submit", (e) => {
  e.preventDefault();
  const v = heroInput.value.trim();
  if (!v) return;
  heroInput.value = "";
  heroGo(v, (ctx) => route(ctx, v), "texto");
});

// Some background traffic while the hero is on screen, so the carousel shows blocks being mined.
const AMBIENT = ["gm desde Córdoba ☀️", "Hola desde Rosario", "Probando Web3", "Saludos desde Mendoza", "Primer bloque del día"];
setInterval(() => {
  if (!REDUCE && panel.classList.contains("bcw-open") && !panel.classList.contains("bcw-playing") && chain.length < 12)
    addBlock(AMBIENT[chain.length % AMBIENT.length], "Red");
}, 6500);
onBlock.add(() => {
  fondo.newBlock();
  if (panel.classList.contains("bcw-dentro-open") && dentroTab === "cadena") renderCadena(dentro.querySelector(".bcw-dbody"));
});
real.onTx.add(() => {
  if (panel.classList.contains("bcw-dentro-open") && dentroTab === "cadena") renderCadena(dentro.querySelector(".bcw-dbody"));
  llamarDentro();
});

// ---------- ver por dentro ----------
let dentroTab = "cadena";
const dentroBtn = panel.querySelector(".bcw-dentro-btn");
function renderDentro() {
  dentro.querySelectorAll(".bcw-dtabs button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.t === dentroTab)));
  const body = dentro.querySelector(".bcw-dbody");
  if (dentroTab === "cadena") renderCadena(body);
  else renderAgente(body, S.lastTurn, S.stats?.modelo);
}
// "Ver por dentro" and the network badge blink until opened, once per visit (sessionStorage), and "Ver por dentro"
// again when there is something new inside.
const DENTRO_VISTO = "bcw-dentro-visto";
const RED_VISTA = "bcw-red-vista";
const visto = (k) => {
  try {
    return sessionStorage.getItem(k) === "1";
  } catch {
    return false; /* no storage: keep calling */
  }
};
const marcarVisto = (k) => {
  try {
    sessionStorage.setItem(k, "1");
  } catch {
    /* no storage */
  }
};
if (visto(DENTRO_VISTO)) dentroBtn.classList.remove("bcw-llama");
if (visto(RED_VISTA)) badgeBtn.classList.remove("bcw-llama");
function llamarDentro() {
  if (!panel.classList.contains("bcw-dentro-open")) dentroBtn.classList.add("bcw-llama");
}
function toggleDentro(on) {
  const open = on ?? !panel.classList.contains("bcw-dentro-open");
  if (open) {
    dentroBtn.classList.remove("bcw-llama");
    marcarVisto(DENTRO_VISTO);
    toggleRed(false);
  }
  panel.classList.toggle("bcw-dentro-open", open);
  dentroBtn.setAttribute("aria-expanded", String(open));
  dentroBtn.querySelector(".bcw-dtxt").textContent = open ? "Cerrar" : "Ver por dentro";
  // Closed, the drawer is off screen: keep its tabs out of the keyboard order.
  dentro.inert = !open;
  if (open) {
    dentroTab = S.lastTurn ? "agente" : "cadena";
    renderDentro();
    track("ver_por_dentro", { tab: dentroTab });
    setTimeout(() => dentro.querySelector(`.bcw-dtabs [data-t="${dentroTab}"]`)?.focus({ preventScroll: true }), 60);
  }
}
dentro.id = "bcw-dentro";
dentro.inert = true;
dentroBtn.addEventListener("click", () => toggleDentro());
function pickTab(t, focus) {
  if (!t || t === dentroTab) return;
  dentroTab = t;
  renderDentro();
  track("ver_por_dentro", { tab: t });
  if (focus) dentro.querySelector(`.bcw-dtabs [data-t="${t}"]`)?.focus();
}
dentro.querySelector(".bcw-dtabs").addEventListener("click", (e) => pickTab(e.target.closest("button")?.dataset.t));
// Tablist keyboard pattern: arrows move between the two tabs.
dentro.querySelector(".bcw-dtabs").addEventListener("keydown", (e) => {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
  e.preventDefault();
  pickTab(dentroTab === "cadena" ? "agente" : "cadena", true);
});

// ---------- chat primitives (flow-independent) ----------
const scrollChat = () => (msgs.scrollTop = msgs.scrollHeight);
const plain = (s) => s.replace(/\*\*/g, "").replace(/<[^>]+>/g, "");

function typingBubble() {
  const m = h("div", "bcw-msg bcw-bot", '<span class="bcw-typing"><span></span><span></span><span></span></span>');
  msgs.append(m);
  scrollChat();
  return m;
}

function userSay(text) {
  const m = h("div", "bcw-msg bcw-user");
  m.textContent = text;
  msgs.append(m);
  S.history.push({ rol: "usuario", texto: text });
  scrollChat();
}

const clearChips = () => msgs.querySelectorAll(".bcw-chips").forEach((c) => c.remove());

function chipRow(list, onPick) {
  const row = h("div", "bcw-chips");
  for (const c of list) {
    const b = h("button", `bcw-chip${c.soon ? " bcw-soon" : ""}${c.primary ? " bcw-chip-primary" : ""}`, esc(c.l));
    b.type = "button";
    b.addEventListener("click", () => {
      clearChips();
      userSay(c.l);
      onPick(c);
    });
    row.append(b);
  }
  msgs.append(row);
  scrollChat();
  return row;
}

// Top-level chips: each one starts a new flow.
function menuChips(list) {
  chipRow(list, (c) => startFlow(c.f));
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const v = input.value.trim();
  if (!v) return;
  input.value = "";
  clearChips();
  userSay(v);
  // A question typed while a level waits for text goes to the agent (the level can be resumed from the map).
  if (S.pending?.kind === "ask" && !/\?\s*$/.test(v)) {
    const p = S.pending;
    S.pending = null;
    p.resolve(v);
  } else {
    startFlow((ctx) => route(ctx, v));
  }
});

input.addEventListener("input", () => {
  if (S.pending?.kind === "ask" && S.pending.onInput) S.pending.onInput(input.value);
});

// ---------- stage primitives ----------
function sceneEl(build) {
  const s = h("div", "bcw-scene");
  build(s);
  stage.querySelector(".bcw-scene").replaceWith(s);
  return s;
}

// Screen-reader announcement (badge awards, certificate).
function announce(text) {
  const sr = panel.querySelector(".bcw-sr");
  sr.textContent = "";
  setTimeout(() => (sr.textContent = text), 50);
}

function addLog(ic, t, d, href) {
  S.log.push({ ic, t, d, href });
  logBtn.querySelector(".bcw-count").textContent = S.log.length;
  logBtn.classList.remove("bcw-bump");
  void logBtn.offsetWidth;
  logBtn.classList.add("bcw-bump");
}

// ---------- real chain UI ----------
// Pending state of a real transaction, over the stage (it survives scene changes).
function pendingPill(text) {
  const p = h("div", "bcw-pending", `<span class="bcw-spin"></span><span>${esc(text)}</span><b>0 s</b>`);
  stage.append(p);
  const t0 = Date.now();
  const t = setInterval(() => {
    if (!p.isConnected) return clearInterval(t);
    p.querySelector("b").textContent = `${Math.round((Date.now() - t0) / 1000)} s`;
  }, 1000);
  return { remove: () => (clearInterval(t), p.remove()) };
}

// Small note when a real call fell back to the simulated path.
function simToast(text) {
  const n = h("div", "bcw-simnote", `⚠️ ${esc(text)}`);
  stage.append(n);
  setTimeout(() => n.classList.add("bcw-out"), 5200);
  setTimeout(() => n.remove(), 5700);
}

// Background mint of a badge NFT (tipo 0..6). Updates the award card, the log entry and the wallet NFT when done.
// Mints run one after the other: the certificate needs the four course badges to be on-chain first.
function mintReal(id, nombre, logEntry, nft, statusEl) {
  const run = () => mintRealAhora(id, nombre, logEntry, nft, statusEl).catch(() => null);
  S.mints = (S.mints || Promise.resolve()).then(run);
  return S.mints;
}
async function mintRealAhora(id, nombre, logEntry, nft, statusEl) {
  const tipo = real.TIPOS[id];
  if (tipo == null || !real.REAL.on || !S.walletReal) return null;
  const pre = S.realTipos?.get(tipo);
  const res = pre ? { ok: true, data: pre } : await real.insignia(S.wallet, tipo, nombre);
  if (!pre) real.track("tx_real", { accion: "insignia", ok: !!res.ok });
  if (!res.ok) {
    if (statusEl?.isConnected) statusEl.textContent = "Se acuñó como NFT en tu wallet (esta vez fue simulada)";
    else simToast(real.motivoSimulada(res));
    return null;
  }
  const d = res.data;
  (S.realTipos ??= new Map()).set(tipo, d);
  if (d.tx && !pre) real.registrar("insignia", `NFT · ${nombre}`, d, `token #${d.token_id}`);
  const label = d.ya_tenia ? `Ya estaba en tu wallet: NFT #${d.token_id}` : d.tx ? `NFT #${d.token_id} · tx ${short(d.tx, 10, 6)}` : `NFT #${d.token_id}`;
  if (logEntry) {
    logEntry.d = `${label} · ${real.nombreRed()}`;
    logEntry.href = d.explorador_nft || d.explorador_tx || null;
  }
  if (nft) Object.assign(nft, { tokenId: d.token_id, href: d.explorador_nft || null });
  if (statusEl?.isConnected) {
    const txt = d.ya_tenia ? `Ya la tenías en ${real.nombreRed()}: NFT #${d.token_id}` : `✓ NFT #${d.token_id} acuñado en ${real.nombreRed()}`;
    statusEl.innerHTML = d.explorador_nft ? real.linkHTML(d.explorador_nft, txt) : `${esc(txt)}${d.tx ? `<code class="bcw-txhash">${esc(short(d.tx, 12, 8))}</code>` : ""}`;
  }
  return d;
}

function setLive() {
  const badge = panel.querySelector(".bcw-badge");
  const caida = real.REAL.caida;
  const texto = caida ? `${real.nombreRed()} · sin conexión, reintentando…` : real.etiqueta();
  badge.querySelector(".bcw-btxt").textContent = texto;
  badge.classList.add("bcw-live");
  badge.classList.toggle("bcw-caida", caida);
  badge.setAttribute("aria-label", `${texto}. Qué es esta red`);
  badge.title = caida
    ? "No hay conexión con la red: mientras tanto el juego sigue con la cadena simulada. Tocá para saber más."
    : `¿Qué es ${real.nombreRed()}? Tocá para verlo`;
  panel.querySelector(".bcw-hero .bcw-aviso").textContent =
    `Respuestas generadas con IA a partir del contenido de este sitio: pueden tener errores. Las transacciones del juego van a ${real.REAL.red} (red de prueba): las paga la demo, vos no necesitás ETH. La wallet es de prueba y vive en tu navegador. Guardamos las preguntas, sin datos de quién las hace, para mejorar el sitio.`;
}

// Scroll the real page to a section and spotlight it.
function goto(sel) {
  if (sel.startsWith("/")) {
    // Another page of the site (the waiting list): the game closes with the navigation.
    track("ir_seccion", { ancla: sel });
    location.assign(sel);
    return;
  }
  const el = document.querySelector(sel);
  if (!el) return;
  track("ir_seccion", { ancla: sel });
  toSite(false);
  window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 90, behavior: REDUCE ? "auto" : "smooth" });
  el.classList.add("bcw-spot");
  setTimeout(() => el.classList.remove("bcw-spot"), 4200);
  launcher.classList.remove("bcw-pulse");
  void launcher.offsetWidth;
  launcher.classList.add("bcw-pulse");
}

function actions(s, list) {
  const row = h("div", "bcw-actions");
  for (const a of list) {
    const cls = `bcw-cta${a.primary ? " bcw-primary" : ""}`;
    const el = a.href ? h("a", cls, a.l) : h("button", cls, a.l);
    if (a.href) {
      el.href = a.href;
      el.target = "_blank";
      el.rel = "noopener";
      if (a.origen) el.dataset.origen = a.origen;
    } else {
      el.type = "button";
      el.addEventListener("click", a.f);
    }
    row.append(el);
  }
  s.append(row);
  return row;
}

// ---------- flows ----------
// A level flow cut before its badge (new flow, "Mejor otra cosa", leaving the page) counts as an abandon.
function abandon() {
  const r = S.run;
  S.run = null;
  if (r && !r.fin) track("nivel_abandono", { nivel: r.id, paso: r.paso });
}

function startFlow(fn) {
  abandon();
  const token = ++S.flow;
  S.current = null;
  if (S.pending) {
    const p = S.pending;
    S.pending = null;
    p.resolve(CANCEL);
  }
  input.placeholder = "Preguntame lo que quieras…";
  const ctx = makeCtx(token);
  Promise.resolve()
    .then(() => fn(ctx))
    .catch((e) => {
      if (e !== CANCEL) console.error("[bcw]", e);
    });
}

function makeCtx(token) {
  const alive = () => token === S.flow;
  const guard = () => {
    if (!alive()) throw CANCEL;
  };
  const ctx = {
    S,
    stage,
    alive,
    guard,
    async sleep(ms) {
      await sleep(ms);
      guard();
    },
    async bot(text, wait) {
      guard();
      const m = typingBubble();
      await sleep(wait ?? Math.min(1100, 320 + text.length * 4));
      if (!alive()) {
        m.remove();
        throw CANCEL;
      }
      m.innerHTML = md(text);
      S.history.push({ rol: "asistente", texto: plain(text) });
      scrollChat();
    },
    // Chips whose answer comes back to the running flow.
    choose(list) {
      guard();
      return new Promise((resolve, reject) => {
        const row = chipRow(list, (c) => {
          if (S.pending?.row !== row) return;
          S.pending = null;
          if (c.f) startFlow(c.f); // an escape chip ("otra cosa") starts its own flow
          else resolve(c.v ?? c.l);
        });
        S.pending = { kind: "choose", row, resolve: (v) => (v === CANCEL ? reject(CANCEL) : resolve(v)) };
      });
    },
    // Free text answer for the running flow.
    ask({ placeholder, onInput } = {}) {
      guard();
      input.placeholder = placeholder || "Escribí acá…";
      if (!MOBILE) input.focus();
      return new Promise((resolve, reject) => {
        S.pending = {
          kind: "ask",
          onInput,
          resolve: (v) => {
            input.placeholder = "Preguntame lo que quieras…";
            if (v === CANCEL) reject(CANCEL);
            else resolve(v);
          },
        };
      });
    },
    // Free text that ends up on the public chain: checked by the backend (backend/moderacion.py) and asked again
    // until it passes. `derivados` returns other strings built from it that are also published (the token symbol).
    async askPublico({ placeholder, onInput, max = 120, derivados } = {}) {
      for (;;) {
        const v = real.recortarBytes((await ctx.ask({ placeholder, onInput })).trim(), max);
        if (!v) continue;
        let malo = null;
        for (const t of [v, ...(derivados?.(v) || [])]) {
          const r = await real.revisarTexto(t);
          guard();
          if (r && !r.ok) {
            malo = r.motivo;
            break;
          }
        }
        if (!malo) return v;
        track("texto_rechazado", { motivo: malo });
        await ctx.bot(`Eso no lo puedo grabar: ${real.motivoRechazo(malo)}. Lo que va a la blockchain queda **público y para siempre** con el nombre de la diplomatura. Probá con otro 🙂`);
      }
    },
    // Wait for something the visitor does on the stage (a button, a node, an edit).
    until(promise) {
      return Promise.race([
        promise,
        new Promise((_, reject) => {
          const t = setInterval(() => {
            if (!alive()) {
              clearInterval(t);
              reject(CANCEL);
            }
          }, 120);
          promise.finally(() => clearInterval(t)).catch(() => {});
        }),
      ]);
    },
    scene(build) {
      guard();
      return sceneEl(build);
    },
    actions,
    addLog,
    goto,
    // A meaningful step of the running level, for the funnel (where people drop off). `paso` is a fixed id.
    paso(paso) {
      guard();
      if (!S.run || S.run.fin) return;
      S.run.paso = paso;
      track("nivel_paso", { nivel: S.run.id, paso });
    },
    chipsMenu: menuChips,
    escape() {
      menuChips([{ l: "↩️ Mejor otra cosa", f: backToMap }]);
    },
    async ensureWallet(reason) {
      if (S.wallet) return;
      // Real mode: a wallet kept from an earlier visit is reused, and the visitor is told so.
      let reused = null;
      if (real.REAL.on) {
        try {
          reused = await ctx.until(Promise.race([real.walletReal(), sleep(12000).then(() => Promise.reject(new Error("timeout")))]));
        } catch (e) {
          if (e === CANCEL) throw e;
          simToast("No pude generar la wallet real: esta vez fue simulada.");
          reused = { address: null };
        }
      }
      if (reused?.address && !reused.nueva) {
        S.wallet = reused.address;
        S.walletReal = true;
        ctx.scene((s) => {
          s.innerHTML = `<div class="bcw-kicker">Tu wallet</div><h3>Ya tenías wallet de la otra vez</h3>`;
          s.append(walletCard());
        });
        addLog("👛", "Recuperaste tu wallet", S.wallet, real.linkDir(S.wallet));
        await ctx.bot(`Recuperé tu wallet de la otra vez: **${short(S.wallet, 6, 4)}**. La clave sigue guardada solo en tu navegador.`);
        return;
      }
      await ctx.bot(reason || "Para esto necesitás una **wallet** (billetera): tu dirección en la blockchain. Te creo una ahora, sin instalar nada.");
      ctx.scene((s) => {
        s.innerHTML = `<div class="bcw-kicker">Tu wallet</div><h3>Generando tus claves…</h3>
          <p class="bcw-lead">Una clave privada (secreta, solo tuya) y una dirección pública que podés compartir.</p>
          <div class="bcw-minting">🔑 generando clave privada…</div>`;
      });
      // Real secp256k1 keypair with ethers (generated above, lazy CDN import); if it couldn't load, it's simulated.
      const address = reused?.address || null;
      await ctx.sleep(1200);
      S.wallet = address || `0x${randHex(20)}`;
      S.walletReal = !!address;
      real.track("wallet_creada", { real: S.walletReal }); // only new wallets: a reused one returned above
      ctx.scene((s) => {
        s.innerHTML = `<div class="bcw-kicker">Tu wallet</div><h3>¡Ya tenés dirección en la blockchain!</h3>`;
        s.append(walletCard());
      });
      addLog("👛", "Creaste tu wallet", S.wallet, real.linkDir(S.walletReal && S.wallet));
      await ctx.sleep(S.walletReal ? 1600 : 900);
    },
    walletCard,
    // Sends a real transaction when the chain is live. Shows a pending pill (the call gives up at ~30 s), records
    // the tx, and returns the response data; null means "go on simulated" (with a small note). `aceptar` lists
    // error codes the caller handles itself (e.g. the saldo_insuficiente revert of level 4).
    async realTx(accion, call, { titulo, extra, aceptar = [], espera } = {}) {
      guard();
      real.REAL.ultimoFallo = null;
      if (!real.REAL.on || !S.walletReal) {
        real.REAL.ultimoFallo = { pendiente: false };
        return null;
      }
      const pill = pendingPill(espera || `Enviando la transacción a ${real.nombreRed()}…`);
      let res;
      try {
        res = await ctx.until(call());
      } finally {
        pill.remove();
      }
      real.track("tx_real", { accion, ok: !!res.ok });
      if (res.ok) {
        real.registrar(accion, titulo || accion, res.data, extra);
        return res.data;
      }
      if (aceptar.includes(res.data?.error)) return { ...res.data, status: res.status };
      // Sent but not confirmed in time: it may still land on the chain. Recorded as pending, never as "simulated".
      const pendiente = res.data?.error === "sin_confirmar" && !!res.data?.tx;
      if (pendiente) real.registrar(accion, `${titulo || accion} · sin confirmar`, res.data, extra, true);
      real.REAL.ultimoFallo = { pendiente, tx: res.data?.tx || null, href: res.data?.explorador_tx || null };
      simToast(real.motivoSimulada(res));
      return null;
    },
    async award(id) {
      levelDone(id);
      if (S.badges.has(id)) return;
      await ctx.ensureWallet("Ganaste una insignia, y las insignias son NFTs: necesitás una **wallet** para guardarla. Te creo una ahora.");
      const b = BADGES[id];
      S.badges.add(id);
      const nft = { kind: "badge", id, name: b.nombre, svg: badgeSVG(id) };
      S.nfts.push(nft);
      renderProgress();
      addLog(b.emoji, `Insignia ${b.etiqueta}`, `NFT en ${S.wallet.slice(0, 10)}…`);
      // The bonus NFT was already minted (or tried) with the visitor's own name: no second mint with a generic one.
      const live = real.REAL.on && S.walletReal && !(id === "nft" && S.nftIntentado && !S.realTipos?.has(real.TIPOS.nft));
      const fx = h("div", "bcw-award", `<div class="bcw-award-card">${badgeSVG(id)}<div class="bcw-award-t">¡Insignia ${esc(b.etiqueta)}!</div><div class="bcw-award-s">${live ? `⏳ Acuñándose como NFT en ${esc(real.nombreRed())}…` : "Se acuñó como NFT en tu wallet"}</div></div>`);
      stage.append(fx);
      // The mint runs in the background: the game never waits for it.
      const mint = live ? mintReal(id, id === "nft" ? S.nftNombre || b.nombre : b.nombre, S.log.at(-1), nft, fx.querySelector(".bcw-award-s")) : null;
      postEvent({ tipo: "insignia", id });
      track("insignia", { id });
      announce(`¡Ganaste la insignia ${b.etiqueta}! Se guardó como NFT en tu wallet.`);
      await sleep(2600);
      // On a public network the mint takes a few seconds: keep the card up (max 6 s more) so the visitor sees
      // "acuñado" and its explorer link. It still lives on in the log and in "Ver por dentro" if it is slower.
      if (mint && (await Promise.race([Promise.resolve(mint).then(() => true, () => false), sleep(6000).then(() => false)]))) await sleep(1400);
      fx.classList.add("bcw-out");
      setTimeout(() => fx.remove(), 500);
      guard();
    },
    async bridge(curso, text) {
      ctx.scene((s) => planScene(s, ctx, curso));
      await ctx.bot(text);
    },
    async next() {
      await closingOrNext(ctx);
    },
    play(id, opts) {
      return playLevel(ctx, id, opts);
    },
  };
  return ctx;
}

function walletCard() {
  const w = h("div", "bcw-wallet");
  const bal = Object.entries(S.balances)
    .map(([k, v]) => `<span class="bcw-bal">${v.toLocaleString("es-AR", { maximumFractionDigits: 2 })} ${esc(k)}</span>`)
    .join("");
  const link = S.walletReal ? real.linkDir(S.wallet) : null;
  const addr = link ? `<a class="bcw-txlink" href="${esc(link)}" target="_blank" rel="noopener">${esc(S.wallet)} ↗</a>` : esc(S.wallet);
  const note = S.walletReal
    ? `<div class="bcw-wnote">🔑 Wallet real en ${esc(real.nombreRed())}: la clave queda solo en tu navegador. <b>Es una wallet de prueba: no le mandes plata real.</b></div>`
    : "";
  w.innerHTML = `<div class="bcw-avatar" style="background:linear-gradient(135deg,#${S.wallet.slice(2, 8)},#${S.wallet.slice(-6)})"></div>
    <div><div class="bcw-wl">Tu wallet</div><div class="bcw-addr">${addr}</div>${bal ? `<div class="bcw-bals">${bal}</div>` : ""}${note}</div>`;
  return w;
}

function levelDone(id) {
  if (S.run?.id !== id || S.run.fin) return;
  S.run.fin = true;
  track("nivel_fin", { nivel: id });
}

async function playLevel(ctx, id, opts = {}) {
  abandon(); // a level started from inside another flow (the agent) replaces the one in course
  S.current = id;
  S.run = { id, paso: "inicio", fin: false };
  track("nivel_inicio", { nivel: id });
  try {
    await PLAY[id](ctx, opts);
    levelDone(id);
  } finally {
    if (ctx.alive()) S.current = null;
  }
}

// ---------- map ----------
function levelChips() {
  const list = LEVELS.map((l) => ({ l: `${S.badges.has(l.id) ? "✅" : "▶️"} Nivel ${l.curso} · ${l.corto}`, f: (ctx) => ctx.play(l.id) }));
  list.push(
    { l: "🎨 Bonus: tu NFT", f: (ctx) => ctx.play("nft") },
    { l: "😈 Desafío: hackeá un contrato", f: (ctx) => ctx.play("hack") },
    { l: "🎓 La diplomatura", f: topicDiplo },
  );
  return list;
}

function mapScene(ctx) {
  ctx.scene((s) => {
    const done = LEVELS.filter((l) => S.badges.has(l.id)).length;
    s.innerHTML = `<div class="bcw-kicker">El juego</div>
      <h3>Jugá la diplomatura: un nivel por curso</h3>
      <p class="bcw-lead">Cada nivel pasa en una blockchain de verdad corriendo en tu navegador. Ganá las 4 insignias y llevate el certificado del recorrido.</p>
      <div class="bcw-meterbig"><div style="width:${done * 25}%"></div><span>${done} de 4 insignias</span></div>`;
    const grid = h("div", "bcw-levels");
    for (const l of LEVELS) {
      const got = S.badges.has(l.id);
      const card = h("button", `bcw-level${got ? " bcw-got" : ""}`, `
        <div class="bcw-lbadge">${badgeSVG(l.id, !got)}</div>
        <div class="bcw-lbody"><div class="bcw-lk">Nivel ${l.curso} · Curso ${l.curso}</div>
        <div class="bcw-lt">${l.titulo}</div><div class="bcw-ls">${l.sub}</div>
        <div class="bcw-lgo">${got ? "✓ Insignia ganada · jugar de nuevo" : "▶ Jugar"}</div></div>`);
      card.type = "button";
      card.addEventListener("click", () => {
        clearChips();
        userSay(`Nivel ${l.curso} · ${l.corto}`);
        startFlow((c) => c.play(l.id));
      });
      grid.append(card);
    }
    s.append(grid);
    const bonus = h("div", "bcw-bonusrow");
    for (const b of BONUS) {
      const got = S.badges.has(b.id);
      const el = h("button", `bcw-bonus${got ? " bcw-got" : ""}`, `<span>${b.emoji}</span><div><b>${b.titulo}</b><small>${got ? "✓ completado" : b.sub}</small></div>`);
      el.type = "button";
      el.addEventListener("click", () => {
        clearChips();
        userSay(b.titulo);
        startFlow((c) => c.play(b.id));
      });
      bonus.append(el);
    }
    s.append(bonus);
    if (S.stats?.insignias_hoy) s.append(h("p", "bcw-stat", `🔥 Hoy los visitantes ganaron <b>${S.stats.insignias_hoy}</b> insignias`));
  });
}

async function welcome(ctx) {
  await ready;
  mapScene(ctx);
  await ctx.bot("👋 ¡Hola! Soy el asistente de la **Diplomatura en Blockchain** de la UNLu.", 600);
  await ctx.bot(`No te voy a explicar blockchain: **la vas a jugar**. Cada curso es un nivel ${POINT} Elegí por dónde arrancar, o preguntame lo que quieras de la diplomatura.`);
  menuChips(levelChips());
}

async function welcomeRest(ctx) {
  await ready;
  mapScene(ctx);
  await ctx.bot(`Cada curso es un nivel ${POINT} Elegí por dónde arrancar, o preguntame lo que quieras de la diplomatura.`);
  menuChips(levelChips());
}

async function backToMap(ctx) {
  mapScene(ctx);
  await ctx.bot("Este es el mapa. ¿Qué jugamos?", 400);
  menuChips(levelChips());
}

function nextChips() {
  const list = [];
  const pendingLevel = LEVELS.find((l) => !S.badges.has(l.id));
  if (pendingLevel) list.push({ l: `▶️ Nivel ${pendingLevel.curso} · ${pendingLevel.corto}`, f: (ctx) => ctx.play(pendingLevel.id), primary: true });
  list.push({ l: "🗺️ Ver el mapa", f: backToMap });
  for (const b of BONUS) if (!S.badges.has(b.id)) list.push({ l: `${b.emoji} ${b.titulo}`, f: (ctx) => ctx.play(b.id) });
  list.push({ l: "🎓 La diplomatura", f: topicDiplo });
  if (S.wallet) list.push({ l: "👛 Mi wallet", f: walletFlow });
  return list;
}

async function closingOrNext(ctx) {
  const all = LEVELS.every((l) => S.badges.has(l.id));
  if (all && !S.closingShown) {
    S.closingShown = true;
    await certificate(ctx);
    return;
  }
  menuChips(nextChips());
}

async function certificate(ctx) {
  await ctx.sleep(500);
  await ctx.bot("🏆 **¡Completaste los 4 niveles!** Jugaste en un rato lo que en la diplomatura aprendés a **programar**: bloques, tokens, redes y una DApp de pagos.");
  ctx.scene((s) => {
    s.innerHTML = `<div class="bcw-kicker">Recorrido completo</div><h3>Tu certificado del recorrido</h3>`;
    s.append(h("div", "bcw-nft bcw-nftbig bcw-cert", badgeSVG("cert")));
    s.append(h("p", "bcw-lead", "Es un NFT simbólico del juego, no un título. El título de posgrado se gana cursando 😉"));
    if (real.REAL.on && S.walletReal) s.append(h("p", "bcw-certtx", `⏳ Acuñándose en ${esc(real.nombreRed())}…`));
    actions(s, [{ l: "✍️ Anotarme en la lista de espera 2027", href: WAITLIST_URL, primary: true, origen: "certificado" }, { l: "👛 Ver mi wallet", f: () => startFlow(walletFlow) }]);
  });
  const nft = { kind: "badge", id: "cert", name: "Recorrido completo", svg: badgeSVG("cert") };
  S.nfts.push(nft);
  addLog("🏆", "Certificado del recorrido completo", "NFT simbólico del juego");
  if (real.REAL.on && S.walletReal) mintReal("cert", "Recorrido completo", S.log.at(-1), nft, stage.querySelector(".bcw-certtx"));
  postEvent({ tipo: "certificado" });
  track("certificado");
  announce("¡Completaste los 4 niveles! Te llegó el certificado del recorrido.");
  await ctx.bot("La **cohorte 2026 ya está en curso**. ¿Te anoto en la lista de espera de 2027?");
  menuChips([{ l: "📅 Sí, ¿cómo me anoto?", f: (c) => showSite(c, "inscripcion"), primary: true }, ...nextChips().filter((c) => !c.l.includes("Nivel"))]);
}

async function walletFlow(ctx) {
  if (!S.wallet) {
    await ctx.bot("Todavía no tenés wallet: se crea sola cuando ganás tu primera insignia o tu primer NFT.");
    menuChips(nextChips());
    return;
  }
  ctx.scene((s) => {
    s.innerHTML = `<div class="bcw-kicker">Tu wallet</div><h3>Lo que tenés</h3>`;
    s.append(walletCard());
    if (S.nfts.length) {
      const grid = h("div", "bcw-designs");
      for (const n of S.nfts) {
        const cap = n.href ? real.linkHTML(n.href, n.name) : esc(n.name);
        grid.append(h("div", "bcw-nft", `${n.svg}<div class="bcw-cap">${cap}</div>`));
      }
      s.append(grid);
    }
  });
  await ctx.bot(`Tenés **${S.nfts.length} NFT${S.nfts.length === 1 ? "" : "s"}** en tu wallet.`, 400);
  menuChips(nextChips());
}

async function topicDiplo(ctx) {
  await ctx.bot("¿Qué querés saber de la diplomatura?");
  menuChips(SITE_TOPICS.map((t) => ({ l: t.l, f: (c) => showSite(c, t.id).then(() => menuChips(nextChips())) })));
}

function logScene() {
  sceneEl((s) => {
    s.innerHTML = `<div class="bcw-kicker">Tu recorrido</div><h3>Lo que hiciste hoy</h3>`;
    if (!S.log.length) {
      s.append(h("p", "bcw-lead", "Todavía nada: elegí un nivel en el chat."));
      return;
    }
    const ul = h("ul", "bcw-loglist");
    for (const l of S.log) {
      const d = l.href ? real.linkHTML(l.href, l.d) : esc(l.d);
      ul.append(h("li", "", `<span class="bcw-ic">${l.ic}</span><div><b>${esc(l.t)}</b><small>${d}</small></div>`));
    }
    s.append(ul);
    const nota = !real.REAL.on
      ? "En la versión real cada ítem tiene su link al explorador de Base Sepolia."
      : real.REAL.explorador
        ? "Los ítems con ↗ están en la cadena real: abren en Blockscout."
        : `Lo que fue a ${real.nombreRed()} quedó en la cadena real (en Anvil no hay explorador; los hashes están en «Ver por dentro»).`;
    s.append(h("p", "bcw-lead", nota));
    actions(s, [{ l: "✍️ Lista de espera 2027", href: WAITLIST_URL, primary: true, origen: "recorrido" }]);
  });
}

// ---------- agent ----------
async function checkAI() {
  try {
    const r = await fetch(`${API}/estado`);
    if (!r.ok) throw new Error(r.status);
    const d = await r.json();
    S.ai = !!d.ok;
    S.stats = d;
    configurarMedicion(d.medicion !== false);
    if (real.configurar(d.cadena)) setLive();
    contratosEnSitio();
    panel.querySelector(".bcw-ai").hidden = !S.ai;
    const map = stage.querySelector(".bcw-levels");
    if (map && d.insignias_hoy && !stage.querySelector(".bcw-stat"))
      map.parentElement.append(h("p", "bcw-stat", `🔥 Hoy los visitantes ganaron <b>${d.insignias_hoy}</b> insignias`));
  } catch {
    S.ai = false;
    configurarMedicion(false);
  }
}

function postEvent(ev) {
  if (!S.ai || esEquipo) return; // team visits count nowhere, not even in "hoy los visitantes ganaron…"
  fetch(`${API}/evento`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(ev) }).catch(() => {});
}

function gameState() {
  return {
    insignias: [...S.badges],
    nivel_actual: S.current,
    wallet: !!S.wallet,
    nfts: S.nfts.length,
    pendientes: LEVELS.filter((l) => !S.badges.has(l.id)).map((l) => l.id),
  };
}

// Server-Sent Events over fetch: yields {event, data}.
async function* sse(resp) {
  const reader = resp.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const raw = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const ev = /^event: (.*)$/m.exec(raw)?.[1];
      const data = /^data: (.*)$/m.exec(raw)?.[1];
      if (ev && data) yield { event: ev, data: JSON.parse(data) };
    }
  }
}

async function agentTurn(ctx, text) {
  const history = S.history.slice(-12);
  // The last entry is the question itself (userSay already pushed it).
  // `sesion` lets the server write the funnel event pregunta_agente itself (null when metrics are off for this visit).
  const body = { mensajes: history, estado: gameState(), sesion: sesionMedicion() };
  S.lastTurn = { pregunta: text, estado: body.estado, acciones: [], fin: null };
  const bubble = typingBubble();
  let answer = "";
  const queued = [];
  let resp;
  try {
    resp = await fetch(`${API}/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!resp.ok || !resp.body) throw new Error(`HTTP ${resp.status}`);
  } catch {
    bubble.remove();
    return false;
  }
  try {
    for await (const { event, data } of sse(resp)) {
      if (!ctx.alive()) {
        if (!answer) bubble.remove();
        throw CANCEL;
      }
      if (event === "texto") {
        answer += data.t;
        bubble.innerHTML = md(esc(answer)).replace(/\n/g, "<br>");
        scrollChat();
      } else if (event === "accion") {
        S.lastTurn.acciones.push(data);
        // Stage changes show right away; a level waits until the text is done.
        if (data.tipo === "mostrar_sitio") showSite(ctx, data.tema, { curso: data.curso, quiet: true }).catch(() => {});
        else if (data.tipo === "llevar_al_sitio") queued.push(data);
        else queued.push(data);
      } else if (event === "fin") {
        S.lastTurn.fin = data;
        llamarDentro();
      } else if (event === "error") {
        answer += (answer ? "\n\n" : "") + data.mensaje;
        bubble.innerHTML = md(esc(answer));
      }
    }
  } catch (e) {
    if (e === CANCEL) throw e;
    if (!answer) {
      bubble.remove();
      return false;
    }
  }
  if (!answer) bubble.remove();
  else S.history.push({ rol: "asistente", texto: answer });
  // The funnel event pregunta_agente is written by the server (backend/app.py), not here.
  if (panel.classList.contains("bcw-dentro-open") && dentroTab === "agente") renderDentro();

  let suggested = null;
  for (const a of queued) {
    if (a.tipo === "sugerir") suggested = a.opciones;
    else if (a.tipo === "llevar_al_sitio") ctx.actions(stage.querySelector(".bcw-scene"), [{ l: a.ancla === WAITLIST_URL ? "✍️ Ir a la lista de espera 2027" : "📍 Ir a esta sección del sitio", f: () => goto(a.ancla) }]);
  }
  const level = queued.find((a) => a.tipo === "jugar_nivel" && PLAY[a.nivel]);
  if (level) {
    await ctx.sleep(400);
    await ctx.play(level.nivel, { ejemplo: level.ejemplo });
    return true;
  }
  if (suggested?.length) {
    menuChips(
      suggested.slice(0, 4).map((o) => ({
        l: o.etiqueta,
        f: (c) => {
          if (o.tipo === "nivel" && PLAY[o.valor]) return c.play(o.valor);
          if (o.tipo === "tema" && SITE_TOPICS.some((t) => t.id === o.valor)) return showSite(c, o.valor).then(() => menuChips(nextChips()));
          return route(c, o.valor || o.etiqueta, true);
        },
      })),
    );
  } else {
    menuChips(nextChips());
  }
  return true;
}

// ---------- free text ----------
async function route(ctx, text, fromChip) {
  if (fromChip && S.history.length) {
    // A suggested question: the chip showed its short label, the agent gets the full question.
    S.history[S.history.length - 1].texto = text;
  }
  if (S.ai !== false && (await agentTurn(ctx, text))) return;
  return keywordRoute(ctx, text);
}

async function keywordRoute(ctx, text) {
  const n = norm(text);
  const is = (re) => re.test(n);
  if (is(/^(hola|buenas|hey|que tal)/)) {
    await ctx.bot("¡Hola! ¿Qué jugamos?", 400);
    return menuChips(levelChips());
  }
  if (is(/hash|borrar|inmutab|para siempre|adulter|bloque|minar|minado|minero|cadena/)) return ctx.play("c1");
  if (is(/token|moneda|liquidez|pool|defi|precio de|swap/)) return ctx.play("c2");
  if (is(/nodo|consenso|red |capa 2|layer|l2|escalab/)) return ctx.play("c3");
  if (is(/pagar|pasarela|pago con|cobrar|recibo|comprar/)) return ctx.play("c4");
  if (is(/nft|coleccionable|arte digital/)) return ctx.play("nft");
  if (is(/hack|reentran|robar|seguridad|auditor/)) return ctx.play("hack");
  if (is(/wallet|billetera/)) return walletFlow(ctx);
  if (is(/docente|profe|quien|director|coordin|ensena/)) return showSite(ctx, "docentes").then(() => menuChips(nextChips()));
  if (is(/cuesta|cuanto sale|cuanto es|arancel|precio|cuota|matricula|costo|vale/)) return showSite(ctx, "aranceles").then(() => menuChips(nextChips()));
  if (is(/inscri|anot|cupo|2027|empieza|inicio|horario|dias|virtual|presencial|modalidad|cuando/)) return showSite(ctx, "inscripcion").then(() => menuChips(nextChips()));
  if (is(/plan|modulo|curso|materia|programa|aprend|contenido|solidity|ethereum/)) return showSite(ctx, "plan").then(() => menuChips(nextChips()));
  await ctx.bot("Ahora mismo respondo con botones y algunas palabras clave (el asistente con IA no está conectado). Probá con:");
  menuChips(nextChips());
}

// ---------- from the page into a level ----------
// main.js loads this module and calls these when the visitor asks for the game. A [data-bcw-nivel] button on the normal
// site plays that level right there, and ?bcw=c1 (or any level id) in a shared link opens the game on it.
// data-bcw-nivel="red" opens the "Base Sepolia · en vivo" card.
export function playFromPage(id) {
  openGame(true);
  if (id === "red") return toggleRed(true);
  startPlaying("sitio");
  clearChips();
  const l = LEVELS.find((x) => x.id === id);
  userSay(l ? `Nivel ${l.curso} · ${l.corto}` : (BONUS.find((b) => b.id === id)?.titulo ?? id));
  startFlow((c) => c.play(id));
}
export const niveles = () => Object.keys(PLAY);
// byUser: the visitor asked (launcher, selector); otherwise it is the saved preference or a link.
export const abrir = (byUser) => openGame(byUser);

checkAI();
real.onEstado.add(() => {
  if (real.REAL.on) setLive();
});
