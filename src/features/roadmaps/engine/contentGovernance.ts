import type {
  AssessmentQuestion,
  Checkpoint,
  ContentReviewRecord,
  PracticeQuestion,
} from '../types/checkpoint.types';

// ============================================================================
// Standard FIPS 180-4 SHA-256 Implementation (Synchronous, Zero Dependencies)
// ============================================================================

function rightRotate(value: number, amount: number): number {
  return (value >>> amount) | (value << (32 - amount));
}

const SHA256_K: readonly number[] = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

/**
 * Computes standard FIPS 180-4 SHA-256 digest on a string.
 * Uses TextEncoder for robust UTF-8 byte handling. Output is 64-char lowercase hex.
 * Bit-for-bit identical to Node.js `crypto.createHash('sha256')` and `SubtleCrypto.digest`.
 */
export function computeSha256Hex(input: string): string {
  const bytes = new TextEncoder().encode(input);
  const byteLen = bytes.length;
  const bitLen = byteLen * 8;

  // 1-bit padding (0x80), zeros, then 64-bit big-endian length
  const extraLen = byteLen % 64 < 56 ? 56 - (byteLen % 64) : 120 - (byteLen % 64);
  const totalLen = byteLen + extraLen + 8;
  const padded = new Uint8Array(totalLen);
  padded.set(bytes);
  padded[byteLen] = 0x80;

  const view = new DataView(padded.buffer);
  view.setBigUint64(totalLen - 8, BigInt(bitLen), false);

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;

  const W = new Int32Array(64);

  for (let offset = 0; offset < totalLen; offset += 64) {
    for (let t = 0; t < 16; t++) {
      W[t] = view.getInt32(offset + t * 4, false);
    }
    for (let t = 16; t < 64; t++) {
      const s0 = rightRotate(W[t - 15], 7) ^ rightRotate(W[t - 15], 18) ^ (W[t - 15] >>> 3);
      const s1 = rightRotate(W[t - 2], 17) ^ rightRotate(W[t - 2], 19) ^ (W[t - 2] >>> 10);
      W[t] = (W[t - 16] + s0 + W[t - 7] + s1) | 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;

    for (let t = 0; t < 64; t++) {
      const S1 = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + SHA256_K[t] + W[t]) | 0;
      const S0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) | 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) | 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) | 0;
    }

    h0 = (h0 + a) | 0;
    h1 = (h1 + b) | 0;
    h2 = (h2 + c) | 0;
    h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0;
    h5 = (h5 + f) | 0;
    h6 = (h6 + g) | 0;
    h7 = (h7 + h) | 0;
  }

  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map((val) => (val >>> 0).toString(16).padStart(8, '0'))
    .join('');
}

// ============================================================================
// Deterministic Canonical Serialization & Digest Binding
// ============================================================================

/**
 * Deterministically serializes all substantive educational, pedagogical, and syllabus fields
 * that affect question meaning, answer correctness, explanation, or curriculum placement.
 *
 * Preserves exact option array ordering. Fails safely on missing/malformed objects.
 */
export function canonicalizeQuestionForHashing(question: unknown): string {
  if (!question || typeof question !== 'object') {
    return '';
  }

  const q = question as Partial<AssessmentQuestion & PracticeQuestion>;
  const type = q.type === 'numerical' ? 'numerical' : 'mcq';

  const stem = typeof q.stem === 'string' ? q.stem.trim() : '';
  const topicId = typeof q.topicId === 'string' ? q.topicId.trim() : '';
  const topicLabel = typeof q.topicLabel === 'string' ? q.topicLabel.trim() : null;
  const difficulty = typeof q.difficulty === 'string' ? q.difficulty.trim() : null;
  const tier = typeof q.tier === 'string' ? q.tier.trim() : null;
  const explanation = typeof q.explanation === 'string' ? q.explanation.trim() : '';
  const hint = typeof q.hint === 'string' ? q.hint.trim() : null;

  if (!stem || !topicId) {
    return '';
  }

  // Preserve exact option array order; normalize whitespace
  const options =
    type === 'mcq' && Array.isArray(q.options)
      ? q.options.map((opt) => String(opt ?? '').trim())
      : [];

  const correctOptionIndex =
    type === 'mcq' && typeof q.correctOptionIndex === 'number'
      ? q.correctOptionIndex
      : null;

  const acceptedNumerical =
    type === 'numerical' && typeof q.acceptedNumerical === 'number'
      ? q.acceptedNumerical
      : null;

  // Fixed sorted keys for deterministic serialization
  const canonical = {
    acceptedNumerical,
    correctOptionIndex,
    difficulty,
    explanation,
    hint,
    options,
    stem,
    tier,
    topicId,
    topicLabel,
    type,
  };

  return JSON.stringify(canonical);
}

/**
 * Computes the standard SHA-256 cryptographic content digest formatted as `sha256:<64-hex>`.
 *
 * NOTE ON CRYPTOGRAPHIC CLAIMS:
 * A content digest provides tamper-evidence of question content (content integrity).
 * It DOES NOT authenticate the reviewer identity or prove authorized expert approval.
 */
export function computeQuestionContentDigest(question: unknown): string {
  const canonical = canonicalizeQuestionForHashing(question);
  if (!canonical) {
    return '';
  }
  return `sha256:${computeSha256Hex(canonical)}`;
}

// Backward-compatible alias for existing callers
export const computeQuestionContentHash = computeQuestionContentDigest;

// ============================================================================
// Reviewer Authorization & Authority Architecture
// ============================================================================

/**
 * Validates reviewer ID against expected naming format / namespace convention.
 * Format: sme-<domain>-<identifier> (e.g., 'sme-phys-dr-sharma').
 *
 * SECURITY NOTICE:
 * Format validation is NOT proof of authorization or reviewer authenticity.
 * It is solely a syntactic pattern check. Real reviewer authorization requires
 * authenticated server-side IAM verification against an authoritative directory.
 */
export function isValidReviewerIdFormat(reviewerId: unknown): boolean {
  if (typeof reviewerId !== 'string') {
    return false;
  }
  const trimmed = reviewerId.trim();
  return /^sme-[a-z]{3,12}-[a-z0-9_-]{2,40}$/i.test(trimmed);
}

// Alias for existing callers
export const isValidReviewerId = isValidReviewerIdFormat;

/**
 * Evaluates whether a ContentReviewRecord is structurally complete and valid.
 * Tier 1 of verification: Record schema completeness.
 */
export function isReviewRecordStructurallyValid(
  record: unknown
): record is ContentReviewRecord {
  if (!record || typeof record !== 'object') {
    return false;
  }

  const r = record as Partial<ContentReviewRecord>;
  if (r.reviewStatus !== 'verified') {
    return false;
  }

  if (typeof r.reviewerId !== 'string' || !isValidReviewerIdFormat(r.reviewerId)) {
    return false;
  }

  if (typeof r.reviewedAt !== 'string' || isNaN(Date.parse(r.reviewedAt))) {
    return false;
  }

  if (r.mathematicalCheckConfirmed !== true) {
    return false;
  }

  if (r.pedagogicalReviewConfirmed !== true) {
    return false;
  }

  if (typeof r.contentVersion !== 'string' || r.contentVersion.trim().length === 0) {
    return false;
  }

  if (r.lifecycleStatus && r.lifecycleStatus !== 'approved') {
    return false;
  }

  return true;
}

/**
 * Verifies that the question's content matches the SHA-256 digest recorded in the review.
 * Tier 2 of verification: Cryptographic content integrity.
 * Fails closed if content was modified, or if an old FNV/semantic version was recorded.
 */
export function isQuestionContentIntegrityIntact(
  question: unknown,
  record?: ContentReviewRecord | null
): boolean {
  if (!record || !isReviewRecordStructurallyValid(record)) {
    return false;
  }

  const expectedDigest = computeQuestionContentDigest(question);
  if (!expectedDigest) {
    return false;
  }

  return record.contentVersion === expectedDigest;
}

// ============================================================================
// Environment Detection & Fail-Closed Access Control
// ============================================================================

/**
 * Detects whether the active execution context is a production environment.
 * Evaluates compile-time Vite environment constants and runtime Node process variables.
 * Fails closed: if unknown, defaults to production (true).
 */
export function isProductionEnvironment(): boolean {
  // 1. Vite compile-time environment flags (statically substituted by Rollup in production builds)
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const metaEnv = (import.meta as any)?.env;
    if (metaEnv) {
      if (
        metaEnv.MODE === 'production' ||
        metaEnv.PROD === true ||
        metaEnv.DEV === false
      ) {
        return true;
      }
      if (
        metaEnv.DEV === true &&
        metaEnv.PROD !== true &&
        metaEnv.MODE !== 'production'
      ) {
        return false;
      }
    }
  } catch {}

  // 2. Node.js process environment flags (used in native test runners)
  if (typeof process !== 'undefined' && process.env) {
    return process.env.NODE_ENV === 'production';
  }

  // Fail closed to production
  return true;
}

/**
 * Evaluates whether internal preview / validation mode is permitted.
 *
 * HARD PRODUCTION CEILING:
 * - Production builds unconditionally return false (disabled for all learners).
 * - No caller-supplied parameter, user setting, or URL flag can bypass production.
 * - Allowed only in local development / automated testing environments.
 */
export function isInternalPreviewPermitted(): boolean {
  // Hard ceiling: in production, unconditionally disabled
  if (isProductionEnvironment()) {
    return false;
  }

  return true;
}

// ============================================================================
// Verification Evaluation
// ============================================================================

/**
 * Evaluates whether question placement adheres to the checkpoint binding in the review record.
 * If the review record binds a specific checkpointId or subject, it MUST match the target.
 */
export function isQuestionPlacementValid(
  question: unknown,
  targetCheckpointId?: string,
  targetSubject?: string
): boolean {
  if (!question || typeof question !== 'object') {
    return false;
  }
  const q = question as Partial<AssessmentQuestion & PracticeQuestion>;
  const record = q.reviewRecord;
  if (!record) {
    return true;
  }

  // Lifecycle check: revoked or superseded records are never valid
  if (record.lifecycleStatus && record.lifecycleStatus !== 'approved') {
    return false;
  }

  // Question ID binding check: record.questionId must match question.id
  if (record.questionId && q.id && record.questionId !== q.id) {
    return false;
  }

  // Topic binding check: record.topicId must match question.topicId
  if (record.topicId && q.topicId && record.topicId !== q.topicId) {
    return false;
  }

  // Checkpoint placement check
  if (record.checkpointId && targetCheckpointId && record.checkpointId !== targetCheckpointId) {
    return false;
  }

  // Subject placement check
  if (record.subject && targetSubject && record.subject !== targetSubject) {
    return false;
  }

  return true;
}

/**
 * Evaluates whether a question possesses formal, authoritative verification.
 *
 * FOUR-TIER GOVERNANCE ARCHITECTURE:
 * 1. Structurally valid review record (`isReviewRecordStructurallyValid`).
 * 2. Cryptographic content integrity match (`isQuestionContentIntegrityIntact` with SHA-256).
 * 2b. Curriculum placement binding (`isQuestionPlacementValid` with checkpointId and subject).
 * 3. Authenticated reviewer identity (requires server-side IAM; DOES NOT EXIST yet).
 * 4. Authorized expert approval (requires authoritative reviewer directory; DOES NOT EXIST yet).
 *
 * PRODUCTION CEILING:
 * In production, because no authoritative reviewer directory exists, this function
 * UNCONDITIONALLY returns `false`. All production content remains in unverified / authoring status.
 *
 * DEVELOPMENT / TESTING HARNESS:
 * In non-production test runners, structurally valid questions with matching SHA-256 digests
 * may be exercised by tests to verify scoring and progression logic without claiming human approval.
 */
export function isQuestionFormallyVerified(
  question: unknown,
  targetCheckpointId?: string,
  targetSubject?: string
): question is (AssessmentQuestion | PracticeQuestion) & { readonly reviewRecord: ContentReviewRecord } {
  if (!question || typeof question !== 'object') {
    return false;
  }

  const q = question as Partial<AssessmentQuestion & PracticeQuestion>;
  const record = q.reviewRecord;

  // Tier 1: Structural schema completeness
  if (!record || !isReviewRecordStructurallyValid(record)) {
    return false;
  }

  // Tier 2: Cryptographic content integrity match (SHA-256)
  if (!isQuestionContentIntegrityIntact(q, record)) {
    return false;
  }

  // Tier 2b: Curriculum placement binding
  if (!isQuestionPlacementValid(q, targetCheckpointId, targetSubject)) {
    return false;
  }

  // Tier 3 & 4: Reviewer authorization & identity check
  // In production builds, no authoritative directory exists; fail closed.
  if (isProductionEnvironment()) {
    return false;
  }

  // Non-production test harness only
  return true;
}

/**
 * Returns only formally verified assessment questions for a checkpoint.
 */
export function getVerifiedAssessmentQuestions(
  checkpoint?: Checkpoint | null
): readonly AssessmentQuestion[] {
  if (!checkpoint || !checkpoint.assessmentQuestions) {
    return [];
  }
  return checkpoint.assessmentQuestions.filter((q) =>
    isQuestionFormallyVerified(q, checkpoint.id, checkpoint.subject)
  );
}

/**
 * Returns only formally verified practice questions for a checkpoint.
 */
export function getVerifiedPracticeQuestions(
  checkpoint?: Checkpoint | null
): readonly PracticeQuestion[] {
  if (!checkpoint || !checkpoint.practiceQuestions) {
    return [];
  }
  return checkpoint.practiceQuestions.filter((q) =>
    isQuestionFormallyVerified(q, checkpoint.id, checkpoint.subject)
  );
}

/**
 * Determines whether a checkpoint has at least one formally verified assessment question
 * required to permit learner-facing scored assessment.
 */
export function isCheckpointLearnerReady(checkpoint?: Checkpoint | null): boolean {
  return getVerifiedAssessmentQuestions(checkpoint).length > 0;
}
