#!/usr/bin/env node
/*
 * Převod dat DIBAVOD (VÚV T. G. Masaryka, https://www.dibavod.cz) na GeoJSON pro build-geo.js.
 *
 * Použití:
 *   node tools/dibavod.js <adresář-DIBAVOD> <výstupní-adresář>
 *
 * Adresář DIBAVOD musí obsahovat rozbalené soubory (ze stránky „Struktura DIBAVOD“):
 *   A02_Vodni_tok_JU.shp + .dbf     (dib_A02_Vodni_tok_JU.zip – vodní toky)
 *   A05_Vodni_nadrze.shp + .dbf     (dib_A05_Vodni_nadrze.zip – vodní nádrže)
 * (soubory mohou být i v podadresářích)
 *
 * Výstup: dibavod-reky.geojson a dibavod-nadrze.geojson (WGS84). Bez externích knihoven:
 * Shapefile/DBF se čtou přímo, souřadnice S-JTSK (Křovák, EPSG:5514) se převádějí na WGS84
 * (transformace Bessel → WGS84 sedmi parametry, přesnost ~1 m – pro mapu bohatě stačí).
 */
const fs = require('fs');
const path = require('path');

const [srcDir, outDir] = process.argv.slice(2);
if (!srcDir || !outDir) {
  console.error('Použití: node tools/dibavod.js <adresář-DIBAVOD> <výstupní-adresář>');
  process.exit(1);
}
function find(dir, name) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { const r = find(p, name); if (r) return r; }
    else if (e.name.toLowerCase() === name.toLowerCase()) return p;
  }
  return null;
}

// ---------------------------------------------------------------------------
//  S-JTSK (Křovák East/North, EPSG:5514) → WGS84
// ---------------------------------------------------------------------------
const RAD = Math.PI / 180;
const K = (() => {
  const a = 6377397.155, e2 = 0.006674372230614, e = Math.sqrt(e2);
  const fi0 = 49.5 * RAD, s45 = Math.PI / 4;
  const alfa = Math.sqrt(1 + (e2 * Math.cos(fi0) ** 4) / (1 - e2));
  const uq = 1.04216856380474, u0 = Math.asin(Math.sin(fi0) / alfa);
  const g = Math.pow((1 + e * Math.sin(fi0)) / (1 - e * Math.sin(fi0)), (alfa * e) / 2);
  const k = (Math.tan(u0 / 2 + s45) / Math.pow(Math.tan(fi0 / 2 + s45), alfa)) * g;
  const n0 = (a * Math.sqrt(1 - e2)) / (1 - e2 * Math.sin(fi0) ** 2);
  const s0 = 78.5 * RAD, n = Math.sin(s0), ro0 = (0.9999 * n0) / Math.tan(s0);
  return { a, e2, e, s45, alfa, ad: Math.PI / 2 - uq, k, s0, n, ro0, long0: 24.83333333333333 * RAD };
})();
function krovakInverse(E, N) {
  // EPSG:5514: E = -Y, N = -X (Y, X = klasické souřadnice S-JTSK)
  const X = -N, Y = -E;
  const ro = Math.hypot(X, Y), eps = Math.atan2(Y, X), d = eps / Math.sin(K.s0);
  const s = 2 * (Math.atan(Math.pow(K.ro0 / ro, 1 / K.n) * Math.tan(K.s0 / 2 + K.s45)) - K.s45);
  const u = Math.asin(Math.cos(K.ad) * Math.sin(s) - Math.sin(K.ad) * Math.cos(s) * Math.cos(d));
  const dv = Math.asin((Math.cos(s) * Math.sin(d)) / Math.cos(u));
  const lam = K.long0 - dv / K.alfa;
  let fi = u;
  for (let i = 0; i < 20; i++) {
    const nf = 2 * (Math.atan(Math.pow(K.k, -1 / K.alfa) * Math.pow(Math.tan(u / 2 + K.s45), 1 / K.alfa) *
      Math.pow((1 + K.e * Math.sin(fi)) / (1 - K.e * Math.sin(fi)), K.e / 2)) - K.s45);
    if (Math.abs(nf - fi) < 1e-12) { fi = nf; break; }
    fi = nf;
  }
  return [fi, lam]; // Bessel, radiány
}
// Bessel 1841 → WGS84 (EPSG:5514 towgs84=570.8,85.7,462.8,4.998,1.587,5.261,3.56; rotace pozičního vektoru)
function besselToWgs(fi, lam) {
  const a = 6377397.155, e2 = 0.006674372230614;
  const N = a / Math.sqrt(1 - e2 * Math.sin(fi) ** 2);
  const x = N * Math.cos(fi) * Math.cos(lam), y = N * Math.cos(fi) * Math.sin(lam), z = N * (1 - e2) * Math.sin(fi);
  const sec = RAD / 3600, rx = 4.998 * sec, ry = 1.587 * sec, rz = 5.261 * sec, m = 1 + 3.56e-6;
  const X = 570.8 + m * (x - rz * y + ry * z);
  const Y = 85.7 + m * (rz * x + y - rx * z);
  const Z = 462.8 + m * (-ry * x + rx * y + z);
  const A = 6378137, E2 = 0.00669437999014;
  const p = Math.hypot(X, Y);
  let lat = Math.atan2(Z, p * (1 - E2));
  for (let i = 0; i < 10; i++) {
    const Nn = A / Math.sqrt(1 - E2 * Math.sin(lat) ** 2);
    lat = Math.atan2(Z + E2 * Nn * Math.sin(lat), p);
  }
  return [Math.atan2(Y, X) / RAD, lat / RAD]; // [lon, lat]
}
const toWgs = (E, N) => besselToWgs(...krovakInverse(E, N));

// ---------------------------------------------------------------------------
//  Čtení Shapefile a DBF
// ---------------------------------------------------------------------------
function readShp(file) {
  const b = fs.readFileSync(file);
  const out = [];
  let o = 100;
  while (o + 8 <= b.length) {
    const len = b.readInt32BE(o + 4) * 2;
    const type = b.readInt32LE(o + 8);
    if (type === 3 || type === 5) {
      const r = o + 8, nParts = b.readInt32LE(r + 36), nPts = b.readInt32LE(r + 40);
      const parts = [];
      for (let i = 0; i < nParts; i++) parts.push(b.readInt32LE(r + 44 + i * 4));
      const pts0 = r + 44 + nParts * 4;
      const rings = [];
      for (let i = 0; i < nParts; i++) {
        const s = parts[i], e = i + 1 < nParts ? parts[i + 1] : nPts;
        const ring = [];
        for (let j = s; j < e; j++) ring.push([b.readDoubleLE(pts0 + j * 16), b.readDoubleLE(pts0 + j * 16 + 8)]);
        rings.push(ring);
      }
      out.push(rings);
    } else out.push(null);
    o += 8 + len;
  }
  return out;
}
function readDbf(file, wanted) {
  const b = fs.readFileSync(file);
  const n = b.readUInt32LE(4), hl = b.readUInt16LE(8), rl = b.readUInt16LE(10);
  const fields = [];
  let off = 1;
  for (let o = 32; b[o] !== 0x0d; o += 32) {
    const f = { name: b.toString('latin1', o, o + 11).replace(/\0.*/, ''), len: b[o + 16], off };
    off += f.len;
    fields.push(f);
  }
  const use = fields.filter((f) => wanted.includes(f.name));
  const dec = new TextDecoder('windows-1250');
  const rows = new Array(n);
  for (let r = 0; r < n; r++) {
    const base = hl + r * rl, row = {};
    for (const f of use) row[f.name] = dec.decode(b.subarray(base + f.off, base + f.off + f.len)).trim();
    rows[r] = row;
  }
  return rows;
}

// ---------------------------------------------------------------------------
//  Zjednodušení (Douglas–Peucker) a spojování úseků
// ---------------------------------------------------------------------------
function simplify(points, tol) {
  if (points.length <= 2) return points;
  const sq = tol * tol, keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [f, l] = stack.pop();
    let md = 0, idx = -1;
    const [ax, ay] = points[f], [bx, by] = points[l];
    for (let i = f + 1; i < l; i++) {
      let x = ax, y = ay, dx = bx - ax, dy = by - ay;
      if (dx || dy) { const t = ((points[i][0] - ax) * dx + (points[i][1] - ay) * dy) / (dx * dx + dy * dy); if (t > 1) { x = bx; y = by; } else if (t > 0) { x += dx * t; y += dy * t; } }
      const d = (points[i][0] - x) ** 2 + (points[i][1] - y) ** 2;
      if (d > md) { md = d; idx = i; }
    }
    if (md > sq) { keep[idx] = 1; stack.push([f, idx], [idx, l]); }
  }
  return points.filter((_, i) => keep[i]);
}
// Spojí úseky (v S-JTSK) do co nejdelších linií podle shodných koncových bodů
function merge(segs) {
  const k = (p) => Math.round(p[0]) + ',' + Math.round(p[1]);
  const ends = new Map();
  segs.forEach((s, i) => [k(s[0]), k(s[s.length - 1])].forEach((key) => { if (!ends.has(key)) ends.set(key, []); ends.get(key).push(i); }));
  const used = new Uint8Array(segs.length), lines = [];
  const take = (key, except) => (ends.get(key) || []).find((i) => !used[i] && i !== except);
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    let line = segs[i].slice();
    for (let dir = 0; dir < 2; dir++) {
      for (;;) {
        const endK = k(line[line.length - 1]);
        const j = take(endK, -1);
        if (j == null) break;
        used[j] = 1;
        const s = segs[j];
        line = line.concat((k(s[0]) === endK ? s : s.slice().reverse()).slice(1));
      }
      line.reverse();
    }
    lines.push(line);
  }
  return lines;
}
const lenOf = (l) => l.reduce((s, p, i) => (i ? s + Math.hypot(p[0] - l[i - 1][0], p[1] - l[i - 1][1]) : 0), 0);
const r5 = (n) => Math.round(n * 1e5) / 1e5;

// ---------------------------------------------------------------------------
//  Vodní toky
// ---------------------------------------------------------------------------
// název v aplikaci → názvy v DIBAVOD (u více názvů se toky spojí – např. Bečva + Vsetínská Bečva)
const RIVERS = {
  Vltava: ['Vltava', 'Teplá Vltava'], Labe: ['Labe'], Morava: ['Morava'], Odra: ['Odra'], 'Ohře': ['Ohře'], Dyje: ['Dyje'],
  Berounka: ['Berounka'], 'Sázava': ['Sázava'], Jizera: ['Jizera'], Otava: ['Otava'], 'Lužnice': ['Lužnice'],
  Svratka: ['Svratka'], Svitava: ['Svitava'], Jihlava: ['Jihlava'], Opava: ['Opava'],
  'Bečva': ['Bečva', 'Vsetínská Bečva'], Ostravice: ['Ostravice'], 'Malše': ['Malše'],
  Orlice: ['Orlice', 'Divoká Orlice'], 'Lužická Nisa': ['Lužická Nisa'], 'Mže': ['Mže'], Radbuza: ['Radbuza'],
  'Úhlava': ['Úhlava'], 'Ploučnice': ['Ploučnice'],
};
const shpT = find(srcDir, 'A02_Vodni_tok_JU.shp'), dbfT = find(srcDir, 'A02_Vodni_tok_JU.dbf');
if (!shpT || !dbfT) { console.error('Nenalezen A02_Vodni_tok_JU.shp/.dbf'); process.exit(1); }
console.log('Čtu vodní toky…');
const geomT = readShp(shpT), attrT = readDbf(dbfT, ['NAZ_TOK', 'TOK_ID']);
const wantedNames = new Set(Object.values(RIVERS).flat());
const byTok = new Map(); // TOK_ID → { name, segs }
attrT.forEach((a, i) => {
  if (!wantedNames.has(a.NAZ_TOK) || !geomT[i]) return;
  if (!byTok.has(a.TOK_ID)) byTok.set(a.TOK_ID, { name: a.NAZ_TOK, segs: [] });
  byTok.get(a.TOK_ID).segs.push(...geomT[i]);
});
const riverFeatures = [];
for (const [appName, dibNames] of Object.entries(RIVERS)) {
  const segs = [];
  for (const dn of dibNames) {
    // stejný název může mít více toků (potoky) – vezmeme nejdelší tok daného jména
    const cands = [...byTok.values()].filter((t) => t.name === dn);
    if (!cands.length) { console.warn('  chybí tok', dn); continue; }
    const best = cands.reduce((a, b) => (b.segs.reduce((s, x) => s + lenOf(x), 0) > a.segs.reduce((s, x) => s + lenOf(x), 0) ? b : a));
    segs.push(...best.segs);
  }
  if (!segs.length) continue;
  const lines = merge(segs)
    .filter((l) => lenOf(l) > 300)
    .map((l) => simplify(l, 120).map(([E, N]) => toWgs(E, N).map(r5)));
  const km = segs.reduce((s, x) => s + lenOf(x), 0) / 1000;
  console.log(`  ${appName.padEnd(14)} ${km.toFixed(0).padStart(4)} km, ${lines.length} linií`);
  riverFeatures.push({ type: 'Feature', properties: { name: appName }, geometry: { type: 'MultiLineString', coordinates: lines } });
}
fs.writeFileSync(path.join(outDir, 'dibavod-reky.geojson'), JSON.stringify({ type: 'FeatureCollection', features: riverFeatures }));

// ---------------------------------------------------------------------------
//  Vodní nádrže (jen velké – pro mapu ČR)
// ---------------------------------------------------------------------------
const shpN = find(srcDir, 'A05_Vodni_nadrze.shp'), dbfN = find(srcDir, 'A05_Vodni_nadrze.dbf');
if (shpN && dbfN) {
  console.log('Čtu vodní nádrže…');
  const geomN = readShp(shpN), attrN = readDbf(dbfN, ['NAZ_NA', 'PLOCHA_M2']);
  const MIN_M2 = 1.5e6;
  const lakes = [];
  attrN.forEach((a, i) => {
    if (+a.PLOCHA_M2 < MIN_M2 || !geomN[i]) return;
    const rings = geomN[i].map((r) => simplify(r, 60).map(([E, N]) => toWgs(E, N).map(r5))).filter((r) => r.length >= 4);
    if (rings.length) lakes.push({ type: 'Feature', properties: { name: a.NAZ_NA, plocha_km2: Math.round(+a.PLOCHA_M2 / 1e4) / 100 }, geometry: { type: 'Polygon', coordinates: rings } });
  });
  lakes.sort((x, y) => y.properties.plocha_km2 - x.properties.plocha_km2);
  console.log('  nádrží nad 1,5 km²:', lakes.length, '–', lakes.slice(0, 12).map((l) => `${l.properties.name} ${l.properties.plocha_km2}`).join(', '));
  fs.writeFileSync(path.join(outDir, 'dibavod-nadrze.geojson'), JSON.stringify({ type: 'FeatureCollection', features: lakes }));
}
console.log('Hotovo →', outDir);
