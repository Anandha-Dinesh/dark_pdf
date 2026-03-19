import { handleRuntimeMessage } from "./messages.js";
import {
  clearBypassForTab,
  clearTabState,
  hasPdfMimeType,
  isExtensionViewerUrl,
  isLikelyPdfUrl,
  redirectToViewer,
} from "./navigation.js";

chrome.runtime.onMessage.addListener(handleRuntimeMessage);

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
    clearBypassForTab(tabId);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  clearTabState(tabId);
});
