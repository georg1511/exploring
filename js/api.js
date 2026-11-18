// External services: OSRM routing (FOSSGIS), Overpass (OSM POIs), Wikipedia, Nominatim
import { dist } from './geo.js';

export const LANG = (navigator.language || 'de').slice(0, 2) === 'en' ? 'en' : 'de';

export const MODES = {
  walk: { label: 'Gehen', profile: 'foot', detour: 1.3, near: 45, icon: 'walk' },
  run:  { label: 'Laufen', profile: 'foot', detour: 1.3, near: 45, icon: 'run' },
  bike: { label: 'Rad', profile: 'bike', detour: 1.3, near: 70, icon: 'bike' },
  car:  { label: 'Auto', profile: 'car', detour: 1.4, near: 300, icon: 'car', kmh: 28 },
};

export const CATS = {
  kultur:      { label: 'Kultur', icon: 'columns' },
  natur:       { label: 'Natur', icon: 'tree' },
  kurios:      { label: 'Verrückt', icon: 'sparkles' },
  architektur: { label: 'Architektur', icon: 'church' },
  aussicht:    { label: 'Aussicht', icon: 'view' },
  genuss:      { label: 'Genuss', icon: 'cup' },
};

async function fetchJSON(url, opts = {}, timeout = 20000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } finally { clearTimeout(t); }
}

/* ---------------- Routing ---------------- */
const routeCache = new Map();
export async function getRoute(points, mode) {
  const profile = MODES[mode].profile;
  const coords = points.map(p => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(';');
  const key = profile + coords;
  if (routeCache.has(key)) return routeCache.get(key);
  const url = `https://routing.openstreetmap.de/routed-${profile}/route/v1/driving/${coords}?overview=full&geometries=geojson&continue_straight=false`;
  const data = await fetchJSON(url, {}, 25000);
  if (data.code !== 'Ok' || !data.routes?.length) throw new Error('Keine Route gefunden');
  const r = data.routes[0];
  const out = {
    coords: r.geometry.coordinates.map(([lng, lat]) => ({ lat, lng })),
    distance: r.distance,
    duration: r.duration,
  };
  routeCache.set(key, out);
  return out;
}

/* ---------------- POI classification ---------------- */
const T = (cats, icon, type, score) => ({ cats, icon, type, score });
function classify(t) {
  const art = t.artwork_type || '';
  if (t.tourism === 'museum') return T(['kultur'], 'columns', 'Museum', 6);
  if (t.tourism === 'gallery') return T(['kultur'], 'art', 'Galerie', 4);
  if (t.amenity === 'theatre') return T(['kultur'], 'ticket', 'Theater', 5);
  if (t.amenity === 'arts_centre') return T(['kultur'], 'art', 'Kulturzentrum', 4);
  if (t.tourism === 'viewpoint') return T(['aussicht', 'natur'], 'view', 'Aussichtspunkt', 6);
  if (t.man_made === 'tower' && t['tower:type'] === 'observation') return T(['aussicht', 'architektur'], 'tower', 'Aussichtsturm', 7);
  if (t.historic === 'castle' || t.building === 'castle') return T(['architektur', 'kultur'], 'castle', t.castle_type === 'palace' ? 'Schloss' : 'Burg & Schloss', 8);
  if (t.historic === 'city_gate') return T(['architektur', 'kultur'], 'castle', 'Stadttor', 6);
  if (t.historic === 'fort') return T(['architektur', 'kultur'], 'castle', 'Festung', 6);
  if (t.historic === 'ruins') return T(['architektur', 'kurios'], 'castle', 'Ruine', 5);
  if (t.historic === 'tower') return T(['architektur'], 'tower', 'Historischer Turm', 5);
  if (t.building === 'cathedral') return T(['architektur', 'kultur'], 'church', 'Kathedrale', 7);
  if (t.building === 'mosque' || t.religion === 'muslim') return T(['architektur'], 'church', 'Moschee', 4);
  if (t.building === 'synagogue' || t.religion === 'jewish') return T(['architektur', 'kultur'], 'church', 'Synagoge', 5);
  if (t.building === 'temple') return T(['architektur'], 'church', 'Tempel', 5);
  if (['church', 'chapel'].includes(t.building) || t.amenity === 'place_of_worship') return T(['architektur'], 'church', t.building === 'chapel' ? 'Kapelle' : 'Kirche', 4);
  if (t.historic === 'monument') return T(['kultur'], 'statue', 'Denkmal', 5);
  if (t.historic === 'memorial') return T(['kultur'], 'statue', 'Gedenkort', 3);
  if (t.historic === 'manor') return T(['architektur'], 'columns', 'Herrenhaus', 5);
  if (t.historic === 'building') return T(['architektur'], 'columns', 'Historisches Gebäude', 3);
  if (t.tourism === 'artwork') {
    if (/mural|graffiti/.test(art)) return T(['kurios', 'kultur'], 'art', 'Street Art', 5);
    if (/sculpture|statue/.test(art)) return T(['kurios', 'kultur'], 'statue', art === 'statue' ? 'Statue' : 'Skulptur', 4);
    if (/installation/.test(art)) return T(['kurios', 'kultur'], 'sparkles', 'Installation', 5);
    return T(['kurios', 'kultur'], 'art', 'Kunstwerk', 3);
  }
  if (t.amenity === 'public_bookcase') return T(['kurios'], 'book', 'Bücherschrank', 4);
  if (t.amenity === 'fountain') return T(['kurios', 'architektur'], 'fountain', 'Brunnen', 3);
  if (t.amenity === 'clock') return T(['kurios'], 'clock', 'Uhr', 2);
  if (['cannon', 'aircraft', 'locomotive', 'tank', 'ship', 'railway_car'].includes(t.historic)) return T(['kurios'], 'sparkles', 'Kuriosum', 5);
  if (['boundary_stone', 'milestone'].includes(t.historic)) return T(['kurios'], 'statue', t.historic === 'milestone' ? 'Meilenstein' : 'Grenzstein', 2);
  if (t.historic === 'wayside_shrine' || t.historic === 'wayside_cross') return T(['kurios'], 'church', 'Wegkreuz', 2);
  if (t.man_made === 'obelisk') return T(['kurios', 'architektur'], 'tower', 'Obelisk', 4);
  if (t.man_made === 'lighthouse') return T(['kurios', 'aussicht'], 'tower', 'Leuchtturm', 6);
  if (t.man_made === 'windmill') return T(['kurios', 'architektur'], 'sparkles', 'Windmühle', 5);
  if (t.man_made === 'bridge') return T(['architektur'], 'bridge', 'Brücke', 4);
  if (t.tourism === 'attraction') return T(['kurios', 'kultur'], 'star', 'Sehenswürdigkeit', 6);
  if (t.natural === 'peak') return T(['natur', 'aussicht'], 'mountain', 'Gipfel', 5);
  if (t.natural === 'beach') return T(['natur'], 'waves', 'Strand', 5);
  if (t.natural === 'cave_entrance') return T(['natur', 'kurios'], 'mountain', 'Höhle', 5);
  if (t.natural === 'tree') return T(['natur', 'kurios'], 'tree', 'Besonderer Baum', 4);
  if (t.natural === 'water') return T(['natur'], 'waves', 'Gewässer', 4);
  if (t.waterway === 'waterfall') return T(['natur'], 'waves', 'Wasserfall', 6);
  if (t.leisure === 'nature_reserve') return T(['natur'], 'leaf', 'Naturschutzgebiet', 5);
  if (t.leisure === 'garden') return T(['natur'], 'leaf', 'Garten', 4);
  if (t.leisure === 'park') return T(['natur'], 'tree', 'Park', 4);
  if (t.amenity === 'ice_cream') return T(['genuss'], 'cup', 'Eisdiele', 3);
  if (t.amenity === 'biergarten') return T(['genuss'], 'cup', 'Biergarten', 4);
  if (t.shop === 'chocolate') return T(['genuss'], 'bag', 'Schokolade', 3);
  if (t.shop === 'confectionery') return T(['genuss'], 'bag', 'Süßes', 2);
  if (t.amenity === 'marketplace') return T(['genuss', 'kultur'], 'bag', 'Markt', 4);
  if (t.amenity === 'cafe') return T(['genuss'], 'cup', 'Café', 2);
  return null;
}

const Q = {
  kultur: [
    'nwr["tourism"~"^(museum|gallery|artwork)$"]',
    'nwr["amenity"~"^(theatre|arts_centre)$"]',
    'nwr["historic"~"^(monument|memorial)$"]["name"]',
    'nwr["tourism"="attraction"]',
  ],
  natur: [
    'nwr["leisure"~"^(park|garden|nature_reserve)$"]["name"]',
    'nwr["natural"~"^(peak|beach|cave_entrance)$"]',
    'nwr["natural"="tree"]["name"]',
    'nwr["natural"="water"]["name"]',
    'nwr["waterway"="waterfall"]',
    'nwr["tourism"="viewpoint"]',
  ],
  kurios: [
    'nwr["tourism"="artwork"]',
    'nwr["amenity"~"^(public_bookcase|fountain|clock)$"]',
    'nwr["tourism"="attraction"]',
    'nwr["historic"~"^(boundary_stone|milestone|cannon|aircraft|locomotive|tank|ship|railway_car|ruins)$"]',
    'nwr["man_made"~"^(obelisk|lighthouse|windmill)$"]',
    'nwr["natural"~"^(tree|cave_entrance)$"]["name"]',
  ],
  architektur: [
    'nwr["building"~"^(church|cathedral|chapel|mosque|synagogue|temple|castle)$"]["name"]',
    'nwr["amenity"="place_of_worship"]["name"]["wikidata"]',
    'nwr["historic"~"^(castle|city_gate|ruins|manor|fort|tower|building)$"]',
    'nwr["man_made"="bridge"]["name"]',
    'nwr["amenity"="fountain"]["name"]',
  ],
  aussicht: [
    'nwr["tourism"="viewpoint"]',
    'nwr["man_made"="tower"]["tower:type"="observation"]',
    'nwr["natural"="peak"]',
    'nwr["man_made"="lighthouse"]',
  ],
  genuss: [
    'nwr["amenity"~"^(ice_cream|biergarten|marketplace)$"]',
    'nwr["shop"~"^(chocolate|confectionery)$"]',
    'nwr["amenity"="cafe"]["wikidata"]',
    'nwr["amenity"="cafe"]["outdoor_seating"="yes"]["name"]',
  ],
};

const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];

// Only places worth a stop – used for long drives, where "everything" would be far too much
const HIGHLIGHTS = [
  'nwr["tourism"~"^(attraction|viewpoint|museum)$"]["wikidata"]',
  'nwr["historic"~"^(castle|ruins|fort|monument|city_gate|manor)$"]["wikidata"]',
  'nwr["waterway"="waterfall"]',
  'nwr["natural"~"^(cave_entrance|beach)$"]["name"]',
  'nwr["natural"="water"]["wikidata"]["name"]',
  'nwr["man_made"~"^(lighthouse|windmill)$"]',
  'nwr["man_made"="tower"]["tower:type"="observation"]',
  'nwr["leisure"="nature_reserve"]["wikidata"]',
  'nwr["amenity"="biergarten"]',
];

/** points: one point = circle, several = corridor along that line */
async function overpass(points, radius, interests, highlights) {
  const stmts = highlights ? HIGHLIGHTS : [...new Set(interests.flatMap(i => Q[i]))];
  const around = `(around:${Math.round(radius)},${points.map(p => p.lat.toFixed(5) + ',' + p.lng.toFixed(5)).join(',')})`;
  const q = `[out:json][timeout:25];(${stmts.map(s => s + around + ';').join('')});out center tags 900;`;
  // race all mirrors; whichever answers first wins. Short timeout – Wikipedia is the fallback.
  const data = await Promise.any(OVERPASS.map(ep =>
    fetchJSON(ep, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }, highlights ? 15000 : 11000)));
  return data.elements || [];
}

const DRIVE_SKIP = /(bach|fluss|burgstall|turmhügel|abgegangen|ringwall|wallburg|kapelle|friedhof|filialkirche|pfarrkirche)/i;
const WIKI_SKIP = /(stra(ß|ss)e in|straße|allee in|bahnhof|haltestelle|station|stadtteil|ortsteil|stadtbezirk|bezirk|unternehmen|firma|schule|gymnasium|hochschule|universität|krankenhaus|klinik|wahlkreis|gemeinde|stadt in|hotel|bank|behörde|ministerium|verband|verein|botschaft|street|district|neighbourhood|company|school|railway|metro|subway|bus|tram|airport|flughafen|wohnsiedlung|bürogebäude|kaufhaus|einkaufszentrum|autobahn|anschlussstelle|bundesstraße|tunnel|kraftwerk|kaserne|landkreis|markt in|marktgemeinde|dorf in|ort in|ortschaft|gemeindefrei|gefängnis|justizvollzug|festival|campus|bahnstrecke|schmalspurbahn|rundfunk|sender|sendeanlage|sendeturm|hauptstadt|großstadt|kreisstadt|stadt im|kreisfreie)/i;

function classifyWiki(title, desc = '') {
  const s = (title + ' ' + desc).toLowerCase();
  if (/(museum|galerie|theater|oper|denkmal|gedenk|bibliothek|konzerthaus|philharmonie|monument|memorial|kunst)/.test(s)) return T(['kultur'], 'columns', 'Kultur', 5);
  if (/(dom|kathedrale|kirche|kapelle|münster|basilika|moschee|synagoge|kloster|abtei|cathedral|church)/.test(s)) return T(['architektur', 'kultur'], 'church', 'Kirche', 5);
  if (/(schloss|burg|palast|palais|festung|castle|palace)/.test(s)) return T(['architektur', 'kultur'], 'castle', 'Schloss', 7);
  if (/(turm|tower|tor|gate|brücke|bridge|rathaus|halle|villa|haus)/.test(s)) return T(['architektur'], 'columns', 'Bauwerk', 4);
  if (/(park|garten|see|teich|fluss|wald|insel|berg|hügel|lake|river|garden)/.test(s)) return T(['natur'], 'tree', 'Natur', 4);
  if (/(brunnen|skulptur|plastik|statue|fountain|sculpture)/.test(s)) return T(['kurios', 'kultur'], 'fountain', 'Kunst im Raum', 4);
  if (/(platz|square|markt)/.test(s)) return T(['kultur', 'architektur'], 'pin', 'Platz', 3);
  return T(['kultur', 'kurios'], 'book', 'Geschichte', 3);
}

async function wikiNearby(center, radius, lang = LANG, limit = 100) {
  const r = Math.max(10, Math.min(10000, Math.round(radius)));
  const url = `https://${lang}.wikipedia.org/w/api.php?action=query&format=json&origin=*&generator=geosearch&ggscoord=${center.lat}|${center.lng}&ggsradius=${r}&ggslimit=${limit}&prop=coordinates|pageimages|description&piprop=thumbnail&pithumbsize=480&pilimit=50&colimit=${limit}`;
  const data = await fetchJSON(url, {}, 15000);
  const pages = Object.values(data?.query?.pages || {});
  return pages.filter(p => p.coordinates?.[0]).map(p => ({ ...p, lang }));
}

/** Places around a point ranked by how well-known they are (not by distance) */
async function wikiNotable(center, radius, lang = LANG, limit = 40) {
  const km = Math.max(1, Math.min(10, Math.round(radius / 1000)));
  const url = `https://${lang}.wikipedia.org/w/api.php?action=query&format=json&origin=*&generator=search&gsrnamespace=0&gsrsearch=${encodeURIComponent(`nearcoord:${km}km,${center.lat.toFixed(4)},${center.lng.toFixed(4)}`)}&gsrlimit=${limit}&prop=coordinates|pageimages|description&piprop=thumbnail&pithumbsize=480&pilimit=50&colimit=50`;
  const data = await fetchJSON(url, {}, 15000);
  const pages = Object.values(data?.query?.pages || {});
  return pages.filter(p => p.coordinates?.[0]).map(p => ({ ...p, lang, notable: p.index }));
}

/** Wikipedia only returns the places nearest to a point – so ask at several points and merge */
async function wikiMulti(points, radius, lang = LANG, highlights = false) {
  const limit = points.length > 1 ? 60 : 150;
  const jobs = highlights
    ? points.map(p => wikiNotable(p, radius, lang, 30))                       // drives: only what is well-known
    : [...points.map(p => wikiNearby(p, radius, lang, limit)),                // on foot: everything nearby …
       wikiNotable(points[0], Math.max(radius, 2000), lang, 40)];             // … plus the big sights, to rank them up
  const res = await Promise.allSettled(jobs);
  if (res.every(r => r.status !== 'fulfilled')) throw new Error('wiki');
  const seen = new Map();
  for (const r of res) if (r.status === 'fulfilled') for (const p of r.value) {
    const old = seen.get(p.pageid);
    if (!old) seen.set(p.pageid, p);
    else if (p.notable != null) old.notable = Math.min(old.notable ?? 99, p.notable);
  }
  return [...seen.values()];
}

const norm = s => (s || '').toLowerCase().replace(/[^a-z0-9äöüß]/g, '');

/**
 * Load & merge POIs for an area:
 * { points, radius }          → OSM search (circle or corridor)
 * { wikiPoints, wikiRadius }  → Wikipedia sample points
 * { highlights }              → only places worth a stop (long drives)
 */
const poiCache = new Map();
export async function loadPOIs(area, interests) {
  const ints = interests.length ? [...interests] : Object.keys(CATS);
  const { points, radius, wikiPoints = points, wikiRadius = radius, highlights = false } = area;
  const key = [...points, ...wikiPoints].map(p => p.lat.toFixed(3) + ',' + p.lng.toFixed(3)).join(';') + `|${Math.round(radius / 250)}|${highlights}|${ints.sort().join()}`;
  if (poiCache.has(key)) return poiCache.get(key);

  const [osmRes, wikiRes] = await Promise.allSettled([
    overpass(points, Math.min(radius, 9000), ints, highlights),
    wikiMulti(wikiPoints, wikiRadius, LANG, highlights),
  ]);
  const osm = osmRes.status === 'fulfilled' ? osmRes.value : [];
  let wiki = wikiRes.status === 'fulfilled' ? wikiRes.value : [];
  if (wiki.length < 12 && LANG !== 'en') {
    try { wiki = wiki.concat(await wikiMulti(wikiPoints, wikiRadius, 'en', highlights)); } catch {}
  }
  if (!osm.length && !wiki.length) throw new Error('Keine Orte geladen – bitte Internetverbindung prüfen.');
  const partial = osmRes.status !== 'fulfilled';

  const pois = [];
  for (const el of osm) {
    const t = el.tags || {};
    const c = classify(t);
    if (!c) continue;
    const lat = el.lat ?? el.center?.lat, lng = el.lon ?? el.center?.lon;
    if (lat == null) continue;
    let score = c.score + (t.name ? 1 : -1) + (t.wikipedia || t.wikidata ? 3 : 0);
    if (!t.name && c.score < 4) score -= 1;
    let wikiTitle = null, wikiLang = null;
    if (t.wikipedia) { const [l, ...rest] = t.wikipedia.split(':'); if (rest.length) { wikiLang = l; wikiTitle = rest.join(':'); } }
    pois.push({
      id: el.type[0] + el.id, lat, lng, name: t.name || t['name:' + LANG] || c.type,
      named: !!t.name, type: c.type, icon: c.icon, cats: c.cats, score,
      tags: t, wikiTitle, wikiLang, wikidata: t.wikidata || null, thumb: null,
    });
  }
  // merge wiki articles
  for (const w of wiki) {
    if (WIKI_SKIP.test(w.description || '') || WIKI_SKIP.test(w.title)) continue;
    if (highlights && (!w.thumbnail || DRIVE_SKIP.test(w.title + ' ' + (w.description || '')))) continue; // drives: only what is worth a stop
    const fame = w.notable == null ? 0 : w.notable <= 8 ? 4 : w.notable <= 20 ? 2 : 1;
    const pos = { lat: w.coordinates[0].lat, lng: w.coordinates[0].lon };
    const nt = norm(w.title);
    const match = pois.find(p =>
      (p.wikiTitle && norm(p.wikiTitle) === nt) ||
      (p.named && dist(p, pos) < 250 && (norm(p.name) === nt || (norm(p.name).length > 5 && nt.includes(norm(p.name))))));
    if (match) {
      match.wikiTitle = match.wikiTitle || w.title; match.wikiLang = match.wikiLang || w.lang;
      match.thumb = w.thumbnail?.source || match.thumb; match.desc = w.description; match.score += 2 + fame;
      continue;
    }
    const c = classifyWiki(w.title, w.description);
    pois.push({
      id: 'w' + w.lang + w.pageid, ...pos, name: w.title.replace(/\s*\([^)]*\)$/, ''), named: true, type: w.description ? capitalize(w.description) : c.type,
      icon: c.icon, cats: c.cats, score: c.score + (w.thumbnail ? 1 : 0) + 1 + fame,
      tags: {}, wikiTitle: w.title, wikiLang: w.lang, thumb: w.thumbnail?.source || null, desc: w.description,
    });
  }
  // dedupe same name nearby
  pois.sort((a, b) => b.score - a.score);
  const out = [];
  for (const p of pois) {
    if (p.named && out.some(q => q.named && norm(q.name) === norm(p.name) && dist(p, q) < 150)) continue;
    out.push(p);
  }
  // interest weighting
  for (const p of out) p.weight = p.score * (p.cats.some(c => ints.includes(c)) ? 1.6 : 0.6);
  poiCache.set(key, out);
  if (partial) setTimeout(() => poiCache.delete(key), 120000); // try OSM again later
  return out;
}

const capitalize = s => s.charAt(0).toUpperCase() + s.slice(1);

/* ---------------- POI stories ---------------- */
const storyCache = new Map();
export async function getStory(poi) {
  if (storyCache.has(poi.id)) return storyCache.get(poi.id);
  let title = poi.wikiTitle, lang = poi.wikiLang || LANG;
  if (!title && poi.wikidata) {
    try {
      const d = await fetchJSON(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${poi.wikidata}&props=sitelinks&sitefilter=${LANG}wiki|enwiki&format=json&origin=*`);
      const sl = d.entities?.[poi.wikidata]?.sitelinks || {};
      const s = sl[LANG + 'wiki'] || sl.enwiki;
      if (s) { title = s.title; lang = s.site.slice(0, 2); }
    } catch {}
  }
  let story = null;
  if (title) {
    try {
      const s = await fetchJSON(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`);
      if (s.extract) story = { text: s.extract, thumb: s.thumbnail?.source || s.originalimage?.source || poi.thumb, url: s.content_urls?.mobile?.page || s.content_urls?.desktop?.page, source: 'Wikipedia' };
    } catch {}
  }
  if (!story) story = { text: fallbackStory(poi), thumb: poi.thumb, url: null, source: null };
  storyCache.set(poi.id, story);
  return story;
}

function fallbackStory(p) {
  const t = p.tags || {};
  const bits = [];
  const intro = {
    'Bücherschrank': 'Ein offener Bücherschrank – nimm ein Buch mit, stell eins rein. Perfekt, um kurz zu stöbern und zu sehen, was die Nachbarschaft so liest.',
    'Street Art': 'Street Art! Wände wie diese erzählen, wer in einem Viertel lebt und was die Leute bewegt. Bleib kurz stehen und entdecke die Details.',
    'Brunnen': 'Ein Brunnen – früher Treffpunkt und Lebensader jedes Viertels. Hör kurz hin, wie das Wasser plätschert.',
    'Uhr': 'Eine öffentliche Uhr. Bevor jeder eine Uhr in der Tasche hatte, waren solche Uhren der Taktgeber der Stadt.',
    'Aussichtspunkt': 'Ein Aussichtspunkt – Zeit für einen Moment Pause und einen Blick über die Gegend. Am Abend oft besonders schön!',
    'Park': 'Ein Park – grüne Lunge der Stadt. Gute Gelegenheit, das Tempo kurz rauszunehmen und durchzuatmen.',
    'Besonderer Baum': 'Ein Baum, der einen eigenen Namen trägt. Solche Bäume sind oft Jahrhunderte alt und haben viel gesehen.',
    'Grenzstein': 'Ein alter Grenzstein. Er markierte einst, wo ein Gebiet endete und das nächste begann – ein stiller Zeitzeuge.',
    'Eisdiele': 'Eine Eisdiele. Belohnung nach dem Lauf? Wir sagen nichts.',
    'Biergarten': 'Ein Biergarten – vielleicht der perfekte Abschluss deiner Runde.',
    'Kuriosum': 'Ein echtes Kuriosum mitten in der Stadt. Halt kurz an – so etwas sieht man nicht jeden Tag.',
    'Skulptur': 'Kunst im öffentlichen Raum. Jede Skulptur hat eine Geschichte – wer sie geschaffen hat, steht oft auf einer kleinen Tafel.',
  }[p.type];
  bits.push(intro || `${p.named ? p.name + ' – ' : ''}${p.type}${p.desc ? ', ' + p.desc : ''}. Ein Ort, der einen kurzen Stopp lohnt.`);
  if (t.artist_name) bits.push(`Geschaffen von ${t.artist_name}.`);
  if (t.start_date) bits.push(`Entstanden ${/^\d{4}/.test(t.start_date) ? 'im Jahr ' + t.start_date.slice(0, 4) : t.start_date}.`);
  if (t.inscription) bits.push(`Inschrift: „${t.inscription}“`);
  if (t.description) bits.push(t.description);
  if (t.opening_hours && p.cats.includes('genuss')) bits.push(`Öffnungszeiten: ${t.opening_hours}`);
  return bits.join(' ');
}

/* ---------------- Geocoding ---------------- */
export async function geocode(q, near) {
  const base = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&accept-language=${LANG}&q=${encodeURIComponent(q)}`;
  // ask globally and nearby, then rank: well-known places first, with a bonus for being close
  const reqs = [fetchJSON(base, {}, 10000)];
  if (near) reqs.push(fetchJSON(base + `&bounded=1&viewbox=${near.lng - .4},${near.lat + .3},${near.lng + .4},${near.lat - .3}`, {}, 10000));
  const res = (await Promise.allSettled(reqs)).flatMap(r => r.status === 'fulfilled' ? r.value : []);
  const seen = new Set();
  return res
    .filter(r => !seen.has(r.place_id) && seen.add(r.place_id))
    .map(r => {
      const p = { lat: +r.lat, lng: +r.lon };
      const local = near && dist(near, p) < 40000 ? 0.25 : 0;
      return { ...p, name: r.name || r.display_name.split(',')[0], detail: r.display_name.split(',').slice(1, 4).join(',').trim(), rank: (r.importance || 0) + local };
    })
    .sort((x, y) => y.rank - x.rank).slice(0, 6);
}

export async function reverse(p) {
  try {
    const d = await fetchJSON(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=16&accept-language=${LANG}&lat=${p.lat}&lon=${p.lng}`, {}, 8000);
    const a = d.address || {};
    return { city: a.city || a.town || a.village || a.municipality || a.county || '', area: a.suburb || a.city_district || a.neighbourhood || a.quarter || '', label: d.name || [a.road, a.house_number].filter(Boolean).join(' ') };
  } catch { return { city: '', area: '', label: '' }; }
}
