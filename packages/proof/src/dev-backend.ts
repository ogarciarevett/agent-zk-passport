/**
 * Development proof backend — REAL cryptography, but NOT zero-knowledge.
 *
 * What it soundly proves (verifier can trust these):
 *   - issuer binding: the embedded credential carries a valid issuer signature;
 *   - agent binding: the proof is signed by the private key matching the credential's
 *     agentPubkey, so it can't be presented by another agent;
 *   - freshness + anti-replay: notBefore/expiresAt + the verifier's challenge nonce.
 *
 * What it does NOT yet soundly prove (the part real ZK provides):
 *   - predicate soundness: the prover asserts that the predicates hold over the hidden
 *     attributes after checking them locally. A *malicious* prover could assert false
 *     predicates — only the RISC Zero backend (crates/zk-predicates) makes this sound,
 *     by proving `f(openings) = true` against the commitments inside the circuit.
 *   - hiding: this backend embeds the credential (commitments only, never raw attributes),
 *     so attributes stay hidden, but the revocationId is revealed in the clear.
 *
 * This backend exists so the end-to-end system (vault, broker, capabilities, verifier,
 * payments demo) is runnable and testable today. See .ai/specs/02-plan.md S3.0.
 */
import {
  canonicalJson,
  evaluatePredicateSet,
  signMessage,
  verifyCredential,
  verifyMessage,
} from '@azkp/credential';
import {
  type PassportProof,
  PassportProofSchema,
  type ProofBackend,
  type ProofClaim,
  type ProofVerifyResult,
  type ProveInput,
} from './types.js';

const BACKEND_ID = 'dev-ed25519' as const;

/** Canonical bytes the agent signs: the public claim plus the issuer-signed credential. */
function bindingInput(claim: ProofClaim, credential: unknown): string {
  return canonicalJson({ claim, credential });
}

export class DevProofBackend implements ProofBackend {
  readonly id = BACKEND_ID;

  async prove(input: ProveInput): Promise<PassportProof> {
    const now = input.now ?? Date.now();

    // Fail closed if the holder's own attributes don't satisfy the statement.
    if (!evaluatePredicateSet(input.predicates, input.openings)) {
      throw new Error('predicates do not hold over the credential attributes');
    }
    const credCheck = verifyCredential(input.issuerPubkeyHex, input.credential, now);
    if (!credCheck.ok) throw new Error(`cannot prove on invalid credential: ${credCheck.reason}`);

    const claim: ProofClaim = {
      issuerId: input.credential.issuerId,
      issuerPubkey: input.issuerPubkeyHex,
      agentPubkey: input.credential.agentPubkey,
      predicates: input.predicates,
      revocationRoot: input.revocationRoot,
      revocationId: input.credential.revocationId,
      challenge: input.challenge,
      notBefore: now,
      expiresAt: now + input.validityMs,
    };

    const proof = signMessage(input.agentPrivateKeyHex, bindingInput(claim, input.credential));
    return { backend: BACKEND_ID, claim, proof, credential: input.credential };
  }

  async verify(proof: PassportProof): Promise<ProofVerifyResult> {
    const parsed = PassportProofSchema.safeParse(proof);
    if (!parsed.success) return { ok: false, reason: 'malformed proof' };
    const p = parsed.data;
    if (p.backend !== BACKEND_ID) return { ok: false, reason: `wrong backend: ${p.backend}` };
    if (!p.credential) return { ok: false, reason: 'dev backend requires embedded credential' };

    // Agent binding: signed by the key the credential is bound to.
    const binding = bindingInput(p.claim, p.credential);
    if (!verifyMessage(p.claim.agentPubkey, binding, p.proof)) {
      return { ok: false, reason: 'bad agent signature' };
    }
    if (p.credential.agentPubkey !== p.claim.agentPubkey) {
      return { ok: false, reason: 'claim/credential agent mismatch' };
    }
    // Issuer binding.
    const credCheck = verifyCredential(p.claim.issuerPubkey, p.credential);
    if (!credCheck.ok) return { ok: false, reason: `credential: ${credCheck.reason}` };
    if (p.credential.revocationId !== p.claim.revocationId) {
      return { ok: false, reason: 'claim/credential revocationId mismatch' };
    }
    return { ok: true };
  }
}

export const devProofBackend = new DevProofBackend();
