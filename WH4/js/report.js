import {
  signInAnonymously,
  onAuthStateChanged,
  signInWithCustomToken,
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import {
  collection,
  getDocs,
  query,
  where,
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// --- IMPORT จากไฟล์กลาง ---
import { auth, db, appId } from "./firebase-config.js";

let masterDataCache = { companies: new Set(), zones: new Set() };
let hasReportData = false;
let rawDocsCache = null; // last fetched Firestore docs, so Company/Zone/Search can re-filter instantly without another query
let searchDebounceTimer = null;

const showModal = (msg) => {
  document.getElementById("modal-message").textContent = msg;
  document.getElementById("modal-title").textContent = "Message";
  document.getElementById("alert-modal").classList.remove("hidden");
};
document
  .getElementById("modal-close-btn")
  .addEventListener("click", () =>
    document.getElementById("alert-modal").classList.add("hidden")
  );

const fetchMasterData = async () => {
  if (!db) return;
  try {
    const snap = await getDocs(
      collection(db, `artifacts/${appId}/public/data/master_data`)
    );
    snap.forEach((d) => {
      const data = d.data();
      if (data.company) masterDataCache.companies.add(data.company);
      // NOTE: only zone2 is ever saved onto a gatepass/supplier as "zone".
      // zone1 is a separate master-data grouping field and never appears
      // on actual gatepass records, so it must not be offered as a filter
      // here (it would only ever return zero results).
      if (data.zone2) masterDataCache.zones.add(data.zone2);
    });
    populateFilters();
  } catch (e) {
    console.error(e);
  }
};

const populateFilters = () => {
  const fill = (id, set) => {
    const el = document.getElementById(id);
    el.innerHTML = '<option value="all">All</option>';
    [...set].sort().forEach((v) => {
      const o = document.createElement("option");
      o.value = v;
      o.textContent = v;
      el.appendChild(o);
    });
  };
  fill("filter-company", masterDataCache.companies);
  fill("filter-zone", masterDataCache.zones);
};

const setFetchingState = (isFetching) => {
  const btn = document.getElementById("fetch-report-btn");
  btn.disabled = isFetching;
  btn.textContent = isFetching ? "Fetching..." : "Fetch Report";
  btn.classList.toggle("opacity-60", isFetching);
  btn.classList.toggle("cursor-not-allowed", isFetching);
};

const showTableMessage = (msg, isError = false) => {
  hasReportData = false;
  document.getElementById(
    "summary-report-table-body"
  ).innerHTML = `<tr><td colspan="10" class="py-4 text-center ${
    isError ? "text-red-500" : "text-gray-500"
  }">${msg}</td></tr>`;
  document.getElementById("summary-report-table-footer").innerHTML = "";
};

const getCurrentFilters = () => ({
  company: document.getElementById("filter-company").value,
  zone: document.getElementById("filter-zone").value,
  search: document.getElementById("filter-search").value.trim().toLowerCase(),
});

const handleFetchReport = async () => {
  const sDate = document.getElementById("start-date").value;
  const sTime = document.getElementById("start-time").value || "00:00";
  const eDate = document.getElementById("end-date").value;
  const eTime = document.getElementById("end-time").value || "23:59";
  const status = document.getElementById("filter-status").value;

  if (!sDate || !eDate) return showModal("Please select dates.");
  const start = new Date(`${sDate}T${sTime}`);
  const end = new Date(`${eDate}T${eTime}`);
  if (end < start) return showModal("End date cannot be before start date.");

  // Only filter the query itself by the date range (and status, which is
  // reliably present on every gatepass document). Company/Zone/Search are
  // NOT filtered here in the query: "Empty-IN" gatepasses (from
  // gatepass-in.js) never carry a top-level company/zone field, and even
  // "Empty-Out" gatepasses store company/zone per-supplier, not necessarily
  // as a single doc-wide value. Filtering with a doc-level where() on those
  // fields would silently drop records that legitimately match. Those
  // filters are instead applied client-side in renderReport below, against
  // the cached results, so changing them afterwards doesn't need a re-fetch.
  const constraints = [
    where("issueDate", ">=", start),
    where("issueDate", "<=", end),
  ];
  if (status !== "all") constraints.push(where("status", "==", status));

  setFetchingState(true);
  showTableMessage("Loading report...");
  try {
    const q = query(
      collection(db, `artifacts/${appId}/public/data/gatepasses`),
      ...constraints
    );
    const snap = await getDocs(q);
    rawDocsCache = snap.docs;
    renderReport(rawDocsCache, getCurrentFilters());
  } catch (e) {
    console.error(e);
    rawDocsCache = null;
    showTableMessage("Failed to load report.", true);
    showModal(
      "Fetch failed. " +
        (e?.code === "failed-precondition"
          ? "This query needs a Firestore index — check the browser console for a link to create it."
          : e?.message || "Please try again.")
    );
  } finally {
    setFetchingState(false);
  }
};

const rerenderFromCache = () => {
  if (!rawDocsCache) return; // nothing fetched yet; Fetch Report must run first
  renderReport(rawDocsCache, getCurrentFilters());
};

const renderReport = (
  docs,
  filters = { company: "all", zone: "all", search: "" }
) => {
  const supTotals = {};
  const zoneTotals = {};
  const grand = { ptb: 0, cpb: 0, mov: 0, stp: 0, pl: 0, rp: 0 };
  const keys = ["ptb", "cpb", "mov", "stp", "pl", "rp"];
  const search = (filters.search || "").trim().toLowerCase();
  let matchedRows = 0;

  docs.forEach((doc) => {
    const d = doc.data();
    // Fields that live on the gatepass doc itself, searchable regardless of
    // which supplier row they end up matching against.
    const docSearchable = [
      d.truckNo,
      d.driverName,
      d.gatepassNo,
      d.sealNo,
      d.status,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    (d.suppliers || []).forEach((s) => {
      // Company/Zone live on each supplier row, since a single "Empty-IN"
      // gatepass can bundle several companies/zones together.
      const company = s?.company || d.company;
      const zone = s?.zone || d.zone;
      if (!s || !s.name || !company || !zone) return;
      if (filters.company !== "all" && company !== filters.company) return;
      if (filters.zone !== "all" && zone !== filters.zone) return;

      if (search) {
        // Matches Supplier, Truck No, Driver, Gatepass No, Seal No, Status,
        // Company, or Zone — "search everything" as requested.
        const rowSearchable =
          docSearchable +
          " " +
          [s.name, company, zone].join(" ").toLowerCase();
        if (!rowSearchable.includes(search)) return;
      }

      matchedRows++;
      const k = `${company}|${zone}|${s.name}|${d.status || "N/A"}`;
      if (!supTotals[k])
        supTotals[k] = {
          status: d.status || "N/A",
          company,
          zone,
          supplier: s.name,
          ptb: 0,
          cpb: 0,
          mov: 0,
          stp: 0,
          pl: 0,
          rp: 0,
        };
      if (!zoneTotals[zone])
        zoneTotals[zone] = { ptb: 0, cpb: 0, mov: 0, stp: 0, pl: 0, rp: 0 };
      keys.forEach((key) => {
        const v = parseFloat(s[key]) || 0;
        supTotals[k][key] += v;
        zoneTotals[zone][key] += v;
        grand[key] += v;
      });
    });
  });

  const tbody = document.getElementById("summary-report-table-body");
  const tfoot = document.getElementById("summary-report-table-footer");
  tbody.innerHTML = "";
  tfoot.innerHTML = "";

  if (matchedRows === 0) {
    showTableMessage("No data found for the selected filters.");
    updateResultCount(0);
    return;
  }

  const sorted = Object.values(supTotals).sort(
    (a, b) =>
      a.zone.localeCompare(b.zone) ||
      a.company.localeCompare(b.company) ||
      a.supplier.localeCompare(b.supplier) ||
      a.status.localeCompare(b.status)
  );

  sorted.forEach((d) => {
    const tr = document.createElement("tr");
    tr.className = "border-b border-gray-200 hover:bg-gray-50";
    const statusBadge =
      d.status === "Empty-Out"
        ? `<span class="px-2 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-700">${d.status}</span>`
        : d.status === "Empty-IN"
        ? `<span class="px-2 py-1 rounded-full text-xs font-semibold bg-green-100 text-green-700">${d.status}</span>`
        : `<span class="px-2 py-1 rounded-full text-xs font-semibold bg-gray-100 text-gray-700">${d.status}</span>`;
    tr.innerHTML =
      `<td class="py-3 px-4">${statusBadge}</td><td class="py-3 px-4">${d.company}</td><td class="py-3 px-4">${d.zone}</td><td class="py-3 px-4">${d.supplier}</td>` +
      keys
        .map((k) => `<td class="py-3 px-4">${d[k].toLocaleString()}</td>`)
        .join("");
    tbody.appendChild(tr);
  });

  Object.keys(zoneTotals)
    .sort()
    .forEach((z) => {
      const tr = document.createElement("tr");
      tr.className = "bg-indigo-50";
      tr.innerHTML =
        `<td class="py-3 px-4 text-right font-semibold" colspan="4">Zone: ${z}</td>` +
        keys
          .map(
            (k) =>
              `<td class="py-3 px-4">${zoneTotals[z][k].toLocaleString()}</td>`
          )
          .join("");
      tfoot.appendChild(tr);
    });

  const gr = document.createElement("tr");
  gr.className = "bg-indigo-200 font-bold";
  gr.innerHTML =
    `<td class="py-3 px-4 text-right" colspan="4">Grand Total:</td>` +
    keys.map((k) => `<td class="py-3 px-4">${grand[k].toLocaleString()}</td>`).join("");
  tfoot.appendChild(gr);

  hasReportData = true;
  updateResultCount(sorted.length);
};

// Dates are always shown as DD/MM/YYYY, whatever the browser language is.
const toDisplayDate = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
};

const updateResultCount = (count) => {
  const el = document.getElementById("report-result-count");
  if (!el) return;
  const from = toDisplayDate(document.getElementById("start-date").value);
  const to = toDisplayDate(document.getElementById("end-date").value);
  const range = from && to ? ` \u00b7 ${from} - ${to}` : "";
  el.textContent =
    count > 0 ? `${count.toLocaleString()} row(s) found${range}` : "";
};

const exportCSV = () => {
  if (!hasReportData) {
    return showModal("There is no report data to export yet.");
  }
  const bodyRows = document.querySelectorAll(
    "#summary-report-table-body tr"
  );

  const rows = [];
  rows.push([
    "Status",
    "Company",
    "Zone",
    "Supplier",
    "PTB",
    "CPB",
    "MOV",
    "STP",
    "PL",
    "RP",
  ]);
  bodyRows.forEach((tr) => {
    rows.push(
      [...tr.querySelectorAll("td")].map((td) => td.textContent.trim())
    );
  });
  // Include the zone subtotal / grand total rows so the CSV matches what's
  // shown on screen.
  document
    .querySelectorAll("#summary-report-table-footer tr")
    .forEach((tr) => {
      const cells = [...tr.querySelectorAll("td")];
      const label = cells[0].textContent.trim();
      const values = cells.slice(1).map((td) => td.textContent.trim());
      rows.push(["", "", "", label, ...values]);
    });

  const csv =
    "\uFEFF" + rows.map((r) => r.map((c) => `"${c}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  const sDate = document.getElementById("start-date").value || "start";
  const eDate = document.getElementById("end-date").value || "end";
  a.download = `report_${sDate}_to_${eDate}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
};

document.addEventListener("DOMContentLoaded", () => {
  if (!db) return;
  fetchMasterData();
  showTableMessage("Select a date range and click Fetch Report.");

  document
    .getElementById("fetch-report-btn")
    .addEventListener("click", handleFetchReport);
  document
    .getElementById("clear-report-filters-btn")
    .addEventListener("click", () => {
      document
        .querySelectorAll(
          "#summary-report-page input, #summary-report-page select"
        )
        .forEach((i) => (i.value = i.tagName === "SELECT" ? "all" : ""));
      rawDocsCache = null;
      showTableMessage("Select a date range and click Fetch Report.");
      updateResultCount(0);
    });
  document
    .getElementById("export-report-csv-btn")
    .addEventListener("click", exportCSV);
  document
    .getElementById("print-report-btn")
    .addEventListener("click", () => window.print());

  // Company / Zone re-filter instantly against the last fetched results —
  // no need to hit Firestore again just to narrow down what's already loaded.
  document
    .getElementById("filter-company")
    .addEventListener("change", rerenderFromCache);
  document
    .getElementById("filter-zone")
    .addEventListener("change", rerenderFromCache);
  // Free-text search (Supplier / Truck No / Driver / Gatepass No / Seal No /
  // Company / Zone / Status) — debounced so it doesn't re-render on every
  // keystroke.
  document.getElementById("filter-search").addEventListener("input", () => {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(rerenderFromCache, 250);
  });

  onAuthStateChanged(auth, async (u) => {
    if (!u) {
      if (typeof __initial_auth_token !== "undefined")
        await signInWithCustomToken(auth, __initial_auth_token);
      else await signInAnonymously(auth);
    }
  });
});