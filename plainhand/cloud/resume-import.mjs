// Preview only: callers must explicitly save through Workspace.saveProfile.
// PDF.js Node example: https://github.com/mozilla/pdf.js/blob/master/examples/node/getinfo.mjs
// Pinned pdfjs-dist 6.5.438 requires Node >=22.13.0 (including the Node 22 serverless runtime).
export const RESUME_LIMITS = Object.freeze({ bytes: 2 * 1024 * 1024, pages: 20, characters: 100000 });
const PASTE = 'Paste your resume text instead, then review it before saving.';
export async function importResume({ name, content } = {}) {
  if (typeof name !== 'string' || !name.trim() || name.length > 200 || /[\\/\x00-\x1f\x7f]/.test(name) || name === '.' || name === '..') throw new Error('Choose a valid resume filename without folders.');
  if (!/\.(pdf|txt|md)$/i.test(name)) throw new Error('Choose a PDF, Markdown or plain text resume.');
  if (typeof content !== 'string' || !content.length || content.length > 4 * Math.ceil(RESUME_LIMITS.bytes / 3) || content.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(content)) throw new Error('Invalid or oversized file data. Choose a file under 2 MB.');
  const bytes = Buffer.from(content, 'base64');
  if (!bytes.length || bytes.length > RESUME_LIMITS.bytes || bytes.toString('base64') !== content) throw new Error('Invalid file data. Choose a file under 2 MB.');
  let text;
  if (/\.pdf$/i.test(name)) text = await extractPdf(bytes);
  else {
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch { throw new Error('This text file is not UTF-8. ' + PASTE); }
    if (text.includes('\0')) throw new Error('This is not a plain text resume. ' + PASTE);
  }
  if (text.length > RESUME_LIMITS.characters) throw new Error('Resume text exceeds 100,000 characters. Use a shorter resume or paste the relevant text.');
  if (!text.trim()) throw new Error('No readable text was found. ' + PASTE);
  return { text: text.trim(), preview: true };
}
async function extractPdf(bytes) {
  if (bytes.subarray(0, 5).toString() !== '%PDF-') throw new Error('This PDF could not be read. ' + PASTE);
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  // Explicit import lets serverless dependency tracing include the Node fake worker.
  // PDF.js installs its WorkerMessageHandler on globalThis when this module loads.
  await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
  const task = getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, useSystemFonts: false, disableFontFace: true, useWorkerFetch: false, stopAtErrors: true, verbosity: 0 });
  try {
    const pdf = await task.promise;
    if (pdf.numPages > RESUME_LIMITS.pages) throw new Error('PDF resumes must have 20 pages or fewer. ' + PASTE);
    let text = '';
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      try {
        const { items } = await page.getTextContent();
        for (const item of items) {
          if (typeof item.str === 'string') text += item.str + (item.hasEOL ? '\n' : ' ');
          if (text.length > RESUME_LIMITS.characters) throw new Error('Resume text exceeds 100,000 characters. ' + PASTE);
        }
        text += '\n';
      } finally { page.cleanup(); }
    }
    if (!text.trim()) throw new Error('This PDF has no selectable text (it may be a scan or image). ' + PASTE);
    return text;
  } catch (error) {
    if (error.name === 'PasswordException') throw new Error('This PDF is password protected. Export an unlocked copy or paste your resume text instead.');
    if (/pages or fewer|100,000|no selectable text/.test(error.message)) throw error;
    throw new Error('This PDF is damaged or cannot be read. ' + PASTE);
  } finally { await task.destroy(); }
}
