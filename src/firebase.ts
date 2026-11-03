import { initializeApp } from 'firebase/app';
import {
  getAuth,
  initializeAuth,
  indexedDBLocalPersistence,
  browserLocalPersistence,
  inMemoryPersistence,
  browserPopupRedirectResolver,
  GoogleAuthProvider,
  signInWithPopup,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  type Auth,
  type User,
} from 'firebase/auth';
import {
  getFirestore,
  doc,
  getDocFromServer,
  setLogLevel,
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

import { removeForeignFirebaseAuthEntries } from './services/authStorageHygiene';

function cleanUpForeignAuthSessions(): void {
  if (typeof window === 'undefined') return;
  for (const storage of [window.localStorage, window.sessionStorage]) {
    try {
      if (storage) removeForeignFirebaseAuthEntries(storage, firebaseConfig.apiKey);
    } catch {
      // ignore in restricted storage environments
    }
  }
}

cleanUpForeignAuthSessions();

const app = initializeApp(firebaseConfig);

function createSafeAuth(): Auth {
  if (typeof window !== 'undefined') {
    try {
      // Keep users signed in across reloads. The SDK uses the first persistence the browser
      // supports and falls back to in-memory (e.g. storage blocked in private mode).
      return initializeAuth(app, {
        persistence: [indexedDBLocalPersistence, browserLocalPersistence, inMemoryPersistence],
        popupRedirectResolver: browserPopupRedirectResolver,
      });
    } catch {
      return getAuth(app);
    }
  }
  return getAuth(app);
}

export const auth = createSafeAuth();
export const db =
  firebaseConfig.firestoreDatabaseId && firebaseConfig.firestoreDatabaseId !== '(default)'
    ? getFirestore(app, firebaseConfig.firestoreDatabaseId)
    : getFirestore(app);
export const googleProvider = new GoogleAuthProvider();

// Suppress noisy internal SDK connection retry warnings when operating in local-first mode
try {
  setLogLevel('silent');
} catch {
  // ignore
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  };
}

export function isAuthTokenServiceError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error || '');
  const lower = msg.toLowerCase();
  return (
    lower.includes('token-service-api') ||
    lower.includes('securetoken.googleapis.com') ||
    lower.includes('fetching auth token failed') ||
    lower.includes('auth/invalid-user-token') ||
    lower.includes('auth/user-token-expired')
  );
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): void {
  if (isAuthTokenServiceError(error)) {
    void firebaseSignOut(auth).catch(() => {});
    return;
  }

  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData.map((provider) => ({
          providerId: provider.providerId,
          displayName: provider.displayName,
          email: provider.email,
          photoUrl: provider.photoURL,
        })) || [],
    },
    operationType,
    path,
  };
  console.warn('Firestore sync notice:', JSON.stringify(errInfo));
}

export async function testFirestoreConnection(): Promise<void> {
  try {
    if (auth.currentUser) {
      try {
        await auth.currentUser.getIdToken(false);
      } catch {
        await firebaseSignOut(auth);
      }
    }
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (isAuthTokenServiceError(error)) {
      await firebaseSignOut(auth).catch(() => {});
      return;
    }
    // Permission-denied on 'test/connection' is expected and confirms backend reachability.
  }
}

export async function signInWithGoogle(): Promise<User | null> {
  const result = await signInWithPopup(
    auth,
    googleProvider,
    browserPopupRedirectResolver
  );
  return result.user;
}

export async function signOutUser(): Promise<void> {
  await firebaseSignOut(auth);
}

export { onAuthStateChanged, type User };
