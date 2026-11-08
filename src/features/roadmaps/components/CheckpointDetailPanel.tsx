import React, { useState } from 'react';
import {
  X,
  Play,
  CheckCircle2,
  Lock,
  RotateCcw,
  Clock,
  Sparkles,
  BookOpen,
  HelpCircle,
  Award,
  Layers,
  ChevronRight,
} from 'lucide-react';
import type { Checkpoint, LearningStage } from '../types/checkpoint.types';
import type {
  AssessmentAttemptResult,
  CheckpointProgress,
  RevisionItem,
} from '../types/progress.types';
import { CapsuleBadge, CapsuleButton, CapsuleProgressPill } from '../../../components/capsule';
import { DiagnosticView } from './DiagnosticView';
import { RevisionView } from './RevisionView';
import { ActiveRecallView } from './ActiveRecallView';
import { PracticeView } from './PracticeView';
import { AssessmentView } from './AssessmentView';
import { PerformanceAnalysisView } from './PerformanceAnalysisView';
import {
  getVerifiedAssessmentQuestions,
  isInternalPreviewPermitted,
} from '../engine/contentGovernance';

interface CheckpointDetailPanelProps {
  checkpoint: Checkpoint;
  progress?: CheckpointProgress;
  onClose: () => void;
  onUpdateProgress: (updated: CheckpointProgress) => void;
  onRecordAssessment: (result: AssessmentAttemptResult) => { scheduledRevisions: RevisionItem[] };
}

export const CheckpointDetailPanel: React.FC<CheckpointDetailPanelProps> = ({
  checkpoint,
  progress,
  onClose,
  onUpdateProgress,
  onRecordAssessment,
}) => {
  const [activeStage, setActiveStage] = useState<LearningStage | 'overview'>('overview');
  const [assessmentMode, setAssessmentMode] = useState<'learner' | 'internal_validation'>('learner');
  const [lastAssessmentResult, setLastAssessmentResult] = useState<AssessmentAttemptResult | null>(
    progress?.assessmentResult ?? null
  );
  const [scheduledRevisions, setScheduledRevisions] = useState<RevisionItem[]>([]);

  // Stage A Complete
  const handleDiagnosticComplete = (
    diagnosticCleared: boolean,
    scorePct: number,
    weakTopics: string[]
  ) => {
    const updated: CheckpointProgress = {
      checkpointId: checkpoint.id,
      roadmapId: checkpoint.roadmapId,
      status: progress?.status === 'completed' ? 'completed' : 'current',
      currentStage: diagnosticCleared ? 'recall' : 'revision',
      diagnosticCleared,
      diagnosticScore: {
        correct: Math.round((scorePct / 100) * checkpoint.diagnosticQuestions.length),
        total: checkpoint.diagnosticQuestions.length,
        percentage: scorePct,
        completedAt: new Date().toISOString(),
      },
      revisionCompleted: progress?.revisionCompleted ?? false,
      masteryStatus: progress?.masteryStatus ?? 'unattempted',
      masteryScore: progress?.masteryScore ?? 0,
      lastActivityAt: new Date().toISOString(),
      historicalAttemptsCount: progress?.historicalAttemptsCount ?? 0,
    };
    onUpdateProgress(updated);
  };

  // Stage B Complete
  const handleRevisionComplete = () => {
    const updated: CheckpointProgress = {
      checkpointId: checkpoint.id,
      roadmapId: checkpoint.roadmapId,
      status: progress?.status === 'completed' ? 'completed' : 'current',
      currentStage: 'recall',
      diagnosticCleared: progress?.diagnosticCleared ?? false,
      diagnosticScore: progress?.diagnosticScore,
      revisionCompleted: true,
      masteryStatus: progress?.masteryStatus ?? 'unattempted',
      masteryScore: progress?.masteryScore ?? 0,
      lastActivityAt: new Date().toISOString(),
      historicalAttemptsCount: progress?.historicalAttemptsCount ?? 0,
    };
    onUpdateProgress(updated);
  };

  // Stage C Complete
  const handleRecallComplete = (correct: number, total: number, weakTopics: string[]) => {
    const pct = total > 0 ? Math.round((correct / total) * 100) : 0;
    const updated: CheckpointProgress = {
      checkpointId: checkpoint.id,
      roadmapId: checkpoint.roadmapId,
      status: progress?.status === 'completed' ? 'completed' : 'current',
      currentStage: 'practice',
      diagnosticCleared: progress?.diagnosticCleared ?? false,
      diagnosticScore: progress?.diagnosticScore,
      revisionCompleted: progress?.revisionCompleted ?? true,
      activeRecallScore: {
        correct,
        total,
        percentage: pct,
        completedAt: new Date().toISOString(),
      },
      masteryStatus: progress?.masteryStatus ?? 'unattempted',
      masteryScore: progress?.masteryScore ?? 0,
      lastActivityAt: new Date().toISOString(),
      historicalAttemptsCount: progress?.historicalAttemptsCount ?? 0,
    };
    onUpdateProgress(updated);
  };

  // Stage E Complete
  const handleAssessmentComplete = (result: AssessmentAttemptResult) => {
    setLastAssessmentResult(result);
    const outcomes = onRecordAssessment(result);
    setScheduledRevisions(outcomes.scheduledRevisions);
    setActiveStage('analysis');
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/40 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6 animate-in fade-in duration-150">
      <div className="relative w-full max-w-4xl bg-[var(--bg-surface)] border border-[var(--border-paper)] rounded-2xl shadow-xl overflow-hidden max-h-[92vh] flex flex-col">
        {/* Top Sticky Header */}
        <div className="p-4 sm:px-6 sm:py-4 border-b border-[var(--border-paper)] bg-[var(--bg-surface)] flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs font-bold px-2 py-0.5 rounded border border-[var(--border-paper)] bg-[var(--bg-surface-warm)] text-[var(--text-ink)]">
              {checkpoint.id}
            </span>
            <span className="text-xs text-[var(--text-ink-secondary)] truncate font-medium">
              {checkpoint.title}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {activeStage !== 'overview' && (
              <CapsuleButton
                variant="subtle"
                size="sm"
                onClick={() => setActiveStage('overview')}
              >
                Overview
              </CapsuleButton>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-full hover:bg-[var(--bg-surface-warm)] text-[var(--text-ink-secondary)] hover:text-[var(--text-ink)] transition-colors cursor-pointer"
              aria-label="Close dialog"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="overflow-y-auto p-4 sm:p-6 flex-1">
          {activeStage === 'diagnostic' && (
            <DiagnosticView
              checkpoint={checkpoint}
              progress={progress}
              onDiagnosticComplete={handleDiagnosticComplete}
              onClose={() => setActiveStage('overview')}
            />
          )}

          {activeStage === 'revision' && (
            <RevisionView
              checkpoint={checkpoint}
              progress={progress}
              onRevisionComplete={handleRevisionComplete}
              onClose={() => setActiveStage('overview')}
            />
          )}

          {activeStage === 'recall' && (
            <ActiveRecallView
              checkpoint={checkpoint}
              progress={progress}
              onRecallComplete={handleRecallComplete}
              onClose={() => setActiveStage('overview')}
            />
          )}

          {activeStage === 'practice' && (
            <PracticeView
              checkpoint={checkpoint}
              progress={progress}
              onPracticeRecorded={(att, corr, tier) => {}}
              onClose={() => setActiveStage('overview')}
            />
          )}

          {activeStage === 'assessment' && (
            <AssessmentView
              checkpoint={checkpoint}
              mode={assessmentMode}
              onAssessmentCompleted={handleAssessmentComplete}
              onClose={() => setActiveStage('overview')}
            />
          )}

          {activeStage === 'analysis' && lastAssessmentResult && (
            <PerformanceAnalysisView
              checkpoint={checkpoint}
              assessmentResult={lastAssessmentResult}
              progress={progress}
              scheduledRevisions={scheduledRevisions}
              onRetry={() => setActiveStage('assessment')}
              onAdvance={() => {
                setActiveStage('overview');
                onClose();
              }}
              onClose={() => setActiveStage('overview')}
            />
          )}

          {activeStage === 'overview' && (
            <div className="space-y-6">
              {/* Checkpoint Title & Summary */}
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[11px] font-mono uppercase tracking-wider text-[var(--accent-terracotta)] font-semibold">
                    Milestone 0{checkpoint.order} · {checkpoint.roadmapId}
                  </span>
                  <CapsuleBadge
                    label={
                      progress?.masteryStatus === 'strong'
                        ? 'Mastered'
                        : progress?.masteryStatus === 'developing'
                        ? 'Developing'
                        : progress?.masteryStatus === 'needs_reinforcement'
                        ? 'Needs Practice'
                        : progress?.masteryStatus === 'insufficient_evidence'
                        ? 'Evidence Incomplete'
                        : 'Available'
                    }
                    variant={
                      progress?.masteryStatus === 'strong'
                        ? 'success'
                        : progress?.masteryStatus === 'developing'
                        ? 'accent'
                        : progress?.masteryStatus === 'needs_reinforcement'
                        ? 'danger'
                        : 'subtle'
                    }
                    size="sm"
                  />
                </div>
                <h1 className="paper-title text-2xl text-[var(--text-ink)]">
                  {checkpoint.title}
                </h1>
                <p className="text-sm text-[var(--text-ink-secondary)] mt-1.5 leading-relaxed">
                  {checkpoint.description}
                </p>
              </div>

              {/* Progress & Workload Summary Banner */}
              <div className="p-4 rounded-xl border border-[var(--border-paper)] bg-[var(--bg-surface-warm)] flex flex-wrap items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-4">
                  <span className="inline-flex items-center gap-1.5 text-[var(--text-ink)]">
                    <Clock className="w-4 h-4 text-[var(--accent-terracotta)]" />
                    ~{checkpoint.estimatedWorkloadMinutes} min total workload
                  </span>
                  <span className="inline-flex items-center gap-1.5 text-[var(--text-ink)]">
                    <Layers className="w-4 h-4 text-[var(--accent-terracotta)]" />
                    {checkpoint.topicIds.length} syllabus subtopics
                  </span>
                </div>

                {progress?.masteryScore !== undefined && progress.masteryScore > 0 && (
                  <div className="w-48">
                    <CapsuleProgressPill
                      value={progress.masteryScore}
                      label={`${progress.masteryScore}% Demonstrated Score`}
                      variant={progress.masteryScore >= 80 ? 'success' : 'accent'}
                      size="sm"
                    />
                  </div>
                )}
              </div>

              {/* Official Syllabus Units */}
              <div className="space-y-2">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-ink-muted)]">
                  Official NTA Units & Coverage
                </h4>
                <div className="flex flex-wrap gap-1.5">
                  {checkpoint.officialChapterIds.map((ch, i) => (
                    <span
                      key={i}
                      className="px-2.5 py-1 rounded-md border border-[var(--border-paper)] bg-[var(--bg-surface)] text-xs text-[var(--text-ink)]"
                    >
                      {ch}
                    </span>
                  ))}
                </div>
              </div>

              {/* Learning Objectives */}
              <div className="space-y-2">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-ink-muted)]">
                  Core Learning Objectives
                </h4>
                <ul className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs text-[var(--text-ink-secondary)]">
                  {checkpoint.learningObjectives.map((obj, i) => (
                    <li key={i} className="flex items-start gap-2 p-2.5 rounded-lg border border-[var(--border-paper)] bg-[var(--bg-surface)]">
                      <CheckCircle2 className="w-4 h-4 text-[var(--accent-terracotta)] shrink-0 mt-0.5" />
                      <span>{obj}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* The 6-Stage Milestone Learning Cycle */}
              <div className="space-y-3 pt-2">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-ink-muted)]">
                  The 6-Stage Learning Progression
                </h4>

                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                  {/* Stage A: Diagnostic */}
                  <div className="p-3.5 rounded-xl border border-[var(--border-paper)] bg-[var(--bg-surface)] flex flex-col justify-between space-y-2">
                    <div>
                      <div className="flex items-center justify-between text-xs font-semibold text-[var(--text-ink)]">
                        <span>A. Diagnostic</span>
                        {checkpoint.diagnosticQuestions.length < 4 ? (
                          <span className="text-[10px] text-amber-600 font-bold">Needs &ge; 4 Qs</span>
                        ) : progress?.diagnosticCleared ? (
                          <span className="text-[10px] text-emerald-600 font-bold">Cleared (Skip)</span>
                        ) : progress?.diagnosticScore ? (
                          <span className="text-[10px] text-[var(--text-ink-muted)]">{progress.diagnosticScore.percentage}%</span>
                        ) : (
                          <span className="text-[10px] text-[var(--text-ink-muted)]">Available</span>
                        )}
                      </div>
                      <p className="text-[11px] text-[var(--text-ink-secondary)] mt-1">
                        {checkpoint.diagnosticQuestions.length < 4
                          ? `Diagnostic screening requires &ge; 4 questions (${checkpoint.diagnosticQuestions.length} authored).`
                          : '4+ questions. Pass with ≥ 80% to skip introductory reading.'}
                      </p>
                    </div>
                    <CapsuleButton
                      size="sm"
                      variant="subtle"
                      disabled={checkpoint.diagnosticQuestions.length < 4}
                      onClick={() => setActiveStage('diagnostic')}
                    >
                      {checkpoint.diagnosticQuestions.length < 4
                        ? 'Diagnostic Incomplete'
                        : progress?.diagnosticScore
                        ? 'Review Diagnostic'
                        : 'Start Diagnostic'}
                    </CapsuleButton>
                  </div>

                  {/* Stage B: Smart Revision */}
                  <div className="p-3.5 rounded-xl border border-[var(--border-paper)] bg-[var(--bg-surface)] flex flex-col justify-between space-y-2">
                    <div>
                      <div className="flex items-center justify-between text-xs font-semibold text-[var(--text-ink)]">
                        <span>B. Smart Revision</span>
                        {checkpoint.concepts.length === 0 ? (
                          <span className="text-[10px] text-amber-600 font-bold">Pending Notes</span>
                        ) : progress?.revisionCompleted ? (
                          <span className="text-[10px] text-emerald-600 font-bold">Read</span>
                        ) : (
                          <span className="text-[10px] text-[var(--text-ink-muted)]">{checkpoint.concepts.length} Notes</span>
                        )}
                      </div>
                      <p className="text-[11px] text-[var(--text-ink-secondary)] mt-1">
                        {checkpoint.concepts.length === 0
                          ? 'Curated concept notes under review.'
                          : 'Concise formulas, reaction maps, common traps, and NCERT facts.'}
                      </p>
                    </div>
                    <CapsuleButton
                      size="sm"
                      variant="subtle"
                      disabled={checkpoint.concepts.length === 0}
                      onClick={() => setActiveStage('revision')}
                    >
                      {checkpoint.concepts.length === 0 ? 'Pending Revision' : 'Read Revision'}
                    </CapsuleButton>
                  </div>

                  {/* Stage C: Active Recall */}
                  <div className="p-3.5 rounded-xl border border-[var(--border-paper)] bg-[var(--bg-surface)] flex flex-col justify-between space-y-2">
                    <div>
                      <div className="flex items-center justify-between text-xs font-semibold text-[var(--text-ink)]">
                        <span>C. Active Recall</span>
                        {checkpoint.activeRecallPrompts.length < 3 ? (
                          <span className="text-[10px] text-amber-600 font-bold">Needs &ge; 3 Prompts</span>
                        ) : progress?.activeRecallScore ? (
                          <span className="text-[10px] text-emerald-600 font-bold">{progress.activeRecallScore.percentage}%</span>
                        ) : (
                          <span className="text-[10px] text-[var(--text-ink-muted)]">{checkpoint.activeRecallPrompts.length} Cards</span>
                        )}
                      </div>
                      <p className="text-[11px] text-[var(--text-ink-secondary)] mt-1">
                        {checkpoint.activeRecallPrompts.length < 3
                          ? `Active recall requires &ge; 3 retrieval prompts (${checkpoint.activeRecallPrompts.length} authored).`
                          : 'Rapid retrieval questions to solidify core equations without notes.'}
                      </p>
                    </div>
                    <CapsuleButton
                      size="sm"
                      variant="subtle"
                      disabled={checkpoint.activeRecallPrompts.length < 3}
                      onClick={() => setActiveStage('recall')}
                    >
                      {checkpoint.activeRecallPrompts.length < 3 ? 'Recall Incomplete' : 'Start Recall'}
                    </CapsuleButton>
                  </div>

                  {/* Stage D: Question Practice */}
                  <div className="p-3.5 rounded-xl border border-[var(--border-paper)] bg-[var(--bg-surface)] flex flex-col justify-between space-y-2">
                    <div>
                      <div className="flex items-center justify-between text-xs font-semibold text-[var(--text-ink)]">
                        <span>D. Practice Tiers</span>
                        <span className="text-[10px] text-[var(--text-ink-muted)]">3 Tiers</span>
                      </div>
                      <p className="text-[11px] text-[var(--text-ink-secondary)] mt-1">
                        Foundation, Application, and JEE Main problem sets with hints.
                      </p>
                    </div>
                    <CapsuleButton
                      size="sm"
                      variant="subtle"
                      onClick={() => setActiveStage('practice')}
                    >
                      Open Practice
                    </CapsuleButton>
                  </div>

                  {/* Stage E: Assessment */}
                  <div className="p-3.5 rounded-xl border border-[var(--border-paper)] bg-[var(--bg-surface)] flex flex-col justify-between space-y-2">
                    <div>
                      <div className="flex items-center justify-between text-xs font-semibold text-[var(--text-ink)]">
                        <span>E. Assessment</span>
                        {checkpoint.assessmentQuestions.length === 0 ? (
                          <span className="text-[10px] text-amber-600 font-bold">Pending Qs</span>
                        ) : getVerifiedAssessmentQuestions(checkpoint).length === 0 ? (
                          <span className="text-[10px] text-amber-600 font-bold">Verification Pending</span>
                        ) : progress?.assessmentResult ? (
                          <span className="text-[10px] text-[var(--accent-terracotta)] font-bold">{progress.assessmentResult.percentage}%</span>
                        ) : (
                          <span className="text-[10px] text-emerald-600 font-bold">{getVerifiedAssessmentQuestions(checkpoint).length} Verified Qs</span>
                        )}
                      </div>
                      <p className="text-[11px] text-[var(--text-ink-secondary)] mt-1">
                        {checkpoint.assessmentQuestions.length === 0
                          ? 'Assessment questions are pending authoring.'
                          : getVerifiedAssessmentQuestions(checkpoint).length === 0
                          ? 'Milestone assessment questions are undergoing formal SME verification. Completed review is required to award official milestone mastery.'
                          : 'Timed JEE Main marking test (+4, -1, 0) for official milestone mastery.'}
                      </p>
                    </div>
                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                      <CapsuleButton
                        size="sm"
                        variant="accent"
                        disabled={getVerifiedAssessmentQuestions(checkpoint).length === 0}
                        onClick={() => {
                          setAssessmentMode('learner');
                          setActiveStage('assessment');
                        }}
                      >
                        {getVerifiedAssessmentQuestions(checkpoint).length === 0 ? 'Verification Pending' : 'Take Assessment'}
                      </CapsuleButton>
                      {isInternalPreviewPermitted() && getVerifiedAssessmentQuestions(checkpoint).length === 0 && checkpoint.assessmentQuestions.length > 0 && (
                        <CapsuleButton
                          size="sm"
                          variant="subtle"
                          onClick={() => {
                            if (!isInternalPreviewPermitted()) return;
                            setAssessmentMode('internal_validation');
                            setActiveStage('assessment');
                          }}
                        >
                          Preview (Internal Only)
                        </CapsuleButton>
                      )}
                    </div>
                  </div>

                  {/* Stage F: Performance & Revision */}
                  <div className="p-3.5 rounded-xl border border-[var(--border-paper)] bg-[var(--bg-surface)] flex flex-col justify-between space-y-2">
                    <div>
                      <div className="flex items-center justify-between text-xs font-semibold text-[var(--text-ink)]">
                        <span>F. Spaced Revision</span>
                        <span className="text-[10px] text-emerald-600 font-bold">Active</span>
                      </div>
                      <p className="text-[11px] text-[var(--text-ink-secondary)] mt-1">
                        Adaptive Day 1, 3, 7, 14, 30 retrieval intervals scheduled from error analysis.
                      </p>
                    </div>
                    <CapsuleButton
                      size="sm"
                      variant="subtle"
                      disabled={!progress?.assessmentResult}
                      onClick={() => setActiveStage('analysis')}
                    >
                      View Analysis
                    </CapsuleButton>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
