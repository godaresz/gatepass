import { setLogLevel } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import {
	signInAnonymously,
	onAuthStateChanged,
	signInWithCustomToken,
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import {
	doc,
	getDoc,
	setDoc,
	deleteDoc,
	collection,
	getDocs,
	writeBatch,
	query,
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// --- IMPORT จากไฟล์กลาง ---
import { auth, db, appId } from "./firebase-config.js";
import {
	escapeHtml,
	csvCell,
	parseCsvText,
	downloadTextFile,
	toLocalDateKey,
	commitInChunks,
} from "./utils.js";

const MASTER_FIELDS = [
	"milkRunCompany",
	"zone1",
	"issueBy",
	"supplier",
	"company",
	"zone2",
];

// Reads one table row into a plain object (values trimmed).
const readMasterRow = (row) => {
	const rowData = {};
	row.querySelectorAll("input[data-field]").forEach((input) => {
		rowData[input.dataset.field] = input.value.trim();
	});
	return rowData;
};

const isBlankMasterRow = (rowData) =>
	MASTER_FIELDS.every((f) => !String(rowData[f] || "").trim());

let masterData = [];
let loggedInUser = null;
const SESSION_KEY = "gatepass_user_session"; // Key สำหรับแชร์ session

// --- Sort Configuration ---
let currentSort = { field: null, direction: "asc" };

// --- Auto Logout Configuration ---
let idleTimer;
const IDLE_TIMEOUT = 5 * 60 * 1000; // 5 นาที (หน่วยเป็นมิลลิวินาที)

// --- UI Helper Functions ---
const showModal = (message, title = "Error!", isSuccess = false) => {
	document.getElementById("modal-message").textContent = message;
	document.getElementById("modal-title").textContent = title;
	const iconContainer = document.getElementById("modal-icon-container");
	const closeButton = document.getElementById("modal-close-btn");

	iconContainer.innerHTML = isSuccess
		? `<svg class="h-6 w-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>`
		: `<svg class="h-6 w-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>`;

	iconContainer.className = `mx-auto flex items-center justify-center h-12 w-12 rounded-full ${
		isSuccess ? "bg-green-100" : "bg-red-100"
	}`;
	closeButton.className = `px-4 py-2 text-white text-base font-medium rounded-md w-full shadow-sm focus:outline-none focus:ring-2 ${
		isSuccess
			? "bg-green-500 hover:bg-green-700 focus:ring-green-500"
			: "bg-red-500 hover:bg-red-700 focus:ring-red-500"
	}`;

	document.getElementById("alert-modal").classList.remove("hidden");
};

const hideModal = () =>
	document.getElementById("alert-modal").classList.add("hidden");

const showConfirmModal = (message, onConfirm) => {
	const confirmModal = document.getElementById("confirm-modal");
	document.getElementById("confirm-modal-message").textContent = message;
	const okBtn = document.getElementById("confirm-modal-ok-btn");
	const cancelBtn = document.getElementById("confirm-modal-cancel-btn");

	const newOkBtn = okBtn.cloneNode(true);
	okBtn.parentNode.replaceChild(newOkBtn, okBtn);
	const newCancelBtn = cancelBtn.cloneNode(true);
	cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);

	newOkBtn.addEventListener("click", () => {
		onConfirm();
		hideConfirmModal();
	});
	newCancelBtn.addEventListener("click", hideConfirmModal);
	confirmModal.classList.remove("hidden");
};

const hideConfirmModal = () =>
	document.getElementById("confirm-modal").classList.add("hidden");

const showProgressModal = (title) => {
	document.getElementById("progress-modal-title").textContent = title;
	updateProgress(0);
	document.getElementById("progress-modal").classList.remove("hidden");
};

const hideProgressModal = () =>
	document.getElementById("progress-modal").classList.add("hidden");

const updateProgress = (percentage) => {
	const p = Math.round(percentage);
	document.getElementById("progress-bar").style.width = `${p}%`;
	document.getElementById("progress-text").textContent = `${p}%`;
};

// --- Auto Logout Logic ---
const resetIdleTimer = () => {
	if (idleTimer) clearTimeout(idleTimer);
	// Only set timer if user is logged in
	if (loggedInUser) {
		idleTimer = setTimeout(() => {
			alert(
				"หมดเวลาการเชื่อมต่อ (ไม่มีการใช้งานเกิน 5 นาที) กรุณาเข้าสู่ระบบใหม่"
			);
			handleLogout();
		}, IDLE_TIMEOUT);
	}
};

const setupIdleListeners = () => {
	const events = ["mousemove", "keydown", "click", "scroll", "touchstart"];
	events.forEach((evt) => {
		document.addEventListener(evt, resetIdleTimer, { passive: true });
	});
};

// --- Sort Helpers ---

// ฟังก์ชันสำหรับดึงข้อมูลปัจจุบันจากตาราง (Sync ข้อมูลที่ User อาจจะพิมพ์แก้ไว้ก่อน Sort)
// ใช้ตารางบนหน้าจอเป็นหลักทั้งหมด: แถวที่เพิ่มใหม่ (ยังไม่ Save / มาจาก CSV)
// จะไม่หาย และแถวที่กดลบไปแล้วจะไม่กลับมาอีกหลัง Sort
const syncTableData = () => {
	const rows = document.querySelectorAll("#master-table-body tr");
	masterData = Array.from(rows).map((row, index) => {
		const rowData = readMasterRow(row);
		return {
			id: row.dataset.id || "",
			...rowData,
			check: ((rowData.company || "") + (rowData.supplier || "")).toUpperCase(),
			order: index,
		};
	});
};

// --- Sort Logic ---
const handleSort = (columnIndex) => {
	// 1. Sync data before sorting to save unsaved edits in memory
	syncTableData();

	// Map columnIndex to field name
	const fields = [
		"milkRunCompany",
		"zone1",
		"issueBy",
		"supplier",
		"check",
		"company",
		"zone2",
	];
	const field = fields[columnIndex];

	// Prevent sorting on 0, 1, 2 (Red Frame) and 4 (Check)
	// Only sort 3 (Supplier), 5 (Company), 6 (Zone2)
	if (!field || columnIndex < 3 || columnIndex === 4) return;

	// Toggle direction
	if (currentSort.field === field) {
		currentSort.direction = currentSort.direction === "asc" ? "desc" : "asc";
	} else {
		currentSort.field = field;
		currentSort.direction = "asc";
	}

	// Update Header Icons
	updateSortIcons(columnIndex);

	// --- NEW LOGIC: Sort ONLY the targeted columns, keep others fixed ---

	const fixedPart = masterData.map((item) => ({
		id: item.id,
		milkRunCompany: item.milkRunCompany,
		zone1: item.zone1,
		issueBy: item.issueBy,
		order: item.order,
	}));

	const sortablePart = masterData.map((item) => ({
		supplier: item.supplier,
		company: item.company,
		zone2: item.zone2,
	}));

	// 2. Sort the Sortable Part array
	sortablePart.sort((a, b) => {
		const valA = (a[field] || "").toString().toLowerCase();
		const valB = (b[field] || "").toString().toLowerCase();

		if (valA < valB) return currentSort.direction === "asc" ? -1 : 1;
		if (valA > valB) return currentSort.direction === "asc" ? 1 : -1;
		return 0;
	});

	// 3. Merge back together
	masterData = fixedPart.map((fixed, index) => {
		const sorted = sortablePart[index];
		const newCheck = (
			(sorted.company || "") + (sorted.supplier || "")
		).toUpperCase();
		return {
			...fixed,
			...sorted,
			check: newCheck,
		};
	});

	// Render Table
	renderMasterTable();
};

const updateSortIcons = (activeIndex) => {
	const headers = document.querySelectorAll(
		"#master-table-container thead tr:first-child th"
	);
	headers.forEach((th, index) => {
		const existingIcon = th.querySelector(".sort-icon");
		if (existingIcon) existingIcon.remove();

		if (index > 2 && index < 7 && index !== 4) {
			const icon = document.createElement("span");
			icon.className = "ml-2 inline-block sort-icon text-xs font-bold";
			if (index === activeIndex) {
				icon.innerHTML = currentSort.direction === "asc" ? "▲" : "▼";
				icon.className += " text-indigo-300";
			} else {
				icon.innerHTML = "↕";
				icon.className += " text-gray-500 opacity-30 group-hover:opacity-100";
			}
			th.appendChild(icon);
		}
	});
};

const setupSortHeaders = () => {
	const headers = document.querySelectorAll(
		"#master-table-container thead tr:first-child th"
	);
	headers.forEach((th, index) => {
		if (index > 2 && index < 7 && index !== 4) {
			th.classList.add(
				"cursor-pointer",
				"hover:bg-gray-600",
				"group",
				"select-none",
				"transition-colors"
			);
			th.title = "Click to sort A-Z (Sorts right side only)";
			th.addEventListener("click", () => handleSort(index));

			const icon = document.createElement("span");
			icon.className =
				"ml-2 inline-block sort-icon text-xs text-gray-500 opacity-30 group-hover:opacity-100 font-bold";
			icon.innerHTML = "↕";
			th.appendChild(icon);
		}
	});
};

// --- Master Data Logic ---

const fetchAndRenderMasterData = async () => {
	const tableBody = document.getElementById("master-table-body");
	if (!db || !tableBody) return;
	tableBody.innerHTML = `<tr><td colspan="8" class="text-center p-4">Loading Master Data...</td></tr>`;

	try {
		const masterCollection = collection(
			db,
			`artifacts/${appId}/public/data/master_data`
		);
		const querySnapshot = await getDocs(masterCollection);

		masterData = querySnapshot.docs.map((doc) => {
			const data = doc.data();
			return {
				id: doc.id,
				...data,
				check: data.check || (data.company || "") + (data.supplier || ""),
				order: data.order !== undefined ? data.order : 0,
			};
		});

		masterData.sort((a, b) => a.order - b.order);

		renderMasterTable();
	} catch (error) {
		console.error("Error fetching master data:", error);
		tableBody.innerHTML = `<tr><td colspan="8" class="text-center p-4 text-red-500">Failed to load master data. Check console.</td></tr>`;
	}
};

const renderMasterTable = () => {
	const tableBody = document.getElementById("master-table-body");
	tableBody.innerHTML = "";
	const fragment = document.createDocumentFragment();
	masterData.forEach((item) => {
		fragment.appendChild(createMasterRowElement(item.id, item));
	});
	tableBody.appendChild(fragment);
};

// Helper for coloring Zone1 input only (Single cell)
const applyZone1InputColor = (input) => {
	const val = (input.value || "").trim().toUpperCase();
	input.classList.remove(
		"bg-yellow-200",
		"bg-orange-200",
		"bg-green-200",
		"bg-blue-200",
		"bg-white"
	);

	if (val === "1") {
		input.classList.add("bg-yellow-200");
	} else if (val === "2") {
		input.classList.add("bg-orange-200");
	} else if (val === "3") {
		input.classList.add("bg-green-200");
	} else if (val === "4") {
		input.classList.add("bg-blue-200");
	} else {
		// 5 or others -> White
		input.classList.add("bg-white");
	}
};

// Helper for coloring the RIGHT side block (Supplier -> Zone2)
const applyRightSideColor = (row, zoneValue) => {
	const val = (zoneValue || "").trim().toUpperCase();
	const supplierInput = row.querySelector('input[data-field="supplier"]');
	const checkCell = row.querySelector('td[data-field-display="check"]');
	const companyInput = row.querySelector('input[data-field="company"]');
	const zone2Input = row.querySelector('input[data-field="zone2"]');

	const elements = [supplierInput, companyInput, zone2Input];

	// Clear previous colors
	const colors = [
		"bg-yellow-200",
		"bg-orange-200",
		"bg-green-200",
		"bg-blue-200",
		"bg-white",
		"bg-gray-100",
	];
	elements.forEach((el) => el.classList.remove(...colors));
	checkCell.classList.remove(...colors);

	// Determine new color
	let colorClass = "bg-white"; // default for inputs
	let checkColorClass = "bg-white"; // default for check based on "5 White" rule

	if (val === "1") {
		colorClass = "bg-yellow-200";
		checkColorClass = "bg-yellow-200";
	} else if (val === "2") {
		colorClass = "bg-orange-200";
		checkColorClass = "bg-orange-200";
	} else if (val === "3") {
		colorClass = "bg-green-200";
		checkColorClass = "bg-green-200";
	} else if (val === "4") {
		colorClass = "bg-blue-200";
		checkColorClass = "bg-blue-200";
	} else {
		// 5 or others -> White
		colorClass = "bg-white";
		checkColorClass = "bg-white";
	}

	elements.forEach((el) => el.classList.add(colorClass));
	checkCell.classList.add(checkColorClass);
};

const createMasterRowElement = (id = "", data = {}) => {
	const newRow = document.createElement("tr");
	newRow.className = "border-b border-gray-200 hover:bg-gray-100";
	if (id) newRow.dataset.id = id;

	newRow.innerHTML = `
          <td class="p-2"><input type="text" autocomplete="off" class="uppercase-input w-full p-1 border rounded" data-field="milkRunCompany" value="${escapeHtml(
						data.milkRunCompany || ""
					)}"></td>
          <td class="p-2"><input type="text" autocomplete="off" class="uppercase-input w-full p-1 border rounded" data-field="zone1" value="${escapeHtml(
						data.zone1 || ""
					)}"></td>
          <td class="p-2"><input type="text" autocomplete="off" class="uppercase-input w-full p-1 border rounded" data-field="issueBy" value="${escapeHtml(
						data.issueBy || ""
					)}"></td>
          <td class="p-2"><input type="text" autocomplete="off" class="uppercase-input w-full p-1 border rounded" data-field="supplier" value="${escapeHtml(
						data.supplier || ""
					)}"></td>
          <td class="p-2 bg-gray-100" data-field-display="check">${escapeHtml(
						data.check || (data.company || "") + (data.supplier || "")
					)}</td>
          <td class="p-2"><input type="text" autocomplete="off" class="uppercase-input w-full p-1 border rounded" data-field="company" value="${escapeHtml(
						data.company || ""
					)}"></td>
          <td class="p-2"><input type="text" autocomplete="off" class="uppercase-input w-full p-1 border rounded" data-field="zone2" value="${escapeHtml(
						data.zone2 || ""
					)}"></td>
          <td class="p-2 text-center">
              <button type="button" class="text-red-500 hover:text-red-700 remove-row-btn" title="Remove row">
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 pointer-events-none" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM7 9a1 1 0 000 2h6a1 1 0 100-2H7z" clip-rule="evenodd" /></svg>
              </button>
          </td>
      `;

	const companyInput = newRow.querySelector('input[data-field="company"]');
	const supplierInput = newRow.querySelector('input[data-field="supplier"]');
	const checkDisplayCell = newRow.querySelector(
		'td[data-field-display="check"]'
	);

	// Zone Inputs
	const zone1Input = newRow.querySelector('input[data-field="zone1"]');
	const zone2Input = newRow.querySelector('input[data-field="zone2"]');

	// Initial color application
	applyZone1InputColor(zone1Input);
	applyRightSideColor(newRow, zone2Input.value); // Apply block color based on Zone2

	// Listeners for Color updates
	zone1Input.addEventListener("input", () => applyZone1InputColor(zone1Input));
	zone2Input.addEventListener("input", () =>
		applyRightSideColor(newRow, zone2Input.value)
	);

	const updateCheckDisplay = () => {
		checkDisplayCell.textContent = (
			(companyInput.value || "") + (supplierInput.value || "")
		).toUpperCase();
	};

	companyInput.addEventListener("input", updateCheckDisplay);
	supplierInput.addEventListener("input", updateCheckDisplay);
	newRow
		.querySelector(".remove-row-btn")
		.addEventListener("click", () => newRow.remove());
	return newRow;
};

const addMasterRowToTable = () => {
	document
		.getElementById("master-table-body")
		.appendChild(createMasterRowElement());
};

const saveMasterData = async () => {
	if (!db) return showModal("Database not connected.");

	showConfirmModal(
		"Are you sure you want to overwrite all master data with the current table content?",
		async () => {
			showProgressModal("Saving Master Data...");
			try {
				const masterCollection = collection(
					db,
					`artifacts/${appId}/public/data/master_data`
				);

				// Rows on screen -> documents. Existing rows keep their id
				// (overwritten in place), new rows get a new id, blank rows
				// are skipped.
				const rows = Array.from(
					document.querySelectorAll("#master-table-body tr")
				);
				const toWrite = [];
				rows.forEach((row) => {
					const rowData = readMasterRow(row);
					if (isBlankMasterRow(rowData)) return;
					rowData.check = (
						(rowData.company || "") + (rowData.supplier || "")
					).toUpperCase();
					rowData.order = toWrite.length;
					const ref = row.dataset.id
						? doc(masterCollection, row.dataset.id)
						: doc(masterCollection);
					toWrite.push({ ref, rowData });
				});

				// Write first, delete afterwards: if the connection drops half
				// way, the old data is still there instead of an empty master.
				document.getElementById("progress-modal-title").textContent =
					"Saving data...";
				await commitInChunks(
					db,
					writeBatch,
					toWrite,
					(batch, item) => batch.set(item.ref, item.rowData),
					(done, total) => updateProgress((done / total) * 90)
				);

				document.getElementById("progress-modal-title").textContent =
					"Removing deleted rows...";
				const keepIds = new Set(toWrite.map((item) => item.ref.id));
				const existingDocsSnapshot = await getDocs(masterCollection);
				const toDelete = existingDocsSnapshot.docs.filter(
					(d) => !keepIds.has(d.id)
				);
				await commitInChunks(db, writeBatch, toDelete, (batch, d) =>
					batch.delete(d.ref)
				);

				updateProgress(100);
				hideProgressModal();
				showModal(
					`Master data saved successfully! (${toWrite.length} rows)`,
					"Success",
					true
				);
				await fetchAndRenderMasterData();
			} catch (error) {
				hideProgressModal();
				console.error("Error saving master data: ", error);
				showModal("Failed to save master data.");
			}
		}
	);
};

const deleteAllMasterData = async () => {
	if (!db) return showModal("Database not connected.");
	if (masterData.length === 0)
		return showModal("There is no master data to delete.", "Info", true);

	showConfirmModal(
		"Are you sure you want to delete ALL master data? This action cannot be undone.",
		async () => {
			showProgressModal("Deleting all master data...");
			try {
				const batches = [];
				let batch = writeBatch(db);
				let count = 0;

				for (const item of masterData) {
					// Construct reference manually since masterData is now object array
					const docRef = doc(
						db,
						`artifacts/${appId}/public/data/master_data`,
						item.id
					);
					batch.delete(docRef);
					count++;
					if (count === 500) {
						batches.push(batch);
						batch = writeBatch(db);
						count = 0;
					}
				}
				if (count > 0) batches.push(batch);

				for (let i = 0; i < batches.length; i++) {
					await batches[i].commit();
					updateProgress(((i + 1) / batches.length) * 100);
				}

				hideProgressModal();
				showModal(
					"All master data has been deleted successfully!",
					"Success",
					true
				);
				await fetchAndRenderMasterData();
			} catch (error) {
				hideProgressModal();
				console.error("Error deleting all master data: ", error);
				showModal("Failed to delete all master data.");
			}
		}
	);
};

const exportMasterToCSV = () => {
	const now = new Date();
	const timestamp =
		toLocalDateKey(now) +
		String(now.getHours()).padStart(2, "0") +
		String(now.getMinutes()).padStart(2, "0");
	const filename = `master_data_${timestamp}.csv`;
	const headers = [
		"MILK RUN COMPANY",
		"Zone",
		"ISSUE BY",
		"SUPPLIER",
		"Check",
		"COMPANY",
		"Zone",
	];
	const rows = Array.from(document.querySelectorAll("#master-table-body tr"));

	// Export should include hidden rows (filtered out rows)
	const lines = [headers.map(csvCell).join(",")];
	rows.forEach((row) => {
		const value = (field) =>
			row.querySelector(`input[data-field="${field}"]`).value;
		lines.push(
			[
				value("milkRunCompany"),
				value("zone1"),
				value("issueBy"),
				value("supplier"),
				row.querySelector('td[data-field-display="check"]').textContent,
				value("company"),
				value("zone2"),
			]
				.map(csvCell)
				.join(",")
		);
	});

	downloadTextFile("\uFEFF" + lines.join("\n") + "\n", filename);
};

const handleCsvUpload = (event) => {
	const file = event.target.files[0];
	// Reset the input so choosing the same file again still fires "change".
	event.target.value = null;
	if (!file) return;

	showConfirmModal(
		"Are you sure you want to replace all current master data with the content of this file?",
		() => {
			const reader = new FileReader();
			reader.onload = async (e) => {
				// Real CSV parsing: a quoted value may contain commas.
				const rows = parseCsvText(e.target.result);
				if (rows.length <= 1)
					return showModal(
						"CSV file is empty or contains only a header.",
						"Upload Error"
					);

				const tableBody = document.getElementById("master-table-body");
				tableBody.innerHTML = "";
				showProgressModal("Loading data from CSV...");
				const fragment = document.createDocumentFragment();
				let loaded = 0;

				for (let i = 1; i < rows.length; i++) {
					const cols = rows[i].map((col) => String(col ?? "").trim());
					// Same column layout as "Export CSV" (column 5 = Check, rebuilt).
					const data = {
						milkRunCompany: cols[0] || "",
						zone1: cols[1] || "",
						issueBy: cols[2] || "",
						supplier: cols[3] || "",
						company: cols[5] || "",
						zone2: cols[6] || "",
					};
					if (!isBlankMasterRow(data)) {
						fragment.appendChild(createMasterRowElement("", data));
						loaded++;
					}
					if (i % 100 === 0) {
						updateProgress(((i + 1) / rows.length) * 100);
						await new Promise((resolve) => setTimeout(resolve, 0));
					}
				}
				tableBody.appendChild(fragment);
				hideProgressModal();
				showModal(
					`CSV data loaded (${loaded} rows). Please review and click "Save Changes".`,
					"Upload Complete",
					true
				);
			};
			reader.onerror = () => showModal("Could not read the selected file.");
			reader.readAsText(file, "UTF-8");
		}
	);
};

// --- Auth Functions ---
const bufferToHex = (buffer) => {
	return [...new Uint8Array(buffer)]
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
};
const hashPassword = async (password) => {
	const salt = "a-static-salt-for-this-app";
	const textEncoder = new TextEncoder();
	const data = textEncoder.encode(password + salt);
	const hashBuffer = await crypto.subtle.digest("SHA-256", data);
	return bufferToHex(hashBuffer);
};

const handleLogin = async (e) => {
	e.preventDefault();
	const username = document.getElementById("username").value.trim();
	const password = document.getElementById("password").value;
	const errorEl = document.getElementById("login-error");
	errorEl.textContent = "";

	try {
		const userDocRef = doc(
			db,
			`artifacts/${appId}/public/data/users`,
			username.toUpperCase()
		);
		const userDoc = await getDoc(userDocRef);
		if (!userDoc.exists()) {
			errorEl.textContent = "Invalid username or password.";
			return;
		}
		const enteredPasswordHash = await hashPassword(password);
		if (enteredPasswordHash === userDoc.data().password) {
			loggedInUser = { username: userDoc.id, ...userDoc.data() };
			// Save session
			sessionStorage.setItem(SESSION_KEY, JSON.stringify(loggedInUser));

			document.getElementById("login-modal").classList.add("hidden");
			document.getElementById("login-form").reset();
			updateAuthUI();
			fetchAndRenderMasterData();
			resetIdleTimer(); // Start timer
		} else {
			errorEl.textContent = "Invalid username or password.";
		}
	} catch (error) {
		console.error("Login error:", error);
		errorEl.textContent = "An error occurred.";
	}
};

const handleLogout = () => {
	if (idleTimer) clearTimeout(idleTimer);
	sessionStorage.removeItem(SESSION_KEY);
	loggedInUser = null;
	window.location.href = "../index.html"; // Redirect to main menu on logout
};

const updateAuthUI = () => {
	const userSessionView = document.getElementById("user-session-view");
	const deleteBtn = document.getElementById("delete-all-master-btn");

	if (loggedInUser) {
		document.getElementById("logged-in-username").textContent =
			loggedInUser.username;
		userSessionView.classList.remove("hidden");
		if (loggedInUser.username.toUpperCase() === "ADMIN") {
			deleteBtn.classList.remove("hidden");
		} else {
			deleteBtn.classList.add("hidden");
		}
	} else {
		userSessionView.classList.add("hidden");
		// Don't force modal here, we check logic elsewhere
	}
};

const populateUserDatalist = async () => {
	if (!db) return;
	try {
		const usersCollectionRef = collection(
			db,
			`artifacts/${appId}/public/data/users`
		);
		const querySnapshot = await getDocs(usersCollectionRef);
		const datalist = document.getElementById("username-list");
		datalist.innerHTML = "";
		querySnapshot.forEach((doc) => {
			const option = document.createElement("option");
			option.value = doc.id;
			datalist.appendChild(option);
		});
	} catch (error) {
		console.error(error);
	}
};

const handleChangePassword = async (e) => {
	e.preventDefault();
	const oldPassword = document.getElementById("oldPassword").value;
	const newPassword = document.getElementById("newPassword").value;
	const confirmNewPassword =
		document.getElementById("confirmNewPassword").value;
	const errorEl = document.getElementById("change-password-error");
	errorEl.textContent = "";

	if (newPassword !== confirmNewPassword) {
		errorEl.textContent = "New passwords do not match.";
		return;
	}

	try {
		const oldHash = await hashPassword(oldPassword);
		if (oldHash !== loggedInUser.password) {
			errorEl.textContent = "Incorrect old password.";
			return;
		}

		const newHash = await hashPassword(newPassword);
		await setDoc(
			doc(db, `artifacts/${appId}/public/data/users`, loggedInUser.username),
			{ password: newHash },
			{ merge: true }
		);
		loggedInUser.password = newHash;
		// Update session storage with new password hash if needed, or just leave it
		// Best to update it so persistence works if we reload
		sessionStorage.setItem(SESSION_KEY, JSON.stringify(loggedInUser));

		document.getElementById("change-password-modal").classList.add("hidden");
		document.getElementById("change-password-form").reset();
		showModal("Password changed successfully!", "Success", true);
	} catch (e) {
		errorEl.textContent = "Error changing password.";
	}
};

// --- User Management Logic ---

const fetchAndRenderUsers = async () => {
	const userListBody = document.getElementById("user-list-body");
	if (!db || !userListBody) return;

	userListBody.innerHTML = `<tr><td colspan="2" class="px-6 py-4 text-center text-sm text-gray-500">Loading users...</td></tr>`;

	try {
		const usersCollectionRef = collection(
			db,
			`artifacts/${appId}/public/data/users`
		);
		const querySnapshot = await getDocs(usersCollectionRef);

		userListBody.innerHTML = "";

		if (querySnapshot.empty) {
			userListBody.innerHTML = `<tr><td colspan="2" class="px-6 py-4 text-center text-sm text-gray-500">No users found.</td></tr>`;
			return;
		}

		const isAdmin = loggedInUser && loggedInUser.username === "ADMIN";

		querySnapshot.forEach((doc) => {
			const username = doc.id;
			const tr = document.createElement("tr");

			let deleteButtonHtml = "";
			// ADMIN only, and prevent deleting ADMIN itself (optional safety)
			if (isAdmin && username !== "ADMIN") {
				deleteButtonHtml = `
          <button class="delete-user-btn text-red-600 hover:text-red-900" data-username="${username}">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd" />
            </svg>
          </button>
        `;
			} else if (isAdmin && username === "ADMIN") {
				deleteButtonHtml = `<span class="text-xs text-gray-400">Main Admin</span>`;
			}

			tr.innerHTML = `
        <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${username}</td>
        <td class="px-6 py-4 whitespace-nowrap text-center text-sm font-medium">
          ${deleteButtonHtml}
        </td>
      `;
			userListBody.appendChild(tr);
		});

		// Attach listeners for delete buttons
		document.querySelectorAll(".delete-user-btn").forEach((btn) => {
			btn.addEventListener("click", () =>
				handleDeleteUser(btn.dataset.username)
			);
		});
	} catch (error) {
		console.error("Error fetching users:", error);
		userListBody.innerHTML = `<tr><td colspan="2" class="px-6 py-4 text-center text-sm text-red-500">Error loading users.</td></tr>`;
	}
};

const handleAddUser = async (e) => {
	e.preventDefault();
	const username = document
		.getElementById("new-username")
		.value.trim()
		.toUpperCase();
	const password = document.getElementById("new-user-password").value;
	const confirmPassword = document.getElementById(
		"confirm-new-user-password"
	).value;

	if (!username || !password || !confirmPassword) {
		alert("Please fill in all fields.");
		return;
	}

	if (password !== confirmPassword) {
		alert("Passwords do not match.");
		return;
	}

	showProgressModal("Creating user...");

	try {
		const userDocRef = doc(
			db,
			`artifacts/${appId}/public/data/users`,
			username
		);
		const userDoc = await getDoc(userDocRef);

		if (userDoc.exists()) {
			hideProgressModal();
			alert("Username already exists. Please choose another.");
			return;
		}

		const passwordHash = await hashPassword(password);
		await setDoc(userDocRef, { password: passwordHash });

		hideProgressModal();
		alert(`User "${username}" created successfully.`);
		document.getElementById("add-user-form").reset();
		fetchAndRenderUsers(); // Refresh list
		populateUserDatalist(); // Refresh login autocomplete
	} catch (error) {
		console.error("Error creating user:", error);
		hideProgressModal();
		alert("Failed to create user.");
	}
};

const handleDeleteUser = async (username) => {
	if (!username) return;

	showConfirmModal(
		`Are you sure you want to delete user "${username}"?`,
		async () => {
			showProgressModal("Deleting user...");
			try {
				await deleteDoc(
					doc(db, `artifacts/${appId}/public/data/users`, username)
				);
				hideProgressModal();
				alert(`User "${username}" deleted.`);
				fetchAndRenderUsers();
				populateUserDatalist();
			} catch (error) {
				console.error("Error deleting user:", error);
				hideProgressModal();
				alert("Failed to delete user.");
			}
		}
	);
};

// --- Init ---
const init = async () => {
	if (!db) return;

	setupIdleListeners(); // Init listeners

	// Setup Sort headers (Click events)
	setupSortHeaders();

	// Check for existing session immediately
	const storedUser = sessionStorage.getItem(SESSION_KEY);
	if (storedUser) {
		try {
			loggedInUser = JSON.parse(storedUser);
			updateAuthUI();
			// If we have a user, we can fetch data right away
			fetchAndRenderMasterData();
			resetIdleTimer(); // Start timer from session load
		} catch (e) {
			console.error("Invalid session", e);
			sessionStorage.removeItem(SESSION_KEY);
		}
	}

	// Listeners
	document
		.getElementById("modal-close-btn")
		.addEventListener("click", hideModal);
	document
		.getElementById("add-master-row-btn")
		.addEventListener("click", addMasterRowToTable);
	document
		.getElementById("save-master-btn")
		.addEventListener("click", saveMasterData);
	document
		.getElementById("delete-all-master-btn")
		.addEventListener("click", deleteAllMasterData);
	document
		.getElementById("export-csv-btn")
		.addEventListener("click", exportMasterToCSV);
	document
		.getElementById("upload-csv-btn")
		.addEventListener("click", () =>
			document.getElementById("csv-file-input").click()
		);
	document
		.getElementById("csv-file-input")
		.addEventListener("change", handleCsvUpload);
	document.getElementById("login-form").addEventListener("submit", handleLogin);
	document.getElementById("logout-btn").addEventListener("click", handleLogout);

	document
		.getElementById("change-password-btn")
		.addEventListener("click", () =>
			document
				.getElementById("change-password-modal")
				.classList.remove("hidden")
		);
	document
		.getElementById("change-password-cancel-btn")
		.addEventListener("click", () =>
			document.getElementById("change-password-modal").classList.add("hidden")
		);
	document
		.getElementById("change-password-form")
		.addEventListener("submit", handleChangePassword);

	// User Management Listeners
	document.getElementById("manage-users-btn").addEventListener("click", () => {
		document.getElementById("user-management-modal").classList.remove("hidden");
		fetchAndRenderUsers();
	});
	document
		.getElementById("close-user-management-btn")
		.addEventListener("click", () => {
			document.getElementById("user-management-modal").classList.add("hidden");
		});
	document
		.getElementById("add-user-form")
		.addEventListener("submit", handleAddUser);

	document.body.addEventListener("input", (e) => {
		if (e.target.matches('input[type="text"].uppercase-input')) {
			const start = e.target.selectionStart;
			const end = e.target.selectionEnd;
			e.target.value = e.target.value.toUpperCase();
			e.target.setSelectionRange(start, end);
		}
	});

	onAuthStateChanged(auth, async (user) => {
		if (user) {
			await populateUserDatalist();
			// Only show login modal if user is NOT logged in via session
			if (!loggedInUser) {
				document.getElementById("login-modal").classList.remove("hidden");
			}
		} else {
			if (typeof __initial_auth_token !== "undefined" && __initial_auth_token) {
				await signInWithCustomToken(auth, __initial_auth_token);
			} else {
				await signInAnonymously(auth);
			}
		}
	});
};

document.addEventListener("DOMContentLoaded", init);
