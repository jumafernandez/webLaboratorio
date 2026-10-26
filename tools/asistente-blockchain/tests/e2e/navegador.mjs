// Headless Chrome driven over CDP (no Playwright): helpers shared by the end-to-end scripts.
// Needs the dev server running (uv run uvicorn backend.app:app --port 8765) and google-chrome installed.

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const BASE = process.env.BCW_BASE || "http://127.0.0.1:8765";
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Errors from the site itself, not from the widget
const SITE_ERRORS = [/GET_ELEMENTS: page-top/];

export async function abrir({ ancho = 1440, alto = 900, capturas = "tests/e2e/capturas", mocks = null } = {}) {
  const port = 9300 + Math.floor(Math.random() * 500);
  const perfil = join(tmpdir(), `bcw-e2e-${process.pid}-${port}`);
  const chrome = spawn("google-chrome", ["--headless=new", "--disable-gpu", "--no-first-run", `--user-data-dir=${perfil}`,
    `--remote-debugging-port=${port}`, "about:blank"], { stdio: "ignore" });
  let tabs = [];
  for (let i = 0; i < 40 && !tabs.length; i++) {
    await sleep(250);
    try {
      tabs = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).filter((t) => t.type === "page");
    } catch {
      /* chrome still starting */
    }
  }
  const ws = new WebSocket(tabs[0].webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0;
  const pend = {};
  const errores = [];
  const pedidos = [];
  const send = (method, params = {}) => new Promise((r) => {
    const i = ++id;
    pend[i] = r;
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pend[d.id]) {
      pend[d.id](d);
      delete pend[d.id];
    }
    if (d.method === "Runtime.exceptionThrown") {
      const t = d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text;
      if (!SITE_ERRORS.some((re) => re.test(t))) errores.push(t.slice(0, 300));
    }
    if (d.method === "Fetch.requestPaused") {
      const { requestId, request } = d.params;
      const r = mocks(request, pedidos);
      // A mock that returns null lets the request reach the real server (cadena_real.mjs mocks only /chat).
      if (!r) {
        send("Fetch.continueRequest", { requestId });
        return;
      }
      send("Fetch.fulfillRequest", { requestId, responseCode: r.estado || 200, responseHeaders: [{ name: "Content-Type", value: r.tipo }],
        body: Buffer.from(r.cuerpo).toString("base64") });
    }
  };
  await send("Runtime.enable");
  await send("Page.enable");
  if (mocks) await send("Fetch.enable", { patterns: [{ urlPattern: "*/blockchain-dev/api/*" }] });
  await send("Emulation.setDeviceMetricsOverride", { width: ancho, height: alto, deviceScaleFactor: 1, mobile: ancho < 760 });
  mkdirSync(capturas, { recursive: true });

  const ev = async (expr) => (await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
  const b = {
    send, ev, errores, pedidos,
    async ir(path) {
      await send("Page.navigate", { url: BASE + path });
      await sleep(400);
    },
    async esperar(expr, ms = 15000) {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) {
        if (await ev(expr)) return true;
        await sleep(200);
      }
      return false;
    },
    // Click the first element matching sel whose text contains txt (waits until it exists and is enabled)
    async tocar(sel, txt = "", ms = 15000) {
      const q = `[...document.querySelectorAll(${JSON.stringify(sel)})].find(e=>e.textContent.includes(${JSON.stringify(txt)}) && !e.disabled)`;
      if (!(await b.esperar(`!!(${q})`, ms))) return false;
      await ev(`(${q}).click()`);
      return true;
    },
    chip: (txt, ms) => b.tocar(".bcw-chip", txt, ms),
    async escribir(txt, enviar = true, form = ".bcw-form") {
      await ev(`document.querySelector('${form} input').focus()`);
      await send("Input.insertText", { text: txt });
      await sleep(150);
      if (enviar) await ev(`document.querySelector('${form}').requestSubmit()`);
    },
    esperarPregunta: (frag, ms) => b.esperar(`document.querySelector('.bcw-form input').placeholder.includes(${JSON.stringify(frag)})`, ms),
    sinPremio: () => b.esperar(`!document.querySelector('.bcw-award')`, 8000),
    async captura(nombre) {
      const r = await send("Page.captureScreenshot", { format: "png" });
      writeFileSync(join(capturas, `${nombre}-${ancho}.png`), Buffer.from(r.result.data, "base64"));
    },
    cerrar() {
      chrome.kill();
    },
  };
  return b;
}

// SSE body in the format of /api/chat
export const sse = (eventos) => eventos.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join("");
