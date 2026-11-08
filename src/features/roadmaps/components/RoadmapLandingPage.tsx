import React, { useState } from 'react';
import {
  Compass,
  Sparkles,
  ArrowRight,
  TrendingUp,
  Layers,
  Clock,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
} from 'lucide-react';
import type { Roadmap, RoadmapId } from '../types/roadmap.types';
import type {
  AdaptiveRecommendation,
  RevisionItem,
  RoadmapProgress,
} from '../types/progress.types';
import { ROADMAPS_BY_SUBJECT } from '../data/roadmaps';
import { SubjectRoadmapSection } from './SubjectRoadmapSection';
import { RoadmapProgressPanel } from './RoadmapProgressPanel';
import { CapsuleBadge, CapsuleButton } from '../../../components/capsule';

interface RoadmapLandingPageProps {
  roadmapsProgress: Record<string, RoadmapProgress>;
  revisionQueue: readonly RevisionItem[];
  topRecommendation: AdaptiveRecommendation | null;
  onSelectRoadmap: (roadmapId: RoadmapId) => void;
  onReviewRevisionItem: (item: RevisionItem) => void;
}

export const RoadmapLandingPage: React.FC<RoadmapLandingPageProps> = ({
  roadmapsProgress,
  revisionQueue,
  topRecommendation,
  onSelectRoadmap,
  onReviewRevisionItem,
}) => {
  const [activeSubjectFilter, setActiveSubjectFilter] = useState<'all' | 'physics' | 'chemistry' | 'mathematics'>('all');

  return (
    <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-8 space-y-8">
      {/* Page Title & Mission Heading */}
      <div className="border-b border-[var(--border-paper)] pb-6 flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <div className="paper-kicker mb-1">Adaptive Learning & Revision System</div>
          <h1 className="paper-title text-3xl sm:text-4xl text-[var(--text-ink)]">
            Your JEE 2027 Journey
          </h1>
          <p className="text-sm sm:text-base text-[var(--text-ink-secondary)] mt-1 font-serif-editorial">
            Revise smarter. Practise consistently. Track your mastery.
          </p>
        </div>

        {/* Quick Subject Filter Pills */}
        <div className="flex items-center gap-1.5 p-1 rounded-xl bg-[var(--bg-surface-warm)] border border-[var(--border-paper)] self-start md:self-auto">
          {(['all', 'physics', 'chemistry', 'mathematics'] as const).map((sub) => (
            <button
              key={sub}
              type="button"
              onClick={() => setActiveSubjectFilter(sub)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all capitalize cursor-pointer ${
                activeSubjectFilter === sub
                  ? 'bg-[var(--bg-surface)] text-[var(--accent-terracotta)] font-semibold shadow-xs border border-[var(--border-paper)]'
                  : 'text-[var(--text-ink-secondary)] hover:text-[var(--text-ink)]'
              }`}
            >
              {sub === 'all' ? 'All Subjects (12)' : sub}
            </button>
          ))}
        </div>
      </div>

      {/* Top Personalized Recommendation Banner (Grounding: Real data only) */}
      {topRecommendation && (
        <div className="p-5 rounded-2xl border border-[var(--border-paper-strong)] bg-[var(--bg-surface-warm)] shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <div className="w-10 h-10 rounded-xl bg-[var(--accent-terracotta)] text-white flex items-center justify-center shrink-0 shadow-xs">
              <Sparkles className="w-5 h-5" />
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <CapsuleBadge
                  label="Recommended Next Step"
                  variant="accent"
                  size="sm"
                />
                <span className="text-xs font-mono text-[var(--text-ink-muted)]">
                  {topRecommendation.roadmapId}
                </span>
              </div>
              <h3 className="paper-title text-base sm:text-lg text-[var(--text-ink)]">
                {topRecommendation.title}
              </h3>
              <p className="text-xs text-[var(--text-ink-secondary)] leading-relaxed max-w-3xl">
                {topRecommendation.message}{' '}
                <span className="text-[var(--text-ink-muted)] italic">
                  ({topRecommendation.rationale})
                </span>
              </p>
            </div>
          </div>

          <CapsuleButton
            variant="accent"
            size="md"
            rightIcon={<ArrowRight className="w-4 h-4" />}
            className="shrink-0 self-start md:self-center"
            onClick={() => onSelectRoadmap(topRecommendation.roadmapId)}
          >
            Take Action
          </CapsuleButton>
        </div>
      )}

      {/* Main Content Layout: Catalogue Grid (Left) + Contextual Sidebar (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8 items-start">
        {/* Left: Subject Sections */}
        <div className="lg:col-span-3 space-y-10">
          {(activeSubjectFilter === 'all' || activeSubjectFilter === 'physics') && (
            <SubjectRoadmapSection
              subject="physics"
              roadmaps={ROADMAPS_BY_SUBJECT.physics}
              roadmapsProgress={roadmapsProgress}
              onSelectRoadmap={onSelectRoadmap}
            />
          )}

          {(activeSubjectFilter === 'all' || activeSubjectFilter === 'chemistry') && (
            <SubjectRoadmapSection
              subject="chemistry"
              roadmaps={ROADMAPS_BY_SUBJECT.chemistry}
              roadmapsProgress={roadmapsProgress}
              onSelectRoadmap={onSelectRoadmap}
            />
          )}

          {(activeSubjectFilter === 'all' || activeSubjectFilter === 'mathematics') && (
            <SubjectRoadmapSection
              subject="mathematics"
              roadmaps={ROADMAPS_BY_SUBJECT.mathematics}
              roadmapsProgress={roadmapsProgress}
              onSelectRoadmap={onSelectRoadmap}
            />
          )}
        </div>

        {/* Right: Compact Contextual Progress & Revision Sidebar */}
        <div className="lg:col-span-1">
          <RoadmapProgressPanel
            roadmapsProgress={roadmapsProgress}
            revisionQueue={revisionQueue}
            onReviewRevision={onReviewRevisionItem}
            className="sticky top-20"
          />
        </div>
      </div>
    </div>
  );
};
