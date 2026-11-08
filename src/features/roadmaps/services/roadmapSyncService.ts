import type {
  AssessmentAttemptResult,
  CheckpointProgress,
  RevisionItem,
  RoadmapProgress,
  StageScore,
} from '../types/progress.types';
import type { PracticeTier } from '../types/checkpoint.types';
import type { RoadmapId } from '../types/roadmap.types';
import {
  cloudPaths,
  type CloudData,
  type CloudDocStore,
  type CloudWriteOp,
} from '../../../services/cloudStore';
import {
  STORAGE_KEYS,
  scopedKey,
  scopeForUid,
  type KeyValueStorage,
} from '../../../services/localScope';
import { ALL_ROADMAPS, getRoadmapById } from '../data/roadmaps';
import { getCheckpointsForRoadmap } from '../data/checkpointRegistry';
import { computeRoadmapCompletion } from '../engine/progressionEngine';
import { RoadmapProgressService } from './roadmapProgressService';
import { RoadmapOutboxService } from './roadmapOutboxService';

/** Stable JSON helper for deterministic tie-breaking across devices. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((v) => (v === undefined ? 'null' : canonicalJson(v))).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000; // 5 minutes drift allowance

/**
 * Normalizes an ISO timestamp string to a canonical ISO-8601 string representation.
 * Clamps future timestamps exceeding drift allowance to referenceNow.
 * Handles missing and invalid timestamps deterministically.
 */
export function normalizeTimestamp(isoStr?: string, referenceNowMs: number = Date.now()): string {
  if (!isoStr) return new Date(0).toISOString();
  const t = new Date(isoStr).getTime();
  if (isNaN(t) || t <= 0) return new Date(0).toISOString();
  if (t > referenceNowMs + MAX_FUTURE_SKEW_MS) {
    return new Date(referenceNowMs).toISOString();
  }
  return new Date(t).toISOString();
}

/**
 * Sanitizes a timestamp against excessive future clock skew.
 * If a device timestamp is ahead of referenceNow + 5 minutes, clamp to referenceNow.
 */
export function sanitizeTimestamp(isoStr?: string, referenceNowMs: number = Date.now()): number {
  if (!isoStr) return 0;
  const t = new Date(isoStr).getTime();
  if (isNaN(t)) return 0;
  if (t > referenceNowMs + MAX_FUTURE_SKEW_MS) {
    return referenceNowMs;
  }
  return t;
}

// ============================================================================
// Encoders & Decoders (Firestore Schema V1)
// ============================================================================

export function encodeRoadmapProgressDoc(uid: string, progress: RoadmapProgress): CloudData {
  return {
    roadmapId: progress.roadmapId,
    uid,
    completionPercentage: Math.max(0, Math.min(100, Math.round(progress.completionPercentage))),
    completedCheckpointsCount: Math.max(0, Math.min(4, progress.completedCheckpointsCount)),
    currentCheckpointId: progress.currentCheckpointId || '',
    checkpointsJson: JSON.stringify(progress.checkpoints),
    lastActivityAt: progress.lastActivityAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export function decodeRoadmapProgressDoc(data: CloudData): RoadmapProgress | null {
  if (!data || typeof data !== 'object') return null;
  const roadmapId = data.roadmapId as RoadmapId;
  if (!roadmapId || typeof data.checkpointsJson !== 'string') return null;

  try {
    const checkpoints = JSON.parse(data.checkpointsJson) as Record<string, CheckpointProgress>;
    return {
      roadmapId,
      completionPercentage: typeof data.completionPercentage === 'number' ? data.completionPercentage : 0,
      completedCheckpointsCount: typeof data.completedCheckpointsCount === 'number' ? data.completedCheckpointsCount : 0,
      currentCheckpointId: typeof data.currentCheckpointId === 'string' ? data.currentCheckpointId : '',
      checkpoints,
      lastActivityAt: typeof data.lastActivityAt === 'string' ? data.lastActivityAt : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export function encodeRevisionItemDoc(uid: string, item: RevisionItem): CloudData {
  return {
    id: item.id,
    uid,
    topicId: item.topicId,
    topicName: item.topicName,
    roadmapId: item.roadmapId,
    checkpointId: item.checkpointId,
    scheduledForDate: item.scheduledForDate,
    intervalStep: item.intervalStep,
    status: item.status,
    consecutiveMasteryCount: item.consecutiveMasteryCount,
    priority: item.priority,
    reason: item.reason,
    lastRevisedAt: item.lastRevisedAt ?? null,
    updatedAt: new Date().toISOString(),
  };
}

export function decodeRevisionItemDoc(data: CloudData): RevisionItem | null {
  if (!data || typeof data !== 'object') return null;
  if (
    typeof data.id !== 'string' ||
    typeof data.topicId !== 'string' ||
    typeof data.roadmapId !== 'string' ||
    typeof data.checkpointId !== 'string' ||
    typeof data.scheduledForDate !== 'string' ||
    typeof data.intervalStep !== 'number'
  ) {
    return null;
  }

  return {
    id: data.id,
    topicId: data.topicId,
    topicName: (data.topicName as string) || data.topicId,
    roadmapId: data.roadmapId as RoadmapId,
    checkpointId: data.checkpointId,
    scheduledForDate: data.scheduledForDate,
    intervalStep: data.intervalStep,
    status: (data.status as RevisionItem['status']) || 'upcoming',
    consecutiveMasteryCount: typeof data.consecutiveMasteryCount === 'number' ? data.consecutiveMasteryCount : 0,
    priority: (data.priority as RevisionItem['priority']) || 'medium',
    reason: (data.reason as string) || 'Spaced review',
    lastRevisedAt: typeof data.lastRevisedAt === 'string' ? data.lastRevisedAt : undefined,
  };
}

export function encodeRoadmapAttemptDoc(
  uid: string,
  result: AssessmentAttemptResult,
  checkpointId: string,
  roadmapId: RoadmapId
): CloudData {
  return {
    id: result.attemptId,
    uid,
    checkpointId,
    roadmapId,
    percentage: Math.max(0, Math.min(100, Math.round(result.percentage))),
    rawMarks: result.rawMarks,
    totalMarks: result.totalMarks,
    correctCount: result.correctCount,
    incorrectCount: result.incorrectCount,
    unansweredCount: result.unansweredCount,
    timeTakenSeconds: result.timeTakenSeconds,
    completedAt: result.completedAt || new Date().toISOString(),
    attemptJson: JSON.stringify(result),
    updatedAt: new Date().toISOString(),
  };
}

// ============================================================================
// Conflict-Resolution Logic (Deterministic, Temporal, Associative, Evidence-Preserving)
// ============================================================================

/** Helper to deterministically merge StageScore with per-field temporal provenance */
export function mergeStageScore(
  a?: StageScore,
  b?: StageScore,
  referenceNowMs: number = Date.now()
): StageScore | undefined {
  if (!a && b) return b;
  if (a && !b) return a;
  if (!a && !b) return undefined;
  const timeA = sanitizeTimestamp(a!.completedAt, referenceNowMs);
  const timeB = sanitizeTimestamp(b!.completedAt, referenceNowMs);
  if (timeA > timeB) return a;
  if (timeB > timeA) return b;
  return canonicalJson(a) >= canonicalJson(b) ? a : b;
}

/** Helper to deterministically merge practice statistics */
export function mergePracticeStats(
  a?: CheckpointProgress['practiceStats'],
  b?: CheckpointProgress['practiceStats'],
  referenceNowMs: number = Date.now()
): CheckpointProgress['practiceStats'] | undefined {
  if (!a && b) return b;
  if (a && !b) return a;
  if (!a && !b) return undefined;

  const timeA = sanitizeTimestamp(a!.lastPracticedAt, referenceNowMs);
  const timeB = sanitizeTimestamp(b!.lastPracticedAt, referenceNowMs);

  const tierOrder: Record<PracticeTier, number> = { foundation: 1, application: 2, jee_main: 3 };
  const highestTierUnlocked: PracticeTier =
    (tierOrder[a!.highestTierUnlocked] ?? 1) >= (tierOrder[b!.highestTierUnlocked] ?? 1)
      ? a!.highestTierUnlocked
      : b!.highestTierUnlocked;

  const winningLastPracticedAt =
    timeA > timeB
      ? a!.lastPracticedAt
      : timeB > timeA
      ? b!.lastPracticedAt
      : canonicalJson(a) >= canonicalJson(b)
      ? a!.lastPracticedAt
      : b!.lastPracticedAt;

  return {
    attempted: Math.max(a!.attempted, b!.attempted),
    correct: Math.max(a!.correct, b!.correct),
    highestTierUnlocked,
    lastPracticedAt: winningLastPracticedAt,
  };
}

/** Helper to deterministically merge AssessmentAttemptResult */
export function mergeAssessmentResult(
  a?: AssessmentAttemptResult,
  b?: AssessmentAttemptResult,
  referenceNowMs: number = Date.now()
): AssessmentAttemptResult | undefined {
  if (!a && b) return b;
  if (a && !b) return a;
  if (!a && !b) return undefined;
  const timeA = sanitizeTimestamp(a!.completedAt, referenceNowMs);
  const timeB = sanitizeTimestamp(b!.completedAt, referenceNowMs);
  if (timeA > timeB) return a;
  if (timeB > timeA) return b;
  return canonicalJson(a) >= canonicalJson(b) ? a : b;
}

/**
 * Merges two versions of a checkpoint's progress without losing attempt evidence,
 * without letting an old completed state overwrite newer weak evidence,
 * with protection against future clock skew, and with strict algebraic associativity
 * across sparse records from multiple devices.
 */
export function mergeCheckpointProgress(
  local?: CheckpointProgress,
  remote?: CheckpointProgress,
  referenceNowMs: number = Date.now()
): CheckpointProgress {
  if (!local && remote) return remote;
  if (local && !remote) return local;
  if (!local && !remote) {
    throw new Error('mergeCheckpointProgress called with no progress records.');
  }

  const loc = local!;
  const rem = remote!;

  // 1. Per-field deterministic provenance for optional scores
  const diagnosticScore = mergeStageScore(loc.diagnosticScore, rem.diagnosticScore, referenceNowMs);
  const activeRecallScore = mergeStageScore(loc.activeRecallScore, rem.activeRecallScore, referenceNowMs);
  const practiceStats = mergePracticeStats(loc.practiceStats, rem.practiceStats, referenceNowMs);
  const assessmentResult = mergeAssessmentResult(loc.assessmentResult, rem.assessmentResult, referenceNowMs);

  // 2. Monotonic non-destructive flags (strictly associative)
  const diagnosticCleared = Boolean(loc.diagnosticCleared || rem.diagnosticCleared);
  const revisionCompleted = Boolean(loc.revisionCompleted || rem.revisionCompleted);

  // 3. Historical attempt counter monotonicity (strictly associative)
  const historicalAttemptsCount = Math.max(
    loc.historicalAttemptsCount || 0,
    rem.historicalAttemptsCount || 0,
    assessmentResult ? 1 : 0
  );

  // 4. Activity timestamp ordering & skew protection
  const locTime = sanitizeTimestamp(loc.lastActivityAt, referenceNowMs);
  const remTime = sanitizeTimestamp(rem.lastActivityAt, referenceNowMs);
  let winningLastActivity: string;
  let isLocNewer = false;
  if (locTime > remTime) {
    winningLastActivity = loc.lastActivityAt;
    isLocNewer = true;
  } else if (remTime > locTime) {
    winningLastActivity = rem.lastActivityAt;
    isLocNewer = false;
  } else {
    // Equal timestamp: deterministic tie-break
    const tieLocWins = canonicalJson(loc) >= canonicalJson(rem);
    winningLastActivity = tieLocWins ? loc.lastActivityAt : rem.lastActivityAt;
    isLocNewer = tieLocWins;
  }

  const lastActivityAt =
    sanitizeTimestamp(winningLastActivity, referenceNowMs) === referenceNowMs &&
    new Date(winningLastActivity || 0).getTime() > referenceNowMs + MAX_FUTURE_SKEW_MS
      ? new Date(referenceNowMs).toISOString()
      : winningLastActivity || new Date(referenceNowMs).toISOString();

  // 5. Evidence Preservation & Mastery Evaluation:
  // If an assessment result exists, the record providing the winning assessment result
  // determines masteryStatus, masteryScore, and the base status.
  let masteryStatus: CheckpointProgress['masteryStatus'];
  let masteryScore: number;
  let status: CheckpointProgress['status'];
  let currentStage: CheckpointProgress['currentStage'];
  let nextRevisionDue: string | undefined;

  const locHasWinningAssessment =
    assessmentResult && loc.assessmentResult && loc.assessmentResult.attemptId === assessmentResult.attemptId;
  const remHasWinningAssessment =
    assessmentResult && rem.assessmentResult && rem.assessmentResult.attemptId === assessmentResult.attemptId;

  if (locHasWinningAssessment && !remHasWinningAssessment) {
    masteryStatus = loc.masteryStatus;
    masteryScore = loc.masteryScore;
    status = loc.status;
    currentStage = 'assessment';
    nextRevisionDue = loc.nextRevisionDue;
  } else if (remHasWinningAssessment && !locHasWinningAssessment) {
    masteryStatus = rem.masteryStatus;
    masteryScore = rem.masteryScore;
    status = rem.status;
    currentStage = 'assessment';
    nextRevisionDue = rem.nextRevisionDue;
  } else if (locHasWinningAssessment && remHasWinningAssessment) {
    const chosen = isLocNewer ? loc : rem;
    masteryStatus = chosen.masteryStatus;
    masteryScore = chosen.masteryScore;
    status = chosen.status;
    currentStage = 'assessment';
    nextRevisionDue = chosen.nextRevisionDue ?? (isLocNewer ? rem.nextRevisionDue : loc.nextRevisionDue);
  } else {
    // Neither record has an assessment attempt: base values come from temporally newer record
    // If one record has real activity/evidence while the other is completely untouched/unattempted,
    // the active record's base progress must never be downgraded by the empty unattempted record.
    const locHasEvidence = Boolean(
      loc.diagnosticCleared ||
      loc.revisionCompleted ||
      loc.diagnosticScore ||
      loc.activeRecallScore ||
      loc.practiceStats ||
      loc.masteryStatus !== 'unattempted' ||
      loc.masteryScore > 0 ||
      loc.historicalAttemptsCount > 0 ||
      loc.status === 'completed' ||
      loc.status === 'revision_due'
    );
    const remHasEvidence = Boolean(
      rem.diagnosticCleared ||
      rem.revisionCompleted ||
      rem.diagnosticScore ||
      rem.activeRecallScore ||
      rem.practiceStats ||
      rem.masteryStatus !== 'unattempted' ||
      rem.masteryScore > 0 ||
      rem.historicalAttemptsCount > 0 ||
      rem.status === 'completed' ||
      rem.status === 'revision_due'
    );

    let newerRecord = isLocNewer ? loc : rem;
    let olderRecord = isLocNewer ? rem : loc;

    if (!locHasEvidence && remHasEvidence) {
      newerRecord = rem;
      olderRecord = loc;
    } else if (locHasEvidence && !remHasEvidence) {
      newerRecord = loc;
      olderRecord = rem;
    }

    masteryStatus = newerRecord.masteryStatus;
    masteryScore = newerRecord.masteryScore;
    currentStage = newerRecord.currentStage;
    nextRevisionDue = newerRecord.nextRevisionDue ?? olderRecord.nextRevisionDue;

    // Retain completed status if either record completed
    if (loc.status === 'completed' || rem.status === 'completed') {
      status = 'completed';
    } else {
      status = newerRecord.status;
    }
  }

  // Spaced revision override: if either record has revision_due with a newer activity than the assessment
  const winningAssessmentTime = assessmentResult ? sanitizeTimestamp(assessmentResult.completedAt, referenceNowMs) : 0;
  if (loc.status === 'revision_due' && locTime >= winningAssessmentTime) {
    status = 'revision_due';
  } else if (rem.status === 'revision_due' && remTime >= winningAssessmentTime) {
    status = 'revision_due';
  }

  // Internal Validation Isolation:
  // Preserves lastInternalValidationAttempt deterministically without allowing it to
  // mutate normal assessmentResult, learner mastery, or checkpoint completion status.
  let lastInternalValidationAttempt: AssessmentAttemptResult | undefined;
  if (loc.lastInternalValidationAttempt && rem.lastInternalValidationAttempt) {
    const locIvTime = sanitizeTimestamp(loc.lastInternalValidationAttempt.completedAt, referenceNowMs);
    const remIvTime = sanitizeTimestamp(rem.lastInternalValidationAttempt.completedAt, referenceNowMs);
    lastInternalValidationAttempt = locIvTime >= remIvTime ? loc.lastInternalValidationAttempt : rem.lastInternalValidationAttempt;
  } else {
    lastInternalValidationAttempt = loc.lastInternalValidationAttempt ?? rem.lastInternalValidationAttempt;
  }

  return {
    checkpointId: loc.checkpointId || rem.checkpointId,
    roadmapId: loc.roadmapId || rem.roadmapId,
    status,
    currentStage,
    diagnosticCleared,
    diagnosticScore,
    revisionCompleted,
    activeRecallScore,
    practiceStats,
    assessmentResult,
    masteryStatus,
    masteryScore,
    lastActivityAt,
    nextRevisionDue,
    historicalAttemptsCount,
    lastInternalValidationAttempt,
  };
}

/**
 * Merges local and remote RoadmapProgress deterministically.
 */
export function mergeRoadmapProgress(
  local: RoadmapProgress,
  remote: RoadmapProgress,
  referenceNowMs: number = Date.now()
): RoadmapProgress {
  const roadmapId = local.roadmapId;
  const roadmap = getRoadmapById(roadmapId);
  const checkpoints = getCheckpointsForRoadmap(roadmapId);

  const mergedCheckpoints: Record<string, CheckpointProgress> = {};
  const allCheckpointIds = new Set([
    ...Object.keys(local.checkpoints || {}),
    ...Object.keys(remote.checkpoints || {}),
  ]);

  for (const cpId of allCheckpointIds) {
    const locCp = local.checkpoints?.[cpId];
    const remCp = remote.checkpoints?.[cpId];
    mergedCheckpoints[cpId] = mergeCheckpointProgress(locCp, remCp, referenceNowMs);
  }

  // Recalculate roadmap completion strictly using progression engine
  let completionPercentage = 0;
  let completedCount = 0;
  let currentCheckpointId: string;

  if (roadmap) {
    const computed = computeRoadmapCompletion(roadmap, checkpoints, mergedCheckpoints);
    completionPercentage =
      computed.completionPercentage > 0
        ? computed.completionPercentage
        : Math.max(local.completionPercentage || 0, remote.completionPercentage || 0);
    completedCount =
      computed.completedCount > 0
        ? computed.completedCount
        : Math.max(local.completedCheckpointsCount || 0, remote.completedCheckpointsCount || 0);

    if (computed.currentCheckpointId) {
      currentCheckpointId = computed.currentCheckpointId;
    } else if (local.currentCheckpointId && remote.currentCheckpointId) {
      // Deterministic symmetric tie-break between differing checkpoint IDs
      currentCheckpointId =
        local.currentCheckpointId <= remote.currentCheckpointId
          ? local.currentCheckpointId
          : remote.currentCheckpointId;
    } else {
      currentCheckpointId = local.currentCheckpointId || remote.currentCheckpointId || '';
    }
  } else {
    currentCheckpointId =
      local.currentCheckpointId && remote.currentCheckpointId
        ? local.currentCheckpointId <= remote.currentCheckpointId
          ? local.currentCheckpointId
          : remote.currentCheckpointId
        : local.currentCheckpointId || remote.currentCheckpointId || '';
  }

  // Canonical ISO timestamp comparison for strictly symmetric output
  const normLoc = normalizeTimestamp(local.lastActivityAt, referenceNowMs);
  const normRem = normalizeTimestamp(remote.lastActivityAt, referenceNowMs);

  let winningLastActivity: string;
  if (normLoc > normRem) {
    winningLastActivity = normLoc;
  } else if (normRem > normLoc) {
    winningLastActivity = normRem;
  } else {
    // Exactly equal instants: deterministic symmetric tie-breaker
    winningLastActivity = normLoc;
  }

  // Fallback to referenceNow if both were missing or epoch-zero
  const lastActivityAt =
    winningLastActivity === new Date(0).toISOString()
      ? new Date(referenceNowMs).toISOString()
      : winningLastActivity;

  return {
    roadmapId,
    completionPercentage,
    completedCheckpointsCount: completedCount,
    currentCheckpointId,
    checkpoints: mergedCheckpoints,
    lastActivityAt,
  };
}

/**
 * Merges local and remote revision queues, eliminating duplicates and
 * ensuring deterministic order by scheduledForDate and priority.
 */
export function mergeRevisionQueues(
  local: readonly RevisionItem[],
  remote: readonly RevisionItem[],
  referenceNowMs: number = Date.now()
): RevisionItem[] {
  const map = new Map<string, RevisionItem>();

  const processItem = (item: RevisionItem) => {
    // Unique key per subtopic checkpoint combination
    const key = `${item.checkpointId}:${item.topicId}`;
    const existing = map.get(key);

    if (!existing) {
      map.set(key, item);
      return;
    }

    // Determine which item wins:
    // 1. If one has newer lastRevisedAt, that recent activity takes precedence
    const itemRevTime = sanitizeTimestamp(item.lastRevisedAt, referenceNowMs);
    const existRevTime = sanitizeTimestamp(existing.lastRevisedAt, referenceNowMs);

    if (itemRevTime > existRevTime) {
      map.set(key, { ...item, id: existing.id }); // Preserve stable ID
      return;
    }
    if (existRevTime > itemRevTime) {
      return;
    }

    // 2. Active item scheduled later or with higher intervalStep
    if (item.intervalStep > existing.intervalStep) {
      map.set(key, { ...item, id: existing.id });
      return;
    }
    if (existing.intervalStep > item.intervalStep) {
      return;
    }

    // 3. Tie-break with canonicalJson
    if (canonicalJson(item) > canonicalJson(existing)) {
      map.set(key, { ...item, id: existing.id });
    }
  };

  for (const item of local) processItem(item);
  for (const item of remote) processItem(item);

  const merged = Array.from(map.values());
  merged.sort((a, b) => a.scheduledForDate.localeCompare(b.scheduledForDate));
  return merged;
}

export interface GuestMigrationBackup {
  targetUid: string;
  migratedAt: string;
  guestRoadmaps: Record<string, RoadmapProgress>;
  guestQueue: RevisionItem[];
  status: 'pending_cloud_sync' | 'confirmed';
}

// ============================================================================
// Sync Orchestrator
// ============================================================================

export class RoadmapSyncService {
  private static syncingUids = new Set<string>();
  private static activeSyncPromises = new Map<string, Promise<{ synchedRoadmaps: number; synchedRevisionItems: number }>>();
  private static pendingFollowUpSyncUids = new Set<string>();

  /** Returns true if a full cloud sync is currently executing for the user. */
  static isSyncing(uid: string): boolean {
    return this.syncingUids.has(uid);
  }

  /**
   * Synchronizes an authenticated user's roadmap progress and revision queues
   * between local storage and Firestore.
   * Concurrency-guarded: allows only one active sync per UID at a time.
   * Queues a follow-up sync if another sync request arrives while active.
   */
  static async syncRoadmapsWithCloud(
    uid: string,
    cloud: CloudDocStore,
    customStorage?: KeyValueStorage
  ): Promise<{ synchedRoadmaps: number; synchedRevisionItems: number }> {
    if (!uid) {
      return { synchedRoadmaps: 0, synchedRevisionItems: 0 };
    }

    // Per-UID concurrency guard: register follow-up and await active execution
    if (this.syncingUids.has(uid)) {
      this.pendingFollowUpSyncUids.add(uid);
      const active = this.activeSyncPromises.get(uid);
      if (active) return active;
      return { synchedRoadmaps: 0, synchedRevisionItems: 0 };
    }

    const syncExecution = (async () => {
      this.syncingUids.add(uid);
      let totalRoadmaps = 0;
      let totalRevisions = 0;

      try {
        let shouldContinue = true;
        while (shouldContinue) {
          this.pendingFollowUpSyncUids.delete(uid);

          // 1. Flush any pending outbox mutations first
          await RoadmapOutboxService.flush(uid, cloud, customStorage).catch((err) =>
            console.warn('[RoadmapSyncService] Outbox flush before sync warning:', err)
          );

          // 2. Fetch remote roadmaps and revision items
          const [remoteRoadmapEntries, remoteQueueEntries] = await Promise.all([
            cloud.listCollection(cloudPaths.roadmaps(uid)),
            cloud.listCollection(cloudPaths.roadmapRevisionQueue(uid)),
          ]);

          const remoteRoadmapsMap = new Map<string, RoadmapProgress>();
          for (const entry of remoteRoadmapEntries) {
            const decoded = decodeRoadmapProgressDoc(entry.data);
            if (decoded) remoteRoadmapsMap.set(decoded.roadmapId, decoded);
          }

          const remoteQueue: RevisionItem[] = [];
          for (const entry of remoteQueueEntries) {
            const decoded = decodeRevisionItemDoc(entry.data);
            if (decoded) remoteQueue.push(decoded);
          }

          // 3. Load local roadmaps and queue
          const localRoadmaps = RoadmapProgressService.getAllRoadmapsProgress(uid, customStorage);
          const localQueue = RoadmapProgressService.getRevisionQueue(uid, customStorage);

          // 4. Merge roadmaps
          const mergedRoadmaps: Record<string, RoadmapProgress> = { ...localRoadmaps };
          const writeOps: CloudWriteOp[] = [];

          // All 12 roadmaps
          for (const r of ALL_ROADMAPS) {
            const localProg = localRoadmaps[r.id];
            const remoteProg = remoteRoadmapsMap.get(r.id);

            if (localProg && remoteProg) {
              const merged = mergeRoadmapProgress(localProg, remoteProg);
              mergedRoadmaps[r.id] = merged;
              // Avoid redundant writes: only write if merged differs from remote
              if (canonicalJson(merged) !== canonicalJson(remoteProg)) {
                writeOps.push({
                  type: 'set',
                  path: cloudPaths.roadmap(uid, r.id),
                  data: encodeRoadmapProgressDoc(uid, merged),
                  merge: true,
                });
              }
            } else if (localProg && !remoteProg) {
              mergedRoadmaps[r.id] = localProg;
              writeOps.push({
                type: 'set',
                path: cloudPaths.roadmap(uid, r.id),
                data: encodeRoadmapProgressDoc(uid, localProg),
                merge: true,
              });
            } else if (!localProg && remoteProg) {
              mergedRoadmaps[r.id] = remoteProg;
            }
          }

          // 5. Merge revision queue
          const mergedQueue = mergeRevisionQueues(localQueue, remoteQueue);
          const remoteQueueMap = new Map(remoteQueue.map((item) => [item.id, item]));
          for (const item of mergedQueue) {
            const remoteItem = remoteQueueMap.get(item.id);
            if (!remoteItem || canonicalJson(item) !== canonicalJson(remoteItem)) {
              writeOps.push({
                type: 'set',
                path: cloudPaths.roadmapRevisionItem(uid, item.id),
                data: encodeRevisionItemDoc(uid, item),
                merge: true,
              });
            }
          }

          // 6. Commit atomic batch to Firestore
          if (writeOps.length > 0) {
            await cloud.commit(writeOps);
          }

          // 7. If guest migration was pending confirmation, confirm it now that cloud acknowledged
          if (customStorage) {
            this.confirmGuestMigration(uid, customStorage);
          } else if (typeof window !== 'undefined' && window.localStorage) {
            this.confirmGuestMigration(uid, window.localStorage);
          }

          // 8. Save merged data locally
          RoadmapProgressService.saveAllRoadmapsProgress(mergedRoadmaps, uid, customStorage);
          RoadmapProgressService.saveRevisionQueue(mergedQueue, uid, customStorage);

          totalRoadmaps = Object.keys(mergedRoadmaps).length;
          totalRevisions = mergedQueue.length;

          shouldContinue = this.pendingFollowUpSyncUids.has(uid);
        }

        return {
          synchedRoadmaps: totalRoadmaps,
          synchedRevisionItems: totalRevisions,
        };
      } finally {
        this.syncingUids.delete(uid);
        this.activeSyncPromises.delete(uid);
      }
    })();

    this.activeSyncPromises.set(uid, syncExecution);
    return syncExecution;
  }

  /**
   * Migrates guest (unauthenticated) roadmap data to an authenticated user account.
   * Crash-safe: preserves guest backup until cloud acknowledges durable synchronization.
   */
  static async migrateGuestRoadmapDataToUser(
    uid: string,
    storage: KeyValueStorage,
    cloud?: CloudDocStore
  ): Promise<{ migratedRoadmaps: number; migratedRevisionItems: number }> {
    if (!uid) return { migratedRoadmaps: 0, migratedRevisionItems: 0 };

    const guestKeyProg = scopedKey('guest', STORAGE_KEYS.ROADMAP_PROGRESS);
    const guestKeyQueue = scopedKey('guest', STORAGE_KEYS.ROADMAP_REVISION_QUEUE);
    const guestKeyBackup = scopedKey('guest', STORAGE_KEYS.ROADMAP_MIGRATION_BACKUP);

    const guestRawProg = storage.getItem(guestKeyProg);
    const guestRawQueue = storage.getItem(guestKeyQueue);
    const existingBackupRaw = storage.getItem(guestKeyBackup);

    // If no active guest keys, check if there's an unconfirmed pending backup for this uid
    if (!guestRawProg && !guestRawQueue) {
      if (existingBackupRaw && cloud) {
        try {
          const backup = JSON.parse(existingBackupRaw) as GuestMigrationBackup;
          if (backup.targetUid === uid && backup.status === 'pending_cloud_sync') {
            await this.syncRoadmapsWithCloud(uid, cloud, storage);
            this.confirmGuestMigration(uid, storage);
          }
        } catch {
          // ignore backup check error
        }
      }
      return { migratedRoadmaps: 0, migratedRevisionItems: 0 };
    }

    // Protection: If an unconfirmed backup exists belonging to a different targetUid, protect it!
    if (existingBackupRaw) {
      try {
        const existingBackup = JSON.parse(existingBackupRaw) as GuestMigrationBackup;
        if (existingBackup.status === 'pending_cloud_sync' && existingBackup.targetUid !== uid) {
          console.warn(
            `[RoadmapSyncService] Refusing to overwrite unconfirmed guest backup for ${existingBackup.targetUid} with ${uid}`
          );
          return { migratedRoadmaps: 0, migratedRevisionItems: 0 };
        }
      } catch {}
    }

    const guestRoadmaps: Record<string, RoadmapProgress> = guestRawProg ? JSON.parse(guestRawProg) : {};
    const guestQueue: RevisionItem[] = guestRawQueue ? JSON.parse(guestRawQueue) : [];

    // Step 1: Create durable migration backup in guest scope before modifying any data
    const backup: GuestMigrationBackup = {
      targetUid: uid,
      migratedAt: new Date().toISOString(),
      guestRoadmaps,
      guestQueue,
      status: 'pending_cloud_sync',
    };
    storage.setItem(guestKeyBackup, JSON.stringify(backup));

    const userRoadmaps = RoadmapProgressService.getAllRoadmapsProgress(uid, storage);
    const userQueue = RoadmapProgressService.getRevisionQueue(uid, storage);

    // Step 2: Merge guest roadmaps into user
    const mergedRoadmaps: Record<string, RoadmapProgress> = { ...userRoadmaps };
    let migratedRoadmapsCount = 0;

    for (const [id, guestProg] of Object.entries(guestRoadmaps)) {
      const existing = userRoadmaps[id];
      if (existing) {
        mergedRoadmaps[id] = mergeRoadmapProgress(existing, guestProg);
      } else {
        mergedRoadmaps[id] = guestProg;
      }
      migratedRoadmapsCount++;
    }

    // Merge queues
    const mergedQueue = mergeRevisionQueues(userQueue, guestQueue);

    // Step 3: Save to user's scope
    RoadmapProgressService.saveAllRoadmapsProgress(mergedRoadmaps, uid, storage);
    RoadmapProgressService.saveRevisionQueue(mergedQueue, uid, storage);

    // Note: Do NOT remove guest keys or backup yet. Only confirm after cloud acknowledges.
    if (cloud) {
      try {
        await this.syncRoadmapsWithCloud(uid, cloud, storage);
        this.confirmGuestMigration(uid, storage);
      } catch (err) {
        console.warn('[RoadmapSyncService] Deferred cloud upload following guest migration:', err);
      }
    }

    return {
      migratedRoadmaps: migratedRoadmapsCount,
      migratedRevisionItems: guestQueue.length,
    };
  }

  /**
   * Confirms guest migration after cloud synchronization succeeds.
   * Safely clears guest keys and marks backup confirmed.
   */
  static confirmGuestMigration(uid: string, storage: KeyValueStorage): void {
    if (!uid) return;
    const guestKeyProg = scopedKey('guest', STORAGE_KEYS.ROADMAP_PROGRESS);
    const guestKeyQueue = scopedKey('guest', STORAGE_KEYS.ROADMAP_REVISION_QUEUE);
    const guestKeyBackup = scopedKey('guest', STORAGE_KEYS.ROADMAP_MIGRATION_BACKUP);

    const backupRaw = storage.getItem(guestKeyBackup);
    if (!backupRaw) return;

    try {
      const backup = JSON.parse(backupRaw) as GuestMigrationBackup;
      if (backup.targetUid === uid) {
        storage.removeItem(guestKeyProg);
        storage.removeItem(guestKeyQueue);
        storage.removeItem(guestKeyBackup);
      }
    } catch {
      storage.removeItem(guestKeyBackup);
    }
  }

  /**
   * Restores guest roadmap data if an unconfirmed migration backup exists.
   * Safe & Idempotent:
   * - Restores only if status is 'pending_cloud_sync'.
   * - Never restores a backup belonging to a different UID (unless forced or matched).
   * - Merges with existing guest progress so newer guest activity is never overwritten.
   * - Cleans up backup only after successful write to guest scope.
   */
  static restoreFromGuestMigrationBackup(
    storage: KeyValueStorage,
    options?: { previousUid?: string | null; force?: boolean }
  ): boolean {
    const guestKeyProg = scopedKey('guest', STORAGE_KEYS.ROADMAP_PROGRESS);
    const guestKeyQueue = scopedKey('guest', STORAGE_KEYS.ROADMAP_REVISION_QUEUE);
    const guestKeyBackup = scopedKey('guest', STORAGE_KEYS.ROADMAP_MIGRATION_BACKUP);

    const backupRaw = storage.getItem(guestKeyBackup);
    if (!backupRaw) return false;

    try {
      const backup = JSON.parse(backupRaw) as GuestMigrationBackup;
      if (backup.status !== 'pending_cloud_sync') {
        return false;
      }

      // Check ownership: never restore a backup belonging to a different authenticated UID
      if (options?.previousUid && backup.targetUid !== options.previousUid && !options?.force) {
        return false;
      }

      // Load existing guest roadmaps (if any new progress was made in guest mode)
      const existingGuestProgRaw = storage.getItem(guestKeyProg);
      const existingGuestProg: Record<string, RoadmapProgress> = existingGuestProgRaw
        ? JSON.parse(existingGuestProgRaw)
        : {};

      // Merge backup into existing guest progress so newer guest progress is never overwritten!
      const mergedRoadmaps: Record<string, RoadmapProgress> = { ...existingGuestProg };
      for (const [rId, backupProg] of Object.entries(backup.guestRoadmaps || {})) {
        const currentProg = existingGuestProg[rId];
        if (currentProg) {
          mergedRoadmaps[rId] = mergeRoadmapProgress(currentProg, backupProg);
        } else {
          mergedRoadmaps[rId] = backupProg;
        }
      }

      // Merge revision queues
      const existingQueueRaw = storage.getItem(guestKeyQueue);
      const existingQueue: RevisionItem[] = existingQueueRaw ? JSON.parse(existingQueueRaw) : [];
      const mergedQueue = mergeRevisionQueues(existingQueue, backup.guestQueue || []);

      // Persist restored data safely to guest scope
      storage.setItem(guestKeyProg, JSON.stringify(mergedRoadmaps));
      storage.setItem(guestKeyQueue, JSON.stringify(mergedQueue));

      // Remove backup only after successfully writing and verifying guest data
      storage.removeItem(guestKeyBackup);
      return true;
    } catch (err) {
      console.warn('[RoadmapSyncService] Error during guest migration backup restore:', err);
      return false;
    }
  }

  /**
   * Pushes a single assessment attempt audit record to the cloud.
   * Enqueues into outbox before attempting cloud commit.
   */
  static async pushAssessmentAttempt(
    uid: string,
    result: AssessmentAttemptResult,
    checkpointId: string,
    roadmapId: RoadmapId,
    cloud: CloudDocStore,
    storage?: KeyValueStorage
  ): Promise<void> {
    if (!uid) return;
    const path = cloudPaths.roadmapAttempt(uid, result.attemptId);
    const data = encodeRoadmapAttemptDoc(uid, result, checkpointId, roadmapId);

    // Persist to outbox locally before network call
    try {
      RoadmapOutboxService.enqueue(
        {
          type: 'set',
          path,
          data,
          merge: false, // Immutable attempt
        },
        uid,
        storage
      );
    } catch (err) {
      // Local disk persistence failed: attempt direct cloud commit to salvage attempt
      if (cloud) {
        await cloud.commit([{ type: 'set', path, data, merge: false }]);
        return;
      }
      throw err;
    }

    // Attempt immediate flush
    await RoadmapOutboxService.flush(uid, cloud, storage);
  }

  /**
   * Sets up an online reconnect listener that flushes the outbox and triggers cloud sync.
   * Includes debouncing to absorb rapid burst reconnect events.
   * Returns a cleanup function that must be called on teardown or auth change.
   */
  static setupOnlineReconnectListener(
    uid: string,
    cloud: CloudDocStore,
    customStorage?: KeyValueStorage,
    onSyncComplete?: () => void
  ): () => void {
    if (typeof window === 'undefined' || !uid) return () => undefined;

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    const onOnline = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        RoadmapOutboxService.flush(uid, cloud, customStorage)
          .then(() => this.syncRoadmapsWithCloud(uid, cloud, customStorage))
          .then(() => onSyncComplete?.())
          .catch((err) => console.warn('[RoadmapSyncService] Online reconnect sync error:', err));
      }, 150);
    };

    window.addEventListener('online', onOnline);
    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      window.removeEventListener('online', onOnline);
    };
  }

  /**
   * Subscribes to real-time Firestore changes for the user's roadmaps.
   * Protects against infinite write loops by never committing writes from within listener.
   */
  static subscribeToRoadmapSync(
    uid: string,
    cloud: CloudDocStore,
    onRemoteUpdate: (mergedRoadmaps: Record<string, RoadmapProgress>) => void,
    customStorage?: KeyValueStorage
  ): () => void {
    if (!uid) return () => undefined;

    const unsubRoadmaps = cloud.subscribeCollection(
      cloudPaths.roadmaps(uid),
      (remoteDocs) => {
        try {
          const localRoadmaps = RoadmapProgressService.getAllRoadmapsProgress(uid, customStorage);
          const merged: Record<string, RoadmapProgress> = { ...localRoadmaps };
          let changed = false;

          for (const doc of remoteDocs) {
            const decoded = decodeRoadmapProgressDoc(doc.data);
            if (!decoded) continue;

            const local = localRoadmaps[decoded.roadmapId];
            if (local) {
              const res = mergeRoadmapProgress(local, decoded);
              if (canonicalJson(res) !== canonicalJson(local)) {
                merged[decoded.roadmapId] = res;
                changed = true;
              }
            } else {
              merged[decoded.roadmapId] = decoded;
              changed = true;
            }
          }

          if (changed) {
            RoadmapProgressService.saveAllRoadmapsProgress(merged, uid, customStorage);
            onRemoteUpdate(merged);
          }
        } catch (err) {
          console.warn('[RoadmapSyncService] Error processing real-time roadmap snapshot:', err);
        }
      },
      (err) => console.warn('[RoadmapSyncService] Real-time roadmaps subscription error:', err)
    );

    return () => {
      unsubRoadmaps();
    };
  }
}
