# 99 — Acceptance & traceability

> Per-requirement traceability: each acceptance criterion from `00-requirements.md` →
> implementation → proving test → verdict. ✅ requires BOTH implementation AND a passing test.
> Status legend: ✅ done & tested · ⚠️ done with a documented limitation · ❌ not done.

**Gate evidence (2026-05-29):**
- `bun test` → **42 passed**, 0 fail (incl. broker-over-UDS boundary + reputation + Merkle).
- `bun test --coverage` → **89% funcs / 95.8% lines** (≥ 80% threshold met).
- `cargo test --workspace` → **9 passed** (zk-predicates 4, vault 2, verifier-core 2, prover 2), 0 fail.
- `bun run typecheck` (`tsc --noEmit`) → **clean**.
- `bunx biome check .` → **clean** (34 files).
- `cargo clippy --workspace --all-targets` → **clean**; `cargo fmt --check` → **clean**.
- `bun run demo` → **DEMO PASSED** (gated payment completed; revoked passport blocked).

---

## Requirements traceability

| # | Requirement (from 00-requirements) | Implementation | Test | Status |
|---|---|---|---|---|
| 1 | Spec published: credential schema, predicates, revocation model, vault/broker protocol | `.ai/specs/01-spec.md`, `docs/adr/0001-capability-protocol.md`, `docs/security/threat-model.md` | n/a (docs) | ✅ |
| 2 | Reference issuer mints a credential from ≥1 IdP, bound to an agent pubkey | `packages/issuer/src/issuer.ts`, `app.ts` | `apps/demo` E2E (onboard+mint) | ⚠️ mock OIDC; real OIDC/KYC pending (S2.1) |
| 3 | Agent SDK generates keys, holds credential, produces selective-disclosure proof | `packages/agent-sdk/src/index.ts`, `packages/proof/src/dev-backend.ts` | `packages/proof/test`, demo | ⚠️ proof is dev-ed25519 (sound binding, not yet ZK — S3.0) |
| 4 | Verifier validates a proof + checks revocation in < 100 ms, offline | `packages/verifier/src/index.ts`, `packages/transparency-log/src/revocation-checker.ts` | `packages/verifier/test` ("within the 100ms budget", revoked, replay, untrusted issuer) | ✅ |
| 5 | Vault + broker seal a secret with a master key; agent triggers ops but raw secret is unrecoverable | `packages/vault/src/vault.ts` (`withSecret`, no export), `packages/broker/src/broker.ts` | `apps/demo/test/exfiltration.test.ts` (6 channels), `packages/vault/test` | ⚠️ master key file-backed; HW-seal pending (S2.0) |
| 6 | Proof-gated capability: mintable only with a valid passport; revoked passport blocks minting | `packages/broker/src/broker.ts` (`mintCapabilities`), `capability.ts` | `packages/broker/test` ("refuses to mint when revoked", "revoking after minting blocks exec") | ✅ |
| 7 | E2E demo: agent completes a gated payment on a merchant rejecting un-passported traffic | `apps/demo/src/index.ts`, `packages/demo-merchant/src/index.ts` | `bun run demo` (401 for un-passported, 200 for passported) | ✅ |
| 8 | Threat model + security review (theft, replay, linkability, issuer/broker compromise, exfiltration) | `docs/security/threat-model.md`, spec §9 | exfiltration suite proves the central mitigation | ⚠️ documented + invariant tested; external review pending |
| — | Predicate logic for the future zkVM guest (shared semantics) | `crates/zk-predicates/src/lib.rs` | `cargo test` (4) | ✅ |

## Gaps & limitations (honest)

- **Zero-knowledge proving not yet wired.** `dev-ed25519` backend trusts the prover on predicate
  truth; sound ZK = RISC Zero backend (toolchain + `crates/zk-predicates` guest). Tracked S3.0.
- **Hardware sealing not yet wired.** Master key is a 0600 file; Secure Enclave/TPM/passkey is the
  target. The no-export invariant is independent of this and is tested. Tracked S2.0.
- ~~**Single-process demo.**~~ ✅ Resolved (S4.0): broker runs as a separate process over a
  Unix-domain socket (`@azkp/broker` server + `BrokerClient`, `bun run broker`), with a
  socket-boundary test (`packages/broker/test/uds.test.ts`). The in-process `bun run demo`
  keeps the broker as an object only for a single-file narrative.
- **L2 anchoring of the revocation root** is designed, not implemented. Tracked S3.2.
- ~~**Reputation layer (Phase 5)** has an accumulator but no SDK surface.~~ ✅ `ReputationService`
  (`packages/verifier/src/reputation.ts`) records outcomes against per-context, unlinkable
  pseudonyms and maps score → tier (flagged/new/established/trusted); wired into the demo + tested.
  (Full cross-context unlinkability still awaits the ZK backend — see the file's note.)
- Storage is in-memory (demo); SQLite/Drizzle is the production target.

## Verdict

**GOAL MET for the overnight target** — a runnable, tested, end-to-end demo in which a personal
agent completes a gated payment using a secret it provably never holds, gated by a proof-minted
capability and an offline verifier, with revocation enforced. The two cryptographic upgrades
(ZK proofs, hardware sealing) are scoped, interface-isolated, and tracked — not blockers to the
demonstrated invariant.
