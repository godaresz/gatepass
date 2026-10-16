import {
  setLogLevel,
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import {
  signInAnonymously,
  onAuthStateChanged,
  signInWithCustomToken,
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import {
  doc,
  getDoc,
  deleteDoc,
  collection,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  writeBatch,
  setDoc,
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// --- IMPORT จากไฟล์กลาง ---
import { auth, db, appId } from "./firebase-config.js";

let loggedInUser = null;
const SESSION_KEY = "gatepass_user_session";
let currentFilteredHistory = [];
let lastVisibleDoc = null;
let isFetchingHistory = false;
let masterDataCache = { companies: new Set(), zones: new Set() };
let masterData = [];

// --- Auto Logout Configuration ---
let idleTimer;
const IDLE_TIMEOUT = 5 * 60 * 1000; // 5 นาที (หน่วยเป็นมิลลิวินาที)

// --- Helper Functions ---
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

  // Clone to remove old listeners
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

const formatDateEN = (dateObj) => {
  if (!dateObj || typeof dateObj.getDate !== "function") return "N/A";
  // Format: DD/MM/YYYY HH:mm:ss
  const day = String(dateObj.getDate()).padStart(2, "0");
  const month = String(dateObj.getMonth() + 1).padStart(2, "0");
  const year = dateObj.getFullYear();
  const hours = String(dateObj.getHours()).padStart(2, "0");
  const minutes = String(dateObj.getMinutes()).padStart(2, "0");
  const seconds = String(dateObj.getSeconds()).padStart(2, "0");
  return `${day}/${month}/${year} ${hours}:${minutes}:${seconds}`;
};

const downloadCSV = (csvContent, filename) => {
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  if (link.download !== undefined) {
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", filename);
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
};

// --- Auto Logout Logic ---
const resetIdleTimer = () => {
  if (idleTimer) clearTimeout(idleTimer);
  // Only set timer if user is logged in
  if (loggedInUser) {
    idleTimer = setTimeout(() => {
      alert("หมดเวลาการเชื่อมต่อ (ไม่มีการใช้งานเกิน 5 นาที) กรุณาเข้าสู่ระบบใหม่");
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

// --- Record/History Logic ---

const clearHistoryFilters = () => {
  document.getElementById("search-input").value = "";
  document.getElementById("filter-start-date").value = "";
  document.getElementById("filter-start-time").value = "";
  document.getElementById("filter-end-date").value = "";
  document.getElementById("filter-end-time").value = "";
  document.getElementById("filter-history-truckNo").value = "";
  document.getElementById("filter-history-company").value = "";
  document.getElementById("filter-history-zone").value = "";
  document.getElementById("filter-history-supplier").value = "";
  document.getElementById("filter-history-status").value = "all";
  fetchAndRenderHistory(true);
};

const fetchAndRenderHistory = async (isNewSearch = false) => {
  if (isFetchingHistory) return;
  isFetchingHistory = true;

  const historyTableBody = document.getElementById("history-table-body");
  const loadMoreBtn = document.getElementById("load-more-history-btn");
  const loadAllBtn = document.getElementById("load-all-history-btn");
  const clearLoadBtn = document.getElementById("clear-load-history-btn");
  const historyFooter = document.getElementById("history-table-footer");

  if (isNewSearch) {
    lastVisibleDoc = null;
    historyTableBody.innerHTML = `<tr><td colspan="17" class="py-4 text-center text-gray-500">Loading history...</td></tr>`;
    historyFooter.innerHTML = "";
    currentFilteredHistory = [];
    clearLoadBtn.classList.add("hidden");
  }
  loadMoreBtn.classList.add("hidden");
  loadAllBtn.classList.add("hidden");

  // 1. Initial Query Setup
  const gatepassesCollection = collection(
    db,
    `artifacts/${appId}/public/data/gatepasses`
  );

  // Start with basic ordering
  let queryConstraints = [orderBy("issueDate", "desc")];

  // -- Server-Side Filtering (Use cautiously without indexes) --
  // Only applying date range server-side usually works well with orderBy('issueDate')
  const startDate = document.getElementById("filter-start-date").value;
  const startTime = document.getElementById("filter-start-time").value;
  const endDate = document.getElementById("filter-end-date").value;
  const endTime = document.getElementById("filter-end-time").value;

  if (startDate) {
    const start = new Date(`${startDate}T${startTime || "00:00:00"}`);
    queryConstraints.push(where("issueDate", ">=", start));
  }
  if (endDate) {
    const end = new Date(`${endDate}T${endTime || "23:59:59"}`);
    queryConstraints.push(where("issueDate", "<=", end));
  }

  // Pagination
  if (lastVisibleDoc && !isNewSearch) {
    queryConstraints.push(startAfter(lastVisibleDoc));
  }
  queryConstraints.push(limit(50)); // Increased limit slightly since we filter client-side

  try {
    const finalQuery = query(gatepassesCollection, ...queryConstraints);
    const querySnapshot = await getDocs(finalQuery);

    if (isNewSearch) historyTableBody.innerHTML = "";

    if (querySnapshot.empty && isNewSearch) {
      historyTableBody.innerHTML = `<tr><td colspan="17" class="py-4 text-center text-gray-500">No gatepasses found.</td></tr>`;
      isFetchingHistory = false;
      return;
    }

    if (!querySnapshot.empty) {
      lastVisibleDoc = querySnapshot.docs[querySnapshot.docs.length - 1];
    }

    const docsToRender = [];
    querySnapshot.forEach((doc) =>
      docsToRender.push({ id: doc.id, ...doc.data() })
    );

    // 2. Client-Side Filtering
    const truckNoFilter = document
      .getElementById("filter-history-truckNo")
      .value.trim()
      .toLowerCase();
    const companyFilter = document
      .getElementById("filter-history-company")
      .value.trim();
    const zoneFilter = document
      .getElementById("filter-history-zone")
      .value.trim();
    const statusFilter = document.getElementById("filter-history-status").value;
    const supplierFilter = document
      .getElementById("filter-history-supplier")
      .value.trim();
    const searchText = document
      .getElementById("search-input")
      .value.toLowerCase();

    const filteredDocs = docsToRender.filter((doc) => {
      let matches = true;

      if (truckNoFilter && !doc.truckNo?.toLowerCase().includes(truckNoFilter))
        matches = false;
      if (companyFilter && doc.company !== companyFilter) matches = false;
      if (zoneFilter && doc.zone !== zoneFilter) matches = false;
      if (statusFilter !== "all" && doc.status !== statusFilter)
        matches = false;

      // Search text logic
      if (searchText) {
        const searchFields = [
          doc.gatepassNo,
          doc.truckNo,
          doc.company,
          doc.zone,
          doc.driverName,
          doc.issueBy,
          doc.sealNo,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();

        // Also check suppliers in search text
        const supplierNames = (doc.suppliers || [])
          .map((s) => s.name)
          .join(" ")
          .toLowerCase();

        if (
          !searchFields.includes(searchText) &&
          !supplierNames.includes(searchText)
        ) {
          matches = false;
        }
      }

      // Supplier Filter Logic
      if (supplierFilter) {
        const hasSupplier = (doc.suppliers || []).some(
          (s) => s.name === supplierFilter
        );
        if (!hasSupplier) matches = false;
      }

      return matches;
    });

    if (isNewSearch && filteredDocs.length === 0) {
      historyTableBody.innerHTML = `<tr><td colspan="17" class="py-4 text-center text-gray-500">No gatepasses found matching criteria.</td></tr>`;
    } else {
      renderHistoryRows(filteredDocs, isNewSearch);
    }

    // Show/Hide buttons based on raw snapshot size
    if (querySnapshot.docs.length >= 20) {
      loadMoreBtn.classList.remove("hidden");
      loadAllBtn.classList.remove("hidden");
    } else {
      loadMoreBtn.classList.add("hidden");
      loadAllBtn.classList.add("hidden");
    }
  } catch (error) {
    console.error("Error fetching history:", error);
    let msg = "Error fetching data.";
    if (error.code === "failed-precondition") {
      msg =
        "System requires an index for this specific query combination. Check console for link.";
    }
    historyTableBody.innerHTML = `<tr><td colspan="17" class="py-4 text-center text-red-500">${msg} <br> See Console (F12) for details.</td></tr>`;
  } finally {
    isFetchingHistory = false;
  }
};

const renderHistoryRows = (docs, isNewSearch) => {
  const historyTableBody = document.getElementById("history-table-body");
  const fragment = document.createDocumentFragment();
  let newRowsData = [];

  docs.forEach((data) => {
    if (data.suppliers && data.suppliers.length > 0) {
      data.suppliers.forEach((supplier) =>
        newRowsData.push({ ...data, supplier })
      );
    } else {
      newRowsData.push({ ...data, supplier: {} });
    }
  });

  if (isNewSearch) {
    currentFilteredHistory = newRowsData;
  } else {
    currentFilteredHistory = [...currentFilteredHistory, ...newRowsData];
  }

  const groupedByGatepass = newRowsData.reduce((acc, item) => {
    if (!acc[item.id]) acc[item.id] = [];
    acc[item.id].push(item);
    return acc;
  }, {});

  Object.values(groupedByGatepass).forEach((items) => {
    const rowspan = items.length > 1 ? `rowspan="${items.length}"` : "";
    items.forEach((data, index) => {
      const supplier = data.supplier || {};
      const newRow = document.createElement("tr");
      newRow.className =
        "border-b border-gray-200 last:border-b-0 hover:bg-gray-100";
      const issueDate = data.issueDate
        ? formatDateEN(data.issueDate.toDate())
        : "N/A";

      let rowHtml = "";
      if (index === 0) {
        rowHtml += `
                      <td class="py-3 px-4 text-left align-top" ${rowspan}>${issueDate}</td>
                      <td class="py-3 px-4 text-left align-top" ${rowspan}>${
          data.gatepassNo || "N/A"
        }</td>
                      <td class="py-3 px-4 text-left align-top" ${rowspan}>${
          data.driverName || "N/A"
        }</td>
                      <td class="py-3 px-4 text-left align-top" ${rowspan}>${
          data.truckNo || "N/A"
        }</td>`;
      }

      const displayCompany = supplier.company || data.company || "";
      const displayZone = supplier.zone || data.zone || "";

      rowHtml += `
                  <td class="py-3 px-4 text-left">${displayCompany}</td>
                  <td class="py-3 px-4 text-left">${displayZone}</td>
                  <td class="py-3 px-4 text-left">${supplier.name || ""}</td>
                  <td class="py-3 px-4 text-left">${supplier.ptb || "0"}</td>
                  <td class="py-3 px-4 text-left">${supplier.cpb || "0"}</td>
                  <td class="py-3 px-4 text-left">${supplier.mov || "0"}</td>
                  <td class="py-3 px-4 text-left">${supplier.stp || "0"}</td>
                  <td class="py-3 px-4 text-left">${supplier.pl || "0"}</td>
                  <td class="py-3 px-4 text-left">${supplier.rp || "0"}</td>`;

      if (index === 0) {
        rowHtml += `
                      <td class="py-3 px-4 text-left align-top" ${rowspan}>${
          data.issueBy || "N/A"
        }</td>
                      <td class="py-3 px-4 text-left align-top" ${rowspan}>${
          data.sealNo || "N/A"
        }</td>
                      <td class="py-3 px-4 text-left align-top" ${rowspan}><span class="px-2 py-1 text-xs font-semibold rounded-full ${
          data.status === "Empty-Out"
            ? "bg-blue-100 text-blue-800"
            : "bg-green-100 text-green-800"
        }">${data.status || "N/A"}</span></td>
                      <td class="py-3 px-4 text-center align-top" ${rowspan}>
                          <div class="flex items-center justify-center space-x-2">
                              <button class="text-green-500 hover:text-green-700 edit-gatepass-btn" data-doc-id="${
                                data.id
                              }" title="Edit">
                                  <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 pointer-events-none" viewBox="0 0 20 20" fill="currentColor">
                                      <path d="M17.414 2.586a2 2 0 00-2.828 0L7 10.172V13h2.828l7.586-7.586a2 2 0 000-2.828z" />
                                      <path fill-rule="evenodd" d="M2 6a2 2 0 012-2h4a1 1 0 010 2H4v10h10v-4a1 1 0 112 0v4a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" clip-rule="evenodd" />
                                  </svg>
                              </button>
                              <button class="text-indigo-500 hover:text-indigo-700 view-pdf-btn" data-doc-id="${
                                data.id
                              }" title="Print">
                                  <img src="https://cdn-icons-png.freepik.com/512/8367/8367710.png" class="h-5 w-5 pointer-events-none" alt="Print Icon" onerror="this.onerror=null;this.src='https://placehold.co/20x20/ffffff/334155?text=P';">
                              </button>
                              <button class="text-red-500 hover:text-red-700 delete-gatepass-btn" data-doc-id="${
                                data.id
                              }" title="Delete Gatepass">
                                  <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 pointer-events-none" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd" /></svg>
                              </button>
                          </div>
                      </td>`;
      }
      newRow.innerHTML = rowHtml;
      fragment.appendChild(newRow);
    });
  });
  historyTableBody.appendChild(fragment);
  updateHistoryTotals();
};

const updateHistoryTotals = () => {
  const totals = { ptb: 0, cpb: 0, mov: 0, stp: 0, pl: 0, rp: 0 };
  currentFilteredHistory.forEach((data) => {
    const supplier = data.supplier || {};
    Object.keys(totals).forEach(
      (key) => (totals[key] += parseFloat(supplier[key]) || 0)
    );
  });

  const footer = document.getElementById("history-table-footer");
  footer.innerHTML = `
          <tr>
              <td class="py-3 px-4 text-right" colspan="7">Total:</td>
              <td id="history-total-ptb" class="py-3 px-4 text-left">${totals.ptb}</td>
              <td id="history-total-cpb" class="py-3 px-4 text-left">${totals.cpb}</td>
              <td id="history-total-mov" class="py-3 px-4 text-left">${totals.mov}</td>
              <td id="history-total-stp" class="py-3 px-4 text-left">${totals.stp}</td>
              <td id="history-total-pl" class="py-3 px-4 text-left">${totals.pl}</td>
              <td id="history-total-rp" class="py-3 px-4 text-left">${totals.rp}</td>
              <td colspan="4"></td>
          </tr>`;
};

const handleLoadAllHistory = async () => {
  if (isFetchingHistory) return;
  isFetchingHistory = true;
  showProgressModal("Loading all history...");

  try {
    const gatepassesCollection = collection(
      db,
      `artifacts/${appId}/public/data/gatepasses`
    );
    let queryConstraints = [orderBy("issueDate", "desc")];

    const startDate = document.getElementById("filter-start-date").value;
    const startTime = document.getElementById("filter-start-time").value;
    const endDate = document.getElementById("filter-end-date").value;
    const endTime = document.getElementById("filter-end-time").value;

    if (startDate)
      queryConstraints.push(
        where(
          "issueDate",
          ">=",
          new Date(`${startDate}T${startTime || "00:00:00"}`)
        )
      );
    if (endDate)
      queryConstraints.push(
        where(
          "issueDate",
          "<=",
          new Date(`${endDate}T${endTime || "23:59:59"}`)
        )
      );

    const finalQuery = query(gatepassesCollection, ...queryConstraints);
    const querySnapshot = await getDocs(finalQuery);

    let allDocs = [];
    querySnapshot.forEach((doc) => allDocs.push({ id: doc.id, ...doc.data() }));

    const truckNoFilter = document
      .getElementById("filter-history-truckNo")
      .value.trim()
      .toLowerCase();
    const companyFilter = document
      .getElementById("filter-history-company")
      .value.trim();
    const zoneFilter = document
      .getElementById("filter-history-zone")
      .value.trim();
    const statusFilter = document.getElementById("filter-history-status").value;
    const supplierFilter = document
      .getElementById("filter-history-supplier")
      .value.trim();
    const searchText = document
      .getElementById("search-input")
      .value.toLowerCase();

    const filteredDocs = allDocs.filter((doc) => {
      let matches = true;
      if (truckNoFilter && !doc.truckNo?.toLowerCase().includes(truckNoFilter))
        matches = false;
      if (companyFilter && doc.company !== companyFilter) matches = false;
      if (zoneFilter && doc.zone !== zoneFilter) matches = false;
      if (statusFilter !== "all" && doc.status !== statusFilter)
        matches = false;

      if (searchText) {
        const searchFields = [
          doc.gatepassNo,
          doc.truckNo,
          doc.company,
          doc.zone,
          doc.driverName,
          doc.issueBy,
          doc.sealNo,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        const supplierNames = (doc.suppliers || [])
          .map((s) => s.name)
          .join(" ")
          .toLowerCase();
        if (
          !searchFields.includes(searchText) &&
          !supplierNames.includes(searchText)
        )
          matches = false;
      }

      if (supplierFilter) {
        const hasSupplier = (doc.suppliers || []).some(
          (s) => s.name === supplierFilter
        );
        if (!hasSupplier) matches = false;
      }
      return matches;
    });

    document.getElementById("history-table-body").innerHTML = "";
    renderHistoryRows(filteredDocs, true);
    document
      .getElementById("clear-load-history-btn")
      .classList.remove("hidden");
    document.getElementById("load-more-history-btn").classList.add("hidden");
    document.getElementById("load-all-history-btn").classList.add("hidden");
  } catch (error) {
    console.error("Error loading all history:", error);
    showModal("Failed to load all history data.");
  } finally {
    hideProgressModal();
    isFetchingHistory = false;
  }
};

const handleClearLoad = () => {
  document.getElementById("clear-load-history-btn").classList.add("hidden");
  fetchAndRenderHistory(true);
};

const handleDeleteGatepass = async (button) => {
  const docId = button.dataset.docId;
  if (!docId) return;
  showConfirmModal(
    "Are you sure you want to delete this gatepass record?",
    async () => {
      try {
        await deleteDoc(
          doc(db, `artifacts/${appId}/public/data/gatepasses`, docId)
        );
        showModal("Gatepass deleted successfully.", "Success", true);
        fetchAndRenderHistory(true);
      } catch (error) {
        console.error("Error deleting gatepass:", error);
        showModal("Failed to delete gatepass.");
      }
    }
  );
};

const handleEditGatepass = async (button) => {
  const docId = button.dataset.docId;
  if (!docId) return;
  try {
    const docRef = doc(db, `artifacts/${appId}/public/data/gatepasses`, docId);
    const gatepassDoc = await getDoc(docRef);
    if (!gatepassDoc.exists()) {
      showModal("Could not find the selected gatepass data.");
      return;
    }
    const data = gatepassDoc.data();
    if (data.status === "Empty-IN") {
      sessionStorage.setItem("editGatepassInId", docId);
      window.location.href = "gatepass-in.html";
    } else {
      sessionStorage.setItem("editGatepassId", docId);
      window.location.href = "issue.html";
    }
  } catch (error) {
    console.error("Error fetching gatepass for edit:", error);
    showModal("Failed to fetch gatepass data.");
  }
};

const handleViewPdf = async (button) => {
  const docId = button.dataset.docId;
  if (!docId) return;

  try {
    const docRef = doc(db, `artifacts/${appId}/public/data/gatepasses`, docId);
    const gatepassDoc = await getDoc(docRef);
    if (!gatepassDoc.exists()) return showModal("Data not found.");

    const data = gatepassDoc.data();
    const issueDate = data.issueDate ? data.issueDate.toDate() : new Date();

    document.getElementById("print-date").textContent =
      formatDateEN(issueDate).split(" ")[0];
    document.getElementById("print-gatepassId").textContent =
      data.gatepassNo || "N/A";
    document.getElementById("print-driverName").textContent = data.driverName;
    document.getElementById("print-truckNo").textContent = data.truckNo;
    document.getElementById("print-company").textContent = data.company;
    document.getElementById("print-zone").textContent = data.zone;
    document.getElementById("print-sealNo").textContent = data.sealNo;
    document.getElementById("print-issue-datetime").textContent =
      formatDateEN(issueDate);
    document.getElementById("print-worker-name").textContent = data.issueBy;
    document.getElementById("print-driver-signature").textContent =
      data.driverName;
    document.getElementById("print-driver-company").textContent = data.company;

    const printTableBody = document.getElementById("print-supplier-table-body");
    printTableBody.innerHTML = "";
    let printTotals = {
      ptb: 0,
      cpb: 0,
      mov: 0,
      stp: 0,
      pl: 0,
      rp: 0,
      grand: 0,
    };

    for (let i = 0; i < 30; i++) {
      const supplier = (data.suppliers || [])[i];
      const newRow = document.createElement("tr");
      if (supplier) {
        const total =
          (supplier.ptb || 0) +
          (supplier.cpb || 0) +
          (supplier.mov || 0) +
          (supplier.stp || 0) +
          (supplier.pl || 0) +
          (supplier.rp || 0);
        printTotals.ptb += supplier.ptb || 0;
        printTotals.cpb += supplier.cpb || 0;
        printTotals.mov += supplier.mov || 0;
        printTotals.stp += supplier.stp || 0;
        printTotals.pl += supplier.pl || 0;
        printTotals.rp += supplier.rp || 0;
        printTotals.grand += total;
        const isRottPlao = supplier.name === "รถเปล่า";

        newRow.innerHTML = `
                      <td class="supplier-name">${supplier.name}</td>
                      <td>${
                        supplier.ptb > 0 || isRottPlao ? supplier.ptb || 0 : ""
                      }</td>
                      <td>${
                        supplier.cpb > 0 || isRottPlao ? supplier.cpb || 0 : ""
                      }</td>
                      <td>${
                        supplier.mov > 0 || isRottPlao ? supplier.mov || 0 : ""
                      }</td>
                      <td>${
                        supplier.stp > 0 || isRottPlao ? supplier.stp || 0 : ""
                      }</td>
                      <td>${
                        supplier.pl > 0 || isRottPlao ? supplier.pl || 0 : ""
                      }</td>
                      <td>${
                        supplier.rp > 0 || isRottPlao ? supplier.rp || 0 : ""
                      }</td>
                      <td>${total > 0 || isRottPlao ? total : ""}</td>
                  `;
      } else {
        newRow.innerHTML = `<td class="supplier-name">&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td>`;
      }
      printTableBody.appendChild(newRow);
    }

    document.getElementById("print-supplier-table-footer").innerHTML = `
              <tr>
                  <td class="font-bold text-right">TOTAL (รวม)</td>
                  <td class="font-bold">${printTotals.ptb}</td>
                  <td class="font-bold">${printTotals.cpb}</td>
                  <td class="font-bold">${printTotals.mov}</td>
                  <td class="font-bold">${printTotals.stp}</td>
                  <td class="font-bold">${printTotals.pl}</td>
                  <td class="font-bold">${printTotals.rp}</td>
                  <td class="font-bold">${printTotals.grand}</td>
              </tr>`;

    // Handle Print Logic (4 copies + Visibility)
    const printVersion = document.getElementById("print-version");
    const historyPage = document.getElementById("history-page");
    const printMessage = document.getElementById("print-message");

    // --- 4-Copy Logic Logic ---
    const originalContent = printVersion.innerHTML;
    printVersion.innerHTML = "";
    const pageWrapper = document.createElement("div");
    pageWrapper.innerHTML = originalContent;

    for (let i = 0; i < 4; i++) {
      const newPage = pageWrapper.cloneNode(true);
      if (i < 3) newPage.style.pageBreakAfter = "always";
      printVersion.appendChild(newPage);
    }
    // --- End 4-Copy Logic ---

    historyPage.classList.add("hidden");
    printVersion.classList.remove("hidden");
    if (printMessage) printMessage.classList.remove("hidden");

    setTimeout(() => {
      window.print();
      setTimeout(() => {
        printVersion.innerHTML = originalContent; // Restore single view
        printVersion.classList.add("hidden");
        if (printMessage) printMessage.classList.add("hidden");
        historyPage.classList.remove("hidden");
      }, 500);
    }, 100);
  } catch (error) {
    console.error("Error printing:", error);
    showModal("Failed to prepare document for printing.");
  }
};

const exportHistoryToCSV = async () => {
  showConfirmModal("Export matching records to CSV?", async () => {
    showProgressModal("Exporting...");
    try {
      const gatepassesCollection = collection(
        db,
        `artifacts/${appId}/public/data/gatepasses`
      );
      let queryConstraints = [orderBy("issueDate", "desc")];

      const startDate = document.getElementById("filter-start-date").value;
      const startTime = document.getElementById("filter-start-time").value;
      const endDate = document.getElementById("filter-end-date").value;
      const endTime = document.getElementById("filter-end-time").value;

      if (startDate)
        queryConstraints.push(
          where(
            "issueDate",
            ">=",
            new Date(`${startDate}T${startTime || "00:00:00"}`)
          )
        );
      if (endDate)
        queryConstraints.push(
          where(
            "issueDate",
            "<=",
            new Date(`${endDate}T${endTime || "23:59:59"}`)
          )
        );

      const q = query(gatepassesCollection, ...queryConstraints);
      const snapshot = await getDocs(q);

      const headers = [
        "Date",
        "Gatepass No.",
        "Driver Name",
        "Truck No.",
        "Company",
        "Zone",
        "Supplier",
        "PTB",
        "CPB",
        "MOV",
        "STP",
        "PL",
        "RP",
        "Issue By",
        "Seal No.",
        "Status",
      ];
      let csv = "\uFEFF" + headers.join(",") + "\n";

      const truckNoFilter = document
        .getElementById("filter-history-truckNo")
        .value.trim()
        .toLowerCase();
      const companyFilter = document
        .getElementById("filter-history-company")
        .value.trim();
      const zoneFilter = document
        .getElementById("filter-history-zone")
        .value.trim();
      const statusFilter = document.getElementById(
        "filter-history-status"
      ).value;

      snapshot.forEach((doc) => {
        const data = doc.data();

        if (
          truckNoFilter &&
          !data.truckNo?.toLowerCase().includes(truckNoFilter)
        )
          return;
        if (companyFilter && data.company !== companyFilter) return;
        if (zoneFilter && data.zone !== zoneFilter) return;
        if (statusFilter !== "all" && data.status !== statusFilter) return;

        const issueDate = data.issueDate
          ? formatDateEN(data.issueDate.toDate())
          : "N/A";
        (data.suppliers || [{}]).forEach((s) => {
          const row = [
            issueDate,
            data.gatepassNo,
            data.driverName,
            data.truckNo,
            s.company || data.company,
            s.zone || data.zone,
            s.name,
            s.ptb || 0,
            s.cpb || 0,
            s.mov || 0,
            s.stp || 0,
            s.pl || 0,
            s.rp || 0,
            data.issueBy,
            data.sealNo,
            data.status,
          ];
          csv +=
            row
              .map((v) => `"${String(v || "").replace(/"/g, '""')}"`)
              .join(",") + "\n";
        });
      });

      downloadCSV(
        csv,
        `gatepass_history_${new Date().toISOString().slice(0, 10)}.csv`
      );
      hideProgressModal();
    } catch (e) {
      console.error(e);
      hideProgressModal();
      showModal("Export failed.");
    }
  });
};

const handleHistoryCsvUpload = (event) => {
  alert(
    "Functionality available in original script. Please migrate full CSV upload logic if needed."
  );
};

const handleDeleteAllHistory = async () => {
  showConfirmModal("Delete ALL history? Cannot undo.", async () => {
    showProgressModal("Deleting...");
    try {
      const q = await getDocs(
        collection(db, `artifacts/${appId}/public/data/gatepasses`)
      );
      const batch = writeBatch(db);
      q.forEach((doc) => batch.delete(doc.ref));
      await batch.commit();
      hideProgressModal();
      showModal("Deleted all history.", "Success", true);
      fetchAndRenderHistory(true);
    } catch (e) {
      hideProgressModal();
      showModal("Failed to delete.");
    }
  });
};

const populateFilterDatalists = async () => {
  try {
    const q = await getDocs(
      collection(db, `artifacts/${appId}/public/data/master_data`)
    );
    const companies = new Set();
    const zones = new Set();
    const suppliers = new Set();
    q.forEach((doc) => {
      const d = doc.data();
      if (d.company) companies.add(d.company);
      if (d.zone1) zones.add(d.zone1);
      if (d.zone2) zones.add(d.zone2);
      if (d.supplier) suppliers.add(d.supplier);
    });

    const fill = (id, set) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.innerHTML = "";
      [...set].sort().forEach((v) => {
        const opt = document.createElement("option");
        opt.value = v;
        el.appendChild(opt);
      });
    };
    fill("history-company-list", companies);
    fill("history-zone-list", zones);
    fill("history-supplier-list", suppliers);
  } catch (e) {
    console.error("Filter population error", e);
  }
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

const populateUserDatalist = async () => {
  if (!db) return;
  const userDatalist = document.getElementById("username-list");
  if (!userDatalist) return;

  try {
    const usersCollectionRef = collection(
      db,
      `artifacts/${appId}/public/data/users`
    );
    const querySnapshot = await getDocs(usersCollectionRef);

    const fragment = document.createDocumentFragment();
    querySnapshot.forEach((doc) => {
      const option = document.createElement("option");
      option.value = doc.id;
      fragment.appendChild(option);
    });
    userDatalist.innerHTML = "";
    userDatalist.appendChild(fragment);
  } catch (error) {
    console.error("Error fetching usernames:", error);
  }
};

const handleLogin = async (e) => {
  e.preventDefault();
  const u = document.getElementById("username").value.trim().toUpperCase();
  const p = document.getElementById("password").value;
  try {
    const docSnap = await getDoc(
      doc(db, `artifacts/${appId}/public/data/users`, u)
    );
    if (
      docSnap.exists() &&
      (await hashPassword(p)) === docSnap.data().password
    ) {
      loggedInUser = { username: u, ...docSnap.data() };
      // Save session
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(loggedInUser));

      document.getElementById("login-modal").classList.add("hidden");
      updateUI();
      populateFilterDatalists();
      fetchAndRenderHistory(true);
      resetIdleTimer(); // Start timer
    } else {
      document.getElementById("login-error").textContent =
        "Invalid credentials.";
    }
  } catch (e) {
    console.error(e);
  }
};

const updateUI = () => {
  const userSessionView = document.getElementById("user-session-view");
  const deleteBtn = document.getElementById("delete-all-history-btn");

  if (loggedInUser) {
    document.getElementById("logged-in-username").textContent =
      loggedInUser.username;
    userSessionView.classList.remove("hidden");
    if (loggedInUser.username === "ADMIN") {
      deleteBtn.classList.remove("hidden");
    } else {
      deleteBtn.classList.add("hidden");
    }
  } else {
    // Don't force modal here, logic is in init/auth listener
  }
};

const handleLogout = () => {
  if (idleTimer) clearTimeout(idleTimer);
  sessionStorage.removeItem(SESSION_KEY);
  loggedInUser = null;
  window.location.href = "../index.html";
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
    fetchAndRenderUsers();
    populateUserDatalist();
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

  await populateUserDatalist();

  setupIdleListeners(); // Init listeners

  // Check for existing session immediately
  const storedUser = sessionStorage.getItem(SESSION_KEY);
  if (storedUser) {
    try {
      loggedInUser = JSON.parse(storedUser);
      updateUI();
      populateFilterDatalists();
      fetchAndRenderHistory(true);
      resetIdleTimer(); // Start timer from session load
    } catch (e) {
      console.error("Invalid session data");
      sessionStorage.removeItem(SESSION_KEY);
    }
  }

  document
    .getElementById("search-history-btn")
    .addEventListener("click", () => fetchAndRenderHistory(true));
  document
    .getElementById("load-more-history-btn")
    .addEventListener("click", () => fetchAndRenderHistory(false));
  document
    .getElementById("load-all-history-btn")
    .addEventListener("click", handleLoadAllHistory);
  document
    .getElementById("clear-load-history-btn")
    .addEventListener("click", handleClearLoad);
  document
    .getElementById("clear-history-filters-btn")
    .addEventListener("click", clearHistoryFilters);
  document
    .getElementById("export-history-csv-btn")
    .addEventListener("click", exportHistoryToCSV);
  document
    .getElementById("delete-all-history-btn")
    .addEventListener("click", handleDeleteAllHistory);
  document.getElementById("logout-btn").addEventListener("click", handleLogout);
  document.getElementById("login-form").addEventListener("submit", handleLogin);
  document
    .getElementById("modal-close-btn")
    .addEventListener("click", hideModal);

  document
    .getElementById("history-table-body")
    .addEventListener("click", (e) => {
      if (e.target.closest(".delete-gatepass-btn"))
        handleDeleteGatepass(e.target.closest(".delete-gatepass-btn"));
      if (e.target.closest(".edit-gatepass-btn"))
        handleEditGatepass(e.target.closest(".edit-gatepass-btn"));
      if (e.target.closest(".view-pdf-btn"))
        handleViewPdf(e.target.closest(".view-pdf-btn"));
    });

  onAuthStateChanged(auth, async (user) => {
    if (user) {
      if (!loggedInUser) {
        await populateFilterDatalists();
        document.getElementById("login-modal").classList.remove("hidden");
      }
    } else {
      if (typeof __initial_auth_token !== "undefined" && __initial_auth_token)
        await signInWithCustomToken(auth, __initial_auth_token);
      else await signInAnonymously(auth);
    }
  });

  // Change Password Listeners
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
};

document.addEventListener("DOMContentLoaded", init);