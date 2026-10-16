// Import necessary functions from Firebase SDK
import {
	signInAnonymously,
	onAuthStateChanged,
	signInWithCustomToken,
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import {
	doc,
	addDoc,
	getDoc,
	updateDoc,
	collection,
	getDocs,
	query,
	serverTimestamp,
	setLogLevel,
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// --- IMPORT FROM CENTRAL CONFIG ---
import { auth, db, appId } from "./firebase-config.js";

// --- MAPPING VARIABLES ---
// Map imported variables to local names to maintain compatibility with existing logic
const gatepassIN_auth = auth;
const gatepassIN_db = db;
const gatepassIN_appId = appId;

// --- GLOBAL VARIABLES ---
let gatepassIN_masterData = [];
let gatepassIN_masterDataCache = { companies: new Set(), issueBys: new Set() };
let gatepassIN_isSaving = false;

// --- DOM ELEMENT REFERENCES ---
const DOMElements = {
	modal: document.getElementById("gatepassIN_alertModal"),
	modalMessage: document.getElementById("gatepassIN_modalMessage"),
	modalTitle: document.getElementById("gatepassIN_modalTitle"),
	modalIconContainer: document.getElementById("gatepassIN_modalIconContainer"),
	modalCloseBtn: document.getElementById("gatepassIN_modalCloseBtn"),
	formPage: document.getElementById("gatepassIN_page"),
	summaryPage: document.getElementById("gatepassIN_summaryPage"),
	form: document.getElementById("gatepassIN_form"),
	supplierTableBody: document.getElementById("gatepassIN_supplierTableBody"),
	backToMenuBtn: document.getElementById("gatepassIN_backToMenuBtn"),
	summaryBackToMenuBtn: document.getElementById(
		"gatepassIN_summaryBackToMenuBtn"
	),
	printBtn: document.getElementById("gatepassIN_printBtn"),
	backToFormBtn: document.getElementById("gatepassIN_backToFormBtn"),
	issueDateTimeInput: document.getElementById("gatepassIN_issueDateTime"),
};

// --- UTILITY FUNCTIONS ---

const showGatepassINModal = (message, title = "Error!", isSuccess = false) => {
	DOMElements.modalMessage.textContent = message;
	DOMElements.modalTitle.textContent = title;

	DOMElements.modalIconContainer.innerHTML = isSuccess
		? `<svg class="h-6 w-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>`
		: `<svg class="h-6 w-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>`;

	DOMElements.modalIconContainer.className = `mx-auto flex items-center justify-center h-12 w-12 rounded-full ${
		isSuccess ? "bg-green-100" : "bg-red-100"
	}`;
	DOMElements.modalCloseBtn.className = `px-4 py-2 text-white text-base font-medium rounded-md w-full shadow-sm focus:outline-none focus:ring-2 ${
		isSuccess
			? "bg-green-500 hover:bg-green-700 focus:ring-green-500"
			: "bg-red-500 hover:bg-red-700 focus:ring-red-500"
	}`;
	DOMElements.modalCloseBtn.textContent = "OK";

	DOMElements.modal.classList.remove("hidden");
};

const hideGatepassINModal = () => DOMElements.modal.classList.add("hidden");

// --- INLINE ERROR FUNCTIONS ---
const showGatepassINInlineError = (row, message) => {
	if (!row) return;
	const supplierCell = row
		.querySelector(".gatepassIN_supplierInput")
		?.closest("td");
	if (!supplierCell) return;

	const errorSpan = supplierCell.querySelector(".gatepassIN_inlineError");
	if (errorSpan) {
		errorSpan.textContent = message;
		errorSpan.classList.remove("hidden");
	}
};

const hideGatepassINInlineError = (row) => {
	if (!row) return;
	const supplierCell = row
		.querySelector(".gatepassIN_supplierInput")
		?.closest("td");
	if (!supplierCell) return;

	const errorSpan = supplierCell.querySelector(".gatepassIN_inlineError");
	if (errorSpan) {
		errorSpan.textContent = "";
		errorSpan.classList.add("hidden");
	}
};

const printGatepassIN = () => window.print();

const setCurrentDateTimeForGatepassIN = () => {
	const now = new Date();
	const tzOffset = now.getTimezoneOffset() * 60000;
	const localISOTime = new Date(now - tzOffset).toISOString().slice(0, 16);
	if (DOMElements.issueDateTimeInput) {
		DOMElements.issueDateTimeInput.value = localISOTime;
		DOMElements.issueDateTimeInput.max = localISOTime;
	}
};

const formatGatepassINDateEN = (date) => {
	if (!(date instanceof Date)) return "";
	const dd = String(date.getDate()).padStart(2, "0");
	const mm = String(date.getMonth() + 1).padStart(2, "0");
	const yyyy = date.getFullYear();
	const hh = String(date.getHours()).padStart(2, "0");
	const min = String(date.getMinutes()).padStart(2, "0");
	const ss = String(date.getSeconds()).padStart(2, "0");
	return `${dd}/${mm}/${yyyy} ${hh}:${min}:${ss}`;
};

// --- FIREBASE & DATA FUNCTIONS ---

const fetchMasterDataForGatepassIN = async () => {
	if (!gatepassIN_db) return;
	try {
		const masterCollectionRef = collection(
			gatepassIN_db,
			`artifacts/${gatepassIN_appId}/public/data/master_data`
		);
		const q = query(masterCollectionRef);
		const querySnapshot = await getDocs(q);
		gatepassIN_masterData = querySnapshot.docs.map((doc) => doc.data());
		gatepassIN_masterData.sort((a, b) => (a.order || 0) - (b.order || 0));
	} catch (error) {
		console.error("Error fetching master data:", error);
		showGatepassINModal(
			"Failed to load master data. Please check your connection and refresh."
		);
	}
};

// --- UI POPULATION & HANDLING ---

const populateDatalistsForGatepassIN = () => {
	gatepassIN_masterDataCache.companies.clear();
	gatepassIN_masterDataCache.issueBys.clear();
	gatepassIN_masterData.forEach((data) => {
		if (data.company) gatepassIN_masterDataCache.companies.add(data.company);
		if (data.issueBy) gatepassIN_masterDataCache.issueBys.add(data.issueBy);
	});

	const issueByList = document.getElementById("gatepassIN_issueByList");
	issueByList.innerHTML = "";
	[...gatepassIN_masterDataCache.issueBys].sort().forEach((item) => {
		const option = document.createElement("option");
		option.value = item;
		issueByList.appendChild(option);
	});

	document.querySelectorAll(".gatepassIN_companyInput").forEach((input) => {
		const datalistId = input.getAttribute("list");
		const datalist = document.getElementById(datalistId);
		if (datalist) {
			datalist.innerHTML = "";
			[...gatepassIN_masterDataCache.companies].sort().forEach((item) => {
				const option = document.createElement("option");
				option.value = item;
				datalist.appendChild(option);
			});
		}
	});
};

const populateSupplierTableForGatepassIN = () => {
	DOMElements.supplierTableBody.innerHTML = "";
	const fragment = document.createDocumentFragment();
	for (let i = 0; i < 30; i++) {
		const newRow = document.createElement("tr");
		newRow.className = "border-b border-gray-200";
		newRow.innerHTML = `
            <td class="py-2 px-2">${i + 1}.</td>
            <td class="py-2 px-2">
                <input type="text" list="gatepassIN_companyList-${i}" data-index="${i}" class="gatepassIN_companyInput uppercase-input w-full p-1 border rounded" ${
			i > 0 ? "disabled" : ""
		}>
                <datalist id="gatepassIN_companyList-${i}"></datalist>
            </td>
            <td class="py-2 px-2">
                <input type="text" data-index="${i}" class="gatepassIN_zone2Input w-full p-1 border rounded" disabled>
            </td>
            <td class="py-2 px-2">
                <input type="text" list="gatepassIN_supplierList-${i}" data-index="${i}" class="gatepassIN_supplierInput uppercase-input w-full p-1 border rounded" disabled>
                <datalist id="gatepassIN_supplierList-${i}"></datalist>
                <span class="gatepassIN_inlineError text-red-500 text-xs hidden"></span>
            </td>
            ${["ptb", "cpb", "mov", "stp", "pl", "rp"]
							.map(
								(field) => `
                <td class="py-2 px-2">
                    <input type="number" data-field="${field}" data-index="${i}" class="gatepassIN_quantityInput w-full p-1 border rounded text-center" min="0" disabled>
                </td>
            `
							)
							.join("")}
            <td class="py-2 px-2">
                <input type="text" class="gatepassIN_rowTotalInput w-full p-1 border rounded text-center bg-gray-50 text-gray-700 font-bold" value="" disabled>
            </td>
        `;
		fragment.appendChild(newRow);
	}
	DOMElements.supplierTableBody.appendChild(fragment);
};

const populateSupplierTableForGatepassIN_withData = (suppliers = []) => {
	DOMElements.supplierTableBody.innerHTML = "";
	const fragment = document.createDocumentFragment();
	// Keep every supplier that was saved, even past the first 30 rows,
	// so editing an existing gatepass can never drop the extra lines.
	const rowsToGenerate = Math.max(30, suppliers.length);

	for (let i = 0; i < rowsToGenerate; i++) {
		const s = suppliers[i];
		const hasData = !!s;
		const newRow = document.createElement("tr");
		newRow.className = "border-b border-gray-200";

		const companyDisabled = i > 0 && !hasData;
		const isRottPlao = s?.name === "รถเปล่า";
		const fieldsDisabled = !hasData || isRottPlao;

		// Calculate initial row total
		let rowTotal = 0;
		if (s) {
			rowTotal =
				(s.ptb || 0) +
				(s.cpb || 0) +
				(s.mov || 0) +
				(s.stp || 0) +
				(s.pl || 0) +
				(s.rp || 0);
		}

		newRow.innerHTML = `
            <td class="py-2 px-2">${i + 1}.</td>
            <td class="py-2 px-2">
                <input type="text" list="gatepassIN_companyList-${i}" data-index="${i}" class="gatepassIN_companyInput uppercase-input w-full p-1 border rounded" value="${
			s?.company || ""
		}" ${companyDisabled ? "disabled" : ""}>
                <datalist id="gatepassIN_companyList-${i}"></datalist>
            </td>
            <td class="py-2 px-2">
                <input type="text" data-index="${i}" class="gatepassIN_zone2Input w-full p-1 border rounded" value="${
			s?.zone || ""
		}" disabled>
            </td>
            <td class="py-2 px-2">
                <input type="text" list="gatepassIN_supplierList-${i}" data-index="${i}" class="gatepassIN_supplierInput uppercase-input w-full p-1 border rounded" value="${
			s?.name || ""
		}" ${!hasData ? "disabled" : ""}>
                <datalist id="gatepassIN_supplierList-${i}"></datalist>
                <span class="gatepassIN_inlineError text-red-500 text-xs hidden"></span>
            </td>
            ${["ptb", "cpb", "mov", "stp", "pl", "rp"]
							.map(
								(field) => `
                <td class="py-2 px-2">
                    <input type="number" data-field="${field}" data-index="${i}" class="gatepassIN_quantityInput w-full p-1 border rounded text-center" value="${
									s?.[field] !== undefined ? s[field] : ""
								}" min="0" ${fieldsDisabled ? "disabled" : ""}>
                </td>
            `
							)
							.join("")}
            <td class="py-2 px-2">
                <input type="text" class="gatepassIN_rowTotalInput w-full p-1 border rounded text-center bg-gray-50 text-gray-700 font-bold" value="${
									rowTotal > 0 ? rowTotal : ""
								}" disabled>
            </td>
        `;
		fragment.appendChild(newRow);
	}
	DOMElements.supplierTableBody.appendChild(fragment);
	populateDatalistsForGatepassIN();
	updateGatepassINTotals();
};

const updateGatepassINTotals = () => {
	const totals = { ptb: 0, cpb: 0, mov: 0, stp: 0, pl: 0, rp: 0 };
	let grandTotal = 0;

	// Iterate through each row to calculate row total and accumulate column totals
	const rows = DOMElements.supplierTableBody.querySelectorAll("tr");

	rows.forEach((row) => {
		let rowSum = 0;
		const quantityInputs = row.querySelectorAll(".gatepassIN_quantityInput");

		quantityInputs.forEach((input) => {
			const value = parseInt(input.value, 10) || 0;
			const field = input.dataset.field;

			// Accumulate column totals
			if (field in totals) {
				totals[field] += value;
			}

			// Accumulate row total
			rowSum += value;
		});

		// Update the row total input field
		const rowTotalInput = row.querySelector(".gatepassIN_rowTotalInput");
		if (rowTotalInput) {
			rowTotalInput.value = rowSum > 0 ? rowSum : "";
		}

		grandTotal += rowSum;
	});

	// Update Column Footers
	for (const key in totals) {
		const totalEl = document.getElementById(`gatepassIN_total_${key}`);
		if (totalEl) {
			totalEl.textContent = totals[key].toLocaleString();
		}
	}

	// Update Footer: Row Sum Total (should equal Grand Total)
	const rowTotalSumEl = document.getElementById("gatepassIN_total_row_sum");
	if (rowTotalSumEl) {
		rowTotalSumEl.textContent = grandTotal.toLocaleString();
	}

	// Update Footer: Grand Total
	const grandTotalEl = document.getElementById("gatepassIN_grand_total");
	if (grandTotalEl) {
		grandTotalEl.textContent = grandTotal.toLocaleString();
	}
};

const handleRowInputForGatepassIN = (e) => {
	const target = e.target;
	const index = parseInt(target.dataset.index, 10);
	const currentRow = target.closest("tr");

	if (target.classList.contains("gatepassIN_companyInput")) {
		hideGatepassINInlineError(currentRow);
		const companyValue = target.value.trim().toUpperCase();
		const supplierInput = currentRow.querySelector(".gatepassIN_supplierInput");
		const supplierDatalist = document.getElementById(
			`gatepassIN_supplierList-${index}`
		);
		const zone2Input = currentRow.querySelector(".gatepassIN_zone2Input");
		const rowTotalInput = currentRow.querySelector(".gatepassIN_rowTotalInput");

		supplierInput.value = "";
		supplierDatalist.innerHTML = "";
		zone2Input.value = "";
		supplierInput.disabled = true;
		currentRow
			.querySelectorAll(".gatepassIN_quantityInput")
			.forEach((input) => {
				input.value = "";
				input.disabled = true;
			});
		if (rowTotalInput) rowTotalInput.value = "";

		if (companyValue) {
			const companyEntries = gatepassIN_masterData.filter(
				(d) => d.company?.trim().toUpperCase() === companyValue
			);
			const uniqueZone2s = [
				...new Set(companyEntries.map((d) => d.zone2).filter(Boolean)),
			];
			const validSuppliers = new Set(
				companyEntries.map((d) => d.supplier).filter(Boolean)
			);

			zone2Input.value = uniqueZone2s.join(", ") || "N/A";

			[...validSuppliers].sort().forEach((item) => {
				const option = document.createElement("option");
				option.value = item;
				supplierDatalist.appendChild(option);
			});

			if (validSuppliers.size > 0) {
				supplierInput.disabled = false;
			}
		}
		updateGatepassINTotals();
	}

	if (target.classList.contains("gatepassIN_supplierInput")) {
		hideGatepassINInlineError(currentRow);
		const supplierValue = target.value.trim();
		const quantityInputs = currentRow.querySelectorAll(
			".gatepassIN_quantityInput"
		);
		const rowTotalInput = currentRow.querySelector(".gatepassIN_rowTotalInput");

		const isEmptyVehicle = supplierValue === "รถเปล่า";

		if (isEmptyVehicle) {
			quantityInputs.forEach((input) => {
				input.value = "0";
				input.disabled = true;
			});
			if (rowTotalInput) rowTotalInput.value = "0";
			updateGatepassINTotals();

			const allRows = DOMElements.supplierTableBody.querySelectorAll("tr");
			const nextRow = allRows[index + 1];
			if (nextRow) {
				nextRow.querySelector(".gatepassIN_companyInput").disabled = false;
			}
		} else {
			const isDisabled = !supplierValue;
			quantityInputs.forEach((input) => {
				input.disabled = isDisabled;
			});
			if (isDisabled) {
				quantityInputs.forEach((input) => (input.value = ""));
				if (rowTotalInput) rowTotalInput.value = "";
				updateGatepassINTotals();
			}
		}
	}

	if (target.classList.contains("gatepassIN_quantityInput")) {
		hideGatepassINInlineError(currentRow);
		updateGatepassINTotals();
		const allRows = DOMElements.supplierTableBody.querySelectorAll("tr");
		const nextRow = allRows[index + 1];
		if (nextRow) {
			const hasQuantity = Array.from(
				currentRow.querySelectorAll(".gatepassIN_quantityInput")
			).some((q) => (parseInt(q.value) || 0) > 0);

			if (hasQuantity) {
				nextRow.querySelector(".gatepassIN_companyInput").disabled = false;
			}
		}
	}
};

const populateGatepassINSummary = (data) => {
	document.getElementById("gatepassIN_summaryGatepassNo").textContent =
		data.gatepassNo;
	document.getElementById("gatepassIN_summaryIssueDate").textContent =
		formatGatepassINDateEN(data.issueDate);
	document.getElementById("gatepassIN_summaryDriverName").textContent =
		data.driverName;
	document.getElementById("gatepassIN_summaryTruckNo").textContent =
		data.truckNo;
	document.getElementById("gatepassIN_summaryBookNo").textContent = data.bookNo;
	document.getElementById("gatepassIN_summaryIssueBy").textContent =
		data.issueBy;

	const summaryTableBody = document.getElementById(
		"gatepassIN_summarySupplierTableBody"
	);
	summaryTableBody.innerHTML = "";
	data.suppliers.forEach((s) => {
		// Calculate row total for summary
		const rowTotal =
			(s.ptb || 0) +
			(s.cpb || 0) +
			(s.mov || 0) +
			(s.stp || 0) +
			(s.pl || 0) +
			(s.rp || 0);

		const row = summaryTableBody.insertRow();
		row.className = "border-b border-gray-200";
		row.innerHTML = `
            <td class="py-3 px-4 text-left">${s.company}</td>
            <td class="py-3 px-4 text-left">${s.zone2 || ""}</td>
            <td class="py-3 px-4 text-left">${s.name}</td>
            <td class="py-3 px-4 text-center">${s.ptb || 0}</td>
            <td class="py-3 px-4 text-center">${s.cpb || 0}</td>
            <td class="py-3 px-4 text-center">${s.mov || 0}</td>
            <td class="py-3 px-4 text-center">${s.stp || 0}</td>
            <td class="py-3 px-4 text-center">${s.pl || 0}</td>
            <td class="py-3 px-4 text-center">${s.rp || 0}</td>
            <td class="py-3 px-4 text-center font-bold">${
							rowTotal > 0 ? rowTotal : 0
						}</td>
        `;
	});

	const printDate = data.issueDate;
	const formattedDateTime = formatGatepassINDateEN(printDate);
	const formattedDate = formattedDateTime.split(" ")[0];
	document.getElementById("gatepassIN_printDate").textContent = formattedDate;
	document.getElementById("gatepassIN_printGatepassNo").textContent =
		data.gatepassNo;
	document.getElementById("gatepassIN_printDriverName").textContent =
		data.driverName;
	document.getElementById("gatepassIN_printTruckNo").textContent = data.truckNo;
	document.getElementById("gatepassIN_printBookNo").textContent = data.bookNo;
	document.getElementById("gatepassIN_printIssueDatetime").textContent =
		formattedDateTime;

	const printTableBody = document.getElementById(
		"gatepassIN_printSupplierTableBody"
	);
	const printTableFooter = document.getElementById(
		"gatepassIN_printSupplierTableFooter"
	);
	printTableBody.innerHTML = "";
	let printTotals = { ptb: 0, cpb: 0, mov: 0, stp: 0, pl: 0, rp: 0, grand: 0 };

	data.suppliers.forEach((s) => {
		const row = printTableBody.insertRow();
		const total =
			(s.ptb || 0) +
			(s.cpb || 0) +
			(s.mov || 0) +
			(s.stp || 0) +
			(s.pl || 0) +
			(s.rp || 0);
		Object.keys(printTotals).forEach((key) => {
			if (key !== "grand") printTotals[key] += s[key] || 0;
		});
		printTotals.grand += total;

		const isRottPlao = s.name === "รถเปล่า";
		row.innerHTML = `
            <td>${s.company}</td>
            <td>${s.zone2 || ""}</td>
            <td>${s.name}</td>
            <td>${s.ptb > 0 || isRottPlao ? s.ptb || 0 : ""}</td>
            <td>${s.cpb > 0 || isRottPlao ? s.cpb || 0 : ""}</td>
            <td>${s.mov > 0 || isRottPlao ? s.mov || 0 : ""}</td>
            <td>${s.stp > 0 || isRottPlao ? s.stp || 0 : ""}</td>
            <td>${s.pl > 0 || isRottPlao ? s.pl || 0 : ""}</td>
            <td>${s.rp > 0 || isRottPlao ? s.rp || 0 : ""}</td>
            <td>${total > 0 || isRottPlao ? total : ""}</td>
        `;
	});

	printTableFooter.innerHTML = `
        <tr>
            <td colspan="3" class="font-bold text-right">TOTAL (รวม)</td>
            <td class="font-bold">${printTotals.ptb}</td>
            <td class="font-bold">${printTotals.cpb}</td>
            <td class="font-bold">${printTotals.mov}</td>
            <td class="font-bold">${printTotals.stp}</td>
            <td class="font-bold">${printTotals.pl}</td>
            <td class="font-bold">${printTotals.rp}</td>
            <td class="font-bold">${printTotals.grand}</td>
        </tr>
    `;
};

const resetGatepassINForm = async () => {
	DOMElements.form.reset();

	const docIdInput = DOMElements.form.querySelector('input[name="docId"]');
	if (docIdInput) docIdInput.remove();

	const submitBtn = DOMElements.form.querySelector('button[type="submit"]');
	if (submitBtn) {
		submitBtn.textContent = "Save Gatepass In";
		submitBtn.disabled = false;
	}

	gatepassIN_isSaving = false;

	populateSupplierTableForGatepassIN();
	await fetchMasterDataForGatepassIN();
	populateDatalistsForGatepassIN();
	setCurrentDateTimeForGatepassIN();
	DOMElements.summaryPage.classList.add("hidden");
	DOMElements.formPage.classList.remove("hidden");
	updateGatepassINTotals();
};

// --- ADDED: Load Gatepass For Editing ---
const loadGatepassForEditing = async (docId) => {
	try {
		const docRef = doc(
			gatepassIN_db,
			`artifacts/${gatepassIN_appId}/public/data/gatepasses`,
			docId
		);
		const docSnap = await getDoc(docRef);

		if (docSnap.exists()) {
			const data = docSnap.data();

			// Populate Text Inputs
			document.getElementById("gatepassIN_driverName").value =
				data.driverName || "";
			document.getElementById("gatepassIN_truckNo").value = data.truckNo || "";
			document.getElementById("gatepassIN_bookNo").value = data.sealNo || ""; // Note: sealNo maps to bookNo in this context
			document.getElementById("gatepassIN_gatepassNo").value =
				data.gatepassNo || "";
			document.getElementById("gatepassIN_issueBy").value = data.issueBy || "";

			// Date Time
			if (data.issueDate) {
				const date = data.issueDate.toDate(); // Firestore timestamp
				const tzOffset = date.getTimezoneOffset() * 60000;
				const localISOTime = new Date(date - tzOffset)
					.toISOString()
					.slice(0, 16);
				DOMElements.issueDateTimeInput.value = localISOTime;
			}

			// Populate Table
			await fetchMasterDataForGatepassIN();
			populateSupplierTableForGatepassIN_withData(data.suppliers || []);

			// Set Doc ID for Update
			let docIdInput = DOMElements.form.querySelector('input[name="docId"]');
			if (!docIdInput) {
				docIdInput = document.createElement("input");
				docIdInput.type = "hidden";
				docIdInput.name = "docId";
				DOMElements.form.appendChild(docIdInput);
			}
			docIdInput.value = docId;

			// Change Submit Button Text
			const submitBtn = DOMElements.form.querySelector('button[type="submit"]');
			if (submitBtn) {
				submitBtn.textContent = "Update Gatepass In";
			}
		} else {
			showGatepassINModal("Document does not exist!");
		}
	} catch (error) {
		console.error("Error loading document:", error);
		showGatepassINModal("Error loading document for editing.");
	}
};

// --- EVENT HANDLERS ---

const handleFormSubmitForGatepassIN = async (e) => {
	e.preventDefault();

	if (gatepassIN_isSaving) {
		console.warn("Save already in progress.");
		return;
	}
	gatepassIN_isSaving = true;
	const submitBtn = DOMElements.form.querySelector('button[type="submit"]');
	if (submitBtn) submitBtn.disabled = true;

	// Validation Check
	const visibleErrors = DOMElements.supplierTableBody.querySelectorAll(
		".gatepassIN_inlineError:not(.hidden)"
	);

	if (visibleErrors.length > 0) {
		showGatepassINModal(
			"Please fix all errors before saving.\nกรุณาแก้ไขข้อผิดพลาดในตารางให้ถูกต้องก่อนบันทึก"
		);
		const firstErrorRow = visibleErrors[0].closest("tr");
		if (firstErrorRow) {
			firstErrorRow.scrollIntoView({ behavior: "smooth", block: "center" });
			firstErrorRow.querySelector(".gatepassIN_supplierInput")?.focus();
		}
		if (submitBtn) submitBtn.disabled = false;
		gatepassIN_isSaving = false;
		return;
	}

	if (!gatepassIN_db || !gatepassIN_auth.currentUser) {
		showGatepassINModal("Database connection error. Cannot save.");
		if (submitBtn) submitBtn.disabled = false;
		gatepassIN_isSaving = false;
		return;
	}

	const formData = {
		driverName: document.getElementById("gatepassIN_driverName").value.trim(),
		truckNo: document.getElementById("gatepassIN_truckNo").value.trim(),
		issueDateTime: DOMElements.issueDateTimeInput.value,
		bookNo: document.getElementById("gatepassIN_bookNo").value.trim(),
		gatepassNo: document.getElementById("gatepassIN_gatepassNo").value.trim(),
		issueBy: document.getElementById("gatepassIN_issueBy").value.trim(),
	};

	for (const [key, value] of Object.entries(formData)) {
		if (!value) {
			showGatepassINModal(
				`Please fill in the "${key.replace(/([A-Z])/g, " $1")}" field.`
			);
			if (submitBtn) submitBtn.disabled = false;
			gatepassIN_isSaving = false;
			return;
		}
	}

	if (new Date(formData.issueDateTime) > new Date()) {
		showGatepassINModal("Date & Time cannot be in the future.");
		if (submitBtn) submitBtn.disabled = false;
		gatepassIN_isSaving = false;
		return;
	}

	const suppliersToSave = [];
	const rows = DOMElements.supplierTableBody.querySelectorAll("tr");
	let validationError = false;

	for (const row of rows) {
		const companyInput = row.querySelector(".gatepassIN_companyInput");
		const supplierInput = row.querySelector(".gatepassIN_supplierInput");

		if (companyInput && supplierInput) {
			const company = companyInput.value.trim();
			const companyUpper = company.toUpperCase();
			const zone2 = row.querySelector(".gatepassIN_zone2Input").value.trim();
			const name = supplierInput.value.trim();
			const nameUpper = name.toUpperCase();

			if (company && !name) {
				const message = `กรุณาระบุ Supplier สำหรับ Company นี้`;
				showGatepassINInlineError(row, message);
				validationError = true;
				row.scrollIntoView({ behavior: "smooth", block: "center" });
				supplierInput.focus();
				break;
			}

			if (company && name) {
				const isRottPlao = name === "รถเปล่า";

				if (!isRottPlao) {
					const isValidSupplier = gatepassIN_masterData.some(
						(d) =>
							d.company?.trim().toUpperCase() === companyUpper &&
							d.supplier?.trim().toUpperCase() === nameUpper
					);

					if (!isValidSupplier) {
						const message = `Supplier ไม่ถูกต้องสำหรับ Company และ Zone นี้`;
						showGatepassINInlineError(row, message);
						validationError = true;
						row.scrollIntoView({ behavior: "smooth", block: "center" });
						supplierInput.focus();
						break;
					}
				}

				let hasQuantity = false;
				const quantities = {};

				row.querySelectorAll(".gatepassIN_quantityInput").forEach((input) => {
					const field = input.dataset.field;
					const value = parseInt(input.value, 10) || 0;
					quantities[field] = value;
					if (value > 0) {
						hasQuantity = true;
					}
				});

				if (!isRottPlao && !hasQuantity) {
					const message = `กรุณาระบุจำนวน (Quantity) หรือลบแถวนี้ออก`;
					showGatepassINInlineError(row, message);
					validationError = true;
					row.scrollIntoView({ behavior: "smooth", block: "center" });
					row.querySelector(".gatepassIN_quantityInput")?.focus();
					break;
				}

				if (isRottPlao || hasQuantity) {
					suppliersToSave.push({
						company: company,
						zone2: zone2,
						name: name,
						...quantities,
					});
				}
			}
		}
	}

	if (validationError) {
		showGatepassINModal(
			"Please complete or fix all errors before saving.\nกรุณากรอกข้อมูลให้ครบถ้วน หรือแก้ไขข้อผิดพลาดในตารางก่อนบันทึก"
		);
		if (submitBtn) submitBtn.disabled = false;
		gatepassIN_isSaving = false;
		return;
	}

	if (suppliersToSave.length === 0) {
		showGatepassINModal(
			"Please add at least one supplier with quantities, or 'รถเปล่า' (Empty Vehicle)."
		);
		if (submitBtn) submitBtn.disabled = false;
		gatepassIN_isSaving = false;
		return;
	}

	const form = document.getElementById("gatepassIN_form");
	const docIdInput = form.querySelector('input[name="docId"]');
	const docId = docIdInput ? docIdInput.value : null;

	if (docId) {
		// UPDATE
		try {
			const docRef = doc(
				gatepassIN_db,
				`artifacts/${gatepassIN_appId}/public/data/gatepasses`,
				docId
			);
			const docToUpdate = {
				driverName: formData.driverName,
				truckNo: formData.truckNo,
				issueBy: formData.issueBy,
				issueDate: new Date(formData.issueDateTime),
				sealNo: formData.bookNo,
				gatepassNo: formData.gatepassNo,
				suppliers: suppliersToSave.map((s) => ({
					company: s.company,
					zone: s.zone2,
					name: s.name,
					ptb: s.ptb || 0,
					cpb: s.cpb || 0,
					mov: s.mov || 0,
					stp: s.stp || 0,
					pl: s.pl || 0,
					rp: s.rp || 0,
				})),
				lastUpdated: serverTimestamp(),
			};

			await updateDoc(docRef, docToUpdate);
			showGatepassINModal("Gatepass updated successfully!", "Success", true);

			setTimeout(() => {
				window.location.href = "../index.html";
			}, 1500);
		} catch (error) {
			console.error("Error updating document: ", error);
			showGatepassINModal("An error occurred while updating.");
			if (submitBtn) submitBtn.disabled = false;
			gatepassIN_isSaving = false;
		} finally {
			gatepassIN_isSaving = false;
		}
	} else {
		// CREATE
		try {
			const gatepassesCollectionRef = collection(
				gatepassIN_db,
				`artifacts/${gatepassIN_appId}/public/data/gatepasses`
			);
			const docToSave = {
				createdBy: gatepassIN_auth.currentUser.uid,
				driverName: formData.driverName,
				truckNo: formData.truckNo,
				issueBy: formData.issueBy,
				issueDate: new Date(formData.issueDateTime),
				sealNo: formData.bookNo,
				gatepassNo: formData.gatepassNo,
				status: "Empty-IN",
				suppliers: suppliersToSave.map((s) => ({
					company: s.company,
					zone: s.zone2,
					name: s.name,
					ptb: s.ptb || 0,
					cpb: s.cpb || 0,
					mov: s.mov || 0,
					stp: s.stp || 0,
					pl: s.pl || 0,
					rp: s.rp || 0,
				})),
			};

			await addDoc(gatepassesCollectionRef, docToSave);

			const summaryData = {
				...formData,
				issueDate: new Date(formData.issueDateTime),
				suppliers: suppliersToSave,
			};

			populateGatepassINSummary(summaryData);
			DOMElements.formPage.classList.add("hidden");
			DOMElements.summaryPage.classList.remove("hidden");
		} catch (error) {
			console.error("Error saving document: ", error);
			showGatepassINModal("An error occurred while saving. Please try again.");
			if (submitBtn) submitBtn.disabled = false;
			gatepassIN_isSaving = false;
		} finally {
			gatepassIN_isSaving = false;
		}
	}
};

const handleSupplierBlurForGatepassIN = (e) => {
	const target = e.target;
	if (target.classList.contains("gatepassIN_supplierInput")) {
		const currentRow = target.closest("tr");
		if (!currentRow) return;

		const supplierValue = target.value.trim().toUpperCase();
		const companyInput = currentRow.querySelector(".gatepassIN_companyInput");
		const companyValue = companyInput
			? companyInput.value.trim().toUpperCase()
			: "";
		const quantityInputs = currentRow.querySelectorAll(
			".gatepassIN_quantityInput"
		);
		const rowTotalInput = currentRow.querySelector(".gatepassIN_rowTotalInput");

		if (!companyValue || !supplierValue || supplierValue === "รถเปล่า") {
			hideGatepassINInlineError(currentRow);
			return;
		}

		const isValidSupplier = gatepassIN_masterData.some(
			(d) =>
				d.company?.trim().toUpperCase() === companyValue &&
				d.supplier?.trim().toUpperCase() === supplierValue
		);

		if (!isValidSupplier) {
			const message = `Supplier ไม่ถูกต้องสำหรับ Company และ Zone นี้`;
			showGatepassINInlineError(currentRow, message);
			target.value = "";
			quantityInputs.forEach((input) => {
				input.value = "";
				input.disabled = true;
			});
			if (rowTotalInput) rowTotalInput.value = "";
			updateGatepassINTotals();
		} else {
			hideGatepassINInlineError(currentRow);
		}
	}
};

// --- INITIALIZATION ---

const initialize = async () => {
	// Check if Auth/DB are ready from config
	if (!gatepassIN_db) {
		showGatepassINModal(
			"Firebase configuration error. Check firebase-config.js"
		);
		return;
	}

	// Set Log Level if needed (optional)
	setLogLevel("Debug");

	// Set up UI and event listeners
	setCurrentDateTimeForGatepassIN();
	updateGatepassINTotals();

	DOMElements.form.addEventListener("submit", handleFormSubmitForGatepassIN);
	DOMElements.supplierTableBody.addEventListener(
		"input",
		handleRowInputForGatepassIN
	);
	DOMElements.supplierTableBody.addEventListener(
		"blur",
		handleSupplierBlurForGatepassIN,
		true
	);
	DOMElements.modalCloseBtn.addEventListener("click", hideGatepassINModal);

	const menuUrl = "../index.html";

	const navigateToMenuAndClear = () => {
		sessionStorage.removeItem("editGatepassInId");
		window.location.href = menuUrl;
	};

	DOMElements.backToMenuBtn.addEventListener("click", navigateToMenuAndClear);
	DOMElements.summaryBackToMenuBtn.addEventListener(
		"click",
		navigateToMenuAndClear
	);

	DOMElements.printBtn.addEventListener("click", printGatepassIN);
	DOMElements.backToFormBtn.addEventListener("click", resetGatepassINForm);

	document.addEventListener("keydown", (e) => {
		if (e.key === "Enter") {
			const target = e.target;
			if (target.tagName === "BUTTON") {
				const submitBtn = DOMElements.form.querySelector(
					'button[type="submit"]'
				);
				if (
					target === submitBtn ||
					target === DOMElements.backToMenuBtn ||
					target === DOMElements.summaryBackToMenuBtn
				) {
					e.preventDefault();
					return;
				}
			}
			if (target.nodeName === "INPUT") {
				if (target.type === "submit" || target.type === "button") return;
				e.preventDefault();
				const form = target.closest("form");
				if (!form) return;
				const focusable = Array.from(
					form.querySelectorAll(
						"input:not([disabled]), select:not([disabled]), button:not([disabled])"
					)
				).filter((el) => el.type !== "hidden" && el.offsetParent !== null);
				const currentIndex = focusable.indexOf(target);
				if (currentIndex > -1) {
					const nextElement = focusable[currentIndex + 1];
					if (nextElement) {
						nextElement.focus();
						if (
							nextElement.nodeName === "INPUT" &&
							(nextElement.type === "text" ||
								nextElement.type === "number" ||
								nextElement.type === "datetime-local")
						) {
							nextElement.select();
						}
					}
				}
			}
		}
	});

	// Handle Firebase authentication
	onAuthStateChanged(gatepassIN_auth, async (user) => {
		if (!user) {
			try {
				if (
					typeof __initial_auth_token !== "undefined" &&
					__initial_auth_token
				) {
					await signInWithCustomToken(gatepassIN_auth, __initial_auth_token);
				} else {
					await signInAnonymously(gatepassIN_auth);
				}
			} catch (error) {
				console.error("Authentication failed:", error);
				showGatepassINModal(`Authentication failed: ${error.message}`);
			}
		}
		if (gatepassIN_auth.currentUser) {
			const editDocId = sessionStorage.getItem("editGatepassInId");
			if (editDocId) {
				sessionStorage.removeItem("editGatepassInId");
				await loadGatepassForEditing(editDocId);
			} else {
				await fetchMasterDataForGatepassIN();
				populateSupplierTableForGatepassIN();
				populateDatalistsForGatepassIN();
				setCurrentDateTimeForGatepassIN();
			}
		}
	});
};

document.addEventListener("DOMContentLoaded", initialize);
