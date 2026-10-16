/* =====================================================================
   responsive.js - Automatic responsive helper (shared by every page)
   ---------------------------------------------------------------------
   Plain (non-module) script. It never changes the data or the business
   logic of a page - it only tags elements so responsive.css can lay the
   page out correctly on any screen size.

   What it does:
     1. Copies the <th> caption of every column into each <td> as
        data-label, so a wide table can be shown as stacked cards on a
        phone.
     2. Makes wide tables scroll horizontally on medium screens.
     3. Moves the fixed corner badges into the normal flow on a phone.
     4. Re-applies everything when a table is refilled by page scripts.

   Print markup (#print-version, #print-area, .print-only) is skipped.
   ===================================================================== */

(function () {
	"use strict";

	var EXCLUDE_SELECTOR =
		"#print-version, #print-area, .print-only, .no-responsive, [data-no-responsive]";
	var MIN_COLUMNS_FOR_CARDS = 3;
	var observedTables = new WeakSet();

	function isExcluded(el) {
		try {
			return !!(el.closest && el.closest(EXCLUDE_SELECTOR));
		} catch (e) {
			return false;
		}
	}

	/* Build one label per column index, expanding colspan. */
	function buildHeaderLabels(table) {
		var labels = [];
		var thead = table.tHead;
		if (!thead || !thead.rows.length) return labels;

		var row = thead.rows[thead.rows.length - 1];
		for (var i = 0; i < row.cells.length; i++) {
			var cell = row.cells[i];
			var clone = cell.cloneNode(true);
			var breaks = clone.querySelectorAll("br");
			for (var b = 0; b < breaks.length; b++) {
				breaks[b].parentNode.replaceChild(document.createTextNode(" "), breaks[b]);
			}
			var text = (clone.textContent || "").replace(/\s+/g, " ").trim();
			var span = parseInt(cell.getAttribute("colspan") || "1", 10) || 1;
			for (var s = 0; s < span; s++) {
				labels.push(text);
			}
		}
		return labels;
	}

	function labelSection(section, labels) {
		if (!section) return;
		for (var r = 0; r < section.rows.length; r++) {
			var cells = section.rows[r].cells;
			var columnIndex = 0;
			for (var c = 0; c < cells.length; c++) {
				var cell = cells[c];
				var label = labels[columnIndex] || "";
				if (cell.getAttribute("data-label") !== label) {
					cell.setAttribute("data-label", label);
				}
				columnIndex += parseInt(cell.getAttribute("colspan") || "1", 10) || 1;
			}
		}
	}

	function labelTable(table) {
		var labels = buildHeaderLabels(table);
		if (!labels.length) return;
		for (var i = 0; i < table.tBodies.length; i++) {
			labelSection(table.tBodies[i], labels);
		}
		labelSection(table.tFoot, labels);
	}

	/* Find an ancestor (max 3 levels) that already clips its content. */
	function findScrollParent(table) {
		var node = table.parentElement;
		var level = 0;
		while (node && level < 3) {
			var style = window.getComputedStyle(node);
			if (style.overflowX !== "visible" || style.overflowY !== "visible") {
				return node;
			}
			node = node.parentElement;
			level++;
		}
		return null;
	}

	function prepareTable(table) {
		if (isExcluded(table)) return;

		var labels = buildHeaderLabels(table);
		if (labels.length >= MIN_COLUMNS_FOR_CARDS) {
			table.classList.add("rsp-cards");
		}
		labelTable(table);

		var scrollParent = findScrollParent(table);
		if (scrollParent) {
			scrollParent.classList.add("rsp-scroll-x");
		} else if (
			table.parentElement &&
			!table.parentElement.classList.contains("rsp-table-scroll")
		) {
			var wrapper = document.createElement("div");
			wrapper.className = "rsp-table-scroll";
			table.parentElement.insertBefore(wrapper, table);
			wrapper.appendChild(table);
		}

		/* Re-label rows that page scripts add later. */
		if (!observedTables.has(table) && window.MutationObserver) {
			observedTables.add(table);
			var pending = false;
			var observer = new MutationObserver(function () {
				if (pending) return;
				pending = true;
				window.requestAnimationFrame(function () {
					pending = false;
					labelTable(table);
				});
			});
			for (var i = 0; i < table.tBodies.length; i++) {
				observer.observe(table.tBodies[i], { childList: true, subtree: true });
			}
			if (table.tFoot) {
				observer.observe(table.tFoot, { childList: true, subtree: true });
			}
		}
	}

	function tagFixedBadges() {
		var badges = document.querySelectorAll(".fixed.top-0, .fixed.top-2");
		for (var i = 0; i < badges.length; i++) {
			if (!isExcluded(badges[i])) {
				badges[i].classList.add("rsp-fixed-badge");
			}
		}
	}

	function tagPagePadding() {
		var blocks = document.querySelectorAll("body > div");
		for (var i = 0; i < blocks.length; i++) {
			var cls = blocks[i].className || "";
			if (typeof cls !== "string") continue;
			if (/(^|\s)p-(4|6|8)(\s|$)/.test(cls)) {
				blocks[i].classList.add("rsp-page-pad");
			}
		}
	}

	/* Rows of buttons / links share the width instead of overflowing. */
	function tagActionBars() {
		var candidates = document.querySelectorAll('div[class*="flex"]');
		for (var i = 0; i < candidates.length; i++) {
			var el = candidates[i];
			if (isExcluded(el)) continue;
			var children = el.children;
			if (children.length < 2) continue;
			var actionable = 0;
			for (var c = 0; c < children.length; c++) {
				var tag = children[c].tagName;
				if (tag === "BUTTON" || tag === "A") actionable++;
			}
			if (actionable === children.length) {
				el.classList.add("rsp-actions");
			}
		}
	}

	function run() {
		try {
			tagFixedBadges();
			tagPagePadding();
			tagActionBars();
			var tables = document.querySelectorAll("table");
			for (var i = 0; i < tables.length; i++) {
				prepareTable(tables[i]);
			}
		} catch (error) {
			console.warn("responsive.js:", error);
		}
	}

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", function () {
			window.setTimeout(run, 0);
		});
	} else {
		window.setTimeout(run, 0);
	}

	/* Expose a manual hook for pages that rebuild large parts of the DOM. */
	window.rspRefresh = run;
})();
