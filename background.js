const REDIRECT_COOLDOWN_MS = 2500;
const ORIGINAL_OPEN_BYPASS_MS = 12000;
const recentRedirects = new Map();
const bypassRedirectTabs = new Map();

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

function setBypassForTab(tabId) {
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

function redirectToViewer(tabId, pdfUrl) {
  if (tabId < 0 || !pdfUrl || isExtensionViewerUrl(pdfUrl)) {
    return;
  }

  if (hasBypassForTab(tabId)) {
    return;
  }

  if (hasRecentRedirect(tabId, pdfUrl)) {
    return;
  }

  const viewerUrl = `${chrome.runtime.getURL(
    "viewer.html"
  )}?file=${encodeURIComponent(pdfUrl)}`;

  chrome.tabs.update(tabId, { url: viewerUrl }, () => {
    if (chrome.runtime.lastError) {
      console.warn(
        "NoirPDF redirect skipped:",
        chrome.runtime.lastError.message
      );
    }
  });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== "openOriginalPdf") {
    return;
  }

  if (typeof message.url !== "string" || !message.url) {
    sendResponse({ ok: false, error: "Invalid original PDF URL." });
    return;
  }

  chrome.tabs.create({ url: message.url }, (tab) => {
    if (chrome.runtime.lastError || !tab || typeof tab.id !== "number") {
      sendResponse({
        ok: false,
        error:
          chrome.runtime.lastError?.message || "Could not open original tab.",
      });
      return;
    }

    setBypassForTab(tab.id);
    sendResponse({ ok: true });
  });

  return true;
});

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

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "complete") {
    bypassRedirectTabs.delete(tabId);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  const prefix = `${tabId}:`;
  for (const key of recentRedirects.keys()) {
    if (key.startsWith(prefix)) {
      recentRedirects.delete(key);
    }
  }

  bypassRedirectTabs.delete(tabId);
});
