// Route planning: loops & A→B with a time budget, threaded through interesting places
import { dist, bearing, destPoint, cumulative, projectOnLine, pathLength, sampleLine, cellKey } from './geo.js';
import { getRoute, MODES } from './api.js';
import { prefs } from './store.js';

/** meters per minute for a mode */
export function speedMpm(mode) {
  if (mode === 'car') return MODES.car.kmh * 1000 / 60;
  return 1000 / prefs.pace[mode]; // pace = min/km
}

export function routeMinutes(route, mode) {
  if (mode === 'car') return route.duration / 60 * 1.15;
  return route.distance / speedMpm(mode);
}

/** radius we need to search POIs in, for the planned trip */
export function searchRadius(minutes, mode, start, end) {
  const D = minutes * speedMpm(mode) / MODES[mode].detour;
  if (end) return Math.max(dist(start, end) / 2 + 600, D / 2.2);
  return Math.max(700, D / Math.PI * 1.15);
}

/**
 * Where to look for places. Loops: a circle plus a ring of Wikipedia sample points.
 * A→B: a corridor along the direct route whose width grows with the spare time.
 */
export function searchArea({ start, end, minutes, mode, direct }) {
  if (!end) {
    const R = searchRadius(minutes, mode, start);
    const ring = [0, 60, 120, 180, 240, 300].map(b => destPoint(start, b, R * 0.6));
    return { points: [start], radius: R, wikiPoints: R > 900 ? [start, ...ring] : [start], wikiRadius: Math.max(450, R * (R > 900 ? 0.55 : 1)), highlights: R > 5000 };
  }
  const directMin = routeMinutes(direct, mode);
  const perMin = direct.distance / Math.max(1, directMin);           // real speed on this trip
  const extra = Math.max(0, minutes - directMin) * perMin;           // spare meters
  const base = mode === 'car' ? 1500 : mode === 'bike' ? 500 : 300;
  const width = Math.min(10000, Math.max(base, extra / 2.5));
  const len = direct.distance;
  const wikiRadius = Math.min(10000, Math.max(500, width));
  const nWiki = Math.max(2, Math.min(12, Math.ceil(len / (wikiRadius * 1.3))));
  return {
    points: sampleLine(direct.coords, Math.max(width, len / 40, 200)).concat(end),
    radius: width,
    wikiPoints: sampleLine(direct.coords, len / nWiki).concat(end),
    wikiRadius,
    highlights: mode === 'car' || len > 25000,
  };
}

function rnd(seed) { // deterministic-ish per attempt
  let s = seed * 9301 + 49297;
  return () => (s = (s * 9301 + 49297) % 233280) / 233280;
}

function snap(anchor, pois, maxD, used, avoid) {
  let best = null, bestV = 0;
  for (const p of pois) {
    if (used.has(p.id)) continue;
    const d = dist(anchor, p);
    if (d > maxD) continue;
    if (avoid.some(a => dist(a, p) < 60)) continue;
    const v = p.weight * Math.exp(-d / (maxD * 0.55));
    if (v > bestV) { bestV = v; best = p; }
  }
  if (best) used.add(best.id);
  return best;
}

function pickBearing(start, r, pois, random) {
  const sectors = new Array(12).fill(0.5);
  for (const p of pois) {
    const d = dist(start, p);
    if (d < r * 0.3 || d > r * 2.3) continue;
    sectors[Math.floor(bearing(start, p) / 30) % 12] += p.weight;
  }
  // smooth: a loop covers ~ sector ±60°
  const sm = sectors.map((_, i) => sectors[(i + 11) % 12] * .6 + sectors[i] + sectors[(i + 1) % 12] * .6);
  const total = sm.reduce((a, b) => a + b ** 2, 0);
  let x = random() * total;
  for (let i = 0; i < 12; i++) { x -= sm[i] ** 2; if (x <= 0) return i * 30 + random() * 30; }
  return random() * 360;
}

export async function planLoop({ start, minutes, mode, pois, must = [], attempt = 0 }) {
  const random = rnd(attempt + 1 + Math.floor(start.lat * 1000));
  const target = minutes * speedMpm(mode);
  let P = target / MODES[mode].detour;
  const theta = pickBearing(start, P / (2 * Math.PI), pois, random);
  let best = null;
  for (let i = 0; i < 4; i++) {
    const r = P / (2 * Math.PI);
    const center = destPoint(start, theta, r);
    const n = P < 1800 ? 2 : P < 6000 ? 3 : 4;
    const used = new Set();
    const wps = [];
    for (let k = 1; k <= n; k++) {
      const anchor = destPoint(center, (theta + 180 + k * 360 / (n + 1)) % 360, r);
      const p = snap(anchor, pois, r * 0.8, used, [start, ...wps]);
      wps.push(p ? { lat: p.lat, lng: p.lng, poi: p } : anchor);
    }
    // places the user insists on replace the waypoint closest to them
    for (const m of must) {
      if (wps.some(w => w.poi?.id === m.id)) continue;
      let bi = 0, bd = Infinity;
      wps.forEach((w, i) => { const d = dist(w, m); if (d < bd && !must.some(x => x.id === w.poi?.id)) { bd = d; bi = i; } });
      wps[bi] = { lat: m.lat, lng: m.lng, poi: m };
    }
    let route;
    try { route = await getRoute([start, ...wps, start], mode); }
    catch (e) { if (best) break; throw e; }
    const mins = routeMinutes(route, mode);
    const cand = { route, minutes: mins, waypoints: wps };
    if (!best || Math.abs(mins - minutes) < Math.abs(best.minutes - minutes)) best = cand;
    if (Math.abs(mins / minutes - 1) < 0.12) break;
    P *= Math.pow(minutes / mins, 0.95);
  }
  return best;
}

export async function planAB({ start, end, minutes, mode, pois, must = [], attempt = 0, stopMin = 15 }) {
  const random = rnd(attempt + 7);
  const direct = await getRoute([start, end], mode);
  const directMin = routeMinutes(direct, mode);
  if (minutes <= directMin * 1.1 && !must.length) {
    return { route: direct, minutes: directMin, waypoints: [], directMin, tooShort: minutes < directMin * 0.97 };
  }
  const straight = dist(start, end);
  // geometric budget: the straight line may grow by as much as the time does
  // on a drive every stop also costs time on site, so plan fewer stops and less detour
  const stopEach = mode === 'car' ? stopMin : 0;
  const maxStops = Math.max(1, Math.min(3, Math.floor((minutes - directMin) / (stopEach + 10))));
  let G = straight * Math.max(1.05, (minutes - (mode === 'car' ? maxStops * stopEach : 0)) / directMin * 0.97);
  // candidates inside ellipse
  const edge = mode === 'car' ? Math.min(2000, straight / 5) : 80; // a stop right at start or destination is no stop
  let best = null;
  for (let iter = 0; iter < 4; iter++) {
    const cands = pois
      .filter(p => dist(start, p) + dist(p, end) <= G && dist(start, p) > edge && dist(end, p) > edge)
      .map(p => ({ p, v: p.weight * (0.75 + random() * 0.5) }))
      .sort((a, b) => b.v - a.v);
    const brg = bearing(start, end);
    const t = p => dist(start, p) * Math.cos((bearing(start, p) - brg) * Math.PI / 180);
    let wps = [...must].sort((a, b) => t(a) - t(b));
    const maxW = Math.max(must.length, mode === 'car' ? maxStops : G > 8000 ? 5 : 4);
    for (const { p } of cands) {
      if (wps.length >= maxW) break;
      if (wps.some(w => dist(w, p) < 150)) continue;
      const next = [...wps, p].sort((a, b) => t(a) - t(b));
      if (pathLength([start, ...next, end]) <= G) wps = next;
    }
    // not enough interesting places to fill the time? stretch the longest leg with a detour
    for (let k = 0; k < 2; k++) {
      const all = [start, ...wps, end];
      const deficit = G - pathLength(all);
      if (deficit < G * 0.15) break;
      let li = 0, L = 0;
      for (let i = 1; i < all.length; i++) { const d = dist(all[i - 1], all[i]); if (d > L) { L = d; li = i; } }
      const h = Math.sqrt(((L + deficit / (2 - k)) / 2) ** 2 - (L / 2) ** 2);
      const a = all[li - 1], b = all[li];
      const mid = { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 };
      const side = random() < 0.5 ? 90 : -90;
      const anchor = destPoint(mid, (bearing(a, b) + side + 360) % 360, h);
      const p = snap(anchor, pois, Math.max(250, h * 0.35), new Set(wps.map(w => w.id)), [start, end]);
      if (!p && mode === 'car') break; // never send a driver to a random spot
      wps.splice(li - 1, 0, p || { ...anchor, id: 'anchor' + k });
    }
    let route;
    try { route = await getRoute([start, ...wps, end], mode); }
    catch (e) { if (best) break; throw e; }
    const stopMinutes = wps.filter(p => p.name).length * stopEach;
    const mins = routeMinutes(route, mode) + stopMinutes;
    const cand = { route, minutes: mins, stopMinutes, waypoints: wps.map(p => ({ lat: p.lat, lng: p.lng, poi: p.name ? p : null })), directMin };
    if (!best || Math.abs(mins - minutes) < Math.abs(best.minutes - minutes)) best = cand;
    if (Math.abs(mins / minutes - 1) < 0.13) break;
    G = Math.max(straight * 1.02, G * Math.pow(Math.max(directMin, minutes - stopMinutes) / Math.max(1, mins - stopMinutes), 0.9));
  }
  return best;
}

/** Places along the route, ordered by position and spread evenly over its length */
export function poisAlong(route, pois, mode, waypoints = []) {
  const pts = route.coords, cum = cumulative(pts);
  const near = MODES[mode].near;
  const wpIds = new Set(waypoints.filter(w => w.poi).map(w => w.poi.id));
  const all = [];
  for (const p of pois) {
    const isWp = wpIds.has(p.id);
    if (mode === 'car' && !isWp && p.score < 8) continue; // while driving only real highlights matter
    const pr = projectOnLine(p, pts, cum);
    // parks/large areas and real highlights are allowed further away
    const lim = near * (p.type === 'Park' || p.type === 'Gewässer' ? 3 : 1) * (p.score >= 7 ? 1.6 : 1);
    if (isWp || pr.off <= lim) all.push({ poi: p, along: pr.along, off: pr.off, wp: isWp });
    else if (pr.off <= lim * 3.5 && p.score >= 5) all.push({ poi: p, along: pr.along, off: pr.off, aside: true });
  }
  // one slot per stretch of route, so discoveries don't pile up in one corner
  const cap = Math.min(30, Math.max(6, Math.round(route.distance / 250)));
  if (mode === 'car') return driveStops(all, route);
  const segLen = route.distance / cap;
  const rank = o => o.poi.weight * (o.aside ? 0.45 : 1) + (o.wp ? 1000 : 0);
  const buckets = new Map();
  for (const o of all) {
    const b = Math.min(cap - 1, Math.floor(o.along / segLen));
    if (!buckets.has(b)) buckets.set(b, []);
    buckets.get(b).push(o);
  }
  const res = [];
  const spare = [];
  for (const list of buckets.values()) {
    list.sort((x, y) => rank(y) - rank(x));
    res.push(list[0]);
    for (const o of list.slice(1)) {
      if (o.wp) res.push(o);
      else if (!o.aside && dist(o.poi, list[0].poi) > 60) spare.push(o);
    }
  }
  // fill what is left with the next best ones, at most one extra per stretch
  spare.sort((x, y) => rank(y) - rank(x));
  const extraIn = new Set();
  for (const o of spare) {
    if (res.length >= cap) break;
    const b = Math.floor(o.along / segLen);
    if (extraIn.has(b)) continue;
    extraIn.add(b); res.push(o);
  }
  return res.sort((x, y) => x.along - y.along);
}

/** Drives: the planned stops plus a handful of well-known places close to the road */
function driveStops(all, route) {
  const cap = Math.min(12, Math.max(4, Math.round(route.distance / 12000)));
  const res = all.filter(o => o.wp);
  const start = route.coords[0];
  for (const o of all.filter(o => !o.wp && dist(start, o.poi) > 3000).sort((x, y) => y.poi.weight - x.poi.weight)) {
    if (res.length >= cap) break;
    if (res.some(r => dist(r.poi, o.poi) < 1500)) continue;
    res.push(o);
  }
  return res.sort((x, y) => x.along - y.along);
}

/** share of the route that is new compared to past tracks (0..1) */
export function newShare(route, tracks) {
  if (!tracks.length) return 1;
  const grid = new Set();
  for (const t of tracks) for (const p of sampleLine(t.coords.map(([lat, lng]) => ({ lat, lng })), 30)) grid.add(cellKey(p));
  const samples = sampleLine(route.coords, 30);
  if (!samples.length) return 1;
  const seen = samples.filter(p => grid.has(cellKey(p))).length;
  return 1 - seen / samples.length;
}
