import crypto from 'crypto';
import type {
  ApprovalSigningPayload,
  ContentSigningService,
  SigningOutcome,
} from './types.ts';

/**
 * Deterministically serializes an ApprovalSigningPayload for asymmetric digital signing.
 * Fixed key order ensures bit-for-bit reproducible signatures across platforms.
 */
export function serializeApprovalPayloadForSigning(payload: ApprovalSigningPayload): string {
  const canonical = {
    checkpointId: payload.checkpointId,
    contentDigest: payload.contentDigest,
    contentVersion: payload.contentVersion,
    questionId: payload.questionId,
    reviewedAt: payload.reviewedAt,
    reviewerId: payload.reviewerId,
    reviewerUid: payload.reviewerUid,
    schemaVersion: payload.schemaVersion,
    subject: payload.subject,
    topicId: payload.topicId,
  };
  return JSON.stringify(canonical);
}

/**
 * Default fail-closed signing service used when Cloud KMS is unconfigured.
 * Strictly refuses to issue signatures or claim verification.
 */
export class DisabledSigningService implements ContentSigningService {
  readonly isConfigured = false;
  readonly serviceType = 'disabled' as const;

  async signApprovalPayload(_payload: ApprovalSigningPayload): Promise<SigningOutcome> {
    return {
      ok: false,
      code: 'kms_unconfigured',
      error: 'Content signing service is unconfigured. Managed Cloud KMS key is required to issue cryptographic approvals.',
    };
  }

  async verifyApprovalSignature(
    _payload: ApprovalSigningPayload,
    _signature: string,
    _keyId?: string
  ): Promise<boolean> {
    return false;
  }
}

/**
 * Cloud KMS Signing Service Specification & Architecture.
 *
 * PRODUCTION ARCHITECTURE:
 * - Uses Google Cloud KMS AsymmetricSign API with EC_SIGN_P256_SHA256 or RSA_SIGN_PSS_2048_SHA256.
 * - Private key resides inside Cloud KMS HSM; never leaves Google infrastructure or enters application memory.
 * - Key resource name: `projects/${PROJECT_ID}/locations/${LOCATION}/keyRings/${KEY_RING}/cryptoKeys/${KEY_NAME}/cryptoKeyVersions/${VERSION}`.
 * - The server sends SHA-256 digest of `serializeApprovalPayloadForSigning(payload)` to Cloud KMS.
 * - Cloud KMS returns DER-encoded ECDSA signature.
 * - Fails closed: If key configuration is missing, `isConfigured` is strictly false and operations fail.
 */
export interface CloudKmsConfig {
  readonly projectId: string;
  readonly locationId: string;
  readonly keyRingId: string;
  readonly cryptoKeyId: string;
  readonly cryptoKeyVersion: string;
}

export class CloudKmsSigningService implements ContentSigningService {
  readonly isConfigured: boolean;
  readonly serviceType = 'cloud_kms' as const;
  private readonly keyResourceName: string;

  constructor(config?: Partial<CloudKmsConfig>) {
    if (
      config?.projectId &&
      config?.locationId &&
      config?.keyRingId &&
      config?.cryptoKeyId &&
      config?.cryptoKeyVersion
    ) {
      this.keyResourceName = `projects/${config.projectId}/locations/${config.locationId}/keyRings/${config.keyRingId}/cryptoKeys/${config.cryptoKeyId}/cryptoKeyVersions/${config.cryptoKeyVersion}`;
      // In production, also verify GCP ADC or credentials exist
      this.isConfigured = Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.KMS_CREDENTIALS_CONFIGURED);
    } else {
      this.keyResourceName = '';
      this.isConfigured = false;
    }
  }

  async signApprovalPayload(payload: ApprovalSigningPayload): Promise<SigningOutcome> {
    if (!this.isConfigured) {
      return {
        ok: false,
        code: 'kms_unconfigured',
        error: `Cloud KMS is not configured. Key resource: ${this.keyResourceName || 'none'}. Approvals cannot be signed.`,
      };
    }

    // In a live GCP environment with @google-cloud/kms installed:
    // const client = new KeyManagementServiceClient();
    // const digest = crypto.createHash('sha256').update(serializeApprovalPayloadForSigning(payload)).digest();
    // const [result] = await client.asymmetricSign({ name: this.keyResourceName, digest: { sha256: digest } });
    // return { ok: true, signature: Buffer.from(result.signature).toString('base64'), keyId: this.keyResourceName, algorithm: 'ECDSA_P256_SHA256' };

    return {
      ok: false,
      code: 'kms_unconfigured',
      error: 'Cloud KMS live client credentials not active in this runtime.',
    };
  }

  async verifyApprovalSignature(
    _payload: ApprovalSigningPayload,
    _signature: string,
    _keyId?: string
  ): Promise<boolean> {
    if (!this.isConfigured) {
      return false;
    }
    return false;
  }
}

/**
 * Local Asymmetric Testing Signing Service.
 *
 * Exclusively for unit/integration testing of asymmetric ECDSA cryptographic logic.
 * Explicitly labeled as 'local_asymmetric_test' — never mistaken for production authority.
 */
export class LocalAsymmetricTestSigningService implements ContentSigningService {
  readonly isConfigured = true;
  readonly serviceType = 'local_asymmetric_test' as const;
  private readonly privateKey: crypto.KeyObject;
  private readonly publicKey: crypto.KeyObject;
  readonly keyId = 'test-key-p256-local-01';

  constructor() {
    const pair = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    this.privateKey = pair.privateKey;
    this.publicKey = pair.publicKey;
  }

  async signApprovalPayload(payload: ApprovalSigningPayload): Promise<SigningOutcome> {
    try {
      const canonical = serializeApprovalPayloadForSigning(payload);
      const sign = crypto.createSign('SHA256');
      sign.update(canonical);
      sign.end();
      const signature = sign.sign(this.privateKey, 'base64');
      return {
        ok: true,
        signature,
        keyId: this.keyId,
        algorithm: 'ECDSA_P256_SHA256',
      };
    } catch (err) {
      return {
        ok: false,
        code: 'signing_failed',
        error: err instanceof Error ? err.message : 'Asymmetric sign failure',
      };
    }
  }

  async verifyApprovalSignature(
    payload: ApprovalSigningPayload,
    signature: string,
    keyId?: string
  ): Promise<boolean> {
    if (keyId && keyId !== this.keyId) {
      return false;
    }
    try {
      const canonical = serializeApprovalPayloadForSigning(payload);
      const verify = crypto.createVerify('SHA256');
      verify.update(canonical);
      verify.end();
      return verify.verify(this.publicKey, signature, 'base64');
    } catch {
      return false;
    }
  }
}
