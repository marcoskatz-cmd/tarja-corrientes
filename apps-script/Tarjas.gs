/**
 * Ciclo de vida de la tarja: apertura, checklist, cierre y firma.
 *
 * Reglas duras que se aplican acá y en ningún otro lado:
 *  - Una sola tarja por equipo y día (LockService + chequeo, para que la cola
 *    offline no genere duplicados al reintentar).
 *  - Delta de horómetro calculado en el servidor. Se rechazan negativos y > 14 h.
 *  - Fecha y hora del servidor, nunca del dispositivo.
 *  - Tarja cerrada = congelada. Solo se anula desde el panel.
 *
 * El operador firma AL ABRIR la jornada, no al cerrarla: así queda asentado
 * quién se hizo cargo de la máquina desde el primer minuto, y el cierre se
 * reduce a la foto del horómetro final.
 */

function equipoPorNombre_(nombre) {
  var e = leer_('EQUIPOS').filter(function (r) {
    return String(r.equipo).toUpperCase() === String(nombre).toUpperCase();
  })[0];
  if (!e) throw new Error('El equipo "' + nombre + '" no está dado de alta.');
  return e;
}

function tarjaDelDia_(equipo, fecha) {
  return leer_('TARJAS').filter(function (t) {
    return String(t.equipo).toUpperCase() === String(equipo).toUpperCase() &&
           String(t.fecha) === fecha &&
           String(t.estado) !== 'anulada';
  })[0] || null;
}

/**
 * Qué le toca al operador hoy. Es lo primero que pide la PWA al abrir.
 */
function estadoDelDia_(p) {
  var equipo = equipoPorNombre_(p.equipo);
  var fecha = hoyStr_();
  var t = tarjaDelDia_(equipo.equipo, fecha);
  return {
    fecha: fecha,
    equipo: equipo.equipo,
    tipo: equipo.tipo,
    tarja: t ? tarjaPublica_(t) : null,
    paso: !t ? 'apertura' : (String(t.estado) === 'abierta' ? 'cierre' : 'listo'),
    horom_sugerido: Number(equipo.horom_actual || 0),
    items: itemsDe_(equipo.equipo, 'diaria'),
    operadores: operadoresDe_(equipo.equipo),
    ultimas: ultimasTarjas_(equipo.equipo, 5)
  };
}

function itemsDe_(equipo, frecuencia) {
  return activos_('CHECKLIST_ITEMS')
    .filter(function (i) {
      return String(i.frecuencia) === frecuencia &&
        (!String(i.equipo).trim() ||
          String(i.equipo).toUpperCase() === String(equipo).toUpperCase());
    })
    .sort(function (a, b) { return Number(a.orden) - Number(b.orden); })
    .map(function (i) { return { orden: Number(i.orden), item: String(i.item) }; });
}

/**
 * El nombre del operador es texto libre (rota personal de terceros), pero la app
 * ofrece como sugerencia los que ya firmaron en ese equipo. Se aprende sola.
 */
function operadoresDe_(equipo) {
  return activos_('OPERADORES')
    .filter(function (o) {
      return !String(o.equipo).trim() ||
        String(o.equipo).toUpperCase() === String(equipo).toUpperCase();
    })
    .map(function (o) { return String(o.nombre); });
}

function recordarOperador_(nombre, equipo) {
  nombre = String(nombre || '').trim();
  if (!nombre) return;
  var ya = leer_('OPERADORES').some(function (o) {
    return String(o.nombre).toUpperCase() === nombre.toUpperCase() &&
           String(o.equipo).toUpperCase() === String(equipo).toUpperCase();
  });
  if (!ya) agregar_('OPERADORES', { nombre: nombre, equipo: equipo, activo: 'SI' });
}

function tarjaPublica_(t) {
  return {
    id: t.id, equipo: t.equipo, fecha: String(t.fecha), estado: t.estado,
    operador: t.operador, horom_ini: t.horom_ini, horom_fin: t.horom_fin,
    horas: t.horas, excepcion: t.excepcion,
    foto_monitor: t.foto_monitor, foto_horom_ini: t.foto_horom_ini,
    foto_horom_fin: t.foto_horom_fin
  };
}

function ultimasTarjas_(equipo, n) {
  return leer_('TARJAS')
    .filter(function (t) { return String(t.equipo).toUpperCase() === String(equipo).toUpperCase(); })
    .sort(function (a, b) { return String(b.fecha) < String(a.fecha) ? -1 : 1; })
    .slice(0, n)
    .map(tarjaPublica_);
}

// ---------- apertura ----------

/**
 * Abre la jornada: foto de monitor, foto de horómetro y checklist completo,
 * todo en una sola operación atómica. Si el operador reintenta por mala señal,
 * devuelve la tarja que ya existe en vez de duplicarla.
 */
function abrirTarja_(p) {
  var equipo = equipoPorNombre_(p.equipo);
  var fecha = hoyStr_();
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var existente = tarjaDelDia_(equipo.equipo, fecha);
    if (existente) {
      return { ya_existia: true, tarja: tarjaPublica_(existente) };
    }

    var operador = String(p.operador || '').trim();
    if (operador.length < 3) throw new Error('Falta el nombre del operador.');
    if (!p.firma) throw new Error('Falta la firma del operador.');
    if (!p.foto_monitor) throw new Error('Falta la foto del monitor de cabina.');
    if (!p.foto_horometro) throw new Error('Falta la foto del horómetro.');

    var sugerido = Number(equipo.horom_actual || 0);
    var horomIni = Number(p.horom_ini);
    if (!isFinite(horomIni) || horomIni < 0) {
      throw new Error('El valor del horómetro no es un número válido.');
    }
    var corregido = Math.abs(horomIni - sugerido) > 0.001;
    if (corregido && !String(p.motivo_correccion || '').trim()) {
      throw new Error('Para corregir el horómetro hay que indicar el motivo.');
    }

    var items = itemsDe_(equipo.equipo, 'diaria');
    var respuestas = p.checklist || [];
    if (respuestas.length !== items.length) {
      throw new Error('El checklist está incompleto: faltan ítems por responder.');
    }

    var id = uuid_();
    var urlMonitor = guardarFoto_(p.foto_monitor, equipo.equipo, fecha, 'monitor');
    var urlHorom = guardarFoto_(p.foto_horometro, equipo.equipo, fecha, 'horometro-ini');
    var urlFirma = guardarFoto_(p.firma, equipo.equipo, fecha, 'firma');

    agregar_('TARJAS', {
      id: id, equipo: equipo.equipo, fecha: fecha, estado: 'abierta', operador: operador,
      horom_ini: horomIni, horom_fin: '', horas: '',
      foto_monitor: urlMonitor, foto_horom_ini: urlHorom, foto_horom_fin: '',
      horom_ini_sugerido: sugerido,
      correccion_horom: corregido ? 'SI' : 'NO',
      motivo_correccion: corregido ? String(p.motivo_correccion).trim() : '',
      excepcion: corregido ? 'SI' : 'NO',
      firma: urlFirma, lat: p.lat || '', lon: p.lon || '',
      ts_apertura: tsStr_(), ts_cierre: '', ts_firma: tsStr_(),
      anulada_ts: '', anulada_por: '', anulada_motivo: ''
    });

    respuestas.forEach(function (r) {
      var item = items.filter(function (i) { return i.orden === Number(r.orden); })[0];
      if (!item) throw new Error('Llegó una respuesta para un ítem que no existe.');
      var estado = String(r.estado).toUpperCase();
      if (estado !== 'OK' && estado !== 'PROBLEMA') {
        throw new Error('El ítem ' + r.orden + ' quedó sin responder.');
      }
      var urlFoto = '';
      if (estado === 'PROBLEMA') {
        if (!r.foto) throw new Error('El ítem "' + item.item + '" está marcado como problema y necesita foto.');
        if (!String(r.comentario || '').trim()) {
          throw new Error('El ítem "' + item.item + '" está marcado como problema y necesita un comentario.');
        }
        urlFoto = guardarFoto_(r.foto, equipo.equipo, fecha, 'item-' + item.orden);
      }
      var respId = uuid_();
      agregar_('CHECKLIST_RESP', {
        id: respId, tarja_id: id, equipo: equipo.equipo, fecha: fecha,
        orden: item.orden, item: item.item, estado: estado,
        foto: urlFoto, comentario: String(r.comentario || '').trim(), ts: tsStr_()
      });
      if (estado === 'PROBLEMA') {
        agregar_('PENDIENTES', {
          id: uuid_(), tarja_id: id, equipo: equipo.equipo, fecha_apertura: fecha,
          orden: item.orden, item: item.item,
          comentario: String(r.comentario || '').trim(), foto: urlFoto,
          estado: 'abierto', fecha_cierre: '', motivo_cierre: '', cerrado_por: ''
        });
      }
    });

    recordarOperador_(operador, equipo.equipo);

    if (corregido) {
      log_('operador', 'CORRECCION_HOROMETRO',
        equipo.equipo + ' ' + fecha + ': ' + sugerido + ' -> ' + horomIni,
        String(p.motivo_correccion).trim());
    }

    return { ya_existia: false, tarja: tarjaPublica_(buscarPorId_('TARJAS', id)) };
  } finally {
    lock.releaseLock();
  }
}

// ---------- cierre y firma ----------

/**
 * Cierra la jornada. Solo horómetro final: la firma y el operador ya quedaron
 * asentados en la apertura. Una vez cerrada, la tarja queda congelada.
 */
function cerrarTarja_(p) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var t = buscarPorId_('TARJAS', p.tarja_id);
    if (!t) throw new Error('No se encontró la tarja.');
    if (String(t.estado) === 'anulada') throw new Error('Esta tarja fue anulada desde el panel.');
    if (String(t.estado) !== 'abierta') {
      return { ya_estaba_cerrada: true, tarja: tarjaPublica_(t) };
    }
    if (!p.foto_horometro) throw new Error('Falta la foto del horómetro final.');

    var horomFin = Number(p.horom_fin);
    var horomIni = Number(t.horom_ini);
    if (!isFinite(horomFin)) throw new Error('El horómetro final no es un número válido.');
    var horas = horomFin - horomIni;
    if (horas < 0) {
      throw new Error('El horómetro final (' + horomFin + ') es menor que el de apertura (' +
        horomIni + '). Revisá el valor.');
    }
    if (horas > CFG.MAX_HORAS_JORNADA) {
      throw new Error('La diferencia da ' + horas.toFixed(1) + ' h, más de las ' +
        CFG.MAX_HORAS_JORNADA + ' h permitidas en una jornada. Revisá el valor.');
    }

    var fecha = String(t.fecha);
    var urlHorom = guardarFoto_(p.foto_horometro, t.equipo, fecha, 'horometro-fin');

    actualizar_('TARJAS', t._fila, {
      estado: 'cerrada',
      horom_fin: horomFin, horas: horas,
      foto_horom_fin: urlHorom,
      ts_cierre: tsStr_()
    });

    var eq = equipoPorNombre_(t.equipo);
    actualizar_('EQUIPOS', eq._fila, { horom_actual: horomFin });

    return {
      ya_estaba_cerrada: false,
      tarja: tarjaPublica_(buscarPorId_('TARJAS', t.id)),
      horas: horas
    };
  } finally {
    lock.releaseLock();
  }
}
