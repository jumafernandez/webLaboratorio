// The game against the REAL chain: starts its own Anvil (31337) on a free port, deploys the contracts, runs the
// backend with CADENA_MODO=real on another free port, and plays levels 1-4 + the NFT bonus in headless Chrome.
// Checks that a real tx hash shows up for seal, token, fund, pay and badges, that the "auto 0 km" branch gets the
// 409 saldo_insuficiente revert, and verifies every hash with `cast receipt` on that Anvil. Only Anvil's public dev
// account #0 is used; nothing goes to a public network. /api/chat is mocked so no LLM is called.
//   node tests/e2e/cadena_real.mjs [ancho] [alto]
// Against a server that is ALREADY in real mode (e.g. Base Sepolia), with no local Anvil:
//   BCW_EXTERNO=http://127.0.0.1:8765 BCW_RPC=https://sepolia.base.org node tests/e2e/cadena_real.mjs
// This spends the relayer's testnet ETH (about 0.00001 ETH per run on Base Sepolia).

import { execFile, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const run = promisify(execFile);
const ancho = Number(process.argv[2] || 1440);
const alto = Number(process.argv[3] || 900);
// Public Anvil/Hardhat dev key #0 (published in the Foundry docs; never holds real funds).
const CLAVE_DEV = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

const libre = () => new Promise((ok) => {
  const s = createServer();
  s.listen(0, "127.0.0.1", () => {
    const { port } = s.address();
    s.close(() => ok(port));
  });
});
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

const anvilPuerto = await libre();
const puerto = await libre();
const EXTERNO = process.env.BCW_EXTERNO || "";
const RPC = EXTERNO ? process.env.BCW_RPC : `http://127.0.0.1:${anvilPuerto}`;
if (EXTERNO && !RPC) {
  console.error("BCW_EXTERNO necesita BCW_RPC");
  process.exit(2);
}
const estadoDir = mkdtempSync(join(tmpdir(), "bcw-real-"));
const hijos = [];
// desplegar-anvil.sh writes contratos/deploy/31337.json: put back whatever was there (another dev server may use it).
const DEPLOY = join(RAIZ, "contratos/deploy/31337.json");
const deployAntes = existsSync(DEPLOY) ? readFileSync(DEPLOY) : null;
const deployCopia = join(estadoDir, "31337.json");
const limpiar = () => {
  if (deployAntes) writeFileSync(DEPLOY, deployAntes);
  for (const c of hijos) {
    try {
      process.kill(-c.pid, "SIGTERM");
    } catch {
      /* already gone */
    }
  }
  rmSync(estadoDir, { recursive: true, force: true });
};
process.on("exit", limpiar);
process.on("SIGINT", () => process.exit(130));

let BASE = EXTERNO;
let anvil;
if (!EXTERNO) {
anvil = spawn("anvil", ["--port", String(anvilPuerto), "--chain-id", "31337", "--silent"], { detached: true, stdio: "ignore" });
hijos.push(anvil);
for (let i = 0; i < 50; i++) {
  try {
    await run("cast", ["chain-id", "--rpc-url", RPC]);
    break;
  } catch {
    await pausa(200);
  }
}
await run(join(RAIZ, "contratos/desplegar-anvil.sh"), [RPC], { cwd: RAIZ, maxBuffer: 1 << 24 });
writeFileSync(deployCopia, readFileSync(DEPLOY));
if (deployAntes) writeFileSync(DEPLOY, deployAntes);

const env = {
  ...process.env, CADENA_MODO: "real", CADENA_RPC: RPC, CADENA_CHAIN_ID: "31337", CADENA_CLAVE_DEV: CLAVE_DEV,
  CADENA_DEPLOY: deployCopia, DEV: "1", STATE_DIRECTORY: estadoDir,
  // Empty values win over .env, which may point at the Base Sepolia keystore
  CADENA_KEYSTORE: "", CADENA_KEYSTORE_CLAVE_ARCHIVO: "", CADENA_MIN_ETH: "0.0005",
};
const servidor = spawn("uv", ["run", "uvicorn", "backend.app:app", "--host", "127.0.0.1", "--port", String(puerto)],
  { cwd: RAIZ, env, detached: true, stdio: "ignore" });
hijos.push(servidor);
BASE = `http://127.0.0.1:${puerto}`;
for (let i = 0; i < 80; i++) {
  try {
    if ((await fetch(`${BASE}/blockchain-dev/api/estado`)).ok) break;
  } catch {
    await pausa(250);
  }
}
}
const estado = await (await fetch(`${BASE}/blockchain-dev/api/estado`)).json();
// Name the UI uses for the network ("Anvil local", "Base Sepolia")
const RED = EXTERNO ? estado.cadena.red : "Anvil local";
if (!estado.cadena?.disponible) {
  console.error("el backend no quedó en modo real:", JSON.stringify(estado.cadena));
  process.exit(1);
}

process.env.BCW_BASE = BASE;
const { abrir, sleep, sse } = await import("./navegador.mjs");
const soloChat = (req) => req.url.endsWith("/chat")
  ? { tipo: "text/event-stream", cuerpo: sse([["texto", { t: "Respuesta de prueba." }], ["fin", { modelo: "simulado" }]]) }
  : null;

const b = await abrir({ ancho, alto, mocks: soloChat });
const fallas = [];
const paso = async (nombre, ok) => {
  if (!(await ok)) fallas.push(nombre);
};
const HASH = /0x[0-9a-f]{64}/;
const textoDe = (sel) => b.ev(`[...document.querySelectorAll(${JSON.stringify(sel)})].map(e=>e.innerHTML).join(' | ')`);
const hayHash = (sel, ms = 35000) => b.esperar(`[...document.querySelectorAll(${JSON.stringify(sel)})].some(e=>/0x[0-9a-f]{64}/.test(e.innerHTML))`, ms);

await b.ir("/blockchain-dev/?bcw=open");
await b.ev(`window.__simnotes = []; new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => n.classList?.contains('bcw-simnote') && window.__simnotes.push(n.textContent)))).observe(document.body, {childList: true, subtree: true}); 1`);
await paso("cartel de la red", b.esperar(`document.querySelector(".bcw-badge")?.classList.contains("bcw-live") && document.querySelector(".bcw-badge").textContent.includes(${JSON.stringify(RED)})`));
await sleep(800);
await b.captura("real-01-portada");
await paso("mapa", b.tocar(".bcw-herochips .bcw-chip", "Ver los 4 niveles"));

// Level 1: seal on chain
await paso("nivel 1", b.chip("Nivel 1"));
await paso("nivel 1 pide texto", b.esperarPregunta("cadena"));
await b.escribir("Hola cadena real desde Luján");
await paso("wallet real (nota de prueba)", b.esperar(`[...document.querySelectorAll('.bcw-wnote')].some(e=>e.textContent.includes('no le mandes plata real'))`, 20000));
const direccion = await b.ev(`(document.querySelector('.bcw-addr')?.textContent || '').match(/0x[0-9a-fA-F]{40}/)?.[0] || ''`);
await paso("sello: hash real", hayHash(".bcw-tx-real"));
const sello = await textoDe(".bcw-tx-real");
await b.captura("real-02-sello");
await paso("seguir", b.chip("Seguir sin romper nada", 25000));
await paso("insignia 1", b.esperar(`!!document.querySelector('.bcw-award')`));
await paso("insignia 1 acuñada", b.esperar(`[...document.querySelectorAll('.bcw-award-s')].some(e=>e.textContent.includes('acuñado en ${RED}'))`, 20000));
await b.captura("real-03-insignia");
await b.sinPremio();

// Level 2: real ERC-20 through the factory
await paso("nivel 2", b.chip("Nivel 2", 20000));
await paso("nivel 2 pide nombre", b.esperarPregunta("moneda"));
await b.escribir("Mate Coin");
await paso("supply", b.chip("1.000.000"));
await paso("token: hash real", hayHash(".bcw-tx-real"));
const token = await textoDe(".bcw-tx-real");
await b.captura("real-04-token");
await paso("pool", b.chip("Crear el pool", 25000));
await paso("pool rotulado como simulado", b.esperar(`!!document.querySelector('.bcw-simlabel')`));
await b.tocar('.bcw-trade [data-a="buy"]');
await sleep(300);
await b.tocar('.bcw-trade [data-a="buy"]');
await sleep(2500);
await b.tocar('.bcw-trade [data-a="whale"]');
await paso("rug pull", b.chip("Retirar toda la liquidez", 20000));
await sleep(2500);
await b.sinPremio();

// Level 3: live block number
await paso("nivel 3", b.chip("Nivel 3", 20000));
await paso("bloque en vivo", b.esperar(`(() => { const e = document.querySelector('.bcw-livebloque'); return e && !e.hidden && /#\\d+/.test(e.textContent); })()`, 15000));
await b.captura("real-05-red");
const nodo = (i) => b.ev(`document.querySelectorAll('.bcw-node')[${i}].dispatchEvent(new MouseEvent('click',{bubbles:true}))`);
await sleep(1500);
await nodo(1);
await sleep(3000);
await nodo(3);
await nodo(5);
await paso("sin quórum", b.esperar(`[...document.querySelectorAll('.bcw-msg')].some(m=>m.textContent.includes('no hay quórum'))`, 20000));
await nodo(5);
await paso("capa 2", b.chip("capa 2", 20000));
await paso("mandar 100 tx", b.tocar(".bcw-send"));
await sleep(3500);
await b.sinPremio();

// Level 4: fund, pay, revert
await paso("nivel 4", b.chip("Nivel 4", 20000));
await paso("saldo real 100 USDL", b.esperar(`[...document.querySelectorAll('.bcw-msg')].some(m=>m.textContent.includes('100 USDL de prueba en ${RED}'))`, 35000));
await paso("producto", b.tocar(".bcw-product", "Apunte"));
await paso("approve", b.tocar('[data-s="1"] .bcw-sign'));
await paso("pago", b.tocar('[data-s="2"] .bcw-sign'));
await paso("pago: hash real", hayHash(".bcw-tx-real"));
const pago = await textoDe(".bcw-tx-real");
await b.captura("real-06-recibo");
await paso("revert", b.chip("auto 0 km", 20000));
await paso("revert real 409", b.esperar(`[...document.querySelectorAll('.bcw-revreal')].some(e=>e.textContent.includes('85 USDL') && e.textContent.includes('500 USDL'))`, 35000));
await b.captura("real-07-revert");
await paso("certificado", b.esperar(`!!document.querySelector('.bcw-cert')`, 30000));
await paso("certificado acuñado", b.esperar(`[...document.querySelectorAll('.bcw-certtx')].some(e=>e.textContent.includes('NFT #'))`, 35000));
await b.captura("real-08-certificado");

// Bonus NFT with the visitor's name (tipo 4)
await paso("bonus nft", b.chip("Hacete un NFT", 20000));
await paso("diseño", b.chip("Búho"));
await paso("nombre nft", b.esperarPregunta("NFT"));
await b.escribir("Ana");
await paso("nft: hash real", b.esperar(`[...document.querySelectorAll('.bcw-tx-real')].some(e=>e.textContent.includes('minteado en ${RED}') && /0x[0-9a-f]{64}/.test(e.innerHTML))`, 35000));
await b.captura("real-09-nft");
await b.sinPremio();

// "Ver por dentro" › La cadena › Transacciones reales
await b.tocar(".bcw-dentro-btn");
await b.tocar('.bcw-dtabs button[data-t="cadena"]');
await sleep(800);
const lista = await b.ev(`[...document.querySelectorAll('.bcw-rtxs li')].map(li=>({t: li.querySelector('b').textContent, tx: (li.textContent.match(/0x[0-9a-f]{64}/)||[])[0]}))`);
await b.captura("real-10-dentro");
const titulos = (lista || []).map((x) => x.t).join(" | ");
for (const [que, re] of [["sello", /Sello/], ["token", /Token MC|Token/], ["faucet", /Faucet/], ["pago", /Pago/],
  ["insignia curso", /NFT · Insignia/], ["certificado", /NFT · Recorrido/], ["nft bonus", /NFT · Ana/]])
  if (!re.test(titulos)) fallas.push(`falta tx real de ${que} en Ver por dentro`);
const insignias = (lista || []).filter((x) => /NFT · Insignia/.test(x.t)).length;
if (insignias < 4) fallas.push(`insignias reales ${insignias}/4`);

// Every hash is a mined, successful tx on our Anvil
let verificadas = 0;
for (const x of lista || []) {
  if (!x.tx) {
    fallas.push(`sin hash: ${x.t}`);
    continue;
  }
  try {
    const { stdout } = await run("cast", ["receipt", x.tx, "status", "--rpc-url", RPC]);
    if (/1|success/.test(stdout)) verificadas++;
    else fallas.push(`tx fallida ${x.t}: ${stdout.trim()}`);
  } catch {
    fallas.push(`tx desconocida para Anvil: ${x.t}`);
  }
}
const simuladas = await b.ev("window.__simnotes");

// Nobody else can act for this wallet: without the visitor's signature the relayer sends nothing.
if (!direccion) fallas.push("no encontré la dirección de la wallet");
for (const [accion, cuerpo] of [["pagar", { direccion, producto: "entrada" }], ["insignia", { direccion, tipo: 4, nombre: "ESTAFADOR" }],
  ["fondear", { direccion }]]) {
  const r = await fetch(`${BASE}/blockchain-dev/api/cadena/${accion}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) });
  const d = await r.json().catch(() => ({}));
  if (r.status !== 401) fallas.push(`${accion} sin firma respondió ${r.status} ${JSON.stringify(d)}`);
}

// Same browser, new visit: the wallet comes back from localStorage; the bonus NFT keeps its on-chain name, and level 4
// starts from the real balance left (85 USDL) without a second faucet.
await b.ir("/blockchain-dev/?bcw=open");
await b.esperar(`document.querySelector(".bcw-badge")?.classList.contains("bcw-live")`);
await b.ev(`window.__simnotes = []; new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => n.classList?.contains('bcw-simnote') && window.__simnotes.push(n.textContent)))).observe(document.body, {childList: true, subtree: true}); 1`);
await paso("mapa (2.ª visita)", b.tocar(".bcw-herochips .bcw-chip", "Ver los 4 niveles"));
await paso("bonus nft otra vez", b.chip("Bonus: tu NFT", 20000));
await paso("diseño (2.ª)", b.chip("Planeta"));
await paso("nombre nft (2.ª)", b.esperarPregunta("NFT"));
await b.escribir("Otro nombre");
await paso("wallet recuperada", b.esperar(`[...document.querySelectorAll('.bcw-msg')].some(m=>m.textContent.includes('Recuperé tu wallet'))`, 20000));
await paso("nft: ya tenía, con el nombre de la cadena", b.esperar(`[...document.querySelectorAll('.bcw-msg')].some(m=>m.textContent.includes('ya tenía su NFT bonus') && m.textContent.includes('Ana') && !m.textContent.includes('Otro nombre'))`, 35000));
await b.captura("real-11-nft-ya-tenia");
await b.sinPremio();
await paso("mapa (2.ª, nivel 4)", b.chip("Ver el mapa", 20000));
await paso("nivel 4 (2.ª)", b.tocar(".bcw-level", "Pagá con cripto", 20000));
await paso("saldo real que quedó", b.esperar(`[...document.querySelectorAll('.bcw-msg')].some(m=>m.textContent.includes('85 USDL de prueba en ${RED}'))`, 35000));
const productos = await b.ev(`[...document.querySelectorAll('.bcw-product')].map(p => [p.textContent, p.disabled])`);
if (!productos?.length || productos.some(([t, d]) => d !== Number(t.match(/(\d+) USDL/)[1]) > 85)) fallas.push(`productos: ${JSON.stringify(productos)}`);
const simuladas2 = await b.ev("window.__simnotes");
if (simuladas2?.length) fallas.push(...simuladas2.map((s) => `cayó a simulada (2.ª visita): ${s}`));

// The node goes down while level 3 is on screen: no frozen block number, the header says it.
await b.chip("Mejor otra cosa", 20000);
await paso("nivel 3 (2.ª)", b.tocar(".bcw-level", "Intentá tirar la red", 20000));
if (!(await b.esperar(`(() => { const e = document.querySelector('.bcw-livebloque'); return e && !e.hidden && /#\\d+/.test(e.textContent); })()`, 15000)))
  fallas.push(`bloque en vivo (2.ª): ${await b.ev(`document.querySelector('.bcw-livebloque')?.outerHTML || document.querySelector('.bcw-scene')?.textContent.slice(0, 200)`)}`);
// Only when we own the node (local Anvil): a public network can't be taken down from here.
if (!EXTERNO) {
try {
  process.kill(-anvil.pid, "SIGTERM");
} catch {
  /* already gone */
}
await paso("sin conexión en el nivel 3", b.esperar(`document.querySelector('.bcw-livebloque')?.textContent.includes('Sin conexión')`, 25000));
await paso("cartel: sin conexión", b.esperar(`document.querySelector('.bcw-badge')?.textContent.includes('sin conexión')`, 25000));
await b.captura("real-12-sin-red");
}
if (simuladas?.length) fallas.push(...simuladas.map((s) => `cayó a simulada: ${s}`));
if (!HASH.test(sello) || !HASH.test(token) || !HASH.test(pago)) fallas.push("algún recibo sin hash");
if (b.errores.length) fallas.push(...b.errores.map((e) => `error JS: ${e}`));
console.log(JSON.stringify({ ancho, anvil: RPC, servidor: BASE, txs: lista?.length, verificadas, titulos, fallas }, null, 1));
b.cerrar();
process.exit(fallas.length ? 1 : 0);
