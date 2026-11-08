#!/usr/bin/env node
/*
 * Kontrola správnosti dat:  node tools/overit-data.js
 *
 * Nezávislé křížové kontroly (bez internetu):
 *  1. každé bodové místo leží v ČR a ve správném kraji (polygony krajů Natural Earth),
 *  2. řeky protékají městy, kterými mají, a ústí do správné řeky,
 *  3. přehradní nádrže leží ve vodní ploše z Natural Earth.
 * Hranice krajů a státu jsou z dat ČÚZK (zjednodušené na ~200 m), řeky a nádrže z DIBAVOD (VÚV TGM).
 */
const fs = require('fs');
const path = require('path');
global.window = {};
const root = path.join(__dirname, '..');
eval(fs.readFileSync(path.join(root, 'data/geo.js'), 'utf8'));
eval(fs.readFileSync(path.join(root, 'data/places.js'), 'utf8'));
const G = window.GEO;

function inRing(pt, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const inPolys = (pt, polys) => polys.some((p) => inRing(pt, p[0]) && !p.slice(1).some((h) => inRing(pt, h)));
function segKm(p, a, b) {
  const c = Math.cos((p[1] * Math.PI) / 180);
  const P = [p[0] * c, p[1]], A = [a[0] * c, a[1]], B = [b[0] * c, b[1]];
  const dx = B[0] - A[0], dy = B[1] - A[1];
  let t = ((P[0] - A[0]) * dx + (P[1] - A[1]) * dy) / (dx * dx + dy * dy || 1);
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(P[0] - A[0] - t * dx, P[1] - A[1] - t * dy) * 111.2;
}
const lineKm = (p, lines) => Math.min(...lines.flatMap((l) => l.slice(1).map((q, i) => segKm(p, l[i], q))));
const borderKm = (p) => lineKm(p, G.border.flatMap((poly) => poly));

// Očekávaný kraj (zkratky ISO 3166-2). Více hodnot = místo leží na hranici krajů.
const KRAJ = {
  // města
  Praha: 'PR', Brno: 'JM', Ostrava: 'MO', 'Plzeň': 'PL', Liberec: 'LI', Olomouc: 'OL', 'České Budějovice': 'JC',
  'Hradec Králové': 'KR', 'Ústí nad Labem': 'US', Pardubice: 'PA', 'Zlín': 'ZL', 'Jihlava': 'VY', 'Karlovy Vary': 'KA',
  Kladno: 'ST', Most: 'US', Opava: 'MO', 'Frýdek-Místek': 'MO', Teplice: 'US', 'Děčín': 'US', 'Mladá Boleslav': 'ST',
  'Třebíč': 'VY', 'Tábor': 'JC', Znojmo: 'JM', Cheb: 'KA', 'Kutná Hora': 'ST', 'Český Krumlov': 'JC', Trutnov: 'KR',
  'Písek': 'JC', 'Přerov': 'OL', 'Prostějov': 'OL',
  // vrcholy
  'Sněžka': 'KR', 'Praděd': 'MO', 'Lysá hora': 'MO', 'Plechý': 'JC', 'Klínovec': 'KA', 'Ještěd': 'LI', 'Říp': 'US',
  'Radhošť': ['MO', 'ZL'], 'Milešovka': 'US', 'Javořice': ['VY', 'JC'] /* vrchol na hranici krajů */, 'Boubín': 'JC', 'Velká Javořina': ['ZL', 'mimo'],
  // vodní plochy
  Lipno: 'JC', 'Orlík': ['JC', 'ST'], Slapy: 'ST', 'Nové Mlýny': 'JM', 'Švihov (Želivka)': ['ST', 'VY'], 'Rožmberk': 'JC', Vranov: 'JM',
  // hrady a zámky
  'Pražský hrad': 'PR', 'Karlštejn': 'ST', 'Křivoklát': 'ST', 'Kokořín': 'ST', 'Konopiště': 'ST', 'Točník': 'ST',
  'Hluboká': 'JC', 'Zvíkov': 'JC', 'Rabí': 'PL', 'Švihov': 'PL', Loket: 'KA', 'Střekov': 'US', 'Bezděz': 'LI',
  Trosky: 'LI', Kost: 'KR', 'Kunětická hora': 'PA', 'Litomyšl': 'PA', 'Telč': 'VY', 'Pernštejn': 'JM', 'Špilberk': 'JM',
  Lednice: 'JM', Valtice: 'JM', Buchlov: 'ZL', 'Kroměříž': 'ZL', Bouzov: 'OL', 'Helfštýn': 'OL', Hukvaldy: 'MO',
};

// Města na řekách [název, délka, šířka]
const NA_REKACH = {
  Vltava: [['Český Krumlov', 14.318, 48.813], ['České Budějovice', 14.474, 48.975], ['Praha', 14.414, 50.087], ['Mělník', 14.474, 50.351]],
  Labe: [['Pardubice', 15.776, 50.038], ['Kolín', 15.2, 50.028], ['Ústí nad Labem', 14.04, 50.66], ['Děčín', 14.215, 50.782]],
  Ohře: [['Cheb', 12.374, 50.08], ['Karlovy Vary', 12.872, 50.232], ['Louny', 13.797, 50.357], ['Litoměřice', 14.132, 50.533]],
  Morava: [['Olomouc', 17.25, 49.594], ['Uherské Hradiště', 17.46, 49.07]],
  Dyje: [['Znojmo', 16.049, 48.856], ['Břeclav', 16.882, 48.759]],
  Odra: [['Ostrava', 18.27, 49.84]],
  Svratka: [['Brno', 16.585, 49.19]],
  'Sázava': [['Žďár nad Sázavou', 15.939, 49.563], ['Světlá nad Sázavou', 15.404, 49.668]],
  Berounka: [['Beroun', 14.072, 49.964], ['Plzeň', 13.374, 49.738]],
  'Mže': [['Stříbro', 13.004, 49.753], ['Tachov', 12.633, 49.795]],
  Radbuza: [['Horšovský Týn', 12.944, 49.53], ['Stod', 13.164, 49.639]],
  Jizera: [['Semily', 15.335, 50.602], ['Turnov', 15.157, 50.587], ['Mladá Boleslav', 14.903, 50.411]],
  Otava: [['Sušice', 13.52, 49.231], ['Strakonice', 13.902, 49.261], ['Písek', 14.148, 49.309]],
  'Lužnice': [['Veselí nad Lužnicí', 14.697, 49.184], ['Tábor', 14.658, 49.414], ['Bechyně', 14.468, 49.295]],
  'Malše': [['Kaplice', 14.496, 48.739], ['České Budějovice', 14.474, 48.975]],
  Opava: [['Krnov', 17.704, 50.09], ['Opava', 17.903, 49.939]],
  'Bečva': [['Vsetín', 17.996, 49.339], ['Valašské Meziříčí', 17.971, 49.472], ['Hranice', 17.735, 49.548], ['Přerov', 17.451, 49.455]],
  Jihlava: [['Jihlava', 15.591, 49.396], ['Třebíč', 15.882, 49.215], ['Ivančice', 16.377, 49.101]],
  Ostravice: [['Frýdlant nad Ostravicí', 18.36, 49.593], ['Frýdek-Místek', 18.354, 49.688]],
  Orlice: [['Kostelec nad Orlicí', 16.213, 50.123], ['Týniště nad Orlicí', 16.078, 50.151], ['Hradec Králové', 15.833, 50.21]],
  'Ploučnice': [['Mimoň', 14.725, 50.659], ['Česká Lípa', 14.538, 50.686], ['Děčín', 14.215, 50.782]],
  Svitava: [['Svitavy', 16.468, 49.756], ['Letovice', 16.574, 49.547], ['Blansko', 16.646, 49.363]],
};
const USTI = {
  Berounka: 'Vltava', 'Mže': 'Berounka', Radbuza: 'Berounka', Jizera: 'Labe', Otava: 'Vltava', 'Lužnice': 'Vltava',
  'Malše': 'Vltava', Opava: 'Odra', 'Bečva': 'Morava', Jihlava: 'Svratka', Ostravice: 'Odra', Orlice: 'Labe',
  'Ploučnice': 'Labe', Svitava: 'Svratka', Vltava: 'Labe', Ohře: 'Labe', 'Sázava': 'Vltava', Dyje: 'Morava',
};
const NADRZE_V_PLOSE = ['Lipno', 'Orlík', 'Slapy', 'Nové Mlýny', 'Švihov (Želivka)', 'Rožmberk', 'Vranov'];
const TOL_REKA_KM = 3;
const TOL_HRANICE_KM = 2.5; // generalizace hranic krajů

let errors = 0, warns = 0;
const bad = (m) => { errors++; console.log('  CHYBA  ' + m); };
const warn = (m) => { warns++; console.log('  pozor  ' + m); };

console.log('1) Místa v krajích');
const regionAt = (p) => G.regions.find((r) => inPolys(p, r.polygons));
for (const pl of window.DEFAULT_PLACES) {
  if (pl.lat == null) continue;
  const p = [pl.lon, pl.lat];
  const explicit = pl.kraj && G.regions.find((r) => r.name === pl.kraj);
  const reg = explicit || regionAt(p);
  const got = reg ? reg.id.slice(3) : 'mimo';
  const exp = KRAJ[pl.nazev];
  if (!inPolys(p, G.border) && !(exp && [].concat(exp).includes('mimo'))) {
    const d = borderKm(p);
    if (d < 1) warn(`${pl.nazev}: leží ${d.toFixed(2)} km za zjednodušenou státní hranicí (bod na hranici)`);
    else bad(`${pl.nazev}: leží mimo ČR (${d.toFixed(1)} km)`);
  }
  if (!exp) { if (pl.kategorie !== 'Hory') warn(`${pl.nazev}: není uveden očekávaný kraj`); continue; }
  if (![].concat(exp).includes(got)) {
    const near = reg && Math.min(...G.regions.filter((r) => [].concat(exp).includes(r.id.slice(3))).map((r) => lineKm(p, r.polygons.flatMap((x) => x))));
    if (near != null && near < TOL_HRANICE_KM) warn(`${pl.nazev}: podle mapy ${got}, očekáváno ${exp} (${near.toFixed(1)} km od hranice – generalizace)`);
    else bad(`${pl.nazev}: podle mapy v kraji ${got}, očekáváno ${exp}`);
  }
}

console.log('2) Řeky');
const R = Object.fromEntries(G.rivers.map((r) => [r.name, r.lines]));
for (const [rv, towns] of Object.entries(NA_REKACH)) {
  if (!R[rv]) { bad(`řeka ${rv} chybí v podkladech`); continue; }
  for (const [n, x, y] of towns) {
    const d = lineKm([x, y], R[rv]);
    if (d > TOL_REKA_KM) bad(`${rv} míjí ${n} o ${d.toFixed(1)} km`);
  }
}
for (const [rv, target] of Object.entries(USTI)) {
  if (!R[rv] || !R[target]) continue;
  const d = Math.min(...R[rv].flatMap((l) => [l[0], l[l.length - 1]]).map((p) => lineKm(p, R[target])));
  if (d > TOL_REKA_KM) bad(`${rv} neústí do ${target} (nejblíže ${d.toFixed(1)} km)`);
}

console.log('3) Vodní plochy');
for (const n of NADRZE_V_PLOSE) {
  const pl = window.DEFAULT_PLACES.find((x) => x.nazev === n);
  if (!G.lakes.some((l) => inPolys([pl.lon, pl.lat], [l]))) bad(`${n}: bod neleží ve vodní ploše`);
}

console.log(`\nHotovo: ${errors} chyb, ${warns} upozornění.`);
process.exit(errors ? 1 : 0);
