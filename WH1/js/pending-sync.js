// Shows how many gatepasses are waiting to be saved (pending) and saves
// them automatically. Loaded on every page; only runs while a page of this
// site is open in the browser that holds the pending gatepasses.

import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { auth } from "./firebase-config.js";
import {
	getPending,
	syncPending,
	nextQuotaReset,
	formatTime,
	PENDING_EVENT,
} from "./pending-queue.js";

const RETRY_EVERY_MS = 10 * 60 * 1000; // 10 minutes

let banner = null;
let authReady = false;
let resetTimer = null;

const ensureBanner = () => {
	if (banner) return banner;
	banner = document.createElement("div");
	banner.id = "pending-banner";
	banner.className = "no-print";
	banner.style.cssText =
		"position:fixed;left:12px;bottom:12px;z-index:60;max-width:min(420px,calc(100vw - 24px));" +
		"background:#fef3c7;border:1px solid #f59e0b;color:#78350f;border-radius:10px;" +
		"padding:10px 12px;font-size:13px;box-shadow:0 4px 12px rgba(0,0,0,.15);display:none";
	document.body.appendChild(banner);
	// Never on the printed gatepass.
	const style = document.createElement("style");
	style.textContent =
		"@media print{#pending-banner,#pending-notice,#gatepassIN_pendingNotice{display:none!important}}";
	document.head.appendChild(style);
	return banner;
};

// Leave room under the page so the banner never covers its buttons.
const fitPage = () => {
	const shown = banner && banner.style.display !== "none";
	document.body.style.paddingBottom = shown
		? `${banner.offsetHeight + 24}px`
		: "";
};

const render = (message) => {
	renderBanner(message);
	fitPage();
};

const renderBanner = (message) => {
	const list = getPending();
	const el = ensureBanner();
	if (!list.length) {
		el.style.display = message ? "block" : "none";
		if (message) {
			el.style.background = "#dcfce7";
			el.style.borderColor = "#22c55e";
			el.style.color = "#14532d";
			el.textContent = message;
			setTimeout(() => {
				if (!getPending().length) el.style.display = "none";
				fitPage();
			}, 8000);
		}
		return;
	}
	el.style.display = "block";
	el.style.background = "#fef3c7";
	el.style.borderColor = "#f59e0b";
	el.style.color = "#78350f";
	const numbers = list
		.map((p) => p.data?.gatepassNo)
		.filter(Boolean)
		.slice(0, 5)
		.join(", ");
	el.innerHTML = "";
	const text = document.createElement("div");
	text.innerHTML =
		`<strong>⏳ Pending ${list.length} ใบ</strong> — ยังไม่ได้บันทึกลงระบบ` +
		`<br>จะบันทึกอัตโนมัติเมื่อโควต้า Firebase รีเซ็ต (ประมาณ ${formatTime(
			nextQuotaReset()
		)} น.) <b>อย่าล้างข้อมูลเบราว์เซอร์</b> และเปิดหน้าเว็บนี้ค้างไว้`;
	const nums = document.createElement("div");
	nums.style.cssText = "margin-top:4px;font-size:12px;opacity:.85";
	nums.textContent =
		numbers + (list.length > 5 ? " ..." : "") + (message ? ` — ${message}` : "");
	const btn = document.createElement("button");
	btn.type = "button";
	btn.textContent = "บันทึกตอนนี้";
	btn.style.cssText =
		"margin-top:6px;background:#d97706;color:#fff;border:0;border-radius:6px;padding:4px 10px;cursor:pointer";
	btn.addEventListener("click", () => trySync(true));
	el.append(text, nums, btn);
};

const trySync = async (manual = false) => {
	if (!authReady || !getPending().length) return render();
	const { saved, left } = await syncPending();
	if (saved && !left) render(`✅ บันทึก Pending ครบแล้ว ${saved} ใบ`);
	else if (manual && left) render("ยังบันทึกไม่ได้ — ลองใหม่ภายหลัง");
	else render();
};

// One extra try just after the daily quota reset, then keep re-arming.
const armResetTimer = () => {
	clearTimeout(resetTimer);
	const delay = nextQuotaReset().getTime() - Date.now() + 60 * 1000;
	resetTimer = setTimeout(() => {
		trySync();
		armResetTimer();
	}, Math.min(delay, 2 ** 31 - 1));
};

const start = () => {
	render();
	window.addEventListener(PENDING_EVENT, () => render());
	// Another tab of the same site changed the list.
	window.addEventListener("storage", (e) => {
		if (e.key && e.key.startsWith("gatepass_pending_")) render();
	});
	window.addEventListener("online", () => trySync());
	setInterval(() => trySync(), RETRY_EVERY_MS);
	armResetTimer();

	onAuthStateChanged(auth, (user) => {
		if (user && !authReady) {
			authReady = true;
			trySync();
		}
	});
};

if (document.readyState === "loading") {
	document.addEventListener("DOMContentLoaded", start);
} else {
	start();
}
