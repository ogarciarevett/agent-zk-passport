/**
 * Proof types shared by every backend. A `PassportProof` is what an agent presents to a
 * verifier or to the broker. The public statement lives in `claim`; `proof` is the
 * backend-specific evidence that binds the claim.
 */
import { type Credential, type PredicateSet, PredicateSetSchema } from '@azkp/credential';
import { z } from 'zod';

const HexString = z.string().regex(/^[0-9a-f]+$/);

/** The public statement a proof attests to. Reveals predicate *results*, not attributes. */
export const ProofClaimSchema = z.object({
  issuerId: z.string().min(1),
  issuerPubkey: HexString,
  agentPubkey: HexString,
  predicates: PredicateSetSchema,
  /** revocation status-list root this proof is valid against. */
  revocationRoot: HexString,
  /** opaque revocation handle, checked for non-membership against the root. */
  revocationId: HexString,
  /** verifier-supplied nonce, binds the proof to one challenge (anti-replay). */
  challenge: HexString,
  notBefore: z.number().int().nonnegative(),
  expiresAt: z.number().int().nonnegative(),
});
export type ProofClaim = z.infer<typeof ProofClaimSchema>;

export const ProofBackendId = z.enum(['dev-ed25519', 'risc0']);
export type ProofBackendId = z.infer<typeof ProofBackendId>;

export const PassportProofSchema = z.object({
  backend: ProofBackendId,
  claim: ProofClaimSchema,
  /** backend-specific evidence (dev: agent signature; risc0: receipt seal, base64). */
  proof: z.string().min(1),
  /**
   * The issuer-signed credential. Present for the dev backend (which re-checks the issuer
   * signature). A real zk backend proves issuer-binding inside the circuit and omits this.
   */
  credential: z.custom<Credential>().optional(),
});
export type PassportProof = z.infer<typeof PassportProofSchema>;

/** Inputs the holder feeds the prover. Contains private material — never leaves the agent. */
export interface ProveInput {
  credential: Credential;
  /** openings to the credential's commitments (private). */
  openings: import('@azkp/credential').OpeningMap;
  /** agent private key (PKCS#8 hex) — proves key ownership; never disclosed. */
  agentPrivateKeyHex: string;
  issuerPubkeyHex: string;
  predicates: PredicateSet;
  revocationRoot: string;
  challenge: string;
  /** how long the proof stays fresh, ms. */
  validityMs: number;
  now?: number;
}

export interface ProofVerifyResult {
  ok: boolean;
  reason?: string;
}

/** A swappable proving backend. The verifier composes `verify` with universal checks. */
export interface ProofBackend {
  readonly id: ProofBackendId;
  prove(input: ProveInput): Promise<PassportProof>;
  /** Verify that `proof.proof` cryptographically binds `proof.claim`. */
  verify(proof: PassportProof): Promise<ProofVerifyResult>;
}
