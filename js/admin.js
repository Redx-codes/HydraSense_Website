import { firebaseConfig, ADMIN_EMAIL, DB_ROOT, FIREBASE_VER } from './firebase-config.js';
import { clusterSpots, MODELS } from './logic.js';
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
  renderDevices(); renderSpots(); renderKitPick(); watchBoats();
  $('#ecf').value = state.settings.ecFactor || '';
}

function renderDevices() {
  const ids = Object.keys(state.devices);
  $('#devList').innerHTML = ids.length ? `<table>${ids.map(id => { const d = state.devices[id]; return `<tr><td><b>${esc(id)}</b></td><td>${esc(d.name)}</td>
    <td><select data-model="${esc(id)}">${Object.keys(MODELS).map(k => `<option value="${k}" ${(d.model || 'lite') === k ? 'selected' : ''}>${MODELS[k].name}</option>`).join('')}</select></td>
    <td><label><input type="checkbox" data-boat="${esc(id)}" ${d.boat ? 'checked' : ''}> boat</label></td></tr>`; }).join('')}</table>` : 'No devices yet.';
  $('#devList').querySelectorAll('[data-model]').forEach(e => e.onchange = () => dbM.set(R(`devices/${e.dataset.model}/model`), e.value).then(refresh).catch(x => alert('Could not save: ' + x.message)));
  $('#devList').querySelectorAll('[data-boat]').forEach(e => e.onchange = () => dbM.set(R(`devices/${e.dataset.boat}/boat`), e.checked).then(refresh).catch(x => alert('Could not save: ' + x.message)));
  if (!$('#devId').value) { let n = ids.length + 1, id; do { id = 'HS-' + String(n++).padStart(3, '0'); } while (state.devices[id]); $('#devId').value = id; }
}

const TYPE_NAMES = { drink: 'Drinking water', pond: 'Pond / lake', pit: 'Mine pit lake' };
function renderSpots() {
  const spots = clusterSpots(state.measurements, 50);
  const names = state.settings.spotNames || {}, types = state.settings.spotTypes || {};
  $('#spotList').innerHTML = spots.length ? spots.map((s, i) => `<div class="row" style="margin-bottom:6px"><span style="min-width:150px">${s.lat.toFixed(4)}, ${s.lon.toFixed(4)} <span class="small">(${s.items.length})</span></span>
    <input data-k="${esc(s.id)}" value="${esc(names[s.id] || '')}" placeholder="Spot ${i + 1}">
    <select data-t="${esc(s.id)}">${Object.keys(TYPE_NAMES).map(k => `<option value="${k}" ${(types[s.id] || 'drink') === k ? 'selected' : ''}>${TYPE_NAMES[k]}</option>`).join('')}</select>
    <button class="b" data-save="${esc(s.id)}">Save</button></div>`).join('') : 'No spots yet.';
  $('#spotList').querySelectorAll('button[data-save]').forEach(b => b.onclick = async () => {
    const k = b.dataset.save, v = $(`input[data-k="${k}"]`).value.trim(), t = $(`select[data-t="${k}"]`).value;
    try { await dbM.set(R(`settings/spotNames/${k}`), v || null); await dbM.set(R(`settings/spotTypes/${k}`), t === 'drink' ? null : t); b.textContent = 'Saved ✓'; setTimeout(() => (b.textContent = 'Save'), 1500); }
    catch (e) { alert('Could not save: ' + e.message); }
  });
}

/* ---------------------------------------------------------------- test-kit result */
function renderKitPick() {
  const list = [...state.measurements].sort((a, b) => b.ts - a.ts).slice(0, 60);
  $('#kitM').innerHTML = list.map(m => `<option value="${esc(m.id)}">${esc(new Date(m.ts * 1000).toLocaleString())} · ${esc(m.device)} · pH ${Number(m.ph).toFixed(1)}, TDS ${Math.round(m.tds)}${m.kit ? ' · has kit result' : ''}${m.test ? ' · TEST' : ''}</option>`).join('') || '<option value="">No measurements yet</option>';
}
$('#saveKit').onclick = async () => {
  const id = $('#kitM').value; if (!id) return say('#kitMsg', 'Choose a measurement first.', false);
  const kit = {}, lim = { tan: 100, no3: 1000, cl: 20, hard: 5000, fe: 100 };
  for (const [k, sel] of [['tan', '#kTan'], ['no3', '#kNo3'], ['cl', '#kCl'], ['hard', '#kHard'], ['fe', '#kFe']]) { const v = parseFloat($(sel).value); if (isFinite(v)) { if (v < 0 || v > lim[k]) return say('#kitMsg', `Value for ${k} is outside 0-${lim[k]}.`, false); kit[k] = v; } }
  if ($('#kH2s').value) kit.h2s = $('#kH2s').value;
  if (!Object.keys(kit).length) return say('#kitMsg', 'Type at least one value.', false);
  try { await dbM.set(R(`measurements/${id}/kit`), kit); say('#kitMsg', 'Kit result saved. It now shows as “Manual test” on the public website.', true); await refresh(); }
  catch (e) { say('#kitMsg', 'Could not save: ' + e.message, false); }
};
$('#clearKit').onclick = async () => {
  const id = $('#kitM').value; if (!id) return;
  try { await dbM.remove(R(`measurements/${id}/kit`)); say('#kitMsg', 'Kit result removed.', true); await refresh(); }
  catch (e) { say('#kitMsg', 'Could not remove: ' + e.message, false); }
};

/* ---------------------------------------------------------------- boat permissions */
let boatsWatched = false, boatSeq = Date.now() % 1000000;
function watchBoats() {
  if (boatsWatched) return renderBoats(state.boats || {});
  boatsWatched = true;
  dbM.onValue(R('boats'), s => { state.boats = s.val() || {}; renderBoats(state.boats); }, e => { $('#boatAdmin').textContent = 'Could not read boat data: ' + e.message + ' (publish the new database rules first)'; });
}
function renderBoats(boats) {
  const ids = Object.keys(state.devices).filter(id => state.devices[id].boat);
  if (!ids.length) { $('#boatAdmin').innerHTML = 'No device is marked “boat”. Tick the boat box in the device list above.'; return; }
  $('#boatAdmin').innerHTML = ids.map(id => {
    const b = boats[id] || {}, reqs = Object.entries(b.requests || {}), st = b.status;
    return `<div style="border:1px solid var(--line);border-radius:8px;padding:10px;margin-bottom:8px"><div class="row" style="margin-bottom:6px"><b style="font-size:14px;color:var(--tx)">${esc(id)}</b>
      <span>${st && Date.now() - (st.seen || 0) < 8000 ? 'online' : 'offline'}</span><button class="b" data-estop="${esc(id)}" style="background:var(--bad);color:#fff;border:0;font-weight:700">EMERGENCY STOP</button></div>
      <div>Driver: ${b.driver ? `<b>${esc(b.driver.name || b.driver.uid)}</b> <button class="b" data-revoke="${esc(id)}">Take control back</button>` : 'nobody'} <button class="b" data-me="${esc(id)}">Make me the driver</button></div>
      <div style="margin-top:6px">${reqs.length ? reqs.map(([uid, r]) => `<div class="row" style="margin:4px 0"><span>${esc(r.name || '?')} <span class="small">${esc(r.email || '')}</span></span><button class="b pri" data-allow="${esc(id)}|${esc(uid)}">Allow</button><button class="b" data-deny="${esc(id)}|${esc(uid)}">Dismiss</button></div>`).join('') : 'No control requests.'}</div></div>`;
  }).join('');
  const q = sel => $('#boatAdmin').querySelectorAll(sel);
  const stop = id => dbM.set(R(`boats/${id}/cmd`), { l: 0, r: 0, arm: false, estop: true, seq: ++boatSeq, by: auth.currentUser.uid, t: dbM.serverTimestamp() });
  const act = f => f().catch(e => alert('Failed: ' + e.message));
  q('[data-estop]').forEach(e => e.onclick = () => act(() => stop(e.dataset.estop)));
  q('[data-revoke]').forEach(e => e.onclick = () => act(async () => { await stop(e.dataset.revoke); await dbM.remove(R(`boats/${e.dataset.revoke}/driver`)); }));
  q('[data-me]').forEach(e => e.onclick = () => act(async () => { await stop(e.dataset.me); await dbM.set(R(`boats/${e.dataset.me}/driver`), { uid: auth.currentUser.uid, name: auth.currentUser.displayName || 'Admin', since: dbM.serverTimestamp() }); }));
  q('[data-allow]').forEach(e => e.onclick = () => act(async () => { const [id, uid] = e.dataset.allow.split('|'), r = (boats[id].requests || {})[uid] || {}; await stop(id); await dbM.set(R(`boats/${id}/driver`), { uid, name: String(r.name || 'Driver').slice(0, 60), since: dbM.serverTimestamp() }); await dbM.remove(R(`boats/${id}/requests/${uid}`)); }));
  q('[data-deny]').forEach(e => e.onclick = () => act(() => { const [id, uid] = e.dataset.deny.split('|'); return dbM.remove(R(`boats/${id}/requests/${uid}`)); }));
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
    await dbM.set(R(`devices/${id}`), { name, uid, email, createdAt: Date.now(), model: $('#devModel').value, boat: $('#devBoat').checked });
    say('#devMsg', 'Device added. Copy the details below NOW - the password is not shown again.', true);
    const box = $('#devCreds'); box.style.display = 'block';
    box.textContent = `// put these in the ESP32 firmware\nDEVICE_ID    = "${id}"\nDEVICE_EMAIL = "${email}"\nDEVICE_PASS  = "${password}"\nAPI_KEY      = "${firebaseConfig.apiKey}"\nDB_URL       = "${firebaseConfig.databaseURL}"\nDB_PATH      = "${DB_ROOT}/measurements"\nBOAT_PATH    = "${DB_ROOT}/boats/${id}"   // only if this device has the boat base`;
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
  const ec = num('#mEc'); if (isFinite(ec) && ec >= 0 && ec <= 20000) m.ec = ec;
  const dox = num('#mDo'); if (isFinite(dox) && dox >= 0 && dox <= 30) m.do = dox;
  m.flags = 0; m.stable = true; m.test = $('#mTest').checked;
  try { await dbM.push(R('measurements'), m); say('#mMsg', 'Saved. It will appear on the map.', true); await refresh(); }
  catch (e) { say('#mMsg', 'Could not save: ' + e.message, false); }
};

/* ---------------------------------------------------------------- settings / test data */
$('#saveEcf').onclick = async () => {
  const v = parseFloat($('#ecf').value);
  if (isFinite(v) && (v < 0.4 || v > 0.9)) return say('#ecfMsg', 'The factor is normally between 0.4 and 0.9.', false);
  try { await dbM.set(R('settings/ecFactor'), isFinite(v) ? v : null); say('#ecfMsg', 'Saved.', true); }
  catch (e) { say('#ecfMsg', 'Could not save: ' + e.message, false); }
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
