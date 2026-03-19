import { loadingNode, statusNode } from "./dom.js";
import { createViewerApp } from "./app.js";
import { setStatus, showLoading } from "./ui.js";

const app = createViewerApp();

window.addEventListener("beforeunload", () => {
  app.dispose();
});

app.start().catch((error) => {
  app.dispose();
  showLoading(loadingNode, false);
  setStatus(statusNode, `Unexpected error: ${error.message}`);
});
