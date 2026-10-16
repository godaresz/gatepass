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
      if (data.zone1) masterDataCache.zones.add(data.zone1);
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

const handleFetchReport = async () => {
  const sDate = document.getElementById("start-date").value;
  const sTime = document.getElementById("start-time").value || "00:00";
  const eDate = document.getElementById("end-date").value;
  const eTime = document.getElementById("end-time").value || "23:59";
  const comp = document.getElementById("filter-company").value;
  const zone = document.getElementById("filter-zone").value;

  if (!sDate || !eDate) return showModal("Please select dates.");
  const start = new Date(`${sDate}T${sTime}`);
  const end = new Date(`${eDate}T${eTime}`);
  if (end < start) return showModal("End date cannot be before start date.");

  const constraints = [
    where("issueDate", ">=", start),
    where("issueDate", "<=", end),
  ];
  if (comp !== "all") constraints.push(where("company", "==", comp));
  if (zone !== "all") constraints.push(where("zone", "==", zone));

  try {
    const q = query(
      collection(db, `artifacts/${appId}/public/data/gatepasses`),
      ...constraints
    );
    const snap = await getDocs(q);
    renderReport(snap.docs);
  } catch (e) {
    console.error(e);
    showModal("Fetch failed.");
  }
};

const renderReport = (docs) => {
  const supTotals = {};
  const zoneTotals = {};
  const grand = { ptb: 0, cpb: 0, mov: 0, stp: 0, pl: 0, rp: 0 };
  const keys = ["ptb", "cpb", "mov", "stp", "pl", "rp"];

  docs.forEach((doc) => {
    const d = doc.data();
    (d.suppliers || []).forEach((s) => {
      if (s && s.name && d.company && d.zone) {
        const k = `${d.company}|${d.zone}|${s.name}|${d.status || "N/A"}`;
        if (!supTotals[k])
          supTotals[k] = {
            status: d.status || "N/A",
            company: d.company,
            zone: d.zone,
            supplier: s.name,
            ptb: 0,
            cpb: 0,
            mov: 0,
            stp: 0,
            pl: 0,
            rp: 0,
          };
        if (!zoneTotals[d.zone])
          zoneTotals[d.zone] = { ptb: 0, cpb: 0, mov: 0, stp: 0, pl: 0, rp: 0 };
        keys.forEach((key) => {
          const v = parseFloat(s[key]) || 0;
          supTotals[k][key] += v;
          zoneTotals[d.zone][key] += v;
          grand[key] += v;
        });
      }
    });
  });

  const tbody = document.getElementById("summary-report-table-body");
  tbody.innerHTML = "";
  const sorted = Object.values(supTotals).sort(
    (a, b) =>
      a.status.localeCompare(b.status) || a.company.localeCompare(b.company)
  );

  sorted.forEach((d) => {
    const tr = document.createElement("tr");
    tr.className = "border-b border-gray-200";
    tr.innerHTML =
      `<td class="py-3 px-4">${d.status}</td><td class="py-3 px-4">${d.company}</td><td class="py-3 px-4">${d.zone}</td><td class="py-3 px-4">${d.supplier}</td>` +
      keys.map((k) => `<td class="py-3 px-4">${d[k]}</td>`).join("");
    tbody.appendChild(tr);
  });

  const tfoot = document.getElementById("summary-report-table-footer");
  tfoot.innerHTML = "";
  Object.keys(zoneTotals)
    .sort()
    .forEach((z) => {
      const tr = document.createElement("tr");
      tr.className = "bg-indigo-50";
      tr.innerHTML =
        `<td class="py-3 px-4 text-right font-semibold" colspan="4">Zone: ${z}</td>` +
        keys
          .map((k) => `<td class="py-3 px-4">${zoneTotals[z][k]}</td>`)
          .join("");
      tfoot.appendChild(tr);
    });

  const gr = document.createElement("tr");
  gr.className = "bg-indigo-200 font-bold";
  gr.innerHTML =
    `<td class="py-3 px-4 text-right" colspan="4">Grand Total:</td>` +
    keys.map((k) => `<td class="py-3 px-4">${grand[k]}</td>`).join("");
  tfoot.appendChild(gr);
};

const exportCSV = () => {
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
  document.querySelectorAll("#summary-report-table-body tr").forEach((tr) => {
    rows.push([...tr.querySelectorAll("td")].map((td) => td.textContent));
  });
  const csv =
    "\uFEFF" + rows.map((r) => r.map((c) => `"${c}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `report_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
};

document.addEventListener("DOMContentLoaded", () => {
  if (!db) return;
  fetchMasterData();
  document
    .getElementById("fetch-report-btn")
    .addEventListener("click", handleFetchReport);
  document
    .getElementById("clear-report-filters-btn")
    .addEventListener("click", () => {
      document
        .querySelectorAll("input, select")
        .forEach((i) => (i.value = i.tagName === "SELECT" ? "all" : ""));
      document.getElementById("summary-report-table-body").innerHTML = "";
      document.getElementById("summary-report-table-footer").innerHTML = "";
    });
  document
    .getElementById("export-report-csv-btn")
    .addEventListener("click", exportCSV);

  onAuthStateChanged(auth, async (u) => {
    if (!u) {
      if (typeof __initial_auth_token !== "undefined")
        await signInWithCustomToken(auth, __initial_auth_token);
      else await signInAnonymously(auth);
    }
  });
});