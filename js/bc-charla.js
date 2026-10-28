/* Próxima charla informativa de la Diplomatura en Blockchain (portada).
   Lee blockchain-dev/charla-proxima.json: sin fecha muestra "fecha a confirmar" y lleva a la lista de espera; con fecha
   muestra día y hora, el enlace de inscripción si lo hay y un botón para agregarla al calendario (.ics). */
(function () {
    'use strict';
    var caja = document.getElementById('bc-charla-proxima');
    if (!caja) return;
    var ESPERA = '/blockchain-dev/espera-2027/?desde=inscripcion';

    function el(tag, clase, texto) {
        var e = document.createElement(tag);
        if (clase) e.className = clase;
        if (texto != null) e.textContent = texto;
        return e;
    }
    function boton(href, texto, extra) {
        var a = el('a', 'bc-charla-b' + (extra ? ' ' + extra : ''), texto);
        a.href = href;
        return a;
    }
    function ics(d) {
        // Hora de Argentina (UTC-3, sin horario de verano)
        var ini = new Date(d.fecha + 'T' + (d.hora || '19:00') + ':00-03:00');
        var fin = new Date(ini.getTime() + (d.duracion_min || 60) * 60000);
        var f = function (x) { return x.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''); };
        var lineas = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//LICDIA UNLu//Charla Blockchain//ES', 'BEGIN:VEVENT',
            'UID:charla-blockchain-' + d.fecha + '@licdia.unlu.edu.ar', 'DTSTAMP:' + f(new Date()), 'DTSTART:' + f(ini), 'DTEND:' + f(fin),
            'SUMMARY:Charla informativa · Diplomatura en Blockchain (UNLu)',
            'URL:' + (d.enlace || 'https://licdia.unlu.edu.ar/blockchain-dev/'), 'END:VEVENT', 'END:VCALENDAR'];
        return URL.createObjectURL(new Blob([lineas.join('\r\n')], { type: 'text/calendar' }));
    }
    function pintar(d) {
        caja.textContent = '';
        caja.appendChild(el('span', 'bc-charla-k', 'Próxima charla informativa'));
        var hay = d && /^\d{4}-\d{2}-\d{2}$/.test(d.fecha || '');
        if (!hay) {
            caja.appendChild(el('strong', 'bc-charla-f', 'Fecha a confirmar'));
            caja.appendChild(el('span', 'bc-charla-t', 'Si estás en la lista de espera, te avisamos apenas esté.'));
            caja.appendChild(boton(ESPERA, 'Anotarme en la lista de espera'));
            caja.hidden = false;
            return;
        }
        var dia = new Date(d.fecha + 'T12:00:00-03:00').toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Argentina/Buenos_Aires' });
        caja.appendChild(el('strong', 'bc-charla-f', dia + ', ' + (d.hora || '19:00') + ' h (ARG)'));
        if (d.enlace && /^https:\/\//.test(d.enlace)) {
            var a = boton(d.enlace, 'Quiero ir', 'bc-charla-prim');
            a.target = '_blank';
            a.rel = 'noopener';
            caja.appendChild(a);
        }
        var cal = boton(ics(d), 'Agregar al calendario');
        cal.setAttribute('download', 'charla-blockchain-unlu.ics');
        caja.appendChild(cal);
        caja.hidden = false;
    }
    fetch('/blockchain-dev/charla-proxima.json', { cache: 'no-cache' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(pintar)
        .catch(function () { pintar(null); });
})();
