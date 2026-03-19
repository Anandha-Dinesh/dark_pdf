export function setStatus(statusNode, text) {
  statusNode.textContent = text;
}

export function showLoading(loadingNode, show) {
  loadingNode.classList.toggle("hidden", !show);
}

export function applyDarkMode(frameNode, enabled) {
  frameNode.classList.toggle("dark", enabled);
}

export function applyStrength(value) {
  document.documentElement.style.setProperty("--strength", String(value));
}

export function initializeControls({
  frameNode,
  settings,
  strengthNode,
  toggleNode,
  onStrengthChange,
  onToggleChange,
}) {
  strengthNode.value = String(settings.strength);
  applyStrength(settings.strength);
  toggleNode.checked = true;
  applyDarkMode(frameNode, true);

  strengthNode.addEventListener("input", () => {
    const value = Number(strengthNode.value);
    applyStrength(value);
    void onStrengthChange(value);
  });

  toggleNode.addEventListener("change", () => {
    applyDarkMode(frameNode, toggleNode.checked);
    onToggleChange(toggleNode.checked);
  });
}
