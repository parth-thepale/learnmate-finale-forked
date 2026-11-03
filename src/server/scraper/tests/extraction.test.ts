import test from 'node:test';
import assert from 'node:assert/strict';
import { matchAnswer, parseAnswerKeyText, parseAnswerValue, unmatchedKeyEntries } from '../answerKeyExtractor';
import { parsePdf, PdfParseError } from '../pdfParser';
import { extractQuestions } from '../questionExtractor';
import type { ExtractedQuestion, ParsedPdf, PdfLine } from '../types';
import { makePdf, SAMPLE_KEY_CSV, SAMPLE_PAPER } from './fixtures';

function codes(q: ExtractedQuestion | undefined): string[] {
  return (q?.issues ?? []).map((i) => i.code);
}

function syntheticPdf(texts: string[]): ParsedPdf {
  const lines: PdfLine[] = texts.map((text, i) => ({ page: 1, y: 800 - i * 18, x: 50, text, items: [] }));
  return { pageCount: 1, lines, images: [], pageHeights: [842] };
}

test('PDF parser rejects non-PDF input and reads text lines and image positions', async () => {
  await assert.rejects(parsePdf(new TextEncoder().encode('<html>not a pdf</html>')), PdfParseError);
  const parsed = await parsePdf(await makePdf(SAMPLE_PAPER));
  assert.equal(parsed.pageCount, 2);
  assert.equal(parsed.images.length, 1);
  assert.ok(parsed.lines.some((l) => l.page === 2 && l.text === 'MATHEMATICS - SECTION A'));
});

test('extracts questions with original numbering, subjects, sections, types and options', async () => {
  const { questions, problems } = extractQuestions(await parsePdf(await makePdf(SAMPLE_PAPER)));
  assert.deepEqual(questions.map((q) => q.questionNumber), [1, 2, 3, 4, 5, 6, 8]);
  const byNumber = new Map(questions.map((q) => [q.questionNumber, q]));

  const q1 = byNumber.get(1)!;
  assert.equal(q1.subjectId, 'physics');
  assert.equal(q1.section, 'A');
  assert.equal(q1.type, 'mcq');
  assert.match(q1.stem, /2\.5 kg is the mass/, 'a stem line starting with "2.5" must not start question 2');
  assert.deepEqual(q1.options.map((o) => o.text), ['2 m/s', '4 m/s', '6 m/s', '8 m/s']);
  assert.deepEqual(codes(q1), []);

  assert.deepEqual(byNumber.get(2)!.options.map((o) => o.text), ['Speed', 'Mass', 'Velocity', 'Energy']);
  assert.equal(byNumber.get(3)!.hasFigure, true);
  assert.deepEqual(codes(byNumber.get(3)), ['figure_present']);
  assert.equal(byNumber.get(2)!.hasFigure, false);
  assert.ok(codes(byNumber.get(4)).includes('option_count_mismatch'));

  const q5 = byNumber.get(5)!;
  assert.equal(q5.type, 'numerical');
  assert.equal(q5.section, 'B');

  const q6 = byNumber.get(6)!;
  assert.equal(q6.subjectId, 'mathematics');
  assert.deepEqual(q6.options.map((o) => `${o.label}:${o.originalLabel}`), ['A:1', 'B:2', 'C:3', 'D:4']);

  assert.ok(codes(byNumber.get(8)).includes('numbering_gap'));
  assert.deepEqual(problems, ['Question 7 was not found in the text layer.']);
});

test('uncertain content is flagged instead of guessed', () => {
  const { questions, problems } = extractQuestions(
    syntheticPdf([
      'Chemistry',
      'Q1. Identify the product \uE001 formed in the reaction.',
      '(A) X (B) Y (C) Y (D) Z',
      'Q2. Statement only, no options, no section marker.',
      'Physics of motion is studied here.',
      'Chemistry',
      '1. Restarted numbering',
      '(A) a (B) b (C) c (D) d',
    ])
  );
  const [q1, q2] = questions;
  assert.equal(questions.length, 2, 'nothing after the numbering restart is extracted');
  assert.ok(codes(q1).includes('math_notation_unreliable'));
  assert.ok(codes(q1).includes('duplicate_option_text'));
  assert.equal(q2.type, 'unknown');
  assert.ok(codes(q2).includes('type_unknown'));
  assert.match(q2.stem, /Physics of motion/, 'a sentence starting with a subject name is not a heading');
  assert.ok(problems.some((p) => p.includes('restarts')));

  const noHeading = extractQuestions(syntheticPdf(['1. Orphan question', '(A) a (B) b (C) c (D) d'])).questions[0];
  assert.ok(codes(noHeading).includes('subject_unknown'));
  const imageOnly = extractQuestions(syntheticPdf(['Physics', '1.', '(A) (B) (C) (D)'])).questions[0];
  assert.ok(codes(imageOnly).includes('stem_missing'));
});

test('answer values: options, integers, multiple accepted answers, dropped; blanks are never filled', () => {
  assert.deepEqual(parseAnswerValue('b'), { kind: 'options', labels: ['B'] });
  assert.deepEqual(parseAnswerValue('(C)'), { kind: 'options', labels: ['C'] });
  assert.deepEqual(parseAnswerValue('A|C'), { kind: 'options', labels: ['A', 'C'] });
  assert.deepEqual(parseAnswerValue('12 or 13'), { kind: 'integers', values: [12, 13] });
  assert.deepEqual(parseAnswerValue('-4'), { kind: 'integers', values: [-4] });
  assert.deepEqual(parseAnswerValue('Dropped'), { kind: 'dropped' });
  assert.deepEqual(parseAnswerValue('BONUS'), { kind: 'dropped' });
  assert.equal(parseAnswerValue(''), null);
  assert.equal(parseAnswerValue('-'), null);
  assert.equal(parseAnswerValue('2.5'), null, 'non-integer numerical answers are not accepted');
  assert.equal(parseAnswerValue('A|3'), null, 'mixed answers are rejected');
});

test('answer keys are matched by question number, conflicts and gaps are reported', async () => {
  const key = parseAnswerKeyText('q,ans\n1,B\n2,\n3,A\n3,C\n4,12\n4,12\nx,A\n', { type: 'final', version: 'v1', fileSha256: 'f'.repeat(64) });
  assert.ok(key.problems.some((p) => p.includes('Question 2')));
  assert.ok(key.problems.some((p) => p.includes('conflicting')));
  assert.ok(key.problems.some((p) => p.includes('"x"')));

  const mcq = (n: number, extra: Partial<ExtractedQuestion> = {}): ExtractedQuestion => ({
    questionNumber: n,
    type: 'mcq',
    stem: 's',
    options: [],
    hasFigure: false,
    issues: [],
    pages: [1, 1],
    ...extra,
  });
  assert.deepEqual(matchAnswer(mcq(1), key).correctOptionIds, ['B']);
  assert.deepEqual(codes({ ...mcq(2), issues: matchAnswer(mcq(2), key).issues }), ['answer_missing']);
  const conflict = matchAnswer(mcq(3), key);
  assert.equal(conflict.correctOptionIds, undefined);
  assert.deepEqual(conflict.issues.map((i) => i.code), ['answer_conflict']);
  assert.deepEqual(matchAnswer(mcq(4, { type: 'numerical' }), key).acceptedIntegers, [12]);
  assert.deepEqual(matchAnswer(mcq(4), key).issues.map((i) => i.code), ['answer_invalid'], 'an integer is not an MCQ answer');
  assert.deepEqual(matchAnswer(mcq(1), undefined).issues.map((i) => i.code), ['answer_missing']);

  const numbered = parseAnswerKeyText('1,3\n2,7\n', { type: 'final', version: 'v1', fileSha256: 'f'.repeat(64) });
  assert.deepEqual(matchAnswer(mcq(1), numbered, 'numbers').correctOptionIds, ['C']);
  assert.ok(matchAnswer(mcq(1), numbered, 'letters').issues.some((i) => i.code === 'answer_invalid'));
  assert.ok(matchAnswer(mcq(2), numbered, 'numbers').issues.some((i) => i.code === 'answer_invalid'), 'option number 7 does not exist');

  const provisional = parseAnswerKeyText('1,B\n', { type: 'provisional', version: 'prov-1', fileSha256: 'f'.repeat(64) });
  const p = matchAnswer(mcq(1), provisional);
  assert.deepEqual(p.correctOptionIds, ['B']);
  assert.ok(p.issues.some((i) => i.code === 'answer_provisional'));

  const sample = parseAnswerKeyText(SAMPLE_KEY_CSV, { type: 'final', version: 'v1', fileSha256: 'f'.repeat(64) });
  const dropped = matchAnswer(mcq(8), sample);
  assert.equal(dropped.dropped, true);
  assert.equal(dropped.correctOptionIds, undefined);
  assert.deepEqual(unmatchedKeyEntries(sample, [mcq(1), mcq(8)]), [2, 3, 4, 5, 6, 9]);
});

test('source question ids take precedence over question numbers when both sides have them', () => {
  const key = {
    type: 'final' as const,
    version: 'v1',
    fileSha256: 'f'.repeat(64),
    problems: [],
    entries: [
      { questionNumber: 1, sourceQuestionId: '6911212', answer: { kind: 'options' as const, labels: ['D' as const] }, raw: 'D' },
      { questionNumber: 2, sourceQuestionId: '6911211', answer: { kind: 'options' as const, labels: ['A' as const] }, raw: 'A' },
    ],
  };
  const q: ExtractedQuestion = { questionNumber: 1, sourceQuestionId: '6911211', type: 'mcq', stem: 's', options: [], hasFigure: false, issues: [], pages: [1, 1] };
  assert.deepEqual(matchAnswer(q, key).correctOptionIds, ['A']);
});
