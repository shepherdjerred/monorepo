import type * as Pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

export type PdfModule = typeof Pdfjs;
export type PdfDocument = Pdfjs.PDFDocumentProxy;
export type PdfPageProxy = Pdfjs.PDFPageProxy;

let loading: Promise<PdfModule> | undefined;

/**
 * Loads pdf.js (the legacy build, which runs without newer JS features) on
 * first use, with its worker as a module worker Vite bundles.
 */
export function loadPdfjs(): Promise<PdfModule> {
  loading ??= import("pdfjs-dist/legacy/build/pdf.mjs").then((module) => {
    module.GlobalWorkerOptions.workerPort = new Worker(
      new URL("pdfjs-dist/legacy/build/pdf.worker.mjs", import.meta.url),
      { type: "module" },
    );
    return module;
  });
  return loading;
}

/** Opens a PDF from the content host, loading it by ranges as pages are needed. */
export async function openPdf(
  url: string,
  signal: AbortSignal,
): Promise<PdfDocument> {
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument({
    url,
    rangeChunkSize: 65_536,
    disableAutoFetch: true,
    withCredentials: false,
  });
  signal.addEventListener("abort", () => {
    void task.destroy();
  });
  return task.promise;
}
