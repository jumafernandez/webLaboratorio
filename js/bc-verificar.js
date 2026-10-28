/* Verificador de insignias y credenciales de la Diplomatura en Blockchain (LICDIA, UNLu).
   Lee la cadena directo desde el navegador con ethers v6 (sin backend). La configuración (red, contratos) está en
   blockchain-dev/verificar/config.json: mientras credenciales.address esté vacío, la página informa que todavía no
   se emitieron credenciales oficiales. Todo lo que viene de la cadena se escribe con textContent. */
(function () {
    'use strict';

    var raiz = document.getElementById('bcv');
    if (!raiz || !window.ethers) {
        if (raiz) mostrarFatal('No pudimos cargar la librería para leer la cadena. Revisá tu conexión y recargá la página.');
        return;
    }
    var E = window.ethers;

    var TIPOS = [
        'Insignia Curso 1 · Fundamentos', 'Insignia Curso 2 · DeFi', 'Insignia Curso 3 · Infraestructura',
        'Insignia Curso 4 · DApps', 'NFT propio del juego', 'Bonus · Hackeá un contrato', 'Certificado simbólico del recorrido',
        'Recibo de pago (demo)'
    ];
    var ALCANCES = ['Diplomatura completa', 'Curso 1 · Fundamentos', 'Curso 2 · DeFi', 'Curso 3 · Infraestructura', 'Curso 4 · DApps'];
    var CERO = '0x0000000000000000000000000000000000000000';
    var MAX_ESCANEO = 1500;

    var ABI_INSIGNIAS = [
        'function balanceOf(address) view returns (uint256)',
        'function ownerOf(uint256) view returns (address)',
        'function tokenURI(uint256) view returns (string)',
        'function tipoDe(uint256) view returns (uint8)',
        'function nombreDe(uint256) view returns (string)',
        'function insigniaDe(address,uint8) view returns (uint256)',
        'function totalAcunadas() view returns (uint256)',
        'event Acunada(uint256 indexed tokenId, address indexed a, uint8 tipo, string nombre)',
        'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)'
    ];
    var ABI_CRED = [
        'function balanceOf(address) view returns (uint256)',
        'function ownerOf(uint256) view returns (address)',
        'function tokenURI(uint256) view returns (string)',
        'function tokenOfOwnerByIndex(address,uint256) view returns (uint256)',
        'function totalEmitidas() view returns (uint256)',
        'function verify(uint256) view returns (bool vigente, address titular, tuple(uint16 cohorte, uint8 alcance, uint64 emitidaEn, bool revocada, bytes32 actoHash, string nombre, string mencion, string motivoRevocacion) datos)',
        'event Emitida(uint256 indexed tokenId, address indexed a, uint16 cohorte, uint8 alcance, bytes32 actoHash, string nombre)',
        'event Revocada(uint256 indexed tokenId, string motivo)',
        'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)'
    ];

    var form = document.getElementById('bcv-form');
    var campo = document.getElementById('bcv-q');
    var boton = document.getElementById('bcv-ir');
    var salida = document.getElementById('bcv-salida');
    var estado = document.getElementById('bcv-estado');
    var avisoCred = document.getElementById('bcv-cred-estado');
    var cfg, provider, insignias, credenciales, secuencia = 0;

    // ------------------------------------------------------------------ utilidades de DOM

    function el(tag, clase, texto) {
        var n = document.createElement(tag);
        if (clase) n.className = clase;
        if (texto != null) n.textContent = texto;
        return n;
    }
    function enlace(href, texto, clase) {
        var a = el('a', clase || 'bcv-enlace', texto);
        a.href = href;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        return a;
    }
    function vaciar(n) { while (n.firstChild) n.removeChild(n.firstChild); }
    function corto(h) { return h && h.length > 20 ? h.slice(0, 10) + '…' + h.slice(-8) : h; }
    function fila(etq, valor, mono) {
        var f = el('div', 'bc-campo bcv-campo');
        f.appendChild(el('span', null, etq));
        var v = typeof valor === 'string' ? el('code', mono === false ? 'bcv-txt' : null, valor) : valor;
        f.appendChild(v);
        return f;
    }
    function mostrarFatal(msg) {
        var p = document.getElementById('bcv-salida') || document.body;
        var d = el('div', 'bcv-aviso bcv-aviso-error', msg);
        d.setAttribute('role', 'alert');
        p.appendChild(d);
    }
    function aviso(clase, titulo, texto, rol) {
        var d = el('div', 'bcv-aviso ' + clase);
        if (rol) d.setAttribute('role', rol);
        d.appendChild(el('strong', null, titulo));
        if (texto) d.appendChild(el('span', null, texto));
        return d;
    }
    function setEstado(t) { estado.textContent = t || ''; }

    // ------------------------------------------------------------------ metadata del token

    function utf8DeBase64(b64) {
        var bin = atob(b64), bytes = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return new TextDecoder('utf-8').decode(bytes);
    }
    function urlSegura(u) {
        if (typeof u !== 'string') return null;
        if (u.indexOf('ipfs://') === 0) return 'https://ipfs.io/ipfs/' + u.slice(7).replace(/^ipfs\//, '');
        if (/^data:image\/(svg\+xml|png|jpeg|gif|webp)[;,]/.test(u) || /^https:\/\//.test(u)) return u;
        return null;
    }
    async function leerMetadata(uri) {
        try {
            var json;
            if (uri.indexOf('data:application/json;base64,') === 0) json = utf8DeBase64(uri.slice(29));
            else if (uri.indexOf('data:application/json,') === 0) json = decodeURIComponent(uri.slice(22));
            else {
                var u = uri.indexOf('ipfs://') === 0 ? 'https://ipfs.io/ipfs/' + uri.slice(7) : uri;
                if (!/^https:\/\//.test(u)) return null;
                var ctl = new AbortController(), t = setTimeout(function () { ctl.abort(); }, 8000);
                var r = await fetch(u, { signal: ctl.signal });
                clearTimeout(t);
                json = await r.text();
            }
            return JSON.parse(json);
        } catch (e) {
            return null;
        }
    }

    // ------------------------------------------------------------------ tarjetas

    function tarjeta(o) {
        // o: {contrato, tokenId, titulo, rotulo, etiquetaEstado, claseEstado, filas[], meta, nota, simbolico}
        var c = el('article', 'bc-bloque minado bcv-card' + (o.claseCard ? ' ' + o.claseCard : ''));
        var cab = el('div', 'bc-bloque-cab');
        cab.appendChild(el('span', null, o.rotulo));
        cab.appendChild(el('span', 'bcv-sello ' + o.claseEstado, o.etiquetaEstado));
        c.appendChild(cab);

        var cuerpo = el('div', 'bcv-card-cuerpo');
        var img = urlSegura(o.meta && o.meta.image);
        var caja = el('div', 'bcv-img');
        if (img) {
            var im = el('img');
            im.src = img;
            im.alt = 'Imagen del token ' + o.tokenId;
            im.loading = 'lazy';
            im.referrerPolicy = 'no-referrer';
            caja.appendChild(im);
        } else {
            caja.appendChild(el('span', null, '#' + o.tokenId));
        }
        cuerpo.appendChild(caja);

        var datos = el('div', 'bcv-datos');
        datos.appendChild(el('h3', 'bc-bloque-titulo', o.titulo));
        o.filas.forEach(function (f) { datos.appendChild(f); });
        var txFila = el('div', 'bc-campo bcv-campo');
        txFila.appendChild(el('span', null, 'tx de emisión'));
        var txVal = o.txConocida ? txLink(o.txConocida) : el('code', null, 'buscando…');
        txFila.appendChild(txVal);
        datos.appendChild(txFila);
        if (o.nota) datos.appendChild(el('p', 'bcv-nota', o.nota));

        var acciones = el('div', 'bcv-acciones');
        acciones.appendChild(enlace(cfg.explorador + '/token/' + o.contrato + '/instances/' + o.tokenId, 'Ver en Blockscout'));
        if (o.meta && o.meta.attributes && o.meta.attributes.length) {
            var det = el('details', 'bcv-attrs');
            det.appendChild(el('summary', null, 'Atributos del token'));
            var ul = el('ul');
            o.meta.attributes.forEach(function (a) {
                if (a && a.trait_type != null) ul.appendChild(el('li', null, String(a.trait_type) + ': ' + String(a.value)));
            });
            det.appendChild(ul);
            acciones.appendChild(det);
        }
        datos.appendChild(acciones);
        cuerpo.appendChild(datos);
        c.appendChild(cuerpo);

        if (!o.txConocida) buscarTxEmision(o.contrato, o.tokenId, txVal);
        return c;
    }

    function txLink(h) { return enlace(cfg.explorador + '/tx/' + h, corto(h), 'bcv-enlace bcv-mono'); }

    async function buscarTxEmision(contrato, id, destino) {
        try {
            var r = await fetch(cfg.explorador + '/api/v2/tokens/' + contrato + '/instances/' + id + '/transfers');
            if (!r.ok) throw new Error('http ' + r.status);
            var j = await r.json();
            var mint = (j.items || []).filter(function (t) { return t.from && t.from.hash === CERO; }).pop();
            if (!mint || !mint.transaction_hash) throw new Error('sin mint');
            destino.replaceWith(txLink(mint.transaction_hash));
        } catch (e) {
            destino.textContent = 'no disponible';
        }
    }

    async function tarjetaInsignia(id, txConocida, duenoConocido) {
        var r = await Promise.all([
            duenoConocido || insignias.ownerOf(id), insignias.tipoDe(id), insignias.tokenURI(id)
        ]);
        var dueno = r[0], tipo = Number(r[1]), meta = await leerMetadata(r[2]);
        var nombre = (tipo === 4 || tipo === 7) ? await insignias.nombreDe(id) : '';
        var filas = [
            fila('titular', corto(dueno)),
            fila('token', '#' + id + ' · tipo ' + tipo),
            fila('transferible', tipo > 6 ? 'sí' : 'no (soulbound)', false)
        ];
        if (nombre && (tipo === 4 || tipo === 7)) filas.splice(1, 0, fila('nombre', nombre, false));
        var simb = tipo <= 6;
        return tarjeta({
            contrato: cfg.insignias.address, tokenId: id, meta: meta,
            titulo: (meta && meta.name) || TIPOS[tipo] || ('Token #' + id),
            rotulo: 'insignia del juego',
            etiquetaEstado: tipo === 7 ? 'recibo demo' : 'simbólico',
            claseEstado: 'bcv-sello-simb', filas: filas, txConocida: txConocida,
            nota: simb ? 'Pieza del juego de la página. No es un título ni una credencial oficial.' : 'Recibo de la pasarela de pagos de demostración, sin valor real.'
        });
    }

    async function tarjetaCredencial(id, txConocida) {
        var v = await credenciales.verify(id);
        var d = v[2], vigente = v[0];
        var meta = await leerMetadata(await credenciales.tokenURI(id));
        var filas = [
            fila('titular', corto(v[1])),
            fila('nombre', d.nombre, false),
            fila('alcance', ALCANCES[Number(d.alcance)] || ('alcance ' + d.alcance), false),
            fila('cohorte', String(d.cohorte), false),
            fila('emitida', new Date(Number(d.emitidaEn) * 1000).toLocaleDateString('es-AR'), false)
        ];
        if (d.mencion) filas.push(fila('mención', d.mencion, false));
        filas.push(fila('hash del acto', corto(d.actoHash)));
        if (!vigente) filas.push(fila('motivo', d.motivoRevocacion, false));
        return tarjeta({
            contrato: cfg.credenciales.address, tokenId: id, meta: meta,
            titulo: 'Credencial #' + id + ' · ' + (ALCANCES[Number(d.alcance)] || ''),
            rotulo: 'credencial oficial',
            etiquetaEstado: vigente ? 'vigente' : 'revocada', claseEstado: vigente ? 'bcv-sello-ok' : 'bcv-sello-rev',
            claseCard: vigente ? '' : 'bcv-card-rev', filas: filas, txConocida: txConocida,
            nota: 'El documento oficial es el acto de la UNLu. Para comprobarlo, calculá el SHA-256 del PDF (sha256sum archivo.pdf) y comparalo con el hash del acto.'
        });
    }

    // ------------------------------------------------------------------ búsquedas

    // Un token inexistente o quemado revierte (CALL_EXCEPTION): es un dato. Cualquier otro error (red, límite del RPC) se propaga y reintenta.
    function sinToken(e) {
        // Con datos de revert es un token inexistente; sin datos (p. ej. límite del RPC disfrazado) no se puede asumir nada
        if (e && e.code === 'CALL_EXCEPTION' && e.data && e.data !== '0x') return null;
        throw e;
    }

    function porLotes(ids, fn, tam) {
        var res = [], i = 0;
        return (async function () {
            while (i < ids.length) {
                var lote = ids.slice(i, i + tam);
                i += tam;
                res = res.concat(await Promise.all(lote.map(fn)));
            }
            return res;
        })();
    }

    async function idsInsignias(a) {
        var bal = Number(await insignias.balanceOf(a));
        if (!bal) return [];
        var porTipo = await Promise.all([0, 1, 2, 3, 4, 5, 6].map(function (t) { return insignias.insigniaDe(a, t); }));
        var ids = porTipo.map(Number).filter(Boolean);
        if (bal > ids.length) { // recibos (transferibles): sin logs de rango amplio en el RPC público, se recorre el contrato
            var total = Number(await insignias.totalAcunadas());
            var rango = [];
            for (var i = 1; i <= Math.min(total, MAX_ESCANEO); i++) if (ids.indexOf(i) < 0) rango.push(i);
            var duenos = await porLotes(rango, function (i) { return insignias.ownerOf(i).catch(sinToken); }, 20);
            rango.forEach(function (i, k) { if (duenos[k] && duenos[k].toLowerCase() === a.toLowerCase()) ids.push(i); });
        }
        return ids.sort(function (x, y) { return x - y; });
    }

    async function idsCredenciales(a) {
        if (!credenciales) return [];
        var bal = Number(await credenciales.balanceOf(a));
        var idx = [];
        for (var i = 0; i < bal; i++) idx.push(i);
        return (await porLotes(idx, function (i) { return credenciales.tokenOfOwnerByIndex(a, i); }, 20)).map(Number);
    }

    async function buscarDireccion(a) {
        var r = await Promise.all([idsInsignias(a), idsCredenciales(a)]);
        var cont = document.createDocumentFragment();
        cont.appendChild(resumen('Dirección', a, r[1].length, r[0].length));
        var gcred = el('div', 'bcv-grupo');
        gcred.appendChild(el('h3', 'bcv-grupo-t', 'Credenciales oficiales'));
        if (!credenciales) gcred.appendChild(aviso('bcv-aviso-info', 'Todavía no se emitieron credenciales: la primera cohorte egresa en 2027.', ''));
        else if (!r[1].length) gcred.appendChild(aviso('bcv-aviso-info', 'Esta dirección no tiene credenciales oficiales.', ''));
        else (await Promise.all(r[1].map(function (i) { return tarjetaCredencial(i); }))).forEach(function (c) { gcred.appendChild(c); });
        cont.appendChild(gcred);

        var gjuego = el('div', 'bcv-grupo');
        gjuego.appendChild(el('h3', 'bcv-grupo-t', 'Insignias y certificado del juego (simbólicos)'));
        if (!r[0].length) gjuego.appendChild(aviso('bcv-aviso-info', 'Esta dirección no tiene insignias del juego.', 'Se obtienen jugando en la página de la diplomatura.'));
        else {
            var lista = el('div', 'bcv-lista');
            (await Promise.all(r[0].map(function (i) { return tarjetaInsignia(i, null, a); }))).forEach(function (c) { lista.appendChild(c); });
            gjuego.appendChild(lista);
        }
        cont.appendChild(gjuego);
        return cont;
    }

    function resumen(tipo, valor, nCred, nJuego) {
        var d = el('div', 'bcv-resumen');
        d.appendChild(el('span', 'bcv-resumen-t', tipo));
        d.appendChild(el('code', 'bcv-mono', valor));
        d.appendChild(el('span', 'bcv-resumen-c', nCred + ' credencial(es) oficial(es) · ' + nJuego + ' pieza(s) del juego'));
        return d;
    }

    async function buscarToken(id) {
        var cont = document.createDocumentFragment(), hallo = false;
        var jobs = [];
        jobs.push(insignias.ownerOf(id).then(function () { return tarjetaInsignia(id); }, sinToken));
        if (credenciales) jobs.push(credenciales.ownerOf(id).then(function () { return tarjetaCredencial(id); }, sinToken));
        var cards = await Promise.all(jobs);
        var orden = credenciales ? [cards[1], cards[0]] : [cards[0]];
        orden.forEach(function (c) { if (c) { hallo = true; cont.appendChild(c); } });
        if (!hallo) {
            return aviso('bcv-aviso-info', 'No existe el token #' + id + '.',
                'Ni en el contrato de insignias' + (credenciales ? ' ni en el de credenciales' : '') + ', o fue quemado por su dueño.', 'status');
        }
        var g = el('div', 'bcv-lista');
        g.appendChild(cont);
        return g;
    }

    async function buscarTx(h) {
        var rec = await provider.getTransactionReceipt(h);
        if (!rec) {
            return aviso('bcv-aviso-info', 'No encontramos esa transacción en ' + cfg.red + '.',
                'Puede ser de otra red o no haberse confirmado todavía.', 'status');
        }
        var cont = document.createDocumentFragment();
        var cabecera = el('div', 'bcv-resumen');
        cabecera.appendChild(el('span', 'bcv-resumen-t', 'Transacción'));
        cabecera.appendChild(enlace(cfg.explorador + '/tx/' + h, corto(h), 'bcv-enlace bcv-mono'));
        cabecera.appendChild(el('span', 'bcv-resumen-c', rec.status === 1 ? 'confirmada · bloque ' + rec.blockNumber : 'revertida (sin efecto) · bloque ' + rec.blockNumber));
        cont.appendChild(cabecera);

        var piezas = [];
        rec.logs.forEach(function (lg) {
            var addr = lg.address.toLowerCase();
            [[insignias, cfg.insignias.address, 'i'], [credenciales, cfg.credenciales.address, 'c']].forEach(function (par) {
                if (!par[0] || !par[1] || addr !== par[1].toLowerCase()) return;
                var ev;
                try { ev = par[0].interface.parseLog({ topics: lg.topics, data: lg.data }); } catch (e) { return; }
                if (ev && ev.name === 'Transfer' && ev.args.from === CERO) piezas.push({ k: par[2], id: Number(ev.args.tokenId) });
            });
        });
        if (!piezas.length) {
            cont.appendChild(aviso('bcv-aviso-info', 'Esta transacción no emitió insignias ni credenciales de la diplomatura.',
                'Solo se muestran las emisiones de los contratos configurados.', 'status'));
            return cont;
        }
        var lista = el('div', 'bcv-lista');
        for (var k = 0; k < piezas.length; k++) {
            lista.appendChild(piezas[k].k === 'i' ? await tarjetaInsignia(piezas[k].id, h) : await tarjetaCredencial(piezas[k].id, h));
        }
        cont.appendChild(lista);
        return cont;
    }

    // ------------------------------------------------------------------ entrada

    function interpretar(texto) {
        var t = texto.trim();
        if (!t) return { error: 'Pegá una dirección, un número de token o el hash de una transacción.' };
        var m = t.match(/0x[0-9a-fA-F]{64}(?![0-9a-fA-F])/);
        if (m) return { tipo: 'tx', valor: m[0].toLowerCase() };
        m = t.match(/0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/);
        if (m) {
            try { return { tipo: 'direccion', valor: E.getAddress(m[0]) }; }
            catch (e) { return { error: 'La dirección no es válida: revisá que esté completa y que las mayúsculas sean las originales.' }; }
        }
        if (/^#?\d{1,9}$/.test(t)) {
            var n = parseInt(t.replace('#', ''), 10);
            if (n >= 1) return { tipo: 'token', valor: n };
        }
        return { error: 'No reconocemos ese dato. Una dirección tiene 0x y 40 caracteres; un hash de transacción, 0x y 64; un token es un número desde 1.' };
    }

    async function buscar(texto, actualizarUrl) {
        var yo = ++secuencia;
        var q = interpretar(texto);
        vaciar(salida);
        if (q.error) {
            salida.appendChild(aviso('bcv-aviso-error', q.error, '', 'alert'));
            setEstado('');
            return;
        }
        if (actualizarUrl) {
            try { history.replaceState(null, '', '?q=' + encodeURIComponent(texto.trim())); } catch (e) { /* sin historial */ }
        }
        boton.disabled = true;
        var cargando = el('div', 'bcv-cargando');
        cargando.appendChild(el('span', 'bcv-giro'));
        cargando.appendChild(el('span', null, 'Leyendo la cadena…'));
        salida.appendChild(cargando);
        setEstado('Leyendo la cadena…');
        try {
            var r, intento = 0;
            for (;;) { // el RPC público limita pedidos: hasta 3 intentos con espera creciente
                try {
                    r = q.tipo === 'direccion' ? await buscarDireccion(q.valor)
                        : q.tipo === 'token' ? await buscarToken(q.valor) : await buscarTx(q.valor);
                    break;
                } catch (e) {
                    if (++intento >= 3 || yo !== secuencia) throw e;
                    await new Promise(function (ok) { setTimeout(ok, 1200 * intento); });
                }
            }
            if (yo !== secuencia) return;
            vaciar(salida);
            salida.appendChild(r);
            setEstado('Listo.');
        } catch (e) {
            if (yo !== secuencia) return;
            vaciar(salida);
            var err = aviso('bcv-aviso-error', 'No pudimos leer la cadena.',
                'El nodo público de ' + cfg.red + ' no respondió o limitó el pedido. Esperá unos segundos y probá de nuevo.', 'alert');
            var re = el('button', 'bcv-reintentar', 'Reintentar');
            re.type = 'button';
            re.addEventListener('click', function () { buscar(texto, false); });
            err.appendChild(re);
            salida.appendChild(err);
            setEstado('');
            if (window.console) console.error(e);
        } finally {
            if (yo === secuencia) boton.disabled = false;
        }
    }

    // ------------------------------------------------------------------ inicio

    function pintarContratos() {
        var lista = document.getElementById('bcv-contratos');
        if (!lista) return;
        vaciar(lista);
        function item(nombre, dir, nota) {
            var li = el('li');
            li.appendChild(el('strong', null, nombre));
            if (dir) {
                li.appendChild(enlace(cfg.explorador + '/address/' + dir, dir, 'bcv-enlace bcv-mono bcv-dir'));
            } else {
                li.appendChild(el('span', 'bcv-pendiente', nota));
            }
            lista.appendChild(li);
        }
        item('InsigniasLICDIA (juego, simbólico)', cfg.insignias.address, '');
        item('CredencialLICDIA (oficial)', cfg.credenciales.address, 'sin desplegar: se publica cuando se emita la primera credencial');
    }

    // Totales desde el lanzamiento: bloques, insignias y recorridos los cuenta el backend del juego (/api/estado);
    // los NFTs en la cadena salen del contrato. Si alguna fuente no responde, se muestra lo que haya.
    async function pintarCifras() {
        var caja = document.getElementById('bcv-cifras');
        if (!caja) return;
        var res = await Promise.allSettled([
            fetch('/blockchain-dev/api/estado', { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : {}; }),
            insignias.totalAcunadas()
        ]);
        var d = res[0].status === 'fulfilled' ? res[0].value : {};
        var nft = res[1].status === 'fulfilled' ? Number(res[1].value) : 0;
        var partes = [
            [d.bloques_total, 'bloques minados'],
            [d.insignias_total, 'insignias ganadas'],
            [d.certificados_total, 'recorridos completos'],
            [nft, 'NFTs del juego en ' + cfg.red]
        ].filter(function (p) { return p[0] > 0; });
        if (!partes.length) return;
        vaciar(caja);
        caja.appendChild(el('span', 'bcv-cifras-t', 'Desde el lanzamiento'));
        partes.forEach(function (p) {
            var c = el('span', 'bcv-cifra');
            c.appendChild(el('strong', null, Number(p[0]).toLocaleString('es-AR')));
            c.appendChild(document.createTextNode(' ' + p[1]));
            caja.appendChild(c);
        });
        caja.hidden = false;
    }

    async function iniciar() {
        try {
            var r = await fetch(raiz.getAttribute('data-config') || 'config.json', { cache: 'no-cache' });
            cfg = await r.json();
        } catch (e) {
            mostrarFatal('No pudimos leer la configuración del verificador.');
            return;
        }
        // El RPC público corta a 25 pedidos por segundo y lo informa como un error dentro de la respuesta:
        // se reintenta el lote completo (son solo lecturas) con espera creciente.
        var Limitado = (function (Base) {
            function L() { return Reflect.construct(Base, arguments, L); }
            L.prototype = Object.create(Base.prototype);
            L.prototype.constructor = L;
            Object.setPrototypeOf(L, Base);
            L.prototype._send = async function (payload) {
                for (var i = 0; ; i++) {
                    var r = await Base.prototype._send.call(this, payload);
                    var corte = r.some(function (x) { return x.error && (x.error.code === -32007 || /limit|too many/i.test(x.error.message || '')); });
                    if (!corte || i >= 6) return r;
                    await new Promise(function (ok) { setTimeout(ok, 400 * (i + 1)); });
                }
            };
            return L;
        })(E.JsonRpcProvider);
        provider = new Limitado(cfg.rpc, cfg.chainId, { staticNetwork: true });
        insignias = new E.Contract(cfg.insignias.address, ABI_INSIGNIAS, provider);
        credenciales = cfg.credenciales.address ? new E.Contract(cfg.credenciales.address, ABI_CRED, provider) : null;
        pintarContratos();
        pintarCifras().catch(function () { /* las cifras son un extra */ });
        var red = document.getElementById('bcv-red');
        if (red) red.textContent = cfg.red;
        if (avisoCred) {
            avisoCred.textContent = credenciales
                ? 'Contrato de credenciales oficiales: ' + cfg.credenciales.address
                : 'Todavía no se emitieron credenciales: la primera cohorte egresa en 2027.';
        }
        form.addEventListener('submit', function (ev) { ev.preventDefault(); buscar(campo.value, true); });
        var ej = document.getElementById('bcv-ejemplo');
        if (ej && cfg.ejemplo && cfg.ejemplo.tokenId) {
            ej.textContent = 'token #' + cfg.ejemplo.tokenId;
            ej.addEventListener('click', function () { campo.value = String(cfg.ejemplo.tokenId); buscar(campo.value, true); });
        }
        var q = new URLSearchParams(location.search).get('q');
        if (q) { campo.value = q; buscar(q, false); }
    }
    iniciar();
})();
