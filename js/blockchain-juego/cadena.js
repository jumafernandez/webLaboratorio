// A real hash chain running in the visitor's browser: SHA-256, proof of work and tamper detection.

import { esc, h, sha256, short, sleep } from "./util.js";

export const DIFFICULTY = "000";
export const chain = [];
// Called with every new block (background, "Ver por dentro").
export const onBlock = new Set();

const payload = (b) => `${b.n}|${b.prev}|${b.data}|${b.nonce}`;

export async function mine(b, onTick) {
  const t0 = performance.now();
  b.nonce = 0;
  for (;;) {
    const hash = await sha256(payload(b));
    if (hash.startsWith(DIFFICULTY)) {
      b.hash = hash;
      return b;
    }
    b.nonce++;
    // Yield every few tries so the visitor sees the search; after 3.5 s go full speed.
    if (onTick && b.nonce % 6 === 0 && performance.now() - t0 < 3500) {
      onTick(b.nonce, hash);
      await sleep(0);
    }
  }
}

export async function addBlock(data, who, extra = {}, onTick) {
  const prev = chain.length ? chain[chain.length - 1].hash : "0".repeat(64);
  const b = await mine({ n: chain.length, prev, data, who, nonce: 0, hash: "", ...extra }, onTick);
  chain.push(b);
  onBlock.forEach((f) => f(b));
  return b;
}

export const ready = (async () => {
  await addBlock("Génesis · LICDIA UNLu", "Red");
  await addBlock("Hola desde Luján 👋", "Visitante");
  await addBlock("Mi primer bloque 🚀", "Visitante");
})();

export function blockEl(b) {
  const el = h("div", `bcw-block${b.mine ? " bcw-mine" : ""}`);
  el.innerHTML = `
    <div class="bcw-bn">Bloque #${b.n}<span class="bcw-who">${esc(b.who)}</span></div>
    <div class="bcw-row"><span class="bcw-k">Datos</span><div class="bcw-data">${esc(b.data)}</div></div>
    <div class="bcw-row"><span class="bcw-k">Hash anterior</span><span class="bcw-v">${short(b.prev, 10, 4)}</span></div>
    <div class="bcw-row"><span class="bcw-k">Hash</span><span class="bcw-v bcw-h">${short(b.hash, 10, 4)}</span></div>
    <div class="bcw-row"><span class="bcw-k">Nonce</span><span class="bcw-v bcw-nonce">${b.nonce}</span></div>`;
  return el;
}

export function chainEl() {
  const wrap = h("div", "bcw-chain");
  chain.forEach((b, i) => {
    if (i) wrap.append(h("div", "bcw-link"));
    b.el = blockEl(b);
    wrap.append(b.el);
  });
  requestAnimationFrame(() => (wrap.scrollLeft = wrap.scrollWidth));
  return wrap;
}

// Recompute every hash from what is on screen and paint broken blocks and links.
let checkToken = 0;
export async function checkChain() {
  const token = ++checkToken;
  const cur = [];
  for (const b of chain) {
    const data = b.el ? b.el.querySelector(".bcw-data").textContent : b.data;
    cur.push(await sha256(payload({ ...b, data })));
  }
  if (token !== checkToken) return null;
  let broken = false;
  chain.forEach((b, i) => {
    if (!b.el) return;
    const bad = cur[i] !== b.hash;
    b.el.classList.toggle("bcw-bad", bad);
    b.el.querySelector(".bcw-h").textContent = short(cur[i], 10, 4);
    const link = b.el.previousElementSibling;
    if (i > 0 && link) link.classList.toggle("bcw-bad", b.prev !== cur[i - 1]);
    broken ||= bad;
  });
  return broken;
}
