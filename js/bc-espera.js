/* Lista de espera 2027 (Diplomatura en Blockchain).
   Envía al mismo webhook de n8n que usan los demás formularios de LICDIA, con Origen = "espera-2027-blockchain".
   Firma opcional: personal_sign (EIP-191) con la wallet del navegador, sin transacción ni cambio de red. */
(function () {
    'use strict';

    var WEBHOOK = 'https://n8n.impulsate.lat/webhook/licdia-inscripcion';
    var ORIGEN = 'espera-2027-blockchain';
    var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

    // Atribución: el juego llega con ?desde=<botón>&s=<sesión del embudo>&utm_*=… (ver enlaceEspera en
    // js/blockchain-juego/app.js). Un enlace directo o de campaña trae solo las UTM, o nada.
    var params = new URLSearchParams(location.search);
    var DESDES = ['certificado', 'recorrido', 'inscripcion', 'otro'];
    var DESDE = DESDES.indexOf(params.get('desde')) >= 0 ? params.get('desde') : 'sitio';
    // Perfil elegido en el juego (js/blockchain-juego/perfil.js) → opción del formulario, si la persona no eligió otra
    var PERFIL_OPCION = { dev: 'Desarrollador / Ingeniero IT', legal: 'Abogado / Contador / Administrador', finanzas: 'Finanzas / Economía' };
    var UTM = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'].filter(function (k) { return params.get(k); });

    var $ = function (id) { return document.getElementById(id); };
    var form = $('formEspera');
    if (!form) return;

    var firma = { address: '', mensaje: '', firma: '' };
    var eth = window.ethereum || null;

    function hoy() {
        var d = new Date();
        var p = function (n) { return (n < 10 ? '0' : '') + n; };
        return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
    }

    function emailLimpio() { return $('esp-email').value.trim().toLowerCase(); }

    function mensajeAFirmar(email) {
        return 'Me interesa la cohorte 2027 de la Diplomatura en Blockchain de la UNLu - ' + email + ' - ' + hoy();
    }

    function toHex(str) {
        var bytes = new TextEncoder().encode(str), out = '0x';
        for (var i = 0; i < bytes.length; i++) out += ('0' + bytes[i].toString(16)).slice(-2);
        return out;
    }

    function sha256(str) {
        if (!(window.crypto && crypto.subtle)) return Promise.resolve('');
        return crypto.subtle.digest('SHA-256', new TextEncoder().encode(str)).then(function (b) {
            return Array.prototype.map.call(new Uint8Array(b), function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
        }).catch(function () { return ''; });
    }

    function corto(h) { return h ? '0x' + h.slice(0, 8) + '…' + h.slice(-4) : ''; }

    function setError(id, msg) {
        var el = $(id);
        el.textContent = msg || '';
        var input = { 'err-nombre': 'esp-nombre', 'err-email': 'esp-email', 'err-consent': 'esp-consent' }[id];
        if (input) $(input).setAttribute('aria-invalid', msg ? 'true' : 'false');
    }

    function validar() {
        var ok = true, first = null;
        var nombre = $('esp-nombre').value.trim();
        if (nombre.length < 3) { setError('err-nombre', 'Escribí tu nombre y apellido.'); ok = false; first = first || $('esp-nombre'); }
        else setError('err-nombre', '');
        if (!EMAIL_RE.test(emailLimpio())) { setError('err-email', 'Escribí un correo válido, por ejemplo nombre@dominio.com.'); ok = false; first = first || $('esp-email'); }
        else setError('err-email', '');
        if (!$('esp-consent').checked) { setError('err-consent', 'Necesitamos tu consentimiento para poder avisarte.'); ok = false; first = first || $('esp-consent'); }
        else setError('err-consent', '');
        if (first) first.focus();
        return ok;
    }

    // Los campos del bloque se recalculan con lo que se escribe (SHA-256 en el navegador)
    var tick = 0;
    function actualizarBloque() {
        var n = ++tick;
        var base = $('esp-nombre').value.trim() + '|' + emailLimpio() + '|' + $('esp-perfil').value + '|' + firma.firma;
        var vacio = !$('esp-nombre').value.trim() && !emailLimpio();
        $('bc-espera-h-firma').textContent = firma.firma ? firma.address.slice(0, 6) + '…' + firma.address.slice(-4) : 'sin firmar';
        if (vacio) { $('bc-espera-h-datos').textContent = 'lista de espera'; $('bc-espera-h-hash').textContent = 'esperando datos'; return; }
        sha256(base).then(function (h) {
            if (n !== tick || !h) return;
            $('bc-espera-h-datos').textContent = corto(h);
            sha256(h + '4c1c7f2026').then(function (h2) { if (n === tick && h2) $('bc-espera-h-hash').textContent = corto(h2); });
        });
    }

    // ---------- firma opcional ----------
    function invalidarFirma() {
        if (!firma.firma) return;
        firma = { address: '', mensaje: '', firma: '' };
        $('bc-espera-firma-estado').textContent = 'Cambiaste el correo: la firma anterior ya no corresponde. Podés firmar de nuevo.';
        $('bc-espera-firma-estado').className = 'bc-espera-firma-estado';
        $('bc-espera-firmar').textContent = 'Firmar el mensaje';
    }

    function refrescarMensaje() {
        var e = emailLimpio();
        $('bc-espera-mensaje').textContent = EMAIL_RE.test(e) ? mensajeAFirmar(e) : 'Completá tu correo para ver el mensaje que vas a firmar.';
    }

    if (eth && typeof eth.request === 'function') {
        $('bc-espera-firma').hidden = false;
        refrescarMensaje();
        $('bc-espera-firmar').addEventListener('click', function () {
            var estado = $('bc-espera-firma-estado');
            var email = emailLimpio();
            if (!EMAIL_RE.test(email)) { setError('err-email', 'Escribí un correo válido antes de firmar.'); $('esp-email').focus(); return; }
            setError('err-email', '');
            var msg = mensajeAFirmar(email);
            var btn = $('bc-espera-firmar');
            btn.disabled = true;
            estado.className = 'bc-espera-firma-estado';
            estado.textContent = 'Esperando a tu wallet…';
            eth.request({ method: 'eth_requestAccounts' }).then(function (cuentas) {
                var addr = cuentas && cuentas[0];
                if (!addr) throw new Error('sin cuenta');
                return eth.request({ method: 'personal_sign', params: [toHex(msg), addr] }).then(function (sig) {
                    firma = { address: addr, mensaje: msg, firma: sig };
                    estado.className = 'bc-espera-firma-estado ok';
                    estado.textContent = 'Firmado con ' + addr.slice(0, 6) + '…' + addr.slice(-4) + '. No se envió ninguna transacción.';
                    btn.textContent = 'Volver a firmar';
                    actualizarBloque();
                });
            }).catch(function (err) {
                estado.className = 'bc-espera-firma-estado mal';
                estado.textContent = (err && err.code === 4001)
                    ? 'Cancelaste la firma. No pasa nada: podés enviar el formulario sin firmar.'
                    : 'No pudimos obtener la firma. Podés enviar el formulario sin firmar.';
            }).then(function () { btn.disabled = false; });
        });
    }

    $('esp-consent').addEventListener('change', function () { if ($('esp-consent').checked) setError('err-consent', ''); });
    $('esp-email').addEventListener('input', function () {
        if (firma.firma && firma.mensaje !== mensajeAFirmar(emailLimpio())) invalidarFirma();
        refrescarMensaje();
    });
    ['esp-nombre', 'esp-email', 'esp-perfil'].forEach(function (id) {
        $(id).addEventListener('input', function () { var e = $('err-' + id.slice(4)); if (e && e.textContent) setError(e.id, ''); });
        $(id).addEventListener('input', actualizarBloque);
        $(id).addEventListener('change', actualizarBloque);
    });

    // ---------- medición ----------
    // El mismo embudo anónimo del juego (backend/medicion.py): solo el evento y de qué botón vino, nunca los datos del
    // formulario. Sin medir si el navegador pide no rastrear o es una visita del equipo (?bcw_equipo=1).
    function medirEnvio() {
        try {
            if (navigator.doNotTrack === '1' || localStorage.getItem('bcw-equipo') === '1') return;
            var sesion = params.get('s');
            if (!/^[0-9a-f]{16,32}$/.test(sesion || '')) {
                sesion = sessionStorage.getItem('bcw-sesion');
                if (!/^[0-9a-f]{16,32}$/.test(sesion || '')) {
                    sesion = Array.prototype.map.call(crypto.getRandomValues(new Uint8Array(16)), function (x) {
                        return (x < 16 ? '0' : '') + x.toString(16);
                    }).join('');
                }
            }
            var cuerpo = JSON.stringify({ sesion: sesion, evento: 'lista_espera_enviada', datos: { origen: DESDE } });
            if (!(navigator.sendBeacon && navigator.sendBeacon('/blockchain-dev/api/m', cuerpo))) {
                fetch('/blockchain-dev/api/m', { method: 'POST', body: cuerpo, keepalive: true }).catch(function () {});
            }
        } catch (e) { /* medir es opcional */ }
    }

    // ---------- envío ----------
    function mostrarOk() {
        form.hidden = true;
        $('bc-espera-ok').hidden = false;
        var est = $('bc-espera-estado');
        est.textContent = 'registrado';
        $('bc-espera-bloque').classList.add('minado');
        $('bc-espera-ok').scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    form.addEventListener('submit', function (e) {
        e.preventDefault();
        var glob = $('bc-espera-global');
        glob.hidden = true;
        if (!validar()) return;

        // Honeypot: un bot lo completa; le mostramos éxito y no enviamos nada
        if ($('esp-web').value) { mostrarOk(); return; }

        var data = new FormData();
        data.append('Nombre y Apellido', $('esp-nombre').value.trim());
        data.append('Correo', emailLimpio());
        if ($('esp-perfil').value) data.append('Perfil profesional', $('esp-perfil').value);
        data.append('Origen', ORIGEN);
        data.append('Desde', DESDE);
        UTM.forEach(function (k) { data.append(k, params.get(k).slice(0, 60)); });
        data.append('Consentimiento', 'Sí');
        data.append('Fecha', new Date().toISOString());
        if (firma.firma) {
            data.append('Wallet', firma.address);
            data.append('Mensaje firmado', firma.mensaje);
            data.append('Firma', firma.firma);
            data.append('Tipo de firma', 'EIP-191 personal_sign');
        }

        var btn = $('bc-espera-enviar');
        btn.disabled = true;
        btn.textContent = 'Enviando...';
        var controller = new AbortController();
        var timeoutId = setTimeout(function () { controller.abort(); }, 120000);
        fetch(WEBHOOK, { method: 'POST', body: data, headers: { 'Accept': 'application/json' }, signal: controller.signal })
            .then(function (r) {
                clearTimeout(timeoutId);
                if (!r.ok) throw new Error('http ' + r.status);
                return r.json().catch(function () { return {}; });
            })
            .then(function (resp) {
                if (resp && resp.event_id) { try { sessionStorage.setItem('lead_event_id', resp.event_id); } catch (x) {} }
                mostrarOk();
                medirEnvio();
            })
            .catch(function (err) {
                clearTimeout(timeoutId);
                btn.disabled = false;
                btn.textContent = 'Anotarme en la lista de espera';
                glob.hidden = false;
                glob.textContent = (err && err.name === 'AbortError')
                    ? 'El envío demoró demasiado. Probá de nuevo o escribinos a licdia@unlu.edu.ar.'
                    : 'No pudimos enviar tus datos. Probá de nuevo o escribinos a licdia@unlu.edu.ar.';
            });
    });

    var perfilSel = $('esp-perfil');
    if (perfilSel && !perfilSel.value && PERFIL_OPCION[params.get('perfil')]) perfilSel.value = PERFIL_OPCION[params.get('perfil')];

    actualizarBloque();
})();
