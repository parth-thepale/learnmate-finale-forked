import { parseAnswerKeyText } from '../answerKeyExtractor';
import type { PoliteFetcher } from '../fetcher';
import { parsePdf } from '../pdfParser';
import { extractQuestions, type ExtractionResult } from '../questionExtractor';
import type { AnswerKeyDocument, PaperDescriptor, ParsedPdf, SourceDefinition, SourceDocument } from '../types';

/**
 * Source-specific behaviour lives in adapters. Adding a permitted source means: a reviewed entry
 * in sourceRegistry.ts + an adapter registered below. The importer, normaliser, validation,
 * duplicate detection and draft writing are shared and need no changes.
 *
 * Adapters may only read and interpret documents. They never write files, never choose the
 * verification status and never fetch except through the PoliteFetcher they are given.
 */
export interface SourceAdapter {
  id: string;
  /** Lists papers published by the source. Only for network sources with fetching enabled. */
  discover?(source: SourceDefinition, fetcher: PoliteFetcher): Promise<PaperDescriptor[]>;
  /** Turns the paper document into positioned lines. Defaults to the shared PDF text reader. */
  parsePaper?(document: SourceDocument): Promise<ParsedPdf>;
  /** Splits the parsed paper into questions. Set sourceQuestionId / sourceOptionId when available. */
  extract(parsed: ParsedPdf): ExtractionResult;
  parseAnswerKey(
    document: SourceDocument,
    meta: { type: 'final' | 'provisional'; version: string }
  ): Promise<AnswerKeyDocument>;
}

/** Manually supplied text-layer PDFs with a CSV/TXT (or simple text PDF) answer key. */
export const manualPdfAdapter: SourceAdapter = {
  id: 'manual-pdf',
  extract: extractQuestions,
  async parseAnswerKey(document, meta) {
    let text: string;
    if (document.contentType === 'application/pdf') {
      const parsed = await parsePdf(document.bytes);
      text = parsed.lines.map((l) => l.text).join('\n');
    } else {
      text = new TextDecoder('utf-8', { fatal: false }).decode(document.bytes);
    }
    return parseAnswerKeyText(text, { ...meta, sourceUrl: document.url, fileSha256: document.sha256 });
  },
};

const ADAPTERS: Record<string, SourceAdapter> = {
  [manualPdfAdapter.id]: manualPdfAdapter,
  // 'nta-jee-main': intentionally absent until NTA reuse permission is recorded in the registry.
};

export type AdapterLookup = (id: string) => SourceAdapter | undefined;

export function getAdapter(id: string): SourceAdapter | undefined {
  return ADAPTERS[id];
}
