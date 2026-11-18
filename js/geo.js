// Small geo helpers (lat/lng in degrees, distances in meters)
const R = 6371008.8;
const toRad = d => d * Math.PI / 180;
const toDeg = r => r * 180 / Math.PI;

export function dist(a, b) {
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function bearing(a, b) {
  const y = Math.sin(toRad(b.lng - a.lng)) * Math.cos(toRad(b.lat));
  const x = Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) - Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lng - a.lng));
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

export function destPoint(p, brgDeg, d) {
  const δ = d / R, θ = toRad(brgDeg), φ1 = toRad(p.lat), λ1 = toRad(p.lng);
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
  const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));
  return { lat: toDeg(φ2), lng: ((toDeg(λ2) + 540) % 360) - 180 };
}

export function pathLength(pts) {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += dist(pts[i - 1], pts[i]);
  return s;
}

/** cumulative distances along a polyline */
export function cumulative(pts) {
  const c = [0];
  for (let i = 1; i < pts.length; i++) c.push(c[i - 1] + dist(pts[i - 1], pts[i]));
  return c;
}

/**
 * Project point onto polyline. Returns {off: distance to line, along: meters from start, idx}
 * Uses local equirectangular projection — fine for city scale.
 */
export function projectOnLine(p, pts, cum, fromIdx = 0, toIdx = pts.length - 1) {
  const kx = Math.cos(toRad(p.lat)) * 111320, ky = 110540;
  let best = { off: Infinity, along: 0, idx: 0 };
  for (let i = Math.max(0, fromIdx); i < Math.min(toIdx, pts.length - 1); i++) {
    const ax = (pts[i].lng - p.lng) * kx, ay = (pts[i].lat - p.lat) * ky;
    const bx = (pts[i + 1].lng - p.lng) * kx, by = (pts[i + 1].lat - p.lat) * ky;
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 ? -(ax * dx + ay * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const x = ax + t * dx, y = ay + t * dy;
    const off = Math.hypot(x, y);
    if (off < best.off) best = { off, along: cum[i] + t * Math.sqrt(len2), idx: i };
  }
  return best;
}

/** keep points at least minGap meters apart */
export function thin(pts, minGap = 8) {
  if (pts.length < 3) return pts.slice();
  const out = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) if (dist(out[out.length - 1], pts[i]) >= minGap) out.push(pts[i]);
  out.push(pts[pts.length - 1]);
  return out;
}

/** points every `step` meters along polyline */
export function sampleLine(pts, step = 25) {
  const out = [];
  if (!pts.length) return out;
  out.push(pts[0]);
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const d = dist(a, b);
    let pos = step - carry;
    while (pos < d) {
      const t = pos / d;
      out.push({ lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t });
      pos += step;
    }
    carry = (carry + d) % step;
  }
  return out;
}

/** coarse grid key (~cell meters) */
export function cellKey(p, cell = 40) {
  const ky = cell / 110540, kx = cell / (111320 * Math.cos(toRad(p.lat)));
  return Math.floor(p.lat / ky) + ':' + Math.floor(p.lng / kx);
}
