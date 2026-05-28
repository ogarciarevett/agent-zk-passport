import { randomBytes } from 'node:crypto';
/**
 * Master-key providers. The master key wraps each per-secret data key; it is the root of
 * the custody tree and must be the hardest thing to extract.
 *
 * Production target: a key generated in and never leaving the OS hardware boundary
 * (Apple Secure Enclave / TPM / passkey-derived). That provider is the next slice
 * (see crates/vault + .ai/specs/02-plan.md S2.0). For the reference demo we ship a
 * file-backed provider, clearly NOT hardware-sealed.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface MasterKeyProvider {
  readonly kind: string;
  /** Return the 32-byte master key. Implementations should avoid persisting it unwrapped. */
  getMasterKey(): Buffer;
}

/**
 * DEV ONLY. Persists a 32-byte key to a 0600 file. This does NOT provide hardware sealing —
 * anyone who can read the file gets the key. It exists so the demo runs without special
 * hardware. Do not use in production.
 */
export class FileMasterKeyProvider implements MasterKeyProvider {
  readonly kind = 'file-dev';
  constructor(private readonly path: string) {}

  getMasterKey(): Buffer {
    if (!existsSync(this.path)) {
      mkdirSync(dirname(this.path), { recursive: true });
      writeFileSync(this.path, randomBytes(32), { mode: 0o600 });
    }
    const key = readFileSync(this.path);
    if (key.length !== 32) throw new Error('corrupt master key file');
    return key;
  }
}

/** In-memory provider for tests — key lives only for the process lifetime. */
export class EphemeralMasterKeyProvider implements MasterKeyProvider {
  readonly kind = 'ephemeral';
  private readonly key = randomBytes(32);
  getMasterKey(): Buffer {
    return this.key;
  }
}
