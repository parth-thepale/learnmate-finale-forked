import type { JeeSubjectId } from '../../data/jeeMainSyllabus';
import type { LicenceBasis } from '../../types/questionBank';

/**
 * Question acquisition pipeline types.
 *
 * Flow: source registry → adapter (discover / fetch or manual file) → PDF/HTML parsing →
 * question + answer-key extraction → normalisation into BankQuestion drafts → duplicate check →
 * draft-bank import (data/question-bank/drafts/imports/) + import log. Nothing in this pipeline
 * can mark a question verified.
 */

export type SourceKind =
  | 'official_paper'
  | 'official_answer_key'
  | 'third_party_pyq'
  | 'third_party_mock'
  | 'manual_upload';

/** Outcome of the legal/reuse review for a source. Only reviewed sources can be imported from. */
export type SourceReuseStatus =
  | 'not_reviewed'
  | 'permission_required'
  | 'permission_granted'
  | 'own_content'
  | 'prohibited'
  | 'declared_per_import';

export interface SourceDefinition {
  id: string;
  name: string;
  kind: SourceKind;
  owner: string;
  /** Exact hostnames that may be fetched for this source (https only). Empty for manual uploads. */
  allowedHosts: string[];
  termsUrl?: string;
  reuse: {
    status: SourceReuseStatus;
    summary: string;
    reviewedOn?: string;
    permissionReference?: string;
  };
  robots: { checkedOn?: string; summary: string };
  formats: string[];
  /** Network fetching / discovery allowed for this source. */
  fetchEnabled: boolean;
  /** Importing into the draft bank allowed for this source. */
  importEnabled: boolean;
  /** Whether original files may be retained on disk after import. */
  retainSourceFiles: boolean;
  adapterId: string;
  notes?: string;
}

export interface SourceDocument {
  sourceId: string;
  url?: string;
  fileName: string;
  bytes: Uint8Array;
  sha256: string;
  retrievedAt: string;
  contentType: 'application/pdf' | 'text/html' | 'text/csv' | 'text/plain' | 'application/json';
}

export interface PaperDescriptor {
  paperId: string;
  title: string;
  exam?: 'JEE Main';
  year?: number;
  session?: 1 | 2;
  date?: string;
  shift?: 1 | 2;
  paperUrl?: string;
  answerKeyUrl?: string;
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

export interface TextItem {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PdfLine {
  page: number;
  y: number;
  x: number;
  text: string;
  items: TextItem[];
}

export interface PdfImageMark {
  page: number;
  /** Bottom-left y of the image in PDF user space. */
  y: number;
  height: number;
}

export interface ParsedPdf {
  pageCount: number;
  lines: PdfLine[];
  images: PdfImageMark[];
  pageHeights: number[];
}

export type ExtractionIssueCode =
  | 'figure_present'
  | 'math_notation_unreliable'
  | 'option_count_mismatch'
  | 'stem_missing'
  | 'type_unknown'
  | 'subject_unknown'
  | 'numbering_gap'
  | 'answer_missing'
  | 'answer_invalid'
  | 'answer_provisional'
  | 'answer_conflict'
  | 'duplicate_option_text'
  | 'classification_pending';

export interface ExtractionIssue {
  code: ExtractionIssueCode;
  message: string;
}

export interface ExtractedOption {
  /** Normalised A–D label. */
  label: 'A' | 'B' | 'C' | 'D';
  /** Label as printed in the source, e.g. "(a)", "(1)", "A." */
  originalLabel: string;
  text: string;
  sourceOptionId?: string;
}

export interface ExtractedQuestion {
  questionNumber: number;
  sourceQuestionId?: string;
  section?: string;
  subjectId?: JeeSubjectId;
  type: 'mcq' | 'numerical' | 'unknown';
  stem: string;
  options: ExtractedOption[];
  hasFigure: boolean;
  issues: ExtractionIssue[];
  /** First and last page the question spans (1-based). */
  pages: [number, number];
}

export type AnswerValue =
  | { kind: 'options'; labels: Array<'A' | 'B' | 'C' | 'D'> }
  | { kind: 'option_ids'; ids: string[] }
  | { kind: 'integers'; values: number[] }
  | { kind: 'dropped' };

export interface AnswerKeyEntry {
  questionNumber?: number;
  sourceQuestionId?: string;
  answer: AnswerValue;
  /** Raw text of the key cell, kept for review. */
  raw: string;
}

export interface AnswerKeyDocument {
  type: 'final' | 'provisional';
  version: string;
  sourceUrl?: string;
  fileSha256: string;
  entries: AnswerKeyEntry[];
  problems: string[];
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

export interface ImportRequest {
  sourceId: string;
  paper: SourceDocument;
  answerKey?: SourceDocument;
  answerKeyType: 'final' | 'provisional';
  answerKeyVersion: string;
  descriptor: PaperDescriptor;
  /** Label for the bank; PYQ requires official NTA paper/key URLs in the descriptor. */
  sourceLabel: 'pyq' | 'curated';
  licence: { basis: LicenceBasis; reference?: string };
  author?: string;
  /** For answer keys that number options 1–4 instead of A–D. */
  optionNumbering?: 'letters' | 'numbers';
}

export interface ImportSummary {
  jobId: string;
  sourceId: string;
  paperId: string;
  draftFile: string | null;
  logFile: string;
  extracted: number;
  imported: number;
  complete: number;
  needsReview: number;
  failed: number;
  skippedExisting: number;
  conflicts: number;
  problems: string[];
}
