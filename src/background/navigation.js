import {
  ORIGINAL_OPEN_BYPASS_MS,
  REDIRECT_COOLDOWN_MS,
  VIEWER_PAGE,
} from "./config.js";
import { bypassRedirectTabs, recentRedirects } from "./state.js";

export function isExtensionViewerUrl(url) {
  return (
    typeof url === "string" && url.startsWith(chrome.runtime.getURL(VIEWER_PAGE))
  );
}

export function hasPdfMimeType(responseHeaders = []) {
  return responseHeaders.some((header) => {
    if (!header || !header.name) {
      return false;
    }

    return (
      header.name.toLowerCase() === "content-type" &&
      typeof header.value === "string" &&
      header.value.toLowerCase().includes("application/pdf")
    );
  });
}

export function isLikelyPdfUrl(url) {
  return /\.pdf($|[?#])/i.test(url);
}

function hasRecentRedirect(tabId, targetUrl) {
  const key = `${tabId}:${targetUrl}`;
  const now = Date.now();
  const lastRedirectAt = recentRedirects.get(key);

  if (!lastRedirectAt) {
    recentRedirects.set(key, now);
    return false;
  }

  if (now - lastRedirectAt < REDIRECT_COOLDOWN_MS) {
    return true;
  }

  recentRedirects.set(key, now);
  return false;
}

export function setBypassForTab(tabId) {
  bypassRedirectTabs.set(tabId, Date.now() + ORIGINAL_OPEN_BYPASS_MS);
}

function hasBypassForTab(tabId) {
  const expiresAt = bypassRedirectTabs.get(tabId);

  if (!expiresAt) {
    return false;
  }

  if (Date.now() > expiresAt) {
    bypassRedirectTabs.delete(tabId);
    return false;
  }

  return true;
}

function buildViewerUrl(pdfUrl) {
  return `${chrome.runtime.getURL(VIEWER_PAGE)}?file=${encodeURIComponent(
    pdfUrl
  )}`;
}

export function redirectToViewer(tabId, pdfUrl) {
  if (tabId < 0 || !pdfUrl || isExtensionViewerUrl(pdfUrl)) {
    return;
  }

  if (hasBypassForTab(tabId) || hasRecentRedirect(tabId, pdfUrl)) {
    return;
  }

  chrome.tabs.update(tabId, { url: buildViewerUrl(pdfUrl) }, () => {
    if (chrome.runtime.lastError) {
      console.warn(
        "NoirPDF redirect skipped:",
        chrome.runtime.lastError.message
      );
    }
  });
}

export function clearBypassForTab(tabId) {
  bypassRedirectTabs.delete(tabId);
}

export function clearTabState(tabId) {
  const prefix = `${tabId}:`;

  for (const key of recentRedirects.keys()) {
    if (key.startsWith(prefix)) {
      recentRedirects.delete(key);
    }
  }

  clearBypassForTab(tabId);
}
