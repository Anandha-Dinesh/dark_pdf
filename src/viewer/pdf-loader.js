export async function fetchPdfPayload(url) {
  const response = await fetch(url, {
    cache: "no-store",
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error(`Unable to load PDF (${response.status})`);
  }

  const buffer = await response.arrayBuffer();
  const mimeType = response.headers.get("content-type") || "application/pdf";
  const blob = new Blob([buffer], { type: mimeType });

  return {
    bytes: new Uint8Array(buffer),
    objectUrl: URL.createObjectURL(blob),
  };
}
