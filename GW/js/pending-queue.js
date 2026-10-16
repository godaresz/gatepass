// Pending gatepasses - save later when Firebase is over quota / offline.
//
// When a save fails because the free daily quota is used up (or the
// network is down), the gatepass is kept in this browser's localStorage so
// it can still be printed. pending-sync.js retries automatically
// (every few minutes, when the network comes back, and right after the
// daily quota reset) and the record is written with the SAME gatepass
// number that was printed.
//
// Each pending item is written with a fixed document id, so a retry can
// never create a duplicate.

import {
	doc,
	setDoc,
	updateDoc,
	serverTimestamp,
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { db, appId } from "./firebase-config.js";

const KEY = () => `gatepass_pending_${appId}`;
const gatepassesPath = () => `artifacts/${appId}/public/data/gatepasses`;
export const PENDING_EVENT = "gatepass-pending-changed";

// Errors that mean "try again later" (quota / network), not bad data.
export const isRetryableError = (e) =>
	["resource-exhausted", "unavailable", "deadline-exceeded"].includes(
		e?.code
	) || /quota|offline|network/i.test(String(e?.message || ""));

export const getPending = () => {
	try {
		const list = JSON.parse(localStorage.getItem(KEY()) || "[]");
		return Array.isArray(list) ? list : [];
	} catch (e) {
		return [];
	}
};

const setPending = (list) => {
	localStorage.setItem(KEY(), JSON.stringify(list));
	window.dispatchEvent(new CustomEvent(PENDING_EVENT));
};

const newLocalId = () =>
	"pending_" +
	Date.now().toString(36) +
	Math.random().toString(36).slice(2, 8);

// kind: "create" (new gatepass) or "update" (edit of docId).
// data: plain gatepass fields; issueDate as a Date.
export const addPending = ({ kind, docId = null, data }) => {
	const item = {
		localId: newLocalId(),
		kind,
		docId,
		createdAt: Date.now(),
		data: {
			...data,
			issueDate:
				data.issueDate instanceof Date ? data.issueDate.getTime() : null,
		},
	};
	setPending([...getPending(), item]);
	return item;
};

// Firestore quota resets at midnight US Pacific time
// (14:00 or 15:00 Thailand time, depending on US daylight saving).
export const nextQuotaReset = (now = new Date()) => {
	const parts = Object.fromEntries(
		new Intl.DateTimeFormat("en-US", {
			timeZone: "America/Los_Angeles",
			hour: "numeric",
			minute: "numeric",
			second: "numeric",
			hourCycle: "h23",
		})
			.formatToParts(now)
			.map((p) => [p.type, p.value])
	);
	const sinceMidnight =
		(Number(parts.hour) * 3600 + Number(parts.minute) * 60 + Number(parts.second)) *
		1000;
	return new Date(now.getTime() - sinceMidnight + 24 * 3600 * 1000);
};

export const formatTime = (date) =>
	`${String(date.getHours()).padStart(2, "0")}:${String(
		date.getMinutes()
	).padStart(2, "0")}`;

let syncing = null;

// Tries to write every pending item. Stops at the first quota/network
// error (the rest would fail the same way). Returns { saved, left }.
export const syncPending = () => {
	if (syncing) return syncing;
	syncing = (async () => {
		let saved = 0;
		for (const item of getPending()) {
			const data = { ...item.data };
			if (item.data.issueDate) data.issueDate = new Date(item.data.issueDate);
			else if (item.kind === "update") delete data.issueDate; // keep original
			else data.issueDate = serverTimestamp();
			try {
				if (item.kind === "update" && item.docId) {
					await updateDoc(doc(db, gatepassesPath(), item.docId), {
						...data,
						lastUpdated: serverTimestamp(),
					});
				} else {
					await setDoc(doc(db, gatepassesPath(), item.localId), {
						...data,
						savedFromPending: true,
					});
				}
				setPending(getPending().filter((p) => p.localId !== item.localId));
				saved++;
			} catch (e) {
				console.warn("Pending gatepass not saved yet:", e);
				const list = getPending();
				const stored = list.find((p) => p.localId === item.localId);
				if (stored) {
					stored.lastError = String(e?.code || e?.message || e);
					stored.lastTry = Date.now();
					setPending(list);
				}
				if (isRetryableError(e)) break;
			}
		}
		return { saved, left: getPending().length };
	})().finally(() => {
		syncing = null;
	});
	return syncing;
};
