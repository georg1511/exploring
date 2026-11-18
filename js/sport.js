// Sport side of the app: calories, elevation, statistics, records and tiny SVG charts
import { cumulative } from './geo.js';

const KCAL_PER_KG_KM = { walk: 0.75, run: 1.03, bike: 0.32, car: 0 };
export const kcal = (mode, meters, weight) => Math.round((KCAL_PER_KG_KM[mode] || 0) * weight * meters / 1000);

export const usesSpeed = mode => mode === 'bike' || mode === 'car';   // km/h instead of min/km
export const fmtPace = p => !isFinite(p) || p <= 0 || p > 99 ? '–' : `${Math.floor(p)}:${String(Math.floor((p % 1) * 60)).padStart(2, '0')}`;
/** pace (min/km) or speed (km/h) as text, depending on the sport */
export function tempo(mode, meters, seconds) {
  if (meters < 30 || seconds <= 0) return '–';
  return usesSpeed(mode) ? (meters / 1000 / (seconds / 3600)).toFixed(1).replace('.', ',') : fmtPace(seconds / 60 / (meters / 1000));
}
export const tempoUnit = mode => usesSpeed(mode) ? 'km/h' : 'min/km';

/* ---------------- elevation (Open-Meteo, 90 m terrain model) ---------------- */
export async function elevationProfile(coords) {
  const pts = coords.map(c => Array.isArray(c) ? { lat: c[0], lng: c[1] } : c);
  if (pts.length < 2) return null;
  const cum = cumulative(pts), total = cum[cum.length - 1];
  const n = Math.min(100, Math.max(12, Math.round(total / 60)));
  const sample = [];
  let j = 0;
  for (let i = 0; i < n; i++) {
    const d = total * i / (n - 1);
    while (j < cum.length - 2 && cum[j + 1] < d) j++;
    const t = (d - cum[j]) / ((cum[j + 1] - cum[j]) || 1);
    sample.push({ d, lat: pts[j].lat + (pts[j + 1].lat - pts[j].lat) * t, lng: pts[j].lng + (pts[j + 1].lng - pts[j].lng) * t });
  }
  const url = `https://api.open-meteo.com/v1/elevation?latitude=${sample.map(p => p.lat.toFixed(5)).join(',')}&longitude=${sample.map(p => p.lng.toFixed(5)).join(',')}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('elevation');
  const ele = (await res.json()).elevation;
  // light smoothing, then count climbs with a 2 m threshold so noise doesn't add up
  const sm = ele.map((e, i) => (ele[Math.max(0, i - 1)] + e + ele[Math.min(ele.length - 1, i + 1)]) / 3);
  let gain = 0, loss = 0, ref = sm[0];
  for (const e of sm) {
    if (e - ref > 2) { gain += e - ref; ref = e; }
    else if (ref - e > 2) { loss += ref - e; ref = e; }
  }
  return { gain: Math.round(gain), loss: Math.round(loss), min: Math.round(Math.min(...sm)), max: Math.round(Math.max(...sm)), profile: sample.map((p, i) => [Math.round(p.d), Math.round(sm[i])]) };
}

/* ---------------- charts ---------------- */
export function areaChart(profile, color = 'var(--tint)') {
  if (!profile?.length) return '';
  const W = 320, H = 70, maxD = profile[profile.length - 1][0] || 1;
  const es = profile.map(p => p[1]);
  const lo = Math.min(...es), hi = Math.max(Math.max(...es), lo + 12);
  const x = d => (d / maxD * W).toFixed(1), y = e => (H - 4 - (e - lo) / (hi - lo) * (H - 12)).toFixed(1);
  const line = profile.map((p, i) => (i ? 'L' : 'M') + x(p[0]) + ' ' + y(p[1])).join(' ');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
    <path d="${line} L${W} ${H} L0 ${H} Z" style="fill:${color}" opacity=".16" stroke="none"/>
    <path d="${line}" fill="none" style="stroke:${color}" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>`;
}

/** horizontal bars, e.g. km splits: faster = longer */
export function splitBars(splits, mode) {
  if (!splits?.length) return '';
  const speeds = splits.map(s => s.m / s.sec);
  const max = Math.max(...speeds), best = speeds.indexOf(max);
  return `<div class="splits">${splits.map((s, i) => `
    <div class="split${i === best && splits.length > 1 ? ' best' : ''}">
      <span class="split-n">${s.m < 990 ? (s.m / 1000).toFixed(1).replace('.', ',') : i + 1}</span>
      <span class="split-bar"><i style="width:${Math.max(8, speeds[i] / max * 100)}%"></i></span>
      <span class="split-v">${tempo(mode, s.m, s.sec)}</span>
    </div>`).join('')}</div>`;
}

export function weekBars(weeks, goal) {
  const max = Math.max(goal || 0, ...weeks.map(w => w.km), 1);
  return `<div class="weekbars">${weeks.map((w, i) => `
    <div class="weekbar${i === weeks.length - 1 ? ' now' : ''}" title="${w.km.toFixed(1)} km">
      <span class="wb-val">${w.km >= 0.5 ? Math.round(w.km) : ''}</span>
      <span class="wb-col"><i style="height:${Math.max(3, w.km / max * 100)}%"></i></span>
      <span class="wb-lbl">${w.label}</span>
    </div>`).join('')}</div>`;
}

/* ---------------- statistics ---------------- */
const SPORT = t => t.mode !== 'car';
export function weekStart(ts) {
  const d = new Date(ts); d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // Monday
  return d.getTime();
}
export function weekly(tracks, n = 8) {
  const now = weekStart(Date.now()), W = 7 * 864e5;
  const weeks = [];
  for (let i = n - 1; i >= 0; i--) {
    const from = weekStart(now - i * W + 36e5); // +1h guards against DST shifts
    const d = new Date(from);
    weeks.push({ from, to: from + W, km: 0, label: `${d.getDate()}.${d.getMonth() + 1}.` });
  }
  for (const t of tracks.filter(SPORT)) {
    const ws = weekStart(t.date);
    const w = weeks.find(w => w.from === ws);
    if (w) w.km += t.distance / 1000;
  }
  return weeks;
}
export function streakWeeks(tracks) {
  const set = new Set(tracks.filter(SPORT).map(t => weekStart(t.date)));
  let s = 0, w = weekStart(Date.now());
  if (!set.has(w)) w = weekStart(w - 864e5); // this week may still be open
  while (set.has(w)) { s++; w = weekStart(w - 864e5); }
  return s;
}
export function totalsByMode(tracks) {
  const out = {};
  for (const t of tracks) {
    const o = out[t.mode] ||= { n: 0, m: 0, sec: 0, kcal: 0 };
    o.n++; o.m += t.distance; o.sec += t.duration; o.kcal += t.kcal || 0;
  }
  return out;
}
export function records(tracks) {
  const sport = tracks.filter(SPORT);
  if (!sport.length) return [];
  const recs = [];
  const longest = sport.reduce((a, b) => b.distance > a.distance ? b : a);
  recs.push({ icon: 'ruler', label: 'Längste Strecke', value: (longest.distance / 1000).toFixed(1).replace('.', ',') + ' km', track: longest });
  const longT = sport.reduce((a, b) => b.duration > a.duration ? b : a);
  recs.push({ icon: 'clock', label: 'Längste Zeit', value: fmtDur(longT.duration), track: longT });
  let bestKm = null;
  for (const t of sport.filter(t => t.mode === 'run')) for (const s of t.splits || []) {
    if (s.m >= 990 && (!bestKm || s.sec < bestKm.sec)) bestKm = { sec: s.sec, track: t };
  }
  if (bestKm) recs.push({ icon: 'bolt', label: 'Schnellster Lauf-Kilometer', value: fmtPace(bestKm.sec / 60) + ' min', track: bestKm.track });
  const climbs = sport.filter(t => (t.ele?.gain ?? t.eleGain) > 0);
  if (climbs.length) {
    const c = climbs.reduce((a, b) => (b.ele?.gain ?? b.eleGain) > (a.ele?.gain ?? a.eleGain) ? b : a);
    recs.push({ icon: 'mountain', label: 'Meiste Höhenmeter', value: (c.ele?.gain ?? c.eleGain) + ' m', track: c });
  }
  const places = tracks.filter(t => t.visited?.length);
  if (places.length) {
    const p = places.reduce((a, b) => b.visited.length > a.visited.length ? b : a);
    recs.push({ icon: 'compass', label: 'Meiste Entdeckungen', value: p.visited.length + ' Orte', track: p });
  }
  return recs;
}
export function fmtDur(s) {
  s = Math.max(0, Math.floor(s));
  const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, sec = s % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(sec).padStart(2, '0');
}
