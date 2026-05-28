//! RISC Zero receipt verifier core (scaffold).
//!
//! The public inputs the guest commits to its journal — the verifier checks the receipt seal
//! against these without learning anything else. Verifying a real receipt needs `risc0-zkvm`
//! and the toolchain; this scaffold fixes the journal shape and returns `NotImplemented` so
//! the FFI surface and TS callers can be built against it. See .ai/specs/02-plan.md S3.1.

/// Public statement committed by the zkVM guest (mirrors `ProofClaim` in `packages/proof`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Journal {
    pub issuer_id: String,
    pub issuer_pubkey: String,
    pub agent_pubkey: String,
    pub revocation_root: String,
    pub challenge: String,
    pub predicates_hold: bool,
    pub not_revoked: bool,
}

#[derive(Debug, PartialEq, Eq)]
pub enum VerifyError {
    /// The RISC Zero backend is not wired yet (toolchain + guest pending).
    NotImplemented,
    BadSeal,
    JournalMismatch,
}

/// Verify a receipt seal binds the given journal. Returns `NotImplemented` until the RISC Zero
/// backend is wired (the TypeScript dev backend is authoritative for the v1 demo).
pub fn verify_receipt(_seal: &[u8], _journal: &Journal) -> Result<(), VerifyError> {
    Err(VerifyError::NotImplemented)
}

/// A fully-verified passport requires the guest to assert BOTH the predicates and non-revocation.
pub fn journal_accepts(journal: &Journal) -> bool {
    journal.predicates_hold && journal.not_revoked
}

#[cfg(test)]
mod tests {
    use super::*;

    fn journal(predicates_hold: bool, not_revoked: bool) -> Journal {
        Journal {
            issuer_id: "issuer.test".into(),
            issuer_pubkey: "aa".into(),
            agent_pubkey: "bb".into(),
            revocation_root: "cc".into(),
            challenge: "dd".into(),
            predicates_hold,
            not_revoked,
        }
    }

    #[test]
    fn accepts_only_when_predicates_and_non_revocation_hold() {
        assert!(journal_accepts(&journal(true, true)));
        assert!(!journal_accepts(&journal(true, false)));
        assert!(!journal_accepts(&journal(false, true)));
    }

    #[test]
    fn verify_is_not_implemented_yet() {
        assert_eq!(
            verify_receipt(&[], &journal(true, true)),
            Err(VerifyError::NotImplemented)
        );
    }
}
