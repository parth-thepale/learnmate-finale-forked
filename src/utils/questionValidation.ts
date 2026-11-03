import { getChapter, getTopic, getSubject } from '../data/jeeMainSyllabus';
import type {
  BankQuestion,
  McqOption,
  PublicQuestion,
  QuestionResponse,
  QuestionDifficulty,
} from '../types/questionBank';
import { parseIntegerAnswer, type ScorableQuestion } from './jeeScoring';

const OPTION_IDS: Array<McqOption['id']> = ['A', 'B', 'C', 'D'];
const DIFFICULTIES: QuestionDifficulty[] = ['easy', 'medium', 'hard'];
const BANK_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{2,99}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const PLACEHOLDER_OPTION = /^option\s*[0-9a-d]?$/i;

function isNonEmptyString(value: unknown, max = 20_000): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max;
}

function normalizeOptionText(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Official NTA hosts only: question papers and keys must link to the source documents. */
function isOfficialNtaUrl(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return false;
    const host = url.hostname.toLowerCase();
    return host === 'nta.ac.in' || host.endsWith('.nta.ac.in') || host.endsWith('.nic.in') || host.endsWith('.s3waas.gov.in');
  } catch {
    return false;
  }
}

/** Validates one question-bank entry. Returns a list of problems (empty when valid). */
export function validateBankQuestion(raw: unknown): string[] {
  const errors: string[] = [];
  if (typeof raw !== 'object' || raw === null) return ['Question must be an object.'];
  const q = raw as Partial<BankQuestion> & Record<string, unknown>;
  const label = typeof q.id === 'string' ? q.id : '(missing id)';
  const err = (message: string) => errors.push(`${label}: ${message}`);

  if (typeof q.id !== 'string' || !BANK_ID_PATTERN.test(q.id)) err('id must be lowercase letters, digits, ".", "_" or "-".');
  if (q.source !== 'pyq' && q.source !== 'curated') err('source must be "pyq" or "curated" (AI questions never enter the bank).');
  if (q.type !== 'mcq' && q.type !== 'numerical') err('type must be "mcq" or "numerical".');

  const subject = typeof q.subjectId === 'string' ? getSubject(q.subjectId) : undefined;
  if (!subject) err('unknown subjectId.');
  const chapter = typeof q.chapterId === 'string' ? getChapter(q.chapterId) : undefined;
  if (!chapter) err('unknown chapterId.');
  else if (subject && chapter.subjectId !== subject.id) err('chapterId does not belong to subjectId.');
  if (!Array.isArray(q.topicIds) || q.topicIds.length === 0) err('topicIds must list at least one syllabus topic.');
  else {
    for (const topicId of q.topicIds) {
      const found = typeof topicId === 'string' ? getTopic(topicId) : undefined;
      if (!found) err(`unknown topicId "${String(topicId)}".`);
      else if (chapter && found.chapter.id !== chapter.id) err(`topicId "${topicId}" is not in chapter ${chapter.id}.`);
    }
    if (new Set(q.topicIds).size !== q.topicIds.length) err('topicIds contains duplicates.');
  }

  if (!DIFFICULTIES.includes(q.difficulty as QuestionDifficulty)) err('difficulty must be easy, medium or hard.');
  if (!isNonEmptyString(q.stem)) err('stem is required.');
  if (!isNonEmptyString(q.explanation)) err('explanation is required.');
  if (q.keyStatus !== undefined && q.keyStatus !== 'normal' && q.keyStatus !== 'dropped') err('keyStatus must be "normal" or "dropped".');

  if (q.type === 'mcq') {
    const options = q.options as unknown;
    if (!Array.isArray(options) || options.length !== 4) err('MCQs need exactly four options.');
    else {
      options.forEach((opt, i) => {
        if (!opt || opt.id !== OPTION_IDS[i]) err(`option ${i + 1} must have id "${OPTION_IDS[i]}".`);
        if (!opt || !isNonEmptyString(opt.text, 2_000)) err(`option ${OPTION_IDS[i]} needs text.`);
      });
      const texts = options.filter((o) => o && typeof o.text === 'string').map((o) => normalizeOptionText(o.text));
      if (new Set(texts).size !== texts.length) err('options must be distinct.');
    }
    const keys = (q as { correctOptionIds?: unknown }).correctOptionIds;
    if (!Array.isArray(keys) || keys.length === 0) err('correctOptionIds must name at least one option.');
    else if (keys.some((k) => !OPTION_IDS.includes(k)) || new Set(keys).size !== keys.length) {
      err('correctOptionIds must be distinct values from A–D.');
    }
    if ('acceptedIntegers' in q) err('MCQs must not define acceptedIntegers.');
  } else if (q.type === 'numerical') {
    const accepted = (q as { acceptedIntegers?: unknown }).acceptedIntegers;
    if (!Array.isArray(accepted) || accepted.length === 0) err('numerical questions need acceptedIntegers.');
    else if (accepted.some((v) => !Number.isSafeInteger(v))) err('acceptedIntegers must be whole numbers.');
    if ('options' in q || 'correctOptionIds' in q) err('numerical questions must not define options or correctOptionIds.');
  }

  if (q.source === 'pyq') {
    const p = q.pyq;
    if (!p) err('PYQs need pyq provenance (paper, date, shift, question number and official key).');
    else {
      if (p.exam !== 'JEE Main') err('pyq.exam must be "JEE Main".');
      if (!Number.isInteger(p.year) || p.year < 2019 || p.year > 2100) err('pyq.year is invalid.');
      if (p.session !== 1 && p.session !== 2) err('pyq.session must be 1 or 2.');
      if (typeof p.date !== 'string' || !ISO_DATE.test(p.date)) err('pyq.date must be YYYY-MM-DD.');
      else if (Number(p.date.slice(0, 4)) !== p.year) err('pyq.date must fall in pyq.year.');
      if (p.shift !== 1 && p.shift !== 2) err('pyq.shift must be 1 or 2.');
      if (!Number.isInteger(p.questionNumber) || p.questionNumber < 1 || p.questionNumber > 90) err('pyq.questionNumber is invalid.');
      if (!isOfficialNtaUrl(p.paperUrl)) err('pyq.paperUrl must be an official NTA https link.');
      if (!isOfficialNtaUrl(p.answerKeyUrl)) err('pyq.answerKeyUrl must be an official NTA https link.');
    }
    if (q.curated) err('PYQs must not carry curated provenance.');
  }
  if (q.source === 'curated') {
    if (!q.curated || !isNonEmptyString(q.curated.author, 200) || !isNonEmptyString(q.curated.createdAt, 64)) {
      err('curated questions need curated.author and curated.createdAt.');
    }
    if (q.pyq) err('curated questions must not carry PYQ provenance.');
  }

  const v = q.verification;
  if (!v || !['draft', 'pending_review', 'verified', 'rejected'].includes(v.status)) {
    err('verification.status must be draft, pending_review, verified or rejected.');
  } else if (v.status === 'verified' && (!isNonEmptyString(v.reviewedBy, 200) || !isNonEmptyString(v.reviewedAt, 64))) {
    err('verified questions need verification.reviewedBy and verification.reviewedAt.');
  }

  return errors;
}

/** Only human-verified, structurally valid bank questions may be served to students. */
export function isServableBankQuestion(q: BankQuestion): boolean {
  return q.verification?.status === 'verified' && validateBankQuestion(q).length === 0;
}

export function bankQuestionTopicLabel(q: BankQuestion): string {
  const first = q.topicIds[0] ? getTopic(q.topicIds[0]) : undefined;
  return first ? first.topic.name : getChapter(q.chapterId)?.name ?? q.chapterId;
}

export function toPublicBankQuestion(q: BankQuestion): PublicQuestion {
  const base = {
    id: q.id,
    source: q.source,
    subjectId: q.subjectId,
    chapterId: q.chapterId,
    topicIds: [...q.topicIds],
    topicLabel: bankQuestionTopicLabel(q),
    difficulty: q.difficulty,
    stem: q.stem,
  };
  return q.type === 'mcq'
    ? { ...base, type: 'mcq', options: q.options.map((o) => ({ id: o.id, text: o.text })) }
    : { ...base, type: 'numerical' };
}

export function toScorableBankQuestion(q: BankQuestion): ScorableQuestion {
  const base = {
    id: q.id,
    keyStatus: q.keyStatus,
    topicIds: [...q.topicIds],
    topicLabel: bankQuestionTopicLabel(q),
    subjectId: q.subjectId,
    chapterId: q.chapterId,
  };
  return q.type === 'mcq'
    ? { ...base, type: 'mcq', correctOptionIds: [...q.correctOptionIds] }
    : { ...base, type: 'numerical', acceptedIntegers: [...q.acceptedIntegers] };
}

// ---------------------------------------------------------------------------
// AI-generated questions
// ---------------------------------------------------------------------------

export interface GeneratedMcqInput {
  topic?: unknown;
  question?: unknown;
  options?: unknown;
  correctIndex?: unknown;
  explanation?: unknown;
  sourcePage?: unknown;
  sourceQuote?: unknown;
  difficulty?: unknown;
}

export interface ValidatedGeneratedMcq {
  topic: string;
  question: string;
  options: [string, string, string, string];
  correctIndex: 0 | 1 | 2 | 3;
  explanation: string;
  sourcePage: number;
  sourceQuote: string;
  difficulty: QuestionDifficulty;
}

/**
 * Strict checks for one AI-generated MCQ. Invalid questions are rejected outright rather than
 * repaired: no padded "Option N" choices, no defaulted answer key, no invented page citations.
 */
export function validateGeneratedMcq(
  raw: GeneratedMcqInput,
  context: { validPageNumbers?: ReadonlySet<number> } = {}
): { ok: true; question: ValidatedGeneratedMcq } | { ok: false; reason: string } {
  if (!isNonEmptyString(raw.question, 2_000) || raw.question.trim().length < 10) {
    return { ok: false, reason: 'question text missing or too short' };
  }
  if (!Array.isArray(raw.options) || raw.options.length !== 4) return { ok: false, reason: 'needs exactly four options' };
  const options = raw.options.map((o) => (typeof o === 'string' ? o.trim() : ''));
  if (options.some((o) => o.length === 0 || o.length > 500)) return { ok: false, reason: 'empty or overlong option' };
  if (options.some((o) => PLACEHOLDER_OPTION.test(o))) return { ok: false, reason: 'placeholder option text' };
  if (new Set(options.map(normalizeOptionText)).size !== 4) return { ok: false, reason: 'duplicate options' };
  if (typeof raw.correctIndex !== 'number' || !Number.isInteger(raw.correctIndex) || raw.correctIndex < 0 || raw.correctIndex > 3) {
    return { ok: false, reason: 'invalid answer key' };
  }
  if (!isNonEmptyString(raw.explanation, 4_000) || raw.explanation.trim().length < 10) {
    return { ok: false, reason: 'missing explanation' };
  }
  let sourcePage = 0;
  if (context.validPageNumbers && context.validPageNumbers.size > 0) {
    if (typeof raw.sourcePage !== 'number' || !context.validPageNumbers.has(raw.sourcePage)) {
      return { ok: false, reason: 'cites a page that is not in the material' };
    }
    sourcePage = raw.sourcePage;
  }
  const difficulty = DIFFICULTIES.includes(raw.difficulty as QuestionDifficulty)
    ? (raw.difficulty as QuestionDifficulty)
    : 'medium';
  return {
    ok: true,
    question: {
      topic: isNonEmptyString(raw.topic, 200) ? raw.topic.trim() : 'General',
      question: raw.question.trim(),
      options: options as [string, string, string, string],
      correctIndex: raw.correctIndex as 0 | 1 | 2 | 3,
      explanation: raw.explanation.trim(),
      sourcePage,
      sourceQuote: typeof raw.sourceQuote === 'string' ? raw.sourceQuote.trim().slice(0, 500) : '',
      difficulty,
    },
  };
}

/** Validates a generated set; drops invalid or duplicate questions and reports why. */
export function validateGeneratedMcqSet(
  raws: unknown,
  context: { validPageNumbers?: ReadonlySet<number> } = {}
): { valid: ValidatedGeneratedMcq[]; rejected: Array<{ index: number; reason: string }> } {
  const valid: ValidatedGeneratedMcq[] = [];
  const rejected: Array<{ index: number; reason: string }> = [];
  if (!Array.isArray(raws)) return { valid, rejected: [{ index: -1, reason: 'questions is not a list' }] };
  const seenStems = new Set<string>();
  raws.forEach((raw, index) => {
    const result = validateGeneratedMcq((raw ?? {}) as GeneratedMcqInput, context);
    if (!result.ok) {
      rejected.push({ index, reason: result.reason });
      return;
    }
    const stemKey = normalizeOptionText(result.question.question);
    if (seenStems.has(stemKey)) {
      rejected.push({ index, reason: 'duplicate question' });
      return;
    }
    seenStems.add(stemKey);
    valid.push(result.question);
  });
  return { valid, rejected };
}

// ---------------------------------------------------------------------------
// Student responses
// ---------------------------------------------------------------------------

/** Returns an error message when a response is malformed for its question, otherwise null. */
export function validateResponse(question: Pick<PublicQuestion, 'id' | 'type'> & { options?: McqOption[] }, response: unknown): string | null {
  if (response === undefined) return null;
  if (typeof response !== 'object' || response === null) return `Response for ${question.id} is malformed.`;
  const r = response as Partial<QuestionResponse> & Record<string, unknown>;
  if (r.type !== question.type) return `Response for ${question.id} has the wrong type.`;
  if (r.type === 'mcq') {
    if (r.optionId === null) return null;
    const ids = question.options ? question.options.map((o) => o.id) : OPTION_IDS;
    return typeof r.optionId === 'string' && ids.includes(r.optionId as McqOption['id'])
      ? null
      : `Response for ${question.id} selects an unknown option.`;
  }
  if (r.value === null) return null;
  if (typeof r.value !== 'string' || r.value.length > 20) return `Response for ${question.id} is malformed.`;
  if (r.value.trim() === '') return null;
  return parseIntegerAnswer(r.value) === null
    ? `Answer for ${question.id} must be a whole number (round to the nearest integer).`
    : null;
}
