import test from 'node:test';
import assert from 'node:assert/strict';
import { ALL_ROADMAPS, ROADMAPS_BY_SUBJECT, getRoadmapById } from './roadmaps';
import { ALL_CHECKPOINTS, getCheckpointById, getCheckpointsForRoadmap } from './checkpointRegistry';
import { validateSyllabusCoverage, OFFICIAL_JEE_2027_SYLLABUS_MATRIX } from './syllabus/jeeMain2027Mapping';
import { JEE_MAIN_SYLLABUS } from '../../../data/jeeMainSyllabus';

test('catalogue contains exactly 12 roadmaps: 4 Physics, 4 Chemistry, 4 Mathematics', () => {
  assert.equal(ALL_ROADMAPS.length, 12, 'Must have exactly 12 roadmaps');
  assert.equal(ROADMAPS_BY_SUBJECT.physics.length, 4, 'Must have 4 Physics roadmaps');
  assert.equal(ROADMAPS_BY_SUBJECT.chemistry.length, 4, 'Must have 4 Chemistry roadmaps');
  assert.equal(ROADMAPS_BY_SUBJECT.mathematics.length, 4, 'Must have 4 Mathematics roadmaps');

  const roadmapIds = ALL_ROADMAPS.map((r) => r.id);
  const uniqueIds = new Set(roadmapIds);
  assert.equal(uniqueIds.size, 12, 'All roadmap IDs must be unique');

  // Verify prefixes and order
  assert.deepEqual(ROADMAPS_BY_SUBJECT.physics.map((r) => r.id), ['PHY-01', 'PHY-02', 'PHY-03', 'PHY-04']);
  assert.deepEqual(ROADMAPS_BY_SUBJECT.chemistry.map((r) => r.id), ['CHE-01', 'CHE-02', 'CHE-03', 'CHE-04']);
  assert.deepEqual(ROADMAPS_BY_SUBJECT.mathematics.map((r) => r.id), ['MAT-01', 'MAT-02', 'MAT-03', 'MAT-04']);
});

test('every roadmap has exactly 4 major checkpoints (48 checkpoints total)', () => {
  assert.equal(ALL_CHECKPOINTS.length, 48, 'Must have exactly 48 major checkpoints');

  const cpIds = new Set<string>();
  for (const roadmap of ALL_ROADMAPS) {
    const cps = getCheckpointsForRoadmap(roadmap.id);
    assert.equal(cps.length, 4, `Roadmap ${roadmap.id} must have exactly 4 checkpoints`);
    assert.deepEqual(
      cps.map((c) => c.order),
      [1, 2, 3, 4],
      `Checkpoints in ${roadmap.id} must be ordered 1 to 4`
    );

    for (const cp of cps) {
      assert.ok(!cpIds.has(cp.id), `Duplicate checkpoint id ${cp.id}`);
      cpIds.add(cp.id);
      assert.equal(cp.roadmapId, roadmap.id);
      assert.equal(cp.subject, roadmap.subject);
      assert.ok(cp.title.length > 0, `${cp.id} must have a non-empty title`);
      assert.ok(cp.description.length > 0, `${cp.id} must have a non-empty description`);
      assert.ok(cp.learningObjectives.length > 0, `${cp.id} must have learning objectives`);
      assert.ok(cp.estimatedWorkloadMinutes > 0, `${cp.id} must have positive workload minutes`);
    }
  }

  assert.equal(cpIds.size, 48);
});

test('every official NTA unit (54 units total) is mapped exactly once with zero omissions', () => {
  const coverage = validateSyllabusCoverage();
  assert.ok(coverage.isComplete, `Syllabus coverage must be complete. Missing: ${coverage.missingChapters.join(', ')}`);
  assert.equal(coverage.totalMappedUnits, 54, 'Expected 54 mapped NTA units (20 Phys + 20 Chem + 14 Math)');
  assert.equal(coverage.expectedUnits, 54);
  assert.deepEqual(coverage.missingChapters, []);
  assert.deepEqual(coverage.duplicateChapters, []);
});

test('checkpoints have valid prerequisite relationships without cycles', () => {
  for (const cp of ALL_CHECKPOINTS) {
    for (const prereqId of cp.prerequisiteIds) {
      const prereq = getCheckpointById(prereqId);
      assert.ok(prereq, `Prerequisite ${prereqId} for checkpoint ${cp.id} must exist`);
      assert.notEqual(prereqId, cp.id, `Checkpoint ${cp.id} cannot be its own prerequisite`);
      // Checkpoint prerequisite in the same roadmap must have lower order
      if (prereq.roadmapId === cp.roadmapId) {
        assert.ok(prereq.order < cp.order, `Prerequisite ${prereqId} must precede ${cp.id}`);
      }
    }
  }
});
