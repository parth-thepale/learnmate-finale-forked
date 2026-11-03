import { JEE_MAIN_SYLLABUS, type JeeSubjectId } from '../data/jeeMainSyllabus';
import type { BankQuestion, QuestionSource, QuestionType } from '../types/questionBank';
import { isServableBankQuestion, validateBankQuestion } from './questionValidation';

/** JEE (Main) 2026 Paper 1 composition per subject (NTA Information Bulletin 2026). */
export const JEE_MAIN_PAPER_PATTERN = Object.freeze({
  perSubject: { mcq: 20, numerical: 5 },
  subjects: ['physics', 'chemistry', 'mathematics'] as JeeSubjectId[],
  totalQuestions: 75,
  durationMinutes: 180,
  maxMarks: 300,
});

export interface LoadedBank {
  questions: BankQuestion[];
  errors: string[];
}

/** Validates raw bank records; invalid or duplicate entries are excluded and reported. */
export function loadBank(records: unknown[]): LoadedBank {
  const questions: BankQuestion[] = [];
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const record of records) {
    const problems = validateBankQuestion(record);
    if (problems.length > 0) {
      errors.push(...problems);
      continue;
    }
    const q = record as BankQuestion;
    if (ids.has(q.id)) {
      errors.push(`${q.id}: duplicate id.`);
      continue;
    }
    ids.add(q.id);
    questions.push(q);
  }
  return { questions, errors };
}

export function servableQuestions(bank: BankQuestion[]): BankQuestion[] {
  return bank.filter(isServableBankQuestion);
}

export interface AvailabilityCount {
  total: number;
  bySource: Record<Exclude<QuestionSource, 'ai'>, number>;
  byType: Record<QuestionType, number>;
}

function emptyCount(): AvailabilityCount {
  return { total: 0, bySource: { pyq: 0, curated: 0 }, byType: { mcq: 0, numerical: 0 } };
}

/**
 * Counts of verified, servable questions per subject, chapter and topic. These are the only
 * numbers the UI may show for question availability.
 */
export function computeAvailability(bank: BankQuestion[]): {
  bySubject: Record<string, AvailabilityCount>;
  byChapter: Record<string, AvailabilityCount>;
  byTopic: Record<string, AvailabilityCount>;
} {
  const bySubject: Record<string, AvailabilityCount> = {};
  const byChapter: Record<string, AvailabilityCount> = {};
  const byTopic: Record<string, AvailabilityCount> = {};
  const bump = (count: AvailabilityCount, q: BankQuestion) => {
    count.total++;
    count.bySource[q.source]++;
    count.byType[q.type]++;
  };
  for (const q of servableQuestions(bank)) {
    bump((bySubject[q.subjectId] ??= emptyCount()), q);
    bump((byChapter[q.chapterId] ??= emptyCount()), q);
    for (const topicId of q.topicIds) bump((byTopic[topicId] ??= emptyCount()), q);
  }
  return { bySubject, byChapter, byTopic };
}

export interface PaperSetSummary {
  paperId: string;
  source: 'pyq' | 'curated';
  label: string;
  complete: boolean;
  counts: Record<JeeSubjectId, { mcq: number; numerical: number }>;
  questionIds: string[];
}

function pyqPaperId(q: BankQuestion): string | null {
  if (q.source !== 'pyq' || !q.pyq) return null;
  return `pyq-${q.pyq.date}-shift${q.pyq.shift}`;
}

/**
 * Groups servable questions into papers (official PYQ shifts, or curated paper sets) and marks a
 * paper complete only when every subject has exactly 20 MCQs and 5 numerical questions.
 */
export function summarizePaperSets(bank: BankQuestion[]): PaperSetSummary[] {
  const groups = new Map<string, { source: 'pyq' | 'curated'; label: string; questions: BankQuestion[] }>();
  for (const q of servableQuestions(bank)) {
    const paperId = pyqPaperId(q) ?? (q.source === 'curated' && q.paperSetId ? `curated-${q.paperSetId}` : null);
    if (!paperId) continue;
    const label =
      q.source === 'pyq' && q.pyq
        ? `JEE Main ${q.pyq.year} · ${q.pyq.date} · Shift ${q.pyq.shift}`
        : `Learnmate full-length set ${q.paperSetId}`;
    const group = groups.get(paperId) ?? { source: q.source, label, questions: [] };
    group.questions.push(q);
    groups.set(paperId, group);
  }

  const summaries: PaperSetSummary[] = [];
  for (const [paperId, group] of groups) {
    const counts = {
      physics: { mcq: 0, numerical: 0 },
      chemistry: { mcq: 0, numerical: 0 },
      mathematics: { mcq: 0, numerical: 0 },
    } as Record<JeeSubjectId, { mcq: number; numerical: number }>;
    for (const q of group.questions) counts[q.subjectId][q.type]++;
    const pattern = JEE_MAIN_PAPER_PATTERN.perSubject;
    const complete =
      group.questions.length === JEE_MAIN_PAPER_PATTERN.totalQuestions &&
      JEE_MAIN_PAPER_PATTERN.subjects.every(
        (s) => counts[s].mcq === pattern.mcq && counts[s].numerical === pattern.numerical
      );
    summaries.push({
      paperId,
      source: group.source,
      label: group.label,
      complete,
      counts,
      questionIds: group.questions.map((q) => q.id),
    });
  }
  return summaries.sort((a, b) => a.paperId.localeCompare(b.paperId));
}

/** Full-length mocks are offered only when at least one complete, verified paper exists. */
export function canOfferFullLengthMock(bank: BankQuestion[]): boolean {
  return summarizePaperSets(bank).some((p) => p.complete);
}

export interface SectionalTestRequest {
  subjectId?: JeeSubjectId;
  chapterIds?: string[];
  topicIds?: string[];
  types?: QuestionType[];
  sources?: Array<Exclude<QuestionSource, 'ai'>>;
  count: number;
}

/**
 * Picks verified bank questions for topic-wise practice or a sectional test. Never pads with
 * AI-generated questions: if fewer verified questions exist, the result says so.
 */
export function assembleFromBank(
  bank: BankQuestion[],
  request: SectionalTestRequest,
  random: () => number = Math.random
): { questions: BankQuestion[]; requested: number; available: number; sufficient: boolean } {
  const pool = servableQuestions(bank).filter((q) => {
    if (request.subjectId && q.subjectId !== request.subjectId) return false;
    if (request.chapterIds && request.chapterIds.length > 0 && !request.chapterIds.includes(q.chapterId)) return false;
    if (request.topicIds && request.topicIds.length > 0 && !q.topicIds.some((t) => request.topicIds!.includes(t))) return false;
    if (request.types && request.types.length > 0 && !request.types.includes(q.type)) return false;
    if (request.sources && request.sources.length > 0 && !request.sources.includes(q.source)) return false;
    return true;
  });
  const shuffled = [...pool];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const count = Math.max(0, Math.floor(request.count));
  const questions = shuffled.slice(0, count);
  return { questions, requested: count, available: pool.length, sufficient: pool.length >= count };
}

/** Every syllabus chapter id, in official unit order, for coverage reports. */
export function allChapterIds(): string[] {
  return JEE_MAIN_SYLLABUS.flatMap((s) => s.chapters.map((c) => c.id));
}
