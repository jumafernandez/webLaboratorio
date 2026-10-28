// Real chain: when the backend runs with CADENA_MODO=real, the game writes on an actual network (Base Sepolia, or
// Anvil on 31337 for local dev) through the relayer in backend/cadena.py. Visitors have no testnet ETH, so the
// backend signs and pays gas and the contracts act ON BEHALF of the visitor's address. The visitor's wallet is a real
// secp256k1 keypair generated in the browser with ethers (loaded lazily, only in real mode); only the address and a
// signature go to the backend. Every write is signed by the visitor (EIP-191 personal_sign over the text built by
// mensajeAFirmar, the same as backend/cadena.py mensaje_a_firmar), so nobody else can spend their USDL or mint things
// to their address. Any failure returns null so the caller keeps its simulated path: the game never breaks or blocks.

import { esc, short } from "./util.js";

const API = "/blockchain-dev/api/cadena";
const ETHERS_URL = "https://cdn.jsdelivr.net/npm/ethers@6.13.4/dist/ethers.min.js";
const WALLET_KEY = "bcw-wallet";
// Above the backend's worst case (RPC estimate + send + 20 s waiting for the receipt), so a slow tx comes back as a
// 504 "sin_confirmar" with its hash instead of being cut here and wrongly shown as simulated.
const TIMEOUT_MS = 45000;

// Badge ids of the game -> `tipo` in InsigniasLICDIA.
export const TIPOS = { c1: 0, c2: 1, c3: 2, c4: 3, nft: 4, hack: 5, cert: 6 };

export const REAL = {
  on: false, // backend in real mode and the node answered
  chainId: null,
  red: null, // "Base Sepolia" | "Anvil (local)"
  explorador: null, // Blockscout base url, null on Anvil
  contratos: {}, // accion -> contract address the visitor signs for
  desfase: 0, // server clock - browser clock, in seconds
  caida: false, // the node stopped answering (live block polling failed several times in a row)
  txs: [], // {accion, titulo, tx, bloque, href, extra, pendiente}
  ultimoFallo: null, // last real call that fell back: {pendiente, tx, href} (labels of the simulated cards)
};
export const onTx = new Set();
export const onEstado = new Set(); // called with REAL when `caida` changes

// From /estado's "cadena" block. Real only when the backend says so AND the node is reachable.
export function configurar(cadena) {
  const c = cadena || {};
  REAL.on = c.modo === "real" && c.disponible !== false && !!c.chain_id;
  REAL.chainId = c.chain_id ?? null;
  REAL.red = c.red || (c.chain_id === 84532 ? "Base Sepolia" : c.chain_id === 31337 ? "Anvil (local)" : null);
  REAL.explorador = c.explorador || null;
  REAL.contratos = c.contratos || {};
  if (Number.isInteger(c.ahora)) REAL.desfase = c.ahora - Math.floor(Date.now() / 1000);
  if (REAL.on && !REAL.contratos.sellar) REAL.on = false; // an older backend without signatures: stay simulated
  return REAL.on;
}

export const esAnvil = () => REAL.chainId === 31337;
export const nombreRed = () => (esAnvil() ? "Anvil local" : REAL.red || "la red");
export const etiqueta = () => (esAnvil() ? "Anvil local · cadena real" : `${REAL.red || "Base Sepolia"} · en vivo`);
export const linkDir = (a) => (REAL.explorador && a ? `${REAL.explorador}/address/${a}` : null);

// ---------- metrics (widget/medicion.js never throws) ----------
export { track } from "./medicion.js";

// ---------- wallet ----------
let ethers = null;
async function cargarEthers() {
  ethers ??= import(ETHERS_URL).catch((e) => {
    ethers = null;
    throw e;
  });
  return ethers;
}

function leerClave() {
  try {
    return localStorage.getItem(WALLET_KEY);
  } catch {
    return null;
  }
}
function guardarClave(k) {
  try {
    localStorage.setItem(WALLET_KEY, k);
  } catch {
    /* no storage: the wallet lasts for this visit */
  }
}

let wallet = null;
// Real address of the visitor (new or remembered); {address, nueva}. Throws if ethers can't load.
export async function walletReal() {
  if (wallet) return { address: wallet.address, nueva: false };
  const { Wallet } = await cargarEthers();
  const guardada = leerClave();
  if (guardada) {
    try {
      wallet = new Wallet(guardada);
      return { address: wallet.address, nueva: false };
    } catch {
      /* corrupt entry: make a new one */
    }
  }
  wallet = Wallet.createRandom();
  guardarClave(wallet.privateKey);
  return { address: wallet.address, nueva: true };
}

// ---------- endpoints ----------
// POST /cadena/<accion>. Returns {ok, status, data}; never throws (network errors and timeouts -> ok:false).
export async function llamar(accion, cuerpo, ms = TIMEOUT_MS) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(`${API}/${accion}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cuerpo),
      signal: ctl.signal,
    });
    let data = {};
    try {
      data = await r.json();
    } catch {
      /* empty body */
    }
    return { ok: r.ok, status: r.status, data };
  } catch {
    return { ok: false, status: 0, data: { error: "sin_respuesta" } };
  } finally {
    clearTimeout(t);
  }
}

// ---------- signatures ----------
// Same text as backend/cadena.py mensaje_a_firmar: action, chain, contract, address, the other body fields sorted by
// key, expiry and a random nonce (each signature is accepted once).
export function mensajeAFirmar(accion, direccion, campos, expira, nonce) {
  const lineas = [
    "Juego de la Diplomatura en Blockchain (LICDIA, UNLu)",
    `accion: ${accion}`,
    `red: ${REAL.chainId}`,
    `contrato: ${REAL.contratos[accion]}`,
    `direccion: ${direccion}`,
  ];
  for (const k of Object.keys(campos).sort()) lineas.push(`${k}: ${campos[k]}`);
  lineas.push(`expira: ${expira}`, `nonce: ${nonce}`);
  return lineas.join("\n");
}

function nonceAlAzar() {
  return [...crypto.getRandomValues(new Uint8Array(16))].map((x) => x.toString(16).padStart(2, "0")).join("");
}

// Signs and POSTs one write. On "firma_vencida" (the browser clock is off) it adopts the server time and retries once.
async function firmadoYEnviado(accion, campos) {
  if (!wallet || !REAL.contratos[accion]) return { ok: false, status: 0, data: { error: "sin_wallet" } };
  const limpios = Object.fromEntries(Object.entries(campos).filter(([, v]) => v !== undefined && v !== null));
  for (let intento = 0; intento < 2; intento++) {
    let cuerpo;
    try {
      const expira = Math.floor(Date.now() / 1000) + REAL.desfase + 240;
      const nonce = nonceAlAzar();
      const firma = await wallet.signMessage(mensajeAFirmar(accion, wallet.address, limpios, expira, nonce));
      cuerpo = { direccion: wallet.address, ...limpios, firma, expira, nonce };
    } catch {
      return { ok: false, status: 0, data: { error: "sin_firma" } };
    }
    const res = await llamar(accion, cuerpo);
    if (res.data?.error === "firma_vencida" && Number.isInteger(res.data.ahora) && intento === 0) {
      REAL.desfase = res.data.ahora - Math.floor(Date.now() / 1000);
      continue;
    }
    return res;
  }
  return { ok: false, status: 0, data: { error: "firma_vencida" } };
}

// The `direccion` argument is kept for the callers; the signed body always uses the wallet's own address.
export const sellar = (_direccion, mensaje) => firmadoYEnviado("sellar", { mensaje });
export const crearToken = (_direccion, nombre, simbolo, supply) => firmadoYEnviado("token", { nombre, simbolo, supply });
export const fondear = () => firmadoYEnviado("fondear", {});
export const pagar = (_direccion, producto, monto) => firmadoYEnviado("pagar", { producto, monto });
// Only the bonus NFT (tipo 4) takes a name; the backend fixes the name of every other badge. With an own wallet linked
// (vincularWalletPropia) the badge is minted there instead of in the game wallet.
export const insignia = (_direccion, tipo, nombre) => {
  const d = destino();
  const extra = d ? { destino: d.destino, vinculo: d.vinculo } : {};
  return firmadoYEnviado("insignia", { ...(tipo === TIPOS.nft ? { tipo, nombre } : { tipo }), ...extra });
};

// ---------- own wallet ----------
// A visitor who already has a wallet (MetaMask, Coinbase Wallet, Rabby…) can receive the badges there. Their wallet
// signs once (EIP-191, no gas, no network change) the text below, the same as backend/cadena.py texto_vinculo, so
// nobody can mint badges to someone else's address. The relayer still pays; the game wallet still signs each action.
const DESTINO_KEY = "bcw-destino";
let memoriaDestino = null; // when localStorage is blocked

export function textoVinculo(juego, destino) {
  return [
    "Recibir las insignias del juego de la Diplomatura en Blockchain (LICDIA, UNLu)",
    `red: ${REAL.chainId}`,
    `contrato: ${REAL.contratos.insignia}`,
    `wallet del juego: ${juego}`,
    `mi wallet: ${destino}`,
  ].join("\n");
}

// The linked own wallet for the current game wallet and network, or null.
export function destino() {
  try {
    const d = memoriaDestino || JSON.parse(localStorage.getItem(DESTINO_KEY) || "null");
    return d && wallet && d.juego === wallet.address && d.red === REAL.chainId ? d : null;
  } catch {
    return null;
  }
}

export const hayWalletDelNavegador = () => !!window.ethereum?.request;

// Asks the browser wallet for an account and the link signature. Returns {destino} or {error} (never throws).
export async function vincularWalletPropia() {
  const eth = window.ethereum;
  if (!eth?.request) return { error: "sin_wallet" };
  if (!wallet) return { error: "sin_wallet_juego" };
  try {
    const [cuenta] = await eth.request({ method: "eth_requestAccounts" });
    if (!cuenta) return { error: "sin_cuenta" };
    const { getAddress } = await cargarEthers();
    const dir = getAddress(cuenta);
    if (dir === wallet.address) return { error: "misma_wallet" };
    const texto = textoVinculo(wallet.address, dir);
    const hexTexto = `0x${[...new TextEncoder().encode(texto)].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
    const vinculo = await eth.request({ method: "personal_sign", params: [hexTexto, cuenta] });
    const d = { juego: wallet.address, red: REAL.chainId, destino: dir, vinculo };
    try {
      localStorage.setItem(DESTINO_KEY, JSON.stringify(d));
    } catch {
      /* no storage: it lasts for this visit */
      memoriaDestino = d;
    }
    return { destino: dir };
  } catch (e) {
    return { error: e?.code === 4001 ? "rechazado" : "fallo" };
  }
}

export function desvincularWalletPropia() {
  memoriaDestino = null;
  try {
    localStorage.removeItem(DESTINO_KEY);
  } catch {
    /* idem */
  }
}

// GET /cadena/estado: latest block number of the network, or null. Three failures in a row mark the node as down
// (header and live boxes say so); the next success brings it back.
let fallosSeguidos = 0;
function marcarCaida(caida) {
  if (REAL.caida === caida) return;
  REAL.caida = caida;
  for (const f of onEstado) {
    try {
      f(REAL);
    } catch {
      /* a listener must not break the flow */
    }
  }
}
export async function bloqueActual() {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 6000);
  let n = null;
  try {
    const r = await fetch(`${API}/estado`, { signal: ctl.signal });
    if (r.ok) {
      const d = await r.json();
      n = Number.isInteger(d.bloque) ? d.bloque : null;
    }
  } catch {
    n = null;
  } finally {
    clearTimeout(t);
  }
  fallosSeguidos = n == null ? fallosSeguidos + 1 : 0;
  if (n != null) marcarCaida(false);
  else if (fallosSeguidos >= 3) marcarCaida(true);
  return n;
}

// POST /revisar: can this text be written on the public chain? {ok, motivo}, or null when the backend can't say
// (no backend, network down). Runs in simulated mode too: the text still shows on the page.
export async function revisarTexto(texto) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 10000);
  try {
    const r = await fetch(`${API}/revisar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ texto }),
      signal: ctl.signal,
    });
    if (!r.ok) return null;
    const d = await r.json();
    return typeof d.ok === "boolean" ? d : null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

// Why a text was turned down, in the visitor's words.
const MOTIVOS = {
  insulto: "tiene palabras que no van",
  odio: "puede ofender a alguien",
  sexual: "tiene contenido sexual",
  violencia: "suena a amenaza o violencia",
  politica: "tiene contenido político",
  publicidad: "tiene un link, una cuenta o publicidad",
  datos_personales: "parece tener datos personales (teléfono, correo, documento)",
  texto_invalido: "tiene caracteres que no se pueden grabar",
};
export const motivoRechazo = (m) => MOTIVOS[m] || "no pasa el filtro de lo que se puede publicar";

// Message the visitor sees when the real call didn't work and the game went on simulated.
export function motivoSimulada(res) {
  const e = res?.data?.error;
  if (e === "texto_rechazado") return `No lo mandé a la cadena real porque ${motivoRechazo(res.data.motivo)}: esta vez fue simulada.`;
  if (e === "sin_revision") return "No pude revisar el texto antes de publicarlo, así que no lo mandé a la cadena real: esta vez fue simulada.";
  if (e === "datos_personales") return "No lo mandé a la cadena real porque parecía tener datos personales: esta vez fue simulada.";
  if (e === "limite_diario" || e === "tope_origen" || e === "tope_global" || res?.status === 429)
    return "Llegamos al tope de transacciones reales de hoy: esta vez fue simulada.";
  if (e === "sin_fondos") return "El relayer de la demo se quedó sin gas: esta vez fue simulada.";
  if (e === "sin_confirmar" && res?.data?.tx)
    return `La transacción se envió a ${nombreRed()} pero todavía no se confirmó (tx ${short(res.data.tx, 10, 6)}). Mientras tanto el juego sigue con la simulada.`;
  if (e === "ocupado" || e === "demasiados_pedidos") return "La demo está atendiendo muchos pedidos a la vez: esta vez fue simulada.";
  if (e === "firma_invalida" || e === "firma_vencida" || e === "firma_usada" || e === "sin_firma")
    return "No se pudo verificar la firma de tu wallet: esta vez fue simulada.";
  if (res?.status === 0) return "La red tardó demasiado: esta vez fue simulada.";
  return "La red no respondió como esperaba: esta vez fue simulada.";
}

// ---------- registry of real transactions ----------
export function registrar(accion, titulo, data, extra = "", pendiente = false) {
  if (!data?.tx) return null;
  const item = { accion, titulo, tx: data.tx, bloque: data.bloque, href: data.explorador_tx || null, extra, pendiente };
  REAL.txs.push(item);
  for (const f of onTx) {
    try {
      f(item);
    } catch {
      /* a listener must not break the flow */
    }
  }
  return item;
}

export function linkHTML(href, texto) {
  if (!href) return esc(texto);
  return `<a class="bcw-txlink" href="${esc(href)}" target="_blank" rel="noopener">${esc(texto)} ↗</a>`;
}

// <dl> rows for a receipt with the real tx hash, block and explorer link.
export function filasTx(data) {
  const tx = data.explorador_tx ? linkHTML(data.explorador_tx, short(data.tx, 14, 8)) : `<span class="bcw-txhash">${esc(data.tx)}</span>`;
  return `<dt>Red</dt><dd>${esc(nombreRed())} · <b class="bcw-vivo">real</b></dd><dt>Tx</dt><dd>${tx}</dd><dt>Bloque</dt><dd>#${esc(data.bloque)}</dd>`;
}

// "Ver por dentro" › La cadena: the list of real transactions.
export function txsHTML() {
  if (!REAL.on) return "";
  const head = `<h3>Transacciones reales</h3>
    <p>Lo que mandaste a <b>${esc(nombreRed())}</b>. Las firma y paga el relayer de la demo en nombre de tu wallet
    (los visitantes no tienen ETH de prueba). ${REAL.explorador ? "Cada una abre en Blockscout." : "En Anvil no hay explorador: se muestra el hash."}</p>`;
  if (!REAL.txs.length) return `${head}<p class="bcw-dnote">Todavía ninguna: jugá un nivel.</p>`;
  const rows = [...REAL.txs]
    .reverse()
    .map((t) => `<li><div class="bcw-drow"><b>${esc(t.titulo)}</b><span class="bcw-dok">${t.pendiente ? "enviada, sin confirmar" : `bloque #${esc(t.bloque)}`}</span></div>
      ${t.extra ? `<div class="bcw-ddata">${esc(t.extra)}</div>` : ""}
      <code class="bcw-rtx">${t.href ? linkHTML(t.href, t.tx) : esc(t.tx)}</code></li>`)
    .join("");
  return `${head}<ol class="bcw-dlist bcw-rtxs">${rows}</ol>`;
}

// Network label for a card that fell back to the simulated path. With the real chain on, it never claims Base
// Sepolia: it says the tx was sent and is unconfirmed, or that it was not sent.
export function redSimulada() {
  if (!REAL.on) return "Base Sepolia (simulado)";
  if (REAL.ultimoFallo?.pendiente) return `${nombreRed()} · enviada, sin confirmar`;
  return `${nombreRed()} · no se envió (simulado)`;
}
// Suffix for a "Lo que hiciste hoy" entry that was simulated while the real chain is on.
export const marcaSimulada = () => (REAL.on ? (REAL.ultimoFallo?.pendiente ? " · sin confirmar" : " · simulado") : "");

// Cut a string to at most n UTF-8 bytes (the contracts measure bytes, not characters).
export function recortarBytes(s, n) {
  const enc = new TextEncoder();
  let out = "";
  for (const ch of String(s)) {
    if (enc.encode(out + ch).length > n) break;
    out += ch;
  }
  return out;
}
