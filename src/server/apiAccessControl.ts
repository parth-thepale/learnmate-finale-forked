import type { ErrorRequestHandler, NextFunction, Request, RequestHandler, Response } from 'express';
import { createRequireAuth, type IdTokenVerifier } from './authMiddleware.ts';
import type { FixedWindowRateLimiter } from './rateLimiter.ts';
import { QuotaUnavailableError, type DailyQuotaStore } from './quotaStore.ts';
import { validateBody, type BodyValidatorName } from './requestValidation.ts';
import type { LaunchFeature } from '../config/launchFeatures.ts';

export interface ApiRoutePolicy {
  id: string;
  method: 'GET' | 'POST';
  /** Exact path, or a RegExp for parameterised routes. */
  path: string | RegExp;
  feature?: LaunchFeature;
  /** Internal diagnostics: hidden unless explicitly enabled, and then admin-only. */
  internal?: boolean;
  /** Daily quota units charged per request (0 = not an AI call). */
  aiUnits: number | ((body: Record<string, unknown>) => number);
  validator?: BodyValidatorName;
  bodyLimit: 'default' | 'media';
}

export const PREMIUM_TUTOR_MODELS = new Set(['gemini-4-argon']);

/**
 * Every API route must be listed here. Unlisted /api paths are rejected (default deny), so a
 * newly added AI route cannot accidentally bypass authentication or quotas.
 */
export const API_ROUTE_POLICIES: readonly ApiRoutePolicy[] = Object.freeze([
  { id: 'study.analyze', method: 'POST', path: '/api/study/analyze', aiUnits: 2, validator: 'analyze', bodyLimit: 'default' },
  {
    id: 'study.ask',
    method: 'POST',
    path: '/api/study/ask',
    aiUnits: (body) =>
      typeof body.modelPreference === 'string' && PREMIUM_TUTOR_MODELS.has(body.modelPreference) ? 3 : 1,
    validator: 'ask',
    bodyLimit: 'default',
  },
  { id: 'study.quiz', method: 'POST', path: '/api/study/quiz', aiUnits: 2, validator: 'quiz', bodyLimit: 'default' },
  {
    id: 'study.mistakesAndPlan',
    method: 'POST',
    path: '/api/study/mistakes-and-plan',
    aiUnits: 1,
    validator: 'mistakesAndPlan',
    bodyLimit: 'default',
  },
  { id: 'study.quickRevise', method: 'POST', path: '/api/study/quick-revise', aiUnits: 2, validator: 'quickRevise', bodyLimit: 'default' },
  {
    id: 'study.youtubeAnalyze',
    method: 'POST',
    path: '/api/study/youtube-analyze',
    aiUnits: 3,
    validator: 'youtubeAnalyze',
    bodyLimit: 'default',
  },
  { id: 'study.scanNotes', method: 'POST', path: '/api/study/scan-notes', aiUnits: 2, validator: 'scanNotes', bodyLimit: 'media' },
  {
    id: 'study.transcribeAudio',
    method: 'POST',
    path: '/api/study/transcribe-audio',
    aiUnits: 2,
    validator: 'transcribeAudio',
    bodyLimit: 'media',
  },
  { id: 'study.teachItBack', method: 'POST', path: '/api/study/teach-it-back', aiUnits: 1, validator: 'teachItBack', bodyLimit: 'default' },

  // Explore (disabled for launch)
  { id: 'study.youtubeRecommendations', method: 'POST', path: '/api/study/youtube-recommendations', feature: 'explore', aiUnits: 1, bodyLimit: 'default' },
  { id: 'explore.dailyNews', method: 'POST', path: '/api/explore/daily-news', feature: 'explore', aiUnits: 2, bodyLimit: 'default' },
  { id: 'explore.educationalMaps', method: 'POST', path: '/api/explore/educational-maps', feature: 'explore', aiUnits: 1, bodyLimit: 'default' },

  // Creative Studio (disabled for launch)
  { id: 'create.3dModel', method: 'POST', path: '/api/create/3d-model', feature: 'create', aiUnits: 3, bodyLimit: 'default' },
  { id: 'create.visualize', method: 'POST', path: '/api/create/visualize', feature: 'create', aiUnits: 5, bodyLimit: 'default' },
  { id: 'create.videoLesson', method: 'POST', path: '/api/create/video-lesson', feature: 'create', aiUnits: 10, bodyLimit: 'media' },
  { id: 'create.videoJob', method: 'GET', path: /^\/api\/create\/video-jobs\/[A-Za-z0-9_-]{1,80}$/, feature: 'create', aiUnits: 0, bodyLimit: 'default' },

  // Lo-fi music generation (disabled for launch)
  { id: 'create.lofiMusic', method: 'POST', path: '/api/create/lofi-music', feature: 'lofi', aiUnits: 5, bodyLimit: 'default' },

  // Internal diagnostics (hidden by default; admin-only when enabled)
  { id: 'internal.usage', method: 'GET', path: '/api/usage', internal: true, aiUnits: 0, bodyLimit: 'default' },
  { id: 'internal.capabilities', method: 'GET', path: '/api/capabilities', internal: true, aiUnits: 0, bodyLimit: 'default' },
  { id: 'internal.vertexStatus', method: 'GET', path: '/api/vertex/status', internal: true, aiUnits: 0, bodyLimit: 'default' },
  { id: 'internal.vertexProbe', method: 'POST', path: '/api/vertex/probe', internal: true, aiUnits: 0, bodyLimit: 'default' },
]);

export const PUBLIC_API_PATHS = new Set(['/api/health']);

export function resolveApiRoute(method: string, path: string): ApiRoutePolicy | null {
  const upper = method.toUpperCase();
  for (const policy of API_ROUTE_POLICIES) {
    if (policy.method !== upper) continue;
    if (typeof policy.path === 'string' ? policy.path === path : policy.path.test(path)) {
      return policy;
    }
  }
  return null;
}

/** Paths whose JSON body may use the larger media limit. */
export const MEDIA_BODY_PATHS: string[] = API_ROUTE_POLICIES.filter(
  (p) => p.bodyLimit === 'media' && typeof p.path === 'string'
).map((p) => p.path as string);

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      apiPolicy?: ApiRoutePolicy;
    }
  }
}

export interface ApiAccessControlOptions {
  verifyIdToken: IdTokenVerifier;
  quotaStore: DailyQuotaStore;
  ipLimiter: FixedWindowRateLimiter;
  userLimiter: FixedWindowRateLimiter;
  dailyUnitLimit: number;
  isFeatureEnabled: (feature: LaunchFeature) => boolean;
  diagnosticsEnabled: boolean;
  adminUids: ReadonlySet<string>;
  logger?: Pick<Console, 'warn'>;
}

function isApiPath(path: string): boolean {
  return path === '/api' || path.startsWith('/api/');
}

function sendError(res: Response, status: number, code: string, error: string, extra?: Record<string, unknown>) {
  res.status(status).json({ error, code, ...(extra || {}) });
}

function clientIp(req: Request): string {
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

/**
 * Builds the API guard chain. Mount `beforeBody`, then the JSON body parsers, then `afterBody`.
 * Order: IP rate limit → route allow-list/feature gate → Firebase auth → admin check
 *        → (body parsing) → payload validation → per-user burst limit → durable daily quota.
 */
export function createApiAccessControl(options: ApiAccessControlOptions): {
  beforeBody: RequestHandler[];
  afterBody: RequestHandler[];
} {
  const logger = options.logger ?? console;
  const requireAuth = createRequireAuth(options.verifyIdToken);

  const ipRateLimit: RequestHandler = (req, res, next) => {
    if (!isApiPath(req.path) || PUBLIC_API_PATHS.has(req.path)) return next();
    const result = options.ipLimiter.hit(`ip:${clientIp(req)}`);
    if (!result.allowed) {
      res.setHeader('Retry-After', String(Math.ceil(result.retryAfterMs / 1000)));
      return sendError(res, 429, 'rate_limited', 'Too many requests. Please wait a moment and try again.');
    }
    next();
  };

  const routeGate: RequestHandler = (req, res, next) => {
    if (!isApiPath(req.path) || PUBLIC_API_PATHS.has(req.path)) return next();
    const policy = resolveApiRoute(req.method, req.path);
    if (!policy) return sendError(res, 404, 'not_found', 'Endpoint not found.');
    if (policy.feature && !options.isFeatureEnabled(policy.feature)) {
      return sendError(res, 404, 'feature_disabled', 'This feature is not available yet.');
    }
    if (policy.internal && !options.diagnosticsEnabled) {
      return sendError(res, 404, 'not_found', 'Endpoint not found.');
    }
    req.apiPolicy = policy;
    next();
  };

  const authGate: RequestHandler = (req, res, next) => {
    if (!req.apiPolicy) return next();
    requireAuth(req, res, next);
  };

  const adminGate: RequestHandler = (req, res, next) => {
    if (!req.apiPolicy?.internal) return next();
    if (!req.authUser || !options.adminUids.has(req.authUser.uid)) {
      return sendError(res, 403, 'forbidden', 'You do not have access to this endpoint.');
    }
    next();
  };

  const validation: RequestHandler = (req, res, next) => {
    const policy = req.apiPolicy;
    if (!policy?.validator) return next();
    const result = validateBody(policy.validator, req.body);
    if (!result.ok) return sendError(res, result.status, 'invalid_request', result.error);
    next();
  };

  const usageControl: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
    const policy = req.apiPolicy;
    if (!policy || !req.authUser) return next();
    const body = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};
    const units = typeof policy.aiUnits === 'function' ? policy.aiUnits(body) : policy.aiUnits;
    if (units <= 0) return next();

    const uid = req.authUser.uid;
    const burst = options.userLimiter.hit(`user:${uid}`);
    if (!burst.allowed) {
      res.setHeader('Retry-After', String(Math.ceil(burst.retryAfterMs / 1000)));
      return sendError(res, 429, 'rate_limited', 'You are sending requests too quickly. Please wait a moment.');
    }

    options.quotaStore
      .consume(uid, units, options.dailyUnitLimit)
      .then((quota) => {
        if (!quota.allowed) {
          return sendError(
            res,
            429,
            'daily_quota_exceeded',
            "You've reached today's AI usage limit. It resets at midnight IST.",
            { quota: { used: quota.used, limit: quota.limit, resetsAt: quota.resetsAt } }
          );
        }
        next();
      })
      .catch((err: unknown) => {
        if (err instanceof QuotaUnavailableError) {
          logger.warn(`[quota] unavailable for ${policy.id}: ${err.message}`);
        } else {
          logger.warn(`[quota] unexpected error for ${policy.id}`);
        }
        sendError(res, 503, 'quota_unavailable', 'AI features are temporarily unavailable. Please try again shortly.');
      });
  };

  return {
    beforeBody: [ipRateLimit, routeGate, authGate, adminGate],
    afterBody: [validation, usageControl],
  };
}

/** Converts JSON body-parser failures into JSON errors instead of HTML stack pages. */
export const jsonBodyErrorHandler: ErrorRequestHandler = (err, req, res, next) => {
  const type = (err as { type?: string })?.type;
  if (type === 'entity.too.large') {
    return sendError(res, 413, 'payload_too_large', 'This request is too large. Please use a smaller file or document.');
  }
  if (type === 'entity.parse.failed') {
    return sendError(res, 400, 'invalid_json', 'Request body is not valid JSON.');
  }
  if (isApiPath(req.path)) {
    return sendError(res, 500, 'internal_error', 'Something went wrong. Please try again.');
  }
  next(err);
};
