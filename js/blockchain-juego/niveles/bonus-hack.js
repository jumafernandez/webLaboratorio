// Bonus challenge: drain a vulnerable vault with a reentrancy attack, then fix it with Checks-Effects-Interactions.

import { addBlock } from "../cadena.js";
import { POINT, fmt, h } from "../util.js";

const VULN = `function retirar() external {
  uint monto = saldo[msg.sender];
<mark class="bcw-m1">  (bool ok,) = msg.sender.call{value: monto}("");  // 1. manda la plata</mark>
  require(ok);
<mark class="bcw-m2">  saldo[msg.sender] = 0;                           // 2. recién acá pone 0</mark>
}`;

const FIXED = `function retirar() external {
  uint monto = saldo[msg.sender];
  require(monto > 0);
<mark class="bcw-m2 bcw-fix">  saldo[msg.sender] = 0;                           // 1. primero pone 0</mark>
<mark class="bcw-m1 bcw-fix">  (bool ok,) = msg.sender.call{value: monto}("");  // 2. después manda</mark>
  require(ok);
}`;

const ATTACKER = `// tu contrato atacante
receive() external payable {
  if (address(boveda).balance >= 1 ether) boveda.retirar();
}`;

export default async function bonusHack(ctx) {
  let vault = 11;
  let loot = 0;
  let fire = () => {};
  const sc = ctx.scene((s) => {
    s.innerHTML = `<div class="bcw-kicker">Desafío · Seguridad</div><h3>Robá la bóveda</h3>
      <p class="bcw-lead">Una bóveda guarda los ETH de 10 personas. Depositaste 1 ETH y tenés un contrato atacante. ¿Ves la falla?</p>
      <div class="bcw-hackgrid">
        <div><div class="bcw-k">Bóveda.sol</div><pre class="bcw-code bcw-vcode">${VULN}</pre><pre class="bcw-code bcw-acode">${ATTACKER}</pre></div>
        <div class="bcw-hackside">
          <div class="bcw-tank bcw-vault"><div class="bcw-fill bcw-vfill" style="height:100%"></div><b class="bcw-vtxt">11 ETH</b><small>Bóveda</small></div>
          <div class="bcw-loot">Tu botín: <b class="bcw-ltxt2">0 ETH</b></div>
          <button type="button" class="bcw-cta bcw-danger bcw-attack">😈 Atacar</button>
        </div>
      </div>
      <div class="bcw-stack"></div>`;
    s.querySelector(".bcw-attack").addEventListener("click", (e) => {
      e.target.disabled = true;
      fire();
    });
  });
  const paint = () => {
    sc.querySelector(".bcw-vtxt").textContent = `${fmt(vault)} ETH`;
    sc.querySelector(".bcw-vfill").style.height = `${(vault / 11) * 100}%`;
    sc.querySelector(".bcw-ltxt2").textContent = `${fmt(loot)} ETH`;
  };
  const stackLine = (depth, text, cls = "") => {
    const l = h("div", `bcw-sline ${cls}`);
    l.style.paddingLeft = `${8 + depth * 14}px`;
    l.textContent = text;
    sc.querySelector(".bcw-stack").append(l);
    sc.querySelector(".bcw-stack").scrollTop = 1e6;
  };

  let fired = new Promise((resolve) => (fire = resolve));
  await ctx.bot("**Desafío.** Esta bóveda tiene una falla clásica. Mirá el orden de las líneas resaltadas: primero **manda** la plata y recién después **pone el saldo en 0**.");
  await ctx.bot(`Tu contrato atacante, cuando recibe plata, vuelve a llamar a retirar()… antes de que se actualice tu saldo. Tocá **Atacar** ${POINT}`);
  ctx.escape();
  await ctx.until(fired);
  ctx.paso("ataque");
  let depth = 0;
  while (vault >= 1) {
    stackLine(depth, `→ retirar()  saldo[vos] = 1 ETH`);
    await ctx.sleep(260);
    vault -= 1;
    loot += 1;
    paint();
    stackLine(depth, `  ↳ te manda 1 ETH → tu receive() vuelve a llamar…`, "bcw-sbad");
    await ctx.sleep(200);
    depth = Math.min(depth + 1, 8);
  }
  stackLine(depth, "✗ la bóveda quedó vacía", "bcw-sbad");
  await addBlock("😈 Bóveda drenada por reentrancy", "Atacante");
  await ctx.bot(`💥 Robaste **${fmt(loot)} ETH** depositando 1. Esto se llama **reentrancy**, y pasó de verdad: en 2016 un ataque así vació The DAO y terminó partiendo Ethereum en dos.`);
  await ctx.bot("¿Cómo se arregla? Con el patrón **Checks-Effects-Interactions**: primero se actualiza el saldo y recién después se manda la plata.");
  await ctx.choose([{ l: "🛠️ Aplicar el arreglo" }]);
  ctx.paso("arreglo");

  vault = 11;
  loot = 0;
  sc.querySelector(".bcw-vcode").innerHTML = FIXED;
  sc.querySelector(".bcw-stack").replaceChildren();
  sc.querySelector("h3").textContent = "Bóveda arreglada · probá de nuevo";
  const btn = sc.querySelector(".bcw-attack");
  btn.textContent = "😈 Atacar de nuevo";
  fired = new Promise((resolve) => (fire = resolve));
  btn.disabled = false;
  paint();
  await ctx.bot("Arreglado: ahora el saldo se pone en 0 **antes** de mandar. Atacá de nuevo, a ver qué pasa.", 500);
  await ctx.until(fired);
  ctx.paso("ataque_bloqueado");
  stackLine(0, "→ retirar()  saldo[vos] = 1 ETH → saldo = 0");
  await ctx.sleep(300);
  vault -= 1;
  loot += 1;
  paint();
  stackLine(0, "  ↳ te manda 1 ETH → tu receive() vuelve a llamar…");
  await ctx.sleep(300);
  stackLine(1, "→ retirar()  saldo[vos] = 0 → require(monto > 0) ✋ revert", "bcw-sok");
  await ctx.sleep(300);
  sc.append(h("div", "bcw-alert bcw-ok", "🛡️ Solo recuperaste tu propio 1 ETH. La segunda llamada encuentra el saldo en 0 y se revierte."));
  await ctx.bot("🛡️ Ahora solo recuperás **tu propio 1 ETH**. Un cambio de orden de dos líneas separa un contrato seguro de uno que pierde todo.");
  ctx.addLog("🛡️", "Hackeaste una bóveda y la arreglaste", "Reentrancy → Checks-Effects-Interactions");
  await ctx.award("hack");
  await ctx.bridge(1, "La seguridad de contratos (y este patrón) se ve desde el **Curso 1**, y en el **Curso 4** testeás tus contratos antes de desplegarlos.");
  await ctx.next();
}
