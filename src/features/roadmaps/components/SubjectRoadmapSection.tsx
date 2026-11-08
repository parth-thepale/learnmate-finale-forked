import React from 'react';
import type { JeeSubjectId } from '../../../data/jeeMainSyllabus';
import type { Roadmap } from '../types/roadmap.types';
import type { RoadmapProgress } from '../types/progress.types';
import { RoadmapCard } from './RoadmapCard';
import { Atom, Compass, Pi, Sparkles } from 'lucide-react';

interface SubjectRoadmapSectionProps {
  subject: JeeSubjectId;
  roadmaps: readonly Roadmap[];
  roadmapsProgress: Record<string, RoadmapProgress>;
  onSelectRoadmap: (roadmapId: Roadmap['id']) => void;
}

export const SubjectRoadmapSection: React.FC<SubjectRoadmapSectionProps> = ({
  subject,
  roadmaps,
  roadmapsProgress,
  onSelectRoadmap,
}) => {
  const subjectMetadata = {
    physics: {
      name: 'Physics',
      kicker: '4 Modular Tracks',
      subtitle: 'Mechanics, Gravitation, Electrodynamics, Optics & Experimental Skills',
      icon: <Atom className="w-5 h-5 text-[var(--accent-terracotta)]" />,
    },
    chemistry: {
      name: 'Chemistry',
      kicker: '4 Modular Tracks',
      subtitle: 'Physical Foundations, Inorganic Chemistry, Organic Reactions & Lab Mastery',
      icon: <Sparkles className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />,
    },
    mathematics: {
      name: 'Mathematics',
      kicker: '4 Modular Tracks',
      subtitle: 'Algebra, Calculus, Coordinate Geometry, Vectors & Probability',
      icon: <Pi className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />,
    },
  }[subject];

  return (
    <section className="space-y-4">
      {/* Subject Section Header */}
      <div className="flex items-center gap-3 pb-2 border-b border-[var(--border-paper)]">
        <div className="w-9 h-9 rounded-lg border border-[var(--border-paper)] bg-[var(--bg-surface)] flex items-center justify-center shrink-0">
          {subjectMetadata.icon}
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h2 className="paper-title text-xl text-[var(--text-ink)]">{subjectMetadata.name}</h2>
            <span className="text-[11px] font-mono uppercase tracking-wider text-[var(--text-ink-muted)]">
              ({subjectMetadata.kicker})
            </span>
          </div>
          <p className="text-xs text-[var(--text-ink-secondary)]">{subjectMetadata.subtitle}</p>
        </div>
      </div>

      {/* Grid of 4 Roadmap Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {roadmaps.map((roadmap) => (
          <RoadmapCard
            key={roadmap.id}
            roadmap={roadmap}
            progress={roadmapsProgress[roadmap.id]}
            onSelect={onSelectRoadmap}
          />
        ))}
      </div>
    </section>
  );
};
