// Level 3 · Course 3 (infrastructure): a 7-node network reaching consensus (5 of 7), the visitor turns nodes off
// until it halts, then a layer-2 batch that packs many transactions into one.

import { addBlock } from "../cadena.js";
import * as real from "../cadena-real.js";
import { POINT, REDUCE, ejemploEl, h, sleep } from "../util.js";

const CITIES = ["Luján", "CABA", "Rosario", "Córdoba", "Mendoza", "Salta", "Bariloche"];
const QUORUM = 5;
const NS = "http://www.w3.org/2000/svg";

function svgEl(tag, attrs) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

export default async function nivel3(ctx, { ejemplo } = {}) {
  const W = 420;
  const H = 280;
  const pos = CITIES.map((_, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / CITIES.length;
    return [W / 2 + Math.cos(a) * 150, H / 2 + Math.sin(a) * 105];
  });
  const on = CITIES.map(() => true);
  let blocks = 0;
  let halted = 0;
  let notify = () => {};

  const sc = ctx.scene((s) => {
    s.innerHTML = `<div class="bcw-kicker">Nivel 3 · Curso 3 · Infraestructura</div><h3>Intentá tirar la red</h3>
      <p class="bcw-lead">7 nodos repartidos por el país validan cada bloque. Hace falta el OK de <b>5 de 7</b>. Tocá un nodo para apagarlo o prenderlo.</p>
      <div class="bcw-net"></div>
      <div class="bcw-netbar"><span class="bcw-alive"></span><span class="bcw-blocks"></span></div>
      <div class="bcw-alert bcw-ok bcw-netmsg">La red está sana: cada bloque recibe 7 de 7 votos.</div>
      <div class="bcw-livebloque" hidden></div>`;
    const ej = ejemploEl(ejemplo);
    if (ej) s.querySelector(".bcw-lead").after(ej);
  });
  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, class: "bcw-netsvg" });
  const links = svgEl("g", {});
  const packets = svgEl("g", {});
  const nodesG = svgEl("g", {});
  for (let i = 0; i < pos.length; i++)
    for (let j = i + 1; j < pos.length; j++)
      links.append(svgEl("line", { x1: pos[i][0], y1: pos[i][1], x2: pos[j][0], y2: pos[j][1], class: "bcw-nl", "data-a": i, "data-b": j }));
  const nodeEls = pos.map(([x, y], i) => {
    const g = svgEl("g", { class: "bcw-node", tabindex: "0", role: "button", "aria-pressed": "true", "aria-label": `Nodo ${CITIES[i]}: encendido` });
    g.append(svgEl("circle", { cx: x, cy: y, r: 21 }));
    const t = svgEl("text", { x, y: y + 5, "text-anchor": "middle", class: "bcw-nicon" });
    t.textContent = "🖥️";
    const lb = svgEl("text", { x, y: y + 38, "text-anchor": "middle", class: "bcw-nlabel" });
    lb.textContent = CITIES[i];
    g.append(t, lb);
    const toggle = () => {
      on[i] = !on[i];
      g.classList.toggle("bcw-off", !on[i]);
      t.textContent = on[i] ? "🖥️" : "💤";
      g.setAttribute("aria-pressed", String(on[i]));
      g.setAttribute("aria-label", `Nodo ${CITIES[i]}: ${on[i] ? "encendido" : "apagado"}`);
      paint();
      notify();
    };
    g.addEventListener("click", toggle);
    g.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault(); // Space would scroll the stage
      toggle();
    });
    nodesG.append(g);
    return g;
  });
  svg.append(links, packets, nodesG);
  sc.querySelector(".bcw-net").append(svg);

  // Real chain: the latest block number of the actual network, refreshed while the scene is on screen.
  if (real.REAL.on) {
    (async () => {
      let fallos = 0;
      while (sc.isConnected && ctx.alive()) {
        const n = await real.bloqueActual();
        const el = sc.querySelector(".bcw-livebloque");
        fallos = n == null ? fallos + 1 : 0;
        if (el && n != null) {
          el.hidden = false;
          el.classList.remove("bcw-sinred");
          el.innerHTML = `<span class="bcw-livedot"></span>En vivo: <b>${real.nombreRed()}</b> va por el bloque <b>#${n.toLocaleString("es-AR")}</b> · esta red de 7 nodos es una simulación`;
        } else if (el && fallos >= 2 && !el.hidden) {
          // Never leave a stale block number with a pulsing "live" dot when the node stopped answering.
          el.classList.add("bcw-sinred");
          el.innerHTML = `Sin conexión con <b>${real.nombreRed()}</b> · reintentando… · esta red de 7 nodos es una simulación`;
        }
        await sleep(fallos ? 3000 : 4000);
      }
    })();
  }

  const alive = () => on.filter(Boolean).length;
  const paint = () => {
    links.querySelectorAll("line").forEach((l) => l.classList.toggle("bcw-dead", !on[l.dataset.a] || !on[l.dataset.b]));
    const a = alive();
    sc.querySelector(".bcw-alive").innerHTML = `Nodos activos: <b class="${a >= QUORUM ? "bcw-up" : "bcw-down"}">${a} de 7</b> · quórum ${QUORUM}`;
    sc.querySelector(".bcw-blocks").innerHTML = `Bloques confirmados: <b>${blocks}</b>`;
  };
  paint();

  // Gossip: the proposer sends the block to every live node; votes come back; 5+ confirms.
  const fly = (from, to) => {
    if (REDUCE) return; // reduced motion: votes show on the nodes, without packets flying
    const c = svgEl("circle", { r: 5, class: "bcw-packet", cx: pos[from][0], cy: pos[from][1] });
    packets.append(c);
    const t0 = performance.now();
    const step = (t) => {
      const k = Math.min(1, (t - t0) / 520);
      c.setAttribute("cx", pos[from][0] + (pos[to][0] - pos[from][0]) * k);
      c.setAttribute("cy", pos[from][1] + (pos[to][1] - pos[from][1]) * k);
      if (k < 1) requestAnimationFrame(step);
      else c.remove();
    };
    requestAnimationFrame(step);
  };
  const msg = (html, bad) => {
    const m = sc.querySelector(".bcw-netmsg");
    m.className = `bcw-alert ${bad ? "bcw-err" : "bcw-ok"} bcw-netmsg`;
    m.innerHTML = html;
  };
  (async () => {
    while (sc.isConnected && ctx.alive()) {
      const live = on.map((v, i) => (v ? i : -1)).filter((i) => i >= 0);
      if (live.length) {
        const p = live[Math.floor(Math.random() * live.length)];
        nodeEls[p].classList.add("bcw-proposer");
        live.filter((i) => i !== p).forEach((i) => fly(p, i));
        await sleep(650);
        nodeEls[p].classList.remove("bcw-proposer");
        if (!sc.isConnected) break;
        if (alive() >= QUORUM) {
          blocks++;
          live.forEach((i) => {
            nodeEls[i].classList.add("bcw-voted");
            setTimeout(() => nodeEls[i].classList.remove("bcw-voted"), 500);
          });
          msg(`✅ Bloque #${blocks} confirmado con <b>${alive()} de 7</b> votos.`);
        } else {
          halted++;
          msg(`⛔ <b>Sin quórum:</b> solo ${alive()} de 7 nodos votaron. La red <b>se frena</b> antes que aceptar algo dudoso.`, true);
        }
        paint();
        notify();
      }
      await sleep(1500);
    }
  })();

  await ctx.bot("**Nivel 3 · Curso 3.** Una blockchain no vive en un servidor: vive en **muchos nodos** que se ponen de acuerdo. Esta red tiene 7, repartidos por el país.");
  await ctx.bot(`Cada bloque necesita el OK de **al menos 5 de 7**. Intentá **tirar la red**: tocá nodos para apagarlos ${POINT}`);
  ctx.escape();
  await ctx.until(new Promise((resolve) => ((notify = () => alive() < 7 && resolve()), notify())));
  ctx.paso("nodo_apagado");
  await ctx.bot("Apagaste uno… y la red **sigue andando**. Ningún nodo es imprescindible: no hay un servidor central que tirar.");
  await ctx.until(new Promise((resolve) => ((notify = () => halted > 0 && alive() < QUORUM && resolve()), notify())));
  ctx.paso("sin_quorum");
  await ctx.bot("⛔ Ahora sí: con menos de 5 nodos no hay quórum y **la red se frena**. Prefiere parar antes que aceptar algo dudoso. Prendé alguno de nuevo.");
  await ctx.until(new Promise((resolve) => ((notify = () => alive() >= QUORUM && resolve()), notify())));
  notify = () => {};
  ctx.paso("recuperada");
  await ctx.bot("Y vuelve sola, sin que nadie la «reinicie». Eso es **tolerancia a fallas**.");
  await addBlock("🌐 Red recuperada tras perder el quórum", "Red");

  await ctx.bot("Última pregunta: si cada pago tuviera que pasar por todos los nodos de Ethereum, sería lento y caro. ¿Cómo escala?");
  await ctx.choose([{ l: "🚀 Mostrame la capa 2" }]);
  ctx.paso("capa2");
  let sent = () => {};
  const l2 = ctx.scene((s) => {
    s.innerHTML = `<div class="bcw-kicker">Nivel 3 · Capa 2</div><h3>Muchas transacciones, un solo paquete</h3>
      <p class="bcw-lead">Una capa 2 (como Base, la red del Curso 4) ejecuta las transacciones afuera y publica en Ethereum un solo paquete que las resume.</p>
      <div class="bcw-lanes">
        <div class="bcw-lane"><span>Capa 2 · Base</span><div class="bcw-dots"></div></div>
        <div class="bcw-batchbox">📦 <b class="bcw-bn2">0</b> tx</div>
        <div class="bcw-lane bcw-l1"><span>Capa 1 · Ethereum</span><div class="bcw-l1blocks"></div></div>
      </div>
      <div class="bcw-actions"><button type="button" class="bcw-cta bcw-primary bcw-send">⚡ Mandar 100 transacciones</button></div>
      <div class="bcw-alert bcw-ok bcw-l2msg" hidden></div>`;
  });
  l2.querySelector(".bcw-send").addEventListener("click", async (e) => {
    e.target.disabled = true;
    const dots = l2.querySelector(".bcw-dots");
    const counter = l2.querySelector(".bcw-bn2");
    for (let i = 1; i <= 100; i++) {
      const d = h("i", "bcw-dot");
      dots.append(d);
      counter.textContent = i;
      if (i % 4 === 0) await sleep(16);
    }
    await sleep(300);
    dots.classList.add("bcw-squash");
    await sleep(600);
    l2.querySelector(".bcw-batchbox").classList.add("bcw-drop");
    await sleep(700);
    l2.querySelector(".bcw-l1blocks").append(h("div", "bcw-l1b", "📦 1 paquete = 100 tx"));
    const m = l2.querySelector(".bcw-l2msg");
    m.hidden = false;
    m.innerHTML = "✅ Ethereum recibió <b>una sola</b> publicación en lugar de 100. El costo se reparte entre todas: por eso pagar en una capa 2 sale mucho menos.";
    sent();
  });
  const done = new Promise((resolve) => (sent = resolve));
  await ctx.bot(`Tocá **Mandar 100 transacciones** y mirá qué llega a Ethereum ${POINT}`);
  await ctx.until(done);
  ctx.paso("paquete");
  await ctx.sleep(900);
  ctx.addLog("🌐", "Tiraste la red y volvió", `${blocks} bloques confirmados · 100 tx en un paquete de capa 2`);
  await ctx.award("c3");
  await ctx.bridge(3, `En el **Curso 3** montás esta infraestructura de verdad: nodos en la nube, contenedores, infraestructura como código y redes de capa 1 y capa 2 ${POINT}`);
  await ctx.next();
}
