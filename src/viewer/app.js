import {
  frameNode,
  loadingNode,
  originalNode,
  pdfUrl,
  statusNode,
  strengthNode,
  toggleNode,
} from "./dom.js";
import { analyzePdfTheme } from "./pdf-analysis.js";
import { fetchPdfPayload } from "./pdf-loader.js";
import { openOriginalPdfInSeparateTab } from "./original-pdf.js";
import { loadSettings, saveSettings } from "./settings.js";
import { initializeControls, setStatus, showLoading } from "./ui.js";

export function createViewerApp() {
  const state = {
    autoSuggestion: "dark",
    objectUrl: null,
  };

  function revokeObjectUrl() {
    if (state.objectUrl) {
      URL.revokeObjectURL(state.objectUrl);
      state.objectUrl = null;
    }
  }

  function setToggleStatus(enabled) {
    const modeLabel = enabled ? "Dark mode on" : "Dark mode off";
    setStatus(
      statusNode,
      `${modeLabel} (auto suggestion: ${state.autoSuggestion})`
    );
  }

  async function handleOpenOriginalClick(event) {
    event.preventDefault();

    if (!pdfUrl) {
      return;
    }

    try {
      await openOriginalPdfInSeparateTab(pdfUrl);
      setStatus(statusNode, "Opened original PDF in a separate tab.");
    } catch (error) {
      window.open(pdfUrl, "_blank", "noopener,noreferrer");
      setStatus(statusNode, `Opened original URL directly (${error.message}).`);
    }
  }

  function updateSuggestionFromCurrentToggle() {
    state.autoSuggestion = toggleNode.checked ? "dark" : "light";
  }

  async function start() {
    if (!pdfUrl) {
      showLoading(loadingNode, false);
      setStatus(
        statusNode,
        "Missing PDF URL. Open a PDF tab to use this extension."
      );
      toggleNode.disabled = true;
      strengthNode.disabled = true;
      return;
    }

    originalNode.href = pdfUrl;
    originalNode.addEventListener("click", handleOpenOriginalClick);
    showLoading(loadingNode, true);

    const settings = await loadSettings();

    initializeControls({
      frameNode,
      settings,
      strengthNode,
      toggleNode,
      onStrengthChange: async (value) => {
        await saveSettings({ strength: value });
      },
      onToggleChange: (enabled) => {
        setToggleStatus(enabled);
      },
    });

    try {
      setStatus(statusNode, "Downloading PDF...");
      const payload = await fetchPdfPayload(pdfUrl);
      state.objectUrl = payload.objectUrl;

      try {
        setStatus(statusNode, "Checking document theme...");
        const analysis = analyzePdfTheme(payload.bytes);

        if (analysis.containsImage) {
          state.autoSuggestion = "preserve-colors";
          setStatus(statusNode, "Images detected. Suggesting original colors.");
        } else if (analysis.preserveOriginalColors) {
          state.autoSuggestion = "preserve-colors";
          setStatus(
            statusNode,
            "Charts/colors detected. Suggesting original colors."
          );
        } else if (analysis.shouldUseDarkMode) {
          state.autoSuggestion = "dark";
          setStatus(statusNode, "Light PDF detected. Dark mode suggested.");
        } else if (analysis.looksLightBackground) {
          state.autoSuggestion = "light";
          setStatus(
            statusNode,
            "Light PDF detected, but source colors suggested."
          );
        } else {
          state.autoSuggestion = "light";
          setStatus(statusNode, "NoirPDF detected. Original colors suggested.");
        }
      } catch (error) {
        updateSuggestionFromCurrentToggle();
        setStatus(
          statusNode,
          `Could not inspect colors (${error.message}). Using current mode.`
        );
      }

      setStatus(statusNode, "Rendering PDF...");
      frameNode.src = state.objectUrl;
      frameNode.addEventListener(
        "load",
        () => {
          showLoading(loadingNode, false);
          setStatus(
            statusNode,
            toggleNode.checked
              ? "Dark mode is active."
              : "Original colors are active."
          );
        },
        { once: true }
      );
    } catch (error) {
      revokeObjectUrl();
      updateSuggestionFromCurrentToggle();
      frameNode.src = pdfUrl;
      showLoading(loadingNode, false);
      setStatus(statusNode, `Fell back to direct URL: ${error.message}`);
    }
  }

  function dispose() {
    revokeObjectUrl();
  }

  return {
    dispose,
    start,
  };
}
