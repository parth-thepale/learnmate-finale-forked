import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateResponse,
  JEE_MAIN_MARKING,
  parseIntegerAnswer,
  PRACTICE_MARKING,
  ResponseTypeMismatchError,
  scoreAttempt,
  type ScorableQuestion,
} from './jeeScoring';
import type { JeeSubjectId } from '../data/jeeMainSyllabus';

const mcq = (id: string, correct: Array<'A' | 'B' | 'C' | 'D'>, extra: Partial<ScorableQuestion> = {}): ScorableQuestion =>
  ({ id, type: 'mcq', correctOptionIds: correct, topicIds: ['physics.kinematics.relative-velocity'], topicLabel: 'Relative velocity', subjectId: 'physics', chapterId: 'physics.kinematics', ...extra }) as ScorableQuestion;
const num = (id: string, accepted: number[], extra: Partial<ScorableQuestion> = {}): ScorableQuestion =>
  ({ id, type: 'numerical', acceptedIntegers: accepted, topicIds: ['mathematics.sequence-series.am-gm'], topicLabel: 'AM-GM', subjectId: 'mathematics', chapterId: 'mathematics.sequence-series', ...extra }) as ScorableQuestion;

test('JEE Main marking is +4 / −1 / 0', () => {
  assert.deepEqual({ ...JEE_MAIN_MARKING }, { id: 'jee_main_2026', correct: 4, incorrect: -1, unanswered: 0 });
});

test('integer answers: only whole numbers are accepted', () => {
  assert.equal(parseIntegerAnswer('42'), 42);
  assert.equal(parseIntegerAnswer(' -7 '), -7);
  assert.equal(parseIntegerAnswer('+3'), 3);
  assert.equal(parseIntegerAnswer('007'), 7);
  assert.equal(parseIntegerAnswer('-0'), 0);
  assert.equal(parseIntegerAnswer('2.5'), null);
  assert.equal(parseIntegerAnswer('1e3'), null);
  assert.equal(parseIntegerAnswer('12a'), null);
  assert.equal(parseIntegerAnswer(''), null);
  assert.equal(parseIntegerAnswer('1234567890'), null);
});

test('MCQ outcomes: correct, incorrect, unanswered, multiple accepted keys, dropped', () => {
  assert.equal(evaluateResponse(mcq('q', ['B']), { type: 'mcq', optionId: 'B' }), 'correct');
  assert.equal(evaluateResponse(mcq('q', ['B']), { type: 'mcq', optionId: 'C' }), 'incorrect');
  assert.equal(evaluateResponse(mcq('q', ['B']), { type: 'mcq', optionId: null }), 'unanswered');
  assert.equal(evaluateResponse(mcq('q', ['B']), undefined), 'unanswered');
  assert.equal(evaluateResponse(mcq('q', ['B', 'D']), { type: 'mcq', optionId: 'D' }), 'correct');
  assert.equal(evaluateResponse(mcq('q', ['B'], { keyStatus: 'dropped' }), undefined), 'dropped');
});

test('numerical outcomes: integers compared exactly; non-integers are incorrect; blank is unanswered', () => {
  assert.equal(evaluateResponse(num('n', [10]), { type: 'numerical', value: '10' }), 'correct');
  assert.equal(evaluateResponse(num('n', [10]), { type: 'numerical', value: '11' }), 'incorrect');
  assert.equal(evaluateResponse(num('n', [10]), { type: 'numerical', value: '10.0' }), 'incorrect');
  assert.equal(evaluateResponse(num('n', [10]), { type: 'numerical', value: '  ' }), 'unanswered');
  assert.equal(evaluateResponse(num('n', [10]), { type: 'numerical', value: null }), 'unanswered');
  assert.equal(evaluateResponse(num('n', [-3, 3]), { type: 'numerical', value: '-3' }), 'correct');
});

test('mismatched response types are rejected', () => {
  assert.throws(() => evaluateResponse(mcq('q', ['A']), { type: 'numerical', value: '1' }), ResponseTypeMismatchError);
});

test('attempt scoring applies +4/−1/0 to MCQ and numerical alike, with breakdowns', () => {
  const questions = [mcq('m1', ['A']), mcq('m2', ['B']), mcq('m3', ['C']), num('n1', [5]), num('n2', [7])];
  const score = scoreAttempt(questions, {
    m1: { type: 'mcq', optionId: 'A' }, // +4
    m2: { type: 'mcq', optionId: 'A' }, // −1
    n1: { type: 'numerical', value: '5' }, // +4
    n2: { type: 'numerical', value: '8' }, // −1
    // m3 unanswered: 0
  });
  assert.equal(score.rawMarks, 6);
  assert.equal(score.maxMarks, 20);
  assert.equal(score.correct, 2);
  assert.equal(score.incorrect, 2);
  assert.equal(score.unanswered, 1);
  assert.equal(score.attempted, 4);
  assert.equal(score.accuracy, 0.5);
  assert.equal(score.bySubject.physics.rawMarks, 3);
  assert.equal(score.bySubject.mathematics.rawMarks, 3);
  assert.equal(score.byChapter['physics.kinematics'].unanswered, 1);
  assert.equal(score.byTopic['mathematics.sequence-series.am-gm'].incorrect, 1);
  assert.deepEqual(score.questions.find((q) => q.questionId === 'm3')?.response, { type: 'mcq', optionId: null });
});

test('a full 75-question paper is out of 300 and ranges from −75 to 300', () => {
  const subjects: JeeSubjectId[] = ['physics', 'chemistry', 'mathematics'];
  const paper: ScorableQuestion[] = subjects.flatMap((subjectId) => [
    ...Array.from({ length: 20 }, (_, i) => mcq(`${subjectId}-m${i}`, ['A'], { subjectId })),
    ...Array.from({ length: 5 }, (_, i) => num(`${subjectId}-n${i}`, [1], { subjectId })),
  ]);
  const allRight = Object.fromEntries(
    paper.map((q) => [q.id, q.type === 'mcq' ? { type: 'mcq' as const, optionId: 'A' as const } : { type: 'numerical' as const, value: '1' }])
  );
  const allWrong = Object.fromEntries(
    paper.map((q) => [q.id, q.type === 'mcq' ? { type: 'mcq' as const, optionId: 'B' as const } : { type: 'numerical' as const, value: '2' }])
  );
  assert.equal(scoreAttempt(paper, allRight).rawMarks, 300);
  assert.equal(scoreAttempt(paper, allRight).maxMarks, 300);
  assert.equal(scoreAttempt(paper, allWrong).rawMarks, -75);
  assert.equal(scoreAttempt(paper, {}).rawMarks, 0);
  assert.equal(scoreAttempt(paper, allRight).bySubject.chemistry.rawMarks, 100);
});

test('dropped questions award full marks to everyone; practice marking has no penalty', () => {
  const score = scoreAttempt([mcq('d', ['A'], { keyStatus: 'dropped' })], {});
  assert.equal(score.rawMarks, 4);
  assert.equal(score.dropped, 1);
  const practice = scoreAttempt([mcq('p', ['A'])], { p: { type: 'mcq', optionId: 'C' } }, PRACTICE_MARKING);
  assert.equal(practice.rawMarks, 0);
});

test('duplicate question ids in one attempt are rejected', () => {
  assert.throws(() => scoreAttempt([mcq('x', ['A']), mcq('x', ['B'])], {}));
});
