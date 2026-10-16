// Shared helpers used by the gatepass pages (issue, gatepass-in, record,
// master, report). Nothing in here touches the login / user system.

export const QTY_FIELDS = ["ptb", "cpb", "mov", "stp", "pl", "rp"];
export const EMPTY_VEHICLE = "รถเปล่า";

// Escape text before it is put into innerHTML or an HTML attribute, so a
// value such as `"` or `<` in a name can never break the markup.
export const escapeHtml = (value) =>
	String(value ?? "")
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");

// YYYYMMDD in the browser's local time zone. `toISOString()` is UTC, which
// in Thailand (UTC+7) still gives yesterday's date until 07:00.
export const toLocalDateKey = (date = new Date()) =>
	String(date.getFullYear()) +
	String(date.getMonth() + 1).padStart(2, "0") +
	String(date.getDate()).padStart(2, "0");

// "YYYY-MM-DD" + optional "HH:mm" / "HH:mm:ss" -> Date. When `endOfRange`
// is set, a missing time means 23:59:59.999 and a time without seconds
// covers the whole minute, so records stamped e.g. 23:59:30 are included.
export const buildRangeDate = (dateStr, timeStr, endOfRange = false) => {
	if (!dateStr) return null;
	const [y, m, d] = dateStr.split("-").map(Number);
	const parts = String(timeStr || "")
		.split(":")
		.filter((p) => p !== "")
		.map(Number);
	if (!parts.length) {
		return endOfRange
			? new Date(y, m - 1, d, 23, 59, 59, 999)
			: new Date(y, m - 1, d, 0, 0, 0, 0);
	}
	const [hh = 0, mm = 0, ss] = parts;
	if (ss === undefined) {
		return endOfRange
			? new Date(y, m - 1, d, hh, mm, 59, 999)
			: new Date(y, m - 1, d, hh, mm, 0, 0);
	}
	return new Date(y, m - 1, d, hh, mm, ss, endOfRange ? 999 : 0);
};

// Quantity cell -> number. Empty means 0; anything that is not a whole,
// non-negative number returns NaN so the caller can reject it.
export const parseQty = (value) => {
	const raw = String(value ?? "").trim();
	if (raw === "") return 0;
	const n = Number(raw);
	return Number.isInteger(n) && n >= 0 ? n : NaN;
};

export const sumQty = (s = {}) =>
	QTY_FIELDS.reduce((acc, k) => acc + (Number(s[k]) || 0), 0);

// One CSV cell, always quoted, with embedded quotes doubled. 0 stays "0".
export const csvCell = (value) =>
	`"${String(value ?? "").replace(/"/g, '""')}"`;

export const downloadTextFile = (content, filename, type = "text/csv") => {
	const blob = new Blob([content], { type: `${type};charset=utf-8;` });
	const url = URL.createObjectURL(blob);
	const link = document.createElement("a");
	link.href = url;
	link.download = filename;
	link.style.display = "none";
	document.body.appendChild(link);
	link.click();
	document.body.removeChild(link);
	setTimeout(() => URL.revokeObjectURL(url), 1000);
};

// RFC 4180 style CSV parser: handles quoted commas, doubled quotes,
// line breaks inside quotes, CRLF and a UTF-8 BOM.
export const parseCsvText = (text) => {
	const rows = [];
	let row = [];
	let field = "";
	let inQuotes = false;
	const src = String(text || "").replace(/^﻿/, "");

	for (let i = 0; i < src.length; i++) {
		const c = src[i];
		if (inQuotes) {
			if (c === '"') {
				if (src[i + 1] === '"') {
					field += '"';
					i++;
				} else {
					inQuotes = false;
				}
			} else {
				field += c;
			}
		} else if (c === '"') {
			inQuotes = true;
		} else if (c === ",") {
			row.push(field);
			field = "";
		} else if (c === "\n") {
			row.push(field);
			rows.push(row);
			row = [];
			field = "";
		} else if (c !== "\r") {
			field += c;
		}
	}
	if (field !== "" || row.length) {
		row.push(field);
		rows.push(row);
	}
	return rows.filter((r) => r.some((v) => String(v).trim() !== ""));
};

// Firestore allows at most 500 writes per batch. `apply(batch, item)` adds
// one write per item; batches are committed in order.
export const commitInChunks = async (
	db,
	writeBatch,
	items,
	apply,
	onProgress
) => {
	const CHUNK = 450;
	for (let i = 0; i < items.length; i += CHUNK) {
		const batch = writeBatch(db);
		items.slice(i, i + CHUNK).forEach((item) => apply(batch, item));
		await batch.commit();
		if (onProgress) onProgress(Math.min(items.length, i + CHUNK), items.length);
	}
};
