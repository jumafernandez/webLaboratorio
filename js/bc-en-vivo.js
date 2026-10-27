/* Pagina "En vivo": lee Base Sepolia directo desde el navegador (ethers v6, sin backend). */
(function () {
  "use strict";
  var RPC = "https://sepolia.base.org";
  var EXPLORER = "https://base-sepolia.blockscout.com";
  var RELAYER = "0x82c2845e8092465C872aF0d723EDA42314993C82";
  var MAX_RANGO = 200;          // limite de eth_getLogs del RPC publico
  var FEED_N = 20;
  var CLAVE = "bcv-feed-v1";
  var C = {
    sello: "0xbCC7a034E414194c5D00018C2be6a1C1e81a33B0",
    insignias: "0x6d6712D67E15D38D30e6380608801d2C6c00B82c",
    fabrica: "0x3210Ce0b89908B396D2115401FD13Bc35C6e58Df",
    usdl: "0x574553D852d75cDB8c4855dD2b5EC8789B74cd2F",
    pasarela: "0x6D8F9aCE1f400f272767F052265BDa97d3359861"
  };
  var CARDS = [
    ["SelloLICDIA", C.sello, "Guarda en la cadena la huella de un mensaje y quién lo selló."],
    ["InsigniasLICDIA", C.insignias, "Acuña las insignias del curso, el NFT, el certificado simbólico y los recibos."],
    ["FabricaTokens", C.fabrica, "Crea un token ERC-20 nuevo cada vez que una persona diseña el suyo."],
    ["USDLDemo", C.usdl, "Moneda de prueba (USDL) que solo se mueve a través de la pasarela."],
    ["PasarelaDemo", C.pasarela, "Cobra pagos simulados en USDL y emite el recibo como insignia."]
  ];
  var TIPOS = ["Insignia curso 1", "Insignia curso 2", "Insignia curso 3", "Insignia curso 4", "NFT bonus", "Hack bonus", "Certificado simbólico", "Recibo de pago"];

  var ABI = [
    "event Sellado(uint256 indexed id, address indexed autor, bytes32 huella, string mensaje)",
    "event Acunada(uint256 indexed tokenId, address indexed a, uint8 tipo, string nombre)",
    "event TokenCreado(address indexed token, address indexed dueno, string nombre, string simbolo, uint256 supply)",
    "event PagoRecibido(uint256 indexed id, address indexed v, string producto, uint256 monto)",
    "function totalSellos() view returns (uint256)",
    "function totalTokens() view returns (uint256)",
    "function totalAcunadas() view returns (uint256)",
    "function totalPagos() view returns (uint256)"
  ];

  var $ = function (id) { return document.getElementById(id); };
  var provider, iface, direcciones = {};
  Object.keys(C).forEach(function (k) { direcciones[C[k].toLowerCase()] = k; });
  var eventos = [];          // {key, bloque, idx, tipo, texto, tx, ts}
  var vistos = {};
  var ultimoBloque = 0, fallosSeguidos = 0, timer = null, cargando = false, primera = true;
  var tsCache = {};

  function corto(a) { return a ? a.slice(0, 6) + "..." + a.slice(-4) : ""; }
  function trunc(s, n) { s = String(s == null ? "" : s); return s.length > n ? s.slice(0, n - 1) + "…" : s; }
  function nf(n) { try { return Number(n).toLocaleString("es-AR"); } catch (e) { return String(n); } }
  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
  function storeGet() { try { return JSON.parse(sessionStorage.getItem(CLAVE) || "null"); } catch (e) { return null; } }
  function storeSet(v) { try { sessionStorage.setItem(CLAVE, JSON.stringify(v)); } catch (e) { /* sin storage */ } }

  function aviso(msg) { var e = $("bcvEstado"); if (!msg) { e.hidden = true; return; } e.textContent = msg; e.hidden = false; }
  function poner(id, valor) {
    var e = $(id); var t = String(valor);
    if (e.textContent !== t) { e.textContent = t; if (!primera) { e.classList.remove("bcv-pulso"); void e.offsetWidth; e.classList.add("bcv-pulso"); } }
  }

  function hace(ts) {
    if (!ts) return "";
    var s = Math.max(0, Math.floor(Date.now() / 1000 - ts));
    if (s < 60) return "hace " + s + " s";
    if (s < 3600) return "hace " + Math.floor(s / 60) + " min";
    if (s < 86400) return "hace " + Math.floor(s / 3600) + " h";
    return "hace " + Math.floor(s / 86400) + " d";
  }

  function descr(parsed) {
    var a = parsed.args;
    switch (parsed.name) {
      case "Sellado": return ["Sello", "#" + a.id + ": «" + trunc(a.mensaje, 90) + "»"];
      case "Acunada": return [Number(a.tipo) === 7 ? "Recibo" : "Insignia", "#" + a.tokenId + " " + (TIPOS[Number(a.tipo)] || "tipo " + a.tipo) + (a.nombre ? " · " + trunc(a.nombre, 24) : "") + " a " + corto(a.a)];
      case "TokenCreado": return ["Token", trunc(a.nombre, 24) + " (" + trunc(a.simbolo, 6) + "), supply " + nf(a.supply) + ", dueño " + corto(a.dueno)];
      case "PagoRecibido": return ["Pago demo", "#" + a.id + ": " + trunc(a.producto, 24) + ", " + nf(a.monto) + " USDL"];
    }
    return null;
  }

  function agregar(log, ts) {
    var key = log.transactionHash + ":" + (log.index != null ? log.index : log.logIndex);
    if (vistos[key]) return false;
    var p;
    try { p = iface.parseLog({ topics: log.topics, data: log.data }); } catch (e) { return false; }
    if (!p) return false;
    var d = descr(p);
    if (!d) return false;
    vistos[key] = 1;
    eventos.push({ key: key, bloque: Number(log.blockNumber), idx: Number(log.index != null ? log.index : log.logIndex), tipo: d[0], texto: d[1], tx: log.transactionHash, ts: ts || 0 });
    return true;
  }

  function ordenar() {
    eventos.sort(function (a, b) { return b.bloque - a.bloque || b.idx - a.idx; });
    eventos = eventos.slice(0, FEED_N);
  }

  function pintarFeed(nuevos) {
    var ol = $("bcvFeed");
    ol.textContent = "";
    eventos.forEach(function (e) {
      var li = el("li", "bcv-ev" + (!primera && nuevos && nuevos[e.key] ? " bcv-nuevo" : ""));
      li.appendChild(el("span", "bcv-tipo", e.tipo));
      li.appendChild(el("span", "bcv-txt", e.texto));
      var m = el("span", "bcv-meta");
      m.appendChild(document.createTextNode((e.ts ? hace(e.ts) + " · " : "")));
      var a = el("a", null, "tx " + corto(e.tx));
      a.href = EXPLORER + "/tx/" + e.tx; a.target = "_blank"; a.rel = "noopener";
      m.appendChild(a);
      li.appendChild(m);
      ol.appendChild(li);
    });
    $("bcvFeedCarga").hidden = true;
    $("bcvFeedVacio").hidden = eventos.length > 0;
  }

  function guardar() {
    storeSet({ ev: eventos, vistos: Object.keys(vistos), ultimo: ultimoBloque });
  }

  // ---- Fuentes de eventos ----
  async function tsBloque(n) {
    if (tsCache[n]) return tsCache[n];
    var b = await provider.getBlock(n);
    tsCache[n] = b ? b.timestamp : 0;
    return tsCache[n];
  }

  var TOPICS0 = null;
  async function logsRpc(desde, hasta) {
    var res = [];
    for (var f = desde; f <= hasta; f += MAX_RANGO) {
      var t = Math.min(f + MAX_RANGO - 1, hasta);
      var ls = await provider.getLogs({ address: [C.sello, C.insignias, C.fabrica, C.pasarela], topics: [TOPICS0], fromBlock: f, toBlock: t });
      res = res.concat(ls);
    }
    return res;
  }

  // Carga inicial: Blockscout (el RPC publico limita getLogs a 200 bloques, ~7 min de historia)
  async function cargaInicialBlockscout() {
    var tareas = [C.sello, C.insignias, C.fabrica, C.pasarela].map(function (addr) {
      return fetch(EXPLORER + "/api/v2/addresses/" + addr + "/logs").then(function (r) {
        if (!r.ok) throw new Error("blockscout " + r.status);
        return r.json();
      });
    });
    var rs = await Promise.all(tareas);
    var n = 0;
    rs.forEach(function (r) {
      (r.items || []).forEach(function (it) {
        var topics = (it.topics || []).filter(function (t) { return t; });
        var ts = it.block_timestamp ? Math.floor(Date.parse(it.block_timestamp) / 1000) : 0;
        if (agregar({ topics: topics, data: it.data, blockNumber: it.block_number, index: it.index, transactionHash: it.transaction_hash }, ts)) n++;
      });
    });
    return n;
  }

  // Alternativa si Blockscout falla: barrido hacia atras por el RPC
  async function cargaInicialRpc(head) {
    var hasta = head, intentos = 0;
    while (eventos.length < FEED_N && intentos < 40) {
      var desde = Math.max(0, hasta - MAX_RANGO + 1);
      var ls = await provider.getLogs({ address: [C.sello, C.insignias, C.fabrica, C.pasarela], topics: [TOPICS0], fromBlock: desde, toBlock: hasta });
      for (var i = 0; i < ls.length; i++) agregar(ls[i], await tsBloque(ls[i].blockNumber));
      hasta = desde - 1; intentos++;
      if (hasta < 0) break;
    }
  }

  async function contadores() {
    var cs = new ethers.Contract(C.sello, ABI, provider), cf = new ethers.Contract(C.fabrica, ABI, provider),
        ci = new ethers.Contract(C.insignias, ABI, provider), cp = new ethers.Contract(C.pasarela, ABI, provider);
    var r = await Promise.all([cs.totalSellos(), cf.totalTokens(), ci.totalAcunadas(), cp.totalPagos()]);
    poner("cSellos", nf(r[0])); poner("cTokens", nf(r[1])); poner("cInsignias", nf(r[2])); poner("cPagos", nf(r[3]));
  }

  async function ciclo() {
    if (cargando) return;
    cargando = true;
    try {
      var head = await provider.getBlockNumber();
      var bal = await provider.getBalance(RELAYER);
      poner("bcvBloque", nf(head));
      poner("bcvSaldo", Number(ethers.formatEther(bal)).toLocaleString("es-AR", { maximumFractionDigits: 4 }) + " ETH");
      await contadores();

      var nuevos = {};
      if (primera) {
        var cache = storeGet();
        if (cache && cache.ev && cache.ev.length) {
          eventos = cache.ev; (cache.vistos || []).forEach(function (k) { vistos[k] = 1; });
          ultimoBloque = cache.ultimo || 0;
          pintarFeed(null);
        }
        if (!ultimoBloque || head - ultimoBloque > 20000) {
          eventos = []; vistos = {};
          try { await cargaInicialBlockscout(); }
          catch (e) { await cargaInicialRpc(head); }
          ordenar();
          // completar lo que Blockscout pudiera no tener todavia
          var d0 = Math.max(0, head - MAX_RANGO + 1);
          var rec = await logsRpc(d0, head);
          for (var i = 0; i < rec.length; i++) agregar(rec[i], await tsBloque(rec[i].blockNumber));
        } else {
          var ls0 = await logsRpc(ultimoBloque + 1, head);
          for (var j = 0; j < ls0.length; j++) agregar(ls0[j], await tsBloque(ls0[j].blockNumber));
        }
      } else if (head > ultimoBloque) {
        var ls = await logsRpc(ultimoBloque + 1, head);
        for (var k = 0; k < ls.length; k++) {
          var ts = await tsBloque(ls[k].blockNumber);
          if (agregar(ls[k], ts)) nuevos[ls[k].transactionHash + ":" + ls[k].index] = 1;
        }
      }
      ultimoBloque = head;
      ordenar();
      pintarFeed(nuevos);
      guardar();
      fallosSeguidos = 0;
      aviso("");
      $("bcvLat").textContent = "Base Sepolia, chainId 84532 · actualizado " + new Date().toLocaleTimeString("es-AR");
    } catch (e) {
      fallosSeguidos++;
      $("bcvFeedCarga").hidden = true;
      if (!eventos.length) $("bcvFeedVacio").hidden = false;
      aviso("No pudimos consultar la red (el nodo público no responde). Reintentamos solos cada pocos segundos. Los datos que ves pueden estar desactualizados.");
      ["bcvBloque", "bcvSaldo", "cSellos", "cTokens", "cInsignias", "cPagos"].forEach(function (id) { if ($(id).textContent === "...") $(id).textContent = "-"; });
    }
    primera = false;
    cargando = false;
  }

  function programar() {
    clearTimeout(timer);
    if (document.hidden) return;
    var espera = Math.min(5000 * Math.pow(2, Math.min(fallosSeguidos, 3)), 40000);
    timer = setTimeout(function () { ciclo().then(programar); }, espera);
  }

  function tarjetas() {
    var cont = $("bcvContratos");
    CARDS.forEach(function (c) {
      var card = el("div", "bcv-card");
      card.appendChild(el("h3", null, c[0]));
      card.appendChild(el("p", null, c[2]));
      card.appendChild(el("code", null, corto(c[1])));
      var a = el("a", null, "Ver en Blockscout");
      a.href = EXPLORER + "/address/" + c[1] + "?tab=contract"; a.target = "_blank"; a.rel = "noopener";
      card.appendChild(a);
      card.appendChild(el("span", "bcv-ok", "Verificado en Sourcify"));
      cont.appendChild(card);
    });
  }

  function iniciar() {
    tarjetas();
    if (typeof ethers === "undefined") {
      aviso("No se pudo cargar la librería ethers desde el CDN. Recargá la página o revisá tu conexión.");
      $("bcvFeedCarga").hidden = true; $("bcvFeedVacio").hidden = false;
      return;
    }
    iface = new ethers.Interface(ABI);
    TOPICS0 = ["Sellado", "Acunada", "TokenCreado", "PagoRecibido"].map(function (n) { return iface.getEvent(n).topicHash; });
    provider = new ethers.JsonRpcProvider(RPC, 84532, { staticNetwork: true, batchMaxCount: 1 });
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) clearTimeout(timer); else ciclo().then(programar);
    });
    setInterval(function () { if (!document.hidden && eventos.length) pintarFeed(null); }, 30000);
    ciclo().then(programar);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar); else iniciar();
})();
