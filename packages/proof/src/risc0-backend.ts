/**
 * RISC Zero proof backend — production target, NOT yet wired.
 *
 * This is the sound, zero-knowledge replacement for the dev backend. The prover runs the
 * guest in `crates/zk-predicates` (via the host in `crates/prover`), which proves, inside
 * the zkVM:
 *   - knowledge of openings to the credential's commitments such that the predicates hold;
 *   - knowledge of the agent private key bound to the credential;
 *   - the issuer signature over the credential is valid;
 *   - the revocationId is NOT a member of the status-list at `revocationRoot`.
 * The journal exposes only the public claim; the receipt seal is the `proof` string.
 *
 * It is stubbed here behind the same ProofBackend interface so that swapping backends is a
 * one-line change once the RISC Zero toolchain (`rzup`) and the FFI bridge land
 * (see .ai/specs/02-plan.md S3.0 / S3.1). Calling it today throws a clear error rather than
 * silently degrading security.
 */
import type { PassportProof, ProofBackend, ProofVerifyResult, ProveInput } from './types.js';

const NOT_WIRED =
  'risc0 backend not wired yet: requires the RISC Zero toolchain + crates/zk-predicates ' +
  'guest and the napi FFI bridge (see .ai/specs/02-plan.md S3.0/S3.1). Use devProofBackend ' +
  'for the reference demo.';

export class Risc0ProofBackend implements ProofBackend {
  readonly id = 'risc0' as const;

  async prove(_input: ProveInput): Promise<PassportProof> {
    throw new Error(NOT_WIRED);
  }

  async verify(_proof: PassportProof): Promise<ProofVerifyResult> {
    return { ok: false, reason: NOT_WIRED };
  }
}

export const risc0ProofBackend = new Risc0ProofBackend();
