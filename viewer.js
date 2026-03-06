const STORAGE_KEY = "darkPdfSettings";
const SAMPLE_BYTES = 250000;

const statusNode = document.getElementById("status");
const loadingNode = document.getElementById("loading");
const frameNode = document.getElementById("pdfFrame");
const toggleNode = document.getElementById("darkToggle");
const strengthNode = document.getElementById("strength");
const originalNode = document.getElementById("openOriginal");

const params = new URLSearchParams(window.location.search);
const pdfUrl = params.get("file");

let objectUrl = null;
let autoDetectedDark = true;

function setStatus(text) {
  statusNode.textContent = text;
}

function showLoading(show) {
  loadingNode.classList.toggle("hidden", !show);
}

function applyDarkMode(enabled) {
  frameNode.classList.toggle("dark", enabled);
}

function applyStrength(value) {
  document.documentElement.style.setProperty("--strength", String(value));
}

async function loadSettings() {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  return {
    strength: result[STORAGE_KEY]?.strength ?? 0.9
  };
}

async function saveSettings(next) {
  await chrome.storage.local.set({ [STORAGE_KEY]: next });
}

async function readSampleBytes(url, maxBytes) {
  const response = await fetch(url, {
    cache: "no-store",
    credentials: "include"
  });

  if (!response.ok) {
    throw new Error(`Unable to download PDF (${response.status})`);
  }

  if (!response.body) {
    const fallbackBytes = new Uint8Array(await response.arrayBuffer());
    return fallbackBytes.slice(0, maxBytes);
  }

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;

  while (total < maxBytes) {
    const { done, value } = await reader.read();
    if (done || !value) {
      break;
    }

    chunks.push(value);
    total += value.byteLength;
  }

  try {
    await reader.cancel();
  } catch {
    // Ignore stream cancel issues from browsers that complete quickly.
  }

  const joined = new Uint8Array(total);
  let offset = 0;

  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return joined;
}

function detectLightBackground(sampleBytes) {
  const text = new TextDecoder("latin1", { fatal: false }).decode(sampleBytes);

  const whiteRgb = (text.match(/\b1(?:\.0+)?\s+1(?:\.0+)?\s+1(?:\.0+)?\s+rg\b/g) || []).length;
  const whiteGray = (text.match(/\b1(?:\.0+)?\s+g\b/g) || []).length;

  const blackRgb = (text.match(/\b0(?:\.0+)?\s+0(?:\.0+)?\s+0(?:\.0+)?\s+rg\b/g) || []).length;
  const blackGray = (text.match(/\b0(?:\.0+)?\s+g\b/g) || []).length;

  const imageCount = (text.match(/\/Subtype\s*\/Image/g) || []).length;
  const whiteScore = whiteRgb * 1.1 + whiteGray;
  const blackScore = blackRgb * 1.1 + blackGray + imageCount * 0.3;

  return whiteScore >= blackScore;
}

async function fetchPdfAsBlobUrl(url) {
  const response = await fetch(url, {
    cache: "no-store",
    credentials: "include"
  });

  if (!response.ok) {
    throw new Error(`Unable to load PDF (${response.status})`);
  }

  const blob = await response.blob();
  return URL.createObjectURL(blob);
}

function setupUi(settings) {
  strengthNode.value = String(settings.strength);
  applyStrength(settings.strength);

  strengthNode.addEventListener("input", async () => {
    const value = Number(strengthNode.value);
    applyStrength(value);
    await saveSettings({ strength: value });
  });

  toggleNode.addEventListener("change", () => {
    applyDarkMode(toggleNode.checked);
    const modeLabel = toggleNode.checked ? "Dark mode on" : "Dark mode off";
    setStatus(`${modeLabel} (auto suggestion: ${autoDetectedDark ? "dark" : "light"})`);
  });
}

async function start() {
  if (!pdfUrl) {
    showLoading(false);
    setStatus("Missing PDF URL. Open a PDF tab to use this extension.");
    toggleNode.disabled = true;
    strengthNode.disabled = true;
    return;
  }

  originalNode.href = pdfUrl;
  showLoading(true);

  const settings = await loadSettings();
  setupUi(settings);

  try {
    setStatus("Checking document theme...");
    const sample = await readSampleBytes(pdfUrl, SAMPLE_BYTES);
    autoDetectedDark = detectLightBackground(sample);

    toggleNode.checked = autoDetectedDark;
    applyDarkMode(autoDetectedDark);

    setStatus(autoDetectedDark ? "Light PDF detected. Dark mode applied." : "Dark PDF detected. Keeping original colors.");
  } catch (error) {
    autoDetectedDark = true;
    toggleNode.checked = true;
    applyDarkMode(true);
    setStatus(`Could not inspect colors (${error.message}). Dark mode applied by default.`);
  }

  try {
    setStatus("Rendering PDF...");
    objectUrl = await fetchPdfAsBlobUrl(pdfUrl);
    frameNode.src = objectUrl;
    frameNode.addEventListener(
      "load",
      () => {
        showLoading(false);
        if (autoDetectedDark) {
          setStatus("Dark mode is active.");
        } else {
          setStatus("Original colors are active.");
        }
      },
      { once: true }
    );
  } catch (error) {
    frameNode.src = pdfUrl;
    showLoading(false);
    setStatus(`Fell back to direct URL: ${error.message}`);
  }
}

window.addEventListener("beforeunload", () => {
  if (objectUrl) {
    URL.revokeObjectURL(objectUrl);
  }
});

start().catch((error) => {
  showLoading(false);
  setStatus(`Unexpected error: ${error.message}`);
});