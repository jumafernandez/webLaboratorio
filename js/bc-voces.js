/* Voces de la cohorte 2026 (portada de la Diplomatura en Blockchain).
   Lee blockchain-dev/voces-2026.json y muestra solo las entradas con consentimiento escrito registrado. Sin ninguna, la
   sección sigue oculta: nunca aparece un nombre sin ese consentimiento. */
(function () {
    'use strict';
    var seccion = document.getElementById('voces');
    var lista = document.getElementById('voces-lista');
    if (!seccion || !lista) return;

    function el(tag, clase, texto) {
        var e = document.createElement(tag);
        if (clase) e.className = clase;
        if (texto != null) e.textContent = texto;
        return e;
    }
    fetch('/blockchain-dev/voces-2026.json', { cache: 'no-cache' })
        .then(function (r) { return r.ok ? r.json() : { voces: [] }; })
        .then(function (d) {
            var voces = (d && Array.isArray(d.voces) ? d.voces : []).filter(function (v) {
                return v && typeof v.consentimiento === 'string' && v.consentimiento.trim() && v.nombre && v.texto;
            });
            if (!voces.length) return;
            voces.slice(0, 6).forEach(function (v) {
                var fig = el('figure', 'voz');
                var q = el('blockquote', 'voz-texto');
                q.appendChild(el('p', null, v.texto));
                fig.appendChild(q);
                var cap = el('figcaption', 'voz-quien');
                cap.appendChild(el('strong', null, v.nombre));
                if (v.rol) cap.appendChild(el('span', null, v.rol));
                if (v.curso) cap.appendChild(el('span', 'voz-curso', v.curso));
                fig.appendChild(cap);
                lista.appendChild(fig);
            });
            seccion.hidden = false;
        })
        .catch(function () { /* sin voces, la sección queda oculta */ });
})();
