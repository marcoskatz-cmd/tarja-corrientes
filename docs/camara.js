/**
 * Cámara en vivo con sello quemado en el pixel.
 *
 * La galería queda bloqueada a propósito: la foto tiene que ser del momento.
 * El sello (fecha, hora, equipo, coordenadas) se dibuja sobre la imagen antes
 * de subirla, así viaja adentro y no en metadata que se puede discutir o que
 * Drive puede recomprimir.
 */

const LADO_MAX = 1600;

let stream = null;
let coords = null;

// Pedimos la ubicación una vez y la vamos refrescando en segundo plano.
if (navigator.geolocation) {
  navigator.geolocation.watchPosition(
    (p) => { coords = { lat: p.coords.latitude, lon: p.coords.longitude }; },
    () => { coords = null; },
    { enableHighAccuracy: true, maximumAge: 60000, timeout: 15000 }
  );
}

function ubicacion() { return coords; }

async function abrirCamara(video) {
  if (stream) cerrarCamara();
  stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 } },
    audio: false
  });
  video.srcObject = stream;
  await video.play();
}

function cerrarCamara() {
  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
    stream = null;
  }
}

/**
 * Captura el cuadro actual, lo reescala, le quema el sello y devuelve un dataURL.
 * @param {HTMLVideoElement} video
 * @param {string} equipo
 * @param {string} fechaHoraServidor  texto ya formateado que vino del backend
 */
function capturar(video, equipo, fechaHoraServidor) {
  const w0 = video.videoWidth;
  const h0 = video.videoHeight;
  if (!w0 || !h0) throw new Error('La cámara todavía no está lista.');

  const escala = Math.min(1, LADO_MAX / Math.max(w0, h0));
  const w = Math.round(w0 * escala);
  const h = Math.round(h0 * escala);

  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  ctx.drawImage(video, 0, 0, w, h);

  const u = ubicacion();
  const lineas = [
    `${equipo} — ${fechaHoraServidor}`,
    u ? `${u.lat.toFixed(5)}, ${u.lon.toFixed(5)}` : 'Sin señal de GPS'
  ];

  const alto = Math.max(14, Math.round(h * 0.032));
  const pad = Math.round(alto * 0.5);
  const cajaAlto = lineas.length * (alto + pad) + pad;

  ctx.fillStyle = 'rgba(0,0,0,0.62)';
  ctx.fillRect(0, h - cajaAlto, w, cajaAlto);
  ctx.font = `600 ${alto}px system-ui, sans-serif`;
  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'top';
  lineas.forEach((t, i) => {
    ctx.fillText(t, pad, h - cajaAlto + pad + i * (alto + pad));
  });

  return c.toDataURL('image/jpeg', 0.72);
}

window.Camara = { abrirCamara, cerrarCamara, capturar, ubicacion };
