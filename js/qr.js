/* global jsQR, qrcode */
// Lecture et génération de QR codes, entièrement sur l'appareil.

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

export const isUuid = s => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test((s || '').trim());

// Format EMVCo (QR marchands/paiement) : suites TAG(2) LONGUEUR(2) VALEUR
function parseTLV(s) {
  const out = {};
  let i = 0;
  while (i + 4 <= s.length) {
    const tag = s.slice(i, i + 2);
    const len = Number(s.slice(i + 2, i + 4));
    if (!Number.isInteger(len) || i + 4 + len > s.length) return null;
    out[tag] = s.slice(i + 4, i + 4 + len);
    i += 4 + len;
  }
  return i === s.length ? out : null;
}

/** Analyse le contenu brut d'un QR et en tire ce qu'on peut. Rien n'est inventé. */
export function parsePayload(text) {
  const raw = (text || '').trim();
  const r = { raw, alias: '', name: '', city: '', kind: 'text' };
  if (!raw) return r;

  if (/^000201/.test(raw)) {
    const tlv = parseTLV(raw);
    if (tlv) {
      r.kind = 'emv';
      r.name = (tlv['59'] || '').trim();
      r.city = (tlv['60'] || '').trim();
      for (let k = 26; k <= 51; k++) {
        const v = tlv[String(k)];
        const m = v && v.match(UUID);
        if (m) { r.alias = m[0]; break; }
      }
    }
  }
  if (!r.alias) { const m = raw.match(UUID); if (m) r.alias = m[0]; }
  if (r.kind === 'text') {
    if (/^https?:\/\//i.test(raw)) r.kind = 'url';
    else if (/^WIFI:/i.test(raw)) {
      r.kind = 'wifi';
      const m = raw.match(/S:((?:\\.|[^;])*)/);
      if (m) r.name = m[1].replace(/\\(.)/g, '$1');
    } else if (/^(tel:|\+?\d[\d\s]{6,})/i.test(raw)) r.kind = 'tel';
  }
  return r;
}

async function toDrawable(file) {
  if ('createImageBitmap' in window) {
    try { return await createImageBitmap(file); } catch { /* repli ci-dessous */ }
  }
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = e => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}
const dims = d => [d.width || d.naturalWidth || d.videoWidth, d.height || d.naturalHeight || d.videoHeight];

// withMargin : ajoute une marge blanche autour (zone de silence). Sans elle, un QR qui touche le bord
// de l'image n'est souvent pas trouvé par jsQR, alors que le scanner du téléphone le lit.
function drawScaled(src, max, withMargin = false) {
  const [w, h] = dims(src);
  const k = Math.min(1, max / Math.max(w, h));
  const sw = Math.max(1, Math.round(w * k));
  const sh = Math.max(1, Math.round(h * k));
  const m = withMargin ? Math.round(Math.max(sw, sh) * 0.15) : 0;
  const c = document.createElement('canvas');
  c.width = sw + 2 * m;
  c.height = sh + 2 * m;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(src, m, m, sw, sh);
  return { c, ctx };
}

// Noir/blanc à seuil fixe : jsQR ne trouve pas toujours son propre seuil sur les QR de couleur moyenne (ex. bleu).
function binarize(data, t) {
  const out = new Uint8ClampedArray(data.length);
  for (let i = 0; i < data.length; i += 4) {
    const l = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    const v = l < t ? 0 : 255;
    out[i] = out[i + 1] = out[i + 2] = v;
    out[i + 3] = 255;
  }
  return out;
}

// fallback : essaie aussi des seuils fixes (plus lent, utilisé seulement pour les images importées)
function jsqrOn(src, max, inversion = 'attemptBoth', fallback = false) {
  const { c, ctx } = drawScaled(src, max, true);
  const d = ctx.getImageData(0, 0, c.width, c.height);
  const opts = { inversionAttempts: inversion };
  let res = jsQR(d.data, c.width, c.height, opts);
  if (!res && fallback) {
    for (const t of [170, 150, 190]) {
      res = jsQR(binarize(d.data, t), c.width, c.height, opts);
      if (res) break;
    }
  }
  return res ? res.data : null;
}

let detector;
function getDetector() {
  if (detector !== undefined) return detector;
  detector = null;
  try { if ('BarcodeDetector' in window) detector = new window.BarcodeDetector({ formats: ['qr_code'] }); } catch { detector = null; }
  return detector;
}

/** Lit le QR d'une image (capture d'écran, photo…). Renvoie { text, image } */
export async function readImage(file) {
  const src = await toDrawable(file);
  let text = null;
  const bd = getDetector();
  if (bd) { try { const r = await bd.detect(src); if (r[0]) text = r[0].rawValue; } catch { /* ignore */ } }
  if (!text) for (const m of [1000, 1600, 700, 2400]) { text = jsqrOn(src, m, 'attemptBoth', true); if (text) break; }
  return { text, image: toDataURL(src, 900) };
}

export function toDataURL(src, max = 900, type = 'image/jpeg') {
  const { c } = drawScaled(src, max);
  return c.toDataURL(type, 0.88);
}
export async function fileToDataURL(file, max = 900, type) {
  return toDataURL(await toDrawable(file), max, type);
}

// ---------- Scanner caméra ----------
let stream = null;
let raf = 0;
export async function startScanner(video, onFound) {
  stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false,
  });
  video.srcObject = stream;
  await video.play();
  const bd = getDetector();
  let last = 0, busy = false;
  const tick = async ts => {
    raf = requestAnimationFrame(tick);
    if (busy || ts - last < 160 || video.readyState < 2) return;
    last = ts; busy = true;
    try {
      let text = null;
      if (bd) { try { const r = await bd.detect(video); if (r[0]) text = r[0].rawValue; } catch { /* ignore */ } }
      if (!text) text = jsqrOn(video, 720, 'dontInvert');
      if (text && stream) {
        const image = toDataURL(video, 900);
        stopScanner();
        if (navigator.vibrate) navigator.vibrate(30);
        onFound(text, image);
      }
    } finally { busy = false; }
  };
  raf = requestAnimationFrame(tick);
}
export function stopScanner() {
  cancelAnimationFrame(raf);
  if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
}

// ---------- Génération ----------
export function qrSvg(text, dark = '#0E1215') {
  if (qrcode.stringToBytesFuncs && qrcode.stringToBytesFuncs['UTF-8']) qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];
  const q = qrcode(0, text.length > 300 ? 'L' : 'M');
  q.addData(text, 'Byte');
  q.make();
  const n = q.getModuleCount();
  const m = 3;
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += `M${c + m} ${r + m}h1v1h-1z`;
  const s = n + m * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${s} ${s}" shape-rendering="crispEdges"><rect width="${s}" height="${s}" fill="#fff"/><path d="${d}" fill="${dark}"/></svg>`;
}

/** Convertit un SVG en PNG (dataURL) pour l'enregistrer ou le partager. */
export function svgToPng(svg, size = 1024) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = c.height = size;
      const ctx = c.getContext('2d');
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, 0, 0, size, size);
      resolve(c.toDataURL('image/png'));
    };
    img.onerror = reject;
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  });
}

/** Logo : recadré au centre en carré, 192 px, PNG. Marche avec une capture d'écran de l'icône d'une app. */
export async function logoFromFile(file) {
  const src = await toDrawable(file);
  const [w, h] = dims(src);
  const side = Math.min(w, h);
  const c = document.createElement('canvas');
  c.width = c.height = 192;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, (w - side) / 2, (h - side) / 2, side, side, 0, 0, 192, 192);
  return c.toDataURL('image/png');
}
