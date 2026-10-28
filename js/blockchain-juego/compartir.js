// Share a badge or the certificate: LinkedIn, X, WhatsApp and "copy link".
// With a real token the link opens the public verifier on it (/verificar/?q=N), so whoever clicks sees the NFT on
// Base Sepolia; without one (simulated chain, mint still pending or failed) it invites to play that same level.

import { BADGES } from "./juego.js";
import { track } from "./medicion.js";
import { h } from "./util.js";

const SITIO = "https://licdia.unlu.edu.ar/blockchain-dev/";
const VERIFICAR = `${SITIO}verificar/`;

const REDES = [
  { id: "linkedin", l: "LinkedIn", url: (u) => `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(u)}` },
  { id: "x", l: "X", url: (u, t) => `https://twitter.com/intent/tweet?text=${encodeURIComponent(t)}&url=${encodeURIComponent(u)}` },
  { id: "whatsapp", l: "WhatsApp", url: (u, t) => `https://wa.me/?text=${encodeURIComponent(`${t} ${u}`)}` },
];

// item: { id: badge id (c1..c4, nft, hack, cert), tokenId?: number } — read on every click, because the token
// arrives after the background mint ends.
export function enlaceCompartir(item) {
  return item.tokenId ? `${VERIFICAR}?q=${item.tokenId}` : `${SITIO}?bcw=${item.id === "cert" ? "open" : item.id}`;
}

export function textoCompartir(item) {
  const b = BADGES[item.id];
  const logro = item.id === "cert" ? "completé los 4 niveles del juego" : `gané la insignia «${b.etiqueta}»`;
  const donde = item.tokenId ? " Es un NFT en Base Sepolia: se puede verificar en la cadena." : " Probalo vos:";
  return `Jugando con la Diplomatura de Posgrado en Blockchain de la UNLu ${logro}.${donde}`;
}

export function compartirEl(item) {
  const row = h("div", "bcw-share");
  row.setAttribute("role", "group");
  row.setAttribute("aria-label", "Compartir");
  row.append(h("span", "bcw-share-l", "Compartir"));
  for (const r of REDES) {
    const a = h("a", "bcw-share-b");
    a.textContent = r.l;
    a.target = "_blank";
    a.rel = "noopener";
    a.href = r.url(enlaceCompartir(item), textoCompartir(item));
    // The token can show up after the row is drawn: refresh the href right before the browser follows it.
    a.addEventListener("pointerdown", () => (a.href = r.url(enlaceCompartir(item), textoCompartir(item))));
    a.addEventListener("click", () => {
      a.href = r.url(enlaceCompartir(item), textoCompartir(item));
      track("compartir", { red: r.id, id: item.id });
    });
    row.append(a);
  }
  const copiar = h("button", "bcw-share-b");
  copiar.type = "button";
  copiar.textContent = "Copiar link";
  copiar.addEventListener("click", async () => {
    const u = enlaceCompartir(item);
    try {
      await navigator.clipboard.writeText(u);
      copiar.textContent = "✓ Copiado";
    } catch {
      window.prompt("Copiá este link:", u);
    }
    setTimeout(() => (copiar.textContent = "Copiar link"), 2200);
    track("compartir", { red: "copiar", id: item.id });
  });
  row.append(copiar);
  return row;
}
