/* Diplomatura en Blockchain: encabezado con la diplomatura como cadena de bloques.
   Cada curso es un bloque. Su contenido es el texto completo del módulo, tomado del plan de estudios de esta misma
   página; el bloque guarda el hash SHA-256 de ese contenido y el hash del bloque anterior, y se mina en vivo en el
   navegador: prueba de trabajo real hasta encontrar un nonce con el que el hash del encabezado empiece con DIFICULTAD.
   El fondo muestra hashes SHA-256 reales de las secciones de esta página; los bloques minados se suman.
   Se mina en tramos de pocos milisegundos por cuadro para no trabar la página.
   En las subpáginas no hay cadena: quedan el fondo de hashes y los rótulos encadenados de las secciones. */
(function () {
    'use strict';
    var header = document.querySelector('header.fondoBlockchain');
    if (!header) return;
    var lienzoCadena = header.querySelector('.bc-cadena');
    var DIFICULTAD = '0000';
    var reducir = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var enc = new TextEncoder();

    // ---------- SHA-256 (FIPS 180-4) ----------
    var K = new Uint32Array([
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
        0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
        0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
        0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
        0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
        0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);
    var W = new Uint32Array(64);
    function hex8(x) { return (x >>> 0).toString(16).padStart(8, '0'); }
    function sha256(m) {
        var l = m.length, nb = ((l + 9 + 63) >> 6) << 6, buf = new Uint8Array(nb), bits = l * 8;
        buf.set(m);
        buf[l] = 0x80;
        buf[nb - 8] = Math.floor(bits / 0x100000000) >>> 24;
        buf[nb - 7] = (Math.floor(bits / 0x100000000) >>> 16) & 255;
        buf[nb - 6] = (Math.floor(bits / 0x100000000) >>> 8) & 255;
        buf[nb - 5] = Math.floor(bits / 0x100000000) & 255;
        buf[nb - 4] = bits >>> 24; buf[nb - 3] = (bits >>> 16) & 255; buf[nb - 2] = (bits >>> 8) & 255; buf[nb - 1] = bits & 255;
        var h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a,
            h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
        for (var o = 0; o < nb; o += 64) {
            var i;
            for (i = 0; i < 16; i++) W[i] = (buf[o + 4 * i] << 24) | (buf[o + 4 * i + 1] << 16) | (buf[o + 4 * i + 2] << 8) | buf[o + 4 * i + 3];
            for (i = 16; i < 64; i++) {
                var x = W[i - 15], y = W[i - 2];
                var s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
                var s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
                W[i] = (W[i - 16] + s0 + W[i - 7] + s1) | 0;
            }
            var a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
            for (i = 0; i < 64; i++) {
                var S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
                var t1 = (h + S1 + ((e & f) ^ (~e & g)) + K[i] + W[i]) | 0;
                var S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
                var t2 = (S0 + ((a & b) ^ (a & c) ^ (b & c))) | 0;
                h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
            }
            h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0;
            h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0;
        }
        return hex8(h0) + hex8(h1) + hex8(h2) + hex8(h3) + hex8(h4) + hex8(h5) + hex8(h6) + hex8(h7);
    }
    function sha256Texto(s) { return sha256(enc.encode(s)); }
    function corto(h) { return h.slice(0, 10) + '…' + h.slice(-4); }

    // ---------- Los bloques: los cursos del plan de estudios de esta página ----------
    var CORTOS = ['Fundamentos de Blockchain y DApps', 'Finanzas descentralizadas', 'Infraestructura y arquitectura', 'Desarrollo de DApps'];
    var bloques = [];
    ['One', 'Two', 'Three', 'Four'].forEach(function (n, k) {
        var cuerpo = document.getElementById('panelsStayOpen-collapse' + n);
        var boton = document.querySelector('[data-bs-target="#panelsStayOpen-collapse' + n + '"]');
        if (!cuerpo || !boton) return;
        // en la portada el botón trae además fechas y docentes: el título es solo .bc-plan-titulo
        var titulo = (boton.querySelector('.bc-plan-titulo') || boton).textContent.replace(/\s+/g, ' ').trim().replace(/^\d+\s*/, '');
        var texto = (cuerpo.querySelector('.bc-plan-cuerpo, .accordion-body') || cuerpo).textContent.replace(/\s+/g, ' ').trim();
        bloques.push({ n: k + 1, ancla: cuerpo.id, titulo: titulo, corto: CORTOS[k] || titulo, texto: texto,
                       datos: sha256Texto('Curso ' + (k + 1) + ' — ' + titulo + '\n' + texto) });
    });

    // ---------- La cadena sigue hacia abajo ----------
    // Cada sección con título lleva un rótulo con el SHA-256 de su contenido encadenado con el de la anterior; en la
    // portada la numeración sigue la de los cursos del encabezado (la primera sección es el bloque 05).
    (function eslabones() {
        var previo = '0'.repeat(64), n = lienzoCadena ? bloques.length : 0;
        Array.prototype.forEach.call(document.querySelectorAll('body > section, body > article, body > div.container'), function (sec) {
            var h2 = sec.querySelector('h2.section-heading, h2.card-t, .section-title-line h2');
            if (!h2) return;
            var h = sha256Texto(previo + sec.textContent.replace(/\s+/g, ' ').trim());
            previo = h;
            n++;
            var p = document.createElement('p');
            p.className = 'bc-eslabon';
            p.title = 'SHA-256 del contenido de esta sección, encadenado con el de la sección anterior';
            p.innerHTML = 'bloque ' + String(n).padStart(2, '0') + ' <b>·</b> 0x' + h.slice(0, 6) + '…' + h.slice(-4);
            // en las subpáginas el título va en una línea con raya (.section-title-line): el rótulo va arriba, alineado a la izquierda
            var ancla = h2.parentNode.classList.contains('section-title-line') ? h2.parentNode : h2;
            if (ancla !== h2) p.classList.add('bc-eslabon-izq');
            ancla.parentNode.insertBefore(p, ancla);
        });
    })();
    // En el plan de estudios de la portada cada curso es el mismo bloque del encabezado: la minería de abajo llena
    // anterior, nonce y hash, y los enlaces entre bloques muestran el hash que guarda el bloque siguiente
    var enPlan = bloques.map(function (b) { return lienzoCadena && document.querySelector('.bc-plan-bloque[data-bloque="' + b.n + '"]'); });
    function plan(k, campos, estado) {
        var el = enPlan[k];
        if (!el) return;
        Object.keys(campos).forEach(function (c) {
            var x = el.querySelector('[data-bc="' + c + '"]');
            if (x) x.innerHTML = campos[c];
        });
        if (estado) {
            el.classList.remove('minando', 'minado', 'verificado');
            void el.offsetWidth;   // reinicia el destello al volver a verificar
            el.classList.add.apply(el.classList, estado[0].split(' '));
            el.querySelector('[data-bc="estado"]').textContent = estado[1];
        }
    }
    function planEnlace(n, h) {
        var e = document.querySelector('.bc-plan-enlace[data-desde="' + n + '"]');
        if (!e) return;
        e.querySelector('code').textContent = corto(h);
        e.classList.add('minado');
    }
    bloques.forEach(function (b, k) { plan(k, { datos: corto(b.datos) }); });

    var capa = header.querySelector('.bc-fondo');
    if (!capa) {
        capa = document.createElement('div');
        capa.className = 'bc-fondo';
        capa.setAttribute('aria-hidden', 'true');
        header.insertBefore(capa, header.firstChild);
    }
    var cont = header.querySelector('.container');
    if (cont && !header.querySelector('.bc-rotulo')) {
        var rotulo = document.createElement('p');
        rotulo.className = 'bc-rotulo';
        rotulo.textContent = 'Diplomatura de posgrado · LICDIA · UNLu';
        cont.insertBefore(rotulo, cont.firstChild);
    }
    function cadena() {
    // Tarjetas
    lienzoCadena.innerHTML = bloques.map(function (b) {
        return '<button type="button" class="bc-bloque" data-ancla="' + b.ancla + '" aria-label="Curso ' + b.n + ': ' + b.titulo + '. Ver en el plan de estudios">' +
            '<span class="bc-bloque-cab"><span>Bloque #' + b.n + '</span><span class="bc-bloque-estado">en espera</span></span>' +
            '<span class="bc-bloque-titulo">' + b.corto + '</span>' +
            '<span class="bc-campo"><span>datos</span><code>' + corto(b.datos) + '</code></span>' +
            '<span class="bc-campo"><span>anterior</span><code class="bc-prev">—</code></span>' +
            '<span class="bc-campo"><span>nonce</span><code class="bc-nonce">0</code></span>' +
            '<span class="bc-campo bc-campo-hash"><span>hash</span><code class="bc-hash">—</code></span>' +
            '</button>';
    }).join('');
    var tarjetas = lienzoCadena.querySelectorAll('.bc-bloque');
    var estado = header.querySelector('.bc-estado');
    lienzoCadena.addEventListener('click', function (e) {
        var t = e.target.closest('.bc-bloque');
        if (!t) return;
        var el = document.getElementById(t.getAttribute('data-ancla'));
        if (el && window.bootstrap && el.classList.contains('collapse')) window.bootstrap.Collapse.getOrCreateInstance(el, { toggle: false }).show();
        var destino = document.getElementById('informacionPlan') || el;
        if (destino) destino.scrollIntoView({ behavior: reducir ? 'auto' : 'smooth', block: 'start' });
    });

    // ---------- Minería: prueba de trabajo real, en tramos por cuadro ----------
    var totalHashes = 0, t0 = 0, actual = 0, prev = '0'.repeat(64), nonce = 0, prefijo = null;
    function prepararBloque() {
        var b = bloques[actual];
        b.prev = prev;
        prefijo = 'curso:' + b.n + '|anterior:' + prev + '|datos:' + b.datos + '|nonce:';
        nonce = 0;
        tarjetas[actual].classList.add('minando');
        tarjetas[actual].querySelector('.bc-bloque-estado').textContent = 'minando…';
        tarjetas[actual].querySelector('.bc-prev').textContent = corto(prev);
        plan(actual, { prev: corto(prev) }, ['minando', 'minando…']);
    }
    function minar() {
        var tar = tarjetas[actual], limite = performance.now() + 3, h;   // 3 ms por cuadro: cada bloque tarda ~1 s y se ve correr el nonce
        while (performance.now() < limite) {
            h = sha256Texto(prefijo + nonce);
            totalHashes++;
            if (h.slice(0, DIFICULTAD.length) === DIFICULTAD) {
                var b = bloques[actual];
                b.nonce = nonce; b.hash = h; prev = h;
                tar.classList.remove('minando'); tar.classList.add('minado');
                tar.querySelector('.bc-bloque-estado').textContent = '✓ minado';
                tar.querySelector('.bc-nonce').textContent = nonce.toLocaleString('es-AR');
                tar.querySelector('.bc-hash').innerHTML = '<b>' + DIFICULTAD + '</b>' + corto(h).slice(DIFICULTAD.length);
                tar.title = 'hash ' + h;
                plan(actual, { nonce: nonce.toLocaleString('es-AR'), hash: tar.querySelector('.bc-hash').innerHTML }, ['minado', '✓ minado']);
                planEnlace(b.n, h);
                sumarAlFondo(h, true);
                actual++;
                if (actual < bloques.length) { prepararBloque(); } else { terminar(); return; }
                break;
            }
            nonce++;
        }
        if (actual < bloques.length) {
            tarjetas[actual].querySelector('.bc-nonce').textContent = nonce.toLocaleString('es-AR');
            tarjetas[actual].querySelector('.bc-hash').textContent = corto(h || '');
            plan(actual, { nonce: nonce.toLocaleString('es-AR'), hash: corto(h || '') });
            var seg = (performance.now() - t0) / 1000;
            estado.textContent = 'Minando el bloque #' + (actual + 1) + ' en este navegador · ' + Math.round(totalHashes / Math.max(seg, 0.1)).toLocaleString('es-AR') + ' hashes por segundo';
            requestAnimationFrame(minar);
        }
    }
    function terminar() {
        var seg = (performance.now() - t0) / 1000;
        estado.textContent = bloques.length + ' bloques encadenados · dificultad ' + DIFICULTAD + ' · ' + totalHashes.toLocaleString('es-AR') +
            ' hashes SHA-256 calculados en tu navegador en ' + seg.toFixed(1).replace('.', ',') + ' s';
        lienzoCadena.classList.add('completa');
    }
    function arrancarMineria() {
        t0 = performance.now();
        prepararBloque();
        requestAnimationFrame(minar);
    }
    // Arranca cuando el encabezado está a la vista (y una vez cargadas las tipografías, para no recalcular el diseño)
    var arrancada = false;
    function quizasArrancar() { if (!arrancada) { arrancada = true; setTimeout(arrancarMineria, reducir ? 0 : 600); } }
    // ... o el plan de estudios, si se entra directo por #informacionPlan
    if ('IntersectionObserver' in window) {
        var vigia = new IntersectionObserver(function (es) {
            if (es.some(function (e) { return e.isIntersecting; })) quizasArrancar();
        });
        vigia.observe(lienzoCadena);
        if (document.querySelector('.bc-plan')) vigia.observe(document.querySelector('.bc-plan'));
    } else { quizasArrancar(); }

    // Al abrir un curso del plan se verifica su bloque: se recalcula el hash de los contenidos que se ven y el del
    // encabezado con el nonce encontrado, y se compara con lo minado
    document.addEventListener('shown.bs.collapse', function (e) {
        var k = bloques.findIndex(function (b) { return b.ancla === e.target.id; });
        var b = bloques[k], el = enPlan[k];
        if (!b || !el || b.hash == null) return;
        var texto = e.target.querySelector('.bc-plan-cuerpo').textContent.replace(/\s+/g, ' ').trim();
        var datos = sha256Texto('Curso ' + b.n + ' — ' + b.titulo + '\n' + texto);
        var h = sha256Texto('curso:' + b.n + '|anterior:' + b.prev + '|datos:' + datos + '|nonce:' + b.nonce);
        var ok = datos === b.datos && h === b.hash && h.indexOf(DIFICULTAD) === 0;
        plan(k, {}, ok ? ['minado verificado', '✓ verificado'] : ['minando', '✗ no coincide']);
        el.querySelector('[data-bc="estado"]').title = ok ? 'SHA-256 de los contenidos y del bloque recalculados en tu navegador: coinciden con lo minado' : '';
    });

    // Para verificar desde la consola: window.bcCadena.verificar() recalcula cada hash
    window.bcCadena = {
        bloques: bloques,
        verificar: function () {
            var p = '0'.repeat(64);
            return bloques.every(function (b) {
                if (b.hash == null) return false;
                var h = sha256Texto('curso:' + b.n + '|anterior:' + p + '|datos:' + b.datos + '|nonce:' + b.nonce);
                var ok = h === b.hash && h.indexOf(DIFICULTAD) === 0;
                p = h;
                return ok;
            });
        }
    };
    }

    // ---------- Fondo: hashes SHA-256 reales de las secciones de esta página ----------
    var flotantes = [], semilla = 5, Wd = 0, Hd = 0;
    function azar() { semilla = (semilla * 16807) % 2147483647; return (semilla - 1) / 2147483646; }
    function sumarAlFondo(h, nuevo) {
        flotantes.push({ t: '0x' + h.slice(0, 6) + '…' + h.slice(-4), x: azar() * Wd, y: nuevo ? Hd * (0.3 + 0.5 * azar()) : azar() * Hd,
                         z: nuevo ? 1 : azar(), vy: -(0.06 + azar() * 0.18), vx: (azar() - 0.5) * 0.06, nuevo: nuevo ? 1 : 0 });
    }
    function fondo() {
    var cv = document.createElement('canvas');
    capa.appendChild(cv);
    var ctx = cv.getContext('2d'), dpr = Math.min(window.devicePixelRatio || 1, 2);
    var visible = true, corriendo = false;
    function medir() {
        Wd = header.offsetWidth; Hd = header.offsetHeight;
        cv.width = Math.round(Wd * dpr); cv.height = Math.round(Hd * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    medir();
    var secciones = Array.prototype.slice.call(document.querySelectorAll('section, article, .accordion-body'));
    secciones.forEach(function (s) {
        var t = s.textContent.replace(/\s+/g, ' ').trim();
        if (t.length > 40) sumarAlFondo(sha256Texto(t), false);
    });
    while (flotantes.length < 40) sumarAlFondo(sha256Texto('licdia-blockchain-' + flotantes.length), false);
    function velo(x, y) {   // más tenue detrás del título y la cadena
        var dx = (x - Wd / 2) / (Wd * 0.42), dy = (y - Hd * 0.5) / (Hd * 0.45);
        return Math.min(1, 0.25 + 0.75 * Math.max(0, Math.sqrt(dx * dx + dy * dy) - 0.45));
    }
    function cuadro() {
        ctx.clearRect(0, 0, Wd, Hd);
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        flotantes.forEach(function (f) {
            if (!reducir) { f.y += f.vy * (0.6 + f.z); f.x += f.vx; }
            if (f.y < -14) { f.y = Hd + 14; f.x = azar() * Wd; }
            if (f.nuevo > 0) f.nuevo = Math.max(0, f.nuevo - 0.004);
            ctx.font = '400 ' + (9 + f.z * 5).toFixed(1) + 'px "DM Mono", ui-monospace, monospace';
            var al = (0.05 + f.z * 0.2) * velo(f.x, f.y) + f.nuevo * 0.5;
            ctx.fillStyle = f.nuevo > 0.02 ? 'rgba(245,185,66,' + Math.min(1, al).toFixed(3) + ')' : 'rgba(170,140,230,' + (al * .8).toFixed(3) + ')';
            ctx.fillText(f.t, f.x, f.y);
        });
        if (visible && !reducir) requestAnimationFrame(cuadro); else corriendo = false;
    }
    function arrancarFondo() { if (!corriendo) { corriendo = true; requestAnimationFrame(cuadro); } }
    if ('IntersectionObserver' in window) {
        new IntersectionObserver(function (es) { visible = es[0].isIntersecting; if (visible) arrancarFondo(); }).observe(header);
    }
    var espera;
    window.addEventListener('resize', function () { clearTimeout(espera); espera = setTimeout(function () { medir(); if (reducir) cuadro(); }, 200); });
    if (reducir) cuadro(); else arrancarFondo();
    }

    fondo();
    if (lienzoCadena && bloques.length) cadena();
})();
