// Level 1 · Course 1: hash, proof of work, a chain that grows on top of your block, and tamper detection.

import { addBlock, blockEl, chain, chainEl, checkChain, ready } from "../cadena.js";
import * as real from "../cadena-real.js";
import { POINT, THERE, ejemploEl, esc, h, randHex, sha256, short } from "../util.js";

const OTHERS = ["Saludos desde Mercedes", "gm ☀️", "Probando Web3", "Hola mundo descentralizado", "Vamos Luján 💜"];

export default async function nivel1(ctx, { ejemplo } = {}) {
  await ready;
  let lastHash = "";
  let token = 0;

  const s1 = ctx.scene((s) => {
    s.innerHTML = `<div class="bcw-kicker">Nivel 1 · Curso 1 · Hash</div>
      <h3>Tu texto se convierte en una huella digital</h3>
      <p class="bcw-lead">SHA-256 transforma cualquier texto en 64 caracteres. No se puede volver atrás, y cambiar una sola letra cambia casi todo.</p>
      <div class="bcw-hashlab">
        <div class="bcw-box"><div class="bcw-k">Lo que escribís</div><div class="bcw-mirror"></div></div>
        <div class="bcw-arrow">↓ SHA-256 ↓</div>
        <div class="bcw-box"><div class="bcw-k">Hash · <span style="color:var(--bcw-ambar)">en amarillo, lo que cambió con tu última tecla</span></div><div class="bcw-hashout"></div><div class="bcw-meter"><div></div></div></div>
      </div>`;
    const ej = ejemploEl(ejemplo);
    if (ej) s.querySelector(".bcw-lead").after(ej);
  });

  const update = async (text) => {
    const t = ++token;
    const hash = await sha256(text);
    if (t !== token || !s1.isConnected) return;
    s1.querySelector(".bcw-mirror").textContent = text;
    let changed = 0;
    s1.querySelector(".bcw-hashout").innerHTML = [...hash]
      .map((c, i) => {
        const chg = lastHash && lastHash[i] !== c;
        changed += chg ? 1 : 0;
        return chg ? `<span class="bcw-chg">${c}</span>` : c;
      })
      .join("");
    s1.querySelector(".bcw-meter div").style.width = `${(changed / 64) * 100}%`;
    lastHash = hash;
  };
  update("");

  await ctx.bot("**Nivel 1 · Curso 1.** Escribí algo que quieras que **dure para siempre**: una frase, un deseo, tu nombre.");
  await ctx.bot(`Mirá ${THERE} mientras escribís ${POINT} cada letra cambia la huella entera.`, 500);
  ctx.escape();
  const text = (await ctx.ask({ placeholder: "Escribí tu mensaje para la cadena…", onInput: update })).slice(0, 120);
  ctx.paso("mensaje");

  // Real chain: the message is also sealed on the network (SelloLICDIA) while the browser chain mines it.
  let sello = null;
  if (real.REAL.on) {
    await ctx.ensureWallet(`Esta vez tu mensaje va a quedar en una **blockchain real** (${real.nombreRed()}). Para firmarlo a tu nombre necesitás una **wallet**: te creo una ahora, sin instalar nada.`);
    sello = ctx.realTx("sellar", () => real.sellar(ctx.S.wallet, real.recortarBytes(text.trim(), 120)), {
      titulo: "Sello de tu mensaje", extra: text, espera: `Sellando tu mensaje en ${real.nombreRed()}…` });
    sello.catch(() => {});
  }
  await ctx.bot("Ahora lo **sellamos en un bloque**. Para entrar en la cadena hay que encontrar un número (nonce) que haga que el hash empiece con **000**. Eso es la prueba de trabajo: lo que hacen los mineros.");
  let pending;
  ctx.scene((s) => {
    s.innerHTML = `<div class="bcw-kicker">Nivel 1 · Minado</div><h3>Buscando el nonce…</h3>
      <p class="bcw-lead">Se prueba un número tras otro hasta que el hash empiece con 000. Nadie puede adivinarlo: hay que trabajar.</p>`;
    const wrap = chainEl();
    pending = blockEl({ n: chain.length, who: "Vos", data: text, prev: chain[chain.length - 1].hash, hash: "…", nonce: 0 });
    pending.classList.add("bcw-mining");
    wrap.append(h("div", "bcw-link"), pending);
    s.append(wrap);
    requestAnimationFrame(() => (wrap.scrollLeft = wrap.scrollWidth));
  });
  const t0 = performance.now();
  const b = await addBlock(text, "Vos", { mine: true }, (nonce, hash) => {
    pending.querySelector(".bcw-nonce").textContent = nonce;
    pending.querySelector(".bcw-h").textContent = short(hash, 10, 4);
  });
  await ctx.sleep(Math.max(0, 1400 - (performance.now() - t0)));
  ctx.paso("minado");
  // The mined block is drawn right away (final nonce and a hash starting with 000); the real seal, if any, is the
  // network's own wait and gets its own line in the chat.
  let r;
  ctx.scene((s) => {
    s.innerHTML = `<div class="bcw-kicker">Nivel 1 · Minado</div><h3>¡Tu bloque entró en la cadena! ✅</h3>
      <p class="bcw-lead">Se probaron ${(b.nonce + 1).toLocaleString("es-AR")} números hasta dar con uno que funcionara: nonce <b>${b.nonce}</b>, hash <code>${short(b.hash, 10, 4)}</code>.</p>`;
    s.append(chainEl());
    r = h("div", "bcw-tx");
    if (sello) r.innerHTML = `<div class="bcw-txh">⏳ Sellándolo en ${esc(real.nombreRed())}…</div>`;
    s.append(r);
  });
  let rs = null;
  if (sello) {
    await ctx.bot(`Minado en tu navegador. Ahora lo sello en **${real.nombreRed()}**: eso ya depende de la red real, puede tardar unos segundos.`, 500);
    rs = await sello;
  }
  const pendTx = real.REAL.on && real.REAL.ultimoFallo?.pendiente ? real.REAL.ultimoFallo.tx : null;
  const tx = rs?.tx || pendTx || `0x${randHex(32)}`;
  if (r.isConnected) {
    if (rs) {
      r.classList.add("bcw-tx-real");
      r.innerHTML = `<div class="bcw-txh">✓ Sellado en ${esc(real.nombreRed())}</div>
        <dl>${real.filasTx(rs)}<dt>Sello</dt><dd>#${esc(rs.id)} · SelloLICDIA</dd>
        <dt>Tu navegador</dt><dd>bloque #${b.n} · nonce ${b.nonce} · ${short(b.hash, 10, 4)}</dd></dl>
        ${rs.explorador_tx ? real.linkHTML(rs.explorador_tx, "🔍 Ver la transacción en Blockscout").replace("bcw-txlink", "bcw-explorer bcw-txlink") : `<span class="bcw-explorer">⛓️ Anvil local no tiene explorador: el hash de arriba es la transacción real</span>`}`;
    } else {
      const pend = real.REAL.on ? real.REAL.ultimoFallo : null;
      const txSim = tx;
      r.innerHTML = `<div class="bcw-txh">${pend?.pendiente ? `⏳ Enviada a ${esc(real.nombreRed())}, todavía sin confirmar` : "✓ Transacción confirmada"}</div>
        <dl><dt>Red</dt><dd>${esc(real.redSimulada())}</dd><dt>Tx</dt><dd>${pend?.pendiente && pend.href ? real.linkHTML(pend.href, short(txSim, 14, 8)) : short(txSim, 14, 8)}</dd>
        <dt>Bloque</dt><dd>#${b.n}${real.REAL.on ? " (en tu navegador)" : ""}</dd><dt>Hash</dt><dd>${short(b.hash, 18, 6)}</dd><dt>Nonce</dt><dd>${b.nonce}</dd></dl>
        <span class="bcw-explorer">${real.REAL.on ? "🔍 Esta vez el sello no llegó a la cadena real: el bloque vive en tu navegador" : "🔍 Ver en el explorador · en la versión real abre Blockscout"}</span>`;
    }
  }
  ctx.addLog("🔒", "Grabaste un mensaje en la cadena", rs ? `${real.nombreRed()} · bloque #${rs.bloque} · ${short(tx, 12, 6)}` : `Bloque #${b.n} · ${short(tx, 12, 6)}${real.marcaSimulada()}`, rs?.explorador_tx);
  await ctx.bot(rs
    ? `Listo: «${esc(text)}» quedó en el **bloque #${b.n}** de tu navegador y **sellado de verdad** en ${real.nombreRed()}, bloque #${rs.bloque}.`
    : `Listo: «${esc(text)}» quedó grabado en el **bloque #${b.n}**.`);

  await ctx.sleep(800);
  await addBlock(OTHERS[Math.floor(Math.random() * OTHERS.length)], "Visitante");
  ctx.scene((s) => {
    s.innerHTML = `<div class="bcw-kicker">La cadena sigue creciendo</div><h3>Llegó otro bloque encima del tuyo</h3>
      <p class="bcw-lead">El bloque nuevo guarda la huella del tuyo. Cuantos más bloques se apilan, más enterrado y protegido queda tu mensaje.</p>`;
    s.append(chainEl());
    if (rs) s.append(r);
  });
  ctx.paso("bloque_encima");
  await ctx.bot("Mirá: llegó **otro bloque encima del tuyo** y guarda tu huella. ¿Te animás a **adulterar** lo que escribiste?");
  const choice = await ctx.choose([
    { l: "😈 Sí, quiero cambiarlo", v: "si" },
    { l: "Seguir sin romper nada", v: "no" },
  ]);

  if (choice === "si") {
    const mineB = chain.findLast((x) => x.mine);
    let alert, data;
    ctx.scene((s) => {
      s.innerHTML = `<div class="bcw-kicker">Nivel 1 · Adulterar</div><h3>Cambiá tu mensaje</h3>
        <p class="bcw-lead">Hacé clic en los datos de <b>tu bloque</b> (el verde) y escribí cualquier cosa.</p>`;
      s.append(chainEl());
      alert = h("div", "bcw-alert bcw-ok", "Todo en orden: cada hash coincide con el que guardó el bloque siguiente.");
      s.append(alert);
      data = mineB.el.querySelector(".bcw-data");
      data.contentEditable = "true";
      data.spellcheck = false;
      setTimeout(() => data.focus(), 300);
    });
    const broke = new Promise((resolve) => {
      data.addEventListener("input", async () => {
        const broken = await checkChain();
        if (broken == null) return;
        alert.className = `bcw-alert ${broken ? "bcw-err" : "bcw-ok"}`;
        alert.innerHTML = broken
          ? "❌ <b>La cadena se rompió.</b> El hash de tu bloque cambió y ya no coincide con el que guardó el bloque siguiente. Todos los nodos de la red lo detectan y rechazan el cambio."
          : "✅ Volviste al texto original: la cadena vuelve a cerrar.";
        if (broken) resolve();
      });
    });
    await ctx.bot(`Dale: editá el texto de **tu bloque** directo en la cadena, ${THERE} ${POINT}`);
    await ctx.until(broke);
    ctx.paso("cadena_rota");
    await ctx.bot("¿Viste? Con cambiar **una letra**, la cadena se rompió. Para colarlo tendrías que volver a minar tu bloque y todos los de arriba, más rápido que toda la red junta. Por eso lo que entra en una blockchain **no se borra**.");
    await ctx.choose([{ l: "↩️ Restaurar y seguir" }]);
  }

  await ctx.award("c1");
  await ctx.bridge(1, "Esto que hiciste (hash, bloques, minado) es la base del **Curso 1**: ahí lo programás en Solidity y lo desplegás en Ethereum.");
  await ctx.next();
}
