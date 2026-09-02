/**
 * Tarja Diaria y Checklist de Equipos — Obra Corrientes
 * Configuración central: nombres de hojas, encabezados esperados y constantes.
 *
 * Toda la política editable (ítems del checklist, motivos de detención, equipos)
 * vive en la planilla, no acá. Este archivo solo define la ESTRUCTURA que la app
 * espera encontrar, para poder auto-diagnosticar desvíos.
 */

var PROP = PropertiesService.getScriptProperties();

var CFG = {
  MAX_HORAS_JORNADA: 14,
  DIAS_PENDIENTE_ALERTA: 7,
  PANEL_SESION_HORAS: 8,
  PIN_MAX_INTENTOS: 5,
  PIN_BLOQUEO_MIN: 15,
  TZ: 'America/Argentina/Buenos_Aires'
};

/**
 * Estructura esperada de la planilla.
 * El orden de las columnas ES el contrato: si alguien renombra o reordena,
 * diagnosticar() lo detecta y el panel lo muestra en vez de fallar en silencio.
 */
var HOJAS = {
  TARJAS: [
    'id', 'equipo', 'fecha', 'estado', 'operador',
    'horom_ini', 'horom_fin', 'horas',
    'foto_monitor', 'foto_horom_ini', 'foto_horom_fin',
    'horom_ini_sugerido', 'correccion_horom', 'motivo_correccion', 'excepcion',
    'firma', 'lat', 'lon',
    'ts_apertura', 'ts_cierre', 'ts_firma',
    'anulada_ts', 'anulada_por', 'anulada_motivo'
  ],
  CHECKLIST_RESP: [
    'id', 'tarja_id', 'equipo', 'fecha', 'orden', 'item', 'estado',
    'foto', 'comentario', 'ts'
  ],
  CHECKLIST_ITEMS: [
    'orden', 'equipo', 'item', 'frecuencia', 'activo'
  ],
  DETENCIONES: [
    'id', 'tarja_id', 'equipo', 'fecha', 'motivo', 'imputable', 'horas', 'ts'
  ],
  PENDIENTES: [
    'id', 'tarja_id', 'equipo', 'fecha_apertura', 'orden', 'item',
    'comentario', 'foto', 'estado', 'fecha_cierre', 'motivo_cierre', 'cerrado_por'
  ],
  MOTIVOS: [
    'motivo', 'imputable', 'activo'
  ],
  EQUIPOS: [
    'equipo', 'tipo', 'token_dispositivo', 'consumo_min', 'consumo_max',
    'proximo_service', 'horom_actual', 'activo'
  ],
  OPERADORES: [
    'nombre', 'equipo', 'activo'
  ],
  LOG: [
    'ts', 'usuario', 'accion', 'detalle', 'motivo'
  ]
};

/** Datos semilla. Todo editable después desde la planilla o el panel. */
var SEED = {
  EQUIPOS: [
    ['PC200', 'oruga', '', 12, 18, '', 0, 'SI'],
    ['HIDROMEK', 'rodante', '', 10, 16, '', 0, 'SI']
  ],
  CHECKLIST_ITEMS: [
    [1, '', 'Pérdidas visibles bajo la máquina', 'diaria', 'SI'],
    [2, '', 'Mangueras y conexiones hidráulicas', 'diaria', 'SI'],
    [3, '', 'Dientes, portadientes y cuchilla', 'diaria', 'SI'],
    [4, '', 'Engrase de pluma, brazo y balde', 'diaria', 'SI'],
    [5, 'PC200', 'Tren de rodaje: cadenas, rodillos y zapatas', 'diaria', 'SI'],
    [5, 'HIDROMEK', 'Neumáticos y estado de cubiertas', 'diaria', 'SI'],
    [6, '', 'Seguridad de cabina: cinturón, matafuego, alarma de retroceso y luces', 'diaria', 'SI']
  ],
  MOTIVOS: [
    ['Lluvia', 'EXTERNA', 'SI'],
    ['Falta de frente de trabajo', 'COMITENTE', 'SI'],
    ['Orden de la conducción de obra', 'COMITENTE', 'SI'],
    ['Espera de otro equipo', 'COMITENTE', 'SI'],
    ['Rotura del equipo', 'INGECO', 'SI'],
    ['Falta de combustible', 'INGECO', 'SI'],
    ['Falta de operador', 'COMITENTE', 'SI'],
    ['Feriado o parada programada', 'EXTERNA', 'SI'],
    ['Otro', 'A_CLASIFICAR', 'SI']
  ]
};

var MOTIVO_CIERRE_PENDIENTE = ['Reparado', 'Repuesto pedido', 'Sin acción'];

// ---------- helpers de propiedades ----------

function prop_(k) { return PROP.getProperty(k); }
function setProp_(k, v) { PROP.setProperty(k, String(v)); }

function ss_() {
  var id = prop_('SHEET_ID');
  if (!id) throw new Error('La planilla todavía no fue creada. Ejecutá el setup.');
  return SpreadsheetApp.openById(id);
}

function carpeta_() {
  var id = prop_('DRIVE_FOLDER_ID');
  if (!id) throw new Error('La carpeta de Drive todavía no fue creada. Ejecutá el setup.');
  return DriveApp.getFolderById(id);
}

/** Fecha/hora SIEMPRE del servidor, nunca del dispositivo. */
function ahora_() { return new Date(); }
function hoyStr_() { return Utilities.formatDate(ahora_(), CFG.TZ, 'yyyy-MM-dd'); }
function tsStr_() { return Utilities.formatDate(ahora_(), CFG.TZ, 'yyyy-MM-dd HH:mm:ss'); }
function uuid_() { return Utilities.getUuid(); }
