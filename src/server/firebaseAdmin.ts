import fs from 'fs';
import path from 'path';
import { applicationDefault, cert, getApps, initializeApp, type App, type ServiceAccount } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import type { IdTokenVerifier } from './authMiddleware.ts';
import {
  FirestoreDailyQuotaStore,
  MemoryDailyQuotaStore,
  UnavailableDailyQuotaStore,
  type DailyQuotaStore,
  type QuotaFirestore,
} from './quotaStore.ts';

export type AdminCredentialMode = 'service_account_json' | 'application_default' | 'none';

export interface AdminCredentialConfig {
  mode: AdminCredentialMode;
  projectId: string;
  databaseId: string;
  serviceAccount?: ServiceAccount;
  warnings: string[];
}

interface ClientFirebaseConfig {
  projectId?: string;
  firestoreDatabaseId?: string;
}

function readClientFirebaseConfig(rootDir: string): ClientFirebaseConfig {
  try {
    return JSON.parse(fs.readFileSync(path.resolve(rootDir, 'firebase-applet-config.json'), 'utf8'));
  } catch {
    return {};
  }
}

/** Accepts the service-account JSON either raw or base64-encoded. Never logs its contents. */
export type ServiceAccountJson = ServiceAccount & { project_id?: string; client_email: string; private_key: string };

export function parseServiceAccountJson(raw: string): ServiceAccountJson {
  const trimmed = raw.trim();
  const jsonText = trimmed.startsWith('{') ? trimmed : Buffer.from(trimmed, 'base64').toString('utf8');
  const parsed = JSON.parse(jsonText) as Record<string, unknown>;
  if (typeof parsed.client_email !== 'string' || typeof parsed.private_key !== 'string') {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is missing client_email or private_key.');
  }
  return parsed as unknown as ServiceAccountJson;
}

/**
 * Resolves Firebase Admin credentials from the environment.
 *  - FIREBASE_SERVICE_ACCOUNT_JSON: service-account JSON (raw or base64) stored as a secret.
 *  - GOOGLE_APPLICATION_CREDENTIALS: path to a secret file (e.g. a Render Secret File).
 * The Firebase project is taken from FIREBASE_PROJECT_ID or firebase-applet-config.json, so ID
 * tokens are always verified against the same project the web client signs in to.
 */
export function resolveAdminCredentialConfig(
  env: Record<string, string | undefined>,
  rootDir: string
): AdminCredentialConfig {
  const clientConfig = readClientFirebaseConfig(rootDir);
  const projectId = (env.FIREBASE_PROJECT_ID || clientConfig.projectId || '').trim();
  const databaseId = (clientConfig.firestoreDatabaseId || '(default)').trim() || '(default)';
  const warnings: string[] = [];

  if (!projectId) {
    warnings.push('No Firebase project ID found (FIREBASE_PROJECT_ID or firebase-applet-config.json).');
  }

  const rawJson = env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (rawJson && rawJson.trim()) {
    try {
      const serviceAccount = parseServiceAccountJson(rawJson);
      if (serviceAccount.project_id && projectId && serviceAccount.project_id !== projectId) {
        warnings.push(
          `Service account belongs to project "${serviceAccount.project_id}" but the app uses "${projectId}". Quota writes may be denied.`
        );
      }
      return { mode: 'service_account_json', projectId, databaseId, serviceAccount, warnings };
    } catch (err) {
      warnings.push(`FIREBASE_SERVICE_ACCOUNT_JSON could not be parsed: ${err instanceof Error ? err.message : 'invalid JSON'}`);
      return { mode: 'none', projectId, databaseId, warnings };
    }
  }

  if (env.GOOGLE_APPLICATION_CREDENTIALS && env.GOOGLE_APPLICATION_CREDENTIALS.trim()) {
    return { mode: 'application_default', projectId, databaseId, warnings };
  }

  return { mode: 'none', projectId, databaseId, warnings };
}

export interface ServerFirebaseAdmin {
  config: AdminCredentialConfig;
  verifyIdToken: IdTokenVerifier;
  quotaStore: DailyQuotaStore;
}

/**
 * Initialises Firebase Admin. Token verification only needs the project ID (public signing keys).
 * Durable quotas need Firestore credentials; without them production fails closed, while local
 * development falls back to an in-memory quota store.
 */
export function initServerFirebaseAdmin(params: {
  env: Record<string, string | undefined>;
  rootDir: string;
  isProduction: boolean;
}): ServerFirebaseAdmin {
  const config = resolveAdminCredentialConfig(params.env, params.rootDir);

  let app: App | null = null;
  if (config.projectId) {
    const existing = getApps().find((a) => a.name === 'learnmate-server');
    app =
      existing ||
      initializeApp(
        {
          projectId: config.projectId,
          ...(config.mode === 'service_account_json' && config.serviceAccount
            ? { credential: cert(config.serviceAccount) }
            : config.mode === 'application_default'
            ? { credential: applicationDefault() }
            : {}),
        },
        'learnmate-server'
      );
  }

  const verifyIdToken: IdTokenVerifier = async (token) => {
    if (!app) {
      const err = new Error('Firebase Admin is not configured.') as Error & { code: string };
      err.code = 'app/no-app';
      throw err;
    }
    const decoded = await getAuth(app).verifyIdToken(token);
    return {
      uid: decoded.uid,
      email: decoded.email,
      signInProvider: decoded.firebase?.sign_in_provider,
    };
  };

  let quotaStore: DailyQuotaStore;
  if (app && config.mode !== 'none') {
    const db =
      config.databaseId && config.databaseId !== '(default)' ? getFirestore(app, config.databaseId) : getFirestore(app);
    quotaStore = new FirestoreDailyQuotaStore(db as unknown as QuotaFirestore);
  } else if (!params.isProduction) {
    quotaStore = new MemoryDailyQuotaStore();
  } else {
    quotaStore = new UnavailableDailyQuotaStore(
      'Firebase Admin credentials are not configured (set FIREBASE_SERVICE_ACCOUNT_JSON or GOOGLE_APPLICATION_CREDENTIALS).'
    );
  }

  return { config, verifyIdToken, quotaStore };
}
