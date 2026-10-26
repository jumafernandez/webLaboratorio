// "Base Sepolia · en vivo": the header pill opens this card, which explains what the network is, why a testnet, who
// pays the gas and where to see it all, with the live block number, the contracts and the visitor's own transactions.

import { REAL, bloqueActual, esAnvil, linkDir, linkHTML, nombreRed } from "./cadena-real.js";
import { esc, h, short } from "./util.js";

// Contracts of the game (accion -> address in REAL.contratos), shown once each.
const CONTRATOS = [
  ["sellar", "SelloLICDIA", "guarda los mensajes del Nivel 1"],
  ["token", "FabricaTokens", "despliega las monedas del Nivel 2"],
  ["pagar", "PasarelaDemo", "la pasarela de pago del Nivel 4"],
  ["insignia", "InsigniasLICDIA", "acuña las insignias y los NFTs"],
];

let poll = null;

export function buildRed() {
  const el = h("div", "bcw-redpop");
  el.id = "bcw-redpop";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-labelledby", "bcw-redpop-t");
  el.hidden = true;
  return el;
}

export function renderRed(el, { onVerTxs }) {
  const vivo = REAL.on && !esAnvil();
  const explorador = REAL.explorador;
  const contratos = CONTRATOS.filter(([a]) => REAL.contratos[a])
    .map(([a, nombre, que]) => {
      const dir = REAL.contratos[a];
      const href = linkDir(dir);
      return `<li><b>${nombre}</b><span>${que}</span>${href ? linkHTML(href, short(dir, 8, 6)) : `<code>${esc(short(dir, 8, 6))}</code>`}</li>`;
    })
    .join("");
  const mias = REAL.txs.length;
  el.innerHTML = `
    <button class="bcw-redx" type="button" aria-label="Cerrar">✕</button>
    <div class="bcw-kicker">${vivo ? "La red donde jugás" : "La red del juego"}</div>
    <h3 id="bcw-redpop-t">${vivo ? "Base Sepolia: una blockchain real, de prueba" : `${esc(nombreRed())}`}</h3>
    <div class="bcw-redstats">
      <span><b class="bcw-redbloque">${REAL.on ? "…" : "–"}</b>último bloque</span>
      <span><b>~2 s</b>por bloque</span>
      <span><b>${esc(REAL.chainId ?? 84532)}</b>chain id</span>
      <span><b>${mias}</b>tx tuyas</span>
    </div>
    <details open><summary>¿Qué es Base Sepolia?</summary>
      <p><b>Base</b> es una red de <b>capa 2</b> sobre Ethereum, creada por Coinbase: junta muchas transacciones, las
      procesa rápido y barato, y las asienta en Ethereum para heredar su seguridad. <b>Sepolia</b> es la red de pruebas
      de Ethereum. <b>Base Sepolia</b> es la red de pruebas de Base: mismo software, mismos contratos y mismas
      herramientas que la red principal, pero su ETH no vale plata.</p></details>
    <details><summary>¿Por qué una red de prueba?</summary>
      <p>Cada transacción paga <b>gas</b>. En la red principal eso es dinero real; acá el ETH sale gratis de una
      <i>faucet</i>. Así podés jugar sin comprar cripto, sin tarjeta y sin instalar una wallet. Los equipos de
      desarrollo prueban todo en una testnet antes de lanzarlo.</p></details>
    <details><summary>¿Es real de verdad?</summary>
      <p>Sí. Lo que hacés en el juego queda en bloques que validan nodos de todo el mundo: nadie, ni nosotros, lo puede
      borrar ni cambiar. Lo podés verificar en <b>Blockscout</b>, un explorador público. Por eso revisamos lo que
      escribís antes de grabarlo: queda <b>público y para siempre</b>.</p></details>
    <details><summary>¿Quién paga el gas?</summary>
      <p>Un <b>relayer</b> de la diplomatura. Tu wallet vive en tu navegador y <b>firma</b> lo que querés hacer; el
      relayer verifica esa firma, paga el gas y el contrato registra <b>tu dirección</b> como autora. Nadie puede
      actuar en tu nombre sin tu firma.</p></details>
    <details><summary>¿Y en la diplomatura?</summary>
      <p>En el <b>Curso 4</b> desplegás tus propios contratos en Base Sepolia: un token, una pasarela de pago y un NFT
      recibo, con su frontend. Lo mismo que estás tocando acá.</p></details>
    ${contratos ? `<h4>Los contratos del juego</h4><ul class="bcw-redcontratos">${contratos}</ul>` : ""}
    <div class="bcw-redacciones">
      <button type="button" class="bcw-chip bcw-chip-primary bcw-redtxs">🔍 Ver tus transacciones</button>
      ${explorador ? linkHTML(explorador, "Abrir Blockscout ↗").replace("bcw-txlink", "bcw-chip bcw-txlink") : ""}
    </div>`;
  el.querySelector(".bcw-redtxs").addEventListener("click", onVerTxs);
}

// Live block number while the card is open.
export function vigilarBloque(el, on) {
  clearInterval(poll);
  poll = null;
  if (!on || !REAL.on) return;
  const tick = async () => {
    const n = await bloqueActual();
    const b = el.querySelector(".bcw-redbloque");
    if (b) b.textContent = n == null ? "sin conexión" : `#${n.toLocaleString("es-AR")}`;
  };
  tick();
  poll = setInterval(tick, 2500);
}
