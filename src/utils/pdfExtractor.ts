import * as pdfjsLib from 'pdfjs-dist';
import type { StudyPage } from '../types/study';
import { MAX_PDF_PAGES, MAX_PDF_SIZE_BYTES } from './quizGrading';

// Configure PDF.js worker using Vite's asset URL import
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export interface ExtractedPdfResult {
  pageCount: number;
  pages: StudyPage[];
  pdfDataUrl: string;
  isScanned?: boolean;
  metadata?: {
    format: 'digital' | 'scanned';
    charCount: number;
    cached?: boolean;
  };
}

const pdfExtractionCache = new Map<string, ExtractedPdfResult>();

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Failed to read PDF file.'));
    reader.readAsDataURL(file);
  });
}

/**
 * Extracts page-indexed text from an uploaded PDF file using PDF.js.
 * Validates file type, size (<= 20 MB), and page count (<= 20 pages).
 */
export async function extractPagesFromPdf(file: File): Promise<ExtractedPdfResult> {
  if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
    throw new Error('Please select a valid PDF file (.pdf).');
  }

  if (file.size > MAX_PDF_SIZE_BYTES) {
    throw new Error('PDF file exceeds the 20 MB size limit.');
  }

  const cacheKey = `${file.name}_${file.size}_${file.lastModified}`;
  const cached = pdfExtractionCache.get(cacheKey);
  if (cached) {
    return {
      ...cached,
      metadata: {
        ...(cached.metadata || { format: 'digital', charCount: 0 }),
        cached: true,
      },
    };
  }

  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) });
  const pdfDoc = await loadingTask.promise;

  if (pdfDoc.numPages < 1) {
    throw new Error('The uploaded PDF has no readable pages.');
  }

  if (pdfDoc.numPages > MAX_PDF_PAGES) {
    throw new Error(
      `This PDF has ${pdfDoc.numPages} pages. Please upload a PDF with up to ${MAX_PDF_PAGES} pages.`
    );
  }

  const pages: StudyPage[] = [];

  for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
    const page = await pdfDoc.getPage(pageNum);
    const textContent = await page.getTextContent();
    const lines: string[] = [];
    let currentLine = '';
    let lastY: number | null = null;

    for (const item of textContent.items) {
      if ('str' in item) {
        const y = Array.isArray(item.transform) ? item.transform[5] : null;
        if (lastY !== null && y !== null && Math.abs(y - lastY) > 6) {
          if (currentLine.trim()) lines.push(currentLine.trim());
          currentLine = item.str;
        } else {
          currentLine += (currentLine && !currentLine.endsWith(' ') ? ' ' : '') + item.str;
        }
        if (y !== null) lastY = y;
      }
    }
    if (currentLine.trim()) lines.push(currentLine.trim());

    const pageText = lines.join('\n').trim();
    const firstNonEmpty = lines.find((l) => l.length > 3) || `Page ${pageNum}`;
    const cleanTitle =
      firstNonEmpty.length <= 68 ? firstNonEmpty : `${firstNonEmpty.slice(0, 65)}...`;

    pages.push({
      pageNumber: pageNum,
      title: cleanTitle,
      content: pageText || `[Page ${pageNum} contains visual diagrams or non-selectable text]`,
    });
  }

  const totalExtractedChars = pages.reduce((sum, p) => sum + p.content.length, 0);
  if (totalExtractedChars < 20) {
    throw new Error(
      'Could not extract readable text from this PDF. It may be a scanned image without OCR.'
    );
  }

  // Keep base64 PDF data URL if reasonably sized (< 4MB) for canvas page rendering
  let pdfDataUrl = '';
  if (file.size <= 4 * 1024 * 1024) {
    pdfDataUrl = await readFileAsDataUrl(file);
  }

  const isScanned = totalExtractedChars < Math.max(30, pages.length * 25);
  const result: ExtractedPdfResult = {
    pageCount: pdfDoc.numPages,
    pages,
    pdfDataUrl,
    isScanned,
    metadata: {
      format: isScanned ? 'scanned' : 'digital',
      charCount: totalExtractedChars,
      cached: false,
    },
  };
  pdfExtractionCache.set(cacheKey, result);
  return result;
}

/**
 * Renders a specific 1-indexed page from a PDF data URL onto a target HTMLCanvasElement.
 */
export async function renderPdfPageToCanvas(
  pdfDataUrl: string,
  pageNumber: number,
  canvas: HTMLCanvasElement,
  scale = 1.25
): Promise<void> {
  const base64Index = pdfDataUrl.indexOf('base64,');
  const base64 = base64Index >= 0 ? pdfDataUrl.slice(base64Index + 7) : pdfDataUrl;
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  const loadingTask = pdfjsLib.getDocument({ data: bytes });
  const pdfDoc = await loadingTask.promise;
  const clampedPage = Math.max(1, Math.min(pageNumber, pdfDoc.numPages));
  const page = await pdfDoc.getPage(clampedPage);
  const viewport = page.getViewport({ scale });

  const context = canvas.getContext('2d');
  if (!context) return;

  canvas.height = viewport.height;
  canvas.width = viewport.width;

  await page.render({
    canvasContext: context,
    viewport,
    canvas,
  }).promise;
}
