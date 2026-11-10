/* HydraSense logic - pure functions (no DOM, no Firebase). Runs in the browser and in node tests.
 *
 * A "measurement" looks like:
 *   { device, ts (unix seconds), lat, lon, ph, tds, temp, turb,
 *     flags?, batt?, stable?, calDays?, sats?, test?, tan? }
 */

export const PARAMS = {
  ph:   { label: 'pH',          unit: '',    ideal: [6.8, 7.8], ok: [6.5, 8.5], w: 0.25, dec: 2 },
  tds:  { label: 'TDS',         unit: 'ppm', ideal: [0, 300],   ok: [0, 500],   w: 0.30, dec: 0 },
  turb: { label: 'Turbidity',   unit: 'NTU', ideal: [0, 1],     ok: [0, 5],     w: 0.30, dec: 1 },
  temp: { label: 'Temperature', unit: '°C',  ideal: [18, 30],   ok: [10, 35],   w: 0.15, dec: 1 },
};

const CURVES = {
  ph:   [[4, 0], [5.5, 30], [6.5, 80], [6.8, 100], [7.8, 100], [8.5, 80], [9.5, 30], [11, 0]],
  tds:  [[0, 100], [300, 100], [500, 80], [900, 50], [1200, 30], [2000, 0]],
  turb: [[0, 100], [1, 100], [5, 80], [10, 60], [25, 30], [100, 0]],
  temp: [[0, 40], [10, 70], [18, 100], [30, 100], [35, 70], [40, 30], [45, 0]],
};

export const CATEGORIES = [
  { min: 90, name: 'Excellent', color: '#1a9850' },
  { min: 70, name: 'Good',      color: '#91cf60' },
  { min: 50, name: 'Fair',      color: '#fdae61' },
  { min: 25, name: 'Poor',      color: '#f46d43' },
  { min: 0,  name: 'Very Poor', color: '#a50026' },
];

export function interp(x, pts) {
  if (x <= pts[0][0]) return pts[0][1];
  if (x >= pts[pts.length - 1][0]) return pts[pts.length - 1][1];
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
    if (x >= x0 && x <= x1) return y0 + (y1 - y0) * (x - x0) / (x1 - x0);
  }
  return 0;
}

export function subIndices(m) {
  const out = {};
  for (const k of Object.keys(PARAMS)) out[k] = Math.round(interp(m[k], CURVES[k]) * 10) / 10;
  return out;
}

export function wqi(m) {
  const s = subIndices(m);
  let t = 0;
  for (const k of Object.keys(PARAMS)) t += PARAMS[k].w * s[k];
  return Math.round(t * 10) / 10;
}

export function category(score) {
  return CATEGORIES.find(c => score >= c.min) || CATEGORIES[CATEGORIES.length - 1];
}

export function paramStatus(k, v) {
  const p = PARAMS[k];
  if (v >= p.ideal[0] && v <= p.ideal[1]) return 'ideal';
  if (v >= p.ok[0] && v <= p.ok[1]) return 'acceptable';
  return 'out_of_range';
}

/* ------------------------------------------------------------------ estimates */
// Oxygen saturation of fresh water at sea level (mg/L), Benson & Krause / APHA Standard Methods equation.
export function doSaturation(tC) {
  const T = tC + 273.15;
  const lnC = -139.34411 + 1.575701e5 / T - 6.642308e7 / (T ** 2) + 1.243800e10 / (T ** 3) - 8.621949e11 / (T ** 4);
  return Math.exp(lnC);
}

// Fraction of total ammonia nitrogen present as toxic un-ionised NH3 (Emerson et al., 1975).
export function ammoniaFraction(ph, tC) {
  const T = tC + 273.15;
  const pKa = 0.09018 + 2729.92 / T;
  return 1 / (1 + Math.pow(10, pKa - ph));
}

const lvl3 = (pts, lo, hi) => (pts <= lo ? 'Low' : pts <= hi ? 'Medium' : 'High');

export function estimates(m, opts = {}) {
  const k = opts.hardnessK || 0.45;
  const calibrated = !!opts.hardnessCalibrated;

  // salinity
  const sal = m.tds / 1000;
  const salClass = sal < 0.5 ? 'Fresh' : sal < 3 ? 'Low-brackish' : 'Brackish';

  // oxygen
  const sat = doSaturation(m.temp);
  const reasons = [];
  let pts = 0;
  if (m.temp > 33) { pts += 2; reasons.push('very warm water holds less oxygen'); }
  else if (m.temp > 30) { pts += 1; reasons.push('warm water holds less oxygen'); }
  if (m.turb > 50) { pts += 2; reasons.push('very turbid (plankton/organic load uses oxygen)'); }
  else if (m.turb > 25) { pts += 1; reasons.push('turbid water (plankton/organic load)'); }
  if (m.ph > 9) { pts += 2; reasons.push('very high pH suggests heavy algae (night-time oxygen crash risk)'); }
  else if (m.ph > 8.6) { pts += 1; reasons.push('high pH suggests algae activity'); }
  else if (m.ph < 6.5) { pts += 1; reasons.push('low pH (decay / organic acids)'); }

  // ammonia
  const frac = ammoniaFraction(m.ph, m.temp);
  const fracLevel = frac < 0.02 ? 'Low' : frac < 0.10 ? 'Moderate' : 'High';
  let op = 0;
  const oreasons = [];
  if (m.turb > 50) { op += 2; oreasons.push('very turbid'); } else if (m.turb > 25) { op += 1; oreasons.push('turbid'); }
  if (m.tds > 600) { op += 1; oreasons.push('high dissolved solids'); }
  if (m.temp > 30) { op += 1; oreasons.push('warm water speeds decay'); }
  const nh3 = { fraction: frac, fractionPct: Math.round(frac * 1000) / 10, fractionLevel: fracLevel,
                organicLoad: lvl3(op, 1, 3), organicReasons: oreasons };
  if (typeof m.tan === 'number' && isFinite(m.tan)) {
    nh3.tan = m.tan;
    nh3.nh3mgL = Math.round(m.tan * frac * 1000) / 1000;
    nh3.nh3Status = nh3.nh3mgL <= 0.02 ? 'ok' : nh3.nh3mgL <= 0.05 ? 'warning' : 'danger';
  }

  // hardness (rough, from TDS) - USGS classes in mg/L as CaCO3
  const mid = m.tds * k;
  const lo = calibrated ? mid * 0.85 : m.tds * 0.3;
  const hi = calibrated ? mid * 1.15 : m.tds * 0.6;
  const hClass = mid < 60 ? 'Soft' : mid <= 120 ? 'Moderately hard' : mid <= 180 ? 'Hard' : 'Very hard';

  return {
    salinity: { ppt: Math.round(sal * 100) / 100, cls: salClass, outOfSensorRange: m.tds >= 950 },
    oxygen: { saturationMgL: Math.round(sat * 100) / 100, risk: lvl3(pts, 1, 3), points: pts, reasons },
    ammonia: nh3,
    hardness: { mid: Math.round(mid), low: Math.round(lo), high: Math.round(hi), cls: hClass, calibrated,
                lowForFish: mid < 40 },
  };
}

/* ------------------------------------------------------------------ fish (indicative ranges) */
/* Ranges are indicative screening values gathered from FAO / ICAR / aquaculture literature
 * (see docs/SOURCES.md). opt = good, tol = tolerable (marginal). Turbidity in NTU is an
 * approximation of the Secchi-depth guidance (ICAR: 40-60 cm optimum visibility). */
export const FISH = [
  { id: 'rohu',   name: 'Rohu',        sci: 'Labeo rohita',
    ph: { opt: [7, 8.5], tol: [6.5, 9] },   temp: { opt: [25, 32], tol: [20, 36] },
    turb: { opt: 30, tol: 80 },  tds: { opt: 1000, tol: 2000 } },
  { id: 'catla',  name: 'Catla',       sci: 'Catla catla',
    ph: { opt: [7, 8.5], tol: [6.5, 9] },   temp: { opt: [25, 32], tol: [20, 36] },
    turb: { opt: 30, tol: 80 },  tds: { opt: 1000, tol: 2000 } },
  { id: 'carp',   name: 'Common carp', sci: 'Cyprinus carpio',
    ph: { opt: [6.5, 8.5], tol: [5.5, 9.5] }, temp: { opt: [20, 30], tol: [10, 35] },
    turb: { opt: 50, tol: 100 }, tds: { opt: 1000, tol: 2000 } },
  { id: 'tilapia', name: 'Tilapia',    sci: 'Oreochromis niloticus',
    ph: { opt: [6.5, 8.5], tol: [5.5, 9.5] }, temp: { opt: [25, 32], tol: [18, 35] },
    turb: { opt: 50, tol: 100 }, tds: { opt: 1000, tol: 2000 } },
  { id: 'pangasius', name: 'Pangasius', sci: 'Pangasianodon hypophthalmus',
    ph: { opt: [6.5, 8.5], tol: [5.5, 9.5] }, temp: { opt: [26, 31], tol: [20, 34] },
    turb: { opt: 50, tol: 100 }, tds: { opt: 1000, tol: 2000 } },
];

const rateRange = (v, r) => (v >= r.opt[0] && v <= r.opt[1] ? 'good' : v >= r.tol[0] && v <= r.tol[1] ? 'marginal' : 'bad');
const rateMax = (v, r) => (v <= r.opt ? 'good' : v <= r.tol ? 'marginal' : 'bad');

export function evaluateFish(m, est) {
  const res = FISH.map(f => {
    const rates = { ph: rateRange(m.ph, f.ph), temp: rateRange(m.temp, f.temp), turb: rateMax(m.turb, f.turb), tds: rateMax(m.tds, f.tds) };
    const bad = Object.keys(rates).filter(k => rates[k] === 'bad');
    const marg = Object.keys(rates).filter(k => rates[k] === 'marginal');
    let level = bad.length ? 'Not suitable' : marg.length ? 'Marginal' : 'Suitable';
    const reasons = [
      ...bad.map(k => `${PARAMS[k].label} ${fmt(k, m[k])} is outside the tolerable range`),
      ...marg.map(k => `${PARAMS[k].label} ${fmt(k, m[k])} is tolerable but not ideal`),
    ];
    const notes = [];
    if (level !== 'Not suitable' && est) {
      if (est.oxygen.risk === 'High') { notes.push('Estimated oxygen risk is high - check dissolved oxygen before stocking'); if (level === 'Suitable') level = 'Marginal'; }
      if (est.ammonia.fractionLevel === 'High') { notes.push('At this pH/temperature most ammonia would be the toxic form - test ammonia'); if (level === 'Suitable') level = 'Marginal'; }
      if (est.hardness.lowForFish) notes.push('Estimated hardness may be below 40 mg/L - consider liming');
    }
    return { id: f.id, name: f.name, sci: f.sci, level, reasons, notes, rates };
  });
  const order = { 'Suitable': 0, 'Marginal': 1, 'Not suitable': 2 };
  return res.sort((a, b) => order[a.level] - order[b.level]);
}

export function fmt(k, v) {
  const p = PARAMS[k];
  return Number(v).toFixed(p.dec) + (p.unit ? ' ' + p.unit : '');
}

/* ------------------------------------------------------------------ use classes A-E */
export const CLASS_INFO = {
  A: { title: 'Class A - Drinking-water screen', short: 'Drinking (screen)' },
  B: { title: 'Class B - Irrigation / agriculture', short: 'Irrigation' },
  C: { title: 'Class C - Fish culture', short: 'Fish culture' },
  D: { title: 'Class D - Industrial / cooling only', short: 'Industrial' },
  E: { title: 'Class E - Polluted / drain-like', short: 'Polluted' },
};

export function useClasses(m, score, fish) {
  const A = m.ph >= 6.5 && m.ph <= 8.5 && m.tds <= 500 && m.turb <= 5;
  const B = m.ph >= 6.0 && m.ph <= 8.5 && m.tds <= 2000;
  const C = fish.some(f => f.level === 'Suitable' || f.level === 'Marginal');
  const D = score >= 25 && m.ph >= 5.5 && m.ph <= 9.5 && m.tds <= 2000 && m.turb <= 100 && m.temp <= 45;
  const notes = {
    A: A ? (m.turb > 1 ? 'Passes basic screen (turbidity above the 1 NTU WHO preference). Lab test for germs/metals still needed.' : 'Passes the 4-parameter screen. Germs, nitrate, metals need a lab test.') : 'Fails the screen (pH 6.5-8.5, TDS up to 500 ppm, turbidity up to 5 NTU).',
    B: B ? (m.tds < 450 ? 'No salinity restriction for most crops.' : 'Slight-to-moderate salinity restriction for sensitive crops.') : 'pH or salinity unsuitable for irrigation.',
    C: C ? 'At least one local species fits (see fish list).' : 'No listed species fits these readings.',
    D: D ? 'Usable for cooling/washing/process water after checks.' : 'Too contaminated even for industrial reuse.',
  };
  const passed = { A, B, C, D };
  let overall;
  if (A) overall = 'A';
  else if (B || C) overall = B && C ? 'BC' : B ? 'B' : 'C';
  else if (D) overall = 'D';
  else overall = 'E';
  return { passed, notes, overall };
}

export function overallLabel(code) {
  if (code === 'BC') return 'Class B/C - Irrigation and fish culture';
  return CLASS_INFO[code].title;
}

/* ------------------------------------------------------------------ confidence */
export function confidence(m) {
  let c = 100;
  const notes = [];
  const f = m.flags | 0;
  const names = { 1: 'pH probe unstable/disconnected', 2: 'TDS probe unstable/disconnected', 4: 'Turbidity probe unstable/disconnected', 8: 'Temperature sensor missing' };
  for (const bit of [1, 2, 4, 8]) if (f & bit) { c -= 25; notes.push(names[bit]); }
  if (f & 16) { c -= 10; notes.push('Weak GPS fix (location may be old)'); }
  if (m.stable === false) { c -= 20; notes.push('Readings had not fully settled'); }
  if (typeof m.calDays === 'number') {
    if (m.calDays > 60) { c -= 20; notes.push('Calibration is more than 60 days old'); }
    else if (m.calDays > 30) { c -= 10; notes.push('Calibration is more than 30 days old'); }
  }
  if (typeof m.sats === 'number' && m.sats < 4) { c -= 10; notes.push('Few GPS satellites'); }
  if (typeof m.batt === 'number' && m.batt < 3.5) { c -= 5; notes.push('Low battery'); }
  if (m.temp < -1 || m.temp > 60 || m.ph < 0 || m.ph > 14 || m.tds < 0 || m.turb < 0) { c -= 30; notes.push('Reading outside physical range'); }
  c = Math.max(0, c);
  return { score: c, level: c >= 80 ? 'High' : c >= 50 ? 'Medium' : 'Low', notes };
}

/* ------------------------------------------------------------------ full assessment */
export function assess(m, opts = {}) {
  const score = wqi(m);
  const cat = category(score);
  const est = estimates(m, opts);
  const fish = evaluateFish(m, est);
  const classes = useClasses(m, score, fish);
  return {
    wqi: score, category: cat, sub: subIndices(m),
    status: Object.fromEntries(Object.keys(PARAMS).map(k => [k, paramStatus(k, m[k])])),
    est, fish, classes, confidence: confidence(m),
  };
}

/* ------------------------------------------------------------------ spots (50 m) */
export function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000, r = Math.PI / 180;
  const dLat = (lat2 - lat1) * r, dLon = (lon2 - lon1) * r;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export const hasGps = m => !(Math.abs(m.lat) < 1e-6 && Math.abs(m.lon) < 1e-6);

export function clusterSpots(measurements, radiusM = 50) {
  const list = measurements.filter(hasGps).slice().sort((a, b) => a.ts - b.ts);
  const spots = [];
  for (const m of list) {
    let best = null, bd = Infinity;
    for (const s of spots) {
      const d = haversine(s.anchor.lat, s.anchor.lon, m.lat, m.lon);
      if (d <= radiusM && d < bd) { best = s; bd = d; }
    }
    if (!best) {
      best = { id: `${m.lat.toFixed(4)}_${m.lon.toFixed(4)}`.replace(/\./g, 'd').replace(/-/g, 'm'), anchor: { lat: m.lat, lon: m.lon }, items: [] };
      spots.push(best);
    }
    best.items.push(m);
  }
  for (const s of spots) {
    s.latest = s.items[s.items.length - 1];
    s.lat = s.latest.lat; s.lon = s.latest.lon;
  }
  return spots;
}

/* ------------------------------------------------------------------ alerts */
const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
const sd = a => { const mu = mean(a); return Math.sqrt(mean(a.map(x => (x - mu) ** 2))); };

export function alertsForMeasurement(m, history, opts = {}) {
  const out = [];
  const add = (severity, kind, msg) => out.push({ ts: m.ts, severity, kind, msg });
  const conf = confidence(m);
  if (conf.level === 'Low') { add('info', 'confidence', 'Low-confidence reading - alerts suppressed (' + conf.notes.join(', ') + ')'); return out; }
  if (m.ph < 6 || m.ph > 9) add('critical', 'ph', `pH ${m.ph.toFixed(2)} is dangerous`);
  else if (m.ph < 6.5 || m.ph > 8.5) add('warning', 'ph', `pH ${m.ph.toFixed(2)} is outside 6.5-8.5`);
  if (m.tds > 1000) add('critical', 'tds', `TDS ${Math.round(m.tds)} ppm is very high`);
  else if (m.tds > 500) add('warning', 'tds', `TDS ${Math.round(m.tds)} ppm is above 500`);
  if (m.turb > 25) add('critical', 'turb', `Turbidity ${m.turb.toFixed(1)} NTU is very high`);
  else if (m.turb > 5) add('warning', 'turb', `Turbidity ${m.turb.toFixed(1)} NTU is above 5`);
  if (m.temp > 35 || m.temp < 5) add('warning', 'temp', `Temperature ${m.temp.toFixed(1)} °C is outside the safe band`);
  const score = wqi(m);
  if (score < 25) add('critical', 'wqi', `WQI ${score} - Very Poor`);
  else if (score < 50) add('warning', 'wqi', `WQI ${score} - Poor`);
  // change against this spot's own history
  const prev = history.filter(h => h.ts < m.ts);
  if (prev.length >= 3) {
    const last = prev.slice(-5).map(wqi);
    const drop = mean(last) - score;
    if (drop >= 15) add('critical', 'drop', `WQI fell ${Math.round(drop)} points compared with earlier visits - possible pollution event`);
  }
  if (prev.length >= 5) {
    const floors = { ph: 0.1, tds: 10, temp: 0.5, turb: 0.5 };
    for (const k of Object.keys(PARAMS)) {
      const h = prev.slice(-30).map(x => x[k]);
      const s = Math.max(sd(h), floors[k]);
      const z = (m[k] - mean(h)) / s;
      if (Math.abs(z) > 3) add('warning', 'anomaly', `${PARAMS[k].label} is unusual for this spot (z=${z > 0 ? '+' : ''}${z.toFixed(1)})`);
    }
  }
  const est = estimates(m, opts);
  if (est.oxygen.risk === 'High') add('warning', 'oxygen', 'Estimated oxygen risk is high');
  if (est.ammonia.nh3Status === 'danger') add('critical', 'ammonia', `Ammonia (toxic form) about ${est.ammonia.nh3mgL} mg/L`);
  return out;
}

export function alertsForSpot(spot, opts = {}) {
  const res = [];
  spot.items.forEach((m, i) => {
    for (const a of alertsForMeasurement(m, spot.items.slice(0, i), opts)) res.push({ ...a, spotId: spot.id, device: m.device });
  });
  return res;
}

export function timeAgo(ts, now = Date.now() / 1000) {
  const s = Math.max(0, now - ts);
  if (s < 90) return 'just now';
  if (s < 3600) return Math.round(s / 60) + ' min ago';
  if (s < 86400) return Math.round(s / 3600) + ' h ago';
  return Math.round(s / 86400) + ' days ago';
}
