/**
 * Verifier-side revocation checker. Holds the trusted log public key and a cached snapshot,
 * so non-revocation is verified OFFLINE in microseconds (no network round-trip) — this is
 * what keeps the verifier inside its < 100 ms budget. Reject roots older than `maxStalenessMs`.
 */
import { canonicalJson, verifyMessage } from '@azkp/credential';
import type { LogSnapshot, SignedRoot } from './log.js';
import { merkleRoot } from './merkle.js';

export interface RevocationCheckResult {
  ok: boolean;
  reason?: string;
}

export function verifySignedRoot(trustedLogPubkey: string, signed: SignedRoot, now: number): RevocationCheckResult {
  if (signed.logPubkey !== trustedLogPubkey) return { ok: false, reason: 'untrusted log key' };
  const { signature, ...unsigned } = signed;
  if (!verifyMessage(trustedLogPubkey, canonicalJson(unsigned), signature)) {
    return { ok: false, reason: 'bad log-root signature' };
  }
  return { ok: true };
}

export class RevocationChecker {
  private snapshot: LogSnapshot;
  private revokedSet: Set<string>;

  constructor(
    private readonly trustedLogPubkey: string,
    snapshot: LogSnapshot,
    private readonly maxStalenessMs = 5 * 60_000,
  ) {
    this.snapshot = snapshot;
    this.revokedSet = new Set(snapshot.revoked);
  }

  /** Replace the cached snapshot (e.g. after polling/anchor refresh). Validates the root. */
  update(snapshot: LogSnapshot, now: number = Date.now()): RevocationCheckResult {
    const rootOk = verifySignedRoot(this.trustedLogPubkey, snapshot.signedRoot, now);
    if (!rootOk.ok) return rootOk;
    if (merkleRoot(snapshot.revoked) !== snapshot.signedRoot.root) {
      return { ok: false, reason: 'snapshot does not match signed root' };
    }
    this.snapshot = snapshot;
    this.revokedSet = new Set(snapshot.revoked);
    return { ok: true };
  }

  get root(): string {
    return this.snapshot.signedRoot.root;
  }

  /**
   * Confirm a credential is not revoked under a fresh, signed root that matches the root the
   * proof was bound to.
   */
  check(revocationId: string, boundRoot: string, now: number = Date.now()): RevocationCheckResult {
    const rootOk = verifySignedRoot(this.trustedLogPubkey, this.snapshot.signedRoot, now);
    if (!rootOk.ok) return rootOk;
    if (now - this.snapshot.signedRoot.issuedAt > this.maxStalenessMs) {
      return { ok: false, reason: 'revocation root is stale' };
    }
    if (boundRoot !== this.snapshot.signedRoot.root) {
      return { ok: false, reason: 'proof bound to a different revocation root' };
    }
    if (this.revokedSet.has(revocationId)) return { ok: false, reason: 'credential revoked' };
    return { ok: true };
  }
}
