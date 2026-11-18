const PREFIX = 'exploring.v1.';

export function load(key, fallback) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}

export function save(key, value) {
  try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); return true; }
  catch { return false; }
}

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

export const prefs = Object.assign(
  { mode: 'run', type: 'loop', minutes: 30, interests: ['kultur', 'kurios'], showTrails: true, weight: 75, weeklyGoal: 20, stopMin: 15, home: null, accent: 'coral', mapStyle: 'standard',
    pace: { walk: 12, run: 6, bike: 3.75 } },
  load('prefs', {})
);
export const savePrefs = () => save('prefs', prefs);

export const getTracks = () => load('tracks', []);
export const getRoutes = () => load('routes', []);
export const getVisited = () => load('visited', {});

export function addTrack(t) { const l = getTracks(); l.unshift(t); save('tracks', l); }
export function addRoute(r) { const l = getRoutes(); l.unshift(r); save('routes', l); }
export function updateTrack(id, patch) { save('tracks', getTracks().map(t => t.id === id ? { ...t, ...patch } : t)); }
export function removeTrack(id) { save('tracks', getTracks().filter(t => t.id !== id)); }
export function removeRoute(id) { save('routes', getRoutes().filter(t => t.id !== id)); }
export function markVisited(poi) {
  const v = getVisited();
  if (!v[poi.id]) { v[poi.id] = { name: poi.name, icon: poi.icon, cats: poi.cats, lat: poi.lat, lng: poi.lng, at: Date.now() }; save('visited', v); }
}
