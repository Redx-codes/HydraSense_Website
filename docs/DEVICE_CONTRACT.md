# Device Contract - ESP32 -> Database

Ye file hardware phase ke liye hai. ESP32 ko database ke saath kaise baat karni hai, yahan likha hai.

## 1. Kya bhejna hai (JSON)

Har button-press measurement = **ek JSON record**.

```json
{
  "device": "HS-001",
  "ts": 1767225600,
  "lat": 22.57260,
  "lon": 88.36390,
  "ph": 7.42,
  "tds": 318,
  "temp": 27.6,
  "turb": 3.1,
  "flags": 0,
  "stable": true,
  "calDays": 12,
  "sats": 8,
  "batt": 3.91
}
```

| Field | Type | Zaroori | Matlab | Allowed range |
|---|---|---|---|---|
| `device` | string | haan | Device ID (admin ne jo diya) | 1-32 chars |
| `ts` | number | haan | Unix time **seconds** mein (UTC) | > 1700000000, future mein 10 min se zyada nahi |
| `lat`, `lon` | number | haan | GPS location | -90..90, -180..180 |
| `ph` | number | haan | pH (calibrated) | 0..14 |
| `tds` | number | haan | ppm (temperature-compensated) | 0..5000 |
| `temp` | number | haan | Water temperature °C | -5..70 |
| `turb` | number | haan | NTU | 0..4000 |
| `flags` | number | nahi | Error bits (neeche) | 0..255 |
| `stable` | bool | nahi | 60 s ke baad readings settle hui? | true/false |
| `calDays` | number | nahi | Last calibration ko kitne din hue | 0..3650 |
| `sats` | number | nahi | GPS satellites | 0..60 |
| `batt` | number | nahi | Battery volts | 0..6 |
| `note` | string | nahi | Chhota text | max 80 chars |

Iske alawa koi aur field bhejoge to database reject kar dega. `test` aur `tan` fields device nahi bhejta (`test` sirf admin bhej sakta hai).

### `flags` bits (ESP32 set karega)

| Bit | Value | Matlab |
|---|---|---|
| 0 | 1 | pH probe unstable / disconnected |
| 1 | 2 | TDS probe unstable / disconnected |
| 2 | 4 | Turbidity probe unstable / disconnected |
| 3 | 8 | Temperature sensor (DS18B20) missing |
| 4 | 16 | GPS fix weak / purani location |

Jitne zyada flags, website par utna kam **Confidence score**.

### Kya ESP32 ka kaam hai, kya website ka

- **ESP32:** raw ADC -> pH/ppm/NTU, calibration, temperature compensation, median of samples, stability check, flags, LED.
- **Website:** WQI, Class A-E, oxygen/ammonia/salinity/hardness estimate, fish, alerts, confidence. Isliye ESP32 ko ye sab calculate karke **nahi** bhejna hai.

## 2. Authentication flow (REST)

Har device ka apna email + password hai (Admin -> Add device se milta hai).

### Step A - Login (idToken lo)

```
POST https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=<API_KEY>
Content-Type: application/json

{"email":"<DEVICE_EMAIL>","password":"<DEVICE_PASS>","returnSecureToken":true}
```
Response mein `idToken` (1 ghante valid), `refreshToken`, `localId` aata hai.

### Step B - Measurement likho

```
POST https://<DB_URL>/hydrasense_v2/measurements.json?auth=<idToken>
Content-Type: application/json

{ ...upar wala JSON... }
```
Success par `{"name":"-Nxxxxxxxx"}` aata hai. Wo naye record ka ID hai.

Error aaye to:
- `401 Permission denied` -> idToken expire hua, ya device registered nahi, ya `device` field galat ID hai.
- `400` / "Permission denied" -> koi field range ke bahar hai ya extra field hai.

> Sirf **naya record banana** allowed hai. Device purana record badal ya delete nahi kar sakta.

### ESP32 par HTTPS

`WiFiClientSecure` use hoga. Shuru mein `client.setInsecure()` se test kar sakte hain, final product mein Google ka root certificate set karenge. Ye hardware phase mein dekhenge.

### Time (`ts`)

ESP32 ko sahi time chahiye. Teen tareeke:
1. **GPS time** (NEO-6M deta hai) - field mein best, kyunki GPS fix to chahiye hi.
2. NTP (Wi-Fi par `configTime`).
3. Dono na mile to measurement save mat karo; LED par error dikhao.

## 3. Test with curl (laptop se, ESP32 ke bina)

```
# 1. login
curl -s -X POST "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email":"DEVICE_EMAIL","password":"DEVICE_PASS","returnSecureToken":true}'

# 2. idToken copy karke
curl -s -X POST "https://virtualtpms-default-rtdb.asia-southeast1.firebasedatabase.app/hydrasense_v2/measurements.json?auth=ID_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"device":"HS-001","ts":1767225600,"lat":22.5726,"lon":88.3639,"ph":7.4,"tds":300,"temp":27.5,"turb":3}'
```
(`ts` ko current Unix time se badal dena, warna "future" ya purana dikhega. `https://www.unixtimestamp.com` se mil jayega.)

## 4. Spot (50 m) kaise banta hai

Device ko spot ke baare mein kuch nahi bhejna. Website har measurement ki GPS location dekhkar 50 m ke andar wale records ko ek spot mein jod deti hai. Isi se history, "pichli baar se kitna badla" aur pollution alert banta hai.
