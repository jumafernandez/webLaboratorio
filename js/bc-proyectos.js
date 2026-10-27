/* Galería de proyectos de estudiantes. Lee blockchain-dev/proyectos/proyectos.json y arma las tarjetas.
   Todo texto de los datos entra con textContent; los enlaces se aceptan solo si son https:// (o una dirección 0x válida). */
(function () {
    "use strict";
    var ETHERS = "https://cdnjs.cloudflare.com/ajax/libs/ethers/6.13.4/ethers.umd.min.js";
    var CURSOS = { "curso-1": "Curso 1", "curso-2": "Curso 2", "curso-3": "Curso 3", "curso-4": "Curso 4" };
    var $ = function (id) { return document.getElementById(id); };
    var red = { chainId: 84532, name: "Base Sepolia", explorer: "https://base-sepolia.blockscout.com", rpc: "https://sepolia.base.org" };
    var proyectos = [];
    var ethersP = null;
    var provider = null;

    function el(tag, cls, txt) {
        var e = document.createElement(tag);
        if (cls) e.className = cls;
        if (txt != null) e.textContent = txt;
        return e;
    }
    function esHttps(u) { return typeof u === "string" && /^https:\/\/[^\s]+$/i.test(u); }
    function esDir(a) { return typeof a === "string" && /^0x[0-9a-fA-F]{40}$/.test(a); }
    function str(v) { return typeof v === "string" ? v : ""; }

    function autores(p) {
        var lista = Array.isArray(p.students) ? p.students : [];
        var nombres = lista.map(function (s) {
            if (!s || typeof s !== "object") return "";
            if (s.consent === true && str(s.name)) return s.name;   // el nombre real solo con consentimiento
            return str(s.pseudonym);
        }).filter(Boolean);
        return nombres.length ? nombres.join(", ") : "Equipo anónimo";
    }

    function cargarEthers() {
        if (ethersP) return ethersP;
        ethersP = new Promise(function (ok, no) {
            if (window.ethers) return ok(window.ethers);
            var s = document.createElement("script");
            s.src = ETHERS;
            s.crossOrigin = "anonymous";
            s.onload = function () { window.ethers ? ok(window.ethers) : no(new Error("ethers")); };
            s.onerror = function () { no(new Error("ethers")); };
            document.head.appendChild(s);
        });
        return ethersP;
    }
    function verificar(dir, badge) {
        badge.className = "bcp-ins";
        badge.textContent = "verificando…";
        cargarEthers().then(function (E) {
            provider = provider || new E.JsonRpcProvider(red.rpc, red.chainId, { staticNetwork: true });
            return provider.getCode(dir);
        }).then(function (code) {
            var hay = typeof code === "string" && code !== "0x";
            badge.className = "bcp-ins " + (hay ? "ok" : "warn");
            badge.textContent = hay ? "tiene código on-chain" : "sin código en esa dirección";
        }).catch(function () {
            badge.className = "bcp-ins warn";
            badge.textContent = "no se pudo consultar";
        });
    }

    function contrato(c, vivo) {
        if (!c || !esDir(c.address)) return null;
        var li = el("li", "bcp-contrato");
        li.appendChild(el("span", "bcp-contrato-nombre", str(c.name) || "Contrato"));
        li.appendChild(el("code", null, c.address));
        var meta = el("div", "bcp-contrato-meta");
        if (c.chainId === red.chainId) {
            var a = el("a", null, "Ver en Blockscout");
            a.href = red.explorer + "/address/" + c.address;
            a.target = "_blank";
            a.rel = "noopener";
            meta.appendChild(a);
        } else {
            meta.appendChild(el("span", "bcp-ins warn", "red " + String(c.chainId)));
        }
        meta.appendChild(el("span", "bcp-ins" + (c.verified === true ? " ok" : ""), c.verified === true ? "verificado" : "sin verificar"));
        if (vivo && c.chainId === red.chainId) {
            var b = el("span", "bcp-ins");
            meta.appendChild(b);
            verificar(c.address, b);
        }
        li.appendChild(meta);
        return li;
    }

    function tarjeta(p, vivo) {
        var card = el("article", "bcp-card");
        var cab = el("div", "bcp-card-cab");
        cab.appendChild(el("span", null, CURSOS[p.course] || str(p.course)));
        if (str(p.cohort)) cab.appendChild(el("span", null, "cohorte " + p.cohort));
        card.appendChild(cab);
        card.appendChild(el("h2", null, str(p.title) || "Sin título"));
        card.appendChild(el("p", "bcp-autores", autores(p)));
        card.appendChild(el("p", null, str(p.description)));
        if (Array.isArray(p.tags) && p.tags.length) {
            var ul = el("ul", "bcp-tags");
            p.tags.forEach(function (t) { if (str(t)) ul.appendChild(el("li", null, t)); });
            card.appendChild(ul);
        }
        var cs = (Array.isArray(p.contracts) ? p.contracts : []).map(function (c) { return contrato(c, vivo); }).filter(Boolean);
        if (cs.length) {
            var lc = el("ul", "bcp-contratos");
            cs.forEach(function (li) { lc.appendChild(li); });
            card.appendChild(lc);
        }
        var en = el("div", "bcp-enlaces");
        [["repo", "Repositorio"], ["demo", "Demo"]].forEach(function (k) {
            if (esHttps(p[k[0]])) {
                var a = el("a", null, k[1]);
                a.href = p[k[0]];
                a.target = "_blank";
                a.rel = "noopener noreferrer";
                en.appendChild(a);
            }
        });
        if (en.childNodes.length) card.appendChild(en);
        return card;
    }

    function llenar(sel, valores, etiqueta) {
        valores.forEach(function (v) {
            var o = el("option", null, etiqueta ? etiqueta(v) : v);
            o.value = v;
            sel.appendChild(o);
        });
    }

    function pintar() {
        var curso = $("bcpCurso").value, tag = $("bcpTag").value, vivo = $("bcpVivo").checked;
        var lista = proyectos.filter(function (p) {
            return (!curso || p.course === curso) && (!tag || (Array.isArray(p.tags) && p.tags.indexOf(tag) >= 0));
        });
        var g = $("bcpGrilla");
        g.textContent = "";
        lista.forEach(function (p) { g.appendChild(tarjeta(p, vivo)); });
        $("bcpEstado").textContent = lista.length + " de " + proyectos.length + " proyectos";
    }

    function iniciar() {
        fetch("proyectos.json", { cache: "no-cache" }).then(function (r) {
            if (!r.ok) throw new Error("http " + r.status);
            return r.json();
        }).then(function (d) {
            if (d && d.network && d.network.chainId === 84532) {
                if (esHttps(d.network.explorer)) red.explorer = d.network.explorer.replace(/\/+$/, "");
                if (esHttps(d.network.rpc)) red.rpc = d.network.rpc;
            }
            proyectos = d && Array.isArray(d.projects) ? d.projects.filter(function (p) { return p && typeof p === "object"; }) : [];
            if (!proyectos.length) {
                $("bcpEstado").hidden = true;
                $("bcpVacio").hidden = false;
                return;
            }
            var cursos = [], tags = [];
            proyectos.forEach(function (p) {
                if (str(p.course) && cursos.indexOf(p.course) < 0) cursos.push(p.course);
                (Array.isArray(p.tags) ? p.tags : []).forEach(function (t) { if (str(t) && tags.indexOf(t) < 0) tags.push(t); });
            });
            llenar($("bcpCurso"), cursos.sort(), function (c) { return CURSOS[c] || c; });
            llenar($("bcpTag"), tags.sort());
            $("bcpBarra").hidden = false;
            ["bcpCurso", "bcpTag", "bcpVivo"].forEach(function (id) { $(id).addEventListener("change", pintar); });
            pintar();
        }).catch(function () {
            $("bcpEstado").textContent = "No pudimos cargar la lista de proyectos. Probá de nuevo en un rato.";
        });
    }
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar); else iniciar();
})();
