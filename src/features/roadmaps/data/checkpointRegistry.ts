import type { Checkpoint } from '../types/checkpoint.types';
import type { RoadmapId } from '../types/roadmap.types';
import { CHEMISTRY_CHECKPOINTS } from './checkpoints/chemistryCheckpoints';
import { MATHEMATICS_CHECKPOINTS } from './checkpoints/mathematicsCheckpoints';
import { PHYSICS_CHECKPOINTS } from './checkpoints/physicsCheckpoints';

export const ALL_CHECKPOINTS: readonly Checkpoint[] = Object.freeze([
  ...PHYSICS_CHECKPOINTS,
  ...CHEMISTRY_CHECKPOINTS,
  ...MATHEMATICS_CHECKPOINTS,
]);

const checkpointMap = new Map<string, Checkpoint>(ALL_CHECKPOINTS.map((cp) => [cp.id, cp]));
const checkpointsByRoadmapMap = new Map<string, Checkpoint[]>();

for (const cp of ALL_CHECKPOINTS) {
  const existing = checkpointsByRoadmapMap.get(cp.roadmapId) ?? [];
  existing.push(cp);
  checkpointsByRoadmapMap.set(cp.roadmapId, existing);
}

// Ensure checkpoints for each roadmap are sorted by order ascending
for (const [roadmapId, list] of checkpointsByRoadmapMap.entries()) {
  list.sort((a, b) => a.order - b.order);
  checkpointsByRoadmapMap.set(roadmapId, list);
}

export function getCheckpointById(id: string): Checkpoint | undefined {
  return checkpointMap.get(id);
}

export function getCheckpointsForRoadmap(roadmapId: RoadmapId | string): readonly Checkpoint[] {
  return checkpointsByRoadmapMap.get(roadmapId) ?? [];
}

export function getAllCheckpoints(): readonly Checkpoint[] {
  return ALL_CHECKPOINTS;
}

export { CHEMISTRY_CHECKPOINTS, MATHEMATICS_CHECKPOINTS, PHYSICS_CHECKPOINTS };
