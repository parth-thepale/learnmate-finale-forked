import type { Express } from 'express';
import type { ValidatedGeneratedMcq } from '../utils/questionValidation';
import { createAiPracticeSet, gradeSubmission, toPublicPracticeQuestion } from './practiceService';
import { newQuestionSetId, TrustedAttemptRejectedError, type QuestionSetStore, type StoredQuestionSet } from './questionSetStore';

/**
 * Practice HTTP routes: document practice set creation and server-side grading/submission.
 * Registered by server.ts behind the API access-control middleware (authentication, payload
 * validation, rate limits and AI quota run before these handlers). AI generation is injected so
 * the routes can be exercised in tests without calling a model.
 */

export const MIN_PRACTICE_QUESTIONS = 5;

export interface PracticePageInput {
  pageNumber: number;
  title: string;
  content: string;
}

export interface PracticeTopicInput {
  id: string;
  name: string;
  summary: string;
  keyConcepts: string[];
  sourcePages: number[];
}

export interface QuizGenerationInput {
  mode: 'diagnostic' | 'adaptive';
  title: string;
  pages: PracticePageInput[];
  topics: PracticeTopicInput[];
  focusTopics: string[];
  /** Already clamped to MIN_PRACTICE_QUESTIONS..30. */
  questionCount: number;
  forceRefresh: boolean;
}

/** Generates validated questions; throws when a reliable set cannot be produced. */
export type QuizGenerator = (input: QuizGenerationInput) => Promise<{ valid: ValidatedGeneratedMcq[]; rejectedCount: number }>;

export interface PracticeRouteDeps {
  questionSetStore: QuestionSetStore;
  generateQuiz: QuizGenerator;
  describeGenerationFailure: (err: unknown) => { aiStatus?: string };
}

export function registerPracticeRoutes(app: Express, deps: PracticeRouteDeps): void {
  app.post('/api/study/quiz', async (req, res) => {
    const uid = req.authUser?.uid;
    if (!uid) {
      res.status(401).json({ error: 'Please sign in to practise.', code: 'auth_required' });
      return;
    }
    const {
      documentId = '',
      title,
      pages = [],
      topics = [],
      mode = 'diagnostic',
      focusTopics = [],
      questionCount = 6,
      forceRefresh = false,
    } = req.body as {
      documentId?: string;
      title?: string;
      pages?: PracticePageInput[];
      topics?: PracticeTopicInput[];
      mode?: 'diagnostic' | 'adaptive';
      focusTopics?: string[];
      questionCount?: number;
      forceRefresh?: boolean;
    };

    const clampedCount = Math.max(MIN_PRACTICE_QUESTIONS, Math.min(30, Number(questionCount) || 6));
    let validQuestions: ValidatedGeneratedMcq[];
    let rejectedCount = 0;
    try {
      const generated = await deps.generateQuiz({ mode, title: title || '', pages, topics, focusTopics, questionCount: clampedCount, forceRefresh: Boolean(forceRefresh) });
      validQuestions = generated.valid;
      rejectedCount = generated.rejectedCount;
    } catch (err) {
      // No fallback quiz: an unreliable quiz is worse than an honest failure.
      res.status(503).json({
        error: "We couldn't generate a reliable quiz right now. Please try again in a moment.",
        code: 'question_generation_failed',
        aiStatus: deps.describeGenerationFailure(err).aiStatus,
      });
      return;
    }

    let storedSet: StoredQuestionSet;
    try {
      storedSet = createAiPracticeSet({
        setId: newQuestionSetId(),
        uid,
        mode,
        documentId,
        documentTitle: title || 'Study Material',
        focusTopics,
        questions: validQuestions,
      });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Invalid practice request.', code: 'invalid_request' });
      return;
    }

    try {
      await deps.questionSetStore.create(storedSet);
    } catch (err) {
      console.warn('[practice] could not store question set:', err instanceof Error ? err.message : err);
      res.status(503).json({
        error: 'Practice is temporarily unavailable. Please try again shortly.',
        code: 'practice_unavailable',
      });
      return;
    }

    res.json({
      setId: storedSet.id,
      expiresAt: storedSet.expiresAt,
      source: 'ai',
      requestedCount: clampedCount,
      rejectedCount,
      questions: storedSet.questions.map(toPublicPracticeQuestion),
    });
  });


  // 3b. Grade a submitted practice set on the server. Submissions are recorded once per set.
  app.post('/api/practice/submit', async (req, res) => {
    const uid = req.authUser?.uid;
    if (!uid) {
      res.status(401).json({ error: 'Please sign in to practise.', code: 'auth_required' });
      return;
    }
    const { setId, responses = {} } = req.body as {
      setId: string;
      responses?: Record<string, unknown>;
    };

    let storedSet: StoredQuestionSet | null;
    try {
      storedSet = await deps.questionSetStore.get(uid, setId);
    } catch {
      res.status(503).json({ error: 'Practice is temporarily unavailable. Please try again shortly.', code: 'practice_unavailable' });
      return;
    }
    if (!storedSet) {
      res.status(404).json({
        error: 'This practice set has expired or could not be found. Please start a new one.',
        code: 'set_not_found',
      });
      return;
    }
    if (storedSet.submission) {
      res.json({ attempt: storedSet.submission.attempt, alreadySubmitted: true });
      return;
    }

    const graded = gradeSubmission(storedSet, responses);
    if (!graded.ok) {
      const code = graded.status === 409 ? 'set_outdated' : graded.status === 500 ? 'grading_failed' : 'invalid_request';
      res.status(graded.status).json({ error: graded.error, code });
      return;
    }
    const attempt = graded.attempt;

    try {
      const recorded = await deps.questionSetStore.recordSubmission(uid, storedSet.id, {
        submittedAt: attempt.completedAt,
        attempt,
      });
      if (!recorded) {
        res.status(404).json({ error: 'This practice set has expired. Please start a new one.', code: 'set_not_found' });
        return;
      }
      res.json({
        attempt: recorded.submission.attempt,
        alreadySubmitted: recorded.alreadySubmitted,
        // true when the trusted attempt is stored in the account (Firestore); false in local dev.
        persisted: deps.questionSetStore.kind === 'firestore',
      });
    } catch (err) {
      if (err instanceof TrustedAttemptRejectedError) {
        console.error(`[practice] submission for ${storedSet.id} rejected: ${err.problems.slice(0, 3).join(' | ')}`);
        res.status(500).json({ error: 'Your answers could not be graded. Nothing was saved; please try again.', code: 'grading_failed' });
        return;
      }
      res.status(503).json({ error: 'Your answers could not be saved. Please try submitting again.', code: 'practice_unavailable' });
    }
  });

}
