/* Slepá mapa ČR – hlavní logika aplikace (bez závislostí, SheetJS se načítá až při práci s Excelem). */
(function () {
  'use strict';

  const GEO = window.GEO;
  const SVGNS = 'http://www.w3.org/2000/svg';
  const STORE_KEY = 'slepa-mapa-cr:v1';

  // ======================================================================
  //  Pomocné funkce
  // ======================================================================
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  const geoKey = (s) => norm(s).replace(/\b(kraj|hlavni mesto|reka|r\.)\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
  const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const sameName = (a, b) => norm(a) === norm(b);
  // české tvary: 1 místo, 2–4 místa, 5+ míst
  const plural = (n, one, few, many) => `${n} ${n === 1 ? one : n >= 2 && n <= 4 ? few : many}`;
  const mist = (n) => plural(n, 'místo', 'místa', 'míst');

  function svg(tag, attrs, parent) {
    const e = document.createElementNS(SVGNS, tag);
    if (attrs) for (const k in attrs) if (attrs[k] != null) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function h(html) {
    const t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content;
  }

  // ======================================================================
  //  Projekce (jednoduchá válcová, zkreslení korigované na 49,8° s. š.)
  // ======================================================================
  const VIEW = { minX: 11.95, maxX: 18.95, minY: 48.48, maxY: 51.12 };
  const K = 160;
  const COS = Math.cos((49.8 * Math.PI) / 180);
  const project = (lon, lat) => [(lon - VIEW.minX) * K * COS, (VIEW.maxY - lat) * K];
  const unproject = (x, y) => [x / (K * COS) + VIEW.minX, VIEW.maxY - y / K];
  const BASE = { x: 0, y: 0, w: (VIEW.maxX - VIEW.minX) * K * COS, h: (VIEW.maxY - VIEW.minY) * K };
  const KM_PER_UNIT = 111.2 / K;

  // ======================================================================
  //  Geometrie
  // ======================================================================
  function inRing(pt, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  function inPolys(pt, polys) {
    for (const poly of polys) {
      if (inRing(pt, poly[0]) && !poly.slice(1).some((hole) => inRing(pt, hole))) return true;
    }
    return false;
  }
  function segDist(p, a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    let t = dx || dy ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy) : 0;
    t = clamp(t, 0, 1);
    return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
  }
  function lineDist(p, runs) {
    let d = Infinity;
    for (const run of runs) for (let i = 1; i < run.length; i++) d = Math.min(d, segDist(p, run[i - 1], run[i]));
    return d;
  }
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const polysD = (polys) =>
    polys.map((poly) => poly.map((ring) => 'M' + ring.map(([lo, la]) => project(lo, la).map((v) => v.toFixed(1)).join(' ')).join('L') + 'Z').join('')).join('');
  const runsD = (runs) => runs.map((r) => 'M' + r.map((p) => p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join('L')).join('');

  const inCZ = (ll) => inPolys(ll, GEO.border);

  // Popisné body krajů (ručně, aby např. Středočeský kraj nebyl popsán uprostřed Prahy)
  const REGION_LABEL = {
    'CZ-PR': [14.45, 50.07], 'CZ-ST': [14.95, 49.93], 'CZ-JC': [14.4, 49.08], 'CZ-PL': [13.25, 49.55],
    'CZ-KA': [12.8, 50.2], 'CZ-US': [13.85, 50.5], 'CZ-LI': [14.9, 50.7], 'CZ-KR': [15.85, 50.35],
    'CZ-PA': [16.1, 49.9], 'CZ-VY': [15.6, 49.4], 'CZ-JM': [16.6, 49.03], 'CZ-OL': [17.15, 49.78],
    'CZ-ZL': [17.75, 49.2], 'CZ-MO': [18.1, 49.85],
  };
  const REGION_COLORS = ['#e57373', '#64b5f6', '#81c784', '#ffb74d', '#ba68c8', '#4db6ac', '#f06292', '#aed581', '#7986cb', '#ffd54f', '#a1887f', '#4dd0e1', '#ff8a65', '#9575cd'];
  const MAJOR_RIVERS = new Set(['Vltava', 'Labe', 'Morava', 'Odra', 'Dyje', 'Ohře']);

  GEO.regions.forEach((r, i) => {
    r.d = polysD(r.polygons);
    r.label = project(...(REGION_LABEL[r.id] || r.polygons[0][0][0]));
    r.color = REGION_COLORS[i % REGION_COLORS.length];
    r.ringsXY = r.polygons.flatMap((poly) => poly.map((ring) => ring.map((ll) => project(...ll))));
  });
  GEO.rivers.forEach((r) => {
    r.runs = r.lines.map((l) => l.map(([lo, la]) => project(lo, la)));
    r.d = runsD(r.runs);
    // úseky uvnitř ČR – pro výpočet vzdálenosti a umístění značky
    const inside = [];
    r.lines.forEach((l) => {
      let cur = [];
      l.forEach((ll) => {
        if (inCZ(ll)) cur.push(project(...ll));
        else if (cur.length) { if (cur.length > 1) inside.push(cur); cur = []; }
      });
      if (cur.length > 1) inside.push(cur);
    });
    r.inside = inside.length ? inside : r.runs;
    // značka v polovině nejdelšího úseku uvnitř ČR
    const len = (run) => run.reduce((s, p, i) => (i ? s + dist(p, run[i - 1]) : 0), 0);
    const best = r.inside.reduce((a, b) => (len(b) > len(a) ? b : a));
    let half = len(best) / 2;
    r.anchor = best[0];
    for (let i = 1; i < best.length; i++) {
      const s = dist(best[i - 1], best[i]);
      if (half <= s) {
        const t = half / s;
        r.anchor = [best[i - 1][0] + t * (best[i][0] - best[i - 1][0]), best[i - 1][1] + t * (best[i][1] - best[i - 1][1])];
        break;
      }
      half -= s;
    }
  });

  const REGION_BY_KEY = new Map(GEO.regions.map((r) => [geoKey(r.name), r]));
  // Národní parky a CHKO (plochy)
  GEO.areas = GEO.areas || [];
  const areaKey = (s) => norm(s).replace(/^narodni park /, 'np ').replace(/^chranena krajinna oblast /, 'chko ')
    .replace(/^krkonossky narodni park$/, 'np krkonose').replace(/[^a-z0-9]+/g, ' ').trim();
  GEO.areas.forEach((a) => {
    a.d = polysD(a.polygons);
    a.ringsXY = a.polygons.flatMap((poly) => poly.map((ring) => ring.map((ll) => project(...ll))));
    a.labelXY = project(...a.label);
  });
  const AREA_BY_KEY = new Map(GEO.areas.map((a) => [areaKey(a.name), a]));
  const RIVER_BY_KEY = new Map(GEO.rivers.map((r) => [geoKey(r.name), r]));
  const RIVER_ALIASES = { nisa: 'Lužická Nisa', elbe: 'Labe', oder: 'Odra', eger: 'Ohře', 'divoka orlice': 'Orlice', uhlava: 'Úhlava' };
  for (const [k, v] of Object.entries(RIVER_ALIASES)) {
    const r = GEO.rivers.find((x) => x.name === v);
    if (r && !RIVER_BY_KEY.has(k)) RIVER_BY_KEY.set(k, r);
  }

  // ======================================================================
  //  Kategorie
  // ======================================================================
  function catType(cat) {
    const n = norm(cat);
    if (/narodni park|chko|chranen/.test(n)) return 'area';
    if (/rek|tok/.test(n)) return 'river';
    if (/kraj|region/.test(n)) return 'region';
    if (/hrad|zamek|zricen|tvrz|pamat|unesco|klaster/.test(n)) return 'castle';
    if (/vrchol|stit/.test(n)) return 'peak';
    if (/hor|pohor|vrchovin|pahork|hrbet/.test(n)) return 'range';
    if (/mest|obc|sidl/.test(n)) return 'city';
    if (/vod|nadrz|rybn|jezer|prehrad/.test(n)) return 'water';
    return 'other';
  }
  const TYPE_COLOR = { river: '#1565c0', region: '#7b1fa2', peak: '#5d4037', range: '#8d6e63', city: '#c62828', water: '#1e88e5', castle: '#37474f', area: '#2e7d32' };
  const OTHER_COLORS = ['#00897b', '#f4511e', '#5e35b1', '#827717', '#d81b60', '#3949ab'];

  // ======================================================================
  //  Stav
  // ======================================================================
  const state = {
    raw: [],
    custom: false,
    places: [],
    cats: [],
    catColor: {},
    active: new Set(),
    mode: 'atlas',
    settings: { count: 10, hard: false, regions: true, labels: true },
    view: { ...BASE },
    round: null,
    pick: null, // čekající přidání bodu kliknutím
    sel: null, // vybrané místo v atlasu
    importReport: null,
  };

  function load() {
    let stored = null;
    try { stored = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch (e) { stored = null; }
    if (stored && stored.settings) Object.assign(state.settings, stored.settings);
    if (stored && Array.isArray(stored.raw) && stored.raw.length) setData(stored.raw, true);
    else setData(window.DEFAULT_PLACES, false);
    if (stored && Array.isArray(stored.active)) {
      const a = stored.active.filter((c) => state.cats.includes(c));
      if (a.length) state.active = new Set(a);
    }
  }
  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        raw: state.custom ? state.raw : null,
        settings: state.settings,
        active: [...state.active],
      }));
    } catch (e) { /* úložiště nedostupné – nevadí */ }
  }

  function toNum(v) {
    if (typeof v === 'number') return v;
    if (v == null || v === '') return NaN;
    const s = String(v).trim().replace(',', '.');
    return /^-?\d+(\.\d+)?$/.test(s) ? parseFloat(s) : NaN;
  }

  // Převede řádek dat na místo na mapě; vrací {place} nebo {error}
  function buildPlace(raw, ri) {
    const name = String(raw.nazev ?? '').trim();
    const category = String(raw.kategorie ?? '').trim() || 'Ostatní';
    if (!name) return { error: 'chybí název' };
    const p = { id: 'p' + ri, ri, name, category, note: raw.poznamka ? String(raw.poznamka).trim() : '', type: catType(category) };
    const link = String(raw.odkaz ?? '').trim();
    if (/^https?:\/\/\S+$/i.test(link)) p.link = link;
    if (raw.kraj) {
      const reg = REGION_BY_KEY.get(geoKey(raw.kraj));
      if (!reg) return { error: `kraj „${raw.kraj}“ nebyl rozpoznán` };
      p.krajId = reg.id;
      p.krajExplicit = true;
    }
    const lat = toNum(raw.lat), lon = toNum(raw.lon);
    if (isFinite(lat) && isFinite(lon)) {
      if (lon < VIEW.minX || lon > VIEW.maxX || lat < VIEW.minY || lat > VIEW.maxY) return { error: `souřadnice ${lat}, ${lon} leží mimo mapu ČR` };
      p.kind = 'point'; p.lat = lat; p.lon = lon; p.xy = project(lon, lat);
      if (!p.krajId) { const reg = GEO.regions.find((r) => inPolys([lon, lat], r.polygons)); if (reg) p.krajId = reg.id; }
      return { place: p };
    }
    const key = geoKey(name);
    const tryRegion = () => { const r = REGION_BY_KEY.get(key); if (r) { p.kind = 'region'; p.geo = r; p.xy = r.label; return true; } return false; };
    const tryRiver = () => { const r = RIVER_BY_KEY.get(key); if (r) { p.kind = 'river'; p.geo = r; p.xy = r.anchor; return true; } return false; };
    const tryArea = () => { const a = AREA_BY_KEY.get(areaKey(name)); if (a) { p.kind = 'area'; p.geo = a; p.xy = a.labelXY; return true; } return false; };
    let ok = false;
    if (p.type === 'river') ok = tryRiver();
    else if (p.type === 'region') ok = tryRegion();
    else if (p.type === 'area') ok = tryArea();
    else if (p.type === 'other') ok = tryRegion() || tryRiver() || tryArea();
    if (ok) return { place: p };
    if (p.type === 'river') return { error: `řeka „${name}“ není v mapových podkladech – doplňte souřadnice bodu` };
    if (p.type === 'region') return { error: `kraj „${name}“ nebyl rozpoznán` };
    if (p.type === 'area') return { error: `chráněné území „${name}“ není v mapových podkladech – doplňte souřadnice bodu` };
    return { error: 'chybí souřadnice' };
  }

  function setData(raw, custom) {
    state.raw = raw.map((r) => ({ ...r }));
    state.custom = custom;
    state.places = [];
    state.raw.forEach((r, i) => { const res = buildPlace(r, i); if (res.place) state.places.push(res.place); });
    const cats = [];
    state.places.forEach((p) => { if (!cats.includes(p.category)) cats.push(p.category); });
    state.cats = cats;
    let oi = 0;
    state.catColor = {};
    cats.forEach((c) => { const t = catType(c); state.catColor[c] = TYPE_COLOR[t] || OTHER_COLORS[oi++ % OTHER_COLORS.length]; });
    const keep = [...state.active].filter((c) => cats.includes(c));
    state.active = new Set(keep.length ? keep : cats);
  }

  const regionName = (id) => (GEO.regions.find((r) => r.id === id) || {}).name || '';
  function mapyLink(p) {
    if (p.kind === 'point') return `https://mapy.cz/zakladni?source=coor&id=${p.lon}%2C${p.lat}&x=${p.lon}&y=${p.lat}&z=14`;
    return 'https://mapy.cz/zakladni?q=' + encodeURIComponent(p.kind === 'river' ? 'řeka ' + p.name : p.name);
  }
  function linksHTML(p) {
    return `<a href="${esc(mapyLink(p))}" target="_blank" rel="noopener">Zobrazit na Mapy.cz ↗</a>` +
      (p.link ? ` · <a href="${esc(p.link)}" target="_blank" rel="noopener">Více informací ↗</a>` : '');
  }
  // Kraje, které uznáme jako správnou odpověď. Je-li kraj uveden v datech, platí jen ten.
  // Jinak se kraj určí z mapy a u míst do 3 km od hranice krajů se uzná i sousední kraj
  // (hranice v mapových podkladech jsou zjednodušené).
  function acceptedRegions(p) {
    if (p.krajExplicit) return new Set([p.krajId]);
    const ids = new Set(p.krajId ? [p.krajId] : []);
    if (p.kind === 'point') {
      const tol = 3 / KM_PER_UNIT;
      GEO.regions.forEach((r) => { if (lineDist(p.xy, r.ringsXY) <= tol) ids.add(r.id); });
    }
    return ids;
  }

  const visiblePlaces = () => state.places.filter((p) => state.active.has(p.category));
  const byId = (id) => state.places.find((p) => p.id === id);

  // ======================================================================
  //  Mapa – podklad
  // ======================================================================
  const map = $('#map');
  const mapWrap = $('#mapWrap');
  let gRegions, gRivers, gHL, gOverlay;
  const regionEl = new Map();
  const riverEl = new Map();
  const areaEl = new Map();

  function buildBaseMap() {
    map.innerHTML = '';
    const defs = svg('defs', null, map);
    const clip = svg('clipPath', { id: 'czClip' }, defs);
    svg('path', { d: polysD(GEO.border) }, clip);

    svg('rect', { class: 'sea', x: -500, y: -500, width: BASE.w + 1000, height: BASE.h + 1000 }, map);
    const gN = svg('g', null, map);
    GEO.neighbours.forEach((n) => svg('path', { class: 'neighbour', d: polysD(n.polygons) }, gN));
    const NB_LABELS = [['Německo', 12.75, 50.93], ['Německo', 12.3, 49.25], ['Polsko', 16.2, 50.95], ['Polsko', 18.6, 50.2], ['Rakousko', 15.3, 48.62], ['Slovensko', 18.35, 48.8]];
    NB_LABELS.forEach(([t, lo, la]) => {
      const [x, y] = project(lo, la);
      svg('text', { class: 'neighbour-label', x, y, 'text-anchor': 'middle' }, gN).textContent = t;
    });

    svg('path', { class: 'land', d: polysD(GEO.border) }, map);
    gRegions = svg('g', null, map);
    GEO.regions.forEach((r) => {
      const e = svg('path', { class: 'region', d: r.d, 'data-region': r.id }, gRegions);
      e.style.setProperty('--rc', r.color);
      regionEl.set(r.id, e);
    });
    const gA = svg('g', null, map);
    GEO.areas.forEach((a) => {
      const e = svg('path', { class: 'area ' + (a.kat === 'NP' ? 'np' : 'chko'), d: a.d, 'data-area': a.name }, gA);
      areaEl.set(a.name, e);
    });
    const gL = svg('g', { 'clip-path': 'url(#czClip)' }, map);
    GEO.lakes.forEach((l) => svg('path', { class: 'lake', d: polysD([l]) }, gL));
    gRivers = svg('g', { 'clip-path': 'url(#czClip)' }, map);
    GEO.rivers.forEach((r) => {
      const g = svg('g', { 'data-river': r.name }, gRivers);
      const line = svg('path', { class: 'river-line' + (MAJOR_RIVERS.has(r.name) ? ' major' : ''), d: r.d }, g);
      svg('path', { class: 'river-hit', d: r.d }, g);
      riverEl.set(r.name, line);
    });
    svg('path', { class: 'border', d: polysD(GEO.border) }, map);
    gHL = svg('g', null, map);
    gOverlay = svg('g', null, map);
    applyView();
  }

  // ======================================================================
  //  Přiblížení a posun
  // ======================================================================
  function unit() {
    const r = map.getBoundingClientRect();
    if (!r.width || !r.height) return 1;
    return 1 / Math.min(r.width / state.view.w, r.height / state.view.h);
  }
  function applyView() {
    const v = state.view;
    map.setAttribute('viewBox', `${v.x} ${v.y} ${v.w} ${v.h}`);
  }
  function setView(v, render = true) {
    const w = clamp(v.w, BASE.w / 8, BASE.w);
    const hgt = (w * BASE.h) / BASE.w;
    state.view = {
      w, h: hgt,
      x: clamp(v.x, BASE.x - BASE.w * 0.05, BASE.x + BASE.w * 1.05 - w),
      y: clamp(v.y, BASE.y - BASE.h * 0.05, BASE.y + BASE.h * 1.05 - hgt),
    };
    if (w === BASE.w) { state.view.x = 0; state.view.y = 0; }
    applyView();
    if (render) renderOverlay();
  }
  function zoomAt(cx, cy, f) {
    const v = state.view;
    const w = clamp(v.w * f, BASE.w / 8, BASE.w);
    const k = w / v.w;
    setView({ w, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k });
  }
  function clientToMap(cx, cy) {
    const m = map.getScreenCTM();
    if (!m) return [0, 0];
    const p = new DOMPoint(cx, cy).matrixTransform(m.inverse());
    return [p.x, p.y];
  }
  function mapToClient(x, y) {
    const m = map.getScreenCTM();
    const p = new DOMPoint(x, y).matrixTransform(m);
    return [p.x, p.y];
  }

  $('#zoomIn').onclick = () => zoomAt(state.view.x + state.view.w / 2, state.view.y + state.view.h / 2, 1 / 1.5);
  $('#zoomOut').onclick = () => zoomAt(state.view.x + state.view.w / 2, state.view.y + state.view.h / 2, 1.5);
  $('#zoomReset').onclick = () => setView({ ...BASE });
  map.addEventListener('wheel', (e) => {
    e.preventDefault();
    const [x, y] = clientToMap(e.clientX, e.clientY);
    zoomAt(x, y, e.deltaY < 0 ? 1 / 1.2 : 1.2);
  }, { passive: false });

  let ptr = null;
  map.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || drag) return;
    ptr = { id: e.pointerId, x: e.clientX, y: e.clientY, view: { ...state.view }, moved: false, target: e.target };
  });
  window.addEventListener('pointermove', (e) => {
    if (drag) return dragMove(e);
    if (ptr && e.pointerId === ptr.id) {
      const dx = e.clientX - ptr.x, dy = e.clientY - ptr.y;
      if (!ptr.moved && Math.hypot(dx, dy) > 6) { ptr.moved = true; map.classList.add('panning'); hideTip(); }
      if (ptr.moved && ptr.view.w < BASE.w - 1e-6) {
        const u = unit();
        setView({ ...ptr.view, x: ptr.view.x - dx * u, y: ptr.view.y - dy * u }, false);
      }
      return;
    }
    if (e.target && map.contains(e.target)) hover(e);
  });
  window.addEventListener('pointerup', (e) => {
    if (drag) return dragEnd(e);
    if (ptr && e.pointerId === ptr.id) {
      const p = ptr;
      ptr = null;
      map.classList.remove('panning');
      if (p.moved) renderOverlay();
      else onMapClick(e, p.target);
    }
  });
  window.addEventListener('pointercancel', () => { ptr = null; map.classList.remove('panning'); if (drag) dragCancel(); });
  map.addEventListener('pointerleave', hideTip);
  let resizeT;
  window.addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(renderOverlay, 100); });

  // ======================================================================
  //  Bublinová nápověda a oznámení
  // ======================================================================
  const tip = $('#tip');
  function showTip(html, cx, cy) {
    const r = mapWrap.getBoundingClientRect();
    tip.innerHTML = html;
    tip.hidden = false;
    tip.style.left = clamp(cx - r.left, 60, r.width - 60) + 'px';
    tip.style.top = cy - r.top + 'px';
  }
  function hideTip() { tip.hidden = true; }
  let toastT;
  function toast(msg, ms = 2200) {
    const t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastT);
    toastT = setTimeout(() => (t.hidden = true), ms);
  }

  function hover(e) {
    if (!(state.mode === 'atlas' || state.mode === 'data')) return hideTip();
    const p = placeAtTarget(e.target);
    if (!p) return hideTip();
    showTip(`<b>${esc(p.name)}</b><small>${esc(p.category)}${p.note ? ' · ' + esc(p.note) : ''}</small>`, e.clientX, e.clientY);
  }

  // ======================================================================
  //  Vykreslení překryvné vrstvy (značky, popisky, čísla)
  // ======================================================================
  function clearOverlay() {
    gOverlay.innerHTML = '';
    gHL.innerHTML = '';
    for (const e of regionEl.values()) e.classList.remove('colored', 'hl', 'ok', 'bad');
    for (const e of riverEl.values()) e.classList.remove('on', 'hl', 'ok');
    for (const e of areaEl.values()) e.classList.remove('on', 'outline', 'hl', 'ok', 'bad');
  }

  function drawMarker(p, u, cls = '', parent = gOverlay) {
    const [x, y] = p.xy;
    const t = p.type === 'river' || p.type === 'region' ? 'other' : p.type;
    const g = svg('g', { class: `mk mk-${t} ${cls}`, 'data-pid': p.id, transform: `translate(${x} ${y}) scale(${u})` }, parent);
    if (t === 'other') g.style.setProperty('--c', state.catColor[p.category]);
    if (t === 'peak') svg('path', { class: 'shape', d: 'M0 -7L6.5 5H-6.5Z' }, g);
    else if (t === 'range') svg('path', { class: 'shape', d: 'M-11 5L-5 -5L-1 1L4 -7L11 5Z' }, g);
    else if (t === 'water') svg('path', { class: 'shape', d: 'M0 -7C3 -2 6 1 6 3.5A6 6 0 0 1 -6 3.5C-6 1 -3 -2 0 -7Z' }, g);
    else if (t === 'castle') svg('path', { class: 'shape', d: 'M-6.5 6V-3H-4.5V-6.5H-1.8V-3H1.8V-6.5H4.5V-3H6.5V6Z' }, g);
    else svg('circle', { class: 'shape', r: t === 'city' ? 5 : 5.5 }, g);
    svg('circle', { class: 'hit', r: 13 }, g);
    return g;
  }
  function drawLabel(x, y, text, u, cls = '', dx = 9, dy = 4, anchor = 'start') {
    const g = svg('g', { transform: `translate(${x} ${y}) scale(${u})` }, gOverlay);
    const t = svg('text', { class: 'lbl ' + cls, x: dx, y: dy, 'text-anchor': anchor }, g);
    t.textContent = text;
    return g;
  }
  function labelFor(p, u, cls = '') {
    if (p.kind === 'region') return drawLabel(p.xy[0], p.xy[1], p.name, u, 'region ' + cls, 0, 4, 'middle');
    if (p.kind === 'area') return drawLabel(p.xy[0], p.xy[1], p.name, u, 'area ' + cls, 0, 4, 'middle');
    if (p.kind === 'river') return drawLabel(p.xy[0], p.xy[1], p.name, u, 'river ' + cls, 6, -6);
    if (p.type === 'range') return drawLabel(p.xy[0], p.xy[1], p.name, u, 'range ' + cls, 0, 18, 'middle');
    return drawLabel(p.xy[0], p.xy[1], p.name, u, cls);
  }
  function pulseAt(xy, u) {
    const g = svg('g', { transform: `translate(${xy[0]} ${xy[1]}) scale(${u})` }, gHL);
    svg('circle', { class: 'pulse', r: 16 }, g);
  }
  function highlight(p, cls = 'hl') {
    if (p.kind === 'region') regionEl.get(p.geo.id).classList.add(cls);
    else if (p.kind === 'area') areaEl.get(p.geo.name).classList.add(cls);
    else if (p.kind === 'river') riverEl.get(p.geo.name).classList.add(cls);
  }

  // Rozmístí čísla tak, aby se nepřekrývala (jednoduché odpuzování)
  function layoutBadges(anchors, u, minPx = 25) {
    const pts = anchors.map(([x, y]) => [x / u, y / u]);
    const orig = pts.map((p) => p.slice());
    for (let it = 0; it < 60; it++) {
      let moved = false;
      for (let i = 0; i < pts.length; i++) {
        for (let j = i + 1; j < pts.length; j++) {
          let dx = pts[j][0] - pts[i][0], dy = pts[j][1] - pts[i][1];
          let d = Math.hypot(dx, dy);
          if (d < minPx) {
            if (d < 0.01) { dx = Math.cos(i + j); dy = Math.sin(i + j); d = 1; }
            const push = (minPx - d) / 2 + 0.2;
            pts[i][0] -= (dx / d) * push; pts[i][1] -= (dy / d) * push;
            pts[j][0] += (dx / d) * push; pts[j][1] += (dy / d) * push;
            moved = true;
          }
        }
        // mírný návrat ke kotvě
        pts[i][0] += (orig[i][0] - pts[i][0]) * 0.02;
        pts[i][1] += (orig[i][1] - pts[i][1]) * 0.02;
      }
      if (!moved) break;
    }
    return pts.map(([x, y]) => [x * u, y * u]);
  }

  function renderOverlay() {
    if (!gOverlay) return;
    clearOverlay();
    const u = unit();
    const forceRegions = state.mode === 'kraj' || (state.round && state.round.items && state.round.items.some((p) => p.kind === 'region'));
    map.classList.toggle('show-regions', state.settings.regions || forceRegions || state.active.has(state.cats.find((c) => catType(c) === 'region')));
    map.classList.toggle('picking', !!state.pick);
    const r = state.round;
    // v kvízech s chráněnými územími jsou vidět obrysy všech území z dané sekce
    if (r && r.items && QUIZ_MODES.includes(state.mode)) {
      const cats = new Set(r.items.filter((p) => p.kind === 'area').map((p) => p.category));
      visiblePlaces().filter((p) => p.kind === 'area' && cats.has(p.category)).forEach((p) => areaEl.get(p.geo.name).classList.add('outline'));
    }
    if (state.mode === 'atlas' || state.mode === 'data') renderAtlas(u);
    else if (r && r.type === 'assign') renderAssign(u, r);
    else if (r && r.type === 'find') renderFind(u, r);
    else if (r && r.type === 'guess') renderGuess(u, r);
    else if (r && r.type === 'kraj') renderKraj(u, r);
  }

  function renderAtlas(u) {
    const items = visiblePlaces();
    items.filter((p) => p.kind === 'region').forEach((p) => regionEl.get(p.geo.id).classList.add('colored'));
    items.filter((p) => p.kind === 'river').forEach((p) => riverEl.get(p.geo.name).classList.add('on'));
    items.filter((p) => p.kind === 'area').forEach((p) => areaEl.get(p.geo.name).classList.add('on'));
    items.filter((p) => p.kind === 'point').forEach((p) => drawMarker(p, u));
    if (state.settings.labels) items.forEach((p) => labelFor(p, u));
    const sel = state.mode === 'atlas' && state.sel;
    if (sel) {
      highlight(sel);
      if (sel.kind === 'point') pulseAt(sel.xy, u);
      if (!state.settings.labels || !state.active.has(sel.category)) labelFor(sel, u, 'answer');
    }
  }

  // ======================================================================
  //  Kolo hry – společné
  // ======================================================================
  function pickItems(filter) {
    let pool = visiblePlaces();
    if (filter) pool = pool.filter(filter);
    const n = state.settings.count === 'all' ? pool.length : Math.min(+state.settings.count, pool.length);
    return shuffle(pool).slice(0, n);
  }
  function grade(pct) {
    if (pct >= 90) return [1, 'výborně'];
    if (pct >= 75) return [2, 'chvalitebně'];
    if (pct >= 50) return [3, 'dobře'];
    if (pct >= 30) return [4, 'dostatečně'];
    return [5, 'nedostatečně'];
  }

  function startRound(itemsOverride) {
    state.round = null;
    hideTip();
    if (state.mode === 'assign') startAssign(itemsOverride);
    else if (state.mode === 'find') startFind(itemsOverride);
    else if (state.mode === 'guess') startGuess(itemsOverride);
    else if (state.mode === 'kraj') startKraj(itemsOverride);
    renderPanel();
    renderOverlay();
  }

  function settingsHTML(extra = '') {
    const c = state.settings.count;
    const opt = (v, t) => `<option value="${v}"${String(c) === String(v) ? ' selected' : ''}>${t}</option>`;
    return `<div class="row">
      <label class="field">Počet míst
        <select id="setCount">${opt(5, '5')}${opt(10, '10')}${opt(15, '15')}${opt(20, '20')}${opt('all', 'vše')}</select>
      </label>${extra}
      <button class="btn" id="btnRestart" style="align-self:flex-end">Nové kolo</button>
    </div>`;
  }
  function bindSettings() {
    const s = $('#setCount');
    if (s) s.onchange = () => { state.settings.count = s.value === 'all' ? 'all' : +s.value; save(); startRound(); };
    const hd = $('#setHard');
    if (hd) hd.onchange = () => { state.settings.hard = hd.checked; save(); startRound(); };
    const rs = $('#btnRestart');
    if (rs) rs.onclick = () => startRound();
  }

  function resultsHTML(r, title) {
    const ok = r.results.filter((x) => x.ok).length;
    const total = r.results.length;
    const pct = total ? Math.round((ok / total) * 100) : 0;
    const [g, gt] = grade(pct);
    const list = r.results.map((x) => `<li><span class="ic ${x.ok ? 'ok' : 'bad'}">${x.ok ? '✓' : '✗'}</span><span>${esc(x.p.name)}${x.ok ? '' : `<br><span class="muted">${esc(x.info || '')}</span>`}</span></li>`).join('');
    return `<h2>${esc(title)}</h2>
      <div class="score"><span class="big">${ok} / ${total}</span><span class="muted">${pct} %</span>
      <span class="grade"><b>${g}</b><span>${gt}</span></span></div>
      <div class="row"><button class="btn primary" id="btnAgain">Nové kolo</button>
      ${ok < total ? '<button class="btn" id="btnWrong">Opakovat chyby</button>' : ''}</div>
      <ul class="reslist">${list}</ul>`;
  }
  function bindResults(r) {
    $('#btnAgain').onclick = () => startRound();
    const w = $('#btnWrong');
    if (w) w.onclick = () => startRound(shuffle(r.results.filter((x) => !x.ok).map((x) => x.p)));
  }
  const QUIZ_MODES = ['assign', 'find', 'guess', 'kraj'];
  const ALL_MODES = ['atlas', 'assign', 'find', 'guess', 'kraj', 'data'];
  const emptyHTML = '<p class="muted">Ve vybraných sekcích nejsou žádná místa. Zapněte nahoře alespoň jednu sekci.</p>';

  // ======================================================================
  //  Režim: Přiřazování (přetahování názvů na čísla v mapě)
  // ======================================================================
  function startAssign(items) {
    items = items || pickItems();
    state.round = {
      type: 'assign',
      items,
      cards: shuffle(items.map((p, i) => ({ key: i, name: p.name }))),
      placed: new Map(), // index cíle -> klíč karty
      selected: null,
      checked: false,
    };
  }
  function cardOf(r, key) { return r.cards.find((c) => c.key === key); }
  function placeCard(targetIdx, key) {
    const r = state.round;
    if (r.checked) return;
    for (const [t, k] of r.placed) if (k === key) r.placed.delete(t);
    r.placed.set(targetIdx, key);
    r.selected = null;
    renderPanel();
    renderOverlay();
  }

  function renderAssign(u, r) {
    r.items.forEach((p) => {
      if (p.kind === 'point') drawMarker(p, u, 'dim');
      else if (p.kind === 'river') highlight(p, 'on');
    });
    const pos = layoutBadges(r.items.map((p) => p.xy), u);
    r.items.forEach((p, i) => {
      const [bx, by] = pos[i];
      if (dist([bx, by], p.xy) > 4 * u) svg('line', { class: 'leader', x1: p.xy[0], y1: p.xy[1], x2: bx, y2: by, 'stroke-width': u }, gOverlay);
    });
    r.items.forEach((p, i) => {
      const [bx, by] = pos[i];
      const key = r.placed.get(i);
      let cls = 'badge';
      if (key != null) cls += ' filled';
      let ok = null;
      if (r.checked) { ok = key != null && sameName(cardOf(r, key).name, p.name); cls += ok ? ' ok' : ' bad'; }
      const g = svg('g', { class: cls, 'data-target': i, transform: `translate(${bx} ${by}) scale(${u})` }, gOverlay);
      svg('circle', { class: 'hit', r: 18 }, g);
      svg('circle', { class: 'b', r: 11 }, g);
      svg('text', { y: 0.5 }, g).textContent = i + 1;
      if (key != null) {
        const name = cardOf(r, key).name;
        drawLabel(bx, by, name, u, r.checked ? (ok ? 'ok' : 'bad') : 'placed', 15, 4);
        if (r.checked && !ok) drawLabel(bx, by, p.name, u, 'answer', 15, 19);
      } else if (r.checked) drawLabel(bx, by, p.name, u, 'answer', 15, 4);
    });
  }

  function assignPanel() {
    const r = state.round;
    if (!r || !r.items.length) return `<h2>Přiřazování</h2>${emptyHTML}`;
    if (r.checked) {
      return resultsHTML(r, 'Výsledek přiřazování') + '<p class="muted">Správná řešení jsou vyznačena zeleně přímo v mapě.</p>';
    }
    const used = new Set(r.placed.values());
    const cards = r.cards.map((c) => {
      const t = [...r.placed].find(([, k]) => k === c.key);
      return `<span class="card${r.selected === c.key ? ' sel' : ''}${used.has(c.key) ? ' used' : ''}" data-card="${c.key}">${t ? `<span class="num">${t[0] + 1}</span>` : ''}${esc(c.name)}</span>`;
    }).join('');
    return `<h2>Přiřazování</h2>
      <p class="muted">Přetáhněte názvy na čísla v mapě. Na dotykovém zařízení můžete také ťuknout na název a potom na číslo.</p>
      ${settingsHTML()}
      <div class="progress"><div style="width:${(r.placed.size / r.items.length) * 100}%"></div></div>
      <p class="muted">Umístěno ${r.placed.size} z ${r.items.length}</p>
      <div class="cards" id="cards">${cards}</div>
      <div class="row"><button class="btn primary" id="btnCheck"${r.placed.size ? '' : ' disabled'}>Zkontrolovat</button>
      <button class="btn" id="btnClear"${r.placed.size ? '' : ' disabled'}>Vyprázdnit</button></div>`;
  }
  function bindAssign() {
    const r = state.round;
    if (!r) return;
    if (r.checked) return bindResults(r);
    bindSettings();
    $('#btnCheck').onclick = () => {
      r.checked = true;
      r.results = r.items.map((p, i) => {
        const key = r.placed.get(i);
        const ok = key != null && sameName(cardOf(r, key).name, p.name);
        return { p, ok, info: key == null ? `č. ${i + 1} – nevyplněno` : `č. ${i + 1} – uvedeno „${cardOf(r, key).name}“` };
      });
      renderPanel();
      renderOverlay();
    };
    $('#btnClear').onclick = () => { r.placed.clear(); r.selected = null; renderPanel(); renderOverlay(); };
    $('#cards').addEventListener('pointerdown', (e) => {
      const c = e.target.closest('[data-card]');
      if (!c || e.button !== 0) return;
      e.preventDefault();
      dragStart(e, +c.dataset.card, c.textContent);
    });
  }

  // Přetahování karet
  let drag = null;
  const ghost = $('#ghost');
  function dragStart(e, key, text) {
    drag = { key, x: e.clientX, y: e.clientY, moved: false, text };
  }
  function targetAt(cx, cy) {
    const el = document.elementFromPoint(cx, cy);
    const t = el && el.closest && el.closest('[data-target]');
    if (t) return +t.dataset.target;
    // nejbližší číslo do 30 px
    let best = null, bd = 30;
    gOverlay.querySelectorAll('[data-target]').forEach((b) => {
      const rc = b.querySelector('circle.b').getBoundingClientRect();
      const d = Math.hypot(rc.left + rc.width / 2 - cx, rc.top + rc.height / 2 - cy);
      if (d < bd) { bd = d; best = +b.dataset.target; }
    });
    return best;
  }
  let dropHL = null;
  function dragMove(e) {
    if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 5) {
      drag.moved = true;
      ghost.textContent = drag.text;
      ghost.hidden = false;
    }
    if (!drag.moved) return;
    ghost.style.left = e.clientX + 'px';
    ghost.style.top = e.clientY + 'px';
    const t = targetAt(e.clientX, e.clientY);
    if (dropHL) dropHL.classList.remove('drop');
    dropHL = t != null ? gOverlay.querySelector(`[data-target="${t}"]`) : null;
    if (dropHL) dropHL.classList.add('drop');
  }
  function dragEnd(e) {
    const d = drag;
    drag = null;
    ghost.hidden = true;
    if (dropHL) { dropHL.classList.remove('drop'); dropHL = null; }
    const r = state.round;
    if (!r || r.type !== 'assign') return;
    if (!d.moved) {
      // klik na kartu = výběr
      r.selected = r.selected === d.key ? null : d.key;
      renderPanel();
      return;
    }
    const t = targetAt(e.clientX, e.clientY);
    if (t != null) placeCard(t, d.key);
  }
  function dragCancel() { drag = null; ghost.hidden = true; }

  // ======================================================================
  //  Režim: Najdi na mapě
  // ======================================================================
  function startFind(items) {
    state.round = { type: 'find', items: items || pickItems(), idx: 0, results: [], answered: null };
  }
  const currentItem = (r) => r.items[r.idx];
  function tolKm(p) { return p.type === 'range' ? 35 : p.type === 'water' ? 15 : 20; }

  function renderFind(u, r) {
    const done = r.idx >= r.items.length;
    if (!state.settings.hard) {
      // lehká obtížnost: značky všech bodových míst ve vybraných sekcích
      const shownTypes = new Set(r.items.filter((p) => p.kind === 'point').map((p) => p.category));
      visiblePlaces().filter((p) => p.kind === 'point' && shownTypes.has(p.category)).forEach((p) => drawMarker(p, u));
    }
    if (done || !r.answered) return;
    const p = currentItem(r);
    const a = r.answered;
    highlight(p, a.ok ? 'ok' : 'hl');
    if (a.wrongRegion) regionEl.get(a.wrongRegion).classList.add('bad');
    if (a.wrongArea) areaEl.get(a.wrongArea).classList.add('bad');
    if (p.kind === 'point') {
      pulseAt(p.xy, u);
      drawMarker(p, u, a.ok ? 'ok' : 'sel');
    }
    if (!a.ok && a.click) {
      if (p.kind === 'point' && state.settings.hard) svg('line', { class: 'miss-line', x1: a.click[0], y1: a.click[1], x2: p.xy[0], y2: p.xy[1], 'stroke-width': 1.5 * u }, gHL);
      const g = svg('g', { transform: `translate(${a.click[0]} ${a.click[1]}) scale(${u})` }, gHL);
      svg('path', { class: 'miss', d: 'M-5 -5L5 5M5 -5L-5 5' }, g);
    }
    labelFor(p, u, 'answer');
  }

  function findClick(e, target) {
    const r = state.round;
    if (r.idx >= r.items.length) return;
    if (r.answered) return nextFind();
    const p = currentItem(r);
    const xy = clientToMap(e.clientX, e.clientY);
    const ll = unproject(...xy);
    const u = unit();
    let ok = false, info = '', wrongRegion = null, wrongArea = null;
    if (p.kind === 'area') {
      ok = inPolys(ll, p.geo.polygons);
      if (!ok) {
        const hit = visiblePlaces().find((x) => x.kind === 'area' && x.category === p.category && inPolys(ll, x.geo.polygons));
        info = hit ? `Klikli jste na: ${hit.name}.` : `Vedle – území je asi ${Math.round(lineDist(xy, p.geo.ringsXY) * KM_PER_UNIT)} km od místa kliknutí.`;
        if (hit) wrongArea = hit.geo.name;
      }
    } else if (p.kind === 'region') {
      ok = inPolys(ll, p.geo.polygons);
      if (!ok) {
        const reg = GEO.regions.find((x) => inPolys(ll, x.polygons));
        info = reg ? `Klikli jste na: ${reg.name}.` : 'Kliknutí je mimo území ČR.';
        if (reg) wrongRegion = reg.id;
      }
    } else if (p.kind === 'river') {
      const tol = 14 * u;
      ok = lineDist(xy, p.geo.inside) <= tol;
      if (!ok) {
        let near = null, nd = tol;
        GEO.rivers.forEach((rv) => { const d = lineDist(xy, rv.inside); if (d < nd) { nd = d; near = rv; } });
        info = near ? `To je řeka ${near.name}.` : `Vedle – řeka je asi ${Math.round(lineDist(xy, p.geo.inside) * KM_PER_UNIT)} km od místa kliknutí.`;
      }
    } else if (!state.settings.hard) {
      // nejbližší zobrazená značka (značky se mohou překrývat, např. Ještěd a Liberec)
      let q = null, qd = 14 * u;
      gOverlay.querySelectorAll('[data-pid]').forEach((m) => {
        const c = byId(m.dataset.pid);
        const d = c && dist(c.xy, xy);
        if (c && d < qd) { qd = d; q = c; }
      });
      if (!q) { toast('Klikněte na některou ze značek v mapě.'); return; }
      ok = q.id === p.id || (sameName(q.name, p.name) && dist(q.xy, p.xy) < 1);
      if (!ok) info = `To je ${q.name}.`;
    } else {
      const km = dist(xy, p.xy) * KM_PER_UNIT;
      ok = km <= tolKm(p);
      info = ok ? '' : `Vedle o ${Math.round(km)} km.`;
      if (ok) info = `Odchylka ${Math.round(km)} km.`;
    }
    r.answered = { ok, info, click: xy, wrongRegion, wrongArea };
    r.results.push({ p, ok, info });
    renderPanel();
    renderOverlay();
  }
  function nextFind() {
    const r = state.round;
    r.idx++;
    r.answered = null;
    renderPanel();
    renderOverlay();
  }

  function findPanel() {
    const r = state.round;
    const hard = r && r.items.some((x) => x.kind === 'point') ? `<label class="field" style="flex-direction:row;align-items:center;gap:6px;align-self:flex-end;padding-bottom:6px;white-space:nowrap">
      <input type="checkbox" id="setHard" style="width:auto"${state.settings.hard ? ' checked' : ''}> těžší (bez značek)</label>` : '';
    if (!r || !r.items.length) return `<h2>Najdi na mapě</h2>${emptyHTML}`;
    if (r.idx >= r.items.length) return resultsHTML(r, 'Výsledek – Najdi na mapě');
    const p = currentItem(r);
    const okCount = r.results.filter((x) => x.ok).length;
    const how = p.kind === 'region' ? 'Klikněte dovnitř kraje.' : p.kind === 'area' ? 'Klikněte dovnitř území.' : p.kind === 'river' ? 'Klikněte na tok řeky.' : state.settings.hard ? `Klikněte co nejpřesněji (tolerance ${tolKm(p)} km).` : 'Klikněte na správnou značku.';
    let fb = '';
    if (r.answered) {
      fb = `<div class="feedback ${r.answered.ok ? 'ok' : 'bad'}">${r.answered.ok ? 'Správně!' : 'Bohužel špatně.'}
        ${r.answered.info ? `<small>${esc(r.answered.info)}</small>` : ''}${p.note ? `<small>${esc(p.note)}</small>` : ''}<small>${linksHTML(p)}</small></div>
        <div class="row"><button class="btn primary" id="btnNext">${r.idx + 1 < r.items.length ? 'Další' : 'Vyhodnotit'}</button>
        <span class="muted">nebo Enter / klik do mapy</span></div>`;
    }
    return `<h2>Najdi na mapě</h2>
      ${settingsHTML(hard)}
      <div class="progress"><div style="width:${(r.idx / r.items.length) * 100}%"></div></div>
      <p class="muted">Otázka ${r.idx + 1} z ${r.items.length} · správně ${okCount}</p>
      <div class="prompt-cat">${esc(p.category)}</div>
      <div class="prompt">${esc(p.name)}</div>
      <p class="muted">${how}</p>
      ${fb}`;
  }
  function bindFind() {
    const r = state.round;
    if (!r) return;
    if (r.idx >= r.items.length) return bindResults(r);
    bindSettings();
    const n = $('#btnNext');
    if (n) { n.onclick = nextFind; n.focus({ preventScroll: true }); }
  }

  // ======================================================================
  //  Režim: Poznej místo (výběr ze 4 možností)
  // ======================================================================
  function makeOptions(p) {
    const names = new Set([norm(p.name)]);
    const opts = [p.name];
    const pools = [
      state.places.filter((x) => x.category === p.category),
      state.places.filter((x) => x.kind === p.kind),
      state.places,
    ];
    for (const pool of pools) {
      for (const x of shuffle(pool)) {
        if (opts.length >= 4) break;
        if (!names.has(norm(x.name))) { names.add(norm(x.name)); opts.push(x.name); }
      }
    }
    return shuffle(opts);
  }
  function startGuess(items) {
    items = items || pickItems();
    state.round = { type: 'guess', items, idx: 0, results: [], options: items.length ? makeOptions(items[0]) : [], answered: null };
  }
  function renderGuess(u, r) {
    if (r.idx >= r.items.length) return;
    const p = currentItem(r);
    const cls = r.answered ? (r.answered.ok ? 'ok' : 'hl') : 'hl';
    highlight(p, cls);
    if (p.kind === 'point') { drawMarker(p, u, r.answered && r.answered.ok ? 'ok' : 'sel'); pulseAt(p.xy, u); }
    else if (p.kind === 'river') pulseAt(p.xy, u);
    if (r.answered) labelFor(p, u, 'answer');
  }
  function guessPanel() {
    const r = state.round;
    if (!r || !r.items.length) return `<h2>Poznej místo</h2>${emptyHTML}`;
    if (r.idx >= r.items.length) return resultsHTML(r, 'Výsledek – Poznej místo');
    const p = currentItem(r);
    const a = r.answered;
    const opts = r.options.map((o) => {
      let cls = 'btn';
      if (a) { if (sameName(o, p.name)) cls += ' ok'; else if (sameName(o, a.choice)) cls += ' bad'; }
      return `<button class="${cls}" data-opt="${esc(o)}"${a ? ' disabled' : ''}>${esc(o)}</button>`;
    }).join('');
    const what = p.kind === 'region' ? 'Který kraj je zvýrazněn?' : p.kind === 'area' ? 'Které území je zvýrazněno?' : p.kind === 'river' ? 'Která řeka je zvýrazněna?' : 'Co je označeno v mapě?';
    return `<h2>Poznej místo</h2>
      ${settingsHTML()}
      <div class="progress"><div style="width:${(r.idx / r.items.length) * 100}%"></div></div>
      <p class="muted">Otázka ${r.idx + 1} z ${r.items.length} · správně ${r.results.filter((x) => x.ok).length}</p>
      <div class="prompt-cat">${esc(p.category)}</div>
      <div class="prompt" style="font-size:1.2rem">${what}</div>
      <div class="options">${opts}</div>
      ${a ? `<div class="feedback ${a.ok ? 'ok' : 'bad'}">${a.ok ? 'Správně!' : `Špatně – je to ${esc(p.name)}.`}${p.note ? `<small>${esc(p.note)}</small>` : ''}<small>${linksHTML(p)}</small></div>
      <div class="row"><button class="btn primary" id="btnNext">${r.idx + 1 < r.items.length ? 'Další' : 'Vyhodnotit'}</button></div>` : ''}`;
  }
  function bindGuess() {
    const r = state.round;
    if (!r) return;
    if (r.idx >= r.items.length) return bindResults(r);
    bindSettings();
    document.querySelectorAll('[data-opt]').forEach((b) => {
      b.onclick = () => {
        const p = currentItem(r);
        const ok = sameName(b.dataset.opt, p.name);
        r.answered = { ok, choice: b.dataset.opt };
        r.results.push({ p, ok, info: ok ? '' : `odpověď: ${b.dataset.opt}` });
        renderPanel();
        renderOverlay();
      };
    });
    const n = $('#btnNext');
    if (n) {
      n.focus({ preventScroll: true });
      n.onclick = () => {
        r.idx++;
        r.answered = null;
        if (r.idx < r.items.length) r.options = makeOptions(currentItem(r));
        renderPanel();
        renderOverlay();
      };
    }
  }

  // ======================================================================
  //  Režim: Ve kterém kraji? (propojení místa s krajem)
  // ======================================================================
  function startKraj(items) {
    items = items || pickItems((p) => p.kind === 'point' && p.krajId);
    state.round = { type: 'kraj', items, idx: 0, results: [], answered: null };
  }
  function renderKraj(u, r) {
    if (r.idx >= r.items.length) return;
    const p = currentItem(r);
    const a = r.answered;
    if (a) {
      regionEl.get(p.krajId).classList.add('ok');
      if (!a.ok && a.clicked) regionEl.get(a.clicked).classList.add('bad');
    }
    drawMarker(p, u, a && a.ok ? 'ok' : 'sel');
    pulseAt(p.xy, u);
    if (a) labelFor(p, u, 'answer');
  }
  function krajClick(e) {
    const r = state.round;
    if (r.idx >= r.items.length) return;
    if (r.answered) return nextFind();
    const p = currentItem(r);
    const ll = unproject(...clientToMap(e.clientX, e.clientY));
    const reg = GEO.regions.find((x) => inPolys(ll, x.polygons));
    if (!reg) { toast('Klikněte dovnitř některého kraje.'); return; }
    const ok = acceptedRegions(p).has(reg.id);
    const info = ok ? `${p.name} leží v kraji: ${regionName(p.krajId)}.` : `Klikli jste na ${reg.name}, správně je ${regionName(p.krajId)}.`;
    r.answered = { ok, info, clicked: reg.id };
    r.results.push({ p, ok, info });
    renderPanel();
    renderOverlay();
  }
  function krajPanel() {
    const r = state.round;
    if (!r || !r.items.length) return `<h2>Ve kterém kraji?</h2>${emptyHTML}<p class="muted">Tento režim pracuje s místy, která mají souřadnice (města, vrcholy, hrady…).</p>`;
    if (r.idx >= r.items.length) return resultsHTML(r, 'Výsledek – Ve kterém kraji?');
    const p = currentItem(r);
    const a = r.answered;
    return `<h2>Ve kterém kraji?</h2>
      ${settingsHTML()}
      <div class="progress"><div style="width:${(r.idx / r.items.length) * 100}%"></div></div>
      <p class="muted">Otázka ${r.idx + 1} z ${r.items.length} · správně ${r.results.filter((x) => x.ok).length}</p>
      <div class="prompt-cat">${esc(p.category)}</div>
      <div class="prompt">${esc(p.name)}</div>
      <p class="muted">Místo je vyznačeno v mapě. Klikněte na kraj, ve kterém leží.</p>
      ${a ? `<div class="feedback ${a.ok ? 'ok' : 'bad'}">${a.ok ? 'Správně!' : 'Bohužel špatně.'}<small>${esc(a.info)}</small>${p.note ? `<small>${esc(p.note)}</small>` : ''}<small>${linksHTML(p)}</small></div>
      <div class="row"><button class="btn primary" id="btnNext">${r.idx + 1 < r.items.length ? 'Další' : 'Vyhodnotit'}</button>
      <span class="muted">nebo Enter / klik do mapy</span></div>` : ''}`;
  }
  function bindKraj() { bindFind(); }

  // ======================================================================
  //  Režim: Atlas
  // ======================================================================
  function placeAtTarget(target) {
    const mk = target.closest && target.closest('[data-pid]');
    if (mk) return byId(mk.dataset.pid);
    const rv = target.closest && target.closest('[data-river]');
    if (rv) {
      const geo = GEO.rivers.find((x) => x.name === rv.dataset.river);
      return state.places.find((x) => x.kind === 'river' && x.geo === geo) || { name: geo.name, category: 'Řeka', kind: 'river', geo, xy: geo.anchor };
    }
    const ar = target.closest && target.closest('[data-area]');
    if (ar) {
      const geo = GEO.areas.find((x) => x.name === ar.dataset.area);
      return state.places.find((x) => x.kind === 'area' && x.geo === geo) || { name: geo.name, category: 'Chráněné území', kind: 'area', geo, xy: geo.labelXY };
    }
    const rg = target.closest && target.closest('[data-region]');
    if (rg) {
      const geo = GEO.regions.find((x) => x.id === rg.dataset.region);
      return state.places.find((x) => x.kind === 'region' && x.geo === geo) || { name: geo.name, category: 'Kraj', kind: 'region', geo, xy: geo.label };
    }
    return null;
  }
  function detailHTML(p) {
    let rel = '';
    if (p.kind === 'point' && p.krajId) rel = `<p><b>Kraj:</b> ${esc(regionName(p.krajId))}</p>`;
    else if (p.kind === 'river') {
      const through = GEO.regions.filter((r) => p.geo.lines.some((l) => l.some((ll) => inCZ(ll) && inPolys(ll, r.polygons)))).map((r) => r.name);
      if (through.length) rel = `<p><b>Protéká kraji:</b> ${esc(through.join(', '))}</p>`;
    } else if (p.kind === 'area') {
      const kraje = GEO.regions.filter((r) => p.geo.polygons.some((poly) => poly[0].some((ll) => inPolys(ll, r.polygons)))).map((r) => r.name);
      const inside = state.places.filter((x) => x.kind === 'point' && inPolys([x.lon, x.lat], p.geo.polygons));
      rel = (kraje.length ? `<p><b>Kraj:</b> ${esc(kraje.join(', '))}</p>` : '') +
        (inside.length ? `<p><b>Na území leží:</b> ${esc(inside.map((x) => x.name).join(', '))}</p>` : '');
    } else if (p.kind === 'region') {
      const inside = state.places.filter((x) => x.kind === 'point' && x.krajId === p.geo.id);
      const groups = {};
      inside.forEach((x) => (groups[x.category] = groups[x.category] || []).push(x.name));
      rel = Object.entries(groups).map(([c, ns]) => `<p><b>${esc(c)}:</b> ${esc(ns.join(', '))}</p>`).join('') || '<p class="muted">V datech není žádné místo v tomto kraji.</p>';
    }
    return `<div class="detail"><div class="prompt-cat">${esc(p.category)}</div><div class="prompt">${esc(p.name)}</div>
      ${p.note ? `<p>${esc(p.note)}</p>` : ''}${rel}<p>${linksHTML(p)}</p></div>`;
  }

  function atlasPanel() {
    const items = visiblePlaces();
    if (state.sel) return `<h2>Atlas</h2>${detailHTML(state.sel)}<div class="row"><button class="btn" id="btnSelClose">Zpět na přehled</button></div>`;
    const counts = state.cats.filter((c) => state.active.has(c)).map((c) => `<span><b>${state.places.filter((p) => p.category === c).length}</b> ${esc(c)}</span>`).join('');
    return `<h2>Atlas</h2>
      <p>Prohlížení mapy s popisky. Najeďte myší (nebo ťukněte) na místo pro zobrazení názvu.</p>
      <p class="muted">Vypnutím „popisky“ pod mapou z atlasu uděláte slepou mapu pro samostatné opakování – názvy se pak ukazují jen po najetí myší.</p>
      <div class="legend">${counts || 'Žádná sekce není vybrána.'}</div>
      <h3>Jak dál</h3>
      <p class="muted"><b>Přiřazování</b> – přetahování názvů na čísla v mapě.<br>
      <b>Najdi na mapě</b> – aplikace řekne název, žák klikne do mapy.<br>
      <b>Poznej místo</b> – v mapě se zvýrazní místo, žák vybere název.<br>
      <b>Ve kterém kraji?</b> – žák přiřadí město, hrad či vrchol ke kraji.<br>
      <b>Data</b> – nahrání vlastní tabulky z Excelu.</p>
      <p class="muted">Zobrazeno: ${mist(items.length)}. Kliknutím na místo, řeku nebo kraj zobrazíte podrobnosti a odkaz na Mapy.cz.</p>`;
  }

  // ======================================================================
  //  Režim: Data (import / export Excelu, úpravy)
  // ======================================================================
  let xlsxPromise = null;
  function loadXLSX() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    if (!xlsxPromise) {
      xlsxPromise = new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = 'vendor/xlsx.full.min.js';
        s.onload = () => res(window.XLSX);
        s.onerror = () => { xlsxPromise = null; rej(new Error('Knihovnu pro Excel se nepodařilo načíst.')); };
        document.head.appendChild(s);
      });
    }
    return xlsxPromise;
  }

  const HEAD = ['Název', 'Kategorie', 'Zeměpisná šířka', 'Zeměpisná délka', 'Poznámka', 'Kraj', 'Odkaz'];
  const rowOut = (r) => [r.nazev ?? '', r.kategorie ?? '', r.lat ?? '', r.lon ?? '', r.poznamka ?? '', r.kraj ?? '', r.odkaz ?? ''];
  const COLS = [{ wch: 28 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 34 }, { wch: 20 }, { wch: 30 }];

  async function downloadTemplate() {
    const X = await loadXLSX();
    const sample = window.DEFAULT_PLACES.filter((r, i, a) => a.findIndex((x) => x.kategorie === r.kategorie) + 3 > i);
    const ws = X.utils.aoa_to_sheet([HEAD, ...sample.map(rowOut)]);
    ws['!cols'] = COLS;
    const help = [
      ['Návod k vyplnění tabulky pro Slepou mapu ČR'],
      [''],
      ['Každý řádek listu „Místa“ je jedno místo. Sloupce:'],
      ['Název', 'povinný – co mají žáci poznat (např. Brno, Sněžka, Vltava)'],
      ['Kategorie', 'sekce v aplikaci – např. Města, Hory, Vrcholy, Řeky, Kraje, Vodní plochy, nebo vlastní (Hrady, Památky UNESCO…)'],
      ['Zeměpisná šířka', 'desetinné číslo, např. 49.1951 (lze i 49,1951 nebo 49°11′42″)'],
      ['Zeměpisná délka', 'desetinné číslo, např. 16.6068'],
      ['Poznámka', 'nepovinná – zobrazí se po odpovědi (např. nadmořská výška)'],
      ['Kraj', 'nepovinný – kraj, ve kterém místo leží (pro režim „Ve kterém kraji?“). Když chybí, určí se z mapy.'],
      ['Odkaz', 'nepovinný – webová adresa s více informacemi (např. stránka hradu), zobrazí se po odpovědi'],
      [''],
      ['Souřadnice najdete např. na mapy.cz: pravým tlačítkem na místo → „Co je zde?“ → zkopírovat souřadnice.'],
      ['Místo dvou sloupců lze použít i jeden sloupec „Souřadnice“ ve tvaru „49.1951N, 16.6068E“.'],
      [''],
      ['Vlastní sekce: do sloupce Kategorie napište cokoli (Hrady a zámky, Národní parky, Památky UNESCO…).'],
      ['Řeky a kraje nepotřebují souřadnice – stačí název a kategorie (Řeky / Kraje). Aplikace zná tyto:'],
      ['Řeky:', GEO.rivers.map((r) => r.name).join(', ')],
      ['Kraje:', GEO.regions.map((r) => r.name).join(', ')],
      ['Národní parky a CHKO:', GEO.areas.map((a) => a.name).join(', ') + ' (kategorie např. „Národní parky a CHKO“)'],
    ];
    const ws2 = X.utils.aoa_to_sheet(help);
    ws2['!cols'] = [{ wch: 18 }, { wch: 110 }];
    const wb = X.utils.book_new();
    X.utils.book_append_sheet(wb, ws, 'Místa');
    X.utils.book_append_sheet(wb, ws2, 'Návod');
    X.writeFile(wb, 'slepa-mapa-vzor.xlsx');
  }

  // ---------- Sdílení dat odkazem (data jsou zakódovaná přímo v adrese) ----------
  const KEYS = ['nazev', 'kategorie', 'lat', 'lon', 'poznamka', 'kraj', 'odkaz'];
  async function packData(raw) {
    const json = JSON.stringify(raw.map((r) => { const a = KEYS.map((k) => r[k] ?? ''); while (a.length > 2 && a[a.length - 1] === '') a.pop(); return a; }));
    let bytes = new TextEncoder().encode(json), tag = 'j';
    if (window.CompressionStream) {
      bytes = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
      tag = 'z';
    }
    let bin = '';
    bytes.forEach((b) => (bin += String.fromCharCode(b)));
    return tag + btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  async function unpackData(str) {
    const tag = str[0];
    const bin = atob(str.slice(1).replace(/-/g, '+').replace(/_/g, '/'));
    let bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    if (tag === 'z') bytes = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
    const arr = JSON.parse(new TextDecoder().decode(bytes));
    if (!Array.isArray(arr)) throw new Error('neplatná data');
    return arr.filter(Array.isArray).map((a) => {
      const r = {};
      KEYS.forEach((k, i) => { if (a[i] !== '' && a[i] != null) r[k] = typeof a[i] === 'number' ? a[i] : String(a[i]).slice(0, 300); });
      return r;
    });
  }
  async function shareLink() {
    const code = await packData(state.raw);
    const url = location.href.split('#')[0] + '#' + state.mode + '&d=' + code;
    try { await navigator.clipboard.writeText(url); toast('Odkaz zkopírován do schránky (' + Math.round(url.length / 1024 * 10) / 10 + ' kB).', 3500); }
    catch (e) { prompt('Zkopírujte odkaz:', url); }
  }

  async function exportData() {
    const X = await loadXLSX();
    const ws = X.utils.aoa_to_sheet([HEAD, ...state.raw.map(rowOut)]);
    ws['!cols'] = COLS;
    const wb = X.utils.book_new();
    X.utils.book_append_sheet(wb, ws, 'Místa');
    X.writeFile(wb, 'slepa-mapa-data.xlsx');
  }

  // Převod souřadnice v libovolném běžném zápisu na číslo
  function parseCoordPart(s) {
    if (typeof s === 'number') return s;
    s = String(s ?? '').trim();
    if (!s) return NaN;
    const neg = /[SWZ]\s*$|j\.\s*š|z\.\s*d/i.test(s) || /^-/.test(s);
    if (/[°'′’"″”]/.test(s)) {
      const m = s.replace(/,/g, '.').match(/(\d+(?:\.\d+)?)\s*°\s*(?:(\d+(?:\.\d+)?)\s*['′’]\s*)?(?:(\d+(?:\.\d+)?)\s*(?:["″”]|''|′′))?/);
      if (!m) return NaN;
      const v = +m[1] + (+m[2] || 0) / 60 + (+m[3] || 0) / 3600;
      return neg ? -v : v;
    }
    const n = parseFloat(s.replace(',', '.').replace(/[^\d.\-]/g, ''));
    return neg && n > 0 ? -n : n;
  }
  function parseCoordPair(s) {
    s = String(s ?? '').trim();
    if (!s) return [NaN, NaN];
    let parts;
    if (/°/.test(s)) {
      parts = s.match(/-?\d+(?:[.,]\d+)?\s*°[^°]*?(?=\s*-?\d+(?:[.,]\d+)?\s*°|$)/g) || [];
    } else {
      const t = /\./.test(s) ? s : s.replace(/(\d),(\d)/g, '$1.$2');
      parts = t.match(/-?\d+(?:\.\d+)?/g) || [];
    }
    if (parts.length < 2) return [NaN, NaN];
    return [parseCoordPart(parts[0]), parseCoordPart(parts[1])];
  }
  // ČR leží na 48,5–51° s. š. a 12–19° v. d. – prohozené hodnoty opravíme
  function fixOrder(lat, lon) {
    if (lat >= 11 && lat <= 19.5 && lon >= 48 && lon <= 51.5) return [lon, lat];
    return [lat, lon];
  }

  function parseCSV(text) {
    text = text.replace(/^﻿/, '');
    const first = text.split(/\r?\n/)[0] || '';
    const cnt = (ch) => first.split(ch).length - 1;
    const delim = cnt('\t') > 0 ? '\t' : cnt(';') >= cnt(',') ? ';' : ',';
    const rows = [];
    let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c;
      } else if (c === '"') q = true;
      else if (c === delim) { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); rows.push(row); row = []; cell = '';
      } else cell += c;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }

  function detectColumns(rows) {
    const tests = {
      name: (h) => /^(nazev|jmeno|misto|name|objekt|pojem)/.test(h),
      cat: (h) => /^(kategorie|sekce|skupina|category|tema|oblast)/.test(h),
      cat2: (h) => /^(typ|druh)/.test(h),
      lat: (h) => /sirk|^lat|^y$|^n$/.test(h),
      lon: (h) => /delk|^lon|^lng|^x$|^e$/.test(h),
      coords: (h) => /souradnic|gps|poloha|coord/.test(h),
      note: (h) => /poznamk|popis|note|info|vyska/.test(h),
      kraj: (h) => /^kraj/.test(h),
      odkaz: (h) => /odkaz|url|web|link/.test(h),
    };
    for (let ri = 0; ri < Math.min(rows.length, 10); ri++) {
      const heads = rows[ri].map((c) => norm(c));
      const col = {};
      heads.forEach((hd, i) => {
        if (!hd) return;
        for (const k in tests) if (col[k] == null && tests[k](hd)) { col[k] = i; break; }
      });
      if (col.name != null) {
        if (col.cat == null && col.cat2 != null) col.cat = col.cat2;
        return { col, start: ri + 1 };
      }
    }
    return { col: { name: 0, cat: 1, lat: 2, lon: 3, note: 4 }, start: 0 };
  }

  async function importFile(file, mode) {
    let rows;
    try {
      if (/\.(csv|txt)$/i.test(file.name)) {
        rows = parseCSV(await file.text());
      } else {
        const X = await loadXLSX();
        const wb = X.read(await file.arrayBuffer(), { type: 'array' });
        const sheetName = wb.SheetNames.find((n) => norm(n) === 'mista') || wb.SheetNames[0];
        rows = X.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: '', raw: true });
      }
    } catch (err) {
      state.importReport = { error: 'Soubor se nepodařilo přečíst: ' + err.message };
      return renderPanel();
    }
    const { col, start } = detectColumns(rows);
    const added = [], skipped = [];
    for (let i = start; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.every((c) => String(c).trim() === '')) continue;
      const get = (k) => (col[k] != null ? row[col[k]] : '');
      let lat = parseCoordPart(get('lat')), lon = parseCoordPart(get('lon'));
      if (!(isFinite(lat) && isFinite(lon)) && col.coords != null) [lat, lon] = parseCoordPair(get('coords'));
      if (isFinite(lat) && isFinite(lon)) [lat, lon] = fixOrder(lat, lon);
      const rec = { nazev: String(get('name')).trim(), kategorie: String(get('cat')).trim() || 'Ostatní' };
      if (isFinite(lat) && isFinite(lon)) { rec.lat = Math.round(lat * 1e5) / 1e5; rec.lon = Math.round(lon * 1e5) / 1e5; }
      const note = String(get('note') ?? '').trim();
      if (note) rec.poznamka = note;
      const kraj = String(get('kraj') ?? '').trim();
      if (kraj) rec.kraj = kraj;
      const odkaz = String(get('odkaz') ?? '').trim();
      if (odkaz) rec.odkaz = odkaz;
      const res = buildPlace(rec, 0);
      if (res.error) skipped.push({ row: i + 1, name: rec.nazev, reason: res.error });
      else added.push(rec);
    }
    if (!added.length) {
      state.importReport = { error: 'V souboru nebyl nalezen žádný použitelný řádek.', skipped };
      return renderPanel();
    }
    setData(mode === 'append' ? state.raw.concat(added) : added, true);
    state.active = new Set(state.cats);
    state.importReport = { file: file.name, count: added.length, skipped, mode };
    save();
    renderCats();
    renderPanel();
    renderOverlay();
  }

  function dataPanel() {
    const rep = state.importReport;
    let repHTML = '';
    if (rep) {
      if (rep.error) repHTML = `<div class="report"><b class="warn">${esc(rep.error)}</b>`;
      else repHTML = `<div class="report">Ze souboru <b>${esc(rep.file)}</b> ${rep.mode === 'append' ? 'přidáno' : 'načteno'} <b>${mist(rep.count)}</b>.`;
      if (rep.skipped && rep.skipped.length) {
        repHTML += `<div class="warn">Přeskočeno ${plural(rep.skipped.length, 'řádek', 'řádky', 'řádků')}:</div><ul>` +
          rep.skipped.slice(0, 100).map((s) => `<li>řádek ${s.row}${s.name ? ` (${esc(s.name)})` : ''}: ${esc(s.reason)}</li>`).join('') + '</ul>';
      }
      repHTML += '</div>';
    }
    const cats = state.cats.map((c) => `<option value="${esc(c)}">`).join('');
    const filter = norm($('#dataFilter') ? $('#dataFilter').value : '');
    const rows = state.raw.map((r, i) => ({ r, i })).filter(({ r }) => !filter || norm(r.nazev + ' ' + r.kategorie).includes(filter));
    const placed = new Set(state.places.map((p) => p.ri));
    const table = rows.map(({ r, i }) => {
      const where = isFinite(toNum(r.lat)) ? `${(+toNum(r.lat)).toFixed(3)}, ${(+toNum(r.lon)).toFixed(3)}` : placed.has(i) ? '<span class="muted">z mapy</span>' : '<span class="warn">nelze umístit</span>';
      return `<tr><td>${esc(r.nazev)}</td><td>${esc(r.kategorie)}</td><td>${where}</td><td class="x"><button data-del="${i}" title="Smazat" aria-label="Smazat ${esc(r.nazev)}">×</button></td></tr>`;
    }).join('');
    return `<h2>Data</h2>
      <p class="muted">${state.custom ? 'Používáte <b>vlastní data</b>' : 'Používáte <b>výchozí sadu</b>'} – ${mist(state.places.length)} v ${plural(state.cats.length, 'sekci', 'sekcích', 'sekcích')}. Data se ukládají jen v tomto prohlížeči.</p>
      <h3>Nahrát tabulku z Excelu</h3>
      <p class="muted">Formát: sloupce <i>Název, Kategorie, Zeměpisná šířka, Zeměpisná délka</i>, nepovinně <i>Poznámka, Kraj, Odkaz</i>. Kategorie může být libovolná (např. Hrady a zámky). Podporováno .xlsx, .xls, .ods a .csv. Řekám a krajům stačí název.</p>
      <div class="row">
        <select class="inline" id="impMode"><option value="replace">nahradit současná data</option><option value="append">přidat k současným</option></select>
        <button class="btn primary" id="btnImport">Vybrat soubor…</button>
      </div>
      ${repHTML}
      <div class="row">
        <button class="btn" id="btnTemplate">Stáhnout vzorovou tabulku</button>
        <button class="btn" id="btnExport">Exportovat do Excelu</button>
        <button class="btn" id="btnShare" title="Odkaz obsahuje aktuální data – žáci je po otevření uvidí bez nahrávání souboru">Zkopírovat odkaz pro žáky</button>
        ${state.custom ? '<button class="btn danger" id="btnReset">Obnovit výchozí data</button>' : ''}
      </div>
      <h3>Přidat místo kliknutím do mapy</h3>
      <form id="addForm" class="grid2">
        <label class="field">Název<input name="nazev" required maxlength="80"></label>
        <label class="field">Kategorie<input name="kategorie" list="catList" required maxlength="40" value="Města"></label>
        <label class="field wide">Poznámka (nepovinná)<input name="poznamka" maxlength="200"></label>
        <datalist id="catList">${cats}</datalist>
        <div class="wide row" style="margin:0"><button class="btn primary">${state.pick ? 'Klikněte do mapy…' : 'Umístit do mapy'}</button>
        ${state.pick ? '<button type="button" class="btn" id="btnPickCancel">Zrušit</button>' : ''}</div>
      </form>
      <h3>Seznam míst</h3>
      <input id="dataFilter" class="field" style="width:100%;margin-bottom:6px;border:1px solid var(--line);border-radius:7px;padding:6px 8px" placeholder="Hledat…" value="${esc($('#dataFilter') ? $('#dataFilter').value : '')}">
      <div class="table-wrap"><table class="data"><thead><tr><th>Název</th><th>Kategorie</th><th>Poloha</th><th></th></tr></thead><tbody>${table}</tbody></table></div>`;
  }
  function bindData() {
    const fi = $('#fileInput');
    $('#btnImport').onclick = () => { fi.value = ''; fi.click(); };
    fi.onchange = () => { if (fi.files[0]) importFile(fi.files[0], $('#impMode').value); };
    const err = (e) => toast(e.message || String(e), 4000);
    $('#btnTemplate').onclick = () => downloadTemplate().catch(err);
    $('#btnExport').onclick = () => exportData().catch(err);
    $('#btnShare').onclick = () => shareLink().catch(err);
    const rs = $('#btnReset');
    if (rs) rs.onclick = () => {
      if (!confirm('Opravdu smazat vlastní data a vrátit výchozí sadu míst?')) return;
      setData(window.DEFAULT_PLACES, false);
      state.active = new Set(state.cats);
      state.importReport = null;
      save(); renderCats(); renderPanel(); renderOverlay();
    };
    $('#addForm').onsubmit = (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      state.pick = { nazev: String(f.get('nazev')).trim(), kategorie: String(f.get('kategorie')).trim(), poznamka: String(f.get('poznamka')).trim() };
      if (!state.pick.nazev) { state.pick = null; return; }
      toast('Klikněte do mapy na místo „' + state.pick.nazev + '“.', 3000);
      renderPanel(); renderOverlay();
    };
    const pc = $('#btnPickCancel');
    if (pc) pc.onclick = () => { state.pick = null; renderPanel(); renderOverlay(); };
    const df = $('#dataFilter');
    df.oninput = () => {
      const pos = df.selectionStart;
      renderPanel();
      const n = $('#dataFilter'); n.focus(); n.setSelectionRange(pos, pos);
    };
    document.querySelectorAll('[data-del]').forEach((b) => {
      b.onclick = () => {
        const i = +b.dataset.del;
        const raw = state.raw.slice();
        raw.splice(i, 1);
        setData(raw, true);
        save(); renderCats(); renderPanel(); renderOverlay();
      };
    });
  }
  function pickClick(e) {
    const [x, y] = clientToMap(e.clientX, e.clientY);
    const [lon, lat] = unproject(x, y);
    const rec = { ...state.pick, lat: Math.round(lat * 1e4) / 1e4, lon: Math.round(lon * 1e4) / 1e4 };
    if (!rec.poznamka) delete rec.poznamka;
    state.pick = null;
    setData(state.raw.concat([rec]), true);
    state.active.add(rec.kategorie);
    save(); renderCats(); renderPanel(); renderOverlay();
    toast(`Přidáno: ${rec.nazev} (${rec.lat}, ${rec.lon})`);
  }

  // ======================================================================
  //  Kliknutí do mapy
  // ======================================================================
  function onMapClick(e, target) {
    if (state.mode === 'data' && state.pick) return pickClick(e);
    const r = state.round;
    if (state.mode === 'find' && r) return findClick(e, target);
    if (state.mode === 'assign' && r && !r.checked) {
      const t = target.closest && target.closest('[data-target]');
      if (!t) return;
      const idx = +t.dataset.target;
      if (r.selected != null) placeCard(idx, r.selected);
      else if (r.placed.has(idx)) { r.placed.delete(idx); renderPanel(); renderOverlay(); }
      else toast('Nejdříve vyberte nebo přetáhněte název ze seznamu.');
      return;
    }
    if (state.mode === 'kraj' && r) return krajClick(e);
    if (state.mode === 'atlas') {
      state.sel = placeAtTarget(target);
      renderPanel();
      renderOverlay();
      return;
    }
    if (state.mode === 'data') hover({ target, clientX: e.clientX, clientY: e.clientY });
  }

  // ======================================================================
  //  Sekce (kategorie) a režimy
  // ======================================================================
  function renderCats() {
    const box = $('#cats');
    const all = state.cats.every((c) => state.active.has(c));
    box.innerHTML = `<button class="chip all" data-cat="*" aria-pressed="${all}">Vše</button>` +
      state.cats.map((c) => `<button class="chip" data-cat="${esc(c)}" aria-pressed="${state.active.has(c)}" style="--c:${state.catColor[c]}">
        <span class="dot"></span>${esc(c)}<span class="n">${state.places.filter((p) => p.category === c).length}</span></button>`).join('');
    box.querySelectorAll('[data-cat]').forEach((b) => {
      b.onclick = (e) => {
        const c = b.dataset.cat;
        // „Vše“ zapne vše; když je zapnuto vše, klik vybere jen danou sekci; jinak klik sekci přidá/odebere
        if (c === '*') state.active = new Set(state.cats);
        else if (all) state.active = new Set([c]);
        else if (state.active.has(c)) state.active.delete(c);
        else state.active.add(c);
        if (!state.active.size) state.active = new Set(state.cats);
        save();
        renderCats();
        if (QUIZ_MODES.includes(state.mode)) startRound();
        else { renderPanel(); renderOverlay(); }
      };
    });
  }

  function setMode(m) {
    state.mode = m;
    state.pick = null;
    document.querySelectorAll('#modes [data-mode]').forEach((b) => b.setAttribute('aria-selected', b.dataset.mode === m));
    $('#optLabelsWrap').style.display = m === 'atlas' || m === 'data' ? '' : 'none';
    try { history.replaceState(null, '', '#' + m); } catch (e) { /* file:// */ }
    state.sel = null;
    if (QUIZ_MODES.includes(m)) startRound();
    else { state.round = null; renderPanel(); renderOverlay(); }
  }

  function renderPanel() {
    const panel = $('#panel');
    const m = state.mode;
    if (m === 'atlas') {
      panel.innerHTML = atlasPanel();
      const c = $('#btnSelClose');
      if (c) c.onclick = () => { state.sel = null; renderPanel(); renderOverlay(); };
    }
    else if (m === 'assign') { panel.innerHTML = assignPanel(); bindAssign(); }
    else if (m === 'find') { panel.innerHTML = findPanel(); bindFind(); }
    else if (m === 'guess') { panel.innerHTML = guessPanel(); bindGuess(); }
    else if (m === 'kraj') { panel.innerHTML = krajPanel(); bindKraj(); }
    else if (m === 'data') { panel.innerHTML = dataPanel(); bindData(); }
  }

  document.querySelectorAll('#modes [data-mode]').forEach((b) => (b.onclick = () => setMode(b.dataset.mode)));
  const optRegions = $('#optRegions'), optLabels = $('#optLabels');
  optRegions.onchange = () => { state.settings.regions = optRegions.checked; save(); renderOverlay(); };
  optLabels.onchange = () => { state.settings.labels = optLabels.checked; save(); renderOverlay(); };
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || /INPUT|SELECT|TEXTAREA|BUTTON/.test(document.activeElement.tagName)) return;
    const n = $('#btnNext');
    if (n) n.click();
  });

  // ======================================================================
  //  Start
  // ======================================================================
  load();
  optRegions.checked = state.settings.regions;
  optLabels.checked = state.settings.labels;
  buildBaseMap();
  renderCats();
  const hashParts = (location.hash || '').slice(1).split('&');
  const initial = hashParts[0];
  const shared = (hashParts.find((x) => x.startsWith('d=')) || '').slice(2);
  setMode(ALL_MODES.includes(initial) ? initial : 'atlas');
  if (shared) {
    unpackData(shared).then((raw) => {
      if (state.custom && !confirm('Odkaz obsahuje sadu míst. Nahradit jí vaše vlastní data v tomto prohlížeči?')) return;
      setData(raw, true);
      state.active = new Set(state.cats);
      save();
      renderCats();
      setMode(state.mode);
      toast(`Načtena data z odkazu: ${mist(state.places.length)}.`, 3500);
    }).catch(() => toast('Data v odkazu se nepodařilo přečíst.', 3500));
  }
  // Testovací háček (používá automatický test)
  window.__slepaMapa = { state, project, unproject, acceptedRegions, regionLabel: (id) => GEO.regions.find((r) => r.id === id).label, parseCoordPair, parseCoordPart, detectColumns, parseCSV, mapToClient };
})();
