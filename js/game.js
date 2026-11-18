// Gamification: XP, levels, badges and weekly challenges – all derived from saved activities
import { weekStart, weekly, streakWeeks } from './sport.js';

const XP = { km: 10, carKm: 1, place: 15, activity: 20 };
export const placeXp = XP.place;
export function trackXp(t) {
  const km = t.distance / 1000;
  return Math.round(km * (t.mode === 'car' ? XP.carKm : XP.km) + (t.visited?.length || 0) * XP.place + XP.activity);
}
/** what a planned route can bring */
export const routeXp = (meters, mode, newPlaces) => Math.round(meters / 1000 * (mode === 'car' ? XP.carKm : XP.km) + newPlaces * XP.place + XP.activity);

const TITLES = ['Neuling', 'Spaziergänger', 'Stadtbummler', 'Entdecker', 'Pfadfinder', 'Kundschafter', 'Abenteurer', 'Weltenbummler', 'Pionier', 'Legende'];
const need = level => Math.round(60 * Math.pow(level - 1, 1.7)); // XP needed to reach a level

const BADGES = [
  { id: 'first', icon: 'flag', name: 'Erster Schritt', desc: 'Erste Aktivität aufgezeichnet', target: 1, val: s => s.activities },
  { id: 'places5', icon: 'pin', name: 'Neugierig', desc: '5 Orte entdeckt', target: 5, val: s => s.places },
  { id: 'places25', icon: 'pin', name: 'Spürnase', desc: '25 Orte entdeckt', target: 25, val: s => s.places },
  { id: 'places100', icon: 'star', name: 'Stadtkenner', desc: '100 Orte entdeckt', target: 100, val: s => s.places },
  { id: 'km10', icon: 'run', name: 'Unterwegs', desc: '10 km aus eigener Kraft', target: 10, val: s => s.km },
  { id: 'km50', icon: 'run', name: 'Weit gekommen', desc: '50 km aus eigener Kraft', target: 50, val: s => s.km },
  { id: 'km200', icon: 'bolt', name: 'Fernweh', desc: '200 km aus eigener Kraft', target: 200, val: s => s.km },
  { id: 'cities3', icon: 'compass', name: 'Städtehopper', desc: '3 Städte erkundet', target: 3, val: s => s.cities },
  { id: 'cities10', icon: 'compass', name: 'Weltenbummler', desc: '10 Städte erkundet', target: 10, val: s => s.cities },
  { id: 'early', icon: 'sun', name: 'Frühaufsteher', desc: 'Vor 7 Uhr gestartet', target: 1, val: s => s.early },
  { id: 'night', icon: 'moon', name: 'Nachteule', desc: 'Nach 21 Uhr gestartet', target: 1, val: s => s.night },
  { id: 'streak3', icon: 'bolt', name: 'Dranbleiber', desc: '3 Wochen in Folge aktiv', target: 3, val: s => s.streak },
  { id: 'goal', icon: 'trophy', name: 'Wochenziel', desc: 'Ein Wochenziel erreicht', target: 1, val: s => s.goalWeeks },
  { id: 'climb', icon: 'mountain', name: 'Gipfelstürmer', desc: '300 Höhenmeter gesammelt', target: 300, val: s => s.climb },
  { id: 'kultur', icon: 'columns', name: 'Kulturfan', desc: '10 Kultur-Orte entdeckt', target: 10, val: s => s.cats.kultur || 0 },
  { id: 'natur', icon: 'tree', name: 'Naturfreund', desc: '10 Natur-Orte entdeckt', target: 10, val: s => s.cats.natur || 0 },
  { id: 'kurios', icon: 'sparkles', name: 'Kuriositätenjäger', desc: '10 verrückte Orte entdeckt', target: 10, val: s => s.cats.kurios || 0 },
];

export function profile(tracks, visited, weeklyGoal) {
  const sport = tracks.filter(t => t.mode !== 'car');
  const places = Object.values(visited);
  const cats = {};
  for (const p of places) for (const c of p.cats || []) cats[c] = (cats[c] || 0) + 1;
  // weeks in which the goal was reached (goal as it is set today)
  const byWeek = {};
  for (const t of sport) byWeek[weekStart(t.date)] = (byWeek[weekStart(t.date)] || 0) + t.distance / 1000;
  const s = {
    activities: tracks.length,
    places: places.length,
    km: sport.reduce((a, t) => a + t.distance, 0) / 1000,
    cities: new Set(tracks.map(t => t.city).filter(Boolean)).size,
    early: tracks.filter(t => new Date(t.date).getHours() < 7).length,
    night: tracks.filter(t => new Date(t.date).getHours() >= 21).length,
    streak: streakWeeks(tracks),
    goalWeeks: Object.values(byWeek).filter(km => km >= weeklyGoal).length,
    climb: sport.reduce((a, t) => a + (t.ele?.gain ?? t.eleGain ?? 0), 0),
    cats,
  };
  const xp = tracks.reduce((a, t) => a + trackXp(t), 0);
  let level = 1;
  while (need(level + 1) <= xp) level++;
  const cur = need(level), next = need(level + 1);
  const badges = BADGES.map(b => {
    const v = b.val(s);
    return { id: b.id, icon: b.icon, name: b.name, desc: b.desc, done: v >= b.target, pct: Math.min(1, v / b.target), value: Math.floor(v), target: b.target };
  });

  const ws = weekStart(Date.now());
  const week = weekly(tracks, 1)[0];
  const challenges = [
    { icon: 'run', name: `${weeklyGoal} km diese Woche`, value: week.km, target: weeklyGoal, unit: 'km' },
    { icon: 'pin', name: '5 neue Orte entdecken', value: places.filter(p => p.at >= ws).length, target: 5, unit: '' },
    { icon: 'flag', name: '3 Aktivitäten', value: tracks.filter(t => t.date >= ws).length, target: 3, unit: '' },
  ];
  return { xp, level, title: TITLES[Math.min(level, TITLES.length) - 1], cur, next, pct: (xp - cur) / (next - cur), toNext: next - xp, badges, challenges, stats: s };
}

/** what changed between two profiles (before/after saving an activity) */
export function reward(before, after) {
  const had = new Set(before.badges.filter(b => b.done).map(b => b.id));
  return {
    xp: after.xp - before.xp,
    levelUp: after.level > before.level ? after : null,
    badges: after.badges.filter(b => b.done && !had.has(b.id)),
  };
}

/** progress ring as SVG */
export function ring(pct, size = 44, stroke = 4, label = '') {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  return `<svg class="ring" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">
    <circle class="ring-bg" cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-width="${stroke}"/>
    <circle class="ring-fg" cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-width="${stroke}" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - Math.max(0.02, Math.min(1, pct)))}" transform="rotate(-90 ${size / 2} ${size / 2})"/>
    ${label !== '' ? `<text x="50%" y="50%" dominant-baseline="central" text-anchor="middle">${label}</text>` : ''}</svg>`;
}
