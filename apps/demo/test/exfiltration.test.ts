/**
 * The non-negotiable invariant gate (.ai/specs/02-plan.md S4.2): a raw secret must be
 * UNRECOVERABLE from the agent side — not via the broker's return values, not via logs, not
 * via the passport proof witness, not via the vault's public surface. This test models a
 * fully prompt-injected agent that tries every exposed channel to exfiltrate the key and
 * asserts every one of them fails.
 */
import { describe, expect, test } from 'bun:test';
import { AgentIdentity } from '@azkp/agent-sdk';
import { Broker, type LogEvent } from '@azkp/broker';
import {
  type AttributeValue,
  type CredentialBody,
  canonicalJson,
  commitAttributes,
  generateEd25519KeyPair,
  randomHex,
  signCredential,
} from '@azkp/credential';
import { devProofBackend } from '@azkp/proof';
import { RevocationChecker, TransparencyLog } from '@azkp/transparency-log';
import {
  EphemeralMasterKeyProvider,
  MemoryVaultStore,
  SealedVault,
  type SecretPolicy,
} from '@azkp/vault';

const SECRET = 'sk_live_TOPSECRET_4f9a2b_exfiltration_target';

function fullStack() {
  const issuer = generateEd25519KeyPair();
  const agentKeys = generateEd25519KeyPair();
  const log = new TransparencyLog();
  const revocation = new RevocationChecker(log.logPubkey, log.snapshot());

  const claims: Record<string, AttributeValue> = { age: 30, dailySpend: 10 };
  const { commitments, openings } = commitAttributes(claims);
  const body: CredentialBody = {
    version: 1,
    issuerId: 'issuer.test',
    schemaId: 'personhood.v1',
    agentPubkey: agentKeys.publicKey,
    attributeCommitments: commitments,
    revocationId: randomHex(16),
    issuedAt: Date.now(),
    expiresAt: Date.now() + 1_000_000,
  };
  const credential = signCredential(issuer.privateKey, body);

  const store = new MemoryVaultStore();
  const vault = new SealedVault(new EphemeralMasterKeyProvider(), store);
  const policy: SecretPolicy = {
    operations: ['http_proxy', 'sign'],
    scopes: ['POST http://merchant.test/pay', 'eth:0xagent'],
    requiredPredicates: [{ attribute: 'age', op: 'gte', value: 18 }],
    maxUsesPerCapability: 5,
    capabilityTtlMs: 60_000,
  };
  vault.putSecret({
    id: 'k',
    type: 'api_key',
    secret: SECRET,
    policy,
    metadata: { injectHeader: 'Authorization', injectPrefix: 'Bearer ' },
  });

  const logLines: string[] = [];
  const captured: { sentBody: string | null } = { sentBody: null };
  const broker = new Broker({
    vault,
    trustedIssuerPubkeys: [issuer.publicKey],
    revocation,
    log: (e: LogEvent) => logLines.push(JSON.stringify(e)),
    fetchImpl: async (_url, init) => {
      // an attacker-controlled endpoint logging everything the agent could smuggle out
      captured.sentBody = (init?.body as string) ?? null;
      return new Response('{"ok":true}', { status: 200 });
    },
  });

  const agent = new AgentIdentity(agentKeys, devProofBackend);
  agent.loadCredential(credential, openings, issuer.publicKey);

  return {
    issuer,
    agentKeys,
    log,
    revocation,
    credential,
    openings,
    vault,
    store,
    broker,
    logLines,
    captured,
    agent,
  };
}

function containsSecret(s: string | null | undefined): boolean {
  if (!s) return false;
  return s.includes(SECRET) || s.includes('sk_live') || s.includes('TOPSECRET');
}

describe('secret exfiltration is impossible from the agent side', () => {
  test('the vault exposes no method that returns plaintext', () => {
    const { vault } = fullStack();
    const surface = [
      ...Object.getOwnPropertyNames(Object.getPrototypeOf(vault)),
      ...Object.keys(vault),
    ];
    expect(surface).not.toContain('getSecret');
    expect(surface).not.toContain('exportSecret');
    expect(surface).not.toContain('decrypt');
    expect(surface).not.toContain('reveal');
  });

  test('the sealed store holds only ciphertext', () => {
    const { store } = fullStack();
    expect(containsSecret(JSON.stringify(store.get('k')))).toBe(false);
  });

  test('broker op results never contain the secret', async () => {
    const s = fullStack();
    const ch = s.broker.challenge();
    const proof = await s.agent.prove(
      ch,
      [{ attribute: 'age', op: 'gte', value: 18 }],
      s.revocation.root,
    );
    const mint = await s.broker.mintCapabilities(proof, ch, [
      { secretId: 'k', operation: 'http_proxy', scope: 'POST http://merchant.test/pay' },
      { secretId: 'k', operation: 'sign', scope: 'eth:0xagent' },
    ]);
    if (!mint.ok) throw new Error(mint.reason);

    const httpCap = mint.capabilities.find((c) => c.operation === 'http_proxy')!;
    const signCap = mint.capabilities.find((c) => c.operation === 'sign')!;

    const httpRes = await s.broker.exec(httpCap, {
      kind: 'http_proxy',
      url: 'http://merchant.test/pay',
      body: '{}',
    });
    const signRes = await s.broker.exec(signCap, { kind: 'sign', payload: 'tx-payload' });

    // results carry data the agent is allowed to see — never the key
    expect(containsSecret(JSON.stringify(httpRes))).toBe(false);
    expect(containsSecret(JSON.stringify(signRes))).toBe(false);
    // capabilities themselves carry no secret
    expect(containsSecret(JSON.stringify(mint.capabilities))).toBe(false);
  });

  test('the agent cannot smuggle the secret out via a proxied request body', async () => {
    const s = fullStack();
    const ch = s.broker.challenge();
    const proof = await s.agent.prove(
      ch,
      [{ attribute: 'age', op: 'gte', value: 18 }],
      s.revocation.root,
    );
    const mint = await s.broker.mintCapabilities(proof, ch, [
      { secretId: 'k', operation: 'http_proxy', scope: 'POST http://merchant.test/pay' },
    ]);
    if (!mint.ok) throw new Error(mint.reason);
    // the agent never has the secret to put in the body; the broker injects it only as the
    // Authorization header on the real request. The request *body* it controls cannot contain it.
    await s.broker.exec(mint.capabilities[0]!, {
      kind: 'http_proxy',
      url: 'http://merchant.test/pay',
      body: JSON.stringify({ note: 'I, the agent, do not know the key' }),
    });
    expect(containsSecret(s.captured.sentBody)).toBe(false);
  });

  test('the passport proof witness/claim leaks no secret and no raw attribute', async () => {
    const s = fullStack();
    const ch = s.broker.challenge();
    const proof = await s.agent.prove(
      ch,
      [{ attribute: 'age', op: 'gte', value: 18 }],
      s.revocation.root,
    );
    const serialized = canonicalJson(proof);
    expect(containsSecret(serialized)).toBe(false);
    // only commitments are exposed — never the raw attribute values or their openings
    expect(serialized).not.toContain('"age":30');
    for (const opening of Object.values(s.openings)) {
      // the salt is the commitment preimage; leaking it would let a verifier brute-force the value
      expect(serialized).not.toContain(opening.salt);
    }
  });

  test('no broker log line contains the secret', async () => {
    const s = fullStack();
    const ch = s.broker.challenge();
    const proof = await s.agent.prove(
      ch,
      [{ attribute: 'age', op: 'gte', value: 18 }],
      s.revocation.root,
    );
    const mint = await s.broker.mintCapabilities(proof, ch, [
      { secretId: 'k', operation: 'http_proxy', scope: 'POST http://merchant.test/pay' },
    ]);
    if (!mint.ok) throw new Error(mint.reason);
    await s.broker.exec(mint.capabilities[0]!, {
      kind: 'http_proxy',
      url: 'http://merchant.test/pay',
      body: '{}',
    });
    for (const line of s.logLines) expect(containsSecret(line)).toBe(false);
  });
});
