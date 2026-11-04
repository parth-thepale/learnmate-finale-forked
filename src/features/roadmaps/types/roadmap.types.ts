import type { JeeSubjectId } from '../../../data/jeeMainSyllabus';

export type RoadmapSubjectId = JeeSubjectId;

export type PhysicsRoadmapId = 'PHY-01' | 'PHY-02' | 'PHY-03' | 'PHY-04';
export type ChemistryRoadmapId = 'CHE-01' | 'CHE-02' | 'CHE-03' | 'CHE-04';
export type MathematicsRoadmapId = 'MAT-01' | 'MAT-02' | 'MAT-03' | 'MAT-04';

export type RoadmapId = PhysicsRoadmapId | ChemistryRoadmapId | MathematicsRoadmapId;

export interface Roadmap {
  readonly id: RoadmapId;
  readonly subject: RoadmapSubjectId;
  readonly examIdentifier: 'JEE Main';
  readonly examYear: 2027;
  readonly title: string;
  readonly description: string;
  readonly order: number;
  readonly syllabusVersion: string;
  readonly checkpointIds: readonly string[];
  readonly estimatedHours: number;
  readonly targetAudience: string;
  readonly colorTheme: {
    accentColor: string;
    subtleBg: string;
    borderColor: string;
  };
}

export interface RoadmapSummary {
  roadmap: Roadmap;
  totalCheckpoints: number;
  completedCheckpoints: number;
  progressPercentage: number;
  currentCheckpointId?: string;
  isUnlocked: boolean;
  needsAttentionCount: number;
}
