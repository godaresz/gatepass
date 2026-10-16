// Master data cache - keeps Firestore reads inside the free quota.
//
// Before: every page open read the whole master_data collection
// (N reads, N = number of master rows). Now a browser keeps a copy in
// localStorage and only checks ONE small "version" document; the full
// collection is read again only when Master Maintenance saved a change,
// or after MAX_AGE as a safety net (e.g. data edited in the Firebase
// console).
//
// The version lives in the existing "counters" collection
// (doc "master_version"), which the issue page already reads and writes.

import {
	doc,
	getDoc,
	setDoc,
	collection,
	getDocs,
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { db, appId } from "./firebase-config.js";

const MAX_AGE = 12 * 60 * 60 * 1000; // 12 hours
const CACHE_KEY = () => `gatepass_master_cache_${appId}`;
const masterPath = () => `artifacts/${appId}/public/data/master_data`;
const versionRef = () =>
	doc(db, `artifacts/${appId}/public/data/counters`, "master_version");

let memory = null; // same-page cache: { version, savedAt, rows }
let inflight = null;

const readCache = () => {
	try {
		const raw = localStorage.getItem(CACHE_KEY());
		const parsed = raw ? JSON.parse(raw) : null;
		return parsed && Array.isArray(parsed.rows) ? parsed : null;
	} catch (e) {
		return null;
	}
};

const writeCache = (entry) => {
	memory = entry;
	try {
		localStorage.setItem(CACHE_KEY(), JSON.stringify(entry));
	} catch (e) {
		// Storage full / disabled: the in-page copy still works.
	}
};

export const clearMasterCache = () => {
	memory = null;
	try {
		localStorage.removeItem(CACHE_KEY());
	} catch (e) {
		/* ignore */
	}
};

const readVersion = async () => {
	try {
		const snap = await getDoc(versionRef());
		return snap.exists() ? snap.data().version ?? 0 : 0;
	} catch (e) {
		console.warn("master version check failed:", e);
		return null;
	}
};

const fresh = (entry) => entry && Date.now() - entry.savedAt < MAX_AGE;

const load = async (force) => {
	if (!force && fresh(memory)) return memory.rows;

	const version = await readVersion();
	if (!force) {
		const cached = readCache();
		// version === null: the check itself failed; trust a fresh cache.
		if (fresh(cached) && (version === null || cached.version === version)) {
			memory = cached;
			return cached.rows;
		}
	}

	const snap = await getDocs(collection(db, masterPath()));
	const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
	rows.sort((a, b) => (a.order || 0) - (b.order || 0));
	writeCache({ version: version ?? -1, savedAt: Date.now(), rows });
	return rows;
};

// Rows as { id, ...fields }, sorted by `order`.
// `force: true` always reads the collection (Master Maintenance page).
export const getMasterData = ({ force = false } = {}) => {
	if (!force && inflight) return inflight;
	const p = load(force).finally(() => {
		if (inflight === p) inflight = null;
	});
	if (!force) inflight = p;
	return p;
};

// Call after master data was saved: bumps the version so every other
// browser re-reads once, and stores the new rows locally.
export const markMasterDataChanged = async (rows) => {
	const version = Date.now();
	try {
		await setDoc(versionRef(), { version }, { merge: true });
		writeCache({ version, savedAt: Date.now(), rows });
	} catch (e) {
		console.warn("Could not update master version:", e);
		clearMasterCache();
	}
};
