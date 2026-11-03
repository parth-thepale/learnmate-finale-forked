import { createHash } from 'crypto';
import type { BankQuestion } from '../../types/questionBank';
import { matchAnswer } from './answerKeyExtractor';
import type { AnswerKeyDocument, ExtractedQuestion, ExtractionIssue, ImportRequest, SourceDefinition } from './types';

/**
 * Converts extracted questions into question-bank drafts. Drafts carry full provenance and are
 * always `verification.status: "draft"`; chapter/topic classification, difficulty and
 * explanations are left empty for the reviewer instead of being guessed.
 */

export function sha256Hex(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Normalised content fingerprint: type, stem and options (whitespace/case-insensitive). */
export function contentChecksum(q: { type: string; stem: string; options: Array<{ text: string }> }): string {
  const norm = (s: string) => s.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
  return sha256Hex([q.type, norm(q.stem), ...q.options.map((o) => norm(o.text))].join('\u241F'));
}

export function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'paper';
}

export function draftIdFor(request: ImportRequest, questionNumber: number): string {
  const nn = String(questionNumber).padStart(2, '0');
  const d = request.descriptor;
  if (request.sourceLabel === 'pyq' && d.date && d.shift) {
    return `pyq-${d.date.replace(/-/g, '')}-s${d.shift}-q${nn}`;
  }
  return `imp-${slug(request.descriptor.paperId)}-q${nn}`;
}

export interface NormalizedDraft {
  question: BankQuestion | null;
  extraction: { status: 'complete' | 'needs_review' | 'failed'; issues: ExtractionIssue[] };
  questionNumber: number;
}

export function normalizeQuestion(params: {
  extracted: ExtractedQuestion;
  request: ImportRequest;
  source: SourceDefinition;
  key?: AnswerKeyDocument;
  jobId: string;
  now: Date;
}): NormalizedDraft {
  const { extracted, request, source, key, jobId, now } = params;
  const answer = matchAnswer(extracted, key, request.optionNumbering ?? 'letters');
  const issues: ExtractionIssue[] = [...extracted.issues, ...answer.issues];

  if (extracted.type === 'unknown') {
    return { question: null, extraction: { status: 'failed', issues }, questionNumber: extracted.questionNumber };
  }

  const status: 'complete' | 'needs_review' = issues.length === 0 ? 'complete' : 'needs_review';
  const checksum = contentChecksum(extracted);
  const d = request.descriptor;
  const base = {
    id: draftIdFor(request, extracted.questionNumber),
    source: request.sourceLabel,
    ...(extracted.subjectId ? { subjectId: extracted.subjectId } : {}),
    chapterId: '',
    topicIds: [] as string[],
    stem: extracted.stem,
    explanation: '',
    ...(answer.dropped ? { keyStatus: 'dropped' as const } : {}),
    licence: { basis: request.licence.basis, ...(request.licence.reference ? { reference: request.licence.reference } : {}) },
    importMeta: {
      jobId,
      sourceId: source.id,
      sourceName: source.name,
      ...(request.paper.url ? { sourceUrl: request.paper.url } : {}),
      sourceFileSha256: request.paper.sha256,
      retrievedAt: request.paper.retrievedAt,
      paperId: d.paperId,
      originalQuestionNumber: extracted.questionNumber,
      ...(extracted.sourceQuestionId ? { sourceQuestionId: extracted.sourceQuestionId } : {}),
      ...(extracted.section ? { section: extracted.section } : {}),
      contentChecksum: checksum,
      ...(key
        ? {
            answerKey: {
              ...(key.sourceUrl ? { sourceUrl: key.sourceUrl } : {}),
              fileSha256: key.fileSha256,
              version: key.version,
              type: key.type,
            },
          }
        : {}),
      extraction: { status, issues: issues.map((i) => `${i.code}: ${i.message}`) },
    },
    ...(request.sourceLabel === 'pyq'
      ? {
          pyq: {
            exam: 'JEE Main' as const,
            year: d.year as number,
            session: d.session as 1 | 2,
            date: d.date as string,
            shift: d.shift as 1 | 2,
            questionNumber: extracted.questionNumber,
            paperUrl: d.paperUrl as string,
            answerKeyUrl: d.answerKeyUrl as string,
          },
        }
      : { curated: { author: request.author || 'Unknown', createdAt: now.toISOString().slice(0, 10) } }),
    verification: { status: 'draft' as const },
  };

  const question =
    extracted.type === 'mcq'
      ? ({
          ...base,
          type: 'mcq',
          options: extracted.options.slice(0, 4).map((o, i) => ({ id: (['A', 'B', 'C', 'D'] as const)[i], text: o.text })),
          correctOptionIds: answer.correctOptionIds ?? [],
        } as unknown as BankQuestion)
      : ({ ...base, type: 'numerical', acceptedIntegers: answer.acceptedIntegers ?? [] } as unknown as BankQuestion);

  return { question, extraction: { status, issues }, questionNumber: extracted.questionNumber };
}
