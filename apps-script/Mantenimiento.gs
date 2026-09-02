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

  // El horómetro del equipo se RECALCULA sobre lo que queda, no se restaura al
  // valor previo de esta tarja: borrando varias del mismo día en orden, cada
  // una restauraba el suyo y el equipo terminaba con el valor más alto.
  actualizar_('EQUIPOS', equipo._fila, { horom_actual: horomSegunTarjas_(equipo.equipo) });

  log_('mantenimiento', 'BORRADO_TARJA',
       t.equipo + ' ' + String(t.fecha) + ' (' + resp.length + ' respuestas, ' +
       pend.length + ' pendientes, ' + papelera + ' fotos)', 'dato de prueba');

  return { simulacion: false, borrado: detalle, fotos_a_papelera: papelera };
}

/** Último horómetro de cierre que queda registrado para el equipo, o 0. */
function horomSegunTarjas_(equipoNombre) {
  var cerradas = leer_('TARJAS').filter(function (t) {
    return String(t.equipo).toUpperCase() === String(equipoNombre).toUpperCase() &&
           String(t.estado) === 'cerrada' && t.horom_fin !== '';
  }).sort(function (a, b) {
    return String(a.ts_cierre) < String(b.ts_cierre) ? -1 : 1;
  });
  return cerradas.length ? Number(cerradas[cerradas.length - 1].horom_fin) : 0;
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

/**
 * Recalcula el horómetro de todos los equipos a partir de las tarjas que
 * quedaron. Sirve para dejar consistente después de limpiar datos de prueba.
 */
function recalcularHorometros_(aplicar) {
  var cambios = activos_('EQUIPOS').map(function (e) {
    return {
      equipo: e.equipo, _fila: e._fila,
      actual: Number(e.horom_actual || 0),
      correcto: horomSegunTarjas_(e.equipo)
    };
  }).filter(function (c) { return c.actual !== c.correcto; });

  if (!aplicar) {
    return { simulacion: true, se_corregirian: cambios.map(function (c) {
      return c.equipo + ': ' + c.actual + ' -> ' + c.correcto;
    }) };
  }
  cambios.forEach(function (c) {
    actualizar_('EQUIPOS', c._fila, { horom_actual: c.correcto });
    log_('mantenimiento', 'RECALCULO_HOROMETRO',
         c.equipo + ': ' + c.actual + ' -> ' + c.correcto, 'sin tarjas que lo respalden');
  });
  return { simulacion: false, corregidos: cambios.length };
}
