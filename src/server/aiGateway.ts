/**
 * Central AI Provider Architecture & Daily Quota Engine
 *
 * Implements:
 * 1. Central Provider Registry & Capability Router (Gemini, Vertex AI, Claude, and placeholders for OpenAI, DeepSeek, Higgsfield).
 * 2. Provider configuration checklist generator.
 * 3. Daily Usage & Quota Engine (Asia/Kolkata 00:00 IST rollover):
 *    - Max 5 hours (18,000 seconds) eligible AI activity per user/day.
 *    - Max 3 video generations per user/day.
 *    - Max 3 3D model generations per user/day.
 *    - Dynamic cost/token allowance: Remaining = DailyBudget - ActualCost - ReservedCost.
 *    - Atomic reservation, rollback on failure, idempotency key tracking.
 */

import { QUOTA_DAY_UTC_OFFSET_MINUTES, quotaDayKey, quotaResetsAt, type QuotaFirestore } from './quotaStore.ts';
import { toFirestoreData } from '../utils/firestoreData.ts';

export type AICapability =
  | 'text_generation'
  | 'document_understanding'
  | 'youtube_processing'
  | 'video_generation'
  | 'model3d_generation';

export type AIProviderId =
  | 'gemini_developer_api'
  | 'vertex_ai'
  | 'anthropic_claude'
  | 'openai_adapter'
  | 'deepseek_adapter'
  | 'higgsfield_media';

export interface ModelPricing {
  inputCostPerMillion: number;
  outputCostPerMillion: number;
  fixedPerOperationCost?: number;
}

export const MODEL_PRICING_TABLE: Record<string, ModelPricing> = {
  'gemini-3.1-flash-lite': { inputCostPerMillion: 0.075, outputCostPerMillion: 0.30 },
  'gemini-3.8-flash': { inputCostPerMillion: 0.15, outputCostPerMillion: 0.60 },
  'gemini-4-argon': { inputCostPerMillion: 1.25, outputCostPerMillion: 5.00 },
  'gemini-flash-latest': { inputCostPerMillion: 0.15, outputCostPerMillion: 0.60 },
  'claude-3-5-sonnet': { inputCostPerMillion: 3.00, outputCostPerMillion: 15.00 },
  'claude-3-5-haiku': { inputCostPerMillion: 0.80, outputCostPerMillion: 4.00 },
  'gpt-4o': { inputCostPerMillion: 2.50, outputCostPerMillion: 10.00 },
  'gpt-4o-mini': { inputCostPerMillion: 0.15, outputCostPerMillion: 0.60 },
  'deepseek-chat': { inputCostPerMillion: 0.14, outputCostPerMillion: 0.28 },
  'deepseek-reasoner': { inputCostPerMillion: 0.55, outputCostPerMillion: 2.19 },
};

export interface ProviderChecklistItem {
  providerId: AIProviderId;
  name: string;
  requiredCredentialEnv: string;
  isConfigured: boolean;
  supportedCapabilities: AICapability[];
  availableModels: string[];
  pricingStructure: string;
  rateLimits: string;
  fallbackCompatibility: string;
  readinessNotice: string;
}

export interface UserDailyUsage {
  timezone: 'Asia/Kolkata';
  day: string; // YYYY-MM-DD
  activeSeconds: number;
  maxActiveSeconds: number; // 18,000s = 5 hours
  remainingActiveSeconds: number;
  videoGenerations: number;
  maxVideoGenerations: number; // 3
  remainingVideoGenerations: number;
  model3DGenerations: number;
  maxModel3DGenerations: number; // 3
  remainingModel3DGenerations: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
  actualCost: number;
  reservedCost: number;
  dailyBudgetUsd: number | null;
  remainingBudgetUsd: number | null;
  resetsAt: string; // ISO
  nextResetSeconds: number;
  updatedAt: string;
}

export interface UsageReservation {
  reservationId: string;
  uid: string;
  day: string;
  capability: AICapability;
  provider: AIProviderId;
  model: string;
  estimatedSeconds: number;
  estimatedCost: number;
  idempotencyKey: string;
  createdAt: string;
  status: 'reserved' | 'committed' | 'rolled_back';
}

export const MAX_DAILY_ACTIVE_SECONDS = 5 * 3600; // 18,000 seconds = 5 hours
export const MAX_DAILY_VIDEO_GENERATIONS = 3;
export const MAX_DAILY_MODEL3D_GENERATIONS = 3;

export class QuotaLimitExceededError extends Error {
  readonly code:
    | 'daily_activity_limit_exceeded'
    | 'video_quota_exceeded'
    | 'model3d_quota_exceeded'
    | 'budget_exceeded';
  readonly usage: UserDailyUsage;

  constructor(
    code: 'daily_activity_limit_exceeded' | 'video_quota_exceeded' | 'model3d_quota_exceeded' | 'budget_exceeded',
    message: string,
    usage: UserDailyUsage
  ) {
    super(message);
    this.name = 'QuotaLimitExceededError';
    this.code = code;
    this.usage = usage;
  }
}

export interface DailyUsageStore {
  getUsage(uid: string, now?: Date): Promise<UserDailyUsage>;
  reserve(params: {
    uid: string;
    capability: AICapability;
    provider: AIProviderId;
    model: string;
    estimatedSeconds?: number;
    estimatedCost?: number;
    idempotencyKey?: string;
    now?: Date;
  }): Promise<{ allowed: boolean; reservationId: string; usage: UserDailyUsage }>;
  commit(params: {
    reservationId: string;
    actualSeconds: number;
    inputTokens?: number;
    outputTokens?: number;
    actualCost?: number;
    success: boolean;
    now?: Date;
  }): Promise<UserDailyUsage>;
}

export function computeDailyBudgetInfo(actualCost: number, reservedCost: number): {
  budget: number | null;
  remaining: number | null;
} {
  const envBudget = process.env.DAILY_COST_BUDGET_USD;
  if (!envBudget || !envBudget.trim()) {
    return { budget: null, remaining: null };
  }
  const parsed = Number(envBudget);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return { budget: null, remaining: null };
  }
  const remaining = Math.max(0, parsed - actualCost - reservedCost);
  return { budget: parsed, remaining: Math.round(remaining * 10000) / 10000 };
}

function emptyDailyUsage(day: string, now: Date): UserDailyUsage {
  const resets = quotaResetsAt(now);
  const nextResetSeconds = Math.max(0, Math.floor((resets.getTime() - now.getTime()) / 1000));
  const { budget, remaining } = computeDailyBudgetInfo(0, 0);

  return {
    timezone: 'Asia/Kolkata',
    day,
    activeSeconds: 0,
    maxActiveSeconds: MAX_DAILY_ACTIVE_SECONDS,
    remainingActiveSeconds: MAX_DAILY_ACTIVE_SECONDS,
    videoGenerations: 0,
    maxVideoGenerations: MAX_DAILY_VIDEO_GENERATIONS,
    remainingVideoGenerations: MAX_DAILY_VIDEO_GENERATIONS,
    model3DGenerations: 0,
    maxModel3DGenerations: MAX_DAILY_MODEL3D_GENERATIONS,
    remainingModel3DGenerations: MAX_DAILY_MODEL3D_GENERATIONS,
    inputTokens: 0,
    outputTokens: 0,
    estimatedCost: 0,
    actualCost: 0,
    reservedCost: 0,
    dailyBudgetUsd: budget,
    remainingBudgetUsd: remaining,
    resetsAt: resets.toISOString(),
    nextResetSeconds,
    updatedAt: now.toISOString(),
  };
}

export class MemoryDailyUsageStore implements DailyUsageStore {
  private readonly usageMap = new Map<string, UserDailyUsage>();
  private readonly reservations = new Map<string, UsageReservation>();

  private getKey(uid: string, day: string): string {
    return `${uid}_${day}`;
  }

  async getUsage(uid: string, now: Date = new Date()): Promise<UserDailyUsage> {
    const day = quotaDayKey(now);
    const key = this.getKey(uid, day);
    const existing = this.usageMap.get(key);
    if (!existing) {
      return emptyDailyUsage(day, now);
    }
    const resets = quotaResetsAt(now);
    const nextResetSeconds = Math.max(0, Math.floor((resets.getTime() - now.getTime()) / 1000));
    const { budget, remaining } = computeDailyBudgetInfo(existing.actualCost, existing.reservedCost);
    return {
      ...existing,
      resetsAt: resets.toISOString(),
      nextResetSeconds,
      dailyBudgetUsd: budget,
      remainingBudgetUsd: remaining,
    };
  }

  async reserve(params: {
    uid: string;
    capability: AICapability;
    provider: AIProviderId;
    model: string;
    estimatedSeconds?: number;
    estimatedCost?: number;
    idempotencyKey?: string;
    now?: Date;
  }): Promise<{ allowed: boolean; reservationId: string; usage: UserDailyUsage }> {
    const now = params.now ?? new Date();
    const day = quotaDayKey(now);
    const key = this.getKey(params.uid, day);
    const usage = this.usageMap.get(key) ?? emptyDailyUsage(day, now);

    const estSec = params.estimatedSeconds ?? 10;
    const estCost = params.estimatedCost ?? 0.001;
    const idKey = params.idempotencyKey || `res-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // Check existing idempotency key
    for (const [resId, res] of this.reservations.entries()) {
      if (res.uid === params.uid && res.idempotencyKey === idKey && res.status === 'reserved') {
        return { allowed: true, reservationId: resId, usage };
      }
    }

    // Count pending reservations under concurrency
    let pendingVideo = 0;
    let pendingModel3D = 0;
    let pendingActiveSec = 0;
    for (const res of this.reservations.values()) {
      if (res.uid === params.uid && res.day === day && res.status === 'reserved') {
        if (res.capability === 'video_generation') pendingVideo++;
        if (res.capability === 'model3d_generation') pendingModel3D++;
        pendingActiveSec += res.estimatedSeconds;
      }
    }

    // 1. Check 5-hour active AI duration limit (18,000s)
    if (usage.activeSeconds + pendingActiveSec + estSec > MAX_DAILY_ACTIVE_SECONDS) {
      throw new QuotaLimitExceededError(
        'daily_activity_limit_exceeded',
        "You have reached your 5-hour daily AI activity allowance. It resets at 00:00 IST.",
        usage
      );
    }

    // 2. Check video generation limit (3 per day)
    if (params.capability === 'video_generation' && (usage.videoGenerations + pendingVideo) >= MAX_DAILY_VIDEO_GENERATIONS) {
      throw new QuotaLimitExceededError(
        'video_quota_exceeded',
        "Daily video generation limit reached (3 of 3 videos created). Resets at 00:00 IST.",
        usage
      );
    }

    // 3. Check 3D model generation limit (3 per day)
    if (params.capability === 'model3d_generation' && (usage.model3DGenerations + pendingModel3D) >= MAX_DAILY_MODEL3D_GENERATIONS) {
      throw new QuotaLimitExceededError(
        'model3d_quota_exceeded',
        "Daily 3D model generation limit reached (3 of 3 models created). Resets at 00:00 IST.",
        usage
      );
    }

    // 4. Check dynamic cost budget if configured
    const { budget, remaining } = computeDailyBudgetInfo(usage.actualCost, usage.reservedCost);
    if (budget !== null && remaining !== null && estCost > remaining) {
      throw new QuotaLimitExceededError(
        'budget_exceeded',
        "Daily AI compute budget limit reached for today. Resets at 00:00 IST.",
        usage
      );
    }

    const reservationId = `res-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.reservations.set(reservationId, {
      reservationId,
      uid: params.uid,
      day,
      capability: params.capability,
      provider: params.provider,
      model: params.model,
      estimatedSeconds: estSec,
      estimatedCost: estCost,
      idempotencyKey: idKey,
      createdAt: now.toISOString(),
      status: 'reserved',
    });

    usage.reservedCost += estCost;
    usage.updatedAt = now.toISOString();
    this.usageMap.set(key, usage);

    return { allowed: true, reservationId, usage };
  }

  async commit(params: {
    reservationId: string;
    actualSeconds: number;
    inputTokens?: number;
    outputTokens?: number;
    actualCost?: number;
    success: boolean;
    now?: Date;
  }): Promise<UserDailyUsage> {
    const reservation = this.reservations.get(params.reservationId);
    if (!reservation) {
      throw new Error(`Reservation ${params.reservationId} not found.`);
    }

    const now = params.now ?? new Date();
    const key = this.getKey(reservation.uid, reservation.day);
    const usage = this.usageMap.get(key) ?? emptyDailyUsage(reservation.day, now);

    // Release reservation cost
    usage.reservedCost = Math.max(0, usage.reservedCost - reservation.estimatedCost);

    if (params.success) {
      reservation.status = 'committed';
      usage.activeSeconds += Math.max(0, params.actualSeconds);
      usage.remainingActiveSeconds = Math.max(0, MAX_DAILY_ACTIVE_SECONDS - usage.activeSeconds);
      usage.inputTokens += params.inputTokens ?? 0;
      usage.outputTokens += params.outputTokens ?? 0;
      usage.actualCost += params.actualCost ?? reservation.estimatedCost;

      if (reservation.capability === 'video_generation') {
        usage.videoGenerations += 1;
        usage.remainingVideoGenerations = Math.max(0, MAX_DAILY_VIDEO_GENERATIONS - usage.videoGenerations);
      } else if (reservation.capability === 'model3d_generation') {
        usage.model3DGenerations += 1;
        usage.remainingModel3DGenerations = Math.max(0, MAX_DAILY_MODEL3D_GENERATIONS - usage.model3DGenerations);
      }
    } else {
      // Rollback reservation - do not count failed generations against video/3D quota
      reservation.status = 'rolled_back';
    }

    usage.updatedAt = now.toISOString();
    const { budget, remaining } = computeDailyBudgetInfo(usage.actualCost, usage.reservedCost);
    usage.dailyBudgetUsd = budget;
    usage.remainingBudgetUsd = remaining;

    this.usageMap.set(key, usage);
    return usage;
  }
}

export class FirestoreDailyUsageStore implements DailyUsageStore {
  private readonly reservationMap = new Map<
    string,
    { uid: string; day: string; capability: AICapability; estimatedCost: number; estimatedSeconds: number }
  >();

  constructor(private readonly db: QuotaFirestore) {}

  private docPath(uid: string, day: string): string {
    return `users/${uid}/usage/${day}`;
  }

  async getUsage(uid: string, now: Date = new Date()): Promise<UserDailyUsage> {
    const day = quotaDayKey(now);
    const ref = this.db.collection('users').doc(`${uid}/usage/${day}`);

    try {
      return await this.db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const data = snap.exists ? (snap.data() as Record<string, unknown>) : {};
        const resets = quotaResetsAt(now);
        const nextResetSeconds = Math.max(0, Math.floor((resets.getTime() - now.getTime()) / 1000));

        const activeSec = typeof data.activeSeconds === 'number' ? data.activeSeconds : 0;
        const vidGen = typeof data.videoGenerations === 'number' ? data.videoGenerations : 0;
        const m3dGen = typeof data.model3DGenerations === 'number' ? data.model3DGenerations : 0;
        const inTok = typeof data.inputTokens === 'number' ? data.inputTokens : 0;
        const outTok = typeof data.outputTokens === 'number' ? data.outputTokens : 0;
        const actCost = typeof data.actualCost === 'number' ? data.actualCost : 0;
        const resCost = typeof data.reservedCost === 'number' ? data.reservedCost : 0;

        const { budget, remaining } = computeDailyBudgetInfo(actCost, resCost);

        return {
          timezone: 'Asia/Kolkata',
          day,
          activeSeconds: activeSec,
          maxActiveSeconds: MAX_DAILY_ACTIVE_SECONDS,
          remainingActiveSeconds: Math.max(0, MAX_DAILY_ACTIVE_SECONDS - activeSec),
          videoGenerations: vidGen,
          maxVideoGenerations: MAX_DAILY_VIDEO_GENERATIONS,
          remainingVideoGenerations: Math.max(0, MAX_DAILY_VIDEO_GENERATIONS - vidGen),
          model3DGenerations: m3dGen,
          maxModel3DGenerations: MAX_DAILY_MODEL3D_GENERATIONS,
          remainingModel3DGenerations: Math.max(0, MAX_DAILY_MODEL3D_GENERATIONS - m3dGen),
          inputTokens: inTok,
          outputTokens: outTok,
          estimatedCost: actCost + resCost,
          actualCost: actCost,
          reservedCost: resCost,
          dailyBudgetUsd: budget,
          remainingBudgetUsd: remaining,
          resetsAt: resets.toISOString(),
          nextResetSeconds,
          updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : now.toISOString(),
        };
      });
    } catch {
      return emptyDailyUsage(day, now);
    }
  }

  async reserve(params: {
    uid: string;
    capability: AICapability;
    provider: AIProviderId;
    model: string;
    estimatedSeconds?: number;
    estimatedCost?: number;
    idempotencyKey?: string;
    now?: Date;
  }): Promise<{ allowed: boolean; reservationId: string; usage: UserDailyUsage }> {
    const now = params.now ?? new Date();
    const day = quotaDayKey(now);
    const ref = this.db.collection('users').doc(`${params.uid}/usage/${day}`);
    const estSec = params.estimatedSeconds ?? 10;
    const estCost = params.estimatedCost ?? 0.001;
    const reservationId = `res-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const idKey = params.idempotencyKey || reservationId;

    return await this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const data = snap.exists ? (snap.data() as Record<string, unknown>) : {};

      const activeSec = typeof data.activeSeconds === 'number' ? data.activeSeconds : 0;
      const vidGen = typeof data.videoGenerations === 'number' ? data.videoGenerations : 0;
      const m3dGen = typeof data.model3DGenerations === 'number' ? data.model3DGenerations : 0;
      const resVid = typeof data.reservedVideoGenerations === 'number' ? data.reservedVideoGenerations : 0;
      const res3D = typeof data.reserved3DGenerations === 'number' ? data.reserved3DGenerations : 0;
      const inTok = typeof data.inputTokens === 'number' ? data.inputTokens : 0;
      const outTok = typeof data.outputTokens === 'number' ? data.outputTokens : 0;
      const actCost = typeof data.actualCost === 'number' ? data.actualCost : 0;
      const resCost = typeof data.reservedCost === 'number' ? data.reservedCost : 0;

      const currentUsage: UserDailyUsage = {
        timezone: 'Asia/Kolkata',
        day,
        activeSeconds: activeSec,
        maxActiveSeconds: MAX_DAILY_ACTIVE_SECONDS,
        remainingActiveSeconds: Math.max(0, MAX_DAILY_ACTIVE_SECONDS - activeSec),
        videoGenerations: vidGen,
        maxVideoGenerations: MAX_DAILY_VIDEO_GENERATIONS,
        remainingVideoGenerations: Math.max(0, MAX_DAILY_VIDEO_GENERATIONS - vidGen),
        model3DGenerations: m3dGen,
        maxModel3DGenerations: MAX_DAILY_MODEL3D_GENERATIONS,
        remainingModel3DGenerations: Math.max(0, MAX_DAILY_MODEL3D_GENERATIONS - m3dGen),
        inputTokens: inTok,
        outputTokens: outTok,
        estimatedCost: actCost + resCost,
        actualCost: actCost,
        reservedCost: resCost,
        dailyBudgetUsd: null,
        remainingBudgetUsd: null,
        resetsAt: quotaResetsAt(now).toISOString(),
        nextResetSeconds: Math.max(0, Math.floor((quotaResetsAt(now).getTime() - now.getTime()) / 1000)),
        updatedAt: now.toISOString(),
      };

      if (activeSec + estSec > MAX_DAILY_ACTIVE_SECONDS) {
        throw new QuotaLimitExceededError(
          'daily_activity_limit_exceeded',
          "You have reached your 5-hour daily AI activity allowance. It resets at 00:00 IST.",
          currentUsage
        );
      }

      if (params.capability === 'video_generation' && (vidGen + resVid) >= MAX_DAILY_VIDEO_GENERATIONS) {
        throw new QuotaLimitExceededError(
          'video_quota_exceeded',
          "Daily video generation limit reached (3 of 3 videos created). Resets at 00:00 IST.",
          currentUsage
        );
      }

      if (params.capability === 'model3d_generation' && (m3dGen + res3D) >= MAX_DAILY_MODEL3D_GENERATIONS) {
        throw new QuotaLimitExceededError(
          'model3d_quota_exceeded',
          "Daily 3D model generation limit reached (3 of 3 models created). Resets at 00:00 IST.",
          currentUsage
        );
      }

      const { budget, remaining } = computeDailyBudgetInfo(actCost, resCost);
      currentUsage.dailyBudgetUsd = budget;
      currentUsage.remainingBudgetUsd = remaining;
      if (budget !== null && remaining !== null && estCost > remaining) {
        throw new QuotaLimitExceededError(
          'budget_exceeded',
          "Daily AI compute budget limit reached for today. Resets at 00:00 IST.",
          currentUsage
        );
      }

      const newReservedCost = resCost + estCost;
      const newResVid = params.capability === 'video_generation' ? resVid + 1 : resVid;
      const newRes3D = params.capability === 'model3d_generation' ? res3D + 1 : res3D;

      tx.set(
        ref,
        toFirestoreData(
          {
            timezone: 'Asia/Kolkata',
            day,
            activeSeconds: activeSec,
            videoGenerations: vidGen,
            model3DGenerations: m3dGen,
            reservedVideoGenerations: newResVid,
            reserved3DGenerations: newRes3D,
            inputTokens: inTok,
            outputTokens: outTok,
            actualCost: actCost,
            reservedCost: newReservedCost,
            updatedAt: now.toISOString(),
            lastReservationId: reservationId,
            lastIdempotencyKey: idKey,
          },
          { label: 'daily usage reservation' }
        )
      );

      this.reservationMap.set(reservationId, {
        uid: params.uid,
        day,
        capability: params.capability,
        estimatedCost: estCost,
        estimatedSeconds: estSec,
      });

      return { allowed: true, reservationId, usage: currentUsage };
    });
  }

  async commit(params: {
    reservationId: string;
    uid?: string;
    capability?: AICapability;
    actualSeconds: number;
    inputTokens?: number;
    outputTokens?: number;
    actualCost?: number;
    success: boolean;
    now?: Date;
  }): Promise<UserDailyUsage> {
    const now = params.now ?? new Date();
    const meta = this.reservationMap.get(params.reservationId);
    const uid = params.uid || meta?.uid || 'guest-user';
    const day = meta?.day || quotaDayKey(now);
    const capability = params.capability || meta?.capability || 'text_generation';
    const estCost = meta?.estimatedCost ?? 0.001;

    const ref = this.db.collection('users').doc(`${uid}/usage/${day}`);

    return await this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const data = snap.exists ? (snap.data() as Record<string, unknown>) : {};

      const activeSec = typeof data.activeSeconds === 'number' ? data.activeSeconds : 0;
      let vidGen = typeof data.videoGenerations === 'number' ? data.videoGenerations : 0;
      let m3dGen = typeof data.model3DGenerations === 'number' ? data.model3DGenerations : 0;
      let resVid = typeof data.reservedVideoGenerations === 'number' ? data.reservedVideoGenerations : 0;
      let res3D = typeof data.reserved3DGenerations === 'number' ? data.reserved3DGenerations : 0;
      const inTok = typeof data.inputTokens === 'number' ? data.inputTokens : 0;
      const outTok = typeof data.outputTokens === 'number' ? data.outputTokens : 0;
      const actCost = typeof data.actualCost === 'number' ? data.actualCost : 0;
      const resCost = typeof data.reservedCost === 'number' ? data.reservedCost : 0;

      if (capability === 'video_generation') resVid = Math.max(0, resVid - 1);
      if (capability === 'model3d_generation') res3D = Math.max(0, res3D - 1);
      const newResCost = Math.max(0, resCost - estCost);

      let newActiveSec = activeSec;
      let newInTok = inTok;
      let newOutTok = outTok;
      let newActCost = actCost;

      if (params.success) {
        newActiveSec += Math.max(0, params.actualSeconds);
        newInTok += params.inputTokens ?? 0;
        newOutTok += params.outputTokens ?? 0;
        newActCost += params.actualCost ?? estCost;
        if (capability === 'video_generation') vidGen += 1;
        if (capability === 'model3d_generation') m3dGen += 1;
      }

      tx.set(
        ref,
        toFirestoreData(
          {
            timezone: 'Asia/Kolkata',
            day,
            activeSeconds: newActiveSec,
            videoGenerations: vidGen,
            model3DGenerations: m3dGen,
            reservedVideoGenerations: resVid,
            reserved3DGenerations: res3D,
            inputTokens: newInTok,
            outputTokens: newOutTok,
            actualCost: newActCost,
            reservedCost: newResCost,
            updatedAt: now.toISOString(),
          },
          { label: 'daily usage commit' }
        )
      );

      this.reservationMap.delete(params.reservationId);
      const { budget, remaining } = computeDailyBudgetInfo(newActCost, newResCost);
      const resets = quotaResetsAt(now);
      const nextResetSeconds = Math.max(0, Math.floor((resets.getTime() - now.getTime()) / 1000));

      return {
        timezone: 'Asia/Kolkata',
        day,
        activeSeconds: newActiveSec,
        maxActiveSeconds: MAX_DAILY_ACTIVE_SECONDS,
        remainingActiveSeconds: Math.max(0, MAX_DAILY_ACTIVE_SECONDS - newActiveSec),
        videoGenerations: vidGen,
        maxVideoGenerations: MAX_DAILY_VIDEO_GENERATIONS,
        remainingVideoGenerations: Math.max(0, MAX_DAILY_VIDEO_GENERATIONS - vidGen),
        model3DGenerations: m3dGen,
        maxModel3DGenerations: MAX_DAILY_MODEL3D_GENERATIONS,
        remainingModel3DGenerations: Math.max(0, MAX_DAILY_MODEL3D_GENERATIONS - m3dGen),
        inputTokens: newInTok,
        outputTokens: newOutTok,
        estimatedCost: newActCost + newResCost,
        actualCost: newActCost,
        reservedCost: newResCost,
        dailyBudgetUsd: budget,
        remainingBudgetUsd: remaining,
        resetsAt: resets.toISOString(),
        nextResetSeconds,
        updatedAt: now.toISOString(),
      };
    });
  }
}

/**
 * Returns the formal Provider Configuration Checklist required by Phase Five E.
 */
export function getProviderConfigChecklist(): ProviderChecklistItem[] {
  return [
    {
      providerId: 'gemini_developer_api',
      name: 'Google Gemini Developer API',
      requiredCredentialEnv: 'GEMINI_API_KEY',
      isConfigured: Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim()),
      supportedCapabilities: [
        'text_generation',
        'document_understanding',
        'youtube_processing',
      ],
      availableModels: [
        'gemini-3.1-flash-lite',
        'gemini-3.8-flash',
        'gemini-4-argon',
        'gemini-flash-latest',
      ],
      pricingStructure:
        'Input: $0.075-$1.25 / 1M tokens. Output: $0.30-$5.00 / 1M tokens. Pay-as-you-go via Google AI Studio.',
      rateLimits: '15 RPM default tier (managed via GeminiRequestManager client queue).',
      fallbackCompatibility: 'Seamless fallback to secondary Gemini models and local deterministic engines.',
      readinessNotice: 'Active and verified in production.',
    },
    {
      providerId: 'vertex_ai',
      name: 'Google Cloud Vertex AI (ADC / Trial Credit Eligible)',
      requiredCredentialEnv: 'GOOGLE_APPLICATION_CREDENTIALS / Cloud ADC',
      isConfigured: Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.CLOUD_ML_PROJECT_ID),
      supportedCapabilities: ['text_generation', 'document_understanding'],
      availableModels: ['gemini-3.8-flash', 'gemini-3.1-flash-lite'],
      pricingStructure:
        'Eligible for $300 Google Cloud Free Trial credits via aiplatform.googleapis.com billing.',
      rateLimits: 'Determined by GCP project quota quotas.',
      fallbackCompatibility: 'Direct fallback to Developer API or structured offline modules.',
      readinessNotice: 'Ready for activation once GCP ADC service account credentials are provided.',
    },
    {
      providerId: 'anthropic_claude',
      name: 'Anthropic Claude Messages API',
      requiredCredentialEnv: 'ANTHROPIC_API_KEY',
      isConfigured: Boolean(process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY.trim()),
      supportedCapabilities: ['text_generation', 'model3d_generation'],
      availableModels: ['claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022'],
      pricingStructure: 'Input: $0.80-$3.00 / 1M tokens. Output: $4.00-$15.00 / 1M tokens.',
      rateLimits: '50 RPM standard tier.',
      fallbackCompatibility: 'Falls back gracefully to procedural 3D engine and Gemini Flash.',
      readinessNotice: 'Integrated with procedural Three.js fallback.',
    },
    {
      providerId: 'openai_adapter',
      name: 'OpenAI API (Placeholder Adapter)',
      requiredCredentialEnv: 'OPENAI_API_KEY',
      isConfigured: Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.trim()),
      supportedCapabilities: ['text_generation', 'document_understanding'],
      availableModels: ['gpt-4o', 'gpt-4o-mini', 'o3-mini'],
      pricingStructure: 'Input: $0.15-$2.50 / 1M tokens. Output: $0.60-$10.00 / 1M tokens.',
      rateLimits: 'Tier-based RPM / TPM.',
      fallbackCompatibility: 'Full schema compatibility with standard chat completions.',
      readinessNotice:
        'Architecture placeholder ready. Awaiting product owner specification and API key.',
    },
    {
      providerId: 'deepseek_adapter',
      name: 'DeepSeek API (Placeholder Adapter)',
      requiredCredentialEnv: 'DEEPSEEK_API_KEY',
      isConfigured: Boolean(process.env.DEEPSEEK_API_KEY && process.env.DEEPSEEK_API_KEY.trim()),
      supportedCapabilities: ['text_generation'],
      availableModels: ['deepseek-chat', 'deepseek-reasoner'],
      pricingStructure: 'Input: $0.14-$0.55 / 1M tokens. Output: $0.28-$2.19 / 1M tokens.',
      rateLimits: 'Default API rate limits.',
      fallbackCompatibility: 'OpenAI-compatible endpoints supported.',
      readinessNotice:
        'Architecture placeholder ready. Awaiting product owner specification and API key.',
    },
    {
      providerId: 'higgsfield_media',
      name: 'Higgsfield Media Generation (Placeholder Adapter)',
      requiredCredentialEnv: 'HIGGSFIELD_API_KEY',
      isConfigured: Boolean(process.env.HIGGSFIELD_API_KEY && process.env.HIGGSFIELD_API_KEY.trim()),
      supportedCapabilities: ['video_generation'],
      availableModels: ['higgsfield-video-v1'],
      pricingStructure: 'Per generation billing unit.',
      rateLimits: 'Job queue with polling.',
      fallbackCompatibility: 'Falls back to interactive procedural animated explanation.',
      readinessNotice:
        'Creative studio ready with procedural fallback. Awaiting media provider credentials.',
    },
  ];
}

export const defaultDailyUsageStore = new MemoryDailyUsageStore();
