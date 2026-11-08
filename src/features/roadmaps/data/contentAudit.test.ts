import test from 'node:test';
import assert from 'node:assert/strict';
import { auditCheckpointContent, auditCatalogueContent } from './contentAudit';
import { getCheckpointById } from './checkpointRegistry';
import { PHY01_DRAFT_PRACTICE_QUESTIONS } from './draftContent/phy01DraftContent';

test('contentAudit: PHY-01 checkpoints achieve high readiness with draft practice pipeline', () => {
  const cp1 = getCheckpointById('PHY-01-CP1')!;
  assert.ok(cp1);

  const audit1 = auditCheckpointContent(cp1);
  assert.ok(audit1.readinessScorePct >= 85);
  // Pilot readiness integrity: < 5 verified assessment questions means student cannot complete journey for pilot
  assert.equal(audit1.canStudentCompleteJourney, false);
  // Verified questions must be genuinely verified, not fabricated from unreviewed schemas
  assert.equal(audit1.verifiedQuestionsCount, 0);
  assert.ok(audit1.pendingReviewQuestionsCount >= 10);
  assert.equal(audit1.readinessStatus, 'internal_validation_only');
});

test('contentAudit: catalogue audit reports on all 48 checkpoints across 3 subjects', () => {
  const catalogueReport = auditCatalogueContent();

  assert.equal(catalogueReport.totalCheckpointsCount, 48);
  assert.equal(catalogueReport.checkpoints.length, 48);
  assert.equal(catalogueReport.pilotRoadmapId, 'PHY-01');
  assert.ok(catalogueReport.pilotRoadmapReadinessScorePct >= 70);
  assert.equal(catalogueReport.pilotRoadmapEligibility, 'internal_validation_only');
  assert.equal(catalogueReport.totalReadyCheckpointsCount, 0);
  assert.equal(catalogueReport.totalInternalValidationCheckpointsCount, 6);
  assert.equal(catalogueReport.totalContentUnavailableCheckpointsCount, 42);

  assert.equal(catalogueReport.subjectBreakdown.physics.totalCheckpoints, 16);
  assert.equal(catalogueReport.subjectBreakdown.chemistry.totalCheckpoints, 16);
  assert.equal(catalogueReport.subjectBreakdown.mathematics.totalCheckpoints, 16);
});

test('contentAudit: authenticity policy - draft practice questions carry pending_review and original author license', () => {
  assert.ok(PHY01_DRAFT_PRACTICE_QUESTIONS.length >= 12);

  for (const q of PHY01_DRAFT_PRACTICE_QUESTIONS) {
    // 1. Must NEVER be labeled as verified
    assert.equal(q.provenance.verificationStatus, 'pending_review');
    // 2. Must NEVER be labeled as official PYQ without examSession
    assert.equal(q.provenance.sourceType, 'original_author');
    assert.equal(q.provenance.licenseOrRights, 'learnmate_original');
    // 3. Must have valid syllabus tags
    assert.ok(q.chapterId.startsWith('physics.'));
    assert.ok(q.topicId.startsWith('physics.'));
    assert.ok(q.unitNumber >= 1 && q.unitNumber <= 5);
    // 4. Must provide educational hint and step-by-step mathematical explanation
    assert.ok(q.hint.length >= 15);
    assert.ok(q.explanation.length >= 25);
    assert.ok(q.errorClassification);
  }
});
