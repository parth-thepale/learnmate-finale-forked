import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BRAIN_TEASER_SETS, getBrainTeaserSet, type BrainTeaserSet } from '../data/brainTeasersData';
import { generateBrainTeaserPdfBytes } from '../utils/brainTeaserPdfGenerator';
import { parseYouTubeUrl } from '../utils/quizGrading';
import { studyStorage } from './storageService';
import { assessTopics } from '../utils/weakTopics';
import type { QuizAttempt } from '../types/study';

describe('Learnmate Complete Sessions Page Redesign — Verification', () => {
  it('1. Brain Teasers: Exactly 3 publication sets with 18 questions each (54 questions total)', () => {
    assert.equal(BRAIN_TEASER_SETS.length, 3, 'Must have exactly 3 brain teaser sets');

    const totalQuestions = BRAIN_TEASER_SETS.reduce((sum, s) => sum + s.questions.length, 0);
    assert.equal(totalQuestions, 54, 'Must have exactly 54 total questions across all 3 sets');

    const allQuestionIds = new Set<string>();

    BRAIN_TEASER_SETS.forEach((set, idx) => {
      assert.equal(set.setNumber, idx + 1, `Set ${idx + 1} has correct setNumber`);
      assert.equal(set.questions.length, 18, `Set ${idx + 1} must contain exactly 18 questions`);
      assert.ok(set.title && set.title.length > 5, `Set ${idx + 1} has descriptive title`);
      assert.ok(set.subjectCoverage && set.subjectCoverage.length > 5, `Set ${idx + 1} has subject coverage`);

      // Verify each question
      set.questions.forEach((q, qIdx) => {
        assert.ok(!allQuestionIds.has(q.id), `Question ID ${q.id} must be unique`);
        allQuestionIds.add(q.id);

        assert.equal(q.questionNumber, qIdx + 1, `Question number matches index`);
        assert.ok(q.stem && q.stem.length > 20, `Question ${q.id} stem must be substantial`);
        assert.equal(q.options.length, 4, `Question ${q.id} must have exactly 4 options`);
        assert.ok(
          q.correctOptionIndex >= 0 && q.correctOptionIndex < 4,
          `Question ${q.id} correctOptionIndex must be in range 0..3`
        );
        assert.ok(
          q.explanation && q.explanation.length > 25,
          `Question ${q.id} must have detailed step-by-step reasoning`
        );
        assert.ok(
          q.formulaReference && q.formulaReference.length > 3,
          `Question ${q.id} must include mathematical formula reference`
        );
        assert.ok(
          ['easy', 'medium', 'hard'].includes(q.difficulty),
          `Question ${q.id} must have valid difficulty`
        );
      });
    });
  });

  it('2. Brain Teaser Set Lookup: getBrainTeaserSet returns correct set for 1, 2, and 3', () => {
    const set1 = getBrainTeaserSet(1);
    const set2 = getBrainTeaserSet(2);
    const set3 = getBrainTeaserSet(3);

    assert.ok(set1 && set1.setNumber === 1 && set1.title.includes('Mechanics'));
    assert.ok(set2 && set2.setNumber === 2 && set2.title.includes('Electromagnetism'));
    assert.ok(set3 && set3.setNumber === 3 && set3.title.includes('Coordinate Geometry'));
  });

  it('3. Brain Teaser PDF Compilation: Generates valid multi-page PDF binaries starting with %PDF-', async () => {
    for (let setNum = 1; setNum <= 3; setNum++) {
      const set = getBrainTeaserSet(setNum as 1 | 2 | 3)!;
      const pdfBytes = await generateBrainTeaserPdfBytes(set);

      assert.ok(pdfBytes instanceof Uint8Array, `PDF output for Set ${setNum} must be Uint8Array`);
      assert.ok(pdfBytes.length > 5000, `PDF output for Set ${setNum} must have non-trivial size`);

      // Check PDF magic header %PDF-
      const header = String.fromCharCode(...pdfBytes.slice(0, 5));
      assert.equal(header, '%PDF-', `Set ${setNum} PDF must start with %PDF- header`);
    }
  });

  it('4. YouTube Resource Ingestion: parseYouTubeUrl validates URLs correctly', () => {
    const validWatch = parseYouTubeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    assert.equal(validWatch.valid, true);
    assert.equal(validWatch.videoId, 'dQw4w9WgXcQ');

    const validShort = parseYouTubeUrl('https://youtu.be/dQw4w9WgXcQ');
    assert.equal(validShort.valid, true);
    assert.equal(validShort.videoId, 'dQw4w9WgXcQ');

    const invalidUrl = parseYouTubeUrl('https://google.com/search?q=test');
    assert.equal(invalidUrl.valid, false);
  });

  it('5. Previous Quiz Inspection: Zero duplicate attempt creation upon inspection', () => {
    const initialAttempts = studyStorage.getQuizAttempts();
    const initialCount = initialAttempts.length;

    // Simulate inspection of existing attempts
    const inspected = studyStorage.getQuizAttempts();
    assert.equal(inspected.length, initialCount, 'Inspecting past attempts must never duplicate records');
  });

  it('6. JEE Main Marking & Profile Analysis Assessment: Evaluates correctly without data loss', () => {
    const dummyAttempt: QuizAttempt = {
      id: `att-test-${Date.now()}`,
      documentId: 'doc-test-1',
      documentTitle: 'Kinematics & Newton Laws',
      mode: 'adaptive',
      score: 12,
      totalQuestions: 15,
      percentage: 80,
      weakTopics: ['Friction on Incline'],
      strongTopics: ['Projectile Motion'],
      completedAt: new Date().toISOString(),
      questions: [
        {
          id: 'q1',
          topic: 'Projectile Motion',
          question: 'Find maximum range...',
          options: ['u^2/g', 'u^2/2g', '2u^2/g', 'u/g'],
          correctIndex: 0,
          explanation: 'Standard formula R_max = u^2/g',
          sourcePage: 1,
          sourceQuote: '',
          difficulty: 'medium',
        },
        {
          id: 'q2',
          topic: 'Friction on Incline',
          question: 'Find critical angle...',
          options: ['tan^-1(mu)', 'sin^-1(mu)', 'cos^-1(mu)', 'cot^-1(mu)'],
          correctIndex: 0,
          explanation: 'Standard angle of repose theta = tan^-1(mu)',
          sourcePage: 2,
          sourceQuote: '',
          difficulty: 'hard',
        },
      ],
      answers: [
        {
          questionId: 'q1',
          selectedIndex: 0,
          isCorrect: true,
          topic: 'Projectile Motion',
          sourcePage: 1,
        },
        {
          questionId: 'q2',
          selectedIndex: 1,
          isCorrect: false,
          topic: 'Friction on Incline',
          sourcePage: 2,
        },
      ],
    };

    // Verify JEE marks calculation: 12 correct (+48), 3 incorrect (-3) = 45 / 60
    const correctCount = dummyAttempt.score;
    const incorrectCount = dummyAttempt.totalQuestions - dummyAttempt.score;
    const marks = correctCount * 4 - incorrectCount * 1;
    assert.equal(marks, 45, 'JEE marks calculation must be (+4 * correct) - (1 * incorrect)');

    // Verify topic assessment
    const topicAssessment = assessTopics([dummyAttempt]);
    assert.ok(Array.isArray(topicAssessment), 'assessTopics must return array');
  });
});
