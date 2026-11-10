import assert from 'node:assert/strict';
import * as L from '../js/logic.js';

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok -', name); };
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

const clean = { device: 'HS-001', ts: 1000, lat: 22.5726, lon: 88.3639, ph: 7.3, tds: 220, temp: 27, turb: 1.5 };
const drain = { ...clean, ph: 5.0, tds: 1800, turb: 90, temp: 36 };

t('WQI ordering', () => {
  assert.ok(L.wqi(clean) > 90, 'clean should be excellent');
  assert.ok(L.wqi(drain) < 25, 'drain should be very poor');
  assert.equal(L.category(L.wqi(clean)).name, 'Excellent');
  assert.equal(L.category(L.wqi(drain)).name, 'Very Poor');
});
t('python parity (server wqi.py): ph7.1 tds200 temp26 turb1 -> 100', () => {
  assert.equal(L.wqi({ ph: 7.1, tds: 200, temp: 26, turb: 1 }), 100);
});
t('DO saturation known values (APHA table)', () => {
  near(L.doSaturation(20), 9.09, 0.05, '20C');
  near(L.doSaturation(25), 8.26, 0.05, '25C');
  near(L.doSaturation(30), 7.56, 0.05, '30C');
});
t('Ammonia toxic fraction (Emerson) matches literature', () => {
  near(L.ammoniaFraction(7, 25), 0.0057, 0.001, 'pH7 25C ~0.57%');
  near(L.ammoniaFraction(8, 25), 0.0539, 0.004, 'pH8 25C ~5.4%');
  near(L.ammoniaFraction(9, 25), 0.36, 0.02, 'pH9 25C ~36%');
  assert.ok(L.ammoniaFraction(8.5, 30) > L.ammoniaFraction(8.5, 20), 'warmer = more toxic');
});
t('use classes', () => {
  const a = L.assess(clean);
  assert.equal(a.classes.overall, 'A');
  const d = L.assess(drain);
  assert.equal(d.classes.overall, 'E');
  const farm = L.assess({ ...clean, tds: 900, turb: 12 });
  assert.ok(['B', 'C', 'BC'].includes(farm.classes.overall), 'farm water: ' + farm.classes.overall);
});
t('fish evaluation', () => {
  const a = L.assess(clean);
  const rohu = a.fish.find(f => f.id === 'rohu');
  assert.equal(rohu.level, 'Suitable');
  const cold = L.assess({ ...clean, temp: 12 });
  assert.equal(cold.fish.find(f => f.id === 'pangasius').level, 'Not suitable');
  const acid = L.assess({ ...clean, ph: 5.0 });
  assert.equal(acid.fish.find(f => f.id === 'rohu').level, 'Not suitable');
});
t('oxygen risk and ammonia notes cap fish at Marginal', () => {
  const hot = L.assess({ ...clean, temp: 34, turb: 55, ph: 9.1 });
  assert.equal(hot.est.oxygen.risk, 'High');
  assert.notEqual(hot.fish.find(f => f.id === 'tilapia').level, 'Suitable');
});
t('manual test-kit ammonia is used when provided', () => {
  const e = L.estimates({ ...clean, ph: 8.5, temp: 30, tan: 1.0 });
  assert.ok(e.ammonia.nh3mgL > 0.15 && e.ammonia.nh3Status === 'danger');
});
t('confidence', () => {
  assert.equal(L.confidence(clean).level, 'High');
  assert.equal(L.confidence({ ...clean, flags: 1 | 2, stable: false }).level, 'Low');
  assert.equal(L.confidence({ ...clean, flags: 16 }).level, 'High');
});
t('spots cluster within 50 m only', () => {
  const m = (ts, dLat) => ({ ...clean, ts, lat: 22.5726 + dLat });
  // 0.0002 deg lat ~ 22 m ; 0.001 deg ~ 111 m
  const spots = L.clusterSpots([m(1, 0), m(2, 0.0002), m(3, 0.001), m(4, 0.00005)]);
  assert.equal(spots.length, 2);
  assert.equal(spots.find(s => s.items.length === 3).items.length, 3);
});
t('no-GPS measurements are excluded from spots', () => {
  assert.equal(L.clusterSpots([{ ...clean, lat: 0, lon: 0 }]).length, 0);
});
t('alerts: thresholds, sudden drop, suppressed when low confidence', () => {
  const hist = [1, 2, 3, 4].map(i => ({ ...clean, ts: i * 100 }));
  const bad = { ...drain, ts: 1000 };
  const al = L.alertsForMeasurement(bad, hist);
  assert.ok(al.some(a => a.kind === 'drop'), 'drop alert');
  assert.ok(al.some(a => a.kind === 'ph'));
  const low = L.alertsForMeasurement({ ...bad, flags: 3, stable: false }, hist);
  assert.equal(low.length, 1);
  assert.equal(low[0].severity, 'info');
});
t('first visit gets threshold alerts but no history alerts', () => {
  const al = L.alertsForMeasurement({ ...drain, ts: 5 }, []);
  assert.ok(al.length > 0 && !al.some(a => a.kind === 'drop' || a.kind === 'anomaly'));
});
console.log(`\n${n} tests passed`);
