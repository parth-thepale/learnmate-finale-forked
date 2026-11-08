import React from 'react';
import {
  CheckCircle2,
  XCircle,
  HelpCircle,
  Clock,
  ArrowRight,
  RotateCcw,
  Sparkles,
  Calendar,
  AlertTriangle,
  Award,
} from 'lucide-react';
import type { Checkpoint } from '../types/checkpoint.types';
import type {
  AssessmentAttemptResult,
  CheckpointProgress,
  RevisionItem,
} from '../types/progress.types';
import { CapsuleBadge, CapsuleButton, CapsuleProgressPill } from '../../../components/capsule';

interface PerformanceAnalysisViewProps {
  checkpoint: Checkpoint;
  assessmentResult: AssessmentAttemptResult;
  progress?: CheckpointProgress;
  scheduledRevisions?: RevisionItem[];
  onRetry: () => void;
  onAdvance: () => void;
  onClose: () => void;
}

export const PerformanceAnalysisView: React.FC<PerformanceAnalysisViewProps> = ({
  checkpoint,
  assessmentResult,
  progress,
  scheduledRevisions = [],
  onRetry,
  onAdvance,
  onClose,
}) => {
  const isInternal =
    assessmentResult.isInternalValidation === true ||
    assessmentResult.mode === 'internal_validation';

  const pct = assessmentResult.percentage;
  const isStrong = !isInternal && pct >= 80;
  const isDeveloping = !isInternal && pct >= 60 && pct < 80;
  const isNeedsReinforcement = !isInternal && pct < 60;

  const minutes = Math.floor(assessmentResult.timeTakenSeconds / 60);
  const seconds = assessmentResult.timeTakenSeconds % 60;
  const timeFormatted = `${minutes}m ${seconds}s`;

  return (
    <div className="paper-card p-6 space-y-6">
      {/* Internal Validation Mode Banner */}
      {isInternal && (
        <div className="p-4 rounded-xl border border-amber-300 dark:border-amber-700/60 bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200 text-xs flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <span className="font-semibold block text-sm">
              Internal Test Only — No Learner Mastery Awarded
            </span>
            <p className="text-xs opacity-90 leading-relaxed">
              This preview attempt was conducted in internal validation mode with unverified content.
              Raw scores and errors are presented for SME inspection only. No milestone mastery has been awarded,
              downstream checkpoints remain locked, and no official spaced revisions have been scheduled.
            </p>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="border-b border-[var(--border-paper)] pb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <span className="text-[11px] font-mono uppercase tracking-wider text-[var(--accent-terracotta)] font-semibold">
            Stage F — Performance Analysis & Revision Scheduling
          </span>
          <h2 className="paper-title text-xl text-[var(--text-ink)] mt-0.5">
            {checkpoint.title}: Assessment Evaluation
          </h2>
          <p className="text-xs text-[var(--text-ink-secondary)] mt-0.5">
            {isInternal
              ? 'Diagnostic preview of internal validation test submission.'
              : 'Detailed diagnosis of your attempt, subtopic breakdown, and automated spaced revision schedule.'}
          </p>
        </div>

        <CapsuleBadge
          label={
            isInternal
              ? 'Internal Test Only'
              : isStrong
              ? 'Strong Mastery'
              : isDeveloping
              ? 'Developing Mastery'
              : 'Needs Reinforcement'
          }
          variant={isInternal ? 'subtle' : isStrong ? 'success' : isDeveloping ? 'accent' : 'danger'}
          size="md"
        />
      </div>

      {/* Top Stat Cards Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {/* Score Card */}
        <div className="p-4 rounded-xl border border-[var(--border-paper)] bg-[var(--bg-surface-warm)]">
          <span className="text-[11px] font-medium text-[var(--text-ink-muted)] block">Raw Score</span>
          <div className="text-2xl font-bold font-serif-editorial text-[var(--text-ink)] mt-1">
            {assessmentResult.rawMarks}
            <span className="text-xs font-normal text-[var(--text-ink-muted)]">/{assessmentResult.totalMarks}</span>
          </div>
          <span className="text-[11px] text-[var(--accent-terracotta)] font-medium">{pct}% Accuracy</span>
        </div>

        {/* Breakdown Card */}
        <div className="p-4 rounded-xl border border-[var(--border-paper)] bg-[var(--bg-surface-warm)]">
          <span className="text-[11px] font-medium text-[var(--text-ink-muted)] block">Outcomes</span>
          <div className="flex items-center gap-2 mt-1 text-xs">
            <span className="text-emerald-600 dark:text-emerald-400 font-bold">{assessmentResult.correctCount} Correct</span>
            <span>•</span>
            <span className="text-red-600 dark:text-red-400 font-bold">{assessmentResult.incorrectCount} Wrong</span>
          </div>
          <span className="text-[11px] text-[var(--text-ink-muted)] block mt-0.5">{assessmentResult.unansweredCount} Unanswered</span>
        </div>

        {/* Time Card */}
        <div className="p-4 rounded-xl border border-[var(--border-paper)] bg-[var(--bg-surface-warm)]">
          <span className="text-[11px] font-medium text-[var(--text-ink-muted)] block">Time Spent</span>
          <div className="text-lg font-bold text-[var(--text-ink)] mt-1 flex items-center gap-1.5">
            <Clock className="w-4 h-4 text-[var(--accent-terracotta)]" />
            <span>{timeFormatted}</span>
          </div>
          <span className="text-[11px] text-[var(--text-ink-muted)]">Pacing within target</span>
        </div>

        {/* Milestone Status */}
        <div className="p-4 rounded-xl border border-[var(--border-paper)] bg-[var(--bg-surface-warm)]">
          <span className="text-[11px] font-medium text-[var(--text-ink-muted)] block">Milestone Outcome</span>
          <div className="text-sm font-bold text-[var(--text-ink)] mt-1">
            {isInternal
              ? 'No Mastery Awarded'
              : isStrong
              ? 'Unlocked Next'
              : isDeveloping
              ? 'Passed with Revision'
              : 'Requires Review'}
          </div>
          <span className="text-[11px] text-[var(--text-ink-muted)]">
            {isInternal
              ? 'Internal preview attempt; does not affect learner progression'
              : isStrong || isDeveloping
              ? 'Prerequisites Met'
              : 'Retry available'}
          </span>
        </div>
      </div>

      {/* Subtopic Diagnosis */}
      <div className="space-y-3">
        <h3 className="paper-title text-base text-[var(--text-ink)] flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-[var(--accent-terracotta)]" />
          Subtopic Mastery Analysis
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* Strong Subtopics */}
          <div className="p-4 rounded-xl border border-emerald-200 dark:border-emerald-900/40 bg-emerald-50/40 dark:bg-emerald-950/20 space-y-2">
            <span className="text-xs font-semibold text-emerald-800 dark:text-emerald-300 flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              Demonstrated Strong Understanding ({assessmentResult.strongTopics.length})
            </span>
            {assessmentResult.strongTopics.length > 0 ? (
              <ul className="space-y-1 text-xs text-emerald-900 dark:text-emerald-200">
                {assessmentResult.strongTopics.map((topic, i) => (
                  <li key={i} className="truncate">• {topic}</li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-[var(--text-ink-muted)]">None demonstrated on this attempt.</p>
            )}
          </div>

          {/* Weak Subtopics */}
          <div className="p-4 rounded-xl border border-red-200 dark:border-red-900/40 bg-red-50/40 dark:bg-red-950/20 space-y-2">
            <span className="text-xs font-semibold text-red-800 dark:text-red-300 flex items-center gap-1.5">
              <AlertTriangle className="w-4 h-4 text-red-600 dark:text-red-400" />
              Weak Subtopics Needing Spaced Revision ({assessmentResult.weakTopics.length})
            </span>
            {assessmentResult.weakTopics.length > 0 ? (
              <ul className="space-y-1 text-xs text-red-900 dark:text-red-200">
                {assessmentResult.weakTopics.map((topic, i) => (
                  <li key={i} className="truncate">• {topic}</li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-[var(--text-ink-muted)]">Zero errors! Flawless conceptual execution.</p>
            )}
          </div>
        </div>
      </div>

      {/* Scheduled Spaced Revisions */}
      {!isInternal && scheduledRevisions.length > 0 && (
        <div className="p-4 rounded-xl border border-[var(--border-paper)] bg-[var(--bg-surface)] space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-ink-muted)] flex items-center gap-1.5">
              <Calendar className="w-4 h-4 text-[var(--accent-terracotta)]" />
              Automated Spaced Revision Queue
            </h4>
            <span className="text-[11px] text-[var(--text-ink-muted)]">Fixed-Interval Spaced Repetition</span>
          </div>

          <div className="space-y-2">
            {scheduledRevisions.map((rev) => (
              <div
                key={rev.id}
                className="p-3 rounded-lg border border-[var(--border-paper)] bg-[var(--bg-surface-warm)] flex items-center justify-between text-xs"
              >
                <div>
                  <span className="font-semibold text-[var(--text-ink)]">{rev.topicName}</span>
                  <p className="text-[11px] text-[var(--text-ink-muted)] mt-0.5">{rev.reason}</p>
                </div>
                <div className="text-right">
                  <span className="font-mono text-[11px] font-semibold text-[var(--accent-terracotta)]">
                    Due: {rev.scheduledForDate}
                  </span>
                  <span className="block text-[10px] text-[var(--text-ink-muted)]">Step {rev.intervalStep + 1}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Footer Controls */}
      <div className="pt-4 border-t border-[var(--border-paper)] flex items-center justify-between">
        {isInternal ? (
          <>
            <span className="text-xs text-[var(--text-ink-muted)] font-medium">
              Internal preview attempt · Progression unchanged
            </span>
            <CapsuleButton variant="accent" size="md" onClick={onClose}>
              Return to Overview
            </CapsuleButton>
          </>
        ) : (
          <>
            <CapsuleButton variant="subtle" size="sm" onClick={onClose}>
              Done
            </CapsuleButton>

            <div className="flex items-center gap-2">
              {isNeedsReinforcement && (
                <CapsuleButton
                  variant="outline"
                  size="md"
                  icon={<RotateCcw className="w-4 h-4" />}
                  onClick={onRetry}
                >
                  Retry Assessment
                </CapsuleButton>
              )}

              <CapsuleButton
                variant="accent"
                size="md"
                rightIcon={<ArrowRight className="w-4 h-4" />}
                onClick={onAdvance}
              >
                {isStrong || isDeveloping ? 'Advance to Next Milestone' : 'Back to Revision'}
              </CapsuleButton>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
