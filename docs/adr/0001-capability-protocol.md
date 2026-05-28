# ADR 0001 — Proof-Gated Capability Protocol

- **Status:** Accepted
- **Date:** 2026-05-29
- **Traces to:** [`01-spec.md` §3 (Architecture)](../../.ai/specs/01-spec.md) and
  [`01-spec.md` §7 (Key decisions & algorithms)](../../.ai/specs/01-spec.md)

## Context

A personal AI agent must be able to **use** the user's secrets (API keys, wallet
signing keys, OAuth tokens) — sign a transaction, call an allow-listed API, refresh a
token — without ever being able to **read** the raw secret. The dominant invariant
(see `01-spec.md` §1) is that a plaintext secret must never be exfiltrable to the agent,
a log, a proof witness, or the network.

The identity layer establishes authorization with a **zero-knowledge passport proof**:
the agent proves, in zero knowledge, that it is owned by an attested human, is not
revoked, and satisfies per-request policy predicates (e.g.
`owner_age ≥ 18 ∧ not_revoked ∧ daily_spend ≤ $200`). The natural design — "every secret
use requires a fresh proof" — is **infeasible in practice**: RISC Zero zkVM proving is far
too slow to run on the critical path of each individual secret operation. Running a proof
per `sign` or per `http` call would make the agent non-interactive.

We need a model that keeps the "proofs gate every secret use" guarantee while staying fast
enough for interactive, per-operation use.

## Decision

Adopt a **two-tier proof → capability → exec model**: a passport proof gates the
**issuance** of capabilities; short-lived capability tokens gate each individual secret
**use**.

1. **Proof gates issuance.** Periodically (or on policy change), the agent has the SDK →
   Rust prover generate a passport proof for a predicate set. The agent presents that proof
   to the **local broker** over a Unix-domain-socket IPC (never a network port). The broker
   verifies the receipt, checks the revocation root, and **mints short-lived capability
   tokens** scoped to specific operations.
2. **Capabilities gate use.** For each actual secret operation, the agent presents a
   capability token to the broker via `exec(cap, op)`. The broker performs the operation
   with the sealed secret and returns only the **result**. No proof is run per operation
   (a capability check is sub-millisecond); no secret crosses the boundary. There is no
   `getSecret` / `exportSecret` endpoint — by construction.
3. **Capability TTL is the security/latency dial.** Short TTLs tighten the window in which
   a revoked passport can still mint or be used; longer TTLs reduce proving frequency. This
   single parameter trades freshness against latency.

**Capability token shape** (`packages/credential` canonical schema; see `01-spec.md` §5):
capabilities are **Ed25519-signed, Biscuit-style, and attenuable** — the agent can narrow a
capability, never widen it — with caveats:

| Caveat | Purpose |
|---|---|
| `secret_id` | Which sealed secret this capability may act on |
| `operation` | The single operation class permitted (`sign`, `http-proxy`, `oauth-refresh`) |
| `scope` | The concrete bound (e.g. `eth:<addr>`, `POST:api.stripe.com/v1/charges`) |
| `expires_at` | Short TTL — the security/latency dial |
| `max_uses` | Hard cap on the number of operations |
| `bound_proof_hash` | Ties the capability to the specific passport proof behind it; valid only while that proof references a still-unrevoked passport |

This satisfies the invariant from `01-spec.md` §5: **no capability exists without a valid,
non-revoked passport proof behind it**, while individual operations stay interactive.

## Consequences

**Positive**

- **Interactivity preserved.** Per-operation latency is a sub-millisecond capability check,
  not a full zkVM proof. The expensive proof is amortized over a capability's lifetime
  (N operations / T minutes).
- **Invariant preserved.** The broker remains the sole secret-bearing component; the agent
  only ever holds capability tokens and receives operation results. A prompt-injected agent
  cannot exfiltrate a secret because there is no path to one.
- **Auditability.** Every `exec` is attributable to a capability id, operation, and scope
  without ever logging secret material (`01-spec.md` §8).

**Negative**

- **Revocation lag bounded by TTL.** A revoked passport is only fully enforced at the next
  mint or at capability expiry. Within the TTL window, already-minted capabilities remain
  usable. This is an accepted trade (`01-spec.md` §10): per-operation proof freshness is
  exchanged for interactivity, with the blast radius bounded by the TTL.
- **TTL tuning is a real operational concern.** Defaults depend on measured prover latency
  on agent-grade hardware (open question in `01-spec.md` §11); too long widens the
  revocation window, too short raises proving overhead.

## Alternatives considered

- **Proof per operation (rejected — too slow).** Run a fresh zkVM proof on every secret use.
  This gives the tightest possible revocation freshness but is infeasible: RISC Zero proving
  latency on the critical path of each `sign`/`http` call makes the agent non-interactive.
  This is the constraint that motivated the whole decision (`01-spec.md` §7.1).
- **Long-lived capabilities (rejected — unbounded blast radius).** Mint capabilities that
  live for hours or are not time-bounded. This minimizes proving overhead but means a
  compromised or revoked passport authorizes secret use far beyond any acceptable window,
  with no cheap way to contain it. Short TTL + `max_uses` + `bound_proof_hash` is the chosen
  containment instead.
