// The visitor's profile, picked with one click on the hero: it orders the levels (where to start), gives every
// level an example from that line of work, reaches the agent in the game state, and preselects the waitlist form.
// Kept in localStorage so a second visit starts from the same place.

const KEY = "bcw-perfil";

// espera = the matching <option> of blockchain-dev/espera-2027/ ("" leaves the select alone).
// ejemplos = text of the "💡 Para tu caso" callout per level; the agent's own example wins when it sends one.
export const PERFILES = {
  dev: {
    l: "🧑‍💻 Desarrollo / IT",
    espera: "Desarrollador / Ingeniero IT",
    primero: "c4",
    intro: "Arrancá por el **Nivel 4**: es la pasarela de pagos del Curso 4, la DApp que vas a programar de punta a punta.",
    ejemplos: {
      c1: "Un hash es como el id de un commit: cambiás una línea y cambia todo. En el Curso 1 esto lo programás en Solidity.",
      c2: "Un token ERC-20 es un contrato con balances y transfer: unas pocas decenas de líneas que en el Curso 2 escribís vos.",
      c3: "Es el problema de cualquier clúster: réplicas, quórum y qué pasa cuando se cae un nodo.",
      c4: "Es la integración de pagos de tu app, pero con approve y transferFrom en lugar de la API de un procesador de pagos.",
    },
  },
  legal: {
    l: "⚖️ Derecho o contabilidad",
    espera: "Abogado / Contador / Administrador",
    primero: "c1",
    intro: "Arrancá por el **Nivel 1**: es el que más se parece a tu trabajo, porque sella un documento y prueba que nadie lo tocó.",
    ejemplos: {
      c1: "Lo mismo sirve para sellar un contrato o una factura y probar después que nadie la modificó.",
      c2: "Un token puede representar una participación o un activo: tokenizar trae preguntas legales y contables muy concretas.",
      c3: "Ninguna empresa sola controla la red: por eso un registro así no depende de un tercero de confianza.",
      c4: "Cada pago deja un recibo con fecha y monto que cualquiera puede auditar.",
    },
  },
  finanzas: {
    l: "📈 Finanzas o economía",
    espera: "Finanzas / Economía",
    primero: "c2",
    intro: "Arrancá por el **Nivel 2**: creás una moneda, abrís un mercado y ves cómo se mueve el precio.",
    ejemplos: {
      c1: "Es un libro mayor que nadie puede reescribir: cada asiento queda encadenado al anterior.",
      c2: "El pool fija el precio con x · y = k: vas a ver liquidez y slippage como en un mercado real.",
      c3: "La capa 2 baja el costo de cada operación, como compensar 100 pagos en uno solo.",
      c4: "Una stablecoin, un approve y un pago: así cobra un comercio que acepta cripto.",
    },
  },
  otro: {
    l: "🎓 Estudio u otra cosa",
    espera: "",
    primero: "c1",
    intro: "Arrancá por el **Nivel 1**: no hace falta saber nada, en un par de minutos minás tu primer bloque.",
    ejemplos: {},
  },
};

let actual = null;
try {
  const v = localStorage.getItem(KEY);
  if (PERFILES[v]) actual = v;
} catch {
  /* no storage: no profile until the visitor picks one */
}

export const perfil = () => actual;

export function elegirPerfil(id) {
  if (!PERFILES[id]) return;
  actual = id;
  try {
    localStorage.setItem(KEY, id);
  } catch {
    /* idem */
  }
}

export const ejemploPerfil = (nivel) => (actual ? PERFILES[actual].ejemplos[nivel] || null : null);
