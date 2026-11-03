import type { AnswerKeyDocument, AnswerKeyEntry, AnswerValue, ExtractedQuestion, ExtractionIssue } from './types';

/**
 * Answer-key parsing and matching.
 *
 * Supported manual key format (CSV/TSV/TXT), one question per line:
 *   question_number, answer[, note]
 * where answer is A–D (or 1–4 when the paper numbers its options), an integer, several accepted
 * answers separated by "|" or " or ", or DROPPED/BONUS. Blank answers are reported, never filled in.
 */

const DROPPED = /^(dropped|bonus|drop|cancelled|canceled)$/i;
const OPTION_TOKEN = /^\(?([A-Da-d])\)?$/;
const INTEGER_TOKEN = /^[+-]?\d{1,9}$/;

function splitRow(line: string): string[] {
  if (line.includes('\t')) return line.split('\t');
  if (line.includes(',')) return line.split(',');
  if (line.includes(';')) return line.split(';');
  return line.trim().split(/\s+/);
}

export function parseAnswerValue(raw: string): AnswerValue | null {
  const cell = raw.trim();
  if (!cell || cell === '-' || cell === '–' || /^(na|n\/a|none)$/i.test(cell)) return null;
  if (DROPPED.test(cell)) return { kind: 'dropped' };
  const parts = cell.split(/\s*\|\s*|\s+or\s+|\s*\/\s*/i).filter(Boolean);
  if (parts.length === 0) return null;
  if (parts.every((p) => OPTION_TOKEN.test(p))) {
    const labels = parts.map((p) => OPTION_TOKEN.exec(p)![1].toUpperCase() as 'A' | 'B' | 'C' | 'D');
    return { kind: 'options', labels: [...new Set(labels)] };
  }
  if (parts.every((p) => INTEGER_TOKEN.test(p))) {
    return { kind: 'integers', values: [...new Set(parts.map((p) => Number(p)))] };
  }
  return null;
}

export function parseAnswerKeyText(
  text: string,
  meta: { type: 'final' | 'provisional'; version: string; sourceUrl?: string; fileSha256: string }
): AnswerKeyDocument {
  const entries: AnswerKeyEntry[] = [];
  const problems: string[] = [];
  const byNumber = new Map<number, AnswerKeyEntry>();

  text.split(/\r?\n/).forEach((rawLine, index) => {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) return;
    const cells = splitRow(line).map((c) => c.trim());
    if (index === 0 && !/^\d+$/.test(cells[0] ?? '')) return; // header row
    const number = Number(cells[0]);
    if (!Number.isInteger(number) || number < 1 || number > 300) {
      problems.push(`Line ${index + 1}: "${cells[0]}" is not a question number.`);
      return;
    }
    const rawAnswer = cells[1] ?? '';
    const answer = parseAnswerValue(rawAnswer);
    if (!answer) {
      problems.push(`Question ${number}: no usable answer ("${rawAnswer}"). It will stay unanswered for review.`);
      return;
    }
    const entry: AnswerKeyEntry = { questionNumber: number, answer, raw: rawAnswer };
    const existing = byNumber.get(number);
    if (existing) {
      if (JSON.stringify(existing.answer) !== JSON.stringify(answer)) {
        problems.push(`Question ${number}: conflicting answers "${existing.raw}" and "${rawAnswer}". Neither is used.`);
        existing.answer = { kind: 'options', labels: [] };
      }
      return;
    }
    byNumber.set(number, entry);
    entries.push(entry);
  });

  return { ...meta, entries, problems };
}

export interface MatchedAnswer {
  correctOptionIds?: Array<'A' | 'B' | 'C' | 'D'>;
  acceptedIntegers?: number[];
  dropped: boolean;
  issues: ExtractionIssue[];
}

/**
 * Applies a key entry to one extracted question. Option numbers (1–4) are only mapped to A–D when
 * the paper is declared to number its options; otherwise integers on an MCQ are rejected.
 */
export function matchAnswer(
  question: ExtractedQuestion,
  key: AnswerKeyDocument | undefined,
  optionNumbering: 'letters' | 'numbers' = 'letters'
): MatchedAnswer {
  const issues: ExtractionIssue[] = [];
  if (!key) {
    return { dropped: false, issues: [{ code: 'answer_missing', message: 'No answer key was supplied.' }] };
  }
  if (key.type === 'provisional') {
    issues.push({ code: 'answer_provisional', message: `Answer comes from a provisional key (${key.version}); a final key is required before verification.` });
  }
  const entry = key.entries.find((e) =>
    question.sourceQuestionId && e.sourceQuestionId ? e.sourceQuestionId === question.sourceQuestionId : e.questionNumber === question.questionNumber
  );
  if (!entry) {
    issues.push({ code: 'answer_missing', message: `The answer key has no entry for question ${question.questionNumber}.` });
    return { dropped: false, issues };
  }
  const answer = entry.answer;
  if (answer.kind === 'options' && answer.labels.length === 0) {
    issues.push({ code: 'answer_conflict', message: 'The answer key contains conflicting answers for this question.' });
    return { dropped: false, issues };
  }
  if (answer.kind === 'dropped') return { dropped: true, issues };

  if (question.type === 'mcq') {
    if (answer.kind === 'options') return { correctOptionIds: answer.labels, dropped: false, issues };
    if (answer.kind === 'option_ids') {
      // Keys that list the source's own option ids (e.g. "69112113") map through the extracted options.
      const labels = answer.ids.map((id) => question.options.find((o) => o.sourceOptionId === id)?.label);
      if (labels.length > 0 && labels.every(Boolean)) {
        return { correctOptionIds: [...new Set(labels as Array<'A' | 'B' | 'C' | 'D'>)], dropped: false, issues };
      }
      issues.push({ code: 'answer_invalid', message: `Answer option id(s) ${answer.ids.join(', ')} do not match this question's options.` });
      return { dropped: false, issues };
    }
    if (answer.kind === 'integers' && optionNumbering === 'numbers' && answer.values.every((v) => v >= 1 && v <= 4)) {
      return { correctOptionIds: answer.values.map((v) => (['A', 'B', 'C', 'D'] as const)[v - 1]), dropped: false, issues };
    }
    issues.push({ code: 'answer_invalid', message: `Answer "${entry.raw}" does not name an option of this MCQ.` });
    return { dropped: false, issues };
  }
  if (question.type === 'numerical') {
    if (answer.kind === 'integers') return { acceptedIntegers: answer.values, dropped: false, issues };
    issues.push({ code: 'answer_invalid', message: `Answer "${entry.raw}" is not an integer for this numerical question.` });
    return { dropped: false, issues };
  }
  issues.push({ code: 'answer_invalid', message: 'Question type is unknown, so the answer cannot be applied.' });
  return { dropped: false, issues };
}

/** Key entries that do not correspond to any extracted question (reported, never imported). */
export function unmatchedKeyEntries(key: AnswerKeyDocument, questions: ExtractedQuestion[]): number[] {
  const numbers = new Set(questions.map((q) => q.questionNumber));
  return key.entries.filter((e) => e.questionNumber !== undefined && !numbers.has(e.questionNumber)).map((e) => e.questionNumber!);
}
