import { MODES, CATS, loadPOIs, getStory, getRoute, geocode, reverse } from './api.js';
import { planLoop, planAB, poisAlong, searchArea, routeMinutes, speedMpm, newShare } from './planner.js';
import { dist, cumulative, projectOnLine, thin } from './geo.js';
import * as store from './store.js';
import { ico } from './icons.js';
import { profile, reward, ring, routeXp } from './game.js';
import { kcal, tempo, tempoUnit, elevationProfile, areaChart, splitBars, weekBars, weekly, streakWeeks, totalsByMode, records } from './sport.js';

const { prefs } = store;
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const isDesktop = () => matchMedia('(min-width: 860px)').matches;
const SIM = new URLSearchParams(location.search).has('sim');

/* ---------------- formatting ---------------- */
const fmtKm = m => (m / 1000).toFixed(m < 9950 ? 1 : 0).replace('.', ',');
const fmtMin = min => {
  min = Math.round(min);
  if (min < 60) return `${min} Min`;
  const h = Math.floor(min / 60), r = min % 60;
  return r ? `${h} Std ${r}` : `${h} Std`;
};
const fmtClock = s => {
  s = Math.max(0, Math.floor(s));
  const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, sec = s % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(sec).padStart(2, '0');
};
const fmtPace = p => `${Math.floor(p)}:${String(Math.round((p % 1) * 60)).padStart(2, '0')}`;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = ts => new Date(ts).toLocaleDateString('de-DE', { day: 'numeric', month: 'short', year: 'numeric' });

/* ---------------- state ---------------- */
const state = {
  me: null, start: null, dest: null, plan: null, attempt: 0,
  view: 'plan', stack: [], nav: null, following: true, place: null, loading: false,
  excluded: new Set(), must: [],
};

/* ---------------- map ---------------- */
const map = L.map('map', { zoomControl: false, attributionControl: true, tap: true }).setView([52.517, 13.389], 14);
const OSM = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
const MAPS = {
  standard: { label: 'Standard', url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', native: 19, cls: 'base-tiles', attribution: OSM },
  satellite: { label: 'Satellit', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', native: 18, attribution: 'Bilder © Esri, Maxar, Earthstar Geographics' },
  topo: { label: 'Gelände', url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', native: 17, attribution: OSM + ', SRTM · © <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)' },
  bike: { label: 'Rad', url: 'https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png', native: 19, attribution: OSM + ' · <a href="https://www.cyclosm.org">CyclOSM</a>' },
};
let baseLayer = null;
function applyMapStyle() {
  const m = MAPS[prefs.mapStyle] || MAPS.standard;
  if (baseLayer) map.removeLayer(baseLayer);
  baseLayer = L.tileLayer(m.url, { maxZoom: 19, maxNativeZoom: m.native, className: m.cls || 'raw-tiles', attribution: m.attribution }).addTo(map);
  baseLayer.bringToBack();
}
applyMapStyle();

/* accent colour: [name, light, dark] – iOS system colours */
const ACCENTS = {
  coral: ['Koralle', '#ff5a36', '#ff6b4a'], orange: ['Orange', '#ff9500', '#ff9f0a'], pink: ['Pink', '#ff2d55', '#ff375f'],
  purple: ['Lila', '#af52de', '#bf5af2'], blue: ['Blau', '#007aff', '#0a84ff'], teal: ['Türkis', '#12a4b8', '#2bb5c9'],
};
const darkMQ = matchMedia('(prefers-color-scheme: dark)');
// the route line is blue; with a blue accent it switches to orange so line and pins stay apart
const routeColor = () => prefs.accent === 'blue' ? '#ff9500' : '#007aff';
function applyAccent() {
  const a = ACCENTS[prefs.accent] || ACCENTS.coral, hex = a[darkMQ.matches ? 2 : 1];
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  const st = document.documentElement.style;
  st.setProperty('--tint', hex);
  st.setProperty('--tint-soft', `rgba(${r}, ${g}, ${b}, ${darkMQ.matches ? .2 : .14})`);
  routeLayer?.eachLayer(l => { if (l.options?.isRoute) l.setStyle({ color: routeColor() }); });
}
darkMQ.addEventListener('change', () => applyAccent());
const trailsLayer = L.layerGroup().addTo(map);
const routeLayer = L.layerGroup().addTo(map);
applyAccent();
const poiLayer = L.layerGroup().addTo(map);
const liveLayer = L.layerGroup().addTo(map);
let meMarker = null, startMarker = null, destMarker = null;
const poiMarkers = new Map();

const icon = (cls, html = '', size = 22) => L.divIcon({ className: '', html: `<div class="${cls}">${html}</div>`, iconSize: [size, size], iconAnchor: [size / 2, size / 2] });
const poiIcon = (p, n) => L.divIcon({ className: '', html: `<div class="pin-poi" data-id="${p.id}" title="${esc(p.name)}">${ico(p.icon)}</div>`, iconSize: [32, 32], iconAnchor: [16, 16] });

map.on('dragstart', () => { if (state.nav) { state.following = false; $('#locateBtn').classList.remove('following'); } });

function fit(bounds) {
  const sheetH = $('#sheet').offsetHeight;
  const opts = isDesktop()
    ? { paddingTopLeft: [460, 90], paddingBottomRight: [50, 50] }
    : { paddingTopLeft: [30, 80], paddingBottomRight: [30, Math.min(sheetH, innerHeight * .62) + 20] };
  map.fitBounds(bounds, { ...opts, maxZoom: 17 });
}
function panToVisible(latlng, zoom) {
  if (zoom) map.setZoom(zoom, { animate: false });
  const sheetH = isDesktop() ? 0 : Math.min($('#sheet').offsetHeight, innerHeight * .62);
  const offX = isDesktop() ? 215 : 0;
  const pt = map.project(latlng).add([-offX, sheetH / 2 - 20]);
  map.panTo(map.unproject(pt), { animate: true });
}

/* ---------------- toast ---------------- */
let toastT;
function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), ms);
}

/* ---------------- sheet & views ---------------- */
const sheet = $('#sheet');
new ResizeObserver(() => {
  document.documentElement.style.setProperty('--sheet-h', (isDesktop() ? 0 : sheet.offsetHeight) + 'px');
}).observe(sheet);
(() => {
  let y0 = null;
  const h = $('#sheetHandle');
  h.addEventListener('pointerdown', e => { y0 = e.clientY; h.setPointerCapture(e.pointerId); });
  h.addEventListener('pointerup', e => {
    if (y0 == null) return;
    const dy = e.clientY - y0; y0 = null;
    if (Math.abs(dy) < 8) sheet.classList.toggle('collapsed');
    else sheet.classList.toggle('collapsed', dy > 0);
  });
})();

function show(view, push = true) {
  if (push && state.view !== view) state.stack.push(state.view);
  state.view = view;
  $$('.view').forEach(v => v.classList.toggle('hidden', v.id !== 'view-' + view));
  sheet.classList.remove('collapsed');
  $('#sheetBody').scrollTop = 0;
}
function back() {
  const prev = state.stack.pop() || (state.nav ? 'nav' : state.plan ? 'result' : 'plan');
  show(prev, false);
}

/* ---------------- greeting ---------------- */
function greet() {
  const h = new Date().getHours();
  const hello = h < 5 ? 'Noch wach?' : h < 11 ? 'Guten Morgen' : h < 17 ? 'Hallo' : h < 22 ? 'Guten Abend' : 'Gute Nacht';
  const city = state.place?.city;
  $('#greetingEyebrow').textContent = hello + (city ? ` in ${city}` : '');
  $('#greetingTitle').textContent = city ? `${city} entdecken` : 'Entdecken';
}
const daypart = () => { const h = new Date().getHours(); return h < 11 ? 'Morgen' : h < 14 ? 'Mittags' : h < 18 ? 'Nachmittags' : h < 22 ? 'Abend' : 'Nacht'; };

/* ---------------- preferences UI ---------------- */
const ceil5 = x => Math.ceil(x / 5) * 5;
let directToken = 0;
/** A→B: look up how long the direct trip takes, so the time picker can talk about "extra time" */
async function updateDirect() {
  const token = ++directToken;
  if (prefs.type !== 'ab' || !state.dest) { state.directMin = null; return syncPrefsUI(); }
  try {
    const direct = await getRoute([getStart(), state.dest], prefs.mode);
    if (token !== directToken) return;
    state.directMin = routeMinutes(direct, prefs.mode);
    if (prefs.minutes < state.directMin * 1.1) prefs.minutes = ceil5(state.directMin) + (prefs.mode === 'car' ? 30 : 15);
  } catch { if (token === directToken) state.directMin = null; }
  syncPrefsUI();
}

function syncPrefsUI() {
  $$('#modes .mode').forEach(b => b.classList.toggle('active', b.dataset.mode === prefs.mode));
  $$('#routeTypeSeg .seg').forEach(b => b.classList.toggle('active', b.dataset.type === prefs.type));
  $$('#interests .chip').forEach(b => b.classList.toggle('active', prefs.interests.includes(b.dataset.int)));
  $('#destField').classList.toggle('hidden', prefs.type !== 'ab');
  $('#paceRow').classList.toggle('hidden', prefs.mode === 'car');
  const pace = prefs.pace[prefs.mode];
  if (pace) $('#paceVal').textContent = prefs.mode === 'bike' ? `${Math.round(60 / pace)} km/h` : `${fmtPace(pace)} min/km`;
  const r = $('#timeRange');
  const d = prefs.type === 'ab' ? state.directMin : null;
  r.max = Math.max(180, d ? ceil5(d * 2) : 0);
  r.value = prefs.minutes;
  r.style.setProperty('--p', ((prefs.minutes - r.min) / (r.max - r.min) * 100) + '%');
  let sub;
  if (d && prefs.minutes < d * 0.97) sub = `<span class="time-sub warn">direkt dauert es schon ${fmtMin(d)}</span>`;
  else if (d) sub = `<span class="time-sub">direkt ${fmtMin(d)} · <b>+${fmtMin(Math.max(0, prefs.minutes - d))}</b> zum Entdecken</span>`;
  else sub = `<span class="time-sub">≈ ${fmtKm(prefs.minutes * speedMpm(prefs.mode))} km ${prefs.type === 'loop' ? 'Runde' : 'Weg'}</span>`;
  $('#timeValue').innerHTML = fmtMin(prefs.minutes) + sub;
  // presets: fixed minutes for loops, "extra time" once we know the direct trip
  $('#timePresets').innerHTML = (d ? [10, 20, 30, 45, 60].map(x => [ceil5(d) + x, '+' + x]) : [15, 30, 45, 60, 90].map(x => [x, x]))
    .map(([min, label]) => `<button data-min="${min}" class="${min === prefs.minutes ? 'active' : ''}">${label}</button>`).join('');
  renderLook();
  $('#homeBtn').classList.toggle('on', !!prefs.home);
  $('#homeBtn').title = prefs.home ? `Start am Hotel: ${prefs.home.name}` : 'Aktuellen Start als Hotel merken';
  store.savePrefs();
}

$('#modes').addEventListener('click', e => { const b = e.target.closest('.mode'); if (b) { prefs.mode = b.dataset.mode; syncPrefsUI(); updateDirect(); } });
$('#routeTypeSeg').addEventListener('click', e => {
  const b = e.target.closest('.seg'); if (!b) return;
  prefs.type = b.dataset.type; syncPrefsUI(); updateDirect();
  if (prefs.type === 'ab' && !state.dest) setTimeout(() => $('#destInput').focus(), 50);
  if (prefs.type === 'loop' && destMarker) { destMarker.remove(); destMarker = null; }
  if (prefs.type === 'ab' && state.dest) setDest(state.dest);
});
$('#interests').addEventListener('click', e => {
  const b = e.target.closest('.chip'); if (!b) return;
  const i = b.dataset.int;
  prefs.interests = prefs.interests.includes(i) ? prefs.interests.filter(x => x !== i) : [...prefs.interests, i];
  syncPrefsUI();
});
$('#timeRange').addEventListener('input', e => { prefs.minutes = +e.target.value; syncPrefsUI(); });
$('#timePresets').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { prefs.minutes = +b.dataset.min; syncPrefsUI(); } });
function stepPace(dir) {
  const m = prefs.mode;
  if (m === 'bike') { const kmh = Math.max(8, Math.min(35, Math.round(60 / prefs.pace.bike) + dir)); prefs.pace.bike = 60 / kmh; }
  else { const lim = m === 'walk' ? [8, 20] : [3, 10]; prefs.pace[m] = Math.max(lim[0], Math.min(lim[1], prefs.pace[m] - dir * 0.25)); }
  syncPrefsUI(); updateDirect();
}
$('#pacePlus').addEventListener('click', () => stepPace(1));
$('#paceMinus').addEventListener('click', () => stepPace(-1));

/* ---------------- start / destination fields ---------------- */
let sugTarget = null, sugT;
function suggest(input, target) {
  clearTimeout(sugT);
  const q = input.value.trim();
  if (q.length < 3) { $('#suggestions').classList.add('hidden'); return; }
  sugT = setTimeout(async () => {
    try {
      const res = await geocode(q, state.me || getStart());
      const ul = $('#suggestions');
      sugTarget = target;
      ul.innerHTML = res.length ? res.map((r, i) => `<li data-i="${i}">${esc(r.name)}<small>${esc(r.detail)}</small></li>`).join('') : '<li class="none">Nichts gefunden</li>';
      ul._res = res;
      ul.classList.remove('hidden');
    } catch { /* offline */ }
  }, 450);
}
$('#startInput').addEventListener('input', e => suggest(e.target, 'start'));
$('#destInput').addEventListener('input', e => suggest(e.target, 'dest'));
document.addEventListener('click', e => { if (!e.target.closest('.field-group')) $('#suggestions').classList.add('hidden'); });
$('#suggestions').addEventListener('click', e => {
  const li = e.target.closest('li[data-i]'); if (!li) return;
  const r = $('#suggestions')._res[+li.dataset.i];
  $('#suggestions').classList.add('hidden');
  if (sugTarget === 'start') setStart(r); else setDest(r);
});
$('#useMyLocation').addEventListener('click', () => {
  state.start = null; $('#startInput').value = '';
  if (startMarker) { startMarker.remove(); startMarker = null; }
  if (state.me) panToVisible(state.me, 15); else toast('Standort wird gesucht …');
  updateDirect();
});
let picking = false;
$('#pickOnMap').addEventListener('click', () => {
  picking = !picking; $('#pickOnMap').classList.toggle('on', picking);
  if (picking) { toast('Tippe auf die Karte, um dein Ziel zu setzen'); if (!isDesktop()) sheet.classList.add('collapsed'); }
});

function setStart(p) {
  state.start = p;
  $('#startInput').value = p.name || 'Gewählter Punkt';
  if (startMarker) startMarker.remove();
  startMarker = L.marker(p, { icon: icon('pin-start', '', 20) }).addTo(map);
  panToVisible(p, 15);
  updatePlace(p);
  updateDirect();
}
function setDest(p) {
  state.dest = p;
  $('#destInput').value = p.name || 'Gewählter Punkt';
  if (destMarker) destMarker.remove();
  destMarker = L.marker(p, { icon: icon('pin-end', '', 22) }).addTo(map);
  const s = getStart();
  fit(L.latLngBounds([s, p]).pad(.1));
  updateDirect();
}
const getStart = () => state.start || state.me || (() => { const c = map.getCenter(); return { lat: c.lat, lng: c.lng }; })();

map.on('click', async e => {
  if (state.view !== 'plan') return;
  if (prefs.type === 'ab' || picking) {
    const p = { lat: e.latlng.lat, lng: e.latlng.lng, name: 'Punkt auf der Karte' };
    if (prefs.type !== 'ab') { prefs.type = 'ab'; syncPrefsUI(); }
    picking = false; $('#pickOnMap').classList.remove('on');
    setDest(p); sheet.classList.remove('collapsed');
    const r = await reverse(p);
    if (state.dest === p && r.label) { p.name = r.label; $('#destInput').value = r.label; }
  }
});
map.on('contextmenu', async e => {
  if (state.view !== 'plan') return;
  const p = { lat: e.latlng.lat, lng: e.latlng.lng, name: 'Punkt auf der Karte' };
  setStart(p); toast('Startpunkt gesetzt');
  const r = await reverse(p);
  if (state.start === p && r.label) { p.name = r.label; $('#startInput').value = r.label; }
});

async function updatePlace(p) {
  const r = await reverse(p);
  if (r.city || r.area) { state.place = r; greet(); }
}

/* ---------------- geolocation ---------------- */
let firstFix = true;
function onPos(p) {
  state.me = p;
  if (!meMarker) meMarker = L.marker(p, { icon: icon('pin-me'), zIndexOffset: 1000, interactive: false }).addTo(map);
  else meMarker.setLatLng(p);
  if (firstFix) {
    firstFix = false;
    if (!state.start && state.view === 'plan') map.setView(p, 15);
    updatePlace(p);
  }
  if (state.nav) navPos(p);
}
function startGeo() {
  if (SIM) {
    const q = new URLSearchParams(location.search).get('sim');
    const [lat, lng] = q && q.includes(',') ? q.split(',').map(Number) : [52.5163, 13.3777];
    setTimeout(() => onPos({ lat, lng, acc: 5, t: Date.now() }), 300);
    return;
  }
  if (!navigator.geolocation) return noGeo();
  navigator.geolocation.watchPosition(
    pos => onPos({ lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy, alt: pos.coords.altitude, t: pos.timestamp }),
    err => { if (!state.me) noGeo(err); },
    { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 },
  );
}
function noGeo() {
  toast('Kein Standort – such einen Startpunkt oder halte lange auf die Karte gedrückt', 4500);
  updatePlace(getStart());
}

$('#locateBtn').addEventListener('click', () => {
  if (!state.me) return toast('Standort noch nicht verfügbar');
  state.following = true;
  $('#locateBtn').classList.toggle('following', !!state.nav);
  panToVisible(state.me, Math.max(map.getZoom(), 16));
});

/* ---------------- trails (where I've been) ---------------- */
function drawTrails() {
  trailsLayer.clearLayers();
  if (!prefs.showTrails) return;
  for (const t of store.getTracks()) {
    L.polyline(t.coords, { color: '#5856d6', weight: 5, opacity: .45, lineCap: 'round', interactive: false }).addTo(trailsLayer);
  }
}
/* ---------------- look chooser: map style, accent colour, trails ---------------- */
function renderLook() {
  const c = map.getCenter(), z = 13, n = 2 ** z;
  const x = Math.floor((c.lng + 180) / 360 * n), lat = c.lat * Math.PI / 180;
  const y = Math.floor((1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2 * n);
  const thumb = m => m.url.replace('{s}', 'a').replace('{z}', z).replace('{x}', x).replace('{y}', y);
  $('#mapStyles').innerHTML = Object.entries(MAPS).map(([k, m]) =>
    `<button class="map-style${k === prefs.mapStyle ? ' active' : ''}" data-map="${k}"><i style="background-image:url('${thumb(m)}')"></i>${m.label}</button>`).join('');
  $('#accentSwatches').innerHTML = Object.entries(ACCENTS).map(([k, a]) =>
    `<button class="swatch${k === prefs.accent ? ' active' : ''}" data-accent="${k}" aria-label="${a[0]}" title="${a[0]}" style="--c:${a[darkMQ.matches ? 2 : 1]}"><i></i></button>`).join('');
  $('#trailsToggle').checked = prefs.showTrails;
}
function toggleLook(open = $('#lookPanel').hidden) {
  if (open) renderLook();
  $('#lookPanel').hidden = !open;
  $('#layersBtn').classList.toggle('on', open);
  $('#layersBtn').setAttribute('aria-expanded', open);
}
$('#layersBtn').addEventListener('click', e => { e.stopPropagation(); toggleLook(); });
$('#lookPanel').addEventListener('click', e => {
  e.stopPropagation();
  const m = e.target.closest('[data-map]'), a = e.target.closest('[data-accent]');
  if (m) { prefs.mapStyle = m.dataset.map; applyMapStyle(); }
  if (a) { prefs.accent = a.dataset.accent; applyAccent(); }
  if (m || a) { store.savePrefs(); renderLook(); }
});
$('#trailsToggle').addEventListener('change', e => { prefs.showTrails = e.target.checked; store.savePrefs(); drawTrails(); });
document.addEventListener('click', () => { if (!$('#lookPanel').hidden) toggleLook(false); });
map.on('click movestart', () => { if (!$('#lookPanel').hidden) toggleLook(false); });

/* ---------------- planning ---------------- */
function setLoading(on, label) {
  state.loading = on;
  const btn = $('#findRouteBtn');
  btn.classList.toggle('loading', on); btn.disabled = on;
  btn.querySelector('.btn-label').textContent = on ? (label || 'Suche Spannendes') : 'Route finden';
  $('#rerollBtn').disabled = on;
  $('#rerollBtn').textContent = on ? 'Suche …' : 'Andere Route';
  scanEl.classList.toggle('on', on);
}
const scanEl = Object.assign(document.createElement('div'), { className: 'scan' });
document.body.appendChild(scanEl);

async function findRoute({ reroll = false, keep = false } = {}) {
  if (state.loading) return;
  const type = prefs.type, mode = prefs.mode, minutes = prefs.minutes;
  const start = getStart();
  const end = type === 'ab' ? state.dest : null;
  if (type === 'ab' && !end) { toast('Wohin soll es gehen? Wähle ein Ziel'); $('#destInput').focus(); return; }
  state.attempt = reroll ? state.attempt + 1 : keep ? state.attempt : 0;
  setLoading(true, reroll ? 'Würfle neu' : 'Suche Spannendes');
  try {
    const direct = end ? await getRoute([start, end], mode) : null;
    const pois = (await loadPOIs(searchArea({ start, end, minutes, mode, direct }), prefs.interests)).filter(p => !state.excluded.has(p.id));
    const must = state.must.filter(m => !state.excluded.has(m.id));
    const plan = type === 'loop'
      ? await planLoop({ start, minutes, mode, pois, must, attempt: state.attempt })
      : await planAB({ start, end, minutes, mode, pois, must, attempt: state.attempt, stopMin: prefs.stopMin });
    const along = poisAlong(plan.route, pois, mode, plan.waypoints);
    const area = state.place?.area || state.place?.city || '';
    const topCat = prefs.interests.length === 1 ? CATS[prefs.interests[0]].label : '';
    const name = type === 'loop'
      ? `${topCat ? topCat + '-' : ''}${daypart()}runde${area ? ' durch ' + area : ''}`
      : `Entdeckerweg nach ${end.name || 'Ziel'}`;
    state.plan = { ...plan, type, mode, minutesWanted: minutes, start, end, along, name, created: Date.now() };
    renderPlan();
    show('result', state.view !== 'result');
  } catch (e) {
    console.error(e);
    toast('Hoppla: ' + (e.message || 'Route konnte nicht berechnet werden'), 4000);
  } finally { setLoading(false); }
}

function renderPlan() {
  const p = state.plan;
  routeLayer.clearLayers(); poiLayer.clearLayers(); poiMarkers.clear();
  const line = p.route.coords;
  L.polyline(line, { color: '#fff', weight: 10, opacity: 1, lineJoin: 'round' }).addTo(routeLayer);
  L.polyline(line, { color: routeColor(), weight: 5.5, opacity: 1, lineJoin: 'round', isRoute: true }).addTo(routeLayer);
  L.polyline(line, { color: '#fff', weight: 1.5, opacity: .9, dashArray: '1 14', lineCap: 'round' }).addTo(routeLayer);
  L.marker(p.start, { icon: icon('pin-start', '', 20), interactive: false }).addTo(routeLayer);
  if (p.end) L.marker(p.end, { icon: icon('pin-end', '', 22), interactive: false }).addTo(routeLayer);
  if (startMarker) { startMarker.remove(); startMarker = null; }
  if (destMarker) { destMarker.remove(); destMarker = null; }
  const visited = store.getVisited();
  p.along.forEach((o, i) => {
    const m = L.marker(o.poi, { icon: poiIcon(o.poi, i + 1), riseOnHover: true }).addTo(poiLayer);
    m.on('click', () => openPoi(o.poi));
    poiMarkers.set(o.poi.id, m);
    if (visited[o.poi.id]) requestAnimationFrame(() => m.getElement()?.querySelector('.pin-poi')?.classList.add('visited'));
  });

  $('#resultEyebrow').textContent = `${MODES[p.mode].label} · ${p.type === 'loop' ? 'Runde' : 'Von A nach B'}`;
  $('#resultTitle').textContent = p.name;
  const newPct = Math.round(newShare(p.route, store.getTracks()) * 100);
  $('#resultStats').innerHTML = `
    <div class="stat"><b>${fmtKm(p.route.distance)}</b><span>km</span></div>
    <div class="stat"><b>${fmtMin(p.minutes).replace(' Min', '')}</b><span>${p.minutes < 60 ? 'Minuten' : 'Dauer'}</span></div>
    <div class="stat"><b>${p.along.length}</b><span>${p.mode === 'car' ? 'Stopps & Orte' : 'Entdeckungen'}</span></div>`;

  // notices
  const n = $('#resultNotice');
  let msg = '';
  if (p.type === 'ab' && p.tooShort) {
    msg = `Der Weg dauert mindestens <b>${fmtMin(p.directMin)}</b> – also länger als deine gewünschten ${fmtMin(p.minutesWanted)}. Hier ist der schnellste Weg, mit allem Spannenden direkt daneben.`;
  } else if (p.type === 'ab' && p.directMin && p.minutes > p.directMin * 1.1) {
    msg = `Direkt wären es ${fmtMin(p.directMin)} – wir haben <b>${fmtMin(p.minutes - p.directMin)} Entdecker-Umweg</b> eingebaut.`;
  }
  if (!p.tooShort && Math.abs(p.minutes / p.minutesWanted - 1) > 0.25) {
    msg += `${msg ? '<br>' : ''}ℹNäher an ${fmtMin(p.minutesWanted)} ging es hier nicht – die Wege vor Ort geben das nicht her. Versuch es mit „Andere Route“ nochmal.`;
  }
  if (newPct < 100 && store.getTracks().length) msg += `${msg ? '<br>' : ''}<b>${newPct} %</b> dieser Strecke sind neu für dich.`;
  if (p.stopMinutes) msg += `${msg ? '<br>' : ''}Enthält <b>${fmtMin(p.stopMinutes)}</b> Zeit vor Ort an den Stopps.`;
  n.innerHTML = msg; n.classList.toggle('hidden', !msg);
  $('#saveRouteLabel').textContent = p.savedId ? 'Gemerkt' : 'Speichern';
  renderExtra(p);

  const seen = store.getVisited();
  const strip = $('#poiStrip');
  strip.innerHTML = p.along.length ? p.along.map((o, i) => `
    <button class="poi-card${seen[o.poi.id] ? ' seen' : ''}" data-id="${o.poi.id}">
      <div class="img" ${o.poi.thumb ? `style="background-image:url('${esc(o.poi.thumb)}')"` : ''}>${o.poi.thumb ? '' : ico(o.poi.icon)}<span class="num">${i + 1}</span></div>
      <div class="meta"><b>${esc(o.poi.name)}</b><small>${o.aside ? `↪ ${Math.round(o.off / 10) * 10} m abseits` : esc(o.poi.type)} · ${fmtKm(o.along)} km</small></div>
    </button>`).join('')
    : '<p class="poi-empty">Hier ist es eher ruhig – aber auch das ist eine Entdeckung.</p>';
  setTimeout(() => fit(L.latLngBounds(line).pad(0.05)), 80); // after the sheet has its new height
}

/** climb, calories and the elevation profile of a planned route (loaded lazily) */
function renderExtra(p) {
  const bits = [];
  if (p.along.length) {
    const seen = store.getVisited();
    const fresh = p.along.filter(o => !seen[o.poi.id]).length;
    bits.push(`<span class="hl">${fresh} neue Orte · bis zu +${routeXp(p.route.distance, p.mode, fresh)} XP</span>`);
  }
  if (p.ele) bits.push(`↗ ${p.ele.gain} m`, `↘ ${p.ele.loss} m`);
  if (p.mode !== 'car') bits.push(`≈ ${kcal(p.mode, p.route.distance, prefs.weight)} kcal`, `${tempo(p.mode, p.route.distance, p.minutes * 60)} ${tempoUnit(p.mode)}`);
  $('#resultExtra').innerHTML = (bits.length ? `<div class="extra-line">${bits.map(b => b.startsWith('<') ? b : `<span>${b}</span>`).join('')}</div>` : '') + (p.ele && p.mode !== 'car' ? areaChart(p.ele.profile) : '');
  if (!p.ele && !p.eleLoading) {
    p.eleLoading = true;
    elevationProfile(p.route.coords).then(ele => { p.ele = ele; if (state.plan === p && state.view === 'result') renderExtra(p); }).catch(() => {});
  }
}

$('#poiStrip').addEventListener('click', e => {
  const c = e.target.closest('.poi-card'); if (!c) return;
  const o = state.plan.along.find(o => o.poi.id === c.dataset.id);
  if (o) openPoi(o.poi);
});
$('#poiStrip').addEventListener('mouseover', e => {
  const c = e.target.closest('.poi-card'); if (!c) return;
  $$('.pin-poi.active').forEach(x => x.classList.remove('active'));
  poiMarkers.get(c.dataset.id)?.getElement()?.querySelector('.pin-poi')?.classList.add('active');
});

$('#findRouteBtn').addEventListener('click', () => findRoute());
$('#rerollBtn').addEventListener('click', () => findRoute({ reroll: true }));
$('#backToPlan').addEventListener('click', () => {
  routeLayer.clearLayers(); poiLayer.clearLayers(); state.plan = null; state.stack = [];
  state.must = []; state.excluded.clear();
  if (state.start) setStart(state.start);
  if (prefs.type === 'ab' && state.dest) setDest(state.dest);
  show('plan', false);
});
$('#surpriseBtn').addEventListener('click', () => {
  const all = Object.keys(CATS).filter(c => c !== 'genuss');
  const pick = all.sort(() => Math.random() - .5).slice(0, 2);
  prefs.interests = pick; prefs.type = 'loop'; syncPrefsUI();
  toast(`Heute: ${pick.map(c => CATS[c].label).join(' & ')}`);
  state.attempt = Math.floor(Math.random() * 50);
  findRoute({ reroll: true });
});

/* ---------------- save / export routes ---------------- */
const slimPoi = p => ({ id: p.id, lat: p.lat, lng: p.lng, name: p.name, named: p.named, type: p.type, icon: p.icon, cats: p.cats, score: p.score, weight: p.weight, thumb: p.thumb, wikiTitle: p.wikiTitle, wikiLang: p.wikiLang, wikidata: p.wikidata, desc: p.desc, tags: pickTags(p.tags) });
const pickTags = (t = {}) => Object.fromEntries(Object.entries(t).filter(([k]) => ['artist_name', 'start_date', 'inscription', 'description', 'opening_hours', 'artwork_type'].includes(k)));

$('#saveRouteBtn').addEventListener('click', () => {
  const p = state.plan; if (!p) return;
  if (p.savedId) return toast('Schon gemerkt');
  const id = store.uid();
  store.addRoute({
    id, name: p.name, date: Date.now(), type: p.type, mode: p.mode, minutes: p.minutes, minutesWanted: p.minutesWanted,
    distance: p.route.distance, duration: p.route.duration, city: state.place?.city || '',
    coords: p.route.coords.map(c => [+c.lat.toFixed(5), +c.lng.toFixed(5)]),
    start: p.start, end: p.end, along: p.along.map(o => ({ along: o.along, off: o.off, aside: o.aside, poi: slimPoi(o.poi) })),
    ele: p.ele, stopMinutes: p.stopMinutes,
  });
  p.savedId = id;
  $('#saveRouteLabel').textContent = 'Gemerkt';
  toast('Route gemerkt – findest du unter „Meine Wege“');
});

function gpx(name, coords, wpts = []) {
  const x = s => esc(s);
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Exploring" xmlns="http://www.topografix.com/GPX/1/1">
<metadata><name>${x(name)}</name></metadata>
${wpts.map(w => `<wpt lat="${w.lat}" lon="${w.lng}"><name>${x(w.name)}</name></wpt>`).join('\n')}
<trk><name>${x(name)}</name><trkseg>
${coords.map(c => `<trkpt lat="${c.lat ?? c[0]}" lon="${c.lng ?? c[1]}">${c[2] ? `<time>${new Date(c[2]).toISOString()}</time>` : ''}</trkpt>`).join('\n')}
</trkseg></trk></gpx>`;
}
function download(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/gpx+xml' }));
  a.download = name.replace(/[^\wäöüÄÖÜß -]/g, '').trim() + '.gpx';
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
$('#gpxRouteBtn').addEventListener('click', () => {
  const p = state.plan; if (!p) return;
  download(p.name, gpx(p.name, p.route.coords, p.along.map(o => o.poi)));
});

/* ---------------- POI detail ---------------- */
let currentPoi = null;
async function openPoi(poi) {
  currentPoi = poi;
  show('poi', state.view !== 'poi');
  const hero = $('#poiHero');
  const setHero = src => { hero.style.backgroundImage = src ? `url('${src}')` : ''; hero.innerHTML = src ? '' : ico(poi.icon); hero.classList.toggle('empty', !src); };
  setHero(poi.thumb);
  $('#poiCat').textContent = poi.type;
  $('#poiTitle').textContent = poi.name;
  $('#poiText').innerHTML = '<p>Einen Moment, ich schlage nach …</p>';
  $('#poiLink').classList.add('hidden');
  const editable = !!state.plan && !state.nav && !state.plan.savedId;
  $('#poiWish').classList.toggle('hidden', !editable);
  $('#poiMust').textContent = state.must.some(m => m.id === poi.id) ? 'Ist eingeplant' : 'Unbedingt hin';
  panToVisible(poi);
  const s = await getStory(poi);
  if (currentPoi !== poi) return;
  if (s.thumb) setHero(s.thumb);
  const paras = s.text.split(/\n+/).filter(Boolean);
  const tags = [];
  if (poi.tags?.artist_name) tags.push('von ' + poi.tags.artist_name);
  if (poi.tags?.start_date) tags.push('seit ' + poi.tags.start_date);
  if (state.me) tags.push(fmtKm(dist(state.me, poi)) + ' km entfernt');
  $('#poiText').innerHTML = paras.map(t => `<p>${esc(t)}</p>`).join('') + (tags.length ? `<div class="poi-tags">${tags.map(t => `<span>${esc(t)}</span>`).join('')}</div>` : '');
  const link = $('#poiLink');
  if (s.url) { link.href = s.url; link.classList.remove('hidden'); }
}
$('#poiBack').addEventListener('click', back);
$('#poiSkip').addEventListener('click', () => {
  state.excluded.add(currentPoi.id); state.must = state.must.filter(m => m.id !== currentPoi.id);
  toast(`Ohne „${currentPoi.name}“ – ich plane neu`);
  state.stack = ['plan']; show('result', false); findRoute({ keep: true });
});
$('#poiMust').addEventListener('click', () => {
  if (!state.must.some(m => m.id === currentPoi.id)) state.must.push(currentPoi);
  toast(`„${currentPoi.name}“ ist fest eingeplant`);
  state.stack = ['plan']; show('result', false); findRoute({ keep: true });
});
$('#homeBtn').addEventListener('click', async () => {
  if (prefs.home) { setStart({ ...prefs.home }); return toast(`Start: ${prefs.home.name}`); }
  const s = getStart();
  const r = await reverse(s);
  prefs.home = { lat: s.lat, lng: s.lng, name: r.label ? `Hotel (${r.label})` : 'Mein Hotel' };
  store.savePrefs(); syncPrefsUI();
  toast('Als Hotel gemerkt – ein Tipp darauf setzt künftig den Start hierhin', 4200);
});

/* ---------------- navigation / tracking ---------------- */
let wakeLock = null;
async function startNav(withRoute) {
  if (!state.me) { toast('Warte auf deinen Standort …'); if (!SIM) return; }
  const p = withRoute ? state.plan : null;
  const nav = state.nav = {
    plan: p, mode: p ? p.mode : prefs.mode, pts: [], dist: 0, t0: Date.now(), pausedMs: 0, pauseAt: null, auto: false,
    visited: new Set(), myAlong: 0, idx: 0, cum: p ? cumulative(p.route.coords) : null, nearby: [], lastPos: null,
    splits: [], splitStart: 0, recent: [], eleGain: 0, eleRef: null, hasAlt: false, lastMoveAt: Date.now(), maxSpeed: 0,
  };
  liveLayer.clearLayers();
  nav.line = L.polyline([], { color: '#5856d6', weight: 6, opacity: .9, lineCap: 'round' }).addTo(liveLayer);
  if (!p) {
    routeLayer.clearLayers(); poiLayer.clearLayers(); poiMarkers.clear();
    $('#navNextName').textContent = 'Leg einfach los – ich melde mich, wenn es was zu sehen gibt.';
    $('#navNextDist').textContent = 'Freie Tour'; $('#navNextIcon').innerHTML = ico('compass');
    const c = state.me || getStart();
    loadPOIs({ points: [c], radius: nav.mode === 'car' ? 6000 : 2500, highlights: nav.mode === 'car' }, prefs.interests).then(list => {
      nav.nearby = list;
      for (const poi of list.filter(q => q.weight > 6).slice(0, 60)) {
        const m = L.marker(poi, { icon: poiIcon(poi) }).addTo(poiLayer);
        m.on('click', () => openPoi(poi)); poiMarkers.set(poi.id, m);
      }
    }).catch(() => {});
  }
  $('#navProgressWrap').classList.toggle('hidden', !p);
  $$('.live-tempo-unit').forEach(el => el.textContent = tempoUnit(nav.mode));
  $('#pauseBtn').textContent = 'Pause';
  state.following = true; $('#locateBtn').classList.add('following');
  state.stack = [];
  show('nav', false);
  if (state.me) panToVisible(state.me, 17);
  nav.timer = setInterval(updateNavUI, 1000);
  updateNavUI();
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch {}
  if (SIM) simulate();
}

function resumeNav(nav, silent) {
  nav.pausedMs += Date.now() - nav.pauseAt; nav.pauseAt = null; nav.auto = false;
  nav.lastMoveAt = Date.now(); nav.recent = [];
  $('#pauseBtn').textContent = 'Pause';
  if (!silent) toast('Weiter geht\'s!');
}

function navPos(me) {
  const nav = state.nav;
  if (nav.pauseAt) {
    // auto-pause ends by itself as soon as you move again
    if (!nav.auto || !nav.lastPos || dist(nav.lastPos, me) < 8) return;
    resumeNav(nav, true); nav.lastPos = { ...me };
  }
  if (me.acc && me.acc > 60) return;
  const last = nav.lastPos;
  if (last) {
    const d = dist(last, me);
    if (d < 4) return;
    const dt = (me.t - last.t) / 1000;
    if (!SIM && dt > 0 && d / dt > (nav.mode === 'car' ? 60 : nav.mode === 'bike' ? 18 : 9)) return; // GPS jump
    nav.dist += d;
    if (dt > 0) nav.maxSpeed = Math.max(nav.maxSpeed, d / dt);
  }
  nav.lastPos = me; nav.lastMoveAt = Date.now();
  nav.pts.push([+me.lat.toFixed(6), +me.lng.toFixed(6), me.t]);
  nav.line.addLatLng(me);
  if (state.following) panToVisible(me);

  // climb from GPS altitude (3 m threshold against noise)
  if (me.alt != null) {
    nav.hasAlt = true;
    if (nav.eleRef == null) nav.eleRef = me.alt;
    else if (me.alt - nav.eleRef > 3) { nav.eleGain += me.alt - nav.eleRef; nav.eleRef = me.alt; }
    else if (nav.eleRef - me.alt > 3) nav.eleRef = me.alt;
  }
  // kilometre splits
  const sec = navElapsed(nav);
  nav.recent.push({ sec, d: nav.dist });
  while (nav.recent.length > 2 && sec - nav.recent[0].sec > 25) nav.recent.shift();
  while (nav.mode !== 'car' && nav.dist >= (nav.splits.length + 1) * 1000) {
    const s = { m: 1000, sec: Math.max(1, sec - nav.splitStart) };
    nav.splits.push(s); nav.splitStart = sec;
    toast(`Km ${nav.splits.length} · ${tempo(nav.mode, s.m, s.sec)} ${tempoUnit(nav.mode)}`, 3000);
    navigator.vibrate?.(120);
  }

  const near = MODES[nav.mode].near;
  const candidates = nav.plan ? nav.plan.along.map(o => o.poi) : nav.nearby;
  for (const poi of candidates) {
    if (nav.visited.has(poi.id) || dist(me, poi) > near) continue;
    nav.visited.add(poi.id);
    store.markVisited(poi);
    poiMarkers.get(poi.id)?.getElement()?.querySelector('.pin-poi')?.classList.add('visited');
    toast(`Entdeckt: ${poi.name}`, 3500);
    navigator.vibrate?.([60, 40, 60]);
    break;
  }
  if (nav.plan) {
    // look only a little ahead of where we are – on a loop the end of the route lies right next to the start
    const c = nav.cum, line = nav.plan.route.coords;
    let to = nav.idx;
    while (to < c.length - 1 && c[to] < nav.myAlong + 500) to++;
    let pr = projectOnLine(me, line, c, Math.max(0, nav.idx - 3), to);
    if (pr.off > 80) { // left the route or took a shortcut: accept a spot further ahead
      const g = projectOnLine(me, line, c);
      if (g.off < 60 && g.along > nav.myAlong && g.along < nav.myAlong + 3000) pr = g;
    }
    if (pr.off < 80) { nav.myAlong = Math.max(nav.myAlong, pr.along); nav.idx = Math.max(nav.idx, pr.idx); }
  }
  updateNext();
}

function updateNext() {
  const nav = state.nav, me = state.me;
  const box = $('#navNext');
  let target = null, label = '';
  if (nav.plan) {
    const nx = nav.plan.along.find(o => !nav.visited.has(o.poi.id) && o.along > nav.myAlong - 20);
    if (nx) { target = nx.poi; label = `In ${fmtDistShort(Math.max(0, nx.along - nav.myAlong))}`; }
    else if (nav.myAlong > nav.plan.route.distance - 60) label = 'Ziel erreicht';
    else label = `Noch ${fmtDistShort(nav.plan.route.distance - nav.myAlong)} bis zum Ziel`;
    $('#navProgress').style.width = Math.min(100, nav.myAlong / nav.plan.route.distance * 100) + '%';
  } else if (me && nav.nearby.length) {
    let best = null, bd = 700;
    for (const p of nav.nearby) { if (nav.visited.has(p.id)) continue; const d = dist(me, p) / Math.max(1, p.weight / 4); if (d < bd) { bd = d; best = p; } }
    if (best) { target = best; label = `In der Nähe · ${fmtDistShort(dist(me, best))}`; }
  }
  box.classList.toggle('clickable', !!target);
  box.onclick = target ? () => openPoi(target) : null;
  if (target) { $('#navNextIcon').innerHTML = ico(target.icon); $('#navNextName').textContent = target.name; }
  else if (nav.plan) { $('#navNextIcon').innerHTML = ico('flag'); $('#navNextName').textContent = nav.plan.end ? (nav.plan.end.name || 'Ziel') : 'Zurück zum Start'; }
  if (label) $('#navNextDist').textContent = label;
}
const fmtDistShort = m => m < 950 ? `${Math.round(m / 10) * 10} m` : `${fmtKm(m)} km`;

const navElapsed = nav => (Date.now() - nav.t0 - nav.pausedMs - (nav.pauseAt ? Date.now() - nav.pauseAt : 0)) / 1000;
function updateNavUI() {
  const nav = state.nav; if (!nav) return;
  // auto-pause: standing still for a while (traffic light, photo, reading a sign)
  if (!nav.pauseAt && !SIM && nav.mode !== 'car' && nav.pts.length > 1 && Date.now() - nav.lastMoveAt > 12000) {
    nav.pauseAt = nav.lastMoveAt + 3000; nav.auto = true;
    $('#pauseBtn').textContent = 'Auto-Pause · Weiter';
  }
  const sec = navElapsed(nav);
  $('#liveTime').textContent = fmtClock(sec);
  $('#liveDist').textContent = (nav.dist / 1000).toFixed(2).replace('.', ',');
  $('#livePace').textContent = tempo(nav.mode, nav.dist, sec);
  const r = nav.recent;
  $('#liveNow').textContent = nav.pauseAt || r.length < 2 ? '–' : tempo(nav.mode, r[r.length - 1].d - r[0].d, r[r.length - 1].sec - r[0].sec);
  $('#liveKcal').textContent = nav.mode === 'car' ? '–' : kcal(nav.mode, nav.dist, prefs.weight);
  $('#liveEle').textContent = nav.hasAlt ? Math.round(nav.eleGain) : '–';
}

$('#startNavBtn').addEventListener('click', () => startNav(true));
$('#freeTrackBtn').addEventListener('click', () => startNav(false));
$('#pauseBtn').addEventListener('click', () => {
  const nav = state.nav; if (!nav) return;
  if (nav.pauseAt) { resumeNav(nav); nav.lastPos = null; }
  else { nav.pauseAt = Date.now(); nav.auto = false; $('#pauseBtn').textContent = 'Weiter'; toast('Pausiert'); }
});
$('#stopBtn').addEventListener('click', async () => {
  const nav = state.nav; if (!nav) return;
  clearInterval(nav.timer); clearInterval(simT);
  if (!nav.pauseAt) nav.pauseAt = Date.now(); // freeze the clock while the dialog is open
  try { await wakeLock?.release(); } catch {}
  const sec = navElapsed(nav);
  const dlg = $('#saveDialog');
  const enough = nav.pts.length > 1 && nav.dist > 30;
  $('#saveDialogEmoji').innerHTML = ico(enough ? (nav.visited.size >= 3 ? 'trophy' : 'flag') : 'compass');
  $('#saveDialogTitle').textContent = enough ? 'Stark erkundet!' : 'Schon vorbei?';
  $('#saveDialogText').innerHTML = enough
    ? `<b>${fmtKm(nav.dist)} km</b> in ${fmtClock(sec)} · <b>${nav.visited.size}</b> ${nav.visited.size === 1 ? 'Ort' : 'Orte'} entdeckt`
    : 'Für diese Tour wurde noch kein Weg aufgezeichnet.';
  $('#saveName').classList.toggle('hidden', !enough);
  dlg.querySelector('button[value=save]').classList.toggle('hidden', !enough);
  $('#saveName').value = nav.plan?.name || `${daypart()}tour${state.place?.city ? ' in ' + state.place.city : ''}`;
  dlg.showModal();
  dlg.onclose = () => {
    let saved = null, rw = null;
    if (dlg.returnValue === 'save' && enough) {
      const before = getProfile();
      const splits = nav.splits.slice();
      const restM = nav.dist - splits.length * 1000;
      if (nav.mode !== 'car' && restM > 50) splits.push({ m: Math.round(restM), sec: Math.max(1, Math.round(sec - nav.splitStart)) });
      saved = {
        id: store.uid(), name: $('#saveName').value.trim() || 'Tour', date: nav.t0, mode: nav.mode,
        coords: thin(nav.pts.map(([lat, lng, t]) => ({ lat, lng, t })), 6).map(p => [p.lat, p.lng, p.t]),
        distance: nav.dist, duration: sec, city: state.place?.city || '',
        splits, kcal: kcal(nav.mode, nav.dist, prefs.weight), eleGain: nav.hasAlt ? Math.round(nav.eleGain) : null,
        maxSpeed: SIM ? null : nav.maxSpeed,
        visited: [...nav.visited].map(id => (nav.plan ? nav.plan.along.map(o => o.poi) : nav.nearby).find(p => p.id === id)?.name).filter(Boolean),
      };
      store.addTrack(saved);
      const after = renderLevel();
      rw = { ...reward(before, after), after };
      toast(rw.levelUp ? `Level ${after.level}: ${after.title}` : `+${rw.xp} XP`);
    }
    state.nav = null; liveLayer.clearLayers(); drawTrails();
    $('#locateBtn').classList.remove('following');
    if (state.plan) { renderPlan(); show('result', false); }
    else { poiLayer.clearLayers(); show('plan', false); }
    if (saved) openActivity(saved, rw);
  };
});

/* simulation for demos/tests: ?sim */
let simT;
function simulate() {
  const nav = state.nav;
  const step = speedMpm(nav.mode) / 60 * 10; // 10x speed
  let along = 0;
  clearInterval(simT);
  simT = setInterval(() => {
    if (!state.nav) return clearInterval(simT);
    if (nav.pauseAt) return;
    along += step;
    let p;
    if (nav.plan) {
      const c = nav.cum, pts = nav.plan.route.coords;
      if (along >= c[c.length - 1]) { clearInterval(simT); return; }
      let i = c.findIndex(x => x > along) - 1; if (i < 0) i = 0;
      const t = (along - c[i]) / (c[i + 1] - c[i] || 1);
      p = { lat: pts[i].lat + (pts[i + 1].lat - pts[i].lat) * t, lng: pts[i].lng + (pts[i + 1].lng - pts[i].lng) * t };
    } else {
      const m = state.me; const a = (Date.now() / 20000) % (2 * Math.PI);
      p = { lat: m.lat + Math.cos(a) * step / 111000, lng: m.lng + Math.sin(a) * step / 70000 };
    }
    onPos({ ...p, acc: 5, t: Date.now() });
  }, 1000);
}

/* ---------------- level & rewards ---------------- */
const getProfile = () => profile(store.getTracks(), store.getVisited(), prefs.weeklyGoal);
function renderLevel() {
  const p = getProfile();
  $('#levelBtn').innerHTML = `${ring(p.pct, 34, 3.5, p.level)}<span>${p.title}<small>${p.xp} XP</small></span>`;
  return p;
}
$('#levelBtn').addEventListener('click', () => {
  if (state.nav) return;
  libTab = 'stats';
  if (state.view === 'library') return renderLibrary();
  if (state.view === 'activity') { liveLayer.clearLayers(); state.stack.pop(); state.view = state.stack.pop() || 'plan'; }
  renderLibrary(); show('library');
});

/* ---------------- activity detail ---------------- */
let currentAct = null;
function openActivity(t, rw = null) {
  currentAct = t;
  $('#actReward').innerHTML = rw ? `<div class="reward">${ico(rw.levelUp ? 'trophy' : 'sparkles')}<div><b>+${rw.xp} XP</b><span>${rw.levelUp ? `Level ${rw.levelUp.level} erreicht: ${rw.levelUp.title}` : `Noch ${rw.after.toNext} XP bis Level ${rw.after.level + 1}`}</span>${rw.badges.length ? `<div class="reward-badges">${rw.badges.map(b => `<span>Neues Abzeichen: <b style="display:inline;font-size:inherit">${b.name}</b></span>`).join('')}</div>` : ''}</div></div>` : '';
  show('activity', state.view !== 'activity');
  liveLayer.clearLayers();
  L.polyline(t.coords, { color: '#fff', weight: 9 }).addTo(liveLayer);
  L.polyline(t.coords, { color: '#5856d6', weight: 5 }).addTo(liveLayer);
  setTimeout(() => fit(L.latLngBounds(t.coords).pad(.08)), 80);
  $('#actEyebrow').textContent = `${MODES[t.mode]?.label || 'Tour'} · ${new Date(t.date).toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'short' })}, ${new Date(t.date).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`;
  $('#actTitle').textContent = t.name;
  renderActivity();
  if (!t.ele) {
    elevationProfile(t.coords).then(ele => {
      if (!ele) return;
      t.ele = ele; store.updateTrack(t.id, { ele });
      if (currentAct === t && state.view === 'activity') renderActivity();
    }).catch(() => {});
  }
}
function renderActivity() {
  const t = currentAct;
  const gain = t.ele?.gain ?? t.eleGain;
  const cell = (v, l) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`;
  $('#actStats').innerHTML =
    cell(fmtKm(t.distance), 'km') + cell(fmtClock(t.duration), 'Zeit') + cell(tempo(t.mode, t.distance, t.duration), 'Ø ' + tempoUnit(t.mode)) +
    cell(t.mode === 'car' ? '–' : (t.kcal ?? kcal(t.mode, t.distance, prefs.weight)), 'kcal') + cell(gain != null ? gain : '…', 'Höhenmeter') + cell(t.visited?.length || 0, 'Orte entdeckt');
  $('#actEle').innerHTML = t.ele ? `<h2 class="label">Höhenprofil <small>${t.ele.min}–${t.ele.max} m</small></h2><div class="chart-card">${areaChart(t.ele.profile, '#5856d6')}</div>` : '';
  $('#actSplits').innerHTML = t.splits?.length ? `<h2 class="label">Kilometer-Zeiten <small>${tempoUnit(t.mode)}</small></h2>${splitBars(t.splits, t.mode)}` : '';
  $('#actPlaces').innerHTML = t.visited?.length ? `<h2 class="label">Entdeckt</h2><div class="poi-tags">${t.visited.map(n => `<span>${esc(n)}</span>`).join('')}</div>` : '';
}
$('#actBack').addEventListener('click', () => { liveLayer.clearLayers(); back(); if (state.view === 'library') renderLibrary(); });
$('#actGpx').addEventListener('click', () => download(currentAct.name, gpx(currentAct.name, currentAct.coords)));
$('#actDelete').addEventListener('click', () => {
  if (!confirm('Diese Aktivität wirklich löschen?')) return;
  store.removeTrack(currentAct.id); drawTrails(); renderLevel(); $('#actBack').click();
});
$('#actAsRoute').addEventListener('click', () => {
  const t = currentAct, c = t.coords;
  const a = { lat: c[0][0], lng: c[0][1] }, b = { lat: c[c.length - 1][0], lng: c[c.length - 1][1] };
  const loop = dist(a, b) < 250;
  store.addRoute({
    id: store.uid(), name: t.name, date: Date.now(), type: loop ? 'loop' : 'ab', mode: t.mode, minutes: t.duration / 60,
    distance: t.distance, duration: t.duration, city: t.city, coords: c.map(p => [p[0], p[1]]),
    start: a, end: loop ? null : { ...b, name: 'Ziel' }, along: [],
  });
  toast('Als Route gemerkt – du kannst sie jederzeit wieder starten');
});

/* ---------------- library ---------------- */
let libTab = 'tracks';
const delIcon = '<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>';
function renderLibrary() {
  const tracks = store.getTracks(), routes = store.getRoutes(), visited = store.getVisited();
  const pr = renderLevel();
  $('#explorerStats').innerHTML = `<div class="level-card">${ring(pr.pct, 60, 6, pr.level)}
    <div><h3>${pr.title}</h3><p>${pr.toNext} XP bis Level ${pr.level + 1}</p></div>
    <div class="level-facts"><b>${Object.keys(visited).length}</b>Orte entdeckt</div></div>`;
  $$('#libTabs .seg').forEach(b => b.classList.toggle('active', b.dataset.tab === libTab));
  $('#libList').classList.toggle('hidden', libTab === 'stats');
  $('#libStats').classList.toggle('hidden', libTab !== 'stats');
  if (libTab === 'stats') return renderStats(tracks);
  const list = libTab === 'tracks' ? tracks : routes;
  $('#libList').innerHTML = list.length ? list.map(t => `
    <li class="lib-item" data-id="${t.id}">
      <div class="lib-icon">${ico(MODES[t.mode]?.icon || 'compass')}</div>
      <div class="lib-main"><b>${esc(t.name)}</b>
        <small>${fmtDate(t.date)}${t.city ? ' · ' + esc(t.city) : ''} · ${fmtKm(t.distance)} km · ${libTab === 'tracks' ? `${fmtClock(t.duration)} · ${tempo(t.mode, t.distance, t.duration)} ${tempoUnit(t.mode)}` : fmtMin(t.minutes)}${libTab === 'routes' && t.along?.length ? ' · ' + t.along.length + ' Orte' : ''}</small></div>
      ${libTab === 'routes' ? `<button class="lib-del" data-del="${t.id}" title="Löschen" aria-label="Löschen">${delIcon}</button>` : '<span class="lib-chev">›</span>'}
    </li>`).join('')
    : `<li class="lib-empty"><div>${ico(libTab === 'tracks' ? 'run' : 'bookmark')}</div>${libTab === 'tracks'
      ? 'Noch keine Aktivitäten. Starte eine Route oder tippe auf „Einfach loslegen“ – deine Wege erscheinen hier und lila auf der Karte.'
      : 'Noch nichts gemerkt. Tippe bei einer Route auf „Speichern“, um sie später wieder zu starten.'}</li>`;
}

function renderStats(tracks) {
  const weeks = weekly(tracks, 8), now = weeks[weeks.length - 1];
  const goal = prefs.weeklyGoal, pct = Math.min(100, now.km / goal * 100);
  const streak = streakWeeks(tracks);
  const totals = totalsByMode(tracks), recs = records(tracks);
  const pr = getProfile();
  $('#libStats').innerHTML = `
    <h2 class="label">Diese Woche</h2>
    <div class="group" style="margin-top:0">${pr.challenges.map(c => { const done = c.value >= c.target; return `
      <div class="challenge${done ? ' done' : ''}"><div class="lib-icon">${ico(done ? 'check' : c.icon)}</div>
        <div class="lib-main"><b>${c.name}</b><div class="progress"><div class="progress-bar" style="width:${Math.min(100, c.value / c.target * 100)}%"></div></div></div>
        <span class="challenge-val">${c.unit ? c.value.toFixed(1).replace('.', ',') : c.value} / ${c.target}</span></div>`; }).join('')}</div>
    <h2 class="label">Abzeichen <small>${pr.badges.filter(b => b.done).length} von ${pr.badges.length}</small></h2>
    <div class="badges">${pr.badges.map(b => `
      <div class="badge${b.done ? ' done' : ''}" title="${b.desc}"><div class="badge-icon">${ring(b.pct, 56, 3)}${ico(b.icon)}</div><b>${b.name}</b><small>${b.done ? b.desc : `${b.value} / ${b.target}`}</small></div>`).join('')}</div>
    <div class="goal-card hidden">
      <div class="goal-head"><b>Diese Woche</b><span>${now.km.toFixed(1).replace('.', ',')} / ${goal} km</span></div>
      <div class="progress"><div class="progress-bar" style="width:${pct}%"></div></div>
      <small>${pct >= 100 ? 'Wochenziel geschafft!' : `Noch ${(goal - now.km).toFixed(1).replace('.', ',')} km bis zum Wochenziel`}${streak > 1 ? ` · ${streak} Wochen in Folge aktiv` : ''}</small>
    </div>
    <h2 class="label">Letzte 8 Wochen <small>km</small></h2>
    ${weekBars(weeks, goal)}
    ${recs.length ? `<h2 class="label">Bestleistungen</h2><ul class="lib-list group">${recs.map(r => `
      <li class="lib-item" data-track="${r.track.id}"><div class="lib-icon">${ico(r.icon)}</div>
        <div class="lib-main"><b>${r.value}</b><small>${r.label} · ${esc(r.track.name)}</small></div><span class="lib-chev">›</span></li>`).join('')}</ul>` : ''}
    ${Object.keys(totals).length ? `<h2 class="label">Gesamt</h2><div class="totals">${Object.entries(totals).map(([m, o]) => `
      <div class="total">${ico(MODES[m]?.icon || 'compass')}<b>${fmtKm(o.m)} km</b><small>${o.n}× · ${fmtClock(o.sec)}${o.kcal ? ' · ' + o.kcal + ' kcal' : ''}</small></div>`).join('')}</div>` : ''}
    <h2 class="label">Einstellungen</h2>
    <div class="settings">
      <label>Gewicht <small>für Kalorien</small><span><input type="number" id="setWeight" min="30" max="200" value="${prefs.weight}" inputmode="numeric"> kg</span></label>
      <label>Wochenziel<span><input type="number" id="setGoal" min="1" max="500" value="${prefs.weeklyGoal}" inputmode="numeric"> km</span></label>
      <label>Stopp-Dauer <small>bei Autofahrten</small><span><input type="number" id="setStop" min="0" max="120" step="5" value="${prefs.stopMin}" inputmode="numeric"> Min</span></label>
      <div class="set-row">Hotel / Zuhause<span>${prefs.home ? `${esc(prefs.home.name || 'gemerkt')} <button class="link" id="clearHome">entfernen</button>` : '<i>noch nicht gemerkt</i>'}</span></div>
    </div>`;
}
$('#libStats').addEventListener('change', e => {
  const v = +e.target.value;
  if (e.target.id === 'setWeight' && v >= 30) prefs.weight = v;
  if (e.target.id === 'setGoal' && v >= 1) prefs.weeklyGoal = v;
  if (e.target.id === 'setStop' && v >= 0) prefs.stopMin = v;
  store.savePrefs(); renderLibrary();
});
$('#libStats').addEventListener('click', e => {
  if (e.target.id === 'clearHome') { prefs.home = null; store.savePrefs(); syncPrefsUI(); renderLibrary(); return; }
  const id = e.target.closest('[data-track]')?.dataset.track;
  const t = id && store.getTracks().find(x => x.id === id);
  if (t) openActivity(t);
});
$('#libraryBtn').addEventListener('click', () => {
  if (state.view === 'library') return back();
  if (state.view === 'activity') { liveLayer.clearLayers(); state.stack.pop(); state.view = state.stack.pop() || 'plan'; }
  renderLibrary(); show('library');
});
$('#libBack').addEventListener('click', () => { liveLayer.clearLayers(); back(); });
$('#libTabs').addEventListener('click', e => { const b = e.target.closest('.seg'); if (b) { libTab = b.dataset.tab; renderLibrary(); } });
$('#libList').addEventListener('click', e => {
  const delId = e.target.closest('[data-del]')?.dataset.del;
  if (delId) {
    if (!confirm('Diese Route wirklich löschen?')) return;
    store.removeRoute(delId); renderLibrary(); return;
  }
  const li = e.target.closest('.lib-item'); if (!li || state.nav) return;
  if (libTab === 'tracks') {
    const t = store.getTracks().find(x => x.id === li.dataset.id);
    if (t) openActivity(t);
  } else {
    const r = store.getRoutes().find(x => x.id === li.dataset.id); if (!r) return;
    liveLayer.clearLayers();
    state.plan = {
      route: { coords: r.coords.map(([lat, lng]) => ({ lat, lng })), distance: r.distance, duration: r.duration },
      minutes: r.minutes, minutesWanted: r.minutesWanted || r.minutes, type: r.type, mode: r.mode, start: r.start, end: r.end,
      along: r.along || [], name: r.name, savedId: r.id, waypoints: [], ele: r.ele, stopMinutes: r.stopMinutes,
    };
    renderPlan(); state.stack = ['plan']; show('result', false);
  }
});


/* ---------------- boot ---------------- */
$('#interests').innerHTML = Object.entries(CATS).map(([k, c]) => `<button class="chip" data-int="${k}">${ico(c.icon)}${c.label}</button>`).join('');
$('#navNextIcon').innerHTML = ico('compass');
syncPrefsUI();
renderLevel();
greet();
drawTrails();
startGeo();
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
window.__exploring = { state, map }; // debugging aid
