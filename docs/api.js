/**
 * Cliente de la API + cola offline.
 *
 * Las fotos son pesadas y la señal en obra es mala: la cola vive en IndexedDB
 * (localStorage no aguanta) y cada operación lleva un id propio, así reintentar
 * nunca duplica una tarja.
 */

const API_URL = window.TARJA_API_URL;

// ---------- HTTP ----------

async function llamar(action, datos = {}) {
  const r = await fetch(API_URL, {
    method: 'POST',
    // text/plain evita el preflight CORS, que Apps Script no contesta.
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action, ...datos })
  });
  if (!r.ok) throw new Error('No se pudo conectar con el servidor.');
  const j = await r.json();
  if (!j.ok) throw new Error(j.error || 'Ocurrió un error inesperado.');
  return j.data;
}

// ---------- IndexedDB ----------

const DB_NOMBRE = 'tarja-corrientes';
const STORE = 'cola';

function abrirDB() {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB_NOMBRE, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(new Error('No se pudo abrir el almacenamiento local.'));
  });
}

async function conStore(modo, fn) {
  const db = await abrirDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, modo);
    const out = fn(tx.objectStore(STORE));
    tx.oncomplete = () => res(out.result !== undefined ? out.result : out);
    tx.onerror = () => rej(new Error('Falló el almacenamiento local.'));
  });
}

async function encolar(action, datos) {
  const item = { id: crypto.randomUUID(), action, datos, ts: Date.now() };
  await conStore('readwrite', (s) => s.put(item));
  return item.id;
}

async function pendientesEnCola() {
  return conStore('readonly', (s) => s.getAll());
}

async function sacarDeCola(id) {
  return conStore('readwrite', (s) => s.delete(id));
}

/**
 * Envía lo que haya en cola, en orden. Si algo falla por red, se corta y se
 * reintenta después; si falla por una regla del servidor, se descarta con aviso
 * (reintentarlo eternamente no lo va a arreglar).
 */
async function sincronizar(alAvisar) {
  const items = (await pendientesEnCola()).sort((a, b) => a.ts - b.ts);
  for (const it of items) {
    try {
      await llamar(it.action, it.datos);
      await sacarDeCola(it.id);
      alAvisar && alAvisar({ tipo: 'ok', id: it.id });
    } catch (e) {
      if (e.message === 'No se pudo conectar con el servidor.') {
        alAvisar && alAvisar({ tipo: 'sin_señal' });
        return false;
      }
      await sacarDeCola(it.id);
      alAvisar && alAvisar({ tipo: 'rechazado', error: e.message });
    }
  }
  return true;
}

/** Manda ahora; si no hay señal, encola y avisa que quedó guardado. */
async function enviar(action, datos) {
  if (!navigator.onLine) {
    await encolar(action, datos);
    return { encolado: true };
  }
  try {
    const data = await llamar(action, datos);
    return { encolado: false, data };
  } catch (e) {
    if (e.message === 'No se pudo conectar con el servidor.') {
      await encolar(action, datos);
      return { encolado: true };
    }
    throw e;
  }
}

window.API = { llamar, enviar, sincronizar, pendientesEnCola };
