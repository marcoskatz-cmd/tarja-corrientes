/**
 * Borrado real de una tarja. Existe SOLO para limpiar datos de prueba.
 *
 * El camino normal es anular desde el panel: la fila queda, con motivo y en el
 * LOG, y sale del consolidado. Eso es lo correcto para un registro operativo.
 * Esto otro elimina la fila y manda las fotos a la papelera, y por eso está
 * detrás de la clave de instalación y no se expone en el panel.
 */

function borrarTarja_(equipoNombre, fecha, aplicar) {
  var equipo = equipoPorNombre_(equipoNombre);
  var t = leer_('TARJAS').filter(function (x) {
    return String(x.equipo) === String(equipo.equipo) && String(x.fecha) === String(fecha);
  })[0];
  if (!t) throw new Error('No hay tarja de ' + equipo.equipo + ' con fecha ' + fecha + '.');

  var resp = leer_('CHECKLIST_RESP').filter(function (r) { return String(r.tarja_id) === String(t.id); });
  var pend = leer_('PENDIENTES').filter(function (r) { return String(r.tarja_id) === String(t.id); });
  var fotos = [t.foto_monitor, t.foto_horom_ini, t.foto_horom_fin, t.firma]
    .concat(resp.map(function (r) { return r.foto; }))
    .filter(function (u) { return String(u || '').trim(); });

  var detalle = {
    tarja: { id: t.id, equipo: t.equipo, fecha: String(t.fecha), estado: t.estado,
             operador: t.operador, horas: t.horas },
    checklist: resp.length,
    pendientes: pend.length,
    fotos: fotos.length,
    horom_a_restaurar: Number(t.horom_ini_sugerido || 0)
  };
  if (!aplicar) return { simulacion: true, se_borraria: detalle };

  // De abajo hacia arriba: si algo falla a mitad, no queda una tarja huérfana
  // con sus respuestas ya borradas.
  borrarFilas_('PENDIENTES', pend);
  borrarFilas_('CHECKLIST_RESP', resp);
  borrarFilas_('TARJAS', [t]);

  var papelera = 0;
  fotos.forEach(function (url) {
    var m = String(url).match(/[-\w]{25,}/);
    if (!m) return;
    try { DriveApp.getFileById(m[0]).setTrashed(true); papelera++; } catch (e) { /* ya no está */ }
  });

  // El cierre había adelantado el horómetro del equipo: se vuelve atrás.
  actualizar_('EQUIPOS', equipo._fila, { horom_actual: Number(t.horom_ini_sugerido || 0) });

  log_('mantenimiento', 'BORRADO_TARJA',
       t.equipo + ' ' + String(t.fecha) + ' (' + resp.length + ' respuestas, ' +
       pend.length + ' pendientes, ' + papelera + ' fotos)', 'dato de prueba');

  return { simulacion: false, borrado: detalle, fotos_a_papelera: papelera };
}

/** Borra de abajo hacia arriba para que no se corran los números de fila. */
function borrarFilas_(nombre, filas) {
  var sh = hoja_(nombre);
  filas.map(function (f) { return f._fila; })
    .sort(function (a, b) { return b - a; })
    .forEach(function (n) { sh.deleteRow(n); });
}

/**
 * Saca de OPERADORES a los que no tienen ninguna tarja. La lista se aprende
 * sola de las firmas, así que al borrar una tarja de prueba queda el nombre
 * suelto sugiriéndose a los operarios de verdad.
 */
function limpiarOperadores_(aplicar) {
  var conTarja = {};
  leer_('TARJAS').forEach(function (t) {
    conTarja[String(t.operador).trim().toUpperCase()] = true;
  });
  var huerfanos = leer_('OPERADORES').filter(function (o) {
    return !conTarja[String(o.nombre).trim().toUpperCase()];
  });
  if (!aplicar) {
    return { simulacion: true, se_borrarian: huerfanos.map(function (o) {
      return o.nombre + ' (' + o.equipo + ')';
    }) };
  }
  borrarFilas_('OPERADORES', huerfanos);
  if (huerfanos.length) {
    log_('mantenimiento', 'LIMPIEZA_OPERADORES',
         huerfanos.map(function (o) { return o.nombre; }).join(', '), 'sin tarjas');
  }
  return { simulacion: false, borrados: huerfanos.length };
}
