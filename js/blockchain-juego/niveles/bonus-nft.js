// Bonus: design and mint your own NFT (ERC-721) into your wallet.

import { addBlock } from "../cadena.js";
import * as real from "../cadena-real.js";
import { POINT, esc, h, randHex, short } from "../util.js";

const DESIGNS = [
  { id: "buho", emoji: "🦉", name: "Búho LICDIA", c1: "#4c1c7f", c2: "#c4b5fd" },
  { id: "eslabon", emoji: "⛓️", name: "Eslabón", c1: "#261951", c2: "#2ee59d" },
  { id: "planeta", emoji: "🪐", name: "Planeta Web3", c1: "#6b34b0", c2: "#ffc857" },
];

let seq = 0;
export function nftSVG(d, name, id) {
  const g = `bcwn${++seq}`;
  return `<svg viewBox="0 0 300 300" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="NFT ${esc(name)}">
    <defs><linearGradient id="${g}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${d.c1}"/><stop offset="1" stop-color="${d.c2}"/></linearGradient></defs>
    <rect width="300" height="300" fill="url(#${g})"/>
    <circle cx="150" cy="122" r="76" fill="rgba(255,255,255,.16)"/>
    <text x="150" y="154" font-size="88" text-anchor="middle">${d.emoji}</text>
    <text x="150" y="240" font-size="22" font-weight="700" fill="#fff" text-anchor="middle" font-family="Montserrat, sans-serif">${esc(name)}</text>
    <text x="150" y="272" font-size="13" fill="rgba(255,255,255,.85)" text-anchor="middle" font-family="monospace">LICDIA · UNLu · #${esc(id)}</text></svg>`;
}

export default async function bonusNft(ctx) {
  let picked = null;
  const chosen = new Promise((resolve) => {
    ctx.scene((s) => {
      s.innerHTML = `<div class="bcw-kicker">Bonus · NFT</div><h3>Elegí tu NFT</h3>
        <p class="bcw-lead">Un NFT es un objeto digital único con dueño registrado en la blockchain. Cualquiera puede verlo, pero solo vos lo tenés.</p>`;
      const grid = h("div", "bcw-designs");
      for (const d of DESIGNS) {
        const card = h("button", "bcw-nft bcw-pick", `${nftSVG(d, d.name, "?")}<div class="bcw-cap">${d.emoji} ${d.name}</div>`);
        card.type = "button";
        card.addEventListener("click", () => resolve(d));
        grid.append(card);
      }
      s.append(grid);
    });
  });
  await ctx.bot(`¡Vamos! Un NFT es un objeto digital **único y con dueño**. Elegí un diseño ${POINT}`);
  const fromChips = ctx.choose(DESIGNS.map((d) => ({ l: `${d.emoji} ${d.name}`, v: d.id })));
  const r = await ctx.until(Promise.race([chosen, fromChips.then((id) => DESIGNS.find((d) => d.id === id))]));
  picked = r;
  ctx.paso("diseno");
  document.querySelectorAll(".bcw-chips").forEach((c) => c.remove());

  ctx.scene((s) => {
    s.innerHTML = `<div class="bcw-kicker">Bonus · NFT</div><h3>Ponele tu nombre</h3><p class="bcw-lead">Queda grabado en el NFT para siempre.</p>`;
    s.append(h("div", "bcw-nft bcw-nftbig bcw-preview", nftSVG(picked, "Tu nombre", "?")));
  });
  await ctx.bot("Buenísimo. ¿Con qué **nombre** lo grabamos? Escribilo en el chat.");
  const name = (
    await ctx.ask({
      placeholder: "El nombre para tu NFT…",
      onInput: (v) => {
        const p = ctx.stage.querySelector(".bcw-preview");
        if (p) p.innerHTML = nftSVG(picked, v || "Tu nombre", "?");
      },
    })
  ).slice(0, 22);
  ctx.paso("nombre");

  await ctx.ensureWallet();
  await ctx.bot("Ahora le pedimos al **contrato de la diplomatura** que mintee (cree) tu NFT y lo mande a tu wallet.");
  const S = ctx.S;
  // Real chain: InsigniasLICDIA mints tipo 4 (the bonus NFT) with the visitor's name, fully on-chain. Marked as tried
  // so the bonus badge (ctx.award("nft")) never mints a second one with a generic name.
  S.nftNombre = real.recortarBytes(name.trim(), 24) || "NFT";
  if (real.REAL.on && S.walletReal) S.nftIntentado = true;
  const mint = ctx.realTx("insignia", () => real.insignia(S.wallet, real.TIPOS.nft, real.recortarBytes(name.trim(), 24) || "NFT"), {
    titulo: `NFT · ${name}`, extra: `${picked.name} · bonus`, espera: `Minteando tu NFT en ${real.nombreRed()}…` });
  mint.catch(() => {});
  const sc = ctx.scene((s) => {
    s.innerHTML = `<div class="bcw-kicker">Bonus · Minteo</div><h3>Creando tu NFT…</h3>`;
    s.append(ctx.walletCard());
    s.append(h("div", "bcw-minting"));
  });
  for (const l of [`→ mint(${short(S.wallet, 6, 4)}, "${name}")`, "→ firmando la transacción…", "→ esperando confirmación de la red…"]) {
    const p = h("div");
    p.textContent = l;
    sc.querySelector(".bcw-minting").append(p);
    await ctx.sleep(600);
  }
  const rn = await mint;
  ctx.paso("minteo");
  if (rn) (S.realTipos ??= new Map()).set(real.TIPOS.nft, rn);
  const id = rn?.token_id ?? 41 + S.nfts.filter((n) => n.kind === "nft").length + 1;
  // One bonus NFT per wallet: if it already had one, what is on-chain is the earlier name, not the one just typed.
  const yaTenia = !!rn?.ya_tenia;
  const shown = yaTenia ? rn.nombre || name : name;
  const b = yaTenia ? null : await addBlock(`🎨 NFT #${id} → ${short(S.wallet, 6, 4)}`, "Contrato NFT");
  const pendTx = !rn && real.REAL.on && real.REAL.ultimoFallo?.pendiente ? real.REAL.ultimoFallo.tx : null;
  const tx = rn?.tx || pendTx || `0x${randHex(32)}`;
  const svg = nftSVG(picked, shown, id);
  if (!S.nfts.some((n) => n.kind === "nft" && n.id === id && rn)) S.nfts.push({ kind: "nft", id, name: shown, svg, href: rn?.explorador_nft || null });

  ctx.scene((s) => {
    s.innerHTML = `<div class="bcw-kicker">Bonus · Minteo</div><h3>${yaTenia ? "Ya tenías uno: es este" : "¡Es tuyo! 🎉"}</h3>`;
    s.append(h("div", "bcw-nft bcw-nftbig", svg));
    const r2 = h("div", "bcw-tx");
    if (rn) {
      r2.classList.add("bcw-tx-real");
      r2.innerHTML = rn.ya_tenia
        ? `<div class="bcw-txh">✓ Ya tenías tu NFT en ${esc(real.nombreRed())}</div>
          <dl><dt>Contrato</dt><dd>Insignias LICDIA (ERC-721)</dd><dt>Token</dt><dd>${rn.explorador_nft ? real.linkHTML(rn.explorador_nft, `#${id}`) : `#${id}`}</dd>
          <dt>Nombre</dt><dd>${esc(shown)}</dd>
          <dt>Nota</dt><dd>Hay un NFT bonus por wallet: este es el que acuñaste antes, con el nombre que le pusiste esa vez.</dd></dl>`
        : `<div class="bcw-txh">✓ NFT minteado en ${esc(real.nombreRed())}</div>
          <dl><dt>Contrato</dt><dd>Insignias LICDIA (ERC-721)</dd><dt>Token</dt><dd>${rn.explorador_nft ? real.linkHTML(rn.explorador_nft, `#${id}`) : `#${id}`}</dd>
          <dt>Para</dt><dd>${short(S.wallet, 10, 6)} (vos)</dd>${real.filasTx(rn)}</dl>`;
      s.append(r2);
      return;
    }
    r2.innerHTML = `<div class="bcw-txh">✓ NFT minteado</div>
      <dl><dt>Contrato</dt><dd>LICDIA Demo NFT (ERC-721)</dd><dt>Token</dt><dd>#${id}</dd>
      <dt>De</dt><dd>0x0000…0000 (recién creado)</dd><dt>Para</dt><dd>${short(S.wallet, 10, 6)} (vos)</dd>
      <dt>Tx</dt><dd>${short(tx, 14, 8)}</dd><dt>Bloque</dt><dd>#${b.n} · ${esc(real.redSimulada())}</dd></dl>`;
    s.append(r2);
  });
  ctx.addLog("🎨", `Tu NFT «${shown}»`, yaTenia ? `Ya lo tenías · token #${id} · ${real.nombreRed()}` : `Token #${id} · ${short(tx, 12, 6)}${rn ? ` · ${real.nombreRed()}` : real.marcaSimulada()}`, rn?.explorador_nft || rn?.explorador_tx);
  await ctx.bot(yaTenia
    ? `Esta wallet ya tenía su NFT bonus: es **${esc(shown)}**, el token **#${id}**. Hay uno por wallet y lo que queda en la cadena no se cambia: por eso no lleva el nombre nuevo.`
    : `Listo: **${esc(name)}** es el token **#${id}** y está en tu wallet. Cualquiera puede verlo, pero el dueño sos vos.`);
  await ctx.sleep(1200);
  await ctx.award("nft");
  await ctx.bridge(1, "Los NFTs los programás en el **Curso 1** (estándar ERC-721), y en el **Curso 4** son el recibo de una pasarela de pago real.");
  await ctx.next();
}
