/* Offline PDF.js viewer for the exam split-pane. No fallback remote fetch:
   if the CDN is unreachable and no local copy exists, the PDF pane shows a note. */
const PDFJS_BASE = 'vendor/pdfjs';

async function ensurePdfJs() {
  if (window.pdfjsLib) return window.pdfjsLib;
  for (const url of ['vendor/pdfjs/pdf.min.mjs', 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs']) {
    try {
      const mod = await import(url);
      window.pdfjsLib = mod;
      mod.GlobalWorkerOptions.workerSrc = url.replace('pdf.min.mjs', 'pdf.worker.min.mjs');
      return mod;
    } catch (e) { /* try next source */ }
  }
  return null;
}

export async function renderPdf(container, url) {
  container.innerHTML = '<div class="pdf-toolbar"><span>Source document</span></div><p class="muted">Loading document…</p>';
  const lib = await ensurePdfJs();
  if (!lib || !url) {
    container.innerHTML = '<div class="pdf-toolbar">Source document</div><p class="muted">No PDF available for this test. ' +
      'Question content stands alone. Place a PDF at the path named in the test file (sourcePdf) to view it here.</p>';
    return;
  }
  try {
    const doc = await lib.getDocument(url).promise;
    // Server-side parse_pdf (anydoc) is the authoritative scanned/text signal; this pane just renders.
    container.innerHTML = '<div class="pdf-toolbar"><span>Source document</span> <span id="pdfPageInfo"></span></div><div id="pdfPages"></div>';
    const pagesEl = container.querySelector('#pdfPages');
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const base = page.getViewport({ scale: 1 });
      const targetWidth = container.clientWidth - 24;
      const scale = Math.max(1, Math.min(targetWidth / base.width, 2));
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      pagesEl.appendChild(canvas);
      await page.render({ canvas, canvasContext: canvas.getContext('2d'), viewport }).promise;
    }
  } catch (e) {
    // Show only the relative path, never an absolute origin (could leak host URLs in screenshots).
    const scrub = s => String(s || '').replace(/^https?:\/\/[^/\s]+/ig, '')
                                .replace(/^https?:\/\/[^/\s"']+\.["']/ig, '"').replace(/\s+/g, ' ').trim();
    const rel = scrub(url);
    const msg = scrub(e && e.message || e);
    container.innerHTML = '<div class="pdf-toolbar">Source document</div>' +
      '<p class="error-text">Could not load the PDF (missing file "' + rel + '"). ' +
      'The exam can still be taken without it.</p>';
  }
}