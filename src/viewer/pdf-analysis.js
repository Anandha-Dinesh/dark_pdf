import {
  CMYK_COLOR_THRESHOLD,
  SAMPLE_BYTES,
  SEGMENTS_FOR_COLOR_SCAN,
  VIVID_COLOR_THRESHOLD,
} from "./config.js";

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

  const slices = [bytes.slice(0, segmentSize)];

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
    let cursor = i + 8;

    while (cursor < probeEnd) {
      if (isWhitespaceByte(bytes[cursor])) {
        cursor += 1;
        continue;
      }

      if (asciiMatchesAt(bytes, cursor, "/Image")) {
        return true;
      }

      if (bytes[cursor] === 0x2f) {
        break;
      }

      cursor += 1;
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

  if (max < 0.15 || min > 0.85 || spread <= 0.06) {
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

export function analyzePdfTheme(bytes) {
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

  return {
    shouldUseDarkMode: whiteScore >= blackScore && !preserveOriginalColors,
    preserveOriginalColors,
    looksLightBackground: whiteScore >= blackScore,
    containsImage,
  };
}
