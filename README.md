# NoirPDF Auto Theme Extension

This Chrome extension watches for PDF navigations and opens them in a custom viewer that can auto-switch to a dark-friendly reading mode.

## What it does

- Detects PDF pages by response `Content-Type` (`application/pdf`) and by `.pdf` URL fallback.
- Redirects the tab to `viewer.html` inside the extension.
- Downloads the PDF in the viewer and renders it via browser PDF engine from a blob URL.
- Uses a lightweight heuristic on PDF stream commands to guess whether the document is light-themed.
- Applies dark mode automatically when a light background is detected.
- Exposes manual controls for `Dark Mode` and `Intensity`.

## Project structure

- `src/background/` contains the service worker logic for PDF detection, redirects, and background messaging.
- `src/viewer/` contains the viewer app split into DOM access, UI helpers, settings, PDF loading, and theme analysis.
- `assets/` stores the extension branding and icons used by the viewer and manifest.
- Root files such as `manifest.json`, `viewer.html`, and `viewer.css` stay as Chrome entrypoints and static assets.

## Load it in Chrome

1. Open `chrome://extensions`.
2. Enable `Developer mode`.
3. Click `Load unpacked` and select this folder: `D:\dark_pdf`.
4. Open any PDF URL in a tab.

## Notes and limits

- Theme detection is heuristic-based and may be wrong for scanned or image-heavy PDFs.
- Sites requiring special auth/cookies can block PDF fetching in some cases.
- For local `file://` PDFs, enable **Allow access to file URLs** in the extension card.
- This implementation targets Chromium-style browsers (Chrome/Edge/Brave).
