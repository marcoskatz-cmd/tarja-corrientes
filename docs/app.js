/**
 * PWA del operador.
 *
 * Criterio: una sola cosa en pantalla por vez, el botón de avanzar aparece
 * solamente cuando el paso está completo, y nada de texto libre donde alcance
 * con elegir. El objetivo es que alguien que nunca la vio termine en menos de
 * un minuto sin leer nada.
 */

const app = document.getElementById('app');
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
  if (estado.paso === 'apertura') return aperturaFoto();
  if (estado.paso === 'cierre') return cierreFoto();
  return pantallaListo();
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

// ---------- pantalla de cámara reutilizable ----------

/**
 * Muestra la cámara en vivo con una indicación corta y devuelve el dataURL
 * de la foto tomada. La galería no se ofrece a propósito.
 */
function pantallaCamara({ titulo, indicacion, alTomar }) {
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
    confirmarFoto(foto, titulo, alTomar, () => pantallaCamara({ titulo, indicacion, alTomar }));
  });
}

/**
 * La hora exacta la pone el backend al guardar. Acá solo sellamos la de
 * referencia del dispositivo junto a la fecha del servidor, que es la que manda.
 */
function horaLocalDelServidor() {
  const d = new Date();
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
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

// ---------- apertura ----------

function aperturaFoto() {
  borrador = { checklist: [] };
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
    alTomar: (foto) => { borrador.foto_horometro = foto; aperturaValor(); }
  });
}

function aperturaValor() {
  pintar(`
    <h2>Horómetro de apertura</h2>
    <p class="ayuda">Viene del cierre de la jornada anterior. Si no coincide con lo que muestra la máquina, corregilo.</p>
    <div class="tarjeta">
      <label>Valor</label>
      <input type="number" id="valor" inputmode="decimal" step="0.1" value="${estado.horom_sugerido}" readonly>
      <div id="bloqueMotivo" hidden>
        <label>¿Por qué no coincide?</label>
        <textarea id="motivo" rows="3" placeholder="Ej.: el horómetro se reinició, o el valor anterior se cargó mal"></textarea>
      </div>
      <div style="height:.8rem"></div>
      <button class="secundaria" id="btnCorregir">Corregir el valor</button>
    </div>
    <button class="principal" id="seguir">Continuar</button>
  `);
  const valor = document.getElementById('valor');
  const bloque = document.getElementById('bloqueMotivo');
  document.getElementById('btnCorregir').onclick = () => {
    valor.readOnly = false;
    valor.focus();
    bloque.hidden = false;
    document.getElementById('btnCorregir').hidden = true;
  };
  document.getElementById('seguir').onclick = conError(() => {
    const v = Number(valor.value);
    if (!isFinite(v) || v < 0) throw new Error('El valor del horómetro no es válido.');
    const motivo = document.getElementById('motivo') ? document.getElementById('motivo').value.trim() : '';
    if (Math.abs(v - estado.horom_sugerido) > 0.001 && !motivo) {
      throw new Error('Cambiaste el valor: hace falta explicar por qué.');
    }
    borrador.horom_ini = v;
    borrador.motivo_correccion = motivo;
    aperturaChecklist();
  });
}

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

  app.querySelectorAll('.item').forEach((div) => {
    const orden = Number(div.dataset.orden);
    const item = items.find((i) => i.orden === orden);
    const detalle = div.querySelector('.detalle');
    div.querySelectorAll('.opciones button').forEach((b) => {
      b.onclick = conError(async () => {
        div.querySelectorAll('.opciones button').forEach((x) => x.classList.remove('elegido'));
        b.classList.add('elegido');
        const est = b.dataset.estado;
        if (est === 'OK') {
          respuestas[orden] = { orden, estado: 'OK' };
          detalle.hidden = true;
          detalle.innerHTML = '';
          return revisar();
        }
        respuestas[orden] = { orden, estado: 'PROBLEMA', foto: null, comentario: '' };
        detalle.hidden = false;
        detalle.innerHTML = `
          <label>Foto del problema</label>
          <button class="secundaria btn-foto">Sacar foto</button>
          <label>¿Qué pasa?</label>
          <textarea rows="2" placeholder="Contá brevemente qué viste"></textarea>`;
        const txt = detalle.querySelector('textarea');
        txt.oninput = () => { respuestas[orden].comentario = txt.value.trim(); revisar(); };
        detalle.querySelector('.btn-foto').onclick = conError(() => {
          const guardado = { html: app.innerHTML, scroll: window.scrollY };
          pantallaCamara({
            titulo: item.item,
            indicacion: 'Que se vea el problema.',
            alTomar: (foto) => {
              // Volvemos al checklist con todo lo ya respondido en su lugar.
              aperturaChecklistRestaurar(respuestas, foto, orden);
            }
          });
        });
        revisar();
      });
    });
  });

  // Si venimos de sacar una foto, repintamos el checklist con lo ya cargado.
  if (aperturaChecklist._restaurar) {
    const { previas, foto, orden } = aperturaChecklist._restaurar;
    aperturaChecklist._restaurar = null;
    Object.assign(respuestas, previas);
    respuestas[orden].foto = foto;
    items.forEach((i) => {
      const r = respuestas[i.orden];
      if (!r) return;
      const div = app.querySelector(`.item[data-orden="${i.orden}"]`);
      const b = div.querySelector(r.estado === 'OK' ? '.ok' : '.problema');
      b.classList.add('elegido');
      if (r.estado === 'PROBLEMA') {
        const detalle = div.querySelector('.detalle');
        detalle.hidden = false;
        detalle.innerHTML = `
          <label>Foto del problema</label>
          ${r.foto ? `<img class="previa" src="${r.foto}" alt="">` : ''}
          <div style="height:.5rem"></div>
          <button class="secundaria btn-foto">${r.foto ? 'Repetir la foto' : 'Sacar foto'}</button>
          <label>¿Qué pasa?</label>
          <textarea rows="2">${r.comentario || ''}</textarea>`;
        const txt = detalle.querySelector('textarea');
        txt.oninput = () => { r.comentario = txt.value.trim(); revisar(); };
        detalle.querySelector('.btn-foto').onclick = conError(() => {
          pantallaCamara({
            titulo: i.item,
            indicacion: 'Que se vea el problema.',
            alTomar: (f) => aperturaChecklistRestaurar(respuestas, f, i.orden)
          });
        });
      }
    });
    revisar();
  }

  btn.onclick = conError(async () => {
    btn.disabled = true;
    btn.textContent = 'Enviando…';
    borrador.checklist = items.map((i) => respuestas[i.orden]);
    const u = Camara.ubicacion();
    const r = await API.enviar('abrir', {
      equipo: estado.equipo,
      foto_monitor: borrador.foto_monitor,
      foto_horometro: borrador.foto_horometro,
      horom_ini: borrador.horom_ini,
      motivo_correccion: borrador.motivo_correccion,
      checklist: borrador.checklist,
      lat: u ? u.lat : '', lon: u ? u.lon : ''
    });
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
  borrador = { detenciones: [] };
  pantallaCamara({
    titulo: 'Foto del horómetro al terminar',
    indicacion: 'Que se lean los números completos.',
    alTomar: (foto) => { borrador.foto_horometro = foto; cierreValor(); }
  });
}

function cierreValor() {
  const ini = Number(estado.tarja.horom_ini);
  pintar(`
    <h2>Horómetro al terminar</h2>
    <p class="ayuda">A la mañana marcaba <strong>${ini}</strong>.</p>
    <div class="tarjeta">
      <label>Valor</label>
      <input type="number" id="valor" inputmode="decimal" step="0.1" placeholder="Ej.: ${(ini + 8).toFixed(1)}">
      <div id="calc" class="tenue" style="margin-top:.6rem"></div>
    </div>
    <button class="principal" id="seguir" disabled>Continuar</button>
  `);
  const valor = document.getElementById('valor');
  const calc = document.getElementById('calc');
  const seguir = document.getElementById('seguir');
  valor.oninput = () => {
    const v = Number(valor.value);
    const h = v - ini;
    if (!valor.value || !isFinite(v)) { calc.textContent = ''; seguir.disabled = true; return; }
    if (h < 0) { calc.textContent = 'El valor es menor que el de la mañana. Revisalo.'; seguir.disabled = true; return; }
    if (h > 14) { calc.textContent = `Daría ${h.toFixed(1)} h de trabajo, más de las 14 permitidas. Revisalo.`; seguir.disabled = true; return; }
    calc.textContent = `Serían ${h.toFixed(1)} horas de trabajo.`;
    seguir.disabled = false;
  };
  seguir.onclick = conError(() => {
    borrador.horom_fin = Number(valor.value);
    cierreDetenciones();
  });
}

function cierreDetenciones() {
  pintar(`
    <h2>¿Hubo detenciones?</h2>
    <p class="ayuda">Solo si la máquina estuvo parada durante la jornada.</p>
    <div id="lista" class="filas"></div>
    <div style="height:.5rem"></div>
    <button class="secundaria" id="agregar">Agregar una detención</button>
    <div style="height:.9rem"></div>
    <button class="principal" id="seguir">Continuar</button>
  `);
  const lista = document.getElementById('lista');

  function repintar() {
    lista.innerHTML = borrador.detenciones.map((d, i) => `
      <div class="fila">
        <span>${d.motivo} — <strong>${d.horas} h</strong></span>
        <button class="tenue" style="border:0;background:none" data-i="${i}">Quitar</button>
      </div>`).join('');
    lista.querySelectorAll('[data-i]').forEach((b) => {
      b.onclick = () => { borrador.detenciones.splice(Number(b.dataset.i), 1); repintar(); };
    });
  }
  repintar();

  document.getElementById('agregar').onclick = () => {
    const cont = document.createElement('div');
    cont.className = 'tarjeta';
    cont.innerHTML = `
      <label>Motivo</label>
      <select id="mot">
        <option value="">Elegí un motivo</option>
        ${estado.motivos.map((m) => `<option>${m}</option>`).join('')}
      </select>
      <label>Horas parado</label>
      <input type="number" id="hs" inputmode="decimal" step="0.5" min="0.5">
      <div style="height:.8rem"></div>
      <button class="principal" id="ok" disabled>Agregar</button>`;
    lista.after(cont);
    const mot = cont.querySelector('#mot');
    const hs = cont.querySelector('#hs');
    const ok = cont.querySelector('#ok');
    const revisar = () => { ok.disabled = !(mot.value && Number(hs.value) > 0); };
    mot.onchange = revisar; hs.oninput = revisar;
    ok.onclick = () => {
      borrador.detenciones.push({ motivo: mot.value, horas: Number(hs.value) });
      cont.remove();
      repintar();
    };
  };

  document.getElementById('seguir').onclick = () => cierreFirma();
}

function cierreFirma() {
  pintar(`
    <h2>Firma del operador</h2>
    <p class="ayuda">Una vez firmada, la tarja del día queda cerrada.</p>
    <div class="tarjeta">
      <label>Nombre y apellido</label>
      <input type="text" id="nombre" list="ops" autocomplete="off" placeholder="Escribí tu nombre">
      <datalist id="ops">${estado.operadores.map((o) => `<option value="${o}">`).join('')}</datalist>
      <label>Firma</label>
      <canvas class="firma" id="canvas"></canvas>
      <div style="height:.5rem"></div>
      <button class="secundaria" id="borrar">Borrar la firma</button>
    </div>
    <button class="principal" id="enviar" disabled>Cerrar y firmar la jornada</button>
  `);

  const canvas = document.getElementById('canvas');
  const nombre = document.getElementById('nombre');
  const enviar = document.getElementById('enviar');
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
    const t = e.touches ? e.touches[0] : e;
    return { x: t.clientX - r.left, y: t.clientY - r.top };
  };
  const empezar = (e) => { e.preventDefault(); dibujando = true; const p = punto(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); };
  const mover = (e) => {
    if (!dibujando) return;
    e.preventDefault();
    const p = punto(e);
    ctx.lineTo(p.x, p.y); ctx.stroke();
    firmado = true; revisar();
  };
  const terminar = () => { dibujando = false; };
  ['pointerdown'].forEach((ev) => canvas.addEventListener(ev, empezar));
  ['pointermove'].forEach((ev) => canvas.addEventListener(ev, mover));
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => canvas.addEventListener(ev, terminar));

  function revisar() { enviar.disabled = !(firmado && nombre.value.trim().length >= 3); }
  nombre.oninput = revisar;

  document.getElementById('borrar').onclick = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    firmado = false; revisar();
  };

  enviar.onclick = conError(async () => {
    enviar.disabled = true;
    enviar.textContent = 'Enviando…';
    // Fondo blanco: el canvas transparente se ve negro en el PDF de Drive.
    const plano = document.createElement('canvas');
    plano.width = canvas.width; plano.height = canvas.height;
    const c2 = plano.getContext('2d');
    c2.fillStyle = '#ffffff';
    c2.fillRect(0, 0, plano.width, plano.height);
    c2.drawImage(canvas, 0, 0);

    const r = await API.enviar('cerrar', {
      tarja_id: estado.tarja.id,
      foto_horometro: borrador.foto_horometro,
      horom_fin: borrador.horom_fin,
      detenciones: borrador.detenciones,
      operador: nombre.value.trim(),
      firma: plano.toDataURL('image/jpeg', 0.8)
    });
    if (r.encolado) return pantallaGuardadoSinSeñal();
    iniciar();
  });
}

// ---------- pantallas finales ----------

function pantallaGuardadoSinSeñal() {
  pintar(
    aviso('alerta', 'Se guardó en el celular porque no hay señal. Se va a enviar solo cuando vuelva. No hace falta cargarlo de nuevo.') +
    `<button class="principal" onclick="location.reload()">Entendido</button>`
  );
}

function pantallaListo() {
  const t = estado.tarja;
  pintar(`
    ${aviso('info', `Jornada cerrada y firmada. ${t.horas} horas registradas.`)}
    <div class="tarjeta">
      <div class="fila"><span class="tenue">Operador</span><span>${t.operador || '—'}</span></div>
      <div class="fila"><span class="tenue">Horómetro</span><span>${t.horom_ini} → ${t.horom_fin}</span></div>
      <div class="fila"><span class="tenue">Horas</span><span><strong>${t.horas}</strong></span></div>
    </div>
    <h2>Últimas jornadas</h2>
    <div class="tarjeta filas">
      ${estado.ultimas.map((u) => `
        <div class="fila">
          <span>${u.fecha}</span>
          <span>${u.horas !== '' ? u.horas + ' h' : '<span class="chip alerta">sin cerrar</span>'}</span>
        </div>`).join('') || '<div class="tenue">Todavía no hay jornadas anteriores.</div>'}
    </div>
  `);
}

// ---------- ciclo ----------

window.addEventListener('online', () => API.sincronizar(() => {}));
iniciar();
