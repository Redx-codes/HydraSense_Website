import assert from 'node:assert/strict';
import { L, H } from './load.js';

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok -', name); };
const base = { device: 'HS-001', ts: 1000, lat: 22.5726, lon: 88.3639, ph: 7.4, tds: 180, temp: 27, turb: 0.8 };
const wide = { model: 'commercial' };

t('WQI matches the team logic document (section 5 table)', () => {
  const rows = [[7.0, 20, 0.2, 25, 2.7, 'Excellent'], [7.4, 180, 0.8, 27, 26.2, 'Good'], [8.5, 500, 1, 25, 73.3, 'Moderate'], [8.0, 250, 15, 29, 138.9, 'Very Poor'],
    [7.0, 2000, 0, 25, 133.3, 'Very Poor'], [3.5, 1500, 8, 28, 386.7, 'Very Poor'], [10, 100, 0, 25, 73.3, 'Poor']];
  for (const [ph, tds, turb, temp, wqi, label] of rows) {
    const q = L.quick({ ...base, ph, tds, turb, temp }, wide);
    assert.equal(q.wqi, wqi); assert.equal(q.label, label);
  }
});
t('best use text', () => {
  assert.equal(L.quick(base, wide).bestUse[0], 'Drinking (physical readings only)');
  assert.match(L.quick({ ...base, ph: 7, tds: 2000, turb: 0 }, wide).bestUse[0], /^Drinking only if no better source/);
  assert.equal(L.quick({ ...base, ph: 8, tds: 250, turb: 15, temp: 29 }, wide).bestUse[0], 'Fish culture');
});
t('EC converts to TDS with the factor', () => {
  const m = { ...base, ec: 1413 };
  assert.equal(Math.round(L.effective(m, wide).tds), 707);
  assert.equal(Math.round(L.effective(m, { ...wide, ecFactor: 0.64 }).tds), 904);
  assert.equal(L.effective(m, wide).tdsFromEc, true);
});
t('Lite probe: above 1000 mg/L is approximate; wide-range probe is not', () => {
  const m = { ...base, tds: 1400 };
  assert.equal(L.effective(m, { model: 'lite' }).tdsApprox, true);
  assert.equal(L.effective(m, {}).tdsApprox, true, 'unknown model is treated as Lite');
  assert.equal(L.effective(m, wide).tdsApprox, false);
  assert.equal(L.effective({ ...base, flags: 32 }, wide).tdsApprox, true, 'device flag bit 32');
});
t('mining risk index: example from the plan review (62 without iron, 53 with clean iron)', () => {
  const m = { ...base, ph: 5.0, tds: 1200, turb: 10 };
  const a = L.assess(m, wide).mining;
  assert.deepEqual([a.points, a.max, a.index, a.level, a.evidence], [56, 90, 62, 'High', 'Indicative']);
  const b = L.assess(m, { ...wide, kitLocal: { fe: 0 } }).mining;
  assert.deepEqual([b.max, b.index, b.level, b.evidence], [105, 53, 'Moderate', 'Moderate']);
  assert.equal(L.assess(base, wide).mining.index, 0);
  assert.equal(L.assess({ ...base, ph: 3.5, tds: 2500, turb: 40 }, { ...wide, kitLocal: { fe: 2 } }).mining.index, 100);
});
t('mining risk bands', () => {
  const pts = (ph, tds, turb) => L.miningRisk({ ph, tds, turbidity: turb, tdsApprox: false }).points;
  assert.deepEqual([pts(6.5, 0, 0), pts(6.4, 0, 0), pts(5.4, 0, 0), pts(4.4, 0, 0)], [0, 10, 20, 35]);
  assert.deepEqual([pts(7, 499, 0), pts(7, 500, 0), pts(7, 1001, 0), pts(7, 2001, 0)], [0, 8, 15, 25]);
  assert.deepEqual([pts(7, 0, 4.9), pts(7, 0, 5), pts(7, 0, 25.1)], [0, 6, 15]);
  assert.equal(L.miningRisk({ ph: 7, tds: 3000, turbidity: 0, tdsApprox: true }).points, 15, 'Lite probe cannot claim the 25-point band');
});
t('pit-lake fish: High mining risk caps every fish at Risky', () => {
  const x = L.assess({ ...base, ph: 5.6, tds: 1500, turb: 30, temp: 28 }, wide);
  assert.equal(x.mining.level, 'High');
  assert.ok(x.fish(true).every(f => f.status === 'risky' || f.status === 'not_suitable'));
  assert.ok(x.fish(false).every(f => f.status !== 'risky'), 'no cap outside pit-lake mode');
});
t('fish list has 5 species and uses measured oxygen when present', () => {
  const m = { ...base, ph: 7.6, tds: 300, turb: 12, temp: 29 };
  const f = L.assess(m, wide).fish(false);
  assert.deepEqual(f.map(s => s.name), ['Rohu', 'Catla', 'Common carp', 'Nile tilapia', 'Pangasius']);
  assert.ok(f.every(s => s.status === 'suitable' && !s.oxygenVerified));
  const low = Object.fromEntries(L.assess({ ...m, do: 3.5 }, wide).fish(false).map(s => [s.name, s.status]));
  assert.equal(low['Rohu'], 'not_suitable'); assert.equal(low['Nile tilapia'], 'marginal'); assert.equal(low['Common carp'], 'not_suitable');
});
t('kit values: record + local override, toxic ammonia', () => {
  const k = L.kitOf({ tan: 1, kit: { fe: 0.2, h2s: 'neg' } }, { fe: 0.5, h2s: 'pos' });
  assert.deepEqual(k, { tan: 1, fe: 0.5, h2s: 'pos' });
  const x = L.assess({ ...base, ph: 9, temp: 30 }, { ...wide, kitLocal: { tan: 1 } });
  assert.equal(x.ammonia.status, 'danger'); assert.ok(x.ammonia.fractionPct > 40 && x.ammonia.fractionPct < 50);
});
t('advisor: drinking, pond and pit give the expected key lines in both languages', () => {
  const sev = (x, type) => x.advice(type).map(a => a.sev);
  const good = L.assess(base, wide);
  assert.equal(good.advice('drink')[0].sev, 'ok');
  assert.ok(good.advice('drink').every(a => a.en && a.hi));
  assert.match(good.advice('pond')[0].en, /not fit to drink directly/);
  const acid = L.assess({ ...base, ph: 5, tds: 1200, turb: 10 }, wide);
  assert.ok(sev(acid, 'drink').includes('bad'));
  assert.ok(acid.advice('pit').some(a => /Mining risk index 62\/100 \(High\)/.test(a.en)));
  assert.ok(L.assess(base, { ...wide, kitLocal: { h2s: 'pos', no3: 60 } }).advice('drink').filter(a => a.sev === 'bad').length >= 2);
});
t('oxygen: estimate is saturation only, measured DO wins', () => {
  const a = L.assess({ ...base, temp: 25 }, wide).oxygen;
  assert.equal(a.measured, false); assert.ok(Math.abs(a.saturation - 8.3) < 0.1);
  assert.equal(L.assess({ ...base, do: 6.1 }, wide).oxygen.value, 6.1);
});
t('confidence and spots still work', () => {
  assert.equal(L.confidence(base).level, 'High');
  assert.equal(L.confidence({ ...base, flags: 1 | 2 | 4 }).level, 'Low');
  const s = L.clusterSpots([base, { ...base, ts: 2000, lat: base.lat + 0.0002 }, { ...base, ts: 3000, lat: base.lat + 0.01 }], 50);
  assert.equal(s.length, 2); assert.equal(s[0].items.length, 2);
});
t('alerts', () => {
  const kinds = (m, hist = [], o = wide) => L.alertsForMeasurement(m, hist, o).map(a => a.kind + ':' + a.severity);
  assert.deepEqual(kinds(base), []);
  assert.ok(kinds({ ...base, ph: 5, tds: 1200, turb: 10 }).includes('mining:critical'));
  assert.ok(kinds({ ...base, tds: 2500 }).includes('tds:critical'));
  assert.ok(kinds({ ...base, tds: 1500 }, [], { model: 'lite' }).includes('tds:warning'));
  assert.deepEqual(kinds({ ...base, flags: 7, ph: 3 }), ['confidence:info']);
  const hist = [1, 2, 3, 4].map(i => ({ ...base, ts: i }));
  assert.ok(kinds({ ...base, ts: 9, turb: 12 }, hist).includes('drop:critical'));
  assert.ok(kinds({ ...base, kit: { h2s: 'pos' } }).includes('bacteria:critical'));
});
t('invalid reading does not crash', () => {
  const x = L.assess({ ...base, ph: NaN }, wide);
  assert.equal(x.valid, false); assert.equal(L.quick({ ...base, temp: 99 }, wide).label, 'Invalid reading');
});
t('team logic file is used unchanged (its own exports)', () => {
  assert.equal(H.CONFIG.weights.ph, 4); assert.equal(H.CONFIG.standard.tds, 500); assert.equal(H.analyze({ ph: 7.4, tds: 180, turbidity: 0.8, temp: 27 }).wqi.wqi, 26.2);
});
console.log(`\n${n} tests passed`);
