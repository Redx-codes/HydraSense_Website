// Data layer: reads Firebase Realtime Database (live), or generates demo data with ?demo=1
import { firebaseConfig, DB_ROOT, FIREBASE_VER } from './firebase-config.js';

export const isDemo = new URLSearchParams(location.search).has('demo');

export function demoData() {
  const now = Math.floor(Date.now() / 1000), day = 86400, out = [];
  const spots = [
    { lat: 22.5760, lon: 88.3600, base: { ph: 7.5, tds: 240, temp: 27, turb: 2.0 } },   // clean lake north ghat
    { lat: 22.5726, lon: 88.3665, base: { ph: 7.9, tds: 480, temp: 29, turb: 14 } },    // fish pond
    { lat: 22.5690, lon: 88.3610, base: { ph: 7.2, tds: 330, temp: 28, turb: 4 } },     // lake south (gets polluted)
    { lat: 22.5800, lon: 88.3700, base: { ph: 6.3, tds: 1500, temp: 33, turb: 70 } },   // drain outlet
  ];
  spots.forEach((s, si) => {
    const visits = si === 3 ? 3 : 7;
    for (let v = 0; v < visits; v++) {
      const ts = now - (visits - v) * 2 * day - si * 3600;
      const j = () => (Math.sin(v * 7 + si * 3) * 0.5);
      const polluted = si === 2 && v === visits - 1;
      out.push({
        id: `demo-${si}-${v}`, device: 'HS-001', ts,
        lat: s.lat + (Math.sin(v + si) * 0.00015), lon: s.lon + (Math.cos(v + si) * 0.00015),
        ph: +(s.base.ph + j() * 0.3 - (polluted ? 1.6 : 0)).toFixed(2),
        tds: Math.round(s.base.tds * (1 + j() * 0.05) * (polluted ? 2.6 : 1)),
        temp: +(s.base.temp + j()).toFixed(1),
        turb: +(s.base.turb * (1 + j() * 0.1) * (polluted ? 6 : 1)).toFixed(1),
        flags: 0, stable: true, calDays: 12, sats: 8, batt: 3.9,
      });
    }
  });
  return out;
}

function clean(id, v) {
  const m = { id, ...v };
  for (const k of ['ts', 'lat', 'lon', 'ph', 'tds', 'temp', 'turb']) {
    m[k] = Number(m[k]);
    if (!isFinite(m[k])) return null;
  }
  if (v.tan !== undefined) m.tan = Number(v.tan);
  m.test = v.test === true;
  return m;
}

export async function connect(h) {
  if (isDemo) {
    h.onDevices({ 'HS-001': { name: 'Demo device' } });
    h.onSettings({ spotNames: {} });
    h.onMeasurements(demoData());
    h.onStatus('Demo data - not connected to Firebase', true);
    return;
  }
  try {
    const V = FIREBASE_VER;
    const app = await import(`https://www.gstatic.com/firebasejs/${V}/firebase-app.js`);
    const rtdb = await import(`https://www.gstatic.com/firebasejs/${V}/firebase-database.js`);
    const fb = app.initializeApp(firebaseConfig);
    const db = rtdb.getDatabase(fb);
    const err = e => h.onStatus('Could not read data: ' + (e && e.message ? e.message : e), false);
    rtdb.onValue(rtdb.query(rtdb.ref(db, `${DB_ROOT}/measurements`), rtdb.orderByChild('ts'), rtdb.limitToLast(2000)), snap => {
      const list = [];
      snap.forEach(c => { const m = clean(c.key, c.val()); if (m) list.push(m); });
      h.onMeasurements(list);
      h.onStatus('Live', true);
    }, err);
    rtdb.onValue(rtdb.ref(db, `${DB_ROOT}/devices`), s => h.onDevices(s.val() || {}), err);
    rtdb.onValue(rtdb.ref(db, `${DB_ROOT}/settings`), s => h.onSettings(s.val() || {}), err);
  } catch (e) {
    h.onStatus('Could not connect: ' + e.message, false);
  }
}
