/* HydraSense website logic v2 - pure functions (no DOM, no Firebase). Runs in the browser and in node tests.
 *
 * The WQI and use-wise classification come UNCHANGED from js/hydrasense-logic.js (the team's sourced
 * logic file, window.HydraLogic). This module adds what the sensors/kit need around it:
 *   EC -> TDS, probe-range handling, test-kit values, mining risk index, purification advisor,
 *   fish list (with pit-lake cap), reading confidence, 50 m spots and alerts.
 *
 * A "measurement" looks like:
 *   { device, ts, lat, lon, ph, tds, temp, turb, ec?, orp?, do?, mode?, flags?, batt?, stable?,
 *     calDays?, sats?, test?, tan?, kit?: { tan, no3, cl, hard, fe, h2s } }
 * Tags: [S..] = source in docs/SOURCES.md, [A] = HydraSense assumption, [P] = team plan (SIH 26040).
 */
const H = () => {
  const h = globalThis.HydraLogic;
  if (h && !h.FISH.some(f => f.name === 'Pangasius'))
    h.FISH.push({ name: 'Pangasius', temp: { optimum: [26, 31], tolerance: [20, 34] }, src: '[A] no single published range found; reported culture conditions 26-32 C' });
  return h;
};

export const PARAMS = {
  ph:   { label: 'pH',          unit: '',     dec: 2 },
  tds:  { label: 'TDS',         unit: 'mg/L', dec: 0 },
  turb: { label: 'Turbidity',   unit: 'NTU',  dec: 1 },
  temp: { label: 'Temperature', unit: '°C',   dec: 1 },
};
export const LEVEL_COLORS = { excellent: '#1a9850', good: '#91cf60', moderate: '#fdae61', poor: '#f46d43', very_poor: '#a50026' };
export const levels = () => H().CONFIG.levels.map(l => ({ key: l.key, label: l.label, color: LEVEL_COLORS[l.key] }));

// Device versions [P]. tdsMax = range of the conductivity/TDS probe; above it the value is only approximate.
export const MODELS = {
  lite:       { name: 'Lite',       tdsMax: 1000 },
  commercial: { name: 'Commercial', tdsMax: null },
  pro:        { name: 'Pro',        tdsMax: null },
};
export const FLAG_RANGE = 32;            // flags bit 32 = EC/TDS above probe range (set by the device)
export const DEFAULT_EC_FACTOR = 0.5;    // TDS (mg/L) = factor x EC (uS/cm) [A], adjustable in admin

/* ------------------------------------------------------------------ effective reading */
export function effective(m, opts = {}) {
  const k = opts.ecFactor > 0 ? opts.ecFactor : DEFAULT_EC_FACTOR;
  const hasEc = typeof m.ec === 'number' && isFinite(m.ec);
  const tds = hasEc ? m.ec * k : m.tds;
  const model = MODELS[opts.model] ? opts.model : 'lite';
  const max = MODELS[model].tdsMax;
  const tdsApprox = !!((m.flags | 0) & FLAG_RANGE) || (max != null && tds >= max);
  return { ph: m.ph, tds, turbidity: m.turb, temp: m.temp, ec: hasEc ? m.ec : null, tdsFromEc: hasEc, tdsApprox, model };
}

export function kitOf(m, local) {
  const k = {};
  if (typeof m.tan === 'number') k.tan = m.tan;             // v1 field
  for (const src of [m.kit, local]) if (src) for (const key of ['tan', 'no3', 'cl', 'hard', 'fe']) if (typeof src[key] === 'number' && isFinite(src[key]) && src[key] >= 0) k[key] = src[key];
  for (const src of [m.kit, local]) if (src && (src.h2s === 'pos' || src.h2s === 'neg')) k.h2s = src.h2s;
  return k;
}

/* ------------------------------------------------------------------ chemistry helpers */
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

/* ------------------------------------------------------------------ mining contamination risk index [P] */
// Points: pH max 35, TDS max 25, turbidity max 15, iron (kit) max 15, pattern bonus +15 (pH < 6 and TDS > 1000).
// Index = points / maximum possible x 100 (105 with iron, 90 without), capped at 100.
// ORP is not used. This only signals SUSPECTED mining pollution; heavy metals are not measured.
export function miningRisk(r, kit = {}) {
  const parts = [];
  const ph = r.ph >= 6.5 ? 0 : r.ph >= 5.5 ? 10 : r.ph >= 4.5 ? 20 : 35;
  let tds = r.tds < 500 ? 0 : r.tds <= 1000 ? 8 : r.tds <= 2000 ? 15 : 25;
  if (r.tdsApprox) tds = 15;                                   // probe out of range: we only know "above 1000"
  const turb = r.turbidity < 5 ? 0 : r.turbidity <= 25 ? 6 : 15;
  const hasIron = typeof kit.fe === 'number';
  const iron = !hasIron ? 0 : kit.fe <= 0.3 ? 0 : kit.fe <= 1 ? 10 : 15;   // 0.3 mg/L = BIS limit [S3]; 10/15 split at 1 mg/L [A]
  const bonus = r.ph < 6 && (r.tds > 1000 || r.tdsApprox) ? 15 : 0;
  if (ph) parts.push(`acidic pH (+${ph})`);
  if (tds) parts.push(`high dissolved solids (+${tds})`);
  if (turb) parts.push(`turbid water (+${turb})`);
  if (iron) parts.push(`iron above 0.3 mg/L (+${iron})`);
  if (bonus) parts.push(`acid + high-salt pattern (+${bonus})`);
  const points = ph + tds + turb + iron + bonus, max = hasIron ? 105 : 90;
  const index = Math.min(100, Math.round(points / max * 100));
  return { index, points, max, level: index <= 30 ? 'Low' : index <= 60 ? 'Moderate' : 'High', evidence: hasIron ? 'Moderate' : 'Indicative', hasIron, parts };
}

/* ------------------------------------------------------------------ fish list (pond + pit lake) */
const FISH_MIN_DO = { 'Rohu': 5, 'Catla': 5, 'Common carp': 4, 'Nile tilapia': 3, 'Pangasius': 3 };   // mg/L [P]
const RANK = ['suitable', 'marginal', 'not_suitable'];
export function fishList(a, m, mining, pit) {
  const hasDo = typeof m.do === 'number' && isFinite(m.do);
  return a.uses.fish.species.map(s => {
    let rank = RANK.indexOf(s.status); const reasons = s.reasons.slice();
    if (hasDo) {
      const min = FISH_MIN_DO[s.name] || 4;
      if (m.do < min) { rank = 2; reasons.push(`Oxygen ${m.do} mg/L below the ${min} mg/L this fish needs`); }
      else if (m.do < min + 1) { rank = Math.max(rank, 1); reasons.push(`Oxygen ${m.do} mg/L is only just enough`); }
    }
    let status = RANK[rank];
    if (pit && mining.level === 'High' && rank < 2) { status = 'risky'; reasons.push('Mining risk is High: heavy metals can build up in fish. Lab-test before eating.'); }
    return { name: s.name, status, reasons, oxygenVerified: hasDo };
  });
}

/* ------------------------------------------------------------------ purification advisor [P] (advice only) */
// type: 'drink' (RO / tap / hand pump), 'pond' (pond / lake), 'pit' (mine pit lake). Each line has English + Hindi.
export function advisor(type, x) {
  const out = [], r = x.r, k = x.kit, u = x.a.uses;
  const add = (sev, en, hi) => out.push({ sev, en, hi });
  if (type === 'drink') {
    if (u.drinking.status === 'suitable') add('ok', 'pH, TDS and turbidity are within the BIS acceptable limits.', 'pH, TDS और गंदलापन BIS की स्वीकार्य सीमा में हैं।');
    if (r.ph < 6.5) add('bad', 'Water is acidic (pH below 6.5). Do not drink untreated. It needs pH correction (neutralising filter); acidic water can also corrode pipes.', 'पानी अम्लीय है (pH 6.5 से कम)। बिना उपचार न पिएँ। pH सुधार (न्यूट्रलाइज़िंग फ़िल्टर) ज़रूरी है; अम्लीय पानी पाइप भी गला सकता है।');
    if (r.ph > 8.5) add('bad', 'Water is alkaline (pH above 8.5). Not within the BIS range; it needs pH treatment before drinking.', 'पानी क्षारीय है (pH 8.5 से ज़्यादा)। BIS सीमा से बाहर; पीने से पहले pH उपचार चाहिए।');
    if (r.tdsApprox) add('warn', 'TDS is above the range of this probe (about 1000 mg/L), so the real value may be higher. RO treatment is needed; confirm with a wider-range meter.', 'TDS इस प्रोब की सीमा (लगभग 1000 mg/L) से ऊपर है, असली मान ज़्यादा हो सकता है। RO उपचार चाहिए; बड़ी रेंज वाले मीटर से जाँचें।');
    else if (r.tds > 2000) add('bad', 'TDS is above 2000 mg/L (BIS permissible limit). Not fit to drink without RO treatment.', 'TDS 2000 mg/L (BIS की अधिकतम सीमा) से ऊपर है। RO उपचार के बिना पीने लायक नहीं।');
    else if (r.tds > 500) add('warn', 'TDS is above 500 mg/L. An RO purifier is recommended. If this is already RO water, the membrane or filters need changing.', 'TDS 500 mg/L से ऊपर है। RO प्यूरीफ़ायर की सलाह है। अगर यह पहले से RO का पानी है तो मेम्ब्रेन या फ़िल्टर बदलने का समय है।');
    else if (r.tds < 50) add('info', 'TDS is very low (typical of RO water). Safe, but taste can be flat; many RO units have a TDS adjuster or mineral cartridge.', 'TDS बहुत कम है (RO पानी जैसा)। सुरक्षित है, पर स्वाद फीका लग सकता है; कई RO में TDS एडजस्टर या मिनरल कार्ट्रिज होता है।');
    if (r.turbidity > 5) add('bad', 'Water is cloudy (above 5 NTU). Let it settle and filter it (sediment filter or clean cloth), then disinfect by boiling or chlorine.', 'पानी गंदला है (5 NTU से ऊपर)। पहले थिरने दें और छानें (सेडिमेंट फ़िल्टर या साफ़ कपड़ा), फिर उबालकर या क्लोरीन से कीटाणुरहित करें।');
    else if (r.turbidity > 1) add('warn', 'Slight cloudiness (above 1 NTU). Service or replace the sediment filter.', 'हल्का गंदलापन (1 NTU से ऊपर)। सेडिमेंट फ़िल्टर की सर्विस करें या बदलें।');
    if (k.h2s === 'pos') add('bad', 'H2S vial turned black: bacterial contamination is likely. Boil or chlorinate the water and get a lab test.', 'H2S वायल काली हो गई: बैक्टीरिया होने की संभावना है। पानी उबालें या क्लोरीन डालें और लैब टेस्ट कराएँ।');
    if (k.no3 > 45) add('bad', 'Nitrate is above 45 mg/L (BIS limit). Boiling does not remove nitrate; use RO. Do not give this water to infants.', 'नाइट्रेट 45 mg/L (BIS सीमा) से ऊपर है। उबालने से नाइट्रेट नहीं हटता; RO इस्तेमाल करें। शिशुओं को यह पानी न दें।');
    if (k.fe > 0.3) add('warn', 'Iron is above 0.3 mg/L (BIS limit): metallic taste and stains. Use an iron-removal filter.', 'आयरन 0.3 mg/L (BIS सीमा) से ऊपर है: धातु जैसा स्वाद और दाग। आयरन रिमूवल फ़िल्टर लगाएँ।');
    if (k.hard > 600) add('bad', 'Hardness is above 600 mg/L (BIS permissible limit). A softener or RO is needed.', 'कठोरता 600 mg/L (BIS की अधिकतम सीमा) से ऊपर है। सॉफ़्टनर या RO चाहिए।');
    else if (k.hard > 200) add('warn', 'Water is hard (above 200 mg/L). It causes scale; a softener helps.', 'पानी कठोर है (200 mg/L से ऊपर)। इससे पपड़ी जमती है; सॉफ़्टनर मदद करेगा।');
    if (k.tan > 0.5) add('bad', 'Ammonia is above 0.5 mg/L (BIS limit). This often points to sewage or waste entering the source. Get a lab test.', 'अमोनिया 0.5 mg/L (BIS सीमा) से ऊपर है। यह अक्सर सीवेज या कचरा मिलने का संकेत है। लैब टेस्ट कराएँ।');
    if (typeof k.cl === 'number') {
      if (k.cl > 1) add('warn', 'Free chlorine is above 1 mg/L. Let the water stand in an open vessel, or use a carbon filter.', 'फ़्री क्लोरीन 1 mg/L से ऊपर है। पानी को खुले बर्तन में रखें या कार्बन फ़िल्टर इस्तेमाल करें।');
      else if (k.cl < 0.2) add('info', 'Free chlorine is below 0.2 mg/L. If this is piped supply that should be chlorinated, disinfection may be weak.', 'फ़्री क्लोरीन 0.2 mg/L से कम है। अगर यह नल की सप्लाई है जिसमें क्लोरीन होना चाहिए, तो कीटाणुनाशन कमज़ोर हो सकता है।');
    }
    if (k.h2s !== 'pos') add('info', k.h2s === 'neg' ? 'H2S vial was negative. This is a screening test only, not a full bacteria test.' : 'Bacteria are NOT measured by the sensors. Use an H2S vial (result in 24-48 hours) or a lab test.', k.h2s === 'neg' ? 'H2S वायल नेगेटिव रही। यह सिर्फ़ स्क्रीनिंग टेस्ट है, पूरा बैक्टीरिया टेस्ट नहीं।' : 'सेंसर बैक्टीरिया नहीं नापते। H2S वायल (नतीजा 24-48 घंटे में) या लैब टेस्ट कराएँ।');
  } else {
    add('bad', 'Pond, lake and pit water is not fit to drink directly, whatever the readings show.', 'तालाब, झील या खदान के गड्ढे का पानी सीधे पीने लायक नहीं है, रीडिंग कुछ भी हो।');
    const f = u.fish.status, ir = u.irrigation.status;
    if (r.ph < 6.5) add('warn', 'Water is acidic for fish. Agricultural lime is the usual correction; raise pH slowly.', 'मछली के लिए पानी अम्लीय है। आम तौर पर कृषि चूना डाला जाता है; pH धीरे-धीरे बढ़ाएँ।');
    if (r.ph > 9) add('warn', 'pH is high for fish (above 9). Ammonia becomes more toxic at high pH; reduce feeding and exchange water.', 'मछली के लिए pH ज़्यादा है (9 से ऊपर)। ऊँचे pH पर अमोनिया ज़्यादा ज़हरीला होता है; दाना कम करें और पानी बदलें।');
    add(f === 'suitable' ? 'ok' : f === 'marginal' ? 'warn' : 'bad', f === 'suitable' ? 'Fish culture: pH, temperature and TDS are in range for at least one species (see the fish list).' : f === 'marginal' ? 'Fish culture: possible only after correcting the points listed in the fish list.' : 'Fish culture: not suitable at these readings.', f === 'suitable' ? 'मछली पालन: कम से कम एक प्रजाति के लिए pH, तापमान और TDS ठीक हैं (मछली सूची देखें)।' : f === 'marginal' ? 'मछली पालन: मछली सूची में लिखी कमियाँ सुधारने के बाद ही संभव।' : 'मछली पालन: इन रीडिंग पर उपयुक्त नहीं।');
    add(ir === 'suitable' ? 'ok' : ir === 'use_with_care' ? 'warn' : 'bad', ir === 'suitable' ? 'Irrigation: suitable (low salinity, pH in range).' : ir === 'use_with_care' ? 'Irrigation: use with care. Salinity is moderate; choose salt-tolerant crops.' : 'Irrigation: not recommended (too salty or pH out of range).', ir === 'suitable' ? 'सिंचाई: उपयुक्त (कम खारापन, pH ठीक)।' : ir === 'use_with_care' ? 'सिंचाई: सावधानी से। खारापन मध्यम है; नमक सहने वाली फ़सलें चुनें।' : 'सिंचाई: सलाह नहीं (बहुत खारा या pH सीमा से बाहर)।');
    if (r.turbidity > 25) add('info', 'High turbidity: the sensor cannot tell green plankton (good) from clay (bad). Check with a Secchi disk; about 30 cm is the target.', 'गंदलापन ज़्यादा है: सेंसर हरे प्लवक (अच्छा) और मिट्टी (ख़राब) में फ़र्क़ नहीं कर सकता। सेकी डिस्क से जाँचें; लगभग 30 सेमी ठीक है।');
    if (x.ammonia && x.ammonia.status === 'danger') add('bad', `Toxic ammonia is about ${x.ammonia.nh3} mg/L. Stop feeding, exchange water and aerate.`, `ज़हरीला अमोनिया लगभग ${x.ammonia.nh3} mg/L है। दाना बंद करें, पानी बदलें और हवा दें।`);
    if (!x.oxygen.measured) add('info', 'Dissolved oxygen is not verified. Most pond fish kills are caused by low oxygen or ammonia, so test them before stocking.', 'घुली ऑक्सीजन की जाँच नहीं हुई। तालाब में मछलियाँ ज़्यादातर कम ऑक्सीजन या अमोनिया से मरती हैं, इसलिए मछली डालने से पहले जाँचें।');
    if (type === 'pit') {
      const mr = x.mining;
      add(mr.level === 'High' ? 'bad' : mr.level === 'Moderate' ? 'warn' : 'ok', mr.level === 'High' ? `Mining risk index ${mr.index}/100 (High): mining pollution is suspected. Get a lab test for heavy metals before any use, and do not eat fish from this water until then.` : mr.level === 'Moderate' ? `Mining risk index ${mr.index}/100 (Moderate): some signs of mining influence. A lab test is advised before fish farming.` : `Mining risk index ${mr.index}/100 (Low): no strong sign of mining pollution in these readings. Heavy metals are still not measured.`, mr.level === 'High' ? `माइनिंग रिस्क इंडेक्स ${mr.index}/100 (ज़्यादा): खनन प्रदूषण का शक है। किसी भी इस्तेमाल से पहले भारी धातुओं का लैब टेस्ट कराएँ, तब तक इस पानी की मछली न खाएँ।` : mr.level === 'Moderate' ? `माइनिंग रिस्क इंडेक्स ${mr.index}/100 (मध्यम): खनन के असर के कुछ संकेत हैं। मछली पालन से पहले लैब टेस्ट की सलाह है।` : `माइनिंग रिस्क इंडेक्स ${mr.index}/100 (कम): इन रीडिंग में खनन प्रदूषण का बड़ा संकेत नहीं। फिर भी भारी धातुएँ नापी नहीं गई हैं।`);
      if (!mr.hasIron) add('info', 'Add an iron test-kit value to make the mining index more reliable.', 'माइनिंग इंडेक्स को ज़्यादा भरोसेमंद बनाने के लिए आयरन किट का मान डालें।');
    }
  }
  return out;
}

const BEST_USE = {
  'Drinking': ['Drinking (physical readings only)', 'पीने योग्य (सिर्फ़ भौतिक रीडिंग के आधार पर)'],
  'Drinking only if no alternate source (treat first)': ['Drinking only if no better source is available, after treatment', 'पीने के लिए तभी जब दूसरा बेहतर स्रोत न हो, उपचार के बाद'],
  'Fish culture': ['Fish culture', 'मछली पालन'],
  'Irrigation': ['Irrigation', 'सिंचाई'],
  'Industrial cooling / controlled disposal': ['Industrial cooling / controlled disposal', 'औद्योगिक कूलिंग / नियंत्रित निपटान'],
  'Limited use - fish culture only after correcting pH / temperature / TDS': ['Limited use. Fish culture only after correcting pH / temperature / TDS', 'सीमित उपयोग। pH / तापमान / TDS सुधारने के बाद ही मछली पालन'],
  'Drain / waste water - treat before any use': ['Waste water. Treat before any use', 'गंदा पानी। किसी भी उपयोग से पहले उपचार करें'],
};

/* ------------------------------------------------------------------ full assessment */
export function quick(m, opts = {}) {
  const r = effective(m, opts), a = H().analyze(r);
  if (!a.valid) return { valid: false, wqi: null, label: 'Invalid reading', key: 'invalid', color: '#777', bestUse: ['-', '-'] };
  return { valid: true, wqi: a.wqi.wqi, score: a.wqi.score, key: a.wqi.level, label: a.wqi.label, color: LEVEL_COLORS[a.wqi.level], bestUse: BEST_USE[a.bestUse] || [a.bestUse, a.bestUse], r, a };
}

export function assess(m, opts = {}) {
  const q = quick(m, opts);
  if (!q.valid) return { valid: false, confidence: confidence(m) };
  const { r, a } = q, kit = kitOf(m, opts.kitLocal);
  const hasDo = typeof m.do === 'number' && isFinite(m.do);
  const oxygen = { measured: hasDo, value: hasDo ? m.do : null, saturation: Math.round(doSaturation(m.temp) * 10) / 10 };
  const ppt = Math.round(r.tds / 100) / 10;
  const salinity = { ppt, cls: ppt < 0.5 ? 'Fresh' : ppt < 3 ? 'Slightly brackish' : 'Brackish' };
  let ammonia = null;
  if (typeof kit.tan === 'number') {
    const f = ammoniaFraction(m.ph, m.temp), nh3 = Math.round(kit.tan * f * 1000) / 1000;
    ammonia = { tan: kit.tan, fractionPct: Math.round(f * 1000) / 10, nh3, status: nh3 <= 0.02 ? 'ok' : nh3 <= 0.05 ? 'warning' : 'danger' };
  }
  const mining = miningRisk(r, kit);
  const base = { r, a, kit, oxygen, salinity, ammonia, mining };
  return { valid: true, ...q, ...base, fish: pit => fishList(a, m, mining, pit), advice: type => advisor(type, base), confidence: confidence(m) };
}

/* ------------------------------------------------------------------ confidence */
export function confidence(m) {
  let c = 100;
  const notes = [];
  const f = m.flags | 0;
  const names = { 1: 'pH probe unstable/disconnected', 2: 'TDS probe unstable/disconnected', 4: 'Turbidity probe unstable/disconnected', 8: 'Temperature sensor missing' };
  for (const bit of [1, 2, 4, 8]) if (f & bit) { c -= 25; notes.push(names[bit]); }
  if (f & 32) notes.push('EC/TDS above probe range');
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

// opts may carry optsFor(m) -> per-measurement options (device model, EC factor)
export function alertsForMeasurement(m, history, opts = {}) {
  const out = [], of = x => (opts.optsFor ? opts.optsFor(x) : opts);
  const add = (severity, kind, msg) => out.push({ ts: m.ts, severity, kind, msg });
  const conf = confidence(m);
  if (conf.level === 'Low') { add('info', 'confidence', 'Low-confidence reading - alerts suppressed (' + conf.notes.join(', ') + ')'); return out; }
  const x = assess(m, of(m));
  if (!x.valid) { add('info', 'invalid', 'Reading could not be analysed'); return out; }
  const r = x.r;
  if (m.ph < 6 || m.ph > 9) add('critical', 'ph', `pH ${m.ph.toFixed(2)} is far outside 6.5-8.5`);
  else if (m.ph < 6.5 || m.ph > 8.5) add('warning', 'ph', `pH ${m.ph.toFixed(2)} is outside 6.5-8.5`);
  if (r.tdsApprox) add('warning', 'tds', 'TDS is above the probe range (about 1000 mg/L) - real value may be higher');
  else if (r.tds > 2000) add('critical', 'tds', `TDS ${Math.round(r.tds)} mg/L is above the BIS permissible limit (2000)`);
  else if (r.tds > 500) add('warning', 'tds', `TDS ${Math.round(r.tds)} mg/L is above the BIS acceptable limit (500)`);
  if (m.turb > 25) add('critical', 'turb', `Turbidity ${m.turb.toFixed(1)} NTU is very high`);
  else if (m.turb > 5) add('warning', 'turb', `Turbidity ${m.turb.toFixed(1)} NTU is above 5`);
  if (m.temp > 35 || m.temp < 5) add('warning', 'temp', `Temperature ${m.temp.toFixed(1)} °C is unusual for surface water`);
  if (x.mining.level === 'High') add('critical', 'mining', `Mining risk index ${x.mining.index}/100 - mining pollution suspected, lab test advised`);
  if (x.kit.h2s === 'pos') add('critical', 'bacteria', 'H2S vial positive - bacterial contamination likely');
  if (x.ammonia && x.ammonia.status === 'danger') add('critical', 'ammonia', `Ammonia (toxic form) about ${x.ammonia.nh3} mg/L`);
  if (x.kit.no3 > 45) add('warning', 'nitrate', `Nitrate ${x.kit.no3} mg/L is above the BIS limit (45)`);
  // change against this spot's own history (WQI: lower is better)
  const prev = history.filter(h => h.ts < m.ts);
  if (prev.length >= 3) {
    const last = prev.slice(-5).map(p => quick(p, of(p)).wqi).filter(v => v != null);
    if (last.length >= 3) { const rise = x.wqi - mean(last); if (rise >= 50) add('critical', 'drop', `WQI got worse by ${Math.round(rise)} points compared with earlier visits - possible pollution event`); }
  }
  if (prev.length >= 5) {
    const floors = { ph: 0.1, tds: 10, temp: 0.5, turb: 0.5 };
    for (const k of Object.keys(PARAMS)) {
      const h = prev.slice(-30).map(p => p[k]);
      const z = (m[k] - mean(h)) / Math.max(sd(h), floors[k]);
      if (Math.abs(z) > 3) add('warning', 'anomaly', `${PARAMS[k].label} is unusual for this spot (z=${z > 0 ? '+' : ''}${z.toFixed(1)})`);
    }
  }
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
