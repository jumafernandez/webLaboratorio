// Bonus challenge: keys and signatures. The visitor gets a key pair, signs a message, then sees the signature fail
// when the message is altered and when someone else's key signs it. Real ECDSA from Web Crypto (curve P-256, the one
// browsers ship); Ethereum uses secp256k1, the same idea on another curve. Nothing leaves the browser.

import { POINT, THERE, esc, h, sha256, short } from "../util.js";

const ALG = { name: "ECDSA", namedCurve: "P-256" };
const FIRMA = { name: "ECDSA", hash: "SHA-256" };
const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, "0")).join("");

async function parDeClaves() {
  const par = await crypto.subtle.generateKey(ALG, true, ["sign", "verify"]);
  const pub = hex(await crypto.subtle.exportKey("raw", par.publicKey));
  // Like an Ethereum address: the last 20 bytes of a hash of the public key
  const dir = `0x${(await sha256(pub)).slice(-40)}`;
  return { ...par, pub, dir };
}
const firmar = async (clave, texto) => crypto.subtle.sign(FIRMA, clave, enc.encode(texto));
const verificar = (pub, firma, texto) => crypto.subtle.verify(FIRMA, pub, firma, enc.encode(texto));

export default async function bonusFirmas(ctx) {
  const yo = await parDeClaves();
  const sc = ctx.scene((s) => {
    s.innerHTML = `<div class="bcw-kicker">Desafío · Claves y firmas</div><h3>Firmá sin mostrar tu clave</h3>
      <p class="bcw-lead">Tu clave privada firma; tu clave pública (y tu dirección) sirve para que cualquiera compruebe la firma. La privada nunca sale de tu navegador.</p>
      <div class="bcw-firmas">
        <div class="bcw-box"><div class="bcw-k">🔒 Clave privada · solo vos</div><div class="bcw-mono bcw-priv">•••• •••• •••• •••• •••• •••• •••• ••••</div></div>
        <div class="bcw-box"><div class="bcw-k">🔓 Clave pública → tu dirección</div><div class="bcw-mono">${esc(short(yo.pub, 14, 8))}</div><div class="bcw-mono bcw-dirf">${esc(yo.dir)}</div></div>
        <div class="bcw-box bcw-wide"><div class="bcw-k">✉️ Mensaje</div><div class="bcw-msgf">—</div></div>
        <div class="bcw-box bcw-wide"><div class="bcw-k">✍️ Firma (ECDSA)</div><div class="bcw-mono bcw-sigf">—</div></div>
        <div class="bcw-veredicto" aria-live="polite"></div>
      </div>`;
  });
  const pinta = (sel, txt) => (sc.querySelector(sel).textContent = txt);
  const veredicto = (ok, txt) => {
    const v = sc.querySelector(".bcw-veredicto");
    v.className = `bcw-veredicto ${ok ? "bcw-ok" : "bcw-bad"}`;
    v.textContent = `${ok ? "✓" : "✗"} ${txt}`;
  };

  await ctx.bot("**Desafío · Claves y firmas.** En blockchain no hay usuario ni contraseña: hay un **par de claves**. Te acabo de generar uno.");
  await ctx.bot(`Escribí un mensaje para firmar, por ejemplo una orden de pago ${POINT}`, 400);
  ctx.escape();
  const texto = (await ctx.ask({ placeholder: "Ej: Le pago 10 USDL a Ana", onInput: (v) => pinta(".bcw-msgf", v || "—") })).trim().slice(0, 140) || "Le pago 10 USDL a Ana";
  pinta(".bcw-msgf", texto);
  const firma = await firmar(yo.privateKey, texto);
  pinta(".bcw-sigf", short(hex(firma), 24, 16));
  ctx.paso("firma");
  veredicto(await verificar(yo.publicKey, firma, texto), `Firma válida para ${short(yo.dir, 8, 6)}`);
  await ctx.bot(`Listo: tu clave privada produjo esa **firma**. Cualquiera que tenga tu clave pública comprueba ${THERE} que la firmaste vos, y nunca vio tu clave privada.`);

  // 1) Someone alters the signed message
  const alterado = /\d/.test(texto) ? texto.replace(/\d+/, (n) => `${n}0`) : `${texto} (y 100 más)`;
  await ctx.choose([{ l: "🕵️ Cambiar el mensaje sin volver a firmar" }]);
  pinta(".bcw-msgf", alterado);
  ctx.paso("adulterar");
  veredicto(await verificar(yo.publicKey, firma, alterado), "La firma no corresponde a este mensaje");
  await ctx.bot(`Cambié el mensaje a «${esc(alterado)}» y dejé la misma firma: **no verifica**. La firma depende de cada letra del mensaje, igual que el hash del Nivel 1.`);

  // 2) An impostor signs the original message with their own key
  await ctx.choose([{ l: "🎭 Que otra persona firme haciéndose pasar por vos" }]);
  const otro = await parDeClaves();
  const firmaFalsa = await firmar(otro.privateKey, texto);
  pinta(".bcw-msgf", texto);
  pinta(".bcw-sigf", short(hex(firmaFalsa), 24, 16));
  ctx.paso("impostor");
  veredicto(await verificar(yo.publicKey, firmaFalsa, texto), `Firmó ${short(otro.dir, 8, 6)}, no vos`);
  await ctx.bot("El mensaje es el original, pero lo firmó **otra clave**: contra tu clave pública **no verifica**. Sin tu clave privada nadie puede firmar por vos.");
  sc.append(h("div", "bcw-alert bcw-ok", "🔑 Así funciona cada transacción: la red no pregunta quién sos, verifica que la firma corresponda a la dirección que manda."));
  await ctx.bot("Esto ya lo usaste sin darte cuenta: cada acción del juego en la cadena real la **firmó tu wallet**, y en la lista de espera podés **firmar con tu wallet** para probar que esa dirección es tuya. Ethereum usa la curva **secp256k1**; acá usamos P-256, la que trae tu navegador. La idea es la misma.");
  ctx.addLog("🔑", "Firmaste un mensaje y detectaste dos falsificaciones", "ECDSA · clave privada / pública");
  await ctx.award("firmas");
  await ctx.bridge(1, "Claves, firmas digitales y curva elíptica se ven en la primera clase del **Curso 1**, con OpenSSL en la terminal.");
  await ctx.next();
}
