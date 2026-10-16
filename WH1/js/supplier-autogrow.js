/* =====================================================================
   supplier-autogrow.js - Gate Pass IN: rows grow by themselves
   ---------------------------------------------------------------------
   The form starts with the usual 30 supplier rows. As soon as the last
   row is in use, one more empty row is appended, so there is no 30-line
   ceiling any more and nothing has to be clicked.

   A new row is cloned from the last one, so it always matches whatever
   markup gatepass-in.js builds; only the row number, the data-index and
   the datalist ids are renumbered and the fields are cleared.
   ===================================================================== */

(function () {
	"use strict";

	var MAX_ROWS = 200; // hard stop, just so a stuck event cannot grow forever

	function value(row, selector) {
		var el = row.querySelector(selector);
		return el ? String(el.value || "").trim() : "";
	}

	function isRowInUse(row) {
		if (!row) return false;
		if (value(row, ".gatepassIN_companyInput")) return true;
		if (value(row, ".gatepassIN_supplierInput")) return true;
		var quantities = row.querySelectorAll(".gatepassIN_quantityInput");
		for (var i = 0; i < quantities.length; i++) {
			if (String(quantities[i].value || "").trim() !== "") return true;
		}
		return false;
	}

	function copyOptions(fromList, toList) {
		if (!fromList || !toList) return;
		toList.innerHTML = "";
		var options = fromList.querySelectorAll("option");
		for (var i = 0; i < options.length; i++) {
			var option = document.createElement("option");
			option.value = options[i].value;
			toList.appendChild(option);
		}
	}

	function appendRow(tbody) {
		var rows = tbody.rows;
		var last = rows[rows.length - 1];
		if (!last) return null;

		var index = rows.length;
		var row = last.cloneNode(true);

		if (row.cells[0]) row.cells[0].textContent = index + 1 + ".";

		var inputs = row.querySelectorAll("input");
		for (var i = 0; i < inputs.length; i++) {
			var input = inputs[i];
			input.value = "";
			input.classList.remove("border-red-500", "border-green-500");
			if (input.hasAttribute("data-index")) {
				input.setAttribute("data-index", String(index));
			}
			if (input.classList.contains("gatepassIN_companyInput")) {
				input.setAttribute("list", "gatepassIN_companyList-" + index);
				input.disabled = false;
			} else if (input.classList.contains("gatepassIN_supplierInput")) {
				input.setAttribute("list", "gatepassIN_supplierList-" + index);
				input.disabled = true;
			} else {
				input.disabled = true;
			}
		}

		var error = row.querySelector(".gatepassIN_inlineError");
		if (error) {
			error.textContent = "";
			error.classList.add("hidden");
		}

		var companyList = row.querySelector('datalist[id^="gatepassIN_companyList"]');
		var supplierList = row.querySelector(
			'datalist[id^="gatepassIN_supplierList"]'
		);
		var sourceCompanyList = last.querySelector(
			'datalist[id^="gatepassIN_companyList"]'
		);
		if (companyList) {
			companyList.id = "gatepassIN_companyList-" + index;
			copyOptions(sourceCompanyList, companyList);
		}
		if (supplierList) {
			supplierList.id = "gatepassIN_supplierList-" + index;
			supplierList.innerHTML = "";
		}

		tbody.appendChild(row);
		return row;
	}

	function grow(tbody) {
		var guard = 0;
		while (
			tbody.rows.length < MAX_ROWS &&
			isRowInUse(tbody.rows[tbody.rows.length - 1]) &&
			guard++ < 5
		) {
			if (!appendRow(tbody)) break;
		}
	}

	function start() {
		var tbody = document.getElementById("gatepassIN_supplierTableBody");
		if (!tbody) return;

		/* Runs after gatepass-in.js's own handler, so the row it may have
		   just enabled is already up to date. */
		tbody.addEventListener("input", function () {
			grow(tbody);
		});
		tbody.addEventListener("change", function () {
			grow(tbody);
		});

		/* Opening an existing gatepass rebuilds the table; if it filled the
		   last row, make room for one more straight away. */
		if (window.MutationObserver) {
			new MutationObserver(function () {
				window.setTimeout(function () {
					grow(tbody);
				}, 0);
			}).observe(tbody, { childList: true });
		}

		window.setTimeout(function () {
			grow(tbody);
		}, 600);
	}

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", function () {
			window.setTimeout(start, 0);
		});
	} else {
		window.setTimeout(start, 0);
	}
})();
