import type { JeeSubjectId } from '../../data/jeeMainSyllabus';
import type { ExtractedOption, ExtractedQuestion, ExtractionIssue, ParsedPdf, PdfLine } from './types';

/**
 * Generic question extractor for PDFs with a text layer (manually supplied papers). It only
 * starts a new question when the printed number is the expected next number, and it flags anything
 * uncertain (figures, unreliable maths glyphs, missing options, unknown type) instead of guessing.
 *
 * Supported layouts: continuous numbering ("1.", "1)", "Q1.", "Q.1", "Question 1:") with options
 * "(A)…(D)", "A.", "A)", "(a)…(d)" or "(1)…(4)", on separate lines or inline. Image-only papers
 * (such as NTA's official PDFs) yield questions without text and are flagged for manual review.
 */

const QUESTION_START = /^(?:Q(?:uestion)?\s*\.?\s*(?:No\.?\s*)?)?(\d{1,3})\s*[.):](?:\s+(.*)|\s*$)/i;
const QUESTION_START_Q_ONLY = /^Q\s*\.?\s*(\d{1,3})\s+(.*)$/i;
const OPTION_LINE = /^\(([A-Da-d1-4])\)\s*(.*)$|^([A-Da-d])\s*[.)]\s+(.*)$/;
const INLINE_OPTION = /\(([A-Da-d1-4])\)\s*/g;
/** A heading line: only the subject name plus optional "Part/Section X" decoration. */
const SUBJECT_HEADER =
  /^(?:part\s*[-–:]?\s*[a-c1-3]\s*[-–:]?\s*)?(physics|chemistry|mathematics|maths)\s*(?:[-–:(]?\s*(?:section|part)\s*[-–:]?\s*[a-c1-3]\)?)?\s*$/i;
const SECTION_HEADER = /\bsection\s*[-–:]?\s*([AB])\b/i;
const NUMERICAL_HINTS = /\b(nearest integer|integer value|numerical value|answer is an integer)\b/i;

/** Characters that indicate the text layer lost mathematical meaning (math/private-use fonts). */
const UNRELIABLE_MATH = /[\uE000-\uF8FF\uFFFD]|[\u{1D400}-\u{1D7FF}]|[\u{20000}-\u{2FA1F}]/u;

const LABELS: Array<'A' | 'B' | 'C' | 'D'> = ['A', 'B', 'C', 'D'];

function subjectFromHeader(name: string): JeeSubjectId {
  const n = name.toLowerCase();
  return n.startsWith('phys') ? 'physics' : n.startsWith('chem') ? 'chemistry' : 'mathematics';
}

interface Draft {
  questionNumber: number;
  section?: string;
  subjectId?: JeeSubjectId;
  stemParts: string[];
  options: ExtractedOption[];
  startLine: PdfLine;
  endLine: PdfLine;
  issues: ExtractionIssue[];
}

function parseInlineOptions(text: string): { lead: string; options: Array<{ label: string; text: string }> } | null {
  const matches = [...text.matchAll(INLINE_OPTION)];
  if (matches.length < 2) return null;
  const options: Array<{ label: string; text: string }> = [];
  for (let i = 0; i < matches.length; i++) {
    const start = (matches[i].index ?? 0) + matches[i][0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index ?? text.length : text.length;
    options.push({ label: matches[i][1], text: text.slice(start, end).trim() });
  }
  return { lead: text.slice(0, matches[0].index ?? 0).trim(), options };
}

function addOption(draft: Draft, label: string, text: string): void {
  const position = draft.options.length;
  const normalized = /^[1-4]$/.test(label) ? LABELS[Number(label) - 1] : (label.toUpperCase() as 'A' | 'B' | 'C' | 'D');
  if (position < 4 && normalized !== LABELS[position]) {
    draft.issues.push({ code: 'option_count_mismatch', message: `Option labels are out of order (found ${label} at position ${position + 1}).` });
  }
  draft.options.push({ label: LABELS[Math.min(position, 3)], originalLabel: label, text: text.trim() });
}

function isWithin(draft: Draft, page: number, y: number, nextStart?: PdfLine): boolean {
  const start = draft.startLine;
  const afterStart = page > start.page || (page === start.page && y <= start.y + 2);
  if (!afterStart) return false;
  if (!nextStart) return true;
  return page < nextStart.page || (page === nextStart.page && y > nextStart.y + 2);
}

export interface ExtractionResult {
  questions: ExtractedQuestion[];
  problems: string[];
}

export function extractQuestions(parsed: ParsedPdf): ExtractionResult {
  const problems: string[] = [];
  const drafts: Draft[] = [];
  let current: Draft | null = null;
  let subjectId: JeeSubjectId | undefined;
  let section: string | undefined;
  let lastNumber = 0;

  const lines = [...parsed.lines].sort((a, b) => a.page - b.page || b.y - a.y || a.x - b.x);
  for (const line of lines) {
    const text = line.text.trim();
    if (!text) continue;

    const subjectMatch = SUBJECT_HEADER.exec(text);
    if (subjectMatch) {
      subjectId = subjectFromHeader(subjectMatch[1]);
      const sec = SECTION_HEADER.exec(text);
      section = sec ? sec[1].toUpperCase() : undefined;
      current = null;
      continue;
    }
    const sectionOnly = SECTION_HEADER.exec(text);
    if (sectionOnly && text.length <= 40) {
      section = sectionOnly[1].toUpperCase();
      current = null;
      continue;
    }

    const start = QUESTION_START.exec(text) ?? QUESTION_START_Q_ONLY.exec(text);
    const number = start ? Number(start[1]) : NaN;
    const isNext: boolean = Boolean(start) && number === lastNumber + 1;
    // A skipped number is only accepted once the open question looks finished (4 options, or a
    // numerical section), so numbered statements inside a stem are not mistaken for questions.
    const openDraft = current as Draft | null;
    const openLooksComplete = openDraft === null || openDraft.options.length >= 4 || openDraft.section === 'B';
    const isAfterGap: boolean = Boolean(start) && number > lastNumber + 1 && number <= lastNumber + 10 && openLooksComplete;
    if (start && number === 1 && lastNumber > 0 && openDraft === null) {
      problems.push(
        `Question numbering restarts at 1 after question ${lastNumber}; only continuous numbering is supported, so nothing after the restart was extracted. Split the paper per subject or renumber it.`
      );
      break;
    }
    if (start && (isNext || isAfterGap)) {
      const missing = number - 1 === lastNumber + 1 ? `Question ${lastNumber + 1} was` : `Questions ${lastNumber + 1}–${number - 1} were`;
      if (isAfterGap) problems.push(`${missing} not found in the text layer.`);
      current = {
        questionNumber: number,
        section,
        subjectId,
        stemParts: [],
        options: [],
        startLine: line,
        endLine: line,
        issues: isAfterGap ? [{ code: 'numbering_gap', message: `${missing} not found before this question.` }] : [],
      };
      drafts.push(current);
      lastNumber = number;
      const rest = (start[2] ?? '').trim();
      const inline = parseInlineOptions(rest);
      if (inline) {
        if (inline.lead) current.stemParts.push(inline.lead);
        for (const o of inline.options) addOption(current, o.label, o.text);
      } else if (rest) {
        current.stemParts.push(rest);
      }
      continue;
    }

    if (!current) continue;
    current.endLine = line;

    const inline = parseInlineOptions(text);
    if (inline && (inline.lead === '' || current.options.length > 0)) {
      if (inline.lead && current.options.length > 0) {
        current.options[current.options.length - 1].text += ` ${inline.lead}`;
      }
      for (const o of inline.options) addOption(current, o.label, o.text);
      continue;
    }
    const option = OPTION_LINE.exec(text);
    if (option) {
      addOption(current, option[1] ?? option[3], option[2] ?? option[4] ?? '');
      continue;
    }
    if (current.options.length > 0) current.options[current.options.length - 1].text += ` ${text}`;
    else current.stemParts.push(text);
  }

  const questions: ExtractedQuestion[] = drafts.map((draft, index) => {
    const next = drafts[index + 1]?.startLine;
    const stem = draft.stemParts.join(' ').replace(/\s+/g, ' ').trim();
    const issues = [...draft.issues];
    const hasFigure = parsed.images.some((img) => isWithin(draft, img.page, img.y + img.height, next) || isWithin(draft, img.page, img.y, next));
    if (hasFigure) issues.push({ code: 'figure_present', message: 'Question contains an image or diagram that was not extracted.' });
    if (!stem) issues.push({ code: 'stem_missing', message: 'No question text found (the stem may be an image).' });
    const allText = [stem, ...draft.options.map((o) => o.text)].join(' ');
    if (UNRELIABLE_MATH.test(allText)) {
      issues.push({ code: 'math_notation_unreliable', message: 'Mathematical notation could not be read reliably from the text layer.' });
    }

    let type: ExtractedQuestion['type'];
    if (draft.options.length === 4) type = 'mcq';
    else if (draft.options.length === 0 && (draft.section === 'B' || NUMERICAL_HINTS.test(stem))) type = 'numerical';
    else if (draft.options.length > 0) {
      type = 'mcq';
      issues.push({ code: 'option_count_mismatch', message: `Found ${draft.options.length} options instead of 4.` });
    } else {
      type = 'unknown';
      issues.push({ code: 'type_unknown', message: 'Could not tell whether this is an MCQ or a numerical question.' });
    }
    if (draft.options.some((o) => !o.text)) issues.push({ code: 'option_count_mismatch', message: 'An option has no text.' });
    const optionTexts = draft.options.map((o) => o.text.toLowerCase().replace(/\s+/g, ' '));
    if (new Set(optionTexts).size !== optionTexts.length) {
      issues.push({ code: 'duplicate_option_text', message: 'Two options have identical text.' });
    }
    if (!draft.subjectId) issues.push({ code: 'subject_unknown', message: 'No subject heading found before this question.' });

    return {
      questionNumber: draft.questionNumber,
      section: draft.section,
      subjectId: draft.subjectId,
      type,
      stem,
      options: draft.options,
      hasFigure,
      issues: dedupeIssues(issues),
      pages: [draft.startLine.page, Math.max(draft.endLine.page, draft.startLine.page)],
    };
  });

  return { questions, problems: [...new Set(problems)] };
}

function dedupeIssues(issues: ExtractionIssue[]): ExtractionIssue[] {
  const seen = new Set<string>();
  return issues.filter((i) => {
    const key = `${i.code}|${i.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
