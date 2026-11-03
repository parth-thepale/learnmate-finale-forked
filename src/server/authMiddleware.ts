import type { NextFunction, Request, RequestHandler, Response } from 'express';

export interface VerifiedIdentity {
  uid: string;
  email?: string;
  signInProvider?: string;
}

/** Verifies a Firebase ID token and returns the identity it proves. Throws on any failure. */
export type IdTokenVerifier = (idToken: string) => Promise<VerifiedIdentity>;

export type AuthFailureCode =
  | 'auth_required'
  | 'invalid_token'
  | 'token_expired'
  | 'token_revoked'
  | 'anonymous_not_allowed'
  | 'auth_unavailable';

export interface AuthFailure {
  status: 401 | 403 | 503;
  code: AuthFailureCode;
  message: string;
}

export type AuthOutcome = { ok: true; identity: VerifiedIdentity } | { ok: false; failure: AuthFailure };

const MAX_TOKEN_LENGTH = 4096;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      authUser?: VerifiedIdentity;
    }
  }
}

export function extractBearerToken(headerValue: string | string[] | undefined): string | null {
  if (typeof headerValue !== 'string') return null;
  const match = /^Bearer\s+(\S+)\s*$/i.exec(headerValue);
  if (!match) return null;
  const token = match[1];
  if (token.length === 0 || token.length > MAX_TOKEN_LENGTH) return null;
  return token;
}

function errorCode(err: unknown): string {
  if (err && typeof err === 'object') {
    const anyErr = err as { code?: unknown; errorInfo?: { code?: unknown } };
    if (typeof anyErr.code === 'string') return anyErr.code;
    if (anyErr.errorInfo && typeof anyErr.errorInfo.code === 'string') return anyErr.errorInfo.code;
  }
  return '';
}

/** Maps a Firebase Admin verification error to a client-safe failure (never echoes the token). */
export function classifyVerificationError(err: unknown): AuthFailure {
  const code = errorCode(err);
  if (code === 'auth/id-token-expired') {
    return { status: 401, code: 'token_expired', message: 'Your session has expired. Please sign in again.' };
  }
  if (code === 'auth/id-token-revoked' || code === 'auth/user-disabled') {
    return { status: 401, code: 'token_revoked', message: 'Your session is no longer valid. Please sign in again.' };
  }
  if (code.startsWith('app/') || code === 'auth/internal-error') {
    return {
      status: 503,
      code: 'auth_unavailable',
      message: 'Sign-in verification is temporarily unavailable. Please try again shortly.',
    };
  }
  return { status: 401, code: 'invalid_token', message: 'Please sign in to use LearnMate AI features.' };
}

/** Verifies the bearer token from an Authorization header value. Shared by HTTP and WebSocket auth. */
export async function authenticateBearer(
  headerOrToken: { authorizationHeader?: string | string[]; token?: unknown },
  verify: IdTokenVerifier
): Promise<AuthOutcome> {
  const token =
    typeof headerOrToken.token === 'string'
      ? headerOrToken.token.length > 0 && headerOrToken.token.length <= MAX_TOKEN_LENGTH
        ? headerOrToken.token
        : null
      : extractBearerToken(headerOrToken.authorizationHeader);

  if (!token) {
    return {
      ok: false,
      failure: { status: 401, code: 'auth_required', message: 'Please sign in to use LearnMate AI features.' },
    };
  }

  let identity: VerifiedIdentity;
  try {
    identity = await verify(token);
  } catch (err) {
    return { ok: false, failure: classifyVerificationError(err) };
  }

  if (!identity || typeof identity.uid !== 'string' || identity.uid.length === 0) {
    return {
      ok: false,
      failure: { status: 401, code: 'invalid_token', message: 'Please sign in to use LearnMate AI features.' },
    };
  }

  if (identity.signInProvider === 'anonymous') {
    return {
      ok: false,
      failure: {
        status: 403,
        code: 'anonymous_not_allowed',
        message: 'Please sign in with Google to use LearnMate AI features.',
      },
    };
  }

  return { ok: true, identity };
}

/**
 * Express middleware requiring a valid Firebase ID token in `Authorization: Bearer <token>`.
 * The authenticated UID is taken only from the verified token and attached as `req.authUser`.
 */
export function createRequireAuth(verify: IdTokenVerifier): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    authenticateBearer({ authorizationHeader: req.headers.authorization }, verify)
      .then((outcome) => {
        if (!outcome.ok) {
          res.status(outcome.failure.status).json({ error: outcome.failure.message, code: outcome.failure.code });
          return;
        }
        req.authUser = outcome.identity;
        next();
      })
      .catch(next);
  };
}
