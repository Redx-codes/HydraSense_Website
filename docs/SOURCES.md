# Sources and Assumptions

HydraSense ke saare estimates **indicative / screening-level** hain. Ye lab test ka replacement nahi hai. Website par bhi yahi disclaimer likha hai.

## Measured vs Estimated

| Cheez | Kaise aati hai |
|---|---|
| pH, TDS, Temperature, Turbidity | **Measured** (sensors) |
| WQI, Category, Class A-E | **Calculated** from 4 measured values |
| Salinity | **Estimated** = TDS / 1000 (ppt). Sirf TDS sensor ki range (~1000 ppm tak) ke liye theek hai. Samudri paani ke liye conductivity sensor chahiye. |
| Dissolved oxygen | **Estimated.** Saturation value temperature se (Benson-Krause / APHA equation). Asli DO isse kam ho sakta hai. Website "oxygen risk" batati hai (turbidity + TDS + temperature + pH ke hisaab se). |
| Ammonia (toxic NH3 fraction) | **Estimated** pH + temperature se (Emerson et al., 1975: pKa = 0.09018 + 2729.92 / T(K)). Total ammonia (TAN) measure nahi hota, isliye sirf "kitna hissa toxic hoga" bataya jata hai. Test-kit se TAN daalne par mg/L NH3 nikalta hai. |
| Hardness | **Rough estimate** = TDS x k (default 0.45, practical range 0.3-0.6). Admin mein calibrate ho sakta hai. Classes USGS ke hisaab se. |

## WQI

Weighted sub-index method (WQI ka standard idea: har parameter ko 0-100 score, phir weighted average).

| Parameter | Weight |
|---|---|
| pH | 25 % |
| TDS | 30 % |
| Turbidity | 30 % |
| Temperature | 15 % |

Categories: >= 90 Excellent, >= 70 Good, >= 50 Fair, >= 25 Poor, baaki Very Poor.

Weights hamari team ke design choice hain (4 sensors ke hisaab se). Agar guide ya professor kuch alag weights suggest karein to `js/logic.js` mein `PARAMS` mein badle ja sakte hain.

## Use classes (A-E)

| Class | Matlab | Website mein exact shart |
|---|---|---|
| A | Drinking-water screening | pH 6.5-8.5, TDS <= 500 ppm, turbidity <= 5 NTU (WHO/BIS limits ke aas-paas) |
| B | Irrigation | pH 6.0-8.5, TDS <= 2000 ppm |
| C | Fish culture | 5 mein se kam se kam ek machhli "Suitable" ya "Marginal" |
| D | Industrial / cooling / washing | WQI >= 25, pH 5.5-9.5, TDS <= 2000, turbidity <= 100, temp <= 45 °C |
| E | Polluted / drain-like | Upar ki koi class pass nahi |

Overall label ka niyam: agar A pass to "A"; nahi to B/C (dono pass to "B/C"); nahi to D; warna E.

**Important:** Class A "pani peene layak hai" ka dawa nahi hai. Wo sirf "screening mein koi bada red flag nahi mila" kehta hai.

## Fish ranges (indicative)

Ye ranges FAO / ICAR / aquaculture extension literature mein milne wali typical values hain. Alag-alag source thoda alag dete hain, isliye in numbers ko "guide" samjhein.

| Species | pH optimum (tolerable) | Temp °C optimum (tolerable) | Turbidity NTU | TDS ppm |
|---|---|---|---|---|
| Rohu (*Labeo rohita*) | 7-8.5 (6.5-9) | 25-32 (20-36) | <=30 (<=80) | <=1000 (<=2000) |
| Catla (*Catla catla*) | 7-8.5 (6.5-9) | 25-32 (20-36) | <=30 (<=80) | <=1000 (<=2000) |
| Common carp (*Cyprinus carpio*) | 6.5-8.5 (5.5-9.5) | 20-30 (10-35) | <=50 (<=100) | <=1000 (<=2000) |
| Tilapia (*Oreochromis niloticus*) | 6.5-8.5 (5.5-9.5) | 25-32 (18-35) | <=50 (<=100) | <=1000 (<=2000) |
| Pangasius (*Pangasianodon hypophthalmus*) | 6.5-8.5 (5.5-9.5) | 26-31 (20-34) | <=50 (<=100) | <=1000 (<=2000) |

Result: **Suitable** (sab optimum), **Marginal** (kuch tolerable but ideal nahi, ya oxygen/ammonia risk high), **Not suitable** (koi parameter tolerable range ke bahar).

## Alerts

Alerts sirf website par dikhte hain (SMS/email nahi).

- **Absolute limits:** pH < 6.5 ya > 8.5 (warning), < 6 ya > 9 (critical); TDS > 500 (warning), > 1000 (critical); turbidity > 5 (warning), > 25 (critical); temperature > 35 ya < 5 °C (warning); WQI < 50 (warning), < 25 (critical).
- **Change alert:** naya WQI usi spot ke pichle 5 visits ke average se **15 ya zyada points** kam ho (kam se kam 3 purane visits chahiye) -> "possible pollution event" (critical).
- **Anomaly:** koi parameter us spot ke apne purane readings se z-score > 3 door ho (kam se kam 5 purane visits chahiye).
- **Estimated:** oxygen risk high (warning), toxic ammonia danger (critical, jab test-kit TAN diya ho).
- **Low confidence** reading par alert nahi diya jata, sirf ek info line aati hai (galat alarm se bachne ke liye).

## Confidence score

100 se shuru. Kam hota hai: probe flags (-25 each), GPS weak (-10), readings settle nahi hui (-20), calibration 30/60 din se purani (-10/-20), kam satellites (-10), low battery (-5), physical range ke bahar value (-30). High >= 80, Medium >= 50, warna Low.

## References (padhne ke liye)

- Benson & Krause (1984) and APHA Standard Methods, 4500-O: oxygen solubility in water.
- Emerson, Russo, Lund, Thurston (1975), *J. Fish. Res. Board Can.* 32: aqueous ammonia equilibrium.
- WHO Guidelines for Drinking-water Quality; BIS IS 10500 (drinking water limits).
- FAO Fisheries and Aquaculture species fact sheets for Rohu, Catla, Common carp, Nile tilapia, Striped catfish (Pangasius).
- USGS water hardness classes.

*Inme se exact numbers aap apni report mein cite karne se pehle original source se ek baar verify kar lena.*
