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
    { lat: 22.5835, lon: 88.3560, base: { ph: 4.9, tds: 1350, temp: 29, turb: 9 } },    // mine pit lake (acidic)
  ];
  spots.forEach((s, si) => {
    const visits = si >= 3 ? 3 : 7;
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
        flags: 0, stable: true, calDays: si === 1 ? 41 : 12, sats: 8, batt: 3.9,
        ...(si === 4 ? { mode: 'dynamic' } : {}),
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
  for (const k of ['tan', 'ec', 'orp', 'do']) { if (v[k] !== undefined) { m[k] = Number(v[k]); if (!isFinite(m[k])) delete m[k]; } }
  m.test = v.test === true;
  return m;
}

/* ------------------------------------------------------------------ firebase (loaded once, on demand) */
let fbP = null;
function fb() {
  if (!fbP) fbP = (async () => {
    const V = FIREBASE_VER, base = `https://www.gstatic.com/firebasejs/${V}/`;
    const [appM, rtdb] = await Promise.all([import(base + 'firebase-app.js'), import(base + 'firebase-database.js')]);
    const app = appM.initializeApp(firebaseConfig);
    return { app, rtdb, db: rtdb.getDatabase(app), base };
  })();
  return fbP;
}
let authP = null;
function fbAuth() {
  if (!authP) authP = (async () => { const f = await fb(); const authM = await import(f.base + 'firebase-auth.js'); return { ...f, authM, auth: authM.getAuth(f.app) }; })();
  return authP;
}

export async function connect(h) {
  if (isDemo) {
    h.onDevices({ 'HS-001': { name: 'Demo device', model: 'commercial', boat: true } });
    h.onSettings({ spotNames: {}, spotTypes: {} });
    h.onMeasurements(demoData());
    h.onStatus('Demo data - not connected to Firebase', true);
    return;
  }
  try {
    const { rtdb, db } = await fb();
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

/* ------------------------------------------------------------------ boat control (Dynamic mode)
 * Database nodes (see docs/BOAT_CONTRACT.md):
 *   boats/{id}/status   written by the boat   { seen, armed, l, r, seq, estop, batt, rssi, lat, lon }
 *   boats/{id}/cmd      written by the driver { l, r, arm, estop, seq, by, t }   (l, r = -100..100 %)
 *   boats/{id}/driver   written by the admin  { uid, name, since }
 *   boats/{id}/requests/{uid}  written by a signed-in visitor { name, email, t }
 */
const liveBoat = {
  sim: false,
  async onUser(cb) { const { authM, auth } = await fbAuth(); authM.onAuthStateChanged(auth, u => cb(u ? { uid: u.uid, name: u.displayName || u.email, email: u.email } : null)); },
  async signIn() { const { authM, auth } = await fbAuth(); await authM.signInWithPopup(auth, new authM.GoogleAuthProvider()); },
  async signOut() { const { authM, auth } = await fbAuth(); await authM.signOut(auth); },
  async watch(id, cb) {
    const { rtdb, db } = await fb(), st = { status: null, driver: null, offset: 0 }, offs = [];
    const sub = (path, key) => offs.push(rtdb.onValue(rtdb.ref(db, path), s => { st[key] = s.val(); cb({ ...st }); }, () => {}));
    sub(`${DB_ROOT}/boats/${id}/status`, 'status'); sub(`${DB_ROOT}/boats/${id}/driver`, 'driver');
    offs.push(rtdb.onValue(rtdb.ref(db, '.info/serverTimeOffset'), s => { st.offset = s.val() || 0; }));
    return () => offs.forEach(f => f());
  },
  async watchRequest(id, uid, cb) { const { rtdb, db } = await fb(); return rtdb.onValue(rtdb.ref(db, `${DB_ROOT}/boats/${id}/requests/${uid}`), s => cb(s.exists()), () => cb(false)); },
  async request(id, user) { const { rtdb, db } = await fb(); await rtdb.set(rtdb.ref(db, `${DB_ROOT}/boats/${id}/requests/${user.uid}`), { name: String(user.name).slice(0, 60), email: String(user.email).slice(0, 80), t: rtdb.serverTimestamp() }); },
  async cancel(id, user) { const { rtdb, db } = await fb(); await rtdb.remove(rtdb.ref(db, `${DB_ROOT}/boats/${id}/requests/${user.uid}`)); },
  async send(id, cmd) { const { rtdb, db } = await fb(); await rtdb.set(rtdb.ref(db, `${DB_ROOT}/boats/${id}/cmd`), { ...cmd, t: rtdb.serverTimestamp() }); },
};

// Simulated boat for demo mode (?demo=1): obeys the same commands and the same safety rules as the real firmware.
function makeSim() {
  const s = { armed: false, estop: false, l: 0, r: 0, seq: 0, batt: 11.4, rssi: -58, lat: 22.5762, lon: 88.3604, hdg: 0, last: 0 };
  const user = { uid: 'demo', name: 'Demo driver', email: 'demo@example.com' };
  let cb = null;
  setInterval(() => {
    if (Date.now() - s.last > 1500) { s.l = 0; s.r = 0; }                       // command timeout
    const v = (s.l + s.r) / 200, w = (s.l - s.r) / 200;
    s.hdg += w * 0.5; s.lat += Math.cos(s.hdg) * v * 0.000012; s.lon += Math.sin(s.hdg) * v * 0.000013;
    if (cb) cb({ status: { ...s, seen: Date.now() }, driver: { uid: 'demo', name: user.name }, offset: 0 });
  }, 250);
  return {
    sim: true,
    async onUser(f) { f(user); }, async signIn() {}, async signOut() {},
    async watch(id, f) { cb = f; return () => { cb = null; }; },
    async watchRequest(id, uid, f) { f(false); return () => {}; }, async request() {}, async cancel() {},
    async send(id, c) {
      s.seq = c.seq; s.last = Date.now();
      if (c.estop) { s.estop = true; s.armed = false; }
      else if (c.arm && !s.armed) { s.estop = false; s.armed = true; }
      else if (!c.arm) s.armed = false;
      const ok = s.armed && !s.estop;
      s.l = ok ? c.l : 0; s.r = ok ? c.r : 0;
    },
  };
}
export const boat = isDemo ? makeSim() : liveBoat;
