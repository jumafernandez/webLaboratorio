// Every alternative branch of the game, each case in a clean browser. The API is mocked: "no AI" for keyword
// routing, canned SSE answers for the agent cases. Deterministic and free.
//   node tests/e2e/ramas.mjs [filtro]

import { abrir, sleep, sse } from "./navegador.mjs";

const sinIA = (req) => req.url.endsWith("/estado")
  ? { tipo: "application/json", cuerpo: JSON.stringify({ ok: false }) }
  : { tipo: "application/json", cuerpo: '{"ok":true}' };

const conIA = (req, pedidos) => {
  if (req.url.endsWith("/estado")) return { tipo: "application/json", cuerpo: JSON.stringify({ ok: true, modelo: "simulado", insignias_hoy: 5 }) };
  if (req.url.endsWith("/evento") || req.url.endsWith("/api/m")) return { tipo: "application/json", cuerpo: '{"ok":true}' };
  if (!req.url.endsWith("/chat")) return { tipo: "application/json", cuerpo: "{}" };   // /revisar, /cadena/…
  const p = JSON.parse(req.postData);
  pedidos.push(p);
  const q = p.mensajes.at(-1).texto;
  const fin = ["fin", { modelo: "simulado", vueltas: 1, tokens_entrada: 37000, tokens_cache: 36955, tokens_salida: 120, usd: 0.012, ms_primer_token: 900, ms_total: 3500 }];
  if (/contador/i.test(q))
    return { tipo: "text/event-stream", cuerpo: sse([["texto", { t: "Para un contador lo clave es **sellar** un registro." }],
      ["accion", { tipo: "jugar_nivel", nivel: "c1", ejemplo: "Sirve para sellar una factura y probar que nadie la tocó." }], fin]) };
  if (/docentes/i.test(q))
    return { tipo: "text/event-stream", cuerpo: sse([["texto", { t: "La dirige el **Dr. David Petrocelli**." }],
      ["accion", { tipo: "mostrar_sitio", tema: "docentes", curso: null }], ["accion", { tipo: "llevar_al_sitio", ancla: "#team" }],
      ["accion", { tipo: "sugerir", opciones: [{ etiqueta: "💱 Creá tu moneda", tipo: "nivel", valor: "c2" }, { etiqueta: "💰 Costo", tipo: "tema", valor: "aranceles" },
        { etiqueta: "🤔 ¿Programar?", tipo: "pregunta", valor: "¿Necesito saber programar?" }] }], fin]) };
  return { tipo: "text/event-stream", cuerpo: sse([["texto", { t: "Respuesta genérica." }], fin]) };
};

// Funnel beacons (POST /api/m via sendBeacon), captured by the mock.
const BEACONS = [];
const cuerpoDe = (req) => req.postData ?? (req.postDataEntries || []).map((e) => Buffer.from(e.bytes || "", "base64").toString()).join("");
const conMedicion = (req, pedidos) => {
  if (req.url.endsWith("/api/m")) {
    BEACONS.push(JSON.parse(cuerpoDe(req)));
    return { tipo: "application/json", cuerpo: "" };
  }
  if (req.url.endsWith("/estado")) return { tipo: "application/json", cuerpo: JSON.stringify({ ok: true, modelo: "simulado", medicion: true }) };
  return conIA(req, pedidos);
};
const hay = (evento, datos = {}) => BEACONS.some((e) => e.evento === evento && Object.entries(datos).every(([k, v]) => e.datos?.[k] === v));

// Real mode with a mocked relayer: the seal comes back 504 "sin_confirmar" (sent, not mined in time).
const TX_LENTA = "0x" + "ab".repeat(32);
const realLenta = (req) => {
  const u = req.url;
  const json = (o, estado = 200) => ({ tipo: "application/json", cuerpo: JSON.stringify(o), estado });
  const c = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
  if (u.endsWith("/api/estado"))
    return json({ ok: false, medicion: false, cadena: { modo: "real", chain_id: 31337, red: "Anvil (local)", explorador: null, disponible: true,
      contratos: { sellar: c, token: c, fondear: c, pagar: c, insignia: c }, ahora: Math.floor(Date.now() / 1000) } });
  if (u.endsWith("/cadena/estado")) return json({ bloque: 7 });
  if (u.endsWith("/cadena/sellar")) {
    const p = JSON.parse(req.postData);
    if (!/^0x[0-9a-f]{130}$/i.test(p.firma) || !p.nonce || !p.expira) return json({ error: "firma_invalida" }, 401);
    return json({ error: "sin_confirmar", tx: TX_LENTA, explorador_tx: null }, 504);
  }
  if (u.endsWith("/cadena/insignia")) return json({ tx: "0x" + "cd".repeat(32), bloque: 9, token_id: 1, nombre: "Insignia Bloques", explorador_tx: null, explorador_nft: null });
  return json({ ok: true });
};

const msg = (txt) => `[...document.querySelectorAll('.bcw-msg')].some(m=>m.textContent.includes(${JSON.stringify(txt)}))`;
const enMapa = async (b) => {
  await b.ir("/blockchain-dev/?bcw=open");
  await b.tocar(".bcw-herochips .bcw-chip", "Ver los 4 niveles");
  return b.esperar(`!!document.querySelector('.bcw-level')`);
};

const CASOS = [
  ["tarjeta del mapa abre el nivel 3", sinIA, async (b) => {
    await enMapa(b);
    await b.tocar(".bcw-level", "Intentá tirar la red");
    return b.esperar(`document.querySelectorAll('.bcw-node').length === 7`);
  }],
  ["nivel 1 sin adulterar da la insignia", sinIA, async (b) => {
    await enMapa(b);
    await b.chip("Nivel 1");
    await b.esperarPregunta("cadena");
    await b.escribir("Sin trampa");
    await b.chip("Seguir sin romper nada", 25000);
    return b.esperar(`document.querySelectorAll('.bcw-pdot.bcw-on').length === 1`, 15000);
  }],
  ["'Mejor otra cosa' corta el nivel y se puede retomar", sinIA, async (b) => {
    await enMapa(b);
    await b.chip("Nivel 2");
    await b.esperarPregunta("moneda");
    await b.chip("Mejor otra cosa");
    const mapa = await b.esperar(`!!document.querySelector('.bcw-level')`);
    const libre = await b.esperar(`!document.querySelector('.bcw-form input').placeholder.includes('moneda')`);
    await b.chip("Nivel 2");
    return mapa && libre && (await b.esperarPregunta("moneda"));
  }],
  ["vender baja el precio en el pool", sinIA, async (b) => {
    await enMapa(b);
    await b.chip("Nivel 2");
    await b.esperarPregunta("moneda");
    await b.escribir("Test Coin");
    await b.chip("1.000");
    await b.chip("Crear el pool", 25000);
    await b.tocar('.bcw-trade [data-a="sell"]');
    await sleep(300);
    return b.esperar(`document.querySelector('.bcw-pchg').classList.contains('bcw-down')`);
  }],
  ["nivel 4 con 'Seguir' no muestra el revert y da la insignia", sinIA, async (b) => {
    await enMapa(b);
    await b.chip("Nivel 4");
    await b.tocar(".bcw-product");
    await b.tocar('[data-s="1"] .bcw-sign');
    await b.tocar('[data-s="2"] .bcw-sign');
    await b.chip("Seguir", 25000);
    const ok = await b.esperar(`document.querySelectorAll('.bcw-pdot.bcw-on').length === 1`, 15000);
    return ok && !(await b.ev(`!!document.querySelector('.bcw-revert')`));
  }],
  ["cortar un nivel a mitad de animación no deja mensajes sueltos", sinIA, async (b) => {
    await enMapa(b);
    await b.chip("Nivel 3");
    await b.esperar(`document.querySelectorAll('.bcw-node').length === 7`);
    await b.ev(`document.querySelector('.bcw-home').click()`);
    await b.esperar(`!!document.querySelector('.bcw-level')`);
    await sleep(1500);
    const n = await b.ev(`document.querySelectorAll('.bcw-msg').length`);
    await sleep(4000);
    return n === (await b.ev(`document.querySelectorAll('.bcw-msg').length`)) && (await b.ev(`!!document.querySelector('.bcw-level')`));
  }],
  ["temas de la diplomatura muestran su escena", sinIA, async (b) => {
    await enMapa(b);
    const temas = [["Requisitos", "Dos caminos"], ["¿Es para mí?", "A quién va dirigida"], ["Salida laboral", "Qué podés hacer"],
      ["Docentes", "Quiénes dan las clases"], ["Plan de estudios", "4 cursos"]];
    for (const [chip, titulo] of temas) {
      await b.chip("La diplomatura");
      if (!(await b.chip(chip))) return false;
      if (!(await b.esperar(`document.querySelector('.bcw-scene h3')?.textContent.includes(${JSON.stringify(titulo)})`))) return false;
    }
    return true;
  }],
  ["'Ir al plan en el sitio' lleva a la página real", sinIA, async (b) => {
    await enMapa(b);
    await b.chip("La diplomatura");
    await b.chip("Plan de estudios");
    await b.tocar(".bcw-cta", "Ir al plan en el sitio");
    await sleep(1500);
    return (await b.ev(`!document.querySelector('.bcw-panel').classList.contains('bcw-open') && window.scrollY > 200 && getComputedStyle(document.querySelector('.bcw-launcher')).display !== 'none'`));
  }],
  ["wallet y 'Lo que hiciste hoy'", sinIA, async (b) => {
    await enMapa(b);
    await b.chip("Nivel 1");
    await b.esperarPregunta("cadena");
    await b.escribir("Hola");
    await b.chip("Seguir sin romper nada", 25000);
    await b.esperar(`document.querySelectorAll('.bcw-pdot.bcw-on').length === 1`, 15000);
    await b.sinPremio();
    await b.chip("Mi wallet", 15000);
    const wallet = await b.esperar(`!!document.querySelector('.bcw-scene .bcw-wallet') && document.querySelectorAll('.bcw-scene .bcw-nft').length >= 1`);
    await b.ev(`document.querySelector('.bcw-log').click()`);
    return wallet && (await b.esperar(`document.querySelectorAll('.bcw-loglist li').length >= 2`));
  }],
  ["palabras clave sin IA", sinIA, async (b) => {
    await enMapa(b);
    const casos = [["¿cuánto cuesta?", ".bcw-price"], ["docentes", ".bcw-cards"], ["inscripción", ".bcw-facts"],
      ["quiero un nft", ".bcw-designs"], ["hackear un contrato", ".bcw-hackgrid"], ["algo raro xyz", null]];
    for (const [q, sel] of casos) {
      await b.escribir(q);
      if (sel && !(await b.esperar(`!!document.querySelector('.bcw-scene ${sel}')`))) return false;
      if (!sel && !(await b.esperar(msg("respondo con botones")))) return false;
      await sleep(600);
    }
    return true;
  }],
  ["agente: rubro arranca el nivel con el ejemplo", conIA, async (b) => {
    await b.ir("/blockchain-dev/?bcw=open");
    await b.esperar(`!!document.querySelector('.bcw-ai:not([hidden])')`);
    await b.escribir("Soy contador, ¿me sirve?", true, ".bcw-heroform");
    return b.esperar(`!!document.querySelector('.bcw-ejemplo')`);
  }],
  ["agente: sitio, botón al sitio, sugerencias y 'Ver por dentro'", conIA, async (b) => {
    await enMapa(b);
    await b.escribir("¿Quiénes son los docentes?");
    const ok = await b.esperar(`[...document.querySelectorAll('.bcw-chip')].some(c=>c.textContent.includes('Creá tu moneda'))`);
    const boton = await b.ev(`[...document.querySelectorAll('.bcw-cta')].some(c=>c.textContent.includes('Ir a esta sección'))`);
    await b.ev(`document.querySelector('.bcw-dentro-btn').click()`);
    const dentro = await b.esperar(`document.querySelector('.bcw-dbody').textContent.includes('mostrar_sitio')`);
    await b.chip("¿Programar?");
    const pregunta = await b.esperar(msg("Respuesta genérica"));
    return ok && boton && dentro && pregunta && b.pedidos.at(-1).mensajes.at(-1).texto === "¿Necesito saber programar?";
  }],
  ["pregunta con '?' en medio de un nivel va al agente", conIA, async (b) => {
    await enMapa(b);
    await b.chip("Nivel 1");
    await b.esperarPregunta("cadena");
    await b.escribir("¿Quiénes son los docentes?");
    return b.esperar(`!!document.querySelector('.bcw-scene .bcw-cards')`);
  }],
  ["selector: por defecto el sitio; el juego abre a pedido y se recuerda; ?vista=sitio gana", sinIA, async (b) => {
    await b.ir("/blockchain-dev/");
    await sleep(1500);
    const sitio = await b.ev(`!document.querySelector('.bcw-panel') && !!document.querySelector('.bcw-launcher')`);   // nada pesado cargado
    await b.ev(`document.querySelector('.bcw-launcher').click()`);
    const abre = await b.esperar(`document.querySelector('.bcw-panel')?.classList.contains('bcw-open')`);
    await b.tocar(".bcw-selector button", "Sitio convencional");
    await b.send("Page.reload");
    await sleep(2500);
    const quedo = await b.ev(`!document.querySelector('.bcw-panel')?.classList.contains('bcw-open')`);
    await b.ev(`document.querySelector('.bcw-launcher').click()`);   // guarda "juego"
    const vuelve = await b.esperar(`document.querySelector('.bcw-panel')?.classList.contains('bcw-open')`);
    await b.send("Page.reload");
    const recordado = await b.esperar(`document.querySelector('.bcw-panel')?.classList.contains('bcw-open')`);
    await b.ir("/blockchain-dev/?vista=sitio");
    await sleep(2000);
    const gana = await b.ev(`!document.querySelector('.bcw-panel')?.classList.contains('bcw-open')`);
    await b.ev(`localStorage.clear()`);
    return sitio && abre && quedo && vuelve && recordado && gana;
  }],
  ["modal: role dialog, Tab atrapado, fondo inerte, Escape cierra y devuelve el foco", sinIA, async (b) => {
    await b.ir("/blockchain-dev/");
    await sleep(1200);
    await b.ev(`document.querySelector('.bcw-launcher').focus(); document.querySelector('.bcw-launcher').click()`);
    await b.esperar(`document.querySelector('.bcw-panel')?.classList.contains('bcw-open')`);
    await sleep(500);
    const info = await b.ev(`(() => { const p = document.querySelector('.bcw-panel'); const otros = [...document.body.children].filter(e => e !== p && !/SCRIPT|STYLE|LINK/.test(e.tagName));
      return {rol: p.getAttribute('role'), modal: p.getAttribute('aria-modal'), inertes: otros.every(e => e.inert), foco: p.contains(document.activeElement), h1: p.querySelectorAll('h1').length}; })()`);
    // Tab 40 times: the focus never leaves the dialog
    let siempreDentro = true;
    for (let i = 0; i < 40 && siempreDentro; i++) {
      await b.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
      await b.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
      siempreDentro = await b.ev(`document.querySelector('.bcw-panel').contains(document.activeElement)`);
    }
    await b.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await b.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    const cerrado = await b.esperar(`!document.querySelector('.bcw-panel').classList.contains('bcw-open')`, 3000);
    const vuelta = await b.ev(`({foco: document.activeElement === document.querySelector('.bcw-launcher') ? 'launcher' : document.activeElement.tagName + '.' + document.activeElement.className, sinInertes: [...document.body.children].filter(e => !e.classList.contains('bcw-panel')).every(e => !e.inert), panelInerte: document.querySelector('.bcw-panel').inert})`);
    vuelta.ok = vuelta.foco === "launcher" && vuelta.sinInertes && vuelta.panelInerte;
    await b.ev(`localStorage.clear()`);
    if (!(info.rol === "dialog" && info.modal === "true" && info.inertes && info.foco && info.h1 === 0 && siempreDentro && cerrado && vuelta.ok))
      b.errores.push(JSON.stringify({ info, siempreDentro, cerrado, vuelta }));
    return info.rol === "dialog" && info.modal === "true" && info.inertes && info.foco && info.h1 === 0 && siempreDentro && cerrado && vuelta.ok;
  }],
  ["equipo: ?bcw_equipo=1 apaga toda la medición hasta ?bcw_equipo=0", conMedicion, async (b) => {
    BEACONS.length = 0;
    await b.ir("/blockchain-dev/?bcw_equipo=1&bcw=open");
    await b.tocar(".bcw-herochips .bcw-chip", "Ver los 4 niveles");
    await b.esperar(`!!document.querySelector('.bcw-level')`);
    await sleep(1500);
    const callada = BEACONS.length === 0;
    await b.ir("/blockchain-dev/?bcw=open");               // la marca persiste sin el parámetro
    await b.tocar(".bcw-herochips .bcw-chip", "Ver los 4 niveles");
    await sleep(1500);
    const persiste = BEACONS.length === 0;
    await b.ir("/blockchain-dev/?bcw_equipo=0&bcw=open");
    await b.esperar(`!!document.querySelector('.bcw-ai:not([hidden])')`);
    await b.tocar(".bcw-herochips .bcw-chip", "Ver los 4 niveles");
    await sleep(1500);
    if (!(callada && persiste && hay("entro_juego"))) b.errores.push(JSON.stringify({ callada, persiste, entro: hay("entro_juego"), n: BEACONS.length }));
    return callada && persiste && hay("entro_juego");
  }],
  ["medición: el embudo de una sesión corta llega por beacons, sin texto del visitante", conMedicion, async (b) => {
    BEACONS.length = 0;
    await b.ir("/blockchain-dev/?bcw=open");
    await b.esperar(`!!document.querySelector('.bcw-ai:not([hidden])')`);
    await b.tocar(".bcw-herochips .bcw-chip", "Ver los 4 niveles");
    await b.esperar(`!!document.querySelector('.bcw-level')`);
    await b.chip("Nivel 1");
    await b.esperarPregunta("cadena");
    await b.escribir("Mensaje secreto Zorzal");
    await b.chip("Seguir sin romper nada", 25000);
    await b.esperar(`document.querySelectorAll('.bcw-pdot.bcw-on').length === 1`, 15000);
    await b.sinPremio();
    await b.chip("Nivel 2", 15000);
    await b.esperarPregunta("moneda");
    await b.chip("Mejor otra cosa");
    await b.esperar(`!!document.querySelector('.bcw-level')`);
    await b.escribir("¿Quiénes son los docentes? Zorzal");
    await b.esperar(`[...document.querySelectorAll('.bcw-chip')].some(c=>c.textContent.includes('Creá tu moneda'))`);
    await b.ev(`document.querySelector('.bcw-dentro-btn').click()`);
    await b.ev(`document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape'}))`);
    const cerro = await b.esperar(`!document.querySelector('.bcw-panel').classList.contains('bcw-dentro-open')`, 3000);
    await b.ev(`document.querySelector('.bcw-log').click()`);
    await b.ev(`(() => { const a = document.querySelector('.bcw-scene a[data-origen]'); a.addEventListener('click', (e) => e.preventDefault()); a.click(); })()`);
    await b.tocar(".bcw-selector button", "Sitio convencional");
    await b.ev(`document.querySelector('.bcw-launcher').click()`);
    await sleep(1500);
    const esperados = [["visita"], ["entro_juego", { fuente: "chip" }], ["nivel_inicio", { nivel: "c1" }], ["nivel_paso", { nivel: "c1", paso: "mensaje" }],
      ["nivel_paso", { nivel: "c1", paso: "minado" }], ["nivel_fin", { nivel: "c1" }], ["insignia", { id: "c1" }], ["nivel_inicio", { nivel: "c2" }],
      ["nivel_abandono", { nivel: "c2", paso: "inicio" }],
      ["tema_sitio", { tema: "docentes" }], ["ver_por_dentro", { tab: "agente" }], ["lista_espera_click", { origen: "recorrido" }],
      ["sitio_convencional"], ["volver_juego"]];
    const faltan = esperados.filter(([e, d]) => !hay(e, d));
    const sesiones = new Set(BEACONS.map((e) => e.sesion));
    const texto = JSON.stringify(BEACONS);
    // pregunta_agente lo escribe el servidor: el widget manda su id de sesión en el pedido al agente
    const conSesion = b.pedidos.some((p) => p.mensajes.at(-1).texto.includes("docentes") && p.sesion === [...sesiones][0]);
    const ok = conSesion && !faltan.length && sesiones.size === 1 && /^[0-9a-f]{32}$/.test([...sesiones][0]) && !/Zorzal|secreto|docentes\?/i.test(texto)
      && !hay("nivel_abandono", { nivel: "c1" }) && cerro;
    if (!ok) b.errores.push(`faltan ${JSON.stringify(faltan)} · sesiones ${sesiones.size} · dentro cerrado ${cerro} · ${BEACONS.length} beacons`);
    return ok;
  }],
  ["medición: con Do Not Track no sale ningún beacon", conMedicion, async (b) => {
    BEACONS.length = 0;
    await b.send("Page.addScriptToEvaluateOnNewDocument", { source: "Object.defineProperty(Navigator.prototype, 'doNotTrack', { get: () => '1' })" });
    await b.ir("/blockchain-dev/?bcw=open");
    await b.tocar(".bcw-herochips .bcw-chip", "Ver los 4 niveles");
    await b.esperar(`!!document.querySelector('.bcw-level')`);
    await sleep(1500);
    return BEACONS.length === 0;
  }],
  ["cadena real: tx sin confirmar se muestra como enviada, no como simulada", realLenta, async (b) => {
    await b.ir("/blockchain-dev/?bcw=open");
    await b.ev(`window.__notas = []; new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => n.classList?.contains('bcw-simnote') && window.__notas.push(n.textContent)))).observe(document.body, {childList: true, subtree: true}); 1`);
    if (!(await b.esperar(`document.querySelector('.bcw-badge')?.textContent.includes('Anvil local')`))) return false;
    await b.tocar(".bcw-herochips .bcw-chip", "Ver los 4 niveles");
    await b.chip("Nivel 1");
    await b.esperarPregunta("cadena");
    await b.escribir("Hola lenta");
    const tarjeta = await b.esperar(`document.querySelector('.bcw-tx')?.textContent.includes('enviada, sin confirmar')`, 30000);
    const notas = await b.ev("window.__notas");
    const txt = await b.ev(`document.querySelector('.bcw-tx')?.textContent || ''`);
    await b.chip("Seguir sin romper nada", 25000);
    await b.ev(`document.querySelector('.bcw-dentro-btn').click()`);
    await b.tocar('.bcw-dtabs button[data-t="cadena"]');
    const dentro = await b.esperar(`[...document.querySelectorAll('.bcw-rtxs li')].some(li => li.textContent.includes('sin confirmar') && li.textContent.includes('${TX_LENTA}'))`, 5000);
    const ok = tarjeta && notas.some((n) => n.includes("todavía no se confirmó")) && !notas.some((n) => n.includes("esta vez fue simulada"))
      && !txt.includes("Base Sepolia") && dentro;
    if (!ok) b.errores.push(`tarjeta ${tarjeta} · notas ${JSON.stringify(notas)} · dentro ${dentro} · ${txt.slice(0, 160)}`);
    return ok;
  }],
  ["celular: portada sin desborde horizontal", sinIA, async (b) => {
    await b.ir("/blockchain-dev/?bcw=open");
    await b.esperar(`!!document.querySelector('.bcw-panel.bcw-open .bcw-hero')`);
    await sleep(1200);
    await b.captura("ramas-celular-portada");
    const r = await b.ev(`(() => { const s=document.querySelector('.bcw-selector').getBoundingClientRect(); return s.right <= innerWidth && document.scrollingElement.scrollWidth <= innerWidth; })()`);
    await b.tocar(".bcw-herochips .bcw-chip", "Ver los 4 niveles");
    await b.esperar(`!!document.querySelector('.bcw-level')`);
    await sleep(800);
    await b.captura("ramas-celular-mapa");
    // Playing mode adds the map button to the header: nothing may get wider than the viewport.
    const jugando = await b.ev(`(() => { const w = innerWidth; const r = (s) => document.querySelector(s).getBoundingClientRect().right;
      return { chat: r('.bcw-chat'), stage: r('.bcw-stage'), boton: r('.bcw-form button'), selector: r('.bcw-selector'), head: r('.bcw-head'),
        scroll: document.querySelector('.bcw-chat').scrollWidth, w, punto: getComputedStyle(document.querySelector('.bcw-badge')).display }; })()`);
    const okJugando = ["chat", "stage", "boton", "selector", "head", "scroll"].every((k) => jugando[k] <= jugando.w + 0.5) && jugando.punto !== "none";
    if (!okJugando) b.errores.push(`desborde jugando: ${JSON.stringify(jugando)}`);
    return r && okJugando;
  }, { ancho: 390, alto: 844 }],
  ["celular angosto (360) jugando sin desborde", sinIA, async (b) => {
    await enMapa(b);
    await b.chip("Nivel 1");
    await b.esperarPregunta("cadena");
    await sleep(600);
    const d = await b.ev(`(() => [...document.querySelectorAll('.bcw-panel *')].filter(e => e.getClientRects().length && e.getBoundingClientRect().right > innerWidth + 0.5 && !e.closest('.bcw-dentro, .bcw-fondo, .bcw-chain, .bcw-scene')).map(e => e.className).slice(0, 5))()`);
    if (d.length) b.errores.push(`se salen: ${JSON.stringify(d)}`);
    return !d.length;
  }, { ancho: 360, alto: 740 }],
  ["nivel 4 repetido: el saldo nunca queda negativo", sinIA, async (b) => {
    await enMapa(b);
    const saldos = [];
    for (let i = 0; i < 5; i++) {
      if (i) await b.chip("Ver el mapa", 20000);
      await b.tocar(".bcw-level", "Pagá con cripto", 20000);
      if (!(await b.tocar(".bcw-product", "Entrada", 20000))) {
        b.errores.push(`sin producto en la vuelta ${i + 1}: ${JSON.stringify(saldos)}`);
        return false;
      }
      await b.tocar('[data-s="1"] .bcw-sign');
      await b.tocar('[data-s="2"] .bcw-sign');
      await b.esperar(`[...document.querySelectorAll('.bcw-msg')].filter(m=>m.textContent.includes('te llegó el NFT recibo')).length > ${i}`, 20000);
      saldos.push(await b.ev(`(document.querySelector('.bcw-scene .bcw-bal')?.textContent || '')`));
      await b.chip("Seguir", 20000);
      await b.esperar(`[...document.querySelectorAll('.bcw-msg')].filter(m=>m.textContent.includes('Curso 4**') || m.textContent.includes('se construye en el Curso 4')).length > ${i}`, 20000);
      await b.sinPremio();
      await b.esperar(`[...document.querySelectorAll('.bcw-chip')].some(c=>c.textContent.includes('Ver el mapa'))`, 20000);
      await sleep(400);
    }
    const n = saldos.map((t) => Number(t.replace(/\D/g, "")));
    const recarga = await b.esperar(`[...document.querySelectorAll('.bcw-msg')].some(m=>m.textContent.includes('te recargué'))`, 1000);
    const quedan = await b.esperar(`[...document.querySelectorAll('.bcw-msg')].some(m=>m.textContent.includes('Te quedan 75 USDL'))`, 1000);
    const ok = JSON.stringify(n) === JSON.stringify([75, 50, 25, 0, 75]) && !saldos.some((t) => t.includes("-")) && recarga && quedan;
    if (!ok) b.errores.push(`saldos ${JSON.stringify(saldos)} recarga ${recarga} quedan ${quedan}`);
    return ok;
  }],
  ["medición: quien arranca en el sitio cuenta como visita (vista sitio), una sola vez por sesión", conMedicion, async (b) => {
    BEACONS.length = 0;
    await b.ir("/blockchain-dev/?vista=sitio");
    await sleep(2500);
    const enSitio = !(await b.ev(`document.querySelector('.bcw-panel').classList.contains('bcw-open')`));
    await b.send("Page.reload");
    await sleep(2500);
    await b.ev(`document.querySelector('.bcw-launcher').click()`);
    await sleep(1200);
    const visitas = BEACONS.filter((e) => e.evento === "visita");
    const ok = enSitio && visitas.length === 1 && visitas[0].datos?.vista === "sitio" && !hay("volver_juego");
    if (!ok) b.errores.push(`visitas ${JSON.stringify(visitas)} · volver_juego ${hay("volver_juego")} · en sitio ${enSitio}`);
    return ok;
  }],
];

const filtro = process.argv[2] || "";
const resultados = [];
for (const [nombre, mocks, fn, opts] of CASOS) {
  if (filtro && !nombre.includes(filtro)) continue;
  const b = await abrir({ mocks, ...(opts || {}) });
  let ok = false;
  try {
    ok = await fn(b);
  } catch (e) {
    b.errores.push(String(e).slice(0, 200));
  }
  if (b.errores.length) ok = false;
  resultados.push({ caso: nombre, ok, errores: b.errores });
  console.log(`${ok ? "✓" : "✗"} ${nombre}${b.errores.length ? "  " + b.errores.join(" | ") : ""}`);
  b.cerrar();
}
const mal = resultados.filter((r) => !r.ok).length;
console.log(`\n${resultados.length - mal}/${resultados.length} casos OK`);
process.exit(mal ? 1 : 0);
