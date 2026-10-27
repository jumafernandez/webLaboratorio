// Plays the whole game from the hero: 4 levels, certificate, both bonuses, plus a keyword question.
// The API is mocked as "no AI" so the run is deterministic and free.
//   node tests/e2e/jugar_todo.mjs [ancho] [alto]

import { abrir, sleep } from "./navegador.mjs";

const ancho = Number(process.argv[2] || 1440);
const alto = Number(process.argv[3] || 900);
const sinIA = (req) => req.url.endsWith("/estado")
  ? { tipo: "application/json", cuerpo: JSON.stringify({ ok: false }) }
  : { tipo: "application/json", cuerpo: '{"ok":true}' };

const b = await abrir({ ancho, alto, mocks: sinIA });
const fallas = [];
const paso = async (nombre, ok) => {
  if (!(await ok)) fallas.push(nombre);
};

await b.ir("/blockchain-dev/?bcw=open");
await paso("portada visible", b.esperar(`!!document.querySelector('.bcw-panel.bcw-open .bcw-hero')`));
await sleep(1500);
await b.captura("01-portada");
await paso("entrar al mapa", b.tocar(".bcw-herochips .bcw-chip", "Ver los 4 niveles"));
await paso("mapa", b.esperar(`!!document.querySelector('.bcw-level')`));
await sleep(1200);
await b.captura("02-mapa");

// Level 1
await paso("nivel 1", b.chip("Nivel 1"));
await paso("nivel 1 pide texto", b.esperarPregunta("cadena"));
await b.escribir("Hola blockchain");
await paso("adulterar", b.chip("Sí, quiero cambiarlo", 25000));
await sleep(1200);
await b.ev(`(() => { const d=document.querySelector('.bcw-data[contenteditable=true]'); d.textContent += ' X'; d.dispatchEvent(new Event('input')); })()`);
await paso("cadena rota", b.esperar(`!!document.querySelector('.bcw-block.bcw-bad')`));
await b.captura("03-adulterada");
await paso("restaurar", b.chip("Restaurar"));
await paso("insignia 1", b.esperar(`!!document.querySelector('.bcw-award')`));
await b.sinPremio();

// Level 2
await paso("nivel 2", b.chip("Nivel 2"));
await paso("nivel 2 pide nombre", b.esperarPregunta("moneda"));
await b.escribir("Mate Coin");
await paso("supply", b.chip("1.000.000"));
await paso("pool", b.chip("Crear el pool", 25000));
await paso("comprar", b.tocar('.bcw-trade [data-a="buy"]'));
await sleep(300);
await b.tocar('.bcw-trade [data-a="buy"]');
await sleep(2500);
await paso("ballena", b.tocar('.bcw-trade [data-a="whale"]'));
await sleep(1200);
await b.captura("04-pool");
await paso("rug pull", b.chip("Retirar toda la liquidez"));
await sleep(2500);
await b.sinPremio();
await b.sinPremio();

// Level 3
await paso("nivel 3", b.chip("Nivel 3"));
await paso("nodos", b.esperar(`document.querySelectorAll('.bcw-node').length === 7`));
await sleep(2000);
const nodo = (i) => b.ev(`document.querySelectorAll('.bcw-node')[${i}].dispatchEvent(new MouseEvent('click',{bubbles:true}))`);
await nodo(1);
await sleep(3000);
await nodo(3);
await nodo(5);
await paso("sin quórum", b.esperar(`[...document.querySelectorAll('.bcw-msg')].some(m=>m.textContent.includes('no hay quórum'))`, 20000));
await b.captura("05-red-caida");
await nodo(5);
await paso("capa 2", b.chip("capa 2", 20000));
await paso("mandar 100 tx", b.tocar(".bcw-send"));
await sleep(3500);
await b.sinPremio();

// Level 4
await paso("nivel 4", b.chip("Nivel 4", 20000));
await paso("producto", b.tocar(".bcw-product"));
await paso("approve", b.tocar('[data-s="1"] .bcw-sign'));
await paso("pago", b.tocar('[data-s="2"] .bcw-sign'));
await paso("recibo", b.esperar(`[...document.querySelectorAll('.bcw-msg')].some(m=>m.textContent.includes('NFT recibo'))`, 20000));
await b.captura("06-recibo");
await paso("revert", b.chip("auto 0 km", 20000));
await paso("certificado", b.esperar(`!!document.querySelector('.bcw-cert')`, 30000));
await sleep(1200);
await b.captura("07-certificado");

// Bonus
await paso("bonus hack", b.chip("Hackeá un contrato", 20000));
await paso("atacar", b.tocar(".bcw-attack"));
await sleep(5000);
await paso("arreglo", b.chip("Aplicar el arreglo", 20000));
await paso("atacar de nuevo", b.tocar(".bcw-attack"));
await paso("bóveda segura", b.esperar(`[...document.querySelectorAll('.bcw-msg')].some(m=>m.textContent.includes('tu propio 1 ETH'))`, 15000));
await b.sinPremio();
await paso("bonus nft", b.chip("Hacete un NFT", 20000));
await paso("diseño", b.chip("Búho"));
await paso("nombre nft", b.esperarPregunta("NFT"));
await b.escribir("Ana");
await paso("nft minteado", b.esperar(`[...document.querySelectorAll('.bcw-msg')].some(m=>m.textContent.includes('token #'))`, 20000));
await b.sinPremio();

// Keyword routing (no AI)
await b.escribir("¿cuánto cuesta?");
await paso("palabra clave → aranceles", b.esperar(`!!document.querySelector('.bcw-price')`));

const estado = await b.ev(`({insignias: document.querySelectorAll('.bcw-pdot.bcw-on').length, bonus: document.querySelector('.bcw-pbonus')?.textContent || '', registro: document.querySelector('.bcw-log .bcw-count').textContent})`);
if (estado.insignias !== 4) fallas.push(`insignias ${estado.insignias}/4`);
if (b.errores.length) fallas.push(...b.errores.map((e) => `error JS: ${e}`));
console.log(JSON.stringify({ ancho, estado, fallas }, null, 1));
b.cerrar();
process.exit(fallas.length ? 1 : 0);
