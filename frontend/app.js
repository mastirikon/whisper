const API_BASE = "/api";

const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("file-input");
const fileInfo = document.getElementById("file-info");
const fileNameEl = document.getElementById("file-name");
const fileSizeEl = document.getElementById("file-size");
const removeFileBtn = document.getElementById("remove-file");
const submitBtn = document.getElementById("submit-btn");
const statusEl = document.getElementById("status");
const resultSection = document.getElementById("result");
const resultText = document.getElementById("result-text");
const copyBtn = document.getElementById("copy-btn");
const downloadBtn = document.getElementById("download-btn");

const ALLOWED = [".m4a", ".mp3", ".wav", ".ogg", ".flac"];
const MAX_BYTES = 100 * 1024 * 1024;

let selectedFile = null;

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function setStatus(text, kind) {
  statusEl.className = "status " + kind;
  statusEl.classList.remove("hidden");
  statusEl.innerHTML = "";
  if (kind === "loading") {
    const sp = document.createElement("span");
    sp.className = "spinner";
    statusEl.appendChild(sp);
  }
  const t = document.createElement("span");
  t.textContent = text;
  statusEl.appendChild(t);
}

function clearStatus() {
  statusEl.classList.add("hidden");
  statusEl.textContent = "";
}

function validateFile(file) {
  const name = (file.name || "").toLowerCase();
  if (!ALLOWED.some((ext) => name.endsWith(ext))) {
    return `Неподдерживаемый формат. Допустимы: ${ALLOWED.join(", ")}`;
  }
  if (file.size > MAX_BYTES) {
    return `Файл слишком большой (макс. ${formatBytes(MAX_BYTES)})`;
  }
  return null;
}

function selectFile(file) {
  const err = validateFile(file);
  if (err) {
    setStatus(err, "error");
    return;
  }
  selectedFile = file;
  fileNameEl.textContent = file.name;
  fileSizeEl.textContent = formatBytes(file.size);
  fileInfo.classList.remove("hidden");
  submitBtn.disabled = false;
  clearStatus();
}

function clearFile() {
  selectedFile = null;
  fileInput.value = "";
  fileInfo.classList.add("hidden");
  submitBtn.disabled = true;
}

fileInput.addEventListener("change", (e) => {
  const file = e.target.files && e.target.files[0];
  if (file) selectFile(file);
});

["dragenter", "dragover"].forEach((ev) => {
  dropzone.addEventListener(ev, (e) => {
    e.preventDefault();
    dropzone.classList.add("drag-over");
  });
});

["dragleave", "drop"].forEach((ev) => {
  dropzone.addEventListener(ev, (e) => {
    e.preventDefault();
    dropzone.classList.remove("drag-over");
  });
});

dropzone.addEventListener("drop", (e) => {
  const file = e.dataTransfer.files && e.dataTransfer.files[0];
  if (file) selectFile(file);
});

removeFileBtn.addEventListener("click", (e) => {
  e.preventDefault();
  e.stopPropagation();
  clearFile();
  clearStatus();
});

submitBtn.addEventListener("click", async () => {
  if (!selectedFile) return;

  const fd = new FormData();
  fd.append("audio", selectedFile);

  submitBtn.disabled = true;
  setStatus("Распознаём… это может занять время", "loading");
  resultSection.classList.add("hidden");

  try {
    const res = await fetch(`${API_BASE}/transcribe`, {
      method: "POST",
      body: fd,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || `Ошибка ${res.status}`);
    }
    resultText.value = data.text || "";
    resultSection.classList.remove("hidden");
    setStatus("Готово", "success");
    setTimeout(clearStatus, 1800);
  } catch (err) {
    setStatus(err.message || "Ошибка запроса", "error");
  } finally {
    submitBtn.disabled = !selectedFile;
  }
});

copyBtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(resultText.value);
    const orig = copyBtn.textContent;
    copyBtn.textContent = "Скопировано";
    setTimeout(() => (copyBtn.textContent = orig), 1400);
  } catch {
    resultText.select();
    document.execCommand("copy");
  }
});

downloadBtn.addEventListener("click", () => {
  const blob = new Blob([resultText.value], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const base = (selectedFile && selectedFile.name.replace(/\.[^.]+$/, "")) || "transcript";
  const a = document.createElement("a");
  a.href = url;
  a.download = `${base}.txt`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
});
