/**
 * Panel de control. Acceso por PIN, sesión de 8 h.
 *
 * El rol taller ve todo pero no puede anular, corregir ni cerrar pendientes:
 * los botones directamente no se dibujan, en vez de aparecer y tirar error.
 */

const app = document.getElementById('app');
const nav = document.getElementById('nav');
const hRol = document.getElementById('hRol');
const btnSalir = document.getElementById('btnSalir');

// En localStorage y no en sessionStorage: la sesión dura 8 h y se pierde al
// cerrar la pestaña, que es justo lo que pasa al saltar desde la app al panel.
let sesion = leerSesion();

function leerSesion() {
  try { return JSON.parse(localStorage.getItem('sesion') || 'null'); }
  catch (e) { return null; }
}

const PESTANAS = [
  { id: 'hoy', titulo: 'Hoy', ver: verHoy },
  { id: 'pendientes', titulo: 'Alertas', ver: verPendientes },
  { id: 'equipo', titulo: 'Equipo', ver: verEquipo },
  { id: 'certificacion', titulo: 'Certificación', ver: verCertificacion }
];

function esAdmin() { return sesion && sesion.rol === 'admin'; }
function pintar(html) { app.innerHTML = html; }
function aviso(tipo, texto) { return `<div class="aviso ${tipo}">${texto}</div>`; }

function conError(fn) {
  return async (...args) => {
    try { await fn(...args); }
    catch (e) {
      if (/sesión venció/i.test(e.message)) return salir();
      const d = document.createElement('div');
      d.className = 'aviso error';
      d.textContent = e.message;
      app.prepend(d);
      window.scrollTo(0, 0);
    }
  };
}

async function pedir(action, datos = {}) {
  // Sin esta guarda, una sesión caída explotaba como "Cannot read properties of
  // null" en vez de mandar al PIN, que es lo que hay que hacer.
  if (!sesion || !sesion.token) throw new Error('La sesión venció. Ingresá el PIN de nuevo.');
  return API.llamar(action, { ...datos, token: sesion.token });
}

// ---------- login ----------

function pantallaLogin() {
  nav.hidden = true;
  btnSalir.hidden = true;
  hRol.textContent = '';
  pintar(`
    <h2>Ingresá tu PIN</h2>
    <p class="ayuda">Cuatro dígitos. La sesión dura 8 horas.</p>
    <div class="tarjeta">
      <input type="password" id="pin" inputmode="numeric" maxlength="4"
             autocomplete="off" style="font-size:2rem;text-align:center;letter-spacing:.5rem">
    </div>
    <button class="principal" id="entrar" disabled>Entrar</button>
  `);
  const pin = document.getElementById('pin');
  const entrar = document.getElementById('entrar');
  pin.focus();
  pin.oninput = () => {
    pin.value = pin.value.replace(/\D/g, '').slice(0, 4);
    entrar.disabled = pin.value.length !== 4;
  };
  pin.onkeydown = (e) => { if (e.key === 'Enter' && !entrar.disabled) entrar.click(); };
  entrar.onclick = conError(async () => {
    entrar.disabled = true;
    entrar.textContent = 'Verificando…';
    try {
      sesion = await API.llamar('login', { pin: pin.value });
      localStorage.setItem('sesion', JSON.stringify(sesion));
      iniciar();
    } catch (e) {
      entrar.disabled = false;
      entrar.textContent = 'Entrar';
      pin.value = '';
      throw e;
    }
  });
}

function salir() {
  sesion = null;
  localStorage.removeItem('sesion');
  pantallaLogin();
}
btnSalir.onclick = salir;

// ---------- navegación ----------

function iniciar() {
  if (!sesion) return pantallaLogin();
  hRol.textContent = sesion.rol === 'admin' ? 'Administración' : 'Taller';
  btnSalir.hidden = false;
  nav.hidden = false;
  nav.innerHTML = PESTANAS.map((p) => `<button data-id="${p.id}">${p.titulo}</button>`).join('');
  nav.querySelectorAll('button').forEach((b) => {
    b.onclick = () => abrir(b.dataset.id);
  });
  abrir('hoy');
}

function abrir(id) {
  nav.querySelectorAll('button').forEach((b) => b.classList.toggle('activa', b.dataset.id === id));
  pintar('<div class="cargando">Cargando…</div>');
  conError(PESTANAS.find((p) => p.id === id).ver)();
}

// ---------- Hoy ----------

async function verHoy() {
  const d = await pedir('hoy');
  const diag = d.diagnostico.length
    ? aviso('alerta',
        '<strong>La planilla no coincide con lo que la app espera.</strong><br>' +
        d.diagnostico.map((x) => `${x.hoja}: ${x.detalle}`).join('<br>'))
    : '';
  pintar(`
    ${diag}
    <h2>Hoy — ${d.fecha}</h2>
    <div class="filas">
      ${d.equipos.map((e) => `
        <div class="tarjeta">
          <div class="fila" style="border:0;padding-top:0">
            <strong style="font-size:1.05rem">${e.equipo}</strong>
            ${chipEstado(e.estado)}
          </div>
          <div class="fila"><span class="tenue">Horas del día</span><span>${e.horas !== '' ? e.horas + ' h' : '—'}</span></div>
          <div class="fila"><span class="tenue">Problemas declarados hoy</span><span>${e.problemas_hoy}</span></div>
          <div class="fila" style="border:0"><span class="tenue">Pendientes abiertos</span>
            <span>${e.pendientes_abiertos ? `<span class="chip alerta">${e.pendientes_abiertos}</span>` : '0'}</span></div>
          ${e.excepcion ? aviso('alerta', 'La jornada tiene el horómetro corregido a mano.') : ''}
        </div>`).join('')}
    </div>
  `);
}

function chipEstado(estado) {
  if (estado === 'cerrada') return '<span class="chip ok">✓ cerrada y firmada</span>';
  if (estado === 'abierta') return '<span class="chip alerta">abierta, sin cerrar</span>';
  if (estado === 'anulada') return '<span class="chip alerta">anulada</span>';
  return '<span class="chip alerta">✕ sin tarja</span>';
}

// ---------- Alertas y pendientes ----------

async function verPendientes() {
  const lista = await pedir('pendientes');
  if (!lista.length) {
    return pintar(aviso('info', 'No hay problemas abiertos. Todo al día.'));
  }
  pintar(`
    <h2>Pendientes abiertos (${lista.length})</h2>
    <div class="filas">
      ${lista.map((p) => `
        <div class="tarjeta">
          <div class="fila" style="border:0;padding-top:0">
            <strong>${p.equipo}</strong>
            <span class="chip ${p.vencido ? 'alerta' : 'ok'}">
              ${p.dias_abierto} día${p.dias_abierto === 1 ? '' : 's'}${p.vencido ? ' · sin resolver' : ''}
            </span>
          </div>
          <div style="font-weight:600;margin:.3rem 0">${p.item}</div>
          <div class="tenue" style="margin-bottom:.6rem">${p.comentario || 'Sin comentario'}</div>
          ${p.foto ? `<a href="${p.foto}" target="_blank" rel="noopener">Ver la foto</a>` : ''}
          <div class="tenue" style="font-size:.85rem;margin-top:.4rem">Abierto el ${p.fecha_apertura}</div>
          ${esAdmin() ? `
            <div style="height:.8rem"></div>
            <button class="secundaria" data-cerrar="${p.id}">Cerrar este pendiente</button>` : ''}
        </div>`).join('')}
    </div>
  `);
  app.querySelectorAll('[data-cerrar]').forEach((b) => {
    b.onclick = () => formCerrarPendiente(b, b.dataset.cerrar);
  });
}

function formCerrarPendiente(boton, id) {
  const cont = document.createElement('div');
  cont.style.marginTop = '.6rem';
  cont.innerHTML = `
    <label>¿Cómo se resolvió?</label>
    <select id="mot">
      <option value="">Elegí un motivo</option>
      <option>Reparado</option>
      <option>Repuesto pedido</option>
      <option>Sin acción</option>
    </select>
    <div style="height:.6rem"></div>
    <button class="principal" id="ok" disabled>Confirmar el cierre</button>`;
  boton.after(cont);
  boton.hidden = true;
  const mot = cont.querySelector('#mot');
  const ok = cont.querySelector('#ok');
  mot.onchange = () => { ok.disabled = !mot.value; };
  ok.onclick = conError(async () => {
    ok.disabled = true;
    ok.textContent = 'Cerrando…';
    await pedir('cerrar_pendiente', { id, motivo: mot.value });
    abrir('pendientes');
  });
}

// ---------- Equipo ----------

let equipoActual = 'PC200';

async function verEquipo() {
  const d = await pedir('equipo', { equipo: equipoActual });
  pintar(`
    <div class="grande" style="grid-template-columns:1fr 1fr;margin-bottom:1rem">
      ${['PC200', 'HIDROMEK'].map((e) => `
        <button data-eq="${e}" style="${e === equipoActual ? '' : 'opacity:.5'}">${e}</button>`).join('')}
    </div>
    <div class="tarjeta">
      <div class="fila"><span class="tenue">Horómetro acumulado</span><span><strong>${d.horom_actual}</strong></span></div>
      <div class="fila"><span class="tenue">Horas del mes</span><span>${d.horas_mes.toFixed(1)} h</span></div>
      <div class="fila"><span class="tenue">Días con tarja</span><span>${d.dias_con_tarja}</span></div>
      <div class="fila" style="border:0"><span class="tenue">Próximo service</span><span>${d.proximo_service || '—'}</span></div>
    </div>
    ${esAdmin() ? `<button class="secundaria" id="btnHorom">Corregir el horómetro</button><div style="height:1rem"></div>` : ''}
    <h2>Historial del mes</h2>
    <div class="tarjeta scroll-x">
      <table>
        <thead><tr><th>Fecha</th><th class="num">Horas</th><th>Operador</th><th>Fotos</th></tr></thead>
        <tbody>
          ${d.historial.map((h) => `
            <tr>
              <td>${h.fecha}${h.excepcion ? ' <span class="chip alerta">excepción</span>' : ''}</td>
              <td class="num">${h.horas !== '' ? h.horas : '—'}</td>
              <td>${h.operador || '—'}</td>
              <td>
                ${h.foto_monitor ? `<a href="${h.foto_monitor}" target="_blank" rel="noopener">monitor</a> ` : ''}
                ${h.foto_horom_ini ? `<a href="${h.foto_horom_ini}" target="_blank" rel="noopener">inicio</a> ` : ''}
                ${h.foto_horom_fin ? `<a href="${h.foto_horom_fin}" target="_blank" rel="noopener">fin</a>` : ''}
              </td>
            </tr>`).join('') || '<tr><td colspan="4" class="tenue">Sin jornadas este mes.</td></tr>'}
        </tbody>
      </table>
    </div>
  `);
  app.querySelectorAll('[data-eq]').forEach((b) => {
    b.onclick = () => { equipoActual = b.dataset.eq; abrir('equipo'); };
  });
  const bh = document.getElementById('btnHorom');
  if (bh) bh.onclick = () => formCorregirHorometro(bh, d);
}

function formCorregirHorometro(boton, d) {
  const cont = document.createElement('div');
  cont.className = 'tarjeta';
  cont.innerHTML = `
    <label>Nuevo valor del horómetro</label>
    <input type="number" id="v" step="0.1" value="${d.horom_actual}">
    <label>Motivo de la corrección</label>
    <textarea id="m" rows="2" placeholder="Queda registrado en el log"></textarea>
    <div style="height:.7rem"></div>
    <button class="principal" id="ok" disabled>Confirmar la corrección</button>`;
  boton.after(cont);
  boton.hidden = true;
  const v = cont.querySelector('#v');
  const m = cont.querySelector('#m');
  const ok = cont.querySelector('#ok');
  const revisar = () => { ok.disabled = !(m.value.trim() && v.value !== '' && Number(v.value) !== d.horom_actual); };
  v.oninput = revisar; m.oninput = revisar;
  ok.onclick = conError(async () => {
    ok.disabled = true;
    await pedir('corregir_horometro', { equipo: d.equipo, valor: Number(v.value), motivo: m.value.trim() });
    abrir('equipo');
  });
}

// ---------- Certificación ----------

let mesActual = null;

async function verCertificacion() {
  const d = await pedir('certificacion', mesActual ? { mes: mesActual } : {});
  mesActual = d.mes;
  pintar(`
    <h2>Certificación — ${d.mes}</h2>
    <p class="ayuda">Es lo que se cruza contra el certificado de prestaciones.</p>
    <div class="tarjeta">
      <label>Mes</label>
      <input type="month" id="mes" value="${d.mes}">
    </div>
    ${d.equipos.map((e) => `
      <div class="tarjeta">
        <div class="fila" style="border:0;padding-top:0"><strong style="font-size:1.05rem">${e.equipo}</strong></div>
        <div class="fila"><span class="tenue">Horas trabajadas</span><span><strong>${e.horas_trabajadas.toFixed(1)} h</strong></span></div>
        <div class="fila"><span class="tenue">Días con tarja</span><span>${e.dias_con_tarja}</span></div>
        <div class="fila" style="border:0"><span class="tenue">Jornadas con horómetro corregido</span>
          <span>${e.jornadas_excepcion ? `<span class="chip alerta">${e.jornadas_excepcion}</span>` : '0'}</span></div>
        ${e.dias_sin_firmar ? aviso('alerta', `${e.dias_sin_firmar} jornada(s) quedaron abiertas y no cuentan como horas.`) : ''}
      </div>`).join('')}
  `);
  document.getElementById('mes').onchange = (ev) => { mesActual = ev.target.value; abrir('certificacion'); };
}

// ---------- arranque ----------

iniciar();
