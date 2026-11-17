# Sources (version 2)

The WQI, the five levels and the use-wise classification (drinking, irrigation, fish, industrial) are documented with
their references in **HydraSense_Logic.md** in this folder. That file is the reference for `js/hydrasense-logic.js`.

Added around it in `js/logic.js`:

| Rule | Basis |
|---|---|
| Kit limits in the advisor: nitrate 45 mg/L, iron 0.3 mg/L, hardness 200 / 600 mg/L, total ammonia 0.5 mg/L, free residual chlorine 0.2 to 1.0 mg/L | BIS IS 10500:2012 (same table as [S3] in HydraSense_Logic.md) |
| Oxygen "maximum possible" (saturation) | Benson and Krause equation, as used in APHA Standard Methods. Shown as an estimate only, never used as real oxygen |
| Toxic share of ammonia from pH and temperature | Emerson et al. (1975) |
| Toxic ammonia 0.02 / 0.05 mg/L bands for fish | common aquaculture guidance; HydraSense assumption [A] |
| Mining contamination risk index (points, bands, bonus) | team plan for SIH 26040; a screening score, not a published index [A] |
| Index scaling (points / 105 with iron, / 90 without) and iron 10 / 15 point split at 1 mg/L | HydraSense assumption [A] |
| Minimum oxygen per fish (rohu 5, catla 5, common carp 4, tilapia 3, pangasius 3 mg/L) | team plan [A]; used only when a real DO sensor value exists |
| Pangasius temperature 26-31 °C (tolerance 20-34 °C) | no single published range found; assumption [A], to be confirmed by a fisheries expert |
| EC to TDS factor 0.5 | typical for low-cost probes; adjustable [A] |
| Alert thresholds beyond the BIS limits (pH below 6 / above 9, turbidity above 25 NTU, WQI worse by 50 points) | HydraSense assumption [A] |

Everything marked [A] should be reviewed by a domain expert before any claim is made in public.
