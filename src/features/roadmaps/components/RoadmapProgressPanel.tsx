import React from 'react';
import {
  Calendar,
  Clock,
  AlertTriangle,
  CheckCircle2,
  TrendingUp,
  Sparkles,
  RotateCcw,
  BookOpen,
} from 'lucide-react';
import type { RevisionItem, RoadmapProgress } from '../types/progress.types';
import { partitionRevisionQueue } from '../engine/revisionScheduler';
import { CapsuleBadge, CapsuleButton, CapsuleProgressPill } from '../../../components/capsule';

interface RoadmapProgressPanelProps {
  roadmapsProgress: Record<string, RoadmapProgress>;
  revisionQueue: readonly RevisionItem[];
  onReviewRevision: (item: RevisionItem) => void;
  className?: string;
}

export const RoadmapProgressPanel: React.FC<RoadmapProgressPanelProps> = ({
  roadmapsProgress,
  revisionQueue,
  onReviewRevision,
  className = '',
}) => {
  const partitioned = partitionRevisionQueue(revisionQueue);
  const dueTotal = partitioned.dueToday.length + partitioned.overdue.length;

  // Aggregate completion across all 12 roadmaps
  const allRoadmapEntries = Object.values(roadmapsProgress);
  const totalMastery =
    allRoadmapEntries.length > 0
      ? Math.round(
          allRoadmapEntries.reduce((sum, r) => sum + (r.completionPercentage || 0), 0) / 12
        )
      : 0;

  const totalClearedCheckpoints = allRoadmapEntries.reduce(
    (sum, r) => sum + (r.completedCheckpointsCount || 0),
    0
  );

  return (
    <aside className={`space-y-4 ${className}`}>
      {/* Overview Stat Card */}
      <div className="paper-card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-ink-muted)] flex items-center gap-1.5">
            <TrendingUp className="w-3.5 h-3.5 text-[var(--accent-terracotta)]" />
            JEE 2027 Mastery
          </span>
          <span className="text-xs font-bold text-[var(--text-ink)]">{totalMastery}%</span>
        </div>

        <CapsuleProgressPill
          value={totalMastery}
          label={`${totalClearedCheckpoints}/48 Milestones`}
          variant={totalMastery >= 80 ? 'success' : 'accent'}
          size="sm"
        />

        <div className="pt-2 border-t border-[var(--border-paper)] grid grid-cols-2 gap-2 text-center text-xs">
          <div className="p-2 rounded-lg bg-[var(--bg-surface-warm)]">
            <span className="text-[10px] text-[var(--text-ink-muted)] block">Milestones Cleared</span>
            <span className="font-bold text-[var(--text-ink)]">{totalClearedCheckpoints} / 48</span>
          </div>
          <div className="p-2 rounded-lg bg-[var(--bg-surface-warm)]">
            <span className="text-[10px] text-[var(--text-ink-muted)] block">Due Revisions</span>
            <span className={`font-bold ${dueTotal > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
              {dueTotal}
            </span>
          </div>
        </div>
      </div>

      {/* Spaced Revision Queue */}
      <div className="paper-card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-ink-muted)] flex items-center gap-1.5">
            <Calendar className="w-3.5 h-3.5 text-[var(--accent-terracotta)]" />
            Spaced Revision Queue
          </span>
          {dueTotal > 0 && (
            <CapsuleBadge label={`${dueTotal} Due`} variant="warning" size="sm" />
          )}
        </div>

        {partitioned.overdue.length === 0 && partitioned.dueToday.length === 0 && (
          <div className="p-3 text-center rounded-lg bg-[var(--bg-surface-warm)] text-xs text-[var(--text-ink-muted)]">
            <CheckCircle2 className="w-4 h-4 mx-auto mb-1 text-emerald-600" />
            <span>All scheduled revisions are up to date!</span>
          </div>
        )}

        {/* Overdue items */}
        {partitioned.overdue.length > 0 && (
          <div className="space-y-1.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-red-600 dark:text-red-400">
              Overdue ({partitioned.overdue.length})
            </span>
            {partitioned.overdue.slice(0, 3).map((item) => (
              <div
                key={item.id}
                className="p-2.5 rounded-lg border border-red-200 dark:border-red-900/40 bg-red-50/40 dark:bg-red-950/20 flex items-center justify-between text-xs gap-2"
              >
                <div className="min-w-0 flex-1">
                  <span className="font-semibold text-red-900 dark:text-red-200 truncate block">
                    {item.topicName}
                  </span>
                  <span className="text-[10px] text-red-700 dark:text-red-300">
                    Due: {item.scheduledForDate}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => onReviewRevision(item)}
                  className="px-2.5 py-1 rounded text-[11px] font-semibold bg-red-600 text-white hover:bg-red-700 transition-colors shrink-0 cursor-pointer"
                >
                  Revise
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Due Today items */}
        {partitioned.dueToday.length > 0 && (
          <div className="space-y-1.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400">
              Due Today ({partitioned.dueToday.length})
            </span>
            {partitioned.dueToday.slice(0, 3).map((item) => (
              <div
                key={item.id}
                className="p-2.5 rounded-lg border border-amber-200 dark:border-amber-900/40 bg-amber-50/40 dark:bg-amber-950/20 flex items-center justify-between text-xs gap-2"
              >
                <div className="min-w-0 flex-1">
                  <span className="font-semibold text-amber-900 dark:text-amber-200 truncate block">
                    {item.topicName}
                  </span>
                  <span className="text-[10px] text-amber-700 dark:text-amber-300">
                    Step {item.intervalStep + 1}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => onReviewRevision(item)}
                  className="px-2.5 py-1 rounded text-[11px] font-semibold bg-amber-600 text-white hover:bg-amber-700 transition-colors shrink-0 cursor-pointer"
                >
                  Recall
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Upcoming items preview */}
        {partitioned.upcoming.length > 0 && (
          <div className="space-y-1 pt-1 border-t border-[var(--border-paper)] text-[11px] text-[var(--text-ink-muted)]">
            <span>{partitioned.upcoming.length} upcoming revisions scheduled</span>
          </div>
        )}
      </div>
    </aside>
  );
};
