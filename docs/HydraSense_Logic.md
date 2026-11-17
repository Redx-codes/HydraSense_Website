# HydraSense: Classification Logic and References

Code: `hydrasense-logic.js` (every rule there carries the same source tags as this document).
Inputs: **pH, TDS (mg/L), turbidity (NTU), temperature (°C)**. Nothing else.

Tags: **[S#]** = published source (list at the end). **[A]** = our engineering assumption, no direct published source found. Assumptions are listed again in section 7 so they can be reviewed by a domain expert.

---

## 1. What the four sensors can and cannot give

| Wanted | Possible? | Why |
|---|---|---|
| WQI | Yes | Computed from pH, TDS, turbidity (section 2) |
| Use categories (drinking / irrigation / fish / industrial-waste) | Yes, partly | Only the criteria that depend on pH, TDS, turbidity, temperature can be checked |
| **ORP** | **No** | ORP is an independent redox measurement set by dissolved oxidisers/reducers (chlorine, Fe²⁺, oxygen…). It is not a function of pH, TDS, turbidity or temperature |
| **Dissolved oxygen** | **No** | Temperature only fixes the *maximum* oxygen water can hold. Real DO can be far below (pollution) or above (algae). A "calculated DO" would be a made-up number, so it is left out |
| Ammonia, hardness, coliform, BOD, metals | No | Need test kits or lab. Website should take them as manual entries |

---

## 2. WQI: Weighted Arithmetic Water Quality Index

Method: Horton (1965), developed by Brown et al. (1972) [S1]. The most used WQI in Indian drinking-water studies, with BIS IS 10500 as the standard.

**Step 1: quality rating of each parameter** (0 = ideal, 100 = exactly at the BIS limit, above 100 = beyond the limit) [S1c]

```
q = (V - V_ideal) / (S - V_ideal) x 100
```

| Parameter | Ideal | Standard S | Rating used | Source |
|---|---|---|---|---|
| pH | 7 | 6.5 to 8.5 | `q = (pH-7)/1.5 x 100` for pH ≥ 7, `q = (7-pH)/0.5 x 100` for pH < 7 | [S3], [S1c] |
| TDS | 0 | 500 mg/L | `q = TDS/500 x 100` | [S3] |
| Turbidity | 0 | 5 NTU | `q = NTU/5 x 100` | [S3], Sn choice [A] |

Notes:
- Papers normally use one-sided pH (ideal 7, limit 8.5). We use two-sided so that 6.5 **and** 8.5 both give 100, matching the BIS range 6.5 to 8.5 with no relaxation [S3]. Without this, pH 6.0 would score only 67 and look "fine".
- Turbidity uses the BIS *permissible* limit (5 NTU), not the acceptable 1 NTU [A]. A low-cost analog turbidity sensor cannot resolve 1 NTU reliably.

**Step 2: weights.** Relative weights `Wi = wi / sum(wi)` [S1b]. pH = 4, TDS = 4, turbidity = 4 (pH and TDS = 4 as in [S1b]; turbidity = 4 is [A]). So each carries 1/3.

**Step 3: aggregate**

```
WQI = Wph*q_ph + Wtds*q_tds + Wturb*q_turb        (lower is better)
Score (for gauges) = 100 - WQI, clipped to 0..100  (higher is better)
```

**Step 4: level.** Band edges 25 / 50 / 75 / 100 are the standard ones [S2]:

| WQI | Level (display name, editable) | Name in most papers [S2] |
|---|---|---|
| ≤ 25 | Excellent | Excellent |
| 26 to 50 | Good | Good |
| 51 to 75 | Moderate | Poor |
| 76 to 100 | Poor | Very poor |
| > 100 | Very Poor | Unsuitable for drinking |

The edges are literature; the five display names are our choice (papers have no "Moderate" and end with "Unsuitable"). Change names in `CONFIG.levels`.

**Step 5: safeguard [A].** If any of pH, TDS, turbidity is beyond its BIS *permissible* limit (pH outside 6.5 to 8.5, TDS above 2000, turbidity above 5), the level cannot be better than **Poor**. Reason: an average can hide one bad parameter (a known limitation of aggregated indices). Example: pH 10 with clean water averages to 73, which would show "Moderate" without this rule.

**Worked example** (pH 7.4, TDS 180, turbidity 0.8 NTU):
q = 26.7, 36.0, 16.0, so WQI = (26.7 + 36 + 16)/3 = 26.2, giving **Good**.

---

## 3. Why we did not use the classic Wi = K/Sn weights

The textbook version sets weight inversely proportional to the standard (`Wi = K/Sn`) [S1c]. With only pH (8.5), TDS (500), turbidity (5) the weights come out as pH 0.368, **TDS 0.006**, turbidity 0.626. TDS is effectively ignored.

Test run: pH 7, turbidity 0, **TDS 2000 mg/L** (brackish, 4x the BIS acceptable limit):
- classic weights give WQI = 2.5, i.e. **"Excellent"**
- our weights give WQI = 133, i.e. **"Very Poor"**

For a product whose main sensor is TDS, the classic weights are not usable, hence the relative-weight variant [S1b].

---

## 4. Use-wise classification

WQI is measured against **drinking-water** standards. A healthy fish pond (turbidity 15 NTU) can show "Very Poor" WQI and still be good for fish. So the website should show the WQI and the use-wise result together.

### 4.1 Drinking (BIS IS 10500:2012) [S3]

| Status | Condition |
|---|---|
| Suitable | pH 6.5 to 8.5, TDS ≤ 500, turbidity ≤ 1 |
| Permissible only | pH in range, TDS ≤ 2000, turbidity ≤ 5, but TDS > 500 or turbidity > 1 (BIS allows this only if no alternate source) |
| Not suitable | pH outside 6.5 to 8.5, TDS > 2000, or turbidity > 5 |

Also shown: taste band from TDS (WHO panels) [S4]: below 300 Excellent, 300 to 600 Good, 600 to 900 Fair, 900 to 1200 Poor, above 1200 Unacceptable. Information only, not part of WQI.

Caveat shown with the result: bacteria, arsenic, fluoride, nitrate are not measured, so this is not a potability certificate.

### 4.2 Irrigation [S6], [S5]

| Status | Condition |
|---|---|
| Suitable | TDS < 450 and pH 6.0 to 8.5 |
| Use with care | TDS 450 to 2000 (slight to moderate restriction, choose salt-tolerant crops) |
| Not recommended | TDS > 2000 (severe restriction) or pH outside 6.0 to 8.5 |

TDS bands are the FAO/Ayers and Westcot salinity guideline [S6]. pH range is CPCB class E [S5]. Sodium (SAR), boron and chloride are not measured.

### 4.3 Industrial cooling / controlled waste disposal (CPCB class E) [S5]

Suitable if pH 6.0 to 8.5 **and** EC ≤ 2250 µS/cm. EC is estimated as TDS / 0.5 [A] (the factor depends on the probe; set `tdsToEcFactor`).

Discharge check [S7]: CPCB general standard for pH of effluent into inland surface water is 5.5 to 9.0. TSS, BOD, oil and grease and the "temperature not more than 5 °C above receiving water" rule cannot be checked with these sensors, and the code says so.

### 4.4 Fish culture

pH [S8]: best growth 6.5 to 9.0 (Boyd's 6 to 9; pond guidance 6.5 to 9); slow growth/stress at 5 to 6.5 and 9 to 10; acid death point about 4, alkaline about 11. We call below 5 or above 10 "not suitable".

Temperature per species (editable table `FISH`):

| Fish | Optimum | Tolerance | Source |
|---|---|---|---|
| Rohu, Catla | 26 to 32 °C | 20 to 36 °C [A] | optimum [S9b]; tolerance [A] |
| Common carp | 25 to 30 °C | 4 to 34 °C | [S9c] |
| Nile tilapia | 27 to 30 °C | 14 to 36 °C | [S9c] |

TDS: ≤ 1000 ok, ≤ 2000 marginal, above not suitable [A] (conservative freshwater limit, to be confirmed by a fisheries expert).

Turbidity: advisory only. The sensor cannot tell plankton turbidity (desirable) from clay turbidity (harmful). Above 25 NTU the site says "check with a Secchi disk, target about 30 cm" [S9d].

Species result = the worst of temperature, pH, TDS (Suitable / Marginal / Not suitable). Always shown with: **dissolved oxygen (CPCB class D needs ≥ 4 mg/L) and free ammonia (≤ 1.2 mg/L) are not verified** [S5].

### 4.5 Best use (CPCB order of required quality [S5])

Drinking, then drinking-only-if-no-alternate, then fish culture, then irrigation, then industrial cooling, then "limited use (fish marginal)", then "drain / waste: treat before any use".

---

## 5. Test results (from `test-logic.js`)

| Sample (pH / TDS / NTU / °C) | WQI | Level | Best use |
|---|---|---|---|
| RO water (7.0 / 20 / 0.2 / 25) | 2.7 | Excellent | Drinking |
| Tap (7.4 / 180 / 0.8 / 27) | 26.2 | Good | Drinking |
| At BIS acceptable limits (8.5 / 500 / 1 / 25) | 73.3 | Moderate | Drinking |
| Pond (8.0 / 250 / 15 / 29) | 138.9 | Very Poor | Fish culture |
| Brackish (7.0 / 2000 / 0 / 25) | 133.3 | Very Poor | Drinking only if no alternate source |
| Acid mine pit (3.5 / 1500 / 8 / 28) | 386.7 | Very Poor | Drain / waste |
| Clean but pH 10 (10 / 100 / 0 / 25) | 73.3, floor applied | Poor | Limited use |

Note the third row: water exactly at the BIS acceptable limits is "Moderate", not "Excellent". The WQI is stricter than the pass/fail drinking check on purpose.

---

## 6. Firmware note (not verified in this research)

TDS/EC readings change with temperature, so the ESP32 should temperature-compensate before sending TDS (normal practice is compensating to 25 °C using the DS18B20 reading). The compensation coefficient is probe-specific, so check your probe's datasheet. This was not checked against a source here.

---

## 7. Assumptions [A] to review

1. Turbidity standard Sn = 5 NTU and weight = 4.
2. Breach floor: any parameter beyond the BIS permissible limit means level is at best "Poor".
3. Display names Moderate / Poor / Very Poor for the bands (edges are from literature).
4. EC = TDS / 0.5 for the CPCB class-E check.
5. Fish TDS limits 1000 / 2000 mg/L.
6. Rohu/catla temperature tolerance 20 to 36 °C.
7. Turbidity 25 NTU as the trigger for the Secchi-disk advisory.

## 8. Limitations to say openly

- WQI uses 3 indicators. Bacteria and chemicals can make water unsafe with a perfect score.
- Cheap sensors need calibration (pH especially). Bad calibration gives confidently wrong levels.
- Fish verdicts are indicative; DO and ammonia decide most pond fish kills and are not measured.

---

## 9. References

- **[S1]** Horton (1965); Brown et al. (1972), Weighted Arithmetic WQI, as described in Curr. World Environ. 20(2): https://www.cwejournal.org/pdf/Vol20No2/CWE_Vol20_No2_p_720-731.pdf
- **[S1b]** Relative weights (pH 4, TDS 4): https://www.cwejournal.org/vol11no2/assessment-of-the-water-quality-of-hussain-sagar-fox-sagar-and-kattamysamma-lakes-of-hyderabad-telangana-state-india-using-water-quality-index-wqi/
- **[S1c]** Quality rating and unit weight formulas with BIS 10500:2012 limits: https://jjees.hu.edu.jo/files/Vol17/No3/JJEES_Vol_17_No_3_P3.pdf ; https://techniumscience.com/index.php/technium/article/view/10737/4240
- **[S2]** WQI bands 0-25 / 26-50 / 51-75 / 76-100 / >100: https://pmc.ncbi.nlm.nih.gov/articles/PMC9079147/table/tab2 ; https://www.ijert.org/?p=17831
- **[S3]** BIS IS 10500:2012 (pH 6.5-8.5; TDS 500/2000; turbidity 1/5): https://phewater.assam.gov.in/sites/default/files/swf_utility_folder/departments/water_medhassu_in_oid_5/menu/document/Water%20Quality%20Standards.pdf ; https://www.rfhha.org/images/law/8.9%20INDIAN%20STANDARDS%20FOR%20SAFE%20DRINKING%20WATER.pdf
- **[S4]** WHO TDS palatability bands: https://guidelines.nhmrc.gov.au/australian-drinking-water-guidelines/part-5/physical-chemical-characteristics/total-dissolved-solids
- **[S5]** CPCB designated best use classes A to E: https://cpcb.nic.in/water-quality-criteria/ ; https://cpcb.nic.in/NGTMC/T_1_d.pdf
- **[S6]** FAO Irrigation and Drainage Paper 29 Rev.1, Ayers and Westcot (1985): https://smallfarms.oregonstate.edu/sites/agscid7/files/fg76-e.pdf ; https://www.fao.org/3/x5871e/x5871e07.htm
- **[S7]** CPCB general standards for discharge, EPA Schedule VI: https://www.foundryinfo-india.org/images/GeneralStandards.pdf
- **[S8]** Boyd, pH effects on aquaculture: https://www.globalseafood.org/advocate/water-quality-standards-ph/ ; pond guidance: https://fw.ky.gov/Fish/Pages/Farm-Pond-Management-Water-Quality.aspx
- **[S9b]** Warm-water fish temperature: https://eprints.cmfri.org.in/3264/1/Special_Publication_No_22.pdf ; https://mail.asci-india.com/img/English%20IECs/English%20Pamphlet/5.Pond%20Environment.pdf
- **[S9c]** FAO (2014) species table (common carp, Nile tilapia): https://learn.farmhub.ag/resources/small-scale-aquaponic-food-production/7-fish-in-aquaponics/water-quality-for-fish/
- **[S9d]** Secchi about 30 cm: same ASCI pamphlet as [S9b].
