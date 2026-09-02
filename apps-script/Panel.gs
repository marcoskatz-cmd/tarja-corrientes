/**
 * Panel de control: acceso por PIN y facultades exclusivas.
 *
 * Roles:
 *  - admin  : todo (anular tarja, corregir horómetro, cerrar pendientes, editar listas)
 *  - taller : lectura de pendientes y alertas. No anula ni autoriza nada.
 *
 * Los PIN se guardan hasheados en Script Properties, nunca en el repo.
 */

var CACHE = CacheService.getScriptCache();

function hash_(s) {
  return Utilities.base64Encode(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(s), Utilities.Charset.UTF_8)
  );
}

function definirPin_(rol, pin) {
  if (!/^\d{4}$/.test(String(pin))) throw new Error('El PIN tiene que ser de 4 dígitos.');
  setProp_('PIN_' + rol.toUpperCase(), hash_(pin));
}

/**
 * Las sesiones van en Script Properties, no en CacheService: el caché lo puede
 * vaciar Google cuando quiere, así que la sesión de 8 h no estaba garantizada y
 * al panel se le caía la sesión sin motivo aparente.
 * El contador de intentos fallidos sí puede vivir en caché: si se pierde, lo
 * único que pasa es que el bloqueo arranca de nuevo.
 */
function purgarSesiones_() {
  var ahora = ahora_().getTime();
  var todas = PROP.getProperties();
  Object.keys(todas).forEach(function (k) {
    if (k.indexOf('SES_') !== 0) return;
    try {
      if (Number(JSON.parse(todas[k]).exp) < ahora) PROP.deleteProperty(k);
    } catch (e) {
      PROP.deleteProperty(k);
    }
  });
}

function login_(p) {
  var pin = String(p.pin || '');
  var claveIntentos = 'intentos';
  var intentos = Number(CACHE.get(claveIntentos) || 0);
  if (intentos >= CFG.PIN_MAX_INTENTOS) {
    throw new Error('Demasiados intentos fallidos. Probá de nuevo en ' + CFG.PIN_BLOQUEO_MIN + ' minutos.');
  }

  var h = hash_(pin);
  var rol = null;
  if (prop_('PIN_ADMIN') && h === prop_('PIN_ADMIN')) rol = 'admin';
  else if (prop_('PIN_TALLER') && h === prop_('PIN_TALLER')) rol = 'taller';

  if (!rol) {
    CACHE.put(claveIntentos, String(intentos + 1), CFG.PIN_BLOQUEO_MIN * 60);
    throw new Error('PIN incorrecto.');
  }
  CACHE.remove(claveIntentos);
  purgarSesiones_();

  var token = uuid_();
  setProp_('SES_' + token, JSON.stringify({
    rol: rol,
    exp: ahora_().getTime() + CFG.PANEL_SESION_HORAS * 3600000
  }));
  log_(rol, 'LOGIN_PANEL', '', '');
  return { token: token, rol: rol, horas: CFG.PANEL_SESION_HORAS };
}

function sesion_(p, rolRequerido) {
  var crudo = p.token ? prop_('SES_' + p.token) : null;
  var s = null;
  try { s = crudo ? JSON.parse(crudo) : null; } catch (e) { s = null; }
  if (!s || Number(s.exp) < ahora_().getTime()) {
    if (crudo) PROP.deleteProperty('SES_' + p.token);
    throw new Error('La sesión venció. Ingresá el PIN de nuevo.');
  }
  if (rolRequerido === 'admin' && s.rol !== 'admin') {
    throw new Error('Esta acción es exclusiva de administración.');
  }
  return s.rol;
}

/** Días calendario distintos: una fecha con dos jornadas sigue siendo un día. */
function diasDistintos_(tarjas) {
  var d = {};
  tarjas.forEach(function (t) { d[String(t.fecha)] = true; });
  return Object.keys(d).length;
}

// ---------- vistas ----------

/** Hoy: estado de los dos equipos en una línea. */
function panelHoy_(p) {
  sesion_(p);
  var fecha = hoyStr_();
  var pend = leer_('PENDIENTES').filter(function (x) { return String(x.estado) === 'abierto'; });
  return {
    fecha: fecha,
    diagnostico: diagnosticar_(),
    equipos: activos_('EQUIPOS').map(function (e) {
      var delDia = tarjasDelDia_(e.equipo, fecha);
      var ids = {};
      delDia.forEach(function (t) { ids[String(t.id)] = true; });
      var problemas = leer_('CHECKLIST_RESP').filter(function (r) {
        return ids[String(r.tarja_id)] && String(r.estado) === 'PROBLEMA';
      });
      var abierta = delDia.filter(function (t) { return String(t.estado) === 'abierta'; })[0];
      return {
        equipo: e.equipo,
        tipo: e.tipo,
        // Con varias jornadas por día, el estado del equipo es el de la jornada
        // en curso; si no hay ninguna abierta, importa si hubo alguna cerrada.
        estado: abierta ? 'abierta' : (delDia.length ? 'cerrada' : 'faltante'),
        jornadas: delDia.length,
        horas: delDia.reduce(function (s, t) { return s + Number(t.horas || 0); }, 0),
        excepcion: delDia.some(function (t) { return String(t.excepcion) === 'SI'; }),
        problemas_hoy: problemas.length,
        pendientes_abiertos: pend.filter(function (x) {
          return String(x.equipo) === String(e.equipo);
        }).length
      };
    })
  };
}

/** Alertas y pendientes: todo lo declarado como problema y todavía abierto. */
function panelPendientes_(p) {
  sesion_(p);
  var hoy = new Date(hoyStr_());
  return leer_('PENDIENTES')
    .filter(function (x) { return String(x.estado) === 'abierto'; })
    .map(function (x) {
      var apertura = new Date(String(x.fecha_apertura));
      var dias = Math.round((hoy - apertura) / 86400000);
      return {
        id: x.id, equipo: x.equipo, item: x.item, comentario: x.comentario,
        foto: x.foto, fecha_apertura: String(x.fecha_apertura),
        dias_abierto: dias, vencido: dias >= CFG.DIAS_PENDIENTE_ALERTA
      };
    })
    .sort(function (a, b) { return b.dias_abierto - a.dias_abierto; });
}

function cerrarPendiente_(p) {
  var rol = sesion_(p, 'admin');
  var x = buscarPorId_('PENDIENTES', p.id);
  if (!x) throw new Error('No se encontró el pendiente.');
  if (String(x.estado) !== 'abierto') throw new Error('Ese pendiente ya estaba cerrado.');
  if (MOTIVO_CIERRE_PENDIENTE.indexOf(p.motivo) === -1) {
    throw new Error('El motivo de cierre no es válido.');
  }
  actualizar_('PENDIENTES', x._fila, {
    estado: 'cerrado', fecha_cierre: hoyStr_(),
    motivo_cierre: p.motivo, cerrado_por: rol
  });
  log_(rol, 'CIERRE_PENDIENTE', x.equipo + ' — ' + x.item, p.motivo);
  return { ok: true };
}

/** Ficha del equipo: horómetro, horas del mes, disponibilidad, historial de fotos. */
function panelEquipo_(p) {
  sesion_(p);
  var e = equipoPorNombre_(p.equipo);
  var mes = String(p.mes || hoyStr_().substring(0, 7));
  var tarjas = leer_('TARJAS').filter(function (t) {
    return String(t.equipo) === String(e.equipo) &&
           String(t.fecha).indexOf(mes) === 0 &&
           String(t.estado) !== 'anulada';
  });
  var horas = tarjas.reduce(function (s, t) { return s + Number(t.horas || 0); }, 0);
  return {
    equipo: e.equipo, tipo: e.tipo, mes: mes,
    horom_actual: Number(e.horom_actual || 0),
    proximo_service: e.proximo_service,
    consumo_banda: [Number(e.consumo_min || 0), Number(e.consumo_max || 0)],
    horas_mes: horas,
    jornadas_mes: tarjas.length,
    dias_con_tarja: diasDistintos_(tarjas),
    historial: tarjas.sort(function (a, b) {
      return String(a.fecha) < String(b.fecha) ? 1 : -1;
    }).map(function (t) {
      return {
        id: t.id,
        fecha: String(t.fecha), estado: t.estado, horas: t.horas,
        operador: t.operador, excepcion: String(t.excepcion) === 'SI',
        motivo_correccion: t.motivo_correccion,
        foto_monitor: t.foto_monitor,
        foto_horom_ini: t.foto_horom_ini, foto_horom_fin: t.foto_horom_fin
      };
    })
  };
}

/**
 * Certificación: consolidado mensual que se cruza contra el certificado de
 * prestaciones. Al certificarse por hora efectiva, la prueba son las horas de
 * horómetro; las detenciones se sacaron del alcance por decisión de Marcos.
 */
function panelCertificacion_(p) {
  sesion_(p);
  var mes = String(p.mes || hoyStr_().substring(0, 7));
  return {
    mes: mes,
    equipos: activos_('EQUIPOS').map(function (e) {
      var tarjas = leer_('TARJAS').filter(function (t) {
        return String(t.equipo) === String(e.equipo) &&
               String(t.fecha).indexOf(mes) === 0 &&
               String(t.estado) !== 'anulada';
      });
      return {
        equipo: e.equipo,
        horas_trabajadas: tarjas.reduce(function (s, t) { return s + Number(t.horas || 0); }, 0),
        jornadas: tarjas.length,
        dias_con_tarja: diasDistintos_(tarjas),
        dias_sin_firmar: tarjas.filter(function (t) { return String(t.estado) === 'abierta'; }).length,
        jornadas_excepcion: tarjas.filter(function (t) { return String(t.excepcion) === 'SI'; }).length
      };
    })
  };
}

// ---------- facultades exclusivas ----------

function anularTarja_(p) {
  var rol = sesion_(p, 'admin');
  var motivo = String(p.motivo || '').trim();
  if (!motivo) throw new Error('Para anular hay que indicar el motivo.');
  var t = buscarPorId_('TARJAS', p.tarja_id);
  if (!t) throw new Error('No se encontró la tarja.');
  if (String(t.estado) === 'anulada') throw new Error('Esa tarja ya estaba anulada.');
  actualizar_('TARJAS', t._fila, {
    estado: 'anulada', anulada_ts: tsStr_(), anulada_por: rol, anulada_motivo: motivo
  });
  log_(rol, 'ANULACION_TARJA', t.equipo + ' ' + String(t.fecha), motivo);
  return { ok: true };
}

function corregirHorometro_(p) {
  var rol = sesion_(p, 'admin');
  var motivo = String(p.motivo || '').trim();
  if (!motivo) throw new Error('Para corregir el horómetro hay que indicar el motivo.');
  var e = equipoPorNombre_(p.equipo);
  var valor = Number(p.valor);
  if (!isFinite(valor) || valor < 0) throw new Error('El valor no es válido.');
  var anterior = Number(e.horom_actual || 0);
  actualizar_('EQUIPOS', e._fila, { horom_actual: valor });
  log_(rol, 'CORRECCION_HOROMETRO_PANEL', e.equipo + ': ' + anterior + ' -> ' + valor, motivo);
  return { ok: true, anterior: anterior, actual: valor };
}

/** Vincula el celular al equipo. Queda registrado en el LOG. */
function vincularDispositivo_(p) {
  var equipo = equipoPorNombre_(p.equipo);
  var token = String(p.dispositivo || '').trim();
  if (!token) throw new Error('Falta el identificador del dispositivo.');
  var anterior = String(equipo.token_dispositivo || '');
  actualizar_('EQUIPOS', equipo._fila, { token_dispositivo: token });
  log_('operador', 'VINCULO_DISPOSITIVO',
    equipo.equipo + ': ' + (anterior ? anterior.substring(0, 8) + '… -> ' : '') + token.substring(0, 8) + '…', '');
  return { ok: true, equipo: equipo.equipo };
}
