import { setLogLevel } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import {
	signInAnonymously,
	onAuthStateChanged,
	signInWithCustomToken,
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import {
	doc,
	getDoc,
	updateDoc,
	collection,
	getDocs,
	runTransaction,
	serverTimestamp,
	setLogLevel as fsSetLogLevel,
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// --- IMPORT จากไฟล์กลาง ---
import { auth, db, appId, siteConfig } from "./firebase-config.js";
import {
	QTY_FIELDS,
	EMPTY_VEHICLE,
	escapeHtml,
	toLocalDateKey,
	parseQty,
	sumQty,
} from "./utils.js";

let masterData = [];
let masterDataCache = {
	companies: new Set(),
	zones: new Set(),
	issueBys: new Set(),
};
let isSaving = false;
let masterDataPromise = null;
const MIN_TABLE_ROWS = 30;

// --- UI Helpers ---
const showModal = (msg, title = "Error!", success = false) => {
	const msgEl = document.getElementById("modal-message");
	const titleEl = document.getElementById("modal-title");
	const icon = document.getElementById("modal-icon-container");
	const btn = document.getElementById("modal-close-btn");
	const modal = document.getElementById("alert-modal");

	if (msgEl) msgEl.textContent = msg;
	if (titleEl) titleEl.textContent = title;

	if (icon) {
		icon.innerHTML = success
			? `<svg class="h-6 w-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>`
			: `<svg class="h-6 w-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>`;
		icon.className = `mx-auto flex items-center justify-center h-12 w-12 rounded-full ${
			success ? "bg-green-100" : "bg-red-100"
		}`;
	}

	if (btn) {
		btn.className = `px-4 py-2 text-white text-base font-medium rounded-md w-full shadow-sm focus:outline-none focus:ring-2 ${
			success ? "bg-green-500" : "bg-red-500"
		}`;
	}

	if (modal) modal.classList.remove("hidden");
};

const hideModal = () => {
	const modal = document.getElementById("alert-modal");
	if (modal) modal.classList.add("hidden");
};

const formatDateEN = (dateObj) => {
	if (!dateObj) return "N/A";
	const d = String(dateObj.getDate()).padStart(2, "0");
	const m = String(dateObj.getMonth() + 1).padStart(2, "0");
	const y = dateObj.getFullYear();
	const h = String(dateObj.getHours()).padStart(2, "0");
	const min = String(dateObj.getMinutes()).padStart(2, "0");
	const s = String(dateObj.getSeconds()).padStart(2, "0");
	return `${d}/${m}/${y} ${h}:${min}:${s}`;
};

// --- Master Data ---
// Loads master data once; every caller can await the same promise, so the
// edit screen never validates suppliers against a list that is still empty.
const fetchMasterData = () => {
	if (!masterDataPromise) masterDataPromise = loadMasterData();
	return masterDataPromise;
};

const loadMasterData = async () => {
	if (!db) return;
	try {
		const snap = await getDocs(
			collection(db, `artifacts/${appId}/public/data/master_data`)
		);
		masterData = snap.docs.map((d) => d.data());
		masterDataCache = {
			companies: new Set(),
			zones: new Set(),
			issueBys: new Set(),
		};
		masterData.forEach((d) => {
			if (d.company) masterDataCache.companies.add(d.company);
			if (d.zone1) masterDataCache.zones.add(d.zone1);
			if (d.zone2) masterDataCache.zones.add(d.zone2);
			if (d.issueBy) masterDataCache.issueBys.add(d.issueBy);
		});
		populateDatalists();
	} catch (e) {
		console.error(e);
		masterDataPromise = null; // allow a retry
		showModal(
			"โหลด Master Data ไม่สำเร็จ กรุณาตรวจสอบอินเทอร์เน็ตแล้วรีเฟรชหน้า"
		);
	}
};

const populateDatalists = () => {
	const fill = (id, set) => {
		const el = document.getElementById(id);
		if (el) {
			el.innerHTML = "";
			[...set].sort().forEach((v) => {
				const opt = document.createElement("option");
				opt.value = v;
				el.appendChild(opt);
			});
		}
	};
	fill("company-list", masterDataCache.companies);
	fill("zone-list", masterDataCache.zones);
	fill("issueBy-list", masterDataCache.issueBys);
};

// --- Form & Table Logic ---
const populateSupplierTable = (suppliers = []) => {
	const tbody = document.getElementById("supplier-table-body");
	if (!tbody) return;
	tbody.innerHTML = "";
	const frag = document.createDocumentFragment();
	// Never drop saved lines: show every saved supplier plus one free row.
	const rowCount = Math.max(MIN_TABLE_ROWS, suppliers.length + 1);
	for (let i = 0; i < rowCount; i++) {
		const s = suppliers[i] || {};
		const hasData = !!suppliers[i];
		// Row 1, every saved row and the row right after the last saved one
		// are open, so an edited gatepass can still get new lines.
		const isOpen = i === 0 || hasData || i === suppliers.length;
		const row = document.createElement("tr");
		row.className =
			"border-b border-gray-200 hover:bg-gray-100 last:border-b-0";
		let html = `
            <td class="py-3 px-4 text-left align-top">
                <div class="flex items-start space-x-2">
                    <span class="text-sm font-semibold text-gray-500 pt-1">${
											i + 1
										}.</span>
                    <div class="w-full">
                        <input type="text" name="name" data-index="${i}" list="supplier-name-list" autocomplete="off" class="uppercase-input w-full p-1 border border-gray-300 rounded-md" value="${escapeHtml(
			s.name || ""
		)}" ${isOpen ? "" : "disabled"}>
                        <p id="error-supplier-${i}-name" class="text-red-500 text-xs mt-1"></p>
                    </div>
                </div>
            </td>`;

		// Generate Input Fields
		QTY_FIELDS.forEach((f) => {
			const isRP = s.name === EMPTY_VEHICLE;
			const val = s[f] !== undefined ? s[f] : "";
			const dis = !hasData || isRP;
			html += `<td class="py-3 px-4 text-left">
                <input type="number" name="${f}" data-index="${i}" autocomplete="off" class="w-full p-1 border border-gray-300 rounded-md ${
				dis ? "bg-gray-100" : ""
			}" value="${escapeHtml(val)}" min="0" step="1" ${dis ? "disabled" : ""}>
            </td>`;
		});

		// Add Row Total Column
		html += `<td class="py-3 px-4 text-left">
              <input type="number" name="row-total" data-index="${i}" class="w-full p-1 border border-gray-300 rounded-md bg-indigo-50 text-center font-bold text-indigo-700" value="0" disabled>
            </td>`;

		row.innerHTML = html;
		frag.appendChild(row);
	}
	tbody.appendChild(frag);
	updateTotalsDisplay();
};

const updateTotalsDisplay = () => {
	const totals = { ptb: 0, cpb: 0, mov: 0, stp: 0, pl: 0, rp: 0, grand: 0 };

	document.querySelectorAll("#supplier-table-body tr").forEach((row) => {
		let rowSum = 0;

		// Calculate individual field totals and row sum
		QTY_FIELDS.forEach((f) => {
			const val = parseQty(row.querySelector(`input[name="${f}"]`).value) || 0;
			if (val > 0) {
				totals[f] += val;
				rowSum += val;
			}
		});

		// Update the row total input
		const rowTotalInput = row.querySelector('input[name="row-total"]');
		if (rowTotalInput) {
			rowTotalInput.value = rowSum;
		}

		// Add to grand total
		totals.grand += rowSum;
	});

	// Update Footer Cells
	Object.keys(totals).forEach((k) => {
		// Standard totals
		const el = document.getElementById(
			k === "grand" ? "grand-total" : `total-${k}`
		);
		if (el) el.textContent = totals[k];
	});

	// Update the new "Total Row Sum" column footer (which matches Grand Total)
	const totalRowSumEl = document.getElementById("total-row-sum");
	if (totalRowSumEl) totalRowSumEl.textContent = totals.grand;
};

// `revalidate` re-checks every supplier row. It runs on "change" (field
// left / value picked), not on every keystroke: re-checking while the user is
// still typing the company name would clear the quantities of every row.
const handleCompanyChange = (revalidate = true) => {
	const compEl = document.getElementById("company");
	const zoneEl = document.getElementById("zone");
	const dl = document.getElementById("supplier-name-list");

	if (!compEl || !zoneEl || !dl) return;

	const comp = compEl.value.trim().toUpperCase();
	const zone = zoneEl.value.trim().toUpperCase();
	dl.innerHTML = "";

	if (comp && zone) {
		const valid = new Set();
		masterData.forEach((d) => {
			if (
				d.company?.trim().toUpperCase() === comp &&
				d.zone2?.trim().toUpperCase() === zone &&
				d.supplier
			) {
				valid.add(d.supplier);
			}
		});
		const frag = document.createDocumentFragment();
		const rp = document.createElement("option");
		rp.value = EMPTY_VEHICLE;
		frag.appendChild(rp);
		[...valid].sort().forEach((v) => {
			const o = document.createElement("option");
			o.value = v;
			frag.appendChild(o);
		});
		dl.appendChild(frag);
	}

	if (!revalidate) return;
	document
		.querySelectorAll('#supplier-table-body input[name="name"]')
		.forEach((inp) => {
			if (inp.value.trim()) validateRow(inp);
		});
};

const isValidSupplier = (comp, zone, name) =>
	masterData.some(
		(d) =>
			d.company?.trim().toUpperCase() === comp &&
			d.zone2?.trim().toUpperCase() === zone &&
			d.supplier?.trim().toUpperCase() === name.toUpperCase()
	);

const validateRow = (input) => {
	const name = input.value.trim();
	const idx = input.dataset.index;
	const comp = document.getElementById("company").value.trim().toUpperCase();
	const zone = document.getElementById("zone").value.trim().toUpperCase();
	const errEl = document.getElementById(`error-supplier-${idx}-name`);
	const qInputs = input
		.closest("tr")
		.querySelectorAll('input[type="number"]:not([name="row-total"])');

	if (errEl) errEl.textContent = "";
	input.classList.remove("border-red-500", "border-green-500");

	if (!name) {
		qInputs.forEach((i) => {
			i.disabled = true;
			i.classList.add("bg-gray-100");
		});
		return;
	}
	if (name === EMPTY_VEHICLE) {
		qInputs.forEach((i) => {
			i.disabled = true;
			i.classList.remove("bg-gray-100");
			i.value = "0";
		});
		input.classList.add("border-green-500");
		enableNextRow(idx);
		updateTotalsDisplay();
		return;
	}
	if (!comp || !zone) {
		if (errEl) errEl.textContent = "กรอก Company/Zone ก่อน";
		input.classList.add("border-red-500");
		return;
	}
	const match = isValidSupplier(comp, zone, name);
	if (match) {
		qInputs.forEach((i) => {
			i.disabled = false;
			i.classList.remove("bg-gray-100");
		});
		input.classList.add("border-green-500");
	} else {
		qInputs.forEach((i) => {
			i.disabled = true;
			i.value = "";
			i.classList.add("bg-gray-100");
		});
		if (errEl) errEl.textContent = "Supplier ไม่ถูกต้อง";
		input.classList.add("border-red-500");
	}
	updateTotalsDisplay();
};

const enableNextRow = (idx) => {
	const nxt = document.querySelectorAll("#supplier-table-body tr")[
		parseInt(idx) + 1
	];
	if (nxt) nxt.querySelector('input[name="name"]').disabled = false;
};

// --- LOAD DATA FOR EDITING (NEW) ---
const loadGatepassForEditing = async (docId) => {
	try {
		const docRef = doc(db, `artifacts/${appId}/public/data/gatepasses`, docId);
		const snapshot = await getDoc(docRef);

		if (!snapshot.exists()) {
			showModal("Data not found");
			return;
		}

		const data = snapshot.data();
		if (data.status === "Empty-IN") {
			// Gatepass IN records have their own form.
			sessionStorage.setItem("editGatepassInId", docId);
			window.location.href = "gatepass-in.html";
			return;
		}
		// Supplier validation below needs the master list; without it every
		// row would be flagged invalid and its quantities cleared.
		await fetchMasterData();

		document.getElementById("docId").value = docId;
		document.getElementById("driverName").value = data.driverName || "";
		document.getElementById("truckNo").value = data.truckNo || "";
		document.getElementById("sealNo").value = data.sealNo || "";
		document.getElementById("company").value = data.company || "";
		document.getElementById("zone").value = data.zone || "";
		document.getElementById("issueBy").value = data.issueBy || "";

		populateSupplierTable(data.suppliers || []);
		handleCompanyChange();

		document.getElementById("save-btn").textContent = "Update Gatepass";
	} catch (error) {
		console.error("Load failed", error);
		showModal("Failed to load data for editing");
	}
};

// --- Submit ---
const handleSubmit = async (e) => {
	e.preventDefault();
	if (isSaving) return;
	isSaving = true;
	const btn = document.getElementById("save-btn");
	const orgTxt = btn.textContent;
	btn.disabled = true;
	btn.textContent = "Saving...";

	let valid = true;
	const formEl = document.getElementById("gatepass-form");
	formEl
		.querySelectorAll('p.text-red-500[id^="error-"]')
		.forEach((e) => (e.textContent = ""));
	["driverName", "truckNo", "sealNo", "company", "zone", "issueBy"].forEach(
		(id) => {
			const el = document.getElementById(id);
			const errEl = document.getElementById(`error-${id}`);
			if (el && !el.value.trim()) {
				if (errEl) errEl.textContent = "Required";
				valid = false;
			}
		}
	);

	const rows = document.querySelectorAll("#supplier-table-body tr");
	let hasItem = false;
	let rowErr = false;
	const suppliers = [];
	const comp = document.getElementById("company").value.trim();
	const zone = document.getElementById("zone").value.trim();
	let firstErrRow = null;

	for (const r of rows) {
		const n = r.querySelector('input[name="name"]').value.trim();
		if (n) {
			const isRP = n === EMPTY_VEHICLE;
			const errP = r.querySelector('p[id^="error-supplier"]');
			const setRowError = (msg) => {
				if (errP) errP.textContent = msg;
				rowErr = true;
				if (!firstErrRow) firstErrRow = r;
			};
			let rowHasQ = false;
			let badQty = false;
			const sData = { name: n, company: comp, zone: zone };
			QTY_FIELDS.forEach((f) => {
				const v = isRP
					? 0
					: parseQty(r.querySelector(`input[name="${f}"]`).value);
				if (Number.isNaN(v)) badQty = true;
				sData[f] = Number.isNaN(v) ? 0 : v;
				if (v > 0) rowHasQ = true;
			});

			if (
				!isRP &&
				masterData.length > 0 &&
				!isValidSupplier(comp.toUpperCase(), zone.toUpperCase(), n)
			) {
				setRowError("Supplier ไม่ถูกต้องสำหรับ Company/Zone นี้");
				continue;
			}
			if (badQty) {
				setRowError("จำนวนต้องเป็นจำนวนเต็มตั้งแต่ 0 ขึ้นไป");
				continue;
			}
			if (!isRP && !rowHasQ) {
				setRowError("ระบุจำนวนหรือลบแถว");
			}
			if (isRP || rowHasQ) {
				suppliers.push(sData);
				hasItem = true;
			}
		}
	}

	if (!valid || rowErr || !hasItem) {
		if (!valid) showModal("กรุณากรอกข้อมูลส่วนหัวให้ครบ (ช่องที่มีข้อความ Required)");
		else if (rowErr) {
			showModal("กรุณาแก้ไขข้อผิดพลาดในตาราง Supplier ก่อนบันทึก");
			firstErrRow?.scrollIntoView({ behavior: "smooth", block: "center" });
		} else showModal("ใส่ Supplier อย่างน้อย 1 รายการ");
		isSaving = false;
		btn.disabled = false;
		btn.textContent = orgTxt;
		return;
	}

	const formData = {
		driverName: document.getElementById("driverName").value.trim(),
		truckNo: document.getElementById("truckNo").value.trim(),
		sealNo: document.getElementById("sealNo").value.trim(),
		company: comp,
		zone: zone,
		issueBy: document.getElementById("issueBy").value.trim(),
		suppliers: suppliers,
	};

	const docId = document.getElementById("docId").value;

	try {
		if (docId) {
			const docRef = doc(
				db,
				`artifacts/${appId}/public/data/gatepasses`,
				docId
			);
			await updateDoc(docRef, {
				...formData,
				lastUpdated: serverTimestamp(),
			});
			showModal("Updated successfully!", "Success", true);
			const snap = await getDoc(docRef);
			populateSummary(snap.data());
		} else {
			// Local date (Thailand), not UTC — otherwise gatepasses issued
			// between 00:00 and 07:00 get yesterday's number sequence.
			const todayStr = toLocalDateKey(new Date());
			const prefix = siteConfig?.gatepassPrefix || "LDC";
			const counterRef = doc(
				db,
				`artifacts/${appId}/public/data/counters`,
				todayStr
			);

			const result = await runTransaction(db, async (txn) => {
				const cDoc = await txn.get(counterRef);
				const count = (cDoc.data()?.count || 0) + 1;
				const gpNo = `${todayStr}-${prefix}-${String(count).padStart(3, "0")}`;
				const newRef = doc(
					collection(db, `artifacts/${appId}/public/data/gatepasses`)
				);

				const data = {
					...formData,
					gatepassNo: gpNo,
					datePrefix: todayStr,
					issueDate: serverTimestamp(),
					createdBy: auth.currentUser?.uid || "anon",
					status: "Empty-Out",
				};

				txn.set(newRef, data);
				txn.set(counterRef, { count }, { merge: true });
				return { ...data, issueDate: new Date() };
			});
			populateSummary(result);
		}

		document.getElementById("form-page").classList.add("hidden");
		document.getElementById("summary-page").classList.remove("hidden");
	} catch (e) {
		console.error(e);
		showModal("Error saving: " + e.message);
		btn.disabled = false;
		btn.textContent = orgTxt;
	} finally {
		isSaving = false;
	}
};

const populateSummary = (data) => {
	const d = document.getElementById.bind(document);
	if (!d("summary-gatepassId")) return;

	const issueDate = data.issueDate?.toDate
		? data.issueDate.toDate()
		: data.issueDate || new Date();
	const dateStr = formatDateEN(issueDate);

	d("summary-gatepassId").textContent = data.gatepassNo;
	d("summary-issueDate").textContent = dateStr;
	d("summary-driverName").textContent = data.driverName;
	d("summary-truckNo").textContent = data.truckNo;
	d("summary-sealNo").textContent = data.sealNo;
	d("summary-company").textContent = data.company;
	d("summary-zone").textContent = data.zone;
	d("summary-issueBy").textContent = data.issueBy;

	d("print-date").textContent = dateStr.split(" ")[0];
	d("print-gatepassId").textContent = data.gatepassNo;
	d("print-driverName").textContent = data.driverName;
	d("print-truckNo").textContent = data.truckNo;
	d("print-company").textContent = data.company;
	d("print-zone").textContent = data.zone;
	d("print-sealNo").textContent = data.sealNo;
	d("print-issue-datetime").textContent = dateStr;
	d("print-worker-name").textContent = data.issueBy;
	d("print-driver-signature").textContent = data.driverName;
	d("print-driver-company").textContent = data.company;

	const fillTbl = (tbodyId, isPrint) => {
		const tb = d(tbodyId);
		if (!tb) return;
		tb.innerHTML = "";
		let gTot = { ptb: 0, cpb: 0, mov: 0, stp: 0, pl: 0, rp: 0, grand: 0 };
		const suppliers = data.suppliers || [];
		const rows = isPrint
			? Math.max(MIN_TABLE_ROWS, suppliers.length)
			: suppliers.length;

		for (let i = 0; i < rows; i++) {
			const s = suppliers[i];
			const r = document.createElement("tr");
			if (s) {
				const tot = sumQty(s);
				QTY_FIELDS.forEach((k) => (gTot[k] += Number(s[k]) || 0));
				gTot.grand += tot;
				const isRP = s.name === EMPTY_VEHICLE;
				const name = escapeHtml(s.name);

				if (isPrint) {
					// Print Version (Existing structure)
					r.innerHTML = `<td class="supplier-name">${name}</td>
                       <td>${s.ptb > 0 || isRP ? s.ptb || 0 : ""}</td><td>${
						s.cpb > 0 || isRP ? s.cpb || 0 : ""
					}</td><td>${s.mov > 0 || isRP ? s.mov || 0 : ""}</td>
                       <td>${s.stp > 0 || isRP ? s.stp || 0 : ""}</td><td>${
						s.pl > 0 || isRP ? s.pl || 0 : ""
					}</td><td>${s.rp > 0 || isRP ? s.rp || 0 : ""}</td>
                       <td>${tot > 0 || isRP ? tot : ""}</td>`;
				} else {
					// Web View (Add Total Column)
					r.innerHTML = `<td class="py-3 px-4">${name}</td>
                       <td class="py-3 px-4">${
													s.ptb || 0
												}</td><td class="py-3 px-4">${
						s.cpb || 0
					}</td><td class="py-3 px-4">${s.mov || 0}</td>
                       <td class="py-3 px-4">${
													s.stp || 0
												}</td><td class="py-3 px-4">${
						s.pl || 0
					}</td><td class="py-3 px-4">${s.rp || 0}</td>
                       <td class="py-3 px-4 font-semibold text-indigo-700">${tot}</td>`;
				}
			} else if (isPrint) {
				r.innerHTML = `<td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td>`;
			}
			if (isPrint || s) tb.appendChild(r);
		}

		if (isPrint) {
			const footer = d("print-supplier-table-footer");
			if (footer) {
				footer.innerHTML = `<tr><td class="font-bold text-right">TOTAL</td><td class="font-bold">${gTot.ptb}</td><td class="font-bold">${gTot.cpb}</td><td class="font-bold">${gTot.mov}</td><td class="font-bold">${gTot.stp}</td><td class="font-bold">${gTot.pl}</td><td class="font-bold">${gTot.rp}</td><td class="font-bold">${gTot.grand}</td></tr>`;
			}
		} else {
			Object.keys(gTot).forEach((k) => {
				const e = d(
					k === "grand" ? "summary-grand-total" : `summary-total-${k}`
				);
				if (e) e.textContent = gTot[k];
			});
			// Also update summary total column sum (matches grand total)
			const sumRowTotalEl = d("summary-total-row-sum");
			if (sumRowTotalEl) sumRowTotalEl.textContent = gTot.grand;
		}
	};

	fillTbl("summary-supplier-table-body", false);
	fillTbl("print-supplier-table-body", true);
};

// --- Main ---
document.addEventListener("DOMContentLoaded", () => {
	populateSupplierTable();

	// ✅ บล็อก Enter บน Back to Menu (แต่ Click ยังกลับได้ตาม href)
	const blockEnterOnLink = (id) => {
		const el = document.getElementById(id);
		if (!el) return;
		el.addEventListener("keydown", (e) => {
			if (e.key === "Enter") {
				e.preventDefault();
				e.stopPropagation();
			}
		});
	};
	blockEnterOnLink("back-to-menu-form");
	blockEnterOnLink("back-to-menu-summary");

	// ✅ Enter Key = Next focus (รวม <a href> และปุ่มต่าง ๆ)
	document.addEventListener("keydown", (e) => {
		if (e.key !== "Enter") return;

		const target = e.target;
		const tag = target?.tagName;

		// ถ้าโฟกัสอยู่บนลิงก์ Back อยู่แล้ว เราบล็อกไปข้างบนแล้ว
		// ตรงนี้จัดการเฉพาะตอนโฟกัสอยู่ใน input/select/textarea
		if (
			(tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") &&
			target.type !== "submit"
		) {
			e.preventDefault();

			const form = document.getElementById("gatepass-form");
			if (!form) return;

			// ✅ รวมลิงก์ + ปุ่มเข้าไปในลำดับ
			const focusableSelector = [
				'input:not([type="hidden"]):not([disabled])',
				"select:not([disabled])",
				"textarea:not([disabled])",
				"button:not([disabled])",
				"a[href]:not([disabled])",
			].join(",");

			const focusable = Array.from(
				form.querySelectorAll(focusableSelector)
			).filter((el) => el.offsetParent !== null); // กัน element ที่ถูกซ่อน

			const index = focusable.indexOf(target);
			if (index > -1 && index < focusable.length - 1) {
				const next = focusable[index + 1];
				next.focus();

				if (
					next.tagName === "INPUT" &&
					next.type !== "checkbox" &&
					next.type !== "radio"
				) {
					next.select();
				}
			}
		}
	});

	const formEl = document.getElementById("gatepass-form");
	if (formEl) formEl.addEventListener("submit", handleSubmit);

	["company", "zone"].forEach((id) => {
		const el = document.getElementById(id);
		if (!el) return;
		el.addEventListener("input", () => handleCompanyChange(false));
		el.addEventListener("change", () => handleCompanyChange(true));
	});

	const closeBtn = document.getElementById("modal-close-btn");
	if (closeBtn) closeBtn.addEventListener("click", hideModal);

	const supplierTableBody = document.getElementById("supplier-table-body");
	if (supplierTableBody) {
		supplierTableBody.addEventListener(
			"blur",
			(e) => {
				if (e.target.name === "name") validateRow(e.target);
			},
			true
		);
		supplierTableBody.addEventListener("input", (e) => {
			if (e.target.type === "number") {
				updateTotalsDisplay();
				// Check valid number logic for enabling next row
				if (e.target.name !== "row-total") {
					enableNextRow(e.target.dataset.index);
				}
			}
		});
	}

	const printBtn = document.getElementById("print-btn");
	if (printBtn) {
		printBtn.addEventListener("click", () => {
			const printContainer = document.getElementById("print-version");
			const printMsg = document.getElementById("print-message");

			const originalContent = printContainer.innerHTML;
			const pageWrapper = document.createElement("div");
			pageWrapper.innerHTML = originalContent;
			printContainer.innerHTML = "";

			for (let i = 0; i < 4; i++) {
				const newPage = pageWrapper.cloneNode(true);
				if (i < 3) newPage.style.pageBreakAfter = "always";
				printContainer.appendChild(newPage);
			}

			printMsg.classList.remove("hidden");
			setTimeout(() => {
				window.print();
				setTimeout(() => {
					printContainer.innerHTML = originalContent;
					printMsg.classList.add("hidden");
				}, 500);
			}, 100);
		});
	}

	document.body.addEventListener("input", (e) => {
		if (e.target.classList.contains("uppercase-input")) {
			const start = e.target.selectionStart;
			e.target.value = e.target.value.toUpperCase();
			e.target.setSelectionRange(start, start);
		}
	});

	// 2. ตรวจสอบ DB ก่อนดึงข้อมูล
	if (!db) {
		console.error("Firebase DB not initialized");
		return;
	}

	onAuthStateChanged(auth, async (u) => {
		if (!u) {
			if (typeof __initial_auth_token !== "undefined")
				await signInWithCustomToken(auth, __initial_auth_token);
			else await signInAnonymously(auth);
		} else {
			fetchMasterData();
			const editId = sessionStorage.getItem("editGatepassId");
			if (editId) {
				sessionStorage.removeItem("editGatepassId");
				await loadGatepassForEditing(editId);
			}
		}
	});
});
