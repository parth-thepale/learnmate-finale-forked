import React, { useState, useEffect } from 'react';
import {
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  Clock,
  Layers,
  Sparkles,
  Award,
  AlertTriangle,
  Lightbulb,
  HelpCircle,
  Calculator,
  Edit3,
  X,
  Play,
  RotateCcw,
  Check,
  ChevronDown,
  ChevronUp,
  Lock,
  ChevronRight,
  Info,
} from 'lucide-react';
import type { Checkpoint } from '../types/checkpoint.types';
import type { Roadmap } from '../types/roadmap.types';
import type {
  AssessmentAttemptResult,
  CheckpointProgress,
  RevisionItem,
} from '../types/progress.types';
import { MathRenderer } from '../../../components/MathRenderer';
import { CapsuleBadge, CapsuleButton, CapsuleProgressPill } from '../../../components/capsule';
import { getCheckpointTheory, hasAuthoredTheory } from '../data/theory/checkpointTheoryRegistry';
import {
  getCheckpointQuizQuestions,
  gradeQuizSubmission,
} from '../data/quizzes/checkpointQuizBank';
import type { QuizGradingResult } from '../types/checkpointQuiz.types';

interface CheckpointLearningViewProps {
  checkpoint: Checkpoint;
  roadmap: Roadmap;
  progress?: CheckpointProgress;
  isLocked?: boolean;
  lockDescription?: string;
  onBack: () => void;
  onUpdateProgress: (updated: CheckpointProgress) => void;
  onRecordAssessment?: (checkpointId: string, result: AssessmentAttemptResult) => { scheduledRevisions: RevisionItem[] };
}

type TabMode = 'theory' | 'quiz' | 'progress';

export const CheckpointLearningView: React.FC<CheckpointLearningViewProps> = ({
  checkpoint,
  roadmap,
  progress,
  isLocked = false,
  lockDescription,
  onBack,
  onUpdateProgress,
  onRecordAssessment,
}) => {
  const [activeTab, setActiveTab] = useState<TabMode>('theory');
  const [activeTool, setActiveTool] = useState<'calc' | 'scratchpad' | null>(null);

  // Scratchpad state
  const [scratchpadText, setScratchpadText] = useState(() => {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage.getItem(`lm_scratchpad_${checkpoint.id}`) || '';
    }
    return '';
  });

  // Calculator state
  const [calcInput, setCalcInput] = useState('');
  const [calcResult, setCalcResult] = useState<string | null>(null);

  // Theory Module
  const theoryModule = getCheckpointTheory(checkpoint.id);
  const isAuthored = hasAuthoredTheory(checkpoint.id);
  const quizQuestions = getCheckpointQuizQuestions(checkpoint.id);

  // Quiz State
  const [studentAnswers, setStudentAnswers] = useState<Record<string, { selectedOption?: number; numericalInput?: string }>>({});
  const [gradingResult, setGradingResult] = useState<QuizGradingResult | null>(null);
  const [expandedDerivations, setExpandedDerivations] = useState<Record<string, boolean>>({});

  // Theory Read status
  const isTheoryCompleted = Boolean(progress?.revisionCompleted);
  const hasPassedQuiz = Boolean(progress?.masteryStatus === 'strong' || progress?.masteryStatus === 'developing');

  const handleSaveScratchpad = (text: string) => {
    setScratchpadText(text);
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(`lm_scratchpad_${checkpoint.id}`, text);
    }
  };

  const handleEvaluateCalc = () => {
    try {
      // Safe arithmetic evaluator
      const sanitized = calcInput.replace(/[^0-9+\-*/().^ ]/g, '');
      const evaluated = Function(`'use strict'; return (${sanitized})`)();
      setCalcResult(String(evaluated));
    } catch {
      setCalcResult('Error in expression');
    }
  };

  const handleMarkTheoryCompleted = () => {
    const updated: CheckpointProgress = {
      checkpointId: checkpoint.id,
      roadmapId: checkpoint.roadmapId,
      status: progress?.status === 'completed' ? 'completed' : 'current',
      currentStage: 'recall',
      diagnosticCleared: progress?.diagnosticCleared ?? false,
      revisionCompleted: true,
      masteryStatus: progress?.masteryStatus ?? 'unattempted',
      masteryScore: progress?.masteryScore ?? 0,
      lastActivityAt: new Date().toISOString(),
      historicalAttemptsCount: progress?.historicalAttemptsCount ?? 0,
    };
    onUpdateProgress(updated);
    setActiveTab('quiz');
  };

  const handleSelectOption = (questionId: string, optionIndex: number) => {
    if (gradingResult) return; // Prevent changing after submission until retry
    setStudentAnswers((prev) => ({
      ...prev,
      [questionId]: {
        ...prev[questionId],
        selectedOption: prev[questionId]?.selectedOption === optionIndex ? -1 : optionIndex,
      },
    }));
  };

  const handleNumericalInput = (questionId: string, val: string) => {
    if (gradingResult) return;
    setStudentAnswers((prev) => ({
      ...prev,
      [questionId]: {
        ...prev[questionId],
        numericalInput: val,
      },
    }));
  };

  const handleSubmitQuiz = () => {
    const result = gradeQuizSubmission(checkpoint.id, studentAnswers);
    setGradingResult(result);

    const isMastered = result.scorePercentage >= 60;
    const masteryStatus = result.scorePercentage >= 80 ? 'strong' : result.scorePercentage >= 60 ? 'developing' : 'needs_reinforcement';

    const assessmentResult: AssessmentAttemptResult = {
      attemptId: `quiz_attempt_${Date.now()}`,
      score: result.rawMarks,
      totalMarks: result.maxMarks,
      rawMarks: result.rawMarks,
      percentage: result.scorePercentage,
      correctCount: result.correctCount,
      incorrectCount: result.incorrectCount,
      unansweredCount: result.unansweredCount,
      timeTakenSeconds: 0,
      completedAt: result.completedAt,
      weakTopics: result.incorrectCount > 0 ? [checkpoint.topicIds[0] || checkpoint.id] : [],
      strongTopics: result.correctCount > 0 ? [checkpoint.topicIds[0] || checkpoint.id] : [],
      mode: 'learner',
    };

    // Update checkpoint progress
    const updated: CheckpointProgress = {
      checkpointId: checkpoint.id,
      roadmapId: checkpoint.roadmapId,
      status: (isTheoryCompleted && isMastered) ? 'completed' : isMastered ? 'completed' : 'needs_reinforcement',
      currentStage: 'analysis',
      diagnosticCleared: progress?.diagnosticCleared ?? false,
      revisionCompleted: isTheoryCompleted || result.passed,
      assessmentResult,
      masteryStatus,
      masteryScore: result.scorePercentage,
      lastActivityAt: new Date().toISOString(),
      historicalAttemptsCount: (progress?.historicalAttemptsCount || 0) + 1,
    };

    onUpdateProgress(updated);
  };

  const handleRetryQuiz = () => {
    setStudentAnswers({});
    setGradingResult(null);
  };

  return (
    <div className="max-w-[1380px] mx-auto px-4 sm:px-6 py-6 space-y-6">
      {/* 1. TOP BREADCRUMB & UTILITY TOOLS BAR */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[var(--border-paper)] pb-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--accent-terracotta)] hover:underline cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back to {roadmap.title}</span>
          </button>
          <span className="text-[var(--text-ink-muted)]">•</span>
          <span className="font-mono text-[11px] font-bold px-1.5 py-0.5 rounded border border-[var(--border-paper)] bg-[var(--bg-surface-warm)] text-[var(--text-ink)]">
            {checkpoint.id}
          </span>
          <span className="text-xs text-[var(--text-ink-secondary)] truncate">
            Milestone 0{checkpoint.order}
          </span>
        </div>

        {/* Quick Tools: Calculator & Scratchpad */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setActiveTool(activeTool === 'calc' ? null : 'calc')}
            className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border flex items-center gap-1.5 transition-colors cursor-pointer ${
              activeTool === 'calc'
                ? 'bg-[var(--accent-terracotta)] text-white border-[var(--accent-terracotta)] shadow-xs'
                : 'bg-[var(--bg-surface)] text-[var(--text-ink-secondary)] border-[var(--border-paper)] hover:border-[var(--border-paper-strong)]'
            }`}
          >
            <Calculator className="w-3.5 h-3.5" />
            <span>Calc</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTool(activeTool === 'scratchpad' ? null : 'scratchpad')}
            className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border flex items-center gap-1.5 transition-colors cursor-pointer ${
              activeTool === 'scratchpad'
                ? 'bg-[var(--accent-terracotta)] text-white border-[var(--accent-terracotta)] shadow-xs'
                : 'bg-[var(--bg-surface)] text-[var(--text-ink-secondary)] border-[var(--border-paper)] hover:border-[var(--border-paper-strong)]'
            }`}
          >
            <Edit3 className="w-3.5 h-3.5" />
            <span>Notes</span>
          </button>
        </div>
      </div>

      {/* Prerequisite Notification if locked */}
      {isLocked && (
        <div className="p-3.5 rounded-xl border border-amber-300 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 flex items-start gap-2.5 text-xs text-amber-900 dark:text-amber-200">
          <Lock className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <div className="leading-relaxed">
            <span className="font-bold">Prerequisite Notice:</span>{' '}
            {lockDescription || 'Earlier milestones require demonstrated mastery before this milestone can count toward official completion.'}{' '}
            You can still review the complete theory and attempt the practice quiz below.
          </div>
        </div>
      )}

      {/* QUICK UTILITY DRAWER */}
      {activeTool && (
        <div className="paper-card p-4 bg-[var(--bg-surface-warm)] border border-[var(--border-paper-strong)] animate-in fade-in duration-100">
          <div className="flex items-center justify-between border-b border-[var(--border-paper)] pb-2 mb-3">
            <span className="font-serif-editorial font-bold text-sm text-[var(--text-ink)] capitalize">
              {activeTool === 'calc' && 'Scientific Calculator'}
              {activeTool === 'scratchpad' && 'Checkpoint Study Journal'}
            </span>
            <button
              type="button"
              onClick={() => setActiveTool(null)}
              className="text-[var(--text-ink-muted)] hover:text-[var(--text-ink)] cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {activeTool === 'calc' && (
            <div className="max-w-md space-y-2">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={calcInput}
                  onChange={(e) => setCalcInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleEvaluateCalc()}
                  placeholder="e.g. (9.8 * 2.5^2) / 2"
                  className="w-full px-3 py-1.5 text-xs paper-input font-mono"
                />
                <button
                  type="button"
                  onClick={handleEvaluateCalc}
                  className="px-4 py-1.5 paper-btn-accent text-xs font-semibold cursor-pointer"
                >
                  Eval
                </button>
              </div>
              {calcResult !== null && (
                <div className="p-2 rounded bg-[var(--bg-surface)] border border-[var(--border-paper)] text-xs font-mono text-[var(--text-ink)] font-bold">
                  Result: {calcResult}
                </div>
              )}
            </div>
          )}

          {activeTool === 'scratchpad' && (
            <div>
              <textarea
                value={scratchpadText}
                onChange={(e) => handleSaveScratchpad(e.target.value)}
                placeholder="Record derivations, formulas, or tricky boundary conditions..."
                rows={4}
                className="w-full p-2.5 text-xs paper-input font-mono"
              />
              <div className="text-[10px] text-[var(--text-ink-muted)] mt-1">
                Auto-saved locally for this checkpoint.
              </div>
            </div>
          )}
        </div>
      )}

      {/* 2. CHECKPOINT HERO & NAVIGATION HEADER */}
      <div className="paper-card p-6 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="paper-kicker text-[var(--accent-terracotta)] font-bold">
                {checkpoint.subject.toUpperCase()} · MILESTONE 0{checkpoint.order}
              </span>
              <CapsuleBadge
                label={
                  progress?.status === 'completed'
                    ? 'Mastered'
                    : progress?.status === 'revision_due'
                    ? 'Revision Due'
                    : progress?.status === 'needs_reinforcement'
                    ? 'Needs Practice'
                    : isLocked
                    ? 'Prereq Locked'
                    : 'In Progress'
                }
                variant={
                  progress?.status === 'completed'
                    ? 'success'
                    : progress?.status === 'needs_reinforcement'
                    ? 'danger'
                    : 'accent'
                }
                size="sm"
              />
              <CapsuleBadge
                label={isAuthored ? 'Curated Study Module' : 'Syllabus & Diagnostic Overview'}
                variant={isAuthored ? 'accent' : 'subtle'}
                size="sm"
              />
            </div>
            <h1 className="paper-title text-2xl sm:text-3xl text-[var(--text-ink)]">
              {checkpoint.title}
            </h1>
            <p className="text-xs sm:text-sm text-[var(--text-ink-secondary)] max-w-2xl leading-relaxed">
              {theoryModule.subtitle}
            </p>
          </div>

          {/* Quick Metrics Badge */}
          <div className="flex flex-wrap items-center gap-2 p-3 rounded-xl border border-[var(--border-paper)] bg-[var(--bg-surface-warm)] shrink-0">
            <div className="text-center px-3 border-r border-[var(--border-paper)]">
              <span className="text-[10px] uppercase font-semibold text-[var(--text-ink-muted)] block">Workload</span>
              <span className="text-xs font-bold text-[var(--text-ink)] flex items-center justify-center gap-1">
                <Clock className="w-3.5 h-3.5 text-[var(--accent-terracotta)]" />
                ~{theoryModule.estimatedMinutes}m
              </span>
            </div>
            <div className="text-center px-3 border-r border-[var(--border-paper)]">
              <span className="text-[10px] uppercase font-semibold text-[var(--text-ink-muted)] block">Theory</span>
              <span className={`text-xs font-bold flex items-center justify-center gap-1 ${isTheoryCompleted ? 'text-emerald-600' : 'text-amber-600'}`}>
                {isTheoryCompleted ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Clock className="w-3.5 h-3.5" />}
                {isTheoryCompleted ? 'Completed' : 'Pending'}
              </span>
            </div>
            <div className="text-center px-3">
              <span className="text-[10px] uppercase font-semibold text-[var(--text-ink-muted)] block">Quiz Mastery</span>
              <span className="text-xs font-bold text-[var(--text-ink)]">
                {progress?.masteryScore ? `${progress.masteryScore}%` : 'Not Attempted'}
              </span>
            </div>
          </div>
        </div>

        {/* Tab Selector */}
        <div className="flex items-center gap-2 pt-2 border-t border-[var(--border-paper)]">
          <button
            type="button"
            onClick={() => setActiveTab('theory')}
            className={`px-4 py-2 rounded-lg text-xs font-semibold flex items-center gap-2 border transition-all cursor-pointer ${
              activeTab === 'theory'
                ? 'bg-[var(--accent-terracotta)] text-white border-[var(--accent-terracotta)] shadow-xs'
                : 'bg-[var(--bg-surface)] text-[var(--text-ink-secondary)] border-[var(--border-paper)] hover:border-[var(--border-paper-strong)]'
            }`}
          >
            <BookOpen className="w-4 h-4" />
            <span>{isAuthored ? '1. Structured Theory' : '1. Syllabus & Overview'}</span>
            {isTheoryCompleted && <CheckCircle2 className="w-3.5 h-3.5 text-white/90" />}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('quiz')}
            className={`px-4 py-2 rounded-lg text-xs font-semibold flex items-center gap-2 border transition-all cursor-pointer ${
              activeTab === 'quiz'
                ? 'bg-[var(--accent-terracotta)] text-white border-[var(--accent-terracotta)] shadow-xs'
                : 'bg-[var(--bg-surface)] text-[var(--text-ink-secondary)] border-[var(--border-paper)] hover:border-[var(--border-paper-strong)]'
            }`}
          >
            <Sparkles className="w-4 h-4" />
            <span>{isAuthored ? '2. Practice Quiz' : '2. Diagnostic Quiz'}</span>
            <span className="px-1.5 py-0.2 rounded text-[10px] bg-black/10 dark:bg-white/10 font-mono">
              {quizQuestions.length} Qs
            </span>
            {hasPassedQuiz && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('progress')}
            className={`px-4 py-2 rounded-lg text-xs font-semibold flex items-center gap-2 border transition-all cursor-pointer ${
              activeTab === 'progress'
                ? 'bg-[var(--accent-terracotta)] text-white border-[var(--accent-terracotta)] shadow-xs'
                : 'bg-[var(--bg-surface)] text-[var(--text-ink-secondary)] border-[var(--border-paper)] hover:border-[var(--border-paper-strong)]'
            }`}
          >
            <Award className="w-4 h-4" />
            <span>3. Milestone Progress</span>
          </button>
        </div>
      </div>

      {/* 3. MAIN WORKSPACE: 2-COLUMN DOSSIER LAYOUT */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        
        {/* MAIN STAGE (Left 8 cols) */}
        <div className="lg:col-span-8 space-y-6">

          {/* TAB 1: STRUCTURED THEORY */}
          {activeTab === 'theory' && (
            <div className="space-y-6">
              
              {/* Fallback Notice if not fully authored */}
              {!isAuthored && (
                <div className="p-4 rounded-xl border border-sky-200 dark:border-sky-900/60 bg-sky-50/70 dark:bg-sky-950/20 flex items-start gap-3 text-xs text-sky-900 dark:text-sky-200">
                  <Info className="w-4 h-4 text-sky-600 dark:text-sky-400 shrink-0 mt-0.5" />
                  <div className="space-y-1 leading-relaxed">
                    <span className="font-bold text-sky-950 dark:text-sky-100">
                      Syllabus Curriculum Scope & Diagnostic Overview
                    </span>
                    <p>
                      This milestone provides official NTA JEE 2026 syllabus topics, learning objectives, and diagnostic assessment questions. Full textbook derivations and animated visual diagrams are currently authored for foundational milestones (e.g. Kinematics, Mole Concept, Functions, Quadratics).
                    </p>
                  </div>
                </div>
              )}
              
              {/* Learning Objectives */}
              <div className="paper-card p-5 space-y-3">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[var(--accent-terracotta)]">
                  <BookOpen className="w-4 h-4" />
                  <span>Learning Objectives</span>
                </div>
                <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs text-[var(--text-ink)]">
                  {theoryModule.learningObjectives.map((obj, i) => (
                    <li key={i} className="flex items-start gap-2 p-2.5 rounded-lg border border-[var(--border-paper)] bg-[var(--bg-surface-warm)]">
                      <CheckCircle2 className="w-4 h-4 text-[var(--accent-terracotta)] shrink-0 mt-0.5" />
                      <span>{obj}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Definitions */}
              {theoryModule.definitions && theoryModule.definitions.length > 0 && (
                <div className="paper-card p-5 space-y-3">
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[var(--text-ink-muted)]">
                    <Info className="w-4 h-4 text-[var(--accent-terracotta)]" />
                    <span>Important Definitions & Operational Principles</span>
                  </div>
                  <div className="grid grid-cols-1 gap-3">
                    {theoryModule.definitions.map((def, i) => (
                      <div key={i} className="p-3.5 rounded-xl border border-[var(--border-paper)] bg-[var(--bg-surface)] space-y-1">
                        <span className="font-bold text-xs text-[var(--accent-terracotta)] block font-mono">
                          {def.term}
                        </span>
                        <p className="text-xs text-[var(--text-ink)] leading-relaxed">
                          {def.definition}
                        </p>
                        {def.context && (
                          <div className="text-[11px] text-[var(--text-ink-muted)] italic pt-1">
                            JEE Context: {def.context}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Concept Modules */}
              {theoryModule.concepts.map((concept, cIdx) => (
                <div key={concept.id} className="paper-card p-5 space-y-4">
                  <div className="border-b border-[var(--border-paper)] pb-2 flex items-center justify-between">
                    <h3 className="paper-title text-lg text-[var(--text-ink)]">
                      {cIdx + 1}. {concept.title}
                    </h3>
                  </div>

                  {/* Explanation text */}
                  <div className="text-xs sm:text-sm text-[var(--text-ink)] leading-relaxed whitespace-pre-line font-serif-editorial">
                    {concept.explanation}
                  </div>

                  {/* Diagram if available */}
                  {concept.diagramSvg && (
                    <div className="my-3 p-3 rounded-xl border border-[var(--border-paper)] bg-[var(--bg-surface-warm)] text-center">
                      <div
                        dangerouslySetInnerHTML={{ __html: concept.diagramSvg }}
                        className="mx-auto max-w-md overflow-x-auto"
                      />
                      {concept.diagramCaption && (
                        <p className="text-[11px] text-[var(--text-ink-muted)] mt-2 italic">
                          {concept.diagramCaption}
                        </p>
                      )}
                    </div>
                  )}

                  {/* Formulas Grid */}
                  {concept.keyFormulas && concept.keyFormulas.length > 0 && (
                    <div className="space-y-2 pt-2">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-ink-muted)] flex items-center gap-1.5">
                        <Sparkles className="w-3.5 h-3.5 text-[var(--accent-terracotta)]" />
                        Mathematical Formulas & Notation
                      </span>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        {concept.keyFormulas.map((f, fIdx) => (
                          <div key={fIdx} className="p-3 rounded-lg border border-[var(--border-paper)] bg-[var(--bg-surface-warm)] space-y-1">
                            <span className="text-[11px] font-bold text-[var(--text-ink)] block">
                              {f.label}
                            </span>
                            <div className="p-2 rounded bg-[var(--bg-surface)] border border-[var(--border-paper)] font-mono text-xs text-[var(--accent-terracotta)] font-bold overflow-x-auto">
                              <MathRenderer content={f.formula} />
                            </div>
                            {f.description && (
                              <p className="text-[10px] text-[var(--text-ink-secondary)]">
                                {f.description}
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Step-by-Step Derivations */}
                  {concept.derivations && concept.derivations.length > 0 && (
                    <div className="space-y-2 pt-2">
                      {concept.derivations.map((d, dIdx) => {
                        const isExpanded = expandedDerivations[`${concept.id}-${dIdx}`] ?? true;
                        return (
                          <div key={dIdx} className="rounded-xl border border-[var(--border-paper)] overflow-hidden">
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedDerivations((prev) => ({
                                  ...prev,
                                  [`${concept.id}-${dIdx}`]: !isExpanded,
                                }))
                              }
                              className="w-full p-3 bg-[var(--bg-surface-warm)] text-left flex items-center justify-between gap-2 text-xs font-semibold text-[var(--text-ink)] cursor-pointer"
                            >
                              <span className="flex items-center gap-1.5">
                                <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-[var(--accent-terracotta-subtle)] text-[var(--accent-terracotta)] font-bold">
                                  DERIVATION
                                </span>
                                {d.title}
                              </span>
                              {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                            </button>

                            {isExpanded && (
                              <div className="p-4 space-y-3 bg-[var(--bg-surface)] border-t border-[var(--border-paper)] text-xs">
                                <div className="text-[11px] text-[var(--text-ink-muted)]">
                                  <span className="font-semibold text-[var(--text-ink)]">Starting Principle:</span> {d.startingPoint}
                                </div>
                                <div className="space-y-2">
                                  {d.steps.map((st) => (
                                    <div key={st.stepNumber} className="flex items-start gap-2.5 p-2 rounded bg-[var(--bg-surface-warm)]">
                                      <span className="w-5 h-5 rounded-full bg-[var(--accent-terracotta)] text-white text-[10px] font-bold flex items-center justify-center shrink-0">
                                        {st.stepNumber}
                                      </span>
                                      <div className="space-y-1">
                                        <p className="text-xs text-[var(--text-ink)]">{st.text}</p>
                                        {st.math && (
                                          <div className="font-mono text-xs text-[var(--accent-terracotta)] font-semibold p-1.5 rounded bg-[var(--bg-surface)] border border-[var(--border-paper)]">
                                            {st.math}
                                          </div>
                                        )}
                                        {st.note && (
                                          <p className="text-[10px] text-[var(--text-ink-muted)] italic">{st.note}</p>
                                        )}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                                <div className="p-2.5 rounded bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800 text-[11px] text-emerald-800 dark:text-emerald-300">
                                  <span className="font-bold">Result:</span> {d.conclusion}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Solved Examples */}
                  {concept.solvedExamples && concept.solvedExamples.length > 0 && (
                    <div className="space-y-2 pt-2">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-ink-muted)] block">
                        Solved JEE Main Examples
                      </span>
                      {concept.solvedExamples.map((ex) => (
                        <div key={ex.id} className="p-4 rounded-xl border border-[var(--border-paper)] bg-[var(--bg-surface-warm)] space-y-2.5 text-xs">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-bold text-[var(--text-ink)]">{ex.title}</span>
                            <CapsuleBadge
                              label={ex.difficulty.toUpperCase()}
                              variant={ex.difficulty === 'hard' ? 'danger' : ex.difficulty === 'medium' ? 'accent' : 'subtle'}
                              size="sm"
                            />
                          </div>
                          <p className="text-xs text-[var(--text-ink)] leading-relaxed italic bg-[var(--bg-surface)] p-2.5 rounded border border-[var(--border-paper)]">
                            {ex.problemStatement}
                          </p>
                          <div className="text-[11px] text-[var(--text-ink-secondary)]">
                            <span className="font-bold text-[var(--accent-terracotta)]">Approach: </span>
                            {ex.approach}
                          </div>
                          <div className="space-y-1">
                            {ex.solutionSteps.map((step, sIdx) => (
                              <div key={sIdx} className="text-[11px] text-[var(--text-ink)] font-mono flex items-start gap-1.5">
                                <span className="text-[var(--accent-terracotta)]">•</span>
                                <span>{step}</span>
                              </div>
                            ))}
                          </div>
                          <div className="p-2 rounded bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800 font-semibold text-emerald-800 dark:text-emerald-300 text-xs">
                            Answer: {ex.finalAnswer}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Common Mistakes & Misconceptions */}
                  {concept.commonMistakes && concept.commonMistakes.length > 0 && (
                    <div className="p-4 rounded-xl border border-amber-200 dark:border-amber-900/40 bg-amber-50/60 dark:bg-amber-950/20 space-y-2 text-xs">
                      <div className="flex items-center gap-1.5 font-bold text-amber-900 dark:text-amber-300">
                        <AlertTriangle className="w-4 h-4 text-amber-600" />
                        <span>Common Traps & Exam Misconceptions</span>
                      </div>
                      <div className="space-y-2">
                        {concept.commonMistakes.map((m, mIdx) => (
                          <div key={mIdx} className="space-y-0.5">
                            <div className="text-amber-900 dark:text-amber-200 font-semibold">
                              ❌ Mistake: {m.mistake}
                            </div>
                            <div className="text-emerald-800 dark:text-emerald-300">
                              ✓ Correction: {m.correction}
                            </div>
                            <div className="text-[10px] text-amber-800/80 dark:text-amber-400 italic">
                              Why: {m.why}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}

              {/* Complete Theory Action Card */}
              <div className="paper-card p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-2 border-[var(--accent-terracotta)]/40 bg-[var(--accent-terracotta-subtle)]/30">
                <div className="space-y-1">
                  <h4 className="paper-title text-base text-[var(--text-ink)]">
                    Ready to Test Your Conceptual Understanding?
                  </h4>
                  <p className="text-xs text-[var(--text-ink-secondary)]">
                    Marking theory complete saves your reading progress and unlocks the {quizQuestions.length}-question practice quiz.
                  </p>
                </div>
                <CapsuleButton
                  variant="accent"
                  size="md"
                  onClick={handleMarkTheoryCompleted}
                  className="shrink-0"
                >
                  <span className="flex items-center gap-2">
                    <Check className="w-4 h-4" />
                    <span>{isTheoryCompleted ? 'Proceed to Quiz' : 'Mark Theory Complete & Start Quiz'}</span>
                  </span>
                </CapsuleButton>
              </div>
            </div>
          )}

          {/* TAB 2: THEORY-BASED PRACTICE QUIZ */}
          {activeTab === 'quiz' && (
            <div className="space-y-6">
              {/* Quiz Instructions & Marking Scheme */}
              <div className="paper-card p-4 flex flex-wrap items-center justify-between gap-3 text-xs bg-[var(--bg-surface-warm)]">
                <div className="flex items-center gap-3">
                  <span className="font-bold text-[var(--text-ink)]">JEE Main Marking:</span>
                  <span className="text-emerald-600 font-semibold">+4 Correct</span>
                  <span className="text-red-600 font-semibold">-1 Incorrect (Single Correct)</span>
                  <span className="text-[var(--text-ink-muted)]">0 Unanswered</span>
                </div>
                <div className="text-[var(--text-ink-muted)]">
                  Target: ≥ 60% accuracy to earn milestone progress
                </div>
              </div>

              {/* Quiz Grading Result Banner if submitted */}
              {gradingResult && (
                <div className={`paper-card p-6 space-y-4 border-2 ${
                  gradingResult.passed ? 'border-emerald-500 bg-emerald-50/40 dark:bg-emerald-950/20' : 'border-amber-500 bg-amber-50/40 dark:bg-amber-950/20'
                }`}>
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        {gradingResult.passed ? (
                          <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                        ) : (
                          <AlertTriangle className="w-5 h-5 text-amber-600" />
                        )}
                        <h3 className="paper-title text-xl text-[var(--text-ink)]">
                          {gradingResult.passed ? 'Milestone Quiz Passed!' : 'Reinforcement Recommended'}
                        </h3>
                      </div>
                      <p className="text-xs text-[var(--text-ink-secondary)]">
                        {gradingResult.passed
                          ? 'Great job! Your demonstration of conceptual accuracy has met the milestone criteria.'
                          : 'Review the explanations below and re-attempt the quiz to reinforce your understanding.'}
                      </p>
                    </div>

                    <div className="flex items-center gap-4 text-center">
                      <div className="p-2.5 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-paper)] min-w-[80px]">
                        <span className="text-[10px] uppercase text-[var(--text-ink-muted)] font-bold block">Score</span>
                        <span className="text-base font-bold text-[var(--text-ink)]">
                          {gradingResult.rawMarks} / {gradingResult.maxMarks}
                        </span>
                      </div>
                      <div className="p-2.5 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-paper)] min-w-[80px]">
                        <span className="text-[10px] uppercase text-[var(--text-ink-muted)] font-bold block">Accuracy</span>
                        <span className={`text-base font-bold ${gradingResult.passed ? 'text-emerald-600' : 'text-amber-600'}`}>
                          {gradingResult.scorePercentage}%
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="pt-2 flex items-center gap-3">
                    <CapsuleButton variant="subtle" size="sm" onClick={handleRetryQuiz}>
                      <span className="flex items-center gap-1.5">
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>Re-attempt Quiz</span>
                      </span>
                    </CapsuleButton>
                    <CapsuleButton variant="accent" size="sm" onClick={() => setActiveTab('theory')}>
                      <span>Review Theory Notes</span>
                    </CapsuleButton>
                  </div>
                </div>
              )}

              {/* Questions List */}
              <div className="space-y-5">
                {quizQuestions.map((q, qIdx) => {
                  const studentAns = studentAnswers[q.id];
                  const outcome = gradingResult?.outcomes[q.id];

                  return (
                    <div
                      key={q.id}
                      className={`paper-card p-5 space-y-3.5 transition-all ${
                        outcome
                          ? outcome.isCorrect
                            ? 'border-emerald-300 dark:border-emerald-800'
                            : 'border-red-300 dark:border-red-800'
                          : 'border-[var(--border-paper)]'
                      }`}
                    >
                      {/* Question Header */}
                      <div className="flex items-center justify-between gap-2 border-b border-[var(--border-paper)] pb-2 text-xs">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-[var(--accent-terracotta)]">
                            Q{qIdx + 1}
                          </span>
                          <span className="text-[var(--text-ink-muted)] uppercase tracking-wider text-[10px]">
                            {q.type === 'single_correct' ? 'Single Choice (+4 / -1)' : 'Numerical Answer (+4 / 0)'}
                          </span>
                        </div>
                        {outcome && (
                          <span className={`font-semibold text-xs flex items-center gap-1 ${outcome.isCorrect ? 'text-emerald-600' : 'text-red-600'}`}>
                            {outcome.isCorrect ? <CheckCircle2 className="w-3.5 h-3.5" /> : <X className="w-3.5 h-3.5" />}
                            {outcome.isCorrect ? '+4 Marks' : q.type === 'single_correct' ? '-1 Mark' : '0 Marks'}
                          </span>
                        )}
                      </div>

                      {/* Question Stem */}
                      <div className="text-xs sm:text-sm text-[var(--text-ink)] leading-relaxed font-serif-editorial">
                        <MathRenderer content={q.stem} />
                      </div>

                      {/* Single Correct Options */}
                      {q.type === 'single_correct' && q.options && (
                        <div className="space-y-2 pt-1">
                          {q.options.map((opt, optIdx) => {
                            const isSelected = studentAns?.selectedOption === optIdx;
                            const isCorrectOpt = q.correctOptionIndex === optIdx;

                            let optStyle = 'border-[var(--border-paper)] bg-[var(--bg-surface)] hover:border-[var(--border-paper-strong)] text-[var(--text-ink)]';
                            if (gradingResult) {
                              if (isCorrectOpt) {
                                optStyle = 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-900 dark:text-emerald-200 font-semibold';
                              } else if (isSelected && !isCorrectOpt) {
                                optStyle = 'border-red-500 bg-red-50 dark:bg-red-950/30 text-red-900 dark:text-red-200 line-through';
                              }
                            } else if (isSelected) {
                              optStyle = 'border-[var(--accent-terracotta)] bg-[var(--accent-terracotta-subtle)] text-[var(--accent-terracotta)] font-semibold shadow-xs';
                            }

                            return (
                              <button
                                key={optIdx}
                                type="button"
                                disabled={Boolean(gradingResult)}
                                onClick={() => handleSelectOption(q.id, optIdx)}
                                className={`w-full p-3 rounded-xl border text-left text-xs transition-all flex items-start gap-3 cursor-pointer ${optStyle}`}
                              >
                                <span className="w-5 h-5 rounded-full border border-current flex items-center justify-center shrink-0 font-bold text-[10px]">
                                  {String.fromCharCode(65 + optIdx)}
                                </span>
                                <span className="flex-1 font-mono text-xs"><MathRenderer content={opt} /></span>
                              </button>
                            );
                          })}
                        </div>
                      )}

                      {/* Numerical Answer Input */}
                      {q.type === 'numerical' && (
                        <div className="pt-1 space-y-1.5 max-w-xs">
                          <label className="text-[11px] font-semibold text-[var(--text-ink-muted)] block">
                            Enter Numerical Value:
                          </label>
                          <input
                            type="text"
                            disabled={Boolean(gradingResult)}
                            value={studentAns?.numericalInput || ''}
                            onChange={(e) => handleNumericalInput(q.id, e.target.value)}
                            placeholder="e.g. 240 or -1"
                            className="w-full px-3 py-2 text-xs paper-input font-mono"
                          />
                        </div>
                      )}

                      {/* Explanation & Formula Reference after grading */}
                      {outcome && (
                        <div className="mt-3 p-3.5 rounded-xl border border-[var(--border-paper)] bg-[var(--bg-surface-warm)] space-y-2 text-xs animate-in fade-in">
                          <div className="flex items-center gap-1.5 font-bold text-[var(--accent-terracotta)]">
                            <Lightbulb className="w-4 h-4" />
                            <span>Detailed Answer Explanation:</span>
                          </div>
                          <div className="text-[var(--text-ink)] leading-relaxed whitespace-pre-line font-serif-editorial">
                            <MathRenderer content={outcome.explanation} />
                          </div>
                          {outcome.formulaReference && (
                            <div className="p-2 rounded bg-[var(--bg-surface)] border border-[var(--border-paper)] font-mono text-xs text-[var(--accent-terracotta)] font-semibold">
                              Formula Reference: <MathRenderer content={outcome.formulaReference} />
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Submit Quiz Action Bar */}
              {!gradingResult && (
                <div className="paper-card p-4 flex items-center justify-between border-t border-[var(--border-paper)]">
                  <span className="text-xs text-[var(--text-ink-muted)]">
                    {Object.values(studentAnswers).filter((a) => a.selectedOption !== undefined || a.numericalInput).length} of {quizQuestions.length} answered
                  </span>
                  <CapsuleButton variant="accent" size="md" onClick={handleSubmitQuiz}>
                    Submit Quiz & See Explanations
                  </CapsuleButton>
                </div>
              )}
            </div>
          )}

          {/* TAB 3: MILESTONE PROGRESS */}
          {activeTab === 'progress' && (
            <div className="paper-card p-6 space-y-6">
              <div>
                <h3 className="paper-title text-xl text-[var(--text-ink)]">
                  Checkpoint Completion Requirements
                </h3>
                <p className="text-xs text-[var(--text-ink-secondary)] mt-1">
                  A milestone is marked completed only when both structured learning requirements are met.
                </p>
              </div>

              <div className="space-y-4">
                {/* Requirement 1: Theory */}
                <div className="p-4 rounded-xl border border-[var(--border-paper)] bg-[var(--bg-surface-warm)] flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className={`w-9 h-9 rounded-full flex items-center justify-center ${isTheoryCompleted ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                      {isTheoryCompleted ? <CheckCircle2 className="w-5 h-5" /> : <Clock className="w-5 h-5" />}
                    </div>
                    <div>
                      <span className="text-xs font-bold text-[var(--text-ink)] block">1. Read Structured Theory Module</span>
                      <span className="text-[11px] text-[var(--text-ink-muted)]">
                        Covers formulas, derivations, diagrams, and common traps.
                      </span>
                    </div>
                  </div>
                  <CapsuleBadge
                    label={isTheoryCompleted ? 'Completed' : 'Pending'}
                    variant={isTheoryCompleted ? 'success' : 'neutral'}
                    size="sm"
                  />
                </div>

                {/* Requirement 2: Quiz */}
                <div className="p-4 rounded-xl border border-[var(--border-paper)] bg-[var(--bg-surface-warm)] flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className={`w-9 h-9 rounded-full flex items-center justify-center ${hasPassedQuiz ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                      {hasPassedQuiz ? <CheckCircle2 className="w-5 h-5" /> : <Sparkles className="w-5 h-5" />}
                    </div>
                    <div>
                      <span className="text-xs font-bold text-[var(--text-ink)] block">2. Pass Theory Quiz (≥ 60% Accuracy)</span>
                      <span className="text-[11px] text-[var(--text-ink-muted)]">
                        Demonstrates concept mastery on JEE Main questions.
                      </span>
                    </div>
                  </div>
                  <CapsuleBadge
                    label={hasPassedQuiz ? `${progress?.masteryScore}% (Passed)` : 'Not Passed'}
                    variant={hasPassedQuiz ? 'success' : 'neutral'}
                    size="sm"
                  />
                </div>
              </div>

              {/* Status Summary Box */}
              <div className="p-4 rounded-xl border border-[var(--border-paper)] bg-[var(--bg-surface)] space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-[var(--text-ink)]">Current Milestone Status:</span>
                  <span className="font-bold uppercase tracking-wider text-[var(--accent-terracotta)]">
                    {progress?.status || 'In Progress'}
                  </span>
                </div>
                <div className="flex items-center justify-between text-[11px] text-[var(--text-ink-muted)]">
                  <span>Total Quiz Attempts:</span>
                  <span>{progress?.historicalAttemptsCount || 0}</span>
                </div>
                {progress?.lastActivityAt && (
                  <div className="flex items-center justify-between text-[11px] text-[var(--text-ink-muted)]">
                    <span>Last Recorded Activity:</span>
                    <span>{new Date(progress.lastActivityAt).toLocaleString()}</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* SIDEBAR DOSSIER (Right 4 cols) */}
        <div className="lg:col-span-4 space-y-6">
          
          {/* Quick Formula Cheat Sheet Card */}
          <div className="paper-card p-5 space-y-3">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[var(--text-ink)] border-b border-[var(--border-paper)] pb-2">
              <Sparkles className="w-4 h-4 text-[var(--accent-terracotta)]" />
              <span>Quick Formula Cheat Sheet</span>
            </div>
            <div className="space-y-2 text-xs">
              {theoryModule.concepts.flatMap((c) => c.keyFormulas || []).slice(0, 6).map((f, i) => (
                <div key={i} className="p-2.5 rounded-lg border border-[var(--border-paper)] bg-[var(--bg-surface-warm)] space-y-1">
                  <span className="text-[11px] font-bold text-[var(--text-ink)] block">{f.label}</span>
                  <div className="p-1.5 rounded bg-[var(--bg-surface)] font-mono text-[11px] text-[var(--accent-terracotta)] font-bold overflow-x-auto">
                    <MathRenderer content={f.formula} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Key Takeaways Card */}
          <div className="paper-card p-5 space-y-3">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[var(--text-ink)] border-b border-[var(--border-paper)] pb-2">
              <Award className="w-4 h-4 text-[var(--accent-terracotta)]" />
              <span>Core Takeaways</span>
            </div>
            <ul className="space-y-2 text-xs text-[var(--text-ink-secondary)]">
              {theoryModule.keyTakeaways.map((point, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="text-[var(--accent-terracotta)] font-bold mt-0.5">•</span>
                  <span>{point}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Syllabus Chapters Covered */}
          <div className="paper-card p-5 space-y-3">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[var(--text-ink)] border-b border-[var(--border-paper)] pb-2">
              <Layers className="w-4 h-4 text-[var(--accent-terracotta)]" />
              <span>NTA Syllabus Mapping</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {checkpoint.officialChapterIds.map((ch, i) => (
                <span
                  key={i}
                  className="px-2 py-1 rounded-md border border-[var(--border-paper)] bg-[var(--bg-surface-warm)] text-[11px] text-[var(--text-ink)] font-mono"
                >
                  {ch}
                </span>
              ))}
            </div>
          </div>
        </div>

      </div>
    </div>
  );
};
