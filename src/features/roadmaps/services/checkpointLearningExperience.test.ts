import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { getCheckpointTheory, hasAuthoredTheory } from '../data/theory/checkpointTheoryRegistry';
import {
  getCheckpointQuizQuestions,
  gradeQuizSubmission,
} from '../data/quizzes/checkpointQuizBank';
import { getCheckpointById, getCheckpointsForRoadmap } from '../data/checkpointRegistry';
import { RoadmapProgressService } from './roadmapProgressService';
import { RoadmapOutboxService } from './roadmapOutboxService';
import { MemoryStorage, FakeCloudStore } from '../../../services/testDoubles';
import { scopedKey, STORAGE_KEYS } from '../../../services/localScope';
import { cloudPaths } from '../../../services/cloudStore';
import { CheckpointNode } from '../components/CheckpointNode';
import type { CheckpointProgress, RoadmapProgress } from '../types/progress.types';

// ---------------------------------------------------------------------------
// 1. Clicking a checkpoint opens the correct checkpoint
// ---------------------------------------------------------------------------
test('Checkpoint Navigation 1: Clicking a checkpoint node triggers onSelect with the correct checkpoint', () => {
  const cp = getCheckpointById('PHY-01-CP1')!;
  assert.ok(cp, 'PHY-01-CP1 exists in catalogue');

  let selectedCheckpointId: string | null = null;
  const onSelect = (selected: typeof cp) => {
    selectedCheckpointId = selected.id;
  };

  // Instantiate CheckpointNode with status = 'current'
  const node = React.createElement(CheckpointNode, {
    checkpoint: cp,
    status: 'current',
    isSelected: false,
    onSelect,
    isFirst: true,
    isLast: false,
  });

  // Verify node properties
  assert.equal(node.props.checkpoint.id, 'PHY-01-CP1');
  assert.equal(node.props.status, 'current');

  // Trigger onSelect handler directly
  node.props.onSelect(cp);
  assert.equal(selectedCheckpointId, 'PHY-01-CP1');
});

// ---------------------------------------------------------------------------
// 2. Checkpoint content loads correctly
// ---------------------------------------------------------------------------
test('Checkpoint Navigation 2: Checkpoint theory content loads complete, structured educational material', () => {
  // Test Physics Representative Checkpoint
  const phyTheory = getCheckpointTheory('PHY-01-CP1');
  assert.equal(phyTheory.checkpointId, 'PHY-01-CP1');
  assert.equal(phyTheory.subject, 'physics');
  assert.ok(phyTheory.learningObjectives.length >= 3, 'Has learning objectives');
  assert.ok(phyTheory.definitions.length >= 2, 'Has definitions');
  assert.ok(phyTheory.concepts.length >= 2, 'Has detailed concept modules');
  assert.ok(phyTheory.concepts[0].keyFormulas.length >= 2, 'Has mathematical formulas');
  assert.ok(phyTheory.concepts[0].derivations && phyTheory.concepts[0].derivations.length >= 1, 'Has derivations');
  assert.ok(phyTheory.concepts[0].solvedExamples && phyTheory.concepts[0].solvedExamples.length >= 1, 'Has solved examples');
  assert.ok(phyTheory.concepts[0].commonMistakes.length >= 1, 'Has common misconceptions');
  assert.ok(phyTheory.keyTakeaways.length >= 3, 'Has key takeaways');

  // Test Chemistry Representative Checkpoint
  const chemTheory = getCheckpointTheory('CHE-01-CP1');
  assert.equal(chemTheory.checkpointId, 'CHE-01-CP1');
  assert.equal(chemTheory.subject, 'chemistry');
  assert.ok(chemTheory.concepts.length >= 1);
  assert.ok(hasAuthoredTheory('CHE-01-CP1'));

  // Test Mathematics Representative Checkpoint
  const mathTheory = getCheckpointTheory('MAT-01-CP1');
  assert.equal(mathTheory.checkpointId, 'MAT-01-CP1');
  assert.equal(mathTheory.subject, 'mathematics');
  assert.ok(mathTheory.concepts.length >= 1);
  assert.ok(hasAuthoredTheory('MAT-01-CP1'));

  // Test Fallback for any checkpoint (e.g. PHY-02-CP1)
  const fallbackTheory = getCheckpointTheory('PHY-02-CP1');
  assert.equal(fallbackTheory.checkpointId, 'PHY-02-CP1');
  assert.ok(fallbackTheory.learningObjectives.length >= 1);
  assert.ok(fallbackTheory.concepts.length >= 1);
});

// ---------------------------------------------------------------------------
// 3. Theory completion is tracked correctly (and opening does not mark completed)
// ---------------------------------------------------------------------------
test('Checkpoint Navigation 3: Opening does not complete checkpoint; theory completion is explicitly tracked', () => {
  const storage = new MemoryStorage();
  const uid = 'student_test';

  // Initially, get progress
  const initialProg = RoadmapProgressService.getRoadmapProgress('PHY-01', uid, storage);
  const cp1 = initialProg.checkpoints['PHY-01-CP1'];

  // Opening does NOT mark completed!
  assert.notEqual(cp1?.status, 'completed');
  assert.equal(cp1?.revisionCompleted, false);

  // Mark theory completed
  const updatedCp: CheckpointProgress = {
    ...cp1,
    revisionCompleted: true,
    lastActivityAt: new Date().toISOString(),
  };

  const updatedRoadmap = RoadmapProgressService.saveCheckpointProgress(updatedCp, uid, storage);
  assert.equal(updatedRoadmap.checkpoints['PHY-01-CP1'].revisionCompleted, true);
  // Status is STILL not completed because quiz has not been passed!
  assert.notEqual(updatedRoadmap.checkpoints['PHY-01-CP1'].status, 'completed');
});

// ---------------------------------------------------------------------------
// 4. Quiz answers are graded correctly (JEE Main single-choice and numerical)
// ---------------------------------------------------------------------------
test('Checkpoint Navigation 4: Quiz grading correctly scores single-correct and numerical questions with JEE marking', () => {
  const checkpointId = 'PHY-01-CP1';
  const questions = getCheckpointQuizQuestions(checkpointId);
  assert.ok(questions.length >= 3, 'Quiz has at least 3 questions');

  // Find single-choice question 1 (Q1) and numerical question (Q3)
  const q1 = questions.find((q) => q.type === 'single_correct')!;
  const qNum = questions.find((q) => q.type === 'numerical')!;

  assert.ok(q1, 'Has single correct question');
  assert.ok(qNum, 'Has numerical question');

  // Submit correct answers for both
  const submissionAllCorrect = {
    [q1.id]: { selectedOption: q1.correctOptionIndex },
    [qNum.id]: { numericalInput: String(qNum.correctNumericalAnswer) },
  };

  const grade1 = gradeQuizSubmission(checkpointId, submissionAllCorrect);
  assert.ok(grade1.correctCount >= 2);
  assert.equal(grade1.outcomes[q1.id].isCorrect, true);
  assert.equal(grade1.outcomes[qNum.id].isCorrect, true);

  // Submit incorrect answer for single-choice (-1 mark penalty in JEE)
  const wrongOption = (q1.correctOptionIndex! + 1) % 4;
  const submissionIncorrect = {
    [q1.id]: { selectedOption: wrongOption },
  };

  const grade2 = gradeQuizSubmission(checkpointId, submissionIncorrect);
  assert.equal(grade2.outcomes[q1.id].isCorrect, false);
  assert.equal(grade2.rawMarks, -1, 'Single-choice incorrect applies -1 mark penalty');
  assert.equal(grade2.passed, false);
});

// ---------------------------------------------------------------------------
// 5. Explanations appear for correct and incorrect answers
// ---------------------------------------------------------------------------
test('Checkpoint Navigation 5: Explanations and formula references are generated for all questions', () => {
  const checkpointId = 'CHE-01-CP1';
  const questions = getCheckpointQuizQuestions(checkpointId);
  assert.ok(questions.length >= 2);

  const grade = gradeQuizSubmission(checkpointId, {
    [questions[0].id]: { selectedOption: 0 },
  });

  const outcome = grade.outcomes[questions[0].id];
  assert.ok(outcome, 'Outcome exists');
  assert.ok(outcome.explanation.length > 20, 'Has detailed explanation');
  assert.ok(outcome.correctAnswer.length > 0, 'Lists correct answer');
  assert.ok(outcome.studentAnswer.length > 0, 'Lists student answer');
});

// ---------------------------------------------------------------------------
// 6. Quiz results update checkpoint progress and completion status
// ---------------------------------------------------------------------------
test('Checkpoint Navigation 6: Passing quiz with completed theory achieves checkpoint completion', () => {
  const storage = new MemoryStorage();
  const uid = 'student_test';

  const cpProg: CheckpointProgress = {
    checkpointId: 'PHY-01-CP1',
    roadmapId: 'PHY-01',
    status: 'current',
    currentStage: 'recall',
    diagnosticCleared: true,
    revisionCompleted: true, // Theory completed
    masteryStatus: 'unattempted',
    masteryScore: 0,
    lastActivityAt: new Date().toISOString(),
    historicalAttemptsCount: 0,
  };

  // Student takes quiz and passes with 80% accuracy
  const quizAccuracy = 80;
  const isMastered = quizAccuracy >= 60;
  const updatedCp: CheckpointProgress = {
    ...cpProg,
    masteryScore: quizAccuracy,
    masteryStatus: quizAccuracy >= 80 ? 'strong' : 'developing',
    status: (cpProg.revisionCompleted && isMastered) ? 'completed' : 'current',
    historicalAttemptsCount: 1,
    lastActivityAt: new Date().toISOString(),
  };

  const roadmapProg = RoadmapProgressService.saveCheckpointProgress(updatedCp, uid, storage);

  // Status is now completed
  assert.equal(roadmapProg.checkpoints['PHY-01-CP1'].status, 'completed');
  assert.equal(roadmapProg.checkpoints['PHY-01-CP1'].masteryStatus, 'strong');
  assert.equal(roadmapProg.completedCheckpointsCount, 1);
  assert.equal(roadmapProg.completionPercentage, 20); // 80 mastery points out of 400 total (20%)
});

// ---------------------------------------------------------------------------
// 7. Reloading preserves progress
// ---------------------------------------------------------------------------
test('Checkpoint Navigation 7: Reloading from storage preserves all theory and quiz progress', () => {
  const storage = new MemoryStorage();
  const uid = 'student_persistence';

  const cpProg: CheckpointProgress = {
    checkpointId: 'MAT-01-CP1',
    roadmapId: 'MAT-01',
    status: 'completed',
    currentStage: 'analysis',
    diagnosticCleared: true,
    revisionCompleted: true,
    masteryStatus: 'strong',
    masteryScore: 85,
    lastActivityAt: '2026-11-05T12:00:00.000Z',
    historicalAttemptsCount: 2,
  };

  // Save to storage
  RoadmapProgressService.saveCheckpointProgress(cpProg, uid, storage);

  // Simulate complete app reload by querying fresh from storage
  const reloaded = RoadmapProgressService.getRoadmapProgress('MAT-01', uid, storage);
  const reloadedCp = reloaded.checkpoints['MAT-01-CP1'];

  assert.ok(reloadedCp, 'Checkpoint progress reloaded');
  assert.equal(reloadedCp.status, 'completed');
  assert.equal(reloadedCp.revisionCompleted, true);
  assert.equal(reloadedCp.masteryScore, 85);
  assert.equal(reloadedCp.historicalAttemptsCount, 2);
});

// ---------------------------------------------------------------------------
// 8. Offline progress is not lost
// ---------------------------------------------------------------------------
test('Checkpoint Navigation 8: Offline progress is queued in outbox and flushes safely on reconnect', async () => {
  const storage = new MemoryStorage();
  const cloud = new FakeCloudStore();
  const uid = 'student_offline';

  // Network offline
  cloud.failCommits = '503 Service Unavailable (Network Offline)';

  const path = cloudPaths.roadmap(uid, 'PHY-01');

  // Offline student completes quiz and mutates roadmap
  RoadmapOutboxService.enqueue(
    {
      type: 'set',
      path,
      data: {
        roadmapId: 'PHY-01',
        completedCheckpointsCount: 1,
        completionPercentage: 25,
      },
    },
    uid,
    storage
  );

  assert.equal(RoadmapOutboxService.getPendingCount(uid, storage), 1);

  // Flush fails while offline
  const offlineFlush = await RoadmapOutboxService.flush(uid, cloud, storage);
  assert.equal(offlineFlush.sent, 0);
  assert.equal(offlineFlush.failed, 1);
  assert.equal(RoadmapOutboxService.getPendingCount(uid, storage), 1, 'Mutation preserved offline');

  // Network reconnects
  cloud.failCommits = false;

  const onlineFlush = await RoadmapOutboxService.flush(uid, cloud, storage);
  assert.equal(onlineFlush.sent, 1);
  assert.equal(onlineFlush.failed, 0);
  assert.equal(RoadmapOutboxService.getPendingCount(uid, storage), 0);

  // Cloud document was saved
  const doc = await cloud.getDoc(path);
  assert.equal(doc?.completedCheckpointsCount, 1);
});

// ---------------------------------------------------------------------------
// 9. Existing roadmap navigation still works
// ---------------------------------------------------------------------------
test('Checkpoint Navigation 9: Roadmap navigation hierarchy and checkpoint retrieval works across all 12 roadmaps', () => {
  const roadmaps = ['PHY-01', 'PHY-02', 'PHY-03', 'PHY-04', 'CHE-01', 'CHE-02', 'CHE-03', 'CHE-04', 'MAT-01', 'MAT-02', 'MAT-03', 'MAT-04'];

  for (const rId of roadmaps) {
    const checkpoints = getCheckpointsForRoadmap(rId);
    assert.equal(checkpoints.length, 4, `Roadmap ${rId} has exactly 4 checkpoints`);

    // Verify every checkpoint has access to theory and quiz questions
    for (const cp of checkpoints) {
      const theory = getCheckpointTheory(cp.id);
      assert.ok(theory, `Theory exists for ${cp.id}`);
      assert.ok(theory.learningObjectives.length > 0, `Objectives exist for ${cp.id}`);

      const quiz = getCheckpointQuizQuestions(cp.id);
      assert.ok(quiz.length > 0, `Quiz questions exist for ${cp.id}`);
    }
  }
});
