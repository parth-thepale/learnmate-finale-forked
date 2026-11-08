import type { JeeSubjectId } from '../../../../data/jeeMainSyllabus';
import type { Roadmap, RoadmapId } from '../../types/roadmap.types';
import { CHEMISTRY_ROADMAPS } from './chemistryRoadmaps';
import { MATHEMATICS_ROADMAPS } from './mathematicsRoadmaps';
import { PHYSICS_ROADMAPS } from './physicsRoadmaps';

export const ALL_ROADMAPS: readonly Roadmap[] = Object.freeze([
  ...PHYSICS_ROADMAPS,
  ...CHEMISTRY_ROADMAPS,
  ...MATHEMATICS_ROADMAPS,
]);

export const ROADMAPS_BY_SUBJECT: Readonly<Record<JeeSubjectId, readonly Roadmap[]>> = Object.freeze({
  physics: PHYSICS_ROADMAPS,
  chemistry: CHEMISTRY_ROADMAPS,
  mathematics: MATHEMATICS_ROADMAPS,
});

const roadmapMap = new Map<string, Roadmap>(ALL_ROADMAPS.map((r) => [r.id, r]));

export function getRoadmapById(id: string): Roadmap | undefined {
  return roadmapMap.get(id);
}

export function getRoadmapsForSubject(subject: JeeSubjectId): readonly Roadmap[] {
  return ROADMAPS_BY_SUBJECT[subject] ?? [];
}

export { CHEMISTRY_ROADMAPS, MATHEMATICS_ROADMAPS, PHYSICS_ROADMAPS };
