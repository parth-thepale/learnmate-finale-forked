import type { ParsedPdf, PdfImageMark, PdfLine, TextItem } from './types';

/**
 * Server-side PDF text-layer reader built on the existing pdfjs-dist dependency (legacy build for
 * Node). pdfjs 6 has no eval path; font loading and XFA are disabled and nothing in the PDF
 * (scripts, forms, actions) is executed. Output is
 * positioned lines (for numbering/option detection and column-aware tables) plus image positions
 * (so questions containing figures can be flagged for manual review).
 */

export const PDF_LIMITS = Object.freeze({ maxBytes: 25 * 1024 * 1024, maxPages: 150 });

export class PdfParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PdfParseError';
  }
}

type Matrix = [number, number, number, number, number, number];

function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

/** Groups text items into lines (same page, similar baseline) ordered left to right. */
export function groupItemsIntoLines(page: number, items: TextItem[], tolerance = 2): PdfLine[] {
  const sorted = items
    .filter((it) => it.text.trim().length > 0)
    .sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: PdfLine[] = [];
  for (const item of sorted) {
    const line = lines.find((l) => Math.abs(l.y - item.y) <= tolerance);
    if (line) line.items.push(item);
    else lines.push({ page, y: item.y, x: item.x, text: '', items: [item] });
  }
  for (const line of lines) {
    line.items.sort((a, b) => a.x - b.x);
    line.x = line.items[0].x;
    let text = '';
    let prevEnd: number | null = null;
    for (const item of line.items) {
      const gap = prevEnd === null ? 0 : item.x - prevEnd;
      const needsSpace = prevEnd !== null && gap > Math.max(1, item.height * 0.15) && !/\s$/.test(text) && !/^\s/.test(item.text);
      text += (needsSpace ? ' ' : '') + item.text;
      prevEnd = item.x + item.width;
    }
    line.text = text.replace(/\s+/g, ' ').trim();
  }
  return lines.sort((a, b) => b.y - a.y);
}

export async function parsePdf(bytes: Uint8Array): Promise<ParsedPdf> {
  if (bytes.byteLength > PDF_LIMITS.maxBytes) throw new PdfParseError('PDF is larger than the import limit.');
  if (new TextDecoder().decode(bytes.slice(0, 5)) !== '%PDF-') throw new PdfParseError('File is not a PDF.');

  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    disableFontFace: true,
    useSystemFonts: false,
    enableXfa: false,
    verbosity: 0,
  });
  let doc;
  try {
    doc = await task.promise;
  } catch (err) {
    await task.destroy();
    throw new PdfParseError(`Could not open PDF: ${err instanceof Error ? err.message : 'unknown error'}`);
  }

  try {
    if (doc.numPages > PDF_LIMITS.maxPages) throw new PdfParseError(`PDF has more than ${PDF_LIMITS.maxPages} pages.`);
    const OPS = pdfjs.OPS;
    const imageOps = new Set([OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageMaskXObject, OPS.paintImageXObjectRepeat]);
    const lines: PdfLine[] = [];
    const images: PdfImageMark[] = [];
    const pageHeights: number[] = [];

    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      pageHeights.push(page.getViewport({ scale: 1 }).viewBox[3]);
      const content = await page.getTextContent();
      const items: TextItem[] = [];
      for (const raw of content.items as Array<{ str?: string; transform?: number[]; width?: number; height?: number }>) {
        if (typeof raw.str !== 'string' || !raw.transform) continue;
        items.push({ text: raw.str, x: raw.transform[4], y: raw.transform[5], width: raw.width ?? 0, height: raw.height ?? 0 });
      }
      lines.push(...groupItemsIntoLines(p, items));

      const ops = await page.getOperatorList();
      const stack: Matrix[] = [];
      let ctm: Matrix = [1, 0, 0, 1, 0, 0];
      for (let i = 0; i < ops.fnArray.length; i++) {
        const fn = ops.fnArray[i];
        const args = ops.argsArray[i] as unknown[];
        if (fn === OPS.save) stack.push(ctm);
        else if (fn === OPS.restore) ctm = stack.pop() ?? [1, 0, 0, 1, 0, 0];
        else if (fn === OPS.transform) ctm = multiply(ctm, args as Matrix);
        else if (fn === OPS.paintFormXObjectBegin) {
          stack.push(ctm);
          const matrix = args?.[0] as Matrix | undefined;
          if (Array.isArray(matrix) && matrix.length === 6) ctm = multiply(ctm, matrix);
        } else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() ?? [1, 0, 0, 1, 0, 0];
        else if (imageOps.has(fn)) {
          const height = Math.abs(ctm[3]) || Math.abs(ctm[1]);
          const y = ctm[3] >= 0 ? ctm[5] : ctm[5] + ctm[3];
          images.push({ page: p, y, height });
        }
      }
      page.cleanup();
    }
    return { pageCount: doc.numPages, lines, images, pageHeights };
  } finally {
    await task.destroy();
  }
}
