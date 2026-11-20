/* LICDIA, portada: rótulo de cada sección con datos que se cuentan en la misma página (líneas, proyectos, trabajos,
   integrantes), precedido por un nodo de la red del encabezado. Si el contenido cambia, los números cambian solos. */
(function () {
    'use strict';
    function plural(n, uno, varios) { return n + ' ' + (n === 1 ? uno : varios); }
    function rotulo(h2, texto) {
        if (!h2 || !texto) return;
        var p = document.createElement('p');
        p.className = 'lv-eyebrow';
        p.innerHTML = '<span class="lv-nodo" aria-hidden="true"></span>';
        p.appendChild(document.createTextNode(texto));
        h2.parentNode.insertBefore(p, h2);
    }
    function titulo(sec, k) { return sec ? sec.querySelectorAll('h2.section-heading')[k || 0] : null; }

    // Investigación: tarjetas de líneas (.qh-linea), proyectos (.qh-proy) y desarrollos (las .portfolio-item que quedan)
    var portfolio = document.getElementById('portfolio');
    if (portfolio) {
        var lineas = portfolio.querySelectorAll('.qh-linea').length;
        var proyectos = portfolio.querySelectorAll('.qh-proy').length;
        var desarrollos = portfolio.querySelectorAll('.portfolio-item').length;
        rotulo(titulo(portfolio), plural(lineas, 'línea de I+D', 'líneas de I+D') + ' · ' + plural(proyectos, 'proyecto', 'proyectos') +
            ' · ' + plural(desarrollos, 'desarrollo', 'desarrollos'));
    }

    var novedades = document.getElementById('noticias');
    if (novedades) rotulo(titulo(novedades), 'desde el blog · ' + plural(novedades.querySelectorAll('.bl-nov').length, 'entrada reciente', 'entradas recientes'));

    // Publicaciones: entradas de la línea de tiempo y el rango de años
    var pubs = document.getElementById('acercaDe');
    if (pubs) {
        var trabajos = pubs.querySelectorAll('.timeline > li .timeline-panel').length;
        var anios = (pubs.querySelector('.timeline') || pubs).textContent.match(/\b20\d\d\b/g) || [];
        anios = anios.map(Number).sort();
        var rango = anios.length ? (anios[0] === anios[anios.length - 1] ? String(anios[0]) : anios[0] + '–' + anios[anios.length - 1]) : '';
        rotulo(titulo(pubs), plural(trabajos, 'trabajo', 'trabajos') + (rango ? ' · ' + rango : ''));
    }

    // Cursos y carreras: dos títulos en la misma sección
    var cursos = document.getElementById('cursosYcarreras');
    if (cursos) {
        var actividades = 0;
        Array.prototype.forEach.call(cursos.querySelectorAll('.portfolio-item'), function (e) { if (!e.closest('.diplo-card')) actividades++; });
        rotulo(titulo(cursos, 0), plural(actividades, 'actividad', 'actividades'));
        var diplos = cursos.querySelectorAll('.diplo-card').length, otras = cursos.querySelectorAll('.carrera-mini').length;
        rotulo(titulo(cursos, 1), plural(diplos, 'diplomatura del laboratorio', 'diplomaturas del laboratorio') + ' · ' +
            plural(otras, 'carrera en la que participa', 'carreras en las que participa'));
    }

    // Equipo: cuántas personas hay en cada grupo (los rótulos enmarcados separan los grupos)
    var equipo = document.getElementById('team');
    if (equipo) {
        var cuenta = { integrantes: 0, colaboradores: 0, tesistas: 0, pasantes: 0 }, grupo = 'integrantes';
        Array.prototype.forEach.call(equipo.querySelectorAll('h3.low-tittle, .team-member'), function (e) {
            if (e.tagName === 'H3') {
                var t = e.textContent;
                grupo = /tesista/i.test(t) ? 'tesistas' : /pasante/i.test(t) ? 'pasantes' : /colaborador/i.test(t) ? 'colaboradores' : 'integrantes';
                return;
            }
            cuenta[grupo]++;
        });
        var partes = [plural(cuenta.integrantes, 'integrante', 'integrantes')];
        if (cuenta.colaboradores) partes.push(plural(cuenta.colaboradores, 'colaborador externo', 'colaboradores externos'));
        if (cuenta.tesistas) partes.push(plural(cuenta.tesistas, 'tesista', 'tesistas'));
        if (cuenta.pasantes) partes.push(plural(cuenta.pasantes, 'pasante', 'pasantes'));
        rotulo(titulo(equipo), partes.join(' · '));
    }

    var contacto = document.getElementById('contact');
    if (contacto) rotulo(titulo(contacto), 'sede Luján · pabellón de laboratorios de informática');
})();
