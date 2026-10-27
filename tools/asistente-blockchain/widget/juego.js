// Game layer: levels (one per course), bonus challenges, badges as NFTs and the progress bar.

import { esc, h } from "./util.js";

export const LEVELS = [
  { id: "c1", curso: 1, corto: "Bloques", titulo: "Que nada se pueda borrar", sub: "Hash, bloques, minado y qué pasa si alguien hace trampa" },
  { id: "c2", curso: 2, corto: "Tu moneda", titulo: "Creá tu propia moneda", sub: "Un token, un pool de liquidez y un precio que se mueve en vivo" },
  { id: "c3", curso: 3, corto: "La red", titulo: "Intentá tirar la red", sub: "Nodos, consenso y cómo escala una capa 2" },
  { id: "c4", curso: 4, corto: "Pagos", titulo: "Pagá con cripto", sub: "La pasarela de pago del Curso 4, con su NFT recibo" },
];

export const BONUS = [
  { id: "nft", emoji: "🎨", titulo: "Hacete un NFT", sub: "Diseño y nombre tuyos" },
  { id: "hack", emoji: "😈", titulo: "Hackeá un contrato", sub: "Robá una bóveda y después arreglala" },
];

export const BADGES = {
  c1: { emoji: "⛓️", etiqueta: "Curso 1 · Bloques", nombre: "Insignia Bloques", c1: "#4c1c7f", c2: "#c4b5fd", top: "CURSO 1" },
  c2: { emoji: "💱", etiqueta: "Curso 2 · DeFi", nombre: "Insignia DeFi", c1: "#7a2d8f", c2: "#ffc857", top: "CURSO 2" },
  c3: { emoji: "🌐", etiqueta: "Curso 3 · Infraestructura", nombre: "Insignia Red", c1: "#1d3a8a", c2: "#2ee59d", top: "CURSO 3" },
  c4: { emoji: "🧾", etiqueta: "Curso 4 · DApps", nombre: "Insignia DApps", c1: "#5b1d6e", c2: "#ff7eb6", top: "CURSO 4" },
  nft: { emoji: "🎨", etiqueta: "Bonus · Artista NFT", nombre: "Bonus NFT", c1: "#374151", c2: "#a78bfa", top: "BONUS" },
  hack: { emoji: "🛡️", etiqueta: "Bonus · Auditoría", nombre: "Bonus Auditoría", c1: "#3b0a0a", c2: "#ff5a6e", top: "BONUS" },
  cert: { emoji: "🏆", etiqueta: "Recorrido completo", nombre: "Recorrido completo", c1: "#261951", c2: "#ffc857", top: "LICDIA · UNLu" },
};

let seq = 0;
export function badgeSVG(id, locked = false) {
  const b = BADGES[id];
  const g = `bcwb${++seq}`;
  const hex = "150,18 268,86 268,214 150,282 32,214 32,86";
  return `<svg viewBox="0 0 300 300" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${esc(b.nombre)}">
    <defs><linearGradient id="${g}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${locked ? "#2a2440" : b.c1}"/><stop offset="1" stop-color="${locked ? "#3a3358" : b.c2}"/></linearGradient></defs>
    <polygon points="${hex}" fill="url(#${g})" stroke="rgba(255,255,255,.55)" stroke-width="6"/>
    <polygon points="150,44 245,99 245,201 150,256 55,201 55,99" fill="none" stroke="rgba(255,255,255,.18)" stroke-width="3"/>
    <text x="150" y="92" font-size="20" font-weight="700" fill="rgba(255,255,255,.85)" text-anchor="middle" font-family="Montserrat, sans-serif" letter-spacing="3">${esc(b.top)}</text>
    <text x="150" y="176" font-size="86" text-anchor="middle" ${locked ? 'opacity=".25"' : ""}>${locked ? "🔒" : b.emoji}</text>
    <text x="150" y="226" font-size="19" font-weight="700" fill="#fff" text-anchor="middle" font-family="Montserrat, sans-serif">${esc(b.nombre.replace("Insignia ", ""))}</text></svg>`;
}

export function progressEl(badges) {
  const wrap = h("div", "bcw-progress");
  wrap.title = "Insignias del recorrido";
  for (const l of LEVELS) {
    const got = badges.has(l.id);
    const dot = h("span", `bcw-pdot${got ? " bcw-on" : ""}`, got ? BADGES[l.id].emoji : String(l.curso));
    dot.title = `Curso ${l.curso}: ${got ? "insignia ganada" : "pendiente"}`;
    wrap.append(dot);
  }
  const bonus = BONUS.filter((b) => badges.has(b.id)).length;
  if (bonus) wrap.append(h("span", "bcw-pbonus", `+${bonus}`));
  return wrap;
}
