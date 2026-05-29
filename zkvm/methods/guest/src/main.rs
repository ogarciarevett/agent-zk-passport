//! Passport predicate guest. Runs INSIDE the zkVM: it reads the private attribute openings +
//! the public claim, evaluates the predicate set, and commits only the public claim plus the
//! boolean result. The attributes are the zk witness and never enter the journal — this is the
//! sound, zero-knowledge replacement for the dev backend's "trust the prover" step.
//!
//! Next layer (documented, not yet in-circuit): also verify the commitment openings, the issuer
//! signature, the agent-key binding, and non-revocation inside the guest. See .ai/specs/02-plan.md S3.0.
use risc0_zkvm::guest::env;
use zk_predicates::{evaluate_all, GuestInput, Journal};

fn main() {
    let input: GuestInput = env::read();
    let predicates_hold = evaluate_all(&input.predicates, &input.attributes).unwrap_or(false);
    env::commit(&Journal { claim: input.claim, predicates_hold });
}
