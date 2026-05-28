//! Hardware-sealed vault — Rust trait surface for the production custody core.
//!
//! The single most important property, expressed in the type system: there is NO method that
//! returns plaintext secret material. The only access is [`SealedVault::with_secret`], which
//! lends the plaintext to a closure for one operation. A real implementation seals the master
//! key in the OS hardware boundary (Secure Enclave / TPM / passkey) and wraps per-secret data
//! keys with it. See .ai/specs/02-plan.md S2.0; the runnable v1 lives in `packages/vault`.

use std::collections::BTreeMap;

/// What the broker is allowed to do with a secret.
#[derive(Debug, Clone)]
pub struct SecretPolicy {
    pub operations: Vec<String>,
    pub scopes: Vec<String>,
    pub max_uses_per_capability: u32,
    pub capability_ttl_ms: u64,
}

/// Public, secret-free view of a stored record.
#[derive(Debug, Clone)]
pub struct RecordInfo {
    pub id: String,
    pub policy: SecretPolicy,
    pub metadata: BTreeMap<String, String>,
}

/// Provides the master key, which must never leave the hardware boundary in a real impl.
pub trait MasterKeyProvider {
    fn master_key(&self) -> [u8; 32];
}

/// The sealed vault surface. Note the deliberate ABSENCE of `get_secret`/`export_secret`.
pub trait SealedVault {
    /// Public metadata only — never secret material.
    fn info(&self, id: &str) -> Option<RecordInfo>;

    /// Lend the plaintext secret to `f` for exactly one operation, then zeroize.
    /// Returns the closure's result (an operation result — never the secret).
    fn with_secret<T>(&self, id: &str, f: &mut dyn FnMut(&[u8], &RecordInfo) -> T) -> Option<T>;
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A trivial in-memory impl used to exercise the `with_secret` lending contract. (The real
    /// crate will envelope-encrypt; this test asserts the surface shape, not the crypto.)
    struct TestVault {
        secret: Vec<u8>,
        info: RecordInfo,
    }

    impl SealedVault for TestVault {
        fn info(&self, id: &str) -> Option<RecordInfo> {
            (id == self.info.id).then(|| self.info.clone())
        }
        fn with_secret<T>(
            &self,
            id: &str,
            f: &mut dyn FnMut(&[u8], &RecordInfo) -> T,
        ) -> Option<T> {
            if id != self.info.id {
                return None;
            }
            Some(f(&self.secret, &self.info))
        }
    }

    fn vault() -> TestVault {
        TestVault {
            secret: b"sk_live_TOPSECRET".to_vec(),
            info: RecordInfo {
                id: "k".into(),
                policy: SecretPolicy {
                    operations: vec!["sign".into()],
                    scopes: vec![],
                    max_uses_per_capability: 1,
                    capability_ttl_ms: 60_000,
                },
                metadata: BTreeMap::new(),
            },
        }
    }

    #[test]
    fn with_secret_lends_plaintext_and_returns_a_result() {
        let v = vault();
        // the closure returns a length (a derived result), not the secret itself
        let len = v.with_secret("k", &mut |s, _| s.len());
        assert_eq!(len, Some("sk_live_TOPSECRET".len()));
    }

    #[test]
    fn info_carries_no_secret() {
        let v = vault();
        assert!(v.info("k").is_some());
        assert!(v.info("nope").is_none());
    }
}
