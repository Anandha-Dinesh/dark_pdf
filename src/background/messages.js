import { OPEN_ORIGINAL_MESSAGE } from "./config.js";
import { setBypassForTab } from "./navigation.js";

export function handleRuntimeMessage(message, _sender, sendResponse) {
  if (!message || message.type !== OPEN_ORIGINAL_MESSAGE) {
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
}
