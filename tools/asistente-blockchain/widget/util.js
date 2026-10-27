// Small DOM, text and crypto helpers shared by every module of the widget.

export const h = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
};

export const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// Bot texts: **bold** only. Input must already be escaped when it carries visitor text.
export const md = (s) => s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const norm = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

const enc = new TextEncoder();
const toHex = (buf) => [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, "0")).join("");
export const sha256 = async (s) => toHex(await crypto.subtle.digest("SHA-256", enc.encode(s)));
export const randHex = (n) => toHex(crypto.getRandomValues(new Uint8Array(n)));
export const short = (x, a = 6, b = 4) => (x.length > a + b + 1 ? `${x.slice(0, a)}…${x.slice(-b)}` : x);
export const fmt = (n, d = 0) => n.toLocaleString("es-AR", { minimumFractionDigits: d, maximumFractionDigits: d });

// On phones the stage sits above the chat, so pointers change direction.
export const MOBILE = matchMedia("(max-width: 760px)").matches;
export const POINT = MOBILE ? "👆" : "👉";
export const THERE = MOBILE ? "arriba" : "a la derecha";
// "Reduce motion" in the system settings: animations driven from JS skip or jump to the end.
export const REDUCE = matchMedia("(prefers-reduced-motion: reduce)").matches;

// Callout with the example the agent tailored to the visitor (their job, their sector).
export function ejemploEl(ejemplo) {
  if (!ejemplo) return null;
  const el = h("div", "bcw-ejemplo");
  el.innerHTML = `<b>💡 Para tu caso</b><span></span>`;
  el.querySelector("span").textContent = ejemplo;
  return el;
}

// Where every "lista de espera" button of the widget goes (the cohort 2026 is closed).
export const WAITLIST_URL = "/blockchain-dev/espera-2027/";
