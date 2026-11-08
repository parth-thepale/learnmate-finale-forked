import React, { useState, useEffect, useRef } from 'react';
import { Clock, ShieldCheck, CheckCircle2, AlertCircle, HelpCircle } from 'lucide-react';
import type { Checkpoint } from '../types/checkpoint.types';
import type { AssessmentAttemptResult } from '../types/progress.types';
import { CapsuleBadge, CapsuleButton } from '../../../components/capsule';
import {
  getVerifiedAssessmentQuestions,
  isInternalPreviewPermitted,
} from '../engine/contentGovernance';

interface AssessmentViewProps {
  checkpoint: Checkpoint;
  onAssessmentCompleted: (result: AssessmentAttemptResult) => void;
  onClose: () => void;
  mode?: 'learner' | 'internal_validation';
}

export const AssessmentView: React.FC<AssessmentViewProps> = ({
  checkpoint,
  onAssessmentCompleted,
  onClose,
  mode = 'learner',
}) => {
  // Fail closed: internal validation mode is strictly prohibited unless permitted by environment
  const isInternal = mode === 'internal_validation' && isInternalPreviewPermitted();
  const verifiedQuestions = getVerifiedAssessmentQuestions(checkpoint);
  const questions = isInternal
    ? (checkpoint.assessmentQuestions || [])
    : verifiedQuestions;

  const [selectedAnswers, setSelectedAnswers] = useState<Record<number, number>>({});
  const [numericalAnswers, setNumericalAnswers] = useState<Record<number, string>>({});
  const [timeRemaining, setTimeRemaining] = useState(questions.length * 120); // 2 min per question
  const [isSubmitting, setIsSubmitting] = useState(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (questions.length === 0) return;

    timerRef.current = setInterval(() => {
      setTimeRemaining((prev) => {
        if (prev <= 1) {
          if (timerRef.current) clearInterval(timerRef.current);
          handleAutoSubmit();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [questions.length]);

  const handleSelectOption = (qIdx: number, optIdx: number) => {
    setSelectedAnswers((prev) => ({
      ...prev,
      [qIdx]: prev[qIdx] === optIdx ? -1 : optIdx, // Toggle or unselect
    }));
  };

  const handleAutoSubmit = () => {
    handleSubmit();
  };

  const handleSubmit = () => {
    if (isSubmitting || questions.length === 0) return;
    if (mode === 'internal_validation' && !isInternalPreviewPermitted()) return;
    setIsSubmitting(true);
    if (timerRef.current) clearInterval(timerRef.current);

    let correctCount = 0;
    let incorrectCount = 0;
    let unansweredCount = 0;
    const weakTopics: string[] = [];
    const strongTopics: string[] = [];
    const conceptualErrors: string[] = [];

    questions.forEach((q, idx) => {
      const selected = selectedAnswers[idx];
      const topic = q.topicLabel || q.topicId;

      if (selected === undefined || selected === -1) {
        unansweredCount += 1;
      } else if (selected === q.correctOptionIndex) {
        correctCount += 1;
        if (!strongTopics.includes(topic)) strongTopics.push(topic);
      } else {
        incorrectCount += 1;
        if (!weakTopics.includes(topic)) weakTopics.push(topic);
        conceptualErrors.push(`${topic}: ${q.stem.slice(0, 60)}...`);
      }
    });

    const rawMarks = correctCount * 4 - incorrectCount * 1;
    const totalMarks = questions.length * 4;
    const percentage = totalMarks > 0 ? Math.max(0, Math.round((rawMarks / totalMarks) * 100)) : 0;
    const timeTakenSeconds = questions.length * 120 - timeRemaining;

    const result: AssessmentAttemptResult = {
      attemptId: `att-${checkpoint.id}-${Date.now().toString(36)}`,
      score: percentage,
      totalMarks,
      rawMarks,
      percentage,
      correctCount,
      incorrectCount,
      unansweredCount,
      timeTakenSeconds,
      completedAt: new Date().toISOString(),
      weakTopics,
      strongTopics,
      conceptualErrors,
      mode: isInternal ? 'internal_validation' : 'learner',
      isInternalValidation: isInternal,
    };

    onAssessmentCompleted(result);
  };

  const minutes = Math.floor(timeRemaining / 60);
  const seconds = timeRemaining % 60;
  const timeFormatted = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

  if (questions.length === 0) {
    return (
      <div className="paper-card p-8 space-y-4 text-center">
        <AlertCircle className="w-12 h-12 text-amber-500 mx-auto" />
        <h3 className="paper-title text-xl text-[var(--text-ink)]">
          Official Assessment Pending Verification
        </h3>
        <p className="text-xs text-[var(--text-ink-secondary)] max-w-md mx-auto leading-relaxed">
          Official assessment questions for <strong>{checkpoint.title}</strong> are undergoing formal review by the subject matter expert panel.
          Milestone mastery and downstream unlocking require authenticated, verified assessment items.
        </p>
        <div className="pt-2">
          <CapsuleButton variant="subtle" size="sm" onClick={onClose}>
            Back to Overview
          </CapsuleButton>
        </div>
      </div>
    );
  }

  const answeredCount = Object.values(selectedAnswers).filter((v) => v !== -1 && v !== undefined).length;

  return (
    <div className="paper-card p-6 space-y-6">
      {/* Internal Validation Warning Banner */}
      {isInternal && (
        <div className="p-3.5 rounded-xl border border-amber-500/40 bg-amber-500/10 text-amber-900 flex items-start gap-2.5">
          <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <div className="text-xs leading-relaxed">
            <span className="font-bold">INTERNAL VALIDATION PREVIEW:</span> Draft and pending-review content only. Attempts in this mode do not award milestone mastery, unlock downstream checkpoints, or schedule official spaced revisions.
          </div>
        </div>
      )}

      {/* Header with Countdown Timer & JEE Marking Badge */}
      <div className="border-b border-[var(--border-paper)] pb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <span className={`text-[11px] font-mono uppercase tracking-wider font-semibold ${isInternal ? 'text-amber-600' : 'text-[var(--accent-terracotta)]'}`}>
            {isInternal ? 'Internal Validation Preview — Stage E' : 'Stage E — Official Checkpoint Assessment'}
          </span>
          <h2 className="paper-title text-xl text-[var(--text-ink)] mt-0.5">
            {checkpoint.title} {isInternal ? 'Preview' : 'Assessment'}
          </h2>
          <div className="flex items-center gap-2 text-xs text-[var(--text-ink-muted)] mt-1">
            <span>JEE Main Marking (+4, -1, 0)</span>
            <span>•</span>
            <span>{questions.length} Questions</span>
            {isInternal && (
              <>
                <span>•</span>
                <span className="text-amber-700 font-medium">Internal Mode</span>
              </>
            )}
          </div>
        </div>

        {/* Live Timer Pill */}
        <div className="flex items-center gap-2 self-start sm:self-center px-4 py-2 rounded-xl bg-[var(--bg-surface-warm)] border border-[var(--border-paper)] font-mono text-sm font-semibold text-[var(--text-ink)]">
          <Clock className="w-4 h-4 text-[var(--accent-terracotta)]" />
          <span>{timeFormatted}</span>
        </div>
      </div>

      {/* Questions Form */}
      <div className="space-y-6">
        {questions.map((q, qIndex) => {
          const selected = selectedAnswers[qIndex];

          return (
            <div
              key={q.id}
              className="p-5 rounded-xl border border-[var(--border-paper)] bg-[var(--bg-surface)] space-y-3.5"
            >
              <div className="flex items-start justify-between gap-3">
                <span className="text-xs font-mono font-bold text-[var(--text-ink-muted)]">
                  Q{qIndex + 1}.
                </span>
                <p className="text-sm font-medium text-[var(--text-ink)] flex-1 leading-relaxed">
                  {q.stem}
                </p>
                <CapsuleBadge
                  label={q.difficulty.toUpperCase()}
                  variant={q.difficulty === 'hard' ? 'danger' : q.difficulty === 'medium' ? 'accent' : 'subtle'}
                  size="sm"
                />
              </div>

              {/* Options */}
              {q.options && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                  {q.options.map((opt, optIndex) => {
                    const isOptSelected = selected === optIndex;
                    return (
                      <button
                        key={optIndex}
                        type="button"
                        onClick={() => handleSelectOption(qIndex, optIndex)}
                        className={`text-left p-3.5 rounded-xl border text-xs transition-all cursor-pointer flex items-center justify-between gap-2 ${
                          isOptSelected
                            ? 'border-[var(--accent-terracotta)] bg-[var(--accent-terracotta-subtle)] text-[var(--accent-terracotta)] font-semibold shadow-xs ring-1 ring-[var(--accent-terracotta)]'
                            : 'border-[var(--border-paper)] bg-[var(--bg-surface)] hover:bg-[var(--bg-surface-warm)] text-[var(--text-ink)]'
                        }`}
                      >
                        <span>{opt}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer Submit */}
      <div className="pt-4 border-t border-[var(--border-paper)] flex items-center justify-between">
        <span className="text-xs text-[var(--text-ink-muted)]">
          {answeredCount} of {questions.length} answered
        </span>

        <CapsuleButton
          variant="accent"
          size="md"
          disabled={isSubmitting}
          onClick={handleSubmit}
        >
          Submit & Evaluate Assessment
        </CapsuleButton>
      </div>
    </div>
  );
};
