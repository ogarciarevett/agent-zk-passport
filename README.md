<div align="center">

<img src="assets/agent-zk-passport.svg" width="180" alt="agent-zk-passport: a violet passport with a mint lock seal">

# agent-zk-passport

**Proof-gated identity and secret operations for personal agents.**

[![TypeScript](https://img.shields.io/badge/language-TypeScript-3178C6)](packages/) [![Bun](https://img.shields.io/badge/runtime-Bun-24283B)](package.json) [![Rust](https://img.shields.io/badge/core-Rust-CE7C4B)](Cargo.toml)

Works with **Bun** · **RISC Zero** · **Hono**

</div>

---

> Verifiable identity passport **+** hardware-backed secret vault for personal AI agents.
> The passport (a zero-knowledge proof) gates capability issuance; capabilities gate every
> secret use; **secrets never leave the broker.**

A personal agent needs two things to act on your behalf on the web: a way to **prove it's a
legitimate, human-owned agent** (so sites stop treating it like a bot) and a way to **hold and
use your secrets** — API keys, wallet keys, OAuth tokens — **without ever being able to leak
them**, even if the agent itself is hijacked by a prompt injection. This repo is a working
reference for both, designed as one system.

```
issuer (HTTP)  ──mint──▶  agent ──passport proof──▶  merchant (rejects un-passported traffic)
                            │
                            └──proof──▶ broker ──injects the payment key──▶ merchant
                                          │
                                       sealed vault (the only place plaintext secrets exist)
```

## Quickstart

```bash
bun install
bun run demo        # end-to-end: onboard → mint → prove → capability → gated payment → revoke
bun test            # 36 TypeScript tests (incl. the secret-exfiltration + socket-boundary gates)
cargo test          # Rust core (predicate logic, vault/verifier/prover scaffolds)
```

Run the broker as its **own OS process** (the agent reaches it via `BrokerClient` over a
Unix-domain socket — the secret-bearing vault never shares the agent's address space):

```bash
AZKP_BROKER_SOCKET=/tmp/azkp.sock AZKP_ISSUER_PUBKEY=<hex> \
AZKP_PAYMENT_KEY=<api-key> bun run broker
```

The demo prints each step and ends with the payment completing through the broker — while a
test (`apps/demo/test/exfiltration.test.ts`) proves the raw key is **unrecoverable** from the
agent side (no export API, not in results, logs, proxied bodies, or proof witnesses).

## How it works

1. **Issue.** The issuer onboards a human (mock OIDC here; real OIDC/KYC/Worldcoin later) and
   mints a credential **bound to the agent's keypair**, carrying attribute *commitments* — not
   the raw age/jurisdiction/limits.
2. **Prove.** The agent produces a passport proof for a predicate set (`age ≥ 18 ∧
   not_revoked ∧ daily_spend ≤ 200`) — selective disclosure of the *result*, never the values.
3. **Mint a capability.** The agent presents the proof to the **broker**, which verifies it
   (+ non-revocation) and mints a short-lived, scoped capability token (TTL + max-uses). The
   proof gates *issuance*; the capability gates *individual uses* — this absorbs zk-proving
   latency (ADR [`0001`](docs/adr/0001-capability-protocol.md)).
4. **Use.** The agent calls `broker.exec(capability, op)`. The broker performs the op with the
   sealed secret (sign / inject-at-egress / OAuth refresh) and returns only the **result**.
   There is no `getSecret` — by construction.
5. **Verify.** A relying party challenges the agent and verifies the passport offline in
   **< 100 ms** against the issuer key + a cached signed revocation root.

## Packages

| Package | What it is |
|---|---|
| [`@azkp/credential`](packages/credential) | crypto, attribute commitments, predicate language, credential schema |
| [`@azkp/proof`](packages/proof) | `ProofBackend` interface · **dev** Ed25519 backend (real crypto, non-ZK) · **risc0** stub |
| [`@azkp/vault`](packages/vault) | sealed envelope encryption; `withSecret` lending — no plaintext export |
| [`@azkp/transparency-log`](packages/transparency-log) | signed Merkle revocation log + reputation accumulator |
| [`@azkp/verifier`](packages/verifier) | offline proof + revocation + replay verification (< 100 ms) |
| [`@azkp/broker`](packages/broker) | **the trust core**: proof-gated capability minting + scoped exec |
| [`@azkp/agent-sdk`](packages/agent-sdk) | agent identity, credential store, proof client (holds no secrets) |
| [`@azkp/issuer`](packages/issuer) | Hono service: onboard + mint bound credential |
| [`@azkp/demo-merchant`](packages/demo-merchant) | Hono service that rejects un-passported traffic |
| [`crates/*`](crates) | Rust core: predicate logic (real) + vault/verifier/prover scaffolds for the RISC Zero + HW-seal path |

## Scope & honesty (v1)

This is a faithful reference that **proves the security invariant today**, with two pieces
deliberately stubbed behind clean interfaces because their full versions are multi-week:

- **Two proof backends.** The default demo uses `dev-ed25519` (real crypto, fast, but *trusts
  the prover* on predicate truth). The **real zero-knowledge** backend is now implemented:
  RISC Zero zkVM (`zkvm/`) proves the predicate set over the *private* attributes in-circuit
  and commits only the public claim + result — see `getProofBackend('risc0')` and
  `bun test packages/proof/test/risc0.test.ts` (runs a real receipt when the prover is built).
  Build the prover: `cd zkvm && cargo build --release` (needs the RISC Zero toolchain via
  `rzup`; dependency triage in [`docs/security/dependency-audit.md`](docs/security/dependency-audit.md)).
  Still classical (next layer, in-circuit): commitment-opening, issuer-sig, and non-revocation.
- **The vault master key is file-backed, not hardware-sealed.** The Secure Enclave / TPM /
  passkey provider is the production target (`crates/vault` fixes the trait surface); the
  secret-never-exported invariant holds regardless of where the master key lives.

The broker process boundary is **implemented** (`@azkp/broker` server + `BrokerClient` over a
Unix-domain socket, `bun run broker`); the in-process `bun run demo` uses the broker as an
object purely for a single-file narrative.

Both are tracked in [`.ai/specs/02-plan.md`](.ai/specs/02-plan.md) (S3.0, S2.0) and the
[acceptance matrix](.ai/specs/99-acceptance.md).

## Specs & agent docs

Design lives in [`.ai/specs/`](.ai/specs) (`00-requirements`, `01-spec`, `02-plan`,
`99-acceptance`). This repo also carries a generated multi-tool agent-doc system (Claude Code,
Cursor, Codex, Gemini, opencode) — see [`AGENTS.md`](AGENTS.md) and run `bun run sync:ai` after
editing `.ai/context.md` or `.ai/pipeline.md`.

## License

MIT.
