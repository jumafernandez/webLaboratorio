// "The normal site" inside the stage: cards built from the blockchain-dev pages, with buttons that scroll the real
// page or open the full page. Data copied from the site (October 2026); the agent answers from the full text.

import { track } from "./medicion.js";
import { POINT, REDUCE, WAITLIST_URL, h } from "./util.js";

// Next informative talk from blockchain-dev/charla-proxima.json (the same file the landing page reads); null while the
// date is not set, so nothing invented ever shows.
async function proximaCharla() {
  try {
    const d = await (await fetch("/blockchain-dev/charla-proxima.json", { cache: "no-cache" })).json();
    if (/^\d{4}-\d{2}$/.test(d?.fecha || "")) {
      // Only the month is known
      const mes = new Date(`${d.fecha}-15T12:00:00-03:00`).toLocaleDateString("es-AR", { month: "long", year: "numeric" });
      return `${mes} (día y hora a confirmar)`;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d?.fecha || "")) return null;
    const dia = new Date(`${d.fecha}T12:00:00-03:00`).toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" });
    return `${dia}, ${d.hora || "19:00"} h (ARG)`;
  } catch {
    return null;
  }
}

const TEAM_IMG = "/assets/img/team/";

export const SITE_TOPICS = [
  { id: "plan", l: "📚 Plan de estudios" },
  { id: "docentes", l: "👩‍🏫 Docentes" },
  { id: "aranceles", l: "💰 Costo" },
  { id: "inscripcion", l: "📅 Inscripción y horarios" },
  { id: "requisitos", l: "✅ Requisitos" },
  { id: "destinatarios", l: "🎯 ¿Es para mí?" },
  { id: "salida", l: "💼 Salida laboral" },
];

const MODULES = [
  ["Fundamentos de Blockchain, y Frameworks y Herramientas para la Creación de DApps", "Del primer commit al primer contrato verificado: entender blockchain construyéndolo."],
  ["Fundamentos Financieros y Blockchain para Finanzas Descentralizadas", "Tokenomics con criterio regulatorio argentino (CNV, PSAV / RG 994)."],
  ["Automatización de Infraestructura y Arquitectura Tecnológica para Blockchain", "Lo que necesitás de Web2 para que tu Web3 funcione en producción."],
  ["Desarrollo de Aplicaciones y DApps Blockchain", "Del contrato al producto en Layer 2: pasarela de pago con ERC-20, NFT de recibo y frontend."],
];

const TEAM = [
  ["petrocelli.jpg", "Dr. David Petrocelli", "Director", "Dr. en Ciencias Informáticas (UNLP). Senior Cloud Architect en Caylent Inc."],
  ["1.jpg", "Mg. Juan M. Fernández", "Coordinador Académico", "Director de LICDIA-UNLu. Profesor en UNLu, ITBA y UNTREF."],
  ["olivares.jpg", "Dr. Julián Olivares", "Cuerpo docente", "Dr. en Historia (UBA). Economía política y bases macro internacionales."],
  ["guevara.jpg", "Deiller Guevara", "Cuerpo docente", "Operador de derivados (A3 Mercados). DeFi y market making."],
  ["ciro.jpg", "Ciro E. Romero", "Cuerpo docente", "Líder de I+D+i en C&S Informática. Blockchain + IoT y Zero Knowledge."],
  ["mromero.jpg", "Mauricio Romero", "Cuerpo docente", "Bases de datos en el BCRA. Ayudante en Sistemas Distribuidos (UNLu)."],
];

// One short real class per course (blockchain-dev/fragmentos/), shown when a level's bridge highlights its course.
const FRAGMENTOS = {
  1: ["curso1-ciro-como-se-encadenan-los-bloques", "Cómo se encadenan los bloques", "Ciro Romero", "2:08"],
  2: ["curso2-deiller-por-que-nacen-los-amm", "Por qué nacen los AMM", "Deiller Guevara", "1:57"],
  3: ["curso3-david-infraestructura-como-codigo", "Infraestructura como código", "David Petrocelli", "1:37"],
};
const FRAG_DIR = "/blockchain-dev/fragmentos/";

function fragmentoEl(n) {
  const f = FRAGMENTOS[n];
  if (!f) return null;
  const [archivo, tema, docente, dur] = f;
  const d = h("details", "bcw-clase");
  d.innerHTML = `<summary>🎬 Mirá ${dur} de una clase real: ${tema} · ${docente}</summary>
    <video controls preload="none" playsinline poster="${FRAG_DIR}${archivo}.jpg">
      <source src="${FRAG_DIR}${archivo}.mp4" type="video/mp4">
      <track kind="captions" srclang="es" label="Español" src="${FRAG_DIR}${archivo}.vtt" default>
    </video>`;
  d.querySelector("video").setAttribute("aria-label", `${tema}, ${docente}`);
  d.addEventListener("toggle", () => d.open && track("fragmento", { curso: `c${n}` }), { once: true });
  return d;
}

export function planScene(s, ctx, hi) {
  const done = ctx.S.badges;
  s.innerHTML = `<div class="bcw-kicker">Del sitio · Plan de estudios</div><h3>4 cursos, 160 horas, 4 meses</h3>
    <p class="bcw-lead">Clases en vivo martes y jueves de 19 a 21 h, virtual.</p>`;
  MODULES.forEach(([t, l], i) => {
    const n = i + 1;
    const m = h("div", `bcw-mod${n === hi ? " bcw-hi" : ""}`);
    m.innerHTML = `<div class="bcw-num">${n}</div><div><h4>Curso ${n} · ${t}</h4><p>${l}</p>${done.has(`c${n}`) ? '<span class="bcw-you">✓ Ganaste la insignia de este curso</span>' : ""}</div>`;
    s.append(m);
  });
  const frag = fragmentoEl(hi);
  if (frag) s.append(frag);
  ctx.actions(s, [
    { l: "📍 Ir al plan en el sitio", f: () => ctx.goto("#informacionPlan") },
    { l: "📄 Plan completo", href: "/blockchain-dev/plan-de-estudios/" },
  ]);
  if (hi) requestAnimationFrame(() => s.querySelector(".bcw-hi")?.scrollIntoView({ block: "nearest", behavior: REDUCE ? "auto" : "smooth" }));
}

const SCENES = {
  plan: {
    text: `Son **4 cursos** de 40 horas en 4 meses, y cada uno es un nivel del juego ${POINT}`,
    build: (s, ctx, opts) => planScene(s, ctx, opts.curso),
  },
  docentes: {
    text: `La dirige el **Dr. David Petrocelli** y la coordina el **Mg. Juan M. Fernández**. Acá está todo el equipo ${POINT}`,
    build(s, ctx) {
      s.innerHTML = `<div class="bcw-kicker">Del sitio · Docentes</div><h3>Quiénes dan las clases</h3>`;
      const grid = h("div", "bcw-cards");
      for (const [img, n, r, d] of TEAM) grid.append(h("div", "bcw-card", `<img src="${TEAM_IMG}${img}" alt="" loading="lazy"><h4>${n}</h4><div class="bcw-role">${r}</div><p>${d}</p>`));
      s.append(grid);
      ctx.actions(s, [{ l: "📍 Ver docentes en el sitio", f: () => ctx.goto("#team") }]);
    },
  },
  aranceles: {
    text: "La matrícula es de **$170.000** y después son **4 cuotas de $170.000**, una por curso: **$850.000** en total. Vence el 15 de cada mes.",
    build(s, ctx) {
      s.innerHTML = `<div class="bcw-kicker">Del sitio · Aranceles</div><h3>Cuánto sale</h3><p class="bcw-lead">Valores en pesos argentinos.</p>
        <div class="bcw-price">
          <div class="bcw-card"><h4>Matrícula</h4><div class="bcw-amt">$170.000</div><p>al inicio</p></div>
          <div class="bcw-card"><h4>4 cuotas</h4><div class="bcw-amt">$170.000</div><p>c/u, una por curso</p></div>
          <div class="bcw-card bcw-total"><h4>Total</h4><div class="bcw-amt">$850.000</div><p style="color:#e9e4ff">matrícula + 4 cuotas</p></div>
        </div>
        <div class="bcw-facts" style="margin-top:12px">
          <div class="bcw-fact"><b>Vence el 15</b><span>de cada mes</span></div>
          <div class="bcw-fact"><b>Cómo pagar</b><span>Pago Mis Cuentas, cajero o transferencia</span></div>
        </div>`;
      ctx.actions(s, [{ l: "📄 Ver aranceles completos", href: "/blockchain-dev/aranceles/" }]);
    },
  },
  inscripcion: {
    text: `La **cohorte 2026 ya está en curso** (arrancó el 11/08, con 15 estudiantes). Si te interesa, anotate en la **lista de espera 2027** y te escriben cuando abra ${POINT}`,
    build(s, ctx) {
      s.innerHTML = `<div class="bcw-kicker">Del sitio · Inscripción</div><h3>Cohorte 2026 en curso · se abre 2027</h3>
        <p class="bcw-lead">La cohorte 2026 arrancó en agosto con 15 estudiantes. Dejá tus datos y te escriben cuando abra la inscripción.</p>
        <div class="bcw-facts">
          <div class="bcw-fact"><b>Virtual</b><span>modalidad</span></div>
          <div class="bcw-fact"><b>Mar y jue 19–21 h</b><span>clases en vivo</span></div>
          <div class="bcw-fact"><b>160 horas</b><span>4 cursos en 4 meses</span></div>
          <div class="bcw-fact"><b>Posgrado universitario</b><span>título de la UNLu</span></div>
        </div>`;
      const charla = h("p", "bcw-stat", "📅 Próxima charla informativa: fecha a confirmar.");
      s.append(charla);
      proximaCharla().then((t) => t && (charla.textContent = `📅 Próxima charla informativa: ${t}.`));
      ctx.actions(s, [
        { l: "✍️ Anotarme en la lista de espera 2027", href: WAITLIST_URL, primary: true, origen: "inscripcion" },
        { l: "📄 Programa completo (PDF)", href: `${WAITLIST_URL}?desde=programa`, origen: "programa" },
      ]);
    },
  },
  requisitos: {
    text: "Entrás con un **título universitario de cualquier orientación** o, sin título, demostrando **experiencia profesional** en una entrevista con la Dirección. Ayuda saber programar en algún lenguaje y manejar Git y la terminal.",
    build(s, ctx) {
      s.innerHTML = `<div class="bcw-kicker">Del sitio · Requisitos</div><h3>Dos caminos para entrar</h3>
        <div class="bcw-facts">
          <div class="bcw-fact"><b>Título universitario</b><span>de grado o pregrado, de cualquier orientación</span></div>
          <div class="bcw-fact"><b>Experiencia profesional</b><span>sin título, con entrevista con la Dirección</span></div>
        </div>
        <p class="bcw-lead" style="margin-top:14px">Conocimientos esperados: programación en algún lenguaje (Python, JavaScript o similar), Git y línea de comandos, nociones de redes y Linux. Criptografía y estructuras de datos suman, pero no son excluyentes: se ven desde cero en el Curso 1.</p>`;
      ctx.actions(s, [{ l: "📄 Ver requisitos completos", href: "/blockchain-dev/requisitos/" }]);
    },
  },
  destinatarios: {
    text: "Es para quienes quieren **construir, no especular**: devs que dan el salto a Web3, perfiles de finanzas, cloud y DevOps, founders, investigadores y profesionales en reconversión.",
    build(s, ctx) {
      s.innerHTML = `<div class="bcw-kicker">Del sitio · Destinatarios</div><h3>¿A quién va dirigida?</h3>`;
      const grid = h("div", "bcw-facts");
      for (const [t, d] of [
        ["Desarrolladores", "Smart contracts, DApps y arquitecturas L1/L2"],
        ["Finanzas y economía", "DeFi y tokenización desde el código"],
        ["Cloud y DevOps", "Nodos, IaC y CI/CD con blockchain"],
        ["Founders y builders", "Llevar su idea a Web3"],
        ["Investigadores", "Computación, Economía, Derecho y afines"],
        ["Reconversión", "Abogados cripto, contadores, consultores fintech"],
      ])
        grid.append(h("div", "bcw-fact", `<b>${t}</b><span>${d}</span>`));
      s.append(grid);
      s.append(h("p", "bcw-lead", "Si solo querés comprar y vender cripto, esta diplomatura no es la opción adecuada."));
      ctx.actions(s, [{ l: "📄 Ver destinatarios", href: "/blockchain-dev/destinatarios/" }]);
    },
  },
  salida: {
    text: "Argentina es uno de los hubs Web3 más relevantes: hay empresas con base local y mucho trabajo remoto para afuera. Roles típicos: **Smart Contract Developer**, **Blockchain Architect**, **DeFi Analyst**, **Auditor de contratos**.",
    build(s, ctx) {
      s.innerHTML = `<div class="bcw-kicker">Del sitio · Salida laboral</div><h3>Qué podés hacer después</h3>`;
      const grid = h("div", "bcw-facts");
      for (const r of ["Smart Contract / DApp Developer", "Blockchain Architect", "DeFi Analyst", "Cloud DevOps con blockchain", "Smart Contract Auditor", "Founder de proyectos Web3"])
        grid.append(h("div", "bcw-fact", `<b>${r}</b>`));
      s.append(grid);
      ctx.actions(s, [{ l: "📍 Ver roles en el sitio", f: () => ctx.goto("#roles-laborales") }]);
    },
  },
};

// quiet: the agent already wrote its own text, only change the stage.
export async function showSite(ctx, tema, opts = {}) {
  const sc = SCENES[tema];
  if (!sc) return;
  track("tema_sitio", { tema });
  ctx.scene((s) => sc.build(s, ctx, opts));
  if (!opts.quiet) await ctx.bot(sc.text);
}
