const API_BASE = "/api";
const TOKEN_KEY = "whisper.authToken";
const MODE_KEY = "whisper.mode";
const VAD_KEY = "whisper.vad";
const LAST_RESULT_KEY = "whisper.lastResult";
const ALLOWED_MODES = ["1", "3", "5"];

const loginOverlay = document.getElementById("login-overlay");
const loginForm = document.getElementById("login-form");
const loginUsername = document.getElementById("login-username");
const loginPassword = document.getElementById("login-password");
const loginError = document.getElementById("login-error");
const logoutBtn = document.getElementById("logout-btn");

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

const MODE_HINTS = {
  "1": "Быстрее всего · подходит для большинства записей",
  "3": "Чуть точнее на сложных местах",
  "5": "Максимум качества · медленнее, для нечёткой речи и акцентов",
};

let selectedFile = null;
let timerInterval = null;
let activeTranscriptions = 0;

// Защита от случайной перезагрузки во время активной транскрибации
window.addEventListener("beforeunload", (e) => {
  if (activeTranscriptions > 0) {
    e.preventDefault();
    e.returnValue = "";
  }
});

// === Auth ===

function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}

function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

function showLogin() {
  loginOverlay.classList.remove("hidden");
  loginOverlay.setAttribute("aria-hidden", "false");
  logoutBtn.classList.add("hidden");
  setTimeout(() => loginUsername.focus(), 50);
}

function hideLogin() {
  loginOverlay.classList.add("hidden");
  loginOverlay.setAttribute("aria-hidden", "true");
  logoutBtn.classList.remove("hidden");
  loginPassword.value = "";
  loginError.classList.add("hidden");
}

function setLoginError(msg) {
  loginError.textContent = msg;
  loginError.classList.remove("hidden");
}

async function apiFetch(path, options = {}) {
  const headers = new Headers(options.headers || {});
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (res.status === 401) {
    // токен невалидный/протух — выкидываем и показываем форму логина
    clearToken();
    showLogin();
    throw new Error("Сессия истекла, войдите заново");
  }
  return res;
}

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  loginError.classList.add("hidden");
  const username = loginUsername.value.trim();
  const password = loginPassword.value;
  if (!username || !password) return;

  try {
    const res = await fetch(`${API_BASE}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setLoginError(data.error || `Ошибка ${res.status}`);
      return;
    }
    setToken(data.token);
    hideLogin();
  } catch (err) {
    setLoginError(err.message || "Сеть недоступна");
  }
});

logoutBtn.addEventListener("click", () => {
  clearToken();
  showLogin();
});

// При старте: если токена нет — сразу логин. Если есть — доверяем, при первом 401 перекинет.
if (!getToken()) {
  showLogin();
} else {
  logoutBtn.classList.remove("hidden");
}

// === File picking ===

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDuration(totalSeconds) {
  const total = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function probeAudioDuration(file) {
  return new Promise((resolve) => {
    const audio = document.createElement("audio");
    audio.preload = "metadata";
    const url = URL.createObjectURL(file);
    const cleanup = () => URL.revokeObjectURL(url);
    audio.addEventListener("loadedmetadata", () => {
      const d = audio.duration;
      cleanup();
      resolve(Number.isFinite(d) && d > 0 ? d : null);
    });
    audio.addEventListener("error", () => {
      cleanup();
      resolve(null);
    });
    audio.src = url;
  });
}

function setStatus(text, kind, opts = {}) {
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
  if (opts.timer) {
    const timer = document.createElement("span");
    timer.className = "timer";
    timer.id = "status-timer";
    timer.textContent = "00:00";
    statusEl.appendChild(timer);
  }
}

function clearStatus() {
  statusEl.classList.add("hidden");
  statusEl.textContent = "";
}

function startTimer() {
  stopTimer();
  const start = Date.now();
  timerInterval = setInterval(() => {
    const timerEl = document.getElementById("status-timer");
    if (!timerEl) {
      stopTimer();
      return;
    }
    timerEl.textContent = formatDuration((Date.now() - start) / 1000);
  }, 1000);
}

function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
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

async function selectFile(file) {
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

  // Длительность узнаём асинхронно — не блокируем UI, не критично если не получится
  const duration = await probeAudioDuration(file);
  // Возможно пользователь успел выбрать другой файл — проверяем что это всё ещё тот же
  if (selectedFile !== file) return;
  if (duration !== null) {
    fileSizeEl.textContent = `${formatBytes(file.size)} · ${formatDuration(duration)}`;
  }
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

function getSelectedMode() {
  const checked = document.querySelector('input[name="mode"]:checked');
  return checked ? checked.value : "3";
}

function applyMode(value) {
  if (!ALLOWED_MODES.includes(value)) return;
  const input = document.querySelector(`input[name="mode"][value="${value}"]`);
  if (input) input.checked = true;
  const hint = document.getElementById("mode-hint");
  if (hint) hint.textContent = MODE_HINTS[value] || "";
}

document.querySelectorAll('input[name="mode"]').forEach((input) => {
  input.addEventListener("change", () => {
    applyMode(input.value);
    try { localStorage.setItem(MODE_KEY, input.value); } catch {}
  });
});

const vadToggle = document.getElementById("vad-toggle");
vadToggle.addEventListener("change", () => {
  try { localStorage.setItem(VAD_KEY, vadToggle.checked ? "true" : "false"); } catch {}
});

// Восстанавливаем сохранённые настройки. Если значения нет — оставляем дефолт из HTML.
try {
  const savedMode = localStorage.getItem(MODE_KEY);
  if (savedMode && ALLOWED_MODES.includes(savedMode)) applyMode(savedMode);

  const savedVad = localStorage.getItem(VAD_KEY);
  if (savedVad === "true" || savedVad === "false") vadToggle.checked = savedVad === "true";
} catch {}

submitBtn.addEventListener("click", async () => {
  if (!selectedFile) return;

  const beamSize = getSelectedMode();
  const vad = document.getElementById("vad-toggle").checked;

  const fd = new FormData();
  fd.append("audio", selectedFile);
  fd.append("beam_size", beamSize);
  fd.append("vad", vad ? "true" : "false");

  submitBtn.disabled = true;
  setStatus("Распознаём…", "loading", { timer: true });
  startTimer();
  resultSection.classList.add("hidden");

  const startTime = Date.now();
  activeTranscriptions++;
  try {
    const res = await apiFetch(`/transcribe`, { method: "POST", body: fd });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || `Ошибка ${res.status}`);
    }
    const text = data.text || "";
    resultText.value = text;
    resultSection.classList.remove("hidden");
    const elapsed = (Date.now() - startTime) / 1000;
    setStatus(`Готово за ${formatDuration(elapsed)}`, "success");
    try {
      localStorage.setItem(LAST_RESULT_KEY, JSON.stringify({
        text,
        fileName: selectedFile ? selectedFile.name : null,
        savedAt: Date.now(),
      }));
    } catch {}
  } catch (err) {
    setStatus(err.message || "Ошибка запроса", "error");
  } finally {
    activeTranscriptions--;
    stopTimer();
    submitBtn.disabled = !selectedFile;
  }
});

// Восстановление прошлого результата (например, после случайной перезагрузки)
try {
  const raw = localStorage.getItem(LAST_RESULT_KEY);
  if (raw) {
    const saved = JSON.parse(raw);
    if (saved && typeof saved.text === "string" && saved.text.length > 0) {
      resultText.value = saved.text;
      resultSection.classList.remove("hidden");
      const ago = saved.savedAt ? new Date(saved.savedAt).toLocaleString() : "";
      const label = saved.fileName
        ? `Прошлый результат · ${saved.fileName}${ago ? ` · ${ago}` : ""}`
        : `Прошлый результат${ago ? ` · ${ago}` : ""}`;
      setStatus(label, "success");
    }
  }
} catch {}

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
