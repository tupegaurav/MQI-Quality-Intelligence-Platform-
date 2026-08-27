const PART_OPTIONS = [
  "TVS FRONT CALIPER", "K-17 FRONT CALIPER", "REJ-C MASTER CYL", "ACPD CALIPER",
  "HERO ADHG CALIPER", "HONDA UNICORN CALIPER", "CANISTER K10", "N-TOEQ MASTER CYL",
  "TVS FRONT MASTER CYLINDER", "HERO ABSR MASTER CYL", "ADJR MASTER CYLINDER",
  "ADHG MASTER CYLINDER", "HONDA UNICORN MASTER CYLINDER", "H105 M/CYL", "PULSER HOLDER BRACKET"
];

const WEBHOOK_URL = "https://gauravai.app.n8n.cloud/webhook/mauli-inspection";
const THEME_KEY = "mqi-theme";

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

PART_OPTIONS.forEach((part) => {
  const option = document.createElement("option");
  option.value = part;
  option.textContent = part;
  partName.appendChild(option);
});

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

function updateSnapshot() {
  const m = metrics();
  $("rejPercent").textContent = `${m.reject.toFixed(2)}%`;
  $("reworkPercent").textContent = `${m.rework.toFixed(2)}%`;
}

[checkQty, rejQty, reworkQty].forEach((el) => el.addEventListener("input", updateSnapshot));

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
  if (errors.length) {
    const p = document.createElement("p");
    p.textContent = message;
    const ul = document.createElement("ul");
    errors.forEach((error) => {
      const li = document.createElement("li");
      li.textContent = error;
      ul.appendChild(li);
    });
    box.append(p, ul);
  } else {
    const p = document.createElement("p");
    p.textContent = message;
    box.appendChild(p);
  }
}

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

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;","\"":"&quot;"}[char]));
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
    <table class="print-table"><tbody>${rows.map(([a,b]) => `<tr><td>${escapeHtml(a)}</td><td><strong>${escapeHtml(b)}</strong></td></tr>`).join("")}</tbody></table>`;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (submitting || !validate()) return;
  submitting = true;
  $("submitBtn").disabled = true;
  $("submitBtn").textContent = "Submitting Inspection...";
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
  } catch (error) {
    showResultMessage("error-state", "Unable to submit inspection. Please try again.");
    $("resultMessage").classList.remove("hidden");
  } finally {
    submitting = false;
    $("submitBtn").disabled = false;
    $("submitBtn").textContent = "Submit Inspection";
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
}

$("newDataBtn").addEventListener("click", clearForm);

async function exportRecord(kind) {
  if (!record || exporting) return;
  exporting = true;
  const button = kind === "pdf" ? $("pdfBtn") : $("jpgBtn");
  button.disabled = true;
  button.textContent = kind === "pdf" ? "Preparing PDF..." : "Preparing JPG...";
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
    $("pdfBtn").textContent = "↓ Download PDF";
    $("jpgBtn").textContent = "↓ Download JPG";
  }
}

$("pdfBtn").addEventListener("click", () => exportRecord("pdf"));
$("jpgBtn").addEventListener("click", () => exportRecord("jpg"));

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
  localStorage.setItem(THEME_KEY, theme);
});

updateSnapshot();
