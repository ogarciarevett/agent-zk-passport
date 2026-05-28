import { describe, expect, test } from 'bun:test';
import {
  type CredentialBody,
  commitAttributes,
  generateEd25519KeyPair,
  randomHex,
  signCredential,
} from '@azkp/credential';
import { devProofBackend } from '@azkp/proof';
import { RevocationChecker, TransparencyLog } from '@azkp/transparency-log';
import { EphemeralMasterKeyProvider, SealedVault, type SecretPolicy } from '@azkp/vault';
import { Broker, type FetchLike, type OpRequest } from '../src/index.js';

const SECRET = 'sk_live_TOPSECRET_DO_NOT_LEAK';

function harness() {
  const issuer = generateEd25519KeyPair();
  const agent = generateEd25519KeyPair();
  const log = new TransparencyLog();
  const revocation = new RevocationChecker(log.logPubkey, log.snapshot());

  const { commitments, openings } = commitAttributes({ age: 21, dailySpend: 50 });
  const body: CredentialBody = {
    version: 1,
    issuerId: 'issuer.test',
    schemaId: 'personhood.v1',
    agentPubkey: agent.publicKey,
    attributeCommitments: commitments,
    revocationId: randomHex(16),
    issuedAt: Date.now(),
    expiresAt: Date.now() + 1_000_000,
  };
  const credential = signCredential(issuer.privateKey, body);

  const vault = new SealedVault(new EphemeralMasterKeyProvider());
  const apiPolicy: SecretPolicy = {
    operations: ['http_proxy'],
    scopes: ['POST http://merchant.test/pay'],
    requiredPredicates: [{ attribute: 'age', op: 'gte', value: 18 }],
    maxUsesPerCapability: 1,
    capabilityTtlMs: 60_000,
  };
  vault.putSecret({
    id: 'merchant-api',
    type: 'api_key',
    secret: SECRET,
    policy: apiPolicy,
    metadata: { injectHeader: 'Authorization', injectPrefix: 'Bearer ' },
  });

  const logLines: string[] = [];
  const captured: { authHeader: string | null } = { authHeader: null };
  const fetchImpl: FetchLike = async (url, init) => {
    captured.authHeader = new Headers(init?.headers).get('Authorization');
    return new Response(JSON.stringify({ paid: true, url: String(url) }), { status: 200 });
  };

  const broker = new Broker({
    vault,
    trustedIssuerPubkeys: [issuer.publicKey],
    revocation,
    log: (e) => logLines.push(JSON.stringify(e)),
    fetchImpl,
  });

  return {
    issuer,
    agent,
    log,
    revocation,
    credential,
    openings,
    vault,
    broker,
    logLines,
    captured,
  };
}

async function prove(h: ReturnType<typeof harness>, challengeNonce: string) {
  return devProofBackend.prove({
    credential: h.credential,
    openings: h.openings,
    agentPrivateKeyHex: h.agent.privateKey,
    issuerPubkeyHex: h.issuer.publicKey,
    predicates: [{ attribute: 'age', op: 'gte', value: 18 }],
    revocationRoot: h.revocation.root,
    challenge: challengeNonce,
    validityMs: 60_000,
  });
}

const httpOp: OpRequest = {
  secretId: 'merchant-api',
  operation: 'http_proxy',
  scope: 'POST http://merchant.test/pay',
};

describe('broker', () => {
  test('mints a capability for a valid proof and proxies with the injected secret', async () => {
    const h = harness();
    const ch = h.broker.challenge();
    const proof = await prove(h, ch.nonce);
    const mint = await h.broker.mintCapabilities(proof, ch, [httpOp]);
    expect(mint.ok).toBe(true);
    if (!mint.ok) return;

    const res = await h.broker.exec(mint.capabilities[0]!, {
      kind: 'http_proxy',
      url: 'http://merchant.test/pay',
      body: JSON.stringify({ amount: 100 }),
    });
    expect(res.ok).toBe(true);
    if (res.ok && res.result.kind === 'http_proxy') {
      expect(res.result.status).toBe(200);
    }
    // broker injected the secret on the wire...
    expect(h.captured.authHeader).toBe(`Bearer ${SECRET}`);
  });

  test('enforces max-uses', async () => {
    const h = harness();
    const ch = h.broker.challenge();
    const mint = await h.broker.mintCapabilities(await prove(h, ch.nonce), ch, [httpOp]);
    if (!mint.ok) throw new Error('mint failed');
    const cap = mint.capabilities[0]!;
    expect(
      (await h.broker.exec(cap, { kind: 'http_proxy', url: 'http://merchant.test/pay' })).ok,
    ).toBe(true);
    const second = await h.broker.exec(cap, {
      kind: 'http_proxy',
      url: 'http://merchant.test/pay',
    });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toMatch(/exhausted/);
  });

  test('rejects a url outside the capability scope', async () => {
    const h = harness();
    const ch = h.broker.challenge();
    const mint = await h.broker.mintCapabilities(await prove(h, ch.nonce), ch, [httpOp]);
    if (!mint.ok) throw new Error('mint failed');
    const res = await h.broker.exec(mint.capabilities[0]!, {
      kind: 'http_proxy',
      url: 'http://evil.test/steal',
    });
    expect(res.ok).toBe(false);
  });

  test('refuses to mint when the passport is revoked', async () => {
    const h = harness();
    h.log.revoke(h.credential.revocationId);
    h.revocation.update(h.log.snapshot());
    const ch = h.broker.challenge();
    const proof = await prove(h, ch.nonce);
    const mint = await h.broker.mintCapabilities(proof, ch, [httpOp]);
    expect(mint.ok).toBe(false);
    if (!mint.ok) expect(mint.reason).toMatch(/revoked/);
  });

  test('revoking AFTER minting blocks exec (revocation re-checked at use)', async () => {
    const h = harness();
    const ch = h.broker.challenge();
    const mint = await h.broker.mintCapabilities(await prove(h, ch.nonce), ch, [httpOp]);
    if (!mint.ok) throw new Error('mint failed');
    h.log.revoke(h.credential.revocationId);
    h.revocation.update(h.log.snapshot());
    const res = await h.broker.exec(mint.capabilities[0]!, {
      kind: 'http_proxy',
      url: 'http://merchant.test/pay',
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/revoked/);
  });

  test('no broker log line contains the secret', async () => {
    const h = harness();
    const ch = h.broker.challenge();
    const mint = await h.broker.mintCapabilities(await prove(h, ch.nonce), ch, [httpOp]);
    if (!mint.ok) throw new Error('mint failed');
    await h.broker.exec(mint.capabilities[0]!, {
      kind: 'http_proxy',
      url: 'http://merchant.test/pay',
    });
    for (const line of h.logLines) {
      expect(line).not.toContain(SECRET);
      expect(line).not.toContain('sk_live');
    }
  });
});
