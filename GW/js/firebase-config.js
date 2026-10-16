import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// --- Centralized Configuration ---
// แก้ไขค่า Config ที่นี่ที่เดียว แล้วจะมีผลกับทุกไฟล์
const appId =
  typeof __app_id !== "undefined" ? __app_id : "issue-gate-pass-ldc-sr";

const firebaseConfig =
  typeof __firebase_config !== "undefined"
    ? JSON.parse(__firebase_config)
    : {
        apiKey: "AIzaSyAe9t4-TXbrAruyRZTsFPsIlao4LGySoOo",
        authDomain: "issue-gate-pass-ldc-gw.firebaseapp.com",
        projectId: "issue-gate-pass-ldc-gw",
        storageBucket: "issue-gate-pass-ldc-gw.firebasestorage.app",
        messagingSenderId: "605247517261",
        appId: "1:605247517261:web:dd7bc4592f88845dd4e204",
      };

let app, auth, db;

try {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
  console.log("Firebase Initialized Successfully from Central Config");
} catch (error) {
  console.error("Firebase initialization failed in config:", error);
}

// --- Site Settings ---
// ค่าที่ต่างกันในแต่ละคลัง (WH1 / WH4 / GW) อยู่ที่นี่ที่เดียว
// gatepassPrefix ใช้สร้างเลขที่ Gatepass: YYYYMMDD-<prefix>-001
const siteConfig = {
  gatepassPrefix: "LDC-GW",
};

// Export ตัวแปรเพื่อให้ไฟล์อื่นเรียกใช้ได้ทันที
export { app, auth, db, appId, siteConfig };
