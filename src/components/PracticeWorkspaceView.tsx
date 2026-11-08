import React, { useState, useEffect, useMemo } from 'react';
import {
  Sparkles,
  Bookmark,
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  FileText,
  BookOpen,
  ClipboardCheck,
  Loader2,
  CheckCircle2,
  XCircle,
  RotateCcw,
  Clock,
} from 'lucide-react';
import {
  StudyDocument,
  PracticeQuizQuestion,
  QuizQuestion,
  QuizAttempt,
  StudentAcademicProfile,
} from '../types/study';
import { studyStorage } from '../services/storageService';
import { aiStudyClient, ApiRequestError } from '../services/aiClient';
import { identifyWeakTopics, assessTopics } from '../utils/weakTopics';
import { QuizProctorOverlay } from './QuizProctorOverlay';
import { JEE_MAIN_SYLLABUS, type JeeSubjectId } from '../data/jeeMainSyllabus';
import { gradeQuizSubmission } from '../utils/quizGrading';
import { PHY01_DRAFT_PRACTICE_QUESTIONS } from '../features/roadmaps/data/draftContent/phy01DraftContent';
import { MathRenderer } from './MathRenderer';

interface PracticeWorkspaceViewProps {
  documents: StudyDocument[];
  activeDoc: StudyDocument | null;
  onSelectDoc: (doc: StudyDocument) => void;
  onOpenStudyQuiz: () => void;
  studentProfile?: StudentAcademicProfile;
  onOpenProfileModal?: () => void;
}

type PracticeSourceMode = 'notes' | 'chapters' | 'past_papers';


/**
 * Renders option text and mathematical formulas via KaTeX
 */
function renderFormattedMathText(text: string): React.ReactNode {
  return <MathRenderer content={text} />;
}

export const PracticeWorkspaceView: React.FC<PracticeWorkspaceViewProps> = ({
  documents,
  activeDoc,
  onSelectDoc,
}) => {
  const currentDoc = activeDoc || documents[0] || null;

  // Practice Set Builder State (matching Image 10)
  const [sourceMode, setSourceMode] = useState<PracticeSourceMode>('notes');
  const [selectedTopicPill, setSelectedTopicPill] = useState<string>('All');
  const [questionCount, setQuestionCount] = useState<number>(10);
  const [difficulty, setDifficulty] = useState<'Mixed' | 'Easy' | 'Medium' | 'Hard'>('Mixed');
  const [timeLimit, setTimeLimit] = useState<'No Limit' | '10 min' | '20 min' | '30 min'>(
    '20 min'
  );
  const [practiceMode, setPracticeMode] = useState<'Practice Mode' | 'Exam Mode'>(
    'Practice Mode'
  );
  const [selectedSubject, setSelectedSubject] = useState<JeeSubjectId>('physics');
  const [selectedChapterId, setSelectedChapterId] = useState<string>('physics_unit_01');
  const [selectedPyqPaper, setSelectedPyqPaper] = useState<string>('jee-2024-jan-s1');
  const curatedQuestionsMetaRef = React.useRef<Record<string, { correctIndex: number; explanation: string }>>({});

  // Active Practice Session State (matching Image 9)
  const [sessionActive, setSessionActive] = useState<boolean>(false);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [questions, setQuestions] = useState<PracticeQuizQuestion[]>([]);
  const [setId, setSetId] = useState<string | null>(null);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const [selectedAnswers, setSelectedAnswers] = useState<Record<string, number>>({});
  const [savedForLaterIds, setSavedForLaterIds] = useState<Record<string, boolean>>({});
  const [submittedResult, setSubmittedResult] = useState<QuizAttempt | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);

  const [attempts, setAttempts] = useState<QuizAttempt[]>(() =>
    studyStorage.getQuizAttempts()
  );

  // Timer countdown during active timed session
  useEffect(() => {
    if (!sessionActive || submittedResult || remainingSeconds === null) return;
    if (remainingSeconds <= 0) {
      void handleSubmitSession();
      return;
    }
    const timer = window.setInterval(() => {
      setRemainingSeconds((prev) => (prev !== null && prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [sessionActive, submittedResult, remainingSeconds]);

  const currentSubjectChapters = useMemo(() => {
    const subj = JEE_MAIN_SYLLABUS.find((s) => s.id === selectedSubject);
    return subj ? subj.chapters : [];
  }, [selectedSubject]);

  const topicPills = useMemo(() => {
    const base = ['All'];
    if (currentDoc?.topics) {
      for (const t of currentDoc.topics) {
        if (!base.some((b) => b.toLowerCase() === t.name.toLowerCase())) {
          base.push(t.name);
        }
      }
    }
    return base.slice(0, 8);
  }, [currentDoc]);

  const handleStartPracticeSet = async (focusTopic?: string) => {
    setSubmittedResult(null);
    setSubmitError(null);
    setGenerateError(null);
    setQuestions([]);
    setSetId(null);
    setCurrentIndex(0);
    setSelectedAnswers({});
    setSavedForLaterIds({});
    const mins =
      timeLimit === '10 min'
        ? 10
        : timeLimit === '20 min'
        ? 20
        : timeLimit === '30 min'
        ? 30
        : null;
    setRemainingSeconds(null);
    setSessionActive(true);

    // If sourceMode is 'notes' and notes exist, attempt AI server generation
    if (sourceMode === 'notes' && currentDoc && currentDoc.pages.length > 0) {
      const topicFilter = focusTopic || (selectedTopicPill === 'All' ? undefined : selectedTopicPill);
      setIsGenerating(true);
      try {
        const res = await aiStudyClient.generateQuiz({
          documentId: currentDoc.id,
          title: currentDoc.title,
          pages: currentDoc.pages,
          topics: currentDoc.topics,
          mode: topicFilter ? 'adaptive' : 'diagnostic',
          focusTopics: topicFilter ? [topicFilter] : undefined,
          questionCount,
          forceRefresh: true,
        });
        setQuestions(res.questions);
        setSetId(res.setId);
        setRemainingSeconds(mins ? mins * 60 : null);
        setIsGenerating(false);
        return;
      } catch {
        // Fall back gracefully to curated JEE questions with local grading
      } finally {
        setIsGenerating(false);
      }
    }

    // Curated bank for Chapters, Past Papers, or fallback
    setIsGenerating(true);
    const meta: Record<string, { correctIndex: number; explanation: string }> = {};
    const assembled: PracticeQuizQuestion[] = [];
    const diffFilter = difficulty === 'Mixed' ? null : difficulty.toLowerCase();

    for (const q of PHY01_DRAFT_PRACTICE_QUESTIONS) {
      if (diffFilter && q.tier === 'foundation' && diffFilter !== 'easy') continue;
      if (diffFilter && q.tier === 'application' && diffFilter !== 'medium') continue;
      if (diffFilter && q.tier === 'jee_main' && diffFilter !== 'hard') continue;

      const practiceQ: PracticeQuizQuestion = {
        id: q.id,
        source: 'curated',
        topic: q.topicLabel || 'Units & Kinematics',
        question: q.stem,
        options: (q.options || ['A', 'B', 'C', 'D']) as [string, string, string, string],
        sourcePage: 1,
        difficulty: q.tier === 'foundation' ? 'easy' : q.tier === 'application' ? 'medium' : 'hard',
      };
      assembled.push(practiceQ);
      meta[q.id] = {
        correctIndex: q.correctOptionIndex ?? 0,
        explanation: q.explanation || 'Step-by-step JEE derivation.',
      };
      if (assembled.length >= questionCount) break;
    }

    if (assembled.length < questionCount) {
      const extra: Array<{ q: PracticeQuizQuestion; ans: number; exp: string }> = [
        {
          q: {
            id: 'cur-rot-01',
            source: 'curated',
            topic: 'Rotational Motion',
            question: 'A solid cylinder and a hollow cylinder of equal mass and radius roll down an inclined plane from rest without slipping. Which reaches the bottom first?',
            options: ['Solid cylinder', 'Hollow cylinder', 'Both reach at the same time', 'Depends on the angle of inclination'],
            sourcePage: 1,
            difficulty: 'medium',
          },
          ans: 0,
          exp: 'Acceleration down the incline is a = g sin(θ) / (1 + I / (m R²)). For a solid cylinder I / (m R²) = 1/2 = 0.5, whereas for a hollow cylinder I / (m R²) = 1.0. Thus the solid cylinder has larger acceleration and reaches first.',
        },
        {
          q: {
            id: 'cur-we-01',
            source: 'curated',
            topic: 'Work, Power & Energy',
            question: 'A body of mass 1 kg is lifted vertically through 1 m by an external force at constant speed. The work done by the gravitational force is (g = 9.8 m/s²):',
            options: ['-9.8 J', '+9.8 J', 'Zero', '-4.9 J'],
            sourcePage: 2,
            difficulty: 'easy',
          },
          ans: 0,
          exp: 'Work done by gravity W_g = -m g h = -(1)(9.8)(1) = -9.8 J because displacement is upward and gravity acts downward.',
        },
        {
          q: {
            id: 'cur-grav-01',
            source: 'curated',
            topic: 'Gravitation',
            question: 'If the radius of Earth shrinks by 1% while mass remains constant, the acceleration due to gravity on its surface would:',
            options: ['Increase by 2%', 'Decrease by 2%', 'Increase by 1%', 'Decrease by 1%'],
            sourcePage: 3,
            difficulty: 'medium',
          },
          ans: 0,
          exp: 'g = G M / R². For small fractional change: Δg/g ≈ -2(ΔR/R) = -2(-1%) = +2%.',
        },
      ];
      for (const item of extra) {
        if (assembled.length >= questionCount) break;
        assembled.push(item.q);
        meta[item.q.id] = { correctIndex: item.ans, explanation: item.exp };
      }
    }

    curatedQuestionsMetaRef.current = meta;
    setQuestions(assembled);
    setSetId(`curated-${Date.now()}`);
    setRemainingSeconds(mins ? mins * 60 : null);
    setIsGenerating(false);
  };

  const handleSubmitSession = async () => {
    if (!setId || questions.length === 0 || isSubmitting || submittedResult) return;
    setIsSubmitting(true);
    setSubmitError(null);

    // If it's a curated/local practice set, grade deterministically
    if (setId.startsWith('curated-')) {
      const attemptQuestions: QuizQuestion[] = questions.map((q) => {
        const m = curatedQuestionsMetaRef.current[q.id] || { correctIndex: 0, explanation: 'Step-by-step JEE derivation.' };
        return {
          id: q.id,
          topic: q.topic,
          question: q.question,
          options: q.options,
          correctIndex: m.correctIndex,
          explanation: m.explanation,
          sourcePage: q.sourcePage || 1,
          sourceQuote: '',
          difficulty: q.difficulty,
        };
      });
      const attempt = gradeQuizSubmission({
        attemptId: `att-${Date.now()}`,
        documentId: currentDoc?.id || 'jee-practice',
        documentTitle: currentDoc?.title || (sourceMode === 'chapters' ? 'JEE Chapter Practice' : 'JEE Main 2024 PYQ Shift 1'),
        mode: practiceMode === 'Exam Mode' ? 'adaptive' : 'diagnostic',
        questions: attemptQuestions,
        selectedIndices: selectedAnswers,
      });
      studyStorage.saveQuizAttempt(attempt);
      setAttempts(studyStorage.getQuizAttempts());
      setSubmittedResult(attempt);
      setIsSubmitting(false);
      return;
    }

    try {
      const { attempt } = await aiStudyClient.submitPracticeSet({ setId, selectedIndices: selectedAnswers });
      studyStorage.saveQuizAttempt(attempt);
      setAttempts(studyStorage.getQuizAttempts());
      setSubmittedResult(attempt);
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === 'set_not_found') {
        setGenerateError(err.message);
        setQuestions([]);
        setSetId(null);
      } else {
        // Fallback local grading if server submit failed
        const attemptQuestions: QuizQuestion[] = questions.map((q) => {
          const m = curatedQuestionsMetaRef.current[q.id] || { correctIndex: 0, explanation: 'Step-by-step JEE derivation.' };
          return {
            id: q.id,
            topic: q.topic,
            question: q.question,
            options: q.options,
            correctIndex: m.correctIndex,
            explanation: m.explanation,
            sourcePage: q.sourcePage || 1,
            sourceQuote: '',
            difficulty: q.difficulty,
          };
        });
        const attempt = gradeQuizSubmission({
          attemptId: `att-${Date.now()}`,
          documentId: currentDoc?.id || 'practice',
          documentTitle: currentDoc?.title || 'JEE Practice Set',
          mode: practiceMode === 'Exam Mode' ? 'adaptive' : 'diagnostic',
          questions: attemptQuestions,
          selectedIndices: selectedAnswers,
        });
        studyStorage.saveQuizAttempt(attempt);
        setAttempts(studyStorage.getQuizAttempts());
        setSubmittedResult(attempt);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  // Render Active Question View matching Image 9 ("Check your understanding.")
  if (sessionActive && questions.length === 0) {
    return (
      <div className="max-w-xl mx-auto py-16 text-center space-y-4" role={generateError ? 'alert' : 'status'}>
        {isGenerating ? (
          <p className="text-base text-[#606B7C]">Generating your practice set from {currentDoc?.title}…</p>
        ) : (
          <p className="text-base text-red-700">{generateError || 'No questions are available yet.'}</p>
        )}
        {!isGenerating && (
          <button
            type="button"
            onClick={() => setSessionActive(false)}
            className="px-5 py-2.5 rounded-lg border border-[var(--border-paper)] bg-[var(--bg-surface)] text-xs font-semibold text-[var(--text-ink)] cursor-pointer"
          >
            Back to Practice
          </button>
        )}
      </div>
    );
  }

  if (sessionActive) {
    const activeQuestion = questions[currentIndex] || questions[0];
    const reviewQuestion = submittedResult?.questions.find((q) => q.id === activeQuestion.id);
    const correctOptionIndex = reviewQuestion ? reviewQuestion.correctIndex : -1;
    const progressPct = Math.round(((currentIndex + 1) / Math.max(1, questions.length)) * 100);
    const chosenOption = selectedAnswers[activeQuestion.id];
    const isSavedForLater = Boolean(savedForLaterIds[activeQuestion.id]);

    return (
      <div className="max-w-4xl mx-auto space-y-6 pb-14">
        {/* Top Row: Breadcrumb + Exit / Timer */}
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
          <div className="space-y-1.5">
            <div className="lm-kicker">
              PRACTICE &nbsp;/&nbsp;{' '}
              {currentDoc ? currentDoc.title.replace(/\.pdf$/i, '').toUpperCase() : 'PRACTICE'}
            </div>
            <h1 className="lm-editorial-title text-4xl sm:text-5xl">
              Check your understanding.
            </h1>
          </div>

          <div className="flex items-center gap-3 self-start sm:self-end">
            {remainingSeconds !== null && !submittedResult && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-paper)] text-xs font-medium text-[var(--text-ink)] tabular-nums">
                <Clock className="w-3.5 h-3.5 text-[var(--accent-terracotta)]" />
                <span>
                  {Math.floor(remainingSeconds / 60)}:
                  {String(remainingSeconds % 60).padStart(2, '0')}
                </span>
              </span>
            )}
            <span className="text-sm font-medium text-[#606B7C] tabular-nums">
              Question <strong className="text-[#121827]">{currentIndex + 1}</strong> of{' '}
              <strong className="text-[#121827]">{questions.length}</strong>
            </span>
          </div>
        </div>

        {/* Thin Full-Width Terracotta Progress Bar matching Image 9 */}
        <div className="w-full h-1.5 rounded-full bg-[#EFECE6] overflow-hidden">
          <div
            className="h-full rounded-full bg-[#C84428] transition-all duration-300"
            style={{ width: `${progressPct}%` }}
          />
        </div>

        {/* Submitted Score Summary Banner (if user submitted set) */}
        {submittedResult && (
          <div className="lm-card-editorial p-5 bg-[#FCFBF9] border-[#C84428]/30 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="text-xs font-semibold uppercase tracking-wider text-[#C84428]">
                Practice Set Complete
              </div>
              <div className="font-serif-editorial text-2xl font-bold text-[#121827]">
                You scored {submittedResult.score} / {submittedResult.totalQuestions} (
                {Math.round(
                  (submittedResult.score / Math.max(1, submittedResult.totalQuestions)) * 100
                )}
                %)
              </div>
              <p className="text-xs text-[#606B7C]">
                Review the step-by-step explanations below or return to the Practice Set Builder.
              </p>
            </div>
            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={() => {
                  setSessionActive(false);
                  setSubmittedResult(null);
                }}
                className="px-4 py-2 rounded-lg border border-[var(--border-paper)] bg-[var(--bg-surface)] hover:bg-[var(--bg-subtle)] text-xs font-semibold text-[var(--text-ink)] cursor-pointer"
              >
                ← Back to Builder
              </button>
              <button
                type="button"
                onClick={() => handleStartPracticeSet()}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg lm-btn-accent text-xs cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Practice Again</span>
              </button>
            </div>
          </div>
        )}

        {/* Main Spacious Examination Card matching Image 9 */}
        <div className="lm-card-editorial p-6 sm:p-10 space-y-7">
          {/* Card Top Bar: Question Badge + Save for later */}
          <div className="flex items-center justify-between">
            <span className="px-3 py-1 rounded-md bg-[#FBECE6] text-[#C84428] text-xs font-semibold">
              Question {currentIndex + 1}
            </span>

            <button
              type="button"
              onClick={() =>
                setSavedForLaterIds((prev) => ({
                  ...prev,
                  [activeQuestion.id]: !prev[activeQuestion.id],
                }))
              }
              className={`inline-flex items-center gap-1.5 text-xs font-medium transition-colors cursor-pointer ${
                isSavedForLater ? 'text-[#C84428] font-semibold' : 'text-[#606B7C] hover:text-[#121827]'
              }`}
            >
              <Bookmark className={`w-3.5 h-3.5 ${isSavedForLater ? 'fill-current' : ''}`} />
              <span>{isSavedForLater ? 'Saved for later' : 'Save for later'}</span>
            </button>
          </div>

          {/* Large Editorial Question Text */}
          <div className="font-serif-editorial text-xl sm:text-2xl font-medium text-[var(--text-ink)] leading-relaxed">
            {activeQuestion.question}
          </div>

          {/* 4 Full-Width Answer Cards matching Image 9 */}
          <div className="space-y-3.5">
            {activeQuestion.options.map((optText, idx) => {
              const letter = ['A', 'B', 'C', 'D'][idx] || String(idx + 1);
              const isSelected = chosenOption === idx;
              const isCorrect = correctOptionIndex === idx;

              let cardClasses =
                'bg-[var(--bg-surface)] border-[var(--border-paper)] hover:border-[var(--accent-terracotta)]/50 text-[var(--text-ink)]';
              let badgeClasses =
                'bg-[var(--bg-subtle)] border border-[var(--border-paper-strong)] text-[var(--text-ink-muted)]';

              if (submittedResult) {
                if (isCorrect) {
                  cardClasses = 'bg-[#E2F5EA]/60 border-[#2E7D52] text-[#121827]';
                  badgeClasses = 'bg-[#2E7D52] text-white border-[#2E7D52]';
                } else if (isSelected) {
                  cardClasses = 'bg-[#FBECE6]/70 border-[#C84428] text-[#121827]';
                  badgeClasses = 'bg-[#C84428] text-white border-[#C84428]';
                }
              } else if (isSelected) {
                cardClasses =
                  'bg-[#FBECE6]/55 border-[#C84428] ring-1 ring-[#C84428]/30 text-[#121827]';
                badgeClasses = 'bg-[#C84428] text-white border-[#C84428]';
              }

              return (
                <button
                  key={idx}
                  type="button"
                  disabled={Boolean(submittedResult)}
                  onClick={() =>
                    setSelectedAnswers((prev) => ({
                      ...prev,
                      [activeQuestion.id]: idx,
                    }))
                  }
                  data-testid={`practice-option-${idx}`}
                  className={`w-full px-5 py-4 rounded-xl border text-left flex items-center justify-between gap-4 transition-all cursor-pointer ${cardClasses}`}
                >
                  <div className="flex items-center gap-4">
                    <span
                      className={`w-7 h-7 rounded-full text-xs font-bold flex items-center justify-center shrink-0 transition-colors ${badgeClasses}`}
                    >
                      {letter}
                    </span>
                    <div className="text-base text-[#121827]">
                      {renderFormattedMathText(optText)}
                    </div>
                  </div>

                  {submittedResult && isCorrect && (
                    <CheckCircle2 className="w-5 h-5 text-[#2E7D52] shrink-0" />
                  )}
                  {submittedResult && isSelected && !isCorrect && (
                    <XCircle className="w-5 h-5 text-[#C84428] shrink-0" />
                  )}
                </button>
              );
            })}
          </div>

          {/* Grounded Explanation Box when submitted */}
          {submittedResult && reviewQuestion && (
            <div className="p-4 rounded-xl bg-[#FCFBF9] border border-[#E8E6E2] space-y-1.5 text-xs">
              <div className="font-semibold text-[#C84428]">
                Explanation · AI-generated practice question
                {reviewQuestion.sourcePage > 0 ? ` (from page ${reviewQuestion.sourcePage} of your notes)` : ''}
              </div>
              <p className="text-[#121827] leading-relaxed">{reviewQuestion.explanation}</p>
            </div>
          )}

          {/* Bottom Navigation Bar matching Image 9 */}
          <div className="pt-4 border-t border-[#F2F0EC] flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => {
                if (currentIndex > 0) {
                  setCurrentIndex((prev) => prev - 1);
                } else {
                  setSessionActive(false);
                }
              }}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-[var(--border-paper)] bg-[var(--bg-surface)] hover:bg-[var(--bg-subtle)] text-xs font-medium text-[var(--text-ink-muted)] hover:text-[var(--text-ink)] cursor-pointer"
            >
              <ChevronLeft className="w-4 h-4" />
              <span>{currentIndex > 0 ? 'Previous' : 'Exit to Builder'}</span>
            </button>

            <div className="flex items-center gap-3">
              {!submittedResult && currentIndex < questions.length - 1 && (
                <button
                  type="button"
                  onClick={() => setCurrentIndex((prev) => prev + 1)}
                  className="px-3 py-2 text-xs font-medium text-[#606B7C] hover:text-[#121827] cursor-pointer"
                >
                  Skip
                </button>
              )}

              {currentIndex < questions.length - 1 ? (
                <button
                  type="button"
                  onClick={() => setCurrentIndex((prev) => prev + 1)}
                  data-testid="practice-next-question-btn"
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg lm-btn-accent text-xs cursor-pointer"
                >
                  <span>Next Question</span>
                  <ChevronRight className="w-4 h-4" />
                </button>
              ) : !submittedResult ? (
                <div className="flex flex-col items-end gap-1">
                  <button
                    type="button"
                    onClick={() => void handleSubmitSession()}
                    disabled={isSubmitting}
                    data-testid="practice-submit-set-btn"
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg lm-btn-accent text-xs cursor-pointer disabled:opacity-60 disabled:cursor-wait"
                  >
                    <span>{isSubmitting ? 'Grading…' : 'Submit Practice Set'}</span>
                    <ChevronRight className="w-4 h-4" />
                  </button>
                  {submitError && (
                    <p role="alert" className="text-xs text-red-700 max-w-xs text-right">
                      {submitError}
                    </p>
                  )}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Default View: Practice Set Builder matching Image 10 ("Practice, with purpose.")
  const avgAccuracy =
    attempts.length === 0
      ? null
      : Math.round(
          attempts.reduce(
            (acc, a) => acc + (a.score / Math.max(1, a.totalQuestions)) * 100,
            0
          ) / attempts.length
        );

  const recentAttemptRows = attempts.slice(0, 4).map((att) => ({
    id: att.id,
    title: att.documentTitle.replace(/\.pdf$/i, ''),
    meta: `${att.totalQuestions} questions · ${new Date(att.completedAt).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    })}`,
    pct: Math.round((att.score / Math.max(1, att.totalQuestions)) * 100),
  }));

  // Oldest → newest, last 5 attempts, for the real progress line.
  const trendPoints = attempts
    .slice(0, 5)
    .reverse()
    .map((att) => Math.round((att.score / Math.max(1, att.totalQuestions)) * 100));

  const weakTopicEvidence = identifyWeakTopics(attempts);
  const topicsAwaitingEvidence = assessTopics(attempts).filter((t) => t.status === 'insufficient_evidence').length;

  return (
    <div className="space-y-7 pb-12">
      {/* Editorial Header matching Image 10 */}
      <div className="space-y-2 max-w-2xl">
        <div className="lm-kicker">
          PRACTICE &nbsp;/&nbsp;{' '}
          {currentDoc ? currentDoc.title.replace(/\.pdf$/i, '').toUpperCase() : 'PRACTICE'}
        </div>
        <h1 className="lm-editorial-title text-4xl sm:text-5xl">
          Practice, with purpose.
        </h1>
        <p className="lm-editorial-subtitle text-base sm:text-lg text-[#4B5563]">
          Build a custom practice set from your notes, chapters or past papers, and focus on
          what matters most.
        </p>
      </div>

      {/* Main 12-Column Builder & Analytics Grid matching Image 10 */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left 8 Columns: Choose what to practice + Refine your set + Recent Attempts */}
        <div className="lg:col-span-8 space-y-6">
          {/* Builder Card */}
          <div className="lm-card-editorial p-6 space-y-6">
            {/* Section 1: Choose what to practice */}
            <div className="space-y-3">
              <h2 className="font-serif-editorial text-lg font-bold text-[#121827]">
                Choose what to practice
              </h2>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                {[
                  {
                    id: 'notes' as PracticeSourceMode,
                    title: 'My Notes',
                    subtitle: currentDoc
                      ? `${currentDoc.title} (${currentDoc.pages.length} pages)`
                      : 'No study material yet',
                    icon: FileText,
                    available: true,
                  },
                  {
                    id: 'chapters' as PracticeSourceMode,
                    title: 'Chapters',
                    subtitle: 'Syllabus chapter practice',
                    icon: BookOpen,
                    available: true,
                  },
                  {
                    id: 'past_papers' as PracticeSourceMode,
                    title: 'Past Papers',
                    subtitle: 'Official JEE PYQs',
                    icon: ClipboardCheck,
                    available: true,
                  },
                ].map((src) => {
                  const Icon = src.icon;
                  const selected = sourceMode === src.id;
                  return (
                    <button
                      key={src.id}
                      type="button"
                      disabled={!src.available}
                      aria-disabled={!src.available}
                      onClick={() => src.available && setSourceMode(src.id)}
                      className={`p-4 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between gap-2 ${
                        selected
                          ? 'bg-[#FCF8F6] border-[#C84428] ring-1 ring-[#C84428]/25'
                          : 'bg-white border-[#E8E6E2] hover:border-[#C84428]/40'
                      }`}
                    >
                      <div className="flex items-center justify-between w-full">
                        <div className="flex items-center gap-2">
                          <Icon
                            className={`w-4 h-4 ${
                              selected ? 'text-[#C84428]' : 'text-[#606B7C]'
                            }`}
                          />
                          <span className="font-serif-editorial font-bold text-sm text-[#121827]">
                            {src.title}
                          </span>
                        </div>
                        <span
                          className={`w-4 h-4 rounded-full border flex items-center justify-center ${
                            selected ? 'border-[#C84428]' : 'border-[#D6D3CD]'
                          }`}
                        >
                          {selected && (
                            <span className="w-2 h-2 rounded-full bg-[#C84428]" />
                          )}
                        </span>
                      </div>
                      <div className="text-xs text-[#606B7C] truncate">{src.subtitle}</div>
                    </button>
                  );
                })}
              </div>

              {documents.length > 1 && sourceMode === 'notes' && (
                <div className="pt-1 flex items-center gap-2 text-xs">
                  <span className="text-[#606B7C]">Active Note Source:</span>
                  <select
                    value={currentDoc?.id || ''}
                    onChange={(e) => {
                      const found = documents.find((d) => d.id === e.target.value);
                      if (found) onSelectDoc(found);
                    }}
                    className="px-2.5 py-1 rounded-lg border border-[#E8E6E2] bg-[#FCFBF9] text-xs font-medium text-[#121827]"
                  >
                    {documents.map((doc) => (
                      <option key={doc.id} value={doc.id}>
                        {doc.title} ({doc.pages.length} pages)
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {sourceMode === 'chapters' && (
                <div className="pt-2 grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div>
                    <label className="block text-xs font-medium text-[#606B7C] mb-1">Subject</label>
                    <select
                      value={selectedSubject}
                      onChange={(e) => {
                        const s = e.target.value as JeeSubjectId;
                        setSelectedSubject(s);
                        const first = JEE_MAIN_SYLLABUS.find((item) => item.id === s)?.chapters[0];
                        if (first) setSelectedChapterId(first.id);
                      }}
                      className="w-full px-2.5 py-1.5 rounded-lg border border-[#E8E6E2] bg-[#FCFBF9] text-xs font-medium text-[#121827] capitalize"
                    >
                      <option value="physics">Physics</option>
                      <option value="chemistry">Chemistry</option>
                      <option value="mathematics">Mathematics</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[#606B7C] mb-1">Unit / Chapter</label>
                    <select
                      value={selectedChapterId}
                      onChange={(e) => setSelectedChapterId(e.target.value)}
                      className="w-full px-2.5 py-1.5 rounded-lg border border-[#E8E6E2] bg-[#FCFBF9] text-xs font-medium text-[#121827]"
                    >
                      {currentSubjectChapters.map((ch) => (
                        <option key={ch.id} value={ch.id}>
                          Unit {ch.unitNumber}: {ch.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              {sourceMode === 'past_papers' && (
                <div className="pt-2 text-xs space-y-1">
                  <label className="block text-xs font-medium text-[#606B7C]">Official JEE Main PYQ Shift</label>
                  <select
                    value={selectedPyqPaper}
                    onChange={(e) => setSelectedPyqPaper(e.target.value)}
                    className="w-full max-w-md px-2.5 py-1.5 rounded-lg border border-[#E8E6E2] bg-[#FCFBF9] text-xs font-medium text-[#121827]"
                  >
                    <option value="jee-2024-jan-s1">JEE (Main) 2024 — 27 Jan Shift 1 (Physics, Chemistry & Math)</option>
                    <option value="jee-2024-jan-s2">JEE (Main) 2024 — 29 Jan Shift 2 (Physics & Math)</option>
                    <option value="jee-2023-apr-s1">JEE (Main) 2023 — 08 Apr Shift 1 (Full Benchmark Paper)</option>
                  </select>
                </div>
              )}
            </div>

            <div className="border-t border-[#F2F0EC]" />

            {/* Section 2: Refine your set */}
            <div className="space-y-4">
              <h2 className="font-serif-editorial text-lg font-bold text-[#121827]">
                Refine your set
              </h2>

              {/* Topics Row */}
              <div className="space-y-2">
                <label className="block text-xs font-medium text-[#606B7C]">Topics</label>
                <div className="flex flex-wrap items-center gap-2">
                  {topicPills.map((pill) => {
                    const active = selectedTopicPill === pill;
                    return (
                      <button
                        key={pill}
                        type="button"
                        onClick={() => setSelectedTopicPill(pill)}
                        className={`px-3.5 py-1.5 rounded-full text-xs font-medium transition-colors cursor-pointer border ${
                          active
                            ? 'bg-[var(--accent-terracotta-subtle)] border-[var(--accent-terracotta-border)] text-[var(--accent-terracotta)] font-semibold'
                            : 'bg-[var(--bg-surface)] border-[var(--border-paper)] text-[var(--text-ink-secondary)] hover:border-[var(--accent-terracotta)]/40'
                        }`}
                      >
                        {pill}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Questions & Difficulty Row */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
                <div className="space-y-2">
                  <label className="block text-xs font-medium text-[#606B7C]">Questions</label>
                  <div className="flex items-center gap-1.5">
                    {[5, 10, 15, 20, 30].map((cnt) => (
                      <button
                        key={cnt}
                        type="button"
                        onClick={() => setQuestionCount(cnt)}
                        className={`px-3.5 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
                          questionCount === cnt
                            ? 'bg-[var(--accent-terracotta-subtle)] border-[var(--accent-terracotta)]/40 text-[var(--accent-terracotta)] font-semibold'
                            : 'bg-[var(--bg-surface)] border-[var(--border-paper)] text-[var(--text-ink-secondary)] hover:bg-[var(--bg-subtle)]'
                        }`}
                      >
                        {cnt}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="block text-xs font-medium text-[var(--text-ink-muted)]">Difficulty</label>
                  <div className="flex items-center gap-1.5">
                    {(['Mixed', 'Easy', 'Medium', 'Hard'] as const).map((diff) => (
                      <button
                        key={diff}
                        type="button"
                        onClick={() => setDifficulty(diff)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
                          difficulty === diff
                            ? 'bg-[var(--accent-terracotta-subtle)] border-[var(--accent-terracotta)]/40 text-[var(--accent-terracotta)] font-semibold'
                            : 'bg-[var(--bg-surface)] border-[var(--border-paper)] text-[var(--text-ink-secondary)] hover:bg-[var(--bg-subtle)]'
                        }`}
                      >
                        {diff}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Time Limit & Mode Row */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
                <div className="space-y-2">
                  <label className="block text-xs font-medium text-[var(--text-ink-muted)]">Time Limit</label>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {(['No Limit', '10 min', '20 min', '30 min'] as const).map((tl) => (
                      <button
                        key={tl}
                        type="button"
                        onClick={() => setTimeLimit(tl)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
                          timeLimit === tl
                            ? 'bg-[var(--accent-terracotta-subtle)] border-[var(--accent-terracotta)]/40 text-[var(--accent-terracotta)] font-semibold'
                            : 'bg-[var(--bg-surface)] border-[var(--border-paper)] text-[var(--text-ink-secondary)] hover:bg-[var(--bg-subtle)]'
                        }`}
                      >
                        {tl}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="block text-xs font-medium text-[var(--text-ink-muted)]">Mode</label>
                  <div className="flex items-center gap-1.5">
                    {(['Practice Mode', 'Exam Mode'] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setPracticeMode(m)}
                        className={`px-3.5 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
                          practiceMode === m
                            ? 'bg-[var(--accent-terracotta-subtle)] border-[var(--accent-terracotta)]/40 text-[var(--accent-terracotta)] font-semibold'
                            : 'bg-[var(--bg-surface)] border-[var(--border-paper)] text-[var(--text-ink-secondary)] hover:bg-[var(--bg-subtle)]'
                        }`}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Summary & Generate Practice Set Action Bar */}
            <div className="pt-4 border-t border-[var(--border-paper)] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="text-xs text-[var(--text-ink-muted)]">
                <strong className="text-[var(--text-ink)]">{questionCount} questions</strong> &nbsp;·&nbsp;{' '}
                {difficulty} difficulty &nbsp;·&nbsp;{' '}
                {timeLimit === 'No Limit' ? 'Untimed' : timeLimit.replace('min', 'minutes')}{' '}
                &nbsp;·&nbsp; {practiceMode}
              </div>

              <button
                type="button"
                disabled={isGenerating}
                onClick={() => void handleStartPracticeSet()}
                data-testid="generate-practice-set-btn"
                className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg lm-btn-accent text-xs cursor-pointer shrink-0"
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Preparing Questions...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    <span>Generate Practice Set →</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Recent Attempts Card matching Image 10 */}
          <div className="lm-card-editorial p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-serif-editorial text-lg font-bold text-[#121827]">
                Recent Attempts
              </h2>
            </div>

            {recentAttemptRows.length === 0 && (
              <p className="text-xs text-[#606B7C]">No practice attempts yet. Your results will appear here.</p>
            )}

            <div className="divide-y divide-[#F2F0EC]">
              {recentAttemptRows.map((row) => (
                <div
                  key={row.id}
                  className="py-3.5 flex items-center justify-between gap-4 first:pt-1 last:pb-1"
                >
                  <div className="min-w-0">
                    <div className="font-serif-editorial font-bold text-sm text-[#121827] truncate">
                      {row.title}
                    </div>
                    <div className="text-xs text-[#606B7C] mt-0.5">{row.meta}</div>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <span className="px-2.5 py-1 rounded-md bg-[#F2F0EC] text-[#121827] font-bold text-xs tabular-nums">
                      {row.pct}%
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right 4 Columns: Your Practice Progress + Focus on these topics */}
        <div className="lg:col-span-4 space-y-6">
          {/* Your Practice Progress Chart Card */}
          <div className="lm-card-editorial p-6 space-y-4">
            <h2 className="font-serif-editorial text-lg font-bold text-[#121827]">
              Your Practice Progress
            </h2>

            <div className="flex items-baseline gap-2">
              <span className="font-serif-editorial font-bold text-3xl text-[#121827] tabular-nums">
                {avgAccuracy === null ? '—' : `${avgAccuracy}%`}
              </span>
              <span className="text-xs text-[#606B7C]">
                {avgAccuracy === null ? 'No attempts yet' : `Avg. accuracy over ${attempts.length} attempt${attempts.length === 1 ? '' : 's'}`}
              </span>
            </div>

            {trendPoints.length >= 2 ? (
              <div className="pt-2">
                <svg viewBox="0 0 280 120" className="w-full h-28 overflow-visible" role="img" aria-label="Accuracy in your recent practice attempts">
                  {[0, 50, 100].map((pct) => (
                    <g key={pct}>
                      <line x1="28" y1={100 - pct * 0.8} x2="268" y2={100 - pct * 0.8} stroke="#F2F0EC" strokeWidth="1" />
                      <text x="0" y={103 - pct * 0.8} fontSize="9" fill="#7B8494">
                        {pct}%
                      </text>
                    </g>
                  ))}
                  <polyline
                    fill="none"
                    stroke="#C84428"
                    strokeWidth="2.2"
                    points={trendPoints
                      .map((pct, i) => `${32 + (i * 224) / Math.max(1, trendPoints.length - 1)},${100 - pct * 0.8}`)
                      .join(' ')}
                  />
                  {trendPoints.map((pct, i) => (
                    <circle
                      key={i}
                      cx={32 + (i * 224) / Math.max(1, trendPoints.length - 1)}
                      cy={100 - pct * 0.8}
                      r="3.5"
                      fill="#FFFFFF"
                      stroke="#C84428"
                      strokeWidth="2"
                    />
                  ))}
                </svg>
              </div>
            ) : (
              <p className="text-xs text-[#606B7C]">Complete at least two practice sets to see your trend.</p>
            )}
          </div>

          {/* Focus on these topics Card matching Image 10 */}
          <div className="lm-card-editorial p-6 space-y-4">
            <div className="space-y-1">
              <h2 className="font-serif-editorial text-lg font-bold text-[#121827]">
                Focus on these topics
              </h2>
              <p className="text-xs text-[#606B7C]">
                Based on your recent mistakes and quiz results:
              </p>
            </div>

            {weakTopicEvidence.length > 0 ? (
              <div className="space-y-3.5 pt-1">
                {weakTopicEvidence.slice(0, 3).map((wt) => {
                  const pct = Math.round(wt.accuracy * 100);
                  return (
                    <div key={wt.key} className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium text-[#121827] flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-[#C84428]" />
                          {wt.label}
                        </span>
                        <span className="font-bold text-[#C84428] tabular-nums">{pct}%</span>
                      </div>
                      <div className="w-full h-1.5 rounded-full bg-[#F2EAE4] overflow-hidden">
                        <div className="h-full rounded-full bg-[#C84428]" style={{ width: `${pct}%` }} />
                      </div>
                      <p className="text-[11px] text-[#606B7C]">{wt.reason}</p>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-[#606B7C] pt-1">
                {topicsAwaitingEvidence > 0
                  ? `Not enough practice yet to identify weak topics (${topicsAwaitingEvidence} topic${topicsAwaitingEvidence === 1 ? '' : 's'} need more questions across at least two attempts).`
                  : 'Practise a few sets and Learnmate will point out topics that need work.'}
              </p>
            )}

            {weakTopicEvidence.length > 0 && (
              <button
                type="button"
                onClick={() => void handleStartPracticeSet(weakTopicEvidence[0].label)}
                className="w-full py-2.5 px-4 rounded-lg border border-[#E8E6E2] bg-[#FCFBF9] hover:bg-[#FBECE6] hover:text-[#C84428] text-xs font-semibold text-[#121827] transition-colors cursor-pointer"
              >
                Practise {weakTopicEvidence[0].label}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Proctored Fullscreen Enforcement with 3 Warnings */}
      <QuizProctorOverlay
        isQuizActive={sessionActive && !submittedResult && questions.length > 0}
        onAutoSubmit={() => void handleSubmitSession()}
        quizTitle="Timed Practice Set"
      />
    </div>
  );
};
