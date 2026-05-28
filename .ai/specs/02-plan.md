# 02 — Build plan (task breakdown)

> Dependency-ordered vertical slices derived from the approved `01-spec.md`. Each slice must
> typecheck, have tests, and leave the tree green before the next. `✅ = impl + passing test`.
> Mirrors the 5 Linear milestones on the [`agent-zk-passport`](https://linear.app/claw-village/project/agent-zk-passport-f28af2c581a7)
> project. **Note:** the Linear workspace hit its free-tier *issue* limit — the 5 milestones
> were created, but the per-slice issues below could not be. Paste them into Linear once the
> limit is lifted (each slice = one issue under its phase milestone).

- Status: **active**
- Derives from: [`01-spec.md`](./01-spec.md) (APPROVED 2026-05-29)

## Priority

Must-have core for the headline demo: S2.0 (vault) → S2.1 (issuer) → S2.2 (SDK) →
S3.0–3.1 (prover + verifier) → S4.0–4.2 (broker + exfil test + payments demo). The
transparency-log/anchor (S3.2) and reputation (S5.0) can trail. The secret-exfiltration
test (S4.2) is non-negotiable — it proves the project's core invariant.

---

## Phase 1 — Spec + threat model

### S1.0 — Credential schema + predicate spec  ⟸ start here
Files: `packages/credential/*` (Zod schemas, encode/decode)
- Compact, VC-mappable credential format; stores attribute *commitments*, never raw attributes.
- Predicate language (`owner_age ≥ 18 ∧ not_revoked ∧ daily_spend ≤ $200`).
- **Acceptance:** schema round-trips; commitment ≠ attribute proven by test; imported by ≥1 other package.

### S1.1 — Vault/broker capability protocol spec
Files: `docs/adr/0001-capability-protocol.md`, `packages/credential` (Capability/Op types)
- Document proof→capability→exec; Biscuit caveats (secret_id, operation, scope, expires_at, max_uses, bound_proof_hash).
- **Acceptance:** ADR merged; capability/op types defined and validated.

### S1.2 — Threat model + security review doc
Files: `docs/security/threat-model.md`
- One mitigation per threat (exfiltration, theft/replay, linkability, issuer/broker compromise, stale revocation, secrets-in-logs).
- **Acceptance:** every §9 spec threat has a row + mitigation + which slice enforces it.

## Phase 2 — Vault + reference issuer + agent SDK

### S2.0 — Hardware-sealed vault  (secret-bearing)
Files: `crates/vault/*`
- Master key never leaves OS hardware boundary (Secure Enclave/TPM/passkey); per-secret data keys wrapped by it; never persist an unwrapped data key.
- **Acceptance:** seal/unseal round-trips; test asserts no unwrapped data key hits disk; optional user-presence gate.

### S2.1 — Reference issuer service (Hono)
Files: `packages/issuer/*`
- Onboard via one IdP (candidate OIDC), mint credential bound to agent pubkey (commitments only), publish `/.well-known/issuer-keys`, push revocations.
- **Acceptance:** minted credential verifies against published key; bound to the presented agent pubkey; mocked IdP in tests (no live calls).

### S2.2 — Agent SDK (keys · store · proof client)
Files: `packages/agent-sdk/*`
- Keypair gen, credential store, proof orchestration via Rust prover, present-to-verifier. Holds NO raw secrets.
- **Acceptance:** generate→store→prove happy path; SDK surface has no secret-bearing field.

## Phase 3 — Prover + verifier + revocation

### S3.0 — RISC Zero predicate guest + host prover
Files: `crates/zk-predicates/*`, `crates/prover/*`
- Guest proves `f(attributes)=true` over commitments, journal emits boolean + non-revocation. Host: local prover + optional Bonsai. Measure latency → set capability TTL.
- **Acceptance:** valid witness → verifiable receipt; tampered witness rejected; latency recorded in memory/ADR.

### S3.1 — Verifier-core (Rust) + TS binding  (< 100 ms)
Files: `crates/verifier-core/*`, `packages/verifier/*`
- Verify receipt + journal offline (issuer pubkey + cached revocation root); napi/FFI to TS.
- **Acceptance:** challenge→verify happy path; p99 < 100 ms benchmark; rejects revoked/expired.

### S3.2 — Transparency log + L2 anchor
Files: `packages/transparency-log/*`
- Append-only signed Merkle log (status-list); periodic root anchor to an L2 (candidate Base Sepolia) via viem; staleness threshold.
- **Acceptance:** append+inclusion-proof verifies; verifier rejects root older than threshold; chain RPC mocked in unit tests.

## Phase 4 — Broker capabilities + payments demo

### S4.0 — Broker capability minting (proof → Biscuit)  (secret-bearing)
Files: `packages/broker/*` (mint path), Rust FFI to `crates/verifier-core`
- Verify proof + revocation → mint scoped short-lived Biscuit caps. IPC over Unix domain socket only (no network port).
- **Acceptance:** valid proof mints scoped cap; expired/revoked passport blocks minting; cap has bounded TTL/max-uses.

### S4.1 — Broker exec (egress proxy · signer · OAuth refresh)
Files: `packages/broker/*` (exec path), `crates/vault` integration
- `exec(cap, op)` returns results only; egress proxy injects API keys; signs with sealed keys; refreshes OAuth. No export endpoint.
- **Acceptance:** signed op + proxied API call succeed; capability scope enforced; no secret in any response.

### S4.2 — Secret-exfiltration test  (NON-NEGOTIABLE invariant gate)
Files: `packages/broker/__tests__/*`, log-redaction layer
- Prove raw secret unrecoverable from agent side: memory, logs, errors, proof witnesses, IPC responses. pino redaction assertion.
- **Acceptance:** test fails if any path leaks key bytes/tokens; runs in CI gate.

### S4.3 — E2E payments demo + sample merchant
Files: `packages/demo-merchant/*`, e2e harness
- Merchant rejects un-passported traffic; agent presents passport → mints cap → completes gated payment with a secret it never sees.
- **Acceptance:** un-passported request rejected; passported agent completes payment end-to-end.

## Phase 5 — Reputation layer

### S5.0 — Pseudonymous attestation accumulator + reputation hooks
Files: `packages/transparency-log/*` (attest path), `packages/verifier` (attest API)
- Verifiers attest success to a per-context pseudonym; portable reputation that doesn't leak the human; read API feeds reputation-tier predicates.
- **Acceptance:** attestation appends + reads back; pseudonyms unlinkable across contexts (test); reputation tier usable in a predicate.

---

## Parallel-work notes

- **File-disjoint, safe to parallelize:** S2.0 (Rust vault) ‖ S2.1 (issuer) ‖ S3.0 (Rust prover)
  can proceed concurrently once S1.0 (shared schemas) lands.
- **Coupled — keep sequential:** S4.0 → S4.1 → S4.2 (broker is the trust core; build minting,
  then exec, then prove the invariant). S3.1 depends on S3.0 (verifier needs the receipt format).
- **Gate:** S4.2 (exfiltration test) must pass before S4.3 demo is considered done.
