const PART_OPTIONS = [
  "TVS FRONT CALIPER", "K-17 FRONT CALIPER", "REJ-C MASTER CYL", "ACPD CALIPER",
  "HERO ADHG CALIPER", "HONDA UNICORN CALIPER", "CANISTER K10", "N-TOEQ MASTER CYL",
  "TVS FRONT MASTER CYLINDER", "HERO ABSR MASTER CYL", "ADJR MASTER CYLINDER",
  "ADHG MASTER CYLINDER", "HONDA UNICORN MASTER CYLINDER", "H105 M/CYL", "PULSER HOLDER BRACKET"
];

const WEBHOOK_URL = "https://gauravai.app.n8n.cloud/webhook/mauli-inspection";
const THEME_KEY = "mqi-theme";
const HISTORY_KEY = "mqi-history";
const HISTORY_LIMIT = 50;
const METRIC_SCALE_MAX = 25; // % — bar reaches 100% width at this value

const $ = (id) => document.getElementById(id);
const form = $("inspectionForm");
const partName = $("partName");
const checkQty = $("checkQty");
const okQty = $("okQty");
const rejQty = $("rejQty");
const reworkQty = $("reworkQty");

let record = null;
let submitting = false;
let exporting = false;
let history = loadHistory();

PART_OPTIONS.forEach((part) => {
  const option = document.createElement("option");
  option.value = part;
  option.textContent = part;
  partName.appendChild(option);
});

/* =========================================================
   Numbers & metrics
   ========================================================= */
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

function metricZone(valuePercent) {
  if (valuePercent <= 3) return { cls: "", label: "Within target" };
  if (valuePercent <= 8) return { cls: "warn", label: "Elevated" };
  return { cls: "stop", label: "Above target" };
}

function setMetricBar(barEl, statusEl, valuePercent) {
  const clamped = Math.min(Math.max(valuePercent, 0), METRIC_SCALE_MAX);
  const fraction = clamped / METRIC_SCALE_MAX;
  const zone = metricZone(valuePercent);
  barEl.style.width = `${(fraction * 100).toFixed(1)}%`;
  barEl.className = `metric-bar-fill ${zone.cls}`.trim();
  statusEl.textContent = zone.label;
  statusEl.className = `metric-status ${zone.cls}`.trim();
}

function updateSnapshot() {
  const m = metrics();
  $("rejPercent").textContent = `${m.reject.toFixed(2)}%`;
  $("reworkPercent").textContent = `${m.rework.toFixed(2)}%`;
  setMetricBar($("rejBarFill"), $("rejStatus"), m.reject);
  setMetricBar($("reworkBarFill"), $("reworkStatus"), m.rework);
}

[checkQty, rejQty, reworkQty].forEach((el) => el.addEventListener("input", updateSnapshot));

/* =========================================================
   Validation
   ========================================================= */
function setError(field, message) {
  $(`${field}Error`).textContent = message || "";
}

function validate() {
  let valid = true;
  const checks = [
    ["partName", !partName.value, "Part Name is required."],
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

/* =========================================================
   Backend response parsing
   ========================================================= */
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

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", "\"": "&quot;" }[char]));
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
}

/* =========================================================
   Result rendering
   ========================================================= */
function renderRecord() {
  if (!record) return;
  $("inspectionResult").classList.remove("hidden");
  $("exportSection").classList.remove("hidden");
  $("newDataBtn").classList.remove("hidden");
  $("statusBadge").textContent = record.status;
  $("statusBadge").classList.toggle("invalid", record.status !== "Valid");
  $("resultMeta").textContent = `Response received from the inspection backend on ${record.submittedAt}.`;

  const rows = [
    ["Part Name", record.partName], ["Check Qty", record.checkQty], ["OK Qty", record.okQty],
    ["Reject Qty", record.rejQty], ["Rework Qty", record.reworkQty],
    ["Reject %", `${record.rejPercent.toFixed(2)}%`], ["Rework %", `${record.reworkPercent.toFixed(2)}%`]
  ];
  if (record.severity) rows.push(["Severity", record.severity]);
  $("recordGrid").innerHTML = rows.map(([label, value]) => `<div class="record-item"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("");

  const messages = record.messages || [];
  $("backendMessages").classList.toggle("hidden", messages.length === 0);
  $("messageList").innerHTML = messages.map((m) => `<li>${escapeHtml(m)}</li>`).join("");
  buildPrintRecord();
}

function buildPrintRecord() {
  if (!record) return;
  const rows = [
    ["Part Name", record.partName], ["Check Qty", record.checkQty], ["OK Qty", record.okQty],
    ["Reject Qty", record.rejQty], ["Rework Qty", record.reworkQty],
    ["Reject %", `${record.rejPercent.toFixed(2)}%`], ["Rework %", `${record.reworkPercent.toFixed(2)}%`],
    ["Submission Status", record.status]
  ];
  if (record.severity) rows.push(["Severity", record.severity]);
  $("printRecord").innerHTML = `
    <div class="print-header"><div class="print-title">MQI — Quality Intelligence Platform</div><div class="print-subtitle">Manufacturing Quality Inspection</div></div>
    <div class="print-section-title">Inspection Record</div>
    <div class="print-generated">Generated ${escapeHtml(record.submittedAt)}</div>
    <table class="print-table"><tbody>${rows.map(([a, b]) => `<tr><td>${escapeHtml(a)}</td><td><strong>${escapeHtml(b)}</strong></td></tr>`).join("")}</tbody></table>`;
}

/* =========================================================
   Session log (local to this device only)
   ========================================================= */
function loadHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveHistory() {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  } catch {
    /* storage unavailable — session log stays in-memory only for this page view */
  }
}

function addToHistory(entry) {
  history.unshift(entry);
  if (history.length > HISTORY_LIMIT) history = history.slice(0, HISTORY_LIMIT);
  saveHistory();
  renderHistory();
}

function renderHistory() {
  const hasHistory = history.length > 0;
  $("historyEmpty").classList.toggle("hidden", hasHistory);
  $("historyTable").classList.toggle("hidden", !hasHistory);
  $("historySummary").classList.toggle("hidden", !hasHistory);
  $("historyCsvBtn").disabled = !hasHistory;
  $("historyClearBtn").disabled = !hasHistory;

  if (!hasHistory) {
    $("historyBody").innerHTML = "";
    return;
  }

  $("historyBody").innerHTML = history.map((entry) => `
    <tr>
      <td>${escapeHtml(entry.submittedAt)}</td>
      <td>${escapeHtml(entry.partName)}</td>
      <td>${escapeHtml(entry.checkQty)}</td>
      <td>${escapeHtml(entry.okQty)}</td>
      <td>${escapeHtml(entry.rejQty)}</td>
      <td>${escapeHtml(entry.reworkQty)}</td>
      <td>${entry.rejPercent.toFixed(2)}%</td>
      <td><span class="pill ${entry.status === "Valid" ? "pill-go" : "pill-stop"}">${escapeHtml(entry.status)}</span></td>
    </tr>`).join("");

  const total = history.length;
  const validCount = history.filter((e) => e.status === "Valid").length;
  const avgReject = history.reduce((sum, e) => sum + e.rejPercent, 0) / total;
  const totalChecked = history.reduce((sum, e) => sum + toNumber(e.checkQty), 0);

  const stats = [
    ["Logged today", String(total)],
    ["Accepted by backend", `${validCount}/${total}`],
    ["Avg reject %", `${avgReject.toFixed(2)}%`],
    ["Units checked", String(totalChecked)]
  ];
  $("historySummary").innerHTML = stats.map(([label, value]) => `
    <div class="stat"><div class="stat-label">${escapeHtml(label)}</div><div class="stat-value">${escapeHtml(value)}</div></div>`).join("");
}

function historyToCsv() {
  const header = ["Submitted At", "Part Name", "Check Qty", "OK Qty", "Reject Qty", "Rework Qty", "Reject %", "Rework %", "Status"];
  const rows = history.map((e) => [
    e.submittedAt, e.partName, e.checkQty, e.okQty, e.rejQty, e.reworkQty,
    e.rejPercent.toFixed(2), e.reworkPercent.toFixed(2), e.status
  ]);
  const escapeCsv = (value) => {
    const str = String(value);
    return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };
  return [header, ...rows].map((row) => row.map(escapeCsv).join(",")).join("\n");
}

$("historyCsvBtn").addEventListener("click", () => {
  if (!history.length) return;
  const csv = historyToCsv();
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `mqi-session-log-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
});

$("historyClearBtn").addEventListener("click", () => {
  if (!history.length) return;
  if (!confirm("Clear the session log on this device? This cannot be undone.")) return;
  history = [];
  saveHistory();
  renderHistory();
});

/* =========================================================
   Submit
   ========================================================= */
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (submitting || !validate()) return;
  submitting = true;
  $("submitBtn").disabled = true;
  $("submitBtn").querySelector(".btn-spinner").classList.remove("hidden");
  $("submitBtn").querySelector(".btn-label").textContent = "Submitting…";
  $("resultMessage").classList.add("hidden");

  const m = metrics();
  const payload = {
    partName: partName.value,
    checkQty: toNumber(checkQty.value),
    okQty: toNumber(okQty.value),
    rejQty: toNumber(rejQty.value),
    reworkQty: reworkQty.value.trim() === "" ? 0 : toNumber(reworkQty.value),
    rejPercent: Number(m.reject.toFixed(2)),
    reworkPercent: Number(m.rework.toFixed(2))
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
    const base = { ...payload, submittedAt: new Date().toLocaleString(), severity, messages };

    if (data && data.isValid === true) {
      record = { ...base, status: "Valid" };
      showResultMessage("success", "Inspection submitted successfully.");
    } else {
      const errors = messages.length ? messages : ["The backend did not accept this inspection."];
      record = { ...base, status: "Invalid", messages: errors };
      showResultMessage("error-state", "The inspection was not accepted:", errors);
    }
    $("resultMessage").classList.remove("hidden");
    renderRecord();
    addToHistory(record);
  } catch (error) {
    showResultMessage("error-state", "Unable to submit inspection. Check your connection and try again.");
    $("resultMessage").classList.remove("hidden");
  } finally {
    submitting = false;
    $("submitBtn").disabled = false;
    $("submitBtn").querySelector(".btn-spinner").classList.add("hidden");
    $("submitBtn").querySelector(".btn-label").textContent = "Submit inspection";
  }
});

function clearForm() {
  form.reset();
  ["partName", "checkQty", "okQty", "rejQty", "reworkQty"].forEach((field) => setError(field, ""));
  $("resultMessage").className = "result-message hidden";
  $("inspectionResult").classList.add("hidden");
  $("exportSection").classList.add("hidden");
  $("newDataBtn").classList.add("hidden");
  record = null;
  updateSnapshot();
  partName.focus();
}

$("newDataBtn").addEventListener("click", clearForm);

/* =========================================================
   Export (PDF / JPG)
   ========================================================= */
async function exportRecord(kind) {
  if (!record || exporting) return;
  exporting = true;
  const button = kind === "pdf" ? $("pdfBtn") : $("jpgBtn");
  const label = button.querySelector(".btn-label");
  const originalLabel = label.textContent;
  button.disabled = true;
  label.textContent = kind === "pdf" ? "Preparing PDF…" : "Preparing JPG…";
  try {
    if (!window.html2canvas) throw new Error("html2canvas unavailable");
    const canvas = await html2canvas($("printRecord"), { scale: 2, backgroundColor: "#ffffff" });
    const safePart = record.partName.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    const base = `mqi-inspection-${safePart}`;
    if (kind === "jpg") {
      const link = document.createElement("a");
      link.href = canvas.toDataURL("image/jpeg", .95);
      link.download = `${base}.jpg`;
      link.click();
    } else {
      if (!window.jspdf) throw new Error("jsPDF unavailable");
      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const margin = 32;
      const imgWidth = pageWidth - margin * 2;
      const imgHeight = canvas.height / canvas.width * imgWidth;
      pdf.addImage(canvas.toDataURL("image/jpeg", .95), "JPEG", margin, margin, imgWidth, imgHeight);
      pdf.save(`${base}.pdf`);
    }
  } catch (error) {
    showResultMessage("error-state", "Unable to generate the export. Please try again.");
    $("resultMessage").classList.remove("hidden");
  } finally {
    exporting = false;
    $("pdfBtn").disabled = false;
    $("jpgBtn").disabled = false;
    label.textContent = originalLabel;
  }
}

$("pdfBtn").addEventListener("click", () => exportRecord("pdf"));
$("jpgBtn").addEventListener("click", () => exportRecord("jpg"));

/* =========================================================
   Theme
   ========================================================= */
function applyTheme(theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
  $("themeIconSun").classList.toggle("hidden", theme === "dark");
  $("themeIconMoon").classList.toggle("hidden", theme !== "dark");
  $("themeText").textContent = theme === "dark" ? "Dark" : "Light";
  $("themeToggle").setAttribute("aria-pressed", String(theme === "dark"));
}

let theme = localStorage.getItem(THEME_KEY) === "dark" ? "dark" : (localStorage.getItem(THEME_KEY) === "light" ? "light" : (window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light"));
applyTheme(theme);
$("themeToggle").addEventListener("click", () => {
  theme = theme === "dark" ? "light" : "dark";
  applyTheme(theme);
  localStorage.setItem(THEME_KEY, theme);
});

/* =========================================================
   About modal
   ========================================================= */
const aboutBtn = $("aboutBtn");
const aboutModal = $("aboutModal");
const aboutModalClose = $("aboutModalClose");

function openAbout() {
  aboutModal.classList.remove("hidden");
  aboutModal.setAttribute("aria-hidden", "false");
  aboutBtn.setAttribute("aria-expanded", "true");
  document.body.style.overflow = "hidden";
  aboutModalClose.focus();
}

function closeAbout() {
  aboutModal.classList.add("hidden");
  aboutModal.setAttribute("aria-hidden", "true");
  aboutBtn.setAttribute("aria-expanded", "false");
  document.body.style.overflow = "";
  aboutBtn.focus();
}

aboutBtn.addEventListener("click", openAbout);
aboutModalClose.addEventListener("click", closeAbout);
aboutModal.addEventListener("click", (event) => {
  if (event.target === aboutModal) closeAbout();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !aboutModal.classList.contains("hidden")) closeAbout();
});

/* =========================================================
   Init
   ========================================================= */
updateSnapshot();
renderHistory();
