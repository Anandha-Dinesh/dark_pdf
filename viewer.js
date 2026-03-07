const STORAGE_KEY = "darkPdfSettings";
const SAMPLE_BYTES = 250000;
const SEGMENTS_FOR_COLOR_SCAN = 3;

const VIVID_COLOR_THRESHOLD = 10;
const CMYK_COLOR_THRESHOLD = 5;

const statusNode = document.getElementById("status");
const loadingNode = document.getElementById("loading");
const frameNode = document.getElementById("pdfFrame");
const toggleNode = document.getElementById("darkToggle");
const strengthNode = document.getElementById("strength");
const originalNode = document.getElementById("openOriginal");
const DEFAULT_SETTINGS = {
  strength: 0.9,
};

const params = new URLSearchParams(window.location.search);
const pdfUrl = params.get("file");

let objectUrl = null;
let autoDetectedDark = true;
let autoSuggestion = "dark";

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
  const stored = result[STORAGE_KEY] ?? {};
  return {
    strength:
      typeof stored.strength === "number"
        ? stored.strength
        : DEFAULT_SETTINGS.strength,
  };
}

async function saveSettings(next) {
  await chrome.storage.local.set({ [STORAGE_KEY]: next });
}

async function fetchPdfPayload(url) {
  const response = await fetch(url, {
    cache: "no-store",
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error(`Unable to load PDF (${response.status})`);
  }

  const buffer = await response.arrayBuffer();
  const mimeType = response.headers.get("content-type") || "application/pdf";
  const blob = new Blob([buffer], { type: mimeType });

  return {
    bytes: new Uint8Array(buffer),
    objectUrl: URL.createObjectURL(blob),
  };
}

function concatByteArrays(parts) {
  const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
  const joined = new Uint8Array(totalLength);
  let offset = 0;

  for (const part of parts) {
    joined.set(part, offset);
    offset += part.length;
  }

  return joined;
}

function buildColorSampleBytes(bytes) {
  if (bytes.length <= SAMPLE_BYTES) {
    return bytes;
  }

  const segmentSize = Math.min(
    SAMPLE_BYTES,
    Math.floor(bytes.length / SEGMENTS_FOR_COLOR_SCAN)
  );
  if (segmentSize <= 0) {
    return bytes.slice(0, SAMPLE_BYTES);
  }

  const slices = [];
  slices.push(bytes.slice(0, segmentSize));

  if (SEGMENTS_FOR_COLOR_SCAN >= 3 && bytes.length > segmentSize * 2) {
    const middleStart = Math.max(
      0,
      Math.floor(bytes.length / 2) - Math.floor(segmentSize / 2)
    );
    slices.push(bytes.slice(middleStart, middleStart + segmentSize));
  }

  slices.push(bytes.slice(Math.max(0, bytes.length - segmentSize)));
  return concatByteArrays(slices);
}

function asciiMatchesAt(bytes, index, token) {
  if (index + token.length > bytes.length) {
    return false;
  }

  for (let i = 0; i < token.length; i += 1) {
    if (bytes[index + i] !== token.charCodeAt(i)) {
      return false;
    }
  }

  return true;
}

function hasAsciiToken(bytes, token) {
  for (let i = 0; i <= bytes.length - token.length; i += 1) {
    if (asciiMatchesAt(bytes, i, token)) {
      return true;
    }
  }

  return false;
}

function isWhitespaceByte(byte) {
  return (
    byte === 0x20 ||
    byte === 0x0d ||
    byte === 0x0a ||
    byte === 0x09 ||
    byte === 0x0c ||
    byte === 0x00
  );
}

function hasSubtypeImageObject(bytes) {
  for (let i = 0; i < bytes.length; i += 1) {
    if (!asciiMatchesAt(bytes, i, "/Subtype")) {
      continue;
    }

    const probeEnd = Math.min(bytes.length, i + 56);
    let j = i + 8;

    while (j < probeEnd) {
      if (isWhitespaceByte(bytes[j])) {
        j += 1;
        continue;
      }

      if (asciiMatchesAt(bytes, j, "/Image")) {
        return true;
      }

      if (bytes[j] === 0x2f) {
        break;
      }

      j += 1;
    }
  }

  return false;
}

function hasRasterFilterHints(bytes) {
  return (
    hasAsciiToken(bytes, "/DCTDecode") ||
    hasAsciiToken(bytes, "/JPXDecode") ||
    hasAsciiToken(bytes, "/JBIG2Decode") ||
    hasAsciiToken(bytes, "/CCITTFaxDecode")
  );
}

function hasImageObjects(bytes) {
  return hasSubtypeImageObject(bytes) || hasRasterFilterHints(bytes);
}

function isVividRgb(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const spread = max - min;

  if (max < 0.15 || min > 0.85) {
    return false;
  }
  if (spread <= 0.06) {
    return false;
  }

  const saturation = max === 0 ? 0 : spread / max;
  return saturation >= 0.22;
}

function countVividRgbOps(text) {
  const rgbRegex =
    /(-?(?:\d*\.\d+|\d+))\s+(-?(?:\d*\.\d+|\d+))\s+(-?(?:\d*\.\d+|\d+))\s+(?:rg|RG)\b/g;
  let count = 0;
  let scanned = 0;

  for (const match of text.matchAll(rgbRegex)) {
    if (scanned > 1800) {
      break;
    }

    const r = Number(match[1]);
    const g = Number(match[2]);
    const b = Number(match[3]);
    scanned += 1;

    if (
      [r, g, b].some((value) => Number.isNaN(value) || value < 0 || value > 1)
    ) {
      continue;
    }

    if (isVividRgb(r, g, b)) {
      count += 1;
    }
  }

  return count;
}

function countColorfulCmykOps(text) {
  const cmykRegex =
    /(-?(?:\d*\.\d+|\d+))\s+(-?(?:\d*\.\d+|\d+))\s+(-?(?:\d*\.\d+|\d+))\s+(-?(?:\d*\.\d+|\d+))\s+(?:k|K)\b/g;
  let count = 0;
  let scanned = 0;

  for (const match of text.matchAll(cmykRegex)) {
    if (scanned > 1200) {
      break;
    }

    const c = Number(match[1]);
    const m = Number(match[2]);
    const y = Number(match[3]);
    const k = Number(match[4]);
    scanned += 1;

    if (
      [c, m, y, k].some(
        (value) => Number.isNaN(value) || value < 0 || value > 1
      )
    ) {
      continue;
    }

    const colorfulChannels = [c, m, y].filter((value) => value > 0.08).length;
    if (colorfulChannels >= 2 || (colorfulChannels >= 1 && k < 0.6)) {
      count += 1;
    }
  }

  return count;
}

function analyzePdfTheme(bytes) {
  const colorScanBytes = buildColorSampleBytes(bytes);
  const text = new TextDecoder("latin1", { fatal: false }).decode(
    colorScanBytes
  );

  const whiteRgb = (
    text.match(/\b1(?:\.0+)?\s+1(?:\.0+)?\s+1(?:\.0+)?\s+(?:rg|RG)\b/g) || []
  ).length;
  const whiteGray = (text.match(/\b1(?:\.0+)?\s+(?:g|G)\b/g) || []).length;

  const blackRgb = (
    text.match(/\b0(?:\.0+)?\s+0(?:\.0+)?\s+0(?:\.0+)?\s+(?:rg|RG)\b/g) || []
  ).length;
  const blackGray = (text.match(/\b0(?:\.0+)?\s+(?:g|G)\b/g) || []).length;

  const vividRgbCount = countVividRgbOps(text);
  const cmykColorCount = countColorfulCmykOps(text);
  const containsImage = hasImageObjects(bytes);

  const whiteScore = whiteRgb * 1.1 + whiteGray;
  const blackScore = blackRgb * 1.1 + blackGray;

  const preserveOriginalColors =
    containsImage ||
    vividRgbCount >= VIVID_COLOR_THRESHOLD ||
    cmykColorCount >= CMYK_COLOR_THRESHOLD;

  const looksLightBackground = whiteScore >= blackScore;
  const shouldUseDarkMode = looksLightBackground && !preserveOriginalColors;

  return {
    shouldUseDarkMode,
    preserveOriginalColors,
    looksLightBackground,
    containsImage,
  };
}

function setupUi(settings) {
  strengthNode.value = String(settings.strength);
  applyStrength(settings.strength);
  toggleNode.checked = true;
  applyDarkMode(true);

  strengthNode.addEventListener("input", async () => {
    const value = Number(strengthNode.value);
    applyStrength(value);
    await saveSettings({ strength: value });
  });

  toggleNode.addEventListener("change", () => {
    applyDarkMode(toggleNode.checked);
    const modeLabel = toggleNode.checked ? "Dark mode on" : "Dark mode off";
    setStatus(`${modeLabel} (auto suggestion: ${autoSuggestion})`);
  });
}

async function openOriginalPdfInSeparateTab(event) {
  event.preventDefault();

  if (!pdfUrl) {
    return;
  }

  try {
    const response = await chrome.runtime.sendMessage({
      type: "openOriginalPdf",
      url: pdfUrl,
    });

    if (response?.ok) {
      setStatus("Opened original PDF in a separate tab.");
      return;
    }

    throw new Error(response?.error || "Could not open original tab.");
  } catch (error) {
    window.open(pdfUrl, "_blank", "noopener,noreferrer");
    setStatus(`Opened original URL directly (${error.message}).`);
  }
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
  originalNode.addEventListener("click", openOriginalPdfInSeparateTab);
  showLoading(true);

  const settings = await loadSettings();
  setupUi(settings);

  try {
    setStatus("Downloading PDF...");
    const payload = await fetchPdfPayload(pdfUrl);
    objectUrl = payload.objectUrl;

    try {
      setStatus("Checking document theme...");
      const analysis = analyzePdfTheme(payload.bytes);

      autoDetectedDark = analysis.shouldUseDarkMode;
      autoSuggestion = autoDetectedDark ? "dark" : "light";

      if (analysis.containsImage) {
        autoSuggestion = "preserve-colors";
        setStatus("Images detected. Suggesting original colors.");
      } else if (analysis.preserveOriginalColors) {
        autoSuggestion = "preserve-colors";
        setStatus("Charts/colors detected. Suggesting original colors.");
      } else if (analysis.shouldUseDarkMode) {
        setStatus("Light PDF detected. Dark mode suggested.");
      } else if (analysis.looksLightBackground) {
        setStatus("Light PDF detected, but source colors suggested.");
      } else {
        setStatus("Dark PDF detected. Original colors suggested.");
      }
    } catch (error) {
      autoDetectedDark = toggleNode.checked;
      autoSuggestion = toggleNode.checked ? "dark" : "light";
      setStatus(
        `Could not inspect colors (${error.message}). Using current mode.`
      );
    }

    setStatus("Rendering PDF...");
    frameNode.src = objectUrl;
    frameNode.addEventListener(
      "load",
      () => {
        showLoading(false);
        if (toggleNode.checked) {
          setStatus("Dark mode is active.");
        } else {
          setStatus("Original colors are active.");
        }
      },
      { once: true }
    );
  } catch (error) {
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      objectUrl = null;
    }

    autoDetectedDark = toggleNode.checked;
    autoSuggestion = toggleNode.checked ? "dark" : "light";

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

