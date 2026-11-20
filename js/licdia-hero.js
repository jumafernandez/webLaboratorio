/* LICDIA, portada y demás páginas del laboratorio: la red de nodos del fondo de Contacto (el sitio original de Lucas Santillán), animada en el encabezado.
   Los nodos con nombre son las líneas de I+D de "Investigación", leídas de la misma página; el resto es la red que
   las une. Canvas liviano: se pausa fuera de pantalla y queda quieto con "reducir movimiento". */
(function () {
    'use strict';
    var header = document.querySelector('header.masthead');
    if (!header) return;
    var capa = header.querySelector('.lv-red');
    if (!capa) {   // las demás páginas del laboratorio no traen la capa en el HTML
        capa = document.createElement('div');
        capa.className = 'lv-red';
        capa.setAttribute('aria-hidden', 'true');
        header.insertBefore(capa, header.firstChild);
    }
    var reducir = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var cv = document.createElement('canvas');
    capa.appendChild(cv);
    var ctx = cv.getContext('2d'), W = 0, H = 0, dpr = Math.min(window.devicePixelRatio || 1, 2);
    var semilla = 13, nodos = [], visible = true, corriendo = false;
    function azar() { semilla = (semilla * 16807) % 2147483647; return (semilla - 1) / 2147483646; }
    var lineas = Array.prototype.map.call(document.querySelectorAll('#portfolio .qh-linea h4'), function (e) {
        return e.textContent.replace(/\s+/g, ' ').trim();
    }).filter(function (t) { return t && t.length < 60; });

    function medir() {
        W = header.offsetWidth; H = header.offsetHeight;
        cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    function crear() {
        medir();
        nodos = [];
        var n = Math.max(40, Math.min(90, Math.round(W * H / 16000)));
        for (var i = 0; i < n; i++) {
            nodos.push({ x: azar() * W, y: azar() * H, vx: (azar() - 0.5) * 0.25, vy: (azar() - 0.5) * 0.25,
                         r: 1 + azar() * 1.6, c: azar() < 0.6 ? '63,210,242' : '138,109,255', nombre: null });
        }
        // las líneas de trabajo, a los costados (alternando izquierda y derecha) para no tapar el título ni las carreras
        lineas.forEach(function (t, k) {
            var izq = k % 2 === 0, x0 = izq ? 0.02 : 0.9, y = 0.26 + 0.44 * ((Math.floor(k / 2) + 0.5) / Math.ceil(lineas.length / 2));
            nodos.push({ x: W * (x0 + azar() * 0.08), y: H * (y + (azar() - 0.5) * 0.06), vx: (azar() - 0.5) * 0.12,
                         vy: (azar() - 0.5) * 0.1, r: 2.6, c: '63,210,242', nombre: t, izq: izq });
        });
    }
    // corta en el espacio más cercano a la mitad
    function partir(t) {
        var m = t.length / 2, mejor = -1;
        for (var i = 0; i < t.length; i++) if (t[i] === ' ' && (mejor < 0 || Math.abs(i - m) < Math.abs(mejor - m))) mejor = i;
        return mejor < 0 ? [t] : [t.slice(0, mejor), t.slice(mejor + 1)];
    }
    // más tenue detrás del texto central
    function velo(x, y) {
        var dx = (x - W / 2) / (W * 0.32), dy = (y - H * 0.5) / (H * 0.4);
        return Math.min(1, 0.2 + 0.8 * Math.max(0, Math.sqrt(dx * dx + dy * dy) - 0.35));
    }
    function cuadro() {
        ctx.clearRect(0, 0, W, H);
        var lim = Math.min(170, W * 0.14);
        if (!reducir) {
            nodos.forEach(function (n) {
                n.x += n.vx; n.y += n.vy;
                // los nodos con nombre no salen de la zona visible (arriba está el menú)
                var x0 = n.nombre ? W * (n.izq ? 0.02 : 0.9) : -20, x1 = n.nombre ? W * (n.izq ? 0.1 : 0.98) : W + 20;
                var y0 = n.nombre ? H * 0.24 : -20, y1 = n.nombre ? H * 0.72 : H + 20;     // arriba de la fila de carreras
                if (n.x < x0 || n.x > x1) n.vx *= -1;
                if (n.y < y0 || n.y > y1) n.vy *= -1;
            });
        }
        for (var i = 0; i < nodos.length; i++) {
            for (var j = i + 1; j < nodos.length; j++) {
                var a = nodos[i], b = nodos[j], dx = a.x - b.x, dy = a.y - b.y, d = Math.sqrt(dx * dx + dy * dy);
                if (d > lim) continue;
                var al = (1 - d / lim) * 0.28 * velo((a.x + b.x) / 2, (a.y + b.y) / 2);
                ctx.strokeStyle = 'rgba(120,170,255,' + al.toFixed(3) + ')';
                ctx.lineWidth = 0.8;
                ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
            }
        }
        ctx.font = '500 11px "DM Mono", ui-monospace, monospace';
        nodos.forEach(function (n) {
            var v = velo(n.x, n.y);
            ctx.fillStyle = 'rgba(' + n.c + ',' + (0.35 + 0.55 * v).toFixed(3) + ')';
            ctx.beginPath(); ctx.arc(n.x, n.y, n.r, 0, 6.283); ctx.fill();
            if (n.nombre && W >= 1200) {   // con menos ancho el título ocupa los costados
                ctx.fillStyle = 'rgba(200,230,255,' + (0.5 * v).toFixed(3) + ')';
                // en los márgenes: el nombre se escribe hacia adentro
                ctx.textAlign = n.izq ? 'left' : 'right';
                // los nombres largos van en dos renglones para no llegar al título
                var renglones = n.nombre.length > 24 ? partir(n.nombre) : [n.nombre];
                renglones.forEach(function (r, k) {
                    ctx.fillText(r, n.x + (n.izq ? 9 : -9), n.y + 4 + (k - (renglones.length - 1) / 2) * 13);
                });
            }
        });
        if (visible && !reducir) requestAnimationFrame(cuadro); else corriendo = false;
    }
    function arrancar() { if (!corriendo) { corriendo = true; requestAnimationFrame(cuadro); } }
    crear();
    if ('IntersectionObserver' in window) {
        new IntersectionObserver(function (es) { visible = es[0].isIntersecting; if (visible) arrancar(); }).observe(header);
    }
    var espera;
    window.addEventListener('resize', function () { clearTimeout(espera); espera = setTimeout(function () { crear(); if (reducir) cuadro(); }, 200); });
    if (reducir) cuadro(); else arrancar();
})();
