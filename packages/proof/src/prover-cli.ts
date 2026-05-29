/**
 * Bridge to the RISC Zero host CLI (`zkvm/host`, binary `passport-prover`). The TS backend
 * shells out to it rather than linking risc0 via FFI — simpler, and it keeps the heavy ZK
 * toolchain out of the JS runtime. Build it once: `cd zkvm && cargo build --release`.
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Resolve the prover binary: AZKP_PROVER_BIN, else zkvm/target/{release,debug}/passport-prover. */
export function resolveProverBin(): string | undefined {
  const fromEnv = process.env.AZKP_PROVER_BIN;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  for (const profile of ['release', 'debug']) {
    const candidate = fileURLToPath(
      new URL(`../../../zkvm/target/${profile}/passport-prover`, import.meta.url),
    );
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

export interface ProverUnavailable {
  available: false;
  reason: string;
}

export function proverStatus(): { available: true; bin: string } | ProverUnavailable {
  const bin = resolveProverBin();
  if (!bin) {
    return {
      available: false,
      reason:
        'passport-prover binary not found. Build it: `cd zkvm && cargo build --release` ' +
        '(needs the RISC Zero toolchain — see README). Or set AZKP_PROVER_BIN.',
    };
  }
  return { available: true, bin };
}

/** Run `passport-prover <mode>` with `input` JSON on stdin; parse JSON stdout. */
export async function runProver(mode: 'prove' | 'verify', input: unknown): Promise<unknown> {
  const status = proverStatus();
  if (!status.available) throw new Error(status.reason);

  const proc = Bun.spawn([status.bin, mode], { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' });
  proc.stdin.write(JSON.stringify(input));
  proc.stdin.end();
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  await proc.exited;
  if (proc.exitCode !== 0)
    throw new Error(`passport-prover ${mode} failed: ${stderr.trim() || 'non-zero exit'}`);
  return JSON.parse(stdout);
}
