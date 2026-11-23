// Kayit — tes alias PI-SPI et tes QR codes, au même endroit. Rien ne quitte le téléphone.
import { db } from './db.js';
import { parsePayload, readImage, logoFromFile, startScanner, stopScanner, qrSvg, svgToPng, isUuid } from './qr.js';

const VERSION = '1.1.0';

// ---------------------------------------------------------------- Données de référence
const COUNTRIES = [
  ['SN', 'Sénégal', '🇸🇳'], ['CI', "Côte d'Ivoire", '🇨🇮'], ['ML', 'Mali', '🇲🇱'], ['BF', 'Burkina Faso', '🇧🇫'],
  ['NE', 'Niger', '🇳🇪'], ['TG', 'Togo', '🇹🇬'], ['BJ', 'Bénin', '🇧🇯'], ['GW', 'Guinée-Bissau', '🇬🇼'], ['', 'Autre / aucun', '🌍'],
];
const PRESETS = {
  'Wave': '#1DC8FF', 'Orange Money': '#FF7900', 'Mixx by Yas': '#FFD100', 'Wizall Money': '#6F3CE0',
  'Moov Money': '#0066B3', 'MTN MoMo': '#FFCB05', 'Djamo': '#6C5CE7', 'CBAO': '#E2231A', 'Ecobank': '#1E5AA8',
  'Société Générale': '#E9041E', 'UBA': '#D71920', 'Bank of Africa': '#00529B', 'Coris Bank': '#C8102E',
  'Banque Atlantique': '#F58220', 'La Poste': '#FFCC00', 'WhatsApp': '#25D366', 'Instagram': '#E1306C',
  'TikTok': '#FE2C55', 'Wi-Fi': '#7CD4FF', 'Site web': '#C8F25A',
};
const SWATCHES = ['#1DC8FF', '#FF7900', '#FFD100', '#6F3CE0', '#E2231A', '#1E5AA8', '#25D366', '#C8F25A', '#FF7A5C', '#E9E3D5'];

// ---------------------------------------------------------------- État
const S = {
  items: [],
  view: 'codes',
  q: { codes: '', carnet: '' },
  filter: { codes: 'all', carnet: 'all' },
  profile: { name: '', bio: '', ids: [], base: '' },
  settings: { theme: 'auto' },
  logos: {},
  installEvt: null,
};

// ---------------------------------------------------------------- Utilitaires
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const icon = (id, cls = '') => `<svg viewBox="0 0 24 24" class="${cls}" aria-hidden="true"><use href="#${id}"/></svg>`;
const safeColor = c => (/^#[0-9a-f]{6}$/i.test(c || '') ? c : '');
const safeImg = s => (typeof s === 'string' && /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(s) ? s : '');
const country = code => COUNTRIES.find(c => c[0] === code) || null;
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

function hashColor(s) {
  let h = 0;
  for (const ch of String(s || '?')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return SWATCHES[h % SWATCHES.length];
}
function inkFor(hex) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [n >> 16 & 255, n >> 8 & 255, n & 255];
  return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? '#0E1215' : '#FFFFFF';
}
function initials(s) {
  const w = String(s || '?').trim().split(/[\s\-_'.]+/).filter(Boolean);
  if (!w.length) return '?';
  return (w.length === 1 ? w[0].slice(0, 2) : w[0][0] + w[1][0]).toUpperCase();
}
const logoKey = p => norm(p).trim();
const logoFor = p => (p ? safeImg(S.logos[logoKey(p)]) : '');
async function setLogo(provider, data) {
  const k = logoKey(provider);
  if (!k) return;
  if (data) S.logos[k] = data; else delete S.logos[k];
  await db.set('logos', { ...S.logos });
  S.items.filter(i => i.logo && logoKey(i.provider) === k).forEach(i => { i.logo = ''; save(i); });
}
const titleOf = it => (it.owner === 'me' ? (it.provider || 'Sans nom') : (it.name || 'Sans nom'));
const colorOf = it => safeColor(it.color) || PRESETS[it.provider] || hashColor(it.provider || it.name);
const copyValueOf = it => it.alias || it.qrText || '';

function badge(it, cls = '') {
  const c = colorOf(it);
  const plogo = logoFor(it.provider);
  if (it.owner === 'carnet') {
    return `<span class="badge-wrap"><span class="badge ${cls}" style="--c:${c};--ci:${inkFor(c)}">${esc(initials(it.name))}</span>${plogo ? `<img class="badge-mini" src="${plogo}" alt="">` : ''}</span>`;
  }
  const logo = safeImg(it.logo) || plogo;
  return `<span class="badge ${cls}${logo ? ' has-logo' : ''}" style="--c:${c};--ci:${inkFor(c)}">${logo ? `<img src="${logo}" alt="">` : esc(initials(it.provider))}</span>`;
}
function aliasHtml(a) {
  return esc(a).replace(/-/g, '-<wbr>');
}
function copyLabel(it) {
  if (it.alias) return 'Alias PI-SPI';
  const k = parsePayload(it.qrText).kind;
  return { url: 'Lien', wifi: 'Contenu Wi-Fi', tel: 'Numéro', emv: 'Code marchand' }[k] || 'Contenu du QR';
}
function guessProvider(text, parsed) {
  const t = norm(text);
  if (parsed.kind === 'wifi') return 'Wi-Fi';
  if (/wave\.com|\bwave\b/.test(t)) return 'Wave';
  if (/orange/.test(t)) return 'Orange Money';
  if (/wa\.me|whatsapp/.test(t)) return 'WhatsApp';
  if (/instagram/.test(t)) return 'Instagram';
  if (/tiktok/.test(t)) return 'TikTok';
  if (/djamo/.test(t)) return 'Djamo';
  if (parsed.kind === 'url') { try { return new URL(text).hostname.replace(/^www\./, ''); } catch { /* */ } }
  return '';
}

let toastT;
function toast(msg, ok = true) {
  const t = $('#toast');
  t.innerHTML = (ok ? icon('i-check') : icon('i-info')) + esc(msg);
  t.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('show'), 1900);
}

async function copyText(text, el) {
  if (!text) return;
  try { await navigator.clipboard.writeText(text); } catch {
    const ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
  }
  if (navigator.vibrate) navigator.vibrate(12);
  if (el) { el.classList.add('done'); setTimeout(() => el.classList.remove('done'), 1400); }
  toast('Copié — colle-le dans ton app de paiement');
}

function pickFile(input) {
  return new Promise(resolve => {
    const el = $(input);
    el.value = '';
    el.onchange = () => resolve(el.files && el.files[0] ? el.files[0] : null);
    el.oncancel = () => resolve(null);
    el.click();
  });
}

function download(dataUrlOrBlob, filename) {
  const url = typeof dataUrlOrBlob === 'string' ? dataUrlOrBlob : URL.createObjectURL(dataUrlOrBlob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  if (typeof dataUrlOrBlob !== 'string') setTimeout(() => URL.revokeObjectURL(url), 4000);
}
async function shareOrDownloadImage(dataUrl, filename, title) {
  try {
    const blob = await (await fetch(dataUrl)).blob();
    const file = new File([blob], filename, { type: blob.type });
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title }); return; }
  } catch (e) { if (e && e.name === 'AbortError') return; }
  download(dataUrl, filename);
}

// ---------------------------------------------------------------- Persistance
async function load() {
  S.items = (await db.all()) || [];
  S.profile = Object.assign(S.profile, (await db.get('profile')) || {});
  S.settings = Object.assign(S.settings, (await db.get('settings')) || {});
  S.logos = (await db.get('logos')) || {};
  // anciens logos posés sur un seul code : on les range dans la bibliothèque
  for (const i of S.items) if (safeImg(i.logo) && i.provider && !S.logos[logoKey(i.provider)]) S.logos[logoKey(i.provider)] = i.logo;
}
async function save(it) {
  it.updatedAt = Date.now();
  await db.put(it);
  const i = S.items.findIndex(x => x.id === it.id);
  if (i >= 0) S.items[i] = it; else S.items.push(it);
}
async function remove(id) {
  await db.del(id);
  S.items = S.items.filter(x => x.id !== id);
  S.profile.ids = S.profile.ids.filter(x => x !== id);
  await db.set('profile', S.profile);
}
const saveProfile = () => db.set('profile', { ...S.profile });
const saveSettings = () => db.set('settings', { ...S.settings });

function applyTheme() {
  document.documentElement.dataset.theme = S.settings.theme || 'auto';
}

// ---------------------------------------------------------------- Rendu des listes
function sorted(list) {
  return list.slice().sort((a, b) => (b.fav - a.fav) || titleOf(a).localeCompare(titleOf(b), 'fr') || a.createdAt - b.createdAt);
}
function matches(it, q) {
  if (!q) return true;
  const c = country(it.country);
  const hay = norm([it.name, it.provider, it.label, it.alias, it.qrText, it.note, c && c[1], it.ctype].join(' '));
  return norm(q).split(/\s+/).every(w => hay.includes(w));
}

function ticket(it, i = 0) {
  const c = country(it.country);
  const val = copyValueOf(it);
  const sub = [];
  if (it.owner === 'carnet' && it.provider) sub.push(esc(it.provider));
  if (it.owner === 'me' && it.label) sub.push(esc(it.label));
  if (c && c[0]) sub.push(`${c[2]} ${esc(c[1])}`);
  const tags = [];
  if (it.owner === 'carnet') tags.push(`<span class="tag">${it.ctype === 'marchand' ? 'Marchand' : 'Proche'}</span>`);
  tags.push(it.type === 'alias' ? '<span class="tag pi">PI-SPI</span>' : '<span class="tag">QR</span>');
  const thumb = it.type === 'qr' && (it.qrImg || it.qrText)
    ? `<span class="t-thumb">${safeImg(it.qrImg) ? `<img src="${safeImg(it.qrImg)}" alt="">` : qrSvg(it.qrText)}</span>` : '';
  const isUrl = !it.alias && /^https?:/i.test(val);
  return `
  <article class="ticket" style="--c:${colorOf(it)};animation-delay:${Math.min(i, 8) * 35}ms" data-id="${it.id}">
    <div class="t-top">
      <button class="t-open" data-action="open" aria-label="Ouvrir ${esc(titleOf(it))}">
        ${badge(it, it.owner === 'carnet' ? 'round' : '')}
        <span class="t-meta">
          <h3 class="t-name">${esc(titleOf(it))}</h3>
          <span class="t-sub">${sub.join(' · ')} ${tags.join('')}</span>
        </span>
      </button>
      ${thumb}
      <button class="star ${it.fav ? 'on' : ''}" data-action="fav" aria-label="${it.fav ? 'Retirer des favoris' : 'Mettre en favori'}" aria-pressed="${!!it.fav}">${icon(it.fav ? 'i-star-fill' : 'i-star')}</button>
    </div>
    <div class="perf"></div>
    ${val ? `
    <button class="t-copy" data-action="copy" aria-label="Copier">
      <span class="grow"><span class="lbl">${copyLabel(it)}</span><code class="${it.alias ? '' : 'clip'}">${it.alias ? aliasHtml(it.alias) : esc(isUrl ? val.replace(/^https?:\/\//, '') : val)}</code></span>
      <span class="copy-ico">${icon('i-copy')}</span>
    </button>` : `
    <button class="t-copy none" data-action="open">${icon('i-qr')}<span class="grow">QR en image — touche pour l'afficher</span>${icon('i-arrow')}</button>`}
  </article>`;
}

const EMPTY_ART = `<svg class="empty-art" viewBox="0 0 120 90" aria-hidden="true">
  <rect x="14" y="16" width="92" height="58" rx="12" fill="none" stroke="currentColor" stroke-opacity=".25" stroke-width="2" stroke-dasharray="5 5" transform="rotate(-6 60 45)"/>
  <g transform="rotate(5 60 45)"><rect x="22" y="20" width="76" height="50" rx="11" fill="#C8F25A"/>
  <rect x="32" y="31" width="10" height="10" rx="2" fill="#0E1215"/><rect x="32" y="47" width="10" height="10" rx="2" fill="#0E1215"/><rect x="48" y="31" width="10" height="10" rx="2" fill="#0E1215"/>
  <path d="M66 34h22M66 44h16M66 54h20" stroke="#0E1215" stroke-width="3" stroke-linecap="round"/></g></svg>`;

function viewList(kind) {
  const owner = kind === 'codes' ? 'me' : 'carnet';
  const all = S.items.filter(i => i.owner === owner);
  const f = S.filter[kind];
  const q = S.q[kind];
  const chipsDef = kind === 'codes'
    ? [['all', 'Tous', all.length], ['alias', 'Alias PI-SPI', all.filter(i => i.type === 'alias').length], ['qr', 'Autres QR', all.filter(i => i.type === 'qr').length], ['fav', 'Favoris', all.filter(i => i.fav).length]]
    : [['all', 'Tous', all.length], ['proche', 'Proches', all.filter(i => i.ctype !== 'marchand').length], ['marchand', 'Marchands', all.filter(i => i.ctype === 'marchand').length], ['fav', 'Favoris', all.filter(i => i.fav).length]];
  const pass = it => f === 'all' || (f === 'fav' && it.fav) || (f === 'alias' && it.type === 'alias') || (f === 'qr' && it.type === 'qr')
    || (f === 'proche' && it.ctype !== 'marchand') || (f === 'marchand' && it.ctype === 'marchand');
  const list = sorted(all.filter(pass).filter(it => matches(it, q)));

  const title = kind === 'codes' ? 'Mes <em>codes</em>' : 'Mon <em>carnet</em>';
  const sub = kind === 'codes'
    ? 'Tes alias PI-SPI et tous tes QR codes, prêts à copier.'
    : "Les QR de tes proches et des marchands, scannés une fois, gardés ici.";

  let body;
  if (!all.length) {
    body = kind === 'codes' ? `
      <div class="empty">${EMPTY_ART}<h3>Ajoute ton premier code</h3>
        <p>Scanne ton QR, importe une capture d'écran, ou saisis ton alias PI-SPI à la main.</p>
        <div class="row"><button class="btn primary" data-action="scan" data-owner="me">${icon('i-scan')}Scanner</button>
        <button class="btn" data-action="import" data-owner="me">${icon('i-image')}Importer</button>
        <button class="btn ghost" data-action="manual" data-owner="me">${icon('i-pen')}Saisir</button></div></div>` : `
      <div class="empty">${EMPTY_ART}<h3>Ton carnet est vide</h3>
        <p>Scanne le QR d'un proche ou d'un marchand pour le retrouver en un clic.</p>
        <div class="row"><button class="btn primary" data-action="scan" data-owner="carnet">${icon('i-scan')}Scanner un QR</button>
        <button class="btn" data-action="import" data-owner="carnet">${icon('i-image')}Importer</button></div></div>`;
  } else if (!list.length) {
    body = `<div class="empty"><h3>Rien trouvé</h3><p>Aucun résultat pour cette recherche.</p></div>`;
  } else {
    body = `<div class="list">${list.map(ticket).join('')}</div>`;
  }

  return `
    <div class="v-head"><h1 class="v-title">${title}</h1><span class="v-count">${String(all.length).padStart(2, '0')}</span></div>
    <p class="v-sub">${sub}</p>
    ${all.length ? `<label class="search">${icon('i-search')}<input type="search" data-search="${kind}" value="${esc(q)}" placeholder="Nom, établissement, alias…" autocomplete="off" enterkeyhint="search"></label>
    <div class="chips" role="group">${chipsDef.map(([k, l, n]) => `<button class="chip" data-filter="${kind}:${k}" aria-pressed="${f === k}">${l}<b>${n}</b></button>`).join('')}</div>` : ''}
    ${body}
    <div class="notice">${icon('i-info')}<span><b>Kayit ne paie pas.</b> Le paiement se fait toujours dans l'app de ton opérateur, qui affiche le nom du bénéficiaire : vérifie-le avant de valider.</span></div>`;
}

// ---------------------------------------------------------------- Profil public
function shareable(it) {
  const v = it.alias || it.qrText;
  return it.owner === 'me' && v && v.length <= 400;
}
function b64urlEncode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  bytes.forEach(b => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return new TextDecoder().decode(Uint8Array.from(atob(s), c => c.charCodeAt(0)));
}
function baseUrl() {
  const b = (S.profile.base || '').trim();
  if (b) return b.replace(/#.*$/, '');
  return location.origin + location.pathname;
}
/* Format de lien v2 (court, synchrone, sans JSON ni base64) :
   "~" + nom , bio ; entrée ; entrée …   avec entrée = type + provider , pays , libellé , valeur , couleur
   - type : a = alias texte, u = alias UUID (16 octets -> 22 car. base64url), q = texte de QR
   - champs vides finaux omis ; couleur = 6 hex sans « # »
   - échappement : espace -> "+", caractères sûrs gardés tels quels, le reste en %XX (UTF-8).
     Jamais de , ; % & ? # ' ( ) " < > ` espace ^ { } | \ bruts dans le fragment.
   Les anciens liens v1 (base64url du JSON, commencent par "ey") restent lisibles. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAFE2_RE = /^[A-Za-z0-9\-._~!$*=:@/]$/;
const ENC2 = new TextEncoder();
function esc2(s) {
  let o = '';
  for (const ch of String(s)) {
    if (ch === ' ') o += '+';
    else if (SAFE2_RE.test(ch)) o += ch;
    else ENC2.encode(ch).forEach(b => { o += '%' + (b < 16 ? '0' : '') + b.toString(16).toUpperCase(); });
  }
  return o;
}
function unesc2(s) { return decodeURIComponent(s.replace(/\+/g, ' ')); }
function uuidPack(u) {
  const h = u.replace(/-/g, '');
  let bin = '';
  for (let i = 0; i < 32; i += 2) bin += String.fromCharCode(parseInt(h.substr(i, 2), 16));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function uuidUnpack(s) {
  if (!/^[A-Za-z0-9_-]{22}$/.test(s)) return '';
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==');
  let h = '';
  for (let i = 0; i < 16; i++) h += bin.charCodeAt(i).toString(16).padStart(2, '0');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
const trimEnd2 = arr => { while (arr.length && !arr[arr.length - 1]) arr.pop(); return arr; };
function encodeProfileV2(name, bio, chosen) {
  const head = trimEnd2([esc2(name.trim().slice(0, 60)), esc2(bio.trim().slice(0, 120))]).join(',');
  const ents = chosen.map(i => {
    const v = i.alias || i.qrText;
    const t = i.alias ? (UUID_RE.test(v) ? 'u' : 'a') : 'q';
    const f = trimEnd2([
      esc2((i.provider || '').slice(0, 40)), esc2((i.country || '').slice(0, 2)), esc2((i.label || '').slice(0, 40)),
      t === 'u' ? uuidPack(v) : esc2(v), (safeColor(i.color) || '').slice(1),
    ]);
    return t + f.join(',');
  });
  return '~' + [head, ...ents].join(';').replace(/;+$/, '');
}
function decodeProfileV2(p) {
  if (!p) return null;
  const str = (x, n) => (x || '').slice(0, n);
  const segs = p.split(';');
  const head = segs[0].split(',');
  const entries = [];
  for (const seg of segs.slice(1, 31)) {
    const t = seg[0];
    if (t !== 'a' && t !== 'u' && t !== 'q') continue;
    const f = seg.slice(1).split(',');
    const value = t === 'u' ? uuidUnpack(f[3] || '') : str(unesc2(f[3] || ''), 400);
    if (!value) continue;
    entries.push({
      type: t === 'q' ? 'qr' : 'alias', provider: str(unesc2(f[0] || ''), 40), country: str(unesc2(f[1] || ''), 2),
      label: str(unesc2(f[2] || ''), 40), value, color: safeColor(/^[0-9a-f]{6}$/i.test(f[4] || '') ? '#' + f[4] : ''),
    });
  }
  return { name: str(unesc2(head[0] || ''), 60), bio: str(unesc2(head[1] || ''), 120), entries };
}
function profileLink() {
  const chosen = S.profile.ids.map(id => S.items.find(i => i.id === id)).filter(i => i && shareable(i));
  return { url: `${baseUrl()}#/p/${encodeProfileV2(S.profile.name, S.profile.bio, chosen)}`, count: chosen.length };
}
function decodeProfile(hash) {
  try {
    const raw = hash.split(/[?&]/)[0];
    if (raw[0] === '~') return decodeProfileV2(raw.slice(1));
    const d = JSON.parse(b64urlDecode(raw));
    if (!d || !Array.isArray(d.a)) return null;
    const str = (x, n) => (typeof x === 'string' ? x.slice(0, n) : '');
    return {
      name: str(d.n, 60), bio: str(d.b, 120),
      entries: d.a.slice(0, 30).filter(Array.isArray).map(e => ({
        type: e[0] === 'q' ? 'qr' : 'alias', provider: str(e[1], 40), country: str(e[2], 2), label: str(e[3], 40),
        value: str(e[4], 400), color: safeColor(e[5]),
      })).filter(e => e.value),
    };
  } catch { return null; }
}

function viewProfil() {
  const mine = sorted(S.items.filter(i => i.owner === 'me'));
  const { url, count } = profileLink();
  const chosen = S.profile.ids.map(id => S.items.find(i => i.id === id)).filter(i => i && shareable(i));
  const isLocal = /^(http:\/\/)?(localhost|127\.|192\.168\.|10\.)|^file:/.test(baseUrl());
  return `
    <div class="v-head"><h1 class="v-title">Mon <em>lien</em></h1></div>
    <p class="v-sub">Un seul lien pour partager tes moyens de paiement. Tout est dans le lien : rien n'est stocké en ligne.</p>
    <div class="profile-card">
      <div class="pc-top"><span class="avatar">${esc(initials(S.profile.name || '?'))}</span>
        <div><p class="pc-name">${esc(S.profile.name || 'Ton nom')}</p><p class="pc-bio">${esc(S.profile.bio || 'Une petite phrase (optionnelle)')}</p></div></div>
      <div class="pc-list">${chosen.length ? chosen.map(i => `<span>${esc(i.provider || 'QR')}${i.label ? ' · ' + esc(i.label) : ''}</span>`).join('') : '<span>Aucun moyen de paiement choisi</span>'}</div>
    </div>
    <label class="field"><span>Nom affiché</span><input data-prof="name" value="${esc(S.profile.name)}" maxlength="60" placeholder="Ex. Lassana Siby"></label>
    <label class="field"><span>Petite phrase</span><input data-prof="bio" value="${esc(S.profile.bio)}" maxlength="120" placeholder="Ex. Développeur · Dakar"></label>
    <p class="section-t">À inclure dans le lien</p>
    ${mine.length ? mine.map(i => {
      const ok = shareable(i);
      return `<label class="pick ${ok ? '' : 'off'}"><input type="checkbox" data-pick="${i.id}" ${S.profile.ids.includes(i.id) && ok ? 'checked' : ''} ${ok ? '' : 'disabled'}>
        ${badge(i)}<span class="grow"><b>${esc(titleOf(i))}${i.label ? ' · ' + esc(i.label) : ''}</b><small>${ok ? esc(copyValueOf(i)) : 'QR en image seulement — ne peut pas voyager dans un lien'}</small></span></label>`;
    }).join('') : `<div class="empty"><p>Ajoute d'abord tes codes dans « Mes codes ».</p></div>`}
    <p class="section-t">Ton lien</p>
    <div class="link-box">${esc(count ? url : 'Coche au moins un moyen de paiement.')}</div>
    <div class="grid2">
      <button class="btn primary" data-action="profile-copy" ${count ? '' : 'disabled'}>${icon('i-copy')}Copier</button>
      <button class="btn" data-action="profile-share" ${count ? '' : 'disabled'}>${icon('i-share')}Partager</button>
    </div>
    <div class="row" style="margin-top:10px">
      <button class="btn block" data-action="profile-qr" ${count ? '' : 'disabled'}>${icon('i-qr')}Afficher le QR de mon lien</button>
      <button class="btn block ghost" data-action="profile-preview" ${count ? '' : 'disabled'}>Voir comme les autres le voient</button>
    </div>
    ${isLocal ? `<div class="notice">${icon('i-info')}<span><b>Lien local détecté.</b> Pour que les autres puissent l'ouvrir, héberge Kayit en ligne (O2switch, Vercel…) et indique l'adresse dans Réglages › Adresse publique.</span></div>` : ''}
    <div class="notice">${icon('i-lock')}<span><b>Aucun serveur ne voit ton profil.</b> Tout est dans la partie du lien après le « # », que les navigateurs n'envoient jamais au site. Qui a le lien voit les alias que tu as cochés — rien d'autre.</span></div>
    <div class="notice">${icon('i-info')}<span><b>Un lien déjà envoyé reste valable.</b> Si tu décoches un moyen de paiement, le lien affiché change, mais les anciens liens gardent ce qu'ils contenaient : sans serveur, on ne peut pas les couper. Renvoie le nouveau lien aux personnes concernées.</span></div>`;
}

// ---------------------------------------------------------------- Réglages
function providers() {
  const m = new Map();
  S.items.forEach(i => { const k = logoKey(i.provider); if (k && !m.has(k)) m.set(k, i.provider.trim()); });
  return [...m.values()].sort((a, b) => a.localeCompare(b, 'fr'));
}
function viewReglages() {
  const t = S.settings.theme || 'auto';
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const n = S.items.length;
  return `
    <div class="v-head"><h1 class="v-title">Réglages</h1></div>
    <p class="section-t">Apparence</p>
    <div class="seg" role="group">${[['auto', 'Auto'], ['dark', 'Sombre'], ['light', 'Clair']].map(([k, l]) => `<button data-theme-set="${k}" aria-pressed="${t === k}">${l}</button>`).join('')}</div>

    ${standalone ? '' : `<p class="section-t">Installer</p>
    <div class="set-group">
      ${S.installEvt ? `<button class="set-row" data-action="install">${icon('i-download')}<span class="grow"><b>Installer Kayit</b><small>Sur l'écran d'accueil, fonctionne hors ligne</small></span></button>`
        : `<div class="set-row">${icon('i-download')}<span class="grow"><b>Installer Kayit</b><small>${isIOS ? 'Dans Safari : bouton Partager › « Sur l\'écran d\'accueil ».' : 'Menu du navigateur › « Installer l\'application » ou « Ajouter à l\'écran d\'accueil ».'}</small></span></div>`}
    </div>`}

    <p class="section-t">Sauvegarde</p>
    <div class="set-group">
      <button class="set-row" data-action="export">${icon('i-download')}<span class="grow"><b>Exporter mes données</b><small>${n} élément${n > 1 ? 's' : ''} · fichier .json que tu gardes où tu veux</small></span></button>
      <button class="set-row" data-action="import-json">${icon('i-share')}<span class="grow"><b>Restaurer une sauvegarde</b><small>Fusionne avec ce qui est déjà là</small></span></button>
    </div>

    <p class="section-t">Logos des établissements</p>
    ${providers().length ? `<div class="set-group">${providers().map(pv => `
      <button class="set-row" data-logo-set="${esc(pv)}">${badge({ owner: 'me', provider: pv })}<span class="grow"><b>${esc(pv)}</b><small>${logoFor(pv) ? 'Touche pour changer le logo' : 'Touche pour importer son logo'}</small></span>
      ${logoFor(pv) ? `<span class="btn sm ghost" data-logo-del="${esc(pv)}">Retirer</span>` : icon('i-image')}</button>`).join('')}</div>`
      : '<p class="v-sub" style="margin:0 0 16px">Ajoute un code pour pouvoir lui mettre un logo.</p>'}

    <p class="section-t">Lien public</p>
    <label class="field"><span>Adresse publique de l'app</span><input data-base value="${esc(S.profile.base)}" inputmode="url" placeholder="${esc(location.origin + location.pathname)}">
      <span class="hint">Laisse vide pour utiliser l'adresse actuelle.</span></label>

    <p class="section-t">Ce que Kayit ne fait pas</p>
    <div class="set-group">
      <div class="promise"><i>₣</i><p><b>Il ne paie pas.</b>Le paiement se fait toujours dans l'app de ton opérateur, qui affiche le nom du bénéficiaire.</p></div>
      <div class="promise"><i>↯</i><p><b>Il n'envoie rien.</b>Aucun compte, aucun serveur, aucune statistique, aucun script tiers.</p></div>
      <div class="promise"><i>⌂</i><p><b>Tout reste ici.</b>Tes codes sont rangés dans ce navigateur, sur ce téléphone. Pense à exporter de temps en temps.</p></div>
    </div>

    <p class="section-t">Zone sensible</p>
    <button class="btn danger block" data-action="wipe">${icon('i-trash')}Tout effacer sur ce téléphone</button>
    <p class="pub-foot">Kayit v${VERSION} · fait à Dakar</p>`;
}

// ---------------------------------------------------------------- Navigation
function render() {
  const v = $('#view');
  const map = { codes: () => viewList('codes'), carnet: () => viewList('carnet'), profil: viewProfil, reglages: viewReglages };
  const active = document.activeElement;
  const searchFocus = active && active.dataset && active.dataset.search;
  const caret = searchFocus ? active.selectionStart : 0;
  v.innerHTML = map[S.view]();
  document.querySelectorAll('[data-nav]').forEach(b => b.setAttribute('aria-current', b.dataset.nav === S.view ? 'page' : 'false'));
  if (searchFocus) { const i = v.querySelector(`[data-search="${searchFocus}"]`); if (i) { i.focus(); i.setSelectionRange(caret, caret); } }
}
function go(view) {
  S.view = view;
  render();
  window.scrollTo({ top: 0 });
}

// ---------------------------------------------------------------- Feuilles
let sheetOpen = false;
function openSheet(html, mount) {
  const root = $('#sheet');
  if (!sheetOpen) { history.pushState({ k: 'sheet' }, ''); sheetOpen = true; }
  root.innerHTML = `<div class="sheet-backdrop" data-action="close"></div>
    <div class="sheet" role="dialog" aria-modal="true"><div class="sheet-grip"></div>
    <button class="sheet-close" data-action="close" aria-label="Fermer">${icon('i-x')}</button>${html}</div>`;
  root.hidden = false;
  requestAnimationFrame(() => requestAnimationFrame(() => root.classList.add('open')));
  if (mount) mount(root.querySelector('.sheet'));
}
function hideSheet() {
  const root = $('#sheet');
  sheetOpen = false;
  root.classList.remove('open');
  setTimeout(() => { if (!sheetOpen) { root.hidden = true; root.innerHTML = ''; } }, 240);
}
function closeSheet() {
  if (!sheetOpen) return;
  if (history.state && history.state.k === 'sheet') history.back(); else hideSheet();
}
window.addEventListener('popstate', () => {
  if (!$('#scanner').hidden) { closeScanner(); }
  if (sheetOpen) hideSheet();
  route();
});

function confirmSheet(title, text, okLabel, onOk) {
  openSheet(`<h2>${esc(title)}</h2><p class="lead">${esc(text)}</p>
    <div class="grid2"><button class="btn" data-action="close">Annuler</button><button class="btn danger" id="ok">${esc(okLabel)}</button></div>`,
  el => { $('#ok', el).onclick = async () => { await onOk(); closeSheet(); }; });
}

// ---------------------------------------------------------------- Ajout
function openAdd(owner) {
  owner = owner || (S.view === 'carnet' ? 'carnet' : 'me');
  openSheet(`<h2>Ajouter</h2><p class="lead">Un alias PI-SPI ou n'importe quel QR code (Wave, Orange Money, WhatsApp, Wi-Fi, lien…).</p>
    <div class="seg" role="group"><button data-o="me" aria-pressed="${owner === 'me'}">Pour moi</button><button data-o="carnet" aria-pressed="${owner === 'carnet'}">Au carnet</button></div>
    <div class="action-list">
      <button class="action hl" data-a="scan"><span class="ai">${icon('i-scan')}</span><span><b>Scanner un QR</b><small>Avec la caméra du téléphone</small></span>${icon('i-arrow')}</button>
      <button class="action" data-a="import"><span class="ai">${icon('i-image')}</span><span><b>Importer une image</b><small>Capture d'écran ou photo d'un QR</small></span>${icon('i-arrow')}</button>
      <button class="action" data-a="manual"><span class="ai">${icon('i-pen')}</span><span><b>Saisir à la main</b><small>Coller un alias PI-SPI</small></span>${icon('i-arrow')}</button>
    </div>`, el => {
    el.querySelectorAll('[data-o]').forEach(b => b.onclick = () => {
      owner = b.dataset.o;
      el.querySelectorAll('[data-o]').forEach(x => x.setAttribute('aria-pressed', x === b));
    });
    el.querySelector('[data-a="scan"]').onclick = () => startScanFlow(owner);
    el.querySelector('[data-a="import"]').onclick = () => startImportFlow(owner);
    el.querySelector('[data-a="manual"]').onclick = () => openForm({ owner, type: 'alias' });
  });
}

function draftFromScan(owner, text, image) {
  const p = parsePayload(text || '');
  const d = { owner, type: p.alias ? 'alias' : 'qr', alias: p.alias || '', qrText: text || '', qrImg: image || '', provider: guessProvider(text || '', p) };
  if (owner === 'carnet') { d.name = p.name || ''; if (p.kind === 'emv') d.ctype = 'marchand'; }
  else if (p.name) d.label = p.name;
  if (p.kind === 'emv' && p.city) d.note = p.city;
  return { d, p };
}
function handleScanned(owner, text, image) {
  if (text) {
    const p = parsePayload(text);
    if (p.kind === 'profile') { openPublicImport(p.profile); return; }
  }
  const { d } = draftFromScan(owner, text, image);
  if (!text) toast("Aucun QR lisible — l'image est gardée telle quelle", false);
  openForm(d);
}
async function startImportFlow(owner) {
  const f = await pickFile('#pick-image');
  if (!f) return;
  try {
    const { text, image } = await readImage(f);
    handleScanned(owner, text, image);
  } catch { toast("Impossible de lire cette image", false); }
}
function startScanFlow(owner) {
  openScanner(
    (text, image) => handleScanned(owner, text, image),
    () => startImportFlow(owner),
  );
}

// ---------------------------------------------------------------- Scanner
let scanFileCb = null;
async function openScanner(onFound, onFile) {
  const box = $('#scanner');
  const hint = $('#scan-hint');
  scanFileCb = onFile;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !isSecureContext) {
    toast('Caméra indisponible ici — importe une image', false);
    if (onFile) onFile();
    return;
  }
  box.hidden = false;
  hint.textContent = "Le scan se fait sur le téléphone. Aucune image n'est envoyée.";
  try {
    await startScanner($('#scan-video'), (text, image) => { closeScanner(); onFound(text, image); });
  } catch (e) {
    closeScanner();
    toast(e && e.name === 'NotAllowedError' ? 'Accès caméra refusé — importe une image' : 'Caméra indisponible — importe une image', false);
    if (onFile) onFile();
  }
}
function closeScanner() {
  stopScanner();
  const v = $('#scan-video');
  v.srcObject = null;
  $('#scanner').hidden = true;
}

// ---------------------------------------------------------------- Formulaire
function qrPreview(d) {
  if (safeImg(d.qrImg)) return `<img src="${safeImg(d.qrImg)}" alt="QR">`;
  if (d.qrText) return qrSvg(d.qrText);
  return icon('i-qr');
}
function openForm(init) {
  const editing = !!init.id;
  const d = Object.assign({ owner: 'me', type: 'alias', ctype: 'proche', country: 'SN', fav: false, provider: '', name: '', label: '', alias: '', qrText: '', qrImg: '', logo: '', color: '', note: '' }, init);
  const isMe = d.owner === 'me';
  const opts = Object.keys(PRESETS).map(p => `<option value="${esc(p)}">`).join('');

  const html = `
    <h2>${editing ? 'Modifier' : isMe ? 'Nouveau code' : 'Nouveau contact'}</h2>
    <p class="lead">${isMe ? 'Pour toi : un alias PI-SPI ou un QR de n\'importe quelle app.' : 'Pour ton carnet : le QR d\'un proche ou d\'un marchand.'}</p>
    <div class="seg" role="group" data-g="type"><button data-v="alias">Alias PI-SPI</button><button data-v="qr">Autre QR code</button></div>
    ${isMe ? '' : `
      <label class="field"><span>Nom du contact</span><input name="name" value="${esc(d.name)}" placeholder="Ex. Tata Awa, Boutique Fallou…" maxlength="60" autocomplete="off"></label>
      <div class="seg" role="group" data-g="ctype"><button data-v="proche">Proche</button><button data-v="marchand">Marchand</button></div>`}
    <label class="field"><span>${isMe ? 'Établissement ou app' : 'Établissement ou app (optionnel)'}</span>
      <input name="provider" list="dl-prov" value="${esc(d.provider)}" placeholder="Wave, Orange Money, CBAO, WhatsApp…" maxlength="40" autocomplete="off"><datalist id="dl-prov">${opts}</datalist></label>
    <div class="grid2">
      <label class="field"><span>Pays</span><select name="country">${COUNTRIES.map(c => `<option value="${c[0]}" ${c[0] === d.country ? 'selected' : ''}>${c[2]} ${esc(c[1])}</option>`).join('')}</select></label>
      ${isMe ? `<label class="field"><span>Libellé</span><input name="label" value="${esc(d.label)}" placeholder="Perso, Boutique…" maxlength="40"></label>` : '<span></span>'}
    </div>
    <label class="field" data-alias><span>Alias PI-SPI</span>
      <input name="alias" class="mono" value="${esc(d.alias)}" placeholder="508977c6-7e00-4a75-8b3e-96196e201818" autocapitalize="off" autocorrect="off" spellcheck="false">
      <span class="hint" data-ahint></span></label>
    <span class="field" style="margin-bottom:6px"><span>QR code</span></span>
    <div class="qr-slot"><span class="qv" data-qv>${qrPreview(d)}</span>
      <span class="qa">
        <button class="btn sm" type="button" data-q="scan">${icon('i-scan')}Scanner</button>
        <button class="btn sm" type="button" data-q="import">${icon('i-image')}Importer une image</button>
        <button class="btn sm ghost" type="button" data-q="clear" ${d.qrImg || d.qrText ? '' : 'hidden'}>Retirer le QR</button>
      </span></div>
    <details class="raw" ${d.qrText && !d.alias ? 'open' : ''}><summary>Contenu du QR (texte)</summary>
      <label class="field" style="margin:10px 0 0"><textarea name="qrText" class="mono" rows="3" placeholder="Rempli automatiquement au scan. Tu peux aussi coller un lien ou un texte.">${esc(d.qrText)}</textarea></label></details>
    ${isMe ? `<span class="field" style="margin-bottom:6px"><span>Couleur</span></span>
    <div class="swatches" style="margin-bottom:12px">${['', ...SWATCHES].map(c => `<button type="button" class="swatch" data-sw="${c}" style="--c:${c || 'conic-gradient(#1DC8FF,#C8F25A,#FF7900,#1DC8FF)'}" aria-label="${c || 'Automatique'}" aria-pressed="${(d.color || '') === c}"></button>`).join('')}</div>
    ` : ''}
    <span class="field" style="margin-bottom:6px"><span>Logo de l'établissement</span></span>
    <div class="qr-slot"><span class="qv logo-v" data-logo></span>
      <span class="qa"><button class="btn sm" type="button" data-l="pick">${icon('i-image')}Importer le logo</button>
      <button class="btn sm ghost" type="button" data-l="clear" hidden>Retirer le logo</button>
      <small class="hint" data-lhint>Une capture de l'icône de l'app suffit. Utilisé pour tous tes codes et contacts de cet établissement.</small></span></div>
    <label class="toggle"><span>${icon('i-star')} Favori</span><input type="checkbox" name="fav" ${d.fav ? 'checked' : ''}></label>
    <label class="field"><span>Note (optionnelle)</span><textarea name="note" maxlength="300" placeholder="Ex. compte boutique, à utiliser pour les clients">${esc(d.note)}</textarea></label>
    <div class="grid2"><button class="btn" data-action="close" type="button">Annuler</button><button class="btn primary" type="button" data-save>${icon('i-check')}Enregistrer</button></div>`;

  openSheet(html, el => {
    const f = n => el.querySelector(`[name="${n}"]`);
    const setSeg = (g, v) => el.querySelectorAll(`[data-g="${g}"] button`).forEach(b => b.setAttribute('aria-pressed', b.dataset.v === v));
    setSeg('type', d.type);
    if (!isMe) setSeg('ctype', d.ctype);
    const aliasField = el.querySelector('[data-alias]');
    const hint = el.querySelector('[data-ahint]');
    const refreshAlias = () => {
      const a = f('alias').value.trim();
      aliasField.querySelector('span').textContent = d.type === 'alias' ? 'Alias PI-SPI' : 'Alias PI-SPI (optionnel)';
      if (!a) { hint.textContent = d.type === 'alias' ? 'Colle ici ton alias, ou scanne ton QR.' : 'Laisse vide si ce QR n\'est pas un alias PI-SPI.'; hint.className = 'hint'; }
      else if (isUuid(a)) { hint.textContent = 'Format d\'alias reconnu.'; hint.className = 'hint ok'; }
      else { hint.textContent = 'Format inhabituel — vérifie avant d\'enregistrer.'; hint.className = 'hint warn'; }
    };
    refreshAlias();
    f('alias').addEventListener('input', refreshAlias);
    el.querySelectorAll('[data-g="type"] button').forEach(b => b.onclick = () => { d.type = b.dataset.v; setSeg('type', d.type); refreshAlias(); });
    el.querySelectorAll('[data-g="ctype"] button').forEach(b => b.onclick = () => { d.ctype = b.dataset.v; setSeg('ctype', d.ctype); });

    const refreshQr = () => {
      el.querySelector('[data-qv]').innerHTML = qrPreview(d);
      el.querySelector('[data-q="clear"]').hidden = !(d.qrImg || d.qrText);
      f('qrText').value = d.qrText;
    };
    f('qrText').addEventListener('change', () => { d.qrText = f('qrText').value.trim(); if (!d.qrImg) refreshQr(); });
    const applyScan = (text, image) => {
      const { d: s } = draftFromScan(d.owner, text, image);
      d.qrText = s.qrText; d.qrImg = s.qrImg;
      if (s.alias && !f('alias').value.trim()) { f('alias').value = s.alias; d.type = 'alias'; setSeg('type', 'alias'); }
      if (s.provider && !f('provider').value.trim()) f('provider').value = s.provider;
      if (!isMe && s.name && !f('name').value.trim()) f('name').value = s.name;
      refreshAlias(); refreshQr();
      toast(text ? 'QR lu' : "Aucun QR lisible — l'image est gardée", !!text);
    };
    const importImg = async () => {
      const file = await pickFile('#pick-image');
      if (!file) return;
      try { const { text, image } = await readImage(file); applyScan(text, image); } catch { toast('Impossible de lire cette image', false); }
    };
    el.querySelector('[data-q="scan"]').onclick = () => openScanner(applyScan, importImg);
    el.querySelector('[data-q="import"]').onclick = importImg;
    el.querySelector('[data-q="clear"]').onclick = () => { d.qrImg = ''; d.qrText = ''; refreshQr(); };

    if (isMe) {
      el.querySelectorAll('[data-sw]').forEach(b => b.onclick = () => {
        d.color = b.dataset.sw;
        el.querySelectorAll('[data-sw]').forEach(x => x.setAttribute('aria-pressed', x === b));
      });
    }
    const refreshLogo = () => {
      const prov = f('provider').value.trim();
      const lg = logoFor(prov);
      el.querySelector('[data-logo]').innerHTML = lg ? `<img src="${lg}" alt="">` : `<span class="logo-ph">${esc(prov ? initials(prov) : '—')}</span>`;
      el.querySelector('[data-l="clear"]').hidden = !lg;
    };
    refreshLogo();
    f('provider').addEventListener('input', refreshLogo);
    el.querySelector('[data-l="pick"]').onclick = async () => {
      const prov = f('provider').value.trim();
      if (!prov) { toast("Indique d'abord l'établissement ou l'app", false); f('provider').focus(); return; }
      const file = await pickFile('#pick-image');
      if (!file) return;
      try { await setLogo(prov, await logoFromFile(file)); refreshLogo(); toast(`Logo ${prov} enregistré`); } catch { toast('Image illisible', false); }
    };
    el.querySelector('[data-l="clear"]').onclick = async () => { await setLogo(f('provider').value.trim(), ''); refreshLogo(); };

    el.querySelector('[data-save]').onclick = async () => {
      const it = {
        ...d,
        id: d.id || uid(),
        createdAt: d.createdAt || Date.now(),
        provider: f('provider').value.trim(),
        country: f('country').value,
        alias: f('alias').value.trim(),
        qrText: f('qrText').value.trim(),
        fav: f('fav').checked,
        note: f('note').value.trim(),
      };
      if (isMe) it.label = f('label').value.trim(); else it.name = f('name').value.trim();
      if (isMe && !it.provider) { toast("Indique l'établissement ou l'app", false); f('provider').focus(); return; }
      if (!isMe && !it.name) { toast('Indique le nom du contact', false); f('name').focus(); return; }
      if (!it.alias && !it.qrText && !it.qrImg) { toast('Ajoute un alias ou un QR code', false); return; }
      if (it.type === 'alias' && !it.alias) it.type = 'qr';
      const dup = S.items.find(x => x.id !== it.id && x.owner === it.owner && ((it.alias && x.alias === it.alias) || (!it.alias && it.qrText && x.qrText === it.qrText)));
      await save(it);
      closeSheet();
      if (S.view !== (isMe ? 'codes' : 'carnet')) S.view = isMe ? 'codes' : 'carnet';
      render();
      toast(dup ? 'Enregistré (ce code existait déjà)' : editing ? 'Modifié' : 'Enregistré');
    };
  });
}

// ---------------------------------------------------------------- Détail
function openDetail(id) {
  const it = S.items.find(i => i.id === id);
  if (!it) return;
  const c = country(it.country);
  const img = safeImg(it.qrImg);
  const gen = it.qrText || it.alias;
  let mode = img ? 'img' : 'gen';
  const val = copyValueOf(it);
  const isUrl = !it.alias && /^https?:\/\//i.test(val);

  const html = `
    <div class="detail-head">${badge(it, it.owner === 'carnet' ? 'round' : '')}<div>
      <h2>${esc(titleOf(it))}</h2>
      <p class="lead" style="margin:0">${[it.owner === 'carnet' ? esc(it.provider) : esc(it.label), c && c[0] ? `${c[2]} ${esc(c[1])}` : ''].filter(Boolean).join(' · ') || (it.type === 'alias' ? 'Alias PI-SPI' : 'QR code')}</p></div></div>
    ${img && gen ? `<div class="seg" role="group" data-g="mode"><button data-v="img">Image d'origine</button><button data-v="gen">QR net</button></div>` : ''}
    ${img || gen ? `<div class="qr-stage" data-stage></div><p class="qr-caption" data-cap></p>` : ''}
    ${val ? `<button class="big-copy" data-copy><code>${esc(val)}</code><span class="copy-ico">${icon('i-copy')}</span></button>` : ''}
    <div class="grid2">
      ${isUrl ? `<a class="btn" href="${esc(val)}" target="_blank" rel="noopener noreferrer">${icon('i-link')}Ouvrir le lien</a>` : `<button class="btn" data-share>${icon('i-share')}Partager</button>`}
      <button class="btn" data-dl ${img || gen ? '' : 'disabled'}>${icon('i-download')}Image du QR</button>
      <button class="btn" data-edit>${icon('i-pen')}Modifier</button>
      <button class="btn danger" data-del>${icon('i-trash')}Supprimer</button>
    </div>
    ${it.note ? `<details class="raw" open><summary>Note</summary><pre>${esc(it.note)}</pre></details>` : ''}
    ${it.qrText && it.qrText !== it.alias ? `<details class="raw"><summary>Contenu brut du QR</summary><pre>${esc(it.qrText)}</pre></details>` : ''}
    <div class="notice">${icon('i-info')}<span>Pour payer, ouvre l'app de ton opérateur et colle l'alias ou scanne ce QR. <b>Vérifie le nom du bénéficiaire</b> qu'elle affiche.</span></div>`;

  openSheet(html, el => {
    const stage = el.querySelector('[data-stage]');
    const cap = el.querySelector('[data-cap]');
    const draw = () => {
      if (!stage) return;
      if (mode === 'img') { stage.innerHTML = `<img src="${img}" alt="QR code">`; cap.textContent = 'Image telle que tu l\'as importée ou scannée.'; }
      else {
        stage.innerHTML = qrSvg(gen);
        cap.textContent = it.qrText ? 'Recréé à l\'identique depuis le contenu du QR.' : 'QR contenant le texte de l\'alias — selon l\'opérateur, il peut ne pas être reconnu.';
      }
      el.querySelectorAll('[data-g="mode"] button').forEach(b => b.setAttribute('aria-pressed', b.dataset.v === mode));
    };
    draw();
    el.querySelectorAll('[data-g="mode"] button').forEach(b => b.onclick = () => { mode = b.dataset.v; draw(); });
    const cp = el.querySelector('[data-copy]');
    if (cp) cp.onclick = () => copyText(val, cp);
    const sh = el.querySelector('[data-share]');
    if (sh) sh.onclick = async () => {
      const text = `${titleOf(it)}${it.label ? ' (' + it.label + ')' : ''}\n${it.alias ? 'Alias PI-SPI : ' : ''}${val}`;
      if (navigator.share) { try { await navigator.share({ text }); } catch { /* annulé */ } } else copyText(text);
    };
    el.querySelector('[data-dl]').onclick = async () => {
      const name = `kayit-${norm(titleOf(it)).replace(/[^a-z0-9]+/g, '-')}.png`;
      const url = mode === 'img' && img ? img : await svgToPng(qrSvg(gen));
      shareOrDownloadImage(url, name, titleOf(it));
    };
    el.querySelector('[data-edit]').onclick = () => openForm({ ...it });
    el.querySelector('[data-del]').onclick = () => confirmSheet('Supprimer ?', `« ${titleOf(it)} » sera effacé de ce téléphone.`, 'Supprimer', async () => {
      await remove(it.id); render(); toast('Supprimé');
    });
  });
}

// ---------------------------------------------------------------- Page publique
function publicEntryAsItem(e, i, prof) {
  return { id: 'pub' + i, owner: 'me', type: e.type, provider: e.provider, country: e.country, label: e.label, alias: e.type === 'alias' ? e.value : '', qrText: e.type === 'qr' ? e.value : '', color: e.color, name: prof.name };
}
function renderPublic(hash) {
  const prof = decodeProfile(hash);
  const box = $('#public');
  $('#app').hidden = true;
  box.hidden = false;
  if (!prof) {
    box.innerHTML = `<div class="pub-brand"><div class="brand"><svg class="brand-mark" viewBox="0 0 64 64"><use href="#logo"/></svg><span class="brand-name">Kayit</span></div></div>
      <div class="empty"><h3>Lien illisible</h3><p>Ce lien de profil est incomplet ou abîmé. Demande à la personne de te le renvoyer.</p>
      <button class="btn primary" data-action="leave-public">Ouvrir Kayit</button></div>`;
    return;
  }
  const items = prof.entries.map((e, i) => publicEntryAsItem(e, i, prof));
  box.innerHTML = `
    <div class="pub-brand"><div class="brand"><svg class="brand-mark" viewBox="0 0 64 64"><use href="#logo"/></svg><span class="brand-name">Kayit</span></div>
      <span class="pill-local">${icon('i-lock')}Profil partagé</span></div>
    <div class="profile-card"><div class="pc-top"><span class="avatar">${esc(initials(prof.name || '?'))}</span>
      <div><p class="pc-name">${esc(prof.name || 'Profil sans nom')}</p>${prof.bio ? `<p class="pc-bio">${esc(prof.bio)}</p>` : ''}</div></div>
      <div class="pc-list"><span>${items.length} moyen${items.length > 1 ? 's' : ''} de paiement</span></div></div>
    <div class="list">${items.map((it, i) => `
      <article class="ticket" style="--c:${colorOf(it)};animation-delay:${i * 40}ms" data-pub="${i}">
        <div class="t-top">${badge(it)}<span class="t-meta"><h3 class="t-name">${esc(it.provider || 'QR code')}</h3>
          <span class="t-sub">${[esc(it.label), country(it.country) && it.country ? country(it.country)[2] + ' ' + esc(country(it.country)[1]) : ''].filter(Boolean).join(' · ')} ${it.type === 'alias' ? '<span class="tag pi">PI-SPI</span>' : '<span class="tag">QR</span>'}</span></span>
          <button class="star" data-pubqr="${i}" aria-label="Afficher le QR">${icon('i-qr')}</button></div>
        <div class="perf"></div>
        <button class="t-copy" data-pubcopy="${i}"><span class="grow"><span class="lbl">${copyLabel(it)}</span><code class="${it.alias ? '' : 'clip'}">${it.alias ? aliasHtml(it.alias) : esc(it.qrText)}</code></span><span class="copy-ico">${icon('i-copy')}</span></button>
      </article>`).join('')}</div>
    <div class="pub-actions">
      <button class="btn primary block" data-action="pub-save">${icon('i-book')}Enregistrer dans mon carnet</button>
      <button class="btn block ghost" data-action="leave-public">Ouvrir mon Kayit</button>
    </div>
    <div class="notice">${icon('i-info')}<span><b>Pour payer :</b> copie l'alias puis colle-le dans l'app de ton opérateur. Elle t'affichera le nom du bénéficiaire — vérifie-le avant de valider.</span></div>
    <p class="pub-foot">Ce profil tient entièrement dans le lien. Aucun serveur ne l'a stocké ni lu.</p>`;
  box.onclick = async e => {
    const cp = e.target.closest('[data-pubcopy]');
    if (cp) { const it = items[+cp.dataset.pubcopy]; copyText(copyValueOf(it), cp); return; }
    const q = e.target.closest('[data-pubqr]');
    if (q) {
      const it = items[+q.dataset.pubqr];
      openSheet(`<h2>${esc(it.provider || 'QR code')}</h2><p class="lead">${esc(prof.name)}${it.label ? ' · ' + esc(it.label) : ''}</p>
        <div class="qr-stage">${qrSvg(copyValueOf(it))}</div>
        <p class="qr-caption">${it.alias ? 'QR contenant le texte de l\'alias — si ton app ne le reconnaît pas, copie l\'alias.' : 'Recréé depuis le contenu partagé.'}</p>`);
      return;
    }
    if (e.target.closest('[data-action="pub-save"]')) {
      await load();
      let added = 0;
      for (const it of items) {
        const v = copyValueOf(it);
        if (S.items.some(x => x.owner === 'carnet' && (x.alias === v || x.qrText === v))) continue;
        await save({ ...it, id: uid(), owner: 'carnet', ctype: 'proche', name: prof.name || 'Contact', createdAt: Date.now(), fav: false, note: prof.bio || '' });
        added++;
      }
      toast(added ? `${added} ajouté${added > 1 ? 's' : ''} au carnet` : 'Déjà dans ton carnet');
    }
  };
}
function openPublicImport(hash) {
  const prof = decodeProfile(hash);
  if (!prof) { toast('Lien de profil illisible', false); return; }
  openSheet(`<h2>${esc(prof.name || 'Profil Kayit')}</h2><p class="lead">${prof.entries.length} moyen(s) de paiement dans ce profil.</p>
    <div class="action-list">${prof.entries.map(e => `<div class="pick">${badge({ provider: e.provider, color: e.color, owner: 'me' })}<span class="grow"><b>${esc(e.provider || 'QR')}${e.label ? ' · ' + esc(e.label) : ''}</b><small>${esc(e.value)}</small></span></div>`).join('')}</div>
    <div class="grid2" style="margin-top:14px"><button class="btn" data-action="close">Annuler</button><button class="btn primary" id="imp">Ajouter au carnet</button></div>`,
  el => {
    $('#imp', el).onclick = async () => {
      let added = 0;
      for (const [i, e] of prof.entries.entries()) {
        const it = publicEntryAsItem(e, i, prof);
        const v = copyValueOf(it);
        if (S.items.some(x => x.owner === 'carnet' && (x.alias === v || x.qrText === v))) continue;
        await save({ ...it, id: uid(), owner: 'carnet', ctype: 'proche', name: prof.name || 'Contact', createdAt: Date.now(), fav: false, note: prof.bio || '' });
        added++;
      }
      closeSheet(); S.view = 'carnet'; render();
      toast(added ? `${added} ajouté${added > 1 ? 's' : ''} au carnet` : 'Déjà dans ton carnet');
    };
  });
}

// ---------------------------------------------------------------- Sauvegarde
async function exportData() {
  const data = { app: 'kayit', version: 1, exportedAt: new Date().toISOString(), items: S.items, profile: S.profile, logos: S.logos };
  const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
  const name = `kayit-sauvegarde-${new Date().toISOString().slice(0, 10)}.json`;
  try {
    const file = new File([blob], name, { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: 'Sauvegarde Kayit' }); return; }
  } catch (e) { if (e && e.name === 'AbortError') return; }
  download(blob, name);
}
async function importData() {
  const f = await pickFile('#pick-json');
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    if (!data || data.app !== 'kayit' || !Array.isArray(data.items)) throw new Error('format');
    const clean = data.items.filter(i => i && typeof i.id === 'string' && (i.owner === 'me' || i.owner === 'carnet')).map(i => ({
      id: i.id, owner: i.owner, type: i.type === 'qr' ? 'qr' : 'alias', ctype: i.ctype === 'marchand' ? 'marchand' : 'proche',
      name: String(i.name || '').slice(0, 60), provider: String(i.provider || '').slice(0, 40), label: String(i.label || '').slice(0, 40),
      country: String(i.country || '').slice(0, 2), alias: String(i.alias || '').slice(0, 200), qrText: String(i.qrText || '').slice(0, 4000),
      qrImg: safeImg(i.qrImg), logo: safeImg(i.logo), color: safeColor(i.color), fav: !!i.fav, note: String(i.note || '').slice(0, 300),
      createdAt: +i.createdAt || Date.now(), updatedAt: +i.updatedAt || Date.now(),
    }));
    await db.putMany(clean);
    if (data.logos && typeof data.logos === 'object') {
      const merged = { ...S.logos };
      for (const [k, v] of Object.entries(data.logos)) if (safeImg(v) && !merged[k]) merged[k] = v;
      await db.set('logos', merged);
    }
    if (data.profile && !S.profile.name) { S.profile = Object.assign(S.profile, { name: String(data.profile.name || ''), bio: String(data.profile.bio || ''), ids: Array.isArray(data.profile.ids) ? data.profile.ids : [] }); await saveProfile(); }
    await load(); render();
    toast(`${clean.length} élément${clean.length > 1 ? 's' : ''} restauré${clean.length > 1 ? 's' : ''}`);
  } catch { toast("Ce fichier n'est pas une sauvegarde Kayit", false); }
}

// ---------------------------------------------------------------- Événements
document.addEventListener('click', async e => {
  const nav = e.target.closest('[data-nav]');
  if (nav) { go(nav.dataset.nav); return; }

  const flt = e.target.closest('[data-filter]');
  if (flt) { const [k, v] = flt.dataset.filter.split(':'); S.filter[k] = v; render(); return; }

  const th = e.target.closest('[data-theme-set]');
  if (th) { S.settings.theme = th.dataset.themeSet; applyTheme(); await saveSettings(); render(); return; }

  const ld = e.target.closest('[data-logo-del]');
  if (ld) { await setLogo(ld.dataset.logoDel, ''); render(); toast('Logo retiré'); return; }
  const ls = e.target.closest('[data-logo-set]');
  if (ls) {
    const file = await pickFile('#pick-image');
    if (!file) return;
    try { await setLogo(ls.dataset.logoSet, await logoFromFile(file)); render(); toast('Logo enregistré'); } catch { toast('Image illisible', false); }
    return;
  }

  const a = e.target.closest('[data-action]');
  if (!a) return;
  const card = a.closest('[data-id]');
  const it = card && S.items.find(i => i.id === card.dataset.id);
  switch (a.dataset.action) {
    case 'close': closeSheet(); break;
    case 'add': openAdd(); break;
    case 'scan': startScanFlow(a.dataset.owner); break;
    case 'import': startImportFlow(a.dataset.owner); break;
    case 'manual': openForm({ owner: a.dataset.owner, type: 'alias' }); break;
    case 'open': if (it) openDetail(it.id); break;
    case 'copy': if (it) copyText(copyValueOf(it), a); break;
    case 'fav': if (it) { it.fav = !it.fav; await save(it); render(); } break;
    case 'scan-close': closeScanner(); break;
    case 'scan-file': closeScanner(); if (scanFileCb) scanFileCb(); break;
    case 'profile-copy': copyText(profileLink().url); break;
    case 'profile-share': {
      const { url } = profileLink();
      if (navigator.share) { try { await navigator.share({ title: `Moyens de paiement — ${S.profile.name || 'Kayit'}`, url }); } catch { /* annulé */ } } else copyText(url);
      break;
    }
    case 'profile-qr': {
      const { url } = profileLink();
      openSheet(`<h2>Mon lien en QR</h2><p class="lead">Fais-le scanner : la personne voit tous tes moyens de paiement.</p>
        <div class="qr-stage">${qrSvg(url)}</div><p class="qr-caption">${esc(S.profile.name || '')}</p>
        <button class="btn block" id="dlp">${icon('i-download')}Enregistrer l'image</button>`,
      el => { $('#dlp', el).onclick = async () => shareOrDownloadImage(await svgToPng(qrSvg(url)), 'kayit-mon-lien.png', 'Mon lien Kayit'); });
      break;
    }
    case 'profile-preview': { const { url } = profileLink(); location.hash = url.slice(url.indexOf('#')); break; }
    case 'leave-public': history.replaceState(null, '', location.pathname); route(); break;
    case 'install':
      if (S.installEvt) { S.installEvt.prompt(); await S.installEvt.userChoice.catch(() => null); S.installEvt = null; render(); }
      break;
    case 'export': exportData(); break;
    case 'import-json': importData(); break;
    case 'wipe':
      confirmSheet('Tout effacer ?', 'Tous tes codes, ton carnet et ton profil seront supprimés de ce téléphone. Exporte une sauvegarde avant si besoin.', 'Tout effacer', async () => {
        await db.wipe(); S.items = []; S.profile = { name: '', bio: '', ids: [], base: '' }; S.logos = {}; render(); toast('Tout est effacé');
      });
      break;
    default: break;
  }
});

document.addEventListener('input', e => {
  const t = e.target;
  if (t.dataset.search) { S.q[t.dataset.search] = t.value; render(); return; }
  if (t.dataset.prof) {
    S.profile[t.dataset.prof] = t.value; saveProfile();
    const card = $('.profile-card');
    if (card) { $('.pc-name', card).textContent = S.profile.name || 'Ton nom'; $('.pc-bio', card).textContent = S.profile.bio || 'Une petite phrase (optionnelle)'; $('.avatar', card).textContent = initials(S.profile.name || '?'); }
    const lb = $('.link-box');
    if (lb && profileLink().count) lb.textContent = profileLink().url;
    return;
  }
  if (t.hasAttribute('data-base')) { S.profile.base = t.value.trim(); saveProfile(); }
});
document.addEventListener('change', e => {
  const t = e.target;
  if (t.dataset.pick) {
    const id = t.dataset.pick;
    S.profile.ids = t.checked ? [...new Set([...S.profile.ids, id])] : S.profile.ids.filter(x => x !== id);
    saveProfile(); render();
  }
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') { if (!$('#scanner').hidden) closeScanner(); else closeSheet(); } });

window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); S.installEvt = e; if (S.view === 'reglages') render(); });

// ---------------------------------------------------------------- Démarrage
function route() {
  const h = location.hash;
  if (h.startsWith('#/p/')) { renderPublic(h.slice(4)); return; }
  $('#public').hidden = true;
  $('#public').innerHTML = '';
  $('#app').hidden = false;
  render();
}
window.addEventListener('hashchange', route);

(async function init() {
  await load();
  applyTheme();
  route();
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  if ('serviceWorker' in navigator && isSecureContext && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}());
