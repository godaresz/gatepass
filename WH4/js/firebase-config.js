import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// --- Centralized Configuration ---
// แก้ไขค่า Config ที่นี่ที่เดียว แล้วจะมีผลกับทุกไฟล์
const appId =
  typeof __app_id !== "undefined" ? __app_id : "issue-gate-pass-ldc-sr-wh4";

const firebaseConfig =
  typeof __firebase_config !== "undefined"
    ? JSON.parse(__firebase_config)
    : {
        apiKey: "AIzaSyCKfVXPR1G9mW4HcXBsQ3zOJgibhIIxtuA",
        authDomain: "issue-gate-pass-ldc-wh4.firebaseapp.com",
        projectId: "issue-gate-pass-ldc-wh4",
        storageBucket: "issue-gate-pass-ldc-wh4.firebasestorage.app",
        messagingSenderId: "170842402829",
        appId: "1:170842402829:web:354618c192305aa7ace544",
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
  gatepassPrefix: "LDC-SR-WH4",
};

// Export ตัวแปรเพื่อให้ไฟล์อื่นเรียกใช้ได้ทันที
export { app, auth, db, appId, siteConfig };
