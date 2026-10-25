/* Registro de la Maestría en Ciencia de Datos (https://licdia.unlu.edu.ar/maestria-ciencia-datos/).
   Aplicación web de Apps Script en la cuenta licdia.unlu@gmail.com: recibe el formulario de la charla informativa y el
   de preinscripción, guarda cada envío en la planilla "Registros · Maestría en Ciencia de Datos" de la misma cuenta
   (la crea la primera vez) y manda un aviso a DESTINO. Reemplaza al webhook de n8n que se usaba antes.
   Instalación: ver tools/formularios/README.md. */

const DESTINO = 'licdia.unlu@gmail.com';
const NOMBRE_PLANILLA = 'Registros · Maestría en Ciencia de Datos';
const MAX_CAMPO = 500;

function doPost(e) {
  const p = (e && e.parameter) || {};
  // Trampa para robots: el campo _honey está oculto en el formulario; si viene con algo, se descarta en silencio
  if (p._honey) return salida_({ ok: true });
  const correo = String(p.Correo || '').trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(correo)) return salida_({ ok: false, error: 'correo' });

  // Los campos que empiezan con "_" son de control (asunto, origen del formulario): no van como columnas
  const campos = Object.keys(p).filter(function (k) { return k.charAt(0) !== '_' && k !== 'Origen'; });
  const origen = String(p.Origen || p._subject || 'Formulario de la maestría').slice(0, 120);
  const fila = { 'Fecha': new Date(), 'Formulario': origen };
  campos.forEach(function (k) { fila[k] = String(p[k]).slice(0, MAX_CAMPO); });

  const cerrojo = LockService.getScriptLock();
  cerrojo.waitLock(20000);
  try {
    const hoja = planilla_().getSheets()[0];
    // Encabezados: los que ya están y, al final, los que aparezcan por primera vez
    let encabezados = hoja.getLastRow() ? hoja.getRange(1, 1, 1, hoja.getLastColumn()).getValues()[0] : [];
    Object.keys(fila).forEach(function (k) { if (encabezados.indexOf(k) < 0) encabezados.push(k); });
    hoja.getRange(1, 1, 1, encabezados.length).setValues([encabezados]).setFontWeight('bold');
    hoja.appendRow(encabezados.map(function (k) { return k in fila ? fila[k] : ''; }));
  } finally {
    cerrojo.releaseLock();
  }

  const filas = Object.keys(fila).filter(function (k) { return k !== 'Fecha'; }).map(function (k) {
    return '<tr><th align="left" style="padding:4px 12px 4px 0">' + esc_(k) + '</th><td style="padding:4px 0">' + esc_(fila[k]) + '</td></tr>';
  }).join('');
  MailApp.sendEmail({
    to: DESTINO,
    replyTo: correo,
    subject: String(p._subject || 'Registro - Maestría en Ciencia de Datos').slice(0, 150),
    htmlBody: '<table style="font-family:Arial,sans-serif;font-size:14px">' + filas + '</table>' +
      '<p style="font-family:Arial,sans-serif;font-size:12px;color:#666">Se guardó en la planilla "' + NOMBRE_PLANILLA +
      '". Para responder, contestá este correo: va a ' + esc_(correo) + '.</p>'
  });
  return salida_({ ok: true });
}

// La planilla se crea la primera vez y su id queda en las propiedades del script
function planilla_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('PLANILLA_ID');
  if (id) return SpreadsheetApp.openById(id);
  const nueva = SpreadsheetApp.create(NOMBRE_PLANILLA);
  props.setProperty('PLANILLA_ID', nueva.getId());
  return nueva;
}

function salida_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function esc_(s) {
  return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
}

// Para probar desde el editor (Ejecutar → probar): guarda una fila de prueba y manda el aviso
function probar() {
  const r = doPost({ parameter: { 'Nombre': 'Prueba', 'Correo': DESTINO, 'Teléfono': '-', 'Perfil': 'Prueba de instalación',
                                  'Origen': 'Prueba del registro', '_subject': 'Prueba del registro de la maestría' } });
  Logger.log(r.getContent());
}
