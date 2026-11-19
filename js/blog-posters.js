/* Muro de pósters de una entrada del blog (estilos en css/blog-posters.css).
   - Mezcla el orden en cada visita y con el botón "mezclar": ningún póster queda siempre primero.
   - Filtra por línea de I+D.
   - Abre cada póster en un visor: clic o rueda para ampliar, arrastrar para mover, ← → para recorrer, Esc para cerrar,
     deslizar en pantallas táctiles. La dirección queda como #p-<slug> para compartir un póster puntual.
   Sin JS, la entrada muestra la lista completa con resúmenes y enlaces a los PDF. */
(function () {
    'use strict';

    var muros = document.querySelectorAll('.px');
    if (!muros.length) return;

    function el(tag, attrs, html) {
        var e = document.createElement(tag);
        Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); });
        if (html != null) e.innerHTML = html;
        return e;
    }
    var reducido = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    /* ---------- Visor (uno por página) ---------- */
    var visor = el('div', { 'class': 'px-visor', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'px-v-titulo', hidden: '' });
    var lienzo = el('div', { 'class': 'px-v-lienzo' });
    var img = el('img', { alt: '', draggable: 'false' });
    var ayuda = el('div', { 'class': 'px-v-ayuda' }, 'clic para ampliar · arrastrar para mover · ← → para recorrer');
    lienzo.appendChild(img);
    lienzo.appendChild(ayuda);
    var panel = el('div', { 'class': 'px-v-panel' });
    var cab = el('div', { 'class': 'px-v-cab' });
    var contador = el('div', { 'class': 'px-v-contador', 'aria-live': 'polite' });
    var bAnt = el('button', { 'class': 'px-v-boton', type: 'button', 'aria-label': 'Póster anterior' }, '<i class="fa-solid fa-chevron-left" aria-hidden="true"></i>');
    var bSig = el('button', { 'class': 'px-v-boton', type: 'button', 'aria-label': 'Póster siguiente' }, '<i class="fa-solid fa-chevron-right" aria-hidden="true"></i>');
    var bCerrar = el('button', { 'class': 'px-v-boton', type: 'button', 'aria-label': 'Cerrar' }, '<i class="fa-solid fa-xmark" aria-hidden="true"></i>');
    cab.appendChild(contador);
    cab.appendChild(el('div', { 'class': 'px-v-sep' }));
    cab.appendChild(bAnt);
    cab.appendChild(bSig);
    cab.appendChild(bCerrar);
    var cuerpo = el('div', { 'class': 'px-v-cuerpo' });
    panel.appendChild(cab);
    panel.appendChild(cuerpo);
    visor.appendChild(lienzo);
    visor.appendChild(panel);
    document.body.appendChild(visor);

    var lista = [];      // pósters visibles, en el orden del muro
    var pos = -1;        // índice del póster abierto en lista
    var volverA = null;  // elemento que recupera el foco al cerrar
    var z = 1, tx = 0, ty = 0;

    function aplicar() {
        img.style.setProperty('--px-z', z);
        img.style.setProperty('--px-x', tx + 'px');
        img.style.setProperty('--px-y', ty + 'px');
        lienzo.classList.toggle('ampliado', z > 1);
    }
    function acotar() {
        var mx = Math.max(0, (img.offsetWidth * z - lienzo.clientWidth) / 2 + 24);
        var my = Math.max(0, (img.offsetHeight * z - lienzo.clientHeight) / 2 + 24);
        tx = Math.max(-mx, Math.min(mx, tx));
        ty = Math.max(-my, Math.min(my, ty));
    }
    // amplía a "nuevo" manteniendo fijo el punto (px, py) de la pantalla
    function ampliar(nuevo, px, py) {
        var r = lienzo.getBoundingClientRect();
        var dx = px - (r.left + r.width / 2), dy = py - (r.top + r.height / 2);
        nuevo = Math.max(1, Math.min(4, nuevo));
        tx = dx - (dx - tx) * (nuevo / z);
        ty = dy - (dy - ty) * (nuevo / z);
        z = nuevo;
        if (z === 1) { tx = 0; ty = 0; }
        if (z > 1 && img.dataset.zoom && img.src.indexOf(img.dataset.zoom) < 0) {
            var grande = new Image();
            var pedido = img.dataset.zoom;
            grande.onload = function () { if (img.dataset.zoom === pedido) img.src = pedido; };
            grande.src = pedido;
        }
        acotar();
        aplicar();
    }
    function reiniciar() { z = 1; tx = 0; ty = 0; aplicar(); }

    function mostrar(i) {
        if (!lista.length) return;
        pos = (i + lista.length) % lista.length;
        var it = lista[pos];
        var tile = it.querySelector('.px-tile');
        var chico = it.querySelector('.px-img img');
        visor.setAttribute('data-linea', it.getAttribute('data-linea'));
        reiniciar();
        img.dataset.zoom = it.getAttribute('data-zoom');
        img.src = (chico.getAttribute('srcset') || '').split(',').pop().trim().split(' ')[0] || chico.src;
        img.alt = chico.alt;
        cuerpo.innerHTML = '';
        cuerpo.appendChild(it.querySelector('.px-linea').cloneNode(true));
        cuerpo.appendChild(el('h2', { id: 'px-v-titulo' }, it.querySelector('.px-titulo').innerHTML));
        cuerpo.appendChild(it.querySelector('.px-autores').cloneNode(true));
        var det = it.querySelector('.px-detalle');
        cuerpo.appendChild(el('div', { 'class': 'px-v-rotulo' }, 'Síntesis'));
        cuerpo.appendChild(det.querySelector('.px-mensaje').cloneNode(true));
        cuerpo.appendChild(el('div', { 'class': 'px-v-rotulo' }, 'Resumen'));
        cuerpo.appendChild(det.querySelector('.px-resumen').cloneNode(true));
        cuerpo.appendChild(det.querySelector('.px-acciones').cloneNode(true));
        cuerpo.scrollTop = 0;
        contador.innerHTML = '<b>' + String(pos + 1).padStart(2, '0') + '</b> / ' + String(lista.length).padStart(2, '0');
        try { history.replaceState(null, '', '#' + it.id); } catch (e) { }
        // precarga de los vecinos
        [pos - 1, pos + 1].forEach(function (j) {
            var v = lista[(j + lista.length) % lista.length].querySelector('.px-img img');
            var src = (v.getAttribute('srcset') || '').split(',').pop().trim().split(' ')[0];
            if (src) new Image().src = src;
        });
        volverA = tile;
    }
    function abrir(muro, item) {
        lista = Array.prototype.filter.call(muro.querySelectorAll('.px-item'), function (x) { return !x.hidden; });
        visor.hidden = false;
        document.body.classList.add('px-abierto');
        mostrar(lista.indexOf(item));
        bCerrar.focus({ preventScroll: true });
    }
    function cerrar() {
        visor.hidden = true;
        document.body.classList.remove('px-abierto');
        try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { }
        if (volverA) volverA.focus({ preventScroll: true });
    }
    bAnt.addEventListener('click', function () { mostrar(pos - 1); });
    bSig.addEventListener('click', function () { mostrar(pos + 1); });
    bCerrar.addEventListener('click', cerrar);

    // en document: un clic sobre el lienzo deja el foco en body
    document.addEventListener('keydown', function (e) {
        if (visor.hidden) return;
        if (e.key === 'Escape') { e.preventDefault(); if (z > 1) reiniciar(); else cerrar(); }
        else if (e.key === 'ArrowLeft') { e.preventDefault(); mostrar(pos - 1); }
        else if (e.key === 'ArrowRight') { e.preventDefault(); mostrar(pos + 1); }
        else if (e.key === 'Tab') {  // el foco no sale del visor
            var f = visor.querySelectorAll('button, a[href]');
            var primero = f[0], ultimo = f[f.length - 1];
            if (e.shiftKey && document.activeElement === primero) { e.preventDefault(); ultimo.focus(); }
            else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primero.focus(); }
        }
    });

    // clic para ampliar, arrastre para mover, deslizamiento para cambiar de póster
    var arrastre = null;
    lienzo.addEventListener('pointerdown', function (e) {
        if (e.button !== 0) return;
        arrastre = { x: e.clientX, y: e.clientY, tx: tx, ty: ty, movio: false, id: e.pointerId };
    });
    lienzo.addEventListener('pointermove', function (e) {
        if (!arrastre || e.pointerId !== arrastre.id) return;
        var dx = e.clientX - arrastre.x, dy = e.clientY - arrastre.y;
        if (!arrastre.movio && Math.abs(dx) + Math.abs(dy) > 6) {
            arrastre.movio = true;
            try { lienzo.setPointerCapture(e.pointerId); } catch (err) { }
            if (z > 1) lienzo.classList.add('arrastrando');
        }
        if (arrastre.movio && z > 1) { tx = arrastre.tx + dx; ty = arrastre.ty + dy; acotar(); aplicar(); }
    });
    function soltar(e) {
        if (!arrastre || e.pointerId !== arrastre.id) return;
        var dx = e.clientX - arrastre.x, dy = e.clientY - arrastre.y;
        lienzo.classList.remove('arrastrando');
        if (!arrastre.movio && e.type === 'pointerup') {
            if (z > 1) reiniciar(); else ampliar(2.6, e.clientX, e.clientY);
        } else if (arrastre.movio && z === 1 && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) {
            mostrar(pos + (dx < 0 ? 1 : -1));
        }
        arrastre = null;
    }
    lienzo.addEventListener('pointerup', soltar);
    lienzo.addEventListener('pointercancel', soltar);
    lienzo.addEventListener('wheel', function (e) {
        e.preventDefault();
        ampliar(z * (e.deltaY < 0 ? 1.18 : 1 / 1.18), e.clientX, e.clientY);
    }, { passive: false });
    window.addEventListener('resize', function () { if (!visor.hidden) { acotar(); aplicar(); } });

    /* ---------- Muros ---------- */
    Array.prototype.forEach.call(muros, function (px) {
        var muro = px.querySelector('.px-muro');
        var items = Array.prototype.slice.call(muro.children);
        px.classList.add('px-js');

        function barajar(animar) {
            for (var i = items.length - 1; i > 0; i--) {  // Fisher-Yates
                var j = Math.floor(Math.random() * (i + 1));
                var t = items[i]; items[i] = items[j]; items[j] = t;
            }
            items.forEach(function (it, k) { it.style.setProperty('--i', k); muro.appendChild(it); });
            if (animar && !reducido) {
                px.classList.remove('px-barajando');
                void px.offsetWidth;
                px.classList.add('px-barajando');
                setTimeout(function () { px.classList.remove('px-barajando'); }, 900);
            }
        }

        var barra = px.querySelector('.px-barra');
        var bMezclar = el('button', { 'class': 'px-mezclar', type: 'button', 'aria-label': 'Mezclar el orden de los pósters' },
            '<i class="fa-solid fa-shuffle" aria-hidden="true"></i> mezclar');
        bMezclar.addEventListener('click', function () { barajar(true); });
        barra.appendChild(bMezclar);

        // filtros por línea de I+D, en orden alfabético
        var lineas = {};
        items.forEach(function (it) {
            var l = it.getAttribute('data-linea');
            lineas[l] = lineas[l] || { nombre: it.querySelector('.px-linea').textContent, n: 0 };
            lineas[l].n++;
        });
        var filtros = el('div', { 'class': 'px-filtros', role: 'group', 'aria-label': 'Filtrar por línea de I+D' });
        function filtro(clave, nombre, n) {
            var b = el('button', { 'class': 'px-filtro', type: 'button', 'aria-pressed': clave === '*' ? 'true' : 'false' },
                nombre + ' <b>' + n + '</b>');
            if (clave !== '*') b.setAttribute('data-linea', clave);
            b.addEventListener('click', function () {
                Array.prototype.forEach.call(filtros.children, function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
                items.forEach(function (it) { it.hidden = clave !== '*' && it.getAttribute('data-linea') !== clave; });
            });
            filtros.appendChild(b);
        }
        filtro('*', 'Todas', items.length);
        Object.keys(lineas).sort(function (a, b) { return lineas[a].nombre.localeCompare(lineas[b].nombre, 'es'); })
            .forEach(function (k) { filtro(k, lineas[k].nombre, lineas[k].n); });
        barra.parentNode.insertBefore(filtros, barra.nextSibling);

        items.forEach(function (it) {
            it.querySelector('.px-tile').addEventListener('click', function (e) {
                if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;  // abrir el PDF en otra pestaña
                e.preventDefault();
                abrir(px, it);
            });
        });

        barajar(false);
        var pedido = location.hash && document.getElementById(location.hash.slice(1));
        if (pedido && muro.contains(pedido)) abrir(px, pedido);
    });
})();
