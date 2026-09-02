/**
 * API JSON. La PWA vive en GitHub Pages y habla con esto por HTTP.
 *
 * Nota de diseño: no usamos HtmlService para servir la app. Cuando el celular
 * tiene más de una cuenta de Google logueada, HtmlService rutea por /u/N y la
 * PWA instalada se rompe. Con celulares de terceros ese riesgo es alto, así que
 * el front va estático y esto queda como API pura.
 *
 * El POST llega con Content-Type text/plain para evitar el preflight CORS.
 */

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  var p = (e && e.parameter) || {};
  try {
    // Setup y ping son GET porque se ejecutan a mano, una sola vez, desde el navegador.
    if (p.action === 'ping') {
      return json_({
        ok: true,
        ts: tsStr_(),
        instalado: !!prop_('SHEET_ID'),
        pines_definidos: !!prop_('PIN_ADMIN')
      });
    }
    if (p.action === 'setup') {
      exigirBootstrap_(p);
      var res = setupCompleto_();
      res.bootstrap_key = prop_('BOOTSTRAP_KEY');
      return json_({ ok: true, data: res });
    }
    if (p.action === 'set_pin') {
      exigirBootstrap_(p);
      definirPin_(p.rol, p.pin);
      log_('bootstrap', 'DEFINIR_PIN', 'rol=' + p.rol, '');
      return json_({ ok: true });
    }
    return json_({ ok: false, error: 'Acción desconocida.' });
  } catch (err) {
    return json_({ ok: false, error: String(err.message || err) });
  }
}

/**
 * La primera llamada de instalación genera y devuelve la clave; a partir de ahí
 * hay que presentarla. No hay forma de sembrar un secreto vía clasp, y la URL
 * del web app no existe hasta después del deploy, así que la ventana es mínima.
 */
function exigirBootstrap_(p) {
  var k = prop_('BOOTSTRAP_KEY');
  // La ventana de instalación se cierra cuando la planilla existe, no cuando se
  // genera la clave: si la atamos a la clave, un setup que falla a mitad de
  // camino deja el sistema trabado con una clave que nadie llegó a ver.
  if (!prop_('SHEET_ID')) {
    // Sin log_ acá: la hoja LOG todavía no existe.
    if (!k) setProp_('BOOTSTRAP_KEY', uuid_());
    return;
  }
  if (String(p.key || '') !== k) {
    throw new Error('Clave de instalación inválida.');
  }
}

var RUTAS = {
  // operador
  estado: estadoDelDia_,
  abrir: abrirTarja_,
  cerrar: cerrarTarja_,
  vincular: vincularDispositivo_,
  // panel
  login: login_,
  hoy: panelHoy_,
  pendientes: panelPendientes_,
  cerrar_pendiente: cerrarPendiente_,
  equipo: panelEquipo_,
  certificacion: panelCertificacion_,
  anular: anularTarja_,
  corregir_horometro: corregirHorometro_
};

function doPost(e) {
  var p;
  try {
    p = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json_({ ok: false, error: 'No se pudo leer el pedido.' });
  }
  var fn = RUTAS[p.action];
  if (!fn) return json_({ ok: false, error: 'Acción desconocida: ' + p.action });
  try {
    return json_({ ok: true, data: fn(p) });
  } catch (err) {
    // Mensaje en castellano llano: el operador tiene que entender qué hacer.
    return json_({ ok: false, error: String(err.message || err) });
  }
}
