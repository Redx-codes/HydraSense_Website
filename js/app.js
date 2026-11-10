import * as L from './logic.js';
import { connect, isDemo } from './data.js';
import { SPOT_RADIUS_M } from './firebase-config.js';

const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const when = ts => new Date(ts * 1000).toLocaleString([], { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const RANGE = { ph: [4, 11], tds: [0, 1500], turb: [0, 50], temp: [0, 45] };

const st = { all: [], devices: {}, settings: {}, showTest: false, spots: [], alerts: [], selected: null, view: 'map', opts: {}, mapReady: false, fitted: false, status: { text: 'connecting...', ok: null } };
let map, markerLayer;
const charts = {};

/* ---------------------------------------------------------------- state */
function recompute() {
  const list = st.showTest ? st.all : st.all.filter(m => !m.test);
  st.spots = L.clusterSpots(list, SPOT_RADIUS_M);
  st.spots.sort((a, b) => a.items[0].ts - b.items[0].ts);
  const names = (st.settings && st.settings.spotNames) || {};
  st.spots.forEach((s, i) => { s.n = i + 1; s.name = names[s.id] || `Spot ${i + 1}`; });
  const k = Number(st.settings && st.settings.hardnessK);
  st.opts = k > 0 ? { hardnessK: k, hardnessCalibrated: true } : {};
  st.alerts = st.spots.flatMap(s => L.alertsForSpot(s, st.opts).map(a => ({ ...a, spotName: s.name })))
    .sort((a, b) => b.ts - a.ts);
  if (st.selected && !st.spots.some(s => s.id === st.selected)) st.selected = null;
  render();
}
const spotById = id => st.spots.find(s => s.id === id);

/* ---------------------------------------------------------------- helpers */
function mk(id, type, labels, datasets, opt = {}) {
  const el = document.getElementById(id);
  if (!el || typeof Chart === 'undefined') return;
  if (charts[id]) charts[id].destroy();
  const grid = { color: '#23415c' }, tick = { color: '#8fa9bd' };
  const scales = Object.assign({ x: { ticks: { ...tick, maxTicksLimit: 8 }, grid }, y: { ticks: tick, grid } }, opt.scales || {});
  charts[id] = new Chart(el, { type, data: { labels, datasets }, options: { animation: false, responsive: true, plugins: { legend: { labels: { color: '#8fa9bd' } }, ...(opt.plugins || {}) }, scales } });
}
const line = (label, data, color, yAxisID) => ({ label, data, borderColor: color, backgroundColor: color, borderWidth: 2, pointRadius: 3, tension: 0.2, yAxisID });

function gauge(v, color) {
  const a = Math.PI * (1 - v / 100), x = 85 + 70 * Math.cos(a), y = 95 - 70 * Math.sin(a);
  return `<svg width="170" height="110" viewBox="0 0 170 110"><path d="M15 95 A70 70 0 0 1 155 95" fill="none" stroke="#0a1826" stroke-width="14" stroke-linecap="round"/><path d="M15 95 A70 70 0 0 1 ${x.toFixed(1)} ${y.toFixed(1)}" fill="none" stroke="${color}" stroke-width="14" stroke-linecap="round"/><text x="85" y="92" text-anchor="middle" fill="#fff" font-size="26" font-weight="700">${v}</text></svg>`;
}

/* ---------------------------------------------------------------- map */
function initMap() {
  map = window.L.map('map', { zoomControl: true }).setView([22.57, 88.36], 12);
  window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap', maxZoom: 19 }).addTo(map);
  markerLayer = window.L.layerGroup().addTo(map);
  $('#legend').innerHTML = L.CATEGORIES.map(c => `<div><i style="background:${c.color}"></i>${c.name}</div>`).join('') + '<div style="margin-top:4px" class="small">Faded = older than 14 days</div>';
  st.mapReady = true;
}

function drawMap() {
  if (!st.mapReady) return;
  markerLayer.clearLayers();
  const now = Date.now() / 1000;
  for (const s of st.spots) {
    const m = s.latest, score = L.wqi(m), cat = L.category(score);
    const old = now - m.ts > 14 * 86400, sel = s.id === st.selected;
    const mark = window.L.circleMarker([s.lat, s.lon], { radius: sel ? 16 : 12, color: sel ? '#fff' : '#0b1b2b', weight: sel ? 3 : 2, fillColor: cat.color, fillOpacity: old ? 0.45 : 0.95 }).addTo(markerLayer);
    mark.bindTooltip(`<b>${esc(s.name)}</b><br>WQI ${score} · ${cat.name}<br>${L.timeAgo(m.ts)}`);
    mark.on('click', () => { st.selected = s.id; render(); });
  }
  if (st.spots.length && !st.fitted) {
    st.fitted = true;
    const pts = st.spots.map(s => [s.lat, s.lon]);
    if (pts.length === 1) map.setView(pts[0], 16); else map.fitBounds(window.L.latLngBounds(pts).pad(0.3));
  }
}

/* ---------------------------------------------------------------- spot panel */
function paramCard(k, v, status) {
  const p = L.PARAMS[k], [lo, hi] = RANGE[k], pc = x => Math.max(0, Math.min(100, (x - lo) / (hi - lo) * 100));
  return `<div class="card" style="margin:0"><h3>${p.label}</h3><div class="big">${Number(v).toFixed(p.dec)}<span class="small"> ${p.unit}</span></div>
    <span class="pill ${status}">${status.replace(/_/g, ' ')}</span>
    <div class="bar"><i style="left:${pc(p.ok[0])}%;width:${pc(p.ok[1]) - pc(p.ok[0])}%;background:#c98a14"></i><i style="left:${pc(p.ideal[0])}%;width:${pc(p.ideal[1]) - pc(p.ideal[0])}%;background:#1a9850"></i><u style="left:${pc(v)}%"></u></div>
    <div class="small">Ideal ${p.ideal[0]}–${p.ideal[1]} · OK ${p.ok[0]}–${p.ok[1]} ${p.unit}</div></div>`;
}
const levelClass = l => (l === 'Not suitable' ? 'Not' : l);

function panelHTML(s) {
  const m = s.latest, a = L.assess(m, st.opts), e = a.est;
  const hist = s.items.slice(0, -1);
  const alerts = L.alertsForMeasurement(m, hist, st.opts);
  const dev = st.devices[m.device] && st.devices[m.device].name ? st.devices[m.device].name : m.device;
  const cl = a.classes;
  const chip = (c, label) => `<span class="chip ${cl.passed[c] ? 'y' : 'n'}" title="${esc(cl.notes[c])}">${cl.passed[c] ? '✓' : '✗'} ${label}</span>`;
  const salNote = e.salinity.outOfSensorRange ? ' <span class="small">(TDS near/above sensor limit)</span>' : '';
  return `
  <div class="card">
    <div style="display:flex;justify-content:space-between;gap:8px;align-items:start">
      <div><div class="big" style="font-size:20px">${esc(s.name)}${m.test ? '<span class="tag-test">TEST</span>' : ''}</div>
      <div class="small">Measured ${esc(when(m.ts))} (${L.timeAgo(m.ts)}) · ${esc(dev)}</div>
      <div class="small">${s.lat.toFixed(5)}, ${s.lon.toFixed(5)} · ${s.items.length} measurement${s.items.length > 1 ? 's' : ''} at this spot</div></div>
      <button class="b" id="closePanel">✕</button>
    </div>
    <div style="display:flex;gap:14px;align-items:center;margin-top:8px">
      ${gauge(a.wqi, a.category.color)}
      <div><div style="font-size:20px;font-weight:700;color:${a.category.color}">${a.category.name}</div>
      <div class="small">Water Quality Index</div>
      <div style="margin-top:6px"><span class="pill ${a.confidence.level}">Confidence: ${a.confidence.level} (${a.confidence.score}%)</span></div></div>
    </div>
    ${a.confidence.notes.length ? `<div class="small" style="margin-top:6px">⚠ ${a.confidence.notes.map(esc).join(' · ')}</div>` : ''}
  </div>

  <div class="card">
    <h3>Suitable use</h3>
    <div style="font-weight:700">${esc(L.overallLabel(cl.overall))}</div>
    <div class="chips">${chip('A', 'Drinking (screen)')}${chip('B', 'Irrigation')}${chip('C', 'Fish culture')}${chip('D', 'Industrial')}</div>
    <div class="small">${esc(cl.passed.A ? cl.notes.A : cl.overall === 'E' ? 'Too contaminated for direct use. Check for drains, sewage or industrial discharge nearby.' : cl.notes.A)}</div>
  </div>

  <div class="grid g2" style="margin-bottom:12px">
    ${['ph', 'tds', 'turb', 'temp'].map(k => paramCard(k, m[k], a.status[k])).join('')}
  </div>

  <div class="card">
    <h3>Estimated water chemistry <span class="est">Estimated</span></h3>
    <div class="estline"><b>Salinity</b> ≈ ${e.salinity.ppt} ppt (${e.salinity.cls})${salNote}</div>
    <div class="estline"><b>Oxygen</b>: the most this water can hold at ${m.temp.toFixed(1)} °C is ${e.oxygen.saturationMgL} mg/L.
      Risk of low oxygen: <span class="pill risk-${e.oxygen.risk}">${e.oxygen.risk}</span>
      ${e.oxygen.reasons.length ? `<div class="small">${e.oxygen.reasons.map(esc).join('; ')}</div>` : ''}</div>
    <div class="estline"><b>Ammonia</b>: at this pH and temperature <b>${e.ammonia.fractionPct}%</b> of any ammonia is the toxic form
      <span class="pill risk-${e.ammonia.fractionLevel === 'Moderate' ? 'Medium' : e.ammonia.fractionLevel}">${e.ammonia.fractionLevel}</span>.
      Organic-load risk: <span class="pill risk-${e.ammonia.organicLoad}">${e.ammonia.organicLoad}</span>
      ${typeof e.ammonia.nh3mgL === 'number' ? `<div class="small">Test-kit value entered: toxic NH₃ ≈ ${e.ammonia.nh3mgL} mg/L (${e.ammonia.nh3Status})</div>` : '<div class="small">Actual ammonia amount needs a test kit.</div>'}</div>
    <div class="estline"><b>Hardness</b> ≈ ${e.hardness.low}–${e.hardness.high} mg/L as CaCO₃ (${e.hardness.cls})${e.hardness.calibrated ? '' : ' <span class="small">rough, from TDS</span>'}</div>
    <div class="disc">Calculated from pH, TDS, temperature and turbidity. Confirm with a test kit before important decisions.</div>
  </div>

  <div class="card">
    <h3>Fish culture check <span class="est">Estimated</span></h3>
    ${a.fish.map(f => `<div class="fishrow"><div style="display:flex;justify-content:space-between;gap:8px"><span><b>${esc(f.name)}</b> <span class="small"><i>${esc(f.sci)}</i></span></span><span class="pill ${levelClass(f.level)}">${f.level}</span></div>
      ${[...f.reasons, ...f.notes].slice(0, 3).map(r => `<div class="small">• ${esc(r)}</div>`).join('')}</div>`).join('')}
    <div class="disc">Indicative ranges from FAO/ICAR literature. Oxygen, ammonia and hardness are estimated, so test them before stocking.</div>
  </div>

  <div class="card">
    <h3>Alerts for this measurement</h3>
    ${alerts.length ? alerts.map(x => `<div class="al ${x.severity}" style="cursor:default"><b>${x.severity.toUpperCase()}</b> · ${esc(x.msg)}</div>`).join('') : '<div class="small">No alerts.</div>'}
    <div style="margin-top:8px"><button class="b" id="goHist">View history of this spot</button></div>
  </div>`;
}

function renderPanel() {
  const el = $('#panel');
  const s = st.selected && spotById(st.selected);
  if (s) {
    el.innerHTML = panelHTML(s);
    $('#closePanel').onclick = () => { st.selected = null; render(); };
    $('#goHist').onclick = () => { setView('history'); $('#histSpot').value = s.id; render(); };
    return;
  }
  if (!st.spots.length) {
    el.innerHTML = `<div class="card empty"><div style="font-size:18px;color:var(--tx);margin-bottom:6px">No measurements yet</div>
      Switch on a HydraSense device and take a measurement. A node will appear on the map at the place where it was measured.
      ${st.all.some(m => m.test) && !st.showTest ? '<div style="margin-top:8px">Test data exists - tick “show test data” above to see it.</div>' : ''}</div>`;
    return;
  }
  const rows = [...st.spots].sort((a, b) => b.latest.ts - a.latest.ts).map(s => {
    const sc = L.wqi(s.latest), c = L.category(sc);
    return `<tr data-id="${esc(s.id)}" style="cursor:pointer"><td>${esc(s.name)}</td><td><span class="pill" style="background:${c.color}">${sc}</span> ${c.name}</td><td class="small">${L.timeAgo(s.latest.ts)}</td></tr>`;
  }).join('');
  el.innerHTML = `<div class="card"><h3>Measured spots (${st.spots.length})</h3><table>${rows}</table>
    <div class="disc">Tap a marker or a row for full details. Spots within ${SPOT_RADIUS_M} m are grouped together.</div></div>`;
  el.querySelectorAll('tr[data-id]').forEach(tr => tr.onclick = () => { st.selected = tr.dataset.id; render(); const s = spotById(st.selected); if (s && map) map.setView([s.lat, s.lon], Math.max(map.getZoom(), 15)); });
}

/* ---------------------------------------------------------------- history */
function renderHistory() {
  const sel = $('#histSpot'), keep = sel.value || st.selected;
  sel.innerHTML = st.spots.map(s => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('');
  if (keep && spotById(keep)) sel.value = keep;
  const s = spotById(sel.value);
  const body = $('#histBody');
  if (!s) { body.innerHTML = '<div class="card empty">No measurements yet.</div>'; return; }
  $('#csvLink').onclick = e => { e.preventDefault(); downloadCsv(s); };
  const lb = s.items.map(m => new Date(m.ts * 1000).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }));
  body.innerHTML = `<div class="grid g-auto">
    <div class="card"><h3>WQI over visits</h3><canvas id="hW"></canvas></div>
    <div class="card"><h3>pH</h3><canvas id="hP"></canvas></div>
    <div class="card"><h3>TDS (ppm)</h3><canvas id="hT"></canvas></div>
    <div class="card"><h3>Turbidity (NTU) and temperature (°C)</h3><canvas id="hU"></canvas></div></div>
    <div class="card"><h3>All measurements at ${esc(s.name)}</h3><div style="overflow:auto"><table><tr><th>Time</th><th>Device</th><th>pH</th><th>TDS</th><th>Temp</th><th>Turb</th><th>WQI</th><th>Confidence</th></tr>
    ${[...s.items].reverse().map(m => { const c = L.confidence(m); return `<tr><td>${esc(when(m.ts))}${m.test ? '<span class="tag-test">TEST</span>' : ''}</td><td>${esc(m.device)}</td><td>${m.ph.toFixed(2)}</td><td>${Math.round(m.tds)}</td><td>${m.temp.toFixed(1)}</td><td>${m.turb.toFixed(1)}</td><td>${L.wqi(m)}</td><td>${c.level}</td></tr>`; }).join('')}
    </table></div></div>`;
  mk('hW', 'line', lb, [line('WQI', s.items.map(L.wqi), '#2bb3d6')], { scales: { y: { min: 0, max: 100, ticks: { color: '#8fa9bd' }, grid: { color: '#23415c' } } } });
  mk('hP', 'line', lb, [line('pH', s.items.map(m => m.ph), '#91cf60')]);
  mk('hT', 'line', lb, [line('TDS', s.items.map(m => m.tds), '#fdae61')]);
  mk('hU', 'line', lb, [line('Turbidity', s.items.map(m => m.turb), '#f46d43'), line('Temp', s.items.map(m => m.temp), '#b39ddb', 'y1')], { scales: { y1: { position: 'right', ticks: { color: '#8fa9bd' }, grid: { display: false } } } });
}

function downloadCsv(s) {
  const rows = [['time_iso', 'device', 'lat', 'lon', 'ph', 'tds_ppm', 'temp_c', 'turb_ntu', 'wqi', 'category', 'test']];
  for (const m of s.items) rows.push([new Date(m.ts * 1000).toISOString(), m.device, m.lat, m.lon, m.ph, m.tds, m.temp, m.turb, L.wqi(m), L.category(L.wqi(m)).name, m.test ? 1 : 0]);
  const blob = new Blob([rows.map(r => r.join(',')).join('\n')], { type: 'text/csv' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `hydrasense_${s.id}.csv`; a.click();
}

/* ---------------------------------------------------------------- compare */
let picked = null;
function renderCompare() {
  if (!picked) picked = new Set(st.spots.slice(0, 5).map(s => s.id));
  $('#cmpPick').innerHTML = st.spots.map(s => `<label class="card" style="padding:6px 10px;margin:0"><input type="checkbox" data-id="${esc(s.id)}" ${picked.has(s.id) ? 'checked' : ''}> ${esc(s.name)}</label>`).join('') || '<span class="small">No spots yet.</span>';
  $('#cmpPick').querySelectorAll('input').forEach(i => i.onchange = () => { i.checked ? picked.add(i.dataset.id) : picked.delete(i.dataset.id); renderCompare(); });
  const ds = st.spots.filter(s => picked.has(s.id));
  mk('cmpChart', 'bar', ds.map(s => s.name), [{ label: 'WQI', data: ds.map(s => L.wqi(s.latest)), backgroundColor: ds.map(s => L.category(L.wqi(s.latest)).color) }],
    { plugins: { legend: { display: false } }, scales: { y: { min: 0, max: 100, ticks: { color: '#8fa9bd' }, grid: { color: '#23415c' } } } });
  $('#cmpTable').innerHTML = ds.length ? `<div style="overflow:auto"><table><tr><th>Spot</th><th>WQI</th><th>pH</th><th>TDS</th><th>Turb</th><th>°C</th><th>Use</th></tr>` +
    ds.map(s => { const m = s.latest, a = L.assess(m, st.opts); return `<tr><td>${esc(s.name)}</td><td><b>${a.wqi}</b></td><td>${m.ph.toFixed(2)}</td><td>${Math.round(m.tds)}</td><td>${m.turb.toFixed(1)}</td><td>${m.temp.toFixed(1)}</td><td>${a.classes.overall === 'BC' ? 'B/C' : a.classes.overall}</td></tr>`; }).join('') + '</table></div>' : 'Select two or more spots.';
}

/* ---------------------------------------------------------------- alerts */
function renderAlerts() {
  const el = $('#alertList');
  const list = st.alerts.slice(0, 120);
  el.innerHTML = list.length ? list.map(a => `<div class="al ${a.severity}" data-id="${esc(a.spotId)}"><b>${esc(a.spotName)}</b> · ${a.severity.toUpperCase()} · ${esc(a.msg)} <span class="small">· ${esc(when(a.ts))}</span></div>`).join('') : '<div class="empty">No alerts.</div>';
  el.querySelectorAll('.al').forEach(d => d.onclick = () => { st.selected = d.dataset.id; setView('map'); });
  const crit = st.alerts.filter(a => a.severity === 'critical' && Date.now() / 1000 - a.ts < 7 * 86400).length;
  $('#alertBadge').textContent = crit ? `(${crit})` : '';
}

/* ---------------------------------------------------------------- QR */
function renderQr() {
  const url = location.href.split('#')[0].split('?')[0];
  try {
    const q = qrcode(0, 'M'); q.addData(url); q.make();
    $('#qrSvg').innerHTML = q.createSvgTag({ cellSize: 6, margin: 0, scalable: true });
  } catch (e) { $('#qrSvg').textContent = 'QR library could not load (check internet).'; }
  $('#qrUrl').textContent = url + (/localhost|127\.0\.0\.1|192\.168\./.test(url) ? '  ⚠ This address works only on your own network. Use the public website address for the printed QR.' : '');
}

/* ---------------------------------------------------------------- shell */
function setView(v) {
  st.view = v;
  document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('on', b.dataset.view === v));
  document.querySelectorAll('.view').forEach(x => x.classList.toggle('on', x.id === 'view-' + v));
  if (v === 'map' && map) setTimeout(() => map.invalidateSize(), 50);
  render();
}

function render() {
  const bad = st.status.ok === false;
  $('#statusDot').className = 'dot ' + (st.status.ok === true ? 'ok' : bad ? 'err' : '');
  $('#statusText').textContent = st.status.text;
  $('#banner').innerHTML = bad ? `<div class="banner err">${esc(st.status.text)}</div>` : isDemo ? '<div class="banner">Demo mode: showing sample data, not real measurements.</div>' : '';
  renderAlerts(); // keeps the badge fresh
  if (st.view === 'map') { drawMap(); renderPanel(); }
  else if (st.view === 'history') renderHistory();
  else if (st.view === 'compare') renderCompare();
  else if (st.view === 'qr') renderQr();
}

document.querySelectorAll('#nav button').forEach(b => b.onclick = () => setView(b.dataset.view));
$('#histSpot').onchange = () => renderHistory();
$('#showTest').onchange = e => { st.showTest = e.target.checked; recompute(); };

try { initMap(); } catch (e) { $('#banner').innerHTML = '<div class="banner err">Map could not load (check internet connection).</div>'; }
connect({
  onMeasurements: list => { st.all = list; recompute(); },
  onDevices: d => { st.devices = d || {}; render(); },
  onSettings: s => { st.settings = s || {}; recompute(); },
  onStatus: (text, ok) => { st.status = { text, ok }; render(); },
});
