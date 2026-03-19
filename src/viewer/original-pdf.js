const OPEN_ORIGINAL_MESSAGE = "openOriginalPdf";

export async function openOriginalPdfInSeparateTab(pdfUrl) {
  const response = await chrome.runtime.sendMessage({
    type: OPEN_ORIGINAL_MESSAGE,
    url: pdfUrl,
  });

  if (response?.ok) {
    return;
  }

  throw new Error(response?.error || "Could not open original tab.");
}
