import { firebaseConfig, ADMIN_EMAIL, DB_ROOT, FIREBASE_VER } from './firebase-config.js';
import { clusterSpots } from './logic.js';
import { demoData } from './data.js';

const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const say = (sel, text, ok) => { const e = $(sel); e.textContent = text; e.className = 'msg ' + (ok ? 'ok' : 'err'); };

const V = FIREBASE_VER, base = `https://www.gstatic.com/firebasejs/${V}/`;
const [appM, authM, dbM] = await Promise.all([
  import(base + 'firebase-app.js'), import(base + 'firebase-auth.js'), import(base + 'firebase-database.js'),
]);
const app = appM.initializeApp(firebaseConfig);
const auth = authM.getAuth(app);
const db = dbM.getDatabase(app);
const R = p => dbM.ref(db, `${DB_ROOT}/${p}`);

let pickMarker = null, pickMap = null, state = { devices: {}, measurements: [], settings: {} };

/* ---------------------------------------------------------------- auth */
$('#googleBtn').onclick = async () => {
  try { await authM.signInWithPopup(auth, new authM.GoogleAuthProvider()); }
  catch (e) { say('#loginMsg', 'Sign-in failed: ' + e.message + ' (check Authentication → Settings → Authorized domains)', false); }
};
$('#signOut').onclick = () => authM.signOut(auth);

authM.onAuthStateChanged(auth, user => {
  const isAdmin = user && user.email === ADMIN_EMAIL && user.emailVerified;
  $('#loginCard').style.display = isAdmin ? 'none' : 'block';
  $('#adminArea').style.display = isAdmin ? 'block' : 'none';
  $('#signOut').style.display = user ? 'inline-block' : 'none';
  $('#who').textContent = user ? user.email : '';
  if (user && !isAdmin) say('#loginMsg', `${user.email} is not the admin account. Sign out and use ${ADMIN_EMAIL}.`, false);
  if (isAdmin) { initPicker(); refresh(); }
});

/* ---------------------------------------------------------------- load */
async function refresh() {
  const [d, m, s] = await Promise.all([
    dbM.get(R('devices')), dbM.get(dbM.query(R('measurements'), dbM.orderByChild('ts'), dbM.limitToLast(2000))), dbM.get(R('settings')),
  ]);
  state.devices = d.val() || {};
  state.settings = s.val() || {};
  state.measurements = [];
  m.forEach(c => { const v = c.val(); if (v && isFinite(v.lat)) state.measurements.push({ id: c.key, ...v }); });
  renderDevices(); renderSpots();
  $('#hk').value = state.settings.hardnessK || '';
}

function renderDevices() {
  const ids = Object.keys(state.devices);
  $('#devList').innerHTML = ids.length ? `<table>${ids.map(id => `<tr><td><b>${esc(id)}</b></td><td>${esc(state.devices[id].name)}</td><td class="small">${esc((state.devices[id].uid || '').slice(0, 8))}…</td></tr>`).join('')}</table>` : 'No devices yet.';
  if (!$('#devId').value) { let n = ids.length + 1, id; do { id = 'HS-' + String(n++).padStart(3, '0'); } while (state.devices[id]); $('#devId').value = id; }
}

function renderSpots() {
  const spots = clusterSpots(state.measurements, 50);
  const names = state.settings.spotNames || {};
  $('#spotList').innerHTML = spots.length ? spots.map((s, i) => `<div class="row" style="margin-bottom:6px"><span style="min-width:150px">${s.lat.toFixed(4)}, ${s.lon.toFixed(4)} <span class="small">(${s.items.length})</span></span>
    <input data-k="${esc(s.id)}" value="${esc(names[s.id] || '')}" placeholder="Spot ${i + 1}"><button class="b" data-save="${esc(s.id)}">Save</button></div>`).join('') : 'No spots yet.';
  $('#spotList').querySelectorAll('button[data-save]').forEach(b => b.onclick = async () => {
    const k = b.dataset.save, v = $(`input[data-k="${k}"]`).value.trim();
    try { await dbM.set(R(`settings/spotNames/${k}`), v || null); b.textContent = 'Saved ✓'; setTimeout(() => (b.textContent = 'Save'), 1500); }
    catch (e) { alert('Could not save: ' + e.message); }
  });
}

/* ---------------------------------------------------------------- add device */
function randomPassword(n = 18) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const a = new Uint32Array(n); crypto.getRandomValues(a);
  return Array.from(a, x => chars[x % chars.length]).join('');
}

$('#addDev').onclick = async () => {
  const id = $('#devId').value.trim(), name = $('#devName').value.trim();
  if (!/^[A-Za-z0-9_-]{3,20}$/.test(id)) return say('#devMsg', 'Device ID: 3-20 letters, digits, - or _', false);
  if (!name) return say('#devMsg', 'Please give the device a name.', false);
  if (state.devices[id]) return say('#devMsg', 'This device ID already exists.', false);
  say('#devMsg', 'Creating…', true);
  const email = `${id.toLowerCase()}@device.hydrasense.invalid`, password = randomPassword();
  try {
    // secondary app so the admin stays signed in
    const sec = appM.initializeApp(firebaseConfig, 'creator-' + Date.now());
    const secAuth = authM.getAuth(sec);
    const cred = await authM.createUserWithEmailAndPassword(secAuth, email, password);
    const uid = cred.user.uid;
    await authM.signOut(secAuth);
    await dbM.set(R(`devices/${id}`), { name, uid, email, createdAt: Date.now() });
    say('#devMsg', 'Device added. Copy the details below NOW - the password is not shown again.', true);
    const box = $('#devCreds'); box.style.display = 'block';
    box.textContent = `// put these in the ESP32 firmware\nDEVICE_ID    = "${id}"\nDEVICE_EMAIL = "${email}"\nDEVICE_PASS  = "${password}"\nAPI_KEY      = "${firebaseConfig.apiKey}"\nDB_URL       = "${firebaseConfig.databaseURL}"\nDB_PATH      = "${DB_ROOT}/measurements"`;
    $('#devId').value = ''; $('#devName').value = '';
    await refresh();
  } catch (e) { say('#devMsg', 'Failed: ' + e.message, false); }
};

/* ---------------------------------------------------------------- manual measurement */
function initPicker() {
  if (pickMap || typeof window.L === 'undefined') return;
  pickMap = window.L.map('pickMap').setView([22.57, 88.36], 12);
  window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(pickMap);
  pickMap.on('click', e => setPos(e.latlng.lat, e.latlng.lng));
  const now = new Date(); now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  $('#mTime').value = now.toISOString().slice(0, 16);
}
function setPos(lat, lon) {
  $('#mLat').value = lat.toFixed(5); $('#mLon').value = lon.toFixed(5);
  if (pickMarker) pickMarker.setLatLng([lat, lon]); else pickMarker = window.L.marker([lat, lon]).addTo(pickMap);
}
$('#myLoc').onclick = () => {
  if (!navigator.geolocation) return say('#mMsg', 'Location is not available in this browser.', false);
  navigator.geolocation.getCurrentPosition(p => { setPos(p.coords.latitude, p.coords.longitude); if (pickMap) pickMap.setView([p.coords.latitude, p.coords.longitude], 16); },
    e => say('#mMsg', 'Could not get location: ' + e.message, false));
};

$('#saveM').onclick = async () => {
  const num = id => parseFloat($(id).value);
  const m = { device: 'MANUAL', lat: num('#mLat'), lon: num('#mLon'), ph: num('#mPh'), tds: num('#mTds'), temp: num('#mTemp'), turb: num('#mTurb') };
  const t = $('#mTime').value ? new Date($('#mTime').value) : new Date();
  m.ts = Math.floor(Math.min(t.getTime(), Date.now()) / 1000);
  for (const k of ['lat', 'lon', 'ph', 'tds', 'temp', 'turb']) if (!isFinite(m[k])) return say('#mMsg', `Please fill ${k}.`, false);
  if (m.ph < 0 || m.ph > 14 || m.tds < 0 || m.turb < 0 || m.temp < -5 || m.temp > 70) return say('#mMsg', 'A value is outside the allowed range.', false);
  const tan = num('#mTan'); if (isFinite(tan) && tan >= 0) m.tan = tan;
  m.flags = 0; m.stable = true; m.test = $('#mTest').checked;
  try { await dbM.push(R('measurements'), m); say('#mMsg', 'Saved. It will appear on the map.', true); await refresh(); }
  catch (e) { say('#mMsg', 'Could not save: ' + e.message, false); }
};

/* ---------------------------------------------------------------- settings / test data */
$('#saveHk').onclick = async () => {
  const v = parseFloat($('#hk').value);
  try { await dbM.set(R('settings/hardnessK'), isFinite(v) && v > 0 ? v : null); say('#hkMsg', 'Saved.', true); }
  catch (e) { say('#hkMsg', 'Could not save: ' + e.message, false); }
};

$('#addDemo').onclick = async () => {
  try {
    const centre = pickMap ? pickMap.getCenter() : { lat: 22.57, lng: 88.36 };
    const dLat = centre.lat - 22.5726, dLon = centre.lng - 88.3639;
    const updates = {};
    for (const d of demoData()) {
      const { id, ...v } = d;
      updates[dbM.push(R('measurements')).key] = { ...v, device: 'MANUAL', lat: +(v.lat + dLat).toFixed(5), lon: +(v.lon + dLon).toFixed(5), test: true };
    }
    await dbM.update(R('measurements'), updates);
    say('#tMsg', `Added ${Object.keys(updates).length} sample measurements around the map centre (marked TEST).`, true); await refresh();
  } catch (e) { say('#tMsg', 'Failed: ' + e.message, false); }
};

$('#delTest').onclick = async () => {
  if (!confirm('Delete ALL measurements marked TEST? This cannot be undone.')) return;
  try {
    const snap = await dbM.get(R('measurements'));
    const updates = {}; snap.forEach(c => { if (c.val() && c.val().test === true) updates[c.key] = null; });
    const n = Object.keys(updates).length;
    if (n) await dbM.update(R('measurements'), updates);
    say('#tMsg', `Deleted ${n} test measurements.`, true); await refresh();
  } catch (e) { say('#tMsg', 'Failed: ' + e.message, false); }
};
