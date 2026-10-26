// Level 2 · Course 2 (DeFi): create an ERC-20, open a constant-product pool (x·y=k), move the price, and see a rug pull.

import { addBlock } from "../cadena.js";
import * as real from "../cadena-real.js";
import { POINT, ejemploEl, esc, fmt, h, randHex, short } from "../util.js";

function symbolOf(name) {
  const words = name.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().match(/[A-Z0-9]+/g) || ["TKN"];
  const sym = words.length > 1 ? words.map((w) => w[0]).join("") + (words.length < 3 ? words[words.length - 1].slice(1, 3) : "") : words[0].slice(0, 4);
  return sym.slice(0, 5) || "TKN";
}

function chartSVG(points) {
  const w = 420;
  const hgt = 120;
  const max = Math.max(...points, 1);
  const step = points.length > 1 ? w / (points.length - 1) : w;
  const pts = points.map((p, i) => `${(i * step).toFixed(1)},${(hgt - (p / max) * (hgt - 10) - 4).toFixed(1)}`).join(" ");
  const last = points[points.length - 1];
  const color = last >= points[0] ? "#2ee59d" : "#ff5a6e";
  return `<svg viewBox="0 0 ${w} ${hgt}" preserveAspectRatio="none" class="bcw-chart-svg">
    <line x1="0" y1="${hgt - (points[0] / max) * (hgt - 10) - 4}" x2="${w}" y2="${hgt - (points[0] / max) * (hgt - 10) - 4}" stroke="rgba(255,255,255,.18)" stroke-dasharray="4 4"/>
    <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="3" stroke-linejoin="round"/></svg>`;
}

export default async function nivel2(ctx, { ejemplo } = {}) {
  const S = ctx.S;
  ctx.scene((s) => {
    s.innerHTML = `<div class="bcw-kicker">Nivel 2 · Curso 2 · DeFi</div><h3>Creá tu propia moneda</h3>
      <p class="bcw-lead">Un token ERC-20 es un contrato que lleva la cuenta de quién tiene cuánto. Lo vas a crear, a darle un mercado y a mover su precio.</p>
      <div class="bcw-token bcw-preview"><div class="bcw-coin">?</div><div><b class="bcw-tname">Tu moneda</b><small class="bcw-tsym">???</small></div></div>`;
    const ej = ejemploEl(ejemplo);
    if (ej) s.querySelector(".bcw-lead").after(ej);
  });
  const preview = (v) => {
    const p = ctx.stage.querySelector(".bcw-preview");
    if (!p) return;
    p.querySelector(".bcw-tname").textContent = v || "Tu moneda";
    p.querySelector(".bcw-tsym").textContent = v ? symbolOf(v) : "???";
    p.querySelector(".bcw-coin").textContent = v ? symbolOf(v)[0] : "?";
  };
  await ctx.bot("**Nivel 2 · Curso 2.** Vamos a crear **tu propia criptomoneda**. ¿Cómo se llama?");
  ctx.escape();
  const name = await ctx.askPublico({ placeholder: "Nombre de tu moneda (ej: Mate Coin)", onInput: preview, max: 24, derivados: (v) => [symbolOf(v)] });
  const sym = symbolOf(name);
  ctx.paso("nombre");
  await ctx.bot(`**${esc(name)}** (${sym}). ¿Cuántas monedas van a existir en total?`);
  const supply = Number(await ctx.choose([
    { l: "1.000", v: 1000 },
    { l: "1.000.000", v: 1e6 },
    { l: "21.000.000 (como Bitcoin)", v: 21e6 },
  ]));
  ctx.paso("supply");

  await ctx.ensureWallet();
  // Real chain: FabricaTokens deploys the ERC-20 and mints the whole supply to the visitor's address.
  const deploy = ctx.realTx("token", () => real.crearToken(S.wallet, real.recortarBytes(name.trim(), 24) || sym, sym, supply), {
    titulo: `Token ${sym}`, extra: `${name} · ${fmt(supply)} ${sym}`, espera: `Desplegando ${sym} en ${real.nombreRed()}…` });
  deploy.catch(() => {});
  const sc = ctx.scene((s) => {
    s.innerHTML = `<div class="bcw-kicker">Nivel 2 · Deploy</div><h3>Desplegando ${esc(sym)}…</h3><div class="bcw-minting"></div>`;
  });
  for (const l of [`→ compilando ${sym}.sol (ERC-20, OpenZeppelin)`, "→ desplegando el contrato en la red…", `→ mint(${short(S.wallet, 6, 4)}, ${fmt(supply)})`]) {
    const p = h("div");
    p.textContent = l;
    sc.querySelector(".bcw-minting").append(p);
    await ctx.sleep(650);
  }
  const rt = await deploy;
  ctx.paso("deploy");
  const contract = rt?.token || `0x${randHex(20)}`;
  await addBlock(`🪙 Deploy ${sym} (${fmt(supply)})`, "Vos");
  S.balances[sym] = supply;
  ctx.scene((s) => {
    s.innerHTML = `<div class="bcw-kicker">Nivel 2 · Tu moneda</div><h3>¡${esc(name)} existe! 🪙</h3>`;
    s.append(h("div", "bcw-token", `<div class="bcw-coin">${esc(sym[0])}</div><div><b>${esc(name)}</b><small>${esc(sym)} · ERC-20 · contrato ${rt?.explorador_token ? real.linkHTML(rt.explorador_token, short(contract, 8, 4)) : short(contract, 8, 4)}</small></div>`));
    if (rt) {
      const r = h("div", "bcw-tx bcw-tx-real");
      r.innerHTML = `<div class="bcw-txh">✓ ${esc(sym)} desplegado en ${esc(real.nombreRed())}</div>
        <dl>${real.filasTx(rt)}<dt>Contrato</dt><dd>${esc(contract)}</dd><dt>Supply</dt><dd>${fmt(supply)} ${esc(sym)} → tu wallet</dd></dl>`;
      s.append(r);
    }
    s.append(ctx.walletCard());
  });
  ctx.addLog("🪙", `Creaste ${name} (${sym})`, `${fmt(supply)} monedas · contrato ${short(contract, 10, 4)}${rt ? ` · ${real.nombreRed()}` : real.marcaSimulada()}`, rt?.explorador_token || rt?.explorador_tx);
  await ctx.bot(`¡Listo! Tenés **todas** las ${sym}. Pero una moneda sin mercado no vale nada: nadie te la puede comprar.`);
  await ctx.bot("Armemos un **pool de liquidez**: ponés la mitad de tus monedas y 1 ETH de prueba. Desde ahí el precio lo fija una fórmula: **x · y = k**.");
  await ctx.choose([{ l: "💧 Crear el pool" }]);
  ctx.paso("pool");

  // Constant product pool. Price = ETH per token; shown as % change vs the opening price.
  let x = 1;
  let y = supply / 2;
  const k0 = () => x * y;
  S.balances[sym] = supply / 2;
  const p0 = x / y;
  const hist = [100];
  let buys = 0;
  let whale = false;
  let rugged = false;
  let notify = () => {};
  const event = (kind) => notify(kind);

  const pool = ctx.scene((s) => {
    s.innerHTML = `<div class="bcw-kicker">Nivel 2 · Pool de liquidez${rt ? " · simulado" : ""}</div><h3>El mercado de ${esc(sym)}</h3>
      ${rt ? `<p class="bcw-simlabel">Tu token es real en ${esc(real.nombreRed())}; el pool y los compradores son una simulación en tu navegador.</p>` : ""}
      <div class="bcw-pool">
        <div class="bcw-tank"><div class="bcw-fill bcw-eth"></div><b class="bcw-tx-eth"></b><small>ETH</small></div>
        <div class="bcw-k"><span>x · y = k</span><b class="bcw-pchg"></b><small class="bcw-rate"></small></div>
        <div class="bcw-tank"><div class="bcw-fill bcw-tok"></div><b class="bcw-tx-tok"></b><small>${esc(sym)}</small></div>
      </div>
      <div class="bcw-chart"></div>
      <div class="bcw-trade">
        <button type="button" class="bcw-cta" data-a="buy">🛒 Entra un comprador (0,1 ETH)</button>
        <button type="button" class="bcw-cta" data-a="whale">🐋 Entra una ballena (1 ETH)</button>
        <button type="button" class="bcw-cta" data-a="sell">📉 Vendés 10% de tus ${esc(sym)}</button>
      </div>
      <div class="bcw-alert bcw-ok bcw-poolmsg">El pool está abierto: cada compra cambia las reservas y, con ellas, el precio.</div>`;
  });
  const startX = x;
  const startY = y;
  const render = (msg, bad) => {
    const pct = rugged ? 0 : (x / y / p0) * 100;
    pool.querySelector(".bcw-tx-eth").textContent = `${fmt(x, 3)}`;
    pool.querySelector(".bcw-tx-tok").textContent = fmt(y);
    pool.querySelector(".bcw-eth").style.height = `${Math.min(100, (x / (startX * 3)) * 100)}%`;
    pool.querySelector(".bcw-tok").style.height = `${Math.min(100, (y / (startY * 1.6)) * 100)}%`;
    const delta = pct - 100;
    const pr = pool.querySelector(".bcw-pchg");
    pr.textContent = rugged ? "−100%" : `${delta >= 0 ? "+" : ""}${fmt(delta, 1)}%`;
    pr.className = `bcw-pchg ${delta >= 0 && !rugged ? "bcw-up" : "bcw-down"}`;
    pool.querySelector(".bcw-rate").textContent = rugged ? "sin liquidez: nadie puede comprar ni vender" : `1 ETH ≈ ${fmt(y / x)} ${sym}`;
    pool.querySelector(".bcw-chart").innerHTML = chartSVG(hist);
    if (msg) {
      const m = pool.querySelector(".bcw-poolmsg");
      m.className = `bcw-alert ${bad ? "bcw-err" : "bcw-ok"} bcw-poolmsg`;
      m.innerHTML = msg;
    }
  };
  const trade = (dx) => {
    const k = k0();
    const nx = x + dx;
    const ny = k / nx;
    const out = y - ny;
    x = nx;
    y = ny;
    hist.push((x / y / p0) * 100);
    return out;
  };
  pool.querySelector(".bcw-trade").addEventListener("click", (e) => {
    const a = e.target.closest("button")?.dataset.a;
    if (!a || rugged) return;
    if (a === "buy") {
      const out = trade(0.1);
      buys++;
      render(`🛒 Alguien pagó 0,1 ETH y se llevó <b>${fmt(out)} ${esc(sym)}</b>. Quedan menos ${esc(sym)} en el pool → el precio sube.`);
      event("buy");
    } else if (a === "whale") {
      const out = trade(1);
      whale = true;
      render(`🐋 Una ballena pagó 1 ETH y se llevó <b>${fmt(out)} ${esc(sym)}</b>. Una compra grande mueve mucho el precio: eso es el <b>slippage</b>.`);
      event("whale");
    } else if (a === "sell") {
      const dy = (S.balances[sym] || 0) * 0.1;
      if (dy <= 0) return;
      const k = k0();
      const ny = y + dy;
      const nx = k / ny;
      const got = x - nx;
      x = nx;
      y = ny;
      S.balances[sym] -= dy;
      S.balances.ETH = (S.balances.ETH || 0) + got;
      hist.push((x / y / p0) * 100);
      render(`📉 Vendiste ${fmt(dy)} ${esc(sym)} y recibiste ${fmt(got, 4)} ETH. Entran ${esc(sym)} al pool → el precio baja.`);
      event("sell");
    }
  });
  render();

  await ctx.bot(`Ahora el mercado es tuyo. Hacé entrar **compradores** un par de veces y mirá el precio ${POINT}`);
  await ctx.until(
    new Promise((resolve) => {
      notify = () => buys >= 2 && resolve();
      notify();
    }),
  );
  ctx.paso("compradores");
  await ctx.bot(`Cada compra saca ${sym} del pool y mete ETH: hay menos monedas, entonces **sube el precio**. Ahora probá con la **ballena** 🐋`);
  if (!whale) await ctx.until(new Promise((resolve) => (notify = (k) => k === "whale" && resolve())));
  notify = () => {};
  ctx.paso("ballena");
  await ctx.bot(`¿Viste el salto? Ahora la parte oscura de DeFi: ¿qué pasa si **el creador** (o sea, vos) se lleva toda la liquidez?`);
  await ctx.choose([{ l: "😈 Retirar toda la liquidez" }]);
  ctx.paso("rug_pull");

  rugged = true;
  for (let i = 0; i < 12; i++) {
    x *= 0.6;
    y *= 0.6;
    hist.push(Math.max(0, hist[hist.length - 1] * 0.55));
    render();
    await ctx.sleep(90);
  }
  hist.push(0);
  render(`💥 <b>Rug pull.</b> El creador retiró el ETH y los compradores se quedaron con ${esc(sym)} que ya nadie puede comprar. Su plata desapareció.`, true);
  await addBlock(`💥 Liquidez de ${sym} retirada`, "Vos");
  ctx.addLog("💱", `Abriste y cerraste el pool de ${sym}`, "x·y=k, slippage y rug pull");
  await ctx.bot("Eso es un **rug pull**, una de las estafas más comunes en cripto. En el **Curso 2** se aprende a diseñar la economía de un token (tokenomics) para que no pase, y a defenderla frente a la CNV.");
  await ctx.award("c2");
  await ctx.bridge(2, `Pools, AMMs, stablecoins, staking y riesgo: todo eso es el **Curso 2**, con criterio regulatorio argentino ${POINT}`);
  await ctx.next();
}
