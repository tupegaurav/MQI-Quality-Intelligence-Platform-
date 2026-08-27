/* ============================================================
   MQI — Manufacturing Quality Inspection
   Vanilla JS, no build step, no framework.
   Sections: config, dom refs, combobox, validation & readout,
   submit/webhook, history & stats, export, theme.
   ============================================================ */

(() => {
  "use strict";

  /* ---------------- Config ---------------- */
  const PART_OPTIONS = [
    "TVS FRONT CALIPER", "K-17 FRONT CALIPER", "REJ-C MASTER CYL", "ACPD CALIPER",
    "HERO ADHG CALIPER", "HONDA UNICORN CALIPER", "CANISTER K10", "N-TOEQ MASTER CYL",
    "TVS FRONT MASTER CYLINDER", "HERO ABSR MASTER CYL", "ADJR MASTER CYLINDER",
    "ADHG MASTER CYLINDER", "HONDA UNICORN MASTER CYLINDER", "H105 M/CYL", "PULSER HOLDER BRACKET"
  ];

  const WEBHOOK_URL = "https://gauravai.app.n8n.cloud/webhook/mauli-inspection";
  const THEME_KEY = "mqi-theme";
  const HISTORY_KEY = "mqi-history";
  const HISTORY_LIMIT = 25;
  const REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------------- DOM refs ---------------- */
  const $ = (id) => document.getElementById(id);
  const form = $("inspectionForm");
  const partNameInput = $("partName");
  const partNameClear = $("partNameClear");
  const partNameList = $("partNameListbox");
  const checkQty = $("checkQty");
  const okQty = $("okQty");
  const rejQty = $("rejQty");
  const reworkQty = $("reworkQty");
  const inspectorName = $("inspectorName");
  const remarks = $("remarks");

  let record = null;
  let submitting = false;
  let exporting = false;
  let partNameValue = ""; // canonical selected part, source of truth for submission

  /* ================= Combobox: searchable part picker ================= */
  let comboOptions = [];
  let activeIndex = -1;
  let comboOpen = false;

  function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", "\"": "&quot;" }[char]));
  }

  function highlightMatch(text, query) {
    if (!query) return escapeHtml(text);
    const idx = text.toLowerCase().indexOf(query.toLowerCase());
    if (idx === -1) return escapeHtml(text);
    return (
      escapeHtml(text.slice(0, idx)) +
      "<mark>" + escapeHtml(text.slice(idx, idx + query.length)) + "</mark>" +
      escapeHtml(text.slice(idx + query.length))
    );
  }

  function renderCombo(query) {
    const q = query.trim();
    comboOptions = q
      ? PART_OPTIONS.filter((p) => p.toLowerCase().includes(q.toLowerCase()))
      : PART_OPTIONS.slice();

    if (comboOptions.length === 0) {
      partNameList.innerHTML = `<li class="combobox-empty">No parts match “${escapeHtml(q)}”.</li>`;
    } else {
      partNameList.innerHTML = comboOptions
        .map((part, i) => `<li id="combo-opt-${i}" role="option" class="combobox-option" data-value="${escapeHtml(part)}" aria-selected="false">${highlightMatch(part, q)}</li>`)
        .join("");
    }
    activeIndex = -1;
  }

  function openCombo() {
    comboOpen = true;
    partNameList.classList.remove("hidden");
    partNameInput.setAttribute("aria-expanded", "true");
  }

  function closeCombo() {
    comboOpen = false;
    partNameList.classList.add("hidden");
    partNameInput.setAttribute("aria-expanded", "false");
    partNameInput.removeAttribute("aria-activedescendant");
    activeIndex = -1;
  }

  function setActive(index) {
    const items = partNameList.querySelectorAll(".combobox-option");
    items.forEach((el) => el.classList.remove("is-active"));
    if (index >= 0 && items[index]) {
      items[index].classList.add("is-active");
      items[index].scrollIntoView({ block: "nearest" });
      partNameInput.setAttribute("aria-activedescendant", items[index].id);
    } else {
      partNameInput.removeAttribute("aria-activedescendant");
    }
    activeIndex = index;
  }

  function selectPart(value) {
    partNameValue = value;
    partNameInput.value = value;
    partNameClear.classList.toggle("hidden", !value);
    closeCombo();
    setError("partName", "");
  }

  partNameInput.addEventListener("input", () => {
    partNameValue = ""; // typing invalidates a prior exact selection until re-matched
    partNameClear.classList.toggle("hidden", !partNameInput.value);
    renderCombo(partNameInput.value);
    openCombo();
  });

  partNameInput.addEventListener("focus", () => {
    renderCombo(partNameInput.value);
    openCombo();
  });

  partNameInput.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!comboOpen) { renderCombo(partNameInput.value); openCombo(); }
      setActive(Math.min(activeIndex + 1, comboOptions.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (!comboOpen) { renderCombo(partNameInput.value); openCombo(); }
      setActive(Math.max(activeIndex - 1, 0));
    } else if (event.key === "Enter") {
      if (comboOpen && activeIndex >= 0 && comboOptions[activeIndex]) {
        event.preventDefault();
        selectPart(comboOptions[activeIndex]);
      }
    } else if (event.key === "Escape") {
      if (comboOpen) { event.preventDefault(); closeCombo(); }
    } else if (event.key === "Tab") {
      closeCombo();
    }
  });

  partNameList.addEventListener("mousedown", (event) => {
    const li = event.target.closest(".combobox-option");
    if (!li) return;
    event.preventDefault();
    selectPart(li.dataset.value);
  });

  partNameClear.addEventListener("click", () => {
    selectPart("");
    partNameInput.focus();
  });

  document.addEventListener("click", (event) => {
    if (!event.target.closest("[data-combobox]")) closeCombo();
  });

  partNameInput.addEventListener("blur", () => {
    // Snap back to the last valid exact match on blur; otherwise flag it on submit.
    const exact = PART_OPTIONS.find((p) => p.toLowerCase() === partNameInput.value.trim().toLowerCase());
    if (exact) selectPart(exact);
  });

  /* ================= Validation & live readout ================= */
  function toNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  function isNonNegativeWholeNumber(value) {
    if (String(value).trim() === "") return false;
    const n = Number(value);
    return Number.isInteger(n) && n >= 0;
  }

  function metrics() {
    const check = checkQty.value.trim() === "" ? 0 : toNumber(checkQty.value);
    const reject = rejQty.value.trim() === "" ? 0 : toNumber(rejQty.value);
    const rework = reworkQty.value.trim() === "" ? 0 : toNumber(reworkQty.value);
    return {
      reject: check === 0 ? 0 : (reject / check) * 100,
      rework: check === 0 ? 0 : (rework / check) * 100
    };
  }

  // Smoothly tween a digit readout's displayed number, like a caliper settling on a reading.
  function animateDigits(el, toValue) {
    const from = parseFloat(el.dataset.value || "0");
    const to = toValue;
    el.dataset.value = String(to);
    if (REDUCED_MOTION || Math.abs(to - from) < 0.01) {
      el.textContent = to.toFixed(2);
      return;
    }
    const duration = 180;
    const start = performance.now();
    function tick(now) {
      const t = Math.min(1, (now - start) / duration);
      const value = from + (to - from) * t;
      el.textContent = value.toFixed(2);
      if (t < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  function updateSnapshot() {
    const m = metrics();
    animateDigits($("rejPercent"), m.reject);
    animateDigits($("reworkPercent"), m.rework);
    updateBalance();
  }

  function updateBalance() {
    const row = $("balanceRow");
    const out = $("balanceValue");
    const anyEntered = [checkQty, okQty, rejQty, reworkQty].some((el) => el.value.trim() !== "");
    if (!anyEntered) { row.classList.add("hidden"); return; }
    row.classList.remove("hidden");

    const check = toNumber(checkQty.value);
    const ok = toNumber(okQty.value);
    const rej = toNumber(rejQty.value);
    const rework = reworkQty.value.trim() === "" ? 0 : toNumber(reworkQty.value);
    const unaccounted = check - (ok + rej + rework);

    if (unaccounted === 0) {
      out.textContent = "Balanced — OK + Reject + Rework = Check Qty";
      out.className = "balance-value balance-ok";
    } else if (unaccounted > 0) {
      out.textContent = `${unaccounted} unaccounted for (Check Qty is higher)`;
      out.className = "balance-value balance-off";
    } else {
      out.textContent = `${Math.abs(unaccounted)} over Check Qty — recheck the counts`;
      out.className = "balance-value balance-off";
    }
  }

  [checkQty, okQty, rejQty, reworkQty].forEach((el) => el.addEventListener("input", updateSnapshot));

  function setError(field, message) {
    const el = $(`${field}Error`);
    if (el) el.textContent = message || "";
    const input = field === "partName" ? partNameInput : $(field);
    if (input) input.classList.toggle("field-invalid", Boolean(message));
  }

  function validate() {
    let valid = true;
    const checks = [
      ["partName", !partNameValue, "Choose a part from the list — start typing to search."],
      ["checkQty", !isNonNegativeWholeNumber(checkQty.value), "Check Qty is required and must be a non-negative whole number."],
      ["okQty", !isNonNegativeWholeNumber(okQty.value), "OK Qty is required and must be a non-negative whole number."],
      ["rejQty", !isNonNegativeWholeNumber(rejQty.value), "Reject Qty is required and must be a non-negative whole number."],
      ["reworkQty", reworkQty.value.trim() !== "" && !isNonNegativeWholeNumber(reworkQty.value), "Rework Qty must be a non-negative whole number."]
    ];
    checks.forEach(([field, bad, message]) => {
      setError(field, bad ? message : "");
      if (bad) valid = false;
    });
    return valid;
  }

  /* ================= Result messaging ================= */
  function readString(value) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    return null;
  }

  function readMessages(data) {
    if (!data || typeof data !== "object") return [];
    const out = [];
    ["errors", "messages", "message", "error"].forEach((key) => {
      const value = data[key];
      if (Array.isArray(value)) {
        value.forEach((item) => {
          const text = readString(item) || (item && typeof item === "object" ? readString(item.message) : null);
          if (text) out.push(text);
        });
      } else {
        const text = readString(value);
        if (text) out.push(text);
      }
    });
    return out;
  }

  function showResultMessage(type, message, errors = []) {
    const box = $("resultMessage");
    box.className = `result-message ${type}`;
    box.innerHTML = "";
    const p = document.createElement("p");
    p.textContent = message;
    box.appendChild(p);
    if (errors.length) {
      const ul = document.createElement("ul");
      errors.forEach((error) => {
        const li = document.createElement("li");
        li.textContent = error;
        ul.appendChild(li);
      });
      box.appendChild(ul);
    }
    box.classList.remove("hidden");
  }

  /* ================= Render inspection result & print source ================= */
  function recordRows(rec) {
    const rows = [
      ["Part Name", rec.partName], ["Check Qty", rec.checkQty], ["OK Qty", rec.okQty],
      ["Reject Qty", rec.rejQty], ["Rework Qty", rec.reworkQty],
      ["Reject %", `${rec.rejPercent.toFixed(2)}%`], ["Rework %", `${rec.reworkPercent.toFixed(2)}%`]
    ];
    if (rec.inspectorName) rows.push(["Inspector", rec.inspectorName]);
    if (rec.severity) rows.push(["Severity", rec.severity]);
    return rows;
  }

  function renderRecord() {
    if (!record) return;
    $("inspectionResult").classList.remove("hidden");
    $("exportSection").classList.remove("hidden");
    $("newDataBtn").classList.remove("hidden");
    $("statusBadge").textContent = record.status;
    $("statusBadge").classList.toggle("invalid", record.status !== "Valid");
    $("resultMeta").textContent = `Response received from the quality system on ${record.submittedAt}.`;

    $("recordGrid").innerHTML = recordRows(record)
      .map(([label, value]) => `<div class="record-item"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`)
      .join("");

    const messages = record.messages || [];
    $("backendMessages").classList.toggle("hidden", messages.length === 0);
    $("messageList").innerHTML = messages.map((m) => `<li>${escapeHtml(m)}</li>`).join("");
    buildPrintRecord();
    $("inspectionResult").scrollIntoView({ behavior: REDUCED_MOTION ? "auto" : "smooth", block: "nearest" });
  }

  function buildPrintRecord() {
    if (!record) return;
    const rows = recordRows(record).concat([["Submission Status", record.status]]);
    const invalidClass = record.status !== "Valid" ? " invalid" : "";
    $("printRecord").innerHTML = `
      <div class="print-header">
        <div>
          <div class="print-title">MQI — Manufacturing Quality Inspection</div>
          <div class="print-subtitle">Gaurav Engineering Projects</div>
          <div class="print-generated">Generated ${escapeHtml(record.submittedAt)}</div>
        </div>
        <div class="print-stamp${invalidClass}">${escapeHtml(record.status)}</div>
      </div>
      <div class="print-section-title">Inspection Record</div>
      <table class="print-table"><tbody>${rows.map(([a, b]) => `<tr><td>${escapeHtml(a)}</td><td><strong>${escapeHtml(b)}</strong></td></tr>`).join("")}</tbody></table>
      ${record.remarks ? `<div class="print-remarks"><strong>Remarks</strong>${escapeHtml(record.remarks)}</div>` : ""}
    `;
  }

  /* ================= Submit to webhook ================= */
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (submitting) return;

    // Final sync: allow an exact case-insensitive match typed without opening the list.
    if (!partNameValue) {
      const exact = PART_OPTIONS.find((p) => p.toLowerCase() === partNameInput.value.trim().toLowerCase());
      if (exact) selectPart(exact);
    }
    if (!validate()) {
      const firstInvalid = form.querySelector(".field-invalid, .combobox-control.field-invalid input");
      if (firstInvalid) firstInvalid.focus();
      return;
    }

    submitting = true;
    $("submitBtn").disabled = true;
    $("submitBtn").textContent = "Submitting Inspection...";
    $("resultMessage").classList.add("hidden");

    const m = metrics();
    // Payload keeps the exact original contract; new fields are additive only.
    const payload = {
      partName: partNameValue,
      checkQty: toNumber(checkQty.value),
      okQty: toNumber(okQty.value),
      rejQty: toNumber(rejQty.value),
      reworkQty: reworkQty.value.trim() === "" ? 0 : toNumber(reworkQty.value),
      rejPercent: Number(m.reject.toFixed(2)),
      reworkPercent: Number(m.rework.toFixed(2)),
      inspectorName: inspectorName.value.trim() || undefined,
      remarks: remarks.value.trim() || undefined
    };

    try {
      const response = await fetch(WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await response.json();
      const severity = data && typeof data === "object" ? readString(data.severity) : null;
      const messages = readMessages(data);
      const base = {
        ...payload,
        inspectorName: inspectorName.value.trim(),
        remarks: remarks.value.trim(),
        submittedAt: new Date().toLocaleString(),
        severity,
        messages
      };

      if (data && data.isValid === true) {
        record = { ...base, status: "Valid" };
        showResultMessage("success", "Inspection submitted successfully.");
      } else {
        const errors = messages.length ? messages : ["The quality system did not accept this inspection."];
        record = { ...base, status: "Invalid", messages: errors };
        showResultMessage("error-state", "The inspection was not accepted:", errors);
      }
      renderRecord();
      pushHistory(record);
    } catch (error) {
      showResultMessage("error-state", "Unable to reach the quality system. Check your connection and try again.");
    } finally {
      submitting = false;
      $("submitBtn").disabled = false;
      $("submitBtn").textContent = "Submit Inspection";
    }
  });

  function clearForm() {
    form.reset();
    ["partName", "checkQty", "okQty", "rejQty", "reworkQty"].forEach((field) => setError(field, ""));
    partNameValue = "";
    partNameClear.classList.add("hidden");
    $("resultMessage").className = "result-message hidden";
    $("inspectionResult").classList.add("hidden");
    $("exportSection").classList.add("hidden");
    $("newDataBtn").classList.add("hidden");
    record = null;
    updateSnapshot();
    partNameInput.focus();
  }
  $("newDataBtn").addEventListener("click", clearForm);

  /* ================= History & today's stats (localStorage, this device only) ================= */
  function loadHistory() {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      const list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  }

  function saveHistory(list) {
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, HISTORY_LIMIT))); } catch { /* storage unavailable, degrade silently */ }
  }

  function pushHistory(rec) {
    const list = loadHistory();
    list.unshift({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      isoDate: new Date().toISOString(),
      partName: rec.partName,
      checkQty: rec.checkQty,
      okQty: rec.okQty,
      rejQty: rec.rejQty,
      reworkQty: rec.reworkQty,
      rejPercent: rec.rejPercent,
      reworkPercent: rec.reworkPercent,
      status: rec.status,
      inspectorName: rec.inspectorName || "",
      remarks: rec.remarks || "",
      submittedAt: rec.submittedAt,
      severity: rec.severity || null,
      messages: rec.messages || []
    });
    saveHistory(list);
    renderHistory();
    renderStats();
  }

  function isToday(isoDate) {
    const d = new Date(isoDate);
    const now = new Date();
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  }

  function renderStats() {
    const list = loadHistory().filter((item) => isToday(item.isoDate));
    const count = list.length;
    const checked = list.reduce((sum, item) => sum + (Number(item.checkQty) || 0), 0);
    const avgReject = count ? list.reduce((sum, item) => sum + (Number(item.rejPercent) || 0), 0) / count : 0;
    $("statCount").textContent = String(count);
    $("statChecked").textContent = String(checked);
    $("statRejectAvg").textContent = `${avgReject.toFixed(2)}%`;
  }

  function renderHistory() {
    const list = loadHistory();
    $("historyEmpty").classList.toggle("hidden", list.length > 0);
    $("historyList").classList.toggle("hidden", list.length === 0);
    $("historyList").innerHTML = list.map((item) => `
      <li class="history-item">
        <div class="history-item-main">
          <div class="history-item-part">${escapeHtml(item.partName)}</div>
          <div class="history-item-meta">${escapeHtml(item.submittedAt)} &middot; Reject ${Number(item.rejPercent).toFixed(2)}%${item.inspectorName ? ` &middot; ${escapeHtml(item.inspectorName)}` : ""}</div>
        </div>
        <span class="history-chip ${item.status === "Valid" ? "valid" : "invalid"}">${escapeHtml(item.status)}</span>
        <button type="button" class="btn btn-secondary history-view-btn" data-history-id="${escapeHtml(item.id)}">View</button>
      </li>
    `).join("");
  }

  $("historyList").addEventListener("click", (event) => {
    const button = event.target.closest("[data-history-id]");
    if (!button) return;
    const item = loadHistory().find((i) => i.id === button.dataset.historyId);
    if (!item) return;
    record = { ...item };
    renderRecord();
  });

  $("clearHistoryBtn").addEventListener("click", () => {
    if (loadHistory().length === 0) return;
    if (!window.confirm("Clear all inspection history stored on this device? This cannot be undone.")) return;
    saveHistory([]);
    renderHistory();
    renderStats();
  });

  /* ================= Export: PDF / JPG / native print ================= */
  async function exportRecord(kind) {
    if (!record || exporting) return;
    exporting = true;
    const button = kind === "pdf" ? $("pdfBtn") : $("jpgBtn");
    const originalLabel = button.textContent;
    button.disabled = true;
    button.textContent = kind === "pdf" ? "Preparing PDF..." : "Preparing JPG...";
    try {
      if (!window.html2canvas) throw new Error("html2canvas unavailable");
      const canvas = await html2canvas($("printRecord"), { scale: 2, backgroundColor: "#ffffff" });
      const safePart = String(record.partName).replace(/[^a-z0-9]+/gi, "-").toLowerCase();
      const base = `mqi-inspection-${safePart}`;
      if (kind === "jpg") {
        const link = document.createElement("a");
        link.href = canvas.toDataURL("image/jpeg", 0.95);
        link.download = `${base}.jpg`;
        link.click();
      } else {
        if (!window.jspdf) throw new Error("jsPDF unavailable");
        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
        const pageWidth = pdf.internal.pageSize.getWidth();
        const margin = 32;
        const imgWidth = pageWidth - margin * 2;
        const imgHeight = (canvas.height / canvas.width) * imgWidth;
        pdf.addImage(canvas.toDataURL("image/jpeg", 0.95), "JPEG", margin, margin, imgWidth, imgHeight);
        pdf.save(`${base}.pdf`);
      }
    } catch (error) {
      showResultMessage("error-state", "Unable to generate the export. Please try again.");
    } finally {
      exporting = false;
      $("pdfBtn").disabled = false;
      $("jpgBtn").disabled = false;
      $("pdfBtn").textContent = "↓ Download PDF";
      $("jpgBtn").textContent = "↓ Download JPG";
      if (button) button.textContent = originalLabel;
    }
  }
  $("pdfBtn").addEventListener("click", () => exportRecord("pdf"));
  $("jpgBtn").addEventListener("click", () => exportRecord("jpg"));
  $("printBtn").addEventListener("click", () => window.print());

  /* ================= Theme ================= */
  function applyTheme(theme) {
    document.documentElement.classList.toggle("dark", theme === "dark");
    $("themeIcon").textContent = theme === "dark" ? "☾" : "☀";
    $("themeText").textContent = theme === "dark" ? "Dark" : "Light";
    $("themeToggle").setAttribute("aria-pressed", String(theme === "dark"));
  }

  let theme = localStorage.getItem(THEME_KEY) === "dark" ? "dark" : "light";
  applyTheme(theme);
  $("themeToggle").addEventListener("click", () => {
    theme = theme === "dark" ? "light" : "dark";
    applyTheme(theme);
    try { localStorage.setItem(THEME_KEY, theme); } catch { /* ignore */ }
  });

  /* ================= Init ================= */
  updateSnapshot();
  renderHistory();
  renderStats();
})();
