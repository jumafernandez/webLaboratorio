// "Ver por dentro": the real chain running in the browser and what the agent did on the last question.

import { DIFFICULTY, chain } from "./cadena.js";
import { REAL, nombreRed, txsHTML } from "./cadena-real.js";
import { esc, fmt, h, sha256 } from "./util.js";

const payload = (b) => `${b.n}|${b.prev}|${b.data}|${b.nonce}`;

export function buildDentro() {
  const el = h("aside", "bcw-dentro");
  el.setAttribute("aria-label", "Cómo funciona por dentro");
  el.innerHTML = `
    <div class="bcw-dtabs" role="tablist">
      <button type="button" role="tab" data-t="cadena" aria-selected="true">⛓️ La cadena</button>
      <button type="button" role="tab" data-t="agente" aria-selected="false">🤖 El agente</button>
    </div>
    <div class="bcw-dbody"></div>`;
  return el;
}

export async function renderCadena(body) {
  const rows = [];
  for (const b of chain) {
    const ok = (await sha256(payload(b))) === b.hash && b.hash.startsWith(DIFFICULTY);
    const linked = b.n === 0 || b.prev === chain[b.n - 1]?.hash;
    rows.push(`<li class="${ok && linked ? "" : "bcw-dbad"}">
      <div class="bcw-drow"><b>#${b.n}</b><span>${esc(b.who)}</span><span class="bcw-dok">${ok && linked ? "✓ válido" : "✗ roto"}</span></div>
      <div class="bcw-ddata">${esc(b.data)}</div>
      <code>hash  ${b.hash}</code><code>prev  ${b.prev}</code><code>nonce ${b.nonce}</code></li>`);
  }
  const nota = REAL.on
    ? `Esta cadena del navegador es para ver cómo funciona por dentro. Lo que hacés en el juego (sello, token, pagos, NFTs) va además a ${esc(nombreRed())}: está en «Transacciones reales».`
    : "Las transacciones, la wallet y los NFTs del juego son simulados: en la versión real irían a Base Sepolia.";
  body.innerHTML = `${txsHTML()}<h3>La cadena de tu navegador</h3>
    <p>Esto no es un dibujo: es una blockchain que corre en tu navegador. Cada bloque guarda su hash SHA-256 y el del
    anterior; para entrar, hay que encontrar un nonce que haga que el hash empiece con <b>${DIFFICULTY}</b>.</p>
    <div class="bcw-dstat"><span><b>${chain.length}</b> bloques</span><span>dificultad <b>${DIFFICULTY}</b></span><span>SHA-256 · Web Crypto</span></div>
    <ol class="bcw-dlist" reversed>${rows.reverse().join("")}</ol>
    <p class="bcw-dnote">${nota}</p>`;
}

export function renderAgente(body, turn, modelo) {
  if (!turn) {
    body.innerHTML = `<h3>El agente</h3>
      <p>Cuando escribís una pregunta, Claude (${esc(modelo || "modelo de Anthropic")}) la responde con el texto completo de este sitio y
      decide qué mostrar en el escenario usando <b>herramientas</b>: arrancar un nivel, mostrar una parte del sitio,
      llevarte a una sección o sugerir el próximo paso.</p>
      <p class="bcw-dnote">Hacé una pregunta en el chat para ver qué hizo por dentro.</p>`;
    return;
  }
  const f = turn.fin || {};
  const tools = turn.acciones.length
    ? turn.acciones.map((a) => `<li><b>${esc(a.tipo)}</b><code>${esc(JSON.stringify(rest(a)))}</code></li>`).join("")
    : "<li>Ninguna: respondió solo con texto.</li>";
  body.innerHTML = `<h3>El agente</h3>
    <p>Un agente con herramientas: el modelo lee tu pregunta, el estado del juego y todo el sitio, y además de escribir
    llama funciones que el escenario ejecuta.</p>
    <div class="bcw-dstep"><h4>1 · Tu pregunta</h4><div class="bcw-ddata">${esc(turn.pregunta)}</div></div>
    <div class="bcw-dstep"><h4>2 · Contexto</h4>
      <p>Reglas + texto del sitio (desde la caché) + conversación + estado del juego:</p>
      <code>${esc(JSON.stringify(turn.estado))}</code></div>
    <div class="bcw-dstep"><h4>3 · Herramientas que llamó</h4><ul class="bcw-dtools">${tools}</ul></div>
    <div class="bcw-dstep"><h4>4 · Números</h4>
      <div class="bcw-dnums">
        <span><b>${fmt(f.tokens_entrada || 0)}</b>tokens de entrada</span>
        <span><b>${fmt(f.tokens_cache || 0)}</b>desde la caché</span>
        <span><b>${fmt(f.tokens_salida || 0)}</b>tokens de salida</span>
        <span><b>${f.ms_primer_token ? fmt(f.ms_primer_token) + " ms" : "–"}</b>primer token</span>
        <span><b>${f.ms_total ? fmt(f.ms_total) + " ms" : "–"}</b>total</span>
        <span><b>${f.usd != null ? "US$ " + f.usd.toFixed(4) : "–"}</b>costo</span>
      </div>
      <p class="bcw-dnote">Modelo ${esc(f.modelo || modelo || "")} · ${f.vueltas || 1} llamada${(f.vueltas || 1) > 1 ? "s" : ""} a la API.</p></div>`;
}

function rest(a) {
  const { tipo, ...r } = a;
  return r;
}
