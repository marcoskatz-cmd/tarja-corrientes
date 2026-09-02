/**
 * PWA del operador.
 *
 * Criterio: una sola cosa en pantalla por vez, el botón de avanzar aparece
 * solamente cuando el paso está completo, y nada de texto libre donde alcance
 * con elegir. El objetivo es que alguien que nunca la vio termine en menos de
 * un minuto sin leer nada.
 *
 * Orden de la jornada:
 *   Apertura → nombre y firma → foto del monitor → foto del horómetro con el
 *              valor tipeado debajo → checklist
 *   Cierre   → foto del horómetro con el valor tipeado debajo
 *
 * Se pueden abrir varias jornadas en el mismo día, de a una por vez: hay que
 * cerrar la anterior antes de empezar otra.
 */

const app = document.getElementById('app');
const colaAviso = document.getElementById('colaAviso');
const hEquipo = document.getElementById('hEquipo');
const hFecha = document.getElementById('hFecha');
const btnCambiar = document.getElementById('btnCambiar');

const EQUIPOS = ['PC200', 'HIDROMEK'];

let estado = null;      // respuesta de la API
let borrador = null;    // lo que el operador viene cargando

// ---------- utilidades ----------

function dispositivo() {
  let d = localStorage.getItem('dispositivo');
  if (!d) { d = crypto.randomUUID(); localStorage.setItem('dispositivo', d); }
  return d;
}
function equipoElegido() { return localStorage.getItem('equipo'); }

function pintar(html) { app.innerHTML = html; }

function aviso(tipo, texto) {
  return `<div class="aviso ${tipo}">${texto}</div>`;
}

function conError(fn) {
  return async (...args) => {
    try { await fn(...args); }
    catch (e) {
      const arriba = document.createElement('div');
      arriba.className = 'aviso error';
      arriba.textContent = e.message;
      app.prepend(arriba);
      window.scrollTo(0, 0);
    }
  };
}

/**
 * La hora exacta la pone el backend al guardar. Acá solo sellamos la de
 * referencia del dispositivo junto a la fecha del servidor, que es la que manda.
 */
function horaLocalDelServidor() {
  const d = new Date();
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

// ---------- cargas guardadas sin señal ----------

function pintarCola(pendientes) {
  if (!pendientes.length) { colaAviso.hidden = true; return; }
  colaAviso.hidden = false;
  const n = pendientes.length;
  colaAviso.innerHTML = `
    <span>${n} carga${n === 1 ? '' : 's'} guardada${n === 1 ? '' : 's'} en el celular,
      sin enviar todavía.</span>
    <button id="btnEnviarCola">Enviar ahora</button>`;
  document.getElementById('btnEnviarCola').onclick = async (ev) => {
    ev.target.disabled = true;
    ev.target.textContent = 'Enviando…';
    const ok = await API.sincronizar(() => {});
    if (ok) iniciar(); else { ev.target.disabled = false; ev.target.textContent = 'Enviar ahora'; }
  };
}
API.alCambiarCola(pintarCola);

// ---------- arranque ----------

async function iniciar() {
  const eq = equipoElegido();
  if (!eq) return pantallaSelector();
  btnCambiar.hidden = false;
  btnCambiar.onclick = pantallaSelector;
  hEquipo.textContent = eq;
  pintar('<div class="cargando">Cargando…</div>');

  // Antes que nada, mandar lo que haya quedado en cola sin señal.
  await API.sincronizar(() => {});
  const cola = await API.pendientesEnCola();
  pintarCola(cola);

  // Si la carga de este equipo todavía está en cola, el servidor no la conoce y
  // diría "abrí la jornada" de nuevo. Hay que frenar acá, o el operario carga
  // todo dos veces.
  const propia = cola.filter((c) => c.equipo === eq);
  if (propia.length) return pantallaEnCola(propia[0]);

  try {
    estado = await API.llamar('estado', { equipo: eq });
  } catch (e) {
    const cola = await API.pendientesEnCola();
    return pintar(
      aviso('alerta', 'Sin conexión.' + (cola.length
        ? ` Hay ${cola.length} carga(s) guardada(s) en el celular; se van a enviar solas cuando vuelva la señal.`
        : ' Volvé a intentar cuando tengas señal.')) +
      `<button class="principal" onclick="location.reload()">Reintentar</button>`
    );
  }

  hFecha.textContent = estado.fecha;
  if (estado.paso === 'apertura') return aperturaIdentidad();
  if (estado.paso === 'cierre') return cierreFoto();
  return pantallaListo();  // jornadas cerradas hoy, ninguna abierta
}

// ---------- selector de equipo ----------

function pantallaSelector() {
  btnCambiar.hidden = true;
  hEquipo.textContent = 'Elegí el equipo';
  hFecha.textContent = '';
  pintar(`
    <h2>¿En qué máquina estás?</h2>
    <p class="ayuda">Se guarda en este celular. Solo hay que elegirlo la primera vez.</p>
    <div class="grande">
      ${EQUIPOS.map((e) => `<button data-eq="${e}">${e}</button>`).join('')}
    </div>
  `);
  app.querySelectorAll('[data-eq]').forEach((b) => {
    b.onclick = conError(async () => {
      const eq = b.dataset.eq;
      localStorage.setItem('equipo', eq);
      try { await API.llamar('vincular', { equipo: eq, dispositivo: dispositivo() }); }
      catch (e) { /* el vínculo es informativo: si no hay señal, no bloquea */ }
      iniciar();
    });
  });
}

// ---------- cámara ----------

/**
 * Cámara en vivo con una indicación corta. La galería no se ofrece a propósito:
 * la foto tiene que ser del momento.
 */
function pantallaCamara({ titulo, indicacion, alTomar, conValor }) {
  pintar(`
    <h2>${titulo}</h2>
    <div class="camara tarjeta" style="padding:0">
      <video id="vid" playsinline muted></video>
      <div class="indicacion">${indicacion}</div>
    </div>
    <button class="principal" id="btnFoto" disabled>Preparando cámara…</button>
  `);
  const vid = document.getElementById('vid');
  const btn = document.getElementById('btnFoto');

  Camara.abrirCamara(vid).then(() => {
    btn.disabled = false;
    btn.textContent = 'Sacar la foto';
  }).catch(() => {
    pintar(
      aviso('error', 'No se pudo abrir la cámara. Revisá que le hayas dado permiso a la app.') +
      `<button class="principal" onclick="location.reload()">Reintentar</button>`
    );
  });

  btn.onclick = conError(async () => {
    const foto = Camara.capturar(vid, estado.equipo, estado.fecha + ' ' + horaLocalDelServidor());
    Camara.cerrarCamara();
    const volver = () => pantallaCamara({ titulo, indicacion, alTomar, conValor });
    if (conValor) return conValor(foto, volver);
    confirmarFoto(foto, titulo, alTomar, volver);
  });
}

function confirmarFoto(foto, titulo, alAceptar, alRepetir) {
  pintar(`
    <h2>${titulo}</h2>
    <p class="ayuda">¿Se lee bien? Si no, repetila.</p>
    <img class="previa" src="${foto}" alt="Foto tomada">
    <div style="height:.9rem"></div>
    <button class="principal" id="ok">Sí, continuar</button>
    <div style="height:.5rem"></div>
    <button class="secundaria" id="rep">Repetir la foto</button>
  `);
  document.getElementById('ok').onclick = conError(() => alAceptar(foto));
  document.getElementById('rep').onclick = alRepetir;
}

// ---------- apertura: nombre y firma ----------

function aperturaIdentidad() {
  borrador = { checklist: [] };
  pintar(`
    <h2>¿Quién maneja hoy?</h2>
    <p class="ayuda">Se carga una sola vez, al empezar la jornada.</p>
    <div class="tarjeta">
      <label>Nombre y apellido</label>
      <input type="text" id="nombre" list="ops" autocomplete="off" placeholder="Escribí tu nombre">
      <datalist id="ops">${estado.operadores.map((o) => `<option value="${o}">`).join('')}</datalist>
      <label>Firma</label>
      <canvas class="firma" id="canvas"></canvas>
      <div style="height:.5rem"></div>
      <button class="secundaria" id="borrar">Borrar la firma</button>
    </div>
    <button class="principal" id="seguir" disabled>Continuar</button>
  `);

  const canvas = document.getElementById('canvas');
  const nombre = document.getElementById('nombre');
  const seguir = document.getElementById('seguir');
  const ctx = canvas.getContext('2d');
  let firmado = false;

  // El canvas se dimensiona en pixeles reales para que la firma no salga borrosa.
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#14212c';

  let dibujando = false;
  const punto = (e) => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault(); dibujando = true;
    const p = punto(e); ctx.beginPath(); ctx.moveTo(p.x, p.y);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dibujando) return;
    e.preventDefault();
    const p = punto(e);
    ctx.lineTo(p.x, p.y); ctx.stroke();
    firmado = true; revisar();
  });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => {
    canvas.addEventListener(ev, () => { dibujando = false; });
  });

  function revisar() { seguir.disabled = !(firmado && nombre.value.trim().length >= 3); }
  nombre.oninput = revisar;

  document.getElementById('borrar').onclick = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    firmado = false; revisar();
  };

  seguir.onclick = conError(() => {
    // Fondo blanco: el canvas transparente se ve negro al abrirlo desde Drive.
    const plano = document.createElement('canvas');
    plano.width = canvas.width; plano.height = canvas.height;
    const c2 = plano.getContext('2d');
    c2.fillStyle = '#ffffff';
    c2.fillRect(0, 0, plano.width, plano.height);
    c2.drawImage(canvas, 0, 0);

    borrador.operador = nombre.value.trim();
    borrador.firma = plano.toDataURL('image/jpeg', 0.8);
    aperturaMonitor();
  });
}

// ---------- apertura: fotos ----------

function aperturaMonitor() {
  pantallaCamara({
    titulo: 'Foto del monitor de cabina',
    indicacion: 'Con el equipo en marcha y después de un minuto de funcionamiento. Que se vea toda la pantalla.',
    alTomar: (foto) => { borrador.foto_monitor = foto; aperturaHorometro(); }
  });
}

function aperturaHorometro() {
  pantallaCamara({
    titulo: 'Foto del horómetro',
    indicacion: 'Que se lean los números completos.',
    conValor: (foto, repetir) => aperturaValor(foto, repetir)
  });
}

/** La foto arriba y el número debajo: se tipea mirando la misma imagen. */
function aperturaValor(foto, repetir) {
  pintar(`
    <h2>Horómetro</h2>
    <img class="previa" src="${foto}" alt="Foto del horómetro">
    <div style="height:.5rem"></div>
    <button class="secundaria" id="rep">Repetir la foto</button>
    <div class="tarjeta" style="margin-top:.9rem">
      <label>Escribí lo que muestra el horómetro</label>
      <input type="number" id="valor" inputmode="decimal" step="0.1" value="${estado.horom_sugerido}">
      <div class="tenue" style="margin-top:.5rem">
        Viene del cierre de ayer: <strong>${estado.horom_sugerido}</strong>.
      </div>
      <div id="bloqueMotivo" hidden>
        <label>¿Por qué no coincide?</label>
        <textarea id="motivo" rows="3" placeholder="Ej.: el horómetro se reinició, o el valor anterior se cargó mal"></textarea>
      </div>
    </div>
    <button class="principal" id="seguir">Continuar</button>
  `);

  const valor = document.getElementById('valor');
  const bloque = document.getElementById('bloqueMotivo');
  // El motivo aparece solo cuando el número deja de coincidir: sin pedirlo antes
  // de tiempo, y sin dejar pasar una corrección sin explicación.
  valor.oninput = () => {
    bloque.hidden = Math.abs(Number(valor.value) - estado.horom_sugerido) <= 0.001;
  };
  document.getElementById('rep').onclick = repetir;

  document.getElementById('seguir').onclick = conError(() => {
    const v = Number(valor.value);
    if (valor.value === '' || !isFinite(v) || v < 0) {
      throw new Error('El valor del horómetro no es válido.');
    }
    const motivo = document.getElementById('motivo').value.trim();
    if (Math.abs(v - estado.horom_sugerido) > 0.001 && !motivo) {
      throw new Error('El número no coincide con el de ayer: hace falta explicar por qué.');
    }
    borrador.foto_horometro = foto;
    borrador.horom_ini = v;
    borrador.motivo_correccion = motivo;
    aperturaChecklist();
  });
}

// ---------- apertura: checklist ----------

function aperturaChecklist() {
  const items = estado.items;
  pintar(`
    <h2>Revisión del equipo</h2>
    <p class="ayuda">Un toque por ítem. Si algo está mal, marcá Problema y sacá una foto.</p>
    <div class="tarjeta">
      ${items.map((i) => `
        <div class="item" data-orden="${i.orden}">
          <div class="texto">${i.orden}. ${i.item}</div>
          <div class="opciones">
            <button class="ok" data-estado="OK">✓ Bien</button>
            <button class="problema" data-estado="PROBLEMA">✕ Problema</button>
          </div>
          <div class="detalle" hidden></div>
        </div>`).join('')}
    </div>
    <button class="principal" id="enviar" disabled>Falta responder</button>
  `);

  const respuestas = {};
  const btn = document.getElementById('enviar');

  function revisar() {
    const completo = items.every((i) => {
      const r = respuestas[i.orden];
      return r && (r.estado === 'OK' || (r.foto && r.comentario));
    });
    btn.disabled = !completo;
    btn.textContent = completo
      ? 'Abrir la jornada'
      : `Falta responder (${items.filter((i) => respuestas[i.orden]).length}/${items.length})`;
  }

  function armarDetalle(item, r, detalle) {
    detalle.hidden = false;
    detalle.innerHTML = `
      <label>Foto del problema</label>
      ${r.foto ? `<img class="previa" src="${r.foto}" alt="">` : ''}
      <div style="height:.5rem"></div>
      <button class="secundaria btn-foto">${r.foto ? 'Repetir la foto' : 'Sacar foto'}</button>
      <label>¿Qué pasa?</label>
      <textarea rows="2" placeholder="Contá brevemente qué viste">${r.comentario || ''}</textarea>`;
    const txt = detalle.querySelector('textarea');
    txt.oninput = () => { r.comentario = txt.value.trim(); revisar(); };
    detalle.querySelector('.btn-foto').onclick = conError(() => {
      pantallaCamara({
        titulo: item.item,
        indicacion: 'Que se vea el problema.',
        alTomar: (f) => aperturaChecklistRestaurar(respuestas, f, item.orden)
      });
    });
  }

  app.querySelectorAll('.item').forEach((div) => {
    const orden = Number(div.dataset.orden);
    const item = items.find((i) => i.orden === orden);
    const detalle = div.querySelector('.detalle');
    div.querySelectorAll('.opciones button').forEach((b) => {
      b.onclick = () => {
        div.querySelectorAll('.opciones button').forEach((x) => x.classList.remove('elegido'));
        b.classList.add('elegido');
        if (b.dataset.estado === 'OK') {
          respuestas[orden] = { orden, estado: 'OK' };
          detalle.hidden = true;
          detalle.innerHTML = '';
          return revisar();
        }
        respuestas[orden] = { orden, estado: 'PROBLEMA', foto: null, comentario: '' };
        armarDetalle(item, respuestas[orden], detalle);
        revisar();
      };
    });
  });

  // Si venimos de sacar una foto de un problema, repintamos con lo ya cargado.
  if (aperturaChecklist._restaurar) {
    const { previas, foto, orden } = aperturaChecklist._restaurar;
    aperturaChecklist._restaurar = null;
    Object.assign(respuestas, previas);
    respuestas[orden].foto = foto;
    items.forEach((i) => {
      const r = respuestas[i.orden];
      if (!r) return;
      const div = app.querySelector(`.item[data-orden="${i.orden}"]`);
      div.querySelector(r.estado === 'OK' ? '.ok' : '.problema').classList.add('elegido');
      if (r.estado === 'PROBLEMA') armarDetalle(i, r, div.querySelector('.detalle'));
    });
    revisar();
  }

  btn.onclick = conError(async () => {
    btn.disabled = true;
    btn.textContent = 'Enviando…';
    const u = Camara.ubicacion();
    const r = await API.enviar('abrir', {
      equipo: estado.equipo,
      operador: borrador.operador,
      firma: borrador.firma,
      foto_monitor: borrador.foto_monitor,
      foto_horometro: borrador.foto_horometro,
      horom_ini: borrador.horom_ini,
      motivo_correccion: borrador.motivo_correccion,
      checklist: items.map((i) => respuestas[i.orden]),
      lat: u ? u.lat : '', lon: u ? u.lon : ''
    }, estado.equipo);
    if (r.encolado) return pantallaGuardadoSinSeñal();
    iniciar();
  });
}

function aperturaChecklistRestaurar(previas, foto, orden) {
  aperturaChecklist._restaurar = { previas: JSON.parse(JSON.stringify(previas)), foto, orden };
  aperturaChecklist();
}

// ---------- cierre ----------

function cierreFoto() {
  borrador = {};
  pantallaCamara({
    titulo: 'Foto del horómetro al terminar',
    indicacion: 'Que se lean los números completos.',
    conValor: (foto, repetir) => cierreValor(foto, repetir)
  });
}

function cierreValor(foto, repetir) {
  const ini = Number(estado.tarja.horom_ini);
  pintar(`
    <h2>Horómetro al terminar</h2>
    <img class="previa" src="${foto}" alt="Foto del horómetro">
    <div style="height:.5rem"></div>
    <button class="secundaria" id="rep">Repetir la foto</button>
    <div class="tarjeta" style="margin-top:.9rem">
      <label>Escribí lo que muestra el horómetro</label>
      <input type="number" id="valor" inputmode="decimal" step="0.1" placeholder="Ej.: ${(ini + 8).toFixed(1)}">
      <div class="tenue" style="margin-top:.5rem">A la mañana marcaba <strong>${ini}</strong>.</div>
      <div id="calc" class="tenue" style="margin-top:.4rem"></div>
    </div>
    <button class="principal" id="enviar" disabled>Cerrar la jornada</button>
  `);

  const valor = document.getElementById('valor');
  const calc = document.getElementById('calc');
  const enviar = document.getElementById('enviar');
  document.getElementById('rep').onclick = repetir;

  valor.oninput = () => {
    const v = Number(valor.value);
    const h = v - ini;
    if (!valor.value || !isFinite(v)) { calc.textContent = ''; enviar.disabled = true; return; }
    if (h < 0) { calc.textContent = 'El valor es menor que el de la mañana. Revisalo.'; enviar.disabled = true; return; }
    if (h > 14) { calc.textContent = `Daría ${h.toFixed(1)} h de trabajo, más de las 14 permitidas. Revisalo.`; enviar.disabled = true; return; }
    calc.textContent = `Serían ${h.toFixed(1)} horas de trabajo.`;
    enviar.disabled = false;
  };

  enviar.onclick = conError(async () => {
    enviar.disabled = true;
    enviar.textContent = 'Enviando…';
    const r = await API.enviar('cerrar', {
      tarja_id: estado.tarja.id,
      foto_horometro: foto,
      horom_fin: Number(valor.value)
    }, estado.equipo);
    if (r.encolado) return pantallaGuardadoSinSeñal();
    iniciar();
  });
}

// ---------- pantallas finales ----------

function pantallaGuardadoSinSeñal() {
  pintar(
    aviso('alerta', '<strong>Guardado en el celular.</strong> No hay señal, así que se va a enviar solo cuando vuelva. No hace falta cargarlo de nuevo: podés cerrar la app.') +
    `<button class="principal" onclick="location.reload()">Entendido</button>`
  );
}

/**
 * Hay una carga de este equipo esperando señal. No se ofrece cargar de nuevo:
 * el servidor todavía no sabe nada y se duplicaría el trabajo del operario.
 */
function pantallaEnCola(item) {
  const que = item.action === 'abrir' ? 'la apertura de la jornada' : 'el cierre de la jornada';
  pintar(
    aviso('alerta', `<strong>Falta enviar ${que}.</strong> Quedó guardada en el celular porque no había señal. Se manda sola cuando vuelva; no hace falta cargarla otra vez.`) +
    `<button class="principal" id="reintentar">Intentar enviar ahora</button>
     <div style="height:.5rem"></div>
     <button class="secundaria" onclick="location.reload()">Actualizar</button>`
  );
  document.getElementById('reintentar').onclick = async (ev) => {
    ev.target.disabled = true;
    ev.target.textContent = 'Enviando…';
    const ok = await API.sincronizar(() => {});
    if (ok) return iniciar();
    ev.target.disabled = false;
    ev.target.textContent = 'Intentar enviar ahora';
    app.prepend(Object.assign(document.createElement('div'), {
      className: 'aviso error',
      textContent: 'Sigue sin haber señal. Probá de nuevo más tarde; no se pierde nada.'
    }));
  };
}

/** No hay jornada abierta, pero hoy ya hubo al menos una cerrada. */
function pantallaListo() {
  const hoy = estado.jornadas_hoy || [];
  const total = hoy.reduce((s, t) => s + Number(t.horas || 0), 0);
  pintar(`
    ${aviso('info', `${hoy.length === 1 ? 'Jornada cerrada' : hoy.length + ' jornadas cerradas'} hoy. ${total.toFixed(1)} horas en total.`)}
    <div class="tarjeta filas">
      ${hoy.map((t, i) => `
        <div class="fila">
          <span>Jornada ${i + 1} — ${t.operador || '—'}</span>
          <span>${t.horom_ini} → ${t.horom_fin} · <strong>${t.horas} h</strong></span>
        </div>`).join('')}
    </div>
    <button class="principal" id="otra">Abrir otra jornada</button>
    <div style="height:1.2rem"></div>
    <h2>Últimas jornadas</h2>
    <div class="tarjeta filas">
      ${estado.ultimas.map((u) => `
        <div class="fila">
          <span>${u.fecha}</span>
          <span>${u.horas !== '' ? u.horas + ' h' : '<span class="chip alerta">sin cerrar</span>'}</span>
        </div>`).join('') || '<div class="tenue">Todavía no hay jornadas anteriores.</div>'}
    </div>
  `);
  document.getElementById('otra').onclick = aperturaIdentidad;
}

// ---------- ciclo ----------

window.addEventListener('online', () => API.sincronizar(() => {}));
iniciar();
