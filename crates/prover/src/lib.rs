//! RISC Zero host (scaffold).
//!
//! Runs the `zk-predicates` logic inside the zkVM guest and produces a receipt whose journal
//! is a [`verifier_core::Journal`]. Local proving + remote (Bonsai) are both planned. Wiring
//! needs `risc0-zkvm` and the toolchain (`rzup`); until then `prove` returns `NotImplemented`
//! and the runnable proofs come from the TypeScript dev backend. See .ai/specs/02-plan.md S3.0.

use verifier_core::Journal;

#[derive(Debug, PartialEq, Eq)]
pub enum ProveError {
    NotImplemented,
}

/// A produced proof: the receipt seal plus the public journal it commits.
pub struct Receipt {
    pub seal: Vec<u8>,
    pub journal: Journal,
}

/// Produce a passport receipt. Not yet wired (needs the RISC Zero toolchain + guest).
pub fn prove(_journal: Journal) -> Result<Receipt, ProveError> {
    Err(ProveError::NotImplemented)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;
    use zk_predicates::{evaluate_all, AttributeValue, Comparison, Predicate};

    #[test]
    fn predicate_core_is_reused_by_the_host() {
        // The host evaluates predicates via the shared crate before proving them in-circuit.
        let attrs = BTreeMap::from([("age".to_string(), AttributeValue::Int(21))]);
        let preds = vec![Predicate {
            attribute: "age".into(),
            op: Comparison::Gte,
            value: AttributeValue::Int(18),
        }];
        assert_eq!(evaluate_all(&preds, &attrs), Ok(true));
    }

    #[test]
    fn prove_is_not_implemented_yet() {
        let journal = Journal {
            issuer_id: "i".into(),
            issuer_pubkey: "a".into(),
            agent_pubkey: "b".into(),
            revocation_root: "c".into(),
            challenge: "d".into(),
            predicates_hold: true,
            not_revoked: true,
        };
        assert_eq!(
            prove(journal).map(|_| ()).unwrap_err(),
            ProveError::NotImplemented
        );
    }
}
