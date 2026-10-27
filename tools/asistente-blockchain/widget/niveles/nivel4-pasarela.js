// Level 4 · Course 4 (DApps): the course's payment gateway. Stablecoin from a faucet, approve, pay, events, and the
// receipt NFT. Same architecture the students build: ERC-20 + PaymentGateway + ReceiptNFT on Base Sepolia.

import { addBlock } from "../cadena.js";
import * as real from "../cadena-real.js";
import { POINT, ejemploEl, esc, fmt, h, randHex, short } from "../util.js";

const PRODUCTS = [
  { id: "cafe", emoji: "☕", name: "Café en el campus", price: 5 },
  { id: "apunte", emoji: "📘", name: "Apunte de Solidity", price: 15 },
  { id: "entrada", emoji: "🎟️", name: "Entrada a la charla", price: 25 },
];

let seq = 0;
function receiptSVG(p, id, tx, red) {
  const g = `bcwr${++seq}`;
  const date = new Date().toLocaleDateString("es-AR");
  return `<svg viewBox="0 0 300 300" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="NFT recibo ${esc(p.name)}">
    <defs><linearGradient id="${g}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5b1d6e"/><stop offset="1" stop-color="#ff7eb6"/></linearGradient></defs>
    <rect width="300" height="300" fill="url(#${g})"/>
    <rect x="34" y="26" width="232" height="248" rx="10" fill="#fff"/>
    <text x="150" y="58" font-size="13" font-weight="700" fill="#5b1d6e" text-anchor="middle" font-family="Montserrat, sans-serif" letter-spacing="2">RECIBO · NFT #${id}</text>
    <text x="150" y="118" font-size="48" text-anchor="middle">${p.emoji}</text>
    <text x="150" y="150" font-size="16" font-weight="700" fill="#261951" text-anchor="middle" font-family="Montserrat, sans-serif">${esc(p.name)}</text>
    <line x1="56" x2="244" y1="168" y2="168" stroke="#ddd" stroke-dasharray="4 4"/>
    <text x="56" y="194" font-size="13" fill="#666" font-family="Montserrat, sans-serif">Total</text>
    <text x="244" y="194" font-size="15" font-weight="700" fill="#261951" text-anchor="end" font-family="Montserrat, sans-serif">${p.price} USDL</text>
    <text x="56" y="218" font-size="13" fill="#666" font-family="Montserrat, sans-serif">Fecha</text>
    <text x="244" y="218" font-size="13" fill="#261951" text-anchor="end" font-family="Montserrat, sans-serif">${date}</text>
    <text x="150" y="252" font-size="10" fill="#999" text-anchor="middle" font-family="monospace">tx ${short(tx, 10, 6)}${red ? ` · ${esc(red)}` : ""}</text></svg>`;
}

export default async function nivel4(ctx, { ejemplo } = {}) {
  const S = ctx.S;
  await ctx.bot("**Nivel 4 · Curso 4.** Vas a usar la **pasarela de pago** que se construye en el Curso 4: un token para pagar, un contrato que cobra y un NFT que queda como recibo.");
  ctx.escape();
  await ctx.ensureWallet();
  // Real chain: PasarelaDemo funds the visitor's address with 100 USDL once (then it reports the current balance).
  if (real.REAL.on && S.walletReal && !S.usdlReal) {
    const rf = await ctx.realTx("fondear", () => real.fondear(S.wallet), { titulo: "Faucet · 100 USDL", espera: `Pidiendo 100 USDL a la pasarela en ${real.nombreRed()}…` });
    if (rf) {
      S.usdlReal = true;
      S.balances.USDL = rf.saldo_usdl;
      if (!rf.ya_fondeado) {
        await addBlock(`🚰 Faucet: 100 USDL → ${short(S.wallet, 6, 4)}`, "Faucet");
        ctx.addLog("🚰", "Recibiste 100 USDL de prueba", `USDLDemo (ERC-20) · ${real.nombreRed()} · ${short(rf.tx, 10, 6)}`, rf.explorador_tx);
      }
    }
  }
  const live = !!S.usdlReal;
  // Simulated faucet: the first time, or a refill when what is left can't buy anything (a replay never goes negative).
  let refilled = false;
  if (!live && (S.balances.USDL == null || S.balances.USDL < CHEAPEST)) {
    refilled = S.balances.USDL != null;
    S.balances.USDL = 100;
    await addBlock(`🚰 Faucet: 100 USDL → ${short(S.wallet, 6, 4)}`, "Faucet");
    ctx.addLog("🚰", "Recibiste 100 USDL de prueba", `Moneda estable de la demo (ERC-20)${real.marcaSimulada()}`);
  } else if (!live) {
    refilled = null; // replay with balance left: no new faucet
  }
  ctx.paso("faucet");

  // Real chain: the faucet gives once per wallet. With nothing left to spend, the level goes straight to the revert.
  if (live && S.balances.USDL < CHEAPEST) {
    ctx.scene((s) => {
      s.innerHTML = `<div class="bcw-kicker">Nivel 4 · Curso 4 · DApps</div><h3>Tu wallet no tiene saldo</h3>`;
      s.append(ctx.walletCard());
    });
    await ctx.bot(`Tenés **${fmt(S.balances.USDL)} USDL** en ${real.nombreRed()}: ya gastaste los 100 de prueba de esta wallet (el faucet da una sola vez por wallet). Igual podés ver lo más importante: qué pasa cuando alguien intenta pagar **sin saldo**.`);
    await ctx.choose([{ l: "😈 Intentar pagar igual", v: "auto" }]);
    ctx.paso("revert");
    await revertDemo(ctx, live, "cafe", 5);
    await ctx.award("c4");
    await ctx.bridge(4, "Esto es exactamente lo que se construye en el **Curso 4**: el token, la pasarela, el NFT recibo y el frontend, desplegados en Base Sepolia.");
    await ctx.next();
    return;
  }

  let pick = () => {};
  const shop = ctx.scene((s) => {
    s.innerHTML = `<div class="bcw-kicker">Nivel 4 · Curso 4 · DApps</div><h3>La tienda paga con cripto</h3>
      <div class="bcw-flow"><span>👛 Tu wallet</span><i>→</i><span>📜 PaymentGateway</span><i>→</i><span>🏪 Comercio</span><i>+</i><span>🧾 NFT recibo</span></div>
      ${live ? `<p class="bcw-simlabel">En vivo en ${esc(real.nombreRed())}: tus USDL y el recibo son reales. Las firmas las hace el relayer de la demo en nombre de tu wallet (en el Curso 4 las firmás vos con MetaMask).</p>` : ""}`;
    const ej = ejemploEl(ejemplo);
    if (ej) s.append(ej);
    s.append(ctx.walletCard());
    const grid = h("div", "bcw-shop");
    for (const p of PRODUCTS) {
      const can = p.price <= S.balances.USDL;
      const b = h("button", "bcw-product", `<span class="bcw-pe">${p.emoji}</span><b>${esc(p.name)}</b><span class="bcw-pp">${p.price} USDL${can ? "" : " · sin saldo"}</span>`);
      b.type = "button";
      b.disabled = !can; // never let the balance go negative
      b.addEventListener("click", () => pick(p));
      grid.append(b);
    }
    s.append(grid);
  });
  const picked = new Promise((resolve) => (pick = resolve));
  await ctx.bot(live
    ? `Tenés **${fmt(S.balances.USDL)} USDL** de prueba en ${real.nombreRed()}, de verdad. Elegí qué comprar ${POINT}`
    : refilled === null
      ? `Te quedan **${fmt(S.balances.USDL)} USDL** de la otra compra. Elegí qué comprar ${POINT}`
      : refilled
        ? `Ya habías gastado casi todo: te recargué **100 USDL** del faucet de prueba. Elegí qué comprar ${POINT}`
        : `Te cargué **100 USDL**, una moneda estable de prueba. Elegí qué comprar ${POINT}`);
  const product = await ctx.until(picked);
  ctx.paso("producto");
  shop.querySelectorAll(".bcw-product").forEach((b) => (b.disabled = true));

  let sign = () => {};
  const steps = ctx.scene((s) => {
    s.innerHTML = `<div class="bcw-kicker">Nivel 4 · Pago</div><h3>${product.emoji} ${esc(product.name)} · ${product.price} USDL</h3>
      <div class="bcw-step" data-s="1"><div class="bcw-sn">1</div><div><b>Autorizar (approve)</b>
        <p>Le das permiso al contrato de la pasarela para mover hasta ${product.price} USDL de tu wallet. Sin esto, nadie puede tocar tus monedas.</p>
        <code>USDL.approve(PaymentGateway, ${product.price})</code>
        <button type="button" class="bcw-cta bcw-primary bcw-sign">✍️ Firmar approve</button></div></div>
      <div class="bcw-step bcw-wait" data-s="2"><div class="bcw-sn">2</div><div><b>Pagar</b>
        <p>La pasarela cobra, le pasa el dinero al comercio y te emite el recibo.</p>
        <code>PaymentGateway.pay("${product.id}", ${product.price})</code>
        <button type="button" class="bcw-cta bcw-primary bcw-sign" disabled>✍️ Firmar pago</button></div></div>
      <div class="bcw-events" hidden><div class="bcw-k">Eventos emitidos por los contratos</div></div>`;
    s.querySelectorAll(".bcw-sign").forEach((b) => b.addEventListener("click", () => sign(b)));
  });
  let signed = new Promise((resolve) => (sign = resolve));
  await ctx.bot("Una compra con cripto son **dos firmas**. Primero autorizás a la pasarela a cobrarte ese monto: tocá **Firmar approve**.");
  await ctx.until(signed);
  ctx.paso("approve");
  const s1 = steps.querySelector('[data-s="1"]');
  s1.classList.add("bcw-done");
  s1.querySelector(".bcw-sign").replaceWith(h("span", "bcw-okline", "✓ Aprobado · allowance = " + product.price + " USDL"));
  const s2 = steps.querySelector('[data-s="2"]');
  s2.classList.remove("bcw-wait");
  signed = new Promise((resolve) => (sign = resolve));
  s2.querySelector(".bcw-sign").disabled = false;
  await ctx.bot("Bien. Ahora sí, **Firmar pago**.", 400);
  await ctx.until(signed);
  ctx.paso("pago");
  s2.querySelector(".bcw-sign").replaceWith(h("span", "bcw-okline", live ? `⏳ Enviando a ${real.nombreRed()}…` : "⏳ Enviando…"));

  let rp = null;
  if (live) {
    rp = await ctx.realTx("pagar", () => real.pagar(S.wallet, product.id, product.price), {
      titulo: `Pago · ${product.name}`, extra: `${product.price} USDL`, aceptar: ["saldo_insuficiente"],
      espera: `Pagando ${product.price} USDL por la pasarela…` });
  }
  if (rp?.error === "saldo_insuficiente") {
    // The chain says the balance is not enough (spent from another tab, say): that's the revert, shown as such.
    ctx.paso("revert");
    s2.querySelector(".bcw-okline").textContent = "✗ revert";
    await revertDemo(ctx, live, product.id, product.price, rp);
    await ctx.award("c4");
    await ctx.bridge(4, "Esto es exactamente lo que se construye en el **Curso 4**: el token, la pasarela, el NFT recibo y el frontend, desplegados en Base Sepolia.");
    await ctx.next();
    return;
  }
  const tx = rp?.tx || `0x${randHex(32)}`;
  const receiptId = rp?.recibo_id ?? 100 + S.nfts.filter((n) => n.kind === "recibo").length + 1;
  const ev = steps.querySelector(".bcw-events");
  ev.hidden = false;
  for (const line of [
    `Transfer(from: ${short(S.wallet, 6, 4)}, to: Comercio, value: ${product.price} USDL)`,
    rp ? `PagoRecibido(id: ${rp.pago_id}, v: ${short(S.wallet, 6, 4)}, producto: "${product.id}", monto: ${product.price})` : `PaymentReceived(id: ${receiptId}, product: "${product.id}", amount: ${product.price})`,
    rp ? `Acunada(tokenId: ${receiptId}, a: ${short(S.wallet, 6, 4)}, tipo: 7, nombre: "${product.id}")` : `ReceiptMinted(tokenId: ${receiptId}, to: ${short(S.wallet, 6, 4)})`,
  ]) {
    await ctx.sleep(550);
    ev.append(h("code", "bcw-evline", esc(line)));
  }
  S.balances.USDL = rp ? rp.saldo_usdl : Math.max(0, S.balances.USDL - product.price);
  const b = await addBlock(`🧾 Pago ${product.price} USDL · recibo #${receiptId}`, "PaymentGateway");
  s2.classList.add("bcw-done");
  s2.querySelector(".bcw-okline").textContent = rp ? `✓ Pagado en ${real.nombreRed()}, bloque #${rp.bloque}` : `✓ Pagado en el bloque #${b.n}`;
  const svg = receiptSVG(product, receiptId, tx, rp ? real.nombreRed() : "");
  S.nfts.push({ kind: "recibo", id: receiptId, name: `Recibo #${receiptId}`, svg, href: rp?.explorador_nft || null });
  await ctx.sleep(500);
  ctx.scene((s) => {
    s.innerHTML = `<div class="bcw-kicker">Nivel 4 · Recibo</div><h3>Te llegó el NFT recibo 🧾</h3>`;
    s.append(h("div", "bcw-nft bcw-nftbig", svg));
    if (rp) {
      const r = h("div", "bcw-tx bcw-tx-real");
      r.innerHTML = `<div class="bcw-txh">✓ Pago confirmado en ${esc(real.nombreRed())}</div>
        <dl>${real.filasTx(rp)}<dt>Pago</dt><dd>#${esc(rp.pago_id)} · PasarelaDemo</dd>
        <dt>Recibo</dt><dd>${rp.explorador_nft ? real.linkHTML(rp.explorador_nft, `NFT #${receiptId}`) : `NFT #${receiptId}`} · InsigniasLICDIA</dd></dl>`;
      s.append(r);
    }
    s.append(ctx.walletCard());
  });
  ctx.paso("recibo");
  ctx.addLog("🧾", `Compraste ${product.name}`, `${product.price} USDL · recibo NFT #${receiptId} · ${short(tx, 10, 6)}${rp ? ` · ${real.nombreRed()}` : real.marcaSimulada()}`, rp?.explorador_nft || rp?.explorador_tx);
  await ctx.bot(`Listo: pagaste **${product.price} USDL** y te llegó el **NFT recibo #${receiptId}**. Prueba la compra en la cadena: nadie puede falsificarlo ni borrarlo.`);
  await ctx.bot("¿Y si alguien intenta pagar algo que no puede pagar?");
  const t = await ctx.choose([
    { l: `😈 Comprar un auto 0 km con ${fmt(S.balances.USDL)} USDL`, v: "auto" },
    { l: "Seguir", v: "seguir" },
  ]);
  if (t === "auto") {
    ctx.paso("revert");
    await revertDemo(ctx, live, "auto", 500);
  }
  await ctx.award("c4");
  await ctx.bridge(4, "Esto es exactamente lo que se construye en el **Curso 4**: el token, la pasarela, el NFT recibo y el frontend, desplegados en Base Sepolia.");
  await ctx.next();
}

const CHEAPEST = Math.min(...PRODUCTS.map((p) => p.price));

// The revert of level 4: a payment the balance can't cover. Real chain: the backend checks balanceOf and answers 409
// saldo_insuficiente without sending the tx (`pre` is that answer when it already came from the purchase itself).
async function revertDemo(ctx, live, producto, monto, pre = null) {
  const S = ctx.S;
  const ra = pre || (live
    ? await ctx.realTx("pagar", () => real.pagar(S.wallet, producto, monto), { aceptar: ["saldo_insuficiente"], espera: `Intentando pagar ${monto} USDL…` })
    : null);
  const rev = ra?.error === "saldo_insuficiente" ? ra : null;
  if (rev && Number.isFinite(rev.saldo_usdl)) S.balances.USDL = rev.saldo_usdl;
  const label = producto === "auto" ? "🚗 Auto 0 km" : `${PRODUCTS.find((p) => p.id === producto)?.emoji || "🧾"} ${esc(PRODUCTS.find((p) => p.id === producto)?.name || producto)}`;
  ctx.scene((s) => {
    s.innerHTML = `<div class="bcw-kicker">Nivel 4 · Revert</div><h3>${label} · ${monto} USDL</h3>
      <code class="bcw-revert">USDL.approve(PaymentGateway, ${monto})  ✓\n${rev ? "PasarelaDemo.pagarPor" : "PaymentGateway.pay"}("${esc(producto)}", ${monto})\n✗ revert: ${esc(rev?.revert || "ERC20InsufficientBalance")}(${short(S.wallet, 6, 4)}, ${fmt(S.balances.USDL)}, ${monto})</code>
      <div class="bcw-alert bcw-err">❌ <b>La transacción se revirtió entera.</b> No se cobró nada, no se emitió recibo y no quedó nada a medias: en un contrato, es todo o nada.</div>
      ${rev ? `<p class="bcw-simlabel bcw-revreal">Respuesta real de ${esc(real.nombreRed())}: ${esc(rev.detalle || "saldo insuficiente")} La demo simula la transacción antes de mandarla y, como revertiría, ni la manda: no se gasta gas.</p>` : ""}`;
    s.append(ctx.walletCard());
  });
  await ctx.bot("La transacción **se revierte entera**: no se cobra nada y no queda nada a medias. Esa garantía de «todo o nada» es lo que hace confiables a los contratos.");
}
