const REDIRECT_COOLDOWN_MS = 2500;
const recentRedirects = new Map();

function isExtensionViewerUrl(url) {
  return url.startsWith(chrome.runtime.getURL("viewer.html"));
}

function hasPdfMimeType(responseHeaders = []) {
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

function isLikelyPdfUrl(url) {
  return /\.pdf($|[?#])/i.test(url);
}

function hasRecentRedirect(tabId, targetUrl) {
  const key = `${tabId}:${targetUrl}`;
  const now = Date.now();
  const ts = recentRedirects.get(key);
  if (!ts) {
    recentRedirects.set(key, now);
    return false;
  }
  if (now - ts < REDIRECT_COOLDOWN_MS) {
    return true;
  }
  recentRedirects.set(key, now);
  return false;
}

function redirectToViewer(tabId, pdfUrl) {
  if (tabId < 0 || !pdfUrl || isExtensionViewerUrl(pdfUrl)) {
    return;
  }

  if (hasRecentRedirect(tabId, pdfUrl)) {
    return;
  }

  const viewerUrl = `${chrome.runtime.getURL("viewer.html")}?file=${encodeURIComponent(pdfUrl)}`;

  chrome.tabs.update(tabId, { url: viewerUrl }, () => {
    if (chrome.runtime.lastError) {
      console.warn("Dark PDF redirect skipped:", chrome.runtime.lastError.message);
    }
  });
}

chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    if (details.type !== "main_frame") {
      return;
    }
    if (!details.url || isExtensionViewerUrl(details.url)) {
      return;
    }
    if (hasPdfMimeType(details.responseHeaders)) {
      redirectToViewer(details.tabId, details.url);
    }
  },
  { urls: ["<all_urls>"], types: ["main_frame"] },
  ["responseHeaders"]
);

chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId !== 0) {
    return;
  }
  if (!details.url || isExtensionViewerUrl(details.url)) {
    return;
  }
  if (isLikelyPdfUrl(details.url)) {
    redirectToViewer(details.tabId, details.url);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  const prefix = `${tabId}:`;
  for (const key of recentRedirects.keys()) {
    if (key.startsWith(prefix)) {
      recentRedirects.delete(key);
    }
  }
});