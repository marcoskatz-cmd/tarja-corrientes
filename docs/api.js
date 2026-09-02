/**
 * Cliente de la API + cola offline.
 *
 * Las fotos son pesadas y la señal en obra es mala: la cola vive en IndexedDB
 * (localStorage no aguanta) y sobrevive a que el operario cierre la app o se
 * quede sin batería.
 *
 * Cada operación lleva un `op_id` propio que NO cambia entre reintentos. El
 * backend lo usa para reconocer un envío repetido: si la carga llegó y lo que
 * se cortó fue la respuesta, el reintento devuelve la misma tarja en vez de
 * crear una segunda.
 */

const API_URL = window.TARJA_API_URL;

// ---------- HTTP ----------

const SIN_SEÑAL = 'No se pudo conectar con el servidor.';

async function llamar(action, datos = {}) {
  let r;
  try {
    r = await fetch(API_URL, {
      method: 'POST',
      // text/plain evita el preflight CORS, que Apps Script no contesta.
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, ...datos })
    });
  } catch (e) {
    // Sin red, fetch tira un TypeError, no devuelve una respuesta fallada.
    // Si esto no se traduce a SIN_SEÑAL, la cola offline nunca se activa y el
    // operario pierde la carga justo cuando más falta le hace guardarla.
    throw new Error(SIN_SEÑAL);
  }
  if (!r.ok) throw new Error(SIN_SEÑAL);
  let j;
  try {
    j = await r.json();
  } catch (e) {
    // Respuesta cortada a la mitad: tampoco es un rechazo del servidor.
    throw new Error(SIN_SEÑAL);
  }
  if (!j.ok) throw new Error(j.error || 'Ocurrió un error inesperado.');
  return j.data;
}

// ---------- IndexedDB ----------

const DB_NOMBRE = 'tarja-corrientes';
const STORE = 'cola';

function abrirDB() {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB_NOMBRE, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore(STORE, { keyPath: 'id' }); };
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(new Error('No se pudo abrir el almacenamiento local.'));
  });
}

async function conStore(modo, fn) {
  const db = await abrirDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, modo);
    const out = fn(tx.objectStore(STORE));
    tx.oncomplete = () => res(out && out.result !== undefined ? out.result : out);
    tx.onerror = () => rej(new Error('Falló el almacenamiento local.'));
  });
}

async function encolar(action, datos, equipo) {
  const item = { id: datos.op_id, action, datos, equipo, ts: Date.now() };
  await conStore('readwrite', (s) => s.put(item));
  return item;
}

async function pendientesEnCola() {
  const items = await conStore('readonly', (s) => s.getAll());
  return (items || []).sort((a, b) => a.ts - b.ts);
}

async function sacarDeCola(id) {
  return conStore('readwrite', (s) => s.delete(id));
}

// ---------- sincronización ----------

const oyentes = [];
/** Para que la pantalla pueda mostrar cuántas cargas quedan sin enviar. */
function alCambiarCola(fn) { oyentes.push(fn); }
async function avisar() {
  const p = await pendientesEnCola();
  oyentes.forEach((fn) => fn(p));
}

let sincronizando = false;

/**
 * Envía lo que haya en cola, en orden. Si falla por red se corta y se reintenta
 * después; si el servidor lo rechaza por una regla, se descarta con aviso
 * (reintentarlo eternamente no lo va a arreglar).
 */
async function sincronizar(alAvisar) {
  if (sincronizando) return false;
  sincronizando = true;
  try {
    const items = await pendientesEnCola();
    for (const it of items) {
      try {
        await llamar(it.action, it.datos);
        await sacarDeCola(it.id);
        alAvisar && alAvisar({ tipo: 'ok', item: it });
      } catch (e) {
        if (e.message === SIN_SEÑAL) {
          alAvisar && alAvisar({ tipo: 'sin_señal' });
          return false;
        }
        await sacarDeCola(it.id);
        alAvisar && alAvisar({ tipo: 'rechazado', item: it, error: e.message });
      }
    }
    return true;
  } finally {
    sincronizando = false;
    await avisar();
  }
}

/**
 * Manda ahora; si no hay señal, lo deja en la cola y avisa que quedó guardado.
 * El op_id se genera una sola vez y viaja con la operación: es lo que hace que
 * un reintento no duplique nada.
 */
async function enviar(action, datos, equipo) {
  const conOp = { ...datos, op_id: crypto.randomUUID() };
  try {
    const data = await llamar(action, conOp);
    return { encolado: false, data };
  } catch (e) {
    if (e.message !== SIN_SEÑAL) throw e;
    await encolar(action, conOp, equipo);
    await avisar();
    return { encolado: true };
  }
}

// Reintentar cuando vuelve la señal y cada vez que el operario vuelve a la app:
// el evento `online` solo no alcanza, miente seguido en Android.
window.addEventListener('online', () => sincronizar(() => {}));
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) sincronizar(() => {});
});

window.API = { llamar, enviar, sincronizar, pendientesEnCola, alCambiarCola, avisar };
