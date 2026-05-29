import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentIdentity } from '@azkp/agent-sdk';
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
import {
  Broker,
  BrokerClient,
  type BrokerServerHandle,
  type FetchLike,
  serveBrokerOverUnixSocket,
} from '../src/index.js';

const SECRET = 'sk_live_TOPSECRET_over_the_socket';

let handle: BrokerServerHandle;
let client: BrokerClient;
let agent: AgentIdentity;
let revocation: RevocationChecker;
let wireLog: string[];

beforeAll(() => {
  const issuer = generateEd25519KeyPair();
  const agentKeys = generateEd25519KeyPair();
  const log = new TransparencyLog();
  revocation = new RevocationChecker(log.logPubkey, log.snapshot());

  const { commitments, openings } = commitAttributes({ age: 25 });
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

  const vault = new SealedVault(new EphemeralMasterKeyProvider());
  const policy: SecretPolicy = {
    operations: ['http_proxy'],
    scopes: ['POST http://merchant.test/pay'],
    requiredPredicates: [{ attribute: 'age', op: 'gte', value: 18 }],
    maxUsesPerCapability: 2,
    capabilityTtlMs: 60_000,
  };
  vault.putSecret({
    id: 'k',
    type: 'api_key',
    secret: SECRET,
    policy,
    metadata: { injectHeader: 'Authorization', injectPrefix: 'Bearer ' },
  });

  wireLog = [];
  const fetchImpl: FetchLike = async (_url, init) => {
    // capture what the broker actually sends to the third party (server-side)
    wireLog.push(new Headers(init?.headers).get('Authorization') ?? '');
    return new Response('{"paid":true}', { status: 200 });
  };
  const broker = new Broker({
    vault,
    trustedIssuerPubkeys: [issuer.publicKey],
    revocation,
    fetchImpl,
  });

  handle = serveBrokerOverUnixSocket(
    broker,
    join(tmpdir(), `azkp-broker-test-${randomHex(6)}.sock`),
  );
  client = new BrokerClient(handle.socketPath);
  agent = new AgentIdentity(agentKeys, devProofBackend);
  agent.loadCredential(credential, openings, issuer.publicKey);
});

afterAll(() => handle.stop());

describe('broker over a unix-domain socket', () => {
  test('full challenge → mint → exec round-trip across the socket', async () => {
    const challenge = await client.challenge();
    const proof = await agent.prove(
      challenge,
      [{ attribute: 'age', op: 'gte', value: 18 }],
      revocation.root,
    );
    const mint = await client.mintCapabilities(proof, challenge, [
      { secretId: 'k', operation: 'http_proxy', scope: 'POST http://merchant.test/pay' },
    ]);
    expect(mint.ok).toBe(true);
    if (!mint.ok) return;

    const exec = await client.exec(mint.capabilities[0]!, {
      kind: 'http_proxy',
      url: 'http://merchant.test/pay',
      body: '{}',
    });
    expect(exec.ok).toBe(true);
    if (exec.ok && exec.result.kind === 'http_proxy') expect(exec.result.status).toBe(200);

    // the broker injected the secret server-side...
    expect(wireLog.some((h) => h === `Bearer ${SECRET}`)).toBe(true);
  });

  test('the client surface exposes no way to fetch a secret', () => {
    const surface = Object.getOwnPropertyNames(Object.getPrototypeOf(client));
    expect(surface).toEqual(expect.arrayContaining(['challenge', 'mintCapabilities', 'exec']));
    expect(surface).not.toContain('getSecret');
    expect(surface).not.toContain('exportSecret');
  });

  test('nothing the agent receives over the socket contains the secret', async () => {
    const challenge = await client.challenge();
    const proof = await agent.prove(
      challenge,
      [{ attribute: 'age', op: 'gte', value: 18 }],
      revocation.root,
    );
    const mint = await client.mintCapabilities(proof, challenge, [
      { secretId: 'k', operation: 'http_proxy', scope: 'POST http://merchant.test/pay' },
    ]);
    if (!mint.ok) throw new Error(mint.reason);
    const exec = await client.exec(mint.capabilities[0]!, {
      kind: 'http_proxy',
      url: 'http://merchant.test/pay',
      body: '{}',
    });
    // everything the agent side can observe, serialized
    const seenByAgent = JSON.stringify({ challenge, proof, mint, exec });
    expect(seenByAgent).not.toContain(SECRET);
    expect(seenByAgent).not.toContain('sk_live');
  });
});
