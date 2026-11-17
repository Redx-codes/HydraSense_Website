import * as L from './logic.js';
import { connect, isDemo, boat } from './data.js';
import { SPOT_RADIUS_M, ADMIN_EMAIL } from './firebase-config.js';

const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const when = ts => new Date(ts * 1000).toLocaleString([], { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const store = {
  get(k, d) { try { const v = localStorage.getItem('hs_' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('hs_' + k, JSON.stringify(v)); } catch (e) { /* private mode: keep in memory only */ } },
};

const st = { all: [], devices: {}, settings: {}, showTest: false, spots: [], alerts: [], selected: null, view: 'map', mapReady: false, fitted: false,
  status: { text: 'connecting...', ok: null }, mode: store.get('mode', 'static'), lang: store.get('lang', 'en'), types: store.get('types', {}), kits: store.get('kits', {}) };
let map, markerLayer, boatLayer;
const charts = {};
const tr = pair => pair[st.lang === 'hi' ? 1 : 0];

/* ---------------------------------------------------------------- state */
const modelOf = m => (m.device === 'MANUAL' ? 'commercial' : (st.devices[m.device] && st.devices[m.device].model) || 'lite');
const optsFor = m => ({ model: modelOf(m), ecFactor: Number(st.settings.ecFactor) || 0, kitLocal: st.kits[m.id] });
const Q = m => L.quick(m, optsFor(m));

function recompute() {
  const list = st.showTest ? st.all : st.all.filter(m => !m.test);
  st.spots = L.clusterSpots(list, SPOT_RADIUS_M);
  st.spots.sort((a, b) => a.items[0].ts - b.items[0].ts);
  const names = (st.settings && st.settings.spotNames) || {};
  st.spots.forEach((s, i) => { s.n = i + 1; s.name = names[s.id] || `Spot ${i + 1}`; });
  st.alerts = st.spots.flatMap(s => L.alertsForSpot(s, { optsFor }).map(a => ({ ...a, spotName: s.name }))).sort((a, b) => b.ts - a.ts);
  if (st.selected && !st.spots.some(s => s.id === st.selected)) st.selected = null;
  render();
}
const spotById = id => st.spots.find(s => s.id === id);
const typeOf = s => st.types[s.id] || (st.settings.spotTypes && st.settings.spotTypes[s.id]) || 'drink';

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

/* ---------------------------------------------------------------- map */
function initMap() {
  map = window.L.map('map', { zoomControl: true }).setView([22.57, 88.36], 12);
  window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap', maxZoom: 19 }).addTo(map);
  markerLayer = window.L.layerGroup().addTo(map);
  boatLayer = window.L.layerGroup().addTo(map);
  $('#legend').innerHTML = '<div class="small" style="margin-bottom:3px">Drinking-water index</div>' + L.levels().map(c => `<div><i style="background:${c.color}"></i>${c.label}</div>`).join('') + '<div style="margin-top:4px" class="small">Faded = older than 14 days</div>';
  st.mapReady = true;
}

function drawMap() {
  if (!st.mapReady) return;
  markerLayer.clearLayers();
  const now = Date.now() / 1000;
  for (const s of st.spots) {
    const m = s.latest, q = Q(m);
    const old = now - m.ts > 14 * 86400, sel = s.id === st.selected;
    const mark = window.L.circleMarker([s.lat, s.lon], { radius: sel ? 16 : 12, color: sel ? '#fff' : '#0b1b2b', weight: sel ? 3 : 2, fillColor: q.color, fillOpacity: old ? 0.45 : 0.95 }).addTo(markerLayer);
    mark.bindTooltip(`<b>${esc(s.name)}</b><br>${esc(q.label)}${q.valid ? ` · WQI ${q.wqi}` : ''}<br>Best use: ${esc(q.bestUse[0])}<br>${L.timeAgo(m.ts)}`);
    mark.on('click', () => { st.selected = s.id; render(); });
  }
  if (st.spots.length && !st.fitted) {
    st.fitted = true;
    const pts = st.spots.map(s => [s.lat, s.lon]);
    if (pts.length === 1) map.setView(pts[0], 16); else map.fitBounds(window.L.latLngBounds(pts).pad(0.3));
  }
}

/* ---------------------------------------------------------------- spot panel */
const SRC = { m: ['Measured', 'src-m'], e: ['Estimated', 'src-e'], k: ['Manual test', 'src-k'] };
const srcTag = k => `<span class="src ${SRC[k][1]}">${SRC[k][0]}</span>`;
const pill = (cls, text) => `<span class="pill ${cls}">${esc(text)}</span>`;
const USE_TXT = { suitable: ['Suitable', 'ok'], permissible_only: ['Only if no other source', 'warning-bg'], not_suitable: ['Not suitable', 'Not'], use_with_care: ['Use with care', 'warning-bg'], not_recommended: ['Not recommended', 'Not'], marginal: ['Marginal', 'warning-bg'], risky: ['Risky', 'Not'] };
const usePill = s => pill(USE_TXT[s][1], USE_TXT[s][0]);
const KIT_FIELDS = [['tan', 'Ammonia (total, mg/L)', 0.01], ['no3', 'Nitrate (mg/L)', 1], ['cl', 'Free chlorine (mg/L)', 0.1], ['hard', 'Hardness (mg/L CaCO₃)', 1], ['fe', 'Iron (mg/L)', 0.1]];
const TYPES = [['drink', 'Drinking water', 'पीने का पानी', 'RO / tap / hand pump'], ['pond', 'Pond / lake', 'तालाब / झील', ''], ['pit', 'Mine pit lake', 'खदान का गड्ढा', '']];

function band(x) {
  const lv = L.levels(), i = lv.findIndex(l => l.key === x.key), pos = Math.min(100, x.wqi <= 100 ? x.wqi / 100 * 80 : 80 + Math.min(20, (x.wqi - 100) / 100 * 20));
  return `<div class="band">${lv.map((l, j) => `<i style="background:${l.color};opacity:${j === i ? 1 : 0.35}"></i>`).join('')}<u style="left:${pos}%"></u></div>`;
}

function readingRows(m, x) {
  const r = x.r, rows = [];
  const stat = (ok, warn) => (ok ? pill('ok', 'within limit') : warn ? pill('warning-bg', 'above acceptable') : pill('Not', 'beyond limit'));
  const row = (name, val, src, extra = '') => rows.push(`<tr><td>${name}</td><td><b>${val}</b></td><td>${srcTag(src)}</td><td>${extra}</td></tr>`);
  row('pH', m.ph.toFixed(2), 'm', stat(m.ph >= 6.5 && m.ph <= 8.5, false));
  row('Temperature', m.temp.toFixed(1) + ' °C', 'm');
  row('Turbidity', m.turb.toFixed(1) + ' NTU', 'm', stat(m.turb <= 1, m.turb <= 5));
  if (r.ec != null) row('Conductivity (EC)', Math.round(r.ec) + ' µS/cm', 'm');
  row('TDS', (r.tdsApprox ? '> ' : '') + Math.round(r.tds) + ' mg/L', r.tdsFromEc ? 'e' : 'm', r.tdsApprox ? pill('warning-bg', 'above probe range, approximate') : stat(r.tds <= 500, r.tds <= 2000));
  row('Salinity', '≈ ' + x.salinity.ppt + ' ppt (' + x.salinity.cls + ')', 'e');
  if (typeof m.orp === 'number') row('ORP', Math.round(m.orp) + ' mV', 'm');
  if (x.oxygen.measured) row('Dissolved oxygen', x.oxygen.value.toFixed(1) + ' mg/L', 'm');
  else row('Oxygen (maximum possible)', x.oxygen.saturation + ' mg/L', 'e', '<span class="small">real oxygen not verified</span>');
  const k = x.kit;
  if (x.ammonia) row('Ammonia (total)', k.tan + ' mg/L', 'k', `<span class="small">toxic part ≈ ${x.ammonia.nh3} mg/L (${x.ammonia.fractionPct}%)</span>`);
  if ('no3' in k) row('Nitrate', k.no3 + ' mg/L', 'k', stat(k.no3 <= 45, false));
  if ('cl' in k) row('Free chlorine', k.cl + ' mg/L', 'k');
  if ('hard' in k) row('Hardness', k.hard + ' mg/L', 'k', stat(k.hard <= 200, k.hard <= 600));
  if ('fe' in k) row('Iron', k.fe + ' mg/L', 'k', stat(k.fe <= 0.3, false));
  if (k.h2s) row('H₂S vial (bacteria screen)', k.h2s === 'pos' ? 'Positive' : 'Negative', 'k', k.h2s === 'pos' ? pill('Not', 'contamination likely') : pill('ok', 'no sign'));
  return rows.join('');
}

function panelHTML(s) {
  const m = s.latest, x = L.assess(m, optsFor(m));
  const dev = st.devices[m.device] && st.devices[m.device].name ? st.devices[m.device].name : m.device;
  const head = `<div style="display:flex;justify-content:space-between;gap:8px;align-items:start">
      <div><div class="big" style="font-size:20px">${esc(s.name)}${m.test ? '<span class="tag-test">TEST</span>' : ''}${m.mode === 'dynamic' ? '<span class="tag-test" style="background:#1f6f8b">BOAT</span>' : ''}</div>
      <div class="small">Measured ${esc(when(m.ts))} (${L.timeAgo(m.ts)}) · ${esc(dev)} · ${L.MODELS[modelOf(m)].name}</div>
      <div class="small">${s.lat.toFixed(5)}, ${s.lon.toFixed(5)} · ${s.items.length} measurement${s.items.length > 1 ? 's' : ''} at this spot</div></div>
      <button class="b" id="closePanel">✕</button></div>`;
  if (!x.valid) return `<div class="card">${head}<div class="banner err" style="margin-top:10px">This reading could not be analysed (a sensor value is missing or out of range).</div></div>`;
  const type = typeOf(s), u = x.a.uses, alerts = L.alertsForMeasurement(m, s.items.slice(0, -1), { optsFor });
  const advice = x.advice(type), fish = x.fish(type === 'pit'), kl = st.kits[m.id] || {};
  const sevIcon = { ok: '✓', info: 'ℹ', warn: '!', bad: '✕' };
  const useRow = (name, o) => `<div class="fishrow"><div style="display:flex;justify-content:space-between;gap:8px"><b>${name}</b>${usePill(o.status)}</div>${(o.reasons || o.advisories || []).slice(0, 3).map(t => `<div class="small">• ${esc(t)}</div>`).join('')}</div>`;
  return `
  <div class="card">${head}
    <div style="margin-top:10px"><div style="font-size:26px;font-weight:700;color:${x.color}">${esc(x.label)}</div>
      <div style="font-weight:600;margin-top:2px">Best use: ${esc(tr(x.bestUse))}</div>
      ${band(x)}
      <div class="small">Drinking-water index (WQI) ${x.wqi} · lower is better, 100 = at the BIS limit${x.a.wqi.floorApplied ? ' · level capped because one reading is beyond the BIS limit' : ''}</div>
      <div style="margin-top:6px"><span class="pill ${x.confidence.level}">Reading confidence: ${x.confidence.level} (${x.confidence.score}%)</span></div></div>
    ${x.confidence.notes.length ? `<div class="small" style="margin-top:6px">⚠ ${x.confidence.notes.map(esc).join(' · ')}</div>` : ''}
    ${typeof m.calDays === 'number' && m.calDays > 30 ? `<div class="banner" style="margin:8px 0 0">Calibration reminder: sensors were last calibrated ${m.calDays} days ago. Recalibrate pH (buffer 4.01 and 6.86/7.0) and EC (1413 µS/cm solution).</div>` : ''}
  </div>

  <div class="card">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><h3 style="margin:0">Purification advisor · पानी का प्रकार</h3>
      <span class="seg"><button data-lang="en" class="${st.lang === 'en' ? 'on' : ''}">EN</button><button data-lang="hi" class="${st.lang === 'hi' ? 'on' : ''}">हिं</button></span></div>
    <div class="seg wide" style="margin:8px 0">${TYPES.map(t => `<button data-type="${t[0]}" class="${type === t[0] ? 'on' : ''}" title="${t[3]}">${st.lang === 'hi' ? t[2] : t[1]}</button>`).join('')}</div>
    ${advice.map(a => `<div class="adv ${a.sev}"><span>${sevIcon[a.sev]}</span><div>${esc(st.lang === 'hi' ? a.hi : a.en)}</div></div>`).join('')}
    <div class="disc">Advice only. HydraSense does not purify water or add anything to it.</div>
  </div>

  ${type === 'pit' ? `<div class="card"><h3>Mining contamination risk</h3>
    <div style="display:flex;align-items:baseline;gap:10px"><span class="big">${x.mining.index}<span class="small">/100</span></span>${pill(x.mining.level === 'Low' ? 'ok' : x.mining.level === 'Moderate' ? 'warning-bg' : 'Not', x.mining.level)}<span class="small">Evidence: ${x.mining.evidence}${x.mining.hasIron ? ' (with iron kit)' : ' (sensors only)'}</span></div>
    <div class="band"><i style="background:#1a9850;flex:30"></i><i style="background:#fdae61;flex:30"></i><i style="background:#a50026;flex:40"></i><u style="left:${x.mining.index}%"></u></div>
    <div class="small">${x.mining.parts.length ? 'Why: ' + x.mining.parts.map(esc).join(', ') : 'No acid, salt or turbidity signal in these readings.'}</div>
    <div class="disc">This only signals <b>suspected</b> mining pollution. Heavy metals are not measured. A High result means: get a lab test.</div></div>` : ''}

  <div class="card"><h3>Readings</h3>
    <div style="overflow:auto"><table class="rt">${readingRows(m, x)}</table></div>
    <details style="margin-top:8px" ${Object.keys(kl).length ? 'open' : ''}><summary>Add test-kit values ${srcTag('k')}</summary>
      <div class="kitgrid">${KIT_FIELDS.map(f => `<label>${f[1]}<input type="number" min="0" step="${f[2]}" data-kit="${f[0]}" value="${kl[f[0]] ?? ''}"></label>`).join('')}
        <label>H₂S vial<select data-kit="h2s"><option value="">not done</option><option value="neg" ${kl.h2s === 'neg' ? 'selected' : ''}>negative (no colour change)</option><option value="pos" ${kl.h2s === 'pos' ? 'selected' : ''}>positive (turned black)</option></select></label></div>
      <div class="row" style="margin:8px 0 0"><button class="b pri" id="kitApply">Apply</button><button class="b" id="kitClear">Clear</button></div>
      <div class="disc">Values typed here stay in this browser only. The admin can save kit results to the record from the admin page. A kit value replaces the estimate.</div></details>
  </div>

  <div class="card"><h3>Use-wise result</h3>
    ${useRow('Drinking', u.drinking)}${useRow('Irrigation', u.irrigation)}${useRow('Fish culture', u.fish)}${useRow('Industrial cooling / disposal', u.industrial)}
    <div class="disc">${esc(u.drinking.note)}</div></div>

  ${type !== 'drink' ? `<div class="card"><h3>Fish suitability${type === 'pit' ? ' (pit lake)' : ''}</h3>
    ${fish.map(f => `<div class="fishrow"><div style="display:flex;justify-content:space-between;gap:8px"><b>${esc(f.name)}</b><span>${usePill(f.status)}${f.status === 'suitable' && !f.oxygenVerified ? ' <span class="small">oxygen not verified</span>' : ''}</span></div>${f.reasons.slice(0, 3).map(t => `<div class="small">• ${esc(t)}</div>`).join('')}</div>`).join('')}
    <div class="disc">Indicative only. Dissolved oxygen${x.oxygen.measured ? '' : ' and'} ammonia decide most fish kills${x.oxygen.measured ? '; ammonia needs a kit' : ' and are not measured by the sensors'}.</div></div>` : ''}

  <div class="card"><h3>Alerts for this measurement</h3>
    ${alerts.length ? alerts.map(a => `<div class="al ${a.severity}" style="cursor:default"><b>${a.severity.toUpperCase()}</b> · ${esc(a.msg)}</div>`).join('') : '<div class="small">No alerts.</div>'}
    <div style="margin-top:8px"><button class="b" id="goHist">View history of this spot</button></div></div>`;
}

function renderPanel() {
  const el = $('#panel');
  const s = st.selected && spotById(st.selected);
  if (s) {
    el.innerHTML = panelHTML(s);
    $('#closePanel').onclick = () => { st.selected = null; render(); };
    const gh = $('#goHist'); if (gh) gh.onclick = () => { setView('history'); $('#histSpot').value = s.id; render(); };
    el.querySelectorAll('[data-type]').forEach(b => b.onclick = () => { st.types[s.id] = b.dataset.type; store.set('types', st.types); renderPanel(); });
    el.querySelectorAll('[data-lang]').forEach(b => b.onclick = () => { st.lang = b.dataset.lang; store.set('lang', st.lang); renderPanel(); });
    const id = s.latest.id, saveKit = v => { if (v) st.kits[id] = v; else delete st.kits[id]; store.set('kits', st.kits); recompute(); };
    const ka = $('#kitApply'); if (ka) ka.onclick = () => {
      const v = {};
      el.querySelectorAll('[data-kit]').forEach(i => { const k = i.dataset.kit; if (k === 'h2s') { if (i.value) v.h2s = i.value; } else { const n = parseFloat(i.value); if (isFinite(n) && n >= 0) v[k] = n; } });
      saveKit(Object.keys(v).length ? v : null);
    };
    const kc = $('#kitClear'); if (kc) kc.onclick = () => saveKit(null);
    return;
  }
  if (!st.spots.length) {
    el.innerHTML = `<div class="card empty"><div style="font-size:18px;color:var(--tx);margin-bottom:6px">No measurements yet</div>
      Switch on a HydraSense device and take a measurement. A node will appear on the map at the place where it was measured.
      ${st.all.some(m => m.test) && !st.showTest ? '<div style="margin-top:8px">Test data exists - tick “show test data” above to see it.</div>' : ''}</div>`;
    return;
  }
  const rows = [...st.spots].sort((a, b) => b.latest.ts - a.latest.ts).map(s => {
    const q = Q(s.latest);
    return `<tr data-id="${esc(s.id)}" style="cursor:pointer"><td>${esc(s.name)}</td><td><span class="pill" style="background:${q.color}">${esc(q.label)}</span></td><td class="small">${esc(q.bestUse[0])}</td><td class="small">${L.timeAgo(s.latest.ts)}</td></tr>`;
  }).join('');
  el.innerHTML = `<div class="card"><h3>Measured spots (${st.spots.length})</h3><table>${rows}</table>
    <div class="disc">Tap a marker or a row for full details. Spots within ${SPOT_RADIUS_M} m are grouped together.</div></div>`;
  el.querySelectorAll('tr[data-id]').forEach(r => r.onclick = () => { st.selected = r.dataset.id; render(); const s = spotById(st.selected); if (s && map) map.setView([s.lat, s.lon], Math.max(map.getZoom(), 15)); });
}

/* ---------------------------------------------------------------- history */
const wq = m => { const q = Q(m); return q.valid ? q.wqi : null; };
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
    <div class="card"><h3>Drinking-water index (WQI) over visits · lower is better</h3><canvas id="hW"></canvas></div>
    <div class="card"><h3>pH</h3><canvas id="hP"></canvas></div>
    <div class="card"><h3>TDS (mg/L)</h3><canvas id="hT"></canvas></div>
    <div class="card"><h3>Turbidity (NTU) and temperature (°C)</h3><canvas id="hU"></canvas></div></div>
    <div class="card"><h3>All measurements at ${esc(s.name)}</h3><div style="overflow:auto"><table><tr><th>Time</th><th>Device</th><th>pH</th><th>TDS</th><th>Temp</th><th>Turb</th><th>WQI</th><th>Level</th><th>Confidence</th></tr>
    ${[...s.items].reverse().map(m => { const c = L.confidence(m), q = Q(m); return `<tr><td>${esc(when(m.ts))}${m.test ? '<span class="tag-test">TEST</span>' : ''}</td><td>${esc(m.device)}</td><td>${m.ph.toFixed(2)}</td><td>${q.valid ? Math.round(q.r.tds) : '-'}</td><td>${m.temp.toFixed(1)}</td><td>${m.turb.toFixed(1)}</td><td>${q.valid ? q.wqi : '-'}</td><td>${esc(q.label)}</td><td>${c.level}</td></tr>`; }).join('')}
    </table></div></div>`;
  mk('hW', 'line', lb, [line('WQI', s.items.map(wq), '#2bb3d6')], { scales: { y: { min: 0, ticks: { color: '#8fa9bd' }, grid: { color: '#23415c' } } } });
  mk('hP', 'line', lb, [line('pH', s.items.map(m => m.ph), '#91cf60')]);
  mk('hT', 'line', lb, [line('TDS', s.items.map(m => { const q = Q(m); return q.valid ? Math.round(q.r.tds) : null; }), '#fdae61')]);
  mk('hU', 'line', lb, [line('Turbidity', s.items.map(m => m.turb), '#f46d43'), line('Temp', s.items.map(m => m.temp), '#b39ddb', 'y1')], { scales: { y1: { position: 'right', ticks: { color: '#8fa9bd' }, grid: { display: false } } } });
}

function downloadCsv(s) {
  const rows = [['time_iso', 'device', 'mode', 'lat', 'lon', 'ph', 'ec_us_cm', 'tds_mg_l', 'tds_approx', 'temp_c', 'turb_ntu', 'orp_mv', 'do_mg_l', 'wqi', 'level', 'best_use', 'test']];
  for (const m of s.items) { const q = Q(m), r = q.r || {}; rows.push([new Date(m.ts * 1000).toISOString(), m.device, m.mode || 'static', m.lat, m.lon, m.ph, m.ec ?? '', q.valid ? Math.round(r.tds) : m.tds, r.tdsApprox ? 1 : 0, m.temp, m.turb, m.orp ?? '', m.do ?? '', q.wqi ?? '', q.label, '"' + q.bestUse[0] + '"', m.test ? 1 : 0]); }
  const blob = new Blob([rows.map(r => r.join(',')).join('\n')], { type: 'text/csv' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `hydrasense_${s.id}.csv`; a.click();
}

/* ---------------------------------------------------------------- compare */
let picked = null;
function renderCompare() {
  if (!picked) picked = new Set(st.spots.slice(0, 5).map(s => s.id));
  $('#cmpPick').innerHTML = st.spots.map(s => `<label class="card" style="padding:6px 10px;margin:0"><input type="checkbox" data-id="${esc(s.id)}" ${picked.has(s.id) ? 'checked' : ''}> ${esc(s.name)}</label>`).join('') || '<span class="small">No spots yet.</span>';
  $('#cmpPick').querySelectorAll('input').forEach(i => i.onchange = () => { i.checked ? picked.add(i.dataset.id) : picked.delete(i.dataset.id); renderCompare(); });
  const ds = st.spots.filter(s => picked.has(s.id)), qs = ds.map(s => Q(s.latest));
  mk('cmpChart', 'bar', ds.map(s => s.name), [{ label: 'WQI (lower is better)', data: qs.map(q => q.wqi), backgroundColor: qs.map(q => q.color) }],
    { plugins: { legend: { display: false } }, scales: { y: { min: 0, ticks: { color: '#8fa9bd' }, grid: { color: '#23415c' } } } });
  $('#cmpTable').innerHTML = ds.length ? `<div style="overflow:auto"><table><tr><th>Spot</th><th>Level</th><th>WQI</th><th>pH</th><th>TDS</th><th>Turb</th><th>°C</th><th>Best use</th></tr>` +
    ds.map((s, i) => { const m = s.latest, q = qs[i]; return `<tr><td>${esc(s.name)}</td><td><span class="pill" style="background:${q.color}">${esc(q.label)}</span></td><td>${q.wqi ?? '-'}</td><td>${m.ph.toFixed(2)}</td><td>${q.valid ? Math.round(q.r.tds) : '-'}</td><td>${m.turb.toFixed(1)}</td><td>${m.temp.toFixed(1)}</td><td class="small">${esc(q.bestUse[0])}</td></tr>`; }).join('') + '</table></div>' : 'Select two or more spots.';
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

/* ---------------------------------------------------------------- boat control (Dynamic mode) */
// Safety model: hold-to-run. The page sends a command every 250 ms only while a control is held; releasing sends Stop.
// The boat itself stops if commands stop arriving (firmware timeout), so a lost connection never leaves motors running.
const bt = { id: null, user: null, status: null, driver: null, offset: 0, requested: false, arm: false, max: 60, trimL: 100, trimR: 100,
  seq: Date.now() % 1000000, vec: null, tail: 0, key: null, trail: [], unwatch: null, unreq: null, sentAt: 0, err: '', started: false, keys: new Set() };
const boatIds = () => Object.keys(st.devices).filter(id => st.devices[id] && st.devices[id].boat);
const online = () => !!bt.status && (Date.now() + bt.offset - (bt.status.seen || 0)) < 6000;
const isDriver = () => !!(bt.user && bt.driver && bt.driver.uid === bt.user.uid);
const isAdmin = () => !!(bt.user && bt.user.email === ADMIN_EMAIL);

function mix(x, y) {            // x: right +, y: forward +  ->  left / right motor in % (-100..100)
  const l = y + x, r = y - x, k = Math.max(1, Math.abs(l), Math.abs(r));
  return [l / k * bt.max * bt.trimL / 100, r / k * bt.max * bt.trimR / 100];
}
async function sendCmd(l, r, extra = {}) {
  if (!bt.id || !bt.user) return;
  bt.seq = bt.seq % 1000000 + 1; bt.sentAt = Date.now();
  try { await boat.send(bt.id, { l: Math.round(l), r: Math.round(r), arm: bt.arm, estop: false, seq: bt.seq, by: bt.user.uid, ...extra }); bt.err = ''; }
  catch (e) { bt.err = 'Command was not accepted: ' + e.message; }
}
function setVec(v) {
  if (!isDriver()) return;
  bt.vec = v && bt.arm ? v : null;
  if (bt.vec) { const [l, r] = mix(v.x, v.y); sendCmd(l, r); } else { sendCmd(0, 0); bt.tail = 2; }
}
function eStop() { bt.arm = false; bt.vec = null; bt.tail = 0; sendCmd(0, 0, { arm: false, estop: true }); renderBoat(true); }
setInterval(() => {
  if (st.mode !== 'dynamic' || !isDriver()) return;
  if (bt.vec && bt.arm) { const [l, r] = mix(bt.vec.x, bt.vec.y); sendCmd(l, r); }
  else if (bt.tail > 0) { bt.tail--; sendCmd(0, 0); }
  else if (bt.arm && Date.now() - bt.sentAt > 1000) sendCmd(0, 0);          // heartbeat while armed
}, 250);

async function startBoat() {
  const ids = boatIds();
  if (!bt.started) { bt.started = true; boat.onUser(u => { bt.user = u; watchReq(); renderBoat(true); }).catch(() => {}); }
  const id = ids.includes(bt.id) ? bt.id : ids[0] || null;
  if (id !== bt.id || !bt.unwatch) {
    if (bt.unwatch) bt.unwatch(); bt.unwatch = null;
    bt.id = id; bt.status = null; bt.driver = null; bt.trail = []; bt.arm = false;
    if (id) bt.unwatch = await boat.watch(id, s => { bt.status = s.status; bt.driver = s.driver; bt.offset = s.offset; boatTick(); });
    watchReq();
  }
  renderBoat(true);
}
async function watchReq() {
  if (bt.unreq) { bt.unreq(); bt.unreq = null; }
  bt.requested = false;
  if (bt.id && bt.user) bt.unreq = await boat.watchRequest(bt.id, bt.user.uid, v => { bt.requested = v; renderBoat(); });
}
function boatTick() {
  const s = bt.status;
  if (s && bt.arm && s.estop) bt.arm = false;                 // physical emergency stop pressed on the boat
  if (!isDriver()) { bt.arm = false; bt.vec = null; }
  if (s && isFinite(s.lat) && isFinite(s.lon) && (s.lat || s.lon)) {
    const p = bt.trail[bt.trail.length - 1];
    if (!p || L.haversine(p[0], p[1], s.lat, s.lon) > 0.5) { bt.trail.push([s.lat, s.lon]); if (bt.trail.length > 400) bt.trail.shift(); }
  }
  drawBoatOnMap(); renderBoat();
}
function drawBoatOnMap() {
  if (!st.mapReady) return;
  boatLayer.clearLayers();
  if (st.mode !== 'dynamic' || !bt.trail.length) return;
  window.L.polyline(bt.trail, { color: '#2bb3d6', weight: 2, dashArray: '4 4' }).addTo(boatLayer);
  const p = bt.trail[bt.trail.length - 1];
  window.L.circleMarker(p, { radius: 8, color: '#fff', weight: 3, fillColor: online() ? '#2bb3d6' : '#777', fillOpacity: 1 }).addTo(boatLayer).bindTooltip('Boat' + (online() ? '' : ' (offline, last known position)'));
}

function renderBoat(force) {
  if (st.view !== 'boat') return;
  const ids = boatIds(), role = !bt.id ? 'none' : !bt.user ? 'anon' : isDriver() ? 'driver' : 'viewer';
  const key = [bt.id, role, bt.requested, bt.arm, bt.driver && bt.driver.uid, ids.length, isAdmin()].join('|');
  if (force || key !== bt.key) { bt.key = key; buildBoat(ids, role); }
  const set = (id, html) => { const e = document.getElementById(id); if (e && e.innerHTML !== html) e.innerHTML = html; };
  const s = bt.status, on = online();
  set('bConn', !bt.id ? '' : on ? pill('ok', 'Boat online') : pill('Not', s ? 'Boat offline' : 'Boat has never connected'));
  set('bInfo', !s ? '' : `<div class="small">${on ? '' : 'Last seen ' + L.timeAgo((s.seen || 0) / 1000, (Date.now() + bt.offset) / 1000) + ' · '}${typeof s.batt === 'number' ? 'Battery ' + s.batt.toFixed(1) + ' V · ' : ''}${typeof s.rssi === 'number' ? 'Wi-Fi ' + s.rssi + ' dBm' : ''}</div>`);
  set('bArm', !s ? '' : s.estop ? pill('Not', 'EMERGENCY STOP active') : s.armed ? pill('warning-bg', 'Motors armed') : pill('ok', 'Motors safe (disarmed)'));
  const bar = v => `<div class="mbar"><i style="${v >= 0 ? 'left:50%' : 'right:50%'};width:${Math.min(50, Math.abs(v) / 2)}%"></i></div>`;
  set('bMot', !s ? '' : `<div class="mrow"><span>Motor 1 (left)</span>${bar(s.l || 0)}<b>${Math.round(s.l || 0)}%</b></div><div class="mrow"><span>Motor 2 (right)</span>${bar(s.r || 0)}<b>${Math.round(s.r || 0)}%</b></div>`);
  set('bDrv', bt.driver ? `Driver: <b>${esc(bt.driver.name || 'someone')}</b>` : 'No driver has been allowed yet.');
  if (role === 'driver') {
    const ok = s && s.seq === bt.seq, late = Date.now() - bt.sentAt > 1500;
    set('bAck', bt.err ? `<span style="color:#ff9f97">${esc(bt.err)}</span>` : !on ? '<span style="color:#ff9f97">Boat is offline. Commands will not reach it.</span>' : !bt.sentAt ? '' : ok ? 'Boat confirmed the last command.' : late ? '<span style="color:#ffcf7a">No confirmation from the boat yet.</span>' : 'Sending…');
  }
}

function buildBoat(ids, role) {
  if (bt.vec) { bt.vec = null; sendCmd(0, 0); bt.tail = 2; }   // controls are being rebuilt: never leave a held command behind
  const pick = ids.length > 1 ? `<select id="bPick">${ids.map(i => `<option value="${esc(i)}" ${i === bt.id ? 'selected' : ''}>${esc(st.devices[i].name || i)}</option>`).join('')}</select>` : '';
  $('#boatStatus').innerHTML = `<h3>Boat status ${pick}</h3>${bt.id ? `<div class="row" style="margin-bottom:6px"><span id="bConn"></span><span id="bArm"></span></div><div id="bInfo"></div><div id="bMot" style="margin-top:8px"></div><div class="small" id="bDrv" style="margin-top:8px"></div>
    <div class="disc">Status comes from the boat itself, about once a second. A command shown as sent is not proof that the motors moved: watch the motor bars and the boat.</div>` : '<div class="empty">No boat is registered. The admin can mark a device as “has boat base” on the admin page.</div>'}`;
  const sim = boat.sim ? '<div class="banner">Simulated boat (demo mode). No real motors are connected.</div>' : '';
  let h = '';
  if (role === 'none') h = '';
  else if (role === 'anon') h = `<p>Anyone can watch. To drive the boat, sign in and ask the admin for control.</p><button class="b pri" id="bSign">Sign in with Google</button>`;
  else if (role === 'viewer') h = `<p class="small">Signed in as ${esc(bt.user.name)} · <a href="#" id="bOut">sign out</a></p>
    ${bt.driver ? '<p>The boat is under someone else’s control right now.</p>' : ''}
    ${bt.requested ? '<p><b>Request sent.</b> Waiting for the admin to allow you.</p><button class="b" id="bCancel">Cancel request</button>' : '<button class="b pri" id="bReq">Request control</button>'}
    ${isAdmin() ? '<p class="small" style="margin-top:10px">You are the admin: allow a driver (or yourself) from the admin page. Emergency stop works for you at any time.</p><button class="estop" id="bStop">EMERGENCY STOP</button>' : ''}`;
  else h = `<p class="small">You are the driver (${esc(bt.user.name)}) · <a href="#" id="bOut">sign out</a></p>
    <div class="row"><button class="b ${bt.arm ? '' : 'pri'}" id="bArmBtn">${bt.arm ? 'Disarm motors' : 'Arm motors'}</button><button class="estop" id="bStop">EMERGENCY STOP</button></div>
    <div id="bAck" class="small" style="min-height:18px"></div>
    <div class="ctl ${bt.arm ? '' : 'off'}">
      <div class="dpad"><button data-v="0,1" style="grid-area:f">▲<small>Forward</small></button><button data-v="-0.7,0" style="grid-area:l">◀<small>Left</small></button><button data-stop style="grid-area:s">■<small>Stop</small></button><button data-v="0.7,0" style="grid-area:r">▶<small>Right</small></button><button data-v="0,-1" style="grid-area:b">▼<small>Reverse</small></button></div>
      <div class="joy" id="joy"><i id="knob"></i></div>
    </div>
    <label class="sl">Speed limit <b id="vMax">${bt.max}%</b><input type="range" min="20" max="100" step="5" value="${bt.max}" id="sMax"></label>
    <label class="sl">Motor 1 (left) <b id="vL">${bt.trimL}%</b><input type="range" min="50" max="100" step="5" value="${bt.trimL}" id="sL"></label>
    <label class="sl">Motor 2 (right) <b id="vR">${bt.trimR}%</b><input type="range" min="50" max="100" step="5" value="${bt.trimR}" id="sR"></label>
    <div class="row" style="margin-top:8px"><button class="b" id="bMeas">Stop and measure here</button></div>
    <div class="disc">Hold a button or the joystick to move; let go to stop. Keyboard: arrow keys or W A S D, Space = emergency stop. The boat stops by itself if the connection is lost.</div>`;
  $('#boatCtl').innerHTML = `<h3>Boat control</h3>${sim}${h}`;
  const on = (id, f) => { const e = document.getElementById(id); if (e) e.onclick = ev => { ev.preventDefault(); f(); }; };
  const pk = $('#bPick'); if (pk) pk.onchange = () => { bt.id = pk.value; if (bt.unwatch) bt.unwatch(); bt.unwatch = null; startBoat(); };
  on('bSign', () => boat.signIn().catch(e => alert('Sign-in failed: ' + e.message)));
  on('bOut', () => { if (isDriver()) eStop(); boat.signOut(); });
  on('bReq', () => boat.request(bt.id, bt.user).catch(e => alert('Could not send the request: ' + e.message)));
  on('bCancel', () => boat.cancel(bt.id, bt.user).catch(() => {}));
  on('bStop', eStop);
  on('bArmBtn', () => { bt.arm = !bt.arm; bt.vec = null; sendCmd(0, 0); renderBoat(true); });
  on('bMeas', () => { bt.vec = null; sendCmd(0, 0, { m: Date.now() % 1000000000 }); const b = $('#bMeas'); b.textContent = boat.sim ? 'Simulated boat cannot measure' : 'Measurement requested ✓'; setTimeout(() => (b.textContent = 'Stop and measure here'), 2500); });
  const sl = (id, out, prop) => { const e = document.getElementById(id); if (e) e.oninput = () => { bt[prop] = +e.value; document.getElementById(out).textContent = e.value + '%'; }; };
  sl('sMax', 'vMax', 'max'); sl('sL', 'vL', 'trimL'); sl('sR', 'vR', 'trimR');
  document.querySelectorAll('.dpad button').forEach(b => {
    if (b.dataset.stop !== undefined) { b.onpointerdown = () => setVec(null); return; }
    const [x, y] = b.dataset.v.split(',').map(Number);
    b.onpointerdown = e => { e.preventDefault(); try { b.setPointerCapture(e.pointerId); } catch (_) {} setVec({ x, y }); };
    b.onpointerup = b.onpointercancel = b.onlostpointercapture = () => setVec(null);
    b.oncontextmenu = e => e.preventDefault();
  });
  const joy = $('#joy'), knob = $('#knob');
  if (joy) {
    const move = e => { const r = joy.getBoundingClientRect(), R = r.width / 2; let x = (e.clientX - r.left - R) / R, y = (e.clientY - r.top - R) / R; const d = Math.hypot(x, y); if (d > 1) { x /= d; y /= d; }
      knob.style.transform = `translate(${x * R * 0.6}px,${y * R * 0.6}px)`; setVec(Math.hypot(x, y) < 0.15 ? null : { x: x * 0.7, y: -y }); };
    const end = () => { joy.dataset.on = ''; knob.style.transform = ''; setVec(null); };
    joy.onpointerdown = e => { e.preventDefault(); joy.dataset.on = '1'; try { joy.setPointerCapture(e.pointerId); } catch (_) {} move(e); };
    joy.onpointermove = e => { if (joy.dataset.on) move(e); };
    joy.onpointerup = joy.onpointercancel = joy.onlostpointercapture = end;
  }
}
const KEYS = { ArrowUp: [0, 1], w: [0, 1], ArrowDown: [0, -1], s: [0, -1], ArrowLeft: [-0.7, 0], a: [-0.7, 0], ArrowRight: [0.7, 0], d: [0.7, 0] };
function keyVec() { let x = 0, y = 0; bt.keys.forEach(k => { x += KEYS[k][0]; y += KEYS[k][1]; }); return x || y ? { x: Math.max(-1, Math.min(1, x)), y: Math.max(-1, Math.min(1, y)) } : null; }
addEventListener('keydown', e => {
  if (st.view !== 'boat' || st.mode !== 'dynamic' || !isDriver() || /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
  if (e.key === ' ') { e.preventDefault(); eStop(); return; }
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (KEYS[k] && !e.repeat) { e.preventDefault(); bt.keys.add(k); setVec(keyVec()); } else if (KEYS[k]) e.preventDefault();
});
addEventListener('keyup', e => { const k = e.key.length === 1 ? e.key.toLowerCase() : e.key; if (bt.keys.delete(k) && isDriver()) setVec(keyVec()); });
const release = () => { bt.keys.clear(); if (bt.vec) setVec(null); };
addEventListener('blur', release);
document.addEventListener('visibilitychange', () => { if (document.hidden) release(); });

/* ---------------------------------------------------------------- shell */
function setMode(m) {
  st.mode = m === 'dynamic' ? 'dynamic' : 'static'; store.set('mode', st.mode);
  document.querySelectorAll('#modeSeg button').forEach(b => b.classList.toggle('on', b.dataset.mode === st.mode));
  $('#navBoat').style.display = st.mode === 'dynamic' ? '' : 'none';
  if (st.mode === 'static') { if (bt.vec || bt.arm) eStop(); if (st.view === 'boat') return setView('map'); }
  else startBoat();
  drawBoatOnMap(); render();
}
function setView(v) {
  if (st.view === 'boat' && v !== 'boat') release();
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
  else if (st.view === 'boat') renderBoat();
}

document.querySelectorAll('#nav button').forEach(b => b.onclick = () => setView(b.dataset.view));
document.querySelectorAll('#modeSeg button').forEach(b => b.onclick = () => setMode(b.dataset.mode));
$('#histSpot').onchange = () => renderHistory();
$('#showTest').onchange = e => { st.showTest = e.target.checked; recompute(); };

try { initMap(); } catch (e) { $('#banner').innerHTML = '<div class="banner err">Map could not load (check internet connection).</div>'; }
setMode(st.mode);
connect({
  onMeasurements: list => { st.all = list; recompute(); },
  onDevices: d => { st.devices = d || {}; if (st.mode === 'dynamic') startBoat(); recompute(); },
  onSettings: s => { st.settings = s || {}; recompute(); },
  onStatus: (text, ok) => { st.status = { text, ok }; render(); },
});
