/* Formulario «Sumate al LICDIA» de la portada (#sumate).
   Lo recibe la aplicación de Apps Script de tools/formularios/sumate-registro.gs, que guarda cada envío en una planilla
   y avisa a licdia@unlu.edu.ar. Apps Script responde con una redirección que el navegador no deja leer: se envía sin
   CORS (no-cors) y como formulario codificado, que es lo que Apps Script lee en e.parameter. */
(function () {
    'use strict';
    var SUMATE_URL = 'https://script.google.com/macros/s/AKfycbxrTATwlwRiS25QY0W-lUsV5GclwdCY_bi0JepevtM-Kscw_qyAXT3acmuGnw86BXOG/exec';   // implementación "Formulario Sumate de la portada" del proyecto "Registro Sumate" (licdia.unlu@gmail.com); vacía: se abre el correo de quien escribe
    var form = document.getElementById('formSumate');
    if (!form) return;
    var estado = form.querySelector('.sm-estado');
    var boton = form.querySelector('button[type="submit"]');

    function correoDirecto(datos) {
        var cuerpo = ['Nombre: ' + datos.get('Nombre'), 'Perfil: ' + datos.get('Perfil'), 'Me interesa: ' + datos.get('Interés'),
                      'Línea de I+D: ' + datos.get('Línea'), '', datos.get('Mensaje') || ''].join('\n');
        return 'mailto:licdia@unlu.edu.ar?subject=' + encodeURIComponent('Sumate al LICDIA - ' + datos.get('Interés')) +
               '&body=' + encodeURIComponent(cuerpo);
    }

    form.addEventListener('submit', function (e) {
        e.preventDefault();
        if (!form.checkValidity()) {
            form.classList.add('sm-revisar');
            estado.textContent = 'Revisá los campos marcados.';
            var primero = form.querySelector(':invalid');
            if (primero) primero.focus();
            return;
        }
        var datos = new FormData(form);
        datos.append('Origen', 'Sumate al LICDIA');
        datos.append('_subject', 'Sumate al LICDIA - ' + datos.get('Interés') + ' - ' + datos.get('Nombre'));
        if (!SUMATE_URL) {   // sin registro propio: el mensaje sale por el correo de quien escribe
            window.location.href = correoDirecto(datos);
            estado.innerHTML = 'Se abrió tu correo con el mensaje listo para enviar. Si no se abrió, ' +
                '<a href="' + correoDirecto(datos) + '">escribinos a licdia@unlu.edu.ar</a>.';
            return;
        }
        boton.disabled = true;
        boton.textContent = 'Enviando…';
        estado.textContent = '';
        var control = new AbortController();
        var espera = setTimeout(function () { control.abort(); }, 60000);
        fetch(SUMATE_URL, { method: 'POST', mode: 'no-cors', body: new URLSearchParams(datos), signal: control.signal })
            .then(function () {
                clearTimeout(espera);
                form.innerHTML = '<div class="sm-gracias"><i class="fas fa-circle-check" aria-hidden="true"></i>' +
                    '<p><strong>Recibimos tu mensaje.</strong> Te vamos a responder a ' +
                    String(datos.get('Correo')).replace(/[<>&"]/g, '') + '.</p></div>';
            })
            .catch(function () {
                clearTimeout(espera);
                boton.disabled = false;
                boton.textContent = 'Enviar';
                estado.innerHTML = 'No se pudo enviar. Probá de nuevo o <a href="' + correoDirecto(datos) + '">escribinos a licdia@unlu.edu.ar</a>.';
            });
    });
})();
