/* =====================================================================
   date-ddmmyyyy.js - Show every date field as DD/MM/YYYY (24-hour clock)
   ---------------------------------------------------------------------
   A native <input type="date"> always follows the browser language, so on
   an English browser it shows MM/DD/YYYY. This script puts a DD/MM/YYYY
   text box in front of each date field and keeps the native field (with
   its original id and its YYYY-MM-DD value) in sync behind it, so the
   page scripts keep reading exactly what they read before.

   The calendar button still opens the browser's own date picker.
   ===================================================================== */

(function () {
	"use strict";

	function pad(value) {
		return String(value).padStart(2, "0");
	}

	function isoToDisplay(iso, withTime) {
		var m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(
			String(iso || "")
		);
		if (!m) return "";
		var date = m[3] + "/" + m[2] + "/" + m[1];
		if (!withTime) return date;
		return date + " " + (m[4] || "00") + ":" + (m[5] || "00");
	}

	function displayToIso(value, withTime) {
		var raw = String(value || "").trim();
		var m = withTime
			? /^(\d{1,2})\/(\d{1,2})\/(\d{4})[ T](\d{1,2}):(\d{2})$/.exec(raw)
			: /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw);
		if (!m) return "";

		var day = Number(m[1]);
		var month = Number(m[2]);
		var year = Number(m[3]);
		var hours = withTime ? Number(m[4]) : 0;
		var minutes = withTime ? Number(m[5]) : 0;
		if (hours > 23 || minutes > 59) return "";

		var date = new Date(year, month - 1, day);
		if (
			date.getFullYear() !== year ||
			date.getMonth() !== month - 1 ||
			date.getDate() !== day
		) {
			return "";
		}

		var iso = year + "-" + pad(month) + "-" + pad(day);
		return withTime ? iso + "T" + pad(hours) + ":" + pad(minutes) : iso;
	}

	/* 25122026 -> 25/12/2026, 251220261430 -> 25/12/2026 14:30 */
	function autoFormat(value, withTime) {
		var digits = String(value || "")
			.replace(/\D/g, "")
			.slice(0, withTime ? 12 : 8);
		if (digits.length <= 2) return digits;
		var out = digits.slice(0, 2) + "/" + digits.slice(2, 4);
		if (digits.length <= 4) return out;
		out += "/" + digits.slice(4, 8);
		if (digits.length <= 8) return out;
		out += " " + digits.slice(8, 10);
		if (digits.length <= 10) return out;
		return out + ":" + digits.slice(10, 12);
	}

	function upgrade(input) {
		if (input.dataset.ddmmReady) return;
		input.dataset.ddmmReady = "1";

		var withTime = input.type === "datetime-local";
		var mask = withTime ? "DD/MM/YYYY HH:mm" : "DD/MM/YYYY";

		var field = document.createElement("div");
		field.className = "ddmm-field";
		input.parentNode.insertBefore(field, input);

		var text = document.createElement("input");
		text.type = "text";
		text.inputMode = "numeric";
		text.autocomplete = "off";
		text.placeholder = mask;
		text.maxLength = mask.length;
		text.className = input.className + " ddmm-text";
		var label = input.id
			? document.querySelector('label[for="' + input.id + '"]')
			: null;
		text.setAttribute(
			"aria-label",
			(label ? label.textContent.trim() : "Date") + " (" + mask + ")"
		);

		/* A span, not a <button>: pages that walk the form with
		   Enter/Tab list real buttons, and the calendar icon must not
		   become a stop on the way to the next field. */
		var button = document.createElement("span");
		button.setAttribute("role", "button");
		button.tabIndex = -1;
		button.className = "ddmm-picker-btn";
		button.title = "เลือกวันที่";
		button.setAttribute("aria-label", "เลือกวันที่");
		button.innerHTML =
			'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 11h18"/></svg>';

		/* The native field is kept first in the DOM so that scripts walking
		   the form (Enter-to-next-field) still reach this position, and it
		   hands focus straight over to the text box. */
		field.appendChild(input);
		field.appendChild(text);
		field.appendChild(button);
		input.classList.add("ddmm-native");
		input.tabIndex = -1;

		var openingPicker = false;
		input.addEventListener("focus", function () {
			if (openingPicker) return;
			text.focus();
			if (text.select) text.select();
		});

		text.value = isoToDisplay(input.value, withTime);

		var commit = function () {
			var raw = text.value.trim();
			if (!raw) {
				text.classList.remove("ddmm-invalid");
				if (input.value) {
					input.value = "";
					input.dispatchEvent(new Event("change", { bubbles: true }));
				}
				return;
			}
			var iso = displayToIso(raw, withTime);
			if (!iso) {
				text.classList.add("ddmm-invalid");
				return;
			}
			text.classList.remove("ddmm-invalid");
			text.value = isoToDisplay(iso, withTime);
			if (input.value !== iso) {
				input.value = iso;
				input.dispatchEvent(new Event("input", { bubbles: true }));
				input.dispatchEvent(new Event("change", { bubbles: true }));
			}
		};

		text.addEventListener("input", function () {
			var formatted = autoFormat(text.value, withTime);
			if (formatted !== text.value) text.value = formatted;
			text.classList.remove("ddmm-invalid");
			if (text.value.length === mask.length) commit();
		});
		text.addEventListener("change", commit);
		text.addEventListener("blur", commit);

		input.addEventListener("change", function () {
			text.value = isoToDisplay(input.value, withTime);
			text.classList.remove("ddmm-invalid");
		});

		/* The browser's own picker follows the browser language and shows
		   AM/PM, so this calendar is drawn here instead: always DD/MM/YYYY
		   with a 24-hour clock. */
		var calendar = null;
		var viewYear = 0;
		var viewMonth = 0;

		var limitToDay = function (attr) {
			var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(input[attr] || ""));
			return m
				? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime()
				: null;
		};

		var currentValue = function () {
			var iso = input.value;
			var m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(
				String(iso || "")
			);
			if (!m) return null;
			return new Date(
				Number(m[1]),
				Number(m[2]) - 1,
				Number(m[3]),
				Number(m[4] || 0),
				Number(m[5] || 0)
			);
		};

		var applyDate = function (date) {
			var iso =
				date.getFullYear() +
				"-" +
				pad(date.getMonth() + 1) +
				"-" +
				pad(date.getDate());
			if (withTime) {
				iso += "T" + pad(date.getHours()) + ":" + pad(date.getMinutes());
			}
			text.value = isoToDisplay(iso, withTime);
			text.classList.remove("ddmm-invalid");
			if (input.value !== iso) {
				input.value = iso;
				input.dispatchEvent(new Event("input", { bubbles: true }));
				input.dispatchEvent(new Event("change", { bubbles: true }));
			}
		};

		var closeCalendar = function () {
			if (!calendar) return;
			calendar.remove();
			calendar = null;
			document.removeEventListener("mousedown", onOutside, true);
			document.removeEventListener("keydown", onEscape, true);
		};

		var onOutside = function (e) {
			if (calendar && !field.contains(e.target)) closeCalendar();
		};

		var onEscape = function (e) {
			if (e.key === "Escape") closeCalendar();
		};

		var buildSelect = function (className, count, selected) {
			var select = document.createElement("select");
			select.className = className;
			for (var i = 0; i < count; i++) {
				var option = document.createElement("option");
				option.value = String(i);
				option.textContent = pad(i);
				if (i === selected) option.selected = true;
				select.appendChild(option);
			}
			return select;
		};

		var MONTHS = [
			"January", "February", "March", "April", "May", "June",
			"July", "August", "September", "October", "November", "December",
		];
		var WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

		var renderCalendar = function () {
			if (!calendar) return;
			calendar.innerHTML = "";

			var minDay = limitToDay("min");
			var maxDay = limitToDay("max");
			var selected = currentValue();
			var today = new Date();

			var head = document.createElement("div");
			head.className = "ddmm-cal-head";
			var prev = document.createElement("span");
			prev.className = "ddmm-cal-nav";
			prev.setAttribute("role", "button");
			prev.textContent = "\u2039";
			var title = document.createElement("span");
			title.className = "ddmm-cal-title";
			title.textContent = MONTHS[viewMonth] + " " + viewYear;
			var next = document.createElement("span");
			next.className = "ddmm-cal-nav";
			next.setAttribute("role", "button");
			next.textContent = "\u203a";
			prev.addEventListener("click", function () {
				viewMonth--;
				if (viewMonth < 0) {
					viewMonth = 11;
					viewYear--;
				}
				renderCalendar();
			});
			next.addEventListener("click", function () {
				viewMonth++;
				if (viewMonth > 11) {
					viewMonth = 0;
					viewYear++;
				}
				renderCalendar();
			});
			head.appendChild(prev);
			head.appendChild(title);
			head.appendChild(next);
			calendar.appendChild(head);

			var grid = document.createElement("div");
			grid.className = "ddmm-cal-grid";
			WEEKDAYS.forEach(function (name) {
				var cell = document.createElement("span");
				cell.className = "ddmm-cal-dow";
				cell.textContent = name;
				grid.appendChild(cell);
			});

			var first = new Date(viewYear, viewMonth, 1);
			var start = first.getDay();
			var daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
			for (var b = 0; b < start; b++) {
				grid.appendChild(document.createElement("span"));
			}

			for (var day = 1; day <= daysInMonth; day++) {
				(function (day) {
					var cellDate = new Date(viewYear, viewMonth, day);
					var stamp = cellDate.getTime();
					var cell = document.createElement("span");
					cell.className = "ddmm-cal-day";
					cell.textContent = String(day);

					if (
						(minDay !== null && stamp < minDay) ||
						(maxDay !== null && stamp > maxDay)
					) {
						cell.classList.add("ddmm-cal-disabled");
					} else {
						cell.addEventListener("click", function () {
							var hours = 0;
							var minutes = 0;
							if (withTime) {
								hours = Number(
									calendar.querySelector(".ddmm-cal-hour").value
								);
								minutes = Number(
									calendar.querySelector(".ddmm-cal-minute").value
								);
							}
							applyDate(
								new Date(viewYear, viewMonth, day, hours, minutes)
							);
							closeCalendar();
						});
					}

					if (
						today.getFullYear() === viewYear &&
						today.getMonth() === viewMonth &&
						today.getDate() === day
					) {
						cell.classList.add("ddmm-cal-today");
					}
					if (
						selected &&
						selected.getFullYear() === viewYear &&
						selected.getMonth() === viewMonth &&
						selected.getDate() === day
					) {
						cell.classList.add("ddmm-cal-selected");
					}
					grid.appendChild(cell);
				})(day);
			}
			calendar.appendChild(grid);

			if (withTime) {
				var timeRow = document.createElement("div");
				timeRow.className = "ddmm-cal-time";
				var label = document.createElement("span");
				label.textContent = "เวลา";
				var base = selected || new Date();
				var hour = buildSelect("ddmm-cal-hour", 24, base.getHours());
				var colon = document.createElement("span");
				colon.textContent = ":";
				var minute = buildSelect("ddmm-cal-minute", 60, base.getMinutes());

				var syncTime = function () {
					var current = currentValue();
					if (!current) return;
					current.setHours(Number(hour.value), Number(minute.value), 0, 0);
					applyDate(current);
				};
				hour.addEventListener("change", syncTime);
				minute.addEventListener("change", syncTime);

				timeRow.appendChild(label);
				timeRow.appendChild(hour);
				timeRow.appendChild(colon);
				timeRow.appendChild(minute);
				calendar.appendChild(timeRow);
			}

			var foot = document.createElement("div");
			foot.className = "ddmm-cal-foot";
			var clear = document.createElement("span");
			clear.className = "ddmm-cal-link";
			clear.setAttribute("role", "button");
			clear.textContent = "ล้าง";
			clear.addEventListener("click", function () {
				text.value = "";
				text.classList.remove("ddmm-invalid");
				if (input.value) {
					input.value = "";
					input.dispatchEvent(new Event("input", { bubbles: true }));
					input.dispatchEvent(new Event("change", { bubbles: true }));
				}
				closeCalendar();
			});
			var now = document.createElement("span");
			now.className = "ddmm-cal-link";
			now.setAttribute("role", "button");
			now.textContent = withTime ? "ตอนนี้" : "วันนี้";
			now.addEventListener("click", function () {
				var stamp = new Date();
				if (!withTime) stamp.setHours(0, 0, 0, 0);
				applyDate(stamp);
				closeCalendar();
			});
			foot.appendChild(clear);
			foot.appendChild(now);
			calendar.appendChild(foot);
		};

		var openCalendar = function () {
			if (calendar) {
				closeCalendar();
				return;
			}
			var selected = currentValue() || new Date();
			viewYear = selected.getFullYear();
			viewMonth = selected.getMonth();

			calendar = document.createElement("div");
			calendar.className = "ddmm-cal no-print";
			field.appendChild(calendar);
			renderCalendar();

			document.addEventListener("mousedown", onOutside, true);
			document.addEventListener("keydown", onEscape, true);
		};

		button.addEventListener("click", openCalendar);

		/* Other scripts may clear the native field directly (the Clear
		   button), so keep the text box in step with it. */
		window.setInterval(function () {
			var expected = isoToDisplay(input.value, withTime);
			if (
				document.activeElement !== text &&
				!text.classList.contains("ddmm-invalid") &&
				text.value !== expected
			) {
				text.value = expected;
			}
		}, 400);
	}

	function run() {
		var inputs = document.querySelectorAll(
			'input[type="date"], input[type="datetime-local"]'
		);
		for (var i = 0; i < inputs.length; i++) {
			try {
				upgrade(inputs[i]);
			} catch (error) {
				console.warn("date-ddmmyyyy.js:", error);
			}
		}
	}

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", run);
	} else {
		run();
	}
})();
