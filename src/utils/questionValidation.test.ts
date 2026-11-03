import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  isServableBankQuestion,
  toPublicBankQuestion,
  validateBankQuestion,
  validateGeneratedMcq,
  validateGeneratedMcqSet,
  validateResponse,
} from './questionValidation';
import {
  assembleFromBank,
  canOfferFullLengthMock,
  computeAvailability,
  loadBank,
  servableQuestions,
  summarizePaperSets,
} from './questionBank';
import type { BankMcqQuestion, BankNumericalQuestion, BankQuestion } from '../types/questionBank';
import type { JeeSubjectId } from '../data/jeeMainSyllabus';

const verified = { status: 'verified' as const, reviewedBy: 'Owner', reviewedAt: '2026-11-04' };

function curatedMcq(overrides: Partial<BankMcqQuestion> = {}): BankMcqQuestion {
  return {
    id: 'cur-phy-kin-9001',
    source: 'curated',
    type: 'mcq',
    subjectId: 'physics',
    chapterId: 'physics.kinematics',
    topicIds: ['physics.kinematics.relative-velocity'],
    difficulty: 'medium',
    stem: 'Two trains move towards each other at 20 m/s and 30 m/s. What is their relative speed?',
    options: [
      { id: 'A', text: '10 m/s' },
      { id: 'B', text: '50 m/s' },
      { id: 'C', text: '25 m/s' },
      { id: 'D', text: '600 m/s' },
    ],
    correctOptionIds: ['B'],
    explanation: 'Velocities add when moving towards each other: 20 + 30 = 50 m/s.',
    curated: { author: 'Tester', createdAt: '2026-11-03' },
    verification: verified,
    ...overrides,
  };
}

function pyqNumerical(overrides: Partial<BankNumericalQuestion> = {}): BankNumericalQuestion {
  return {
    id: 'pyq-2026-0402-s1-q21',
    source: 'pyq',
    type: 'numerical',
    subjectId: 'mathematics',
    chapterId: 'mathematics.permutations-combinations',
    topicIds: ['mathematics.permutations-combinations.permutations-combinations'],
    difficulty: 'medium',
    stem: 'Placeholder stem for schema testing only.',
    acceptedIntegers: [10],
    explanation: 'Placeholder explanation for schema testing only.',
    pyq: {
      exam: 'JEE Main',
      year: 2026,
      session: 2,
      date: '2026-04-02',
      shift: 1,
      questionNumber: 21,
      paperUrl: 'https://cdnbbsr.s3waas.gov.in/example/paper.pdf',
      answerKeyUrl: 'https://jeemain.nta.nic.in/example/final-key.pdf',
    },
    licence: { basis: 'permission_granted', reference: 'TEST-NTA-PERMISSION-001' },
    verification: verified,
    ...overrides,
  };
}

test('valid curated and PYQ questions pass validation', () => {
  assert.deepEqual(validateBankQuestion(curatedMcq()), []);
  assert.deepEqual(validateBankQuestion(pyqNumerical()), []);
});

test('bank validation rejects missing provenance, unofficial sources and AI questions', () => {
  const noProvenance = { ...pyqNumerical(), pyq: undefined };
  assert.ok(validateBankQuestion(noProvenance).some((e) => e.includes('PYQs need pyq provenance')));
  const coachingSite = pyqNumerical({
    pyq: { ...pyqNumerical().pyq!, answerKeyUrl: 'https://some-coaching-site.com/key.pdf' },
  });
  assert.ok(validateBankQuestion(coachingSite).some((e) => e.includes('answerKeyUrl')));
  const httpKey = pyqNumerical({ pyq: { ...pyqNumerical().pyq!, paperUrl: 'http://nta.ac.in/paper.pdf' } });
  assert.ok(validateBankQuestion(httpKey).some((e) => e.includes('paperUrl')));
  assert.ok(validateBankQuestion({ ...curatedMcq(), source: 'ai' }).some((e) => e.includes('AI questions never enter the bank')));
  assert.ok(validateBankQuestion(curatedMcq({ curated: undefined })).some((e) => e.includes('curated.author')));
});

test('bank validation rejects broken answer keys and syllabus mismatches', () => {
  assert.ok(validateBankQuestion(curatedMcq({ correctOptionIds: [] })).length > 0);
  assert.ok(validateBankQuestion(curatedMcq({ correctOptionIds: ['E' as 'A'] })).length > 0);
  const dupOptions = curatedMcq();
  dupOptions.options[1] = { id: 'B', text: '10 m/s' };
  assert.ok(validateBankQuestion(dupOptions).some((e) => e.includes('distinct')));
  assert.ok(validateBankQuestion(pyqNumerical({ acceptedIntegers: [2.5] })).some((e) => e.includes('whole numbers')));
  assert.ok(validateBankQuestion(curatedMcq({ topicIds: ['physics.optics.prism'] })).some((e) => e.includes('not in chapter')));
  assert.ok(validateBankQuestion(curatedMcq({ chapterId: 'chemistry.solutions' })).some((e) => e.includes('does not belong')));
  assert.ok(
    validateBankQuestion(curatedMcq({ verification: { status: 'verified' } })).some((e) => e.includes('reviewedBy'))
  );
});

test('only verified, valid questions are servable; public views never include answers', () => {
  const draft = curatedMcq({ id: 'cur-draft-1', verification: { status: 'pending_review' } });
  assert.equal(isServableBankQuestion(draft), false);
  assert.equal(isServableBankQuestion(curatedMcq()), true);

  const publicJson = JSON.stringify([toPublicBankQuestion(curatedMcq()), toPublicBankQuestion(pyqNumerical())]);
  assert.ok(!publicJson.includes('correctOptionIds'));
  assert.ok(!publicJson.includes('acceptedIntegers'));
  assert.ok(!publicJson.includes('explanation'));
  assert.ok(!publicJson.includes('Velocities add'));
});

test('AI-generated MCQs are rejected rather than repaired', () => {
  const good = {
    topic: 'Kinematics',
    question: 'A car accelerates uniformly from rest. Which graph is a straight line?',
    options: ['v–t graph', 'x–t graph', 'a–x graph', 'x–v graph'],
    correctIndex: 0,
    explanation: 'Velocity grows linearly with time under uniform acceleration.',
    sourcePage: 2,
    sourceQuote: 'v = u + at',
    difficulty: 'easy',
  };
  const pages = new Set([1, 2, 3]);
  assert.equal(validateGeneratedMcq(good, { validPageNumbers: pages }).ok, true);
  const cases: Array<[Record<string, unknown>, string]> = [
    [{ ...good, options: ['a', 'b', 'c'] }, 'four options'],
    [{ ...good, options: ['v–t graph', 'Option 2', 'c', 'd'] }, 'placeholder'],
    [{ ...good, options: ['same', 'Same', 'c', 'd'] }, 'duplicate options'],
    [{ ...good, correctIndex: 4 }, 'answer key'],
    [{ ...good, correctIndex: '0' }, 'answer key'],
    [{ ...good, explanation: '' }, 'explanation'],
    [{ ...good, sourcePage: 9 }, 'page'],
    [{ ...good, question: 'Why?' }, 'too short'],
  ];
  for (const [input, reason] of cases) {
    const result = validateGeneratedMcq(input, { validPageNumbers: pages });
    assert.equal(result.ok, false);
    if (!result.ok) assert.ok(result.reason.includes(reason), `${result.reason} should mention ${reason}`);
  }
  const set = validateGeneratedMcqSet([good, { ...good }, { ...good, correctIndex: 7 }], { validPageNumbers: pages });
  assert.equal(set.valid.length, 1);
  assert.equal(set.rejected.length, 2);
  assert.equal(validateGeneratedMcqSet('nope').valid.length, 0);
});

test('student responses are validated per question type', () => {
  const mcqQ = { id: 'q1', type: 'mcq' as const };
  const numQ = { id: 'q2', type: 'numerical' as const };
  assert.equal(validateResponse(mcqQ, { type: 'mcq', optionId: 'C' }), null);
  assert.equal(validateResponse(mcqQ, { type: 'mcq', optionId: null }), null);
  assert.ok(validateResponse(mcqQ, { type: 'mcq', optionId: 'Z' }));
  assert.ok(validateResponse(mcqQ, { type: 'numerical', value: '3' }));
  assert.equal(validateResponse(numQ, { type: 'numerical', value: '-12' }), null);
  assert.ok(validateResponse(numQ, { type: 'numerical', value: '1.5' })?.includes('whole number'));
  assert.ok(validateResponse(numQ, 'garbage'));
});

test('availability counts and assembly only use verified questions and never pad', () => {
  const bank: BankQuestion[] = [
    curatedMcq(),
    curatedMcq({ id: 'cur-draft-2', verification: { status: 'pending_review' } }),
    pyqNumerical(),
  ];
  const availability = computeAvailability(bank);
  assert.equal(availability.bySubject.physics.total, 1);
  assert.equal(availability.byChapter['physics.kinematics'].bySource.curated, 1);
  assert.equal(availability.bySubject.mathematics.bySource.pyq, 1);
  assert.equal(servableQuestions(bank).length, 2);

  const request = assembleFromBank(bank, { subjectId: 'physics', count: 10 });
  assert.equal(request.questions.length, 1);
  assert.equal(request.sufficient, false);
  assert.equal(request.available, 1);
});

test('full-length mocks require one complete verified paper (25 per subject: 20 MCQ + 5 numerical)', () => {
  const subjects: JeeSubjectId[] = ['physics', 'chemistry', 'mathematics'];
  const chapterFor: Record<JeeSubjectId, [string, string]> = {
    physics: ['physics.kinematics', 'physics.kinematics.relative-velocity'],
    chemistry: ['chemistry.solutions', 'chemistry.solutions.raoults-law'],
    mathematics: ['mathematics.sequence-series', 'mathematics.sequence-series.am-gm'],
  };
  const paper: BankQuestion[] = [];
  let n = 1;
  for (const subjectId of subjects) {
    const [chapterId, topicId] = chapterFor[subjectId];
    for (let i = 0; i < 25; i++) {
      const base = {
        subjectId,
        chapterId,
        topicIds: [topicId],
        pyq: { ...pyqNumerical().pyq!, questionNumber: n },
        licence: pyqNumerical().licence,
      };
      paper.push(
        i < 20
          ? ({ ...curatedMcq(), ...base, id: `pyq-full-${n}`, source: 'pyq', curated: undefined } as BankQuestion)
          : pyqNumerical({ ...base, id: `pyq-full-${n}` })
      );
      n++;
    }
  }
  const loaded = loadBank(paper);
  assert.deepEqual(loaded.errors, []);
  assert.equal(canOfferFullLengthMock(loaded.questions), true);
  assert.equal(summarizePaperSets(loaded.questions)[0].complete, true);

  const missingOne = loaded.questions.slice(1);
  assert.equal(canOfferFullLengthMock(missingOne), false);
  const oneUnverified = loaded.questions.map((q, i) => (i === 0 ? { ...q, verification: { status: 'pending_review' as const } } : q));
  assert.equal(canOfferFullLengthMock(oneUnverified), false);
});

test('the shipped draft samples are valid but not servable until the owner verifies them', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const records = JSON.parse(
    fs.readFileSync(path.join(root, 'data', 'question-bank', 'drafts', 'curated-samples-v1.json'), 'utf8')
  );
  const loaded = loadBank(records);
  assert.deepEqual(loaded.errors, []);
  assert.equal(loaded.questions.length, records.length);
  assert.equal(servableQuestions(loaded.questions).length, 0);
  assert.ok(loaded.questions.every((q) => q.source === 'curated'));
});

test('verified PYQs require a recorded reuse permission; drafts may stage them without one', () => {
  const withoutPermission = pyqNumerical({ licence: undefined });
  assert.ok(validateBankQuestion(withoutPermission).some((e) => e.includes('permission_granted')));
  const unverifiedLicence = pyqNumerical({ licence: { basis: 'unverified' } });
  assert.ok(validateBankQuestion(unverifiedLicence).length > 0);
  const missingReference = pyqNumerical({ licence: { basis: 'permission_granted' } });
  assert.ok(validateBankQuestion(missingReference).some((e) => e.includes('licence.reference')));
  const staged = pyqNumerical({ licence: { basis: 'unverified' }, verification: { status: 'draft' } });
  assert.deepEqual(validateBankQuestion(staged), []);
});
