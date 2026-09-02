/**
 * Fotos a Drive. Carpeta por equipo / año-mes, nombre fecha-equipo-tipo.
 *
 * El sello (fecha, hora, equipo, coordenadas) se quema en el pixel del lado del
 * cliente, antes de subir: así viaja dentro de la imagen y no en metadata que
 * cualquiera puede discutir o que Drive puede recomprimir.
 */

function subcarpeta_(equipo, fecha) {
  var raiz = carpeta_();
  var anioMes = String(fecha).substring(0, 7); // yyyy-MM
  return subcarpetaDe_(subcarpetaDe_(raiz, equipo), anioMes);
}

function subcarpetaDe_(padre, nombre) {
  var it = padre.getFoldersByName(nombre);
  return it.hasNext() ? it.next() : padre.createFolder(nombre);
}

/**
 * @param {string} dataUrl  "data:image/jpeg;base64,...."
 * @param {string} equipo
 * @param {string} fecha    yyyy-MM-dd
 * @param {string} tipo     monitor | horometro-ini | horometro-fin | item-3 | firma
 * @return {string} URL del archivo en Drive
 */
function guardarFoto_(dataUrl, equipo, fecha, tipo) {
  if (!dataUrl) return '';
  var m = String(dataUrl).match(/^data:(image\/[a-z+]+);base64,(.+)$/i);
  if (!m) throw new Error('La foto llegó en un formato que no se puede leer.');
  var mime = m[1];
  var ext = mime.indexOf('png') !== -1 ? 'png' : 'jpg';
  var bytes = Utilities.base64Decode(m[2]);
  var nombre = fecha + '-' + equipo + '-' + tipo + '-' + uuid_().substring(0, 8) + '.' + ext;
  var blob = Utilities.newBlob(bytes, mime, nombre);
  var archivo = subcarpeta_(equipo, fecha).createFile(blob);
  return archivo.getUrl();
}
