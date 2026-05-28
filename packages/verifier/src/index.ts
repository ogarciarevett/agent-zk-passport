/**
 * Verifier — the drop-in a relying party (merchant, payment rail, or the broker itself) uses
 * to challenge an agent and validate its passport proof OFFLINE in < 100 ms. It composes:
 *   1. backend proof verification (claim is cryptographically bound),
 *   2. challenge/anti-replay,
 *   3. issuer trust + proof freshness,
 *   4. non-revocation against a cached signed root,
 *   5. (optional) that the proof's predicates satisfy the relying party's policy.
 * No issuer round-trip is required.
 */
import { type PredicateSet, describePredicate, randomHex } from '@azkp/credential';
import { type PassportProof, type ProofBackend, getProofBackend } from '@azkp/proof';
import type { RevocationChecker } from '@azkp/transparency-log';

export interface Challenge {
  nonce: string;
  issuedAt: number;
  expiresAt: number;
}

export interface VerifyResult {
  ok: boolean;
  reason?: string;
  claim?: PassportProof['claim'];
}

export interface VerifierConfig {
  /** issuer public keys this verifier trusts. */
  trustedIssuerPubkeys: string[];
  revocation: RevocationChecker;
  backend?: ProofBackend;
  challengeTtlMs?: number;
}

export class Verifier {
  private readonly backend: ProofBackend;
  private readonly challengeTtlMs: number;
  private readonly liveChallenges = new Map<string, number>(); // nonce -> expiresAt

  constructor(private readonly config: VerifierConfig) {
    this.backend = config.backend ?? getProofBackend('dev-ed25519');
    this.challengeTtlMs = config.challengeTtlMs ?? 60_000;
  }

  challenge(now: number = Date.now()): Challenge {
    const nonce = randomHex(16);
    const expiresAt = now + this.challengeTtlMs;
    this.liveChallenges.set(nonce, expiresAt);
    return { nonce, issuedAt: now, expiresAt };
  }

  /**
   * @param requiredPredicates if given, the proof's predicate set must be a superset
   *   (every required predicate must appear), so the relying party gets the guarantees it needs.
   */
  async verify(
    proof: PassportProof,
    challenge: Challenge,
    requiredPredicates?: PredicateSet,
    now: number = Date.now(),
  ): Promise<VerifyResult> {
    // 1. anti-replay: challenge must be one we issued, unused, unexpired, and matched by the proof.
    const liveExp = this.liveChallenges.get(challenge.nonce);
    if (liveExp === undefined) return { ok: false, reason: 'unknown or used challenge' };
    if (now > liveExp) {
      this.liveChallenges.delete(challenge.nonce);
      return { ok: false, reason: 'challenge expired' };
    }
    if (proof.claim.challenge !== challenge.nonce)
      return { ok: false, reason: 'challenge mismatch' };

    // 2. backend binds the claim.
    const backendResult = await this.backend.verify(proof);
    if (!backendResult.ok) return { ok: false, reason: backendResult.reason ?? 'proof rejected' };

    // 3. issuer trust + freshness.
    if (!this.config.trustedIssuerPubkeys.includes(proof.claim.issuerPubkey)) {
      return { ok: false, reason: 'untrusted issuer' };
    }
    if (now < proof.claim.notBefore || now > proof.claim.expiresAt) {
      return { ok: false, reason: 'proof not fresh' };
    }

    // 4. non-revocation under the bound root.
    const rev = this.config.revocation.check(
      proof.claim.revocationId,
      proof.claim.revocationRoot,
      now,
    );
    if (!rev.ok) return { ok: false, reason: rev.reason ?? 'revoked' };

    // 5. policy: required predicates must all be present.
    if (requiredPredicates) {
      const have = new Set(proof.claim.predicates.map(describePredicate));
      const missing = requiredPredicates.filter((p) => !have.has(describePredicate(p)));
      if (missing.length > 0) {
        return {
          ok: false,
          reason: `missing predicates: ${missing.map(describePredicate).join(', ')}`,
        };
      }
    }

    // single-use challenge
    this.liveChallenges.delete(challenge.nonce);
    return { ok: true, claim: proof.claim };
  }
}
