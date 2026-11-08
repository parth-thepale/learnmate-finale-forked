import React from 'react';
import { ArrowRight, BookOpen, CheckCircle2, Clock, Lock, Sparkles } from 'lucide-react';
import type { Roadmap } from '../types/roadmap.types';
import type { RoadmapProgress } from '../types/progress.types';
import { CapsuleBadge, CapsuleButton, CapsuleProgressPill } from '../../../components/capsule';
import { getCheckpointsForRoadmap } from '../data/checkpointRegistry';

interface RoadmapCardProps {
  roadmap: Roadmap;
  progress?: RoadmapProgress;
  onSelect: (roadmapId: Roadmap['id']) => void;
}

export const RoadmapCard: React.FC<RoadmapCardProps> = ({ roadmap, progress, onSelect }) => {
  const checkpoints = getCheckpointsForRoadmap(roadmap.id);
  const totalCheckpoints = checkpoints.length;
  const completedCount = progress?.completedCheckpointsCount ?? 0;
  const progressPct = progress?.completionPercentage ?? 0;

  const currentCp = checkpoints.find((cp) => cp.id === progress?.currentCheckpointId) || checkpoints[0];

  return (
    <div className="paper-card p-5 flex flex-col justify-between hover:border-[var(--border-paper-strong)] transition-all group">
      <div>
        {/* Header: Roadmap ID & Subject badge */}
        <div className="flex items-center justify-between gap-2 mb-2.5">
          <span className="font-mono text-xs font-bold px-2 py-0.5 rounded border border-[var(--border-paper)] bg-[var(--bg-surface-warm)] text-[var(--text-ink)]">
            {roadmap.id}
          </span>
          <CapsuleBadge
            label={roadmap.subject.toUpperCase()}
            variant={
              roadmap.subject === 'physics'
                ? 'accent'
                : roadmap.subject === 'chemistry'
                ? 'success'
                : 'info'
            }
            size="sm"
          />
        </div>

        {/* Title */}
        <h3 className="paper-title text-lg text-[var(--text-ink)] group-hover:text-[var(--accent-terracotta)] transition-colors line-clamp-1">
          {roadmap.title}
        </h3>

        {/* Description */}
        <p className="text-xs text-[var(--text-ink-secondary)] mt-1.5 line-clamp-2 leading-relaxed">
          {roadmap.description}
        </p>

        {/* Checkpoint info */}
        <div className="mt-4 pt-3 border-t border-[var(--border-paper)] flex items-center justify-between text-xs text-[var(--text-ink-muted)]">
          <span className="inline-flex items-center gap-1.5 font-medium">
            <CheckCircle2 className="w-3.5 h-3.5 text-[var(--accent-terracotta)]" />
            {completedCount}/{totalCheckpoints} Milestones
          </span>
          <span className="inline-flex items-center gap-1">
            <Clock className="w-3.5 h-3.5" />
            ~{roadmap.estimatedHours}h
          </span>
        </div>

        {/* Progress bar */}
        <div className="mt-2.5">
          <CapsuleProgressPill
            value={progressPct}
            label={`${progressPct}% Mastery`}
            variant={progressPct >= 80 ? 'success' : progressPct > 0 ? 'accent' : 'default'}
            size="sm"
          />
        </div>

        {/* Current milestone indicator */}
        {currentCp && (
          <div className="mt-3 p-2 rounded-lg bg-[var(--bg-surface-warm)] border border-[var(--border-paper)] text-[11px] text-[var(--text-ink-secondary)] truncate">
            <span className="font-semibold text-[var(--text-ink)]">Current: </span>
            {currentCp.title}
          </div>
        )}
      </div>

      {/* Footer Action */}
      <div className="mt-5 pt-3">
        <CapsuleButton
          variant={progressPct > 0 ? 'accent' : 'secondary'}
          size="sm"
          rightIcon={<ArrowRight className="w-3.5 h-3.5" />}
          className="w-full justify-between"
          onClick={() => onSelect(roadmap.id)}
        >
          {progressPct > 0 ? 'Continue Journey' : 'Explore Roadmap'}
        </CapsuleButton>
      </div>
    </div>
  );
};
