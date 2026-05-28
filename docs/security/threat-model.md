# Threat Model — agent-zk-passport

- **Status:** Living document
- **Date:** 2026-05-29
- **Traces to:** [`01-spec.md` §9 (Security)](../../.ai/specs/01-spec.md) and
  [`01-spec.md` §3 (Architecture)](../../.ai/specs/01-spec.md)

## Trust boundaries

The system spans four trust domains (`01-spec.md` §3). The boundaries that the design must
hold across are:

- **human ↔ issuer** — the one-time onboarding flow. The human authenticates via an
  identity provider (OIDC / KYC / Worldcoin / zkPassport); the issuer mints a credential
  bound to the agent's public key. The issuer sees attestations, never user secrets.
- **agent ↔ broker** — **the critical boundary.** The agent runs in the same device but a
  separate address space from the broker. Only capability tokens and operation results
  cross this boundary, over a Unix-domain-socket IPC (never a network port). A plaintext
  secret must never cross it.
- **agent ↔ verifier** — a relying party challenges the agent and verifies a passport proof
  offline. Only a zero-knowledge predicate result + non-revocation check crosses, never raw
  attributes.
- **verifier ↔ transparency-log** — the verifier reads the latest signed revocation root
  (cached, periodically anchored to L2) to confirm non-revocation; verifiers append
  pseudonymous reputation attestations.

## Core assumption

**The agent process is treated as potentially prompt-injected or compromised at ALL
times.** It is the component most exposed to untrusted web content and tool output. The
design must preserve the secret-custody invariant *even when the agent is fully under
adversary control*. Security therefore does not depend on the agent behaving correctly — it
depends on the agent being **structurally incapable** of reaching a plaintext secret: there
is no export API, and the broker IPC returns only operation results
(`01-spec.md` §7.2).

A second standing assumption (`01-spec.md` §10): the device OS keystore (Secure Enclave /
TPM / passkey) is trustworthy. A fully rooted device defeats local custody — see
Residual risks.

## Threats and mitigations

Covers every threat enumerated in `01-spec.md` §9.

| Threat | Attack scenario | Mitigation | Enforced by |
|---|---|---|---|
| **Secret exfiltration via prompt-injected agent** | Injected instructions or a malicious tool coerce the agent to read and leak an API key / signing key. | No export/getSecret API exists; the broker is the sole holder of plaintext, in a separate process; IPC returns results only; egress secrets are injected by the broker acting as a forward proxy so they appear on the wire to the third party but never in agent memory. | `packages/broker` + `crates/vault` (broker boundary, egress-proxy slice) |
| **Credential theft / replay on another agent** | An attacker copies a stolen credential or replays a captured proof on a different agent. | Credential carries an `agent_pubkey` binding; proofs are signed by the agent key; verifier issues challenge nonces so a captured proof cannot be replayed. | `packages/credential` (binding) · `packages/agent-sdk` (signing) · `packages/verifier` + `crates/verifier-core` (challenge/nonce) |
| **Cross-verifier linkability** | Two relying parties correlate the same human across contexts. | Predicate-only selective disclosure (boolean result, never raw attributes); per-context pseudonyms for reputation; commitments, not attributes, in the credential. | `crates/zk-predicates` (predicate disclosure) · `packages/transparency-log` (pseudonymous attest entries) |
| **Issuer compromise** | The issuer signing key is stolen or the issuer mints rogue credentials. | Published issuer public keys with key rotation; revocation via the transparency log; minimal attributes minted (commitments only); offline verifiers reject credentials under rotated/revoked keys. | `packages/issuer` (key publish/rotation, mint) · `packages/transparency-log` (revocation) |
| **Broker compromise** | An attacker achieves RCE in the broker process. | Smallest possible TCB; the master key is HW-sealed (Secure Enclave / TPM) and **not extractable even with broker RCE** — only wrapped data keys live in the broker; user-presence (passkey/biometric) gating on high-value operations. | `crates/vault` (HW-sealed envelope encryption) + `packages/broker` (TCB minimization, presence gating) |
| **Capability misuse** | A leaked or over-broad capability token is used beyond its intent. | Short TTL; `max_uses` cap; `secret_id` / `operation` / `scope` caveats; attenuable-only (narrow, never widen); `bound_proof_hash` ties the capability to a still-unrevoked passport proof. | `packages/broker` (mint/verify) · `packages/credential` (capability schema) — see [ADR 0001](../adr/0001-capability-protocol.md) |
| **Stale revocation** | A verifier accepts a proof against an out-of-date revocation root, missing a recent revocation. | Signed Merkle root anchored to L2 every N minutes; verifier rejects roots older than a staleness threshold; staleness alerting in observability. | `packages/transparency-log` (anchor job) · `packages/verifier` + `crates/verifier-core` (root freshness check) |
| **Secret in logs / proof witness** | A secret leaks into a structured log, error message, or zkVM witness. | Hard secret-redaction layer in the broker with a unit test asserting no key bytes / `secret_id` payload / token reaches a log sink; circuits operate on commitments, never raw attributes or API secrets, so witnesses carry no secret material. | `packages/broker` (pino redaction layer + assertion test) · `crates/zk-predicates` (commitments-not-attributes) |

## Residual risks

- **Fully-rooted device defeats local custody.** v1 custody is local and hardware-backed; if
  the device OS / hardware boundary is fully compromised, local custody cannot guarantee the
  secret-custody invariant. The deferred answer is **remote TEE custody** (`01-spec.md` §2,
  §10) — explicitly out of scope for v1.
- **Revocation enforcement lag bounded by capability TTL.** A revoked passport is only fully
  enforced at the next mint or capability expiry; already-minted capabilities remain usable
  within their TTL window. The blast radius is bounded by the TTL, which is the chosen
  security/latency dial (`01-spec.md` §10; [ADR 0001](../adr/0001-capability-protocol.md)).
- **Trusted transparency-log operator between anchors.** Full decentralization was traded for
  latency; a trusted operator sits between L2 anchors (`01-spec.md` §10). Misbehavior is
  bounded by the periodic on-chain anchoring of the signed root.
