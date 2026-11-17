/*!
 * HydraSense classification logic  v1.0
 * Inputs : pH, TDS (mg/L), turbidity (NTU), temperature (deg C)
 * Outputs: WQI (5 levels), use-wise suitability (drinking, fish, irrigation,
 *          industrial / waste), per-parameter sub-indices, reasons.
 *
 * Works in the browser (window.HydraLogic) and in Node (require).
 *
 * EVERY threshold below carries a source tag:
 *   [S1]..[S9]  -> see SOURCES at the bottom of this file
 *   [A]         -> HydraSense engineering assumption (no direct published
 *                  source found). These are listed in analyze().assumptions
 *                  so the UI / pitch can be honest about them.
 *
 * NOT measurable with these 4 sensors (never faked here):
 *   dissolved oxygen, ORP, ammonia, hardness, coliform, BOD, heavy metals.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HydraLogic = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ------------------------------------------------------------------ *
   * 1. CONFIG  (edit here, nothing else needs to change)
   * ------------------------------------------------------------------ */
  var CONFIG = {
    // WQI band labels. Band EDGES (25/50/75/100) are from [S2]; the NAMES are
    // a display choice -> change freely to match the website.
    levels: [
      { max: 25,       key: 'excellent', label: 'Excellent' },
      { max: 50,       key: 'good',      label: 'Good'      },
      { max: 75,       key: 'moderate',  label: 'Moderate'  },
      { max: 100,      key: 'poor',      label: 'Poor'      },
      { max: Infinity, key: 'very_poor', label: 'Very Poor' }
    ],

    // Standard values Sn used in the quality rating  q = (V - Videal)/(Sn - Videal)*100
    // BIS IS 10500:2012 [S3]. Turbidity uses the PERMISSIBLE limit (5 NTU) [A]:
    // cheap analog turbidity sensors cannot resolve the 1 NTU "acceptable" limit.
    standard: { phLow: 6.5, phHigh: 8.5, phIdeal: 7.0, tds: 500, turbidity: 5 },

    // Relative importance weights (Likert-style wi, then Wi = wi / sum(wi)).
    // Method: relative-weight WAWQI [S1]. pH=4, TDS=4 as in [S1b]; turbidity=4 [A].
    // Reason for NOT using Wi = K/Sn: see HydraSense_Logic.md section 3.
    weights: { ph: 4, tds: 4, turbidity: 4 },

    // Safeguard (HydraSense design, [A]): if ANY of pH / TDS / turbidity is
    // beyond the BIS PERMISSIBLE limit the level cannot be better than this.
    breachFloorKey: 'poor',

    // Sensor limits for validity warnings. Set tdsMax to your probe's range
    // (e.g. 1000 for a basic Gravity-type TDS probe) or leave null.
    sensor: { tdsMax: null, turbidityMax: 3000, tempMin: -5, tempMax: 60 },

    // TDS(mg/L) = k * EC(uS/cm). Probe-dependent (0.5 typical for cheap probes).
    // Only used for the CPCB class-E EC limit.
    tdsToEcFactor: 0.5
  };

  /* ------------------------------------------------------------------ *
   * 2. FISH TABLE (editable)
   *    temp: optimum = good growth, tolerance = survives but stressed
   * ------------------------------------------------------------------ */
  var FISH = [
    { name: 'Rohu',        temp: { optimum: [26, 32], tolerance: [20, 36] }, src: 'temp opt [S9b]; tolerance [A]' },
    { name: 'Catla',       temp: { optimum: [26, 32], tolerance: [20, 36] }, src: 'temp opt [S9b]; tolerance [A]' },
    { name: 'Common carp', temp: { optimum: [25, 30], tolerance: [4, 34]  }, src: '[S9c]' },
    { name: 'Nile tilapia',temp: { optimum: [27, 30], tolerance: [14, 36] }, src: '[S9c]' }
  ];
  // pH for pond fish [S8]: best 6.5-9 ; slow growth 5-6.5 and 9-10 ; death <4 / >11
  var FISH_PH = { ok: [6.5, 9.0], marginal: [5.0, 10.0] };
  // TDS for freshwater fish culture [A]: conservative, to be confirmed by a fisheries expert
  var FISH_TDS = { ok: 1000, marginal: 2000 };

  /* ------------------------------------------------------------------ *
   * 3. HELPERS
   * ------------------------------------------------------------------ */
  var A = []; // assumptions actually used in this run
  function useAssumption(t) { if (A.indexOf(t) < 0) A.push(t); }
  function inRange(v, lo, hi) { return v >= lo && v <= hi; }
  function round(v, d) { var m = Math.pow(10, d == null ? 1 : d); return Math.round(v * m) / m; }
  function isNum(v) { return typeof v === 'number' && isFinite(v); }

  function validate(r) {
    var errors = [], warnings = [];
    ['ph', 'tds', 'turbidity', 'temp'].forEach(function (k) {
      if (!isNum(r[k])) errors.push(k + ' is missing or not a number');
    });
    if (errors.length) return { ok: false, errors: errors, warnings: warnings };
    if (r.ph < 0 || r.ph > 14) errors.push('pH must be between 0 and 14');
    if (r.tds < 0) errors.push('TDS cannot be negative');
    if (r.turbidity < 0) errors.push('Turbidity cannot be negative');
    if (r.temp < CONFIG.sensor.tempMin || r.temp > CONFIG.sensor.tempMax)
      errors.push('Temperature outside plausible sensor range');
    if (CONFIG.sensor.tdsMax != null && r.tds >= CONFIG.sensor.tdsMax)
      warnings.push('TDS at/above probe range - real value may be higher');
    if (r.turbidity >= CONFIG.sensor.turbidityMax)
      warnings.push('Turbidity at/above sensor range - real value may be higher');
    return { ok: errors.length === 0, errors: errors, warnings: warnings };
  }

  /* ------------------------------------------------------------------ *
   * 4. WQI  (Weighted Arithmetic WQI, Horton 1965 / Brown et al. 1972) [S1]
   *    WQI = sum(Wi * qi),  sum(Wi)=1
   *    qi  = (Vi - Videal) / (Si - Videal) * 100      [S1c]
   *    0 = ideal, 100 = exactly at the BIS limit, >100 = beyond the limit
   * ------------------------------------------------------------------ */
  function qPH(v) {
    var s = CONFIG.standard;
    // Two-sided version of the standard formula so that BOTH 6.5 and 8.5
    // (the BIS range [S3]) map to 100. Standard papers use ideal=7, Sn=8.5 [S1c].
    return v >= s.phIdeal
      ? (v - s.phIdeal) / (s.phHigh - s.phIdeal) * 100
      : (s.phIdeal - v) / (s.phIdeal - s.phLow) * 100;
  }
  function qLinear(v, Sn) { return v / Sn * 100; } // ideal value = 0 for TDS and turbidity

  function levelFromWQI(w) {
    for (var i = 0; i < CONFIG.levels.length; i++) if (w <= CONFIG.levels[i].max) return i;
    return CONFIG.levels.length - 1;
  }

  function computeWQI(r) {
    var s = CONFIG.standard, wt = CONFIG.weights;
    var sum = wt.ph + wt.tds + wt.turbidity;
    var W = { ph: wt.ph / sum, tds: wt.tds / sum, turbidity: wt.turbidity / sum };
    var q = { ph: qPH(r.ph), tds: qLinear(r.tds, s.tds), turbidity: qLinear(r.turbidity, s.turbidity) };
    var contrib = { ph: W.ph * q.ph, tds: W.tds * q.tds, turbidity: W.turbidity * q.turbidity };
    var wqi = contrib.ph + contrib.tds + contrib.turbidity;

    // BIS permissible-limit breaches [S3]
    var breaches = [];
    if (r.ph < 6.5 || r.ph > 8.5) breaches.push('pH outside 6.5-8.5 (BIS: no relaxation)');
    if (r.tds > 2000) breaches.push('TDS above 2000 mg/L (BIS permissible limit)');
    if (r.turbidity > 5) breaches.push('Turbidity above 5 NTU (BIS permissible limit)');

    var idx = levelFromWQI(wqi), floorApplied = false;
    var floorIdx = CONFIG.levels.map(function (l) { return l.key; }).indexOf(CONFIG.breachFloorKey);
    if (breaches.length && idx < floorIdx) { idx = floorIdx; floorApplied = true; useAssumption('Breach floor: any parameter beyond BIS permissible limit => level not better than "' + CONFIG.levels[floorIdx].label + '"'); }
    useAssumption('Turbidity weight = 4 (same as pH, TDS) and Sn = 5 NTU');

    var worst = ['ph', 'tds', 'turbidity'].sort(function (a, b) { return q[b] - q[a]; })[0];
    return {
      wqi: round(wqi, 1),
      score: round(Math.max(0, Math.min(100, 100 - wqi)), 0), // 0-100, higher = better (for gauges)
      level: CONFIG.levels[idx].key,
      label: CONFIG.levels[idx].label,
      levelIndex: idx,
      subIndex: { ph: round(q.ph, 1), tds: round(q.tds, 1), turbidity: round(q.turbidity, 1) },
      weights: { ph: round(W.ph, 3), tds: round(W.tds, 3), turbidity: round(W.turbidity, 3) },
      contribution: { ph: round(contrib.ph, 1), tds: round(contrib.tds, 1), turbidity: round(contrib.turbidity, 1) },
      worstParameter: worst,
      breaches: breaches,
      floorApplied: floorApplied
    };
  }

  /* ------------------------------------------------------------------ *
   * 5. TASTE BAND from TDS (WHO palatability panels) [S4] - info only
   * ------------------------------------------------------------------ */
  function tasteBand(tds) {
    if (tds < 300) return 'Excellent';
    if (tds <= 600) return 'Good';
    if (tds <= 900) return 'Fair';
    if (tds <= 1200) return 'Poor';
    return 'Unacceptable';
  }

  /* ------------------------------------------------------------------ *
   * 6. USE-WISE CLASSIFICATION
   * ------------------------------------------------------------------ */
  function drinking(r) {
    var reasons = [], status;
    var phOk = inRange(r.ph, 6.5, 8.5);
    if (!phOk) reasons.push('pH ' + r.ph + ' outside 6.5-8.5 [S3]');
    if (r.tds > 2000) reasons.push('TDS above 2000 mg/L permissible limit [S3]');
    else if (r.tds > 500) reasons.push('TDS above 500 mg/L acceptable limit [S3]');
    if (r.turbidity > 5) reasons.push('Turbidity above 5 NTU permissible limit [S3]');
    else if (r.turbidity > 1) reasons.push('Turbidity above 1 NTU acceptable limit [S3]');

    if (!phOk || r.tds > 2000 || r.turbidity > 5) status = 'not_suitable';
    else if (r.tds > 500 || r.turbidity > 1) status = 'permissible_only'; // only if no alternate source
    else status = 'suitable';
    return { status: status, tasteBand: tasteBand(r.tds), reasons: reasons,
      note: 'Physical indicators only. Bacteria, arsenic, fluoride, nitrate etc. are NOT measured; this is not a potability certificate.' };
  }

  function irrigation(r) {
    var reasons = [], status;
    var phOk = inRange(r.ph, 6.0, 8.5); // CPCB class E [S5]
    if (!phOk) reasons.push('pH ' + r.ph + ' outside 6.0-8.5 (CPCB class E) [S5]');
    // FAO / Ayers & Westcot salinity guideline, TDS form [S6]
    if (r.tds > 2000) reasons.push('TDS above 2000 mg/L: severe salinity restriction [S6]');
    else if (r.tds >= 450) reasons.push('TDS 450-2000 mg/L: slight-to-moderate restriction, choose salt-tolerant crops [S6]');
    if (!phOk || r.tds > 2000) status = 'not_recommended';
    else if (r.tds >= 450) status = 'use_with_care';
    else status = 'suitable';
    return { status: status, reasons: reasons,
      note: 'Sodium (SAR), boron, chloride not measured; check them for long-term use.' };
  }

  function industrial(r) {
    var ec = r.tds / CONFIG.tdsToEcFactor;          // uS/cm estimate
    var reasons = [], status;
    var phOk = inRange(r.ph, 6.0, 8.5);
    if (!phOk) reasons.push('pH outside 6.0-8.5 (CPCB class E) [S5]');
    if (ec > 2250) reasons.push('Estimated EC ' + Math.round(ec) + ' uS/cm above 2250 (CPCB class E) [S5]');
    status = (phOk && ec <= 2250) ? 'suitable' : 'not_suitable';
    useAssumption('EC estimated as TDS / ' + CONFIG.tdsToEcFactor + ' (probe dependent)');
    // Discharge to inland surface water: pH 5.5-9.0 [S7]; TSS/BOD cannot be checked
    var dischargePh = inRange(r.ph, 5.5, 9.0);
    return { status: status, reasons: reasons, estimatedEC: Math.round(ec),
      discharge: { pHWithinNorm: dischargePh,
        note: 'CPCB discharge norm for pH is 5.5-9.0 [S7]; TSS, BOD, oil & grease and temperature-rise limits cannot be checked with these sensors.' },
      note: 'Class E use = irrigation, industrial cooling, controlled waste disposal [S5].' };
  }

  function fishOne(sp, r) {
    var reasons = [], rank = 0; // 0 ok, 1 marginal, 2 unsuitable
    function bump(n, msg) { if (n > rank) rank = n; reasons.push(msg); }
    var t = sp.temp;
    if (!inRange(r.temp, t.optimum[0], t.optimum[1])) {
      if (inRange(r.temp, t.tolerance[0], t.tolerance[1])) bump(1, 'Temp ' + r.temp + ' C outside optimum ' + t.optimum.join('-') + ' C');
      else bump(2, 'Temp ' + r.temp + ' C outside tolerance ' + t.tolerance.join('-') + ' C');
    }
    if (!inRange(r.ph, FISH_PH.ok[0], FISH_PH.ok[1])) {
      if (inRange(r.ph, FISH_PH.marginal[0], FISH_PH.marginal[1])) bump(1, 'pH ' + r.ph + ' causes slow growth/stress [S8]');
      else bump(2, 'pH ' + r.ph + ' near lethal range [S8]');
    }
    if (r.tds > FISH_TDS.marginal) bump(2, 'TDS above ' + FISH_TDS.marginal + ' mg/L [A]');
    else if (r.tds > FISH_TDS.ok) bump(1, 'TDS above ' + FISH_TDS.ok + ' mg/L [A]');
    return { name: sp.name, status: ['suitable', 'marginal', 'not_suitable'][rank], reasons: reasons, source: sp.src };
  }

  function fish(r) {
    useAssumption('Fish TDS limits 1000/2000 mg/L and IMC temperature tolerance 20-36 C');
    var species = FISH.map(function (s) { return fishOne(s, r); });
    var advisories = [];
    if (r.turbidity > 25) advisories.push('High turbidity: sensor cannot tell plankton from clay. Check with a Secchi disk (target about 30 cm) [S9d].');
    var anyOk = species.some(function (s) { return s.status === 'suitable'; });
    var anyMarg = species.some(function (s) { return s.status === 'marginal'; });
    return { status: anyOk ? 'suitable' : (anyMarg ? 'marginal' : 'not_suitable'), species: species, advisories: advisories,
      notVerified: ['dissolved oxygen (CPCB class D needs >= 4 mg/L)', 'free ammonia (class D needs <= 1.2 mg/L)'] };
  }

  /* ------------------------------------------------------------------ *
   * 7. ENTRY POINT
   * ------------------------------------------------------------------ */
  function analyze(reading) {
    A = [];
    var v = validate(reading || {});
    if (!v.ok) return { valid: false, errors: v.errors, warnings: v.warnings };
    var r = { ph: reading.ph, tds: reading.tds, turbidity: reading.turbidity, temp: reading.temp };

    var wqi = computeWQI(r);
    var uses = { drinking: drinking(r), fish: fish(r), irrigation: irrigation(r), industrial: industrial(r) };

    // Best use, in CPCB order of required quality: drinking > fisheries > irrigation/industrial > waste [S5]
    var best;
    if (uses.drinking.status === 'suitable') best = 'Drinking';
    else if (uses.drinking.status === 'permissible_only') best = 'Drinking only if no alternate source (treat first)';
    else if (uses.fish.status === 'suitable') best = 'Fish culture';
    else if (uses.irrigation.status === 'suitable' || uses.irrigation.status === 'use_with_care') best = 'Irrigation';
    else if (uses.industrial.status === 'suitable') best = 'Industrial cooling / controlled disposal';
    else if (uses.fish.status === 'marginal') best = 'Limited use - fish culture only after correcting pH / temperature / TDS';
    else best = 'Drain / waste water - treat before any use';

    return {
      valid: true, warnings: v.warnings, input: r,
      wqi: wqi, uses: uses, bestUse: best,
      notMeasured: ['dissolved oxygen', 'ORP', 'ammonia', 'hardness', 'coliform / BOD', 'heavy metals'],
      assumptions: A.slice()
    };
  }

  /* ------------------------------------------------------------------ *
   * SOURCES
   * ------------------------------------------------------------------ */
  var SOURCES = {
    S1:  'Horton (1965); Brown et al. (1972) Weighted Arithmetic WQI - as described in https://www.cwejournal.org/pdf/Vol20No2/CWE_Vol20_No2_p_720-731.pdf',
    S1b: 'Relative weights (pH 4, TDS 4) - https://www.cwejournal.org/vol11no2/assessment-of-the-water-quality-of-hussain-sagar-fox-sagar-and-kattamysamma-lakes-of-hyderabad-telangana-state-india-using-water-quality-index-wqi/',
    S1c: 'Quality rating formula, ideal pH 7, BIS limits - https://techniumscience.com/index.php/technium/article/view/10737/4240 and https://jjees.hu.edu.jo/files/Vol17/No3/JJEES_Vol_17_No_3_P3.pdf',
    S2:  'WQI band edges 25/50/75/100 - https://pmc.ncbi.nlm.nih.gov/articles/PMC9079147/table/tab2 ; https://www.ijert.org/?p=17831',
    S3:  'BIS IS 10500:2012 (pH 6.5-8.5; TDS 500/2000; turbidity 1/5) - https://phewater.assam.gov.in/sites/default/files/swf_utility_folder/departments/water_medhassu_in_oid_5/menu/document/Water%20Quality%20Standards.pdf ; https://www.rfhha.org/images/law/8.9 INDIAN STANDARDS FOR SAFE DRINKING WATER.pdf',
    S4:  'WHO TDS palatability bands (via NHMRC / Health Canada) - https://guidelines.nhmrc.gov.au/australian-drinking-water-guidelines/part-5/physical-chemical-characteristics/total-dissolved-solids',
    S5:  'CPCB Designated Best Use classes - https://cpcb.nic.in/water-quality-criteria/ ; https://cpcb.nic.in/NGTMC/T_1_d.pdf',
    S6:  'FAO 29 Rev.1 Ayers & Westcot (1985), TDS <450 / 450-2000 / >2000 - https://smallfarms.oregonstate.edu/sites/agscid7/files/fg76-e.pdf ; https://www.fao.org/3/x5871e/x5871e07.htm',
    S7:  'CPCB General Standards for discharge (EPA 1986 Schedule VI) - https://www.foundryinfo-india.org/images/GeneralStandards.pdf',
    S8:  'Boyd (Auburn) pH effects on aquaculture - https://www.globalseafood.org/advocate/water-quality-standards-ph/ ; https://fw.ky.gov/Fish/Pages/Farm-Pond-Management-Water-Quality.aspx',
    S9b: 'Warm-water pond fish 25-32 C / 26-32 C - https://eprints.cmfri.org.in/3264/1/Special_Publication_No_22.pdf ; https://mail.asci-india.com/img/English IECs/English Pamphlet/5.Pond Environment.pdf',
    S9c: 'FAO (2014) small-scale aquaponics species table: common carp, Nile tilapia - https://learn.farmhub.ag/resources/small-scale-aquaponic-food-production/7-fish-in-aquaponics/water-quality-for-fish/',
    S9d: 'Secchi ~30 cm pond transparency - https://mail.asci-india.com/img/English IECs/English Pamphlet/5.Pond Environment.pdf'
  };

  return { analyze: analyze, computeWQI: computeWQI, validate: validate, CONFIG: CONFIG, FISH: FISH, SOURCES: SOURCES };
});