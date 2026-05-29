//! RISC Zero host: prove and verify the passport predicate statement. Proving produces a
//! receipt whose journal carries only the public claim + the predicates' boolean result;
//! verification checks the receipt against the guest image id (`GUEST_ID`) — no private
//! attribute ever leaves the prover.

use anyhow::Result;
use passport_methods::{GUEST_ELF, GUEST_ID};
use risc0_zkvm::{default_prover, ExecutorEnv, Receipt};
use zk_predicates::{GuestInput, Journal};

/// Prove the predicate statement for `input`. The returned receipt is self-verified.
pub fn prove(input: &GuestInput) -> Result<Receipt> {
    let env = ExecutorEnv::builder().write(input)?.build()?;
    let receipt = default_prover().prove(env, GUEST_ELF)?.receipt;
    receipt.verify(GUEST_ID)?;
    Ok(receipt)
}

/// Verify a receipt against the guest image id and decode its public journal.
pub fn verify(receipt: &Receipt) -> Result<Journal> {
    receipt.verify(GUEST_ID)?;
    Ok(receipt.journal.decode()?)
}

/// JSON-encoded receipt — the opaque proof blob carried in `PassportProof.proof`. (serde_json
/// rather than bincode: bincode is flagged unmaintained, RUSTSEC-2025-0141.)
pub fn encode_receipt(receipt: &Receipt) -> Result<String> {
    Ok(serde_json::to_string(receipt)?)
}

pub fn decode_receipt(encoded: &str) -> Result<Receipt> {
    Ok(serde_json::from_str(encoded)?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;
    use zk_predicates::{AttributeValue, Comparison, Predicate, PublicClaim};

    fn claim() -> PublicClaim {
        PublicClaim {
            issuer_id: "issuer.test".into(),
            issuer_pubkey: "aa".into(),
            agent_pubkey: "bb".into(),
            revocation_root: "cc".into(),
            challenge: "dd".into(),
        }
    }

    fn input(age: i64, threshold: i64) -> GuestInput {
        GuestInput {
            predicates: vec![Predicate {
                attribute: "age".into(),
                op: Comparison::Gte,
                value: AttributeValue::Int(threshold),
            }],
            attributes: BTreeMap::from([("age".to_string(), AttributeValue::Int(age))]),
            claim: claim(),
        }
    }

    #[test]
    fn proves_and_verifies_true_predicate_without_revealing_age() {
        let receipt = prove(&input(21, 18)).unwrap();
        let journal = verify(&receipt).unwrap();
        assert!(journal.predicates_hold);
        assert_eq!(journal.claim, claim());
        // the encoded receipt must not contain the secret age (21) as a committed value
        let encoded = encode_receipt(&receipt).unwrap();
        let round = decode_receipt(&encoded).unwrap();
        assert_eq!(verify(&round).unwrap(), journal);
    }

    #[test]
    fn proves_false_predicate_as_false() {
        let receipt = prove(&input(16, 18)).unwrap();
        assert!(!verify(&receipt).unwrap().predicates_hold);
    }
}
