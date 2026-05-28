/**
 * Signed Merkle transparency log. Operator-side. Holds the revocation status list and
 * pseudonymous reputation attestations, and publishes a signed root that verifiers cache and
 * check offline. In production the root is periodically anchored to an L2 (viem) for
 * tamper-evidence; that anchoring job is a later slice (see .ai/specs/02-plan.md S3.2).
 */
import {
  type Ed25519KeyPair,
  canonicalJson,
  generateEd25519KeyPair,
  signMessage,
} from '@azkp/credential';
import { merkleRoot } from './merkle.js';

export interface SignedRoot {
  /** Merkle root over the revoked-id set. */
  root: string;
  /** number of revoked ids committed. */
  size: number;
  /** monotonically increasing publication sequence. */
  seq: number;
  issuedAt: number;
  logPubkey: string;
  signature: string;
}

export interface AttestationEntry {
  pseudonym: string;
  verifierId: string;
  outcome: 'success' | 'failure';
  weight: number;
  at: number;
}

export interface LogSnapshot {
  revoked: string[];
  signedRoot: SignedRoot;
}

export class TransparencyLog {
  private readonly revoked = new Set<string>();
  private readonly attestations: AttestationEntry[] = [];
  private seq = 0;
  private readonly keys: Ed25519KeyPair;

  constructor(keys: Ed25519KeyPair = generateEd25519KeyPair()) {
    this.keys = keys;
  }

  get logPubkey(): string {
    return this.keys.publicKey;
  }

  revoke(revocationId: string): SignedRoot {
    this.revoked.add(revocationId);
    return this.signRoot();
  }

  isRevoked(revocationId: string): boolean {
    return this.revoked.has(revocationId);
  }

  /** Append a reputation attestation against a pseudonym (Phase 5 accumulator). */
  attest(entry: Omit<AttestationEntry, 'at'> & { at?: number }): void {
    this.attestations.push({ ...entry, at: entry.at ?? Date.now() });
  }

  reputation(pseudonym: string): { score: number; count: number } {
    const mine = this.attestations.filter((a) => a.pseudonym === pseudonym);
    const score = mine.reduce((s, a) => s + (a.outcome === 'success' ? a.weight : -a.weight), 0);
    return { score, count: mine.length };
  }

  currentRoot(): SignedRoot {
    return this.signRoot(false);
  }

  snapshot(): LogSnapshot {
    return { revoked: [...this.revoked].sort(), signedRoot: this.currentRoot() };
  }

  private signRoot(bumpSeq = true): SignedRoot {
    if (bumpSeq) this.seq += 1;
    const root = merkleRoot([...this.revoked]);
    const unsigned = {
      root,
      size: this.revoked.size,
      seq: this.seq,
      issuedAt: Date.now(),
      logPubkey: this.keys.publicKey,
    };
    return { ...unsigned, signature: signMessage(this.keys.privateKey, canonicalJson(unsigned)) };
  }
}

export { merkleRoot } from './merkle.js';
