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
  settings: { theme: 'auto', exportEvery: 30 },
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
}
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
  const hay = norm([it.name, it.provider, it.label, it.alias, it.qrText, it.note, c && c[1], it.ctype, (it.tags || []).join(' ')].join(' '));
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
  (it.tags || []).slice(0, 2).forEach(t => tags.push(`<span class="tag">#${esc(t)}</span>`));
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
  const tagNames = [...new Set(all.flatMap(i => i.tags || []))].sort((a, b) => a.localeCompare(b, 'fr'));
  chipsDef.push(...tagNames.map(t => [`tag:${t}`, `#${t}`, all.filter(i => (i.tags || []).includes(t)).length]));
  const pass = it => f === 'all' || (f === 'fav' && it.fav) || (f === 'alias' && it.type === 'alias') || (f === 'qr' && it.type === 'qr')
    || (f === 'proche' && it.ctype !== 'marchand') || (f === 'marchand' && it.ctype === 'marchand')
    || (f.startsWith('tag:') && (it.tags || []).includes(f.slice(4)));
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
    ${kind === 'codes' && exportDue() ? exportNotice() : ''}
    ${all.length ? `<label class="search">${icon('i-search')}<input type="search" data-search="${kind}" value="${esc(q)}" placeholder="Nom, établissement, alias…" autocomplete="off" enterkeyhint="search"></label>
    <div class="chips" role="group">${chipsDef.map(([k, l, n]) => `<button class="chip" data-filter="${kind}:${k}" aria-pressed="${f === k}">${l}<b>${n}</b></button>`).join('')}</div>` : ''}
    ${body}
    <div class="notice">${icon('i-info')}<span><b>Kayit ne paie pas.</b> Le paiement se fait toujours dans l'app de ton opérateur, qui affiche le nom du bénéficiaire : vérifie-le avant de valider.</span></div>`;
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

    <p class="section-t">Verrouillage</p>
    <div class="set-group">
      <button class="set-row" data-action="pin-set">${icon('i-lock')}<span class="grow"><b>Code d'accès</b><small>${locked() ? 'Activé · touche pour changer le code' : 'Désactivé · touche pour définir un code à 4–6 chiffres'}</small></span></button>
      ${locked() ? `<button class="set-row" data-action="bio-toggle">${icon('i-lock')}<span class="grow"><b>Biométrie</b><small>${S.settings.bio ? 'Activée · touche pour la désactiver' : 'Désactivée · touche pour l\'activer'}</small></span></button>` : ''}
      ${locked() ? `<button class="set-row" data-action="pin-off">${icon('i-x')}<span class="grow"><b>Retirer le code</b><small>Demande le code actuel</small></span></button>` : ''}
    </div>

    <p class="section-t">Rappel d'export</p>
    <div class="seg" role="group">${[[0, 'Jamais'], [7, '7 j'], [30, '30 j'], [90, '90 j']].map(([k, l]) => `<button data-export-every="${k}" aria-pressed="${(S.settings.exportEvery || 0) === k}">${l}</button>`).join('')}</div>
    <p class="v-sub" style="margin:8px 0 16px">Un rappel s'affiche dans « Mes codes » quand ta dernière sauvegarde date de plus de N jours.</p>

    <p class="section-t">Logos des établissements</p>
    ${providers().length ? `<div class="set-group">${providers().map(pv => `
      <button class="set-row" data-logo-set="${esc(pv)}">${badge({ owner: 'me', provider: pv })}<span class="grow"><b>${esc(pv)}</b><small>${logoFor(pv) ? 'Touche pour changer le logo' : 'Touche pour importer son logo'}</small></span>
      ${logoFor(pv) ? `<span class="btn sm ghost" data-logo-del="${esc(pv)}">Retirer</span>` : icon('i-image')}</button>`).join('')}</div>`
      : '<p class="v-sub" style="margin:0 0 16px">Ajoute un code pour pouvoir lui mettre un logo.</p>'}

    <p class="section-t">Ce que Kayit ne fait pas</p>
    <div class="set-group">
      <div class="promise"><i>₣</i><p><b>Il ne paie pas.</b>Le paiement se fait toujours dans l'app de ton opérateur, qui affiche le nom du bénéficiaire.</p></div>
      <div class="promise"><i>↯</i><p><b>Il n'envoie pas tes codes.</b>Aucun compte.</p></div>
      <div class="promise"><i>⌂</i><p><b>Tout reste ici.</b>Tes codes sont rangés dans ce navigateur, sur ce téléphone. Pense à exporter de temps en temps.</p></div>
    </div>

    <p class="section-t">Zone sensible</p>
    <button class="btn danger block" data-action="wipe">${icon('i-trash')}Tout effacer sur ce téléphone</button>
    <p class="pub-foot">Kayit v${VERSION} · <a href="https://lassanasiby.com" target="_blank" rel="noopener">lassanasiby.com</a></p>`;
}

// ---------------------------------------------------------------- Navigation
function render() {
  const v = $('#view');
  const map = { codes: () => viewList('codes'), carnet: () => viewList('carnet'), reglages: viewReglages };
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
  if (!$('#fsqr').hidden) closeFullQr();
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
    <label class="field"><span>Étiquettes (optionnel)</span><input name="tags" value="${esc((d.tags || []).join(', '))}" placeholder="Ex. Travail, Famille" maxlength="120" autocomplete="off"><span class="hint">Séparées par des virgules. Pour regrouper et filtrer.</span></label>
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
        tags: parseTags(f('tags').value),
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
      <button class="btn" data-full ${img || gen ? '' : 'disabled'}>${icon('i-qr')}Plein écran</button>
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
    el.querySelector('[data-full]').onclick = () => openFullQr(mode === 'img' && img ? `<img src="${img}" alt="QR code">` : qrSvg(gen));
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

// ---------------------------------------------------------------- Sauvegarde
async function exportData() {
  const data = { app: 'kayit', version: 1, exportedAt: new Date().toISOString(), items: S.items, logos: S.logos };
  const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
  const name = `kayit-sauvegarde-${new Date().toISOString().slice(0, 10)}.json`;
  try {
    const file = new File([blob], name, { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: 'Sauvegarde Kayit' }); markExported(); return; }
  } catch (e) { if (e && e.name === 'AbortError') return; }
  download(blob, name);
  markExported();
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
      tags: Array.isArray(i.tags) ? i.tags.map(t => String(t).slice(0, 24)).filter(Boolean).slice(0, 6) : [],
      createdAt: +i.createdAt || Date.now(), updatedAt: +i.updatedAt || Date.now(),
    }));
    await db.putMany(clean);
    if (data.logos && typeof data.logos === 'object') {
      const merged = { ...S.logos };
      for (const [k, v] of Object.entries(data.logos)) if (safeImg(v) && !merged[k]) merged[k] = v;
      await db.set('logos', merged);
    }
    await load(); render();
    toast(`${clean.length} élément${clean.length > 1 ? 's' : ''} restauré${clean.length > 1 ? 's' : ''}`);
  } catch { toast("Ce fichier n'est pas une sauvegarde Kayit", false); }
}

// ---------------------------------------------------------------- Événements
document.addEventListener('click', async e => {
  const nav = e.target.closest('[data-nav]');
  if (nav) { go(nav.dataset.nav); return; }

  const flt = e.target.closest('[data-filter]');
  if (flt) { const s = flt.dataset.filter, i = s.indexOf(':'); S.filter[s.slice(0, i)] = s.slice(i + 1); render(); return; }

  const th = e.target.closest('[data-theme-set]');
  if (th) { S.settings.theme = th.dataset.themeSet; applyTheme(); await saveSettings(); render(); return; }

  const ee = e.target.closest('[data-export-every]');
  if (ee) { S.settings.exportEvery = +ee.dataset.exportEvery; await saveSettings(); render(); return; }
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
    case 'install':
      if (S.installEvt) { S.installEvt.prompt(); await S.installEvt.userChoice.catch(() => null); S.installEvt = null; render(); }
      break;
    case 'export': exportData(); break;
    case 'export-later': S.settings.exportSnoozeUntil = Date.now() + 3 * 86400000; await saveSettings(); render(); break;
    case 'fsqr-close': closeFullQr(); break;
    case 'pin-set': openPinSet(); break;
    case 'pin-off': openPinOff(); break;
    case 'bio-toggle': toggleBio(); break;
    case 'import-json': importData(); break;
    case 'wipe':
      confirmSheet('Tout effacer ?', 'Tous tes codes et ton carnet seront supprimés de ce téléphone. Exporte une sauvegarde avant si besoin.', 'Tout effacer', async () => {
        await db.wipe(); S.items = []; S.logos = {}; S.settings = { theme: 'auto', exportEvery: 30 }; render(); toast('Tout est effacé');
      });
      break;
    default: break;
  }
});

document.addEventListener('input', e => {
  const t = e.target;
  if (t.dataset.search) { S.q[t.dataset.search] = t.value; render(); return; }
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') { if (!$('#fsqr').hidden) closeFullQr(); else if (!$('#scanner').hidden) closeScanner(); else closeSheet(); } });

window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); S.installEvt = e; if (S.view === 'reglages') render(); });

// ---------------------------------------------------------------- Étiquettes
function parseTags(s) {
  const out = [];
  for (const raw of String(s || '').split(',')) {
    const t = raw.trim().slice(0, 24);
    if (t && !out.some(x => norm(x) === norm(t))) out.push(t);
  }
  return out.slice(0, 6);
}

// ---------------------------------------------------------------- Rappel d'export
function exportDue() {
  const n = S.settings.exportEvery || 0;
  if (!n || !S.items.length) return false;
  const now = Date.now();
  if (S.settings.exportSnoozeUntil && now < S.settings.exportSnoozeUntil) return false;
  const since = S.settings.lastExport || S.settings.exportStart || now;
  return now - since > n * 86400000;
}
function exportNotice() {
  return `<div class="notice">${icon('i-download')}<span><b>Pense à exporter tes données.</b> Ta dernière sauvegarde date de plus de ${S.settings.exportEvery} jours.</span></div>
    <div class="grid2" style="margin-bottom:14px"><button class="btn primary" data-action="export">${icon('i-download')}Exporter</button><button class="btn ghost" data-action="export-later">Plus tard</button></div>`;
}
function markExported() {
  S.settings.lastExport = Date.now();
  S.settings.exportSnoozeUntil = 0;
  saveSettings();
  render();
}

// ---------------------------------------------------------------- Code d'accès
const ENC = new TextEncoder();
const randHex = n => [...crypto.getRandomValues(new Uint8Array(n))].map(b => b.toString(16).padStart(2, '0')).join('');
async function pinHash(pin, salt) {
  const key = await crypto.subtle.importKey('raw', ENC.encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: ENC.encode(salt), iterations: 210000 }, key, 256);
  return [...new Uint8Array(bits)].map(b => b.toString(16).padStart(2, '0')).join('');
}
const locked = () => !!(S.settings.pin && S.settings.pin.hash);
let isLocked = false;
let hiddenAt = 0;
function showLock() {
  isLocked = true;
  if (sheetOpen) hideSheet();
  closeFullQr();
  $('#app').hidden = true;
  $('#lock').hidden = false;
  $('#lock-err').textContent = '';
  $('#lock-pin').value = '';
  $('#lock-bio').hidden = !S.settings.bio;
  setTimeout(() => $('#lock-pin').focus(), 50);
  tryBio();
}
async function unlock(e) {
  e.preventDefault();
  const pin = $('#lock-pin').value;
  const ok = /^\d{4,6}$/.test(pin) && (await pinHash(pin, S.settings.pin.salt)) === S.settings.pin.hash;
  if (!ok) { $('#lock-err').textContent = 'Code incorrect'; $('#lock-pin').value = ''; return; }
  doUnlock();
}
function doUnlock() {
  isLocked = false;
  $('#lock').hidden = true;
  $('#lock-pin').value = '';
  route();
}
// Biométrie (WebAuthn, authentificateur de la plateforme) : déverrouillage facultatif, le code reste le repli.
const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
const randBytes = n => crypto.getRandomValues(new Uint8Array(n));
async function bioAvailable() {
  try { return !!(window.PublicKeyCredential && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()); } catch { return false; }
}
async function toggleBio() {
  if (S.settings.bio) { delete S.settings.bio; await saveSettings(); render(); toast('Biométrie désactivée'); return; }
  if (!(await bioAvailable())) { toast("Pas de biométrie disponible sur cet appareil", false); return; }
  try {
    const cred = await navigator.credentials.create({ publicKey: {
      challenge: randBytes(32), rp: { name: 'Kayit' }, user: { id: randBytes(16), name: 'kayit', displayName: 'Kayit' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
      timeout: 60000,
    } });
    S.settings.bio = { id: b64u(cred.rawId) };
    await saveSettings(); render(); toast('Biométrie activée');
  } catch (e) { toast(e && e.name === 'NotAllowedError' ? 'Activation annulée' : 'Biométrie indisponible ici', false); }
}
async function tryBio() {
  if (!S.settings.bio) return;
  try {
    const a = await navigator.credentials.get({ publicKey: {
      challenge: randBytes(32), allowCredentials: [{ type: 'public-key', id: fromB64u(S.settings.bio.id) }],
      userVerification: 'required', timeout: 60000,
    } });
    if (a) doUnlock();
  } catch { /* annulé ou refusé : le code reste disponible */ }
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { hiddenAt = Date.now(); return; }
  if (locked() && !isLocked && Date.now() - hiddenAt > 60000) showLock();
});
function openPinSet() {
  openSheet(`<h2>${locked() ? 'Changer le code' : 'Définir un code'}</h2><p class="lead">4 à 6 chiffres. Il est demandé à l'ouverture de l'app et après une minute en arrière-plan.</p>
    <form id="pinf" class="pinf">
      <label class="field"><span>Nouveau code</span><input id="p1" type="password" inputmode="numeric" pattern="[0-9]{4,6}" maxlength="6" required></label>
      <label class="field"><span>Répète le code</span><input id="p2" type="password" inputmode="numeric" pattern="[0-9]{4,6}" maxlength="6" required></label>
      <p class="lock-err" id="pe"></p>
      <div class="grid2"><button class="btn" type="button" data-action="close">Annuler</button><button class="btn primary" type="submit">Enregistrer</button></div>
    </form>`, el => {
    $('#pinf', el).onsubmit = async e => {
      e.preventDefault();
      const a = $('#p1', el).value, b = $('#p2', el).value;
      if (!/^\d{4,6}$/.test(a)) { $('#pe', el).textContent = '4 à 6 chiffres.'; return; }
      if (a !== b) { $('#pe', el).textContent = 'Les deux codes ne correspondent pas.'; return; }
      const salt = randHex(16);
      S.settings.pin = { salt, hash: await pinHash(a, salt) };
      await saveSettings(); closeSheet(); render(); toast('Code enregistré');
    };
  });
}
function openPinOff() {
  openSheet(`<h2>Retirer le code ?</h2><p class="lead">Saisis le code actuel pour confirmer.</p>
    <form id="pinoff" class="pinf">
      <label class="field"><span>Code actuel</span><input id="pc" type="password" inputmode="numeric" maxlength="6" required></label>
      <p class="lock-err" id="pe"></p>
      <div class="grid2"><button class="btn" type="button" data-action="close">Annuler</button><button class="btn danger" type="submit">Retirer</button></div>
    </form>`, el => {
    $('#pinoff', el).onsubmit = async e => {
      e.preventDefault();
      if ((await pinHash($('#pc', el).value, S.settings.pin.salt)) !== S.settings.pin.hash) { $('#pe', el).textContent = 'Code incorrect'; return; }
      delete S.settings.pin; delete S.settings.bio; await saveSettings(); closeSheet(); render(); toast('Code retiré');
    };
  });
}

// ---------------------------------------------------------------- QR plein écran
let wakeLock = null;
async function openFullQr(html) {
  $('#fsqr .fsqr-stage').innerHTML = html;
  $('#fsqr').hidden = false;
  try { wakeLock = await navigator.wakeLock.request('screen'); } catch { wakeLock = null; }
}
function closeFullQr() {
  const box = $('#fsqr');
  if (box.hidden) return;
  box.hidden = true;
  $('#fsqr .fsqr-stage').innerHTML = '';
  if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
}

// ---------------------------------------------------------------- Démarrage
function route() {
  $('#app').hidden = false;
  render();
}
window.addEventListener('hashchange', route);

(async function init() {
  await load();
  applyTheme();
  if (!S.settings.exportStart && !S.settings.lastExport) { S.settings.exportStart = Date.now(); await saveSettings(); }
  $('#lock-form').onsubmit = unlock;
  $('#lock-bio').onclick = tryBio;
  if (locked()) showLock(); else route();
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  if ('serviceWorker' in navigator && isSecureContext && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}());
