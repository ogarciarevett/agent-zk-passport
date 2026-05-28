/**
 * The sealed vault — one of only two components that ever touch plaintext secret material
 * (the other is the broker that drives it). Secrets are envelope-encrypted: a random 32-byte
 * data key encrypts the secret (AES-256-GCM); the master key wraps the data key. The
 * unwrapped data key is never persisted.
 *
 * CRITICAL invariant: there is NO method that returns a plaintext secret. The only access is
 * `withSecret`, which exposes the plaintext to a callback for the duration of one operation
 * and zeroizes the working copy afterwards. Callers (the broker) return operation *results*,
 * never the secret.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { z } from 'zod';

export const SecretType = z.enum(['api_key', 'oauth', 'eth_key', 'generic']);
export type SecretType = z.infer<typeof SecretType>;

/** Policy attached to a secret — what operations/scopes the broker may perform with it. */
export const SecretPolicySchema = z.object({
  /** broker operations allowed, e.g. 'http_proxy', 'sign', 'oauth_refresh'. */
  operations: z.array(z.string()).min(1),
  /** allow-list of scopes, e.g. host:method:path patterns or chain addresses. */
  scopes: z.array(z.string()).default([]),
  /** predicates a passport must satisfy before a capability over this secret can mint. */
  requiredPredicates: z
    .array(
      z.object({ attribute: z.string(), op: z.string(), value: z.union([z.number(), z.string()]) }),
    )
    .default([]),
  maxUsesPerCapability: z.number().int().positive().default(1),
  capabilityTtlMs: z.number().int().positive().default(60_000),
});
export type SecretPolicy = z.infer<typeof SecretPolicySchema>;

export interface SealedRecord {
  id: string;
  type: SecretType;
  policy: SecretPolicy;
  metadata: Record<string, string>;
  /** envelope: secret ciphertext + wrapped data key. No plaintext, no unwrapped data key. */
  envelope: {
    secret: { iv: string; ct: string; tag: string };
    wrappedDataKey: { iv: string; ct: string; tag: string };
  };
}

/** Public view of a record — safe to expose; contains zero secret material. */
export interface RecordInfo {
  id: string;
  type: SecretType;
  policy: SecretPolicy;
  metadata: Record<string, string>;
}

export interface VaultStore {
  put(record: SealedRecord): void;
  get(id: string): SealedRecord | undefined;
  list(): SealedRecord[];
}

export class MemoryVaultStore implements VaultStore {
  private readonly records = new Map<string, SealedRecord>();
  put(record: SealedRecord): void {
    this.records.set(record.id, record);
  }
  get(id: string): SealedRecord | undefined {
    return this.records.get(id);
  }
  list(): SealedRecord[] {
    return [...this.records.values()];
  }
}

import type { MasterKeyProvider } from './master-key.js';

function aeadEncrypt(key: Buffer, plaintext: Buffer): { iv: string; ct: string; tag: string } {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    iv: iv.toString('hex'),
    ct: ct.toString('hex'),
    tag: cipher.getAuthTag().toString('hex'),
  };
}

function aeadDecrypt(key: Buffer, blob: { iv: string; ct: string; tag: string }): Buffer {
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(blob.iv, 'hex'));
  decipher.setAuthTag(Buffer.from(blob.tag, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(blob.ct, 'hex')), decipher.final()]);
}

export interface PutSecretInput {
  id: string;
  type: SecretType;
  secret: string | Buffer;
  policy: SecretPolicy;
  metadata?: Record<string, string>;
}

export class SealedVault {
  constructor(
    private readonly masterKeys: MasterKeyProvider,
    private readonly store: VaultStore = new MemoryVaultStore(),
  ) {}

  /** Seal a secret under a fresh per-secret data key wrapped by the master key. */
  putSecret(input: PutSecretInput): RecordInfo {
    const policy = SecretPolicySchema.parse(input.policy);
    const plaintext = Buffer.isBuffer(input.secret)
      ? input.secret
      : Buffer.from(input.secret, 'utf8');
    const dataKey = randomBytes(32);
    const master = this.masterKeys.getMasterKey();
    try {
      const record: SealedRecord = {
        id: input.id,
        type: input.type,
        policy,
        metadata: input.metadata ?? {},
        envelope: {
          secret: aeadEncrypt(dataKey, plaintext),
          wrappedDataKey: aeadEncrypt(master, dataKey),
        },
      };
      this.store.put(record);
      return this.info(record);
    } finally {
      dataKey.fill(0);
      if (Buffer.isBuffer(input.secret)) {
        // caller owns it; do not zero their buffer here
      } else {
        plaintext.fill(0);
      }
    }
  }

  getInfo(id: string): RecordInfo | undefined {
    const record = this.store.get(id);
    return record ? this.info(record) : undefined;
  }

  list(): RecordInfo[] {
    return this.store.list().map((r) => this.info(r));
  }

  /**
   * Use a secret for the duration of one operation. The plaintext is exposed ONLY inside
   * `fn` and the working copy is zeroized afterwards. There is deliberately no method that
   * returns the plaintext to a caller.
   */
  withSecret<T>(id: string, fn: (plaintext: Buffer, info: RecordInfo) => T): T {
    const record = this.store.get(id);
    if (!record) throw new Error(`no secret '${id}'`);
    const master = this.masterKeys.getMasterKey();
    const dataKey = aeadDecrypt(master, record.envelope.wrappedDataKey);
    let plaintext: Buffer | undefined;
    try {
      plaintext = aeadDecrypt(dataKey, record.envelope.secret);
      return fn(plaintext, this.info(record));
    } finally {
      dataKey.fill(0);
      plaintext?.fill(0);
    }
  }

  private info(record: SealedRecord): RecordInfo {
    return { id: record.id, type: record.type, policy: record.policy, metadata: record.metadata };
  }
}
