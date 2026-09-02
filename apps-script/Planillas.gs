/**
 * Acceso a la planilla: creación, lectura/escritura tipada y auto-diagnóstico.
 *
 * Nadie más en el proyecto toca getRange/getValues directamente. Todo pasa por acá,
 * así el día que una columna cambia de lugar se arregla en un solo archivo.
 */

// ---------- setup ----------

/**
 * Crea planilla, carpeta de Drive y datos semilla. Idempotente:
 * si ya existen, solo completa lo que falte.
 */
function setupCompleto_() {
  var creado = { planilla: false, carpeta: false, hojas: [] };

  if (!prop_('SHEET_ID')) {
    var nueva = SpreadsheetApp.create('TARJA CORRIENTES — Base de datos');
    setProp_('SHEET_ID', nueva.getId());
    // La hoja por defecto sobra: las nuestras se crean abajo.
    creado.planilla = true;
  }
  if (!prop_('DRIVE_FOLDER_ID')) {
    var f = DriveApp.createFolder('TARJA CORRIENTES — Fotos');
    setProp_('DRIVE_FOLDER_ID', f.getId());
    creado.carpeta = true;
  }

  var ss = ss_();
  Object.keys(HOJAS).forEach(function (nombre) {
    var sh = ss.getSheetByName(nombre);
    if (!sh) {
      sh = ss.insertSheet(nombre);
      creado.hojas.push(nombre);
    }
    var enc = HOJAS[nombre];
    if (sh.getLastRow() === 0) {
      sh.getRange(1, 1, 1, enc.length).setValues([enc]);
      sh.setFrozenRows(1);
      sh.getRange(1, 1, 1, enc.length).setFontWeight('bold');
    }
    if (SEED[nombre] && sh.getLastRow() === 1) {
      sh.getRange(2, 1, SEED[nombre].length, SEED[nombre][0].length).setValues(SEED[nombre]);
    }
  });

  // Sacar la "Hoja 1" que Sheets crea sola, solo si quedó vacía y hay otras.
  var sobrante = ss.getSheets().filter(function (s) {
    return !HOJAS[s.getName()];
  });
  if (sobrante.length && ss.getSheets().length > sobrante.length) {
    sobrante.forEach(function (s) {
      if (s.getLastRow() === 0) ss.deleteSheet(s);
    });
  }

  return {
    creado: creado,
    sheetId: prop_('SHEET_ID'),
    sheetUrl: ss.getUrl(),
    folderId: prop_('DRIVE_FOLDER_ID'),
    diagnostico: diagnosticar_()
  };
}

// ---------- auto-diagnóstico ----------

/**
 * Compara los encabezados reales contra los esperados.
 * Devuelve la lista de desvíos: el panel la muestra arriba de todo
 * en vez de dejar que la app falle en silencio.
 */
function diagnosticar_() {
  var ss = ss_();
  var problemas = [];
  Object.keys(HOJAS).forEach(function (nombre) {
    var sh = ss.getSheetByName(nombre);
    if (!sh) {
      problemas.push({ hoja: nombre, tipo: 'FALTA_HOJA', detalle: 'La hoja no existe' });
      return;
    }
    var esperado = HOJAS[nombre];
    var real = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), esperado.length))
      .getValues()[0].map(function (v) { return String(v || '').trim(); });
    esperado.forEach(function (col, i) {
      if (real[i] !== col) {
        problemas.push({
          hoja: nombre,
          tipo: 'COLUMNA',
          detalle: 'Se esperaba "' + col + '" en la columna ' + (i + 1) +
                   ' y hay "' + (real[i] || '(vacía)') + '"'
        });
      }
    });
  });
  return problemas;
}

// ---------- lectura / escritura ----------

function hoja_(nombre) {
  var sh = ss_().getSheetByName(nombre);
  if (!sh) throw new Error('Falta la hoja ' + nombre + ' en la planilla.');
  return sh;
}

/** Devuelve todas las filas como objetos {columna: valor}, más _fila (1-based). */
function leer_(nombre) {
  var sh = hoja_(nombre);
  var ultima = sh.getLastRow();
  if (ultima < 2) return [];
  var cols = HOJAS[nombre];
  var datos = sh.getRange(2, 1, ultima - 1, cols.length).getValues();
  return datos.map(function (fila, i) {
    var o = { _fila: i + 2 };
    cols.forEach(function (c, j) { o[c] = fila[j]; });
    return o;
  });
}

/** Agrega una fila a partir de un objeto, respetando el orden de columnas. */
function agregar_(nombre, obj) {
  var sh = hoja_(nombre);
  var fila = HOJAS[nombre].map(function (c) {
    return obj[c] === undefined || obj[c] === null ? '' : obj[c];
  });
  sh.appendRow(fila);
  return fila;
}

/** Actualiza campos puntuales de una fila ya existente. */
function actualizar_(nombre, numeroFila, cambios) {
  var sh = hoja_(nombre);
  var cols = HOJAS[nombre];
  Object.keys(cambios).forEach(function (k) {
    var idx = cols.indexOf(k);
    if (idx === -1) throw new Error('Columna desconocida "' + k + '" en ' + nombre);
    sh.getRange(numeroFila, idx + 1).setValue(cambios[k]);
  });
}

function buscarPorId_(nombre, id) {
  var filas = leer_(nombre);
  for (var i = 0; i < filas.length; i++) {
    if (String(filas[i].id) === String(id)) return filas[i];
  }
  return null;
}

function activos_(nombre) {
  return leer_(nombre).filter(function (r) {
    return String(r.activo).toUpperCase() === 'SI';
  });
}

// ---------- log ----------

function log_(usuario, accion, detalle, motivo) {
  agregar_('LOG', {
    ts: tsStr_(),
    usuario: usuario || '',
    accion: accion || '',
    detalle: typeof detalle === 'string' ? detalle : JSON.stringify(detalle || ''),
    motivo: motivo || ''
  });
}
