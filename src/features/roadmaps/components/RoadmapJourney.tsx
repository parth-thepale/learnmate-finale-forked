import React, { useState } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  Sparkles,
  BookOpen,
  Award,
  Layers,
  ChevronRight,
  RotateCcw,
} from 'lucide-react';
import type { Roadmap } from '../types/roadmap.types';
import type { Checkpoint } from '../types/checkpoint.types';
import type {
  AssessmentAttemptResult,
  CheckpointProgress,
  RevisionItem,
  RoadmapProgress,
} from '../types/progress.types';
import { getCheckpointsForRoadmap } from '../data/checkpointRegistry';
import { resolveCheckpointNodeStatus, getCheckpointLockReason } from '../engine/progressionEngine';
import { CheckpointNode } from './CheckpointNode';
import { CheckpointDetailPanel } from './CheckpointDetailPanel';
import { CheckpointLearningView } from './CheckpointLearningView';
import { CapsuleBadge, CapsuleButton, CapsuleProgressPill } from '../../../components/capsule';

interface RoadmapJourneyProps {
  roadmap: Roadmap;
  roadmapProgress: RoadmapProgress;
  dueRevisionItems?: readonly RevisionItem[];
  onBack: () => void;
  onUpdateCheckpointProgress: (updated: CheckpointProgress) => void;
  onRecordAssessment: (checkpointId: string, result: AssessmentAttemptResult) => { scheduledRevisions: RevisionItem[] };
}

export const RoadmapJourney: React.FC<RoadmapJourneyProps> = ({
  roadmap,
  roadmapProgress,
  dueRevisionItems = [],
  onBack,
  onUpdateCheckpointProgress,
  onRecordAssessment,
}) => {
  const checkpoints = getCheckpointsForRoadmap(roadmap.id);
  const [selectedCheckpoint, setSelectedCheckpoint] = useState<Checkpoint | null>(null);

  const completedCount = roadmapProgress.completedCheckpointsCount;
  const progressPct = roadmapProgress.completionPercentage;

  if (selectedCheckpoint) {
    const cpProgress = roadmapProgress.checkpoints[selectedCheckpoint.id];
    const nodeStatus = resolveCheckpointNodeStatus(
      selectedCheckpoint,
      cpProgress,
      roadmapProgress.checkpoints,
      dueRevisionItems
    );
    const lockReason = getCheckpointLockReason(selectedCheckpoint, roadmapProgress.checkpoints);

    return (
      <CheckpointLearningView
        checkpoint={selectedCheckpoint}
        roadmap={roadmap}
        progress={cpProgress}
        isLocked={nodeStatus === 'locked'}
        lockDescription={lockReason?.description}
        onBack={() => setSelectedCheckpoint(null)}
        onUpdateProgress={onUpdateCheckpointProgress}
        onRecordAssessment={onRecordAssessment}
      />
    );
  }

  return (
    <div className="max-w-[1080px] mx-auto px-4 sm:px-6 py-8 space-y-8">
      {/* Top Navigation & Roadmap Summary */}
      <div className="space-y-4">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--accent-terracotta)] hover:underline cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to All JEE 2027 Roadmaps</span>
        </button>

        <div className="paper-card p-6 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs font-bold px-2 py-0.5 rounded border border-[var(--border-paper)] bg-[var(--bg-surface-warm)] text-[var(--text-ink)]">
                {roadmap.id}
              </span>
              <CapsuleBadge
                label={roadmap.subject.toUpperCase()}
                variant={roadmap.subject === 'physics' ? 'accent' : roadmap.subject === 'chemistry' ? 'success' : 'info'}
                size="sm"
              />
              <span className="text-xs text-[var(--text-ink-muted)]">
                {completedCount}/{checkpoints.length} Milestones Cleared
              </span>
            </div>

            <h1 className="paper-title text-2xl sm:text-3xl text-[var(--text-ink)]">
              {roadmap.title}
            </h1>

            <p className="text-xs sm:text-sm text-[var(--text-ink-secondary)] max-w-2xl leading-relaxed">
              {roadmap.description}
            </p>
          </div>

          {/* Progress Bar & Workload */}
          <div className="w-full md:w-64 shrink-0 space-y-2 p-3.5 rounded-xl border border-[var(--border-paper)] bg-[var(--bg-surface-warm)]">
            <div className="flex items-center justify-between text-xs text-[var(--text-ink-muted)]">
              <span>Overall Mastery</span>
              <span className="font-semibold text-[var(--text-ink)]">{progressPct}%</span>
            </div>
            <CapsuleProgressPill
              value={progressPct}
              label={`${progressPct}%`}
              variant={progressPct >= 80 ? 'success' : progressPct > 0 ? 'accent' : 'default'}
              size="md"
            />
            <div className="flex items-center justify-between text-[11px] text-[var(--text-ink-muted)] pt-1">
              <span>Workload: ~{roadmap.estimatedHours} hrs</span>
              <span>4 Milestones</span>
            </div>
          </div>
        </div>
      </div>

      {/* Coddy-Inspired Central Vertical Learning Path */}
      <div className="relative py-4 flex flex-col items-center">
        {/* Subtle Vertical Connector Guide Line */}
        <div className="absolute top-12 bottom-12 left-1/2 -translate-x-1/2 w-0.5 bg-[var(--border-paper-strong)] pointer-events-none" />

        {/* Checkpoint Nodes along the path */}
        <div className="w-full space-y-6">
          {checkpoints.map((cp, idx) => {
            const cpProgress = roadmapProgress.checkpoints[cp.id];
            const nodeStatus = resolveCheckpointNodeStatus(
              cp,
              cpProgress,
              roadmapProgress.checkpoints,
              dueRevisionItems
            );

            return (
              <CheckpointNode
                key={cp.id}
                checkpoint={cp}
                status={nodeStatus}
                progress={cpProgress}
                isSelected={false}
                onSelect={(selected) => setSelectedCheckpoint(selected)}
                isFirst={idx === 0}
                isLast={idx === checkpoints.length - 1}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
};
