export const statusNode = document.getElementById("status");
export const loadingNode = document.getElementById("loading");
export const frameNode = document.getElementById("pdfFrame");
export const toggleNode = document.getElementById("darkToggle");
export const strengthNode = document.getElementById("strength");
export const originalNode = document.getElementById("openOriginal");

const params = new URLSearchParams(window.location.search);

export const pdfUrl = params.get("file");
