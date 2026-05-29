/**
 * RISC Zero proof backend — REAL zero-knowledge, via the `passport-prover` host CLI.
 *
 * What it adds over the dev backend: predicate truth is now *sound*. The guest
 * (`zkvm/methods/guest`) evaluates the predicate set over the private attribute openings
 * inside the zkVM and commits ONLY the public claim + the boolean result. A malicious prover
 * can no longer assert a false predicate — the receipt wouldn't verify.
 *
 * Still checked classically here (not yet in-circuit — documented next layer, S3.0):
 *   - issuer signature + agent-key binding via the embedded credential;
 *   - non-revocation (the Verifier does this against the cached root).
 * Moving those into the guest (commitment-opening + sig + nullifier checks) removes the last
 * trust in the embedded credential.
 *
 * Requires the prover binary (`cd zkvm && cargo build --release`); if absent, `prove`/`verify`
 * fail with a clear message rather than silently degrading.
 */
import { type AttributeValue, verifyCredential } from '@azkp/credential';
import { runProver } from './prover-cli.js';
import {
  type PassportProof,
  PassportProofSchema,
  type ProofBackend,
  type ProofClaim,
  type ProofVerifyResult,
  type ProveInput,
} from './types.js';

const BACKEND_ID = 'risc0' as const;

/** TS attribute value -> Rust `AttributeValue` enum tagging. */
function toRustAttr(value: AttributeValue): { Int: number } | { Text: string } {
  return typeof value === 'number' ? { Int: Math.trunc(value) } : { Text: value };
}

interface GuestClaim {
  issuer_id: string;
  issuer_pubkey: string;
  agent_pubkey: string;
  revocation_root: string;
  challenge: string;
}
interface ProveOut {
  journal: { claim: GuestClaim; predicates_hold: boolean };
  proof: string;
}
interface VerifyOut {
  ok: boolean;
  reason?: string;
  journal?: { claim: GuestClaim; predicates_hold: boolean };
}

function guestClaimFor(input: ProveInput): GuestClaim {
  return {
    issuer_id: input.credential.issuerId,
    issuer_pubkey: input.issuerPubkeyHex,
    agent_pubkey: input.credential.agentPubkey,
    revocation_root: input.revocationRoot,
    challenge: input.challenge,
  };
}

export class Risc0ProofBackend implements ProofBackend {
  readonly id = BACKEND_ID;

  async prove(input: ProveInput): Promise<PassportProof> {
    const now = input.now ?? Date.now();
    const guestInput = {
      predicates: input.predicates.map((p) => ({
        attribute: p.attribute,
        op: p.op,
        value: toRustAttr(p.value),
      })),
      attributes: Object.fromEntries(
        Object.entries(input.openings).map(([name, opening]) => [name, toRustAttr(opening.value)]),
      ),
      claim: guestClaimFor(input),
    };

    const out = (await runProver('prove', guestInput)) as ProveOut;
    if (!out.journal?.predicates_hold) {
      throw new Error('predicates do not hold over the credential attributes');
    }

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
    return { backend: BACKEND_ID, claim, proof: out.proof, credential: input.credential };
  }

  async verify(proof: PassportProof): Promise<ProofVerifyResult> {
    const parsed = PassportProofSchema.safeParse(proof);
    if (!parsed.success) return { ok: false, reason: 'malformed proof' };
    const p = parsed.data;
    if (p.backend !== BACKEND_ID) return { ok: false, reason: `wrong backend: ${p.backend}` };

    const out = (await runProver('verify', { proof: p.proof })) as VerifyOut;
    if (!out.ok || !out.journal)
      return { ok: false, reason: out.reason ?? 'receipt did not verify' };
    if (!out.journal.predicates_hold)
      return { ok: false, reason: 'predicates did not hold in-circuit' };

    // The zkVM journal must commit to exactly the claim we are asked to trust.
    const j = out.journal.claim;
    const c = p.claim;
    if (
      j.issuer_id !== c.issuerId ||
      j.issuer_pubkey !== c.issuerPubkey ||
      j.agent_pubkey !== c.agentPubkey ||
      j.revocation_root !== c.revocationRoot ||
      j.challenge !== c.challenge
    ) {
      return { ok: false, reason: 'journal does not match claim' };
    }

    // Issuer + agent binding still verified classically via the embedded credential.
    if (p.credential) {
      const credCheck = verifyCredential(c.issuerPubkey, p.credential);
      if (!credCheck.ok) return { ok: false, reason: `credential: ${credCheck.reason}` };
      if (p.credential.agentPubkey !== c.agentPubkey) {
        return { ok: false, reason: 'claim/credential agent mismatch' };
      }
    }
    return { ok: true };
  }
}

export const risc0ProofBackend = new Risc0ProofBackend();
