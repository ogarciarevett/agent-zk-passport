# Dependency audit — RISC Zero proving toolchain

The zero-knowledge prover (`zkvm/`) is built on RISC Zero (`cargo-risczero` / `r0vm` **3.0.5**,
installed via `rzup`). Before adopting it we verified RISC Zero is legitimate and maintained,
and we triage its transitive advisories here.

## Provenance checks (done before install)

- **Project legitimacy:** official repo `github.com/risc0/risc0`, actively maintained
  (v2.x/v3.x supported, v4 on `main`), runs a **HackenProof bug bounty** and publishes
  security advisories responsibly. We use **only** the official org — note look-alike forks
  (`realhuntersaint/RSIC0`, `DanielHoffmann91/risc0`) seen in search results; ignore them.
- **Installer:** `https://risczero.com/install` redirects to RISC Zero's official S3 bucket.
  We read the script in full before use (Apache-2.0, `set -euo pipefail`, downloads the `rzup`
  binary over HTTPS, no `eval`/`sudo`/remote-code-exec). To reduce prebuilt-binary trust we
  instead built `rzup` from crates.io source: `cargo install rzup`.
- **Pinned version:** installed `cargo-risczero`/`r0vm` **3.0.5**, which post-dates the most
  recent critical advisory (`GHSA-jqq4-c7wq-36h7`, Oct 2025) — i.e. a patched line.

## `cargo audit` triage (`zkvm/.cargo/audit.toml`)

`cargo audit` on the proving tree flags 5 items. **All are transitive** (inside
risc0 / arkworks), **build-time / proving-only** (never shipped to the agent or end user, never
on a network-facing timing-oracle or untrusted-log-input path), and **none indicate a
compromise**. None have a fix reachable from the versions risc0 3.0.5 pins.

| Advisory | Crate | Type | Why accepted |
|---|---|---|---|
| RUSTSEC-2023-0071 | `rsa` | vuln (med, no fix) | Marvin timing side-channel. We perform no RSA operations; transitive only. |
| RUSTSEC-2025-0055 | `tracing-subscriber` | vuln (low) | ANSI log poisoning. Pinned to 0.2.25 by arkworks 0.5 (`^0.2`); proving-time diagnostics only, no untrusted input. |
| RUSTSEC-2025-0141 | `bincode` | unmaintained | Warning only. Transitive via risc0/ark; our own host uses `serde_json`, not bincode. |
| RUSTSEC-2024-0388 | `derivative` | unmaintained | Warning only. Transitive via arkworks. |
| RUSTSEC-2024-0436 | `paste` | unmaintained | Warning only. Transitive via risc0/ark. |

**Fixed where possible:** we removed our own direct `bincode`/`base64` use (now `serde_json`).
The remaining items have no upstream-reachable fix today.

**Re-review policy:** re-run `cargo audit` (it reads the ignore list above) on every RISC Zero
version bump, and drop any entry whose fix becomes reachable. The root workspace (`crates/*`,
std-only) and the TypeScript packages carry none of these.
