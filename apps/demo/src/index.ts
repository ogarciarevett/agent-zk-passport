import { AgentIdentity } from '@azkp/agent-sdk';
import { Broker } from '@azkp/broker';
/**
 * End-to-end demo. A personal agent completes a gated payment on a merchant that rejects
 * un-passported traffic — using a payment API key it never sees in plaintext.
 *
 * Topology (single process for the demo; the broker is a distinct object whose only agent-
 * facing surface is challenge/mint/exec — productionizing means moving it behind a Unix-domain
 * socket in its own process, see .ai/specs/01-spec.md §3):
 *
 *   issuer (HTTP)  ──mint──>  agent ──passport proof──>  merchant (HTTP)
 *                               │
 *                               └──proof──> broker ──injects payment key──> merchant
 *
 * Run: `bun run demo`
 */
import type { AttributeValue, Credential, OpeningMap } from '@azkp/credential';
import { createMerchantApp } from '@azkp/demo-merchant';
import { Issuer, createIssuerApp } from '@azkp/issuer';
import { RevocationChecker, TransparencyLog } from '@azkp/transparency-log';
import { EphemeralMasterKeyProvider, SealedVault, type SecretPolicy } from '@azkp/vault';
import { ReputationService, Verifier } from '@azkp/verifier';

const PAYMENT_API_KEY = 'sk_live_PAYMENT_4f9a2b_NEVER_LEAVES_THE_BROKER';

function log(step: string, msg: string) {
  console.log(`\x1b[36m${step.padEnd(22)}\x1b[0m ${msg}`);
}
function ok(msg: string) {
  console.log(`  \x1b[32m✓\x1b[0m ${msg}`);
}
function blocked(msg: string) {
  console.log(`  \x1b[33m⛔ ${msg}\x1b[0m`);
}

async function main() {
  console.log('\n\x1b[1magent-zk-passport — end-to-end demo\x1b[0m\n');

  // --- shared infrastructure -------------------------------------------------
  const log_ = new TransparencyLog();
  const issuer = new Issuer({ issuerId: 'issuer.demo' }, undefined, log_);
  const { issuerPubkey } = issuer.publicInfo();
  const revocation = new RevocationChecker(log_.logPubkey, log_.snapshot());

  const issuerServer = Bun.serve({ port: 0, fetch: createIssuerApp(issuer).fetch });
  const issuerUrl = `http://127.0.0.1:${issuerServer.port}`;

  const merchantVerifier = new Verifier({ trustedIssuerPubkeys: [issuerPubkey], revocation });
  const merchantApp = createMerchantApp({
    verifier: merchantVerifier,
    paymentApiKey: PAYMENT_API_KEY,
    requiredPredicates: [
      { attribute: 'age', op: 'gte', value: 18 },
      { attribute: 'dailySpend', op: 'lte', value: 200 },
    ],
  });
  const merchantServer = Bun.serve({ port: 0, fetch: merchantApp.fetch });
  const merchantUrl = `http://127.0.0.1:${merchantServer.port}`;

  // The user's local vault + broker. The user provisions the payment credential.
  const vault = new SealedVault(new EphemeralMasterKeyProvider());
  const payPolicy: SecretPolicy = {
    operations: ['http_proxy'],
    scopes: [`POST ${merchantUrl}/pay`],
    requiredPredicates: [{ attribute: 'age', op: 'gte', value: 18 }],
    maxUsesPerCapability: 1,
    capabilityTtlMs: 60_000,
  };
  vault.putSecret({
    id: 'merchant-pay',
    type: 'api_key',
    secret: PAYMENT_API_KEY,
    policy: payPolicy,
    metadata: { injectHeader: 'Authorization', injectPrefix: 'Bearer ' },
  });
  const broker = new Broker({ vault, trustedIssuerPubkeys: [issuerPubkey], revocation });

  try {
    // --- 1. onboard + mint ---------------------------------------------------
    const agent = AgentIdentity.create();
    log('1. onboard', 'human attests identity to the issuer (mock OIDC)');
    const claims: Record<string, AttributeValue> = { age: 21, jurisdiction: 'EU', dailySpend: 50 };
    const { sessionId } = await postJson<{ sessionId: string }>(`${issuerUrl}/onboard`, {
      provider: 'mock-oidc',
      claims,
    });
    log('2. mint', `issuer mints a credential bound to agent ${agent.agentPubkey.slice(0, 12)}…`);
    const minted = await postJson<{ credential: Credential; openings: OpeningMap }>(
      `${issuerUrl}/mint`,
      { sessionId, agentPubkey: agent.agentPubkey },
    );
    agent.loadCredential(minted.credential, minted.openings, issuerPubkey);
    ok('agent holds a credential (commitments only — no raw attributes, no secrets)');

    // --- 2. baseline: un-passported traffic is rejected ----------------------
    log('3. baseline', 'a bot with no passport hits the merchant directly');
    const naive = await fetch(`${merchantUrl}/pay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: 100 }),
    });
    blocked(
      `merchant responded ${naive.status} — ${((await naive.json()) as { error: string }).error}`,
    );

    // --- 3. the passported payment -------------------------------------------
    log('4. pay (passport)', 'agent proves personhood+limits to the merchant');
    const merchantChallenge = (await fetch(`${merchantUrl}/challenge`).then((r) => r.json())) as {
      nonce: string;
      issuedAt: number;
      expiresAt: number;
    };
    const merchantProof = await agent.prove(
      merchantChallenge,
      [
        { attribute: 'age', op: 'gte', value: 18 },
        { attribute: 'dailySpend', op: 'lte', value: 200 },
      ],
      revocation.root,
    );

    log('5. mint capability', 'agent proves to the broker, mints a scoped capability');
    const brokerChallenge = broker.challenge();
    const brokerProof = await agent.prove(
      brokerChallenge,
      [{ attribute: 'age', op: 'gte', value: 18 }],
      revocation.root,
    );
    const mint = await broker.mintCapabilities(brokerProof, brokerChallenge, [
      { secretId: 'merchant-pay', operation: 'http_proxy', scope: `POST ${merchantUrl}/pay` },
    ]);
    if (!mint.ok) throw new Error(`mint failed: ${mint.reason}`);
    ok('capability minted: http_proxy → merchant /pay (TTL 60s, 1 use), key stays sealed');

    log('6. broker proxies', 'broker injects the payment key the agent never sees');
    const paid = await broker.exec(mint.capabilities[0]!, {
      kind: 'http_proxy',
      url: `${merchantUrl}/pay`,
      headers: {
        'Content-Type': 'application/json',
        'X-Passport': JSON.stringify({ proof: merchantProof, challenge: merchantChallenge }),
      },
      body: JSON.stringify({ amount: 100 }),
    });
    if (!paid.ok) throw new Error(`payment failed: ${paid.reason}`);
    if (paid.result.kind === 'http_proxy') {
      ok(`merchant responded ${paid.result.status}: ${paid.result.body}`);
    }

    // --- 3b. reputation: merchant attests success to a per-context pseudonym ---
    log('6b. reputation', 'merchant attests the outcome to a pseudonym (no human revealed)');
    const reputation = new ReputationService(log_, 'merchant.demo');
    reputation.record(agent.agentPubkey, 'success', 3);
    const view = reputation.view(agent.agentPubkey);
    ok(`pseudonym ${view.pseudonym.slice(0, 12)}… → tier "${view.tier}" (score ${view.score})`);

    // --- 4. revocation kills future use --------------------------------------
    log('7. revoke', 'issuer revokes the credential; the agent retries');
    issuer.revoke(minted.credential.revocationId);
    revocation.update(log_.snapshot());
    const ch2 = broker.challenge();
    const proof2 = await agent.prove(
      ch2,
      [{ attribute: 'age', op: 'gte', value: 18 }],
      revocation.root,
    );
    const mint2 = await broker.mintCapabilities(proof2, ch2, [
      { secretId: 'merchant-pay', operation: 'http_proxy', scope: `POST ${merchantUrl}/pay` },
    ]);
    if (mint2.ok) throw new Error('expected revoked passport to be rejected');
    blocked(`broker refused to mint: ${mint2.reason}`);

    console.log(
      '\n\x1b[1m\x1b[32mDEMO PASSED\x1b[0m — gated payment completed; payment key never left the broker.\n',
    );
  } finally {
    issuerServer.stop(true);
    merchantServer.stop(true);
  }
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${url} -> ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
}

main().catch((err) => {
  console.error('\x1b[31mDEMO FAILED\x1b[0m', err);
  process.exit(1);
});
