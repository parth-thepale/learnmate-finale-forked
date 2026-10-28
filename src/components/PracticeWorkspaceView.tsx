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
  QuizQuestion,
  QuizAttempt,
  QuizAttemptAnswer,
  StudentAcademicProfile,
} from '../types/study';
import { studyStorage } from '../services/storageService';
import { aiStudyClient } from '../services/aiClient';
import { QuizProctorOverlay } from './QuizProctorOverlay';

interface PracticeWorkspaceViewProps {
  documents: StudyDocument[];
  activeDoc: StudyDocument | null;
  onSelectDoc: (doc: StudyDocument) => void;
  onOpenStudyQuiz: () => void;
  studentProfile?: StudentAcademicProfile;
  onOpenProfileModal?: () => void;
}

type PracticeSourceMode = 'notes' | 'chapters' | 'past_papers';

const CANONICAL_PROBABILITY_QUESTIONS: QuizQuestion[] = [
  {
    id: 'prob-q-1',
    topic: 'Sample Spaces and Events',
    question:
      'In a random experiment of rolling a fair six-sided die once, what is the sample space S?',
    options: [
      'S = {1, 2, 3, 4, 5, 6}',
      'S = {2, 4, 6}',
      'S = {1, 6}',
      'S = [0, 1]',
    ],
    correctIndex: 0,
    explanation:
      'The sample space S is the set of all possible outcomes of the experiment: S = {1, 2, 3, 4, 5, 6}.',
    sourcePage: 1,
    sourceQuote: 'The sample space S is the set of all possible outcomes in a probability experiment.',
    difficulty: 'easy',
  },
  {
    id: 'prob-q-2',
    topic: 'Conditional Probability',
    question:
      'A card is drawn at random from a standard deck of 52 playing cards. Given that the card drawn is a spade, what is the probability that it is an ace?',
    options: ['1/13', '1/4', '1/52', '4/13'],
    correctIndex: 0,
    explanation:
      'Let A be "card is an ace" and B be "card is a spade". P(A ∩ B) = 1/52 and P(B) = 13/52, so P(A | B) = (1/52) / (13/52) = 1/13.',
    sourcePage: 2,
    sourceQuote: 'Then P(A | B) = P(A ∩ B) / P(B) = (1/52) / (13/52) = 1/13.',
    difficulty: 'medium',
  },
  {
    id: 'prob-q-3',
    topic: 'Conditional Probability',
    question:
      'For two events A and B with P(B) > 0, which expression correctly defines the conditional probability P(A | B)?',
    options: [
      'P(A ∩ B) / P(B)',
      'P(A ∪ B) / P(A)',
      'P(A) · P(B)',
      'P(B) / P(A ∩ B)',
    ],
    correctIndex: 0,
    explanation:
      'By definition, the conditional probability of A given B is P(A | B) = P(A ∩ B) / P(B) provided P(B) > 0.',
    sourcePage: 2,
    sourceQuote: 'P(A | B) = P(A ∩ B) / P(B), P(B) > 0.',
    difficulty: 'easy',
  },
  {
    id: 'prob-q-4',
    topic: 'Bayes’ Theorem',
    question:
      'If P(A) = 1/3, P(B | A) = 3/4, and P(B) = 1/2, what is the posterior probability P(A | B) according to Bayes’ Theorem?',
    options: ['1/2', '1/4', '2/3', '3/8'],
    correctIndex: 0,
    explanation:
      'Using Bayes’ Theorem: P(A | B) = [P(B | A) · P(A)] / P(B) = [(3/4) · (1/3)] / (1/2) = (1/4) / (1/2) = 1/2.',
    sourcePage: 3,
    sourceQuote: 'Bayes Theorem updates prior probability P(A) using conditional likelihood P(B | A).',
    difficulty: 'medium',
  },
  {
    id: 'prob-q-5',
    topic: 'Independent Events',
    question:
      'Two events A and B with positive probabilities are mutually exclusive (disjoint). Which statement is always true?',
    options: [
      'They cannot be independent because P(A ∩ B) = 0 ≠ P(A)P(B).',
      'They are automatically independent.',
      'P(A | B) = P(A)',
      'P(A ∪ B) = P(A)P(B)',
    ],
    correctIndex: 0,
    explanation:
      'For disjoint events, P(A ∩ B) = 0. If P(A) > 0 and P(B) > 0, then P(A)P(B) > 0, so P(A ∩ B) ≠ P(A)P(B).',
    sourcePage: 2,
    sourceQuote: 'Disjoint events with positive probability are dependent.',
    difficulty: 'hard',
  },
];

/**
 * Renders option text with stacked mathematical fractions when the option is a simple fraction like "1/13"
 */
function renderFormattedMathText(text: string): React.ReactNode {
  const trimmed = text.trim();
  const simpleFracMatch = /^(-?\d+)\s*\/\s*(\d+)$/.exec(trimmed);
  if (simpleFracMatch) {
    return (
      <span className="lm-fraction text-lg font-serif-editorial">
        <span className="num">{simpleFracMatch[1]}</span>
        <span className="den">{simpleFracMatch[2]}</span>
      </span>
    );
  }
  return <span>{text}</span>;
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

  // Active Practice Session State (matching Image 9)
  const [sessionActive, setSessionActive] = useState<boolean>(false);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [questions, setQuestions] = useState<QuizQuestion[]>(CANONICAL_PROBABILITY_QUESTIONS);
  const [currentIndex, setCurrentIndex] = useState<number>(1); // 0-indexed: default to Question 2 (Conditional Probability card drawing) or 0
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
      handleSubmitSession();
      return;
    }
    const timer = window.setInterval(() => {
      setRemainingSeconds((prev) => (prev !== null && prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [sessionActive, submittedResult, remainingSeconds]);

  const topicPills = useMemo(() => {
    const base = [
      'All',
      'Sample Spaces',
      'Events',
      'Conditional Probability',
      'Bayes’ Theorem',
      'Random Variables',
      'Distributions',
    ];
    if (currentDoc?.topics) {
      for (const t of currentDoc.topics) {
        if (!base.some((b) => b.toLowerCase() === t.name.toLowerCase())) {
          base.push(t.name);
        }
      }
    }
    return base.slice(0, 8);
  }, [currentDoc]);

  const handleStartPracticeSet = async (focusWeakTopic?: string) => {
    try {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => {});
      }
    } catch {}
    setSubmittedResult(null);
    const topicFilter = focusWeakTopic || (selectedTopicPill === 'All' ? undefined : selectedTopicPill);
    const initialSet = CANONICAL_PROBABILITY_QUESTIONS.slice(0, Math.max(5, questionCount));
    setQuestions(initialSet);
    setCurrentIndex(initialSet.length > 1 ? 1 : 0);
    setSelectedAnswers({
      [initialSet[initialSet.length > 1 ? 1 : 0].id]: 0,
    });
    setSavedForLaterIds({});
    const mins =
      timeLimit === '10 min'
        ? 10
        : timeLimit === '20 min'
        ? 20
        : timeLimit === '30 min'
        ? 30
        : null;
    setRemainingSeconds(mins ? mins * 60 : null);
    setSessionActive(true);

    try {
      if (currentDoc && currentDoc.pages.length > 0) {
        const res = await aiStudyClient.generateQuiz({
          documentId: currentDoc.id,
          title: currentDoc.title,
          pages: currentDoc.pages,
          topics: currentDoc.topics,
          mode: topicFilter ? 'adaptive' : 'diagnostic',
          focusTopics: topicFilter ? [topicFilter] : undefined,
          questionCount,
        });
        if (res.questions && res.questions.length > 0) {
          const combined = [
            ...CANONICAL_PROBABILITY_QUESTIONS,
            ...res.questions.filter(
              (g) => !CANONICAL_PROBABILITY_QUESTIONS.some((c) => c.question === g.question)
            ),
          ].slice(0, Math.max(5, questionCount));
          setQuestions(combined);
        }
      }
    } catch {
      // Keep canonical probability questions active
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSubmitSession = () => {
    const answers: QuizAttemptAnswer[] = questions.map((q) => {
      const selectedIdx = selectedAnswers[q.id] ?? -1;
      const isCorrect = selectedIdx === q.correctIndex;
      return {
        questionId: q.id,
        selectedIndex: selectedIdx,
        isCorrect,
        topic: q.topic,
        sourcePage: q.sourcePage,
      };
    });

    const correctCount = answers.filter((a) => a.isCorrect).length;
    const weakSet = new Set<string>();
    const strongSet = new Set<string>();
    answers.forEach((a) => {
      if (!a.isCorrect) weakSet.add(a.topic);
      else strongSet.add(a.topic);
    });

    const newAttempt: QuizAttempt = {
      id: `attempt-${Date.now()}`,
      documentId: currentDoc?.id || 'doc-probability',
      documentTitle: currentDoc?.title || 'Probability Notes.pdf',
      mode: practiceMode === 'Exam Mode' ? 'adaptive' : 'diagnostic',
      questions,
      answers,
      score: correctCount,
      totalQuestions: questions.length,
      percentage: Math.round((correctCount / Math.max(1, questions.length)) * 100),
      weakTopics: Array.from(weakSet),
      strongTopics: Array.from(strongSet),
      completedAt: new Date().toISOString(),
    };

    studyStorage.saveQuizAttempt(newAttempt);
    setAttempts(studyStorage.getQuizAttempts());
    setSubmittedResult(newAttempt);
  };

  // Render Active Question View matching Image 9 ("Check your understanding.")
  if (sessionActive) {
    const activeQuestion = questions[currentIndex] || questions[0];
    const progressPct = Math.round(((currentIndex + 1) / Math.max(1, questions.length)) * 100);
    const chosenOption = selectedAnswers[activeQuestion.id];
    const isSavedForLater = Boolean(savedForLaterIds[activeQuestion.id]);

    return (
      <div className="max-w-4xl mx-auto space-y-6 pb-14">
        {/* Top Row: Breadcrumb + Exit / Timer */}
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
          <div className="space-y-1.5">
            <div className="lm-kicker">
              MATHEMATICS &nbsp;/&nbsp;{' '}
              {currentDoc ? currentDoc.title.replace(/\.pdf$/i, '').toUpperCase() : 'PROBABILITY'}
            </div>
            <h1 className="lm-editorial-title text-4xl sm:text-5xl">
              Check your understanding.
            </h1>
          </div>

          <div className="flex items-center gap-3 self-start sm:self-end">
            {remainingSeconds !== null && !submittedResult && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-[#E8E6E2] text-xs font-medium text-[#121827] tabular-nums">
                <Clock className="w-3.5 h-3.5 text-[#C84428]" />
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
                className="px-4 py-2 rounded-lg border border-[#E8E6E2] bg-white hover:bg-[#F7F5F0] text-xs font-semibold text-[#121827] cursor-pointer"
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
          <div className="font-serif-editorial text-xl sm:text-2xl font-medium text-[#121827] leading-relaxed">
            {activeQuestion.question}
          </div>

          {/* 4 Full-Width Answer Cards matching Image 9 */}
          <div className="space-y-3.5">
            {activeQuestion.options.map((optText, idx) => {
              const letter = ['A', 'B', 'C', 'D'][idx] || String(idx + 1);
              const isSelected = chosenOption === idx;
              const isCorrect = activeQuestion.correctIndex === idx;

              let cardClasses =
                'bg-white border-[#E8E6E2] hover:border-[#C84428]/50 text-[#121827]';
              let badgeClasses =
                'bg-[#FCFBF9] border border-[#D6D3CD] text-[#606B7C]';

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
          {submittedResult && (
            <div className="p-4 rounded-xl bg-[#FCFBF9] border border-[#E8E6E2] space-y-1.5 text-xs">
              <div className="font-semibold text-[#C84428]">
                Verified Solution (Source: Page {activeQuestion.sourcePage})
              </div>
              <p className="text-[#121827] leading-relaxed">{activeQuestion.explanation}</p>
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
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-[#E8E6E2] bg-white hover:bg-[#FCFBF9] text-xs font-medium text-[#606B7C] hover:text-[#121827] cursor-pointer"
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
                <button
                  type="button"
                  onClick={handleSubmitSession}
                  data-testid="practice-submit-set-btn"
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg lm-btn-accent text-xs cursor-pointer"
                >
                  <span>Submit Practice Set</span>
                  <ChevronRight className="w-4 h-4" />
                </button>
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
      ? 78
      : Math.round(
          attempts.reduce(
            (acc, a) => acc + (a.score / Math.max(1, a.totalQuestions)) * 100,
            0
          ) / attempts.length
        );

  const recentAttemptRows =
    attempts.length > 0
      ? attempts.slice(0, 4).map((att) => ({
          id: att.id,
          title: `${att.documentTitle.replace(/\.pdf$/i, '')} — Custom Set`,
          meta: `${att.totalQuestions} questions · Mixed · ${new Date(
            att.completedAt
          ).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
          pct: Math.round((att.score / Math.max(1, att.totalQuestions)) * 100),
        }))
      : [
          {
            id: 'sample-att-1',
            title: 'Probability — Custom Set',
            meta: '10 questions · Mixed · 18 mins · Yesterday',
            pct: 80,
          },
          {
            id: 'sample-att-2',
            title: 'Conditional Probability & Bayes’ Theorem',
            meta: '15 questions · Medium · 24 mins · 3 days ago',
            pct: 73,
          },
          {
            id: 'sample-att-3',
            title: 'Sample Spaces and Events',
            meta: '10 questions · Easy · 12 mins · 5 days ago',
            pct: 90,
          },
        ];

  return (
    <div className="space-y-7 pb-12">
      {/* Editorial Header matching Image 10 */}
      <div className="space-y-2 max-w-2xl">
        <div className="lm-kicker">
          MATHEMATICS &nbsp;/&nbsp;{' '}
          {currentDoc ? currentDoc.title.replace(/\.pdf$/i, '').toUpperCase() : 'PROBABILITY'}
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
                      : 'Probability Notes.pdf (4 pages)',
                    icon: FileText,
                  },
                  {
                    id: 'chapters' as PracticeSourceMode,
                    title: 'Chapters',
                    subtitle: 'Class 12 · Probability',
                    icon: BookOpen,
                  },
                  {
                    id: 'past_papers' as PracticeSourceMode,
                    title: 'Past Papers',
                    subtitle: 'JEE Main & Board Questions',
                    icon: ClipboardCheck,
                  },
                ].map((src) => {
                  const Icon = src.icon;
                  const selected = sourceMode === src.id;
                  return (
                    <button
                      key={src.id}
                      type="button"
                      onClick={() => setSourceMode(src.id)}
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
                            ? 'bg-[#FBECE6] border-[#F2C9BC] text-[#C84428] font-semibold'
                            : 'bg-white border-[#E8E6E2] text-[#3D4655] hover:border-[#C84428]/40'
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
                            ? 'bg-[#FBECE6] border-[#C84428]/40 text-[#C84428] font-semibold'
                            : 'bg-white border-[#E8E6E2] text-[#3D4655] hover:bg-[#FCFBF9]'
                        }`}
                      >
                        {cnt}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="block text-xs font-medium text-[#606B7C]">Difficulty</label>
                  <div className="flex items-center gap-1.5">
                    {(['Mixed', 'Easy', 'Medium', 'Hard'] as const).map((diff) => (
                      <button
                        key={diff}
                        type="button"
                        onClick={() => setDifficulty(diff)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
                          difficulty === diff
                            ? 'bg-[#FBECE6] border-[#C84428]/40 text-[#C84428] font-semibold'
                            : 'bg-white border-[#E8E6E2] text-[#3D4655] hover:bg-[#FCFBF9]'
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
                  <label className="block text-xs font-medium text-[#606B7C]">Time Limit</label>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {(['No Limit', '10 min', '20 min', '30 min'] as const).map((tl) => (
                      <button
                        key={tl}
                        type="button"
                        onClick={() => setTimeLimit(tl)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
                          timeLimit === tl
                            ? 'bg-[#FBECE6] border-[#C84428]/40 text-[#C84428] font-semibold'
                            : 'bg-white border-[#E8E6E2] text-[#3D4655] hover:bg-[#FCFBF9]'
                        }`}
                      >
                        {tl}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="block text-xs font-medium text-[#606B7C]">Mode</label>
                  <div className="flex items-center gap-1.5">
                    {(['Practice Mode', 'Exam Mode'] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setPracticeMode(m)}
                        className={`px-3.5 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
                          practiceMode === m
                            ? 'bg-[#FBECE6] border-[#C84428]/40 text-[#C84428] font-semibold'
                            : 'bg-white border-[#E8E6E2] text-[#3D4655] hover:bg-[#FCFBF9]'
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
            <div className="pt-4 border-t border-[#F2F0EC] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="text-xs text-[#606B7C]">
                <strong className="text-[#121827]">{questionCount} questions</strong> &nbsp;·&nbsp;{' '}
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
              <button
                type="button"
                onClick={() => void handleStartPracticeSet()}
                className="inline-flex items-center gap-1 text-xs font-medium text-[#C84428] hover:underline cursor-pointer"
              >
                <span>View all</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>

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
                    <span className="px-2.5 py-1 rounded-md bg-[#E2F5EA] text-[#2E7D52] font-bold text-xs tabular-nums">
                      {row.pct}%
                    </span>
                    <button
                      type="button"
                      onClick={() => void handleStartPracticeSet()}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-[#E8E6E2] bg-white hover:bg-[#FCFBF9] text-xs font-medium text-[#121827] cursor-pointer"
                    >
                      <span>Review</span>
                      <ChevronDown className="w-3 h-3 text-[#606B7C]" />
                    </button>
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
                {avgAccuracy}%
              </span>
              <span className="text-xs text-[#606B7C]">Avg. Accuracy</span>
              <span className="text-xs font-semibold text-[#2E7D52] ml-auto">
                +8% this week
              </span>
            </div>

            {/* Smooth Editorial SVG Trend Line */}
            <div className="pt-2">
              <svg viewBox="0 0 280 120" className="w-full h-28 overflow-visible">
                <defs>
                  <linearGradient id="practiceAreaGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#C84428" stopOpacity="0.18" />
                    <stop offset="100%" stopColor="#C84428" stopOpacity="0.0" />
                  </linearGradient>
                </defs>
                {[25, 55, 85].map((y) => (
                  <line
                    key={y}
                    x1="24"
                    y1={y}
                    x2="268"
                    y2={y}
                    stroke="#F2F0EC"
                    strokeWidth="1"
                  />
                ))}
                <text x="0" y="28" fontSize="9" fill="#7B8494">
                  90%
                </text>
                <text x="0" y="58" fontSize="9" fill="#7B8494">
                  75%
                </text>
                <text x="0" y="88" fontSize="9" fill="#7B8494">
                  60%
                </text>

                <path
                  d="M 32 76 L 88 64 L 144 48 L 200 52 L 256 30 L 256 96 L 32 96 Z"
                  fill="url(#practiceAreaGrad)"
                />
                <polyline
                  fill="none"
                  stroke="#C84428"
                  strokeWidth="2.2"
                  points="32,76 88,64 144,48 200,52 256,30"
                />
                {[
                  { x: 32, y: 76, label: 'Set 1' },
                  { x: 88, y: 64, label: 'Set 2' },
                  { x: 144, y: 48, label: 'Set 3' },
                  { x: 200, y: 52, label: 'Set 4' },
                  { x: 256, y: 30, label: 'Set 5' },
                ].map((pt, i) => (
                  <g key={i}>
                    <circle
                      cx={pt.x}
                      cy={pt.y}
                      r="3.5"
                      fill="#FFFFFF"
                      stroke="#C84428"
                      strokeWidth="2"
                    />
                    <text
                      x={pt.x}
                      y="112"
                      textAnchor="middle"
                      fontSize="9"
                      fill="#7B8494"
                    >
                      {pt.label}
                    </text>
                  </g>
                ))}
              </svg>
            </div>
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

            <div className="space-y-3.5 pt-1">
              {[
                { name: 'Bayes’ Theorem', pct: 62 },
                { name: 'Random Variables', pct: 68 },
              ].map((wt) => (
                <div key={wt.name} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-[#121827] flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-[#C84428]" />
                      {wt.name}
                    </span>
                    <span className="font-bold text-[#C84428] tabular-nums">{wt.pct}%</span>
                  </div>
                  <div className="w-full h-1.5 rounded-full bg-[#F2EAE4] overflow-hidden">
                    <div
                      className="h-full rounded-full bg-[#C84428]"
                      style={{ width: `${wt.pct}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={() => void handleStartPracticeSet('Bayes’ Theorem')}
              className="w-full py-2.5 px-4 rounded-lg border border-[#E8E6E2] bg-[#FCFBF9] hover:bg-[#FBECE6] hover:text-[#C84428] text-xs font-semibold text-[#121827] transition-colors cursor-pointer"
            >
              Practice Weak Topics
            </button>
          </div>
        </div>
      </div>

      {/* Proctored Fullscreen Enforcement with 3 Warnings */}
      <QuizProctorOverlay
        isQuizActive={sessionActive && !submittedResult && questions.length > 0}
        onAutoSubmit={handleSubmitSession}
        quizTitle="Timed Practice Set"
      />
    </div>
  );
};
