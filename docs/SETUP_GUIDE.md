# HydraSense Website - Setup Guide (Hinglish)

Is guide mein sab kuch step-by-step hai. Aapko code nahi likhna hai, sirf Firebase console mein kuch buttons dabane hain aur files upload karni hain. Total time: lagbhag 30-40 minute.

**Aapka Firebase project:** `virtualtpms`
**Aapka admin Gmail:** `reevupaul@gmail.com`

---

## Pehle samajh lijiye - kaun si cheez kahan hai

| Cheez | Kahan hai | Kaam |
|---|---|---|
| Website (public) | `index.html` | Map, nodes, WQI, fish, history, alerts, QR. **Koi login nahi.** |
| Admin page | `admin.html` | Sirf aapke Gmail se login. Device add karna, test data, spot ka naam. |
| Database | Firebase Realtime Database | Saari measurements yahin save hoti hain. |
| Firewall | `database.rules.json` | Decide karta hai kaun likh sakta hai, kaun nahi. |
| Logic | `js/logic.js` | WQI, use class, oxygen/ammonia estimate, fish, alerts, confidence. |

---

## Step 0 - Zaroori warning (2 minute)

Naye Rules publish karte hi database ka **root band** ho jayega. Matlab Realtime Database mein `examples` ya koi aur purana data hai to uska read/write band ho jayega (data delete nahi hoga, bas access band).

- Agar `virtualtpms` project ko aap sirf HydraSense ke liye use kar rahe hain -> koi problem nahi.
- Agar isi database mein kisi aur project ka data bhi hai -> pehle mujhe bataiye, main rules usko bhi allow karne ke liye badal dunga.

---

## Step 1 - Rules publish karo (firewall on)

1. https://console.firebase.google.com -> project **virtualtpms** kholo.
2. Left menu -> **Build -> Realtime Database -> Rules** tab.
3. Jo likha hai (`".read": true, ".write": true`) wo **poora delete** karo.
4. `database.rules.json` file Notepad mein kholo, **poora copy** karo, yahan paste karo.
5. **Publish** dabao.

Isse kya hoga:
- Koi bhi website dekh sakta hai (read).
- Sirf **aap (admin Gmail)** aur **registered ESP32 device** likh sakte hain.
- Galat values (pH 20, future time, etc.) database accept nahi karega.

> Jab tak ye step nahi karenge, aapka database sabke liye khula rahega. Isliye ye step zaroor karein.

---

## Step 2 - Google sign-in on karo (admin ke liye)

1. Firebase console -> **Build -> Authentication -> Sign-in method**.
2. **Google** par click -> **Enable** on karo.
3. **Project support email** mein koi bhi email chun lo (jaise `reevupaul@gmail.com`). Ye sirf display ke liye hai, isse admin login par koi asar nahi padta.
4. **Save**.

Admin login hamesha `reevupaul@gmail.com` wale Google account se hi chalega. Koi aur Gmail se login karenge to page "not the admin account" bolega aur Rules bhi write nahi karne denge.

> **Email/Password** provider ON hi rehne do. ESP32 devices usi se login karte hain.

---

## Step 3 - Website host karo (free)

Do raaste hain. **Option A** sabse aasaan hai kyunki aap GitHub pehle use kar chuke hain.

### Option A - GitHub Pages (recommended, bilkul free)

1. GitHub par repo kholo (jo pehle banaya tha) ya naya repo banao. **Repo Public hona chahiye** (free plan par private repo ka Pages nahi chalta). Chinta mat karo: Firebase web config secret nahi hota, asli suraksha Step 1 ke Rules se aati hai.
2. Is zip ko **extract** karo. **Andar ki files** upload karo (zip khud nahi): `index.html`, `admin.html`, `css/`, `js/`, `docs/`, `database.rules.json`, `firebase.json`. Upload ke liye **Add file -> Upload files**, folders ko drag-and-drop kar do.
3. Purani Render wali files (`server/`, `static/`, `wqi.py` etc.) repo mein hon to delete kar do.
4. Repo -> **Settings -> Pages -> Build and deployment** -> Source: **Deploy from a branch** -> Branch: **main**, folder **/ (root)** -> Save.
5. 1-2 minute baad link milega: `https://<aapka-username>.github.io/<repo-name>/`

### Option B - Firebase Hosting (agar command line se kaam karna ho)

```
npm install -g firebase-tools
firebase login
cd hydrasense-web
firebase deploy --only hosting
```
Link: `https://virtualtpms.web.app`. Is raaste mein Step 4 ki zaroorat nahi, domain auto-add hota hai.

---

## Step 4 - Domain authorize karo (sirf GitHub Pages ke liye)

Admin Google login tabhi chalega jab website ka domain Firebase ko pata ho.

1. Firebase console -> **Authentication -> Settings -> Authorized domains**.
2. **Add domain** -> `<aapka-username>.github.io` (sirf domain, bina `https://` aur bina repo-name ke).
3. Save.

---

## Step 5 - Pehla test (demo mode, database ke bina)

Browser mein kholo:

`https://<aapka-username>.github.io/<repo-name>/index.html?demo=1`

Yahan 4 demo spot dikhne chahiye. Ek node par click karo -> neeche/side panel mein WQI, Class A-E, Estimated Chemistry, 5 machhliyan, alerts. Ye demo mode hai, Firebase se kuch nahi aata.

**Laptop par local test (internet hosting ke bina):**
```
cd hydrasense-web
python -m http.server 8000
```
Phir browser: `http://localhost:8000/index.html?demo=1`. (File ko seedha double-click karke mat kholna, `file://` par modules nahi chalte.)

---

## Step 6 - Admin login + asli database ke saath test

1. `https://<...>/admin.html` kholo -> **Sign in with Google** -> `reevupaul@gmail.com` chuno.
2. Neeche **Settings & test data** mein **Add sample test data** dabao. Map ke center ke aas-paas sample nodes ban jayenge (TEST mark ke saath).
3. Public page (`index.html`) kholo -> upar **Show test data** tick karo -> nodes dikhne chahiye.
4. **Manual measurement** se apna college lake ka point bhi daal sakte ho: map par click karo, pH/TDS/temp/turbidity bharo, **Save**.
   - "Mark as TEST data" tick rakhoge to normal visitors ko ye node nahi dikhega.
   - Asli measurement dikhana ho to tick hata do.
5. Test khatam hone par **Delete ALL test data**.

---

## Step 7 - Naya ESP32 device add karna

1. `admin.html` -> **Add a new device**.
2. Device ID (jaise `HS-001`) aur naam likho -> **Add device**.
3. Ek box dikhega jisme `DEVICE_ID`, `DEVICE_EMAIL`, `DEVICE_PASS`, `API_KEY`, `DB_URL` honge. **Password dobara nahi dikhega**, isliye abhi copy karke safe jagah save kar lo.
4. Ye saari values baad mein ESP32 firmware mein jayengi (hardware phase mein main bataunga).

Har device ka apna alag login hota hai. Kabhi device kho jaye to us device ka Firebase user Authentication -> Users se delete kar do aur wo database mein likh nahi paayega.

---

## Step 8 - QR code

1. Public website -> **QR** tab.
2. Jo link dikh raha hai wo aapki live website ka link hona chahiye (localhost ya 192.168... nahi). Warning aaye to pehle website host karo.
3. QR ko **PNG save** ya print karke device par chipka do. Ek hi universal QR sab devices ke liye chalega.

---

## Spot ka naam kaise rakhein

Admin -> **Name your spots**. Jahan 50 m ke andar baar-baar measurement hogi wo ek "spot" ban jata hai. Wahan naam likho (jaise "College Lake - North Ghat") -> Save. Public website par wahi naam dikhega.

## Hardness ko behtar kaise karein (optional)

Hardness hum TDS se roughly nikalte hain (`TDS x 0.45`). Agar aap ek baar test kit ya lab se asli hardness maloom kar lein, to `hardness / TDS` ka ratio Admin -> **Hardness calibration factor** mein daal do. Phir us jagah ka estimate zyada sahi hoga.

## Agar kuch na chale

| Problem | Karan | Solution |
|---|---|---|
| Website par "Could not read data: permission denied" | Rules publish nahi hue ya galat paste hue | Step 1 dobara karo, poora JSON copy karo |
| Admin page par Google popup error | Domain authorize nahi hua | Step 4 |
| "not the admin account" | Galat Gmail se login | Sign out karke `reevupaul@gmail.com` chuno |
| Map khaali/grey | Internet ya OpenStreetMap tiles slow | Refresh, ya dusra network try karo |
| Add device par error `email-already-in-use` | Us ID ka device pehle bana tha | Authentication -> Users mein delete karke dobara banao |
| Nodes nahi dikh rahe | Test data hai aur "Show test data" band hai | Checkbox tick karo |

## Limits (free plan)

Firebase Spark plan ke Realtime Database mein lagbhag 1 GB storage aur 10 GB/month download free hai. Ek measurement lagbhag 250 byte ki hai, to 1 GB mein kareeb 40 lakh measurements aa jayengi. Ek device roz 100 baar bhi naapein to varsho tak chalega. Website abhi sabse naye 2000 records padhti hai, isliye data badhne par bhi fast rehti hai.
