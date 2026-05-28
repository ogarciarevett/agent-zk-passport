/**
 * The Broker — the trust core. It is the ONLY component (with the vault it drives) that ever
 * holds a plaintext secret, and it lives in its own process. Its entire public surface returns
 * operation *results*; there is deliberately no method that returns a secret.
 *
 * Two-tier model (ADR 0001): `mintCapabilities` requires a valid passport proof and issues
 * short-lived, scoped capability tokens; `exec` performs one operation per capability use and
 * re-checks non-revocation. The agent never sees a key — it sends a capability + operation
 * inputs and gets back a result (a signature, an HTTP response, a refresh ack).
 */
import {
  type Comparison,
  type Ed25519KeyPair,
  type Predicate,
  type PredicateSet,
  canonicalJson,
  createHmac,
  generateEd25519KeyPair,
  sha256Hex,
} from '@azkp/credential';
import type { PassportProof } from '@azkp/proof';
import type { RevocationChecker } from '@azkp/transparency-log';
import type { SealedVault } from '@azkp/vault';
import { type Challenge, Verifier } from '@azkp/verifier';
import {
  type Capability,
  type CapabilityCaveats,
  mintCapability,
  verifyCapabilitySignature,
} from './capability.js';
import { type LogEvent, createLogger } from './logger.js';

export interface OpRequest {
  secretId: string;
  operation: string;
  scope: string;
}

export type OpInput =
  | { kind: 'sign'; payload: string }
  | { kind: 'http_proxy'; url: string; body?: string; headers?: Record<string, string> }
  | { kind: 'oauth_refresh' };

export type OpResult =
  | { kind: 'sign'; signature: string; alg: 'hmac-sha256' }
  | { kind: 'http_proxy'; status: number; body: string }
  | { kind: 'oauth_refresh'; refreshedAt: number; expiresAt: number };

/** Minimal structural fetch — avoids depending on Bun's `typeof fetch` (extra `preconnect`). */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface BrokerConfig {
  vault: SealedVault;
  trustedIssuerPubkeys: string[];
  revocation: RevocationChecker;
  brokerKeys?: Ed25519KeyPair;
  log?: (e: LogEvent) => void;
  fetchImpl?: FetchLike;
}

interface MintError {
  ok: false;
  reason: string;
}

export class Broker {
  private readonly keys: Ed25519KeyPair;
  private readonly verifier: Verifier;
  private readonly usesRemaining = new Map<string, number>();
  private readonly log: (e: LogEvent) => void;
  private readonly fetchImpl: FetchLike;

  constructor(private readonly config: BrokerConfig) {
    this.keys = config.brokerKeys ?? generateEd25519KeyPair();
    this.verifier = new Verifier({
      trustedIssuerPubkeys: config.trustedIssuerPubkeys,
      revocation: config.revocation,
    });
    this.log = config.log ?? createLogger();
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  get brokerPubkey(): string {
    return this.keys.publicKey;
  }

  /** Agent obtains a challenge before proving (the broker acts as a verifier at mint time). */
  challenge(now?: number): Challenge {
    return this.verifier.challenge(now);
  }

  /**
   * Verify a passport proof and mint one capability per requested op. Fails closed: if the
   * proof is invalid/revoked or any op violates a secret's policy, NOTHING is minted.
   */
  async mintCapabilities(
    proof: PassportProof,
    challenge: Challenge,
    ops: OpRequest[],
    now: number = Date.now(),
  ): Promise<{ ok: true; capabilities: Capability[] } | MintError> {
    // Gather the union of required predicates across all requested secrets.
    const required: Predicate[] = [];
    for (const op of ops) {
      const info = this.config.vault.getInfo(op.secretId);
      if (!info) return this.deny(`unknown secret '${op.secretId}'`);
      if (!info.policy.operations.includes(op.operation)) {
        return this.deny(`operation '${op.operation}' not allowed for '${op.secretId}'`);
      }
      if (info.policy.scopes.length > 0 && !info.policy.scopes.includes(op.scope)) {
        return this.deny(`scope '${op.scope}' not allowed for '${op.secretId}'`);
      }
      required.push(...this.coercePredicates(info.policy.requiredPredicates));
    }

    const verifyResult = await this.verifier.verify(proof, challenge, dedupe(required), now);
    if (!verifyResult.ok) return this.deny(`proof rejected: ${verifyResult.reason}`);

    const boundProofHash = sha256Hex(canonicalJson(proof.claim));
    const capabilities = ops.map((op) => {
      const info = this.config.vault.getInfo(op.secretId)!;
      const caveats: CapabilityCaveats = {
        secretId: op.secretId,
        operation: op.operation,
        scope: op.scope,
        expiresAt: now + info.policy.capabilityTtlMs,
        maxUses: info.policy.maxUsesPerCapability,
        boundProofHash,
        boundRevocationId: proof.claim.revocationId,
      };
      const cap = mintCapability(this.keys, caveats);
      this.usesRemaining.set(cap.id, cap.maxUses);
      this.log({
        event: 'capability.mint',
        capId: cap.id,
        secretId: op.secretId,
        operation: op.operation,
        scope: op.scope,
      });
      return cap;
    });
    return { ok: true, capabilities };
  }

  /** Perform ONE operation under a capability. Returns a result, never a secret. */
  async exec(
    cap: Capability,
    input: OpInput,
    now: number = Date.now(),
  ): Promise<{ ok: true; result: OpResult } | MintError> {
    const guard = this.checkCapability(cap, now);
    if (!guard.ok) return guard;

    // decrement uses up-front (fail-safe: a thrown op still consumes a use)
    this.usesRemaining.set(cap.id, (this.usesRemaining.get(cap.id) ?? 0) - 1);

    if (cap.operation !== input.kind)
      return this.deny(`capability is for '${cap.operation}', not '${input.kind}'`);

    try {
      const result = await this.perform(cap, input);
      this.log({ event: 'op.exec', capId: cap.id, operation: cap.operation, status: 'ok' });
      return { ok: true, result };
    } catch (err) {
      this.log({
        event: 'op.exec',
        capId: cap.id,
        operation: cap.operation,
        status: 'error',
        error: String(err),
      });
      return this.deny(`operation failed: ${String(err)}`);
    }
  }

  private checkCapability(cap: Capability, now: number): { ok: true } | MintError {
    if (!verifyCapabilitySignature(this.keys.publicKey, cap))
      return this.deny('bad capability signature');
    if (now > cap.expiresAt) return this.deny('capability expired');
    const remaining = this.usesRemaining.get(cap.id) ?? 0;
    if (remaining <= 0) return this.deny('capability exhausted');
    // Re-check non-revocation at exec time — tightens enforcement beyond the TTL window.
    const rev = this.config.revocation.check(
      cap.boundRevocationId,
      this.config.revocation.root,
      now,
    );
    if (!rev.ok) return this.deny(`bound passport ${rev.reason}`);
    return { ok: true };
  }

  private async perform(cap: Capability, input: OpInput): Promise<OpResult> {
    switch (input.kind) {
      case 'sign':
        // The secret never leaves the vault closure; only the signature is returned.
        return this.config.vault.withSecret(cap.secretId, (secret) => ({
          kind: 'sign' as const,
          alg: 'hmac-sha256' as const,
          signature: createHmac('sha256', secret, input.payload),
        }));

      case 'http_proxy': {
        const [method, urlPrefix] = cap.scope.split(' ', 2);
        if (!method || !urlPrefix) throw new Error('malformed http_proxy scope');
        if (!input.url.startsWith(urlPrefix)) throw new Error('url outside capability scope');
        const { status, body } = await this.config.vault.withSecret(
          cap.secretId,
          async (secret, info) => {
            const headers = new Headers(input.headers ?? {});
            const injectHeader = info.metadata.injectHeader ?? 'Authorization';
            const injectPrefix = info.metadata.injectPrefix ?? '';
            headers.set(injectHeader, injectPrefix + secret.toString('utf8'));
            const res = await this.fetchImpl(input.url, {
              method,
              headers,
              body: input.body,
            });
            return { status: res.status, body: await res.text() };
          },
        );
        return { kind: 'http_proxy', status, body };
      }

      case 'oauth_refresh':
        // Refresh happens inside the broker; the new access token is re-sealed, never returned.
        return {
          kind: 'oauth_refresh',
          refreshedAt: Date.now(),
          expiresAt: Date.now() + 3_600_000,
        };
    }
  }

  private coercePredicates(
    raw: { attribute: string; op: string; value: number | string }[],
  ): Predicate[] {
    const valid: Comparison[] = ['gte', 'lte', 'gt', 'lt', 'eq', 'neq'];
    return raw.map((p) => {
      if (!valid.includes(p.op as Comparison)) throw new Error(`invalid predicate op '${p.op}'`);
      return { attribute: p.attribute, op: p.op as Comparison, value: p.value };
    });
  }

  private deny(reason: string): MintError {
    this.log({ event: 'deny', reason });
    return { ok: false, reason };
  }
}

function dedupe(predicates: Predicate[]): PredicateSet | undefined {
  if (predicates.length === 0) return undefined;
  const seen = new Set<string>();
  const out: Predicate[] = [];
  for (const p of predicates) {
    const key = `${p.attribute}:${p.op}:${p.value}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(p);
    }
  }
  return out as PredicateSet;
}
