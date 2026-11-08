import React from 'react';
import {
  CheckCircle2,
  Lock,
  Play,
  RotateCcw,
  AlertCircle,
  Clock,
  Sparkles,
  ChevronRight,
  GitBranch,
} from 'lucide-react';
import type { Checkpoint, CheckpointNodeStatus } from '../types/checkpoint.types';
import type { CheckpointProgress } from '../types/progress.types';
import { CapsuleBadge } from '../../../components/capsule';

interface CheckpointNodeProps {
  checkpoint: Checkpoint;
  status: CheckpointNodeStatus;
  progress?: CheckpointProgress;
  isSelected: boolean;
  onSelect: (checkpoint: Checkpoint) => void;
  isFirst: boolean;
  isLast: boolean;
}

export const CheckpointNode: React.FC<CheckpointNodeProps> = ({
  checkpoint,
  status,
  progress,
  isSelected,
  onSelect,
  isFirst,
  isLast,
}) => {
  const isLocked = status === 'locked';
  const isCompleted = status === 'completed';
  const isCurrent = status === 'current';
  const isRevisionDue = status === 'revision_due';
  const isNeedsReinforcement = status === 'needs_reinforcement';

  // Status visual cues
  const statusConfig = {
    completed: {
      badgeVariant: 'success' as const,
      badgeLabel: 'Mastered',
      icon: <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />,
      circleBg: 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-800 text-emerald-700',
    },
    current: {
      badgeVariant: 'accent' as const,
      badgeLabel: 'In Progress',
      icon: <Play className="w-4 h-4 text-[var(--accent-terracotta)] fill-current ml-0.5" />,
      circleBg: 'bg-[var(--accent-terracotta-subtle)] border-[var(--accent-terracotta)] text-[var(--accent-terracotta)] ring-4 ring-[var(--accent-terracotta)]/20',
    },
    available: {
      badgeVariant: 'subtle' as const,
      badgeLabel: 'Ready',
      icon: <span className="font-mono text-xs font-bold">{checkpoint.order}</span>,
      circleBg: 'bg-[var(--bg-surface)] border-[var(--border-paper-strong)] text-[var(--text-ink)]',
    },
    locked: {
      badgeVariant: 'neutral' as const,
      badgeLabel: 'Locked',
      icon: <Lock className="w-4 h-4 text-[var(--text-ink-muted)]" />,
      circleBg: 'bg-[var(--bg-surface-warm)] border-[var(--border-paper)] text-[var(--text-ink-muted)] opacity-60',
    },
    revision_due: {
      badgeVariant: 'warning' as const,
      badgeLabel: 'Revision Due',
      icon: <Clock className="w-4 h-4 text-amber-600 dark:text-amber-400" />,
      circleBg: 'bg-amber-50 dark:bg-amber-950/40 border-amber-400 text-amber-700 dark:text-amber-300 ring-4 ring-amber-400/20',
    },
    needs_reinforcement: {
      badgeVariant: 'danger' as const,
      badgeLabel: 'Needs Practice',
      icon: <RotateCcw className="w-4 h-4 text-red-600 dark:text-red-400" />,
      circleBg: 'bg-red-50 dark:bg-red-950/40 border-red-400 text-red-700 dark:text-red-300 ring-4 ring-red-400/20',
    },
    content_unavailable: {
      badgeVariant: 'neutral' as const,
      badgeLabel: 'Content Pending',
      icon: <AlertCircle className="w-4 h-4 text-[var(--text-ink-muted)]" />,
      circleBg: 'bg-[var(--bg-surface-warm)] border-[var(--border-paper)] text-[var(--text-ink-muted)] opacity-50',
    },
  }[status];

  return (
    <div className="relative flex items-center justify-center my-4 group">
      {/* Node Button / Card */}
      <button
        type="button"
        onClick={() => onSelect(checkpoint)}
        aria-label={`Milestone ${checkpoint.order}: ${checkpoint.title} (${statusConfig.badgeLabel})`}
        className={`relative z-10 w-full max-w-[540px] text-left p-4 rounded-xl border transition-all cursor-pointer ${
          isSelected
            ? 'border-[var(--accent-terracotta)] bg-[var(--bg-surface)] shadow-md ring-2 ring-[var(--accent-terracotta)]/30'
            : isLocked
            ? 'border-[var(--border-paper)] bg-[var(--bg-surface-warm)] opacity-75 hover:border-[var(--border-paper-strong)]'
            : 'border-[var(--border-paper)] bg-[var(--bg-surface)] hover:border-[var(--border-paper-strong)] hover:shadow-xs'
        }`}
      >
        <div className="flex items-start gap-3.5">
          {/* Milestone Circle Indicator */}
          <div
            className={`w-11 h-11 rounded-full border-2 flex items-center justify-center shrink-0 transition-all ${statusConfig.circleBg}`}
          >
            {statusConfig.icon}
          </div>

          {/* Node Metadata */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2 mb-1">
              <span className="text-[11px] font-mono uppercase tracking-wider text-[var(--text-ink-muted)]">
                Milestone 0{checkpoint.order}
              </span>
              <CapsuleBadge
                label={statusConfig.badgeLabel}
                variant={statusConfig.badgeVariant}
                size="sm"
              />
            </div>

            <h4 className="paper-title text-base text-[var(--text-ink)] leading-snug truncate">
              {checkpoint.title}
            </h4>

            <p className="text-xs text-[var(--text-ink-secondary)] mt-1 line-clamp-1">
              {checkpoint.description}
            </p>

            {/* Subtopic and Mastery Pill */}
            <div className="mt-2.5 flex items-center gap-2 text-[11px] text-[var(--text-ink-muted)]">
              <span>{checkpoint.topicIds.length} Subtopics</span>
              <span>•</span>
              <span>{checkpoint.estimatedWorkloadMinutes} min</span>
              {progress?.masteryScore !== undefined && progress.masteryScore > 0 && (
                <>
                  <span>•</span>
                  <span className="font-semibold text-[var(--text-ink)]">
                    {progress.masteryScore}% Score
                  </span>
                </>
              )}
            </div>
          </div>

          <ChevronRight
            className={`w-4 h-4 shrink-0 transition-transform self-center text-[var(--text-ink-muted)] ${
              isSelected ? 'text-[var(--accent-terracotta)] translate-x-0.5' : 'group-hover:translate-x-0.5'
            }`}
          />
        </div>

        {/* Optional Branch Nodes indication */}
        {checkpoint.branchNodes && checkpoint.branchNodes.length > 0 && (
          <div className="mt-3 pt-2.5 border-t border-[var(--border-paper)] flex items-center gap-1.5 text-[11px] text-[var(--text-ink-secondary)]">
            <GitBranch className="w-3.5 h-3.5 text-[var(--accent-terracotta)]" />
            <span>Optional Branch: {checkpoint.branchNodes[0].title}</span>
          </div>
        )}
      </button>
    </div>
  );
};
