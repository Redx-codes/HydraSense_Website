// Firebase web config. This is NOT a secret (security comes from database.rules.json).
export const firebaseConfig = {
  apiKey: "AIzaSyBZjcIom6q0l4gdiSKYAlqVtiiT0iFlEWA",
  authDomain: "virtualtpms.firebaseapp.com",
  databaseURL: "https://virtualtpms-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "virtualtpms",
  storageBucket: "virtualtpms.firebasestorage.app",
  messagingSenderId: "336049293220",
  appId: "1:336049293220:web:d6bb5e8f52ccdcbef9e331",
};

export const ADMIN_EMAIL = "reevupaul@gmail.com"; // must also be set in database.rules.json
export const DB_ROOT = "hydrasense_v2";            // all HydraSense data lives under this path
export const SPOT_RADIUS_M = 50;                   // measurements within 50 m = same spot
export const FIREBASE_VER = "10.12.2";
