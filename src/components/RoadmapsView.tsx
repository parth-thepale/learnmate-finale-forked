import React, { useState } from 'react';
import type { User } from 'firebase/auth';
import type { ActiveTab } from './Navbar';
import type { RoadmapId } from '../features/roadmaps/types/roadmap.types';
import type { RevisionItem } from '../features/roadmaps/types/progress.types';
import { getRoadmapById } from '../features/roadmaps/data/roadmaps';
import { useRoadmapProgress } from '../features/roadmaps/hooks/useRoadmapProgress';
import { RoadmapLandingPage } from '../features/roadmaps/components/RoadmapLandingPage';
import { RoadmapJourney } from '../features/roadmaps/components/RoadmapJourney';

interface RoadmapsViewProps {
  onNavigateTab: (tab: ActiveTab) => void;
  user?: User | null;
}

export const RoadmapsView: React.FC<RoadmapsViewProps> = ({ onNavigateTab, user }) => {
  const [activeRoadmapId, setActiveRoadmapId] = useState<RoadmapId | null>(null);

  const {
    isLoading,
    roadmapsProgress,
    revisionQueue,
    topRecommendation,
    updateCheckpointProgress,
    recordAssessment,
    completeRevision,
  } = useRoadmapProgress(user);

  const activeRoadmap = activeRoadmapId ? getRoadmapById(activeRoadmapId) : null;
  const activeRoadmapProgress = activeRoadmapId ? roadmapsProgress[activeRoadmapId] : null;

  const handleReviewRevisionItem = (item: RevisionItem) => {
    setActiveRoadmapId(item.roadmapId);
  };

  if (activeRoadmap && activeRoadmapProgress) {
    return (
      <RoadmapJourney
        roadmap={activeRoadmap}
        roadmapProgress={activeRoadmapProgress}
        dueRevisionItems={revisionQueue}
        onBack={() => setActiveRoadmapId(null)}
        onUpdateCheckpointProgress={(updated) => updateCheckpointProgress(updated)}
        onRecordAssessment={(checkpointId, result) =>
          recordAssessment(checkpointId, activeRoadmap.id, result)
        }
      />
    );
  }

  return (
    <RoadmapLandingPage
      roadmapsProgress={roadmapsProgress}
      revisionQueue={revisionQueue}
      topRecommendation={topRecommendation}
      onSelectRoadmap={(id) => setActiveRoadmapId(id)}
      onReviewRevisionItem={handleReviewRevisionItem}
    />
  );
};
