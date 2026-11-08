#!/usr/bin/env node
/*
 * Sestaví soubor data/geo.js z dat Natural Earth (public domain).
 *
 * Použití:
 *   node tools/build-geo.js <adresář-s-geojson-soubory>
 *
 * Adresář musí obsahovat (z https://github.com/nvkelso/natural-earth-vector/tree/master/geojson):
 *   ne_10m_admin_0_countries.geojson
 *   ne_10m_admin_1_states_provinces.geojson
 *   ne_10m_rivers_lake_centerlines.geojson
 *   ne_10m_rivers_europe.geojson
 *   ne_10m_lakes_europe.geojson
 *
 * Menší řeky, které Natural Earth neobsahuje, jsou doplněny ručně
 * (přibližný průběh) v poli MANUAL_RIVERS níže.
 */
const fs = require('fs');
const path = require('path');

const dir = process.argv[2];
if (!dir) {
  console.error('Použití: node tools/build-geo.js <adresář>');
  process.exit(1);
}
const load = (f) => JSON.parse(fs.readFileSync(path.join(dir, f + '.geojson'), 'utf8'));

// Výřez mapy (lon/lat) – ČR s okolím
const BBOX = { minX: 11.9, maxX: 19.0, minY: 48.4, maxY: 51.2 };

// ---------- pomocné funkce ----------
const r4 = (n) => Math.round(n * 10000) / 10000;

function sqSegDist(p, a, b) {
  let x = a[0], y = a[1];
  let dx = b[0] - x, dy = b[1] - y;
  if (dx !== 0 || dy !== 0) {
    const t = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy);
    if (t > 1) { x = b[0]; y = b[1]; } else if (t > 0) { x += dx * t; y += dy * t; }
  }
  dx = p[0] - x; dy = p[1] - y;
  return dx * dx + dy * dy;
}
function simplify(points, tol) {
  if (points.length <= 2) return points;
  const sq = tol * tol;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop();
    let maxD = 0, idx = -1;
    for (let i = first + 1; i < last; i++) {
      const d = sqSegDist(points[i], points[first], points[last]);
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > sq) { keep[idx] = 1; stack.push([first, idx], [idx, last]); }
  }
  return points.filter((_, i) => keep[i]);
}
const clean = (ring, tol) => simplify(ring, tol).map(([x, y]) => [r4(x), r4(y)]);

function polys(geom) {
  if (geom.type === 'Polygon') return [geom.coordinates];
  if (geom.type === 'MultiPolygon') return geom.coordinates;
  return [];
}
function lines(geom) {
  if (geom.type === 'LineString') return [geom.coordinates];
  if (geom.type === 'MultiLineString') return geom.coordinates;
  return [];
}
const inBox = ([x, y], m = 0) =>
  x > BBOX.minX - m && x < BBOX.maxX + m && y > BBOX.minY - m && y < BBOX.maxY + m;

// Ořízne linii na úseky ležící ve (rozšířeném) výřezu
function clipLine(line, m = 0.3) {
  const out = [];
  let cur = [];
  for (const p of line) {
    if (inBox(p, m)) cur.push(p);
    else if (cur.length) { if (cur.length > 1) out.push(cur); cur = []; }
  }
  if (cur.length > 1) out.push(cur);
  return out;
}

// ---------- státy ----------
const countries = load('ne_10m_admin_0_countries');
const NEIGHBOURS = { DEU: 'Německo', POL: 'Polsko', AUT: 'Rakousko', SVK: 'Slovensko' };
let czBorder = null;
const neighbours = [];
for (const f of countries.features) {
  const code = f.properties.ADM0_A3;
  if (code === 'CZE') {
    czBorder = polys(f.geometry).map((p) => p.map((ring) => clean(ring, 0.004)));
  } else if (NEIGHBOURS[code]) {
    const ps = polys(f.geometry)
      .filter((p) => p[0].some((pt) => inBox(pt, 1.5)))
      .map((p) => [clean(p[0], 0.01)]);
    neighbours.push({ name: NEIGHBOURS[code], polygons: ps });
  }
}

// ---------- kraje ----------
const KRAJE = {
  'CZ-PR': 'Hlavní město Praha',
  'CZ-ST': 'Středočeský kraj',
  'CZ-JC': 'Jihočeský kraj',
  'CZ-PL': 'Plzeňský kraj',
  'CZ-KA': 'Karlovarský kraj',
  'CZ-US': 'Ústecký kraj',
  'CZ-LI': 'Liberecký kraj',
  'CZ-KR': 'Královéhradecký kraj',
  'CZ-PA': 'Pardubický kraj',
  'CZ-VY': 'Kraj Vysočina',
  'CZ-JM': 'Jihomoravský kraj',
  'CZ-OL': 'Olomoucký kraj',
  'CZ-ZL': 'Zlínský kraj',
  'CZ-MO': 'Moravskoslezský kraj',
};
const admin1 = load('ne_10m_admin_1_states_provinces');
const regions = [];
for (const f of admin1.features) {
  const p = f.properties;
  if (p.adm0_a3 !== 'CZE' || !KRAJE[p.iso_3166_2]) continue;
  regions.push({
    id: p.iso_3166_2,
    name: KRAJE[p.iso_3166_2],
    polygons: polys(f.geometry).map((poly) => poly.map((ring) => clean(ring, 0.004))),
  });
}

// ---------- přesné kraje ČÚZK (volitelné) ----------
// Soubor kraje.json z https://github.com/siwekm/czech-geojson (zdroj: ČÚZK, INSPIRE – Územní
// správní jednotky) uložte do stejného adresáře jako „cuzk-kraje.json“. Pokud existuje, nahradí
// zjednodušené kraje i státní hranici z Natural Earth.
const cuzkFile = path.join(dir, 'cuzk-kraje.json');
let boundarySource = 'Natural Earth';
if (fs.existsSync(cuzkFile)) {
  const cuzk = JSON.parse(fs.readFileSync(cuzkFile, 'utf8'));
  // Body jistě uvnitř jednotlivých krajů – podle nich se polygony (bez názvů) přiřadí ke krajům
  const INSIDE = {
    'CZ-PR': [14.45, 50.07], 'CZ-ST': [14.95, 49.93], 'CZ-JC': [14.4, 49.08], 'CZ-PL': [13.25, 49.55],
    'CZ-KA': [12.8, 50.2], 'CZ-US': [13.85, 50.5], 'CZ-LI': [14.9, 50.7], 'CZ-KR': [15.85, 50.35],
    'CZ-PA': [16.1, 49.9], 'CZ-VY': [15.6, 49.4], 'CZ-JM': [16.6, 49.03], 'CZ-OL': [17.15, 49.78],
    'CZ-ZL': [17.75, 49.2], 'CZ-MO': [18.1, 49.85],
  };
  const inRing = (pt, ring) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };
  const inPoly = (pt, poly) => inRing(pt, poly[0]) && !poly.slice(1).some((h) => inRing(pt, h));

  // 1) všechny prstence; u každého vrcholu zjistíme, kterým prstencům patří
  const rings = []; // { region, poly, idx, pts }
  for (const f of cuzk.features) {
    const ps = polys(f.geometry);
    const id = Object.keys(INSIDE).find((k) => ps.some((p) => inPoly(INSIDE[k], p)));
    if (!id) throw new Error('ČÚZK polygon nelze přiřadit ke kraji');
    ps.forEach((poly, pi) => poly.forEach((ring, ri) => {
      const pts = ring.slice();
      if (pts.length > 1 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) pts.pop();
      rings.push({ region: id, pi, ri, pts });
    }));
  }
  const key = (p) => p[0].toFixed(6) + ',' + p[1].toFixed(6);
  const owners = new Map();
  rings.forEach((r, i) => r.pts.forEach((p) => {
    const k = key(p);
    if (!owners.has(k)) owners.set(k, new Set());
    owners.get(k).add(i);
  }));
  const sig = (p) => [...owners.get(key(p))].sort((a, b) => a - b).join('|');

  // 2) prstence rozdělíme na úseky mezi uzly (místa, kde se mění sousedství);
  //    každý úsek zjednodušíme jen jednou, takže sousední kraje mají shodnou hranici
  const arcCache = new Map();
  const TOL = 0.0025; // ~200 m
  function simplifyArc(arc) {
    const a = key(arc[0]), b = key(arc[arc.length - 1]);
    const fwd = a < b || (a === b && key(arc[1]) < key(arc[arc.length - 2]));
    const canon = fwd ? arc : arc.slice().reverse();
    const ck = canon.map(key).join(';');
    let s = arcCache.get(ck);
    if (!s) { s = simplify(canon, TOL); arcCache.set(ck, s); }
    return fwd ? s : s.slice().reverse();
  }
  rings.forEach((r) => {
    const n = r.pts.length;
    const isNode = r.pts.map((p, i) => sig(p) !== sig(r.pts[(i - 1 + n) % n]) || sig(p) !== sig(r.pts[(i + 1) % n]));
    let nodes = isNode.map((v, i) => (v ? i : -1)).filter((i) => i >= 0);
    if (nodes.length < 2) {
      // celý prstenec sdílí jeden soused (Praha ve Středočeském kraji) – rozdělit na dvě poloviny
      const far = r.pts.reduce((best, p, i) => (Math.hypot(p[0] - r.pts[0][0], p[1] - r.pts[0][1]) > Math.hypot(r.pts[best][0] - r.pts[0][0], r.pts[best][1] - r.pts[0][1]) ? i : best), 0);
      nodes = [0, far];
    }
    const out = [];
    for (let k = 0; k < nodes.length; k++) {
      const s = nodes[k], e = nodes[(k + 1) % nodes.length];
      const arc = [];
      for (let i = s; ; i = (i + 1) % n) { arc.push(r.pts[i]); if (i === e && arc.length > 1) break; }
      const simp = simplifyArc(arc);
      out.push(...simp.slice(0, -1));
    }
    out.push(out[0]);
    r.out = out.map(([x, y]) => [r4(x), r4(y)]);
  });
  // kraje
  regions.forEach((reg) => {
    const own = rings.filter((r) => r.region === reg.id);
    const byPoly = new Map();
    own.forEach((r) => { if (!byPoly.has(r.pi)) byPoly.set(r.pi, []); byPoly.get(r.pi)[r.ri] = r.out; });
    reg.polygons = [...byPoly.values()].map((p) => p.filter(Boolean));
  });
  // 3) státní hranice = hrany, které patří jen jednomu kraji (vnitřní hrany jsou díky
  //    shodnému zjednodušení u obou sousedů stejné a vyskytují se dvakrát)
  const edgeCount = new Map();
  const ek = (p, q) => { const a = key(p), b = key(q); return a < b ? a + '>' + b : b + '>' + a; };
  regions.forEach((reg) => reg.polygons.forEach((poly) => poly.forEach((ring) => {
    for (let i = 1; i < ring.length; i++) { const k = ek(ring[i - 1], ring[i]); edgeCount.set(k, (edgeCount.get(k) || 0) + 1); }
  })));
  const next = new Map(); // directed outer edges in ring order
  regions.forEach((reg) => reg.polygons.forEach((poly) => poly.forEach((ring) => {
    for (let i = 1; i < ring.length; i++) if (edgeCount.get(ek(ring[i - 1], ring[i])) === 1) next.set(key(ring[i - 1]), ring[i]);
  })));
  const borderRings = [];
  const used = new Set();
  for (const [startK] of next) {
    if (used.has(startK)) continue;
    const ring = [];
    let k = startK, guard = 0;
    while (!used.has(k) && guard++ < 100000) {
      used.add(k);
      const [x, y] = k.split(',').map(Number);
      ring.push([x, y]);
      const n = next.get(k);
      if (!n) break;
      k = key(n);
    }
    ring.push(ring[0]);
    if (ring.length > 3) borderRings.push([ring]);
  }
  borderRings.sort((a, b) => b[0].length - a[0].length);
  czBorder = borderRings.slice(0, 1); // hlavní obrys (drobné kousky jsou artefakty zjednodušení)
  boundarySource = 'ČÚZK (INSPIRE – Územní správní jednotky)';
  console.log('Kraje a hranice z ČÚZK, bodů na hranici státu:', czBorder[0][0].length);
}

// ---------- řeky ----------
const RIVER_NAMES = {
  Vltava: 'Vltava', Elbe: 'Labe', Oder: 'Odra', Morava: 'Morava',
  Eger: 'Ohře', 'Sázava': 'Sázava', Svratka: 'Svratka', Dyje: 'Dyje',
  Uhlava: 'Úhlava', 'Luzicka Nisa': 'Lužická Nisa',
  // pozn.: prvek „Svitava“ v Natural Earth je chybný (vede k Vltavě), proto je Svitava kreslena ručně
};
const rivers = {};
for (const file of ['ne_10m_rivers_lake_centerlines', 'ne_10m_rivers_europe']) {
  for (const f of load(file).features) {
    const cs = RIVER_NAMES[f.properties.name];
    if (!cs || !f.geometry) continue;
    for (const l of lines(f.geometry)) {
      for (const part of clipLine(l)) {
        (rivers[cs] = rivers[cs] || []).push(clean(part, 0.003));
      }
    }
  }
}

// Ručně doplněné řeky (přibližný průběh, [délka, šířka])
const MANUAL_RIVERS = {
  Berounka: [[13.38, 49.75], [13.45, 49.80], [13.52, 49.87], [13.6, 49.93], [13.7, 49.97], [13.8, 50.0], [13.87, 50.04], [13.96, 50.0], [14.07, 49.96], [14.18, 49.93], [14.28, 49.94], [14.35, 49.96], [14.4, 49.99]],
  'Mže': [[12.55, 49.85], [12.63, 49.8], [12.78, 49.77], [12.9, 49.76], [13.0, 49.75], [13.12, 49.74], [13.25, 49.74], [13.38, 49.75]],
  Radbuza: [[12.55, 49.52], [12.64, 49.56], [12.72, 49.59], [12.8, 49.57], [12.88, 49.54], [12.944, 49.53], [13.0, 49.535], [13.07, 49.55], [13.12, 49.6], [13.164, 49.639], [13.23, 49.65], [13.29, 49.655], [13.34, 49.7], [13.38, 49.75]],
  Jizera: [[15.27, 50.86], [15.32, 50.8], [15.33, 50.72], [15.36, 50.66], [15.33, 50.6], [15.24, 50.6], [15.15, 50.59], [15.05, 50.56], [14.97, 50.53], [14.92, 50.45], [14.9, 50.41], [14.85, 50.34], [14.82, 50.29], [14.75, 50.22], [14.68, 50.17]],
  Otava: [[13.42, 49.05], [13.48, 49.13], [13.52, 49.23], [13.6, 49.28], [13.7, 49.32], [13.8, 49.29], [13.9, 49.26], [14.0, 49.27], [14.1, 49.29], [14.15, 49.31], [14.17, 49.38], [14.18, 49.45]],
  'Lužnice': [[14.98, 48.62], [14.95, 48.75], [14.88, 48.92], [14.82, 48.99], [14.76, 49.05], [14.72, 49.12], [14.7, 49.18], [14.72, 49.26], [14.7, 49.34], [14.66, 49.41], [14.58, 49.35], [14.5, 49.3], [14.45, 49.25], [14.42, 49.22]],
  'Malše': [[14.6, 48.57], [14.53, 48.65], [14.5, 48.74], [14.48, 48.82], [14.45, 48.9], [14.47, 48.97]],
  Opava: [[17.37, 50.12], [17.5, 50.1], [17.62, 50.1], [17.7, 50.09], [17.78, 50.04], [17.86, 49.97], [17.9, 49.94], [18.0, 49.93], [18.1, 49.92], [18.2, 49.89], [18.28, 49.86]],
  'Bečva': [[18.35, 49.3], [18.2, 49.32], [18.08, 49.33], [17.996, 49.339], [17.99, 49.4], [17.971, 49.472], [17.85, 49.52], [17.735, 49.548], [17.59, 49.53], [17.5, 49.48], [17.451, 49.455], [17.4, 49.44], [17.35, 49.43]],
  Jihlava: [[15.45, 49.45], [15.59, 49.4], [15.7, 49.3], [15.8, 49.24], [15.88, 49.21], [16.0, 49.18], [16.1, 49.12], [16.25, 49.1], [16.38, 49.1], [16.45, 49.0], [16.53, 48.93], [16.6, 48.88]],
  Ostravice: [[18.45, 49.45], [18.42, 49.52], [18.36, 49.593], [18.354, 49.688], [18.31, 49.76], [18.28, 49.84]],
  Orlice: [[16.55, 50.25], [16.45, 50.18], [16.33, 50.13], [16.22, 50.12], [16.07, 50.15], [15.95, 50.18], [15.84, 50.21]],
  Svitava: [[16.468, 49.756], [16.5, 49.7], [16.52, 49.645], [16.55, 49.6], [16.574, 49.547], [16.6, 49.47], [16.63, 49.41], [16.646, 49.363], [16.66, 49.3], [16.67, 49.25], [16.65, 49.2], [16.62, 49.17]],
  Ploučnice: [[14.97, 50.7], [14.88, 50.7], [14.8, 50.69], [14.725, 50.659], [14.65, 50.67], [14.538, 50.686], [14.45, 50.7], [14.37, 50.72], [14.312, 50.741], [14.26, 50.76], [14.215, 50.782]],
};
// Kam ručně kreslené řeky ústí – poslední bod se „přichytí“ na cílovou řeku
const MOUTH = {
  Berounka: 'Vltava', 'Mže': 'Berounka', Radbuza: 'Berounka', Jizera: 'Labe', Otava: 'Vltava', 'Lužnice': 'Vltava',
  'Malše': 'Vltava', Opava: 'Odra', 'Bečva': 'Morava', Jihlava: 'Svratka', Ostravice: 'Odra', Orlice: 'Labe',
  'Ploučnice': 'Labe', Svitava: 'Svratka',
};
function nearestOn(p, lines) {
  let best = null, bd = Infinity;
  for (const l of lines) for (let i = 1; i < l.length; i++) {
    const a = l[i - 1], b = l[i], dx = b[0] - a[0], dy = b[1] - a[1];
    let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1);
    t = Math.max(0, Math.min(1, t));
    const q = [a[0] + t * dx, a[1] + t * dy], d = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (d < bd) { bd = d; best = q; }
  }
  return best;
}
const order = Object.keys(MANUAL_RIVERS).sort((a, b) => (MANUAL_RIVERS[MOUTH[a]] ? 1 : 0) - (MANUAL_RIVERS[MOUTH[b]] ? 1 : 0));
for (const name of Object.keys(MANUAL_RIVERS)) rivers[name] = [MANUAL_RIVERS[name].slice()];
for (const name of order) {
  const target = rivers[MOUTH[name]];
  if (!target) continue;
  const l = rivers[name][0];
  l[l.length - 1] = nearestOn(l[l.length - 1], target).map(r4);
}

// ---------- přesné řeky DIBAVOD (volitelné) ----------
// Soubor vytvoří `node tools/dibavod.js` z dat DIBAVOD (VÚV TGM). Pokud existuje, nahradí řeky
// z Natural Earth i ručně kreslené řeky.
let riverSource = 'Natural Earth + ručně (přibližně)';
const dibRivers = path.join(dir, 'dibavod-reky.geojson');
if (fs.existsSync(dibRivers)) {
  for (const f of JSON.parse(fs.readFileSync(dibRivers, 'utf8')).features) {
    rivers[f.properties.name] = f.geometry.coordinates.map((l) => clean(l, 0.0015));
  }
  riverSource = 'DIBAVOD (VÚV TGM)';
}

// ---------- vodní plochy ----------
let lakes = [];
const dibLakes = path.join(dir, 'dibavod-nadrze.geojson');
if (fs.existsSync(dibLakes)) {
  for (const f of JSON.parse(fs.readFileSync(dibLakes, 'utf8')).features) {
    lakes.push(f.geometry.coordinates.map((ring) => clean(ring, 0.0008)));
  }
} else {
  for (const f of load('ne_10m_lakes_europe').features) {
    for (const p of polys(f.geometry)) {
      if (p[0].some((pt) => inBox(pt))) lakes.push(p.map((ring) => clean(ring, 0.002)));
    }
  }
}

// ---------- národní parky a CHKO (volitelné) ----------
// Soubor cgs-vcu.geojson = velkoplošná chráněná území z mapové služby České geologické služby:
// https://mapy.geology.cz/arcgis/rest/services/Popularizace/chranena_uzemi/MapServer/2/query
//   ?where=1%3D1&outFields=kat,nazev&outSR=4326&maxAllowableOffset=0.0015&geometryPrecision=5&f=geojson
const areas = [];
const vcuFile = path.join(dir, 'cgs-vcu.geojson');
if (fs.existsSync(vcuFile)) {
  const NP_NAMES = { 'Krkonošský národní park': 'NP Krkonoše' };
  for (const f of JSON.parse(fs.readFileSync(vcuFile, 'utf8')).features) {
    const { kat, nazev } = f.properties;
    const name = NP_NAMES[nazev] || (kat === 'NP' ? 'NP ' : 'CHKO ') + nazev.replace(/ - /g, ' – ');
    const ps = polys(f.geometry).map((p) => p.map((ring) => clean(ring, 0.0015))).filter((p) => p[0].length >= 4);
    // popisný bod = místo uvnitř území nejdál od hranice (hrubé hledání v mřížce)
    let best = null, bd = -1;
    const all = ps.flatMap((p) => p[0]);
    const xs = all.map((p) => p[0]), ys = all.map((p) => p[1]);
    const inR = (pt, ring) => { let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, yi] = ring[i], [xj, yj] = ring[j]; if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) c = !c; } return c; };
    const step = Math.max((Math.max(...xs) - Math.min(...xs)) / 40, 0.002);
    for (let x = Math.min(...xs); x <= Math.max(...xs); x += step) for (let y = Math.min(...ys); y <= Math.max(...ys); y += step * 0.65) {
      if (!ps.some((p) => inR([x, y], p[0]) && !p.slice(1).some((h) => inR([x, y], h)))) continue;
      let d = Infinity;
      for (const p of ps) for (const ring of p) for (let i = 1; i < ring.length; i++) d = Math.min(d, Math.sqrt(sqSegDist([x, y], ring[i - 1], ring[i])));
      if (d > bd) { bd = d; best = [r4(x), r4(y)]; }
    }
    areas.push({ name, kat, polygons: ps, label: best });
  }
  areas.sort((a, b) => (a.kat === b.kat ? a.name.localeCompare(b.name, 'cs') : a.kat === 'NP' ? -1 : 1));
  console.log('Chráněná území:', areas.length);
}

const geo = {
  source: 'Hranice: ' + boundarySource + '; řeky: ' + riverSource + '; okolní státy: Natural Earth',
  bbox: BBOX,
  border: czBorder,
  neighbours,
  regions,
  rivers: Object.entries(rivers).map(([name, ls]) => ({ name, lines: ls })),
  lakes,
  areas,
};

const out = path.join(__dirname, '..', 'data', 'geo.js');
fs.writeFileSync(
  out,
  '// Vygenerováno skriptem tools/build-geo.js – needitovat ručně.\n' +
    'window.GEO = ' + JSON.stringify(geo) + ';\n'
);
console.log('Zapsáno', out, (fs.statSync(out).size / 1024).toFixed(0) + ' kB');
console.log('Řeky:', Object.keys(rivers).join(', '));
console.log('Kraje:', regions.length);
