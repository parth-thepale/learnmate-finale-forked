import { getTopic } from '../data/jeeMainSyllabus';
import type { QuizAttempt } from '../types/study';
import type { AttemptV2Fields, ResponseOutcome } from '../types/questionBank';

/**
 * Evidence-based topic assessment. A topic is only called "weak" (or "strong") when there is
 * enough evidence: a minimum number of attempted questions spread over more than one attempt.
 * Below that threshold the topic is reported as "insufficient evidence" — never as weak.
 */
export const TOPIC_EVIDENCE_RULES = Object.freeze({
  minAttemptedQuestions: 6,
  minDistinctAttempts: 2,
  weakAccuracyBelow: 0.6,
  strongAccuracyAtLeast: 0.85,
  /** Only the most recent attempted questions per topic count, so improvement is reflected. */
  recentWindow: 20,
});

export type TopicStatus = 'weak' | 'developing' | 'strong' | 'insufficient_evidence';

export interface TopicEvidence {
  key: string;
  label: string;
  topicId?: string;
  attemptedQuestions: number;
  correct: number;
  incorrect: number;
  unanswered: number;
  distinctAttempts: number;
  accuracy: number;
  status: TopicStatus;
  lastSeenAt: string;
  reason: string;
  /** Questions from verified server attempts with established provenance. */
  verifiedAttemptedQuestions: number;
  /** Questions from unverified client or legacy attempts. */
  unverifiedAttemptedQuestions: number;
  /** Distinct verified attempts for this topic. */
  verifiedDistinctAttempts: number;
  /** Accuracy across verified attempts only (null if no verified attempts). */
  verifiedAccuracy: number | null;
  /** True only when evidence threshold is met with server-verified attempts. */
  isAuthoritative: boolean;
  /** Provenance breakdown: 'verified' (all verified), 'unverified' (all unverified), or 'mixed'. */
  evidenceProvenance: 'verified' | 'unverified' | 'mixed';
}

export interface AssessTopicsOptions {
  /** Explicit set of attempt ids with confirmed server provenance. */
  verifiedAttemptIds?: ReadonlySet<string> | string[];
  /** Optional predicate to check if an attempt has verified server provenance. */
  isVerified?: (attempt: AttemptLike) => boolean;
  /** When true, only verified server attempts contribute to topic status. */
  requireVerified?: boolean;
}

interface Observation {
  key: string;
  label: string;
  topicId?: string;
  attemptId: string;
  at: string;
  outcome: ResponseOutcome;
  isVerified: boolean;
}

type AttemptLike = QuizAttempt & Partial<AttemptV2Fields>;

function labelKey(label: string): string {
  return `label:${label.trim().toLowerCase().replace(/\s+/g, ' ')}`;
}

function observationsFrom(attempt: AttemptLike, isVerified: boolean): Observation[] {
  const at = attempt.completedAt;
  if (attempt.schemaVersion === 2 && Array.isArray(attempt.outcomes)) {
    const out: Observation[] = [];
    for (const o of attempt.outcomes) {
      const known = o.topicIds.filter((id) => getTopic(id));
      if (known.length > 0) {
        for (const topicId of known) {
          out.push({ key: topicId, label: getTopic(topicId)!.topic.name, topicId, attemptId: attempt.id, at, outcome: o.outcome, isVerified });
        }
      } else if (o.topicLabel) {
        out.push({ key: labelKey(o.topicLabel), label: o.topicLabel, attemptId: attempt.id, at, outcome: o.outcome, isVerified });
      }
    }
    return out;
  }
  // Legacy attempts: one answer per question with a free-text topic label.
  return (attempt.answers || [])
    .filter((a) => typeof a.topic === 'string' && a.topic.trim())
    .map((a) => ({
      key: labelKey(a.topic),
      label: a.topic.trim(),
      attemptId: attempt.id,
      at,
      outcome: (a.selectedIndex < 0 ? 'unanswered' : a.isCorrect ? 'correct' : 'incorrect') as ResponseOutcome,
      isVerified,
    }));
}

function describe(e: Omit<TopicEvidence, 'reason'>): string {
  const base = `${e.correct} of ${e.attemptedQuestions} attempted correct across ${e.distinctAttempts} ${
    e.distinctAttempts === 1 ? 'attempt' : 'attempts'
  }`;
  if (e.status === 'insufficient_evidence') {
    const needQ = Math.max(0, TOPIC_EVIDENCE_RULES.minAttemptedQuestions - e.attemptedQuestions);
    const needA = Math.max(0, TOPIC_EVIDENCE_RULES.minDistinctAttempts - e.distinctAttempts);
    const needs = [
      needQ > 0 ? `${needQ} more question${needQ === 1 ? '' : 's'}` : '',
      needA > 0 ? `${needA} more practice attempt${needA === 1 ? '' : 's'}` : '',
    ].filter(Boolean);
    return `Not enough evidence yet (${base}); needs ${needs.join(' and ')}.`;
  }
  if (e.isAuthoritative) {
    return `${base}; authoritative verified evidence.`;
  }
  if (e.evidenceProvenance === 'unverified') {
    return `${base}; unverified practice evidence (not yet verified by server).`;
  }
  return `${base} (${e.verifiedAttemptedQuestions} verified); awaiting authoritative verification.`;
}

export function assessTopics(attempts: AttemptLike[], options?: AssessTopicsOptions): TopicEvidence[] {
  const verifiedSet = options?.verifiedAttemptIds ? new Set(options.verifiedAttemptIds) : null;
  const isAttemptVerified = (a: AttemptLike): boolean => {
    if (options?.isVerified) return options.isVerified(a);
    if (verifiedSet) return verifiedSet.has(a.id);
    return false; // Client markers alone never establish verification
  };

  const byKey = new Map<string, Observation[]>();
  for (const attempt of attempts) {
    const verified = isAttemptVerified(attempt);
    for (const obs of observationsFrom(attempt, verified)) {
      const list = byKey.get(obs.key) ?? [];
      list.push(obs);
      byKey.set(obs.key, list);
    }
  }

  const results: TopicEvidence[] = [];
  for (const [key, all] of byKey) {
    const sorted = [...all].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
    const attempted = sorted.filter((o) => o.outcome === 'correct' || o.outcome === 'incorrect');
    const recent = attempted.slice(0, TOPIC_EVIDENCE_RULES.recentWindow);
    const correct = recent.filter((o) => o.outcome === 'correct').length;
    const incorrect = recent.length - correct;
    const unanswered = sorted.filter((o) => o.outcome === 'unanswered').length;
    const distinctAttempts = new Set(recent.map((o) => o.attemptId)).size;
    const accuracy = recent.length > 0 ? correct / recent.length : 0;

    // Verified subset breakdown
    const verifiedRecent = recent.filter((o) => o.isVerified);
    const unverifiedRecent = recent.filter((o) => !o.isVerified);
    const verifiedAttemptedQuestions = verifiedRecent.length;
    const unverifiedAttemptedQuestions = unverifiedRecent.length;
    const verifiedCorrect = verifiedRecent.filter((o) => o.outcome === 'correct').length;
    const verifiedDistinctAttempts = new Set(verifiedRecent.map((o) => o.attemptId)).size;
    const verifiedAccuracy = verifiedAttemptedQuestions > 0 ? verifiedCorrect / verifiedAttemptedQuestions : null;

    const isAuthoritative =
      verifiedAttemptedQuestions >= TOPIC_EVIDENCE_RULES.minAttemptedQuestions &&
      verifiedDistinctAttempts >= TOPIC_EVIDENCE_RULES.minDistinctAttempts;

    const evidenceProvenance: 'verified' | 'unverified' | 'mixed' =
      verifiedAttemptedQuestions > 0 && unverifiedAttemptedQuestions === 0
        ? 'verified'
        : unverifiedAttemptedQuestions > 0 && verifiedAttemptedQuestions === 0
        ? 'unverified'
        : 'mixed';

    const targetPool = options?.requireVerified ? verifiedRecent : recent;
    const targetAttemptedCount = targetPool.length;
    const targetDistinctCount = new Set(targetPool.map((o) => o.attemptId)).size;
    const targetCorrectCount = targetPool.filter((o) => o.outcome === 'correct').length;
    const targetAccuracy = targetAttemptedCount > 0 ? targetCorrectCount / targetAttemptedCount : 0;

    const enough =
      targetAttemptedCount >= TOPIC_EVIDENCE_RULES.minAttemptedQuestions &&
      targetDistinctCount >= TOPIC_EVIDENCE_RULES.minDistinctAttempts;
    const status: TopicStatus = !enough
      ? 'insufficient_evidence'
      : targetAccuracy < TOPIC_EVIDENCE_RULES.weakAccuracyBelow
      ? 'weak'
      : targetAccuracy >= TOPIC_EVIDENCE_RULES.strongAccuracyAtLeast
      ? 'strong'
      : 'developing';

    const evidence = {
      key,
      label: sorted[0].label,
      topicId: sorted[0].topicId,
      attemptedQuestions: targetAttemptedCount,
      correct: targetCorrectCount,
      incorrect: targetAttemptedCount - targetCorrectCount,
      unanswered,
      distinctAttempts: targetDistinctCount,
      accuracy: targetAccuracy,
      status,
      lastSeenAt: sorted[0].at,
      verifiedAttemptedQuestions,
      unverifiedAttemptedQuestions,
      verifiedDistinctAttempts,
      verifiedAccuracy,
      isAuthoritative,
      evidenceProvenance,
    };
    results.push({ ...evidence, reason: describe(evidence) });
  }
  return results.sort((a, b) => a.label.localeCompare(b.label));
}

/** Topics with enough evidence to be called weak, weakest first. */
export function identifyWeakTopics(attempts: AttemptLike[], options?: AssessTopicsOptions): TopicEvidence[] {
  return assessTopics(attempts, options)
    .filter((t) => t.status === 'weak')
    .sort((a, b) => a.accuracy - b.accuracy || b.attemptedQuestions - a.attemptedQuestions);
}

/** Topics confirmed weak with authoritative server-verified evidence. */
export function identifyAuthoritativeWeakTopics(attempts: AttemptLike[], options?: AssessTopicsOptions): TopicEvidence[] {
  return assessTopics(attempts, { ...options, requireVerified: true })
    .filter((t) => t.status === 'weak' && t.isAuthoritative)
    .sort((a, b) => (a.verifiedAccuracy ?? a.accuracy) - (b.verifiedAccuracy ?? b.accuracy) || b.verifiedAttemptedQuestions - a.verifiedAttemptedQuestions);
}
