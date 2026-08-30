/* PDF viewer for the exam split-pane. Vendored PDF.js only — no network fetch,
   so the "fully offline" property holds and no remote code enters the origin. */

async function ensurePdfJs() {
  if (window.pdfjsLib) return window.pdfjsLib;
  try {
    const mod = await import('/vendor/pdfjs/pdf.min.mjs');
    window.pdfjsLib = mod;
    mod.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.mjs';
    return mod;
  } catch (e) {
    return null;
  }
}

export async function renderPdf(container, url) {
  const toolbar = document.createElement('div');
  toolbar.className = 'pdf-toolbar';
  const span = document.createElement('span');
  span.textContent = 'Source document';
  toolbar.appendChild(span);
  const info = document.createElement('span');
  info.id = 'pdfPageInfo';
  toolbar.appendChild(info);
  const loading = document.createElement('p');
  loading.className = 'muted';
  loading.textContent = 'Loading document…';
  container.replaceChildren(toolbar, loading);

  const lib = await ensurePdfJs();
  if (!lib || !url) {
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = 'No PDF available for this test. Question content stands alone. ' +
      'Place a PDF at the path named in the test file (sourcePdf) to view it here.';
    container.replaceChildren(toolbar, p);
    return;
  }
  try {
    const doc = await lib.getDocument(url).promise;
    // Server-side parse_pdf (anydoc) is the authoritative scanned/text signal; this pane just renders.
    const pagesEl = document.createElement('div');
    pagesEl.id = 'pdfPages';
    toolbar.appendChild(info);
    container.replaceChildren(toolbar, pagesEl);
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
      info.textContent = i + ' / ' + doc.numPages;
    }
  } catch (e) {
    // No URLs in messages: only the bare relative filename, nothing browser-origin derived.
    const name = String(url).split('/').pop();
    const p = document.createElement('p');
    p.className = 'error-text';
    p.textContent = 'Could not load the PDF (missing file "' + name + '"). ' +
      'The exam can still be taken without it.';
    container.replaceChildren(toolbar, p);
  }
}