# 00 — Requirements (verbatim capture)

> Raw requirements, synthesized from the Linear project `agent-zk-passport`
> (claw-village / DEV team) and the founder's framing notes. Design lives in
> [`01-spec.md`](./01-spec.md). Source of record: <https://linear.app/claw-village/project/agent-zk-passport-f28af2c581a7>

## Problem

Personal AI agents increasingly act on our behalf across the web — browsing,
transacting, scheduling, negotiating. Two gaps block them from being first-class actors:

1. **No trust signal.** A user's own legitimate agent looks identical to a scraper, spam
   bot, or malicious automation. Sites can't grant elevated permissions, complete
   payments, or build a reputation history, so the safe default is to block everything
   non-human (CAPTCHAs, bot detection, hard payment caps).
2. **No accountability.** If an agent misbehaves there is no cryptographic link back to a
   real, sanctioned identity — so the only safe policy is to distrust all agents.

There is a second, founder-stated problem that the Linear doc only implies:

3. **Secret custody.** A useful personal agent must *hold and use* real secrets on the
   user's behalf — third-party API keys, crypto wallet signing keys, Google/OIDC OAuth
   tokens. The agent must be able to **use** these (sign a tx, call an API, refresh a
   token) **without ever being able to exfiltrate the raw secret** — not to a prompt
   injection, not to a compromised tool, not to a leaked log. "It MUST have a lot of
   security to not gift the keys."

The product, `agent-zk-passport`, ties (1)+(2) to (3): it is both a **portable,
zero-knowledge-verifiable identity credential** for an agent *and* the **hardware-backed
secret vault** whose every operation that credential authorizes. The passport is the thing
that proves the agent may use a secret; the vault is the thing that uses it without
leaking it.

## Functional requirements

### Identity / passport (from Linear)
- **Issuer service** — onboards a human via an existing identity provider (KYC, OIDC, or
  sovereign ID such as Worldcoin / zkPassport) and mints a credential **bound to the
  agent's keypair**.
- **Agent identity SDK** — generates the agent keypair, stores the credential, and
  produces zero-knowledge proofs on demand, e.g. `prove(owner_age ≥ 18 ∧ agent_not_revoked
  ∧ daily_spend ≤ $200)`. Proofs are **selectively disclosing** — they reveal only the
  predicate result, never the underlying attributes.
- **Verifier library** — drop-in for websites / payment processors to challenge an agent
  and verify a proof **in < 100 ms, without contacting the issuer**.
- **Revocation registry** — an accumulator (signed transparency log, periodically anchored
  on-chain) the verifier checks to confirm the credential is still valid.
- **Reputation hooks** — verifiers can attest "agent X completed transaction successfully"
  to a **pseudonymous handle**, building portable reputation that never leaks the human.

### Secret vault (from founder context)
- **Hardware-backed vault** — store API keys, wallet signing keys, and OAuth tokens
  sealed by an OS hardware key (Secure Enclave / TPM / passkey). Secrets are never written
  to disk in plaintext and are never decrypted into the agent's address space.
- **Local broker** — a separate, minimal-trust local process that holds the only path to
  decrypted secrets. It performs **scoped operations** on the agent's behalf — sign this
  payload, call this allow-listed API, inject this credential at egress — and returns only
  the *result*, never the key.
- **Capability tokens** — the agent never receives a secret; it receives short-lived,
  attenuable capability tokens that authorize one specific broker operation.
- **Proof-gated capabilities** — minting a capability requires a valid passport proof
  (predicate + non-revocation). The proof gates *issuance* of capabilities; capabilities
  gate *individual* secret uses. (See [`01-spec.md` §7](./01-spec.md) for why this split is
  necessary given zkVM prover latency.)
- **OAuth token lifecycle** — broker performs token refresh and injection so the agent
  drives flows it can't read.

### End-to-end
- **Payments demo** — a personal agent completes a gated payment on a sample merchant site
  that rejects un-passported traffic, using a wallet/API secret it never sees in plaintext.

## Non-functional requirements / constraints

- **Security is the dominant constraint.** A raw secret (API key, private key, OAuth
  refresh token) must NEVER cross the broker boundary into the agent, a log, an error
  message, a proof witness, or a network response. This overrides every other goal.
- **Performance budgets:**
  - Verifier: proof + revocation check in **< 100 ms**.
  - Capability minting (incl. proof): target fast enough for interactive use; zkVM proving
    is slow, so proofs are amortized over a capability's lifetime, not run per secret use
    (design constraint, see spec §7). Original Linear target of < 500 ms *client-side per
    proof* is treated as aspirational and re-scoped to "proof feeds a capability good for N
    operations / T minutes."
- **Privacy / unlinkability** — proofs must not let two verifiers correlate the same human;
  reputation handles are pseudonymous and per-context where feasible.
- **No issuer-in-the-loop verification** — verifier checks proofs offline against published
  issuer keys + revocation root.
- **Open spec** — credential schema, predicates, and revocation model are published so any
  agent framework (Claude, OpenAI, custom) can interoperate.
- **Locked stack** — TypeScript on Bun for SDKs/services/broker; Rust for the ZK proving
  stack (RISC Zero zkVM) and the verifier core. See [`context.md`](../context.md).

## Out of scope / non-goals (v1)

- **Not** building payment rails — we plug into Stripe / x402 / on-chain, not replace them.
- **Not** native browser-level anonymous credentials — v1 is an SDK + reference verifier;
  browser integration is a later phase.
- **Not** agent-to-agent delegation chains — single-hop owner→agent only in v1.
- **Not** a cloud-hosted custody/KMS service — v1 custody is **local, hardware-backed** on
  the user's machine. Remote TEE custody is explicitly deferred.
- **Not** full W3C Verifiable Credentials compliance in v1 — ship a compact purpose-built
  credential format designed to be VC-mappable later.

## Acceptance criteria (seed)

> Expanded with traceability in [`99-acceptance.md`](./99-acceptance.md). Each ✅ requires
> BOTH an implementation and a passing test.

- [ ] **Spec published** — credential schema, proof predicates, revocation model, and the
      vault/broker capability protocol are documented in `01-spec.md`.
- [ ] **Reference issuer** mints a credential from ≥ 1 identity provider, bound to an agent
      public key.
- [ ] **Agent SDK** generates keys, holds the credential, and produces a selective-disclosure
      proof verifiable offline.
- [ ] **Verifier library** (TS + Rust core) validates a proof and checks revocation in < 100 ms.
- [ ] **Vault + broker** seal a secret with a hardware-backed key; the agent can trigger a
      signed operation / API call but a test proves the raw secret is unrecoverable from the
      agent side (memory, logs, proof witnesses, broker responses).
- [ ] **Proof-gated capability** — a capability token is mintable only when a valid passport
      proof is presented; an expired/revoked passport blocks minting.
- [ ] **E2E demo** — an agent completes a gated payment on a sample merchant that rejects
      un-passported traffic.
- [ ] **Threat model + security review** covering credential theft, replay, linkability,
      issuer compromise, broker compromise, and secret exfiltration.

## Open questions (carried from Linear, resolved choices noted)

- **Proof system** — *Resolved:* RISC Zero zkVM (Rust); proofs amortized via capabilities to
  absorb prover latency. (Linear had asked Groth16 vs PLONK vs STARK.)
- **Revocation anchor** — *Resolved:* signed Merkle transparency log + periodic L2 anchor.
- **Key rotation** — open: how to handle the user replacing/forking their agent (re-issue
  bound to a new agent key + revoke the old). Needs design in a later slice.
- **W3C VC compatibility** — *Resolved (direction):* purpose-built compact format first,
  VC-mappable later.
- **Which L2 for anchoring** — open (candidate: Base Sepolia for v1 testnet).
- **Which identity provider first** — open (candidate: an OIDC provider for the lowest-friction
  reference issuer; Worldcoin/zkPassport as a sovereign-ID track).
